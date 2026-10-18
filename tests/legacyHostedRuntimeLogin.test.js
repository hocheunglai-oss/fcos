import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {loginLegacyHostedRuntime,validateLegacyRuntimePublicAuth,legacyRuntimeLoginFailureCode,LEGACY_HOSTED_RUNTIME_LOGIN_FAILURE_CODES} from '../scripts/lib/hosted-release/legacy-hosted-runtime-login.mjs';
import {FIRST_RUNTIME} from '../scripts/lib/hosted-release/first-runtime.mjs';
import {FCOS_CONNECTION_POLICY,fcosConnectionIdentifier} from '../config/fcosConnections.js';
import {assertHostedBrowserIdentity} from '../scripts/lib/hosted-release/browser.mjs';

const now=Date.now(),id='00000000-0000-4000-8000-000000000123',email='runtime-fixture@example.invalid',subject='PRIVATE_OWN_SUBJECT';
const hash=v=>createHash('sha256').update(v).digest('hex'),H='a'.repeat(64);
const federation=FCOS_CONNECTION_POLICY.integrations.fcunoIdentityFederation,origin=FIRST_RUNTIME.previousUrl;
const supabase=new URL(federation.oidcCallbackUrl).origin,issuer=federation.issuer,issuerDb=`https://${federation.providerSupabaseProjectRef}.supabase.co`;
const project=fcosConnectionIdentifier('supabase','Project ref'),key=`sb-${project}-auth-token`;
const jwt=p=>[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify(p)).toString('base64url'),'FIXTURE_SIGNATURE'].join('.');
const response=(v,headers={})=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json',...headers}});

function fixture() {
  const calls=[],traffic=[],waiters=[],nativeCalls=[];let gate,wsGate,nativeGate,nativeEnabled=false,location=`${origin}/login`,clock=now;
  const token=jwt({iss:`${supabase}/auth/v1`,aud:'authenticated',role:'authenticated',sub:id,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600});
  const storage=new Map([[key,JSON.stringify({access_token:token,refresh_token:'PRIVATE_NEVER_EXTRACT_REFRESH'})]]);
  const profile={id,email,user_type:'administrator',active:true,access_revision:2};
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
    evaluate:async(fn,arg)=>evaluate(fn,arg),
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
    identity:{profileId:id,email,role:'administrator',accessRevision:2,fcunoSubjectSha256:hash(subject)},
    preflight:{kind:'fcos_legacy_runtime_own_profile_preflight_v1',accepted:true,reviewerId:'/root',capturedAt:new Date(now-1000).toISOString(),sourceSha:FIRST_RUNTIME.previousSha,sourceSha256:FIRST_RUNTIME.sourceSha256,
      origin,deploymentId:FIRST_RUNTIME.previousDeploymentId,profileRlsOwnSelect:true,authenticatedSelectOnly:true,effectiveAccessSourceVerified:true,effectiveAdmin:true,
      profileExisting:true,linkExisting:true,linkBoundToProfile:true,linkSourceActive:true,linkUseFcos:true,linkRevokedBefore:null,issuer,
      effectiveAccessSourceSha256:'f5e2678098eb9745e6915c9f23989cb7d46aa9de484132390dcbdab50cbbf4d9',evidenceSha256:H}};
  publicAuth.publicAnonKeySha256=hash(publicAuth.publicAnonKey);
  const options={origin,credentials:{email,password:'PRIVATE_APPROVED_PASSWORD',expectedRole:'administrator'},mode:'runtime',publicAuth,now:()=>clock,
    launchEnvironment:{PATH:'/fixture/bin'},protectionState:{cookies:[{name:'_vercel_jwt',value:'PRIVATE_HOST_COOKIE',domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires:now/1000+3600}],origins:[]},
    browserType:{launch:async options=>{calls.push('launch');assert.deepEqual(options,{headless:true,env:{PATH:'/fixture/bin'}});return browser;}},
    fetchImpl:async(url,options)=>{calls.push(url.includes('/auth/v1/user')?'get-user':'get-own-profile');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);
      assert.deepEqual(options.headers,{authorization:`Bearer ${token}`,apikey:publicAuth.publicAnonKey,accept:'application/json','accept-profile':'public'});assert.ok(options.signal instanceof AbortSignal);
      if(url===`${supabase}/auth/v1/user`)return response(authUser);
      const u=new URL(url);assert.equal(u.origin,supabase);assert.equal(u.pathname,'/rest/v1/user_profiles');assert.equal(u.searchParams.get('id'),`eq.${id}`);assert.equal(u.searchParams.get('select'),'id,email,user_type,active,access_revision');return response([profile]);}};
  return {options,publicAuth,calls,traffic,request,profile,authUser,context,page,storage,token,nativeCalls,nativePause:async event=>nativeGate(event),setClock:value=>{clock=value;},setLocation:value=>{location=value;},navigateTo:value=>{
    location=value;for(let i=waiters.length-1;i>=0;i--)if(waiters[i].fn(new URL(location))){waiters[i].resolve();waiters.splice(i,1);}
  }};
}

