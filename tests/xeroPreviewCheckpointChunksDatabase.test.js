import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import pg from 'pg';

const nativeUrl = process.env.FCOS_CHECKPOINT_TEST_DATABASE_URL || process.env.FCOS_CAMPAIGN_TEST_DATABASE_URL;
if (process.env.FCOS_REQUIRE_LIVE_CHECKPOINT_CHUNK_CHECK === '1' && !nativeUrl) {
  throw new Error('A loopback native PostgreSQL URL is required for the checkpoint chunk gate');
}
const actor = '00000000-0000-4000-8000-000000000099';
const otherActor = '00000000-0000-4000-8000-000000000098';
const tenant = '00000000-0000-4000-8000-000000000001';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const text = value => JSON.stringify(canonical(value));
const partLimit = 256 * 1024;
const denied = ['accesstoken','refreshtoken','idtoken','authorization','password','clientsecret','apikey','secretkey',
  'servicerolekey','sessiontoken','cookie','setcookie','bearertoken','privatekey','connection','env','client','actorauth'];

async function backendRssSampler(pid, connectionUrl) {
  const run = promisify(execFile);
  const port = new URL(connectionUrl).port || '5432';
  // Supabase CI runs PostgreSQL in a PID namespace. Match the exact published
  // loopback database port before reading that backend inside its container.
  const candidates = await run('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.ID}}'])
    .then(result => result.stdout.trim().split(/\s+/).filter(Boolean), () => []);
  const matches = [];
  for (const id of candidates) {
    const inspected = JSON.parse((await run('docker', ['inspect', id])).stdout)[0];
    if ((inspected.NetworkSettings?.Ports?.['5432/tcp'] || []).some(binding => binding.HostPort === port)) matches.push(id);
  }
  assert.ok(matches.length <= 1, 'The disposable database port must identify one container');
  if (matches.length) {
    const id = matches[0];
    assert.equal((await run('docker', ['exec', id, 'cat', `/proc/${pid}/comm`])).stdout.trim(), 'postgres');
    return async () => {
      const status = (await run('docker', ['exec', id, 'cat', `/proc/${pid}/status`])).stdout;
      const value = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
      assert.ok(value > 0, 'The PostgreSQL backend RSS must be measurable');
      return value;
    };
  }
  const command = (await run('/bin/ps', ['-o', 'comm=', '-p', String(pid)])).stdout.trim();
  assert.match(command, /(^|\/)postgres(?:$|\s|:)/, 'The measured host process must be PostgreSQL');
  return async () => {
    const value = Number((await run('/bin/ps', ['-o', 'rss=', '-p', String(pid)])).stdout.trim());
    assert.ok(value > 0, 'The PostgreSQL backend RSS must be measurable');
    return value;
  };
}

