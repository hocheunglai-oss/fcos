import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paymentReminderCurrencyTotal, paymentReminderMoney } from '../api/_paymentReminderCurrency.js';
import { reminderAccountingTotal, reminderCurrency, reminderMoney, reminderTotals } from '../src/lib/paymentReminderDisplay.js';

test('reminder review labels every currency and never sums different native currencies', () => {
  const rows = [
    { currency: 'HKD', reminderCurrencyVerified: true, receivableBalance: 780, accountingReceivableUsd: 100 },
    { receivableBalance: 50 },
  ];
  assert.equal(reminderMoney(780, 'HKD'), 'HKD 780.00');
  assert.equal(reminderMoney(50), 'USD 50.00');
  assert.equal(reminderTotals(rows), 'HKD 780.00 / USD 50.00');
  assert.equal(reminderAccountingTotal(rows), 150);
  assert.equal(reminderAccountingTotal([{ currency: 'HKD', reminderCurrencyVerified: true, receivableBalance: 780 }]), null);
  assert.equal(reminderMoney(null), '-');
  assert.equal(reminderTotals([{ currency: 'EUR', receivableBalance: 1 }]), '-');
});

test('a raw HKD report row remains legacy USD until the reviewed marker is present', () => {
  const rawRow = { currency: 'HKD', invoiceAmount: 780, receivableBalance: 780 };
  assert.equal(reminderCurrency(rawRow), 'USD');
  assert.equal(reminderTotals([rawRow]), 'USD 780.00');
  assert.equal(reminderAccountingTotal([rawRow]), 780);
});

test('legacy USD preview labels are preserved while native and mixed totals are explicit', () => {
  assert.equal(reminderMoney(100, undefined, true), '$100.00');
  assert.equal(reminderMoney(780, 'HKD', true), 'HKD 780.00');
  assert.equal(reminderTotals([{ receivableBalance: 1234.5 }], true), '$1,234.50');
  assert.equal(reminderTotals([{ currency: 'HKD', reminderCurrencyVerified: true, receivableBalance: 780 }, { receivableBalance: 50 }], true), 'HKD 780.00 / USD 50.00');
});

test('template preview formatting matches the server currency formatter', () => {
  const rows = [
    { currency: 'HKD', reminderCurrencyVerified: true, receivableBalance: 780 },
    { currency: 'HKD', receivableBalance: 50 },
  ];
  const serverRows = rows.map((row) => ({ ...row, currency: reminderCurrency(row) }));
  assert.equal(reminderTotals(rows, true), paymentReminderCurrencyTotal(serverRows));
  assert.equal(reminderMoney(780, reminderCurrency(rows[0]), true), paymentReminderMoney(780, 'HKD'));
  assert.equal(reminderMoney(50, reminderCurrency(rows[1]), true), paymentReminderMoney(50, 'USD'));
});

test('candidate UI and template use native values and explicit accounting labels', () => {
  const source = readFileSync(new URL('../src/pages/BuyerInvoices.jsx', import.meta.url), 'utf8');
  const modal = source.slice(source.indexOf('function PaymentReminderModal('), source.indexOf('function PaymentReminderModal(') + 45000);
  assert.match(modal, /reminderMoney\(candidate\.receivableBalance, reminderCurrency\(candidate\)\)/);
  assert.match(modal, /reminderMoney\(candidate\.invoiceAmount, reminderCurrency\(candidate\)\)/);
  assert.match(modal, /Outstanding USD equivalent:.*candidate\.accountingReceivableUsd/);
  assert.match(modal, /totalReceivable: reminderTotals\(selectedRows, true\)/);
  assert.match(modal, /USD accounting equivalent:/);
});
