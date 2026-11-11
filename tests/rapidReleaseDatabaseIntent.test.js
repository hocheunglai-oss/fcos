import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readdirSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { TLSSocket } from 'node:tls';
import { digest,targets } from '../scripts/lib/rapid-release/contract.mjs';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { createDatabaseCredentialIntentStore,DATABASE_SCOPE_EVIDENCE_ENVIRONMENT,DATABASE_UNSUBMITTED_EVIDENCE_ENVIRONMENT,DATABASE_AUTH_RECONCILIATION_SQL } from '../scripts/lib/rapid-release/database-intent.mjs';
import { MANAGED_DATABASE_ROLE_SQL } from '../scripts/lib/rapid-release/database-connection.mjs';
import { openPinnedDatabase,isManagedDatabaseRole,DELEGATED_DATABASE_IDENTITY_SQL } from '../scripts/lib/rapid-release/database-connection.mjs';
import { PUBLIC_CA } from './helpers/rapidDatabaseDelegationFixture.mjs';

const SECRET='DUMMY_ONLY_private_value_never_persist';
const REF='refs/heads/codex/rapid-database-auth-journal';
const clone=value=>structuredClone(value);
const roleFacts=()=>({session_user:'supabase_read_only_user',current_user:'supabase_read_only_user',database:'postgres',read_only:'on',
 server_now_ms:Date.now(),login_role:'cli_login_postgres',can_login:true,is_superuser:false,inherits:false,creates_roles:false,
 creates_databases:false,replicates:false,bypasses_rls:false,role_valid_until_ms:Date.now()-1000,
 memberships:[{role:'postgres',grantor:'supabase_admin',set:true,inherit:false,admin:false}]});
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'fcos-auth-cas-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','-b','main']);writeFileSync(join(directory,'source.txt'),'frozen');git(['add','source.txt']);
 git(['-c','user.name=FCOS Test','-c','user.email=test@example.invalid','commit','-m','fixture']);
 const source={sha:git(['rev-parse','HEAD'])},tree=git(['rev-parse','HEAD^{tree}']);
 const commits=new Map([[source.sha,{sha:source.sha,tree:{sha:tree},parents:[],message:'frozen source'}]]),deployments=[],writes=[];
 const f={directory,source,commits,deployments,writes,head:null,role:roleFacts(),observations:new Map(),preflights:0,issuerPosts:0,
  actor:{id:123,login:targets().account},repository:{full_name:targets().repository,archived:false,permissions:{push:true}}};
 let commitNumber=0,gate;
 f.armRace=()=>{let release;gate={seen:0,promise:new Promise(resolve=>{release=resolve;}),release};};
 const github={
  async read(path){if(path==='/user')return clone(f.actor);if(path===`/repos/${targets().repository}`)return clone(f.repository);
   if(path===`/repos/${targets().repository}/git/ref/${REF.slice(5)}`){
    const observed=f.exactRefReadbacks?.length?f.exactRefReadbacks.shift():f.head;
    if(!observed)throw Error(SECRET);
    return {ref:REF,object:{type:'commit',sha:observed}};
   }
   if(path.includes('/deployments/'))return clone(f.observations.get(Number(path.split('/').at(-1))));
   const sha=path.split('/').at(-1);if(path.includes('/git/commits/')&&commits.has(sha))return clone(commits.get(sha));throw Error(SECRET);},
  async pages(path){if(path.includes('/git/matching-refs/')){
    const snapshot=f.head?[{ref:REF,object:{type:'commit',sha:f.head}}]:[];
    if(gate&&gate.seen<2){gate.seen++;if(gate.seen===2)gate.release();await gate.promise;}
    return [...snapshot,{ref:REF+'-unrelated',object:{type:'commit',sha:'f'.repeat(40)}}];}
   if(path.includes('/deployments?'))return clone(deployments);throw Error(SECRET);},
  async write(path,body){writes.push({method:'POST',path,body:clone(body)});
   if(path.endsWith('/git/commits')){const sha=createHash('sha1').update(JSON.stringify(body)+ ++commitNumber).digest('hex');
    const row={sha,message:body.message+(f.trailingNewline?'\n':''),tree:{sha:body.tree},parents:body.parents.map(sha=>({sha}))};commits.set(sha,row);
    if(f.commitAckLost){f.commitAckLost=false;throw Error(SECRET);}return clone(row);}
   if(path.endsWith('/git/refs')){assert.equal(body.ref,REF);if(f.head||f.refNotApplied)throw Error(SECRET);f.head=body.sha;
    if(f.refAckLost){f.refAckLost=false;throw Error(SECRET);}return {ref:REF,object:{type:'commit',sha:f.head}};}
   if(path.endsWith('/deployments')){if(f.deploymentNotApplied)throw Error(SECRET);
    const row={id:deployments.length+1,environment:body.environment,sha:body.ref,creator:clone(f.actor),payload:clone(body.payload)};
    deployments.push(row);if(f.deploymentAckLost){f.deploymentAckLost=false;throw Error(SECRET);}return clone(row);}
   throw Error(SECRET);},
  async patch(path,body){writes.push({method:'PATCH',path,body:clone(body)});assert.equal(path,`/repos/${targets().repository}/git/${REF}`);
   assert.equal(body.force,false);if(f.closeNotApplied||commits.get(body.sha)?.parents[0]?.sha!==f.head)throw Error(SECRET);
   f.head=body.sha;if(f.patchAckLost){f.patchAckLost=false;throw Error(SECRET);}return {ref:REF,object:{type:'commit',sha:f.head}};},
 };
 const requestBody={operation:'supabase_cli_login_role',issuer:'https://api.supabase.com',projectRef:targets().supabaseProject,
  organizationId:'yxyxcenpgqutvoctrdkj',host:fcosConnectionIdentifier('supabase','Database session host'),port:5432,database:'postgres',
  role:'cli_login_postgres',method:'POST',path:`/v1/projects/${targets().supabaseProject}/cli/login-role`,body:{read_only:false}};
 f.request={...requestBody,requestDigest:digest(requestBody)};
 f.fetchImpl=async(url,options)=>{let body,status=201;
  if(url.endsWith('/database/query')){if(f.readError)throw Error(SECRET);f.preflights++;const request=JSON.parse(options.body);assert.equal(request.read_only,true);body=request.query===DATABASE_AUTH_RECONCILIATION_SQL?(f.reconcileRows||[f.role]):[f.role];}
  else if(url.endsWith('/cli/login-role')){f.issuerPosts++;body={role:'cli_login_postgres',password:SECRET,ttl_seconds:300};}
  else{status=200;body={id:targets().supabaseProject,name:'FCOS',status:'ACTIVE_HEALTHY',organization_id:'yxyxcenpgqutvoctrdkj'};}
  const response=new Response(JSON.stringify(body),{status});Object.defineProperty(response,'url',{value:url});return response;};
 f.input={directory,source,purpose:'controller_preview_bootstrap',credential:{kind:'supabase_management',token:SECRET},github,fetchImpl:f.fetchImpl};
 f.store=()=>createDatabaseCredentialIntentStore(f.input);
 f.receipt=intent=>{const issuedAtMs=Date.now();return {intentId:intent.intentId,requestDigest:intent.requestDigest,outcome:'received',
  issuer:'https://api.supabase.com',projectRef:targets().supabaseProject,role:'cli_login_postgres',ttlSeconds:300,issuedAtMs,expiresAtMs:issuedAtMs+300000};};
 f.state=()=>JSON.parse(commits.get(f.head).message);
 f.scopeEvidence=intent=>{const claim=f.state(),row={id:500,environment:DATABASE_SCOPE_EVIDENCE_ENVIRONMENT,sha:source.sha,creator:clone(f.actor),payload:{schemaVersion:1,kind:'fcos_database_auth_scope_observation',provenance:'owner_attested_native_dashboard',intentId:intent.intentId,requestDigest:intent.requestDigest,claimCommitSha:f.head,claimDigest:digest(claim),originalSourceSha:claim.sourceSha,reconciliationSourceSha:source.sha,projectRef:targets().supabaseProject,organizationId:f.request.organizationId,observedAt:new Date().toISOString(),evidenceDigest:'a'.repeat(64),token:{name:'FCOS CLI read-only recovery',existence:'verified_at_original_request',credentialHistory:'unchanged_since_original_request',projectRefs:[targets().supabaseProject],permissions:['database_read','project_settings_read'],scopeHistory:'immutable_since_creation',originalCredentialMatch:'private_keychain_mask_match'}}};f.observations.set(row.id,row);return row;};
 return f;
}

