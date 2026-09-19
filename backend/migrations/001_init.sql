-- =============================================================================
-- Migration: 001_init.sql
-- Description: Core schema for Price Tracker (Supabase / PostgreSQL)
-- Tables: tracked_products, scrape_logs, price_history, structure_snapshots, alerts
-- =============================================================================

-- Enable pgcrypto for gen_random_uuid() if not already available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. TRACKED PRODUCTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS tracked_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_product_id TEXT NULL,
    product_url TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    image_url TEXT NULL,
    category TEXT NULL,
    sku TEXT NULL,
    scrape_interval_minutes INT NOT NULL DEFAULT 120,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for filtering active products during cron schedule evaluation
CREATE INDEX IF NOT EXISTS idx_tracked_products_is_active 
    ON tracked_products (is_active);

-- Automatic updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tracked_products_updated_at ON tracked_products;
CREATE TRIGGER trg_tracked_products_updated_at
    BEFORE UPDATE ON tracked_products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. SCRAPE LOGS
-- Created before price_history so price_history can reference scrape_logs(id)
-- =============================================================================
CREATE TABLE IF NOT EXISTS scrape_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ NULL,
    duration_ms INT NULL,
    outcome TEXT NOT NULL DEFAULT 'pending'
        CHECK (outcome IN ('pending', 'success', 'success_after_retry', 'failed', 'abandoned')),
    attempts INT NOT NULL DEFAULT 0,
    strategy_used TEXT NULL,
    http_status INT NULL,
    error_type TEXT NULL,
    error_message TEXT NULL,
    attempt_details JSONB NOT NULL DEFAULT '[]'::jsonb,
    price_cents BIGINT NULL,
    in_stock BOOLEAN NULL,
    trigger_source TEXT NOT NULL DEFAULT 'cron'
        CHECK (trigger_source IN ('cron', 'manual', 'catchup', 'headed', 'initial', 'github-actions')),
    -- Data-integrity constraint: terminal outcomes MUST record finished_at
    CONSTRAINT check_scrape_logs_terminal_finished 
        CHECK (outcome = 'pending' OR finished_at IS NOT NULL)
);

-- Index for querying product scrape history in chronological order
CREATE INDEX IF NOT EXISTS idx_scrape_logs_product_started 
    ON scrape_logs (product_id, started_at DESC);

-- Partial index for high-efficiency stale pending reconciliation sweeps
CREATE INDEX IF NOT EXISTS idx_scrape_logs_pending 
    ON scrape_logs (started_at) 
    WHERE outcome = 'pending';

-- Atomic concurrency constraint: guarantees at the DB engine level that no two concurrent
-- scrapes can ever be in 'pending' status for the same product at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scrape_logs_single_pending 
    ON scrape_logs (product_id) 
    WHERE outcome = 'pending';

-- =============================================================================
-- 3. PRICE HISTORY
-- Inserted ONLY on a fully successful scrape with a validated price (> 0)
-- =============================================================================
CREATE TABLE IF NOT EXISTS price_history (
    id BIGSERIAL PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
    price_cents BIGINT NOT NULL CHECK (price_cents > 0), -- Money as integer cents, strictly > 0
    currency TEXT NOT NULL DEFAULT 'USD',
    in_stock BOOLEAN NOT NULL,
    stock_text TEXT NULL,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    scrape_run_id UUID NULL REFERENCES scrape_logs(id) ON DELETE SET NULL
);

-- Composite index for rapid historical price series lookups
CREATE INDEX IF NOT EXISTS idx_price_history_product_scraped 
    ON price_history (product_id, scraped_at DESC);

-- =============================================================================
-- 4. STRUCTURE SNAPSHOTS (Bonus: Change Detection)
-- =============================================================================
CREATE TABLE IF NOT EXISTS structure_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
    selector_fingerprint TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed BOOLEAN NOT NULL DEFAULT false,
    notes TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_structure_snapshots_product_observed 
    ON structure_snapshots (product_id, observed_at DESC);

-- =============================================================================
-- 5. ALERTS (Bonus: Notifications)
-- =============================================================================
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('price_drop', 'back_in_stock')),
    old_value TEXT NULL,
    new_value TEXT NULL,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered BOOLEAN NOT NULL DEFAULT false,
    channel TEXT NOT NULL DEFAULT 'email'
);

CREATE INDEX IF NOT EXISTS idx_alerts_product_triggered 
    ON alerts (product_id, triggered_at DESC);

-- =============================================================================
-- 6. CRON RUNS & IDEMPOTENCY LOCKS
-- Tracks external and backup cron executions and enforces single-runner concurrency.
-- =============================================================================
CREATE TABLE IF NOT EXISTS cron_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
    trigger_source TEXT NOT NULL DEFAULT 'cron'
        CHECK (trigger_source IN ('cron', 'github-actions', 'manual', 'catchup')),
    attempted INT NOT NULL DEFAULT 0,
    succeeded INT NOT NULL DEFAULT 0,
    retried INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    reconciled INT NOT NULL DEFAULT 0,
    duration_ms INT NULL,
    error_message TEXT NULL
);

-- Index for querying cron run history in chronological order
CREATE INDEX IF NOT EXISTS idx_cron_runs_started 
    ON cron_runs (started_at DESC);

-- Concurrency lock: guarantees at the DB engine level that AT MOST ONE active 'running'
-- cron run can exist at any given moment across any number of instances.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_runs_single_running 
    ON cron_runs (status) 
    WHERE status = 'running';

-- =============================================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Enable RLS on all tables to lock down direct anon/public access via REST API.
--
-- ARCHITECTURE & SECURITY CONTRACT:
-- The Node.js Express backend communicates with Supabase strictly using the
-- `SUPABASE_SERVICE_ROLE_KEY` server-side. In PostgreSQL / Supabase, the
-- service_role key automatically bypasses all RLS policies.
--
-- The service_role key MUST NEVER be shipped to the frontend or exposed to users.
-- The frontend communicates exclusively through the authenticated Express API.
ALTER TABLE tracked_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
