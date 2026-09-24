import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBuyerPaymentDocumentEvidence, buyerPaymentDocumentBlockers, enrichBuyerPaymentDocumentEvidence,
} from '../api/_xeroBuyerPaymentEvidence.js';

const id = (number) => `a01${String(number).padStart(12, '0')}`;
const stemId = id(1);
const accountId = id(20);
const invoice = (number = 2, changes = {}) => ({
  Id: id(number), Name: `INV-${number}`, CreatedDate: '2025-12-01T00:00:00.000Z',
  STEM__c: stemId, STEM__r: { Account__c: accountId }, Amount__c: 100,
  Invoice_Date__c: '2025-12-01', Invoice_Due_Date__c: '2026-01-01',
  Proforma__c: false, Deprecated__c: false, File__c: null,
  LastModifiedDate: '2026-09-01T00:00:00.000Z',
  _currency: { currency: 'USD', blockers: [] }, ...changes,
});
const payment = (changes = {}) => ({ Id: id(10), STEM__c: stemId, Account__c: accountId,
  CurrencyIsoCode: 'USD', RecordType: { DeveloperName: 'Receivable' }, ...changes });
const mapping = (changes = {}) => ({ salesforce_object: 'Invoice__c', salesforce_id: id(2),
  retained_differences: { accountId, stemId }, ...changes });
const proof = (docs = [invoice()], complete = true) => buildBuyerPaymentDocumentEvidence(stemId, docs, { complete });

test('one current buyer invoice proves identity, with every source field and a deterministic digest', () => {
  const current = proof();
  assert.equal(current.eligibleInvoiceId, id(2));
  assert.deepEqual(current.blockers, []);
  assert.equal(current.documents[0].file, null, 'file absence does not invalidate inventory proof');
  assert.equal(current.documents[0].created, '2025-12-01T00:00:00.000Z');
  assert.deepEqual(buyerPaymentDocumentBlockers({ ...payment(), _buyerDocumentEvidence: current }, mapping()), []);
  const reversed = proof([invoice(3, { Proforma__c: true }), invoice()]);
  const ordered = proof([invoice(), invoice(3, { Proforma__c: true })]);
  assert.equal(reversed.digest, ordered.digest);
  assert.equal(reversed.eligibleInvoiceId, id(2));
  assert.equal(reversed.documents.length, 2);
});

test('a second active positive invoice or credit blocks even when one invoice is durably mapped', () => {
  for (const extra of [invoice(3, { Amount__c: 50 }), invoice(3, { Amount__c: -20 })]) {
    const evidence = proof([invoice(), extra]);
    assert.equal(evidence.eligibleInvoiceId, null);
    assert.match(evidence.blockers.join(' '), /More than one current buyer invoice/i);
    assert.ok(buyerPaymentDocumentBlockers({ ...payment(), _buyerDocumentEvidence: evidence }, mapping()).length);
  }
  for (const amount of [0, -1, '1.005', Number.POSITIVE_INFINITY]) {
    const evidence = proof([invoice(2, { Amount__c: amount })]);
    assert.equal(evidence.eligibleInvoiceId, null);
    assert.match(evidence.blockers.join(' '), /amount/i);
  }
});

test('positive named and explicitly flagged credit notes cannot stand in for a buyer invoice', () => {
  const examples = [
    invoice(2, { Name: 'HK-CN-001', Amount__c: 100 }),
    ...['Is_Credit_Note__c', 'Credit_Note__c', 'CreditNote__c']
      .map((field) => invoice(2, { [field]: true, Amount__c: 100 })),
  ];
  for (const credit of examples) {
    const evidence = proof([credit]);
    assert.equal(evidence.eligibleInvoiceId, null);
    assert.match(evidence.blockers.join(' '), /credit note/i);
    assert.ok(buyerPaymentDocumentBlockers({ ...payment(), _buyerDocumentEvidence: evidence }, mapping()).length);
  }
  const withCredit = proof([invoice(), invoice(3, { Name: 'HK-CN-002', Amount__c: 25 })]);
  assert.equal(withCredit.eligibleInvoiceId, null);
  assert.match(withCredit.blockers.join(' '), /More than one current buyer invoice/i);
  assert.match(withCredit.blockers.join(' '), /credit note/i);
});

