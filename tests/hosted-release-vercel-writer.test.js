import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { admitPreviewWriterFixture, admitProductionWriterFixture } from './helpers/hosted-vercel-writer.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { validateVercelPreviewWriterBinding, validateVercelPreviewWriterAcceptance, assertVercelPreviewWriterSecret,
  validateVercelProductionWriterBinding, validateVercelProductionWriterAcceptance, assertVercelProductionWriterSecret } from '../scripts/lib/hosted-release/vercel-writer-auth.mjs';
import { createVercelAdapter } from '../scripts/lib/hosted-release/vercel.mjs';
import { collectBuildProvenance } from '../scripts/lib/build-provenance.mjs';

function fixture() {
  const manifest = fixtureManifest(); manifest.verification = {};
  return { manifest, ...admitPreviewWriterFixture(manifest) };
}
function repin(f) {
  f.acceptance.json = JSON.stringify(f.review); f.acceptance.sha256 = digest(f.acceptance.json);
  f.binding.rootAcceptanceSha256 = f.acceptance.sha256;
  f.manifest.setupSha256 = digest(f.setup);
  f.env.FCOS_ADMITTED_RELEASE_SETUP = JSON.stringify(f.setup); f.env.FCOS_ADMITTED_RELEASE_SETUP_SHA256 = digest(f.setup);
}
test('Preview original issuance and exact manager readback require matching immutable root acceptance', () => {
  const f = fixture(), options = { targets: f.manifest.targets };
  validateVercelPreviewWriterAcceptance(f.binding, f.setup, options);
  assertVercelPreviewWriterSecret(f.binding, { ...options, env: f.env });
  for (const mutate of [x => { x.review.accepted = false; }, x => { x.review.provenance.metadataAuthority = 'writer_self_assertion'; },
    x => { x.review.provenance.singleTeamScope = 'another-team'; }, x => { x.review.independentReview.sha256 = 'missing'; },
    x => { x.review.independentReview.reviewerId = '/root'; }, x => { x.review.credential.tokenId = 'another-id'; }]) {
    const x = fixture(); mutate(x); repin(x);
    assert.throws(() => validateVercelPreviewWriterAcceptance(x.binding, x.setup, options), { code: 'VERCEL_WRITER_ORIGINAL_PROOF_REQUIRED' });
  }
});
test('substituted credentials, wrong scope/project and elapsed actual provider expiry refuse', () => {
  const f = fixture(), options = { targets: f.manifest.targets };
  for (const binding of [{ ...f.binding, projectId: 'wrong' }, { ...f.binding, scopes: ['extra'] },
    { ...f.binding, expiresAt: Date.now() - 1 }, { ...f.binding, expiresAt: f.binding.createdAt + 32 * 86400000 }])
    assert.throws(() => validateVercelPreviewWriterBinding(binding, options), { code: 'VERCEL_WRITER_CREDENTIAL_BINDING' });
  for (const env of [{ ...f.env, FCOS_HOSTED_VERCEL_TOKEN: f.token + 'changed' }, { ...f.env, FCOS_HOSTED_VERCEL_TOKEN_ID: 'other' }])
    assert.throws(() => assertVercelPreviewWriterSecret(f.binding, { ...options, env }), { code: 'VERCEL_WRITER_CREDENTIAL_SUBSTITUTED' });
  assert.throws(() => assertVercelPreviewWriterSecret(f.binding, { ...options, env: { ...f.env, FCOS_HOSTED_ENVIRONMENT: 'fcos-production-release' } }), { code: 'VERCEL_WRITER_CONTEXT' });
});

