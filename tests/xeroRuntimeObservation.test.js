import test from 'node:test';
import assert from 'node:assert/strict';
import { observeRuntimeXero, runtimeXeroBudgetId, createRuntimeProbeDeadline } from '../api/_xeroRuntimeObservation.js';
import { createRuntimeXeroReadControl } from '../api/_xeroSharedControl.js';

const actorId = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
const tenantId = '33333333-3333-4333-8333-333333333333';
const binding = { deploymentId: 'dpl_current', sha: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) };
const start = Date.parse('2026-10-24T00:00:00Z');
function fixture({ badStage, throwStage, fetch, row: rowChanges, quota: quotaChanges, expiredAfterAdmit = false } = {}) {
  const calls = []; let clock = start, spent = false, owner;
  const q = { tenantId, allowanceKnown: true, dailyHold: false, reserve: 200, minuteLimit: 45, inFlightLimit: 2,
    reservedCalls: 0, inFlight: 0, minuteCalls: 0, revision: 1, unresolvedWrites: 0, availableCalls: 500, spendableCalls: 300, retryAt: null, ...quotaChanges };
  const row = { id: 'primary', tenant_id: tenantId, access_token: 'private-synthetic-token', token_version: 477,
    expires_at: new Date(start + 3600000).toISOString(), ...rowChanges };
  const ack = (stage, value) => {
    if (throwStage === stage) throw Error('private-provider-error');
    return badStage === stage ? {} : value;
  };
  const client = { from(table) {
    calls.push('session'); assert.equal(table, 'xero_contact_sync_connections');
    const query = { select(s) { assert.equal(s, 'id,tenant_id,access_token,expires_at,token_version'); return query; },
      eq(k, v) { assert.equal(k, 'id'); assert.equal(v, 'primary'); return query; },
      maybeSingle: async () => ({ data: row }) }; return query;
  } };
  const control = {
    status: async target => { calls.push('status'); assert.equal(target, tenantId); return ack('status', q); },
    reserve: async p => {
      calls.push('reserve'); assert.equal(p.budgetId, runtimeXeroBudgetId(requestId));
      assert.equal(p.operationCalls, 1); assert.equal(p.verificationCalls, 0); assert.equal(p.ttlSeconds, 60);
      if (owner && owner !== p.ownerKey) throw Error('owner mismatch'); owner = p.ownerKey;
      return ack('reserve', { id: p.budgetId, tenant_id: tenantId, owner_key: owner, state: 'active', operation_remaining: spent ? 0 : 1,
        verification_remaining: 0, verification_reserved: 0, expires_at: new Date(start + 60000).toISOString() });
    },
    admit: async p => {
      calls.push('admit'); assert.equal(p.method, 'GET'); assert.equal(p.resourceKey, 'Connections'); assert.equal(p.resourcePath, '/connections');
      assert.equal(p.probeId, null); assert.equal(p.payloadJson, null); assert.equal(p.tokenVersion, 477); assert.equal(p.requestId, requestId);
      assert.equal(p.budgetPhase, 'operation'); assert.equal(p.budgetId, runtimeXeroBudgetId(requestId));
      assert.equal(spent, false); spent = true;
      if (expiredAfterAdmit) clock += 120000;
      return ack('admit', { requestId, tenantId, deadlineAt: new Date(start + 120000).toISOString() });
    },
    observe: async p => { calls.push('observe'); assert.equal(p.status, 200); assert.equal(p.outcomeUnknown, false); return ack('observe', { recorded: true }); },
    release: async p => { calls.push('release'); assert.equal(p.budgetId, runtimeXeroBudgetId(requestId)); return ack('release', q); },
  };
  const fetchImpl = async (url, p) => {
    calls.push('GET'); assert.equal(url, 'https://api.xero.com/connections'); assert.equal(p.method, 'GET'); assert.equal(p.redirect, 'error');
    assert.equal(p.headers.Authorization, 'Bearer private-synthetic-token'); assert.equal(p.body, undefined);
    return fetch ? fetch(p) : Response.json([{ tenantId, tenantType: 'ORGANISATION' }]);
  };
  const args = { client, control, actorId, requestId, tenantId, binding, fetchImpl, now: () => clock };
  return { calls, args, run: changes => observeRuntimeXero({ ...args, ...changes }) };
}

