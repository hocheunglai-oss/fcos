// Trusted controller only. Import performs no reads, credential access or writes.
import { createLocalJWKSet, jwtVerify } from 'jose';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateXeroRecoverySourceInventory, validateXeroRecoverySourceContent } from './lib/hosted-release/xero-recovery-source-inventory.mjs';
import { xeroOwnerReadbackAudience } from './lib/hosted-release/xero-recovery-host.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { loginLegacyHostedRuntime, validateLegacyRuntimePublicAuth } from './lib/hosted-release/legacy-hosted-runtime-login.mjs';
import { createVercelReadTransport, validateVercelReadAcceptance } from './lib/hosted-release/vercel-read-auth.mjs';
import { createCourierReadBudget, parseCourierTemplate, parseCourierRequest, courierPrefix, courierRequestRef, courierArtifactName, assertCourierRun,
  readCourierGitFile, validateCourierLocator, parseExecutionPreflight, courierPublicationStatus, assertCourierPublicationStatus, assertCourierAck, parseOwnerReadbackCarrier, assertOwnerReadbackAck, validateOwnerReadbackResult, ownerReadbackArtifactName, hash, bytesHash, need, refusal, safeCode, REPOSITORY, RUNTIME_MATERIAL_FILENAME } from './lib/hosted-release/xero-recovery-native-relay.mjs';
