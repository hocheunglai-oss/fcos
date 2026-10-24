import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinatorClient } from '../scripts/lib/hosted-release/coordinator-client.mjs';
import { consequential, safeFailure } from '../scripts/lib/hosted-release/controller.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';

const H = 'a'.repeat(64), owner = { kind: 'release', id: 'features' };
const pending = seconds => Response.json({ error: 'COORDINATION_METADATA_PENDING' }, { status: 429, headers: { 'Retry-After': String(seconds) } });
const scope = () => ({ releaseId: 'release-pending-example', manifestHash: H, phase: 'preview.create', operationId: 'exact-operation', requestHash: H });
function clientFixture(fetchImpl, options = {}) {
  const waits = [], requests = [], tokens = []; let clock = 0;
  const client = createCoordinatorClient({ url: 'https://coordinator.example.test/coordinate', epoch: 2, owner,
    now: () => clock, wait: async ms => { waits.push(ms); clock += ms; },
    tokenProvider: async request => { tokens.push(request); return `fresh-${tokens.length}`; },
    fetch: async (url, init) => { requests.push({ url, ...init }); return fetchImpl(init, requests.length); }, ...options });
  return { client, waits, requests, tokens, clock: () => clock, advance: ms => { clock += ms; } };
}

test('exact definitive metadata pending retries unchanged operation with a fresh identity each time', async () => {
  const input = { ...scope(), details: { preserved: true } };
  const f = clientFixture((init, attempt) => attempt <= 2 ? pending(attempt) : Response.json({ disposition: 'execute' }), {
    now: () => 0, wait: async () => { input.details.preserved = false; input.operationId = 'changed-after-submit'; },
  });
  assert.deepEqual(await f.client.begin(input), { disposition: 'execute' });
  assert.equal(f.requests.length, 3); assert.equal(new Set(f.requests.map(row => row.body)).size, 1);
  assert.deepEqual(f.requests.map(row => row.headers.authorization), ['Bearer fresh-1','Bearer fresh-2','Bearer fresh-3']);
  assert.deepEqual(f.tokens, Array.from({ length: 3 }, () => ({ audience: 'fcos-release-coordinator' })));
  const body = JSON.parse(f.requests[0].body);
  assert.equal(body.payload.operationId, 'exact-operation'); assert.equal(body.payload.details.preserved, true);
  assert.equal(body.payload.epoch, 2); assert.deepEqual(body.payload.owner, owner);
});

test('pending evidence publication retains original evidence ID, bytes and timestamp', async () => {
  const input = { releaseId: scope().releaseId, manifestHash: H, key: 'nom_b', evidence: { capturedAt: '2026-10-01T00:00:00Z', result: { valid: true } } };
  const f = clientFixture((init, attempt) => attempt === 1 ? pending(1) : Response.json({ saved: true }));
  assert.deepEqual(await f.client.appendEvidence(input), { saved: true });
  assert.deepEqual(f.waits, [1000]); assert.equal(f.requests[0].body, f.requests[1].body);
  const body = JSON.parse(f.requests[0].body);
  assert.match(body.payload.evidenceId, /^[a-f0-9]{64}$/); assert.equal(body.payload.evidence.capturedAt, input.evidence.capturedAt);
  assert.equal(body.payload.evidence.key, 'nom_b');
});

test('successful registration after metadata wait keeps the original manifest binding for later requests', async () => {
  const input = { releaseId: scope().releaseId, manifestHash: H, manifest: { immutable: true } };
  const f = clientFixture((init, attempt) => attempt === 1 ? pending(1) : Response.json({ registered: true }), {
    now: () => 0, wait: async () => { input.releaseId = 'mutated-caller'; },
  });
  await f.client.register(input); await f.client.snapshot({ releaseId: scope().releaseId });
  assert.equal(JSON.parse(f.requests[2].body).payload.manifestHash, H);
  assert.equal(JSON.parse(f.requests[1].body).payload.releaseId, scope().releaseId);
});

test('metadata waiting is capped at 180 seconds and preserves actionable intervention diagnostics', async () => {
  const f = clientFixture(() => pending(60));
  let error; try { await f.client.begin(scope()); } catch (caught) { error = caught; }
  assert.equal(error.code, 'COORDINATION_METADATA_PENDING'); assert.equal(error.phase, 'coordinator.metadata');
  assert.equal(f.clock(), 180000); assert.deepEqual(f.waits, [60000,60000,60000]); assert.equal(f.requests.length, 4);
  assert.equal(new Set(f.requests.map(row => row.body)).size, 1);
  assert.deepEqual(safeFailure(error), { status: 'intervention_required', code: 'COORDINATION_METADATA_PENDING', phase: 'coordinator.metadata', recovery: error.recovery });
  assert.match(error.recovery, /unchanged manifest/);
});

