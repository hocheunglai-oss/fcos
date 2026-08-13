import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALESFORCE_POLICY = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const PUBLICATION = SALESFORCE_POLICY?.publication;
const SOURCE_REPOSITORY = FCOS_CONNECTION_POLICY.providers
  .find(({ id }) => id === 'github')
  ?.identifiers.find(({ label }) => label === 'Repository')?.value;
const MODE = process.argv.includes('--publish') ? 'publish' : process.argv.includes('--check') ? 'check' : '';

if (!PUBLICATION || !SOURCE_REPOSITORY) throw new Error('Salesforce shared publication policy is unavailable.');

const sourceRoot = path.resolve(REPO_ROOT, PUBLICATION.sourceRoot);
const isolatedConfig = path.resolve(REPO_ROOT, PUBLICATION.configPath);
const ghEnvironment = {
  ...process.env,
  GH_CONFIG_DIR: isolatedConfig,
  GH_HOST: 'github.com',
  GH_REPO: `github.com/${PUBLICATION.repository}`,
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = options.inherit ? '' : String(result.stderr || result.stdout || '').trim();
    throw new Error(detail || `${command} failed safely.`);
  }
  return String(result.stdout || '').trim();
}

function json(command, args, options = {}) {
  const output = run(command, args, options);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${command} returned an invalid JSON response.`);
  }
}

function filesBelow(root, current = root) {
  const files = [];
  for (const name of readdirSync(current).sort()) {
    const absolute = path.join(current, name);
    if (statSync(absolute).isDirectory()) files.push(...filesBelow(root, absolute));
    else files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return files;
}

export function sourceInventory(root = sourceRoot) {
  if (!existsSync(root)) throw new Error('The authoritative Salesforce source directory is missing.');
  const files = filesBelow(root);
  const hash = createHash('sha256');
  for (const relativePath of files) {
    const bytes = readFileSync(path.join(root, relativePath));
    hash.update(relativePath);
    hash.update('\0');
    hash.update(String(bytes.length));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return { files, sourceTreeHash: hash.digest('hex') };
}

export function expectedManifest(inventory = sourceInventory()) {
  return {
    schemaVersion: 1,
    sourceRepository: SOURCE_REPOSITORY,
    sourceRoot: `${PUBLICATION.sourceRoot.replace(/\/$/, '')}/`,
    targetRoot: `${PUBLICATION.targetRoot.replace(/\/$/, '')}/`,
    sourceTreeHash: inventory.sourceTreeHash,
    files: inventory.files,
  };
}

function assertIdentity() {
  if (!existsSync(path.join(isolatedConfig, 'hosts.yml'))) {
    throw new Error('The isolated shared-repository GitHub authorization is unavailable.');
  }
  const account = json('gh', ['api', 'user'], { env: ghEnvironment });
  const repository = json('gh', ['api', `repos/${PUBLICATION.repository}`], { env: ghEnvironment });
  if (account?.login !== PUBLICATION.requiredAccount
    || account?.id !== PUBLICATION.requiredAccountId
    || repository?.full_name?.toLowerCase() !== PUBLICATION.repository.toLowerCase()
    || repository?.permissions?.pull !== true
    || repository?.permissions?.push !== true
    || repository?.default_branch !== PUBLICATION.defaultBranch) {
    throw new Error('Shared Salesforce repository identity, default branch, or WRITE permission mismatch.');
  }
  return repository;
}

function remoteBranchHead(branch) {
  const ref = encodeURIComponent(`heads/${branch}`);
  try {
    return json('gh', ['api', `repos/${PUBLICATION.repository}/git/ref/${ref}`], { env: ghEnvironment })?.object?.sha || '';
  } catch {
    return '';
  }
}

function openPullRequests() {
  const result = json('gh', [
    'pr', 'list', '--repo', PUBLICATION.repository, '--state', 'open', '--limit', '100',
    '--json', 'number,isDraft,headRefName,headRefOid,baseRefName,url',
  ], { env: ghEnvironment });
  return Array.isArray(result) ? result : [];
}

function publicationBranch() {
  const pullRequests = openPullRequests();
  const configured = pullRequests.find(({ headRefName }) => headRefName === PUBLICATION.activeBranch);
  if (configured) return { branch: configured.headRefName, pullRequest: configured };
  const owned = pullRequests.find(({ headRefName, baseRefName }) => (
    baseRefName === PUBLICATION.defaultBranch
    && (headRefName === PUBLICATION.activeBranch || headRefName.startsWith(`${PUBLICATION.branchPrefix}-`))
  ));
  if (owned) return { branch: owned.headRefName, pullRequest: owned };
  if (MODE === 'check') return { branch: PUBLICATION.defaultBranch, pullRequest: null };
  const suffix = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return { branch: `${PUBLICATION.branchPrefix}-${suffix}`, pullRequest: null };
}

function cloneBranch(destination, branch, existsRemotely) {
  const cloneArgs = ['repo', 'clone', PUBLICATION.repository, destination, '--'];
  const cloneSourceBranch = MODE === 'publish' ? PUBLICATION.defaultBranch : branch;
  cloneArgs.push('--branch', cloneSourceBranch, '--single-branch');
  run('gh', cloneArgs, { env: ghEnvironment });
  if (MODE === 'publish') run('git', ['switch', '-c', branch], { cwd: destination });
}

function readOwnedFiles(checkout) {
  const manifestPath = path.join(checkout, PUBLICATION.manifestPath);
  if (!existsSync(manifestPath)) return [];
  try {
    const value = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return Array.isArray(value?.files) ? value.files.filter((item) => typeof item === 'string') : [];
  } catch {
    throw new Error('The shared Salesforce mirror manifest is malformed.');
  }
}

function syncCheckout(checkout, inventory, manifest) {
  const targetRoot = path.join(checkout, PUBLICATION.targetRoot);
  const currentFiles = new Set(inventory.files);
  for (const previouslyOwned of readOwnedFiles(checkout)) {
    if (currentFiles.has(previouslyOwned)) continue;
    const target = path.resolve(targetRoot, previouslyOwned);
    const relative = path.relative(targetRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe shared mirror manifest path.');
    if (existsSync(target)) rmSync(target);
  }
  for (const relativePath of inventory.files) {
    const target = path.join(targetRoot, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(sourceRoot, relativePath), target);
  }
  writeFileSync(
    path.join(checkout, PUBLICATION.manifestPath),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

function verifyCheckout(checkout, inventory, manifest) {
  const targetRoot = path.join(checkout, PUBLICATION.targetRoot);
  const actualManifest = json('node', ['-e', `process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(checkout, PUBLICATION.manifestPath))}, 'utf8'))))`]);
  if (JSON.stringify(actualManifest) !== JSON.stringify(manifest)) {
    throw new Error('The shared Salesforce mirror manifest does not match the authoritative FCOS source.');
  }
  const mismatches = [];
  for (const relativePath of inventory.files) {
    const source = path.join(sourceRoot, relativePath);
    const target = path.join(targetRoot, relativePath);
    if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) mismatches.push(relativePath);
  }
  if (mismatches.length) {
    throw new Error(`The shared Salesforce mirror differs from FCOS in ${mismatches.length} owned file(s).`);
  }
}

function configurePushIdentity(checkout) {
  const helper = `!f() { env GH_CONFIG_DIR='${isolatedConfig.replaceAll("'", "'\"'\"'")}' gh auth git-credential \"$@\"; }; f`;
  run('git', ['config', '--local', 'user.name', PUBLICATION.requiredAccount], { cwd: checkout });
  run('git', ['config', '--local', 'user.email', `${PUBLICATION.requiredAccountId}+${PUBLICATION.requiredAccount}@users.noreply.github.com`], { cwd: checkout });
  spawnSync('git', ['config', '--local', '--unset-all', 'credential.https://github.com.helper'], {
    cwd: checkout,
    stdio: 'ignore',
  });
  run('git', ['config', '--local', '--add', 'credential.https://github.com.helper', ''], { cwd: checkout });
  run('git', ['config', '--local', '--add', 'credential.https://github.com.helper', helper], { cwd: checkout });
  run('git', ['config', '--local', 'credential.https://github.com.username', PUBLICATION.requiredAccount], { cwd: checkout });
}

