import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { variableChargeInternals } from '../api/_variableCharges.js';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function liveCase(overrides = {}) {
  return {
    stem: {
      Id: 'a002x0000000001AAA',
      CreatedDate: '2026-01-02T23:30:00.000Z',
      Delivery_Date__c: '2026-08-01',
      Variable_Charges_Confirmed__c: false,
    },
    accounts: [{ Id: '0012x0000000001AAA', Is_Agent__c: true }],
    nominations: [],
    lineItems: [{ Id: 'a012x0000000001AAA' }],
    allLineItems: [{ Id: 'a012x0000000001AAA' }],
    hasProductLineItems: true,
    extraCosts: [],
    invoices: [],
    hasVariableCharges: true,
    supplierRequirements: [{ supplierId: '0012x0000000001AAA', status: 'Verified', assignmentStatus: 'resolved' }],
    fingerprint: 'current-fingerprint',
    assignment: { status: 'resolved', profileId: '9e7cba8a-83ef-449e-8357-1a786dce6d4f' },
    ...overrides,
  };
}

test('Variable Charges detection uses Is Agent or Is Variable and assignment normalization remains deterministic', () => {
  assert.equal(variableChargeInternals.isVariableChargeAccount({ Is_Agent__c: true }), true);
  assert.equal(variableChargeInternals.isVariableChargeAccount({ Is_Agent__c: false, Is_Variable__c: true }), true);
  assert.equal(variableChargeInternals.isVariableChargeAccount({ Is_Agent__c: false, Imported_Particulars__c: 'Ship Agent' }), false);
  assert.equal(variableChargeInternals.normalizedEmail(' Trader@Example.COM '), 'trader@example.com');
  assert.equal(variableChargeInternals.normalizedName('José  De-Silva'), 'jose de silva');
});

test('Variable Charges queues include only STEM records created from 1 January 2026', async () => {
  assert.equal(variableChargeInternals.VARIABLE_CHARGE_STEM_CREATED_FROM, '2026-01-01T00:00:00Z');
  const service = await repositoryFile('api/_variableCharges.js');
  const liveLoader = service.slice(service.indexOf('async function loadLiveCases'), service.indexOf('function effectiveAssignee'));
  assert.equal((liveLoader.match(/STEM__r\.CreatedDate >= \$\{VARIABLE_CHARGE_STEM_CREATED_FROM\}/g) || []).length, 3);
  assert.match(liveLoader, /FROM STEM__c WHERE Id IN \([^\n]+\) AND CreatedDate >= \$\{VARIABLE_CHARGE_STEM_CREATED_FROM\}/);
});

test('next Hong Kong business day skips weekends and supplied public holidays', () => {
  assert.equal(variableChargeInternals.nextHongKongBusinessDay('2026-08-07', new Set()), '2026-08-10');
  assert.equal(variableChargeInternals.nextHongKongBusinessDay('2026-09-30', new Set(['2026-10-01'])), '2026-10-02');
});

test('status requires delivery to pass and reconfirmation after a live source change', () => {
  const awaiting = liveCase({ stem: { ...liveCase().stem, Delivery_Date__c: '2026-08-08' } });
  assert.equal(variableChargeInternals.deriveStatus(awaiting, null, '2026-08-08'), 'awaiting_delivery');

  const confirmed = liveCase({ stem: { ...liveCase().stem, Variable_Charges_Confirmed__c: true } });
  assert.equal(variableChargeInternals.deriveStatus(confirmed, {
    workflow_status: 'ready_for_invoice',
    confirmation_status: 'confirmed',
    source_fingerprint: 'current-fingerprint',
  }, '2026-08-08'), 'ready_for_invoice');

  const invoicedChanged = liveCase({ invoices: [{ Id: 'a102x0000000001AAA', Name: '00001T-INV-1', Proforma__c: false }] });
  assert.equal(variableChargeInternals.deriveStatus(invoicedChanged, {
    workflow_status: 'completed',
    confirmation_status: 'confirmed',
    source_fingerprint: 'older-fingerprint',
    post_invoice_resolution: 'no_adjustment',
  }, '2026-08-08'), 'post_invoice_changes');
});

