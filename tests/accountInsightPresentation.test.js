import assert from 'node:assert/strict';
import test from 'node:test';
import { accountInsightDirection, moveReportItem, nextInsightLoadSection, selectAccountInsightPresentation, selectedGroupAccountIds } from '../src/components/dashboard/accountInsightPresentation.js';

const buyer = { identity: { name: 'Buyer entity' }, kpis: { moneyByCurrency: [{ currency: 'USD', turnover: 100, grossProfit: 10 }] } };
const supplier = { identity: { name: 'Supplier entity' }, kpis: { moneyByCurrency: [{ currency: 'USD', turnover: 75, grossProfit: 7 }] } };
const both = {
  buyer,
  supplier,
  currentExposure: { byCurrency: [{ currency: 'USD', receivable: 44, outstandingPayable: 21, buyerReceivable: 44, supplierPayable: 21 }], sourceTimestamp: '2026-09-05' },
  groupScope: { selectable: true, availableAccounts: [{ accountId: '001A' }] },
};

test('Both presentation retains buyer and supplier legs separately with top-level current exposure', () => {
  const presentation = selectAccountInsightPresentation(both, 'both');
  assert.equal(presentation.isBoth, true);
  assert.equal(presentation.primary, buyer);
  assert.equal(presentation.buyer, buyer);
  assert.equal(presentation.supplier, supplier);
  assert.equal(presentation.currentExposure, both.currentExposure);
  assert.equal(presentation.currentExposure.byCurrency[0].buyerReceivable, 44);
  assert.equal(presentation.currentExposure.byCurrency[0].supplierPayable, 21);
  assert.notEqual(presentation.buyer, presentation.supplier);
  assert.equal('netExposure' in presentation.currentExposure, false);
});

test('supplier direction selects only the supplier detail leg while preserving the common scope', () => {
  const presentation = selectAccountInsightPresentation(both, 'supplier');
  assert.equal(presentation.primary, supplier);
  assert.equal(presentation.groupScope, both.groupScope);
  assert.equal(accountInsightDirection({ role: 'group' }), 'buyer');
  assert.equal(accountInsightDirection({ role: 'both' }), 'both');
  assert.equal(accountInsightDirection({ role: 'supplier' }), 'supplier');
});

test('report ordering controls reorder only selected IDs and preserve boundaries', () => {
  assert.deepEqual(moveReportItem(['profile', 'trading', 'stems'], 'trading', -1), ['trading', 'profile', 'stems']);
  assert.deepEqual(moveReportItem(['profile', 'trading', 'stems'], 'trading', 1), ['profile', 'stems', 'trading']);
  assert.deepEqual(moveReportItem(['profile', 'trading'], 'profile', -1), ['profile', 'trading']);
  assert.deepEqual(moveReportItem(['profile', 'trading'], 'missing', 1), ['profile', 'trading']);
});

test('the shared GROUP selection resolves once for sections and report scope without inventing children', () => {
  const groupScope = {
    includedAccountIds: ['001A', '001B'],
    availableAccounts: [{ accountId: '001A', included: true }, { accountId: '001B', included: true }, { accountId: '001C', included: false }],
  };
  assert.deepEqual(selectedGroupAccountIds(groupScope, null), ['001A', '001B']);
  assert.deepEqual(selectedGroupAccountIds(groupScope, ['001B']), ['001B']);
  assert.deepEqual(selectedGroupAccountIds(groupScope, []), []);
  assert.deepEqual(selectedGroupAccountIds({ availableAccounts: [{ accountId: '001C', included: true }, { accountId: '001D', included: false }] }, null), ['001C']);
  assert.deepEqual(selectedGroupAccountIds(null, null), []);
});

test('direct Credit opens fetch the base overview first so identity and GROUP scope are available', () => {
  assert.equal(nextInsightLoadSection('credit', {}), 'overview');
  assert.equal(nextInsightLoadSection('credit', { overview: { identity: { name: 'Account' } } }), null);
  assert.equal(nextInsightLoadSection('trading', { overview: {} }), 'trading');
  assert.equal(nextInsightLoadSection('trading', { overview: {}, trading: {} }), null);
});
