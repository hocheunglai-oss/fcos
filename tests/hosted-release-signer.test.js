import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier, FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';
import { collectBuildProvenance } from '../scripts/lib/build-provenance.mjs';
import { collectCheckBinding, collectReleaseCheckSource, loadReleaseCheckManifest } from '../scripts/lib/hosted-release/checks.mjs';
import { createHostedSignerAdapter } from '../scripts/lib/hosted-release/signer.mjs';
import { collectPreviewEmailSignerEvidence, PREVIEW_EMAIL_SIGNER_BODY, PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID } from '../scripts/lib/preview-email-signer.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const policy = JSON.parse(readFileSync(new URL('../config/runtime-compatibility-successor-live.json', import.meta.url)));
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const digest = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : canonical(v)).digest('hex');
const git = (cwd, args) => execFileSync('/usr/bin/git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: 'pipe', env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1' } }).trim();
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-hosted-signer-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const controllerDirectory = join(directory, 'controller'), candidateDirectory = join(directory, 'candidate');
  for (const [destination, commit] of [[controllerDirectory, 'HEAD'], [candidateDirectory, policy.candidateSha]]) {
    git(root, ['clone', '--shared', '--no-hardlinks', '--no-checkout', root, destination]); git(destination, ['checkout', '--detach', commit]);
    git(destination, ['remote', 'set-url', 'origin', 'https://github.com/hocheunglai-oss/fcos.git']);
  }
  for (const p of ['scripts/lib/hosted-release/signer.mjs', 'scripts/lib/preview-email-signer.mjs']) { mkdirSync(dirname(join(controllerDirectory, p)), { recursive: true }); copyFileSync(join(root, p), join(controllerDirectory, p)); }
  writeFileSync(join(controllerDirectory, 'config/hosted-release-policy.json'), '{"kind":"offline-controller-policy-fixture"}\n');
  git(controllerDirectory, ['add', 'scripts/lib/hosted-release/signer.mjs', 'scripts/lib/preview-email-signer.mjs', 'config/hosted-release-policy.json']);
  git(controllerDirectory, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'offline signer controller fixture']);
  const controllerSha = git(controllerDirectory, ['rev-parse', 'HEAD']);
  const loaded = loadReleaseCheckManifest(controllerDirectory), source = collectReleaseCheckSource(candidateDirectory);
  const binding = collectCheckBinding({ candidateDirectory, controllerDirectory, controllerSha, expectedCandidateSha: policy.candidateSha, sourceProfile: 'frozen_04ee', ...loaded, source });
  const provenance = collectBuildProvenance({ cwd: candidateDirectory, env: {}, requireClean: true });
  assert.equal(provenance.sourceDigest, policy.sourceDigest);
  const manifest = { schemaVersion: 2, contract: 'fcos-hosted-release/v2', stage: 'compatibility', candidate: { sha: policy.candidateSha, sourceProfile: 'frozen_04ee', sourceSha256: provenance.sourceDigest, lockSha256: binding.lockSha256, configurationSha256: binding.configurationSha256 },
    controller: { sha: controllerSha, checkManifestSha256: loaded.manifestSha256, configurationSha256: digest(readFileSync(join(controllerDirectory, 'config/hosted-release-policy.json'))) },
    targets: { repository: fcosConnectionIdentifier('github', 'Repository'), vercelProject: fcosConnectionIdentifier('vercel', 'Project ID'), vercelTeam: fcosConnectionIdentifier('vercel', 'Team ID'), supabaseProject: fcosConnectionIdentifier('supabase', 'Project ref'), productionOrigin: new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin } };
  const preview = { id: 'dpl_offlineSignerFixture', url: 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app', projectId: manifest.targets.vercelProject, teamId: manifest.targets.vercelTeam, sha: policy.candidateSha, state: 'READY', target: 'preview', manifestHash: digest(manifest) };
  const sourceReceipt = { sourceVerified: true, observationSourcesVerified: true, candidateSha: manifest.candidate.sha, controllerSha,
    sourceDigest: manifest.candidate.sourceSha256, lockSha256: manifest.candidate.lockSha256, configurationSha256: manifest.candidate.configurationSha256, manifestHash: digest(manifest) };
  let clock = Date.now(), posts = 0;
  const now = () => clock;
  const fetchImpl = async (url, options) => {
    posts++; assert.equal(url, `${preview.url}/api/functions/emailRouterAttachmentUrl`); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.deepEqual(JSON.parse(options.body), PREVIEW_EMAIL_SIGNER_BODY);
    const expiresAt = clock + 180000;
    const payload = { mailboxId: PREVIEW_EMAIL_SIGNER_MAILBOX_REGISTRY_ID, ...PREVIEW_EMAIL_SIGNER_BODY, expiresAt };
    const token = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${Buffer.alloc(32, 7).toString('base64url')}`;
    return { status: 200, ok: true, redirected: false, url, json: async () => ({ token, url: `/api/email-router-attachment?token=${encodeURIComponent(token)}`, expiresAt: new Date(expiresAt).toISOString() }) };
  };
  const options = { controllerDirectory, candidateDirectory, verifyPreview: async () => preview, verifyArtifact: async () => ({ commit: manifest.candidate.sha, deploymentId: preview.id, provenance: { sourceDigest: manifest.candidate.sourceSha256, releaseEligible: true } }), fetchImpl, now };
  const collect = sourceProof => ({ manifest, sourceProof, origin: preview.url, deploymentId: preview.id, sha: policy.candidateSha, sourceDigest: policy.sourceDigest, bearerToken: 'OFFLINE_PRIVATE_TEST_SESSION' });
  return { directory, controllerDirectory, candidateDirectory, manifest, preview, sourceReceipt, options, fetchImpl, collect, now, posts: () => posts, setClock: value => { clock = value; } };
}

test('concrete hosted signer verifies raw frozen Git/source/config and runs only unchanged bounded synthetic probe', async t => {
  const f = fixture(t), adapter = createHostedSignerAdapter(f.options);
  const proof = await adapter.verifySource(f);
  assert.equal(proof.gitTree, policy.candidateGitTree); assert.equal(proof.sourceDigest, policy.sourceDigest); assert.equal(Object.keys(proof.blobIds).length, 3);
  for (const [path, blob] of Object.entries(proof.blobIds)) assert.equal(blob, git(f.candidateDirectory, ['rev-parse', `${policy.candidateSha}:${path}`]));
  const result = await adapter.collect(f.collect(proof));
  assert.equal(result.noAttachmentFetch, true); assert.equal(result.result, 'pass'); assert.equal(f.posts(), 1);
  assert.equal(result.capturedAt, new Date(f.now()).toISOString()); assert.deepEqual(result.sourceHashes, proof.sourceHashes);
  assert.doesNotMatch(JSON.stringify(result), /OFFLINE_PRIVATE|Bearer|access_token|token=/);
  await assert.rejects(adapter.collect(f.collect(structuredClone(proof))), /probe failed/); assert.equal(f.posts(), 1, 'serialized proof cannot replace fresh source verification');
});

test('source/provider/config mismatch and expired proof refuse before any synthetic request', async t => {
  const f = fixture(t), adapter = createHostedSignerAdapter(f.options);
  await assert.rejects(adapter.verifySource({ ...f, sourceReceipt: { ...f.sourceReceipt, sourceDigest: '0'.repeat(64) } }));
  const wrong = createHostedSignerAdapter({ ...f.options, verifyPreview: async () => ({ ...f.preview, projectId: 'wrong' }) });
  await assert.rejects(wrong.verifySource(f)); assert.equal(f.posts(), 0);
  const wrongArtifact = createHostedSignerAdapter({ ...f.options, verifyArtifact: async () => ({ commit: f.manifest.candidate.sha, deploymentId: f.preview.id, provenance: { sourceDigest: '0'.repeat(64), releaseEligible: true } }) });
  await assert.rejects(wrongArtifact.verifySource(f)); assert.equal(f.posts(), 0);
  const file = join(f.candidateDirectory, 'api/_emailRouterHandlers.js'), original = readFileSync(file);
  writeFileSync(file, Buffer.concat([original, Buffer.from('\n// changed source\n')])); await assert.rejects(adapter.verifySource(f)); writeFileSync(file, original);
  const proof = await adapter.verifySource(f); f.setClock(f.now() + 1800001);
  await assert.rejects(adapter.collect(f.collect(proof))); assert.equal(f.posts(), 0);
  f.setClock(f.now() - 1800001);
  const config = join(f.controllerDirectory, 'config/hosted-release-policy.json'), policyBytes = readFileSync(config); writeFileSync(config, '{}');
  await assert.rejects(adapter.collect(f.collect(proof))); assert.equal(f.posts(), 0); writeFileSync(config, policyBytes);
});

test('existing collector legacy defaults remain unchanged and hosted seam rejects mismatching binding before fetch', async () => {
  let calls = 0;
  const base = { origin: 'https://fcos-abcdefghi-hocheunglai-6535s-projects.vercel.app', deploymentId: 'dpl_offline', sha: policy.candidateSha, sourceDigest: policy.sourceDigest,
    bearerToken: 'OFFLINE_PRIVATE_TEST_SESSION', fetchImpl: () => { calls++; assert.fail('no private request'); } };
  await assert.rejects(collectPreviewEmailSignerEvidence(base)); assert.equal(calls, 0);
  await assert.rejects(collectPreviewEmailSignerEvidence({ ...base, verifyHostedSource: async () => ({ schemaVersion: 2, kind: 'fcos_hosted_preview_email_signer_source', sourceVerified: true,
    origin: 'https://foreign.invalid', deploymentId: base.deploymentId, candidateSha: base.sha, sourceDigest: base.sourceDigest, controllerSha: 'a'.repeat(40), manifestHash: 'b'.repeat(64), sourceHashes: {} }) })); assert.equal(calls, 0);
});

test('provider-signed envelope validation rejects redirects, altered synthetic payload and malformed signatures without emitting private values', async t => {
  const f = fixture(t), adapter = createHostedSignerAdapter(f.options), proof = await adapter.verifySource(f);
  for (const mutate of [r => ({ ...r, redirected: true }), r => ({ ...r, status: 503, ok: false }), r => ({ ...r, json: async () => ({ token: 'OFFLINE_PRIVATE_INVALID', url: '/api/email-router-attachment?token=OFFLINE_PRIVATE_INVALID', expiresAt: new Date(f.now() + 10000).toISOString() }) })]) {
    await assert.rejects(adapter.collect({ ...f.collect(proof), fetchImpl: async (...args) => mutate(await f.fetchImpl(...args)) }), error => error.message === 'Hosted Preview signer probe failed.');
  }
});

test('adapter can read immutable candidate objects from disposable local clone without importing candidate code', async t => {
  const f = fixture(t), adapter = createHostedSignerAdapter({ ...f.options, candidateDirectory: undefined });
  const proof = await adapter.verifySource(f); assert.equal(proof.candidateSha, policy.candidateSha); assert.equal(f.posts(), 0);
});
