import test from 'node:test';
import assert from 'node:assert/strict';
import { createManifest, digest, selectChecks, targets, publicBuildEnvironment } from '../scripts/lib/rapid-release/contract.mjs';
import { MemoryJournal, validateChain, assertPublicPayload, DeploymentJournal } from '../scripts/lib/rapid-release/journal.mjs';
import { stageRelease, promoteRelease } from '../scripts/lib/rapid-release/engine.mjs';
import { selectedProductTests } from '../scripts/lib/rapid-release/build.mjs';

const sha = 'a'.repeat(40), h = 'b'.repeat(64);
function fixture() {
  const manifest = createManifest({ candidate: { sha, sourceDigest: h, lockDigest: h }, controllerSha: 'c'.repeat(40),
    previous: { deploymentId: 'dpl_old', sha: 'd'.repeat(40), configurationDigest: h, schemaDigest: h },
    paths: ['src/components/dashboard/Table.jsx'], publicEnvironment: { VITE_SUPABASE_URL: `https://${targets().supabaseProject}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(25)}` }, releaseId: 'rapid-fixture-0001' });
  const build = { schemaVersion: 1, buildId: manifest.build.buildId, candidateSha: sha, sourceDigest: h, lockDigest: h,
    artifactDigest: h, controllerSha: manifest.controllerSha, qualityPassed: true, performancePassed: true, node: process.version };
  const staged = { id: 'dpl_new', state: 'READY', url: 'https://fcos-fixture.vercel.app', buildId: build.buildId, artifactDigest: h, sha, target: 'production' };
  const journal = new MemoryJournal(), calls = []; let current = { id: 'dpl_old' };
  const provider = { async assertOwnership() { calls.push('owner'); }, async stage() { calls.push('stage'); return staged; }, async ready() { return staged; },
    async discover() { calls.push('discover'); return { outcome: 'applied', result: staged }; }, async currentProduction() { return current; },
    async verifyApproval() { calls.push('approval'); }, async promote() { calls.push('promote'); current = staged; return staged; },
    async rollbackCompatibility() { return { compatible: true, deploymentId: 'dpl_old' }; },
    async rollback() { calls.push('rollback'); current = { id: 'dpl_old' }; return current; }, async verifyRollback() { calls.push('rollback-readback'); } };
  const smoke = async () => ({ passed: true, deploymentId: staged.id, buildId: build.buildId, login: true,
    restrictedAccess: true, businessWrites: 0, modules: ['dashboard'] });
  const approval = { manifestHash: digest(manifest), candidateSha: sha, buildId: build.buildId, deploymentId: staged.id,
    previousDeploymentId: 'dpl_old', environment: 'fcos-production-release', reviewer: targets().account,
    nativeReviewVerified: true, runId: 123, approvedAt: new Date().toISOString() };
  const observe = async () => ({ passed: true, deploymentId: staged.id, buildId: build.buildId, observationMs: 300000 });
  return { manifest, build, staged, journal, provider, calls, smoke, approval, observe };
}
test('frontend-only selection never enables Salesforce/mirror/schema work', () => {
  const result = selectChecks(['src/components/dashboard/Table.jsx']);
  assert.equal(result.salesforce, false); assert.equal(result.database, false); assert.deepEqual(result.modules, ['dashboard']);
});
test('unknown/shared/financial/dependency/test changes broaden coverage', () => {
  for (const path of ['api/_xeroPortal.js', 'package-lock.json', 'new-unknown.js', 'tests/security.test.js', 'shared/access.js']) assert.equal(selectChecks([path]).broad, true, path);
});
test('each affected module requires a test mapping; one missing mapping broadens all tests', () => {
  const files = ['dashboardSummary.test.js', 'buyerInvoiceDates.test.js', 'unrelated.test.js'];
  assert.deepEqual(selectedProductTests(files, { broad: false, modules: ['dashboard', 'buyer_invoices'] }), files.slice(0, 2).sort());
  assert.deepEqual(selectedProductTests(files, { broad: false, modules: ['dashboard', 'unknown_module'] }), files.sort());
});
test('public build environment rejects credential leakage and another target', () => {
  assert.throws(() => publicBuildEnvironment({ VERCEL_TOKEN: 'private' }), /PRIVATE_BUILD_ENVIRONMENT/);
  assert.throws(() => publicBuildEnvironment({ VITE_SUPABASE_URL: 'https://wrong.supabase.co', VITE_SUPABASE_ANON_KEY: 'public' }), /TARGET_MISMATCH/);
  const secretJwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role: 'service_role', ref: targets().supabaseProject, iss: 'supabase', exp: 9999999999 })).toString('base64url')}.signature`;
  for (const value of ['sb_secret_private_value', secretJwt]) assert.throws(() => publicBuildEnvironment({ VITE_SUPABASE_URL: `https://${targets().supabaseProject}.supabase.co`, VITE_SUPABASE_ANON_KEY: value }), /PUBLIC_SUPABASE_KEY_REQUIRED/);
});
test('successful stage resumes without rebuilding or duplicate provider writes', async () => {
  const f = fixture(); await stageRelease(f); await stageRelease(f);
  assert.equal(f.calls.filter(c => c === 'stage').length, 1);
  assert.ok(f.journal.records.findIndex(r => r.payload.event === 'stage.intent') < f.journal.records.findIndex(r => r.payload.event === 'stage.result'));
});
test('lost stage acknowledgement only discovers original operation, never resubmits', async () => {
  const f = fixture(); f.provider.stage = async () => { f.calls.push('stage'); throw Error('timeout'); };
  assert.equal((await stageRelease(f)).waiting, true);
  const result = await stageRelease(f); assert.equal(result.state, 'ready_for_decision');
  assert.equal(f.calls.filter(c => c === 'stage').length, 1); assert.equal(f.calls.filter(c => c === 'discover').length, 1);
});
test('empty or ambiguous discovery preserves checkpoint and refuses duplicate submit', async () => {
  const f = fixture(); f.provider.stage = async () => { f.calls.push('stage'); throw Error('unknown'); };
  await stageRelease(f); f.provider.discover = async () => ({ outcome: 'unknown' });
  assert.equal((await stageRelease(f)).waiting, true); assert.equal(f.calls.filter(c => c === 'stage').length, 1);
});
test('staged artifact digest mismatch blocks smoke and approval', async () => {
  const f = fixture(); f.provider.ready = async () => ({ ...f.staged, artifactDigest: '0'.repeat(64) });
  await assert.rejects(stageRelease(f), /STAGED_BUILD_NOT_READY/); assert.equal(f.journal.records.some(r => r.payload.event === 'smoke.passed'), false);
});
test('missing module/normal-role coverage is a failure, not a passing smoke', async () => {
  const f = fixture(); f.smoke = async () => ({ passed: true, deploymentId: f.staged.id, buildId: f.build.buildId, login: true, restrictedAccess: true, businessWrites: 0, modules: [] });
  await assert.rejects(stageRelease(f), /SMOKE_INCOMPLETE/);
});
test('exact native approval promotes same tested deployment once', async () => {
  const f = fixture(); await stageRelease(f); assert.equal((await promoteRelease(f)).state, 'complete');
  assert.equal((await promoteRelease(f)).reused, true); assert.equal(f.calls.filter(c => c === 'promote').length, 1);
});
test('changed candidate/deployment cannot reuse authorization', async () => {
  const f = fixture(); await stageRelease(f); f.approval.deploymentId = 'dpl_other';
  await assert.rejects(promoteRelease(f), /EXACT_PRODUCTION_AUTHORIZATION/); assert.equal(f.calls.includes('promote'), false);
});
test('changed live baseline stops promotion', async () => {
  const f = fixture(); await stageRelease(f); f.provider.currentProduction = async () => ({ id: 'dpl_newer' });
  await assert.rejects(promoteRelease(f), /BASELINE_CHANGED/); assert.equal(f.calls.includes('promote'), false);
});
test('failed post-prerequisite smoke resumes that check without replaying successful prerequisite writes', async () => {
  const f = fixture();
  f.manifest = createManifest({ candidate: f.manifest.candidate, controllerSha: f.manifest.controllerSha,
    previous: f.manifest.previous, paths: ['supabase/migrations/20990101000000_fixture.sql'],
    publicEnvironment: f.manifest.build.publicEnvironment, releaseId: f.manifest.releaseId });
  f.approval.manifestHash = digest(f.manifest);
  const passedSmoke = f.smoke;
  f.smoke = async () => ({ ...await passedSmoke(), modules: f.manifest.selection.modules, normalRole: true });
  await stageRelease(f);
  let applied = 0;
  f.prerequisites = async () => { applied++; return { passed: true, manifestHash: digest(f.manifest), backwardCompatible: true }; };
  f.smoke = async () => { throw Error('SCHEMA_SMOKE_UNAVAILABLE'); };
  await assert.rejects(promoteRelease(f), /SCHEMA_SMOKE_UNAVAILABLE/);
  assert.equal(applied, 1); assert.equal(f.calls.includes('promote'), false);
  f.smoke = async () => ({ ...await passedSmoke(), modules: f.manifest.selection.modules, normalRole: true });
  assert.equal((await promoteRelease(f)).state, 'complete');
  assert.equal(applied, 1); assert.equal(f.calls.filter(call => call === 'promote').length, 1);
});
test('failed live verification rolls back compatible previous build and verifies it', async () => {
  const f = fixture(); await stageRelease(f); f.observe = async () => { throw Error('regression'); };
  assert.equal((await promoteRelease(f)).state, 'rolled_back'); assert.deepEqual(f.calls.slice(-2), ['rollback', 'rollback-readback']);
});
test('unproved rollback compatibility never mutates Production again', async () => {
  const f = fixture(); await stageRelease(f); f.observe = async () => { throw Error('regression'); };
  f.provider.rollbackCompatibility = async () => ({ compatible: false });
  assert.equal((await promoteRelease(f)).code, 'ROLLBACK_COMPATIBILITY_UNPROVEN'); assert.equal(f.calls.includes('rollback'), false);
});
test('journal rejects gaps/forks/tampered receipts and private data', () => {
  const base = { schemaVersion: 1, kind: 'fcos_rapid_release_event', releaseId: 'r', manifestHash: h, sequence: 0, previousHash: null, event: 'release.prepared', data: {} };
  const record = { payload: { ...base, recordHash: digest(base) } };
  assert.equal(validateChain([record], h, 'r').length, 1);
  assert.throws(() => validateChain([{ payload: { ...record.payload, sequence: 2 } }], h, 'r'), /DIGEST_INVALID/);
  const fork = { ...base, data: { different: true } };
  assert.throws(() => validateChain([record, { payload: { ...fork, recordHash: digest(fork) } }], h, 'r'), /FORK_OR_GAP/);
  assert.throws(() => assertPublicPayload({ password: 'hidden' }), /PRIVATE_FIELD/);
  assert.throws(() => assertPublicPayload({ detail: 'Bearer private-value' }), /PRIVATE_VALUE/);
});
test('journal creates persistent object payloads with no auto-merge; statuses never used', async () => {
  const records = [], writes = []; const github = { candidateSha: sha, async pages() { return records; }, async write(path, body) {
    writes.push({ path, body }); records.push({ id: 1, creator: { id: 7 }, payload: body.payload });
  } };
  const journal = new DeploymentJournal({ github, releaseId: 'r', manifestHash: h, actorIds: [7] });
  await journal.append('release.prepared', {}); assert.equal(writes[0].body.auto_merge, false);
  assert.equal(writes[0].body.transient_environment, false); assert.equal(writes[0].body.payload.previousHash, null);
  assert.equal(writes[0].path.endsWith('/deployments'), true);
});

