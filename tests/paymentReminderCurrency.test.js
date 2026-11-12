import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadPaymentReminderCurrencies, paymentReminderCurrencyTotal, paymentReminderMoney, projectPaymentReminderCurrencies,
} from '../api/_paymentReminderCurrency.js';

const sfId = (prefix, index) => prefix + String(index).padStart(12, '0') + 'AAA';
const stemId = sfId('a01', 1);
const buyerId = sfId('001', 1);
const invoiceId = sfId('a02', 1);
const paymentId = sfId('a03', 1);
const sideId = sfId('a04', 1);
const originalFingerprint = 'a'.repeat(64);
const operation = index => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const isoDate = '2026-09-10T00:00:00Z';

function fixture() {
  return {
    rows: [{ stemId, buyerAccountId: buyerId, invoiceAmount: 1000, receivableBalance: 500, currency: 'USD', paymentReminderEligible: true }],
    invoices: [{
      Id: invoiceId, Name: 'N1', STEM__c: stemId, STEM__r: { Account__c: buyerId }, Amount__c: 1000, File__c: 'issued-original',
      Invoice_Date__c: '2026-09-01', Invoice_Due_Date__c: '2026-09-10', LastModifiedDate: isoDate, Deprecated__c: false, Proforma__c: false,
      Original_Invoice__c: null, Reissue_Of_Invoice__c: null, Final_Of_Proforma__c: null, Document_Currency__c: 'HKD',
      Document_HKD_Amount__c: 7800, Document_FX_Fingerprint__c: originalFingerprint, Document_FX_Side__c: sideId,
      Document_FX_Rate__c: 7.8, Document_FX_Revision__c: 'invoice-rate', Document_FX_Confirmed_At__c: '2026-09-01T00:00:00Z',
    }],
    payments: [{
      Id: paymentId, STEM__c: stemId, Account__c: buyerId, Bank__c: 'DBS', Supplier_Invoice__c: null, Buyer_Invoice__c: invoiceId,
      RecordType: { DeveloperName: 'Receivable' }, Cash_Event__c: null, Bank_Currency__c: 'HKD', Bank_Native_Amount__c: 3900,
      Bank_FX_Evidence__c: 'private-bank-reference', Payment_Operation_Id__c: operation(1), Payment_Request_Fingerprint__c: originalFingerprint,
      Amount__c: 487.5, Date__c: '2026-09-10', CreatedDate: isoDate, LastModifiedDate: isoDate, Payment_Currency__c: 'HKD',
      Payment_HKD_Amount__c: 3900, Invoice_Carrying_USD__c: 500, Settlement_FX_USD__c: -12.5, Payment_FX_Rate__c: 8,
      Payment_FX_Revision__c: 'payment-rate', Payment_FX_Effective_At__c: isoDate,
    }],
    ledger: { events: [], allocations: [] },
  };
}

function project(f) {
  return projectPaymentReminderCurrencies(f.rows, f.invoices, f.payments, f.ledger)[0];
}

function complete(records) {
  return { records, totalSize: records.length, done: true };
}

function describeFields(record) {
  return Object.keys(record).filter(name => !name.endsWith('__r') && name !== 'RecordType');
}

function stubRequest(f, { visible = 'native', catalog = 'legacy', paths = [] } = {}) {
  const fields = object => describeFields(object === 'Invoice__c' ? f.invoices[0] : f.payments[0]);
  const legacyFields = ['Id', 'STEM__c', 'Amount__c'];
  return async (path, options) => {
    assert.equal(options.readOnly, true);
    paths.push(path);
    const object = path.includes('Invoice__c') ? 'Invoice__c' : 'Payment__c';
    if (path.startsWith('/tooling/query/')) {
      if (catalog === 'unavailable') throw new Error('Tooling access denied');
      const names = catalog === 'native' ? fields(object) : legacyFields;
      return complete(names.map(name => ({ QualifiedApiName: name })));
    }
    assert.match(path, /^\/sobjects\/(Invoice__c|Payment__c)\/describe\/$/);
    const names = visible === 'native' || (visible === 'partial' && object === 'Invoice__c') ? fields(object) : legacyFields;
    return { name: object, queryable: true, fields: names.map(name => ({ name })) };
  };
}

