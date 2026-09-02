import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('unified counterparty APIs use exact IDs, the approved GROUP rule, and distinct supplier STEM counts', async () => {
  const source = await readFile(new URL('../api/_dashboardUnifiedCounterpartyService.js', import.meta.url), 'utf8');
  assert.match(source, /selectUltimateCreditGroup/);
  assert.match(source, /supplierStemIds/);
  assert.match(source, /for \(const row of lines\)/);
  assert.match(source, /for \(const row of extras\)/);
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
  assert.match(source, /type: field\.type \|\| null/);
  assert.match(source, /label: field\.label \|\| null/);
  assert.match(source, /salesforce-unified-counterparty-describe', version: '2'/);
  assert.doesNotMatch(source, /SELECT Account__c accountId/);
  assert.doesNotMatch(source, /fieldName} accountId/);
  assert.match(source, /SELECT Account__c,COUNT\(Id\) FROM STEM__c/);
  assert.match(source, /row\.expr0/);
  assert.doesNotMatch(source, /COUNT\(Id\) count/);
  assert.match(source, /Expected_Delivery_Date__c\|Delivery_Date__c\|Port__c/);
  assert.match(source, /stemChildScope\(scopeWhere\)/);
  assert.match(source, /stemChildScope\(scoped\)/);
  assert.doesNotMatch(source, /replaceAll\('Delivery_Date__c'/);
  assert.match(source, /const buyerSelect = .*\.filter\(\(field\) => stemMap\.has\(field\)\)/);
  assert.match(source, /const invoiceSelect = .*\.filter\(\(field\) => invoiceMap\.has\(field\)\)/);
  assert.match(source, /CREDIT_EXPOSURE_DELIVERY_START/);
  assert.match(source, /Delivery_Date__c >= \$\{CREDIT_EXPOSURE_DELIVERY_START\}/);
  assert.match(source, /Expected_Delivery_Date__c >= \$\{CREDIT_EXPOSURE_DELIVERY_START\}/);
  assert.match(source, /salesforce-dashboard-account-exposure-batch', version: '4-payment-reliability'/);
  assert.match(source, /findDashboardUomField/);
  assert.match(source, /resolveSupplierInvoiceIdentity/);
  assert.match(source, /linkedSupplierIdsByInvoice/);
  assert.match(source, /issuedWithoutLinkedChild/);
  assert.match(source, /Math\.abs\(Number\(row\.estimate\.amount \|\| 0\)\) > 0\.005/);
  assert.doesNotMatch(source, /SELECT Id,Account__c,CurrencyIsoCode/);
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
