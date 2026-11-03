import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCorrectionAllowance, resolveCorrectionReserveAuthority, verifyCorrectionCanary } from '../api/_xeroDocumentCorrectionReserve.js';
import { documentCorrectionHash } from '../api/_xeroDocumentCorrectionPersistence.js';
import { assertXeroFinancialDailyReserve } from '../api/_xeroFinancialSync.js';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const KEY = 'FCOS_XERO_DOCUMENT_CORRECTION_RESERVE_OVERRIDE';
const NOW = Date.parse('2026-09-28T08:00:00.000Z');
const actor = { id: uuid(1), email: 'finance@fixture.invalid' };
const tenantId = uuid(2);
const grant = () => ({ authorityId: uuid(3), actorId: actor.id, tenantId, policy: 'document_field_correction_v1',
  issuedAt: '2026-09-28T07:00:00.000Z', expiresAt: '2026-09-28T11:00:00.000Z', maxBatchSize: 2 });
const envFor = (authority = grant()) => ({ [KEY]: JSON.stringify(authority) });
const canaryFailure = (error) => error?.code === 'XERO_DOCUMENT_CORRECTION_CANARY_INVALID' && error.status === 409;
const quotaFailure = (error) => error?.code === 'XERO_FINANCIAL_DAILY_RESERVE' && error.status === 429;

function fixture(t) {
  t.mock.method(Date, 'now', () => NOW);
  const authority = grant();
  const items = [1, 2].map((index) => ({ id: uuid(10 + index), xeroInvoiceId: uuid(20 + index), outcome: 'eligible',
    source: { id: `source-${index}`, amount: 123.45 }, before: { LineItems: [{ LineItemID: uuid(30 + index), UnitAmount: 1.2345 }] },
    projection: { fields: { Description: '28/9/2026' } } }));
  const preview = { id: uuid(4), policy: authority.policy, tenant_id: tenantId, created_by: actor.id,
    created_at: '2026-09-28T07:10:21.798974+00:00', summary: { allowanceAuthority: structuredClone(authority) }, items };
  const pin = { id: 42, event_type: 'document_correction_allowance_canary', actor_id: actor.id, actor_email: actor.email,
    created_at: '2026-09-28T07:11:21.798974+00:00', fingerprints: {
      authorityId: authority.authorityId, grantHash: documentCorrectionHash(authority), tenantId, previewId: preview.id,
      itemIds: items.map((item) => item.id).sort(), xeroInvoiceIds: items.map((item) => item.xeroInvoiceId).sort(),
    } };
  return { authority, preview, selected: structuredClone(items), actor, pin, env: envFor(authority) };
}

function database(rows, options = {}) {
  const calls = []; const predicates = [];
  const builder = {
    select(fields) { calls.push(['select', fields]); return this; },
    eq(field, value) { calls.push(['eq', field, value]); predicates.push([field, value]); return this; },
    async limit(count) {
      calls.push(['limit', count]); options.beforeReturn?.();
      if (options.throwError) throw new Error('Private database connection detail');
      const filtered = options.ignoreFilters || !Array.isArray(rows) ? rows : rows.filter((row) => predicates.every(([field, value]) =>
        (field === 'fingerprints->>authorityId' ? row.fingerprints?.authorityId : row[field]) === value));
      return { data: Array.isArray(filtered) ? structuredClone(filtered.slice(0, count)) : filtered, error: options.error || null };
    },
  };
  return { calls, client: { from(table) { calls.push(['from', table]); return builder; } } };
}

test('a current exact actor and tenant grant resolves to a detached authority with a maximum four-hour lifetime', (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const value = grant(); const env = envFor(value);
  const resolved = resolveCorrectionReserveAuthority(env, actor, tenantId);
  assert.deepEqual(resolved, value); assert.notEqual(resolved, value);
  resolved.maxBatchSize = 99;
  assert.equal(resolveCorrectionReserveAuthority(env, actor, tenantId).maxBatchSize, 2);
  assert.equal(env[KEY], JSON.stringify(value));
  const atIssuance = { ...value, issuedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 1).toISOString() };
  assert.deepEqual(resolveCorrectionReserveAuthority(envFor(atIssuance), actor, tenantId), atIssuance);
});

