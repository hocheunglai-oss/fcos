import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveXeroPaymentAssociation, xeroPaymentEvidenceHold, xeroPaymentDate } from '../api/_xeroPaymentAssociation.js';
import { loadXeroPaymentEvidence, loadXeroFinancialSnapshot, classifyXeroFinancialPayment } from '../api/_xeroFinancialSync.js';
import { selectXeroPaymentMatch, selectXeroReferenceRetentionMatch } from '../api/_xeroPaymentIdentity.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const contactId = uuid(9001), bankId = uuid(9002), invoiceId = uuid(9003);
const types = [
  ['ACCRECPAYMENT', 'ACCREC', 'invoice', 'Invoice', 'InvoiceID'],
  ['ACCPAYPAYMENT', 'ACCPAY', 'invoice', 'Invoice', 'InvoiceID'],
  ['ARCREDITPAYMENT', 'ACCRECCREDIT', 'credit_note', 'CreditNote', 'CreditNoteID'],
  ['APCREDITPAYMENT', 'ACCPAYCREDIT', 'credit_note', 'CreditNote', 'CreditNoteID'],
  ['ARPREPAYMENTPAYMENT', 'ARPREPAYMENT', 'prepayment', 'Prepayment', 'PrepaymentID'],
  ['APPREPAYMENTPAYMENT', 'APPREPAYMENT', 'prepayment', 'Prepayment', 'PrepaymentID'],
  ['AROVERPAYMENTPAYMENT', 'AROVERPAYMENT', 'overpayment', 'Overpayment', 'OverpaymentID'],
  ['APOVERPAYMENTPAYMENT', 'APOVERPAYMENT', 'overpayment', 'Overpayment', 'OverpaymentID'],
];
const dedicatedTypes = new Map([
  ['ARPREPAYMENTPAYMENT', 'RECEIVE-PREPAYMENT'], ['APPREPAYMENTPAYMENT', 'SPEND-PREPAYMENT'],
  ['AROVERPAYMENTPAYMENT', 'RECEIVE-OVERPAYMENT'], ['APOVERPAYMENTPAYMENT', 'SPEND-OVERPAYMENT'],
]);
function payment(type, typeName, key, idField, id, n = 1, legacy = false) {
  const field = legacy ? 'Invoice' : key;
  return { PaymentID: uuid(n), PaymentType: type, Status: 'AUTHORISED', Amount: 100,
    Date: '2026-02-02', Reference: `PAY-${n}`, Account: { AccountID: bankId },
    [field]: { [legacy ? 'InvoiceID' : idField]: id, Type: typeName, CurrencyCode: 'USD', Contact: { ContactID: contactId } } };
}
const ordinary = (id = invoiceId, n = 1) => payment('ACCRECPAYMENT', 'ACCREC', 'Invoice', 'InvoiceID', id, n);

test('the two ordinary types alone resolve as invoices; six refund types hold in dedicated and legacy shapes', () => {
  for (let index = 0; index < types.length; index++) {
    const [paymentType, docType, kind, field, idField] = types[index];
    const id = uuid(100 + index);
    for (const legacy of index < 2 ? [false] : [false, true]) {
      const row = payment(paymentType, legacy ? docType : dedicatedTypes.get(paymentType) || docType,
        field, idField, id, index + 1, legacy);
      const result = resolveXeroPaymentAssociation(row);
      assert.equal(result.disposition, index < 2 ? 'invoice' : 'noninvoice');
      assert.equal(result.documentKind, kind);
      assert.equal(result.documentId, id);
      assert.equal(xeroPaymentEvidenceHold(row)?.status ?? null, index < 2 ? null : 'held');
      assert.equal(xeroPaymentEvidenceHold(row)?.currency ?? null, index < 2 ? null : 'USD');
    }
  }
});

