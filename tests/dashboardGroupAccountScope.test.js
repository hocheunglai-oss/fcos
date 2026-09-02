import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeRequestedGroupAccountIds, resolveGroupAccountScope } from '../api/_dashboardGroupAccountScope.js';

const group = { Id: '001000000000001AAA', Name: 'GROUP - TEST', Company_Code__c: 'GROUP' };
const childA = { Id: '001000000000002AAA', Name: 'BUYER A', Company_Code__c: 'A' };
const childB = { Id: '001000000000003AAA', Name: 'BUYER B', Company_Code__c: 'B' };

test('GROUP Account scope defaults to every active hierarchy Account and preserves root context', () => {
  const scope = resolveGroupAccountScope({ entityType: 'group', group, groupMembers: [childB, group, childA] });
  assert.equal(scope.selectable, true);
  assert.equal(scope.allSelected, true);
  assert.equal(scope.partial, false);
  assert.equal(scope.availableAccounts[0].isGroupRoot, true);
  assert.deepEqual(new Set(scope.includedAccountIds), new Set([group.Id, childA.Id, childB.Id]));
});

test('GROUP Account scope validates and pins an exact selected subset', () => {
  const scope = resolveGroupAccountScope({ entityType: 'group', group, groupMembers: [group, childA, childB], requestedAccountIds: [childB.Id] });
  assert.equal(scope.partial, true);
  assert.deepEqual(scope.includedAccountIds, [childB.Id]);
  assert.throws(() => resolveGroupAccountScope({ entityType: 'group', group, groupMembers: [group, childA], requestedAccountIds: [childB.Id] }), /not active members/);
  assert.throws(() => normalizeRequestedGroupAccountIds(['not-an-id']), /invalid/);
});

test('Account Insight shares GROUP scope across all three credit statement views', async () => {
  const [modal, buyer, supplier, combined] = await Promise.all([
    readFile(new URL('../src/components/dashboard/AccountInsightModal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/AccountCreditStatement.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/SupplierCreditStatement.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/dashboard/CombinedAccountStatement.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(modal, /includedGroupAccountIds/);
  for (const source of [buyer, supplier, combined]) {
    assert.match(source, /includedAccountIds/);
    assert.match(source, /GroupAccountScopeSelector/);
  }
});