function stubQuery(f, queries) {
  return async (sql, options) => {
    assert.deepEqual(options, { clean: true, limit: 100000 });
    queries.push(sql);
    if (/FROM Invoice__c/.test(sql)) return complete(f.invoices);
    if (/FROM Payment__c/.test(sql)) return complete(f.payments);
    if (/FROM Trade_Cash_Event__c/.test(sql)) return complete(f.ledger.events);
    assert.match(sql, /FROM Trade_Cash_Allocation__c/);
    return complete(f.ledger.allocations);
  };
}

test('HKD reminders use native payment allocations and retain separate accounting evidence', () => {
  const f = fixture();
  const row = project(f);
  assert.equal(row.paymentReminderEligible, true, row.paymentReminderBlockingReason);
  assert.equal(row.currency, 'HKD');
  assert.equal(row.invoiceAmount, 7800);
  assert.equal(row.receivableBalance, 3900);
  assert.equal(row.accountingInvoiceUsd, 1000);
  assert.equal(row.accountingReceivableUsd, 500);
  assert.equal(row.nativeCurrencyEvidence.payments[0].Bank_FX_Evidence__c, 'private-bank-reference');
  const original = JSON.stringify(row.nativeCurrencyEvidence);
  f.payments[0].Bank_FX_Evidence__c = 'changed-private-bank-reference';
  assert.notEqual(JSON.stringify(project(f).nativeCurrencyEvidence), original);
});

test('generic USD credit and buyer invoice links retain their legacy reminder and evidence shape', async () => {
  const f = fixture();
  for (const name of describeFields(f.invoices[0]).filter(name => name.startsWith('Document_'))) f.invoices[0][name] = null;
  Object.assign(f.invoices[0], { Document_Currency__c: 'USD' });
  f.invoices.push({ ...f.invoices[0], Id: sfId('a02', 2), Amount__c: -100, Original_Invoice__c: invoiceId });
  for (const name of describeFields(f.payments[0]).filter(name =>
    name.startsWith('Payment_') || name.startsWith('Bank_') || ['Invoice_Carrying_USD__c', 'Settlement_FX_USD__c'].includes(name)
  )) f.payments[0][name] = null;
  f.payments[0].Payment_Currency__c = 'USD';
  assert.equal(f.payments[0].Buyer_Invoice__c, invoiceId);
  assert.equal(project(f), f.rows[0]);
  f.rows[0].buyerAccountId = null;
  f.invoices = f.invoices.map(invoice => ({ ...invoice, STEM__r: { Account__c: null } }));
  const rows = await loadPaymentReminderCurrencies(f.rows, { query: stubQuery(f, []), request: stubRequest(f) });
  assert.equal(rows[0], f.rows[0]);
});

test('partial native metadata, changed buyer, and incomplete balances block sends', () => {
  for (const mutate of [
    f => { f.invoices[0].Document_FX_Side__c = null; },
    f => { f.invoices[0].Document_FX_Fingerprint__c = null; },
    f => { f.invoices[0].Document_Currency__c = null; },
    f => { f.invoices[0].Amount__c = 999.99; },
    f => { f.invoices[0].File__c = null; },
    f => { f.rows[0].buyerAccountId = null; },
    f => { f.payments[0].Buyer_Invoice__c = null; },
    f => { f.payments[0].Account__c = sfId('001', 2); },
    f => { f.payments[0].Payment_FX_Effective_At__c = '2026-09-10T16:00:00Z'; },
    f => { f.payments[0].Amount__c += 0.01; f.payments[0].Settlement_FX_USD__c += 0.01; },
    f => { f.payments[0].Invoice_Carrying_USD__c = null; },
    f => { f.payments[0].Payment_HKD_Amount__c = 3900.001; },
    f => { f.rows[0].invoiceAmount = 1000.01; },
    f => { f.rows[0].receivableBalance = 500.01; },
  ]) {
    const f = fixture();
    mutate(f);
    const row = project(f);
    assert.equal(row.paymentReminderEligible, false, mutate.toString());
    assert.ok(row.paymentReminderBlockingReason);
  }
});

