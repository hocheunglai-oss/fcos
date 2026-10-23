import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, createECDH, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { DEPENDENCY_SEED_FILES, sealDependencySeed } from '../scripts/hosted-release-dependency-seed.mjs';
import { canonical, digest } from '../scripts/lib/hosted-release/contract.mjs';
import { loadDependencySetup, NOM_B_LEGACY_HISTORY } from '../scripts/lib/hosted-release/dependency-publisher.mjs';
import { sealPreservationMembership } from '../scripts/lib/hosted-release/preservation-preflight.mjs';
import { fixtureManifest } from './helpers/hosted-release-manifest.mjs';
import { vercelReadFixture } from './helpers/hosted-vercel-read.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = 'scripts/hosted-release-dependency-seed.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const token = 'github_pat_SYNTHETIC_DEPENDENCY_FIXTURE_NOT_A_CREDENTIAL';
const encode = value => Buffer.from(`${JSON.stringify(value)}\n`);

function fixture(t) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'fcos-dependency-integration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const controller = join(directory, 'controller'); mkdirSync(controller);
  const sourceFiles = [script, 'scripts/lib/hosted-release/json-contract.mjs', 'config/fcosConnections.js', 'config/hostedReleaseQualification.js', 'config/hostedDependencyContext.js'];
  for (const file of sourceFiles) { mkdirSync(dirname(join(controller, file)), { recursive: true }); copyFileSync(join(root, file), join(controller, file)); }
  writeFileSync(join(controller, 'package.json'), '{"type":"module"}\n');
  const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: controller, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['add', '--', ...sourceFiles, 'package.json']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'isolated dependency fixture']);
  const controllerSha = git(['rev-parse', 'HEAD']);
  const manifest = fixtureManifest(); manifest.stage = 'qualification'; manifest.executionMode = 'qualification';
  manifest.candidate.sha = 'c'.repeat(40); manifest.controller.sha = controllerSha;
  const source = { ref: 'refs/heads/codex/dependency-fixture', bootstrapSha: 'd'.repeat(40),
    callerWorkflowRef: 'hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@refs/heads/codex/dependency-fixture', controllerSha, candidateSha: manifest.candidate.sha };
  manifest.qualificationSource = source;
  const membership = { tables: [{ table: 'synthetic_fixture', keys: [{ id: 'owned-fixture' }], expectedRowsSha256: 'e'.repeat(64) }] };
  const membershipBytes = encode(membership);
  const database = 'postgresql://fcos_release_observer.pjforfvchygdyqfcgpmw:synthetic-not-a-database-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
  const memberEnvelope = sealPreservationMembership(membershipBytes, { candidateSha: manifest.candidate.sha,
    project: manifest.targets.supabaseProject, membershipSha256: hash(membershipBytes), connection: database });
  const recipe = encode({ originalAcceptanceSha256: NOM_B_LEGACY_HISTORY.acceptance });
  const syntheticEvidence = encode({ ownedSynthetic: true });
  const bundle = encode({ schemaVersion: 1, kind: 'fcos_immutable_dependency_artifacts', artifacts: { [hash(syntheticEvidence)]: syntheticEvidence.toString('base64') } });
  const handoff = encode({ candidateSha: manifest.candidate.sha, artifacts: NOM_B_LEGACY_HISTORY, measurementRecipeSha256: hash(recipe) });
  const known = { 'handoff.json': handoff, 'artifacts.json': bundle, 'recipe.json': recipe, 'membership.encrypted.json': memberEnvelope };
  const files = DEPENDENCY_SEED_FILES.map(path => ({ path, bytes: known[path] || encode({ ownedSynthetic: true, file: path }) }));
  const descriptors = files.map(({ path, bytes }) => ({ path, sha256: hash(bytes), bytes: bytes.length }));
  const seed = { schemaVersion: 2, kind: 'fcos_hosted_dependency_seed_v2', repository: 'hocheunglai-oss/fcos', controllerSha,
    candidateSha: manifest.candidate.sha, qualificationSource: source, files: descriptors, sealed: null };
  const env = { ...gitEnv, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'hocheunglai-oss/fcos', GITHUB_REPOSITORY_ID: '1278654816',
    GITHUB_ACTOR: 'hocheunglai-oss', GITHUB_ACTOR_ID: '265701760', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '123',
    GITHUB_REF: source.ref, GITHUB_REF_PROTECTED: 'true', GITHUB_SHA: source.bootstrapSha, GITHUB_WORKFLOW_REF: source.callerWorkflowRef,
    GITHUB_WORKFLOW_SHA: source.bootstrapSha, FCOS_CONTROLLER_DIRECTORY: controller, FCOS_CONTROLLER_SHA: controllerSha,
    FCOS_HOSTED_QUALIFICATION_ADMITTED: 'true', FCOS_QUALIFICATION_BOOTSTRAP: 'true' };
  const invoke = (args, extra, minimal = false) => spawnSync(process.execPath, [minimal ? join(controller, script) : join(root, script), ...args],
    { cwd: directory, env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000 });
  const seeded = () => ({ FCOS_ADMITTED_DEPENDENCY_SEED: JSON.stringify(seed), FCOS_ADMITTED_DEPENDENCY_SEED_SHA256: digest(seed) });
  const key = invoke(['--recipient'], { ...seeded(), GITHUB_JOB: 'dependency_key', FCOS_HOSTED_GITHUB_READ_TOKEN: token }, true);
  assert.equal(key.status, 0, key.stderr); assert.equal(existsSync(join(controller, 'node_modules')), false);
  const publicKey = JSON.parse(readFileSync(join(directory, 'dependency-recipient.json')));
  assert.equal(JSON.stringify(publicKey).includes(token), false);
  const sealed = sealDependencySeed({ files, candidateSha: manifest.candidate.sha, recipientPublicKey: publicKey.publicKey, credentialSha256: publicKey.credentialSha256 });
  const artifactDirectory = join(directory, 'artifact'); mkdirSync(artifactDirectory);
  writeFileSync(join(artifactDirectory, 'seed.encrypted.json'), sealed);
  seed.sealed = { path: 'seed.encrypted.json', sha256: hash(sealed), bytes: sealed.length,
    recipientPublicKeySha256: publicKey.publicKeySha256, credentialSha256: publicKey.credentialSha256 };
  const read = vercelReadFixture({ targets: manifest.targets });
  const setup = { schemaVersion: 2, controllerSha, epoch: manifest.epoch, targetsSha256: digest(manifest.targets), qualificationSource: source,
    verification: { vercelReadCredential: read.binding }, vercelReadCredentialAcceptance: read.acceptance,
    dependencies: { schemaVersion: 1, nom_b: { handoffSha256: hash(handoff), artifactsSha256: hash(bundle), recipeSha256: hash(recipe) },
      preservation: { membershipSha256: hash(membershipBytes), envelopeSha256: hash(memberEnvelope), tableCount: 1, rowCount: 1,
        snapshotSha256: digest(membership.tables.map(t => ({ table: t.table, count: t.keys.length, rowsSha256: t.expectedRowsSha256 }))) } },
    dependencyArtifact: { runId: '123', name: 'fcos-dependency-setup-123', seed: { envelopeSha256: hash(sealed), files: descriptors,
      recipientPublicKeySha256: publicKey.publicKeySha256, credentialSha256: publicKey.credentialSha256 } } };
  manifest.dependencies = setup.dependencies; manifest.verification = setup.verification;
  const opened = join(directory, 'dependency-setup-opened');
  const opening = () => { manifest.setupSha256 = digest(setup); return { GITHUB_JOB: 'dependencies_before',
    FCOS_ADMITTED_RELEASE_SETUP: JSON.stringify(setup), FCOS_ADMITTED_RELEASE_SETUP_SHA256: digest(setup), FCOS_RELEASE_MANIFEST: JSON.stringify(manifest),
    FCOS_HOSTED_GITHUB_READ_TOKEN: token, FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY: artifactDirectory,
    FCOS_HOSTED_DEPENDENCY_SETUP_OPENED_DIRECTORY: opened }; };
  return { directory, controller, files, seed, seeded, env, invoke, setup, manifest, opening, opened, artifactDirectory, sealed, database, membership, syntheticEvidence };
}

