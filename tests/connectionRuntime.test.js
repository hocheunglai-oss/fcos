import test from 'node:test';
import assert from 'node:assert/strict';
import { fcosConnectionIdentifier, fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { probeRuntimeConnections, runtimeDeploymentBinding, supabaseDiagnosticCredentialMode } from '../api/_connectionRuntime.js';
import { authorizeRuntimeProbe, createRuntimeProbeHandler } from '../api/connection-runtime.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';

const sha = 'a'.repeat(40), digest = 'b'.repeat(64), tenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const env = { VERCEL_ENV:'preview', VERCEL_DEPLOYMENT_ID:'dpl_fixture', VERCEL_GIT_COMMIT_SHA:sha,
  SUPABASE_URL:`https://${fcosConnectionIdentifier('supabase','Project ref')}.supabase.co`, SUPABASE_SECRET_KEY:'sb_secret_private-service-key',
  SALESFORCE_INSTANCE_URL:fcosSalesforceEnvironment('production').instanceUrl, SALESFORCE_ACCESS_TOKEN:'private-sf-token',
  XERO_TENANT_ID:tenant, VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED:'true' };
const receipt = { deploymentId:env.VERCEL_DEPLOYMENT_ID, commit:sha, gitDirty:false, provenance:{ schemaVersion:1, sourceDigestAlgorithm:'sha256:fcos-vercel-source-v1', releaseEligible:true, commit:sha, sourceDigest:digest, gitDirty:false } };
const time = Date.parse('2026-10-01T00:00:00.000Z');
function clientFixture(profile = { id:'admin', email:'admin@example.test', active:true, user_type:'administrator' }, connection = {}) {
  const calls = [];
  return { calls, client: {
    auth:{ getUser:async () => ({ data:{ user:{ id:profile.id } } }) },
    from: (table) => {
      calls.push(table);
      const q = { select:() => q, eq:() => q, maybeSingle:async () => ({ data:table === 'user_profiles' ? profile : {
        tenant_id:tenant, access_token:'private-xero-token', expires_at:new Date(time+3600000).toISOString(), ...connection,
      } }) };
      return q;
    },
  } };
}
function response() {
  return { headers:{}, setHeader(k,v) { this.headers[k]=v; }, end(body) { this.body=JSON.parse(body); } };
}
test('runtime probe validates independent source and deployment binding', () => {
  assert.deepEqual(runtimeDeploymentBinding(env,receipt), { deploymentId:'dpl_fixture', sha, sourceDigest:digest });
  for (const r of [{ ...receipt, commit:'c'.repeat(40) }, { ...receipt, gitDirty:true }, { ...receipt, deploymentId:'dpl_old' }, { ...receipt, provenance:{ ...receipt.provenance, gitDirty:true } }]) {
    assert.throws(() => runtimeDeploymentBinding(env,r), /binding/);
  }
});
test('runtime probes issue only bounded GETs; outputs contain no tokens or rows', async () => {
  const f=clientFixture(), calls=[];
  const result=await probeRuntimeConnections({ env, receipt, client:f.client, now:time, fetchImpl:async (url,init) => {
    calls.push({url,init}); assert.equal(init.method,'GET'); assert.equal(init.redirect,'error');
    const data=url.includes('/rest/') ? [{id:'private-user'}] : url.includes('salesforce.com')
      ? {records:[{Id:fcosSalesforceEnvironment('production').orgId,IsSandbox:false}]}
      : [{tenantId:tenant,tenantType:'ORGANISATION'}];
    return {ok:true,json:async () => data};
  } });
  assert.equal(calls.length,3);
  assert.equal(result.auth.supabase.state,'authenticated'); assert.equal(result.auth.salesforce.state,'authenticated');
  assert.equal(result.auth.xero.state,'authenticated');
  assert.equal(result.safety.readOnly,true); assert.ok(Object.values(result.safety.externalActions).every(v=>v===false));
  assert.equal(result.flags.VARIABLE_CHARGE_PAIRED_WORKFLOW_ENABLED.value,true);
  assert.doesNotMatch(JSON.stringify(result),/private-|"access_token"\s*:|"refresh_token"\s*:/);
  assert.deepEqual(f.calls,['xero_contact_sync_connections']);
});
test('expired Xero token and missing tenant never refresh or query Xero', async () => {
  for (const connection of [{expires_at:new Date(time-1000).toISOString()},{tenant_id:'wrong'},{expires_at:'invalid'}]) {
    const f=clientFixture(undefined,connection), calls=[];
    const result=await probeRuntimeConnections({ env,receipt,client:f.client,now:time, fetchImpl:async (url) => { calls.push(url); return {ok:false}; } });
    assert.equal(result.auth.xero.state,'unknown'); assert.ok(calls.every(url=>!url.includes('xero')));
  }
});
test('wrong provider endpoints fail before credential-bearing reads', async () => {
  const calls=[];
  const result=await probeRuntimeConnections({ env:{ ...env, SUPABASE_URL:'https://evil.test', SALESFORCE_INSTANCE_URL:'https://evil.test',XERO_TENANT_ID:'' },receipt,now:time,
    fetchImpl:async (url) => { calls.push(url); throw new Error('unexpected'); } });
  assert.deepEqual(calls,[]); assert.equal(result.auth.supabase.state,'unknown'); assert.equal(result.auth.salesforce.state,'unknown');
});
test('provider error bodies and redirect failures are sanitized', async () => {
  const result=await probeRuntimeConnections({env,receipt,client:clientFixture().client,now:time,fetchImpl:async () => {throw new Error('private-token-provider-body');}});
  assert.equal(result.auth.xero.code,'READ_PROBE_FAILED'); assert.doesNotMatch(JSON.stringify(result),/private-token/);
});
test('Supabase server env labels cannot promote anon or publishable keys to service authority', async () => {
  const token=(role,ref=fcosConnectionIdentifier('supabase','Project ref'))=>'e30.'+Buffer.from(JSON.stringify({role,ref,exp:time/1000+3600})).toString('base64url')+'.signature';
  assert.equal(supabaseDiagnosticCredentialMode(token('service_role'),time),'service_role');
  for(const key of [token('anon'),token('service_role','wrong-project'),'sb_publishable_private','arbitrary']) {
    const calls=[];
    const result=await probeRuntimeConnections({ env:{...env,SUPABASE_SECRET_KEY:key,SALESFORCE_ACCESS_TOKEN:'',XERO_TENANT_ID:''},receipt,now:time,
      fetchImpl:async url=>{calls.push(url);return {ok:true,json:async()=>[]};} });
    assert.equal(result.auth.supabase.state,'unknown'); assert.deepEqual(calls,[]);
  }
});
test('anonymous, inactive and restricted CI profiles cannot probe', async () => {
  await assert.rejects(()=>authorizeRuntimeProbe({headers:{}},{env}),/RUNTIME_SIGN_IN_REQUIRED/);
  for (const profile of [{id:'i',active:false,user_type:'administrator'}, {id:'f',active:true,user_type:'finance'},
    {id:'ci',active:true,user_type:'administrator',email:FCOS_READ_ONLY_CI.email}]) {
    const f=clientFixture(profile);
    await assert.rejects(()=>authorizeRuntimeProbe({headers:{authorization:'Bearer existing-session'}},{env,createClientImpl:()=>f.client}),/RUNTIME_ADMIN_REQUIRED/);
  }
});
test('existing admin authentication disables session persistence and automatic refresh', async () => {
  const f=clientFixture(); let options;
  const context=await authorizeRuntimeProbe({headers:{authorization:'Bearer existing-session'}},{env,createClientImpl:(_url,_key,opts)=>{options=opts;return f.client;}});
  assert.equal(context.userId,'admin'); assert.deepEqual(options.auth,{persistSession:false,autoRefreshToken:false});
  assert.deepEqual(f.calls,['user_profiles']);
});
test('invalid methods and payloads never authorize or touch provider', async () => {
  let called=false;
  const handler=createRuntimeProbeHandler({authorize:async ()=>{called=true;throw new Error('private');}});
  for (const req of [{method:'GET',headers:{}}, {method:'POST',headers:{},body:{action:'sync'}}, {method:'POST',headers:{},body:{action:'probe',target:'evil'}}, {method:'POST',headers:{},body:' '*129+JSON.stringify({action:'probe'})}]) {
    const res=response(); await handler(req,res); assert.ok(res.statusCode>=400); assert.equal(called,false);
  }
});
test('probe throttles repeated requests without persistence or logging', async () => {
  let probes=0;
  const handler=createRuntimeProbeHandler({env,now:()=>time,authorize:async ()=>({client:{},userId:'admin'}),readReceipt:()=>receipt,probe:async ()=>{probes++;return {schemaVersion:1};}});
  const req={method:'POST',headers:{},body:{action:'probe'}}, first=response(), next=response();
  await handler(req,first); await handler(req,next);
  assert.equal(first.statusCode,200); assert.equal(next.statusCode,429); assert.equal(probes,1);
});

test('runtime accepts only explicitly attested source archives and rejects malformed provenance', () => {
  assert.throws(()=>runtimeDeploymentBinding({...env,FCOS_BUILD_COMMIT_SHA:'f'.repeat(40)},receipt), /binding/);
  const archive = {...receipt, gitDirty:null, provenance:{...receipt.provenance, gitDirty:null, sourceAttested:true}};
  assert.deepEqual(runtimeDeploymentBinding({...env, VERCEL_GIT_COMMIT_SHA:'', FCOS_BUILD_COMMIT_SHA:sha},archive), {deploymentId:'dpl_fixture',sha,sourceDigest:digest});
  for (const change of [{sourceAttested:false}, {releaseEligible:false}, {schemaVersion:2}, {sourceDigestAlgorithm:'unknown'}, {gitDirty:true}]) {
    assert.throws(()=>runtimeDeploymentBinding(env,{...archive,provenance:{...archive.provenance,...change}}), /binding/);
  }
});


test('runtime accepts the producer-attested sanitized Git checkout while keeping all exact binding checks', () => {
  const sanitized = { ...receipt, gitDirty: true, provenance: { ...receipt.provenance,
    gitDirty: true, sanitizedCheckout: true, sourceAttested: true, commitVerified: true } };
  assert.deepEqual(runtimeDeploymentBinding(env, sanitized), { deploymentId: 'dpl_fixture', sha, sourceDigest: digest });
  const rejected = [];
  for (const key of ['sanitizedCheckout', 'sourceAttested', 'commitVerified', 'releaseEligible']) {
    for (const value of [undefined, false, 'true', 1]) rejected.push({ ...sanitized,
      provenance: { ...sanitized.provenance, [key]: value } });
  }
  rejected.push(
    { ...receipt, gitDirty: true, provenance: { ...receipt.provenance, gitDirty: true } },
    { ...sanitized, gitDirty: false },
    { ...sanitized, deploymentId: 'dpl_other' },
    { ...sanitized, commit: 'c'.repeat(40) },
    { ...sanitized, provenance: { ...sanitized.provenance, commit: 'c'.repeat(40) } },
    { ...sanitized, provenance: { ...sanitized.provenance, sourceDigest: 'not-a-digest' } },
    { ...sanitized, provenance: { ...sanitized.provenance, sourceDigestAlgorithm: 'unknown' } },
    { ...sanitized, provenance: { ...sanitized.provenance, schemaVersion: 2 } },
  );
  for (const gitDirty of [undefined, 'true', 1]) rejected.push({ ...sanitized, gitDirty,
    provenance: { ...sanitized.provenance, gitDirty } });
  for (const forged of rejected) assert.throws(() => runtimeDeploymentBinding(env, forged), /binding/);
  assert.throws(() => runtimeDeploymentBinding({ ...env, FCOS_BUILD_COMMIT_SHA: 'c'.repeat(40) }, sanitized), /binding/);
});

test('unverified dirty receipts cannot reach any runtime provider or database probe', async () => {
  for (const missing of ['sanitizedCheckout', 'sourceAttested', 'commitVerified', 'releaseEligible']) {
    const forged = { ...receipt, gitDirty: true, provenance: { ...receipt.provenance, gitDirty: true,
      sanitizedCheckout: true, sourceAttested: true, commitVerified: true, [missing]: false } };
    await assert.rejects(() => probeRuntimeConnections({ env, receipt: forged,
      client: { from: () => assert.fail('no database access before verified source') },
      fetchImpl: () => assert.fail('no provider request before verified source') }), /binding/);
  }
});
