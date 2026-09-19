import { Router, Request, Response, NextFunction } from 'express';
import pLimit from 'p-limit';
import { env } from '../config/env';
import {
  reconcileStalePendingLogs,
  getDueProducts,
  acquireCronLock,
  releaseCronLock,
} from '../db/repository';
import { scrapeProduct } from '../scraper/scrapeProduct';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { TriggerSource } from '../types/database';

export const cronRouter = Router();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST /api/cron/scrape-due
 *
 * Protected, idempotent cron endpoint:
 * 1. Requires header 'x-cron-secret' matching env.CRON_SECRET (else 401).
 * 2. Identifies trigger source ('cron' vs 'github-actions').
 * 3. Enforces single-runner concurrency via database lock (cron_runs unique partial index)
 *    and in-process mutex. If a run is already active, returns 200 with { skipped: true }.
 * 4. Reconciles stale pending logs FIRST (cleaning up any abandoned runs).
 * 5. Fetches active products due for scraping according to their scrape_interval_minutes.
 * 6. Executes scrapes with bounded concurrency (p-limit max 2) and jittered delay (100-300ms).
 * 7. Returns execution summary and releases cron lock.
 */
cronRouter.post('/scrape-due', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cronSecret = req.headers['x-cron-secret'];
    if (!cronSecret || cronSecret !== env.CRON_SECRET) {
      logger.warn({ ip: req.ip }, 'Unauthorized attempt to trigger /api/cron/scrape-due');
      throw new AppError('Unauthorized: invalid or missing X-Cron-Secret', 401, 'UNAUTHORIZED');
    }

    // Determine trigger source from request header
    const rawTrigger = req.headers['x-trigger-source'];
    const triggerSource: TriggerSource =
      rawTrigger === 'github-actions' ? 'github-actions' : 'cron';

    // Acquire concurrency lock (in-memory + PostgreSQL cron_runs table)
    const lock = await acquireCronLock(triggerSource);
    if (!lock) {
      logger.info(
        { trigger: triggerSource },
        'Cron scrape-due cycle skipped: another run is already in progress',
      );
      res.status(200).json({
        skipped: true,
        reason: 'run already in progress',
        trigger: triggerSource,
      });
      return;
    }

    const startTime = Date.now();
    let succeeded = 0;
    let retried = 0;
    let failed = 0;
    let reconciledCount = 0;

    try {
      // 1. Reconcile stale pending logs FIRST so crash-abandoned rows are resolved honestly
      logger.info({ trigger: triggerSource }, 'Running pre-cron stale pending log reconciliation sweep...');
      const reconcileResult = await reconcileStalePendingLogs();
      reconciledCount = reconcileResult.reconciledCount;

      // 2. Fetch products due for scraping (excludes products with pending scrapes)
      const dueProducts = await getDueProducts(new Date());
      logger.info(
        { dueCount: dueProducts.length, trigger: triggerSource },
        'Found products due for scheduled scrape',
      );

      if (dueProducts.length === 0) {
        const durationMs = Date.now() - startTime;
        await releaseCronLock(lock.lockId, {
          status: 'completed',
          attempted: 0,
          succeeded: 0,
          retried: 0,
          failed: 0,
          reconciled: reconciledCount,
          durationMs,
        });

        res.status(200).json({
          skipped: false,
          trigger: triggerSource,
          attempted: 0,
          succeeded: 0,
          retried: 0,
          failed: 0,
          durationMs,
          reconciled: reconciledCount,
        });
        return;
      }

      // 3. Scrape with bounded concurrency (p-limit: 2) and jittered delay
      const limit = pLimit(2);

      const scrapeTasks = dueProducts.map((product, index) =>
        limit(async () => {
          // Apply small jittered delay between task executions (100 - 300ms)
          if (index > 0) {
            await delay(100 + Math.random() * 200);
          }

          try {
            const result = await scrapeProduct(product, { triggerSource });
            if (result.outcome === 'success') {
              succeeded++;
            } else if (result.outcome === 'success_after_retry') {
              retried++;
            } else {
              failed++;
            }
          } catch (err: unknown) {
            failed++;
            logger.error(
              { productId: product.id, err: err instanceof Error ? err.message : String(err) },
              'Unexpected error in cron scrape task',
            );
          }
        }),
      );

      await Promise.all(scrapeTasks);

      const durationMs = Date.now() - startTime;
      logger.info(
        { attempted: dueProducts.length, succeeded, retried, failed, durationMs, trigger: triggerSource },
        'Cron scrape-due cycle completed',
      );

      await releaseCronLock(lock.lockId, {
        status: 'completed',
        attempted: dueProducts.length,
        succeeded,
        retried,
        failed,
        reconciled: reconciledCount,
        durationMs,
      });

      res.status(200).json({
        skipped: false,
        trigger: triggerSource,
        attempted: dueProducts.length,
        succeeded,
        retried,
        failed,
        durationMs,
        reconciled: reconciledCount,
      });
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      await releaseCronLock(lock.lockId, {
        status: 'failed',
        attempted: 0,
        succeeded,
        retried,
        failed: failed || 1,
        reconciled: reconciledCount,
        durationMs,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});
