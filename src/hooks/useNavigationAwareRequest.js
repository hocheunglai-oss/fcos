import { useCallback, useEffect, useRef } from 'react';
import { appClient } from '@/api/appClient';
import { navigationCacheOptions } from '@/lib/navigationCachePolicy';

export function useNavigationAwareRequest(policy = 'operational') {
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
    };
  }, []);

  const request = useCallback(async ({
    name,
    payload = {},
    force = false,
    cacheKey,
    cacheTags,
    apply,
  }) => {
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
    });
    applyIfCurrent(result);
    return result;
  }, [policy]);

  const cancelPendingUpdates = useCallback(() => {
    requestSequenceRef.current += 1;
  }, []);

  return { request, cancelPendingUpdates };
}
