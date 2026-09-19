import { Router, Request, Response } from 'express';
import { db } from '../db';
import { HealthResponse } from '../types';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response<HealthResponse>) => {
  const dbConnected = await db.isConnected();
  const payload: HealthResponse = {
    status: dbConnected ? 'ok' : 'degraded',
    uptime: Math.round(process.uptime() * 100) / 100,
    version: process.env.npm_package_version || '1.0.0',
    dbConnected,
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(payload);
});
