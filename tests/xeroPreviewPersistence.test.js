import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { persistFinancialPreview, preparePreviewPersistence, previewEvidenceHash, previewReviewIdentity } from '../api/_xeroPreviewPersistence.js';

function fixture() {
  const id = randomUUID(); const tenantId = randomUUID();
  const run = { id, idempotency_key: `preview:${id}`, mode: 'preview', status: 'building', revision: 1,
    cutoff_date: '2026-01-01', created_by: randomUUID(), created_by_email: 'finance@example.test',
    source_snapshot_at: '2026-09-27T01:00:00Z', xero_snapshot_at: '2026-09-27T01:00:00Z',
    created_at: '2026-09-27T01:00:00Z', updated_at: '2026-09-27T01:00:00Z', rate_limit_snapshot: { remaining: 800 },
    source_fingerprint: 'source', xero_fingerprint: 'xero', classification_summary: { total: 1 },
    control_totals: { postingMode: 'draft', workflowSnapshot: { reconciliationVersion: 10, checkedAt: '2026-09-27T01:00:00Z',
      products: [{ id: 'product' }], mappingProposals: [], automaticMappingPolicy: { id: 'policy', changedCount: 0 },
      organisation: { baseCurrency: 'USD' }, controlsFingerprint: 'controls',
      payments: { tenantId, rows: [{ salesforcePaymentId: 'payment', amount: 100, paymentDate: '2026-09-01',
        paymentPostingClaimId: 'claim', reviewFingerprint: 'payment-evidence' }], actor: { email: 'finance@example.test' }, rateLimit: { remaining: 799 } },
    } } };
  const items = [{ id: randomUUID(), run_id: id, row_index: 0, row_key: 'Invoice__c:invoice', idempotency_key: `${id}:Invoice__c:invoice`,
    created_at: run.created_at, updated_at: run.updated_at, selected: false,
    source_total: 100, currency: 'USD', status: 'blocked', proposed_action: 'blocked', blockers: ['file missing'],
    warnings: ['warning'], differences: [{ field: 'reference', salesforce: 'A', xero: 'B' }], proposed_payload: { Total: 100 },
    xero_payload: { id: 'existing', updatedDateUTC: '2026-09-01T00:00:00Z' },
    source_payload: { sourceFingerprint: 'source', dispute: { status: 'open', updatedAt: '2026-09-01T00:00:00Z' },
      sourceFileDiscovery: { capturedAt: run.created_at, complete: true,
        candidates: [{ latestPublishedVersionId: 'version', documentModifiedAt: '2026-09-01T00:00:00Z' }] } } }];
  const scope = { tenantId, includePayments: true, salesforceOrgId: 'test-org', inputEvidenceHash: previewEvidenceHash({ inputs: 'all' }) };
  return preparePreviewPersistence(run, items, scope);
}

test('complete identity ignores only enumerated generated metadata and object key order', () => {
  const a = fixture(); const b = structuredClone(a);
  for (const key of ['id', 'idempotency_key', 'created_by', 'created_by_email', 'created_at', 'updated_at', 'source_snapshot_at', 'xero_snapshot_at']) b.p_run[key] = `other-${key}`;
  b.p_run.rate_limit_snapshot = { remaining: 500 };
  const snapshot = b.p_run.control_totals.workflowSnapshot;
  snapshot.checkedAt = '2026-09-28T00:00:00Z'; snapshot.reviewIdentity = 'another'; snapshot.persistencePayloadHash = 'another';
  snapshot.payments.actor = { email: 'another@example.test' }; snapshot.payments.rateLimit = { remaining: 499 };
  for (const key of ['id', 'run_id', 'idempotency_key', 'created_at', 'updated_at']) b.p_items[0][key] = `other-${key}`;
  b.p_items[0].source_payload.sourceFileDiscovery.capturedAt = '2026-09-28T00:00:00Z';
  assert.equal(previewReviewIdentity(b.p_run, b.p_items), a.p_review_identity);
  assert.equal(previewEvidenceHash({ b: [1, 2], a: { x: 3, y: 4 } }), previewEvidenceHash({ a: { y: 4, x: 3 }, b: [1, 2] }));
  assert.notEqual(previewEvidenceHash([1, 2]), previewEvidenceHash([2, 1]));
});

