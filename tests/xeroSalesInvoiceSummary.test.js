import assert from 'node:assert/strict';
import test from 'node:test';
import { salesInvoiceSummaryPayload, SALES_INVOICE_SUMMARY_POLICY } from '../api/_xeroSalesInvoiceSummary.js';

const line = (amount, changes = {}) => ({ Description: 'INVOICE 26/1/2026', Quantity: 1,
  UnitAmount: amount, AccountCode: '41100', TaxType: 'NONE', ...changes });
const payload = (lines) => ({ Type: 'ACCREC', Status: 'DRAFT', InvoiceNumber: '24721T-INV-1',
  Contact: { ContactID: 'contact-1' }, CurrencyCode: 'USD', Date: '2026-01-13', DueDate: '2026-02-12',
  Reference: 'GOLDEN AXIS', LineAmountTypes: 'NoTax', LineItems: lines });

test('summary includes both distinct barge charges and retains every header and original source line', () => {
  const original = payload([line(38718.14), line(170907.03), line(1500), line(1500)]);
  const snapshot = structuredClone(original);
  const result = salesInvoiceSummaryPayload(original, 212625.17);
  assert.equal(SALES_INVOICE_SUMMARY_POLICY, 'sales_invoice_summary_v1');
  assert.deepEqual(result.LineItems, [line(212625.17)]);
  assert.deepEqual(original, snapshot);
  assert.deepEqual({ ...result, LineItems: original.LineItems }, original);
});

test('decimal equality includes negative adjustments without floating-point addition drift', () => {
  assert.deepEqual(salesInvoiceSummaryPayload(payload([line(0.1), line(0.2)]), 0.3).LineItems, [line(0.3)]);
  assert.deepEqual(salesInvoiceSummaryPayload(payload([line(15), line(-5)]), 10).LineItems, [line(10)]);
});

test('physical quantities contribute their complete value while Xero summary quantity stays one', () => {
  const result = salesInvoiceSummaryPayload(payload([line(50, { Quantity: 2 }), line(20)]), 120);
  assert.equal(result.LineItems[0].Quantity, 1); assert.equal(result.LineItems[0].UnitAmount, 120);
});

test('different accounting or line evidence cannot be silently merged', () => {
  for (const changes of [{ AccountCode: '41101' }, { TaxType: 'OUTPUT' }, { Description: 'Other' },
    { Tracking: [] }, { DiscountRate: 10 }, { LineItemID: 'existing' }]) {
    assert.throws(() => salesInvoiceSummaryPayload(payload([line(100), line(20, changes)]), 120), { code: 'XERO_SALES_SUMMARY_INVALID' });
  }
});

test('missing values and inconsistent totals cannot become a valid summary', () => {
  for (const total of [null, undefined, '', NaN, 99.99]) {
    assert.throws(() => salesInvoiceSummaryPayload(payload([line(100)]), total), { code: 'XERO_SALES_SUMMARY_INVALID' });
  }
  assert.throws(() => salesInvoiceSummaryPayload(payload([]), 0), { code: 'XERO_SALES_SUMMARY_INVALID' });
  assert.throws(() => salesInvoiceSummaryPayload(payload([line(100, { Quantity: 0 })]), 0), { code: 'XERO_SALES_SUMMARY_INVALID' });
});

test('supplier bills, credits and existing sales records cannot enter new-sales projection', () => {
  for (const changes of [{ Type: 'ACCPAY' }, { Type: 'ACCRECCREDIT' }, { InvoiceID: 'existing' }]) {
    assert.throws(() => salesInvoiceSummaryPayload({ ...payload([line(100)]), ...changes }, 100), { code: 'XERO_SALES_SUMMARY_INVALID' });
  }
});
