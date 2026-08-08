function nonBlank(value) {
  return String(value || '').trim();
}

/** Resolve one server-only Supabase credential contract. Never serialize the returned key. */
export function serverSupabaseConfig(env = process.env) {
  const canonicalUrl = nonBlank(env.SUPABASE_URL);
  const legacyBrowserUrl = nonBlank(env.VITE_SUPABASE_URL);
  const secretKey = nonBlank(env.SUPABASE_SECRET_KEY);
  const legacyServiceRoleKey = nonBlank(env.SUPABASE_SERVICE_ROLE_KEY);
  const url = canonicalUrl || legacyBrowserUrl;
  const key = secretKey || legacyServiceRoleKey;

  return {
    url,
    key,
    configured: Boolean(url && key),
    urlEnv: canonicalUrl ? 'SUPABASE_URL' : legacyBrowserUrl ? 'VITE_SUPABASE_URL' : null,
    keyEnv: secretKey ? 'SUPABASE_SECRET_KEY' : legacyServiceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    keyType: secretKey ? 'secret' : legacyServiceRoleKey ? 'legacy_service_role' : null,
    missingEnv: [
      ...(!url ? ['SUPABASE_URL or VITE_SUPABASE_URL'] : []),
      ...(!key ? ['SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY'] : []),
    ],
  };
}
