import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPreviewCheckpoint, loadPreviewCheckpoint, markPreviewCheckpointPublished,
  previewCheckpointScope, savePreviewCheckpoint } from '../api/_xeroPreviewCheckpoint.js';
import { previewEvidenceHash } from '../api/_xeroPreviewPersistence.js';

function fixture() {
  const scope = { actorId: randomUUID(), tenantId: randomUUID(), salesforceOrgId: 'test-org', reconciliationVersion: 18,
    inputEvidenceHash: previewEvidenceHash({ source: 'complete', controls: [] }),
    inputOptions: { linkFirst: true, includePayments: true, recordExactMatches: false,
      cutoffDate: '2026-01-01', postingMode: 'draft', campaignId: null } };
  const payload = { complete: true, provider: { xero: { tenantId: scope.tenantId, documents: [{ id: randomUUID(), total: 42 }], organisation: { baseCurrency: 'USD' } },
    accountResponse: { Accounts: [] }, taxResponse: { TaxRates: [] }, allMappings: { data: [] }, payments: { tenantId: scope.tenantId, rows: [] } },
    automaticMappingPolicy: { changedCount: 0 }, snapshotStartedAt: '2026-09-29T19:00:00.000Z', callForecast: { callsNeeded: 50 }, rate: { dayRemaining: 869 } };
  const row = { id: randomUUID(), actor_id: scope.actorId, tenant_id: scope.tenantId, salesforce_org_id: scope.salesforceOrgId,
    reconciliation_version: scope.reconciliationVersion, input_evidence_hash: scope.inputEvidenceHash,
    input_options: scope.inputOptions, token_version: 1, revision: 1, state: 'capturing', expires_at: '2099-01-01T00:00:00Z' };
  return { scope, payload, row };
}

test('checkpoint methods carry exact scope and CAS and verify captured canonical evidence', async () => {
  const { scope, payload, row } = fixture(); const calls = []; const runId = randomUUID();
  const client = { async rpc(name, parameters) {
    calls.push({ name, parameters });
    if (name.endsWith('save_v1')) Object.assign(row, { state: 'captured', revision: 2,
      payload: JSON.parse(parameters.p_payload), payload_hash: parameters.p_payload_hash });
    if (name.endsWith('publish_v1')) Object.assign(row, { state: 'published', revision: 3, published_run_id: parameters.p_run_id });
    return { data: structuredClone(row), error: null };
  } };
  const created = await createPreviewCheckpoint(client, { ...scope, tokenVersion: 999 }, { id: row.id });
  const saved = await savePreviewCheckpoint(client, { id: created.id, revision: created.revision, scope, payload });
  const loaded = await loadPreviewCheckpoint(client, scope);
  assert.deepEqual(loaded.payload, payload); assert.equal(saved.payload_hash, previewEvidenceHash(payload));
  await markPreviewCheckpointPublished(client, { id: saved.id, revision: saved.revision, scope, runId });
  assert.equal(calls[0].parameters.p_ttl_seconds, 900);
  assert.deepEqual(calls[0].parameters.p_scope, scope); // Rotation never changes logical scope.
  assert.equal(calls[1].parameters.p_expected_revision, 1); assert.equal(calls[3].parameters.p_expected_revision, 2);
});

test('load miss is null; a returned changed payload or foreign scope is rejected', async () => {
  const { scope, payload, row } = fixture();
  assert.equal(await loadPreviewCheckpoint({ rpc: async () => ({ data: null }) }, scope), null);
  Object.assign(row, { state: 'captured', revision: 2, payload, payload_hash: previewEvidenceHash(payload) });
  for (const mutate of [value => { value.payload.provider.xero.documents[0].total = 99; },
    value => { value.actor_id = randomUUID(); }, value => { value.tenant_id = randomUUID(); },
    value => { value.input_options.includePayments = false; }, value => { value.reconciliation_version += 1; },
    value => { value.input_evidence_hash = 'b'.repeat(64); }]) {
    const changed = structuredClone(row); mutate(changed);
    await assert.rejects(loadPreviewCheckpoint({ rpc: async () => ({ data: changed }) }, scope), { code: 'XERO_PREVIEW_CHECKPOINT_CORRUPT' });
  }
});

