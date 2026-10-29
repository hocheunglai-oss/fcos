import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { financialFixture, ids, hash } from './xeroSupplierFinancialBucketPreservation.fixture.js';
import { supplierFinancialBucketPreview as preview, supplierFinancialBucketRead as read,
  supplierFinancialBucketApply as apply } from '../api/_xeroSupplierFinancialBucketWorkflow.js';
import { SUPPLIER_FINANCIAL_BUCKET_POLICY as POLICY } from '../api/_xeroSupplierFinancialBucketPreservation.js';
import { SUPPLIER_FINANCIAL_BUCKET_RECEIPT } from '../api/_xeroSupplierFinancialBucketPersistence.js';
const copy = v => JSON.parse(JSON.stringify(v));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT = 'supplier_financial_bucket_document_linked';
const noPrivate = v => { const text = JSON.stringify(v); assert.ok(!text.includes('APIKey')); assert.ok(!text.includes('PRIVATE_SYNTHETIC_PROVIDER_IDENTITY')); assert.ok(!text.includes('originalReview')); };

// Server-only collection callbacks and in-memory service tables. This fixture
// models neither provider acquisition nor current/executable financial authority.
function harness({ paid = false, tracking = false } = {}) {
  const f = financialFixture({ paid }), actor = { id: ids.observer, email: 'operator@example.com' };
  if (tracking) { f.target.LineItems[0].Tracking = [{ Name: 'Job', Option: 'FCBV', TrackingCategoryID: uuid(904) }]; f.reseal(); }
  const scope = { campaignId: uuid(901), expectedRevision: 7, caseIds: [`${ids.tenant}:Supplier_Invoice__c:${f.input.source.parent.Id}`] };
  const calls = [], controls = {}, captures = new WeakMap(); let collections = 0;
  const tables = { xero_financial_sync_runs: [], xero_financial_sync_items: [], xero_financial_document_mappings: [], xero_financial_audit_events: [] };
  const client = {
    from(table) {
      const filters = []; let order, maximum;
      const rows = () => {
        if (controls.unavailableReadback && table === 'xero_financial_sync_runs') return { data: null, error: { message: 'PRIVATE_DATABASE_DIAGNOSTIC' } };
        let data = (tables[table] || []).filter(row => filters.every(([k, v]) => k.includes('->>') ? row[k.split('->>')[0]]?.[k.split('->>')[1]] === v : row[k] === v));
        if (order) data = [...data].sort((a, b) => a[order] - b[order]); if (maximum) data = data.slice(0, maximum);
        return { data: copy(data), error: null };
      };
      const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, order(k) { order = k; return q; },
        limit(n) { maximum = n; return q; }, async maybeSingle() { const r = rows(); return r.error ? r : { data: r.data.length === 1 ? r.data[0] : null, error: null }; },
        then(resolve, reject) { return Promise.resolve(rows()).then(resolve, reject); } };
      return q;
    },
    async rpc(name, p) {
      calls.push({ type: 'rpc', name, parameters: copy(p) });
      if (name === 'persist_xero_supplier_financial_preview_v1') {
        assert.ok(p.p_items.every(r => Object.hasOwn(r, 'proposed_payload') && r.proposed_payload === null));
        const run = copy(p.p_run), items = copy(p.p_items);
        Object.assign(run, { status: 'ready_for_review', revision: 1 });
        // Typed database timestamp columns change representation on SELECT;
        // timestamps inside JSON evidence are retained byte-for-byte.
        for (const key of ['created_at', 'updated_at', 'source_snapshot_at', 'xero_snapshot_at']) if (typeof run[key] === 'string') run[key] = run[key].replace(/Z$/, '+00:00');
        for (const item of items) for (const key of ['created_at', 'updated_at']) if (typeof item[key] === 'string') item[key] = item[key].replace(/Z$/, '+00:00');
        run.control_totals.workflowSnapshot.financialPreviewPayloadHash = hash({ run: p.p_run, items: p.p_items, reviewIdentity: p.p_review_identity });
        tables.xero_financial_sync_runs.push(run); tables.xero_financial_sync_items.push(...items);
        tables.xero_financial_audit_events.push({ id: 1, run_id: run.id, event_type: 'supplier_financial_preview_published', outcome: 'success',
          actor_id: actor.id, actor_email: actor.email, fingerprints: { payloadHash: run.control_totals.workflowSnapshot.financialPreviewPayloadHash, reviewIdentity: p.p_review_identity } });
        controls.afterPublish?.(run, items);
        if (controls.lostPublish) throw Error('PRIVATE_PUBLISH_RESPONSE');
        return { data: { run: copy(run), items: copy(items), reused: false }, error: null };
      }
      const run = tables.xero_financial_sync_runs.find(r => r.id === p.p_run_id);
      assert.ok(run, 'Owned run required'); assert.equal(p.p_expected_revision ?? p.p_expected_run_revision, run.revision);
      if (name === 'authorise_xero_financial_sync_run_v1') {
        Object.assign(run, { status: 'authorised', revision: run.revision + 1, reviewed_by: p.p_actor_id, reviewed_by_email: p.p_actor_email, reviewed_at: new Date().toISOString() });
        tables.xero_financial_sync_items.filter(r => r.run_id === run.id).forEach(r => { if (p.p_selected_item_ids.includes(r.id)) Object.assign(r, { selected: true, status: 'selected' }); });
        return { data: copy(run), error: null };
      }
      if (name === 'start_xero_financial_sync_run_v1') {
        Object.assign(run, { status: 'processing', revision: run.revision + 1 }); controls.afterStart?.(run, tables.xero_financial_sync_items);
        return { data: copy(run), error: null };
      }
      if (name === 'finish_xero_financial_sync_run_v1') {
        if (controls.lostFinish) throw Error('PRIVATE_FINISH_RESPONSE');
        Object.assign(run, { status: p.p_status, revision: run.revision + 1 }); return { data: copy(run), error: null };
      }
      assert.equal(name, 'link_xero_financial_bucket_document_v1');
      const item = tables.xero_financial_sync_items.find(r => r.id === p.p_item_id), review = item.source_payload.supplierFinancialReview, a = review.evidence.accounting;
      assert.equal(item.run_id, run.id); assert.equal(p.p_expected_item_updated_at, item.updated_at); assert.equal(p.p_tenant_id, a.tenantId);
      assert.deepEqual(p.p_review, review); assert.equal(p.p_actor_id, actor.id); assert.equal(p.p_actor_email, actor.email);
      if (controls.definiteRejection) return { data: null, error: { code: '42501', message: 'PRIVATE_DATABASE_DIAGNOSTIC' } };
      if (controls.uncommittedLink) throw Error('PRIVATE_LINK_RESPONSE');
      const receipt = { policyVersion: POLICY, receiptContract: SUPPLIER_FINANCIAL_BUCKET_RECEIPT, fingerprint: review.fingerprint,
        approvalMaterialHash: review.approvalMaterialHash, previewEvidenceFingerprint: review.evidenceFingerprint, executionEvidenceFingerprint: review.evidenceFingerprint,
        originalReview: Object.fromEntries(Object.entries(review).filter(([k]) => !['accountingCanonical', 'evidenceCanonical', 'localClaimScopeCanonical'].includes(k))),
        previewReviewHash: hash(review), executionReviewHash: hash(review), ledgerPaymentProofFingerprint: a.settlement.ledgerPaymentProof?.fingerprint ?? null,
        documentVerification: 'UNVERIFIED', financialWrites: 0, acceptance: { runId: run.id, itemId: item.id, runRevision: run.revision,
          itemUpdatedAt: item.updated_at, actorId: actor.id, actorEmail: actor.email } };
      const mappingId = randomUUID();
      tables.xero_financial_document_mappings.push({ id: mappingId, salesforce_object: item.source_object, salesforce_id: item.source_id,
        document_kind: 'supplier_bill', xero_document_type: 'ACCPAY', xero_document_id: a.targetId, xero_contact_id: a.contactId,
        xero_status: a.target.Status, source_fingerprint: a.sourceFingerprint, financial_fingerprint: a.financialFingerprint,
        protected_legacy: true, retained_differences: { financialBucketPreservation: receipt } });
      tables.xero_financial_audit_events.push({ id: 2, run_id: run.id, event_type: EVENT, outcome: 'success', actor_id: actor.id, actor_email: actor.email,
        record_counts: { linked: 1, applied: 0, financialWrites: 0 }, fingerprints: { tenantId: a.tenantId, itemId: item.id, mappingId, financialBucketPreservation: receipt } });
      Object.assign(item, { status: 'linked', updated_at: new Date().toISOString(), applied_at: new Date().toISOString() });
      if (controls.lostLink) throw Error('PRIVATE_LINK_RESPONSE');
      return { data: { id: item.id, status: 'linked', xeroDocumentId: a.targetId, mappingId, policyVersion: POLICY,
        receiptContract: SUPPLIER_FINANCIAL_BUCKET_RECEIPT, fingerprint: review.fingerprint, approvalMaterialHash: review.approvalMaterialHash,
        previewEvidenceFingerprint: review.evidenceFingerprint, executionEvidenceFingerprint: review.evidenceFingerprint,
        ledgerPaymentProofFingerprint: receipt.ledgerPaymentProofFingerprint, documentVerification: 'UNVERIFIED', financialWrites: 0, alreadyLinked: false }, error: null };
    },
  };
  const collectFinancial = async selected => {
    calls.push({ type: 'collector', scope: copy(selected) }); collections++;
    const input = copy(f.input); if (collections > 1) controls.mutateCurrent?.(input);
    const scopeMaterial = { ...copy(selected), cases: [{ caseId: selected.caseIds[0], sourceId: input.source.parent.Id, targetId: input.target.InvoiceID }] };
    if (controls.mutateScope) controls.mutateScope(scopeMaterial);
    const collection = { policyVersion: POLICY, complete: true, actorId: actor.id, tenantId: ids.tenant, scopeFingerprint: hash(scopeMaterial),
      approvalGranted: false, financialWrites: 0, workflowEligible: false, observation: { endedAt: new Date().toISOString(), forecast: { maximumCalls: 65 } },
      cases: [{ caseId: selected.caseIds[0], sourceId: input.source.parent.Id, targetId: input.target.InvoiceID }] };
    controls.mutateCollection?.(collection);
    captures.set(collection, { scopeMaterial, inputs: [input], sources: [copy(input.source.sourcePayload)], targets: [copy(input.target)] });
    return collection;
  };
  const deps = { client, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, accessContext: { profile: actor }, connection: { tenant_id: ids.tenant },
    collectFinancial, privateFinancialEvidence: collection => captures.get(collection), fetchImpl: () => assert.fail('No provider operation allowed') };
  const applyBody = v => ({ runId: v.run.id, revision: v.run.revision, reviewed: true, selectedItemIds: v.rows.filter(r => r.status === 'eligible').map(r => r.id) });
  return { f, scope, calls, controls, tables, deps, actor, applyBody, preview: () => preview(scope, deps) };
}
const rpcCount = (h, name) => h.calls.filter(c => c.type === 'rpc' && c.name === name).length;
const noLink = h => assert.equal(rpcCount(h, 'link_xero_financial_bucket_document_v1'), 0);
const noApproval = h => { noLink(h); assert.equal(rpcCount(h, 'authorise_xero_financial_sync_run_v1'), 0); assert.equal(rpcCount(h, 'start_xero_financial_sync_run_v1'), 0); };

