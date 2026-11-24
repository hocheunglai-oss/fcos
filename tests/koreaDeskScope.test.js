import test from 'node:test';
import assert from 'node:assert/strict';
import { koreaDeskCondition, koreaDeskDescribeCacheVersion, koreaDeskMatches, normalizeKoreaDeskMode, requireKoreaDeskField } from '../api/_koreaDeskScope.js';
import { createMemoryRuntimeCacheAdapter, getOrLoadRuntimeCache } from '../api/_runtimeCache.js';
import { normalizeDecisionDashboardFilters } from '../api/_decisionDashboard.js';
import { dashboardFilterPayload } from '../src/lib/dashboardFilters.js';
import { accountInsightStatementRequest } from '../api/_accountInsightReportScope.js';
import { dashboardStemExportFileName } from '../src/lib/dashboardStemExport.js';
import { dashboardUnifiedCounterpartyServiceInternals as unified } from '../api/_dashboardUnifiedCounterpartyService.js';
import { dashboardAccountCreditStatementServiceInternals as buyer } from '../api/_dashboardAccountCreditStatementService.js';
import { dashboardSupplierCreditStatementServiceInternals as supplier } from '../api/_dashboardSupplierCreditStatementService.js';
import { dashboardAccountInsightServiceInternals as insight } from '../api/_dashboardAccountInsightService.js';

test('Salesforce field discovery bypasses only the pre-rollout STEM cache entries', async () => {
  const cacheAdapter = createMemoryRuntimeCacheAdapter();
  const priorFields = [{ name: 'Id' }];
  const currentFields = [...priorFields, { name: 'Korea_Desk_Member__c' }];
  const request = (objectName, version, loader) => getOrLoadRuntimeCache({
    namespace: 'salesforce-describe',
    accessScope: 'schema',
    payload: { objectName: objectName.toLowerCase() },
    ttlSeconds: 21600,
    version,
    loader,
    cacheAdapter,
  });
  for (const name of ['STEM__c', 'Account']) {
    await request(name, '1', async () => priorFields);
  }
  const stem = await request('STEM__c', koreaDeskDescribeCacheVersion('STEM__c', '1'), async () => currentFields);
  assert.deepEqual(stem.value, currentFields);
  const account = await request('Account', koreaDeskDescribeCacheVersion('Account', '1'), async () => assert.fail('Unrelated cache was invalidated'));
  assert.deepEqual(account.value, priorFields);
  assert.equal(koreaDeskDescribeCacheVersion('stem__c', '2'), '2:korea-desk');
});

test('membership and complement preserve historical undecided records', () => {
  const rows = [true, false, null].map((value) => ({ Korea_Desk_Member__c: value }));
  assert.deepEqual(rows.filter((row) => koreaDeskMatches(row, 'include')), [rows[0]]);
  assert.deepEqual(rows.filter((row) => koreaDeskMatches(row, 'exclude')), [rows[1], rows[2]]);
  assert.equal(koreaDeskCondition('include'), 'Korea_Desk_Member__c = true');
  assert.equal(koreaDeskCondition('exclude', 'STEM__r.'), '(STEM__r.Korea_Desk_Member__c = false OR STEM__r.Korea_Desk_Member__c = null)');
  assert.throws(() => koreaDeskMatches({}, 'exclude'), /unavailable/);
  assert.throws(() => requireKoreaDeskField(new Set(), 'include'), /unavailable/);
  assert.doesNotThrow(() => requireKoreaDeskField(new Set(), 'all'));
  assert.throws(() => normalizeKoreaDeskMode('invalid'), /invalid/);
});

test('all consumer paths include and exclude the same STEMs, including undecided', async () => {
  const stems = [true, false, null].map((value, index) => ({ Id: String(index), Korea_Desk_Member__c: value }));
  const dataset = { stems, previousStems: [], lineItems: [], previousLineItems: [], extraCosts: [], previousExtraCosts: [], buyerBrokers: [], previousBuyerBrokers: [], buyerInvoices: [], supplierInvoices: [], payments: [], cashflows: [] };
  for (const mode of ['include', 'exclude']) {
    const expected = mode === 'include' ? ['0'] : ['1', '2'];
    const filters = buyer.directoryFilters({ koreaDeskMode: mode });
    assert.deepEqual(stems.filter((stem) => buyer.stemMatchesDirectoryScope(stem, filters)).map((stem) => stem.Id), expected);
    const supplierFilters = supplier.normalizeFilters({ koreaDeskMode: mode });
    assert.deepEqual(stems.filter((stem) => supplier.stemMatchesStatementScope(stem, supplierFilters, [], false)).map((stem) => stem.Id), expected);
    assert.deepEqual(insight.applyDashboardScope(dataset, { filters: { koreaDeskMode: mode } }).dataset.stems.map((stem) => stem.Id), expected);
    const where = await unified.scopeWhere(unified.normalizedFilters({ koreaDeskMode: mode }), new Map([['Korea_Desk_Member__c', {}]]), false);
    assert.match(unified.stemChildScope(where), /STEM__r\.Korea_Desk_Member__c/);
    assert.match(supplier.childStemConditions(supplierFilters, []).join(' AND '), /STEM__r\.Korea_Desk_Member__c/);
  }
  await assert.rejects(unified.scopeWhere(unified.normalizedFilters({ koreaDeskMode: 'include' }), new Map(), false), /unavailable/);
});

test('desk selection remains independent of geographic country and flows into reporting and export', () => {
  const desk = dashboardFilterPayload({ koreaDeskMode: 'include' });
  assert.equal(desk.filters.koreaDeskMode, 'include');
  assert.deepEqual(desk.filters.countryCodes, []);
  assert.equal(normalizeDecisionDashboardFilters(desk.filters).koreaDeskMode, 'include');
  const statement = accountInsightStatementRequest({ dashboardScope: { filters: desk.filters } });
  assert.equal(statement.filters.koreaDeskMode, 'include');
  assert.match(dashboardStemExportFileName({ filterPayload: desk }), /Korea_Desk\.xls$/);
  const geographic = dashboardFilterPayload({ countryCode: 'KOREA' });
  assert.deepEqual(geographic.filters.countryCodes, ['KOREA']);
  assert.equal(geographic.filters.koreaDeskMode, 'all');
  assert.doesNotMatch(dashboardStemExportFileName({ filterPayload: geographic }), /Korea_Desk/);
});
