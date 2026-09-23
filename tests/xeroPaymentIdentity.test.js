import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentDocumentIdentityBlockers, selectXeroPaymentMatch } from '../api/_xeroPaymentIdentity.js';

const payment = {
  Id: 'sf-payment-1', Name: 'PAY-1', RecordType: { DeveloperName: 'Payable' },
  CurrencyIsoCode: 'USD', Amount__c: 125.5, Date__c: '2026-09-05', Bank__c: 'DBS',
  Supplier_Invoice__c: 'sf-supplier-invoice-1', STEM__c: 'stem-1', Account__c: 'account-1',
};
const mapping = {
  id: 'mapping-1', salesforce_object: 'Supplier_Invoice__c', salesforce_id: payment.Supplier_Invoice__c,
  xero_document_id: 'xero-invoice-1', xero_document_type: 'ACCPAY', xero_contact_id: 'contact-1',
  retained_differences: { stemId: payment.STEM__c, accountId: payment.Account__c },
};
const currentDocument = {
  id: mapping.xero_document_id, type: 'ACCPAY', status: 'AUTHORISED',
  contactId: mapping.xero_contact_id, currency: 'USD', amountDue: 500,
};
const existingPayment = {
  PaymentID: 'xero-payment-1', Invoice: { InvoiceID: mapping.xero_document_id },
  Account: { AccountID: 'bank-1' }, Amount: payment.Amount__c,
  Date: payment.Date__c, Reference: payment.Name, Status: 'AUTHORISED',
};
const matchContext = {
  payment, documentMapping: mapping, bankAccountId: 'bank-1', xeroPayments: [existingPayment],
};

test('current payable and receivable documents require the exact Salesforce source relationship', () => {
  assert.deepEqual(paymentDocumentIdentityBlockers(payment, mapping, currentDocument), []);
  assert.deepEqual(paymentDocumentIdentityBlockers(payment, mapping, { ...currentDocument, status: 'PAID' }), []);
  const receivable = { ...payment, RecordType: { DeveloperName: 'Receivable' }, Supplier_Invoice__c: null };
  const buyerMapping = { ...mapping, salesforce_object: 'Invoice__c', salesforce_id: 'buyer-invoice-1', xero_document_type: 'ACCREC' };
  assert.deepEqual(paymentDocumentIdentityBlockers(receivable, buyerMapping, { ...currentDocument, type: 'ACCREC' }), []);
  assert.match(paymentDocumentIdentityBlockers({ ...payment, Supplier_Invoice__c: 'other-invoice' }, mapping, currentDocument).join(' '), /exact Salesforce Supplier Invoice/);
  assert.match(paymentDocumentIdentityBlockers(receivable, { ...buyerMapping, retained_differences: { ...buyerMapping.retained_differences, stemId: 'other-stem' } }, { ...currentDocument, type: 'ACCREC' }).join(' '), /exact Salesforce STEM/);
  assert.match(paymentDocumentIdentityBlockers(receivable, { ...buyerMapping, retained_differences: {} }, { ...currentDocument, type: 'ACCREC' }).join(' '), /exact Salesforce STEM/);
});

test('current document contact, type, currency, status, and identity drift all block payments', () => {
  const cases = [
    [{ ...currentDocument, contactId: 'other-contact' }, /Contact differs/],
    [{ ...currentDocument, contactId: null }, /no verified Contact/],
    [{ ...currentDocument, type: 'ACCREC' }, /transaction type conflicts/],
    [{ ...currentDocument, type: undefined }, /transaction type conflicts/],
    [{ ...currentDocument, currency: 'HKD' }, /currency/],
    [{ ...currentDocument, currency: null }, /currency/],
    [{ ...currentDocument, status: 'VOIDED' }, /not authorised/],
    [{ ...currentDocument, status: 'DRAFT' }, /not authorised/],
    [{ ...currentDocument, id: 'other-invoice' }, /stored document identity/],
    [{ ...currentDocument, id: null }, /stored document identity/],
    [null, /could not be re-read/],
  ];
  for (const [document, reason] of cases) assert.match(paymentDocumentIdentityBlockers(payment, mapping, document).join(' '), reason);
});

