import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assertXeroFinancialDailyReserve,
  buildXeroAccountingPayload,
  buildFinancialClassifications,
  classifyXeroFinancialPayment,
  classifyXeroFinancialDocument as classifyDocument,
  deriveXeroProductMappingProposals,
  isProtectedXeroDocument,
  xeroFinancialRateSnapshot,
} from '../api/_xeroFinancialSync.js';
import { summarizeXeroFinancialReconciliation } from '../src/lib/xeroFinancialReconciliation.js';
import { resolveRemittanceBankEvidence } from '../api/_xeroPaymentBankEvidence.js';
import { buildBuyerPaymentDocumentEvidence } from '../api/_xeroBuyerPaymentEvidence.js';

const paymentSfId = (number) => `a01${String(number).padStart(12, '0')}`;
function buyerDocumentEvidence(payment, invoiceId) {
  return buildBuyerPaymentDocumentEvidence(payment.STEM__c, [{
    Id: invoiceId, STEM__c: payment.STEM__c, STEM__r: { Account__c: payment.Account__c },
    Amount__c: 1000, Invoice_Date__c: '2026-01-01', Invoice_Due_Date__c: '2026-02-01',
    Proforma__c: false, Deprecated__c: false, CurrencyIsoCode: 'USD',
    _currency: { currency: 'USD', blockers: [] },
  }], { complete: true });
}

const classifyXeroFinancialDocument = (source, candidates, options = {}) => classifyDocument(source, candidates, { ...options, organisation: { baseCurrency: 'USD', ...options.organisation } });

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
    lineItems: [{ LineItemID: 'line-1', Description: 'Legacy line', Quantity: 1, UnitAmount: 1000, AccountCode: '200', TaxType: 'NONE' }],
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
  assert.equal(classified.status, 'eligible');
  assert.equal(classified.reviewRequired, true);
});

test('exact protected Xero history can be durably linked without changing accounting history', () => {
  const exact = xero({
    status: 'PAID',
    amountDue: 0,
    amountPaid: 1000,
    invoiceNumber: source.documentNumber,
    date: source.invoiceDate,
    dueDate: source.dueDate,
    reference: source.reference,
    lineItems: [{ Description: 'HSFO 380', Quantity: 10, UnitAmount: 100, AccountCode: '200', TaxType: 'NONE' }],
  });
  const classified = classifyXeroFinancialDocument(source, [exact]);
  assert.equal(classified.action, 'protected_legacy');
  assert.equal(classified.status, 'eligible');
  assert.deepEqual(classified.differences, []);
});

test('accepted preservation cannot become an update after settlement reversal, unlocked period or source amendment', () => {
  const mapping = { xero_document_id: 'xero-invoice-1', protected_legacy: true,
    retained_differences: { reviewFingerprint: 'previously-accepted-evidence' } };
  for (const document of [xero({ status: 'AUTHORISED' }), xero({ status: 'DRAFT' }),
    xero({ status: 'AUTHORISED', amountPaid: 0, amountCredited: 0, amountDue: 1000 })]) {
    const result = classifyXeroFinancialDocument({ ...source, sourceFingerprint: 'amended-source' }, [document], { storedMapping: mapping });
    assert.equal(result.action, 'protected_legacy'); assert.equal(result.reviewRequired, true);
    assert.equal(result.acceptedLegacy, false); assert.equal(result.status, 'eligible');
  }
  const incompatible = classifyXeroFinancialDocument({ ...source, lines: [{ ...source.lines[0], accountCode: 'different-account' }] }, [xero({ status: 'AUTHORISED' })], { storedMapping: mapping });
  assert.equal(incompatible.action, 'protected_legacy'); assert.equal(incompatible.status, 'protected'); assert.ok(incompatible.blockers.length);
});

