import { copyPaidSupplierProofJson as copyOriginal } from './_xeroPaidSupplierProofJson.js';
import { issuedSupplierCanonical as canonical, issuedSupplierHash as hash } from './_xeroIssuedSupplierPreservation.js';
import { EXISTING_DRAFT_AUTHORISATION_POLICY as POLICY, EXISTING_DRAFT_AUTHORISATION_RECEIPT as RECEIPT,
  evaluateExistingDraftAuthorisationEvidence, classifyExistingDraftAuthorisationReadback } from './_xeroExistingDraftAuthorisationPolicy.js';

const CLAIMS = 'xero_existing_draft_authorisation_claims', REQUESTS = 'xero_existing_draft_authorisation_requests', EVENTS = 'xero_existing_draft_authorisation_events';
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) && v !== '00000000-0000-0000-0000-000000000000';
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => canonical(a) === canonical(b);
const keys = (v, expected) => plain(v) && same(Object.keys(v).sort(), [...expected].sort());
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const failure = code => Object.assign(Error(code), { code, status: 409 });
const requireThat = (ok, code = 'DRAFT_AUTHORISATION_STORAGE_HELD') => { if (!ok) throw failure(code); };
const terminal = status => ['confirmed', 'rejected'].includes(status);
const identity = v => keys(v, ['requestId', 'budgetId', 'tokenVersion']) && uuid(v.requestId) && uuid(v.budgetId)
  && Number.isSafeInteger(v.tokenVersion) && v.tokenVersion > 0;
const digest = /^[a-f0-9]{64}$/;
const positiveId = v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 || typeof v === 'string' && /^[1-9]\d{0,19}$/.test(v);

