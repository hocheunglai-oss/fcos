import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { collectBuildProvenance } from '../build-provenance.mjs';
import { collectRuntimeObservation } from '../../collect-preview-parity.mjs';
import { assertProductionRuntimeReadback } from '../release-production.mjs';
import { canonicalFcosE2eCandidateUrl } from '../../verify-e2e-candidate.mjs';
import { canonical, digest, fail, validateManifest } from './contract.mjs';
import { createVercelIntegrationReader } from './vercel-read-auth.mjs';
import { assertHostedSetup, assertHostedSourceContext } from './admission.mjs';
import { assertVercelPreviewWriterSecret } from './vercel-writer-auth.mjs';

export function assertProjectConfiguration(actual, expected) {
  const keys = ['framework','buildCommand','devCommand','installCommand','outputDirectory','rootDirectory','nodeVersion'];
  if (!expected || keys.some(key => !Object.hasOwn(expected,key))
    || keys.some(key => canonical(actual?.[key] ?? null) !== canonical(expected[key] ?? null))) fail('VERCEL_BUILD_CONFIGURATION_CHANGED');
  return true;
}

export function deploymentArguments(manifest, operationId, production) {
  validateManifest(manifest);
  if (operationId !== `${manifest.releaseId}-${production ? 'production-stage' : 'preview-create'}`) fail('DEPLOYMENT_OPERATION');
  return ['deploy', ...(production ? ['--prod', '--skip-domain'] : ['--target', 'preview']), '--yes', '--no-wait',
    '--meta', `githubCommitSha=${manifest.candidate.sha}`, '--meta', `fcosHostedOperation=${operationId}`,
    '--meta', `fcosHostedManifest=${digest(manifest)}`, '--meta', `fcosVerificationSha256=${digest(manifest.verification)}`, '--meta', `fcosSourceSha256=${manifest.candidate.sourceSha256}`, '--build-env', `FCOS_BUILD_COMMIT_SHA=${manifest.candidate.sha}`,
    '--build-env', `FCOS_EXPECTED_SOURCE_SHA256=${manifest.candidate.sourceSha256}`, '--env', `FCOS_BUILD_COMMIT_SHA=${manifest.candidate.sha}`,
    ...Object.entries(manifest.verification.publicBuildEnvironment).flatMap(([key,value]) => ['--build-env',`${key}=${value}`])];
}

