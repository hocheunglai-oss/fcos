const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function suppliedRetryAfterMs(headers, now) {
  const value = headers?.get?.('retry-after');
  if (value != null && String(value).trim()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const delay = Math.ceil(seconds * 1000);
      return Number.isFinite(new Date(now + delay).getTime()) ? delay : null;
    }
    if (Number.isFinite(seconds)) return null;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return null;
}

export function xeroRetryAfterMs(headers, { now = Date.now(), attempt = 0 } = {}) {
  return suppliedRetryAfterMs(headers, now) ?? Math.min(1000 * 2 ** attempt, 8000);
}

// Xero's tenant window is not aligned to midnight. Only a daily Retry-After
// establishes its reset time; minute throttling and local reserves do not.
export function xeroRateLimitSnapshot(headers, previous = {}, { now = Date.now() } = {}) {
  const read = (name) => {
    const value = headers?.get?.(name);
    if (value == null || !String(value).trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  const problem = String(headers?.get?.('x-rate-limit-problem') || '').trim().toLowerCase() || null;
  const delay = suppliedRetryAfterMs(headers, now);
  const retryAt = delay == null ? null : new Date(now + delay).toISOString();
  const remaining = read('x-daylimit-remaining');
  const oldReset = Date.parse(previous.dayResetAt || '');
  const keepReset = Number.isFinite(oldReset) && oldReset > now
    && !(remaining != null && previous.dayRemaining != null && remaining > previous.dayRemaining);
  const dayResetAt = /^(day|daily)$/.test(problem || '') && retryAt ? retryAt : keepReset ? previous.dayResetAt : null;
  return {
    ...Object.fromEntries(Object.entries({
      minuteRemaining: read('x-minlimit-remaining') ?? previous.minuteRemaining,
      dayRemaining: remaining ?? previous.dayRemaining,
      appMinuteRemaining: read('x-appminlimit-remaining') ?? previous.appMinuteRemaining,
      appDayRemaining: read('x-appdaylimit-remaining') ?? previous.appDayRemaining,
    }).filter(([, value]) => value != null)),
    rateLimitProblem: problem,
    retryAfterSeconds: delay == null ? null : Math.ceil(delay / 1000),
    retryAt,
    dayResetAt,
    observedAt: new Date(now).toISOString(),
  };
}

export function xeroRateLimitError(headers, { now = Date.now(), attempt = 0, retryAt = null } = {}) {
  const problem = String(headers?.get?.('x-rate-limit-problem') || 'request').trim().toLowerCase();
  const delay = retryAt == null ? xeroRetryAfterMs(headers, { now, attempt }) : Math.max(0, retryAt - now);
  const seconds = Math.max(1, Math.ceil(delay / 1000));
  const daily = /day|daily/.test(problem);
  const unknownReset = daily && suppliedRetryAfterMs(headers, now) == null;
  const rateLimit = xeroRateLimitSnapshot(headers, {}, { now });
  // Queued requests share the original deadline, not a new delay from now.
  if (!unknownReset && retryAt != null) {
    rateLimit.retryAt = new Date(retryAt).toISOString();
    rateLimit.retryAfterSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
    if (/^(day|daily)$/.test(problem)) rateLimit.dayResetAt = rateLimit.retryAt;
  }
  const wait = unknownReset ? 'after the daily allowance resets' : `in ${seconds} seconds`;
  return Object.assign(new Error(`Xero ${daily ? 'daily allowance' : 'request limit'} reached. Please retry ${wait}. Your saved reconciliation is retained.`), {
    status: 429, code: 'XERO_CONTACT_SYNC_RATE_LIMITED', expose: true,
    details: { retryAfterSeconds: unknownReset ? null : seconds, retryAt: unknownReset ? null : rateLimit.retryAt || new Date(now + seconds * 1000).toISOString(), rateLimitProblem: problem, rateLimit },
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
      if (cooldown > maxWaitMs || (cooldown > 0 && state.unknownDailyReset)) throw xeroRateLimitError(state.headers, { now: now(), retryAt: state.retryAt });
      const delay = Math.max(state.nextAt, state.retryAt) - now();
      if (delay > 0) await wait(delay);
      state.nextAt = now() + intervalMs;
      const response = await operation();
      if (response.status === 429) {
        state.headers = response.headers;
        const daily = /day|daily/i.test(String(response.headers?.get?.('x-rate-limit-problem') || ''));
        state.unknownDailyReset = daily && suppliedRetryAfterMs(response.headers, now()) == null;
        // Unknown reset: fail queued work, then permit a later probe; do not invent a 24-hour lockout.
        const fallback = state.unknownDailyReset ? 60_000 : 0;
        state.retryAt = now() + Math.max(fallback, xeroRetryAfterMs(response.headers, { now: now() }));
      } else if (response.ok) {
        state.retryAt = 0;
        state.headers = null;
        state.unknownDailyReset = false;
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
