import { getSupabaseClient } from './client';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import {
  TrackedProduct,
  TrackedProductWithStatus,
  PriceHistory,
  ScrapeLog,
  CreateTrackedProductInput,
  UpdateTrackedProductInput,
  InsertPriceHistoryInput,
  CreateScrapeLogInput,
  FinaliseScrapeLogInput,
  ReconcilePendingResult,
  PriceHistoryRange,
  ScrapeOutcome,
  TriggerSource,
  Database,
} from '../types/database';

// -----------------------------------------------------------------------------
// 1. Tracked Products
// -----------------------------------------------------------------------------

/**
 * Creates a new tracked product record in Supabase.
 */
export async function createTrackedProduct(
  input: CreateTrackedProductInput,
): Promise<TrackedProduct> {
  const supabase = getSupabaseClient();

  if (!input.product_url || !input.name) {
    throw new AppError('product_url and name are required', 400, 'VALIDATION_ERROR');
  }

  const insertPayload: Database['public']['Tables']['tracked_products']['Insert'] = {
    product_url: input.product_url.trim(),
    name: input.name.trim(),
    store_product_id: input.store_product_id ?? null,
    image_url: input.image_url ?? null,
    category: input.category ?? null,
    sku: input.sku ?? null,
    scrape_interval_minutes: input.scrape_interval_minutes ?? 120,
    is_active: input.is_active ?? true,
  };

  const { data, error } = await supabase
    .from('tracked_products')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    logger.error({ error, input }, 'Failed to create tracked product in database');
    if (error.code === '23505') {
      throw new AppError(
        `Product with URL "${input.product_url}" is already being tracked`,
        409,
        'DUPLICATE_URL',
      );
    }
    throw new AppError(`Failed to create product: ${error.message}`, 500, 'DB_ERROR');
  }

  return data;
}

/**
 * Lists all tracked products enriched with their runtime scraping status.
 *
 * Requirements:
 * - isCurrentlyRunning: true if there exists a scrape_log with outcome = 'pending'.
 * - lastCompletedOutcome: the outcome of the most recent COMPLETED scrape ('success', 'success_after_retry', 'failed', 'abandoned').
 * - Never treats a pending row as a success, and never lets a pending row suppress the last completed scrape.
 */
