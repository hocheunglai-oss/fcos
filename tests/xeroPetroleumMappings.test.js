import test from 'node:test';
import assert from 'node:assert/strict';
import { approvePetroleumMappings, petroleumMappingPlan } from '../api/_xeroPetroleumMappings.js';
import { loadSalesforceFinancialSnapshot } from '../api/_xeroFinancialSync.js';

const products = [
  { Id: '01t000000000001AAA', Name: 'Fuel', RecordType: { DeveloperName: 'Petroleum_Product' }, IsActive: true },
  { Id: '01t000000000002AAA', Name: 'Retired grade', RecordType: { DeveloperName: 'Petroleum_Product' }, IsActive: false },
  { Id: '01t000000000003AAA', Name: 'Petroleum transport', RecordType: { DeveloperName: 'Non_Petroleum_Product' } },
  { Id: '01t000000000004AAA', Name: 'RMG 380 adjustment', RecordType: { DeveloperName: 'Accounting_Adjustment' } },
  { Id: '01t000000000005AAA', Name: 'DMA S0.1%' },
];
const accounts = [
  { Code: '41100', Name: 'Trading Sales', Type: 'REVENUE', Status: 'ACTIVE' },
  { Code: '51100', Name: 'Trading Purchase', Type: 'DIRECTCOSTS', Status: 'ACTIVE' },
];
const taxRates = [{ TaxType: 'NONE', Status: 'ACTIVE', DisplayTaxRate: 0, EffectiveRate: 0, CanApplyToRevenue: true, CanApplyToExpenses: true }];
const actor = { id: 'd1e772f5-9c10-4566-99b3-67f4c4e75a62', email: 'finance@example.test' };
const initial = () => petroleumMappingPlan(products, accounts, taxRates, []);

test('exact Salesforce record type controls both directions, including inactive historical products', () => {
  const plan = initial();
  assert.equal(plan.productCount, 2);
  assert.equal(plan.approvedCount, 4);
  assert.deepEqual(plan.changes.map(({ after }) => [after.salesforce_product_id, after.direction, after.xero_account_code, after.xero_tax_type]), [
    [products[0].Id, 'buyer', '41100', 'NONE'], [products[0].Id, 'supplier', '51100', 'NONE'],
    [products[1].Id, 'buyer', '41100', 'NONE'], [products[1].Id, 'supplier', '51100', 'NONE'],
  ]);
});

test('compliant approvals are idempotent; conflicting/disabled petroleum mappings change, others remain untouched', () => {
  const mappings = initial().changes.map(({ after }, index) => ({ ...after, id: `mapping-${index}`, revision: 7 }));
  const other = { ...mappings[0], id: 'non-fuel', salesforce_product_id: products[2].Id, xero_account_code: '99999' };
  mappings.push(other);
  assert.equal(petroleumMappingPlan(products, accounts, taxRates, mappings).changes.length, 0);
  mappings[0].xero_tax_type = 'INPUT';
  mappings[1].enabled = false;
  mappings[2].xero_account_code = '40000';
  const plan = petroleumMappingPlan(products, accounts, taxRates, mappings);
  assert.equal(plan.changes.length, 3);
  assert.ok(plan.changes.every(({ before }) => before.revision === 7 && before.id !== 'non-fuel'));
  assert.equal(other.xero_account_code, '99999');
});

test('missing, archived, duplicate or wrong account type and invalid NONE tax all fail before writes', () => {
  for (const invalid of [accounts.slice(0, 1), [accounts[0], { ...accounts[1], Status: 'ARCHIVED' }], [accounts[0], { ...accounts[1], Type: 'BANK' }], [...accounts, accounts[0]]]) {
    assert.throws(() => petroleumMappingPlan(products, invalid, taxRates, []), /active Xero account/);
  }
  for (const invalid of [[], [{ ...taxRates[0], EffectiveRate: 5 }], [{ ...taxRates[0], DisplayTaxRate: null }], [{ ...taxRates[0], Status: 'DELETED' }], [{ ...taxRates[0], CanApplyToExpenses: false }]]) {
    assert.throws(() => petroleumMappingPlan(products, accounts, invalid, []), /zero-rate NONE/);
  }
  assert.throws(() => petroleumMappingPlan([products[0], products[0]], accounts, taxRates, []), /duplicated/);
});

