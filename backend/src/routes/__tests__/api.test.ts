import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { env } from '../../config/env';
import * as repository from '../../db/repository';
import * as catalog from '../../scraper/catalog';
import * as scraperModule from '../../scraper/scrapeProduct';
import { AppError } from '../../lib/errors';
import { TrackedProductWithStatus, ScrapeLog, TrackedProduct } from '../../types/database';

// Mock the scraper module so tests never launch a real Playwright browser
vi.mock('../../scraper/scrapeProduct', () => ({
  scrapeProduct: vi.fn(),
}));

describe('API Routes Integration Test Suite', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    repository.resetProductScrapeLocks();
    repository.resetCronLocks();

    vi.spyOn(repository, 'createScrapeLog').mockImplementation(async (input) => ({
      id: 'mock-scrape-log-id',
      product_id: input.product_id,
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
      trigger_source: input.trigger_source || 'manual',
    }));
  });

  // ---------------------------------------------------------------------------
  // 1. GET /api/health
  // ---------------------------------------------------------------------------
  describe('GET /api/health', () => {
    it('reports health status, uptime, version, and dbConnected accurately', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('dbConnected');
      expect(typeof res.body.dbConnected).toBe('boolean');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /api/store/search
  // ---------------------------------------------------------------------------
  describe('GET /api/store/search', () => {
    it('returns catalog search results strictly without any price field', async () => {
      vi.spyOn(catalog, 'searchCatalog').mockResolvedValueOnce({
        items: [
          {
            id: 915,
            name: 'Ironwood Trackpad Studio',
            brand: 'Inelab',
            sku: 'SKU-915',
            category: 'Hardware',
            rating: 4.8,
            reviewsCount: 120,
            inStock: true,
            image: 'https://demo.inelabteamdev.com/img/915.jpg',
            url: 'https://demo.inelabteamdev.com/product/915',
          },
        ],
        total: 1,
        offset: 0,
        limit: 20,
      });

      const res = await request(app).get('/api/store/search?q=ironwood');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);

      const item = res.body[0];
      expect(item.storeProductId).toBe('915');
      expect(item.name).toBe('Ironwood Trackpad Studio');
      expect(item.url).toBe('https://demo.inelabteamdev.com/product/915');
      expect(item.imageUrl).toBe('https://demo.inelabteamdev.com/img/915.jpg');

      // CRITICAL CONTRACT: Strictly NO price field on Tier 1 search results
      expect(item.price).toBeUndefined();
      expect(item.priceCents).toBeUndefined();
      expect(item.price_cents).toBeUndefined();
      expect(item.rawPrice).toBeUndefined();
    });

    it('returns 503 when the catalog is unavailable or ingestion fails', async () => {
      vi.spyOn(catalog, 'searchCatalog').mockRejectedValueOnce(
        new Error('Network partition connecting to upstream catalog'),
      );

      const res = await request(app).get('/api/store/search?q=fail');

      expect(res.status).toBe(503);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('CATALOG_UNAVAILABLE');
      expect(res.body.error.message).toContain('Store catalog is currently unavailable');
    });

    it('rejects empty query parameter with 400 validation error', async () => {
      const res = await request(app).get('/api/store/search?q=');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. POST /api/products
  // ---------------------------------------------------------------------------
  describe('POST /api/products', () => {
    it('creates product, dispatches initial async scrape, and returns 201 immediately', async () => {
      const mockProduct = {
        id: '11111111-2222-3333-4444-555555555555',
        store_product_id: '915',
        product_url: 'https://demo.inelabteamdev.com/product/915',
        name: 'Ironwood Trackpad Studio',
        image_url: null,
        category: null,
        sku: null,
        scrape_interval_minutes: 120,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.spyOn(repository, 'createTrackedProduct').mockResolvedValueOnce(mockProduct);
      const scrapeMock = vi.spyOn(scraperModule, 'scrapeProduct').mockResolvedValueOnce({
        log: { id: 'log-1' } as unknown as ScrapeLog,
        outcome: 'success',
        attempts: 1,
        attemptDetails: [],
      });

      const res = await request(app).post('/api/products').send({
        productUrl: 'https://demo.inelabteamdev.com/product/915',
        name: 'Ironwood Trackpad Studio',
        scrapeIntervalMinutes: 60,
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(mockProduct.id);
      expect(res.body.isCurrentlyRunning).toBe(true);

      // Verify scrapeProduct was triggered asynchronously with triggerSource='initial'
      expect(scrapeMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockProduct.id }),
        expect.objectContaining({ triggerSource: 'initial' }),
      );
    });

    it('rejects a duplicate product_url with 409 conflict', async () => {
      vi.spyOn(repository, 'createTrackedProduct').mockRejectedValueOnce(
        new AppError('Product with URL is already being tracked', 409, 'DUPLICATE_URL'),
      );

      const res = await request(app).post('/api/products').send({
        productUrl: 'https://demo.inelabteamdev.com/product/915',
        name: 'Duplicate Product',
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_URL');
    });

    it('rejects an invalid product_url pattern with 400 validation error', async () => {
      const res = await request(app).post('/api/products').send({
        productUrl: 'https://randomsite.com/invalid-item',
        name: 'Invalid Pattern',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. POST /api/products/:id/scrape (Atomic Concurrency Test)
  // ---------------------------------------------------------------------------
  describe('POST /api/products/:id/scrape', () => {
    const testProductId = '22222222-3333-4444-5555-666666666666';

    const mockProductDetail: TrackedProductWithStatus = {
      id: testProductId,
      store_product_id: '915',
      product_url: 'https://demo.inelabteamdev.com/product/915',
      name: 'Ironwood Trackpad Studio',
      image_url: null,
      category: 'Hardware',
      sku: 'SKU-915',
      scrape_interval_minutes: 120,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      lastCompletedOutcome: 'success',
      isCurrentlyRunning: false,
      lastScrapedAt: new Date().toISOString(),
      latestPriceCents: 1417700,
      latestInStock: true,
    };

    it('atomic concurrency: firing two simultaneous scrape requests results in exactly one 202 and one 409', async () => {
      vi.spyOn(repository, 'getProduct').mockResolvedValue(mockProductDetail);

      // Make scrapeProduct linger for 100ms before releasing lock
      vi.spyOn(scraperModule, 'scrapeProduct').mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  log: { id: 'scrape-log-id' } as unknown as ScrapeLog,
                  outcome: 'success',
                  attempts: 1,
                  attemptDetails: [],
                }),
              100,
            ),
          ),
      );

      // Fire two concurrent requests via Promise.all
      const [res1, res2] = await Promise.all([
        request(app).post(`/api/products/${testProductId}/scrape`),
        request(app).post(`/api/products/${testProductId}/scrape`),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([202, 409]);

      const conflictRes = res1.status === 409 ? res1 : res2;
      expect(conflictRes.body.error.code).toBe('SCRAPE_ALREADY_IN_PROGRESS');

      const successRes = res1.status === 202 ? res1 : res2;
      expect(successRes.body.isCurrentlyRunning).toBe(true);
    });

    it('returns 409 if createScrapeLog detects another pending scrape in DB (e.g. across multiple instances)', async () => {
      vi.spyOn(repository, 'getProduct').mockResolvedValueOnce(mockProductDetail);
      vi.spyOn(repository, 'createScrapeLog').mockRejectedValueOnce(
        new AppError('A scrape is already in progress for this product', 409, 'SCRAPE_ALREADY_IN_PROGRESS'),
      );

      const res = await request(app).post(`/api/products/${testProductId}/scrape`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SCRAPE_ALREADY_IN_PROGRESS');
    });

    it('returns 404 if product does not exist', async () => {
      vi.spyOn(repository, 'getProduct').mockResolvedValueOnce(null);

      const res = await request(app).post(
        '/api/products/00000000-0000-0000-0000-000000000000/scrape',
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. GET /api/products/:id/logs
  // ---------------------------------------------------------------------------
  describe('GET /api/products/:id/logs', () => {
    const testProductId = '33333333-4444-5555-6666-777777777777';

    it('includes failed and abandoned entries when present', async () => {
      vi.spyOn(repository, 'getProduct').mockResolvedValueOnce({
        id: testProductId,
      } as unknown as TrackedProductWithStatus);

      const mockLogs: ScrapeLog[] = [
        {
          id: 'log-abandoned',
          product_id: testProductId,
          started_at: new Date(Date.now() - 700000).toISOString(),
          finished_at: new Date(Date.now() - 600000).toISOString(),
          duration_ms: 100000,
          outcome: 'abandoned',
          attempts: 1,
          strategy_used: 'headless',
          http_status: null,
          error_type: 'abandoned',
          error_message: 'Process terminated unexpectedly',
          attempt_details: [],
          price_cents: null,
          in_stock: null,
          trigger_source: 'cron',
        },
        {
          id: 'log-failed',
          product_id: testProductId,
          started_at: new Date(Date.now() - 300000).toISOString(),
          finished_at: new Date(Date.now() - 280000).toISOString(),
          duration_ms: 20000,
          outcome: 'failed',
          attempts: 3,
          strategy_used: 'headless',
          http_status: 503,
          error_type: 'http_error',
          error_message: 'Upstream price service 503',
          attempt_details: [],
          price_cents: null,
          in_stock: null,
          trigger_source: 'manual',
        },
        {
          id: 'log-success',
          product_id: testProductId,
          started_at: new Date(Date.now() - 100000).toISOString(),
          finished_at: new Date(Date.now() - 85000).toISOString(),
          duration_ms: 15000,
          outcome: 'success',
          attempts: 1,
          strategy_used: 'headless',
          http_status: 200,
          error_type: null,
          error_message: null,
          attempt_details: [],
          price_cents: 1417700,
          in_stock: true,
          trigger_source: 'cron',
        },
      ];

      vi.spyOn(repository, 'getScrapeLogs').mockResolvedValueOnce(mockLogs);

      const res = await request(app).get(`/api/products/${testProductId}/logs`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(3);

      const outcomes = res.body.map((l: ScrapeLog) => l.outcome);
      expect(outcomes).toContain('abandoned');
      expect(outcomes).toContain('failed');
      expect(outcomes).toContain('success');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. POST /api/cron/scrape-due
  // ---------------------------------------------------------------------------
  describe('POST /api/cron/scrape-due', () => {
    it('rejects a request with a missing X-Cron-Secret with 401', async () => {
      const res = await request(app).post('/api/cron/scrape-due');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a request with an incorrect X-Cron-Secret with 401', async () => {
      const res = await request(app)
        .post('/api/cron/scrape-due')
        .set('X-Cron-Secret', 'invalid_secret_key');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('executes scrape-due cycle successfully with valid X-Cron-Secret', async () => {
      vi.spyOn(repository, 'reconcileStalePendingLogs').mockResolvedValueOnce({
        reconciledCount: 1,
        reconciledIds: ['stale-1'],
      });

      vi.spyOn(repository, 'getDueProducts').mockResolvedValueOnce([
        {
          id: 'due-1',
          name: 'Due Product 1',
          product_url: 'https://demo.inelabteamdev.com/product/101',
          scrape_interval_minutes: 60,
          is_active: true,
        } as unknown as TrackedProduct,
      ]);

      vi.spyOn(scraperModule, 'scrapeProduct').mockResolvedValueOnce({
        log: { id: 'cron-log-1' } as unknown as ScrapeLog,
        outcome: 'success',
        attempts: 1,
        attemptDetails: [],
      });

      const res = await request(app)
        .post('/api/cron/scrape-due')
        .set('X-Cron-Secret', env.CRON_SECRET);

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(false);
      expect(res.body.trigger).toBe('cron');
      expect(res.body.attempted).toBe(1);
      expect(res.body.succeeded).toBe(1);
      expect(res.body.reconciled).toBe(1);
      expect(typeof res.body.durationMs).toBe('number');
    });

    it('records trigger_source accurately when triggered by github-actions', async () => {
      vi.spyOn(repository, 'reconcileStalePendingLogs').mockResolvedValueOnce({
        reconciledCount: 0,
        reconciledIds: [],
      });

      vi.spyOn(repository, 'getDueProducts').mockResolvedValueOnce([
        {
          id: 'due-gha-1',
          name: 'GHA Due Product',
          product_url: 'https://demo.inelabteamdev.com/product/102',
          scrape_interval_minutes: 120,
          is_active: true,
        } as unknown as TrackedProduct,
      ]);

      const scrapeSpy = vi.spyOn(scraperModule, 'scrapeProduct').mockResolvedValueOnce({
        log: { id: 'cron-log-gha' } as unknown as ScrapeLog,
        outcome: 'success',
        attempts: 1,
        attemptDetails: [],
      });

      const res = await request(app)
        .post('/api/cron/scrape-due')
        .set('X-Cron-Secret', env.CRON_SECRET)
        .set('X-Trigger-Source', 'github-actions');

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(false);
      expect(res.body.trigger).toBe('github-actions');
      expect(scrapeSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ triggerSource: 'github-actions' }),
      );
    });

    it('handles concurrent requests idempotently: only one runs while the other returns { skipped: true }', async () => {
      vi.spyOn(repository, 'reconcileStalePendingLogs').mockResolvedValue({
        reconciledCount: 0,
        reconciledIds: [],
      });

      vi.spyOn(repository, 'getDueProducts').mockResolvedValue([
        {
          id: 'due-concurrent-1',
          name: 'Concurrent Product',
          product_url: 'https://demo.inelabteamdev.com/product/103',
          scrape_interval_minutes: 120,
          is_active: true,
        } as unknown as TrackedProduct,
      ]);

      // Delay scrapeProduct slightly so the second request arrives while the first is actively executing
      vi.spyOn(scraperModule, 'scrapeProduct').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          log: { id: 'cron-concurrent-log' } as unknown as ScrapeLog,
          outcome: 'success',
          attempts: 1,
          attemptDetails: [],
        };
      });

      // Fire two concurrent requests simultaneously via Promise.all
      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/cron/scrape-due')
          .set('X-Cron-Secret', env.CRON_SECRET)
          .set('X-Trigger-Source', 'cron'),
        request(app)
          .post('/api/cron/scrape-due')
          .set('X-Cron-Secret', env.CRON_SECRET)
          .set('X-Trigger-Source', 'github-actions'),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const responses = [resA.body, resB.body];
      const executed = responses.find((r) => r.skipped === false);
      const skipped = responses.find((r) => r.skipped === true);

      expect(executed).toBeDefined();
      expect(skipped).toBeDefined();

      // Executed run assertions
      expect(executed.attempted).toBe(1);
      expect(executed.succeeded).toBe(1);

      // Skipped run assertions
      expect(skipped.skipped).toBe(true);
      expect(skipped.reason).toBe('run already in progress');
      expect(['cron', 'github-actions']).toContain(skipped.trigger);
    });
  });
});