test('empty arrays are absent; dual aliases, contradictions, prototype keys and missing typed evidence hold', () => {
  const row = ordinary();
  assert.equal(resolveXeroPaymentAssociation({ ...row, CreditNote: [] }).disposition, 'invoice');
  const dual = { ...row, CreditNote: { CreditNoteID: invoiceId, Type: 'ACCREC', CurrencyCode: 'USD', Contact: { ContactID: contactId } } };
  assert.equal(resolveXeroPaymentAssociation(dual).disposition, 'invalid');
  const overpayment = payment('AROVERPAYMENTPAYMENT', 'AROVERPAYMENT', 'Overpayment', 'OverpaymentID', uuid(400), 400, true);
  assert.equal(resolveXeroPaymentAssociation({ ...overpayment, Overpayment: {
    OverpaymentID: uuid(400), Type: 'AROVERPAYMENT', CurrencyCode: 'USD', Contact: { ContactID: contactId },
  } }).disposition, 'invalid');
  assert.equal(resolveXeroPaymentAssociation({ ...row, PaymentType: 'toString' }).disposition, 'invalid');
  for (const changed of [
    { PaymentID: null }, { PaymentType: null }, { Invoice: { ...row.Invoice, Type: 'AROVERPAYMENT' } },
    { Invoice: { ...row.Invoice, CurrencyCode: 'HKD', Contact: null } },
    { Invoice: { ...row.Invoice, InvoiceID: 'bad-id' } }, { Invoice: {} },
  ]) {
    const result = resolveXeroPaymentAssociation({ ...row, ...changed });
    assert.equal(result.disposition, 'invalid');
    assert.equal(xeroPaymentEvidenceHold({ ...row, ...changed }).status, 'held');
  }
  assert.equal(resolveXeroPaymentAssociation({ ...row, Invoice: { ...row.Invoice, CurrencyCode: 'HKD' } }).currency, 'HKD');
});

test('held payment display date uses the same strict Xero day parser as identity matching', () => {
  const row = payment('AROVERPAYMENTPAYMENT', 'AROVERPAYMENT', 'Overpayment', 'OverpaymentID', uuid(500), 500, true);
  const epoch = Date.parse('2026-09-26T00:00:00.000Z');
  assert.equal(xeroPaymentEvidenceHold({ ...row, Date: `/Date(${epoch}+0000)/` }).date, '2026-09-26');
  assert.equal(xeroPaymentDate('2026-02-30'), null);
  assert.equal(xeroPaymentEvidenceHold({ ...row, Date: `/Date(${epoch}+9999)/` }).date, null);
  assert.equal(xeroPaymentEvidenceHold({ ...row, Date: '2026-09-26T23:59:00-05:00' }).date, '2026-09-27');
});

