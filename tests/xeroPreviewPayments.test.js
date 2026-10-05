import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compactPreviewPayments, hydratePreviewPayments } from '../api/_xeroPreviewPayments.js';
import { previewCheckpointReference, partitionPreviewCheckpoint } from '../api/_xeroPreviewCheckpoint.js';
import { preparePreviewPersistence, previewEvidenceHash } from '../api/_xeroPreviewPersistence.js';
import { buildReconciliationCases } from '../api/_xeroReconciliationPolicy.js';
import { XERO_RECONCILIATION_VERSION, savedFinancialPreview } from '../api/_xeroFinancialSync.js';

function fixture(count = 2) {
  const actor = randomUUID(), tenant = randomUUID(), id = randomUUID();
  const payments = { tenantId: tenant, rows: Array.from({ length: count }, (_, i) => ({
    salesforcePaymentId: `payment-${i}`, amount: i + 0.01, paymentDate: '2025-12-31', currency: 'USD',
    blockers: ['Missing verified invoice allocation'], action: 'blocked', status: 'blocked',
    evidenceFingerprint: previewEvidenceHash(i), evidence: 'x'.repeat(2000),
  })), summary: { total: count }, evidenceFingerprint: previewEvidenceHash('all payments') };
  const payload = { complete: true, provider: { payments }, snapshotStartedAt: '2026-09-30T00:00:00Z' };
  const checkpoint = { id, revision: 2, state: 'captured', actor_id: actor, tenant_id: tenant,
    salesforce_org_id: '00D2x000000Ei4oEAC', reconciliation_version: XERO_RECONCILIATION_VERSION,
    input_options: { linkFirst: true, recordExactMatches: false, includePayments: true,
      cutoffDate: '2026-01-01', postingMode: 'draft', campaignId: null },
    input_evidence_hash: previewEvidenceHash('source'), payload_hash: previewEvidenceHash(payload),
    storage_hash: previewEvidenceHash('chunks'), token_version: 1, captured_at: '2026-09-30T00:00:00Z', payload };
  const snapshot = { complete: true, linkFirst: true, includePayments: true,
    expectedItemCount: 0, reconciliationVersion: XERO_RECONCILIATION_VERSION, tenantId: tenant,
    payments, inventoryReference: previewCheckpointReference(checkpoint) };
  const run = { id, mode: 'preview', status: 'ready_for_review', created_by: actor, control_totals: { workflowSnapshot: snapshot } };
  const published = { ...checkpoint, revision: 3, state: 'published', published_run_id: id };
  return { actor, tenant, payments, checkpoint, published, snapshot, run };
}

test('4408 complete payment rows exceeding the summary cap are stored once and restored exactly before classification', async () => {
  const f = fixture(4408);
  assert.ok(Buffer.byteLength(JSON.stringify(f.payments)) > 8 * 1024 * 1024);
  const compact = compactPreviewPayments(f.snapshot, f.checkpoint);
  assert.equal(Object.hasOwn(compact, 'payments'), false);
  assert.deepEqual(compact.paymentsReference, compact.inventoryReference);
  const run = { ...f.run, control_totals: { workflowSnapshot: compact } };
  const p = preparePreviewPersistence(run, [], { tenantId: f.tenant, includePayments: true,
    salesforceOrgId: f.checkpoint.salesforce_org_id, inputEvidenceHash: previewEvidenceHash('complete') });
  assert.ok(Buffer.byteLength(JSON.stringify(p.p_run)) < 8 * 1024 * 1024);
  const before = JSON.stringify(run);
  let reads = 0;
  const hydrated = await hydratePreviewPayments({}, run, { loadCheckpoint: async (_client, reference, scope) => {
    reads += 1;
    assert.deepEqual(reference, f.snapshot.inventoryReference);
    assert.deepEqual(scope, { runId: run.id, actorId: f.actor, tenantId: f.tenant });
    return f.published;
  } });
  assert.equal(reads, 1);
  assert.equal(hydrated.payments.rows.length, 4408);
  assert.equal(previewEvidenceHash(hydrated.payments), previewEvidenceHash(f.payments));
  assert.equal(JSON.stringify(run), before);
  const cases = buildReconciliationCases({ tenantId: f.tenant, run: { ...run,
    control_totals: { workflowSnapshot: hydrated } }, items: [], ownerId: f.actor,
    baselineAt: '2026-09-30T00:00:00Z' });
  assert.equal(cases.length, 4408);
});

test('compaction refuses any changed payment, incomplete rows or foreign tenant', () => {
  for (const alter of [f => { f.snapshot.payments = { ...f.payments, rows: [] }; },
    f => { f.checkpoint.payload.complete = false; }, f => { f.checkpoint.payload.provider.payments.tenantId = randomUUID(); },
    f => { f.checkpoint.payload.provider.payments.rows = null; }]) {
    const f = fixture(); alter(f); assert.throws(() => compactPreviewPayments(f.snapshot, f.checkpoint));
  }
});

