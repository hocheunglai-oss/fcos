import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  calculateMasterContractDonPrice,
  masterContractDonWindow,
  masterContractInvoicePriceReady,
  masterContractLineKey,
  masterContractLiveVariances,
  masterContractPreflight,
  masterContractQuantitySummary,
} from '../src/lib/masterContracts.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function approvedFixture() {
  const snapshot = {
    ownerUserId: '00000000-0000-4000-8000-000000000001',
    parties: {
      buyer: { accountId: '001000000000001AAA' },
      supplier: { accountId: '001000000000002AAA', confirmed: true },
    },
    terms: {
      don: { minDays: 3, maxDays: 7 },
      variableCharges: { mode: 'contract', supplierIds: [] },
    },
    products: [
      { productKey: 'hsfo', productName: 'HSFO 3.5%', salesforceProductId: '01t000000000001AAA', contractedMinQty: 3720, contractedMaxQty: 3920 },
      { productKey: 'mgo', productName: 'MGO 10 ppm', salesforceProductId: '01t000000000002AAA', contractedMinQty: 940, contractedMaxQty: 1040 },
    ],
    chargeRules: [{ chargeKey: 'sgs', chargeName: 'SGS', salesforceProductId: '01t000000000003AAA', supplierAccountId: '001000000000003AAA', appliesWhen: 'every_delivery', fixedCost: 900, fixedSell: 900 }],
    deliveries: [
      { deliveryKey: 'MC-2026-D01', vesselName: 'A', vesselId: 'a0V000000000001AAA', portId: 'a0P000000000001AAA', buyerPaymentTerm: '30 days', supplierPaymentTerm: '30 days', variableChargeSupplierIds: [], products: [{ productKey: 'hsfo', quantityMin: 700, quantityMax: 700 }] },
      { deliveryKey: 'MC-2026-D02', vesselName: 'B', vesselId: 'a0V000000000002AAA', portId: 'a0P000000000002AAA', buyerPaymentTerm: '30 days', supplierPaymentTerm: '30 days', variableChargeSupplierIds: [], products: [{ productKey: 'hsfo', quantityMin: 900, quantityMax: 900 }] },
      { deliveryKey: 'MC-2026-D03', vesselName: 'C', vesselId: 'a0V000000000003AAA', portId: 'a0P000000000003AAA', buyerPaymentTerm: '30 days', supplierPaymentTerm: '30 days', variableChargeSupplierIds: [], products: [{ productKey: 'hsfo', quantityMin: 350, quantityMax: 350 }, { productKey: 'mgo', quantityMin: 100, quantityMax: 100 }] },
      { deliveryKey: 'MC-2026-D04', vesselName: 'D', vesselId: 'a0V000000000004AAA', portId: 'a0P000000000004AAA', buyerPaymentTerm: '30 days', supplierPaymentTerm: '30 days', variableChargeSupplierIds: [], products: [{ productKey: 'mgo', quantityMin: 400, quantityMax: 400 }] },
      { deliveryKey: 'MC-2026-D05', vesselName: 'E', vesselId: 'a0V000000000005AAA', portId: 'a0P000000000005AAA', buyerPaymentTerm: '30 days', supplierPaymentTerm: '30 days', variableChargeSupplierIds: [], products: [{ productKey: 'hsfo', quantityMin: 600, quantityMax: 800 }, { productKey: 'mgo', quantityMin: 150, quantityMax: 250 }] },
      { deliveryKey: 'MC-2026-D06', vesselName: 'F', vesselId: 'a0V000000000006AAA', portId: 'a0P000000000006AAA', buyerPaymentTerm: '30 days', supplierPaymentTerm: '30 days', variableChargeSupplierIds: [], products: [{ productKey: 'hsfo', quantityMin: 650, quantityMax: 650 }, { productKey: 'mgo', quantityMin: 190, quantityMax: 190 }] },
      { deliveryKey: 'MC-2026-D07', vesselName: 'G', vesselId: 'a0V000000000007AAA', portId: 'a0P000000000007AAA', buyerPaymentTerm: '30 days', supplierPaymentTerm: '30 days', variableChargeSupplierIds: [], products: [{ productKey: 'hsfo', quantityMin: 520, quantityMax: 520 }, { productKey: 'mgo', quantityMin: 100, quantityMax: 100 }] },
    ],
  };
  snapshot.deliveries.forEach((delivery, index) => {
    delivery.preliminaryEta = `2026-${index < 2 ? '10' : index < 4 ? '11' : '12'}-${String(index + 11).padStart(2, '0')}`;
    delivery.supplyLocation = 'TBD';
    delivery.products.forEach((product) => { product.contractLineKey = `${delivery.deliveryKey}-${product.productKey.toUpperCase()}`; });
  });
  return snapshot;
}