test('historical hydration reads only verified ordinary invoice IDs and retains all raw payment rows', async () => {
  const refundId = uuid(300), oldInvoice = uuid(301);
  const rows = [ordinary(oldInvoice), payment('AROVERPAYMENTPAYMENT', 'AROVERPAYMENT', 'Overpayment', 'OverpaymentID', refundId, 2, true)];
  const requests = [];
  const snapshot = await loadXeroPaymentEvidence({ tenantId: uuid(999), accessToken: 'fixture' }, '2026-01-01', {
    env: {}, invoices: [], payments: rows, invoiceIds: [refundId],
    requestGate: async (_tenant, operation) => operation(),
    fetchImpl: async input => {
      const url = new URL(input); requests.push(url);
      assert.equal(url.pathname, '/api.xro/2.0/Invoices');
      assert.deepEqual(url.searchParams.get('IDs')?.split(','), [oldInvoice]);
      return new Response(JSON.stringify({ Invoices: [{ InvoiceID: oldInvoice }] }), { status: 200 });
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(snapshot.payments.length, 2);
  assert.equal(snapshot.payments[1].Invoice.Type, 'AROVERPAYMENT');
  assert.deepEqual(snapshot.invoices.map(row => row.InvoiceID), [oldInvoice]);
  assert.equal(snapshot.paymentEvidenceHolds.length, 2); // refund plus requested-ID conflict
  assert.deepEqual(snapshot.paymentEvidenceHolds.map(row => row.code),
    ['XERO_PAYMENT_NONINVOICE_REVIEW_REQUIRED', 'XERO_PAYMENT_DOCUMENT_ID_CONFLICT']);
});

test('a 441-row scoped page preserves 438 ordinary and three overpayment bodies without refund invoice hydration', async () => {
  const invoices = Array.from({ length: 438 }, (_, index) => ({ InvoiceID: uuid(10000 + index), Type: 'ACCREC', Date: '2026-02-02', Status: 'AUTHORISED' }));
  const payments = invoices.map((row, index) => ordinary(row.InvoiceID, 20000 + index));
  payments.push(...Array.from({ length: 3 }, (_, index) => payment('AROVERPAYMENTPAYMENT', 'AROVERPAYMENT',
    'Overpayment', 'OverpaymentID', uuid(30000 + index), 31000 + index, true)));
  const requests = [];
  const snapshot = await loadXeroFinancialSnapshot({ tenantId: uuid(999), accessToken: 'fixture' }, '2026-01-01', {
    env: {}, includePayments: true, requestGate: async (_tenant, operation) => operation(),
    fetchImpl: async input => {
      const url = new URL(input); requests.push(url.pathname);
      const collection = url.pathname.split('/').at(-1);
      if (collection === 'Organisations') return new Response(JSON.stringify({ Organisations: [{}] }), { status: 200 });
      return new Response(JSON.stringify({ [collection]: { Invoices: invoices, Payments: payments }[collection] || [] }), { status: 200 });
    },
  });
  assert.equal(requests.length, 5);
  assert.equal(snapshot.paymentReadSnapshot.payments.length, 441);
  assert.equal(snapshot.paymentReadSnapshot.invoices.length, 438);
  assert.equal(snapshot.paymentReadSnapshot.paymentEvidenceHolds.length, 3);
});

test('refund or malformed overlapping evidence blocks ordinary match, retention and new-post classification', () => {
  const source = { Id: 'a01000000000001AAA', Name: 'PAY-1', Amount__c: 100, Date__c: '2026-02-02',
    CurrencyIsoCode: 'USD', Bank__c: 'UBS', STEM__c: 'a0H000000000001AAA', Account__c: '001000000000001AAA',
    Supplier_Invoice__c: 'a06000000000001AAA', RecordType: { DeveloperName: 'Payable' } };
  const mapping = { id: 'map', salesforce_object: 'Supplier_Invoice__c', salesforce_id: source.Supplier_Invoice__c,
    xero_document_id: invoiceId, xero_document_type: 'ACCPAY', xero_contact_id: contactId,
    retained_differences: { stemId: source.STEM__c, accountId: source.Account__c } };
  const document = { id: invoiceId, type: 'ACCPAY', status: 'AUTHORISED', contactId, currency: 'USD', amountDue: 200 };
  const refund = payment('AROVERPAYMENTPAYMENT', 'AROVERPAYMENT', 'Overpayment', 'OverpaymentID', invoiceId, 6, true);
  refund.Reference = source.Name;
  const match = selectXeroPaymentMatch({ payment: source, documentMapping: mapping, bankAccountId: bankId, xeroPayments: [refund] });
  assert.equal(match.match, null); assert.match(match.blockers.join(' '), /held or incomplete/);
  const retain = selectXeroReferenceRetentionMatch({ payment: source, documentMapping: mapping, currentDocument: document,
    bankAccountId: bankId, bankAccount: { AccountID: bankId, Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'USD' },
    organisation: { baseCurrency: 'USD' }, xeroPayments: [refund] });
  assert.equal(retain.match, null);
  const context = { existingBySalesforce: new Map(), documentMappingById: new Map(),
    documentBySupplierInvoice: new Map([[source.Supplier_Invoice__c, mapping]]), buyerByStem: new Map(),
    bankByName: new Map([['UBS', { xero_bank_account_id: bankId }]]), xeroPayments: [refund],
    currentDocumentById: new Map([[invoiceId, document]]), bankAccounts: new Map([[bankId, { CurrencyCode: 'USD' }]]),
    organisation: { baseCurrency: 'USD' } };
  const newRow = classifyXeroFinancialPayment(source, context);
  assert.equal(newRow.action, 'blocked'); assert.equal(newRow.proposedPayment, null);
  const stored = { salesforce_payment_id: source.Id, document_mapping_id: mapping.id, xero_payment_id: refund.PaymentID,
    xero_bank_account_id: bankId, source_fingerprint: newRow.sourceFingerprint };
  const linked = classifyXeroFinancialPayment(source, { ...context,
    existingBySalesforce: new Map([[source.Id, stored]]), documentMappingById: new Map([[mapping.id, mapping]]) });
  assert.equal(linked.action, 'blocked'); assert.equal(linked.proposedPayment, null);
  const claimed = classifyXeroFinancialPayment(source, { ...context, paymentPostingClaims: new Map([[source.Id, {
    id: 'durable-claim', status: 'uncertain', control_totals: { paymentPosting: {
      observedPaymentIds: [refund.PaymentID], confirmedPaymentId: refund.PaymentID,
    } },
  }]]) });
  assert.equal(claimed.action, 'blocked'); assert.equal(claimed.proposedPayment, null);
  const unrelated = payment('AROVERPAYMENTPAYMENT', 'AROVERPAYMENT', 'Overpayment', 'OverpaymentID', uuid(9010), 7, true);
  unrelated.Amount = 999; unrelated.Date = '2025-01-01'; unrelated.Reference = 'other'; unrelated.Account.AccountID = uuid(9011);
  const clean = selectXeroPaymentMatch({ payment: source, documentMapping: mapping, bankAccountId: bankId, xeroPayments: [unrelated] });
  assert.deepEqual(clean, { match: null, blockers: [] });
  for (const remove of ['Amount', 'Date', 'Account']) {
    const incomplete = structuredClone(unrelated);
    delete incomplete[remove];
    const held = selectXeroPaymentMatch({ payment: source, documentMapping: mapping, bankAccountId: bankId,
      xeroPayments: [incomplete] });
    assert.equal(held.match, null);
    assert.match(held.blockers.join(' '), /incomplete amount, date or bank evidence/, remove);
  }
  const malformed = { ...refund, PaymentType: 'UNKNOWN', Invoice: { ...refund.Invoice, InvoiceID: invoiceId } };
  assert.equal(selectXeroPaymentMatch({ payment: source, documentMapping: mapping, bankAccountId: bankId, xeroPayments: [malformed] }).match, null);
});

test('ordinary payments with different currency, Contact or missing status cannot link or authorize replacement', () => {
  const source = { Id: 'a01000000000001AAA', Name: 'PAY-1', Amount__c: 100, Date__c: '2026-02-02',
    CurrencyIsoCode: 'USD' };
  const mapping = { xero_document_id: invoiceId, xero_document_type: 'ACCREC', xero_contact_id: contactId };
  const base = ordinary();
  for (const changed of [
    { Invoice: { ...base.Invoice, CurrencyCode: 'HKD' } },
    { Invoice: { ...base.Invoice, Contact: { ContactID: uuid(9012) } } },
    { Status: undefined }, { Status: 'DELETED' },
  ]) {
    const match = selectXeroPaymentMatch({ payment: source, documentMapping: mapping, bankAccountId: bankId,
      xeroPayments: [{ ...base, ...changed }] });
    assert.equal(match.match, null);
    assert.ok(match.blockers.length);
  }
});

test('partial ordinary evidence, case aliases and duplicate PaymentIDs cannot fall through to a new payment', () => {
  const source = { Id: 'a01000000000001AAA', Name: 'PAY-1', Amount__c: 100, Date__c: '2026-02-02', CurrencyIsoCode: 'USD' };
  const mapping = { xero_document_id: invoiceId, xero_document_type: 'ACCPAY', xero_contact_id: contactId };
  const full = payment('ACCPAYPAYMENT', 'ACCPAY', 'Invoice', 'InvoiceID', invoiceId);
  const partial = { PaymentID: uuid(700), PaymentType: 'ACCPAYPAYMENT', Amount: 100, Account: { AccountID: bankId } };
  const check = xeroPayments => selectXeroPaymentMatch({ payment: source, documentMapping: mapping,
    bankAccountId: bankId, xeroPayments });
  assert.equal(check([partial]).match, null);
  assert.ok(check([partial]).blockers.length);
  const mixedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const aliased = payment('ACCPAYPAYMENT', 'ACCPAY', 'Invoice', 'InvoiceID', mixedId.toUpperCase());
  const aliasMatch = selectXeroPaymentMatch({ payment: source,
    documentMapping: { ...mapping, xero_document_id: mixedId }, bankAccountId: bankId, xeroPayments: [aliased] });
  assert.equal(aliasMatch.match, null);
  assert.match(aliasMatch.blockers.join(' '), /conflicting type, Contact or currency/);
  const sameIdRefund = payment('AROVERPAYMENTPAYMENT', 'AROVERPAYMENT', 'Overpayment', 'OverpaymentID', uuid(701), 1, true);
  assert.equal(check([full, sameIdRefund]).match, null);
  assert.match(check([full, sameIdRefund]).blockers.join(' '), /PaymentID appears more than once/);
  assert.equal(check([full, { ...full, PaymentID: full.PaymentID.toUpperCase() }]).match, null);
});

test('stored ordinary links still inspect the full raw inventory for refund overlap', () => {
  const source = { Id: 'a01000000000001AAA', Name: 'PAY-1', Amount__c: 100, Date__c: '2026-02-02',
    CurrencyIsoCode: 'USD', Bank__c: 'UBS', STEM__c: 'a0H000000000001AAA', Account__c: '001000000000001AAA',
    Supplier_Invoice__c: 'a06000000000001AAA', RecordType: { DeveloperName: 'Payable' } };
  const mapping = { id: 'map', salesforce_object: 'Supplier_Invoice__c', salesforce_id: source.Supplier_Invoice__c,
    xero_document_id: invoiceId, xero_document_type: 'ACCPAY', xero_contact_id: contactId,
    retained_differences: { stemId: source.STEM__c, accountId: source.Account__c } };
  const document = { id: invoiceId, type: 'ACCPAY', status: 'AUTHORISED', contactId, currency: 'USD', amountDue: 200 };
  const full = payment('ACCPAYPAYMENT', 'ACCPAY', 'Invoice', 'InvoiceID', invoiceId);
  const refund = payment('APOVERPAYMENTPAYMENT', 'APOVERPAYMENT', 'Overpayment', 'OverpaymentID', uuid(801), 2, true);
  refund.Reference = 'unrelated-reference';
  const context = { existingBySalesforce: new Map(), documentMappingById: new Map([[mapping.id, mapping]]),
    documentBySupplierInvoice: new Map([[source.Supplier_Invoice__c, mapping]]), buyerByStem: new Map(),
    bankByName: new Map([['UBS', { xero_bank_account_id: bankId }]]), xeroPayments: [full],
    currentDocumentById: new Map([[invoiceId, document]]), bankAccounts: new Map([[bankId, { CurrencyCode: 'USD' }]]),
    organisation: { baseCurrency: 'USD' } };
  const fingerprint = classifyXeroFinancialPayment(source, context).sourceFingerprint;
  const saved = { salesforce_payment_id: source.Id, document_mapping_id: mapping.id, xero_payment_id: full.PaymentID,
    xero_bank_account_id: bankId, source_fingerprint: fingerprint };
  const linked = classifyXeroFinancialPayment(source, { ...context,
    existingBySalesforce: new Map([[source.Id, saved]]), xeroPayments: [full, refund] });
  assert.equal(linked.action, 'blocked');
  assert.equal(linked.proposedPayment, null);
  assert.match(linked.blockers.join(' '), /held or incomplete/);
});

test('UUID case aliases cannot hide refund-bank overlap or another owner of an existing payment', () => {
  const source = { Id: 'a01000000000001AAA', Name: 'PAY-1', Amount__c: 100, Date__c: '2026-02-02',
    CurrencyIsoCode: 'USD', Bank__c: 'UBS', STEM__c: 'a0H000000000001AAA', Account__c: '001000000000001AAA',
    Supplier_Invoice__c: 'a06000000000001AAA', RecordType: { DeveloperName: 'Payable' } };
  const mapping = { salesforce_object: 'Supplier_Invoice__c', salesforce_id: source.Supplier_Invoice__c,
    xero_document_id: invoiceId, xero_document_type: 'ACCPAY', xero_contact_id: contactId,
    retained_differences: { stemId: source.STEM__c, accountId: source.Account__c } };
  const alphaBank = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const refund = payment('APOVERPAYMENTPAYMENT', 'APOVERPAYMENT', 'Overpayment', 'OverpaymentID', uuid(9100), 9101, true);
  refund.Account.AccountID = alphaBank.toUpperCase();
  refund.Reference = 'different-reference';
  const overlap = selectXeroPaymentMatch({ payment: source, documentMapping: mapping,
    bankAccountId: alphaBank, xeroPayments: [refund] });
  assert.equal(overlap.match, null);
  assert.match(overlap.blockers.join(' '), /held or incomplete/);

  const alphaPaymentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const actual = payment('ACCPAYPAYMENT', 'ACCPAY', 'Invoice', 'InvoiceID', invoiceId);
  actual.PaymentID = alphaPaymentId;
  actual.Account.AccountID = alphaBank;
  const priorOwner = [{ xero_payment_id: alphaPaymentId.toUpperCase(), salesforce_payment_id: 'different-source' }];
  const direct = selectXeroPaymentMatch({ payment: source, documentMapping: mapping,
    bankAccountId: alphaBank, xeroPayments: [actual], paymentMappings: priorOwner });
  assert.equal(direct.match, null);
  assert.match(direct.blockers.join(' '), /already linked to a different Salesforce payment/);

  actual.Reference = 'historical-bank-reference';
  actual.BankAmount = 100; actual.CurrencyRate = 1; actual.Account.CurrencyCode = 'USD';
  const retained = selectXeroReferenceRetentionMatch({ payment: source, documentMapping: mapping,
    currentDocument: { id: invoiceId, type: 'ACCPAY', status: 'PAID', contactId, currency: 'USD' },
    bankAccountId: alphaBank, bankAccount: { AccountID: alphaBank, Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'USD' },
    organisation: { baseCurrency: 'USD' }, xeroPayments: [actual], paymentMappings: priorOwner });
  assert.equal(retained.match, null);
  assert.match(retained.blockers.join(' '), /already linked to another Salesforce payment/);
});
