import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runEnrollmentOperation, enrollmentPlan, readEnrollmentTokenMetadata } from '../scripts/preview-vercel-enrollment.mjs';
import { ENROLLMENT_FIXED_TARGET as target, ENROLLED_AUTHORITY_SECRET, verifyEnrollmentReceipt } from '../scripts/lib/preview-vercel-enrollment.mjs';
import { PREVIEW_EMAIL_CONTRACT_SHA256 } from '../scripts/lib/preview-email-build.mjs';
const now = Date.parse('2026-10-03T04:00:00Z'), scriptSha256 = 'a'.repeat(64);
const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex').toString('base64')}\n-----END PRIVATE KEY-----`;
const publicKey = Buffer.from('302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex').toString('base64');
const candidateSha = JSON.parse(readFileSync(new URL('../config/legacy-email-baseline-proof.json',import.meta.url))).preview.candidates[0].sha;
const token = 'vcp_OPERATOR_TEST_PRIVATE_MARKER', tokenId = 'test-issued-token-id';
const enrollmentId = '11111111-1111-4111-8111-111111111111';
const baseSecrets = ['FCOS_RELEASE_GH_TOKEN', 'FCOS_RELEASE_VERCEL_TOKEN', 'FCOS_E2E_VERCEL_BYPASS',
 'FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN', 'FCOS_RELEASE_RUNTIME_TOKEN'].map(name=>({name,created_at:new Date(now-10000).toISOString(),updated_at:new Date(now-10000).toISOString()}));
