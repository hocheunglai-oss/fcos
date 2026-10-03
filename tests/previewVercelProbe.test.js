import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { probePreviewVercelAuthority, collectPreviewVercelAuthority } from '../scripts/lib/preview-vercel-authority.mjs';
import { previewEmailBuildArguments } from '../scripts/preview-email-proof-build.mjs';

const now = Date.parse('2026-10-03T02:00:00.000Z');
const teamId = fcosConnectionIdentifier('vercel', 'Team ID'), projectId = fcosConnectionIdentifier('vercel', 'Project ID');
const reviewedTokenId = 'reviewed-fixture-id', privateMarker = 'private-fixture-secret';
const currentPath = '/v5/user/tokens/current', reviewedPath = `/v5/user/tokens/${reviewedTokenId}`;
const paths = [currentPath, reviewedPath, '/v9/projects?limit=100', '/v2/user', `/v2/teams/${teamId}`, `/v9/projects/${projectId}?teamId=${teamId}`];
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const project = { id: projectId, name: 'fcos', accountId: teamId,
  link: { type: 'github', org: 'hocheunglai-oss', repo: 'fcos' } };
const metadata = { id: reviewedTokenId, createdAt: now - 1000, expiresAt: now + 3600000,
  projectId, scopes: [{ type: 'team', teamId }], privateValue: privateMarker };
function fixture(overrides = {}) {
  const requests = [];
  const options = { token: privateMarker, reviewedTokenId, now: () => now, fetchImpl: async (url, request) => {
    const path = new URL(url).pathname + new URL(url).search;
    requests.push({ path, url, request });
    assert.ok(paths.includes(path));
    if (overrides[path]) return overrides[path]();
    if (path === currentPath) return response({ error: { code: 'not_found', message: privateMarker } }, 404);
    if (path === reviewedPath) return response({ token: metadata });
    if (path === '/v9/projects?limit=100') return response({ projects: [project], pagination: { count: 1, next: null } });
    if (path === '/v2/user' || path === `/v2/teams/${teamId}`) return response({ error: { code: 'forbidden' } }, 403);
    return response(project);
  } };
  return { options, requests };
}

test('same-secret probe makes exactly six fixed GETs and never treats readable reviewed metadata as bearer binding', async () => {
  const value = fixture(), result = await probePreviewVercelAuthority(value.options);
  assert.deepEqual(value.requests.map(row => row.path), paths);
  for (const { url, request, path } of value.requests) {
    assert.equal(new URL(url).origin, 'https://api.vercel.com');
    assert.equal(request.method, 'GET'); assert.equal(request.body, undefined);
    assert.equal(request.headers.authorization, `Bearer ${privateMarker}`);
    assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(new URL(url).searchParams.has('teamId'), path === paths.at(-1));
  }
  assert.equal(result.bearerBinding, 'unproven');
  assert.deepEqual(result.checks.current_metadata, { httpStatus: 404, errorCategory: 'not_found' });
  assert.equal(result.checks.reviewed_metadata.reviewedTokenIdMatches, true);
  assert.equal(result.checks.reviewed_metadata.metadataPolicyMatches, true);
  assert.equal(result.checks.exact_project.pinnedProjectIdentityMatches, true);
  assert.equal(result.checks.project_list.completePinnedProjectOnly, true);
  assert.deepEqual(result.credentialShape, { personalTokenPrefixRecognized: false, credentialWhitespacePresent: false });
  assert.equal(result.readOnly, true); assert.equal(result.previewAuthorized, false); assert.equal(result.productionAuthorized, false);
  assert.ok(!JSON.stringify(result).includes(privateMarker));
  assert.ok(!JSON.stringify(result).includes(reviewedTokenId));
  assert.ok(!JSON.stringify(result).includes(projectId));
  assert.equal(result.authority, undefined); assert.equal(result.reviewedTokenBinding, undefined);
  // The unchanged deployment collector still stops after the one failed read.
  const legacy = fixture();
  await assert.rejects(() => collectPreviewVercelAuthority({ ...legacy.options,
    readProject: () => assert.fail('No project fallback may authorize deployment.') }));
  assert.equal(legacy.requests.length, 1);
});

