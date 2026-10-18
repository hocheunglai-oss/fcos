import { createHash } from 'node:crypto';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = v => Number.isSafeInteger(v) && v >= 0;
const instant = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const maybeInstant = v => v === null || instant(v);
const need = (ok, code = 'XERO_STEP_PROTOCOL_INVALID') => { if (!ok) throw Object.assign(new Error(code), { code, retryable: false }); };
export const recoveryStepSha256 = text => createHash('sha256').update(text).digest('hex');
export const recoveryStepCanonicalJson = value => JSON.stringify(value, (_, v) => plain(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const XERO_RECOVERY_STEPS = Object.freeze(['preflight', 'custodyPrepare', 'refreshClaim', 'tokenRenewAndCapture', 'refreshFinish',
  'sessionVerify', 'probeGrant', 'probeAdmission', 'organisationsGet', 'probeObservation', 'finalRead']);
const BINDING = ['operationId', 'ownerThreadId', 'tenantId', 'actorId', 'expectedVersion', 'refreshLeaseId', 'probeId', 'requestId',
  'approvalSha256', 'sourceSha256', 'bindingSha256', 'organisationIdentitySha256', 'issuedAt', 'notAfter', 'credentialPreservationCompositeApproved'];
const REQUEST = ['schemaVersion', 'operationId', 'planSha256', 'step', 'submissionId', 'previousResultSha256'];
// A v2 envelope adds preparation runway. It does not restart an execution
// clock, renew an old plan or alter the independent per-call/grant deadlines.
export function recoveryStepPlanMaximumWindowMs(plan) {
  if (plan?.schemaVersion === 1 && plan.kind === 'fcos_xero_recovery_step_plan_v1') return 900000;
  if (plan?.schemaVersion === 2 && plan.kind === 'fcos_xero_recovery_step_plan_v2') return 1800000;
  need(false);
}
function parsed(text, limit) {
  need(typeof text === 'string' && Buffer.byteLength(text) <= limit);
  const value = JSON.parse(text); need(recoveryStepCanonicalJson(value) === text); return value;
}
/** Public plans/hashes are integrity bindings, never authority. The host admits
 * the exact compiled plan/source/destination/nonce independently. No lease JSON
 * or client-selected plan is accepted as proof of the original Mac lease. */
export function parseXeroRecoveryStepPlan(planJson) {
  const plan = parsed(planJson, 16384), b = plan?.binding, maximumWindowMs = recoveryStepPlanMaximumWindowMs(plan);
  need(exact(plan, ['schemaVersion', 'kind', 'binding'])
    && exact(b, BINDING) && HASH.test(b.operationId)
    && ['ownerThreadId', 'tenantId', 'actorId', 'refreshLeaseId', 'probeId', 'requestId'].every(k => UUID.test(b[k]))
    && ['approvalSha256', 'sourceSha256', 'bindingSha256'].every(k => HASH.test(b[k]))
    && (b.organisationIdentitySha256 === null || HASH.test(b.organisationIdentitySha256))
    && Number.isSafeInteger(b.expectedVersion) && b.expectedVersion > 0 && b.expectedVersion < 2147483647
    && Number.isSafeInteger(b.issuedAt) && Number.isSafeInteger(b.notAfter) && b.issuedAt > 0
    && b.notAfter > b.issuedAt && b.notAfter - b.issuedAt <= maximumWindowMs && b.credentialPreservationCompositeApproved === true);
  Object.freeze(b); Object.freeze(plan);
  return { plan, planSha256: recoveryStepSha256(planJson), maximumWindowMs };
}
export function prepareXeroRecoveryStepRequest({ planJson, step, submissionId, previousResultSha256 } = {}) {
  const { plan, planSha256 } = parseXeroRecoveryStepPlan(planJson);
  need(XERO_RECOVERY_STEPS.includes(step) && UUID.test(submissionId)
    && (step === 'preflight' ? previousResultSha256 === null : HASH.test(previousResultSha256)));
  const requestJson = recoveryStepCanonicalJson({ schemaVersion: 1, operationId: plan.binding.operationId, planSha256, step, submissionId, previousResultSha256 });
  return { requestJson, requestSha256: recoveryStepSha256(requestJson), planSha256 };
}
const snapshotKeys = ['rateLimitProblem', 'retryAfterSeconds', 'retryAt', 'dayResetAt', 'observedAt'];
const counterKeys = ['minuteRemaining', 'dayRemaining', 'appMinuteRemaining', 'appDayRemaining'];
export function validateXeroRecoveryStepResult(step, v, binding, checkpoint, now) {
  need(XERO_RECOVERY_STEPS.includes(step) && plain(v) && plain(checkpoint) && Number.isSafeInteger(now));
  let valid = false;
  if (step === 'preflight') valid = exact(v, ['renewalRequired', 'tokenVersion', 'expiresAt', 'observedAt']) && typeof v.renewalRequired === 'boolean'
    && v.tokenVersion === binding.expectedVersion && instant(v.expiresAt) && instant(v.observedAt)
    && Math.abs(now - Date.parse(v.observedAt)) <= 30000 && v.renewalRequired === (Date.parse(v.expiresAt) <= Date.parse(v.observedAt) + 60000);
  if (['custodyPrepare', 'refreshClaim', 'tokenRenewAndCapture'].includes(step)) valid = exact(v, ['state'])
    && v.state === ({ custodyPrepare: 'prepared', refreshClaim: 'claimed', tokenRenewAndCapture: 'captured' })[step];
  if (step === 'refreshFinish') valid = exact(v, ['state', 'tokenVersion']) && v.state === 'finished' && v.tokenVersion === binding.expectedVersion + 1;
  if (step === 'sessionVerify') valid = exact(v, ['tokenVersion', 'expiresAt']) && typeof checkpoint.preflight?.renewalRequired === 'boolean'
    && v.tokenVersion === binding.expectedVersion + (checkpoint.preflight.renewalRequired ? 1 : 0) && instant(v.expiresAt) && Date.parse(v.expiresAt) > now;
  if (step === 'probeGrant') valid = exact(v, ['notBefore', 'expiresAt']) && instant(v.notBefore) && instant(v.expiresAt)
    && Date.parse(v.notBefore) <= now + 30000 && Date.parse(v.expiresAt) > now;
  if (step === 'probeAdmission') valid = exact(v, ['deadlineAt']) && instant(v.deadlineAt) && Date.parse(v.deadlineAt) > now;
  if (step === 'organisationsGet') {
    const s = v.snapshot;
    valid = exact(v, ['status', 'snapshot', 'organisationIdentitySha256', 'storedTenantNameMatches']) && integer(v.status) && v.status >= 200 && v.status < 300
      && HASH.test(v.organisationIdentitySha256) && (binding.organisationIdentitySha256 === null || binding.organisationIdentitySha256 === v.organisationIdentitySha256)
      && [true, false, null].includes(v.storedTenantNameMatches) && plain(s) && snapshotKeys.every(k => Object.hasOwn(s, k))
      && Object.keys(s).every(k => snapshotKeys.includes(k) || counterKeys.includes(k))
      && counterKeys.every(k => !Object.hasOwn(s, k) || integer(s[k]))
      && [null, 'day', 'daily', 'minute', 'app-day', 'app-minute', 'unknown'].includes(s.rateLimitProblem)
      && (s.retryAfterSeconds === null || integer(s.retryAfterSeconds)) && maybeInstant(s.retryAt) && maybeInstant(s.dayResetAt) && instant(s.observedAt);
  }
  if (step === 'probeObservation') valid = exact(v, ['recorded']) && v.recorded === true;
  if (step === 'finalRead') valid = exact(v, ['allowanceKnown', 'availableCalls', 'spendableCalls', 'reserve', 'retryAt', 'observedAt'])
    && typeof v.allowanceKnown === 'boolean' && (v.availableCalls === null || integer(v.availableCalls))
    && (v.spendableCalls === null || integer(v.spendableCalls)) && v.reserve === 200 && maybeInstant(v.retryAt) && maybeInstant(v.observedAt);
  need(valid, 'XERO_STEP_RESULT_INVALID'); return true;
}
export function nextXeroRecoveryStep(step, checkpoint) {
  if (step === 'custodyPrepare') return checkpoint.preflight?.renewalRequired === true ? 'refreshClaim' : 'sessionVerify';
  return XERO_RECOVERY_STEPS[XERO_RECOVERY_STEPS.indexOf(step) + 1] || null;
}
function validateCheckpoint(c, b, now) {
  need(plain(c) && Object.keys(c).every(k => XERO_RECOVERY_STEPS.includes(k)));
  // Stored timestamps were valid at their original action. Do not refresh them
  // or reject historical readback merely because a grant/token is now expired.
  for (const step of XERO_RECOVERY_STEPS) if (Object.hasOwn(c, step)) {
    const result = c[step];
    const historical = step === 'preflight' ? Date.parse(result.observedAt) : step === 'sessionVerify' ? Date.parse(result.expiresAt) - 1
      : step === 'probeGrant' ? Date.parse(result.expiresAt) - 1 : step === 'probeAdmission' ? Date.parse(result.deadlineAt) - 1 : now;
    validateXeroRecoveryStepResult(step, result, b, c, historical);
  }
}

/** One authenticated request => one exact action, never remote auto-progression.
 * store is the real reviewed service-only CAS backend; execute is the fixed
 * native action module. Neither has a fallback. The Mac's genuine native guard
 * alone issues requests after current lease/intent assertions and records the
 * actual native HTTP command result. previousResultSha256 is CAS, NOT proof of
 * that local acknowledgement. The host separately authenticates request nonce,
 * exact deployment/plan and real own bearer on every request.
 *
 * Unknown claim/action/complete means NO next remote call, including a failure
 * marker or cleanup. A new separately admitted GET-only owner invocation may
 * read saved state. An unknown action is never retried, expired or taken over.
 */
export function createXeroRecoveryStepProtocol({ planJson, authenticate, store, execute, now = Date.now } = {}) {
  const { plan, planSha256 } = parseXeroRecoveryStepPlan(planJson), b = plan.binding;
  need(typeof authenticate === 'function' && ['claim', 'complete', 'readback'].every(k => typeof store?.[k] === 'function')
    && typeof execute === 'function' && typeof now === 'function');
  let busy = false, terminal = false;
  const active = signal => need(signal instanceof AbortSignal && !signal.aborted && !terminal && Number.isSafeInteger(now()) && now() >= b.issuedAt && now() < b.notAfter, 'XERO_STEP_TERMINAL');
  async function actor(bearer, signal) {
    need(signal instanceof AbortSignal && !signal.aborted);
    need(typeof bearer === 'string' && bearer.length > 0);
    const a = await authenticate({ bearer, actorId: b.actorId, binding: b, signal });
    need(a?.id === b.actorId && a.active === true && a.readOnlyCi === false && ['administrator', 'general_manager'].includes(a.role)
      && a.workspace === true && a.xeroPortalManage === true && Number.isSafeInteger(a.capturedAt)
      && a.capturedAt <= now() && now() - a.capturedAt <= 15000, 'XERO_STEP_ACTOR_REQUIRED');
  }
  const matches = (v, request, requestSha256) => plain(v) && v.operationId === b.operationId && v.planSha256 === planSha256
    && v.requestSha256 === requestSha256 && v.submissionId === request.submissionId && v.step === request.step;
  return Object.freeze({
    async submit({ rawRequestJson, bearer, signal } = {}) {
      need(!busy && !terminal, 'XERO_STEP_TERMINAL'); busy = true;
      let request, validated = false;
      try {
        active(signal); request = parsed(rawRequestJson, 2048);
        need(exact(request, REQUEST) && request.schemaVersion === 1 && request.operationId === b.operationId && request.planSha256 === planSha256
          && XERO_RECOVERY_STEPS.includes(request.step) && UUID.test(request.submissionId)
          && (request.step === 'preflight' ? request.previousResultSha256 === null : HASH.test(request.previousResultSha256)));
        validated = true;
        await actor(bearer, signal); active(signal);
        const requestSha256 = recoveryStepSha256(rawRequestJson);
        const args = { planJson, planSha256, requestJson: rawRequestJson, requestSha256, signal };
        const claim = await store.claim(args); active(signal);
        need(matches(claim, request, requestSha256) && claim.decision === 'execute' && claim.state === 'submitted_unknown'
          && claim.nextStep === null && claim.lastResultSha256 === request.previousResultSha256, 'XERO_STEP_CLAIM_UNKNOWN');
        validateCheckpoint(claim.checkpoint, b, now());
        const result = await execute({ step: request.step, checkpoint: structuredClone(claim.checkpoint), claim, signal });
        active(signal); validateXeroRecoveryStepResult(request.step, result, b, claim.checkpoint, now());
        const resultJson = recoveryStepCanonicalJson(result), resultSha256 = recoveryStepSha256(resultJson);
        const ack = await store.complete({ ...args, resultJson }); active(signal);
        const checkpoint = { ...claim.checkpoint, [request.step]: result }, nextStep = nextXeroRecoveryStep(request.step, checkpoint);
        need(matches(ack, request, requestSha256) && ack.state === (nextStep === null ? 'complete' : 'ready')
          && ack.nextStep === nextStep && ack.resultSha256 === resultSha256 && ack.lastResultSha256 === resultSha256,
        'XERO_STEP_COMPLETION_UNKNOWN');
        validateCheckpoint(ack.checkpoint, b, now());
        need(recoveryStepCanonicalJson(ack.checkpoint) === recoveryStepCanonicalJson(checkpoint), 'XERO_STEP_CHECKPOINT_CHANGED');
        return { kind: 'fcos_xero_recovery_step_result_v1', operationId: b.operationId, planSha256, requestSha256,
          step: request.step, submissionId: request.submissionId, state: ack.state, nextStep, resultSha256, result,
          executionAuthorityGranted: false, qualificationAccepted: false };
      } catch {
        terminal = true;
        throw Object.assign(new Error('XERO_STEP_STOPPED_OWNER_READBACK_REQUIRED'), { code: 'XERO_STEP_STOPPED_OWNER_READBACK_REQUIRED',
          operationId: b.operationId, step: validated ? request.step : null, submissionId: validated ? request.submissionId : null,
          ownerReadbackRequired: true, retryable: false });
      } finally { busy = false; }
    },
    async readback({ bearer, signal } = {}) {
      need(!busy && !terminal, 'XERO_STEP_TERMINAL'); busy = true;
      try {
        await actor(bearer, signal);
        need(!signal.aborted);
        const value = await store.readback({ operationId: b.operationId, planSha256, signal });
        need(!signal.aborted);
        need(value?.operationId === b.operationId && value.planSha256 === planSha256 && value.executionAuthorityGranted === false
          && ['ready', 'complete', 'submitted_unknown'].includes(value.state)
          && XERO_RECOVERY_STEPS.includes(value.currentStep) && UUID.test(value.submissionId)
          && (value.lastResultSha256 === null || HASH.test(value.lastResultSha256))
          && (value.state === 'ready' ? XERO_RECOVERY_STEPS.includes(value.nextStep) : value.nextStep === null), 'XERO_STEP_READBACK_UNKNOWN');
        validateCheckpoint(value.checkpoint, b, now());
        // Return a newly selected safe projection, never arbitrary backend keys.
        return { kind: 'fcos_xero_recovery_step_readback_v1', operationId: b.operationId, planSha256, state: value.state,
          nextStep: value.nextStep, currentStep: value.currentStep, submissionId: value.submissionId,
          lastResultSha256: value.lastResultSha256, checkpoint: value.checkpoint, executionAuthorityGranted: false, qualificationAccepted: false };
      } catch {
        terminal = true; throw Object.assign(new Error('XERO_STEP_READBACK_UNKNOWN'), { code: 'XERO_STEP_READBACK_UNKNOWN', retryable: false });
      } finally { busy = false; }
    },
  });
}
