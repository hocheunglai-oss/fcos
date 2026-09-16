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
import { githubConfigDirectory } from './fcos-connections.mjs';
import {
  COMPLETE_SALESFORCE_SCOPE,
  FULL_SALESFORCE_TEST_LEVEL,
  SALESFORCE_RELEASE_MODE,
  SALESFORCE_WORKFLOW_SCHEMA_VERSION,
  deveeEnvironment,
  deveeSourceProof,
  readSalesforceWorkflowState,
  refreshDeveeSourceVerification,
  validateDeveeSourceState,
  writeSalesforceWorkflowState,
} from './salesforce-workflow-state.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALESFORCE_POLICY = FCOS_CONNECTION_POLICY.providers.find(({ id }) => id === 'salesforce');
const PUBLICATION = SALESFORCE_POLICY?.publication;
const SOURCE_REPOSITORY = FCOS_CONNECTION_POLICY.providers
  .find(({ id }) => id === 'github')
  ?.identifiers.find(({ label }) => label === 'Repository')?.value;
const MODE = process.argv.includes('--publish') ? 'publish' : process.argv.includes('--check') ? 'check' : '';

if (!PUBLICATION || !SOURCE_REPOSITORY) throw new Error('Salesforce shared publication policy is unavailable.');

const sourceRoot = path.resolve(REPO_ROOT, PUBLICATION.sourceRoot);
const isolatedConfig = githubConfigDirectory({ repoRoot: REPO_ROOT, configPath: PUBLICATION.configPath });
const ghEnvironment = {
  ...process.env,
  GH_CONFIG_DIR: isolatedConfig,
  GH_HOST: 'github.com',
  GH_REPO: `github.com/${PUBLICATION.repository}`,
};
delete ghEnvironment.GH_TOKEN;
delete ghEnvironment.GITHUB_TOKEN;

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

export function assertInventoryUnchanged(inventory, authoritativeRoot = sourceRoot) {
  if (sourceInventory(authoritativeRoot).sourceTreeHash !== inventory.sourceTreeHash) {
    throw new Error('The authoritative Salesforce source changed after its deployment proof was reviewed. Restart from DEVEE.');
  }
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

function assertDeveeDeploymentProof(inventory) {
  const environment = deveeEnvironment();
  const initialReadAt = new Date();
  const workflow = readSalesforceWorkflowState();
  const record = deveeSourceProof(workflow, initialReadAt, { allowStaleVerification: true });
  validateDeveeSourceState(record, inventory.sourceTreeHash, initialReadAt, { allowStaleVerification: true });
  if (record?.schemaVersion !== SALESFORCE_WORKFLOW_SCHEMA_VERSION
    || record?.releaseMode !== SALESFORCE_RELEASE_MODE
    || record?.deploymentScope !== COMPLETE_SALESFORCE_SCOPE
    || record?.deploymentScope !== PUBLICATION.sourceRoot.replace(/\/$/, '')
    || record?.testLevel !== FULL_SALESFORCE_TEST_LEVEL) {
    throw new Error('Shared publication requires the complete DEVEE source tree to pass RunLocalTests.');
  }
  const display = json('sf', ['org', 'display', '--target-org', environment.alias, '--json']);
  const organization = json('sf', [
    'data', 'query', '--target-org', environment.alias,
    '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--json',
  ]);
  const deployment = json('sf', [
    'project', 'deploy', 'report', '--target-org', environment.alias,
    '--job-id', record.deploymentJobId, '--json',
  ]);
  if (display?.result?.id !== environment.orgId
    || display?.result?.username !== environment.username
    || display?.result?.connectedStatus !== 'Connected'
    || organization?.result?.records?.[0]?.Id !== environment.orgId
    || organization?.result?.records?.[0]?.IsSandbox !== true
    || deployment?.result?.id !== record.deploymentJobId
    || deployment?.result?.status !== 'Succeeded'
    || deployment?.result?.checkOnly === true) {
    throw new Error('The live DEVEE identity or successful deployment proof no longer matches publication policy.');
  }
  const verifiedAt = new Date();
  const currentWorkflow = readSalesforceWorkflowState();
  const currentRecord = deveeSourceProof(currentWorkflow, verifiedAt, { allowStaleVerification: true });
  if (currentRecord.sourceTreeHash !== record.sourceTreeHash
    || currentRecord.releaseMode !== record.releaseMode
    || currentRecord.validationJobId !== record.validationJobId
    || currentRecord.deploymentJobId !== record.deploymentJobId) {
    throw new Error('The immutable DEVEE deployment proof changed during live verification.');
  }
  const refreshedWorkflow = refreshDeveeSourceVerification(currentWorkflow, {
    sourceTreeHash: inventory.sourceTreeHash,
    validationJobId: record.validationJobId,
    deploymentJobId: record.deploymentJobId,
    liveIdentity: {
      alias: environment.alias,
      orgId: display.result.id,
      username: display.result.username,
      connectedStatus: display.result.connectedStatus,
      organizationId: organization.result.records[0].Id,
      isSandbox: organization.result.records[0].IsSandbox,
    },
    liveDeployment: {
      id: deployment.result.id,
      status: deployment.result.status,
      checkOnly: deployment.result.checkOnly,
    },
  }, verifiedAt);
  const savedWorkflow = writeSalesforceWorkflowState(refreshedWorkflow, verifiedAt);
  const refreshed = deveeSourceProof(savedWorkflow, verifiedAt);
  validateDeveeSourceState(refreshed, inventory.sourceTreeHash, verifiedAt);
  return refreshed;
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
    'pr', 'list', '--repo', PUBLICATION.repository, '--state', 'open', '--limit', '1000',
    '--json', 'number,state,isDraft,headRefName,headRefOid,baseRefName,headRepository,headRepositoryOwner,url',
  ], { env: ghEnvironment });
  return Array.isArray(result) ? result : [];
}