test('extra-cost-only readiness uses the latest normalized schedule date and has no delivery dependency', () => {
  const readiness = variableChargeInternals.variableChargeActionability({
    stem: {
      CreatedDate: '2026-07-01T23:30:00.000Z',
      ETA_Start_Date__c: '2026-08-10',
      ETA_End_Date__c: '2026-08-08',
      ETB_Start_Date__c: null,
      ETB_End_Date__c: '2026-08-12',
      ETCD_Start_Date__c: '2026-08-11',
      ETCD_End_Date__c: null,
      ETD_Start_Date__c: 'invalid',
      ETD_End_Date__c: '2026-08-09',
    },
    allLineItems: [],
    hasProductLineItems: false,
  }, '2026-08-13');
  assert.deepEqual(readiness, {
    hasProductLineItems: false,
    deliveryRequired: false,
    actionBasis: 'latest_schedule_date',
    actionBasisDate: '2026-08-12',
    actionableOn: '2026-08-13',
    ready: true,
  });
});

test('extra-cost-only readiness falls back to the Hong Kong Enquiry Created Date', () => {
  assert.deepEqual(variableChargeInternals.variableChargeActionability({
    stem: { CreatedDate: '2026-08-01T16:30:00.000Z' },
    allLineItems: [],
    hasProductLineItems: false,
  }, '2026-08-03'), {
    hasProductLineItems: false,
    deliveryRequired: false,
    actionBasis: 'enquiry_created_date',
    actionBasisDate: '2026-08-02',
    actionableOn: '2026-08-03',
    ready: true,
  });
});

test('any non-cancelled product line keeps the STEM on Delivery Date readiness', () => {
  const readiness = variableChargeInternals.variableChargeActionability({
    stem: { Delivery_Date__c: null, CreatedDate: '2026-01-01T00:00:00.000Z', ETD_End_Date__c: '2026-01-02' },
    allLineItems: [{ Id: 'a012x0000000001AAA' }],
    hasProductLineItems: true,
  }, '2026-08-19');
  assert.equal(readiness.deliveryRequired, true);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.actionBasis, 'delivery_date');
});

test('proformas and credit notes bypass final-invoice classification', () => {
  assert.equal(variableChargeInternals.finalInvoice({ Name: '00001T-P-1', Proforma__c: true }), false);
  assert.equal(variableChargeInternals.finalInvoice({ Name: '00001T-CN-1', Proforma__c: false }), false);
  assert.equal(variableChargeInternals.finalInvoice({ Name: '00001T-INV-1', Proforma__c: false }), true);
});

test('live fingerprint detects financial changes but ignores normal buyer-invoice linkage', () => {
  const base = {
    stem: { Id: 'a002x0000000001AAA', CurrencyIsoCode: 'USD' },
    accounts: [],
    nominations: [],
    lineItems: [{ Id: 'a012x0000000001AAA', Buyer_Invoice__c: null, CurrencyIsoCode: 'USD' }],
    allLineItems: [{ Id: 'a012x0000000001AAA', LastModifiedDate: '2026-08-01T00:00:00.000Z' }],
    extraCosts: [{ Id: 'a022x0000000001AAA', Description__c: 'Agency fee', Buyer_Invoice__c: null, CurrencyIsoCode: 'USD' }],
  };
  const original = variableChargeInternals.liveFingerprint(base);
  assert.equal(variableChargeInternals.liveFingerprint({
    ...base,
    lineItems: [{ ...base.lineItems[0], Buyer_Invoice__c: 'a102x0000000001AAA' }],
    extraCosts: [{ ...base.extraCosts[0], Buyer_Invoice__c: 'a102x0000000001AAA' }],
  }), original);
  assert.notEqual(variableChargeInternals.liveFingerprint({
    ...base,
    extraCosts: [{ ...base.extraCosts[0], Description__c: 'Revised agency fee' }],
  }), original);
  assert.notEqual(variableChargeInternals.liveFingerprint({
    ...base,
    lineItems: [{ ...base.lineItems[0], CurrencyIsoCode: 'HKD' }],
  }), original);
  assert.notEqual(variableChargeInternals.liveFingerprint({
    ...base,
    stem: { ...base.stem, ETD_End_Date__c: '2026-08-20' },
  }), original);
  assert.notEqual(variableChargeInternals.liveFingerprint({
    ...base,
    allLineItems: [...base.allLineItems, { Id: 'a012x0000000002AAA', LastModifiedDate: '2026-08-02T00:00:00.000Z' }],
  }), original);
});

