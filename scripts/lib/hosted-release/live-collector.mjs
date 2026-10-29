import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { createHostedRuntimeTokenProvider } from './browser.mjs';
import { prepareCandidateProtection } from '../../e2e-protection-state.mjs';
import { request } from '@playwright/test';
import { collectRuntimeObservation } from '../../collect-preview-parity.mjs';
import { createVercelAdapter, createVercelReadAdapter, createVercelProductionObserver } from './vercel.mjs';
import { collectSchemaSnapshot, collectSchemaObservation, hostedProof } from './observations.mjs';
import { digest, fail } from './contract.mjs';
import { atReleaseBoundary } from './failure.mjs';
import { admittedFirstRuntimeBaseline, assertFirstRuntimeSetup, FIRST_RUNTIME, firstRuntimePrevious, firstRuntimeLegacyBinding, firstRuntimeSourceAbsence, isFirstRuntimePair, firstRuntimeVersionEvidence } from './first-runtime.mjs';
import { PREVIEW_PARITY_POLICY } from '../preview-parity.mjs';
import { observeLegacySalesforceApp } from './legacy-salesforce-app-observation.mjs';
import { observeLegacySalesforceIdentity as observeLegacySalesforceIdentityRead } from './legacy-salesforce-identity-observation.mjs';
import { loginLegacyHostedRuntime } from './legacy-hosted-runtime-login.mjs';

/** Read-only pre-manifest transport. It has no complete-manifest seed, writer
 * credential, deploy method, candidate execution or application secret input. */
export function createPreviousProductionObserver({context,setup,env=process.env,fetchImpl=fetch,now=Date.now,
  schemaObservation=()=>collectSchemaObservation({manifest:context,env,now}),login,protection=collectRuntimeProtectionState}={}) {
  const baseline=assertFirstRuntimeSetup({setup,manifest:context,now:now()});
  const observerSetup={targets:context.targets,vercelReadCredential:context.verification.vercelReadCredential,
    legacyProductionBinding:baseline?firstRuntimeLegacyBinding(setup.firstRuntimeBaseline,{now:now()}):null};
  const provider=createVercelProductionObserver({setup:observerSetup,env,fetchImpl,now});
  const tokenProvider=createHostedRuntimeTokenProvider({env,login,verifyTarget:async({origin,deployment})=>{
    const actual=await provider.inspect(deployment.id);
    if(actual.url!==origin||actual.sha!==deployment.sha||actual.state!=='READY')fail('RUNTIME_LOGIN_TARGET');
    return {verified:true,origin,deploymentId:actual.id,sha:actual.sha,sourceSha256:deployment.sourceSha256};
  }});
  return {observePreviousProduction:async()=>{
    const production=await provider.observe(),deployment=production.deployment,schema=await schemaObservation();
    if(baseline) {
      const current=admittedFirstRuntimeBaseline(setup.firstRuntimeBaseline,{now:now()});
      if(!isFirstRuntimePair({candidateSha:context.candidate.sha,previous:{deploymentId:deployment.id,sha:deployment.sha,url:deployment.url,sourceSha256:deployment.sourceSha256}})
        ||production.publicVersion.sha256!==firstRuntimeVersionEvidence(current)||schema.sha256!==current.schema.sha256)fail('FIRST_RUNTIME_BASELINE_CHANGED');
      return {readOnly:true,capturedAt:new Date(now()).toISOString(),previousProduction:firstRuntimePrevious(setup.firstRuntimeBaseline,{now:now()}),
        observationKind:current.source.observationKind,originalBaselineCapturedAt:current.runtime.capturedAt};
    }
    if(deployment.sha===FIRST_RUNTIME.previousSha)fail('FIRST_RUNTIME_BASELINE_NOT_ADMITTED');
    if(!env.FCOS_PRODUCTION_VERIFICATION_BYPASS)fail('RUNTIME_PROTECTION_SETUP_REQUIRED');
    const state=await protection({origin:deployment.url,sha:deployment.sha,bypass:env.FCOS_PRODUCTION_VERIFICATION_BYPASS});
    const token=await tokenProvider({origin:deployment.url,deployment,protectionState:state});
    const runtime=await collectRuntimeObservation({url:deployment.url,deployment,sourceDigest:deployment.sourceSha256,token,
      protectionBypass:env.FCOS_PRODUCTION_VERIFICATION_BYPASS,fetchImpl,now:now()});
    if(!runtime)fail('PREVIOUS_RUNTIME_UNOBSERVED');
    return {readOnly:true,capturedAt:new Date(now()).toISOString(),previousProduction:{deploymentId:deployment.id,sha:deployment.sha,sourceSha256:deployment.sourceSha256,
      schemaSha256:schema.sha256,runtimeSha256:digest({flags:runtime.flags,safety:runtime.safety,auth:runtime.auth})}};
  }};
}