// An independent native-test fixture writer for the public manifest contract.
function encode(payload) {
  const chunks = [];
  const leaf = value => {
    const payloadText = text(value); assert.ok(Buffer.byteLength(payloadText) <= partLimit);
    const ordinal = chunks.length; chunks.push({ ordinal, payloadText, payloadHash: hash(payloadText) });
    return { type: 'value', ordinal };
  };
  const node = (value, forceObject = false) => {
    if (!forceObject && Buffer.byteLength(text(value)) <= partLimit) return leaf(value);
    if (Array.isArray(value)) {
      const entries = []; let group = [], bytes = 2, offset = 0;
      const flush = () => { if (!group.length) return; const part = leaf(group); entries.push({offset,count:group.length,ordinal:part.ordinal}); offset+=group.length; group=[]; bytes=2; };
      for (const item of value) {
        const size = Buffer.byteLength(text(item));
        if (size+2 > partLimit) { flush(); entries.push({offset,count:1,node:node(item)}); offset++; continue; }
        if (bytes+size+(group.length?1:0) > partLimit) flush();
        bytes += size+(group.length?1:0); group.push(item);
      }
      flush(); return { type:'array',length:value.length,entries };
    }
    if (value && typeof value === 'object') return {type:'object',entries:Object.keys(value).sort().map(key => [key,node(value[key])])};
    throw new Error('Unsplittable oversized scalar fixture');
  };
  const manifest = node(payload,true);
  const summary = {complete:true,tenantId:tenant,includePayments:true,snapshotStartedAt:payload.snapshotStartedAt,
    providerKeys:['accountResponse','allMappings','payments','taxResponse','xero']};
  return {chunks,manifest,summary,payloadHash:hash(text(payload))};
}
function reconstruct(manifest, chunks) {
  const values = new Map(chunks.map(chunk => { assert.equal(hash(chunk.payloadText),chunk.payloadHash); return [chunk.ordinal,JSON.parse(chunk.payloadText)]; }));
  const node = descriptor => descriptor.type==='value' ? values.get(descriptor.ordinal)
    : descriptor.type==='object' ? Object.fromEntries(descriptor.entries.map(([key,child]) => [key,node(child)]))
      : descriptor.entries.flatMap(entry => entry.node ? [node(entry.node)] : values.get(entry.ordinal));
  return node(manifest);
}
function payload() {
  return {complete:true,provider:{xero:{tenantId:tenant,contactsComplete:true,documents:[{id:randomUUID(),amount:12.3456}]},
    accountResponse:{Accounts:[]},taxResponse:{TaxRates:[]},allMappings:{data:[]},payments:{tenantId:tenant,rows:[]}},
    automaticMappingPolicy:{changedCount:0},snapshotStartedAt:'2026-09-29T19:00:00Z',callForecast:{callsNeeded:50},rate:{dayRemaining:870}};
}
async function harness(t) {
  const endpoint = new URL(nativeUrl);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname),'Only loopback PostgreSQL is permitted');
  assert.ok(['postgres:','postgresql:'].includes(endpoint.protocol));
  const admin = new pg.Client({connectionString:endpoint.toString()}); await admin.connect();
  if (process.env.FCOS_CHECKPOINT_TEST_EXPECTED_DATA_DIRECTORY) {
    const row = (await admin.query("select current_setting('data_directory') data_directory,current_user")).rows[0];
    assert.equal(row.data_directory,process.env.FCOS_CHECKPOINT_TEST_EXPECTED_DATA_DIRECTORY);
    assert.equal(row.current_user,'fcos_campaign_test');
  }
  for (const role of ['anon','authenticated','service_role']) {
    if (!(await admin.query('select 1 from pg_roles where rolname=$1',[role])).rowCount)
      await admin.query(`create role ${role}${role==='service_role'?' bypassrls':''}`);
  }
  const name = `fcos_checkpoint_chunks_${randomUUID().replaceAll('-','')}`;
  await admin.query(`create database "${name}"`); endpoint.pathname=`/${name}`;
  const client = new pg.Client({connectionString:endpoint.toString()}); await client.connect();
  t.after(async () => { await client.query('rollback').catch(()=>{}); await client.end(); await admin.query(`drop database "${name}" with (force)`); await admin.end(); });
  await client.query("set statement_timeout='20s'; set lock_timeout='4s'; set work_mem='4MB'");
  await client.query(`grant usage on schema public to service_role;
    create table checkpoint_test_access(id uuid primary key,active boolean not null);
    insert into checkpoint_test_access values('${actor}',true),('${otherActor}',true);
    create function public.fcos_has_access(p_actor uuid,p_module text) returns boolean language sql stable as
      'select coalesce((select active from public.checkpoint_test_access where id=p_actor),false) and p_module=''xero_portal''';`);
  for (const file of ['20260827145608_xero_contact_sync.sql','20260829080726_xero_financial_sync.sql',
    '20260929192752_xero_preview_checkpoint.sql','20260930004000_xero_preview_checkpoint_chunks.sql']) {
    await client.query(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  await client.query("insert into xero_contact_sync_connections(id,tenant_id,refresh_token,token_version) values('primary',$1,'synthetic-fixture-only',1)",[tenant]);
  await client.query('set role service_role');
  const scope = {actorId:actor,tenantId:tenant,salesforceOrgId:'native-test-org',reconciliationVersion:18,
    inputOptions:{linkFirst:true,includePayments:true,recordExactMatches:false,cutoffDate:'2026-01-01',postingMode:'draft',campaignId:null},
    inputEvidenceHash:hash('complete-native-test-input')};
  const rpc = async (name,values) => (await client.query(`select public.xero_preview_checkpoint_${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) result`,
    values.map(value=>Array.isArray(value)?JSON.stringify(value):value))).rows[0].result;
  const owner = async work => { await client.query('reset role'); try{return await work();}finally{await client.query('set role service_role');} };
  const create = (ttl=900,actualScope=scope) => rpc('create_v2',[randomUUID(),actualScope,ttl]);
  const save = (created,chunks,actualScope=scope) => rpc('save_chunks_v2',[created.id,created.revision,actualScope,chunks]);
  const saveAll = async (created,encoded,actualScope=scope) => {
    for (let i=0;i<encoded.chunks.length;i+=2) await save(created,encoded.chunks.slice(i,i+2),actualScope);
    return rpc('finalize_v2',[created.id,created.revision,actualScope,encoded.manifest,encoded.summary,encoded.payloadHash]);
  };
  const capture = async (value=payload(),ttl=900) => {const created=await create(ttl),encoded=encode(value);return {created,encoded,saved:await saveAll(created,encoded)};};
  const run = async (saved,mutate=()=>{}) => {
    const reference = {checkpointId:saved.id,revision:saved.revision,actorId:actor,tenantId:tenant,salesforceOrgId:scope.salesforceOrgId,
      reconciliationVersion:scope.reconciliationVersion,inputOptions:scope.inputOptions,inputEvidenceHash:scope.inputEvidenceHash,
      payloadHash:saved.payload_hash,storageHash:saved.storage_hash,tokenVersion:saved.token_version,capturedAt:saved.captured_at,storageVersion:2};
    const row = {id:randomUUID(),idempotency_key:randomUUID(),mode:'preview',status:'ready_for_review',created_by:actor,cutoff_date:scope.inputOptions.cutoffDate,
      revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),classification_summary:{},rate_limit_snapshot:{},
      control_totals:{postingMode:scope.inputOptions.postingMode,workflowSnapshot:{complete:true,tenantId:tenant,salesforceOrgId:scope.salesforceOrgId,
        reconciliationVersion:scope.reconciliationVersion,...scope.inputOptions,inventoryReference:reference,
        previewCheckpointInputEvidenceHash:scope.inputEvidenceHash,previewCheckpointPayloadHash:saved.payload_hash}}};
    mutate(row);
    await owner(()=>client.query('insert into xero_financial_sync_runs select * from jsonb_populate_record(null::xero_financial_sync_runs,$1::jsonb)',[row]));
    return row;
  };
  return {client,scope,rpc,owner,create,save,saveAll,capture,run};
}

