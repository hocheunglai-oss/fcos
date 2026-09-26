import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildBuyerPaymentDocumentEvidence } from '../api/_xeroBuyerPaymentEvidence.js';
import { classifyXeroFinancialPayment, xeroFinancialPaymentApply } from '../api/_xeroFinancialSync.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ids = { tenant: '11111111-1111-4111-8111-111111111111', invoice: '22222222-2222-4222-8222-222222222222',
  bank: '33333333-3333-4333-8333-333333333333', mapping: '44444444-4444-4444-8444-444444444444',
  payment: '55555555-5555-4555-8555-555555555555', contact: '66666666-6666-4666-8666-666666666666',
  bankMapping: '77777777-7777-4777-8777-777777777777' };
const sfId = number => `a01${String(number).padStart(12, '0')}`;

function fixture() {
  const payment = { Id: sfId(1), Name: sfId(1), Amount__c: 100, Date__c: '2026-02-02',
    Reference__c: null, CurrencyIsoCode: 'USD', Bank__c: 'UBS', Account__c: sfId(2),
    STEM__c: sfId(3), RecordType: { DeveloperName: 'Receivable' } };
  const invoice = { Id: sfId(4), Name: 'HK-INV-001', STEM__c: payment.STEM__c,
    STEM__r: { Account__c: payment.Account__c }, Amount__c: 100, Proforma__c: false, Deprecated__c: false,
    Invoice_Date__c: '2025-12-31', Invoice_Due_Date__c: '2026-02-02',
    LastModifiedDate: '2026-02-02T00:00:00.000Z', _currency: { currency: 'USD', blockers: [] } };
  const mapping = { id: ids.mapping, salesforce_object: 'Invoice__c', salesforce_id: invoice.Id,
    xero_document_id: ids.invoice, xero_document_type: 'ACCREC', xero_contact_id: ids.contact,
    source_fingerprint: 'document-source', protected_legacy: true,
    retained_differences: { accountId: payment.Account__c, stemId: payment.STEM__c, reviewFingerprint: 'accepted-document' } };
  const document = { id: ids.invoice, type: 'ACCREC', status: 'AUTHORISED', contactId: ids.contact,
    currency: 'USD', total: 100, amountDue: 100 };
  const bank = { id: ids.bankMapping, salesforce_bank_name: 'UBS', xero_bank_account_id: ids.bank, enabled: true, revision: 1 };
  const bankAccount = { AccountID: ids.bank, Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'USD' };
  const actual = { PaymentID: ids.payment, Status: 'AUTHORISED', PaymentType: 'ACCRECPAYMENT', Amount: 100,
    BankAmount: 100, CurrencyRate: 1, Date: payment.Date__c, Reference: payment.Name,
    Account: { AccountID: ids.bank, CurrencyCode: 'USD' },
    Invoice: { InvoiceID: ids.invoice, Type: 'ACCREC', CurrencyCode: 'USD', Contact: { ContactID: ids.contact } } };
  const context = { tenantId: ids.tenant, existingBySalesforce: new Map(), documentMappingById: new Map([[mapping.id, mapping]]),
    documentBySupplierInvoice: new Map(), buyerByStem: new Map([[payment.STEM__c, [mapping]]]),
    bankByName: new Map([['UBS', bank]]), xeroPayments: [], paymentMappings: [],
    currentDocumentById: new Map([[ids.invoice, document]]), bankAccounts: new Map([[ids.bank, bankAccount]]),
    organisation: { baseCurrency: 'USD' }, paymentPostingClaims: new Map() };
  const setInventory = (documents = [invoice], complete = true) => {
    payment._buyerDocumentEvidence = buildBuyerPaymentDocumentEvidence(payment.STEM__c, documents, { complete });
  };
  setInventory();
  return { payment, invoice, mapping, document, actual, context, setInventory,
    classify: () => classifyXeroFinancialPayment(payment, context) };
}

function saveLink(f, row, retainedReference = false) {
  const saved = { salesforce_payment_id: f.payment.Id, document_mapping_id: ids.mapping, xero_payment_id: ids.payment,
    xero_bank_account_id: ids.bank, source_fingerprint: row.sourceFingerprint, status: 'linked', exception_reason: null,
    amount: row.amount, currency: row.currency, payment_date: row.paymentDate,
    ...(retainedReference ? { retained_reference: { version: 1, tenantId: ids.tenant, sourceFingerprint: row.sourceFingerprint,
      referenceReviewFingerprint: row.referenceReviewFingerprint, evidence: structuredClone(row.retainedReferenceEvidence) } } : {}) };
  f.context.existingBySalesforce.set(f.payment.Id, saved);
  f.context.paymentMappings = [saved];
  return saved;
}