export async function collectFcunoContract({ env = process.env, fetchImpl = fetch, now = Date.now }) {
  const pin = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
  const read = async name => {
    const url = `https://api.github.com/repos/${pin.providerRepository}/contents/${pin.contractPath}/${name}?ref=${pin.providerCommit}`;
    const response = await fetchImpl(url, { headers: { accept: 'application/vnd.github.raw+json',
      ...(env.FCOS_HOSTED_FCUNO_READ_TOKEN ? { authorization: `Bearer ${env.FCOS_HOSTED_FCUNO_READ_TOKEN}` } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || response.redirected) fail('FCUNO_CONTRACT_UNAVAILABLE', 'fcuno_contract');
    return Buffer.from(await response.arrayBuffer());
  };
  const contract = JSON.parse((await read('contract-manifest.json')).toString());
  const names = ['identity-sync-event.schema.json','oidc-claims.schema.json','release-manifest.schema.json'];
  if (contract.contractVersion !== pin.protocolVersion || contract.aggregateSha256 !== pin.contractSha256
    || contract.files?.map(row => row.path).join(',') !== names.join(',')) fail('FCUNO_CONTRACT_CHANGED');
  const aggregate = createHash('sha256');
  for (const name of names) { const bytes = await read(name); JSON.parse(bytes.toString());
    if (digest(bytes) !== contract.files.find(row => row.path === name)?.sha256) fail('FCUNO_CONTRACT_CHANGED');
    aggregate.update(name).update(Buffer.from([0])).update(bytes).update(Buffer.from([0])); }
  if (aggregate.digest('hex') !== pin.contractSha256) fail('FCUNO_CONTRACT_CHANGED');
  return { sha256: pin.contractSha256, commit: pin.providerCommit, capturedAt: new Date(now()).toISOString() };
}

export function createLiveCollector({ session, candidateDirectory, production = false, fetchImpl = fetch, now = Date.now }) {
  const { manifest, env } = session; let provider;
  const tokenProvider = createHostedRuntimeTokenProvider({ env, verifyTarget: async ({ origin, deployment }) => {
    const actual = await provider.inspect(deployment.id);
    if (actual.url !== origin || actual.sha !== deployment.sha || actual.state !== 'READY') fail('RUNTIME_LOGIN_TARGET');
    const sourceSha256 = deployment.sourceSha256 || (actual.id === manifest.previousProduction.deploymentId ? manifest.previousProduction.sourceSha256 : manifest.candidate.sourceSha256);
    return { verified: true, origin, deploymentId: actual.id, sha: actual.sha, sourceSha256 };
  } });
  const runtimeTokenProvider = async ({ origin, deployment }) => {
    const bypass = deployment.target === 'preview' ? env.FCOS_E2E_VERCEL_BYPASS : env.FCOS_PRODUCTION_VERIFICATION_BYPASS;
    if (!bypass) fail('RUNTIME_PROTECTION_SETUP_REQUIRED');
    const state = await atReleaseBoundary('runtime.protection', () => collectRuntimeProtectionState({ origin, sha: deployment.sha, bypass }));
    return atReleaseBoundary('runtime.identity', () => tokenProvider({ origin, deployment, protectionState: state }));
  };
  const adapter=production || env.FCOS_HOSTED_CREDENTIAL_CLASS==='preview'?createVercelAdapter:createVercelReadAdapter;
  provider = adapter({ manifest, candidateDirectory, env, fetchImpl, now, runtimeTokenProvider, coordinator: session.coordinator,
    schemaObservation: () => collectSchemaObservation({ manifest, env, now }) });
  let previewObservation;
  async function collect(id, snapshot) {
    const preview = snapshot.checks?.['preview.ready']?.result || snapshot.checks?.['preview.ready']?.evidence?.result;
    if (!preview) return null;
    let result, capturedAt;
    if (['preview_binding','runtime_parity'].includes(id)) {
      previewObservation ||= await provider.verifyArtifact(preview, manifest, 'preview');
      result = previewObservation; capturedAt = result.runtime.capturedAt;
    } else if (id === 'live_schema') { result = await collectSchemaObservation({ manifest, env, now }); capturedAt = result.capturedAt; }
    else if (id === 'fcuno_contract') { result = await collectFcunoContract({ env, fetchImpl, now }); capturedAt = result.capturedAt; }
    else return null; // Browser and business-owner proofs require their own admitted publishers.
    return hostedProof({ manifest, checkId: id, result, inputs: { candidate: manifest.candidate, preview: preview.id,
      runtime: manifest.runtime, migration: manifest.migration }, capturedAt, env });
  }
  provider.collectCheck = (id, _manifest, snapshot) => production && id !== 'live_schema' ? null : collect(id, snapshot);
  return { provider, collect };
}

export async function collectRuntimeProtectionState({ origin, sha, bypass, requestImpl = request }) {
  let state;
  await prepareCandidateProtection({ env: { FCOS_E2E_BASE_URL: origin, FCOS_E2E_CANDIDATE_URL: origin,
    FCOS_E2E_EXPECTED_COMMIT: sha, FCOS_E2E_VERCEL_BYPASS: bypass,
    FCOS_E2E_PROTECTION_STATE: join(tmpdir(), `fcos-hosted-memory-${randomUUID()}.json`) }, request: requestImpl,
    verify: async () => ({ candidateUrl: origin, commit: sha }), writeState: async ({ state: result }) => { state = result; } });
  if (!state) fail('RUNTIME_PROTECTION_UNOBSERVED');
  return state;
}

/** Dedicated discovery collectors return observations, never hosted check evidence. */
export function createSetupDiscoveryCollector({ setup, env = process.env, fetchImpl = fetch, now = Date.now,
  Client, login, protection = collectRuntimeProtectionState,controllerDirectory=env.FCOS_CONTROLLER_DIRECTORY,
  verifyLegacySource=firstRuntimeSourceAbsence,observeLegacySalesforce=observeLegacySalesforceApp,observeLegacySalesforceIdentity=observeLegacySalesforceIdentityRead } = {}) {
  const provider = createVercelProductionObserver({ setup, env, fetchImpl, now });
  const discoveryLogin=login||((setup.legacySalesforceAppObservation||setup.legacySalesforceIdentityObservation)
    ? options=>loginLegacyHostedRuntime({...options,publicAuth:setup.legacyRuntimeAuth,fetchImpl,now}) : undefined);
  const tokenProvider = createHostedRuntimeTokenProvider({ env, login:discoveryLogin, verifyTarget: async ({ origin, deployment }) => {
    const actual = await provider.inspect(deployment.id);
    if (actual.url !== origin || actual.sha !== deployment.sha || actual.state !== 'READY') fail('DISCOVERY_RUNTIME_TARGET');
    return { verified: true, origin, deploymentId: actual.id, sha: actual.sha, sourceSha256: deployment.sourceSha256 };
  } });
  return {
    production: provider.observe,
    schema: () => collectSchemaSnapshot({ targets: setup.targets, env, now, ...(Client ? { Client } : {}) }),
    runtime: async production => {
      const previous={deploymentId:production.deployment.id,sha:production.deployment.sha,url:production.deployment.url,sourceSha256:production.deployment.sourceSha256};
      if(isFirstRuntimePair({candidateSha:setup.candidateSha,previous})) {
        verifyLegacySource(controllerDirectory,setup.candidateSha);
        if(setup.firstRuntimeBaseline) {
          const baseline=admittedFirstRuntimeBaseline(setup.firstRuntimeBaseline,{now:now(),complete:false});
          if(firstRuntimeVersionEvidence(baseline)!==production.publicVersion.sha256)fail('FIRST_RUNTIME_BASELINE_CHANGED');
          return {kind:'first_runtime_baseline_observation',readOnly:true,endpointAbsent:true,baselineSha256:setup.firstRuntimeBaseline.sha256,
            observationKind:baseline.source.observationKind,runtime:baseline.runtime,authHistorical:true,freshOwnerObservationRequired:true,
            ...(baseline.schemaVersion===2?{configurationCopy:baseline.configurationCopy,desiredRuntime:baseline.desiredRuntime,historicalRuntimeUnobserved:true}:{}),
            baselineRequired:baseline.schemaVersion===2||PREVIEW_PARITY_POLICY.requiredAuth.some(p=>baseline.runtime.auth[p].state!=='authenticated'),qualificationAccepted:false,automaticRollbackEligible:false};
        }
        let endpointAbsent=null,endpointObservation={status:'not_observed'};
        if(env.FCOS_PRODUCTION_VERIFICATION_BYPASS)try {
          const url=`${previous.url}/api/connection-runtime`,response=await fetchImpl(url,{method:'GET',headers:{'x-vercel-protection-bypass':env.FCOS_PRODUCTION_VERIFICATION_BYPASS},redirect:'error',signal:AbortSignal.timeout(5000)});
          if(response.status===404&&!response.redirected&&(!response.url||response.url===url)) {
            endpointAbsent=true;endpointObservation={url,method:'GET',httpStatus:404,redirected:false,capturedAt:new Date(now()).toISOString()};
          }
        } catch { /* Source absence alone never proves the deployed HTTP route. */ }
        let legacySalesforceAppObservation,legacySalesforceIdentityObservation;
        if(setup.legacySalesforceAppObservation||setup.legacySalesforceIdentityObservation) {
          const email=env.FCOS_HOSTED_RUNTIME_EMAIL?.trim().toLowerCase();
          if(!email||digest(email)!==setup.runtimeIdentity.emailSha256||env.FCOS_HOSTED_RUNTIME_EXPECTED_ROLE!==setup.runtimeIdentity.role)fail('DISCOVERY_RUNTIME_IDENTITY');
          if(!env.FCOS_PRODUCTION_VERIFICATION_BYPASS)fail('DISCOVERY_RUNTIME_PROTECTION');
          if(setup.legacySalesforceAppObservation)legacySalesforceAppObservation=await observeLegacySalesforce({binding:setup.legacySalesforceAppObservation,production,controllerDirectory,
            tokenProvider,protection,recheckProduction:provider.observe,bypass:env.FCOS_PRODUCTION_VERIFICATION_BYPASS,fetchImpl,now});
          if(setup.legacySalesforceIdentityObservation)legacySalesforceIdentityObservation=await observeLegacySalesforceIdentity({binding:setup.legacySalesforceIdentityObservation,production,controllerDirectory,
            publicAuth:setup.legacyRuntimeAuth,tokenProvider,protection,recheckProduction:provider.observe,bypass:env.FCOS_PRODUCTION_VERIFICATION_BYPASS,fetchImpl,now});
          const after=await provider.observe();
          if(after.deployment.id!==production.deployment.id||after.deployment.sha!==production.deployment.sha
            ||after.deployment.sourceSha256!==production.deployment.sourceSha256||after.publicVersion.sha256!==production.publicVersion.sha256)fail('DISCOVERY_PRODUCTION_MOVED');
        }
        return {kind:endpointAbsent?'first_runtime_endpoint_absent':'first_runtime_source_absent',readOnly:true,sourceAbsent:true,endpointAbsent,endpointObservation,baselineRequired:true,qualificationAccepted:false,automaticRollbackEligible:false,
          deploymentId:previous.deploymentId,sha:previous.sha,flags:Object.fromEntries(PREVIEW_PARITY_POLICY.runtimeFlags.map(k=>[k,{state:'unknown'}])),safety:{readOnly:null},auth:{},
          ...(legacySalesforceAppObservation?{legacySalesforceAppObservation}:{}),...(legacySalesforceIdentityObservation?{legacySalesforceIdentityObservation}:{})};
      }
      const email = env.FCOS_HOSTED_RUNTIME_EMAIL?.trim().toLowerCase();
      if (!email || digest(email) !== setup.runtimeIdentity.emailSha256
        || env.FCOS_HOSTED_RUNTIME_EXPECTED_ROLE !== setup.runtimeIdentity.role) fail('DISCOVERY_RUNTIME_IDENTITY');
      if (!env.FCOS_PRODUCTION_VERIFICATION_BYPASS) fail('DISCOVERY_RUNTIME_PROTECTION');
      const deployment = production.deployment, origin = deployment.url;
      const protectionState = await protection({ origin, sha: deployment.sha, bypass: env.FCOS_PRODUCTION_VERIFICATION_BYPASS });
      const token = await tokenProvider({ origin, deployment, protectionState });
      const observation = await collectRuntimeObservation({ url: origin, deployment, sourceDigest: deployment.sourceSha256,
        token, protectionBypass: env.FCOS_PRODUCTION_VERIFICATION_BYPASS, fetchImpl, now: now() });
      if (!observation) fail('DISCOVERY_RUNTIME_UNOBSERVED');
      return observation;
    },
  };
}