test('HKD principal carrying is prorated from stored invoice values', () => {
  const f = fixture();
  Object.assign(f.rows[0], { invoiceAmount: 0.02, receivableBalance: 0.01 });
  Object.assign(f.invoices[0], { Amount__c: 0.02, Document_HKD_Amount__c: 0.12 });
  Object.assign(f.payments[0], {
    Amount__c: 0, Payment_HKD_Amount__c: 0.03, Invoice_Carrying_USD__c: 0.01, Settlement_FX_USD__c: -0.01,
    Bank_Native_Amount__c: 0.03,
  });
  const row = project(f);
  assert.equal(row.paymentReminderEligible, true, row.paymentReminderBlockingReason);
  assert.equal(row.receivableBalance, 0.09);
  f.payments[0].Invoice_Carrying_USD__c = 0;
  f.payments[0].Settlement_FX_USD__c = 0;
  f.rows[0].receivableBalance = 0.02;
  assert.match(project(f).paymentReminderBlockingReason, /original invoice settlement basis/);
});

test('a final HKD allocation uses the exact remaining carrying after earlier rounding', () => {
  const f = fixture();
  Object.assign(f.rows[0], { invoiceAmount: 1000.02, receivableBalance: 1000 });
  f.invoices.push({ ...f.invoices[0], Id: sfId('a02', 2) });
  Object.assign(f.invoices[0], { Amount__c: 0.02, Document_HKD_Amount__c: 0.13 });
  Object.assign(f.payments[0], {
    Amount__c: 0.01, Payment_HKD_Amount__c: 0.04, Bank_Native_Amount__c: 0.04,
    Invoice_Carrying_USD__c: 0.01, Settlement_FX_USD__c: 0,
  });
  f.payments.push({
    ...f.payments[0], Id: sfId('a03', 2), Payment_Operation_Id__c: operation(2), CreatedDate: '2026-09-10T00:01:00Z',
  });
  f.payments.push({
    ...f.payments[0], Id: sfId('a03', 3), Payment_Operation_Id__c: operation(3), CreatedDate: '2026-09-10T00:02:00Z',
    Payment_HKD_Amount__c: 0.05, Bank_Native_Amount__c: 0.05, Invoice_Carrying_USD__c: 0, Settlement_FX_USD__c: 0.01,
  });
  const row = project(f);
  assert.equal(row.paymentReminderEligible, true, row.paymentReminderBlockingReason);
  assert.equal(row.receivableBalance, 7800);
});

test('direct managed payments require exact bank and operation evidence', () => {
  for (const field of ['Bank__c', 'Bank_FX_Evidence__c', 'Payment_Operation_Id__c', 'Payment_Request_Fingerprint__c']) {
    const f = fixture();
    f.payments[0][field] = null;
    assert.match(project(f).paymentReminderBlockingReason, /recorded bank and operation evidence/);
  }
  const f = fixture();
  f.payments[0].Bank_Native_Amount__c -= 0.01;
  assert.match(project(f).paymentReminderBlockingReason, /same-currency payment magnitude/);
  f.payments[0].Bank_Currency__c = 'USD';
  f.payments[0].Bank_Native_Amount__c = 492;
  assert.equal(project(f).paymentReminderEligible, true);
});

test('a single native cent stays distinct from rounded USD carrying', () => {
  const f = fixture();
  f.payments = [];
  Object.assign(f.rows[0], { invoiceAmount: 0, receivableBalance: 0 });
  Object.assign(f.invoices[0], { Amount__c: 0, Document_HKD_Amount__c: 0.01 });
  const row = project(f);
  assert.equal(row.paymentReminderEligible, true, row.paymentReminderBlockingReason);
  assert.equal(row.receivableBalance, 0.01);
  assert.equal(row.accountingReceivableUsd, 0);
});

