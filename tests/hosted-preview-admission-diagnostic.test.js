import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { admitPreviewWriterFixture } from './helpers/hosted-vercel-writer.mjs';
import { digest, ReleaseError } from '../scripts/lib/hosted-release/contract.mjs';
import { collectBuildProvenance } from '../scripts/lib/build-provenance.mjs';
import { safeFailure, preparePreview } from '../scripts/lib/hosted-release/controller.mjs';
import { createCoordinatorClient } from '../scripts/lib/hosted-release/coordinator-client.mjs';
import { atReleaseBoundary, safeDiagnosticFailure } from '../scripts/lib/hosted-release/failure.mjs';
import { assertHostedSetup } from '../scripts/lib/hosted-release/admission.mjs';
import { createVercelAdapter, createVercelPreviewAdmissionReader, previewAdmissionReadAllowed } from '../scripts/lib/hosted-release/vercel.mjs';
import { githubClient } from '../scripts/lib/hosted-release/github.mjs';
import { DIAGNOSTIC_REF, DIAGNOSTIC_WORKFLOW, DIAGNOSTIC_JOB, verifyDiagnosticCaller, previewAdmissionDiagnostic } from '../scripts/hosted-preview-admission-diagnostic.mjs';

function adapterFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-admission-diagnostic-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'package-lock.json'), '{}\n');
  writeFileSync(join(directory, '.gitignore'), '.vercel/\n');
  writeFileSync(join(directory, 'vercel.json'), JSON.stringify({ git: { deploymentEnabled: false } }));
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const source = collectBuildProvenance({ cwd: directory, env: {}, requireClean: true });
  const manifest = fixtureManifest(), H = 'a'.repeat(64);
  manifest.stage = 'application'; manifest.candidate.sha = source.commit; manifest.candidate.sourceSha256 = source.sourceDigest;
  manifest.candidate.lockSha256 = digest('{}\n'); manifest.scope.handoffs = [{ kind: 'status19', sha256: H }, { kind: 'supplier16', sha256: H }];
  manifest.scope.compatibilityProductionObservationSha256 = H; manifest.requiredChecks.push('compatibility_production_observation');
  const settings = { framework: 'vite', buildCommand: 'npm run build', devCommand: null, installCommand: 'npm ci', outputDirectory: 'dist', rootDirectory: null, nodeVersion: '24.x' };
  manifest.verification = { runtime: { image: `ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`, node: 'v24.18.0', python: 'Python 3.11.2', platform: 'linux', arch: 'x64' }, publicBuildEnvironment: {}, projectSettings: settings };
  const writer = admitPreviewWriterFixture(manifest), calls = [], boundaries = [];
  const project = { ...settings, id: manifest.targets.vercelProject, accountId: manifest.targets.vercelTeam, name: 'fcos',
    link: { type: 'github', org: 'hocheunglai-oss', repo: 'fcos', productionBranch: 'main', deployHooks: [] }, autoAssignCustomDomains: false };
  const options = { manifest, candidateDirectory: directory, env: writer.env, observeBoundary: name => boundaries.push(name),
    execute: (file, args, options) => {
      calls.push({ kind: 'cli', file, args }); assert.equal(args[0], '--version');
      assert.equal(args.length, 6); assert.equal(options.env.VERCEL_TOKEN, undefined);
      return 'Vercel CLI 54.20.1';
    }, fetchImpl: async (url, request) => {
      calls.push({ kind: 'fetch', path: url.pathname, method: request.method });
      assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'error'); assert.equal(previewAdmissionReadAllowed(url, manifest.targets), true);
      if (url.pathname.startsWith('/v2/')) return { status: url.pathname === '/v2/user' ? 404 : 403, redirected: false };
      const value = url.pathname === '/v9/projects' ? { projects: [{ id: manifest.targets.vercelProject }], pagination: { count: 1, next: null } } : project;
      return { ok: true, redirected: false, json: async () => value };
    } };
  return { directory, manifest, writer, calls, boundaries, options };
}

test('actual setup98d and public writer acceptance validate at the original failure time without secrets', t => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/preview-admission-98d-public.json', import.meta.url)));
  t.mock.method(Date, 'now', () => Date.parse(fixture.observedFailureAt));
  assert.equal(digest(fixture.setup), '98d8a3dc58a0a274b0579128c36a9d224b18b1e93a03e27b61c3b451d73c5782');
  assert.equal(fixture.manifest.controller.sha, '6a3fbd8fd05a76c052e7e380d618aedf43e5b72e');
  assertHostedSetup({ manifest: fixture.manifest, env: { FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(fixture.setup), FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(fixture.setup) } });
});

