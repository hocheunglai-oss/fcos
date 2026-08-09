import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_CONNECTION_BROWSER_PROFILE,
  CONNECTION_LOCAL_STATE_DIRECTORY,
  CONNECTION_PROFILE_NAME,
  CONNECTION_TARGETS,
} from '../src/lib/connectionChecklist.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_STATE_ROOT = path.join(REPO_ROOT, CONNECTION_LOCAL_STATE_DIRECTORY);
const STATUS_PATH = path.join(LOCAL_STATE_ROOT, 'status.json');
const PROVIDER_IDS = new Set(CONNECTION_TARGETS.map(({ id }) => id));

function target(providerId) {
  const value = CONNECTION_TARGETS.find(({ id }) => id === providerId);
  if (!value) throw new Error(`Unknown provider: ${providerId || '(missing)'}`);
  return value;
}

function identifier(providerId, label) {
  return target(providerId).identifiers.find((entry) => entry.label === label)?.value || '';
}

function executableExists(command) {
  if (path.isAbsolute(command)) return existsSync(command);
  return spawnSync('/usr/bin/which', [command], { stdio: 'ignore' }).status === 0;
}

function ensureStateDirectories() {
  mkdirSync(LOCAL_STATE_ROOT, { recursive: true, mode: 0o700 });
  for (const provider of CONNECTION_TARGETS) {
    if (provider.configPath.startsWith(`${CONNECTION_LOCAL_STATE_DIRECTORY}/`)) {
      mkdirSync(path.join(REPO_ROOT, provider.configPath), { recursive: true, mode: 0o700 });
    }
  }
}

export function providerRuntime(providerId) {
  const provider = target(providerId);
  const baseEnv = { ...process.env, NO_COLOR: '1' };

  switch (providerId) {
    case 'github': {
      delete baseEnv.GH_TOKEN;
      delete baseEnv.GITHUB_TOKEN;
      return {
        command: 'gh',
        env: {
          ...baseEnv,
          GH_CONFIG_DIR: path.join(REPO_ROOT, provider.configPath),
          GH_HOST: 'github.com',
          GH_REPO: `github.com/${identifier('github', 'Repository')}`,
        },
        injectedArgs: [],
      };
    }
    case 'vercel':
      delete baseEnv.VERCEL_TOKEN;
      return {
        command: 'vercel',
        env: baseEnv,
        injectedArgs: [
          '--global-config', path.join(REPO_ROOT, provider.configPath),
          '--scope', identifier('vercel', 'Team'),
          '--cwd', REPO_ROOT,
          '--no-color',
        ],
      };
    case 'supabase':
      delete baseEnv.SUPABASE_ACCESS_TOKEN;
      try {
        const accessToken = readFileSync(path.join(REPO_ROOT, provider.configPath, 'access-token'), 'utf8').trim();
        if (/^sbp_[A-Za-z0-9_-]+$/.test(accessToken)) baseEnv.SUPABASE_ACCESS_TOKEN = accessToken;
      } catch {
        // Missing local authorization is handled before any network request.
      }
      return {
        command: path.join(REPO_ROOT, 'node_modules', '.bin', 'supabase'),
        env: {
          ...baseEnv,
          SUPABASE_HOME: path.join(REPO_ROOT, provider.configPath),
        },
        injectedArgs: ['--workdir', REPO_ROOT],
      };
    case 'salesforce':
      return {
        command: 'sf',
        env: { ...baseEnv, SF_TARGET_ORG: provider.profileName },
        injectedArgs: [],
      };
    default:
      throw new Error(`Unsupported provider: ${providerId}`);
  }
}

