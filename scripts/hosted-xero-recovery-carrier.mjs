// Trusted controller only. Import performs no reads, credential access or writes.
import { createLocalJWKSet, jwtVerify } from 'jose';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { loginLegacyHostedRuntime, validateLegacyRuntimePublicAuth } from './lib/hosted-release/legacy-hosted-runtime-login.mjs';
import { createVercelReadTransport, validateVercelReadAcceptance } from './lib/hosted-release/vercel-read-auth.mjs';
import { createCourierReadBudget, parseCourierTemplate, parseCourierRequest, courierPrefix, courierRequestRef, courierArtifactName, assertCourierRun,
  readCourierGitFile, assertCourierAck, hash, bytesHash, exact, need, refusal, safeCode, REPOSITORY, RUNTIME_MATERIAL_FILENAME } from './lib/hosted-release/xero-recovery-native-relay.mjs';
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
    return JSON.parse((await bounded(response,262144)).toString('utf8'));
  };
}
// Commit author text is not publisher proof. Missing/delayed event attribution
// stays a dependency; it never authenticates a request or causes a replay.
export async function courierPublicationObserved(read, ref, commitSha) {
  const events = await read(`repos/${REPOSITORY}/events?per_page=100`);
  need(Array.isArray(events) && events.length <= 100, 'XERO_COURIER_EVENT_READ_UNKNOWN');
  return events.some(e => e.type==='PushEvent' && e.repo?.name===REPOSITORY && e.actor?.id===265701760 && e.actor.login==='hocheunglai-oss'
    && e.payload?.ref===ref && e.payload?.head===commitSha);
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
// No metadata attestation substitute: lambda/opaque trees, omitted files, or
// unavailable original bytes remain source_bytes_unproven. The actual mapping
// for prebuilt .func sources has NOT been demonstrated with the approved reader.
export async function verifyCourierDeploymentBytes({t,locator,expectedFiles,env,fetchImpl=fetch,signal,now=Date.now}) {
  need(exact(locator,['schemaVersion','kind','deploymentId','url']) && locator.schemaVersion===1 && locator.kind==='fcos_xero_host_locator_v1'
    && /^dpl_[A-Za-z0-9]+$/.test(locator.deploymentId) && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(locator.url), 'XERO_COURIER_LOCATOR_INVALID');
  validateVercelReadAcceptance(t.readCredential,t.readAcceptance,{targets,now:now()});
  const transport=createVercelReadTransport({binding:t.readCredential,targets,env,fetchImpl:async(u,o)=>{const r=await fetchImpl(u,{...o,signal:AbortSignal.any([signal,o.signal,AbortSignal.timeout(15000)].filter(Boolean))});Object.defineProperty(r,'json',{value:async()=>JSON.parse((await bounded(r,262144)).toString('utf8'))});return r;},now}); await transport.configuration();
  const d=await transport.get(`/v13/deployments/${locator.deploymentId}`);
  need(d.id===locator.deploymentId && d.projectId===PROJECT && d.teamId===TEAM && d.readyState==='READY' && `https://${d.url}`===locator.url
    && (d.customEnvironment?.id===t.hostConfiguration.target.customEnvironment || d.customEnvironment?.slug===t.hostConfiguration.target.customEnvironment), 'XERO_COURIER_DEPLOYMENT_MISMATCH');
  async function read(path, maximum) { need(!signal.aborted); const u=new URL(`https://api.vercel.com${path}`);u.searchParams.set('teamId',TEAM);
    const r=await fetchImpl(u,{method:'GET',redirect:'error',signal,cache:'no-store',headers:{authorization:`Bearer ${env.FCOS_HOSTED_VERCEL_READ_TOKEN}`}});
    need(r.ok && !r.redirected && (!r.url || r.url===u.href), 'XERO_COURIER_SOURCE_BYTES_UNPROVEN'); return bounded(r,maximum); }
  let tree; try { tree=JSON.parse((await read(`/v6/deployments/${locator.deploymentId}/files`,262144)).toString('utf8')); } catch { throw refusal('XERO_COURIER_SOURCE_BYTES_UNPROVEN'); }
  const files=[];
  function visit(rows,prefix='') { need(Array.isArray(rows) && rows.length<=100, 'XERO_COURIER_SOURCE_BYTES_UNPROVEN');
    for(const row of rows) { need(typeof row.name==='string' && row.name.length<200 && !/[/\\\0]/.test(row.name) && !['.','..'].includes(row.name), 'XERO_COURIER_SOURCE_BYTES_UNPROVEN');
      const path=prefix+row.name; if(row.type==='directory')visit(row.children,`${path}/`);else{need(row.type==='file' && typeof row.uid==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.uid), 'XERO_COURIER_SOURCE_BYTES_UNPROVEN');files.push({path,uid:row.uid});} }
  }
  visit(tree); files.sort((a,b)=>a.path.localeCompare(b.path));
  need(Array.isArray(expectedFiles) && expectedFiles.length===3 && files.length===3 && new Set(files.map(f=>f.path)).size===3
    && files.every((f,i)=>f.path===expectedFiles[i].path && HASH.test(expectedFiles[i].sha256)), 'XERO_COURIER_SOURCE_BYTES_UNPROVEN');
  for(let i=0;i<files.length;i++) { const raw=await read(`/v8/deployments/${locator.deploymentId}/files/${files[i].uid}`,4194304), expected=expectedFiles[i];
    // Documented JSON/base64 as well as exact raw source bytes are safe only
    // because the final comparison uses the independently rebuilt exact bytes.
    const candidates=[raw];try{const j=JSON.parse(raw.toString('utf8'));if(typeof j==='string')candidates.push(Buffer.from(j,'base64'));if(exact(j,['data'])&&typeof j.data==='string')candidates.push(Buffer.from(j.data,'base64'));}catch{}
    need(candidates.some(b=>b.length===expected.bytes && bytesHash(b)===expected.sha256 && b.toString('base64')===expected.contentBase64), 'XERO_COURIER_SOURCE_BYTES_UNPROVEN'); }
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
export async function captureCourierAck({ack,t,runId,submissionId,signal,now=Date.now}) {
  active(signal,t,now);
  const directory=mkdtempSync(join(tmpdir(),'fcos-xero-ack-'));
  try { const path=join(directory,RUNTIME_MATERIAL_FILENAME);writeFileSync(path,JSON.stringify(ack),{mode:0o600,flag:'wx'});
    const {DefaultArtifactClient}=await import('@actions/artifact');active(signal,t,now);
    const client=new DefaultArtifactClient(),originalOut=process.stdout.write,originalErr=process.stderr.write;
    let uploaded;try{active(signal,t,now);process.stdout.write=()=>true;process.stderr.write=()=>true;uploaded=await client.uploadArtifact(courierArtifactName(runId,submissionId),[path],directory,{retentionDays:7,compressionLevel:0});}
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
export async function runWarmXeroRecoveryCarrier({templateJson,env=process.env,fetchImpl=fetch,now=Date.now,jwks,signal,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const {template:t,templateSha256,plan,planSha256}=parseCourierTemplate(templateJson);active(signal,t,now);
  need(env.GITHUB_REPOSITORY===REPOSITORY && env.GITHUB_RUN_ATTEMPT==='1' && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID), 'XERO_COURIER_RUN_MISMATCH');
  const runId=env.GITHUB_RUN_ID,read=courierGithubReader({env,fetchImpl,signal,now,wait}),actual=await assertCourierRun(read,t,runId),prefix=courierPrefix(t,runId);
  let locator;
  while(!locator) { active(signal,t,now);const found=await readCourierGitFile(read,`${prefix}/locator`,'locator.json',2048);
    if(found && await courierPublicationObserved(read,found.ref,found.commitSha))locator=JSON.parse(found.raw);else await wait(10000); }
  const expectedFiles=await buildCourierExpectedFiles({t,runId});
  const host=await verifyCourierDeploymentBytes({t,locator,expectedFiles,env,fetchImpl,signal,now});
  const checkpoint={};let previous=null,next='preflight';
  while(next) { active(signal,t,now);const refs=await read(`repos/${REPOSITORY}/git/matching-refs/${prefix.slice(5)}/request-${next}-`);
    need(Array.isArray(refs) && refs.length<=1,'XERO_COURIER_REQUEST_AMBIGUOUS');if(!refs.length){await wait(10000);continue;}
    const found=await readCourierGitFile(read,refs[0].ref,'request.json',2048);need(found);
    if(!await courierPublicationObserved(read,found.ref,found.commitSha)){await wait(10000);continue;}
    const request=parseCourierRequest(found.raw,t);need(found.ref===courierRequestRef(t,runId,found.raw) && request.step===next && request.previousResultSha256===previous,'XERO_COURIER_REQUEST_INVALID');
    const current=await assertCourierRun(read,t,runId);need(current.job.id===actual.job.id);
    const audience=`${host.origin}/xero-recovery`,oidc=await ownOidc(env,audience,fetchImpl,signal);
    await verifyCourierOidc({token:oidc,t,runId,audience,fetchImpl,jwks,signal,now});
    const credentials={email:env.FCOS_HOSTED_RUNTIME_EMAIL,password:env.FCOS_HOSTED_RUNTIME_PASSWORD,expectedRole:t.login.publicAuth.identity.role};
    validateLegacyRuntimePublicAuth({origin:t.login.origin,...credentials,publicAuth:t.login.publicAuth,now:now()});
    const auth=await loginLegacyHostedRuntime({origin:t.login.origin,credentials,mode:'runtime',publicAuth:t.login.publicAuth,
      protectionState:await loginProtection(t.login.origin,env),fetchImpl:(u,o)=>{active(signal,t,now);return fetchImpl(u,{...o,signal:AbortSignal.any([signal,o.signal].filter(Boolean))});},now,ownerRecoveryProviderToken:true});
    active(signal,t,now);await verifyCourierOidc({token:oidc,t,runId,audience,fetchImpl,jwks,signal,now});
    need(typeof env.FCOS_XERO_RECOVERY_REQUEST_NONCE==='string' && hash(env.FCOS_XERO_RECOVERY_REQUEST_NONCE)===t.hostConfiguration.requestNonceSha256,'XERO_COURIER_NONCE_REQUIRED');
    // Exactly one HTTP attempt. Any thrown/lost/non-200 result ends this job;
    // no failure marker, host GET, refresh, cleanup request or next POST follows.
    const response=await fetchImpl(`${host.origin}/xero-recovery`,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),cache:'no-store',
      headers:{authorization:`Bearer ${oidc}`,'x-fcos-owner-bearer':auth.token,'x-fcos-provider-access-token':auth.providerAccessToken,'x-fcos-recovery-nonce':env.FCOS_XERO_RECOVERY_REQUEST_NONCE,'content-type':'application/json'},body:found.raw});
    need(response.status===200 && !response.redirected && (!response.url || response.url===`${host.origin}/xero-recovery`),'XERO_COURIER_HTTP_OUTCOME_UNKNOWN');
    const resultJson=(await bounded(response,16384)).toString('utf8'),ack={schemaVersion:1,kind:'fcos_xero_recovery_actual_http_ack_v1',templateSha256,runId,jobId:actual.job.id,requestRef:found.ref,commitSha:found.commitSha,
      requestSha256:hash(found.raw),hostOrigin:host.origin,deploymentId:host.deploymentId,httpStatus:200,resultJson,resultSha256:bytesHash(resultJson),receivedAt:now()};
    const result=assertCourierAck(ack,{templateSha256,runId,jobId:actual.job.id,request,requestRef:found.ref,commitSha:found.commitSha,...host,hostOrigin:host.origin,plan,planSha256,checkpoint,now:now()});
    // The trusted native prepared intent admits ONE sanitized capture upload.
    // Hashes alone never create that authority. Its actual setup review remains
    // a required external gate; the workflow is not activated by this source.
    await captureCourierAck({ack,t,runId,submissionId:request.submissionId,signal,now});
    checkpoint[next]=result.result;previous=result.resultSha256;next=result.nextStep;
  }
  return {status:'complete',operationId:plan.binding.operationId,executionAuthorityGranted:false,qualificationAccepted:false};
}
export async function carrierMain(env=process.env,options={}) {
  try { need(typeof env.FCOS_XERO_CARRIER_TEMPLATE_BASE64==='string');const bytes=Buffer.from(env.FCOS_XERO_CARRIER_TEMPLATE_BASE64,'base64');need(bytes.length<=65536 && bytes.toString('base64')===env.FCOS_XERO_CARRIER_TEMPLATE_BASE64);
    const controller=new AbortController();const stop=()=>controller.abort();const parsed=parseCourierTemplate(bytes.toString('utf8'));const deadline=setTimeout(stop,Math.max(0,parsed.template.notAfter-(options.now||Date.now)()));deadline.unref?.();process.once('SIGTERM',stop);process.once('SIGINT',stop);
    try{return await runWarmXeroRecoveryCarrier({templateJson:bytes.toString('utf8'),env,signal:controller.signal,...options});}finally{clearTimeout(deadline);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
  }catch(e){throw refusal(safeCode(e));}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))carrierMain().then(v=>process.stdout.write(JSON.stringify(v)+'\n')).catch(e=>{process.stderr.write(safeCode(e)+'\n');process.exitCode=1;});