test('changed acceptance requires review even when a preserved document now has no visible differences', () => {
  const exact = xero({ status: 'AUTHORISED', invoiceNumber: source.documentNumber, date: source.invoiceDate,
    dueDate: source.dueDate, reference: source.reference,
    lineItems: [{ Description: 'HSFO 380', Quantity: 10, UnitAmount: 100, AccountCode: '200', TaxType: 'NONE' }] });
  const result = classifyXeroFinancialDocument(source, [exact], { storedMapping: { xero_document_id: exact.id,
    protected_legacy: true, retained_differences: { reviewFingerprint: 'different-earlier-source-evidence' } } });
  assert.equal(result.action, 'protected_legacy'); assert.deepEqual(result.differences, []);
  assert.equal(result.reviewRequired, true); assert.equal(result.acceptedLegacy, false); assert.equal(result.status, 'eligible');
});

test('stored Xero payment links must still exist and match current Salesforce values', () => {
  const ids = { invoice: '11111111-1111-4111-8111-111111111111', contact: '22222222-2222-4222-8222-222222222222',
    payment: '33333333-3333-4333-8333-333333333333', bank: '44444444-4444-4444-8444-444444444444' };
  const payment = { Id: paymentSfId(1), CurrencyIsoCode: 'USD', Name: 'PAY-1', Amount__c: 500, Date__c: '2026-07-01', Bank__c: 'DBS', STEM__c: paymentSfId(2), Account__c: paymentSfId(3), RecordType: { DeveloperName: 'Receivable' } };
  const documentMapping = { id: 'document-map-1', xero_document_id: ids.invoice, xero_document_type: 'ACCREC', xero_contact_id: ids.contact, salesforce_object: 'Invoice__c', salesforce_id: paymentSfId(4), retained_differences: { stemId: payment.STEM__c, accountId: payment.Account__c } };
  payment._buyerDocumentEvidence = buyerDocumentEvidence(payment, documentMapping.salesforce_id);
  const currentDocument = { id: ids.invoice, type: 'ACCREC', status: 'AUTHORISED', contactId: ids.contact, currency: 'USD', amountDue: 500 };
  const fingerprint = classifyXeroFinancialPayment(payment, {
    existingBySalesforce: new Map(),
    documentMappingById: new Map(),
    documentBySupplierInvoice: new Map(),
    buyerByStem: new Map(),
    bankByName: new Map(),
    xeroPayments: [],
    currentDocumentById: new Map(),
  }).sourceFingerprint;
  const stored = { id: 'payment-map-1', salesforce_payment_id: payment.Id, document_mapping_id: documentMapping.id, xero_payment_id: ids.payment, source_fingerprint: fingerprint };
  const xeroPayment = { PaymentID: ids.payment, PaymentType: 'ACCRECPAYMENT', Status: 'AUTHORISED', Amount: 500, Date: '2026-07-01', Reference: payment.Name,
    Account: { AccountID: ids.bank }, Invoice: { InvoiceID: ids.invoice, Type: 'ACCREC', CurrencyCode: 'USD', Contact: { ContactID: ids.contact } } };
  stored.xero_bank_account_id = ids.bank;
  const baseContext = {
    existingBySalesforce: new Map([[payment.Id, stored]]),
    documentMappingById: new Map([[documentMapping.id, documentMapping]]),
    xeroPayments: [xeroPayment],
    currentDocumentById: new Map([[documentMapping.xero_document_id, currentDocument]]),
  };
  assert.equal(classifyXeroFinancialPayment(payment, baseContext).status, 'protected');
  const v1Fields = { id: payment.Id, amount: payment.Amount__c, date: payment.Date__c, bank: payment.Bank__c, stem: payment.STEM__c, reference: payment.Name, type: payment.RecordType.DeveloperName };
  const v1Fingerprint = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(v1Fields).sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
  const legacyContext = { ...baseContext, existingBySalesforce: new Map([[payment.Id, { ...stored, source_fingerprint: v1Fingerprint }]]) };
  const upgrade = classifyXeroFinancialPayment(payment, legacyContext);
  assert.equal(upgrade.action, 'payment_link'); assert.equal(upgrade.status, 'eligible');
  assert.notEqual(upgrade.sourceFingerprint, v1Fingerprint);
  const unverifiedLegacy = classifyXeroFinancialPayment(payment, { ...legacyContext, documentMappingById: new Map([[documentMapping.id, { ...documentMapping, retained_differences: { stemId: payment.STEM__c } }]]) });
  assert.equal(unverifiedLegacy.status, 'blocked');

  const centDrift = classifyXeroFinancialPayment(payment, { ...baseContext, xeroPayments: [{ ...xeroPayment, Amount: 500.01 }] });
  assert.equal(centDrift.status, 'blocked');
  const missingInvoice = classifyXeroFinancialPayment(payment, { ...baseContext, currentDocumentById: new Map() });
  assert.equal(missingInvoice.status, 'blocked');
  const changedContact = classifyXeroFinancialPayment(payment, { ...baseContext, currentDocumentById: new Map([[documentMapping.xero_document_id, { ...currentDocument, contactId: 'wrong-contact' }]]) });
  assert.equal(changedContact.status, 'blocked');
  const missing = classifyXeroFinancialPayment(payment, { ...baseContext, xeroPayments: [] });
  assert.equal(missing.status, 'blocked');
  assert.match(missing.blockers.join(' '), /no longer points/i);
  const wrongBank = classifyXeroFinancialPayment(payment, { ...baseContext, xeroPayments: [{ ...xeroPayment, Account: { AccountID: '55555555-5555-4555-8555-555555555555' } }] });
  assert.equal(wrongBank.status, 'blocked');
  assert.match(wrongBank.blockers.join(' '), /bank account differs/i);
  const deposit = classifyXeroFinancialPayment({ ...payment, Is_Deposit__c: true }, baseContext);
  assert.equal(deposit.status, 'blocked');
  assert.match(deposit.blockers.join(' '), /Deposit payments require Finance allocation/i);

  const unapprovedBank = classifyXeroFinancialPayment(payment, {
    existingBySalesforce: new Map(),
    documentMappingById: new Map([[documentMapping.id, documentMapping]]),
    documentBySupplierInvoice: new Map(),
    buyerByStem: new Map([[payment.STEM__c, [documentMapping]]]),
    bankByName: new Map(),
    xeroPayments: [xeroPayment],
    currentDocumentById: new Map([[documentMapping.xero_document_id, currentDocument]]),
  });
  assert.equal(unapprovedBank.status, 'blocked');
  assert.match(unapprovedBank.blockers.join(' '), /No approved Xero bank mapping/i);
});

