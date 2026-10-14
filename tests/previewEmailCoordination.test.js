import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SUCCESSOR_LIVE_CONTRACT as candidate } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { DURABLE_SETUP_MODE, DURABLE_SETUP_CONTRACT_SHA256, isDurableSuccessorSetup,
  durableSuccessorSetupDeadline } from '../scripts/lib/runtime-compatibility-setup.mjs';
import { PREVIEW_COORDINATION_CANONICAL, coordinationHash, coordinationLeaseBinding, coordinationDeadline,
  coordinationGrantData, coordinationGrantMessage, verifyCoordinationGrantData, normalizeCoordinationEnvelope,
  validateCoordinationBinding, coordinationBindingFromOriginal, coordinationFailure } from '../scripts/lib/preview-email-coordination.mjs';

// Ephemeral signatures and inert identity gates test data/control flow only.
// They cannot enter genuine provider, canonical lease or private authority maps.
const now = Date.parse('2026-10-15T07:00:00.000Z'), iso = time => new Date(time).toISOString();
const keys = generateKeyPairSync('ed25519');
const publicKeySpkiBase64 = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
function binding() {
  return { repositoryId: 1278654816, environmentId: 123, runId: 37882841010, runAttempt: 1,
    workflow: '.github/workflows/preview-email-proof-build.yml', dispatchedAt: iso(now - 4 * 3600000),
    jobId: 113666224339, jobStartedAt: iso(now - 20000), intentArtifactId: 11597460091,
    intentArchiveSha256: 'a'.repeat(64), intentSha256: 'b'.repeat(64),
    operationId: 'fcos-preview-email-37882841010-11111111-1111-4111-8111-111111111111',
    requestSha256: 'c'.repeat(64), candidateSha: candidate.candidateSha,
    sourceDigest: candidate.sourceDigest, lockHash: candidate.lockHash,
    candidateGitTree: candidate.candidateGitTree, candidateTreeHash: candidate.candidateTreeHash,
    harnessSha: 'd'.repeat(40), controlRevision: 'e'.repeat(64), configurationRevision: 'f'.repeat(64),
    contractSha256: '1'.repeat(64), materialHashes: { context: '2'.repeat(64), root: '3'.repeat(64), independent: '4'.repeat(64) },
    reviewedAt: { root: iso(now - 5 * 3600000 + 1000), independent: iso(now - 5 * 3600000 + 2000) },
    provisionedAt: iso(now - 5 * 3600000), intentAt: iso(now - 10000),
    issuanceEnvelopeSha256: '5'.repeat(64), issuanceObservedAt: now - 5000, issuanceExpiresAt: now + 595000,
    schemaVersion: 2, setupContractSha256: DURABLE_SETUP_CONTRACT_SHA256, setupExpiresAt: now + 3600000 };
}
function lease(b) {
  return { epoch: PREVIEW_COORDINATION_CANONICAL.epoch, objective: 'production',
    ownerThreadId: PREVIEW_COORDINATION_CANONICAL.ownerThreadId, operationId: b.operationId,
    bindingSha256: coordinationLeaseBinding(b), leaseId: '22222222-2222-4222-8222-222222222222',
    coordinationOnly: true, providerAuthorityGranted: false, uncertainOutcomeRequiresReadback: true };
}
function grant(b = binding(), overrides = {}) {
  return coordinationGrantData({ binding: b, lease: lease(b), consumptionSha256: '6'.repeat(64),
    actionSha256: '7'.repeat(64), backendReviewSha256: '8'.repeat(64), backendClosureSha256: '9'.repeat(64),
    authorizedAt: now - 3000, privateReadinessAt: now - 4000, issuedAt: now, expiresAt: now + 100000, ...overrides });
}
function envelope(g) {
  return JSON.stringify({ grant: g, signature: sign(null, coordinationGrantMessage(g), keys.privateKey).toString('base64url') });
}
test('durable coordination permits hours of original setup/queue time only with current job, intent and issuance', () => {
  const b = binding(), validated = validateCoordinationBinding(b, now), text = envelope(grant(b));
  assert.equal(validated.dispatchedAt, b.dispatchedAt);
  assert.equal(validated.provisionedAt, b.provisionedAt);
  assert.deepEqual(validated.reviewedAt, b.reviewedAt);
  assert.equal(coordinationDeadline(validated), b.issuanceExpiresAt);
  assert.deepEqual(verifyCoordinationGrantData({ envelope: text, expected: b, now, publicKeySpkiBase64 }).grant.binding, validated);
  assert.throws(() => verifyCoordinationGrantData({ envelope: text, expected: b, now }));
  const legacy = { ...b }; delete legacy.schemaVersion; delete legacy.setupContractSha256; delete legacy.setupExpiresAt;
  assert.throws(() => validateCoordinationBinding(legacy, now));
});
for (const [label, change] of [
  ['missing version', b => { delete b.schemaVersion; }], ['wrong version', b => { b.schemaVersion = 1; }],
  ['future version', b => { b.schemaVersion = 3; }], ['missing marker', b => { delete b.setupContractSha256; }],
  ['wrong marker', b => { b.setupContractSha256 = '0'.repeat(64); }],
  ['missing expiry', b => { delete b.setupExpiresAt; }], ['extra caller mode', b => { b.materialMode = DURABLE_SETUP_MODE; }],
  ['expired setup', b => { b.setupExpiresAt = now; }], ['string expiry', b => { b.setupExpiresAt = iso(now + 3600000); }],
  ['renewed setup', b => { b.setupExpiresAt = Date.parse(b.provisionedAt) + 86400001; }],
  ['future provision', b => { b.provisionedAt = iso(now + 1); }],
  ['review before setup', b => { b.reviewedAt.root = iso(Date.parse(b.provisionedAt) - 1); }],
  ['review after dispatch', b => { b.reviewedAt.independent = iso(Date.parse(b.dispatchedAt) + 1); }],
  ['future dispatch', b => { b.dispatchedAt = iso(now + 1); }],
  ['malformed dispatch', b => { b.dispatchedAt = '2026-10-15T25:00:00Z'; }],
  ['stale job', b => { b.jobStartedAt = iso(now - 1800001); }],
  ['job before dispatch', b => { b.dispatchedAt = iso(now - 1000); }],
  ['intent before job', b => { b.intentAt = iso(now - 30000); }],
  ['stale intent', b => { b.intentAt = iso(now - 1800001); }],
  ['expired issuance', b => { b.issuanceExpiresAt = now; }],
  ['renewed issuance', b => { b.issuanceObservedAt = now - 600001; b.issuanceExpiresAt = now + 1; }],
]) test(`durable coordination rejects ${label}`, () => {
  const b = binding(); change(b); assert.throws(() => validateCoordinationBinding(b, now));
  assert.throws(() => grant(b));
});
test('durable signed grant binds every setup marker and expiry byte to the exact expected original', () => {
  const b = binding(), text = envelope(grant(b));
  for (const change of [g => { g.binding.setupExpiresAt++; }, g => { g.binding.schemaVersion = 1; },
    g => { g.binding.setupContractSha256 = '0'.repeat(64); }]) {
    const parsed = JSON.parse(text); change(parsed.grant);
    assert.throws(() => verifyCoordinationGrantData({ envelope: JSON.stringify(parsed), expected: b, now, publicKeySpkiBase64 }));
  }
  const different = binding(); different.setupExpiresAt++;
  assert.throws(() => verifyCoordinationGrantData({ envelope: envelope(grant(different)), expected: b, now, publicKeySpkiBase64 }));
  assert.throws(() => verifyCoordinationGrantData({ envelope: text, expected: b, now: now + 100000, publicKeySpkiBase64 }));
  for (const values of [{ privateReadinessAt: now - 2700000 }, { authorizedAt: now - 600001 }, { expiresAt: now + 600001 }])
    assert.throws(() => grant(b, values));
});
test('durable grant deadline retains the earliest original setup, issuance, job and intent cap', () => {
  for (const [name, change] of [
    ['setup', b => { b.setupExpiresAt = now + 1000; }],
    ['issuance', b => { b.issuanceExpiresAt = now + 1000; }],
    ['job', b => { b.jobStartedAt = iso(now - 1800000 + 1000); }],
    ['intent', b => { b.jobStartedAt = iso(now - 1800000 + 500); b.intentAt = iso(now - 1800000 + 1000); }],
  ]) {
    const b = binding(); change(b); const expected = name === 'intent' ? now + 500 : now + 1000;
    assert.equal(coordinationDeadline(validateCoordinationBinding(b, now)), expected, name);
    assert.throws(() => grant(b, { expiresAt: expected + 1 }));
    assert.equal(grant(b, { expiresAt: expected }).expiresAt, expected);
  }
});
test('projection derives durable markers solely from the selected setup and matches the original current job', () => {
  const b = binding(), selected = { runId: b.runId, runAttempt: 1, workflow: b.workflow, dispatchedAt: b.dispatchedAt,
    jobId: b.jobId, jobStartedAt: b.jobStartedAt, harnessSha: b.harnessSha, contractSha256: b.contractSha256,
    materialMode: DURABLE_SETUP_MODE, materialHashes: b.materialHashes, reviewedAt: b.reviewedAt,
    candidate: { sha: b.candidateSha, sourceDigest: b.sourceDigest, lockHash: b.lockHash },
    context: { schemaVersion: 2, kind: 'fcos_exact_04ee_setup_context', contractSha256: DURABLE_SETUP_CONTRACT_SHA256,
      provisionedAt: b.provisionedAt, setupExpiresAt: iso(b.setupExpiresAt), cleanupDeadline: iso(b.setupExpiresAt + 1000),
      configurationRevision: b.configurationRevision } };
  const original = { intent: { runId: b.runId, operationId: b.operationId, requestSha256: b.requestSha256,
    controlRevision: b.controlRevision, intentAt: b.intentAt }, trust: { runId: b.runId, runAttempt: 1, workflow: b.workflow,
    dispatchedAt: b.dispatchedAt, jobId: b.jobId, jobStartedAt: b.jobStartedAt, repositoryId: b.repositoryId,
    artifactId: b.intentArtifactId, archiveDigest: b.intentArchiveSha256 } };
  const issuanceEnvelope = JSON.stringify({ receipt: { context: { runId: b.runId, runAttempt: 1, operation: 'create',
    repositoryId: b.repositoryId, environmentId: b.environmentId, harnessSha: b.harnessSha,
    candidateSha: b.candidateSha, controlRevision: b.controlRevision, contractSha256: b.contractSha256 },
    observedAt: b.issuanceObservedAt, issuedAt: b.issuanceObservedAt, expiresAt: b.issuanceExpiresAt } });
  const source = readFileSync('scripts/lib/preview-email-coordination.mjs', 'utf8');
  const start = source.indexOf('export function coordinationBindingFromOriginal'), end = source.indexOf('\nexport function validateCoordinationLease', start);
  const dependencies = { successorLiveSelection(value) { assert.equal(value, selected); return value; },
    SUCCESSOR_LIVE_CONTRACT: candidate, isDurableSuccessorSetup, DURABLE_SETUP_MODE, DURABLE_SETUP_CONTRACT_SHA256,
    durableSuccessorSetupDeadline, assertTrustedPreviewEmailIntentRecord(value) { assert.equal(value, original); return value; },
    normalizeCoordinationEnvelope, positive: value => Number.isSafeInteger(value) && value > 0,
    coordinationFailure, validateCoordinationBinding, coordinationHash };
  const project = new Function(...Object.keys(dependencies), `${source.slice(start, end).replace(/^export /, '')}\nreturn coordinationBindingFromOriginal;`)(...Object.values(dependencies));
  const projected = project({ admission: selected, original, issuanceEnvelope, now, setupExpiresAt: now + 86400000 });
  assert.equal(projected.schemaVersion, 2); assert.equal(projected.setupContractSha256, DURABLE_SETUP_CONTRACT_SHA256);
  assert.equal(projected.setupExpiresAt, b.setupExpiresAt);
  for (const change of [s => { s.materialMode = 'legacy'; }, s => { s.context.contractSha256 = '0'.repeat(64); },
    s => { s.jobId++; }, s => { s.jobStartedAt = iso(now - 1); },
    s => { s.context.setupExpiresAt = iso(now); }, s => { s.context.cleanupDeadline = iso(now + 1); }]) {
    const saved = structuredClone(selected); change(selected);
    assert.throws(() => project({ admission: selected, original, issuanceEnvelope, now }));
    Object.assign(selected, saved);
  }
  for (const admission of [selected, structuredClone(selected), { accepted: true, materialMode: DURABLE_SETUP_MODE }])
    assert.throws(() => coordinationBindingFromOriginal({ admission, original, issuanceEnvelope, now }));
});