function assertCommitAttribution(commit) {
  const record = json('gh', ['api', `repos/${PUBLICATION.repository}/commits/${commit}`], { env: ghEnvironment });
  if (record?.author?.login !== PUBLICATION.requiredAccount
    || record?.author?.id !== PUBLICATION.requiredAccountId
    || record?.committer?.login !== PUBLICATION.requiredAccount
    || record?.committer?.id !== PUBLICATION.requiredAccountId) {
    throw new Error('Shared Salesforce mirror commit attribution does not match the approved GitHub identity.');
  }
}

function publish(checkout, branch, expectedRemoteHead, pullRequest) {
  const paths = [PUBLICATION.targetRoot, PUBLICATION.manifestPath];
  configurePushIdentity(checkout);
  run('git', ['add', '--', ...paths], { cwd: checkout });
  const status = run('git', ['status', '--short'], { cwd: checkout });
  if (!status) return { changed: false, branch, commit: run('git', ['rev-parse', 'HEAD'], { cwd: checkout }), pullRequest };
  run('git', ['commit', '-m', 'Sync FCOS Salesforce metadata'], { cwd: checkout });
  assertIdentity();
  if (remoteBranchHead(branch) !== expectedRemoteHead) {
    throw new Error('The shared Salesforce branch changed during publication. Fetch and reconcile before retrying.');
  }
  const pushArgs = ['push', '--set-upstream'];
  if (expectedRemoteHead) pushArgs.push(`--force-with-lease=refs/heads/${branch}:${expectedRemoteHead}`);
  pushArgs.push('origin', `HEAD:${branch}`);
  run('git', pushArgs, { cwd: checkout, inherit: true });
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: checkout });
  assertCommitAttribution(commit);
  if (!pullRequest) {
    const body = [
      'Mirrors only Salesforce metadata deployed from `hocheunglai-oss/fcos`.',
      '',
      'The complete owned `src/` inventory is recorded in `.fcos-salesforce-mirror.json` and verified byte-for-byte before publication.',
    ].join('\n');
    const url = run('gh', [
      'pr', 'create', '--repo', PUBLICATION.repository, '--draft',
      '--base', PUBLICATION.defaultBranch, '--head', branch,
      '--title', 'Sync FCOS Salesforce metadata', '--body', body,
    ], { env: ghEnvironment });
    pullRequest = { url, headRefName: branch, isDraft: true };
  }
  return { changed: true, branch, commit, pullRequest };
}

