import { Router } from 'express';
import { healthRouter } from './health.routes';

export const apiRouter = Router();

// Mount health routes under /api/health as well
apiRouter.use('/health', healthRouter);
