import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyXeroFinancialPayment, xeroFinancialPaymentApply } from '../api/_xeroFinancialSync.js';
import { publicPaymentSnapshot } from '../api/_xeroFinancialPublicEvidence.js';
import { paymentPostingKey } from '../api/_xeroPaymentPosting.js';
import { paymentReferenceReviewEligible } from '../src/lib/financialWorkflowUi.js';
import { isIssuedNativeHkdPostingRow } from '../api/_xeroPaymentIdentity.js';
import { evaluateRemittanceSummary } from '../api/_xeroRemittanceSummary.js';

const context = () => ({ existingBySalesforce: new Map(), documentMappingById: new Map(),
  documentBySupplierInvoice: new Map(), buyerByStem: new Map(), currentDocumentById: new Map(),
  bankByName: new Map(), bankAccounts: new Map(), xeroPayments: [], paymentMappings: [],
  paymentPostingClaims: new Map(), organisation: { baseCurrency: 'USD' } });
const payment = (type) => ({ Id: 'a0S000000000101', Name: 'REMIT-101', RecordType: { DeveloperName: type },
  Account__c: '001000000000001', Amount__c: 100, Date__c: '2026-01-02', Bank__c: 'DBS',
  STEM__c: null, Supplier_Invoice__c: null, Remittance__c: null, Commission_Invoice__c: null,
  Is_Deposit__c: false, Is_Volume_Discount__c: false, _currency: { currency: 'USD', blockers: [] } });
function verifiedHeader() {
  const parent = payment('Payable_Remittance');
  const child = { ...parent, Id: 'a0S000000000102', Name: 'PAY-102', RecordType: { DeveloperName: 'Payable' },
    Remittance__c: parent.Id, Supplier_Invoice__c: 'a06000000000101' };
  const review = evaluateRemittanceSummary(parent, { siblings: [child], visiblePayments: [parent, child],
    complete: true, headerUnmapped: true });
  assert.equal(review.eligible, true);
  return { ...parent, _remittanceSummary: review.evidence };
}

test('unsupported payment kinds stop before ordinary invoice or bank matching', () => {
  const failLookup = { get() { throw new Error('Unsupported kind reached invoice/bank matching'); } };
  for (const type of ['Bank_Charge', 'Commission', 'Write_Off', 'Receivable_Remittance', 'Payable_Remittance', 'Other']) {
    const current = { ...context(), documentBySupplierInvoice: failLookup, buyerByStem: failLookup, bankByName: failLookup };
    const row = classifyXeroFinancialPayment(payment(type), current);
    assert.equal(row.status, 'blocked');
    assert.equal(row.action, 'blocked');
    assert.equal(row.proposedPayment, null);
    assert.equal(row.blockers.length, 1);
    assert.ok(row.blockerCodes.every(code => code.startsWith('payment_kind_')));
    assert.equal(row.blockerCodes.includes('invoice_link_pending'), false);
    assert.doesNotMatch(row.blockers.join(' '), /not durably linked|must be positive|No approved Xero bank/);
  }
});

test('complete header evidence only creates an informational summary with no financial identities or payload', () => {
  const row = classifyXeroFinancialPayment(verifiedHeader(), context());
  assert.equal(row.action, 'remittance_summary');
  assert.equal(row.status, 'informational');
  assert.equal(row.proposedPayment, null);
  assert.equal(row.xeroPaymentId, null);
  assert.equal(row.documentMappingId, null);
  assert.deepEqual(row.blockers, []);
  assert.equal(row.remittanceSummary.allocationCount, 1);
  assert.match(row.reviewFingerprint, /^[a-f0-9]{64}$/);
});

test('changed header or tampered family evidence returns to attention without a replacement payment', () => {
  const header = verifiedHeader();
  const altered = JSON.parse(JSON.stringify(header));
  altered._remittanceSummary.source.allocations[0].Amount__c = 90;
  for (const value of [{ ...header, Amount__c: 90 }, altered, { ...header, _remittanceSummary: null }]) {
    const row = classifyXeroFinancialPayment(value, context());
    assert.equal(row.status, 'blocked');
    assert.equal(row.remittanceSummary, undefined);
    assert.equal(row.proposedPayment, null);
  }
});

test('an existing durable header payment mapping cannot be hidden by summary classification', () => {
  const header = verifiedHeader(); const current = context();
  current.existingBySalesforce.set(header.Id, { salesforce_payment_id: header.Id,
    xero_payment_id: 'previous-payment', document_mapping_id: 'old-map' });
  const row = classifyXeroFinancialPayment(header, current);
  assert.equal(row.status, 'blocked');
  assert.equal(row.remittanceSummary, undefined);
  assert.equal(row.proposedPayment, null);
  assert.ok(row.blockers.some(reason => /stored Xero payment/.test(reason)));
});