export function main() {
  if (!MODE || (process.argv.includes('--publish') && process.argv.includes('--check'))) {
    throw new Error('Choose exactly one mode: --check or --publish.');
  }
  assertIdentity();
  const inventory = sourceInventory();
  const manifest = expectedManifest(inventory);
  const selected = publicationBranch();
  const initialRemoteHead = remoteBranchHead(selected.branch);
  if (MODE === 'check' && !initialRemoteHead) {
    throw new Error('No shared Salesforce publication branch exists. Run npm run salesforce:mirror:publish.');
  }
  const temporary = mkdtempSync(path.join(tmpdir(), 'fcos-salesforce-mirror-'));
  const checkout = path.join(temporary, 'repository');
  try {
    cloneBranch(checkout, selected.branch, Boolean(initialRemoteHead));
    if (MODE === 'publish') syncCheckout(checkout, inventory, manifest);
    verifyCheckout(checkout, inventory, manifest);
    const publication = MODE === 'publish'
      ? publish(checkout, selected.branch, initialRemoteHead, selected.pullRequest)
      : { changed: false, branch: selected.branch, commit: run('git', ['rev-parse', 'HEAD'], { cwd: checkout }), pullRequest: selected.pullRequest };
    if (MODE === 'check' && selected.pullRequest) assertCommitAttribution(publication.commit);
    process.stdout.write(`${JSON.stringify({
      mode: MODE,
      repository: PUBLICATION.repository,
      account: PUBLICATION.requiredAccount,
      sourceFiles: inventory.files.length,
      sourceTreeHash: inventory.sourceTreeHash,
      ...publication,
    }, null, 2)}\n`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