test('combined reconciliation reaches 100 percent only after documents and payments are both exact', () => {
  const incomplete = summarizeXeroFinancialReconciliation({ documents: [{ action: 'link', status: 'eligible', differences: [] }] });
  assert.equal(incomplete.status, 'incomplete_check');
  assert.equal(incomplete.completion, null);

  const summary = summarizeXeroFinancialReconciliation({
    documents: [
      { action: 'link', status: 'eligible', differences: [] },
      { action: 'protected_legacy', status: 'eligible', differences: [] },
      { action: 'create_draft', status: 'eligible', differences: [] },
      { action: 'protected_legacy', status: 'protected', differences: [{ field: 'total' }] },
    ],
    payments: [
      { action: 'payment_link', status: 'protected', blockers: [] },
      { action: 'payment_apply', status: 'eligible', blockers: [] },
      { action: 'blocked', status: 'blocked', blockers: ['Missing document'] },
    ],
  });
  assert.deepEqual({ total: summary.total, reconciled: summary.reconciled, pending: summary.pending, exceptions: summary.exceptions }, { total: 7, reconciled: 3, pending: 2, exceptions: 2 });
  assert.equal(summary.status, 'attention_required');
  assert.equal(summary.completion, 43);

  const complete = summarizeXeroFinancialReconciliation({
    documents: [{ action: 'link', status: 'eligible', differences: [] }],
    payments: [{ action: 'payment_link', status: 'protected', blockers: [] }],
  });
  assert.equal(complete.status, 'reconciled');
  assert.equal(complete.completion, 100);
});

test('identity conflicts block an otherwise matching transaction', () => {
  const result = classifyXeroFinancialDocument(source, [xero({ invoiceNumber: source.documentNumber, contactId: 'wrong-contact' })]);
  assert.equal(result.action, 'blocked');
  assert.match(result.blockers.join(' '), /Contact conflicts/i);
});

