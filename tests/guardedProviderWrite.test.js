import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runGuardedProviderWrite } from '../scripts/lib/guarded-provider-write.mjs';

const expected = Object.freeze({ epoch: 'production-reconciliation-20261005', objective: 'refusal-test-only',
  ownerThreadId: 'root', operationId: 'guarded-provider-write-test', bindingSha256: 'a'.repeat(64) });
const lease = Object.freeze({ ...expected, leaseId: '11111111-1111-4111-8111-111111111111', coordinationOnly: true,
  providerAuthorityGranted: false, uncertainOutcomeRequiresReadback: true });
const command = value => ({ exit_code: 0, output: JSON.stringify(value) });
const clone = value => structuredClone(value);
const receipt = (state, current = lease) => command({ lease: clone(current), state, durable: true });

function harness(overrides = {}) {
  const calls = { claim: 0, assertLease: 0, intent: [], submit: 0, outcome: [] };
  const api = {
    expected,
    claim: async input => { calls.claim++; assert.equal(input.epoch, expected.epoch); return command(clone(lease)); },
    assertLease: async input => { calls.assertLease++; return command(clone(input.lease)); },
    recordIntent: async input => { calls.intent.push(input.phase); return receipt(input.phase, input.lease); },
    submit: async () => { calls.submit++; return { isError: false, content: [{ type: 'text', text: 'accepted' }] }; },
    recordOutcome: async input => { calls.outcome.push(input.outcome); return receipt(input.outcome.state, input.lease); },
    validateProviderResult: value => value?.isError === false && value.content?.[0]?.text === 'accepted'
  };
  return { calls, api: { ...api, ...overrides } };
}

test('claims, reasserts, records two intents, submits once, and records acknowledgement', async () => {
  const { api, calls } = harness();
  const result = await runGuardedProviderWrite(api);
  assert.equal(result.status, 'submitted_acknowledged');
  assert.equal(calls.submit, 1);
  assert.deepEqual(calls.intent, ['prepared', 'submitting']);
  assert.deepEqual(calls.outcome, [{ state: 'submitted', reason: 'provider_acknowledged' }]);
  assert.equal(calls.assertLease, 3);
  assert.deepEqual(result.lease, lease);
});

test('callbacks receive frozen clones and cannot alter the caller binding or held lease', async () => {
  const { api } = harness({
    claim: async input => { assert.ok(Object.isFrozen(input)); return command(clone(lease)); },
    assertLease: async input => {
      assert.ok(Object.isFrozen(input.expected)); assert.ok(Object.isFrozen(input.lease));
      try { input.expected.objective = 'changed'; input.lease.leaseId = '22222222-2222-4222-8222-222222222222'; } catch {}
      return command(clone(lease));
    }
  });
  const result = await runGuardedProviderWrite(api);
  assert.equal(expected.objective, 'refusal-test-only');
  assert.equal(lease.leaseId, '11111111-1111-4111-8111-111111111111');
  assert.equal(result.status, 'submitted_acknowledged');
});

for (const [name, claim] of [
  ['nonzero claim with plausible JSON', async () => ({ exit_code: 1, output: JSON.stringify(lease) })],
  ['throwing claim', async () => { throw new Error('claim unavailable'); }],
  ['claim with null exit code', async () => ({ exit_code: null, output: JSON.stringify(lease) })],
  ['pending claim session', async () => ({ exit_code: 0, output: JSON.stringify(lease), session_id: 1 })],
  ['signalled claim', async () => ({ exit_code: 0, output: JSON.stringify(lease), signal: 'SIGTERM' })],
  ['missing claim lease', async () => command(null)],
  ['mismatched claim lease', async () => command({ ...lease, ownerThreadId: 'other' })]
]) {
  test(`${name} stops before intent or provider submission`, async () => {
    const { api, calls } = harness({ claim });
    await assert.rejects(() => runGuardedProviderWrite(api), /Guarded provider write refused/);
    assert.equal(calls.submit, 0); assert.deepEqual(calls.intent, []); assert.deepEqual(calls.outcome, []);
  });
}

