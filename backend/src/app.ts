import express, { Express } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { correlationIdMiddleware } from './middleware/correlationId';
import { httpLogger } from './middleware/pinoHttp';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health.routes';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();

  // Security and CORS
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'x-request-id'],
    }),
  );

  // Body parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Correlation ID and structured HTTP request logging
  app.use(correlationIdMiddleware);
  app.use(httpLogger);

  // Root health endpoint (as well as /api/health)
  app.use('/health', healthRouter);

  // API Router namespace
  app.use('/api', apiRouter);

  // Fallback 404 handler
  app.use(notFoundHandler);

  // Centralized global error handler
  app.use(errorHandler);

  return app;
}