test('actual runtime entrypoint gates before navigation, blocks FCOS APIs/business traffic/WebSockets, and returns actual own identity only',async()=>{
  const f=fixture(),result=await loginLegacyHostedRuntime(f.options);
  assert.deepEqual(f.calls,['launch','context','route','websocket-route','new-page','native-session','native-enable','goto','continue-click','email-filled','password-filled','login-click','get-user','get-own-profile','context-close','browser-close']);
  assert.equal(result.token,f.token);assert.equal(result.auth.kind,'fcos_runtime_own_profile_auth_observation_v1');assert.equal(result.auth.user.id,id);assert.equal(result.auth.user.user_type,'administrator');
  assert.equal(result.auth.moduleAccess,undefined);assert.equal(result.state,undefined);assert.equal(result.auth.provenance.authContextCalled,false);assert.equal(result.auth.provenance.moduleAccessObserved,false);
  assert.equal(result.auth.provenance.issuerSource.sha,federation.providerCommit);assert.equal(result.auth.provenance.issuerSource.files.length,6);
  assert.equal(result.auth.provenance.issuerOwnSessionAndCodeCreationMayOccur,true);assert.equal(result.auth.provenance.issuerOwnCookieRenewalOrInvalidSessionRevocationMayOccur,true);
  assert.equal(assertHostedBrowserIdentity(result.auth,{mode:'runtime',credentials:f.options.credentials}).role,'administrator');
  assert.doesNotMatch(JSON.stringify(result.auth),/PRIVATE_|access_token|refresh_token|password|\"subject\"/);
  assert.ok(f.traffic.filter(r=>new URL(r.url).origin===origin&&new URL(r.url).pathname.startsWith('/api/')).every(r=>r.result==='abort'));
});

test('wrong target, role, public key or native RLS/source/link evidence fails before launch or private work',async()=>{
  const mutations=[f=>f.options.origin='https://fcos.fcuno.com',f=>f.options.mode='normal_role',f=>f.options.credentials.expectedRole='viewer',f=>f.publicAuth.supabaseOrigin='https://foreign.invalid',
    f=>{f.publicAuth.publicAnonKey=jwt({role:'service_role',ref:project,iss:'supabase',exp:Math.floor(now/1000)+86400});f.publicAuth.publicAnonKeySha256=hash(f.publicAuth.publicAnonKey);},f=>f.publicAuth.identity.profileId='wrong',f=>f.publicAuth.identity.email='wrong@example.invalid',
    f=>f.publicAuth.identity.role='general_manager',f=>f.publicAuth.identity.accessRevision=0,f=>f.publicAuth.preflight.profileRlsOwnSelect=false,f=>f.publicAuth.preflight.authenticatedSelectOnly=false,
    f=>f.publicAuth.preflight.linkBoundToProfile=false,f=>f.publicAuth.preflight.linkSourceActive=false,f=>f.publicAuth.preflight.effectiveAccessSourceSha256=H,f=>f.publicAuth.preflight.effectiveAdmin=false,
    f=>f.publicAuth.preflight.capturedAt=new Date(now-1800001).toISOString(),f=>f.publicAuth.preflight.origin='https://foreign.invalid',f=>f.publicAuth.preflight.accepted=false,
    f=>f.publicAuth.issuerAuthorizationPath='https://foreign.invalid',f=>f.publicAuth.publicAnonKeySha256=H,f=>f.options.launchEnvironment.SUPABASE_SERVICE_ROLE_KEY='PRIVATE_FORBIDDEN',f=>f.options.protectionState.origins=[{origin,localStorage:[{name:key,value:'PRIVATE_OLD_TOKEN'}]}]];
  for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(loginLegacyHostedRuntime(f.options),e=>e.code==='LEGACY_HOSTED_RUNTIME_LOGIN_BINDING_INVALID'&&!e.message.includes('PRIVATE'));assert.deepEqual(f.calls,[]);}
});

