import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFixture, draftFixtureAvailable, draftIds as ids } from './xeroExistingDraftAuthorisation.fixture.js';
import { issuedSupplierCanonical as canonical, issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';
import { buildExistingDraftAuthorisationEvidence, EXISTING_DRAFT_AUTHORISATION_POLICY as POLICY, EXISTING_DRAFT_AUTHORISATION_RECEIPT as RECEIPT } from '../api/_xeroExistingDraftAuthorisationPolicy.js';
import { claimExistingDraftAuthorisation as claimIntent, bindExistingDraftAuthorisationRequest as bindRequest,
  finishExistingDraftAuthorisation as finish, readExistingDraftAuthorisationOutcome as readOutcome } from '../api/_xeroExistingDraftAuthorisationPersistence.js';

const privateTest = (name, fn) => test(name, { skip: !draftFixtureAvailable }, fn);
const clone = v => structuredClone(v), stamp = '2026-10-05T00:00:00.123456Z';
function harness() {
  const fixture = draftFixture(), proof = buildExistingDraftAuthorisationEvidence(fixture.input), actor = fixture.actor;
  const args = { runId: ids.run, expectedRunRevision: 3, itemId: ids.item, expectedItemUpdatedAt: stamp, tenantId: proof.evidence.current.tenantId,
    idempotencyKey: `draft-status:${ids.run}:${ids.item}`, evidence: proof.evidence, actor };
  const claim = { id: ids.claim, run_id: ids.run, item_id: ids.item, run_revision: 3, item_updated_at: stamp, tenant_id: proof.evidence.current.tenantId,
    target_id: fixture.targetId, mapping_id: ids.mapping, idempotency_key: args.idempotencyKey, evidence: proof.evidence,
    evidence_canonical: canonical(proof.evidence), evidence_hash: proof.fingerprint, actor_id: actor.id, actor_email: actor.email, created_at: stamp };
  const binding = { claim_id: ids.claim, request_id: ids.request, budget_id: ids.budget, token_version: 2, actor_id: actor.id, actor_email: actor.email, created_at: stamp };
  const request = { requestId: ids.request, budgetId: ids.budget, tokenVersion: 2 }, verification = { requestId: ids.verification, budgetId: ids.budget, tokenVersion: 2 };
  const db = { xero_existing_draft_authorisation_claims: [], xero_existing_draft_authorisation_requests: [], xero_existing_draft_authorisation_events: [],
    xero_shared_requests: [{ id: ids.verification, tenant_id: proof.evidence.current.tenantId, method: 'GET', resource_key: 'Invoices', budget_id: ids.budget, token_version: 2,
      phase: 'verification', state: 'complete', outcome_unknown: false, response_status: 200, completed_at: '2026-10-05T00:00:01.000000Z' }],
    xero_financial_document_mappings: [], xero_financial_sync_items: [], xero_financial_audit_events: [] };
  const calls = [], reads = []; let rpcHook = null, readHook = null;
  function event(e) {
    const evidence_hash = hash(e), r = { receiptContract: RECEIPT, policyVersion: POLICY, claimId: ids.claim, claimEvidenceHash: proof.fingerprint,
      outcomeEvidenceHash: evidence_hash, sourceFingerprint: proof.evidence.source.sourceFingerprint, financialFingerprint: proof.evidence.source.financialFingerprint,
      ...Object.fromEntries(['selectionFileSha256', 'selectionSha256', 'humanApprovalSha256'].map(k => [k, proof.evidence.selection[k]])),
      documentVerification: 'UNVERIFIED', status: e.status, request: e.request, verification: e.verification, targetId: fixture.targetId, mappingId: ids.mapping,
      runId: ids.run, itemId: ids.item, actorId: actor.id, actorEmail: actor.email, authorisations: e.status === 'confirmed' ? 1 : 0,
      financialWrites: e.status === 'confirmed' ? 1 : 0, sending: 0, payments: 0, allocations: 0, lineChanges: 0 };
    return { id: ids.event, claim_id: ids.claim, sequence: '1', status: e.status, evidence: e, evidence_canonical: canonical(e), evidence_hash,
      actor_id: actor.id, actor_email: actor.email, receipt: r, audit_id: e.status === 'confirmed' ? 42 : null, created_at: stamp };
  }
  function effects(ev) {
    db.xero_financial_document_mappings = [{ ...clone(proof.evidence.current.controls.documentMappings[0]), xero_status: 'AUTHORISED', updated_at: stamp, last_reconciled_at: stamp }];
    db.xero_financial_sync_items = [{ id: ids.item, run_id: ids.run, status: 'updated', xero_document_status: 'AUTHORISED', selected: true,
      mutation_attempts: 1, proposed_payload: null, source_payload: { ...clone(proof.evidence.source), existingDraftAuthorisation: clone(proof.evidence) }, xero_payload: clone(proof.evidence.before) }];
    db.xero_financial_audit_events = [{ id: 42, run_id: ids.run, event_type: 'existing_draft_status_authorisation_confirmed', outcome: 'success', actor_id: actor.id,
      actor_email: actor.email, record_counts: { authorisations: 1, financialWrites: 1, sending: 0, payments: 0, allocations: 0, lineChanges: 0 }, fingerprints: { existingDraftAuthorisation: ev.receipt } }];
  }
  const client = { from(table) { const filters = []; let ordering = null, limit = Infinity;
    const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, order(k, opts) { ordering = [k, opts]; return q; }, limit(n) { limit = n; return q; },
      then(resolve, reject) { reads.push(table); try { if (readHook) readHook(table); let data = (db[table] || []).filter(r => filters.every(([k, v]) => r[k] === v));
        if (ordering) data = [...data].sort((a, b) => Number(b[ordering[0]]) - Number(a[ordering[0]])); resolve({ data: clone(data.slice(0, limit)), error: null }); } catch (e) { reject(e); } } }; return q;
  }, async rpc(name, params) { calls.push({ name, params: clone(params) });
    let data;
    if (name === 'claim_xero_existing_draft_authorisation_v1') { db.xero_existing_draft_authorisation_claims = [clone(claim)]; data = { ...claim, status: 'intent', request: null, latestReceipt: null, alreadyClaimed: false }; }
    else if (name === 'bind_xero_existing_draft_authorisation_request_v1') { db.xero_existing_draft_authorisation_requests = [clone(binding)]; data = binding; }
    else if (name === 'finish_xero_existing_draft_authorisation_v1') { const ev = event(params.p_evidence); db.xero_existing_draft_authorisation_events = [clone(ev)]; if (ev.status === 'confirmed') effects(ev); data = { ...ev, claim, linkedMapping: db.xero_financial_document_mappings[0] || null, item: db.xero_financial_sync_items[0] || null }; }
    else throw Error('unexpected RPC');
    if (rpcHook) return rpcHook(name, clone(data)); return { data: clone(data), error: null };
  } };
  const finishEvidence = status => ({ policyVersion: POLICY, claimEvidenceHash: proof.fingerprint,
    observed: status === 'uncertain' ? null : { ...clone(proof.evidence.before), Status: status === 'confirmed' ? 'AUTHORISED' : 'DRAFT' },
    verification: status === 'uncertain' ? null : verification, request, status });
  async function seed() { await claimIntent(client, args); await bindRequest(client, { claimId: ids.claim, ...request, actor }); }
  return { fixture, proof, args, claim, binding, request, verification, db, calls, reads, client, event, effects, finishEvidence, seed,
    setRpcHook: f => { rpcHook = f; }, setReadHook: f => { readHook = f; }, actor,
    recovery: { claimId: ids.claim, runId: ids.run, itemId: ids.item, tenantId: proof.evidence.current.tenantId, expectedEvidenceHash: proof.fingerprint, actor } };
}

