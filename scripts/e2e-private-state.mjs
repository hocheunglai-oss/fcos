import { chmod, constants, lstat, mkdir, open, rm, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const privateOpenFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

function requiredAbsolutePath(value, name) {
  if (typeof value !== 'string' || !value || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return value;
}

function safePrivateStateDirectory(value) {
  const directory = requiredAbsolutePath(value, 'FCOS_E2E_STATE_DIR');
  const resolved = resolve(directory);
  const workspace = resolve(process.cwd());
  if (resolved === '/' || resolved === '/tmp' || resolved === workspace || resolved.startsWith(`${workspace}/`)) {
    throw new Error('FCOS_E2E_STATE_DIR must be a dedicated runner temporary directory, not a broad directory.');
  }
  return resolved;
}

export function privateE2eStatePaths(env = process.env) {
  const directory = safePrivateStateDirectory(env.FCOS_E2E_STATE_DIR);
  const storageState = requiredAbsolutePath(env.FCOS_E2E_STORAGE_STATE, 'FCOS_E2E_STORAGE_STATE');
  const protectionState = requiredAbsolutePath(env.FCOS_E2E_PROTECTION_STATE, 'FCOS_E2E_PROTECTION_STATE');
  if (storageState === protectionState || dirname(storageState) !== directory || dirname(protectionState) !== directory) {
    throw new Error('Authentication and protection state must use separate files in FCOS_E2E_STATE_DIR.');
  }
  return { directory, storageState, protectionState };
}

async function securePrivateDirectory(directory, {
  makeDirectory = mkdir,
  inspect = lstat,
  secure = chmod,
  allowExisting = true,
} = {}) {
  try {
    await makeDirectory(directory, { mode: PRIVATE_DIRECTORY_MODE });
  } catch (error) {
    if (error?.code !== 'EEXIST' || !allowExisting) throw error;
  }
  const status = await inspect(directory);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error('FCOS_E2E_STATE_DIR must be a real private directory.');
  }
  if (typeof status.uid === 'number' && status.uid !== process.getuid()) {
    throw new Error('FCOS_E2E_STATE_DIR must be owned by the current runner user.');
  }
  await secure(directory, PRIVATE_DIRECTORY_MODE);
}

export async function preparePrivateE2eState({ env = process.env, dependencies = {} } = {}) {
  const paths = privateE2eStatePaths(env);
  await securePrivateDirectory(paths.directory, dependencies);
  return paths;
}

export async function writePrivateE2eState({
  env = process.env,
  path,
  state,
  dependencies = {},
} = {}) {
  const paths = await preparePrivateE2eState({ env, dependencies });
  if (path !== paths.storageState && path !== paths.protectionState) {
    throw new Error('Refusing to write browser state outside the private E2E state paths.');
  }
  const openFile = dependencies.openFile || open;
  let handle;
  try {
    handle = await openFile(path, privateOpenFlags, PRIVATE_FILE_MODE);
    await handle.writeFile(JSON.stringify(state));
    await handle.chmod(PRIVATE_FILE_MODE);
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      throw new Error('Refusing to overwrite or follow an existing browser-state file.');
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return path;
}

export function candidateAuthenticationState(state, candidateUrl) {
  const candidate = new URL(candidateUrl);
  const origin = candidate.origin;
  const hostname = candidate.hostname;
  const cookies = Array.isArray(state?.cookies)
    ? state.cookies.filter((cookie) => cookie?.domain === hostname)
    : [];
  const origins = Array.isArray(state?.origins)
    ? state.origins.filter((entry) => entry?.origin === origin)
    : [];
  if (!cookies.length && !origins.length) {
    throw new Error('FCUNO authentication did not create candidate-origin browser state.');
  }
  return { cookies, origins };
}

export async function removePrivateE2eState({ env = process.env, remove = rm, removeDirectory = rmdir, inspect = lstat } = {}) {
  const { directory, storageState, protectionState } = privateE2eStatePaths(env);
  let status;
  try {
    status = await inspect(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error('Refusing to remove a non-directory E2E state path.');
  }
  if (typeof status.uid === 'number' && status.uid !== process.getuid()) {
    throw new Error('Refusing to remove an E2E state directory not owned by the current runner user.');
  }
  // Validate the parent before touching either child. A substituted symlink
  // must never redirect cleanup into another directory.
  for (const path of [storageState, protectionState]) await remove(path, { force: true });
  // Preserve any unexpected child instead of recursively deleting a directory
  // that may no longer be the one this run created.
  await removeDirectory(directory);
}

async function main(command = process.argv[2]) {
  if (command === 'prepare') return preparePrivateE2eState({ dependencies: { allowExisting: false } });
  if (command === 'cleanup') return removePrivateE2eState();
  throw new Error('Usage: e2e-private-state.mjs prepare|cleanup');
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