test('missing or incompatible stored document evidence fails closed with a document-check remedy', () => {
  assert.match(paymentDocumentIdentityBlockers(payment, null, currentDocument).join(' '), /Run the document check again/);
  assert.match(paymentDocumentIdentityBlockers(payment, { ...mapping, xero_contact_id: null }, currentDocument).join(' '), /no verified Xero Contact.*Run the document check again/);
  assert.match(paymentDocumentIdentityBlockers(payment, { ...mapping, xero_document_id: null }, currentDocument).join(' '), /no exact Xero transaction identity/);
  assert.match(paymentDocumentIdentityBlockers(payment, { ...mapping, xero_document_type: 'ACCREC' }, currentDocument).join(' '), /mapped Xero transaction type conflicts/);
  assert.match(paymentDocumentIdentityBlockers(payment, { ...mapping, salesforce_object: 'Invoice__c' }, currentDocument).join(' '), /exact Salesforce Supplier Invoice/);
  assert.match(paymentDocumentIdentityBlockers({ ...payment, RecordType: { DeveloperName: 'Other' } }, mapping, currentDocument).join(' '), /outside exact Receivable\/Payable/);
});

test('retained Salesforce Account identity is checked when present without inventing old mapping evidence', () => {
  assert.match(paymentDocumentIdentityBlockers({ ...payment, Account__c: 'other-account' }, mapping, currentDocument).join(' '), /Account differs/);
  assert.match(paymentDocumentIdentityBlockers({ ...payment, Account__c: null }, mapping, currentDocument).join(' '), /Account differs/);
  assert.deepEqual(paymentDocumentIdentityBlockers(payment, { ...mapping, retained_differences: { stemId: payment.STEM__c } }, currentDocument), []);
});

test('full bank and reference identity selects one of several equal same-day payments', () => {
  const otherReference = { ...existingPayment, PaymentID: 'xero-payment-2', Reference: 'PAY-2' };
  const otherBank = { ...existingPayment, PaymentID: 'xero-payment-3', Account: { AccountID: 'bank-2' } };
  const result = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [otherReference, otherBank, existingPayment] });
  assert.equal(result.match, existingPayment);
  assert.deepEqual(result.blockers, []);
});

test('an explicit Salesforce reference takes precedence over the payment name', () => {
  const referenced = { ...existingPayment, Reference: 'BANK-TRANSFER-1' };
  const result = selectXeroPaymentMatch({ ...matchContext, payment: { ...payment, Reference__c: referenced.Reference }, xeroPayments: [existingPayment, referenced] });
  assert.equal(result.match, referenced);
  assert.deepEqual(result.blockers, []);
});

test('multiple full identities and bank or reference near-matches cannot create duplicate payments', () => {
  const duplicate = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [existingPayment, { ...existingPayment, PaymentID: 'xero-payment-2' }] });
  assert.equal(duplicate.match, null);
  assert.match(duplicate.blockers.join(' '), /More than one active Xero payment/);
  for (const changed of [{ Reference: 'another-reference' }, { Account: { AccountID: 'another-bank' } }]) {
    const result = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [{ ...existingPayment, ...changed }] });
    assert.equal(result.match, null);
    assert.match(result.blockers.join(' '), /different bank account or reference/);
  }
});

test('all stored mappings prevent an out-of-scope Salesforce payment from losing its Xero payment', () => {
  const result = selectXeroPaymentMatch({ ...matchContext, paymentMappings: [{ salesforce_payment_id: 'old-sf-payment-outside-scan', xero_payment_id: existingPayment.PaymentID }] });
  assert.equal(result.match, null);
  assert.match(result.blockers.join(' '), /already linked to a different Salesforce payment/);
  const sameOwner = selectXeroPaymentMatch({ ...matchContext, paymentMappings: [{ salesforce_payment_id: payment.Id, xero_payment_id: existingPayment.PaymentID }] });
  assert.equal(sameOwner.match, existingPayment);
  assert.deepEqual(sameOwner.blockers, []);
});

test('deleted and inactive payments never link or silently permit replacement', () => {
  const deleted = { ...existingPayment, Status: 'DELETED' };
  const result = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [deleted] });
  assert.equal(result.match, null);
  assert.match(result.blockers.join(' '), /deleted Xero payment.*before a replacement/);
  const inactive = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [{ ...existingPayment, Status: 'VOIDED' }] });
  assert.equal(inactive.match, null);
  assert.match(inactive.blockers.join(' '), /inactive Xero payment/);
  const live = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [deleted, { ...existingPayment, PaymentID: 'live-replacement' }] });
  assert.equal(live.match.PaymentID, 'live-replacement');
  assert.deepEqual(live.blockers, []);
});

