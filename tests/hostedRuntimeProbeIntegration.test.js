import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Execute the actual collector -> handler -> authorization -> provider adapter
// with a credential-free child and injected transport/database only.
test('metered collector and protected runtime endpoint agree on identity, quota and session validity', () => {
  const urls = Object.fromEntries([['handler','../api/connection-runtime.js'],['probe','../api/_connectionRuntime.js'],
    ['collector','../scripts/collect-preview-parity.mjs'],['config','../config/fcosConnections.js']]
    .map(([key,path]) => [key,new URL(path,import.meta.url).href]));
  const script = `(${async function scenario(urls) {
    const { default: assert } = await import('node:assert/strict');
    const { fcosConnectionIdentifier, fcosSalesforceEnvironment } = await import(urls.config);
    const sf = fcosSalesforceEnvironment('production');
    process.env.SALESFORCE_INSTANCE_URL = sf.instanceUrl; process.env.SALESFORCE_ACCESS_TOKEN = 'private-synthetic-sf';
    const { createRuntimeProbeHandler, authorizeRuntimeProbe } = await import(urls.handler);
    const { probeRuntimeConnections } = await import(urls.probe);
    const { collectRuntimeObservation } = await import(urls.collector);
    const now = Date.parse('2026-10-24T07:00:00Z'), actor = '11111111-1111-4111-8111-111111111111';
    const requestId = '22222222-2222-4222-8222-222222222222', tenant = '33333333-3333-4333-8333-333333333333';
    const sha = 'a'.repeat(40), sourceDigest = 'b'.repeat(64), id = 'dpl_fixture', url = 'https://fcos-aaaaaaaaa-hocheunglai-6535s-projects.vercel.app';
    const rpcCalls = [], gets = [];
    const quota = {tenantId:tenant,allowanceKnown:true,dailyHold:false,reserve:200,minuteLimit:45,inFlightLimit:2,
      reservedCalls:0,inFlight:0,minuteCalls:0,revision:1,unresolvedWrites:0,availableCalls:500,spendableCalls:300,retryAt:null};
    const client = { auth:{getUser:async()=>({data:{user:{id:actor}}})}, from(table) {
      const q = {select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='user_profiles'
        ?{id:actor,email:'runtime@example.test',active:true,user_type:'administrator'}
        :{id:'primary',tenant_id:tenant,token_version:477,access_token:'private-synthetic-xero',expires_at:new Date(now+120000).toISOString()}})};
      return q;
    }, async rpc(name,p) {
      rpcCalls.push(name);
      if(name==='xero_shared_status'||name==='xero_shared_release')return {data:quota};
      if(name==='xero_shared_reserve')return {data:{id:p.p_id,tenant_id:tenant,owner_key:p.p_owner_key,state:'active',operation_remaining:1,verification_remaining:0,verification_reserved:0,expires_at:new Date(now+60000).toISOString()}};
      if(name==='xero_shared_admit_scoped_v1'){assert.equal(p.p_id,requestId);return {data:{requestId,tenantId:tenant,deadlineAt:new Date(now+120000).toISOString()}};}
      if(name==='xero_shared_observe')return {data:{recorded:true}};
      throw Error('Unexpected RPC');
    }};
    const env = {VERCEL_ENV:'preview',VERCEL_DEPLOYMENT_ID:id,VERCEL_GIT_COMMIT_SHA:sha,
      SUPABASE_URL:'https://'+fcosConnectionIdentifier('supabase','Project ref')+'.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic',
      SALESFORCE_INSTANCE_URL:sf.instanceUrl,XERO_TENANT_ID:tenant};
    const receipt={deploymentId:id,commit:sha,gitDirty:false,provenance:{schemaVersion:1,sourceDigestAlgorithm:'sha256:fcos-vercel-source-v1',
      releaseEligible:true,commit:sha,sourceDigest,gitDirty:false}};
    const providerFetch = async(input,init) => {
      const target=String(input);gets.push(target);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
      if(target.startsWith(env.SUPABASE_URL+'/rest/'))return Response.json([]);
      if(target.startsWith(sf.instanceUrl+'/services/'))return Response.json({records:[{Id:sf.orgId,IsSandbox:false}]});
      assert.equal(target,'https://api.xero.com/connections');return Response.json([{tenantId:tenant,tenantType:'ORGANISATION'}]);
    };
    globalThis.fetch=async()=>{throw Error('Unmocked network prohibited');};
    const handler=createRuntimeProbeHandler({env,now:()=>now,readReceipt:()=>receipt,
      authorize:(req,options)=>authorizeRuntimeProbe(req,{...options,createClientImpl:()=>client}),
      probe:options=>probeRuntimeConnections({...options,fetchImpl:providerFetch})});
    const result=await collectRuntimeObservation({url,deployment:{url,id,sha,createdAt:now-1000},sourceDigest,token:'private-existing-admin',requestId,now,
      fetchImpl:async(endpoint,init)=>{
        assert.equal(endpoint,url+'/api/connection-runtime');assert.deepEqual(JSON.parse(init.body),{action:'probe',requestId});
        const res={setHeader(){},end(body){this.body=body;}};
        await handler({method:init.method,headers:init.headers,body:init.body},res);
        assert.equal(res.statusCode,200,res.body);return new Response(res.body,{status:res.statusCode});
      }});
    assert.equal(result.auth.xero.state,'authenticated');assert.equal(result.auth.xero.target,tenant);
    assert.equal(result.runtimeValidUntil,new Date(now+30000).toISOString());
    assert.deepEqual(rpcCalls,['xero_shared_status','xero_shared_reserve','xero_shared_admit_scoped_v1','xero_shared_observe','xero_shared_release']);
    assert.equal(gets.length,3);assert.doesNotMatch(JSON.stringify(result),/private-|access_token|refresh_token/);
  }.toString()})(${JSON.stringify(urls)}).catch(e=>{console.error(e);process.exitCode=1;});`;
  const child = spawnSync(process.execPath,['--input-type=module','-e',script],{env:{},encoding:'utf8',timeout:10000});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'');
});