function fakeStore({ mappings = [], failureAt = -1, auditFails = false } = {}) {
  const calls = []; const events = [];
  const client = {
    from(table) {
      assert.equal(table, 'xero_financial_audit_events');
      return { async insert(row) { events.push(structuredClone(row)); return { error: auditFails ? { code: 'storage' } : null }; } };
    },
    async rpc(name, args) {
      assert.equal(name, 'save_xero_financial_product_mapping_v1');
      assert.equal(events[0]?.outcome, 'started');
      calls.push(args);
      if (calls.length === failureAt) return { error: { code: '40001' } };
      mappings.push({ ...initial().changes[calls.length - 1].after, id: `mapping-${calls.length}`, revision: 1 });
      return { data: mappings.at(-1) };
    },
  };
  return { client, calls, events, mappings };
}

test('automatic saves use signed-in actor, expected revisions and durable before/after policy audit', async () => {
  const store = fakeStore();
  const before = { ...initial().changes[0].after, id: 'existing', revision: 3, xero_account_code: '40000' };
  const result = await approvePetroleumMappings({ products, accounts, taxRates, mappings: [before], client: store.client, actor });
  assert.equal(result.changedCount, 4);
  assert.equal(store.calls[0].p_mapping_id, 'existing');
  assert.equal(store.calls[0].p_expected_revision, 3);
  assert.equal(store.calls[1].p_expected_revision, null);
  assert.equal(store.calls[0].p_actor_id, actor.id);
  assert.equal(store.events[0].fingerprints.changes[0].before.accountCode, '40000');
  assert.equal(store.events[1].outcome, 'success');
  assert.equal(store.events[1].record_counts.completed, 4);
  const again = fakeStore();
  const second = await approvePetroleumMappings({ products, accounts, taxRates, mappings: store.mappings, client: again.client, actor });
  assert.equal(second.changedCount, 0);
  assert.equal(again.events.length, 0);
  assert.equal(again.calls.length, 0);
});

test('concurrent edits stop safely with partial audit; rerun skips approvals already completed', async () => {
  const store = fakeStore({ failureAt: 2 });
  await assert.rejects(approvePetroleumMappings({ products, accounts, taxRates, mappings: [], client: store.client, actor }), { code: 'XERO_FINANCIAL_STALE_WRITE' });
  assert.equal(store.calls.length, 2);
  assert.equal(store.events.at(-1).outcome, 'failed');
  assert.equal(store.events.at(-1).record_counts.completed, 1);
  assert.equal(petroleumMappingPlan(products, accounts, taxRates, store.mappings).changes.length, 3);
});

test('missing actor and failed intent audit prevent any mapping writes', async () => {
  for (const options of [{ actor: null }, { actor, auditFails: true }]) {
    const store = fakeStore(options);
    await assert.rejects(approvePetroleumMappings({ products, accounts, taxRates, mappings: [], client: store.client, actor: options.actor }));
    assert.equal(store.calls.length, 0);
  }
});

test('financial snapshot reads the complete product catalog independent of invoice dates and rejects truncation', async () => {
  const query = async (queries) => {
    assert.match(queries[0].soql, /SELECT Id, Name, RecordType.DeveloperName FROM Product2 ORDER BY Id/);
    assert.doesNotMatch(queries[0].soql, /IsActive|2026/);
    return [{ records: products, totalSize: products.length }, ...Array.from({ length: 4 }, () => ({ records: [], totalSize: 0 }))];
  };
  const snapshot = await loadSalesforceFinancialSnapshot('2026-01-01', query);
  assert.equal(snapshot.productRecords.length, 5);
  assert.equal(snapshot.products.length, 2);
  await assert.rejects(loadSalesforceFinancialSnapshot('2026-01-01', async () => []), { code: 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE' });
  await assert.rejects(loadSalesforceFinancialSnapshot('2026-01-01', async (queries) => {
    const result = await query(queries); result[0].totalSize += 1; return result;
  }), { code: 'XERO_FINANCIAL_SALESFORCE_INCOMPLETE' });
});
