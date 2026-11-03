import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createXeroRecoveryBoundary } from '../scripts/lib/hosted-release/xero-recovery-boundary.mjs';

const ID = '10000000-0000-4000-8000-000000000001';
const ACTOR = '20000000-0000-4000-8000-000000000002';
const TENANT = '30000000-0000-4000-8000-000000000003';
const hash = 'a'.repeat(64);
const command = value => ({ exit_code: 0, output: JSON.stringify(value) });
const native = () => ({ isError: false, content: [{ type: 'text', text: 'PRIVATE_PROVIDER_ACK' }] });

function fixture(t, changes = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-recovery-boundary-'));
  let clock = Date.now();
  const expected = { epoch: 'frozen-test-epoch', objective: 'original-owner-probe', ownerThreadId: ID, operationId: hash, bindingSha256: hash };
  const proof = { ownerThreadId: ID, actorId: ACTOR, tenantId: TENANT, sessionVersion: 449, approvalSha256: hash,
    runtimeSha256: hash, actorSha256: hash, schemaSha256: hash, capturedAt: clock, notAfter: clock + 120_000 };
  const options = { expected, proof, renewalRequired: true, journalPath: join(directory, 'owner.jsonl'), now: () => clock, ...changes };
  const lease = { ...expected, leaseId: '40000000-0000-4000-8000-000000000004', coordinationOnly: true,
    providerAuthorityGranted: false, uncertainOutcomeRequiresReadback: true };
  const calls = [];
  let boundary;
  t.after(() => { boundary?.close(); rmSync(directory, { recursive: true, force: true }); });
  const callbacks = overrides => ({
    claim: async input => { calls.push('claim'); assert.deepEqual(input, expected); return command(lease); },
    assertLease: async input => { calls.push('assert'); assert.deepEqual(input.lease, lease); return command(lease); },
    recordIntent: async input => { calls.push(input.phase); return command({ lease, state: input.phase, durable: true }); },
    submit: async () => { calls.push('submit'); return native(); },
    validateProviderResult: result => { calls.push('validate'); return result.content?.[0]?.text === 'PRIVATE_PROVIDER_ACK'; },
    recordOutcome: async input => { calls.push('outcome'); assert.equal(input.outcome.state, 'submitted'); return command({ lease, state: 'submitted', durable: true }); },
    ...overrides,
  });
  return { options, expected, proof, lease, calls, callbacks, start: () => (boundary = createXeroRecoveryBoundary(options)), advance: value => { clock += value; } };
}

test('one fixed original-owner renewal/probe sequence reuses actual guard and keeps provider data out of the local journal', async t => {
  const f = fixture(t), b = f.start();
  const steps = ['sessionRead', 'refreshClaim', 'tokenRenew', 'refreshFinish', 'renewedSessionRead', 'probeGrant', 'probeAdmission', 'organisationsGet', 'probeObservation', 'finalRead'];
  for (const step of steps) {
    assert.equal(b.state().nextStep, step);
    const result = await b.runStep(step, f.callbacks());
    assert.equal(result.status, 'submitted_acknowledged');
    assert.deepEqual(f.calls.splice(0), ['claim', 'assert', 'prepared', 'assert', 'submitting', 'assert', 'submit', 'validate', 'outcome']);
  }
  assert.equal(b.state().sequenceComplete, true);
  assert.equal(b.state().executionAuthorityGranted, false);
  const text = readFileSync(f.options.journalPath, 'utf8'), rows = text.trim().split('\n').map(x => JSON.parse(x));
  assert.equal(rows.length, 21);
  assert.deepEqual(rows.map(x => x.sequence), Array.from({ length: 21 }, (_, i) => i));
  assert.equal(rows.filter(x => x.step === 'organisationsGet' && x.kind === 'step_acknowledged').length, 1);
  assert.doesNotMatch(text, /PRIVATE_PROVIDER_ACK|providerResult|access_token|refresh_token/);
  assert.equal(statSync(f.options.journalPath).mode & 0o777, 0o600);
});

test('fresh-session branch has no refresh callback and exclusive journal creation prevents automatic resume', async t => {
  const f = fixture(t, { renewalRequired: false }), b = f.start();
  assert.throws(() => createXeroRecoveryBoundary(f.options), { code: 'XERO_RECOVERY_TERMINAL', reason: 'journal_unavailable' });
  for (const step of ['sessionRead', 'probeGrant', 'probeAdmission', 'organisationsGet', 'probeObservation', 'finalRead']) await b.runStep(step, f.callbacks());
  assert.equal(b.state().completedSteps, 6);
  await assert.rejects(b.runStep('organisationsGet', f.callbacks()), { code: 'XERO_RECOVERY_TERMINAL' });
  assert.equal(b.state().terminal, true);
});

test('invalid or stale proof fails before local journal creation', t => {
  for (const change of [f => { f.options.expected.extra = true; }, f => { f.options.proof.actorId = ''; },
    f => { f.options.proof.ownerThreadId = ACTOR; }, f => { f.options.proof.sessionVersion = 0; },
    f => { f.options.proof.runtimeSha256 = ''; }, f => { f.options.proof.capturedAt -= 60_001; },
    f => { f.options.proof.notAfter += 180_000; }, f => { f.options.journalPath = 'relative.jsonl'; },
    f => { f.options.now = () => NaN; }]) {
    const f = fixture(t); change(f);
    assert.throws(() => f.start(), { code: 'XERO_RECOVERY_TERMINAL', reason: 'binding' });
    assert.equal(existsSync(f.options.journalPath), false);
  }
});