test('probe distinguishes observed self mismatch and self match while granting no authority even for invalid metadata', async () => {
  for (const [token, expected] of [
    [{ ...metadata, id: 'another-token' }, 'mismatch'], [metadata, 'matched'],
    [{ ...metadata, expiresAt: now }, 'matched'], [{ ...metadata, scopes: [{ type: 'user' }] }, 'matched'],
    [{ ...metadata, projectId: 'other' }, 'matched'], [{}, 'unproven'], [null, 'unproven'],
    [{ ...metadata, id: privateMarker + '/bad' }, 'unproven'],
  ]) {
    const value = fixture({ [currentPath]: () => response({ token }) }), result = await probePreviewVercelAuthority(value.options);
    assert.equal(result.bearerBinding, expected);
    assert.equal(result.previewAuthorized, false); assert.equal(result.productionAuthorized, false);
    assert.equal(value.requests.length, 6);
    assert.ok(!JSON.stringify(result).includes(privateMarker));
    if (token?.expiresAt === now || token?.scopes?.[0]?.type === 'user') assert.equal(result.checks.current_metadata.metadataPolicyMatches, false);
  }
});

test('transport, redirects, oversized bodies, malformed JSON and unknown errors stay bounded and redacted', async () => {
  const exception = {};
  for (const key of ['message', 'stack', 'code', 'cause']) Object.defineProperty(exception, key, { get() { assert.fail('Private exception inspected.'); } });
  for (const replacement of [
    () => { throw exception; }, () => ({ redirected: true, status: 200 }),
    () => Object.defineProperty({ redirected: false }, 'status', { get() { throw exception; } }),
    () => ({ redirected: false, status: 200, url: 'https://private.invalid/' }),
    () => new Response(privateMarker, { headers: { 'content-type': 'application/json' } }),
    () => new Response('x'.repeat(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    () => response({ error: { code: privateMarker, message: privateMarker } }, 404),
    () => response({ error: { code: { secret: privateMarker } } }, 403),
    () => response({ token: { id: privateMarker + '/bad', expiresAt: privateMarker } }),
  ]) {
    const value = fixture({ [currentPath]: replacement, [reviewedPath]: replacement });
    const result = await probePreviewVercelAuthority(value.options);
    assert.equal(result.bearerBinding, 'unproven');
    assert.equal(result.previewAuthorized, false); assert.equal(value.requests.length, 6);
    assert.ok(!JSON.stringify(result).includes(privateMarker));
    assert.ok(!JSON.stringify(result).includes('private.invalid'));
  }
});

test('diagnostic credential shape is boolean-only and never trims or transforms the bearer', async () => {
  for (const token of ['vcp_fixture', 'vcp_fixture\n', ' fixture ', 'metadata-id']) {
    const value = fixture(); value.options.token = token;
    const result = await probePreviewVercelAuthority(value.options);
    assert.deepEqual(result.credentialShape, { personalTokenPrefixRecognized: token.startsWith('vcp_'), credentialWhitespacePresent: /\s/.test(token) });
    assert.ok(value.requests.every(row => row.request.headers.authorization === `Bearer ${token}`));
    assert.equal(result.previewAuthorized, false);
    assert.ok(!JSON.stringify(result).includes(token));
  }
});

test('invalid reviewed IDs or credentials fail before any diagnostic request', async () => {
  for (const changed of [{ reviewedTokenId: 'current' }, { reviewedTokenId: '../other' }, { reviewedTokenId: '' },
    { token: '' }, { token: null }, { now: () => NaN }]) {
    const value = fixture();
    await assert.rejects(() => probePreviewVercelAuthority({ ...value.options, ...changed }));
    assert.equal(value.requests.length, 0);
  }
  assert.equal(previewEmailBuildArguments(['--diagnose-authority'], {}).mode, 'diagnose-authority');
  assert.throws(() => previewEmailBuildArguments(['--diagnose-authority', '--create'], {}));
});

// Execute the real runner after mocked *upstream* identity/source providers.
// Every Vercel read remains real runner code through a recording fake network;
// any environment/deployment request, intent write, or execution claim fails.
async function runnerScenario(root, temporaryDirectory) {
  const assert = (await import('node:assert/strict')).default;
  const { mock } = await import('node:test');
  const fs = await import('node:fs');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const moduleUrl = name => pathToFileURL(join(root, name)).href;
  const evidence = await import(moduleUrl('scripts/lib/release-evidence.mjs'));
  const production = await import(moduleUrl('scripts/lib/release-production.mjs'));
  const provenance = await import(moduleUrl('scripts/lib/build-provenance.mjs'));
  const readiness = await import(moduleUrl('scripts/lib/release-readiness.mjs'));
  const { fcosConnectionIdentifier } = await import(moduleUrl('config/fcosConnections.js'));
  const { FCOS_RELEASE_APPROVAL_POLICY } = await import(moduleUrl('config/fcosConnections.js'));
  const contract = JSON.parse(fs.readFileSync(join(root, 'config/legacy-email-baseline-proof.json')));
  const candidate = contract.preview.candidates[0], harnessSha = 'a'.repeat(40), teamId = fcosConnectionIdentifier('vercel', 'Team ID');
  const projectId = fcosConnectionIdentifier('vercel', 'Project ID'), now = Date.now();
  const reviewer = { id: 4, login: 'hocheunglai-oss' }, repository = { id: 2, full_name: 'hocheunglai-oss/fcos', default_branch: 'main' };
  const environment = { id: 5, name: 'fcos-runtime-compatibility-release', can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer }] }] };
  const run = { id: 99, repository, head_repository: repository, head_branch: 'main', head_sha: harnessSha,
    path: '.github/workflows/preview-email-proof-build.yml', event: 'workflow_dispatch', run_attempt: 1,
    status: 'in_progress', conclusion: null, run_started_at: new Date(now - 1000).toISOString(), actor: reviewer, triggering_actor: reviewer };
  const jobs = [{ id: 9, run_id: 99, run_attempt: 1, name: 'proof', head_sha: harnessSha, head_branch: 'main',
    workflow_name: `Review FCOS Preview email source ${candidate.sha}`, status: 'in_progress', conclusion: null,
    started_at: new Date(now - 1000).toISOString(), completed_at: null }];
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'fcos-production-release',
    repository: repository.full_name, repository_id: '2', sub: `repo:${repository.full_name}:environment:${environment.name}`,
    workflow_ref: `${repository.full_name}/.github/workflows/preview-email-proof-build.yml@refs/heads/main`,
    workflow_sha: harnessSha, sha: harnessSha, ref: 'refs/heads/main', run_id: '99', run_attempt: '1', event_name: 'workflow_dispatch', exp: now / 1000 + 300 };
  let variables; const githubPaths = [];
  const prefix = `repos/${repository.full_name}`;
  const reads = { json: path => {
    githubPaths.push(path);
    if (path === 'user') return reviewer;
    if (path === prefix) return repository;
    if (path === `${prefix}/branches/main`) return { name: 'main', protected: true, commit: { sha: harnessSha } };
    if (path === `${prefix}/branches/main/protection`) return { enforce_admins: { enabled: true }, required_status_checks: { strict: true,
      checks: FCOS_RELEASE_APPROVAL_POLICY.requiredChecks.map(context => ({ context, app_id: FCOS_RELEASE_APPROVAL_POLICY.statusCheckAppId })) } };
    if (path === `${prefix}/environments/${environment.name}`) return environment;
    if (path.includes('/variables?')) return { total_count: variables.length, variables };
    if (path.includes('/secrets?')) return { total_count: 2, secrets: [{ name: 'FCOS_RELEASE_GH_TOKEN' }, { name: 'FCOS_RELEASE_VERCEL_TOKEN' }] };
    if (path.endsWith('/actions/runs/99')) return run;
    if (path.endsWith('/actions/runs/99/approvals')) return [{ state: 'approved', user: reviewer, environments: [environment] }];
    if (path.includes('/attempts/1/jobs?')) return { total_count: 1, jobs };
    if (path === `${prefix}/git/ref/heads/${encodeURIComponent(candidate.branch)}`) return { object: { sha: candidate.sha } };
    assert.fail(`Unexpected GitHub read: ${path}`);
  } };
  mock.module(moduleUrl('scripts/lib/release-evidence.mjs'), { namedExports: { ...evidence, githubReleaseReads: () => reads } });
  mock.module(moduleUrl('scripts/lib/release-production.mjs'), { namedExports: { ...production, githubReleaseOidc: async () => claims } });
  mock.module(moduleUrl('scripts/lib/release-readiness.mjs'), { namedExports: { ...readiness, releaseHash: () => candidate.lockHash } });
  mock.module(moduleUrl('scripts/lib/build-provenance.mjs'), { namedExports: { ...provenance,
    collectBuildProvenance: ({ cwd }) => ({ releaseEligible: true, commit: cwd === root ? harnessSha : candidate.sha, sourceDigest: candidate.sourceDigest }) } });
  const build = await import(moduleUrl('scripts/lib/preview-email-build.mjs'));
  const controlRevision = build.previewEmailBuildControlRevision(root);
  const gates = { FCOS_PREVIEW_EMAIL_BUILD_ENABLED: 'false', FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED: 'false',
    FCOS_PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLED: 'true' };
  variables = Object.entries({ ...gates, FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_SHA: candidate.sha,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_HARNESS_SHA: harnessSha, FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTRACT_SHA256: build.PREVIEW_EMAIL_CONTRACT_SHA256,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTROL_SHA256: controlRevision, FCOS_RELEASE_VERCEL_TOKEN_ID: 'reviewed-fixture-id' }).map(([name, value]) => ({ name, value }));
  const bin = join(temporaryDirectory, 'bin'), runnerTemp = join(temporaryDirectory, 'runner');
  fs.mkdirSync(bin); fs.mkdirSync(runnerTemp);
  fs.writeFileSync(join(bin, 'vercel'), '#!/bin/sh\necho 54.20.1\n', { mode: 0o700 });
  const requests = [];
  globalThis.fetch = async (url, request) => {
    requests.push({ url, method: request.method });
    assert.equal(request.method, 'GET'); assert.equal(request.body, undefined);
    assert.equal(new URL(url).origin, 'https://api.vercel.com');
    const path = new URL(url).pathname + new URL(url).search;
    const project = { id: projectId, name: 'fcos', accountId: teamId, link: { type: 'github', org: 'hocheunglai-oss', repo: 'fcos' } };
    let body, status = 200;
    if (path === '/v5/user/tokens/current') { status = 404; body = { error: { code: 'not_found', message: 'PRIVATE' } }; }
    else if (path === '/v5/user/tokens/reviewed-fixture-id') body = { token: { id: 'reviewed-fixture-id', createdAt: now - 1000,
      expiresAt: now + 3600000, scopes: [{ type: 'team', teamId }], projectId } };
    else if (path === '/v9/projects?limit=100') body = { projects: [project], pagination: { count: 1, next: null } };
    else if (path === '/v2/user' || path === `/v2/teams/${teamId}`) { status = 403; body = { error: { code: 'forbidden' } }; }
    else if (path === `/v9/projects/${projectId}?teamId=${teamId}`) body = project;
    else assert.fail(`Diagnostic reached unexpected provider path: ${path}`);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  const { runPreviewEmailProofBuild } = await import(moduleUrl('scripts/preview-email-proof-build.mjs'));
  const options = { mode: 'diagnose-authority', candidateSha: candidate.sha, candidateCwd: join(root, 'candidate-fixture'), trustedCwd: root,
    env: { GH_TOKEN: 'PRIVATE', VERCEL_TOKEN: 'PRIVATE', PATH: `${bin}:${process.env.PATH}`, HOME: temporaryDirectory,
      RUNNER_TEMP: runnerTemp, GITHUB_RUN_ID: '99' } };
  // The candidate lock is read before providers. Point that one read at the
  // exact lock in a temporary candidate directory; no repository file changes.
  const candidateDirectory = join(temporaryDirectory, 'candidate'); fs.mkdirSync(candidateDirectory);
  fs.copyFileSync(join(root, 'package-lock.json'), join(candidateDirectory, 'package-lock.json'));
  options.candidateCwd = candidateDirectory;
  const result = await runPreviewEmailProofBuild(options);
  assert.deepEqual(result, { diagnosticCompleted: true, mutations: 0, previewAuthorized: false, productionAuthorized: false });
  assert.equal(requests.length, 6);
  const files = fs.readdirSync(runnerTemp).sort();
  assert.deepEqual(files, ['fcos-preview-email-journal-99.jsonl', 'fcos-preview-vercel-authority-probe.json']);
  const reportPath = join(runnerTemp, 'fcos-preview-vercel-authority-probe.json');
  assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
  const report = JSON.parse(fs.readFileSync(reportPath));
  assert.equal(report.bearerBinding, 'unproven'); assert.equal(report.previewAuthorized, false);
  assert.equal(report.runId, 99); assert.equal(report.harnessSha, harnessSha); assert.equal(report.controlRevision, controlRevision);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  const journal = fs.readFileSync(join(runnerTemp, 'fcos-preview-email-journal-99.jsonl'), 'utf8');
  assert.doesNotMatch(journal, /intent_write|environment_records|controlled_build|execution_claim|vercel_authority/);
  assert.ok(!githubPaths.some(path => path.includes('/actions/variables?')));
  // Simulate environment activation while the run awaited approval. Its fresh
  // read must stop this invocation before any Vercel request despite valid OIDC.
  variables.find(row => row.name === 'FCOS_PREVIEW_EMAIL_BUILD_ENABLED').value = 'true';
  requests.length = 0;
  await assert.rejects(() => runPreviewEmailProofBuild(options), /protection_review/);
  assert.equal(requests.length, 0);
  console.log('protected-diagnostic-runner-passed');
}