test('a fully reversed and refunded HKD history permits an exact USD reissue only', () => {
  const f = fixture();
  const original = f.invoices[0];
  const creditId = sfId('a02', 2);
  const reissueId = sfId('a02', 3);
  const credit = {
    ...original, Id: creditId, Original_Invoice__c: invoiceId, Amount__c: -1000, Document_HKD_Amount__c: -7800, File__c: 'issued-credit',
  };
  const reissue = {
    ...original, Id: reissueId, Reissue_Of_Invoice__c: invoiceId, Amount__c: 1200, Document_Currency__c: 'USD', File__c: 'issued-reissue',
    Document_HKD_Amount__c: null, Document_FX_Rate__c: null, Document_FX_Revision__c: null,
  };
  f.invoices.push(credit, reissue);
  Object.assign(f.rows[0], { invoiceAmount: 1200, receivableBalance: 700 });
  assert.equal(project(f).paymentReminderEligible, false);
  f.payments.push({
    ...f.payments[0], Id: sfId('a03', 2), Buyer_Invoice__c: creditId, Amount__c: -487.5,
    Payment_HKD_Amount__c: -3900, Invoice_Carrying_USD__c: -500, Settlement_FX_USD__c: 12.5,
  });
  f.rows[0].receivableBalance = 1200;
  const row = project(f);
  assert.equal(row.paymentReminderEligible, true, row.paymentReminderBlockingReason);
  assert.equal(row.currency, 'USD');
  assert.equal(row.receivableBalance, 1200);
  assert.equal(row.nativeCurrencyEvidence.invoices.length, 3);
  credit.Document_HKD_Amount__c += 0.01;
  assert.equal(project(f).paymentReminderEligible, false);
});

test('two outstanding currencies on one STEM cannot be combined into a reminder', () => {
  const f = fixture();
  f.invoices.push({
    ...f.invoices[0], Id: sfId('a02', 2), Amount__c: 50, Document_Currency__c: 'USD', Document_HKD_Amount__c: null,
    Document_FX_Fingerprint__c: null, Document_FX_Side__c: null, Document_FX_Confirmed_At__c: null,
    Document_FX_Rate__c: null, Document_FX_Revision__c: null,
  });
  Object.assign(f.rows[0], { invoiceAmount: 1050, receivableBalance: 550 });
  assert.match(project(f).paymentReminderBlockingReason, /outstanding balances in each currency/);
});

test('unallocated customer cash blocks the reminder and allocated cash requires its immutable bridge', () => {
  const f = fixture();
  const event = {
    Id: sfId('a05', 1), STEM__c: stemId, Party__c: buyerId, Direction__c: 'Sell', Currency__c: 'HKD', Kind__c: 'Payment',
    Cash_HKD_Amount__c: 3900, Cash_USD_Amount__c: 487.5, FX_Rate__c: 8, FX_Revision__c: 'payment-rate', FX_Effective_At__c: isoDate,
    Payment_Date__c: '2026-09-10', Bank__c: 'DBS', Bank_Currency__c: 'HKD', Bank_Native_Amount__c: 3900,
    Bank_Evidence__c: 'private-bank-reference', Trade_FX_Side__c: sideId, Settlement_FX_USD__c: 0,
    Operation_Id__c: operation(2), Request_Fingerprint__c: originalFingerprint,
  };
  f.ledger.events.push(event);
  const payment = f.payments.pop();
  f.rows[0].receivableBalance = 1000;
  assert.match(project(f).paymentReminderBlockingReason, /Allocate the available customer cash/);

  f.rows[0].receivableBalance = 500;
  f.payments.push({ ...payment, Cash_Event__c: event.Id });
  assert.match(project(f).paymentReminderBlockingReason, /missing its immutable application/);
  f.ledger.allocations.push({
    Id: sfId('a06', 1), Cash_Event__c: event.Id, Buyer_Invoice__c: invoiceId, Payment__c: paymentId,
    Currency__c: 'HKD', Kind__c: 'Applied', Allocated_HKD__c: 3900, Allocated_Cash_USD__c: 487.5, Invoice_Carrying_USD__c: 500,
    Bank_Native_Allocation__c: 3900, Settlement_FX_USD__c: -12.5, Operation_Id__c: operation(1), Request_Fingerprint__c: originalFingerprint,
  });
  const row = project(f);
  assert.equal(row.paymentReminderEligible, true, row.paymentReminderBlockingReason);
  assert.equal(row.receivableBalance, 3900);
  assert.equal(row.nativeCurrencyEvidence.cashAllocations.length, 1);
});

