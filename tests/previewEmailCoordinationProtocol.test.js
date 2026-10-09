import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { SUCCESSOR_LIVE_CONTRACT as candidate } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { PREVIEW_COORDINATION_CANONICAL, coordinationHash, coordinationLeaseBinding,
  coordinationGrantData, coordinationGrantMessage, verifyCoordinationGrantData,
  normalizeCoordinationEnvelope, validateCoordinationBinding, coordinationBindingFromOriginal,
  requirePreviewCoordinationProtectedActions } from '../scripts/lib/preview-email-coordination.mjs';

// Ephemeral keys exercise only the pure data codec. They cannot produce any
// production collector, canonical lease, private signing or hosted claim.
const now = Date.parse('2026-10-09T07:00:00.000Z');
const keys = generateKeyPairSync('ed25519');
const testPublicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const iso = ms => new Date(ms).toISOString();
function binding() {
  return { repositoryId: 1278654816, environmentId: 123, runId: 37882841010, runAttempt: 1,
    workflow: '.github/workflows/preview-email-proof-build.yml', dispatchedAt: iso(now - 30000),
    jobId: 113666224339, jobStartedAt: iso(now - 20000), intentArtifactId: 11597460091,
    intentArchiveSha256: 'a'.repeat(64), intentSha256: 'b'.repeat(64),
    operationId: 'fcos-preview-email-37882841010-11111111-1111-4111-8111-111111111111',
    requestSha256: 'c'.repeat(64), candidateSha: candidate.candidateSha,
    sourceDigest: candidate.sourceDigest, lockHash: candidate.lockHash,
    candidateGitTree: candidate.candidateGitTree, candidateTreeHash: candidate.candidateTreeHash,
    harnessSha: 'd'.repeat(40), controlRevision: 'e'.repeat(64), configurationRevision: 'f'.repeat(64),
    contractSha256: '1'.repeat(64), materialHashes: { context: '2'.repeat(64), root: '3'.repeat(64), independent: '4'.repeat(64) },
    reviewedAt: { root: iso(now - 50000), independent: iso(now - 40000) },
    provisionedAt: iso(now - 60000), intentAt: iso(now - 10000),
    issuanceEnvelopeSha256: '5'.repeat(64), issuanceObservedAt: now - 5000, issuanceExpiresAt: now + 590000 };
}
function lease(b) {
  return { epoch: PREVIEW_COORDINATION_CANONICAL.epoch, objective: 'production',
    ownerThreadId: PREVIEW_COORDINATION_CANONICAL.ownerThreadId, operationId: b.operationId,
    bindingSha256: coordinationLeaseBinding(b), leaseId: '22222222-2222-4222-8222-222222222222',
    coordinationOnly: true, providerAuthorityGranted: false, uncertainOutcomeRequiresReadback: true };
}
function grant(b = binding(), options = {}) {
  return coordinationGrantData({ binding: b, lease: lease(b), consumptionSha256: '6'.repeat(64),
    issuedAt: now, expiresAt: now + 100000, ...options });
}
function envelope(g = grant(), domain) {
  const message = domain === undefined ? coordinationGrantMessage(g) : Buffer.from(domain + JSON.stringify(g));
  return JSON.stringify({ grant: g, signature: sign(null, message, keys.privateKey).toString('base64url') });
}
function verify(value, expected = binding(), at = now) {
  return verifyCoordinationGrantData({ envelope: value, expected, now: at, publicKeySpkiBase64: testPublicKey });
}

