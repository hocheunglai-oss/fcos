import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync, linkSync, symlinkSync, unlinkSync,
  constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, appendFileSync, fsyncSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { SUCCESSOR_LIVE_CONTRACT } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { SUCCESSOR_ATTEST_PURPOSE, SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256,
  successorAttestationPlan, assertSuccessorAttestationApproval, runSuccessorAttestationAdmission,
  requireSuccessorAttestationPublicationAdmission, successorAttestationSecretMetadata, successorAttestationActionBinding,
  assertSuccessorAttestationPrivateAction, assertSuccessorAttestationEnrollment, assertSuccessorAttestationPinnedKey,
  assertSuccessorAttestationProtectedReview, readSuccessorEnrollmentTokenMetadata,
  assertSuccessorAttestationRepositoryVariables, successorAttestationCommandStatus, successorAttestationHash,
  runFixedSuccessorAttestation, bindSuccessorAttestationAdmission, collectSuccessorAttestationPublicPreflight } from '../scripts/lib/preview-vercel-successor-attestation.mjs';
import { DURABLE_SETUP_MODE, DURABLE_SETUP_CONTRACT_SHA256, isDurableSuccessorSetup,
  durableSuccessorSetupDeadline } from '../scripts/lib/runtime-compatibility-setup.mjs';
import { successorAttestationMain } from '../scripts/preview-vercel-successor-attest.mjs';
import { ENROLLED_AUTHORITY_MODE } from '../scripts/lib/preview-vercel-enrollment.mjs';
import { PREVIEW_EMAIL_BUILD_CONTROL_FILES } from '../scripts/lib/preview-email-build-controls.mjs';
import { previewCoordinationSecretMetadata } from '../scripts/lib/preview-email-coordination-collector.mjs';

