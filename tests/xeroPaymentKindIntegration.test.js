import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyXeroFinancialPayment } from '../api/_xeroFinancialSync.js';
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
