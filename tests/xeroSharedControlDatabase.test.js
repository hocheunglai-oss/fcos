import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

const tenant = '00000000-0000-4000-8000-000000000001';
const admin = '00000000-0000-4000-8000-000000000002';
const nativeUrl = process.env.FCOS_SHARED_TEST_DATABASE_URL || process.env.FCOS_CAMPAIGN_TEST_DATABASE_URL
  || process.env.FCOS_CORRECTION_TEST_DATABASE_URL || process.env.FCOS_GROUPED_TEST_DATABASE_URL;

async function database(t) {
  if (!nativeUrl) {
    const db = new PGlite(); t.after(() => db.close());
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
    return { db };
  }
  const endpoint = new URL(nativeUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Tests may only use a local PostgreSQL server');
  assert.ok(['postgres:', 'postgresql:'].includes(endpoint.protocol));
  const owner = new pg.Client({ connectionString: endpoint.toString() }); await owner.connect();
  const name = `fcos_shared_${randomUUID().replaceAll('-', '')}`;
  await owner.query(`create database "${name}"`); endpoint.pathname = `/${name}`;
  const clients = [];
  const connect = async () => {
    const client = new pg.Client({ connectionString: endpoint.toString() }); await client.connect(); clients.push(client);
    await client.query("set statement_timeout='8s'; set lock_timeout='4s'"); return client;
  };
  t.after(async () => {
    for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end(); }
    await owner.query(`drop database "${name}" with (force)`); await owner.end();
  });
  const primary = await connect();
  return { db: { query: (...args) => primary.query(...args), exec: sql => primary.query(sql) }, connect };
}

