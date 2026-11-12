import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTradeCashLedger, validateTradeCashLedger } from '../api/_tradeCashLedger.js';

const operation = index => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const fingerprint = 'a'.repeat(64);
function fixture() {
  const event = { Id: 'cash', STEM__c: 'stem', Party__c: 'buyer', Direction__c: 'Sell', Currency__c: 'HKD', Kind__c: 'Payment',
    Cash_HKD_Amount__c: 780, Cash_USD_Amount__c: 97.5, FX_Rate__c: 8, FX_Revision__c: 'payment-rate', FX_Effective_At__c: '2026-09-09T16:00:00Z',
    Payment_Date__c: '2026-09-10', Bank__c: 'DBS', Bank_Currency__c: 'HKD', Bank_Native_Amount__c: 780, Bank_Evidence__c: 'statement-1',
    Trade_FX_Side__c: 'side', Settlement_FX_USD__c: 0, Operation_Id__c: operation(1), Request_Fingerprint__c: fingerprint };
  const invoice = { Id: 'invoice', STEM__c: 'stem', STEM__r: { Account__c: 'buyer' }, Document_Currency__c: 'HKD', Amount__c: 200,
    Document_HKD_Amount__c: 1560, Document_FX_Rate__c: 7.8, Document_FX_Revision__c: 'invoice-rate', Document_FX_Confirmed_At__c: '2026-09-01T00:00:00Z', File__c: 'issued-invoice' };
  return { events: [event], invoices: [invoice], allocations: [], payments: [] };
}
function apply(f, { id = 'a1', native = 780, cash = 97.5, carrying = 100, kind = 'Applied', reverses = null, op = 2 } = {}) {
  const event = f.events[0];
  const allocation = { Id: id, Cash_Event__c: event.Id, Buyer_Invoice__c: 'invoice', Supplier_Invoice__c: null, Payment__c: `p-${id}`,
    Currency__c: 'HKD', Kind__c: kind, Reverses_Allocation__c: reverses, Allocated_HKD__c: native, Allocated_Cash_USD__c: cash,
    Invoice_Carrying_USD__c: carrying, Bank_Native_Allocation__c: native, Settlement_FX_USD__c: cash - carrying,
    Operation_Id__c: operation(op), Request_Fingerprint__c: fingerprint };
  const payment = { Account__c: event.Party__c, RecordType: { DeveloperName: 'Receivable' }, Bank__c: event.Bank__c, Bank_Currency__c: event.Bank_Currency__c, Bank_Native_Amount__c: Math.abs(native), Bank_FX_Evidence__c: event.Bank_Evidence__c, Id: allocation.Payment__c, STEM__c: event.STEM__c, Buyer_Invoice__c: allocation.Buyer_Invoice__c, Supplier_Invoice__c: null, Cash_Event__c: event.Id,
    Amount__c: cash, Invoice_Carrying_USD__c: carrying, Payment_HKD_Amount__c: native, Payment_Currency__c: 'HKD', Settlement_FX_USD__c: cash - carrying,
    Payment_FX_Rate__c: event.FX_Rate__c, Payment_FX_Revision__c: event.FX_Revision__c, Payment_FX_Effective_At__c: event.FX_Effective_At__c,
    Date__c: event.Payment_Date__c, Payment_Operation_Id__c: allocation.Operation_Id__c, Payment_Request_Fingerprint__c: fingerprint };
  f.allocations.push(allocation); f.payments.push(payment); return allocation;
}
test('actual cash is independent of proforma plans and may remain on account', () => {
  const f = fixture(); const result = validateTradeCashLedger(f);
  assert.deepEqual(result.balances.get('cash'), { native: 78000, usd: 9750, bank: 78000 });
  assert.equal(result.paymentEvidence.size, 0);
});
test('partial applications preserve the original cash basis and invoice carrying basis separately', () => {
  const f = fixture(); apply(f, { native: 390, cash: 48.75, carrying: 50 });
  assert.deepEqual(validateTradeCashLedger(f).balances.get('cash'), { native: 39000, usd: 4875, bank: 39000 });
  apply(f, { id: 'a2', native: 390, cash: 48.75, carrying: 50, op: 3 });
  assert.deepEqual(validateTradeCashLedger(f).balances.get('cash'), { native: 0, usd: 0, bank: 0 });
});
test('application reversal restores cash without inventing another bank event', () => {
  const f = fixture(); apply(f); apply(f, { id: 'reverse', native: -780, cash: -97.5, carrying: -100, kind: 'Reversal', reverses: 'a1', op: 3 });
  const result = validateTradeCashLedger(f);
  assert.equal(f.events.length, 1); assert.equal(result.balances.get('cash').native, 78000);
  assert.equal(result.paymentEvidence.get('p-reverse').reversal, true);
});
test('refund uses its own payment-date rate and consumes original unallocated cash carrying', () => {
  const f = fixture(); const original = f.events[0];
  f.events.push({ ...original, Id: 'refund', Kind__c: 'Refund', Original_Cash_Event__c: original.Id, Cash_USD_Amount__c: 100,
    FX_Rate__c: 7.8, FX_Revision__c: 'refund-rate', Original_Carrying_USD__c: 97.5, Original_Bank_Allocation__c: 780,
    Settlement_FX_USD__c: -2.5, Operation_Id__c: operation(2) });
  assert.deepEqual(validateTradeCashLedger(f).balances.get('cash'), { native: 0, usd: 0, bank: 0 });
  f.events[1].Settlement_FX_USD__c = 0;
  assert.throws(() => validateTradeCashLedger(f), /Refund settlement FX/);
});
test('overapplication, proforma targets and unmatched payment bridges fail closed', () => {
  for (const mutate of [f => { apply(f, { native: 781 }); }, f => { apply(f); f.invoices[0].Proforma__c = true; },
    f => { apply(f); f.allocations = []; }, f => { apply(f); f.payments[0].Amount__c = 100; },
    f => { apply(f); f.events[0].Party__c = 'different-buyer'; }]) {
    const f = fixture(); mutate(f); assert.throws(() => validateTradeCashLedger(f), /Cash ledger reconciliation/);
  }
});
test('duplicate reversals and changed original rate or bank evidence are rejected', () => {
  const f = fixture(); apply(f);
  apply(f, { id: 'r1', native: -780, cash: -97.5, carrying: -100, kind: 'Reversal', reverses: 'a1', op: 3 });
  apply(f, { id: 'r2', native: -780, cash: -97.5, carrying: -100, kind: 'Reversal', reverses: 'a1', op: 4 });
  assert.throws(() => validateTradeCashLedger(f), /one unreversed application/);
  f.allocations.pop(); f.payments.pop(); f.events[0].FX_Rate__c = 7.8;
  assert.throws(() => validateTradeCashLedger(f), /Company-valued cash/);
});
test('ledger reads verify both provider counts and exact STEM scope before returning evidence', async () => {
  const stem = 'a00000000000001';
  const calls = [];
  const query = async (soql) => {
    calls.push(soql);
    if (soql.includes('FROM Trade_Cash_Event__c')) {
      return { records: [{ Id: 'cash', STEM__c: stem, Direction__c: 'Sell' }], totalSize: 1 };
    }
    return { records: [{ Id: 'allocation', Cash_Event__c: 'cash' }], totalSize: 1 };
  };
  assert.equal((await loadTradeCashLedger([stem, stem], query)).allocations.length, 1);
  assert.equal(calls.length, 2);
  for (const incomplete of [
    { records: [], totalSize: 1 }, { records: [], totalSize: 0, done: false },
    { records: [{ Id: 'cash', STEM__c: 'a00000000000002', Direction__c: 'Sell' }], totalSize: 1 },
  ]) {
    await assert.rejects(loadTradeCashLedger([stem], soql => soql.includes('FROM Trade_Cash_Event__c')
      ? incomplete : { records: [], totalSize: 0 }), /incomplete/);
  }
  await assert.rejects(loadTradeCashLedger([stem], soql => soql.includes('FROM Trade_Cash_Event__c')
    ? { records: [{ Id: 'cash', STEM__c: stem, Direction__c: 'Sell' }], totalSize: 1 }
    : { records: [{ Id: 'allocation', Cash_Event__c: 'unknown' }], totalSize: 1 }), /incomplete or inconsistent/);
});

test('ledger rejects a rate effective on the next Hong Kong day and missing buyer ownership', () => {
  const f = fixture();
  apply(f);
  f.events[0].FX_Effective_At__c = '2026-09-10T16:00:00Z';
  assert.throws(() => validateTradeCashLedger(f), /company-rate evidence/);
  f.events[0].FX_Effective_At__c = f.payments[0].Payment_FX_Effective_At__c;
  delete f.invoices[0].STEM__r;
  assert.throws(() => validateTradeCashLedger(f), /Invoice buyer/);
});