test('paid and authorised financial previews retain exact private originals, explicit wire null and sanitized business results', async () => {
  for (const paid of [false, true]) {
    const h = harness({ paid, tracking: true }), v = await h.preview(); assert.equal(v.summary.eligible, 1); assert.equal(v.financialWrites, 0); assert.equal(v.documentVerification, 'UNVERIFIED');
    const item = h.tables.xero_financial_sync_items[0]; assert.equal(item.proposed_payload, null); assert.equal(item.mutation_attempts, 0);
    assert.deepEqual(item.xero_payload, h.f.target); assert.deepEqual(item.source_payload.supplierFinancialReview.evidence.accounting.source, h.f.input.source);
    const disclosed = [{ lineItemId: h.f.target.LineItems[0].LineItemID, category: 'Job', option: 'FCBV', sourceEquivalenceEstablished: false }];
    assert.deepEqual(v.rows[0].targetTracking, disclosed); const reopened = await read({ runId: v.run.id }, h.deps);
    assert.deepEqual(reopened.rows[0].targetTracking, disclosed); noPrivate(v); noPrivate(reopened); noApproval(h);
    const out = await apply(h.applyBody(v), h.deps); assert.equal(out.run.status, 'completed'); assert.equal(out.outcomes.length, 1);
    assert.equal(out.outcomes[0].linked, 1); assert.equal(out.outcomes[0].applied, 0); assert.equal(out.financialWrites, 0); noPrivate(out);
    assert.equal(rpcCount(h, 'link_xero_financial_bucket_document_v1'), 1);
  }
});

