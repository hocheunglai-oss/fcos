import test from 'node:test';
import assert from 'node:assert/strict';
import { financialFixture, ids, hash } from './xeroSupplierFinancialBucketPreservation.fixture.js';
import { evaluateSupplierFinancialBucketPreservation as evaluate, supplierFinancialBucketReview } from '../api/_xeroSupplierFinancialBucketPreservation.js';
import { persistSupplierFinancialBucketPreservation as persist, readSupplierFinancialBucketOutcome as readOutcome,
  SUPPLIER_FINANCIAL_BUCKET_RECEIPT } from '../api/_xeroSupplierFinancialBucketPersistence.js';
const clone = v => structuredClone(v);
const runId = '00000000-0000-4000-8000-000000000091', itemId = '00000000-0000-4000-8000-000000000092', mappingId = '00000000-0000-4000-8000-000000000093';
function setup({ paid = false, large = false } = {}) {
  const f = financialFixture({ paid });
  if (large) { f.identity.retainedOriginalScope = 'x'.repeat(700_000); f.reseal(); }
  const p = evaluate(f.input); assert.equal(p.proofValid, true);
  const review = supplierFinancialBucketReview(p, { reviewFingerprint: hash('selected reviewed row'), legacyReviewFingerprint: hash('ordinary legacy fingerprint') });
  assert.ok(review); const a = review.evidence.accounting;
  const args = { runId, itemId, tenantId: ids.tenant, expectedRunRevision: 3, expectedItemUpdatedAt: '2026-10-04T17:00:00.123456Z',
    actor: { id: ids.observer, email: '  Operator@EXAMPLE.COM  ' }, previewReview: review, review };
  const originalReview = Object.fromEntries(Object.entries(review).filter(([k]) => !['accountingCanonical', 'evidenceCanonical', 'localClaimScopeCanonical'].includes(k)));
  const receipt = { policyVersion: p.policyVersion, receiptContract: SUPPLIER_FINANCIAL_BUCKET_RECEIPT, fingerprint: p.fingerprint,
    approvalMaterialHash: review.approvalMaterialHash, previewEvidenceFingerprint: p.evidenceFingerprint, executionEvidenceFingerprint: p.evidenceFingerprint,
    originalReview, previewReviewHash: hash(review), executionReviewHash: hash(review), ledgerPaymentProofFingerprint: a.settlement.ledgerPaymentProof?.fingerprint ?? null,
    documentVerification: 'UNVERIFIED', financialWrites: 0, acceptance: { runId, itemId, runRevision: 3,
      itemUpdatedAt: '2026-10-04T17:00:00.123456+00:00', actorId: ids.observer, actorEmail: 'operator@example.com' } };
  const result = { id: itemId, status: 'linked', xeroDocumentId: ids.target, mappingId, policyVersion: p.policyVersion, receiptContract: SUPPLIER_FINANCIAL_BUCKET_RECEIPT,
    fingerprint: p.fingerprint, approvalMaterialHash: review.approvalMaterialHash, previewEvidenceFingerprint: p.evidenceFingerprint, executionEvidenceFingerprint: p.evidenceFingerprint,
    ledgerPaymentProofFingerprint: receipt.ledgerPaymentProofFingerprint, documentVerification: 'UNVERIFIED', financialWrites: 0, alreadyLinked: false };
  const rows = {
    xero_financial_sync_items: [{ id: itemId, run_id: runId, source_object: 'Supplier_Invoice__c', source_id: a.source.sourcePayload.salesforceId,
      source_type: 'supplier_bill', proposed_action: 'protected_legacy', status: 'linked', selected: true,
      source_payload: { ...a.source.sourcePayload, supplierFinancialReview: review, supplierFinancialPreservation: { policyVersion: p.policyVersion,
        proofValid: true, workflowEligible: false, approvalGranted: false, accepted: false, documentVerification: 'UNVERIFIED' } },
      proposed_payload: null, xero_document_id: ids.target, xero_document_status: f.target.Status, mutation_attempts: 0, updated_at: '2026-10-04T17:00:01.000001Z' }],
    xero_financial_document_mappings: [{ id: mappingId, salesforce_object: 'Supplier_Invoice__c', salesforce_id: a.source.sourcePayload.salesforceId,
      document_kind: 'supplier_bill', xero_document_type: 'ACCPAY', xero_document_id: ids.target, xero_contact_id: ids.contact,
      xero_status: f.target.Status, source_fingerprint: a.sourceFingerprint, financial_fingerprint: a.financialFingerprint, protected_legacy: true,
      retained_differences: { financialBucketPreservation: receipt } }],
    xero_financial_audit_events: [{ id: 47, run_id: runId, event_type: 'supplier_financial_bucket_document_linked', outcome: 'success', actor_id: ids.observer,
      actor_email: 'operator@example.com', record_counts: { linked: 1, applied: 0, financialWrites: 0 },
      fingerprints: { tenantId: ids.tenant, itemId, mappingId, financialBucketPreservation: receipt } }],
  };
  return { f, p, args, receipt, result, rows };
}
function clientFor(s, { response = { data: s.result, error: null }, throws = false, readError = null } = {}) {
  const calls = [], reads = [];
  return { calls, reads, async rpc(name, args) { calls.push({ name, args }); if (throws) throw Error('PRIVATE_RAW_PROVIDER_ERROR'); return response; },
    from(table) {
      const read = { table, filters: [] }; reads.push(read);
      const q = { select(columns) { read.columns = columns; return q; }, eq(k, v) { read.filters.push([k, v]); return q; }, limit(n) {
        read.limit = n; return Promise.resolve({ data: clone(s.rows[table]), error: readError }); } }; return q;
    } };
}
const uncertain = error => error.code === 'SUPPLIER_FINANCIAL_LINK_OUTCOME_UNCERTAIN' && error.status === 503 && !error.message.includes('PRIVATE');

