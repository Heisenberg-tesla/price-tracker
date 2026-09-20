import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file into process.env if present
dotenv.config();

const envSchema = z.object({
  PORT: z
    .string()
    .default('4000')
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`PORT must be a valid integer between 1 and 65535, received "${val}"`);
      }
      return parsed;
    }),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN must not be empty').default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL (e.g. https://your-project.supabase.co)'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY must not be empty'),
  STALE_PENDING_MS: z
    .string()
    .default('600000')
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`STALE_PENDING_MS must be a positive integer, received "${val}"`);
      }
      return parsed;
    }),
  HEADLESS: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() !== 'false'),
  STORE_BASE_URL: z
    .string()
    .url('STORE_BASE_URL must be a valid URL')
    .default('https://demo.inelabteamdev.com'),
  CATALOG_CACHE_TTL_MS: z
    .string()
    .default('600000')
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`CATALOG_CACHE_TTL_MS must be a positive integer, received "${val}"`);
      }
      return parsed;
    }),
  MAX_SCRAPE_ATTEMPTS: z
    .string()
    .default('3')
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`MAX_SCRAPE_ATTEMPTS must be a positive integer, received "${val}"`);
      }
      return parsed;
    }),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters long'),
  SCRAPE_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((val) => {
      const isProd = process.env.NODE_ENV === 'production';
      const defaultVal = isProd ? 45000 : 15000;
      const parsed = parseInt(val || String(defaultVal), 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`SCRAPE_TIMEOUT_MS must be a positive integer, received "${val}"`);
      }
      return parsed;
    }),
  DISABLE_INITIAL_SCRAPE: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadAndValidateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - [${issue.path.join('.') || 'CONFIG'}]: ${issue.message}`)
      .join('\n');

    const errorMessage = `
================================================================================
CRITICAL CONFIGURATION ERROR: INVALID OR MISSING ENVIRONMENT VARIABLES
================================================================================
The application failed to start because required environment configuration is
invalid or missing:

${errorDetails}

Please check your environment variables or copy backend/.env.example to backend/.env.
================================================================================
`;
    // Print loudly to standard error and crash immediately
    console.error(errorMessage);
    process.exit(1);
  }

  return result.data;
}

export const env: EnvConfig = loadAndValidateEnv();
