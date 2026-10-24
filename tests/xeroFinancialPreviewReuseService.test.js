import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { financialPreviewChanges, xeroFinancialSyncLatest, xeroFinancialSyncPreview } from '../api/_xeroFinancialSync.js';
import { fixture } from './xeroFinancialPreviewFixtures.js';

function atomicFixture(options = {}) {
  const f = fixture({ count: 2, ...options });
  const rpcCalls = []; const providerCalls = []; const trace = [];
  for (const name of ['getConnection', 'loadSafetyContext', 'loadSalesforce', 'loadPayments', 'loadXero', 'accountingFetch', 'paymentPreview']) {
    const original = f.dependencies[name];
    f.dependencies[name] = async (...args) => {
      providerCalls.push(name); trace.push(name);
      return original(...args);
    };
  }
  f.dependencies.fetchImpl = async () => { throw new Error('No live provider request is permitted'); };
  // This fixture represents the storage contract, not SQL reuse eligibility.
  // Individual tests script the database's new/reused/error response.
  const commit = (parameters) => {
    const run = { ...structuredClone(parameters.p_run), status: 'ready_for_review' };
    const items = structuredClone(parameters.p_items);
    (f.tables.xero_financial_sync_runs ||= []).push(run);
    (f.tables.xero_financial_sync_items ||= []).push(...items);
    (f.tables.xero_financial_audit_events ||= []).push({ run_id: run.id, event_type: 'preview_completed', outcome: 'success' });
    return run;
  };
  const response = (run, reused) => ({ data: { run: structuredClone(run), reused,
    items: f.tables.xero_financial_sync_items.filter(item => item.run_id === run.id).map(item => ({ id: item.id, row_key: item.row_key })) } });
  let implementation = async parameters => response(commit(parameters), false);
  f.client.rpc = async (name, parameters) => {
    trace.push('rpc'); rpcCalls.push({ name, parameters: structuredClone(parameters) });
    assert.equal(name, 'persist_xero_financial_preview_v1');
    return implementation(parameters);
  };
  return { ...f, rpcCalls, providerCalls, trace, commit, response,
    setRpc(next) { implementation = next; } };
}

function assertOnlyReads(f) {
  assert.ok(f.calls.every(call => call.operation === 'select'), 'API must leave all persistence to its one RPC');
}

test('pure complete check persists through one RPC after reads and returns saved row IDs', async () => {
  const f = atomicFixture();
  const result = await xeroFinancialSyncPreview({ includePayments: true, recordExactMatches: false }, f.dependencies);
  assert.equal(f.rpcCalls.length, 1);
  assertOnlyReads(f);
  assert.equal(f.trace.at(-1), 'rpc');
  assert.deepEqual(f.providerCalls, ['getConnection', 'loadSafetyContext', 'loadSalesforce', 'loadPayments', 'loadXero',
    'accountingFetch', 'accountingFetch', 'paymentPreview']);
  assert.equal(result.reused, false);
  assert.equal(result.run.status, 'ready_for_review');
  assert.deepEqual(result.rows.map(row => row.id), f.tables.xero_financial_sync_items.map(item => item.id));
  assert.equal(f.rpcCalls[0].parameters.p_run.control_totals.workflowSnapshot.complete, true);
});

test('reuse restores stored IDs, snapshot time and original actor after full fresh reads', async () => {
  const f = atomicFixture();
  const originalActor = { id: randomUUID(), email: 'original@example.test' };
  f.dependencies.accessContext = { profile: originalActor };
  await xeroFinancialSyncPreview({ includePayments: true }, f.dependencies);
  const saved = f.tables.xero_financial_sync_runs[0];
  saved.created_at = '2026-09-01T01:00:00.000Z';
  saved.control_totals.workflowSnapshot.checkedAt = '2026-09-01T01:00:00.000Z';
  assert.equal(saved.created_by, originalActor.id);
  assert.equal(saved.created_by_email, originalActor.email);
  const savedItems = structuredClone(f.tables.xero_financial_sync_items);
  const nextActor = { id: randomUUID(), email: 'next@example.test' };
  f.dependencies.accessContext = { profile: nextActor };
  f.setRpc(async parameters => {
    assert.notEqual(parameters.p_run.id, saved.id);
    assert.equal(parameters.p_run.created_by, nextActor.id);
    assert.equal(parameters.p_run.created_by_email, nextActor.email);
    assert.equal(parameters.p_review_identity, saved.control_totals.workflowSnapshot.reviewIdentity);
    return f.response(saved, true);
  });
  const result = await xeroFinancialSyncPreview({ includePayments: true }, f.dependencies);
  assert.equal(result.reused, true);
  assert.equal(result.restored, true);
  assert.equal(result.run.id, saved.id);
  assert.equal(result.run.createdAt, '2026-09-01T01:00:00.000Z');
  assert.equal(result.checkedAt, '2026-09-01T01:00:00.000Z');
  assert.deepEqual(result.rows.map(row => row.id), savedItems.map(item => item.id));
  assert.equal(f.tables.xero_financial_sync_runs.length, 1);
  assert.equal(f.tables.xero_financial_sync_runs[0].created_by, originalActor.id);
  assert.equal(f.tables.xero_financial_sync_runs[0].created_by_email, originalActor.email);
  assert.equal(f.tables.xero_financial_audit_events.length, 1);
  assert.equal(f.providerCalls.filter(name => name === 'loadSalesforce').length, 2);
  assert.equal(f.providerCalls.filter(name => name === 'loadXero').length, 2);
  assertOnlyReads(f);
});

