import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { previewEvidenceHash } from './_xeroPreviewPersistence.js';

export const XERO_PREVIEW_CHECKPOINT_VERSION = 2;
export const XERO_PREVIEW_CHECKPOINT_TTL_SECONDS = 900;
export const XERO_PREVIEW_CHECKPOINT_MAX_BYTES = 100 * 1024 * 1024;
export const XERO_PREVIEW_CHECKPOINT_CHUNK_BYTES = 256 * 1024;
const MAX_CHUNKS = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const SECRET_KEYS = new Set(['accesstoken', 'refreshtoken', 'idtoken', 'authorization', 'password', 'clientsecret',
  'apikey', 'secretkey', 'servicerolekey', 'sessiontoken', 'cookie', 'setcookie', 'bearertoken', 'privatekey',
  'connection', 'env', 'client', 'actorauth']);
const PAYLOAD_KEYS = ['automaticMappingPolicy', 'callForecast', 'complete', 'provider', 'rate', 'snapshotStartedAt'];

function failure(code, message, status = 409) { return Object.assign(new Error(message), { code, status }); }
function invalid() { return failure('XERO_PREVIEW_CHECKPOINT_INVALID', 'Complete checkpoint identity and evidence are required.', 400); }
function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
function safeJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const check = (entry, depth = 0) => {
    if (depth > 64) throw invalid();
    if (Array.isArray(entry)) return entry.forEach(child => check(child, depth + 1));
    if (entry && typeof entry === 'object') for (const [key, child] of Object.entries(entry)) {
      if (SECRET_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        throw failure('XERO_PREVIEW_CHECKPOINT_SECRET', 'Credential material cannot be captured in a preview checkpoint.', 400);
      }
      check(child, depth + 1);
    }
  };
  check(value);
  let result;
  try { result = JSON.parse(JSON.stringify(value)); } catch { throw invalid(); }
  return result;
}

export function previewCheckpointScope(scope) {
  const options = scope?.inputOptions;
  if (!UUID.test(scope?.actorId || '') || !UUID.test(scope?.tenantId || '')
    || typeof scope?.salesforceOrgId !== 'string' || !scope.salesforceOrgId.trim()
    || !Number.isSafeInteger(scope?.reconciliationVersion) || scope.reconciliationVersion < 1
    || !DIGEST.test(scope?.inputEvidenceHash || '') || !options || options.linkFirst !== true
    || options.recordExactMatches !== false || typeof options.includePayments !== 'boolean'
    || !/^\d{4}-\d{2}-\d{2}$/.test(options.cutoffDate || '')
    || !Number.isFinite(Date.parse(`${options.cutoffDate}T00:00:00Z`))
    || new Date(`${options.cutoffDate}T00:00:00Z`).toISOString().slice(0, 10) !== options.cutoffDate
    || !['draft', 'authorised'].includes(options.postingMode)
    || (options.campaignId != null && !UUID.test(options.campaignId))) throw invalid();
  return { actorId: scope.actorId, tenantId: scope.tenantId, salesforceOrgId: scope.salesforceOrgId,
    reconciliationVersion: scope.reconciliationVersion, inputEvidenceHash: scope.inputEvidenceHash,
    inputOptions: { linkFirst: true, recordExactMatches: false, includePayments: options.includePayments,
      cutoffDate: options.cutoffDate, postingMode: options.postingMode, campaignId: options.campaignId || null } };
}

function capturedPayload(payload, scope) {
  const result = safeJson(payload);
  if (Object.keys(result).sort().join(',') !== PAYLOAD_KEYS.join(',') || result.complete !== true || !result.provider
    || typeof result.provider !== 'object' || Array.isArray(result.provider)
    || !result.provider.xero || !result.provider.accountResponse || !result.provider.taxResponse
    || !result.provider.allMappings || !Object.hasOwn(result.provider, 'payments')
    || !result.automaticMappingPolicy || !result.callForecast || !result.rate || !Number.isFinite(Date.parse(result.snapshotStartedAt))) throw invalid();
  if (result.provider.xero.tenantId !== scope.tenantId) throw invalid();
  if (scope.inputOptions.includePayments && (!result.provider.payments || result.provider.payments.tenantId !== scope.tenantId)) throw invalid();
  return result;
}

