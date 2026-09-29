import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { previewEvidenceHash } from './_xeroPreviewPersistence.js';

export const XERO_PREVIEW_CHECKPOINT_VERSION = 1;
export const XERO_PREVIEW_CHECKPOINT_TTL_SECONDS = 900;
export const XERO_PREVIEW_CHECKPOINT_MAX_BYTES = 100 * 1024 * 1024;
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
  const check = entry => {
    if (Array.isArray(entry)) return entry.forEach(check);
    if (entry && typeof entry === 'object') for (const [key, child] of Object.entries(entry)) {
      if (SECRET_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        throw failure('XERO_PREVIEW_CHECKPOINT_SECRET', 'Credential material cannot be captured in a preview checkpoint.', 400);
      }
      check(child);
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
  try { result = await client.rpc(name, parameters); } catch {
    throw failure('XERO_PREVIEW_CHECKPOINT_STORAGE_FAILED', 'The preview checkpoint could not be saved or loaded.', 503);
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

function verified(row, scope, { state, id, revision } = {}) {
  if (!row || !UUID.test(row.id || '') || (id && row.id !== id) || !Number.isSafeInteger(row.revision)
    || row.revision < 1 || (revision && row.revision !== revision) || (state && row.state !== state)
    || !['capturing', 'captured', 'published'].includes(row.state)
    || row.actor_id !== scope.actorId || row.tenant_id !== scope.tenantId
    || row.salesforce_org_id !== scope.salesforceOrgId || row.reconciliation_version !== scope.reconciliationVersion
    || row.input_evidence_hash !== scope.inputEvidenceHash
    || previewEvidenceHash(row.input_options) !== previewEvidenceHash(scope.inputOptions)
    || !Number.isFinite(Date.parse(row.expires_at))) throw failure('XERO_PREVIEW_CHECKPOINT_CORRUPT', 'The saved preview checkpoint could not be verified.');
  if (Date.parse(row.expires_at) <= Date.now()) throw failure('XERO_PREVIEW_CHECKPOINT_EXPIRED', 'The preview checkpoint expired. Run a new check.');
  if (row.state !== 'capturing' && (!DIGEST.test(row.payload_hash || '')
    || previewEvidenceHash(capturedPayload(row.payload, scope)) !== row.payload_hash)) {
    throw failure('XERO_PREVIEW_CHECKPOINT_CORRUPT', 'The captured preview evidence could not be verified.');
  }
  return row;
}

export async function createPreviewCheckpoint(client, scope, { id = randomUUID(), ttlSeconds = XERO_PREVIEW_CHECKPOINT_TTL_SECONDS } = {}) {
  scope = previewCheckpointScope(scope);
  if (!UUID.test(id) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) throw invalid();
  return verified(await rpc(client, 'xero_preview_checkpoint_create_v1', { p_id: id, p_scope: scope, p_ttl_seconds: ttlSeconds }), scope, { id });
}

export async function savePreviewCheckpoint(client, { id, revision, scope, payload }) {
  scope = previewCheckpointScope(scope);
  if (!UUID.test(id || '') || !Number.isSafeInteger(revision) || revision < 1) throw invalid();
  payload = capturedPayload(payload, scope);
  const text = JSON.stringify(canonical(payload));
  if (Buffer.byteLength(text, 'utf8') > XERO_PREVIEW_CHECKPOINT_MAX_BYTES) {
    throw failure('XERO_PREVIEW_CHECKPOINT_TOO_LARGE', 'The complete preview evidence exceeds the checkpoint storage limit.', 413);
  }
  return verified(await rpc(client, 'xero_preview_checkpoint_save_v1', {
    p_id: id, p_expected_revision: revision, p_scope: scope,
    p_payload: text, p_payload_hash: previewEvidenceHash(payload),
  }), scope, { id, state: 'captured', revision: revision + 1 });
}

export async function loadPreviewCheckpoint(client, scope, { id = null } = {}) {
  scope = previewCheckpointScope(scope);
  if (id !== null && !UUID.test(id)) throw invalid();
  const row = await rpc(client, 'xero_preview_checkpoint_load_v1', { p_scope: scope, p_id: id });
  return row == null ? null : verified(row, scope, { ...(id ? { id } : {}), state: 'captured' });
}

export async function markPreviewCheckpointPublished(client, { id, revision, scope, runId }) {
  scope = previewCheckpointScope(scope);
  if (!UUID.test(id || '') || !UUID.test(runId || '') || !Number.isSafeInteger(revision) || revision < 1) throw invalid();
  const row = verified(await rpc(client, 'xero_preview_checkpoint_publish_v1', {
    p_id: id, p_expected_revision: revision, p_scope: scope, p_run_id: runId,
  }), scope, { id, state: 'published', revision: revision + 1 });
  if (row.published_run_id !== runId) throw failure('XERO_PREVIEW_CHECKPOINT_CORRUPT', 'The published preview checkpoint could not be verified.');
  return row;
}