export async function listTrackedProducts(): Promise<TrackedProductWithStatus[]> {
  const supabase = getSupabaseClient();

  // 1. Fetch all products
  const { data: products, error: prodErr } = await supabase
    .from('tracked_products')
    .select('*')
    .order('created_at', { ascending: false });

  if (prodErr) {
    logger.error({ error: prodErr }, 'Failed to list tracked products');
    throw new AppError(`Failed to fetch tracked products: ${prodErr.message}`, 500, 'DB_ERROR');
  }

  if (!products || products.length === 0) {
    return [];
  }

  const productIds = products.map((p) => p.id);

  // 2. Fetch recent scrape logs for all these products
  const { data: logs, error: logsErr } = await supabase
    .from('scrape_logs')
    .select('*')
    .in('product_id', productIds)
    .order('started_at', { ascending: false });

  if (logsErr) {
    logger.error({ error: logsErr }, 'Failed to fetch scrape logs for product listing');
    throw new AppError(`Failed to fetch scrape status: ${logsErr.message}`, 500, 'DB_ERROR');
  }

  // 3. Fetch latest price history records for all these products
  const { data: prices, error: pricesErr } = await supabase
    .from('price_history')
    .select('*')
    .in('product_id', productIds)
    .order('scraped_at', { ascending: false });

  if (pricesErr) {
    logger.error({ error: pricesErr }, 'Failed to fetch price history for product listing');
    throw new AppError(`Failed to fetch price history: ${pricesErr.message}`, 500, 'DB_ERROR');
  }

  // Group logs and prices by product_id
  const logsByProduct = new Map<string, ScrapeLog[]>();
  for (const log of (logs || []) as ScrapeLog[]) {
    const list = logsByProduct.get(log.product_id) || [];
    list.push(log);
    logsByProduct.set(log.product_id, list);
  }

  const pricesByProduct = new Map<string, PriceHistory>();
  for (const price of (prices || []) as PriceHistory[]) {
    // First one encountered is the latest because of ORDER BY scraped_at DESC
    if (!pricesByProduct.has(price.product_id)) {
      pricesByProduct.set(price.product_id, price);
    }
  }

  // 4. Fetch latest structure snapshots for all these products
  const { data: snapshots } = await supabase
    .from('structure_snapshots')
    .select('product_id, changed')
    .in('product_id', productIds)
    .order('observed_at', { ascending: false });

  const latestSnapshotChanged = new Map<string, boolean>();
  for (const snap of (snapshots || []) as Array<{ product_id: string; changed: boolean }>) {
    if (!latestSnapshotChanged.has(snap.product_id)) {
      latestSnapshotChanged.set(snap.product_id, snap.changed);
    }
  }

  // Combine into TrackedProductWithStatus
  return (products as TrackedProduct[]).map((product) => {
    const productLogs = logsByProduct.get(product.id) || [];
    const latestPrice = pricesByProduct.get(product.id);

    const isCurrentlyRunning = productLogs.some((l) => l.outcome === 'pending');
    const lastCompletedLog = productLogs.find((l) => l.outcome !== 'pending');

    return {
      ...product,
      lastCompletedOutcome: lastCompletedLog ? lastCompletedLog.outcome : null,
      isCurrentlyRunning,
      lastScrapedAt: lastCompletedLog
        ? lastCompletedLog.finished_at || lastCompletedLog.started_at
        : null,
      latestPriceCents: latestPrice ? latestPrice.price_cents : null,
      latestInStock: latestPrice ? latestPrice.in_stock : null,
      lastErrorType: lastCompletedLog ? lastCompletedLog.error_type : null,
      lastErrorMessage: lastCompletedLog ? lastCompletedLog.error_message : null,
      lastAttempts: lastCompletedLog ? lastCompletedLog.attempts : null,
      structureChanged:
        latestSnapshotChanged.get(product.id) === true ||
        lastCompletedLog?.error_type === 'structure_changed' ||
        false,
    };
  });
}

export interface PriceChange24h {
  diffCents: number;
  percentage: number;
}

export type TrackedProductWithStats = TrackedProductWithStatus & {
  priceChange24h: PriceChange24h | null;
};

/**
 * Computes priceChange24h for a product.
 * Compares current price with the closest historical price point around ~24h ago.
 * Returns null if insufficient history.
 */
export async function getPriceChange24h(
  productId: string,
  currentPriceCents: number | null,
): Promise<PriceChange24h | null> {
  if (currentPriceCents === null || currentPriceCents <= 0) {
    return null;
  }

  const supabase = getSupabaseClient();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Find latest price record at or before 24h ago
  const { data: pastRecord, error } = await supabase
    .from('price_history')
    .select('price_cents, scraped_at')
    .eq('product_id', productId)
    .lte('scraped_at', twentyFourHoursAgo)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !pastRecord || !pastRecord.price_cents) {
    return null;
  }

  const pastPrice = pastRecord.price_cents;
  const diffCents = currentPriceCents - pastPrice;
  const percentage = Math.round(((diffCents / pastPrice) * 100) * 100) / 100;

  return {
    diffCents,
    percentage,
  };
}

/**
 * Lists all tracked products enriched with runtime status and 24h price changes.
 */
export async function listTrackedProductsWithStats(): Promise<TrackedProductWithStats[]> {
  const products = await listTrackedProducts();
  return Promise.all(
    products.map(async (product) => {
      const priceChange24h = await getPriceChange24h(product.id, product.latestPriceCents);
      return {
        ...product,
        priceChange24h,
      };
    }),
  );
}

/**
 * Gets a single tracked product with its full runtime scraping status.
 */
