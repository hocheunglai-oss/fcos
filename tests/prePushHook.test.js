import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const hook = new URL('../.githooks/pre-push', import.meta.url);
const ZERO_SHA = '0'.repeat(40);
const LOCAL_SHA = 'a'.repeat(40);
const MAIN_SHA = 'b'.repeat(40);
const BASE_SHA = 'c'.repeat(40);
const reviewRef = 'refs/heads/codex/fcos-salesforce-review/' + LOCAL_SHA;
const ordinaryPush = `refs/heads/topic ${LOCAL_SHA} refs/heads/topic ${ZERO_SHA}\n`;
const reviewedPush = `refs/heads/topic ${LOCAL_SHA} ${reviewRef} ${ZERO_SHA}\n`;

const gitMock = `#!/bin/sh
case "$1" in
  rev-parse)
    case "$2" in
      --show-toplevel) printf '%s\\n' "$MOCK_REPO_ROOT" ;;
      --path-format=absolute) printf '%s\\n' "$MOCK_REPO_ROOT/.git" ;;
      --verify) [ "$MOCK_HAS_ORIGIN_MAIN" = "1" ] && printf '%s\\n' "$MOCK_MAIN_SHA" ;;
      --local-env-vars) printf '%s\\n' GIT_DIR GIT_WORK_TREE ;;
    esac
    ;;
  config) printf '%s\\n' hocheunglai-oss ;;
  remote) printf '%s\\n' https://github.com/hocheunglai-oss/fcos.git ;;
  ls-remote) printf '%s\\trefs/heads/main\\n' "$MOCK_MAIN_SHA" ;;
  cat-file) while read -r object; do printf '%s commit\\n' "$object"; done ;;
  rev-list) printf '%s\\n' "$MOCK_LOCAL_SHA" ;;
  diff-tree) printf '%s\\n' "$MOCK_CHANGED_PATHS" ;;
  merge-base) printf '%s\\n' "$MOCK_BASE_SHA" ;;
  diff) printf '%s\\n' "$MOCK_CHANGED_PATHS" ;;
  ls-tree) printf '%s\\n' "$MOCK_TREE_PATHS" ;;
esac
`;

const ghMock = `#!/bin/sh
printf '%s|%s|%s' "\${GH_TOKEN+x}" "\${GITHUB_TOKEN+x}" "$GH_CONFIG_DIR" > "$MOCK_GH_ENV"
if [ "$2" = "repos/hocheunglai-oss/fcos" ]; then
  printf '%s\\n' "$MOCK_GH_REPOSITORY"
else
  printf '%s\\n' "$MOCK_GH_ACCOUNT"
fi
`;

const npmMock = `#!/bin/sh
printf called > "$MOCK_NPM_CALLED"
exit "\${MOCK_NPM_STATUS:-0}"
`;

const nodeMock = `#!/bin/sh
printf '%s\\n' "$@" > "$MOCK_NODE_CALLED"
exit "$MOCK_NODE_STATUS"
`;

async function makeExecutable(filename, source) {
  await writeFile(filename, source);
  await chmod(filename, 0o700);
}