test('one live admin/source-bound read uses only ordinary current quota then reports sanitized auth', async () => {
  const f = fixture(), result = await f.run();
  assert.deepEqual(f.calls, ['session', 'status', 'reserve', 'admit', 'GET', 'observe', 'release']);
  assert.deepEqual(result, { auth: { state: 'authenticated', target: tenantId, mode: 'oauth' }, runtimeValidUntil: new Date(start + 3510000).toISOString() });
  assert.doesNotMatch(JSON.stringify(result), /private|access.token|refresh.token|477/);
});
test('the default runtime adapter reaches the installed ordinary RPC without the draft-exception migration', async () => {
  const f = fixture(), names = [];
  const client = { ...f.args.client, rpc: async (name, p) => {
    names.push(name);
    const handlers = {
      xero_shared_status: () => f.args.control.status(p.p_tenant_id),
      xero_shared_reserve: () => f.args.control.reserve({ tenantId: p.p_tenant_id, budgetId: p.p_id, ownerKey: p.p_owner_key,
        operationCalls: p.p_operation_calls, verificationCalls: p.p_verification_calls, ttlSeconds: p.p_ttl_seconds }),
      xero_shared_admit: () => {
        assert.deepEqual(Object.keys(p).sort(), ['p_tenant_id', 'p_id', 'p_token_version', 'p_method', 'p_resource_key', 'p_budget_id', 'p_phase', 'p_probe_id'].sort());
        return f.args.control.admit({ tenantId: p.p_tenant_id, tokenVersion: p.p_token_version, requestId: p.p_id,
          method: p.p_method, resourceKey: p.p_resource_key, resourcePath: '/connections', payloadJson: null,
          budgetId: p.p_budget_id, budgetPhase: p.p_phase, probeId: p.p_probe_id });
      },
      xero_shared_observe: () => f.args.control.observe({ status: p.p_status, outcomeUnknown: p.p_outcome_unknown }),
      xero_shared_release: () => f.args.control.release({ budgetId: p.p_id }),
    };
    assert.ok(handlers[name], `Unexpected RPC ${name}`);
    return { data: await handlers[name](), error: null };
  } };
  const { control, ...args } = f.args;
  const result = await observeRuntimeXero({ ...args, client });
  assert.equal(result.auth.state, 'authenticated');
  assert.deepEqual(names, ['xero_shared_status', 'xero_shared_reserve', 'xero_shared_admit', 'xero_shared_observe', 'xero_shared_release']);
  assert.equal(f.calls.filter(x => x === 'GET').length, 1);
});
test('ordinary runtime admission cannot widen into an accounting, write, probe or exception request', async () => {
  let calls = 0;
  const control = createRuntimeXeroReadControl({ rpc: async () => { calls++; return { data: {}, error: null }; } });
  assert.deepEqual(Object.keys(control).sort(), ['status', 'reserve', 'admit', 'observe', 'release'].sort());
  const input = { tenantId, tokenVersion: 477, requestId, method: 'GET', resourceKey: 'Connections', resourcePath: '/connections',
    payloadJson: null, budgetId: runtimeXeroBudgetId(requestId), budgetPhase: 'operation', probeId: null };
  for (const change of [{ method: 'POST' }, { resourceKey: 'Invoices' }, { resourcePath: '/Invoices' },
    { payloadJson: {} }, { probeId: actorId }, { budgetPhase: 'verification' }, { budgetId: null }, { requestId: null }])
    await assert.rejects(async () => control.admit({ ...input, ...change }), { code: 'XERO_RUNTIME_READ_SCOPE_INVALID' });
  assert.equal(calls, 0);
});
test('ordinary admission refusal makes no fallback call to the scoped exception RPC', async () => {
  const names = [], control = createRuntimeXeroReadControl({ rpc: async name => {
    names.push(name); return { error: { message: 'XERO_RESERVE_PROTECTED private detail' } };
  } });
  await assert.rejects(control.admit({ tenantId, tokenVersion: 477, requestId, method: 'GET', resourceKey: 'Connections',
    resourcePath: '/connections', budgetId: runtimeXeroBudgetId(requestId) }), { code: 'XERO_RESERVE_PROTECTED' });
  assert.deepEqual(names, ['xero_shared_admit']);
});
test('same public request cannot get a rearmed budget or repeat its GET', async () => {
  const f = fixture(); await f.run(); const before = f.calls.length;
  await assert.rejects(f.run(), { code: 'RUNTIME_XERO_CONTROL_INVALID' });
  assert.deepEqual(f.calls.slice(before), ['session', 'status', 'reserve']);
  assert.equal(f.calls.filter(x => x === 'GET').length, 1);
});
test('same request keeps its budget identity when actor/source changes; foreign owner refuses', async () => {
  const f = fixture(); await f.run();
  await assert.rejects(f.run({ actorId: '44444444-4444-4444-8444-444444444444' }), /owner mismatch/);
  assert.equal(f.calls.filter(x => x === 'GET').length, 1);
  assert.notEqual(runtimeXeroBudgetId(requestId), requestId);
});
for (const stage of ['status', 'reserve', 'admit', 'observe', 'release']) {
  for (const kind of ['badStage', 'throwStage']) test(`${stage} ${kind} stops every later RPC, including cleanup`, async () => {
    const f = fixture({ [kind]: stage }); await assert.rejects(f.run());
    assert.equal(f.calls.at(-1), stage);
    assert.equal(f.calls.filter(x => x === 'GET').length, ['observe', 'release'].includes(stage) ? 1 : 0);
  });
}
for (const [name, fetch] of [
  ['network throw', async () => { throw Error('private-network-error'); }],
  ['HTTP refusal', async () => Response.json({}, { status: 429 })],
  ['bad JSON', async () => new Response('not JSON')],
  ['oversized body', async () => new Response('x'.repeat(65537))],
  ['wrong tenant', async () => Response.json([{ tenantId: actorId, tenantType: 'ORGANISATION' }])],
  ['duplicate tenant', async () => Response.json([{ tenantId, tenantType: 'ORGANISATION' }, { tenantId, tenantType: 'ORGANISATION' }])],
  ['wrong tenant type', async () => Response.json([{ tenantId, tenantType: 'PARTNER' }])],
]) test(`${name} retains original durable receipt with no observe/release or replay`, async () => {
  const f = fixture({ fetch }); await assert.rejects(f.run()); assert.equal(f.calls.at(-1), 'GET');
  assert.deepEqual(f.calls, ['session', 'status', 'reserve', 'admit', 'GET']);
  await assert.rejects(f.run()); assert.equal(f.calls.filter(x => x === 'GET').length, 1);
});
for (const quota of [{ allowanceKnown: false, availableCalls: null, spendableCalls: null }, { availableCalls: 200, spendableCalls: 0 },
  { minuteCalls: 45 }, { inFlight: 2 }, { dailyHold: true }, { retryAt: new Date(start + 10000).toISOString() }]) {
  test(`current quota held ${JSON.stringify(quota)} makes no reservation or provider call`, async () => {
    const f = fixture({ quota }); await assert.rejects(f.run(), { code: 'RUNTIME_XERO_QUOTA_HELD' }); assert.deepEqual(f.calls, ['session', 'status']);
  });
}
test('expired, foreign and malformed sessions cannot reserve or refresh', async () => {
  for (const row of [{ expires_at: new Date(start + 90000).toISOString() }, { tenant_id: actorId }, { token_version: null }, { access_token: 'bad token' }]) {
    const f = fixture({ row }); await assert.rejects(f.run(), { code: 'RUNTIME_XERO_SESSION_UNAVAILABLE' }); assert.deepEqual(f.calls, ['session']);
  }
});
test('time spent in admission cannot launch a stale or expired provider read', async () => {
  const f = fixture({ expiredAfterAdmit: true }); await assert.rejects(f.run(), { code: 'RUNTIME_XERO_CONTROL_INVALID' }); assert.equal(f.calls.at(-1), 'admit');
});
test('missing actor/request/source identity refuses before storage or provider access', async () => {
  for (const change of [{ actorId: 'invented' }, { requestId: undefined }, { binding: { ...binding, sourceDigest: '' } }]) {
    const f = fixture(); await assert.rejects(f.run(change), { code: 'RUNTIME_XERO_SCOPE_INVALID' }); assert.deepEqual(f.calls, []);
  }
});
test('one monotonic deadline stops slow prerequisite metadata before a late provider GET', async () => {
  let elapsed = 0;
  const f = fixture();
  const deadline = createRuntimeProbeDeadline({ monotonic: () => elapsed, durationMs: 25000 });
  // The server budget starts before the already elapsed authorization/providers.
  elapsed = 15000;
  await assert.rejects(f.run({ deadline }), { code: 'RUNTIME_PROBE_DEADLINE' });
  assert.deepEqual(f.calls, ['session', 'status']);
  // Distinct case: metadata consumes the remaining budget after reservation.
  elapsed = 0;
  const deadline2 = createRuntimeProbeDeadline({ monotonic: () => elapsed });
  const g = fixture();
  // Use g's own controls/call ledger for the late-admission path.
  const delayed = { ...g.args.control };
  for (const stage of ['status', 'reserve', 'admit']) {
    const original = delayed[stage]; delayed[stage] = async p => { const value = await original(p); elapsed += 5000; return value; };
  }
  await assert.rejects(g.run({ control: delayed, deadline: deadline2 }), { code: 'RUNTIME_PROBE_DEADLINE' });
  assert.equal(g.calls.at(-1), 'admit'); assert.equal(g.calls.includes('GET'), false);
});
test('remaining signal time is an integer even near the overall deadline', () => {
  let elapsed = 0;
  const deadline = createRuntimeProbeDeadline({ monotonic: () => elapsed });
  elapsed = 24900.25;
  assert.equal(deadline.remaining(), 99);
  assert.doesNotThrow(() => AbortSignal.timeout(deadline.remaining()));
  elapsed = 25000;
  assert.throws(() => deadline.remaining(), { code: 'RUNTIME_PROBE_DEADLINE' });
});