export async function getProduct(id: string): Promise<TrackedProductWithStatus | null> {
  const supabase = getSupabaseClient();

  const { data: product, error: prodErr } = await supabase
    .from('tracked_products')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (prodErr) {
    logger.error({ error: prodErr, id }, 'Failed to fetch product by id');
    throw new AppError(`Failed to fetch product: ${prodErr.message}`, 500, 'DB_ERROR');
  }

  if (!product) {
    return null;
  }

  // Fetch recent scrape logs for status evaluation
  const { data: logs, error: logsErr } = await supabase
    .from('scrape_logs')
    .select('*')
    .eq('product_id', id)
    .order('started_at', { ascending: false });

  if (logsErr) {
    logger.error({ error: logsErr, id }, 'Failed to fetch scrape logs for product');
    throw new AppError(`Failed to fetch product status: ${logsErr.message}`, 500, 'DB_ERROR');
  }

  // Fetch latest price entry
  const { data: latestPrice, error: priceErr } = await supabase
    .from('price_history')
    .select('*')
    .eq('product_id', id)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priceErr) {
    logger.error({ error: priceErr, id }, 'Failed to fetch latest price for product');
    throw new AppError(`Failed to fetch product price: ${priceErr.message}`, 500, 'DB_ERROR');
  }

  const typedLogs = (logs || []) as ScrapeLog[];
  const isCurrentlyRunning = typedLogs.some((l) => l.outcome === 'pending');
  const lastCompletedLog = typedLogs.find((l) => l.outcome !== 'pending');

  // Fetch latest structure snapshot to check if DOM changed on latest scrape
  const { data: latestSnapshot } = await supabase
    .from('structure_snapshots')
    .select('changed')
    .eq('product_id', id)
    .order('observed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    ...(product as TrackedProduct),
    lastCompletedOutcome: lastCompletedLog ? lastCompletedLog.outcome : null,
    isCurrentlyRunning,
    lastScrapedAt: lastCompletedLog
      ? lastCompletedLog.finished_at || lastCompletedLog.started_at
      : null,
    latestPriceCents: latestPrice ? (latestPrice as PriceHistory).price_cents : null,
    latestInStock: latestPrice ? (latestPrice as PriceHistory).in_stock : null,
    lastErrorType: lastCompletedLog ? lastCompletedLog.error_type : null,
    lastErrorMessage: lastCompletedLog ? lastCompletedLog.error_message : null,
    lastAttempts: lastCompletedLog ? lastCompletedLog.attempts : null,
    structureChanged:
      latestSnapshot?.changed === true ||
      lastCompletedLog?.error_type === 'structure_changed' ||
      false,
  };
}

/**
 * Updates an existing tracked product.
 */
export async function updateProduct(
  id: string,
  input: UpdateTrackedProductInput,
): Promise<TrackedProduct> {
  const supabase = getSupabaseClient();

  const updatePayload: Database['public']['Tables']['tracked_products']['Update'] = {};
  if (input.name !== undefined) updatePayload.name = input.name.trim();
  if (input.store_product_id !== undefined) updatePayload.store_product_id = input.store_product_id;
  if (input.image_url !== undefined) updatePayload.image_url = input.image_url;
  if (input.category !== undefined) updatePayload.category = input.category;
  if (input.sku !== undefined) updatePayload.sku = input.sku;
  if (input.scrape_interval_minutes !== undefined)
    updatePayload.scrape_interval_minutes = input.scrape_interval_minutes;
  if (input.is_active !== undefined) updatePayload.is_active = input.is_active;

  const { data, error } = await supabase
    .from('tracked_products')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error({ error, id, input }, 'Failed to update tracked product');
    throw new AppError(`Failed to update product: ${error.message}`, 500, 'DB_ERROR');
  }

  return data;
}

/**
 * Deletes a tracked product and cascades deletion to associated logs and price history.
 */
export async function deleteProduct(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { error, count } = await supabase
    .from('tracked_products')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) {
    logger.error({ error, id }, 'Failed to delete tracked product');
    throw new AppError(`Failed to delete product: ${error.message}`, 500, 'DB_ERROR');
  }

  return (count ?? 0) > 0;
}

// -----------------------------------------------------------------------------
// 2. Price History
// -----------------------------------------------------------------------------

/**
 * Inserts a validated price record into price_history.
 *
 * CRITICAL CONSTRAINT:
 * - A row is inserted here ONLY on a fully successful scrape with a validated price.
 * - Failed, pending, or abandoned scrapes must NEVER write to this table.
 * - price_cents MUST be strictly > 0 (integer cents, never float, never 0 or negative).
 */
