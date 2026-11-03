import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecordDraft } from '../src/lib/recordDraft.js';
import { acknowledgeVariableChargeSide } from '../src/lib/variableChargeDraft.js';
import { routineReviewNote, ROUTINE_COST_NOTE, ROUTINE_BUYER_NOTE } from '../shared/routineReviewNote.js';
import { systemIncidentPresentation } from '../shared/systemIncidentPresentation.js';
import { createSystemIncidentVerifier } from '../api/_systemIncidentRecovery.js';
import { createWorkspaceSearch, searchLiteral } from '../api/_workspaceSearch.js';
import { createStemWorkspaceActivity } from '../api/_stemWorkspaceActivity.js';
import { createWorkflowMetricsReader } from '../api/_workflowMetrics.js';
import { restoreReviewSelection, reviewSelectionSnapshot, documentReviewTotals } from '../src/lib/financialWorkflowUi.js';
import { cashflowExplanation, changedCashflowRows } from '../src/lib/cashflowExplanation.js';
import { readFile } from 'node:fs/promises';
import * as methodologySource from '../src/lib/pageMethodologies.js';
import * as methodologyIndex from '../src/lib/pageMethodologyIndex.js';

test('on-demand methodology assets preserve all authoritative source text and descriptors', async () => {
  const documents = JSON.parse(await readFile(new URL('../src/content/page-methodologies.json', import.meta.url), 'utf8'));
  for (const [name, value] of Object.entries(methodologySource)) {
    const pairs = value.title ? [[value, methodologyIndex[name]]] : Object.entries(value).map(([key, document]) => [document, methodologyIndex[name][key]]);
    for (const [document, descriptor] of pairs) {
      assert.deepEqual(documents[descriptor.contentKey], document);
      assert.equal(descriptor.title, document.title);
      assert.equal(descriptor.sections, undefined);
    }
  }
});

test('dispute search omits inaccessible STEM candidates after authoritative scope validation', async () => {
  const allowed = 'a0H000000000001AAA';
  const forbidden = 'a0H000000000002AAA';
  const builder = { select() { return this; }, ilike() { return this; }, order() { return this; }, async limit() {
    return { data: [{ id: 'one', stem_id: allowed, stem_name: 'STEM 1' }, { id: 'two', stem_id: forbidden, stem_name: 'STEM 2' }] };
  } };
  const search = createWorkspaceSearch({ userHasAnyModuleAccess: async (_client, _profile, modules) => modules.includes('disputes'),
    salesforceObjectFields: async () => ({ fields: [{ name: 'Name' }] }),
    interofficeStemAccessCondition: async () => "Office__c = 'Hong Kong'",
    queryRows: async (query) => {
      assert.match(query, /Office__c = 'Hong Kong'/);
      return query.startsWith('SELECT Id FROM') ? [{ Id: allowed }] : [];
    } });
  const result = await search({ query: 'STEM' }, null, { profile: {}, client: { from: () => builder } });
  assert.deepEqual(result.results.map((row) => row.stemId), [allowed]);
  assert.equal(result.results[0].link, `/disputes?stem=${allowed}`);
});

test('three-way recovery retains independent edits and identifies changed source fields', () => {
  const recovered = mergeRecordDraft({ price: 10, note: 'old', quantity: 1 },
    { price: 12, note: 'edited', quantity: 1 }, { price: 15, note: 'old', quantity: 2 });
  assert.deepEqual(recovered.value, { price: 15, note: 'edited', quantity: 2 });
  assert.deepEqual(recovered.conflicts.map((row) => row.field), ['price']);
});

test('deleted source rows are not resurrected and array identities are not interleaved', () => {
  const recovered = mergeRecordDraft({ row: { cost: 1 }, actions: [{ id: 'a' }] },
    { row: { cost: 2 }, actions: [{ id: 'b' }] }, { actions: [{ id: 'c' }] });
  assert.deepEqual(recovered.value, { actions: [{ id: 'c' }] });
  assert.equal(recovered.conflicts.length, 2);
  assert.equal({}.polluted, undefined);
  mergeRecordDraft({}, JSON.parse('{"__proto__":{"polluted":true}}'), {});
  assert.equal({}.polluted, undefined);
});

