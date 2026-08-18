import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('unified counterparty APIs use exact IDs, the approved GROUP rule, and distinct supplier STEM counts', async () => {
  const source = await readFile(new URL('../api/_dashboardUnifiedCounterpartyService.js', import.meta.url), 'utf8');
  assert.match(source, /selectUltimateCreditGroup/);
  assert.match(source, /supplierStemIds/);
  assert.match(source, /for \(const row of \[\.\.\.lines, \.\.\.extras\]\)/);
  assert.match(source, /Inactive_Suspended__c = false/);
  assert.match(source, /INTEROFFICE|interoffice/);
  assert.match(source, /ttlSeconds: 60/);
  assert.match(source, /estimateUninvoicedSupplierChild/);
  assert.match(source, /salesforce-dashboard-account-exposure-batch/);
  assert.match(source, /net: \{ complete: netComplete/);
  assert.match(source, /requestedIdentities\(requested/);
  assert.doesNotMatch(source, /query: '', limit: 100/);
  assert.match(source, /phase === 'group'/);
  assert.match(source, /Name LIKE 'GROUP%'/);
  assert.match(source, /openStemIds: new Set/);
  assert.match(source, /scopedBuyerStemCount/);
  assert.match(source, /scopedSupplierStemCount/);
  assert.match(source, /dateWindows, disputeOnly/);
  assert.match(source, /scopeWhereValue/);
});

test('unified handlers and the both-side credit statement are registered as server reads', async () => {
  const [api, policies, service] = await Promise.all([
    readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_handlerPolicyRegistry.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_dashboardAccountCreditStatementService.js', import.meta.url), 'utf8'),
  ]);
  for (const name of ['dashboardCounterpartySearch', 'dashboardAccountExposureBatch']) {
    assert.equal(api.includes(`${name}: ['dashboard']`), true);
    assert.match(policies, new RegExp(`${name}: readPolicy\\(\\{\\"cache\\":\\"server\\"`));
  }
  assert.match(service, /body\.side === 'both'/);
  assert.match(service, /combinedExposurePoints/);
  assert.match(service, /entityType === 'group'/);
  assert.match(service, /entityType === 'group' \? value\.group : value\.individual/);
});