test('fixed paid and authorised service RPC binds exact eight arguments and exposes only sanitized link outcome', async () => {
  for (const paid of [false, true]) {
    const s = setup({ paid }), before = clone(s.args), client = clientFor(s), out = await persist(client, s.args);
    assert.equal(client.calls.length, 1); assert.equal(client.reads.length, 0); assert.equal(client.calls[0].name, 'link_xero_financial_bucket_document_v1');
    assert.deepEqual(Object.keys(client.calls[0].args).sort(), ['p_run_id', 'p_expected_run_revision', 'p_item_id', 'p_expected_item_updated_at', 'p_tenant_id', 'p_review', 'p_actor_id', 'p_actor_email'].sort());
    assert.equal(client.calls[0].args.p_tenant_id, ids.tenant); assert.equal(client.calls[0].args.p_actor_email, 'operator@example.com');
    assert.deepEqual(client.calls[0].args.p_review, s.args.review); assert.deepEqual(s.args, before);
    assert.equal(out.linked, 1); assert.equal(out.applied, 0); assert.equal(out.financialWrites, 0); assert.equal(out.documentVerification, 'UNVERIFIED');
    assert.equal(out.recovered, false); assert.ok(Object.isFrozen(out)); assert.ok(!JSON.stringify(out).includes('APIKey'));
    assert.equal(out.ledgerPaymentProofFingerprint, paid ? s.p.evidence.accounting.settlement.ledgerPaymentProof.fingerprint : null);
  }
});

test('original evidence stays within 1 MB while a complete 2 MB review uses its separate 4 MB wire bound', async () => {
  const s = setup({ large: true }), bytes = v => Buffer.byteLength(JSON.stringify(v));
  assert.ok(bytes(s.args.review.evidence) < 1_000_000); assert.ok(bytes(s.args.review) > 2_000_000 && bytes(s.args.review) < 4_000_000);
  const client = clientFor(s); assert.equal((await persist(client, s.args)).status, 'linked');
  const bad = clone(s.args); bad.review.evidence.accounting.identity.retainedOriginalScope = 'x'.repeat(1_000_001);
  const unused = clientFor(s); await assert.rejects(persist(unused, bad), e => e.code === 'SUPPLIER_FINANCIAL_ORIGINAL_EVIDENCE_BOUND'); assert.equal(unused.calls.length, 0);
  const tooBig = clone(s.args); tooBig.review.evidenceCanonical += 'x'.repeat(4_000_001);
  await assert.rejects(persist(unused, tooBig), e => e.code === 'SUPPLIER_FINANCIAL_TRANSPORT_BOUND'); assert.equal(unused.calls.length, 0);
});

test('altered original, stale material, tenant, invalid timestamp and lossy JSON hold before the RPC', async () => {
  const s = setup();
  const mutations = [a => { a.review.evidence.accounting.target.Total = '1.00'; }, a => { a.review.reviewFingerprint = hash('changed selection'); },
    a => { a.tenantId = mappingId; }, a => { a.expectedItemUpdatedAt = '2026-02-30T00:00:00Z'; },
    a => { Object.defineProperty(a.review, 'hidden', { value: 1 }); }, a => { a.review.extra = -0; }];
  for (const mutate of mutations) { const args = clone(s.args); args.review = clone(args.review); mutate(args); const c = clientFor(s); await assert.rejects(persist(c, args)); assert.equal(c.calls.length, 0); assert.equal(c.reads.length, 0); }
  let accessed = false; const args = clone(s.args); Object.defineProperty(args.review, 'extra', { enumerable: true, get() { accessed = true; return true; } });
  await assert.rejects(persist(clientFor(s), args)); assert.equal(accessed, false);
});

test('a definitive stale revision or permission rejection never retries or claims uncertain success', async () => {
  const s = setup();
  for (const code of ['40001', '42501']) { const c = clientFor(s, { response: { data: null, error: { code, message: 'PRIVATE_PROVIDER_SECRET' } } });
    await assert.rejects(persist(c, s.args), e => e.code === 'SUPPLIER_FINANCIAL_LINK_REJECTED' && !e.message.includes('PRIVATE')); assert.equal(c.calls.length, 1); assert.equal(c.reads.length, 0); }
});