test('owner CAS chain closes only after bound native receipt and contains no private values',async t=>{
 const f=fixture(t),store=await f.store(),intent=await store.begin(f.request),claimHead=f.head;
 assert.equal(f.state().phase,'pending');assert.equal(f.deployments.length,1);
 await store.complete(f.receipt(intent));assert.equal(f.state().phase,'received');
 assert.equal(f.commits.get(f.head).parents[0].sha,claimHead);
 const second=await f.store(),next=await second.begin(f.request);await second.complete(f.receipt(next));
 assert.equal(f.deployments.length,4);assert.equal(f.writes.filter(x=>x.method==='PATCH').every(x=>x.body.force===false),true);
 const output=join(f.directory,'outputs/rapid-database-credentials');
 for(const file of readdirSync(output))assert.equal(readFileSync(join(output,file),'utf8').includes(SECRET),false);
 assert.equal(JSON.stringify(f.writes).includes(SECRET),false);
});
test('recording the issuer acknowledgement never unlocks a still-authenticating session',async t=>{
 const f=fixture(t),store=await f.store(),intent=await store.begin(f.request),receipt=f.receipt(intent);
 await store.received(receipt);assert.equal(f.state().phase,'pending');assert.equal(f.deployments.length,2);
 const concurrent=await f.store();await assert.rejects(concurrent.begin(f.request),/ORIGINAL_OPERATION_UNCERTAIN/);
 await store.complete(receipt);assert.equal(f.state().phase,'received');assert.equal(f.deployments.length,2);
});