test('native chunks preserve complete evidence, hashes, bounded reads and exact immutable lost-response retries',{skip:!nativeUrl},async t=>{
  const f=await harness(t), value=payload(), {created,encoded,saved}=await f.capture(value);
  assert.equal(created.storage_version,2);assert.equal(created.payload,undefined);
  assert.equal(saved.revision,2);assert.equal(saved.payload.storageVersion,2);assert.equal(saved.payload_hash,encoded.payloadHash);
  assert.equal(saved.storage_hash,hash((await f.owner(()=>f.client.query('select payload::text text from xero_financial_preview_checkpoints where id=$1',[saved.id]))).rows[0].text));
  const chunks=[];let after=-1,page;
  do {page=await f.rpc('read_chunks_v2',[saved.id,f.scope,after,null]);assert.ok(page.chunks.length<=2);assert.ok(page.chunks.reduce((sum,c)=>sum+Buffer.byteLength(c.payloadText),0)<=512*1024);chunks.push(...page.chunks);if(page.chunks.length)after=page.chunks.at(-1).ordinal;}while(page.hasMore);
  assert.deepEqual(reconstruct(saved.payload.manifest,chunks),value);assert.equal(hash(text(reconstruct(saved.payload.manifest,chunks))),saved.payload_hash);
  // Retry the whole save sequence after losing the finalize response.
  assert.deepEqual(await f.saveAll(created,encoded),saved);
  const changed={...encoded.chunks[0],payloadText:'{}',payloadHash:hash('{}')};
  await assert.rejects(f.save(created,[changed]),/STALE/);
  await assert.rejects(f.save(created,[{ordinal:encoded.chunks.length,payloadText:'{}',payloadHash:hash('{}')}]),/STALE/);
  await assert.rejects(f.rpc('save_chunks_v2',[saved.id,null,f.scope,[{ordinal:encoded.chunks.length,payloadText:'{}',payloadHash:hash('{}')}]]),/STALE/);
  await assert.rejects(f.owner(()=>f.client.query("update xero_financial_preview_checkpoint_chunks set payload_text='{}' where checkpoint_id=$1 and ordinal=0",[saved.id])),/STALE/);
  await assert.rejects(f.owner(()=>f.client.query('delete from xero_financial_preview_checkpoint_chunks where checkpoint_id=$1',[saved.id])),/STALE/);
  await assert.rejects(f.owner(()=>f.client.query('update xero_financial_preview_checkpoints set storage_version=1,revision=3 where id=$1',[saved.id])),/STALE/);
  await f.owner(()=>f.client.query("update xero_contact_sync_connections set token_version=2 where id='primary'"));
  assert.equal((await f.rpc('load_v2',[f.scope,saved.id,null])).token_version,1);
  const withoutPayments=payload();withoutPayments.provider.payments=null;
  const noPaymentScope={...f.scope,inputOptions:{...f.scope.inputOptions,includePayments:false}}, noPaymentParts=encode(withoutPayments);
  noPaymentParts.summary.includePayments=false;
  const noPaymentCapture=await f.create(900,noPaymentScope);
  assert.equal((await f.saveAll(noPaymentCapture,noPaymentParts,noPaymentScope)).state,'captured');
});

