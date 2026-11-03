import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {FIRST_RUNTIME,firstRuntimeDigest,firstRuntimeTargets} from './first-runtime.mjs';
import {fcosSalesforceEnvironment} from '../../../config/fcosConnections.js';
import {legacyRuntimeLoginFailureCode,validateLegacyRuntimePublicAuth} from './legacy-hosted-runtime-login.mjs';

const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const need=v=>{if(!v)throw Error('LEGACY_SALESFORCE_IDENTITY_OBSERVATION_REFUSED');};
const path='/api/functions/missingNomBList',body='{"cursor":"!"}';
const code='MISSING_NOM_B_CURSOR_INVALID',message='Refresh the list to restart pagination.';
const sources=Object.freeze([
  ['api/functions/[name].js','fb369eebb9065cc00da6c7dca13ea316bbc7ed2ab5e341571132300054c2794a'],
  ['api/_missingNomB.js','78d73c4375ee4d5eed1c0b3309fbf5dd2c24609a3f8a08fce8de2995ab3e407a'],
  ['api/_salesforce.js','711bb688435c63ec727ab2c96e3af906fac0a51bd43c04b823fd5c78332ea107'],
  ['api/_handlerPolicyRegistry.js','45d649e5b6732f78773b8fb8086e80d2e08567bd2ec69112547a1f9a0265f87e'],
  ['config/fcosConnections.js','2d5895eb6e65a1141d05b8964ba08d333a57ad9a44988044078d80d578be7fca'],
  ['shared/functionContracts.js','39024fc3dbb961d79bdb1cfd96d615c874b2f47bb2e0cca23d86439826a8139e'],
  ['api/_publicApiError.js','38272607b6b558b32fe95cc45aaea3db35dd7b64942a1aef23b59a3fa7a4cfec'],
  ['api/_readOnlyCiAccess.js','d1015ef0caa22237898c33a71645f8e0aff6fafa81fdcf9bc8c12ab6d0acc3d7'],
]);

// Git objects are data only. These full-file pins cover dispatch, admission,
// body/contract validation, selected Salesforce auth, the mandatory identity
// guard before cursor parsing, read-only policy and the exact public 400 shape.
function verifySource(controllerDirectory) {
  need(controllerDirectory&&!Object.keys(process.env).some(k=>k.startsWith('GIT_')&&!['GIT_PAGER','GIT_EDITOR','GIT_SEQUENCE_EDITOR','GIT_TERMINAL_PROMPT'].includes(k)));
  const cwd=realpathSync(resolve(controllerDirectory));
  const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd,encoding:null,stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:8*1024*1024,
    env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'}});
  const repository=firstRuntimeTargets().repository,remote=git(['remote','get-url','origin']).toString('utf8').trim();
  need([`https://github.com/${repository}.git`,`https://github.com/${repository}`,`git@github.com:${repository}.git`].includes(remote));
  const records=sources.map(([path,sha256])=>{const bytes=git(['show',`${FIRST_RUNTIME.previousSha}:${path}`]);need(firstRuntimeDigest(bytes)===sha256);return {path,sha256};});
  return {kind:'fcos_immutable_legacy_salesforce_identity_read_source_v1',verified:true,sha:FIRST_RUNTIME.previousSha,sourceSha256:FIRST_RUNTIME.sourceSha256,
    files:records,sha256:firstRuntimeDigest(records)};
}

function verifiedProduction(binding,production,now) {
  need(Number.isFinite(now)&&exact(binding,['kind','deploymentId','sha','sourceSha256','origin','path'])&&binding.kind==='fcos_legacy_salesforce_identity_read_v1'
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

function actor(publicAuth,origin,now) {
  return validateLegacyRuntimePublicAuth({publicAuth,origin,email:publicAuth?.identity?.email,expectedRole:'general_manager',now}).identity;
}
function ownBearer(token,identity,publicAuth,started,now) {
  need(typeof token==='string'&&token.length<=16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));
  const c=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  // This is a local actor/target consistency check, not signature verification.
  // Existing hosted login and the actual app verify the token with Supabase.
  need(c.iss===`${publicAuth.supabaseOrigin}/auth/v1`&&c.sub===identity.profileId&&c.role==='authenticated'
    &&(c.aud==='authenticated'||Array.isArray(c.aud)&&c.aud.includes('authenticated'))
    &&Number.isSafeInteger(c.iat)&&c.iat*1000>=started-30000&&c.iat*1000<=now+30000&&Number.isSafeInteger(c.exp)&&c.exp*1000>now
    &&(publicAuth.preflight.linkRevokedBefore===null||c.iat*1000>Date.parse(publicAuth.preflight.linkRevokedBefore)));
}

async function cursorError(response) {
  const length=response.headers.get('content-length');
  need(response.body?.getReader&&(length===null||/^\d+$/.test(length)&&Number(length)<=4096));
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;need(size<=4096);chunks.push(Buffer.from(r.value));}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks),v=JSON.parse(bytes.toString('utf8'));
  need(exact(v,['error','message','code','requestId'])&&v.code===code&&v.error===message&&v.message===message
    &&typeof v.requestId==='string'&&v.requestId.length>0&&v.requestId.length<=160&&!/[\u0000-\u001f\u007f]/.test(v.requestId));
  return {code,responseSha256:firstRuntimeDigest(bytes)};
}

