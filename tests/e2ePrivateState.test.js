import assert from 'node:assert/strict';
import test from 'node:test';
import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  candidateAuthenticationState,
  preparePrivateE2eState,
  privateE2eStatePaths,
  removePrivateE2eState,
  writePrivateE2eState,
} from '../scripts/e2e-private-state.mjs';

const directory = '/tmp/fcos-e2e-private-state';
const env = {
  FCOS_E2E_STATE_DIR: directory,
  FCOS_E2E_STORAGE_STATE: `${directory}/auth.json`,
  FCOS_E2E_PROTECTION_STATE: `${directory}/protection.json`,
};

const directoryStatus = () => ({ isDirectory: () => true, isSymbolicLink: () => false });

test('private E2E state paths are absolute, distinct, and confined to one state directory', () => {
  assert.deepEqual(privateE2eStatePaths(env), {
    directory,
    storageState: `${directory}/auth.json`,
    protectionState: `${directory}/protection.json`,
  });
  for (const patch of [
    { FCOS_E2E_STATE_DIR: 'relative' },
    { FCOS_E2E_STORAGE_STATE: '/tmp/other/auth.json' },
    { FCOS_E2E_PROTECTION_STATE: `${directory}/auth.json` },
    { FCOS_E2E_STATE_DIR: '/tmp' },
    { FCOS_E2E_STATE_DIR: process.cwd() },
  ]) assert.throws(() => privateE2eStatePaths({ ...env, ...patch }));
});

test('private state directory is a non-symlink 0700 directory', async () => {
  const calls = [];
  await preparePrivateE2eState({ env, dependencies: {
    makeDirectory: async (...args) => calls.push(['mkdir', ...args]),
    inspect: async () => directoryStatus(),
    secure: async (...args) => calls.push(['chmod', ...args]),
  } });
  assert.deepEqual(calls[0], ['mkdir', directory, { mode: 0o700 }]);
  assert.deepEqual(calls[1], ['chmod', directory, 0o700]);
  await assert.rejects(preparePrivateE2eState({ env, dependencies: {
    makeDirectory: async () => {},
    inspect: async () => ({ isDirectory: () => true, isSymbolicLink: () => true }),
    secure: async () => {},
  } }), /real private directory/);
  await assert.rejects(preparePrivateE2eState({ env, dependencies: {
    makeDirectory: async () => {},
    inspect: async () => ({ ...directoryStatus(), uid: process.getuid() + 1 }),
    secure: async () => {},
  } }), /owned by the current runner user/);
});

test('private state uses exclusive no-follow creation and never overwrites a prior path', async () => {
  const calls = [];
  const handle = {
    writeFile: async (value) => calls.push(['write', value]),
    chmod: async (...args) => calls.push(['file-chmod', ...args]),
    sync: async () => calls.push(['sync']),
    close: async () => calls.push(['close']),
  };
  await writePrivateE2eState({ env, path: env.FCOS_E2E_STORAGE_STATE, state: { cookies: [] }, dependencies: {
    makeDirectory: async () => {}, inspect: async () => directoryStatus(), secure: async () => {},
    openFile: async (...args) => { calls.push(['open', ...args]); return handle; },
  } });
  assert.equal(calls[0][0], 'open');
  assert.equal(calls[0][1], env.FCOS_E2E_STORAGE_STATE);
  assert.ok(calls[0][2] & constants.O_EXCL);
  assert.ok(calls[0][2] & constants.O_NOFOLLOW);
  assert.equal(calls[0][3], 0o600);
  assert.deepEqual(calls.at(-1), ['close']);
  await assert.rejects(writePrivateE2eState({ env, path: env.FCOS_E2E_STORAGE_STATE, state: {}, dependencies: {
    makeDirectory: async () => {}, inspect: async () => directoryStatus(), secure: async () => {},
    openFile: async () => { const error = new Error('exists'); error.code = 'EEXIST'; throw error; },
  } }), /Refusing to overwrite/);
});

test('authentication state retains only the candidate origin, never the FCUNO issuer session', () => {
  const candidateUrl = 'https://fcos-a1b2c3d4e-hocheunglai-6535s-projects.vercel.app';
  assert.deepEqual(candidateAuthenticationState({
    cookies: [
      { name: 'candidate', domain: new URL(candidateUrl).hostname },
      { name: 'issuer', domain: 'fcuno.com' },
    ],
    origins: [
      { origin: candidateUrl, localStorage: [{ name: 'token', value: 'candidate' }] },
      { origin: 'https://fcuno.com', localStorage: [{ name: 'issuer', value: 'session' }] },
    ],
  }, candidateUrl), {
    cookies: [{ name: 'candidate', domain: new URL(candidateUrl).hostname }],
    origins: [{ origin: candidateUrl, localStorage: [{ name: 'token', value: 'candidate' }] }],
  });
  assert.throws(() => candidateAuthenticationState({ cookies: [{ domain: 'fcuno.com' }], origins: [] }, candidateUrl));
});

test('cleanup validates its parent before deleting exact children and preserves unexpected contents', async () => {
  const calls = [];
  const remove = async (...args) => calls.push(['remove', ...args]);
  const removeDirectory = async (...args) => calls.push(['rmdir', ...args]);
  for (const status of [
    { ...directoryStatus(), isSymbolicLink: () => true },
    { ...directoryStatus(), uid: process.getuid() + 1 },
    { ...directoryStatus(), isDirectory: () => false },
  ]) {
    await assert.rejects(removePrivateE2eState({ env, remove, removeDirectory, inspect: async () => status }));
    assert.equal(calls.length, 0);
  }
  await removePrivateE2eState({ env, remove, removeDirectory, inspect: async () => directoryStatus() });
  assert.deepEqual(calls, [
    ['remove', env.FCOS_E2E_STORAGE_STATE, { force: true }],
    ['remove', env.FCOS_E2E_PROTECTION_STATE, { force: true }],
    ['rmdir', directory],
  ]);
});

test('the auth setup verifies the pinned read-only CI authorization before persisting state', async () => {
  const setup = await readFile(new URL('../e2e/auth.setup.js', import.meta.url), 'utf8');
  assert.match(setup, /FCOS_READ_ONLY_CI/);
  assert.match(setup, /page.waitForResponse/);
  assert.match(setup, /api\/functions\/authContext/);
  assert.doesNotMatch(setup, /localStorage|session\.access_token/);
  assert.match(setup, /email !== FCOS_READ_ONLY_CI.email/);
  assert.match(setup, /read_only_ci/);
  assert.match(setup, /user_type\)\.toBe\('viewer'\)/);
  assert.match(setup, /capabilities\.every\(\(allowed\) => allowed === false\)/);
  assert.ok(setup.indexOf('assertReadOnlyCiAuthorization({') < setup.lastIndexOf('writePrivateE2eState'));
  assert.doesNotMatch(setup, /console\.(?:log|error|warn)/);
});
