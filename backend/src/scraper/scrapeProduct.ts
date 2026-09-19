import { env } from '../config/env';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { ErrorType, ScrapeOutcome, AttemptDetail, TrackedProduct } from '../types/database';
import { createScrapeLog, finaliseScrapeLog, insertPriceHistory } from '../db/repository';
import { ScrapedPriceData, ScrapeProductOptions, ScrapeProductResult } from './types';
import { fetchPriceWithBrowser } from './browserFetcher';
import { validateScrapeResult, ValidationError } from './validate';
import { recordStructureSnapshot } from './structureSnapshot';

/**
 * Sleep helper for retry backoff
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Maps an error to a standardized ErrorType enum
 */
function classifyError(err: unknown): ErrorType {
  if (err instanceof ValidationError) {
    return 'validation_error';
  }
  if (err instanceof AppError) {
    if (
      err.code === 'DOM_ERROR' ||
      err.code === 'NO_PRICE_CARRIER' ||
      err.code === 'EXTRACTION_ERROR'
    ) {
      return 'parse_error';
    }
    if (err.statusCode === 404 || err.code === 'PRODUCT_NOT_FOUND') return 'http_error';
    if (err.statusCode === 504 || err.code?.includes('TIMEOUT')) return 'timeout';
    if (
      err.statusCode === 429 ||
      err.statusCode === 500 ||
      err.statusCode === 502 ||
      err.statusCode === 503 ||
      err.code?.includes('PRICE_ENDPOINT_ERROR') ||
      err.code === 'HTTP_ERROR'
    ) {
      return 'http_error';
    }
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes('timeout')) return 'timeout';
  if (
    msg.includes('404') ||
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('rate limit')
  ) {
    return 'http_error';
  }
  return 'parse_error';
}

/**
 * Orchestrates a complete scrape for a single product.
 *
 * Flow:
 * 1. Inserts initial scrape_log with outcome='pending' before starting.
 * 2. Attempts up to maxAttempts (default 3) using Tier 2 browser fetcher.
 * 3. Exponential backoff with jitter between retries.
 * 4. Genuine 404 halts retry loop immediately.
 * 5. Calls insertPriceHistory ONLY upon validated success.
 * 6. Always transitions scrape_log to 'success', 'success_after_retry', or 'failed' in a finally block.
 *    (Never writes 'abandoned' — that is exclusively the job of reconcileStalePendingLogs).
 * 7. Wrapped so a single product failure never throws unhandled errors or aborts batch runs.
 */
