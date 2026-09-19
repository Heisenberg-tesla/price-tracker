import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { ApiErrorResponse } from '../types';
import { env } from '../config/env';

export const errorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const correlationId = req.correlationId || 'unknown';

  let statusCode = 500;
  let message = 'Internal Server Error';
  let code: string | undefined = undefined;
  let details: unknown = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code;
    details = err.details;
  } else if (err.name === 'SyntaxError' && 'body' in err) {
    statusCode = 400;
    message = 'Malformed JSON request body';
    code = 'BAD_REQUEST';
  }

  logger.error(
    {
      err: {
        message: err.message,
        stack: env.NODE_ENV !== 'production' ? err.stack : undefined,
        name: err.name,
      },
      correlationId,
      url: req.originalUrl,
      method: req.method,
      statusCode,
      code,
    },
    `Request error occurred: ${err.message}`,
  );

  const responsePayload: ApiErrorResponse = {
    error: {
      message,
      code,
      correlationId,
      details: env.NODE_ENV !== 'production' ? (details ?? err.stack) : details,
    },
  };

  res.status(statusCode).json(responsePayload);
};

export function notFoundHandler(req: Request, res: Response): void {
  const correlationId = req.correlationId || 'unknown';
  logger.warn({ correlationId, url: req.originalUrl, method: req.method }, 'Route not found');

  const responsePayload: ApiErrorResponse = {
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      correlationId,
    },
  };

  res.status(404).json(responsePayload);
}
