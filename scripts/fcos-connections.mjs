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
  connectionProviderById,
  sanitizeConnectionAttestation,
  sanitizeConnectionProviderReport,
} from '../src/lib/connectionChecklist.js';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

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

function salesforceEnvironments() {
  return target('salesforce').environments || [{ key: 'production', label: 'Production', alias: target('salesforce').profileName, orgId: identifier('salesforce', 'Production Org ID') || identifier('salesforce', 'Org ID'), isSandbox: false }];
}

function approvedSalesforceTargets() {
  return new Set(salesforceEnvironments().flatMap((environment) => [environment.alias, environment.orgId]));
}

function executablePath(command) {
  return command.includes('/') ? path.resolve(REPO_ROOT, command) : command;
}

function executableExists(command) {
  const resolved = executablePath(command);
  if (resolved.includes('/')) return existsSync(resolved);
  return spawnSync('/usr/bin/which', [resolved], { stdio: 'ignore' }).status === 0;
}

function ensureStateDirectories() {
  mkdirSync(LOCAL_STATE_ROOT, { recursive: true, mode: 0o700 });
  for (const provider of CONNECTION_TARGETS) {
    if (provider.configPath.startsWith(`${CONNECTION_LOCAL_STATE_DIRECTORY}/`)) {
      mkdirSync(path.join(REPO_ROOT, provider.configPath), { recursive: true, mode: 0o700 });
    }
  }
}

function keychainValue(service) {
  if (process.platform !== 'darwin' || !service) return '';
  const helper = path.join(REPO_ROOT, FCOS_CONNECTION_POLICY.keychainHelper);
  if (!ensureKeychainHelper(helper)) return '';
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

function ensureCredentialMetadata(providerId, credentialAvailable, now = new Date()) {
  const existing = readCredentialMetadata() || {
    schemaVersion: 1,
    profile: CONNECTION_PROFILE_NAME,
    providers: {},
  };
  const current = existing.providers?.[providerId] || {};
  if (!credentialAvailable && !current.authorizedAt) return current;
  const timestamp = now.toISOString();
  const next = {
    ...existing,
    providers: {
      ...existing.providers,
      [providerId]: {
        ...current,
        authorizedAt: current.authorizedAt || timestamp,
        lastVerifiedAt: current.lastVerifiedAt || null,
      },
    },
  };
  writeCredentialMetadata(next);
  return next.providers[providerId];
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
        authorizedAt: current.authorizedAt || verifiedAt,
        lastVerifiedAt: verifiedAt,
      },
    },
  });
}