test('public-only validator accepts admitted modern publishable keys without any password or browser; root digest remains exact',async()=>{
  const f=fixture();f.publicAuth.publicAnonKey=`sb_publishable_${'A'.repeat(31)}`;f.publicAuth.publicAnonKeySha256=hash(f.publicAuth.publicAnonKey);
  const inputs={publicAuth:f.publicAuth,email,expectedRole:'administrator',origin,now};
  assert.equal(validateLegacyRuntimePublicAuth(inputs),f.publicAuth);assert.deepEqual(f.calls,[]);
  const result=await loginLegacyHostedRuntime(f.options);assert.equal(result.auth.user.id,id);
  for(const key of ['sb_secret_fixture','sb_publishable_','sb_publishable_PRIVATE&INJECTION','sb_publishable_'+ 'a'.repeat(113)]){
    const invalid=fixture();invalid.publicAuth.publicAnonKey=key;invalid.publicAuth.publicAnonKeySha256=hash(key);
    assert.throws(()=>validateLegacyRuntimePublicAuth({...inputs,publicAuth:invalid.publicAuth}));assert.deepEqual(invalid.calls,[]);
  }
});

test('fresh own-user and profile mismatches or fabricated metadata privileges never admit identity',async()=>{
  const mutations=[f=>f.authUser.id='00000000-0000-4000-8000-000000000456',f=>f.authUser.email='other@example.invalid',f=>f.authUser.identities=[],f=>f.authUser.identities[0].identity_data.sub='PRIVATE_DIFFERENT_SUBJECT',
    f=>f.authUser.is_anonymous=true,f=>f.profile.id='00000000-0000-4000-8000-000000000456',f=>f.profile.active=false,f=>{f.profile.user_type='viewer';f.authUser.user_metadata={user_type:'administrator',active:true};},
    f=>f.profile.access_revision=3,f=>f.profile.email='other@example.invalid'];
  for(const [index,mutate] of mutations.entries()){const f=fixture();mutate(f);await assert.rejects(loginLegacyHostedRuntime(f.options),e=>e.code===(index<5?'LEGACY_HOSTED_RUNTIME_LOGIN_AUTH_USER_FAILED':'LEGACY_HOSTED_RUNTIME_LOGIN_OWN_PROFILE_FAILED'));assert.deepEqual(f.calls.slice(-2),['context-close','browser-close']);
    assert.ok(f.calls.filter(c=>c==='get-user').length===1);assert.ok(f.calls.filter(c=>c==='get-own-profile').length<=1);}
});

