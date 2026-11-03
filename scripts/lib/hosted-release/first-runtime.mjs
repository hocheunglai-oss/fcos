import { createHash } from 'node:crypto';
import { isFirstRuntimeCandidateSha, firstRuntimeCandidateProfile } from '../../../config/hostedCompatibilityCorrection.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { FIRST_RUNTIME_ROLLOUT, immutableCompatibilityBaseline } from '../runtime-compatibility-release.mjs';
import { OBSERVATION_DECLARATIONS, LEGACY_XERO_MAPPING_READ_BINDING } from '../runtime-compatibility-observation.mjs';
import { PREVIEW_PARITY_POLICY } from '../preview-parity.mjs';
import { SUCCESSOR_LIVE_CONTRACT } from '../runtime-compatibility-successor-live.mjs';
import { fcosConnectionIdentifier, fcosSalesforceEnvironment, FCOS_CONNECTION_POLICY } from '../../../config/fcosConnections.js';
import { collectCompatibilityBaselineRuntime } from '../../runtime-compatibility-release.mjs';

export const FIRST_RUNTIME = Object.freeze({ ...FIRST_RUNTIME_ROLLOUT, candidateSha: SUCCESSOR_LIVE_CONTRACT.candidateSha,
  sourceSha256: '9ce0445de15bff7992867e689328c1189b9c586a850149f5ad26384482f1b7f6', exception: 'previous-runtime-endpoint-absent-v1' });
const object = v => v !== null && Object.getPrototypeOf(v) === Object.prototype;
const canonical = v => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
export const firstRuntimeDigest = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(canonical(v))).digest('hex');
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k=>Object.hasOwn(v,k));
function need(value,code='FIRST_RUNTIME_BASELINE_INVALID') { if(!value)throw Object.assign(new Error(code),{code}); }
const timestamp = (value,now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value)<=now+30000;
const fresh = (value,now) => timestamp(value,now) && now-Date.parse(value)<=PREVIEW_PARITY_POLICY.maxAgeSeconds*1000;
const sourcePins = () => ({ helperRevision:firstRuntimeDigest(readFileSync(new URL('../runtime-compatibility-observation.mjs',import.meta.url))),
  declarationsSha256:firstRuntimeDigest(JSON.stringify({pure:OBSERVATION_DECLARATIONS,legacyRead:LEGACY_XERO_MAPPING_READ_BINDING})), observationKind:'independent_provider_probe_and_verified_deployment_configuration' });
/** Exact verified interpreter dependencies, not a prefix-based platform allowlist.
 * An absent value is usable only when the immutable deployment inventory proves
 * it absent. Unneeded platform values are explicitly left unobserved. */
export function firstRuntimeConfigurationDependencies() {
  const helper=readFileSync(new URL('../runtime-compatibility-observation.mjs',import.meta.url),'utf8');
  const sections=OBSERVATION_DECLARATIONS.map((_,i)=>helper.split(`// BEGIN IMMUTABLE PURE ${i}\n`)[1]?.split(`// END IMMUTABLE PURE ${i}\n`)[0]);
  need(sections.every(Boolean),'FIRST_RUNTIME_SOURCE_CHANGED');
  const pure=sections.join('\n'),collector=collectCompatibilityBaselineRuntime.toString(),keys=new Set();
  for(const text of [pure,collector])for(const match of text.matchAll(/\b(?:env|privateEnvironment)\s*(\.[A-Za-z_$][\w$]*|\[[^\]]*\])/g)) {
    const name=match[1];if(name==='[definition.envName]')continue;
    need(/^\.[A-Z][A-Z0-9_]*$/.test(name),'FIRST_RUNTIME_CONFIGURATION_DEPENDENCY_UNKNOWN');keys.add(name.slice(1));
  }
  for(const match of pure.matchAll(/envName:\s*'([A-Z][A-Z0-9_]*)'/g))keys.add(match[1]);
  const result=[...keys].sort();return {keys:result,sha256:firstRuntimeDigest({source:sourcePins(),collectorSha256:firstRuntimeDigest(collector),keys:result})};
}
export const firstRuntimeTargets = () => ({repository:fcosConnectionIdentifier('github','Repository'),vercelTeam:fcosConnectionIdentifier('vercel','Team ID'),
  vercelProject:fcosConnectionIdentifier('vercel','Project ID'),supabaseProject:fcosConnectionIdentifier('supabase','Project ref'),productionOrigin:new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).origin});
export function isFirstRuntimePair({candidateSha,previous}={}) {return isFirstRuntimeCandidateSha(candidateSha)&&previous?.deploymentId===FIRST_RUNTIME.previousDeploymentId
  &&previous.sha===FIRST_RUNTIME.previousSha&&previous.url===FIRST_RUNTIME.previousUrl&&previous.sourceSha256===FIRST_RUNTIME.sourceSha256;}
