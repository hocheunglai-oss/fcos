import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { SUCCESSOR_LIVE_CONTRACT } from '../scripts/lib/runtime-compatibility-successor-live.mjs';
import { SUCCESSOR_ATTEST_PURPOSE, SUCCESSOR_ATTEST_CANONICAL_HELPER_SHA256,
  successorAttestationPlan, assertSuccessorAttestationApproval, runSuccessorAttestationAdmission,
  requireSuccessorAttestationPublicationAdmission, successorAttestationSecretMetadata, successorAttestationActionBinding,
  assertSuccessorAttestationPrivateAction, assertSuccessorAttestationEnrollment, assertSuccessorAttestationPinnedKey,
  assertSuccessorAttestationProtectedReview, readSuccessorEnrollmentTokenMetadata } from '../scripts/lib/preview-vercel-successor-attestation.mjs';
import { successorAttestationMain } from '../scripts/preview-vercel-successor-attest.mjs';
import { PREVIEW_EMAIL_BUILD_CONTROL_FILES } from '../scripts/lib/preview-email-build-controls.mjs';
import { previewCoordinationSecretMetadata } from '../scripts/lib/preview-email-coordination-collector.mjs';

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
    run: { id: a.runId, name: 'FCOS protected Preview email proof build', run_started_at: a.dispatchedAt },
    approvals: [{ state: 'approved', user: { login: a.authorizedBy, id: 10 }, environments: [{ id: 20, name: a.target.environment }] }],
    jobs: [{ id: a.jobId, run_id: a.runId, run_attempt: 1, name: 'proof', workflow_name: 'FCOS protected Preview email proof build',
      head_sha: a.harnessSha, head_branch: 'main', status: 'in_progress', conclusion: null, completed_at: null, started_at: a.jobStartedAt }] };
}
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
  const source = readFileSync(path, 'utf8'), body = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  assert.ok(body.length > 100);
  const name = /(?:async )?function ([A-Za-z0-9_]+)/.exec(start)[1];
  return new Function(...Object.keys(dependencies), `${body.replace(/^export /, '')}\nreturn ${name};`)(...Object.values(dependencies));
}
function waitFixture({ missing = 2, old = true, deadlineAge = 0, badSignature = false } = {}) {
  let clock = now, reads = 0, verifications = 0, sleeps = 0;
  const a = approval(), context = { runId: a.runId, operation: 'create' };
  const selected = { contractSha256: a.contractSha256, context: { provisionedAt: new Date(now - deadlineAge).toISOString() },
    dispatchedAt: a.dispatchedAt, reviewedAt: { root: new Date(now - 1000).toISOString(), independent: new Date(now - 1000).toISOString() } };
  const oldVariables = { authorityEnvelope: old ? JSON.stringify({ receipt: { context: { ...context, runId: 1 } } }) : undefined };
  const currentVariables = { authorityEnvelope: JSON.stringify({ receipt: { context } }) };
  const fn = bodyFixture('scripts/lib/preview-email-build.mjs', 'export async function waitForPreviewEmailAttestation', '\nexport function previewEmailBuildDeployment', {
    successorLiveSelection(admission, candidate, at) { assert.equal(candidate, a.candidateSha); assert.equal(admission, selected); return selected; },
    SUCCESSOR_LIVE_CONTRACT, previewEmailProtectionData(p) { return { authorityMode: 'issuance-bound-v1', environmentId: 20,
      runId: a.runId, reviewedTokenId: a.tokenId, enrollmentId: a.enrollmentId, authorityEnvelope: p.variables.authorityEnvelope }; },
    ENROLLED_AUTHORITY_MODE: 'issuance-bound-v1', enrolledAuthorityContext: value => ({ runId: value.runId, operation: value.operation }),
    equal: (left, right) => JSON.stringify(left) === JSON.stringify(right), failure: message => { throw Error(message); },
    verifyEnrollmentReceipt(value) { verifications++; assert.equal(value.enrollmentId, a.enrollmentId);
      assert.equal(value.reviewedTokenId, a.tokenId); assert.deepEqual(value.context, context); if (badSignature) throw Error('Pinned signature refused'); },
  });
  return { run: () => fn({ protection: { admission: selected, candidateSha: a.candidateSha, repository: { id: 10 }, harnessSha: a.harnessSha,
    controlRevision: a.controlRevision, variables: oldVariables, jobs: [{ started_at: a.jobStartedAt }], oidcClaims: { exp: (now + 1000000) / 1000 } },
    operation: 'create', privateEnrollment: 'OFFLINE_CAPSULE', token: 'OFFLINE_BEARER', now: () => clock,
    sleep: async ms => { assert.ok(ms > 0 && ms <= 10000); sleeps++; clock += ms; },
    readVariables: async () => { reads++; return reads >= missing ? currentVariables : oldVariables; } }),
    observed: () => ({ reads, verifications, sleeps, clock }), currentVariables };
}
test('bounded hosted handoff waits for delayed exact run receipt; a prior run receipt never authorizes', async () => {
  const fixture = waitFixture(); assert.deepEqual(await fixture.run(), fixture.currentVariables);
  assert.deepEqual(fixture.observed(), { reads: 2, verifications: 1, sleeps: 2, clock: now + 20000 });
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
test('fixed native execution consumes before private reads and performs only the one exact nonsecret receipt write', async () => {
  const a = approval(), original = { action: { approval: a, text: 'OFFLINE_ORIGINAL_ACTION' }, state: state(a),
    public: { repositoryId: 10, environmentId: 20, priorReceiptSha256: null },
    admission: { context: { provisionedAt: new Date(now - 1000).toISOString() }, dispatchedAt: a.dispatchedAt,
      reviewedAt: { root: new Date(now - 1000).toISOString(), independent: new Date(now - 1000).toISOString() } } };
  const events = [], writes = []; let submitted;
  const envelope = { receipt: { context: { runId: a.runId }, expiresAt: now + 500000 }, signature: 'OFFLINE_NONPRIVATE_SIGNATURE' };
  const deps = {
    claimPublication(value) { assert.equal(value, original); events.push('consume'); return Object.freeze({}); },
    assertOriginalCurrent(left, right) { assert.equal(left, original); assert.equal(right, original); events.push('current'); },
    collectActual: async () => original, assertClaimCurrent() { events.push('lease'); }, mkdtempSync: () => '/private/tmp/OFFLINE_ONLY',
    join: (...parts) => parts.join('/'), tmpdir: () => '/private/tmp', ROOT: '/OFFLINE_ROOT',
    command(binary, args, input) {
      if (binary === '/usr/bin/swiftc') { events.push('compile'); return ''; }
      if (args[0] === 'get') {
        assert.ok(events.includes('consume')); events.push(`private:${args[2]}`);
        if (args[2] === 'capsule-service') return JSON.stringify(capsule(a));
        if (args[2] === 'key-service') return 'OFFLINE_KEY';
        if (args[2] === 'reader-service') return 'OFFLINE_READER';
        assert.fail('No other private service permitted');
      }
      assert.equal(binary, '/OFFLINE_GH');
      if (args.includes('POST') || args.includes('PATCH')) {
        writes.push({ args, body: JSON.parse(input) }); submitted = JSON.parse(input).value; return '{}';
      }
      assert.ok(args.includes('GET'));
      if (args.at(-1).endsWith('/variables?per_page=100')) return JSON.stringify({ total_count: 0, variables: [] });
      if (args.at(-1).endsWith('/secrets?per_page=100')) return JSON.stringify({ total_count: 6, secrets: a.secretMetadata });
      return JSON.stringify({ name: 'FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT', value: submitted });
    },
    lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, uid: process.getuid(), nlink: 1 }), process,
    assertSuccessorAttestationEnrollment: (a, s, c, m) => assertSuccessorAttestationEnrollment(a, s, c, m, now),
    assertSuccessorAttestationPinnedKey: () => { events.push('key-pin'); },
    FCOS_CONNECTION_POLICY: { keychainAccount: 'OFFLINE_ACCOUNT', attestation: { privateKeyService: 'key-service' },
      providers: [{ id: 'vercel', keychainService: 'reader-service' }] }, ENROLLMENT_KEYCHAIN_SERVICE: 'capsule-service',
    fail: () => { throw Error('Inert native fixture refused'); }, retainedProduction: async () => { events.push('retained-production'); },
    readSuccessorEnrollmentTokenMetadata: async () => { events.push('metadata'); assert.ok(events.includes('key-pin')); return tokenMetadata(a); },
    NATIVE_FETCH: () => assert.fail('No fetch in inert harness'), Date: { now: () => now, parse: Date.parse },
    readExistingEnrollment: () => state(a), enrolledAuthorityContext: value => value,
    signEnrollmentReceipt(value) { events.push('sign'); assert.ok(events.includes('metadata')); assert.equal(value.now, now); return envelope; },
    ENROLLED_AUTHORITY_RECEIPT: 'FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT', ENVIRONMENT: '/OFFLINE_EXACT_ENVIRONMENT', GH: '/OFFLINE_GH',
    collection: (value, key) => value[key], variable: (rows, name) => rows.find(row => row.name === name)?.value,
    successorAttestationHash: value => value === undefined ? '' : 'a'.repeat(64), actionAdmission: () => original.action,
    bindSuccessorAttestationAdmission: () => {}, successorAttestationSecretMetadata, same: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    requireSuccessorAttestationPublicationAdmission: () => ({ lease: { leaseId: nonce } }), rmSync: () => events.push('cleanup'),
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
  assert.equal(events.filter(row => row === 'cleanup').length, 2);
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
});