/** Inactive opt-in setup read. Exactly one existing application POST with an
 * invalid cursor runs its mandatory Organization guard, then stops before any
 * nominations, facts or profile-directory queries. It does not list business
 * records. The app may use JWT signing, OAuth/session refresh, provider retries
 * and ordinary incident audit on unexpected 5xx. No new credentials, signing
 * keys/receipts, direct provider calls or financial actions are introduced.
 * The expected guard outcome is source-derived, never raw returned Org fields
 * or proof of the selected JWT/OAuth mode. This grants no release authority. */
export async function observeLegacySalesforceIdentity({binding,production,controllerDirectory,publicAuth,tokenProvider,protection,recheckProduction,bypass,fetchImpl=fetch,now=Date.now}={}) {
  const sf=fcosSalesforceEnvironment('production');
  const report={schemaVersion:1,kind:'fcos_legacy_salesforce_identity_read_observation_v1',status:'unknown',baselineAccepted:false,qualificationAccepted:false,
    readOnly:true,appOwnedAuth:{state:'unknown',selectedMode:'unknown',orgId:null,isSandbox:null,providerTargetExpected:{instanceUrl:sf.instanceUrl,orgId:sf.orgId,isSandbox:sf.isSandbox}},
    identityGuard:{state:'unknown',provenance:'source_enforced_organization_guard_before_exact_invalid_cursor_error',rawOrganizationFieldsObserved:false},
    behavior:{applicationSelectedAuth:true,existingJwtOrRefreshMayOccur:true,existingProviderReadRetriesMayOccur:true,ordinaryErrorLoggingMayOccur:true,
      newCredentials:false,newSigningKeys:false,newSigningReceipt:false,directProviderCalls:0,outerRetries:0,nominationListRead:false,businessQueries:0},httpStatus:null,failures:[]};
  let failure='LEGACY_SALESFORCE_IDENTITY_BINDING_INVALID',response;
  try{
    const started=now(),deployment=verifiedProduction(binding,production,started);
    need(typeof protection==='function'&&typeof tokenProvider==='function'&&typeof fetchImpl==='function'&&typeof bypass==='string'&&bypass.length>0&&bypass.length<=8192);
    failure='LEGACY_SALESFORCE_IDENTITY_TARGET_CHANGED';need(typeof recheckProduction==='function');
    failure='LEGACY_SALESFORCE_IDENTITY_SOURCE_INVALID';const source=verifySource(controllerDirectory);
    failure='LEGACY_SALESFORCE_IDENTITY_ACTOR_INVALID';const identity=actor(publicAuth,binding.origin,started);
    report.binding={...binding,publicVersionSha256:production.publicVersion.sha256,productionObservedAt:production.capturedAt};report.source=source;
    failure='LEGACY_SALESFORCE_IDENTITY_LOGIN_UNKNOWN';
    const protectionState=await protection({origin:binding.origin,sha:binding.sha,bypass});
    const token=await tokenProvider({origin:binding.origin,deployment,protectionState});
    failure='LEGACY_SALESFORCE_IDENTITY_ACTOR_INVALID';actor(publicAuth,binding.origin,now());ownBearer(token,identity,publicAuth,started,now());
    // Native Production and its public receipt must be freshly observed after
    // asynchronous login, immediately before this single bounded POST.
    failure='LEGACY_SALESFORCE_IDENTITY_TARGET_CHANGED';verifiedProduction(binding,production,now());
    const recheckStarted=now(),current=await recheckProduction(),recheckFinished=now();
    verifiedProduction(binding,current,recheckFinished);
    need(current!==production&&Date.parse(current.capturedAt)>Date.parse(report.binding.productionObservedAt)
      &&Date.parse(current.capturedAt)>=recheckStarted&&Date.parse(current.capturedAt)<=recheckFinished
      &&current.publicVersion.sha256===report.binding.publicVersionSha256);
    report.binding.productionRecheckedAt=current.capturedAt;
    actor(publicAuth,binding.origin,now());ownBearer(token,identity,publicAuth,started,now());
    failure='LEGACY_SALESFORCE_IDENTITY_READ_UNKNOWN';const url=`${binding.origin}${path}`;
    response=await fetchImpl(url,{method:'POST',body,headers:{authorization:`Bearer ${token}`,'x-vercel-protection-bypass':bypass,'content-type':'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(Number.isSafeInteger(response?.status)&&response.status>=100&&response.status<=599)report.httpStatus=response.status;
    need(response.status===400&&response.ok===false&&!response.redirected&&(!response.url||response.url===url)
      &&response.headers?.get('x-fcos-handler-mutation')==='0'&&response.headers.get('x-fcos-external-action')==='0'
      &&/(?:^|,)\s*no-store\b/i.test(response.headers.get('cache-control')||'')
      &&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''));
    failure='LEGACY_SALESFORCE_IDENTITY_RESPONSE_UNKNOWN';const result=await cursorError(response);
    verifiedProduction(binding,production,now());verifiedProduction(binding,current,now());actor(publicAuth,binding.origin,now());
    report.status='observed';report.capturedAt=new Date(now()).toISOString();report.appOwnedAuth.state='authenticated';report.identityGuard.state='passed';report.result=result;
  }catch(error){
    const loginPhase=failure==='LEGACY_SALESFORCE_IDENTITY_LOGIN_UNKNOWN'?legacyRuntimeLoginFailureCode(error):null;
    report.failures=[{code:failure,...(loginPhase?{loginPhase}:{})}];
  }
  finally{try{if(response?.body&&!response.body.locked&&typeof response.body.cancel==='function')await response.body.cancel();}catch{/* Do not expose private diagnostics. */}}
  return report;
}
