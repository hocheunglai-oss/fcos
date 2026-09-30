import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import ignore from 'ignore';

// The generated receipt cannot contribute to its own digest. Release-history
// source remains included: changing the human-readable release is a source change.
export const GENERATED_PROVENANCE_FILES = new Set(['public/app-version.json']);
// Vercel CLI source-upload defaults. Keep in sync with the pinned CLI when it
// changes: https://vercel.com/docs/builds/build-features#ignored-files-and-folders
const VERCEL_DEFAULT_IGNORES = ['.hg', '.git', '.gitmodules', '.svn', '.cache', '.next', '.now', '.vercel',
  '.npmignore', '.dockerignore', '.gitignore', '.*.swp', '.DS_Store', '.wafpicke-*', '.lock-wscript',
  '.env.local', '.env.*.local', '.venv', '.yarn/cache', '.pnp*', 'npm-debug.log', 'config.gypi',
  'node_modules', '__pycache__', 'venv', 'CVS'];

export function isCredentialPath(path) {
  return path.split('/').some(part => /^\.env(?:\.|$)/i.test(part)
    || /^(?:\.npmrc|\.netrc|\.pypirc|credentials(?:\.json)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i.test(part)
    || ['.git', '.fcos-cli', '.sf', '.sfdx', '.vercel', '.aws', '.ssh', '.config'].includes(part));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).trimEnd();
}

