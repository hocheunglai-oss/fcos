import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BACKEND_RSS_ROUTE, BACKEND_IDENTITY_SQL, startBackendRssTransport, parseBackendRss, validateBackendRssRequest } from '../scripts/lib/hosted-release/backend-rss.mjs';
import { MIGRATION_SERVER_IDENTITY_SQL, MIGRATION_STANDARD_ROLES } from '../scripts/lib/migration-verification.mjs';
import { isolatedCandidateRunner } from '../scripts/lib/hosted-release/isolation.mjs';
import { backendRssSampler } from './helpers/backendRss.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const source = { controllerSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40) };
const identity = { address:'172.17.0.2', database:'postgres', dataDirectory:'/var/lib/postgresql/data',
  serverStartedAt:'2026-10-24T00:00:00.000001Z', systemIdentifier:'123456789', currentUser:'postgres',sessionUser:'postgres',roleSetting:'none' };
const request = { pid:123, database:`fcos_payment_ref_${'c'.repeat(32)}`, backendStartedAt:'2026-10-24T00:00:01.000001Z' };
const processText = (start = '12345') => `postgres\n123 (postgres) S ${Array(18).fill('0').join(' ')} ${start} 0\nName:\tpostgres\nVmRSS:\t12345 kB\n`;
function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(),'fcos-rss-test-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'output'));
  const proof = {kind:'fcos_disposable_migration_parent_proof_v1',schemaVersion:1,projectId:'fcos',
    container:{name:'supabase_db_fcos',id:'d'.repeat(64)},url:{hostname:'127.0.0.1',port:54322,username:'postgres',database:'postgres'},
    identity,roles:MIGRATION_STANDARD_ROLES,source};
  const bytes=JSON.stringify(proof);writeFileSync(join(root,'output/disposable-migration-server.json'),bytes,{mode:0o444});
  const calls=[];let executes=0;
  const client={connect:async()=>{},end:async()=>{calls.push('end');},query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql===MIGRATION_SERVER_IDENTITY_SQL)return {rows:[identity]};
    if(sql.startsWith('select rolname'))return {rows:MIGRATION_STANDARD_ROLES.map(rolname=>({rolname}))};
    return {rows:[{...request,usename:'postgres',backend_type:'client backend',serverStartedAt:identity.serverStartedAt,...options.activity}]};
  }};
  return {root,proof,calls,get executes(){return executes;},args:{controllerDirectory:root,...source,checkId:'financial_preview',proofSha256:sha(bytes),client,
    verifyServer:()=>({transport:'local-docker',containerId:proof.container.id,endpoint:'unix:///verified.sock'}),
    execute:async(program,args)=>{executes++;assert.equal(program,'docker');assert.deepEqual(args,['--host','unix:///verified.sock','exec',proof.container.id,'cat','/proc/123/comm','/proc/123/stat','/proc/123/status']);return {stdout:processText(options.changeStart&&executes>1?'99999':'12345')};}}};
}
async function transport(t, f) {const value=await startBackendRssTransport(f.args);t.after(()=>value.close());return value;}
function url(value, patch={}) {const target=new URL(value.env.FCOS_BACKEND_RSS_ENDPOINT);for(const [k,v]of Object.entries({...request,...patch}))target.searchParams.set(k,v);return target;}