async function rpc(client, name, parameters) {
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { result = await client.rpc(name, parameters); }
    catch (error) {
      if (!attempt && ['TypeError', 'AbortError', 'TimeoutError'].includes(error?.name)) continue;
      throw failure('XERO_PREVIEW_CHECKPOINT_STORAGE_FAILED', 'The preview checkpoint could not be saved or loaded.', 503);
    }
    // Every mutation is immutable and accepts only an identical lost-response
    // retry. This never retries Xero or reuses a financial approval.
    if (!attempt && result?.error && [0, 502, 503, 504, 520].includes(result.status)) continue;
    break;
  }
  if (result?.error) {
    const known = ['INVALID', 'EXPIRED', 'STALE', 'MISMATCH', 'CORRUPT', 'SECRET', 'TOO_LARGE', 'CONNECTION_CHANGED', 'ACCESS_REQUIRED', 'PUBLICATION_INVALID'];
    const suffix = known.find(code => String(result.error.message || '').includes(`XERO_PREVIEW_CHECKPOINT_${code}`));
    throw failure(suffix ? `XERO_PREVIEW_CHECKPOINT_${suffix}` : 'XERO_PREVIEW_CHECKPOINT_STORAGE_FAILED',
      suffix === 'EXPIRED' ? 'The preview checkpoint expired. Run a new check.'
        : suffix === 'ACCESS_REQUIRED' ? 'Current Xero access is required.'
          : suffix === 'CONNECTION_CHANGED' ? 'The connected Xero organisation changed. Run a new check.'
            : suffix ? 'The preview checkpoint no longer matches this check. Run a new check.'
              : 'The preview checkpoint could not be saved or loaded.', suffix === 'ACCESS_REQUIRED' ? 403 : suffix === 'TOO_LARGE' ? 413 : suffix ? 409 : 503);
  }
  return result?.data;
}

function verified(row, scope, { state, id, revision, durable = false } = {}) {
  if (!row || !UUID.test(row.id || '') || (id && row.id !== id) || !Number.isSafeInteger(row.revision)
    || row.revision < 1 || (revision && row.revision !== revision) || (state && row.state !== state)
    || !['capturing', 'captured', 'published'].includes(row.state)
    || row.actor_id !== scope.actorId || row.tenant_id !== scope.tenantId
    || row.salesforce_org_id !== scope.salesforceOrgId || row.reconciliation_version !== scope.reconciliationVersion
    || row.input_evidence_hash !== scope.inputEvidenceHash
    || previewEvidenceHash(row.input_options) !== previewEvidenceHash(scope.inputOptions)
    || !Number.isFinite(Date.parse(row.expires_at))) throw failure('XERO_PREVIEW_CHECKPOINT_CORRUPT', 'The saved preview checkpoint could not be verified.');
  if (Date.parse(row.expires_at) <= Date.now() && !(durable && row.state === 'published')) throw failure('XERO_PREVIEW_CHECKPOINT_EXPIRED', 'The preview checkpoint expired. Run a new check.');
  if (row.storage_version !== 2 || (row.state !== 'capturing' && (!DIGEST.test(row.payload_hash || '')
    || !DIGEST.test(row.storage_hash || '')))) {
    throw failure('XERO_PREVIEW_CHECKPOINT_CORRUPT', 'The captured preview evidence could not be verified.');
  }
  return row;
}

export async function createPreviewCheckpoint(client, scope, { id = randomUUID(), ttlSeconds = XERO_PREVIEW_CHECKPOINT_TTL_SECONDS } = {}) {
  scope = previewCheckpointScope(scope);
  if (!UUID.test(id) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) throw invalid();
  return verified(await rpc(client, 'xero_preview_checkpoint_create_v2', { p_id: id, p_scope: scope, p_ttl_seconds: ttlSeconds }), scope, { id });
}

