import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDatabaseCredentialIntentStore } from '../scripts/lib/rapid-release/database-intent.mjs';

const secret='synthetic-management-token-never-persist';
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'fcos-auth-intent-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-b','main']);writeFileSync(join(directory,'source.txt'),'frozen');git(['add','source.txt']);
  git(['-c','user.name=FCOS Test','-c','user.email=test@example.invalid','commit','-m','fixture']);
  const source={sha:git(['rev-parse','HEAD'])},records=[],requests=[];
  const actor={id:123,login:'hocheunglai-oss'};
  const github={read:async path=>path==='/user'?actor:{full_name:'hocheunglai-oss/fcos',archived:false},
    pages:async()=>records,
    write:async(path,body)=>{const row={id:records.length+1,sha:body.ref,creator:actor,payload:body.payload};records.push(row);return row;}};
  const fetchImpl=async(url,options)=>{requests.push({url,options});return {status:201,url,redirected:false,json:async()=>[
    {session_user:'supabase_read_only_user',current_user:'supabase_read_only_user',database:'postgres',login_role:'cli_login_postgres',memberships:[]} ]};};
  const input={directory,source,purpose:'controller_preview_bootstrap',credential:{kind:'supabase_management',token:secret},github,fetchImpl};
  const request={projectRef:'pjforfvchygdyqfcgpmw',method:'POST',role:'cli_login_postgres',body:{read_only:false},requestDigest:'a'.repeat(64)};
  return {input,records,requests,request,directory};
}
test('native catalog read precedes durable intent; only nonsecret acknowledgement closes it',async t=>{
  const f=fixture(t),store=await createDatabaseCredentialIntentStore(f.input),intent=await store.begin(f.request);
  assert.equal(f.requests.length,1);assert.equal(JSON.parse(f.requests[0].options.body).read_only,true);
  assert.equal(intent.state,'fresh');assert.equal(f.records[0].payload.event,'intent');
  await store.complete({intentId:intent.intentId,requestDigest:intent.requestDigest,outcome:'received',issuer:'https://api.supabase.com',
    projectRef:f.request.projectRef,role:'cli_login_postgres',ttlSeconds:60,issuedAtMs:100,expiresAtMs:60100});
  assert.equal(f.records[1].payload.event,'received');
  const dir=join(f.directory,'outputs/rapid-database-credentials');
  for(const file of readdirSync(dir))assert.equal(readFileSync(join(dir,file),'utf8').includes(secret),false);
  assert.equal(JSON.stringify(f.records).includes(secret),false);
});
test('lost journal acknowledgement preserves original intent and refuses another issuance',async t=>{
  const f=fixture(t),write=f.input.github.write;
  f.input.github.write=async(...args)=>{await write(...args);throw Error('lost ack');};
  const store=await createDatabaseCredentialIntentStore(f.input);
  await assert.rejects(store.begin(f.request),/lost ack/);
  const resumed=await createDatabaseCredentialIntentStore(f.input);
  await assert.rejects(resumed.begin(f.request),/ORIGINAL_OPERATION_UNCERTAIN/);
  assert.equal(f.requests.length,1);assert.equal(f.records.length,1);
});
test('changed controller and wrong native project identity fail before issuance intent',async t=>{
  const f=fixture(t);writeFileSync(join(f.directory,'source.txt'),'changed');
  await assert.rejects(createDatabaseCredentialIntentStore(f.input),/FROZEN_SOURCE_REQUIRED/);
  assert.equal(f.records.length,0);assert.equal(f.requests.length,0);
});
test('private values and unbound outcomes cannot enter completion records',async t=>{
  const f=fixture(t),store=await createDatabaseCredentialIntentStore(f.input),intent=await store.begin(f.request);
  await assert.rejects(store.complete({intentId:intent.intentId,requestDigest:intent.requestDigest,outcome:'received',password:secret}),/RECEIPT_REFUSED/);
  await store.uncertain({intentId:intent.intentId,requestDigest:intent.requestDigest});
  assert.equal(f.records.length,1);
});