export async function insertPriceHistory(
  input: InsertPriceHistoryInput,
): Promise<PriceHistory> {
  const supabase = getSupabaseClient();

  // Strict price validation: must be an integer strictly greater than 0
  if (
    typeof input.price_cents !== 'number' ||
    !Number.isInteger(input.price_cents) ||
    input.price_cents <= 0
  ) {
    throw new AppError(
      `Invalid price_cents: price must be an integer strictly greater than 0, received ${input.price_cents}`,
      400,
      'VALIDATION_ERROR',
    );
  }

  if (!input.product_id) {
    throw new AppError('product_id is required', 400, 'VALIDATION_ERROR');
  }

  const insertPayload: Database['public']['Tables']['price_history']['Insert'] = {
    product_id: input.product_id,
    price_cents: input.price_cents,
    currency: input.currency || 'USD',
    in_stock: input.in_stock,
    stock_text: input.stock_text ?? null,
    scraped_at: input.scraped_at || new Date().toISOString(),
    scrape_run_id: input.scrape_run_id ?? null,
  };

  const { data, error } = await supabase
    .from('price_history')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    logger.error({ error, input }, 'Failed to insert price history record');
    throw new AppError(`Failed to insert price history: ${error.message}`, 500, 'DB_ERROR');
  }

  return data;
}

/**
 * Retrieves historical price points for a product with optional date range filtering.
 */
export async function getPriceHistory(
  productId: string,
  range?: PriceHistoryRange,
): Promise<PriceHistory[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('price_history')
    .select('*')
    .eq('product_id', productId)
    .order('scraped_at', { ascending: true }); // Ascending for standard price charts

  if (range?.from) {
    const fromIso = range.from instanceof Date ? range.from.toISOString() : range.from;
    query = query.gte('scraped_at', fromIso);
  }

  if (range?.to) {
    const toIso = range.to instanceof Date ? range.to.toISOString() : range.to;
    query = query.lte('scraped_at', toIso);
  }

  if (range?.limit) {
    query = query.limit(range.limit);
  }

  const { data, error } = await query;

  if (error) {
    logger.error({ error, productId, range }, 'Failed to get price history');
    throw new AppError(`Failed to fetch price history: ${error.message}`, 500, 'DB_ERROR');
  }

  return (data || []) as PriceHistory[];
}

// -----------------------------------------------------------------------------
// 3. Scrape Logs
// -----------------------------------------------------------------------------

// In-process lock registry to prevent near-simultaneous check-then-act race conditions
const activeProductScrapeLocks = new Set<string>();

/**
 * Synchronously attempts to acquire an exclusive in-process scrape lock for a product.
 * Returns true if the lock was acquired, false if another scrape is already active.
 */
export function acquireProductScrapeLock(productId: string): boolean {
  if (activeProductScrapeLocks.has(productId)) {
    return false;
  }
  activeProductScrapeLocks.add(productId);
  return true;
}

/**
 * Releases the in-process scrape lock for a product.
 */
export function releaseProductScrapeLock(productId: string): void {
  activeProductScrapeLocks.delete(productId);
}

/**
 * Resets all in-process product scrape locks (useful for test teardown).
 */
export function resetProductScrapeLocks(): void {
  activeProductScrapeLocks.clear();
}

/**
 * Creates a new scrape run log record with initial outcome = 'pending'.
 * Recorded before the scrape begins so crashes/restarts leave evidence.
 *
 * Enforces atomic concurrency:
 * 1. Checks if an active pending scrape log already exists for the product.
 * 2. Catches Postgres 23505 unique partial index violations.
 * 3. Throws 409 SCRAPE_ALREADY_IN_PROGRESS on conflict.
 */
