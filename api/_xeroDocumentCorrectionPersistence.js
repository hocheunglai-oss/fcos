import { createHash } from 'node:crypto';

export const DOCUMENT_CORRECTION_POLICY = 'document_field_correction_v1';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => Object.assign(new Error(message), { code: 'XERO_DOCUMENT_CORRECTION_STORAGE_FAILED', status: 409 });
export const documentCorrectionCanonical = value => JSON.stringify(value, (_key, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const documentCorrectionHash = value => createHash('sha256').update(documentCorrectionCanonical(value)).digest('hex');

function envelope(evidence) {
  let canonical;
  try {
    const seen = new Set(); let nodes = 0;
    const check = (value, depth = 0) => {
      if (++nodes > 30000 || depth > 50) throw new Error('Evidence bounds');
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
      if (typeof value === 'number' && Number.isFinite(value)) return;
      if (typeof value !== 'object' || seen.has(value)
        || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw new Error('Non-JSON evidence');
      seen.add(value);
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) { if (!Object.hasOwn(value, i)) throw new Error('Sparse evidence'); check(value[i], depth + 1); }
      } else for (const item of Object.values(value)) check(item, depth + 1);
      seen.delete(value);
    };
    check(evidence); canonical = documentCorrectionCanonical(evidence);
  } catch { throw fail('Complete JSON correction evidence is required.'); }
  if (!plain(evidence) || typeof canonical !== 'string' || Buffer.byteLength(canonical, 'utf8') > 250000) throw fail('Correction evidence is missing or exceeds its bound.');
  // JSONB and JavaScript must agree on material facts, including literal nulls.
  if (canonical !== documentCorrectionCanonical(JSON.parse(canonical))) throw fail('Correction evidence cannot be serialized consistently.');
  return { evidence: JSON.parse(canonical), canonical, fingerprint: createHash('sha256').update(canonical).digest('hex') };
}

function actorFields(actor) {
  if (!uuid(actor?.id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(actor.id)
    || typeof actor.email !== 'string' || !actor.email.trim() || actor.email.length > 320
    || /[\u0000-\u001f\u007f]/u.test(actor.email)) throw fail('A verified correction actor is required.');
  return { p_actor_id: actor.id, p_actor_email: actor.email.trim().toLowerCase() };
}

export async function claimDocumentCorrection(client, { tenantId, xeroInvoiceId, mappingId = null, idempotencyKey, evidence, actor }) {
  const proof = envelope(evidence);
  if (!uuid(tenantId) || !uuid(xeroInvoiceId) || (mappingId !== null && !uuid(mappingId))
    || typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200
    || proof.evidence.policyVersion !== DOCUMENT_CORRECTION_POLICY) throw fail('Exact correction identity and policy are required.');
  const result = await client.rpc('claim_xero_document_field_correction_v1', { p_tenant_id: tenantId,
    p_xero_invoice_id: xeroInvoiceId, p_mapping_id: mappingId, p_idempotency_key: idempotencyKey,
    p_evidence: proof.evidence, p_canonical: proof.canonical, p_fingerprint: proof.fingerprint, ...actorFields(actor) });
  if (result.error || !uuid(result.data?.id) || result.data.tenant_id !== tenantId.toLowerCase()
    || result.data.xero_invoice_id !== xeroInvoiceId.toLowerCase() || result.data.evidence_hash !== proof.fingerprint
    || !['intent', 'uncertain', 'confirmed', 'rejected'].includes(result.data.status)
    || typeof result.data.alreadyClaimed !== 'boolean') throw fail('The durable correction intent could not be confirmed. Do not send a provider update.');
  return result.data;
}

export async function finishDocumentCorrection(client, { claimId, status, evidence, actor }) {
  const proof = envelope(evidence);
  if (!uuid(claimId) || !['confirmed', 'rejected', 'uncertain'].includes(status)) throw fail('An exact correction claim and outcome are required.');
  const result = await client.rpc('finish_xero_document_field_correction_v1', { p_claim_id: claimId, p_status: status,
    p_evidence: proof.evidence, p_canonical: proof.canonical, p_fingerprint: proof.fingerprint, ...actorFields(actor) });
  if (result.error || !uuid(result.data?.id) || result.data.claim_id !== claimId.toLowerCase()
    || result.data.status !== status || result.data.evidence_hash !== proof.fingerprint || result.data.claim?.id !== claimId.toLowerCase()) {
    throw fail('The durable correction outcome could not be confirmed. Retain the correction barrier and inspect its exact receipt.');
  }
  return result.data;
}
