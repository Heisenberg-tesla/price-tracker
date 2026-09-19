import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { searchCatalog } from '../scraper/catalog';
import { validateRequest } from '../middleware/validate';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export const storeRouter = Router();

const searchSchema = {
  query: z.object({
    q: z
      .string({ required_error: 'Query parameter "q" is required' })
      .trim()
      .min(1, 'Search query "q" must not be empty'),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
  }),
};

export interface StoreSearchResultItem {
  storeProductId: string;
  name: string;
  url: string;
  imageUrl: string;
  category: string;
  brand: string;
  sku: string;
}

/**
 * GET /api/store/search?q=<partial or full name>
 *
 * Tier 1 HTTP-only catalogue search:
 * - Searches local in-memory catalog cache (name, brand, sku, category)
 * - Returns metadata strictly WITHOUT price
 * - Returns clean 503 if catalog is unreachable or failed
 */
storeRouter.get(
  '/search',
  validateRequest(searchSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = String(req.query.q || '');
      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;

      logger.debug({ q, limit, offset }, 'Executing store catalog search');

      let searchResult;
      try {
        searchResult = await searchCatalog({
          query: q,
          limit,
          offset,
        });
      } catch (err: unknown) {
        logger.error({ error: err, q }, 'Store catalog search failed due to ingestion failure');
        throw new AppError(
          'Store catalog is currently unavailable. Please try again later.',
          503,
          'CATALOG_UNAVAILABLE',
        );
      }

      // Map to strict frontend contract: NO price field
      const mapped: StoreSearchResultItem[] = searchResult.items.map((item) => ({
        storeProductId: String(item.id),
        name: item.name,
        url: item.url,
        imageUrl: item.image,
        category: item.category,
        brand: item.brand,
        sku: item.sku,
      }));

      res.status(200).json(mapped);
    } catch (err) {
      next(err);
    }
  },
);
