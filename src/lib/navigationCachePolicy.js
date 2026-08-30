export const NAVIGATION_CACHE_POLICIES = Object.freeze({
  operational: Object.freeze({
    freshMs: 3 * 60 * 1000,
    maxStaleMs: 30 * 60 * 1000,
  }),
  collaboration: Object.freeze({
    freshMs: 30 * 1000,
    maxStaleMs: 5 * 60 * 1000,
  }),
  reference: Object.freeze({
    freshMs: 10 * 60 * 1000,
    maxStaleMs: 24 * 60 * 60 * 1000,
  }),
});

export function navigationCacheDecision({
  hasEntry = false,
  ageMs = 0,
  freshMs,
  maxStaleMs,
  force = false,
} = {}) {
  if (force) return 'bypass';
  if (!hasEntry) return 'miss';
  const age = Math.max(0, Number(ageMs) || 0);
  const fresh = Math.max(0, Number(freshMs) || 0);
  const staleLimit = Math.max(fresh, Number(maxStaleMs) || fresh);
  if (age <= fresh) return 'fresh';
  if (age <= staleLimit) return 'stale';
  return 'expired';
}

export function navigationCacheOptions(policy = 'operational', onBackgroundUpdate) {
  const selected = NAVIGATION_CACHE_POLICIES[policy] || NAVIGATION_CACHE_POLICIES.operational;
  return {
    cache: true,
    navigationAware: true,
    cacheTtlMs: selected.freshMs,
    maxStaleMs: selected.maxStaleMs,
    onBackgroundUpdate,
  };
}

