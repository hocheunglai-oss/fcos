import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { createPrivateEnrollment } from '../scripts/lib/preview-vercel-enrollment.mjs';
import { RECOVERY_PURPOSE, RECOVERY_TARGET, RECOVERY_CANONICAL_SHA256, RECOVERY_PRESERVED_SECRETS, RECOVERY_PAIR,
  recoveryHash, recoveryBinding, assertEnrollmentRecoveryApproval, assertEnrollmentRecoveryEvidence,
  enrollmentRecoveryPlan, recoverySecretMetadata, recoverySame, recoveryFailure, recoveryKeychainSource,
  runFixedEnrollmentRecovery } from '../scripts/lib/preview-vercel-enrollment-recovery.mjs';
import { enrollmentRecoveryMain } from '../scripts/preview-vercel-enrollment-recovery.mjs';

// Extract only the private orchestration into this offline VM. No exported
// production hook, process/env toggle, native functions or authenticated I/O can
// enter this test copy. Production always builds its fixed native boundary.
const productionLibrary = readFileSync(new URL('../scripts/lib/preview-vercel-enrollment-recovery.mjs', import.meta.url), 'utf8');
const orchestration = productionLibrary.slice(productionLibrary.indexOf('async function runEnrollmentRecovery('), productionLibrary.indexOf('\nconst ROOT ='));
const runEnrollmentRecovery = compileFunction(`${orchestration}; return runEnrollmentRecovery;`,
  ['assertEnrollmentRecoveryApproval', 'recoveryFailure', 'recoveryHash', 'recoveryBinding', 'createPrivateEnrollment',
    'recoverySecretMetadata', 'RECOVERY_PRESERVED_SECRETS', 'RECOVERY_PAIR', 'recoverySame', 'need', 'hash', 'uuid'])(
  assertEnrollmentRecoveryApproval, recoveryFailure, recoveryHash, recoveryBinding, createPrivateEnrollment,
  recoverySecretMetadata, RECOVERY_PRESERVED_SECRETS, RECOVERY_PAIR, recoverySame,
  value => { if (!value) recoveryFailure(); }, value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
  value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));