test('two concurrent owner factories yield at most one fresh claim and one credential POST',async t=>{
 const f=fixture(t);f.armRace();const stores=await Promise.all([f.store(),f.store()]);
 class Client extends EventEmitter{
  constructor(config){super();const stream=new TLSSocket();stream.authorized=true;stream.servername=config.host;this.connection={stream};}
  async connect(){}
  async query(sql){return {rows:sql===DELEGATED_DATABASE_IDENTITY_SQL?[{...roleFacts(),session_user:'cli_login_postgres',current_user:'postgres',role_valid_until_ms:Date.now()+299000}]:[]};}
  async end(){this._ending=true;this.connection.stream.destroy();this.emit('end');}
 }
 const results=await Promise.allSettled(stores.map(intentStore=>openPinnedDatabase({credential:f.input.credential,caFile:'/dummy/public-ca.crt',intentStore,
  deps:{fetchImpl:f.fetchImpl,readFile:()=>Buffer.from(PUBLIC_CA),Client}})));
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.issuerPosts,1);
 for(const row of results)if(row.status==='fulfilled')await row.value.db.end();
});

test('two children of the same existing head cannot both fast-forward the native claim',async t=>{
 const f=fixture(t),first=await f.store(),initial=await first.begin(f.request);await first.complete(f.receipt(initial));
 f.armRace();const stores=await Promise.all([f.store(),f.store()]);
 const results=await Promise.allSettled(stores.map(store=>store.begin(f.request)));
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.state().phase,'pending');
});

