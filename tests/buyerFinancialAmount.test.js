import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isFinalBuyerInvoice, resolveBuyerFinancialAmount } from '../api/_buyerFinancialAmount.js';

test('final buyer invoices remain authoritative over calculated child totals', () => {
  assert.deepEqual(resolveBuyerFinancialAmount({
    salesforceAmount: 100,
    calculatedAmount: 125,
    finalInvoiceIssued: true,
  }), {
    amount: 100,
    source: 'issued_invoice',
    calculatedAmount: 125,
  });
});

test('unissued buyer invoices use the calculated buyer-side amount even after delivery', () => {
  assert.deepEqual(resolveBuyerFinancialAmount({
    salesforceAmount: 0,
    calculatedAmount: 359_092.91,
    finalInvoiceIssued: false,
  }), {
    amount: 359_092.91,
    source: 'calculated_unissued',
    calculatedAmount: 359_092.91,
  });
});

test('proformas and credit notes do not make the final buyer invoice authoritative', () => {
  assert.equal(isFinalBuyerInvoice({ Name: '27315T-P-1', Proforma__c: true }), false);
  assert.equal(isFinalBuyerInvoice({ Name: '27315T-CN-1', Proforma__c: false }), false);
  assert.equal(isFinalBuyerInvoice({ Name: '27315T-INV-1', Proforma__c: false }), true);
  assert.equal(isFinalBuyerInvoice({ Name: '27315T-INV-1', Deprecated__c: true }), false);
});

test('Dashboard, P&L, disputes, and STEM detail no longer use Delivery Date as invoice evidence', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');

  assert.match(source, /resolveBuyerFinancialAmount/);
  assert.match(source, /FROM Invoice__c WHERE STEM__c/);
  assert.doesNotMatch(source, /!delivered\s*&&\s*calculatedBuyer/);
  assert.doesNotMatch(source, /!s\.Delivery_Date__c\s*&&\s*calculatedBuyer/);
  assert.doesNotMatch(source, /!stem\.Delivery_Date__c\s*&&\s*calculatedBuyerInvoice/);
  assert.doesNotMatch(source, /!recordRaw\.Delivery_Date__c\s*&&\s*calculatedUndatedBuyerInvoice/);
});
