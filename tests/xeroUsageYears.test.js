import assert from 'node:assert/strict';
import test from 'node:test';
import { addUsageYear, hasUsageYearBreakdown, usageYearFields, xeroUsageYear } from '../api/_xeroUsageYears.js';

test('usage years follow the transaction date, preserving calendar year at timezone boundaries', () => {
  assert.equal(xeroUsageYear({ DateString: '2025-12-31T23:30:00-08:00', Date: '/Date(1767252600000+0000)/' }), 2025);
  assert.equal(xeroUsageYear({ Date: '/Date(1735689600000+0800)/' }), 2025);
  assert.equal(xeroUsageYear({ Date: '2026-01-01' }), 2026);
  assert.equal(xeroUsageYear({ DateString: '2024-02-29T00:00:00', Date: '2025-01-01' }), 2024);
  assert.equal(xeroUsageYear({ DateString: 'bad', Date: '2025-01-01' }), 2025);
  assert.equal(xeroUsageYear({ Date: '2026-01-01', Invoice: { Date: '2025-12-31' } }), 2026);
});

test('missing or invalid dates cannot borrow invoice, update, or scan years', () => {
  for (const record of [null, {}, { Date: '2025-02-29' }, { Date: '2025-13-01' }, { Date: '2025-01-01Tinvalid' },
    { Date: '/Date(bad)/' }, { Date: 1735689600000 }, { Invoice: { Date: '2025-01-01' }, UpdatedDateUTC: '2026-01-01', lastSeenAt: '2026-01-01' }]) {
    assert.equal(xeroUsageYear(record), null);
  }
});

test('year counts retain disjoint years, explicit unknown dates and complete totals', () => {
  let item;
  for (const Date of ['2026-01-01', '2023-01-01', undefined, '2026-02-01']) {
    item = { records: (item?.records || 0) + 1, ...addUsageYear(item, { Date }) };
  }
  assert.deepEqual(item, { records: 4, yearCounts: [{ year: 2023, records: 1 }, { year: 2026, records: 2 }], undatedRecords: 1 });
  assert.equal(hasUsageYearBreakdown(item), true);
  assert.deepEqual(usageYearFields(item), { yearCounts: item.yearCounts, undatedRecords: 1 });
});

test('legacy, malformed and inconsistent breakdowns stay unavailable', () => {
  for (const item of [null, { records: 2 }, { records: 2, yearCounts: [], undatedRecords: 0 },
    { records: 2, yearCounts: [{ year: 2025, records: 2 }], undatedRecords: -1 },
    { records: 2, yearCounts: [{ year: 2025, records: 1 }, { year: 2025, records: 1 }], undatedRecords: 0 },
    { records: 2, yearCounts: [null], undatedRecords: 0 }]) {
    assert.equal(hasUsageYearBreakdown(item), false);
    assert.deepEqual(usageYearFields(item), {});
  }
});

test('read-only account export adapters retain the approved Salesforce scope', async () => {
  const { exportSalesforceAccountsForLifecycle } = await import('../api/_xeroPortal.js');
  const id = '001000000000001AAA';
  const calls = [];
  const result = await exportSalesforceAccountsForLifecycle({}, {
    query: async (soql) => {
      calls.push(soql);
      assert.match(soql, /Company_Code__c LIKE 'HK%'/);
      assert.match(soql, /Inactive_Suspended__c = false/);
      return { totalSize: 1, records: [{ Id: id, Name: 'Buyer', Company_Code__c: 'HK1', RecordType: { DeveloperName: 'Buyer' } }] };
    },
    compositeQueries: async (queries) => queries.map(({ soql }, index) => {
      calls.push(soql);
      assert.match(soql, /Delivery_Date_Or_Expected__c >= 2025-01-01/);
      return { totalSize: index === 0 ? 1 : 0, records: index === 0 ? [{ Account__c: id }] : [] };
    }),
  });
  assert.equal(calls.length, 8);
  assert.ok(calls.every(query => query.startsWith('SELECT ')));
  assert.equal(result.accounts[0].id, id);
  assert.equal(result.totalRecords, 1);
});