test('HTTP proof, payload, completeness and extraneous request fields are rejected before collection or local writes', async () => {
  const h = harness();
  for (const extra of [{ proof: h.f.input }, { proposedPayload: {} }, { complete: true }, { packet: {} }]) await assert.rejects(preview({ ...h.scope, ...extra }, h.deps));
  assert.equal(h.calls.length, 0);
  const v = await h.preview(); h.calls.length = 0;
  for (const extra of [{ proof: h.f.input }, { approvalGranted: true }, { selectedItemIds: [...h.applyBody(v).selectedItemIds, ...h.applyBody(v).selectedItemIds] }])
    await assert.rejects(apply({ ...h.applyBody(v), ...extra }, h.deps));
  assert.equal(h.calls.length, 0);
});

test('returned collector scope must bind exact campaign, case order and revision before publication', async () => {
  for (const mutate of [scope => { scope.campaignId = uuid(990); }, scope => { scope.expectedRevision++; }, scope => { scope.caseIds = ['other-case']; }]) {
    const h = harness(); h.controls.mutateScope = mutate; await assert.rejects(h.preview()); assert.equal(rpcCount(h, 'persist_xero_supplier_financial_preview_v1'), 0);
  }
  const h = harness(); h.controls.mutateCollection = collection => { collection.cases[0].caseId = 'other-case'; };
  await assert.rejects(h.preview()); assert.equal(rpcCount(h, 'persist_xero_supplier_financial_preview_v1'), 0);
});