// Partition complete JSON values rather than serialising a large value inside
// one database transaction. Array order, object keys and every value survive.
export function partitionPreviewCheckpoint(payload) {
  const parts = [];
  const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
  const leaf = value => {
    const payloadText = JSON.stringify(value);
    if (Buffer.byteLength(payloadText, 'utf8') > XERO_PREVIEW_CHECKPOINT_CHUNK_BYTES || parts.length >= MAX_CHUNKS) {
      throw failure('XERO_PREVIEW_CHECKPOINT_TOO_LARGE', 'A complete evidence value exceeds the bounded checkpoint storage limit.', 413);
    }
    const ordinal = parts.length;
    parts.push({ ordinal, payloadText, payloadHash: previewEvidenceHash(value) });
    return { type: 'value', ordinal };
  };
  const visit = (value, depth = 0) => {
    if (depth > 64) throw invalid();
    if (bytes(value) <= XERO_PREVIEW_CHECKPOINT_CHUNK_BYTES) return leaf(value);
    if (Array.isArray(value)) {
      const entries = [];
      let segment = [], segmentBytes = 2, offset = 0;
      const flush = () => {
        if (!segment.length) return;
        const node = leaf(segment);
        entries.push({ offset, count: segment.length, ordinal: node.ordinal });
        offset += segment.length;
        segment = []; segmentBytes = 2;
      };
      for (const child of value) {
        const size = bytes(child);
        if (size + 2 > XERO_PREVIEW_CHECKPOINT_CHUNK_BYTES) {
          flush(); entries.push({ offset, count: 1, node: visit(child, depth + 1) }); offset += 1;
        } else {
          if (segmentBytes + size + (segment.length ? 1 : 0) > XERO_PREVIEW_CHECKPOINT_CHUNK_BYTES) flush();
          segmentBytes += size + (segment.length ? 1 : 0); segment.push(child);
        }
      }
      flush();
      return { type: 'array', length: value.length, entries };
    }
    if (value && typeof value === 'object') return { type: 'object', entries: Object.entries(value).map(([key, child]) => [key, visit(child, depth + 1)]) };
    return leaf(value);
  };
  // The root is always structural so SQL can enforce the closed payload schema.
  const manifest = { type: 'object', entries: Object.entries(payload).map(([key, value]) => [key, visit(value, 1)]) };
  if (bytes(manifest) > 512 * 1024) throw failure('XERO_PREVIEW_CHECKPOINT_TOO_LARGE', 'The complete checkpoint manifest exceeds its storage limit.', 413);
  return { manifest, parts };
}

export function reconstructPreviewCheckpoint(manifest, parts) {
  const byOrdinal = new Map(parts.map(part => [part.ordinal, part]));
  const used = new Set();
  const value = ordinal => {
    const part = byOrdinal.get(ordinal);
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || used.has(ordinal) || !part
      || typeof part.payloadText !== 'string' || Buffer.byteLength(part.payloadText, 'utf8') > XERO_PREVIEW_CHECKPOINT_CHUNK_BYTES
      || !DIGEST.test(part.payloadHash || '')) throw invalid();
    let parsed;
    try { parsed = JSON.parse(part.payloadText); } catch { throw invalid(); }
    if (previewEvidenceHash(parsed) !== part.payloadHash || JSON.stringify(canonical(parsed)) !== part.payloadText) throw invalid();
    used.add(ordinal);
    return parsed;
  };
  const visit = (node, depth = 0) => {
    if (!node || depth > 64) throw invalid();
    if (node.type === 'value') return value(node.ordinal);
    if (node.type === 'object' && Array.isArray(node.entries)) {
      const keys = new Set();
      return Object.fromEntries(node.entries.map(entry => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || keys.has(entry[0])) throw invalid();
        keys.add(entry[0]); return [entry[0], visit(entry[1], depth + 1)];
      }));
    }
    if (node.type === 'array' && Number.isSafeInteger(node.length) && node.length >= 0 && Array.isArray(node.entries)) {
      const result = [];
      for (const entry of node.entries) {
        if (entry.offset !== result.length || !Number.isSafeInteger(entry.count) || entry.count < 1) throw invalid();
        if (Object.hasOwn(entry, 'ordinal')) {
          const segment = value(entry.ordinal);
          if (!Array.isArray(segment) || segment.length !== entry.count || Object.hasOwn(entry, 'node')) throw invalid();
          for (const child of segment) result.push(child);
        } else {
          if (entry.count !== 1 || !entry.node) throw invalid();
          result.push(visit(entry.node, depth + 1));
        }
      }
      if (result.length !== node.length) throw invalid();
      return result;
    }
    throw invalid();
  };
  if (byOrdinal.size !== parts.length || parts.length > MAX_CHUNKS) throw invalid();
  const result = visit(manifest);
  if (used.size !== parts.length || parts.some((part, index) => part.ordinal !== index)) throw invalid();
  return result;
}

export async function savePreviewCheckpoint(client, { id, revision, scope, payload }) {
  scope = previewCheckpointScope(scope);
  if (!UUID.test(id || '') || !Number.isSafeInteger(revision) || revision < 1) throw invalid();
  payload = capturedPayload(payload, scope);
  payload = canonical(payload);
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, 'utf8') > XERO_PREVIEW_CHECKPOINT_MAX_BYTES) {
    throw failure('XERO_PREVIEW_CHECKPOINT_TOO_LARGE', 'The complete preview evidence exceeds the checkpoint storage limit.', 413);
  }
  const { manifest, parts } = partitionPreviewCheckpoint(payload);
  for (let index = 0; index < parts.length; index += 2) await rpc(client, 'xero_preview_checkpoint_save_chunks_v2', {
    p_id: id, p_expected_revision: revision, p_scope: scope, p_chunks: parts.slice(index, index + 2),
  });
  const summary = { complete: true, tenantId: scope.tenantId, includePayments: scope.inputOptions.includePayments,
    snapshotStartedAt: payload.snapshotStartedAt, providerKeys: Object.keys(payload.provider).sort() };
  const row = verified(await rpc(client, 'xero_preview_checkpoint_finalize_v2', {
    p_id: id, p_expected_revision: revision, p_scope: scope, p_manifest: manifest, p_summary: summary,
    p_payload_hash: previewEvidenceHash(payload),
  }), scope, { id, state: 'captured', revision: revision + 1 });
  if (previewEvidenceHash(row.payload) !== previewEvidenceHash({ storageVersion: 2, manifest, summary })) throw invalid();
  return { ...row, payload };
}