export async function scrapeProduct(
  product: TrackedProduct | { id: string; product_url: string; name?: string },
  options: ScrapeProductOptions = {},
): Promise<ScrapeProductResult> {
  const triggerSource = options.triggerSource || 'manual';
  const maxAttempts = options.maxAttempts || env.MAX_SCRAPE_ATTEMPTS || 3;

  logger.info(
    { productId: product.id, url: product.product_url, triggerSource, maxAttempts },
    'Starting single product scrape orchestration...',
  );

  // 1. Record initial pending scrape log (or use existing if created atomically by caller)
  const initialLog =
    options.initialLog ||
    (await createScrapeLog({
      product_id: product.id,
      trigger_source: triggerSource,
      strategy_used: 'headless',
    }));

  const attemptDetails: AttemptDetail[] = [];
  let finalOutcome: Exclude<ScrapeOutcome, 'pending' | 'abandoned'> = 'failed';
  let successfulData: ScrapedPriceData | null = null;
  let lastError: Error | null = null;
  let lastErrorType: ErrorType | null = null;
  let attemptsCount = 0;
  let structureChangedOnRun = false;

  try {
    // 2. Attempt loop
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attemptsCount = attempt;
      const attemptStart = Date.now();

      logger.info(
        { productId: product.id, attempt, maxAttempts },
        `Executing scrape attempt ${attempt}/${maxAttempts}...`,
      );

      try {
        // Tier 2 browser fetch
        const extracted = await fetchPriceWithBrowser({
          productUrl: product.product_url,
          headless: options.headless,
          slowMo: options.slowMo,
          devtools: options.devtools,
          attempt,
          maxAttempts,
          simulate: options.simulate,
          onStepProgress: options.onStepProgress,
        });

        // Record structure snapshot for change detection
        const snapshotResult = await recordStructureSnapshot(product.id, extracted.selectorFingerprint);
        if (snapshotResult.changed) {
          structureChangedOnRun = true;
        }

        // Strict non-negotiable validation layer
        validateScrapeResult(extracted, product.name);

        // Success!
        successfulData = extracted;
        finalOutcome = attempt === 1 ? 'success' : 'success_after_retry';

        attemptDetails.push({
          attempt,
          strategy: 'headless',
          status: 200,
          durationMs: Date.now() - attemptStart,
          error: null,
        });

        logger.info(
          {
            productId: product.id,
            attempt,
            outcome: finalOutcome,
            priceCents: extracted.priceCents,
            inStock: extracted.inStock,
          },
          'Scrape attempt succeeded and passed all validation gates',
        );

        break; // Exit attempt loop on success
      } catch (err: unknown) {
        const durationMs = Date.now() - attemptStart;
        const errObj = err instanceof Error ? err : new Error(String(err));

        // If error carries a DOM fingerprint (e.g. carrier missing after layout change), check if structure changed
        if ((err as { fingerprint?: string }).fingerprint) {
          try {
            const snapshotResult = await recordStructureSnapshot(
              product.id,
              (err as { fingerprint: string }).fingerprint,
            );
            if (snapshotResult.changed) {
              structureChangedOnRun = true;
            }
          } catch {
            // Ignore snapshot persistence errors
          }
        }

        let errorType = classifyError(err);

        // CAUSAL CHECK:
        // A failure should ONLY be reclassified to 'structure_changed' if the structural
        // change was causally connected to the failure (e.g. the price carrier element itself
        // could not be found or matched due to the DOM change).
        // Validation errors (name mismatch, honeypot match, stock validation),
        // HTTP errors (404, 500, 429), and timeouts must NEVER be reclassified.
        const isCausalStructureFailure =
          structureChangedOnRun &&
          errorType === 'parse_error' &&
          (err instanceof AppError
            ? err.code === 'NO_PRICE_CARRIER' ||
              err.code === 'DOM_ERROR' ||
              err.code === 'EXTRACTION_ERROR' ||
              Boolean((err as { fingerprint?: string }).fingerprint)
            : Boolean((err as { fingerprint?: string }).fingerprint) ||
              errObj.message.includes('price carrier') ||
              errObj.message.includes('price element'));

        if (isCausalStructureFailure) {
          errorType = 'structure_changed';
        }

        lastError = errObj;
        lastErrorType = errorType;

        logger.warn(
          {
            productId: product.id,
            attempt,
            durationMs,
            errorType,
            error: errObj.message,
          },
          `Scrape attempt ${attempt} failed`,
        );

        attemptDetails.push({
          attempt,
          strategy: 'headless',
          status: (err as { statusCode?: number }).statusCode || null,
          durationMs,
          error: errObj.message,
        });

        // Terminal check: product genuinely not found (404) -> do not retry
        if (
          errorType === 'http_error' &&
          ((err as { statusCode?: number }).statusCode === 404 ||
            (err as { code?: string }).code === 'PRODUCT_NOT_FOUND' ||
            errObj.message.includes('404'))
        ) {
          logger.warn(
            { productId: product.id, url: product.product_url },
            'Product genuinely not found (404), terminating attempt loop immediately',
          );
          break;
        }

        // Retry with exponential backoff & jitter if attempts remain
        if (attempt < maxAttempts) {
          const backoffMs =
            options.retryDelayMs !== undefined
              ? options.retryDelayMs
              : Math.pow(2, attempt) * 1000 + Math.random() * 500;
          logger.debug({ backoffMs, nextAttempt: attempt + 1 }, 'Waiting before next scrape attempt...');

          if (options.onBackoffCountdown) {
            const totalSec = Math.max(0.1, Math.round(backoffMs / 100) / 10);
            const startWait = Date.now();
            while (Date.now() - startWait < backoffMs) {
              const remainingMs = Math.max(0, backoffMs - (Date.now() - startWait));
              const remainingSec = Math.round(remainingMs / 100) / 10;
              options.onBackoffCountdown(remainingSec, totalSec);
              await delay(Math.min(200, remainingMs));
            }
            options.onBackoffCountdown(0, totalSec);
          } else {
            await delay(backoffMs);
          }
        }
      }
    }

    // 3. Write to price_history ONLY on validated success
    let priceRecord;
    if (successfulData && (finalOutcome === 'success' || finalOutcome === 'success_after_retry')) {
      try {
        priceRecord = await insertPriceHistory({
          product_id: product.id,
          price_cents: successfulData.priceCents,
          currency: successfulData.currency,
          in_stock: successfulData.inStock,
          stock_text: successfulData.stockText,
          scrape_run_id: initialLog.id,
        });
      } catch (insertErr) {
        logger.error({ error: insertErr, productId: product.id }, 'Failed to insert price history record');
      }
    }

    return {
      log: initialLog,
      priceRecord,
      outcome: finalOutcome,
      attempts: attemptsCount,
      attemptDetails,
    };
  } finally {
    // 4. ALWAYS finalise scrape_log in finally block
    // Terminal outcome is strictly 'success', 'success_after_retry', or 'failed'.
    // Never write 'abandoned'.
    try {
      const finalizedLog = await finaliseScrapeLog(initialLog.id, {
        outcome: finalOutcome,
        attempts: attemptsCount,
        strategy_used: 'headless',
        error_type:
          finalOutcome === 'failed'
            ? lastErrorType || 'parse_error'
            : null,
        error_message:
          finalOutcome === 'failed'
            ? lastErrorType === 'structure_changed'
              ? `Price container DOM structure changed coinciding with carrier extraction failure: ${lastError?.message || 'Extraction failed'}`
              : lastError?.message || 'Exhausted scrape attempts'
            : null,
        attempt_details: attemptDetails,
        price_cents: successfulData ? successfulData.priceCents : null,
        in_stock: successfulData ? successfulData.inStock : null,
      });

      logger.info(
        { logId: finalizedLog.id, outcome: finalizedLog.outcome, durationMs: finalizedLog.duration_ms },
        'Scrape log successfully finalized',
      );
    } catch (finaliseErr) {
      logger.error(
        { error: finaliseErr, logId: initialLog.id },
        'Failed to finalise scrape log in finally block',
      );
    }
  }
}
