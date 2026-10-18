import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {FIRST_RUNTIME,firstRuntimeDigest,firstRuntimeTargets} from './first-runtime.mjs';
import {fcosSalesforceEnvironment} from '../../../config/fcosConnections.js';
import {legacyRuntimeLoginFailureCode} from './legacy-hosted-runtime-login.mjs';

const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const need=v=>{if(!v)throw Error('LEGACY_SALESFORCE_APP_OBSERVATION_REFUSED');};
const path='/api/functions/salesforceSchema';
const sources=Object.freeze([
  ['api/functions/[name].js','fb369eebb9065cc00da6c7dca13ea316bbc7ed2ab5e341571132300054c2794a'],
  ['api/_salesforce.js','711bb688435c63ec727ab2c96e3af906fac0a51bd43c04b823fd5c78332ea107'],
  ['api/_handlerPolicyRegistry.js','45d649e5b6732f78773b8fb8086e80d2e08567bd2ec69112547a1f9a0265f87e'],
  ['config/fcosConnections.js','2d5895eb6e65a1141d05b8964ba08d333a57ad9a44988044078d80d578be7fca'],
]);

/** Immutable Git is data only. Never execute a candidate or deployed helper.
 * Full file pins include route dispatch, active auth precedence, retries,
 * admission, ordinary error handling and the uncached read-only registry. */
function verifySource(controllerDirectory) {
  need(controllerDirectory&&!Object.keys(process.env).some(k=>k.startsWith('GIT_')&&!['GIT_PAGER','GIT_EDITOR','GIT_SEQUENCE_EDITOR','GIT_TERMINAL_PROMPT'].includes(k)));
  const cwd=realpathSync(resolve(controllerDirectory));
  const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd,encoding:null,stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:8*1024*1024,
    env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'}});
  const repository=firstRuntimeTargets().repository,remote=git(['remote','get-url','origin']).toString('utf8').trim();
  need([`https://github.com/${repository}.git`,`https://github.com/${repository}`,`git@github.com:${repository}.git`].includes(remote));
  const records=sources.map(([path,sha256])=>{const bytes=git(['show',`${FIRST_RUNTIME.previousSha}:${path}`]);need(firstRuntimeDigest(bytes)===sha256);return {path,sha256};});
  return {kind:'fcos_immutable_legacy_salesforce_app_read_source_v1',verified:true,sha:FIRST_RUNTIME.previousSha,sourceSha256:FIRST_RUNTIME.sourceSha256,
    files:records,sha256:firstRuntimeDigest(records)};
}

function verifiedProduction(binding,production,now) {
  need(exact(binding,['kind','deploymentId','sha','sourceSha256','origin','path'])&&binding.kind==='fcos_legacy_salesforce_app_read_v1'
    &&binding.deploymentId===FIRST_RUNTIME.previousDeploymentId&&binding.sha===FIRST_RUNTIME.previousSha&&binding.sourceSha256===FIRST_RUNTIME.sourceSha256
    &&binding.origin===FIRST_RUNTIME.previousUrl&&binding.path===path);
  const d=production?.deployment,v=production?.publicVersion,t=firstRuntimeTargets(),original=production?.originalBinding;
  need(production?.readOnly===true&&production.bindingMode==='exact_legacy_public_version'
    &&typeof production.capturedAt==='string'&&Number.isFinite(Date.parse(production.capturedAt))&&Date.parse(production.capturedAt)<=now+30000&&now-Date.parse(production.capturedAt)<=1800000
    &&d?.id===binding.deploymentId&&d.sha===binding.sha&&d.sourceSha256===binding.sourceSha256&&d.url===binding.origin&&d.state==='READY'&&d.target==='production'
    &&d.teamId===t.vercelTeam&&d.projectId===t.vercelProject&&v?.commit===binding.sha&&v.deploymentId===null&&v.sourceAttested===false&&hash(v.sha256)
    &&original?.deploymentId===binding.deploymentId&&original.immutableUrl===binding.origin&&original.commit===binding.sha&&original.sourceDigest===binding.sourceSha256
    &&original.publicVersionSha256===v.sha256);
  return d;
}

async function metadata(response) {
  need(response.body?.getReader&&(!response.headers.get('content-length')||Number(response.headers.get('content-length'))<=1048576));
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;need(size<=1048576);chunks.push(Buffer.from(r.value));}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks),value=JSON.parse(bytes.toString('utf8'));
  need(exact(value,['objects'])&&Array.isArray(value.objects)&&value.objects.length>0&&value.objects.length<=10000
    &&new Set(value.objects.map(o=>o?.name)).size===value.objects.length
    &&value.objects.every(o=>exact(o,['name','label','queryable','custom'])&&typeof o.name==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,159}$/.test(o.name)
      &&typeof o.label==='string'&&o.label.length<=512&&o.queryable===true&&typeof o.custom==='boolean'));
  return {objectCount:value.objects.length,customObjectCount:value.objects.filter(o=>o.custom).length,responseSha256:firstRuntimeDigest(bytes)};
}

