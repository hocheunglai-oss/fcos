function publicXeroRateLimitDetails(details) {
  const safe = (source = {}) => {
    if (!source || typeof source !== 'object') return {};
    const result = {};
    for (const key of ['dayRemaining', 'minuteRemaining', 'appMinuteRemaining', 'appDayRemaining', 'retryAfterSeconds', 'reserve']) {
      if (typeof source[key] === 'number' && Number.isFinite(source[key]) && source[key] >= 0) result[key] = source[key];
    }
    for (const key of ['observedAt', 'retryAt', 'dayResetAt']) {
      const timestamp = typeof source[key] === 'string' ? Date.parse(source[key]) : NaN;
      if (Number.isFinite(timestamp)) result[key] = new Date(timestamp).toISOString();
    }
    if (['day', 'daily', 'minute', 'concurrent', 'appminute', 'appday', 'request'].includes(source.rateLimitProblem)) result.rateLimitProblem = source.rateLimitProblem;
    return result;
  };
  return { ...safe(details), rateLimit: safe(details?.rateLimit) };
}

export function publicApiErrorPayload(error, status, requestId) {
  const exposeMessage = status < 500 || error?.expose === true;
  const codeToken = String(error?.code || (status >= 500 ? 'FCOS_INTERNAL_ERROR' : 'FCOS_REQUEST_REJECTED'))
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 100) || 'FCOS_INTERNAL_ERROR';
  const message = exposeMessage
    ? String(error?.message || 'The FCOS request could not be completed.')
    : 'FCOS could not complete this operation. Use the request reference when reporting the problem.';
  const conflictDetails = status === 409 && error?.details !== undefined
    ? JSON.parse(JSON.stringify(error.details))
    : undefined;
  const rateLimitDetails = status === 429 && ['XERO_CONTACT_SYNC_RATE_LIMITED', 'XERO_FINANCIAL_DAILY_RESERVE'].includes(codeToken)
    ? publicXeroRateLimitDetails(error?.details)
    : undefined;
  return {
    error: message,
    message,
    code: codeToken,
    requestId,
    ...(conflictDetails !== undefined ? { details: conflictDetails } : {}),
    ...(rateLimitDetails !== undefined ? { details: rateLimitDetails } : {}),
    ...(status === 409 && error?.details?.current !== undefined ? { current: error.details.current } : {}),
  };
}