export async function createScrapeLog(input: CreateScrapeLogInput): Promise<ScrapeLog> {
  const supabase = getSupabaseClient();

  // 1. Atomic check: reject if another scrape log is currently in 'pending' status
  const { data: existingPending } = await supabase
    .from('scrape_logs')
    .select('id')
    .eq('product_id', input.product_id)
    .eq('outcome', 'pending')
    .maybeSingle();

  if (existingPending) {
    logger.warn({ productId: input.product_id }, 'Scrape rejected: pending run already exists in DB');
    throw new AppError(
      'A scrape is already in progress for this product',
      409,
      'SCRAPE_ALREADY_IN_PROGRESS',
    );
  }

  const insertPayload: Database['public']['Tables']['scrape_logs']['Insert'] = {
    product_id: input.product_id,
    started_at: input.started_at || new Date().toISOString(),
    outcome: 'pending',
    attempts: input.attempts ?? 0,
    strategy_used: input.strategy_used ?? null,
    trigger_source: input.trigger_source ?? 'cron',
    attempt_details: [],
  };

  if (input.id) {
    insertPayload.id = input.id;
  }

  const { data, error } = await supabase
    .from('scrape_logs')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      logger.warn({ productId: input.product_id }, 'Unique constraint violation: scrape already pending');
      throw new AppError(
        'A scrape is already in progress for this product',
        409,
        'SCRAPE_ALREADY_IN_PROGRESS',
      );
    }
    logger.error({ error, input }, 'Failed to create initial pending scrape log');
    throw new AppError(`Failed to create scrape log: ${error.message}`, 500, 'DB_ERROR');
  }

  return data;
}

/**
 * Finalises a scrape run log, transitioning it from 'pending' to a terminal outcome:
 * 'success' | 'success_after_retry' | 'failed' | 'abandoned'.
 *
 * Enforces:
 * - Terminal outcomes MUST record finished_at.
 * - Automatically calculates duration_ms if not provided.
 */
export async function finaliseScrapeLog(
  id: string,
  data: FinaliseScrapeLogInput,
): Promise<ScrapeLog> {
  const supabase = getSupabaseClient();

  if ((data.outcome as string) === 'pending') {
    throw new AppError(
      'Cannot finalise a scrape log with outcome="pending". Use a terminal outcome.',
      400,
      'VALIDATION_ERROR',
    );
  }

  // 1. Fetch started_at to compute duration_ms if not explicitly provided
  let durationMs = data.duration_ms;
  const finishedAt = data.finished_at || new Date().toISOString();

  if (durationMs === undefined) {
    const { data: currentLog } = await supabase
      .from('scrape_logs')
      .select('started_at')
      .eq('id', id)
      .maybeSingle();

    if (currentLog && 'started_at' in currentLog && currentLog.started_at) {
      const start = new Date(currentLog.started_at as string).getTime();
      const end = new Date(finishedAt).getTime();
      durationMs = Math.max(0, end - start);
    }
  }

  const updatePayload: Database['public']['Tables']['scrape_logs']['Update'] = {
    outcome: data.outcome,
    finished_at: finishedAt,
    duration_ms: durationMs ?? null,
  };

  if (data.attempts !== undefined) updatePayload.attempts = data.attempts;
  if (data.strategy_used !== undefined) updatePayload.strategy_used = data.strategy_used;
  if (data.http_status !== undefined) updatePayload.http_status = data.http_status;
  if (data.error_type !== undefined) updatePayload.error_type = data.error_type;
  if (data.error_message !== undefined) updatePayload.error_message = data.error_message;
  if (data.attempt_details !== undefined) updatePayload.attempt_details = data.attempt_details;
  if (data.price_cents !== undefined) updatePayload.price_cents = data.price_cents;
  if (data.in_stock !== undefined) updatePayload.in_stock = data.in_stock;

  const { data: updated, error } = await supabase
    .from('scrape_logs')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error({ error, id, data }, 'Failed to finalise scrape log');
    throw new AppError(`Failed to finalise scrape log: ${error.message}`, 500, 'DB_ERROR');
  }

  return updated;
}

/**
 * Fetches recent scrape logs for a given product.
 */
export async function getScrapeLogs(
  productId: string,
  limit = 50,
): Promise<ScrapeLog[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('scrape_logs')
    .select('*')
    .eq('product_id', productId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ error, productId }, 'Failed to get scrape logs');
    throw new AppError(`Failed to fetch scrape logs: ${error.message}`, 500, 'DB_ERROR');
  }

  return (data || []) as ScrapeLog[];
}

// -----------------------------------------------------------------------------
// 4. Scheduling & Reconciliation Sweeps
// -----------------------------------------------------------------------------

/**
 * Reconciles any scrape log that is still in 'pending' status past the staleness threshold.
 *
 * Marks them as 'abandoned', sets finished_at = now(), error_type = 'abandoned',
 * and records a clear error message explaining the run never reported back.
 *
 * Called on server boot and at the start of every cron scraping run.
 */