test('invalid auth response headers, duplicates, redirects, oversized data and provider exceptions fail once with sanitized errors',async()=>{
  const bodies=[()=>response({error:'PRIVATE_RAW_ERROR'},{'content-type':'text/plain'}),()=>new Response(JSON.stringify({error:'PRIVATE_PROVIDER_FAILURE'}),{status:500,headers:{'content-type':'application/json'}}),
    ()=>({status:200,ok:true,redirected:true,headers:new Headers({'content-type':'application/json'}),body:new Response('private').body}),()=>response({data:'x'.repeat(65537)}),()=>{throw Error('PRIVATE_RAW_PROVIDER_ERROR');}];
  for(const body of bodies){const f=fixture();let count=0;f.options.fetchImpl=async()=>{count++;return body();};
    await assert.rejects(loginLegacyHostedRuntime(f.options),e=>e.code==='LEGACY_HOSTED_RUNTIME_LOGIN_AUTH_USER_FAILED'&&!e.message.includes('PRIVATE'));assert.equal(count,1);assert.deepEqual(f.calls.slice(-2),['context-close','browser-close']);}
  const f=fixture(),read=f.options.fetchImpl;f.options.fetchImpl=async(url,o)=>url.includes('/rest/v1/')?response([f.profile,f.profile]):read(url,o);
  await assert.rejects(loginLegacyHostedRuntime(f.options),e=>e.code==='LEGACY_HOSTED_RUNTIME_LOGIN_OWN_PROFILE_FAILED');
});

test('stale or revoked token and callback/source drift stop before own reads; no reused session is accepted',async()=>{
  const mutations=[f=>f.storage.set(key,JSON.stringify({access_token:jwt({iss:`${supabase}/auth/v1`,aud:'authenticated',role:'authenticated',sub:id,iat:Math.floor(now/1000)-100,exp:Math.floor(now/1000)+3600})})),
    f=>f.publicAuth.preflight.linkRevokedBefore=new Date(now+1000).toISOString(),f=>f.page.evaluate=async()=>{f.setClock(now+1800001);return f.token;},
    f=>f.page.evaluate=async()=>{f.setLocation('https://foreign.invalid/login?federated=1');return null;}];
  for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(loginLegacyHostedRuntime(f.options));assert.ok(!f.calls.includes('get-user'));assert.deepEqual(f.calls.slice(-2),['context-close','browser-close']);}
  for(const claim of [{iss:'https://foreign.invalid/auth/v1'},{sub:'00000000-0000-4000-8000-000000000456'},{role:'service_role'},{aud:'foreign'},{exp:Math.floor(now/1000)-1}]){
    const f=fixture(),p={iss:`${supabase}/auth/v1`,aud:'authenticated',role:'authenticated',sub:id,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600,...claim};
    f.storage.set(key,JSON.stringify({access_token:jwt(p)}));await assert.rejects(loginLegacyHostedRuntime(f.options),e=>e.code==='LEGACY_HOSTED_RUNTIME_LOGIN_SESSION_BINDING_INVALID');assert.ok(!f.calls.includes('get-user'));
  }
});

test('request allowlist rejects encoded API paths, foreign authority, issuer business API, refresh and worker requests',async()=>{
  const f=fixture();await loginLegacyHostedRuntime(f.options);
  for(const [url,method,type] of [[`${origin}/api/functions/authContext`,'POST','fetch'],[`${origin}/api`,'GET','document'],[`${origin}/assets/index.js`,'POST','script'],[`${origin}/assets/index.js`,'GET','worker'],
    [`${origin}/%61pi/functions/authContext`,'GET','script'],[`${origin}/assets/%2f..%2fapi/functions/authContext`,'GET','script'],
    [`${issuer}/api/business`,'GET','fetch'],[`${issuerDb}/rest/v1/user_profiles`,'GET','fetch'],[`${issuerDb}/auth/v1/token?grant_type=refresh_token`,'POST','fetch'],[`${supabase}/auth/v1/token?grant_type=refresh_token`,'POST','fetch'],
    [`${issuerDb}/auth/v1/token?grant_type=password`,'POST','fetch'],[`${issuer}/api/admin/session`,'POST','fetch'],[`${issuer}/api/admin/session?other=user`,'GET','fetch'],[`${issuer}/api/admin/login`,'GET','fetch'],
    [`${issuer}/api/admin/password-reset`,'POST','fetch'],[`${issuer}/api/admin/logout`,'POST','fetch'],[`${issuer}/api/admin/dashboard-swatches`,'GET','fetch'],
    ['https://fcuno.com.evil.invalid/admin','GET','document'],[`https://private:credential@${new URL(origin).host}/login`,'GET','document'],['http://fcuno.com/admin','GET','document']])assert.equal(await f.request(url,method,type),'abort');
  assert.equal(await f.request(`${issuer}/admin`,'GET','document',false),'abort');
  // A redirect skips Playwright routing in the installed runtime. Native Fetch
  // must reject its new target before transport independently of that handler.
  for(const url of [`${origin}/api/functions/authContext`,'https://foreign.invalid/business',`${supabase}/rest/v1/financial_rows`]){
    await f.nativePause({requestId:'redirected-fixture',redirectedRequestId:'prior-authorized-request',resourceType:'Document',request:{url,method:'GET'}});
    assert.deepEqual(f.nativeCalls.at(-1),{method:'Fetch.failRequest',params:{requestId:'redirected-fixture',errorReason:'BlockedByClient'}});
  }
});