test('invalid, unscoped, future, expired and overlong grants resolve to the normal-reserve path', (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const changes = [
    { authorityId: 'not-a-uuid' }, { authorityId: '00000000-0000-0000-0000-000000000000' },
    { actorId: uuid(99) }, { tenantId: uuid(99) }, { policy: 'another-policy' }, { maxBatchSize: 3 }, { maxBatchSize: '2' },
    { issuedAt: '2026-09-28T08:00:00.001Z' }, { expiresAt: '2026-09-28T08:00:00.000Z' },
    { expiresAt: '2026-09-28T06:00:00.000Z' }, { expiresAt: '2026-09-28T11:00:00.001Z' },
    { issuedAt: '2026-09-28' }, { issuedAt: '2026-09-28T07:00:00+00:00' },
    { issuedAt: '2026-02-30T07:00:00Z' }, { expiresAt: '2026-09-28T24:00:00Z' }, { extra: true },
  ];
  for (const change of changes) assert.equal(resolveCorrectionReserveAuthority(envFor({ ...grant(), ...change }), actor, tenantId), null, JSON.stringify(change));
  for (const missing of Object.keys(grant())) {
    const value = grant(); delete value[missing];
    assert.equal(resolveCorrectionReserveAuthority(envFor(value), actor, tenantId), null, missing);
  }
  for (const serialized of [undefined, '', 'not-json', 'null', '[]', 'true', '{}', JSON.stringify(grant()).padEnd(4097, ' ')]) {
    assert.equal(resolveCorrectionReserveAuthority({ [KEY]: serialized }, actor, tenantId), null);
  }
  assert.equal(resolveCorrectionReserveAuthority(envFor(), { id: uuid(99) }, tenantId), null);
  assert.equal(resolveCorrectionReserveAuthority(envFor(), actor, uuid(99)), null);
  assert.equal(resolveCorrectionReserveAuthority(envFor(), null, tenantId), null);
});

test('normal operations retain the existing minimum reserve and reserve-plus-three guard', (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const env = { ...envFor(), XERO_DAILY_RESERVE_RATIO: '0' };
  assert.doesNotThrow(() => assertCorrectionAllowance({ dayRemaining: 201 }, env, null));
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 200 }, env, null), quotaFailure);
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 203 }, env, null, { beforeRequest: true, requiredCalls: 3 }), quotaFailure);
  assert.doesNotThrow(() => assertCorrectionAllowance({ dayRemaining: 204 }, env, null, { beforeRequest: true, requiredCalls: 3 }));
  assert.throws(() => assertXeroFinancialDailyReserve({ dayRemaining: 199 }, env), quotaFailure, 'The correction grant never changes the ordinary sync reserve');
  const custom = { XERO_DAILY_LIMIT: '5000', XERO_DAILY_RESERVE_RATIO: '0.4' };
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 2003 }, custom, null, { requiredCalls: 3 }), quotaFailure);
  assert.doesNotThrow(() => assertCorrectionAllowance({ dayRemaining: 2004 }, custom, null, { requiredCalls: 3 }));
});

test('the scoped override permits the last successful read and exactly three protected calls without an extra floor', (t) => {
  const f = fixture(t);
  for (const remaining of [200, 199, 3, 1]) {
    assert.doesNotThrow(() => assertCorrectionAllowance({ dayRemaining: remaining }, f.env, f.authority, { beforeRequest: true }));
  }
  assert.doesNotThrow(() => assertCorrectionAllowance({ dayRemaining: 0 }, f.env, f.authority));
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 0 }, f.env, f.authority, { beforeRequest: true }), quotaFailure);
  assert.doesNotThrow(() => assertCorrectionAllowance({ dayRemaining: 3 }, f.env, f.authority, { beforeRequest: true, requiredCalls: 3 }));
  for (const remaining of [2, 1, 0]) {
    assert.throws(() => assertCorrectionAllowance({ dayRemaining: remaining }, f.env, f.authority, { beforeRequest: true, requiredCalls: 3 }), quotaFailure);
  }
  for (const remaining of [-1, NaN, Infinity, 'invalid']) assert.throws(() => assertCorrectionAllowance({ dayRemaining: remaining }, f.env, f.authority), quotaFailure);
  assert.doesNotThrow(() => assertCorrectionAllowance({}, f.env, f.authority, { beforeRequest: true }));
  assert.doesNotThrow(() => assertCorrectionAllowance({ dayRemaining: null }, f.env, f.authority, { beforeRequest: true }));
  assert.throws(() => assertCorrectionAllowance({}, f.env, f.authority, { beforeRequest: true, requiredCalls: 3 }), quotaFailure,
    'A write claim requires authoritative capacity for all three protected calls');
});