test('admission-only capability has no write methods and runs only fixed GETs/version in its temporary checkout', async t => {
  const f = adapterFixture(t), reader = createVercelPreviewAdmissionReader(f.options);
  assert.deepEqual(Object.keys(reader), ['admit']); assert.equal(Object.isFrozen(reader), true);
  const result = await reader.admit(); assert.equal(result.effectiveAccess.projectCount, 1);
  assert.equal(f.calls.filter(call => call.kind === 'cli').length, 1);
  assert.equal(f.calls.filter(call => call.kind === 'fetch').length, 4);
  assert.equal(f.boundaries.at(-1), 'vercel.local_link');
  assert.deepEqual(JSON.parse(readFileSync(join(f.directory, '.vercel/project.json'))), { projectId: f.manifest.targets.vercelProject, orgId: f.manifest.targets.vercelTeam, projectName: 'fcos' });
});

test('diagnostic route policy rejects writes, other targets, credential routes, decryption and query smuggling', () => {
  const target = fixtureManifest().targets;
  for (const path of ['/v13/deployments', '/v9/projects/another', '/v5/user/tokens/current', `/v10/projects/${target.vercelProject}/env?decrypt=true&teamId=${target.vercelTeam}`,
    `/v9/projects?limit=100&teamId=${target.vercelTeam}&teamId=${target.vercelTeam}`, `/v1/env?projectId=another&teamId=${target.vercelTeam}`, '/v2/user?secret=hidden', '/v2/user#extra'])
    assert.equal(previewAdmissionReadAllowed(new URL('https://api.vercel.com' + path), target), false, path);
  assert.equal(previewAdmissionReadAllowed(new URL('https://other.invalid/v2/user'), target), false);
  for (const path of [`/v10/projects/${target.vercelProject}/env?decrypt=false&teamId=${target.vercelTeam}&until=1`, `/v1/env?projectId=${target.vercelProject}&teamId=${target.vercelTeam}`])
    assert.equal(previewAdmissionReadAllowed(new URL('https://api.vercel.com' + path), target), true);
});

test('substituted secret retains its safe code/boundary and performs zero external or CLI calls', async t => {
  const f = adapterFixture(t), sensitive = 'vcp_' + 'SENSITIVE'.repeat(10);
  const reader = createVercelPreviewAdmissionReader({ ...f.options, env: { ...f.options.env, FCOS_HOSTED_VERCEL_TOKEN: sensitive } });
  let error; try { await reader.admit(); } catch (value) { error = value; }
  assert.deepEqual(safeFailure(error), { status: 'intervention_required', code: 'VERCEL_WRITER_CREDENTIAL_SUBSTITUTED', phase: 'vercel.preview',
    recovery: 'Correct the existing Preview credential binding through its original owner; do not retry a provider write.', boundary: 'vercel.credential' });
  assert.equal(JSON.stringify(safeFailure(error)).includes(sensitive), false); assert.equal(f.calls.length, 0);
});

test('ordinary provenance error retains source boundary without paths, source contents or subprocess stderr', async t => {
  const f = adapterFixture(t); writeFileSync(join(f.directory, 'package-lock.json'), 'SENSITIVE_CHANGED_SOURCE');
  await assert.rejects(createVercelPreviewAdmissionReader(f.options).admit(), error => {
    const report = safeFailure(error); assert.equal(report.code, 'RELEASE_BOUNDARY_FAILED'); assert.equal(report.boundary, 'vercel.source');
    assert.equal(JSON.stringify(report).includes(f.directory), false); assert.equal(JSON.stringify(report).includes('SENSITIVE'), false); return true;
  }); assert.equal(f.calls.length, 0);
});

test('invalid provider JSON, redirect and CLI failure stay classified with no retry', async t => {
  const f = adapterFixture(t);
  for (const [response, code] of [[{ ok: true, json: async () => { throw new Error('SECRET raw response'); } }, 'VERCEL_READ_JSON_INVALID'], [{ redirected: true }, 'VERCEL_READ_REDIRECT']]) {
    let calls = 0;
    await assert.rejects(createVercelPreviewAdmissionReader({ ...f.options, fetchImpl: async () => { calls++; return response; } }).admit(), error => {
      assert.equal(error.code, code); assert.equal(error.boundary, 'vercel.project'); assert.equal(JSON.stringify(safeFailure(error)).includes('SECRET'), false); return true;
    }); assert.equal(calls, 1);
  }
  await assert.rejects(createVercelPreviewAdmissionReader({ ...f.options, execute: () => { throw new Error('SECRET stderr'); } }).admit(), { code: 'VERCEL_COMMAND_UNRESOLVED', boundary: 'vercel.version' });
});

