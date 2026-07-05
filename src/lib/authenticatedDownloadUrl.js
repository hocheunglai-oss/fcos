import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';

export function withDownloadAuth(url, token) {
  if (!url || !token) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set('access_token', token);
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function useDownloadAuthToken(enabled = true) {
  const [token, setToken] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !isSupabaseConfigured || !supabase) {
      setToken(null);
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setToken(data?.session?.access_token || null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setToken(session?.access_token || null);
    });

    return () => {
      cancelled = true;
      listener?.subscription?.unsubscribe?.();
    };
  }, [enabled]);

  return token;
}