test('optional credit flags bind to the proof and malformed populated flags fail closed', () => {
  const initial = proof([invoice()]);
  for (const field of ['Is_Credit_Note__c', 'Credit_Note__c', 'CreditNote__c']) {
    const flagged = proof([invoice(2, { [field]: true })]);
    assert.notEqual(flagged.digest, initial.digest);
    assert.equal(flagged.documents[0].creditFlags[field], true);
    const unflagged = proof([invoice(2, { [field]: false })]);
    assert.notEqual(unflagged.digest, initial.digest);
    assert.deepEqual(buyerPaymentDocumentBlockers({ ...payment(), _buyerDocumentEvidence: unflagged }, mapping()), []);
    const malformed = proof([invoice(2, { [field]: 'true' })]);
    assert.equal(malformed.eligibleInvoiceId, null);
    assert.match(malformed.blockers.join(' '), /unknown credit-note flag/i);
  }
  const tampered = { ...initial, documents: [{ ...initial.documents[0], creditFlags: { ...initial.documents[0].creditFlags, CreditNote__c: true } }] };
  assert.match(buyerPaymentDocumentBlockers({ ...payment(), _buyerDocumentEvidence: tampered }, mapping()).join(' '), /evidence is incomplete or changed/i);
});

test('only explicit proforma or deprecated true excludes a document; unknown flags fail closed', () => {
  const excluded = proof([invoice(), invoice(3, { Proforma__c: true }), invoice(4, { Deprecated__c: true })]);
  assert.equal(excluded.eligibleInvoiceId, id(2));
  assert.equal(excluded.documents.length, 3);
  for (const change of [{ Proforma__c: null }, { Deprecated__c: undefined }, { Proforma__c: 'false' }]) {
    const evidence = proof([invoice(2, change)]);
    assert.equal(evidence.eligibleInvoiceId, null);
    assert.match(evidence.blockers.join(' '), /status/i);
  }
});

test('incomplete, duplicate, mixed STEM, missing Account and currency cannot establish an invoice', () => {
  const cases = [
    proof([], true), proof([invoice()], false), proof([invoice(), invoice()]),
    proof([invoice(), invoice(2, { Id: `${id(2)}AAA` })]),
    proof([invoice(2, { STEM__c: id(9) })]),
    proof([invoice(2, { STEM__r: { Account__c: null } })]),
    proof([invoice(2, { _currency: { currency: null, blockers: ['missing'] } })]),
  ];
  for (const evidence of cases) {
    assert.equal(evidence.eligibleInvoiceId, null);
    assert.ok(evidence.blockers.length);
  }
});

test('all material invoice changes including add/remove affect the inventory digest', () => {
  const initial = proof([invoice()]);
  const changes = [
    [invoice(2, { Amount__c: 101 })],
    [invoice(2, { Proforma__c: true })],
    [invoice(2, { STEM__r: { Account__c: id(21) } })],
    [invoice(3)],
    [invoice(), invoice(3, { Deprecated__c: true })],
    [],
  ];
  for (const docs of changes) assert.notEqual(proof(docs).digest, initial.digest);
  const changedFile = proof([invoice(2, { File__c: 'issued-source' })]);
  assert.notEqual(changedFile.digest, initial.digest);
  const changedDate = proof([invoice(2, { Invoice_Date__c: '2025-12-02' })]);
  assert.notEqual(changedDate.digest, initial.digest);
});

test('payment blockers verify evidence structure, source Account and currency, and exact mapping', () => {
  const current = proof();
  const attached = payment({ _buyerDocumentEvidence: current });
  assert.deepEqual(buyerPaymentDocumentBlockers(attached, mapping()), []);
  assert.deepEqual(buyerPaymentDocumentBlockers(attached, null), ['The Salesforce document is not durably linked to Xero. Run the document check again.']);
  assert.match(buyerPaymentDocumentBlockers(attached, mapping({ salesforce_id: id(3) })).join(' '), /exact Salesforce Invoice/i);
  assert.match(buyerPaymentDocumentBlockers(attached, mapping({ retained_differences: { accountId: id(21), stemId } })).join(' '), /verified matching Salesforce Account/i);
  assert.match(buyerPaymentDocumentBlockers(attached, mapping({ retained_differences: { accountId, stemId: id(9) } })).join(' '), /verified matching Salesforce STEM/i);
  assert.match(buyerPaymentDocumentBlockers({ ...attached, Account__c: id(21) }, mapping()).join(' '), /invoice Account differs/i);
  assert.match(buyerPaymentDocumentBlockers({ ...attached, CurrencyIsoCode: 'EUR' }, mapping()).join(' '), /invoice currency differs/i);
  assert.match(buyerPaymentDocumentBlockers({ ...attached, _buyerDocumentEvidence: { ...current, eligibleInvoiceId: id(3) } }, mapping()).join(' '), /evidence is incomplete or changed/i);
  assert.match(buyerPaymentDocumentBlockers({ ...attached, STEM__c: id(9) }, mapping()).join(' '), /evidence is incomplete or changed/i);
});