test('documents-only pure check stores a restorable complete workflow snapshot with payments null', async () => {
  const f = atomicFixture();
  const result = await xeroFinancialSyncPreview({}, f.dependencies);
  const snapshot = f.tables.xero_financial_sync_runs[0].control_totals.workflowSnapshot;
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.includePayments, false);
  assert.equal(snapshot.payments, null);
  assert.equal(result.payments, null);
  assert.equal(f.providerCalls.includes('loadPayments'), false);
  assert.equal(f.providerCalls.includes('paymentPreview'), false);
  const restored = (await xeroFinancialSyncLatest({}, { client: f.client })).preview;
  assert.equal(restored.run.id, result.run.id);
  assert.equal(restored.payments, null);
  assert.deepEqual(restored.rows.map(row => row.id), result.rows.map(row => row.id));
  assert.equal(f.rpcCalls.length, 1);
  assertOnlyReads(f);
});

test('requested exact-match check keeps its publication flow and never invokes atomic reuse RPC', async () => {
  const f = atomicFixture({ count: 1, exact: true });
  const result = await xeroFinancialSyncPreview({ recordExactMatches: true, includePayments: true }, f.dependencies);
  assert.equal(result.run.status, 'ready_for_review');
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(f.tables.xero_financial_document_mappings.length, 1);
  assert.ok(f.calls.some(call => call.stage === 'publish'));
});