test('ambiguous or mismatched RPC outcome recovers one exact item/mapping/audit receipt without repeating the write', async () => {
  for (const paid of [false, true]) for (const mode of ['throw', 'unknown-error', 'mismatched-result']) {
    const s = setup({ paid }), c = clientFor(s, { throws: mode === 'throw', response: mode === 'unknown-error' ? { data: null, error: { code: 'NETWORK', message: 'PRIVATE' } }
      : mode === 'mismatched-result' ? { data: { ...s.result, xeroDocumentId: mappingId }, error: null } : undefined });
    const out = await persist(c, s.args); assert.equal(out.recovered, true); assert.equal(out.alreadyLinked, true); assert.equal(c.calls.length, 1);
    assert.equal(c.reads.length, 3); assert.ok(c.reads.every(r => r.limit === 2)); assert.equal(out.financialWrites, 0);
    assert.deepEqual(c.reads[0].filters, [['id', itemId], ['run_id', runId]]);
    assert.deepEqual(c.reads[1].filters, [['xero_document_type', 'ACCPAY'], ['xero_document_id', ids.target]]);
    assert.deepEqual(c.reads[2].filters, [['run_id', runId], ['event_type', 'supplier_financial_bucket_document_linked'], ['fingerprints->>itemId', itemId]]);
    assert.ok(!JSON.stringify(out).includes('PRIVATE_SYNTHETIC_PROVIDER_IDENTITY'));
  }
});

test('receipt hashes, exact acceptance microseconds, source originals and all three durable records must agree', async () => {
  const mutations = [s => { s.rows.xero_financial_document_mappings[0].retained_differences.financialBucketPreservation.previewReviewHash = hash('foreign'); },
    s => { s.rows.xero_financial_document_mappings[0].retained_differences.financialBucketPreservation.acceptance.itemUpdatedAt = '2026-10-04T17:00:00.123457Z'; },
    s => { s.rows.xero_financial_document_mappings[0].salesforce_id = 'a06000000000099'; },
    s => { s.rows.xero_financial_sync_items[0].source_payload.lines[0].unitAmount += 1; },
    s => { s.rows.xero_financial_sync_items[0].proposed_payload = {}; },
    s => { s.rows.xero_financial_sync_items[0].mutation_attempts = 1; },
    s => { s.rows.xero_financial_audit_events[0].fingerprints.mappingId = itemId; },
    s => { s.rows.xero_financial_audit_events[0].record_counts.applied = 1; }];
  for (const mutate of mutations) { const s = setup(); s.rows = clone(s.rows); mutate(s); const c = clientFor(s, { throws: true });
    await assert.rejects(persist(c, s.args), uncertain); assert.equal(c.calls.length, 1); assert.equal(c.reads.length, 3); }
});

test('missing, duplicate, errored or unavailable readback remains uncertain and never retries', async () => {
  for (const mode of ['missing', 'duplicate', 'read-error', 'unavailable', 'sync-read-throw']) {
    const s = setup(); if (mode === 'missing') s.rows.xero_financial_audit_events = [];
    if (mode === 'duplicate') s.rows.xero_financial_document_mappings.push(clone(s.rows.xero_financial_document_mappings[0]));
    const c = clientFor(s, { throws: true, readError: mode === 'read-error' ? { message: 'PRIVATE_DB_ERROR' } : null });
    if (mode === 'unavailable') delete c.from;
    if (mode === 'sync-read-throw') { const from = c.from; c.from = table => { if (table === 'xero_financial_document_mappings') throw Error('PRIVATE'); return from(table); }; }
    await assert.rejects(persist(c, s.args), uncertain); assert.equal(c.calls.length, 1);
    if (mode === 'sync-read-throw') assert.equal(c.reads.length, 2);
  }
});

test('already processing/completed recovery is read-only and binds the original receipt acceptance', async () => {
  for (const paid of [false, true]) {
    const s = setup({ paid }), c = clientFor(s); delete c.rpc;
    const out = await readOutcome(c, s.args); assert.equal(out.status, 'linked'); assert.equal(out.recovered, true);
    assert.equal(out.linked, 1); assert.equal(out.applied, 0); assert.equal(out.financialWrites, 0); assert.equal(c.calls.length, 0); assert.equal(c.reads.length, 3);
    for (const override of [{ expectedRunRevision: 4 }, { expectedItemUpdatedAt: '2026-10-04T17:00:00.123457Z' }, { actor: { id: mappingId, email: 'operator@example.com' } }]) {
      const unusedRpc = clientFor(s); await assert.rejects(readOutcome(unusedRpc, { ...s.args, ...override }), uncertain); assert.equal(unusedRpc.calls.length, 0);
    }
  }
});
