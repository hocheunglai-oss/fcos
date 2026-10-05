import { previewEvidenceHash, validatePreviewPaymentStorage } from './_xeroPreviewPersistence.js';
import { loadPublishedPreviewCheckpoint, previewCheckpointReference } from './_xeroPreviewCheckpoint.js';

function invalid() {
  return Object.assign(new Error('Complete same-capture payment evidence could not be verified.'), {
    code: 'XERO_PREVIEW_CHECKPOINT_CORRUPT', status: 409,
  });
}

/** Replace only a verified complete capture's duplicate payment payload. */
export function compactPreviewPayments(snapshot, checkpoint) {
  if (!checkpoint || snapshot.payments == null) return snapshot;
  const reference = previewCheckpointReference(checkpoint);
  const capturedPayments = checkpoint.payload?.provider?.payments;
  if (checkpoint.payload?.complete !== true || !Array.isArray(capturedPayments?.rows)
    || capturedPayments.tenantId !== reference.tenantId
    || previewEvidenceHash(capturedPayments) !== previewEvidenceHash(snapshot.payments)) throw invalid();
  const { payments: _payments, ...compact } = snapshot;
  compact.paymentsReference = reference;
  validatePreviewPaymentStorage(compact, { includePayments: true, tenantId: reference.tenantId, actorId: reference.actorId });
  return compact;
}

/** Hydrate before classification or display; never treat a reference as zero rows. */
export async function hydratePreviewPayments(client, run, { actorId = run?.created_by,
  tenantId = run?.control_totals?.workflowSnapshot?.tenantId, captured = null,
  loadCheckpoint = loadPublishedPreviewCheckpoint } = {}) {
  const snapshot = run?.control_totals?.workflowSnapshot || {};
  if (!Object.hasOwn(snapshot, 'paymentsReference')) return snapshot;
  validatePreviewPaymentStorage(snapshot, { includePayments: snapshot.includePayments, tenantId, actorId });
  if (snapshot.includePayments !== true || snapshot.paymentsReference.actorId !== actorId
    || run.created_by !== actorId || snapshot.tenantId !== tenantId) throw invalid();
  const reference = snapshot.paymentsReference;
  const evidence = captured || await loadCheckpoint(client, reference, { runId: run.id, actorId, tenantId });
  if (evidence.state !== 'published' || evidence.published_run_id !== run.id
    || previewEvidenceHash(previewCheckpointReference(evidence)) !== previewEvidenceHash(reference)
    || evidence.payload?.complete !== true || previewEvidenceHash(evidence.payload) !== reference.payloadHash
    || !Array.isArray(evidence.payload.provider?.payments?.rows)
    || evidence.payload.provider.payments.tenantId !== tenantId) throw invalid();
  const { paymentsReference: _reference, ...hydrated } = snapshot;
  return { ...hydrated, payments: evidence.payload.provider.payments };
}