test('Xero payload preserves authorised state for safe updates and uses Salesforce detailed lines', () => {
  const payload = buildXeroAccountingPayload(source, 'xero-invoice-1', 'AUTHORISED', xero());
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
      CurrencyIsoCode: 'USD',
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
    organisation: { baseCurrency: 'USD' },
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

test('mapping proposals use only unanimous exact legacy line evidence', () => {
  const rows = [
    proposalRow({ xeroId: 'xero-1', accountCode: '41100', taxType: 'NONE' }),
    proposalRow({ xeroId: 'xero-2', accountCode: '41100', taxType: 'NONE' }),
  ];
  const proposals = deriveXeroProductMappingProposals(rows);
  assert.deepEqual(proposals, [{
    direction: 'buyer',
    salesforceProductId: '01t000000000001AAA',
    salesforceProductName: 'HSFO 380',
    status: 'proposed',
    xeroAccountCode: '41100',
    xeroTaxType: 'NONE',
    evidenceBasis: 'exact_line',
    sampleCount: 2,
    documentCount: 2,
    alternatives: [{ xeroAccountCode: '41100', xeroTaxType: 'NONE', sampleCount: 2, documentCount: 2, evidenceBasis: 'exact_line' }],
  }]);
});

test('mapping proposals use serialized quantity and unit amount when lineAmount is absent', () => {
  const row = proposalRow({ xeroId: 'xero-1', accountCode: '41100', taxType: 'NONE' });
  delete row.lines[0].lineAmount;
  const [proposal] = deriveXeroProductMappingProposals([row]);
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.xeroAccountCode, '41100');
  assert.equal(proposal.evidenceBasis, 'exact_line');
});

test('uniform exact-document coding proposes mappings when legacy and Salesforce line grouping differs', () => {
  const row = proposalRow({ xeroId: 'xero-1', accountCode: '41100', taxType: 'NONE' });
  row.total = 1000;
  row.lines = [
    { sourceId: 'line-1', productId: 'product-a', productName: 'HSFO 380', description: 'HSFO 380', quantity: 6, unitAmount: 100 },
    { sourceId: 'line-2', productId: 'product-b', productName: 'BARGE FEE', description: 'BARGE FEE', quantity: 1, unitAmount: 400 },
  ];
  row.xero.total = 1000;
  row.xero.lineItems = [{ Description: 'Legacy bunker sale', Quantity: 1, UnitAmount: 1000, LineAmount: 1000, AccountCode: '41100', TaxType: 'NONE' }];
  const proposals = deriveXeroProductMappingProposals([row]);
  assert.deepEqual(proposals.map((proposal) => [proposal.salesforceProductId, proposal.xeroAccountCode, proposal.evidenceBasis]), [
    ['product-b', '41100', 'uniform_document'],
    ['product-a', '41100', 'uniform_document'],
  ]);
});

test('mapping proposals expose conflicts without choosing an account', () => {
  const proposals = deriveXeroProductMappingProposals([
    proposalRow({ xeroId: 'xero-1', accountCode: '41100', taxType: 'NONE' }),
    proposalRow({ xeroId: 'xero-2', accountCode: '41000', taxType: 'OUTPUT' }),
  ]);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, 'conflict');
  assert.equal(proposals[0].xeroAccountCode, null);
  assert.equal(proposals[0].sampleCount, 2);
  assert.deepEqual(proposals[0].alternatives.map((row) => row.xeroAccountCode).sort(), ['41000', '41100']);
});

test('mapping proposals reject non-mapping blockers and ambiguous multi-line evidence', () => {
  const nonMappingBlocker = proposalRow({ xeroId: 'xero-1', accountCode: '41100', taxType: 'NONE' });
  nonMappingBlocker.blockers.push('No exact active Xero Contact matches the Salesforce Account.');
  const ambiguous = proposalRow({ xeroId: 'xero-2', accountCode: '41100', taxType: 'NONE' });
  ambiguous.lines.push({ ...ambiguous.lines[0], sourceId: 'line-2' });
  ambiguous.xero.lineItems.push({ ...ambiguous.xero.lineItems[0], AccountCode: '41000' });
  assert.deepEqual(deriveXeroProductMappingProposals([nonMappingBlocker, ambiguous]), []);
});

