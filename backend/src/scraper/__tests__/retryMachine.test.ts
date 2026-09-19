import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeProduct } from '../scrapeProduct';
import * as browserFetcher from '../browserFetcher';
import * as repository from '../../db/repository';
import { AppError } from '../../lib/errors';
import { ScrapedPriceData } from '../types';

import * as structureSnapshot from '../structureSnapshot';

vi.mock('../browserFetcher');
vi.mock('../../db/repository');
vi.mock('../structureSnapshot', () => ({
  recordStructureSnapshot: vi.fn().mockResolvedValue({ changed: false, previousFingerprint: null }),
  computeStructureFingerprint: vi.fn().mockReturnValue('MOCK_FINGERPRINT'),
}));

describe('Orchestrator Retry and Backoff State Machine', () => {
  const mockProduct = {
    id: 'prod-uuid-123',
    product_url: 'https://demo.inelabteamdev.com/product/915',
    name: 'Ironwood Trackpad Studio',
  };

  const sampleValidData: ScrapedPriceData = {
    priceCents: 1417700,
    currency: 'INR',
    inStock: true,
    stockText: 'In Stock',
    productName: 'Ironwood Trackpad Studio',
    rawPriceText: '₹14,177',
    honeypotValuesSeen: [1011500, 1199900],
    selectorFingerprint: 'TEST_FINGERPRINT',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(repository.createScrapeLog).mockResolvedValue({
      id: 'log-uuid-abc',
      product_id: mockProduct.id,
      started_at: new Date().toISOString(),
      finished_at: null,
      duration_ms: null,
      outcome: 'pending',
      attempts: 0,
      strategy_used: 'headless',
      http_status: null,
      error_type: null,
      error_message: null,
      attempt_details: [],
      price_cents: null,
      in_stock: null,
      trigger_source: 'manual',
    });

    vi.mocked(repository.finaliseScrapeLog).mockImplementation(async (id, data) => ({
      id,
      product_id: mockProduct.id,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: 500,
      outcome: data.outcome,
      attempts: data.attempts || 1,
      strategy_used: 'headless',
      http_status: data.http_status || null,
      error_type: data.error_type || null,
      error_message: data.error_message || null,
      attempt_details: data.attempt_details || [],
      price_cents: data.price_cents || null,
      in_stock: data.in_stock || null,
      trigger_source: 'manual',
    }));

    vi.mocked(repository.insertPriceHistory).mockResolvedValue({
      id: 1,
      product_id: mockProduct.id,
      price_cents: 1417700,
      currency: 'INR',
      in_stock: true,
      stock_text: 'In Stock',
      scraped_at: new Date().toISOString(),
      scrape_run_id: 'log-uuid-abc',
    });
  });

  it('succeeds on first attempt without retrying (outcome = "success")', async () => {
    vi.mocked(browserFetcher.fetchPriceWithBrowser).mockResolvedValueOnce(sampleValidData);

    const result = await scrapeProduct(mockProduct, { maxAttempts: 3, retryDelayMs: 5 });

    expect(result.outcome).toBe('success');
    expect(result.attempts).toBe(1);
    expect(result.attemptDetails).toHaveLength(1);
    expect(result.attemptDetails[0]?.error).toBeNull();
    expect(repository.insertPriceHistory).toHaveBeenCalledTimes(1);
    expect(repository.finaliseScrapeLog).toHaveBeenCalledWith(
      'log-uuid-abc',
      expect.objectContaining({
        outcome: 'success',
        attempts: 1,
        price_cents: 1417700,
      }),
    );
  });

  it('recovers on retry after stuck reveal button (outcome = "success_after_retry")', async () => {
    // Attempt 1: stuck reveal button
    vi.mocked(browserFetcher.fetchPriceWithBrowser)
      .mockRejectedValueOnce(new AppError('Reveal button remained disabled after mouse dwell', 504, 'REVEAL_BUTTON_STUCK'))
      // Attempt 2: succeeds
      .mockResolvedValueOnce(sampleValidData);

    const result = await scrapeProduct(mockProduct, { maxAttempts: 3, retryDelayMs: 5 });

    expect(result.outcome).toBe('success_after_retry');
    expect(result.attempts).toBe(2);
    expect(result.attemptDetails).toHaveLength(2);
    expect(result.attemptDetails[0]?.error).toContain('Reveal button remained disabled');
    expect(result.attemptDetails[1]?.error).toBeNull();
    expect(repository.insertPriceHistory).toHaveBeenCalledTimes(1);
  });

  it('recovers on retry after price endpoint error (outcome = "success_after_retry")', async () => {
    // Attempt 1: price container entered error state (e.g. 503)
    vi.mocked(browserFetcher.fetchPriceWithBrowser)
      .mockRejectedValueOnce(new AppError('Price container entered error state: "Price calculation service temporarily unavailable (503)"', 503, 'PRICE_ENDPOINT_ERROR'))
      // Attempt 2: succeeds
      .mockResolvedValueOnce(sampleValidData);

    const result = await scrapeProduct(mockProduct, { maxAttempts: 3, retryDelayMs: 5 });

    expect(result.outcome).toBe('success_after_retry');
    expect(result.attempts).toBe(2);
    expect(repository.insertPriceHistory).toHaveBeenCalledTimes(1);
  });

  it('recovers on retry after 429 rate limit error (outcome = "success_after_retry")', async () => {
    // Attempt 1: 429 rate limit
    vi.mocked(browserFetcher.fetchPriceWithBrowser)
      .mockRejectedValueOnce(new AppError('Rate limited on challenge endpoint (HTTP 429)', 429, 'HTTP_ERROR'))
      // Attempt 2: succeeds
      .mockResolvedValueOnce(sampleValidData);

    const result = await scrapeProduct(mockProduct, { maxAttempts: 3, retryDelayMs: 5 });

    expect(result.outcome).toBe('success_after_retry');
    expect(result.attempts).toBe(2);
    expect(result.attemptDetails[0]?.status).toBe(429);
    expect(repository.insertPriceHistory).toHaveBeenCalledTimes(1);
  });

  it('terminates immediately without retrying on genuine 404 (outcome = "failed")', async () => {
    vi.mocked(browserFetcher.fetchPriceWithBrowser).mockRejectedValueOnce(
      new AppError('Product not found at url (HTTP 404)', 404, 'PRODUCT_NOT_FOUND'),
    );

    const result = await scrapeProduct(mockProduct, { maxAttempts: 3, retryDelayMs: 5 });

    expect(result.outcome).toBe('failed');
    expect(result.attempts).toBe(1); // Did not retry!
    expect(repository.insertPriceHistory).not.toHaveBeenCalled();
    expect(repository.finaliseScrapeLog).toHaveBeenCalledWith(
      'log-uuid-abc',
      expect.objectContaining({
        outcome: 'failed',
        attempts: 1,
      }),
    );
  });

  it('marks outcome = "failed" after exhausting all maxAttempts with nothing written to price_history', async () => {
    vi.mocked(browserFetcher.fetchPriceWithBrowser)
      .mockRejectedValueOnce(new Error('Reveal click dropped 5x'))
      .mockRejectedValueOnce(new Error('Reveal click dropped 5x'))
      .mockRejectedValueOnce(new Error('Reveal click dropped 5x'));

    const result = await scrapeProduct(mockProduct, { maxAttempts: 3, retryDelayMs: 5 });

    expect(result.outcome).toBe('failed');
    expect(result.attempts).toBe(3);
    expect(result.attemptDetails).toHaveLength(3);
    expect(repository.insertPriceHistory).not.toHaveBeenCalled();
    expect(repository.finaliseScrapeLog).toHaveBeenCalledWith(
      'log-uuid-abc',
      expect.objectContaining({
        outcome: 'failed',
        attempts: 3,
        error_type: 'parse_error',
      }),
    );
  });

  it('sets error_type = "structure_changed" on scrape_logs when DOM change coincides with a failure', async () => {
    vi.mocked(structureSnapshot.recordStructureSnapshot).mockResolvedValue({
      changed: true,
      previousFingerprint: 'OLD_FINGERPRINT_123',
    });

    const carrierError = new AppError('Failed to extract real price carrier', 500, 'NO_PRICE_CARRIER');
    (carrierError as unknown as { fingerprint: string }).fingerprint = 'NEW_FINGERPRINT_456';

    vi.mocked(browserFetcher.fetchPriceWithBrowser).mockRejectedValue(carrierError);

    const result = await scrapeProduct(mockProduct, { maxAttempts: 1, retryDelayMs: 5 });

    expect(result.outcome).toBe('failed');
    expect(repository.finaliseScrapeLog).toHaveBeenCalledWith(
      'log-uuid-abc',
      expect.objectContaining({
        outcome: 'failed',
        error_type: 'structure_changed',
      }),
    );
  });

  it('preserves error_type = "validation_error" on product name mismatch even if structure snapshot recorded changed=true', async () => {
    vi.mocked(structureSnapshot.recordStructureSnapshot).mockResolvedValue({
      changed: true,
      previousFingerprint: 'OLD_FINGERPRINT_123',
    });

    vi.mocked(browserFetcher.fetchPriceWithBrowser).mockResolvedValue({
      priceCents: 1417700,
      currency: 'INR',
      inStock: true,
      stockText: 'In Stock',
      productName: 'Completely Different Product',
      selectorFingerprint: 'NEW_FINGERPRINT_456',
      rawPriceText: '₹14,177.00',
      honeypotValuesSeen: [],
    });

    const result = await scrapeProduct(
      { ...mockProduct, name: 'Expected Product Name' },
      { maxAttempts: 1, retryDelayMs: 5 },
    );

    expect(result.outcome).toBe('failed');
    expect(repository.finaliseScrapeLog).toHaveBeenCalledWith(
      'log-uuid-abc',
      expect.objectContaining({
        outcome: 'failed',
        error_type: 'validation_error',
        error_message: expect.stringContaining('Product name mismatch'),
      }),
    );
  });
});
