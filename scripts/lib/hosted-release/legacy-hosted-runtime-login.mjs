import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {FCOS_CONNECTION_POLICY,fcosConnectionIdentifier} from '../../../config/fcosConnections.js';
import {FCOS_READ_ONLY_CI} from '../../../config/fcosCiIdentity.js';
import {candidateProtectionState} from '../../e2e-protection-state.mjs';
import {FIRST_RUNTIME} from './first-runtime.mjs';

const federation=FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
const issuer=new URL(federation.issuer).origin,project=fcosConnectionIdentifier('supabase','Project ref');
const supabaseOrigin=new URL(federation.oidcCallbackUrl).origin;
const profileColumns='id,email,user_type,active,access_revision';
const effectiveAccessSourceSha256='f5e2678098eb9745e6915c9f23989cb7d46aa9de484132390dcbdab50cbbf4d9';
// Public source independently read at the canonical pinned issuer commit.
// These establish only ordinary own identity/session/authcode behavior.
const issuerSources=Object.freeze([
  ['app/admin/page.tsx','bf511edfcc8d719097c58be85a9673c7e71eb18356aee10f9c62eaeb6256bfc7'],
  ['app/api/admin/login/route.ts','26b17174c617f728f76defd5205fe50447ae34529f5784c127e9070b6acadf8a'],
  ['app/api/admin/session/route.ts','86333bdaeea1d11f7c63481fe1b3834e2e90c3b01150d54eb3268f657cf3b9e0'],
  ['app/api/oidc/authorize/route.ts','54b20f444b005332079bf9b906081db0b04982b59d09ca6f7f472aa3d574d8f3'],
  ['lib/useSimpleAdminAuth.ts','f166b0bc3a1962cd0176bbf8cdd8b0603e2d2207dded9a59fcb23c41b7e442e6'],
  ['lib/adminAuth.ts','ec26064248b45447fed7a5782136e61d28d7dfa806d56c473a43b8d10b69b767'],
]);
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const digest=v=>createHash('sha256').update(v).digest('hex');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const need=v=>{if(!v)throw Error('LEGACY_HOSTED_RUNTIME_LOGIN_REFUSED');};
const environmentKeys=['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ','DISPLAY','XAUTHORITY','PLAYWRIGHT_BROWSERS_PATH'];
const defaultEnvironment=()=>Object.fromEntries(environmentKeys.filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
const jwt=token=>{need(typeof token==='string'&&token.length<=16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));};

/** Public setup validation only; no password, browser or provider activity. */
export function validateLegacyRuntimePublicAuth({origin,email,expectedRole,publicAuth,now=Date.now()}={}) {
  need(origin===FIRST_RUNTIME.previousUrl&&typeof email==='string'&&email===email.trim().toLowerCase()&&email!==FCOS_READ_ONLY_CI.email
    &&['administrator','general_manager'].includes(expectedRole)&&Number.isFinite(now)
    &&federation.providerCommit==='9d8e05cd338e6105b6a495d68512f63692d3a48c');
  need(exact(publicAuth,['kind','supabaseOrigin','publicAnonKey','publicAnonKeySha256','issuerAuthorizationPath','identity','preflight'])
    &&publicAuth.kind==='fcos_legacy_runtime_own_profile_auth_v1'&&publicAuth.supabaseOrigin===supabaseOrigin
    &&publicAuth.issuerAuthorizationPath==='/api/oidc/authorize'&&typeof publicAuth.publicAnonKey==='string'&&hash(publicAuth.publicAnonKeySha256)
    &&digest(publicAuth.publicAnonKey)===publicAuth.publicAnonKeySha256);
  if(publicAuth.publicAnonKey.startsWith('sb_publishable_'))need(/^sb_publishable_[A-Za-z0-9_-]{16,112}$/.test(publicAuth.publicAnonKey));
  else{const anon=jwt(publicAuth.publicAnonKey);need(anon.role==='anon'&&anon.ref===project&&anon.iss==='supabase'&&Number.isSafeInteger(anon.exp)&&anon.exp>now/1000);}
  const i=publicAuth.identity,p=publicAuth.preflight;
  need(exact(i,['profileId','email','role','accessRevision','fcunoSubjectSha256'])&&uuid(i.profileId)&&i.email===email&&i.role===expectedRole
    &&Number.isSafeInteger(i.accessRevision)&&i.accessRevision>0&&hash(i.fcunoSubjectSha256));
  need(exact(p,['kind','accepted','reviewerId','capturedAt','sourceSha','sourceSha256','origin','deploymentId','profileRlsOwnSelect','authenticatedSelectOnly',
    'effectiveAccessSourceVerified','effectiveAdmin','profileExisting','linkExisting','linkBoundToProfile','linkSourceActive','linkUseFcos','linkRevokedBefore','issuer','effectiveAccessSourceSha256','evidenceSha256'])
    &&p.kind==='fcos_legacy_runtime_own_profile_preflight_v1'&&p.accepted===true&&p.reviewerId==='/root'
    &&p.sourceSha===FIRST_RUNTIME.previousSha&&p.sourceSha256===FIRST_RUNTIME.sourceSha256&&p.origin===origin&&p.deploymentId===FIRST_RUNTIME.previousDeploymentId
    &&['profileRlsOwnSelect','authenticatedSelectOnly','effectiveAccessSourceVerified','effectiveAdmin','profileExisting','linkExisting','linkBoundToProfile','linkSourceActive','linkUseFcos'].every(k=>p[k]===true)
    &&p.issuer===issuer&&p.effectiveAccessSourceSha256===effectiveAccessSourceSha256&&hash(p.evidenceSha256)
    &&typeof p.capturedAt==='string'&&Number.isFinite(Date.parse(p.capturedAt))&&Date.parse(p.capturedAt)<=now+30000&&now-Date.parse(p.capturedAt)<=1800000
    &&(p.linkRevokedBefore===null||typeof p.linkRevokedBefore==='string'&&Number.isFinite(Date.parse(p.linkRevokedBefore))));
  return publicAuth;
}