test('stale source, signed target, claim scope and exact selection hold before approval or link', async () => {
  for (const mutate of [input => { input.source.parent.Invoice_Amount__c = '1.00'; }, input => { input.target.LineItems[0].LineAmount = '1.00'; },
    input => { input.identity.sourceMappings.push({ id: uuid(991), salesforce_id: ids.source }); }]) {
    const h = harness(), v = await h.preview(); h.calls.length = 0; h.controls.mutateCurrent = mutate;
    await assert.rejects(apply(h.applyBody(v), h.deps)); noApproval(h);
  }
  const h = harness(), v = await h.preview(); h.calls.length = 0;
  await assert.rejects(apply({ ...h.applyBody(v), revision: v.run.revision + 1 }, h.deps)); noApproval(h);
  h.tables.xero_financial_sync_runs[0].status = 'authorised'; h.tables.xero_financial_sync_runs[0].reviewed_by = h.actor.id;
  h.tables.xero_financial_sync_runs[0].reviewed_by_email = h.actor.email;
  await assert.rejects(apply(h.applyBody(v), h.deps)); noApproval(h);
});

test('publication compares immutable run snapshot and exact item readback, with no forced retry after uncertainty', async () => {
  for (const mutate of [(run) => { run.control_totals.supplierFinancialWorkflow.scope.caseIds = ['other-case']; },
    (run) => { run.control_totals.workflowSnapshot.inputEvidenceHash = hash('changed'); },
    (run) => { run.created_at = run.created_at.replace(/(\.\d{3})(\+00:00)$/, (_match, fraction, offset) => `${fraction}001${offset}`); },
    (_run, items) => { items[0].proposed_payload = {}; }]) {
    const h = harness(); h.controls.afterPublish = mutate; await assert.rejects(h.preview()); assert.equal(rpcCount(h, 'persist_xero_supplier_financial_preview_v1'), 1); noApproval(h);
  }
  const lost = harness(); lost.controls.lostPublish = true; const recovered = await lost.preview(); assert.equal(recovered.run.status, 'ready_for_review');
  assert.equal(rpcCount(lost, 'persist_xero_supplier_financial_preview_v1'), 1);
  const unavailable = harness(); unavailable.controls.lostPublish = true; unavailable.controls.unavailableReadback = true;
  await assert.rejects(unavailable.preview(), e => !e.message.includes('PRIVATE')); assert.equal(rpcCount(unavailable, 'persist_xero_supplier_financial_preview_v1'), 1); noApproval(unavailable);
});