const freshMetadata = {id:tokenId,type:'token',prefix:'vcp_',projectId:target.projectId,createdAt:now-1000,expiresAt:now+3600000,scopes:[{type:'team',teamId:target.teamId}]};
function fixture() {
 const calls=[], secrets=structuredClone(baseSecrets), values={}, vars={}; let durable, keychain, clock=now;
 const approval={schemaVersion:1,action:'enroll',authorized:true,authorizedBy:'hocheunglai-oss',authorizationEvidence:'OFFLINE TEST ONLY',authorizedAt:now,
  scriptSha256,nonce:'22222222-2222-4222-8222-222222222222',enrollmentId,target,harnessSha:'b'.repeat(40),candidateSha,controlRevision:'c'.repeat(64),contractSha256:PREVIEW_EMAIL_CONTRACT_SHA256,
  expiresAt:freshMetadata.expiresAt,leaseDeadline:freshMetadata.expiresAt,secretMetadata:structuredClone(secrets),previousReviewedTokenId:'old-reviewed-id'};
 const checked={repositoryId:7,environmentId:8,tokenId:'old-reviewed-id',secrets};
 const io={
  preflight:async()=>{calls.push('preflight');return structuredClone(checked);},
  claim:async(a,state)=>{calls.push('claim');if(durable)throw new Error('exists');durable=structuredClone(state);},
  save:async(a,state)=>{calls.push('save:'+state.phase);durable=structuredClone(state);},
  issue:async()=>{calls.push('POST');return {bearerToken:token,token:{id:tokenId}};},
  tokenMetadata:async id=>{calls.push(id==='old-reviewed-id'?'GET:reviewed-metadata':'GET:metadata');return {...structuredClone(freshMetadata),id};},
  keychainSet:async(account,value)=>{calls.push('private-store');keychain=value;},keychainGet:async()=>{calls.push('private-read');return keychain;},
  secretSet:async(name,value)=>{calls.push('secret:'+name);values[name]=value;let row=secrets.find(x=>x.name===name);if(!row){row={name,created_at:new Date(now).toISOString()};secrets.push(row);}row.updated_at=new Date(now).toISOString();},
  secretMetadata:async()=>structuredClone(secrets),assertDisabled:async()=>{calls.push('assert-disabled');},
  variableSet:async(name,value)=>{calls.push('variable:'+name);vars[name]=value;},
  readEnrollment:async()=>structuredClone(durable),claimAttestation:async()=>{calls.push('attestation-claim');},signingKey:async()=>{calls.push('signing-key');return privateKey;},
 };
 const execute=(action='enroll')=>runEnrollmentOperation({action,approval,scriptSha256,io,now:()=>clock,attestationPublicKey:publicKey});
 return {approval,checked,io,calls,values,vars,execute,get durable(){return durable;},get capsule(){return keychain;},clock:value=>{clock=value;}};
}
test('default plan touches no provider, key or adapter property',async()=>{
 let touched=0;const io=new Proxy({}, {get(){touched++;throw Error('private');}});
 assert.deepEqual(await runEnrollmentOperation({io}),enrollmentPlan());assert.equal(touched,0);
});
for(const [label,mutate] of [
 ['missing approval',f=>f.approval.authorized=false],['wrong target',f=>f.approval.target={...target,projectId:'other'}],
 ['unreviewed helper',f=>f.approval.scriptSha256='f'.repeat(64)],['expired approval',f=>f.approval.authorizedAt=now-3600001],
 ['lease extension',f=>f.approval.leaseDeadline=f.approval.expiresAt-1],['unreviewed candidate',f=>f.approval.candidateSha='f'.repeat(40)]
])test(label+' blocks before provider I/O',async()=>{const f=fixture();mutate(f);await assert.rejects(f.execute());assert.deepEqual(f.calls,[]);});
for(const [label,mutate] of [
 ['missing',a=>delete a.secretMetadata],['null',a=>a.secretMetadata=null],['non-array',a=>a.secretMetadata={}],
 ['empty',a=>a.secretMetadata=[]],['missing required name',a=>a.secretMetadata[0].name=ENROLLED_AUTHORITY_SECRET],
 ['duplicate name',a=>a.secretMetadata.push({...a.secretMetadata[0]})],['unrelated name',a=>a.secretMetadata.push({...a.secretMetadata[0],name:'UNRELATED_SECRET'})],
 ['malformed row',a=>a.secretMetadata[0]=null],['extra private field',a=>a.secretMetadata[0].value=token],
 ['missing timestamp',a=>delete a.secretMetadata[0].updated_at],['invalid timestamp',a=>a.secretMetadata[0].updated_at='not-a-date'],
 ['impossible date',a=>a.secretMetadata[0].created_at='2026-02-30T00:00:00Z'],['numeric timestamp',a=>a.secretMetadata[0].created_at=now],
 ['reversed timestamps',a=>a.secretMetadata[0].created_at=new Date(now).toISOString()],
 ['future timestamp',a=>a.secretMetadata[0].updated_at=new Date(now+30001).toISOString()],
 ['accessor timestamp',a=>Object.defineProperty(a.secretMetadata[0],'updated_at',{get(){assert.fail('Snapshot accessor must not execute.');}})]
])test(`${label} secret snapshot is rejected before any adapter property or I/O`,async()=>{
 const f=fixture();mutate(f.approval);let accesses=0;
 const io=new Proxy({}, {get(){accesses++;throw Error(token);}});
 await assert.rejects(runEnrollmentOperation({action:'enroll',approval:f.approval,scriptSha256,io,now:()=>now}),error=>!error.message.includes(token));
 assert.equal(accesses,0);assert.deepEqual(f.calls,[]);
});
test('explicit optional enrollment companion metadata remains eligible for exact baseline comparison',async()=>{
 const f=fixture(),row={name:ENROLLED_AUTHORITY_SECRET,created_at:new Date(now-10000).toISOString(),updated_at:new Date(now-10000).toISOString()};
 f.approval.secretMetadata.push({...row});f.checked.secrets.push({...row});assert.equal((await f.execute()).enrolled,true);
});
test('actual five-secret baseline enrolls while preserving all unrelated metadata and never enables a gate',async()=>{
 const f=fixture();assert.equal(f.approval.secretMetadata.length,5);const result=await f.execute();assert.equal(result.enrolled,true);assert.equal(f.durable.phase,'enrolled_disabled');
 assert.equal(f.durable.secretMetadata.length,6);
 for(const before of baseSecrets.filter(row=>row.name!=='FCOS_RELEASE_VERCEL_TOKEN'))assert.deepEqual(f.durable.secretMetadata.find(row=>row.name===before.name),before);
 assert.equal(f.calls.filter(x=>x==='POST').length,1);assert.ok(f.calls.indexOf('GET:reviewed-metadata')<f.calls.indexOf('claim'));assert.ok(f.calls.indexOf('claim')<f.calls.indexOf('POST'));
 assert.equal(f.values.FCOS_RELEASE_VERCEL_TOKEN,token);assert.equal(f.values[ENROLLED_AUTHORITY_SECRET],f.capsule);
 const evidence=JSON.stringify({state:f.durable,result});assert.ok(!evidence.includes(token));assert.ok(!evidence.includes(JSON.parse(f.capsule).binding));
 assert.deepEqual(Object.keys(f.vars),['FCOS_RELEASE_VERCEL_TOKEN_ID','FCOS_PREVIEW_VERCEL_ENROLLMENT_ID']);
});
for(const name of ['FCOS_RELEASE_GH_TOKEN','FCOS_E2E_VERCEL_BYPASS','FCOS_RELEASE_PREVIEW_RUNTIME_TOKEN','FCOS_RELEASE_RUNTIME_TOKEN'])
 test(`${name} metadata drift after paired writes quarantines enrollment before pins`,async()=>{
  const f=fixture(),read=f.io.secretMetadata;
  f.io.secretMetadata=async()=>{const rows=await read();rows.find(row=>row.name===name).updated_at=new Date(now).toISOString();return rows;};
  await assert.rejects(f.execute());assert.equal(f.durable.phase,'quarantined_reconciliation_required');assert.deepEqual(f.vars,{});
 });