test('actual Preview adapter uses admitted original proof and fresh effective access, without manager or self-metadata requests', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-original-writer-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'package-lock.json'), '{}\n'); writeFileSync(join(directory, '.gitignore'), '.vercel/\n');
  writeFileSync(join(directory, 'vercel.json'), JSON.stringify({ git: { deploymentEnabled: false } }));
  const git = args => execFileSync('git', args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const source = collectBuildProvenance({ cwd: directory, env: {}, requireClean: true }), manifest = fixtureManifest(), H = 'a'.repeat(64);
  manifest.stage = 'application'; manifest.candidate.sha = source.commit; manifest.candidate.sourceSha256 = source.sourceDigest;
  manifest.candidate.lockSha256 = digest('{}\n'); manifest.scope.handoffs = [{ kind: 'status19', sha256: H }, { kind: 'supplier16', sha256: H }];
  manifest.scope.compatibilityProductionObservationSha256 = H; manifest.requiredChecks.push('compatibility_production_observation');
  const settings = { framework: 'vite', buildCommand: 'npm run build', devCommand: null, installCommand: 'npm ci', outputDirectory: 'dist', rootDirectory: null, nodeVersion: '24.x' };
  manifest.verification = { runtime: { image: `ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`, node: 'v24.18.0', python: 'Python 3.11.2', platform: 'linux', arch: 'x64' }, publicBuildEnvironment: {}, projectSettings: settings };
  const f = admitPreviewWriterFixture(manifest), calls = [];
  let change = '';
  const project = { id: manifest.targets.vercelProject, accountId: manifest.targets.vercelTeam, name: 'fcos',
    link: { type: 'github', org: 'hocheunglai-oss', repo: 'fcos', productionBranch: 'main', deployHooks: [] }, autoAssignCustomDomains: false, ...settings };
  const create = (env = f.env) => createVercelAdapter({ manifest, candidateDirectory: directory, env,
    execute: () => 'Vercel CLI 54.20.1', fetchImpl: async (url, request) => {
      calls.push(url.pathname); assert.equal(request.method, 'GET'); assert.equal(request.headers.authorization, `Bearer ${f.token}`);
      assert.ok(!url.pathname.includes('/tokens/'), 'Unsupported self-metadata must never be requested.');
      if (url.pathname.startsWith('/v2/')) { assert.equal(url.search, ''); return { status: change === 'visibility' ? 200 : url.pathname === '/v2/user' ? (change === 'user400' ? 400 : change === 'user403' ? 403 : 404) : change === 'team404' ? 404 : 403, redirected: change === 'redirect' }; }
      assert.equal(url.searchParams.get('teamId'), manifest.targets.vercelTeam);
      const value = url.pathname === '/v9/projects' ? { projects: [{ id: manifest.targets.vercelProject }], pagination: { count: 1, next: change === 'pagination' ? 123 : null } }
        : { ...project, ...(change === 'settings' ? { buildCommand: 'changed' } : {}), ...(change === 'hooks' ? { link: { ...project.link, deployHooks: [{}] } } : {}) };
      return { ok: true, redirected: false, json: async () => value };
    } });
  const actual = await create().admit(manifest, 'preview'); assert.equal(actual.effectiveAccess.userStatus, 404); assert.equal(actual.effectiveAccess.teamStatus, 403); assert.deepEqual(calls, [`/v9/projects/${manifest.targets.vercelProject}`, '/v9/projects', '/v2/user', `/v2/teams/${manifest.targets.vercelTeam}`]);
  for (change of ['settings', 'hooks', 'pagination', 'visibility', 'user400', 'team404', 'redirect']) await assert.rejects(create().admit(manifest, 'preview'));
  change = 'user403'; assert.equal((await create().admit(manifest, 'preview')).effectiveAccess.userStatus, 403);
  change = ''; calls.length = 0;
  await assert.rejects(create({ ...f.env, FCOS_HOSTED_VERCEL_TOKEN: f.token + 'substitute' }).admit(manifest, 'preview'), { code: 'VERCEL_WRITER_CREDENTIAL_SUBSTITUTED' });
  await assert.rejects(create({ ...f.env, FCOS_ADMITTED_RELEASE_SETUP_SHA256: '0'.repeat(64) }).admit(manifest, 'preview'), { code: 'ADMITTED_SETUP_CHANGED' });
  await assert.rejects(create({ ...f.env, FCOS_HOSTED_CREDENTIAL_CLASS: 'production' }).admit(manifest, 'production.stage'), { code: 'VERCEL_PREVIEW_WRITER_FOR_PRODUCTION' });
  assert.equal(calls.length, 0);
});


function productionFixture() {
  const manifest = fixtureManifest(); manifest.verification = {};
  const preview = admitPreviewWriterFixture(manifest);
  return { manifest, preview, ...admitProductionWriterFixture(manifest, { previewFixture: preview }) };
}
const productionOptions = f => ({ targets: f.manifest.targets, previewBinding: f.preview.binding,
  stage: f.manifest.stage, executionMode: f.manifest.executionMode });

test('Production original authority binds a separate token, exact issuer metadata and typed confirmed role evidence', () => {
  const f = productionFixture(), options = productionOptions(f);
  assert.deepEqual(validateVercelProductionWriterAcceptance(f.binding, f.setup, options), f.review);
  assertVercelProductionWriterSecret(f.binding, { ...options, env: f.env });
  f.review.provenance.issuerProductionRights.membershipRole = 'MEMBER'; repin(f);
  assert.deepEqual(validateVercelProductionWriterAcceptance(f.binding, f.setup, options), f.review);
});

