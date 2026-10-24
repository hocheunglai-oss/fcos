import { selectionBuildGuard, assertSelectionSource, collectSelectionEnvironment, assertSelectionBuildEvidence, selectionDeploymentMetadata, selectionSourceDeployRequest } from './configuration-selection.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fcosConnectionIdentifier } from '../../../config/fcosConnections.js';
import { collectBuildProvenance } from '../build-provenance.mjs';
import { collectRuntimeObservation } from '../../collect-preview-parity.mjs';
import { assertProductionRuntimeReadback } from '../release-production.mjs';
import { canonicalFcosE2eCandidateUrl } from '../../verify-e2e-candidate.mjs';
import { canonical, digest, fail, validateManifest,ReleaseError } from './contract.mjs';
import { createVercelReadTransport, createVercelIntegrationReader } from './vercel-read-auth.mjs';
import { assertHostedSetup, assertHostedSourceContext } from './admission.mjs';
import { assertVercelPreviewWriterSecret, assertVercelProductionWriterSecret } from './vercel-writer-auth.mjs';
import { validateFirstRuntimeOwnerRefresh } from './first-runtime.mjs';
import { atReleaseBoundary } from './failure.mjs';
import { runtimeMismatchDetail } from './runtime-mismatch.mjs';
import { vercelCommandFailure } from './vercel-command-failure.mjs';
import { SOURCE_API_TRANSPORT, prepareVercelSourceApiRequest, executeVercelSourceApiRequest, prepareVercelProjectActionRequest, executeVercelProjectActionRequest, verifyVercelProjectActionRecoveryRequest } from './vercel-source-api.mjs';
import { PREVIEW_PARITY_POLICY } from '../preview-parity.mjs';