test('native manifest rejects missing/duplicate references, invalid coverage and incomplete logical provider evidence',{skip:!nativeUrl},async t=>{
  const f=await harness(t); const finalize=(created,e)=>f.rpc('finalize_v2',[created.id,1,f.scope,e.manifest,e.summary,e.payloadHash]);
  const empty=await f.create(), e=encode(payload());await assert.rejects(finalize(empty,e),/INCOMPLETE/);
  const missing=await f.create();await f.save(missing,e.chunks.slice(1));await assert.rejects(finalize(missing,e),/INCOMPLETE/);
  const complete=await f.create();await f.save(complete,e.chunks);
  const duplicate=structuredClone(e);duplicate.manifest.entries[1][1]=duplicate.manifest.entries[0][1];await assert.rejects(finalize(complete,duplicate),/INCOMPLETE/);
  const duplicateKey=structuredClone(e);duplicateKey.manifest.entries[1][0]=duplicateKey.manifest.entries[0][0];await assert.rejects(finalize(complete,duplicateKey),/INVALID/);
  const secretKey=structuredClone(e);secretKey.manifest.entries[0][0]='A-c_c e.s!sToken';await assert.rejects(finalize(complete,secretKey),/SECRET/);
  for (const mutate of [p=>{p.complete=false;},p=>{p.provider.xero.tenantId=randomUUID();},p=>{p.provider.payments.tenantId=randomUUID();},
    p=>{delete p.provider.payments;},p=>{p.provider.accountResponse=[];},p=>{p.provider.extra={};},p=>{p.automaticMappingPolicy=null;},
    p=>{p.snapshotStartedAt='not-a-date';},p=>{p.snapshotStartedAt='infinity';}]) {
    const p=payload();mutate(p);const bad=encode(p), created=await f.create();await f.save(created,bad.chunks);await assert.rejects(finalize(created,bad),/INVALID/);
  }
  const arrayPayload=payload();arrayPayload.provider.xero.documents=Array.from({length:600},(_,i)=>({i,memo:'x'.repeat(1000)}));
  const arrayEncoded=encode(arrayPayload), arrayCreated=await f.create();for(let i=0;i<arrayEncoded.chunks.length;i+=2)await f.save(arrayCreated,arrayEncoded.chunks.slice(i,i+2));
  const findArray=n=>n.type==='array'?n:n.type==='object'?n.entries.map(([,child])=>findArray(child)).find(Boolean):null;
  const wrongCount=structuredClone(arrayEncoded);findArray(wrongCount.manifest).entries[0].count--;await assert.rejects(finalize(arrayCreated,wrongCount),/INVALID/);
  const overlap=structuredClone(arrayEncoded);findArray(overlap.manifest).entries[1].offset=0;await assert.rejects(finalize(arrayCreated,overlap),/INVALID/);
  const wrongLength=structuredClone(arrayEncoded);findArray(wrongLength.manifest).length++;await assert.rejects(finalize(arrayCreated,wrongLength),/INVALID/);
  assert.equal((await finalize(arrayCreated,arrayEncoded)).state,'captured');
});