function pullRequestHeadRepository(pullRequest) {
  if (typeof pullRequest?.headRepository === 'string') return pullRequest.headRepository;
  if (pullRequest?.headRepository?.nameWithOwner) return pullRequest.headRepository.nameWithOwner;
  const owner = pullRequest?.headRepositoryOwner?.login;
  const name = pullRequest?.headRepository?.name;
  return owner && name ? `${owner}/${name}` : '';
}

function isOwnedPublicationBranch(branch, publication = PUBLICATION) {
  return branch === publication.activeBranch || branch?.startsWith(`${publication.branchPrefix}-`);
}

function hasRequiredPullRequestShape(pullRequest, publication = PUBLICATION) {
  return pullRequest?.state === 'OPEN'
    && pullRequest?.isDraft === true
    && pullRequest?.baseRefName === publication.defaultBranch
    && pullRequestHeadRepository(pullRequest)?.toLowerCase() === publication.repository.toLowerCase();
}

export function selectPublicationTarget(
  pullRequests,
  { mode = MODE, now = new Date(), publication = PUBLICATION } = {},
) {
  if (!Array.isArray(pullRequests)) throw new Error('Shared Salesforce pull request inventory is invalid.');
  const ownedOpen = pullRequests.filter(({ headRefName }) => isOwnedPublicationBranch(headRefName, publication));
  const invalid = ownedOpen.find((pullRequest) => !hasRequiredPullRequestShape(pullRequest, publication));
  if (invalid) {
    throw new Error('An existing shared Salesforce pull request must be open, draft, repository-owned, and target the configured base branch.');
  }
  const configured = ownedOpen.filter(({ headRefName }) => headRefName === publication.activeBranch);
  if (configured.length > 1) throw new Error('Multiple shared Salesforce pull requests match the configured publication branch.');
  if (configured.length === 1) return { branch: configured[0].headRefName, pullRequest: configured[0] };
  const generated = ownedOpen.filter(({ headRefName }) => headRefName.startsWith(`${publication.branchPrefix}-`));
  if (generated.length > 1) throw new Error('Multiple shared Salesforce draft pull requests match the publication policy.');
  if (generated.length === 1) return { branch: generated[0].headRefName, pullRequest: generated[0] };
  if (mode === 'check') {
    throw new Error('No matching open draft shared Salesforce pull request exists. Publish the verified DEVEE source first.');
  }
  if (mode !== 'publish') throw new Error('Choose exactly one mode: --check or --publish.');
  const suffix = now.toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '');
  return { branch: `${publication.branchPrefix}-${suffix}`, pullRequest: null };
}

function publicationBranch() {
  return selectPublicationTarget(openPullRequests());
}