const mutations = {
  'amount': p => { p.p_items[0].source_total = 101; },
  'currency': p => { p.p_items[0].currency = 'HKD'; },
  'blocker': p => { p.p_items[0].blockers.push('missing cash'); },
  'warning': p => { p.p_items[0].warnings.push('new warning'); },
  'difference': p => { p.p_items[0].differences[0].xero = 'C'; },
  'provider update': p => { p.p_items[0].xero_payload.updatedDateUTC = '2026-09-02T00:00:00Z'; },
  'dispute update': p => { p.p_items[0].source_payload.dispute.updatedAt = '2026-09-02T00:00:00Z'; },
  'supplier file version': p => { p.p_items[0].source_payload.sourceFileDiscovery.candidates[0].latestPublishedVersionId = 'new-version'; },
  'supplier file date': p => { p.p_items[0].source_payload.sourceFileDiscovery.candidates[0].documentModifiedAt = '2026-09-02T00:00:00Z'; },
  'posting mode': p => { p.p_run.control_totals.postingMode = 'authorised'; },
  'tenant': p => { p.p_run.control_totals.workflowSnapshot.tenantId = randomUUID(); },
  'source org': p => { p.p_run.control_totals.workflowSnapshot.salesforceOrgId = 'other-org'; },
  'input evidence': p => { p.p_run.control_totals.workflowSnapshot.inputEvidenceHash = previewEvidenceHash('changed claim or mapping'); },
  'payment amount': p => { p.p_run.control_totals.workflowSnapshot.payments.rows[0].amount = 99; },
  'payment date': p => { p.p_run.control_totals.workflowSnapshot.payments.rows[0].paymentDate = '2026-09-02'; },
  'payment claim': p => { p.p_run.control_totals.workflowSnapshot.payments.rows[0].paymentPostingClaimId = 'new-claim'; },
  'payment scope': p => { p.p_run.control_totals.workflowSnapshot.includePayments = false; },
  'automatic mapping effects': p => { p.p_run.control_totals.workflowSnapshot.automaticMappingPolicy.changedCount = 1; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`${name} changes invalidate preview reuse`, () => {
  const p = fixture(); mutate(p); assert.notEqual(previewReviewIdentity(p.p_run, p.p_items), p.p_review_identity);
});

function response(parameters, overrides = {}) {
  return { data: { reused: false, run: { ...structuredClone(parameters.p_run), status: 'ready_for_review' },
    items: parameters.p_items.map(({ id, row_key, row_index }) => ({ id, row_key, row_index })), ...overrides }, error: null, status: 200 };
}

test('uncertain transport result retries identical UUID and recovers actual reviewed state', async () => {
  const p = fixture(); const calls = [];
  const actual = { ...structuredClone(p.p_run), status: 'authorised', revision: 2, reviewed_at: '2026-09-27T01:01:00Z' };
  const client = { async rpc(name, args) {
    calls.push({ name, args });
    if (calls.length === 1) return { error: { message: 'response lost' }, status: 504 };
    return response(p, { run: actual, reused: true });
  } };
  const saved = await persistFinancialPreview(client, p);
  assert.equal(calls.length, 2); assert.equal(calls[0].args, calls[1].args);
  assert.equal(saved.run.status, 'authorised'); assert.equal(saved.run.revision, 2);
  assert.equal(saved.identities.get(p.p_items[0].row_key), p.p_items[0].id);
});

test('database rejection does not fall back to separate inserts or retry', async () => {
  const p = fixture(); let calls = 0;
  await assert.rejects(persistFinancialPreview({ rpc: async () => { calls += 1; return { error: { code: '40001' }, status: 409 }; } }, p), { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
  assert.equal(calls, 1);
});

test('transport retries are bounded and invalid or missing returned row identities fail closed', async () => {
  const p = fixture(); let calls = 0;
  await assert.rejects(persistFinancialPreview({ rpc: async () => { calls += 1; throw new TypeError('fetch failed'); } }, p));
  assert.equal(calls, 2);
  for (const items of [[], [{ id: 'invalid', row_key: p.p_items[0].row_key }], [{ id: randomUUID(), row_key: 'wrong' }]]) {
    await assert.rejects(persistFinancialPreview({ rpc: async () => response(p, { items }) }, p));
  }
});

test('provider mismatch is rejected before persistence preparation', () => {
  const p = fixture();
  assert.throws(() => preparePreviewPersistence(p.p_run, p.p_items, { tenantId: randomUUID(), includePayments: true,
    salesforceOrgId: 'org', inputEvidenceHash: previewEvidenceHash('evidence') }), /same Xero organisation/);
});
