import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../api/_variableCharges.js', import.meta.url), 'utf8');
const writerStart = source.indexOf('async function salesforceSupplierChargeWrites(');
const writerEnd = source.indexOf('\nasync function setSalesforceConfirmed(', writerStart);

if (writerStart < 0 || writerEnd < 0) {
  throw new Error('Unable to locate salesforceSupplierChargeWrites in api/_variableCharges.js');
}

const writerSource = source.slice(writerStart, writerEnd);
const supplierId = '0012x0000000001AAA';
const extraId = 'a042x0000000001AAA';
const lastModifiedDate = '2026-09-11T01:00:00.000Z';

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function numeric(value, label, { positive = false, nullable = true } = {}) {
  if (value === '' || value == null) {
    if (nullable) return null;
    throw new Error(`${label} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (positive && parsed <= 0)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function liveRow({ mode, buyerPrice = 2150 }) {
  return {
    Id: extraId,
    Supplier__c: supplierId,
    LastModifiedDate: lastModifiedDate,
    Description__c: null,
    Lumpsum_Cost__c: mode === 'fixed' ? 1771 : null,
    Lumpsum_Price__c: mode === 'fixed' ? buyerPrice : null,
    Unit_Cost__c: mode === 'per_unit' ? 177.1 : null,
    Unit_Price__c: mode === 'per_unit' ? buyerPrice : null,
    Unit_of_Measure__c: mode === 'per_unit' ? 'MT' : '1.',
  };
}

function update({ mode, buyerPrice, supplierCost }) {
  const payload = {
    extraCostId: extraId,
    expectedLastModifiedDate: lastModifiedDate,
    description: '',
    pricingType: mode,
    supplierCost,
    inputCurrency: 'USD',
  };
  if (mode === 'per_unit') Object.assign(payload, { quantity: 5, unitOfMeasure: 'MT' });
  if (buyerPrice !== undefined) payload.buyerPrice = buyerPrice;
  return payload;
}

async function write({ mode, includeBuyerFields, buyerPrice, supplierCost }) {
  const requests = [];
  const context = vm.createContext({
    Object,
    Array,
    Map,
    Set,
    Number,
    String,
    Boolean,
    Promise,
    text,
    numeric,
    httpError: (message) => new Error(message),
    activeProducts: async () => [],
    queryAll: async () => [{ Id: '0122x0000000001AAA' }],
    isHongKongStem: () => false,
    requiredAgentCurrency: () => null,
    basicCallingSupplierIds: () => new Set(),
    getApiVersion: () => 'vTEST',
    findExtra: (live, id, expectedLastModifiedDate) => {
      const row = live.extraCosts.find((candidate) => candidate.Id === id);
      if (!row || row.LastModifiedDate !== expectedLastModifiedDate) throw new Error('extra conflict');
      return row;
    },
    isBasicCallingBundleSupportRow: () => false,
    isAgencyFeeRow: () => false,
    isPortClearanceRow: () => false,
    isManagedBasicCallingRow: () => false,
    supplierInputForPort: (input) => ({
      usdAmount: numeric(input.supplierCost, 'Supplier cost'),
      fields: {
        Supplier_Cost_Input_Currency__c: 'USD',
        Supplier_Cost_Input_Value__c: numeric(input.supplierCost, 'Supplier cost'),
        Supplier_Cost_USD_HKD_Rate__c: null,
        Supplier_Cost_FX_Settings_Revision__c: null,
      },
    }),
    lastModifiedHeaders: () => ({ 'If-Unmodified-Since': 'Fri, 11 Sep 2026 01:00:00 GMT' }),
    requireExternalActionGate: () => {},
    sfRequest: async (path, request) => {
      assert.equal(path, '/composite');
      requests.push(JSON.parse(JSON.stringify(request.body.compositeRequest)));
      return { compositeResponse: request.body.compositeRequest.map(() => ({ httpStatusCode: 204, body: {} })) };
    },
  });
  new vm.Script(`${writerSource}\nglobalThis.writer = salesforceSupplierChargeWrites;`).runInContext(context);
  const live = {
    stem: { Id: 'a0H2x0000000001AAA' },
    accounts: [],
    lineItems: [],
    extraCosts: [liveRow({ mode })],
  };
  await context.writer({ extraCostUpdates: [update({ mode, buyerPrice, supplierCost })] }, live, supplierId, {}, { includeBuyerFields });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].length, 1);
  return requests[0][0].body;
}

for (const mode of ['fixed', 'per_unit']) {
  const supplierField = mode === 'fixed' ? 'Lumpsum_Cost__c' : 'Unit_Cost__c';
  const buyerField = mode === 'fixed' ? 'Lumpsum_Price__c' : 'Unit_Price__c';

  test(`paired ${mode} supplier edit preserves an unchanged buyer price when no buyer update is supplied`, async () => {
    const patch = await write({ mode, includeBuyerFields: true, supplierCost: mode === 'fixed' ? 1809.25 : 180.925 });
    assert.equal(patch[supplierField], mode === 'fixed' ? 1809.25 : 180.925);
    assert.equal(Object.hasOwn(patch, buyerField), false, 'an omitted buyer update must not clear the Salesforce buyer price');
  });

  test(`paired ${mode} supplier edit applies explicit buyer price changes, including zero`, async () => {
    const changed = await write({ mode, includeBuyerFields: true, buyerPrice: mode === 'fixed' ? 2300 : 230, supplierCost: mode === 'fixed' ? 1809.25 : 180.925 });
    assert.equal(changed[buyerField], mode === 'fixed' ? 2300 : 230);

    const zero = await write({ mode, includeBuyerFields: true, buyerPrice: 0, supplierCost: mode === 'fixed' ? 1809.25 : 180.925 });
    assert.equal(zero[buyerField], 0);
  });

  test(`cost-only ${mode} supplier edit does not write a buyer financial field`, async () => {
    const patch = await write({ mode, includeBuyerFields: false, supplierCost: mode === 'fixed' ? 1809.25 : 180.925 });
    assert.equal(Object.hasOwn(patch, buyerField), false);
  });
}