test('lost applied claim/journal/close ACKs use exact readback without resubmission',async t=>{
 const f=fixture(t);f.refAckLost=true;f.deploymentAckLost=true;f.trailingNewline=true;
 const store=await f.store(),intent=await store.begin(f.request);f.patchAckLost=true;await store.complete(f.receipt(intent));
 assert.equal(f.state().phase,'received');assert.equal(f.deployments.length,2);
 assert.equal(f.writes.filter(x=>x.path.endsWith('/git/refs')).length,1);
 assert.equal(f.writes.filter(x=>x.method==='PATCH').length,1);
 assert.equal(f.writes.filter(x=>x.path.endsWith('/deployments')).length,2);
});

test('delayed exact ref visibility rechecks the original write without resubmitting',async t=>{
 const f=fixture(t),store=await f.store();
 f.exactRefReadbacks=[null];
 const intent=await store.begin(f.request),claim=f.head;
 f.exactRefReadbacks=[claim];
 await store.complete(f.receipt(intent));
 assert.equal(f.state().phase,'received');
 assert.equal(f.writes.filter(x=>x.path.endsWith('/git/refs')).length,1);
 assert.equal(f.writes.filter(x=>x.method==='PATCH').length,1);
 assert.equal(f.deployments.length,2);
});

test('an unexpected journal ref cannot acknowledge a different claim',async t=>{
 const f=fixture(t),store=await f.store();
 f.exactRefReadbacks=['e'.repeat(40)];
 await assert.rejects(store.begin(f.request),/CLAIM_ACK_UNKNOWN/);
 assert.equal(f.writes.filter(x=>x.path.endsWith('/git/refs')).length,1);
 assert.equal(f.deployments.length,0);
 assert.equal(f.issuerPosts,0);
});

test('unknown commit creation stops before ref claim or credential issuance',async t=>{
 const f=fixture(t);f.commitAckLost=true;const store=await f.store();
 await assert.rejects(store.begin(f.request),error=>error.message==='DATABASE_AUTH_COMMIT_ACK_UNKNOWN'&&!String(error).includes(SECRET));
 assert.equal(f.head,null);assert.equal(f.deployments.length,0);assert.equal(f.issuerPosts,0);
 assert.equal(f.writes.length,1);
});

test('unacknowledged claim or journal never becomes a second submission ticket',async t=>{
 for(const failure of ['refNotApplied','deploymentNotApplied']){
  const f=fixture(t);f[failure]=true;const store=await f.store();await assert.rejects(store.begin(f.request),/ACK_UNKNOWN/);
  assert.equal(f.issuerPosts,0);
  if(f.head){const count=f.writes.length;const resumed=await f.store();await assert.rejects(resumed.begin(f.request),/ORIGINAL_OPERATION_UNCERTAIN/);assert.equal(f.writes.length,count);}
 }
});

test('a received Deployment cannot clear pending Git ownership when completion CAS is unknown',async t=>{
 const f=fixture(t),store=await f.store(),intent=await store.begin(f.request);f.closeNotApplied=true;
 await assert.rejects(store.complete(f.receipt(intent)),/CLAIM_ACK_UNKNOWN/);assert.equal(f.state().phase,'pending');assert.equal(f.deployments.length,2);
 const count=f.writes.length,resumed=await f.store();await assert.rejects(resumed.begin(f.request),/ORIGINAL_OPERATION_UNCERTAIN/);assert.equal(f.writes.length,count);
});

test('mismatched source/digest/purpose/creator/environment/receipt cannot close another intent',async t=>{
 const mutations=[row=>{row.payload.requestDigest='b'.repeat(64);row.payload.receipt.requestDigest='b'.repeat(64);},
  row=>{row.payload.sourceSha='b'.repeat(40);row.sha=row.payload.sourceSha;},row=>{row.payload.purpose='different_purpose';},
  row=>{row.creator.id=456;},row=>{row.environment='other';},row=>{row.payload.receipt.projectRef='other';},
  row=>{row.payload.receipt.ttlSeconds=3601;},row=>{row.payload.receipt.password=SECRET;}];
 for(const mutate of mutations){const f=fixture(t),store=await f.store(),intent=await store.begin(f.request);await store.complete(f.receipt(intent));
  mutate(f.deployments[1]);const count=f.writes.length,resumed=await f.store();
  await assert.rejects(resumed.begin(f.request),error=>/^DATABASE_AUTH_/.test(error.message)&&!String(error).includes(SECRET));assert.equal(f.writes.length,count);}
});