test('an operation cannot keep using a changed or expired authority even when ordinary quota is abundant', (t) => {
  const f = fixture(t);
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 999 }, {}, f.authority), canaryFailure);
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 999 }, envFor({ ...f.authority, authorityId: uuid(99) }), f.authority), canaryFailure);
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 999 }, f.env, { ...f.authority, maxBatchSize: 3 }), canaryFailure);
  for (const options of [{ requiredCalls: -1 }, { requiredCalls: 1.5 }, { requiredCalls: '3' }, { beforeRequest: 'true' }]) {
    assert.throws(() => assertCorrectionAllowance({ dayRemaining: 999 }, f.env, f.authority, options), canaryFailure);
  }
  t.mock.method(Date, 'now', () => Date.parse(f.authority.expiresAt));
  assert.equal(resolveCorrectionReserveAuthority(f.env, actor, tenantId), null);
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 999 }, f.env, f.authority, { beforeRequest: true }), canaryFailure);
});

test('canary verification requires one exact server audit pin and returns detached full evidence with Supabase timestamps', async (t) => {
  const f = fixture(t); const db = database([f.pin]); const before = structuredClone(f);
  const receipt = await verifyCorrectionCanary(db.client, { ...f, selected: [...f.selected].reverse() });
  assert.deepEqual(receipt, { grant: f.authority, pin: f.pin });
  assert.deepEqual(db.calls, [
    ['from', 'xero_financial_audit_events'], ['select', 'id,event_type,actor_id,actor_email,fingerprints,created_at'],
    ['eq', 'event_type', 'document_correction_allowance_canary'], ['eq', 'fingerprints->>authorityId', f.authority.authorityId],
    ['eq', 'actor_id', actor.id], ['limit', 2],
  ]);
  receipt.grant.maxBatchSize = 99; receipt.pin.fingerprints.itemIds.push(uuid(999));
  assert.deepEqual(f, before, 'Returned journal evidence must not mutate saved preview or audit evidence');
});

test('invalid preview authority, selected identity or source evidence fails before any database or provider access', async (t) => {
  const f = fixture(t);
  const mutations = [
    (value) => { value.authority = null; },
    (value) => { value.actor.id = uuid(99); },
    (value) => { value.preview.created_by = uuid(99); },
    (value) => { value.preview.tenant_id = uuid(99); },
    (value) => { value.preview.id = 'untrusted'; },
    (value) => { value.preview.policy = 'other-policy'; },
    (value) => { delete value.preview.summary.allowanceAuthority; },
    (value) => { value.preview.summary.allowanceAuthority.authorityId = uuid(99); },
    (value) => { value.preview.created_at = '2026-09-28T06:59:59.999999+00:00'; },
    (value) => { value.preview.created_at = '2026-09-28T08:00:00.001000+00:00'; },
    (value) => { value.preview.created_at = '2026-02-30T07:10:21.798974+00:00'; },
    (value) => { value.selected = []; },
    (value) => { value.selected.push(structuredClone(value.selected[0])); },
    (value) => { value.selected[0].id = uuid(99); },
    (value) => { value.selected[0].source.amount += 0.01; },
    (value) => { value.selected[0].before.LineItems[0].UnitAmount = 1.23; },
    (value) => { value.selected[0].outcome = 'blocked'; },
    (value) => { value.selected[1] = structuredClone(value.selected[0]); },
    (value) => { value.selected[1].xeroInvoiceId = value.selected[0].xeroInvoiceId; value.preview.items[1] = structuredClone(value.selected[1]); },
    (value) => { value.preview.items.push(structuredClone(value.preview.items[0])); },
    (value) => { value.preview.items = null; },
    (value) => { value.readbackOnly = 'true'; },
  ];
  for (const mutate of mutations) {
    const input = structuredClone(f); mutate(input);
    const db = database([f.pin]);
    await assert.rejects(verifyCorrectionCanary(db.client, input), canaryFailure, mutate.toString());
    assert.equal(db.calls.length, 0, 'Reject invalid local authority before reading even the pin');
  }
});

