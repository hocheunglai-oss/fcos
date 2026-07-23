import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuyerReminderRules,
  buyerReminderAccountType,
  canonicalSalesforceAccountId,
  evaluateBuyerReminderSelection,
  resolveBuyerReminderRule,
} from '../api/_buyerInvoiceReminderRules.js';

const buyerId = '0012x00000BUYERAAA';
const groupId = '0012x00000GROUPAAA';

test('canonicalizes valid Salesforce IDs and rejects malformed values', () => {
  assert.equal(canonicalSalesforceAccountId(buyerId), '0012x00000BUYER');
  assert.equal(canonicalSalesforceAccountId('0012x00000BUYER'), '0012x00000BUYER');
  assert.equal(canonicalSalesforceAccountId('not-an-id'), '');
});

test('classifies GROUP, Buyer, and Buyer & Supplier accounts', () => {
  assert.equal(buyerReminderAccountType({ RecordType: { Name: 'Group' } }), 'group');
  assert.equal(buyerReminderAccountType({ Buyer_Payment_Term__c: '30 days' }), 'buyer');
  assert.equal(buyerReminderAccountType({
    Buyer_Payment_Term__c: '30 days',
    Supplier_Payment_Term__c: '15 days',
  }), 'buyer_supplier');
  assert.equal(buyerReminderAccountType({ Supplier_Payment_Term__c: '15 days' }), null);
  assert.equal(buyerReminderAccountType({ Is_Broker__c: true }), null);
  assert.equal(buyerReminderAccountType({
    Is_Broker__c: true,
    Buyer_Payment_Term__c: '30 days',
  }), null);
});

test('direct child rules override inherited GROUP rules', () => {
  const row = { buyerAccountId: buyerId, buyerParentAccountId: groupId, buyerName: 'Buyer' };
  const rule = resolveBuyerReminderRule(row, [
    { salesforce_account_id: groupId, account_name: 'GROUP Buyer', policy: 'overdue_only', inherit_to_children: true },
    { salesforce_account_id: buyerId, account_name: 'Buyer', policy: 'standard' },
  ]);

  assert.equal(rule.policy, 'standard');
  assert.equal(rule.source, 'direct');
});

test('inherits an enabled direct-parent GROUP rule and its note', () => {
  const rule = resolveBuyerReminderRule({
    buyerAccountId: buyerId,
    buyerParentAccountId: groupId,
    buyerGroupName: 'GROUP Buyer',
  }, [{
    salesforce_account_id: groupId,
    account_name: 'GROUP Buyer',
    policy: 'overdue_only',
    note: 'Do not remind before overdue.',
    inherit_to_children: true,
  }]);

  assert.equal(rule.policy, 'overdue_only');
  assert.equal(rule.source, 'group');
  assert.equal(rule.note, 'Do not remind before overdue.');
});

test('does not inherit a GROUP-only rule', () => {
  const rule = resolveBuyerReminderRule({
    buyerAccountId: buyerId,
    buyerParentAccountId: groupId,
  }, [{
    salesforce_account_id: groupId,
    policy: 'overdue_only',
    inherit_to_children: false,
  }]);

  assert.equal(rule.policy, 'standard');
  assert.equal(rule.source, 'default');
});

test('disables future and due-today buyer reminders but enables overdue invoices', () => {
  const rules = [{ salesforce_account_id: buyerId, policy: 'overdue_only' }];
  const rows = applyBuyerReminderRules([
    { stemId: 'future', buyerAccountId: buyerId, daysUntilDue: 4, buyerBrokerRoutingMode: 'buyer_only' },
    { stemId: 'today', buyerAccountId: buyerId, daysUntilDue: 0, buyerBrokerRoutingMode: 'buyer_cc_broker' },
    { stemId: 'overdue', buyerAccountId: buyerId, daysUntilDue: -1, buyerBrokerRoutingMode: 'buyer_only' },
  ], rules);

  assert.equal(rows[0].paymentReminderEligible, false);
  assert.equal(rows[1].paymentReminderEligible, false);
  assert.equal(rows[2].paymentReminderEligible, true);
});

test('broker-only routing ignores an available buyer policy', () => {
  const [row] = applyBuyerReminderRules([{
    buyerAccountId: buyerId,
    daysUntilDue: 7,
    buyerBrokerRoutingMode: 'broker_only',
  }], [{ salesforce_account_id: buyerId, policy: 'overdue_only' }]);

  assert.equal(row.paymentReminderEligible, true);
  assert.equal(row.paymentReminderRuleApplied, false);
});

test('buyer routing fails closed without a valid Salesforce Buyer Account ID', () => {
  const rows = applyBuyerReminderRules([
    { buyerAccountId: null, daysUntilDue: -10, buyerBrokerRoutingMode: 'buyer_only' },
    { buyerAccountId: null, daysUntilDue: -10, buyerBrokerRoutingMode: 'broker_only' },
  ], []);

  assert.equal(rows[0].paymentReminderEligible, false);
  assert.match(rows[0].paymentReminderBlockingReason, /Buyer Account ID/i);
  assert.equal(rows[1].paymentReminderEligible, true);
});

test('storage failure disables every external reminder route', () => {
  const rows = applyBuyerReminderRules([
    { buyerAccountId: buyerId, daysUntilDue: -10, buyerBrokerRoutingMode: 'buyer_only' },
    { buyerAccountId: buyerId, daysUntilDue: -10, buyerBrokerRoutingMode: 'broker_only' },
  ], [], false);

  assert.equal(rows[0].paymentReminderEligible, false);
  assert.equal(rows[1].paymentReminderEligible, false);
  assert.match(rows[0].paymentReminderBlockingReason, /temporarily unavailable/i);
});

test('selection validation identifies stale, forged, and restricted invoices', () => {
  const result = evaluateBuyerReminderSelection([
    { stemId: 'eligible', paymentReminderEligible: true },
    { stemId: 'restricted', paymentReminderEligible: false },
  ], ['eligible', 'restricted', 'forged', 'eligible']);

  assert.deepEqual(result.requestedStemIds, ['eligible', 'restricted', 'forged']);
  assert.deepEqual(result.rows.map((row) => row.stemId), ['eligible', 'restricted']);
  assert.deepEqual(result.unknownStemIds, ['forged']);
  assert.deepEqual(result.restrictedRows.map((row) => row.stemId), ['restricted']);
});
