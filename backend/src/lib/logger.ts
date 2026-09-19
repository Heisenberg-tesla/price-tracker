import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { env } from '../config/env';

export interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
}

export const logStorage = new AsyncLocalStorage<LogContext>();

export const baseLogger = pino({
  level: env.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    env: env.NODE_ENV,
    pid: process.pid,
  },
});

// Proxy logger that automatically injects the current correlationId from AsyncLocalStorage if present
export const logger = new Proxy(baseLogger, {
  get(target, prop, receiver) {
    const orig = Reflect.get(target, prop, receiver);
    if (
      typeof orig === 'function' &&
      ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].includes(prop as string)
    ) {
      return (...args: unknown[]) => {
        const store = logStorage.getStore();
        if (store?.correlationId) {
          const child = target.child({ correlationId: store.correlationId });
          return (child[prop as keyof typeof child] as (...a: unknown[]) => void)(...args);
        }
        return (orig as (...a: unknown[]) => void).apply(target, args);
      };
    }
    return orig;
  },
});