test('an assertion refusal, intent failure, and final assertion refusal each stop before the provider', async () => {
  for (const overrides of [
    { assertLease: async () => ({ exit_code: 1, output: JSON.stringify(lease) }) },
    { recordIntent: async () => ({ exit_code: 1, output: '{}' }) },
    { recordIntent: (() => { let calls = 0; return async input => (++calls === 2 ? { exit_code: 1, output: '{}' } : receipt(input.phase, input.lease)); })() },
    { assertLease: (() => { let calls = 0; return async input => (++calls === 2 ? { exit_code: 1, output: '{}' } : command(clone(input.lease))); })() },
    { assertLease: (() => { let calls = 0; return async input => (++calls === 3 ? command({ ...input.lease, leaseId: '22222222-2222-4222-8222-222222222222' }) : command(clone(input.lease))); })() }
  ]) {
    const { api, calls } = harness(overrides);
    await assert.rejects(() => runGuardedProviderWrite(api), /Guarded provider write refused/);
    assert.equal(calls.submit, 0); assert.deepEqual(calls.outcome, []);
  }
});

test('unconfirmed, thrown, and denied provider responses become one durable uncertain outcome without retry or release', async () => {
  for (const submit of [
    async () => null,
    async () => { throw new Error('provider private failure'); },
    async () => ({ isError: false, content: [{ type: 'text', text: 'refused' }] }),
    async () => ({ isError: false, content: [{ type: 'text', text: 'accepted' }], exit_code: 1 })
  ]) {
    let submits = 0;
    const outcomes = [];
    const { api } = harness({ submit: async input => { submits++; return submit(input); },
      recordOutcome: async input => { outcomes.push(input.outcome); return receipt(input.outcome.state, input.lease); } });
    const result = await runGuardedProviderWrite(api);
    assert.equal(result.status, 'uncertain_outcome_recorded');
    assert.equal(submits, 1); assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].state, 'uncertain');
  }
});

test('a false provider validator is uncertain even for otherwise successful tool output', async () => {
  const { api, calls } = harness({ validateProviderResult: () => false });
  const result = await runGuardedProviderWrite(api);
  assert.equal(result.status, 'uncertain_outcome_recorded');
  assert.equal(calls.submit, 1); assert.equal(calls.outcome[0].state, 'uncertain');
});

test('failure to record acknowledgement or uncertainty keeps the lease and exposes unresolved status without retrying submit', async () => {
  for (const submit of [async () => ({ isError: false, content: [{ type: 'text', text: 'accepted' }] }), async () => null]) {
    let submits = 0, outcomeRecords = 0;
    const { api } = harness({ submit: async input => { submits++; return submit(input); },
      recordOutcome: async () => { outcomeRecords++; return { exit_code: 1, output: '{}' }; } });
    const result = await runGuardedProviderWrite(api);
    assert.equal(result.status, 'uncertain_outcome_recording_failed');
    assert.equal(submits, 1); assert.equal(outcomeRecords, 1); assert.deepEqual(result.lease, lease);
  }
});

test('lease and receipt key reordering is accepted when every exact field matches', async () => {
  const reorder = value => Object.fromEntries(Object.entries(value).reverse());
  const { api } = harness({
    claim: async () => command(reorder(lease)),
    assertLease: async input => command(reorder(input.lease)),
    recordIntent: async input => command(reorder({ lease: reorder(input.lease), state: input.phase, durable: true })),
    recordOutcome: async input => command(reorder({ lease: reorder(input.lease), state: input.outcome.state, durable: true }))
  });
  assert.equal((await runGuardedProviderWrite(api)).status, 'submitted_acknowledged');
});

test('incomplete MCP envelopes become uncertain even with a permissive provider validator', async () => {
  for (const submit of [
    async () => ({ isError: false, content: [{ type: 'text', text: 'accepted' }], session_id: '' }),
    async () => ({ isError: false, content: [{ type: 'text', text: 'accepted' }], signal: 'SIGTERM' }),
    async () => ({ isError: false, content: [{ type: 'text', text: 'accepted' }], error: { code: 'pending' } }),
    async () => ({ isError: false, content: [{ type: 'text', text: 'accepted' }], exit_code: 1 })
  ]) {
    let submits = 0;
    const { api } = harness({ submit: async input => { submits++; return submit(input); }, validateProviderResult: () => true });
    assert.equal((await runGuardedProviderWrite(api)).status, 'uncertain_outcome_recorded');
    assert.equal(submits, 1);
  }
});

test('the process-level source loader emits only a compilable self-contained function', async () => {
  const loaded = spawnSync(process.execPath, ['scripts/guarded-provider-write-source.mjs'], { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 });
  assert.equal(loaded.status, 0); assert.equal(loaded.stderr, ''); assert.match(loaded.stdout, /^async function runGuardedProviderWrite/);
  const serialized = Function(`"use strict"; return (${loaded.stdout});`)();
  const { api, calls } = harness();
  const result = await serialized(api);
  assert.equal(result.status, 'submitted_acknowledged'); assert.equal(calls.submit, 1);
});