test('full managed-role validation happens before claim/journal and creates no false unknown',async t=>{
 for(const patch of [{can_login:false},{is_superuser:true},{memberships:[]},{memberships:[null]},
  {memberships:[{role:'postgres',grantor:'postgres',set:true,inherit:false,admin:false}]}]){
  const f=fixture(t);f.role={...f.role,...patch};const store=await f.store();await assert.rejects(store.begin(f.request),/ROLE_PREFLIGHT_INVALID/);
  assert.equal(f.writes.length,0);assert.equal(f.head,null);assert.equal(f.deployments.length,0);
  f.role=roleFacts();const fresh=await f.store();assert.equal((await fresh.begin(f.request)).state,'fresh');
 }
 assert.equal(isManagedDatabaseRole({...roleFacts(),memberships:[null]}),false);
});

test('owner identity and push capability are required; ordinary bot is refused before preflight',async t=>{
 for(const change of [f=>{f.actor={id:41898282,login:'github-actions[bot]'};},f=>{f.repository.permissions.push=false;}]){
  const f=fixture(t);change(f);await assert.rejects(f.store(),/OWNER_GITHUB_REQUIRED/);assert.equal(f.preflights,0);assert.equal(f.writes.length,0);}
 const source=readFileSync(new URL('../scripts/lib/rapid-release/database-intent.mjs',import.meta.url),'utf8');
 assert.equal(source.includes('process.env.GITHUB_TOKEN'),false);
});

test('private receipt fields and changed source are refused without acquiring authority',async t=>{
 const f=fixture(t),store=await f.store(),intent=await store.begin(f.request);
 await assert.rejects(store.complete({...f.receipt(intent),password:SECRET}),/RECEIPT_REFUSED/);
 await store.uncertain({intentId:intent.intentId,requestDigest:intent.requestDigest});assert.equal(f.state().phase,'pending');
 writeFileSync(join(f.directory,'source.txt'),'changed');await assert.rejects(f.store(),/FROZEN_SOURCE_REQUIRED/);
});

test('owner-attested scope denial appends a distinct terminal child and never rewrites the unknown request as received',async t=>{
 const f=fixture(t),store=await f.store(),intent=await store.begin(f.request),original=f.head,observation=f.scopeEvidence(intent);
 await store.uncertain({intentId:intent.intentId,requestDigest:intent.requestDigest});
 const recovery=await f.store(),result=await recovery.reconcileDeniedByScope({intentId:intent.intentId,evidenceDeploymentId:observation.id});
 assert.equal(result.state,'denied_by_scope');assert.equal(f.state().receipt.httpOutcome,'unobserved');assert.equal(f.state().receipt.httpStatus,undefined);
 assert.equal(f.state().phase,'denied_by_scope');assert.deepEqual(f.state().pending,JSON.parse(f.commits.get(original).message));
 assert.equal(f.commits.get(f.head).parents[0].sha,original);assert.equal(f.deployments.at(-1).payload.event,'denied_by_scope');
 assert.equal(f.deployments.some(row=>row.payload.event==='received'),false);assert.equal(f.issuerPosts,0);
 const writes=f.writes.length,resume=await f.store();assert.equal((await resume.reconcileDeniedByScope({intentId:intent.intentId,evidenceDeploymentId:observation.id})).reused,true);assert.equal(f.writes.length,writes);
 assert.equal((await (await f.store()).begin(f.request)).state,'fresh');
 assert.notEqual(DATABASE_AUTH_RECONCILIATION_SQL,MANAGED_DATABASE_ROLE_SQL);assert.match(DATABASE_AUTH_RECONCILIATION_SQL,/starts_with\(r.rolname,'cli_login'\)/);
 assert.equal(JSON.stringify(f.writes).includes(SECRET),false);
});