export function providerRuntime(providerId, { requireCredential = true } = {}) {
  const provider = target(providerId);
  const baseEnv = { ...process.env, NO_COLOR: '1' };
  let credentialAvailable = true;

  switch (providerId) {
    case 'github': {
      delete baseEnv.GH_TOKEN;
      delete baseEnv.GITHUB_TOKEN;
      credentialAvailable = existsSync(path.join(REPO_ROOT, provider.configPath, 'hosts.yml'));
      return {
        command: executablePath(provider.executable),
        credentialAvailable,
        env: {
          ...baseEnv,
          GH_CONFIG_DIR: path.join(REPO_ROOT, provider.configPath),
          GH_HOST: 'github.com',
          GH_REPO: `github.com/${identifier('github', 'Repository')}`,
        },
        injectedArgs: [],
      };
    }
    case 'vercel': {
      delete baseEnv.VERCEL_TOKEN;
      const token = requireCredential ? keychainValue(provider.keychainService) : '';
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
      const token = requireCredential ? keychainValue(provider.keychainService) : '';
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
      return {
        command: executablePath(provider.executable),
        credentialAvailable: true,
        env: { ...baseEnv, SF_TARGET_ORG: provider.profileName },
        injectedArgs: [],
      };
    default:
      throw new Error(`Unsupported provider: ${providerId}`);
  }
}

function runCaptured(providerId, args, { inject = true, requireCredential = true } = {}) {
  const runtime = providerRuntime(providerId, { requireCredential });
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
  const configDirectory = path.join(REPO_ROOT, publication.configPath);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn('gh', args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
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
    if (parsed.hostname.toLowerCase() !== 'github.com') return '';
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
  if (/not logged|login required|authentication|access token|unauthorized|forbidden|credentials|profileloaderror|failed to read profile|invalid token/.test(detail)) {
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
  const warningCodes = [...new Set([
    ...report.warningCodes,
    ...(report.targetPin !== 'verified' ? ['target_pin_missing'] : []),
    ...(report.permissionStatus !== 'verified' ? ['permission_probe_failed'] : []),
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
  const configDirectory = path.join(REPO_ROOT, target('github').configPath);
  return `!f() { env GH_CONFIG_DIR=${shellSingleQuote(configDirectory)} gh auth git-credential "$@"; }; f`;
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

async function verifyGitHub(version, metadata, startedAt) {
  const report = baseReport('github', version, startedAt, metadata);
  if (!version.available) return finalizeReport(report, startedAt);
  const runtime = providerRuntime('github');
  if (!runtime.credentialAvailable) return finalizeReport({ ...report, identityStatus: 'authentication_blocked', targetPin: 'verified' }, startedAt);
  const [account, repository, auth] = await Promise.all([
    runCaptured('github', ['api', 'user', '--jq', '.login']),
    runCaptured('github', ['api', `repos/${identifier('github', 'Repository')}`]),
    runCaptured('github', ['auth', 'status', '--active', '--hostname', 'github.com', '--json', 'hosts']),
  ]);
  if (!account.ok || !repository.ok || !auth.ok) {
    return finalizeReport({ ...report, identityStatus: classifyFailedIdentity(account, repository, auth) }, startedAt);
  }
  const repo = safeJson(repository.stdout);
  const authEntry = safeJson(auth.stdout)?.hosts?.['github.com']?.[0];
  const scopes = String(authEntry?.scopes || '').split(',').map((value) => value.trim());
  const exactRemote = canonicalGitRemote(readGitRemote()) === identifier('github', 'Repository').toLowerCase();
  const exactCredentialHelper = githubCredentialHelperConfigured();
  const exactIdentity = account.stdout.trim() === identifier('github', 'Required account')
    && repo?.full_name?.toLowerCase() === identifier('github', 'Repository').toLowerCase()
    && authEntry?.login === identifier('github', 'Required account')
    && authEntry?.active === true
    && authEntry?.state === 'success';
  const permissions = [];
  if (repo?.permissions?.pull === true) permissions.push('repository.read');
  if (repo?.permissions?.push === true) permissions.push('repository.push');
  if (repo?.permissions?.push === true && scopes.includes('workflow')) permissions.push('workflow.update');
  if (exactCredentialHelper) permissions.push('git.push.authentication');
  return finalizeReport({
    ...report,
    identityStatus: exactIdentity && exactRemote ? 'verified' : 'mismatch',
    identityVerified: exactIdentity && exactRemote,
    targetPin: exactRemote && exactCredentialHelper ? 'verified' : exactRemote ? 'missing' : 'mismatch',
    permissionStatus: permissions.length === target('github').requiredPermissions.length ? 'verified' : 'missing',
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
  const runtime = providerRuntime('vercel');
  if (!runtime.credentialAvailable) return finalizeReport({ ...report, identityStatus: 'authentication_blocked' }, startedAt);
  const [account, project, deployments] = await Promise.all([
    runCaptured('vercel', ['whoami']),
    runCaptured('vercel', ['project', 'inspect', identifier('vercel', 'Project')]),
    runCaptured('vercel', ['list', identifier('vercel', 'Project')]),
  ]);
  if (!account.ok || !project.ok || !deployments.ok) {
    return finalizeReport({ ...report, identityStatus: classifyFailedIdentity(account, project, deployments) }, startedAt);
  }
  const link = readVercelLink();
  const exactLink = link?.id === identifier('vercel', 'Project ID')
    && link?.orgId === identifier('vercel', 'Team ID')
    && link?.name === identifier('vercel', 'Project');
  const projectOutput = `${project.stdout}\n${project.stderr}`;
  const exactIdentity = account.stdout.trim() === identifier('vercel', 'Account')
    && projectOutput.includes(identifier('vercel', 'Project ID'))
    && projectOutput.includes(identifier('vercel', 'Target'));
  const targetPin = exactLink ? 'verified' : link ? 'mismatch' : 'missing';
  const permissions = exactIdentity && project.ok && deployments.ok
    ? [...target('vercel').requiredPermissions]
    : [];
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
  const runtime = providerRuntime('supabase');
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
  if (exactLink) permissions.push('project.link');
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

export async function verifyProvider(providerId) {
  ensureStateDirectories();
  const startedAt = Date.now();
  const version = await cliVersion(providerId);
  const runtime = providerRuntime(providerId);
  const metadata = ensureCredentialMetadata(providerId, runtime.credentialAvailable);
  let report;
  switch (providerId) {
    case 'github': report = await verifyGitHub(version, metadata, startedAt); break;
    case 'vercel': report = await verifyVercel(version, metadata, startedAt); break;
    case 'supabase': report = await verifySupabase(version, metadata, startedAt); break;
    case 'salesforce': report = await verifySalesforce(version, metadata, startedAt); break;
    default: throw new Error(`Unsupported provider: ${providerId}`);
  }
  if (providerOperational(report)) {
    const verifiedAt = new Date().toISOString();
    recordCredentialVerification(providerId, verifiedAt);
    return { ...report, lastVerifiedAt: verifiedAt };
  }
  return report;
}

function writeSafeStatus(reports, publication = null) {
  const value = {
    schemaVersion: 2,
    policyVersion: CONNECTION_POLICY_VERSION,
    profile: CONNECTION_PROFILE_NAME,
    generatedAt: new Date().toISOString(),
    browserProfile: APPROVED_CONNECTION_BROWSER_PROFILE,
    publication,
    providers: Object.fromEntries(reports.map((report) => [report.provider, report])),
  };
  writeFileSync(STATUS_PATH, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(STATUS_PATH, 0o600);
  return value;
}

function selectedProviders(value) {
  if (!value || value.startsWith('--')) return CONNECTION_TARGETS.map(({ id }) => id);
  if (!PROVIDER_IDS.has(value)) throw new Error(`Unknown provider: ${value}`);
  return [value];
}

function providerOperational(report) {
  return report.identityVerified
    && report.identityStatus === 'verified'
    && report.targetPin === 'verified'
    && report.permissionStatus === 'verified'
    && ['approved', 'warning'].includes(report.cliVersionStatus);
}

function printReports(value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  console.log(`FCOS connection profile: ${value.profile} · policy ${value.policyVersion}`);
  for (const report of Object.values(value.providers)) {
    console.log(`${report.provider}: ${report.identityStatus}; pin=${report.targetPin}; permissions=${report.permissionStatus}; cli=${report.cliVersion || 'unavailable'} (${report.cliVersionStatus}); ${report.latencyMs}ms`);
  }
  if (value.publication) console.log(`Signed attestation: ${value.publication.status}`);
  console.log(`Safe local report: ${path.relative(REPO_ROOT, STATUS_PATH)}`);
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
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || `Attestation endpoint returned HTTP ${response.status}.`);
    return { status: 'published', verifiedAt: attestation.verifiedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyCommand(args, { doctor = false } = {}) {
  const startedAt = Date.now();
  const providers = selectedProviders(args.find((value) => !value.startsWith('--')));
  const reports = await Promise.all(providers.map(verifyProvider));
  let publication = null;
  const fullVerification = providers.length === CONNECTION_TARGETS.length;
  if (fullVerification && !args.includes('--no-publish')) {
    try {
      publication = await publishAttestation(buildAttestation(reports, startedAt));
    } catch (error) {
      publication = { status: 'failed', error: error instanceof Error ? error.message : 'Publication failed safely.' };
    }
  } else if (fullVerification) {
    publication = { status: 'skipped' };
  }
  const value = writeSafeStatus(reports, publication);
  printReports(value, args.includes('--json'));
  if (doctor) {
    console.log(`Approved Chrome fallback: ${APPROVED_CONNECTION_BROWSER_PROFILE} (authentication only)`);
    console.log(`Credential metadata: ${path.relative(REPO_ROOT, CREDENTIAL_METADATA_PATH)} (non-secret, mode 0600)`);
  }
  if (publication?.status === 'failed') return 5;
  return exitCodeFor(reports);
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
  if (!Array.isArray(args) || args.length === 0) throw new Error('Provide the provider CLI arguments after --.');
  const joined = args.join(' ').toLowerCase();
  const deniedFlags = new Set(['--token', '-t', '--password', '-p', '--client-secret', '--with-token', '--show-token']);
  if (args.some((arg) => deniedFlags.has(arg.toLowerCase()) || /^--(?:token|password|client-secret)=/i.test(arg))) {
    throw new Error('Secret-bearing CLI flags are blocked. Use the provider credential store or approved environment injection.');
  }
  if (/\b(login|logout)\b/.test(joined)) throw new Error('Login and logout are blocked in the verified runner. Use connections:auth for authentication.');
  if (providerId === 'github') {
    if (/auth token|auth status .*--show-token/.test(joined)) throw new Error('Commands that reveal GitHub tokens are blocked.');
    const foreignRepo = args.find((arg) => /github\.com[:/]/i.test(arg)
      && canonicalGitRemote(arg) !== identifier('github', 'Repository').toLowerCase());
    if (foreignRepo) throw new Error('The GitHub command targets a repository outside the approved FCOS repository.');
  }
  if (providerId === 'vercel' && args.some((arg) => ['--global-config', '-q', '--scope', '-s', '--team'].includes(arg.toLowerCase()))) {
    throw new Error('Vercel config, scope, and team overrides are blocked; the FCOS wrapper injects the approved values.');
  }
  if (providerId === 'supabase') {
    if (args.some((arg) => ['--profile', '--workdir'].includes(arg.toLowerCase()))) {
      throw new Error('Supabase profile and workdir overrides are blocked; the FCOS wrapper injects the approved local home and workdir.');
    }
    const projectIndex = args.findIndex((arg) => arg === '--project-ref' || arg.startsWith('--project-ref='));
    if (projectIndex >= 0) {
      const supplied = args[projectIndex].includes('=') ? args[projectIndex].split('=').slice(1).join('=') : args[projectIndex + 1];
      if (supplied !== identifier('supabase', 'Project ref')) throw new Error('The Supabase command targets an unapproved project ref.');
    }
  }
  if (providerId === 'salesforce') {
    if (/\borg display\b|\borg list auth\b|\bforce:org:display\b/.test(joined)) {
      throw new Error('Salesforce commands that expose access tokens or auth URLs are blocked by the FCOS wrapper.');
    }
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '--target-org' || args[index] === '-o') {
        const supplied = args[index + 1];
        if (!approvedSalesforceTargets().has(supplied)) {
          throw new Error('The Salesforce command targets an unapproved org.');
        }
      }
    }
  }
  return true;
}

async function runCommand(args) {
  const providerId = args[0];
  if (!PROVIDER_IDS.has(providerId)) throw new Error('Choose github, vercel, supabase, or salesforce before --.');
  const separator = args.indexOf('--');
  const rawCliArgs = (separator >= 0 ? args.slice(separator + 1) : args.slice(1)).filter(Boolean);
  const bootstrapFlag = '--bootstrap-missing-salesforce-targets';
  const bootstrapSalesforce = providerId === 'salesforce' && rawCliArgs.includes(bootstrapFlag);
  const effectiveCliArgs = rawCliArgs.filter((arg) => arg !== bootstrapFlag);
  if (bootstrapSalesforce) {
    const approvedBootstrapCommand = [
      'org', 'open',
      '--target-org', 'source-salesforce',
      '--browser', 'chrome',
      '--path', 'lightning/setup/DataManagementCreateTestInstance/home',
    ];
    if (effectiveCliArgs.length !== approvedBootstrapCommand.length
      || effectiveCliArgs.some((arg, index) => arg !== approvedBootstrapCommand[index])) {
      throw new Error('Salesforce bootstrap is limited to the exact Production Sandbox Setup page.');
    }
  } else if (rawCliArgs.includes(bootstrapFlag)) {
    throw new Error('Salesforce bootstrap can only be used with the Salesforce provider.');
  }
  validateProviderArgs(providerId, effectiveCliArgs);
  const report = bootstrapSalesforce
    ? null
    : await verifyProvider(providerId);
  if (report) writeSafeStatus([report]);
  if (report && !providerOperational(report)) {
    console.error(`${providerId}: ${report.identityStatus}. CLI command blocked before execution.`);
    return exitCodeFor([report]);
  }
  if (!report && providerId === 'salesforce') {
    const production = salesforceEnvironments().find((environment) => environment.key === 'production');
    const productionCheck = await Promise.all([
      runCaptured('salesforce', ['org', 'display', '--target-org', production.alias, '--json']),
      runCaptured('salesforce', ['data', 'query', '--target-org', production.alias, '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1', '--json']),
    ]);
    const display = safeJson(productionCheck[0].stdout)?.result;
    const organization = safeJson(productionCheck[1].stdout)?.result?.records?.[0];
    if (!productionCheck.every((check) => check.ok) || display?.id !== production.orgId || organization?.Id !== production.orgId || organization?.IsSandbox !== false) {
      throw new Error('Production Salesforce identity must be verified before authorizing missing sandbox targets.');
    }
  }
  const runtime = providerRuntime(providerId);
  return new Promise((resolve) => {
    const child = spawn(runtime.command, [...effectiveCliArgs, ...runtime.injectedArgs], {
      cwd: REPO_ROOT,
      env: runtime.env,
      stdio: 'inherit',
    });
    child.on('error', () => resolve(1));
    child.on('close', (status) => resolve(Number.isInteger(status) ? status : 1));
  });
}

async function authCommand(args) {
  const providerId = args[0];
  if (!PROVIDER_IDS.has(providerId)) throw new Error('Choose one provider to authenticate.');
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
  console.log(`Authentication is allowed only in Chrome profile ${APPROVED_CONNECTION_BROWSER_PROFILE}; immediately return to the CLI verifier afterward.`);
  const provider = target(providerId);
  if (provider.credentialStorage === 'macos_keychain') {
    console.log(`Store the new credential with the hidden FCOS Keychain prompt: ${FCOS_CONNECTION_POLICY.keychainHelper} prompt-set ${FCOS_CONNECTION_POLICY.keychainAccount} ${provider.keychainService}`);
  } else if (providerId === 'salesforce') {
    console.log(`Use Salesforce web login only in ${APPROVED_CONNECTION_BROWSER_PROFILE}, with alias ${provider.profileName}.`);
  } else {
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
  npm run connections:verify [-- <provider>] [-- --json] [-- --no-publish]
  npm run connections:doctor [-- --no-publish]
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
    if (command === 'verify') return verifyCommand(args);
    if (command === 'doctor') return verifyCommand(args, { doctor: true });
    if (command === 'bootstrap') return bootstrapCommand(args);
    if (command === 'auth') return authCommand(args);
    if (command === 'keychain') return keychainCommand();
    if (command === 'credential-metadata') return credentialMetadataCommand(args);
    if (command === 'run') return runCommand(args);
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Connection command failed safely.');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