test('actual key, credential-free publisher, opening CLI and unchanged dependency loader round-trip exact bytes', t => {
  const f = fixture(t);
  const stage = f.invoke([], { ...f.seeded(), GITHUB_JOB: 'dependency_setup', FCOS_DEPENDENCY_SEED_SOURCE: f.artifactDirectory }, true);
  assert.equal(stage.status, 0, stage.stderr);
  const staged = join(f.directory, 'dependency-setup');
  assert.deepEqual(readFileSync(join(staged, 'seed.encrypted.json')), f.sealed);
  assert.equal(readFileSync(join(f.directory, 'dependency-setup-receipt.json'), 'utf8').includes(token), false);
  const result = f.invoke(['--open'], { ...f.opening(), FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY: staged });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
  assert.equal(lstatSync(f.opened).mode & 0o777, 0o700);
  for (const file of f.files) { const p = join(f.opened, file.path); assert.deepEqual(readFileSync(p), file.bytes); assert.equal(lstatSync(p).mode & 0o777, 0o600); }
  const loaded = loadDependencySetup({ manifest: f.manifest, env: { FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY: f.opened, FCOS_HOSTED_PRESERVATION_DATABASE_URL: f.database } });
  assert.equal(loaded.nomB.handoff.candidateSha, f.manifest.candidate.sha);
  assert.deepEqual(loaded.preservation.membership.tables, f.membership.tables);
  assert.equal(f.setup.candidateSha, undefined, 'the real admitted setup has no root candidateSha');
  const replay = f.invoke(['--open'], f.opening());
  assert.notEqual(replay.status, 0); assert.match(replay.stderr, /OUTPUT_EXISTS/);
});

