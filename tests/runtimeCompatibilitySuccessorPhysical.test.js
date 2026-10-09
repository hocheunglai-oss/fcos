import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { SOURCE_ROOT, cleanGitEnvironment } from './helpers/runtimeCompatibilitySuccessorPortable.mjs';

// Actual repository source bytes are bound before import. All11 physical cases
// create real disposable synthetic Git repositories; none is a live candidate.
const helperPath = join(SOURCE_ROOT, 'scripts/lib/build-provenance.mjs');
assert.equal(createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex'), 'e09e63875b79f7324e27424119d47612606a7a985bcf9056b3fa3a307320bd16');
const { collectBuildProvenance } = await import(pathToFileURL(helperPath));
const temporary = fs.mkdtempSync(join(tmpdir(), 'fcos-404bc-physical-negative-'));
const gitEnv = cleanGitEnvironment();
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
let number = 0;
const git = (cwd, args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
function repo() {
  const cwd = join(temporary, String(++number)); fs.mkdirSync(cwd);
  git(cwd, ['-c', 'init.templateDir=', 'init', '--quiet']);
  fs.writeFileSync(join(cwd, 'app.js'), 'export const fixture = true;\n');
  fs.writeFileSync(join(cwd, 'package-lock.json'), '{"name":"disposable-provenance-fixture","lockfileVersion":3}\n');
  fs.writeFileSync(join(cwd, '.vercelignore'), 'excluded.txt\n');
  fs.writeFileSync(join(cwd, 'excluded.txt'), 'tracked upload-excluded fixture\n');
  git(cwd, ['add', '--', 'app.js', 'package-lock.json', '.vercelignore', 'excluded.txt']);
  git(cwd, ['-c', 'user.name=FCOS local negative test', '-c', 'user.email=fixture.invalid@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'disposable synthetic provenance fixture']);
  const baseline = collectBuildProvenance({ cwd, env: {}, requireClean: true });
  assert.equal(baseline.gitDirty, false); assert.equal(baseline.releaseEligible, true);
  return { cwd, baseline };
}
function rejected(cwd, pattern = /verified clean Git checkout/) {
  assert.throws(() => collectBuildProvenance({ cwd, env: {}, requireClean: true }), pattern);
  const unclean = collectBuildProvenance({ cwd, env: {}, requireClean: false });
  assert.equal(unclean.gitDirty, true); assert.equal(unclean.releaseEligible, false);
  return unclean;
}

test('P01 physical unstaged bytes are rejected by actual repository provenance', t => {
  const { cwd, baseline } = repo(); fs.appendFileSync(join(cwd, 'app.js'), '// uncommitted\n');
  const result = rejected(cwd); assert.notEqual(result.sourceDigest, baseline.sourceDigest);
  t.diagnostic('Real disposable Git repository; physical bytes differ from committed blob.');
});
test('P02 staged index content with restored physical HEAD still fails clean provenance', t => {
  const { cwd } = repo(); const original = fs.readFileSync(join(cwd, 'app.js'));
  fs.appendFileSync(join(cwd, 'app.js'), '// staged-only\n'); git(cwd, ['add', '--', 'app.js']);
  fs.writeFileSync(join(cwd, 'app.js'), original);
  assert.equal(git(cwd, ['status', '--porcelain=v1', '--', 'app.js']), 'MM app.js'); rejected(cwd);
  t.diagnostic('Physical bytes match HEAD; staged index differs, so status integrity rejects.');
});
test('P03 staged deletion with physical file restored still fails clean provenance', () => {
  const { cwd } = repo(); git(cwd, ['rm', '--cached', '--quiet', '--', 'app.js']);
  assert.equal(fs.readFileSync(join(cwd, 'app.js'), 'utf8'), 'export const fixture = true;\n'); rejected(cwd);
});
test('P04 assume-unchanged hides status but actual bytes are rejected', t => {
  const { cwd } = repo(); git(cwd, ['update-index', '--assume-unchanged', '--', 'app.js']);
  fs.appendFileSync(join(cwd, 'app.js'), '// hidden physical change\n');
  assert.equal(git(cwd, ['status', '--porcelain=v1']), '');
  assert.ok(git(cwd, ['ls-files', '-v', '--', 'app.js']).startsWith('h ')); rejected(cwd);
  t.diagnostic('Git status is empty; actual physical/blob comparison catches assume-unchanged.');
});
test('P05 skip-worktree hides status but actual bytes are rejected', t => {
  const { cwd } = repo(); git(cwd, ['update-index', '--skip-worktree', '--', 'app.js']);
  fs.appendFileSync(join(cwd, 'app.js'), '// hidden skip-worktree change\n');
  assert.equal(git(cwd, ['status', '--porcelain=v1']), '');
  assert.ok(git(cwd, ['ls-files', '-v', '--', 'app.js']).startsWith('S ')); rejected(cwd);
  t.diagnostic('Git status is empty; actual physical/blob comparison catches skip-worktree.');
});
test('P06 hidden executable physical mode with core.filemode false is rejected', () => {
  const { cwd } = repo(); git(cwd, ['config', '--local', 'core.filemode', 'false']);
  fs.chmodSync(join(cwd, 'app.js'), 0o755);
  assert.equal(git(cwd, ['status', '--porcelain=v1']), ''); rejected(cwd);
});
test('P07 upload-excluded tracked physical change remains a clean-checkout failure', () => {
  const { cwd, baseline } = repo(); fs.appendFileSync(join(cwd, 'excluded.txt'), 'changed\n');
  const result = rejected(cwd); assert.equal(result.sourceDigest, baseline.sourceDigest);
});
test('P08 untracked deployment input fails clean provenance', () => {
  const { cwd } = repo(); fs.writeFileSync(join(cwd, 'extra.js'), 'export const unexpected = true;\n'); rejected(cwd);
});
test('P09 physical source symlink is rejected before following target', () => {
  const { cwd } = repo(); fs.unlinkSync(join(cwd, 'app.js')); fs.symlinkSync('package-lock.json', join(cwd, 'app.js'));
  assert.throws(() => collectBuildProvenance({ cwd, env: {}, requireClean: true }), /regular source files/);
});
test('P10 generated receipt symlink ancestor is rejected', () => {
  const { cwd } = repo(); const outside = join(temporary, 'receipt-target'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, join(cwd, 'public'));
  assert.throws(() => collectBuildProvenance({ cwd, env: {}, requireClean: true }), /Generated receipt paths/);
});
test('P11 claimed HEAD and claimed source digest cannot mask hidden physical changes', () => {
  const { cwd, baseline } = repo(); git(cwd, ['update-index', '--assume-unchanged', '--', 'app.js']);
  fs.appendFileSync(join(cwd, 'app.js'), '// hidden attestation mismatch\n');
  assert.throws(() => collectBuildProvenance({ cwd, env: { VERCEL: '1', FCOS_BUILD_COMMIT_SHA: baseline.commit, FCOS_EXPECTED_SOURCE_SHA256: baseline.sourceDigest }, requireClean: true }), /source digest does not match/);
});