const initialNow = Date.parse('2026-10-10T15:00:00.000Z');
const candidate = JSON.parse(readFileSync(new URL('../config/runtime-compatibility-successor-live.json', import.meta.url)));
const nonce = '11111111-1111-4111-8111-111111111111', enrollmentId = '22222222-2222-4222-8222-222222222222';
const hashes = { scriptSha256: 'a'.repeat(64), librarySha256: 'b'.repeat(64), ledgerSha256: 'c'.repeat(64) };
const reference = name => ({ path: `/private/tmp/SYNTHETIC-${name}.json`, sha256: recoveryHash(name) });
const preserved = RECOVERY_PRESERVED_SECRETS.map(name => ({ name, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' })).sort((a, b) => a.name.localeCompare(b.name));
function approval() { return { schemaVersion: 1, kind: 'root_admitted_absent_preview_enrollment_recovery', action: 'enroll-absent',
  purpose: RECOVERY_PURPOSE, authorizedBy: 'hocheunglai-oss', nonce, operationId: `fcos-preview-enrollment-recovery-${enrollmentId}`,
  enrollmentId, target: RECOVERY_TARGET, candidateSha: candidate.candidateSha, sourceDigest: candidate.sourceDigest, lockHash: candidate.lockHash,
  sourceCommit: 'd'.repeat(40), sourceTree: 'e'.repeat(40), protectedMainSha: 'f'.repeat(40), sourcePullRequest: 999,
  sourceBranch: 'codex/SYNTHETIC'.toLowerCase(), ...hashes, canonicalHelperSha256: RECOVERY_CANONICAL_SHA256,
  authorizedAt: initialNow - 1000, privateReadinessAt: initialNow - 2000,
  expiresAt: initialNow + 3600000, leaseDeadline: initialNow + 3600000, secretMetadata: structuredClone(preserved),
  privateActionEvidence: reference('evidence'), rootReview: reference('root'), independentReview: reference('independent') }; }
function evidence(a) { return { kind: 'direct_human_absent_preview_enrollment_recovery_authority', authorizedBy: a.authorizedBy,
  purpose: a.purpose, sourceCommit: a.sourceCommit, scriptSha256: a.scriptSha256, bindingSha256: recoveryHash(JSON.stringify(recoveryBinding(a))),
  authorizedAt: a.authorizedAt, privateReadinessAt: a.privateReadinessAt, localManagementCredentialReadAuthorized: true,
  oneProjectTokenIssuanceAuthorized: true, newCapsuleWriteAuthorized: true, pairedProtectedSecretCreationAuthorized: true,
  disabledEnrollmentPinWriteAuthorized: true, reviewedDraftSourceAuthorized: true, attestationKeyAccessAuthorized: false,
  signingAuthorized: false, previewExecutionAuthorized: false, productionAuthorized: false, financialAuthorized: false }; }
function reviews(a) { return ['root', 'independent'].map(role => ({ kind: 'absent_preview_enrollment_recovery_material_review', role,
  accepted: true, sourceCommit: a.sourceCommit, scriptSha256: a.scriptSha256, bindingSha256: evidence(a).bindingSha256,
  reviewerId: `SYNTHETIC/${role}`, reviewedAt: a.authorizedAt + 100 })); }
function fixture() {
  let clock = initialNow, claimed = false, durable, capsule;
  const calls = [], values = {}, pins = {}, a = approval();
  const token = 'vcp_OFFLINE_SYNTHETIC_BEARER_NEVER_A_CREDENTIAL';
  const freshMetadata = { id: 'SYNTHETIC_NEW_TOKEN_ID', projectId: RECOVERY_TARGET.projectId, type: 'token', prefix: 'vcp_',
    createdAt: initialNow, expiresAt: a.expiresAt, scopes: [{ type: 'team', teamId: RECOVERY_TARGET.teamId, expiresAt: a.expiresAt }] };
  const io = {
    publicPreflight: async () => { calls.push('public'); },
    prepareLocal: async () => { calls.push('compile-no-private'); },
    claim: async () => { calls.push('claim'); if (claimed) throw Error(token); claimed = true;
      return { operationId: a.operationId, consumptionSha256: '1'.repeat(64), lease: { epoch: 'production-reconciliation-20261005',
        objective: 'production', ownerThreadId: '01a0f08b-7fcb-7870-9edc-343e16052b62', operationId: a.operationId,
        bindingSha256: recoveryHash(`FCOS-ABSENT-PREVIEW-ENROLLMENT-LEASE-V1\0${JSON.stringify(recoveryBinding(a))}`),
        leaseId: '33333333-3333-4333-8333-333333333333', coordinationOnly: true, providerAuthorityGranted: false, uncertainOutcomeRequiresReadback: true } }; },
    assertClaim: async () => { calls.push('current-lease'); if (!claimed) throw Error('no lease'); },
    save: async (_, value) => { calls.push(`save:${value.phase}`); durable = structuredClone(value); },
    privatePreflight: async () => { calls.push('private'); },
    issue: async () => { calls.push('POST'); return { token: { id: freshMetadata.id }, bearerToken: token }; },
    tokenMetadata: async () => { calls.push('metadata'); return structuredClone(freshMetadata); },
    createCapsule: async (_, text) => { calls.push('capsule-add'); if (capsule) throw Error(token); capsule = text; },
    readCapsule: async () => { calls.push('capsule-read'); return capsule; },
    assertPairPublicationState: async (_, name) => { calls.push(`absent:${name}`); assert.equal(values[name], undefined); },
    createSecret: async (name, value) => { calls.push(`secret:${name}`); values[name] = value; },
    secretMetadata: async () => [...preserved, ...Object.keys(values).map(name => ({ name,
      created_at: new Date(initialNow).toISOString(), updated_at: new Date(initialNow).toISOString() }))],
    assertDisabled: async () => { calls.push('disabled'); },
    publishDisabledPins: async (_, id) => { calls.push('pins'); pins.id = id; pins.enrollmentId = a.enrollmentId; },
  };
  return { a, io, calls, values, pins, token, freshMetadata, clock: value => { clock = value; },
    get state() { return durable; }, run: () => runEnrollmentRecovery({ approval: a, nonce, hashes, io, now: () => clock }) };
}

test('default plan is provider/private/issuance zero and requires observed source PR', async () => {
  assert.deepEqual(await enrollmentRecoveryMain([]), enrollmentRecoveryPlan());
  assert.deepEqual(await enrollmentRecoveryMain(['--plan']), enrollmentRecoveryPlan());
  assert.equal(enrollmentRecoveryPlan().providerCalls, 0); assert.equal(enrollmentRecoveryPlan().privateReads, 0);
  assert.equal(enrollmentRecoveryPlan().requiresActualReviewedDraftPullRequest, true);
  await assert.rejects(enrollmentRecoveryMain(['--enroll', nonce]));
});
test('fresh source/action approval, distinct actual reviews and no signing or execution authority', () => {
  const a = approval(); assertEnrollmentRecoveryApproval(a, nonce, hashes, initialNow);
  assert.equal(assertEnrollmentRecoveryEvidence(a, evidence(a), reviews(a), initialNow), evidence(a).bindingSha256);
  const r = reviews(a); r[1].reviewerId = r[0].reviewerId;
  assert.throws(() => assertEnrollmentRecoveryEvidence(a, evidence(a), r, initialNow));
  for (const field of ['oneProjectTokenIssuanceAuthorized', 'reviewedDraftSourceAuthorized'])
    assert.throws(() => assertEnrollmentRecoveryEvidence(a, { ...evidence(a), [field]: false }, reviews(a), initialNow));
  for (const field of ['signingAuthorized', 'previewExecutionAuthorized', 'productionAuthorized'])
    assert.throws(() => assertEnrollmentRecoveryEvidence(a, { ...evidence(a), [field]: true }, reviews(a), initialNow));
});
test('recovery preserves60min authorization and45min readiness without imposing a10min execution deadline', () => {
  const a = approval(); a.authorizedAt = initialNow - 1200000; a.privateReadinessAt = a.authorizedAt - 1000;
  assertEnrollmentRecoveryApproval(a, nonce, hashes, initialNow);
  assertEnrollmentRecoveryEvidence(a, evidence(a), reviews(a), initialNow);
  assert.throws(() => assertEnrollmentRecoveryApproval(a, nonce, hashes, a.privateReadinessAt + 2700000));
});
test('action reviews follow actual human authorization without inventing or renewing clocks', () => {
  const a = approval(), original = structuredClone(a), r = reviews(a);
  assert.ok(r.every(row => row.reviewedAt >= a.authorizedAt && row.reviewedAt <= initialNow));
  assertEnrollmentRecoveryEvidence(a, evidence(a), r, initialNow);
  assert.deepEqual(a, original);
  r[0].reviewedAt = a.authorizedAt - 1;
  assert.throws(() => assertEnrollmentRecoveryEvidence(a, evidence(a), r, initialNow));
  r[0].reviewedAt = initialNow + 1;
  assert.throws(() => assertEnrollmentRecoveryEvidence(a, evidence(a), r, initialNow));
});
for (const [label, mutate] of [
  ['wrong nonce', a => { a.nonce = enrollmentId; }], ['wrong candidate', a => { a.candidateSha = 'f'.repeat(40); }],
  ['wrong target', a => { a.target = { ...a.target, projectId: 'other' }; }], ['wrong helper', a => { a.ledgerSha256 = '0'.repeat(64); }],
  ['old readiness', a => { a.privateReadinessAt = initialNow - 2700001; }], ['expired action', a => { a.authorizedAt = initialNow - 3600001; }],
  ['deleted old enrollment', a => { a.enrollmentId = '9cb4eb76-1d82-44ec-ba66-7285b98851c9'; }],
  ['missing source PR', a => { a.sourcePullRequest = null; }], ['extra secret already present', a => { a.secretMetadata.push({ ...a.secretMetadata[0], name: RECOVERY_PAIR[0] }); }],
  ['wrong preserved secret', a => { a.secretMetadata[0].name = 'OTHER'; }], ['unreviewed field', a => { a.authorized = true; }],
]) test(`${label} refuses before any adapter access`, async () => {
  const f = fixture(); mutate(f.a); let touched = 0;
  await assert.rejects(runEnrollmentRecovery({ approval: f.a, nonce, hashes,
    io: new Proxy({}, { get() { touched++; throw Error('touched'); } }), now: () => initialNow }));
  assert.equal(touched, 0);
});
test('one issuance writes the unchanged capsule pair, all six metadata rows and disabled custody pins', async () => {
  const f = fixture(); const result = await f.run(); assert.equal(result.enrolled, true);
  assert.equal(f.calls.filter(value => value === 'POST').length, 1);
  assert.ok(f.calls.indexOf('claim') < f.calls.indexOf('private'));
  assert.ok(f.calls.indexOf('save:issuance_requested') < f.calls.indexOf('POST'));
  assert.deepEqual(Object.keys(f.values), RECOVERY_PAIR);
  assert.equal(f.state.phase, 'enrolled_disabled'); assert.equal(f.state.sourceSha, f.a.sourceCommit);
  assert.equal(f.state.secretMetadata.length, 6);
  assert.deepEqual(f.state.secretMetadata.filter(row => !RECOVERY_PAIR.includes(row.name)), preserved);
  assert.equal(f.state.tokenId, f.freshMetadata.id); assert.equal(f.pins.enrollmentId, f.a.enrollmentId);
  assert.ok(!JSON.stringify(f.state).includes(f.token)); assert.ok(!JSON.stringify(result).includes(f.token));
  await assert.rejects(f.run()); assert.equal(f.calls.filter(value => value === 'POST').length, 1);
});
test('forged canonical claim cannot reach private reads', async () => {
  const f = fixture(); f.io.claim = async () => ({ operationId: f.a.operationId, consumptionSha256: '1'.repeat(64), lease: { providerAuthorityGranted: true } });
  await assert.rejects(f.run()); assert.ok(!f.calls.includes('private')); assert.ok(!f.calls.includes('POST'));
});
for (const checkpoint of [1, 2, 3, 4, 5, 6, 7]) test(`canonical lease loss at private/mutation checkpoint ${checkpoint} never reaches that action`, async () => {
  const f = fixture(); let checks = 0;
  f.io.assertClaim = async () => { if (++checks === checkpoint) throw Error('SYNTHETIC LOST LEASE'); };
  await assert.rejects(f.run());
  assert.equal(f.state.phase, 'quarantined_reconciliation_required');
  const boundaries = ['private', 'POST', 'capsule-add', 'capsule-read', `secret:${RECOVERY_PAIR[0]}`, `secret:${RECOVERY_PAIR[1]}`, 'pins'];
  assert.ok(!f.calls.includes(boundaries[checkpoint-1]));
  assert.equal(f.calls.filter(value => value === 'POST').length, checkpoint <= 2 ? 0 : 1);
});
test('local compile failure occurs before consumption and all private/provider mutations', async () => {
  const f = fixture(); f.io.prepareLocal = async () => { throw Error('SYNTHETIC SDK FAILURE'); };
  await assert.rejects(f.run()); assert.ok(!f.calls.includes('claim')); assert.ok(!f.calls.includes('private')); assert.ok(!f.calls.includes('POST'));
});
test('private-consent clock latency cannot renew original readiness or action', async () => {
  const f = fixture(); f.io.privatePreflight = async () => { f.calls.push('private'); f.clock(initialNow + 2700000); };
  await assert.rejects(f.run()); assert.ok(!f.calls.includes('POST')); assert.equal(f.state.phase, 'quarantined_reconciliation_required');
});
test('uncertain issuance consumes once, redacts hostile errors and never writes or retries', async () => {
  const f = fixture(); let inspected = 0;
  f.io.issue = async () => { f.calls.push('POST'); throw new Proxy({}, { get() { inspected++; throw Error(f.token); } }); };
  await assert.rejects(f.run(), error => !error.message.includes(f.token)); assert.equal(inspected, 0);
  assert.equal(f.state.phase, 'quarantined_reconciliation_required'); assert.deepEqual(f.values, {});
  await assert.rejects(f.run()); assert.equal(f.calls.filter(value => value === 'POST').length, 1);
});
test('metadata failure retains exact returned nonsecret ID in quarantine and never reissues', async () => {
  const f = fixture(); f.io.tokenMetadata = async id => {
    assert.equal(id, f.freshMetadata.id); assert.equal(f.state.tokenId, id);
    assert.equal(f.state.phase, 'issuance_returned_metadata_pending');
    throw Error(f.token);
  };
  await assert.rejects(f.run());
  assert.equal(f.state.phase, 'quarantined_reconciliation_required');
  assert.equal(f.state.tokenId, f.freshMetadata.id);
  assert.ok(!JSON.stringify(f.state).includes(f.token)); assert.deepEqual(f.values, {});
  await assert.rejects(f.run()); assert.equal(f.calls.filter(value => value === 'POST').length, 1);
});
for (const [label, mutate] of [
  ['wrong project', m => { m.projectId = 'other'; }], ['wrong team', m => { m.scopes[0].teamId = 'other'; }],
  ['revoked', m => { m.revokedAt = initialNow; }], ['leaked', m => { m.leakedAt = initialNow; }],
  ['wrong token id', m => { m.id = 'other'; }], ['wrong expiry', m => { m.expiresAt++; }],
]) test(`issued ${label} metadata refuses before capsule or secret writes`, async () => {
  const f = fixture(); f.io.tokenMetadata = async () => { const m = structuredClone(f.freshMetadata); mutate(m); return m; };
  await assert.rejects(f.run()); assert.ok(!f.calls.includes('capsule-add')); assert.deepEqual(f.values, {});
});
test('partial paired publication preserves quarantine and never writes pins or reissues', async () => {
  const f = fixture(), create = f.io.createSecret;
  f.io.createSecret = async (name, value) => { if (name === RECOVERY_PAIR[1]) throw Error(f.token); return create(name, value); };
  await assert.rejects(f.run()); assert.equal(f.state.phase, 'quarantined_reconciliation_required');
  assert.equal(f.values[RECOVERY_PAIR[0]], f.token); assert.equal(f.values[RECOVERY_PAIR[1]], undefined);
  assert.deepEqual(f.pins, {}); await assert.rejects(f.run()); assert.equal(f.calls.filter(value => value === 'POST').length, 1);
});
test('unrelated secret metadata drift rejects disabled pin publication', async () => {
  const f = fixture(), original = f.io.secretMetadata;
  f.io.secretMetadata = async () => { const rows = structuredClone(await original()); rows[0].updated_at = '2026-10-03T00:00:00Z'; return rows; };
  await assert.rejects(f.run()); assert.deepEqual(f.pins, {}); assert.equal(f.state.phase, 'quarantined_reconciliation_required');
});
test('fixed native entry exports no injectable provider, clock or private adapter surface', async () => {
  const exports = await import('../scripts/lib/preview-vercel-enrollment-recovery.mjs');
  assert.equal(exports.runEnrollmentRecovery, undefined);
  assert.equal(exports.adapters, undefined);
  assert.equal(runFixedEnrollmentRecovery.length, 1);
  assert.ok(!productionLibrary.includes('process.env.FCOS_TEST'));
  assert.match(productionLibrary, /command\(node, \[vc, '--version'/);
  assert.match(productionLibrary, /process.version === 'v24.18.0'/);
  assert.match(productionLibrary, /'--read-consumed'/);
  assert.ok(productionLibrary.includes("'vercel.json'"));
  assert.ok(!productionLibrary.includes('reviewedTokenId'));
  assert.ok(!productionLibrary.includes('/v5/user/tokens/current'));
  assert.ok(productionLibrary.includes('`/v5/user/tokens/${id}`'));
  assert.ok(!productionLibrary.includes('seed'));
  assert.match(productionLibrary, /await io.prepareLocal\(a\); check\(\);/);
});
test('capsule custody helper is add-only and excludes the attestation service', () => {
  const source = recoveryKeychainSource(enrollmentId);
  assert.ok(source.includes('SecItemAdd')); assert.ok(source.includes('errSecItemNotFound'));
  assert.ok(!source.includes('SecItemUpdate')); assert.ok(!source.includes('attestation'));
  assert.throws(() => recoveryKeychainSource('arbitrary-account'));
  const cli = readFileSync(new URL('../scripts/preview-vercel-enrollment-recovery.mjs', import.meta.url), 'utf8');
  assert.ok(!cli.includes("from './preview-vercel-enrollment.mjs'"));
  assert.ok(!cli.includes('runEnrollmentOperation')); assert.ok(!productionLibrary.includes('createPrivateKey'));
  assert.ok(!cli.includes('adapters')); assert.ok(!cli.includes('keychain'));
  assert.ok(!productionLibrary.includes('runEnrollmentOperation'));
  assert.ok(!productionLibrary.includes("from './fcos-connections.mjs'"));
});