test('ephemeral signatures verify as data only; real pinned verifier rejects the fixture key', () => {
  const text = envelope(), result = verify(text);
  assert.equal(result.envelopeText, text);
  assert.equal(result.envelopeSha256, coordinationHash(text));
  assert.equal(result.grant.productionAuthorized, false);
  assert.throws(() => verifyCoordinationGrantData({ envelope: text, expected: binding(), now }));
  assert.throws(() => coordinationBindingFromOriginal({ admission: result, original: result, issuanceEnvelope: text, now }));
  assert.throws(() => coordinationBindingFromOriginal({ admission: structuredClone(result), original: result, issuanceEnvelope: text, now }));
});
test('existing issuance and connection-health signature purposes cannot authenticate coordination', () => {
  for (const purpose of ['FCOS-PREVIEW-VERCEL-RUN-AUTHORITY-V1\0', 'FCOS-CONNECTION-HEALTH-V1\0', '']) {
    assert.throws(() => verify(envelope(grant(), purpose)));
  }
  const value = JSON.parse(envelope()); value.grant.consumptionSha256 = '7'.repeat(64);
  assert.throws(() => verify(JSON.stringify(value)));
});
test('protected-variable normalization preserves original representation and original times', () => {
  const value = { receipt: { issuedAt: now - 5000, expiresAt: now + 590000 }, signature: 'fixture-only' };
  const original = '  ' + JSON.stringify(value, null, 2) + '\n';
  const normalized = normalizeCoordinationEnvelope(original, 16384);
  assert.equal(normalized.text, original);
  assert.equal(normalized.sha256, coordinationHash(Buffer.from(original)));
  assert.deepEqual(normalized.value, value);
  assert.notEqual(normalized.sha256, normalizeCoordinationEnvelope(JSON.stringify(value)).sha256);
  assert.equal(normalized.value.receipt.issuedAt, now - 5000);
  for (const invalid of ['', '[]', 'null', '{broken', ' '.repeat(16385)]) {
    assert.throws(() => normalizeCoordinationEnvelope(invalid, 16384));
  }
});
for (const [label, change] of [
  ['repository', b => { b.repositoryId++; }], ['environment', b => { b.environmentId++; }],
  ['job', b => { b.jobId++; }], ['archive ID', b => { b.intentArtifactId++; }],
  ['archive bytes', b => { b.intentArchiveSha256 = '8'.repeat(64); }],
  ['intent bytes', b => { b.intentSha256 = '8'.repeat(64); }],
  ['request bytes', b => { b.requestSha256 = '8'.repeat(64); }],
  ['harness', b => { b.harnessSha = '8'.repeat(40); }],
  ['controls', b => { b.controlRevision = '8'.repeat(64); }],
  ['configuration', b => { b.configurationRevision = '8'.repeat(64); }],
  ['contract', b => { b.contractSha256 = '8'.repeat(64); }],
  ['root review', b => { b.materialHashes.root = '8'.repeat(64); }],
  ['independent review', b => { b.materialHashes.independent = '8'.repeat(64); }],
  ['issuance bytes', b => { b.issuanceEnvelopeSha256 = '8'.repeat(64); }],
  ['original dispatch', b => { b.dispatchedAt = iso(now - 31000); }],
  ['original intent time', b => { b.intentAt = iso(now - 11000); }],
]) test(`even a validly signed different ${label} cannot replace the expected original operation`, () => {
  const different = binding(); change(different);
  assert.throws(() => verify(envelope(grant(different))));
});
test('wrong run, attempt, workflow and frozen candidate are rejected before a grant exists', () => {
  for (const change of [b => { b.runId++; }, b => { b.runAttempt = 2; },
    b => { b.workflow = '.github/workflows/production-release.yml'; },
    b => { b.candidateSha = candidate.deferredFinalSha; }, b => { b.sourceDigest = '0'.repeat(64); },
    b => { b.lockHash = '0'.repeat(64); }]) {
    const b = binding(); change(b); assert.throws(() => validateCoordinationBinding(b, now));
  }
});
test('foreign helper lease, authority labels and changed binding cannot enter a grant', () => {
  const b = binding();
  for (const change of [l => { l.epoch = 'other-epoch'; }, l => { l.objective = 'reconciliation'; },
    l => { l.ownerThreadId = 'other-owner'; }, l => { l.operationId += '-different'; },
    l => { l.bindingSha256 = '0'.repeat(64); }, l => { l.providerAuthorityGranted = true; },
    l => { l.uncertainOutcomeRequiresReadback = false; }, l => { l.extra = true; }]) {
    const l = lease(b); change(l); assert.throws(() => grant(b, { lease: l }));
  }
});
test('45-minute provisioning, original 30-minute evidence and 600-second authority cannot be renewed', () => {
  for (const change of [b => { b.provisionedAt = iso(now - 2700001); },
    b => { b.dispatchedAt = iso(now - 1800001); },
    b => { b.reviewedAt.root = iso(now - 1800001); },
    b => { b.issuanceObservedAt = now - 600001; b.issuanceExpiresAt = now + 1; }]) {
    const b = binding(); change(b); assert.throws(() => grant(b));
  }
  assert.throws(() => grant(binding(), { expiresAt: now + 600001 }));
  const slow = binding(); slow.provisionedAt = iso(now - 2700000 + 10000);
  assert.throws(() => grant(slow, { expiresAt: now + 10001 }));
  const text = envelope(); assert.throws(() => verify(text, binding(), now + 100000));
  assert.throws(() => verify(text, binding(), now - 1));
});
test('source-only guard cannot be lifted with a valid data signature or fabricated approval flags', () => {
  for (const value of [undefined, true, { protectedActionsInstalled: true }, verify(envelope())]) {
    assert.throws(() => requirePreviewCoordinationProtectedActions(value),
      error => error.code === 'PREVIEW_COORDINATION_PROTECTED_ACTIONS_NOT_INSTALLED');
  }
});