function admission({origin,credentials,mode,publicAuth,now}) {
  need(mode==='runtime'&&exact(credentials,['email','password','expectedRole'])&&typeof credentials.password==='string'&&credentials.password.length>0&&credentials.password.length<=8192);
  return validateLegacyRuntimePublicAuth({origin,email:credentials.email,expectedRole:credentials.expectedRole,publicAuth,now}).identity;
}

// Only the existing issuer sign-in and Supabase callback may leave this context.
// All FCOS APIs (including identity sync, authContext and outbox fanout), all
// WebSockets and all refresh-token requests are blocked before the first page.
function allowedBrowserRequest(request,origin,authorizationPath,credentials) {
  try{
    const u=new URL(request.url()),method=request.method(),type=request.resourceType();
    if(u.protocol!=='https:'||u.username||u.password||u.pathname.includes('%'))return false;
    if(u.origin===origin)return method==='GET'&&!u.pathname.startsWith('/api/')&&(
      type==='document'&&u.pathname==='/login'||['script','stylesheet','image','font'].includes(type)&&/^\/(?:assets\/[^.][^?]*|favicon\.(?:ico|svg)|manifest\.webmanifest)$/.test(u.pathname));
    if(u.origin===issuer){
      if(u.pathname==='/api/admin/login'){
        const headers=request.headers(),contentType=Object.entries(headers).find(([key])=>key.toLowerCase()==='content-type')?.[1];
        if(method!=='POST'||!['fetch','xhr'].includes(type)||u.search||!/^application\/json(?:\s*;|$)/i.test(contentType||''))return false;
        const body=JSON.parse(request.postData());
        return exact(body,['username','password'])&&body.username===credentials.email&&body.password===credentials.password;
      }
      if(u.pathname==='/api/admin/session')return method==='GET'&&['fetch','xhr'].includes(type)&&!u.search;
      return method==='GET'&&(type==='document'&&['/admin',authorizationPath].includes(u.pathname)
        ||['script','stylesheet','image','font'].includes(type)&&/^\/(?:assets\/|_next\/static\/|favicon\.)/.test(u.pathname));
    }
    if(u.origin===supabaseOrigin){
      if(method==='OPTIONS'&&u.pathname==='/auth/v1/user'&&!u.search){
        const headers=Object.fromEntries(Object.entries(request.headers()).map(([k,v])=>[k.toLowerCase(),v]));
        const requested=String(headers['access-control-request-headers']||'').toLowerCase().split(',').map(k=>k.trim()).filter(Boolean);
        return headers.origin===origin&&headers['access-control-request-method']==='GET'&&requested.length>0
          &&requested.every(k=>['apikey','authorization','x-client-info','x-supabase-api-version'].includes(k));
      }
      return method==='GET'&&['/auth/v1/authorize','/auth/v1/callback','/auth/v1/user'].includes(u.pathname);
    }
    return false;
  }catch{return false;}
}