test('master contract quantity reconciliation preserves fixed and range allocations', () => {
  const summary = masterContractQuantitySummary(approvedFixture(), {
    hsfo: { deliveredQty: 900 },
    mgo: { deliveredQty: 100 },
  });
  assert.deepEqual(summary.hsfo, {
    contractedMin: 3720,
    contractedMax: 3920,
    allocatedMin: 3720,
    allocatedMax: 3920,
    delivered: 900,
    unallocatedMin: 0,
    unallocatedMax: 200,
    remainingMin: 2820,
    remainingMax: 3020,
    overAllocated: 0,
    overDelivered: 0,
  });
  assert.equal(summary.mgo.allocatedMin, 940);
  assert.equal(summary.mgo.allocatedMax, 1040);
  assert.equal(summary.mgo.remainingMin, 840);
  assert.equal(summary.mgo.remainingMax, 940);

  const reduced = approvedFixture();
  reduced.deliveries[0].products[0].quantityMin = 500;
  reduced.deliveries[0].products[0].quantityMax = 500;
  assert.equal(masterContractQuantitySummary(reduced).hsfo.unallocatedMin, 0);
  assert.equal(masterContractQuantitySummary(reduced).hsfo.unallocatedMax, 400);
  assert.equal(masterContractQuantitySummary(approvedFixture(), { hsfo: { deliveredQty: 4000 } }).hsfo.overDelivered, 80);
});

test('contract line keys are uppercase, qualified once, and database-safe', () => {
  assert.equal(
    masterContractLineKey('FCUS-SINOPEC-CN-2026-Q4', 'D01', 'hsfo_35'),
    'FCUS-SINOPEC-CN-2026-Q4-D01-HSFO_35',
  );
  assert.equal(
    masterContractLineKey(
      'FCUS-SINOPEC-CN-2026-Q4',
      'FCUS-SINOPEC-CN-2026-Q4-D02',
      'mgo_10ppm',
    ),
    'FCUS-SINOPEC-CN-2026-Q4-D02-MGO_10PPM',
  );
  assert.match(
    masterContractLineKey('contract 1', 'delivery 1', 'product 1'),
    /^[A-Z0-9][A-Z0-9_-]{5,159}$/,
  );
});

test('DON window and benchmark formula use nomination date evidence and final-only rounding', () => {
  assert.deepEqual(masterContractDonWindow('2026-10-11', 3, 7), { earliest: '2026-10-04', latest: '2026-10-08' });
  assert.equal(masterContractDonWindow('invalid', 3, 7), null);

  assert.deepEqual(calculateMasterContractDonPrice({
    productKey: 'hsfo', benchmarkValue: 615.41, buyPremium: 55, sellPremium: 55,
  }), {
    benchmarkValue: 615.41,
    conversionFactor: 1,
    convertedBenchmark: 615.41,
    buyUnrounded: 670.41,
    sellUnrounded: 670.41,
    buyRounded: 670.41,
    sellRounded: 670.41,
  });
  const mgo = calculateMasterContractDonPrice({
    productKey: 'mgo', benchmarkValue: 89.41, buyPremium: 30, sellPremium: 30.5,
  });
  assert.equal(mgo.conversionFactor, 7.45);
  assert.equal(mgo.buyUnrounded, 696.1045);
  assert.equal(mgo.sellUnrounded, 696.6045);
  assert.equal(mgo.buyRounded, 696.1);
  assert.equal(mgo.sellRounded, 696.6);
});

test('preflight fails closed and invoice readiness blocks every unapplied contract line', () => {
  assert.deepEqual(masterContractPreflight(approvedFixture()), { ready: true, blockers: [] });
  const incomplete = approvedFixture();
  incomplete.parties.supplier.confirmed = false;
  incomplete.deliveries[0].portId = '';
  incomplete.terms.variableCharges.mode = '';
  const blocked = masterContractPreflight(incomplete, { featureEnabled: false });
  assert.equal(blocked.ready, false);
  for (const code of ['FEATURE_DISABLED', 'SUPPLIER_CONFIRMATION_REQUIRED', 'VARIABLE_CHARGES_MODE_REQUIRED', 'PORT_REQUIRED']) {
    assert.ok(blocked.blockers.some((row) => row.code === code), code);
  }
  assert.deepEqual(masterContractInvoicePriceReady([
    { contractLineKey: 'A', priceStatus: 'applied' },
    { contractLineKey: 'B', priceStatus: 'reviewed' },
    { contractLineKey: '', priceStatus: 'unresolved' },
  ]), { ready: false, blockedCount: 1, blockedKeys: ['B'] });
});

