import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './supabase.functions';
let client: Promise<SupabaseClient> | undefined;
export function getSupabaseClient() {
  client ??= getSupabaseConfig().then(config => createClient(config.url, config.key)).catch(error => { client = undefined; throw error; });
  return client;
}
