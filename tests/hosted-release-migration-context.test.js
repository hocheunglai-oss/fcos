import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitisedCheckEnvironment } from '../scripts/lib/hosted-release/checks.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fcos-migration-context-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const controllerDirectory = join(root, 'controller'), candidateDirectory = join(root, 'candidate');
  mkdirSync(join(controllerDirectory, 'output'), { recursive: true });
  mkdirSync(candidateDirectory);
  const controllerSha = 'a'.repeat(40), candidateSha = 'b'.repeat(40);
  const proof = { kind: 'fcos_disposable_migration_parent_proof_v1', schemaVersion: 1,
    projectId: 'fcos', source: { controllerSha, candidateSha } };
  const bytes = `${JSON.stringify(proof)}\n`, file = join(controllerDirectory, 'output/disposable-migration-server.json');
  writeFileSync(file, bytes, { mode: 0o400 });
  return { root, file, bytes, proof, home: root, controllerDirectory, candidateDirectory, controllerSha, candidateSha,
    checkId: 'migrations', command: { env: { FCOS_MIGRATION_PARENT_PROOF_FILE: '/controller/output/disposable-migration-server.json',
      FCOS_MIGRATION_PROJECT_ID: 'fcos', FCOS_MIGRATION_DOCKER_CONTAINER: 'supabase_db_fcos',
      FCOS_MIGRATION_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', FCOS_MIGRATION_DISPOSABLE_CLUSTER: '1' } },
    environment: { GITHUB_ACTIONS: 'true', FCOS_HOSTED_CHECK_EXECUTION: '1', FCOS_HOSTED_MIGRATION_PARENT_PROOF_SHA256: sha(bytes),
      GITHUB_TOKEN: 'must-not-cross', VERCEL_TOKEN: 'must-not-cross', FCOS_CANDIDATE_SHA: 'c'.repeat(40) } };
}

test('migration context passes only the physical source-bound public proof into the candidate', t => {
  const f = fixture(t), env = sanitisedCheckEnvironment(f);
  assert.equal(env.FCOS_MIGRATION_PARENT_PROOF_SHA256, sha(f.bytes));
  assert.equal(env.FCOS_CONTROLLER_SHA, f.controllerSha);
  assert.equal(env.FCOS_CANDIDATE_SHA, f.candidateSha);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.VERCEL_TOKEN, undefined);
  assert.equal(env.FCOS_HOSTED_MIGRATION_PARENT_PROOF_SHA256, undefined);
});

for (const [name, change] of [
  ['another check', f => { f.checkId = 'unit'; }],
  ['untrusted execution', f => { f.environment.GITHUB_ACTIONS = 'false'; }],
  ['missing isolation', f => { delete f.environment.FCOS_HOSTED_CHECK_EXECUTION; }],
  ['missing proof digest', f => { delete f.environment.FCOS_HOSTED_MIGRATION_PARENT_PROOF_SHA256; }],
  ['changed candidate', f => { f.candidateSha = 'd'.repeat(40); }],
  ['changed controller', f => { f.controllerSha = 'd'.repeat(40); }],
  ['another proof path', f => { f.command.env.FCOS_MIGRATION_PARENT_PROOF_FILE = '/candidate/proof.json'; }],
  ['another database', f => { f.command.env.FCOS_MIGRATION_DATABASE_URL = 'postgresql://postgres:postgres@example.invalid/postgres'; }],
  ['another container', f => { f.command.env.FCOS_MIGRATION_DOCKER_CONTAINER = 'supabase_db_other'; }],
  ['writable proof', f => { chmodSync(f.file, 0o600); }],
  ['changed proof bytes', f => { chmodSync(f.file, 0o600); writeFileSync(f.file, '{}'); chmodSync(f.file, 0o400); }],
  ['symlink proof', f => { const target = join(f.root, 'other-proof.json'); writeFileSync(target, f.bytes, { mode: 0o400 }); rmSync(f.file); symlinkSync(target, f.file); }],
]) test(`migration context refuses ${name} before candidate execution`, t => {
  const f = fixture(t); change(f);
  assert.throws(() => sanitisedCheckEnvironment(f));
});

test('ordinary checks do not inherit a parent fixture or provider credentials', t => {
  const f = fixture(t); f.command = { env: {} }; f.checkId = 'unit';
  const env = sanitisedCheckEnvironment(f);
  assert.equal(env.FCOS_MIGRATION_PARENT_PROOF_SHA256, undefined);
  assert.equal(env.FCOS_CONTROLLER_SHA, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
});