test('Salesforce checkpoint recovers a lost journal acknowledgement without exposing the private record', async () => {
  const records = [];
  let writes = 0;
  const github = { candidateSha: sha, async pages() { return records; }, async write(_path, body) {
    writes += 1;
    records.push({ id: 1, creator: { id: 7 }, payload: body.payload });
    throw new Error('Lost acknowledgement');
  } };
  const journal = new DeploymentJournal({ github, releaseId: 'r', manifestHash: h, actorIds: [7] });
  const record = { status: 'Succeeded', receiptId: 'private-receipt' };
  const checkpoint = { fingerprint: h, stage: 'devee', operation: 'permission:Reviewed', record };
  assert.equal((await journal.checkpoint(checkpoint)).id, 1);
  assert.equal((await journal.checkpoint(checkpoint)).id, 1);
  assert.equal(writes, 1);
  assert.deepEqual(records[0].payload.data, {
    fingerprint: h, stage: 'devee', operation: 'permission:Reviewed', outcome: 'resolved', evidenceDigest: digest(record),
  });
  await assert.rejects(journal.checkpoint({ ...checkpoint, operation: 'unrecognized' }), /SALESFORCE_CHECKPOINT_INVALID/);
  assert.equal(writes, 1);
});

test('Salesforce checkpoints retain the original job locator without copying provider data', async () => {
  const records = [];
  const github = { candidateSha: sha, async pages() { return records; }, async write(_path, body) {
    records.push({ id: records.length + 1, creator: { id: 7 }, payload: body.payload });
  } };
  const journal = new DeploymentJournal({ github, releaseId: 'salesforce', manifestHash: h, actorIds: [7] });
  const submittedAt = '2026-11-08T12:00:00.000Z';
  const validationJobId = '0AfHF00000700KB0AY';
  const jobId = '0AfHF00000702c50AA';
  const checkpoint = { fingerprint: h, stage: 'devee', operation: 'deployment' };
  const record = { status: 'submitting', jobId: null, validationJobId, submittedAt, privateReceipt: 'internal' };
  await journal.checkpoint({ ...checkpoint, record });
  await journal.checkpoint({ ...checkpoint, record: { ...record, status: 'Submitted', jobId } });
  const resumed = new DeploymentJournal({ github, releaseId: 'salesforce', manifestHash: h, actorIds: [7] });
  const chain = await resumed.read();
  assert.deepEqual(chain.map(entry => entry.payload.data.job), [
    { id: null, validationId: validationJobId, submittedAt },
    { id: jobId, validationId: validationJobId, submittedAt },
  ]);
  assert.ok(!JSON.stringify(chain).includes('internal'));
  await assert.rejects(journal.checkpoint({ ...checkpoint, record: { ...record, jobId: 'invalid' } }), /SALESFORCE_CHECKPOINT_JOB_INVALID/);
  assert.equal(records.length, 2);
});

