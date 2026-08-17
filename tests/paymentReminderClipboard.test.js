import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentReminderCopyLine, paymentReminderCopyText } from '../src/lib/paymentReminderClipboard.js';

test('statement invoice copy uses the payment-reminder line format and appends currency-safe totals', () => {
  const line = paymentReminderCopyLine({
    stemName: 'HK2627294T - YUE DIAN 103 - HONG KONG',
    buyerName: 'Buyer A',
    amount: '$371,250.00',
    dueDate: '15 Sep 2026',
    status: 'Due Soon',
  });
  assert.equal(line, 'HK2627294T - YUE DIAN 103 - HONG KONG - BUYER A - $371,250.00 - DUE DATE 15 SEP 2026 - DUE SOON');
  assert.equal(paymentReminderCopyText([{ stemName: 'STEM 1', buyerName: 'Buyer A', amount: '$10.00', dueDate: '01 Sep 2026', status: 'Due Soon' }], ['Total invoice amount - $10.00']), 'STEM 1 - BUYER A - $10.00 - DUE DATE 01 SEP 2026 - DUE SOON\nTOTAL INVOICE AMOUNT - $10.00');
});

test('statement copy identifies a missing buyer invoice, preserves its expected due date, and omits urgency status', () => {
  assert.equal(
    paymentReminderCopyText([{
      stemName: 'HK2627001T',
      buyerName: 'Buyer A',
      amount: 'Invoice Not Issued',
      dueDate: '22 Sep 2026',
      dueDateLabel: 'Expected Due Date',
      status: null,
    }], ['Buyer invoice not issued - 1 STEM']),
    'HK2627001T - BUYER A - INVOICE NOT ISSUED - EXPECTED DUE DATE 22 SEP 2026\nBUYER INVOICE NOT ISSUED - 1 STEM',
  );
});
