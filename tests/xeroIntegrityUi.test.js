import assert from 'node:assert/strict';
import test from 'node:test';
import { amountText, differenceEntries, safeExternalUrl, statusLabel, statusTone, XERO_INTEGRITY_KINDS, XERO_INTEGRITY_STATUSES } from '../src/lib/xeroIntegrityUi.js';

test('integrity UI exposes only the backend status and record-type filters', () => {
  assert.deepEqual(XERO_INTEGRITY_STATUSES.map(([value]) => value), ['all', 'matched', 'missing', 'mismatched', 'blocked', 'uncertain', 'unverified']);
  assert.deepEqual(XERO_INTEGRITY_KINDS.map(([value]) => value), ['all', 'buyer_invoice', 'buyer_credit', 'supplier_bill', 'supplier_credit', 'contact', 'payment']);
});

test('integrity UI preserves unavailable monetary evidence rather than rendering a zero', () => {
  assert.equal(amountText(null, 'USD'), 'Not available');
  assert.equal(amountText(Number.NaN, 'USD'), 'Not available');
  assert.equal(amountText(0, 'USD'), 'USD 0.00');
});

test('integrity UI keeps only approved HTTPS Salesforce and Xero links', () => {
  assert.equal(safeExternalUrl('https://fratellicosulich.my.salesforce.com/001', 'salesforce'), 'https://fratellicosulich.my.salesforce.com/001');
  assert.equal(safeExternalUrl('https://go.xero.com/Contacts/View/1', 'xero'), 'https://go.xero.com/Contacts/View/1');
  assert.equal(safeExternalUrl('https://example.test/001', 'salesforce'), null);
  assert.equal(safeExternalUrl('javascript:alert(1)', 'xero'), null);
});

test('integrity UI renders field-level differences without serialising raw objects', () => {
  assert.deepEqual(differenceEntries([{ field: 'amount', source: 12, xero: 10 }]), [{ field: 'amount', source: '12.00', xero: '10.00' }]);
  assert.deepEqual(differenceEntries([{ field: 'reference', source: null, xero: { unsupported: true } }]), [{ field: 'reference', source: 'Not available', xero: 'Not available' }]);
});

test('integrity UI identifies correction outcomes without treating them as reconciliation status', () => {
  assert.equal(statusLabel('confirmed'), 'Confirmed');
  assert.equal(statusLabel('rejected'), 'Rejected');
  assert.equal(statusTone('confirmed'), 'emerald');
  assert.equal(statusTone('rejected'), 'rose');
});
