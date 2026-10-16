import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, SignJWT } from 'jose';
import { qualificationSourceBinding, validateQualificationSource } from '../config/hostedReleaseQualification.js';
import { assertHostedController, assertHostedSetup } from '../scripts/lib/hosted-release/admission.mjs';
import { validateHostedIdentity, validateQualificationRun } from '../scripts/lib/hosted-release/github.mjs';
import { assertHostedJob } from '../scripts/lib/hosted-release/publisher.mjs';
import { buildReleaseManifest } from '../scripts/lib/hosted-release/manifest.mjs';
import { digest, validateManifest } from '../scripts/lib/hosted-release/contract.mjs';
import { prepareHostedManifest } from '../scripts/hosted-release-manifest.mjs';
import { runQualification } from '../scripts/hosted-release-qualification.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';

const repository = 'hocheunglai-oss/fcos', repositoryId = '1278654816', B = 'd'.repeat(40), H = 'a'.repeat(64);
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-qualification-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  git(['init','-q']); writeFileSync(join(directory, 'controller.txt'), 'trusted controller\n'); git(['add','.']);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture']);
  const controllerSha = git(['rev-parse','HEAD']);
  const manifest = fixtureManifest(); manifest.stage = 'qualification'; manifest.executionMode = 'qualification'; manifest.controller.sha = controllerSha;
  const source = { ref: 'refs/heads/fcos-qualification-reviewed', bootstrapSha: B,
    callerWorkflowRef: `${repository}/.github/workflows/authenticated-release.yml@refs/heads/fcos-qualification-reviewed`,
    controllerSha, candidateSha: manifest.candidate.sha };
  manifest.qualificationSource = source;
  const setup = { schemaVersion: 2, controllerSha, targetsSha256: digest(manifest.targets), epoch: manifest.epoch,
    previousProduction: manifest.previousProduction, qualificationSource: source,
    verification: { runtime: { image: `ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`, node: 'v24.18.0', python: 'Python 3.11.2', platform: 'linux', arch: 'x64' },
      publicBuildEnvironment: {}, projectSettings: {} } };
  manifest.verification = setup.verification; manifest.setupSha256 = digest(setup);
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: repositoryId,
    GITHUB_REF: source.ref, GITHUB_REF_PROTECTED: 'true', GITHUB_SHA: B, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '17', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_ACTOR: 'hocheunglai-oss', GITHUB_ACTOR_ID: '12345', FCOS_CONTROLLER_SHA: controllerSha, FCOS_CANDIDATE_SHA: manifest.candidate.sha,
    FCOS_CONTROLLER_DIRECTORY: directory, FCOS_CANDIDATE_DIRECTORY: join(directory, 'not-checked-out'), FCOS_RELEASE_OUTPUT: join(directory, 'must-not-exist.json'),
    FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(setup), FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(setup),
    FCOS_HOSTED_QUALIFICATION_ADMITTED: 'true', FCOS_QUALIFICATION_BOOTSTRAP: 'true',
    FCOS_RELEASE_PLAN: JSON.stringify({ schemaVersion: 2, stage: 'qualification', sourceProfile: 'application_v2' }) };
  const run = { id: 17, repository: { full_name: repository, id: Number(repositoryId) }, head_repository: { full_name: repository },
    head_branch: source.ref.slice('refs/heads/'.length), head_sha: B, path: '.github/workflows/authenticated-release.yml', event: 'workflow_dispatch', run_attempt: 1,
    status: 'in_progress', conclusion: null, actor: { login: env.GITHUB_ACTOR, id: 12345 }, triggering_actor: { login: env.GITHUB_ACTOR, id: 12345 },
    referenced_workflows: [{ path: `${repository}/${manifest.controller.workflow}@${controllerSha}`, sha: controllerSha }] };
  const branch = { name: run.head_branch, protected: true, commit: { sha: B } };
  const protection = { enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } };
  const calls = [];
  const github = { identity: async () => { calls.push('identity'); return run.repository; }, read: async path => {
    calls.push(path);
    if (path === `/repos/${repository}/actions/runs/17`) return run;
    if (path === `/repos/${repository}/branches/${encodeURIComponent(run.head_branch)}`) return branch;
    if (path === `/repos/${repository}/branches/${encodeURIComponent(run.head_branch)}/protection`) return protection;
    assert.fail(`unexpected metadata read ${path}`);
  } };
  return { directory, controllerSha, manifest, source, setup, env, run, branch, protection, calls, github };
}