test('missing WebSocket interception or browser cleanup failure never returns an identity',async()=>{
  const f=fixture();delete f.context.routeWebSocket;await assert.rejects(loginLegacyHostedRuntime(f.options),e=>e.code==='LEGACY_HOSTED_RUNTIME_LOGIN_REQUEST_GATE_FAILED');assert.ok(!f.calls.includes('goto'));assert.deepEqual(f.calls.slice(-2),['context-close','browser-close']);
  const g=fixture();g.context.close=async()=>{g.calls.push('context-close');throw Error('PRIVATE_CLEANUP_ERROR');};
  await assert.rejects(loginLegacyHostedRuntime(g.options),e=>e.code==='LEGACY_HOSTED_RUNTIME_LOGIN_CLEANUP_FAILED'&&!e.message.includes('PRIVATE'));assert.deepEqual(g.calls.slice(-2),['context-close','browser-close']);
});

test('native request-gate failure closes the context and cannot fall back to ungated identity reads',async()=>{
  const f=fixture(),create=f.context.newCDPSession;
  f.context.newCDPSession=async page=>{const native=await create(page),send=native.send;native.send=async(method,params)=>{
    if(method==='Fetch.continueRequest')throw Error('PRIVATE_NATIVE_GATE_FAILURE');return send(method,params);
  };return native;};
  await assert.rejects(loginLegacyHostedRuntime(f.options),e=>!e.message.includes('PRIVATE'));
  assert.ok(f.calls.includes('context-close'));assert.ok(!f.calls.includes('get-user'));assert.ok(!f.calls.includes('get-own-profile'));assert.equal(f.calls.at(-1),'browser-close');
});

test('only source-proven issuer login POST with the exact approved own credentials is admitted',async()=>{
  const f=fixture();await loginLegacyHostedRuntime(f.options);
  const valid={headers:{'content-type':'application/json; charset=utf-8'},postData:JSON.stringify({username:email,password:'PRIVATE_APPROVED_PASSWORD'})};
  assert.equal(await f.request(`${issuer}/api/admin/login`,'POST','fetch',true,valid),'continue');
  for(const extra of [{...valid,headers:{'content-type':'text/plain'}},{...valid,postData:JSON.stringify({username:'different@example.invalid',password:'PRIVATE_APPROVED_PASSWORD'})},
    {...valid,postData:JSON.stringify({username:email,password:'PRIVATE_OTHER_PASSWORD'})},{...valid,postData:JSON.stringify({username:email,password:'PRIVATE_APPROVED_PASSWORD',admin:true})},{...valid,postData:'invalid JSON'}]){
    assert.equal(await f.request(`${issuer}/api/admin/login`,'POST','fetch',true,extra),'abort');
  }
  assert.equal(await f.request(`${issuer}/api/admin/login?other=action`,'POST','fetch',true,valid),'abort');
  assert.equal(await f.request(`${issuer}/api/admin/login`,'POST','document',true,valid),'abort');
  assert.equal(await f.request(`${issuer}/api/oidc/authorize`,'POST','document',true,valid),'abort');
});