test('posting claims in either Salesforce ID representation prevent header summary classification', () => {
  for (const suffix of ['', 'AAA']) {
    const header = verifiedHeader(); const current = context();
    current.paymentPostingClaims.set(header.Id + suffix, { id: 'claim', error_message: 'Unknown write outcome' });
    const row = classifyXeroFinancialPayment(header, current);
    assert.equal(row.status, 'blocked');
    assert.equal(row.remittanceSummary, undefined);
    assert.equal(row.proposedPayment, null);
    assert.ok(row.blockerCodes.includes('payment_posting_claim_pending'));
  }
});

test('native HKD reviews bind the original invoice, bank and claim for posting or readback', async () => {
  const sourceId = 'a06000000000101';
  const documentId = '22222222-2222-4222-8222-222222222222';
  const bankId = '33333333-3333-4333-8333-333333333333';
  const providerId = '44444444-4444-4444-8444-444444444444';
  const contactId = '55555555-5555-4555-8555-555555555555';
  const source = { ...payment('Receivable'), STEM__c: 'stem-with-multiple-invoices',
    Buyer_Invoice__c: sourceId, CurrencyIsoCode: 'USD', Payment_Currency__c: 'HKD', Amount__c: 97.5,
    Payment_HKD_Amount__c: 780, Payment_FX_Rate__c: 8, Payment_FX_Revision__c: 'rate',
    Payment_FX_Effective_At__c: '2026-01-01T12:00:00Z', Invoice_Carrying_USD__c: 100, Settlement_FX_USD__c: -2.5,
    Bank_Currency__c: 'HKD', Bank_Native_Amount__c: 780, Bank_FX_Evidence__c: 'synthetic receipt',
    Payment_Operation_Id__c: '66666666-6666-4666-8666-666666666666', Payment_Request_Fingerprint__c: 'a'.repeat(64),
  };
  const mapping = { id: 'mapping', salesforce_id: sourceId, salesforce_object: 'Invoice__c', xero_document_id: documentId,
    xero_document_type: 'ACCREC', xero_contact_id: contactId };
  const document = { type: 'ACCREC', currency: 'HKD', status: 'PAID', contactId };
  const actual = {
    PaymentID: providerId, PaymentType: 'ACCRECPAYMENT', Status: 'AUTHORISED',
    Invoice: { InvoiceID: documentId, Type: 'ACCREC', CurrencyCode: 'HKD' },
    Account: { AccountID: bankId, CurrencyCode: 'HKD' },
    Amount: 780, BankAmount: 780, CurrencyRate: 8, Date: source.Date__c, Reference: source.Name,
  };
  const current = { ...context(), documentByBuyerInvoice: new Map([[sourceId, mapping]]),
    buyerByStem: { get() { throw new Error('Native HKD must use the exact source invoice'); } },
    currentDocumentById: new Map([[documentId, document]]), bankByName: new Map([['DBS', { xero_bank_account_id: bankId }]]),
    bankAccounts: new Map([[bankId, { CurrencyCode: 'HKD' }]]), xeroPayments: [actual],
  };
  const exact = classifyXeroFinancialPayment(source, current);
  assert.equal(exact.currency, 'HKD');
  assert.equal(exact.amount, 780);
  assert.equal(exact.xeroPaymentId, providerId);
  assert.equal(exact.nativeFxReadbackConfirmed, true);
  assert.equal(exact.status, 'blocked');
  assert.equal(exact.proposedPayment, null);
  const open = { ...document, status: 'AUTHORISED', amountDue: 900 };
  const ready = { ...current, financialPostingEnabled: true, nativeFxPostingEnabled: true, xeroPayments: [],
    currentDocumentById: new Map([[documentId, open]]) };
  for (const family of [{ Remittance__c: 'a0S000000000123AAA' }, { _groupBankEvidenceBlocker: 'missing parent' },
    { _ordinaryRemittanceFamily: { complete: false } }, { Cash_Event__c: 'a0S000000000124AAA' }]) {
    const blocked = classifyXeroFinancialPayment({ ...source, ...family }, ready);
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.proposedPayment, null);
    assert.match(blocked.blockers.join(' '), /reviewed allocation evidence/);
  }
  const remittanceHeader = classifyXeroFinancialPayment({ ...source, RecordType: { DeveloperName: 'Receivable_Remittance' } }, ready);
  assert.equal(remittanceHeader.status, 'blocked');
  assert.equal(remittanceHeader.paymentKind, 'Receivable_Remittance');
  assert.ok(remittanceHeader.blockerCodes.includes('payment_kind_remittance_review'));
  const retained = classifyXeroFinancialPayment(source, { ...ready,
    paymentMappings: [{ salesforce_payment_id: source.Id, bank_source_evidence: { policyVersion: 'receivable_group_bank_v1' } }],
  });
  assert.match(retained.blockers.join(' '), /reviewed allocation evidence/);
  const eligible = classifyXeroFinancialPayment(source, ready);
  assert.equal(eligible.action, 'payment_apply');
  assert.equal(eligible.status, 'eligible');
  assert.equal(isIssuedNativeHkdPostingRow(eligible), true);
  const displayed = publicPaymentSnapshot({ rows: [eligible] }).rows[0];
  assert.equal(Object.hasOwn(displayed, 'nativeHkdMapping'), false);
  assert.equal(isIssuedNativeHkdPostingRow(displayed), false);
  assert.equal(displayed.reviewFingerprint, eligible.reviewFingerprint);
  const tenantId = '88888888-8888-4888-8888-888888888888';
  const actor = { id: '99999999-9999-4999-8999-999999999999', email: 'finance@example.invalid' };
  const claimId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const mappingId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const claim = { id: claimId, reviewed_by: actor.id, reviewed_by_email: actor.email,
    idempotency_key: paymentPostingKey(tenantId, source.Id), source_fingerprint: eligible.sourceFingerprint,
    control_totals: { paymentPosting: { tenantId, paymentId: source.Id.slice(0, 15), state: 'uncertain', reviewed: eligible } } };
  const recoveryContext = { ...ready, tenantId, paymentReviewer: actor, xeroPayments: [actual],
    paymentPostingClaims: new Map([[source.Id, claim]]) };
  const recovery = classifyXeroFinancialPayment(source, recoveryContext);
  assert.equal(recovery.action, 'payment_reference_link');
  assert.equal(recovery.proposedPayment, null);
  const reviewRow = publicPaymentSnapshot({ rows: [recovery] }).rows[0];
  assert.equal(Object.hasOwn(reviewRow, 'nativeHkdRecovery'), false);
  assert.equal(paymentReferenceReviewEligible(reviewRow), true);
  assert.equal(classifyXeroFinancialPayment(source, { ...recoveryContext, paymentReviewer: {} }).status, 'blocked');
  const calls = [];
  const deps = {
    env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true', FCOS_ENABLE_XERO_TRADING_FX_WRITES: 'true' }, accessContext: { profile: actor },
    paymentPreview: async () => ({ tenantId, rows: [recovery] }),
    getConnection: async () => ({ tenantId, scope: 'accounting.payments.read accounting.invoices accounting.settings.read' }),
    client: { async rpc(name, args) { calls.push({ name, args }); return { data: { mappingId, reused: false } }; } },
    accountingFetch: async () => { throw new Error('Recovery cannot send a Xero POST'); },
    persistReferenceLinks: async () => { throw new Error('Native recovery must reuse the original claim'); },
  };
  const request = { mode: 'link_existing', reviewed: true, selectedPayments: [{ id: source.Id,
    sourceFingerprint: reviewRow.sourceFingerprint, reviewFingerprint: reviewRow.reviewFingerprint }] };
  await assert.rejects(xeroFinancialPaymentApply({ ...request, selectedPayments: [{ ...request.selectedPayments[0], reviewFingerprint: 'f'.repeat(64) }] }, deps),
    { code: 'XERO_PAYMENT_REFERENCE_REVIEW_CHANGED' });
  assert.deepEqual(calls, []);
  const confirmed = await xeroFinancialPaymentApply(request, deps);
  assert.equal(confirmed.outcomes[0].status, 'linked');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'finish_xero_native_hkd_payment_v1');
  assert.equal(calls[0].args.p_claim_id, claimId);

  for (const held of [
    { ...ready, financialPostingEnabled: false },
    { ...ready, nativeFxPostingEnabled: false },
    { ...ready, organisation: { ...ready.organisation, periodLockDate: source.Date__c } },
    { ...ready, currentDocumentById: new Map([[documentId, { ...open, amountDue: 779.99 }]]) },
    { ...ready, xeroPayments: [{ ...actual, Status: 'DELETED' }] },
    { ...ready, paymentPostingClaims: new Map([[source.Id, { id: 'unresolved-claim' }]]) },
    { ...ready, paymentMappings: [{ salesforce_payment_id: source.Id, xero_payment_id: providerId }] },
  ]) {
    const blocked = classifyXeroFinancialPayment(source, held);
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.proposedPayment, null);
  }

  for (const altered of [
    { ...current, xeroPayments: [actual, actual] },
    { ...current, paymentMappings: [{ xero_payment_id: providerId, salesforce_payment_id: 'other-payment-id' }] },
    { ...current, currentDocumentById: new Map([[documentId, { ...document, contactId: 'other-contact' }]]) },
    { ...current, documentByBuyerInvoice: new Map() },
  ]) assert.equal(classifyXeroFinancialPayment(source, altered).nativeFxReadbackConfirmed, false);
});