test('native chunk bounds and exact normalized secret keys fail closed before capture',{skip:!nativeUrl},async t=>{
  const f=await harness(t),created=await f.create();
  for(const key of denied)for(const variant of [key.toUpperCase(),key.split('').join('_ -.!')]){
    const payloadText=JSON.stringify({nested:[{[variant]:'synthetic'}]});
    await assert.rejects(f.save(created,[{ordinal:0,payloadText,payloadHash:hash(payloadText)}]),/SECRET/);
  }
  for(const key of ['accessTokenCount','access_token_suffix','unknownToken','']){
    const payloadText=JSON.stringify({[key]:1});const c=await f.create();await f.save(c,[{ordinal:0,payloadText,payloadHash:hash(payloadText)}]);
  }
  const oversize=JSON.stringify('x'.repeat(partLimit));await assert.rejects(f.save(created,[{ordinal:0,payloadText:oversize,payloadHash:hash(oversize)}]),/TOO_LARGE/);
  const exact=JSON.stringify('x'.repeat(partLimit-2));
  await f.save(created,[{ordinal:0,payloadText:exact,payloadHash:hash(exact)},{ordinal:1,payloadText:exact,payloadHash:hash(exact)}]);
  await assert.rejects(f.save(created,[2,3,4].map(ordinal=>({ordinal,payloadText:exact,payloadHash:hash(exact)}))),/TOO_LARGE/);
  await assert.rejects(f.save(created,[{ordinal:0,payloadText:exact,payloadHash:'0'.repeat(64)}]),/CORRUPT/);
  await assert.rejects(f.save(created,[{ordinal:2,payloadText:'{invalid',payloadHash:hash('{invalid')}]),/INVALID/);
  await assert.rejects(f.save(created,[{ordinal:2,payloadText:'{}',payloadHash:hash('{}')},{ordinal:2,payloadText:'{}',payloadHash:hash('{}')}]),/INVALID/);
  const legacy=await f.rpc('create_v1',[randomUUID(),f.scope,900]);await assert.rejects(f.save(legacy,[{ordinal:0,payloadText:'{}',payloadHash:hash('{}')}]),/MISMATCH/);
  const legacyPayload=text(payload());const legacySaved=await f.rpc('save_v1',[legacy.id,1,f.scope,legacyPayload,hash(legacyPayload)]);
  assert.deepEqual(legacySaved.payload,JSON.parse(legacyPayload));assert.equal(legacySaved.storage_version,1);
  assert.equal((await f.rpc('load_v1',[f.scope,legacy.id])).payload_hash,legacySaved.payload_hash);
  const mixedVersionPayload=text(payload());
  await assert.rejects(f.rpc('save_v1',[created.id,1,f.scope,mixedVersionPayload,hash(mixedVersionPayload)]),/INVALID/);
});

