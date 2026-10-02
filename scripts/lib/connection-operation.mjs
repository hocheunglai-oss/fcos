import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier, fcosConnectionProvider, fcosSalesforceEnvironment } from '../../config/fcosConnections.js';

const permitted = new Set(['github', 'vercel', 'supabase', 'salesforce']);
const environments = new Set(['tooling', 'development', 'preview', 'production', 'devee', 'qat']);
const repo = () => fcosConnectionIdentifier('github', 'Repository');
const vercelProject = () => fcosConnectionIdentifier('vercel', 'Project ID');
const vercelTeam = () => fcosConnectionIdentifier('vercel', 'Team ID');

export class ConnectionOperationError extends Error {
  constructor(code, message) { super(message); this.name = 'ConnectionOperationError'; this.code = code; }
}
const reject = (code, message) => { throw new ConnectionOperationError(code, message); };
const key = (arg) => arg.split('=')[0].toLowerCase();

function options(args) {
  const flags = new Map();
  const words = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('-')) { words.push(arg); continue; }
    const name = key(arg);
    if (flags.has(name)) reject('duplicate_option', 'Duplicate command options are blocked.');
    let value = true;
    const equal = arg.indexOf('=');
    if (equal >= 0) value = arg.slice(equal + 1);
    else if (args[i + 1] && !args[i + 1].startsWith('-')) value = args[++i];
    flags.set(name, value);
  }
  return { flags, words };
}
function validateBasics(provider, args) {
  if (!permitted.has(provider)) reject('unknown_provider', 'Unknown managed connection provider.');
  if (!Array.isArray(args) || !args.length || args.some((arg) => typeof arg !== 'string' || !arg || /[\0\r\n]/.test(arg))) reject('invalid_arguments', 'Provide valid provider CLI arguments after --.');
  const secret = new Set(['--token', '-t', '--password', '-p', '--client-secret', '--with-token', '--show-token', '--access-token', '--auth-url', '--session-id']);
  if (args.some((arg) => secret.has(key(arg)) && !(provider === 'salesforce' && key(arg) === '-t'))) reject('secret_flag', 'Secret-bearing CLI flags are blocked.');
  if (args.some((arg) => ['login', 'logout'].includes(arg.toLowerCase()))) reject('authentication_command', 'Login and logout are blocked; use the explicit authentication workflow.');
  if (provider === 'github' && args[0] === 'auth' && args[1] === 'token') reject('secret_output', 'Commands that reveal GitHub tokens are blocked.');
  if (provider === 'salesforce' && ((args[0] === 'org' && ['display', 'open'].includes(args[1])) || args.includes('force:org:display'))) {
    if (args[1] === 'open') reject('verified_browser_required', 'Generic Chrome launch is blocked. Inventory and verify the environment-pinned Chrome profile through the managed browser session before opening a task-owned tab.');
    reject('secret_output', 'Salesforce commands that expose access tokens or auth URLs are blocked.');
  }
  const overrides = provider === 'github' ? ['--hostname', '--host', '--config', '--config-dir', '--cwd', '--cache', '--include']
    : provider === 'vercel' ? ['--global-config', '-q', '--scope', '-s', '--team', '--cwd', '--project', '--project-id', '--org-id', '--local-config', '--config', '-a', '--api-url']
      : provider === 'supabase' ? ['--profile', '--workdir', '--db-url', '--dns-resolver', '--network-id', '--experimental']
        : ['--target-dev-hub', '-v', '--instance-url', '--login-url', '--api-version', '--loglevel'];
  if (args.some((arg) => overrides.includes(key(arg)))) reject('target_override', `${provider} target/config overrides are blocked; the wrapper injects approved values.`);
  const parsed = options(args);
  if (provider === 'github') {
    for (const selector of ['--repo', '-r']) if (parsed.flags.has(selector) && parsed.flags.get(selector) !== repo()) reject('target_mismatch', 'The GitHub command targets a repository outside the approved FCOS repository.');
    for (const word of parsed.words) if (/github\.com[:/]/i.test(word) && ![repo(), `${repo()}.git`].includes(word.replace(/^(?:https:\/\/github\.com\/|git@github\.com:)/i, ''))) reject('target_mismatch', 'The GitHub command targets a repository outside the approved FCOS repository.');
  }
  if (provider === 'supabase' && parsed.flags.has('--project-ref') && parsed.flags.get('--project-ref') !== fcosConnectionIdentifier('supabase', 'Project ref')) reject('target_mismatch', 'The Supabase command targets an unapproved project ref.');
  if (provider === 'salesforce') {
    const allowed = new Set(fcosConnectionProvider('salesforce').environments.flatMap((env) => [env.alias, env.orgId]));
    for (const selector of ['--target-org', '-o']) if (parsed.flags.has(selector) && !allowed.has(parsed.flags.get(selector))) reject('target_mismatch', 'The Salesforce command targets an unapproved org.');
    if (parsed.flags.has('--target-org') && parsed.flags.has('-o')) reject('duplicate_target', 'Multiple Salesforce target selectors are blocked.');
  }
  return parsed;
}
function allowedFlags(flags, names) {
  for (const name of flags.keys()) if (!names.includes(name)) reject('unknown_option', 'Unknown command options are blocked for this managed operation.');
}
function readEndpoint(provider, endpoint) {
  if (typeof endpoint !== 'string' || !endpoint || /[\\#\s]/.test(endpoint) || /%(?:2e|2f|5c|00|0a|0d)/i.test(endpoint)) reject('invalid_endpoint', 'API endpoint must be an approved relative path without encoded target overrides.');
  if (/^[a-z]+:/i.test(endpoint) || endpoint.startsWith('//')) reject('invalid_endpoint', 'Absolute API URLs are blocked; use an approved relative endpoint.');
  const parsed = new URL(endpoint.replace(/^\//, ''), 'https://policy.invalid/');
  if (endpoint.split(/[/?]/).includes('..') || endpoint.split(/[/?]/).includes('.')) reject('invalid_endpoint', 'API endpoint traversal is blocked.');
  const path = parsed.pathname;
  const query = parsed.searchParams;
  if (provider === 'github') {
    const prefix = `/repos/${repo()}`;
    if (path !== '/user' && path !== prefix && !path.startsWith(`${prefix}/`)) reject('target_mismatch', 'GitHub API endpoint is outside the approved FCOS repository.');
    if (/\/(?:zip|logs)$/.test(path)) reject('controlled_export_required', 'Binary archives and raw logs require the controlled collector.');
    const tail = path.slice(prefix.length);
    if (path !== '/user' && !/^(?:|\/pulls(?:\/\d+(?:\/(?:files|commits|reviews))?)?|\/actions\/(?:runs(?:\/\d+(?:\/(?:jobs|artifacts|logs))?)?|artifacts(?:\/\d+(?:\/zip)?)?|workflows(?:\/[^/]+(?:\/runs)?)?)|\/branches(?:\/[^/]+(?:\/protection)?)?|\/environments(?:\/[^/]+)?|\/commits(?:\/[^/]+(?:\/(?:status|check-runs))?)?|\/collaborators\/[^/]+\/permission)$/.test(tail)) reject('unknown_endpoint', 'This GitHub API endpoint is not a managed read operation.');
    for (const name of query.keys()) if (!['page', 'per_page', 'status', 'branch', 'head_sha', 'event', 'state', 'ref'].includes(name)) reject('unknown_query', 'Unknown API query options are blocked.');
  } else if (provider === 'vercel') {
    const project = vercelProject();
    const exactProject = new RegExp(`^/v\\d+/projects/${project}(?:/env(?:/[^/]+)?)?$`);
    if (!exactProject.test(path) && !/^\/v\d+\/deployments(?:\/[^/]+)?$/.test(path)) reject('target_mismatch', 'Vercel API endpoint is outside the approved FCOS project.');
    for (const name of query.keys()) if (!['teamId', 'projectId', 'limit', 'until', 'since', 'target', 'decrypt'].includes(name)) reject('unknown_query', 'Unknown API query options are blocked.');
    for (const selector of ['teamId', 'projectId']) if (query.getAll(selector).length > 1) reject('duplicate_target', 'Duplicate API target selectors are blocked.');
    if (query.has('teamId') && query.get('teamId') !== vercelTeam()) reject('target_mismatch', 'Vercel API team does not match the approved target.');
    if (query.has('projectId') && query.get('projectId') !== project) reject('target_mismatch', 'Vercel API project does not match the approved target.');
    if (/\/env/.test(path)) reject('private_export_required', 'Private environment reads require the controlled in-memory configuration collector.');
    if (/\/deployments$/.test(path) && query.get('projectId') !== project) reject('target_missing', 'Deployment list reads require the exact projectId.');
  }
  return { endpoint, resource: provider === 'vercel' && /^\/v\d+\/deployments\/[^/]+$/.test(path) ? path.split('/').at(-1) : null };
}

function infer(provider, args, parsed) {
  const { words, flags } = parsed;
  const common = ['--json', '--jq', '--template', '--repo', '-r', '--limit', '-l', '--state', '--branch', '--commit', '--status', '--page', '--per-page'];
  if (provider === 'github') {
    if (args[0] === 'api') {
      allowedFlags(flags, ['--method', '-x']);
      if (words.length !== 2) reject('invalid_arguments', 'GitHub API read requires one endpoint.');
      if (flags.has('--method') && flags.has('-x')) reject('duplicate_option', 'Multiple API methods are blocked.');
      if (String(flags.get('--method') || flags.get('-x') || 'GET').toUpperCase() !== 'GET') reject('controlled_write_required', 'API writes require the existing controlled workflow.');
      return { operation: 'github.api.read', capability: 'repository.read', ...readEndpoint(provider, words[1]) };
    }
    if (words[0] === 'repo' && words[1] === 'view') {
      allowedFlags(flags, ['--json', '--jq', '--template', '--repo', '-r']);
      if (words.length > 3 || words[2] && words[2] !== repo()) reject('target_mismatch', 'The GitHub command targets a repository outside the approved FCOS repository.');
      return { operation: 'github.repository.read', capability: 'repository.read' };
    }
    if (['pr', 'run', 'workflow'].includes(words[0]) && ['view', 'list', 'diff', 'checks', 'watch'].includes(words[1])) {
      allowedFlags(flags, [...common, '--exit-status', '--interval', '--name', '-n', '--patch', '--include-disabled']);
      if (words.length > 3 || words[2] && !/^(?:\d+|[A-Za-z0-9_.-]+)$/.test(words[2])) reject('invalid_arguments', 'Managed GitHub reads require a local resource identifier.');
      return { operation: `github.${words[0]}.read`, capability: 'repository.read' };
    }
  } else if (provider === 'vercel') {
    if (words[0] === 'api') {
      allowedFlags(flags, ['--method', '-x']);
      if (words.length !== 2) reject('invalid_arguments', 'Vercel API read requires one endpoint.');
      if (flags.has('--method') && flags.has('-x')) reject('duplicate_option', 'Multiple API methods are blocked.');
      if (String(flags.get('--method') || flags.get('-x') || 'GET').toUpperCase() !== 'GET') reject('controlled_write_required', 'API writes require the existing controlled workflow.');
      return { operation: 'vercel.api.read', capability: /deployments/.test(words[1]) ? 'deployment.read' : 'project.read', ...readEndpoint(provider, words[1]) };
    }
    if (words[0] === 'curl') reject('controlled_write_required', 'Vercel curl may create bypass credentials and is blocked.');
    allowedFlags(flags, ['--no-color', '--environment', '--target', '--limit', '--yes', '--listen', '-l', '--port']);
    if (words[0] === 'whoami' && words.length === 1) return { operation: 'vercel.identity.read', capability: 'project.read' };
    if (words[0] === 'project' && words[1] === 'inspect' && words[2] === fcosConnectionIdentifier('vercel', 'Project') && words.length === 3) return { operation: 'vercel.project.read', capability: 'project.read' };
    if (['list', 'ls'].includes(words[0]) && words.length <= 2 && (!words[1] || words[1] === fcosConnectionIdentifier('vercel', 'Project'))) return { operation: 'vercel.deployments.read', capability: 'deployment.read' };
    if (words[0] === 'inspect' && words.length === 2 && /^(?:dpl_[A-Za-z0-9]+|[A-Za-z0-9.-]+\.vercel\.app)$/.test(words[1])) return { operation: 'vercel.deployment.read', capability: 'deployment.read', resource: words[1] };
    if (words[0] === 'dev' && words.length === 1) return { operation: 'vercel.development.local', capability: 'project.read', localWrite: true };
    if (['deploy', 'redeploy', 'promote', 'rollback', 'env', 'link', 'pull', 'build'].includes(words[0])) reject('controlled_write_required', 'Vercel mutations and configuration exports require the existing controlled workflow.');
  } else if (provider === 'supabase') {
    allowedFlags(flags, ['--output-format', '-o', '--project-ref', '--linked', '--local']);
    if (words.length === 2 && words[0] === 'projects' && words[1] === 'list') return { operation: 'supabase.projects.read', capability: 'project.read' };
    if (words.length === 2 && words[0] === 'migration' && words[1] === 'list' && !flags.has('--local')) return { operation: 'supabase.migrations.read', capability: 'project.read' };
    if (words[0] === 'db' || words[0] === 'link') reject('controlled_write_required', 'Supabase mutations and private exports require the approved migration workflow.');
  } else if (provider === 'salesforce') {
    allowedFlags(flags, ['--target-org', '-o', '--query', '-q', '--json', '--result-format', '-r', '--use-tooling-api', '-t', '--job-id', '-i', '--test-run-id', '--code-coverage', '--wait', '-w']);
    if (words.length === 2 && words[0] === 'data' && words[1] === 'query') {
      const query = flags.get('--query') || flags.get('-q');
      if (query !== undefined && (typeof query !== 'string' || !/^select\s/i.test(query.trim()) || /;/.test(query))) reject('invalid_query', 'Managed Salesforce query requires one SELECT query.');
      return { operation: 'salesforce.data.read', capability: 'data.query' };
    }
    if (words.join(' ') === 'project deploy report' || words.join(' ') === 'project deploy quick report') return { operation: 'salesforce.deployment.read', capability: 'organization.read' };
    if (words.join(' ') === 'apex get test') return { operation: 'salesforce.tests.read', capability: 'organization.read' };
    reject('controlled_write_required', 'Salesforce metadata, financial and data actions require their existing controlled workflow.');
  }
  reject('unknown_operation', 'Unknown managed connection operation; add a reviewed command-specific policy before execution.');
}

export function describeConnectionOperation(provider, args) {
  return { provider, ...infer(provider, args, validateBasics(provider, args)) };
}

export function validateConnectionOperation(context, args) {
  if (!context || typeof context !== 'object' || !context.provider || !context.environment || !context.operation || !context.capability) reject('context_required', 'Managed operations require provider, environment, operation and capability.');
  if (!environments.has(context.environment)) reject('unknown_environment', 'Unknown managed connection environment.');
  const description = describeConnectionOperation(context.provider, args);
  if (context.operation !== description.operation || context.capability !== description.capability) reject('operation_mismatch', 'Operation context does not match the command-specific operation and capability.');
  if (context.provider === 'salesforce') {
    if (!['devee', 'qat', 'production'].includes(context.environment)) reject('unknown_environment', 'Salesforce operations require an exact approved org environment.');
    const org = fcosSalesforceEnvironment(context.environment);
    const parsed = options(args);
    const selected = parsed.flags.get('--target-org') || parsed.flags.get('-o');
    if (selected && ![org.alias, org.orgId].includes(selected)) reject('target_mismatch', 'Salesforce command target does not match operation environment.');
    description.requiredPermission = `${org.key}.${description.capability}`;
    description.target = { orgId: org.orgId, username: org.username, isSandbox: org.isSandbox };
  } else {
    if (['devee', 'qat'].includes(context.environment)) reject('unknown_environment', 'Sandbox org environments are Salesforce only.');
    description.requiredPermission = description.capability;
    description.target = context.provider === 'github' ? { repository: repo() }
      : context.provider === 'vercel' ? { projectId: vercelProject(), teamId: vercelTeam() }
        : { projectRef: fcosConnectionIdentifier('supabase', 'Project ref') };
  }
  const parsedOptions = options(args).flags;
  for (const selector of ['--environment', '--target']) if (parsedOptions.has(selector) && !['tooling', String(parsedOptions.get(selector))].includes(context.environment)) reject('environment_mismatch', 'Command environment does not match the operation context.');
  if (description.localWrite && context.environment !== 'development') reject('environment_mismatch', 'Local development requires the development environment.');
  if (context.readOnly === true && description.localWrite) reject('read_only_operation', 'Read-only diagnostics cannot start local development.');
  return Object.freeze({ ...description, environment: context.environment });
}

export function assertConnectionOperationAccess(operation, report, { now = new Date() } = {}) {
  if (!report || report.credentialLifecycle === 'expired' || report.provider !== operation.provider || report.identityVerified !== true || report.identityStatus !== 'verified' || report.targetPin !== 'verified' || !['approved', 'warning'].includes(report.cliVersionStatus)) reject('identity_not_verified', 'Fresh exact identity, target and compatible CLI are required before execution.');
  const verifiedAt = Date.parse(report.observedAt || report.lastVerifiedAt || '');
  const age = now.getTime() - verifiedAt;
  if (!Number.isFinite(age) || age < -FCOS_CONNECTION_POLICY.attestation.maxClockSkewSeconds * 1000 || age > FCOS_CONNECTION_POLICY.attestation.freshnessSeconds * 1000 || report.observationMode === 'cached') reject('evidence_expired', 'Connection identity evidence is expired, cached or missing.');
  if (!(report.permissions || []).includes(operation.requiredPermission)) reject('capability_missing', 'The operation-specific capability has not been independently observed.');
  return true;
}

// Generic API reads print this fixed projection only. Credential-bearing fields,
// arbitrary --jq/raw output, archives and provider errors remain private.
export function sanitizeConnectionOperationOutput(operation, payload) {
  const scalar = (source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    const result = {};
    for (const name of ['id', 'projectId', 'teamId', 'ownerId', 'accountId']) {
      const value = source[name];
      if (Number.isSafeInteger(value) && value >= 0) result[name] = value;
      else if (typeof value === 'string' && /^(?:dpl_|prj_|team_)[A-Za-z0-9]+$/.test(value)) result[name] = value;
    }
    for (const name of ['head_sha', 'sha', 'digest']) if (typeof source[name] === 'string' && /^(?:sha256:)?[0-9a-f]{40,64}$/.test(source[name])) result[name] = source[name];
    for (const name of ['status', 'conclusion', 'readyState', 'target']) if (['queued', 'in_progress', 'completed', 'success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'READY', 'ERROR', 'BUILDING', 'QUEUED', 'CANCELED', 'production', 'preview', 'development'].includes(source[name])) result[name] = source[name];
    for (const name of ['expired', 'private']) if (typeof source[name] === 'boolean') result[name] = source[name];
    if (source.permissions && typeof source.permissions === 'object') result.permissions = Object.fromEntries(['pull', 'push', 'admin', 'maintain', 'triage'].filter((name) => typeof source.permissions[name] === 'boolean').map((name) => [name, source.permissions[name]]));
    if (source.login === fcosConnectionIdentifier('github', 'Required account')) result.login = source.login;
    if (source.full_name === repo()) result.full_name = source.full_name;
    if (typeof source.url === 'string' && /^[a-z0-9.-]+\.vercel\.app$/.test(source.url)) result.url = source.url;
    if (source.workflow_run && typeof source.workflow_run === 'object') result.workflow_run = scalar(source.workflow_run);
    return result;
  };
  if (!operation?.operation?.endsWith('.api.read')) reject('projection_operation_invalid', 'Safe API projection requires a managed API read.');
  const result = scalar(payload);
  for (const name of ['deployments', 'workflow_runs', 'artifacts', 'jobs', 'environments']) if (Array.isArray(payload?.[name])) result[name] = payload[name].map(scalar);
  if (Array.isArray(payload)) return payload.map(scalar);
  return result;
}