/** Opt-in setup observation only. The injected protection/token callbacks own
 * existing hosted login, target and user/module admission. It observes the
 * deployed application's usual auth; it never signs, refreshes or exports any
 * Salesforce credential itself. Ordinary app JWT/refresh/retry/error logging
 * may occur behind this existing read endpoint and are explicitly disclosed. */
export async function observeLegacySalesforceApp({binding,production,controllerDirectory,tokenProvider,protection,recheckProduction,bypass,fetchImpl=fetch,now=Date.now}={}) {
  const sf=fcosSalesforceEnvironment('production');
  const report={schemaVersion:1,kind:'fcos_legacy_salesforce_app_read_observation_v1',status:'unknown',baselineAccepted:false,qualificationAccepted:false,
    readOnly:true,appOwnedAuth:{state:'unknown',selectedMode:'unknown',orgId:null,isSandbox:null,providerTargetExpected:{instanceUrl:sf.instanceUrl,orgId:sf.orgId,isSandbox:false}},
    behavior:{applicationSelectedAuth:true,existingJwtOrRefreshMayOccur:true,existingProviderReadRetriesMayOccur:true,ordinaryErrorLoggingMayOccur:true,
      newCredentials:false,newSigningKeys:false,newSigningReceipt:false,outerRetries:0},httpStatus:null,failures:[]};
  let failure='LEGACY_SALESFORCE_APP_BINDING_INVALID',response;
  try{
    const started=now(),deployment=verifiedProduction(binding,production,started);
    need(typeof protection==='function'&&typeof tokenProvider==='function'&&typeof fetchImpl==='function'&&typeof bypass==='string'&&bypass.length>0&&bypass.length<=8192);
    failure='LEGACY_SALESFORCE_APP_TARGET_CHANGED';need(typeof recheckProduction==='function');
    failure='LEGACY_SALESFORCE_APP_SOURCE_INVALID';const source=verifySource(controllerDirectory);
    report.binding={...binding,publicVersionSha256:production.publicVersion.sha256,productionObservedAt:production.capturedAt};report.source=source;
    failure='LEGACY_SALESFORCE_APP_LOGIN_UNKNOWN';
    const protectionState=await protection({origin:binding.origin,sha:binding.sha,bypass});
    const token=await tokenProvider({origin:binding.origin,deployment,protectionState});
    need(typeof token==='string'&&token.length>0&&token.length<=16384);
    // Retain the original admitted tuple/horizon, then actually re-observe the
    // native Production alias and receipt after asynchronous login. Reusing a
    // previously cached object/timestamp cannot satisfy this boundary.
    failure='LEGACY_SALESFORCE_APP_TARGET_CHANGED';
    verifiedProduction(binding,production,now());
    const recheckStarted=now(),current=await recheckProduction(),recheckFinished=now();
    verifiedProduction(binding,current,recheckFinished);
    need(current!==production&&Date.parse(current.capturedAt)>Date.parse(report.binding.productionObservedAt)
      &&Date.parse(current.capturedAt)>=recheckStarted&&Date.parse(current.capturedAt)<=recheckFinished
      &&current.publicVersion.sha256===report.binding.publicVersionSha256);
    report.binding.productionRecheckedAt=current.capturedAt;
    failure='LEGACY_SALESFORCE_APP_READ_UNKNOWN';const url=`${binding.origin}${path}`;
    response=await fetchImpl(url,{method:'GET',headers:{authorization:`Bearer ${token}`,'x-vercel-protection-bypass':bypass},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(Number.isSafeInteger(response?.status)&&response.status>=100&&response.status<=599)report.httpStatus=response.status;
    need(response.status===200&&response.ok&&!response.redirected&&(!response.url||response.url===url)
      &&response.headers?.get('x-fcos-handler-mutation')==='0'&&response.headers.get('x-fcos-external-action')==='0'
      &&/(?:^|,)\s*no-store\b/i.test(response.headers.get('cache-control')||'')
      &&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''));
    failure='LEGACY_SALESFORCE_APP_RESPONSE_UNKNOWN';const result=await metadata(response);
    verifiedProduction(binding,production,now());
    report.status='observed';report.capturedAt=new Date(now()).toISOString();report.appOwnedAuth.state='authenticated';report.result=result;
  }catch(error){
    const loginPhase=failure==='LEGACY_SALESFORCE_APP_LOGIN_UNKNOWN'?legacyRuntimeLoginFailureCode(error):null;
    report.failures=[{code:failure,...(loginPhase?{loginPhase}:{})}];
  }
  finally{try{if(response?.body&&!response.body.locked&&typeof response.body.cancel==='function')await response.body.cancel();}catch{/* Cleanup never exposes provider diagnostics. */}}
  return report;
}
