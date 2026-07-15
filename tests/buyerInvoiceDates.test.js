import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatedBuyerPayTermDate, paymentTermDays } from '../api/_buyerInvoiceDates.js';

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

test('uses expected delivery fallback and rejects missing term data', () => {
  assert.equal(calculatedBuyerPayTermDate({
    Expected_Delivery_Date__c: '2026-08-01',
    Payment_Term__c: '15 calendar days',
  }), '2026-08-15');
  assert.equal(calculatedBuyerPayTermDate({ Delivery_Date__c: '2026-08-01' }), null);
  assert.equal(paymentTermDays('30.9 days'), 30);
});
