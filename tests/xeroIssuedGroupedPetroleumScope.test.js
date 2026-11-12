import assert from 'node:assert/strict';
import test from 'node:test';
import { collectGroupedPetroleumPreservationScope } from '../api/_xeroIssuedGroupedPetroleumScope.js';
import { evaluateGroupedPetroleumFinancialDocument } from '../api/_xeroIssuedGroupedPetroleumPreservationAdapter.js';
import { issuedGroupedPetroleumFixture } from './xeroIssuedGroupedPetroleumPreservationFixtures.js';
import { buildFinancialClassifications } from '../api/_xeroFinancialSync.js';

const invalid = { code: 'XERO_GROUPED_PETROLEUM_SCOPE_INCOMPLETE' };
function fixture(direction = 'supplier') {
  const f = issuedGroupedPetroleumFixture({ direction });
  const rows = { Organization: [{ Id: f.fileEvidence.orgId, IsSandbox: false }],
    [direction === 'buyer' ? 'Invoice__c' : 'Supplier_Invoice__c']: [f.parent],
    STEM_Line_Item__c: [...f.lines, { ...f.lines[0], Id: 'a05000000000999', Cancelled__c: true,
      Buyer_Invoice__c: null, Supplier_Invoice__c: null }],
    STEM_Extra_Cost__c: [], Product2: f.products };
  const queries = [], calls = [];
  const read = async (soql, all) => {
    const table = /\bFROM (\w+)/.exec(soql)?.[1];
    assert.ok(Object.hasOwn(rows, table));
    queries.push({ table, soql, all });
    return { records: structuredClone(rows[table]), totalSize: rows[table].length };
  };
  const options = {
    query: soql => read(soql, false),
    queryAll: soql => read(soql, true),
    accountingFetch: async (_connection, path, { method }) => {
      assert.equal(method, 'GET'); calls.push(path);
      if (path.startsWith('/Invoices?')) return { Invoices: [structuredClone(f.raw)] };
      if (path.startsWith('/CreditNotes?')) return { CreditNotes: [] };
      if (path === '/Accounts') return { Accounts: f.scope.accountTax.accounts };
      if (path === '/TaxRates') return { TaxRates: f.scope.accountTax.taxRates };
      assert.fail('unexpected Xero route');
    },
  };
  const input = { records: f.packet.records, connection: { tenantId: f.ids.tenant }, salesforce: f.salesforce,
    xero: f.xero, sources: [f.source], stored: f.stored };
  return { f, rows, queries, calls, options, input };
}

for (const direction of ['buyer', 'supplier']) test(`collects complete typed ${direction} evidence and proves preservation`, async () => {
  const { f, queries, calls, options, input } = fixture(direction);
  const scope = await collectGroupedPetroleumPreservationScope(input, options);
  assert.equal(queries.length, 5);
  assert.equal(calls.length, 4);
  assert.ok(queries.filter(row => row.table !== 'Organization').every(row => row.all === true));
  assert.match(queries.find(row => row.table === 'STEM_Line_Item__c').soql, /STEM__c IN.* OR .*Invoice__c IN/);
  assert.doesNotMatch(queries.find(row => row.table === 'STEM_Line_Item__c').soql, /Cancelled__c = false/);
  const facts = scope.sourceFacts.get(f.ids.source);
  assert.equal(facts.lines.length, 2);
  assert.equal(facts.stemLines.length, 3);
  assert.equal(facts.stemLines.find(row => row.Cancelled__c).Id, 'a05000000000999');
  const result = evaluateGroupedPetroleumFinancialDocument(f.source, f.candidate, { ...f.context, groupedPetroleum: scope }, f.fileEvidence);
  assert.equal(result.eligible, true, JSON.stringify(result.blockers));
});

test('provider incompleteness, scope leakage and child drift stop before Xero history', async () => {
  for (const change of [
    ({ rows }) => { rows.Organization[0].IsSandbox = true; },
    ({ rows }) => { rows.STEM_Line_Item__c[0] = { ...rows.STEM_Line_Item__c[0], STEM__c: 'a0H000000000099' }; },
    ({ rows }) => { rows.STEM_Line_Item__c.splice(0, 1); },
    ({ rows }) => { rows.Product2.pop(); },
    ({ rows }) => { rows.STEM_Line_Item__c.push(rows.STEM_Line_Item__c[0]); },
    ({ options }) => { options.queryAll = async () => ({ records: [], totalSize: 1 }); },
  ]) {
    const value = fixture();
    change(value);
    await assert.rejects(collectGroupedPetroleumPreservationScope(value.input, value.options), invalid);
    assert.equal(value.calls.length, 0);
  }
});

test('ordinary buyer classification holds a grouped ownership receipt under the 18-character alias', () => {
  const { f } = fixture('buyer');
  f.stored.documentMappings.push({
    salesforce_object: 'Invoice__c', salesforce_id: `${f.ids.source}EAA`, protected_legacy: true,
    xero_document_id: f.ids.target, retained_differences: {
      issuedSupplierPreservation: { policyVersion: f.packet.policyVersion },
    },
  });
  const { rows } = buildFinancialClassifications(f.salesforce, f.xero, f.stored);
  const row = rows.find(row => row.salesforceId === f.ids.source);
  assert.equal(row.action, 'blocked');
  assert.equal(row.issuedSupplierPreservation.accepted, true);
  assert.equal(row.proposedPayload, null);
});