/** Trusted process only; candidate files are packaged by the pinned CLI, never imported/executed here. */
export function createVercelAdapter({ manifest, candidateDirectory, env = process.env, fetchImpl = fetch,
  execute = execFileSync, now = Date.now, schemaObservation, collectCheck, runtimeTokenProvider, readOnly = false } = {}) {
  validateManifest(manifest);
  const cwd = resolve(candidateDirectory), target = manifest.targets;
  const reader=readOnly?createVercelIntegrationReader({manifest,env,fetchImpl,now}):null;
  if (!readOnly && (!env.FCOS_HOSTED_VERCEL_TOKEN || !env.FCOS_HOSTED_VERCEL_TOKEN_ID)) fail('HOSTED_VERCEL_CREDENTIAL_MISSING');
  const cliEnv = { PATH: env.PATH, HOME: env.HOME, CI: '1', NO_COLOR: '1', VERCEL_TOKEN: env.FCOS_HOSTED_VERCEL_TOKEN,
    VERCEL_ORG_ID: target.vercelTeam, VERCEL_PROJECT_ID: target.vercelProject };
  const run = args => {
    if(readOnly)fail('VERCEL_READ_WRITE_FORBIDDEN','vercel.read');
    try { return execute('vercel', [...args, '--scope', fcosConnectionIdentifier('vercel', 'Team'), '--cwd', cwd, '--no-color'], {
      cwd, env: cliEnv, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(); } catch { fail('VERCEL_COMMAND_UNRESOLVED', 'vercel.write', 'Read back this operation; command errors do not prove that submission did not occur.'); }
  };
  const api = async (path, { permitStatus, scopeTeam = true } = {}) => {
    if(readOnly)return reader.get(path);
    const url = new URL(`https://api.vercel.com${path}`); if (scopeTeam) url.searchParams.set('teamId', target.vercelTeam);
    if (url.origin !== 'https://api.vercel.com' || !path.startsWith('/v')) fail('VERCEL_API_PATH');
    let response;
    try { response = await fetchImpl(url, { headers: { authorization: `Bearer ${env.FCOS_HOSTED_VERCEL_TOKEN}` }, method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { fail('VERCEL_READ_UNAVAILABLE', 'vercel.read', 'Retry only the target-locked read.'); }
    if (response.redirected) fail('VERCEL_READ_REDIRECT', 'vercel.read');
    if (permitStatus) return response.status;
    if (!response.ok || response.redirected) fail(`VERCEL_READ_HTTP_${response.status}`, 'vercel.read');
    return response.json();
  };
  const project = () => api(`/v9/projects/${target.vercelProject}`);
  const deployment = async id => {
    if (!/^(?:dpl_[A-Za-z0-9]+|[a-z0-9-]+\.vercel\.app)$/.test(id || '')) fail('DEPLOYMENT_REFERENCE');
    const value = await api(`/v13/deployments/${id}`);
    if (value.projectId !== target.vercelProject || value.teamId && value.teamId !== target.vercelTeam) fail('DEPLOYMENT_TARGET');
    const url = canonicalFcosE2eCandidateUrl(`https://${value.url}`);
    return { id: value.id, url, projectId: value.projectId, teamId: value.teamId || target.vercelTeam,
      sha: value.meta?.githubCommitSha, sourceSha256: value.meta?.fcosSourceSha256, target: value.target || 'preview', state: value.readyState,
      projectSettings: value.projectSettings, verificationSha256: value.meta?.fcosVerificationSha256, createdAt: value.createdAt, operationId: value.meta?.fcosHostedOperation, manifestHash: value.meta?.fcosHostedManifest };
  };
  async function verifyArtifact(value, release, phase) {
    const exact = await deployment(value.id);
    if (exact.state !== 'READY' || exact.sha !== release.candidate.sha || exact.manifestHash !== digest(release)
      || exact.target !== (phase === 'preview' ? 'preview' : 'production')) fail('ARTIFACT_IDENTITY', phase);
    if (exact.verificationSha256 !== digest(release.verification)) fail('ARTIFACT_BUILD_CONFIGURATION_MISMATCH', phase);
    assertProjectConfiguration(exact.projectSettings, release.verification.projectSettings);
    const origin = phase === 'live' ? target.productionOrigin : exact.url;
    const bypass = phase === 'preview' ? env.FCOS_E2E_VERCEL_BYPASS : phase === 'staged' ? env.FCOS_PRODUCTION_VERIFICATION_BYPASS : undefined;
    const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : {};
    let response;
    try { response = await fetchImpl(`${origin}/app-version.json`, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { fail('ARTIFACT_READ_UNAVAILABLE', phase); }
    if (!response.ok || response.redirected) fail('ARTIFACT_READ_FAILED', phase);
    const version = await response.json();
    if (version.commit !== release.candidate.sha || version.deploymentId !== exact.id
      || version.provenance?.sourceDigest !== release.candidate.sourceSha256 || version.provenance.releaseEligible !== true) fail('ARTIFACT_SOURCE_MISMATCH', phase);
    const runtimeToken = runtimeTokenProvider ? await runtimeTokenProvider({ origin: exact.url, deployment: exact })
      : phase === 'preview' ? env.FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN : env.FCOS_RELEASE_RUNTIME_TOKEN;
    const runtime = await collectRuntimeObservation({ url: exact.url, deployment: exact, sourceDigest: release.candidate.sourceSha256,
      token: runtimeToken,
      protectionBypass: phase === 'preview' ? env.FCOS_E2E_VERCEL_BYPASS : env.FCOS_PRODUCTION_VERIFICATION_BYPASS, fetchImpl, now: now() });
    if (!runtime) fail('RUNTIME_OBSERVATION_MISSING', phase);
    if (phase === 'preview') {
      if (runtime.safety.readOnly !== true || Object.values(runtime.safety.externalActions).some(value => value !== false)
        || canonical({ flags: runtime.flags, safety: runtime.safety, auth: runtime.auth }) !== canonical(release.runtime.expectedPreview)) fail('PREVIEW_RUNTIME_MISMATCH', phase);
    } else {
      const expected = release.runtime.expectedProduction;
      try { assertProductionRuntimeReadback(runtime, { expectedRuntimeFlags: expected.flags, expectedRuntimeSafety: expected.safety, expectedRuntimeAuth: expected.auth }); }
      catch { fail('PRODUCTION_RUNTIME_MISMATCH', phase); }
    }
    return { deployment: exact, version, runtime };
  }
  async function admit(release, phase) {
    validateManifest(release);
    if (digest(release) !== digest(manifest)) fail('MANIFEST_CHANGED');
    if(readOnly)return reader.admit();
    const production = phase.startsWith('production');
    if (production && env.FCOS_HOSTED_CREDENTIAL_CLASS !== 'production' || !production && env.FCOS_HOSTED_CREDENTIAL_CLASS !== 'preview') fail('CREDENTIAL_CLASS_MISMATCH', phase);
    const previewBinding = release.verification?.vercelPreviewWriterCredential;
    if (!production && release.stage === 'qualification' && !previewBinding) fail('VERCEL_PREVIEW_WRITER_SETUP_REQUIRED', phase);
    if (previewBinding && production && digest(env.FCOS_HOSTED_VERCEL_TOKEN) === previewBinding.bearerSha256) fail('VERCEL_PREVIEW_WRITER_FOR_PRODUCTION', phase);
    if (previewBinding && !production) {
      assertHostedSetup({ manifest: release, env }); assertHostedSourceContext({ manifest: release, env });
      assertVercelPreviewWriterSecret(previewBinding, { targets: target, env, now: now() });
    }
    if (existsSync(join(cwd, 'vercel.ts'))) fail('EXECUTABLE_DEPLOY_CONFIGURATION', phase);
    const source = collectBuildProvenance({ cwd, env: {}, requireClean: true });
    if (source.commit !== release.candidate.sha || source.sourceDigest !== release.candidate.sourceSha256
      || digest(readFileSync(join(cwd, 'package-lock.json'))) !== release.candidate.lockSha256) fail('SOURCE_CHANGED', phase);
    if (run(['--version']).replace(/^Vercel CLI /i, '') !== '54.20.1') fail('VERCEL_CLI_VERSION', phase);
    const p = await project();
    assertProjectConfiguration(p, release.verification.projectSettings);
    const token = previewBinding && !production ? null : (await api('/v5/user/tokens/current', { scopeTeam: false })).token;
    if (p.id !== target.vercelProject || p.accountId !== target.vercelTeam || p.name !== fcosConnectionIdentifier('vercel', 'Project')
      || p.link?.type !== 'github' || `${p.link.org}/${p.link.repo}` !== target.repository
      || p.autoAssignCustomDomains !== false || !Array.isArray(p.link.deployHooks) || p.link.deployHooks.length) fail('VERCEL_PROJECT_IDENTITY', phase);
    if (!(previewBinding && !production) && (token?.id !== env.FCOS_HOSTED_VERCEL_TOKEN_ID || token.revokedAt || token.leakedAt || !Number.isFinite(Number(token.expiresAt))
      || Number(token.expiresAt) <= now() || !Array.isArray(token.scopes) || token.scopes.length !== 1
      || token.scopes[0].type !== 'team' || token.scopes[0].teamId !== target.vercelTeam
      || token.scopes[0].expiresAt && Number(token.scopes[0].expiresAt) <= now())) fail('VERCEL_TOKEN_AUTHORITY', phase);
    const list = await api('/v9/projects?limit=100');
    const userStatus = await api('/v2/user', { permitStatus: true, scopeTeam: false });
    const teamStatus = await api(`/v2/teams/${target.vercelTeam}`, { permitStatus: true, scopeTeam: false });
    const userHidden = previewBinding && !production ? [403, 404].includes(userStatus) : userStatus === 403;
    if (list.projects?.length !== 1 || list.projects[0].id !== target.vercelProject || list.pagination?.next !== null
      || list.pagination?.count !== 1 || !userHidden || teamStatus !== 403) fail('VERCEL_PROJECT_SCOPE', phase);
    const configuration = JSON.parse(readFileSync(join(cwd, 'vercel.json'), 'utf8')), enabled = configuration.git?.deploymentEnabled;
    if (!(enabled === false || enabled && typeof enabled === 'object' && enabled[p.link.productionBranch] === false)) fail('AUTOMATIC_DEPLOYMENT_ENABLED', phase);
    const configFile = join(cwd, '.vercel/project.json'), expected = { projectId: target.vercelProject, orgId: target.vercelTeam, projectName: p.name };
    if (existsSync(configFile)) { if (canonical(JSON.parse(readFileSync(configFile))) !== canonical(expected)) fail('VERCEL_LINK_MISMATCH', phase); }
    else { mkdirSync(join(cwd, '.vercel'), { recursive: true, mode: 0o700 }); writeFileSync(configFile, `${JSON.stringify(expected)}\n`, { mode: 0o600, flag: 'wx' }); }
    return { credentialAuthority: previewBinding && !production ? 'root_accepted_original_issuance' : 'live_token_metadata',
      effectiveAccess: { userStatus, teamStatus, projectId: p.id, projectCount: list.pagination.count } };
  }
  async function create(release, context, production) {
    await admit(release, production ? 'production.stage' : 'preview');
    const output = run(deploymentArguments(release, context.operationId, production));
    if (!/^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(output)) fail('DEPLOYMENT_RESPONSE_UNRESOLVED');
    return deployment(new URL(output).hostname);
  }
  const adapter = {
    admit, verifyArtifact, collectCheck, inspect: deployment,
    observePreviousProduction: async () => {
      const p = await project();
      if (p.id !== target.vercelProject || p.accountId !== target.vercelTeam) fail('VERCEL_PROJECT_IDENTITY');
      const prior = await deployment(p.targets?.production?.id);
      const response = await fetchImpl(`${target.productionOrigin}/app-version.json`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok || response.redirected) fail('PREVIOUS_PRODUCTION_READBACK');
      const version = await response.json(), sourceSha256 = version.provenance?.sourceDigest;
      if (prior.state !== 'READY' || version.commit !== prior.sha || version.deploymentId !== prior.id || !/^[a-f0-9]{64}$/.test(sourceSha256 || '')) fail('PREVIOUS_PRODUCTION_READBACK');
      const token = await runtimeTokenProvider({ origin: prior.url, deployment: { ...prior, sourceSha256 } });
      const runtime = await collectRuntimeObservation({ url: prior.url, deployment: prior, sourceDigest: sourceSha256,
        token, protectionBypass: env.FCOS_PRODUCTION_VERIFICATION_BYPASS, fetchImpl, now: now() });
      const schema = await schemaObservation();
      if (!runtime) fail('PREVIOUS_RUNTIME_UNOBSERVED');
      return { readOnly: true, capturedAt: new Date(now()).toISOString(), previousProduction: { deploymentId: prior.id,
        sha: prior.sha, sourceSha256, schemaSha256: schema.sha256, runtimeSha256: digest({ flags: runtime.flags, safety: runtime.safety, auth: runtime.auth }) } };
    },
    createPreview: (release, context) => create(release, context, false), stage: (release, context) => create(release, context, true),
    currentProduction: async () => { const p = await project(); return deployment(p.targets?.production?.id); },
    ready: value => deployment(value.id),
    discover: async (release, targetName, { operationId }) => {
      const matches = []; let until;
      for (let page = 0; page < 20; page++) {
        const list = await api(`/v6/deployments?projectId=${target.vercelProject}&limit=100${until ? `&until=${until}` : ''}`);
        if (!Array.isArray(list.deployments)) fail('DEPLOYMENT_LIST_INVALID');
        matches.push(...list.deployments.filter(row => row.meta?.fcosHostedOperation === operationId && row.meta?.fcosHostedManifest === digest(release)));
        if (!list.pagination?.next) break; until = list.pagination.next;
        if (page === 19) fail('DEPLOYMENT_READBACK_INCOMPLETE');
      }
      // An empty listing never establishes no late submission.
      if (matches.length !== 1) return { outcome: 'unknown' };
      const result = await deployment(matches[0].uid || matches[0].id);
      if (result.sha !== release.candidate.sha || result.target !== targetName) fail('DEPLOYMENT_READBACK_MISMATCH');
      return { outcome: 'applied', result };
    },
    promote: async value => { run(['promote', value.id, '--yes']); },
    rollback: async previous => { run(['rollback', previous.deploymentId, '--yes']); },
    rollbackCompatibility: async (previous, release) => {
      if (typeof schemaObservation !== 'function') fail('ROLLBACK_SCHEMA_OBSERVATION_REQUIRED', 'production.rollback');
      const schema = await schemaObservation(), prior = await deployment(previous.deploymentId);
      const token = runtimeTokenProvider ? await runtimeTokenProvider({ origin: prior.url, deployment: { ...prior, sourceSha256: previous.sourceSha256 } }) : env.FCOS_RELEASE_RUNTIME_TOKEN;
      const runtime = await collectRuntimeObservation({ url: prior.url, deployment: prior, sourceDigest: previous.sourceSha256,
        token, protectionBypass: env.FCOS_PRODUCTION_VERIFICATION_BYPASS, fetchImpl, now: now() });
      const runtimeHash = runtime ? digest({ flags: runtime.flags, safety: runtime.safety, auth: runtime.auth }) : null;
      return { compatible: prior.sha === previous.sha && prior.state === 'READY' && schema.sha256 === release.migration.expectedSchemaSha256
        && runtimeHash === release.runtime.expectedSha256, schemaSha256: schema.sha256, runtimeSha256: runtimeHash, deploymentId: prior.id };
    },
    verifyRollback: async (value, release) => {
      const response = await fetchImpl(`${target.productionOrigin}/app-version.json`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok || response.redirected) fail('ROLLBACK_PUBLIC_READBACK');
      const version = await response.json();
      if (version.deploymentId !== value.id || version.commit !== release.previousProduction.sha || version.provenance?.sourceDigest !== release.previousProduction.sourceSha256) fail('ROLLBACK_PUBLIC_READBACK');
    },
  };
  if(readOnly)return Object.fromEntries(['admit','verifyArtifact','collectCheck','inspect','observePreviousProduction','currentProduction','ready','discover'].map(key=>[key,adapter[key]]));
  return adapter;
}

export function createVercelReadAdapter(options) { return createVercelAdapter({...options,readOnly:true}); }
