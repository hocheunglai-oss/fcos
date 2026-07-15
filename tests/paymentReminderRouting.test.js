import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupPaymentReminderRows,
  paymentReminderBusinessGroupKey,
} from '../api/_paymentReminderRouting.js';

function routeForRow(row) {
  return row.routing;
}

test('merges recipient differences for the same buyer and buyer broker pair', () => {
  const rows = [
    {
      stemId: 'stem-1',
      buyerAccountId: '0012x00000BUYERAAA',
      buyerBrokerDetails: [{ brokerId: '0012x00000BROKERAAB' }],
      routing: {
        mode: 'buyer_cc_broker',
        to: ['accounts@buyer.example', 'trader.one@buyer.example'],
        cc: ['broker@example.com'],
        bcc: [],
        primaryRecipientName: 'Buyer Ltd',
        warnings: [],
      },
    },
    {
      stemId: 'stem-2',
      buyerAccountId: '0012x00000BUYERAAA',
      buyerBrokerDetails: [{ brokerId: '0012x00000BROKERAAB' }],
      routing: {
        mode: 'buyer_cc_broker',
        to: ['accounts@buyer.example', 'handler.two@buyer.example'],
        cc: ['BROKER@example.com'],
        bcc: [],
        primaryRecipientName: 'Buyer Ltd',
        warnings: [],
      },
    },
  ];

  const groups = groupPaymentReminderRows(rows, routeForRow);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].to, [
    'accounts@buyer.example',
    'trader.one@buyer.example',
    'handler.two@buyer.example',
  ]);
  assert.deepEqual(groups[0].cc, ['broker@example.com']);
  assert.equal(groups[0].rows.length, 2);
});

test('keeps different routing modes in separate batches', () => {
  const base = {
    buyerAccountId: '0012x00000BUYERAAA',
    buyerBrokerDetails: [{ brokerId: '0012x00000BROKERAAB' }],
  };
  const groups = groupPaymentReminderRows([
    {
      ...base,
      stemId: 'stem-1',
      routing: { mode: 'buyer_only', to: ['buyer@example.com'], cc: [], bcc: [], primaryRecipientName: 'Buyer Ltd' },
    },
    {
      ...base,
      stemId: 'stem-2',
      routing: { mode: 'broker_only', to: ['broker@example.com'], cc: [], bcc: [], primaryRecipientName: 'Broker Ltd' },
    },
  ], routeForRow);

  assert.equal(groups.length, 2);
});

test('keeps same-name buyer brokers with different Account IDs separate', () => {
  const common = {
    buyerAccountId: '0012x00000BUYERAAA',
    buyerBrokerNames: 'Shared Broker Name',
    routing: { mode: 'buyer_cc_broker', to: ['buyer@example.com'], cc: ['broker@example.com'], bcc: [], primaryRecipientName: 'Buyer Ltd' },
  };
  const firstKey = paymentReminderBusinessGroupKey({
    ...common,
    stemId: 'stem-1',
    buyerBrokerDetails: [{ brokerId: '0012x00000BRKA1AAA' }],
  }, common.routing);
  const secondKey = paymentReminderBusinessGroupKey({
    ...common,
    stemId: 'stem-2',
    buyerBrokerDetails: [{ brokerId: '0012x00000BRKA2AAA' }],
  }, common.routing);

  assert.notEqual(firstKey, secondKey);
});

test('normalizes 18-character Salesforce IDs to their 15-character identity', () => {
  const routing = { mode: 'buyer_only' };
  const shortKey = paymentReminderBusinessGroupKey({
    stemId: 'stem-1',
    buyerAccountId: '0012x00000BUYER',
    buyerBrokerDetails: [{ brokerId: '0012x00000BROKE' }],
  }, routing);
  const longKey = paymentReminderBusinessGroupKey({
    stemId: 'stem-2',
    buyerAccountId: '0012x00000BUYERAAA',
    buyerBrokerDetails: [{ brokerId: '0012x00000BROKEAAB' }],
  }, routing);

  assert.equal(shortKey, longKey);
});