test('local link refuses symlinks and malformed JSON after reads without writing outside the candidate', async t => {
  const f = adapterFixture(t), outside = mkdtempSync(join(tmpdir(), 'fcos-admission-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true })); symlinkSync(outside, join(f.directory, '.vercel'));
  await assert.rejects(createVercelPreviewAdmissionReader(f.options).admit(), { code: 'RELEASE_BOUNDARY_FAILED', boundary: 'vercel.source' });
  rmSync(join(f.directory, '.vercel')); mkdirSync(join(f.directory, '.vercel')); writeFileSync(join(f.directory, '.vercel/project.json'), 'SECRET malformed');
  await assert.rejects(createVercelPreviewAdmissionReader(f.options).admit(), error => error.boundary === 'vercel.local_link' && !JSON.stringify(safeFailure(error)).includes('SECRET'));
});

test('normal release adapter still refuses a diagnostic caller context', async t => {
  const f = adapterFixture(t);
  await assert.rejects(createVercelAdapter({ ...f.options, env: { ...f.options.env, GITHUB_REF: DIAGNOSTIC_REF } }).admit(f.manifest, 'preview'), { code: 'HOSTED_CONTROLLER_REQUIRED' });
  assert.equal(f.calls.length, 0);
});

function callerFixture() {
  const sha = 'd'.repeat(40), repository = fixtureManifest().targets.repository, branchName = DIAGNOSTIC_REF.slice(11);
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: '1278654816', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: DIAGNOSTIC_REF, GITHUB_REF_PROTECTED: 'true', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '123', GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha,
    GITHUB_WORKFLOW_REF: `${repository}/${DIAGNOSTIC_WORKFLOW}@${DIAGNOSTIC_REF}`, FCOS_DIAGNOSTIC_SOURCE_SHA: 'e'.repeat(40), GITHUB_ACTOR: 'hocheunglai-oss', GITHUB_ACTOR_ID: '456',
    FCOS_HOSTED_ENVIRONMENT: 'fcos-hosted-preview', FCOS_HOSTED_CREDENTIAL_CLASS: 'preview' };
  const run = { id: 123, repository: { full_name: repository, id: 1278654816 }, head_repository: { full_name: repository }, head_sha: sha, head_branch: branchName,
    event: 'workflow_dispatch', run_attempt: 1, status: 'in_progress', conclusion: null, path: DIAGNOSTIC_WORKFLOW,
    actor: { login: 'hocheunglai-oss', id: 456 }, triggering_actor: { login: 'hocheunglai-oss', id: 456 } };
  const branch = { name: branchName, protected: true, commit: { sha } }, protection = { enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } };
  const jobs = [{ name: DIAGNOSTIC_JOB, status: 'in_progress', conclusion: null, head_sha: sha, run_id: 123 }];
  const github = { identity: async () => ({}), read: async path => path.endsWith('/protection') ? protection : path.includes('/branches/') ? branch : run, pages: async () => jobs };
  return { env, run, branch, protection, jobs, github };
}

test('actual diagnostic caller is bound independently; old caller, rerun, wrong actor/protection/job refuse', async () => {
  const f = callerFixture(); assert.equal((await verifyDiagnosticCaller(f)).callerSha, f.env.GITHUB_SHA);
  for (const mutate of [x => { x.env.GITHUB_REF = 'refs/heads/main'; }, x => { x.env.GITHUB_RUN_ATTEMPT = '2'; }, x => { x.env.GITHUB_WORKFLOW_SHA = 'a'.repeat(40); },
    x => { x.run.triggering_actor.login = 'another'; }, x => { x.branch.commit.sha = 'a'.repeat(40); }, x => { x.protection.allow_force_pushes.enabled = true; },
    x => { x.jobs.push({ ...x.jobs[0] }); }, x => { x.jobs[0].head_sha = 'a'.repeat(40); }]) {
    const x = callerFixture(); mutate(x); await assert.rejects(verifyDiagnosticCaller(x), error => error.code.startsWith('DIAGNOSTIC_CALLER_'));
  }
});

