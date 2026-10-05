import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardBuyerPaymentAnalysis } from '../api/_dashboardBuyerPaymentAnalysis.js';

const TODAY = '2026-09-20';
const id = (prefix, index) => `${prefix}${String(index).padStart(12, '0')}AAA`;
const BUYER = id('001', 1);

function fixture(index, { amount = 1000, due = '2026-09-15', created = '2026-09-01T00:00:00.000Z',
  account = BUYER, currency = 'USD', receipts = [{ date: '2026-09-10', amount }], balance,
  stem = {}, invoice = {}, payment = {} } = {}) {
  const stemId = id('a0H', index);
  return {
    stems: [{ Id: stemId, Name: `STEM ${index}`, Account__c: account, Account__r: { Name: 'Test Buyer' },
      CurrencyIsoCode: currency, CreatedDate: '2026-01-02T00:00:00Z', Delivery_Date__c: '2026-09-01',
      Total_Invoice_Amount__c: amount,
      QLIK_Receivable_Balance__c: balance ?? amount - receipts.reduce((sum, receipt) => sum + receipt.amount, 0),
      ...stem }],
    invoices: [{ Id: id('a0I', index), Name: `2026-INV-${index}`, STEM__c: stemId,
      CurrencyIsoCode: currency, Proforma__c: false, Deprecated__c: false,
      Amount__c: amount, Invoice_Due_Date__c: due, CreatedDate: created, ...invoice }],
    payments: receipts.map((receipt, position) => ({ Id: id('a0P', index * 100 + position),
      STEM__c: stemId, Account__c: account, CurrencyIsoCode: currency, RecordType: { DeveloperName: 'Receivable', Name: 'Receivable' },
      Amount__c: receipt.amount, Date__c: receipt.date, Supplier_Invoice__c: null,
      Is_Deposit__c: false, Is_Volume_Discount__c: false, Commission_Invoice__c: null, ...payment })),
  };
}

function combine(...datasets) {
  return Object.fromEntries(['stems', 'invoices', 'payments'].map((key) => [key, datasets.flatMap((dataset) => dataset[key])]));
}

const analyze = (dataset, options = {}) => buildDashboardBuyerPaymentAnalysis({ ...dataset, today: TODAY, ...options });

test('uses the receipt completing full settlement, with on-due and late settlements non-early', () => {
  const result = analyze(combine(
    fixture(1, { receipts: [{ date: '2026-09-05', amount: 900 }, { date: '2026-09-16', amount: 100 }] }),
    fixture(2, { receipts: [{ date: '2026-09-15', amount: 1000 }] }),
    fixture(3),
  ));
  assert.equal(result.buyers[0].invoiceCount, 3);
  assert.equal(result.buyers[0].earlyPaidCount, 1);
  assert.equal(result.buyers[0].earlyPaymentRate, 1 / 3);
  assert.equal(result.buyers[0].medianDaysPaidBeforeDue, 0);
  assert.equal(result.buyers[0].usuallyPaysEarly, false);
});

test('matured unpaid and partially paid invoices remain in the rate denominator', () => {
  const result = analyze(combine(
    fixture(1),
    fixture(2, { receipts: [], due: TODAY }),
    fixture(3, { receipts: [{ date: '2026-09-05', amount: 900 }] }),
  ));
  assert.equal(result.buyers[0].invoiceCount, 3);
  assert.equal(result.buyers[0].earlyPaidCount, 1);
  assert.equal(result.buyers[0].earlyPaymentRate, 1 / 3);
  assert.equal(result.buyers[0].medianDaysPaidBeforeDue, 5);
});

test('future-due unpaid invoices are censored while already settled invoices remain observed', () => {
  const result = analyze(combine(fixture(1, { due: '2026-09-30' }), fixture(2, { due: '2026-09-30', receipts: [] })));
  assert.equal(result.buyers[0].invoiceCount, 1);
  assert.equal(result.buyers[0].earlyPaidCount, 1);
  assert.equal(result.exclusions.future_due_unpaid_censored, 1);
});

test('requires at least seven creation lead days inclusively, independently of Invoice Date or sent date', () => {
  const result = analyze(combine(
    fixture(1, { created: '2026-09-08T00:00:00Z', invoice: { Invoice_Date__c: '2026-09-14', Sent__c: false } }),
    fixture(2, { created: '2026-09-09T00:00:00Z', invoice: { Invoice_Date__c: '2026-08-01' } }),
  ));
  assert.equal(result.buyers[0].invoiceCount, 1);
  assert.equal(result.buyers[0].medianCreationLeadDays, 7);
  assert.equal(result.exclusions.shorter_creation_lead, 1);
  assert.equal(result.methodology.creationDateField, 'Invoice__c.CreatedDate');
  assert.equal(result.methodology.causalClaim, false);
});