test('paired fingerprints isolate cost-only and buyer-only changes while sharing identity fields', () => {
  const supplierId = '0012x0000000001AAA';
  const base = {
    stem: { Id: 'a002x0000000001AAA', CurrencyIsoCode: 'USD', Delivery_Date__c: '2026-08-01' },
    accounts: [{ Id: supplierId, Is_Agent__c: true }],
    supplierRequirements: [{ supplierId }],
    lineItems: [{
      Id: 'a012x0000000001AAA', Original_Supplier__c: supplierId, Cancelled__c: false,
      Product__c: '01t2x0000000001AAA', Quantity__c: 10, Unit_of_Measure__c: 'MT',
      Unit_Buy_At__c: 500, Total_Cost__c: 5000, Unit_Sell_At__c: 520, Total_Price__c: 5200,
      CurrencyIsoCode: 'USD',
    }],
    allLineItems: [{ Id: 'a012x0000000001AAA' }],
    extraCosts: [],
  };
  const cost = variableChargeInternals.supplierLiveFingerprint(base, supplierId);
  const buyer = variableChargeInternals.buyerChargeLiveFingerprint(base, supplierId);

  const costChanged = { ...base, lineItems: [{ ...base.lineItems[0], Unit_Buy_At__c: 510, Total_Cost__c: 5100 }] };
  assert.notEqual(variableChargeInternals.supplierLiveFingerprint(costChanged, supplierId), cost);
  assert.equal(variableChargeInternals.buyerChargeLiveFingerprint(costChanged, supplierId), buyer);
  assert.equal(variableChargeInternals.buyerAggregateFingerprint(costChanged), variableChargeInternals.buyerAggregateFingerprint(base));

  const buyerChanged = { ...base, lineItems: [{ ...base.lineItems[0], Unit_Sell_At__c: 530, Total_Price__c: 5300 }] };
  assert.equal(variableChargeInternals.supplierLiveFingerprint(buyerChanged, supplierId), cost);
  assert.notEqual(variableChargeInternals.buyerChargeLiveFingerprint(buyerChanged, supplierId), buyer);
  assert.notEqual(variableChargeInternals.buyerAggregateFingerprint(buyerChanged), variableChargeInternals.buyerAggregateFingerprint(base));

  const sharedChanged = { ...base, lineItems: [{ ...base.lineItems[0], Quantity__c: 11 }] };
  assert.notEqual(variableChargeInternals.supplierLiveFingerprint(sharedChanged, supplierId), cost);
  assert.notEqual(variableChargeInternals.buyerChargeLiveFingerprint(sharedChanged, supplierId), buyer);
});

