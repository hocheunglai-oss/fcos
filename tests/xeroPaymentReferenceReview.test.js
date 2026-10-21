import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyXeroFinancialPayment, xeroFinancialPaymentApply } from '../api/_xeroFinancialSync.js';
import { selectXeroPaymentMatch, selectXeroReferenceRetentionMatch } from '../api/_xeroPaymentIdentity.js';
import { normalizeName } from '../api/_xeroContactSync.js';

const ids = { tenant: '11111111-1111-4111-8111-111111111111', invoice: '22222222-2222-4222-8222-222222222222',
  bank: '33333333-3333-4333-8333-333333333333', mapping: '44444444-4444-4444-8444-444444444444',
  payment: '55555555-5555-4555-8555-555555555555', contact: '66666666-6666-4666-8666-666666666666',
  bankMapping: '77777777-7777-4777-8777-777777777777', actor: '88888888-8888-4888-8888-888888888888' };
function fixture() {
  const payment = { Id: 'a0S000000000001AAA', Name: 'a0S000000000001', Amount__c: 9423.7, Date__c: '2026-02-02',
    Reference__c: null, CurrencyIsoCode: 'USD', Bank__c: 'UBS', Account__c: '001000000000001AAA',
    STEM__c: 'a0H000000000001AAA', Supplier_Invoice__c: 'a06000000000001AAA', RecordType: { DeveloperName: 'Payable' } };
  const mapping = { id: ids.mapping, salesforce_object: 'Supplier_Invoice__c', salesforce_id: payment.Supplier_Invoice__c,
    xero_document_id: ids.invoice, xero_document_type: 'ACCPAY', xero_contact_id: ids.contact,
    source_fingerprint: 'document-source', protected_legacy: true,
    retained_differences: { accountId: payment.Account__c, stemId: payment.STEM__c, reviewFingerprint: 'accepted-document' } };
  const document = { id: ids.invoice, type: 'ACCPAY', status: 'PAID', contactId: ids.contact, currency: 'USD', total: 9423.7, amountDue: 0 };
  const bank = { id: ids.bankMapping, salesforce_bank_name: 'UBS', xero_bank_account_id: ids.bank, enabled: true, revision: 1 };
  const bankAccount = { AccountID: ids.bank, Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'USD' };
  const actual = { PaymentID: ids.payment, Status: 'AUTHORISED', PaymentType: 'ACCPAYPAYMENT', Amount: 9423.7,
    BankAmount: 9423.7, CurrencyRate: 1, Date: '2026-02-02', Reference: 'AP-3399-6759', Account: { AccountID: ids.bank, CurrencyCode: 'USD' },
    Invoice: { InvoiceID: ids.invoice, Type: 'ACCPAY', CurrencyCode: 'USD', Contact: { ContactID: ids.contact } } };
  const context = { tenantId: ids.tenant, existingBySalesforce: new Map(), documentMappingById: new Map([[mapping.id, mapping]]),
    documentBySupplierInvoice: new Map([[mapping.salesforce_id, mapping]]), buyerByStem: new Map(),
    bankByName: new Map([[normalizeName('UBS'), bank]]), xeroPayments: [actual], paymentMappings: [],
    currentDocumentById: new Map([[ids.invoice, document]]), bankAccounts: new Map([[ids.bank, bankAccount]]),
    organisation: { baseCurrency: 'USD' }, paymentPostingClaims: new Map() };
  const classify = () => classifyXeroFinancialPayment(payment, context);
  const retain = () => selectXeroReferenceRetentionMatch({ payment, documentMapping: mapping, currentDocument: document,
    bankAccountId: bank.xero_bank_account_id, bankAccount, organisation: context.organisation,
    xeroPayments: context.xeroPayments, paymentMappings: context.paymentMappings });
  return { payment, mapping, document, bank, bankAccount, actual, context, classify, retain };
}

function accept(f) {
  const row = f.classify();
  const saved = { salesforce_payment_id: f.payment.Id, document_mapping_id: ids.mapping, xero_payment_id: ids.payment,
    xero_bank_account_id: ids.bank, source_fingerprint: row.sourceFingerprint, status: 'linked', exception_reason: null,
    amount: row.amount, currency: row.currency, payment_date: row.paymentDate,
    retained_reference: { version: 1, tenantId: ids.tenant, sourceFingerprint: row.sourceFingerprint,
      referenceReviewFingerprint: row.referenceReviewFingerprint, evidence: structuredClone(row.retainedReferenceEvidence) } };
  f.context.existingBySalesforce.set(f.payment.Id, saved); f.context.paymentMappings = [saved];
  f.context.paymentPostingClaims.set(f.payment.Id, { id: 'claim', status: 'completed', control_totals: { paymentPosting: {
    state: 'reference_linked', tenantId: ids.tenant, paymentId: f.payment.Id.slice(0, 15), reviewed: structuredClone(row), confirmedPaymentId: ids.payment } } });
  return { row, saved };
}

