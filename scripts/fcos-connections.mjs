import { spawn, spawnSync } from 'node:child_process';
import { createPrivateKey, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_CONNECTION_BROWSER_PROFILE,
  CONNECTION_ATTESTATION_POLICY,
  CONNECTION_LOCAL_STATE_DIRECTORY,
  CONNECTION_POLICY_VERSION,
  CONNECTION_PROFILE_NAME,
  CONNECTION_TARGETS,
  canonicalConnectionAttestation,
  connectionEvidenceFreshness,
  connectionProviderById,
  sanitizeConnectionAttestation,
  sanitizeConnectionProviderReport,
} from '../src/lib/connectionChecklist.js';
import { FCOS_CONNECTION_POLICY, fcosRuntimeConnectionCatalogue } from '../config/fcosConnections.js';
import { assertConnectionOperationAccess, describeConnectionOperation, sanitizeConnectionOperationOutput, validateConnectionOperation } from './lib/connection-operation.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_STATE_ROOT = path.join(REPO_ROOT, CONNECTION_LOCAL_STATE_DIRECTORY);
const STATUS_PATH = path.join(LOCAL_STATE_ROOT, 'status.json');
const CREDENTIAL_METADATA_PATH = path.join(LOCAL_STATE_ROOT, 'credential-metadata.json');
const PROVIDER_IDS = new Set(CONNECTION_TARGETS.map(({ id }) => id));
const COMMAND_TIMEOUT_MS = 90_000;
const KEYCHAIN_HELPER_SOURCE = path.join(REPO_ROOT, 'scripts', 'fcos-keychain-migrate.swift');
let keychainHelperReady = false;

function target(providerId) {
  return connectionProviderById(providerId);
}

function identifier(providerId, label) {
  return target(providerId).identifiers.find((entry) => entry.label === label)?.value || '';
}

function normalizedOrigin(value) {
  try {
    return new URL(String(value || '')).origin.toLowerCase();
  } catch {
    return '';
  }
}

function salesforceEnvironments() {
  return target('salesforce').environments || [{ key: 'production', label: 'Production', alias: target('salesforce').profileName, orgId: identifier('salesforce', 'Production Org ID') || identifier('salesforce', 'Org ID'), isSandbox: false }];
}


function executablePath(command) {
  return command.includes('/') ? path.resolve(REPO_ROOT, command) : command;
}

function executableExists(command) {
  const resolved = executablePath(command);
  if (resolved.includes('/')) return existsSync(resolved);
  return spawnSync('/usr/bin/which', [resolved], { stdio: 'ignore' }).status === 0;
}

function commonGitDirectory(repoRoot = REPO_ROOT) {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return '';
  const directory = String(result.stdout || '').trim();
  return directory ? path.resolve(repoRoot, directory) : '';
}

export function githubConfigDirectory({ repoRoot = REPO_ROOT, commonDirectory = commonGitDirectory(repoRoot), configPath = target('github').configPath } = {}) {
  // Git local config is shared by linked worktrees. Keep its credential helper
  // pinned to the primary checkout's isolated GH store, rather than rewriting
  // the helper to whichever worktree most recently ran the verifier.
  return commonDirectory
    ? path.join(path.dirname(commonDirectory), configPath)
    : path.join(repoRoot, configPath);
}

function ensureStateDirectories() {
  mkdirSync(LOCAL_STATE_ROOT, { recursive: true, mode: 0o700 });
  for (const provider of CONNECTION_TARGETS) {
    if (provider.configPath.startsWith(`${CONNECTION_LOCAL_STATE_DIRECTORY}/`)) {
      mkdirSync(path.join(REPO_ROOT, provider.configPath), { recursive: true, mode: 0o700 });
    }
  }
}