function cloneBranch(destination, branch, existsRemotely) {
  const cloneArgs = ['repo', 'clone', PUBLICATION.repository, destination, '--'];
  const cloneSourceBranch = MODE === 'publish' && !existsRemotely ? PUBLICATION.defaultBranch : branch;
  cloneArgs.push('--branch', cloneSourceBranch, '--single-branch');
  run('gh', cloneArgs, { env: ghEnvironment });
  if (MODE === 'publish' && !existsRemotely) run('git', ['switch', '-c', branch], { cwd: destination });
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

export function syncCheckout(checkout, inventory, manifest, authoritativeRoot = sourceRoot) {
  assertInventoryUnchanged(inventory, authoritativeRoot);
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
    copyFileSync(path.join(authoritativeRoot, relativePath), target);
  }
  writeFileSync(
    path.join(checkout, PUBLICATION.manifestPath),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  assertInventoryUnchanged(inventory, authoritativeRoot);
}

export function verifyCheckout(checkout, inventory, manifest, authoritativeRoot = sourceRoot) {
  assertInventoryUnchanged(inventory, authoritativeRoot);
  const targetRoot = path.join(checkout, PUBLICATION.targetRoot);
  let actualManifest;
  try {
    actualManifest = JSON.parse(readFileSync(path.join(checkout, PUBLICATION.manifestPath), 'utf8'));
  } catch {
    throw new Error('The shared Salesforce mirror manifest is missing or malformed.');
  }
  if (JSON.stringify(actualManifest) !== JSON.stringify(manifest)) {
    throw new Error('The shared Salesforce mirror manifest does not match the authoritative FCOS source.');
  }
  const mismatches = [];
  for (const relativePath of inventory.files) {
    const source = path.join(authoritativeRoot, relativePath);
    const target = path.join(targetRoot, relativePath);
    if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) mismatches.push(relativePath);
  }
  if (mismatches.length) {
    throw new Error(`The shared Salesforce mirror differs from FCOS in ${mismatches.length} owned file(s).`);
  }
  assertInventoryUnchanged(inventory, authoritativeRoot);
}