test('exact references reject both representations, arbitrary paths, different capture, missing evidence and scope changes', async () => {
  const alterations = [s => { s.payments = null; }, s => { s.paymentsReference.path = 'provider.xero'; },
    s => { s.paymentsReference = { ...s.paymentsReference, checkpointId: randomUUID() }; },
    s => { delete s.paymentsReference; }, s => { s.includePayments = false; },
    s => { s.paymentsReference = { ...s.paymentsReference, actorId: randomUUID() }; },
    s => { s.paymentsReference = null; }];
  for (const alter of alterations) {
    const f = fixture(), compact = compactPreviewPayments(f.snapshot, f.checkpoint);
    alter(compact);
    assert.throws(() => preparePreviewPersistence({ ...f.run, control_totals: { workflowSnapshot: compact } }, [],
      { tenantId: f.tenant, includePayments: compact.includePayments, salesforceOrgId: 'org', inputEvidenceHash: previewEvidenceHash('input') }));
  }
});

test('hydration rejects changed payloads, missing rows, foreign actor/tenant and unpublished or unrelated runs', async () => {
  for (const alter of [f => { f.published.payload.provider.payments.rows[0].amount += 1; },
    f => { f.published.payload.provider.payments.rows = null; }, f => { f.published.state = 'captured'; },
    f => { f.published.published_run_id = randomUUID(); }, f => { f.run.created_by = randomUUID(); },
    f => { f.run.control_totals.workflowSnapshot.tenantId = randomUUID(); }]) {
    const f = fixture(); f.run.control_totals.workflowSnapshot = compactPreviewPayments(f.snapshot, f.checkpoint);
    alter(f);
    await assert.rejects(hydratePreviewPayments({}, f.run, { captured: f.published }));
  }
});

test('execution reuses already verified inventory while inline legacy checks remain compatible', async () => {
  const f = fixture();
  assert.equal(await hydratePreviewPayments({}, f.run), f.snapshot);
  const run = { ...f.run, control_totals: { workflowSnapshot: compactPreviewPayments(f.snapshot, f.checkpoint) } };
  const hydrated = await hydratePreviewPayments({}, run, { captured: f.published,
    loadCheckpoint: () => { throw new Error('Duplicate capture read'); } });
  assert.deepEqual(hydrated.payments, f.payments);
});

test('saved portal preview restores every row through the production checkpoint loader after capture expiry', async () => {
  const f = fixture(140);
  Object.assign(f.checkpoint.payload, { automaticMappingPolicy: {}, rate: {}, callForecast: {},
    provider: { payments: f.payments, xero: { tenantId: f.tenant, documents: [], contacts: [] },
      accountResponse: { Accounts: [] }, taxResponse: { TaxRates: [] }, allMappings: { data: [] } } });
  f.checkpoint.payload_hash = previewEvidenceHash(f.checkpoint.payload);
  f.snapshot.inventoryReference = previewCheckpointReference(f.checkpoint);
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const { manifest, parts } = partitionPreviewCheckpoint(canonical(f.checkpoint.payload));
  const captured = { ...f.checkpoint, storage_version: 2, expires_at: '2020-01-01T00:00:00Z',
    revision: 3, state: 'published', published_run_id: f.run.id,
    payload: { manifest, storageVersion: 2, summary: {} } };
  f.run.control_totals.workflowSnapshot = compactPreviewPayments(f.snapshot, f.checkpoint);
  const calls = [];
  const client = { async rpc(name, args) {
    calls.push(name);
    if (name === 'xero_preview_checkpoint_load_v2') return { data: captured };
    if (name === 'xero_preview_checkpoint_read_chunks_v2') {
      const chunks = parts.slice(args.p_after_ordinal + 1, args.p_after_ordinal + 3);
      return { data: { chunks, hasMore: args.p_after_ordinal + 1 + chunks.length < parts.length } };
    }
    throw new Error('Unexpected write or provider call');
  }, from(name) {
    assert.equal(name, 'xero_financial_sync_items');
    const q = { select: () => q, eq: () => q, order: () => q, range: async () => ({ data: [] }) };
    return q;
  } };
  const result = await savedFinancialPreview(client, f.run);
  assert.equal(result.payments.rows.length, 140);
  assert.equal(previewEvidenceHash(result.payments), previewEvidenceHash(f.payments));
  assert.equal(result.restored, true);
  assert.ok(calls.includes('xero_preview_checkpoint_read_chunks_v2'));
  assert.equal(Object.hasOwn(result.controlTotals, 'workflowSnapshot'), false);
});
