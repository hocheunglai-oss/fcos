import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixturePaths = ['scripts/check.mjs', 'config/policy.json', '.github/workflows/release.yml',
  '.github/actions/release/action.yml', '.codex/config.toml', 'AGENTS.md', 'package.json', 'package-lock.json'];
const original = 'fixture original\n', childTimeoutMs = 3000;
const sourceCheck = `import { assertReleaseCoordinatorSource } from ${JSON.stringify(new URL('../scripts/release-coordinator-local.mjs', import.meta.url).href)};
try { const paths = assertReleaseCoordinatorSource(process.argv[1], process.argv[2]);
  process.stdout.write(JSON.stringify({ accepted: true, paths }));
} catch { process.stdout.write(JSON.stringify({ accepted: false })); }`;

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'fcos-coordinator-source-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = args => execFileSync('/usr/bin/git', args, { cwd,
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8', timeout: 3000 }).trim();
  git(['init', '-q']); git(['config', 'user.name', 'Offline fixture']); git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'core.filemode', 'true']);
  for (const path of fixturePaths) { mkdirSync(join(cwd, path, '..'), { recursive: true }); writeFileSync(join(cwd, path), original); }
  git(['add', '.']); git(['commit', '-qm', 'fixture source']);
  return { cwd, git, head: git(['rev-parse', 'HEAD']) };
}

function check(cwd, head) {
  // A synchronous ancestor loop cannot be interrupted by node:test's own timeout.
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', sourceCheck, cwd, head], {
    env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: childTimeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined, `source authentication must finish within ${childTimeoutMs}ms: ${result.error?.code}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  return JSON.parse(result.stdout);
}

test('source authentication terminates for canonical, trailing-slash and URL-derived checkout roots', { timeout: 15000 }, t => {
  const { cwd, head } = fixture(t);
  const urlRoot = fileURLToPath(new URL('./', pathToFileURL(join(cwd, 'package.json'))));
  assert.ok(urlRoot.endsWith('/'));
  for (const root of [realpathSync(cwd), `${cwd}/`, `${cwd}///`, urlRoot]) {
    const result = check(root, head);
    assert.equal(result.accepted, true, root);
    assert.deepEqual([...result.paths].sort(), [...fixturePaths].sort());
  }
});

test('normalized roots retain clean HEAD, hidden-byte, link, mode and replace-ref source refusals', { timeout: 30000 }, t => {
  const { cwd, git, head } = fixture(t), root = `${cwd}/`;
  const reject = () => assert.equal(check(root, head).accepted, false);
  const clean = () => assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '');
  assert.equal(check(root, '0'.repeat(40)).accepted, false);
  assert.equal(check(`${cwd}/scripts/`, head).accepted, false);
  writeFileSync(join(cwd, 'AGENTS.md'), 'dirty source\n'); reject(); writeFileSync(join(cwd, 'AGENTS.md'), original);

  const hidden = '.github/workflows/release.yml';
  for (const flag of ['assume-unchanged', 'skip-worktree']) {
    git(['update-index', `--${flag}`, hidden]); writeFileSync(join(cwd, hidden), 'hidden changed source\n'); clean(); reject();
    writeFileSync(join(cwd, hidden), original); git(['update-index', `--no-${flag}`, hidden]);
  }

  const script = join(cwd, 'scripts/check.mjs'), policy = join(cwd, 'config/policy.json');
  git(['update-index', '--assume-unchanged', 'scripts/check.mjs']);
  chmodSync(script, 0o755); clean(); reject(); chmodSync(script, 0o644);
  unlinkSync(script); linkSync(policy, script); clean(); reject(); unlinkSync(script); writeFileSync(script, original);
  unlinkSync(script); symlinkSync(policy, script); clean(); reject(); unlinkSync(script); writeFileSync(script, original);
  renameSync(join(cwd, 'scripts'), join(cwd, 'actual-scripts'));
  symlinkSync(join(cwd, 'actual-scripts'), join(cwd, 'scripts')); clean(); reject();
  unlinkSync(join(cwd, 'scripts')); renameSync(join(cwd, 'actual-scripts'), join(cwd, 'scripts'));
  git(['update-index', '--no-assume-unchanged', 'scripts/check.mjs']);

  git(['update-ref', `refs/replace/${head}`, head]); reject(); git(['update-ref', '-d', `refs/replace/${head}`]);
  clean(); assert.equal(check(root, head).accepted, true);
});