const exactKeys = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function runtimeProbeIntent(release, deploymentId, phase) {
  const manifestHash = digest(release), hash = digest({ domain: 'fcos-hosted-runtime-probe-xero-metered-v1', manifestHash, deploymentId, phase });
  const requestId = `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-${((parseInt(hash[16],16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;
  return { schemaVersion: 1, kind: 'fcos_hosted_runtime_probe_intent_v1', protocol: 'xero_metered_v1', manifestHash,
    candidateSha: release.candidate.sha, sourceSha256: release.candidate.sourceSha256, deploymentId, phase, requestId };
}
function sanitizedRuntimeShape(runtime) {
  const providers = new Set([...PREVIEW_PARITY_POLICY.requiredAuth, ...Object.values(PREVIEW_PARITY_POLICY.applicationKeys.credentials)]);
  return exactKeys(runtime, ['capturedAt','deploymentId','sha','flags','safety','auth'])
    && exactKeys(runtime.flags, PREVIEW_PARITY_POLICY.runtimeFlags)
    && Object.values(runtime.flags).every(value => exactKeys(value, ['state','value']) && value.state === 'known' && typeof value.value === 'boolean')
    && exactKeys(runtime.safety, ['readOnly','externalActions']) && typeof runtime.safety.readOnly === 'boolean'
    && exactKeys(runtime.safety.externalActions, PREVIEW_PARITY_POLICY.externalActions)
    && Object.values(runtime.safety.externalActions).every(value => typeof value === 'boolean')
    && runtime.auth && Object.getPrototypeOf(runtime.auth) === Object.prototype
    && Object.entries(runtime.auth).every(([key,value]) => providers.has(key) && exactKeys(value, ['state','target','mode'])
      && value.state === 'authenticated' && typeof value.target === 'string' && /^[A-Za-z0-9_@./:-]{1,200}$/.test(value.target)
      && ['jwt','oauth','service_role','secret_key','api_key','oidc','application'].includes(value.mode));
}

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
    ...(!production ? ['--env', 'FCOS_ENABLE_READ_ONLY_CI=true'] : []),
    ...(manifest.legacyReleaseContainment ? ['--meta', `fcosConfigurationSelectionSha256=${digest(selectionBuildGuard(manifest).nodeOptions)}`, '--build-env', `NODE_OPTIONS=${selectionBuildGuard(manifest).nodeOptions}`] : []),
    ...Object.entries(manifest.verification.publicBuildEnvironment).flatMap(([key,value]) => ['--build-env',`${key}=${value}`])];
}


export function previewAdmissionReadAllowed(url, targets) {
  if (!(url instanceof URL) || url.origin !== 'https://api.vercel.com' || url.username || url.password || url.hash) return false;
  const entries = [...url.searchParams], values = Object.fromEntries(entries);
  if (entries.length !== Object.keys(values).length) return false;
  const exact = expected => canonical(values) === canonical(expected);
  if (url.pathname === `/v9/projects/${targets.vercelProject}`) return exact({teamId: targets.vercelTeam});
  if (url.pathname === '/v9/projects') return exact({limit: '100', teamId: targets.vercelTeam});
  if (url.pathname === '/v2/user' || url.pathname === `/v2/teams/${targets.vercelTeam}`) return exact({});
  const page = values.until === undefined ? {} : /^(?:0|[1-9][0-9]*)$/.test(values.until) && Number.isSafeInteger(Number(values.until)) ? {until: values.until} : null;
  if (!page) return false;
  if (url.pathname === `/v10/projects/${targets.vercelProject}/env`) return exact({decrypt: 'false', teamId: targets.vercelTeam, ...page});
  if (url.pathname === '/v1/env') return exact({projectId: targets.vercelProject, teamId: targets.vercelTeam, ...page});
  return false;
}

/** Trusted process only; candidate files are packaged by the pinned CLI, never imported/executed here. */
export function createVercelAdapter(options) { return buildVercelAdapter(options, false); }

/** Diagnostic capability only: no deployment, promotion, rollback, coordinator or runtime methods.
 * The protected diagnostic caller validates its own identity separately from the original release. */
export function createVercelPreviewAdmissionReader(options) { return buildVercelAdapter({ ...options, readOnly: false }, true); }

function buildVercelAdapter({ manifest, candidateDirectory, env = process.env, fetchImpl = fetch,
  execute = execFileSync, now = Date.now, schemaObservation, collectCheck, runtimeTokenProvider, coordinator, readOnly = false, observeBoundary } = {}, diagnosticOnly) {
  validateManifest(manifest);
  const cwd = resolve(candidateDirectory), target = manifest.targets;
  const sourceTransport = manifest.verification?.vercelSourceTransport;
  if (sourceTransport !== undefined && sourceTransport !== SOURCE_API_TRANSPORT) fail('SOURCE_API_TRANSPORT_NOT_ADMITTED');
  const sourceApi = sourceTransport === SOURCE_API_TRANSPORT, preparedPreviews = new Map(), preparedActions = new Map();
  const startedRuntimeProbes = new Set();
  const step = (boundary, callback) => atReleaseBoundary(boundary, callback, observeBoundary);
  if (diagnosticOnly && !manifest.verification?.vercelPreviewWriterCredential) fail('VERCEL_PREVIEW_WRITER_SETUP_REQUIRED', 'diagnostic');
  const reader=readOnly?createVercelIntegrationReader({manifest,env,fetchImpl,now}):null;
  const aliasReader=readOnly&&sourceApi?createVercelReadTransport({binding:manifest.verification.vercelReadCredential,targets:target,env,fetchImpl,now}):null;
  const productionAliasPath=`/v4/aliases/${new URL(target.productionOrigin).hostname}?projectId=${target.vercelProject}`;
  if (!readOnly && (!env.FCOS_HOSTED_VERCEL_TOKEN || !env.FCOS_HOSTED_VERCEL_TOKEN_ID)) fail('HOSTED_VERCEL_CREDENTIAL_MISSING');
  const cliEnv = { PATH: env.PATH, HOME: env.HOME, CI: '1', NO_COLOR: '1', VERCEL_TOKEN: env.FCOS_HOSTED_VERCEL_TOKEN,
    VERCEL_ORG_ID: target.vercelTeam, VERCEL_PROJECT_ID: target.vercelProject };
  let admittedScope, admittedProject;
  function assertWriteCapability() {
    if (sourceApi) {
      if (!admittedScope || !admittedProject) fail('SOURCE_API_WRITER_CONTEXT', 'vercel.transport');
      assertHostedSetup({ manifest, env }); assertHostedSourceContext({ manifest, env });
      if (env.FCOS_HOSTED_CREDENTIAL_CLASS === 'production') {
        if (!manifest.verification.vercelProductionWriterCredential) fail('SOURCE_API_WRITER_CONTEXT', 'vercel.transport');
        assertCurrentFirstRuntimeOwnerRefresh(manifest); assertProductionWriterContext(manifest);
      } else {
        if(env.FCOS_HOSTED_CREDENTIAL_CLASS!=='preview'||!manifest.verification.vercelPreviewWriterCredential)fail('SOURCE_API_WRITER_CONTEXT','vercel.transport');
        assertVercelPreviewWriterSecret(manifest.verification.vercelPreviewWriterCredential, { targets: target, env, now: now() });
      }
      return;
    }
    if (env.FCOS_HOSTED_CREDENTIAL_CLASS === 'production') {
      assertCurrentFirstRuntimeOwnerRefresh(manifest);
      assertProductionWriterContext(manifest);
    } else if (manifest.verification?.vercelPreviewWriterCredential) {
      assertVercelPreviewWriterSecret(manifest.verification.vercelPreviewWriterCredential, { targets: target, env, now: now() });
    }
    // --scope in the pinned CLI requires /v2/user. A project writer's required
    // denial is incompatible with that transport, not permission to widen it.
    if (!admittedScope || [403, 404].includes(admittedScope.userStatus)) {
      throw new ReleaseError('VERCEL_CLI_PROJECT_SCOPE_UNSUPPORTED', 'vercel.transport',
        'Keep the existing restricted credential. Prepare and qualify a supported project-only transport; do not create another intent or retry an uncertain deployment.',
        { providerSubmissionStarted: false });
    }
  }
  function assertCurrentFirstRuntimeOwnerRefresh(release) {
    if(!release.previousProduction.firstRuntime)return;
    const setup=assertHostedSetup({manifest:release,env});assertHostedSourceContext({manifest:release,env});
    let reference;try{reference=env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH?JSON.parse(env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH):null;}
    catch{fail('FIRST_RUNTIME_OWNER_REFRESH_INVALID','first_runtime.owner_refresh');}
    try{validateFirstRuntimeOwnerRefresh(reference,{baselineReference:setup.firstRuntimeBaseline,expectedSha256:env.FCOS_ADMITTED_FIRST_RUNTIME_OWNER_REFRESH_SHA256,now:now()});}
    catch(error){throw new ReleaseError(error.code||'FIRST_RUNTIME_OWNER_REFRESH_INVALID','first_runtime.owner_refresh',
      'The original credential owner must refresh expired read-only legacy observations and install their accepted public digest. Keep this manifest and its valid checks. An already-recorded intent remains consumed and GET-only; a fresh observation alone cannot retry it. Never renew historical timestamps or replay a consumed write.',
      {providerSubmissionStarted:false});}
  }
  function assertProductionWriterContext(release) {
    const binding = release.verification?.vercelProductionWriterCredential;
    if (!binding) return;
    if (cliEnv.VERCEL_TOKEN !== env.FCOS_HOSTED_VERCEL_TOKEN) fail('VERCEL_PRODUCTION_WRITER_CREDENTIAL_SUBSTITUTED', 'vercel.production');
    assertHostedSetup({ manifest: release, env }); assertHostedSourceContext({ manifest: release, env });
    assertVercelProductionWriterSecret(binding, { targets: target, previewBinding: release.verification.vercelPreviewWriterCredential,
      stage: release.stage, executionMode: release.executionMode, env, now: now() });
  }
  const run = args => {
    if(sourceApi && args[0] !== '--version') fail('SOURCE_API_PRODUCTION_NOT_IMPLEMENTED', 'vercel.transport');
    if(diagnosticOnly && (args.length !== 1 || args[0] !== '--version')) fail('DIAGNOSTIC_WRITE_FORBIDDEN', 'diagnostic');
    if(readOnly)fail('VERCEL_READ_WRITE_FORBIDDEN','vercel.read');
    // No await or provider read may separate this pure boundary check from the
    // actual CLI invocation. Keep its precise pre-launch error outside catch.
    if(args[0]==='deploy'&&manifest.legacyReleaseContainment)assertSelectionSource(cwd,manifest);
    if(args[0]==='promote'||args[0]==='deploy'&&args.includes('--prod'))assertCurrentFirstRuntimeOwnerRefresh(manifest);
    if (args[0] === 'promote' || args[0] === 'rollback' || args[0] === 'deploy' && args.includes('--prod')) assertProductionWriterContext(manifest);
    if (args[0] !== '--version') assertWriteCapability();
    try { return execute('vercel', [...args, '--scope', fcosConnectionIdentifier('vercel', 'Team'), '--cwd', cwd, '--no-color'], {
      cwd, env: args[0] === '--version' ? { PATH: cliEnv.PATH, HOME: cliEnv.HOME, CI: '1', NO_COLOR: '1' } : cliEnv, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(); } catch (error) {
      throw new ReleaseError('VERCEL_COMMAND_UNRESOLVED', 'vercel.write',
        'Read back this operation; command errors do not prove that submission did not occur.',
        { commandFailure: vercelCommandFailure(error, args[0]) });
    }
  };
  const api = async (path, { permitStatus, scopeTeam = true } = {}) => {
    if(readOnly){if(aliasReader&&path===productionAliasPath){await reader.admit();return aliasReader.getProductionAlias();}return reader.get(path);}
    const url = new URL(`https://api.vercel.com${path}`); if (scopeTeam) url.searchParams.set('teamId', target.vercelTeam);
    if (url.origin !== 'https://api.vercel.com' || !path.startsWith('/v')) fail('VERCEL_API_PATH');
    if (diagnosticOnly && !previewAdmissionReadAllowed(url, target)) fail('DIAGNOSTIC_READ_FORBIDDEN', 'diagnostic');
    let response;
    try { response = await fetchImpl(url, { headers: { authorization: `Bearer ${env.FCOS_HOSTED_VERCEL_TOKEN}` }, method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { fail('VERCEL_READ_UNAVAILABLE', 'vercel.read', 'Retry only the target-locked read.'); }
    if (response.redirected) fail('VERCEL_READ_REDIRECT', 'vercel.read');
    if (permitStatus) return response.status;
    if (!response.ok || response.redirected) fail(`VERCEL_READ_HTTP_${response.status}`, 'vercel.read');
    try { return await response.json(); } catch { fail('VERCEL_READ_JSON_INVALID', 'vercel.read'); }
  };
  const project = () => api(`/v9/projects/${target.vercelProject}`);
  const deployment = async id => {
    if (!/^(?:dpl_[A-Za-z0-9]+|[a-z0-9-]+\.vercel\.app)$/.test(id || '')) fail('DEPLOYMENT_REFERENCE');
    const value = await api(`/v13/deployments/${id}`);
    if (value.projectId !== target.vercelProject || value.teamId && value.teamId !== target.vercelTeam) fail('DEPLOYMENT_TARGET');
    if (sourceApi && value.ownerId !== target.vercelTeam) fail('DEPLOYMENT_TARGET');
    if(![null,undefined,'preview','production'].includes(value.target))fail('DEPLOYMENT_TARGET');
    const url = canonicalFcosE2eCandidateUrl(`https://${value.url}`);
    return { id: value.id, url, projectId: value.projectId, teamId: value.teamId || target.vercelTeam,
      sha: value.meta?.githubCommitSha, sourceSha256: value.meta?.fcosSourceSha256, target: value.target || 'preview', state: value.readyState,
      projectSettings: value.projectSettings, verificationSha256: value.meta?.fcosVerificationSha256, createdAt: value.createdAt, operationId: value.meta?.fcosHostedOperation, manifestHash: value.meta?.fcosHostedManifest,
      ...(sourceApi ? { sourceTransport: value.meta?.fcosSourceTransport, archiveSha256: value.meta?.fcosSourceArchiveSha256,
        inventorySha256: value.meta?.fcosSourceInventorySha256, configurationSha256: value.meta?.fcosSourceConfigurationSha256 } : {}),
      ...(manifest.legacyReleaseContainment || sourceApi ? {...selectionDeploymentMetadata(value),
        customEnvironment:value.customEnvironment??null,selectionGuardSha256:value.meta?.fcosConfigurationSelectionSha256} : {}) };
  };
  async function verifyArtifact(value, release, phase) {
    const protocol = release.runtime.probeProtocol, metered = protocol === 'xero_metered_v1';
    if (protocol !== undefined && !metered) fail('RUNTIME_PROBE_PROTOCOL', phase);
    if (metered && (!['preview','staged','live'].includes(phase) || typeof coordinator?.snapshot !== 'function'
      || typeof coordinator?.appendEvidence !== 'function')) fail('RUNTIME_PROBE_COORDINATOR_REQUIRED', phase);
    if (metered && startedRuntimeProbes.has(digest(runtimeProbeIntent(release, value.id, phase)))) fail('RUNTIME_PROBE_READBACK_REQUIRED', phase);
    const exact = await deployment(value.id);
    if (exact.state !== 'READY' || exact.sha !== release.candidate.sha || exact.manifestHash !== digest(release)
      || exact.target !== (phase === 'preview' ? 'preview' : 'production')) fail('ARTIFACT_IDENTITY', phase);
    if (exact.verificationSha256 !== digest(release.verification)) fail('ARTIFACT_BUILD_CONFIGURATION_MISMATCH', phase);
    if (!sourceApi) assertProjectConfiguration(exact.projectSettings, release.verification.projectSettings);
    let selection;
    if(release.legacyReleaseContainment || sourceApi){
      if(typeof coordinator?.snapshot!=='function')fail('CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN');
      const snapshot=await coordinator.snapshot({releaseId:release.releaseId,manifestHash:digest(release)});
      const sourcePhase=phase==='preview'?'preview.create':'production.stage',operationId=`${release.releaseId}-${sourcePhase.replaceAll('.','-')}`;
      const operation=snapshot.operations?.[sourcePhase];
      if(exact.operationId!==operationId||exact.sourceSha256!==release.candidate.sourceSha256)fail('CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN');
      if(sourceApi){
        selection=assertSelectionBuildEvidence(await api(`/v3/deployments/${exact.id}/events?direction=forward&follow=0&limit=-1&builds=1`),exact,release,
          {kind:'fcos_hosted_selection_source_api_build_v1',registration:snapshot.registration,operation});
      }else{
      const args=deploymentArguments(release,operationId,phase!=='preview');
      // An older resolved journal may predate sourceDeploy receipts. A fresh
      // authenticated owner GET plus the exact consumed request can prove its
      // source-build basis without changing that journal or inventing CLI success.
      const previous=operation?.evidence?.result;
      const providerReadback=previous&&!Object.hasOwn(previous,'sourceDeploy')&&!Object.hasOwn(previous,'sourceDeployReadback')
        ?{schemaVersion:1,kind:'fcos_hosted_vercel_source_deploy_readback_v1',basis:'authenticated_provider_owner_readback',
          operationId,phase:sourcePhase,requestHash:digest(selectionSourceDeployRequest(release,phase!=='preview')),manifestHash:digest(release),
          controllerSha:release.controller.sha,candidateSha:release.candidate.sha,argumentsSha256:digest(args),cliVersion:'54.20.1',deploymentId:exact.id}:undefined;
      selection=assertSelectionBuildEvidence(await api(`/v3/deployments/${exact.id}/events?direction=forward&follow=0&limit=-1&builds=1`),exact,release,
        {kind:'fcos_hosted_selection_source_build_v1',registration:snapshot.registration,operation,arguments:args,...(providerReadback?{providerReadback}:{})});
      }
    }
    if (sourceApi) {
      // Source-API preparation permits exactly this checked-in deployment
      // override. Require its authenticated consumed receipt and guarded build
      // proof above before comparing effective settings; project admission and
      // its configuration hash continue to use the unchanged project defaults.
      const settings = release.verification.projectSettings;
      assertProjectConfiguration(exact.projectSettings, settings.installCommand === 'npm install'
        ? { ...settings, installCommand: 'npm ci' } : settings);
    }
    const origin = phase === 'live' ? target.productionOrigin : exact.url;
    const bypass = phase === 'preview' ? env.FCOS_E2E_VERCEL_BYPASS : phase === 'staged' ? env.FCOS_PRODUCTION_VERIFICATION_BYPASS : undefined;
    const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : {};
    let response;
    try { response = await fetchImpl(`${origin}/app-version.json`, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { fail('ARTIFACT_READ_UNAVAILABLE', phase); }
    if (!response.ok || response.redirected) fail('ARTIFACT_READ_FAILED', phase);
    const version = await atReleaseBoundary('vercel.artifact.version', () => response.json());
    if (version.commit !== release.candidate.sha || version.deploymentId !== exact.id
      || version.provenance?.sourceDigest !== release.candidate.sourceSha256 || version.provenance.releaseEligible !== true) fail('ARTIFACT_SOURCE_MISMATCH', phase);
    const validateRuntime = runtime => {
      if (!runtime) fail('RUNTIME_OBSERVATION_MISSING', phase);
      if (phase === 'preview') {
        if (runtime.safety.readOnly !== true || Object.values(runtime.safety.externalActions).some(value => value !== false)
          || canonical({ flags: runtime.flags, safety: runtime.safety, auth: runtime.auth }) !== canonical(release.runtime.expectedPreview)) throw new ReleaseError('PREVIEW_RUNTIME_MISMATCH', phase,
            'Correct the bound inputs before starting a new operation.', {runtimeMismatch:runtimeMismatchDetail(release.runtime.expectedPreview,runtime,
              {manifestHash:digest(release),candidateSha:release.candidate.sha,deploymentId:exact.id})});
      } else {
        const expected = release.runtime.expectedProduction;
        try { assertProductionRuntimeReadback(runtime, { expectedRuntimeFlags: expected.flags, expectedRuntimeSafety: expected.safety, expectedRuntimeAuth: expected.auth }); }
        catch { fail('PRODUCTION_RUNTIME_MISMATCH', phase); }
      }
    };
    const observeRuntime = async requestId => {
      const runtimeToken = runtimeTokenProvider ? await runtimeTokenProvider({ origin: exact.url, deployment: exact })
        : phase === 'preview' ? env.FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN : env.FCOS_RELEASE_RUNTIME_TOKEN;
      return collectRuntimeObservation({ url: exact.url, deployment: exact, sourceDigest: release.candidate.sourceSha256,
        token: runtimeToken, requestId,
        protectionBypass: phase === 'preview' ? env.FCOS_E2E_VERCEL_BYPASS : env.FCOS_PRODUCTION_VERIFICATION_BYPASS, fetchImpl, now: now() });
    };
    let runtime;
    if (metered) {
      const intent = runtimeProbeIntent(release, exact.id, phase), intentKey = `runtime.probe.${phase}.intent`, resultKey = `runtime.probe.${phase}.result`;
      const binding = { releaseId: release.releaseId, manifestHash: digest(release) }, attempt = digest(intent);
      if (startedRuntimeProbes.has(attempt)) fail('RUNTIME_PROBE_READBACK_REQUIRED', phase);
      startedRuntimeProbes.add(attempt);
      const snapshot = await coordinator.snapshot(binding), registration = snapshot?.registration;
      if (snapshot?.epoch !== release.epoch || registration?.release_id !== release.releaseId || registration.epoch !== release.epoch
        || registration.manifest_hash !== binding.manifestHash || !registration.manifest || digest(registration.manifest) !== binding.manifestHash
        || !snapshot.checks || Object.getPrototypeOf(snapshot.checks) !== Object.prototype) fail('RUNTIME_PROBE_SNAPSHOT_INVALID', phase);
      const savedIntent = snapshot.checks[intentKey], savedResult = snapshot.checks[resultKey];
      if (savedIntent !== undefined && canonical(savedIntent) !== canonical({ key: intentKey, result: intent })) fail('RUNTIME_PROBE_INTENT_CHANGED', phase);
      if (savedResult !== undefined) {
        if (!savedIntent || !exactKeys(savedResult, ['key','result','capturedAt']) || savedResult.key !== resultKey
          || !exactKeys(savedResult.result, [...Object.keys(intent), 'runtime'])
          || canonical({ ...savedResult.result, kind: intent.kind, runtime: null }) !== canonical({ ...intent, runtime: null })) fail('RUNTIME_PROBE_RESULT_CHANGED', phase);
        runtime = savedResult.result.runtime;
        const captured = Date.parse(runtime?.capturedAt), created = typeof exact.createdAt === 'number' ? exact.createdAt : Date.parse(exact.createdAt), current = now();
        if (!sanitizedRuntimeShape(runtime)
          || savedResult.result.kind !== 'fcos_hosted_runtime_probe_result_v1' || savedResult.capturedAt !== runtime.capturedAt
          || runtime.deploymentId !== exact.id || runtime.sha !== release.candidate.sha || !Number.isFinite(captured) || !Number.isFinite(created)
          || captured < created || captured > current + 300000 || current - captured > PREVIEW_PARITY_POLICY.maxAgeSeconds * 1000) fail('RUNTIME_PROBE_RESULT_STALE', phase);
        validateRuntime(runtime);
      } else {
        if (savedIntent !== undefined) fail('RUNTIME_PROBE_READBACK_REQUIRED', phase);
        // This journal persists identity, not a lease CAS. The server's shared
        // request-UUID admission enforces the single Xero GET across callers.
        const ack = await coordinator.appendEvidence({ ...binding, key: intentKey, evidence: { result: intent } });
        if (!exactKeys(ack, ['appended']) || ack.appended !== true) fail('RUNTIME_PROBE_INTENT_ACK_INVALID', phase);
        runtime = await observeRuntime(intent.requestId);
        validateRuntime(runtime);
        const result = { ...intent, kind: 'fcos_hosted_runtime_probe_result_v1', runtime };
        const resultAck = await coordinator.appendEvidence({ ...binding, key: resultKey, evidence: { result, capturedAt: runtime.capturedAt } });
        if (!exactKeys(resultAck, ['appended']) || resultAck.appended !== true) fail('RUNTIME_PROBE_RESULT_ACK_INVALID', phase);
      }
      startedRuntimeProbes.delete(attempt);
    } else {
      runtime = await observeRuntime(); validateRuntime(runtime);
    }
    return { deployment: exact, version, runtime, ...(selection?{configurationSelection:selection}:{}) };
  }
  async function admit(release, phase) {
    admittedScope = undefined;
    admittedProject = undefined;
    step('vercel.manifest', () => {
      validateManifest(release);
      if (digest(release) !== digest(manifest)) fail('MANIFEST_CHANGED');
    });
    if(readOnly)return reader.admit();
    const production = phase.startsWith('production');
    if (sourceApi && production && (release.executionMode!=='release'||!release.verification?.vercelProductionWriterCredential)) fail('SOURCE_API_PRODUCTION_CONTEXT','vercel.transport');
    if (diagnosticOnly && phase !== 'preview') fail('DIAGNOSTIC_WRITE_FORBIDDEN', 'diagnostic');
    const previewBinding = release.verification?.vercelPreviewWriterCredential;
    const productionBinding = release.verification?.vercelProductionWriterCredential;
    step('vercel.context', () => {
      if (production && env.FCOS_HOSTED_CREDENTIAL_CLASS !== 'production' || !production && env.FCOS_HOSTED_CREDENTIAL_CLASS !== 'preview') fail('CREDENTIAL_CLASS_MISMATCH', phase);
      if (sourceApi) {
        assertHostedSetup({ manifest: release, env });
        if (!diagnosticOnly) assertHostedSourceContext({ manifest: release, env });
        if (!previewBinding && !production) fail('VERCEL_PREVIEW_WRITER_SETUP_REQUIRED', phase);
      }
      if(production)assertCurrentFirstRuntimeOwnerRefresh(release);
      if (!production && release.stage === 'qualification' && !previewBinding) fail('VERCEL_PREVIEW_WRITER_SETUP_REQUIRED', phase);
      if (previewBinding && production && digest(env.FCOS_HOSTED_VERCEL_TOKEN) === previewBinding.bearerSha256) fail('VERCEL_PREVIEW_WRITER_FOR_PRODUCTION', phase);
      if (productionBinding && !production && digest(env.FCOS_HOSTED_VERCEL_TOKEN) === productionBinding.bearerSha256) fail('VERCEL_PRODUCTION_WRITER_FOR_PREVIEW', phase);
      if (production && productionBinding) assertProductionWriterContext(release);
      if (previewBinding && !production) {
        assertHostedSetup({ manifest: release, env });
        // This alternative exists only in the capability that has no writer methods.
        if (!diagnosticOnly) assertHostedSourceContext({ manifest: release, env });
      }
    });
    if (previewBinding && !production) step('vercel.credential', () => assertVercelPreviewWriterSecret(previewBinding, { targets: target, env, now: now() }));
    step('vercel.source', () => {
      if (existsSync(join(cwd, 'vercel.ts'))) fail('EXECUTABLE_DEPLOY_CONFIGURATION', phase);
      const source = collectBuildProvenance({ cwd, env: {}, requireClean: true });
      if (source.commit !== release.candidate.sha || source.sourceDigest !== release.candidate.sourceSha256
        || digest(readFileSync(join(cwd, 'package-lock.json'))) !== release.candidate.lockSha256) fail('SOURCE_CHANGED', phase);
    });
    if (!sourceApi) step('vercel.version', () => { if (run(['--version']).replace(/^Vercel CLI /i, '') !== '54.20.1') fail('VERCEL_CLI_VERSION', phase); });
    const p = await step('vercel.project', async () => { const value = await project(); assertProjectConfiguration(value, release.verification.projectSettings); return value; });
    if(release.legacyReleaseContainment || sourceApi){
      step('vercel.selection_source', () => assertSelectionSource(cwd,release));
      await step('vercel.selection_environment', () => collectSelectionEnvironment({read:api,project:p,manifest:release}));
    }
    const originalWriter = production ? productionBinding : previewBinding;
    const token = originalWriter ? null : (await step('vercel.token', () => api('/v5/user/tokens/current', { scopeTeam: false }))).token;
    step('vercel.project_identity', () => {
      if (p.id !== target.vercelProject || p.accountId !== target.vercelTeam || p.name !== fcosConnectionIdentifier('vercel', 'Project')
        || p.link?.type !== 'github' || `${p.link.org}/${p.link.repo}` !== target.repository
        || p.autoAssignCustomDomains !== false || !Array.isArray(p.link.deployHooks) || p.link.deployHooks.length) fail('VERCEL_PROJECT_IDENTITY', phase);
      if (!originalWriter && (token?.id !== env.FCOS_HOSTED_VERCEL_TOKEN_ID || token.revokedAt || token.leakedAt || !Number.isFinite(Number(token.expiresAt))
        || Number(token.expiresAt) <= now() || !Array.isArray(token.scopes) || token.scopes.length !== 1
        || token.scopes[0].type !== 'team' || token.scopes[0].teamId !== target.vercelTeam
        || token.scopes[0].expiresAt && Number(token.scopes[0].expiresAt) <= now())) fail('VERCEL_TOKEN_AUTHORITY', phase);
    });
    const list = await step('vercel.project_list', () => api('/v9/projects?limit=100'));
    const userStatus = await step('vercel.user_scope', () => api('/v2/user', { permitStatus: true, scopeTeam: false }));
    const teamStatus = await step('vercel.team_scope', () => api(`/v2/teams/${target.vercelTeam}`, { permitStatus: true, scopeTeam: false }));
    step('vercel.effective_scope', () => {
      const userHidden = originalWriter ? [403, 404].includes(userStatus) : userStatus === 403;
      if (list.projects?.length !== 1 || list.projects[0].id !== target.vercelProject || list.pagination?.next !== null
        || list.pagination?.count !== 1 || !userHidden || teamStatus !== 403) fail('VERCEL_PROJECT_SCOPE', phase);
    });
    step('vercel.configuration', () => {
      const configuration = JSON.parse(readFileSync(join(cwd, 'vercel.json'), 'utf8')), enabled = configuration.git?.deploymentEnabled;
      if (!(enabled === false || enabled && typeof enabled === 'object' && enabled[p.link.productionBranch] === false)) fail('AUTOMATIC_DEPLOYMENT_ENABLED', phase);
    });
    if (!sourceApi) step('vercel.local_link', () => {
      const configDirectory = join(cwd, '.vercel'), configFile = join(configDirectory, 'project.json');
      const expected = { projectId: target.vercelProject, orgId: target.vercelTeam, projectName: p.name };
      if (existsSync(configDirectory) && (!lstatSync(configDirectory).isDirectory() || lstatSync(configDirectory).isSymbolicLink())
        || existsSync(configFile) && (!lstatSync(configFile).isFile() || lstatSync(configFile).isSymbolicLink())) fail('VERCEL_LINK_MISMATCH', phase);
      if (existsSync(configFile)) { if (canonical(JSON.parse(readFileSync(configFile))) !== canonical(expected)) fail('VERCEL_LINK_MISMATCH', phase); }
      else { mkdirSync(configDirectory, { recursive: true, mode: 0o700 }); writeFileSync(configFile, `${JSON.stringify(expected)}\n`, { mode: 0o600, flag: 'wx' }); }
    });
    admittedScope = { userStatus, teamStatus };
    admittedProject = p;
    return { credentialAuthority: production && productionBinding ? 'root_accepted_original_production_issuance'
      : previewBinding && !production ? 'root_accepted_original_issuance' : 'live_token_metadata',
      effectiveAccess: { userStatus, teamStatus, projectId: p.id, projectCount: list.pagination.count } };
  }
  if (diagnosticOnly) return Object.freeze({ admit: () => admit(manifest, 'preview') });

  async function create(release, context, production) {
    if (sourceApi) {
      const prepared = preparedPreviews.get(context?.operationId);
      if (!prepared || prepared.request.receipt.phase !== (production?'production.stage':'preview.create') || prepared.recoveryOnly || digest(release) !== digest(manifest)) fail('SOURCE_API_SUBMISSION_CONTEXT');
      return executeVercelSourceApiRequest({ prepared: prepared.request, manifest: release, context,
        token: env.FCOS_HOSTED_VERCEL_TOKEN, fetchImpl, assertWriteContext: () => {
          if(env.FCOS_HOSTED_CREDENTIAL_CLASS!==(production?'production':'preview'))fail('CREDENTIAL_CLASS_MISMATCH');assertWriteCapability(); } });
    }
    await admit(release, production ? 'production.stage' : 'preview');
    assertWriteCapability();
    const args=deploymentArguments(release, context.operationId, production);
    if(release.legacyReleaseContainment&&canonical(context.request)!==canonical(selectionSourceDeployRequest(release,production)))fail('CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN');
    const output = run(args);
    if (!/^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(output)) fail('DEPLOYMENT_RESPONSE_UNRESOLVED');
    const result=await deployment(new URL(output).hostname);
    if(!release.legacyReleaseContainment)return result;
    return {...result,sourceDeploy:{schemaVersion:1,kind:'fcos_hosted_vercel_source_deploy_v1',operationId:context.operationId,
      phase:production?'production.stage':'preview.create',requestHash:digest(context.request),manifestHash:digest(release),
      controllerSha:release.controller.sha,candidateSha:release.candidate.sha,argumentsSha256:digest(args),cliVersion:'54.20.1'}};
  }
  function bindExisting(request,existingOperation){
    if(existingOperation&&(existingOperation.requestHash!==request.receipt.requestHash||existingOperation.request_hash!==request.receipt.requestHash
      ||existingOperation.operationId!==request.receipt.operationId||existingOperation.operation_id!==request.receipt.operationId
      ||existingOperation.manifest_hash!==digest(manifest)))fail('SOURCE_API_RECOVERY_REQUEST_CHANGED');
  }
  function prepareAction(release,{operationId,existingOperation,staged,compatible,phase}){
    if(!sourceApi)return phase==='production.promote'?{deploymentId:staged.id,previousDeploymentId:release.previousProduction.deploymentId}
      :{from:staged.id,to:release.previousProduction.deploymentId,schemaSha256:compatible.schemaSha256,runtimeSha256:compatible.runtimeSha256};
    if(digest(release)!==digest(manifest)||env.FCOS_HOSTED_CREDENTIAL_CLASS!=='production')fail('SOURCE_API_WRITER_CONTEXT');
    assertWriteCapability();
    const request=prepareVercelProjectActionRequest({manifest:release,candidateDirectory:cwd,operationId,staged,compatible,phase});
    bindExisting(request,existingOperation);preparedActions.set(operationId,{request,recoveryOnly:Boolean(existingOperation)});return request.intent;
  }
  function executeAction(phase,context,deploymentId){
    const prepared=preparedActions.get(context?.operationId);
    if(!prepared||prepared.recoveryOnly||prepared.request.receipt.phase!==phase||prepared.request.receipt.deploymentId!==deploymentId)fail('SOURCE_API_ACTION_CONTEXT');
    return executeVercelProjectActionRequest({prepared:prepared.request,manifest,context,token:env.FCOS_HOSTED_VERCEL_TOKEN,fetchImpl,
      assertWriteContext:()=>{if(env.FCOS_HOSTED_CREDENTIAL_CLASS!=='production')fail('CREDENTIAL_CLASS_MISMATCH');assertWriteCapability();}});
  }
  const adapter = {
    admit, assertWriteCapability, verifyArtifact, collectCheck, inspect: deployment,
    verifyProjectActionRecoveryRequest: (release,context) => {
      if(!sourceApi)return undefined;
      if(digest(release)!==digest(manifest))fail('MANIFEST_CHANGED');
      return verifyVercelProjectActionRecoveryRequest({...context,manifest:release});
    },
    preparePreviewRequest: async (release, { operationId, existingOperation } = {}) => {
      if (!sourceApi) return { candidate: release.candidate, target: 'preview' };
      if (digest(release) !== digest(manifest) || !admittedProject) fail('SOURCE_API_WRITER_CONTEXT');
      const request = await prepareVercelSourceApiRequest({ manifest: release, candidateDirectory: cwd, observedProject: admittedProject, operationId });
      if (existingOperation && (existingOperation.requestHash !== request.receipt.requestHash
        || existingOperation.request_hash !== request.receipt.requestHash || existingOperation.operationId !== operationId
        || existingOperation.operation_id !== operationId || existingOperation.manifest_hash !== digest(release))) fail('SOURCE_API_RECOVERY_REQUEST_CHANGED');
      preparedPreviews.set(operationId, { request, recoveryOnly: Boolean(existingOperation) });
      return request.intent;
    },
    prepareStageRequest: async (release, { operationId, existingOperation } = {}) => {
      if(!sourceApi)return selectionSourceDeployRequest(release,true);
      if(digest(release)!==digest(manifest)||!admittedProject||env.FCOS_HOSTED_CREDENTIAL_CLASS!=='production')fail('SOURCE_API_WRITER_CONTEXT');
      assertWriteCapability();
      const request=await prepareVercelSourceApiRequest({manifest:release,candidateDirectory:cwd,observedProject:admittedProject,operationId,phase:'production.stage'});
      bindExisting(request,existingOperation);preparedPreviews.set(operationId,{request,recoveryOnly:Boolean(existingOperation)});return request.intent;
    },
    preparePromoteRequest: (release, { operationId, existingOperation, staged } = {}) => prepareAction(release,{operationId,existingOperation,staged,phase:'production.promote'}),
    prepareRollbackRequest: (release, { operationId, existingOperation, staged, compatible } = {}) => prepareAction(release,{operationId,existingOperation,staged,compatible,phase:'production.rollback'}),
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
    currentProduction: async () => {
      const p=await project();if(!sourceApi)return deployment(p.targets?.production?.id);
      if(p.id!==target.vercelProject||p.accountId!==target.vercelTeam)fail('DEPLOYMENT_TARGET');
      const alias=await api(productionAliasPath);
      if(alias.alias!==new URL(target.productionOrigin).hostname||alias.projectId!==target.vercelProject||alias.deletedAt!=null||alias.redirect!=null
        ||!/^dpl_[A-Za-z0-9]+$/.test(alias.deploymentId||'')||alias.deployment?.id!==alias.deploymentId)fail('PRODUCTION_ALIAS_BINDING');
      const current=await deployment(alias.deploymentId);
      if(current.target!=='production'||current.state!=='READY'||alias.deployment.url!==new URL(current.url).hostname)fail('PRODUCTION_ALIAS_BINDING');
      return current;
    },
    ready: value => deployment(value.id),
    discover: async (release, targetName, { operationId, request }) => {
      let sourceReadback;
      let sourceApiReadback;
      if(release.legacyReleaseContainment || sourceApi){
        if(digest(release)!==digest(manifest)||!['preview','production'].includes(targetName)||typeof coordinator?.snapshot!=='function')fail('CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN');
        let prepared=sourceApi?preparedPreviews.get(operationId)?.request:null;
        // A separate recovery run can reconstruct the deterministic request from
        // its immutable source and compare the original journal hash. This is
        // local preparation plus target-locked GETs, never a new write capability.
        if(sourceApi&&!prepared){
          prepared=await prepareVercelSourceApiRequest({manifest:release,candidateDirectory:cwd,observedProject:await project(),operationId,phase:targetName==='preview'?'preview.create':'production.stage'});
          preparedPreviews.set(operationId,{request:prepared,recoveryOnly:true});
        }
        if(sourceApi&&!prepared)fail('SOURCE_API_RECOVERY_REQUEST_CHANGED');
        const phase=targetName==='preview'?'preview.create':'production.stage',expectedRequest=sourceApi?prepared.intent:selectionSourceDeployRequest(release,targetName==='production');
        const requestHash=digest(expectedRequest),manifestHash=digest(release);
        const snapshot=await coordinator.snapshot({releaseId:release.releaseId,manifestHash}),r=snapshot.registration,o=snapshot.operations?.[phase];
        // Recovery reconstructs source-only argv from the same admitted controller
        // and consumed request hash. It never reconstructs a successful CLI ACK.
        if(operationId!==`${release.releaseId}-${phase.replaceAll('.','-')}`||request!==undefined&&canonical(request)!==canonical(expectedRequest)
          ||r?.release_id!==release.releaseId||r.epoch!==release.epoch||r.manifest_hash!==manifestHash||!r.manifest||canonical(r.manifest)!==canonical(release)
          ||!o||o.operationId!==operationId||o.operation_id!==operationId||o.release_id!==release.releaseId||o.epoch!==release.epoch
          ||o.phase!==phase||o.manifest_hash!==manifestHash||o.requestHash!==requestHash||o.request_hash!==requestHash
          ||!['intent','uncertain'].includes(o.state))fail('CONFIGURATION_SELECTION_SOURCE_BUILD_UNPROVEN');
        if(sourceApi)sourceApiReadback={...prepared.receipt,acknowledgement:'authenticated_provider_owner_readback'};
        else sourceReadback={schemaVersion:1,kind:'fcos_hosted_vercel_source_deploy_readback_v1',basis:'authenticated_provider_owner_readback',
          operationId,phase,requestHash,manifestHash,controllerSha:release.controller.sha,candidateSha:release.candidate.sha,
          argumentsSha256:digest(deploymentArguments(release,operationId,targetName==='production')),cliVersion:'54.20.1'};
      }
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
      if (result.sha !== release.candidate.sha || result.target !== targetName
        ||(sourceReadback||sourceApiReadback)&&(result.operationId!==operationId||result.manifestHash!==digest(release)
          ||result.sourceSha256!==release.candidate.sourceSha256||result.verificationSha256!==digest(release.verification)
          ||result.source!=='cli'||result.customEnvironment!==null)) fail('DEPLOYMENT_READBACK_MISMATCH');
      if(sourceApiReadback&&(result.sourceTransport!==SOURCE_API_TRANSPORT||result.archiveSha256!==sourceApiReadback.archive.sha256
        ||result.inventorySha256!==sourceApiReadback.inventorySha256||result.configurationSha256!==sourceApiReadback.configurationSha256))fail('DEPLOYMENT_READBACK_MISMATCH');
      return { outcome: 'applied', result:sourceApiReadback?{...result,sourceApi:{...sourceApiReadback,deploymentId:result.id}}
        :sourceReadback?{...result,sourceDeployReadback:{...sourceReadback,deploymentId:result.id}}:result };
    },
    promote: async (value,context) => {
      if(sourceApi)return executeAction('production.promote',context,value.id);
      if (manifest.verification?.vercelProductionWriterCredential) await admit(manifest, 'production.promote');
      run(['promote', value.id, '--yes']);
    },
    rollback: async (previous,context) => {
      if(sourceApi)return executeAction('production.rollback',context,previous.deploymentId);
      if (manifest.verification?.vercelProductionWriterCredential) await admit(manifest, 'production.rollback');
      run(['rollback', previous.deploymentId, '--yes']);
    },
    rollbackCompatibility: async (previous, release) => {
      if(previous.firstRuntime?.rollbackEligible===false)return {compatible:false,deploymentId:previous.deploymentId,reason:'legacy_runtime_compatibility_unobserved'};
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
  if(readOnly)return Object.fromEntries(['admit','verifyArtifact','collectCheck','inspect','observePreviousProduction','currentProduction','ready','discover','verifyProjectActionRecoveryRequest'].map(key=>[key,adapter[key]]));
  return adapter;
}

export function createVercelReadAdapter(options) { return createVercelAdapter({...options,readOnly:true}); }

/** Purpose-specific observation API: no full manifest, writer token, CLI or write methods. */
export function createVercelProductionObserver({ setup, env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const target = setup.targets;
  const transport = createVercelReadTransport({ binding: setup.vercelReadCredential, targets: target, env, fetchImpl, now });
  const read = async path => { await transport.configuration(); return transport.get(path); };
  const inspect = async id => {
    if (!/^dpl_[A-Za-z0-9]+$/.test(id || '')) fail('DISCOVERY_PRODUCTION_BINDING');
    const value = await read(`/v13/deployments/${id}`);
    if (value.id !== id || value.projectId !== target.vercelProject || value.ownerId !== target.vercelTeam
      || Object.hasOwn(value,'teamId') && value.teamId !== target.vercelTeam
      || value.target !== 'production' || value.readyState !== 'READY' || !/^[a-f0-9]{40}$/.test(value.meta?.githubCommitSha || '')) fail('DISCOVERY_PRODUCTION_BINDING');
    return { id: value.id, url: canonicalFcosE2eCandidateUrl(`https://${value.url}`), projectId: value.projectId, ownerId: value.ownerId, teamId: value.ownerId,
      sha: value.meta.githubCommitSha, state: value.readyState, target: value.target, createdAt: value.createdAt };
  };
  const projectAndAlias = async () => {
    const project = await read(`/v9/projects/${target.vercelProject}`);
    await transport.configuration();
    const alias = await transport.getProductionAlias();
    if (project.id !== target.vercelProject || project.accountId !== target.vercelTeam
      || project.name !== fcosConnectionIdentifier('vercel','Project') || project.link?.type !== 'github'
      || `${project.link.org}/${project.link.repo}` !== target.repository
      || alias.alias !== new URL(target.productionOrigin).hostname || alias.projectId !== target.vercelProject
      || alias.deletedAt != null || alias.redirect != null || alias.deploymentId !== project.targets?.production?.id
      || alias.deployment?.id !== alias.deploymentId) fail('DISCOVERY_PRODUCTION_BINDING');
    return { id: alias.deploymentId, url: alias.deployment.url };
  };
  const version = async origin => {
    const endpoint = `${origin}/app-version.json`;
    let response;
    const headers = origin !== target.productionOrigin && env.FCOS_PRODUCTION_VERIFICATION_BYPASS
      ? { 'x-vercel-protection-bypass': env.FCOS_PRODUCTION_VERIFICATION_BYPASS } : {};
    try { response = await fetchImpl(endpoint, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { fail('DISCOVERY_PUBLIC_VERSION'); }
    if (!response.ok || response.redirected || response.url && response.url !== endpoint
      || Number(response.headers?.get('content-length')) > 131072) fail('DISCOVERY_PUBLIC_VERSION');
    try { const text = await response.text(); if (Buffer.byteLength(text) > 131072) fail('DISCOVERY_PUBLIC_VERSION'); return JSON.parse(text); }
    catch { fail('DISCOVERY_PUBLIC_VERSION'); }
  };
  return { inspect, observe: async () => {
    const before = await projectAndAlias(), deployment = await inspect(before.id);
    if (before.url !== new URL(deployment.url).hostname) fail('DISCOVERY_PRODUCTION_BINDING');
    const publicVersion = await version(target.productionOrigin), immutableVersion = await version(deployment.url);
    const sourceSha256 = publicVersion.provenance?.sourceDigest, versionSha256 = digest(publicVersion);
    if (versionSha256 !== digest(immutableVersion) || publicVersion.commit !== deployment.sha
      || publicVersion.provenance?.commit !== deployment.sha || !/^[a-f0-9]{64}$/.test(sourceSha256 || '')
      || publicVersion.provenance?.sourceDigestAlgorithm !== 'sha256:fcos-vercel-source-v1') fail('DISCOVERY_PUBLIC_VERSION');
    let bindingMode = 'deployment_id';
    if (publicVersion.deploymentId !== deployment.id || publicVersion.provenance.sourceAttested !== true) {
      const legacy = setup.legacyProductionBinding;
      if (!legacy || legacy.deploymentId !== deployment.id || legacy.immutableUrl !== deployment.url
        || legacy.commit !== deployment.sha || legacy.sourceDigest !== sourceSha256 || legacy.publicVersionSha256 !== versionSha256
        || publicVersion.deploymentId !== null || publicVersion.provenance.sourceAttested !== false) fail('DISCOVERY_LEGACY_VERSION');
      bindingMode = 'exact_legacy_public_version';
    }
    const after = await projectAndAlias();
    if (after.id !== before.id || after.url !== before.url) fail('DISCOVERY_PRODUCTION_MOVED');
    return { readOnly: true, capturedAt: new Date(now()).toISOString(), deployment: { ...deployment, sourceSha256 },
      publicVersion: { sha256: versionSha256, commit: publicVersion.commit, deploymentId: publicVersion.deploymentId,
        sourceAttested: publicVersion.provenance.sourceAttested, builtAt: typeof publicVersion.builtAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z$/.test(publicVersion.builtAt) && publicVersion.builtAt.length <= 40 ? publicVersion.builtAt : null },
      bindingMode, ...(bindingMode === 'exact_legacy_public_version' ? { originalBinding: setup.legacyProductionBinding } : {}),
      qualificationAccepted: false, automaticRollbackEligible: false };
  } };
}
