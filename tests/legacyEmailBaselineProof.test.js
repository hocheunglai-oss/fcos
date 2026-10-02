import assert from 'node:assert/strict';
import test from 'node:test';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { assertLegacyEmailBaselineProof, LEGACY_EMAIL_BASELINE_CONTRACT, legacyEmailUnknownAllowed } from '../scripts/lib/legacy-email-baseline-proof.mjs';
import { collectPreviewEmailEnvironmentRecords, createPreviewEmailBuildIntent } from '../scripts/lib/preview-email-build.mjs';
import { PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID, previewEmailSignerSourceHashes } from '../scripts/lib/preview-email-signer.mjs';
import { PREVIEW_PARITY_POLICY, evaluatePreviewParity } from '../scripts/lib/preview-parity.mjs';

const now = 1_790_001_000_000;
const contract = LEGACY_EMAIL_BASELINE_CONTRACT;
const pin = contract.preview.candidates[0];
const harnessSha = 'b'.repeat(40);
const archiveDigest = 'c'.repeat(64);
const operationId = 'fcos-preview-email-99-12345678-1234-4123-8123-123456789abc';
const deployment = {
  id: 'dpl_candidate', url: 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app', sha: pin.sha,
  target: 'preview', state: 'READY', createdAt: now - 8_000,
  projectId: fcosConnectionIdentifier('vercel', 'Project ID'), teamId: fcosConnectionIdentifier('vercel', 'Team ID'), operationId,
};
const production = {
  id: contract.baseline.deploymentId, sha: contract.baseline.sha, url: contract.baseline.url,
  target: 'production', state: 'READY', createdAt: now - 1_000,
};
const iso = value => new Date(value).toISOString();
const copy = value => structuredClone(value);

function environmentRecords() {
  const rows = Object.entries(contract.baseline.records).map(([key, row]) => ({
    id: row.id, key, type: 'sensitive', target: ['production'], gitBranch: null,
    createdAt: row.createdAt, updatedAt: row.updatedAt, comment: null,
  }));
  rows.push(
    { id: pin.tenantRecordId, key: 'FCOS_MICROSOFT_TENANT_ID', type: 'plain', target: ['preview'], gitBranch: pin.branch,
      createdAt: now - 16_000, updatedAt: now - 15_000, comment: null },
    { id: pin.clientRecordId, key: 'FCOS_MICROSOFT_CLIENT_ID', type: 'plain', target: ['preview'], gitBranch: pin.branch,
      createdAt: now - 16_000, updatedAt: now - 15_000, comment: null },
    { id: pin.attachmentRecordId, key: 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET', type: 'sensitive', target: ['preview'], gitBranch: pin.branch,
      createdAt: now - 16_000, updatedAt: now - 15_000,
      comment: `Dedicated read-only Preview signing key ${contract.preview.attachmentOperationId}; no Production credential copied` },
  );
  return { capturedAt: iso(now - 500), projectId: deployment.projectId, teamId: deployment.teamId, complete: true, records: rows };
}

function fixture() {
  const candidate = copy(deployment);
  const baseline = copy(production);
  const records = environmentRecords();
  const intent = createPreviewEmailBuildIntent({ candidateSha: pin.sha, harnessSha, controlRevision: 'a'.repeat(64), runId: 99,
    operationId, records, now: now - 10_000 });
  const receipt = { ...intent, kind: 'fcos_preview_email_build', capturedAt: iso(now - 7_000), deployment: candidate };
  const signer = {
    schemaVersion: 1, kind: 'fcos_preview_email_signer', probe: 'synthetic_attachment_link_v1', capturedAt: iso(now - 7_500),
    deploymentId: candidate.id, sha: pin.sha, sourceDigest: pin.sourceDigest, mailboxRegistryId: PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID,
    result: 'pass', noAttachmentFetch: true, sourceHashes: previewEmailSignerSourceHashes(pin.sha),
  };
  const normal = { kind: 'normal_role', sha: pin.sha, deploymentId: candidate.id, sourceDigest: pin.sourceDigest, harnessSha,
    archiveDigest, runId: 123, artifactId: 124, capturedAt: iso(now - 6_000), emailSigner: signer };
  const proof = { schemaVersion: 1, contractId: contract.id, capturedAt: iso(now - 4_000), records,
    build: { receipt, trust: { runId: 99, artifactId: 100, harnessSha, archiveDigest, capturedAt: iso(now - 6_000) } }, signer };
  return { proof, normal, candidate, production: baseline, records };
}

function assertProof(value = fixture()) {
  return assertLegacyEmailBaselineProof({ proof: value.proof, production: value.production, candidate: value.candidate,
    sourceDigest: pin.sourceDigest, normal: value.normal, now });
}