async function runHook(t, { account = 'hocheunglai-oss', repository = 'hocheunglai-oss/fcos:1278654816',
  changedPaths = 'src/App.jsx', npmStatus = 0, nodeStatus = 0, input = ordinaryPush, reviewManifest = '' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fcos-pre-push-'));
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  const ghEnv = path.join(root, 'gh-env');
  const npmCalled = path.join(root, 'npm-called');
  const nodeCalled = path.join(root, 'node-called');
  await Promise.all([mkdir(path.join(repo, '.git'), { recursive: true }), mkdir(bin, { recursive: true })]);
  await Promise.all([
    makeExecutable(path.join(bin, 'git'), gitMock),
    makeExecutable(path.join(bin, 'gh'), ghMock),
    makeExecutable(path.join(bin, 'npm'), npmMock),
    makeExecutable(path.join(bin, 'node'), nodeMock),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync('sh', [hook.pathname, 'origin', 'https://github.com/hocheunglai-oss/fcos.git'], {
    cwd: repo,
    input,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GH_TOKEN: 'inherited-token-must-not-be-used',
      GITHUB_TOKEN: 'inherited-token-must-not-be-used',
      MOCK_REPO_ROOT: repo,
      MOCK_HAS_ORIGIN_MAIN: '1',
      MOCK_MAIN_SHA: MAIN_SHA,
      MOCK_LOCAL_SHA: LOCAL_SHA,
      MOCK_BASE_SHA: BASE_SHA,
      MOCK_TREE_PATHS: 'force-app/main/default/classes/should-not-be-used.cls',
      MOCK_CHANGED_PATHS: changedPaths,
      MOCK_GH_ACCOUNT: account,
      MOCK_GH_REPOSITORY: repository,
      MOCK_GH_ENV: ghEnv,
      MOCK_NPM_CALLED: npmCalled,
      MOCK_NPM_STATUS: String(npmStatus),
      MOCK_NODE_CALLED: nodeCalled,
      MOCK_NODE_STATUS: String(nodeStatus),
      FCOS_SALESFORCE_REVIEW_RELEASE_MANIFEST: reviewManifest,
    },
  });
  return { result, ghEnv, npmCalled, nodeCalled, repo };
}

test('pre-push rejects a mismatched isolated account without inherited GitHub tokens', async (t) => {
  const { result, ghEnv, repo } = await runHook(t, { account: 'wrong-account' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /isolated GitHub CLI identity does not match/);
  assert.equal(await readFile(ghEnv, 'utf8'), `||${repo}/.fcos-cli/github`);
});

test('pre-push blocks new-branch Salesforce metadata changes when the shared mirror is stale', async (t) => {
  const { result, npmCalled } = await runHook(t, {
    changedPaths: 'force-app/main/default/classes/Changed.cls',
    npmStatus: 1,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Salesforce metadata must be published byte-for-byte/);
  assert.equal(await readFile(npmCalled, 'utf8'), 'called');
});

test('pre-push permits a clean new branch even when the proposed tree contains existing Salesforce metadata', async (t) => {
  const { result, npmCalled } = await runHook(t, { changedPaths: 'src/App.jsx' });
  assert.equal(result.status, 0);
  await assert.rejects(() => readFile(npmCalled, 'utf8'));
});

test('review source admits a single exact creation after verification', async t => {
  const reviewManifest = '/tmp/frozen FCOS release.json';
  const { result, nodeCalled, npmCalled, repo } = await runHook(t, {
    input: reviewedPush, reviewManifest, changedPaths: 'force-app/main/default/classes/Changed.cls', npmStatus: 1,
  });
  assert.equal(result.status, 0, result.stderr);
  const [script, directory, sha, manifest] = (await readFile(nodeCalled, 'utf8')).trimEnd().split('\n');
  assert.match(script, /verify-salesforce-review-source\.mjs$/u);
  assert.deepEqual([directory, sha, manifest], [repo, LOCAL_SHA, reviewManifest]);
  await assert.rejects(() => readFile(npmCalled, 'utf8'));
});

test('review source rejects wrong refs, updates, deletions and multi-ref pushes', async t => {
  const inputs = [
    reviewedPush.replace(reviewRef, reviewRef + '-alias'),
    reviewedPush.replace(ZERO_SHA, BASE_SHA),
    reviewedPush.replace(LOCAL_SHA, ZERO_SHA),
    reviewedPush + ordinaryPush,
  ];
  for (const input of inputs) {
    const { result, nodeCalled } = await runHook(t, { input, reviewManifest: '/tmp/frozen.json' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /one new exact commit/u);
    await assert.rejects(() => readFile(nodeCalled, 'utf8'));
  }
});

test('review source requires a verified manifest on the pinned repository', async t => {
  const absent = await runHook(t, { input: reviewedPush });
  assert.equal(absent.result.status, 1);
  assert.match(absent.result.stderr, /exact verified release manifest/u);
  const failed = await runHook(t, { input: reviewedPush, reviewManifest: '/tmp/frozen.json', nodeStatus: 1 });
  assert.equal(failed.result.status, 1);
  assert.match(failed.result.stderr, /exact verified release manifest/u);
  const otherRepository = await runHook(t, {
    input: reviewedPush, reviewManifest: '/tmp/frozen.json', repository: 'hocheunglai-oss/fcos:100',
  });
  assert.equal(otherRepository.result.status, 1);
  assert.match(otherRepository.result.stderr, /pinned FCOS repository/u);
});

test('an ordinary Salesforce push still requires the mirror with a review manifest set', async t => {
  const { result, nodeCalled, npmCalled } = await runHook(t, {
    changedPaths: 'force-app/main/default/classes/Changed.cls', reviewManifest: '/tmp/frozen.json', npmStatus: 1,
  });
  assert.equal(result.status, 1);
  assert.equal(await readFile(npmCalled, 'utf8'), 'called');
  await assert.rejects(() => readFile(nodeCalled, 'utf8'));
});
