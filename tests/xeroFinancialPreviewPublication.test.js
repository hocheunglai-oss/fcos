import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { financialPreviewChanges, xeroFinancialSyncLatest, xeroFinancialSyncPreview, XERO_RECONCILIATION_VERSION } from '../api/_xeroFinancialSync.js';
import { fixture } from './xeroFinancialPreviewFixtures.js';

for (const failAt of ['items:2', 'payments', 'snapshot', 'audit', 'publish']) {
  test(`preview stays unpublished after ${failAt} failure`, async () => {
    const f = fixture({ failAt });
    await assert.rejects(xeroFinancialSyncPreview({ recordExactMatches: true, includePayments: true }, f.dependencies),
      failAt === 'payments' ? /Injected payments failure/ : { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
    const run = f.tables.xero_financial_sync_runs[0];
    assert.equal(run.status, 'building');
    assert.equal(run.revision, 1);
    assert.equal((await xeroFinancialSyncLatest({}, { client: f.client })).preview, null);
    assert.equal(f.calls.filter(call => call.stage === 'publish').length, failAt === 'publish' ? 1 : 0);
    if (failAt === 'items:2') assert.equal(f.tables.xero_financial_sync_items.length, 100);
    if (failAt === 'audit' || failAt === 'publish') assert.deepEqual(run.control_totals.workflowSnapshot.payments, f.paymentSnapshot);
  });
}

test('complete preview publishes once after items, payment snapshot and completion audit', async () => {
  const f = fixture();
  const result = await xeroFinancialSyncPreview({ recordExactMatches: true, includePayments: true }, f.dependencies);
  assert.equal(result.run.status, 'ready_for_review');
  assert.equal(result.run.revision, 1);
  assert.equal(result.rows.length, 205);
  assert.equal(f.tables.xero_financial_sync_items.length, 205);
  assert.deepEqual(f.calls.filter(call => ['items:1', 'items:2', 'items:3', 'snapshot', 'audit', 'publish'].includes(call.stage)).map(call => call.stage),
    ['items:1', 'items:2', 'items:3', 'snapshot', 'audit', 'publish']);
  assert.equal(f.tables.xero_financial_audit_events[0].event_type, 'preview_completed');
  const saved = (await xeroFinancialSyncLatest({}, { client: f.client })).preview;
  assert.equal(saved.run.id, result.run.id);
  assert.equal(saved.rows.length, 205);
  assert.deepEqual(saved.payments, f.paymentSnapshot);
});

test('documents-only preview preserves its return shape and publishes after the audit', async () => {
  const f = fixture({ count: 1 });
  const result = await xeroFinancialSyncPreview({ recordExactMatches: true }, f.dependencies);
  assert.equal(result.run.status, 'ready_for_review');
  assert.equal(result.payments, null);
  assert.equal(result.rows.length, 1);
  assert.equal(result.postingMode, 'draft');
  assert.equal(result.summary.total, 1);
  assert.equal(f.calls.some(call => call.stage === 'snapshot'), false);
  assert.deepEqual(f.calls.filter(call => ['audit', 'publish'].includes(call.stage)).map(call => call.stage), ['audit', 'publish']);
});

for (const race of [{ status: 'cancelled' }, { revision: 2 }]) {
  test(`publication rejects a concurrent ${Object.keys(race)[0]} change`, async () => {
    const f = fixture({ race });
    await assert.rejects(xeroFinancialSyncPreview({ recordExactMatches: true, includePayments: true }, f.dependencies), { code: 'XERO_FINANCIAL_STALE_WRITE' });
    assert.notEqual(f.tables.xero_financial_sync_runs[0].status, 'ready_for_review');
    assert.equal((await xeroFinancialSyncLatest({}, { client: f.client })).preview, null);
  });
}

test('Latest ignores newer building/cancelled runs and preserves published execution history', async () => {
  for (const status of ['ready_for_review', 'authorised', 'processing', 'completed', 'partial', 'failed']) {
    const f = fixture({ count: 1 });
    const result = await xeroFinancialSyncPreview({ recordExactMatches: true, includePayments: true }, f.dependencies);
    const run = f.tables.xero_financial_sync_runs[0]; run.status = status;
    // Execution summaries count selected outcomes, not the complete population.
    run.classification_summary.total = 0;
    for (const hidden of ['building', 'cancelled']) f.tables.xero_financial_sync_runs.push({
      ...structuredClone(run), id: randomUUID(), status: hidden, created_at: '9999-01-01T00:00:00Z',
    });
    const latest = (await xeroFinancialSyncLatest({}, { client: f.client })).preview;
    assert.equal(latest.run.id, result.run.id);
    assert.equal(latest.run.status, status);
    assert.equal(latest.rows.length, 1);
  }
});

test('building, cancelled and non-preview snapshots always require a fresh check', async () => {
  for (const change of [{ status: 'building' }, { status: 'cancelled' }, { mode: 'payment_apply' }, { mode: 'document_apply' }]) {
    const f = fixture(); const id = randomUUID();
    f.tables.xero_financial_sync_runs = [{ id, mode: 'preview', status: 'ready_for_review', ...change,
      source_snapshot_at: new Date().toISOString(), control_totals: { workflowSnapshot: {
        reconciliationVersion: XERO_RECONCILIATION_VERSION,
        controlsFingerprint: createHash('sha256').update(JSON.stringify({ productMappings: [], documentMappings: [], bankMappings: [] })).digest('hex'),
        organisation: {},
      } },
    }];
    const result = await financialPreviewChanges(id, { client: f.client, connection: {},
      querySalesforce: async () => { throw new Error('Incomplete run must not probe Salesforce'); },
      accountingFetch: async () => { throw new Error('Incomplete run must not probe Xero'); },
    });
    assert.equal(result.changed, true);
    assert.deepEqual(f.calls.map(call => call.table), ['xero_financial_sync_runs']);
  }
});


test('requested exact-match writes must succeed before the preview can publish', async () => {
  const f = fixture({ count: 1, exact: true, failAt: 'xero_financial_document_mappings:upsert' });
  await assert.rejects(xeroFinancialSyncPreview({ recordExactMatches: true, includePayments: true }, f.dependencies),
    { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
  assert.equal(f.tables.xero_financial_sync_runs[0].status, 'building');
  assert.equal(f.calls.some(call => call.stage === 'publish'), false);
  assert.equal((await xeroFinancialSyncLatest({}, { client: f.client })).preview, null);
});

test('successful exact-match writes precede snapshot, audit and publication', async () => {
  const f = fixture({ count: 1, exact: true });
  const result = await xeroFinancialSyncPreview({ recordExactMatches: true, includePayments: true }, f.dependencies);
  assert.equal(result.run.status, 'ready_for_review');
  assert.equal(f.tables.xero_financial_document_mappings.length, 1);
  const stages = f.calls.map(call => call.stage);
  assert.ok(stages.indexOf('xero_financial_document_mappings:upsert') < stages.indexOf('snapshot'));
  assert.ok(stages.indexOf('snapshot') < stages.indexOf('audit'));
  assert.ok(stages.indexOf('audit') < stages.indexOf('publish'));
});