privateTest('fixed claim, planned request and confirmed finish preserve originals and only count one authorisation', async () => {
  const h = harness(); await h.seed(); const result = await finish(h.client, { claimId: ids.claim, status: 'confirmed', evidenceFinish: h.finishEvidence('confirmed'), actor: h.actor });
  assert.equal(result.status, 'confirmed'); assert.equal(result.latestReceipt.receipt.financialWrites, 1);
  assert.equal(result.latestReceipt.receipt.lineChanges, 0); assert.equal(result.item.proposed_payload, null); assert.deepEqual(result.item.xero_payload, h.proof.evidence.before);
  assert.deepEqual(h.calls.map(c => c.name), ['claim_xero_existing_draft_authorisation_v1', 'bind_xero_existing_draft_authorisation_request_v1', 'finish_xero_existing_draft_authorisation_v1']);
  assert.equal(h.calls[0].params.p_tenant_id, h.proof.evidence.current.tenantId); assert.equal(h.calls[0].params.p_actor_email, h.actor.email); assert.ok(Object.isFrozen(result.claim.evidence.current.organisation));
});

privateTest('altered evidence, foreign tenant, stale revision/time or idempotency are held before mutation', async () => {
  for (const alter of [a => { a.evidence.selection.selectionSha256 = '0'.repeat(64); }, a => { a.tenantId = ids.run; }, a => { a.expectedRunRevision = 0; },
    a => { a.expectedItemUpdatedAt = '2026-02-30T00:00:00Z'; }, a => { a.idempotencyKey = 'caller-choice'; }]) {
    const h = harness(), args = clone(h.args); alter(args); await assert.rejects(claimIntent(h.client, args)); assert.equal(h.calls.length, 0);
  }
  const h = harness(); h.setRpcHook((n, data) => { data.item_updated_at = '2026-10-05T00:00:00.123457Z'; return { data }; });
  await assert.rejects(claimIntent(h.client, h.args), /CLAIM_MISMATCH/); assert.equal(h.calls.length, 1);
});

