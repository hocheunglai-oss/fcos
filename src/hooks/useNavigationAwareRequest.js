import { useCallback, useEffect, useRef } from 'react';
import { appClient } from '@/api/appClient';
import { navigationCacheOptions } from '@/lib/navigationCachePolicy';

export function useNavigationAwareRequest(policy = 'operational') {
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const activeControllerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    };
  }, []);

  const request = useCallback(async ({
    name,
    payload = {},
    force = false,
    cacheKey,
    cacheTags,
    apply,
    cancelPrevious = false,
  }) => {
    if (cancelPrevious) activeControllerRef.current?.abort();
    const controller = cancelPrevious ? new AbortController() : null;
    if (controller) activeControllerRef.current = controller;
    const requestId = ++requestSequenceRef.current;
    const applyIfCurrent = (result) => {
      if (!mountedRef.current || requestSequenceRef.current !== requestId) return;
      apply?.(result);
    };
    const result = await appClient.functions.invoke(name, payload, {
      ...navigationCacheOptions(policy, applyIfCurrent),
      force,
      cacheKey,
      cacheTags,
      signal: controller?.signal,
    });
    applyIfCurrent(result);
    return result;
  }, [policy]);

  const cancelPendingUpdates = useCallback(() => {
    requestSequenceRef.current += 1;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  }, []);

  return { request, cancelPendingUpdates };
}