function proposalRow({ xeroId, accountCode, taxType }) {
  return {
    salesforceObject: 'Invoice__c',
    blockers: ['HSFO 380: Finance-approved Xero account mapping is missing.'],
    lines: [{
      sourceId: 'line-1',
      productId: '01t000000000001AAA',
      productName: 'HSFO 380',
      description: 'HSFO 380',
      quantity: 10,
      unitAmount: 100,
      lineAmount: 1000,
    }],
    xero: {
      id: xeroId,
      total: 1000,
      lineItems: [{
        Description: 'Legacy bunker line',
        Quantity: 1,
        UnitAmount: 1000,
        LineAmount: 1000,
        AccountCode: accountCode,
        TaxType: taxType,
      }],
    },
  };
}

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
  const financialService = await readFile(new URL('../api/_xeroFinancialSync.js', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../src/components/xero/XeroFinancialSync.jsx', import.meta.url), 'utf8');
  const portal = await readFile(new URL('../src/pages/XeroPortal.jsx', import.meta.url), 'utf8');
  for (const name of ['xeroFinancialSyncPreview', 'xeroFinancialMappingsGet', 'xeroFinancialMappingsSave', 'xeroFinancialSyncApply', 'xeroFinancialSyncRun', 'xeroFinancialPaymentApply']) {
    assert.match(xeroHandlers, new RegExp(name));
    assert.match(policies, new RegExp(name));
  }
  assert.match(server, /\.\.\.xeroHandlers/);
  assert.match(ui, /financialCopy\.financeReviewed/);
  assert.match(ui, /financialCopy\.gateLocked/);
  assert.match(ui, /financialCopy\.mappingDescription/);
  assert.match(ui, /financialCopy\.suggested/);
  assert.match(ui, /financialCopy\.approveMapping/);
  assert.match(ui, /MAPPING_PAGE_SIZE = 25/);
  assert.match(ui, /financialCopy\.mappingRange/);
  assert.match(ui, /summarizeXeroFinancialReconciliation/);
  assert.match(ui, /cutoffDate: XERO_FINANCIAL_CUTOFF/g);
  assert.doesNotMatch(ui, /setCutoffDate/);
  assert.match(portal, /useState\('accounting'\)/);
  assert.match(financialService, /Date__c = null AND CreatedDate >= \$\{cutoff\}T00:00:00Z/);
  assert.doesNotMatch(financialService, /RecordType\.DeveloperName IN \('Receivable','Payable'\)/);
  assert.doesNotMatch(financialService, /AND Is_Deposit__c = false/);
  assert.doesNotMatch(`${server}\n${xeroHandlers}`, /xeroFinancialSyncCron/);
});