test('exact five-field qualification source cannot authorize release or forged candidate/controller identity', t => {
  const f = fixture(t);
  assert.equal(qualificationSourceBinding(f.manifest), f.source); validateManifest(f.manifest);
  for (const change of [{ extra: true }, { ref: 'refs/heads/main' }, { bootstrapSha: 'moving' }, { callerWorkflowRef: `${repository}/.github/workflows/hosted-release.yml@${f.source.ref}` }]) {
    assert.throws(() => validateQualificationSource({ ...f.source, ...change }), { code: 'QUALIFICATION_SOURCE_INVALID' });
  }
  for (const change of [{ stage: 'compatibility', executionMode: 'release' }, { stage: 'qualification', executionMode: 'release' },
    { candidate: { ...f.manifest.candidate, sha: 'e'.repeat(40) } }, { controller: { ...f.manifest.controller, sha: 'e'.repeat(40) } }]) {
    assert.throws(() => qualificationSourceBinding({ ...f.manifest, ...change }), { code: 'QUALIFICATION_SOURCE_INVALID' });
  }
  assert.throws(() => assertHostedSetup({ manifest: { ...f.manifest, qualificationSource: { ...f.source, bootstrapSha: 'e'.repeat(40) } }, env: f.env }), { code: 'ADMITTED_SETUP_CHANGED' });
});

test('actual dispatch entrypoint validates admitted bootstrap before candidate checkout or provider observation', async t => {
  const f = fixture(t); let providers = 0;
  const result = await prepareHostedManifest({ env: f.env, validateDispatchOnly: true, createGithub: () => f.github,
    prepareManifest: async () => { providers++; assert.fail('no provider/candidate work admitted'); } });
  assert.deepEqual(result, { status: 'passed', phase: 'dispatch.admission', executionMode: 'qualification' });
  assert.equal(providers, 0); assert.equal(existsSync(f.env.FCOS_CANDIDATE_DIRECTORY), false); assert.equal(existsSync(f.env.FCOS_RELEASE_OUTPUT), false);
  assert.equal(f.calls.length, 4);
  f.branch.commit.sha = 'e'.repeat(40);
  await assert.rejects(prepareHostedManifest({ env: f.env, validateDispatchOnly: true, createGithub: () => f.github }), { code: 'QUALIFICATION_SOURCE_DRIFT' });
});

test('bootstrap CLI rejects release-mode and mismatched resume without metadata or candidate access', async t => {
  const f = fixture(t), releasePlan = JSON.stringify({ schemaVersion: 2, stage: 'compatibility' });
  const result = spawnSync(process.execPath, ['scripts/hosted-release-manifest.mjs','--validate-dispatch-only'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH, ...f.env, FCOS_RELEASE_PLAN: releasePlan },
  });
  assert.equal(result.status, 1); assert.deepEqual(JSON.parse(result.stderr), { status: 'intervention_required', code: 'QUALIFICATION_BOOTSTRAP_ONLY' });
  await assert.rejects(prepareHostedManifest({ env: { ...f.env, FCOS_RELEASE_PLAN: '', FCOS_RESUME_MANIFEST: JSON.stringify({ ...f.manifest, candidate: { ...f.manifest.candidate, sha: 'e'.repeat(40) }, qualificationSource: { ...f.source, candidateSha: 'e'.repeat(40) } }) },
    validateDispatchOnly: true, createGithub: () => assert.fail('resume mismatch precedes reads') }), { code: 'RESUME_MANIFEST_CHANGED' });
  assert.equal(existsSync(f.env.FCOS_RELEASE_OUTPUT), false);
});

