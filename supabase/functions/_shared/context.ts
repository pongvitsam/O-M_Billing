import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envGet } from './env.ts';

export type AppContext = {
  supabase: SupabaseClient;
};

let _client: SupabaseClient | null = null;

const DEFAULT_URL = 'https://nnsxyuhiwgrqbszrhyiz.supabase.co';
const DEFAULT_KEY = 'sb_publishable_qMqdfCN5EcUiBh1zNcBVBQ_G-qmeQx5';

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = envGet('SUPABASE_URL') || DEFAULT_URL;
    const key =
      envGet('SUPABASE_SERVICE_ROLE_KEY') ||
      envGet('SUPABASE_ANON_KEY') ||
      DEFAULT_KEY;
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

export function getAppContext(): AppContext {
  return { supabase: getSupabase() };
}