test('added or removed unrelated secret after paired writes also refuses enrollment',async()=>{
 for(const mutate of [rows=>rows.push({name:'UNRELATED_NEW_SECRET',created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()}),
  rows=>rows.splice(rows.findIndex(row=>row.name==='FCOS_E2E_VERCEL_BYPASS'),1)]){
  const f=fixture(),read=f.io.secretMetadata;f.io.secretMetadata=async()=>{const rows=await read();mutate(rows);return rows;};
  await assert.rejects(f.execute());assert.equal(f.durable.phase,'quarantined_reconciliation_required');assert.deepEqual(f.vars,{});
 }
});
test('wrong management identity stops before intent, issuance or writes',async()=>{
 const f=fixture();f.io.preflight=async()=>{throw Error('identity mismatch');};await assert.rejects(f.execute());assert.deepEqual(f.calls,[]);assert.equal(f.durable,undefined);
});
test('changed existing credential metadata or reviewed ID stops before issuance',async()=>{
 for(const change of [f=>f.checked.secrets[0].updated_at='changed',f=>f.checked.tokenId='unexpected']){const f=fixture();change(f);await assert.rejects(f.execute());assert.deepEqual(f.calls,['preflight']);}
});
test('uncertain issuance has one POST and cannot be retried or overwrite its original quarantine',async()=>{
 const f=fixture();f.io.issue=async()=>{f.calls.push('POST');throw Error(token);};await assert.rejects(f.execute());
 assert.equal(f.durable.phase,'quarantined_reconciliation_required');const original=structuredClone(f.durable);
 await assert.rejects(f.execute());assert.equal(f.calls.filter(x=>x==='POST').length,1);assert.deepEqual(f.durable,original);
});
test('paired-secret partial failure remains quarantined with no reviewed pin or enable writes',async()=>{
 const f=fixture(),set=f.io.secretSet;f.io.secretSet=async(name,value)=>{if(name===ENROLLED_AUTHORITY_SECRET)throw Error(token);await set(name,value);};
 await assert.rejects(f.execute());assert.equal(f.durable.phase,'quarantined_reconciliation_required');assert.deepEqual(f.vars,{});
 assert.equal(f.values.FCOS_RELEASE_VERCEL_TOKEN,token);assert.equal(f.values[ENROLLED_AUTHORITY_SECRET],undefined);
 f.approval.action='attest';f.approval.attestorNewPurposeAuthorized=true;f.approval.runId=9;f.approval.operation='verify-authority';
 await assert.rejects(f.execute('attest'));assert.ok(!f.calls.includes('signing-key'));
});
test('hostile thrown provider exception is never inspected or serialized after intent',async()=>{
 const f=fixture();let inspected=0;f.io.issue=async()=>{throw new Proxy({}, {get(){inspected++;throw Error(token);},ownKeys(){inspected++;throw Error(token);}});};
 await assert.rejects(f.execute(),error=>!error.message.includes(token));assert.equal(inspected,0);assert.equal(f.durable.phase,'quarantined_reconciliation_required');
});
for(const [label,mutate] of [
 ['full-account token',m=>delete m.projectId],['other project',m=>m.projectId='other'],['wide lifetime',m=>m.expiresAt=now+86400001],
 ['wrong issued ID',m=>m.id='unrelated'],['revoked token',m=>m.revokedAt=now],['extra team scope',m=>m.scopes.push({...m.scopes[0],teamId:'other'})]
])test(label+' refuses all secret writes',async()=>{const f=fixture(),read=f.io.tokenMetadata;f.io.tokenMetadata=async id=>{if(id==='old-reviewed-id')return read(id);const m=structuredClone(freshMetadata);mutate(m);return m;};await assert.rejects(f.execute());assert.deepEqual(f.values,{});assert.equal(f.durable.phase,'quarantined_reconciliation_required');assert.equal(f.durable.failureStage,'private_enrollment_validation');});
function metadataResponse(id=tokenId, overrides={}) {
 return {status:200,redirected:false,url:`https://api.vercel.com/v5/user/tokens/${id}`,
  headers:new Headers({'content-type':'application/json'}),body:new Response(JSON.stringify({token:{...freshMetadata,id}})).body,...overrides};
}
test('exact-ID metadata uses one bounded query-free HTTPS GET and the supplied management bearer',async()=>{
 const requests=[],management='TEST_MANAGEMENT_CREDENTIAL';
 const result=await readEnrollmentTokenMetadata({tokenId,token:management,fetchImpl:async(url,options)=>{
  requests.push({url,options});return metadataResponse();
 }});
 assert.equal(result.id,tokenId);assert.equal(requests.length,1);
 const {url,options}=requests[0];assert.equal(url,`https://api.vercel.com/v5/user/tokens/${tokenId}`);
 assert.equal(new URL(url).search,'');assert.equal(options.method,'GET');assert.equal(options.headers.authorization,`Bearer ${management}`);
 assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);
 assert.equal(options.body,undefined);
});
test('enrollment uses the same metadata adapter and management credential before and after its single POST',async()=>{
 const f=fixture(),management='FIXTURE_CAPTURED_MANAGEMENT';const requests=[];
 f.io.tokenMetadata=id=>readEnrollmentTokenMetadata({tokenId:id,token:management,fetchImpl:async(url,options)=>{
  requests.push({url,authorization:options.headers.authorization});f.calls.push(`https-metadata:${id}`);return metadataResponse(id);
 }});
 assert.equal((await f.execute()).enrolled,true);
 assert.deepEqual(requests.map(row=>row.url),['old-reviewed-id',tokenId].map(id=>`https://api.vercel.com/v5/user/tokens/${id}`));
 assert.ok(requests.every(row=>row.authorization===`Bearer ${management}`));
 assert.ok(f.calls.indexOf('https-metadata:old-reviewed-id')<f.calls.indexOf('claim'));
 assert.ok(f.calls.indexOf('POST')<f.calls.indexOf(`https-metadata:${tokenId}`));
});
test('an actual metadata adapter rejection during preflight makes no claim, POST or private write',async()=>{
 const f=fixture();let gets=0;
 f.io.tokenMetadata=id=>readEnrollmentTokenMetadata({tokenId:id,token:'fixture-management',fetchImpl:async()=>{gets++;return metadataResponse(id,{status:404});}});
 await assert.rejects(f.execute());assert.equal(gets,1);assert.deepEqual(f.calls,['preflight']);assert.equal(f.durable,undefined);assert.deepEqual(f.values,{});assert.deepEqual(f.vars,{});
});
for(const id of ['current','../other','id?teamId=other','https://other.invalid','',null])
 test(`metadata reader refuses non-exact ID ${String(id)} before fetch`,async()=>{
  let calls=0;await assert.rejects(readEnrollmentTokenMetadata({tokenId:id,token:'fixture',fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
 });
for(const [label,read] of [
 ['unavailable route',async()=>{throw Error(token);}],
 ['wrong returned ID',async()=>({id:'unrelated'})],
 ['missing envelope',async()=>undefined]
])test(`reviewed metadata preflight ${label} prevents intent, issuance and every write`,async()=>{
 const f=fixture();f.io.tokenMetadata=read;await assert.rejects(f.execute(),error=>!error.message.includes(token));
 assert.deepEqual(f.calls,['preflight']);assert.equal(f.durable,undefined);assert.deepEqual(f.values,{});assert.deepEqual(f.vars,{});
});
test('expiry reached during metadata capability preflight prevents issuance',async()=>{
 const f=fixture(),read=f.io.tokenMetadata;f.io.tokenMetadata=async id=>{const result=await read(id);f.clock(f.approval.expiresAt);return result;};
 await assert.rejects(f.execute());assert.deepEqual(f.calls,['preflight','GET:reviewed-metadata']);assert.equal(f.durable,undefined);
});
const metadataFailures=[
 ['HTTP rejection',()=>metadataResponse(tokenId,{status:404}), 'http_response_rejected',404],
 ['redirect',()=>metadataResponse(tokenId,{redirected:true}), 'http_response_rejected',200],
 ['different URL',()=>metadataResponse(tokenId,{url:'https://other.invalid/'}), 'http_response_rejected',200],
 ['wrong content type',()=>metadataResponse(tokenId,{headers:new Headers({'content-type':'text/plain'})}), 'http_response_rejected',200],
 ['missing body',()=>metadataResponse(tokenId,{body:null}), 'body_read_failed_output_suppressed',200],
 ['oversized body',()=>metadataResponse(tokenId,{body:new Response('x'.repeat(1024*1024+1)).body}), 'response_size_rejected',200],
 ['malformed JSON',()=>metadataResponse(tokenId,{body:new Response('private invalid JSON '+token).body}), 'response_json_rejected',200],
 ['wrong token ID',()=>metadataResponse(tokenId,{body:new Response(JSON.stringify({token:{...freshMetadata,id:'other'}})).body}), 'metadata_shape_rejected',200],
 ['missing token object',()=>metadataResponse(tokenId,{body:new Response('{}').body}), 'metadata_shape_rejected',200],
 ['transport exception',()=>{throw Error(token);}, 'transport_failed_output_suppressed',undefined],
];
for(const [label,response,category,status] of metadataFailures)test(`${label} records only fixed safe evidence and quarantines without repeating issuance`,async()=>{
 const f=fixture(),read=f.io.tokenMetadata;let gets=0;
 f.io.tokenMetadata=id=>id==='old-reviewed-id'?read(id):readEnrollmentTokenMetadata({tokenId:id,token:'fixture-management',fetchImpl:async()=>{gets++;return response();}});
 await assert.rejects(f.execute(),error=>!error.message.includes(token));
 assert.equal(f.durable.phase,'quarantined_reconciliation_required');assert.equal(f.durable.failureStage,'issued_metadata_read');
 assert.equal(f.durable.failureCategory,category);assert.equal(f.durable.httpStatus,status);assert.equal(f.durable.tokenId,undefined);
 assert.equal(gets,1);assert.equal(f.calls.filter(x=>x==='POST').length,1);assert.deepEqual(f.values,{});assert.deepEqual(f.vars,{});
 assert.ok(!JSON.stringify(f.durable).includes(token));assert.ok(!f.calls.includes('private-store'));
 const original=structuredClone(f.durable);await assert.rejects(f.execute());assert.deepEqual(f.durable,original);assert.equal(gets,1);assert.equal(f.calls.filter(x=>x==='POST').length,1);
});
test('a hostile metadata transport exception is neither inspected nor serialized',async()=>{
 const f=fixture(),read=f.io.tokenMetadata;let inspected=0;
 f.io.tokenMetadata=id=>id==='old-reviewed-id'?read(id):readEnrollmentTokenMetadata({tokenId:id,token:'fixture-management',fetchImpl:async()=>{
  throw new Proxy({}, {get(){inspected++;throw Error(token);},ownKeys(){inspected++;throw Error(token);}});
 }});
 await assert.rejects(f.execute());assert.equal(inspected,0);assert.equal(f.durable.failureStage,'issued_metadata_read');
 assert.equal(f.durable.failureCategory,'transport_failed_output_suppressed');assert.ok(!JSON.stringify(f.durable).includes(token));
});
async function attestationFixture() {
 const f=fixture();await f.execute();f.calls.length=0;Object.assign(f.approval,{action:'attest',nonce:'33333333-3333-4333-8333-333333333333',attestorNewPurposeAuthorized:true,runId:9,operation:'verify-authority'});
 Object.assign(f.checked,{tokenId,enrollmentId});return f;
}
test('positive helper attestation signs with actual fixture Ed25519 and exact runtime HMAC',async()=>{
 const f=await attestationFixture(),result=await f.execute('attest');assert.equal(result.attested,true);
 const envelope=JSON.parse(f.vars.FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT);
 assert.equal(verifyEnrollmentReceipt({envelope,privateEnrollment:f.capsule,token,reviewedTokenId:tokenId,enrollmentId,context:envelope.receipt.context,now,publicKeySpkiBase64:publicKey}).credentialBindingVerified,true);
 assert.ok(f.calls.indexOf('signing-key')<f.calls.indexOf('GET:metadata'));
 assert.equal(f.calls.filter(x=>x==='POST').length,0);assert.equal(f.calls.filter(x=>x.startsWith('secret:')).length,0);
});
test('existing signing key with wrong public pin cannot issue receipt',async()=>{
 const f=await attestationFixture();await assert.rejects(runEnrollmentOperation({action:'attest',approval:f.approval,scriptSha256,io:f.io,now:()=>now}));
 assert.equal(f.vars.FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT,undefined);
});
test('no new-purpose approval means no provider or key read',async()=>{
 const f=await attestationFixture();f.approval.attestorNewPurposeAuthorized=false;await assert.rejects(f.execute('attest'));assert.deepEqual(f.calls,[]);
});
test('metadata observation follows signing-key delay and publication cannot rejuvenate it',async()=>{
 const f=await attestationFixture();f.io.signingKey=async()=>{f.clock(now+50000);return privateKey;};
 const publish=f.io.variableSet;f.io.variableSet=async(name,value)=>{await publish(name,value);f.clock(now+700000);};
 await assert.rejects(f.execute('attest'));const receipt=JSON.parse(f.vars.FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT).receipt;
 assert.equal(receipt.observedAt,now+50000);assert.equal(receipt.expiresAt,now+650000);
});
test('changed paired-secret metadata and tampered private enrollment both refuse receipt',async()=>{
 const f=await attestationFixture();f.checked.secrets.find(x=>x.name==='FCOS_RELEASE_VERCEL_TOKEN').updated_at='changed';await assert.rejects(f.execute('attest'));assert.ok(!f.calls.includes('signing-key'));
 const g=await attestationFixture();g.io.keychainGet=async()=>JSON.stringify({...JSON.parse(g.capsule),enrollment:{...JSON.parse(g.capsule).enrollment,tokenId:'other'}});await assert.rejects(g.execute('attest'));assert.equal(g.vars.FCOS_PREVIEW_VERCEL_AUTHORITY_RECEIPT,undefined);
});

test('private state refuses symlinks, hardlinks and non-private permissions without truncation',async()=>{
 const fs=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {readPrivateEnrollmentState:read,writePrivateEnrollmentState:write}=await import('../scripts/preview-vercel-enrollment.mjs');
 const directory=fs.mkdtempSync(join(tmpdir(),'fcos-enrollment-state-'));
 try{
  const target=join(directory,'state.json'),alias=join(directory,'alias.json');write(target,{phase:'requested'},true);
  assert.deepEqual(read(target),{phase:'requested'});assert.throws(()=>write(target,{phase:'retry'},true));
  write(target,{phase:'complete'});assert.deepEqual(read(target),{phase:'complete'});
  fs.symlinkSync(target,alias);assert.throws(()=>read(alias));assert.throws(()=>write(alias,{phase:'overwrite'}));fs.unlinkSync(alias);
  fs.linkSync(target,alias);assert.throws(()=>read(alias));assert.throws(()=>write(target,{phase:'overwrite'}));fs.unlinkSync(alias);
  fs.chmodSync(target,0o644);assert.throws(()=>read(target));assert.throws(()=>write(target,{phase:'overwrite'}));fs.chmodSync(target,0o600);
  assert.deepEqual(read(target),{phase:'complete'});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('actual Swift stdin reader accumulates split pipe chunks and rejects empty or oversized streams before Keychain',async t=>{
 const fs=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{spawn,spawnSync}=await import('node:child_process');
 const directory=fs.mkdtempSync(join(tmpdir(),'fcos-enrollment-stdin-'));
 try{
  const source=readFileSync(new URL('../scripts/fcos-keychain-migrate.swift',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('func standardInputSecret()'),source.indexOf('\nfunc save('));
  // Compile the ACTUAL reader, with no Security import, save function, or any
  // Keychain symbol in the executable. These are public fixture bytes only.
  const harness=join(directory,'reader.swift'),binary=join(directory,'reader');
  fs.writeFileSync(harness,`import Foundation\nenum MigrationError: Error {case unreadableSource;case emptySecret}\n${body}\ndo {print(try standardInputSecret().count)} catch {print("rejected")}\n`);
  // Cold Linux compilation exceeded 30s under the full parallel CI suite.
  // Keep a bounded wait; compiler errors and timeouts must still fail this test.
  const compiled=spawnSync('swiftc',[harness,'-o',binary],{encoding:'utf8',timeout:90_000});
  if(compiled.error?.code==='ENOENT' && process.platform!=='darwin'){t.skip('The macOS Keychain helper reader requires Swift; swiftc is unavailable on this platform.');return;}
  assert.equal(compiled.status,0,compiled.error?.message || compiled.stderr);
  for(const [input,expected] of [['','rejected'],[' '.repeat(64),'rejected'],['x'.repeat(65537),'rejected'],['x'.repeat(65536),'65536']]){
   const result=spawnSync(binary,[],{input,encoding:'utf8',timeout:5000});assert.equal(result.status,0);assert.equal(result.stdout.trim(),expected);
  }
  const split=await new Promise((resolve,reject)=>{const child=spawn(binary,[],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,output}));child.stdin.write('abc');setTimeout(()=>child.stdin.end('def'),25);});
  assert.equal(split.code,0);assert.equal(split.output.trim(),'6');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
