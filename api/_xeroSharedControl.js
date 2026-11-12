import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { xeroRateLimitSnapshot } from './_xeroRateLimit.js';

const bindings = new WeakMap();
const scopes = new AsyncLocalStorage();
const messages = {
  XERO_CONNECTION_RENEWAL_UNAVAILABLE: 'The saved Xero connection could not be renewed. Check the configured OAuth client; this does not prove the grant was revoked.',
  XERO_CONNECTION_REVOKED: 'Xero rejected the saved refresh grant. Reconnect the authorised organisation.',
  XERO_RENEWAL_IN_PROGRESS: 'Another worker is renewing the Xero connection. Retry after it completes.',
  XERO_RENEWAL_OUTCOME_UNKNOWN: 'The Xero renewal outcome is uncertain. Do not retry the previous refresh token; recover the saved connection or reconnect.',
  XERO_WRITE_OUTCOME_UNKNOWN: 'The Xero write outcome is uncertain. Verify the target through readback before retrying.',
  XERO_ALLOWANCE_UNKNOWN: 'Xero allowance is unknown. An authorised read-only allowance probe is required.',
  XERO_RESERVE_PROTECTED: 'This operation would consume the protected Xero allowance or its reserved verification calls.',
  XERO_RETRY_DEADLINE: 'Xero has supplied a retry deadline. Wait until that deadline before continuing.',
  XERO_MINUTE_LIMIT: 'The shared Xero request limit has been reached. Retry after the current minute window.',
  XERO_INFLIGHT_LIMIT: 'Two Xero requests are already running. Retry when one finishes.',
  XERO_CONNECTION_CHANGED: 'The Xero connection changed. Reload it before continuing.',
  XERO_WRITE_OUTCOME_UNRESOLVED: 'A previous Xero write needs verified readback before another write can start.',
};
export function xeroControlError(code, { outcomeUnknown = false, requestId = null, budgetId = null } = {}) {
  return Object.assign(new Error(messages[code] || 'Xero shared request control could not safely complete this operation.'), {
    code, status: ['XERO_CONNECTION_CHANGED'].includes(code) ? 409 : 503, expose: true,
    details: { outcomeUnknown, safeToRetry: !outcomeUnknown, ...(requestId ? { requestId } : {}), ...(budgetId ? { budgetId } : {}) },
  });
}

