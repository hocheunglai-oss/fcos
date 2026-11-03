import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { accountInsightStatementRequest } from '../api/_accountInsightReportScope.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Account Insight report statements preserve Korea exclusions and clear them for Account-wide mode', () => {
  const scoped = accountInsightStatementRequest({
    accountId: '001fixture',
    dashboardScope: {
      mode: 'dashboard',
      disputeOnly: true,
      filters: { portIds: [], countryCodes: [], excludedCountryCodes: ['KOREA'] },
    },
  });
  assert.deepEqual(scoped.filters.excludedCountryCodes, ['KOREA']);
  assert.equal(scoped.disputeOnly, true);

  const accountWide = accountInsightStatementRequest({
    accountId: '001fixture',
    dashboardScope: { mode: 'account_wide', disputeOnly: true, filters: { excludedCountryCodes: ['KOREA'] } },
  });
  assert.deepEqual(accountWide.filters, {});
  assert.equal(accountWide.disputeOnly, false);
});

test('Buyer and supplier credit statement requests inherit the active Dashboard exclusion', async () => {
  const [buyer, supplier] = await Promise.all([
    read('src/components/dashboard/AccountCreditStatement.jsx'),
    read('src/components/dashboard/SupplierCreditStatement.jsx'),
  ]);

  assert.match(buyer, /dashboardScope = null/);
  assert.match(buyer, /const accountWideScope = dashboardScope\?\.mode === 'account_wide'/);
  assert.match(buyer, /filters: accountWideScope \? \{\} : dashboardFilters \|\| \{\}/);
  assert.match(buyer, /disputeOnly: !accountWideScope && dashboardDisputeOnly/);
  assert.match(buyer, /\[accountId, accountWideScope, active, dashboardDisputeOnly, dashboardFilters,/);
  assert.match(supplier, /excludedCountryCodes: Array\.isArray\(filters\?\.excludedCountryCodes\)/);
  assert.match(supplier, /filters\?\.excludedCountryCodes/);
});
