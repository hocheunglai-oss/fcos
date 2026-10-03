import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const XERO_PREVIEW_PERSISTENCE_VERSION = 1;
export const XERO_PREVIEW_STAGED_VERSION = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_METADATA = ['id', 'idempotency_key', 'created_by', 'created_by_email', 'created_at', 'updated_at',
  'source_snapshot_at', 'xero_snapshot_at', 'rate_limit_snapshot'];
const ITEM_METADATA = ['id', 'run_id', 'idempotency_key', 'created_at', 'updated_at'];
const CHECKPOINT_REFERENCE_KEYS = ['checkpointId', 'revision', 'actorId', 'tenantId', 'salesforceOrgId',
  'reconciliationVersion', 'inputOptions', 'inputEvidenceHash', 'payloadHash', 'storageHash', 'tokenVersion',
  'capturedAt', 'storageVersion'].sort();

// Match JSON persistence semantics, then sort object keys only. Array order and
// every unlisted field remain material; timestamps in financial evidence stay.
export function previewEvidenceHash(value) {
  const canonical = (entry) => Array.isArray(entry) ? entry.map(canonical)
    : entry && typeof entry === 'object'
      ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, canonical(entry[key])])) : entry;
  return createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex');
}

export function previewReviewIdentity(run, items) {
  const normalized = JSON.parse(JSON.stringify({ run, items }));
  for (const key of RUN_METADATA) delete normalized.run[key];
  const snapshot = normalized.run.control_totals?.workflowSnapshot;
  if (snapshot) {
    for (const key of ['checkedAt', 'reviewIdentity', 'persistencePayloadHash']) delete snapshot[key];
    if (snapshot.payments) {
      delete snapshot.payments.actor;
      delete snapshot.payments.rateLimit;
    }
  }
  for (const item of normalized.items) {
    for (const key of ITEM_METADATA) delete item[key];
    if (item.source_payload?.sourceFileDiscovery) delete item.source_payload.sourceFileDiscovery.capturedAt;
  }
  return previewEvidenceHash(normalized);
}

// Referenced payments always resolve to provider.payments in the exact inventory
// capture. A caller cannot supply a path, row count, partial summary or substitute.
export function validatePreviewPaymentStorage(snapshot, { includePayments, tenantId, actorId } = {}) {
  const reference = snapshot?.paymentsReference;
  const referenced = snapshot && Object.hasOwn(snapshot, 'paymentsReference');
  if (!snapshot) throw failure('Complete payment storage evidence is required.');
  if (!includePayments) {
    if (referenced || snapshot.payments != null) throw failure('A documents-only check cannot contain payment evidence.');
    return;
  }
  if (referenced) {
    if (Object.hasOwn(snapshot, 'payments') || snapshot.linkFirst !== true || !snapshot.inventoryReference
      || !reference || typeof reference !== 'object' || Array.isArray(reference)
      || Object.keys(reference).sort().join(',') !== CHECKPOINT_REFERENCE_KEYS.join(',')
      || previewEvidenceHash(reference) !== previewEvidenceHash(snapshot.inventoryReference)
      || reference.storageVersion !== 2 || reference.tenantId !== tenantId
      || (actorId !== undefined && reference.actorId !== actorId)
      || !UUID.test(reference.checkpointId || '') || !UUID.test(reference.actorId || '')
      || reference.inputOptions?.includePayments !== true
      || reference.inputOptions?.linkFirst !== true || reference.inputOptions?.recordExactMatches !== false
      || !/^[a-f0-9]{64}$/.test(reference.payloadHash || '')
      || !/^[a-f0-9]{64}$/.test(reference.storageHash || '')) {
      throw failure('Payment evidence must reference the exact complete inventory capture.');
    }
  } else if (!Array.isArray(snapshot.payments?.rows) || snapshot.payments.tenantId !== tenantId) {
    throw failure('The payment and document checks must belong to the same Xero organisation.');
  }
}

export function preparePreviewPersistence(run, items, { tenantId, includePayments, salesforceOrgId, inputEvidenceHash }) {
  if (!UUID.test(tenantId || '') || !salesforceOrgId || !/^[a-f0-9]{64}$/.test(inputEvidenceHash || '')) {
    throw failure('Complete provider identity and evidence are required before saving a financial check.');
  }
  const snapshot = run.control_totals?.workflowSnapshot;
  validatePreviewPaymentStorage(snapshot, { includePayments, tenantId, actorId: run.created_by });
  const prepared = { ...run, control_totals: { ...run.control_totals, workflowSnapshot: {
    ...snapshot, persistenceVersion: snapshot.inventoryReference?.storageVersion === 2 ? XERO_PREVIEW_STAGED_VERSION : XERO_PREVIEW_PERSISTENCE_VERSION, complete: true,
    expectedItemCount: items.length, tenantId, salesforceOrgId, includePayments,
    recordExactMatches: false, inputEvidenceHash,
  } } };
  const identity = previewReviewIdentity(prepared, items);
  prepared.control_totals.workflowSnapshot.reviewIdentity = identity;
  return { p_run: prepared, p_items: items, p_review_identity: identity };
}

