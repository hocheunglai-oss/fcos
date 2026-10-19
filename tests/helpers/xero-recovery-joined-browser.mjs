// Test-only browser boundary borrowed from the dedicated login adapter tests.
// It does not replace loginLegacyHostedRuntime or its request/identity/JWT gates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { FIRST_RUNTIME } from '../../scripts/lib/hosted-release/first-runtime.mjs';
import { FCOS_CONNECTION_POLICY, fcosConnectionIdentifier } from '../../config/fcosConnections.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const H = 'a'.repeat(64);
const federation = FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation;
const origin = FIRST_RUNTIME.previousUrl;
const supabase = new URL(federation.oidcCallbackUrl).origin;
const issuer = federation.issuer;
const project = fcosConnectionIdentifier('supabase', 'Project ref');
const key = `sb-${project}-auth-token`;
const jwt = value => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify(value)).toString('base64url'), 'FIXTURE_SIGNATURE'].join('.');
const response = value => Response.json(value);
export function createJoinedBrowserBoundary({ now, id, email, subject, token, providerAccessToken }) {
  const calls=[],traffic=[],waiters=[],nativeCalls=[];let gate,wsGate,nativeGate,nativeEnabled=false,location=`${origin}/login`,clock=now;
  const storage=new Map([[key,JSON.stringify({access_token:token,provider_token:providerAccessToken,refresh_token:'PRIVATE_NEVER_EXTRACT_REFRESH'})]]);
  const profile={id,email,user_type:'administrator',active:true,access_revision:5};
  const authUser={id,email,is_anonymous:false,identities:[{provider:federation.oidcProvider,identity_data:{sub:subject}}],user_metadata:{user_type:'viewer',active:false}};
  const request=async(url,method='GET',type='fetch',ownPage=true,extra={})=>{assert.equal(typeof gate,'function');assert.equal(nativeEnabled,true);let result;
    await gate({request:()=>({url:()=>url,method:()=>method,resourceType:()=>type,headers:()=>extra.headers||{},postData:()=>extra.postData||null,frame:()=>({page:()=>ownPage?page:{}})}),continue:async()=>{result='continue';},abort:async reason=>{assert.equal(reason,'blockedbyclient');result='abort';},fulfill:()=>assert.fail('No fabricated response is permitted')});
    await nativeGate({requestId:'fixture-request',request:{url,method,headers:extra.headers||{},postData:extra.postData},resourceType:type[0].toUpperCase()+type.slice(1)});
    if(ownPage)assert.equal(nativeCalls.at(-1).method,result==='continue'?'Fetch.continueRequest':'Fetch.failRequest');
    traffic.push({url,method,type,result});return result;};
  const evaluate=(fn,arg)=>runInNewContext(`(${fn.toString()})(arg)`,{arg,URL,URLSearchParams,window:{location:new URL(location),localStorage:{getItem:k=>storage.get(k)||null}}});
  const page={
    url:()=>location,
    goto:async url=>{calls.push('goto');assert.equal(typeof gate,'function');assert.equal(typeof wsGate,'function');location=url;assert.equal(await request(url,'GET','document'),'continue');
      for(const [url,method,type] of [[`${origin}/api/functions/authContext`,'POST','fetch'],[`${origin}/api/functions/salesforceSchema`,'GET','fetch'],[`${origin}/api/fcuno/identity-sync`,'POST','fetch'],
        ['https://foreign.invalid/api','POST','fetch'],[`${supabase}/rest/v1/financial_rows`,'GET','fetch'],[`${supabase}/auth/v1/token?grant_type=refresh_token`,'POST','fetch'],[`${issuer}/api/unrelated-business`,'POST','fetch']])assert.equal(await request(url,method,type),'abort');
      assert.equal(await request(`${origin}/assets/index-fixture.js`,'GET','script'),'continue');
      let closed=false;await wsGate({close:async()=>{closed=true;},connectToServer:()=>assert.fail('WebSocket forwarding is forbidden')});assert.equal(closed,true);
    },
    getByRole:(_role,{name,exact})=>{const button={waitFor:async options=>{assert.equal(options.state,'visible');},elementHandle:async()=>({click:button.click,dispose:async()=>{}}),click:async()=>{assert.equal(exact,true);calls.push(name==='Login'?'login-click':'continue-click');
      if(name==='Continue with FCUNO'){location=`${issuer}/admin`;assert.equal(await request(location,'GET','document'),'continue');assert.equal(await request(`${issuer}/api/admin/session`),'continue');
        assert.equal(await request(`${issuer}/api/admin/dashboard-swatches`),'abort');assert.equal(await request('https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js','GET','script'),'abort');}
      else {assert.equal(name,'Login');assert.equal(await request(`${issuer}/api/admin/login`,'POST','fetch',true,{headers:{'Content-Type':'application/json'},postData:JSON.stringify({username:email,password:'PRIVATE_APPROVED_PASSWORD'})}),'continue');
        assert.equal(await request(`${issuer}/api/oidc/authorize?client_id=fcos-production`,'GET','document'),'continue');location=`${origin}/login?federated=1`;
        assert.equal(await request(`${supabase}/auth/v1/user`,'OPTIONS','preflight',true,{headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'apikey,authorization,x-client-info,x-supabase-api-version'}}),'continue');}
      for(const waiter of waiters.splice(0)){assert.equal(waiter.fn(new URL(location)),true);waiter.resolve();}}};return button;},
    getByLabel:(label,{exact})=>({fill:async value=>{assert.equal(exact,true);assert.ok(['Username','Password'].includes(label));assert.equal(new URL(location).origin,issuer);calls.push(label==='Username'?'email-filled':'password-filled');assert.equal(typeof value,'string');}}),
    waitForURL:fn=>fn(new URL(location))?Promise.resolve():new Promise(resolve=>waiters.push({fn,resolve})),
    waitForFunction:async(fn,arg)=>{assert.equal(evaluate(fn,arg),true);},
    evaluate:async(fn,arg)=>structuredClone(evaluate(fn,arg)),
  };
  const context={route:async(_pattern,handler)=>{calls.push('route');gate=handler;},routeWebSocket:async(_pattern,handler)=>{calls.push('websocket-route');wsGate=handler;},
    newPage:async()=>{calls.push('new-page');assert.deepEqual(calls.slice(-3),['route','websocket-route','new-page']);return page;},
    newCDPSession:async actualPage=>{assert.equal(actualPage,page);calls.push('native-session');return {on:(name,handler)=>{assert.equal(name,'Fetch.requestPaused');nativeGate=handler;},send:async(method,params)=>{
      if(method==='Fetch.enable'){calls.push('native-enable');assert.equal(typeof nativeGate,'function');assert.deepEqual(params,{patterns:[{urlPattern:'*',requestStage:'Request'}]});nativeEnabled=true;}
      else {assert.ok(['Fetch.failRequest','Fetch.continueRequest'].includes(method));if(method==='Fetch.failRequest')assert.equal(params.errorReason,'BlockedByClient');nativeCalls.push({method,params});}
    }};},
    close:async()=>{calls.push('context-close');},storageState:()=>assert.fail('Fresh sessions must not be copied or persisted')};
  const browser={newContext:async options=>{calls.push('context');assert.equal(options.serviceWorkers,'block');assert.equal(options.acceptDownloads,false);assert.deepEqual(options.storageState.origins,[]);return context;},close:async()=>{calls.push('browser-close');}};
  const publicAuth={kind:'fcos_legacy_runtime_own_profile_auth_v1',supabaseOrigin:supabase,issuerAuthorizationPath:'/api/oidc/authorize',
    publicAnonKey:jwt({role:'anon',ref:project,iss:'supabase',exp:Math.floor(now/1000)+86400}),publicAnonKeySha256:'',
    identity:{profileId:id,email,role:'administrator',accessRevision:5,fcunoSubjectSha256:hash(subject)},
    preflight:{kind:'fcos_legacy_runtime_own_profile_preflight_v1',accepted:true,reviewerId:'/root',capturedAt:new Date(now-1000).toISOString(),sourceSha:FIRST_RUNTIME.previousSha,sourceSha256:FIRST_RUNTIME.sourceSha256,
      origin,deploymentId:FIRST_RUNTIME.previousDeploymentId,profileRlsOwnSelect:true,authenticatedSelectOnly:true,effectiveAccessSourceVerified:true,effectiveAdmin:true,
      profileExisting:true,linkExisting:true,linkBoundToProfile:true,linkSourceActive:true,linkUseFcos:true,linkRevokedBefore:null,issuer,
      effectiveAccessSourceSha256:'f5e2678098eb9745e6915c9f23989cb7d46aa9de484132390dcbdab50cbbf4d9',evidenceSha256:H}};
  publicAuth.publicAnonKeySha256=hash(publicAuth.publicAnonKey);
  const options={origin,credentials:{email,password:'PRIVATE_APPROVED_PASSWORD',expectedRole:'administrator'},mode:'runtime',publicAuth,now:()=>clock,
    launchEnvironment:{PATH:'/fixture/bin'},protectionState:{cookies:[{name:'_vercel_jwt',value:'PRIVATE_HOST_COOKIE',domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires:now/1000+3600}],origins:[]},
    browserType:{launch:async options=>{calls.push('launch');assert.equal(options.headless,true);assert.ok(Object.keys(options.env).every(k=>['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ','DISPLAY','XAUTHORITY','PLAYWRIGHT_BROWSERS_PATH'].includes(k)));return browser;}},
    fetchImpl:async(url,options)=>{calls.push(url.includes('/auth/v1/user')?'get-user':'get-own-profile');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);
      assert.deepEqual(options.headers,{authorization:`Bearer ${token}`,apikey:publicAuth.publicAnonKey,accept:'application/json','accept-profile':'public'});assert.ok(options.signal instanceof AbortSignal);
      if(url===`${supabase}/auth/v1/user`)return response(authUser);
      const u=new URL(url);assert.equal(u.origin,supabase);assert.equal(u.pathname,'/rest/v1/user_profiles');assert.equal(u.searchParams.get('id'),`eq.${id}`);assert.equal(u.searchParams.get('select'),'id,email,user_type,active,access_revision');return response([profile]);}};
  return {options,publicAuth,calls,traffic,request,profile,authUser,context,page,storage,token,nativeCalls,nativePause:async event=>nativeGate(event),setClock:value=>{clock=value;},setLocation:value=>{location=value;},navigateTo:value=>{
    location=value;for(let i=waiters.length-1;i>=0;i--)if(waiters[i].fn(new URL(location))){waiters[i].resolve();waiters.splice(i,1);}
  }};
}
