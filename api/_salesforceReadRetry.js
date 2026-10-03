const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 2;
const MAX_DELAY_MS = 2000;

export function salesforceReadRetryDelay({ method, status, attempt, retryAfter, now = Date.now() }) {
  if (!['GET', 'HEAD'].includes(method) || !TRANSIENT_STATUSES.has(status) || attempt >= MAX_RETRIES) return null;
  let delay = 250 * (2 ** attempt);
  if (retryAfter != null && String(retryAfter).trim()) {
    const seconds = Number(retryAfter);
    const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
    // A long server-requested wait is surfaced to the caller, never shortened.
    if (Number.isFinite(requested)) delay = Math.max(delay, requested);
  }
  return delay <= MAX_DELAY_MS ? delay : null;
}
