export const XERO_ALLOWANCE_TIME_ZONE = 'Asia/Hong_Kong';

const RATE_FIELDS = ['dayRemaining', 'observedAt', 'dayResetAt', 'rateLimitProblem', 'retryAt', 'retryAfterSeconds'];

const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

function rateSnapshot(value, receivedAt) {
  if (!value || typeof value !== 'object' || !RATE_FIELDS.some((field) => Object.hasOwn(value, field))) return null;
  const remaining = value.dayRemaining == null || value.dayRemaining === '' ? NaN : Number(value.dayRemaining);
  const problem = typeof value.rateLimitProblem === 'string' ? value.rateLimitProblem.trim().toLowerCase() : null;
  const explicitReset = validDate(value.dayResetAt);
  return {
    dayRemaining: Number.isFinite(remaining) && remaining >= 0 ? Math.floor(remaining) : null,
    observedAt: validDate(value.observedAt) || validDate(receivedAt),
    dayResetAt: explicitReset || (!Object.hasOwn(value, 'dayResetAt') && (problem === 'day' || problem === 'daily') ? validDate(value.retryAt) : null),
  };
}

export function latestXeroDailyAllowance(current, value, { receivedAt = new Date().toISOString() } = {}) {
  const canonicalDetails = value?.details?.rateLimit;
  const details = canonicalDetails && RATE_FIELDS.some((field) => Object.hasOwn(canonicalDetails, field))
    ? canonicalDetails : value?.details;
  const candidates = value && typeof value === 'object' ? [
    current,
    value.rateLimit,
    value.run?.rateLimit,
    value.preview?.rateLimit,
    value.preview?.run?.rateLimit,
    value.payments?.rateLimit,
    details,
    value,
  ] : [current];
  return candidates.map((candidate) => rateSnapshot(candidate, receivedAt)).filter(Boolean).reduce((latest, candidate) => {
    if (!latest) return candidate;
    const latestTime = Date.parse(latest.observedAt);
    const candidateTime = Date.parse(candidate.observedAt);
    if (!Number.isFinite(candidateTime)) return latest;
    if (!Number.isFinite(latestTime) || candidateTime > latestTime) return candidate;
    return latest;
  }, null);
}

export function formatXeroAllowanceDate(value, language = 'en') {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === 'zh-Hant' || language === 'zh-HK' ? 'zh-HK' : 'en-HK', {
    dateStyle: 'medium', timeStyle: 'medium', timeZone: XERO_ALLOWANCE_TIME_ZONE,
  }).format(date);
}

export function formatXeroAllowanceCountdown(resetAt, now = Date.now(), language = 'en') {
  const remaining = Date.parse(resetAt) - Number(now);
  if (!(remaining > 0)) return null;
  const seconds = Math.ceil(remaining / 1000);
  const units = language === 'en' ? ['d', 'h', 'm', 's'] : ['日', '小時', '分', '秒'];
  const scales = [86400, 3600, 60, 1];
  const index = scales.findIndex((scale) => seconds >= scale);
  const first = `${Math.floor(seconds / scales[index])}${units[index]}`;
  return index === 3 ? first : `${first} ${Math.floor(seconds % scales[index] / scales[index + 1])}${units[index + 1]}`;
}
