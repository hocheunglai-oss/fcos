import { createHash } from 'node:crypto';
import { createRuntimeXeroReadControl } from './_xeroSharedControl.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const URL = 'https://api.xero.com/connections';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
export const runtimeProbeRequestId = value => typeof value === 'string' && UUID.test(value);
export function createRuntimeProbeDeadline({ durationMs = 25000, monotonic = () => performance.now() } = {}) {
  const end = monotonic() + durationMs;
  const remaining = (maximum = 5000, minimum = 1) => {
    const left = end - monotonic();
    if (!Number.isFinite(left) || left < minimum) fail('RUNTIME_PROBE_DEADLINE');
    return Math.max(1, Math.floor(Math.min(maximum, left)));
  };
  return Object.freeze({ remaining, run: (operation, maximum = 5000) => bounded(operation, remaining(maximum)) });
}

export function runtimeXeroBudgetId(requestId) {
  if (!runtimeProbeRequestId(requestId)) fail('RUNTIME_XERO_REQUEST_INVALID');
  const bytes = createHash('sha256').update(`fcos.runtime.xero.budget.v1:${requestId}`).digest();
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function quota(value, tenantId) {
  const count = n => Number.isSafeInteger(n) && n >= 0;
  if (!plain(value) || value.tenantId !== tenantId || value.reserve !== 200 || value.minuteLimit !== 45 || value.inFlightLimit !== 2
    || typeof value.allowanceKnown !== 'boolean' || typeof value.dailyHold !== 'boolean'
    || !['reservedCalls', 'inFlight', 'minuteCalls', 'revision', 'unresolvedWrites'].every(k => count(value[k]))
    || !['availableCalls', 'spendableCalls'].every(k => count(value[k]) || (!value.allowanceKnown && value[k] === null))
    || !(value.retryAt === null || Number.isFinite(Date.parse(value.retryAt)))) fail('RUNTIME_XERO_CONTROL_INVALID');
  return value;
}

async function bounded(operation, timeout = 5000, abort) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => { abort?.abort(); reject(Object.assign(new Error('Runtime probe deadline exceeded.'), { code: 'RUNTIME_PROBE_DEADLINE' })); }, timeout);
    })]);
  } finally { clearTimeout(timer); }
}

async function bodyJson(response) {
  const reader = response.body?.getReader?.();
  if (!reader) fail('RUNTIME_XERO_RESPONSE_INVALID');
  let size = 0; const chunks = [];
  try {
    await bounded(async () => {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 65536) fail('RUNTIME_XERO_RESPONSE_INVALID');
        chunks.push(Buffer.from(part.value));
      }
    });
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Local cancellation only. */ } }
}

/** One ordinary authenticated-admin metadata read. Authorization is supplied by
 * authorizeRuntimeProbe, never request JSON. A new normal budget/request is its
 * own durable intent and lease; no completed deployment or historical grant is
 * adopted. No renewal, allowance exception, accounting endpoint or retry exists.
 * Any refusal/throw/unknown stops ALL subsequent RPCs, including release.
 */