test('Salesforce journal keeps ambiguous provider operations pending across release chains', async () => {
  const records = [];
  const github = { candidateSha: sha, async pages() { return records; }, async write(_path, body) {
    records.push({ id: records.length + 1, creator: { id: 7 }, payload: body.payload });
  } };
  const salesforce = new DeploymentJournal({ github, releaseId: 'salesforce', manifestHash: h, actorIds: [7] });
  const other = new DeploymentJournal({ github, releaseId: 'other', manifestHash: h, actorIds: [7] });
  const save = (operation, status) => salesforce.checkpoint({ fingerprint: h, stage: 'devee', operation, record: { status } });
  await save('deployment', 'submitting');
  await save('validation', 'submitting');
  await save('validation', 'Failed');
  await save('deployment', 'Failed');
  await assert.rejects(other.assertNoUnresolvedOtherRelease(), /EARLIER_RELEASE_OUTCOME_UNRESOLVED/);
  await save('deployment', 'Succeeded');
  await other.assertNoUnresolvedOtherRelease();
});

test('handover accepts verified historical bot chains without accepting bot writes to its own chain', async () => {
  const records = [];
  const github = { async pages() { return records; } };
  const journal = new DeploymentJournal({ github, releaseId: 'setup', manifestHash: h, actorIds: [7], otherReleaseActorIds: [7, 8] });
  const receipt = (releaseId, actor, event = 'release.prepared', data = {}, previous) => {
    const content = { schemaVersion: 1, kind: 'fcos_rapid_release_event', releaseId, manifestHash: h,
      sequence: previous ? 1 : 0, previousHash: previous?.payload.recordHash || null, event, data };
    return { creator: { id: actor }, payload: { ...content, recordHash: digest(content) } };
  };
  records.push(receipt('historical', 8));
  await journal.assertNoUnresolvedOtherRelease();
  records.push(receipt('foreign', 9));
  await assert.rejects(journal.assertNoUnresolvedOtherRelease(), /JOURNAL_ACTOR_MISMATCH/);
  records.pop();
  records.push(receipt('historical', 8, 'stage.intent', { operationId: 'original-stage' }, records[0]));
  await assert.rejects(journal.assertNoUnresolvedOtherRelease(), /EARLIER_RELEASE_OUTCOME_UNRESOLVED/);
  records.pop();
  records.push(receipt('setup', 8));
  await assert.rejects(journal.read(), /JOURNAL_ACTOR_MISMATCH/);
});