test('one durable buyer mapping cannot hide additional unlinked invoices or signed/positive credits', () => {
  for (const extra of [{ Amount__c: 20 }, { Amount__c: -20 }, { Name: 'HK-CN-001', Amount__c: 20 }, { Is_Credit_Note__c: true, Amount__c: 20 }]) {
    const f = fixture(); const before = f.classify();
    assert.equal(before.action, 'payment_apply');
    f.setInventory([f.invoice, { ...f.invoice, Id: sfId(5), ...extra }]);
    const row = f.classify();
    assert.equal(row.action, 'blocked'); assert.equal(row.proposedPayment, null);
    assert.match(row.blockers.join(' '), /More than one current buyer invoice/);
    assert.equal(row.sourceFingerprint, before.sourceFingerprint);
    assert.notEqual(row.reviewFingerprint, before.reviewFingerprint);
  }
});

test('missing, incomplete, deleted, replaced and mismatched current source evidence prevents a payment', () => {
  const changes = [
    f => { delete f.payment._buyerDocumentEvidence; },
    f => f.setInventory([f.invoice], false),
    f => f.setInventory([]),
    f => f.setInventory([{ ...f.invoice, Id: sfId(5) }]),
    f => f.setInventory([{ ...f.invoice, STEM__r: { Account__c: sfId(6) } }]),
    f => f.setInventory([{ ...f.invoice, _currency: { currency: 'HKD', blockers: [] } }]),
    f => f.setInventory([{ ...f.invoice, Deprecated__c: true }]),
    f => f.setInventory([{ ...f.invoice, Name: 'HK-CN-001' }]),
    f => f.setInventory([{ ...f.invoice, CreditNote__c: true }]),
  ];
  for (const change of changes) {
    const f = fixture(); const before = f.classify(); change(f); const row = f.classify();
    assert.equal(row.action, 'blocked', String(change)); assert.equal(row.proposedPayment, null);
    assert.equal(row.sourceFingerprint, before.sourceFingerprint);
    assert.notEqual(row.reviewFingerprint, before.reviewFingerprint);
  }
});

test('apply refresh rejects stale inventory even when the fresh invoice selection remains eligible', async () => {
  for (const change of [
    f => f.setInventory([f.invoice, { ...f.invoice, Id: sfId(5), Proforma__c: true }]),
    f => f.setInventory([{ ...f.invoice, LastModifiedDate: '2026-02-03T00:00:00.000Z' }]),
    f => f.setInventory([f.invoice, { ...f.invoice, Id: sfId(5), Amount__c: -20 }]),
    f => f.setInventory([]),
  ]) {
    const f = fixture(); const reviewed = f.classify(); change(f); let freshReads = 0; let connections = 0; let providerCalls = 0;
    await assert.rejects(xeroFinancialPaymentApply({ mode: 'apply', reviewed: true,
      selectedPayments: [{ id: f.payment.Id, sourceFingerprint: reviewed.sourceFingerprint, reviewFingerprint: reviewed.reviewFingerprint }] },
    { client: {}, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' },
      paymentPreview: async body => { freshReads++; assert.equal(body.persist, false); return { tenantId: ids.tenant, rows: [f.classify()] }; },
      getConnection: async () => { connections++; throw Error('Must reject before connecting'); },
      accountingFetch: async () => { providerCalls++; throw Error('Must reject before a provider request'); },
    }), { code: 'XERO_FINANCIAL_NO_ELIGIBLE_PAYMENTS' });
    assert.equal(freshReads, 1); assert.equal(connections, 0); assert.equal(providerCalls, 0);
  }
});

