import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoverSupplierFileCandidates, serializeSupplierFileDiscovery, supplierFileDiscoveryParents } from '../api/_xeroSupplierFileDiscovery.js';
import { xeroReviewFingerprint, toSyncItemRow, xeroFinancialSyncLatest, XERO_RECONCILIATION_VERSION } from '../api/_xeroFinancialSync.js';
import { documentReadiness } from '../api/_xeroDocumentSafety.js';
import { xeroPortalUiCopy } from '../src/lib/xeroPortalUiCopy.js';
const id = (prefix, index) => `${prefix}${String(index).padStart(12, '0')}`;
const parent = id('a06', 1);
const now = () => Date.parse('2026-09-26T07:00:00Z');
const row = (source = parent, index = 1, changes = {}) => ({ Id: id('06A', index), LinkedEntityId: source, ContentDocumentId: id('069', index), ContentDocument: { Id: id('069', index), Title: `Issued ${index}`, FileType: 'PDF', FileExtension: 'pdf', ContentSize: 1024, LatestPublishedVersionId: id('068', index), SystemModstamp: '2026-09-25T00:00:00.000Z', ...changes } });
const run = (records, totalSize = records.length, suppliers = [{ Id: parent }]) => discoverSupplierFileCandidates(suppliers, { now, querySalesforce: async () => [{ records, totalSize }] });

test('exact-parent complete PDF candidates retain shared documents without selecting or authorising', async () => {
  const other = id('a06', 2);
  const shared = row(other); shared.Id = id('06A', 2);
  const result = await run([row(), shared], 2, [{ Id: parent }, { Id: other }]);
  for (const source of [parent, other]) {
    const value = result.get(source);
    assert.equal(value.status, 'complete'); assert.equal(value.linkedPdfCount, 1);
    assert.equal(value.authoritative, false); assert.equal(value.contentVerified, false);
    assert.deepEqual(serializeSupplierFileDiscovery(value, source), value);
  }
  assert.equal(result.get(parent).candidates[0].documentId, result.get(other).candidates[0].documentId);
});

test('complete empty differs from failed and incomplete lookup; no raw errors escape', async () => {
  assert.equal((await run([])).get(parent).reasonCode, 'NO_PDF_CANDIDATES');
  assert.equal((await run([], 2)).get(parent).status, 'partial');
  const failed = await discoverSupplierFileCandidates([{ Id: parent }], { now, querySalesforce: async () => { throw new Error('secret response'); } });
  assert.equal(failed.get(parent).status, 'unavailable'); assert.ok(!JSON.stringify([...failed]).includes('secret'));
});

test('wrong parent, conflicting document join and malformed metadata cannot establish empty or full lookup', async () => {
  assert.equal((await run([row(id('a06', 9))])).get(parent).status, 'unavailable');
  const malformed = row(parent, 2); malformed.ContentDocument.Id = id('069', 8);
  assert.equal((await run([row(), malformed])).get(parent).status, 'partial');
  assert.equal((await run([row(parent, 1, { ContentSize: -1 })])).get(parent).status, 'unavailable');
  assert.equal((await run([row(), row()])).get(parent).status, 'partial');
});

test('15/18 parent equivalence retains case-sensitive identity and ignores suppliers with explicit file fields', async () => {
  const result = await run([row(`${parent}AAA`)], 1, [{ Id: parent }, { Id: `${parent}AAA` }, { Id: id('a06', 2), File__c: 'existing.pdf' }]);
  assert.equal(result.get(parent).linkedPdfCount, 1); assert.equal(result.get(`${parent}AAA`).linkedPdfCount, 1);
  assert.equal(result.has(id('a06', 2)), false);
  const upper = parent.replace('a', 'A'); assert.equal((await run([row(upper)])).get(parent).status, 'unavailable');
});

test('non-PDF metadata is excluded without being treated as an issued PDF', async () => {
  const result = await run([row(parent, 1, { FileType: 'WORD_X', FileExtension: 'docx' })]);
  assert.equal(result.get(parent).reasonCode, 'NO_PDF_CANDIDATES');
});

