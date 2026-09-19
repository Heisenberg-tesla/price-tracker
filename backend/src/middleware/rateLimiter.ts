import { rateLimit } from 'express-rate-limit';
import { Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Public rate limiter for user-facing API endpoints (/api/store and /api/products).
 * Excludes internal endpoints (/api/cron, /api/health).
 * Disabled in test environment.
 */
export const publicApiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 200, // Limit each IP to 200 requests per 15 minutes
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: () => env.NODE_ENV === 'test', // Bypass in test suite
  handler: (req: Request, res: Response) => {
    const correlationId = req.correlationId || 'unknown';
    res.status(429).json({
      error: {
        message: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        correlationId,
      },
    });
  },
});
