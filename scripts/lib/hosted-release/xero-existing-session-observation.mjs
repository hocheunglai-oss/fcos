import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';

const URL = 'https://api.xero.com/connections';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const METHODS = ['status', 'reserve', 'admit', 'observe', 'release'];
const REQUIRED = ['schemaVersion', 'kind', 'operationId', 'intentSha256', 'schemaEvidenceSha256', 'identityEvidenceSha256', 'tenantId', 'requestId', 'budgetId', 'ownerKey', 'issuedAt', 'notAfter', 'supabaseProject'];
const OPTIONAL = ['expectedTenantType', 'expectedTenantName'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const date = value => typeof value === 'string' ? Date.parse(value) : NaN;
const knownControlCodes = new Set(['XERO_CONNECTION_CHANGED', 'XERO_ALLOWANCE_UNKNOWN', 'XERO_RESERVE_PROTECTED', 'XERO_RETRY_DEADLINE', 'XERO_MINUTE_LIMIT', 'XERO_INFLIGHT_LIMIT', 'XERO_REQUEST_ALREADY_ADMITTED', 'XERO_BUDGET_EXHAUSTED']);

function failure(code, stage, binding, extras = {}) {
  return Object.assign(new Error(code), {
    code, retryable: false,
    details: {
      stage,
      ...(binding ? { operationId: binding.operationId, requestId: binding.requestId, budgetId: binding.budgetId } : {}),
      ...extras,
    },
  });
}

function bindingSnapshot(input, now) {
  const valid = plain(input) && REQUIRED.every(key => Object.hasOwn(input, key))
    && Object.keys(input).every(key => [...REQUIRED, ...OPTIONAL].includes(key))
    && input.schemaVersion === 1 && input.kind === 'fcos_xero_existing_session_observation_binding_v1'
    && ['operationId', 'intentSha256', 'schemaEvidenceSha256', 'identityEvidenceSha256'].every(key => HASH.test(input[key] || ''))
    && ['tenantId', 'requestId', 'budgetId'].every(key => UUID.test(input[key] || ''))
    && input.requestId !== input.budgetId && input.ownerKey === `xero-session:${input.operationId}`
    && input.supabaseProject === fcosConnectionIdentifier('supabase', 'Project ref')
    && integer(input.issuedAt) && integer(input.notAfter) && input.issuedAt <= now
    && input.notAfter - now >= 120_000 && input.notAfter - input.issuedAt <= 86_400_000
    && OPTIONAL.every(key => !Object.hasOwn(input, key) || (typeof input[key] === 'string' && input[key].length > 0 && input[key].length <= 500));
  if (!valid) throw failure('XERO_SESSION_BINDING_INVALID', 'binding');
  return Object.freeze({ ...input });
}

function sessionSnapshot(row, binding, now) {
  if (!plain(row) || row.id !== 'primary' || row.tenant_id !== binding.tenantId
    || typeof row.access_token !== 'string' || !row.access_token || row.access_token !== row.access_token.trim()
    || row.access_token.length > 16_384 || /[\x00-\x20\x7f]/.test(row.access_token)
    || !Number.isSafeInteger(row.token_version) || row.token_version < 1
    || !Number.isFinite(date(row.expires_at)) || date(row.expires_at) <= now + 90_000) {
    throw failure('XERO_SESSION_UNAVAILABLE', 'session', binding);
  }
  return Object.freeze({ tenantId: row.tenant_id, accessToken: row.access_token, tokenVersion: row.token_version, expiresAt: date(row.expires_at) });
}

function statusSnapshot(value, binding, stage) {
  if (!plain(value) || value.tenantId !== binding.tenantId || typeof value.allowanceKnown !== 'boolean'
    || typeof value.dailyHold !== 'boolean' || value.reserve !== 200 || value.minuteLimit !== 45 || value.inFlightLimit !== 2
    || !['reservedCalls', 'inFlight', 'minuteCalls', 'revision', 'unresolvedWrites'].every(key => integer(value[key]))
    || !['availableCalls', 'spendableCalls'].every(key => integer(value[key]) || (!value.allowanceKnown && value[key] === null))
    || !(value.retryAt === null || Number.isFinite(date(value.retryAt)))) {
    throw failure('XERO_SESSION_CONTROL_ACK_INVALID', stage, binding, { requiresReadback: true });
  }
  return Object.freeze(Object.fromEntries(['tenantId', 'allowanceKnown', 'availableCalls', 'reservedCalls', 'spendableCalls', 'reserve', 'inFlight', 'minuteCalls', 'minuteLimit', 'inFlightLimit', 'retryAt', 'dailyHold', 'revision', 'unresolvedWrites'].map(key => [key, value[key]])));
}

async function within(operation, milliseconds, controller) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller?.abort(); reject(new Error('TIMEOUT')); }, milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

