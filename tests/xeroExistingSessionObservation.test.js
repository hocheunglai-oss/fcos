import assert from 'node:assert/strict';
import test from 'node:test';
import { observeExistingXeroSession } from '../scripts/lib/hosted-release/xero-existing-session-observation.mjs';

const NOW = 1_800_000_000_000;
const OPERATION_ID = 'd'.repeat(64);
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const BUDGET_ID = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'xero-access-token-must-never-be-serialized';

function binding(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'fcos_xero_existing_session_observation_binding_v1',
    operationId: OPERATION_ID,
    intentSha256: 'a'.repeat(64),
    schemaEvidenceSha256: 'b'.repeat(64),
    identityEvidenceSha256: 'c'.repeat(64),
    tenantId: TENANT_ID,
    requestId: REQUEST_ID,
    budgetId: BUDGET_ID,
    ownerKey: `xero-session:${OPERATION_ID}`,
    issuedAt: NOW - 1_000,
    notAfter: NOW + 10 * 60_000,
    supabaseProject: 'pjforfvchygdyqfcgpmw',
    ...overrides,
  };
}

function connection(overrides = {}) {
  return {
    id: 'primary',
    tenant_id: TENANT_ID,
    access_token: TOKEN,
    expires_at: new Date(NOW + 5 * 60_000).toISOString(),
    token_version: 7,
    ...overrides,
  };
}

function status(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    allowanceKnown: true,
    availableCalls: 500,
    reservedCalls: 0,
    spendableCalls: 300,
    reserve: 200,
    inFlight: 0,
    minuteCalls: 0,
    minuteLimit: 45,
    inFlightLimit: 2,
    retryAt: null,
    dailyHold: false,
    revision: 1,
    unresolvedWrites: 0,
    ...overrides,
  };
}

function reservation(overrides = {}) {
  return {
    id: BUDGET_ID,
    tenant_id: TENANT_ID,
    owner_key: `xero-session:${OPERATION_ID}`,
    state: 'active',
    operation_remaining: 1,
    verification_remaining: 0,
    verification_reserved: 0,
    expires_at: new Date(NOW + 60_000).toISOString(),
    ...overrides,
  };
}

function admission(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    tenantId: TENANT_ID,
    deadlineAt: new Date(NOW + 120_000).toISOString(),
    ...overrides,
  };
}

function xeroConnections(rows = [{ tenantId: TENANT_ID, tenantType: 'ORGANISATION', tenantName: 'FCOS' }]) {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-untrusted-debug': 'never-export-this-header' },
  });
}

function controlFixture(overrides = {}) {
  const calls = [];
  const control = {
    status: async (...args) => {
      calls.push(['status', ...args]);
      return status();
    },
    reserve: async (...args) => {
      calls.push(['reserve', ...args]);
      return reservation();
    },
    admit: async (...args) => {
      calls.push(['admit', ...args]);
      return admission();
    },
    observe: async (...args) => {
      calls.push(['observe', ...args]);
      return { recorded: true };
    },
    release: async (...args) => {
      calls.push(['release', ...args]);
      return status();
    },
    ...overrides,
  };
  return { control, calls };
}

function names(calls) {
  return calls.map(([name]) => name);
}

async function rejects(operation) {
  await assert.rejects(operation, error => {
    assert.match(error?.code || '', /^XERO_SESSION_/);
    assert.equal(error.retryable, false);
    assert.ok(error.details && typeof error.details === 'object');
    assert.doesNotMatch(JSON.stringify(error), new RegExp(TOKEN));
    assert.doesNotMatch(JSON.stringify(error), /never-export-this-header|private-controller-error/);
    return true;
  });
}