test('plain-language queues identify the current user task without changing internal statuses', () => {
  const supplierTask = variableChargeInternals.plainLanguageWorkflow({
    status: 'needs_action',
    confirmed: false,
    supplierRequirements: [{
      status: 'Pending',
      canVerify: true,
      assignmentStatus: 'resolved',
      supplierName: 'SUPPLIER A',
      assignedSupplierTrader: { name: 'Supplier Trader' },
    }],
    capabilities: {},
  });
  assert.equal(supplierTask.simplifiedQueue, 'my_tasks');
  assert.equal(supplierTask.currentStep, 'supplier_costs');
  assert.equal(supplierTask.nextAction, 'Confirm SUPPLIER A costs');

  const buyerTask = variableChargeInternals.plainLanguageWorkflow({
    status: 'needs_action',
    supplierRequirements: [{ status: 'Verified', canVerify: false }],
    assignedBuyerTrader: { name: 'Buyer Trader' },
    capabilities: { canBuyerConfirm: true },
  });
  assert.equal(buyerTask.simplifiedQueue, 'my_tasks');
  assert.equal(buyerTask.currentStep, 'buyer_charges');
  assert.equal(buyerTask.nextAction, 'Approve buyer charges');

  const urgent = variableChargeInternals.plainLanguageWorkflow({
    status: 'post_invoice_changes',
    supplierRequirements: [],
    assignedBuyerTrader: { name: 'Resolver' },
    capabilities: { canResolvePostInvoice: true },
  });
  assert.equal(urgent.simplifiedQueue, 'my_tasks');
  assert.equal(urgent.currentStep, 'invoice_attention');
  assert.equal(urgent.nextAction, 'Invoice already issued—action required');
});

test('simplified supplier review uses one note while preserving exact row outcomes', () => {
  const lineId = 'a012x0000000001AAA';
  const extraId = 'a022x0000000001AAA';
  const normalized = variableChargeInternals.normalizeSupplierReviewPayload({
    supplierReviewNote: 'Supplier invoice SI-100 checked',
    rowOutcomes: [
      { sourceId: lineId, outcome: 'correct' },
      { sourceId: extraId, outcome: 'changed' },
    ],
    extraCostUpdates: [{ extraCostId: extraId }],
  }, [
    { Id: lineId, Original_Supplier__c: '0012x0000000001AAA' },
    { Id: extraId, Supplier__c: '0012x0000000001AAA' },
  ]);
  assert.equal(normalized.reviews.length, 2);
  assert.ok(normalized.reviews.every((row) => row.reviewed === true));
  assert.ok(normalized.reviews.every((row) => row.referenceOrNote === 'Supplier invoice SI-100 checked'));
  assert.throws(() => variableChargeInternals.normalizeSupplierReviewPayload({
    supplierReviewNote: 'Checked',
    rowOutcomes: [{ sourceId: extraId, outcome: 'changed' }],
  }, [{ Id: extraId, Supplier__c: '0012x0000000001AAA' }]), /Save the corrected cost fields/);
});

test('simplified buyer approval uses one case note and exact include or exclude decisions', () => {
  const lineId = 'a012x0000000001AAA';
  const extraId = 'a022x0000000001AAA';
  const normalized = variableChargeInternals.normalizeBuyerReviewPayload({
    buyerReviewNote: 'Charges checked against confirmation',
    rowChargeDecisions: [
      { sourceId: lineId, decision: 'include' },
      { sourceId: extraId, decision: 'exclude' },
    ],
  }, { lineItems: [{ Id: lineId, Original_Supplier__c: '0012x0000000001AAA' }], extraCosts: [{ Id: extraId, Supplier__c: '0012x0000000001AAA' }] });
  assert.deepEqual(normalized.reviews.map((row) => row.buyerChargeDecision), ['include', 'exclude']);
  assert.ok(normalized.reviews.every((row) => row.referenceOrNote === 'Charges checked against confirmation'));
  assert.throws(() => variableChargeInternals.normalizeBuyerReviewPayload({
    buyerReviewNote: '', rowChargeDecisions: [],
  }, { lineItems: [], extraCosts: [] }), /Add one case note/);
});

