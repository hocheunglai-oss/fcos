// Only code-owned labels and bounded observations may enter public diagnostics.
const origins = new Set(['VISIBLE_ERROR', 'FIXED_FAILURE_NOTICE', 'DATA_UNAVAILABLE_BADGE',
  'DASHBOARD_PANEL_HIDDEN', 'DASHBOARD_ROWS_MISSING', 'DASHBOARD_EMPTY_STATE_MISSING',
  'SURFACE_REJECTED', 'BROWSER_ACTION_ERROR', 'DATA_CHECK_FAILED', 'PAGE_CLOSE_ERROR',
  'LEGACY_FAILURE_NOTICE', 'RESPONSE_URL_INVALID']);
const steps = new Set(['NAVIGATION', 'HEADING', 'OPEN_SURFACE', 'READINESS', 'UNAVAILABLE_CHECK',
  'SURFACE_CHECK', 'WORKFLOW', 'PAGE_CLOSE', 'CLEANUP']);
const errorKinds = new Set(['Error', 'TimeoutError', 'TypeError', 'OTHER']);
const reasons = new Set(['ACCESS_MISSING', 'MISSING_HEADING', 'MISSING_DATA', 'PAGE_ERROR', 'BLOCKED_REQUEST', 'LOGIN_REDIRECT',
  'UNAVAILABLE_SURFACE', 'DATA_NO_RESPONSE', 'DATA_NON_2XX', 'DATA_JSON_FAILURE', 'DATA_SHAPE_REJECTED', 'DATA_DEADLINE',
  'MISSING_ROWS', 'EMPTY_STATE_MISSING', 'SETTINGS_FIELD_MISSING', 'WORKFLOW_MISSING']);
const booleans = ['panelVisible', 'emptyStateVisible', 'primaryLoaded', 'dashboardSummaryLoaded', 'dashboardFiltersLoaded'];
const counts = ['matchedRows', 'matchedErrorCount', 'visibleAlertCount', 'requestErrorBlockCount', 'primaryRows', 'pendingResponses', 'waitElapsedMs'];

export const normalBrowserErrorKind = error => { const name = error?.name; return errorKinds.has(name) ? name : 'OTHER'; };
export function safeNormalBrowserObservation(value) {
  if (!value) return undefined;
  const origin = value.origin, step = value.step, errorKind = value.errorKind;
  if (!origins.has(origin) || !steps.has(step)) return undefined;
  const result = { origin, step };
  const reason = value.reason;
  if (reasons.has(reason)) result.reason = reason;
  if (errorKinds.has(errorKind)) result.errorKind = errorKind;
  for (const key of booleans) { const v = value[key]; if (typeof v === 'boolean') result[key] = v; }
  for (const key of counts) { const v = value[key]; if (Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000) result[key] = v; }
  return result;
}
export function safeNormalBrowserModuleDiagnostic(value) {
  const firstFailure = safeNormalBrowserObservation(value?.firstFailure);
  const cleanupFailure = safeNormalBrowserObservation(value?.cleanupFailure);
  return firstFailure || cleanupFailure ? {
    ...(firstFailure ? { firstFailure } : {}), ...(cleanupFailure ? { cleanupFailure } : {}),
  } : undefined;
}

export function createNormalBrowserModuleDiagnostic(readiness = () => ({})) {
  const value = {};
  return {
    fail(observation) {
      value.firstFailure ??= safeNormalBrowserObservation({ ...readiness(), ...observation });
    },
    close(error) {
      value.cleanupFailure ??= safeNormalBrowserObservation({ origin: 'PAGE_CLOSE_ERROR', step: 'PAGE_CLOSE', reason: 'UNAVAILABLE_SURFACE', errorKind: normalBrowserErrorKind(error) });
      value.firstFailure ??= value.cleanupFailure;
    },
    snapshot: () => safeNormalBrowserModuleDiagnostic(value),
  };
}