export async function persistFinancialPreview(client, parameters) {
  if (parameters.p_run.control_totals?.workflowSnapshot?.persistenceVersion === XERO_PREVIEW_STAGED_VERSION) {
    return persistStagedPreview(client, parameters);
  }
  // Retry an uncertain transport outcome once with the identical UUID/payload.
  // A committed request is recovered by the RPC, even if already reviewed.
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      result = await client.rpc('persist_xero_financial_preview_v1', parameters);
    } catch (error) {
      if (!attempt && ['TypeError', 'AbortError', 'TimeoutError'].includes(error?.name)) continue;
      throw failure('The complete financial check could not be saved.');
    }
    if (!attempt && result?.error && [0, 502, 503, 504].includes(result.status)) continue;
    break;
  }
  if (result?.error || !result?.data) throw failure('The complete financial check could not be saved.');
  const { run, items, reused } = result.data;
  const snapshot = run?.control_totals?.workflowSnapshot;
  if (!UUID.test(run?.id || '') || typeof reused !== 'boolean' || !Array.isArray(items)
    || snapshot?.persistenceVersion !== XERO_PREVIEW_PERSISTENCE_VERSION || snapshot?.complete !== true
    || snapshot?.reviewIdentity !== parameters.p_review_identity
    || snapshot?.expectedItemCount !== parameters.p_items.length || items.length !== parameters.p_items.length
    || (!reused && (run.id !== parameters.p_run.id || run.status !== 'ready_for_review' || run.revision !== 1))) {
    throw failure('The saved financial check could not be verified.');
  }
  const identities = new Map(items.map((item) => [item.row_key, item.id]));
  if (identities.size !== items.length || new Set(items.map((item) => item.id)).size !== items.length
    || items.some((item) => !UUID.test(item.id || ''))
    || parameters.p_items.some((item) => !identities.has(item.row_key))) {
    throw failure('The saved financial check has incomplete row identities.');
  }
  return { run, identities, reused };
}

async function stagedRpc(client, name, parameters) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result;
    try { result = await client.rpc(name, parameters); }
    catch (error) {
      if (!attempt && ['TypeError', 'AbortError', 'TimeoutError'].includes(error?.name)) continue;
      throw failure('The complete financial check could not be saved.');
    }
    if (!attempt && result?.error && [0, 502, 503, 504].includes(result.status)) continue;
    if (result?.error || !result?.data) throw failure('The complete financial check could not be saved.');
    return result.data;
  }
  throw failure('The complete financial check could not be saved.');
}

export function previewItemBatches(items) {
  const batches = [];
  let batch = [], bytes = 2;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item), 'utf8');
    if (size > 256 * 1024) throw failure('An evidence row exceeds the bounded preview storage limit. No rows were dropped.');
    if (bytes + size + (batch.length ? 1 : 0) > 450 * 1024) { batches.push(batch); batch = []; bytes = 2; }
    bytes += size + (batch.length ? 1 : 0); batch.push(item);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function persistStagedPreview(client, parameters) {
  if (Buffer.byteLength(JSON.stringify(parameters.p_run), 'utf8') > 8 * 1024 * 1024) {
    throw failure('The preview summary exceeds the bounded storage limit. No evidence was truncated.');
  }
  const batches = previewItemBatches(parameters.p_items);
  const begin = await stagedRpc(client, 'begin_xero_financial_preview_v2', {
    p_run: parameters.p_run, p_expected_item_count: parameters.p_items.length, p_review_identity: parameters.p_review_identity,
  });
  if (begin.runId !== parameters.p_run.id || begin.expectedItemCount !== parameters.p_items.length) throw failure('The preview intent could not be verified.');
  let saved = begin.state === 'published' && begin.run ? begin : null;
  if (!saved) {
    for (const p_items of batches) await stagedRpc(client, 'append_xero_financial_preview_v2', {
      p_run_id: parameters.p_run.id, p_review_identity: parameters.p_review_identity, p_items,
    });
    saved = await stagedRpc(client, 'finalize_xero_financial_preview_v2', {
      p_run_id: parameters.p_run.id, p_review_identity: parameters.p_review_identity,
    });
  }
  const identities = saved.items || saved.identities;
  if (saved.run?.id !== parameters.p_run.id || typeof saved.reused !== 'boolean' || !Array.isArray(identities)
    || identities.length !== parameters.p_items.length) throw failure('The saved financial check could not be verified.');
  const loaded = await client.from('xero_financial_sync_runs').select('*').eq('id', saved.run.id).maybeSingle();
  const run = loaded.data, snapshot = run?.control_totals?.workflowSnapshot;
  if (loaded.error || snapshot?.persistenceVersion !== XERO_PREVIEW_STAGED_VERSION || snapshot.complete !== true
    || snapshot.reviewIdentity !== parameters.p_review_identity || snapshot.expectedItemCount !== identities.length
    || previewEvidenceHash(snapshot.inventoryReference) !== previewEvidenceHash(parameters.p_run.control_totals.workflowSnapshot.inventoryReference)
    || previewEvidenceHash(snapshot.paymentsReference || null) !== previewEvidenceHash(parameters.p_run.control_totals.workflowSnapshot.paymentsReference || null)
    || (!saved.reused && (run.status !== 'ready_for_review' || run.revision !== 1))) throw failure('The saved financial check could not be verified.');
  const bySource = new Map(identities.map(item => [item.row_key, item.id]));
  if (bySource.size !== identities.length || new Set(identities.map(item => item.id)).size !== identities.length
    || identities.some(item => !UUID.test(item.id || '')) || parameters.p_items.some(item => bySource.get(item.row_key) !== item.id)) {
    throw failure('The saved financial check has incomplete row identities.');
  }
  return { run, identities: bySource, reused: saved.reused };
}

function failure(message) {
  return Object.assign(new Error(message), { code: 'XERO_FINANCIAL_STORAGE_FAILED', status: 500 });
}
