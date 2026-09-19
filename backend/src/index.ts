import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      pid: process.pid,
    },
    `Price Tracker backend server listening on http://localhost:${env.PORT}`,
  );
});

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