test('new exact payments require current same-currency bank and org evidence and an unlocked date', () => {
  const payment = { Id: paymentSfId(11), Name: 'PAY-NEW', CurrencyIsoCode: 'USD', Amount__c: 50, Date__c: '2026-09-01', Bank__c: 'DBS', STEM__c: paymentSfId(12), Account__c: paymentSfId(13), RecordType: { DeveloperName: 'Receivable' } };
  const mapping = { id: 'map', salesforce_object: 'Invoice__c', salesforce_id: paymentSfId(14), xero_document_id: 'xero-invoice', xero_document_type: 'ACCREC', xero_contact_id: 'contact', retained_differences: { stemId: payment.STEM__c, accountId: payment.Account__c } };
  payment._buyerDocumentEvidence = buyerDocumentEvidence(payment, mapping.salesforce_id);
  const context = { existingBySalesforce: new Map(), documentMappingById: new Map(), documentBySupplierInvoice: new Map(), buyerByStem: new Map([[payment.STEM__c, [mapping]]]), bankByName: new Map([['DBS', { xero_bank_account_id: 'bank' }]]), xeroPayments: [], currentDocumentById: new Map([['xero-invoice', { id: 'xero-invoice', type: 'ACCREC', status: 'AUTHORISED', contactId: 'contact', currency: 'USD', amountDue: 100 }]]), bankAccounts: new Map([['bank', { CurrencyCode: 'USD' }]]), organisation: { baseCurrency: 'USD' } };
  const good = classifyXeroFinancialPayment(payment, context);
  assert.equal(good.action, 'payment_apply'); assert.equal(good.currency, 'USD');
  const withoutSourceProof = classifyXeroFinancialPayment({ ...payment, _buyerDocumentEvidence: undefined }, context);
  assert.equal(withoutSourceProof.status, 'blocked');
  assert.notEqual(good.reviewFingerprint, withoutSourceProof.reviewFingerprint);
  const unapproved = classifyXeroFinancialPayment(payment, { ...context, bankByName: new Map() });
  assert.ok(unapproved.blockers.includes('No approved Xero bank mapping exists for DBS.'));
  assert.equal(unapproved.blockers.some((message) => /Salesforce payment bank is missing/.test(message)), false);
  for (const Bank__c of [null, '', '   ', '\t\n']) {
    let lookups = 0;
    const blankMapped = classifyXeroFinancialPayment({ ...payment, Bank__c }, { ...context,
      bankByName: { get(key) { lookups += 1; assert.equal(key, ''); return { xero_bank_account_id: 'bank' }; } } });
    assert.equal(lookups, 0, 'an erroneous empty-name mapping must never be looked up');
    assert.equal(blankMapped.action, 'blocked'); assert.equal(blankMapped.status, 'blocked'); assert.equal(blankMapped.proposedPayment, null);
    assert.ok(blankMapped.blockers.includes('Salesforce payment bank is missing. Identify the actual bank in Salesforce, then recheck this payment.'));
    assert.notEqual(blankMapped.reviewFingerprint, good.reviewFingerprint);
  }
  for (const change of [{ bankAccounts: new Map() }, { bankAccounts: new Map([['bank', { CurrencyCode: 'HKD' }]]) }, { organisation: { baseCurrency: 'HKD' } }, { organisation: { baseCurrency: 'USD', periodLockDate: '2026-09-02' } }]) {
    const result = classifyXeroFinancialPayment(payment, { ...context, ...change });
    assert.equal(result.status, 'blocked'); assert.equal(result.proposedPayment, null);
    assert.notEqual(result.reviewFingerprint, good.reviewFingerprint);
  }
  const waiting = classifyXeroFinancialPayment(payment, { ...context, buyerByStem: new Map() });
  assert.ok(waiting.blockerCodes.every((code) => code === 'invoice_link_pending'));
});

