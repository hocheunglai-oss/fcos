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
import { createDatabaseCredentialIntentStore } from '../scripts/lib/rapid-release/database-intent.mjs';
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
 const f={directory,source,commits,deployments,writes,head:null,role:roleFacts(),preflights:0,issuerPosts:0,
  actor:{id:123,login:targets().account},repository:{full_name:targets().repository,archived:false,permissions:{push:true}}};
 let commitNumber=0,gate;
 f.armRace=()=>{let release;gate={seen:0,promise:new Promise(resolve=>{release=resolve;}),release};};
 const github={
  async read(path){if(path==='/user')return clone(f.actor);if(path===`/repos/${targets().repository}`)return clone(f.repository);
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
  if(url.endsWith('/database/query')){f.preflights++;assert.equal(JSON.parse(options.body).read_only,true);body=[f.role];}
  else if(url.endsWith('/cli/login-role')){f.issuerPosts++;body={role:'cli_login_postgres',password:SECRET,ttl_seconds:300};}
  else{status=200;body={id:targets().supabaseProject,name:'FCOS',status:'ACTIVE_HEALTHY',organization_id:'yxyxcenpgqutvoctrdkj'};}
  const response=new Response(JSON.stringify(body),{status});Object.defineProperty(response,'url',{value:url});return response;};
 f.input={directory,source,purpose:'controller_preview_bootstrap',credential:{kind:'supabase_management',token:SECRET},github,fetchImpl:f.fetchImpl};
 f.store=()=>createDatabaseCredentialIntentStore(f.input);
 f.receipt=intent=>{const issuedAtMs=Date.now();return {intentId:intent.intentId,requestDigest:intent.requestDigest,outcome:'received',
  issuer:'https://api.supabase.com',projectRef:targets().supabaseProject,role:'cli_login_postgres',ttlSeconds:300,issuedAtMs,expiresAtMs:issuedAtMs+300000};};
 f.state=()=>JSON.parse(commits.get(f.head).message);
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
