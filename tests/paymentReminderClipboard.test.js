import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStatementInvoiceCopyPayload, accountStatementInvoiceCopyText, paymentReminderCopyLine, paymentReminderCopyText } from '../src/lib/paymentReminderClipboard.js';

test('statement invoice copy uses the payment-reminder line format and appends currency-safe totals', () => {
  const line = paymentReminderCopyLine({
    stemName: 'HK2627294T - YUE DIAN 103 - HONG KONG',
    buyerName: 'Buyer A',
    amount: '$371,250.00',
    dueDate: '15 Sep 2026',
    status: 'Due Soon',
  });
  assert.equal(line, 'HK2627294T - YUE DIAN 103 - HONG KONG - BUYER A - $371,250.00 - DUE DATE 15 SEP 2026 - DUE SOON');
  assert.equal(paymentReminderCopyText([{ stemName: 'STEM 1', buyerName: 'Buyer A', amount: '$10.00', dueDate: '01 Sep 2026', status: 'Due Soon' }], ['Total invoice amount - $10.00']), 'STEM 1 - BUYER A - $10.00 - DUE DATE 01 SEP 2026 - DUE SOON\n\nTOTAL INVOICE AMOUNT - $10.00');
});

test('statement copy groups Not Issued rows, marks maximum-quantity estimates, and combines totals', () => {
  assert.equal(
    accountStatementInvoiceCopyText([
      {
        stemName: 'HK2627001T',
        buyerName: 'Buyer A',
        invoiceIssued: false,
        amount: '$125.00',
        amountLabel: 'Expected Invoice Amount',
        amountSuffix: '(BASIS MAX QTY)',
        dueDate: '22 Sep 2026',
        dueDateLabel: 'Expected Due Date',
        status: null,
      },
      {
        stemName: 'HK2626999T',
        buyerName: 'Buyer A',
        invoiceIssued: true,
        amount: '$75.00',
        dueDate: '20 Sep 2026',
        status: 'Due Soon',
      },
    ], ['Total invoice amount - $200.00 (Expected)']),
    'HK2626999T - BUYER A - $75.00 - DUE DATE 20 SEP 2026 - DUE SOON\nHK2627001T - BUYER A - *EXPECTED INVOICE AMOUNT $125.00* (BASIS MAX QTY) - *EXPECTED DUE DATE 22 SEP 2026*\n\nTOTAL INVOICE AMOUNT - $200.00 (EXPECTED)',
  );
});

test('statement copy underlines expected fields in rich text and escapes contractual display values', () => {
  const payload = accountStatementInvoiceCopyPayload([{
    stemName: 'HK2627001T',
    buyerName: 'Buyer <A&B>',
    invoiceIssued: false,
    amount: '$125.00',
    amountSuffix: '(BASIS MAX QTY)',
    dueDate: '22 Sep 2026',
  }], ['Total invoice amount - $125.00 (Expected)']);

  assert.doesNotMatch(payload.text, /INVOICE NOT ISSUED/);
  assert.match(payload.text, /\*EXPECTED INVOICE AMOUNT \$125\.00\*/);
  assert.match(payload.text, /\*EXPECTED DUE DATE 22 SEP 2026\*/);
  assert.match(payload.html, /<span style="text-decoration:underline;">EXPECTED INVOICE AMOUNT \$125\.00<\/span> \(BASIS MAX QTY\)/);
  assert.match(payload.html, /<span style="text-decoration:underline;">EXPECTED DUE DATE 22 SEP 2026<\/span>/);
  assert.match(payload.html, /BUYER &lt;A&amp;B&gt;/);
  assert.doesNotMatch(payload.html, /INVOICE NOT ISSUED|<script/i);
});