test('normal main dispatch retains its existing identity and needs no qualification metadata token', async t => {
  const f = fixture(t), env = { ...f.env, GITHUB_REF: 'refs/heads/main', FCOS_QUALIFICATION_BOOTSTRAP: '',
    FCOS_HOSTED_QUALIFICATION_ADMITTED: '', FCOS_RELEASE_PLAN: JSON.stringify({ schemaVersion: 2, stage: 'compatibility' }) };
  assert.deepEqual(await prepareHostedManifest({ env, validateDispatchOnly: true, createGithub: () => assert.fail('main has no new metadata requirement') }),
    { status: 'passed', phase: 'dispatch.admission', executionMode: 'release' });
  assert.throws(() => assertHostedController({ controllerDirectory: f.directory, controllerSha: f.controllerSha, manifest: fixtureManifest(), env: f.env }), { code: 'QUALIFICATION_BOOTSTRAP_ONLY' });
  await assert.rejects(prepareHostedManifest({ env: { ...f.env, FCOS_HOSTED_QUALIFICATION_ADMITTED: '' }, validateDispatchOnly: true }), { code: 'QUALIFICATION_SOURCE_CONTEXT' });
  for (const environment of ['fcos-production-release', 'fcos-hosted-production-resume']) {
    await assert.rejects(prepareHostedManifest({ env: { ...f.env, FCOS_HOSTED_ENVIRONMENT: environment }, validateDispatchOnly: true }), { code: 'QUALIFICATION_PRODUCTION_ENVIRONMENT_FORBIDDEN' });
  }
});

test('live qualification source refuses protection, run, operator or immutable-controller drift', async t => {
  const f = fixture(t);
  assert.equal(await validateQualificationRun({ github: f.github, source: f.source, run: f.run, env: f.env }), true);
  for (const change of [{ head_sha: 'e'.repeat(40) }, { run_attempt: 2 }, { conclusion: 'success' }, { status: 'completed' },
    { path: '.github/workflows/hosted-release.yml' }, { repository: { full_name: repository, id: 1 } },
    { triggering_actor: { login: 'someone', id: 12345 } }, { referenced_workflows: [] },
    { referenced_workflows: [...f.run.referenced_workflows, ...f.run.referenced_workflows] }]) {
    await assert.rejects(validateQualificationRun({ github: f.github, source: f.source, run: { ...f.run, ...change }, env: f.env }), { code: 'QUALIFICATION_SOURCE_DRIFT' });
  }
  for (const name of ['enforce_admins','allow_force_pushes','allow_deletions']) {
    const original = f.protection[name].enabled; f.protection[name].enabled = !original;
    await assert.rejects(validateQualificationRun({ github: f.github, source: f.source, run: f.run, env: f.env }), { code: 'QUALIFICATION_SOURCE_DRIFT' });
    f.protection[name].enabled = original;
  }
});

test('signed OIDC alternate source binds bootstrap SHA/caller and never broadens the main identity', async t => {
  const f = fixture(t), { privateKey, publicKey } = await generateKeyPair('RS256'), now = Date.now();
  const claims = { repository, repository_id: repositoryId, repository_owner: 'hocheunglai-oss', ref: f.source.ref, sha: B, ref_protected: 'true',
    workflow_ref: f.source.callerWorkflowRef, workflow_sha: B, event_name: 'workflow_dispatch', run_id: '17', run_attempt: '1',
    job_workflow_sha: f.controllerSha, job_workflow_ref: `${repository}/${f.manifest.controller.workflow}@${f.controllerSha}` };
  const signed = async overrides => new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: 'RS256' }).setIssuer('https://token.actions.githubusercontent.com')
    .setAudience('fcos-release-coordinator').setIssuedAt(Math.floor(now/1000)).setExpirationTime(Math.floor(now/1000)+300).sign(privateKey);
  const options = { controllerSha: f.controllerSha, repositoryId, runId: '17', keySet: publicKey, now, qualificationSource: f.source };
  assert.equal((await validateHostedIdentity(await signed({}), options)).ref, f.source.ref);
  await assert.rejects(validateHostedIdentity(await signed({}), { ...options, qualificationSource: undefined }), { code: 'HOSTED_IDENTITY_BINDING' });
  for (const change of [{ ref: 'refs/heads/main' }, { sha: 'e'.repeat(40) }, { workflow_sha: 'e'.repeat(40) }, { workflow_ref: `${repository}/.github/workflows/hosted-release.yml@${f.source.ref}` }, { job_workflow_sha: B }]) {
    await assert.rejects(validateHostedIdentity(await signed(change), options), { code: 'HOSTED_IDENTITY_BINDING' });
  }
  for (const environment of ['fcos-production-release', 'fcos-hosted-production-resume']) {
    await assert.rejects(validateHostedIdentity(await signed({ environment }), options), { code: 'HOSTED_IDENTITY_BINDING' });
    await assert.rejects(validateHostedIdentity(await signed({}), { ...options, environment }), { code: 'HOSTED_IDENTITY_BINDING' });
  }
  assert.equal((await validateHostedIdentity(await signed({ ref: 'refs/heads/main' }), { ...options, qualificationSource: undefined })).ref, 'refs/heads/main');
});