test('opening refuses wrong source, job, key, pins or tampering without partial plaintext', t => {
  const f = fixture(t);
  for (const extra of [{ GITHUB_REF: 'refs/heads/unprotected' }, { GITHUB_JOB: 'checks' }, { GITHUB_REF_PROTECTED: 'false' },
    { FCOS_HOSTED_GITHUB_READ_TOKEN: `${token}-wrong` }, { FCOS_HOSTED_GITHUB_READ_TOKEN: '', GITHUB_TOKEN: token }]) {
    const result = f.invoke(['--open'], { ...f.opening(), ...extra });
    assert.notEqual(result.status, 0); assert.equal(existsSync(f.opened), false); assert.equal(result.stderr.includes(token), false);
  }
  const old = f.setup.dependencies.nom_b.handoffSha256;
  f.setup.dependencies.nom_b.handoffSha256 = 'f'.repeat(64);
  assert.notEqual(f.invoke(['--open'], f.opening()).status, 0); assert.equal(existsSync(f.opened), false);
  f.setup.dependencies.nom_b.handoffSha256 = old;
  const envelope = JSON.parse(f.sealed); envelope.tag = Buffer.alloc(16, 7).toString('base64');
  const tampered = Buffer.from(canonical(envelope)); writeFileSync(join(f.artifactDirectory, 'seed.encrypted.json'), tampered);
  f.setup.dependencyArtifact.seed.envelopeSha256 = hash(tampered);
  assert.notEqual(f.invoke(['--open'], f.opening()).status, 0); assert.equal(existsSync(f.opened), false);
});