test('absent source reference allows only an explicit no-write review of one complete existing payment', () => {
  const f = fixture();
  assert.equal(selectXeroPaymentMatch({ payment: f.payment, documentMapping: f.mapping, bankAccountId: ids.bank, xeroPayments: [f.actual] }).match, null);
  assert.equal(f.retain().match.PaymentID, ids.payment);
  const row = f.classify();
  assert.equal(row.action, 'payment_reference_link'); assert.equal(row.status, 'eligible'); assert.equal(row.reviewRequired, true);
  assert.equal(row.proposedPayment, null); assert.equal(row.amountDue, 0); assert.deepEqual(row.blockers, []);
  assert.deepEqual(row.referenceComparison, { sourceReference: null, sourceFallbackReference: f.payment.Name, xeroReference: 'AP-3399-6759' });
  assert.deepEqual(row.retainedReferenceEvidence.documentMapping, f.mapping);
  assert.deepEqual(row.retainedReferenceEvidence.bankMapping, f.bank);
});

test('reference retention rejects meaningful references, missing identity, currency, bank, tax-like adjustments and competing payments', () => {
  const cases = [
    f => { f.payment.Reference__c = 'meaningful explicit reference'; },
    f => { delete f.payment.CurrencyIsoCode; },
    f => { f.payment.Account__c = 'other'; },
    f => { delete f.mapping.retained_differences.accountId; },
    f => { f.actual.Account.AccountID = ids.contact; },
    f => { f.bankAccount.CurrencyCode = 'HKD'; },
    f => { f.bankAccount.Status = 'ARCHIVED'; },
    f => { f.actual.BankAmount = 9423.6; },
    f => { f.actual.CurrencyRate = 0.99; },
    f => { delete f.actual.CurrencyRate; },
    f => { delete f.actual.Invoice.Contact; },
    f => { f.actual.Invoice.Contact.ContactID = ids.bank; },
    f => { f.actual.Invoice.Type = 'ACCREC'; },
    f => { f.actual.PaymentType = 'ARCREDITPAYMENT'; },
    f => { f.actual.Status = 'DELETED'; },
    f => { f.actual.Amount = 9423.701; },
    f => { f.actual.Reference = ''; },
    f => { f.actual.HasValidationErrors = true; },
    f => { f.context.xeroPayments.push(structuredClone(f.actual)); },
    f => { f.context.paymentMappings.push({ salesforce_payment_id: 'a0S000000000002AAA', xero_payment_id: ids.payment }); },
  ];
  for (const mutate of cases) { const f = fixture(); mutate(f); assert.equal(f.retain().match, null, String(mutate)); }
  for (const field of ['Is_Deposit__c', 'Is_Volume_Discount__c', 'Commission_Invoice__c']) {
    const f = fixture(); f.payment[field] = true; assert.equal(f.classify().action, 'blocked', field);
  }
});

test('unchanged accepted reference stays matched and cannot auto-post; changed evidence remains blocked', () => {
  const f = fixture(); const { row } = accept(f); const current = f.classify();
  assert.equal(current.action, 'payment_link'); assert.equal(current.status, 'protected'); assert.equal(current.acceptedReference, true);
  assert.equal(current.reviewRequired, false); assert.equal(current.reviewFingerprint, row.reviewFingerprint); assert.equal(current.proposedPayment, null);
  for (const mutate of [
    g => { g.payment.Reference__c = 'new reference'; }, g => { g.payment.Amount__c = 9400; },
    g => { g.payment.Date__c = '2026-02-03'; }, g => { g.payment.Supplier_Invoice__c = 'other'; },
    g => { g.actual.Reference = 'changed historical reference'; }, g => { g.bank.revision++; },
    g => { g.document.total++; }, g => { g.mapping.retained_differences.reviewFingerprint = 'changed'; },
    g => { g.actual.PaymentID = ids.actor; },
  ]) {
    const g = fixture(); accept(g); mutate(g); const changed = g.classify();
    assert.equal(changed.action, 'blocked', String(mutate)); assert.equal(changed.proposedPayment, null); assert.equal(changed.acceptedReference, false);
  }
});

