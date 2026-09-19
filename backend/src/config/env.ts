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
