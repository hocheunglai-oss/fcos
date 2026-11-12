import { createClient } from '@supabase/supabase-js';
import { resolveAuthRuntimePolicy } from '../../shared/authRuntimePolicy.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || import.meta.env.VITE_SUPABASE_ANON_KEY;

const runtimePolicy = resolveAuthRuntimePolicy({
  url: supabaseUrl,
  publicKey: supabasePublicKey,
  development: import.meta.env.DEV,
  hostname: typeof window === 'undefined' ? '' : window.location.hostname,
});
export const isSupabaseConfigured = runtimePolicy.configured;
export const isLocalAdminAllowed = runtimePolicy.localAdminAllowed;
export const authConfigurationError = runtimePolicy.error;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublicKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
