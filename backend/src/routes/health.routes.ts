import { Router, Request, Response } from 'express';
import { HealthResponse } from '../types';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response<HealthResponse>) => {
  const payload: HealthResponse = {
    status: 'ok',
    uptime: Math.round(process.uptime() * 100) / 100,
    version: process.env.npm_package_version || '1.0.0',
    dbConnected: false, // will reflect active database state in subsequent phases
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(payload);
});