test('cost confirmation preserves the buyer edit and all other supplier drafts', () => {
  const base = { reviews: { a: { outcome: '', buyerChargeDecision: 'include' }, b: { outcome: '' } },
    extraDrafts: { a: { supplierCost: 10, buyerPrice: 15 }, b: { supplierCost: 20 } },
    supplierReviewNotes: {}, buyerReviewNotes: {}, addDrafts: [] };
  const draft = structuredClone(base);
  draft.extraDrafts.a = { supplierCost: 12, buyerPrice: 18 };
  draft.extraDrafts.b.supplierCost = 25;
  draft.reviews.a.outcome = 'changed';
  draft.addDrafts = [{ supplierAccountId: 'supplier-b', localId: 'new' }];
  const retire = (value) => acknowledgeVariableChargeSide(value, [{ key: 'a', sourceId: 'a' }], 'supplier-a', ['cost']);
  const current = structuredClone(base);
  current.extraDrafts.a.supplierCost = 12;
  const recovered = mergeRecordDraft(retire(base), retire(draft), current);
  assert.deepEqual(recovered.value.extraDrafts, { a: { supplierCost: 12, buyerPrice: 18 }, b: { supplierCost: 25 } });
  assert.equal(recovered.value.addDrafts[0].localId, 'new');
  assert.equal(recovered.conflicts.length, 0);
});

test('routine notes require every exact current row and no requested writes', () => {
  const body = { rowOutcomes: [{ sourceId: 'a', outcome: 'correct' }] };
  assert.equal(routineReviewNote(body, 'cost', ['a']), ROUTINE_COST_NOTE);
  assert.equal(routineReviewNote(body, 'cost', ['a', 'b']), '');
  assert.equal(routineReviewNote({ ...body, extraCostUpdates: [{ extraCostId: 'a' }] }, 'cost', ['a']), '');
  assert.equal(routineReviewNote({ rowOutcomes: [{ sourceId: 'a', outcome: 'cancelled' }] }, 'cost', ['a']), '');
  assert.equal(routineReviewNote({ rowChargeDecisions: [{ sourceId: 'a', decision: 'include' }] }, 'buyer_charge', ['a']), ROUTINE_BUYER_NOTE);
  assert.equal(routineReviewNote({ rowChargeDecisions: [{ sourceId: 'a', decision: 'exclude' }] }, 'buyer_charge', ['a']), '');
});

test('connectivity recovery never resolves uncertain email delivery', async () => {
  let resolved = false;
  const builder = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { handler: 'buyerInvoicePaymentReminderSend' } }; } };
  const verifier = createSystemIncidentVerifier({ requireAdministratorContext() {}, validSystemErrorSignature: () => true,
    resolveGraphEmailSender: async () => ({}), salesforceObjectFields: async () => ({}),
    resolveSystemErrorIncident: async () => { resolved = true; return { resolved: 1 }; } });
  const result = await verifier({ incidentSignature: 'a'.repeat(64) }, null, { client: { from: () => builder } });
  assert.equal(result.verified, false);
  assert.equal(result.connectivityVerified, true);
  assert.equal(resolved, false);
  assert.equal(systemIncidentPresentation('dashboardAnalytics').severity, 'warning');
  assert.equal(systemIncidentPresentation('unknownFinancialWrite').severity, 'critical');
});

test('workspace search restricts modules and applies the STEM scope before returning results', async () => {
  const queries = [];
  const search = createWorkspaceSearch({ userHasAnyModuleAccess: async (_client, _profile, modules) => modules.includes('disputes'),
    salesforceObjectFields: async () => ({ fields: [{ name: 'Name' }, { name: 'KeyStem__c' }] }),
    interofficeStemAccessCondition: async () => "Account__r.Group_Name__c != 'Restricted'",
    queryRows: async (query) => { queries.push(query); return [{ Id: 'allowed', Name: 'STEM 42' }]; },
    loadDashboardCounterpartySearch: async () => { throw new Error('must not access Accounts'); } });
  const result = await search({ query: "STEM' OR Name != '" }, null, { client: {}, profile: {} });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /AND \(Account__r.Group_Name__c != 'Restricted'\)/);
  assert.match(queries[0], /LIMIT 8$/);
  assert.equal(result.results[0].stemId, 'allowed');
  assert.equal(result.counterparties.length, 0);
  assert.equal(searchLiteral("a_%'"), "a\\_\\%\\'");
});

