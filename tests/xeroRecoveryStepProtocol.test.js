import test from 'node:test';
import assert from 'node:assert/strict';
import { createXeroRecoveryStepProtocol, prepareXeroRecoveryStepRequest, recoveryStepCanonicalJson as json,
  recoveryStepSha256 as sha, parseXeroRecoveryStepPlan } from '../scripts/lib/hosted-release/xero-recovery-step-protocol.mjs';

const T = Date.parse('2026-10-18T11:00:00Z');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const base = () => ({ operationId: sha('original-operation'), ownerThreadId: id(1), actorId: id(2), tenantId: id(3), expectedVersion: 449,
  refreshLeaseId: id(4), probeId: id(5), requestId: id(6), approvalSha256: sha('approval'), sourceSha256: sha('source'),
  bindingSha256: sha('host-binding'), organisationIdentitySha256: null, issuedAt: T, notAfter: T + 900000, credentialPreservationCompositeApproved: true });
const sequence = renew => renew ? ['preflight', 'custodyPrepare', 'refreshClaim', 'tokenRenewAndCapture', 'refreshFinish', 'sessionVerify',
  'probeGrant', 'probeAdmission', 'organisationsGet', 'probeObservation', 'finalRead'] : ['preflight', 'custodyPrepare', 'sessionVerify', 'probeGrant', 'probeAdmission', 'organisationsGet', 'probeObservation', 'finalRead'];
const outcome = (step, renew) => ({
  preflight: { renewalRequired: renew, tokenVersion: 449, expiresAt: new Date(T + (renew ? -1 : 3600000)).toISOString(), observedAt: new Date(T).toISOString() },
  custodyPrepare: { state: 'prepared' }, refreshClaim: { state: 'claimed' }, tokenRenewAndCapture: { state: 'captured' },
  refreshFinish: { state: 'finished', tokenVersion: 450 }, sessionVerify: { tokenVersion: renew ? 450 : 449, expiresAt: new Date(T + 1800000).toISOString() },
  probeGrant: { notBefore: new Date(T).toISOString(), expiresAt: new Date(T + 300000).toISOString() },
  probeAdmission: { deadlineAt: new Date(T + 120000).toISOString() },
  organisationsGet: { status: 200, snapshot: { dayRemaining: 999, rateLimitProblem: null, retryAfterSeconds: null, retryAt: null, dayResetAt: null, observedAt: new Date(T).toISOString() },
    organisationIdentitySha256: sha('observed-org'), storedTenantNameMatches: true }, probeObservation: { recorded: true },
  finalRead: { allowanceKnown: true, availableCalls: 999, spendableCalls: 799, reserve: 200, retryAt: null, observedAt: new Date(T).toISOString() },
})[step];

// This in-memory backend is a deterministic failure fixture, NOT native DB,
// actor or lease proof. Separate SQL tests cover the actual service-only CAS.
function fixture(options = {}) {
  const binding = { ...base(), ...options.binding }, planJson = json({ schemaVersion: 1, kind: 'fcos_xero_recovery_step_plan_v1', binding });
  const planSha256 = sha(planJson), steps = sequence(options.renew !== false), calls = [], actions = [];
  let clock = T, record = null, faults = options.faults || {}, bearerAllowed = true;
  const controller = new AbortController();
  const store = {
    async claim(args) {
      calls.push('claim'); if (options.abortDuring === 'claim') controller.abort(); const request = JSON.parse(args.requestJson);
      if (faults.claimBefore) throw Error('fixture claim before commit');
      if (!record) record = { state: 'ready', nextStep: 'preflight', checkpoint: {}, lastResultSha256: null };
      assert.equal(record.state, 'ready'); assert.equal(record.nextStep, request.step);
      assert.equal(record.lastResultSha256, request.previousResultSha256);
      record = { ...record, operationId: binding.operationId, planSha256, requestSha256: args.requestSha256, step: request.step,
        submissionId: request.submissionId, state: 'submitted_unknown', nextStep: null };
      if (faults.claimAfter) throw Error('fixture lost claim acknowledgment');
      return { ...structuredClone(record), decision: options.claimDecision || 'execute' };
    },
    async complete(args) {
      calls.push('complete'); if (faults.completeBefore) throw Error('fixture lost completion before commit');
      const request = JSON.parse(args.requestJson), result = JSON.parse(args.resultJson);
      assert.equal(record.state, 'submitted_unknown'); assert.equal(record.submissionId, request.submissionId);
      const nextStep = steps[steps.indexOf(request.step) + 1] || null, resultSha256 = sha(args.resultJson);
      record = { ...record, checkpoint: { ...record.checkpoint, [request.step]: result }, state: nextStep ? 'ready' : 'complete',
        nextStep, resultSha256, lastResultSha256: resultSha256 };
      if (faults.completeAfter) throw Error('fixture lost completion acknowledgment');
      return structuredClone(record);
    },
    async readback() {
      calls.push('readback'); assert(record);
      return { ...structuredClone(record), currentStep: record.step, executionAuthorityGranted: false, returned_access_token: 'MUST_NOT_LEAK' };
    },
  };
  const create = () => createXeroRecoveryStepProtocol({ planJson, store, now: () => clock,
    authenticate: async ({ bearer, binding: supplied }) => {
      calls.push('auth'); if (options.abortDuring === 'auth') controller.abort(); assert.equal(bearer, 'test-own-bearer'); assert(Object.isFrozen(supplied));
      return { id: binding.actorId, active: true, role: 'general_manager', readOnlyCi: false, workspace: true,
        xeroPortalManage: bearerAllowed, capturedAt: clock, ...options.actor };
    },
    execute: async ({ step, checkpoint, claim }) => {
      actions.push(step); if (options.abortDuring === 'action') controller.abort(); assert.equal(claim.state, 'submitted_unknown'); assert.deepEqual(checkpoint, record.checkpoint);
      if (faults.action) throw Error('fixture unknown after possible provider submission');
      const result = structuredClone(outcome(step, options.renew !== false));
      if (options.secretResult) result.accessToken = 'PRIVATE_TOKEN';
      if (options.advanceDuringAction) clock += options.advanceDuringAction;
      return result;
    } });
  let nonce = 10;
  const request = (step = record?.nextStep || 'preflight', previous = record?.lastResultSha256 || null) => prepareXeroRecoveryStepRequest({
    planJson, step, submissionId: id(nonce++), previousResultSha256: previous });
  const submit = async (runtime = create(), req = request()) => runtime.submit({ rawRequestJson: req.requestJson, bearer: 'test-own-bearer', signal: controller.signal });
  return { controller, create, submit, request, calls, actions, planJson, binding, steps, store, get record() { return record; },
    setFaults: value => { faults = value; }, disableActor: () => { bearerAllowed = false; }, advance: ms => { clock += ms; } };
}