test('500 parent cap and batches100 are deterministic, with skipped parents explicit', async () => {
  const suppliers = Array.from({ length: 502 }, (_, index) => ({ Id: id('a06', 502 - index) }));
  const queries = [];
  const result = await discoverSupplierFileCandidates(suppliers, { now, querySalesforce: async (input) => { queries.push(input[0]); return [{ records: [], totalSize: 0 }]; } });
  assert.equal(queries.length, 5);
  for (const item of queries) assert.equal((item.soql.match(/'a06/g) || []).length, 100);
  assert.equal(result.get(id('a06', 501)).reasonCode, 'PARENT_LIMIT');
  assert.equal(result.get(id('a06', 1)).status, 'complete');
});

test('global2000 link cap stops later batches and preserves partial evidence', async () => {
  const suppliers = Array.from({ length: 101 }, (_, index) => ({ Id: id('a06', index + 1) }));
  let calls = 0;
  const result = await discoverSupplierFileCandidates(suppliers, { now, querySalesforce: async ([query]) => {
    calls++; assert.equal(query.limit, 2001);
    return [{ records: Array.from({ length: 2001 }, (_, index) => row(parent, index + 1)), totalSize: 2001 }];
  } });
  assert.equal(calls, 1); assert.equal(result.get(parent).candidates.length, 2000); assert.equal(result.get(parent).status, 'partial');
  assert.equal(result.get(id('a06', 101)).reasonCode, 'LOOKUP_STOPPED');
});

test('invalid source IDs never enter queries and stored metadata cannot impersonate another source', async () => {
  let called = false;
  const result = await discoverSupplierFileCandidates([{ Id: "bad' OR Id != null" }], { now, querySalesforce: async () => { called = true; } });
  assert.equal(called, false); assert.equal([...result.values()][0].reasonCode, 'INVALID_SOURCE_ID');
  const value = (await run([row()])).get(parent);
  assert.equal(serializeSupplierFileDiscovery(value, id('a06', 2)), null);
  assert.equal(serializeSupplierFileDiscovery({ ...value, candidates: [{ ...value.candidates[0], title: '\u0000' }] }, parent), null);
});

test('diagnostic preserves financial review fingerprint, payload, blockers and missing-file readiness', async () => {
  const invoice = { Id: parent, STEM__c: id('a0H', 1), Supplier__c: id('001', 1) };
  const child = { Id: id('a0L', 1), Supplier_Invoice__c: parent, STEM__c: invoice.STEM__c, Supplier__c: invoice.Supplier__c };
  const readiness = documentReadiness(invoice, 'supplier', [child], { fields: { Supplier_Invoice__c: ['Invoice_File__c'] } });
  const classification = { salesforceObject: 'Supplier_Invoice__c', salesforceId: parent, documentKind: 'supplier_bill', sourceFingerprint: 'unchanged', action: 'blocked', status: 'blocked', readiness, blockers: readiness.blockers, warnings: [], proposedPayload: null, differences: [] };
  const before = structuredClone(classification); const fingerprint = xeroReviewFingerprint(classification);
  classification.sourceFileDiscovery = (await run([row()])).get(parent);
  assert.equal(xeroReviewFingerprint(classification), fingerprint);
  assert.deepEqual(classification.readiness, before.readiness); assert.equal(classification.readiness.ready, false);
  assert.equal(classification.proposedPayload, null); assert.deepEqual(classification.blockers, before.blockers);
  const stored = toSyncItemRow(classification, 'run', 1);
  assert.deepEqual(stored.source_payload.sourceFileDiscovery, classification.sourceFileDiscovery);
});

test('integration is confined to preview and UI copy is bilingual with explicit observational limitations', async () => {
  const source = await readFile(new URL('../api/_xeroFinancialSync.js', import.meta.url), 'utf8');
  assert.equal((source.match(/await discoverSupplierFileCandidates\(/g) || []).length, 1);
  assert.ok(source.indexOf('const classified = buildFinancialClassifications') < source.indexOf('await discoverSupplierFileCandidates'));
  for (const language of ['en', 'zh-Hant']) {
    const copy = xeroPortalUiCopy(language).financial.fileDiscovery;
    for (const name of ['title', 'description', 'captured', 'stale', 'partial', 'unavailable', 'not_checked']) assert.ok(copy[name]);
    assert.ok(copy.displayLimit(5, 12).includes('12'));
  }
});


test('preview parent selection only inspects server-classified blocked suppliers with blank file fields', async () => {
  const eligible = id('a06', 2), knownFile = id('a06', 3), unrelated = id('a06', 4);
  const suppliers = [{ Id: parent }, { Id: eligible }, { Id: knownFile, Invoice_File__c: 'explicit.pdf' }, { Id: unrelated }];
  const classified = [
    { salesforceObject: 'Supplier_Invoice__c', salesforceId: parent, status: 'blocked' },
    { salesforceObject: 'Supplier_Invoice__c', salesforceId: eligible, status: 'eligible', action: 'create_draft' },
    { salesforceObject: 'Supplier_Invoice__c', salesforceId: knownFile, action: 'blocked' },
    { salesforceObject: 'Invoice__c', salesforceId: unrelated, status: 'blocked' },
  ];
  const originals = structuredClone({ suppliers, classified }); let soql;
  const result = await discoverSupplierFileCandidates(supplierFileDiscoveryParents(suppliers, classified), { now, querySalesforce: async ([query]) => { soql = query.soql; return [{ records: [row()], totalSize: 1 }]; } });
  assert.ok(soql.includes(parent)); assert.ok(!soql.includes(eligible)); assert.ok(!soql.includes(knownFile)); assert.ok(!soql.includes(unrelated));
  assert.equal(result.get(parent).status, 'complete'); assert.equal(result.has(eligible), false);
  assert.deepEqual({ suppliers, classified }, originals);
});


test('saved preview serialization retains bounded metadata and old rows remain unchecked without provider access', async () => {
  const discovery = (await run([row()])).get(parent);
  const source = { salesforceObject: 'Supplier_Invoice__c', salesforceId: parent, sourceFileDiscovery: discovery, sourceFingerprint: 'same', blockers: ['Supplier invoice has no verified issued source file.'], warnings: [], lines: [] };
  const item = toSyncItemRow({ ...source, action: 'blocked', status: 'blocked' }, 'run', 0, '2026-09-26T07:00:00Z');
  const old = { ...item, id: 'old', source_payload: { ...source, sourceFileDiscovery: undefined, salesforceId: id('a06', 2) } };
  const calls = [];
  const client = { from(table) {
    calls.push(table);
    const response = { data: table === 'xero_financial_sync_runs' ? [{ id: 'run', control_totals: { workflowSnapshot: { reconciliationVersion: XERO_RECONCILIATION_VERSION } } }] : [item, old], error: null };
    const query = { select: () => query, eq: () => query, not: () => query, order: () => query, limit: async () => response, range: async () => response }; return query;
  } };
  const result = await xeroFinancialSyncLatest({}, { client });
  assert.deepEqual(result.preview.rows[0].sourceFileDiscovery, discovery);
  assert.equal(result.preview.rows[1].sourceFileDiscovery, null);
  assert.deepEqual(calls, ['xero_financial_sync_runs', 'xero_financial_sync_items']);
  assert.equal(result.preview.rows[0].action, 'blocked'); assert.deepEqual(result.preview.rows[0].blockers, source.blockers);
});


test('later-page failure charges returned links, retains partial candidates and stops subsequent batches', async () => {
  const suppliers = Array.from({ length: 101 }, (_, index) => ({ Id: id('a06', index + 1) }));
  const queries = [];
  const result = await discoverSupplierFileCandidates(suppliers, { now, querySalesforce: async ([query]) => {
    queries.push(query); return [{ records: Array.from({ length: 1500 }, (_, index) => row(parent, index + 1)), totalSize: 3000, error: 'next-page failed' }];
  } });
  assert.equal(queries.length, 1); assert.match(queries[0].soql, / LIMIT 2001$/); assert.equal(queries[0].limit, 2001);
  assert.equal(result.get(parent).status, 'partial'); assert.equal(result.get(parent).linkedPdfCount, 1500);
  assert.equal(result.get(id('a06', 2)).status, 'unavailable');
  assert.equal(result.get(id('a06', 101)).status, 'not_checked'); assert.equal(result.get(id('a06', 101)).reasonCode, 'LOOKUP_STOPPED');
  assert.ok(!JSON.stringify([...result]).includes('next-page failed'));
});

test('hard SOQL limits enforce the global2000 budget plus one sentinel across completed batches', async () => {
  const suppliers = Array.from({ length: 201 }, (_, index) => ({ Id: id('a06', index + 1) }));
  let calls = 0, observed = 0; const limits = [];
  const result = await discoverSupplierFileCandidates(suppliers, { now, querySalesforce: async ([query]) => {
    calls++; limits.push(query.limit); assert.match(query.soql, new RegExp(` LIMIT ${query.limit}$`));
    const count = calls === 1 ? 1500 : 501; observed += count;
    return [{ records: Array.from({ length: count }, (_, index) => row(calls === 1 ? parent : id('a06', 101), index + 1)), totalSize: count }];
  } });
  assert.deepEqual(limits, [2001, 501]); assert.equal(observed, 2001); assert.equal(calls, 2);
  assert.equal(result.get(id('a06', 101)).linkedPdfCount, 500); assert.equal(result.get(id('a06', 101)).status, 'partial');
  assert.equal(result.get(id('a06', 201)).status, 'not_checked');
});

test('incomplete empty lookup stops later batches without asserting absence', async () => {
  let calls = 0;
  const suppliers = Array.from({ length: 101 }, (_, index) => ({ Id: id('a06', index + 1) }));
  const result = await discoverSupplierFileCandidates(suppliers, { now, querySalesforce: async () => { calls++; return [{ records: [], totalSize: 1 }]; } });
  assert.equal(calls, 1); assert.equal(result.get(parent).status, 'partial'); assert.equal(result.get(id('a06', 101)).status, 'not_checked');
});