test('observes exactly one pinned tenant after reserve, admission, and an immutable metadata sequence', async () => {
  const { control, calls } = controlFixture();
  let fetchCalls = 0;
  const result = await observeExistingXeroSession({
    binding: binding({ expectedTenantType: 'ORGANISATION', expectedTenantName: 'FCOS' }),
    connection: connection({ refresh: () => { throw new Error('must not refresh'); }, reconnect: () => { throw new Error('must not reconnect'); }, authorizeProbe: () => { throw new Error('must not probe'); } }),
    control,
    now: () => NOW,
    fetchImpl: async (url, init) => {
      fetchCalls += 1;
      assert.equal(url, 'https://api.xero.com/connections');
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.body, undefined);
      assert.ok(init.signal);
      const headers = new Headers(init.headers);
      assert.deepEqual([...headers.keys()].sort(), ['accept', 'authorization']);
      assert.equal(headers.get('accept'), 'application/json');
      assert.equal(headers.get('authorization'), `Bearer ${TOKEN}`);
      return xeroConnections([
        { tenantId: '55555555-5555-4555-8555-555555555555', tenantType: 'ORGANISATION', tenantName: 'Unrelated' },
        { tenantId: TENANT_ID, tenantType: 'ORGANISATION', tenantName: 'FCOS' },
      ]);
    },
  });

  assert.equal(fetchCalls, 1);
  assert.deepEqual(names(calls), ['status', 'reserve', 'admit', 'observe', 'release']);
  assert.equal(calls[0][1], TENANT_ID);
  assert.deepEqual(calls[1][1], { tenantId: TENANT_ID, budgetId: BUDGET_ID, ownerKey: `xero-session:${OPERATION_ID}`, operationCalls: 1, verificationCalls: 0, ttlSeconds: 60 });
  assert.deepEqual(calls[2][1], { tenantId: TENANT_ID, tokenVersion: 7, requestId: REQUEST_ID, method: 'GET', resourceKey: 'Connections', budgetId: BUDGET_ID, budgetPhase: 'operation', probeId: null });
  assert.equal(calls[3][1].tenantId, TENANT_ID);
  assert.equal(calls[3][1].requestId, REQUEST_ID);
  assert.equal(calls[3][1].status, 200);
  assert.ok(calls[3][1].headers instanceof Headers);
  assert.equal(calls[3][1].outcomeUnknown, false);
  assert.equal(calls[4][1].tenantId, TENANT_ID);
  assert.equal(calls[4][1].budgetId, BUDGET_ID);
  assert.equal(result.kind, 'xero_existing_session_observation_v1');
  assert.equal(result.status, 'observed');
  assert.equal(result.baselineAccepted, false);
  assert.equal(result.financialAuthorityGranted, false);
  assert.equal(result.operationId, OPERATION_ID);
  assert.equal(result.tenantId, TENANT_ID);
  assert.equal(result.tokenVersion, 7);
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.budgetId, BUDGET_ID);
  assert.equal(result.capturedAt, new Date(NOW).toISOString());
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
});

test('preflight session and binding failures make no controller or network calls', async () => {
  const invalid = [
    ['missing binding kind', binding({ kind: undefined })],
    ['unknown binding field', binding({ unexpected: true })],
    ['expired binding', binding({ notAfter: NOW })],
    ['wrong owner key', binding({ ownerKey: 'xero-session:wrong' })],
    ['expired session', binding(), connection({ expires_at: new Date(NOW + 90_000).toISOString() })],
    ['missing session token', binding(), connection({ access_token: undefined })],
    ['wrong session tenant', binding(), connection({ tenant_id: '55555555-5555-4555-8555-555555555555' })],
    ['bad token version', binding(), connection({ token_version: 0 })],
    ['noninteger token version', binding(), connection({ token_version: 1.5 })],
    ['coerced token version', binding(), connection({ token_version: '7' })],
    ['invalid token header', binding(), connection({ access_token: `${TOKEN}\r\nprivate` })],
    ['wrong primary row', binding(), connection({ id: 'secondary' })],
    ['foreign Supabase project', binding({ supabaseProject: 'other' })],
  ];
  for (const [name, candidateBinding, candidateConnection = connection()] of invalid) {
    await test(name, async () => {
      const { control, calls } = controlFixture();
      let fetched = 0;
      await rejects(() => observeExistingXeroSession({ binding: candidateBinding, connection: candidateConnection, control, now: () => NOW, fetchImpl: async () => { fetched += 1; return xeroConnections(); } }));
      assert.equal(fetched, 0);
      assert.deepEqual(calls, []);
    });
  }
});