test('missing payment identity, invoice, bank, and reference evidence blocks matching', () => {
  for (const [override, reason] of [
    [{ payment: { ...payment, Id: null } }, /payment identity is missing/],
    [{ documentMapping: null }, /not durably linked/],
    [{ bankAccountId: null }, /No approved Xero bank mapping/],
    [{ payment: { ...payment, Name: '', Reference__c: '' } }, /reference is missing/],
    [{ xeroPayments: [{ ...existingPayment, PaymentID: null }] }, /no exact PaymentID/],
  ]) {
    const result = selectXeroPaymentMatch({ ...matchContext, ...override });
    assert.equal(result.match, null);
    assert.match(result.blockers.join(' '), reason);
  }
});

test('refunds, zero, nonfinite amounts, and invalid calendar dates fail both stored and new payment checks', () => {
  for (const amount of [-125.5, 0, null, true, [125.5], 'invalid', '0x10', Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalidPayment = { ...payment, Amount__c: amount };
    assert.match(paymentDocumentIdentityBlockers(invalidPayment, mapping, currentDocument).join(' '), /amount must be positive and finite/);
    const result = selectXeroPaymentMatch({ ...matchContext, payment: invalidPayment });
    assert.equal(result.match, null);
    assert.match(result.blockers.join(' '), /amount must be positive and finite/);
  }
  for (const date of [null, '', 'not-a-date', '2026-02-30', '2026-09-31', '2026-13-01', '2026-09-05T24:00:00Z']) {
    const invalidPayment = { ...payment, Date__c: date };
    assert.match(paymentDocumentIdentityBlockers(invalidPayment, mapping, currentDocument).join(' '), /date is missing or invalid/);
    const result = selectXeroPaymentMatch({ ...matchContext, payment: invalidPayment });
    assert.equal(result.match, null);
    assert.match(result.blockers.join(' '), /date is missing or invalid/);
  }
});

test('Xero date formats match valid source days without treating invalid dates as evidence', () => {
  const epoch = Date.parse(`${payment.Date__c}T00:00:00Z`);
  for (const date of [payment.Date__c, `${payment.Date__c}T00:00:00`, `${payment.Date__c}T00:00:00.000Z`, `/Date(${epoch}+0000)/`]) {
    const result = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [{ ...existingPayment, Date: date }] });
    assert.equal(result.match.PaymentID, existingPayment.PaymentID);
    assert.deepEqual(result.blockers, []);
  }
  const invalidSameDate = selectXeroPaymentMatch({ ...matchContext, payment: { ...payment, Date__c: '2026-02-30' }, xeroPayments: [{ ...existingPayment, Date: '2026-02-30' }] });
  assert.equal(invalidSameDate.match, null);
  assert.match(invalidSameDate.blockers.join(' '), /date is missing or invalid/);
});

test('missing Xero payment dates cannot silently turn possible existing allocations into new payments', () => {
  for (const date of [null, '2026-02-30', '/Date(1788566400000+9999)/']) {
    const result = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [{ ...existingPayment, Date: date }] });
    assert.equal(result.match, null);
    assert.match(result.blockers.join(' '), /missing or invalid date/);
  }
});

test('exact USD cents avoid confusing a one-cent difference while unrelated payments do not block', () => {
  const differentCent = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [{ ...existingPayment, Amount: 125.51 }] });
  assert.deepEqual(differentCent, { match: null, blockers: [] });
  const unrelated = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [{ ...existingPayment, Invoice: { InvoiceID: 'other-invoice' } }] });
  assert.deepEqual(unrelated, { match: null, blockers: [] });
  const noHistory = selectXeroPaymentMatch({ ...matchContext, xeroPayments: [] });
  assert.deepEqual(noHistory, { match: null, blockers: [] });
});


test('payment currency requires authoritative source evidence and never defaults missing evidence to USD', () => {
  assert.match(paymentDocumentIdentityBlockers({ ...payment, CurrencyIsoCode: undefined }, mapping, currentDocument).join(' '), /currency is missing/);
  assert.deepEqual(paymentDocumentIdentityBlockers({ ...payment, CurrencyIsoCode: undefined, _currency: { currency: 'HKD' } }, mapping, { ...currentDocument, currency: 'HKD' }), []);
  assert.match(paymentDocumentIdentityBlockers({ ...payment, CurrencyIsoCode: 'HKD' }, mapping, currentDocument).join(' '), /currency does not match/);
});