test('scope evidence must be a native owner Deployment with exact original request, project, immutable scope and credential history',async t=>{
 const mutations=[r=>{r.creator={id:41898282,login:'github-actions[bot]'};},r=>{r.sha='f'.repeat(40);},r=>{r.environment='Preview';},
  r=>{r.payload.requestDigest='0'.repeat(64);},r=>{r.payload.claimCommitSha='f'.repeat(40);},r=>{r.payload.originalSourceSha='f'.repeat(40);},
  r=>{r.payload.projectRef='different';},r=>{r.payload.token.permissions.push('database_write');},r=>{r.payload.token.projectRefs.push('different');},
  r=>{r.payload.token.scopeHistory='currently_readonly';},r=>{r.payload.token.credentialHistory='unknown';},r=>{r.payload.provenance='native_api_introspection';}];
 for(const mutate of mutations){const f=fixture(t),intent=await (await f.store()).begin(f.request),e=f.scopeEvidence(intent);mutate(e);const before=f.writes.length;
  await assert.rejects((await f.store()).reconcileDeniedByScope({intentId:intent.intentId,evidenceDeploymentId:e.id}),/SCOPE_EVIDENCE_REQUIRED/);assert.equal(f.writes.length,before);assert.equal(f.state().phase,'pending');}
 const f=fixture(t),intent=await (await f.store()).begin(f.request);f.scopeEvidence(intent);
 await assert.rejects((await f.store()).reconcileDeniedByScope({intentId:intent.intentId,evidenceDeploymentId:{verified:true,id:500}}),/RECONCILIATION_REFUSED/);
});

test('unchanged expired native role and no unknown or eligible active CLI login are mandatory before reconciliation writes',async t=>{
 for(const change of [f=>{f.role.role_valid_until_ms=Date.now()+300000;},f=>{f.role.role_valid_until_ms-=1000;},
  f=>{f.reconcileRows=[f.role,{...f.role,login_role:'cli_login_postgres_unique',role_valid_until_ms:Date.now()+300000}];},
  f=>{f.reconcileRows=[f.role,{...f.role,login_role:'cli_login_unknown',memberships:[]}];},f=>{f.role.current_user='postgres';}]){
  const f=fixture(t),intent=await (await f.store()).begin(f.request),e=f.scopeEvidence(intent);change(f);const before=f.writes.length;
  await assert.rejects((await f.store()).reconcileDeniedByScope({intentId:intent.intentId,evidenceDeploymentId:e.id}),/ACTIVE_OR_UNKNOWN_LOGIN_ROLE|ORIGINAL_ROLE_CHANGED/);
  assert.equal(f.writes.length,before);assert.equal(f.issuerPosts,0);
 }
 const f=fixture(t),intent=await (await f.store()).begin(f.request),e=f.scopeEvidence(intent);f.readError=true;
 await assert.rejects((await f.store()).reconcileDeniedByScope({intentId:intent.intentId,evidenceDeploymentId:e.id}),error=>error.message==='DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE'&&!String(error).includes(SECRET));
});