test('missing, ambiguous or failed audit lookup never silently chooses a pin or exposes a database error', async (t) => {
  const f = fixture(t);
  for (const [rows, options] of [[[], {}], [null, {}], [[f.pin, { ...f.pin, id: 43 }], {}],
    [[f.pin], { error: { message: 'private database detail' } }], [[f.pin], { throwError: true }]]) {
    const db = database(rows, options);
    await assert.rejects(verifyCorrectionCanary(db.client, f), (error) => canaryFailure(error) && !error.message.includes('private'));
  }
});

test('audit pins must match the exact actor, tenant, grant, saved preview and original target cohort', async (t) => {
  const f = fixture(t);
  const mutations = [
    (pin) => { pin.id = 0; }, (pin) => { pin.event_type = 'unrelated'; }, (pin) => { pin.actor_id = uuid(99); },
    (pin) => { pin.fingerprints.authorityId = uuid(99); }, (pin) => { pin.fingerprints.tenantId = uuid(99); },
    (pin) => { pin.fingerprints.previewId = uuid(99); }, (pin) => { pin.fingerprints.grantHash = 'wrong-hash'; },
    (pin) => { pin.fingerprints.extra = true; }, (pin) => { delete pin.fingerprints.previewId; },
    (pin) => { pin.fingerprints.itemIds.reverse(); }, (pin) => { pin.fingerprints.xeroInvoiceIds.reverse(); },
    (pin) => { pin.fingerprints.itemIds = [uuid(99)]; }, (pin) => { pin.fingerprints.xeroInvoiceIds = [uuid(99)]; },
    (pin) => { pin.fingerprints.itemIds[1] = pin.fingerprints.itemIds[0]; },
    (pin) => { pin.fingerprints.xeroInvoiceIds[1] = pin.fingerprints.xeroInvoiceIds[0]; },
    (pin) => { pin.fingerprints.itemIds = []; }, (pin) => { pin.fingerprints.xeroInvoiceIds = []; },
    (pin) => { pin.created_at = '2026-09-28T07:10:20.798974+00:00'; },
    (pin) => { pin.created_at = '2026-09-28T08:00:00.001000+00:00'; },
    (pin) => { pin.created_at = '2026-09-28T11:00:00.000000+00:00'; },
  ];
  for (const mutate of mutations) {
    const pin = structuredClone(f.pin); mutate(pin);
    const db = database([pin], { ignoreFilters: true });
    await assert.rejects(verifyCorrectionCanary(db.client, f), canaryFailure, mutate.toString());
  }
});

test('a single-record original pin is valid, but Apply cannot use only part of an original two-record pin', async (t) => {
  const f = fixture(t); const selected = f.selected.slice(0, 1);
  await assert.rejects(verifyCorrectionCanary(database([f.pin]).client, { ...f, selected }), canaryFailure);
  const pin = structuredClone(f.pin); pin.fingerprints.itemIds = [selected[0].id]; pin.fingerprints.xeroInvoiceIds = [selected[0].xeroInvoiceId];
  const receipt = await verifyCorrectionCanary(database([pin]).client, { ...f, selected });
  assert.deepEqual(receipt.pin.fingerprints.itemIds, [selected[0].id]);
});

