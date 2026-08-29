import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertXeroFinancialDailyReserve,
  buildXeroAccountingPayload,
  buildFinancialClassifications,
  classifyXeroFinancialDocument,
  isProtectedXeroDocument,
  xeroFinancialRateSnapshot,
} from '../api/_xeroFinancialSync.js';

const source = {
  salesforceObject: 'Invoice__c',
  salesforceId: 'a1I000000000001AAA',
  documentNumber: '24509T-INV-1',
  documentKind: 'buyer_invoice',
  xeroType: 'ACCREC',
  xeroCollection: 'Invoices',
  contactId: 'contact-1',
  currency: 'USD',
  total: 1000,
  invoiceDate: '2026-06-15',
  dueDate: '2026-07-15',
  deliveryDate: '2026-06-14',
  reference: 'HK2627001T · Salesforce buyer invoice',
  stemName: 'HK2627001T',
  blockers: [],
  lines: [{ description: 'HSFO 380', quantity: 10, unitAmount: 100, accountCode: '200', taxType: 'NONE' }],
};

function xero(overrides = {}) {
  return {
    id: 'xero-invoice-1',
    collection: 'Invoices',
    type: 'ACCREC',
    status: 'DRAFT',
    invoiceNumber: '79221S',
    reference: 'HK2627001T',
    contactId: 'contact-1',
    currency: 'USD',
    date: '2026-06-14',
    dueDate: '2026-07-14',
    total: 1000,
    amountDue: 1000,
    amountPaid: 0,
    amountCredited: 0,
    lineItems: [{ Description: 'Legacy line', Quantity: 1, UnitAmount: 1000, AccountCode: '200', TaxType: 'NONE' }],
    ...overrides,
  };
}
test('financial classification creates drafts only when no active exact or supporting match exists', () => {
  const result = classifyXeroFinancialDocument(source, [], {
    deletedCandidates: [xero({ status: 'DELETED', invoiceNumber: source.documentNumber })],
  });
  assert.equal(result.action, 'create_draft');
  assert.equal(result.status, 'eligible');
  assert.match(result.warnings[0], /deleted or voided/i);
});

test('financial classification treats exact legacy evidence as a safe update while drafts remain editable', () => {
  const result = classifyXeroFinancialDocument(source, [xero()], {
    organisation: { periodLockDate: '2025-12-31', endOfYearLockDate: '2025-12-31' },
  });
  assert.equal(result.action, 'safe_update');
  assert.equal(result.status, 'eligible');
  assert.equal(result.xero.id, 'xero-invoice-1');
  assert.ok(result.differences.some((difference) => difference.field === 'documentNumber'));
});

test('paid, allocated, and locked authorised Xero history is always protected', () => {
  assert.equal(isProtectedXeroDocument(xero({ status: 'PAID', amountDue: 0, amountPaid: 1000 })), true);
  assert.equal(isProtectedXeroDocument(xero({ status: 'AUTHORISED', amountDue: 900, amountPaid: 100 })), true);
  assert.equal(isProtectedXeroDocument(xero({ status: 'AUTHORISED', date: '2026-01-15' }), { periodLockDate: '2026-01-31' }), true);
  assert.equal(isProtectedXeroDocument(xero({ status: 'AUTHORISED', date: '2026-06-15' }), { periodLockDate: '2026-01-31' }), false);

  const classified = classifyXeroFinancialDocument(source, [xero({ status: 'PAID', amountDue: 0, amountPaid: 1000 })]);
  assert.equal(classified.action, 'protected_legacy');
  assert.equal(classified.status, 'protected');
});

test('identity conflicts block an otherwise matching transaction', () => {
  const result = classifyXeroFinancialDocument(source, [xero({ invoiceNumber: source.documentNumber, contactId: 'wrong-contact' })]);
  assert.equal(result.action, 'blocked');
  assert.match(result.blockers.join(' '), /Contact conflicts/i);
});

test('Xero payload preserves authorised state for safe updates and uses Salesforce detailed lines', () => {
  const payload = buildXeroAccountingPayload(source, 'xero-invoice-1', 'AUTHORISED');
  assert.equal(payload.InvoiceID, 'xero-invoice-1');
  assert.equal(payload.InvoiceNumber, '24509T-INV-1');
  assert.equal(payload.Status, 'AUTHORISED');
  assert.equal(payload.LineItems[0].Quantity, 10);
  assert.equal(payload.LineItems[0].UnitAmount, 100);
  assert.equal(payload.LineItems[0].TaxType, 'NONE');
});