export async function loadPreviewCheckpoint(client, scope, { id = null } = {}) {
  scope = previewCheckpointScope(scope);
  if (id !== null && !UUID.test(id)) throw invalid();
  const row = await rpc(client, 'xero_preview_checkpoint_load_v2', { p_scope: scope, p_id: id, p_run_id: null });
  return row == null ? null : hydrateCheckpoint(client, verified(row, scope, { ...(id ? { id } : {}), state: 'captured' }), scope);
}

async function hydrateCheckpoint(client, row, scope, runId = null) {
  if (row.payload?.storageVersion !== 2 || !row.payload.manifest || !row.payload.summary) throw invalid();
  const parts = [];
  let after = -1;
  for (;;) {
    const page = await rpc(client, 'xero_preview_checkpoint_read_chunks_v2', {
      p_id: row.id, p_scope: scope, p_after_ordinal: after, p_run_id: runId,
    });
    if (!page || !Array.isArray(page.chunks) || page.chunks.length > 2 || typeof page.hasMore !== 'boolean'
      || (page.hasMore && !page.chunks.length)) throw invalid();
    for (const part of page.chunks) {
      if (part.ordinal !== parts.length || parts.length >= MAX_CHUNKS) throw invalid();
      parts.push(part); after = part.ordinal;
    }
    if (!page.hasMore) break;
  }
  if (parts.reduce((total, part) => total + Buffer.byteLength(part.payloadText || '', 'utf8'), 0) > XERO_PREVIEW_CHECKPOINT_MAX_BYTES) throw invalid();
  const payload = capturedPayload(reconstructPreviewCheckpoint(row.payload.manifest, parts), scope);
  if (previewEvidenceHash(payload) !== row.payload_hash) throw failure('XERO_PREVIEW_CHECKPOINT_CORRUPT', 'The captured preview evidence could not be verified.');
  return { ...row, payload };
}

export function previewCheckpointReference(row) {
  return { checkpointId: row.id, revision: row.state === 'published' ? row.revision - 1 : row.revision,
    actorId: row.actor_id, tenantId: row.tenant_id, salesforceOrgId: row.salesforce_org_id,
    reconciliationVersion: row.reconciliation_version, inputOptions: row.input_options,
    inputEvidenceHash: row.input_evidence_hash, payloadHash: row.payload_hash, storageHash: row.storage_hash,
    tokenVersion: row.token_version, capturedAt: row.captured_at, storageVersion: 2 };
}

export async function loadPublishedPreviewCheckpoint(client, reference, { runId, actorId, tenantId } = {}) {
  if (!reference || !UUID.test(runId || '') || reference.actorId !== actorId || reference.tenantId !== tenantId
    || reference.storageVersion !== 2 || !UUID.test(reference.checkpointId || '')) throw invalid();
  const scope = previewCheckpointScope(reference);
  const row = verified(await rpc(client, 'xero_preview_checkpoint_load_v2', {
    p_scope: scope, p_id: reference.checkpointId, p_run_id: runId,
  }), scope, { id: reference.checkpointId, state: 'published', durable: true });
  if (row.published_run_id !== runId || previewEvidenceHash(previewCheckpointReference(row)) !== previewEvidenceHash(reference)) throw invalid();
  return hydrateCheckpoint(client, row, scope, runId);
}

export async function markPreviewCheckpointPublished(client, { id, revision, scope, runId }) {
  scope = previewCheckpointScope(scope);
  if (!UUID.test(id || '') || !UUID.test(runId || '') || !Number.isSafeInteger(revision) || revision < 1) throw invalid();
  const row = verified(await rpc(client, 'xero_preview_checkpoint_publish_v2', {
    p_id: id, p_expected_revision: revision, p_scope: scope, p_run_id: runId,
  }), scope, { id, state: 'published', revision: revision + 1 });
  if (row.published_run_id !== runId) throw failure('XERO_PREVIEW_CHECKPOINT_CORRUPT', 'The published preview checkpoint could not be verified.');
  return row;
}