test('protected diagnostic runner terminates before environment reads, intent, claims or deployment and rechecks environment gates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-preview-probe-runner-'));
  try {
    const script = join(directory, 'runner.mjs');
    writeFileSync(script, `await (${runnerScenario.toString()})(${JSON.stringify(process.cwd())}, ${JSON.stringify(directory)});`);
    const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', script], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /protected-diagnostic-runner-passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('workflow keeps diagnostic separate from all build and readback steps and preserves only its own artifact', () => {
  const workflow = readFileSync(new URL('../.github/workflows/preview-email-proof-build.yml', import.meta.url), 'utf8');
  const jobs = workflow.split('  proof:')[1], condition = jobs.split('\n').find(line => line.trim().startsWith('if:'));
  assert.match(condition, /inputs.operation == 'diagnose-authority' && vars.FCOS_PREVIEW_EMAIL_BUILD_ENABLED == 'false' && vars.FCOS_PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLED == 'true'/);
  assert.match(condition, /vars.FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED == 'false'/);
  const steps = workflow.split('      - name:').slice(1);
  for (const step of steps.filter(value => /--prepare|--create|immutable intent|--readback/.test(value))) {
    assert.match(step, /if: \$\{\{ inputs.operation == '(create|readback)' \}\}/);
  }
  const probe = steps.find(value => value.includes('--diagnose-authority'));
  assert.match(probe, /if: \$\{\{ inputs.operation == 'diagnose-authority' \}\}/);
  assert.doesNotMatch(probe, /FCOS_E2E_VERCEL_BYPASS/);
  assert.match(steps.find(value => value.includes('Preserve exact non-secret')), /inputs.operation != 'diagnose-authority'/);
});
