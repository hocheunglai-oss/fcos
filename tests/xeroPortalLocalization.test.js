import assert from 'node:assert/strict';
import test from 'node:test';
import { xeroPortalUiCopy } from '../src/lib/xeroPortalUiCopy.js';

test('legacy Chinese preferences retain English labels for preview, explicit batch authorisation and draft creation', () => {
  const copy = xeroPortalUiCopy('zh-Hant');
  assert.equal(copy.header.refresh, 'Refresh');
  assert.equal(copy.header.connect, 'Connect Xero');
  assert.equal(copy.tabs.accounting, 'Salesforce → Xero');
  assert.equal(copy.contacts.preview, 'Preview');
  assert.equal(copy.contacts.applySelected, 'Apply selected');
  assert.equal(copy.financial.preview, 'Build read-only preview');
  assert.equal(copy.financial.authorise, 'Authorise batch');
  assert.equal(copy.financial.applyPayments, 'Apply exact payments');
  assert.equal(copy.receipts.createBill, 'Create Xero draft bill');
});
