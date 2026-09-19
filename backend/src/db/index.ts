import { isDbConnected, getSupabaseClient, supabase } from './client';
import * as repo from './repository';

export const db = {
  isConnected: isDbConnected,
  getClient: getSupabaseClient,
  client: supabase,
  ...repo,
};

export { isDbConnected, getSupabaseClient, supabase };
export * from './repository';