test('callback CORS preflight admits only canonical own-user GET from exact admitted FCOS origin and installed auth headers',async()=>{
  const f=fixture();await loginLegacyHostedRuntime(f.options);
  const headers={origin,'access-control-request-method':'GET','access-control-request-headers':'apikey, authorization, x-client-info, x-supabase-api-version'};
  assert.equal(await f.request(`${supabase}/auth/v1/user`,'OPTIONS','other',true,{headers}),'continue');
  for(const changed of [{...headers,origin:'https://foreign.invalid'},{...headers,'access-control-request-method':'POST'},{...headers,'access-control-request-headers':'apikey, private-secret-header'},
    {...headers,'access-control-request-headers':''}])assert.equal(await f.request(`${supabase}/auth/v1/user`,'OPTIONS','preflight',true,{headers:changed}),'abort');
  for(const path of ['/auth/v1/token','/rest/v1/user_profiles','/auth/v1/user?other=user'])assert.equal(await f.request(`${supabase}${path}`,'OPTIONS','preflight',true,{headers}),'abort');
});

test('automatic issuer arrival before or after initial URL check never waits for or clicks a missing Continue button',async()=>{
  for(const automatic of ['already_arrived','delayed_arrival']){
    const f=fixture(),goto=f.page.goto,role=f.page.getByRole;
    f.page.goto=async(...args)=>{await goto(...args);if(automatic==='already_arrived')f.navigateTo(`${issuer}/admin?returnTo=fixture`);};
    f.page.getByRole=(kind,options)=>{
      if(options.name!=='Continue with FCUNO')return role(kind,options);
      return {waitFor:()=>new Promise(()=>{if(automatic==='delayed_arrival')setTimeout(()=>f.navigateTo(`${issuer}/admin?returnTo=fixture`),5);}),
        elementHandle:()=>assert.fail('Automatic login never acquires the missing Continue button'),click:()=>assert.fail('Automatic login never clicks the missing Continue button')};
    };
    const result=await loginLegacyHostedRuntime(f.options);assert.equal(result.auth.user.id,id);assert.ok(!f.calls.includes('continue-click'));
    assert.deepEqual(f.calls.slice(-4),['get-user','get-own-profile','context-close','browser-close']);
  }
});

test('automatic redirect while the original Continue element becomes detached still reaches issuer without retrying a next-page locator',async()=>{
  const f=fixture(),role=f.page.getByRole;let elementClicks=0,disposed=0;
  f.page.getByRole=(kind,options)=>options.name==='Continue with FCUNO'?{waitFor:async()=>{},elementHandle:async()=>({click:async()=>{elementClicks++;f.navigateTo(`${issuer}/admin`);throw Error('PRIVATE_ORIGINAL_DOCUMENT_DETACHED');},dispose:async()=>{disposed++;}}),
    click:()=>assert.fail('A live locator must not retry on the issuer page')}:role(kind,options);
  const result=await loginLegacyHostedRuntime(f.options);assert.equal(result.auth.user.id,id);assert.equal(elementClicks,1);assert.equal(disposed,1);assert.ok(!f.calls.includes('continue-click'));
});

