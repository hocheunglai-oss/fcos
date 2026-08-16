import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  dashboardFinancialBuckets,
  decodeDashboardCursor,
  decisionDashboardSummary,
  encodeDashboardCursor,
  normalizeDecisionDashboardFilters,
  priorEquivalentDateWindows,
} from '../api/_decisionDashboard.js';

test('decision dashboard keeps financial totals in separate ISO currency buckets', () => {
  assert.deepEqual(dashboardFinancialBuckets([
    { currency: 'USD', buyer: 120, supplier: 80, costs: 5, brokerCommissions: 1, netPnl: 34 },
    { currency: 'EUR', buyer: 200, supplier: 150, costs: 10, brokerCommissions: 0, netPnl: 40 },
    { currency: 'USD', buyer: 20, supplier: 4, costs: 0, brokerCommissions: 0, netPnl: 16 },
  ]), [
    { currency: 'EUR', buyer: 200, supplier: 150, costs: 10, brokerCommissions: 0, netPnl: 40, stemCount: 1, grossMarginPct: 20 },
    { currency: 'USD', buyer: 140, supplier: 84, costs: 5, brokerCommissions: 1, netPnl: 50, stemCount: 2, grossMarginPct: 35.714285714285715 },
  ]);
});

test('financial totals are suppressed when a scope is incomplete', () => {
  const summary = decisionDashboardSummary([{ currency: 'USD', buyer: 10 }], { matchingCount: 2, processedCount: 1 });
  assert.equal(summary.complete, false);
  assert.equal(summary.financials, null);
});

test('filters use exact IDs and normalized country codes without text matching', () => {
  assert.deepEqual(normalizeDecisionDashboardFilters({
    accountIds: ['001000000000001', '001000000000001', ' 001000000000002 '],
    portIds: ['a0P000000000001'],
    countryCodes: ['hk', ' HK '],
    supplierIds: ['001000000000003'],
    supplierNames: ['Supplier A'],
  }), {
    accountIds: ['001000000000001', '001000000000002'], portIds: ['a0P000000000001'], countryCodes: ['HK'], supplierIds: ['001000000000003'], includeCancelled: false,
  });
});

test('complete financial scopes remain publishable beyond the former 3,000-record boundary', () => {
  const rows = Array.from({ length: 3_501 }, () => ({ currency: 'USD', buyer: 10, supplier: 6, netPnl: 4 }));
  const summary = decisionDashboardSummary(rows, { matchingCount: rows.length, processedCount: rows.length });
  assert.equal(summary.complete, true);
  assert.equal(summary.processedCount, 3_501);
  assert.equal(summary.financials[0].stemCount, 3_501);
  assert.equal(summary.financials[0].buyer, 35_010);
});

test('cursor round trips only valid Salesforce identifiers', () => {
  const cursor = encodeDashboardCursor(
    { Id: 'a01123456789012AAA', CreatedDate: '2026-08-01T12:00:00.000+0000' },
    { field: 'createdDate', direction: 'desc' },
  );
  assert.deepEqual(decodeDashboardCursor(cursor), {
    field: 'createdDate',
    direction: 'desc',
    value: '2026-08-01T12:00:00.000+0000',
    id: 'a01123456789012AAA',
  });
  const deliveryCursor = encodeDashboardCursor(
    { Id: 'a01123456789012AAA', Delivery_Date__c: '2026-08-01' },
    { field: 'deliveryDate', direction: 'asc' },
  );
  assert.deepEqual(decodeDashboardCursor(deliveryCursor), {
    field: 'deliveryDate', direction: 'asc', value: '2026-08-01', id: 'a01123456789012AAA',
  });
  assert.equal(decodeDashboardCursor('not-a-cursor'), null);
});

test('prior trend period has the same inclusive duration as selected scope', () => {
  assert.deepEqual(priorEquivalentDateWindows([{ startDate: '2026-08-01', endDate: '2026-08-31' }]), [{ startDate: '2026-07-01', endDate: '2026-07-31' }]);
});

test('new dashboard handlers are authenticated, live-only, and supplier matching checks both child objects', async () => {
  const [api, policies] = await Promise.all([
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_handlerPolicyRegistry.js', import.meta.url), 'utf8'),
  ]);
  for (const handler of ['dashboardSummary', 'dashboardStemList', 'dashboardAnalytics']) {
    assert.equal(api.includes(`${handler}: ['dashboard']`), true);
    assert.match(api, new RegExp(`${handler},`));
    assert.match(policies, new RegExp(`${handler}: readPolicy\\(\\{\\"cache\\":\\"server\\"`));
  }
  assert.match(api, /FROM STEM_Line_Item__c WHERE Cancelled__c = false/);
  assert.match(api, /FROM STEM_Extra_Cost__c WHERE Cancelled__c = false/);
  const loader = api.slice(api.indexOf('async function loadDecisionDashboardScope'), api.indexOf('async function salesforceDashboardFilteredUncached'));
  assert.doesNotMatch(loader, /LIMIT 3000/);
  assert.match(loader, /limit: pageOnly \? pageSize \+ 1 : null/);
  assert.match(loader, /SELECT COUNT\(Id\) total FROM stem__c/);
  assert.match(loader, /decisionDashboardBuyerBrokerCommissionField\(buyerBrokerDescribe\.fields/);
  assert.match(loader, /buyerBrokerCommissionField\s*\?\s*decisionDashboardRowsForStemIds/);
  assert.doesNotMatch(loader, /\['STEM__c', 'Commission_Lumpsum__c'\]/);
});