for (const renew of [true, false]) test(`fixed ${renew ? 'renewal' : 'valid-session'} sequence advances only through separate acknowledged requests`, async () => {
  const f = fixture({ renew });
  for (const step of f.steps) {
    const before = f.actions.length, result = await f.submit();
    assert.equal(result.step, step); assert.equal(f.actions.length, before + 1, 'one request never starts a second action');
    assert.equal(result.qualificationAccepted, false); assert.equal(result.executionAuthorityGranted, false);
    assert.equal(result.resultSha256, sha(json(result.result)));
  }
  assert.deepEqual(f.actions, f.steps); assert.equal(f.record.state, 'complete');
  assert.equal(f.calls.filter(x => x === 'auth').length, f.steps.length);
});

for (const fault of ['claimBefore', 'claimAfter', 'action', 'completeBefore', 'completeAfter']) test(`crash/unknown at ${fault}: no later RPC or action from same invocation`, async () => {
  const f = fixture({ faults: { [fault]: true } }), runtime = f.create();
  await assert.rejects(f.submit(runtime));
  const before = f.calls.length;
  await assert.rejects(f.submit(runtime)); await assert.rejects(runtime.readback({ bearer: 'test-own-bearer', signal: new AbortController().signal }));
  assert.equal(f.calls.length, before, 'terminal object cannot issue even readback/cleanup RPC');
  assert(!f.calls.includes('readback'));
  assert.equal(f.actions.length, ['claimBefore', 'claimAfter'].includes(fault) ? 0 : 1);
});

test('unknown committed claim cannot be replayed after cold start or skipped to another action', async () => {
  const f = fixture({ faults: { claimAfter: true } }); await assert.rejects(f.submit()); f.setFaults({});
  await assert.rejects(f.submit());
  await assert.rejects(f.submit(f.create(), f.request('custodyPrepare', sha('not-acknowledged'))));
  assert.equal(f.actions.length, 0); assert.equal(f.record.state, 'submitted_unknown');
});

test('lost complete acknowledgement exposes saved result only by a separately admitted readback', async () => {
  const f = fixture({ faults: { completeAfter: true } }); await assert.rejects(f.submit());
  const writes = f.actions.length;
  f.setFaults({}); const readback = await f.create().readback({ bearer: 'test-own-bearer', signal: f.controller.signal });
  assert.equal(readback.state, 'ready'); assert.equal(readback.nextStep, 'custodyPrepare');
  assert.equal(readback.lastResultSha256, sha(json(outcome('preflight', true))));
  assert.equal(f.actions.length, writes); assert(!JSON.stringify(readback).includes('MUST_NOT_LEAK'));
  // Test driver supplies a NEW explicit owner continuation; readback never does.
  await f.submit(f.create(), f.request(readback.nextStep, readback.lastResultSha256));
  assert.deepEqual(f.actions, ['preflight', 'custodyPrepare']);
});

