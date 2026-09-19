import { Router } from 'express';
import { healthRouter } from './health.routes';
import { storeRouter } from './store.routes';
import { productsRouter } from './product.routes';
import { cronRouter } from './cron.routes';
import { publicApiRateLimiter } from '../middleware/rateLimiter';

export const apiRouter = Router();

// Health routes (unthrottled)
apiRouter.use('/health', healthRouter);

// Public-facing store and product routes (rate-limited)
apiRouter.use('/store', publicApiRateLimiter, storeRouter);
apiRouter.use('/products', publicApiRateLimiter, productsRouter);

// Protected cron routes (secret-authenticated, unthrottled)
apiRouter.use('/cron', cronRouter);