async function readJson(fetchImpl,url,token,key) {
  const response=await fetchImpl(url,{method:'GET',headers:{authorization:`Bearer ${token}`,apikey:key,accept:'application/json','accept-profile':'public'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  try{
    need(response.status===200&&response.ok&&!response.redirected&&(!response.url||response.url===url)&&/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||'')
      &&response.body?.getReader&&(!response.headers.get('content-length')||Number(response.headers.get('content-length'))<=65536));
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;need(size<=65536);chunks.push(Buffer.from(r.value));}}
    finally{await reader.cancel().catch(()=>{});}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }finally{try{if(response.body&&!response.body.locked)await response.body.cancel();}catch{/* No raw provider errors escape. */}}
}

/** Shared transport mechanism for the runtime login and a provider-free local
 * interoperability probe. The login supplies the fixed private allowlist;
 * callers of loginLegacyHostedRuntime cannot replace that policy. */
export async function installLegacyRuntimeBrowserGate({context,allowRequest}) {
  need(typeof context?.route==='function'&&typeof context.routeWebSocket==='function'&&typeof context.newCDPSession==='function'&&typeof allowRequest==='function');
  let page,gateFailed=false;
  await context.route('**/*',async route=>{
    let ownPage=false;try{ownPage=!!page&&route.request().frame().page()===page;}catch{/* Workers/popups have no admitted page. */}
    return ownPage&&allowRequest(route.request())?route.continue():route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*',socket=>socket.close({code:1008,reason:'Authentication only'}));
  page=await context.newPage();
  // Playwright auto-continues redirected hops without invoking context.route.
  // Native Fetch interception independently gates every hop before transport.
  const native=await context.newCDPSession(page);
  need(typeof native.on==='function'&&typeof native.send==='function');
  native.on('Fetch.requestPaused',async event=>{
    const request={url:()=>event.request.url,method:()=>event.request.method,headers:()=>event.request.headers,postData:()=>event.request.postData,resourceType:()=>String(event.resourceType).toLowerCase()};
    const allowed=allowRequest(request);
    try{await native.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:event.requestId}:{requestId:event.requestId,errorReason:'BlockedByClient'});}
    catch{gateFailed=true;await context.close().catch(()=>{});}
  });
  await native.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  return {page,assertHealthy:()=>need(!gateFailed)};
}

/** Legacy setup observations only. Reuses approved own FCUNO authentication;
 * ordinary issuer/session synchronization may occur. No FCOS API is allowed
 * during login, no token/state is persisted, and no moduleAccess is invented.
 * The caller must admit publicAuth through the protected controller/setup. */