test('equal creation leads are eligible and usually requires three invoices and a strict majority', () => {
  const insufficient = analyze(combine(fixture(1), fixture(2)));
  assert.equal(insufficient.buyers[0].earlyPaymentRate, 1);
  assert.equal(insufficient.buyers[0].sampleStatus, 'insufficient');
  assert.equal(insufficient.buyers[0].usuallyPaysEarly, false);
  const majority = analyze(combine(fixture(1), fixture(2), fixture(3, { receipts: [] })));
  assert.equal(majority.buyers[0].usuallyPaysEarly, true);
  assert.equal(majority.buyers[0].medianCreationLeadDays, 14);
  const half = analyze(combine(fixture(1), fixture(2), fixture(3, { receipts: [] }), fixture(4, { receipts: [] })));
  assert.equal(half.buyers[0].earlyPaymentRate, 0.5);
  assert.equal(half.buyers[0].usuallyPaysEarly, false);
});

test('converts CreatedDate at Hong Kong midnight without truncating its UTC date', () => {
  const result = analyze(combine(
    fixture(1, { created: '2026-09-08T15:59:59Z' }),
    fixture(2, { created: '2026-09-08T16:00:00Z' }),
    fixture(3, { created: '2026-09-09T00:00:00+08:00' }),
  ));
  assert.equal(result.buyers[0].invoiceCount, 1);
  assert.equal(result.buyers[0].medianCreationLeadDays, 7);
  assert.equal(result.exclusions.shorter_creation_lead, 2);
});

test('excludes invoices fully prepaid before creation and retains the count separately', () => {
  const result = analyze(fixture(1, { receipts: [{ date: '2026-08-31', amount: 1000 }] }));
  assert.deepEqual(result.buyers, []);
  assert.equal(result.exclusions.prepaid_invoices, 1);
});

test('requires one current final invoice and holds credit notes including explicit flags', () => {
  const multi = fixture(1);
  multi.invoices.push({ ...multi.invoices[0], Id: id('a0I', 99), Name: '2026-INV-99' });
  assert.equal(analyze(multi).exclusions.multiple_active_invoices, 1);
  for (const credit of [{ Name: '2026-CN-1' }, { Is_Credit_Note__c: true }, { Credit_Note__c: true }, { Amount__c: -10 }]) {
    const dataset = fixture(1);
    dataset.invoices.push({ ...dataset.invoices[0], Id: id('a0I', 99), ...credit });
    assert.equal(analyze(dataset).exclusions.credit_note_or_adjustment, 1);
  }
  const history = fixture(1);
  history.invoices.push({ ...history.invoices[0], Id: id('a0I', 98), Proforma__c: true },
    { ...history.invoices[0], Id: id('a0I', 99), Deprecated__c: true });
  assert.equal(analyze(history).buyers[0].invoiceCount, 1);
});

test('does not infer active invoices or normal receipts from missing classification fields', () => {
  const dataset = fixture(1);
  delete dataset.invoices[0].Deprecated__c;
  assert.equal(analyze(dataset).exclusions.missing_invoice_classification, 1);
  const receipt = fixture(2);
  delete receipt.payments[0].Is_Deposit__c;
  assert.equal(analyze(receipt).exclusions.missing_payment_classification, 1);
  const commission = fixture(3, { payment: { Commission_Invoice__c: undefined } });
  assert.equal(analyze(commission).exclusions.missing_payment_classification, 1);
});

test('holds any negative buyer receipt even when reversed and when gross balance would reconcile', () => {
  const dataset = fixture(1, { receipts: [{ date: '2026-09-05', amount: 1200 }, { date: '2026-09-10', amount: -200 }] });
  dataset.payments[1].Payment_Status__c = 'Reversed';
  assert.equal(analyze(dataset).exclusions.negative_buyer_receipt, 1);
  assert.deepEqual(analyze(dataset).buyers, []);
});

test('void, cancellation, reversal and rejection evidence cannot count as settled payment', () => {
  for (const status of ['Void', 'Cancelled', 'Reversed', 'Rejected']) {
    const result = analyze(fixture(1, { payment: { Status__c: status } }));
    assert.deepEqual(result.buyers, []);
    assert.equal(result.exclusions.invalid_buyer_payment_status, 1);
  }
});

test('never counts remittances, write offs, bank charges, deposits or commission as cash settlement', () => {
  for (const payment of [
    { RecordType: { DeveloperName: 'Receivable_Remittance' } },
    { RecordType: { DeveloperName: 'Write_Off', Name: 'Write Off' } },
    { RecordType: { DeveloperName: 'Bank_Charge', Name: 'Bank Charge' } },
    { Is_Deposit__c: true }, { Is_Volume_Discount__c: true }, { Commission_Invoice__c: id('a0C', 1) },
    { Supplier_Invoice__c: id('a0S', 1) },
  ]) {
    const result = analyze(fixture(1, { payment }));
    assert.deepEqual(result.buyers, []);
    assert.equal(result.exclusions.receivable_balance_mismatch, 1);
  }
});