test('live reconciliation detects exact approved-versus-Salesforce changes without netting them', () => {
  const snapshot = approvedFixture();
  snapshot.deliveries = snapshot.deliveries.slice(0, 1);
  const delivery = snapshot.deliveries[0];
  const line = delivery.products[0];
  const live = {
    deliveries: [{
      deliveryKey: delivery.deliveryKey,
      accountId: snapshot.parties.buyer.accountId,
      vesselId: delivery.vesselId,
      portId: delivery.portId,
      expectedDeliveryDate: delivery.preliminaryEta,
      buyerPaymentTerm: delivery.buyerPaymentTerm,
      financialRecordCount: 2,
      products: [{
        Master_Contract_Line_Key__c: line.contractLineKey,
        Product__c: snapshot.products[0].salesforceProductId,
        Original_Supplier__c: snapshot.parties.supplier.accountId,
        Quantity__c: 650,
        Quantity_Max__c: 700,
        Payment_Term__c: delivery.supplierPaymentTerm,
      }],
      charges: [],
    }],
  };
  const variances = masterContractLiveVariances(snapshot, live);
  assert.ok(variances.some((row) => row.fieldPath.endsWith('.quantityMin') && row.approvedValue === 700 && row.liveValue === 650));
  assert.ok(variances.some((row) => row.fieldPath.includes('charges.') && row.fieldPath.endsWith('.present')));
  assert.ok(variances.every((row) => row.consequentialFinancialRecord === true));
});

test('migration is private, revisioned, idempotent, and feature-disabled by default', async () => {
  const sql = await read('supabase/migrations/20260824134500_master_term_contracts.sql');
  const tables = [
    'master_contract_settings', 'master_contracts', 'master_contract_product_terms',
    'master_contract_deliveries', 'master_contract_delivery_products', 'master_contract_charge_rules',
    'master_contract_revisions', 'master_contract_supplier_evidence', 'master_contract_price_resolutions',
    'master_contract_salesforce_links', 'master_contract_variances', 'master_contract_sync_jobs',
    'master_contract_operations',
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant all on table public\\.${table} to service_role`, 'i'));
  }
  assert.match(sql, /feature_enabled boolean not null default false/i);
  assert.match(sql, /public\.master_contract_immutable_guard/i);
  assert.match(sql, /security invoker/gi);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /on conflict \(idempotency_key\)/i);
  assert.match(sql, /master-contract-evidence[\s\S]*false[\s\S]*20971520/i);
  assert.match(sql, /grant execute on function public\.save_master_contract_price_resolution\(uuid, bigint, uuid, date, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, uuid, text, text, uuid, text, text, text\) to service_role/i);
  assert.match(sql, /grant execute on function public\.reconcile_master_contract_live_state\(uuid, jsonb, jsonb, uuid, text\) to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.save_master_contract_price_resolution\([^)]*text, text, text, uuid/i);
});

test('API and Salesforce package preserve exact-ID, all-or-none, and invoice-gate boundaries', async () => {
  const [api, apex, rest, readiness, page, handlers, policy, manifest] = await Promise.all([
    read('api/_masterContracts.js'),
    read('force-app/main/default/classes/MasterContractGenerationService.cls'),
    read('force-app/main/default/classes/MasterContractGenerationRest.cls'),
    read('force-app/main/default/classes/MasterContractInvoiceReadinessService.cls'),
    read('src/pages/MasterContracts.jsx'),
    read('api/functions/[name].js'),
    read('api/_handlerPolicyRegistry.js'),
    read('manifest/master-contracts-full.xml'),
  ]);
  assert.match(api, /MASTER_CONTRACT_PREFLIGHT_BLOCKED/);
  assert.match(api, /enqueue_master_contract_sync/);
  assert.match(api, /finalize_master_contract_salesforce_batch/);
  assert.match(api, /No complete official MOPS publication exists/);
  assert.match(apex, /Savepoint checkpoint = Database\.setSavepoint\(\)/);
  assert.match(apex, /Database\.rollback\(checkpoint\)/);
  assert.match(apex, /StageName = 'Closed Won'/);
  assert.match(apex, /get\('Originated'\)/);
  assert.match(apex, /Master_Contract_Delivery_Key__c/);
  assert.match(apex, /Unit_Buy_At__c = 0/);
  assert.match(rest, /\/create/);
  assert.match(rest, /\/prices/);
  assert.match(readiness, /DON_Price_Status__c != 'Applied'/);
  assert.match(readiness, /assertSupplierInvoiceTransitionsAllowed/);
  assert.match(page, /Feature safely disabled/);
  assert.match(page, /Create selected in Salesforce/);
  assert.match(page, /Save the draft first, then create or link the exact Salesforce vessel after duplicate checking/);
  assert.match(page, /Object\.prototype\.hasOwnProperty\.call\(patch, "deliveryKey"\)/);
  assert.match(page, /masterContractLineKey/);
  assert.match(page, /type === "date"[\s\S]*onChange\(event\.currentTarget\.value\)/);
  assert.match(handlers, /masterContractReconcileCron/);
  assert.match(policy, /masterContractBatchCreate: mutationPolicy/);
  assert.match(manifest, /MasterContractGenerationService/);

  const joined = [api, apex, page].join('\n');
  for (const commercialSeed of ['Royal Princess', 'Costa Serena', 'Seabourn Encore', 'Westerdam', 'Diamond Princess', 'Sapphire Princess', 'Fabio']) {
    assert.doesNotMatch(joined, new RegExp(commercialSeed, 'i'));
  }
});