const actualCreate = JSON.parse(readFileSync(new URL('./fixtures/preview-create-actual-github.json', import.meta.url)));
const actualVerification = JSON.parse(readFileSync(new URL('./fixtures/preview-verification-actual-github.json', import.meta.url)));
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
    secretMetadata: ['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_RELEASE_VERCEL_ENROLLMENT',
      'FCOS_E2E_VERCEL_BYPASS', 'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN', 'FCOS_RELEASE_RUNTIME_TOKEN'].map(name => ({
      name, created_at: new Date(now - 60000).toISOString(), updated_at: new Date(now - 10000).toISOString() })),
    privateReadinessAt: now - 2000, enrollmentStateSha256: '1'.repeat(64),
    privateActionEvidence: { path: '/Users/vincex/Documents/FCOS/.fcos-cli/OFFLINE-authority.json', sha256: '2'.repeat(64) },
    rootReview: { path: '/Users/vincex/Documents/FCOS/.fcos-cli/OFFLINE-root.json', sha256: '3'.repeat(64) },
    independentReview: { path: '/Users/vincex/Documents/FCOS/.fcos-cli/OFFLINE-independent.json', sha256: '4'.repeat(64) },
    authorityBasis: { kind: 'existing_direct_human_authorization', localReviewGrantsAuthority: false,
      citations: [{ path: '/Users/vincex/Documents/FCOS/.fcos-cli/OFFLINE-citation.json', sha256: '5'.repeat(64) }] },
    jobId: 100, jobStartedAt: new Date(now - 10000).toISOString(), dispatchedAt: new Date(now - 15000).toISOString(),
    operationId: `fcos-preview-vercel-attestation-99-${nonce}` };
}
function durableApproval() {
  return { ...approval(), schemaVersion: 2, setupContractSha256: DURABLE_SETUP_CONTRACT_SHA256,
    dispatchedAt: new Date(now - 4 * 3600000).toISOString() };
}
function durableContext() {
  return { schemaVersion: 2, kind: 'fcos_exact_04ee_setup_context', contractSha256: DURABLE_SETUP_CONTRACT_SHA256,
    provisionedAt: new Date(now - 5 * 3600000).toISOString(), setupExpiresAt: new Date(now + 3600000).toISOString(),
    cleanupDeadline: new Date(now + 2 * 3600000).toISOString(),
    previewControlRevision: 'b'.repeat(64), configurationRevision: 'c'.repeat(64) };
}
test('durable attestation explicitly opts into create/readback and preserves the original queued dispatch', async () => {
  for (const operation of ['create', 'readback']) {
    const a = { ...durableApproval(), operation };
    assert.equal(assertSuccessorAttestationApproval({ approval: a, nonce, scriptSha256, now }), a);
    assert.equal(assertSuccessorAttestationProtectedReview(a, protectedReview(a), now), true);
  }
  const old = approval(); old.dispatchedAt = durableApproval().dispatchedAt;
  assert.throws(() => assertSuccessorAttestationApproval({ approval: old, nonce, scriptSha256, now }));
  for (const change of [a => { a.schemaVersion = 1; }, a => { a.schemaVersion = 3; },
    a => { delete a.setupContractSha256; }, a => { a.setupContractSha256 = '0'.repeat(64); },
    a => { a.operation = 'verify-authority'; }, a => { a.dispatchedAt = new Date(now + 1).toISOString(); },
    a => { a.dispatchedAt = '2026-10-08T25:00:00.000Z'; },
    a => { a.dispatchedAt = new Date(now - 1000).toISOString(); },
    a => { a.jobStartedAt = new Date(now - 1800001).toISOString(); },
    a => { a.privateReadinessAt = now - 2700000; }, a => { a.authorizedAt = now - 3600001; },
    a => { a.materialMode = DURABLE_SETUP_MODE; }]) {
    const a = durableApproval(); change(a); let reads = 0;
    await assert.rejects(() => runSuccessorAttestationAdmission({ action: 'attest', approval: a, nonce, scriptSha256,
      now: () => now, collectAdmission: async () => { reads++; }, preflightFixedReads: () => { reads++; } }));
    assert.equal(reads, 0);
  }
});
test('durable attestation cannot replace the current original first proof job or private review clocks', () => {
  const a = durableApproval();
  assert.equal(assertSuccessorAttestationPrivateAction(a, privateAuthority(a), materialReviews(a), now), true);
  for (const change of [r => { r.jobs[0].id++; }, r => { r.jobs[0].run_attempt++; },
    r => { r.jobs[0].started_at = new Date(now - 1).toISOString(); },
    r => { r.run.run_started_at = new Date(now - 1).toISOString(); }]) {
    const reviewed = protectedReview(a); change(reviewed);
    assert.throws(() => assertSuccessorAttestationProtectedReview(a, reviewed, now));
  }
  const stale = { ...a, jobStartedAt: new Date(now - 1800001).toISOString() };
  assert.throws(() => assertSuccessorAttestationProtectedReview(stale, protectedReview(stale), now));
  for (const change of [rows => { rows[0].reviewedAt = a.authorizedAt - 1; },
    rows => { rows[0].reviewedAt = a.authorizedAt + 600001; },
    rows => { rows[0].bindingSha256 = '0'.repeat(64); }]) {
    const rows = materialReviews(a); change(rows);
    assert.throws(() => assertSuccessorAttestationPrivateAction(a, privateAuthority(a), rows, now));
  }
});
test('durable approval must agree with the genuine selected setup and exact current job', () => {
  const a = durableApproval(), selected = { runId: a.runId, workflow: a.target.workflow, harnessSha: a.harnessSha,
    contractSha256: a.contractSha256, materialMode: DURABLE_SETUP_MODE, context: durableContext(),
    jobId: a.jobId, jobStartedAt: a.jobStartedAt, dispatchedAt: a.dispatchedAt };
  // Evaluate the real binding branch with an inert identity gate. This never
  // enters the production collector's WeakSet or any private/publication path.
  const bind = bodyFixture('scripts/lib/preview-vercel-successor-attestation.mjs', 'export function bindSuccessorAttestationAdmission',
    '\n/** Only the fixed native path', { assertSuccessorAttestationApproval, policy: SUCCESSOR_LIVE_CONTRACT,
      successorLiveSelection(value) { assert.equal(value, selected); return value; },
      successorVerificationSelection() { assert.fail('No durable verify-authority admission'); },
      ENROLLMENT_FIXED_TARGET: a.target, DURABLE_SETUP_MODE, isDurableSuccessorSetup, durableSuccessorSetupDeadline,
      fail: () => { throw Error('Exact setup admission denied'); } });
  assert.equal(bind({ approval: a, nonce, scriptSha256, admission: selected, now }), selected);
  for (const change of [s => { s.materialMode = 'legacy'; }, s => { s.context.schemaVersion = 1; },
    s => { s.context.contractSha256 = '0'.repeat(64); }, s => { s.jobId++; },
    s => { s.jobStartedAt = new Date(now - 1).toISOString(); },
    s => { s.dispatchedAt = new Date(now - 2).toISOString(); },
    s => { s.context.setupExpiresAt = new Date(now).toISOString(); },
    s => { s.context.cleanupDeadline = new Date(now + 1).toISOString(); }]) {
    const saved = structuredClone(selected); change(selected);
    assert.throws(() => bind({ approval: a, nonce, scriptSha256, admission: selected, now }));
    Object.assign(selected, saved);
  }
  assert.throws(() => bindSuccessorAttestationAdmission({ approval: a, nonce, scriptSha256, admission: selected, now }));
  assert.throws(() => bindSuccessorAttestationAdmission({ approval: a, nonce, scriptSha256, admission: structuredClone(selected), now }));
});
test('durable receipt is bounded by every short clock and original setup expiry without renewing any clock', () => {
  const deadline = bodyFixture('scripts/lib/preview-vercel-successor-attestation.mjs', 'function receiptDeadline',
    '\nasync function executeFixed', { Date, durableSuccessorSetupDeadline });
  const a = durableApproval(), admission = { capturedAt: new Date(now).toISOString(), context: durableContext() };
  assert.equal(deadline(a, admission, now), now + 600000);
  for (const [key, change] of [
    ['token', (a, s) => { a.expiresAt = now + 1000; }],
    ['lease', (a, s) => { a.leaseDeadline = now + 1000; }],
    ['private readiness', (a, s) => { a.privateReadinessAt = now - 2700000 + 1000; }],
    ['live capture', (a, s) => { s.capturedAt = new Date(now - 1800000 + 1000).toISOString(); }],
    ['job start', (a, s) => { a.jobStartedAt = new Date(now - 1800000 + 1000).toISOString(); }],
    ['setup', (a, s) => { s.context.setupExpiresAt = new Date(now + 1000).toISOString(); }],
  ]) {
    const changed = structuredClone(a), selected = structuredClone(admission); change(changed, selected);
    assert.equal(deadline(changed, selected, now), now + 1000, key);
  }
  for (const time of [now, now - 1]) {
    const selected = structuredClone(admission); selected.context.setupExpiresAt = new Date(time).toISOString();
    assert.throws(() => deadline(a, selected, now));
  }
  const old = approval(), legacy = { context: { provisionedAt: new Date(now - 2700000 + 1000).toISOString() },
    dispatchedAt: old.dispatchedAt, reviewedAt: { root: new Date(now).toISOString(), independent: new Date(now).toISOString() } };
  assert.equal(deadline(old, legacy, now), now + 1000);
});
test('default plan and all unsupported CLI actions perform no authenticated or private operation', async () => {
  let calls = 0;
  assert.equal((await runSuccessorAttestationAdmission({ collectAdmission() { calls++; }, preflightFixedReads() { calls++; } })).publicationInstalled, true);
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
test('verify-only repository diagnostic must match workflow admission while release/build stay disabled; create gates remain unchanged', () => {
  const names = ['FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED', 'FCOS_PREVIEW_EMAIL_BUILD_ENABLED', 'FCOS_PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLED'];
  const rows = names.map(name => ({ name, value: name === names[2] ? 'true' : 'false' }));
  assert.equal(assertSuccessorAttestationRepositoryVariables(rows, 'verify-authority'), true);
  assert.throws(() => assertSuccessorAttestationRepositoryVariables(rows, 'create'));
  for (const name of names) {
    assert.throws(() => assertSuccessorAttestationRepositoryVariables(rows.filter(row => row.name !== name), 'verify-authority'));
    assert.throws(() => assertSuccessorAttestationRepositoryVariables(rows.map(row => row.name === name ? { ...row, value: row.value === 'true' ? 'false' : 'true' } : row), 'verify-authority'));
  }
  assert.equal(assertSuccessorAttestationRepositoryVariables([], 'create'), true);
  assert.equal(assertSuccessorAttestationRepositoryVariables(names.map(name => ({ name, value: 'false' })), 'create'), true);
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
  ['rerun', a => { a.runAttempt = 2; }], ['token selector', a => { a.tokenId = 'current'; }],
  ['partial secret metadata', a => { a.secretMetadata = a.secretMetadata.filter(row => row.name !== 'FCOS_RELEASE_VERCEL_ENROLLMENT'); }],
  ['stale private consent', a => { a.privateReadinessAt = now - 2700000; }], ['source action review missing', a => { delete a.rootReview; }],
  ['same reviewer material', a => { a.independentReview.sha256 = a.rootReview.sha256; }],
  ['stale job', a => { a.jobStartedAt = new Date(now - 1800001).toISOString(); }],
  ['wrong publication operation', a => { a.operationId = 'fcos-preview-email-99-' + nonce; }],
  ['extra secret field', a => { a.secretMetadata[0].value = 'PRIVATE_MARKER'; }], ['caller lease boolean', a => { a.leaseAccepted = true; }],
]) test(`invalid ${name} fails before collector/preflight construction or access`, async () => {
  const a = approval(); mutate(a); let calls = 0;
  await assert.rejects(() => runSuccessorAttestationAdmission({ action: 'attest', approval: a, nonce, scriptSha256,
    collectAdmission() { calls++; assert.fail('No authenticated collection permitted.'); },
    preflightFixedReads() { calls++; assert.fail('No adapter access permitted.'); }, now: () => now }));
  assert.equal(calls, 0);
  const options = { action: 'attest', approval: a, nonce, scriptSha256, now: () => now };
  for (const key of ['collectAdmission', 'preflightFixedReads']) Object.defineProperty(options, key, { get() { calls++; throw new Error('Adapter property must remain untouched.'); } });
  await assert.rejects(() => runSuccessorAttestationAdmission(options)); assert.equal(calls, 0);
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

function privateAuthority(a = approval()) {
  return { kind: 'direct_human_existing_preview_vercel_attestation_authority', authorizedBy: a.authorizedBy,
    purpose: a.purpose, authorizedAt: a.authorizedAt, privateReadinessAt: a.privateReadinessAt, sourceCommit: a.harnessSha,
    scriptSha256: a.scriptSha256, bindingSha256: successorAttestationActionBinding(a), existingCapsuleReadAuthorized: true,
    existingMetadataReaderAuthorized: true, privateKeyAccessAuthorized: true, actualSigningAuthorized: true,
    protectedReceiptPublicationAuthorized: true, enrollmentAuthorized: false, previewExecutionAuthorized: false, productionAuthorized: false };
}
function materialReviews(a = approval()) {
  return ['root', 'independent'].map(role => ({ kind: 'existing_preview_vercel_attestation_action_material_review', role,
    accepted: true, sourceCommit: a.harnessSha, scriptSha256: a.scriptSha256, bindingSha256: successorAttestationActionBinding(a),
    reviewerId: `/OFFLINE/${role}`, reviewedAt: a.authorizedAt + (role === 'root' ? 100 : 200), grantsPrivateAuthority: false }));
}
test('distinct exact action reviews and original direct human private consent are mandatory and never renew clocks', () => {
  const a = approval(); assert.equal(assertSuccessorAttestationPrivateAction(a, privateAuthority(a), materialReviews(a), now), true);
  for (const mutate of [e => { e.actualSigningAuthorized = false; }, e => { e.purpose = 'coordination-grant'; },
    e => { e.bindingSha256 = '0'.repeat(64); }, e => { e.previewExecutionAuthorized = true; }]) {
    const e = privateAuthority(a); mutate(e); assert.throws(() => assertSuccessorAttestationPrivateAction(a, e, materialReviews(a), now));
  }
  for (const mutate of [r => { r[1].reviewerId = r[0].reviewerId; }, r => { r[0].sourceCommit = '0'.repeat(40); },
    r => { r[0].reviewedAt = now + 1; }, r => { r[0].reviewedAt = a.authorizedAt - 1; },
    r => { r[0].reviewedAt = a.authorizedAt + 600001; }, r => { r[0].grantsPrivateAuthority = true; }]) {
    const r = materialReviews(a); mutate(r); assert.throws(() => assertSuccessorAttestationPrivateAction(a, privateAuthority(a), r, now));
  }
  assert.throws(() => assertSuccessorAttestationPrivateAction(a, privateAuthority(a), materialReviews(a), a.privateReadinessAt + 2700000));
  const original = structuredClone(a);
  assert.throws(() => assertSuccessorAttestationApproval({ approval: a, nonce, scriptSha256, now: now + 1800000 }));
  assert.deepEqual(a, original);
});
test('all six secrets are preserved and required metadata cannot omit, duplicate, substitute or silently ignore unrelated rows', () => {
  const rows = approval().secretMetadata, before = structuredClone(rows);
  const expected = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(successorAttestationSecretMetadata(rows, now), expected);
  assert.deepEqual(previewCoordinationSecretMetadata(rows, now), expected);
  assert.deepEqual(rows, before);
  for (const invalid of [rows.filter(row => row.name !== 'FCOS_RELEASE_GH_TOKEN'), [...rows, rows[0]],
    rows.map((row, i) => i ? row : { ...row, name: 'FOREIGN_SECRET' }),
    rows.map((row, i) => i ? row : { ...row, updated_at: new Date(now + 1).toISOString() })]) {
    assert.throws(() => successorAttestationSecretMetadata(invalid, now));
    assert.throws(() => previewCoordinationSecretMetadata(invalid, now));
  }
});
function capsule(a = approval()) {
  return { enrollment: { schemaVersion: 1, enrollmentId: a.enrollmentId, repository: a.target.repository, environment: a.target.environment,
    teamId: a.target.teamId, projectId: a.target.projectId, tokenId: a.tokenId, createdAt: now - 60000, expiresAt: a.expiresAt },
    binding: Buffer.alloc(32, 1).toString('base64url') };
}
function tokenMetadata(a = approval()) {
  return { id: a.tokenId, projectId: a.target.projectId, type: 'token', prefix: 'vcp_', createdAt: now - 60000,
    expiresAt: a.expiresAt, revokedAt: null, leakedAt: null, scopes: [{ type: 'team', teamId: a.target.teamId, expiresAt: a.expiresAt }] };
}
function state(a = approval()) {
  return { schemaVersion: 1, phase: 'enrolled_disabled', enrollmentId: a.enrollmentId, tokenId: a.tokenId, expiresAt: a.expiresAt,
    sourceSha: '6'.repeat(40), secretMetadata: a.secretMetadata, productionAuthorized: false };
}
test('only existing complete disabled custody with exact capsule/token/expiry/complete metadata is eligible', () => {
  const a = approval(), s = state(a), c = capsule(a), m = tokenMetadata(a);
  assert.equal(assertSuccessorAttestationEnrollment(a, s, JSON.stringify(c), m, now), true);
  for (const mutate of [s => { s.phase = 'quarantined_reconciliation_required'; }, s => { s.tokenId = 'FOREIGN'; },
    s => { s.enrollmentId = nonce; }, s => { s.expiresAt--; }, s => { s.secretMetadata[5].updated_at = new Date(now - 9000).toISOString(); }]) {
    const changed = structuredClone(s); mutate(changed);
    assert.throws(() => assertSuccessorAttestationEnrollment(a, changed, JSON.stringify(c), m, now));
  }
  for (const mutate of [c => { c.enrollment.tokenId = 'FOREIGN'; }, c => { c.enrollment.projectId = 'foreign'; },
    c => { c.binding = 'bad'; }, c => { c.enrollment.expiresAt--; }]) {
    const changed = structuredClone(c); mutate(changed);
    assert.throws(() => assertSuccessorAttestationEnrollment(a, s, JSON.stringify(changed), m, now));
  }
  for (const mutate of [m => { m.id = 'FOREIGN'; }, m => { m.revokedAt = now; }, m => { m.leakedAt = now; },
    m => { m.projectId = 'foreign'; }, m => { m.scopes[0].teamId = 'foreign'; }, m => { m.scopes.push(m.scopes[0]); },
    m => { m.expiresAt--; }, m => { m.createdAt--; }]) {
    const changed = structuredClone(m); mutate(changed);
    assert.throws(() => assertSuccessorAttestationEnrollment(a, s, JSON.stringify(c), changed, now));
  }
  assert.throws(() => assertSuccessorAttestationEnrollment(a, s, JSON.stringify(c), m, a.expiresAt));
  assert.equal(s.sourceSha, '6'.repeat(40)); // Custody source is never rewritten to final installed harness.
});
test('ephemeral or wrong signing keys cannot replace the pinned existing Ed25519 key', () => {
  for (const algorithm of ['ed25519', 'rsa']) {
    const keys = generateKeyPairSync(algorithm, algorithm === 'rsa' ? { modulusLength: 2048 } : undefined);
    assert.throws(() => assertSuccessorAttestationPinnedKey(keys.privateKey.export({ format: 'pem', type: 'pkcs8' })));
  }
});
function protectedReview(a = approval()) {
  return { user: { login: a.authorizedBy, id: 10 }, environment: { id: 20, name: a.target.environment },
    run: { id: a.runId, name: 'FCOS protected Preview email proof build', display_title: `Review FCOS Preview email source ${a.candidateSha}`,
      workflow_id: actualCreate.run.workflow_id, path: actualCreate.run.path, run_started_at: a.dispatchedAt },
    workflow: { id: actualCreate.run.workflow_id, path: actualCreate.run.path, name: 'FCOS protected Preview email proof build', state: 'active' },
    approvals: [{ state: 'approved', user: { login: a.authorizedBy, id: 10 }, environments: [{ id: 20, name: a.target.environment }] }],
    jobs: [{ id: a.jobId, run_id: a.runId, run_attempt: 1, name: 'proof', workflow_name: 'FCOS protected Preview email proof build',
      head_sha: a.harnessSha, head_branch: 'main', status: 'in_progress', conclusion: null, completed_at: null, started_at: a.jobStartedAt }] };
}
test('actual create run-name form and historical static form require exact current workflow and same-form proof job', () => {
  const a = approval(), reviewed = protectedReview(a);
  // Only observed name/definition fields are reused; live timing/status are synthetic.
  Object.assign(reviewed.run, { name: actualCreate.run.name, display_title: actualCreate.run.display_title });
  reviewed.jobs[0].workflow_name = actualCreate.job.workflow_name;
  assert.equal(actualCreate.run.status, 'completed');
  assert.equal(actualCreate.run.conclusion, 'failure');
  assert.equal(assertSuccessorAttestationProtectedReview(a, reviewed, now), true);
  for (const change of [r => { r.run.name += ' foreign'; }, r => { r.run.display_title = r.run.display_title.replace(a.candidateSha, 'f'.repeat(40)); },
    r => { r.run.path = '.github/workflows/production-release.yml'; }, r => { r.run.workflow_id++; },
    r => { r.workflow.id++; }, r => { r.workflow.path += '@main'; }, r => { r.workflow.name = r.run.name; },
    r => { r.workflow.state = 'disabled_manually'; }, r => { delete r.workflow; },
    r => { r.jobs[0].workflow_name = 'FCOS protected Preview email proof build'; },
    r => { r.jobs[0].run_attempt = 2; }, r => { r.jobs[0].run_id++; }, r => { r.jobs[0].head_sha = 'f'.repeat(40); }]) {
    const changed = structuredClone(reviewed); change(changed);
    assert.throws(() => assertSuccessorAttestationProtectedReview(a, changed, now));
  }
  assert.equal(assertSuccessorAttestationProtectedReview(a, protectedReview(a), now), true);
  const mixed = protectedReview(a); mixed.jobs[0].workflow_name = reviewed.run.name;
  assert.throws(() => assertSuccessorAttestationProtectedReview(a, mixed, now));
});
test('actual GitHub dynamic run-name fields bind exact verification title, current workflow and approved first job', () => {
  const a = { ...approval(), operation: 'verify-authority' }, reviewed = protectedReview(a);
  Object.assign(reviewed.run, actualVerification.run, { id: a.runId, run_started_at: a.dispatchedAt });
  Object.assign(reviewed.jobs[0], actualVerification.job, { id: a.jobId, run_id: a.runId, head_sha: a.harnessSha, started_at: a.jobStartedAt });
  reviewed.workflow = { id: actualVerification.run.workflow_id, path: actualVerification.run.path, name: 'FCOS protected Preview email proof build', state: 'active' };
  assert.equal(assertSuccessorAttestationProtectedReview(a, reviewed, now), true);
  for (const change of [r => { r.run.name = 'Verify FCOS enrolled Preview authority for source ' + 'f'.repeat(40); },
    r => { r.run.display_title = r.run.display_title.replace(a.candidateSha, 'f'.repeat(40)); },
    r => { r.run.path = '.github/workflows/production-release.yml'; }, r => { r.run.workflow_id++; },
    r => { r.workflow.id++; }, r => { r.workflow.state = 'disabled_manually'; },
    r => { r.jobs[0].workflow_name = 'foreign workflow'; }, r => { r.jobs[0].head_sha = 'f'.repeat(40); },
    r => { r.jobs[0].run_id++; }, r => { r.jobs[0].run_attempt = 2; }, r => { r.approvals[0].user.id++; }]) {
    const changed = structuredClone(reviewed); change(changed);
    assert.throws(() => assertSuccessorAttestationProtectedReview(a, changed, now));
  }
});
test('real personal exact environment review and original first proof job cannot be substituted or freshened', () => {
  const a = approval(); assert.equal(assertSuccessorAttestationProtectedReview(a, protectedReview(a), now), true);
  for (const mutate of [r => { r.approvals = []; }, r => { r.approvals.push(r.approvals[0]); },
    r => { r.approvals[0].user.id++; }, r => { r.approvals[0].environments[0].id++; }, r => { r.approvals[0].state = 'rejected'; },
    r => { r.jobs[0].run_attempt = 2; }, r => { r.jobs[0].status = 'completed'; }, r => { r.jobs[0].id++; },
    r => { r.jobs[0].started_at = new Date(now - 1).toISOString(); }, r => { r.run.run_started_at = new Date(now - 1).toISOString(); }]) {
    const changed = protectedReview(a); mutate(changed); assert.throws(() => assertSuccessorAttestationProtectedReview(a, changed, now));
  }
  assert.throws(() => assertSuccessorAttestationProtectedReview(a, protectedReview(a), now + 1800000));
});
function response(body, changes = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  return { status: 200, redirected: false, url: 'https://api.vercel.com/v5/user/tokens/OFFLINE_EXISTING_TOKEN',
    headers: { get: () => 'application/json' }, body: { getReader: () => { let sent = false; return {
      async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; }, async cancel() {} }; } }, ...changes };
}
test('metadata helper makes only one bounded fixed token-ID GET after caller chooses to invoke it', async () => {
  let calls = 0;
  const m = await readSuccessorEnrollmentTokenMetadata({ tokenId: 'OFFLINE_EXISTING_TOKEN', token: 'OFFLINE_METADATA_READER',
    fetchImpl: async (url, options) => { calls++; assert.equal(url, 'https://api.vercel.com/v5/user/tokens/OFFLINE_EXISTING_TOKEN');
      assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
      assert.equal(options.body, undefined); return response({ token: tokenMetadata() }); } });
  assert.equal(m.id, 'OFFLINE_EXISTING_TOKEN'); assert.equal(calls, 1);
  for (const tokenId of ['current', '../foreign', '', 'x'.repeat(201)]) {
    await assert.rejects(() => readSuccessorEnrollmentTokenMetadata({ tokenId, token: 'OFFLINE', fetchImpl() { calls++; } }));
  }
  assert.equal(calls, 1);
});
test('wrong ID, redirects, 403, malformed/oversized responses and arbitrary private exception access are suppressed', async () => {
  for (const value of [response({ token: { id: 'WRONG' } }), response({ token: tokenMetadata() }, { redirected: true }),
    response({ token: tokenMetadata() }, { status: 403 }), response({ token: tokenMetadata() }, { url: 'https://evil.example' }),
    response({ token: tokenMetadata() }, { headers: { get: () => 'text/plain' } }), response({ token: tokenMetadata() },
      { body: { getReader: () => ({ async read() { return { done: false, value: Buffer.alloc(1024 * 1024 + 1) }; }, async cancel() {} }) } })]) {
    await assert.rejects(() => readSuccessorEnrollmentTokenMetadata({ tokenId: 'OFFLINE_EXISTING_TOKEN', token: 'OFFLINE', fetchImpl: async () => value }),
      error => !error.message.includes('OFFLINE'));
  }
  let accesses = 0;
  const privateError = new Proxy({}, { get() { accesses++; throw Error('PRIVATE_MARKER'); } });
  await assert.rejects(() => readSuccessorEnrollmentTokenMetadata({ tokenId: 'OFFLINE_EXISTING_TOKEN', token: 'OFFLINE', fetchImpl: async () => { throw privateError; } }));
  assert.equal(accesses, 0);
});
test('committed control closure includes native ledger and dedicated source; historical enrollment bytes stay exact', () => {
  for (const path of ['scripts/preview-vercel-successor-attest.mjs', 'scripts/lib/preview-vercel-successor-attestation.mjs',
    'scripts/lib/preview-vercel-successor-attestation-ledger.py', 'scripts/fcos-keychain-migrate.swift', 'config/fcosConnections.js']) {
    assert.ok(PREVIEW_EMAIL_BUILD_CONTROL_FILES.includes(path), path);
  }
  const source = readFileSync('scripts/lib/preview-vercel-successor-attestation.mjs', 'utf8');
  assert.ok(source.includes("GH_CONFIG_DIR: `${PRIMARY}/.fcos-cli/github`"));
  assert.ok(!source.includes("from '../preview-vercel-enrollment.mjs'"));
  for (const forbidden of ['keychainSet:', 'secretSet:', 'variableSet:', 'runEnrollmentOperation(', 'createPrivateEnrollment(', "'set-stdin'"])
    assert.ok(!source.includes(forbidden), forbidden);
  const historical = spawnSync('/usr/bin/git', ['diff', '--exit-code', '--', 'scripts/preview-vercel-enrollment.mjs', 'scripts/lib/preview-vercel-enrollment.mjs'], { encoding: 'utf8' });
  assert.equal(historical.status, 0); assert.equal(historical.stdout, '');
});

// Evaluate exact checked-in control-flow bodies with inert, temporary adapters.
// These fixture functions are separate from module-private production identity
// maps; they cannot mint a live admission, read credentials or write providers.
function bodyFixture(path, start, end, dependencies) {
  const source = readFileSync(path, 'utf8'), from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0);
  const body = source.slice(from, to < 0 ? source.length : to);
  assert.ok(body.length > 100);
  const name = /(?:async )?function ([A-Za-z0-9_]+)/.exec(start)[1];
  return new Function(...Object.keys(dependencies), `${body.replace(/^export /, '')}\nreturn ${name};`)(...Object.values(dependencies));
}
function waitFixture({ missing = 2, old = true, deadlineAge = 0, badSignature = false, verificationOnly = false, matchingPendingReceipt = false } = {}) {
  let clock = now, reads = 0, verifications = 0, sleeps = 0;
  const a = approval(), operation = verificationOnly ? 'verify-authority' : 'create', context = { runId: a.runId, operation };
  const selected = { contractSha256: a.contractSha256, capturedAt: new Date(now).toISOString(), context: { provisionedAt: new Date(now - deadlineAge).toISOString() },
    dispatchedAt: a.dispatchedAt, reviewedAt: { root: new Date(now - 1000).toISOString(), independent: new Date(now - 1000).toISOString() } };
  const oldVariables = { contractPin: undefined, authorityEnvelope: old ? JSON.stringify({ receipt: { context: matchingPendingReceipt ? context : { ...context, runId: 1 } } }) : undefined };
  const currentVariables = { contractPin: a.contractSha256, authorityEnvelope: JSON.stringify({ receipt: { context } }) };
  const fn = bodyFixture('scripts/lib/preview-email-build.mjs', 'export async function waitForPreviewEmailAttestation', '\nexport function previewEmailBuildDeployment', {
    successorLiveSelection(admission, candidate, at) { assert.equal(candidate, a.candidateSha); assert.equal(admission, selected); return selected; },
    successorLiveExecutionDeadline(admission) { assert.equal(admission, selected); return Math.min(Date.parse(selected.context.provisionedAt) + 2700000, ...[selected.dispatchedAt, ...Object.values(selected.reviewedAt)].map(t => Date.parse(t) + 1800000)); },
    successorVerificationSelection(admission, candidate, at) { assert.equal(candidate, a.candidateSha); assert.equal(admission, selected); return selected; },
    SUCCESSOR_LIVE_CONTRACT, isDurableSuccessorSetup, previewEmailProtectionData(p) { return { authorityMode: 'issuance-bound-v1', environmentId: 20,
      contractPinReady: !verificationOnly || p.variables.contractPin === a.contractSha256, runId: a.runId, reviewedTokenId: a.tokenId, enrollmentId: a.enrollmentId, authorityEnvelope: p.variables.authorityEnvelope }; },
    ENROLLED_AUTHORITY_MODE: 'issuance-bound-v1', enrolledAuthorityContext: value => ({ runId: value.runId, operation: value.operation }),
    equal: (left, right) => JSON.stringify(left) === JSON.stringify(right), failure: message => { throw Error(message); },
    verifyEnrollmentReceipt(value) { verifications++; assert.equal(value.enrollmentId, a.enrollmentId);
      assert.equal(value.reviewedTokenId, a.tokenId); assert.deepEqual(value.context, context); if (badSignature) throw Error('Pinned signature refused'); },
  });
  return { run: () => fn({ protection: { admission: selected, candidateSha: a.candidateSha, repository: { id: 10 }, harnessSha: a.harnessSha,
    controlRevision: a.controlRevision, variables: oldVariables, jobs: [{ started_at: a.jobStartedAt }], oidcClaims: { exp: (now + 1000000) / 1000 } },
    operation, privateEnrollment: 'OFFLINE_CAPSULE', token: 'OFFLINE_BEARER', now: () => clock,
    sleep: async ms => { assert.ok(ms > 0 && ms <= 10000); sleeps++; clock += ms; },
    readVariables: async () => { reads++; return reads >= missing ? currentVariables : { ...oldVariables, contractPin: 'f'.repeat(64) }; } }),
    observed: () => ({ reads, verifications, sleeps, clock }), currentVariables };
}
test('bounded hosted handoff waits for delayed exact run receipt; a prior run receipt never authorizes', async () => {
  const fixture = waitFixture(); assert.deepEqual(await fixture.run(), fixture.currentVariables);
  assert.deepEqual(fixture.observed(), { reads: 2, verifications: 1, sleeps: 2, clock: now + 20000 });
});
test('verification-only hosted handoff accepts delayed current contract plus exact signed receipt within original bounds', async () => {
  const fixture = waitFixture({ verificationOnly: true });
  assert.deepEqual(await fixture.run(), fixture.currentVariables);
  assert.deepEqual(fixture.observed(), { reads: 2, verifications: 1, sleeps: 2, clock: now + 20000 });
  const wrongContract = waitFixture({ verificationOnly: true, matchingPendingReceipt: true, missing: 100 });
  await assert.rejects(() => wrongContract.run(), /expired/);
  assert.equal(wrongContract.observed().verifications, 0); assert.equal(wrongContract.observed().clock, now + 600000);
});
test('handoff preserves original provisioning expiry and refuses delayed or invalid receipt without renewal', async () => {
  const expired = waitFixture({ missing: 100, deadlineAge: 2699000 });
  await assert.rejects(() => expired.run(), /expired/);
  assert.deepEqual(expired.observed(), { reads: 0, verifications: 0, sleeps: 1, clock: now + 1000 });
  const wrong = waitFixture({ badSignature: true }); await assert.rejects(() => wrong.run(), /signature refused/);
  assert.equal(wrong.observed().verifications, 1);
});
test('actual hosted handoff refuses cloned admissions before polling or any adapter getter', async () => {
  const { waitForPreviewEmailAttestation } = await import('../scripts/lib/preview-email-build.mjs'); let accesses = 0;
  const input = { protection: { admission: { accepted: true }, candidateSha: SUCCESSOR_LIVE_CONTRACT.candidateSha }, now: () => now };
  for (const key of ['readVariables', 'sleep', 'privateEnrollment', 'token']) Object.defineProperty(input, key,
    { get() { accesses++; throw Error('Forbidden adapter property'); } });
  await assert.rejects(() => waitForPreviewEmailAttestation(input)); assert.equal(accesses, 0);
});
test('fixed native execution consumes before private reads and performs only the one exact nonsecret receipt write', async t => {
  const a = approval(), original = { action: { approval: a, text: 'OFFLINE_ORIGINAL_ACTION' }, state: state(a),
    public: { repositoryId: 10, environmentId: 20, priorReceiptSha256: null },
    admission: { context: { provisionedAt: new Date(now - 1000).toISOString() }, dispatchedAt: a.dispatchedAt,
      reviewedAt: { root: new Date(now - 1000).toISOString(), independent: new Date(now - 1000).toISOString() } } };
  const events = [], writes = []; let submitted;
  const envelope = { receipt: { context: { runId: a.runId }, expiresAt: now + 500000 }, signature: 'OFFLINE_NONPRIVATE_SIGNATURE' };
  const deps = {
    claimPublication(value) { assert.equal(value, original); events.push('consume'); return Object.freeze({}); },
    assertOriginalCurrent(left, right) { assert.equal(left, original); assert.equal(right, original); events.push('current'); },
    collectActual: async () => original, assertClaimCurrent() { events.push('lease'); },
    nativePhase: async (identity, phase, operation) => { events.push(phase); return operation(); },
    diagnostic: (identity, phase, status) => { assert.equal(status, 'started'); events.push(phase); },
    bindNativeDiagnostics: () => { assert.ok(events.includes('consume')); events.push('bound'); },
    fixedInstalledReader: () => { assert.ok(events.includes('consume')); return '/OFFLINE_PINNED_READER'; },
    command(binary, args, input) {
      if (args[0] === 'get') {
        assert.equal(binary, '/OFFLINE_PINNED_READER');
        assert.ok(events.includes('private_io_started')); events.push(`private:${args[2]}`);
        if (args[2] === 'capsule-service') return JSON.stringify(capsule(a));
        if (args[2] === 'key-service') return 'OFFLINE_KEY';
        if (args[2] === 'reader-service') return 'OFFLINE_READER';
        assert.fail('No other private service permitted');
      }
      assert.equal(binary, '/OFFLINE_GH');
      if (args.includes('POST') || args.includes('PATCH')) {
        assert.ok(events.includes('publication_started'));
        writes.push({ args, body: JSON.parse(input) }); submitted = JSON.parse(input).value; return '{}';
      }
      assert.ok(args.includes('GET'));
      if (args.at(-1).endsWith('/variables?per_page=100')) return JSON.stringify({ total_count: 0, variables: [] });
      if (args.at(-1).endsWith('/secrets?per_page=100')) return JSON.stringify({ total_count: 6, secrets: a.secretMetadata });
      return JSON.stringify({ name: 'FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT', value: submitted });
    },
    assertSuccessorAttestationEnrollment: (a, s, c, m) => assertSuccessorAttestationEnrollment(a, s, c, m, now),
    assertSuccessorAttestationPinnedKey: () => { events.push('key-pin'); },
    FCOS_CONNECTION_POLICY: { keychainAccount: 'OFFLINE_ACCOUNT', attestation: { privateKeyService: 'key-service' },
      providers: [{ id: 'vercel', keychainService: 'reader-service' }] }, ENROLLMENT_KEYCHAIN_SERVICE: 'capsule-service',
    fail: () => { throw Error('Inert native fixture refused'); }, retainedProduction: async () => { events.push('retained-production'); },
    readSuccessorEnrollmentTokenMetadata: async () => { events.push('metadata'); assert.ok(events.includes('key-pin')); return tokenMetadata(a); },
    NATIVE_FETCH: () => assert.fail('No fetch in inert harness'), Date: { now: () => now, parse: Date.parse },
    receiptDeadline: bodyFixture('scripts/lib/preview-vercel-successor-attestation.mjs', 'function receiptDeadline',
      '\nasync function executeFixed', { Date, durableSuccessorSetupDeadline }),
    readExistingEnrollment: () => state(a), enrolledAuthorityContext: value => value,
    signEnrollmentReceipt(value) { events.push('sign'); assert.ok(events.includes('metadata')); assert.equal(value.now, now); return envelope; },
    ENROLLED_AUTHORITY_RECEIPT: 'FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT', ENVIRONMENT: '/OFFLINE_EXACT_ENVIRONMENT', GH: '/OFFLINE_GH',
    collection: (value, key) => value[key], variable: (rows, name) => rows.find(row => row.name === name)?.value,
    successorAttestationHash: value => value === undefined ? '' : 'a'.repeat(64), actionAdmission: () => original.action,
    bindSuccessorAttestationAdmission: () => {}, successorAttestationSecretMetadata, same: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    requireSuccessorAttestationPublicationAdmission: () => ({ lease: { leaseId: nonce } }),
  };
  const execute = bodyFixture('scripts/lib/preview-vercel-successor-attestation.mjs', 'async function executeFixed', '\nexport async function runFixedSuccessorAttestation', deps);
  const result = await execute(original);
  assert.equal(result.attested, true); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args, ['api', '--method', 'POST', '/OFFLINE_EXACT_ENVIRONMENT/variables', '--input', '-']);
  assert.deepEqual(writes[0].body, { name: 'FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT', value: JSON.stringify(envelope) });
  assert.ok(events.indexOf('consume') < events.findIndex(row => row.startsWith('private:')));
  assert.ok(events.indexOf('key-pin') < events.indexOf('metadata')); assert.ok(events.indexOf('metadata') < events.indexOf('sign'));
  const uncertain = { ...deps, command(binary, args, input) {
    if (args.includes('POST')) { writes.push('uncertain-once'); throw new Proxy({}, { get() { assert.fail('No private exception inspection'); } }); }
    return deps.command(binary, args, input);
  } };
  const executeUncertain = bodyFixture('scripts/lib/preview-vercel-successor-attestation.mjs', 'async function executeFixed', '\nexport async function runFixedSuccessorAttestation', uncertain);
  let failed = false; try { await executeUncertain(original); } catch { failed = true; }
  assert.equal(failed, true);
  assert.equal(writes.filter(row => row === 'uncertain-once').length, 1);
  assert.ok(!events.includes('compile'));
  let clock = now;
  const stale = { ...deps, Date: { now: () => clock, parse: Date.parse }, command(binary, args, input) {
    const value = deps.command(binary, args, input);
    if (args[0] === 'get' && args[2] === 'key-service') clock = a.privateReadinessAt + 2700000;
    return value;
  }, assertOriginalCurrent() { assertSuccessorAttestationApproval({ approval: a, nonce, scriptSha256, now: clock }); } };
  const executeStale = bodyFixture('scripts/lib/preview-vercel-successor-attestation.mjs', 'async function executeFixed', '\nexport async function runFixedSuccessorAttestation', stale);
  const priorWrites = writes.length, priorMetadata = events.filter(row => row === 'metadata').length;
  await assert.rejects(() => executeStale(original));
  assert.equal(writes.length, priorWrites); assert.equal(events.filter(row => row === 'metadata').length, priorMetadata);
  await t.test('publication marker latency reaching exact receipt expiry submits zero writes and never retries', async () => {
    for (const delayedMarker of ['publication_started', 'receipt_publication']) {
      let publicationClock = now, mutationAttempts = 0, publicationStarts = 0;
      const beforeEvents = events.length, beforeWrites = writes.length;
      const expiresDuringMarker = { ...deps, Date: { now: () => publicationClock, parse: Date.parse },
        diagnostic(identity, phase, status) {
          deps.diagnostic(identity, phase, status);
          if (phase === delayedMarker) publicationClock = envelope.receipt.expiresAt;
        },
        nativePhase(identity, phase, operation) {
          if (phase === 'receipt_publication') publicationStarts++;
          if (phase === delayedMarker) publicationClock = envelope.receipt.expiresAt;
          return deps.nativePhase(identity, phase, operation);
        },
        command(binary, args, input) {
          if (args.includes('POST') || args.includes('PATCH')) mutationAttempts++;
          return deps.command(binary, args, input);
        } };
      const executeExpired = bodyFixture('scripts/lib/preview-vercel-successor-attestation.mjs', 'async function executeFixed', '\nexport async function runFixedSuccessorAttestation', expiresDuringMarker);
      await assert.rejects(() => executeExpired(original));
      assert.equal(publicationClock, envelope.receipt.expiresAt);
      assert.equal(mutationAttempts, 0); assert.equal(writes.length, beforeWrites);
      assert.equal(publicationStarts, 1);
      const attemptEvents = events.slice(beforeEvents);
      assert.equal(attemptEvents.filter(row => row === 'consume').length, 1);
      assert.equal(attemptEvents.filter(row => row === 'publication_started').length, 1);
      assert.ok(attemptEvents.includes('publication_preflight')); assert.ok(!attemptEvents.includes('receipt_readback'));
    }
  });
  const consumed = { ...deps, claimPublication() { throw Error('Permanently consumed fixture nonce'); } };
  const replay = bodyFixture('scripts/lib/preview-vercel-successor-attestation.mjs', 'async function executeFixed', '\nexport async function runFixedSuccessorAttestation', consumed);
  const privateReads = events.filter(row => row.startsWith('private:')).length;
  await assert.rejects(() => replay(original));
  assert.equal(events.filter(row => row.startsWith('private:')).length, privateReads); assert.equal(writes.length, priorWrites);
});

const attestorSourcePath = 'scripts/lib/preview-vercel-successor-attestation.mjs';
function setDeclaration(name) {
  const source = readFileSync(attestorSourcePath, 'utf8'), start = source.indexOf(`const ${name} = new Set(`);
  assert.ok(start > 0);
  return new Function(`${source.slice(start, source.indexOf(';', start) + 1)} return ${name};`)();
}
function nativeBoundaryFixture(t, { spawn = () => assert.fail('No process may run in file fixture') } = {}) {
  // Disposable owned workspace paths let the real parent, fd, inode, hash and
  // journal checks run unchanged. No production reader or credential is read.
  const directory = realpathSync(mkdtempSync(join(process.cwd(), '.attestor-native-test-')));
  chmodSync(directory, 0o700); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stderr = [], durability = [], diagnosticStates = new WeakMap(); let monotonic = 100;
  const dependencies = { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync,
    appendFileSync, fsyncSync(fd) { fsyncSync(fd); durability.push('fsync'); }, join, resolve,
    process: { getuid: () => process.getuid(), stderr: { write(value) { stderr.push(value); durability.push('stderr'); } } },
    performance: { now: () => monotonic++ }, successorAttestationHash, successorAttestationCommandStatus,
    diagnosticStates, DIAGNOSTIC_PHASES: setDeclaration('DIAGNOSTIC_PHASES'), COMMAND_SIGNALS: setDeclaration('COMMAND_SIGNALS'),
    fail: () => { throw Error('Private diagnostics suppressed'); }, uuid: value => value === nonce,
    sha: value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value),
    hash: value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    exact: (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)),
    freeze: value => Object.freeze(value), same: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    actualProjection: value => value.projection, requireSuccessorAttestationPublicationAdmission,
    APPROVALS: directory, ROOT: directory, ENV: {}, spawnSync: spawn };
  const load = (start, end) => bodyFixture(attestorSourcePath, start, end, dependencies);
  dependencies.assertNativeParents = load('function assertNativeParents', '\nfunction assertPinnedReaderFile');
  dependencies.assertPinnedReaderFile = load('function assertPinnedReaderFile', '\nfunction fixedInstalledReader');
  dependencies.createNativeDiagnostics = load('function createNativeDiagnostics', '\nfunction diagnostic');
  dependencies.diagnosticBinding = load('function diagnosticBinding', '\nfunction bindNativeDiagnostics');
  dependencies.bindNativeDiagnostics = load('function bindNativeDiagnostics', '\nfunction diagnostic(');
  dependencies.diagnostic = load('function diagnostic(', '\nasync function nativePhase');
  dependencies.nativePhase = load('async function nativePhase', '\nfunction closeNativeDiagnostics');
  dependencies.closeNativeDiagnostics = load('function closeNativeDiagnostics', '\nfunction command');
  dependencies.command = load('function command(', '\nfunction ownedRead');
  return { directory, stderr, durability, dependencies, load,
    rows: () => readFileSync(join(directory, `diagnostic-${nonce}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse) };
}
test('installed reader checks reject changed bytes, noncanonical paths, symlinks, hardlinks, modes and ownership', t => {
  const f = nativeBoundaryFixture(t), binary = join(f.directory, 'reader'), source = join(f.directory, 'source.swift');
  const binaryBytes = 'INERT PUBLIC READER FIXTURE', sourceBytes = 'INERT PUBLIC SOURCE FIXTURE';
  writeFileSync(binary, binaryBytes, { mode: 0o700 }); writeFileSync(source, sourceBytes, { mode: 0o644 });
  const verify = f.dependencies.assertPinnedReaderFile, expected = successorAttestationHash(binaryBytes);
  assert.equal(verify(binary, expected, 0o700, 1024), undefined);
  for (const mode of [0o600, 0o755, 0o770, 0o1700]) {
    chmodSync(binary, mode); assert.throws(() => verify(binary, expected, 0o700, 1024));
  }
  chmodSync(binary, 0o700);
  assert.throws(() => verify(binary, '0'.repeat(64), 0o700, 1024));
  assert.throws(() => verify(binary, expected, 0o700, 1));
  assert.throws(() => verify(`${f.directory}/../${f.directory.split('/').at(-1)}/reader`, expected, 0o700, 1024));
  const link = join(f.directory, 'link'); linkSync(binary, link);
  assert.throws(() => verify(binary, expected, 0o700, 1024)); unlinkSync(link);
  symlinkSync(binary, link); assert.throws(() => verify(link, expected, 0o700, 1024)); unlinkSync(link);
  const parentLink = join(f.directory, 'parent-link'); symlinkSync(f.directory, parentLink);
  assert.throws(() => verify(join(parentLink, 'reader'), expected, 0o700, 1024)); unlinkSync(parentLink);
  const wrongOwner = bodyFixture(attestorSourcePath, 'function assertPinnedReaderFile', '\nfunction fixedInstalledReader', {
    ...f.dependencies, fstatSync: fd => ({ ...fstatSync(fd), isFile: () => true, uid: process.getuid() + 1 }) });
  assert.throws(() => wrongOwner(binary, expected, 0o700, 1024));
  // This filesystem strips setuid from disposable files; inject only that
  // kernel stat bit to exercise the exact production mode rejection.
  const setuid = bodyFixture(attestorSourcePath, 'function assertPinnedReaderFile', '\nfunction fixedInstalledReader', {
    ...f.dependencies, fstatSync: fd => ({ ...fstatSync(fd), isFile: () => true, mode: fstatSync(fd).mode | 0o4000 }) });
  assert.throws(() => setuid(binary, expected, 0o700, 1024));
  chmodSync(f.directory, 0o777); assert.throws(() => verify(binary, expected, 0o700, 1024)); chmodSync(f.directory, 0o700);
  const foreignParent = bodyFixture(attestorSourcePath, 'function assertNativeParents', '\nfunction assertPinnedReaderFile', {
    ...f.dependencies, lstatSync: path => path === f.directory ? { ...lstatSync(path), isDirectory: () => true,
      isSymbolicLink: () => false, uid: process.getuid() + 1 } : lstatSync(path) });
  assert.throws(() => foreignParent(binary));
  const admitted = Object.freeze({}); let grants = 0;
  const installed = bodyFixture(attestorSourcePath, 'function fixedInstalledReader', '\nfunction createNativeDiagnostics', {
    ...f.dependencies, KEYCHAIN_READER: binary, KEYCHAIN_READER_SHA256: expected, KEYCHAIN_SOURCE: source,
    KEYCHAIN_SOURCE_SHA256: successorAttestationHash(sourceBytes),
    requireSuccessorAttestationPublicationAdmission(value) { assert.equal(value, admitted); grants++; } });
  assert.throws(() => installed(structuredClone(admitted))); assert.equal(grants, 0);
  assert.equal(installed(admitted), binary); assert.equal(grants, 1);
  writeFileSync(source, 'ALTERED PUBLIC SOURCE'); assert.throws(() => installed(admitted));
});
test('canonical root-owned Linux ancestors are accepted while foreign-owned or writable ancestors deny', () => {
  const inspected = [], path = '/home/runner/work/fcos/reader';
  let changedPath, changedOwner, changedMode;
  const check = bodyFixture(attestorSourcePath, 'function assertNativeParents', '\nfunction assertPinnedReaderFile', {
    resolve, process: { getuid: () => 1001 }, realpathSync: value => value,
    lstatSync(value) {
      inspected.push(value);
      return { isDirectory: () => true, isSymbolicLink: () => false,
        uid: value === changedPath ? changedOwner : ['/', '/home'].includes(value) ? 0 : 1001,
        mode: value === changedPath ? changedMode : 0o755 };
    }, fail: () => { throw Error('Unsafe ancestor denied'); } });
  assert.equal(check(path), undefined);
  assert.deepEqual(inspected, ['/home/runner/work/fcos', '/home/runner/work', '/home/runner', '/home', '/']);
  for (const [parent, owner, mode] of [['/home', 1002, 0o755], ['/home', 0, 0o775], ['/', 0, 0o777]]) {
    changedPath = parent; changedOwner = owner; changedMode = mode;
    assert.throws(() => check(path));
  }
});
test('durable fixed diagnostics precede operations and redact command output, arguments and arbitrary exceptions', async t => {
  let commandResult = { status: 0, signal: null, stdout: 'PRIVATE_OUTPUT_MARKER', stderr: 'PRIVATE_ERROR_MARKER' }, thrown, accesses = 0;
  const f = nativeBoundaryFixture(t, { spawn: () => { if (thrown) throw thrown; return commandResult; } });
  const d = f.dependencies.createNativeDiagnostics(nonce); t.after(() => f.dependencies.closeNativeDiagnostics(d));
  const { diagnostic, nativePhase, command } = f.dependencies;
  diagnostic(d, 'private_io_started', 'started');
  await nativePhase(d, 'capsule_read', () => {
    assert.ok(f.rows().some(row => row.phase === 'private_io_started' && row.status === 'started'));
    assert.equal(f.durability.at(-2), 'fsync');
    return command('/PRIVATE_PATH_MARKER', ['PRIVATE_ACCOUNT_MARKER', 'PRIVATE_SERVICE_MARKER'], 'PRIVATE_INPUT_MARKER', 30000, d);
  });
  diagnostic(d, 'publication_started', 'started');
  await nativePhase(d, 'receipt_publication', () => {
    assert.ok(f.rows().some(row => row.phase === 'publication_started' && row.status === 'started'));
    assert.equal(f.durability.at(-2), 'fsync');
    return command('/PRIVATE_PATH_MARKER', ['PRIVATE_PUBLICATION_ARGUMENT'], 'PRIVATE_PUBLICATION_BODY', 30000, d);
  });
  for (const [result, expected] of [
    [{ status: 2, signal: null }, { exitCode: 2, signal: null, timedOut: false }],
    [{ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'PRIVATE_EXCEPTION_MARKER' } },
      { exitCode: null, signal: 'SIGTERM', timedOut: true }],
    [{ status: null, signal: 'SIGKILL' }, { exitCode: null, signal: 'SIGKILL', timedOut: false }],
  ]) {
    commandResult = { ...result, stdout: 'PRIVATE_OUTPUT_MARKER', stderr: 'PRIVATE_ERROR_MARKER' };
    await assert.rejects(() => nativePhase(d, 'key_read', () => command('/PRIVATE_PATH_MARKER', [], undefined, 30000, d)));
    assert.deepEqual(f.rows().filter(row => row.status === 'command_completed').at(-1).command, expected);
  }
  thrown = new Proxy({}, { get() { accesses++; throw Error('PRIVATE_GETTER_MARKER'); } });
  await assert.rejects(() => nativePhase(d, 'metadata_read', () => command('/PRIVATE_PATH_MARKER', [], undefined, 30000, d)));
  assert.equal(accesses, 0);
  assert.throws(() => diagnostic(d, 'PRIVATE_PHASE_MARKER', 'started'));
  assert.throws(() => successorAttestationCommandStatus(1, 'PRIVATE_SIGNAL_MARKER', false));
  assert.throws(() => successorAttestationCommandStatus({ secret: 'PRIVATE_STATUS_MARKER' }, null, false));
  const rows = f.rows();
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ['schemaVersion', 'kind', 'phase', 'status', 'elapsedMs',
      ...(row.binding ? ['binding'] : []), ...(row.command ? ['command'] : [])]);
    assert.ok(Number.isSafeInteger(row.elapsedMs) && row.elapsedMs >= 0); assert.equal(row.capturedAt, undefined);
  }
  assert.ok(!JSON.stringify(rows).includes('PRIVATE_')); assert.ok(!f.stderr.join('').includes('PRIVATE_'));
  assert.deepEqual(f.stderr.map(JSON.parse), rows);
});
test('durable markers bind immutable native admission and canonical claim without accepting caller DTOs', t => {
  const f = nativeBoundaryFixture(t), d = f.dependencies.createNativeDiagnostics(nonce);
  t.after(() => f.dependencies.closeNativeDiagnostics(d));
  const original = { action: { approval: { nonce, harnessSha: 'a'.repeat(40) }, text: 'PUBLIC ORIGINAL ACTION',
    sha256: successorAttestationHash('PUBLIC ORIGINAL ACTION') }, projection: { actionSha256: successorAttestationHash('PUBLIC ORIGINAL ACTION') } };
  f.dependencies.diagnostic(d, 'admission', 'started');
  assert.equal(f.rows()[0].binding, undefined);
  f.dependencies.bindNativeDiagnostics(d, original);
  f.dependencies.diagnostic(d, 'admission', 'passed');
  const base = { nonce, harnessSha: original.action.approval.harnessSha, approvalSha256: original.action.sha256 };
  assert.deepEqual(f.rows().at(-1).binding, base);
  assert.ok(Object.isFrozen(f.dependencies.diagnosticStates.get(d).binding));
  const claimed = Object.freeze({ actual: original.projection, consumptionSha256: 'c'.repeat(64), lease: Object.freeze({ leaseId: nonce }) });
  for (const dto of [{}, structuredClone(claimed), { leaseAccepted: true }])
    assert.throws(() => f.dependencies.bindNativeDiagnostics(d, original, dto));
  assert.deepEqual(f.dependencies.diagnosticStates.get(d).binding, base);
  const identity = Object.freeze({}), admissions = new WeakMap([[identity, claimed]]);
  const bind = bodyFixture(attestorSourcePath, 'function bindNativeDiagnostics', '\nfunction diagnostic(', {
    ...f.dependencies, requireSuccessorAttestationPublicationAdmission(value) { assert.ok(admissions.has(value)); return admissions.get(value); } });
  bind(d, original, identity);
  for (const phase of ['private_io_started', 'publication_started']) f.dependencies.diagnostic(d, phase, 'started');
  const expected = { ...base, consumptionSha256: claimed.consumptionSha256, leaseId: nonce };
  assert.deepEqual(f.rows().slice(-2).map(row => row.binding), [expected, expected]);
  assert.ok(Object.isFrozen(f.dependencies.diagnosticStates.get(d).binding));
  assert.throws(() => bind(d, { ...original, action: { ...original.action, text: 'CHANGED PUBLIC ACTION' } }, identity));
  const before = readFileSync(join(f.directory, `diagnostic-${nonce}.jsonl`), 'utf8');
  f.dependencies.diagnosticStates.get(d).binding = { ...expected, privateOutput: 'PRIVATE_BINDING_MARKER' };
  assert.throws(() => f.dependencies.diagnostic(d, 'publication_started', 'started'));
  assert.equal(readFileSync(join(f.directory, `diagnostic-${nonce}.jsonl`), 'utf8'), before);
  assert.ok(!f.stderr.join('').includes('PRIVATE_'));
});
test('a replaced or unsafe diagnostic file fails closed before its guarded operation', async t => {
  const f = nativeBoundaryFixture(t), d = f.dependencies.createNativeDiagnostics(nonce);
  t.after(() => f.dependencies.closeNativeDiagnostics(d));
  const path = join(f.directory, `diagnostic-${nonce}.jsonl`); let operations = 0;
  const invoke = () => f.dependencies.nativePhase(d, 'capsule_read', () => { operations++; });
  chmodSync(path, 0o644); await assert.rejects(invoke); chmodSync(path, 0o600);
  const link = join(f.directory, 'linked-journal'); linkSync(path, link); await assert.rejects(invoke); unlinkSync(link);
  unlinkSync(path); writeFileSync(path, '{"accepted":true}', { mode: 0o600 }); await assert.rejects(invoke);
  assert.equal(operations, 0); assert.equal(f.stderr.length, 0);
});
test('native denial and hostile journals grant no collection, private capability, publication or replay authority', async t => {
  const f = nativeBoundaryFixture(t), ENTRY = join(f.directory, 'attestor.mjs'); let collected = 0, executed = 0, opened = 0;
  const dependencies = { ...f.dependencies, ENTRY, process: { platform: 'darwin', env: {}, execArgv: [], argv: ['node', ENTRY] },
    uuid: value => value === nonce, createNativeDiagnostics(value) { opened++; return f.dependencies.createNativeDiagnostics(value); },
    collectActual() { collected++; throw Error('PRIVATE_ADMISSION_MARKER'); },
    executeFixed() { executed++; assert.fail('No private capability permitted'); }, actualProjection: value => value };
  const native = bodyFixture(attestorSourcePath, 'export async function runFixedSuccessorAttestation', '\nNATIVE_FIXTURE_END', dependencies);
  for (const args of [[], ['--attest-approved', 'invalid'], ['--foreign', nonce], ['--attest-approved', nonce, 'extra']])
    await assert.rejects(() => native(args));
  assert.equal(opened, 0); assert.equal(collected, 0); assert.equal(executed, 0);
  await assert.rejects(() => runFixedSuccessorAttestation(['--attest-approved', nonce]));
  const journalPath = join(f.directory, `diagnostic-${nonce}.jsonl`);
  for (const text of ['{malformed', JSON.stringify({ accepted: true, private_io_started: true, publication_started: true,
    leaseAccepted: true, replayForbidden: false })]) {
    writeFileSync(journalPath, text, { mode: 0o600 });
    await assert.rejects(() => native(['--attest-approved', nonce]));
    assert.equal(readFileSync(journalPath, 'utf8'), text); assert.equal(collected, 0); assert.equal(executed, 0);
    unlinkSync(journalPath);
  }
  const target = join(f.directory, 'untrusted-journal'); writeFileSync(target, 'PRIVATE_JOURNAL_MARKER', { mode: 0o600 });
  symlinkSync(target, journalPath); await assert.rejects(() => native(['--attest-approved', nonce])); unlinkSync(journalPath);
  await assert.rejects(() => native(['--attest-approved', nonce]));
  assert.equal(collected, 1); assert.equal(executed, 0);
  assert.deepEqual(f.rows().map(row => [row.phase, row.status]), [['admission', 'started'], ['admission', 'failed']]);
  await assert.rejects(() => native(['--attest-approved', nonce])); assert.equal(collected, 1); assert.equal(executed, 0);
  assert.ok(!f.stderr.join('').includes('PRIVATE_'));
});
test('native validation retains GET-only behavior and private helpers are not exported capabilities', async t => {
  const f = nativeBoundaryFixture(t), ENTRY = join(f.directory, 'attestor.mjs'); let collected = 0;
  const native = bodyFixture(attestorSourcePath, 'export async function runFixedSuccessorAttestation', '\nNATIVE_FIXTURE_END', {
    ...f.dependencies, ENTRY, process: { platform: 'darwin', env: {}, execArgv: [], argv: ['node', ENTRY] },
    uuid: value => value === nonce, collectActual() { collected++; return { unchanged: true }; }, actualProjection: value => value,
    createNativeDiagnostics() { assert.fail('No journal write permitted for validation'); },
    executeFixed() { assert.fail('No canonical claim, signing or provider mutation permitted for validation'); } });
  assert.deepEqual(await native(['--validate-ledger-admission', nonce]), {
    kind: 'fcos_actual_successor_attestation_ledger_admission', nonce, actual: { unchanged: true } });
  assert.equal(collected, 1);
  const module = await import('../scripts/lib/preview-vercel-successor-attestation.mjs');
  for (const name of ['fixedInstalledReader', 'command', 'executeFixed', 'claimPublication', 'createNativeDiagnostics', 'diagnostic', 'bindNativeDiagnostics'])
    assert.equal(Object.hasOwn(module, name), false);
});

function publicPreflightFixture() {
  const a = approval(), time = Date.now(), base = `repos/${a.target.repository}`;
  a.authorizedAt = time - 1000; a.privateReadinessAt = time - 2000;
  a.dispatchedAt = new Date(time - 15000).toISOString(); a.jobStartedAt = new Date(time - 10000).toISOString();
  const state = protectedReview(a), calls = [];
  Object.assign(state.environment, { can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false,
      reviewers: [{ type: 'User', reviewer: state.user }] }] });
  Object.assign(state.run, { repository: { full_name: a.target.repository }, head_repository: { full_name: a.target.repository },
    head_sha: a.harnessSha, head_branch: 'main', run_attempt: 1, event: 'workflow_dispatch', status: 'in_progress',
    actor: state.user, triggering_actor: state.user });
  state.repository = { id: 30, full_name: a.target.repository, owner: state.user,
    default_branch: 'main', permissions: { admin: true } };
  state.variables = Object.entries({ FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED: 'false',
    FCOS_PREVIEW_VERCEL_ISSUANCE_AUTHORITY_ENABLED: 'true', FCOS_PREVIEW_VERCEL_AUTHORITY_MODE: ENROLLED_AUTHORITY_MODE,
    FCOS_PREVIEW_EMAIL_BUILD_ENABLED: 'true', FCOS_PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLED: 'false',
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_SHA: a.candidateSha, FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_HARNESS_SHA: a.harnessSha,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTROL_SHA256: a.controlRevision,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTRACT_SHA256: a.contractSha256,
    FCOS_RELEASE_VERCEL_TOKEN_ID: a.tokenId, FCOS_PREVIEW_VERCEL_ENROLLMENT_ID: a.enrollmentId,
  }).map(([name, value]) => ({ name, value }));
  const route = endpoint => {
    if (endpoint === 'user') return state.user;
    if (endpoint === base) return state.repository;
    if (endpoint === `${base}/environments/${a.target.environment}`) return state.environment;
    if (endpoint === `${base}/environments/${a.target.environment}/variables?per_page=100`)
      return { total_count: state.variables.length, variables: state.variables };
    if (endpoint === `${base}/environments/${a.target.environment}/secrets?per_page=100`)
      return { total_count: a.secretMetadata.length, secrets: a.secretMetadata };
    if (endpoint === `${base}/actions/variables?per_page=100`) return { total_count: 0, variables: [] };
    if (endpoint === `${base}/actions/runs/${a.runId}`) return state.run;
    if (endpoint === `${base}/actions/runs/${a.runId}/approvals`) return state.approvals;
    if (endpoint === `${base}/actions/runs/${a.runId}/attempts/1/jobs?per_page=100&page=1`)
      return { total_count: state.jobs.length, jobs: state.jobs };
    if (endpoint === `${base}/actions/workflows/preview-email-proof-build.yml`) return state.workflow;
    if (endpoint.startsWith(`${base}/actions/runs?status=`)) return { total_count: 0, workflow_runs: [] };
    if (endpoint.startsWith(`${base}/git/ref/heads/`)) return { object: { sha: a.candidateSha } };
    throw new Error('Unrecognized offline public preflight route.');
  };
  const reads = { json(endpoint) {
    calls.push(endpoint);
    if (endpoint === 'user') return structuredClone(route(endpoint));
    return new Promise((resolve, reject) => setImmediate(() => {
      try { resolve(structuredClone(route(endpoint))); } catch (error) { reject(error); }
    }));
  } };
  return { a, state, reads, calls, base };
}
test('async public preflight retains exact metadata and re-reads every mutable boundary', async () => {
  const f = publicPreflightFixture(), first = await collectSuccessorAttestationPublicPreflight(f.reads, f.a);
  assert.equal(first.jobId, f.a.jobId); assert.equal(first.priorReceiptSha256, null);
  assert.deepEqual(first.secretMetadata, successorAttestationSecretMetadata(f.a.secretMetadata));
  assert.equal(f.calls.length, 16);
  f.state.run.status = 'completed';
  await assert.rejects(() => collectSuccessorAttestationPublicPreflight(f.reads, f.a));
  assert.equal(f.calls.filter(path => path === `${f.base}/actions/runs/${f.a.runId}`).length, 2);
});
test('async public preflight rejects changed review/configuration/workflow and mismatched actor', async () => {
  for (const change of [f => { f.state.approvals[0].state = 'rejected'; },
    f => { f.state.environment.protection_rules[0].reviewers[0].reviewer = { login: 'other', id: 11 }; },
    f => { f.state.workflow.state = 'disabled_manually'; },
    f => { f.state.variables.find(row => row.name === 'FCOS_PREVIEW_EMAIL_BUILD_ENABLED').value = 'false'; },
    f => { f.state.jobs[0].status = 'completed'; f.state.jobs[0].conclusion = 'cancelled'; },
    f => { f.a.jobStartedAt = new Date(Date.now() - 1800001).toISOString(); f.state.jobs[0].started_at = f.a.jobStartedAt; }]) {
    const f = publicPreflightFixture(); await collectSuccessorAttestationPublicPreflight(f.reads, f.a);
    change(f); await assert.rejects(() => collectSuccessorAttestationPublicPreflight(f.reads, f.a));
  }
  const f = publicPreflightFixture(); f.state.user.login = 'other';
  await assert.rejects(() => collectSuccessorAttestationPublicPreflight(f.reads, f.a));
  assert.deepEqual(f.calls, ['user']);
});
