import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { SUCCESSOR_LIVE_CONTRACT } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { SUCCESSOR_ATTEST_PURPOSE, SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256,
  successorAttestationPlan, assertSuccessorAttestationApproval, runSuccessorAttestationAdmission,
  requireSuccessorAttestationPublicationAdmission } from '../scripts/lib/preview-vercel-successor-attestation.mjs';
import { successorAttestationMain } from '../scripts/preview-vercel-successor-attest.mjs';

const now = Date.parse('2026-10-09T02:00:00.000Z'), nonce = '11111111-1111-4111-8111-111111111111', scriptSha256 = 'e'.repeat(64);
function approval() {
  return { schemaVersion: 1, action: 'attest', purpose: SUCCESSOR_ATTEST_PURPOSE, authorized: true,
    authorizedBy: fcosConnectionIdentifier('github', 'Required account'), authorizationEvidence: 'OFFLINE PERSONAL APPROVAL FIXTURE',
    authorizedAt: now - 1000, attestorNewPurposeAuthorized: true, scriptSha256,
    canonicalHelperSha256: SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256, nonce, target: successorAttestationPlan().target,
    candidateSha: SUCCESSOR_LIVE_CONTRACT.candidateSha, sourceDigest: SUCCESSOR_LIVE_CONTRACT.sourceDigest,
    lockHash: SUCCESSOR_LIVE_CONTRACT.lockHash, harnessSha: 'a'.repeat(40), controlRevision: 'b'.repeat(64), configurationRevision: 'c'.repeat(64),
    contractSha256: 'd'.repeat(64), enrollmentId: '22222222-2222-4222-8222-222222222222', tokenId: 'OFFLINE_EXISTING_TOKEN',
    expiresAt: now + 3600000, leaseDeadline: now + 3600000, runId: 99, runAttempt: 1, operation: 'create',
    secretMetadata: ['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_VERCEL_ENROLLMENT'].map(name => ({
      name, created_at: new Date(now - 60000).toISOString(), updated_at: new Date(now - 10000).toISOString() })) };
}
test('default plan and all unsupported CLI actions perform no authenticated or private operation', async () => {
  let calls = 0;
  assert.equal((await runSuccessorAttestationAdmission({ collectAdmission() { calls++; }, preflightFixedReads() { calls++; } })).publicationInstalled, false);
  assert.equal((await successorAttestationMain()).providerCalls, 0);
  for (const args of [['enroll'], ['--execute-approved', 'enroll', nonce], ['--attest-approved', '../escape'], ['--attest-approved', nonce, 'extra']]) {
    await assert.rejects(() => successorAttestationMain(args));
  }
  assert.equal(calls, 0);
  const result = spawnSync(process.execPath, ['scripts/preview-vercel-successor-attest.mjs', '--plan'], { encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: '/private/tmp/no-fcos-authentication' } });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).privateReads, 0); assert.equal(result.stderr, '');
});
test('exact pure approval accepts only the existing issuance purpose before I/O', () => {
  assert.equal(assertSuccessorAttestationApproval({ approval: approval(), nonce, scriptSha256, now }).action, 'attest');
});
for (const [name, mutate] of [
  ['not authorized', a => { a.authorized = false; }], ['owner', a => { a.authorizedBy = 'other'; }],
  ['action enroll', a => { a.action = 'enroll'; }], ['coordination purpose', a => { a.purpose = 'coordination-grant'; }],
  ['missing personal evidence', a => { a.authorizationEvidence = ''; }], ['new purpose absent', a => { a.attestorNewPurposeAuthorized = false; }],
  ['old approval', a => { a.authorizedAt = now - 3600001; }], ['future approval', a => { a.authorizedAt = now + 1; }],
  ['helper bytes', a => { a.scriptSha256 = 'f'.repeat(64); }], ['canonical helper', a => { a.canonicalHelperSha256 = 'f'.repeat(64); }],
  ['nonce', a => { a.nonce = '33333333-3333-4333-8333-333333333333'; }], ['target', a => { a.target = { ...a.target, repository: 'foreign/repo' }; }],
  ['final candidate', a => { a.candidateSha = SUCCESSOR_LIVE_CONTRACT.deferredFinalSha; }], ['source', a => { a.sourceDigest = 'f'.repeat(64); }],
  ['lock', a => { a.lockHash = 'f'.repeat(64); }], ['harness', a => { a.harnessSha = ''; }], ['controls', a => { a.controlRevision = ''; }],
  ['material contract', a => { a.contractSha256 = ''; }], ['expiry', a => { a.expiresAt = now; }], ['expiry beyond lease', a => { a.leaseDeadline = now + 1; }],
  ['rerun', a => { a.runAttempt = 2; }], ['token selector', a => { a.tokenId = 'current'; }], ['partial secret metadata', a => { a.secretMetadata.pop(); }],
  ['extra secret field', a => { a.secretMetadata[0].value = 'PRIVATE_MARKER'; }], ['caller lease boolean', a => { a.leaseAccepted = true; }],
]) test(`invalid ${name} fails before collector/preflight construction or access`, async () => {
  const a = approval(); mutate(a); let calls = 0;
  await assert.rejects(() => runSuccessorAttestationAdmission({ action: 'attest', approval: a, nonce, scriptSha256,
    collectAdmission() { calls++; assert.fail('No authenticated collection permitted.'); },
    preflightFixedReads() { calls++; assert.fail('No adapter access permitted.'); }, now: () => now }));
  assert.equal(calls, 0);
});
test('synthetic or serialized source admission cannot reach fixed reads or any private capability', async () => {
  let reads = 0;
  for (const value of [{}, { sourceVerified: true, accepted: true }, successorAttestationPlan()]) {
    await assert.rejects(() => runSuccessorAttestationAdmission({ action: 'attest', approval: approval(), nonce, scriptSha256,
      collectAdmission: async () => value, preflightFixedReads() { reads++; }, now: () => now }));
  }
  assert.equal(reads, 0);
  for (const value of [undefined, true, { leaseAccepted: true, publicationIntentDurable: true }]) {
    assert.throws(() => requireSuccessorAttestationPublicationAdmission(value), error => error.code === 'EXACT_SUCCESSOR_CANONICAL_PUBLICATION_ADMISSION_REQUIRED');
  }
});
