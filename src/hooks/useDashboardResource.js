import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { appClient } from '@/api/appClient';

export function useDashboardResource(scope) {
  const [request, setRequest] = useState(null);
  const attemptRef = useRef(null);
  const abort = useCallback(() => {
    attemptRef.current?.controller.abort();
    attemptRef.current = null;
  }, []);
  useLayoutEffect(() => () => {
    if (attemptRef.current?.scope === scope) abort();
  }, [abort, scope]);
  const clear = useCallback(() => {
    abort();
    setRequest(null);
  }, [abort]);

  const load = useCallback(async (name, payload, {
    force = false, once = false, retain = true, cacheTtlMs = 30_000, cacheTags = ['dashboard'],
  } = {}) => {
    if (once && !force && attemptRef.current?.scope === scope) return null;
    abort();
    const controller = new AbortController();
    const attempt = { scope, controller };
    attemptRef.current = attempt;
    const isCurrent = () => attemptRef.current === attempt && !controller.signal.aborted;
    setRequest((previous) => ({
      scope,
      loading: true,
      snapshot: retain && previous?.scope === scope ? previous.snapshot : null,
      error: null,
    }));
    try {
      const { data, meta } = await appClient.functions.invoke(name, payload, {
        cache: true, cacheTtlMs, cacheTags, signal: controller.signal, force,
      });
      if (!isCurrent()) return null;
      if (data?.error || !data || data.cancelled) throw new Error(data?.error || 'The request did not return data. Try again.');
      const snapshot = { data, meta: { ...meta, cachedAt: meta?.cachedAt || new Date().toISOString() } };
      setRequest({ scope, snapshot, loading: false, error: null });
      return snapshot;
    } catch (error) {
      if (isCurrent()) setRequest((current) => ({ ...current, loading: false, error: error.message || 'The request failed. Try again.' }));
      return null;
    }
  }, [abort, scope]);

  const current = request?.scope === scope ? request : null;
  return { snapshot: current?.snapshot, loading: current?.loading ?? true, error: current?.error, load, clear };
}