async function harness(t) {
  const { db, connect } = await database(t);
  await db.exec(`grant usage on schema public to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    create table user_profiles(id uuid primary key,active boolean,user_type text);
    create table xero_contact_sync_connections(id text primary key,tenant_id text,tenant_name text,access_token text,refresh_token text,expires_at timestamptz,scope text,token_version integer,updated_at timestamptz);
    insert into user_profiles values('${admin}',true,'administrator');
    insert into xero_contact_sync_connections values('primary','${tenant}','fixture','fixture-access','fixture-refresh',now()+interval '30 minutes','accounting.transactions',1,now());`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260929170347_xero_shared_control.sql', import.meta.url), 'utf8'));
  await db.exec('set role service_role');
  const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_,i) => '$'+(i+1)).join(',')}) as result`, args)).rows[0].result;
  const reserve = (ops = 1, verify = 1, ttl = 600) => rpc('xero_shared_reserve', [tenant,randomUUID(),'test',ops,verify,ttl]);
  const admit = (method='GET',budget=null,phase='operation',probe=null,resource='Invoices',version=1) => rpc('xero_shared_admit',[tenant,randomUUID(),version,method,resource,budget,phase,probe]);
  const observe = (receipt,status=200,snapshot={},unknown=false) => rpc('xero_shared_observe',[tenant,receipt.requestId,status,snapshot,unknown]);
  const status = () => rpc('xero_shared_status', [tenant]);
  const seed = async (remaining = 1000) => {
    const grant = await rpc('xero_shared_authorize_probe', [tenant,randomUUID(),admin,new Date().toISOString(),'Explicit fixture allowance probe']);
    const receipt = await admit('GET',null,'operation',grant.id,'Organisations');
    await observe(receipt,200,{dayRemaining:remaining}); return receipt;
  };
  return { db, connect, rpc, reserve, admit, observe, status, seed };
}

test('durable admission, scoped probe, reservations, uncertain writes, renewal CAS and service ACL', async t => {
  const { db, rpc, reserve, admit, observe } = await harness(t);
  assert.equal((await rpc('xero_shared_status',[tenant])).allowanceKnown,false);
  await assert.rejects(admit(),/ALLOWANCE_UNKNOWN/);
  await assert.rejects(reserve(),/ALLOWANCE_UNKNOWN/);
  await assert.rejects(rpc('xero_shared_status',[randomUUID()]),/organisation changed/);
  await assert.rejects(rpc('xero_shared_authorize_probe',[tenant,randomUUID(),randomUUID(),new Date().toISOString(),'test']),/authority/);
  const probe = await rpc('xero_shared_authorize_probe',[tenant,randomUUID(),admin,new Date().toISOString(),'Explicit test probe']);
  await assert.rejects(admit('POST',null,'operation',probe.id,'Organisations'),/read-only/);
  const first=await admit('GET',null,'operation',probe.id,'Organisations');
  await assert.rejects(admit('GET',null,'operation',probe.id,'Organisations'),/INFLIGHT_LIMIT/);
  await observe(first,200,{dayRemaining:1000,appDayRemaining:950,observedAt:new Date().toISOString()});
  assert.equal((await rpc('xero_shared_status',[tenant])).availableCalls,950);
  await assert.rejects(admit('GET',null,'operation',probe.id,'Organisations'),/PROBE_AUTHORITY_INVALID/);
  const budget=await reserve(2,2);
  const write=await admit('POST',budget.id);
  const parallel=await admit();
  await assert.rejects(admit(),/INFLIGHT_LIMIT/);
  await observe(parallel,200,{dayRemaining:949});
  assert.equal((await rpc('xero_shared_status',[tenant])).availableCalls,948); // never increase out-of-order observation
  await observe(write,null,{},true);
  await assert.rejects(admit('POST',budget.id),/WRITE_OUTCOME_UNRESOLVED/);
  const readback=await admit('GET',budget.id,'verification'); await observe(readback);
  await assert.rejects(rpc('xero_shared_resolve_unknown',[tenant,write.requestId,parallel.requestId,'journal/fixture']),/readback/);
  assert.equal(await rpc('xero_shared_resolve_unknown',[tenant,write.requestId,readback.requestId,'journal/fixture']),true);
  const retry=await admit('POST',budget.id); await observe(retry);
  await assert.rejects(admit('POST',budget.id),/BUDGET_EXHAUSTED/);
  await rpc('xero_shared_release',[tenant,budget.id,'verified']);
  await assert.rejects(admit('POST'),/VERIFICATION_BUDGET_REQUIRED/);
  await assert.rejects(reserve(1000,1),/RESERVE_PROTECTED/);
  // Crash leases debit once, retain unknown write evidence and free only concurrency.
  const crashBudget=await reserve();const crash=await admit('POST',crashBudget.id);
  await db.query("update xero_shared_requests set deadline_at=now()-interval '1 second' where id=$1",[crash.requestId]);
  const safeRead=await admit();await observe(safeRead);
  await assert.rejects(admit('POST',crashBudget.id),/WRITE_OUTCOME_UNRESOLVED/);
  await db.query("update xero_shared_budgets set expires_at=now()-interval '1 second' where id=$1",[crashBudget.id]);
  const recovery=await reserve(0,1);const recoveryRead=await admit('GET',recovery.id,'verification');await observe(recoveryRead);
  assert.equal(await rpc('xero_shared_resolve_unknown',[tenant,crash.requestId,recoveryRead.requestId,'journal/recovery']),true);
  await rpc('xero_shared_release',[tenant,recovery.id,'recovered']);
  // Unknown daily reset never becomes a guessed reset; probe remains explicit.
  const throttle=await admit();await observe(throttle,429,{rateLimitProblem:'day'});
  const held=await rpc('xero_shared_status',[tenant]);assert.equal(held.allowanceKnown,false);assert.equal(held.dailyHold,true);assert.equal(held.retryAt,null);
  await assert.rejects(admit(),/ALLOWANCE_UNKNOWN/);
  const probe2=await rpc('xero_shared_authorize_probe',[tenant,randomUUID(),admin,new Date().toISOString(),'Explicit later probe']);
  const later=await admit('GET',null,'operation',probe2.id,'Organisations');await observe(later,200,{dayRemaining:1000});
  // Rolling window applies across all callers and includes failed requests.
  await db.exec(`insert into xero_shared_requests(id,tenant_id,token_version,method,resource_key,phase,state,deadline_at)
    select gen_random_uuid(),'${tenant}',1,'GET','Invoices','operation','complete',now() from generate_series(1,45);`);
  await assert.rejects(admit(),/MINUTE_LIMIT/);
  await db.exec("update xero_shared_requests set admitted_at=now()-interval '61 seconds'");
  const limited=await admit(); await observe(limited,429,{rateLimitProblem:'minute',retryAt:new Date(Date.now()+120_000).toISOString()});
  await assert.rejects(admit(),/RETRY_DEADLINE/);
  await assert.rejects(rpc('xero_shared_authorize_probe',[tenant,randomUUID(),admin,new Date().toISOString(),'too early']),/RETRY_DEADLINE/);
  // Rotation is single-owner; expired owners are uncertain, not freely retried.
  const lease=randomUUID();assert.equal((await rpc('xero_refresh_claim',[tenant,1,lease])).state,'claimed');
  assert.equal((await rpc('xero_refresh_claim',[tenant,1,randomUUID()])).state,'busy');
  await db.exec("update xero_token_refresh_leases set expires_at=now()-interval '1 second'");
  assert.equal((await rpc('xero_refresh_claim',[tenant,1,randomUUID()])).state,'uncertain');
  const connection={tenantId:tenant,tenantName:'fixture',accessToken:'fixture-new',refreshToken:'fixture-rotated',expiresAt:new Date(Date.now()+1800_000).toISOString(),scope:'accounting.transactions'};
  assert.equal((await rpc('xero_refresh_finish',[tenant,1,lease,connection])).tokenVersion,2);
  await assert.rejects(rpc('xero_refresh_finish',[tenant,1,lease,connection]),/CONNECTION_CHANGED/);
  const revokedLease=randomUUID(); await rpc('xero_refresh_claim',[tenant,2,revokedLease]);
  await rpc('xero_refresh_fail',[tenant,2,revokedLease,'revoked']);
  assert.equal((await rpc('xero_refresh_claim',[tenant,2,randomUUID()])).state,'revoked');
  await db.exec("update xero_token_refresh_leases set state='superseded'");
  const lease2=randomUUID(); await rpc('xero_refresh_claim',[tenant,2,lease2]);
  assert.equal((await rpc('xero_reconnect_store',[2,connection])).tokenVersion,3);
  await assert.rejects(rpc('xero_refresh_finish',[tenant,2,lease2,connection]),/CONNECTION_CHANGED/);
  await assert.rejects(rpc('xero_reconnect_store',[2,connection]),/CONNECTION_CHANGED/);
  await assert.rejects(admit(),/CONNECTION_CHANGED/);
  for(const table of ['xero_shared_tenant_control','xero_shared_requests','xero_shared_budgets','xero_shared_probe_grants','xero_token_refresh_leases']) {
    assert.equal((await db.query('select has_table_privilege(current_user,$1,\'TRUNCATE\') ok',[table])).rows[0].ok,false);
    assert.equal((await db.query('select has_table_privilege(current_user,$1,\'DELETE\') ok',[table])).rows[0].ok,false);
  }
  for(const role of ['anon','authenticated']) {
    await db.exec(`reset role;set role ${role}`);
    await assert.rejects(rpc('xero_shared_status',[tenant]),/permission denied/);
    await assert.rejects(db.exec('select * from xero_shared_requests'),/permission denied/);
  }
});

test('unknown writes require a later related verification receipt and resolution retires expired inflight state', async t => {
  const { db, rpc, reserve, admit, observe, status, seed } = await harness(t); await seed();
  const budget = await reserve(2,4); const write = await admit('POST',budget.id);
  const early = await admit('GET',budget.id,'verification'); await observe(early);
  await observe(write,null); // Missing response is uncertain even without a caller flag.
  assert.equal((await status()).unresolvedWrites,1);
  await assert.rejects(rpc('xero_shared_resolve_unknown',[tenant,write.requestId,early.requestId,'journal/early']),/readback/);
  // A late original response is useful quota evidence, never verified readback.
  await observe(write,200,{dayRemaining:900},false);
  assert.equal((await status()).unresolvedWrites,1);
  const wrong = await admit('GET',budget.id,'verification',null,'Contacts'); await observe(wrong);
  await assert.rejects(rpc('xero_shared_resolve_unknown',[tenant,write.requestId,wrong.requestId,'journal/wrong-resource']),/readback/);
  const unrelatedBudget = await reserve(0,1); const unrelated = await admit('GET',unrelatedBudget.id,'verification'); await observe(unrelated);
  await assert.rejects(rpc('xero_shared_resolve_unknown',[tenant,write.requestId,unrelated.requestId,'journal/unrelated-budget']),/readback/);
  const related = await admit('GET',budget.id,'verification'); await observe(related);
  assert.equal(await rpc('xero_shared_resolve_unknown',[tenant,write.requestId,related.requestId,'journal/verified']),true);
  assert.equal(await rpc('xero_shared_resolve_unknown',[tenant,write.requestId,related.requestId,'journal/verified']),true); // Lost RPC response is idempotent.
  await assert.rejects(rpc('xero_shared_resolve_unknown',[tenant,write.requestId,related.requestId,'journal/different']),/readback/);
  await observe(write,503,{dayRemaining:5},true); // Duplicate observation cannot reopen a verified receipt.
  assert.equal((await status()).unresolvedWrites,0); assert.ok((await status()).availableCalls>200);
  const retry = await admit('POST',budget.id); await observe(retry);
  const expiredBudget = await reserve(1,1); const expired = await admit('POST',expiredBudget.id);
  await db.query("update xero_shared_requests set deadline_at=now()-interval '1 second' where id=$1",[expired.requestId]);
  await db.query("update xero_shared_budgets set expires_at=now()-interval '1 second' where id=$1",[expiredBudget.id]);
  const recoveryBudget = await reserve(0,1); const readback = await admit('GET',recoveryBudget.id,'verification'); await observe(readback);
  // Simulate a legacy expired receipt retained as inflight by a rolled-back cleanup.
  await db.query("update xero_shared_requests set state='inflight',outcome_unknown=false,completed_at=null where id=$1",[expired.requestId]);
  assert.equal(await rpc('xero_shared_resolve_unknown',[tenant,expired.requestId,readback.requestId,'journal/recovery']),true);
  const receipt = (await db.query('select state,outcome_unknown,resolution_request_id from xero_shared_requests where id=$1',[expired.requestId])).rows[0];
  assert.equal(receipt.state,'complete'); assert.equal(receipt.outcome_unknown,false); assert.equal(receipt.resolution_request_id,readback.requestId);
  assert.equal((await status()).unresolvedWrites,0);
});

test('ordinary responses can only lower quota and superseded probe responses cannot seed a reconnected grant', async t => {
  const { db, rpc, admit, observe, seed, status } = await harness(t); await seed(1000);
  const high = await admit(); await observe(high,200,{dayRemaining:5000,appDayRemaining:5000});
  assert.equal((await status()).availableCalls,999);
  const appOnly = await admit(); await observe(appOnly,200,{appDayRemaining:300});
  assert.equal((await status()).availableCalls,300);
  const noHeaders = await admit(); await observe(noHeaders);
  assert.equal((await status()).availableCalls,299);
  const grant = await rpc('xero_shared_authorize_probe',[tenant,randomUUID(),admin,new Date().toISOString(),'Explicit reset verification']);
  const probe = await admit('GET',null,'operation',grant.id,'Organisations');
  const next = { tenantId:tenant,tenantName:'fixture',accessToken:'fixture-new',refreshToken:'fixture-rotated',expiresAt:new Date(Date.now()+1800_000).toISOString() };
  await rpc('xero_reconnect_store',[1,next]);
  assert.equal((await observe(probe,200,{dayRemaining:9000})).superseded,true);
  assert.equal((await status()).availableCalls,298);
  assert.equal((await db.query('select response_status from xero_shared_requests where id=$1',[probe.requestId])).rows[0].response_status,200);
  await assert.rejects(admit(),/CONNECTION_CHANGED/);
  const currentGrant = await rpc('xero_shared_authorize_probe',[tenant,randomUUID(),admin,new Date().toISOString(),'Explicit current grant verification']);
  const currentProbe = await admit('GET',null,'operation',currentGrant.id,'Organisations',2);
  await observe(currentProbe,200,{dayRemaining:1000,appDayRemaining:900});
  assert.equal((await status()).availableCalls,900);
  await observe(currentProbe,200,{dayRemaining:9000});
  assert.equal((await status()).availableCalls,900); // An admitted probe cannot be replayed to replenish again.
});

test('reserve boundary, expired budgets and verification phase keep admission fail closed', async t => {
  const { db, rpc, reserve, admit, observe, seed, status } = await harness(t); await seed(203);
  const budget = await reserve(1,1);
  await assert.rejects(reserve(1,1),/RESERVE_PROTECTED/);
  const unrelated = await admit(); await observe(unrelated);
  assert.equal((await status()).availableCalls,202);
  await assert.rejects(admit(),/RESERVE_PROTECTED/);
  const write = await admit('POST',budget.id); await observe(write);
  await assert.rejects(admit('POST',budget.id,'verification'),/BUDGET_EXHAUSTED/);
  const verification = await admit('GET',budget.id,'verification'); await observe(verification);
  assert.equal((await status()).availableCalls,200);
  await assert.rejects(admit(),/RESERVE_PROTECTED/);
  await db.exec('update xero_shared_tenant_control set available_calls=205');
  const expired = await reserve(1,1); const before = (await status()).availableCalls;
  await db.query("update xero_shared_budgets set expires_at=now()-interval '1 second' where id=$1",[expired.id]);
  await assert.rejects(admit('GET',expired.id),/BUDGET_EXHAUSTED/);
  assert.equal((await status()).availableCalls,before);
  assert.equal((await status()).reservedCalls,0);
  await assert.rejects(rpc('xero_shared_reserve',[tenant,expired.id,'test',1,1,600]),/identity/);
});

test('an uncertain renewal remains single owner but accepts that owner’s conclusive rejection', async t => {
  const { db, rpc } = await harness(t);
  const lease = randomUUID(); assert.equal((await rpc('xero_refresh_claim',[tenant,1,lease])).state,'claimed');
  await db.exec("update xero_token_refresh_leases set expires_at=now()-interval '1 second'");
  assert.equal((await rpc('xero_refresh_claim',[tenant,1,randomUUID()])).state,'uncertain');
  assert.equal(await rpc('xero_refresh_fail',[tenant,1,randomUUID(),'superseded']),false);
  assert.equal(await rpc('xero_refresh_fail',[tenant,1,lease,'revoked']),true);
  assert.equal((await rpc('xero_refresh_claim',[tenant,1,randomUUID()])).state,'revoked');
});

test('native PostgreSQL locks serialize independent workers’ budget, admission and renewal claims', { skip: !nativeUrl }, async t => {
  const { db, connect, seed, status } = await harness(t); await seed(204);
  const workers = await Promise.all([connect(),connect(),connect()]);
  for (const worker of workers) await worker.query('set role service_role');
  const call = async (client,name,args) => (await client.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
  const budgets = await Promise.allSettled(workers.slice(0,2).map(client=>call(client,'xero_shared_reserve',[tenant,randomUUID(),'parallel',2,1,600])));
  assert.equal(budgets.filter(result=>result.status==='fulfilled').length,1);
  assert.match(budgets.find(result=>result.status==='rejected').reason.message,/RESERVE_PROTECTED/);
  await db.exec('update xero_shared_tenant_control set available_calls=1000');
  const requests = await Promise.allSettled(workers.map(client=>call(client,'xero_shared_admit',[tenant,randomUUID(),1,'GET','Invoices',null,'operation',null])));
  assert.equal(requests.filter(result=>result.status==='fulfilled').length,2);
  assert.match(requests.find(result=>result.status==='rejected').reason.message,/INFLIGHT_LIMIT/);
  assert.equal((await status()).inFlight,2);
  const leases = await Promise.all(workers.slice(0,2).map(client=>call(client,'xero_refresh_claim',[tenant,1,randomUUID()])));
  assert.deepEqual(leases.map(result=>result.state).sort(),['busy','claimed']);
});
