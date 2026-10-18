import { timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { createXeroRecoveryActorAuthenticator } from './xero-recovery-actor-auth.mjs';
import { createXeroRecoveryStepProtocol, parseXeroRecoveryStepPlan, recoveryStepCanonicalJson as canonical,
  recoveryStepSha256 as hash, XERO_RECOVERY_STEPS } from './xero-recovery-step-protocol.mjs';
import { createXeroRecoveryStepResources } from './xero-recovery-step-actions.mjs';
// Byte-identical to f3472492 api/_xeroRateLimit.js, SHA-256
// 7620261346f77bf32eb0b611bd7d62521832480b4ad9bfb9d8488fdfc419017e.
import { xeroRateLimitSnapshot } from '../../../api/_xeroRateLimit.js';

const REPOSITORY = 'hocheunglai-oss/fcos';
const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS = `${ISSUER}/.well-known/jwks`;
const ENVIRONMENT = 'fcos-hosted-verification';
const PATH = '/xero-recovery';
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const need = value => { if (!value) throw Error('XERO_RECOVERY_HOST_REFUSED'); };
const jsonResponse = (res, status, body) => {
  if (res.destroyed || res.writableEnded) return;
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-length': String(data.length) });
  res.end(data);
};
function waitFor(promise, signal, timeoutMs) {
  let timer, abort;
  const stop = new Promise((_, reject) => {
    abort = () => reject(Error('XERO_RECOVERY_HOST_REFUSED'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    timer = setTimeout(abort, timeoutMs);
  });
  return Promise.race([promise, stop]).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', abort); });
}
async function readKeys(fetchImpl, signal) {
  const response = await fetchImpl(JWKS, { method: 'GET', headers: { accept: 'application/json' },
    redirect: 'error', cache: 'no-store', credentials: 'omit', signal });
  let reader;
  try {
    need(!signal.aborted && response.status === 200 && response.ok && !response.redirected && (!response.url || response.url === JWKS)
      && /^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') || '') && response.body?.getReader);
    const length = response.headers.get('content-length');
    need(length === null || /^\d+$/.test(length) && Number(length) <= 65536);
    reader = response.body.getReader(); const chunks = []; let size = 0;
    for (;;) { const part = await reader.read(); need(!signal.aborted); if (part.done) break;
      size += part.value.byteLength; need(size <= 65536); chunks.push(Buffer.from(part.value)); }
    const keys = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    need(plain(keys) && Array.isArray(keys.keys) && keys.keys.length > 0 && keys.keys.length <= 8
      && keys.keys.every(key => plain(key) && key.kty === 'RSA' && !['d', 'p', 'q', 'dp', 'dq', 'qi'].some(field => Object.hasOwn(key, field))));
    return createLocalJWKSet(keys);
  } finally { try { void (reader ? reader.cancel() : response.body?.cancel()).catch(() => {}); } catch { /* No raw data escapes. */ } }
}
function body(req, signal, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const cleanup = () => { clearTimeout(timer); req.removeListener('data', data); req.removeListener('end', end); signal.removeEventListener('abort', abort); };
    const fail = () => { cleanup(); reject(Error('XERO_RECOVERY_HOST_REFUSED')); };
    const abort = fail;
    const data = chunk => { size += chunk.length; if (size > limit) return fail(); chunks.push(Buffer.from(chunk)); };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(fail, 10000);
    req.on('data', data); req.once('end', end); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) fail();
  });
}
const requestFields = ['schemaVersion', 'operationId', 'planSha256', 'step', 'submissionId', 'previousResultSha256'];
function requestJson(bytes, plan, planSha256) {
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes), value = JSON.parse(raw);
  need(exact(value, requestFields) && canonical(value) === raw && value.schemaVersion === 1
    && value.operationId === plan.binding.operationId && value.planSha256 === planSha256 && XERO_RECOVERY_STEPS.includes(value.step)
    && UUID.test(value.submissionId || '') && (value.step === 'preflight' ? value.previousResultSha256 === null : HASH.test(value.previousResultSha256 || '')));
  return raw;
}
function safeResult(result, secrets) {
  const allowed = new Set(['kind', 'operationId', 'planSha256', 'requestSha256', 'step', 'submissionId', 'state', 'nextStep',
    'resultSha256', 'result', 'executionAuthorityGranted', 'qualificationAccepted', 'currentStep', 'lastResultSha256', 'checkpoint',
    ...XERO_RECOVERY_STEPS, 'renewalRequired', 'tokenVersion', 'expiresAt', 'observedAt', 'notBefore', 'deadlineAt', 'status', 'snapshot',
    'organisationIdentitySha256', 'storedTenantNameMatches', 'rateLimitProblem', 'retryAfterSeconds', 'retryAt', 'dayResetAt',
    'minuteRemaining', 'dayRemaining', 'appMinuteRemaining', 'appDayRemaining', 'recorded', 'allowanceKnown', 'availableCalls', 'spendableCalls', 'reserve']);
  const walk = (value, depth = 0) => {
    need(depth <= 5);
    if (plain(value)) { for (const [key, item] of Object.entries(value)) { need(allowed.has(key)); walk(item, depth + 1); } }
    else need(value === null || typeof value === 'boolean' || Number.isSafeInteger(value)
      || typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
      && !secrets.some(secret => secret.length >= 8 && value.includes(secret)));
  };
  walk(result); const text = JSON.stringify(result); need(Buffer.byteLength(text) <= 16384); return JSON.parse(text);
}

