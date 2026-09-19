/**
 * Frontend Type Definitions
 * Typed contracts matching the Express / Supabase backend exactly. Zero `any`.
 */

export type ScrapeOutcome =
  | 'pending'
  | 'success'
  | 'success_after_retry'
  | 'failed'
  | 'abandoned';

export type TriggerSource =
  | 'cron'
  | 'manual'
  | 'catchup'
  | 'headed'
  | 'initial'
  | 'github-actions';

export type StrategyUsed = 'http' | 'headless';

export type ErrorType =
  | 'timeout'
  | 'http_error'
  | 'parse_error'
  | 'validation_error'
  | 'structure_changed'
  | 'abandoned';

/**
 * Tier 1 Store Catalogue Search Result
 * CRITICAL ARCHITECTURAL CONTRACT:
 * Strictly NO price field. Price does NOT exist in Tier 1 catalogue and is only
 * determined after a product is tracked and its first Tier 2 scrape completes.
 */
export interface StoreProductSearchResult {
  storeProductId: string;
  name: string;
  url: string;
  imageUrl: string | null;
  category: string | null;
  brand: string | null;
  sku: string | null;
}

export interface PriceChange24h {
  diffCents: number;
  percentage: number;
}

export interface TrackedProduct {
  id: string;
  store_product_id: string | null;
  product_url: string;
  name: string;
  image_url: string | null;
  category: string | null;
  sku: string | null;
  scrape_interval_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  lastCompletedOutcome: ScrapeOutcome | null;
  isCurrentlyRunning: boolean;
  lastScrapedAt: string | null;
  latestPriceCents: number | null;
  latestInStock: boolean | null;
  priceChange24h?: PriceChange24h | null;
  lastErrorType?: string | null;
  lastErrorMessage?: string | null;
  lastAttempts?: number | null;
  structureChanged?: boolean;
}

export interface AttemptDetail {
  attempt: number;
  strategy: string;
  status: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface ScrapeLog {
  id: string;
  product_id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  outcome: ScrapeOutcome;
  attempts: number;
  strategy_used: string | null;
  http_status: number | null;
  error_type: string | null;
  error_message: string | null;
  attempt_details: AttemptDetail[];
  price_cents: number | null;
  in_stock: boolean | null;
  trigger_source: TriggerSource;
}

export interface PriceHistory {
  id: number;
  product_id: string;
  price_cents: number;
  currency: string;
  in_stock: boolean;
  stock_text: string | null;
  scraped_at: string;
  scrape_run_id: string | null;
}

export interface CreateProductInput {
  productUrl: string;
  name: string;
  scrapeIntervalMinutes?: number;
}

export interface UpdateProductInput {
  name?: string;
  scrapeIntervalMinutes?: number;
  isActive?: boolean;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  version: string;
  dbConnected: boolean;
  timestamp: string;
}

export interface ApiError {
  code?: string;
  message: string;
  statusCode: number;
  correlationId?: string;
  details?: unknown;
}