export function firstRuntimeSourceAbsence(controllerDirectory,candidateSha=FIRST_RUNTIME.candidateSha) {
  need(isFirstRuntimeCandidateSha(candidateSha),'FIRST_RUNTIME_SOURCE_CAPABILITY');
  const git=args=>execFileSync('git',args,{cwd:controllerDirectory,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const base=git(['ls-tree','--name-only',FIRST_RUNTIME.previousSha,'api/connection-runtime.js','api/_connectionRuntime.js']).trim();
  const candidate=git(['ls-tree','--name-only',candidateSha,'api/connection-runtime.js','api/_connectionRuntime.js']).trim().split('\n');
  need(!base&&candidate.length===2&&candidate.includes('api/connection-runtime.js')&&candidate.includes('api/_connectionRuntime.js'),'FIRST_RUNTIME_SOURCE_CAPABILITY');
  return {sourceAbsent:true,previousSha:FIRST_RUNTIME.previousSha,candidateSha};
}
const nativeKeys=['identitySha256','projectSha256','deploymentSha256','aliasBeforeSha256','aliasAfterSha256','versionSha256','environmentInventorySha256','environmentValuesSha256','endpointAbsenceSha256','schemaSha256'];
function validateRuntime(runtime,previous,now,complete,volatile=false,application=false) {
  need(exact(runtime,['capturedAt','deploymentId','sha','flags','safety','auth'])&&runtime.deploymentId===previous.deploymentId&&runtime.sha===previous.sha
    &&(volatile?fresh:timestamp)(runtime.capturedAt,now));
  need(exact(runtime.flags,PREVIEW_PARITY_POLICY.runtimeFlags)&&Object.values(runtime.flags).every(v=>exact(v,['state','value'])&&v.state==='known'&&typeof v.value==='boolean'));
  need(exact(runtime.safety,['readOnly','externalActions'])&&typeof runtime.safety.readOnly==='boolean'&&exact(runtime.safety.externalActions,PREVIEW_PARITY_POLICY.externalActions)
    &&Object.values(runtime.safety.externalActions).every(v=>typeof v==='boolean'));
  const providers=['supabase','salesforce','xero','drive','fcuno','microsoft','openai'];need(exact(runtime.auth,providers));
  for(const [provider,entry] of Object.entries(runtime.auth)) {
    need(exact(entry,['state','target','mode'])&&['unknown','authenticated'].includes(entry.state)&&typeof entry.target==='string'&&entry.target.length<=200&&typeof entry.mode==='string'&&entry.mode.length<=30);
    if(entry.state==='authenticated')need(['service_role','secret_key','oauth','jwt','oidc','application'].includes(entry.mode)&&/^[A-Za-z0-9_@./:-]{1,200}$/.test(entry.target));
    if(complete&&PREVIEW_PARITY_POLICY.requiredAuth.includes(provider))need(entry.state==='authenticated','FIRST_RUNTIME_BASELINE_INCOMPLETE');
    if(!PREVIEW_PARITY_POLICY.requiredAuth.includes(provider))need(entry.state==='unknown'&&entry.target===''&&entry.mode==='');
  }
  need(runtime.auth.supabase.target===firstRuntimeTargets().supabaseProject&&['','service_role','secret_key'].includes(runtime.auth.supabase.mode));
  need(runtime.auth.salesforce.target===fcosSalesforceEnvironment('production').orgId&&['','oauth','jwt',...(application?['application']:[])].includes(runtime.auth.salesforce.mode));
  need((runtime.auth.xero.target===''||/^[0-9a-f-]{36}$/i.test(runtime.auth.xero.target))&&['','oauth'].includes(runtime.auth.xero.mode));
  if(runtime.auth.supabase.state==='authenticated')need(runtime.auth.supabase.target===firstRuntimeTargets().supabaseProject&&['service_role','secret_key'].includes(runtime.auth.supabase.mode));
  if(runtime.auth.salesforce.state==='authenticated')need(runtime.auth.salesforce.target===fcosSalesforceEnvironment('production').orgId&&['oauth','jwt',...(application?['application']:[])].includes(runtime.auth.salesforce.mode));
  if(runtime.auth.xero.state==='authenticated')need(/^[0-9a-f-]{36}$/i.test(runtime.auth.xero.target)&&runtime.auth.xero.mode==='oauth');
}
export function validateFirstRuntimeEvidence(value,{now=Date.now(),complete=true}={}) {
  if(value?.schemaVersion===2)return validateTypedFirstRuntimeEvidence(value,{now});
  need(exact(value,['schemaVersion','kind','candidateSha','targets','previous','source','configuration','endpointAbsence','schema','nativeEvidence','runtime'])
    &&value.schemaVersion===1&&value.kind==='fcos_first_runtime_baseline_v1'&&value.candidateSha===FIRST_RUNTIME.candidateSha&&firstRuntimeDigest(value.targets)===firstRuntimeDigest(firstRuntimeTargets()));
  need(exact(value.previous,['deploymentId','sha','url','sourceSha256','createdAt'])&&isFirstRuntimePair({candidateSha:value.candidateSha,previous:value.previous})&&Number.isFinite(Date.parse(value.previous.createdAt)));
  need(exact(value.source,['helperRevision','declarationsSha256','observationKind'])&&firstRuntimeDigest(value.source)===firstRuntimeDigest(sourcePins()),'FIRST_RUNTIME_SOURCE_CHANGED');
  const c=value.configuration;
  need(exact(c,['complete','deploymentId','sha','capturedAt','reader','updatedAt','keys','recordKeys','observedKeys','absentDependencies','unobservedKeys','dependencySha256','valuesSha256'])&&c.complete===true&&c.deploymentId===value.previous.deploymentId&&c.sha===value.previous.sha
    &&timestamp(c.capturedAt,now)&&c.reader===`/v10/projects/${value.targets.vercelProject}/env?target=production&decrypt=true`
    &&timestamp(c.updatedAt,now)&&Date.parse(c.updatedAt)<=Date.parse(value.previous.createdAt)&&hash(c.valuesSha256)&&hash(c.dependencySha256)
    &&['keys','recordKeys','observedKeys','absentDependencies','unobservedKeys'].every(k=>Array.isArray(c[k])&&c[k].length<=512&&new Set(c[k]).size===c[k].length&&c[k].every(n=>/^[A-Z][A-Z0-9_]{0,127}$/.test(n)))
    &&c.keys.length>0&&c.observedKeys.every(k=>c.keys.includes(k))&&c.unobservedKeys.every(k=>c.keys.includes(k)&&!c.observedKeys.includes(k))
    &&c.keys.length===c.observedKeys.length+c.unobservedKeys.length&&c.absentDependencies.every(k=>!c.keys.includes(k)),'FIRST_RUNTIME_CONFIGURATION_INCOMPLETE');
  const dependencies=firstRuntimeConfigurationDependencies();
  need(c.dependencySha256===dependencies.sha256&&c.recordKeys.length>0&&c.recordKeys.every(k=>c.keys.includes(k))
    &&c.observedKeys.every(k=>k==='VERCEL_ENV'||c.recordKeys.includes(k))&&dependencies.keys.every(k=>c.observedKeys.includes(k)||c.absentDependencies.includes(k))
    &&c.absentDependencies.every(k=>dependencies.keys.includes(k)),'FIRST_RUNTIME_CONFIGURATION_DEPENDENCY_UNKNOWN');
  need(exact(value.nativeEvidence,nativeKeys)&&nativeKeys.every(k=>hash(value.nativeEvidence[k]))&&value.nativeEvidence.environmentValuesSha256===c.valuesSha256);
  const e=value.endpointAbsence;need(exact(e,['url','method','httpStatus','redirected','sourceAbsent','capturedAt'])&&e.url===`${FIRST_RUNTIME.previousUrl}/api/connection-runtime`
    &&e.method==='GET'&&e.httpStatus===404&&e.redirected===false&&e.sourceAbsent===true&&timestamp(e.capturedAt,now),'FIRST_RUNTIME_ENDPOINT_ABSENCE_REQUIRED');
  need(exact(value.schema,['projectRef','sha256','capturedAt','readOnly'])&&value.schema.projectRef===value.targets.supabaseProject&&hash(value.schema.sha256)&&timestamp(value.schema.capturedAt,now)&&value.schema.readOnly===true);
  validateRuntime(value.runtime,value.previous,now,complete);
  need(Date.parse(value.runtime.capturedAt)>=Date.parse(value.previous.createdAt));return value;
}
export function admittedFirstRuntimeBaseline(reference,{now=Date.now(),complete=true}={}) {
  need(exact(reference,['json','sha256','acceptance'])&&typeof reference.json==='string'&&Buffer.byteLength(reference.json)<=49152&&hash(reference.sha256)
    &&firstRuntimeDigest(reference.json)===reference.sha256,'FIRST_RUNTIME_BASELINE_NOT_ADMITTED');
  let value,review;try{value=JSON.parse(reference.json);review=JSON.parse(reference.acceptance?.json);}catch{need(false,'FIRST_RUNTIME_BASELINE_NOT_ADMITTED');}
  validateFirstRuntimeEvidence(value,{now,complete});const acceptance=reference.acceptance;
  if(value.schemaVersion===2){validateTypedFirstRuntimeReview(reference,value,review,now);return value;}
  need(exact(acceptance,['json','sha256'])&&typeof acceptance.json==='string'&&Buffer.byteLength(acceptance.json)<=8192&&firstRuntimeDigest(acceptance.json)===acceptance.sha256
    &&exact(review,['schemaVersion','kind','accepted','reviewerId','repository','baselineSha256','nativeEvidenceSha256','reviewedAt'])&&review.schemaVersion===1
    &&review.kind==='fcos_root_accepted_first_runtime_baseline_v1'&&review.accepted===true&&review.reviewerId==='/root'&&review.repository===value.targets.repository
    &&review.baselineSha256===reference.sha256&&review.nativeEvidenceSha256===firstRuntimeDigest(value.nativeEvidence)&&Number.isFinite(Date.parse(review.reviewedAt))
    &&Date.parse(review.reviewedAt)>=Date.parse(value.runtime.capturedAt)&&Date.parse(review.reviewedAt)<=now+30000,'FIRST_RUNTIME_BASELINE_REVIEW_REQUIRED');
  return value;
}
export function firstRuntimePrevious(reference,options) {
  const value=admittedFirstRuntimeBaseline(reference,options),runtime={flags:value.runtime.flags,safety:value.runtime.safety,auth:value.runtime.auth};
  return {deploymentId:value.previous.deploymentId,sha:value.previous.sha,sourceSha256:value.previous.sourceSha256,schemaSha256:value.schema.sha256,runtimeSha256:firstRuntimeDigest(runtime),
    firstRuntime:{kind:value.schemaVersion===2?TYPED_FIRST_RUNTIME_EXCEPTION:FIRST_RUNTIME.exception,baselineSha256:reference.sha256,previousUrl:value.previous.url,candidateSha:value.candidateSha,rollbackEligible:false,
      ...(value.schemaVersion===2?{desiredRuntimeSha256:firstRuntimeDigest(value.desiredRuntime)}:{})}};
}
export function assertFirstRuntimeManifest(manifest) {
  const prior=manifest.previousProduction,first=prior?.firstRuntime;if(!first)return false;
  const typed=first.kind===TYPED_FIRST_RUNTIME_EXCEPTION;
  need(exact(first,['kind','baselineSha256','previousUrl','candidateSha','rollbackEligible',...(typed?['desiredRuntimeSha256']:[])])
    &&(typed||first.kind===FIRST_RUNTIME.exception)&&hash(first.baselineSha256)&&first.rollbackEligible===false&&(!typed||hash(first.desiredRuntimeSha256)
      &&first.desiredRuntimeSha256===manifest.runtime?.expectedSha256&&first.desiredRuntimeSha256===firstRuntimeDigest(manifest.runtime.expectedProduction))
    &&['compatibility','qualification'].includes(manifest.stage)&&manifest.candidate?.sha===first.candidateSha
    &&manifest.candidate?.sourceProfile===firstRuntimeCandidateProfile(first.candidateSha)
    &&(typed||first.candidateSha===FIRST_RUNTIME.candidateSha)
    &&manifest.scope?.existingUi===false&&Array.isArray(manifest.scope.handoffs)&&manifest.scope.handoffs.length===0
    &&isFirstRuntimePair({candidateSha:first.candidateSha,previous:{...prior,url:first.previousUrl}}),'FIRST_RUNTIME_SCOPE_CHANGED');return true;
}
export function assertFirstRuntimeSetup({setup,manifest,now=Date.now()}) {
  if(!setup.firstRuntimeBaseline){need(!manifest.previousProduction?.firstRuntime,'FIRST_RUNTIME_BASELINE_NOT_ADMITTED');return null;}
  const expected=firstRuntimePrevious(setup.firstRuntimeBaseline,{now});
  assertFirstRuntimeManifest({...manifest,previousProduction:manifest.previousProduction||expected});
  if(!manifest.previousProduction)return admittedFirstRuntimeBaseline(setup.firstRuntimeBaseline,{now});
  need(firstRuntimeDigest(manifest.previousProduction)===firstRuntimeDigest(expected),'FIRST_RUNTIME_BASELINE_CHANGED');
  const baseline=admittedFirstRuntimeBaseline(setup.firstRuntimeBaseline,{now});
  need(manifest.migration?.expectedSchemaSha256===baseline.schema.sha256&&manifest.runtime?.expectedSha256===(baseline.schemaVersion===2?firstRuntimeDigest(baseline.desiredRuntime):expected.runtimeSha256)
    &&firstRuntimeDigest(manifest.runtime.expectedProduction)===manifest.runtime.expectedSha256,'FIRST_RUNTIME_BASELINE_CHANGED');return baseline;
}
export function firstRuntimeLegacyBinding(reference,options) {
  const v=admittedFirstRuntimeBaseline(reference,options);return {kind:'fcos_discovery_legacy_public_version',teamId:v.targets.vercelTeam,projectId:v.targets.vercelProject,
    productionOrigin:v.targets.productionOrigin,deploymentId:v.previous.deploymentId,immutableUrl:v.previous.url,commit:v.previous.sha,sourceDigest:v.previous.sourceSha256,
    sourceDigestAlgorithm:'sha256:fcos-vercel-source-v1',publicVersionSha256:firstRuntimeVersionEvidence(v),sourceAttested:false,
    providerEvidenceSha256:v.schemaVersion===2?v.nativeEvidence.deployment.sha256:v.nativeEvidence.deploymentSha256,versionEvidenceSha256:firstRuntimeVersionEvidence(v),capturedAt:v.runtime.capturedAt};
}

/** Durable baseline auth is historical. This separately admitted public input
 * is refreshed by the original credential owner, never by candidate code. */
export function validateFirstRuntimeOwnerRefresh(reference,{baselineReference,expectedSha256,now=Date.now()}={}) {
  const baseline=admittedFirstRuntimeBaseline(baselineReference,{now});
  if(baseline.schemaVersion===2)return validateTypedOwnerRefresh(reference,{baselineReference,baseline,expectedSha256,now});
  need(reference&&expectedSha256,'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');
  need(exact(reference,['json','sha256','acceptance'])&&typeof reference.json==='string'&&Buffer.byteLength(reference.json)<=49152
    &&reference.sha256===expectedSha256&&firstRuntimeDigest(reference.json)===reference.sha256,'FIRST_RUNTIME_OWNER_REFRESH_INVALID');
  let value,review;try{value=JSON.parse(reference.json);review=JSON.parse(reference.acceptance?.json);}catch{need(false,'FIRST_RUNTIME_OWNER_REFRESH_INVALID');}
  need(exact(value,['schemaVersion','kind','baselineSha256','targets','previous','configurationSha256','identityCapturedAt','schema','runtime','nativeEvidence'])
    &&value.schemaVersion===1&&value.kind==='fcos_first_runtime_original_owner_refresh_v1'&&value.baselineSha256===baselineReference.sha256
    &&firstRuntimeDigest(value.targets)===firstRuntimeDigest(baseline.targets)&&firstRuntimeDigest(value.previous)===firstRuntimeDigest(baseline.previous)
    &&value.configurationSha256===baseline.configuration.valuesSha256&&exact(value.nativeEvidence,nativeKeys)&&nativeKeys.every(k=>hash(value.nativeEvidence[k]))
    &&value.nativeEvidence.versionSha256===baseline.nativeEvidence.versionSha256,'FIRST_RUNTIME_OWNER_REFRESH_INVALID');
  need(exact(value.schema,['projectRef','sha256','capturedAt','readOnly'])&&value.schema.projectRef===baseline.targets.supabaseProject&&value.schema.readOnly===true
    &&value.schema.sha256===baseline.schema.sha256,'FIRST_RUNTIME_BASELINE_CHANGED');
  validateRuntime(value.runtime,baseline.previous,now,false);
  const a=reference.acceptance;
  need(exact(a,['json','sha256'])&&typeof a.json==='string'&&Buffer.byteLength(a.json)<=8192&&firstRuntimeDigest(a.json)===a.sha256
    &&exact(review,['schemaVersion','kind','accepted','reviewerId','repository','baselineSha256','observationSha256','nativeEvidenceSha256','reviewedAt'])&&review.schemaVersion===1
    &&review.kind==='fcos_root_accepted_first_runtime_owner_refresh_v1'&&review.accepted===true&&review.reviewerId==='/root'&&review.repository===baseline.targets.repository
    &&review.baselineSha256===baselineReference.sha256&&review.observationSha256===reference.sha256&&review.nativeEvidenceSha256===firstRuntimeDigest(value.nativeEvidence)
    &&timestamp(review.reviewedAt,now)&&Date.parse(review.reviewedAt)>=Math.max(Date.parse(value.identityCapturedAt),Date.parse(value.schema.capturedAt),Date.parse(value.runtime.capturedAt)),
    'FIRST_RUNTIME_OWNER_REFRESH_INVALID');
  need(fresh(value.identityCapturedAt,now)&&fresh(value.schema.capturedAt,now)&&fresh(value.runtime.capturedAt,now)
    &&PREVIEW_PARITY_POLICY.requiredAuth.every(p=>value.runtime.auth[p].state==='authenticated'),'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');
  need(firstRuntimeDigest({flags:value.runtime.flags,safety:value.runtime.safety,auth:value.runtime.auth})===firstRuntimeDigest({flags:baseline.runtime.flags,safety:baseline.runtime.safety,auth:baseline.runtime.auth}),
    'FIRST_RUNTIME_BASELINE_CHANGED');return value;
}

export async function captureFirstRuntimeOriginalOwnerRefresh({baselineReference,controllerDirectory,privateEnvironment,deployment,nativeDeployment,nativeEnvironment,
  configuration,schema,identityCapturedAt,nativeEvidence,observations,now=Date.now(),fetchImpl,clientFactory}={}) {
  const baseline=admittedFirstRuntimeBaseline(baselineReference,{now});
  if(baseline.schemaVersion===2) {
    // Original owners supply already collected, sanitized observations. This
    // capture path never probes providers or reads/copies credential values.
    const value={schemaVersion:2,kind:'fcos_first_runtime_original_owner_refresh_v2',baselineSha256:baselineReference.sha256,
      targets:baseline.targets,previous:baseline.previous,configurationSha256:configuration?.valuesSha256,
      desiredRuntimeSha256:firstRuntimeDigest(baseline.desiredRuntime),identityCapturedAt,schema,observations,nativeEvidence};
    validateTypedOwnerObservation(value,{baselineReference,baseline,now});return value;
  }

  const source=immutableCompatibilityBaseline({cwd:controllerDirectory,trustedCwd:controllerDirectory});
  need(deployment?.id===baseline.previous.deploymentId&&deployment.sha===baseline.previous.sha&&deployment.url===baseline.previous.url
    &&deployment.target==='production'&&deployment.state==='READY'&&source.sourceDigest===baseline.previous.sourceSha256
    &&nativeDeployment?.id===deployment.id&&nativeDeployment.meta?.githubCommitSha===deployment.sha&&nativeDeployment.projectId===baseline.targets.vercelProject
    &&nativeDeployment.ownerId===baseline.targets.vercelTeam&&nativeDeployment.target==='production'&&nativeDeployment.readyState==='READY'
    &&nativeDeployment.url===new URL(deployment.url).hostname&&Number.isFinite(nativeDeployment.createdAt)&&nativeDeployment.createdAt===deployment.createdAt
    &&nativeEvidence?.deploymentSha256===firstRuntimeDigest(nativeDeployment)&&Array.isArray(nativeDeployment.env),'FIRST_RUNTIME_SCOPE_CHANGED');
  const config=verifiedFirstRuntimeConfiguration({privateEnvironment,deployment,nativeDeployment,nativeEnvironment,configuration,now});
  need(config.valuesSha256===baseline.configuration.valuesSha256&&config.dependencySha256===baseline.configuration.dependencySha256
    &&firstRuntimeDigest(config.keys)===firstRuntimeDigest(baseline.configuration.keys),'FIRST_RUNTIME_BASELINE_CHANGED');
  need(fresh(identityCapturedAt,now)&&fresh(schema?.capturedAt,now),'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');
  const runtime=await collectCompatibilityBaselineRuntime({deployment,privateEnvironment,baseline:source,now,...(fetchImpl?{fetchImpl}:{}),...(clientFactory?{clientFactory}:{})});
  return {schemaVersion:1,kind:'fcos_first_runtime_original_owner_refresh_v1',baselineSha256:baselineReference.sha256,targets:baseline.targets,previous:baseline.previous,
    configurationSha256:config.valuesSha256,identityCapturedAt,schema,runtime,nativeEvidence};
}

/** Privileged setup only: caller supplies actual native deployed configuration
 * privately. No provider credential is read by this module or returned/saved.
 * Root independently accepts native evidence; these hashes are integrity, not
 * self-authenticating provider provenance or permission to execute a release. */
export async function captureFirstRuntimeBaseline({controllerDirectory,privateEnvironment,deployment,nativeDeployment,nativeEnvironment,configuration,schema,endpointAbsence,nativeEvidence,
  now=Date.now(),fetchImpl,clientFactory}={}) {
  firstRuntimeSourceAbsence(controllerDirectory);
  const baseline=immutableCompatibilityBaseline({cwd:controllerDirectory,trustedCwd:controllerDirectory});
  need(isFirstRuntimePair({candidateSha:FIRST_RUNTIME.candidateSha,previous:{deploymentId:deployment?.id,sha:deployment?.sha,url:deployment?.url,sourceSha256:baseline.sourceDigest}})
    &&deployment.target==='production'&&deployment.state==='READY','FIRST_RUNTIME_SCOPE_CHANGED');
  need(nativeDeployment?.id===deployment.id&&nativeDeployment.projectId===firstRuntimeTargets().vercelProject&&nativeDeployment.ownerId===firstRuntimeTargets().vercelTeam
    &&nativeDeployment.meta?.githubCommitSha===deployment.sha&&nativeDeployment.url===new URL(deployment.url).hostname&&nativeDeployment.target==='production'
    &&Number.isFinite(nativeDeployment.createdAt)&&nativeDeployment.createdAt===deployment.createdAt
    &&nativeDeployment.readyState==='READY'&&Array.isArray(nativeDeployment.env)&&nativeDeployment.env.length>0
    &&nativeDeployment.env.every(k=>typeof k==='string'&&/^[A-Z][A-Z0-9_]*(?:=|$)/.test(k))
    &&nativeEvidence?.deploymentSha256===firstRuntimeDigest(nativeDeployment),'FIRST_RUNTIME_DEPLOYMENT_INVENTORY_REQUIRED');
  const config=verifiedFirstRuntimeConfiguration({privateEnvironment,deployment,nativeDeployment,nativeEnvironment,configuration,now});
  need(fresh(configuration.capturedAt,now)&&fresh(endpointAbsence?.capturedAt,now)&&fresh(schema?.capturedAt,now),'FIRST_RUNTIME_CAPTURE_EXPIRED');
  const runtime=await collectCompatibilityBaselineRuntime({deployment,privateEnvironment,baseline,now,...(fetchImpl?{fetchImpl}:{}),...(clientFactory?{clientFactory}:{})});
  const value={schemaVersion:1,kind:'fcos_first_runtime_baseline_v1',candidateSha:FIRST_RUNTIME.candidateSha,targets:firstRuntimeTargets(),
    previous:{deploymentId:deployment.id,sha:deployment.sha,url:deployment.url,sourceSha256:baseline.sourceDigest,createdAt:new Date(deployment.createdAt).toISOString()},
    source:{helperRevision:baseline.helperRevision,declarationsSha256:baseline.declarationsSha256,observationKind:baseline.observationKind},
    configuration:config,
    endpointAbsence:{...endpointAbsence,sourceAbsent:true},schema,nativeEvidence:{...nativeEvidence,environmentValuesSha256:firstRuntimeDigest(privateEnvironment)},runtime};
  validateFirstRuntimeEvidence(value,{now,complete:false});return value;
}

function verifiedFirstRuntimeConfiguration({privateEnvironment,deployment,nativeDeployment,nativeEnvironment,configuration,now}) {
  const keys=nativeDeployment.env.map(k=>k.split('=')[0]),dependencies=firstRuntimeConfigurationDependencies(),rows=nativeEnvironment?.envs;
  // READY deployment-id pull is unavailable. Use the complete native project
  // response only when every record predates this immutable deployment, and
  // every source-declared dependency is either observed or provably absent.
  need(object(privateEnvironment)&&configuration?.reader===`/v10/projects/${firstRuntimeTargets().vercelProject}/env?target=production&decrypt=true`
    &&Array.isArray(rows)&&rows.length>0&&rows.length<=512&&!nativeEnvironment.pagination?.next&&new Set(keys).size===keys.length
    &&rows.every(r=>typeof r.id==='string'&&/^[A-Z][A-Z0-9_]*$/.test(r.key)&&keys.includes(r.key)&&Array.isArray(r.target)&&r.target.includes('production')&&!r.gitBranch
      &&Number.isFinite(r.createdAt)&&Number.isFinite(r.updatedAt)&&r.createdAt<=deployment.createdAt&&r.updatedAt<=deployment.createdAt)
    &&new Set(rows.map(r=>r.key)).size===rows.length&&privateEnvironment.VERCEL_ENV==='production'
    &&Object.entries(privateEnvironment).every(([k,v])=>typeof v==='string'&&(k==='VERCEL_ENV'||rows.some(r=>r.key===k&&r.value===v)))
    &&rows.every(r=>typeof r.value!=='string'||privateEnvironment[r.key]===r.value)
    &&dependencies.keys.every(k=>!keys.includes(k)||Object.hasOwn(privateEnvironment,k)&&privateEnvironment[k].trim()!==''
      &&! /^(?:\*+|<redacted>|\[redacted\])$/i.test(privateEnvironment[k].trim())),'FIRST_RUNTIME_CONFIGURATION_INCOMPLETE');
  return {complete:true,deploymentId:deployment.id,sha:deployment.sha,capturedAt:configuration.capturedAt,reader:configuration.reader,
    updatedAt:new Date(Math.max(...rows.map(r=>r.updatedAt))).toISOString(),keys:[...keys].sort(),recordKeys:rows.map(r=>r.key).sort(),observedKeys:Object.keys(privateEnvironment).sort(),
    absentDependencies:dependencies.keys.filter(k=>!keys.includes(k)),unobservedKeys:keys.filter(k=>!Object.hasOwn(privateEnvironment,k)).sort(),dependencySha256:dependencies.sha256,
    valuesSha256:firstRuntimeDigest(privateEnvironment)};
}

// V2 records what was observed without upgrading a current configuration copy
// into evidence of the opaque values, flags or authentication of the old build.
export const TYPED_FIRST_RUNTIME_EXCEPTION='previous-runtime-endpoint-absent-typed-v2';
export const FIRST_RUNTIME_OWNER_MIN_REMAINING_SECONDS=300;
export const FIRST_RUNTIME_CONFIGURATION_COPY=Object.freeze({
  operationId:'a19e4a01a3b52865f0c451caa905c318d3f7d90c75e19fea159528a23357425e',
  deploymentId:'dpl_Fdv5anHQ68amCMBbJ243oLaTQQzf',
  url:'https://fcos-94267jwm4-hocheunglai-6535s-projects.vercel.app',
  targetEnvironment:'fcos-legacy-diag-a19e4a01a3b5',projectRecordCount:58
});
const typedNativeKeys=['identity','project','deployment','aliasBefore','aliasAfter','version','endpointAbsence','schema'];
const typedPublicKeys=['diagnosticObservation','diagnosticAcceptance','preservationPrecision','legacySalesforceIdentity'];
const ownerProviders=['supabase','salesforce','xero'];
const allProviders=['supabase','salesforce','xero','drive','fcuno','microsoft','openai'];
const evidenceRef=(v,now)=>exact(v,['sha256','capturedAt'])&&hash(v.sha256)&&timestamp(v.capturedAt,now);
const typedEvidence=(v,keys,now)=>exact(v,keys)&&keys.every(k=>evidenceRef(v[k],now));
export const firstRuntimeVersionEvidence=value=>value.schemaVersion===2?value.nativeEvidence.version.sha256:value.nativeEvidence.versionSha256;
export function firstRuntimeCutoverScope(value) {
  return {kind:TYPED_FIRST_RUNTIME_EXCEPTION,candidateSha:value.candidateSha,sourceProfile:value.candidateSourceProfile,previous:value.previous,
    desiredRuntimeSha256:firstRuntimeDigest(value.desiredRuntime),existingUi:false,handoffs:[],rollbackEligible:false};
}
function typedEvidenceProjection(value) {
  return {nativeEvidence:value.nativeEvidence,publicEvidence:value.publicEvidence,configurationCopy:value.configurationCopy,originalOwners:value.originalOwners};
}
export function firstRuntimeOriginalObservationTimes(value) {
  return {nativeEvidence:Object.fromEntries(Object.entries(value.nativeEvidence).map(([k,v])=>[k,v.capturedAt])),
    publicEvidence:Object.fromEntries(Object.entries(value.publicEvidence).map(([k,v])=>[k,v.capturedAt])),
    configurationCopy:value.configurationCopy.capturedAt,diagnostic:value.configurationCopy.diagnostic.observedAt,
    endpointAbsence:value.endpointAbsence.capturedAt,schema:value.schema.capturedAt,historicalAbsence:value.runtime.capturedAt,
    originalOwners:Object.fromEntries(Object.entries(value.originalOwners).map(([k,v])=>[k,v.authority.capturedAt]))};
}
function latestOriginalObservation(value) {
  const times=firstRuntimeOriginalObservationTimes(value),flat=v=>object(v)?Object.values(v).flatMap(flat):[Date.parse(v)];
  return Math.max(...flat(times));
}
function validateTypedFirstRuntimeEvidence(value,{now}) {
  need(exact(value,['schemaVersion','kind','candidateSha','candidateSourceProfile','targets','previous','source','configurationCopy','endpointAbsence','schema','nativeEvidence','publicEvidence','runtime','desiredRuntime','originalOwners'])
    &&value.schemaVersion===2&&value.kind==='fcos_first_runtime_baseline_v2'&&firstRuntimeDigest(value.targets)===firstRuntimeDigest(firstRuntimeTargets())
    &&value.candidateSourceProfile===firstRuntimeCandidateProfile(value.candidateSha),'FIRST_RUNTIME_BASELINE_INVALID');
  need(exact(value.previous,['deploymentId','sha','url','sourceSha256','createdAt'])&&isFirstRuntimePair({candidateSha:value.candidateSha,previous:value.previous})
    &&timestamp(value.previous.createdAt,now),'FIRST_RUNTIME_SCOPE_CHANGED');
  need(exact(value.source,['helperRevision','declarationsSha256','observationKind'])&&value.source.helperRevision===sourcePins().helperRevision
    &&value.source.declarationsSha256===sourcePins().declarationsSha256&&value.source.observationKind==='historical_endpoint_and_current_configuration_copy_separated','FIRST_RUNTIME_SOURCE_CHANGED');
  const e=value.endpointAbsence;
  need(exact(e,['url','method','httpStatus','redirected','sourceAbsent','capturedAt'])&&e.url===`${FIRST_RUNTIME.previousUrl}/api/connection-runtime`
    &&e.method==='GET'&&e.httpStatus===404&&e.redirected===false&&e.sourceAbsent===true&&timestamp(e.capturedAt,now),'FIRST_RUNTIME_ENDPOINT_ABSENCE_REQUIRED');
  need(exact(value.schema,['projectRef','sha256','capturedAt','readOnly'])&&value.schema.projectRef===value.targets.supabaseProject&&hash(value.schema.sha256)
    &&timestamp(value.schema.capturedAt,now)&&value.schema.readOnly===true);
  need(typedEvidence(value.nativeEvidence,typedNativeKeys,now)&&typedEvidence(value.publicEvidence,typedPublicKeys,now));
  need(value.nativeEvidence.endpointAbsence.capturedAt===e.capturedAt&&value.nativeEvidence.schema.capturedAt===value.schema.capturedAt);
  const c=value.configurationCopy,d=c?.diagnostic,pin=FIRST_RUNTIME_CONFIGURATION_COPY;
  need(exact(c,['kind','complete','deployedHistoricalValuesObserved','projectRecordCount','projectRecordKeys','projectRecordsSha256','valuesSha256','capturedAt','diagnostic'])
    &&c.kind==='current_production_configuration_copy'&&c.complete===true&&c.deployedHistoricalValuesObserved===false
    &&c.projectRecordCount===pin.projectRecordCount&&Array.isArray(c.projectRecordKeys)&&c.projectRecordKeys.length===pin.projectRecordCount
    &&new Set(c.projectRecordKeys).size===pin.projectRecordCount&&c.projectRecordKeys.every(k=>/^[A-Z][A-Z0-9_]{0,127}$/.test(k))
    &&hash(c.projectRecordsSha256)&&hash(c.valuesSha256)&&timestamp(c.capturedAt,now)
    &&exact(d,['operationId','deploymentId','url','projectId','target','targetEnvironment','copyFrom','httpStatus','observedAt','issuedAt','notAfter','baselineAccepted','fullQualificationAccepted'])
    &&['operationId','deploymentId','url','targetEnvironment'].every(k=>d[k]===pin[k])&&d.projectId===value.targets.vercelProject
    &&d.target==='preview'&&d.copyFrom==='production'&&d.httpStatus===200&&d.baselineAccepted===false&&d.fullQualificationAccepted===false
    &&timestamp(d.observedAt,now)&&Number.isSafeInteger(d.issuedAt)&&Number.isSafeInteger(d.notAfter)&&d.notAfter>d.issuedAt
    &&d.notAfter-d.issuedAt<=86400000&&Date.parse(d.observedAt)>=d.issuedAt&&Date.parse(d.observedAt)<d.notAfter
    &&Date.parse(c.capturedAt)>=Date.parse(d.observedAt)&&value.publicEvidence.diagnosticObservation.capturedAt===c.capturedAt,'FIRST_RUNTIME_CONFIGURATION_INCOMPLETE');
  const r=value.runtime;
  need(exact(r,['capturedAt','deploymentId','sha','flags','safety','auth'])&&r.capturedAt===e.capturedAt&&r.deploymentId===value.previous.deploymentId&&r.sha===value.previous.sha
    &&exact(r.flags,PREVIEW_PARITY_POLICY.runtimeFlags)&&Object.values(r.flags).every(v=>exact(v,['state'])&&v.state==='unknown')
    &&exact(r.safety,['readOnly','externalActions'])&&r.safety.readOnly===null&&exact(r.safety.externalActions,PREVIEW_PARITY_POLICY.externalActions)
    &&Object.values(r.safety.externalActions).every(v=>v===null)&&exact(r.auth,allProviders)
    &&Object.values(r.auth).every(v=>exact(v,['state','target','mode'])&&v.state==='unknown'&&v.target===''&&v.mode===''),'FIRST_RUNTIME_HISTORICAL_RUNTIME_UNOBSERVED');
  need(exact(value.desiredRuntime,['flags','safety','auth']));
  validateRuntime({...value.desiredRuntime,capturedAt:c.capturedAt,deploymentId:value.previous.deploymentId,sha:value.previous.sha},value.previous,now,true,false,true);
  need(exact(value.originalOwners,ownerProviders)&&ownerProviders.every(k=>exact(value.originalOwners[k],['ownerId','authority'])
    &&typeof value.originalOwners[k].ownerId==='string'&&/^[A-Za-z0-9_:/.-]{1,200}$/.test(value.originalOwners[k].ownerId)&&evidenceRef(value.originalOwners[k].authority,now)));
  need(Date.parse(e.capturedAt)>=Date.parse(value.previous.createdAt)&&Date.parse(value.publicEvidence.diagnosticAcceptance.capturedAt)>=Date.parse(c.capturedAt));
  return value;
}
function validateTypedFirstRuntimeReview(reference,value,review,now) {
  const a=reference.acceptance;
  // These hashes bind full public evidence and original clocks to independent
  // review. They are integrity references, never provider proof or authority.
  need(exact(a,['json','sha256'])&&typeof a.json==='string'&&Buffer.byteLength(a.json)<=8192&&firstRuntimeDigest(a.json)===a.sha256
    &&exact(review,['schemaVersion','kind','accepted','reviewerId','repository','baselineSha256','evidenceSha256','originalObservationTimesSha256','firstCutoverException','finalManifestApprovalRequired','reviewedAt'])
    &&review.schemaVersion===2&&review.kind==='fcos_root_accepted_first_runtime_baseline_v2'&&review.accepted===true&&review.reviewerId==='/root'
    &&review.repository===value.targets.repository&&review.baselineSha256===reference.sha256&&review.evidenceSha256===firstRuntimeDigest(typedEvidenceProjection(value))
    &&review.originalObservationTimesSha256===firstRuntimeDigest(firstRuntimeOriginalObservationTimes(value))
    &&exact(review.firstCutoverException,['kind','accepted','scopeSha256'])&&review.firstCutoverException.kind===TYPED_FIRST_RUNTIME_EXCEPTION
    &&review.firstCutoverException.accepted===true&&review.firstCutoverException.scopeSha256===firstRuntimeDigest(firstRuntimeCutoverScope(value))
    &&review.finalManifestApprovalRequired===true&&timestamp(review.reviewedAt,now)&&Date.parse(review.reviewedAt)>=latestOriginalObservation(value),'FIRST_RUNTIME_BASELINE_REVIEW_REQUIRED');
}
function validateTypedOwnerRefresh(reference,{baselineReference,baseline,expectedSha256,now}) {
  need(reference&&expectedSha256,'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');
  need(exact(reference,['json','sha256','acceptance'])&&typeof reference.json==='string'&&Buffer.byteLength(reference.json)<=49152&&hash(reference.sha256)
    &&reference.sha256===expectedSha256&&firstRuntimeDigest(reference.json)===reference.sha256,'FIRST_RUNTIME_OWNER_REFRESH_INVALID');
  let value,review;try{value=JSON.parse(reference.json);review=JSON.parse(reference.acceptance?.json);}catch{need(false,'FIRST_RUNTIME_OWNER_REFRESH_INVALID');}
  validateTypedOwnerObservation(value,{baselineReference,baseline,now});
  const a=reference.acceptance;
  need(exact(a,['json','sha256'])&&typeof a.json==='string'&&Buffer.byteLength(a.json)<=8192&&firstRuntimeDigest(a.json)===a.sha256
    &&exact(review,['schemaVersion','kind','accepted','reviewerId','repository','baselineSha256','observationSha256','evidenceSha256','reviewedAt'])&&review.schemaVersion===2
    &&review.kind==='fcos_root_accepted_first_runtime_owner_refresh_v2'&&review.accepted===true&&review.reviewerId==='/root'&&review.repository===baseline.targets.repository
    &&review.baselineSha256===baselineReference.sha256&&review.observationSha256===reference.sha256
    &&review.evidenceSha256===firstRuntimeDigest({nativeEvidence:value.nativeEvidence,observations:value.observations})&&timestamp(review.reviewedAt,now)
    &&Date.parse(review.reviewedAt)>=Math.max(Date.parse(value.identityCapturedAt),Date.parse(value.schema.capturedAt),...ownerProviders.map(k=>Date.parse(value.observations[k].capturedAt)),...typedNativeKeys.map(k=>Date.parse(value.nativeEvidence[k].capturedAt))),
    'FIRST_RUNTIME_OWNER_REFRESH_INVALID');
  return value;
}

function validateTypedOwnerObservation(value,{baselineReference,baseline,now}) {
  need(exact(value,['schemaVersion','kind','baselineSha256','targets','previous','configurationSha256','desiredRuntimeSha256','identityCapturedAt','schema','observations','nativeEvidence'])
    &&value.schemaVersion===2&&value.kind==='fcos_first_runtime_original_owner_refresh_v2'&&value.baselineSha256===baselineReference.sha256
    &&firstRuntimeDigest(value.targets)===firstRuntimeDigest(baseline.targets)&&firstRuntimeDigest(value.previous)===firstRuntimeDigest(baseline.previous)
    &&value.configurationSha256===baseline.configurationCopy.valuesSha256&&value.desiredRuntimeSha256===firstRuntimeDigest(baseline.desiredRuntime)
    &&typedEvidence(value.nativeEvidence,typedNativeKeys,now)&&value.nativeEvidence.version.sha256===baseline.nativeEvidence.version.sha256,'FIRST_RUNTIME_OWNER_REFRESH_INVALID');
  need(exact(value.schema,['projectRef','sha256','capturedAt','readOnly'])&&value.schema.projectRef===baseline.targets.supabaseProject&&value.schema.readOnly===true
    &&value.schema.sha256===baseline.schema.sha256,'FIRST_RUNTIME_BASELINE_CHANGED');
  need(fresh(value.identityCapturedAt,now)&&fresh(value.schema.capturedAt,now)&&typedNativeKeys.every(k=>fresh(value.nativeEvidence[k].capturedAt,now)),'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');
  need(exact(value.observations,ownerProviders),'FIRST_RUNTIME_OWNER_REFRESH_INVALID');
  const horizon=now+FIRST_RUNTIME_OWNER_MIN_REMAINING_SECONDS*1000;
  for(const provider of ownerProviders) {
    const o=value.observations[provider],sf=provider==='salesforce',xero=provider==='xero',expected=baseline.desiredRuntime.auth[provider];
    need(exact(o,['state','target','mode','ownerId','authoritySha256','capturedAt','validUntil','validUntilKind','proof',...(sf?['identity']:[]),...(xero?['sessionExpiresAt']:[])])
      &&o.validUntilKind==='observation_admissibility_only'&&o.state==='authenticated'&&o.target===expected.target&&o.mode===expected.mode&&o.ownerId===baseline.originalOwners[provider].ownerId
      &&o.authoritySha256===baseline.originalOwners[provider].authority.sha256&&evidenceRef(o.proof,now)&&o.proof.capturedAt===o.capturedAt,'FIRST_RUNTIME_OWNER_REFRESH_INVALID');
    // validUntil bounds admissibility of this fresh observation. It is NOT a
    // claim about unknown Salesforce token/Supabase key expiry. Matching proof
    // may be reused within these bounds; staged/live runtime verification and
    // its actual authenticated target checks remain required by the controller.
    need(fresh(o.capturedAt,now)&&timestamp(o.validUntil,Date.parse(o.capturedAt)+PREVIEW_PARITY_POLICY.maxAgeSeconds*1000)
      &&Date.parse(o.validUntil)>=horizon&&Date.parse(o.validUntil)<=Date.parse(o.capturedAt)+PREVIEW_PARITY_POLICY.maxAgeSeconds*1000,'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');
    if(sf)need(o.target===fcosSalesforceEnvironment('production').orgId&&o.mode==='application'
      &&exact(o.identity,['orgId','instanceUrl','isSandbox','authModeObserved','provenance','rawOrganizationFieldsObserved'])&&o.identity.orgId===o.target
      &&o.identity.instanceUrl===fcosSalesforceEnvironment('production').instanceUrl&&o.identity.isSandbox===false&&o.identity.authModeObserved===false
      &&(o.identity.provenance==='authenticated_organization_read'&&o.identity.rawOrganizationFieldsObserved===true
        ||o.identity.provenance==='source_enforced_organization_guard'&&o.identity.rawOrganizationFieldsObserved===false),'FIRST_RUNTIME_OWNER_REFRESH_INVALID');
    if(xero)need(timestamp(o.sessionExpiresAt,Number.MAX_SAFE_INTEGER)&&Date.parse(o.sessionExpiresAt)>=horizon,'FIRST_RUNTIME_OWNER_REFRESH_REQUIRED');
  }
  return value;
}
