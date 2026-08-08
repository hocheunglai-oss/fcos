import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { shipAgentChargeInternals } from '../api/_shipAgentCharges.js';

const repositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function liveCase(overrides = {}) {
  return {
    stem: {
      Id: 'a002x0000000001AAA',
      Delivery_Date__c: '2026-08-01',
      Ship_Agent_Charges_Confirmed__c: false,
    },
    accounts: [{ Id: '0012x0000000001AAA', Imported_Particulars__c: 'SHIP AGENT' }],
    nominations: [],
    lineItems: [{ Id: 'a012x0000000001AAA' }],
    extraCosts: [],
    invoices: [],
    hasShipAgent: true,
    fingerprint: 'current-fingerprint',
    assignment: { status: 'resolved', profileId: '9e7cba8a-83ef-449e-8357-1a786dce6d4f' },
    ...overrides,
  };
}

test('Ship-Agent detection and assignment normalization are case-insensitive and deterministic', () => {
  assert.equal(shipAgentChargeInternals.isShipAgentAccount({ Imported_Particulars__c: 'Port / sHiP AgEnT / Owner' }), true);
  assert.equal(shipAgentChargeInternals.isShipAgentAccount({ Imported_Particulars__c: 'Port agent only' }), false);
  assert.equal(shipAgentChargeInternals.normalizedEmail(' Trader@Example.COM '), 'trader@example.com');
  assert.equal(shipAgentChargeInternals.normalizedName('José  De-Silva'), 'jose de silva');
});

test('next Hong Kong business day skips weekends and supplied public holidays', () => {
  assert.equal(shipAgentChargeInternals.nextHongKongBusinessDay('2026-08-07', new Set()), '2026-08-10');
  assert.equal(shipAgentChargeInternals.nextHongKongBusinessDay('2026-09-30', new Set(['2026-10-01'])), '2026-10-02');
});

test('status requires delivery to pass and reconfirmation after a live source change', () => {
  const awaiting = liveCase({ stem: { ...liveCase().stem, Delivery_Date__c: '2026-08-08' } });
  assert.equal(shipAgentChargeInternals.deriveStatus(awaiting, null, '2026-08-08'), 'awaiting_delivery');

  const confirmed = liveCase({ stem: { ...liveCase().stem, Ship_Agent_Charges_Confirmed__c: true } });
  assert.equal(shipAgentChargeInternals.deriveStatus(confirmed, {
    workflow_status: 'ready_for_invoice',
    confirmation_status: 'confirmed',
    source_fingerprint: 'current-fingerprint',
  }, '2026-08-08'), 'ready_for_invoice');

  const invoicedChanged = liveCase({ invoices: [{ Id: 'a102x0000000001AAA', Name: '00001T-INV-1', Proforma__c: false }] });
  assert.equal(shipAgentChargeInternals.deriveStatus(invoicedChanged, {
    workflow_status: 'completed',
    confirmation_status: 'confirmed',
    source_fingerprint: 'older-fingerprint',
    post_invoice_resolution: 'no_adjustment',
  }, '2026-08-08'), 'post_invoice_changes');
});

test('proformas and credit notes bypass final-invoice classification', () => {
  assert.equal(shipAgentChargeInternals.finalInvoice({ Name: '00001T-P-1', Proforma__c: true }), false);
  assert.equal(shipAgentChargeInternals.finalInvoice({ Name: '00001T-CN-1', Proforma__c: false }), false);
  assert.equal(shipAgentChargeInternals.finalInvoice({ Name: '00001T-INV-1', Proforma__c: false }), true);
});

test('live fingerprint detects financial changes but ignores normal buyer-invoice linkage', () => {
  const base = {
    stem: { Id: 'a002x0000000001AAA', CurrencyIsoCode: 'USD' },
    accounts: [],
    nominations: [],
    lineItems: [{ Id: 'a012x0000000001AAA', Buyer_Invoice__c: null, CurrencyIsoCode: 'USD' }],
    extraCosts: [{ Id: 'a022x0000000001AAA', Description__c: 'Agency fee', Buyer_Invoice__c: null, CurrencyIsoCode: 'USD' }],
  };
  const original = shipAgentChargeInternals.liveFingerprint(base);
  assert.equal(shipAgentChargeInternals.liveFingerprint({
    ...base,
    lineItems: [{ ...base.lineItems[0], Buyer_Invoice__c: 'a102x0000000001AAA' }],
    extraCosts: [{ ...base.extraCosts[0], Buyer_Invoice__c: 'a102x0000000001AAA' }],
  }), original);
  assert.notEqual(shipAgentChargeInternals.liveFingerprint({
    ...base,
    extraCosts: [{ ...base.extraCosts[0], Description__c: 'Revised agency fee' }],
  }), original);
  assert.notEqual(shipAgentChargeInternals.liveFingerprint({
    ...base,
    lineItems: [{ ...base.lineItems[0], CurrencyIsoCode: 'HKD' }],
  }), original);
});

test('FCOS handlers are explicit, fail-closed, atomic, and do not send email', async () => {
  const [service, functions, policies, ui, methodology] = await Promise.all([
    repositoryFile('api/_shipAgentCharges.js'),
    repositoryFile('api/functions/[name].js'),
    repositoryFile('api/_handlerPolicyRegistry.js'),
    repositoryFile('src/components/payments/ShipAgentCharges.jsx'),
    repositoryFile('src/lib/pageMethodologies.js'),
  ]);
  for (const handler of [
    'shipAgentChargesList',
    'shipAgentChargesDetail',
    'shipAgentChargesOptions',
    'shipAgentChargesSaveConfirm',
    'shipAgentChargesGmOverride',
    'shipAgentChargesPostInvoiceResolve',
    'shipAgentChargesSync',
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
  assert.match(ui, /Row-by-row buyer charge review/);
  assert.match(methodology, /'ship-agent-charges'/);
});

test('database confirmation adopts the post-write fingerprint without storing financial rows', async () => {
  const [migration, service] = await Promise.all([
    repositoryFile('supabase/migrations/20260807163729_ship_agent_final_charges.sql'),
    repositoryFile('api/_shipAgentCharges.js'),
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
