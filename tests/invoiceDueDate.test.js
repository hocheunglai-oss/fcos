import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addInvoiceCalendarDays,
  calculatedStemInvoiceDueDate,
  invoicePaymentTermDays,
  resolveBdnDeliveryDate,
} from '../force-app/main/default/lwc/fcbStemProcessing/invoiceDueDate.js';

test('counts the delivery date as day one for numeric buyer terms', () => {
  assert.equal(calculatedStemInvoiceDueDate({ paymentTerm: '2', deliveryDate: '2026-08-31' }), '2026-09-01');
  assert.equal(calculatedStemInvoiceDueDate({ paymentTerm: '30', deliveryDate: '2026-08-28' }), '2026-09-26');
  assert.equal(calculatedStemInvoiceDueDate({ paymentTerm: '60', deliveryDate: '2026-12-15' }), '2027-02-12');
  assert.equal(calculatedStemInvoiceDueDate({ paymentTerm: '75', deliveryDate: '2026-12-31' }), '2027-03-15');
});

test('calculates CIA from expected delivery and remains date-zone safe', () => {
  assert.equal(calculatedStemInvoiceDueDate({ paymentTerm: 'CIA', expectedDeliveryDate: '2027-01-01' }), '2026-12-31');
  assert.equal(addInvoiceCalendarDays('2028-03-01', -1), '2028-02-29');
});

test('requires a manual due date for extra-cost-only and incomplete cases', () => {
  assert.equal(calculatedStemInvoiceDueDate({ paymentTerm: '30', deliveryDate: '2026-08-28', extraCostOnly: true }), null);
  assert.equal(calculatedStemInvoiceDueDate({ paymentTerm: '30' }), null);
  assert.equal(calculatedStemInvoiceDueDate({ deliveryDate: '2026-08-28' }), null);
  assert.equal(calculatedStemInvoiceDueDate({ paymentTerm: 'CIA' }), null);
  assert.equal(invoicePaymentTermDays('CIA'), null);
});

test('defaults invoice delivery to one selected BDN date and exposes unsafe selections', () => {
  const oneBdn = resolveBdnDeliveryDate([{
    objectName: 'STEM_Line_Item__c',
    bdnDeliveryDate: '2026-08-29',
  }]);
  assert.deepEqual(oneBdn, { date: '2026-08-29', status: 'single', lineItemCount: 1 });
  assert.equal(calculatedStemInvoiceDueDate({ paymentTerm: '30', deliveryDate: oneBdn.date }), '2026-09-27');

  assert.equal(resolveBdnDeliveryDate([
    { objectName: 'STEM_Line_Item__c', bdnDeliveryDate: '2026-08-29' },
    { objectName: 'STEM_Line_Item__c', bdnDeliveryDate: '2026-08-30' },
  ]).status, 'multiple');
  assert.equal(resolveBdnDeliveryDate([
    { objectName: 'STEM_Line_Item__c', bdnDeliveryDate: null },
  ]).status, 'missing');
  assert.equal(resolveBdnDeliveryDate([
    { objectName: 'STEM_Extra_Cost__c', bdnDeliveryDate: null },
  ]).status, 'none');
});

test('STEM Processing preserves saved overrides and never forces them on', async () => {
  const source = await readFile(new URL('../force-app/main/default/lwc/fcbStemProcessing/fcbStemProcessing.js', import.meta.url), 'utf8');
  assert.match(source, /this\.dueDateOverride = Boolean\(this\.stem\.Due_Date_Override__c\.value\)/u);
  assert.match(source, /this\.invoiceDueDateValue = this\.dueDateOverride \? this\.stem\.Invoice_Due_Date__c\.value : null/u);
  assert.doesNotMatch(source, /this\.dueDateOverride = true/u);
  assert.match(source, /this\.invoiceDueDateValue = checked \? calculatedDate : null/u);
  assert.match(source, /this\.restoreCalculatedInvoiceDueDate\(\)/u);
  assert.match(source, /resolveBdnDeliveryDate\(this\.selectedProducts\)/u);
  assert.match(source, /selectedLineItemIds\.has\(stemLineItem\.Id\)/u);
});