export async function reconcileStalePendingLogs(
  olderThanMs?: number,
): Promise<ReconcilePendingResult> {
  const supabase = getSupabaseClient();
  const thresholdMs = olderThanMs ?? env.STALE_PENDING_MS;
  const cutoffTimestamp = new Date(Date.now() - thresholdMs).toISOString();
  const nowIso = new Date().toISOString();

  // 1. Find all stale pending logs using the partial index
  const { data: staleLogs, error: findError } = await supabase
    .from('scrape_logs')
    .select('id, started_at')
    .eq('outcome', 'pending')
    .lte('started_at', cutoffTimestamp);

  if (findError) {
    logger.error({ error: findError }, 'Failed to query stale pending scrape logs');
    return { reconciledCount: 0, reconciledIds: [] };
  }

  if (!staleLogs || staleLogs.length === 0) {
    return { reconciledCount: 0, reconciledIds: [] };
  }

  const staleIds = staleLogs.map((l) => l.id);

  // 2. Mark them abandoned
  const updatePayload: Database['public']['Tables']['scrape_logs']['Update'] = {
    outcome: 'abandoned',
    finished_at: nowIso,
    error_type: 'abandoned',
    error_message: `Run abandoned: exceeded pending staleness threshold of ${thresholdMs}ms without reporting completion. Process likely terminated or crashed.`,
  };

  const { error: updateError, count } = await supabase
    .from('scrape_logs')
    .update(updatePayload)
    .in('id', staleIds);

  if (updateError) {
    logger.error({ error: updateError, staleIds }, 'Failed to update stale pending logs to abandoned');
    throw new AppError(`Reconciliation update failed: ${updateError.message}`, 500, 'DB_ERROR');
  }

  const reconciledCount = count ?? staleIds.length;

  logger.warn(
    { reconciledCount, staleIds, thresholdMs },
    `Reconciled ${reconciledCount} stale pending scrape logs to abandoned`,
  );

  return {
    reconciledCount,
    reconciledIds: staleIds,
  };
}

/**
 * Finds all active products that are due for scraping according to their
 * per-product configured scrape_interval_minutes.
 *
 * Rules:
 * - Product must have is_active = true.
 * - Excludes products that currently have an active scrape in progress (outcome = 'pending').
 * - A product is due if:
 *     a) It has never had a completed scrape, OR
 *     b) (now - last_scrape_started_at) >= scrape_interval_minutes.
 */
export async function getDueProducts(now = new Date()): Promise<TrackedProduct[]> {
  const supabase = getSupabaseClient();
  const nowTime = now.getTime();

  // 1. Fetch active products
  const { data: activeProducts, error: prodErr } = await supabase
    .from('tracked_products')
    .select('*')
    .eq('is_active', true);

  if (prodErr) {
    logger.error({ error: prodErr }, 'Failed to fetch active products for due evaluation');
    throw new AppError(`Failed to fetch active products: ${prodErr.message}`, 500, 'DB_ERROR');
  }

  if (!activeProducts || activeProducts.length === 0) {
    return [];
  }

  const productIds = activeProducts.map((p) => p.id);

  // 2. Fetch the most recent scrape log for each active product
  const { data: recentLogs, error: logsErr } = await supabase
    .from('scrape_logs')
    .select('id, product_id, started_at, outcome')
    .in('product_id', productIds)
    .order('started_at', { ascending: false });

  if (logsErr) {
    logger.error({ error: logsErr }, 'Failed to fetch recent logs for due evaluation');
    throw new AppError(`Failed to fetch logs for due evaluation: ${logsErr.message}`, 500, 'DB_ERROR');
  }

  // Map latest log for each product
  const latestLogByProduct = new Map<string, { started_at: string; outcome: ScrapeOutcome }>();
  const isRunningSet = new Set<string>();

  for (const log of (recentLogs || []) as Array<{
    id: string;
    product_id: string;
    started_at: string;
    outcome: ScrapeOutcome;
  }>) {
    if (log.outcome === 'pending') {
      isRunningSet.add(log.product_id);
    }
    if (!latestLogByProduct.has(log.product_id)) {
      latestLogByProduct.set(log.product_id, {
        started_at: log.started_at,
        outcome: log.outcome,
      });
    }
  }

  // 3. Filter products that are due and not currently running
  const dueProducts: TrackedProduct[] = [];

  for (const product of activeProducts as TrackedProduct[]) {
    // Skip if an active scrape is currently running
    if (isRunningSet.has(product.id)) {
      continue;
    }

    const latestLog = latestLogByProduct.get(product.id);

    // If never scraped, it is due immediately
    if (!latestLog) {
      dueProducts.push(product);
      continue;
    }

    // Check if interval has elapsed since the start of the latest run
    const lastRunTime = new Date(latestLog.started_at).getTime();
    const intervalMs = (product.scrape_interval_minutes || 120) * 60 * 1000;

    if (nowTime - lastRunTime >= intervalMs) {
      dueProducts.push(product);
    }
  }

  return dueProducts;
}