function configurePushIdentity(checkout) {
  const helper = `!f() { env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR='${isolatedConfig.replaceAll("'", "'\"'\"'")}' gh auth git-credential \"$@\"; }; f`;
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

export function validatePublicationPullRequest(
  pullRequest,
  { branch, headOid, publication = PUBLICATION },
) {
  if (!Number.isSafeInteger(pullRequest?.number)
    || !hasRequiredPullRequestShape(pullRequest, publication)
    || pullRequest?.headRefName !== branch
    || pullRequest?.headRefOid !== headOid) {
    throw new Error('The shared Salesforce draft pull request no longer matches its configured branch, base, repository, or verified commit.');
  }
  return pullRequest;
}

function refetchPullRequest(pullRequest, branch) {
  const selector = pullRequest?.number ? String(pullRequest.number) : branch;
  return json('gh', [
    'pr', 'view', selector, '--repo', PUBLICATION.repository,
    '--json', 'number,state,isDraft,headRefName,headRefOid,baseRefName,headRepository,headRepositoryOwner,url',
  ], { env: ghEnvironment });
}

export function validateFetchedPullRequestHead(fetchedHead, pullRequest) {
  if (!fetchedHead || fetchedHead !== pullRequest?.headRefOid) {
    throw new Error('The shared Salesforce branch changed after pull request verification.');
  }
  return true;
}

function verifyImmutableRemoteHead(checkout, pullRequest, inventory, manifest) {
  run('git', [
    'fetch', '--force', 'origin',
    `refs/heads/${pullRequest.headRefName}:refs/remotes/origin/${pullRequest.headRefName}`,
  ], { cwd: checkout });
  const fetchedHead = run('git', ['rev-parse', `refs/remotes/origin/${pullRequest.headRefName}`], { cwd: checkout });
  validateFetchedPullRequestHead(fetchedHead, pullRequest);
  run('git', ['checkout', '--detach', pullRequest.headRefOid], { cwd: checkout });
  verifyCheckout(checkout, inventory, manifest);
}

export function publicationReport({ inventory, deveeDeployment, publication, pullRequest, mode = MODE }) {
  return {
    mode,
    releaseMode: deveeDeployment.releaseMode,
    repository: PUBLICATION.repository,
    account: PUBLICATION.requiredAccount,
    sourceFiles: inventory.files.length,
    sourceTreeHash: inventory.sourceTreeHash,
    sourceEnvironment: 'devee',
    sourceDeploymentJobId: deveeDeployment.deploymentJobId,
    pullRequestNumber: pullRequest.number,
    pullRequestBase: pullRequest.baseRefName,
    pullRequestHead: pullRequest.headRefName,
    pullRequestIsDraft: pullRequest.isDraft,
    pullRequestHeadOid: pullRequest.headRefOid,
    pullRequestUrl: pullRequest.url,
    pullRequest: {
      number: pullRequest.number,
      url: pullRequest.url,
      state: pullRequest.state,
      isDraft: pullRequest.isDraft,
      baseRefName: pullRequest.baseRefName,
      headRefName: pullRequest.headRefName,
      headRefOid: pullRequest.headRefOid,
    },
    changed: publication.changed,
    branch: publication.branch,
    commit: publication.commit,
  };
}

function publish(checkout, branch, expectedRemoteHead, pullRequest, inventory) {
  const paths = [PUBLICATION.targetRoot, PUBLICATION.manifestPath];
  configurePushIdentity(checkout);
  run('git', ['add', '--', ...paths], { cwd: checkout });
  const status = run('git', ['status', '--short'], { cwd: checkout });
  if (!status) {
    if (!pullRequest) {
      throw new Error('The Salesforce mirror matches the default branch, but no reviewable draft pull request exists.');
    }
    return { changed: false, branch, commit: run('git', ['rev-parse', 'HEAD'], { cwd: checkout }), pullRequest };
  }
  run('git', ['commit', '-m', 'Sync FCOS Salesforce metadata'], { cwd: checkout });
  assertIdentity();
  if (remoteBranchHead(branch) !== expectedRemoteHead) {
    throw new Error('The shared Salesforce branch changed during publication. Fetch and reconcile before retrying.');
  }
  const pushArgs = ['push', '--set-upstream'];
  if (expectedRemoteHead) pushArgs.push(`--force-with-lease=refs/heads/${branch}:${expectedRemoteHead}`);
  pushArgs.push('origin', `HEAD:${branch}`);
  assertInventoryUnchanged(inventory);
  run('git', pushArgs, { cwd: checkout });
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
    pullRequest = { url, headRefName: branch };
  }
  return { changed: true, branch, commit, pullRequest };
}

export function main() {
  if (!MODE || (process.argv.includes('--publish') && process.argv.includes('--check'))) {
    throw new Error('Choose exactly one mode: --check or --publish.');
  }
  assertIdentity();
  const inventory = sourceInventory();
  const deveeDeployment = assertDeveeDeploymentProof(inventory);
  const manifest = expectedManifest(inventory);
  const selected = publicationBranch();
  const initialRemoteHead = remoteBranchHead(selected.branch);
  if (selected.pullRequest && selected.pullRequest.headRefOid !== initialRemoteHead) {
    throw new Error('The shared Salesforce draft pull request head changed before publication verification.');
  }
  if (!selected.pullRequest && initialRemoteHead) {
    throw new Error('The new shared Salesforce publication branch already exists without a matching draft pull request.');
  }
  const temporary = mkdtempSync(path.join(tmpdir(), 'fcos-salesforce-mirror-'));
  const checkout = path.join(temporary, 'repository');
  try {
    cloneBranch(checkout, selected.branch, Boolean(initialRemoteHead));
    if (MODE === 'publish') syncCheckout(checkout, inventory, manifest);
    verifyCheckout(checkout, inventory, manifest);
    const publication = MODE === 'publish'
      ? publish(checkout, selected.branch, initialRemoteHead, selected.pullRequest, inventory)
      : { changed: false, branch: selected.branch, commit: run('git', ['rev-parse', 'HEAD'], { cwd: checkout }), pullRequest: selected.pullRequest };
    const pullRequest = refetchPullRequest(publication.pullRequest, publication.branch);
    validatePublicationPullRequest(pullRequest, { branch: publication.branch, headOid: publication.commit });
    assertCommitAttribution(publication.commit);
    verifyImmutableRemoteHead(checkout, pullRequest, inventory, manifest);
    process.stdout.write(`${JSON.stringify(publicationReport({
      inventory,
      deveeDeployment,
      publication,
      pullRequest,
    }), null, 2)}\n`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
