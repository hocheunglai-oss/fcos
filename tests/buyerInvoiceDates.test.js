import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatedBuyerPayTermDate, paymentTermDays, resolvedBuyerInvoiceDueDate } from '../api/_buyerInvoiceDates.js';

test('counts delivery date as day one for buyer payment terms', () => {
  assert.equal(calculatedBuyerPayTermDate({
    Delivery_Date__c: '2026-07-01',
    Payment_Term__c: '30 days',
  }), '2026-07-30');
  assert.equal(calculatedBuyerPayTermDate({
    Delivery_Date__c: '2026-07-31',
    Payment_Term__c: '1 day',
  }), '2026-07-31');
});

test('preserves zero-day terms and handles month boundaries', () => {
  assert.equal(calculatedBuyerPayTermDate({
    Delivery_Date__c: '2026-07-31',
    Payment_Term__c: '0 days',
  }), '2026-07-31');
  assert.equal(calculatedBuyerPayTermDate({
    Delivery_Date__c: '2026-07-15',
    Payment_Term__c: '30 days',
  }), '2026-08-13');
});

test('requires Delivery Date for numeric terms and rejects missing term data', () => {
  assert.equal(calculatedBuyerPayTermDate({
    Expected_Delivery_Date__c: '2026-08-01',
    Payment_Term__c: '15 calendar days',
  }), null);
  assert.equal(calculatedBuyerPayTermDate({ Delivery_Date__c: '2026-08-01' }), null);
  assert.equal(paymentTermDays('30.9 days'), 30);
});

test('uses the saved Salesforce date only when due date override is checked', () => {
  const stem = {
    Delivery_Date__c: '2026-08-28',
    Payment_Term__c: '30',
    Invoice_Due_Date__c: '2026-10-15',
  };
  assert.equal(resolvedBuyerInvoiceDueDate({ ...stem, Due_Date_Override__c: true }), '2026-10-15');
  assert.equal(resolvedBuyerInvoiceDueDate({ ...stem, Due_Date_Override__c: false }), '2026-09-26');
});

test('calculates CIA and suppresses automatic dates for known extra-cost-only STEMs', () => {
  assert.equal(resolvedBuyerInvoiceDueDate({
    Due_Date_Override__c: false,
    Payment_Term__c: 'CIA',
    Expected_Delivery_Date__c: '2027-01-01',
    Not_Cancelled_STEM_Line_Item_Quantity__c: 1,
  }), '2026-12-31');
  assert.equal(resolvedBuyerInvoiceDueDate({
    Due_Date_Override__c: false,
    Payment_Term__c: '30',
    Expected_Delivery_Date__c: '2026-08-28',
    Invoice_Due_Date__c: '2026-09-26',
    Not_Cancelled_STEM_Line_Item_Quantity__c: 0,
  }), null);
});

test('retains stored-date compatibility only when override metadata is absent', () => {
  assert.equal(resolvedBuyerInvoiceDueDate({ Invoice_Due_Date__c: '2026-09-26' }), '2026-09-26');
  assert.equal(resolvedBuyerInvoiceDueDate({ Due_Date_Override__c: false, Invoice_Due_Date__c: '2026-09-26' }), null);
  assert.equal(resolvedBuyerInvoiceDueDate({ Due_Date_Override__c: true }), null);
});
