import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardDateScopeWhere } from '../api/_dashboardDateScope.js';
import { buildDashboardDateWindows } from '../src/lib/dashboardFilters.js';

test('browser date selections become typed windows without query fragments', () => {
  assert.deepEqual(buildDashboardDateWindows([2026], [2]), [
    { startDate: '2026-02-01', endDate: '2026-02-28' },
  ]);
});

test('server compiles validated date windows using only allowlisted Salesforce fields', () => {
  const where = buildDashboardDateScopeWhere(
    [{ startDate: '2026-02-01', endDate: '2026-02-28' }],
    ['Delivery_Date__c', 'Expected_Delivery_Date__c'],
  );
  assert.match(where, /Delivery_Date__c >= 2026-02-01/);
  assert.match(where, /Expected_Delivery_Date__c <= 2026-02-28/);
  assert.throws(
    () => buildDashboardDateScopeWhere([{ startDate: "2026-01-01' OR Name != null", endDate: '2026-01-31' }], ['Delivery_Date__c']),
    /valid ordered YYYY-MM-DD/,
  );
});

test('server fails closed when Delivery Date metadata is unavailable', () => {
  assert.throws(
    () => buildDashboardDateScopeWhere([{ startDate: '2026-01-01', endDate: '2026-01-31' }], []),
    /metadata could not be validated/,
  );
});