test('stored Salesforce document links resolve through the current source row', () => {
  const salesforce = {
    buyers: [{
      Id: source.salesforceId,
      Name: source.documentNumber,
      Amount__c: 1000,
      Invoice_Date__c: source.invoiceDate,
      Invoice_Due_Date__c: source.dueDate,
      LastModifiedDate: '2026-08-29T08:00:00.000Z',
      STEM__c: 'a0H000000000001AAA',
      STEM__r: {
        Name: source.stemName,
        KeyStem__c: source.stemName,
        Account__c: '001000000000001AAA',
        Account__r: { Name: 'Buyer One', Company_Code__c: 'HKBUYER ONE' },
        Delivery_Date__c: source.deliveryDate,
      },
    }],
    suppliers: [],
    lines: [{
      Id: 'a0N000000000001AAA',
      Buyer_Invoice__c: source.salesforceId,
      Product__c: '01t000000000001AAA',
      Product__r: { Name: 'HSFO 380' },
      Quantity__c: 10,
      Price_Per_Unit__c: 100,
      Total_Price__c: 1000,
      LastModifiedDate: '2026-08-29T08:00:00.000Z',
    }],
    extras: [],
  };
  const xeroSnapshot = {
    documents: [xero({ invoiceNumber: source.documentNumber })],
    inactiveDocuments: [],
    contacts: [{ id: 'contact-1', name: 'Buyer One', status: 'ACTIVE' }],
    organisation: {},
  };
  const stored = {
    productMappings: [{
      direction: 'buyer',
      salesforce_product_id: '01t000000000001AAA',
      xero_account_code: '200',
      xero_tax_type: 'NONE',
    }],
    documentMappings: [{
      salesforce_object: 'Invoice__c',
      salesforce_id: source.salesforceId,
      xero_document_type: 'ACCREC',
      xero_document_id: 'xero-invoice-1',
    }],
  };

  const result = buildFinancialClassifications(salesforce, xeroSnapshot, stored);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].salesforceId, source.salesforceId);
  assert.equal(result.rows[0].xero.id, 'xero-invoice-1');
});

test('Xero rate headers are recorded and the 20 percent daily reserve fails closed', () => {
  const headers = new Headers({
    'x-minlimit-remaining': '42',
    'x-daylimit-remaining': '199',
    'retry-after': '15',
  });
  const snapshot = xeroFinancialRateSnapshot(headers);
  assert.equal(snapshot.minuteRemaining, 42);
  assert.equal(snapshot.dayRemaining, 199);
  assert.equal(snapshot.retryAfterSeconds, 15);
  assert.throws(
    () => assertXeroFinancialDailyReserve(snapshot, { XERO_DAILY_LIMIT: '1000', XERO_DAILY_RESERVE_RATIO: '0.2' }),
    (error) => error.status === 429 && error.code === 'XERO_FINANCIAL_DAILY_RESERVE',
  );
  assert.doesNotThrow(() => assertXeroFinancialDailyReserve({ dayRemaining: 201 }, { XERO_DAILY_LIMIT: '1000' }));
});

test('financial-sync migration is service-only, forced-RLS, resumable, and revision protected', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260829080726_xero_financial_sync.sql', import.meta.url), 'utf8');
  for (const table of [
    'xero_financial_product_mappings',
    'xero_financial_bank_mappings',
    'xero_financial_document_mappings',
    'xero_financial_sync_runs',
    'xero_financial_sync_items',
    'xero_financial_payment_mappings',
    'xero_financial_audit_events',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  assert.match(sql, /security invoker/g);
  assert.match(sql, /revision = p_expected_revision/g);
  assert.match(sql, /unique \(salesforce_object, salesforce_id\)/);
  assert.match(sql, /unique \(idempotency_key\)/);
  assert.match(sql, /grant execute on function public\.authorise_xero_financial_sync_run_v1/);
});

test('financial handlers and Finance review UI are registered without a scheduler', async () => {
  const server = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  const xeroHandlers = await readFile(new URL('../api/_xeroHandlers.js', import.meta.url), 'utf8');
  const policies = await readFile(new URL('../api/_handlerPolicyRegistry.js', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../src/components/xero/XeroFinancialSync.jsx', import.meta.url), 'utf8');
  for (const name of ['xeroFinancialSyncPreview', 'xeroFinancialMappingsGet', 'xeroFinancialMappingsSave', 'xeroFinancialSyncApply', 'xeroFinancialSyncRun', 'xeroFinancialPaymentApply']) {
    assert.match(xeroHandlers, new RegExp(name));
    assert.match(policies, new RegExp(name));
  }
  assert.match(server, /\.\.\.xeroHandlers/);
  assert.match(ui, /Finance reviewed/);
  assert.match(ui, /Financial write gate locked/);
  assert.doesNotMatch(`${server}\n${xeroHandlers}`, /xeroFinancialSyncCron/);
});
