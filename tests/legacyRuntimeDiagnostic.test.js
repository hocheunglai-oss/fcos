import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {buildLegacyRuntimeDiagnostic} from '../scripts/legacy-runtime-diagnostic-build.mjs';
import {prepareLegacyDiagnosticRequest} from '../scripts/lib/hosted-release/legacy-runtime-diagnostic-operation.mjs';
import {createLegacyRuntimeDiagnosticHandler,diagnosticReadonlyFetch,diagnosticDigest,validateDiagnosticBinding} from '../scripts/lib/hosted-release/legacy-runtime-diagnostic-handler.mjs';
import {OBSERVATION_DECLARATIONS,OBSERVATION_BASE_SHA} from '../scripts/lib/runtime-compatibility-observation.mjs';
import {fcosConnectionIdentifier,fcosSalesforceEnvironment} from '../config/fcosConnections.js';

const root=fileURLToPath(new URL('../',import.meta.url)),time=Date.now(),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'legacy-runtime-diagnostic-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const helper=readFileSync(join(root,'scripts/lib/runtime-compatibility-observation.mjs'),'utf8'),collectorFile=readFileSync(join(root,'scripts/runtime-compatibility-release.mjs'),'utf8');
  const sections=OBSERVATION_DECLARATIONS.map((_,i)=>helper.split(`// BEGIN IMMUTABLE PURE ${i}\n`)[1].split(`// END IMMUTABLE PURE ${i}\n`)[0]);
  const collector=collectorFile.slice(collectorFile.indexOf('export async function collectCompatibilityBaselineRuntime('),collectorFile.indexOf('\nfunction sourceInventory(')).trimEnd();
  const keys=new Set();for(const text of [...sections,collector])for(const m of text.matchAll(/\b(?:env|privateEnvironment)\.([A-Z][A-Z0-9_]*)/g))keys.add(m[1]);
  for(const m of sections.join('\n').matchAll(/envName:\s*'([A-Z][A-Z0-9_]*)'/g))keys.add(m[1]);
  keys.delete('VERCEL_ENV');const recordKeys=[...keys].sort();while(recordKeys.length<58)recordKeys.push(`FCOS_DIAGNOSTIC_FIXTURE_${recordKeys.length}`);
  const inventory=[...recordKeys,'VERCEL_ENV'];while(inventory.length<190)inventory.push(`PLATFORM_FIXTURE_${inventory.length}`);
  const binding={schemaVersion:1,kind:'fcos_legacy_runtime_diagnostic_request_v1',operationId:'a'.repeat(64),controllerSha:head,
    candidateSha:JSON.parse(readFileSync(join(root,'config/runtime-compatibility-successor-live.json'))).candidateSha,
    previous:{deploymentId:'dpl_KmyVbNkg7okjW4PPjR8ZJXRz19AL',sha:OBSERVATION_BASE_SHA,url:'https://fcos-3nt36gqot-hocheunglai-6535s-projects.vercel.app',sourceSha256:'9ce0445de15bff7992867e689328c1189b9c586a850149f5ad26384482f1b7f6',createdAt:1790782639737},
    issuedAt:time-1000,notAfter:time+60000,customEnvironment:{id:'env_DiagnosticOwnedFixture',slug:'fcos-legacy-diag-aaaaaaaaaaaa',copyFrom:'production'},projectRecords:recordKeys.map((key,i)=>({id:`public-record-${i}`,key,target:['production'],gitBranch:null,createdAt:1790749482240,updatedAt:1790749482241})),legacyEnvironmentKeys:inventory.sort(),allowQuotaMetadata:false};
  const capability=randomBytes(32).toString('base64url'),challenge=randomBytes(32).toString('base64url'),outputDirectory=join(directory,'stage');
  const options={controllerDirectory:root,outputDirectory,binding,capability};
  const env=Object.fromEntries(recordKeys.map(k=>[k,''])),project=fcosConnectionIdentifier('supabase','Project ref'),sf=fcosSalesforceEnvironment('production');
  Object.assign(env,{SUPABASE_URL:`https://${project}.supabase.co`,SUPABASE_SECRET_KEY:'sb_secret_PRIVATE_APPLICATION_CREDENTIAL',SALESFORCE_INSTANCE_URL:sf.instanceUrl,SALESFORCE_ACCESS_TOKEN:'PRIVATE_SALESFORCE_CREDENTIAL',XERO_TENANT_ID:'11111111-1111-1111-1111-111111111111',VERCEL_ENV:'preview',VERCEL_PROJECT_ID:fcosConnectionIdentifier('vercel','Project ID'),VERCEL_URL:'fcos-diagnosticfixture-hocheunglai-6535s-projects.vercel.app',VERCEL_DEPLOYMENT_ID:'dpl_DiagnosticActual',VERCEL_TARGET_ENV:binding.customEnvironment.slug});
  const calls=[];const fetchImpl=async(url,o)=>{calls.push({url,method:o.method});assert.equal(o.redirect,'error');assert.equal(o.body,undefined);
    if(url.includes('supabase.co/'))return new Response(JSON.stringify([{id:'PRIVATE_PROFILE_ROW'}]),{status:200});
    if(url.startsWith(sf.instanceUrl+'/services/data/'))return new Response(JSON.stringify({totalSize:1,done:true,records:[{Id:sf.orgId,IsSandbox:false,attributes:{type:'Organization'}}]}),{status:200});
    assert.fail('Unexpected provider request');};
  const req={method:'GET',url:'/api/legacy-runtime-observation',headers:{host:env.VERCEL_URL,'x-fcos-legacy-diagnostic-capability':capability,'x-fcos-diagnostic-challenge':challenge}};
  return {directory,outputDirectory,options,binding,capability,challenge,env,calls,fetchImpl,req,collector,project};
}
async function invoke(handler,req){let body;const headers={};const res={statusCode:0,setHeader:(k,v)=>headers[k]=v,end:v=>{body=v;}};await handler(req,res);return {status:res.statusCode,headers,body,json:JSON.parse(body)};}
function walk(dir,base=''){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name),`${base}${e.name}/`):[`${base}${e.name}`]);}