test('each login boundary reports only its exact sanitized fixed phase and stops subsequent private work',async()=>{
  const cases=[
    ['BROWSER_START_FAILED',f=>{f.options.browserType.launch=async()=>{throw Error('PRIVATE_BROWSER_PATH');};}],
    ['REQUEST_GATE_FAILED',f=>{delete f.context.routeWebSocket;}],
    ['FCOS_NAVIGATION_FAILED',f=>{f.page.goto=async()=>{throw Error('PRIVATE_URL_ERROR');};}],
    ['ISSUER_ARRIVAL_FAILED',f=>{f.page.waitForURL=async()=>{throw Error('PRIVATE_ISSUER_LOCATION');};const role=f.page.getByRole;f.page.getByRole=(kind,o)=>o.name==='Continue with FCUNO'?{waitFor:async()=>{throw Error('PRIVATE_BUTTON_TIMEOUT');}}:role(kind,o);}],
    ['ISSUER_FORM_FAILED',f=>{f.page.getByLabel=()=>({fill:async()=>{throw Error('PRIVATE_FORM_VALUE');}});}],
    ['ISSUER_SUBMIT_FAILED',f=>{const role=f.page.getByRole;f.page.getByRole=(kind,o)=>o.name==='Login'?{click:async()=>{throw Error('PRIVATE_SUBMIT_RESPONSE');}}:role(kind,o);}],
    ['CALLBACK_FAILED',f=>{const wait=f.page.waitForURL;f.page.waitForURL=(predicate,options)=>predicate(new URL(`${origin}/login?federated=1`))?Promise.reject(Error('PRIVATE_CALLBACK_TOKEN')):wait(predicate,options);}],
    ['SESSION_STORAGE_FAILED',f=>{f.page.waitForFunction=async()=>{throw Error('PRIVATE_STORAGE_TOKEN');};}],
    ['SESSION_BINDING_INVALID',f=>{f.storage.set(key,JSON.stringify({access_token:'PRIVATE_INVALID_SESSION'}));}],
    ['AUTH_USER_FAILED',f=>{f.options.fetchImpl=async()=>{throw Error('PRIVATE_AUTH_USER');};}],
    ['OWN_PROFILE_FAILED',f=>{const read=f.options.fetchImpl;f.options.fetchImpl=(url,o)=>url.includes('/rest/v1/')?Promise.reject(Error('PRIVATE_ROW_ID')):read(url,o);}],
  ];
  for(const [phase,mutate] of cases){const f=fixture();mutate(f);await assert.rejects(loginLegacyHostedRuntime(f.options),error=>{
    assert.equal(error.code,`LEGACY_HOSTED_RUNTIME_LOGIN_${phase}`);assert.equal(error.message,error.code);assert.equal(legacyRuntimeLoginFailureCode(error),error.code);assert.doesNotMatch(JSON.stringify(error),/PRIVATE_|password|access_token/);return true;
  });if(!['AUTH_USER_FAILED','OWN_PROFILE_FAILED'].includes(phase)){assert.ok(!f.calls.includes('get-user'));assert.ok(!f.calls.includes('get-own-profile'));}}
});

test('failure-code sanitizer never propagates arbitrary messages, provider codes or throwing accessors',()=>{
  assert.equal(Object.isFrozen(LEGACY_HOSTED_RUNTIME_LOGIN_FAILURE_CODES),true);
  for(const code of LEGACY_HOSTED_RUNTIME_LOGIN_FAILURE_CODES)assert.equal(legacyRuntimeLoginFailureCode({code,message:'PRIVATE_PROVIDER_MESSAGE'}),code);
  for(const error of [null,{},Error('PRIVATE_TOKEN'),{code:'PRIVATE_CODE'},{code:'LEGACY_HOSTED_RUNTIME_LOGIN_ISSUER_ARRIVAL_FAILED PRIVATE_TOKEN'},
    {get code(){throw Error('PRIVATE_ACCESSOR');}},{message:'LEGACY_HOSTED_RUNTIME_LOGIN_ISSUER_ARRIVAL_FAILED'}])assert.equal(legacyRuntimeLoginFailureCode(error),null);
});


test('losing manual-button wait cannot act on callback or after automatic login completes',async()=>{
  for(const timing of ['callback','after_complete']){
    const f=fixture(),goto=f.page.goto,role=f.page.getByRole;let release,handles=0,clicks=0;
    const visible=new Promise(resolve=>{release=resolve;});
    f.page.goto=async(...args)=>{await goto(...args);queueMicrotask(()=>f.navigateTo(`${issuer}/admin?returnTo=fixture`));};
    f.page.getByRole=(kind,options)=>{
      if(options.name==='Continue with FCUNO')return {waitFor:()=>visible,elementHandle:async()=>{handles++;return {click:async()=>{clicks++;},dispose:async()=>{}};}};
      const original=role(kind,options);
      if(options.name!=='Login')return original;
      return {...original,click:async()=>{await original.click();if(timing==='callback')release();}};
    };
    const result=await loginLegacyHostedRuntime(f.options);assert.equal(result.auth.user.id,id);
    if(timing==='after_complete')release();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(handles,0);assert.equal(clicks,0);assert.equal(f.calls.filter(c=>c==='login-click').length,1);
    assert.equal(f.calls.filter(c=>c==='get-own-profile').length,1);
  }
});