privateTest('lost claim and binding responses recover exact durable originals without RPC retry', async () => {
  const h = harness(); h.setRpcHook(() => { throw Error('lost response with private provider value'); });
  const c = await claimIntent(h.client, h.args); assert.equal(c.alreadyClaimed, true);
  const b = await bindRequest(h.client, { claimId: ids.claim, ...h.request, actor: h.actor }); assert.equal(b.request_id, ids.request); assert.equal(h.calls.length, 2);
});

privateTest('lost finish response and subsequent read-only recovery validate exact item mapping audit receipt', async () => {
  const h = harness(); await h.seed(); h.setRpcHook(() => { throw Error('lost finish response'); });
  const r = await finish(h.client, { claimId: ids.claim, status: 'confirmed', evidenceFinish: h.finishEvidence('confirmed'), actor: h.actor }); assert.equal(r.status, 'confirmed');
  const before = h.calls.length; const recovered = await readOutcome(h.client, h.recovery); assert.equal(recovered.status, 'confirmed'); assert.equal(h.calls.length, before);
  h.db.xero_financial_document_mappings[0].financial_fingerprint = '0'.repeat(64); await assert.rejects(readOutcome(h.client, h.recovery), /DURABLE_EFFECTS_MISMATCH/);
});

privateTest('uncertain observation remains journalled without applied effects, resend or forced retry', async () => {
  const h = harness(); await h.seed(); const r = await finish(h.client, { claimId: ids.claim, status: 'uncertain', evidenceFinish: h.finishEvidence('uncertain'), actor: h.actor });
  assert.equal(r.status, 'uncertain'); assert.equal(r.latestReceipt.receipt.financialWrites, 0); assert.equal(h.db.xero_financial_document_mappings.length, 0);
  const count = h.calls.length; await readOutcome(h.client, h.recovery); assert.equal(h.calls.length, count);
});