test('expired original plan remains inspectable by separate GET-only readback, without extending execution', async () => {
  const f = fixture(); await f.submit(); f.advance(1000000);
  const result = await f.create().readback({ bearer: 'test-own-bearer', signal: f.controller.signal }); assert.equal(result.state, 'ready');
  const before = f.actions.length; await assert.rejects(f.submit()); assert.equal(f.actions.length, before);
});

test('current actor revocation blocks next step before its claim', async () => {
  const f = fixture(); await f.submit(); f.disableActor(); const before = f.calls.filter(c => c === 'claim').length;
  await assert.rejects(f.submit()); assert.equal(f.calls.filter(c => c === 'claim').length, before); assert.deepEqual(f.actions, ['preflight']);
});

test('no historical role/CI/disabled/mismatched actor can replace current authenticated action access', async () => {
  for (const actor of [{ active: false }, { role: 'trader' }, { readOnlyCi: true }, { id: id(88) }, { capturedAt: T - 16000 }]) {
    const f = fixture({ actor }); await assert.rejects(f.submit()); assert(!f.calls.includes('claim')); assert.equal(f.actions.length, 0);
  }
});

test('out-of-order step and stale previous result reject without action', async () => {
  const f = fixture(); await f.submit(); const count = f.actions.length;
  await assert.rejects(f.submit(f.create(), f.request('probeAdmission', f.record.lastResultSha256)));
  await assert.rejects(f.submit(f.create(), f.request('custodyPrepare', sha('stale'))));
  assert.equal(f.actions.length, count);
});

test('duplicate exact request is never a submit retry, including after a successful cold start', async () => {
  const f = fixture(), req = f.request(); await f.submit(f.create(), req);
  await assert.rejects(f.submit(f.create(), req)); assert.deepEqual(f.actions, ['preflight']);
});

test('denied/nonexecuting native claim never invokes the action', async () => {
  const f = fixture({ claimDecision: 'readback' }); await assert.rejects(f.submit()); assert.equal(f.actions.length, 0); assert(!f.calls.includes('complete'));
});

test('unexpected secret fields in a domain result stop before any completion/export', async () => {
  const f = fixture({ secretResult: true }); await assert.rejects(f.submit(), e => !JSON.stringify(e).includes('PRIVATE_TOKEN'));
  assert(!f.calls.includes('complete')); assert.equal(f.record.state, 'submitted_unknown');
});

test('plan deadline reached by action permits no later completion RPC', async () => {
  const f = fixture({ advanceDuringAction: 900001 }); await assert.rejects(f.submit());
  assert(!f.calls.includes('complete')); assert.equal(f.record.state, 'submitted_unknown');
});

test('request hashes bind canonical exact bytes, not arbitrary JSON-equivalent fields', async () => {
  const f = fixture(), req = f.request(); assert.equal(req.requestSha256, sha(req.requestJson));
  for (const raw of [JSON.stringify(JSON.parse(req.requestJson), null, 2), json({ ...JSON.parse(req.requestJson), actorId: id(99) }),
    json({ ...JSON.parse(req.requestJson), planSha256: sha('foreign') })]) {
    await assert.rejects(f.create().submit({ rawRequestJson: raw, bearer: 'test-own-bearer', signal: new AbortController().signal }));
  }
  assert.equal(f.actions.length, 0); assert(!f.calls.includes('claim'));
});

test('no fallback store/executor/authentication or self-admitted preservation exception', () => {
  const f = fixture();
  assert.throws(() => createXeroRecoveryStepProtocol({ planJson: f.planJson }));
  const plan = JSON.parse(f.planJson); plan.binding.credentialPreservationCompositeApproved = false;
  assert.throws(() => parseXeroRecoveryStepPlan(json(plan)));
  plan.binding.credentialPreservationCompositeApproved = true; plan.binding.notAfter = T + 900001;
  assert.throws(() => parseXeroRecoveryStepPlan(json(plan)));
});

for (const abortDuring of ['auth', 'claim', 'action']) test(`request cancellation during ${abortDuring} stops every follow-on RPC`, async () => {
  const f = fixture({ abortDuring }); await assert.rejects(f.submit());
  assert.equal(f.actions.length, abortDuring === 'action' ? 1 : 0);
  assert(!f.calls.includes('complete')); if (abortDuring === 'auth') assert(!f.calls.includes('claim'));
});

test('invalid request diagnostics cannot reflect unvalidated arbitrary fields', async () => {
  const f = fixture(), request = JSON.parse(f.request().requestJson);
  request.step = { privateToken: 'PASTED_PRIVATE_MATERIAL' }; request.submissionId = 'PASTED_PRIVATE_MATERIAL';
  await assert.rejects(f.create().submit({ rawRequestJson: json(request), bearer: 'test-own-bearer', signal: f.controller.signal }), e => {
    assert.equal(e.step, null); assert.equal(e.submissionId, null); assert(!JSON.stringify(e).includes('PASTED')); return true;
  });
  assert.equal(f.calls.length, 0);
});
