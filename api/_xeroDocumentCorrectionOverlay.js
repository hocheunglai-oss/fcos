import { documentCorrectionHash as hash, DOCUMENT_CORRECTION_POLICY } from './_xeroDocumentCorrectionPersistence.js';

const sameSf = (a, b) => typeof a === 'string' && typeof b === 'string' && a.slice(0, 15) === b.slice(0, 15);
const stableMapping = ({ last_reconciled_at: _reconciled, updated_at: _updated, ...value }) => value;

// The immutable receipt is an additional evidence layer. It never replaces an
// accepted preservation proof or changes a payment's original mapping ID.
export function confirmedDocumentCorrection(source, target, mapping, controls, normalizeInvoice) {
  const claims = controls?.documentCorrectionClaims || [];
  const events = controls?.documentCorrectionEvents || [];
  const candidates = claims.filter((claim) => claim.evidence?.policyVersion === DOCUMENT_CORRECTION_POLICY
    && claim.evidence?.source?.object === source.salesforceObject && sameSf(claim.evidence.source.id, source.salesforceId)
    && claim.xero_invoice_id === target?.id && (!claim.mapping_id || claim.mapping_id === mapping?.id));
  const withoutTimestamp = ({ updatedDateUTC: _time, ...value }) => value;
  const targetHash = target && hash(withoutTimestamp(target));
  for (const claim of candidates.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    const evidence = claim.evidence;
    const event = events.filter((row) => row.claim_id === claim.id).sort((a, b) => Number(b.sequence) - Number(a.sequence))[0];
    if (!event || event.status !== 'confirmed' || event.evidence?.basis !== 'exact_provider_readback'
      || claim.evidence_hash !== hash(evidence) || event.evidence_hash !== hash(event.evidence)
      || hash(evidence.expectedAfter) !== hash(event.evidence.observed)
      || evidence.source.sourceFingerprint !== source.sourceFingerprint
      || evidence.source.financialFingerprint !== source.financialFingerprint
      || evidence.source.fieldSourceFingerprint !== source.documentFieldSourceFingerprint
      || evidence.source.projectionFingerprint !== source.documentFieldProjection?.fingerprint
      || !sameSf(evidence.source.accountId, source.accountId)
      || target.contactId !== source.contactId || target.currency !== source.currency
      || targetHash !== hash(withoutTimestamp(normalizeInvoice(evidence.expectedAfter)))) continue;
    if (!mapping || mapping.salesforce_object !== source.salesforceObject || !sameSf(mapping.salesforce_id, source.salesforceId)
      || mapping.xero_document_id !== target.id || mapping.xero_contact_id !== target.contactId) continue;
    if (claim.mapping_id && (!evidence.mappingSnapshot || hash(stableMapping(mapping)) !== hash(stableMapping(evidence.mappingSnapshot)))) continue;
    if (!claim.mapping_id && mapping.retained_differences?.documentFieldCorrection?.claimId !== claim.id) continue;
    return { claimId: claim.id, before: normalizeInvoice(evidence.before), after: normalizeInvoice(evidence.expectedAfter), evidence };
  }
  return null;
}