privateTest('rejection permits changed observed target only for DB-proven never-admitted POST plus completed GET', async () => {
  const h = harness(); await h.seed(); const e = h.finishEvidence('rejected'); e.observed.Total += 1;
  const r = await finish(h.client, { claimId: ids.claim, status: 'rejected', evidenceFinish: e, actor: h.actor }); assert.equal(r.status, 'rejected'); assert.equal(r.latestReceipt.receipt.financialWrites, 0);
  const h2 = harness(); await h2.seed(); h2.db.xero_shared_requests.push({ id: ids.request, tenant_id: h2.proof.evidence.current.tenantId, method: 'POST', resource_key: 'Invoices', budget_id: ids.budget,
    token_version: 2, phase: 'operation', state: 'unknown', outcome_unknown: true, response_status: null });
  await assert.rejects(finish(h2.client, { claimId: ids.claim, status: 'rejected', evidenceFinish: h2.finishEvidence('rejected'), actor: h2.actor }), /READBACK_HELD/);
  assert.equal(h2.calls.length, 2);
});

privateTest('admitted definite 4xx refusal requires unchanged DRAFT, while 408/409/429 stay uncertain', async () => {
  for (const code of [400, 408, 409, 429]) {
    const h = harness(); await h.seed(); h.db.xero_shared_requests.push({ id: ids.request, tenant_id: h.proof.evidence.current.tenantId, method: 'POST', resource_key: 'Invoices', budget_id: ids.budget,
      token_version: 2, phase: 'operation', state: 'complete', outcome_unknown: false, response_status: code });
    const op = finish(h.client, { claimId: ids.claim, status: 'rejected', evidenceFinish: h.finishEvidence('rejected'), actor: h.actor });
    if (code === 400) assert.equal((await op).status, 'rejected'); else await assert.rejects(op, /READBACK_HELD/);
  }
});

privateTest('incomplete/unavailable readback and mismatched private receipts fail closed without leaked RPC messages', async () => {
  const h = harness(); await h.seed(); h.setRpcHook(() => { throw Error('PRIVATE_KEY_SHOULD_NOT_LEAK'); }); h.setReadHook(t => { if (t === 'xero_existing_draft_authorisation_events') throw Error('PRIVATE_KEY_SHOULD_NOT_LEAK'); });
  await assert.rejects(finish(h.client, { claimId: ids.claim, status: 'uncertain', evidenceFinish: h.finishEvidence('uncertain'), actor: h.actor }), e => !e.message.includes('PRIVATE_KEY') && e.code === 'DRAFT_AUTHORISATION_READBACK_UNAVAILABLE');
  const h2 = harness(); await h2.seed(); const e = h2.finishEvidence('uncertain'), ev = h2.event(e); ev.receipt.payments = 1; h2.db.xero_existing_draft_authorisation_events = [ev];
  await assert.rejects(readOutcome(h2.client, h2.recovery), /RECEIPT_MISMATCH/);
  assert.equal(h2.calls.length, 2);
});

test('invalid public transport context is rejected before any database operation', async () => {
  let calls = 0; const client = { rpc() { calls++; }, from() { calls++; } };
  await assert.rejects(claimIntent(client, {})); await assert.rejects(readOutcome(client, {})); assert.equal(calls, 0);
});

privateTest('55P03 claim lock rejection holds without recovery reads, retries or durable intent', async () => {
  const h = harness();
  h.setRpcHook(() => {
    h.db.xero_existing_draft_authorisation_claims = [];
    return { data: null, error: { code: '55P03', message: 'Private tenant lock detail' } };
  });
  await assert.rejects(claimIntent(h.client, h.args), e => e.code === 'DRAFT_AUTHORISATION_INTENT_REJECTED'
    && !e.message.includes('Private tenant'));
  assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 0);
  assert.equal(h.db.xero_existing_draft_authorisation_claims.length, 0);
});
