import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { admitPreviewWriterFixture } from './helpers/hosted-vercel-writer.mjs';
import { digest } from '../scripts/lib/hosted-release/contract.mjs';
import { validateVercelPreviewWriterBinding, validateVercelPreviewWriterAcceptance, assertVercelPreviewWriterSecret } from '../scripts/lib/hosted-release/vercel-writer-auth.mjs';
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