test('public saved-row serializers never emit private proof nested in JSON blockers', async () => {
  const h = harness(), v = await h.preview(), item = h.tables.xero_financial_sync_items[0];
  item.blockers = [{ code: 'HELD', path: 'identity', privateOriginals: item.source_payload.supplierFinancialReview.evidence }];
  noPrivate(await read({ runId: v.run.id }, h.deps));
});

test('interrupted committed link recovery uses original receipt acceptance and zero additional link RPCs', async () => {
  const h = harness({ paid: true }), v = await h.preview(); h.controls.lostFinish = true;
  await assert.rejects(apply(h.applyBody(v), h.deps)); assert.equal(rpcCount(h, 'link_xero_financial_bucket_document_v1'), 1);
  const run = h.tables.xero_financial_sync_runs[0], item = h.tables.xero_financial_sync_items[0]; assert.equal(run.status, 'processing'); assert.equal(item.status, 'linked');
  h.controls.lostFinish = false; h.calls.length = 0;
  await assert.rejects(apply({ ...h.applyBody(v), revision: run.revision - 1 }, h.deps)); noLink(h);
  const out = await apply({ runId: run.id, revision: run.revision, reviewed: true, selectedItemIds: [item.id] }, h.deps);
  assert.equal(out.run.status, 'completed'); assert.equal(out.outcomes[0].recovered, true); noLink(h); noPrivate(out);
});

test('uncommitted uncertain link remains processing and is never blindly retried during interrupted recovery', async () => {
  const h = harness(), v = await h.preview(); h.controls.uncommittedLink = true;
  await assert.rejects(apply(h.applyBody(v), h.deps)); const run = h.tables.xero_financial_sync_runs[0], item = h.tables.xero_financial_sync_items[0];
  assert.equal(run.status, 'processing'); assert.equal(item.status, 'selected'); h.calls.length = 0;
  await assert.rejects(apply({ runId: run.id, revision: run.revision, reviewed: true, selectedItemIds: [item.id] }, h.deps)); noLink(h);
});

test('definite link rejection finishes the failed run and releases the writer barrier without retry', async () => {
  const h = harness(), v = await h.preview(); h.controls.definiteRejection = true;
  await assert.rejects(apply(h.applyBody(v), h.deps), e => e.code === 'SUPPLIER_FINANCIAL_LINK_REJECTED');
  assert.equal(h.tables.xero_financial_sync_runs[0].status, 'failed');
  assert.equal(rpcCount(h, 'link_xero_financial_bucket_document_v1'), 1);
  assert.equal(rpcCount(h, 'finish_xero_financial_sync_run_v1'), 1); assert.equal(h.tables.xero_financial_document_mappings.length, 0);
});