test('existing exact links and completed posting claims retain stable source identity but obey inventory holds', () => {
  const f = fixture(); const proposed = f.classify(); f.context.xeroPayments = [f.actual];
  saveLink(f, proposed);
  f.context.paymentPostingClaims.set(f.payment.Id, { id: 'confirmed-claim', status: 'completed', control_totals: {
    paymentPosting: { state: 'confirmed', tenantId: ids.tenant, reviewed: proposed, confirmedPaymentId: ids.payment } } });
  const exact = f.classify();
  assert.equal(exact.status, 'protected'); assert.equal(exact.paymentPostingClaimId, 'confirmed-claim');
  f.setInventory([f.invoice, { ...f.invoice, Id: sfId(5), Deprecated__c: true }]);
  const unchangedSelection = f.classify();
  assert.equal(unchangedSelection.status, 'protected'); assert.equal(unchangedSelection.sourceFingerprint, exact.sourceFingerprint);
  assert.notEqual(unchangedSelection.reviewFingerprint, exact.reviewFingerprint);
  for (const docs of [[], [f.invoice, { ...f.invoice, Id: sfId(5), Amount__c: -20 }]]) {
    f.setInventory(docs); const row = f.classify();
    assert.equal(row.status, 'blocked'); assert.equal(row.proposedPayment, null);
  }
});

test('legacy retained-reference links keep v1 proof and posting barrier while fresh inventories gate eligibility', async () => {
  const f = fixture(); f.actual.Reference = 'EXISTING-BANK-REFERENCE'; f.context.xeroPayments = [f.actual];
  f.document.status = 'PAID'; f.document.amountDue = 0;
  const reviewed = f.classify(); assert.equal(reviewed.action, 'payment_reference_link');
  saveLink(f, reviewed, true);
  // Prior releases wrapped this same reference evidence without buyer inventory.
  const legacyReview = { ...reviewed, reviewFingerprint: hash({ review: reviewed.referenceReviewFingerprint, tenantId: ids.tenant }) };
  delete legacyReview.buyerDocumentEvidence;
  f.context.paymentPostingClaims.set(f.payment.Id, { id: 'reference-claim', status: 'completed', control_totals: {
    paymentPosting: { state: 'reference_linked', tenantId: ids.tenant, paymentId: f.payment.Id.slice(0, 15),
      reviewed: legacyReview, confirmedPaymentId: ids.payment } } });
  const current = f.classify();
  assert.equal(current.status, 'protected'); assert.equal(current.acceptedReference, true);
  assert.equal(current.sourceFingerprint, legacyReview.sourceFingerprint);
  assert.equal(current.referenceReviewFingerprint, legacyReview.referenceReviewFingerprint);
  assert.notEqual(current.reviewFingerprint, legacyReview.reviewFingerprint);
  f.setInventory([f.invoice, { ...f.invoice, Id: sfId(5), Proforma__c: true }]);
  const changed = f.classify();
  assert.equal(changed.status, 'protected'); assert.equal(changed.acceptedReference, true);
  assert.equal(changed.referenceReviewFingerprint, current.referenceReviewFingerprint);
  assert.notEqual(changed.reviewFingerprint, current.reviewFingerprint);
  let connected = false; let persisted = false;
  await assert.rejects(xeroFinancialPaymentApply({ mode: 'link_existing', reviewed: true,
    selectedPayments: [{ id: f.payment.Id, sourceFingerprint: current.sourceFingerprint, reviewFingerprint: current.reviewFingerprint }] },
  { client: {}, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' },
    paymentPreview: async () => ({ tenantId: ids.tenant, rows: [f.classify()] }),
    getConnection: async () => { connected = true; throw Error('Must reject first'); },
    persistReferenceLinks: async () => { persisted = true; },
  }), { code: 'XERO_PAYMENT_REFERENCE_REVIEW_CHANGED' });
  assert.equal(connected, false); assert.equal(persisted, false);
  for (const documents of [[f.invoice, { ...f.invoice, Id: sfId(5), Amount__c: -20 }], []]) {
    f.setInventory(documents); const held = f.classify();
    assert.equal(held.status, 'blocked'); assert.equal(held.acceptedReference, false); assert.equal(held.proposedPayment, null);
  }
  f.setInventory([f.invoice], false);
  assert.equal(f.classify().status, 'blocked');
});

test('committed direct-bank source fingerprint remains byte-compatible despite mandatory buyer review evidence', () => {
  const f = fixture();
  const original = { Id: 'payment-new', Name: 'PAY-NEW', CurrencyIsoCode: 'USD', Amount__c: 50,
    Date__c: '2026-09-01', Bank__c: 'DBS', STEM__c: 'stem', Account__c: 'account', RecordType: { DeveloperName: 'Receivable' } };
  const row = classifyXeroFinancialPayment(original, f.context);
  assert.equal(row.sourceFingerprint, '73768189067ad2eddd69801ee460d6934299c5470261f43854598b8dd5d17bf3');
  assert.equal(row.status, 'blocked');
  assert.match(row.blockers.join(' '), /inventory evidence is unavailable/);
});
