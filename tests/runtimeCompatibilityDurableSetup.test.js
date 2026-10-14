import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { DURABLE_SETUP_MODE, DURABLE_SETUP_CONTRACT_SHA256, durableSuccessorSetupDeadline,
  assertDurableSetupMetadata, assertDurableSetupRecordReadback } from '../scripts/lib/runtime-compatibility-setup.mjs';
import { SUCCESSOR_LIVE_CONTRACT as policy, assertSuccessorLiveMaterials } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { collectRuntimeSuccessorMaterials, runtimeMaterialMode, assertRuntimeMaterialPublicationFresh } from '../scripts/lib/runtime-compatibility-material-transport.mjs';
import { materialTransportFixture } from './helpers/runtimeMaterialTransport.mjs';
const now = Date.parse('2026-10-15T02:00:00.000Z'), iso = t => new Date(t).toISOString();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => { const body = Buffer.from(JSON.stringify(value) + '\n'); return { body, value, sha256: hash(body) }; };
function fixture() {
  const provisioned = now - 13 * 3600000;
  const binding = { sha: policy.candidateSha, sourceDigest: policy.sourceDigest, lockHash: policy.lockHash, candidateTreeHash: policy.candidateTreeHash,
    harnessSha: '1'.repeat(40), previewControlRevision: '2'.repeat(64), configurationRevision: '3'.repeat(64), runId: 99 };
  const value = { schemaVersion: 2, kind: 'fcos_exact_04ee_setup_context', contractSha256: DURABLE_SETUP_CONTRACT_SHA256,
    candidateSha: policy.candidateSha, branch: policy.branch, sourceDigest: policy.sourceDigest, lockHash: policy.lockHash,
    candidateGitTree: policy.candidateGitTree, candidateTreeHash: policy.candidateTreeHash,
    previewControlRevision: binding.previewControlRevision, configurationRevision: binding.configurationRevision,
    provisionedAt: iso(provisioned), setupExpiresAt: iso(provisioned + 86400000), cleanupDeadline: iso(provisioned + 86400000),
    attachmentOperationId: '11111111-1111-4111-8111-111111111111', records: { tenantRecordId: 'TENANT', clientRecordId: 'CLIENT', attachmentRecordId: 'ATTACHMENT' },
    operation: { id: '22222222-2222-4222-8222-222222222222', phase: 'prepared' }, recordMetadata: {} };
  for (const [field, key] of Object.entries({ tenantRecordId: 'FCOS_MICROSOFT_TENANT_ID', clientRecordId: 'FCOS_MICROSOFT_CLIENT_ID', attachmentRecordId: 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET' })) {
    value.recordMetadata[field] = { id: value.records[field], key, type: field === 'attachmentRecordId' ? 'sensitive' : 'plain', target: ['preview'], gitBranch: value.branch,
      createdAt: provisioned - 2000, updatedAt: provisioned - 1000,
      comment: field === 'attachmentRecordId' ? `Dedicated read-only Preview signing key ${value.attachmentOperationId}; no Production credential copied` : null };
  }
  const context = record(value), reviews = ['root', 'independent'].map(role => record({ schemaVersion: 2, kind: 'fcos_exact_04ee_setup_material_review',
    role, reviewer: role === 'root' ? '/root' : '/root/reviewer', disposition: 'accepted', contextSha256: context.sha256,
    candidateSha: value.candidateSha, sourceDigest: value.sourceDigest, lockHash: value.lockHash,
    previewControlRevision: value.previewControlRevision, configurationRevision: value.configurationRevision, reviewedAt: iso(provisioned + 1000) }));
  const snapshot = { capturedAt: iso(now), complete: true, projectId: fcosConnectionIdentifier('vercel', 'Project ID'), teamId: fcosConnectionIdentifier('vercel', 'Team ID'), records: Object.values(value.recordMetadata) };
  return { binding, context, reviews, rows: { context, root: reviews[0], independent: reviews[1] }, snapshot };
}
test('twelve-hour review wait reuses unchanged original setup across all protected routes with a fresh job and immutable run artifact', async () => {
  const f = fixture(), original = JSON.stringify(f.rows), packs = [];
  for (const [index, workflow] of ['preview-email-proof-build.yml', 'runtime-compatibility-normal-role.yml', 'runtime-compatibility-release.yml'].entries()) {
    const binding = { ...f.binding, runId: 99 + index }, t = materialTransportFixture({ expected: binding, rows: f.rows, now,
      workflow: '.github/workflows/' + workflow, dispatchedAt: iso(now - 12 * 3600000) });
    const result = await collectRuntimeSuccessorMaterials({ reads: t.reads, expected: binding, run: t.run, now });
    assert.equal(result.materialMode, DURABLE_SETUP_MODE); assert.equal(result.transport.jobStartedAt, t.jobs[0].started_at);
    assert.equal(assertSuccessorLiveMaterials({ context: result.rows.context, reviews: [result.rows.root, result.rows.independent], binding, now }), true);
    packs.push(t.payload.materialPackText); assert.equal(t.payload.binding.runId, binding.runId);
    assert.equal(Object.hasOwn(t.pack.binding, 'environmentId'), false); assert.equal(Object.hasOwn(t.pack.binding, 'runId'), false);
    assert.equal(JSON.stringify(f.rows), original);
    const producer = { binding: t.payload.binding, materialMode: DURABLE_SETUP_MODE, dispatchedAt: t.run.run_started_at,
      job: t.jobs[0], step: t.jobs[0].steps[0], oidcExpiresAt: t.oidcClaims.exp * 1000 };
    assert.equal(assertRuntimeMaterialPublicationFresh({ producer, payload: t.payload, now }), t.oidcClaims.exp * 1000);
  }
  assert.equal(new Set(packs).size, 1);
});
test('setup lifetime never moves with publication/readback and cannot exceed original cleanup or24h', () => {
  const { context, snapshot } = fixture(), c = context.value, original = JSON.stringify(c);
  assert.equal(assertDurableSetupRecordReadback(c, snapshot, now), true);
  assert.equal(durableSuccessorSetupDeadline(c, now), Date.parse(c.cleanupDeadline)); assert.equal(JSON.stringify(c), original);
  for (const alter of [c => { c.setupExpiresAt = iso(Date.parse(c.cleanupDeadline) + 1); }, c => { c.setupExpiresAt = iso(now); },
    c => { c.provisionedAt = iso(now + 1); }, c => { c.cleanupDeadline = iso(now - 1); }, c => { c.contractSha256 = '0'.repeat(64); }]) {
    const changed = structuredClone(c); alter(changed); assert.throws(() => durableSuccessorSetupDeadline(changed, now));
  }
  assert.throws(() => assertDurableSetupRecordReadback(c, { ...snapshot, capturedAt: iso(now - 600001) }, now));
});
test('exact metadata readback rejects changed values before any caller can create an intent', () => {
  const { context, snapshot } = fixture(); assert.equal(assertDurableSetupMetadata(context.value, now), true);
  for (const alter of [r => { r.id += 'LATE'; }, r => { r.type = 'encrypted'; }, r => { r.target.push('production'); },
    r => { r.gitBranch = 'main'; }, r => { r.updatedAt++; }, r => { r.comment = 'changed'; }]) {
    const changed = structuredClone(snapshot); alter(changed.records[2]); assert.throws(() => assertDurableSetupRecordReadback(context.value, changed, now));
  }
  assert.throws(() => assertDurableSetupRecordReadback(context.value, { ...snapshot, records: [...snapshot.records, snapshot.records[0]] }, now));
  assert.throws(() => assertDurableSetupRecordReadback(context.value, { ...snapshot, complete: false }, now));
  assert.throws(() => assertDurableSetupRecordReadback(context.value, { ...snapshot, projectId: 'OTHER' }, now));
  assert.throws(() => assertDurableSetupRecordReadback(context.value, { ...snapshot, teamId: 'OTHER' }, now));
});
test('explicit mode, original review and current producer identity remain mandatory', async () => {
  const f = fixture();
  for (const alter of [t => { t.variables[0].value = 'run-artifact-v1'; }, t => { t.jobs[0].started_at = iso(now - 1800001); },
    t => { t.run.run_attempt = 2; }, t => { t.approvals = []; }, t => { t.environment.id++; }, t => { t.run.head_sha = 'f'.repeat(40); }]) {
    const t = materialTransportFixture({ expected: f.binding, rows: f.rows, now, dispatchedAt: iso(now - 12 * 3600000) }); alter(t);
    await assert.rejects(() => collectRuntimeSuccessorMaterials({ reads: t.reads, expected: f.binding, run: t.run, now }));
  }
  assert.throws(() => runtimeMaterialMode('{"schemaVersion":2,"kind":"fcos_exact04ee_runtime_material_pack"}'));
  const badReview = record({ ...f.reviews[1].value, schemaVersion: 1 });
  assert.throws(() => assertSuccessorLiveMaterials({ ...f, reviews: [f.reviews[0], badReview], now }));
});
