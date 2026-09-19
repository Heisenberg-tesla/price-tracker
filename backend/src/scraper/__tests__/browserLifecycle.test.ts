import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeProduct } from '../scrapeProduct';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as repository from '../../db/repository';

// Mock repository and structureSnapshot so tests don't require Supabase
vi.mock('../../db/repository');
vi.mock('../structureSnapshot', () => ({
  recordStructureSnapshot: vi.fn().mockResolvedValue({ changed: false, previousFingerprint: null }),
  computeStructureFingerprint: vi.fn().mockReturnValue('MOCK_FINGERPRINT'),
}));

// Mock playwright chromium
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

describe('Browser Session Lifecycle & Isolated Attempt Scoping', () => {
  const mockProduct = {
    id: 'prod-uuid-lifecycle-test',
    product_url: 'https://demo.inelabteamdev.com/product/915',
    name: 'Ironwood Trackpad Studio',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(repository.createScrapeLog).mockResolvedValue({
      id: 'log-uuid-lifecycle',
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
      scrape_run_id: 'log-uuid-lifecycle',
    });
  });

  /**
   * Helper that builds a realistic mock Playwright browser hierarchy for one attempt.
   */
  function createMockBrowserSession(extractedProductName: string) {
    let pageClosed = false;
    let contextClosed = false;
    let browserClosed = false;

    const mockPage = {
      isClosed: vi.fn(() => pageClosed),
      close: vi.fn(async () => {
        pageClosed = true;
      }),
      setDefaultTimeout: vi.fn(),
      on: vi.fn(),
      goto: vi.fn(async () => {
        if (pageClosed || contextClosed || browserClosed) {
          throw new Error('page.goto: Target page, context or browser has been closed');
        }
        return { status: () => 200, statusText: () => 'OK' };
      }),
      locator: vi.fn((_selector: string) => ({
        first: vi.fn().mockReturnValue({
          waitFor: vi.fn(async () => {
            if (pageClosed) throw new Error('Target closed');
          }),
          textContent: vi.fn(async () => extractedProductName),
          getAttribute: vi.fn(async () => null), // Not disabled
          boundingBox: vi.fn(async () => ({ x: 100, y: 100, width: 200, height: 100 })),
          click: vi.fn(async () => {
            if (pageClosed) throw new Error('Target closed');
          }),
        }),
        innerText: vi.fn(async () => 'In Stock'),
      })),
      mouse: {
        move: vi.fn(async () => {}),
      },
      waitForTimeout: vi.fn(async () => {
        if (pageClosed || contextClosed || browserClosed) {
          throw new Error('page.waitForTimeout: Target page, context or browser has been closed');
        }
      }),
      waitForSelector: vi.fn(async () => {}),
      $: vi.fn(async () => null), // No price error
      evaluate: vi.fn(async () => ({
        realPriceRaw: '₹14,177',
        honeypotValues: ['₹10,115'],
        mrpRaw: '₹18,999',
        badgeRaw: '25% off',
        stockRaw: 'In Stock',
        nodeSummaries: [],
      })),
      route: vi.fn(async () => {}),
      unrouteAll: vi.fn(async () => {}),
    } as unknown as Page;

    const mockContext = {
      close: vi.fn(async () => {
        contextClosed = true;
      }),
      newPage: vi.fn(async () => mockPage),
    } as unknown as BrowserContext;

    const mockBrowser = {
      isConnected: vi.fn(() => !browserClosed),
      close: vi.fn(async () => {
        browserClosed = true;
      }),
      newContext: vi.fn(async () => mockContext),
    } as unknown as Browser;

    return { mockBrowser, mockContext, mockPage };
  }

  it('regression test: deliberately fails attempt 1 on validation error and asserts attempt 2 launches a genuinely fresh browser session without hitting closed browser', async () => {
    // Attempt 1: returns wrong name -> triggers validation error (Product name mismatch)
    const session1 = createMockBrowserSession('Completely Wrong Product Name (Drift)');
    // Attempt 2: returns correct name -> passes validation
    const session2 = createMockBrowserSession('Ironwood Trackpad Studio');

    const launchedBrowsers: Browser[] = [];
    vi.mocked(chromium.launch).mockImplementation(async () => {
      const session = launchedBrowsers.length === 0 ? session1 : session2;
      launchedBrowsers.push(session.mockBrowser);
      return session.mockBrowser;
    });

    const result = await scrapeProduct(mockProduct, { maxAttempts: 3, retryDelayMs: 5 });

    // 1. Assert exactly 2 browser sessions were launched
    expect(chromium.launch).toHaveBeenCalledTimes(2);
    expect(launchedBrowsers).toHaveLength(2);
    expect(launchedBrowsers[0]).toBe(session1.mockBrowser);
    expect(launchedBrowsers[1]).toBe(session2.mockBrowser);
    expect(session1.mockBrowser).not.toBe(session2.mockBrowser);

    // 2. Assert Attempt 1 browser, context, and page were cleanly closed upon validation failure
    expect(session1.mockPage.close).toHaveBeenCalledTimes(1);
    expect(session1.mockContext.close).toHaveBeenCalledTimes(1);
    expect(session1.mockBrowser.close).toHaveBeenCalledTimes(1);
    expect(session1.mockPage.isClosed()).toBe(true);
    expect(session1.mockBrowser.isConnected()).toBe(false);

    // 3. Assert Attempt 2 launched a clean, connected browser and executed goto without closed-browser error
    expect(session2.mockBrowser.newContext).toHaveBeenCalledTimes(1);
    expect(session2.mockContext.newPage).toHaveBeenCalledTimes(1);
    expect(session2.mockPage.goto).toHaveBeenCalledTimes(1);
    expect(session2.mockPage.evaluate).toHaveBeenCalledTimes(1);

    // 4. Assert Attempt 2 successfully recovered (outcome = "success_after_retry")
    expect(result.outcome).toBe('success_after_retry');
    expect(result.attempts).toBe(2);
    expect(result.attemptDetails).toHaveLength(2);

    // Attempt 1 recorded the genuine validation error, NOT a closed browser error
    expect(result.attemptDetails[0]?.attempt).toBe(1);
    expect(result.attemptDetails[0]?.error).toContain('Product name mismatch');

    // Attempt 2 succeeded cleanly
    expect(result.attemptDetails[1]?.attempt).toBe(2);
    expect(result.attemptDetails[1]?.error).toBeNull();

    // Price history was successfully inserted
    expect(repository.insertPriceHistory).toHaveBeenCalledTimes(1);
  });
});