test('Production binding refuses malformed identity, wrong scope, elapsed expiry and Preview identity reuse', () => {
  const f = productionFixture(), options = productionOptions(f);
  for (const patch of [{ kind: f.preview.binding.kind }, { operationId: f.preview.binding.operationId },
    { tokenId: undefined }, { issuerUserId: undefined }, { projectId: 'wrong' }, { teamId: 'wrong' },
    { expiresAt: Date.now() - 1 }, { expiresAt: f.binding.createdAt + 32 * 86400000 },
    { metadataReadbackAt: f.binding.createdAt - 1 }, { productionRightsReadbackSha256: 'missing' }]) {
    assert.throws(() => validateVercelProductionWriterBinding({ ...f.binding, ...patch }, options),
      { code: 'VERCEL_PRODUCTION_WRITER_CREDENTIAL_BINDING' });
  }
  for (const patch of [{ tokenId: f.preview.binding.tokenId }, { bearerSha256: f.preview.binding.bearerSha256 }])
    assert.throws(() => validateVercelProductionWriterBinding({ ...f.binding, ...patch }, options),
      { code: 'VERCEL_WRITER_CREDENTIALS_NOT_SEPARATE' });
});
test('Production rights proof refuses unsupported role, wrong actor/project/hash, unconfirmed or stale observations', () => {
  for (const mutate of [r => { r.membershipRole = 'DEVELOPER'; }, r => { r.membershipRole = 'owner'; },
    r => { r.confirmed = false; }, r => { r.account = 'wrong'; }, r => { r.userId = 'wrong'; },
    r => { r.projectId = 'wrong'; }, r => { r.teamId = 'wrong'; }, r => { r.readbackSha256 = 'd'.repeat(64); },
    (r, f) => { r.observedAt = new Date(f.binding.createdAt - 30001).toISOString(); },
    (r, f) => { r.observedAt = new Date(f.binding.createdAt + 300001).toISOString(); },
    r => { r.extraAuthority = true; }]) {
    const f = productionFixture(); mutate(f.review.provenance.issuerProductionRights, f); repin(f);
    assert.throws(() => validateVercelProductionWriterAcceptance(f.binding, f.setup, productionOptions(f)),
      { code: 'VERCEL_PRODUCTION_WRITER_RIGHTS_PROOF_REQUIRED' });
  }
});
test('Production proof cannot substitute Preview review or precede original metadata readback', () => {
  for (const mutate of [f => { f.review.kind = f.preview.review.kind; }, f => { f.review.accepted = false; },
    f => { f.review.credential.tokenId = 'wrong'; }, f => { f.review.provenance.metadataAuthority = 'self_assertion'; },
    f => { f.review.independentReview.reviewerId = '/root'; },
    f => { f.review.reviewedAt = new Date(f.binding.metadataReadbackAt - 1).toISOString(); }]) {
    const f = productionFixture(); mutate(f); repin(f);
    assert.throws(() => validateVercelProductionWriterAcceptance(f.binding, f.setup, productionOptions(f)),
      { code: 'VERCEL_PRODUCTION_WRITER_ORIGINAL_PROOF_REQUIRED' });
  }
  const f = productionFixture(); f.setup.vercelProductionWriterCredentialAcceptance = f.preview.acceptance;
  assert.throws(() => validateVercelProductionWriterAcceptance(f.binding, f.setup, productionOptions(f)),
    { code: 'VERCEL_PRODUCTION_WRITER_ORIGINAL_PROOF_REQUIRED' });
});
test('Production secret is confined to nonqualification release execution in its exact protected environment', () => {
  const f = productionFixture(), options = productionOptions(f);
  for (const patch of [{ FCOS_HOSTED_CREDENTIAL_CLASS: 'preview' }, { FCOS_HOSTED_ENVIRONMENT: 'fcos-production-release' },
    { FCOS_HOSTED_ENVIRONMENT: 'fcos-hosted-preview' }, { FCOS_QUALIFICATION_BOOTSTRAP: 'true' }])
    assert.throws(() => assertVercelProductionWriterSecret(f.binding, { ...options, env: { ...f.env, ...patch } }),
      { code: 'VERCEL_PRODUCTION_WRITER_CONTEXT' });
  for (const patch of [{ stage: 'qualification' }, { executionMode: 'qualification' }])
    assert.throws(() => assertVercelProductionWriterSecret(f.binding, { ...options, ...patch, env: f.env }),
      { code: 'VERCEL_PRODUCTION_WRITER_CONTEXT' });
  for (const patch of [{ FCOS_HOSTED_VERCEL_TOKEN: f.preview.token }, { FCOS_HOSTED_VERCEL_TOKEN_ID: 'wrong' }])
    assert.throws(() => assertVercelProductionWriterSecret(f.binding, { ...options, env: { ...f.env, ...patch } }),
      { code: 'VERCEL_PRODUCTION_WRITER_CREDENTIAL_SUBSTITUTED' });
});

function productionAdapterFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-production-writer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'package-lock.json'), '{}\n'); writeFileSync(join(directory, '.gitignore'), '.vercel/\n');
  writeFileSync(join(directory, 'vercel.json'), JSON.stringify({ git: { deploymentEnabled: false } }));
  const git = args => execFileSync('git', args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const source = collectBuildProvenance({ cwd: directory, env: {}, requireClean: true }), manifest = fixtureManifest(), H = 'a'.repeat(64);
  manifest.stage = 'application'; manifest.candidate.sha = source.commit; manifest.candidate.sourceSha256 = source.sourceDigest;
  manifest.candidate.lockSha256 = digest('{}\n'); manifest.scope.handoffs = [{ kind: 'status19', sha256: H }, { kind: 'supplier16', sha256: H }];
  manifest.scope.compatibilityProductionObservationSha256 = H; manifest.requiredChecks.push('compatibility_production_observation');
  const settings = { framework: 'vite', buildCommand: 'npm run build', devCommand: null, installCommand: 'npm ci', outputDirectory: 'dist', rootDirectory: null, nodeVersion: '24.x' };
  manifest.verification = { runtime: { image: `ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${H}`, node: 'v24.18.0', python: 'Python 3.11.2', platform: 'linux', arch: 'x64' }, publicBuildEnvironment: {}, projectSettings: settings };
  const preview = admitPreviewWriterFixture(manifest), f = admitProductionWriterFixture(manifest, { previewFixture: preview });
  const project = { id: manifest.targets.vercelProject, accountId: manifest.targets.vercelTeam, name: 'fcos',
    link: { type: 'github', org: 'hocheunglai-oss', repo: 'fcos', productionBranch: 'main', deployHooks: [] }, autoAssignCustomDomains: false, ...settings };
  const state = { change: '', now: Date.now(), expireAtLastRead: false }, reads = [], writes = [];
  const create = (env = f.env) => createVercelAdapter({ manifest, candidateDirectory: directory, env, now: () => state.now,
    execute: (_command, args) => {
      if (args[0] === '--version') return 'Vercel CLI 54.20.1';
      writes.push(args); return args[0] === 'deploy' ? 'https://fcos-prod12345-hocheunglai-6535s-projects.vercel.app' : 'submitted';
    }, fetchImpl: async (url, request) => {
      reads.push(url.pathname); assert.equal(request.method, 'GET'); assert.equal(request.headers.authorization, `Bearer ${f.token}`);
      assert.ok(!url.pathname.includes('/tokens/'), 'Production original-issuer admission cannot request unsupported introspection');
      if (state.change === 'redirect') return { redirected: true };
      if (url.pathname === '/v2/user') return new Response(null, { status: state.change === 'user403' ? 403 : state.change === 'user200' ? 200 : state.change === 'user400' ? 400 : 404 });
      if (url.pathname.startsWith('/v2/teams/')) {
        if (state.expireAtLastRead) state.now = f.binding.expiresAt + 1;
        return new Response(null, { status: state.change === 'team404' ? 404 : 403 });
      }
      assert.equal(url.searchParams.get('teamId'), manifest.targets.vercelTeam);
      if (url.pathname === '/v9/projects') return Response.json({ projects: [{ id: manifest.targets.vercelProject }, ...(state.change === 'extraProject' ? [{ id: 'another' }] : [])],
        pagination: { count: state.change === 'count' ? 2 : 1, next: state.change === 'pagination' ? 123 : null } });
      if (url.pathname.startsWith('/v13/deployments/')) return Response.json({ id: 'dpl_productionfixture', url: 'fcos-prod12345-hocheunglai-6535s-projects.vercel.app',
        projectId: manifest.targets.vercelProject, teamId: manifest.targets.vercelTeam, target: 'production', readyState: 'READY', meta: { githubCommitSha: manifest.candidate.sha } });
      return Response.json({ ...project, ...(state.change === 'settings' ? { buildCommand: 'changed' } : {}),
        ...(state.change === 'project' ? { id: 'wrong' } : {}), ...(state.change === 'team' ? { accountId: 'wrong' } : {}),
        ...(state.change === 'domains' ? { autoAssignCustomDomains: true } : {}),
        ...(state.change === 'hooks' ? { link: { ...project.link, deployHooks: [{}] } } : {}) });
    } });
  return { manifest, preview, ...f, create, state, reads, writes };
}
test('Production metadata admission cannot falsely qualify scoped CLI stage, promote or rollback', async t => {
  const f = productionAdapterFixture(t), adapter = f.create();
  const admitted = await adapter.admit(f.manifest, 'production.stage');
  assert.equal(admitted.credentialAuthority, 'root_accepted_original_production_issuance');
  assert.equal(admitted.effectiveAccess.userStatus, 404);
  f.reads.length = 0;
  await assert.rejects(adapter.stage(f.manifest, { operationId: `${f.manifest.releaseId}-production-stage` }), {code:'VERCEL_CLI_PROJECT_SCOPE_UNSUPPORTED'});
  await assert.rejects(adapter.promote({id:'dpl_productionfixture'}), {code:'VERCEL_CLI_PROJECT_SCOPE_UNSUPPORTED'});
  await assert.rejects(adapter.rollback(f.manifest.previousProduction), {code:'VERCEL_CLI_PROJECT_SCOPE_UNSUPPORTED'});
  assert.deepEqual(f.writes, []);
  assert.equal(f.reads.filter(path => path === '/v9/projects').length, 3);
  assert.equal(f.reads.filter(path => path === '/v2/user').length, 3);
  f.state.change = 'user403'; assert.equal((await adapter.admit(f.manifest, 'production.stage')).effectiveAccess.userStatus, 403);
});
test('Production adapter refuses changed effective scope/settings and prevents Preview, setup or source substitution before reads', async t => {
  const f = productionAdapterFixture(t);
  for (f.state.change of ['project', 'team', 'settings', 'domains', 'hooks', 'extraProject', 'pagination', 'count', 'user200', 'user400', 'team404', 'redirect'])
    await assert.rejects(f.create().admit(f.manifest, 'production.stage'));
  f.state.change = ''; f.reads.length = 0;
  for (const patch of [{ FCOS_HOSTED_ENVIRONMENT: 'fcos-production-release' }, { FCOS_ADMITTED_RELEASE_SETUP_SHA256: '0'.repeat(64) },
    { GITHUB_REF: 'refs/heads/unreviewed' }, { FCOS_HOSTED_VERCEL_TOKEN: f.token + 'substitute' }])
    await assert.rejects(f.create({ ...f.env, ...patch }).admit(f.manifest, 'production.stage'));
  await assert.rejects(f.create({ ...f.env, FCOS_HOSTED_CREDENTIAL_CLASS: 'preview' }).admit(f.manifest, 'preview'), { code: 'VERCEL_PRODUCTION_WRITER_FOR_PREVIEW' });
  const setup = { ...f.setup }; delete setup.vercelProductionWriterCredentialAcceptance;
  f.manifest.setupSha256 = digest(setup);
  await assert.rejects(f.create({ ...f.env, FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(setup), FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(setup) }).admit(f.manifest, 'production.stage'),
    { code: 'VERCEL_PRODUCTION_WRITER_ORIGINAL_PROOF_REQUIRED' });
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});
test('Production expiry is rechecked after asynchronous reads at each final provider submission boundary', async t => {
  const f = productionAdapterFixture(t), adapter = f.create(); f.state.expireAtLastRead = true;
  const operations = [() => adapter.stage(f.manifest, { operationId: `${f.manifest.releaseId}-production-stage` }),
    () => adapter.promote({ id: 'dpl_productionfixture' }), () => adapter.rollback(f.manifest.previousProduction)];
  for (const operation of operations) {
    f.state.now = Date.now();
    await assert.rejects(operation(), { code: 'VERCEL_PRODUCTION_WRITER_CREDENTIAL_BINDING' });
  }
  assert.deepEqual(f.writes, []);
});

test('Production CLI cannot use a different bearer captured before the admitted environment was corrected', async t => {
  const f = productionAdapterFixture(t), env = { ...f.env, FCOS_HOSTED_VERCEL_TOKEN: f.token + 'substitute' };
  const adapter = f.create(env); env.FCOS_HOSTED_VERCEL_TOKEN = f.token;
  await assert.rejects(adapter.stage(f.manifest, { operationId: `${f.manifest.releaseId}-production-stage` }),
    { code: 'VERCEL_PRODUCTION_WRITER_CREDENTIAL_SUBSTITUTED' });
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});