test('native actor/tenant/controls/expiry checks and browser/service privileges retain their authority',{skip:!nativeUrl},async t=>{
  const f=await harness(t),{saved}=await f.capture();
  for(const change of [{actorId:otherActor},{salesforceOrgId:'other-org'},{reconciliationVersion:19},{inputEvidenceHash:'b'.repeat(64)},
    {inputOptions:{...f.scope.inputOptions,includePayments:false}},{inputOptions:{...f.scope.inputOptions,postingMode:'authorised'}},
    {inputOptions:{...f.scope.inputOptions,campaignId:randomUUID()}}]){
    await assert.rejects(f.rpc('load_v2',[{...f.scope,...change},saved.id,null]),/MISMATCH/);
    await assert.rejects(f.rpc('read_chunks_v2',[saved.id,{...f.scope,...change},-1,null]),/MISMATCH/);
  }
  await assert.rejects(f.rpc('load_v2',[{...f.scope,tenantId:randomUUID()},saved.id,null]),/CONNECTION_CHANGED/);
  await f.owner(()=>f.client.query('update checkpoint_test_access set active=false where id=$1',[actor]));
  await assert.rejects(f.rpc('load_v2',[f.scope,saved.id,null]),/ACCESS_REQUIRED/);
  await f.owner(()=>f.client.query('update checkpoint_test_access set active=true where id=$1',[actor]));
  const expiring=await f.create(1);await new Promise(resolve=>setTimeout(resolve,1100));
  await assert.rejects(f.save(expiring,[{ordinal:0,payloadText:'{}',payloadHash:hash('{}')}]),/EXPIRED/);
  assert.equal(await f.rpc('load_v2',[f.scope,expiring.id,null]).catch(e=>/EXPIRED/.test(e.message)),true);
  const roles=(await f.owner(()=>f.client.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='xero_financial_preview_checkpoint_chunks'::regclass"))).rows[0];
  assert.deepEqual(roles,{relrowsecurity:true,relforcerowsecurity:true});
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']){
    assert.equal((await f.client.query('select has_table_privilege($1,$2,$3) ok',[role,'xero_financial_preview_checkpoint_chunks',privilege])).rows[0].ok,false);
  }
  for(const role of ['anon','authenticated'])for(const signature of ['create_v2(uuid,jsonb,integer)','save_chunks_v2(uuid,integer,jsonb,jsonb)',
    'finalize_v2(uuid,integer,jsonb,jsonb,jsonb,text)','load_v2(jsonb,uuid,uuid)','read_chunks_v2(uuid,jsonb,integer,uuid)','publish_v2(uuid,integer,jsonb,uuid)']){
    assert.equal((await f.client.query('select has_function_privilege($1,$2,$3) ok',[role,`xero_preview_checkpoint_${signature}`,'EXECUTE'])).rows[0].ok,false);
  }
});

test('native publication binds every inventory reference and durable published reads require its exact completed run',{skip:!nativeUrl},async t=>{
  const f=await harness(t),{saved}=await f.capture();
  for(const mutate of [r=>{r.created_by=otherActor;},r=>{r.status='building';},r=>{r.control_totals.workflowSnapshot.previewCheckpointPayloadHash='b'.repeat(64);},
    ...['checkpointId','actorId','tenantId','salesforceOrgId','inputEvidenceHash','payloadHash','storageHash','capturedAt'].map(key=>r=>{r.control_totals.workflowSnapshot.inventoryReference[key]=key==='capturedAt'?'2020-01-01T00:00:00Z':'wrong';}),
    ...['revision','reconciliationVersion','tokenVersion','storageVersion'].map(key=>r=>{r.control_totals.workflowSnapshot.inventoryReference[key]=999;}),
    r=>{r.control_totals.workflowSnapshot.inventoryReference.inputOptions={...f.scope.inputOptions,includePayments:false};}]){
    const bad=await f.run(saved,mutate);await assert.rejects(f.rpc('publish_v2',[saved.id,2,f.scope,bad.id]),/PUBLICATION_INVALID/);
    await assert.rejects(f.rpc('publish_v1',[saved.id,2,f.scope,bad.id]),/PUBLICATION_INVALID/);
  }
  const run=await f.run(saved);const published=await f.rpc('publish_v2',[saved.id,2,f.scope,run.id]);assert.equal(published.revision,3);assert.equal(published.payload,undefined);
  assert.deepEqual(await f.rpc('publish_v2',[saved.id,2,f.scope,run.id]),published);
  const expiring=await f.capture(payload(),1), durableRun=await f.run(expiring.saved);await f.rpc('publish_v2',[expiring.saved.id,2,f.scope,durableRun.id]);
  await new Promise(resolve=>setTimeout(resolve,1100));
  await assert.rejects(f.rpc('load_v2',[f.scope,expiring.saved.id,null]),/EXPIRED/);
  await assert.rejects(f.rpc('read_chunks_v2',[expiring.saved.id,f.scope,-1,null]),/EXPIRED/);
  assert.equal((await f.rpc('load_v2',[f.scope,expiring.saved.id,durableRun.id])).published_run_id,durableRun.id);
  assert.ok((await f.rpc('read_chunks_v2',[expiring.saved.id,f.scope,-1,durableRun.id])).chunks.length>0);
  await assert.rejects(f.rpc('load_v2',[f.scope,expiring.saved.id,run.id]),/PUBLICATION_INVALID/);
  await f.owner(()=>f.client.query("update xero_financial_sync_runs set status='building' where id=$1",[durableRun.id]));
  await assert.rejects(f.rpc('load_v2',[f.scope,expiring.saved.id,durableRun.id]),/PUBLICATION_INVALID/);
});

test('native representative 25 MB checkpoint save/load stays bounded and reconstructs every evidence byte',{skip:!nativeUrl},async t=>{
  const f=await harness(t);let value;
  if(process.env.FCOS_CHECKPOINT_SCALE_PAYLOAD)value=JSON.parse(await readFile(process.env.FCOS_CHECKPOINT_SCALE_PAYLOAD,'utf8'));
  else {value=payload();value.provider.xero.documents=Array.from({length:18000},(_,i)=>Object.fromEntries([
    ['id',String(i)],['lines',[{quantity:1,amount:123.45,description:'synthetic'}]],
    ...Array.from({length:24},(_,k)=>[`field${k}`,hash(`${i}:${k}`).repeat(1)])]));}
  const encoded=encode(value),bytes=Buffer.byteLength(text(value));assert.ok(bytes>=20*1024*1024 && bytes<=35*1024*1024);
  const created=await f.create(3600),pid=(await f.client.query('select pg_backend_pid() pid')).rows[0].pid;
  let peak=0,sampling=false,samples=0;
  const canMeasure=process.platform==='darwin'||process.platform==='linux';
  const rss=canMeasure?await backendRssSampler(pid,nativeUrl):null;
  const before=canMeasure?await rss():null;
  const timer=canMeasure?setInterval(async()=>{if(sampling)return;sampling=true;try{peak=Math.max(peak,await rss());samples++;}catch{}finally{sampling=false;}},25):null;
  t.after(()=>{if(timer)clearInterval(timer);});
  const start=performance.now();const saved=await f.saveAll(created,encoded);const saveMs=Math.round(performance.now()-start);
  const readStart=performance.now(),read=[];let after=-1,page;
  do{page=await f.rpc('read_chunks_v2',[saved.id,f.scope,after,null]);assert.ok(page.chunks.length<=2);assert.ok(page.chunks.reduce((n,c)=>n+Buffer.byteLength(c.payloadText),0)<=512*1024);read.push(...page.chunks);if(page.chunks.length)after=page.chunks.at(-1).ordinal;}while(page.hasMore);
  const readMs=Math.round(performance.now()-readStart);if(timer)clearInterval(timer);if(canMeasure)peak=Math.max(peak,await rss());
  const loaded=await f.rpc('load_v2',[f.scope,saved.id,null]);const recovered=reconstruct(loaded.payload.manifest,read);
  assert.deepEqual(recovered,value);assert.equal(hash(text(recovered)),encoded.payloadHash);assert.equal(saved.payload_hash,encoded.payloadHash);
  assert.ok(Buffer.byteLength(JSON.stringify(saved))<512*1024);assert.ok(encoded.chunks.every(c=>Buffer.byteLength(c.payloadText)<=partLimit));
  if(canMeasure)assert.ok(peak<384*1024,`Bounded checkpoint RSS ${peak} KiB exceeded the 384 MiB regression ceiling`);
  const evidence={payloadBytes:bytes,chunkCount:encoded.chunks.length,largestChunkBytes:Math.max(...encoded.chunks.map(c=>Buffer.byteLength(c.payloadText))),
    saveAndFinalizeMs:saveMs,readPagesMs:readMs,peakBackendRssKiB:canMeasure?peak:null,beforeBackendRssKiB:before,samples,
    fullCanonicalHashVerified:true,completeEvidenceDeepEqual:true};
  if(process.env.FCOS_CHECKPOINT_SCALE_REPORT)await writeFile(process.env.FCOS_CHECKPOINT_SCALE_REPORT,JSON.stringify(evidence,null,2),{mode:0o600});
  t.diagnostic(JSON.stringify(evidence));
});