test('atomic persistence error preserves the preceding complete review', async () => {
  const f = atomicFixture();
  const first = await xeroFinancialSyncPreview({ includePayments: true }, f.dependencies);
  const before = structuredClone(f.tables);
  f.salesforce.buyers[0].Amount__c = 200;
  f.setRpc(async () => ({ data: null, error: { code: 'P0001', message: 'Injected atomic failure' }, status: 400 }));
  await assert.rejects(xeroFinancialSyncPreview({ includePayments: true }, f.dependencies), { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
  assert.deepEqual(f.tables, before);
  assert.equal((await xeroFinancialSyncLatest({}, { client: f.client })).preview.run.id, first.run.id);
  assert.equal(f.rpcCalls.length, 2);
  assertOnlyReads(f);
});

test('same-UUID recovery after response loss restores the subsequently authorised selected state', async () => {
  const f = atomicFixture({ count: 1, exact: true });
  let saved; let firstParameters;
  f.setRpc(async parameters => {
    if (!saved) {
      firstParameters = structuredClone(parameters);
      saved = f.commit(parameters);
      saved.status = 'authorised'; saved.revision = 2;
      f.tables.xero_financial_sync_items[0].status = 'selected';
      f.tables.xero_financial_sync_items[0].selected = true;
      throw new TypeError('Injected response loss after commit');
    }
    assert.deepEqual(parameters, firstParameters, 'retry must reuse exact UUID and evidence');
    return f.response(saved, true);
  });
  const result = await xeroFinancialSyncPreview({ includePayments: true }, f.dependencies);
  assert.equal(f.rpcCalls.length, 2);
  assert.equal(f.tables.xero_financial_sync_runs.length, 1);
  assert.equal(f.tables.xero_financial_audit_events.length, 1);
  assert.equal(result.reused, true);
  assert.equal(result.run.id, saved.id);
  assert.equal(result.run.status, 'authorised');
  assert.equal(result.run.revision, 2);
  assert.equal(result.rows[0].id, f.tables.xero_financial_sync_items[0].id);
  assert.equal(result.rows[0].status, 'selected');
  assert.equal(result.rows[0].selected, true);
  assertOnlyReads(f);
});

test('payment/document tenant mismatch fails before any financial persistence', async () => {
  const f = atomicFixture();
  f.paymentSnapshot.tenantId = randomUUID();
  await assert.rejects(xeroFinancialSyncPreview({ includePayments: true }, f.dependencies), { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(f.tables.xero_financial_sync_runs, undefined);
  assert.equal(f.tables.xero_financial_sync_items, undefined);
  assert.equal(f.tables.xero_financial_audit_events, undefined);
  assertOnlyReads(f);
});


for (const initialPayments of [false, true]) {
  test(`restored pure ${initialPayments ? 'payment' : 'documents-only'} check cannot suppress the exact-linking payment pass`, async () => {
    const f = atomicFixture({ count: 1, exact: true });
    const first = await xeroFinancialSyncPreview({ includePayments: initialPayments, recordExactMatches: false }, f.dependencies);
    const restored = (await xeroFinancialSyncLatest({}, { client: f.client })).preview;
    assert.equal(restored.run.id, first.run.id);
    assert.equal(restored.run.controlTotals.workflowSnapshot.includePayments, initialPayments);
    assert.equal(restored.run.controlTotals.workflowSnapshot.recordExactMatches, false);
    const previousPaymentCalls = f.providerCalls.filter(name => name === 'paymentPreview').length;
    const second = await xeroFinancialSyncPreview({ includePayments: true, recordExactMatches: true,
      refreshIfChangedRunId: restored.run.id }, f.dependencies);
    assert.equal(second.unchanged, undefined);
    assert.equal(second.run.status, 'ready_for_review');
    assert.notEqual(second.run.id, first.run.id);
    assert.equal(f.providerCalls.filter(name => name === 'paymentPreview').length, previousPaymentCalls + 1);
    assert.equal(f.providerCalls.filter(name => name === 'loadSalesforce').length, 2);
    assert.equal(f.providerCalls.filter(name => name === 'loadXero').length, 2);
    assert.equal(f.providerCalls.filter(name => name === 'accountingFetch').length, 4,
      'scope mismatch must skip the background modified-since probes');
    assert.equal(f.rpcCalls.length, 1, 'broader exact-linking pass retains the legacy publication path');
    assert.equal(f.tables.xero_financial_document_mappings.length, 1);
    assert.ok(f.calls.some(call => call.stage === 'publish'));
    assert.equal(second.run.controlTotals.workflowSnapshot.includePayments, true);
    assert.equal(second.run.controlTotals.workflowSnapshot.recordExactMatches, true);
    assert.equal(second.run.controlTotals.workflowSnapshot.tenantId, f.paymentSnapshot.tenantId);
  });
}

test('legacy unknown workflow scope forces a complete fresh check before provider probes', async () => {
  const f = atomicFixture({ count: 1, exact: true });
  const first = await xeroFinancialSyncPreview({ includePayments: true }, f.dependencies);
  const snapshot = f.tables.xero_financial_sync_runs[0].control_totals.workflowSnapshot;
  delete snapshot.includePayments;
  delete snapshot.recordExactMatches;
  const beforeCalls = f.calls.length;
  const probe = await financialPreviewChanges(first.run.id, { client: f.client,
    connection: { tenantId: f.paymentSnapshot.tenantId }, includePayments: true, recordExactMatches: true,
    querySalesforce: async () => { throw new Error('Unknown scope must not query Salesforce changes'); },
    accountingFetch: async () => { throw new Error('Unknown scope must not query Xero changes'); },
  });
  assert.equal(probe.changed, true);
  assert.deepEqual(f.calls.slice(beforeCalls).map(call => call.table), ['xero_financial_sync_runs']);
  const second = await xeroFinancialSyncPreview({ includePayments: true, recordExactMatches: true,
    refreshIfChangedRunId: first.run.id }, f.dependencies);
  assert.equal(second.unchanged, undefined);
  assert.equal(second.run.status, 'ready_for_review');
  assert.equal(f.providerCalls.filter(name => name === 'paymentPreview').length, 2);
  assert.equal(f.providerCalls.filter(name => name === 'accountingFetch').length, 4);
  assert.equal(f.rpcCalls.length, 1);
  assert.equal(f.tables.xero_financial_document_mappings.length, 1);
});
