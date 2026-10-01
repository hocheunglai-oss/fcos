import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBuildProvenance } from './lib/build-provenance.mjs';
import { evaluatePreviewParity, PREVIEW_PARITY_POLICY } from './lib/preview-parity.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { canonicalFcosE2eCandidateUrl } from './verify-e2e-candidate.mjs';
import { releaseHash, releaseConfigurationRevision } from './lib/release-readiness.mjs';
import { collectTrustedReleaseEvidence, githubReleaseReads } from './lib/release-evidence.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const digest = value => createHash('sha256').update(value).digest('hex');
const immutable = value => { try { return canonicalFcosE2eCandidateUrl(value) === value; } catch { return false; } };
const unknown = () => ({ state: 'unknown' });

export function discoverParitySwitches(source) {
  const keys = new Set([...source.matchAll(/\b(?:FCOS_(?:ENABLE_|DISABLE_|ALLOW_NONPRODUCTION_)[A-Z0-9_]+|VITE_FCOS_ENABLE_[A-Z0-9_]+|VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED)\b/g)].map(match => match[0]));
  // Include generic future switches referenced directly through an environment
  // object, rather than depending only on the current FCOS naming convention.
  for (const match of source.matchAll(/(?:process\.env|import\.meta\.env|\benv|\benvironment)\s*(?:\??\.\s*([A-Z][A-Z0-9_]+)|(?:\?\.)?\s*\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\])/g)) {
    const key = match[1] || match[2];
    if (/(?:ENABL|DISABL|READ_ONLY|FEATURE|WORKFLOW)/.test(key)) keys.add(key);
  }
  for (const match of source.matchAll(/\benvName\s*:\s*['"]([A-Z][A-Z0-9_]+)['"]/g)) keys.add(match[1]);
  return [...keys].sort();
}

export function collectParitySource(cwd = ROOT) {
  const provenance = collectBuildProvenance({ cwd, env: {}, requireClean: true });
  const files = [], switches = new Set();
  function visit(directory) {
    for (const entry of readdirSync(join(cwd, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:js|jsx|mjs|ts|tsx)$/.test(path)) {
        files.push(path);
        const source = readFileSync(join(cwd, path), 'utf8');
        for (const key of discoverParitySwitches(source)) switches.add(key);
      }
    }
  }
  for (const directory of ['api', 'src', 'config']) visit(directory);
  const hashes = { application: provenance.sourceDigest,
    policy: digest(readFileSync(join(cwd, 'config/preview-parity-policy.json'))),
    connections: digest(readFileSync(join(cwd, 'config/fcosConnections.js'))),
    ciIdentity: digest(readFileSync(join(cwd, 'config/fcosCiIdentity.js'))) };
  return { candidateHead: provenance.commit, hashes,
    switchInventory: { keys: [...switches].sort(), sourceFiles: files.sort(), sourceHash: hashes.application } };
}

// Values remain private and in memory. The caller must serialize only the
// evaluator's name-only result, never these internal observations.
export function parseParityEnvironment(source, deployedKeys) {
  const parsed = {};
  for (const line of source.split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    parsed[match[1]] = value;
  }
  const deployed = new Set(deployedKeys);
  const credentials = new Set([...Object.keys(PREVIEW_PARITY_POLICY.applicationKeys.credentials), ...PREVIEW_PARITY_POLICY.applicationKeys.opaqueMatch]);
  return Object.fromEntries([...new Set([...Object.keys(parsed), ...deployedKeys])].map(key => {
    // Empty sensitive pulls are opaque. Presence never proves equality, or auth.
    const value = parsed[key];
    const record = !deployed.has(key) ? { state: 'unknown', present: false }
      : value === undefined ? { state: 'unknown', present: true }
      : credentials.has(key) || value === '' ? { state: 'unknown', present: true }
        : { state: 'known', value };
    return [key, record];
  }));
}

// Only use this after the transport has independently established the exact
// deployment origin. Unknown/expired tokens never trigger login or refresh.
export async function collectRuntimeObservation({ url, deployment, sourceDigest, token, protectionBypass, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!immutable(url) || url !== deployment?.url || !/^[0-9a-f]{64}$/.test(sourceDigest || '') || !token) return null;
  try {
    const endpoint = `${url}/api/connection-runtime`;
    const response = await fetchImpl(endpoint, { method: 'POST', body: JSON.stringify({ action: 'probe' }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`,
        ...(protectionBypass ? { 'x-vercel-protection-bypass': protectionBypass } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok || response.redirected || response.url && response.url !== endpoint) return null;
    const body = await response.json(), time = Date.parse(body.capturedAt);
    if (body.schemaVersion !== 1 || body.deploymentId !== deployment.id || body.sha !== deployment.sha || body.sourceDigest !== sourceDigest
      || !Number.isFinite(time) || time > now + 300000 || now - time > PREVIEW_PARITY_POLICY.maxAgeSeconds * 1000
      || time < (typeof deployment.createdAt === 'number' ? deployment.createdAt : Date.parse(deployment.createdAt))) return null;
    const flags = Object.fromEntries(PREVIEW_PARITY_POLICY.runtimeFlags.map(key => [key,
      body.flags?.[key]?.state === 'known' && typeof body.flags[key].value === 'boolean'
        ? { state: 'known', value: body.flags[key].value } : unknown()]));
    const auth = {};
    for (const provider of new Set([...PREVIEW_PARITY_POLICY.requiredAuth, ...Object.values(PREVIEW_PARITY_POLICY.applicationKeys.credentials)])) {
      const entry = body.auth?.[provider];
      if (entry?.state === 'authenticated' && typeof entry.target === 'string' && /^[A-Za-z0-9_@./:-]{1,200}$/.test(entry.target)
        && ['jwt', 'oauth', 'service_role', 'secret_key', 'api_key', 'oidc', 'application'].includes(entry.mode)) auth[provider] = { state: 'authenticated', target: entry.target, mode: entry.mode };
    }
    return { capturedAt: body.capturedAt, deploymentId: deployment.id, sha: deployment.sha, flags,
      safety: { readOnly: typeof body.safety?.readOnly === 'boolean' ? body.safety.readOnly : null,
        externalActions: Object.fromEntries(PREVIEW_PARITY_POLICY.externalActions.map(key => [key,
          typeof body.safety?.externalActions?.[key] === 'boolean' ? body.safety.externalActions[key] : null])) }, auth };
  } catch { return null; } // Transport errors can contain credentials; never echo them.
}

export function assertParityConnectionReadAccess(report, now = Date.now()) {
  const age = now - Date.parse(report?.observedAt || '');
  if (report?.identityVerified !== true || report.targetPin !== 'verified'
    || report.cliVersionStatus !== 'approved' || report.cliVersion !== '54.20.1'
    || report.observationMode !== 'live' || report.freshness !== 'current'
    || !Number.isFinite(age) || age < -300000 || age > 900000
    || !['project.read', 'deployment.read'].every(permission => report.permissions?.includes(permission)))
    throw new Error('Parity requires fresh target-locked Vercel CLI read access.');
  return true;
}

export async function collectPreviewParity({ candidateUrl, expectedCommit, protectionBypass = process.env.FCOS_E2E_VERCEL_BYPASS,
  productionRuntimeToken = process.env.FCOS_RELEASE_RUNTIME_TOKEN, candidateRuntimeToken = process.env.FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN, cwd = ROOT,
  connections } = {}) {
  if (!immutable(candidateUrl) || !/^[0-9a-f]{40}$/.test(expectedCommit || '')) throw new Error('Parity requires an immutable FCOS Preview URL and exact commit.');
  if (typeof connections?.verifyProvider !== 'function' || typeof connections?.providerRuntime !== 'function')
    throw new Error('Parity requires an explicitly supplied verified read-only provider adapter.');
  const source = collectParitySource(cwd);
  if (source.candidateHead !== expectedCommit) throw new Error('Parity checkout does not match the candidate commit.');
  const verified = await connections.verifyProvider('vercel', { persist: false, prepare: false });
  assertParityConnectionReadAccess(verified);
  const runtime = connections.providerRuntime('vercel', { prepare: false });
  const teamId = fcosConnectionIdentifier('vercel', 'Team ID'), projectId = fcosConnectionIdentifier('vercel', 'Project ID');
  const env = { ...runtime.env, VERCEL_ORG_ID: teamId, VERCEL_PROJECT_ID: projectId };
  function cli(args) {
    try {
      return execFileSync(runtime.command, [...args, ...runtime.injectedArgs],
        { cwd, env, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { throw new Error('Target-locked parity provider read failed; credential-bearing diagnostics suppressed.'); }
  }
  const api = path => JSON.parse(cli(['api', `${path}${path.includes('?') ? '&' : '?'}teamId=${teamId}`, '--method', 'GET', '--raw']));
  const project = api(`/v9/projects/${projectId}`);
  const [repositoryOwner, repositoryName] = fcosConnectionIdentifier('github', 'Repository').split('/');
  if (project.id !== projectId || project.accountId !== teamId || project.link?.repo !== repositoryName
    || project.link?.org !== repositoryOwner) throw new Error('Parity Vercel project or Git repository identity mismatch.');
  const productionId = project.targets?.production?.id;
  if (!productionId) throw new Error('Parity cannot resolve the current Production deployment independently.');
  const snapshots = {};
  // Native `vercel curl` can create a protection-bypass credential implicitly.
  // Fetch public assets through read-only HTTP instead, reusing only an existing
  // explicitly supplied bypass for the independently verified exact Preview.
  async function artifact(url, path, candidate) {
    try {
      const response = await fetch(`${url}${path}`, { redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: candidate && protectionBypass ? { 'x-vercel-protection-bypass': protectionBypass } : {} });
      return response.ok ? await response.text() : '';
    } catch { return ''; }
  }
  const directory = mkdtempSync(join(tmpdir(), 'fcos-parity-private-'));
  try {
    for (const [name, ref] of [['production', productionId], ['candidate', new URL(candidateUrl).hostname]]) {
      const deployment = api(`/v13/deployments/${ref}`);
      if (deployment.projectId !== projectId || deployment.name !== 'fcos' || deployment.teamId && deployment.teamId !== teamId) throw new Error('Parity deployment project identity mismatch.');
      const url = `https://${deployment.url}`;
      if (!immutable(url) || name === 'candidate' && (url !== candidateUrl || deployment.meta?.githubCommitSha !== expectedCommit || deployment.target === 'production')) throw new Error('Parity candidate deployment provenance mismatch.');
      const branch = deployment.meta?.githubCommitRef;
      if (name === 'candidate' && !branch) throw new Error('Parity cannot resolve Preview branch configuration.');
      const target = name === 'production' ? 'production' : 'preview';
      // Inspect independently reports Preview when the REST target is null.
      const inspected = JSON.parse(cli(['inspect', deployment.id, '--format=json']));
      if (inspected.target !== target || inspected.id !== deployment.id) throw new Error('Parity deployment environment mismatch.');
      const file = join(directory, `${name}.env`);
      cli(['env', 'pull', file, '--environment', target, ...(branch && target === 'preview' ? ['--git-branch', branch] : []), '--yes']);
      const metadata = JSON.parse(cli(['env', 'ls', target, '--format=json']));
      const entries = metadata.envs || metadata.environmentVariables || (Array.isArray(metadata) ? metadata : []);
      if (target === 'preview') {
        const branchMeta = JSON.parse(cli(['env', 'ls', target, branch, '--format=json']));
        entries.push(...(branchMeta.envs || branchMeta.environmentVariables || []));
      }
      if (!Array.isArray(deployment.env) || !deployment.env.length
        || deployment.env.some(key => typeof key !== 'string' || !/^[A-Z][A-Z0-9_]*(?:=|$)/.test(key))) throw new Error('Parity immutable deployment environment inventory unavailable.');
      const deployedKeys = deployment.env.map(key => key.split('=')[0]);
      const capturedAt = new Date().toISOString();
      const bound = { capturedAt, deploymentId: deployment.id, sha: deployment.meta?.githubCommitSha };
      const compiled = { ...bound, flags: Object.fromEntries(PREVIEW_PARITY_POLICY.compiledFlags.map(key => [key, unknown()])) };
      const html = await artifact(url, '/', name === 'candidate');
      const versionText = await artifact(url, '/app-version.json', name === 'candidate');
      let version;
      try { version = JSON.parse(versionText); } catch { /* Missing provenance stays unknown. */ }
      const sourceDigest = version?.commit === bound.sha && version?.provenance?.releaseEligible === true
        && /^[0-9a-f]{64}$/.test(version?.provenance?.sourceDigest || '') ? version.provenance.sourceDigest : null;
      if (name === 'candidate' && sourceDigest !== source.hashes.application) throw new Error('Parity candidate artifact source digest mismatch.');
      const asset = html.match(/src="(\/assets\/index-[^" ]+\.js)"/);
      if (asset) {
        const bundle = await artifact(url, asset[1], name === 'candidate');
        for (const [key, label] of [['VITE_FCOS_ENABLE_FCUNO_OIDC', 'fcunoOidcEnabled'], ['VITE_FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN', 'legacyPasswordLoginEnabled']]) {
          const value = bundle.match(new RegExp(`${label}:(![01]|true|false)(?=[,}])`))?.[1];
          if (value) compiled.flags[key] = { state: 'known', value: ['!0', 'true'].includes(value) };
        }
      }
      snapshots[name] = {
        deployment: { id: deployment.id, url, sha: bound.sha, state: deployment.readyState, target, createdAt: deployment.createdAt, teamId, projectId },
        env: { ...bound, updatedAt: entries.length ? Math.max(...entries.map(entry => Number(entry.updatedAt || entry.createdAt || 0))) : null,
          keys: parseParityEnvironment(readFileSync(file, 'utf8'), deployedKeys) }, compiled,
        // CLI deployment metadata cannot establish executed runtime flags,
        // normal-user rendering or provider authentication. Leave those unknown.
        runtime: { ...bound, flags: Object.fromEntries(PREVIEW_PARITY_POLICY.runtimeFlags.map(key => [key, unknown()])), safety: {}, auth: {} },
      };
      snapshots[name].runtime = await collectRuntimeObservation({ url, deployment: snapshots[name].deployment, sourceDigest,
        token: name === 'candidate' ? candidateRuntimeToken : productionRuntimeToken,
        protectionBypass: name === 'candidate' ? protectionBypass : undefined }) || snapshots[name].runtime;
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const observations = { schemaVersion: 1, provider: { provider: 'vercel', account: fcosConnectionIdentifier('vercel', 'Account'), teamId, projectId,
    repository: fcosConnectionIdentifier('github', 'Repository') }, source, switchInventory: source.switchInventory, ...snapshots,
    coverage: { capturedAt: new Date().toISOString(), deploymentId: snapshots.candidate.deployment.id, sha: snapshots.candidate.deployment.sha, checks: [] } };
  const lockHash = releaseHash(readFileSync(join(cwd, 'package-lock.json'))), configurationRevision = releaseConfigurationRevision(cwd);
  const binding = { sha: expectedCommit, sourceDigest: source.hashes.application, lockHash, configurationRevision,
    deploymentId: snapshots.candidate.deployment.id, candidateUrl };
  let trusted = { records: [], blockers: [{ code: 'TRUSTED_COLLECTOR_UNAVAILABLE', scope: 'coverage' }], quality: null };
  try {
    const github = await connections.verifyProvider('github', { persist: false, prepare: false });
    if (github.identityVerified !== true || github.targetPin !== 'verified' || !github.permissions?.includes('repository.read')) throw new Error('unverified');
    trusted = await collectTrustedReleaseEvidence({ reads: githubReleaseReads(connections.providerRuntime('github', { prepare: false }), { cwd }), binding });
    const coverage = trusted.records.find(record => record.kind === 'normal_role');
    if (coverage) observations.coverage = { capturedAt: coverage.capturedAt, deploymentId: coverage.deploymentId, sha: coverage.sha, checks: coverage.checks };
  } catch { /* Fail closed on unavailable independent transport or protections. */ }
  const result = evaluatePreviewParity(observations, { expectedCommit, sourceHashes: source.hashes });
  result.blockers.push(...trusted.blockers);
  result.pass = result.blockers.length === 0;
  // Emit only exact-bound public identities and names-only blockers; never raw
  // environment observations, tokens, downloaded configuration or auth values.
  return { ...result, capturedAt: new Date().toISOString(), binding: { ...binding, url: candidateUrl }, source,
    candidate: { ...snapshots.candidate.deployment, sourceDigest: source.hashes.application, lockHash, configurationRevision },
    production: snapshots.production.deployment,
    expectedRuntimeAuth: Object.fromEntries(PREVIEW_PARITY_POLICY.requiredAuth.map(provider => [provider, snapshots.production.runtime.auth?.[provider] || { state: 'unknown' }])),
    expectedRuntimeFlags: snapshots.production.runtime.flags,
    expectedRuntimeSafety: snapshots.production.runtime.safety,
    trustedEvidence: trusted.records.map(({ checks, ...record }) => record), quality: trusted.quality };
}

export async function assertCollectedPreviewParity(options) {
  const result = await collectPreviewParity(options);
  if (!result.pass) throw Object.assign(new Error(`Preview parity blocked (${result.blockers.length}): ${result.blockers.map(row => row.message).join(' ')}`), { code: 'PREVIEW_PARITY_BLOCKED', result });
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectPreviewParity({ candidateUrl: process.env.FCOS_E2E_CANDIDATE_URL, expectedCommit: process.env.FCOS_E2E_EXPECTED_COMMIT })
    .then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.pass) process.exitCode = 1; })
    .catch(() => { console.error('Preview parity collection failed. Verify a clean exact-commit checkout and target-locked provider access.'); process.exitCode = 1; });
}
