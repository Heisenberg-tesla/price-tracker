import { api } from './client';
import {
  TrackedProduct,
  CreateProductInput,
  UpdateProductInput,
  PriceHistory,
  ScrapeLog,
  StoreProductSearchResult,
} from '../types';

/**
 * Searches the target store's catalogue (Tier 1).
 * CONTRACT: Strictly NO price field.
 */
export async function searchStoreCatalog(
  query: string,
): Promise<StoreProductSearchResult[]> {
  if (!query.trim()) return [];
  return api.get<StoreProductSearchResult[]>('/store/search', {
    params: { q: query.trim() },
  });
}

/**
 * Retrieves all tracked products with runtime status and 24h price changes.
 */
export async function listProducts(): Promise<TrackedProduct[]> {
  return api.get<TrackedProduct[]>('/products');
}

/**
 * Retrieves a single tracked product by ID with full runtime status.
 */
export async function getProduct(id: string): Promise<TrackedProduct> {
  return api.get<TrackedProduct>(`/products/${id}`);
}

/**
 * Adds a new product to be tracked and dispatches initial background scrape.
 */
export async function createProduct(
  input: CreateProductInput,
): Promise<TrackedProduct> {
  return api.post<TrackedProduct>('/products', input);
}

/**
 * Updates an existing tracked product's configuration (name, interval, isActive).
 */
export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<TrackedProduct> {
  return api.patch<TrackedProduct>(`/products/${id}`, input);
}

/**
 * Deletes a tracked product and cascades deletion to history and logs.
 */
export async function deleteProduct(id: string): Promise<void> {
  return api.delete<void>(`/products/${id}`);
}

/**
 * Fetches price history points for charting, ordered chronologically ascending.
 */
export async function getProductHistory(
  id: string,
  range: '24h' | '7d' | '30d' | 'all' = 'all',
): Promise<PriceHistory[]> {
  return api.get<PriceHistory[]>(`/products/${id}/history`, {
    params: { range },
  });
}

/**
 * Fetches recent scrape execution logs ordered newest first.
 */
export async function getProductLogs(
  id: string,
  limit = 50,
): Promise<ScrapeLog[]> {
  return api.get<ScrapeLog[]>(`/products/${id}/logs`, {
    params: { limit },
  });
}

/**
 * Triggers an immediate on-demand scrape for a product.
 * Returns 202 Accepted on success, or 409 Conflict if already running.
 */
export async function triggerProductScrape(
  id: string,
): Promise<{ message: string; productId: string; isCurrentlyRunning: boolean }> {
  return api.post<{ message: string; productId: string; isCurrentlyRunning: boolean }>(
    `/products/${id}/scrape`,
  );
}