export function deploymentSourceFilter(cwd) {
  const readIgnore = name => {
    const path = join(cwd, name);
    try {
      if (!lstatSync(path).isFile()) throw new Error('Build provenance ignore rules must be regular files.');
      return readFileSync(path, 'utf8');
    } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  };
  const vercelIgnore = readIgnore('.vercelignore');
  const nowIgnore = readIgnore('.nowignore');
  if (vercelIgnore && nowIgnore) throw new Error('Build provenance cannot use both .vercelignore and .nowignore.');
  const matcher = ignore().add(VERCEL_DEFAULT_IGNORES).add((vercelIgnore || nowIgnore).replace(/(\n|^)\.\//g, '$1'));
  return path => !isCredentialPath(path) && !GENERATED_PROVENANCE_FILES.has(path) && !matcher.ignores(path);
}

function deploymentSourcePaths(cwd, included, directory = '') {
  const paths = [];
  for (const entry of readdirSync(join(cwd, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (!included(entry.isDirectory() ? `${path}/` : path)) continue;
    if (entry.isDirectory()) paths.push(...deploymentSourcePaths(cwd, included, path));
    else paths.push(path);
  }
  return paths;
}

export function collectBuildProvenance({ cwd = process.cwd(), env = process.env, requireClean = env.FCOS_REQUIRE_CLEAN_BUILD === '1' || env.VERCEL === '1' } = {}) {
  let head = null;
  let paths;
  let gitDirty = null;
  let committedFiles;
  try { head = git(cwd, ['rev-parse', '--verify', 'HEAD']); } catch { /* Source archives have no Git metadata. */ }
  const supplied = ['VERCEL_GIT_COMMIT_SHA', 'FCOS_BUILD_COMMIT_SHA'].map(key => env[key]?.trim()).filter(Boolean);
  for (const sha of supplied) {
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Build provenance requires a full 40-character Git commit SHA.');
    if (head && sha.toLowerCase() !== head.toLowerCase()) throw new Error('Build provenance supplied commit does not match checked-out HEAD.');
  }
  if (new Set(supplied.map(sha => sha.toLowerCase())).size > 1) throw new Error('Build provenance supplied commit identities disagree.');
  const included = deploymentSourceFilter(cwd);
  const uploadedPaths = deploymentSourcePaths(cwd, included);

  if (head) {
    if (realpathSync(git(cwd, ['rev-parse', '--show-toplevel'])) !== realpathSync(cwd)) throw new Error('Build provenance must run from the repository root.');
    paths = [...git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean), ...uploadedPaths];
    committedFiles = new Map(git(cwd, ['ls-tree', '-r', '-z', 'HEAD']).split('\0').filter(Boolean).map(entry => {
      const separator = entry.indexOf('\t');
      const [mode, type, oid] = entry.slice(0, separator).split(' ');
      return [entry.slice(separator + 1), { mode, type, oid }];
    }));
    // Inspect names only, never patches: a credential accidentally tracked by Git
    // must not be hashed, serialized, or printed in public build evidence.
    const status = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
    const changed = [];
    for (let index = 0; index < status.length; index += 1) {
      const entry = status[index];
      changed.push(entry.slice(3));
      if (/[RC]/.test(entry.slice(0, 2))) changed.push(status[++index]);
    }
    gitDirty = changed.some(path => !GENERATED_PROVENANCE_FILES.has(path));
  } else {
    paths = uploadedPaths;
  }
  if (requireClean && head && gitDirty !== false) throw new Error('Release build requires a verified clean Git checkout; commit source changes before building.');

  const hash = createHash('sha256');
  hash.update('fcos-vercel-source-v1\0');
  let sourceFileCount = 0;
  let contentMatchesHead = Boolean(head);
  for (const path of [...new Set(paths)].sort()) {
    if (GENERATED_PROVENANCE_FILES.has(path) || isCredentialPath(path)) continue;
    const absolute = join(cwd, path);
    let info;
    try { info = lstatSync(absolute); } catch (error) {
      if (error.code === 'ENOENT') { contentMatchesHead = false; continue; }
      throw error;
    }
    // Never follow a link to a credential or a file outside the reviewed source.
    // Git submodules/directories likewise require an explicit digest contract.
    if (!info.isFile()) throw new Error('Build provenance requires regular source files; symlinks and submodules are unsupported.');
    if (relative(cwd, absolute).startsWith('..')) throw new Error('Build provenance source escaped the repository.');
    const content = readFileSync(absolute);
    if (head) {
      const committed = committedFiles.get(path);
      const blobOid = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
      if (!committed || committed.type !== 'blob' || committed.oid !== blobOid
        || committed.mode !== (info.mode & 0o111 ? '100755' : '100644')) contentMatchesHead = false;
    }
    // Git cleanliness covers the full source tree, including upload-excluded
    // files. The portable digest covers the exact non-secret deployment inputs.
    if (!included(path)) continue;
    hash.update(`${path}\0${info.mode & 0o111 ? 'executable' : 'regular'}\0${content.length}\0`);
    hash.update(content);
    hash.update('\0');
    sourceFileCount += 1;
  }
  const sourceDigest = hash.digest('hex');
  // Check actual bytes against the committed blobs as well as Git status.
  // This catches changes hidden by assume-unchanged/skip-worktree index flags.
  if (head) gitDirty ||= !contentMatchesHead;
  if (requireClean && head && gitDirty !== false) throw new Error('Release build requires a verified clean Git checkout; source content differs from HEAD.');
  const expectedDigest = String(env.FCOS_EXPECTED_SOURCE_SHA256 || '').trim().toLowerCase();
  if (expectedDigest && (!/^[0-9a-f]{64}$/.test(expectedDigest) || expectedDigest !== sourceDigest)) {
    throw new Error('Build provenance source digest does not match the expected source attestation.');
  }
  const sourceAttested = Boolean(expectedDigest && supplied.length);
  if (requireClean && !head && !sourceAttested) throw new Error('Release build requires a clean Git checkout or a trusted source SHA256 attestation and full commit SHA.');
  return {
    schemaVersion: 1,
    commit: head || supplied[0]?.toLowerCase() || null,
    commitVerified: Boolean(head),
    gitDirty,
    sourceAttested,
    releaseEligible: head ? gitDirty === false : sourceAttested,
    sourceDigest,
    sourceDigestAlgorithm: 'sha256:fcos-vercel-source-v1',
    sourceFileCount,
  };
}