test('elapsed request time and delayed waits consume the same bound; clock rollback cannot make waiting unbounded', async () => {
  const f = clientFixture(() => { f.advance(179000); return pending(2); });
  await assert.rejects(f.client.begin(scope()), { code: 'COORDINATION_METADATA_PENDING' });
  assert.equal(f.requests.length, 1); assert.deepEqual(f.waits, []);
  const g = clientFixture(() => pending(60), { now: () => -1, wait: async () => {} });
  await assert.rejects(g.client.begin(scope()), { code: 'COORDINATION_METADATA_PENDING' });
  assert.equal(g.requests.length, 4);
  let lateClock = 0;
  const late = clientFixture(() => pending(1), { now: () => lateClock, wait: async () => { lateClock += 181000; } });
  await assert.rejects(late.client.begin(scope()), { code: 'COORDINATION_METADATA_PENDING' }); assert.equal(late.requests.length, 1);
});

test('other errors, malformed pending responses and invalid Retry-After values are never retried', async () => {
  const cases = [
    () => Response.json({ error: 'OTHER_QUOTA_PENDING' }, { status: 429, headers: { 'Retry-After': '1' } }),
    () => Response.json({ error: 'COORDINATION_METADATA_PENDING', extra: true }, { status: 429, headers: { 'Retry-After': '1' } }),
    () => Response.json({ error: 'COORDINATION_METADATA_PENDING' }, { status: 503, headers: { 'Retry-After': '1' } }),
    ...[undefined,'0','61','01','1.5','Wed, 21 Oct 2026 07:28:00 GMT'].map(value => () => Response.json({ error: 'COORDINATION_METADATA_PENDING' },
      { status: 429, headers: value === undefined ? {} : { 'Retry-After': value } })),
    () => ({ status: 429, ok: false, redirected: true, headers: new Headers({ 'Retry-After': '1' }), json: async () => ({ error: 'COORDINATION_METADATA_PENDING' }) }),
  ];
  for (const response of cases) {
    const f = clientFixture(response);
    await assert.rejects(f.client.begin(scope())); assert.equal(f.requests.length, 1); assert.deepEqual(f.waits, []); assert.equal(f.tokens.length, 1);
  }
});

test('timeout, lost body, or a lost response after pending retains uncertain-outcome readback without retry', async () => {
  for (const response of [() => { throw new Error('network timed out after commit'); },
    () => ({ ok: false, status: 429, redirected: false, headers: new Headers({ 'Retry-After': '1' }), json: async () => { throw new Error('lost body'); } })]) {
    const f = clientFixture(response);
    await assert.rejects(f.client.begin(scope()), /COORDINATION_RESPONSE_UNKNOWN/); assert.equal(f.requests.length, 1); assert.deepEqual(f.waits, []);
  }
  const f = clientFixture((init, attempt) => { if (attempt === 1) return pending(1); throw new Error('committed response lost'); });
  await assert.rejects(f.client.begin(scope()), /COORDINATION_RESPONSE_UNKNOWN/); assert.equal(f.requests.length, 2); assert.deepEqual(f.waits, [1000]);
});

test('financial adapter keeps its independent no-retry behavior and token audience', async () => {
  const f = clientFixture(() => pending(1), { adapter: 'financial' });
  await assert.rejects(f.client.begin(scope()), /COORDINATION_METADATA_PENDING/);
  assert.equal(f.requests.length, 1); assert.deepEqual(f.waits, []); assert.deepEqual(f.tokens, [{ audience: 'fcos-financial-coordination' }]);
  assert.equal(f.requests[0].headers['x-fcos-coordination-adapter'], 'financial');
});

test('actual consequential controller never submits a provider operation while definitive admission stays pending', async () => {
  const f = clientFixture(() => pending(60)); let providerCalls = 0;
  await assert.rejects(consequential({ manifest: fixtureManifest(), phase: 'preview.create', request: { exact: true }, coordinator: f.client,
    submit: async () => { providerCalls++; }, readback: async () => { providerCalls++; } }), { code: 'COORDINATION_METADATA_PENDING' });
  assert.equal(providerCalls, 0); assert.equal(new Set(f.requests.map(row => row.body)).size, 1);
});

test('quarantine successor refusal reports the public code and never submits or retries', async () => {
  const f = clientFixture(() => Response.json({ error: 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SUCCESSOR_REQUIRED',
    detail: 'synthetic-private-provider-detail' }, { status: 403 }));
  let providerCalls = 0, caught;
  try {
    await consequential({ manifest: fixtureManifest(), phase: 'preview.create', request: { exact: true }, coordinator: f.client,
      submit: async () => { providerCalls++; }, readback: async () => { providerCalls++; } });
  } catch (error) { caught = error; }
  assert.equal(caught?.code, 'COORDINATION_EXACT_PREVIEW_QUARANTINE_SUCCESSOR_REQUIRED');
  assert.equal(caught.phase, 'coordinator.begin');
  assert.equal(providerCalls, 0); assert.equal(f.requests.length, 1); assert.deepEqual(f.waits, []);
  assert.equal(JSON.stringify(safeFailure(caught)).includes('synthetic-private-provider-detail'), false);
  const unknown = clientFixture(() => Response.json({ error: 'synthetic-private-provider-detail' }, { status: 403 }));
  await assert.rejects(unknown.client.begin(scope()), { code: 'COORDINATION_REQUEST_REJECTED' });
});
