/**
 * Supabase / PostgreSQL Schema Types
 * Strongly-typed database entities, enums, inputs, and composite queries.
 * Mirrors backend/migrations/001_init.sql with ZERO `any`.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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

export type CronRunStatus = 'running' | 'completed' | 'failed';

export type CronRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: CronRunStatus;
  trigger_source: TriggerSource;
  attempted: number;
  succeeded: number;
  retried: number;
  failed: number;
  reconciled: number;
  duration_ms: number | null;
  error_message: string | null;
};

export type StrategyUsed = 'http' | 'headless';

export type ErrorType =
  | 'timeout'
  | 'http_error'
  | 'parse_error'
  | 'validation_error'
  | 'structure_changed'
  | 'abandoned';

export type AlertType = 'price_drop' | 'back_in_stock';

export type AttemptDetail = {
  attempt: number;
  strategy: string;
  status: number | null;
  durationMs: number | null;
  error: string | null;
};

export type TrackedProduct = {
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
};

export type ScrapeLog = {
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
};

export type PriceHistory = {
  id: number;
  product_id: string;
  price_cents: number;
  currency: string;
  in_stock: boolean;
  stock_text: string | null;
  scraped_at: string;
  scrape_run_id: string | null;
};

export type StructureSnapshot = {
  id: string;
  product_id: string;
  selector_fingerprint: string;
  observed_at: string;
  changed: boolean;
  notes: string | null;
};

export type Alert = {
  id: string;
  product_id: string;
  type: AlertType;
  old_value: string | null;
  new_value: string | null;
  triggered_at: string;
  delivered: boolean;
  channel: string;
};

/**
 * Composite view model for tracked products with runtime scraping status
 */
export type TrackedProductWithStatus = TrackedProduct & {
  /**
   * The outcome of the most recent COMPLETED scrape ('success' | 'success_after_retry' | 'failed' | 'abandoned').
   * Guaranteed to be null if no run has completed yet. Never reports 'pending'.
   */
  lastCompletedOutcome: ScrapeOutcome | null;
  /**
   * True if there is currently a scrape log with outcome = 'pending'.
   */
  isCurrentlyRunning: boolean;
  /**
   * Timestamp of the most recent completed scrape.
   */
  lastScrapedAt: string | null;
  /**
   * Latest recorded price in cents from price_history.
   */
  latestPriceCents: number | null;
  /**
   * Latest recorded in-stock flag from price_history.
   */
  latestInStock: boolean | null;
  lastErrorType?: string | null;
  lastErrorMessage?: string | null;
  lastAttempts?: number | null;
  structureChanged?: boolean;
};

// -----------------------------------------------------------------------------
// Repository Inputs
// -----------------------------------------------------------------------------

export type CreateTrackedProductInput = {
  product_url: string;
  name: string;
  store_product_id?: string | null;
  image_url?: string | null;
  category?: string | null;
  sku?: string | null;
  scrape_interval_minutes?: number;
  is_active?: boolean;
};

export type UpdateTrackedProductInput = {
  name?: string;
  store_product_id?: string | null;
  image_url?: string | null;
  category?: string | null;
  sku?: string | null;
  scrape_interval_minutes?: number;
  is_active?: boolean;
};

export type InsertPriceHistoryInput = {
  product_id: string;
  price_cents: number;
  currency?: string;
  in_stock: boolean;
  stock_text?: string | null;
  scraped_at?: string;
  scrape_run_id?: string | null;
};

export type CreateScrapeLogInput = {
  id?: string;
  product_id: string;
  trigger_source?: TriggerSource;
  started_at?: string;
  attempts?: number;
  strategy_used?: string | null;
};

export type FinaliseScrapeLogInput = {
  outcome: Exclude<ScrapeOutcome, 'pending'>;
  finished_at?: string;
  duration_ms?: number;
  attempts?: number;
  strategy_used?: string | null;
  http_status?: number | null;
  error_type?: string | null;
  error_message?: string | null;
  attempt_details?: AttemptDetail[];
  price_cents?: number | null;
  in_stock?: boolean | null;
};

export type ReconcilePendingResult = {
  reconciledCount: number;
  reconciledIds: string[];
};

export type PriceHistoryRange = {
  from?: Date | string;
  to?: Date | string;
  limit?: number;
};