test('loader reads complete pre-period inventory once per STEM and preserves Payables', async () => {
  const payable = { Id: id(30), RecordType: { DeveloperName: 'Payable' } };
  const payableOnly = [payable];
  assert.equal(await enrichBuyerPaymentDocumentEvidence(payableOnly), payableOnly);
  let calls = 0;
  const querySalesforce = async (soql, options) => {
    calls += 1;
    assert.match(soql, /FROM Invoice__c WHERE STEM__c IN/);
    assert.doesNotMatch(soql, /2026-01-01|Proforma__c =|Deprecated__c =/);
    assert.match(soql, /File__c, LastModifiedDate, CurrencyIsoCode/);
    assert.deepEqual(options, { clean: true, limit: 100000 });
    return { records: [invoice()], totalSize: 1 };
  };
  const source = [payment(), payment({ Id: id(11) }), payable];
  const loaded = await enrichBuyerPaymentDocumentEvidence(source, {
    querySalesforce, currencyFields: ', CurrencyIsoCode', currencyForRecord: (row) => row._currency,
  });
  assert.equal(calls, 1);
  assert.equal(loaded[2], payable);
  assert.equal(source[0]._buyerDocumentEvidence, undefined);
  assert.equal(loaded[0]._buyerDocumentEvidence, loaded[1]._buyerDocumentEvidence);
  assert.deepEqual(buyerPaymentDocumentBlockers(loaded[0], mapping()), []);
});

test('loader blocks truncated, duplicate, wrong-scope, failed and currency-invalid reads', async () => {
  const cases = [
    { records: [invoice()], totalSize: 2 },
    { records: [invoice()], totalSize: 1, done: false },
    { records: [invoice(), invoice()], totalSize: 2 },
    { records: [invoice(2, { STEM__c: id(9) })], totalSize: 1 },
    { records: [], totalSize: 0, error: 'failed' },
  ];
  for (const result of cases) {
    const [loaded] = await enrichBuyerPaymentDocumentEvidence([payment()], {
      querySalesforce: async () => result, currencyForRecord: (row) => row._currency,
    });
    assert.equal(loaded._buyerDocumentEvidence.complete, false);
    assert.ok(buyerPaymentDocumentBlockers(loaded, mapping()).length);
  }
  const [currencyFailed] = await enrichBuyerPaymentDocumentEvidence([payment()], {
    querySalesforce: async () => ({ records: [invoice()], totalSize: 1 }),
    currencyForRecord: () => { throw new Error('resolver failed'); },
  });
  assert.equal(currencyFailed._buyerDocumentEvidence.eligibleInvoiceId, null);
  assert.match(currencyFailed._buyerDocumentEvidence.blockers.join(' '), /currency/i);
});

test('loader bounds each query to 200 STEMs and isolates incomplete batches', async () => {
  const payments = Array.from({ length: 201 }, (_, index) => payment({ Id: id(index + 1000), STEM__c: id(index + 2000) }));
  const counts = [];
  const loaded = await enrichBuyerPaymentDocumentEvidence(payments, {
    querySalesforce: async (soql) => {
      counts.push((soql.match(/'a01\d{12}'/g) || []).length);
      return counts.length === 1 ? { records: [], totalSize: 0 } : { records: [], totalSize: 1 };
    },
    currencyForRecord: (row) => row._currency,
  });
  assert.deepEqual(counts, [200, 1]);
  assert.equal(loaded[0]._buyerDocumentEvidence.complete, true);
  assert.equal(loaded.at(-1)._buyerDocumentEvidence.complete, false);
  assert.ok(loaded.every((row) => row._buyerDocumentEvidence.eligibleInvoiceId === null));
});