test('accepted references require a consistent saved mapping and completed durable posting barrier', () => {
  const cases = [
    (f) => f.context.paymentPostingClaims.clear(),
    (_f, saved) => { saved.status = 'exception'; },
    (_f, saved) => { saved.exception_reason = 'Finance hold'; },
    (_f, saved) => { saved.source_fingerprint = 'changed'; },
    (_f, saved) => { saved.amount = 100; },
    (_f, saved) => { saved.currency = 'HKD'; },
    (_f, saved) => { saved.payment_date = '2026-02-03'; },
  ];
  for (const mutate of cases) {
    const f = fixture(); const { saved } = accept(f); mutate(f, saved); const row = f.classify();
    assert.equal(row.action, 'blocked', String(mutate)); assert.equal(row.acceptedReference, false);
    assert.equal(row.proposedPayment, null); assert.equal(row.reviewRequired, false);
  }
});

test('an unresolved posting claim cannot be converted to reference retention', () => {
  const f = fixture(); const row = f.classify();
  f.context.paymentPostingClaims.set(f.payment.Id, { id: 'previous', status: 'failed', control_totals: { paymentPosting: { state: 'uncertain', reviewed: row } } });
  const result = f.classify(); assert.equal(result.action, 'blocked'); assert.equal(result.proposedPayment, null);
  assert.match(result.blockers.join(' '), /previous posting|previous payment/i);
});

test('the migration empty proof default preserves the ordinary exact-payment path', () => {
  const f = fixture(); f.actual.Reference = f.payment.Name; const row = f.classify();
  assert.equal(row.action, 'payment_link');
  f.context.existingBySalesforce.set(f.payment.Id, { salesforce_payment_id: f.payment.Id, document_mapping_id: ids.mapping,
    xero_payment_id: ids.payment, xero_bank_account_id: ids.bank, source_fingerprint: row.sourceFingerprint, retained_reference: {} });
  const current = f.classify(); assert.equal(current.action, 'payment_link'); assert.equal(current.status, 'protected');
  assert.deepEqual(current.blockers, []); assert.equal(current.proposedPayment, null);
});

function handlerFixture() {
  const f = fixture(); const row = f.classify(); const calls = [];
  const body = { mode: 'link_existing', reviewed: true, selectedPayments: [{ id: f.payment.Id, sourceFingerprint: row.sourceFingerprint, reviewFingerprint: row.reviewFingerprint }] };
  const preview = { tenantId: ids.tenant, rows: [row], rateLimit: { dayRemaining: 600 } };
  const dependencies = { client: {}, accessContext: { profile: { id: ids.actor, email: 'finance@example.com' } }, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' },
    paymentPreview: async input => { assert.equal(input.recordExactMatches, false); assert.equal(input.persist, false); calls.push('fresh-preview'); return preview; },
    getConnection: async () => ({ tenantId: ids.tenant, scope: 'accounting.payments.read accounting.invoices accounting.settings.read' }),
    persistReferenceLinks: async (_client, data) => { calls.push(data); return { outcomes: data.rows.map(r => ({ salesforcePaymentId: r.salesforcePaymentId, xeroPaymentId: r.xeroPaymentId, status: 'linked' })), summary: { linked: data.rows.length, failed: 0 } }; },
    accountingFetch: async () => { throw Error('Link-only handler must not call a provider write'); } };
  return { f, row, body, preview, dependencies, calls };
}

test('link-only handler revalidates the exact selection and persists without any payment-post path', async () => {
  const f = handlerFixture(); const result = await xeroFinancialPaymentApply(f.body, f.dependencies);
  assert.equal(result.summary.linked, 1); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].actor.id, ids.actor);
  assert.equal(f.calls[1].rows[0].proposedPayment, null);
});

test('link-only handler rejects unknown, duplicate, stale or mixed selections before persistence', async () => {
  for (const change of [
    f => { f.body.selectedPayments.push(f.body.selectedPayments[0]); },
    f => { f.body.selectedPayments[0].id = 'a0S000000000002AAA'; },
    f => { f.body.selectedPayments[0].reviewFingerprint = 'f'.repeat(64); },
    f => { f.body.selectedPayments[0].sourceFingerprint = 'e'.repeat(64); },
    f => { f.preview.rows[0].action = 'payment_apply'; },
    f => { f.preview.rows[0].proposedPayment = { Amount: 9423.7 }; },
    f => { f.preview.tenantId = ids.actor; },
    f => { f.body.reviewed = false; },
    f => { f.dependencies.env = {}; },
  ]) {
    const f = handlerFixture(); change(f); await assert.rejects(xeroFinancialPaymentApply(f.body, f.dependencies));
    assert.ok(f.calls.every(call => typeof call === 'string'), String(change));
  }
});