// -----------------------------------------------------------------------------
// Supabase Database Mapping
// -----------------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      tracked_products: {
        Row: TrackedProduct;
        Insert: {
          id?: string;
          store_product_id?: string | null;
          product_url: string;
          name: string;
          image_url?: string | null;
          category?: string | null;
          sku?: string | null;
          scrape_interval_minutes?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_product_id?: string | null;
          product_url?: string;
          name?: string;
          image_url?: string | null;
          category?: string | null;
          sku?: string | null;
          scrape_interval_minutes?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      scrape_logs: {
        Row: ScrapeLog;
        Insert: {
          id?: string;
          product_id: string;
          started_at?: string;
          finished_at?: string | null;
          duration_ms?: number | null;
          outcome?: ScrapeOutcome;
          attempts?: number;
          strategy_used?: string | null;
          http_status?: number | null;
          error_type?: string | null;
          error_message?: string | null;
          attempt_details?: AttemptDetail[] | Json;
          price_cents?: number | null;
          in_stock?: boolean | null;
          trigger_source?: TriggerSource;
        };
        Update: {
          id?: string;
          product_id?: string;
          started_at?: string;
          finished_at?: string | null;
          duration_ms?: number | null;
          outcome?: ScrapeOutcome;
          attempts?: number;
          strategy_used?: string | null;
          http_status?: number | null;
          error_type?: string | null;
          error_message?: string | null;
          attempt_details?: AttemptDetail[] | Json;
          price_cents?: number | null;
          in_stock?: boolean | null;
          trigger_source?: TriggerSource;
        };
        Relationships: [
          {
            foreignKeyName: 'scrape_logs_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'tracked_products';
            referencedColumns: ['id'];
          },
        ];
      };
      price_history: {
        Row: PriceHistory;
        Insert: {
          id?: number;
          product_id: string;
          price_cents: number;
          currency?: string;
          in_stock: boolean;
          stock_text?: string | null;
          scraped_at?: string;
          scrape_run_id?: string | null;
        };
        Update: {
          id?: number;
          product_id?: string;
          price_cents?: number;
          currency?: string;
          in_stock?: boolean;
          stock_text?: string | null;
          scraped_at?: string;
          scrape_run_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'price_history_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'tracked_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'price_history_scrape_run_id_fkey';
            columns: ['scrape_run_id'];
            isOneToOne: false;
            referencedRelation: 'scrape_logs';
            referencedColumns: ['id'];
          },
        ];
      };
      structure_snapshots: {
        Row: StructureSnapshot;
        Insert: {
          id?: string;
          product_id: string;
          selector_fingerprint: string;
          observed_at?: string;
          changed?: boolean;
          notes?: string | null;
        };
        Update: {
          id?: string;
          product_id?: string;
          selector_fingerprint?: string;
          observed_at?: string;
          changed?: boolean;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'structure_snapshots_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'tracked_products';
            referencedColumns: ['id'];
          },
        ];
      };
      alerts: {
        Row: Alert;
        Insert: {
          id?: string;
          product_id: string;
          type: AlertType;
          old_value?: string | null;
          new_value?: string | null;
          triggered_at?: string;
          delivered?: boolean;
          channel?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          type?: AlertType;
          old_value?: string | null;
          new_value?: string | null;
          triggered_at?: string;
          delivered?: boolean;
          channel?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'alerts_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'tracked_products';
            referencedColumns: ['id'];
          },
        ];
      };
      cron_runs: {
        Row: CronRun;
        Insert: {
          id?: string;
          started_at?: string;
          finished_at?: string | null;
          status?: CronRunStatus;
          trigger_source?: TriggerSource;
          attempted?: number;
          succeeded?: number;
          retried?: number;
          failed?: number;
          reconciled?: number;
          duration_ms?: number | null;
          error_message?: string | null;
        };
        Update: {
          id?: string;
          started_at?: string;
          finished_at?: string | null;
          status?: CronRunStatus;
          trigger_source?: TriggerSource;
          attempted?: number;
          succeeded?: number;
          retried?: number;
          failed?: number;
          reconciled?: number;
          duration_ms?: number | null;
          error_message?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      scrape_outcome: ScrapeOutcome;
      trigger_source: TriggerSource;
      alert_type: AlertType;
    };
    CompositeTypes: Record<string, never>;
  };
};