test('ciphertext-only staging rejects extra plaintext and symlink ancestors', t => {
  const f = fixture(t);
  writeFileSync(join(f.artifactDirectory, 'membership.json'), 'synthetic-private-membership');
  const invoke = source => f.invoke([], { ...f.seeded(), GITHUB_JOB: 'dependency_setup', FCOS_DEPENDENCY_SEED_SOURCE: source }, true);
  assert.notEqual(invoke(f.artifactDirectory).status, 0); assert.equal(existsSync(join(f.directory, 'dependency-setup')), false);
  rmSync(join(f.artifactDirectory, 'membership.json'));
  const link = join(f.directory, 'linked'); symlinkSync(f.directory, link);
  assert.notEqual(invoke(join(link, 'artifact')).status, 0); assert.equal(existsSync(join(f.directory, 'dependency-setup')), false);
  linkSync(join(f.artifactDirectory, 'seed.encrypted.json'), join(f.directory, 'hardlinked-ciphertext'));
  assert.notEqual(invoke(f.artifactDirectory).status, 0); assert.equal(existsSync(join(f.directory, 'dependency-setup')), false);
});

test('recipient key publication refuses a foreign actor or source before any output', t => {
  const f = fixture(t);
  f.seed.sealed = null;
  for (const [index, extra] of [{ GITHUB_ACTOR_ID: '7' }, { GITHUB_REF_PROTECTED: 'false' }, { GITHUB_WORKFLOW_SHA: 'e'.repeat(40) },
    { GITHUB_JOB: 'checks' }].entries()) {
    const output = join(f.directory, `forbidden-recipient-${index}.json`);
    const result = f.invoke(['--recipient'], { ...f.seeded(), GITHUB_JOB: 'dependency_key', FCOS_HOSTED_GITHUB_READ_TOKEN: token,
      FCOS_DEPENDENCY_KEY_OUTPUT: output, ...extra }, true);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /DEPENDENCY_SEED_CONTEXT_INVALID/); assert.equal(existsSync(output), false);
  }
});

function adversarialArchive(f, plaintext) {
  const publicKey = JSON.parse(readFileSync(join(f.directory, 'dependency-recipient.json')));
  const original = JSON.parse(f.sealed), sender = createECDH('prime256v1'); sender.generateKeys();
  const salt = randomBytes(32), iv = randomBytes(12);
  const key = hkdfSync('sha256', sender.computeSecret(Buffer.from(publicKey.publicKey, 'base64')), salt, Buffer.from('fcos-hosted-dependency-archive-v1'), 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(canonical(original.context)));
  const ciphertext = Buffer.concat([cipher.update(gzipSync(plaintext)), cipher.final()]);
  const bytes = Buffer.from(canonical({ ...original, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    ephemeralPublicKey: sender.getPublicKey().toString('base64'), ciphertext: ciphertext.toString('base64') }));
  writeFileSync(join(f.artifactDirectory, 'seed.encrypted.json'), bytes); f.setup.dependencyArtifact.seed.envelopeSha256 = hash(bytes);
}

test('authenticated malicious archive still cannot traverse paths or inflate beyond the bounded decoder', t => {
  const f = fixture(t);
  const rows = f.files.map(({ path, bytes }) => ({ path, base64: bytes.toString('base64') }));
  rows[0].path = '../escaped-private.json'; adversarialArchive(f, Buffer.from(canonical(rows)));
  let result = f.invoke(['--open'], f.opening());
  assert.notEqual(result.status, 0); assert.match(result.stderr, /DEPENDENCY_SEED_DECRYPT_INVALID/);
  assert.equal(existsSync(f.opened), false); assert.equal(existsSync(join(f.directory, 'escaped-private.json')), false);
  adversarialArchive(f, Buffer.alloc(32 * 1024 * 1024 + 1, 65));
  result = f.invoke(['--open'], f.opening());
  assert.notEqual(result.status, 0); assert.match(result.stderr, /DEPENDENCY_SEED_DECRYPT_INVALID/); assert.equal(existsSync(f.opened), false);
});