function keychainValue(service, { prepare = true } = {}) {
  if (process.platform !== 'darwin' || !service) return '';
  const helper = path.join(REPO_ROOT, FCOS_CONNECTION_POLICY.keychainHelper);
  if (prepare ? !ensureKeychainHelper(helper) : !existsSync(helper)) return '';
  const result = spawnSync(helper, [
    'get',
    FCOS_CONNECTION_POLICY.keychainAccount,
    service,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function ensureKeychainHelper(helper = path.join(REPO_ROOT, FCOS_CONNECTION_POLICY.keychainHelper)) {
  if (keychainHelperReady && existsSync(helper)) return true;
  if (process.platform !== 'darwin' || !existsSync(KEYCHAIN_HELPER_SOURCE)) return false;
  if (!existsSync(helper)) {
    mkdirSync(path.dirname(helper), { recursive: true, mode: 0o700 });
    const compiled = spawnSync('/usr/bin/swiftc', [KEYCHAIN_HELPER_SOURCE, '-o', helper], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    if (compiled.status !== 0) return false;
    chmodSync(helper, 0o700);
  }
  keychainHelperReady = existsSync(helper);
  return keychainHelperReady;
}

function readCredentialMetadata() {
  try {
    const value = JSON.parse(readFileSync(CREDENTIAL_METADATA_PATH, 'utf8'));
    return value?.schemaVersion === 1 && value?.profile === CONNECTION_PROFILE_NAME ? value : null;
  } catch {
    return null;
  }
}

function writeCredentialMetadata(value) {
  writeFileSync(CREDENTIAL_METADATA_PATH, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(CREDENTIAL_METADATA_PATH, 0o600);
}


function recordCredentialVerification(providerId, verifiedAt) {
  const existing = readCredentialMetadata() || {
    schemaVersion: 1,
    profile: CONNECTION_PROFILE_NAME,
    providers: {},
  };
  const current = existing.providers?.[providerId] || {};
  writeCredentialMetadata({
    ...existing,
    providers: {
      ...existing.providers,
      [providerId]: {
        ...current,
        authorizedAt: current.authorizedAt || null,
        lastVerifiedAt: verifiedAt,
      },
    },
  });
}

export function providerRuntime(providerId, { requireCredential = true, prepare = true, environment } = {}) {
  const provider = target(providerId);
  const baseEnv = { ...process.env, NO_COLOR: '1' };
  // Keep unrelated application secrets and provider debug overrides out of CLI children.
  for (const name of Object.keys(baseEnv)) if (/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|SERVICE_ROLE_KEY|ACCESS_KEY|AUTHORIZATION)/i.test(name)) delete baseEnv[name];
  for (const name of ['GH_DEBUG', 'VERCEL_DEBUG', 'DEBUG', 'NODE_OPTIONS', 'SF_LOG_LEVEL', 'SFDX_LOG_LEVEL', 'SF_STATE_FOLDER', 'SFDX_CONFIG_DIR', 'XDG_CONFIG_HOME']) delete baseEnv[name];
  let credentialAvailable = true;

  switch (providerId) {
    case 'github': {
      delete baseEnv.GH_TOKEN;
      delete baseEnv.GITHUB_TOKEN;
      delete baseEnv.GH_ENTERPRISE_TOKEN;
      const configDirectory = githubConfigDirectory();
      credentialAvailable = existsSync(path.join(configDirectory, 'hosts.yml'));
      return {
        command: executablePath(provider.executable),
        credentialAvailable,
        env: {
          ...baseEnv,
          GH_CONFIG_DIR: configDirectory,
          GH_HOST: 'github.com',
          GH_REPO: `github.com/${identifier('github', 'Repository')}`,
        },
        injectedArgs: [],
      };
    }
    case 'vercel': {
      delete baseEnv.VERCEL_TOKEN;
      delete baseEnv.VERCEL_ORG_ID; delete baseEnv.VERCEL_PROJECT_ID;
      const token = requireCredential ? keychainValue(provider.keychainService, { prepare }) : '';
      credentialAvailable = Boolean(token);
      if (token) baseEnv.VERCEL_TOKEN = token;
      return {
        command: executablePath(provider.executable),
        credentialAvailable,
        env: baseEnv,
        injectedArgs: [
          '--global-config', path.join(REPO_ROOT, provider.configPath),
          '--scope', identifier('vercel', 'Team'),
          '--cwd', REPO_ROOT,
          '--no-color',
        ],
      };
    }
    case 'supabase': {
      delete baseEnv.SUPABASE_ACCESS_TOKEN;
      delete baseEnv.SUPABASE_DB_URL;
      const token = requireCredential ? keychainValue(provider.keychainService, { prepare }) : '';
      credentialAvailable = Boolean(token);
      if (token) baseEnv.SUPABASE_ACCESS_TOKEN = token;
      return {
        command: executablePath(provider.executable),
        credentialAvailable,
        env: {
          ...baseEnv,
          SUPABASE_HOME: path.join(REPO_ROOT, provider.configPath),
        },
        injectedArgs: ['--workdir', REPO_ROOT],
      };
    }
    case 'salesforce':
      delete baseEnv.SF_ACCESS_TOKEN; delete baseEnv.SF_INSTANCE_URL; delete baseEnv.SFDX_ACCESS_TOKEN; delete baseEnv.SFDX_INSTANCE_URL; delete baseEnv.SFDX_DEFAULTUSERNAME;
      if (environment && !salesforceEnvironments().some(({ key }) => key === environment)) throw new Error('Unknown Salesforce runtime environment.');
      return {
        command: executablePath(provider.executable),
        credentialAvailable: true,
        env: { ...baseEnv, SF_TARGET_ORG: environment ? salesforceEnvironments().find(({ key }) => key === environment)?.alias || provider.profileName : provider.profileName },
        injectedArgs: [],
      };
    default:
      throw new Error(`Unsupported provider: ${providerId}`);
  }
}

function runCaptured(providerId, args, { inject = true, requireCredential = true } = {}) {
  // Verifiers never compile credential helpers as a side effect of a read probe.
  const runtime = providerRuntime(providerId, { requireCredential, prepare: false });
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(runtime.command, inject ? [...args, ...runtime.injectedArgs] : args, {
      cwd: REPO_ROOT,
      env: runtime.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: value.status === 0,
        status: value.status,
        stdout,
        stderr,
        unavailable: value.unavailable === true,
        latencyMs: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => {
      stderr += '\nCommand timed out.';
      child.kill('SIGTERM');
      finish({ status: 124 });
    }, COMMAND_TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ status: null, unavailable: error?.code === 'ENOENT' });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      finish({ status });
    });
  });
}

