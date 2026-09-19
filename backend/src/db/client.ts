import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { Database } from '../types/database';

let supabaseInstance: SupabaseClient<Database> | null = null;

/**
 * Returns the singleton typed Supabase client initialized with the service role key.
 * Server-side only: never expose this client or service key to the browser.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabaseInstance) {
    supabaseInstance = createClient<Database>(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }
  return supabaseInstance;
}

/**
 * Directly accessible typed Supabase client singleton.
 */
export const supabase = getSupabaseClient();

/**
 * Performs a lightweight health check query against the database.
 * Returns true if PostgreSQL/Supabase responds successfully, false otherwise.
 */
export async function isDbConnected(): Promise<boolean> {
  try {
    const client = getSupabaseClient();
    const queryPromise = client
      .from('tracked_products')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    const timeoutPromise = new Promise<{ error: Error }>((resolve) => {
      const timer = setTimeout(() => {
        resolve({ error: new Error('Database ping timed out after 3000ms') });
      }, 3000);
      if (timer.unref) timer.unref();
    });

    const result = await Promise.race([queryPromise, timeoutPromise]);

    if (result.error) {
      logger.debug({ error: result.error.message }, 'Database connectivity check reported error');
      return false;
    }

    return true;
  } catch (err: unknown) {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'Database connection failed during health ping',
    );
    return false;
  }
}