test('the loader confirms complete schema or confirmed absence and rejects hidden or partial fields', async () => {
  const f = fixture();
  const paths = [];
  const query = async () => assert.fail('Legacy fallback must avoid native data queries');
  const legacy = await loadPaymentReminderCurrencies(f.rows, { query, request: stubRequest(f, { visible: 'legacy', paths }) });
  assert.equal(legacy, f.rows);
  assert.equal(paths.filter(path => path.startsWith('/tooling/query/')).length, 2);
  for (const config of [{ visible: 'partial' }, { visible: 'legacy', catalog: 'native' }, { visible: 'legacy', catalog: 'unavailable' }]) {
    await assert.rejects(loadPaymentReminderCurrencies(f.rows, { query, request: stubRequest(f, config) }), /schema could not be verified/);
  }
  await assert.rejects(loadPaymentReminderCurrencies(f.rows, { query, request: async () => ({ fields: [] }) }), /schema could not be verified/);
  await assert.rejects(loadPaymentReminderCurrencies([{ stemId: "bad' query" }], { query, request: query }), /valid STEM/);
});

test('native reads are scoped, batched, and require complete well-formed provider results', async () => {
  const f = fixture();
  const queries = [];
  const paths = [];
  const request = stubRequest(f, { paths });
  const query = stubQuery(f, queries);
  const rows = await loadPaymentReminderCurrencies(f.rows, { query, request });
  assert.equal(rows[0].receivableBalance, 3900);
  assert.equal(paths.length, 2);
  assert.equal(queries.length, 4);
  assert.ok(queries.every(sql => sql.includes(stemId)));

  const scopeQueries = [];
  const scopedRows = Array.from({ length: 101 }, (_, index) => ({ stemId: sfId('a01', index + 1) }));
  await loadPaymentReminderCurrencies(scopedRows, {
    request,
    query: async sql => {
      scopeQueries.push(sql);
      return complete([]);
    },
  });
  assert.equal(scopeQueries.length, 8);
  for (const object of ['Invoice__c', 'Payment__c', 'Trade_Cash_Event__c', 'Trade_Cash_Allocation__c']) {
    const queriesForObject = scopeQueries.filter(sql => sql.includes(`FROM ${object}`));
    assert.equal(queriesForObject.length, 2);
    assert.equal(queriesForObject[0].match(/a01\d{12}AAA/g).length, 100);
    assert.equal(queriesForObject[1].match(/a01\d{12}AAA/g).length, 1);
  }

  for (const badResult of [
    { records: f.invoices },
    { ...complete(f.invoices), totalSize: 2 },
    { ...complete(f.invoices), nextRecordsUrl: '/next-page' },
    complete([...f.invoices, ...f.invoices]),
    complete([{ ...f.invoices[0], STEM__c: sfId('a01', 2) }]),
    complete([{ ...f.invoices[0], Proforma__c: true }]),
    complete(f.invoices.map(({ Document_Currency__c, ...record }) => record)),
  ]) {
    await assert.rejects(loadPaymentReminderCurrencies(f.rows, {
      request, query: async (sql, options) => /FROM Invoice__c/.test(sql) ? badResult : query(sql, options),
    }), /evidence is incomplete/);
  }
});

test('render helpers retain legacy USD formatting and display totals per currency', () => {
  assert.equal(paymentReminderMoney(10), '$10.00');
  assert.equal(paymentReminderMoney(7800, 'HKD'), 'HKD 7,800.00');
  assert.equal(paymentReminderCurrencyTotal([{ receivableBalance: 1.004 }, { receivableBalance: 1.004 }]), '$2.01');
  assert.equal(paymentReminderCurrencyTotal([{ receivableBalance: 50 }, { currency: 'HKD', receivableBalance: 3900 }]), 'HKD 3,900.00 / USD 50.00');
});
