import { previewEvidenceHash } from './_xeroPreviewPersistence.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const SOURCE_ID = /^[a-z0-9]{15}(?:[a-z0-9]{3})?$/i;

function fail(code, message) {
  throw Object.assign(new Error(message), { code: `XERO_NATIVE_DOCUMENT_${code}`, status: 409 });
}

function acknowledgedId(request, response) {
  const credit = request.draft.xeroCollection === 'CreditNotes';
  const idField = credit ? 'CreditNoteID' : 'InvoiceID';
  const numberField = credit ? 'CreditNoteNumber' : 'InvoiceNumber';
  const rows = response?.[request.draft.xeroCollection];
  const row = rows?.[0];
  const payload = request.draft.payload;
  if (!Array.isArray(rows) || rows.length !== 1 || !UUID.test(row?.[idField] || '')
      || /^0{8}(?:-0{4}){3}-0{12}$/.test(row[idField]) || row[numberField] !== payload[numberField]
      || row.Type !== payload.Type || row.Contact?.ContactID !== payload.Contact.ContactID
      || row.CurrencyCode !== payload.CurrencyCode || row.Status !== 'DRAFT'
      || row.HasErrors === true || row.HasValidationErrors === true || row.ValidationErrors?.length) {
    fail('ACK_UNVERIFIED', 'Xero did not acknowledge the exact native draft identity.');
  }
  return row[idField];
}

export async function executeNativeDocumentDraft(body, {
  tenantId, actorId, ledger, loadReview, prepareSend, send, readOutcome, settle, recoveryOnly = false,
} = {}) {
  if (body?.reviewed !== true || !UUID.test(tenantId || '') || !UUID.test(actorId || '')
      || !UUID.test(body.operationId || '') || !SOURCE_ID.test(body.sourceId || '')
      || !['Invoice__c', 'Supplier_Invoice__c'].includes(body.sourceObject) || !SHA.test(body.reviewFingerprint || '')) {
    fail('REVIEW_REQUIRED', 'Select one exact reviewed native document operation.');
  }
  const key = { tenantId, operationId: body.operationId };
  const matches = row => row?.tenant_id === tenantId && row.operation_id === body.operationId && row.actor_id === actorId
    && row.source_id === body.sourceId && row.source_object === body.sourceObject
    && row.review_fingerprint === body.reviewFingerprint && row.request_evidence?.draft?.reviewFingerprint === body.reviewFingerprint
    && row.request_hash === previewEvidenceHash(row.request_evidence);
  const reload = async () => {
    const original = await ledger.get(key);
    if (!matches(original)) fail('OPERATION_MISMATCH', 'The original native document operation could not be verified.');
    return original;
  };
  let operation = await ledger.get(key);
  let claimed = false;
  if (!operation) {
    if (recoveryOnly) fail('OPERATION_MISMATCH', 'The original native document operation was not found.');
    const review = await loadReview(body);
    if (review?.tenantId !== tenantId || review.sourceId !== body.sourceId || review.sourceObject !== body.sourceObject
        || review.draft?.status !== 'draft_preview' || review.draft.reviewFingerprint !== body.reviewFingerprint) {
      fail('STALE', 'The native document draft changed. Refresh the Finance review.');
    }
    const result = await ledger.claim({ ...key, review, requestHash: previewEvidenceHash(review) });
    operation = result?.operation;
    claimed = result?.claimed === true;
  }
  if (!matches(operation)) fail('OPERATION_MISMATCH', 'The original native document operation could not be verified.');
  const request = operation.request_evidence;
  const operationKey = { ...key, requestHash: operation.request_hash };
  const receipt = row => ({ operationId: row.operation_id, status: row.status, xeroId: row.observed_xero_id, mappingId: row.mapping_id });

  async function cancelUnsent() {
    let cancelled;
    try { cancelled = (await ledger.cancel(operationKey))?.operation; } catch { /* Verify by original-operation readback. */ }
    if (!matches(cancelled) || cancelled.status !== 'cancelled_before_send') cancelled = await reload();
    if (cancelled.status !== 'cancelled_before_send') fail('CANCEL_UNVERIFIED', 'The original draft may have crossed its send boundary.');
    return receipt(cancelled);
  }

  if (operation.status === 'cancelled_before_send') return receipt(operation);
  if (recoveryOnly && operation.status === 'intent') return cancelUnsent();

  if (claimed && operation.status === 'intent') {
    try {
      const fresh = await loadReview(body);
      if (!fresh || previewEvidenceHash(fresh) !== operation.request_hash) fail('STALE', 'The native document review changed before send.');
      await prepareSend(operation);
    } catch {
      return cancelUnsent();
    }
    let marker;
    try { marker = await ledger.markSent(operationKey); } catch { /* A lost marker acknowledgement never grants send authority. */ }
    if (marker?.changed === true && matches(marker.operation) && marker.operation.status === 'sent' && marker.operation.send_started_at) {
      operation = marker.operation;
      try {
        const response = await send(request.draft, operation.operation_id, operation);
        const xeroId = acknowledgedId(request, response);
        const observed = (await ledger.observeId(operationKey, xeroId))?.operation;
        operation = matches(observed) && observed.observed_xero_id === xeroId ? observed : await reload();
      } catch {
        operation = await reload();
      }
    } else {
      operation = await reload();
    }
  }

  if (operation.status === 'confirmed') {
    await settle(operation);
    return receipt(operation);
  }
  if (!operation.send_started_at) fail('IN_PROGRESS', 'The original native document has no confirmed send marker.');

  try {
    if (!operation.observed_xero_id) fail('UNKNOWN', 'The original Xero draft has no acknowledged provider ID.');
    const proof = await readOutcome(request, operation);
    if (proof.xeroId !== operation.observed_xero_id) fail('UNKNOWN', 'The Xero draft readback has a different identity.');
    const result = await ledger.confirm(operationKey, {
      xeroId: proof.xeroId, mapping: proof.mapping, observed: { ...proof.observed, transport: proof.transport },
    });
    operation = matches(result?.operation) ? result.operation : await reload();
  } catch {
    operation = await reload();
    if (operation.status !== 'confirmed') {
      try { await ledger.markUnknown(operationKey); } catch { /* The original send marker continues to hold the source. */ }
      fail('UNKNOWN', 'The original native draft is unresolved. Verify the existing operation before proceeding.');
    }
  }
  if (operation.status !== 'confirmed') fail('UNKNOWN', 'The original native draft mapping could not be confirmed.');
  await settle(operation);
  return receipt(operation);
}
