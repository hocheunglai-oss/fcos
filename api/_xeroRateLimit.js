const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function xeroRetryAfterMs(headers, { now = Date.now(), attempt = 0 } = {}) {
  const value = headers?.get?.('retry-after');
  if (value != null && String(value).trim()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

export function xeroRateLimitError(headers, { now = Date.now(), attempt = 0, retryAt = null } = {}) {
  const problem = String(headers?.get?.('x-rate-limit-problem') || 'request').toLowerCase();
  const delay = retryAt == null ? xeroRetryAfterMs(headers, { now, attempt }) : Math.max(0, retryAt - now);
  const seconds = Math.max(1, Math.ceil(delay / 1000));
  const daily = /day|daily/.test(problem);
  const wait = daily && !headers?.get?.('retry-after') ? 'after the daily allowance resets' : `in ${seconds} seconds`;
  return Object.assign(new Error(`Xero ${daily ? 'daily allowance' : 'request limit'} reached. Please retry ${wait}. Your saved reconciliation is retained.`), {
    status: 429, code: 'XERO_CONTACT_SYNC_RATE_LIMITED', expose: true,
    details: { retryAfterSeconds: seconds, retryAt: new Date(now + seconds * 1000).toISOString(), rateLimitProblem: problem },
  });
}

// One queue per tenant within a server instance, shared by concurrent page scans.
// Xero's Retry-After remains authoritative when other instances/apps use its allowance.
export function createXeroRequestGate({ now = Date.now, wait = sleep } = {}) {
  const tenants = new Map();
  return async (tenantId, operation, { intervalMs = 0, maxWaitMs = 60_000 } = {}) => {
    let state = tenants.get(tenantId);
    if (!state) {
      state = { tail: Promise.resolve(), nextAt: 0, retryAt: 0, headers: null, pending: 0 };
      tenants.set(tenantId, state);
    }
    state.pending += 1;
    const result = state.tail.then(async () => {
      const cooldown = state.retryAt - now();
      if (cooldown > maxWaitMs) throw xeroRateLimitError(state.headers, { now: now(), retryAt: state.retryAt });
      const delay = Math.max(state.nextAt, state.retryAt) - now();
      if (delay > 0) await wait(delay);
      state.nextAt = now() + intervalMs;
      const response = await operation();
      if (response.status === 429) {
        state.headers = response.headers;
        const daily = /day|daily/i.test(String(response.headers?.get?.('x-rate-limit-problem') || ''));
        const fallback = daily && !response.headers?.get?.('retry-after') ? 86_400_000 : 0;
        state.retryAt = now() + Math.max(fallback, xeroRetryAfterMs(response.headers, { now: now() }));
      } else if (response.ok) {
        state.retryAt = 0;
        state.headers = null;
      }
      return response;
    });
    state.tail = result.catch(() => {});
    try { return await result; } finally {
      state.pending -= 1;
      // Bound idle tenant state without dropping another tenant's queued work.
      for (const [key, value] of tenants) {
        if (!value.pending && Math.max(value.nextAt, value.retryAt) < now() - 60_000) tenants.delete(key);
      }
    }
  };
}

const gates = new WeakMap();
export function xeroRequestGate(fetchImpl) {
  if (!gates.has(fetchImpl)) gates.set(fetchImpl, createXeroRequestGate());
  return gates.get(fetchImpl);
}