function runSharedSalesforceGitHubCaptured(args) {
  const publication = target('salesforce').publication;
  const configDirectory = githubConfigDirectory({ configPath: publication.configPath });
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|SERVICE_ROLE_KEY|ACCESS_KEY|AUTHORIZATION)/i.test(name)) delete env[name];
    for (const name of ['GH_DEBUG', 'DEBUG', 'NODE_OPTIONS']) delete env[name];
    const child = spawn('gh', args, {
      cwd: REPO_ROOT,
      env: {
        ...env,
        GH_CONFIG_DIR: configDirectory,
        GH_HOST: 'github.com',
        GH_REPO: `github.com/${publication.repository}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: value.status === 0,
        status: value.status,
        stdout,
        stderr,
        unavailable: value.unavailable === true,
        latencyMs: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => {
      stderr += '\nCommand timed out.';
      child.kill('SIGTERM');
      finish({ status: 124 });
    }, COMMAND_TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ status: null, unavailable: error?.code === 'ENOENT' });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      finish({ status });
    });
  });
}

function verifySharedSalesforceMirrorCaptured() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(process.execPath, ['scripts/sync-salesforce-shared-repository.mjs', '--check'], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (status) => {
      if (settled) return;
      settled = true;
      resolve({ ok: status === 0, status, stdout, stderr, latencyMs: Date.now() - startedAt });
    };
    const timer = setTimeout(() => {
      stderr += '\nCommand timed out.';
      child.kill('SIGTERM');
      finish(124);
    }, COMMAND_TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      finish(status);
    });
  });
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function canonicalGitRemote(value) {
  const normalized = String(value || '').trim().replace(/\.git$/, '').replace(/\/$/, '');
  const ssh = normalized.match(/^git@github\.com:(.+)$/i);
  if (ssh) return ssh[1].toLowerCase();
  try {
    const parsed = new URL(normalized);
    if (parsed.hostname.toLowerCase() !== 'github.com' || !['https:', 'ssh:'].includes(parsed.protocol) || parsed.password || parsed.port || (parsed.username && !(parsed.protocol === 'ssh:' && parsed.username === 'git'))) return '';
    return parsed.pathname.replace(/^\//, '').toLowerCase();
  } catch {
    return '';
  }
}

function parseVersion(value) {
  const match = String(value || '').match(/(?:^|\/|\s|v)(\d+)\.(\d+)\.(\d+)(?:\D|$)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '';
}

function compareVersion(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

export function versionPolicyStatus(providerId, version) {
  const policy = target(providerId).cliVersion;
  if (!version) return 'unavailable';
  if (policy.exact) return compareVersion(version, policy.exact) === 0 ? 'approved' : 'incompatible';
  if (policy.minimum && compareVersion(version, policy.minimum) < 0) return 'incompatible';
  if (policy.maximumExclusive && compareVersion(version, policy.maximumExclusive) >= 0) return 'incompatible';
  return 'approved';
}

async function cliVersion(providerId) {
  const args = providerId === 'salesforce' ? ['version', '--json'] : ['--version'];
  const result = await runCaptured(providerId, args, { inject: false, requireCredential: false });
  const parsed = providerId === 'salesforce' ? safeJson(result.stdout)?.cliVersion : result.stdout || result.stderr;
  const version = parseVersion(parsed);
  return {
    available: result.ok && Boolean(version),
    version: version || null,
    status: versionPolicyStatus(providerId, version),
  };
}

function classifyFailedIdentity(...results) {
  const detail = results.map((result) => `${result?.stderr || ''}\n${result?.stdout || ''}`).join('\n').toLowerCase();
  if (/not logged|login required|authentication|access token|unauthorized|forbidden|credentials|profileloaderror|failed to read profile|invalid token|invalid_grant|revoked/.test(detail)) {
    return 'authentication_blocked';
  }
  return 'error';
}

function credentialLifecycle(providerId, authorizedAt, expiresAt, now = new Date()) {
  if (!authorizedAt || Number.isNaN(Date.parse(authorizedAt))) {
    return { authorizedAt: null, expiresAt: null, credentialAgeDays: null, credentialLifecycle: 'unknown', warningCodes: [] };
  }
  const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(authorizedAt).getTime()) / 86_400_000));
  const provider = target(providerId);
  const expiryMs = expiresAt && !Number.isNaN(Date.parse(expiresAt)) ? new Date(expiresAt).getTime() : null;
  const daysToExpiry = expiryMs == null ? null : Math.ceil((expiryMs - now.getTime()) / 86_400_000);
  let credentialLifecycleState = ageDays >= provider.rotationWarningDays ? 'rotation_due' : 'current';
  const warningCodes = ageDays >= provider.rotationWarningDays ? ['credential_rotation_due'] : [];
  if (daysToExpiry != null && daysToExpiry <= 0) {
    credentialLifecycleState = 'expired';
    warningCodes.push('credential_expired');
  } else if (daysToExpiry != null && daysToExpiry <= provider.expiryWarningDays) {
    credentialLifecycleState = 'expiring';
    warningCodes.push('credential_expiring');
  }
  return {
    authorizedAt: new Date(authorizedAt).toISOString(),
    expiresAt: expiryMs == null ? null : new Date(expiryMs).toISOString(),
    credentialAgeDays: ageDays,
    credentialLifecycle: credentialLifecycleState,
    warningCodes,
  };
}

function baseReport(providerId, version, startedAt, metadata) {
  const provider = target(providerId);
  const lifecycle = credentialLifecycle(providerId, metadata?.authorizedAt, metadata?.expiresAt);
  return {
    provider: providerId,
    cliAvailable: version.available,
    cliVersion: version.version,
    cliVersionStatus: version.status,
    identityStatus: version.available ? 'pending' : 'unavailable',
    identityVerified: false,
    targetPin: 'pending',
    permissionStatus: 'unavailable',
    permissions: [],
    latencyMs: Date.now() - startedAt,
    credentialStorage: provider.credentialStorage,
    ...lifecycle,
    lastVerifiedAt: metadata?.lastVerifiedAt || null,
    warningCodes: [
      ...lifecycle.warningCodes,
      ...(version.status === 'incompatible' ? ['cli_version_incompatible'] : []),
    ],
  };
}

function finalizeReport(report, startedAt) {
  const missingPermissions = target(report.provider).requiredPermissions
    .filter((permission) => !report.permissions.includes(permission));
  const sharedMetadataOnly = report.provider === 'salesforce'
    && missingPermissions.length > 0
    && missingPermissions.every((permission) => permission === 'shared.metadata.current');
  const warningCodes = [...new Set([
    ...report.warningCodes,
    ...(report.targetPin !== 'verified' ? ['target_pin_missing'] : []),
    ...(report.permissionStatus !== 'verified'
      ? [sharedMetadataOnly ? 'shared_metadata_out_of_date' : 'permission_probe_failed']
      : []),
  ])];
  return sanitizeConnectionProviderReport({ ...report, latencyMs: Date.now() - startedAt, warningCodes }, report.provider);
}

function readGitRemote() {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function githubCredentialHelperValue() {
  const configDirectory = githubConfigDirectory();
  return `!f() { env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR=${shellSingleQuote(configDirectory)} gh auth git-credential "$@"; }; f`;
}

function localGitConfigValues(key) {
  const result = spawnSync('git', ['config', '--local', '--get-all', key], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) return [];
  return String(result.stdout || '').split('\n').map((value) => value.trimEnd()).filter((value, index, values) => value || index < values.length - 1);
}

function githubCredentialHelperConfigured() {
  const helpers = localGitConfigValues('credential.https://github.com.helper');
  const usernames = localGitConfigValues('credential.https://github.com.username');
  const hookPaths = localGitConfigValues('core.hooksPath');
  const expectedAccounts = localGitConfigValues('fcos.expectedGithubAccount');
  return helpers.length === 2
    && helpers[0] === ''
    && helpers[1] === githubCredentialHelperValue()
    && usernames.length === 1
    && usernames[0] === identifier('github', 'Required account')
    && hookPaths.length === 1
    && hookPaths[0] === '.githooks'
    && expectedAccounts.length === 1
    && expectedAccounts[0] === identifier('github', 'Required account')
    && existsSync(path.join(REPO_ROOT, '.githooks', 'pre-push'));
}

function configureGithubCredentialHelper() {
  const key = 'credential.https://github.com.helper';
  spawnSync('git', ['config', '--local', '--unset-all', key], { cwd: REPO_ROOT, stdio: 'ignore' });
  const commands = [
    ['config', '--local', '--add', key, ''],
    ['config', '--local', '--add', key, githubCredentialHelperValue()],
    ['config', '--local', '--replace-all', 'credential.https://github.com.username', identifier('github', 'Required account')],
    ['config', '--local', '--replace-all', 'core.hooksPath', '.githooks'],
    ['config', '--local', '--replace-all', 'fcos.expectedGithubAccount', identifier('github', 'Required account')],
  ];
  return commands.every((args) => spawnSync('git', args, { cwd: REPO_ROOT, stdio: 'ignore' }).status === 0)
    && githubCredentialHelperConfigured();
}

export async function probeToolingAccount(providerId, capture = runCaptured) {
  const expected = providerId === 'github' ? identifier('github', 'Required account')
    : providerId === 'vercel' ? identifier('vercel', 'Account') : null;
  if (!expected) throw new Error('Account discovery is unsupported for this provider.');
  const result = await capture(providerId, providerId === 'github' ? ['api', 'user', '--jq', '.login'] : ['whoami']);
  if (!result.ok) return { verified: false, status: classifyFailedIdentity(result) };
  const verified = result.stdout.trim() === expected;
  return { verified, status: verified ? 'verified' : 'mismatch' };
}

async function verifyGitHub(version, metadata, startedAt) {
  const report = baseReport('github', version, startedAt, metadata);
  if (!version.available) return finalizeReport(report, startedAt);
  const runtime = providerRuntime('github', { prepare: false });
  if (!runtime.credentialAvailable) return finalizeReport({ ...report, identityStatus: 'authentication_blocked', targetPin: 'verified' }, startedAt);
  const account = await probeToolingAccount('github');
  if (!account.verified) return finalizeReport({ ...report, identityStatus: account.status }, startedAt);
  const [repository, auth] = await Promise.all([
    runCaptured('github', ['api', `repos/${identifier('github', 'Repository')}`]),
    runCaptured('github', ['auth', 'status', '--active', '--hostname', 'github.com', '--json', 'hosts']),
  ]);
  if (!repository.ok || !auth.ok) {
    return finalizeReport({ ...report, identityStatus: classifyFailedIdentity(repository, auth) }, startedAt);
  }
  const repo = safeJson(repository.stdout);
  const authEntry = safeJson(auth.stdout)?.hosts?.['github.com']?.[0];
  const scopes = String(authEntry?.scopes || '').split(',').map((value) => value.trim());
  const exactRemote = canonicalGitRemote(readGitRemote()) === identifier('github', 'Repository').toLowerCase();
  const exactCredentialHelper = githubCredentialHelperConfigured();
  const exactIdentity = account.verified
    && repo?.full_name?.toLowerCase() === identifier('github', 'Repository').toLowerCase()
    && authEntry?.login === identifier('github', 'Required account')
    && authEntry?.active === true
    && authEntry?.state === 'success';
  const permissions = [];
  if (repo?.permissions?.pull === true) permissions.push('repository.read');
  if (repo?.permissions?.push === true) permissions.push('repository.push');
  if (repo?.permissions?.push === true && scopes.includes('workflow')) permissions.push('workflow.update');
  if (exactCredentialHelper && /^https:\/\/github\.com\//i.test(readGitRemote())) permissions.push('git.push.authentication');
  return finalizeReport({
    ...report,
    identityStatus: exactIdentity && exactRemote ? 'verified' : 'mismatch',
    identityVerified: exactIdentity && exactRemote,
    targetPin: exactRemote && exactCredentialHelper ? 'verified' : exactRemote ? 'missing' : 'mismatch',
    permissionStatus: target('github').requiredPermissions.every((permission) => permissions.includes(permission)) ? 'verified' : 'missing',
    permissions,
  }, startedAt);
}

function readVercelLink() {
  for (const file of ['repo.json', 'project.json']) {
    try {
      const value = JSON.parse(readFileSync(path.join(REPO_ROOT, '.vercel', file), 'utf8'));
      const projects = file === 'repo.json' ? value.projects : [value];
      const match = projects?.find((project) => project.directory === '.' || file === 'project.json');
      if (match) return match;
    } catch {
      // Missing or malformed ignored links fail closed below.
    }
  }
  return null;
}

async function verifyVercel(version, metadata, startedAt) {
  const report = baseReport('vercel', version, startedAt, metadata);
  if (!version.available) return finalizeReport(report, startedAt);
  const runtime = providerRuntime('vercel', { prepare: false });
  if (!runtime.credentialAvailable) return finalizeReport({ ...report, identityStatus: 'authentication_blocked' }, startedAt);
  const account = await probeToolingAccount('vercel');
  if (!account.verified) return finalizeReport({ ...report, identityStatus: account.status }, startedAt);
  const [project, deployments] = await Promise.all([
    runCaptured('vercel', ['project', 'inspect', identifier('vercel', 'Project')]),
    runCaptured('vercel', ['list', identifier('vercel', 'Project')]),
  ]);
  if (!project.ok || !deployments.ok) {
    return finalizeReport({ ...report, identityStatus: classifyFailedIdentity(project, deployments) }, startedAt);
  }
  const link = readVercelLink();
  const exactLink = link?.id === identifier('vercel', 'Project ID')
    && link?.orgId === identifier('vercel', 'Team ID')
    && link?.name === identifier('vercel', 'Project');
  const projectOutput = `${project.stdout}\n${project.stderr}`;
  const exactIdentity = account.verified
    && projectOutput.includes(identifier('vercel', 'Project ID'))
    && projectOutput.includes(identifier('vercel', 'Target'));
  const targetPin = exactLink ? 'verified' : link ? 'mismatch' : 'missing';
  // Read probes establish read capabilities only. Provider policy lists are not evidence.
  const permissions = exactIdentity && project.ok && deployments.ok ? ['project.read', 'deployment.read'] : [];
  return finalizeReport({
    ...report,
    identityStatus: exactIdentity && targetPin !== 'mismatch' ? 'verified' : 'mismatch',
    identityVerified: exactIdentity && targetPin !== 'mismatch',
    targetPin,
    permissionStatus: permissions.length === target('vercel').requiredPermissions.length ? 'verified' : 'missing',
    permissions,
  }, startedAt);
}

function readSupabasePin() {
  try {
    return readFileSync(path.join(REPO_ROOT, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  } catch {
    return '';
  }
}

async function verifySupabase(version, metadata, startedAt) {
  const report = baseReport('supabase', version, startedAt, metadata);
  if (!version.available) return finalizeReport(report, startedAt);
  const runtime = providerRuntime('supabase', { prepare: false });
  if (!runtime.credentialAvailable) return finalizeReport({ ...report, identityStatus: 'authentication_blocked' }, startedAt);
  const projects = await runCaptured('supabase', ['projects', 'list', '--output-format', 'json']);
  if (!projects.ok) return finalizeReport({ ...report, identityStatus: classifyFailedIdentity(projects) }, startedAt);
  const parsed = safeJson(projects.stdout);
  const availableProjects = Array.isArray(parsed) ? parsed : parsed?.projects;
  const expectedRef = identifier('supabase', 'Project ref');
  const project = Array.isArray(availableProjects)
    ? availableProjects.find((entry) => entry.id === expectedRef || entry.ref === expectedRef)
    : null;
  const exactIdentity = project?.name === identifier('supabase', 'Project name');
  const exactLink = readSupabasePin() === expectedRef;
  const permissions = exactIdentity ? ['project.read'] : [];
  // The existing link is a target pin, not permission to link or write the database.
  return finalizeReport({
    ...report,
    identityStatus: exactIdentity ? 'verified' : 'mismatch',
    identityVerified: exactIdentity,
    targetPin: exactLink ? 'verified' : 'missing',
    permissionStatus: permissions.length === target('supabase').requiredPermissions.length ? 'verified' : 'missing',
    permissions,
  }, startedAt);
}

function readSalesforcePin() {
  try {
    const value = JSON.parse(readFileSync(path.join(REPO_ROOT, '.sf', 'config.json'), 'utf8'));
    return value['target-org'] || value.targetOrg || '';
  } catch {
    return '';
  }
}

async function verifySalesforce(version, metadata, startedAt) {
  const report = baseReport('salesforce', version, startedAt, metadata);
  if (!version.available) return finalizeReport(report, startedAt);
  const [checks, sharedAccount, sharedRepository, sharedMirror] = await Promise.all([
    Promise.all(salesforceEnvironments().map(async (environment) => {
    const [display, organization] = await Promise.all([
      runCaptured('salesforce', ['org', 'display', '--target-org', environment.alias, '--json']),
      runCaptured('salesforce', ['data', 'query', '--target-org', environment.alias, '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--json']),
    ]);
    const parsed = safeJson(display.stdout);
    const record = safeJson(organization.stdout)?.result?.records?.[0];
    return {
      environment,
      display,
      organization,
      verified: display.ok && organization.ok
        && parsed?.result?.id === environment.orgId
        && parsed?.result?.username === environment.username
        && normalizedOrigin(parsed?.result?.instanceUrl) === normalizedOrigin(environment.instanceUrl)
        && parsed?.result?.connectedStatus === 'Connected'
        && record?.Id === environment.orgId
        && record?.IsSandbox === environment.isSandbox,
    };
    })),
    runSharedSalesforceGitHubCaptured(['api', 'user', '--jq', '.login']),
    runSharedSalesforceGitHubCaptured(['api', `repos/${target('salesforce').publication.repository}`]),
    verifySharedSalesforceMirrorCaptured(),
  ]);
  if (checks.some((check) => !check.display.ok || !check.organization.ok)) {
    return finalizeReport({ ...report, identityStatus: classifyFailedIdentity(...checks.flatMap((check) => [check.display, check.organization])) }, startedAt);
  }
  if (!sharedAccount.ok || !sharedRepository.ok) {
    return finalizeReport({ ...report, identityStatus: classifyFailedIdentity(sharedAccount, sharedRepository) }, startedAt);
  }
  const sharedRepo = safeJson(sharedRepository.stdout);
  const exactSharedIdentity = sharedAccount.stdout.trim() === target('salesforce').publication.requiredAccount
    && sharedRepo?.full_name?.toLowerCase() === target('salesforce').publication.repository.toLowerCase();
  const exactIdentity = checks.every((check) => check.verified) && exactSharedIdentity;
  const exactPin = readSalesforcePin() === target('salesforce').profileName;
  const permissions = checks.flatMap((check) => check.verified ? [`${check.environment.key}.organization.read`, `${check.environment.key}.data.query`] : []);
  if (sharedRepo?.permissions?.pull === true) permissions.push('shared.repository.read');
  if (sharedRepo?.permissions?.push === true) permissions.push('shared.repository.push');
  if (sharedMirror.ok) permissions.push('shared.metadata.current');
  return finalizeReport({
    ...report,
    identityStatus: exactIdentity ? 'verified' : 'mismatch',
    identityVerified: exactIdentity,
    targetPin: exactPin ? 'verified' : 'missing',
    permissionStatus: permissions.length === target('salesforce').requiredPermissions.length ? 'verified' : 'missing',
    permissions,
  }, startedAt);
}

export function cachedConnectionProviderReport(providerId, snapshot, now = new Date(), cliAvailable = false) {
  const cached = sanitizeConnectionProviderReport(snapshot?.providers?.[providerId], providerId);
  const freshness = connectionEvidenceFreshness(cached, now);
  const version = { available: cliAvailable, version: cached?.cliVersion, status: cached?.cliVersionStatus || 'unavailable' };
  return sanitizeConnectionProviderReport({
    ...(cached || baseReport(providerId, version, Date.now(), {})),
    cliAvailable, identityVerified: false, identityStatus: cached ? 'cached' : 'unknown',
    observationMode: 'cached', freshness, permissions: [], permissionStatus: 'unavailable',
    warningCodes: [...(cached?.warningCodes || []), 'cached_not_live_verified',
      ...(freshness === 'unknown' ? ['evidence_missing'] : freshness !== 'current' ? ['evidence_expired'] : [])],
  }, providerId);
}

export async function verifyProvider(providerId, { readOnly = false, persist = true, prepare = false } = {}) {
  target(providerId); // Validate before credential or filesystem access.
  if (readOnly) return cachedConnectionProviderReport(providerId, readSafeStatus(), new Date(), executableExists(target(providerId).executable));
  if (prepare) ensureStateDirectories();
  const startedAt = Date.now();
  const version = await cliVersion(providerId);
  // A missing helper/credential is a blocker; setup is an explicit separate action.
  providerRuntime(providerId, { prepare });
  const metadata = readCredentialMetadata()?.providers?.[providerId] || {};
  let report;
  switch (providerId) {
    case 'github': report = await verifyGitHub(version, metadata, startedAt); break;
    case 'vercel': report = await verifyVercel(version, metadata, startedAt); break;
    case 'supabase': report = await verifySupabase(version, metadata, startedAt); break;
    case 'salesforce': report = await verifySalesforce(version, metadata, startedAt); break;
    default: throw new Error('Unsupported provider.');
  }
  const observedAt = new Date().toISOString();
  report = sanitizeConnectionProviderReport({ ...report, observedAt, observationMode: 'live', freshness: 'current',
    ...(providerOperational(report) ? { lastVerifiedAt: observedAt } : {}) }, providerId);
  if (persist && providerOperational(report)) {
    ensureStateDirectories();
    recordCredentialVerification(providerId, observedAt);
  }
  return report;
}

function readSafeStatus() {
  try {
    const value = JSON.parse(readFileSync(STATUS_PATH, 'utf8'));
    return value?.schemaVersion === 2
      && value?.policyVersion === CONNECTION_POLICY_VERSION
      && value?.profile === CONNECTION_PROFILE_NAME
      ? value
      : null;
  } catch {
    return null;
  }
}

export function mergeSafeConnectionStatus(current, reports, publication, generatedAt = new Date().toISOString()) {
  const sanitizedReports = reports.map((report) => sanitizeConnectionProviderReport(report, report?.provider)).filter(Boolean);
  const completeSnapshot = sanitizedReports.length === CONNECTION_TARGETS.length
    && CONNECTION_TARGETS.every(({ id }) => sanitizedReports.some((report) => report.provider === id));
  const existingProviders = completeSnapshot ? {} : Object.fromEntries(CONNECTION_TARGETS.flatMap(({ id }) => {
    const report = sanitizeConnectionProviderReport(current?.providers?.[id], id);
    return report ? [[id, { ...report, freshness: connectionEvidenceFreshness(report, generatedAt) }]] : [];
  }));
  const rawPublication = completeSnapshot ? publication : publication ?? current?.publication;
  const resolvedPublication = rawPublication && ['published', 'skipped', 'failed'].includes(rawPublication.status)
    ? { status: rawPublication.status,
      ...(rawPublication.status === 'published' && !Number.isNaN(Date.parse(rawPublication.verifiedAt)) ? { verifiedAt: new Date(rawPublication.verifiedAt).toISOString() } : {}),
      ...(rawPublication.status === 'failed' ? { code: 'attestation_publication_failed' } : {}) }
    : null;
  return {
    schemaVersion: 2, policyVersion: CONNECTION_POLICY_VERSION, profile: CONNECTION_PROFILE_NAME,
    generatedAt, browserProfile: APPROVED_CONNECTION_BROWSER_PROFILE, publication: resolvedPublication,
    providers: { ...existingProviders, ...Object.fromEntries(sanitizedReports.map((report) => [report.provider, report])) },
  };
}

function writeSafeStatus(reports, publication = undefined) {
  const value = mergeSafeConnectionStatus(readSafeStatus(), reports.map((report) => sanitizeConnectionProviderReport(report, report.provider)).filter(Boolean), publication);
  ensureStateDirectories();
  writeFileSync(STATUS_PATH, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(STATUS_PATH, 0o600);
  return value;
}

function selectedProviders(value) {
  if (!value || value.startsWith('--')) return CONNECTION_TARGETS.map(({ id }) => id);
  if (!PROVIDER_IDS.has(value)) throw new Error('Unknown connection provider.');
  return [value];
}

function providerOperational(report) {
  return report.identityVerified
    && report.identityStatus === 'verified'
    && report.targetPin === 'verified'
    && report.permissionStatus === 'verified'
    && ['approved', 'warning'].includes(report.cliVersionStatus)
    && report.credentialLifecycle !== 'expired';
}

export function providerCliRunnable(report) {
  if (!report?.identityVerified
    || report.identityStatus !== 'verified'
    || report.targetPin !== 'verified'
    || !['approved', 'warning'].includes(report.cliVersionStatus)) return false;
  if (report.permissionStatus === 'verified') return true;
  if (report.provider !== 'salesforce') return false;
  const required = target('salesforce').requiredPermissions;
  const granted = new Set(report.permissions || []);
  const missing = required.filter((permission) => !granted.has(permission));
  return missing.length === 1
    && missing[0] === 'shared.metadata.current'
    && (report.warningCodes || []).length === 1
    && report.warningCodes[0] === 'shared_metadata_out_of_date';
}

function printReports(value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  console.log(`FCOS connection profile: ${value.profile} · policy ${value.policyVersion}`);
  if (value.readOnly) console.log('Cached local diagnostics; not live verified. No provider commands, credential refresh, setup, publication or local writes.');
  for (const report of Object.values(value.providers)) {
    console.log(`${report.provider}: ${report.identityStatus}; pin=${report.targetPin}; permissions=${report.permissionStatus}; cli=${report.cliVersion || 'unavailable'} (${report.cliVersionStatus}); ${report.latencyMs}ms`);
  }
  if (value.publication) console.log(`Signed attestation: ${value.publication.status}`);
  if (!value.readOnly) console.log(`Safe local report: ${path.relative(REPO_ROOT, STATUS_PATH)}`);
}

function exitCodeFor(reports) {
  if (reports.every(providerOperational)) return 0;
  if (reports.some(({ identityStatus, targetPin }) => identityStatus === 'mismatch' || targetPin === 'mismatch')) return 3;
  if (reports.some(({ identityStatus }) => identityStatus === 'unavailable')) return 4;
  return 2;
}

function buildAttestation(reports, startedAt, now = new Date()) {
  const verifiedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CONNECTION_ATTESTATION_POLICY.staleSeconds * 1000).toISOString();
  return sanitizeConnectionAttestation({
    schemaVersion: 1,
    policyVersion: CONNECTION_POLICY_VERSION,
    profile: CONNECTION_PROFILE_NAME,
    keyId: CONNECTION_ATTESTATION_POLICY.keyId,
    verifiedAt,
    expiresAt,
    durationMs: Date.now() - startedAt,
    providers: Object.fromEntries(reports.map((report) => [report.provider, report])),
  });
}

async function publishAttestation(attestation) {
  const privateKeyPem = keychainValue(CONNECTION_ATTESTATION_POLICY.privateKeyService);
  if (!privateKeyPem) throw new Error('The dedicated FCOS attestation signing key is unavailable in macOS Keychain.');
  const signature = sign(null, Buffer.from(canonicalConnectionAttestation(attestation)), createPrivateKey(privateKeyPem)).toString('base64url');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(CONNECTION_ATTESTATION_POLICY.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attestation, signature }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) throw new Error('Attestation endpoint rejected publication.');
    return { status: 'published', verifiedAt: attestation.verifiedAt };
  } finally {
    clearTimeout(timer);
  }
}

export function parseConnectionDiagnosticArguments(args = []) {
  const flags = new Set(['--json', '--read-only', '--publish', '--no-publish']);
  if (args.some((arg) => arg.startsWith('-') && !flags.has(arg))) throw new Error('Unknown connection diagnostic option.');
  if (args.filter((arg) => !arg.startsWith('-')).length > 1) throw new Error('Choose one provider or all four providers.');
  if (args.includes('--publish') && (args.includes('--read-only') || args.includes('--no-publish'))) throw new Error('Publication conflicts with read-only/non-publishing diagnostics.');
  const providers = selectedProviders(args.find((arg) => !arg.startsWith('-')));
  if (args.includes('--publish') && providers.length !== CONNECTION_TARGETS.length) throw new Error('Publication requires complete four-provider verification.');
  return { providers, readOnly: args.includes('--read-only'), publish: args.includes('--publish'), json: args.includes('--json') };
}

export async function collectConnectionDiagnostics(options, dependencies = {}) {
  const startedAt = Date.now();
  const verifier = dependencies.verifyProvider || verifyProvider;
  const reports = await Promise.all(options.providers.map((provider) => verifier(provider, { readOnly: options.readOnly, persist: !options.readOnly, prepare: false })));
  let publication = { status: 'skipped' };
  if (options.publish) {
    try {
      publication = await (dependencies.publishAttestation || publishAttestation)(buildAttestation(reports, startedAt));
    } catch { publication = { status: 'failed', code: 'attestation_publication_failed' }; }
  }
  const safeReports = reports.map((report) => sanitizeConnectionProviderReport(report, report.provider)).filter(Boolean);
  const value = options.readOnly
    ? mergeSafeConnectionStatus(null, safeReports, { status: 'skipped' })
    : (dependencies.writeSafeStatus || writeSafeStatus)(safeReports, options.providers.length === CONNECTION_TARGETS.length ? publication : undefined);
  return { ...value, readOnly: options.readOnly, observation: options.readOnly ? 'cached; not live verified' : 'live tooling probes; application runtime not verified',
    runtimeConnections: fcosRuntimeConnectionCatalogue(dependencies.environment || process.env), exitCode: publication.status === 'failed' ? 5 : exitCodeFor(safeReports) };
}

async function verifyCommand(args, { doctor = false } = {}) {
  const options = parseConnectionDiagnosticArguments(args);
  const value = await collectConnectionDiagnostics(options);
  printReports(value, options.json);
  if (doctor && !options.json) {
    const salesforceProfiles = salesforceEnvironments().map(({ label, browserProfile }) => `${label}=${browserProfile}`).join(', ');
    console.log(`Approved Chrome fallback: FCOS=${APPROVED_CONNECTION_BROWSER_PROFILE}; Salesforce ${salesforceProfiles}; shared Salesforce GitHub=${target('salesforce').publication.browserProfile}. Browser metadata must be verified before a tab is opened.`);
  }
  return value.exitCode;
}

async function pinSupabase() {
  const current = await verifyProvider('supabase');
  if (current.targetPin === 'verified') return true;
  const result = await runCaptured('supabase', ['link', '--project-ref', identifier('supabase', 'Project ref'), '--yes']);
  return result.ok && (await verifyProvider('supabase')).targetPin === 'verified';
}

async function pinGitHub() {
  const current = await verifyProvider('github');
  if (current.targetPin === 'verified') return true;
  if (current.identityStatus !== 'verified' || current.targetPin === 'mismatch') return false;
  if (!configureGithubCredentialHelper()) return false;
  const remoteProbe = spawnSync('git', ['ls-remote', '--exit-code', 'origin', 'HEAD'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    timeout: COMMAND_TIMEOUT_MS,
  });
  return remoteProbe.status === 0 && (await verifyProvider('github')).targetPin === 'verified';
}

async function pinVercel() {
  const current = await verifyProvider('vercel');
  if (current.targetPin === 'verified') return true;
  if (current.targetPin === 'mismatch') return false;
  const result = await runCaptured('vercel', ['link', '--yes', '--team', identifier('vercel', 'Team ID'), '--project', identifier('vercel', 'Project ID')]);
  return result.ok && (await verifyProvider('vercel')).targetPin === 'verified';
}

async function pinSalesforce() {
  if (readSalesforcePin() === target('salesforce').profileName) return true;
  const result = await runCaptured('salesforce', ['config', 'set', `target-org=${target('salesforce').profileName}`, '--json']);
  return result.ok && readSalesforcePin() === target('salesforce').profileName;
}

async function bootstrapCommand(args) {
  const providers = selectedProviders(args.find((value) => !value.startsWith('--')));
  const initial = await Promise.all(providers.map(verifyProvider));
  if (initial.some(({ identityStatus }) => identityStatus !== 'verified')) {
    const value = writeSafeStatus(initial);
    printReports(value, args.includes('--json'));
    console.error('Bootstrap stopped before target writes. Authenticate only providers marked authentication_blocked, then verify again.');
    return exitCodeFor(initial);
  }
  for (const providerId of providers) {
    if (providerId === 'github' && !(await pinGitHub())) throw new Error('GitHub repository credential helper could not be pinned and verified.');
    if (providerId === 'vercel' && !(await pinVercel())) throw new Error('Vercel team and project link could not be pinned and verified.');
    if (providerId === 'supabase' && !(await pinSupabase())) throw new Error('Supabase target link could not be pinned and verified.');
    if (providerId === 'salesforce' && !(await pinSalesforce())) throw new Error('Salesforce target-org could not be pinned and verified.');
  }
  const final = await Promise.all(providers.map(verifyProvider));
  const value = writeSafeStatus(final);
  printReports(value, args.includes('--json'));
  return exitCodeFor(final);
}

export function validateProviderArgs(providerId, args) {
  describeConnectionOperation(providerId, args);
  return true;
}

// Generic runners support reviewed reads and local development only. A local flag,
// file or boolean can never authorize a provider mutation or Production release.
export async function runConnectionOperation(context, args, dependencies = {}) {
  const operation = validateConnectionOperation(context, args);
  const report = await (dependencies.verifyProvider || verifyProvider)(context.provider, { persist: false, prepare: false });
  assertConnectionOperationAccess(operation, report, { now: dependencies.now || new Date() });
  if (operation.resource) {
    const resourceCheck = dependencies.verifyResource || verifyVercelResource;
    if (await resourceCheck(operation.resource) !== true) throw new Error('Resource ownership must match the pinned Vercel project and team.');
  }
  if (dependencies.execute) return dependencies.execute(operation, args);
  if (operation.operation.endsWith('.api.read')) {
    const result = await runCaptured(context.provider, args);
    const parsed = safeJson(result.stdout);
    if (!result.ok || !parsed) throw new Error('Managed API read failed safely; provider output was not printed.');
    const output = sanitizeConnectionOperationOutput(operation, parsed);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return 0;
  }
  const runtime = providerRuntime(context.provider, { prepare: false, environment: context.environment });
  return new Promise((resolve) => {
    const child = spawn(runtime.command, [...args, ...runtime.injectedArgs], { cwd: REPO_ROOT, env: runtime.env, stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (status) => resolve(Number.isInteger(status) ? status : 1));
  });
}

async function verifyVercelResource(resource) {
  const result = await runCaptured('vercel', ['api', `/v13/deployments/${encodeURIComponent(resource)}?teamId=${identifier('vercel', 'Team ID')}`, '--method', 'GET']);
  const value = safeJson(result.stdout);
  return result.ok && value?.projectId === identifier('vercel', 'Project ID')
    && (value?.teamId || value?.ownerId) === identifier('vercel', 'Team ID');
}

async function runCommand(args) {
  const separator = args.indexOf('--');
  if (separator < 1) throw new Error('Managed CLI arguments require provider and -- separator.');
  const providerId = args[0];
  const cliArgs = args.slice(separator + 1);
  const description = describeConnectionOperation(providerId, cliArgs);
  const wrapperArgs = args.slice(1, separator);
  const contextOption = (name) => optionValue(wrapperArgs, name);
  const supported = new Set(['--environment', '--operation', '--capability']);
  for (let index = 0; index < wrapperArgs.length; index += 1) {
    const flag = wrapperArgs[index].split('=')[0];
    if (!supported.has(flag)) throw new Error('Unknown managed operation context option.');
    if (!wrapperArgs[index].includes('=')) index += 1;
  }
  const defaultEnvironment = providerId === 'salesforce' ? 'devee' : description.localWrite ? 'development' : 'tooling';
  return runConnectionOperation({ provider: providerId, environment: contextOption('--environment') || defaultEnvironment,
    operation: contextOption('--operation') || description.operation, capability: contextOption('--capability') || description.capability }, cliArgs);
}

function optionValue(args, name) {
  if (args.filter((value) => value === name || value.startsWith(`${name}=`)).length > 1) throw new Error('Duplicate managed context options are blocked.');
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
}

export function resolveSalesforceBrowserAuthentication(args = []) {
  const environmentKey = optionValue(args, '--environment');
  const requestedProfile = optionValue(args, '--browser-profile');
  if (!environmentKey) throw new Error('Salesforce authentication requires --environment devee, qat, or production.');
  const environment = salesforceEnvironments().find(({ key }) => key === environmentKey);
  if (!environment) throw new Error('Salesforce authentication environment is not approved.');
  if (!requestedProfile) throw new Error(`Salesforce ${environment.label} authentication requires --browser-profile ${environment.browserProfile}.`);
  if (requestedProfile !== environment.browserProfile) {
    throw new Error(`Salesforce ${environment.label} authentication is restricted to Chrome profile ${environment.browserProfile}.`);
  }
  return environment;
}

async function authCommand(args) {
  const providerId = args[0];
  if (!PROVIDER_IDS.has(providerId)) throw new Error('Choose one provider to authenticate.');
  const salesforceEnvironment = providerId === 'salesforce'
    ? resolveSalesforceBrowserAuthentication(args.slice(1))
    : null;
  const current = await verifyProvider(providerId);
  writeSafeStatus([current]);
  if (providerOperational(current)) {
    console.log(`${providerId}: the exact FCOS identity, target pin, version, and permissions are already verified.`);
    return 0;
  }
  if (current.identityStatus === 'mismatch' || current.targetPin === 'mismatch') {
    console.error(`${providerId}: identity mismatch. Authentication mutation is blocked.`);
    return 3;
  }
  if (current.identityStatus !== 'authentication_blocked') {
    console.error(`${providerId}: authentication cannot start from state ${current.identityStatus}.`);
    return exitCodeFor([current]);
  }
  const provider = target(providerId);
  if (providerId === 'salesforce') {
    console.log(`Authentication is allowed only for Salesforce ${salesforceEnvironment.label} (${salesforceEnvironment.alias}) in Chrome profile ${salesforceEnvironment.browserProfile}.`);
    console.log('Complete only the blocked web authentication, then immediately return to the CLI verifier. No browser credential material is recorded by FCOS.');
  } else if (provider.credentialStorage === 'macos_keychain') {
    console.log(`Authentication is allowed only in Chrome profile ${APPROVED_CONNECTION_BROWSER_PROFILE}; immediately return to the CLI verifier afterward.`);
    console.log(`Store the new credential with the hidden FCOS Keychain prompt: ${FCOS_CONNECTION_POLICY.keychainHelper} prompt-set ${FCOS_CONNECTION_POLICY.keychainAccount} ${provider.keychainService}`);
  } else {
    console.log(`Authentication is allowed only in Chrome profile ${APPROVED_CONNECTION_BROWSER_PROFILE}; immediately return to the CLI verifier afterward.`);
    console.log(`Start the ${providerId} CLI authorization without changing machine-wide credentials and complete only its URL in ${APPROVED_CONNECTION_BROWSER_PROFILE}.`);
  }
  return 2;
}

function keychainCommand() {
  const rows = CONNECTION_TARGETS.filter(({ keychainService }) => keychainService).map((provider) => ({
    provider: provider.id,
    service: provider.keychainService,
    available: Boolean(keychainValue(provider.keychainService)),
  }));
  rows.push({
    provider: 'attestation',
    service: CONNECTION_ATTESTATION_POLICY.privateKeyService,
    available: Boolean(keychainValue(CONNECTION_ATTESTATION_POLICY.privateKeyService)),
  });
  for (const row of rows) console.log(`${row.provider}: ${row.available ? 'available' : 'missing'} · ${row.service}`);
  return rows.every(({ available }) => available) ? 0 : 2;
}

function credentialMetadataCommand(args) {
  const providerId = args[0];
  if (!PROVIDER_IDS.has(providerId)) throw new Error('Choose one provider for credential metadata.');
  const expiresIndex = args.indexOf('--expires-at');
  const neverExpires = args.includes('--never-expires');
  const expiresAt = expiresIndex >= 0 ? args[expiresIndex + 1] : null;
  if (neverExpires === Boolean(expiresAt)) {
    throw new Error('Choose exactly one of --expires-at or --never-expires.');
  }
  if (expiresAt && (Number.isNaN(Date.parse(expiresAt)) || new Date(expiresAt).getTime() <= Date.now())) {
    throw new Error('Provide a valid future --expires-at timestamp.');
  }
  ensureStateDirectories();
  const existing = readCredentialMetadata() || { schemaVersion: 1, profile: CONNECTION_PROFILE_NAME, providers: {} };
  const current = existing.providers?.[providerId] || {};
  const now = new Date().toISOString();
  writeCredentialMetadata({
    ...existing,
    providers: {
      ...existing.providers,
      [providerId]: {
        ...current,
        authorizedAt: now,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        lastVerifiedAt: null,
      },
    },
  });
  console.log(`${providerId}: non-secret authorization and expiry metadata recorded.`);
  return 0;
}

function printHelp() {
  console.log(`Usage:
  npm run connections:verify [-- <provider>] [-- --read-only --json] [-- --publish]
  npm run connections:doctor [-- --read-only --json] [-- --publish]
  npm run connections:bootstrap [-- <provider>]
  npm run connections:auth -- <provider>
  npm run connections:keychain
  npm run connections:cli -- <provider> -- <provider CLI arguments>`);
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const [command, ...args] = argv;
    if (!command || command === 'help' || command === '--help') {
      printHelp();
      return 0;
    }
    if (command === 'verify') return await verifyCommand(args);
    if (command === 'doctor') return await verifyCommand(args, { doctor: true });
    if (args.includes('--read-only')) throw new Error('Read-only mode is supported only for verify and doctor; other actions are blocked.');
    if (command === 'bootstrap') return await bootstrapCommand(args);
    if (command === 'auth') return await authCommand(args);
    if (command === 'keychain') return keychainCommand();
    if (command === 'credential-metadata') return credentialMetadataCommand(args);
    if (command === 'run') return await runCommand(args);
    throw new Error('Unknown connection command.');
  } catch (error) {
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify({ ok: false, code: error?.code || 'connection_command_failed', error: 'Connection command rejected safely.' })}\n`);
    else console.error(error instanceof Error ? error.message : 'Connection command failed safely.');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
