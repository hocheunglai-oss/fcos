import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const hook = new URL('../.githooks/pre-push', import.meta.url).pathname;
const pinned = 'https://github.com/hocheunglai-oss/fcos.git', zero = '0'.repeat(40);
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fcos-publication-')), repo = path.join(root, 'repo'), remote = path.join(root, 'remote.git'), bin = path.join(root, 'bin');
  mkdirSync(repo); mkdirSync(bin);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => { const result = spawnSync(realGit, args, { cwd: repo, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  git(['init', '--quiet']); git(['config', 'user.name', 'Offline Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'fcos.expectedGithubAccount', 'hocheunglai-oss']);
  git(['remote', 'add', 'origin', pinned]); git(['init', '--bare', '--quiet', remote]);
  const write = (file, value) => { mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); writeFileSync(path.join(repo, file), value); };
  const commit = (file, value) => { write(file, value); git(['add', '--', file]); git(['commit', '--quiet', '-m', 'fixture change']); return git(['rev-parse', 'HEAD']); };
  const publish = (sha, branch) => git(['-c', 'core.hooksPath=/dev/null', 'push', '--quiet', remote, `${sha}:refs/heads/${branch}`]);
  const base = commit('force-app/main/default/classes/Example.cls', 'class Example {}\n'); publish(base, 'main');
  git(['update-ref', 'refs/remotes/origin/main', base]);
  const calls = path.join(root, 'git-calls'), npm = path.join(root, 'npm-called'), gh = path.join(root, 'gh-env');
  for (const [name, source] of Object.entries({
    git: `#!/bin/sh
printf '%s\\n' "$1" >> "$FCOS_TEST_GIT_CALLS"
if [ "$1" = ls-remote ]; then
  [ "$FCOS_TEST_REMOTE_FAILURE" != 1 ] || exit 128
  if [ -n "$FCOS_TEST_ADVERTISEMENT" ]; then cat "$FCOS_TEST_ADVERTISEMENT"; exit 0; fi
  exec "$FCOS_TEST_REAL_GIT" ls-remote --heads "$FCOS_TEST_REMOTE"
fi
if [ "$1" = fetch ]; then
  [ "$2" = --no-tags ] && [ "$3" = --no-write-fetch-head ] && [ "$4" = --no-recurse-submodules ] \
    && [ "$5" = --no-auto-maintenance ] && [ "$6" = "https://github.com/hocheunglai-oss/fcos.git" ] || exit 128
  shift 6
  exec "$FCOS_TEST_REAL_GIT" fetch --no-tags --no-write-fetch-head --no-recurse-submodules --no-auto-maintenance "$FCOS_TEST_REMOTE" "$@"
fi
exec "$FCOS_TEST_REAL_GIT" "$@"
`,
    gh: `#!/bin/sh
printf '%s|%s|%s' "\${GH_TOKEN+x}" "\${GITHUB_TOKEN+x}" "$GH_CONFIG_DIR" > "$FCOS_TEST_GH_ENV"
printf '%s\\n' "$FCOS_TEST_ACCOUNT"
`,
    npm: `#!/bin/sh
printf called >> "$FCOS_TEST_NPM"
exit "\${FCOS_TEST_MIRROR_STATUS:-1}"
`,
  })) { writeFileSync(path.join(bin, name), source); chmodSync(path.join(bin, name), 0o700); }
  function run({ tips = [git(['rev-parse', 'HEAD'])], account = 'hocheunglai-oss', remoteFailure = false, advertisement, mirrorStatus = 1 } = {}) {
    for (const file of [calls, npm, gh]) if (existsSync(file)) rmSync(file);
    const started = performance.now();
    const result = spawnSync('sh', [hook, 'origin', pinned], { cwd: repo, encoding: 'utf8',
      input: tips.map((tip, index) => `refs/heads/topic${index} ${tip} refs/heads/topic${index} ${zero}\n`).join(''),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: 'inherited-must-be-removed', GITHUB_TOKEN: 'inherited-must-be-removed',
        FCOS_TEST_REAL_GIT: realGit, FCOS_TEST_REMOTE: remote, FCOS_TEST_GIT_CALLS: calls, FCOS_TEST_NPM: npm, FCOS_TEST_GH_ENV: gh,
        FCOS_TEST_ACCOUNT: account, FCOS_TEST_REMOTE_FAILURE: remoteFailure ? '1' : '0', FCOS_TEST_ADVERTISEMENT: advertisement || '', FCOS_TEST_MIRROR_STATUS: String(mirrorStatus) } });
    return { ...result, elapsedMs: performance.now() - started, mirrorCalls: existsSync(npm) ? readFileSync(npm, 'utf8').split('called').length - 1 : 0,
      gitCalls: readFileSync(calls, 'utf8').trim().split('\n'), githubIdentityCalls: existsSync(gh) ? 1 : 0, githubEnvironment: existsSync(gh) ? readFileSync(gh, 'utf8') : null };
  }
  return { root, repo, remote, base, git, write, commit, publish, run };
}

test('new frontend branch from already advertised Production history needs no mirror', t => {
  const f = fixture(t), production = f.commit('force-app/main/default/classes/Example.cls', 'class Example { String published; }\n');
  f.publish(production, 'production-history');
  f.commit('src/frontend.js', 'export const desktop = true;\n');
  assert.notEqual(f.git(['merge-base', 'HEAD', 'refs/remotes/origin/main']), production);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr); assert.equal(result.mirrorCalls, 0);
  assert.equal(result.gitCalls.filter(command => command === 'ls-remote').length, 1);
  assert.equal(result.gitCalls.filter(command => command === 'cat-file').length, 1);
  assert.equal(result.gitCalls.filter(command => command === 'rev-list').length, 1);
  assert.equal(result.gitCalls.filter(command => command === 'diff-tree').length, 1);
  t.diagnostic(`representative check: ${Math.round(result.elapsedMs)} ms; ${result.gitCalls.length} Git CLI calls, ${result.githubIdentityCalls} GitHub identity call, 1 remote advertisement, 0 mirror/Salesforce calls`);
});

test('new Salesforce commit requires mirror even when a later commit reverts its tree', t => {
  const f = fixture(t);
  const unpublished = f.commit('force-app/main/default/classes/Example.cls', 'class Example { String unpublished; }\n');
  f.git(['revert', '--no-edit', unpublished]);
  assert.equal(f.git(['diff', f.base, 'HEAD', '--', 'force-app']), '');
  const result = f.run(); assert.equal(result.status, 1); assert.equal(result.mirrorCalls, 1); assert.match(result.stderr, /byte-for-byte/);
});

test('pre-push fetches an advertised commit absent locally without updating refs', t => {
  const f = fixture(t);
  const remoteGit = (...args) => {
    const result = spawnSync(realGit, ['--git-dir', f.remote, '-c', 'user.name=Offline Fixture',
      '-c', 'user.email=fixture@example.invalid', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const remoteOnly = remoteGit('commit-tree', f.base + '^{tree}', '-p', f.base, '-m', 'remote-only journal update');
  remoteGit('update-ref', 'refs/heads/rapid-journal', remoteOnly);
  assert.equal(f.git(['cat-file', '--batch-check', '--batch-all-objects']).includes(remoteOnly), false);
  f.commit('src/frontend.js', 'export const desktop = true;\n');
  const refsBefore = f.git(['show-ref']);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.mirrorCalls, 0);
  assert.equal(result.gitCalls.filter(command => command === 'fetch').length, 1);
  assert.equal(f.git(['cat-file', '-t', remoteOnly]), 'commit');
  assert.equal(f.git(['show-ref']), refsBefore);
  assert.equal(existsSync(path.join(f.repo, '.git', 'FETCH_HEAD')), false);
  t.diagnostic(`recovered in ${Math.round(result.elapsedMs)} ms with one exact Git fetch and zero mirror calls`);
});

test('unadvertised local refs cannot attest an unpublished Salesforce commit', t => {
  const f = fixture(t), tip = f.commit('force-app/main/default/classes/Example.cls', 'class Example { String spoofed; }\n');
  f.git(['update-ref', 'refs/remotes/origin/already-published', tip]);
  const result = f.run(); assert.equal(result.status, 1); assert.equal(result.mirrorCalls, 1);
});

test('local replacement objects cannot conceal an unpublished Salesforce commit', t => {
  const f = fixture(t), tip = f.commit('force-app/main/default/classes/Example.cls', 'class Example { String changed; }\n');
  const emptyTree = f.git(['hash-object', '-t', 'tree', '--stdin']);
  const replacement = f.git(['commit-tree', emptyTree, '-m', 'untrusted local replacement']);
  f.git(['replace', tip, replacement]);
  assert.equal(f.git(['ls-tree', '--name-only', tip]), '');
  const result = f.run({ tips: [tip] }); assert.equal(result.status, 1); assert.equal(result.mirrorCalls, 1);
});

test('shallow or grafted local histories conservatively require mirror', t => {
  const f = fixture(t), tip = f.commit('src/frontend.js', 'export const frontend = true;\n');
  writeFileSync(path.join(f.repo, '.git', 'shallow'), `${tip}\n`);
  const shallow = f.run({ tips: [tip] }); assert.equal(shallow.status, 1); assert.equal(shallow.mirrorCalls, 1);
  rmSync(path.join(f.repo, '.git', 'shallow'));
  mkdirSync(path.join(f.repo, '.git', 'info'), { recursive: true });
  writeFileSync(path.join(f.repo, '.git', 'info', 'grafts'), `${tip}\n`);
  const grafted = f.run({ tips: [tip] }); assert.equal(grafted.status, 1); assert.equal(grafted.mirrorCalls, 1);
});

test('remote failure or unknown advertised object conservatively requires mirror', t => {
  const f = fixture(t); f.commit('src/frontend.js', 'export const frontend = true;\n');
  const unavailable = f.run({ remoteFailure: true }); assert.equal(unavailable.status, 1); assert.equal(unavailable.mirrorCalls, 1);
  const advertisement = path.join(f.root, 'unknown-advertisement'); writeFileSync(advertisement, `${'f'.repeat(40)}\trefs/heads/unavailable\n`);
  const unknown = f.run({ advertisement }); assert.equal(unknown.status, 1); assert.equal(unknown.mirrorCalls, 1);
  assert.equal(unknown.gitCalls.filter(command => command === 'fetch').length, 1);
  writeFileSync(advertisement, Array.from({ length: 9 }, (_, index) =>
    `${'f'.repeat(39)}${index}\trefs/heads/unavailable-${index}\n`).join(''));
  const excessive = f.run({ advertisement });
  assert.equal(excessive.status, 1);
  assert.equal(excessive.mirrorCalls, 1);
  assert.equal(excessive.gitCalls.includes('fetch'), false);
});

test('wrong isolated account blocks before remote reads or mirror calls', t => {
  const f = fixture(t), result = f.run({ account: 'wrong-account' });
  assert.equal(result.status, 1); assert.equal(result.mirrorCalls, 0); assert.equal(result.gitCalls.includes('ls-remote'), false);
  assert.ok(result.githubEnvironment.startsWith('||')); assert.match(result.stderr, /isolated GitHub CLI identity/);
});

test('merge-only Salesforce resolution is inspected against every published parent', t => {
  const f = fixture(t);
  f.git(['checkout', '--quiet', '-b', 'left']); const left = f.commit('force-app/main/default/classes/Example.cls', 'left\n'); f.publish(left, 'left');
  f.git(['checkout', '--quiet', '-b', 'right', f.base]); const right = f.commit('force-app/main/default/classes/Example.cls', 'right\n'); f.publish(right, 'right');
  const merge = spawnSync(realGit, ['merge', '--no-ff', left, '-m', 'merge'], { cwd: f.repo, encoding: 'utf8' }); assert.equal(merge.status, 1);
  f.commit('force-app/main/default/classes/Example.cls', 'new merge resolution\n');
  const result = f.run(); assert.equal(result.status, 1); assert.equal(result.mirrorCalls, 1);
});

test('multiple pushed tips are batched and any unpublished Salesforce commit requires mirror', t => {
  const f = fixture(t), frontend = f.commit('src/frontend.js', 'export const frontend = true;\n');
  const salesforce = f.commit('force-app/main/default/classes/Example.cls', 'class Example { String changed; }\n');
  const result = f.run({ tips: [frontend, salesforce], mirrorStatus: 0 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.mirrorCalls, 1);
  assert.equal(result.gitCalls.filter(command => command === 'rev-list').length, 1);
  assert.equal(result.gitCalls.filter(command => command === 'diff-tree').length, 1);
});

test('an advertised review-only ref cannot establish ordinary Salesforce publication', t => {
  const f = fixture(t);
  const candidate = f.commit('force-app/main/default/classes/Example.cls', 'class Example { String reviewOnly; }\n');
  f.publish(candidate, 'codex/fcos-salesforce-review/' + candidate);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.equal(result.mirrorCalls, 1);
  assert.match(result.stderr, /byte-for-byte/u);
});