test('builder emits one exact standalone function; original collector and pure sources, no raw capability or app secrets',async t=>{
  const f=fixture(t),built=buildLegacyRuntimeDiagnostic(f.options),m=built.manifest;
  assert.equal(m.kind,'fcos_legacy_runtime_diagnostic_build_v1');assert.equal(m.baselineAccepted,false);assert.equal(built.privateAuthorization.capability,f.capability);
  assert.equal(m.binding.projectRecordKeys.length,58);assert.equal(m.binding.legacyEnvironmentKeys.length,190);assert.deepEqual(m.binding.absentDependencies,[]);
  assert.deepEqual(walk(f.outputDirectory).sort(),m.files.map(r=>r.path).sort());assert.equal(m.files.length,8);
  for(const row of m.files){const b=readFileSync(join(f.outputDirectory,row.path));assert.equal(b.length,row.byteLength);assert.equal(diagnosticDigest(b),row.sha256);assert.ok(!b.includes(Buffer.from(f.capability)));assert.doesNotMatch(b.toString(),/PRIVATE_APPLICATION_CREDENTIAL|PRIVATE_SALESFORCE_CREDENTIAL|PRIVATE_PROFILE_ROW/);}
  assert.equal(statSync(f.outputDirectory).mode&0o777,0o700);
  const config=JSON.parse(readFileSync(join(f.outputDirectory,'.vercel/output/config.json')));assert.deepEqual(config,{version:3,routes:[{src:'^/api/legacy-runtime-observation$',dest:'/api/legacy-runtime-observation'}]});
  assert.deepEqual(JSON.parse(readFileSync(join(f.outputDirectory,'vercel.json'))),{version:2,crons:[]});
  const functionDir=join(f.outputDirectory,'.vercel/output/functions/api/legacy-runtime-observation.func'),runtime=(await import(pathToFileURL(join(functionDir,'collector.mjs')).href));
  assert.equal(diagnosticDigest(runtime.collectCompatibilityBaselineRuntime.toString()),m.binding.source.collectorSha256);
  assert.equal(m.binding.source.collectorSha256,diagnosticDigest(f.collector.replace(/^export /,'')));
  for(const path of ['collector.mjs','connections.mjs','handler.mjs','index.mjs'])assert.doesNotMatch(readFileSync(join(functionDir,path),'utf8'),/from ['"](?:node:fs|node:child_process|.*release-controller|@supabase\/supabase-js)['"]|execFile|require\(/);
  const request=prepareLegacyDiagnosticRequest({manifest:m,files:m.files.map(r=>({path:r.path,bytes:readFileSync(join(f.outputDirectory,r.path))}))});
  assert.equal(request.body.customEnvironmentSlugOrId,f.binding.customEnvironment.id);assert.equal(request.body.target,undefined);assert.equal(request.body.files.length,7);
  assert.throws(()=>buildLegacyRuntimeDiagnostic({...f.options,outputDirectory:join(root,'.diagnostic-output-must-not-exist')}));
  assert.equal(existsSync(join(root,'.diagnostic-output-must-not-exist')),false);
  assert.throws(()=>buildLegacyRuntimeDiagnostic(f.options));
});

test('actual generated .func uses copied runtime strings, explicit Production interpretation and honest custom identity without Xero',async t=>{
  const f=fixture(t),built=buildLegacyRuntimeDiagnostic(f.options),previous={...process.env},oldFetch=globalThis.fetch;
  t.after(()=>{for(const k of Object.keys(process.env))if(!Object.hasOwn(previous,k))delete process.env[k];Object.assign(process.env,previous);globalThis.fetch=oldFetch;});
  Object.assign(process.env,f.env);globalThis.fetch=f.fetchImpl;
  const entry=join(f.outputDirectory,'.vercel/output/functions/api/legacy-runtime-observation.func/index.mjs'),{default:handler}=await import(pathToFileURL(entry).href);
  const result=await invoke(handler,f.req);assert.equal(result.status,200,result.body);assert.equal(result.headers['Cache-Control'],'no-store, max-age=0');assert.equal(result.json.challenge,f.challenge);
  assert.equal(result.json.diagnostic.deploymentId,'dpl_DiagnosticActual');assert.equal(result.json.diagnostic.origin,`https://${f.env.VERCEL_URL}`);assert.equal(result.json.evaluatedLegacy.deploymentId,f.binding.previous.deploymentId);
  assert.equal(result.json.runtime.deploymentId,undefined);assert.equal(result.json.runtime.sha,undefined);assert.equal(result.json.runtime.auth.supabase.state,'authenticated');assert.equal(result.json.runtime.auth.salesforce.state,'authenticated');assert.equal(result.json.runtime.auth.xero.state,'unknown');
  assert.equal(result.json.configuration.complete,true);assert.equal(result.json.configuration.kind,'copied_current_production_configuration_with_metadata_only_legacy_inference');assert.equal(result.json.baselineAccepted,false);assert.equal(result.json.buildSha256,built.manifest.buildSha256);
  assert.equal(result.json.diagnostic.target,'preview');assert.equal(result.json.diagnostic.targetEnvironment,f.binding.customEnvironment.slug);assert.deepEqual(result.json.evaluationContext,{physicalVercelEnv:'preview',physicalTargetEnvironment:f.binding.customEnvironment.slug,interpretedVercelEnv:'production',copyFrom:'production'});
  assert.equal(result.json.runtime.safety.readOnly,false); // Actual preview would be true; explicit interpretation is observable.
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.method==='GET'&&!c.url.includes('xero')));assert.doesNotMatch(result.body,/PRIVATE_|sb_secret_|capability|access_token|secretKey|public-record-|sourceAttested/);
});

