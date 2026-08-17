import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Account discovery surfaces require active Salesforce Accounts', async () => {
  const [handlers, credit, insight, compensation, specialTerms, shipAgent] = await Promise.all([
    source('api/functions/[name].js'),
    source('api/_dashboardAccountCreditStatementService.js'),
    source('api/_dashboardAccountInsightService.js'),
    source('api/_unofficialCompensationService.js'),
    source('api/_specialTerms.js'),
    source('api/_shipAgentCharges.js'),
  ]);

  assert.match(handlers, /dashboard-filter-options-v2/);
  assert.match(handlers, /FROM Account WHERE Inactive_Suspended__c = false ORDER BY Name,Id/);
  assert.match(handlers, /Account__r\.Inactive_Suspended__c = false/);
  assert.match(handlers, /DASHBOARD_ACCOUNT_STATUS_SCHEMA/);
  assert.match(credit, /Id IN \(SELECT Account__c FROM STEM__c WHERE Account__c != null\)/);
  assert.match(credit, /Inactive_Suspended__c = false/);
  assert.match(credit, /ACCOUNT_CREDIT_ACCOUNT_INACTIVE/);
  assert.match(insight, /ACCOUNT_INSIGHT_ACCOUNT_INACTIVE/);
  assert.match(insight, /ParentId IN \([^\n]+\) AND Inactive_Suspended__c = false/);
  assert.match(compensation, /Account__r\.Inactive_Suspended__c = false/);
  assert.match(specialTerms, /FROM Account WHERE Inactive_Suspended__c = false/);
  assert.match(shipAgent, /filter\(\(account\) => account\.Inactive_Suspended__c !== true\)/);
});

test('financial STEM rows retain amounts but do not expose inactive Account identities', async () => {
  const handlers = await source('api/functions/[name].js');
  assert.match(handlers, /name: 'Account unavailable'/);
  assert.match(handlers, /supplierName: lineSupplier\.relationshipName && item\[lineSupplier\.relationshipName\]\?\.Inactive_Suspended__c === true \? null/);
  assert.match(handlers, /supplierName: extraSupplier\.relationshipName && item\[extraSupplier\.relationshipName\]\?\.Inactive_Suspended__c === true \? null/);
});