export async function loginLegacyHostedRuntime({origin,credentials,mode,protectionState,browserType=chromium,launchEnvironment=defaultEnvironment(),publicAuth,fetchImpl=fetch,now=Date.now}={}) {
  let browser,context,failure='LEGACY_HOSTED_RUNTIME_LOGIN_BINDING_INVALID',cleanupFailed=false;
  try{
    const started=now(),identity=admission({origin,credentials,mode,publicAuth,now:started});
    need(typeof fetchImpl==='function'&&typeof browserType?.launch==='function'&&launchEnvironment&&Object.keys(launchEnvironment).every(k=>environmentKeys.includes(k)&&typeof launchEnvironment[k]==='string'));
    const protection=candidateProtectionState(protectionState,origin,started);
    failure='LEGACY_HOSTED_RUNTIME_LOGIN_UNKNOWN';browser=await browserType.launch({headless:true,env:launchEnvironment});
    context=await browser.newContext({storageState:protection,viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:false});
    const {page,assertHealthy}=await installLegacyRuntimeBrowserGate({context,allowRequest:request=>allowedBrowserRequest(request,origin,publicAuth.issuerAuthorizationPath,credentials)});
    await page.goto(`${origin}/login`,{waitUntil:'domcontentloaded',timeout:45000});
    if(new URL(page.url()).origin!==issuer){await page.getByRole('button',{name:'Continue with FCUNO',exact:true}).click();await page.waitForURL(u=>u.origin===issuer,{timeout:30000});}
    const atIssuer=()=>{const u=new URL(page.url());need(u.origin===issuer&&u.pathname==='/admin');};
    atIssuer();await page.getByLabel('Username',{exact:true}).fill(credentials.email);
    atIssuer();await page.getByLabel('Password',{exact:true}).fill(credentials.password);atIssuer();
    await Promise.all([page.waitForURL(u=>u.origin===origin&&u.pathname==='/login'&&u.searchParams.get('federated')==='1'&&!u.searchParams.has('error')&&!u.searchParams.has('error_code'),{timeout:60000}),page.getByRole('button',{name:'Login',exact:true}).click()]);
    const key=`sb-${project}-auth-token`;
    await page.waitForFunction(({origin,key})=>{try{const u=new URL(window.location.href);return u.origin===origin&&u.pathname==='/login'&&u.searchParams.get('federated')==='1'&&typeof JSON.parse(window.localStorage.getItem(key))?.access_token==='string';}catch{return false;}},{origin,key},{timeout:30000});
    const token=await page.evaluate(({origin,key})=>{if(window.location.origin!==origin||window.location.pathname!=='/login'||new URLSearchParams(window.location.search).get('federated')!=='1')return null;try{return JSON.parse(window.localStorage.getItem(key))?.access_token;}catch{return null;}},{origin,key});
    assertHealthy();admission({origin,credentials,mode,publicAuth,now:now()});
    failure='LEGACY_HOSTED_RUNTIME_LOGIN_IDENTITY_INVALID';const claims=jwt(token),time=now();
    need(claims.iss===`${supabaseOrigin}/auth/v1`&&claims.sub===identity.profileId&&claims.role==='authenticated'
      &&(claims.aud==='authenticated'||Array.isArray(claims.aud)&&claims.aud.includes('authenticated'))
      &&Number.isSafeInteger(claims.iat)&&claims.iat*1000>=started-30000&&claims.iat*1000<=time+30000&&Number.isSafeInteger(claims.exp)&&claims.exp*1000>time
      &&(publicAuth.preflight.linkRevokedBefore===null||claims.iat*1000>Date.parse(publicAuth.preflight.linkRevokedBefore)));
    const user=await readJson(fetchImpl,`${supabaseOrigin}/auth/v1/user`,token,publicAuth.publicAnonKey);
    const linked=(user.identities||[]).filter(i=>i?.provider===federation.oidcProvider);
    need(user.id===identity.profileId&&user.email?.toLowerCase()===identity.email&&user.is_anonymous!==true&&linked.length===1
      &&typeof(linked[0].identity_data?.sub||linked[0].provider_id)==='string'&&digest(linked[0].identity_data?.sub||linked[0].provider_id)===identity.fcunoSubjectSha256);
    assertHealthy();admission({origin,credentials,mode,publicAuth,now:now()});
    const url=new URL('/rest/v1/user_profiles',supabaseOrigin);url.searchParams.set('select',profileColumns);url.searchParams.set('id',`eq.${user.id}`);
    const profiles=await readJson(fetchImpl,url.href,token,publicAuth.publicAnonKey);
    need(Array.isArray(profiles)&&profiles.length===1);const profile=profiles[0];
    need(exact(profile,profileColumns.split(','))&&profile.id===user.id&&profile.email?.toLowerCase()===identity.email&&profile.active===true
      &&profile.user_type===identity.role&&profile.access_revision===identity.accessRevision);
    assertHealthy();admission({origin,credentials,mode,publicAuth,now:now()});
    return {token,auth:{kind:'fcos_runtime_own_profile_auth_observation_v1',user:{id:profile.id,email:profile.email,user_type:profile.user_type,active:true,read_only_ci:false},
      provenance:{kind:'supabase_auth_user_and_rls_own_profile_get',capturedAt:new Date(now()).toISOString(),profileAccessRevision:profile.access_revision,
        preflightEvidenceSha256:publicAuth.preflight.evidenceSha256,authContextCalled:false,moduleAccessObserved:false,existingFcunoOwnIdentitySynchronizationMayOccur:true,
        issuerOwnSessionAndCodeCreationMayOccur:true,issuerOwnCookieRenewalOrInvalidSessionRevocationMayOccur:true,
        issuerSource:{repository:federation.providerRepository,sha:federation.providerCommit,files:issuerSources.map(([path,sha256])=>({path,sha256}))}}}};
  }catch{throw Object.assign(new Error(failure),{code:failure});}
  finally{
    try{await context?.close();}catch{cleanupFailed=true;}
    try{await browser?.close();}catch{cleanupFailed=true;}
    if(cleanupFailed)throw Object.assign(new Error('LEGACY_HOSTED_RUNTIME_LOGIN_CLEANUP_FAILED'),{code:'LEGACY_HOSTED_RUNTIME_LOGIN_CLEANUP_FAILED'});
  }
}