test('unknown callers and wrong method/route/capability/challenge/identity/horizon get constant404 before observation',async t=>{
  const f=fixture(t),built=buildLegacyRuntimeDiagnostic(f.options);let observed=0,at=time;
  const handler=createLegacyRuntimeDiagnosticHandler({binding:built.manifest.binding,capabilitySha256:diagnosticDigest(f.capability),collectRuntime:()=>{observed++;assert.fail();},environment:()=>f.env,now:()=>at,fetchImpl:()=>assert.fail()});
  const requests=[{...f.req,method:'POST'},{...f.req,url:'/api/connection-runtime'},{...f.req,url:f.req.url+'?challenge=x'},
    {...f.req,headers:{...f.req.headers,'x-fcos-legacy-diagnostic-capability':randomBytes(32).toString('base64url')}},{...f.req,headers:{...f.req.headers,'x-fcos-legacy-diagnostic-capability':undefined}},
    {...f.req,headers:{...f.req.headers,'x-fcos-diagnostic-challenge':'bad'}},{...f.req,headers:{...f.req.headers,host:'fcos.fcuno.com'}},{...f.req,headers:{...f.req.headers,'content-length':'1'}}];
  for(const req of requests){const r=await invoke(handler,req);assert.equal(r.status,404);assert.equal(r.body,'{"error":"NOT_FOUND"}');}
  for(const [k,v]of [['VERCEL_ENV','production'],['VERCEL_PROJECT_ID','wrong'],['VERCEL_URL','evil.example'],['VERCEL_TARGET_ENV','preview'],['VERCEL_TARGET_ENV',undefined]]){const old=f.env[k];f.env[k]=v;assert.equal((await invoke(handler,f.req)).status,404);f.env[k]=old;}
  at=f.binding.notAfter;assert.equal((await invoke(handler,f.req)).status,404);assert.equal(observed,0);assert.deepEqual(f.calls,[]);
});