test('unfunded or saturated status and an expired admission never send the Xero request', async () => {
  const cases = [
    ['unknown allowance', status({ allowanceKnown: false })],
    ['wrong reserve', status({ reserve: 199 })],
    ['reserve exhausted', status({ availableCalls: 200, spendableCalls: 0 })],
    ['other reserved capacity', status({ reservedCalls: 300, spendableCalls: 0 })],
    ['retry wait', status({ retryAt: new Date(NOW + 60_000).toISOString() })],
    ['daily hold', status({ dailyHold: true })],
    ['minute ceiling', status({ minuteCalls: 45 })],
    ['in-flight ceiling', status({ inFlight: 2 })],
  ];
  for (const [name, rejectedStatus] of cases) {
    await test(name, async () => {
      const { control, calls } = controlFixture({ status: async (...args) => { calls.push(['status', ...args]); return rejectedStatus; } });
      let fetched = 0;
      await rejects(() => observeExistingXeroSession({ binding: binding(), connection: connection(), control, now: () => NOW, fetchImpl: async () => { fetched += 1; return xeroConnections(); } }));
      assert.equal(fetched, 0);
      assert.deepEqual(names(calls), ['status']);
    });
  }
  const { control, calls } = controlFixture({ admit: async (...args) => { calls.push(['admit', ...args]); return admission({ deadlineAt: new Date(NOW).toISOString() }); } });
  await rejects(() => observeExistingXeroSession({ binding: binding(), connection: connection(), control, now: () => NOW, fetchImpl: async () => xeroConnections() }));
  assert.deepEqual(names(calls), ['status', 'reserve', 'admit']);
});

test('malformed or thrown metadata acknowledgements terminate without retries or cleanup callbacks', async () => {
  const stages = ['status', 'reserve', 'admit', 'observe', 'release'];
  for (const stage of stages) {
    for (const mode of ['malformed', 'throw']) {
      await test(`${stage} ${mode}`, async () => {
        const { control, calls } = controlFixture({
          [stage]: async (...args) => {
            calls.push([stage, ...args]);
            if (mode === 'throw') throw new Error('private-controller-error');
            return {};
          },
        });
        let fetched = 0;
        await rejects(() => observeExistingXeroSession({ binding: binding(), connection: connection(), control, now: () => NOW, fetchImpl: async () => { fetched += 1; return xeroConnections(); } }));
        const index = stages.indexOf(stage);
        assert.deepEqual(names(calls), stages.slice(0, index + 1));
        assert.equal(fetched, index < 3 ? 0 : 1);
      });
    }
  }
});

test('controller correlation mismatches and superseded observation are terminal', async () => {
  const cases = [
    ['reservation budget', 'reserve', reservation({ id: REQUEST_ID }), ['status', 'reserve']],
    ['reservation tenant', 'reserve', reservation({ tenant_id: REQUEST_ID }), ['status', 'reserve']],
    ['admission request', 'admit', admission({ requestId: BUDGET_ID }), ['status', 'reserve', 'admit']],
    ['observation superseded', 'observe', { recorded: true, superseded: true }, ['status', 'reserve', 'admit', 'observe']],
  ];
  for (const [name, stage, acknowledgement, expectedCalls] of cases) {
    await test(name, async () => {
      const { control, calls } = controlFixture();
      control[stage] = async (...args) => {
        calls.push([stage, ...args]);
        return acknowledgement;
      };
      await rejects(() => observeExistingXeroSession({ binding: binding(), connection: connection(), control, now: () => NOW, fetchImpl: async () => xeroConnections() }));
      assert.deepEqual(names(calls), expectedCalls);
    });
  }
});

test('network, body, identity, and HTTP failures are observed before a single release and remain sanitized', async () => {
  const cases = [
    ['network', async () => { throw new Error(`private ${TOKEN}`); }, null],
    ['malformed JSON', async () => new Response('{not-json', { status: 200, headers: { 'x-untrusted-debug': 'never-export-this-header' } }), 200],
    ['oversized body', async () => new Response('x'.repeat(65 * 1024), { status: 200 }), 200],
    ['missing tenant', async () => xeroConnections([]), 200],
    ['duplicate tenant', async () => xeroConnections([{ tenantId: TENANT_ID }, { tenantId: TENANT_ID }]), 200],
    ['identity mismatch', async () => xeroConnections([{ tenantId: TENANT_ID, tenantType: 'ORGANISATION', tenantName: 'Other' }]), 200],
    ['401', async () => new Response(`private ${TOKEN}`, { status: 401, headers: { 'x-untrusted-debug': 'never-export-this-header' } }), 401],
    ['429', async () => new Response(`private ${TOKEN}`, { status: 429, headers: { 'x-untrusted-debug': 'never-export-this-header', 'x-rate-limit-remaining': '9999' } }), 429],
    ['500', async () => new Response(`private ${TOKEN}`, { status: 500, headers: { 'x-untrusted-debug': 'never-export-this-header' } }), 500],
  ];
  for (const [name, fetchImpl, expectedStatus] of cases) {
    await test(name, async () => {
      const { control, calls } = controlFixture();
      let fetched = 0;
      await rejects(() => observeExistingXeroSession({
        binding: binding(name === 'identity mismatch' ? { expectedTenantName: 'FCOS' } : {}),
        connection: connection(),
        control,
        now: () => NOW,
        fetchImpl: async (...args) => { fetched += 1; return fetchImpl(...args); },
      }));
      assert.equal(fetched, 1);
      assert.deepEqual(names(calls), ['status', 'reserve', 'admit', 'observe', 'release']);
      assert.equal(calls[3][1].status, expectedStatus);
      if (expectedStatus === null) {
        assert.equal(calls[3][1].headers, null);
        assert.equal(calls[3][1].outcomeUnknown, false);
      } else {
        assert.ok(calls[3][1].headers instanceof Headers);
      }
    });
  }
});

