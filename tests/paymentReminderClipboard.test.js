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