test('coverage missing/unknown dependencies and source/metadata drift fail closed; empty observed strings are valid',async t=>{
  const f=fixture(t),built=buildLegacyRuntimeDiagnostic(f.options);let observed=0;
  const handler=createLegacyRuntimeDiagnosticHandler({binding:built.manifest.binding,capabilitySha256:diagnosticDigest(f.capability),collectRuntime:()=>{observed++;throw Error('PRIVATE_ERROR_VALUE');},environment:()=>f.env,now:()=>time});
  delete f.env.SUPABASE_SECRET_KEY;const r=await invoke(handler,f.req);assert.equal(r.status,503);assert.doesNotMatch(r.body,/PRIVATE_|SUPABASE|records/);assert.equal(observed,0);
  for(const mutate of [b=>b.controllerSha='e'.repeat(40),b=>b.candidateSha='e'.repeat(40),b=>b.previous.sha='e'.repeat(40),b=>b.projectRecords.pop(),b=>b.projectRecords[1].key=b.projectRecords[0].key,
    b=>b.projectRecords[0].updatedAt=b.previous.createdAt+1,b=>b.projectRecords[0].gitBranch='other',b=>b.allowQuotaMetadata=true,b=>b.notAfter=b.issuedAt+86400001,b=>b.legacyEnvironmentKeys.pop(),b=>b.customEnvironment.slug='production',b=>b.customEnvironment.copyFrom='preview']){
    const binding=structuredClone(f.binding);mutate(binding);const outputDirectory=join(f.directory,randomBytes(4).toString('hex'));assert.throws(()=>buildLegacyRuntimeDiagnostic({...f.options,binding,outputDirectory}));assert.equal(existsSync(outputDirectory),false);
  }
  assert.throws(()=>validateDiagnosticBinding({...built.manifest.binding,dependencyKeys:[...built.manifest.binding.dependencyKeys,'UNKNOWN_DYNAMIC_KEY']}));
});

