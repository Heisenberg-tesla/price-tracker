import { TriggerSource, ErrorType, ScrapeOutcome, AttemptDetail, ScrapeLog, PriceHistory } from '../types/database';

/**
 * Catalog item represented in Tier 1 in-memory cache and search.
 * Strictly excludes price — price is not available from /api/catalog.
 */
export interface CatalogItem {
  id: number;
  name: string;
  brand: string;
  sku: string;
  category: string;
  rating: number;
  reviewsCount: number;
  inStock: boolean;
  image: string;
  url: string;
  description?: string;
}

/**
 * Options for local in-memory catalog search.
 */
export interface CatalogSearchOptions {
  query?: string;
  category?: string;
  brand?: string;
  limit?: number;
  offset?: number;
}

/**
 * Result of local in-memory catalog search.
 */
export interface CatalogSearchResult {
  items: CatalogItem[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Fully extracted and normalized price data from Tier 2 browser extraction.
 */
export interface ScrapedPriceData {
  priceCents: number;
  currency: string;
  inStock: boolean;
  stockText: string;
  mrpCents?: number;
  badgeText?: string;
  rawPriceText: string;
  honeypotValuesSeen: number[];
  productName: string;
  selectorFingerprint: string;
}

/**
 * Sub-steps in the Tier 2 realistic reveal sequence.
 */
export type RevealSubStep =
  | 'navigate'
  | 'wait_base_page'
  | 'check_not_found'
  | 'hover_dwell'
  | 'wait_button_enabled'
  | 'click_reveal'
  | 'wait_terminal_state'
  | 'extract_dom'
  | 'validate';

/**
 * Detail for a single attempt during product scraping.
 */
export interface ScrapeAttemptResult {
  attempt: number;
  success: boolean;
  data?: ScrapedPriceData;
  error?: string;
  errorType?: ErrorType;
  durationMs: number;
  revealSubStepFailed?: RevealSubStep;
}

export type SimulationMode = 'none' | 'slow' | 'error' | 'missing';

export interface StepProgressEvent {
  attempt: number;
  maxAttempts: number;
  phase: string;
  detail?: string;
  durationMs?: number;
  status?: 'info' | 'success' | 'warn' | 'error';
}

/**
 * Options for single product scrape orchestration.
 */
export interface ScrapeProductOptions {
  maxAttempts?: number;
  triggerSource?: TriggerSource;
  headless?: boolean;
  retryDelayMs?: number;
  initialLog?: ScrapeLog;
  slowMo?: number;
  devtools?: boolean;
  simulate?: SimulationMode;
  onStepProgress?: (event: StepProgressEvent) => void;
  onBackoffCountdown?: (secondsRemaining: number, totalSeconds: number) => void;
}

/**
 * Terminal result returned by scrapeProduct.
 */
export interface ScrapeProductResult {
  log: ScrapeLog;
  priceRecord?: PriceHistory;
  outcome: ScrapeOutcome;
  attempts: number;
  attemptDetails: AttemptDetail[];
}
