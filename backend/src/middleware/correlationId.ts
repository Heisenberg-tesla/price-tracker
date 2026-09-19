import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { baseLogger, logStorage } from '../lib/logger';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existingId =
    (req.headers[CORRELATION_ID_HEADER] as string) || (req.headers['x-request-id'] as string);

  const correlationId = existingId && existingId.trim() !== '' ? existingId : randomUUID();

  req.correlationId = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  req.log = baseLogger.child({ correlationId });

  logStorage.run({ correlationId }, () => {
    next();
  });
}