test('a binding that expires during metadata admission cannot be sent', async () => {
  let clock = NOW;
  const { control, calls } = controlFixture();
  control.admit = async (...args) => {
      calls.push(['admit', ...args]);
      clock = NOW + 10 * 60_000 + 1;
      return admission();
  };
  let fetched = 0;
  await rejects(() => observeExistingXeroSession({
    binding: binding(),
    connection: connection(),
    control,
    now: () => clock,
    fetchImpl: async () => { fetched += 1; return xeroConnections(); },
  }));
  assert.equal(fetched, 0);
  assert.deepEqual(names(calls), ['status', 'reserve', 'admit']);
});

test('rejected HTTP responses cancel stalled bodies without another provider request', async () => {
  for (const httpStatus of [401, 429, 500]) {
    const { control, calls } = controlFixture();
    let cancelled = 0;
    let signal;
    await rejects(() => observeExistingXeroSession({
      binding: binding(), connection: connection(), control, now: () => NOW,
      fetchImpl: async (_url, init) => {
        signal = init.signal;
        return new Response(new ReadableStream({ cancel() { cancelled += 1; } }), { status: httpStatus });
      },
    }));
    assert.equal(signal.aborted, true);
    assert.equal(cancelled, 1);
    assert.deepEqual(names(calls), ['status', 'reserve', 'admit', 'observe', 'release']);
  }
});

test('a refused observation locally cancels its read without a release or later RPC', async () => {
  const { control, calls } = controlFixture();
  control.observe = async (...args) => { calls.push(['observe', ...args]); throw new Error('private-controller-error'); };
  let cancelled = 0;
  await rejects(() => observeExistingXeroSession({
    binding: binding(), connection: connection(), control, now: () => NOW,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled += 1; } }), { status: 200 }),
  }));
  assert.equal(cancelled, 1);
  assert.deepEqual(names(calls), ['status', 'reserve', 'admit', 'observe']);
});

test('an indefinitely pending admission times out without a fetch or cleanup mutation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { control, calls } = controlFixture();
  control.admit = (...args) => { calls.push(['admit', ...args]); return new Promise(() => {}); };
  let fetched = 0;
  const rejected = rejects(() => observeExistingXeroSession({
    binding: binding(), connection: connection(), control, now: () => NOW,
    fetchImpl: async () => { fetched += 1; return xeroConnections(); },
  }));
  for (let i = 0; i < 100 && !names(calls).includes('admit'); i += 1) await Promise.resolve();
  assert.ok(names(calls).includes('admit'));
  t.mock.timers.tick(5001);
  await rejected;
  assert.equal(fetched, 0);
  assert.deepEqual(names(calls), ['status', 'reserve', 'admit']);
});

test('a stalled GET is consumed once, observed as unknown, and never retried', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { control, calls } = controlFixture();
  let fetched = 0;
  let signal;
  const rejected = rejects(() => observeExistingXeroSession({
    binding: binding(), connection: connection(), control, now: () => NOW,
    fetchImpl: (_url, init) => { fetched += 1; signal = init.signal; return new Promise(() => {}); },
  }));
  for (let i = 0; i < 100 && fetched === 0; i += 1) await Promise.resolve();
  assert.equal(fetched, 1);
  t.mock.timers.tick(5001);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(fetched, 1);
  assert.deepEqual(names(calls), ['status', 'reserve', 'admit', 'observe', 'release']);
  assert.equal(calls[3][1].status, null);
  assert.equal(calls[3][1].outcomeUnknown, false);
});