/** Native private HTTPS endpoint, not a credential destination or financial
 * approval. All policy inputs come from immutable trusted deployment code.
 * OIDC authenticates the exact GitHub carrier only; original approval, source,
 * owner lineage, real own actor admission and durable SQL CAS remain separate.
 * TLS must reach req.socket; forwarded headers cannot attest transport. A TLS
 * terminating platform needs a separately reviewed ingress adapter/host binding.
 * No live job metadata credential is assumed: signed run identity is checked,
 * but current job status/continued execution is not independently observed.
 */
export function createXeroRecoveryHost(options = {}) {
  try {
    need(exact(options, ['planJson', 'actorBinding', 'ownership', 'caller', 'publicOrigin', 'requestNonceSha256', 'privateEnvironment',
      ...['fetchImpl', 'now', 'githubJwks', 'fcunoJwks'].filter(key => Object.hasOwn(options, key))]));
    const { planJson, actorBinding, ownership, caller, publicOrigin, requestNonceSha256, privateEnvironment,
      fetchImpl = fetch, now = Date.now, githubJwks, fcunoJwks } = options;
    const { plan, planSha256 } = parseXeroRecoveryStepPlan(planJson), b = plan.binding;
    need(exact(actorBinding, ['actorId', 'emailSha256', 'accessRevision']) && actorBinding.actorId === b.actorId
      && HASH.test(actorBinding.emailSha256) && Number.isSafeInteger(actorBinding.accessRevision) && actorBinding.accessRevision > 0);
    need(exact(ownership, ['featuresOwnerThreadId', 'historicalOwnerThreadIds', 'approvalSha256', 'sourceSha256', 'controllerSha'])
      && UUID.test(ownership.featuresOwnerThreadId) && Array.isArray(ownership.historicalOwnerThreadIds)
      && ownership.historicalOwnerThreadIds.length > 0 && ownership.historicalOwnerThreadIds.length <= 16
      && ownership.historicalOwnerThreadIds.every(id => UUID.test(id)) && ownership.historicalOwnerThreadIds.includes(b.ownerThreadId)
      && ownership.approvalSha256 === b.approvalSha256 && ownership.sourceSha256 === b.sourceSha256 && SHA.test(ownership.controllerSha));
    need(exact(caller, ['ref', 'sha', 'workflowRef', 'workflowSha', 'jobWorkflowRef', 'jobWorkflowSha', 'runId', 'environment', 'subject', 'audience'])
      && /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9_./-]{0,150}$/.test(caller.ref) && !caller.ref.includes('..')
      && SHA.test(caller.sha) && SHA.test(caller.workflowSha) && caller.sha === caller.workflowSha
      && caller.jobWorkflowSha === ownership.controllerSha && /^[1-9][0-9]{0,19}$/.test(caller.runId)
      && caller.workflowRef.startsWith(`${REPOSITORY}/.github/workflows/`) && caller.workflowRef.endsWith(`.yml@${caller.ref}`)
      && caller.jobWorkflowRef.startsWith(`${REPOSITORY}/.github/workflows/`) && caller.jobWorkflowRef.endsWith(`.yml@${caller.jobWorkflowSha}`)
      && caller.environment === ENVIRONMENT && caller.subject === `repo:${REPOSITORY}:environment:${ENVIRONMENT}`);
    const origin = new URL(publicOrigin);
    need(origin.protocol === 'https:' && origin.origin === publicOrigin && !origin.username && !origin.password
      && caller.audience === `${publicOrigin}${PATH}` && HASH.test(requestNonceSha256) && typeof fetchImpl === 'function' && typeof now === 'function');
    const envKeys = ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'];
    need(exact(privateEnvironment, envKeys) && envKeys.every(key => typeof privateEnvironment[key] === 'string' && privateEnvironment[key].length > 0 && privateEnvironment[key].length <= 16384));
    const environment = Object.freeze({ ...privateEnvironment }), actorPolicy = Object.freeze({ ...actorBinding });
    const carrier = Object.freeze({ ...caller });
    const authenticator = createXeroRecoveryActorAuthenticator({ env: environment, fetchImpl, now, ...(fcunoJwks === undefined ? {} : { jwks: fcunoJwks }) });
    // Retain only the resources' proposed already-dispatched OAuth body plus
    // single bounded private capture exception. Constructing this host grants
    // no approval to exercise that exception or any financial action.
    const resources = createXeroRecoveryStepResources({ planJson, privateEnvironment: environment, rateSnapshot: xeroRateLimitSnapshot, fetchImpl, now });
    let busy = false, submissionsStopped = false;
    return async function xeroRecoveryHost(req, res) {
      const controller = new AbortController(), signal = controller.signal;
      const cancel = () => controller.abort();
      const premature = () => { if (!res.writableFinished) cancel(); };
      req.once('aborted', cancel); req.once('error', cancel); res.once('close', premature); res.once('error', cancel);
      const deadline = setTimeout(cancel, 60000);
      let locked = false, submitted = false, identityDeadline;
      try {
        need(req.socket?.encrypted === true && !signal.aborted && req.url === PATH && ['GET', 'POST'].includes(req.method));
        need(Array.isArray(req.rawHeaders) && req.rawHeaders.length <= 100);
        const headers = new Map(); let headerBytes = 0;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const key = req.rawHeaders[i].toLowerCase(), value = req.rawHeaders[i + 1];
          headerBytes += Buffer.byteLength(key) + Buffer.byteLength(value);
          need(!headers.has(key) && !/[\r\n]/.test(value)); headers.set(key, value);
        }
        need(headerBytes <= 65536 && headers.get('host') === origin.host && !headers.has('transfer-encoding')
          && !headers.has('cookie') && !headers.has('proxy-authorization'));
        const oidc = headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
        const bearer = headers.get('x-fcos-owner-bearer'), providerAccessToken = headers.get('x-fcos-provider-access-token');
        const nonce = headers.get('x-fcos-recovery-nonce');
        need([oidc, bearer, providerAccessToken].every(token => typeof token === 'string' && token.length <= 16384 && JWT.test(token))
          && typeof nonce === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(nonce)
          && timingSafeEqual(Buffer.from(hash(nonce), 'hex'), Buffer.from(requestNonceSha256, 'hex')));
        const length = headers.get('content-length');
        if (req.method === 'POST') need(headers.get('content-type') === 'application/json' && typeof length === 'string' && /^[1-9][0-9]{0,3}$/.test(length) && Number(length) <= 2048);
        else need(!headers.has('content-type') && (length === undefined || length === '0'));
        need(!busy && !(req.method === 'POST' && submissionsStopped)); busy = true; locked = true;
        const bytes = await body(req, signal, req.method === 'POST' ? 2048 : 0);
        need(!signal.aborted && (length === undefined || bytes.length === Number(length)));
        const rawRequestJson = req.method === 'POST' ? requestJson(bytes, plan, planSha256) : null;
        const keySignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        const key = githubJwks === undefined ? await waitFor(readKeys(fetchImpl, keySignal), keySignal, 15000) : githubJwks;
        const { payload: claims } = await waitFor(jwtVerify(oidc, key, { issuer: ISSUER, audience: carrier.audience,
          algorithms: ['RS256'], currentDate: new Date(now()) }), signal, 15000);
        const seconds = Math.floor(now() / 1000);
        need(!signal.aborted && claims.aud === carrier.audience && claims.sub === carrier.subject && claims.environment === carrier.environment
          && claims.repository === REPOSITORY && claims.repository_id === '1278654816' && claims.repository_owner === 'hocheunglai-oss'
          && claims.actor === 'hocheunglai-oss' && claims.actor_id === '265701760' && claims.ref === carrier.ref && claims.ref_type === 'branch'
          && [true, 'true'].includes(claims.ref_protected) && claims.sha === carrier.sha && claims.workflow_sha === carrier.workflowSha
          && claims.workflow_ref === carrier.workflowRef && claims.job_workflow_ref === carrier.jobWorkflowRef && claims.job_workflow_sha === carrier.jobWorkflowSha
          && claims.run_id === carrier.runId && claims.run_attempt === '1' && claims.event_name === 'workflow_dispatch' && claims.runner_environment === 'github-hosted'
          && typeof claims.jti === 'string' && claims.jti.length > 0 && claims.jti.length <= 500
          && Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp) && claims.iat > 0 && claims.exp > seconds
          && claims.exp > claims.iat && claims.exp - claims.iat <= 300 && claims.iat <= seconds + 30 && seconds - claims.iat <= 300);
        identityDeadline = setTimeout(cancel, Math.max(0, claims.exp * 1000 - now()));
        const protocol = createXeroRecoveryStepProtocol({ planJson, store: resources.store, execute: resources.execute, now,
          authenticate: async input => { need(input.bearer === bearer && input.actorId === b.actorId && canonical(input.binding) === canonical(b));
            const actor = await authenticator.authenticate({ bearer, providerAccessToken, actorId: b.actorId, binding: actorPolicy, signal: input.signal });
            // All three independently authenticated identities must remain live
            // throughout ordinary work, including an already-pending SQL claim.
            const expiresAt = Math.min(claims.exp * 1000, actor.sourceBinding.providerExpiresAt, actor.sourceBinding.supabaseSessionExpiresAt);
            need(!signal.aborted && Number.isSafeInteger(expiresAt) && expiresAt > now());
            clearTimeout(identityDeadline); identityDeadline = setTimeout(cancel, Math.max(0, expiresAt - now()));
            return actor; } });
        let result;
        if (req.method === 'POST') { submitted = true; result = await protocol.submit({ rawRequestJson, bearer, signal }); }
        else result = await protocol.readback({ bearer, signal });
        need(!signal.aborted);
        jsonResponse(res, 200, safeResult(result, [oidc, bearer, providerAccessToken, environment.SUPABASE_SERVICE_ROLE_KEY, environment.XERO_CLIENT_SECRET]));
      } catch {
        if (submitted) submissionsStopped = true;
        jsonResponse(res, submitted ? 503 : 403, { error: submitted ? 'XERO_RECOVERY_HOST_STOPPED_OWNER_READBACK_REQUIRED' : 'XERO_RECOVERY_HOST_REFUSED',
          ownerReadbackRequired: submitted, retryable: false });
      } finally {
        clearTimeout(deadline); clearTimeout(identityDeadline); controller.abort();
        req.removeListener('aborted', cancel); req.removeListener('error', cancel); res.removeListener('close', premature); res.removeListener('error', cancel);
        if (locked) busy = false;
      }
    };
  } catch { throw Object.assign(new Error('XERO_RECOVERY_HOST_CONSTRUCTION_REFUSED'), { code: 'XERO_RECOVERY_HOST_CONSTRUCTION_REFUSED' }); }
}