test('diagnostic invalid input produces only sanitized data and never reaches a provider', async () => {
  let calls = 0; const result = await previewAdmissionDiagnostic({ env: { FCOS_RELEASE_MANIFEST: 'SECRET not JSON' }, fetchImpl: async () => { calls++; }, execute: () => { calls++; } });
  assert.equal(result.code, 'MANIFEST_JSON'); assert.equal(result.providerSubmissionStarted, false); assert.equal(result.releaseAdmission, false);
  assert.equal(calls, 0); assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('known coordinator rejection survives; arbitrary provider text and lost response are sanitized without retry', async () => {
  for (const [body, expected] of [[{ error: 'COORDINATION_SOURCE_UPGRADE_NOT_HELD' }, 'COORDINATION_SOURCE_UPGRADE_NOT_HELD'], [{ error: 'SECRET response' }, 'COORDINATION_REQUEST_REJECTED']]) {
    let calls = 0; const client = createCoordinatorClient({ url: 'https://coordinator.invalid/coordinate', epoch: 1, owner: { kind: 'release', id: 'features' }, tokenProvider: async () => 'synthetic',
      fetch: async () => { calls++; return { ok: false, status: 409, json: async () => body }; } });
    await assert.rejects(client.snapshot({ releaseId: 'test' }), error => {
      const report = safeFailure(error); assert.equal(report.code, expected); assert.equal(report.phase, 'coordinator.snapshot'); assert.equal(JSON.stringify(report).includes('SECRET'), false); return true;
    }); assert.equal(calls, 1);
  }
});

test('plain preflight failures stop before begin and provider submit; failures preserve innermost fixed boundary', async () => {
  const events = [], manifest = fixtureManifest();
  for (const phase of ['register', 'snapshot', 'admit']) {
    const coordinator = { register: async () => { if (phase === 'register') throw new Error('SECRET register'); }, snapshot: async () => { if (phase === 'snapshot') throw new Error('SECRET snapshot'); return {}; }, begin: async () => events.push('begin') };
    const provider = { admit: async () => { throw new Error('SECRET admission'); }, createPreview: async () => events.push('create') };
    await assert.rejects(preparePreview({ manifest, coordinator, provider }), error => error.boundary === `preview.${phase}` && !JSON.stringify(safeFailure(error)).includes('SECRET'));
  }
  assert.deepEqual(events, []);
  const original = new ReleaseError('KNOWN_CODE', 'known', 'known recovery');
  assert.throws(() => atReleaseBoundary('preview.admit', () => atReleaseBoundary('vercel.source', () => { throw original; })), error => error.boundary === 'vercel.source');
  assert.equal(safeFailure(Object.assign(new Error('SECRET'), { code: 'SECRET', phase: 'SECRET', boundary: 'SECRET' })).phase, 'unknown');
});

test('GitHub malformed metadata stays classified and does not expose response bytes', async () => {
  const github = githubClient({ token: 'synthetic', repositoryId: '1278654816', fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('SECRET response'); } }) });
  await assert.rejects(github.identity(), error => safeFailure(error).code === 'GITHUB_RESPONSE_INVALID' && !JSON.stringify(safeFailure(error)).includes('SECRET'));
});

test('refusal emits local/console evidence only and cannot trigger an artifact or provider follow-up', () => {
  const workflow = readFileSync(new URL('./fixtures/hosted-preview-admission-diagnostic-workflow.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if: \$\{\{ success\(\) && steps\.diagnostic\.outcome == 'success' \}\}/);
  assert.doesNotMatch(workflow, /always\(\)|continue-on-error|cleanup/);
  const source = readFileSync(new URL('../scripts/hosted-preview-admission-diagnostic.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createCoordinatorClient|\.register\(|\.begin\(|\.claim\(|\.createPreview\(|\.promote\(|\.rollback\(/);
  assert.match(source, /report.status !== 'admission_passed'\) process.exitCode = 1/);
});

test('diagnostic projection redacts forged typed errors and never copies recovery or arbitrary phase', () => {
  for (const error of [new Error('SECRET plain'), new ReleaseError('SECRET_CODE', 'SECRET_PHASE', 'SECRET_RECOVERY'),
    Object.assign(new ReleaseError('VERCEL_WRITER_CREDENTIAL_SUBSTITUTED', 'SECRET_PHASE', 'SECRET_RECOVERY'), { boundary: 'vercel.credential' })]) {
    const report = safeDiagnosticFailure(error); assert.equal(JSON.stringify(report).includes('SECRET'), false);
    assert.equal(report.recovery, 'Inspect this admission diagnostic. It authorizes no deployment or release retry.');
  }
});


test('diagnostic projection preserves all six configuration-selection refusal codes without raw values', () => {
  const codes = ['CONFIGURATION_SELECTION_SOURCE_INVALID', 'CONFIGURATION_SELECTION_ENTRY_INVALID',
    'CONFIGURATION_SELECTION_SYSTEM_ENV_REQUIRED', 'CONFIGURATION_SELECTION_ENV_INCOMPLETE',
    'CONFIGURATION_SELECTION_ENV_OVERRIDE', 'CONFIGURATION_SELECTION_ROOT_CHANGED'];
  for (const [index, code] of codes.entries()) {
    const boundary = index < 2 ? 'vercel.selection_source' : 'vercel.selection_environment';
    let error;
    try { atReleaseBoundary(boundary, () => { throw new ReleaseError(code, 'admission', 'SECRET raw configuration value'); }); }
    catch (value) { error = value; }
    const report = safeDiagnosticFailure(error);
    assert.equal(report.code, code); assert.equal(report.boundary, boundary); assert.equal(report.phase, 'admission');
    assert.equal(JSON.stringify(report).includes('SECRET'), false);
  }
});
