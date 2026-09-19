import pinoHttp from 'pino-http';
import { Request } from 'express';
import { baseLogger } from '../lib/logger';

export const httpLogger = pinoHttp({
  logger: baseLogger,
  genReqId: (req) => {
    return (
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string) ||
      (req as unknown as Request).correlationId
    );
  },
  customProps: (req) => {
    return {
      correlationId: (req as unknown as Request).correlationId,
    };
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} completed with status ${res.statusCode}`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} failed with status ${res.statusCode}: ${err.message}`;
  },
});