export async function observeRuntimeXero({ client, actorId, requestId, binding, tenantId, fetchImpl = fetch,
  now = Date.now, control = createRuntimeXeroReadControl(client), deadline = createRuntimeProbeDeadline() } = {}) {
  if (!runtimeProbeRequestId(actorId) || !runtimeProbeRequestId(requestId) || !runtimeProbeRequestId(tenantId)
    || !/^dpl_[A-Za-z0-9]+$/.test(binding?.deploymentId || '') || !/^[0-9a-f]{40}$/.test(binding?.sha || '')
    || !HASH.test(binding?.sourceDigest || '')) fail('RUNTIME_XERO_SCOPE_INVALID');
  const rpc = (method, args) => deadline.run(() => control[method](args));
  const row = await deadline.run(() => client.from('xero_contact_sync_connections')
    .select('id,tenant_id,access_token,expires_at,token_version').eq('id', 'primary').maybeSingle());
  const connection = row?.data, expiresAt = Date.parse(connection?.expires_at || '');
  if (row?.error || connection?.id !== 'primary' || connection.tenant_id !== tenantId
    || typeof connection.access_token !== 'string' || !connection.access_token || /[\x00-\x20\x7f]/.test(connection.access_token)
    || connection.access_token.length > 16384 || !Number.isSafeInteger(connection.token_version) || connection.token_version < 1
    || !Number.isFinite(expiresAt) || expiresAt <= now() + 90000) fail('RUNTIME_XERO_SESSION_UNAVAILABLE');
  const scope = { kind: 'fcos_runtime_xero_read_v1', actorId, ...binding, tenantId, tokenVersion: connection.token_version, requestId };
  const scopeHash = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  const ownerKey = `runtime-probe:${scopeHash}`, budgetId = runtimeXeroBudgetId(requestId);
  const before = quota(await rpc('status', tenantId), tenantId);
  if (!before.allowanceKnown || before.dailyHold || before.retryAt !== null && Date.parse(before.retryAt) > now()
    || before.availableCalls - before.reservedCalls - 200 < 1 || before.spendableCalls < 1 || before.inFlight >= 2 || before.minuteCalls >= 45)
    fail('RUNTIME_XERO_QUOTA_HELD');
  deadline.remaining(5000, 15000);
  const reserved = await rpc('reserve', { tenantId, budgetId, ownerKey, operationCalls: 1, verificationCalls: 0, ttlSeconds: 60 });
  const budgetExpiry = Date.parse(reserved?.expires_at || '');
  if (!plain(reserved) || reserved.id !== budgetId || reserved.tenant_id !== tenantId || reserved.owner_key !== ownerKey
    || reserved.state !== 'active' || reserved.operation_remaining !== 1 || reserved.verification_remaining !== 0 || reserved.verification_reserved !== 0
    || !Number.isFinite(budgetExpiry) || budgetExpiry <= now() + 15000 || budgetExpiry > now() + 61000)
    fail('RUNTIME_XERO_CONTROL_INVALID');
  deadline.remaining(5000, 15000);
  const admitted = await rpc('admit', { tenantId, tokenVersion: connection.token_version, requestId, method: 'GET', resourceKey: 'Connections',
    resourcePath: '/connections', payloadJson: null, budgetId, budgetPhase: 'operation', probeId: null });
  const admissionDeadline = Date.parse(admitted?.deadlineAt || '');
  if (!plain(admitted) || admitted.requestId !== requestId || admitted.tenantId !== tenantId || !Number.isFinite(admissionDeadline)
    || admissionDeadline <= now() + 15000 || expiresAt <= now() + 90000 || budgetExpiry <= now() + 15000) fail('RUNTIME_XERO_CONTROL_INVALID');
  const abort = new AbortController(); let response;
  try {
    const readTimeout = deadline.remaining(5000, 15000);
    response = await bounded(() => fetchImpl(URL, { method: 'GET', headers: { Authorization: `Bearer ${connection.access_token}`, Accept: 'application/json' },
      redirect: 'error', signal: abort.signal }), readTimeout, abort);
    if (response?.status !== 200 || response.ok !== true || response.redirected || response.url && response.url !== URL)
      fail('RUNTIME_XERO_RESPONSE_INVALID');
    const rows = await deadline.run(() => bodyJson(response));
    if (!Array.isArray(rows) || rows.length > 1000 || !rows.every(r => plain(r) && typeof r.tenantId === 'string' && runtimeProbeRequestId(r.tenantId.toLowerCase()))
      || rows.filter(r => r.tenantId.toLowerCase() === tenantId && r.tenantType === 'ORGANISATION').length !== 1
      || rows.filter(r => r.tenantId.toLowerCase() === tenantId).length !== 1) fail('RUNTIME_XERO_IDENTITY_MISMATCH');
    if (now() >= admissionDeadline || now() >= budgetExpiry || expiresAt <= now() + 90000) fail('RUNTIME_XERO_SESSION_UNAVAILABLE');
    const observed = await rpc('observe', { tenantId, requestId, status: 200, headers: response.headers, outcomeUnknown: false });
    if (!plain(observed) || observed.recorded !== true || observed.superseded === true
      || Object.hasOwn(observed, 'superseded') && typeof observed.superseded !== 'boolean'
      || Object.keys(observed).some(k => !['recorded', 'superseded'].includes(k))) fail('RUNTIME_XERO_CONTROL_INVALID');
    quota(await rpc('release', { tenantId, budgetId, reason: `Runtime connection read complete ${scopeHash}` }), tenantId);
    return { auth: { state: 'authenticated', target: tenantId, mode: 'oauth' }, runtimeValidUntil: new Date(expiresAt - 90000).toISOString() };
  } finally {
    abort.abort();
    try { Promise.resolve(response?.body?.cancel?.()).catch(() => {}); } catch { /* No provider or metadata cleanup. */ }
  }
}