test('terminal closure races have one CAS winner and missing or uncertain publication never submits again even from another operator directory',async t=>{
 const f=fixture(t),intent=await (await f.store()).begin(f.request),e=f.scopeEvidence(intent);
 const other=mkdtempSync(join(tmpdir(),'fcos-auth-other-'));t.after(()=>rmSync(other,{recursive:true,force:true}));execFileSync('git',['clone','--local',f.directory,other],{stdio:['ignore','pipe','pipe']});
 const stores=await Promise.all([f.store(),createDatabaseCredentialIntentStore({...f.input,directory:other})]);f.armRace();
 const result=await Promise.allSettled(stores.map(store=>store.reconcileDeniedByScope({intentId:intent.intentId,evidenceDeploymentId:e.id})));
 assert.equal(result.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.deployments.filter(row=>row.payload.event==='denied_by_scope').length,1);assert.equal(f.issuerPosts,0);
 const lost=fixture(t),i=await (await lost.store()).begin(lost.request),evidence=lost.scopeEvidence(i);lost.deploymentNotApplied=true;
 await assert.rejects((await lost.store()).reconcileDeniedByScope({intentId:i.intentId,evidenceDeploymentId:evidence.id}),/ACK_UNKNOWN/);assert.equal(lost.state().phase,'denied_by_scope');
 const elsewhere=mkdtempSync(join(tmpdir(),'fcos-auth-lost-other-'));t.after(()=>rmSync(elsewhere,{recursive:true,force:true}));execFileSync('git',['clone','--local',lost.directory,elsewhere],{stdio:['ignore','pipe','pipe']});
 const before=lost.writes.length;await assert.rejects((await createDatabaseCredentialIntentStore({...lost.input,directory:elsewhere})).reconcileDeniedByScope({intentId:i.intentId,evidenceDeploymentId:evidence.id}),/TERMINAL_PUBLICATION_UNCERTAIN/);
 await assert.rejects((await lost.store()).begin(lost.request),/ORIGINAL_OPERATION_UNCERTAIN/);assert.equal(lost.writes.length,before);
});

test('terminal resume rechecks the immutable owner evidence and original claim without imposing a new observation timestamp',async t=>{
 const f=fixture(t),intent=await (await f.store()).begin(f.request),e=f.scopeEvidence(intent);await (await f.store()).reconcileDeniedByScope({intentId:intent.intentId,evidenceDeploymentId:e.id});
 const before=f.writes.length;e.payload.token.permissions.push('database_write');
 await assert.rejects((await f.store()).reconcileDeniedByScope({intentId:intent.intentId,evidenceDeploymentId:e.id}),/SCOPE_EVIDENCE_REQUIRED/);
 await assert.rejects((await f.store()).begin(f.request),/SCOPE_EVIDENCE_REQUIRED/);assert.equal(f.writes.length,before);
});

test('native 401 or 403 rejection is distinct from scope reconstruction and closes only the auth CAS',async t=>{
 for(const status of [401,403]){const f=fixture(t),store=await f.store(),intent=await store.begin(f.request);
  await store.rejected({intentId:intent.intentId,requestDigest:intent.requestDigest,outcome:'rejected',issuer:'https://api.supabase.com',projectRef:targets().supabaseProject,httpStatus:status,observedAtMs:Date.now()});
  assert.equal(f.state().phase,'rejected');assert.equal(f.state().receipt.httpStatus,status);assert.equal((await (await f.store()).begin(f.request)).state,'fresh');}
 const f=fixture(t),store=await f.store(),intent=await store.begin(f.request);await assert.rejects(store.rejected({intentId:intent.intentId,requestDigest:intent.requestDigest,outcome:'rejected',issuer:'https://api.supabase.com',projectRef:targets().supabaseProject,httpStatus:400,observedAtMs:Date.now()}),/RECEIPT_REFUSED/);
});


