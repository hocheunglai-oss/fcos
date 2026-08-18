import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dashboardAccountInsightServiceInternals } from '../api/_dashboardAccountInsightService.js';
import { dashboardAccountRankings } from '../src/lib/dashboardAccountRankings.js';
import { dashboardFilterKey, normalizeDashboardSavedViews } from '../src/lib/dashboardFilters.js';

const ACCOUNT = '001000000000001AAA';
const PORT_A = 'a01000000000001AAA';
const PORT_B = 'a01000000000002AAA';

function scopeDataset() {
  const stems = [
    { Id: 'a02000000000001AAA', Port__c: PORT_A, Port__r: { Country__c: 'SG' }, Dispute_Status__c: 'Open' },
    { Id: 'a02000000000002AAA', Port__c: PORT_B, Port__r: { Country__c: 'HK' }, Dispute_Status__c: 'No Dispute' },
  ];
  return {
    stems, previousStems: stems, lineItems: stems.map((row) => ({ STEM__c: row.Id })), previousLineItems: [],
    extraCosts: [], previousExtraCosts: [], buyerBrokers: [], previousBuyerBrokers: [],
    buyerPaymentsByStem: Object.fromEntries(stems.map((row) => [row.Id, [{ amount: 1 }]])), supplierInvoices: [],
  };
}

test('Account Insight applies exact Dashboard location and dispute scope without widening Account identity', () => {
  const { dataset, scope } = dashboardAccountInsightServiceInternals.applyDashboardScope(scopeDataset(), {
    mode: 'dashboard', disputeOnly: true, filters: { portIds: [PORT_A], countryCodes: ['SG'], accountIds: [ACCOUNT] }, labels: { country: 'Singapore' },
  });
  assert.deepEqual(dataset.stems.map((row) => row.Id), ['a02000000000001AAA']);
  assert.deepEqual(Object.keys(dataset.buyerPaymentsByStem), ['a02000000000001AAA']);
  assert.equal(scope.labels.country, 'Singapore');
});

test('Account-wide mode preserves the exact Account dataset', () => {
  const source = scopeDataset();
  const { dataset, scope } = dashboardAccountInsightServiceInternals.applyDashboardScope(source, { mode: 'account_wide', filters: { portIds: [PORT_A] } });
  assert.equal(dataset, source);
  assert.equal(scope.mode, 'account_wide');
});

test('Account Insight response projection returns only the requested heavy section', () => {
  const result = { identity: { accountId: ACCOUNT }, availableRoles: ['buyer'], activeRole: 'buyer', period: {}, scope: {}, relationship: {}, dashboardScope: {}, warnings: [], meta: {}, kpis: { stemCount: 2 }, comparisons: {}, payments: { buyer: {} }, collection: {}, risk: { dispute: {} }, stems: { rows: [1] }, children: [1] };
  const trading = dashboardAccountInsightServiceInternals.projectDashboardAccountInsight(result, 'trading');
  assert.deepEqual(trading.kpis, result.kpis);
  assert.equal(trading.payments, undefined);
  assert.equal(trading.stems, undefined);
  const stems = dashboardAccountInsightServiceInternals.projectDashboardAccountInsight(result, 'stems');
  assert.deepEqual(stems.stems, result.stems);
  assert.equal(stems.kpis, undefined);
});

test('saved Dashboard views normalize filters and reject duplicate names', () => {
  const views = normalizeDashboardSavedViews([
    { id: 'one', name: 'YTD Singapore', filters: { datePreset: 'year_to_date', countryCode: 'sg' } },
    { id: 'two', name: 'ytd singapore', filters: { datePreset: 'this_month' } },
  ]);
  assert.equal(views.length, 1);
  assert.equal(views[0].filters.countryCode, 'SG');
  assert.equal(typeof dashboardFilterKey(views[0].filters), 'string');
});

test('complete Account directory rankings retain Achieve Bunker outside the Top 10', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    currency: 'USD',
    netPnl: 1200 - index * 100,
    account: { id: `0010000000000${String(index).padStart(2, '0')}AAA`, name: index === 11 ? 'ACHIEVE BUNKER LTD' : `BUYER ${index + 1}` },
    supplierAllocations: [{ id: `0010000000001${String(index).padStart(2, '0')}AAA`, name: index === 11 ? 'ACHIEVE BUNKER LTD' : `SUPPLIER ${index + 1}`, netPnl: 1200 - index * 100 }],
  }));
  const buyers = dashboardAccountRankings(rows, 'account');
  const suppliers = dashboardAccountRankings(rows, 'supplier');
  assert.equal(buyers.length, 12);
  assert.equal(suppliers.length, 12);
  assert.equal(buyers.slice(0, 10).some((row) => row.name === 'ACHIEVE BUNKER LTD'), false);
  assert.equal(suppliers.slice(0, 10).some((row) => row.name === 'ACHIEVE BUNKER LTD'), false);
  assert.equal(buyers.some((row) => row.name === 'ACHIEVE BUNKER LTD'), true);
  assert.equal(suppliers.some((row) => row.name === 'ACHIEVE BUNKER LTD'), true);
});

test('Dashboard reuses complete rankings without attention or explanation panels and Account Insight stays linkable and lazy', async () => {
  const [dashboard, dashboardKpis, account, app, directory, api] = await Promise.all([
    readFile(new URL('../src/pages/DashboardSettings.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/DashboardKpis.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/AccountInsightModal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/AccountCreditDirectory.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
  ]);
  assert.equal((dashboard.match(/dashboardAnalytics/g) || []).length, 1);
  assert.doesNotMatch(dashboard, /loadAccounts/);
  assert.doesNotMatch(dashboard, /DashboardAttention|Needs attention/);
  assert.doesNotMatch(dashboardKpis, /Explain these figures|Live calculation evidence/);
  assert.match(app, /accounts\/:accountId/);
  assert.match(account, /section: activeTab/);
  assert.match(account, /Dashboard scope/);
  assert.doesNotMatch(account, /Explain these figures|Live calculation evidence|Calculation evidence/);
  assert.match(directory, /One searchable table/);
  assert.match(directory, /directoryRankings\?\.buyers/);
  assert.match(api, /directoryRankings: \{ buyers: accountDirectoryRankings, suppliers: supplierDirectoryRankings \}/);
});
