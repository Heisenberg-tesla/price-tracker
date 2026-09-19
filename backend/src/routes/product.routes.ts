import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import {
  createTrackedProduct,
  listTrackedProductsWithStats,
  getProduct,
  updateProduct,
  deleteProduct,
  getPriceHistory,
  getScrapeLogs,
  getPriceChange24h,
  acquireProductScrapeLock,
  releaseProductScrapeLock,
  createScrapeLog,
} from '../db/repository';
import { ScrapeLog } from '../types/database';
import { scrapeProduct } from '../scraper/scrapeProduct';
import { validateRequest } from '../middleware/validate';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export const productsRouter = Router();

// -----------------------------------------------------------------------------
// Validation Schemas
// -----------------------------------------------------------------------------

const uuidSchema = z.string().uuid('ID must be a valid UUID');

const createProductSchema = {
  body: z.object({
    productUrl: z
      .string({ required_error: 'productUrl is required' })
      .url('productUrl must be a valid URL')
      .refine(
        (url) => {
          // Validate productUrl actually matches the expected store's product URL pattern
          const base = env.STORE_BASE_URL.replace(/\/$/, '');
          const regex = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/product/\\d+/?$`, 'i');
          // Also accept relative demo domain matches
          return regex.test(url) || /^https?:\/\/[^/]+\/product\/\d+\/?$/i.test(url);
        },
        {
          message:
            'productUrl must match the store product URL pattern (e.g. https://demo.inelabteamdev.com/product/915)',
        },
      ),
    name: z.string({ required_error: 'name is required' }).trim().min(1, 'name must not be empty'),
    scrapeIntervalMinutes: z.coerce
      .number()
      .int()
      .min(5, 'scrapeIntervalMinutes must be at least 5 minutes')
      .max(1440, 'scrapeIntervalMinutes cannot exceed 1440 minutes (24 hours)')
      .optional()
      .default(120),
  }),
};

const idParamSchema = {
  params: z.object({
    id: uuidSchema,
  }),
};

const updateProductSchema = {
  params: z.object({
    id: uuidSchema,
  }),
  body: z.object({
    name: z.string().trim().min(1).optional(),
    scrapeIntervalMinutes: z.coerce
      .number()
      .int()
      .min(5, 'scrapeIntervalMinutes must be at least 5 minutes')
      .max(1440, 'scrapeIntervalMinutes cannot exceed 1440 minutes')
      .optional(),
    isActive: z.boolean().optional(),
  }),
};

const historyQuerySchema = {
  params: z.object({
    id: uuidSchema,
  }),
  query: z.object({
    range: z.enum(['24h', '7d', '30d', 'all']).optional().default('all'),
  }),
};

const logsQuerySchema = {
  params: z.object({
    id: uuidSchema,
  }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  }),
};

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

/**
 * POST /api/products
 * Creates a new tracked product record, immediately dispatches initial async scrape,
 * and returns 201 Created with isCurrentlyRunning: true.
 */
productsRouter.post(
  '/',
  validateRequest(createProductSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { productUrl, name, scrapeIntervalMinutes } = req.body;

      // Extract store product id if present in URL
      const match = productUrl.match(/\/product\/(\d+)/i);
      const storeProductId = match && match[1] ? match[1] : null;

      const created = await createTrackedProduct({
        product_url: productUrl,
        name,
        store_product_id: storeProductId,
        scrape_interval_minutes: scrapeIntervalMinutes,
        is_active: true,
      });

      // Fire-and-forget initial scrape: never blocks response, never unhandled
      void (async () => {
        try {
          logger.info(
            { productId: created.id, triggerSource: 'initial' },
            'Launching initial background scrape for new product',
          );
          await scrapeProduct(created, { triggerSource: 'initial' });
        } catch (err: unknown) {
          logger.error(
            {
              productId: created.id,
              triggerSource: 'initial',
              err: err instanceof Error ? err.message : String(err),
            },
            'Unhandled error caught during initial background scrape execution',
          );
        }
      })();

      res.status(201).json({
        ...created,
        isCurrentlyRunning: true,
        lastCompletedOutcome: null,
        lastScrapedAt: null,
        latestPriceCents: null,
        latestInStock: null,
        priceChange24h: null,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/products
 * Returns all tracked products enriched with runtime status and priceChange24h.
 */
productsRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const products = await listTrackedProductsWithStats();
    res.status(200).json(products);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/products/:id
 * Full product detail with runtime status and priceChange24h.
 */
productsRouter.get(
  '/:id',
  validateRequest(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const product = await getProduct(id);
      if (!product) {
        throw new AppError(`Product with ID ${id} not found`, 404, 'PRODUCT_NOT_FOUND');
      }

      const priceChange24h = await getPriceChange24h(product.id, product.latestPriceCents);
      res.status(200).json({
        ...product,
        priceChange24h,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /api/products/:id
 * Updates product configuration (name, scrapeIntervalMinutes, isActive).
 */
productsRouter.patch(
  '/:id',
  validateRequest(updateProductSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { name, scrapeIntervalMinutes, isActive } = req.body;

      const existing = await getProduct(id);
      if (!existing) {
        throw new AppError(`Product with ID ${id} not found`, 404, 'PRODUCT_NOT_FOUND');
      }

      const updated = await updateProduct(id, {
        name,
        scrape_interval_minutes: scrapeIntervalMinutes,
        is_active: isActive,
      });

      const priceChange24h = await getPriceChange24h(updated.id, existing.latestPriceCents);

      res.status(200).json({
        ...existing,
        ...updated,
        priceChange24h,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/products/:id
 * Deletes product and cascades associated history/logs. Returns 204.
 */
productsRouter.delete(
  '/:id',
  validateRequest(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const deleted = await deleteProduct(id);
      if (!deleted) {
        throw new AppError(`Product with ID ${id} not found`, 404, 'PRODUCT_NOT_FOUND');
      }

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/products/:id/history?range=24h|7d|30d|all
 * Returns price history ordered ascending by scraped_at for charting.
 */
productsRouter.get(
  '/:id/history',
  validateRequest(historyQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const range = (req.query.range as '24h' | '7d' | '30d' | 'all') || 'all';

      const existing = await getProduct(id);
      if (!existing) {
        throw new AppError(`Product with ID ${id} not found`, 404, 'PRODUCT_NOT_FOUND');
      }

      let fromDate: Date | undefined;
      const now = Date.now();
      if (range === '24h') {
        fromDate = new Date(now - 24 * 60 * 60 * 1000);
      } else if (range === '7d') {
        fromDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
      } else if (range === '30d') {
        fromDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
      }

      const history = await getPriceHistory(id, fromDate ? { from: fromDate } : undefined);
      res.status(200).json(history);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/products/:id/logs?limit=50
 * Returns scrape logs for product ordered newest first.
 * Includes all outcomes (pending, success, success_after_retry, failed, abandoned).
 */
productsRouter.get(
  '/:id/logs',
  validateRequest(logsQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const limit = Number(req.query.limit) || 50;

      const existing = await getProduct(id);
      if (!existing) {
        throw new AppError(`Product with ID ${id} not found`, 404, 'PRODUCT_NOT_FOUND');
      }

      const logs = await getScrapeLogs(id, limit);
      res.status(200).json(logs);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/products/:id/scrape
 * Manual on-demand scrape.
 * Atomic concurrency guard: rejects with 409 if a scrape is already in progress.
 * Returns 202 Accepted immediately without blocking on headless browser.
 */
productsRouter.post(
  '/:id/scrape',
  validateRequest(idParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;

      const product = await getProduct(id);
      if (!product) {
        throw new AppError(`Product with ID ${id} not found`, 404, 'PRODUCT_NOT_FOUND');
      }

      // 1. Atomic in-process lock acquisition: prevents check-then-act race conditions
      if (!acquireProductScrapeLock(id)) {
        throw new AppError(
          'A scrape is already in progress for this product',
          409,
          'SCRAPE_ALREADY_IN_PROGRESS',
        );
      }

      // 2. Database level check & atomic pending log creation:
      // Guarantees atomic "insert only if no pending row exists" via createScrapeLog
      // and unique partial index idx_scrape_logs_single_pending
      let initialLog: ScrapeLog;
      try {
        if (product.isCurrentlyRunning) {
          throw new AppError(
            'A scrape is already in progress for this product',
            409,
            'SCRAPE_ALREADY_IN_PROGRESS',
          );
        }

        initialLog = await createScrapeLog({
          product_id: id,
          trigger_source: 'manual',
          strategy_used: 'headless',
        });
      } catch (err) {
        releaseProductScrapeLock(id);
        throw err;
      }

      // 3. Fire-and-forget background scrape: explicit try/catch, never unhandled
      void (async () => {
        try {
          logger.info({ productId: id, triggerSource: 'manual' }, 'Launching manual background scrape');
          await scrapeProduct(product, { triggerSource: 'manual', initialLog });
        } catch (err: unknown) {
          logger.error(
            {
              productId: id,
              triggerSource: 'manual',
              err: err instanceof Error ? err.message : String(err),
            },
            'Unhandled error caught during manual background scrape execution',
          );
        } finally {
          releaseProductScrapeLock(id);
        }
      })();

      res.status(202).json({
        message: 'Scrape triggered successfully',
        productId: id,
        isCurrentlyRunning: true,
      });
    } catch (err) {
      next(err);
    }
  },
);