// Only service-side clients and deliberately injected test controls can bind a
// connection. A process-local limiter is never a fallback admission authority.
export function bindXeroSharedControl(connection, control) {
  if (connection && control) bindings.set(connection, control);
  return connection;
}
export function xeroSharedContext(connection, options = {}) {
  const inherited = scopes.getStore();
  const scope = inherited?.tenantId === connection?.tenantId ? inherited : {};
  const control = options.sharedControl || scope.sharedControl || bindings.get(connection);
  if (!control) throw xeroControlError('XERO_SHARED_CONTROL_UNAVAILABLE');
  return { ...scope, ...options, sharedControl: control };
}
export function runWithXeroBudget(connection, options, operation) {
  const context = xeroSharedContext(connection, options);
  return scopes.run({ ...context, tenantId: connection.tenantId }, operation);
}
export function forecastXeroBudget({ operationCalls, verificationCalls = 0 } = {}) {
  if (![operationCalls, verificationCalls].every(n => Number.isSafeInteger(n) && n >= 0) || operationCalls + verificationCalls < 1 || operationCalls + verificationCalls > 10_000) throw xeroControlError('XERO_BUDGET_INVALID');
  return { operationCalls, verificationCalls, totalCalls: operationCalls + verificationCalls, reserve: 200, minimumAvailableCalls: operationCalls + verificationCalls + 200 };
}
export function createXeroSharedControl(client) {
  async function rpc(name, args) {
    if (typeof client?.rpc !== 'function') throw xeroControlError('XERO_SHARED_CONTROL_UNAVAILABLE');
    let result;
    try { result = await client.rpc(name, args); } catch { throw xeroControlError('XERO_SHARED_CONTROL_UNAVAILABLE'); }
    if (result.error) {
      const code = String(result.error.message || '').match(/\bXERO_[A-Z_]+\b/)?.[0] || 'XERO_SHARED_CONTROL_UNAVAILABLE';
      throw xeroControlError(code);
    }
    return result.data;
  }
  return {
    status: tenantId => rpc('xero_shared_status', { p_tenant_id: tenantId }),
    reserve: ({ tenantId, budgetId = randomUUID(), ownerKey, operationCalls, verificationCalls = 0, ttlSeconds = 600 }) => {
      forecastXeroBudget({ operationCalls, verificationCalls });
      return rpc('xero_shared_reserve', { p_tenant_id: tenantId, p_id: budgetId, p_owner_key: ownerKey, p_operation_calls: operationCalls, p_verification_calls: verificationCalls, p_ttl_seconds: ttlSeconds });
    },
    release: ({ tenantId, budgetId, reason = 'Completed' }) => rpc('xero_shared_release', { p_tenant_id: tenantId, p_id: budgetId, p_reason: reason }),
    authorizeProbe: ({ tenantId, probeId = randomUUID(), actorId, notBefore, reason }) => rpc('xero_shared_authorize_probe', { p_tenant_id: tenantId, p_id: probeId, p_actor_id: actorId, p_not_before: notBefore, p_reason: reason }),
    admit: ({ tenantId, tokenVersion, requestId = randomUUID(), method, resourceKey, budgetId = null, budgetPhase = 'operation', probeId = null }) => rpc('xero_shared_admit', {
      p_tenant_id: tenantId, p_id: requestId, p_token_version: tokenVersion, p_method: method, p_resource_key: resourceKey, p_budget_id: budgetId, p_phase: budgetPhase, p_probe_id: probeId,
    }),
    observe: ({ tenantId, requestId, status = null, headers = null, outcomeUnknown = false }) => rpc('xero_shared_observe', {
      p_tenant_id: tenantId, p_request_id: requestId, p_status: status, p_snapshot: headers ? xeroRateLimitSnapshot(headers) : {}, p_outcome_unknown: outcomeUnknown,
    }),
    resolveUnknown: ({ tenantId, requestId, verificationRequestId, evidenceReference }) => rpc('xero_shared_resolve_unknown', { p_tenant_id: tenantId, p_request_id: requestId, p_verification_request_id: verificationRequestId, p_evidence_reference: evidenceReference }),
    claimRefresh: ({ tenantId, tokenVersion, leaseId }) => rpc('xero_refresh_claim', { p_tenant_id: tenantId, p_expected_version: tokenVersion, p_lease_id: leaseId }),
    finishRefresh: ({ tenantId, tokenVersion, leaseId, connection }) => rpc('xero_refresh_finish', { p_tenant_id: tenantId, p_expected_version: tokenVersion, p_lease_id: leaseId, p_connection: connection }),
    failRefresh: ({ tenantId, tokenVersion, leaseId, state }) => rpc('xero_refresh_fail', { p_tenant_id: tenantId, p_expected_version: tokenVersion, p_lease_id: leaseId, p_state: state }),
    reconnect: ({ tokenVersion, connection }) => rpc('xero_reconnect_store', { p_expected_version: tokenVersion, p_connection: connection }),
  };
}
export function readXeroSharedStatus(connection, options = {}) {
  return xeroSharedContext(connection, options).sharedControl.status(connection.tenantId);
}
export function reserveXeroBudget(connection, options) {
  return xeroSharedContext(connection, options).sharedControl.reserve({ ...options, tenantId: connection.tenantId });
}
export function releaseXeroBudget(connection, options) {
  return xeroSharedContext(connection, options).sharedControl.release({ ...options, tenantId: connection.tenantId });
}
export function authorizeXeroQuotaProbe(connection, options) {
  return xeroSharedContext(connection, options).sharedControl.authorizeProbe({ ...options, tenantId: connection.tenantId });
}
