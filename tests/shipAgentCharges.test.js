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

test('Variable Charges detection uses Is Agent and assignment normalization remains deterministic', () => {
  assert.equal(variableChargeInternals.isVariableChargeAccount({ Is_Agent__c: true }), true);
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
    'variableChargesOptions',
    'variableChargesSupplierVerify',
    'variableChargesBuyerConfirm',
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
  assert.doesNotMatch(liveLoader, /CurrencyIsoCode/);
  assert.match(service, /requireExternalActionGate\('salesforce_write'\)/);
  assert.match(service, /Cancelled__c: true/);
  assert.doesNotMatch(service, /method:\s*'DELETE'/);
  assert.doesNotMatch(service, /sendOperationalMail|sendEmail|Graph/);
  assert.match(ui, /Row-by-row charge review/);
  assert.match(methodology, /'variable-charges'/);
});

test('Variable Charges UI shows complete STEM identity and explicit readiness basis', async () => {
  const [service, ui, methodology] = await Promise.all([
    repositoryFile('api/_variableCharges.js'),
    repositoryFile('src/components/payments/VariableCharges.jsx'),
    repositoryFile('src/lib/pageMethodologies.js'),
  ]);
  assert.match(service, /stemName: live\.stem\.Name \|\| live\.stem\.KeyStem__c/);
  assert.match(service, /stemReference: live\.stem\.KeyStem__c/);
  assert.match(service, /ETA_Start_Date__c, ETA_End_Date__c, ETB_Start_Date__c, ETB_End_Date__c, ETCD_Start_Date__c, ETCD_End_Date__c, ETD_Start_Date__c, ETD_End_Date__c/);
  assert.match(ui, /Latest ETA \/ ETB \/ ETCD \/ ETD/);
  assert.match(ui, /No Variable Charges due date/);
  assert.match(methodology, /Extra-cost-only cases have no Variable Charges due date/);
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