function runCaptured(providerId, args, { inject = true } = {}) {
  const runtime = providerRuntime(providerId);
  const result = spawnSync(runtime.command, inject ? [...args, ...runtime.injectedArgs] : args, {
    cwd: REPO_ROOT,
    env: runtime.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    unavailable: result.error?.code === 'ENOENT',
  };
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

function classifyFailedIdentity(result) {
  const detail = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (/not logged|login required|authentication|access token|unauthorized|forbidden|credentials|profileloaderror|failed to read profile/.test(detail)) {
    return 'authentication_blocked';
  }
  return 'error';
}

function baseReport(providerId, cliAvailable) {
  const provider = target(providerId);
  return {
    provider: providerId,
    cliAvailable,
    identityStatus: cliAvailable ? 'pending' : 'unavailable',
    identityVerified: false,
    targetPin: 'pending',
    authorizationMode: provider.authorizationMode,
    configPath: provider.configPath,
    fullyIsolated: provider.fullyIsolated,
  };
}

function verifyGitHub() {
  const report = baseReport('github', executableExists('gh'));
  if (!report.cliAvailable) return report;
  if (!existsSync(path.join(REPO_ROOT, target('github').configPath, 'hosts.yml'))) {
    return { ...report, identityStatus: 'authentication_blocked', targetPin: 'verified' };
  }
  const account = runCaptured('github', ['api', 'user', '--jq', '.login']);
  if (!account.ok) return { ...report, identityStatus: classifyFailedIdentity(account) };
  const repository = runCaptured('github', ['api', `repos/${identifier('github', 'Repository')}`, '--jq', '.full_name']);
  if (!repository.ok) return { ...report, identityStatus: classifyFailedIdentity(repository) };
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const exactIdentity = account.stdout.trim() === identifier('github', 'Required account')
    && repository.stdout.trim().toLowerCase() === identifier('github', 'Repository').toLowerCase();
  const exactRemote = remote.status === 0
    && canonicalGitRemote(remote.stdout) === identifier('github', 'Repository').toLowerCase();
  return {
    ...report,
    identityStatus: exactIdentity && exactRemote ? 'verified' : 'mismatch',
    identityVerified: exactIdentity && exactRemote,
    targetPin: exactRemote ? 'verified' : 'mismatch',
  };
}

function readVercelLink() {
  for (const file of ['repo.json', 'project.json']) {
    try {
      const value = JSON.parse(readFileSync(path.join(REPO_ROOT, '.vercel', file), 'utf8'));
      const projects = file === 'repo.json' ? value.projects : [value];
      const match = projects?.find((project) => project.directory === '.' || file === 'project.json');
      if (match) return match;
    } catch {
      // A missing or malformed ignored local link is reported as an unverified pin.
    }
  }
  return null;
}

function verifyVercel() {
  const report = baseReport('vercel', executableExists('vercel'));
  if (!report.cliAvailable) return report;
  const account = runCaptured('vercel', ['whoami']);
  if (!account.ok) return { ...report, identityStatus: classifyFailedIdentity(account) };
  const project = runCaptured('vercel', ['project', 'inspect', identifier('vercel', 'Project')]);
  if (!project.ok) return { ...report, identityStatus: classifyFailedIdentity(project) };
  const link = readVercelLink();
  const exactLink = link?.id === identifier('vercel', 'Project ID')
    && link?.orgId === identifier('vercel', 'Team ID')
    && link?.name === identifier('vercel', 'Project');
  const projectOutput = `${project.stdout}\n${project.stderr}`;
  const exactIdentity = account.stdout.trim() === identifier('vercel', 'Account')
    && projectOutput.includes(identifier('vercel', 'Project ID'))
    && projectOutput.includes(identifier('vercel', 'Target'));
  const targetPin = exactLink ? 'verified' : link ? 'mismatch' : 'missing';
  return {
    ...report,
    identityStatus: exactIdentity && targetPin !== 'mismatch' ? 'verified' : 'mismatch',
    identityVerified: exactIdentity && targetPin !== 'mismatch',
    targetPin,
  };
}

function verifySupabase() {
  const runtime = providerRuntime('supabase');
  const report = baseReport('supabase', executableExists(runtime.command));
  if (!report.cliAvailable) return report;
  if (!runtime.env.SUPABASE_ACCESS_TOKEN) {
    return { ...report, identityStatus: 'authentication_blocked' };
  }
  const projects = runCaptured('supabase', ['projects', 'list', '--output-format', 'json']);
  if (!projects.ok) return { ...report, identityStatus: classifyFailedIdentity(projects) };
  const parsed = safeJson(projects.stdout);
  const availableProjects = Array.isArray(parsed) ? parsed : parsed?.projects;
  const expectedRef = identifier('supabase', 'Project ref');
  const project = Array.isArray(availableProjects)
    ? availableProjects.find((entry) => entry.id === expectedRef || entry.ref === expectedRef)
    : null;
  let linkedRef = '';
  try {
    linkedRef = readFileSync(path.join(REPO_ROOT, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  } catch {
    linkedRef = '';
  }
  const exactIdentity = project?.name === identifier('supabase', 'Project name');
  const exactLink = linkedRef === expectedRef;
  return {
    ...report,
    identityStatus: exactIdentity ? 'verified' : 'mismatch',
    identityVerified: exactIdentity,
    targetPin: exactLink ? 'verified' : 'missing',
  };
}

function readSalesforcePin() {
  try {
    const value = JSON.parse(readFileSync(path.join(REPO_ROOT, '.sf', 'config.json'), 'utf8'));
    return value['target-org'] || value.targetOrg || '';
  } catch {
    return '';
  }
}

function verifySalesforce() {
  const report = baseReport('salesforce', executableExists('sf'));
  if (!report.cliAvailable) return report;
  const display = runCaptured('salesforce', ['org', 'display', '--target-org', target('salesforce').profileName, '--json']);
  if (!display.ok) return { ...report, identityStatus: classifyFailedIdentity(display) };
  const parsed = safeJson(display.stdout);
  const organization = runCaptured('salesforce', [
    'data', 'query',
    '--target-org', target('salesforce').profileName,
    '--query', 'SELECT Id, IsSandbox FROM Organization LIMIT 1',
    '--json',
  ]);
  if (!organization.ok) return { ...report, identityStatus: classifyFailedIdentity(organization) };
  const orgParsed = safeJson(organization.stdout);
  const record = orgParsed?.result?.records?.[0];
  const exactIdentity = parsed?.result?.id === identifier('salesforce', 'Org ID')
    && parsed?.result?.connectedStatus === 'Connected'
    && record?.Id === identifier('salesforce', 'Org ID')
    && record?.IsSandbox === false;
  const exactPin = readSalesforcePin() === target('salesforce').profileName;
  return {
    ...report,
    identityStatus: exactIdentity ? 'verified' : 'mismatch',
    identityVerified: exactIdentity,
    targetPin: exactPin ? 'verified' : 'missing',
  };
}

export function verifyProvider(providerId) {
  ensureStateDirectories();
  switch (providerId) {
    case 'github': return verifyGitHub();
    case 'vercel': return verifyVercel();
    case 'supabase': return verifySupabase();
    case 'salesforce': return verifySalesforce();
    default: throw new Error(`Unsupported provider: ${providerId}`);
  }
}

function writeSafeStatus(reports) {
  const value = {
    schemaVersion: 1,
    profile: CONNECTION_PROFILE_NAME,
    generatedAt: new Date().toISOString(),
    browserProfile: APPROVED_CONNECTION_BROWSER_PROFILE,
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

function printReports(value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  console.log(`FCOS connection profile: ${value.profile}`);
  for (const report of Object.values(value.providers)) {
    const isolation = report.fullyIsolated ? 'isolated auth/config' : 'isolated target pin; protected host auth';
    console.log(`${report.provider}: ${report.identityStatus}; pin=${report.targetPin}; ${isolation}`);
  }
  console.log(`Safe local report: ${path.relative(REPO_ROOT, STATUS_PATH)}`);
}

function exitCodeFor(reports) {
  if (reports.every(({ identityStatus }) => identityStatus === 'verified')) return 0;
  if (reports.some(({ identityStatus }) => identityStatus === 'mismatch')) return 3;
  if (reports.some(({ identityStatus }) => identityStatus === 'unavailable')) return 4;
  return 2;
}

function verifyCommand(args) {
  const providers = selectedProviders(args.find((value) => !value.startsWith('--')));
  const reports = providers.map(verifyProvider);
  const value = writeSafeStatus(reports);
  printReports(value, args.includes('--json'));
  return exitCodeFor(reports);
}

function pinSupabase() {
  const current = verifySupabase();
  if (current.targetPin === 'verified') return true;
  const result = runCaptured('supabase', [
    'link',
    '--project-ref', identifier('supabase', 'Project ref'),
    '--yes',
  ]);
  return result.ok && verifySupabase().targetPin === 'verified';
}

function pinVercel() {
  const current = verifyVercel();
  if (current.targetPin === 'verified') return true;
  if (current.targetPin === 'mismatch') return false;
  const result = runCaptured('vercel', [
    'link',
    '--yes',
    '--team', identifier('vercel', 'Team ID'),
    '--project', identifier('vercel', 'Project ID'),
  ]);
  return result.ok && verifyVercel().targetPin === 'verified';
}

function pinSalesforce() {
  if (readSalesforcePin() === target('salesforce').profileName) return true;
  const result = runCaptured('salesforce', ['config', 'set', `target-org=${target('salesforce').profileName}`, '--json']);
  return result.ok && readSalesforcePin() === target('salesforce').profileName;
}

function bootstrapCommand(args) {
  const providers = selectedProviders(args.find((value) => !value.startsWith('--')));
  const initial = providers.map(verifyProvider);
  if (initial.some(({ identityStatus }) => identityStatus !== 'verified')) {
    const value = writeSafeStatus(initial);
    printReports(value, args.includes('--json'));
    console.error('Bootstrap stopped before target writes. Authenticate only providers marked authentication_blocked, then verify again.');
    return exitCodeFor(initial);
  }

  for (const providerId of providers) {
    if (providerId === 'vercel' && !pinVercel()) throw new Error('Vercel team and project link could not be pinned and verified.');
    if (providerId === 'supabase' && !pinSupabase()) throw new Error('Supabase target link could not be pinned and verified.');
    if (providerId === 'salesforce' && !pinSalesforce()) throw new Error('Salesforce target-org could not be pinned and verified.');
  }
  const final = providers.map(verifyProvider);
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
      const supplied = args[projectIndex].includes('=')
        ? args[projectIndex].split('=').slice(1).join('=')
        : args[projectIndex + 1];
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
        if (![target('salesforce').profileName, identifier('salesforce', 'Org ID')].includes(supplied)) {
          throw new Error('The Salesforce command targets an unapproved org.');
        }
      }
    }
  }
  return true;
}

function runCommand(args) {
  const providerId = args[0];
  if (!PROVIDER_IDS.has(providerId)) throw new Error('Choose github, vercel, supabase, or salesforce before --.');
  const separator = args.indexOf('--');
  const cliArgs = (separator >= 0 ? args.slice(separator + 1) : args.slice(1)).filter(Boolean);
  validateProviderArgs(providerId, cliArgs);
  const report = verifyProvider(providerId);
  writeSafeStatus([report]);
  if (report.identityStatus !== 'verified') {
    console.error(`${providerId}: ${report.identityStatus}. CLI command blocked before execution.`);
    return exitCodeFor([report]);
  }
  const runtime = providerRuntime(providerId);
  const result = spawnSync(runtime.command, [...cliArgs, ...runtime.injectedArgs], {
    cwd: REPO_ROOT,
    env: runtime.env,
    stdio: 'inherit',
  });
  return Number.isInteger(result.status) ? result.status : 1;
}

function authCommand(args) {
  const providerId = args[0];
  if (!PROVIDER_IDS.has(providerId)) throw new Error('Choose one provider to authenticate.');
  const current = verifyProvider(providerId);
  writeSafeStatus([current]);
  if (current.identityStatus === 'verified') {
    console.log(`${providerId}: the exact FCOS identity is already authenticated.`);
    return 0;
  }
  if (current.identityStatus === 'mismatch') {
    console.error(`${providerId}: identity mismatch. Authentication mutation is blocked.`);
    return 3;
  }
  if (current.identityStatus !== 'authentication_blocked') {
    console.error(`${providerId}: authentication cannot start from state ${current.identityStatus}.`);
    return exitCodeFor([current]);
  }
  console.log(`Authentication is allowed only in Chrome profile ${APPROVED_CONNECTION_BROWSER_PROFILE}; the CLI must be reverified immediately afterward.`);
  if (providerId === 'supabase') {
    console.log(`Create an access token only in ${APPROVED_CONNECTION_BROWSER_PROFILE}, store it as a 0600 file at ${target('supabase').configPath}/access-token, and never paste it into chat or source control.`);
  } else if (providerId === 'salesforce') {
    console.log(`Use Salesforce web login only in ${APPROVED_CONNECTION_BROWSER_PROFILE}, with alias ${target('salesforce').profileName}.`);
  } else {
    console.log(`Start the ${providerId} CLI login flow with automatic browser opening suppressed, then open its authorization URL only in ${APPROVED_CONNECTION_BROWSER_PROFILE}.`);
  }
  return 2;
}

function printHelp() {
  console.log(`Usage:
  npm run connections:verify [-- <provider>] [-- --json]
  npm run connections:bootstrap [-- <provider>]
  npm run connections:auth -- <provider>
  npm run connections:cli -- <provider> -- <provider CLI arguments>`);
}

export function main(argv = process.argv.slice(2)) {
  try {
    const [command, ...args] = argv;
    if (!command || command === 'help' || command === '--help') {
      printHelp();
      return 0;
    }
    if (command === 'verify') return verifyCommand(args);
    if (command === 'bootstrap') return bootstrapCommand(args);
    if (command === 'auth') return authCommand(args);
    if (command === 'run') return runCommand(args);
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Connection command failed safely.');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