test('financial summary is deterministic and fails closed on incomplete totals', () => {
  assert.deepEqual(variableChargeInternals.financialSummary({
    stem: { CurrencyIsoCode: 'USD' },
    accounts: [{ Id: '0012x0000000001AAA', Name: 'SUPPLIER A' }],
    lineItems: [{ Original_Supplier__c: '0012x0000000001AAA', Total_Cost__c: 100, Total_Price__c: 130, CurrencyIsoCode: 'USD' }],
    extraCosts: [{ Supplier__c: '0012x0000000001AAA', Line_Total_Buy__c: 20, Line_Total__c: 25, CurrencyIsoCode: 'USD' }],
  }), {
    supplierCostTotal: 120,
    buyerChargeTotal: 155,
    margin: 35,
    costsComplete: true,
    chargesComplete: true,
    currency: 'USD',
    blockingReason: null,
    rowCount: 2,
    currencyBasis: 'exact_row_currency',
    bySupplier: [{
      supplierId: '0012x0000000001AAA', supplierName: 'SUPPLIER A',
      supplierCostTotal: 120, buyerChargeTotal: 155, margin: 35,
      costsComplete: true, chargesComplete: true, currency: 'USD', blockingReason: null, rowCount: 2,
    }],
  });
  const incomplete = variableChargeInternals.financialSummary({
    accounts: [], lineItems: [{ Total_Cost__c: null, Total_Price__c: 10 }], extraCosts: [],
  });
  assert.equal(incomplete.supplierCostTotal, null);
  assert.equal(incomplete.margin, null);
  assert.equal(incomplete.costsComplete, false);
  const mixed = variableChargeInternals.financialSummary({
    stem: { CurrencyIsoCode: 'USD' }, accounts: [],
    lineItems: [{ Total_Cost__c: 10, Total_Price__c: 12, CurrencyIsoCode: 'USD' }],
    extraCosts: [{ Line_Total_Buy__c: 20, Line_Total__c: 25, CurrencyIsoCode: 'HKD' }],
  });
  assert.equal(mixed.costsComplete, false);
  assert.equal(mixed.chargesComplete, false);
  assert.match(mixed.blockingReason, /different currencies/);
});

