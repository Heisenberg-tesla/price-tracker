import { env } from '../config/env';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { CatalogItem, CatalogSearchOptions, CatalogSearchResult } from './types';

/**
 * In-memory catalog cache storage
 */
let catalogCache: {
  items: CatalogItem[];
  cachedAt: number;
} | null = null;

let isFetchingCatalog = false;
let pendingFetchPromise: Promise<CatalogItem[]> | null = null;

/**
 * Sleep helper for retry backoff
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RawCatalogPageResponse {
  page: number;
  pageSize: number;
  pages: number;
  total: number;
  items: Array<{
    id: number;
    slug?: string;
    name: string;
    brand: string;
    category: string;
    sku: string;
    description?: string;
  }>;
}

/**
 * Fetches a single page from /api/catalog with exponential retry backoff.
 */
async function fetchCatalogPage(
  baseUrl: string,
  page: number,
  pageSize = 60,
  maxRetries = 3,
): Promise<RawCatalogPageResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/catalog?page=${page}&pageSize=${pageSize}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'PriceTrackerCatalog/1.0',
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as RawCatalogPageResponse;
      return data;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { page, attempt, maxRetries, error: errMsg },
        'Failed to fetch catalog page, retrying with backoff...',
      );

      if (attempt === maxRetries) {
        throw new AppError(
          `Failed to fetch catalog page ${page} after ${maxRetries} attempts: ${errMsg}`,
          502,
          'CATALOG_FETCH_ERROR',
        );
      }

      // Exponential backoff with jitter: 300ms, 600ms, 1200ms + random
      const backoffMs = Math.pow(2, attempt) * 150 + Math.random() * 100;
      await delay(backoffMs);
    }
  }

  throw new AppError(`Catalog fetch failed unexpectedly for page ${page}`, 500, 'CATALOG_ERROR');
}

/**
 * Fetches the entire 1,000-item catalog across all pages and caches it in-memory.
 * Refreshes automatically once TTL expires.
 *
 * Notice: Catalog items strictly contain NO price data. Price is only available via Tier 2.
 */
export async function fetchCatalog(forceRefresh = false): Promise<CatalogItem[]> {
  const now = Date.now();

  // Return cached items if valid and not force-refreshing
  if (!forceRefresh && catalogCache && now - catalogCache.cachedAt < env.CATALOG_CACHE_TTL_MS) {
    return catalogCache.items;
  }

  // Prevent redundant concurrent fetches
  if (isFetchingCatalog && pendingFetchPromise) {
    return pendingFetchPromise;
  }

  isFetchingCatalog = true;
  pendingFetchPromise = (async () => {
    try {
      const baseUrl = env.STORE_BASE_URL;
      logger.info({ baseUrl }, 'Starting full catalog ingestion across all pages...');

      // 1. Fetch page 1 to determine total pages
      const firstPage = await fetchCatalogPage(baseUrl, 1, 60);
      const totalPages = firstPage.pages || 1;
      const allRawItems = [...(firstPage.items || [])];

      logger.info(
        { totalItems: firstPage.total, totalPages, pageSize: firstPage.pageSize },
        'Catalog metadata received, fetching remaining pages...',
      );

      // 2. Fetch pages 2..totalPages sequentially or in small batches to respect rate limits
      for (let p = 2; p <= totalPages; p++) {
        const pageData = await fetchCatalogPage(baseUrl, p, 60);
        if (pageData.items && pageData.items.length > 0) {
          allRawItems.push(...pageData.items);
        }
        // Small delay between page requests to avoid hitting rate limits
        await delay(50);
      }

      // 3. Map to clean CatalogItem domain model (omitting price)
      const mappedItems: CatalogItem[] = allRawItems.map((item) => ({
        id: item.id,
        name: item.name,
        brand: item.brand,
        sku: item.sku,
        category: item.category,
        rating: 0,
        reviewsCount: 0,
        inStock: true, // Default placeholder, actual stock verified in Tier 2
        image: `${baseUrl}/images/${item.slug || item.id}.jpg`,
        url: `${baseUrl}/product/${item.id}`,
        description: item.description,
      }));

      // 4. Update in-memory cache
      catalogCache = {
        items: mappedItems,
        cachedAt: Date.now(),
      };

      logger.info(
        { itemCount: mappedItems.length, ttlMs: env.CATALOG_CACHE_TTL_MS },
        'Full catalog successfully cached in-memory',
      );

      return mappedItems;
    } catch (err) {
      logger.error({ error: err }, 'Failed to ingest full catalog');
      // If we have stale cache, we can return it as fallback rather than failing completely
      if (catalogCache && catalogCache.items.length > 0) {
        logger.warn('Returning stale in-memory catalog cache due to fetch error');
        return catalogCache.items;
      }
      throw err;
    } finally {
      isFetchingCatalog = false;
      pendingFetchPromise = null;
    }
  })();

  return pendingFetchPromise;
}

/**
 * Searches the cached catalog locally in-memory.
 * Case-insensitive substring match across name, brand, sku, and category.
 * Zero network calls per keystroke.
 * Search results strictly DO NOT include price.
 */
export async function searchCatalog(
  options: CatalogSearchOptions = {},
): Promise<CatalogSearchResult> {
  const items = await fetchCatalog();

  const query = options.query?.trim().toLowerCase() || '';
  const category = options.category?.trim().toLowerCase();
  const brand = options.brand?.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (category && item.category.toLowerCase() !== category) {
      return false;
    }
    if (brand && item.brand.toLowerCase() !== brand) {
      return false;
    }
    if (!query) {
      return true;
    }

    // Substring match on name, brand, sku, category
    return (
      item.name.toLowerCase().includes(query) ||
      item.brand.toLowerCase().includes(query) ||
      item.sku.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query)
    );
  });

  const offset = Math.max(0, options.offset || 0);
  const limit = Math.max(1, Math.min(100, options.limit || 20));
  const paged = filtered.slice(offset, offset + limit);

  return {
    items: paged,
    total: filtered.length,
    offset,
    limit,
  };
}

/**
 * Lazily enriches product metadata from /api/product/:id when a product is tracked.
 * Never called for every search result.
 */
export async function fetchProductDetails(
  id: number | string,
): Promise<Record<string, unknown> | null> {
  const baseUrl = env.STORE_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/api/product/${id}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'PriceTrackerCatalog/1.0',
      },
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    logger.warn({ id, error: err }, 'Failed to fetch lazy product details');
    return null;
  }
}

/**
 * Resets the in-memory catalog cache (useful for testing).
 */
export function resetCatalogCache(): void {
  catalogCache = null;
  isFetchingCatalog = false;
  pendingFetchPromise = null;
}