// -----------------------------------------------------------------------------
// 5. Cron Runs, Concurrency & Catch-Up Safety Net
// -----------------------------------------------------------------------------

// In-process lock to prevent simultaneous execution within the same Node.js instance
let isCronScrapeDueActive = false;

/**
 * Resets the in-process cron lock. Used primarily in test suites.
 */
export function resetCronLocks(): void {
  isCronScrapeDueActive = false;
}

export type CronLockResult = {
  lockId: string;
};

export type ReleaseCronLockInput = {
  status: 'completed' | 'failed';
  attempted: number;
  succeeded: number;
  retried: number;
  failed: number;
  reconciled: number;
  durationMs: number;
  errorMessage?: string;
};

/**
 * Attempts to acquire an exclusive lock for running the cron scrape-due cycle.
 *
 * Implements two layers of concurrency protection:
 * 1. Synchronous in-memory flag: blocks overlapping requests hitting the same Express process.
 * 2. PostgreSQL `cron_runs` table with unique partial index `idx_cron_runs_single_running`:
 *    guarantees single-runner execution across distributed instances.
 *
 * Returns `{ lockId }` if acquired, or `null` if another run is already in progress.
 */
export async function acquireCronLock(
  triggerSource: TriggerSource,
): Promise<CronLockResult | null> {
  // 1. Synchronous in-process check
  if (isCronScrapeDueActive) {
    logger.warn({ triggerSource }, 'In-process cron lock contention: run already in progress');
    return null;
  }

  // Set in-process lock immediately to guard against concurrent event loop ticks
  isCronScrapeDueActive = true;

  try {
    const supabase = getSupabaseClient();
    const nowIso = new Date().toISOString();

    // 2. Clear any abandoned cron runs older than 15 minutes (failsafe against crash-abandoned locks)
    const staleCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await supabase
      .from('cron_runs')
      .update({
        status: 'failed',
        finished_at: nowIso,
        error_message: 'Abandoned: cron run exceeded 15 minute execution limit without finishing',
      })
      .eq('status', 'running')
      .lte('started_at', staleCutoff);

    // 3. Attempt to insert a new 'running' row.
    // If another instance or worker is currently running, PostgreSQL will reject with 23505.
    const { data, error } = await supabase
      .from('cron_runs')
      .insert({
        status: 'running',
        trigger_source: triggerSource,
        started_at: nowIso,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        isCronScrapeDueActive = false;
        logger.warn(
          { triggerSource, errorCode: error.code },
          'Postgres cron_runs unique constraint collision: another cron run is in progress',
        );
        return null;
      }
      logger.error({ error, triggerSource }, 'Failed to insert cron_runs lock entry');
      // If DB fails for unexpected reasons (e.g. mock DB in test without cron_runs table),
      // we still honor the in-process lock with a generated ID
      return { lockId: 'in-process-cron-lock' };
    }

    return { lockId: data.id };
  } catch (err: unknown) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), triggerSource },
      'Unexpected error acquiring cron lock, falling back to in-process lock',
    );
    return { lockId: 'in-process-cron-lock' };
  }
}

/**
 * Releases the exclusive cron lock, updating the database record with execution statistics.
 */