test('reviewed schema bootstrap can precede dependent smoke, with one decision and no promotion until full checks pass', async () => {
  const f = fixture();
  f.manifest = createManifest({ candidate: f.manifest.candidate, controllerSha: f.manifest.controllerSha, previous: f.manifest.previous,
    paths: ['supabase/migrations/20990101000000_fixture.sql'], publicEnvironment: f.manifest.build.publicEnvironment, releaseId: f.manifest.releaseId,
    prerequisites: { adapter: 'schema-fixture', adapterDigest: h, plan: { deferSchemaDependentSmoke: true, bootstrapFingerprint: h } } });
  f.approval.manifestHash = digest(f.manifest); let applied = 0, fullChecks = 0;
  f.beforeBootstrap = async () => ({ passed: true, mode: 'pre_bootstrap', manifestHash: digest(f.manifest), deploymentId: f.staged.id,
    buildId: f.build.buildId, isolationVerified: true, businessWrites: 0, bootstrapFingerprint: h, deferredChecks: f.manifest.selection.modules });
  f.smoke = async () => { fullChecks++; throw Error('SCHEMA_DEPENDENT_CHECK_FAILED'); };
  assert.equal((await stageRelease(f)).state, 'awaiting_authorized_bootstrap'); assert.equal(fullChecks, 0);
  assert.equal(f.journal.records.some(row => row.payload.event === 'smoke.passed'), false);
  f.prerequisites = async () => { applied++; return { passed: true, manifestHash: digest(f.manifest), backwardCompatible: true }; };
  await assert.rejects(promoteRelease(f), /SCHEMA_DEPENDENT_CHECK_FAILED/);
  assert.equal(applied, 1); assert.equal(f.calls.includes('promote'), false);
  f.smoke = async () => ({ passed: true, deploymentId: f.staged.id, buildId: f.build.buildId, login: true, restrictedAccess: true,
    businessWrites: 0, normalRole: true, modules: f.manifest.selection.modules });
  assert.equal((await promoteRelease(f)).state, 'complete'); assert.equal(applied, 1);
});
