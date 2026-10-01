import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the actual private validator, writer and both confirmation paths.
// Salesforce/storage boundaries are fixtures; no application import or provider
// request is needed to verify which writes the source permits.
const source = readFileSync(new URL('../api/_variableCharges.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to).replace(/^export /gm, '');
}

const functions = [
  section('function httpError(', '\nfunction apexUtcTimestamp('),
  section('function operationIdentity(', '\nasync function reserveOperation('),
  section('function currentCaseRow(', '\nasync function requireCaseAuthority('),
  section('function numeric(', '\nfunction normalizeSupplierReviewPayload('),
  section('async function validateReviews(', '\nasync function salesforceChargeWrites('),
  section('async function salesforceChargeWrites(', '\nfunction roundedSalesforceCurrency('),
  section('function selectedSides(', '\nasync function sideStatesForSupplier('),
  section('function sideBody(', '\nfunction mergePairedWrites('),
  section('function normalizeBuyerSide(', '\n// Compatibility helper retained'),
  section('async function validateBuyerSide(', '\nasync function assertAnchorageApprovalReady('),
  section('export async function confirmVariableChargeSides(', '\nexport async function reopenVariableChargeSides('),
  section('export async function saveAndConfirmVariableCharges(', '\nexport async function verifyVariableChargeSupplier('),
].join('\n');

const supplierA = '0012x0000000001AAA';
const supplierB = '0012x0000000002AAA';
const userId = '00000000-0000-4000-8000-000000000001';
const stemId = 'a0H2x0000000001AAA';
const lastModifiedDate = '2026-09-11T01:00:00.000Z';
const sourceFingerprint = 'a'.repeat(64);
const buyerFingerprint = 'b'.repeat(64);

function charge(id, supplierId, amount) {
  return { Id: id, Supplier__c: supplierId, LastModifiedDate: lastModifiedDate,
    Lumpsum_Cost__c: amount, Lumpsum_Price__c: amount + 20 };
}

function fixture() {
  const rows = [charge('a042x0000000001AAA', supplierA, 100), charge('a042x0000000002AAA', supplierB, 200)];
  const writes = [];
  const reservations = [];
  const live = {
    stem: { Id: stemId, LastModifiedDate: lastModifiedDate }, lineItems: [], extraCosts: rows,
    fingerprint: sourceFingerprint,
    supplierRequirements: [{ supplierId: supplierA, effectiveRequired: true,
      sourceFingerprint, buyerChargeSourceFingerprint: buyerFingerprint }],
  };
  const context = { profile: { id: userId, email: 'fixture@example.invalid', user_type: 'trader' },
    client: { rpc: async (name, body) => ({ data: name === 'confirm_variable_charge_case'
      ? { case: { id: 'case-fixture', revision: 4, workflow_status: 'ready_for_invoice' } }
      : { sides: body.p_sides }, error: null }) } };
  const sandbox = vm.createContext({
    console,
    VIEW_ONLY_USER_TYPES: new Set(['finance']),
    pairedWorkflowEnabled: () => true,
    liveCaseForStem: async () => live,
    sideStatesForSupplier: async () => [{ side: 'buyer_charge', revision: 3,
      assigned_user_id: userId, source_fingerprint: buyerFingerprint }],
    activeGeneralManager: async () => ({ isGeneralManager: false }),
    assertLiveActionable: () => {},
    isHongKongStem: () => false,
    assertStatutoryApprovalReady: async () => {},
    assertBasicCallingApprovalReady: async () => {},
    linkedSalesforceFiles: async () => [],
    sha256: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    getApiVersion: () => 'vTEST',
    apexUtcTimestamp: value => value || null,
    requireExternalActionGate: () => {},
    reserveOperation: async (_client, values) => { reservations.push(values); return { status: 'reserved' }; },
    completeOperation: async () => {},
    storedCases: async () => [{ stem_id: stemId, revision: 3, source_fingerprint: sourceFingerprint }],
    requireCaseAuthority: async () => ({ generalManagerOverride: false, reason: null }),
    setSalesforceConfirmed: async () => { writes.push({ path: 'legacy-stem-confirmation' }); },
    sfRequest: async (path, options = {}) => {
      if (options.method === 'POST') writes.push({ path, ...options });
      if (path === '/composite') return { compositeResponse: options.body.compositeRequest.map(() => ({ httpStatusCode: 204 })) };
      return { costFingerprint: sourceFingerprint, buyerFingerprint, lastModifiedAt: lastModifiedDate, buyerConfirmed: true };
    },
  });
  vm.runInContext(`${functions}\nglobalThis.api = { confirmVariableChargeSides, saveAndConfirmVariableCharges, salesforceChargeWrites, validateBuyerSide };`, sandbox);
  return { ...sandbox.api, context, live, rows, writes, reservations };
}

function update(row, buyerPrice) {
  return { extraCostId: row.Id, expectedLastModifiedDate: row.LastModifiedDate, pricingType: 'fixed', buyerPrice };
}

function review(row) {
  return { sourceId: row.Id, reviewed: true, buyerChargeDecision: 'include', referenceOrNote: 'Reviewed current charge' };
}

function sideRequest(f, updates) {
  return { stemId, supplierId: supplierA, sides: ['buyer_charge'],
    operationId: '00000000-0000-4000-8000-000000000002',
    expectedRevisions: { buyer_charge: 3 }, expectedFingerprints: { buyer_charge: buyerFingerprint },
    expectedStemLastModifiedAt: lastModifiedDate, reviews: [review(f.rows[0])], extraCostUpdates: updates };
}

for (const mixed of [false, true]) {
  test(`supplier A buyer-side confirmation rejects ${mixed ? 'mixed A/B' : 'supplier B'} updates before writes`, async () => {
    const f = fixture();
    const updates = mixed ? [update(f.rows[0], 150), update(f.rows[1], 999)] : [update(f.rows[1], 999)];
    await assert.rejects(f.confirmVariableChargeSides(sideRequest(f, updates), f.context), { code: 'SUPPLIER_SCOPE_MISMATCH', status: 403 });
    assert.equal(f.writes.length, 0, 'no charge or confirmation write may occur');
    assert.equal(f.reservations.length, 0, 'foreign updates must fail validation before reserving an operation');
  });
}

test('supplier A buyer-side confirmation writes and confirms its own reviewed charge', async () => {
  const f = fixture();
  const result = await f.confirmVariableChargeSides(sideRequest(f, [update(f.rows[0], 150)]), f.context);
  assert.equal(result.buyerInvoiceReady, true);
  const composite = f.writes.find(row => row.path === '/composite');
  assert.equal(composite.body.allOrNone, true);
  assert.equal(composite.body.compositeRequest.length, 1);
  assert.ok(composite.body.compositeRequest[0].url.endsWith(f.rows[0].Id));
  assert.equal(composite.body.compositeRequest[0].body.Lumpsum_Price__c, 150);
  assert.equal(Object.hasOwn(composite.body.compositeRequest[0].body, 'Lumpsum_Cost__c'), false);
  assert.ok(composite.body.compositeRequest[0].httpHeaders['If-Unmodified-Since']);
  assert.ok(f.writes.some(row => row.path.endsWith(`/supplier/${supplierA}/confirm`)));
  assert.equal(f.reservations.length, 1);
});

test('the writer independently rejects foreign and mixed updates before its composite request', async () => {
  for (const mixed of [false, true]) {
    const f = fixture();
    const updates = mixed ? [update(f.rows[0], 150), update(f.rows[1], 999)] : [update(f.rows[1], 999)];
    await assert.rejects(f.salesforceChargeWrites({ extraCostUpdates: updates }, f.live, { supplierId: supplierA }), { code: 'SUPPLIER_SCOPE_MISMATCH', status: 403 });
    assert.equal(f.writes.length, 0);
  }
});

test('the writer requires an exact supplier or explicit legacy whole-case scope', async () => {
  const f = fixture();
  await assert.rejects(f.salesforceChargeWrites({ extraCostUpdates: [update(f.rows[0], 150)] }, f.live), { code: 'BUYER_WRITE_SCOPE_REQUIRED' });
  assert.equal(f.writes.length, 0);
});

test('supplier-scoped writes retain timestamp and pricing-basis conflict checks', async () => {
  for (const change of [{ expectedLastModifiedDate: '2026-09-10T01:00:00.000Z' }, { pricingType: 'per_unit' }]) {
    const f = fixture();
    await assert.rejects(f.salesforceChargeWrites({ extraCostUpdates: [{ ...update(f.rows[0], 150), ...change }] }, f.live, { supplierId: supplierA }), {
      code: change.pricingType ? 'SUPPLIER_PRICING_BASIS_LOCKED' : 'EXTRA_COST_CONFLICT', status: 409,
    });
    assert.equal(f.writes.length, 0);
  }
});

test('legacy whole-case confirmation retains reviewed updates for both suppliers', async () => {
  const f = fixture();
  const body = { stemId, operationId: '00000000-0000-4000-8000-000000000003',
    expectedRevision: 3, expectedFingerprint: sourceFingerprint, expectedStemLastModifiedAt: lastModifiedDate,
    reviews: f.rows.map(review), extraCostUpdates: f.rows.map(row => update(row, 150)) };
  const result = await f.saveAndConfirmVariableCharges(body, f.context);
  assert.equal(result.case.workflow_status, 'ready_for_invoice');
  const composite = f.writes.find(row => row.path === '/composite');
  assert.equal(composite.body.allOrNone, true);
  assert.equal(composite.body.compositeRequest.length, 2);
  assert.ok(composite.body.compositeRequest[0].url.endsWith(f.rows[0].Id));
  assert.ok(composite.body.compositeRequest[1].url.endsWith(f.rows[1].Id));
  assert.equal(f.reservations.length, 1);
});
