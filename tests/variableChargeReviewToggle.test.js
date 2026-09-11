import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { variableChargeInternals } from '../api/_variableCharges.js';

globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {} },
  location: { hostname: 'localhost' },
};
window.self = window;
window.top = window;
globalThis.document = {};
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(() => vite.close());
const { variableChargeUiInternals: ui } = await vite.ssrLoadModule('/src/components/payments/VariableCharges.jsx');
const extraId = 'a042x0000000001AAA';
const supplierId = '0012x0000000001AAA';
const basic = {
  sourceId: extraId, sourceType: 'extra_cost', readOnly: false,
  item: { productName: 'BASIC CALLING COST', description: 'STEM Charge', fixedCost: 1771, fixedPrice: 2150, hongKongVariableCharges: false },
};

test('an edited cost accepted as Correct remains a changed USD write that the server accepts', () => {
  const draft = { ...ui.initialExtraDraft(basic.item), supplierCost: '1888.25', buyerPrice: '2200' };
  const before = structuredClone(draft);
  const state = ui.supplierCostReviewState(basic, { outcome: 'correct', buyerChargeDecision: 'exclude' }, draft);
  assert.deepEqual(state, { outcome: 'changed', requiresUpdate: true, valid: true });
  assert.deepEqual(draft, before, 'review classification cannot mutate either commercial draft');
  const payload = {
    supplierReviewNote: 'GM checked supplier invoice',
    rowOutcomes: [{ sourceId: extraId, outcome: state.outcome }],
    extraCostUpdates: [{ extraCostId: extraId, supplierCost: Number(draft.supplierCost), inputCurrency: draft.inputCurrency }],
  };
  assert.doesNotThrow(() => variableChargeInternals.normalizeSupplierReviewPayload(payload, [{ Id: extraId, Supplier__c: supplierId }]));
  assert.equal(payload.extraCostUpdates[0].inputCurrency, 'USD');
  assert.equal(payload.extraCostUpdates[0].supplierCost, 1888.25);
  assert.throws(() => variableChargeInternals.normalizeSupplierReviewPayload({ ...payload, rowOutcomes: [{ sourceId: extraId, outcome: 'correct' }] }, [{ Id: extraId, Supplier__c: supplierId }]), { code: 'ROW_OUTCOME_CONFLICT' });
});

test('unchanged costs and buyer-only drafts do not create supplier writes', () => {
  for (const patch of [{}, { supplierCost: '1771.00' }, { buyerPrice: '2300', statutoryBuyerDefaultPending: true }]) {
    assert.deepEqual(ui.supplierCostReviewState(basic, { outcome: 'correct' }, { ...ui.initialExtraDraft(basic.item), ...patch }), { outcome: 'correct', requiresUpdate: false, valid: true });
  }
  assert.equal(ui.supplierCostReviewState(basic, { outcome: 'changed' }).valid, false);
  assert.equal(ui.supplierCostReviewState(basic, { outcome: '' }, { ...ui.initialExtraDraft(basic.item), supplierCost: 1888 }).valid, false);
});

test('Correct cannot hide invalid edited amounts or incomplete per-unit costs', () => {
  for (const supplierCost of ['', 'invalid', -1]) {
    assert.equal(ui.supplierCostReviewState(basic, { outcome: 'correct' }, { ...ui.initialExtraDraft(basic.item), supplierCost }).valid, false);
  }
  for (const patch of [{ quantity: '' }, { quantity: 0 }, { unitOfMeasure: '' }]) {
    assert.equal(ui.supplierCostReviewState(basic, { outcome: 'correct' }, { ...ui.initialExtraDraft(basic.item), pricingType: 'per_unit', supplierCost: 100, quantity: 5, unitOfMeasure: 'MT', ...patch }).valid, false);
  }
  assert.equal(ui.supplierCostReviewState(basic, { outcome: 'correct' }, { ...ui.initialExtraDraft(basic.item), supplierCost: 0 }).valid, true);
});

test('cancellations and read-only fuel rows retain their separate review rules', () => {
  assert.deepEqual(ui.supplierCostReviewState(basic, { outcome: 'cancelled' }, { ...ui.initialExtraDraft(basic.item), cancelled: true }), { outcome: 'cancelled', requiresUpdate: false, valid: true });
  assert.equal(ui.supplierCostReviewState(basic, { outcome: 'correct' }, { ...ui.initialExtraDraft(basic.item), cancelled: true }).valid, false);
  const fuel = { ...basic, sourceType: 'line_item', readOnly: true };
  assert.deepEqual(ui.supplierCostReviewState(fuel, { outcome: 'correct' }), { outcome: 'correct', requiresUpdate: false, valid: true });
  assert.equal(ui.supplierCostReviewState(fuel, { outcome: 'changed' }).valid, false);
});

test('Hong Kong defaults and amended Port Clearance counts carry changed outcomes', () => {
  const statutory = { ...basic, item: { ...basic.item, productName: 'LIGHT DUES', hongKongVariableCharges: true } };
  const statutoryDraft = { ...ui.initialExtraDraft(statutory.item), supplierCost: 500, inputCurrency: 'HKD', statutorySupplierDefaultPending: true };
  assert.deepEqual(ui.supplierCostReviewState(statutory, { outcome: 'correct' }, statutoryDraft), { outcome: 'changed', requiresUpdate: true, valid: true });
  const port = { ...basic, item: { ...basic.item, productName: 'PORT CLEARANCE FEE', hongKongVariableCharges: true, quantity: 1 } };
  const draft = { ...ui.initialExtraDraft(port.item), statutorySupplierDefaultPending: false };
  assert.equal(ui.supplierCostReviewState(port, { outcome: 'correct' }, draft).requiresUpdate, false);
  assert.equal(ui.supplierCostReviewState(port, { outcome: 'changed' }, draft).requiresUpdate, true);
  assert.deepEqual(ui.supplierCostReviewState(port, { outcome: 'correct' }, { ...draft, quantity: 2 }), { outcome: 'changed', requiresUpdate: true, valid: true });
  assert.equal(ui.supplierCostReviewState(port, { outcome: 'correct' }, { ...draft, quantity: 1.5 }).valid, false);
});

test('accepting an automatic statutory default does not require adding a legacy description', () => {
  const row = { ...basic, item: { ...basic.item, productName: 'LIGHT DUES', description: '', hongKongVariableCharges: true } };
  const draft = { ...ui.initialExtraDraft(row.item), statutorySupplierDefaultPending: true };
  assert.deepEqual(ui.supplierCostReviewState(row, { outcome: 'correct' }, draft), { outcome: 'changed', requiresUpdate: true, valid: true });
});