function observations(value = fixture()) {
  const keys = {
    FCOS_MICROSOFT_TENANT_ID: { state: 'known', value: contract.preview.tenantId },
    FCOS_MICROSOFT_CLIENT_ID: { state: 'known', value: contract.preview.clientId },
    FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET: { state: 'unknown', present: true },
  };
  return { production: { deployment: value.production, env: { keys: Object.fromEntries(contract.historicalKeys.map(key => [key, { state: 'unknown', present: true }])) } },
    candidate: { deployment: value.candidate, env: { keys } }, source: { hashes: { application: pin.sourceDigest } },
    legacyEmailBaseline: value.proof, legacyEmailNormal: value.normal };
}

test('the retained exception requires the exact baseline, immutable candidate, normal workflow and signer proof', () => {
  const value = fixture();
  assert.equal(assertProof(value), true);
  assert.equal(legacyEmailUnknownAllowed('FCOS_MICROSOFT_TENANT_ID', observations(value), now), true);
  for (const alter of [
    item => { item.production.id = 'dpl_other'; },
    item => { item.candidate.sha = '0'.repeat(40); },
    item => { item.candidate.target = 'production'; },
    item => { item.normal.kind = 'ci'; },
    item => { item.normal.deploymentId = 'dpl_other'; },
    item => { item.normal.runId = 0; },
    item => { item.normal.artifactId = 0; },
    item => { item.proof.signer = { ...item.proof.signer, sourceHashes: {} }; },
    item => { item.proof.build = { receipt: {}, trust: {} }; },
    item => { item.proof.extraException = true; },
  ]) {
    const changed = fixture(); alter(changed);
    assert.throws(() => assertProof(changed));
  }
});

test('record metadata is exact about IDs, types, targets, branches, times and complete pagination', async () => {
  for (const alter of [
    row => { row.id = 'other-record'; }, row => { row.type = 'encrypted'; }, row => { row.target = ['preview', 'production']; },
    row => { row.gitBranch = 'other-branch'; }, row => { row.updatedAt = now; }, row => { row.comment = 'other comment'; },
  ]) {
    const changed = fixture(); alter(changed.proof.records.records.find(row => row.key === 'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET' && row.target[0] === 'preview'));
    assert.throws(() => assertProof(changed));
  }
  const api = async () => ({ envs: environmentRecords().records, projectId: deployment.projectId, teamId: deployment.teamId,
    pagination: { count: environmentRecords().records.length, next: null, prev: null } });
  assert.deepEqual(await collectPreviewEmailEnvironmentRecords({ api, now }), { ...environmentRecords(), capturedAt: iso(now), records: environmentRecords().records.sort((a, b) => String(a.id).localeCompare(String(b.id))) });
  for (const response of [
    { envs: [], truncated: true }, { envs: [], hasMore: true, pagination: { count: 0, next: null, prev: null } },
    { envs: [], pagination: { count: 0, next: 'bad', prev: null } },
    { envs: [{ ...environmentRecords().records[0], customEnvironmentIds: ['custom'] }], pagination: { count: 1, next: null, prev: null } },
  ]) await assert.rejects(() => collectPreviewEmailEnvironmentRecords({ api: async () => response, now }));
});

test('unknown-value acceptance does not permit absent, wrong, stale or custom policy inputs', () => {
  const base = observations();
  const secret = 'private-email-value';
  for (const [key, alter] of [
    ['FCOS_MICROSOFT_TENANT_ID', item => { item.production.env.keys.FCOS_MICROSOFT_TENANT_ID = { state: 'absent' }; }],
    ['FCOS_MICROSOFT_TENANT_ID', item => { item.candidate.env.keys.FCOS_MICROSOFT_TENANT_ID = { state: 'absent' }; }],
    ['FCOS_MICROSOFT_TENANT_ID', item => { item.candidate.env.keys.FCOS_MICROSOFT_TENANT_ID = { state: 'unknown', present: true }; }],
    ['FCOS_MICROSOFT_TENANT_ID', item => { item.candidate.env.keys.FCOS_MICROSOFT_TENANT_ID = { state: 'known', value: 'wrong' }; }],
    ['FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET', item => { item.candidate.env.keys.FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET = { state: 'known', value: secret }; }],
    ['FCOS_MICROSOFT_TENANT_ID', item => { item.legacyEmailBaseline = { ...item.legacyEmailBaseline, capturedAt: iso(now - 30 * 60_001) }; }],
  ]) {
    const changed = copy(base); alter(changed);
    assert.equal(legacyEmailUnknownAllowed(key, changed, now), false);
    assert.doesNotMatch(JSON.stringify(changed.legacyEmailBaseline), /private-email-value/);
  }
  assert.equal(legacyEmailUnknownAllowed('FCOS_OTHER_SECRET', base, now), false);
  const redacted = fixture(); redacted.proof.records.records[0].id = secret;
  assert.throws(() => assertProof(redacted), error => !error.message.includes(secret));
  const policy = structuredClone(PREVIEW_PARITY_POLICY); policy.legacyEmailBaselineProof = 'custom-exception';
  const result = evaluatePreviewParity({ schemaVersion: 1 }, { expectedCommit: pin.sha, sourceHashes: {}, policy, now });
  assert.ok(result.blockers.some(row => row.code === 'POLICY_SCOPE_WEAKENED'));
});
