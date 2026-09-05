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
  merge-base) printf '%s\\n' "$MOCK_BASE_SHA" ;;
  diff) printf '%s\\n' "$MOCK_CHANGED_PATHS" ;;
  ls-tree) printf '%s\\n' "$MOCK_TREE_PATHS" ;;
esac
`;

const ghMock = `#!/bin/sh
printf '%s|%s|%s' "\${GH_TOKEN+x}" "\${GITHUB_TOKEN+x}" "$GH_CONFIG_DIR" > "$MOCK_GH_ENV"
printf '%s\\n' "$MOCK_GH_ACCOUNT"
`;

const npmMock = `#!/bin/sh
printf called > "$MOCK_NPM_CALLED"
exit "\${MOCK_NPM_STATUS:-0}"
`;

async function makeExecutable(filename, source) {
  await writeFile(filename, source);
  await chmod(filename, 0o700);
}

async function runHook(t, { account = 'hocheunglai-oss', changedPaths = 'src/App.jsx', npmStatus = 0 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fcos-pre-push-'));
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  const ghEnv = path.join(root, 'gh-env');
  const npmCalled = path.join(root, 'npm-called');
  await Promise.all([mkdir(path.join(repo, '.git'), { recursive: true }), mkdir(bin, { recursive: true })]);
  await Promise.all([
    makeExecutable(path.join(bin, 'git'), gitMock),
    makeExecutable(path.join(bin, 'gh'), ghMock),
    makeExecutable(path.join(bin, 'npm'), npmMock),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync('sh', [hook.pathname, 'origin', 'https://github.com/hocheunglai-oss/fcos.git'], {
    cwd: repo,
    input: `refs/heads/topic ${LOCAL_SHA} refs/heads/topic ${ZERO_SHA}\\n`,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GH_TOKEN: 'inherited-token-must-not-be-used',
      GITHUB_TOKEN: 'inherited-token-must-not-be-used',
      MOCK_REPO_ROOT: repo,
      MOCK_HAS_ORIGIN_MAIN: '1',
      MOCK_MAIN_SHA: MAIN_SHA,
      MOCK_BASE_SHA: BASE_SHA,
      MOCK_TREE_PATHS: 'force-app/main/default/classes/should-not-be-used.cls',
      MOCK_CHANGED_PATHS: changedPaths,
      MOCK_GH_ACCOUNT: account,
      MOCK_GH_ENV: ghEnv,
      MOCK_NPM_CALLED: npmCalled,
      MOCK_NPM_STATUS: String(npmStatus),
    },
  });
  return { result, ghEnv, npmCalled, repo };
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