for (const [name, override, expectedCalls] of [
  ['claim exception', f => ({ claim: async () => { f.calls.push('claim'); throw Error('PRIVATE_FAILURE'); } }), ['claim']],
  ['claim pending', f => ({ claim: async () => { f.calls.push('claim'); return { session_id: 7 }; } }), ['claim']],
  ['claim failed', f => ({ claim: async () => { f.calls.push('claim'); return { exit_code: 1, output: '{}' }; } }), ['claim']],
  ['claim wrong lease', f => ({ claim: async () => { f.calls.push('claim'); return command({ ...f.lease, ownerThreadId: ACTOR }); } }), ['claim']],
  ['assert mismatch', f => ({ assertLease: async () => { f.calls.push('assert'); return command({ ...f.lease, bindingSha256: 'b'.repeat(64) }); } }), ['claim', 'assert']],
  ['intent missing durable receipt', f => ({ recordIntent: async () => { f.calls.push('prepared'); return command({ lease: f.lease, state: 'prepared', durable: false }); } }), ['claim', 'assert', 'prepared']],
  ['submit exception', f => ({ submit: async () => { f.calls.push('submit'); throw Error('PRIVATE_FAILURE'); } }), ['claim', 'assert', 'prepared', 'assert', 'submitting', 'assert', 'submit']],
  ['submit pending', f => ({ submit: async () => { f.calls.push('submit'); return { session_id: 9 }; } }), ['claim', 'assert', 'prepared', 'assert', 'submitting', 'assert', 'submit']],
  ['submit MCP refusal', f => ({ submit: async () => { f.calls.push('submit'); return { isError: true, content: [{ type: 'text', text: 'PRIVATE_FAILURE' }] }; } }), ['claim', 'assert', 'prepared', 'assert', 'submitting', 'assert', 'submit']],
  ['validator false', f => ({ validateProviderResult: () => { f.calls.push('validate'); return false; } }), ['claim', 'assert', 'prepared', 'assert', 'submitting', 'assert', 'submit', 'validate']],
  ['validator throws', f => ({ validateProviderResult: () => { f.calls.push('validate'); throw Error('PRIVATE_FAILURE'); } }), ['claim', 'assert', 'prepared', 'assert', 'submitting', 'assert', 'submit', 'validate']],
  ['outcome pending', f => ({ recordOutcome: async () => { f.calls.push('outcome'); return { session_id: 10 }; } }), ['claim', 'assert', 'prepared', 'assert', 'submitting', 'assert', 'submit', 'validate', 'outcome']],
]) {
  test(`${name} poisons every subsequent callback, even when caller catches the failure`, async t => {
    const f = fixture(t), b = f.start();
    await assert.rejects(b.runStep('sessionRead', f.callbacks(override(f))), { code: 'XERO_RECOVERY_TERMINAL' });
    assert.deepEqual(f.calls, expectedCalls);
    assert.equal(b.state().terminal, true);
    await assert.rejects(b.runStep('probeGrant', f.callbacks()), { code: 'XERO_RECOVERY_TERMINAL' });
    await assert.rejects(b.runStep('failRefresh', f.callbacks()), { code: 'XERO_RECOVERY_TERMINAL' });
    assert.deepEqual(f.calls, expectedCalls);
    assert.doesNotMatch(readFileSync(f.options.journalPath, 'utf8'), /PRIVATE_FAILURE|PRIVATE_PROVIDER_ACK/);
  });
}

test('unknown callback timeout blocks outcome cleanup and a late acknowledgement cannot resume', async t => {
  const f = fixture(t, { callbackTimeoutMs: 5 }), b = f.start();
  let resolve;
  await assert.rejects(b.runStep('sessionRead', f.callbacks({ claim: () => { f.calls.push('claim'); return new Promise(r => { resolve = r; }); } })), { code: 'XERO_RECOVERY_TERMINAL' });
  resolve(command(f.lease));
  await new Promise(r => setImmediate(r));
  await assert.rejects(b.runStep('sessionRead', f.callbacks()), { code: 'XERO_RECOVERY_TERMINAL' });
  assert.deepEqual(f.calls, ['claim']);
});

test('concurrent execution poisons the first pending step before any next callback', async t => {
  const f = fixture(t), b = f.start();
  let resolve;
  const first = b.runStep('sessionRead', f.callbacks({ claim: () => { f.calls.push('claim'); return new Promise(r => { resolve = r; }); } }));
  await new Promise(r => setImmediate(r));
  await assert.rejects(b.runStep('sessionRead', f.callbacks()), { code: 'XERO_RECOVERY_TERMINAL' });
  resolve(command(f.lease));
  await assert.rejects(first, { code: 'XERO_RECOVERY_TERMINAL' });
  assert.deepEqual(f.calls, ['claim']);
});

test('expiry after a completed assertion stops all following intent/provider callbacks', async t => {
  const f = fixture(t), b = f.start();
  await assert.rejects(b.runStep('sessionRead', f.callbacks({ assertLease: async () => { f.calls.push('assert'); f.advance(120_000); return command(f.lease); } })), { code: 'XERO_RECOVERY_TERMINAL' });
  assert.deepEqual(f.calls, ['claim', 'assert']);
});

test('step skipping and automatic cleanup names are not execution routes', async t => {
  for (const step of ['probeGrant', 'tokenRenew', 'release', 'failRefresh', 'reconnect']) {
    const f = fixture(t), b = f.start();
    await assert.rejects(b.runStep(step, f.callbacks()), { code: 'XERO_RECOVERY_TERMINAL' });
    assert.deepEqual(f.calls, []);
  }
});
