import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dashboardFilterPayload, dashboardSuggestionMatches, normalizeDashboardFilters, presetDashboardPeriod } from '../src/lib/dashboardFilters.js';

test('decision dashboard filter payload uses exact account identifiers and never text matching for a buyer', () => {
  const payload = dashboardFilterPayload(normalizeDashboardFilters({
    selectedYears: [2026], selectedMonths: [8], counterpartyMode: 'buyer', company: 'Similar Name', companyId: '001123456789012AAA', port: 'Singapore', portId: 'a0P123456789012AAA', country: 'Singapore', countryCode: 'Singapore',
  }));
  assert.deepEqual(payload.filters.accountIds, ['001123456789012AAA']);
  assert.deepEqual(payload.filters.supplierIds, []);
  assert.deepEqual(payload.filters.portIds, ['a0P123456789012AAA']);
  assert.deepEqual(payload.filters.countryCodes, ['SINGAPORE']);
  assert.equal('companyKeyword' in payload, false);
});

test('supplier filters require exact Account IDs and country values retain canonical non-ID values', () => {
  const payload = dashboardFilterPayload({ selectedYears: [2026], selectedMonths: [8], counterpartyMode: 'supplier', company: 'Exact Supplier', companyId: '001123456789012AAA', country: 'South Korea', countryCode: 'South Korea' });
  assert.deepEqual(payload.filters.supplierIds, ['001123456789012AAA']);
  assert.equal('supplierNames' in payload.filters, false);
  assert.deepEqual(payload.filters.countryCodes, ['SOUTH KOREA']);
  assert.deepEqual(payload.filters.portIds, []);
});

test('buyer GROUP selection expands to exact buyer Account IDs without name matching', () => {
  const payload = dashboardFilterPayload({
    selectedYears: [2026], selectedMonths: [8], counterpartyMode: 'buyer',
    group: 'GROUP - TEST', groupId: '001123456789099AAA',
    groupAccountIds: ['001123456789012AAA', '001123456789013AAA'],
  });
  assert.deepEqual(payload.filters.accountIds, ['001123456789012AAA', '001123456789013AAA']);
  assert.equal('group' in payload.filters, false);
});

test('date presets produce a bounded custom date window', () => {
  const period = presetDashboardPeriod('this_quarter', new Date('2026-08-16T00:00:00Z'));
  assert.deepEqual(period, { selectedYears: [2026], selectedMonths: [7, 8, 9] });
  assert.deepEqual(dashboardFilterPayload(period).dateWindows, [{ startDate: '2026-07-01', endDate: '2026-07-31' }, { startDate: '2026-08-01', endDate: '2026-08-31' }, { startDate: '2026-09-01', endDate: '2026-09-30' }]);
});

test('dashboard defaults and resets to year to date', async () => {
  const filters = normalizeDashboardFilters({});
  assert.equal(filters.datePreset, 'year_to_date');
  assert.deepEqual(filters.selectedMonths, Array.from({ length: new Date().getMonth() + 1 }, (_, index) => index + 1));
  const [page, bar] = await Promise.all([
    readFile(new URL('../src/pages/DashboardSettings.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/DashboardFilterBar.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /presetDashboardPeriod\('year_to_date'\)/);
  assert.match(bar, /filters\.datePreset !== 'year_to_date'/);
  assert.match(bar, /set\(\{ datePreset: 'year_to_date' \}\)/);
  assert.match(bar, /label="Port or COUNTRY"/);
});

test('combined pickers retain GROUP and country results when ordinary matches fill the limit', () => {
  const companies = Array.from({ length: 12 }, (_, index) => ({ kind: 'account', id: `company-${index}`, label: `Hong Company ${index}` }));
  const companyMatches = dashboardSuggestionMatches([...companies, { kind: 'group', id: 'group-1', label: 'GROUP Hong' }], 'Hong', 10);
  assert.equal(companyMatches.length, 10);
  assert.equal(companyMatches[0].kind, 'group');
  assert.ok(companyMatches.some((option) => option.kind === 'account'));
  assert.ok(companyMatches.some((option) => option.kind === 'group'));

  const ports = Array.from({ length: 12 }, (_, index) => ({ kind: 'port', id: `port-${index}`, label: `Hong Port ${index}` }));
  const locationMatches = dashboardSuggestionMatches([...ports, { kind: 'country', value: 'country:Hong Kong', label: 'COUNTRY - Hong Kong' }], 'Hong', 10);
  assert.equal(locationMatches[0].kind, 'country');
  assert.ok(locationMatches.some((option) => option.kind === 'port'));
  assert.ok(locationMatches.some((option) => option.kind === 'country'));
});