async function readBoundedJson(response, milliseconds) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('BODY_INVALID');
  let size = 0;
  const chunks = [];
  try {
    await within(async () => {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65_536) throw new Error('BODY_TOO_LARGE');
        chunks.push(Buffer.from(part.value));
      }
    }, milliseconds);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { Promise.resolve(reader.cancel()).catch(() => {}); }
}

/** Trusted-runtime orchestration only, not an endpoint or an authority grant.
 * The owner must qualify the injected shared controller, live schema/ACL,
 * connection identity and original lease/intent before invoking this helper.
 * Hash syntax does not authenticate the referenced evidence. Never use the
 * existing54 reserve exception here. No environment/credential reader exists.
 *
 * Every metadata failure is terminal: even cleanup is withheld until scoped
 * readback. In particular a lease refusal must never chain a release mutation.
 * The original budget/receipt IDs remain available for owner recovery; neither
 * a missing acknowledgement nor GET uncertainty refunds an admitted call.
 */
export async function observeExistingXeroSession({ binding: input, connection, control, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const binding = bindingSnapshot(input, now());
  const session = sessionSnapshot(connection, binding, now());
  if (!control || !METHODS.every(key => typeof control[key] === 'function') || typeof fetchImpl !== 'function') {
    throw failure('XERO_SESSION_CONTROL_UNAVAILABLE', 'control', binding);
  }
  const calls = Object.fromEntries(METHODS.map(key => [key, control[key].bind(control)]));
  const remaining = stage => {
    const value = binding.notAfter - now();
    if (now() < binding.issuedAt || value <= 0) throw failure('XERO_SESSION_EXPIRED', stage, binding, { requiresReadback: true });
    return Math.min(5000, value);
  };
  const metadata = async (stage, args) => {
    const milliseconds = remaining(stage);
    try { return await within(() => calls[stage](args), milliseconds); }
    catch (error) {
      throw failure('XERO_SESSION_CONTROL_UNCERTAIN', stage, binding, {
        requiresReadback: true,
        ...(knownControlCodes.has(error?.code) ? { controlCode: error.code } : {}),
      });
    }
  };

  const before = statusSnapshot(await metadata('status', binding.tenantId), binding, 'status');
  if (!before.allowanceKnown || before.dailyHold || (before.retryAt !== null && date(before.retryAt) > now())
    || before.availableCalls - before.reservedCalls - 200 < 1 || before.spendableCalls < 1
    || before.inFlight >= 2 || before.minuteCalls >= 45) {
    throw failure('XERO_SESSION_QUOTA_HELD', 'status', binding, { quota: before });
  }
  const reserved = await metadata('reserve', { tenantId: binding.tenantId, budgetId: binding.budgetId, ownerKey: binding.ownerKey, operationCalls: 1, verificationCalls: 0, ttlSeconds: 60 });
  if (!plain(reserved) || reserved.id !== binding.budgetId || reserved.tenant_id !== binding.tenantId || reserved.owner_key !== binding.ownerKey
    || reserved.state !== 'active' || reserved.operation_remaining !== 1 || reserved.verification_remaining !== 0 || reserved.verification_reserved !== 0
    || !Number.isFinite(date(reserved.expires_at)) || date(reserved.expires_at) <= now() + 5000 || date(reserved.expires_at) > binding.notAfter) {
    throw failure('XERO_SESSION_CONTROL_ACK_INVALID', 'reserve', binding, { requiresReadback: true });
  }
  const receipt = await metadata('admit', { tenantId: binding.tenantId, tokenVersion: session.tokenVersion, requestId: binding.requestId, method: 'GET', resourceKey: 'Connections', budgetId: binding.budgetId, budgetPhase: 'operation', probeId: null });
  if (!plain(receipt) || receipt.requestId !== binding.requestId || receipt.tenantId !== binding.tenantId
    || !Number.isFinite(date(receipt.deadlineAt)) || date(receipt.deadlineAt) <= now() + 5000) {
    throw failure('XERO_SESSION_CONTROL_ACK_INVALID', 'admit', binding, { requiresReadback: true });
  }
  const milliseconds = Math.min(remaining('fetch'), date(receipt.deadlineAt) - now());
  if (session.expiresAt <= now() + 90_000 || date(reserved.expires_at) <= now() + milliseconds) {
    throw failure('XERO_SESSION_UNAVAILABLE', 'fetch', binding, { requiresReadback: true });
  }

  const abort = new AbortController();
  let response;
  let problem;
  try {
    try {
      response = await within(() => fetchImpl(URL, { method: 'GET', headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(milliseconds)]) }), milliseconds, abort);
    } catch { problem = 'XERO_SESSION_NETWORK_UNKNOWN'; }
    const responseStatus = Number.isSafeInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
    if (responseStatus === null) problem ||= 'XERO_SESSION_RESPONSE_INVALID';
    const observed = await metadata('observe', { tenantId: binding.tenantId, requestId: binding.requestId, status: responseStatus, headers: response?.headers || null, outcomeUnknown: false });
    if (!plain(observed) || observed.recorded !== true || Object.keys(observed).some(key => !['recorded', 'superseded'].includes(key))
      || (Object.hasOwn(observed, 'superseded') && typeof observed.superseded !== 'boolean')) {
      throw failure('XERO_SESSION_CONTROL_ACK_INVALID', 'observe', binding, { requiresReadback: true });
    }
    if (observed.superseded) throw failure('XERO_SESSION_SUPERSEDED', 'observe', binding, { requiresReadback: true });
    if (!problem && (responseStatus < 200 || responseStatus >= 300 || response.ok !== true)) problem = 'XERO_SESSION_HTTP_REJECTED';
    if (!problem && (response.redirected || (response.url && response.url !== URL))) problem = 'XERO_SESSION_RESPONSE_INVALID';
    if (!problem) {
      try {
        const payload = await readBoundedJson(response, remaining('body'));
        if (!Array.isArray(payload) || payload.length > 1000 || !payload.every(row => plain(row) && typeof row.tenantId === 'string' && UUID.test(row.tenantId.toLowerCase()))) {
          problem = 'XERO_SESSION_RESPONSE_INVALID';
        } else {
          const matches = payload.filter(row => row.tenantId.toLowerCase() === binding.tenantId);
          if (matches.length !== 1 || (Object.hasOwn(binding, 'expectedTenantType') && matches[0].tenantType !== binding.expectedTenantType)
            || (Object.hasOwn(binding, 'expectedTenantName') && matches[0].tenantName !== binding.expectedTenantName)) problem = 'XERO_SESSION_IDENTITY_MISMATCH';
        }
      } catch { problem = 'XERO_SESSION_RESPONSE_INVALID'; }
    }
    const after = statusSnapshot(await metadata('release', { tenantId: binding.tenantId, budgetId: binding.budgetId, reason: problem ? 'Existing-session observation not accepted; no replay' : 'Existing-session observation complete' }), binding, 'release');
    if (problem) throw failure(problem, 'result', binding, { responseStatus, requestObserved: true, budgetReleased: true });
    return Object.freeze({ kind: 'xero_existing_session_observation_v1', status: 'observed', baselineAccepted: false, financialAuthorityGranted: false,
      operationId: binding.operationId, tenantId: binding.tenantId, tokenVersion: session.tokenVersion, requestId: binding.requestId, budgetId: binding.budgetId,
      capturedAt: new Date(now()).toISOString(), providerRequests: 1, quotaBefore: before, quotaAfter: after });
  } finally {
    // Local cancellation closes an existing read, not a new provider/metadata
    // action. It must also run after a refused observation; never release the
    // budget or issue another RPC from this cleanup block.
    abort.abort();
    try { Promise.resolve(response?.body?.cancel?.()).catch(() => {}); } catch { /* A bounded reader may already own/cancel the body. */ }
  }
}