test('matches exact buyer and currency identity and keeps account currencies separate', () => {
  const result = analyze(combine(fixture(1), fixture(2, { currency: 'HKD' }),
    fixture(3, { account: id('001', 2) })));
  assert.equal(result.buyers.length, 3);
  const wrongBuyer = analyze(fixture(1, { payment: { Account__c: id('001', 2) } }));
  assert.equal(wrongBuyer.exclusions.buyer_identity_mismatch, 1);
  for (const fields of [{ CurrencyIsoCode: 'HKD' }, { CurrencyIsoCode: null }]) {
    const mismatch = analyze(fixture(1, { payment: fields }));
    assert.deepEqual(mismatch.buyers, []);
    assert.equal(mismatch.exclusions[fields.CurrencyIsoCode ? 'currency_mismatch' : 'missing_currency'], 1);
  }
  assert.equal(analyze(fixture(1, { invoice: { CurrencyIsoCode: null } })).exclusions.missing_currency, 1);
});

test('deduplicates identical 15 and 18 character IDs without counting receipts twice', () => {
  const dataset = fixture(1);
  for (const key of ['stems', 'invoices', 'payments']) dataset[key].push({ ...dataset[key][0], Id: dataset[key][0].Id.slice(0, 15) });
  const result = analyze(dataset);
  assert.equal(result.buyers[0].invoiceCount, 1);
  assert.equal(result.buyers[0].earlyPaidCount, 1);
  assert.equal(result.exclusions.duplicate_records, 3);
});

test('conflicting duplicate payments fail closed instead of choosing a favorable amount', () => {
  const dataset = fixture(1);
  dataset.payments.push({ ...dataset.payments[0], Amount__c: 1500 });
  const result = analyze(dataset);
  assert.deepEqual(result.buyers, []);
  assert.equal(result.exclusions.conflicting_payment_records, 1);
  assert.equal(result.exclusions.conflicting_source_evidence, 1);
});

test('reconciles invoice total and current receivable within one cent without trusting balance alone', () => {
  assert.equal(analyze(fixture(1, { stem: { Total_Invoice_Amount__c: 1000.01, QLIK_Receivable_Balance__c: 0.01 } })).buyers[0].earlyPaidCount, 1);
  assert.equal(analyze(fixture(1, { stem: { Total_Invoice_Amount__c: 1000.02 } })).exclusions.invoice_total_mismatch, 1);
  assert.equal(analyze(fixture(1, { stem: { QLIK_Receivable_Balance__c: 50 } })).exclusions.receivable_balance_mismatch, 1);
  assert.equal(analyze(fixture(1, { receipts: [], balance: 0 })).exclusions.receivable_balance_mismatch, 1);
  assert.equal(analyze(fixture(1, { stem: { QLIK_Receivable_Balance__c: ' ' } })).exclusions.missing_reconciliation_amounts, 1);
  assert.equal(analyze(fixture(1, { payment: { Amount__c: [] } })).exclusions.invalid_payment_amount, 1);
});

test('applies the 2026 reliable-history cutoff with delivery precedence and Hong Kong creation fallback', () => {
  assert.equal(analyze(fixture(1, { stem: { Delivery_Date__c: '2025-12-31', Expected_Delivery_Date__c: '2026-01-01' } })).exclusions.unreliable_payment_history, 1);
  assert.equal(analyze(fixture(1, { stem: { Delivery_Date__c: null, Expected_Delivery_Date__c: '2026-01-01' } })).buyers[0].invoiceCount, 1);
  assert.equal(analyze(fixture(1, { stem: { Delivery_Date__c: null, CreatedDate: '2025-12-31T16:00:00Z' } })).buyers[0].invoiceCount, 1);
  assert.equal(analyze(fixture(1, { stem: { Delivery_Date__c: null, CreatedDate: '2025-12-31T15:59:59Z' } })).exclusions.unreliable_payment_history, 1);
});

test('rejects missing and future receipt dates and invalid creation and due calendars', () => {
  for (const date of [null, '2026-02-30']) {
    assert.equal(analyze(fixture(1, { payment: { Date__c: date } })).exclusions.missing_or_invalid_payment_date, 1);
  }
  assert.equal(analyze(fixture(1, { payment: { Date__c: '2026-09-21' } })).exclusions.future_payment_date, 1);
  for (const invoice of [{ CreatedDate: '2026-09-01' }, { CreatedDate: '2026-02-30T00:00:00Z' },
    { Invoice_Due_Date__c: '2026-02-30' }]) {
    assert.equal(analyze(fixture(1, { invoice })).exclusions.missing_or_invalid_invoice_dates, 1);
  }
});

test('incomplete evidence suppresses all rankings and reports the failure explicitly', () => {
  const result = analyze(combine(fixture(1), fixture(2), fixture(3)), { complete: false });
  assert.equal(result.complete, false);
  assert.deepEqual(result.buyers, []);
  assert.equal(result.exclusions.incomplete_evidence, 1);
  assert.equal(analyze(fixture(1), { today: '2026-02-30' }).complete, false);
});

test('ranks qualifying buyers first without mutating source rows or source order', () => {
  const dataset = combine(fixture(1, { account: id('001', 2) }), fixture(2), fixture(3), fixture(4));
  const original = JSON.stringify(dataset);
  const result = analyze(dataset);
  assert.equal(result.buyers[0].accountId, BUYER);
  assert.equal(result.buyers[0].usuallyPaysEarly, true);
  assert.equal(result.buyers[1].sampleStatus, 'insufficient');
  assert.equal(JSON.stringify(dataset), original);
});