test('qualification manifest preparation copies only reviewed source binding and rejects source/mode mismatch', t => {
  const f = fixture(t), plan = { ...f.manifest, schemaVersion: 2, branch: f.manifest.candidate.branch, sourceProfile: 'application_v2' };
  const args = { setup: f.setup, plan, previousProduction: f.manifest.previousProduction, controllerSha: f.controllerSha, candidateSha: f.manifest.candidate.sha,
    collectSource: () => ({ candidate: f.manifest.candidate, controller: f.manifest.controller, checks: [{ id: 'unit' }] }) };
  const actual = buildReleaseManifest(args); assert.deepEqual(actual.qualificationSource, f.source); assert.equal(actual.setupSha256, digest(f.setup));
  assert.throws(() => buildReleaseManifest({ ...args, candidateSha: 'e'.repeat(40) }), { code: 'QUALIFICATION_SOURCE_INVALID' });
  assert.throws(() => buildReleaseManifest({ ...args, plan: { ...plan, executionMode: 'release' } }), { code: 'MANIFEST_SCHEMA' });
});

test('qualification artifact publisher accepts only exact bootstrap job/source while Production stays main-only', t => {
  const f = fixture(t), run = { ...f.run }, start = '2026-10-17T00:00:00Z', end = '2026-10-17T00:01:00Z';
  const job = { id: 18, run_id: run.id, run_attempt: 1, head_sha: B, name: 'release / qualify', status: 'completed', conclusion: 'success',
    started_at: start, completed_at: end, steps: [{ name: 'Run admitted checks', status: 'completed', conclusion: 'success' }] };
  const artifact = { id: 19, expired: false, workflow_run: { id: run.id, head_sha: B }, digest: `sha256:${H}`, archiveSha256: H, created_at: end };
  const args = { manifest: f.manifest, run, job, artifact, expectedJobName: job.name, controllerSha: f.controllerSha };
  assert.equal(assertHostedJob(args), true);
  for (const change of [{ head_branch: 'main' }, { head_sha: 'e'.repeat(40) }, { run_attempt: 2 }, { path: '.github/workflows/hosted-release.yml' }]) {
    assert.throws(() => assertHostedJob({ ...args, run: { ...run, ...change } }));
  }
  const normal = fixtureManifest(); normal.controller.sha = f.controllerSha;
  assert.throws(() => assertHostedJob({ ...args, manifest: normal }), { code: 'PRODUCER_JOB_NOT_SUCCESSFUL' });
});

test('hosted qualification simulation rejects self-authorized setup before OIDC/coordinator/provider work', async t => {
  const f = fixture(t), badSetup = { ...f.setup, qualificationSource: { ...f.source, bootstrapSha: 'e'.repeat(40) } };
  await assert.rejects(runQualification({ manifest: f.manifest, simulateProduction: true, context: 'hosted',
    env: { ...f.env, FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(badSetup) }, repositoryId,
    coordinator: { snapshot: () => assert.fail('forged setup cannot contact coordinator') } }), { code: 'ADMITTED_SETUP_CHANGED' });
});