async function claimWithoutIntent(t, { publishIntent=false } = {}) {
 const f=fixture(t),store=await f.store(),first=await store.begin(f.request);
 const receipt=f.receipt(first);
 receipt.ttlSeconds=1;
 receipt.expiresAtMs=receipt.issuedAtMs+1000;
 await store.complete(receipt);
 f.role.role_valid_until_ms=receipt.expiresAtMs;
 const later=receipt.expiresAtMs+2000;
 f.role.server_now_ms=later;
 f.input.now=()=>later;
 const next=await f.store();
 if(publishIntent)await next.begin(f.request);
 else{
  f.exactRefReadbacks=['e'.repeat(40)];
  await assert.rejects(next.begin(f.request),/CLAIM_ACK_UNKNOWN/);
 }
 const claim=f.state(),claimSha=f.head;
 const payload={schemaVersion:1,kind:'fcos_database_auth_unsubmitted_observation',
  provenance:'owner_attested_terminal_before_intent',intentId:claim.intentId,requestDigest:claim.requestDigest,
  claimCommitSha:claimSha,claimDigest:digest(claim),originalSourceSha:claim.sourceSha,reconciliationSourceSha:f.source.sha,
  projectRef:claim.request.projectRef,organizationId:claim.request.organizationId,observedAt:new Date(later).toISOString(),
  evidenceDigest:'a'.repeat(64),roleExpiresAtMs:f.role.role_valid_until_ms};
 const evidence={id:900,environment:DATABASE_UNSUBMITTED_EVIDENCE_ENVIRONMENT,sha:f.source.sha,creator:clone(f.actor),payload};
 f.observations.set(evidence.id,evidence);
 return {f,claim,claimSha,evidence,args:{intentId:claim.intentId,evidenceDeploymentId:evidence.id}};
}

test('unsubmitted claim closes as a native child and permits a fresh independently checked operation',async t=>{
 const {f,claim,claimSha,args}=await claimWithoutIntent(t);
 // PostgreSQL returns an epoch with submillisecond precision.
 f.role.role_valid_until_ms+=0.02;
 const result=await (await f.store()).reconcileUnsubmitted(args);
 assert.equal(result.state,'unsubmitted');
 assert.equal(f.state().phase,'unsubmitted');
 assert.deepEqual(f.state().pending,claim);
 assert.equal(f.commits.get(f.head).parents[0].sha,claimSha);
 assert.deepEqual(f.deployments.map(row=>row.payload.event),['intent','received','unsubmitted']);
 assert.equal(f.issuerPosts,0);
 const writes=f.writes.length;
 assert.equal((await (await f.store()).reconcileUnsubmitted(args)).reused,true);
 assert.equal(f.writes.length,writes);
 const next=await (await f.store()).begin(f.request);
 assert.notEqual(next.intentId,claim.intentId);
 assert.equal(f.issuerPosts,0);
});

test('unsubmitted recovery refuses any published intent, mismatched attestation, or changed login expiry',async t=>{
 const issued=await claimWithoutIntent(t,{publishIntent:true});
 const before=issued.f.writes.length;
 await assert.rejects((await issued.f.store()).reconcileUnsubmitted(issued.args),/ORIGINAL_OPERATION_UNCERTAIN/);
 assert.equal(issued.f.writes.length,before);
 for(const change of [
  (f,evidence)=>{evidence.creator.id++;},
  (f,evidence)=>{evidence.payload.claimCommitSha='f'.repeat(40);},
  f=>{f.role.role_valid_until_ms=f.role.server_now_ms-10;},
  f=>{f.reconcileRows=[f.role,{...f.role,login_role:'cli_login_other'}];},
 ]){
  const {f,evidence,args}=await claimWithoutIntent(t);
  change(f,evidence);
  const writes=f.writes.length;
  await assert.rejects((await f.store()).reconcileUnsubmitted(args),/UNSUBMITTED_EVIDENCE_REQUIRED|ORIGINAL_ROLE_CHANGED/);
  assert.equal(f.writes.length,writes);
  assert.equal(f.issuerPosts,0);
 }
});

test('unsubmitted recovery reserves one terminal child even if the original journal publication is uncertain',async t=>{
 const {f,args}=await claimWithoutIntent(t);
 f.deploymentNotApplied=true;
 await assert.rejects((await f.store()).reconcileUnsubmitted(args),/ACK_UNKNOWN/);
 assert.equal(f.state().phase,'unsubmitted');
 const writes=f.writes.length;
 await assert.rejects((await f.store()).reconcileUnsubmitted(args),/TERMINAL_PUBLICATION_UNCERTAIN/);
 await assert.rejects((await f.store()).begin(f.request),/NATIVE_CLOSURE_INVALID/);
 assert.equal(f.writes.length,writes);
 assert.equal(f.issuerPosts,0);
});