test('credential material and incomplete capture are rejected before any RPC', async () => {
  const { scope, payload, row } = fixture(); let calls = 0; const client = { rpc: async () => { calls += 1; } };
  for (const key of ['access_token', 'refreshToken', 'Authorization', 'clientSecret', 'actorAuth']) {
    const value = structuredClone(payload); value.provider.xero.records = [{ [key]: 'private-fixture' }];
    await assert.rejects(savePreviewCheckpoint(client, { id: row.id, revision: 1, scope, payload: value }), { code: 'XERO_PREVIEW_CHECKPOINT_SECRET' });
  }
  await assert.rejects(savePreviewCheckpoint(client, { id: row.id, revision: 1, scope, payload: { ...payload, env: {} } }), { code: 'XERO_PREVIEW_CHECKPOINT_SECRET' });
  for (const value of [{ ...payload, complete: false }, { ...payload, provider: {} }]) {
    await assert.rejects(savePreviewCheckpoint(client, { id: row.id, revision: 1, scope, payload: value }), { code: 'XERO_PREVIEW_CHECKPOINT_INVALID' });
  }
  const foreignPayments = structuredClone(payload); foreignPayments.provider.payments.tenantId = randomUUID();
  await assert.rejects(savePreviewCheckpoint(client, { id: row.id, revision: 1, scope, payload: foreignPayments }), { code: 'XERO_PREVIEW_CHECKPOINT_INVALID' });
  const foreignXero = structuredClone(payload); foreignXero.provider.xero.tenantId = randomUUID();
  await assert.rejects(savePreviewCheckpoint(client, { id: row.id, revision: 1, scope, payload: foreignXero }), { code: 'XERO_PREVIEW_CHECKPOINT_INVALID' });
  assert.equal(calls, 0);
});

test('invalid identity, options, revision and TTL fail before storage', async () => {
  const { scope, payload, row } = fixture(); const client = { rpc: () => { throw new Error('Must not call'); } };
  for (const change of [{ actorId: 'foreign' }, { tenantId: '' }, { inputEvidenceHash: 'incomplete' }, { reconciliationVersion: 0 },
    { inputOptions: { ...scope.inputOptions, linkFirst: false } }, { inputOptions: { ...scope.inputOptions, recordExactMatches: true } },
    { inputOptions: { ...scope.inputOptions, postingMode: 'DRAFT' } },
    { inputOptions: { ...scope.inputOptions, cutoffDate: '2026-02-30' } }]) assert.throws(() => previewCheckpointScope({ ...scope, ...change }));
  for (const ttlSeconds of [0, 3601, 1.5]) await assert.rejects(createPreviewCheckpoint(client, scope, { ttlSeconds }), { code: 'XERO_PREVIEW_CHECKPOINT_INVALID' });
  await assert.rejects(savePreviewCheckpoint(client, { id: row.id, revision: 0, scope, payload }), { code: 'XERO_PREVIEW_CHECKPOINT_INVALID' });
});

test('explicit expiry, connection and CAS failures stay clear; transport never silently succeeds', async () => {
  const { scope } = fixture();
  for (const suffix of ['EXPIRED', 'STALE', 'CONNECTION_CHANGED', 'ACCESS_REQUIRED']) {
    await assert.rejects(loadPreviewCheckpoint({ rpc: async () => ({ error: { message: `XERO_PREVIEW_CHECKPOINT_${suffix}` } }) }, scope),
      { code: `XERO_PREVIEW_CHECKPOINT_${suffix}` });
  }
  await assert.rejects(loadPreviewCheckpoint({ rpc: async () => { throw new TypeError('private transport detail'); } }, scope),
    { code: 'XERO_PREVIEW_CHECKPOINT_STORAGE_FAILED' });
});