test('FCOS handlers are explicit, fail-closed, atomic, and do not send email', async () => {
  const [service, functions, policies, ui, methodology] = await Promise.all([
    repositoryFile('api/_variableCharges.js'),
    repositoryFile('api/functions/[name].js'),
    repositoryFile('api/_handlerPolicyRegistry.js'),
    repositoryFile('src/components/payments/VariableCharges.jsx'),
    repositoryFile('src/lib/pageMethodologies.js'),
  ]);
  for (const handler of [
    'variableChargesList',
    'variableChargesDetail',
    'variableChargesAnchorageSave',
    'variableChargesSettingsGet',
    'variableChargesSettingsSave',
    'variableChargesOptions',
    'variableChargesSupplierVerify',
    'variableChargesBuyerConfirm',
    'variableChargesSideAssign',
    'variableChargesSideConfirm',
    'variableChargesGmOverride',
    'variableChargesPostInvoiceResolve',
    'variableChargesSync',
  ]) {
    assert.match(functions, new RegExp(`\\b${handler}\\b`));
    assert.match(policies, new RegExp(`\\b${handler}:`));
  }
  assert.match(service, /allOrNone: true/);
  assert.match(service, /expectedLastModifiedDate/);
  const liveLoader = service.slice(service.indexOf('async function loadLiveCases'), service.indexOf('function effectiveAssignee'));
  const lineItemQuery = liveLoader.match(/SELECT Id, STEM__c, Original_Supplier__c[^`]+FROM STEM_Line_Item__c/)?.[0] || '';
  assert.ok(lineItemQuery);
  assert.doesNotMatch(lineItemQuery, /CurrencyIsoCode/);
  const extraCostQuery = liveLoader.match(/SELECT Id, STEM__c, STEM_Line_Item__c, Supplier__c[^`]+FROM STEM_Extra_Cost__c/)?.[0] || '';
  assert.ok(extraCostQuery);
  assert.doesNotMatch(extraCostQuery, /CurrencyIsoCode/);
  const stemQuery = liveLoader.match(/SELECT Id, Name, KeyStem__c[^`]+FROM STEM__c/)?.[0] || '';
  assert.ok(stemQuery);
  assert.doesNotMatch(stemQuery, /CurrencyIsoCode/);
  assert.match(liveLoader, /Account__r\.Name/);
  assert.match(liveLoader, /Vessel__r\.Name/);
  assert.match(liveLoader, /Port__r\.Name/);
  assert.match(service, /currency: row\.CurrencyIsoCode \|\| null/);
  assert.match(service, /requireExternalActionGate\('salesforce_write'\)/);
  assert.match(service, /\['buyer_trader', 'supplier_trader', 'gm_override'\]/);
  assert.match(service, /Choose an active trader as the Temporary Assignee/);
  assert.match(service, /Cancelled__c: true/);
  assert.doesNotMatch(service, /method:\s*'DELETE'/);
  assert.doesNotMatch(service, /sendOperationalMail|sendEmail|Graph/);
  assert.match(ui, /Approve Supplier Costs/);
  assert.match(ui, /Approve Buyer Charges/);
  assert.match(ui, /Approve Both/);
  assert.match(ui, /target: 'gm_override'/);
  assert.match(ui, /Temporary Assignee/);
  assert.match(ui, /Audit Details/);
  assert.match(ui, /Supplier Leg/);
  assert.match(ui, /Buyer Leg/);
  assert.match(ui, /Charge Buyer/);
  assert.match(ui, /Do Not Charge/);
  assert.match(ui, /Pending/);
  assert.match(ui, /!fixedPricing && <span>Quantity/);
  assert.match(ui, /fixedPricing \? 'Fixed charge' : 'Per Unit'/);
  assert.match(ui, /valueOf\(row\.item, \['productName'\]\)/);
  assert.doesNotMatch(ui, /row\.sourceType === 'line_item' \? 'Line item' : 'Extra cost'/);
  assert.match(service, /Product2Id__r\.Name/);
  assert.match(service, /productName: productName \|\| null/);
  assert.match(methodology, /'variable-charges'/);
});

test('paired workflow keeps cost and buyer responsibility independent', () => {
  const previous = process.env.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED;
  process.env.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED = 'true';
  try {
    const costOwnerTask = variableChargeInternals.plainLanguageWorkflow({
      pairedWorkflowEnabled: true,
      status: 'ready_for_invoice',
      supplierRequirements: [{
        supplierId: '0012x0000000001AAA', supplierName: 'SUPPLIER A',
        sides: {
          cost: { status: 'pending', permissions: { canConfirm: true }, currentAssignee: { name: 'Supplier Trader' } },
          buyerCharge: { status: 'verified', permissions: { canConfirm: false }, currentAssignee: { name: 'Buyer Trader' } },
        },
      }],
      capabilities: {},
    });
    assert.equal(costOwnerTask.simplifiedQueue, 'my_tasks');
    assert.equal(costOwnerTask.currentStep, 'supplier_costs');
    assert.equal(costOwnerTask.nextAction, 'Confirm SUPPLIER A costs');

    const buyerReadyWithPendingCost = liveCase({
      stem: { ...liveCase().stem, Variable_Charges_Confirmed__c: true },
      supplierRequirements: [{ status: 'Pending', buyerChargeStatus: 'Verified' }],
    });
    assert.equal(variableChargeInternals.deriveStatus(buyerReadyWithPendingCost, {}, '2026-08-08'), 'ready_for_invoice');
  } finally {
    if (previous == null) delete process.env.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED;
    else process.env.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED = previous;
  }
});

test('Variable Charges UI shows complete STEM identity and explicit readiness basis', async () => {
  const [service, ui, methodology] = await Promise.all([
    repositoryFile('api/_variableCharges.js'),
    repositoryFile('src/components/payments/VariableCharges.jsx'),
    repositoryFile('src/lib/pageMethodologies.js'),
  ]);
  assert.match(service, /stemName: live\.stem\.Name \|\| live\.stem\.KeyStem__c/);
  assert.match(service, /stemReference: live\.stem\.KeyStem__c/);
  assert.match(service, /buyerAccountName: live\.stem\.Account__r\?\.Name/);
  assert.match(service, /vesselName: live\.stem\.Vessel__r\?\.Name/);
  assert.match(service, /portName: live\.stem\.Port__r\?\.Name/);
  assert.match(service, /ETA_Start_Date__c, ETA_End_Date__c, ETB_Start_Date__c, ETB_End_Date__c, ETCD_Start_Date__c, ETCD_End_Date__c, ETD_Start_Date__c, ETD_End_Date__c/);
  assert.match(ui, /Latest ETA \/ ETB \/ ETCD \/ ETD/);
  assert.match(ui, /Due \/ available/);
  assert.match(ui, /Review Starts/);
  assert.match(ui, /Review Timing Basis/);
  assert.match(methodology, /extra-cost-only cases have no workflow due date/i);
});

test('extra-cost-only invoice wording uses an optional document date without updating STEM delivery', async () => {
  const [form, formMarkup, processing, processingMarkup, controller] = await Promise.all([
    repositoryFile('force-app/main/default/lwc/fcbInvoiceForm/fcbInvoiceForm.js'),
    repositoryFile('force-app/main/default/lwc/fcbInvoiceForm/fcbInvoiceForm.html'),
    repositoryFile('force-app/main/default/lwc/fcbStemProcessing/fcbStemProcessing.js'),
    repositoryFile('force-app/main/default/lwc/fcbStemProcessing/fcbStemProcessing.html'),
    repositoryFile('force-app/main/default/classes/InvoiceController.cls'),
  ]);
  assert.match(formMarkup, /Service \/ Delivery Date \(optional\)/);
  assert.match(form, /CHARGES IN CONNECTION WITH/);
  assert.match(form, /this\.serviceDeliveryDateValue/);
  assert.doesNotMatch(form, /DELIVERY DATE IS MISSING/);
  assert.doesNotMatch(form, /updateStemDeliveryDate/);
  assert.match(processing, /CANCELLATION CHARGE/);
  assert.match(processing, /Invoice Date \+ 7 calendar days/);
  assert.match(processingMarkup, /cancellationChargeDueDateHint/);
  assert.match(controller, /productLineCount > 0 && deliveryDate == null/);
  assert.match(controller, /invoiceDueDate == null/);
});

test('database confirmation adopts the post-write fingerprint without storing financial rows', async () => {
  const [migration, service] = await Promise.all([
    repositoryFile('supabase/migrations/20260807163729_ship_agent_final_charges.sql'),
    repositoryFile('api/_variableCharges.js'),
  ]);
  assert.match(migration, /source_fingerprint = p_confirmation->>'reviewedSourceFingerprint'/);
  assert.match(migration, /'salesforce_written'/);
  assert.match(migration, /databaseConfirmed/);
  const confirmationFunction = migration.slice(
    migration.indexOf('create or replace function public.confirm_ship_agent_charge_case'),
    migration.indexOf('create or replace function public.override_ship_agent_charge_assignment'),
  );
  assert.doesNotMatch(confirmationFunction, /complete_ship_agent_charge_operation/);
  assert.ok(service.indexOf('await setSalesforceConfirmed(stemId, true)') < service.indexOf("await completeOperation(context.client, operationId, 'succeeded'"));
  assert.match(service, /sourceFingerprint: postWriteFingerprint/);
  assert.match(migration, /revoke all on table public\.ship_agent_charge_cases from public, anon, authenticated/);
  assert.doesNotMatch(migration, /unit_price|lumpsum_price|payment_term|charge_amount/i);
});