test('parent samples exact verified backend over loopback, returning only bounded public metrics',async t=>{
  const f=fixture(t),p=await transport(t,f),response=await fetch(url(p)),value=await response.json();
  assert.equal(response.status,200);assert.equal(value.rssKiB,12345);assert.equal(value.processStartedAt,'12345');
  assert.deepEqual(value.source,source);assert.equal(f.executes,1);assert.equal(JSON.stringify(value).includes('/proc/'),false);
  assert.equal(f.calls.filter(x=>x.sql?.includes('pg_stat_activity')).length,2);
  assert.ok(f.calls.every(x=>!x.sql?.includes('pg_read_file')));
});
test('parent rejects wrong database, malformed PID and arbitrary route/method before process reads',async t=>{
  const f=fixture(t),p=await transport(t,f);
  for(const target of [url(p,{pid:'123;cat'}),url(p,{database:'postgres'}),new URL('/arbitrary',p.env.FCOS_BACKEND_RSS_ENDPOINT)])assert.equal((await fetch(target)).status,503);
  assert.equal((await fetch(url(p),{method:'POST'})).status,503);assert.equal(f.executes,0);
});
test('parent refuses stale backend start and wrong PostgreSQL role before process reads',async t=>{
  for(const activity of [{backendStartedAt:'2026-10-24T00:00:02.000001Z'},{usename:'foreign'}]){
    const f=fixture(t,{activity}),p=await transport(t,f);assert.equal((await fetch(url(p))).status,503);assert.equal(f.executes,0);
  }
});
test('parent refuses process PID reuse after first sample',async t=>{
  const f=fixture(t,{changeStart:true}),p=await transport(t,f);
  assert.equal((await fetch(url(p))).status,200);assert.equal((await fetch(url(p))).status,503);
});
test('changed proof/source/container or missing proof refuses before exposing endpoint',async t=>{
  for(const patch of [{proofSha256:'e'.repeat(64)},{candidateSha:'f'.repeat(40)},
    {verifyServer:()=>({transport:'local-docker',containerId:'e'.repeat(64),endpoint:'unix:///verified.sock'})}]){
    const f=fixture(t);await assert.rejects(startBackendRssTransport({...f.args,...patch}));assert.equal(f.executes,0);
  }
});
test('process parser and request validator reject non-PostgreSQL, missing RSS, startticks and invalid request fields',()=>{
  for(const text of [processText().replace('postgres\n','node\n'),processText().replace('VmRSS:', 'Other:'),processText('0')])assert.throws(()=>parseBackendRss(text,123));
  for(const patch of [{pid:0},{pid:1.5},{database:'postgres'},{backendStartedAt:'yesterday'},{extra:'path'}])assert.throws(()=>validateBackendRssRequest({...request,...patch},'financial_preview'));
});
test('hosted candidate reader verifies same-session identity, proof/source and current metrics',async t=>{
  const f=fixture(t),p=await transport(t,f);
  const read=await backendRssSampler(123,'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    {query:async sql=>{assert.equal(sql,BACKEND_IDENTITY_SQL);return {rows:[{...request,address:identity.address,serverStartedAt:identity.serverStartedAt}]};}},
    {env:p.env,loadProof:()=>f.proof});
  assert.equal(await read(),12345);assert.equal(await read(),12345);
});
test('hosted reader fails closed on unavailable/malformed/stale/wrong-source metrics without local fallback',async()=>{
  const proof={source,identity},env={FCOS_HOSTED_CHECK_EXECUTION:'1',FCOS_BACKEND_RSS_ENDPOINT:`http://127.0.0.1:12345${BACKEND_RSS_ROUTE}`,FCOS_BACKEND_RSS_CHECK_ID:'financial_preview',
    FCOS_CONTROLLER_SHA:source.controllerSha,FCOS_CANDIDATE_SHA:source.candidateSha,FCOS_MIGRATION_PARENT_PROOF_SHA256:'d'.repeat(64)};
  const client={query:async()=>({rows:[{...request,address:identity.address,serverStartedAt:identity.serverStartedAt}]})};
  const valid={kind:'fcos_disposable_backend_rss_v1',...request,processStartedAt:'12345',rssKiB:12345,observedAt:new Date().toISOString(),checkId:'financial_preview',source,proofSha256:env.FCOS_MIGRATION_PARENT_PROOF_SHA256};
  for(const patch of [{source:{...source,candidateSha:'f'.repeat(40)}},{observedAt:'2000-01-01T00:00:00Z'},{rssKiB:null},{processStartedAt:'0'}]){
    const read=await backendRssSampler(123,'unused',client,{env,loadProof:()=>proof,fetchImpl:async()=>new Response(JSON.stringify({...valid,...patch}))});await assert.rejects(read());
  }
  await assert.rejects(backendRssSampler(123,'unused',client,{env:{FCOS_HOSTED_CHECK_EXECUTION:'1'},loadProof:()=>proof}));
  const read=await backendRssSampler(123,'unused',client,{env,loadProof:()=>proof,fetchImpl:async()=>{throw Error('unavailable');}});await assert.rejects(read());
  const oversized=await backendRssSampler(123,'unused',client,{env,loadProof:()=>proof,fetchImpl:async()=>new Response('x'.repeat(4097))});await assert.rejects(oversized());
});
test('transport loss after a successful baseline rejects the next in-workload sample',async t=>{
  const f=fixture(t),p=await transport(t,f);
  const read=await backendRssSampler(123,'unused',{query:async()=>({rows:[{...request,address:identity.address,serverStartedAt:identity.serverStartedAt}]})},
    {env:p.env,loadProof:()=>f.proof});
  assert.equal(await read(),12345);
  f.args.client.query=async()=>({rows:[]});
  let complete=false;const workload=new Promise(resolve=>setTimeout(()=>{complete=true;resolve();},100));
  await assert.rejects(read());assert.equal(complete,false);await workload;
});
test('isolated runner keeps non-RSS checks synchronous and closes RSS transport after actual asynchronous child close',async t=>{
  const root=mkdtempSync(join(tmpdir(),'fcos-rss-runner-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const candidate=join(root,'candidate'),controller=join(root,'controller');mkdirSync(candidate);mkdirSync(controller);
  let closed=0,started=0,sync=0;
  const runner=isolatedCandidateRunner({image:`ghcr.io/hocheunglai-oss/fcos-release-checks@sha256:${'d'.repeat(64)}`,candidateDirectory:candidate,controllerDirectory:controller,
    spawn:()=>{sync++;return {status:0};},startRss:async()=>({env:{FCOS_HOSTED_CHECK_EXECUTION:'1'},dockerEndpoint:'unix:///verified.sock',close:async()=>{closed++;}}),
    asynchronousSpawn:(_program,args)=>{started++;assert.deepEqual(args.slice(0,2),['--host','unix:///verified.sock']);assert.ok(!args.join(' ').includes('docker.sock'));const child=new EventEmitter();setImmediate(()=>child.emit('close',0,null));return child;}});
  assert.equal(runner('node',[],{env:{},checkId:'unit'}).status,0);assert.equal(sync,1);
  assert.equal((await runner('node',[],{env:{},checkId:'financial_preview',...source})).status,0);assert.equal(started,1);assert.equal(closed,1);
});