test('network seam denies writes/redirects/extra headers/retries/Xero and bounds body; provider failures never disclose raw errors',async t=>{
  const f=fixture(t),built=buildLegacyRuntimeDiagnostic(f.options),b=built.manifest.binding,url=`https://${f.project}.supabase.co/rest/v1/user_profiles?select=id&limit=1`;
  let calls=0;const network=diagnosticReadonlyFetch({binding:b,privateEnvironment:f.env,fetchImpl:async()=>{calls++;return new Response('[{"id":"private"}]');}}),valid={method:'GET',redirect:'error',headers:{apikey:f.env.SUPABASE_SECRET_KEY}};
  for(const [u,o]of [['https://api.xero.com/connections',valid],[url,{...valid,method:'POST'}],[url,{...valid,body:'{}'}],[url,{...valid,redirect:'follow'}],[url,{...valid,headers:{...valid.headers,extra:'private'}}],[url.replace('limit=1','limit=2'),valid]])await assert.rejects(network(u,o));
  assert.equal(calls,0);assert.deepEqual(await (await network(url,valid)).json(),[{id:'private'}]);await assert.rejects(network(url,valid));assert.equal(calls,1);
  const redirect=diagnosticReadonlyFetch({binding:b,privateEnvironment:f.env,fetchImpl:async()=>({ok:true,status:200,redirected:true,url})});await assert.rejects(redirect(url,valid));
  const huge=diagnosticReadonlyFetch({binding:b,privateEnvironment:f.env,fetchImpl:async()=>new Response('x'.repeat(65537))});await assert.rejects((await huge(url,valid)).json());
  const handler=createLegacyRuntimeDiagnosticHandler({binding:b,capabilitySha256:diagnosticDigest(f.capability),collectRuntime:async()=>{throw Error('PRIVATE_PROVIDER_TOKEN_RAW_ERROR');},environment:()=>f.env,now:()=>time});
  const result=await invoke(handler,f.req);assert.equal(result.status,503);assert.doesNotMatch(result.body,/PRIVATE_|TOKEN|RAW_ERROR/);
});

test('late deadline prevents a second provider read; malformed private tenant never becomes public target data',async t=>{
  const f=fixture(t),built=buildLegacyRuntimeDiagnostic(f.options),path=join(f.outputDirectory,'.vercel/output/functions/api/legacy-runtime-observation.func/collector.mjs');
  const {collectCompatibilityBaselineRuntime:collectRuntime}=await import(pathToFileURL(path).href);let at=time;
  const handler=createLegacyRuntimeDiagnosticHandler({binding:built.manifest.binding,capabilitySha256:diagnosticDigest(f.capability),collectRuntime,environment:()=>f.env,now:()=>at,
    fetchImpl:async(...args)=>{const r=await f.fetchImpl(...args);at=f.binding.notAfter;return r;}});
  const expired=await invoke(handler,f.req);assert.equal(expired.status,503);assert.equal(f.calls.length,1);
  f.calls.length=0;f.env.XERO_TENANT_ID='PRIVATE_MISCONFIGURED_TENANT_VALUE';at=time;
  const privateTenant=createLegacyRuntimeDiagnosticHandler({binding:built.manifest.binding,capabilitySha256:diagnosticDigest(f.capability),collectRuntime,environment:()=>f.env,now:()=>at,fetchImpl:f.fetchImpl});
  const invalid=await invoke(privateTenant,f.req);assert.equal(invalid.status,503);assert.doesNotMatch(invalid.body,/PRIVATE_|TENANT_VALUE/);assert.equal(f.calls.length,2);
});

test('immutable inventory absence is explicit; newly present absent dependency blocks before provider calls',async t=>{
  const f=fixture(t),name='FCUNO_IDENTITY_ISSUER',record=f.binding.projectRecords.find(r=>r.key===name);assert.ok(record);record.key='FCOS_REPLACEMENT_FIXTURE';
  f.binding.legacyEnvironmentKeys=f.binding.legacyEnvironmentKeys.map(k=>k===name?'FCOS_REPLACEMENT_FIXTURE':k);
  const built=buildLegacyRuntimeDiagnostic(f.options);assert.ok(built.manifest.binding.absentDependencies.includes(name));
  const path=join(f.outputDirectory,'.vercel/output/functions/api/legacy-runtime-observation.func/collector.mjs'),{collectCompatibilityBaselineRuntime:collectRuntime}=await import(pathToFileURL(path).href);
  f.env.FCOS_REPLACEMENT_FIXTURE='';const handler=createLegacyRuntimeDiagnosticHandler({binding:built.manifest.binding,capabilitySha256:diagnosticDigest(f.capability),collectRuntime,environment:()=>f.env,now:()=>time,fetchImpl:f.fetchImpl});
  assert.equal((await invoke(handler,f.req)).status,503);assert.equal(f.calls.length,0);
  delete f.env[name];assert.equal((await invoke(handler,f.req)).status,200);assert.equal(f.calls.length,2);
});