test('Verify accepts an exact nonempty subset while validating every saved member of the original pin', async (t) => {
  const f = fixture(t); const selected = f.selected.slice(1); const db = database([f.pin]);
  const receipt = await verifyCorrectionCanary(db.client, { ...f, selected, readbackOnly: true });
  assert.deepEqual(receipt.pin.fingerprints.itemIds, f.pin.fingerprints.itemIds, 'The full pin remains journaled');
  const unrelated = { ...structuredClone(f.selected[0]), id: uuid(99), xeroInvoiceId: uuid(98) };
  const expanded = { ...f, preview: { ...f.preview, items: [...f.preview.items, unrelated] }, selected: [unrelated], readbackOnly: true };
  await assert.rejects(verifyCorrectionCanary(database([f.pin]).client, expanded), canaryFailure);
  for (const mutate of [
    (value) => { value.preview.items.shift(); },
    (value) => { value.preview.items[0].xeroInvoiceId = uuid(99); },
    (value) => { value.preview.items[0].outcome = 'blocked'; },
  ]) {
    const input = { ...structuredClone(f), selected, readbackOnly: true }; mutate(input);
    await assert.rejects(verifyCorrectionCanary(database([f.pin]).client, input), canaryFailure);
  }
});

test('expiry during the audit lookup rejects the pin before the caller can read or mutate Xero', async (t) => {
  const f = fixture(t);
  const db = database([f.pin], { beforeReturn: () => t.mock.method(Date, 'now', () => Date.parse(f.authority.expiresAt)) });
  await assert.rejects(verifyCorrectionCanary(db.client, f), canaryFailure);
});

test('an expired original grant remains verifiable only for readback and never reactivates its quota exception', async (t) => {
  const f = fixture(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-09-29T08:00:00.000Z'));
  const expiredApply = database([f.pin]);
  await assert.rejects(verifyCorrectionCanary(expiredApply.client, f), canaryFailure);
  assert.equal(expiredApply.calls.length, 0, 'Apply must reject expired authority before loading the pin');
  const receipt = await verifyCorrectionCanary(database([f.pin]).client, { ...f, selected: f.selected.slice(0, 1), readbackOnly: true });
  assert.deepEqual(receipt, { grant: f.authority, pin: f.pin });
  const liveAuthority = resolveCorrectionReserveAuthority(f.env, actor, tenantId);
  assert.equal(liveAuthority, null);
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 199 }, f.env, liveAuthority, { beforeRequest: true }), quotaFailure);
  assert.doesNotThrow(() => assertCorrectionAllowance({ dayRemaining: 201 }, f.env, liveAuthority, { beforeRequest: true }));
  assert.throws(() => assertCorrectionAllowance({ dayRemaining: 999 }, f.env, receipt.grant, { beforeRequest: true }), canaryFailure,
    'Historical verification evidence is never a live provider allowance grant');
});

test('historical readback still rejects malformed or future grants and pins not created within the original grant', async (t) => {
  const f = fixture(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-09-29T08:00:00.000Z'));
  for (const change of [
    { maxBatchSize: 3 }, { policy: 'other-policy' }, { actorId: uuid(99) }, { tenantId: uuid(99) },
    { issuedAt: '2026-09-30T07:00:00.000Z', expiresAt: '2026-09-30T11:00:00.000Z' },
    { expiresAt: '2026-09-28T11:00:00.001Z' }, { expiresAt: '2026-09-28T07:00:00.000Z' },
    { expiresAt: 'invalid' }, { issuedAt: '2026-02-30T07:00:00.000Z' },
  ]) {
    const input = structuredClone(f); input.authority = { ...input.authority, ...change };
    input.preview.summary.allowanceAuthority = structuredClone(input.authority);
    input.pin.fingerprints.grantHash = documentCorrectionHash(input.authority);
    const db = database([input.pin]);
    await assert.rejects(verifyCorrectionCanary(db.client, { ...input, readbackOnly: true }), canaryFailure, JSON.stringify(change));
    assert.equal(db.calls.length, 0);
  }
  for (const createdAt of ['2026-09-28T06:59:59.999999+00:00', '2026-09-28T11:00:00.000000+00:00', '2026-09-29T07:00:00.000000+00:00']) {
    const pin = { ...structuredClone(f.pin), created_at: createdAt };
    await assert.rejects(verifyCorrectionCanary(database([pin]).client, { ...f, readbackOnly: true }), canaryFailure, createdAt);
    const preview = { ...structuredClone(f.preview), created_at: createdAt };
    await assert.rejects(verifyCorrectionCanary(database([f.pin]).client, { ...f, preview, readbackOnly: true }), canaryFailure, createdAt);
  }
});
