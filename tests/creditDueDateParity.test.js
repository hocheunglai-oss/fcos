import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStemCreditRelease, dashboardAccountCreditStatementInternals } from '../api/_dashboardAccountCreditStatement.js';
import { resolvedBuyerInvoiceDueDate } from '../api/_buyerInvoiceDates.js';

const today = '2026-09-01';
const base = { Id: 'a0H000000000001AAA', Delivery_Date__c: today, Payment_Term__c: '30', Due_Date_Override__c: false, Not_Cancelled_STEM_Line_Item_Quantity__c: 1, QLIK_Receivable_Balance__c: 100 };
const candidate = (stem, cashflows = [], invoices = []) => dashboardAccountCreditStatementInternals.contractualReleaseCandidate(stem, cashflows, today, invoices);

test('credit contractual dates share inclusive terms and ignore stale formulas when override is off', () => {
  for (const days of [2, 30, 60, 75]) {
    for (const delivery of ['2026-09-01', '2026-12-31']) {
      const stem = { ...base, Delivery_Date__c: delivery, Payment_Term__c: String(days), Invoice_Due_Date__c: '2027-08-01', QLIK_Invoice_Due_Date__c: '2027-01-01' };
      assert.equal(candidate(stem).date, resolvedBuyerInvoiceDueDate(stem));
    }
  }
  assert.equal(candidate(base).date, '2026-09-30');
});

test('checked overrides remain authoritative and missing override dates remain unavailable', () => {
  assert.equal(candidate({ ...base, Due_Date_Override__c: true, Invoice_Due_Date__c: '2026-10-20', QLIK_Invoice_Due_Date__c: '2026-09-30' }).date, '2026-10-20');
  assert.equal(candidate({ ...base, Due_Date_Override__c: true }).date, null);
});

test('CIA uses expected delivery minus one; numeric and extra-only missing bases are not fabricated', () => {
  assert.equal(candidate({ ...base, Payment_Term__c: 'CIA', Expected_Delivery_Date__c: '2026-10-01' }).date, '2026-09-30');
  for (const stem of [
    { ...base, Payment_Term__c: 'CIA' },
    { ...base, Payment_Term__c: '' },
    { ...base, Delivery_Date__c: null, Expected_Delivery_Date__c: '2026-10-01' },
    { ...base, Not_Cancelled_STEM_Line_Item_Quantity__c: 0 },
  ]) assert.equal(candidate(stem).date, null);
  assert.equal(candidate({ ...base, Not_Cancelled_STEM_Line_Item_Quantity__c: 0, Due_Date_Override__c: true, Invoice_Due_Date__c: '2026-10-12' }).date, '2026-10-12');
});

test('issued invoice and exact Cashflow due evidence keep precedence over STEM calculations', () => {
  const cashflows = [{ Id: 'a03000000000001AAA', Invoice_Due_Date__c: '2026-10-10' }];
  assert.equal(candidate(base, cashflows).date, '2026-10-10');
  assert.equal(candidate(base, cashflows, [{ Id: 'a04000000000001AAA', Invoice_Due_Date__c: '2026-10-12' }]).date, '2026-10-12');
  const result = buildStemCreditRelease({ stem: base, today, cashflows, buyerInvoices: [{ Id: 'a04000000000001AAA', Invoice_Due_Date__c: '2026-10-12' }] });
  assert.equal(result.releaseDate, '2026-10-12');
  assert.equal(result.releaseSource, 'buyer_invoice_due');
});

test('actual and scheduled payments still precede contractual forecast and release only remaining exposure', () => {
  const result = buildStemCreditRelease({ stem: base, today,
    payments: [{ Id: 'a05000000000001AAA', Date__c: '2026-09-02', Amount__c: 20 }],
    cashflows: [{ Id: 'a03000000000001AAA', Scheduled_Payment_Date__c: '2026-09-05', Scheduled_Payment_Amount__c: 30 }],
    buyerInvoices: [{ Id: 'a04000000000001AAA', Invoice_Due_Date__c: '2026-10-12' }],
  });
  assert.deepEqual(result.forecastEvents.map(({ date, amount }) => ({ date, amount })), [
    { date: '2026-09-02', amount: 20 }, { date: '2026-09-05', amount: 30 }, { date: '2026-10-12', amount: 50 },
  ]);
});

test('legacy payloads without override metadata retain stored-date compatibility', () => {
  assert.equal(candidate({ Invoice_Due_Date__c: '2026-09-20' }).date, '2026-09-20');
});
