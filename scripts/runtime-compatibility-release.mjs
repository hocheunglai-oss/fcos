import { LEGACY_EMAIL_BASELINE_CONTRACT_HASH, collectLegacyEmailBaselineEvidence } from './lib/legacy-email-baseline-proof.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, lstatSync, existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { isDeploymentReadOnly, externalActionGates, fcunoFederationConfig, serverSupabaseConfig, supabaseDiagnosticCredentialMode } from './lib/runtime-compatibility-observation.mjs';
import { collectBuildProvenance } from './lib/build-provenance.mjs';
import { collectRuntimeObservation, discoverParitySwitches, parseParityEnvironment } from './collect-preview-parity.mjs';
import { githubReleaseReads, assertReleaseGitHubAccount, collectTrustedReleaseEvidence, RELEASE_REPOSITORY } from './lib/release-evidence.mjs';
import { githubReleaseOidc, assertVercelProductionAuthority, assertProductionRuntimeReadback, readVercelTokenMetadata } from './lib/release-production.mjs';
import { releaseHash, createReleaseReadiness } from './lib/release-readiness.mjs';
import { evaluatePreviewParity, PREVIEW_PARITY_POLICY } from './lib/preview-parity.mjs';
import { verifyRuntimeCompatibility } from './verify-runtime-compatibility.mjs';
import { canonicalFcosE2eCandidateUrl } from './verify-e2e-candidate.mjs';
import { FIRST_RUNTIME_ROLLOUT, COMPATIBILITY_ENVIRONMENT, assertRuntimeCompatibilityWorkflowIdentity,
  assertRuntimeCompatibilityProtection, createRuntimeCompatibilityPreflight, runtimeCompatibilityControlRevision,
  immutableCompatibilityBaseline, executeRuntimeCompatibilityRelease, collectCompatibilityNormalEvidence,
  collectCompatibilityQualityEvidence, compatibilityUpstreamQuality, assertCompatibilityEvidenceReadback, compatibilityReadOnlyGuardsVerified } from './lib/runtime-compatibility-release.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const command = (binary, args, options = {}) => {
  try { return execFileSync(binary, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], ...options }); }
  catch { throw new Error('Pinned compatibility command failed; private diagnostics suppressed.'); }
};
export function runtimeCompatibilityReleaseArguments(args, env = process.env) {
  if (args.length > 1 || args.some(arg => !['--dry-run', '--preflight', '--execute', '--collect-quality'].includes(arg))) throw new Error('Use one protected compatibility mode only.');
  return { mode: args[0]?.slice(2) || 'dry-run', candidateCwd: resolve(env.FCOS_RELEASE_SOURCE_DIRECTORY || ROOT),
    expectedCommit: env.FCOS_E2E_EXPECTED_COMMIT, candidateUrl: env.FCOS_E2E_CANDIDATE_URL };
}
async function artifact(url, path, protectionBypass, fetchImpl = fetch) {
  const response = await fetchImpl(`${url}${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: protectionBypass ? { 'x-vercel-protection-bypass': protectionBypass } : {} });
  if (!response.ok || response.redirected || response.url && response.url !== `${url}${path}`) throw new Error('Exact immutable artifact unavailable.');
  return response.text();
}
async function compiledFlags(url, bound, protectionBypass) {
  const flags = Object.fromEntries(PREVIEW_PARITY_POLICY.compiledFlags.map(key => [key, { state: 'unknown' }]));
  const html = await artifact(url, '/', protectionBypass), asset = html.match(/src="(\/assets\/index-[^" ]+\.js)"/);
  if (asset) {
    const bundle = await artifact(url, asset[1], protectionBypass);
    for (const [key, label] of [['VITE_FCOS_ENABLE_FCUNO_OIDC', 'fcunoOidcEnabled'], ['VITE_FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN', 'legacyPasswordLoginEnabled']]) {
      const value = bundle.match(new RegExp(`${label}:(![01]|true|false)(?=[,}])`))?.[1];
      if (value) flags[key] = { state: 'known', value: ['!0', 'true'].includes(value) };
    }
  }
  return { ...bound, flags };
}
const parseEnvironment = text => Object.fromEntries(text.split('\n').flatMap(line => {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/); if (!match) return [];
  const value = match[2]; return [[match[1], value.startsWith('"') ? JSON.parse(value) : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value]];
}));

/** Independent existing-session GETs plus byte-verified pure baseline helpers.
 * The legacy receipt is never patched and no previous endpoint is simulated.
 * This is a deployment-configuration evaluation, not an executed endpoint claim.
 */
export async function collectCompatibilityBaselineRuntime({ deployment, privateEnvironment, baseline, fetchImpl = fetch, now = Date.now(), clientFactory = createClient }) {
  if (baseline?.helperSourceVerified !== true || baseline.sha !== FIRST_RUNTIME_ROLLOUT.previousSha
    || deployment?.id !== FIRST_RUNTIME_ROLLOUT.previousDeploymentId || deployment.sha !== baseline.sha
    || deployment.url !== FIRST_RUNTIME_ROLLOUT.previousUrl || privateEnvironment.VERCEL_ENV !== 'production') throw new Error('Exact independently verified baseline source and deployment configuration required.');
  const unknown = (target = '', mode = '') => ({ state: 'unknown', target, mode });
  const get = async (url, headers) => { const r = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!r.ok || r.redirected || r.url && r.url !== url) return null; return r.json(); };
  const attempt = async (target, mode, work) => { try { return await work() ? { state: 'authenticated', target, mode } : unknown(target, mode); } catch { return unknown(target, mode); } };
  const config = serverSupabaseConfig(privateEnvironment), ref = fcosConnectionIdentifier('supabase', 'Project ref');
  const supabaseUrl = `https://${ref}.supabase.co`, sf = fcosSalesforceEnvironment('production');
  const mode = supabaseDiagnosticCredentialMode(config.key, now);
  const supabase = config.url === supabaseUrl && mode ? await attempt(ref, mode, async () => Array.isArray(await get(`${supabaseUrl}/rest/v1/user_profiles?select=id&limit=1`,
    { apikey: config.key, ...(mode === 'service_role' ? { authorization: `Bearer ${config.key}` } : {}) }))) : unknown(ref);
  const salesforce = privateEnvironment.SALESFORCE_INSTANCE_URL === sf.instanceUrl && privateEnvironment.SALESFORCE_ACCESS_TOKEN
    ? await attempt(sf.orgId, 'oauth', async () => {
      const version = /^v\d+\.\d+$/.test(privateEnvironment.SALESFORCE_API_VERSION || '') ? privateEnvironment.SALESFORCE_API_VERSION : 'v67.0';
      const data = await get(`${sf.instanceUrl}/services/data/${version}/query?q=${encodeURIComponent('SELECT Id, IsSandbox FROM Organization LIMIT 1')}`,
        { authorization: `Bearer ${privateEnvironment.SALESFORCE_ACCESS_TOKEN}` });
      return data?.records?.length === 1 && data.records[0].Id === sf.orgId && data.records[0].IsSandbox === false;
    }) : unknown(sf.orgId);
  const tenant = privateEnvironment.XERO_TENANT_ID;
  const xero = supabase.state === 'authenticated' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant || '')
    ? await attempt(tenant, 'oauth', async () => {
      const client = clientFactory(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.from('xero_contact_sync_connections').select('tenant_id,access_token,expires_at').eq('id', 'primary').maybeSingle();
      if (error || data?.tenant_id !== tenant || !data.access_token || !Number.isFinite(Date.parse(data.expires_at || '')) || Date.parse(data.expires_at) <= now + 90000) return false;
      const rows = await get('https://api.xero.com/connections', { authorization: `Bearer ${data.access_token}` });
      return Array.isArray(rows) && rows.some(row => row.tenantId === tenant && row.tenantType === 'ORGANISATION');
    }) : unknown(tenant || '');
  const federation = fcunoFederationConfig(privateEnvironment);
  return { capturedAt: new Date(now).toISOString(), deploymentId: deployment.id, sha: deployment.sha,
    flags: { VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED: { state: 'known', value: String(privateEnvironment.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED || '').trim().toLowerCase() === 'true' },
      FCOS_ENABLE_FCUNO_FEDERATION: { state: 'known', value: federation.federationEnabled }, FCOS_ENABLE_FCUNO_IDENTITY_SYNC: { state: 'known', value: federation.syncEnabled },
      FCOS_ENABLE_FCUNO_LEGACY_PASSWORD_LOGIN: { state: 'known', value: federation.legacyPasswordEnabled } },
    safety: { readOnly: isDeploymentReadOnly(privateEnvironment), externalActions: Object.fromEntries(Object.entries(externalActionGates(privateEnvironment)).map(([key, gate]) => [key, gate.enabled])) },
    auth: { supabase, salesforce, xero, drive: unknown(), fcuno: unknown(), microsoft: unknown(), openai: unknown() } };
}