// Full private rows repeat an original E and its canonical string. The distinct
// transport bound does not increase the 1 MB strict original-evidence bound.
function transport(value) {
  let nodes = 0; const visiting = new Set();
  const walk = (v, depth) => {
    requireThat(++nodes <= 100_000 && depth <= 24, 'DRAFT_AUTHORISATION_TRANSPORT_BOUND');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)) return v;
    requireThat(typeof v === 'object' && !visiting.has(v) && Object.getPrototypeOf(v) === (Array.isArray(v) ? Array.prototype : Object.prototype), 'DRAFT_AUTHORISATION_TRANSPORT_JSON');
    visiting.add(v); const d = Object.getOwnPropertyDescriptors(v), own = Reflect.ownKeys(d), array = Array.isArray(v), result = array ? [] : {};
    requireThat(own.every(k => typeof k === 'string') && (!array || own.length === v.length + 1), 'DRAFT_AUTHORISATION_TRANSPORT_JSON');
    for (const key of own) {
      if (array && key === 'length') continue;
      requireThat(Object.hasOwn(d[key], 'value') && d[key].enumerable && (!array || /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < v.length), 'DRAFT_AUTHORISATION_TRANSPORT_JSON');
      Object.defineProperty(result, key, { value: walk(d[key].value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    visiting.delete(v); return result;
  };
  const result = walk(value, 0); requireThat(plain(result) && Buffer.byteLength(JSON.stringify(result)) <= 4_000_000, 'DRAFT_AUTHORISATION_TRANSPORT_BOUND'); return result;
}
function instant(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59 || m[6] !== 'Z' && (Number(m[6].slice(1, 3)) > 23 || Number(m[6].slice(4, 6)) > 59)) return null;
  const day = Date.parse(`${m[1]}T00:00:00Z`), base = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[6]}`);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === m[1] && Number.isFinite(base)
    ? BigInt(base) * 1000n + BigInt((m[5] || '').padEnd(6, '0') || '0') : null;
}
function actorFields(actor) {
  requireThat(uuid(actor?.id) && typeof actor.email === 'string' && actor.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor.email.trim()), 'DRAFT_AUTHORISATION_ACTOR_HELD');
  return { id: actor.id, email: actor.email.trim().toLowerCase() };
}
function original(value) {
  const proof = evaluateExistingDraftAuthorisationEvidence(value); requireThat(proof.proofValid, 'DRAFT_AUTHORISATION_EVIDENCE_HELD');
  return { evidence: proof.evidence, canonical: canonical(proof.evidence), fingerprint: proof.fingerprint };
}
function context(args) {
  requireThat(uuid(args?.runId) && uuid(args.itemId) && uuid(args.tenantId) && Number.isSafeInteger(args.expectedRunRevision) && args.expectedRunRevision > 0
    && instant(args.expectedItemUpdatedAt) !== null && args.idempotencyKey === `draft-status:${args.runId}:${args.itemId}`, 'DRAFT_AUTHORISATION_CONTEXT_HELD');
  const a = actorFields(args.actor), proof = original(args.evidence); requireThat(proof.evidence.current.tenantId === args.tenantId, 'DRAFT_AUTHORISATION_TENANT_HELD');
  return { ...proof, runId: args.runId, itemId: args.itemId, tenantId: args.tenantId, runRevision: args.expectedRunRevision,
    itemUpdatedAt: args.expectedItemUpdatedAt, idempotencyKey: args.idempotencyKey, actor: a };
}
const rpcActor = a => ({ p_actor_id: a.id, p_actor_email: a.email });
async function many(client, table, configure, limit = 2) {
  try {
    const r = await configure(client.from(table).select('*')).limit(limit);
    requireThat(!r.error && Array.isArray(r.data) && r.data.length <= limit, 'DRAFT_AUTHORISATION_READBACK_UNAVAILABLE');
    return r.data;
  } catch { throw failure('DRAFT_AUTHORISATION_READBACK_UNAVAILABLE'); }
}
async function one(client, table, configure) { const rows = await many(client, table, configure); requireThat(rows.length === 1, 'DRAFT_AUTHORISATION_READBACK_INCOMPLETE'); return rows[0]; }
function validateClaim(value, c) {
  const row = transport(value), proof = original(row.evidence);
  requireThat(uuid(row.id) && row.run_id === c.runId && row.item_id === c.itemId && row.tenant_id === c.tenantId
    && row.target_id === proof.evidence.before.InvoiceID && row.mapping_id === proof.evidence.current.controls.documentMappings[0]?.id
    && Number.isSafeInteger(row.run_revision) && row.run_revision > 0 && instant(row.item_updated_at) !== null
    && row.idempotency_key === c.idempotencyKey && row.actor_id === c.actor.id && row.actor_email === c.actor.email
    && row.evidence_hash === c.fingerprint && row.evidence_hash === proof.fingerprint && row.evidence_canonical === proof.canonical
    && (!Object.hasOwn(c, 'runRevision') || row.run_revision === c.runRevision)
    && (!Object.hasOwn(c, 'itemUpdatedAt') || instant(row.item_updated_at) !== null && instant(row.item_updated_at) === instant(c.itemUpdatedAt)), 'DRAFT_AUTHORISATION_CLAIM_MISMATCH');
  return freeze(row);
}
function validateBinding(value, claimId, planned = null) {
  const b = transport(value), projection = { requestId: b.request_id, budgetId: b.budget_id, tokenVersion: b.token_version };
  requireThat(b.claim_id === claimId && identity(projection) && (!planned || same(projection, planned)), 'DRAFT_AUTHORISATION_REQUEST_MISMATCH');
  return freeze(b);
}
const projection = b => b ? { requestId: b.request_id, budgetId: b.budget_id, tokenVersion: b.token_version } : null;
const protectedBefore = v => Object.fromEntries(Object.entries(v).filter(([k]) => !['Status', 'UpdatedDateUTC', 'UpdatedDateUTCString'].includes(k)));
function validateFinish(value, claim, binding, facts = {}) {
  let e; try { e = copyOriginal(value); } catch { throw failure('DRAFT_AUTHORISATION_OUTCOME_JSON_HELD'); }
  requireThat(keys(e, ['policyVersion', 'claimEvidenceHash', 'observed', 'verification', 'request', 'status']) && e.policyVersion === POLICY
    && e.claimEvidenceHash === claim.evidence_hash && ['confirmed', 'rejected', 'uncertain'].includes(e.status)
    && identity(e.request) && same(e.request, projection(binding)) && (plain(e.observed) || e.status === 'uncertain' && e.observed === null)
    && (identity(e.verification) || e.status === 'uncertain' && e.verification === null), 'DRAFT_AUTHORISATION_OUTCOME_HELD');
  const readback = classifyExistingDraftAuthorisationReadback({ evidence: claim.evidence, observed: e.observed });
  requireThat(e.status === 'uncertain' || e.observed !== null && e.verification !== null
    && (e.status === 'confirmed' ? readback.status === 'confirmed'
      : facts.neverAdmitted === true && e.observed.InvoiceID === claim.target_id || facts.definitiveRefusal === true && readback.status === 'unchanged'), 'DRAFT_AUTHORISATION_READBACK_HELD');
  return freeze(e);
}
// Rejection reasons come from exact durable admission/verification facts,
// never a caller's definitive/never-admitted flag. An admitted ambiguous POST
// remains uncertain even when its subsequent GET still shows DRAFT.
async function rejectionFacts(client, claim, binding, evidence) {
  if (evidence?.status !== 'rejected') return {};
  requireThat(identity(evidence.verification) && identity(evidence.request) && same(evidence.request, projection(binding)), 'DRAFT_AUTHORISATION_OUTCOME_HELD');
  const v = evidence.verification;
  const verification = transport(await one(client, 'xero_shared_requests', q => q.eq('id', v.requestId).eq('tenant_id', claim.tenant_id)));
  requireThat(verification.method === 'GET' && verification.resource_key === 'Invoices' && verification.budget_id === v.budgetId
    && verification.token_version === v.tokenVersion && ['operation', 'verification'].includes(verification.phase)
    && verification.state === 'complete' && verification.outcome_unknown === false && Number.isInteger(verification.response_status)
    && verification.response_status >= 200 && verification.response_status < 300 && instant(verification.completed_at) !== null
    && instant(binding.created_at) !== null && instant(verification.completed_at) >= instant(binding.created_at), 'DRAFT_AUTHORISATION_VERIFICATION_HELD');
  const admitted = await many(client, 'xero_shared_requests', q => q.eq('id', binding.request_id).eq('tenant_id', claim.tenant_id));
  requireThat(admitted.length <= 1, 'DRAFT_AUTHORISATION_RECOVERY_CONFLICT');
  if (!admitted.length) return { neverAdmitted: true };
  const post = transport(admitted[0]);
  requireThat(post.method === 'POST' && post.resource_key === 'Invoices' && post.budget_id === binding.budget_id
    && post.token_version === binding.token_version && post.phase === 'operation', 'DRAFT_AUTHORISATION_REQUEST_MISMATCH');
  return { definitiveRefusal: post.state === 'complete' && post.outcome_unknown === false && Number.isInteger(post.response_status)
    && post.response_status >= 400 && post.response_status < 500 && ![408, 409, 429].includes(post.response_status) };
}
const RECEIPT_KEYS = Object.freeze(['receiptContract', 'policyVersion', 'claimId', 'claimEvidenceHash', 'outcomeEvidenceHash', 'sourceFingerprint', 'financialFingerprint',
  'selectionFileSha256', 'selectionSha256', 'humanApprovalSha256', 'documentVerification', 'status', 'request', 'verification', 'targetId', 'mappingId',
  'runId', 'itemId', 'actorId', 'actorEmail', 'authorisations', 'financialWrites', 'sending', 'payments', 'allocations', 'lineChanges']);
function validateEvent(value, claim, binding, facts = {}) {
  const row = transport(value), e = validateFinish(row.evidence, claim, binding, facts), r = row.receipt, p = claim.evidence;
  requireThat(row.claim_id === claim.id && uuid(row.id) && positiveId(row.sequence) && row.status === e.status
    && row.evidence_canonical === canonical(e) && row.evidence_hash === hash(e) && row.actor_id === claim.actor_id && row.actor_email === claim.actor_email
    && keys(r, RECEIPT_KEYS) && same(r, { receiptContract: RECEIPT, policyVersion: POLICY, claimId: claim.id, claimEvidenceHash: claim.evidence_hash,
      outcomeEvidenceHash: row.evidence_hash, sourceFingerprint: p.source.sourceFingerprint, financialFingerprint: p.source.financialFingerprint,
      ...Object.fromEntries(['selectionFileSha256', 'selectionSha256', 'humanApprovalSha256'].map(k => [k, p.selection[k]])), documentVerification: 'UNVERIFIED',
      status: e.status, request: e.request, verification: e.verification, targetId: claim.target_id, mappingId: claim.mapping_id, runId: claim.run_id, itemId: claim.item_id,
      actorId: claim.actor_id, actorEmail: claim.actor_email, authorisations: e.status === 'confirmed' ? 1 : 0, financialWrites: e.status === 'confirmed' ? 1 : 0,
      sending: 0, payments: 0, allocations: 0, lineChanges: 0 }), 'DRAFT_AUTHORISATION_RECEIPT_MISMATCH');
  return freeze(row);
}
async function confirmEffects(client, claim, event) {
  const mapping = transport(await one(client, 'xero_financial_document_mappings', q => q.eq('id', claim.mapping_id)));
  const item = transport(await one(client, 'xero_financial_sync_items', q => q.eq('id', claim.item_id).eq('run_id', claim.run_id)));
  const audit = transport(await one(client, 'xero_financial_audit_events', q => q.eq('id', event.audit_id).eq('run_id', claim.run_id)));
  const old = claim.evidence.current.controls.documentMappings[0], skip = v => Object.fromEntries(Object.entries(v).filter(([k]) => !['xero_status', 'updated_at', 'last_reconciled_at'].includes(k)));
  const marker = item.source_payload?.existingDraftAuthorisation, proof = evaluateExistingDraftAuthorisationEvidence(marker);
  requireThat(same(skip(mapping), skip(old)) && mapping.xero_status === 'AUTHORISED' && item.status === 'updated' && item.xero_document_status === 'AUTHORISED'
    && item.selected === true && item.mutation_attempts === 1 && item.proposed_payload === null && proof.proofValid
    && same(marker.source, claim.evidence.source) && same(marker.selection, claim.evidence.selection) && same(marker.reviewedTarget, claim.evidence.reviewedTarget)
    && same(protectedBefore(marker.before), protectedBefore(claim.evidence.before)) && same(item.xero_payload, marker.before)
    && same(Object.fromEntries(Object.entries(item.source_payload).filter(([k]) => k !== 'existingDraftAuthorisation')), marker.source)
    && positiveId(event.audit_id) && audit.event_type === 'existing_draft_status_authorisation_confirmed' && audit.outcome === 'success'
    && audit.actor_id === claim.actor_id && audit.actor_email === claim.actor_email
    && same(audit.record_counts, { authorisations: 1, financialWrites: 1, sending: 0, payments: 0, allocations: 0, lineChanges: 0 })
    && same(audit.fingerprints, { existingDraftAuthorisation: event.receipt }), 'DRAFT_AUTHORISATION_DURABLE_EFFECTS_MISMATCH');
  return { mapping: freeze(mapping), item: freeze(item), audit: freeze(audit) };
}

/** Private service-only DB readback; this entrypoint never calls a mutation RPC. */
export async function readExistingDraftAuthorisationOutcome(client, args) {
  requireThat(uuid(args?.runId) && uuid(args.itemId) && uuid(args.tenantId) && digest.test(args.expectedEvidenceHash || '')
    && (!args.claimId || uuid(args.claimId)), 'DRAFT_AUTHORISATION_RECOVERY_CONTEXT_HELD');
  const actor = actorFields(args.actor), idempotencyKey = args.idempotencyKey || `draft-status:${args.runId}:${args.itemId}`;
  requireThat(idempotencyKey === `draft-status:${args.runId}:${args.itemId}`, 'DRAFT_AUTHORISATION_RECOVERY_CONTEXT_HELD');
  const rows = await many(client, CLAIMS, q => {
    q = q.eq('run_id', args.runId).eq('item_id', args.itemId).eq('tenant_id', args.tenantId).eq('idempotency_key', idempotencyKey);
    return args.claimId ? q.eq('id', args.claimId) : q;
  });
  requireThat(rows.length <= 1, 'DRAFT_AUTHORISATION_RECOVERY_CONFLICT'); if (!rows.length) return null;
  const claim = validateClaim(rows[0], { runId: args.runId, itemId: args.itemId, tenantId: args.tenantId, idempotencyKey, fingerprint: args.expectedEvidenceHash, actor });
  const requests = await many(client, REQUESTS, q => q.eq('claim_id', claim.id)); requireThat(requests.length <= 1, 'DRAFT_AUTHORISATION_RECOVERY_CONFLICT');
  const request = requests.length ? validateBinding(requests[0], claim.id) : null;
  const events = await many(client, EVENTS, q => q.eq('claim_id', claim.id).order('sequence', { ascending: false }), 2);
  const event = events.length ? validateEvent(events[0], claim, request, await rejectionFacts(client, claim, request, events[0].evidence)) : null;
  if (events.length === 2) requireThat(BigInt(events[0].sequence) > BigInt(events[1].sequence) && !terminal(events[1].status), 'DRAFT_AUTHORISATION_RECOVERY_CONFLICT');
  const effects = event?.status === 'confirmed' ? await confirmEffects(client, claim, event) : {};
  return freeze({ claim, request, latestReceipt: event, status: event?.status || 'intent', ...effects });
}
const readArgs = (c, claimId) => ({ ...(claimId ? { claimId } : {}), runId: c.runId, itemId: c.itemId, tenantId: c.tenantId,
  idempotencyKey: c.idempotencyKey, expectedEvidenceHash: c.fingerprint, actor: c.actor });
const definitive = e => ['22023', '40001', '42501', '23505', '23514', '55P03'].includes(e?.code);

export async function claimExistingDraftAuthorisation(client, args) {
  const c = context(args); let response;
  try { response = await client.rpc('claim_xero_existing_draft_authorisation_v1', { p_run_id: c.runId, p_expected_run_revision: c.runRevision,
    p_item_id: c.itemId, p_expected_item_updated_at: c.itemUpdatedAt, p_tenant_id: c.tenantId, p_idempotency_key: c.idempotencyKey,
    p_evidence: c.evidence, p_canonical: c.canonical, p_fingerprint: c.fingerprint, ...rpcActor(c.actor) }); }
  catch { response = null; }
  if (response?.error && definitive(response.error)) throw failure('DRAFT_AUTHORISATION_INTENT_REJECTED');
  if (response && !response.error) {
    const claim = validateClaim(response.data, c);
    requireThat(['intent', 'uncertain', 'confirmed', 'rejected'].includes(claim.status) && typeof claim.alreadyClaimed === 'boolean', 'DRAFT_AUTHORISATION_CLAIM_MISMATCH');
    return claim;
  }
  const recovered = await readExistingDraftAuthorisationOutcome(client, readArgs(c)); requireThat(recovered, 'DRAFT_AUTHORISATION_INTENT_UNCERTAIN');
  validateClaim(recovered.claim, c); return freeze({ ...recovered.claim, status: recovered.status, request: recovered.request, latestReceipt: recovered.latestReceipt, alreadyClaimed: true });
}
export async function bindExistingDraftAuthorisationRequest(client, args) {
  const actor = actorFields(args?.actor), planned = { requestId: args?.requestId, budgetId: args?.budgetId, tokenVersion: args?.tokenVersion };
  requireThat(uuid(args?.claimId) && identity(planned), 'DRAFT_AUTHORISATION_REQUEST_HELD');
  let response; try { response = await client.rpc('bind_xero_existing_draft_authorisation_request_v1', { p_claim_id: args.claimId,
    p_request_id: planned.requestId, p_budget_id: planned.budgetId, p_token_version: planned.tokenVersion, ...rpcActor(actor) }); } catch { response = null; }
  if (response?.error && definitive(response.error)) throw failure('DRAFT_AUTHORISATION_REQUEST_REJECTED');
  if (response && !response.error) return validateBinding(response.data, args.claimId, planned);
  const row = await one(client, REQUESTS, q => q.eq('claim_id', args.claimId)); return validateBinding(row, args.claimId, planned);
}
export async function finishExistingDraftAuthorisation(client, args) {
  const actor = actorFields(args?.actor); requireThat(uuid(args?.claimId) && ['confirmed', 'rejected', 'uncertain'].includes(args.status), 'DRAFT_AUTHORISATION_OUTCOME_HELD');
  const raw = transport(await one(client, CLAIMS, q => q.eq('id', args.claimId)));
  const c = { runId: raw.run_id, itemId: raw.item_id, tenantId: raw.tenant_id, idempotencyKey: raw.idempotency_key, fingerprint: raw.evidence_hash, actor };
  const claim = validateClaim(raw, c), binding = validateBinding(await one(client, REQUESTS, q => q.eq('claim_id', claim.id)), claim.id);
  const e = validateFinish(args.evidenceFinish, claim, binding, await rejectionFacts(client, claim, binding, args.evidenceFinish)); requireThat(e.status === args.status, 'DRAFT_AUTHORISATION_OUTCOME_HELD');
  let response; try { response = await client.rpc('finish_xero_existing_draft_authorisation_v1', { p_claim_id: claim.id, p_status: e.status,
    p_evidence: e, p_canonical: canonical(e), p_fingerprint: hash(e), ...rpcActor(actor) }); } catch { response = null; }
  if (response?.error && definitive(response.error)) throw failure('DRAFT_AUTHORISATION_OUTCOME_REJECTED');
  if (response && !response.error) validateEvent(response.data, claim, binding, await rejectionFacts(client, claim, binding, response.data?.evidence));
  const recovered = await readExistingDraftAuthorisationOutcome(client, readArgs(c, claim.id));
  requireThat(recovered?.latestReceipt && recovered.latestReceipt.evidence_hash === hash(e) && recovered.status === e.status, 'DRAFT_AUTHORISATION_OUTCOME_UNCERTAIN');
  return recovered;
}