const TEAM = fcosConnectionIdentifier('vercel','Team ID'), PROJECT = fcosConnectionIdentifier('vercel','Project ID');
const targets = { vercelTeam: TEAM, vercelProject: PROJECT };
const GH_ISSUER = 'https://token.actions.githubusercontent.com';
const HASH = /^[a-f0-9]{64}$/;
const active = (signal, t, now) => need(signal instanceof AbortSignal && !signal.aborted && now() >= t.issuedAt && now() < t.notAfter, 'XERO_COURIER_AUTHORITY_EXPIRED');
async function bounded(response, maximum) {
  need(response.body && !response.redirected && Number(response.headers.get('content-length') || 0) <= maximum, 'XERO_COURIER_RESPONSE_REFUSED');
  const reader = response.body.getReader(), parts = []; let length = 0;
  try { while (true) { const {done,value} = await reader.read(); if (done) break; length += value.length; need(length <= maximum, 'XERO_COURIER_RESPONSE_REFUSED'); parts.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  return Buffer.concat(parts);
}
export function courierGithubReader({env,fetchImpl=fetch,signal,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
  const reserveGet=createCourierReadBudget({signal,now,wait});
  need(typeof env.GITHUB_TOKEN === 'string' && env.GITHUB_TOKEN.length >= 20, 'XERO_COURIER_GITHUB_REQUIRED');
  return async (route, optional=false) => {
    await reserveGet();need(!signal.aborted && /^(?:repos\/hocheunglai-oss\/fcos(?:\/|$))/.test(route) && !route.includes('..') && !/[#\\\s]/.test(route));
    let response; try { response = await fetchImpl(`https://api.github.com/${route}`, {method:'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),cache:'no-store',headers:{authorization:`Bearer ${env.GITHUB_TOKEN}`,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'}}); } catch { throw refusal('XERO_COURIER_GITHUB_READ_UNKNOWN'); }
    if (optional && response.status === 404) { await response.body?.cancel(); return null; }
    need(response.ok && (!response.url || response.url===`https://api.github.com/${route}`), 'XERO_COURIER_GITHUB_READ_UNKNOWN');
    if(/\/commits\/[a-f0-9]{40}\/statuses\?per_page=100$/.test(route))need(response.headers.get('link')===null,'XERO_COURIER_PUBLICATION_INVALID');
    return JSON.parse((await bounded(response,262144)).toString('utf8'));
  };
}
// GitHub fills authenticated status.creator. Activity Events can lag hours and
// are not this protocol's receipt. Missing is a bounded dependency; ambiguity,
// incomplete pages or forged creator/binding stop before any owner/provider use.
export async function courierPublicationObserved(read, input, now=Date.now()) {
  const expected=courierPublicationStatus(input),statuses=await read(expected.readRoute);
  need(Array.isArray(statuses)&&statuses.length<100,'XERO_COURIER_PUBLICATION_INVALID');
  const selected=statuses.filter(v=>typeof v?.context==='string'&&v.context.toLowerCase()===expected.body.context);
  need(selected.length<=1,'XERO_COURIER_PUBLICATION_INVALID');if(selected.length===0)return false;
  assertCourierPublicationStatus(selected[0],expected,now);return true;
}
export async function verifyCourierOidc({token,t,runId,audience,fetchImpl=fetch,jwks,signal,now=Date.now}) {
  need(typeof token==='string' && token.length<16384 && !signal.aborted, 'XERO_COURIER_OIDC_INVALID');
  try {
    let keys=jwks;
    if (!keys) { const response=await fetchImpl(`${GH_ISSUER}/.well-known/jwks`,{method:'GET',redirect:'error',signal,cache:'no-store'});
      need(response.ok && (!response.url || response.url===`${GH_ISSUER}/.well-known/jwks`)); keys=createLocalJWKSet(JSON.parse((await bounded(response,65536)).toString('utf8'))); }
    const {payload:p,protectedHeader:h}=await jwtVerify(token,keys,{algorithms:['RS256'],issuer:GH_ISSUER,audience,currentDate:new Date(now()),clockTolerance:0});
    need(!signal.aborted && h.alg==='RS256' && p.repository_id==='1278654816' && p.repository===REPOSITORY && p.repository_owner==='hocheunglai-oss'
      && p.actor_id==='265701760' && p.actor==='hocheunglai-oss' && p.event_name==='workflow_dispatch' && p.run_attempt==='1'
      && p.run_id===String(runId) && p.runner_environment==='github-hosted' && p.ref_protected==='true'
      && p.ref===t.caller.ref && p.sha===t.caller.sha && p.workflow_ref===t.caller.workflowRef && p.workflow_sha===t.caller.workflowSha
      && p.job_workflow_ref===t.caller.jobWorkflowRef && p.job_workflow_sha===t.caller.jobWorkflowSha
      && p.environment===t.caller.environment && p.sub===t.caller.subject
      && Number.isSafeInteger(p.iat) && Number.isSafeInteger(p.exp) && p.iat*1000<=now() && p.exp*1000>now() && p.exp>p.iat && p.exp-p.iat<=300
      && now()-p.iat*1000<=300000 && typeof p.jti==='string' && p.jti.length>0);
    return { expiresAt:p.exp*1000 };
  } catch { throw refusal('XERO_COURIER_OIDC_INVALID'); }
}
// Actual provider src/out mapping is strict: exact3 uploaded source files and
// the exact expected compiled route. OUT lambda/UID is never a source-byte
// substitute: all3 original source contents must independently match below.
export async function verifyCourierDeploymentBytes({t,locator,expectedFiles,env,fetchImpl=fetch,signal,now=Date.now}) {
  try { validateCourierLocator(JSON.stringify(locator),t); } catch { throw refusal('XERO_COURIER_LOCATOR_INVALID'); }
  validateVercelReadAcceptance(t.readCredential,t.readAcceptance,{targets,now:now()});
  const transport=createVercelReadTransport({binding:t.readCredential,targets,env,fetchImpl:async(u,o)=>{const r=await fetchImpl(u,{...o,signal:AbortSignal.any([signal,o.signal,AbortSignal.timeout(15000)].filter(Boolean))});Object.defineProperty(r,'json',{value:async()=>JSON.parse((await bounded(r,262144)).toString('utf8'))});return r;},now}); await transport.configuration();
  const d=await transport.get(`/v13/deployments/${locator.deploymentId}`);
  need(d.id===locator.deploymentId && d.projectId===PROJECT && (Object.hasOwn(d,'teamId')?d.teamId===TEAM:d.ownerId===TEAM)
    && (!Object.hasOwn(d,'ownerId')||d.ownerId===TEAM) && d.readyState==='READY' && `https://${d.url}`===locator.url
    && (d.customEnvironment?.id===t.hostConfiguration.target.customEnvironment || d.customEnvironment?.slug===t.hostConfiguration.target.customEnvironment), 'XERO_COURIER_DEPLOYMENT_MISMATCH');
  async function read(path, maximum) { need(!signal.aborted); const u=new URL(`https://api.vercel.com${path}`);u.searchParams.set('teamId',TEAM);
    const r=await fetchImpl(u,{method:'GET',redirect:'error',signal,cache:'no-store',headers:{authorization:`Bearer ${env.FCOS_HOSTED_VERCEL_READ_TOKEN}`}});
    need(r.ok && !r.redirected && (!r.url || r.url===u.href), 'XERO_COURIER_SOURCE_BYTES_UNPROVEN'); return bounded(r,maximum); }
  let tree; try { tree=JSON.parse((await read(`/v6/deployments/${locator.deploymentId}/files`,262144)).toString('utf8')); } catch { throw refusal('XERO_COURIER_SOURCE_BYTES_UNPROVEN'); }
  let files;try{files=validateXeroRecoverySourceInventory({tree,expectedFiles,mode:'host'}).sourceFiles;}catch{throw refusal('XERO_COURIER_SOURCE_BYTES_UNPROVEN');}
  need(Array.isArray(expectedFiles) && expectedFiles.length===3 && files.length===3 && new Set(files.map(f=>f.path)).size===3
    && files.every((f,i)=>f.path===expectedFiles[i].path && HASH.test(expectedFiles[i].sha256)), 'XERO_COURIER_SOURCE_BYTES_UNPROVEN');
  for(const file of files){
    const responseBytes=await read(`/v8/deployments/${locator.deploymentId}/files/${file.uid}`,4194304);
    try{validateXeroRecoverySourceContent({file,responseBytes});}
    catch{throw refusal('XERO_COURIER_SOURCE_BYTES_UNPROVEN');}
  }
  need(!signal.aborted); return {origin:locator.url,deploymentId:locator.deploymentId};
}
async function ownOidc(env,audience,fetchImpl,signal) {
  const u=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);need(u.protocol==='https:' && !u.username && !u.password && !u.port && (u.hostname==='pipelines.actions.githubusercontent.com' || u.hostname.endsWith('.actions.githubusercontent.com')) && typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN==='string');
  u.searchParams.set('audience',audience);const r=await fetchImpl(u,{method:'GET',redirect:'error',signal,headers:{authorization:`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});need(r.ok && !r.redirected);
  const v=JSON.parse((await bounded(r,32768)).toString('utf8'));need(typeof v.value==='string');return v.value;
}
async function loginProtection(origin,env) {
  // Existing approved legacy protection credential; cookie and browser state
  // remain in memory and are never exported as a runner artifact.
  need(typeof env.FCOS_PRODUCTION_VERIFICATION_BYPASS==='string','XERO_COURIER_LOGIN_PROTECTION_REQUIRED');
  const {request}=await import('@playwright/test'), c=await request.newContext();
  try { const r=await c.get(`${origin}/app-version.json`,{headers:{'x-vercel-protection-bypass':env.FCOS_PRODUCTION_VERIFICATION_BYPASS,'x-vercel-set-bypass-cookie':'true'},maxRedirects:0,timeout:20000});
    need(r.status()===307 && r.headers().location==='/app-version.json','XERO_COURIER_LOGIN_PROTECTION_REQUIRED');return await c.storageState(); }
  finally { await c.dispose(); }
}
// Called only with the actual HTTP acknowledgement already validated above.
// Deadline/cancellation after HTTP success still forbids a new capture write.
export async function captureCourierAck({ack,t,runId,submissionId,signal,now=Date.now,artifactName}) {
  active(signal,t,now);need(artifactName===undefined||/^fcos-xero-readback-[1-9][0-9]{0,19}-[1-9][0-9]{0,19}-[a-f0-9]{16}$/.test(artifactName));
  const directory=mkdtempSync(join(tmpdir(),'fcos-xero-ack-'));
  try { const path=join(directory,RUNTIME_MATERIAL_FILENAME);writeFileSync(path,JSON.stringify(ack),{mode:0o600,flag:'wx'});
    const {DefaultArtifactClient}=await import('@actions/artifact');active(signal,t,now);
    const client=new DefaultArtifactClient(),originalOut=process.stdout.write,originalErr=process.stderr.write;
    let uploaded;try{active(signal,t,now);process.stdout.write=()=>true;process.stderr.write=()=>true;uploaded=await client.uploadArtifact(artifactName || courierArtifactName(runId,submissionId),[path],directory,{retentionDays:7,compressionLevel:0});}
    finally{process.stdout.write=originalOut;process.stderr.write=originalErr;}
    need(Number.isSafeInteger(uploaded.id) && uploaded.id>0 && typeof uploaded.digest==='string','XERO_COURIER_CAPTURE_UNKNOWN');
  } catch(e) { if(safeCode(e)==='XERO_COURIER_AUTHORITY_EXPIRED')throw e;throw refusal('XERO_COURIER_CAPTURE_UNKNOWN'); }
  finally { rmSync(directory,{recursive:true,force:true}); }
}
export async function buildCourierExpectedFiles({t,runId}) {
  const parent=mkdtempSync(join(realpathSync(tmpdir()),'fcos-xero-package-')),output=join(parent,'package');
  try { const {packageXeroRecoveryHost,xeroHostPackageSourcePins,readExpectedXeroHostUploadFiles}=await import('./package-xero-recovery-host.mjs');
    const configuration=structuredClone(t.hostConfiguration);need(configuration.caller.runId===null,'XERO_COURIER_TEMPLATE_INVALID');configuration.caller.runId=runId;
    const callerKeys=['ref','sha','workflowRef','workflowSha','jobWorkflowRef','jobWorkflowSha','environment','subject'];
    need(callerKeys.every(k=>configuration.caller[k]===t.caller[k]) && configuration.target.controllerSha===t.controllerSha && configuration.planJson===t.planJson,'XERO_COURIER_TEMPLATE_INVALID');
    const sourcePins=xeroHostPackageSourcePins();need(configuration.target.hostSourceSha256===hash(JSON.stringify(sourcePins)),'XERO_COURIER_TEMPLATE_INVALID');
    await packageXeroRecoveryHost({mode:'host',configuration,sourcePins,outputDirectory:output});
    return readExpectedXeroHostUploadFiles({outputDirectory:output,mode:'host'});
  } catch { throw refusal('XERO_COURIER_PACKAGE_BUILD_REFUSED'); } finally {rmSync(parent,{recursive:true,force:true});}
}
export async function prepareWarmXeroRecoveryCarrier({templateJson,env=process.env,fetchImpl=fetch,now=Date.now,signal,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const {template:t,plan}=parseCourierTemplate(templateJson);
  if(plan.schemaVersion!==3)return {status:'legacy_preparation_not_required',executionAuthorityGranted:false};
  need(!env.FCOS_HOSTED_VERCEL_READ_TOKEN && !env.FCOS_HOSTED_RUNTIME_PASSWORD && !env.FCOS_XERO_RECOVERY_REQUEST_NONCE,'XERO_COURIER_TEMPLATE_INVALID');
  active(signal,t,now);const runId=env.GITHUB_RUN_ID,read=courierGithubReader({env,fetchImpl,signal,now,wait});
  await assertCourierRun(read,t,runId,{phase:'preparation'});
  const prefix=courierPrefix(t,runId);let found;
  while(!found){active(signal,t,now);need(now()<plan.binding.armBefore,'XERO_COURIER_AUTHORITY_EXPIRED');
    const candidate=await readCourierGitFile(read,`${prefix}/locator`,'locator.json',2048,{allowExecutionPreflight:plan.schemaVersion===3});
    if(candidate && await courierPublicationObserved(read,{templateJson,runId,ref:candidate.ref,commitSha:candidate.commitSha,raw:candidate.raw,kind:'locator'},now()))found=candidate;
    else await wait(10000);
  }
  const locator=validateCourierLocator(found.raw,t);need(typeof found.executionPreflightJson==='string' && hash(found.executionPreflightJson)===locator.executionPreflightSha256,'XERO_COURIER_TEMPLATE_INVALID');
  parseExecutionPreflight(found.executionPreflightJson,t,now());
  // Root has already reviewed the host before this fixed locator publication.
  // The fresh execution job independently downloads all three source files
  // before login; preparation never receives the environment read credential.
  active(signal,t,now);return {status:'actual_publisher_preparation_complete',executionAuthorityGranted:false};
}
export async function runWarmXeroRecoveryCarrier({templateJson,env=process.env,fetchImpl=fetch,now=Date.now,jwks,signal,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const {template:t,templateSha256,plan,planSha256}=parseCourierTemplate(templateJson);active(signal,t,now);
  need(env.GITHUB_REPOSITORY===REPOSITORY && env.GITHUB_RUN_ATTEMPT==='1' && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID), 'XERO_COURIER_RUN_MISMATCH');
  const runId=env.GITHUB_RUN_ID,read=courierGithubReader({env,fetchImpl,signal,now,wait}),actual=await assertCourierRun(read,t,runId),prefix=courierPrefix(t,runId);
  // This immutable caller sources the PUBLIC template from repository vars.
  // Native admission proves its actual installation metadata and observes this
  // exact dispatch/run before publishing any locator/request. A display title is
  // correlation only, never approval or JWT input attestation. No extra token or
  // ungranted Variables API permission is assumed for the hosted GITHUB_TOKEN.
  need(/^FCOS original Xero carrier [a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(actual.run.display_title||''),'XERO_COURIER_RUN_MISMATCH');
  let locator, metadataJson, execution;
  const running = () => active(signal, execution ? { ...t, notAfter: execution.executionDeadlineAt } : t, now);
  while(!locator) { active(signal,t,now);const found=await readCourierGitFile(read,`${prefix}/locator`,'locator.json',2048,{allowExecutionPreflight:plan.schemaVersion===3});
    if(found && await courierPublicationObserved(read,{templateJson,runId,ref:found.ref,commitSha:found.commitSha,raw:found.raw,kind:'locator'},now())){locator=validateCourierLocator(found.raw,t);metadataJson=found.executionPreflightJson;}else await wait(10000); }
  const publicAuth = plan.schemaVersion===3 ? (()=>{need(typeof metadataJson==='string' && hash(metadataJson)===locator.executionPreflightSha256,'XERO_COURIER_TEMPLATE_INVALID');return parseExecutionPreflight(metadataJson,t,now());})() : t.login.publicAuth;
  active(signal,t,now);const expectedFiles=await buildCourierExpectedFiles({t,runId});
  active(signal,t,now);const host=await verifyCourierDeploymentBytes({t,locator,expectedFiles,env,fetchImpl:(...args)=>{active(signal,t,now);return fetchImpl(...args);},signal,now});
  const checkpoint={};let previous=null,next='preflight';
  while(next) { running();if(plan.schemaVersion===3 && next==='preflight')need(now()<plan.binding.armBefore,'XERO_COURIER_AUTHORITY_EXPIRED');const refs=await read(`repos/${REPOSITORY}/git/matching-refs/${prefix.slice(5)}/request-${next}-`);
    need(Array.isArray(refs) && refs.length<=1,'XERO_COURIER_REQUEST_AMBIGUOUS');if(!refs.length){await wait(10000);continue;}
    const found=await readCourierGitFile(read,refs[0].ref,'request.json',2048);need(found);
    if(!await courierPublicationObserved(read,{templateJson,runId,ref:found.ref,commitSha:found.commitSha,raw:found.raw,kind:'request'},now())){await wait(10000);continue;}
    running();const request=parseCourierRequest(found.raw,t);need(found.ref===courierRequestRef(t,runId,found.raw) && request.step===next && request.previousResultSha256===previous,'XERO_COURIER_REQUEST_INVALID');
    if(plan.schemaVersion===3 && next==='preflight')need(now()<plan.binding.armBefore,'XERO_COURIER_AUTHORITY_EXPIRED');
    const current=await assertCourierRun(read,t,runId);need(current.job.id===actual.job.id);
    if(plan.schemaVersion===3 && next==='preflight')need(Number.isFinite(Date.parse(current.job.started_at)) && Date.parse(current.job.started_at)<=now()
      && Date.parse(current.job.started_at)+1800000-now()>=900000 && Date.parse(publicAuth.preflight.capturedAt)+1800000-now()>=900000,'XERO_COURIER_AUTHORITY_EXPIRED');
    const audience=`${host.origin}/xero-recovery`,oidc=await ownOidc(env,audience,fetchImpl,signal);
    await verifyCourierOidc({token:oidc,t,runId,audience,fetchImpl,jwks,signal,now});
    const credentials={email:env.FCOS_HOSTED_RUNTIME_EMAIL,password:env.FCOS_HOSTED_RUNTIME_PASSWORD,expectedRole:t.login.publicAuth.identity.role};
    validateLegacyRuntimePublicAuth({origin:t.login.origin,...credentials,publicAuth,now:now()});
    const auth=await loginLegacyHostedRuntime({origin:t.login.origin,credentials,mode:'runtime',publicAuth,
      protectionState:await loginProtection(t.login.origin,env),fetchImpl:(u,o)=>{active(signal,t,now);return fetchImpl(u,{...o,signal:AbortSignal.any([signal,o.signal].filter(Boolean))});},now,ownerRecoveryProviderToken:true});
    active(signal,t,now);await verifyCourierOidc({token:oidc,t,runId,audience,fetchImpl,jwks,signal,now});
    need(typeof env.FCOS_PRODUCTION_VERIFICATION_BYPASS==='string'&&env.FCOS_PRODUCTION_VERIFICATION_BYPASS.length>0&&env.FCOS_PRODUCTION_VERIFICATION_BYPASS.length<=16384&&!/[\r\n]/.test(env.FCOS_PRODUCTION_VERIFICATION_BYPASS),'XERO_COURIER_LOGIN_PROTECTION_REQUIRED');
    need(typeof env.FCOS_XERO_RECOVERY_REQUEST_NONCE==='string' && hash(env.FCOS_XERO_RECOVERY_REQUEST_NONCE)===t.hostConfiguration.requestNonceSha256,'XERO_COURIER_NONCE_REQUIRED');
    // Existing verification-environment bypass goes only to the source/target-
    // verified project host, as one header. No cookie or bypass creation call.
    // Exactly one HTTP attempt. Any thrown/lost/non-200 result ends this job;
    // no failure marker, host GET, refresh, cleanup request or next POST follows.
    const response=await fetchImpl(`${host.origin}/xero-recovery`,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),cache:'no-store',
      headers:{'x-vercel-protection-bypass':env.FCOS_PRODUCTION_VERIFICATION_BYPASS,authorization:`Bearer ${oidc}`,'x-fcos-owner-bearer':auth.token,'x-fcos-provider-access-token':auth.providerAccessToken,'x-fcos-recovery-nonce':env.FCOS_XERO_RECOVERY_REQUEST_NONCE,'content-type':'application/json'},body:found.raw});
    need(response.status===200 && !response.redirected && (!response.url || response.url===`${host.origin}/xero-recovery`),'XERO_COURIER_HTTP_OUTCOME_UNKNOWN');
    const resultJson=(await bounded(response,16384)).toString('utf8'),ack={schemaVersion:1,kind:'fcos_xero_recovery_actual_http_ack_v1',templateSha256,runId,jobId:actual.job.id,requestRef:found.ref,commitSha:found.commitSha,
      requestSha256:hash(found.raw),hostOrigin:host.origin,deploymentId:host.deploymentId,httpStatus:200,resultJson,resultSha256:bytesHash(resultJson),receivedAt:now(),...(plan.schemaVersion===3?{executionPreflightSha256:locator.executionPreflightSha256}:{})};
    const result=assertCourierAck(ack,{templateSha256,runId,jobId:actual.job.id,request,requestRef:found.ref,commitSha:found.commitSha,...host,hostOrigin:host.origin,plan,planSha256,checkpoint,execution,executionPreflightSha256:locator.executionPreflightSha256,now:now()});
    // The trusted native prepared intent admits ONE sanitized capture upload.
    // Hashes alone never create that authority. Its actual setup review remains
    // a required external gate; the workflow is not activated by this source.
    if(plan.schemaVersion===3)execution=result.execution;
    running();
    await captureCourierAck({ack,t:execution?{...t,notAfter:execution.executionDeadlineAt}:t,runId,submissionId:request.submissionId,signal,now});
    checkpoint[next]=result.result;previous=result.resultSha256;next=result.nextStep;
  }
  return {status:'complete',operationId:plan.binding.operationId,executionAuthorityGranted:false,qualificationAccepted:false};
}
/** New invocation, never an error handler. Root admits a finite dispatch;
 * immutable caller supplies exact reviewed public inputs. OIDC authenticates
 * same protected source/run, not these input values or financial approval.
 * The original package is rebuilt using ORIGINAL runId even in this new job.
 */
export async function runXeroRecoveryOwnerReadback({templateJson,readbackJson,env=process.env,fetchImpl=fetch,now=Date.now,jwks,signal,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const parsed=parseCourierTemplate(templateJson),{template:t,templateSha256,plan,planSha256}=parsed,r=parseOwnerReadbackCarrier(readbackJson,parsed);active(signal,r,now);
  need(env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_RUN_ATTEMPT==='1'&&/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID)&&env.GITHUB_RUN_ID!==r.originalBinding.runId,'XERO_COURIER_RUN_MISMATCH');
  const runId=env.GITHUB_RUN_ID,read=courierGithubReader({env,fetchImpl,signal,now,wait}),original=await assertCourierRun(read,t,r.originalBinding.runId,{allowCompleted:true});
  need(original.run.status==='completed'&&original.job.status==='completed'&&original.job.id===r.originalBinding.jobId,'XERO_COURIER_RUN_MISMATCH');
  const actual=await assertCourierRun(read,t,runId,{phase:'owner-readback'}),audience=xeroOwnerReadbackAudience(r.originalBinding.hostOrigin,r.originalBinding.runId,planSha256);
  const oidc=await ownOidc(env,audience,fetchImpl,signal);await verifyCourierOidc({token:oidc,t,runId,audience,fetchImpl,jwks,signal,now});active(signal,r,now);
  const expectedFiles=await buildCourierExpectedFiles({t,runId:r.originalBinding.runId}),host=await verifyCourierDeploymentBytes({t,locator:{schemaVersion:plan.schemaVersion===3?3:1,kind:`fcos_xero_host_locator_v${plan.schemaVersion===3?3:1}`,deploymentId:r.originalBinding.deploymentId,url:r.originalBinding.hostOrigin,...(plan.schemaVersion===3?{executionPreflightSha256:r.originalBinding.executionPreflightSha256}:{})},expectedFiles,env,fetchImpl,signal,now});
  active(signal,r,now);const credentials={email:env.FCOS_HOSTED_RUNTIME_EMAIL,password:env.FCOS_HOSTED_RUNTIME_PASSWORD,expectedRole:t.login.publicAuth.identity.role};
  const publicAuth=plan.schemaVersion===3?parseExecutionPreflight(r.executionPreflightJson,t,now()):t.login.publicAuth;
  validateLegacyRuntimePublicAuth({origin:t.login.origin,...credentials,publicAuth,now:now()});
  const auth=await loginLegacyHostedRuntime({origin:t.login.origin,credentials,mode:'runtime',publicAuth,protectionState:await loginProtection(t.login.origin,env),fetchImpl:(u,o)=>{active(signal,r,now);return fetchImpl(u,{...o,signal:AbortSignal.any([signal,o.signal].filter(Boolean))});},now,ownerRecoveryProviderToken:true});
  active(signal,r,now);await verifyCourierOidc({token:oidc,t,runId,audience,fetchImpl,jwks,signal,now});
  need(typeof env.FCOS_PRODUCTION_VERIFICATION_BYPASS==='string'&&env.FCOS_PRODUCTION_VERIFICATION_BYPASS.length>0&&env.FCOS_PRODUCTION_VERIFICATION_BYPASS.length<=16384&&!/[\r\n]/.test(env.FCOS_PRODUCTION_VERIFICATION_BYPASS),'XERO_COURIER_LOGIN_PROTECTION_REQUIRED');
  need(typeof env.FCOS_XERO_RECOVERY_REQUEST_NONCE==='string'&&hash(env.FCOS_XERO_RECOVERY_REQUEST_NONCE)===t.hostConfiguration.requestNonceSha256,'XERO_COURIER_NONCE_REQUIRED');
  // Same existing verification-environment protection header; no new secret
  // slot, cookie or bypass provisioning. Source/target was verified above.
  // ONE explicit GET, no body/query, no financial execute, retry, dispatch,
  // ref publication, failure marker or cleanup request follows uncertainty.
  const response=await fetchImpl(`${host.origin}/xero-recovery`,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),headers:{'x-vercel-protection-bypass':env.FCOS_PRODUCTION_VERIFICATION_BYPASS,authorization:`Bearer ${oidc}`,'x-fcos-owner-bearer':auth.token,'x-fcos-provider-access-token':auth.providerAccessToken,'x-fcos-recovery-nonce':env.FCOS_XERO_RECOVERY_REQUEST_NONCE}});
  need(response.status===200&&!response.redirected&&(!response.url||response.url===`${host.origin}/xero-recovery`),'XERO_COURIER_HTTP_OUTCOME_UNKNOWN');
  const resultJson=(await bounded(response,16384)).toString('utf8');active(signal,r,now);validateOwnerReadbackResult(JSON.parse(resultJson),{plan,planSha256,now:now()});
  const ack={schemaVersion:1,kind:'fcos_xero_owner_readback_actual_http_ack_v1',templateSha256,planSha256,admissionScopeSha256:r.admissionScopeSha256,dispatchId:r.dispatchId,originalRunId:r.originalBinding.runId,readerRunId:runId,readerJobId:actual.job.id,hostOrigin:host.origin,deploymentId:host.deploymentId,httpStatus:200,resultJson,resultSha256:bytesHash(resultJson),receivedAt:now()};
  const result=assertOwnerReadbackAck(ack,{parsed,readback:r,readerRunId:runId,readerJobId:actual.job.id,now:now()});
  await captureCourierAck({ack,t:r,runId,signal,now,artifactName:ownerReadbackArtifactName(r.originalBinding.runId,runId,plan.binding.operationId)});
  return{status:result.state==='submitted_unknown'?'unknown_owner_readback_required':'durable_owner_readback_observed_no_replay',originalOutcomeResolved:false,retryable:false,executionAuthorityGranted:false,qualificationAccepted:false};
}
export async function carrierMain(env=process.env,options={}) {
  try { need(typeof env.FCOS_XERO_CARRIER_TEMPLATE_BASE64==='string');const bytes=Buffer.from(env.FCOS_XERO_CARRIER_TEMPLATE_BASE64,'base64');need(bytes.length<=65536 && bytes.toString('base64')===env.FCOS_XERO_CARRIER_TEMPLATE_BASE64);
    const mode=env.FCOS_XERO_CARRIER_MODE||'submit';need(['submit','owner-readback'].includes(mode));const templateJson=bytes.toString('utf8'),parsed=parseCourierTemplate(templateJson);
    let readbackJson;const window=mode==='owner-readback'?(()=>{need(typeof env.FCOS_XERO_OWNER_READBACK_BASE64==='string');const raw=Buffer.from(env.FCOS_XERO_OWNER_READBACK_BASE64,'base64');need(raw.length<=4096&&raw.toString('base64')===env.FCOS_XERO_OWNER_READBACK_BASE64);readbackJson=raw.toString('utf8');return parseOwnerReadbackCarrier(readbackJson,parsed);})():parsed.template;
    const controller=new AbortController();const stop=()=>controller.abort();const deadline=setTimeout(stop,Math.max(0,window.notAfter-(options.now||Date.now)()));deadline.unref?.();process.once('SIGTERM',stop);process.once('SIGINT',stop);
    try{return await (mode==='owner-readback'?runXeroRecoveryOwnerReadback:env.FCOS_XERO_CARRIER_PHASE==='preparation'?prepareWarmXeroRecoveryCarrier:runWarmXeroRecoveryCarrier)({templateJson,readbackJson,env,signal:controller.signal,...options});}finally{clearTimeout(deadline);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
  }catch(e){throw refusal(safeCode(e));}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))carrierMain().then(v=>process.stdout.write(JSON.stringify(v)+'\n')).catch(e=>{process.stderr.write(safeCode(e)+'\n');process.exitCode=1;});
