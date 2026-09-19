import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from '../lib/errors';

export interface RequestValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Express middleware factory to validate incoming request body, query, and params using Zod.
 * Rejects invalid requests with HTTP 400 and standard error envelope.
 */
export function validateRequest(schemas: RequestValidationSchemas) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(req.params)) as Record<string, string>;
      }
      if (schemas.query) {
        req.query = (await schemas.query.parseAsync(req.query)) as Record<string, unknown> as typeof req.query;
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        const firstIssue = err.issues[0];
        const fieldName = firstIssue?.path.join('.') || 'input';
        const message = firstIssue?.message || 'Invalid input';
        const fullMessage = `${fieldName}: ${message}`;

        return next(
          new AppError(
            fullMessage,
            400,
            'VALIDATION_ERROR',
            err.issues.map((i) => ({
              field: i.path.join('.'),
              message: i.message,
            })),
          ),
        );
      }
      return next(err);
    }
  };
}