function sourceInventory(cwd, sourceDigest) {
  const files = [], switches = new Set();
  function visit(directory) { for (const entry of readdirSync(join(cwd, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`; if (entry.isDirectory()) visit(file);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(file)) { files.push(file); for (const key of discoverParitySwitches(readFileSync(join(cwd, file), 'utf8'))) switches.add(key); }
  } }
  for (const directory of ['api', 'src', 'config']) visit(directory);
  return { candidateHead: FIRST_RUNTIME_ROLLOUT.candidateSha, hashes: { application: sourceDigest,
    policy: releaseHash(readFileSync(new URL('../config/preview-parity-policy.json', import.meta.url))),
    legacyEmailProof: LEGACY_EMAIL_BASELINE_CONTRACT_HASH,
    connections: releaseHash(readFileSync(join(cwd, 'config/fcosConnections.js'))), ciIdentity: releaseHash(readFileSync(join(cwd, 'config/fcosCiIdentity.js'))) },
    switchInventory: { keys: [...switches].sort(), sourceFiles: files.sort(), sourceHash: sourceDigest } };
}

export async function runRuntimeCompatibilityRelease({ mode = 'dry-run', trustedCwd = ROOT, candidateCwd = ROOT,
  expectedCommit, candidateUrl, env = process.env } = {}) {
  if (mode === 'dry-run') return createRuntimeCompatibilityPreflight();
  if (!['preflight', 'execute', 'collect-quality'].includes(mode) || expectedCommit !== FIRST_RUNTIME_ROLLOUT.candidateSha
    || canonicalFcosE2eCandidateUrl(candidateUrl) !== candidateUrl) throw new Error('Protected mode requires the exact first-rollout candidate and immutable Preview.');
  const input = { collectionBlockers: [] }, block = (code, scope) => input.collectionBlockers.push({ code, scope });
  let source, harness, baseline;
  try {
    source = collectBuildProvenance({ cwd: candidateCwd, env: {}, requireClean: true });
    harness = collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true });
    if (source.commit !== expectedCommit || !source.releaseEligible || !harness.releaseEligible) throw new Error('source');
    input.scope = verifyRuntimeCompatibility({ cwd: candidateCwd, baseCommit: FIRST_RUNTIME_ROLLOUT.previousSha, candidateCommit: expectedCommit });
    baseline = immutableCompatibilityBaseline({ cwd: candidateCwd, trustedCwd });
    input.binding = { sha: expectedCommit, harnessSha: harness.commit, sourceDigest: source.sourceDigest,
      lockHash: releaseHash(readFileSync(join(candidateCwd, 'package-lock.json'))), configurationRevision: runtimeCompatibilityControlRevision(trustedCwd, candidateCwd),
      candidateTreeHash: input.scope.candidateTreeHash, candidateUrl };
  } catch { block('CLEAN_EXACT_SOURCE_COLLECTION_FAILED', 'source'); return createRuntimeCompatibilityPreflight(input); }
  if (!compatibilityReadOnlyGuardsVerified(input.scope)) { block('EXACT_READ_ONLY_GUARD_SCOPE_REQUIRED', 'source'); return createRuntimeCompatibilityPreflight(input); }
  let claims, reads, repository, branch, variables;
  const githubAuthority = async () => {
    if (!env.GH_TOKEN) throw new Error('dedicated GitHub token');
    const signed = await githubReleaseOidc({ env });
    reads = githubReleaseReads({ command: 'gh', env: { PATH: env.PATH, HOME: env.HOME, GH_HOST: 'github.com', GH_REPO: RELEASE_REPOSITORY, GH_TOKEN: env.GH_TOKEN } }, { cwd: trustedCwd });
    assertReleaseGitHubAccount(reads);
    repository = reads.json(`repos/${RELEASE_REPOSITORY}`); branch = reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}`);
    assertRuntimeCompatibilityWorkflowIdentity(signed, repository, branch);
    if (harness.commit !== branch.commit.sha) throw new Error('trusted harness changed');
    variables = reads.json(`repos/${RELEASE_REPOSITORY}/environments/${COMPATIBILITY_ENVIRONMENT}/variables?per_page=100`);
    const runId = Number(signed.run_id);
    const approved = assertRuntimeCompatibilityProtection({ repository, branch,
      protection: reads.json(`repos/${RELEASE_REPOSITORY}/branches/${encodeURIComponent(repository.default_branch)}/protection`),
      environment: reads.json(`repos/${RELEASE_REPOSITORY}/environments/${COMPATIBILITY_ENVIRONMENT}`), variables,
      secrets: reads.json(`repos/${RELEASE_REPOSITORY}/environments/${COMPATIBILITY_ENVIRONMENT}/secrets?per_page=100`),
      run: reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${runId}`), approvals: reads.json(`repos/${RELEASE_REPOSITORY}/actions/runs/${runId}/approvals`), oidcClaims: signed, binding: input.binding });
    claims = signed; return approved;
  };
  try { input.protection = await githubAuthority(); }
  catch { block('PROTECTED_COMPATIBILITY_SETUP_OR_APPROVAL_UNAVAILABLE', 'protection'); return createRuntimeCompatibilityPreflight(input); }
  if (mode === 'collect-quality') {
    const runId = Number(env.FCOS_COMPATIBILITY_QUALITY_RUN_ID);
    const proof = compatibilityUpstreamQuality({ reads, cwd: candidateCwd, runId, binding: input.binding });
    if (!env.RUNNER_TEMP) throw new Error('Private runner quality artifact directory required.');
    const payload = { schemaVersion: 1, baseSha: FIRST_RUNTIME_ROLLOUT.previousSha, candidateSha: expectedCommit,
      sourceDigest: source.sourceDigest, lockSha256: input.binding.lockHash, harnessSha: harness.commit, capturedAt: new Date().toISOString(), ...proof };
    writeFileSync(join(resolve(env.RUNNER_TEMP), 'fcos-quality-source.json'), `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: 'wx', flush: true });
    return { qualityArtifactProduced: true, candidateSha: expectedCommit, upstreamRunId: runId, mutations: 0, productionAuthorized: false };
  }
  let api, cli, project, authority, productionEnvironmentFingerprint, refreshPrerequisites;
  try {
    if (!env.VERCEL_TOKEN || !env.FCOS_RELEASE_RUNTIME_TOKEN || !env.FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN) throw new Error('dedicated existing credentials');
    const teamId = fcosConnectionIdentifier('vercel', 'Team ID'), projectId = fcosConnectionIdentifier('vercel', 'Project ID');
    const runtime = { PATH: env.PATH, HOME: env.HOME, CI: '1', NO_COLOR: '1', VERCEL_TOKEN: env.VERCEL_TOKEN, VERCEL_ORG_ID: teamId, VERCEL_PROJECT_ID: projectId };
    cli = args => command('vercel', [...args, '--scope', fcosConnectionIdentifier('vercel', 'Team'), '--cwd', candidateCwd, '--no-color'], { cwd: trustedCwd, env: runtime });
    if (cli(['--version']).trim().replace(/^Vercel CLI /i, '') !== '54.20.1') throw new Error('pinned CLI');
    api = path => JSON.parse(cli(['api', `${path}${path.includes('?') ? '&' : '?'}teamId=${teamId}`, '--method', 'GET', '--raw']));
    project = () => api(`/v9/projects/${projectId}`);
    const envMetadata = () => JSON.parse(cli(['env', 'ls', 'production', '--format=json']));
    authority = async () => {
      const approved = await githubAuthority(), user = api('/v2/user').user;
      if (user?.username !== fcosConnectionIdentifier('vercel', 'Account')) throw new Error('account');
      const team = api(`/v2/teams/${teamId}`);
      if (team?.id !== teamId || team.slug !== fcosConnectionIdentifier('vercel', 'Team') || team.membership?.role !== 'OWNER') throw new Error('owner');
      const details = project(); if (details.link?.productionBranch !== branch.name) throw new Error('Production branch');
      input.provider = assertVercelProductionAuthority({ user, team, project: details,
        token: await readVercelTokenMetadata({ cliRead: api, token: env.VERCEL_TOKEN }), reviewedTokenId: variables.variables.find(row => row.name === 'FCOS_RELEASE_VERCEL_TOKEN_ID').value,
        deploymentConfiguration: JSON.parse(readFileSync(join(candidateCwd, 'vercel.json'))), hooks: details.link?.deployHooks });
      if (collectBuildProvenance({ cwd: candidateCwd, env: {}, requireClean: true }).sourceDigest !== source.sourceDigest
        || collectBuildProvenance({ cwd: trustedCwd, env: {}, requireClean: true }).commit !== harness.commit
        || runtimeCompatibilityControlRevision(trustedCwd, candidateCwd) !== input.binding.configurationRevision) throw new Error('reviewed source or controls changed');
      if (productionEnvironmentFingerprint && releaseHash(JSON.stringify(envMetadata())) !== productionEnvironmentFingerprint) throw new Error('Production environment changed');
      if (mode === 'execute' && refreshPrerequisites) await refreshPrerequisites();
      return approved;
    };
    await authority(); productionEnvironmentFingerprint = releaseHash(JSON.stringify(envMetadata()));
    if (project().targets?.production?.id !== FIRST_RUNTIME_ROLLOUT.previousDeploymentId) throw new Error('previous Production changed');
    const deployment = (reference, target) => {
      const raw = api(`/v13/deployments/${reference}`), inspected = JSON.parse(cli(['inspect', raw.id, '--format=json']));
      if (raw.projectId !== projectId || raw.name !== fcosConnectionIdentifier('vercel', 'Project') || raw.teamId && raw.teamId !== teamId
        || inspected.id !== raw.id || inspected.target !== target || !/^dpl_[A-Za-z0-9]+$/.test(raw.id || '')
        || target === 'production' && raw.target !== 'production' || target === 'preview' && (raw.target === 'production' || !raw.meta?.githubCommitRef)) throw new Error('deployment target');
      const url = canonicalFcosE2eCandidateUrl(`https://${raw.url}`);
      return { raw, observation: { id: raw.id, sha: raw.meta?.githubCommitSha, url, target, state: raw.readyState,
        createdAt: raw.createdAt, teamId, projectId, operationId: raw.meta?.fcosReleaseOperation } };
    };
    const previous = deployment(FIRST_RUNTIME_ROLLOUT.previousDeploymentId, 'production'), candidate = deployment(new URL(candidateUrl).hostname, 'preview');
    if (previous.observation.sha !== FIRST_RUNTIME_ROLLOUT.previousSha || previous.observation.url !== FIRST_RUNTIME_ROLLOUT.previousUrl || previous.observation.state !== 'READY'
      || candidate.observation.sha !== expectedCommit || candidate.observation.url !== candidateUrl || candidate.observation.state !== 'READY') throw new Error('exact source/READY');
    input.previous = previous.observation; input.candidate = { ...candidate.observation, sourceDigest: source.sourceDigest };
    const collectSnapshots = async () => {
      const previous = deployment(FIRST_RUNTIME_ROLLOUT.previousDeploymentId, 'production'), candidate = deployment(new URL(candidateUrl).hostname, 'preview');
      if (previous.observation.sha !== FIRST_RUNTIME_ROLLOUT.previousSha || previous.observation.url !== FIRST_RUNTIME_ROLLOUT.previousUrl || previous.observation.state !== 'READY'
        || candidate.observation.id !== input.candidate.id || candidate.observation.sha !== expectedCommit || candidate.observation.url !== candidateUrl || candidate.observation.state !== 'READY') throw new Error('Immutable deployment changed at approval boundary.');
      const privateDirectory = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'fcos-compatibility-private-'));
      const snapshots = {};
      try {
        for (const [name, record] of [['production', previous], ['candidate', candidate]]) {
          const d = record.observation, file = join(privateDirectory, `${name}.env`), gitBranch = record.raw.meta?.githubCommitRef;
          if (!Array.isArray(record.raw.env) || !record.raw.env.length || record.raw.env.some(key => typeof key !== 'string' || !/^[A-Z][A-Z0-9_]*(?:=|$)/.test(key))) throw new Error('complete deployed key inventory');
          cli(['env', 'pull', file, '--environment', d.target, ...(name === 'candidate' ? ['--git-branch', gitBranch] : []), '--yes']);
          const metadata = JSON.parse(cli(['env', 'ls', d.target, '--format=json']));
          const entries = metadata.envs || metadata.environmentVariables || [];
          if (name === 'candidate') { const branchMetadata = JSON.parse(cli(['env', 'ls', d.target, gitBranch, '--format=json'])); entries.push(...(branchMetadata.envs || branchMetadata.environmentVariables || [])); }
          const updatedAt = entries.length ? Math.max(...entries.map(row => Number(row.updatedAt || row.createdAt || 0))) : NaN;
          if (!Number.isFinite(updatedAt) || updatedAt > d.createdAt) throw new Error('environment changed since immutable deployment');
          const text = readFileSync(file, 'utf8'), rawEnv = parseEnvironment(text), keys = record.raw.env.map(key => key.split('=')[0]);
          const parsed = parseParityEnvironment(text, keys);
          if (rawEnv.VERCEL_ENV && rawEnv.VERCEL_ENV !== d.target) throw new Error('Provider target conflicts with pulled platform environment.');
          parsed.VERCEL_ENV = { state: 'known', value: d.target }; // independently inspected platform target
          // Opaque equality is proved only from actual privately pulled values;
          // hashes stay in memory and are never serialized or treated as auth.
          for (const key of PREVIEW_PARITY_POLICY.applicationKeys.opaqueMatch) if (keys.includes(key) && rawEnv[key]) parsed[key] = { state: 'known', sha256: releaseHash(rawEnv[key]) };
          const bypass = name === 'candidate' ? env.FCOS_E2E_VERCEL_BYPASS : undefined;
          const version = JSON.parse(await artifact(d.url, '/app-version.json', bypass));
          const expectedDigest = name === 'candidate' ? source.sourceDigest : baseline.sourceDigest;
          if (version.commit !== d.sha || version.provenance?.commit !== d.sha || version.provenance?.sourceDigest !== expectedDigest
            || version.provenance?.releaseEligible !== true || version.provenance?.sourceDigestAlgorithm !== 'sha256:fcos-vercel-source-v1'
            || version.gitDirty !== version.provenance.gitDirty || version.provenance.gitDirty !== false
              && !(version.provenance.gitDirty === null && version.provenance.sourceAttested === true)
            || name === 'candidate' && version.deploymentId !== d.id || name === 'production' && version.deploymentId !== null && version.deploymentId !== d.id) throw new Error('unmodified clean artifact receipt/source digest');
          const capturedAt = new Date().toISOString(), bound = { capturedAt, deploymentId: d.id, sha: d.sha };
          const compiled = await compiledFlags(d.url, bound, bypass);
          const effectiveEnvironment = Object.fromEntries(keys.filter(key => Object.hasOwn(rawEnv, key)).map(key => [key, rawEnv[key]]));
          effectiveEnvironment.VERCEL_ENV = d.target; // independently inspected provider target, not a receipt patch
          const runtimeObservation = name === 'production'
            ? await collectCompatibilityBaselineRuntime({ deployment: d, privateEnvironment: effectiveEnvironment, baseline })
            : await collectRuntimeObservation({ url: d.url, deployment: d, sourceDigest: expectedDigest, token: env.FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN, protectionBypass: bypass });
          snapshots[name] = { deployment: Object.fromEntries(Object.entries(d).filter(([key]) => key !== 'operationId')), env: { ...bound, updatedAt, keys: parsed }, compiled,
            runtime: runtimeObservation || { ...bound, flags: {}, safety: {}, auth: {} } };
        }
      } finally { rmSync(privateDirectory, { recursive: true, force: true }); }
      return snapshots;
    };
    const snapshots = await collectSnapshots();
    input.runtime = snapshots.candidate.runtime;
    const collectEndpointAbsence = async () => {
      const endpoint = `${input.previous.url}/api/connection-runtime`, absent = await fetch(endpoint, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (absent.status !== 404 || absent.redirected || absent.url && absent.url !== endpoint) throw new Error('Only the exact previous endpoint 404 may be excepted.');
      return { deploymentId: input.previous.id, sha: input.previous.sha, url: input.previous.url,
        sourceAbsent: input.scope.changes.some(row => row.path === 'api/connection-runtime.js' && row.before === null), httpStatus: 404, capturedAt: new Date().toISOString() };
    };
    input.endpointAbsence = await collectEndpointAbsence();
    const evidenceBinding = { sha: input.binding.sha, sourceDigest: input.binding.sourceDigest, lockHash: input.binding.lockHash,
      configurationRevision: input.binding.configurationRevision, deploymentId: input.candidate.id, candidateUrl };
    const standard = await collectTrustedReleaseEvidence({ reads, binding: evidenceBinding });
    input.trustedEvidence = standard.records.filter(record => record.kind === 'restricted_browser');
    input.collectionBlockers.push(...standard.blockers.filter(record => record.scope !== 'normal_role'));
    try { input.trustedEvidence.push(await collectCompatibilityNormalEvidence({ reads, binding: evidenceBinding })); }
    catch { block('DEDICATED_REAL_NORMAL_EVIDENCE_UNAVAILABLE', 'normal_role'); }
    try { input.quality = await collectCompatibilityQualityEvidence({ reads, cwd: candidateCwd, binding: evidenceBinding }); }
    catch { block('EXACT_COMPATIBILITY_QUALITY_EVIDENCE_UNAVAILABLE', 'quality'); }
    const sourceRecord = sourceInventory(candidateCwd, source.sourceDigest);
    const evaluateCollected = async (snapshots, evidence, quality) => {
      const normal = evidence.find(row => row.kind === 'normal_role');
      const observations = { schemaVersion: 1, provider: { provider: 'vercel', account: fcosConnectionIdentifier('vercel', 'Account'), teamId, projectId, repository: RELEASE_REPOSITORY },
        source: sourceRecord, switchInventory: sourceRecord.switchInventory, ...snapshots,
        coverage: { capturedAt: normal?.capturedAt, deploymentId: input.candidate.id, sha: expectedCommit, checks: normal?.checks || [] } };
      try { observations.legacyEmailBaseline = await collectLegacyEmailBaselineEvidence({ api, reads, binding: evidenceBinding,
        production: snapshots.production.deployment, candidate: snapshots.candidate.deployment, normal,
        readVersion: async deployment => JSON.parse(await artifact(deployment.url, '/app-version.json', env.FCOS_E2E_VERCEL_BYPASS)) });
        observations.legacyEmailNormal = normal;
      } catch { /* Missing or stale exact proof remains an unknown, never inferred equal. */ }
      const result = evaluatePreviewParity(observations, { expectedCommit, sourceHashes: sourceRecord.hashes });
      const parity = { ...result, capturedAt: new Date().toISOString(), binding: { ...evidenceBinding, url: candidateUrl }, source: sourceRecord,
        candidate: { ...snapshots.candidate.deployment, sourceDigest: source.sourceDigest, lockHash: input.binding.lockHash, configurationRevision: input.binding.configurationRevision },
        production: snapshots.production.deployment, expectedRuntimeAuth: snapshots.production.runtime.auth,
        expectedRuntimeFlags: snapshots.production.runtime.flags, expectedRuntimeSafety: snapshots.production.runtime.safety,
        trustedEvidence: evidence.map(({ checks: _checks, emailSigner: _emailSigner, ...record }) => record), quality };
      const readiness = createReleaseReadiness({ source: sourceRecord, candidate: parity.candidate, production: parity.production, parity,
        evidence: parity.trustedEvidence, quality, configurationRevision: input.binding.configurationRevision, lockHash: input.binding.lockHash });
      return { parity, readiness };
    };
    Object.assign(input, await evaluateCollected(snapshots, input.trustedEvidence, input.quality));
    input.collectionBlockers.push(...input.parity.blockers.map(({ code, scope }) => ({ code, scope })));
    const preflight = createRuntimeCompatibilityPreflight(input);
    if (mode !== 'execute' || !preflight.ready) return preflight;
    refreshPrerequisites = async () => {
      // Re-read every archive and original job completion. Actual UI completion
      // timestamps are retained; a fresh upload or this read cannot renew them.
      const standard = await collectTrustedReleaseEvidence({ reads, binding: evidenceBinding });
      if (standard.blockers.some(row => row.scope !== 'normal_role')) throw new Error('Restricted evidence became unavailable.');
      const evidence = [...standard.records.filter(row => row.kind === 'restricted_browser'),
        await collectCompatibilityNormalEvidence({ reads, binding: evidenceBinding })];
      const quality = await collectCompatibilityQualityEvidence({ reads, cwd: candidateCwd, binding: evidenceBinding });
      assertCompatibilityEvidenceReadback({ evidence: input.trustedEvidence, quality: input.quality }, { evidence, quality });
      const refreshedSnapshots = await collectSnapshots();
      // Configuration and provider observations must still agree with the
      // originally reviewed Production behavior before any domain assignment.
      for (const name of ['production', 'candidate']) {
        const stable = snapshot => ({ deployment: snapshot.deployment, keys: snapshot.env.keys, updatedAt: snapshot.env.updatedAt,
          compiled: snapshot.compiled.flags, flags: snapshot.runtime.flags, auth: snapshot.runtime.auth, safety: snapshot.runtime.safety });
        if (releaseHash(JSON.stringify(stable(refreshedSnapshots[name]))) !== releaseHash(JSON.stringify(stable(snapshots[name])))) throw new Error('Effective configuration, compiled flags or existing provider session changed.');
      }
      const current = { ...input, ...await evaluateCollected(refreshedSnapshots, evidence, quality), runtime: refreshedSnapshots.candidate.runtime,
        trustedEvidence: evidence, quality, endpointAbsence: await collectEndpointAbsence() };
      if (!createRuntimeCompatibilityPreflight(current).ready) throw new Error('Fresh complete compatibility parity and evidence required at approval boundary.');
    };
    const directory = resolve(env.RUNNER_TEMP || '');
    if (!env.RUNNER_TEMP || directory === '/' || !lstatSync(directory).isDirectory()) throw new Error('Private runner journal directory required.');
    const journalPath = join(directory, `fcos-runtime-compatibility-${claims.run_id}.jsonl`);
    if (existsSync(journalPath)) throw new Error('Existing operation journal requires explicit uncertain-outcome readback; no blind retry.');
    const linkDirectory = join(candidateCwd, '.vercel');
    if (existsSync(linkDirectory) && (!lstatSync(linkDirectory).isDirectory() || lstatSync(linkDirectory).isSymbolicLink())) throw new Error('Candidate provider link directory must be regular.');
    mkdirSync(linkDirectory, { recursive: true, mode: 0o700 });
    const linkPath = join(linkDirectory, 'project.json');
    if (existsSync(linkPath)) { if (!lstatSync(linkPath).isFile() || lstatSync(linkPath).isSymbolicLink()) throw new Error('Candidate provider link must be regular.');
      const link = JSON.parse(readFileSync(linkPath)); if (link.projectId !== projectId || link.orgId !== teamId) throw new Error('Existing candidate link target mismatch.'); }
    else writeFileSync(linkPath, `${JSON.stringify({ projectId, orgId: teamId, projectName: fcosConnectionIdentifier('vercel', 'Project') })}\n`, { mode: 0o600, flag: 'wx' });
    const verifyDeployment = reference => deployment(reference, 'production').observation;
    const currentProduction = async () => verifyDeployment(project().targets?.production?.id);
    const probe = async (d, report, { publicDomain = false } = {}) => {
      const origin = publicDomain ? new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin : d.url;
      const version = JSON.parse(await artifact(origin, '/app-version.json'));
      if (version.commit !== report.candidate.sha || version.deploymentId !== d.id || version.provenance?.sourceDigest !== report.candidate.sourceDigest || version.provenance?.releaseEligible !== true) throw new Error('Staged/public source readback mismatch.');
      const compiled = await compiledFlags(origin, {});
      if (PREVIEW_PARITY_POLICY.compiledFlags.some(key => compiled.flags[key]?.state !== 'known'
        || compiled.flags[key].value !== snapshots.production.compiled.flags[key]?.value)) throw new Error('Staged/public compiled flags do not preserve verified Production behavior.');
      const runtimeObservation = await collectRuntimeObservation({ url: d.url, deployment: d, sourceDigest: report.candidate.sourceDigest, token: env.FCOS_RELEASE_RUNTIME_TOKEN });
      assertProductionRuntimeReadback(runtimeObservation, input.parity);
    };
    return executeRuntimeCompatibilityRelease({ preflight, readiness: input.readiness, authority, currentProduction, probe,
      journal: async (entry, { first = false } = {}) => { const data = `${JSON.stringify(entry)}\n`; if (first) writeFileSync(journalPath, data, { mode: 0o600, flag: 'wx', flush: true }); else appendFileSync(journalPath, data, { mode: 0o600, flush: true }); },
      deploy: async args => verifyDeployment(new URL(canonicalFcosE2eCandidateUrl(cli(args).trim())).hostname),
      discover: async operationId => { try { const matches = (api(`/v6/deployments?projectId=${projectId}&limit=20`).deployments || []).filter(row => row.meta?.fcosReleaseOperation === operationId && row.meta?.githubCommitSha === expectedCommit);
        return matches.length === 1 ? verifyDeployment(matches[0].uid || matches[0].id) : null; } catch { return null; } },
      waitReady: async d => { const deadline = Date.now() + 900000; while (Date.now() < deadline) { const checked = verifyDeployment(d.id); if (checked.state === 'READY') return checked;
        if (['ERROR', 'CANCELED'].includes(checked.state)) throw new Error('Staged build failed.'); await new Promise(done => setTimeout(done, 10000)); } throw new Error('Staged build remains unresolved.'); },
      promote: async d => cli(['promote', d.id, '--yes']) });
  } catch {
    if (mode === 'execute' && input.readiness?.ready) throw new Error('Compatibility operation blocked or uncertain. Inspect the durable journal and exact deployment before any retry; private diagnostics suppressed.');
    block('VERIFIED_PROVIDER_OR_EXACT_EVIDENCE_UNAVAILABLE', 'vercel'); return createRuntimeCompatibilityPreflight(input);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = runtimeCompatibilityReleaseArguments(process.argv.slice(2));
  runRuntimeCompatibilityRelease(options).then(result => {
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (options.mode !== 'collect-quality' && result.receiptKind === 'fcos_runtime_compatibility_preflight' && process.env.RUNNER_TEMP && /^[1-9][0-9]*$/.test(process.env.GITHUB_RUN_ID || '')) {
      const directory = resolve(process.env.RUNNER_TEMP); if (directory === '/' || !lstatSync(directory).isDirectory()) throw new Error('Private runner report directory required.');
      writeFileSync(join(directory, `fcos-runtime-compatibility-${process.env.GITHUB_RUN_ID}.json`), serialized, { mode: 0o600, flag: 'wx', flush: true });
    }
    process.stdout.write(serialized); if (options.mode !== 'dry-run' && result.ready === false) process.exitCode = 1;
  }).catch(() => { console.error('Runtime compatibility rollout blocked. Verify exact protected approval and independent evidence; inspect any durable operation journal before retry. Private diagnostics suppressed.'); process.exitCode = 1; });
}