test('remittance proof changes source and review identity, and cannot use historical fingerprint fallback', () => {
  const sfId = (number) => `a01${String(number).padStart(12, '0')}`;
  const remittanceId = sfId(1);
  const common = { CurrencyIsoCode: 'USD', Account__c: sfId(100), Date__c: '2026-09-01',
    Is_Deposit__c: false, Is_Volume_Discount__c: false, Commission_Invoice__c: null, Supplier_Invoice__c: null };
  const parent = { ...common, Id: remittanceId, RecordType: { DeveloperName: 'Receivable_Remittance' },
    Bank__c: 'UBS', Amount__c: 100 };
  const payment = { ...common, Id: sfId(2), Name: 'PAY-2', RecordType: { DeveloperName: 'Receivable' },
    Remittance__c: remittanceId, Bank__c: null, Amount__c: 50, STEM__c: sfId(200) };
  const sibling = { ...payment, Id: sfId(3), Name: 'PAY-3' };
  const derive = (parentRow, children) => resolveRemittanceBankEvidence(payment, {
    parent: parentRow, siblings: children, complete: true,
  }).payment;
  const map = { id: 'document-map', xero_document_id: 'xero-invoice', xero_document_type: 'ACCREC',
    xero_contact_id: 'contact', salesforce_object: 'Invoice__c', salesforce_id: sfId(201),
    retained_differences: { stemId: payment.STEM__c, accountId: payment.Account__c } };
  payment._buyerDocumentEvidence = buyerDocumentEvidence(payment, map.salesforce_id);
  const context = { existingBySalesforce: new Map(), documentMappingById: new Map([[map.id, map]]),
    documentBySupplierInvoice: new Map(), buyerByStem: new Map([[payment.STEM__c, [map]]]),
    bankByName: new Map([['UBS', { xero_bank_account_id: 'bank' }]]), xeroPayments: [],
    currentDocumentById: new Map([['xero-invoice', { id: 'xero-invoice', type: 'ACCREC',
      status: 'AUTHORISED', contactId: 'contact', currency: 'USD', amountDue: 100 }]]),
    bankAccounts: new Map([['bank', { CurrencyCode: 'USD' }]]), organisation: { baseCurrency: 'USD' } };
  const firstPayment = derive(parent, [payment, sibling]);
  const first = classifyXeroFinancialPayment(firstPayment, context);
  assert.equal(first.status, 'eligible');
  assert.equal(first.bankEvidence.parentId, remittanceId);
  const changed = classifyXeroFinancialPayment(derive({ ...parent, Reference__c: 'revised cash receipt' }, [payment, sibling]), context);
  assert.notEqual(changed.sourceFingerprint, first.sourceFingerprint);
  assert.notEqual(changed.reviewFingerprint, first.reviewFingerprint);
  const siblingChanged = classifyXeroFinancialPayment(derive(parent, [payment, { ...sibling, Reference__c: 'revised allocation' }]), context);
  assert.notEqual(siblingChanged.sourceFingerprint, first.sourceFingerprint);
  const historical = classifyXeroFinancialPayment({ ...firstPayment, _bankEvidence: undefined }, context).sourceFingerprint;
  const existing = { salesforce_payment_id: payment.Id, document_mapping_id: map.id,
    xero_payment_id: 'xero-payment', xero_bank_account_id: 'bank', source_fingerprint: historical };
  const linked = classifyXeroFinancialPayment(firstPayment, { ...context,
    existingBySalesforce: new Map([[payment.Id, existing]]),
    xeroPayments: [{ PaymentID: 'xero-payment', Amount: 50, Date: payment.Date__c,
      Reference: payment.Name, Account: { AccountID: 'bank' }, Invoice: { InvoiceID: 'xero-invoice' } }],
  });
  assert.match(linked.blockers.join(' '), /Salesforce payment changed/i);
  assert.equal(linked.status, 'blocked');
  const savedContext = { ...context, existingBySalesforce: new Map([[payment.Id, {
    ...existing, source_fingerprint: first.sourceFingerprint,
  }]]), xeroPayments: [{ PaymentID: 'xero-payment', Amount: 50, Date: payment.Date__c,
    Reference: payment.Name, Account: { AccountID: 'bank' }, Invoice: { InvoiceID: 'xero-invoice' } }] };
  for (const changedParent of [
    { ...parent, Bank__c: 'DBS' }, { ...parent, Date__c: '2026-09-02' },
    { ...parent, Account__c: sfId(101) },
  ]) {
    const result = classifyXeroFinancialPayment(derive(changedParent, [payment, sibling]), savedContext);
    assert.equal(result.status, 'blocked');
    assert.ok(result.blockers.some((message) => /Salesforce payment changed|remittance/i.test(message)));
  }
  for (const changedSibling of [
    { ...sibling, Account__c: sfId(101) }, { ...sibling, Amount__c: 49.99 },
  ]) {
    const result = classifyXeroFinancialPayment(derive(parent, [payment, changedSibling]), savedContext);
    assert.equal(result.status, 'blocked');
    assert.ok(result.blockers.some((message) => /Salesforce payment changed|remittance/i.test(message)));
  }
  const retainedContext = { ...savedContext, existingBySalesforce: new Map([[payment.Id, {
    ...existing, retained_reference: { version: 1 }, source_fingerprint: first.sourceFingerprint,
  }]]) };
  const retained = classifyXeroFinancialPayment(derive(parent, [payment, { ...sibling, Amount__c: 49.99 }]), retainedContext);
  assert.equal(retained.status, 'blocked');
  assert.ok(retained.blockers.some((message) => /remittance/i.test(message)));
});