export async function releaseCronLock(
  lockId: string,
  summary: ReleaseCronLockInput,
): Promise<void> {
  // Release in-process lock unconditionally
  isCronScrapeDueActive = false;

  if (!lockId || lockId === 'in-process-cron-lock') {
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const finishedAt = new Date().toISOString();

    const { error } = await supabase
      .from('cron_runs')
      .update({
        status: summary.status,
        finished_at: finishedAt,
        attempted: summary.attempted,
        succeeded: summary.succeeded,
        retried: summary.retried,
        failed: summary.failed,
        reconciled: summary.reconciled,
        duration_ms: summary.durationMs,
        error_message: summary.errorMessage ?? null,
      })
      .eq('id', lockId);

    if (error) {
      logger.error({ error, lockId, summary }, 'Failed to update cron_runs on lock release');
    }
  } catch (err: unknown) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), lockId },
      'Unexpected error releasing cron lock in database',
    );
  }
}

/**
 * Finds active tracked products that require a catch-up scrape.
 *
 * A product qualifies for a catch-up scrape if:
 * 1. It has is_active = true.
 * 2. It does NOT currently have an active scrape in progress (outcome = 'pending').
 * 3. It has NOT been scraped in more than 2x its scrape_interval_minutes:
 *    - For products with at least one completed scrape: (now - last_scraped_at) > (2 * intervalMs).
 *    - For products never scraped: (now - created_at) > (2 * intervalMs).
 *
 * This is a recovery mechanism on cold boot, NOT a primary scheduler.
 */
export async function getCatchupProducts(now = new Date()): Promise<TrackedProduct[]> {
  const supabase = getSupabaseClient();
  const nowTime = now.getTime();

  // 1. Fetch active products
  const { data: activeProducts, error: prodErr } = await supabase
    .from('tracked_products')
    .select('*')
    .eq('is_active', true);

  if (prodErr) {
    logger.error({ error: prodErr }, 'Failed to fetch active products for catchup evaluation');
    throw new AppError(`Failed to fetch active products: ${prodErr.message}`, 500, 'DB_ERROR');
  }

  if (!activeProducts || activeProducts.length === 0) {
    return [];
  }

  const productIds = activeProducts.map((p) => p.id);

  // 2. Fetch recent logs for active products
  const { data: recentLogs, error: logsErr } = await supabase
    .from('scrape_logs')
    .select('id, product_id, started_at, finished_at, outcome')
    .in('product_id', productIds)
    .order('started_at', { ascending: false });

  if (logsErr) {
    logger.error({ error: logsErr }, 'Failed to fetch logs for catchup evaluation');
    throw new AppError(`Failed to fetch logs for catchup evaluation: ${logsErr.message}`, 500, 'DB_ERROR');
  }

  const latestCompletedByProduct = new Map<
    string,
    { finished_at: string | null; started_at: string }
  >();
  const isRunningSet = new Set<string>();

  for (const log of (recentLogs || []) as Array<{
    id: string;
    product_id: string;
    started_at: string;
    finished_at: string | null;
    outcome: ScrapeOutcome;
  }>) {
    if (log.outcome === 'pending') {
      isRunningSet.add(log.product_id);
    } else if (!latestCompletedByProduct.has(log.product_id)) {
      latestCompletedByProduct.set(log.product_id, {
        finished_at: log.finished_at,
        started_at: log.started_at,
      });
    }
  }

  const catchupProducts: TrackedProduct[] = [];

  for (const product of activeProducts as TrackedProduct[]) {
    // Skip if already in progress
    if (isRunningSet.has(product.id)) {
      continue;
    }

    const intervalMinutes = product.scrape_interval_minutes || 120;
    const doubleIntervalMs = intervalMinutes * 2 * 60 * 1000;

    const latestCompleted = latestCompletedByProduct.get(product.id);
    if (latestCompleted) {
      const lastScrapedTime = new Date(
        latestCompleted.finished_at || latestCompleted.started_at,
      ).getTime();
      if (nowTime - lastScrapedTime > doubleIntervalMs) {
        catchupProducts.push(product);
      }
    } else {
      // Never scraped: check if created more than 2x interval ago
      const createdTime = new Date(product.created_at).getTime();
      if (nowTime - createdTime > doubleIntervalMs) {
        catchupProducts.push(product);
      }
    }
  }

  return catchupProducts;
}