test('search fails closed when authority cannot establish record scope', async () => {
  let queried = false;
  const search = createWorkspaceSearch({ userHasAnyModuleAccess: async () => true,
    salesforceObjectFields: async () => ({ fields: [] }), interofficeStemAccessCondition: async () => { throw new Error('scope unavailable'); },
    queryRows: async () => { queried = true; return []; } });
  await assert.rejects(search({ query: 'STEM' }, null, { client: {}, profile: {} }), /scope unavailable/);
  assert.equal(queried, false);
});

test('saved review selection rejects changed, completed and uncertain rows and keeps currencies separate', () => {
  const base = { id: 'old', salesforceObject: 'Invoice__c', salesforceId: 'invoice', reviewFingerprint: 'review', sourceFingerprint: 'source', status: 'eligible', action: 'create_draft' };
  const saved = reviewSelectionSnapshot([base], new Set(['old']));
  assert.deepEqual([...restoreReviewSelection(saved, [{ ...base, id: 'new' }])], ['new']);
  for (const change of [{ reviewFingerprint: 'changed' }, { sourceFingerprint: 'changed' }, { status: 'created' }, { status: 'uncertain' }]) {
    assert.equal(restoreReviewSelection(saved, [{ ...base, ...change }]).size, 0);
  }
  assert.deepEqual(documentReviewTotals([{ currency: 'HKD', action: 'create_draft', total: 780 }, { currency: 'USD', action: 'create_draft', total: 100 }]).map((row) => [row.currency, row.total]), [['HKD', 780], ['USD', 100]]);
});

test('STEM activity checks authoritative scope and reports source failures without hiding successful events', async () => {
  let scoped = false;
  const sourceCalls = [];
  const client = { from(table) {
    assert.equal(scoped, true); sourceCalls.push(table);
    return { select() { return this; }, eq() { return this; }, order() { return this; }, async limit() {
      return table === 'variable_charge_events' ? { error: new Error('unavailable') }
        : { data: [{ id: 'one', event_type: 'reviewed', created_at: '2026-09-16T01:00:00Z' }] };
    } };
  } };
  const handler = createStemWorkspaceActivity({ resolveStemId: async () => { scoped = true; return 'stem'; },
    userHasAnyModuleAccess: async (_client, _profile, modules) => modules.includes('buyer_invoices') });
  const result = await handler({ stemId: 'stem' }, null, { client, profile: {} });
  assert.deepEqual(sourceCalls, ['buyer_invoice_collection_events', 'variable_charge_events']);
  assert.deepEqual(result.unavailableSources, ['Variable charges']);
  assert.equal(result.events.length, 1);
});

test('metrics are denied before database reads for every non-administrator', async () => {
  let reads = 0;
  const reader = createWorkflowMetricsReader({ requireAdministratorContext: ({ profile }) => {
    if (!profile.administrator) throw new Error('Administrator required');
  } });
  for (const role of ['trader', 'finance', 'general_manager']) {
    await assert.rejects(reader({}, null, { profile: { role }, client: { from() { reads += 1; } } }), /Administrator required/);
  }
  assert.equal(reads, 0);
});

test('cashflow explanation does not equate due dates to bank evidence or no samples to confidence', () => {
  assert.equal(cashflowExplanation({ modelLevel: 'Contractual due date' }).confidence, 'Scheduled');
  assert.match(cashflowExplanation({ sampleCount: 0 }).reason, /uncertain/);
  const before = [{ id: 'one', amount: 0, forecastDate: '2026-09-16', sampleCount: 2 }];
  assert.deepEqual(changedCashflowRows(before, [{ ...before[0] }]), []);
  assert.deepEqual(changedCashflowRows(before, [{ ...before[0], sampleCount: 3 }])[0].changes, ['sampleCount']);
});
