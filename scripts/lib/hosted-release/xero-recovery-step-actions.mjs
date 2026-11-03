import { serverSupabaseConfig } from '../../../api/_supabaseConfig.js';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { parseXeroRecoveryStepPlan, recoveryStepSha256, recoveryStepCanonicalJson, recoveryStepPreparationWindow, validateRecoveryExecutionClock } from './xero-recovery-step-protocol.mjs';

const TOKEN = 'https://identity.xero.com/connect/token';
const ORGANISATIONS = 'https://api.xero.com/api.xro/2.0/Organisations';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const need = (v, code = 'XERO_STEP_NATIVE_REFUSED') => { if (!v) throw Object.assign(new Error(code), { code, retryable: false }); };
const text = v => typeof v === 'string' && v.length > 0;
const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const iso = v => { need(text(v) && Number.isFinite(Date.parse(v))); return new Date(v).toISOString(); };

/** Only fixed native financial actions plus the real private CAS REST client.
 * No coordinator, guard receipts, provider retry, arbitrary URL/SQL, token
 * export, automatic next step or catch-and-cleanup action exists here. The
 * host accepts one admitted request; the ORIGINAL local native guard owns the
 * current lease and actual HTTP acknowledgement between requests.
 */
export function createXeroRecoveryStepResources({ planJson, privateEnvironment, rateSnapshot, fetchImpl = fetch, now = Date.now } = {}) {
  const { plan, planSha256 } = parseXeroRecoveryStepPlan(planJson), b = plan.binding;
  need(plain(privateEnvironment) && typeof rateSnapshot === 'function' && typeof fetchImpl === 'function' && typeof now === 'function');
  const storage = serverSupabaseConfig(privateEnvironment), origin = `https://${fcosConnectionIdentifier('supabase', 'Project ref')}.supabase.co`;
  need(storage.configured && new URL(storage.url).origin === origin && text(privateEnvironment.XERO_CLIENT_ID) && text(privateEnvironment.XERO_CLIENT_SECRET));
  const clientId = privateEnvironment.XERO_CLIENT_ID, clientSecret = privateEnvironment.XERO_CLIENT_SECRET;
  const headers = Object.freeze({ apikey: storage.key, authorization: `Bearer ${storage.key}`, accept: 'application/json',
    'content-type': 'application/json', 'accept-profile': 'public', 'content-profile': 'public' });
  const counts = { databaseRequests: 0, oauthPosts: 0, accountingGets: 0 };
  const claims = new WeakMap(), window = recoveryStepPreparationWindow(plan);
  let execution;
  const deadline = () => execution?.executionDeadlineAt ?? window.notAfter;
  const active = () => need(Number.isSafeInteger(now()) && now() >= window.issuedAt && now() < deadline(), 'XERO_STEP_EXPIRED');
  async function http(url, init, { preserveBody = false, captureOnly = false, deadlineAt = deadline(), readback = false, callerSignal } = {}) {
    need(callerSignal instanceof AbortSignal);
    if (!captureOnly) need(!callerSignal.aborted, 'XERO_STEP_CANCELLED');
    if (!captureOnly && !readback) active();
    need(!preserveBody || url === TOKEN && init.method === 'POST');
    need(!captureOnly || url === `${origin}/rest/v1/rpc/xero_recovery_custody_capture` && init.method === 'POST');
    need(!readback || url.startsWith(`${origin}/rest/v1/rpc/xero_recovery_step_readback?`) && init.method === 'GET');
    const ms = captureOnly ? 15000 : preserveBody || readback ? 30000 : Math.min(30000, deadline() - now(), deadlineAt - now());
    need(ms > 0 && Number.isFinite(ms), 'XERO_STEP_EXPIRED');
    let timer, reader, cancel; const abort = new AbortController();
    // Only an already-dispatched token POST and its single capture may finish
    // under the separately approved preservation exception after disconnect.
    const detachable = preserveBody || captureOnly;
    const combined = detachable ? abort.signal : AbortSignal.any([abort.signal, callerSignal]);
    const request = async () => {
      if (url.startsWith(`${origin}/rest/`)) counts.databaseRequests++;
      else if (url === TOKEN) counts.oauthPosts++;
      else if (url === ORGANISATIONS) counts.accountingGets++;
      else need(false);
      const response = await fetchImpl(url, { ...init, redirect: 'error', cache: 'no-store', signal: combined });
      need(!response.redirected && (!response.url || response.url === url)
        && /^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') || '') && response.body?.getReader
        && (!response.headers.get('content-length') || Number(response.headers.get('content-length')) <= 65536), 'XERO_STEP_HTTP_UNKNOWN');
      reader = response.body.getReader(); const chunks = []; let size = 0;
      for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; need(size <= 65536, 'XERO_STEP_HTTP_UNKNOWN'); chunks.push(Buffer.from(r.value)); }
      if (!detachable) need(!callerSignal.aborted, 'XERO_STEP_CANCELLED');
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      need(response.ok && response.status >= 200 && response.status < 300, 'XERO_STEP_HTTP_REJECTED');
      return { data, status: response.status, headers: response.headers };
    };
    const cancelled = new Promise((_, reject) => {
      cancel = () => { abort.abort(); reject(Error('XERO_STEP_CANCELLED')); };
      if (!detachable) callerSignal.addEventListener('abort', cancel, { once: true });
    });
    try { return await Promise.race([request(), cancelled, new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(Error('XERO_STEP_HTTP_UNKNOWN')); }, ms); })]); }
    catch { throw Object.assign(new Error('XERO_STEP_HTTP_UNKNOWN'), { code: 'XERO_STEP_HTTP_UNKNOWN', retryable: false }); }
    finally { clearTimeout(timer); if (cancel) callerSignal.removeEventListener('abort', cancel); abort.abort(); if (reader) void reader.cancel().catch(() => {}); }
  }
  const rpc = async (name, args, options) => (await http(`${origin}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) }, options)).data;
  async function rows(table, select, filters, callerSignal) {
    const url = new URL(`/rest/v1/${table}`, origin); url.searchParams.set('select', select); url.searchParams.set('limit', '2');
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
    const value = (await http(url.href, { method: 'GET', headers }, { callerSignal })).data;
    need(Array.isArray(value) && value.length <= 2); return value;
  }
  async function connection(version, credentials = false, callerSignal) {
    const select = 'id,tenant_id,tenant_name,token_version,expires_at' + (credentials ? ',access_token,refresh_token,scope' : '');
    const value = await rows('xero_contact_sync_connections', select, { id: 'eq.primary' }, callerSignal);
    need(value.length === 1); const row = value[0];
    need(row.id === 'primary' && row.tenant_id === b.tenantId && row.token_version === version && Number.isFinite(Date.parse(row.expires_at)), 'XERO_STEP_SESSION_CHANGED');
    if (credentials) need(text(row.access_token) && text(row.refresh_token)); return row;
  }
  const custody = Object.freeze({ p_operation_id: b.operationId, p_owner_thread_id: b.ownerThreadId, p_tenant_id: b.tenantId,
    p_expected_version: b.expectedVersion, p_refresh_lease_id: b.refreshLeaseId, p_approval_sha256: b.approvalSha256,
    p_source_sha256: b.sourceSha256, p_binding_sha256: b.bindingSha256 });
  const state = (v, expected) => need(v?.operationId === b.operationId && v.state === expected, 'XERO_STEP_CUSTODY_UNKNOWN');
  const args = input => {
    need(input.planJson === planJson && input.planSha256 === planSha256 && input.requestSha256 === recoveryStepSha256(input.requestJson));
    return { p_plan_json: planJson, p_plan_sha256: planSha256, p_request_json: input.requestJson, p_request_sha256: input.requestSha256 };
  };
  const store = Object.freeze({
    async claim(input) {
      const result = await rpc('xero_recovery_step_claim', args(input), { callerSignal: input.signal });
      const request = JSON.parse(input.requestJson);
      if (plan.schemaVersion === 3) execution = validateRecoveryExecutionClock(result.execution, plan, now());
      need(result?.decision === 'execute' && result.state === 'submitted_unknown' && result.operationId === b.operationId
        && result.planSha256 === planSha256 && result.requestSha256 === input.requestSha256
        && result.step === request.step && result.submissionId === request.submissionId && plain(result.checkpoint));
      // Only this actual native claim acknowledgement mints a process-private,
      // one-use action capability. Saved/reconstructed JSON is never executable.
      claims.set(result, { step: result.step, checkpoint: recoveryStepCanonicalJson(result.checkpoint) });
      return result;
    },
    complete: input => rpc('xero_recovery_step_complete', { ...args(input), p_result_json: input.resultJson }, { callerSignal: input.signal }),
    async readback(input) {
      need(input.operationId === b.operationId && input.planSha256 === planSha256);
      const url = new URL('/rest/v1/rpc/xero_recovery_step_readback', origin);
      url.searchParams.set('p_operation_id', b.operationId); url.searchParams.set('p_plan_sha256', planSha256);
      return (await http(url.href, { method: 'GET', headers }, { readback: true, callerSignal: input.signal })).data;
    },
  });
  return Object.freeze({ store, metrics: () => ({ ...counts }),
    async execute({ step, checkpoint, claim, signal }) {
      need(signal instanceof AbortSignal && !signal.aborted);
      if (plan.schemaVersion === 3) execution = validateRecoveryExecutionClock(claim?.execution, plan, now());
      active();
      const actionRpc = (name, args, options = {}) => rpc(name, args, { ...options, callerSignal: signal });
      const actionRows = (table, select, filters) => rows(table, select, filters, signal);
      const actionConnection = (version, credentials = false) => connection(version, credentials, signal); need(plain(checkpoint));
      const capability = claims.get(claim);
      need(capability && capability.step === step && capability.checkpoint === recoveryStepCanonicalJson(checkpoint), 'XERO_STEP_NATIVE_CLAIM_REQUIRED');
      claims.delete(claim); // Consume BEFORE any dependency read or external action.
      if (step === 'preflight') {
        const row = await actionConnection(b.expectedVersion);
        const s = await actionRpc('xero_shared_status', { p_tenant_id: b.tenantId });
        need(s?.tenantId === b.tenantId && s.reserve === 200 && s.minuteLimit === 45 && s.inFlightLimit === 2
          && s.inFlight === 0 && s.reservedCalls === 0 && s.unresolvedWrites === 0 && Number.isSafeInteger(s.minuteCalls) && s.minuteCalls < 45
          && (s.availableCalls === null || Number.isSafeInteger(s.availableCalls) && s.availableCalls >= 200)
          && (s.retryAt === null || Number.isFinite(Date.parse(s.retryAt)) && Date.parse(s.retryAt) <= now()), 'XERO_STEP_SHARED_HOLD');
        const refresh = await actionRows('xero_token_refresh_leases', 'tenant_id,expected_version,state', { connection_id: 'eq.primary' });
        need(refresh.length <= 1 && !refresh.some(r => r.tenant_id === b.tenantId && r.expected_version === b.expectedVersion && ['refreshing', 'uncertain', 'revoked'].includes(r.state)), 'XERO_STEP_REFRESH_HOLD');
        const grants = await actionRows('xero_shared_probe_grants', 'id', { tenant_id: `eq.${b.tenantId}`, consumed_at: 'is.null', expires_at: `gt.${new Date(now()).toISOString()}` });
        const prior = await actionRows('xero_shared_probe_grants', 'id', { tenant_id: `eq.${b.tenantId}`, reason: `like.*${b.approvalSha256}*` });
        const request = await actionRows('xero_shared_requests', 'id', { id: `eq.${b.requestId}` });
        const captured = await actionRows('xero_recovery_token_custody', 'operation_id,state', { approval_sha256: `eq.${b.approvalSha256}` });
        need(grants.length === 0 && prior.length === 0 && request.length === 0 && captured.length === 0, 'XERO_STEP_PRIOR_OUTCOME_HOLD');
        const observedAt = new Date(now()).toISOString();
        return { renewalRequired: Date.parse(row.expires_at) <= Date.parse(observedAt) + 60000,
          tokenVersion: row.token_version, expiresAt: iso(row.expires_at), observedAt };
      }
      if (step === 'custodyPrepare') { state(await actionRpc('xero_recovery_custody_prepare', custody), 'prepared'); return { state: 'prepared' }; }
      if (step === 'refreshClaim') {
        const result = await actionRpc('xero_refresh_claim', { p_tenant_id: b.tenantId, p_expected_version: b.expectedVersion, p_lease_id: b.refreshLeaseId });
        need(result?.state === 'claimed' && result.leaseId === b.refreshLeaseId, 'XERO_STEP_REFRESH_HOLD'); return { state: 'claimed' };
      }
      if (step === 'tokenRenewAndCapture') {
        need(checkpoint.preflight?.renewalRequired === true); const row = await actionConnection(b.expectedVersion, true);
        const refresh = await actionRows('xero_token_refresh_leases', 'tenant_id,lease_id,expected_version,state,expires_at', { connection_id: 'eq.primary' });
        need(refresh.length === 1 && refresh[0].tenant_id === b.tenantId && refresh[0].lease_id === b.refreshLeaseId
          && refresh[0].expected_version === b.expectedVersion && refresh[0].state === 'refreshing'
          && Number.isFinite(Date.parse(refresh[0].expires_at)) && Date.parse(refresh[0].expires_at) > now(), 'XERO_STEP_REFRESH_HOLD');
        const at = now(); const { data: token } = await http(TOKEN, { method: 'POST', headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token }).toString() }, { preserveBody: true, callerSignal: signal });
        need(text(token.access_token) && text(token.refresh_token) && Number.isSafeInteger(token.expires_in) && token.expires_in > 0 && token.expires_in <= 86400, 'XERO_STEP_ROTATION_UNKNOWN');
        // NEW proposed one-unit preservation exception, not authority granted by
        // code: at most30s returning-body + ONE15s private capture after an already
        // admitted POST. No later finish/probe/metadata cleanup after unknown.
        state(await actionRpc('xero_recovery_custody_capture', { ...custody, p_connection: { tenantId: b.tenantId,
          accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(at + token.expires_in * 1000).toISOString(),
          scope: text(token.scope) ? token.scope : typeof row.scope === 'string' ? row.scope : '' } }, { captureOnly: true }), 'captured');
        return { state: 'captured' };
      }
      if (step === 'refreshFinish') {
        const v = await actionRpc('xero_recovery_custody_finish', custody); state(v, 'finished'); need(v.tokenVersion === b.expectedVersion + 1);
        return { state: 'finished', tokenVersion: v.tokenVersion };
      }
      if (step === 'sessionVerify') {
        const row = await actionConnection(b.expectedVersion + (checkpoint.preflight?.renewalRequired ? 1 : 0));
        need(Date.parse(row.expires_at) > now()); return { tokenVersion: row.token_version, expiresAt: iso(row.expires_at) };
      }
      if (step === 'probeGrant') {
        const notBefore = new Date(now()).toISOString(); const v = await actionRpc('xero_shared_authorize_probe', { p_tenant_id: b.tenantId, p_id: b.probeId,
          p_actor_id: b.actorId, p_not_before: notBefore, p_reason: `One approved original-owner Organisations quota probe; approval ${b.approvalSha256}; operation ${b.operationId}` });
        need(v?.id === b.probeId && v.tenant_id === b.tenantId && v.actor_id === b.actorId && v.consumed_at === null && iso(v.not_before) === notBefore);
        return { notBefore, expiresAt: iso(v.expires_at) };
      }
      if (step === 'probeAdmission') {
        const v = await actionRpc('xero_shared_admit', { p_tenant_id: b.tenantId, p_id: b.requestId, p_token_version: checkpoint.sessionVerify?.tokenVersion,
          p_method: 'GET', p_resource_key: 'Organisations', p_budget_id: null, p_phase: 'operation', p_probe_id: b.probeId });
        need(v?.requestId === b.requestId && v.tenantId === b.tenantId); return { deadlineAt: iso(v.deadlineAt) };
      }
      if (step === 'organisationsGet') {
        const row = await actionConnection(checkpoint.sessionVerify?.tokenVersion, true);
        const deadlineAt = Math.min(Date.parse(checkpoint.probeAdmission?.deadlineAt), Date.parse(row.expires_at));
        need(Number.isFinite(deadlineAt) && deadlineAt > now());
        const result = await http(ORGANISATIONS, { method: 'GET', headers: { authorization: `Bearer ${row.access_token}`, 'xero-tenant-id': b.tenantId, accept: 'application/json' } }, { deadlineAt, callerSignal: signal });
        const value = result.data?.Organisations; need(Array.isArray(value) && value.length === 1 && UUID.test(value[0]?.OrganisationID)
          && text(value[0]?.Name) && value[0].OrganisationStatus === 'ACTIVE', 'XERO_STEP_ORGANISATION_UNKNOWN');
        const identity = recoveryStepSha256(JSON.stringify({ OrganisationID: value[0].OrganisationID, Name: value[0].Name }));
        need(b.organisationIdentitySha256 === null || identity === b.organisationIdentitySha256, 'XERO_STEP_ORGANISATION_CHANGED');
        const snapshot = rateSnapshot(result.headers, {}, { now: now() });
        if (![null, 'day', 'daily', 'minute', 'app-day', 'app-minute'].includes(snapshot.rateLimitProblem)) snapshot.rateLimitProblem = 'unknown';
        return { status: result.status, snapshot, organisationIdentitySha256: identity,
          storedTenantNameMatches: text(row.tenant_name) ? row.tenant_name === value[0].Name : null };
      }
      if (step === 'probeObservation') {
        const prior = checkpoint.organisationsGet; need(prior?.status >= 200 && prior.status < 300 && plain(prior.snapshot));
        const v = await actionRpc('xero_shared_observe', { p_tenant_id: b.tenantId, p_request_id: b.requestId, p_status: prior.status, p_snapshot: prior.snapshot, p_outcome_unknown: false });
        need(v?.recorded === true && v.superseded !== true); return { recorded: true };
      }
      if (step === 'finalRead') {
        const v = await actionRpc('xero_shared_status', { p_tenant_id: b.tenantId });
        need(v?.tenantId === b.tenantId && v.reserve === 200 && v.inFlight === 0 && v.unresolvedWrites === 0);
        return { allowanceKnown: v.allowanceKnown, availableCalls: v.availableCalls, spendableCalls: v.spendableCalls,
          reserve: 200, retryAt: v.retryAt, observedAt: v.rateLimit?.observedAt || null };
      }
      need(false, 'XERO_STEP_ACTION_FORBIDDEN');
    },
  });
}
