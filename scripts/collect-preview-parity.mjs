import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBuildProvenance } from './lib/build-provenance.mjs';
import { evaluatePreviewParity, PREVIEW_PARITY_POLICY } from './lib/preview-parity.mjs';
import { verifyProvider, providerCliRunnable, providerRuntime } from './fcos-connections.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { canonicalFcosE2eCandidateUrl } from './verify-e2e-candidate.mjs';

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

export async function collectPreviewParity({ candidateUrl, expectedCommit, protectionBypass = process.env.FCOS_E2E_VERCEL_BYPASS, cwd = ROOT } = {}) {
  if (!immutable(candidateUrl) || !/^[0-9a-f]{40}$/.test(expectedCommit || '')) throw new Error('Parity requires an immutable FCOS Preview URL and exact commit.');
  const source = collectParitySource(cwd);
  if (source.candidateHead !== expectedCommit) throw new Error('Parity checkout does not match the candidate commit.');
  const verified = await verifyProvider('vercel');
  if (!providerCliRunnable(verified) || verified.targetPin !== 'verified') throw new Error('Parity requires verified target-locked Vercel CLI access.');
  const runtime = providerRuntime('vercel');
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
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const observations = { schemaVersion: 1, provider: { provider: 'vercel', account: fcosConnectionIdentifier('vercel', 'Account'), teamId, projectId,
    repository: fcosConnectionIdentifier('github', 'Repository') }, source, switchInventory: source.switchInventory, ...snapshots,
    coverage: { capturedAt: new Date().toISOString(), deploymentId: snapshots.candidate.deployment.id, sha: snapshots.candidate.deployment.sha, checks: [] } };
  return evaluatePreviewParity(observations, { expectedCommit, sourceHashes: source.hashes });
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
