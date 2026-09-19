import { Server } from 'http';
import pLimit from 'p-limit';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { reconcileStalePendingLogs, getCatchupProducts } from './db';
import { scrapeProduct } from './scraper/scrapeProduct';

const app = createApp();
let server: Server;

async function runBootCatchupSafetyNet(): Promise<void> {
  try {
    const overdueProducts = await getCatchupProducts();
    if (overdueProducts.length === 0) {
      logger.info('Boot catch-up safety net: all active tracked products are within 2x interval');
      return;
    }

    logger.info(
      {
        count: overdueProducts.length,
        productIds: overdueProducts.map((p) => p.id),
      },
      'Boot catch-up safety net: found overdue products (> 2x interval). Running recovery scrape...',
    );

    const limit = pLimit(2);
    for (const product of overdueProducts) {
      void limit(async () => {
        try {
          await scrapeProduct(product, { triggerSource: 'catchup' });
          logger.info({ productId: product.id }, 'Boot catch-up scrape completed successfully');
        } catch (err: unknown) {
          logger.error(
            { productId: product.id, err: err instanceof Error ? err.message : String(err) },
            'Boot catch-up scrape failed for product',
          );
        }
      });
    }
  } catch (err: unknown) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Boot catch-up check could not evaluate products; proceeding without recovery sweep',
    );
  }
}

async function startServer(): Promise<void> {
  // 1. Run boot-time stale pending sweep to recover from prior crashes or cold-start kills
  try {
    const sweepResult = await reconcileStalePendingLogs();
    if (sweepResult.reconciledCount > 0) {
      logger.info(
        { reconciledCount: sweepResult.reconciledCount, reconciledIds: sweepResult.reconciledIds },
        'Boot-time reconciliation marked stale pending scrape logs as abandoned',
      );
    } else {
      logger.info('Boot-time reconciliation completed: no stale pending scrape logs found');
    }
  } catch (err: unknown) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Boot-time pending log reconciliation could not reach database; proceeding with startup',
    );
  }

  // 2. Start listening with generous server-side timeouts for Render cold starts & long scrapes
  server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        pid: process.pid,
      },
      `Price Tracker backend server listening on http://localhost:${env.PORT}`,
    );

    // 3. Trigger Catch-Up Safety Net: if any product has not been scraped in > 2x its interval,
    // execute a catch-up scrape once in the background with trigger_source='catchup'
    void runBootCatchupSafetyNet();
  });

  // Generous timeouts: handle cold starts and extended Playwright scraping cycles
  server.setTimeout(300000); // 5 minutes server socket timeout
  server.keepAliveTimeout = 65000; // Ensure keep-alive > 60s proxy default (Render / Cloudflare)
  server.headersTimeout = 66000;
}

void startServer();

// Flag to prevent double shutdown
let isShuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, `Received ${signal}. Initiating graceful shutdown...`);

  // Give the server a timeout window to close existing connections
  const forceExitTimeout = setTimeout(() => {
    logger.error({ signal }, 'Graceful shutdown timed out. Forcing process exit.');
    process.exit(1);
  }, 10000);

  // Prevent timeout from keeping event loop alive if everything closes cleanly
  if (forceExitTimeout.unref) {
    forceExitTimeout.unref();
  }

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error closing HTTP server during shutdown.');
      process.exit(1);
    }
    logger.info('HTTP server closed successfully. Process exiting.');
    process.exit(0);
  });
}

// Graceful shutdown listeners (SIGTERM is used by Render, Docker, Kubernetes)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Process-level unhandled rejection & exception guards
process.on('unhandledRejection', (reason: unknown) => {
  logger.error(
    {
      err: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
    },
    'Unhandled Promise Rejection detected',
  );
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal(
    {
      err: { message: err.message, stack: err.stack, name: err.name },
    },
    'Uncaught Exception detected. Shutting down.',
  );
  gracefulShutdown('uncaughtException');
});
