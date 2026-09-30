import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const source = await readFile(new URL('../supabase/migrations/20260930044110_missing_nom_b_workflow.sql',import.meta.url),'utf8');
const databaseUrl = process.env.FCOS_MISSING_NOM_B_TEST_DATABASE_URL;

test('migration is prospective and restricts all workflow state to the server',()=>{
 assert.equal(/insert into public\.missing_nom_b_scan_state\(source_org_id\)/.test(source),true);
 assert.equal(/security definer/i.test(source),false);
 for(const name of ['scan_state','reminders','upload_operations']) assert.ok(source.includes(`alter table public.missing_nom_b_${name} enable row level security`));
 assert.ok(source.includes('from public,anon,authenticated'));
 assert.ok(source.includes("m.verification_state='verified'"));
 assert.ok(source.includes('for update skip locked'));
});

test('disposable Postgres verifies claims, rollback, RLS, expiry and concurrent send/upload arbitration',{skip:!databaseUrl},async(t)=>{
 const url=new URL(databaseUrl);assert.ok(['127.0.0.1','localhost','::1'].includes(url.hostname));assert.equal(url.pathname,'/missing_nom_b_test');
 const db=new pg.Client({connectionString:databaseUrl});const other=new pg.Client({connectionString:databaseUrl});await db.connect();await other.connect();
 try {
  await db.query(`drop schema public cascade;create schema public;
   do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end $$;
   grant usage on schema public to anon,authenticated,service_role;
   create table user_profiles(id uuid primary key);
   create table email_sender_mailboxes(id uuid primary key,active boolean,verification_state text);
   create table email_sender_purposes(purpose_key text primary key,label text,description text,module_id text,sort_order integer);
   create table email_sender_routes(purpose_key text primary key,mailbox_id uuid);
   insert into email_sender_mailboxes values('00000000-0000-4000-8000-000000000001',true,'verified');
   insert into email_sender_routes values('outstanding_invoice_reports','00000000-0000-4000-8000-000000000001');`);
  await db.query(source);
  const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.v;
  await t.test('no activation at migration, verified sender copied, RLS and no client RPC privileges',async()=>{
   assert.equal(await value('select count(*)::int v from missing_nom_b_scan_state'),0);
   assert.equal(await value("select mailbox_id::text v from email_sender_routes where purpose_key='missing_nom_b_reminders'"),'00000000-0000-4000-8000-000000000001');
   const tables=await db.query("select relrowsecurity,relname from pg_class where relname in ('missing_nom_b_scan_state','missing_nom_b_reminders','missing_nom_b_upload_operations')");assert.equal(tables.rows.every(r=>r.relrowsecurity),true);
   for(const role of ['anon','authenticated']) {
    assert.equal(await value(`select has_table_privilege($1,'missing_nom_b_reminders','SELECT,INSERT,UPDATE,DELETE') v`,[role]),false);
    assert.equal(await value(`select has_function_privilege($1,'missing_nom_b_claim_scan(text,uuid)','EXECUTE') v`,[role]),false);
    await db.query(`set role ${role}`);await assert.rejects(db.query('select * from missing_nom_b_reminders'),/permission denied/);await db.query('reset role');
   }
   await db.query('set role service_role');await db.query('select * from missing_nom_b_reminders');await db.query('reset role');
  });
  const org='source-test';const token=randomUUID();
  let scan=await value('select missing_nom_b_claim_scan($1,$2) v',[org,token]);
  await t.test('single scan claim and atomic checkpoint rollback',async()=>{
   assert.equal(await value('select missing_nom_b_claim_scan($1,$2) v',[org,randomUUID()]),null);
   const discoveries=[{stemId:'stem-1',invoiceId:'invoice-1',invoice:{Id:'invoice-1'}},{stemId:null,invoiceId:'invalid'}];
   await assert.rejects(db.query('select missing_nom_b_checkpoint($1,$2,$3,$4,$5,false)',[org,token,JSON.stringify(discoveries),scan.cursor_at,'last']),/not-null/);
   assert.equal(await value('select count(*)::int v from missing_nom_b_reminders'),0);
   assert.equal(await value('select cursor_id v from missing_nom_b_scan_state where source_org_id=$1',[org]),'');
   scan=await value('select missing_nom_b_checkpoint($1,$2,$3,$4,$5,true) v',[org,token,JSON.stringify([{stemId:'stem-1',invoiceId:'invoice-1',invoice:{Id:'invoice-1'}},{stemId:'stem-1',invoiceId:'invoice-2',invoice:{Id:'invoice-2'}}]),scan.scan_until,'']);
   assert.equal(await value('select count(*)::int v from missing_nom_b_reminders'),1);assert.equal(scan.cursor_at,null);
   assert.equal(await value('select invoice_id v from missing_nom_b_reminders'),'invoice-1');
  });
  await t.test('new invoice rearms only suppressed unsent STEM; sent and uncertain remain terminal',async()=>{
   for(const status of ['Suppressed','Sent','Uncertain']) {
    await db.query("update missing_nom_b_reminders set status=$1 where stem_id='stem-1'",[status]);
    const claim=randomUUID();const state=await value('select missing_nom_b_claim_scan($1,$2) v',[org,claim]);
    const id=`new-${status}`;
    await value('select missing_nom_b_checkpoint($1,$2,$3,$4,$5,true) v',[org,claim,JSON.stringify([{stemId:'stem-1',invoiceId:id,invoice:{Id:id}}]),state.scan_until,'']);
    assert.equal(await value("select status v from missing_nom_b_reminders where stem_id='stem-1'"),status==='Suppressed'?'Pending':status);
   }
   await db.query("update missing_nom_b_reminders set status='Pending' where stem_id='stem-1'");
  });
  const workerToken=randomUUID();let row;
  await t.test('overlapping workers claim each reminder only once and Sending expiry is held',async()=>{
   const [a,b]=await Promise.all([db.query('select * from missing_nom_b_claim_reminders($1,$2,20)',[org,workerToken]),other.query('select * from missing_nom_b_claim_reminders($1,$2,20)',[org,randomUUID()])]);
   assert.equal(a.rowCount+b.rowCount,1);row=(a.rows[0]||b.rows[0]);
   await db.query("update missing_nom_b_reminders set status='Sending',claim_until=now()-interval '1 minute' where id=$1",[row.id]);
   assert.equal((await db.query('select * from missing_nom_b_claim_reminders($1,$2,20)',[org,randomUUID()])).rowCount,0);
   assert.equal(await value('select status v from missing_nom_b_reminders where id=$1',[row.id]),'Uncertain');
  });
  const user=randomUUID();const op=randomUUID();const claim=randomUUID();
  const reserveArgs=[org,op,user,'stem-2','nom-2','hash','fingerprint',claim];
  const reserveSql='select missing_nom_b_reserve_upload($1,$2,$3,$4,$5,$6,$7,$8) v';
  await t.test('reservation rejects changed hash and lets a new operation replace only expired Reserved',async()=>{
   assert.equal((await value(reserveSql,reserveArgs)).acquired,true);
   await assert.rejects(db.query(reserveSql,[org,op,user,'stem-2','nom-2','changed','fingerprint',randomUUID()]),/OPERATION_MISMATCH/);
   await assert.rejects(db.query(reserveSql,[org,randomUUID(),user,'stem-2','nom-2','hash','fingerprint',randomUUID()]),/UPLOAD_IN_FLIGHT/);
   await db.query("update missing_nom_b_upload_operations set claim_until=now()-interval '1 second' where operation_id=$1",[op]);
   const nextOp=randomUUID();assert.equal((await value(reserveSql,[org,nextOp,user,'stem-2','nom-2','hash','fingerprint',randomUUID()])).acquired,true);
   assert.equal(await value('select status v from missing_nom_b_upload_operations where operation_id=$1',[op]),'Rejected');
   assert.equal(await value("select missing_nom_b_upload_transition($1,$2,$3,'Posting') v",[org,op,claim]),false);
  });
  await t.test('active or uncertain upload excludes sending, but abandoned pre-POST upload does not',async()=>{
   await db.query("insert into missing_nom_b_reminders(source_org_id,stem_id,invoice_id,status,claim_token,claim_until) values($1,'stem-2','invoice-2','Processing',$2,now()+interval '5 minutes')",[org,workerToken]);
   const r=await value("select id v from missing_nom_b_reminders where stem_id='stem-2'");
   const begin=[r,workerToken,'nom-2',user,'trader@example.invalid','fingerprint',JSON.stringify({Id:'invoice-2'})];
   assert.equal(await value('select missing_nom_b_begin_send($1,$2,$3,$4,$5,$6,$7) v',begin),false);
   await db.query("update missing_nom_b_upload_operations set claim_until=now()-interval '1 minute' where stem_id='stem-2' and status='Reserved'");
   assert.equal(await value('select missing_nom_b_begin_send($1,$2,$3,$4,$5,$6,$7) v',begin),true);
   await assert.rejects(db.query(reserveSql,[org,randomUUID(),user,'stem-2','nom-2','hash','fingerprint',randomUUID()]),/REMINDER_IN_FLIGHT/);
  });
  await t.test('concurrent send and upload transactions serialize on the same STEM lock',async()=>{
   await db.query("insert into missing_nom_b_reminders(source_org_id,stem_id,invoice_id,status,claim_token,claim_until) values($1,'stem-3','invoice-3','Processing',$2,now()+interval '5 minutes')",[org,workerToken]);
   const r=await value("select id v from missing_nom_b_reminders where stem_id='stem-3'");
   await db.query('begin');
   assert.equal(await value('select missing_nom_b_begin_send($1,$2,$3,$4,$5,$6,$7) v',[r,workerToken,'nom-3',user,'trader@example.invalid','f',JSON.stringify({Id:'invoice-3'})]),true);
   const pending=other.query(reserveSql,[org,randomUUID(),user,'stem-3','nom-3','hash','f',randomUUID()]).then(()=>({success:true}),e=>({error:e.message}));
   await db.query('commit');assert.match((await pending).error,/REMINDER_IN_FLIGHT/);
  });
  await t.test('expired Sending becomes Uncertain during filing even if cron is disabled',async()=>{
   await db.query("update missing_nom_b_reminders set claim_until=now()-interval '1 minute' where stem_id='stem-3'");
   assert.equal((await value(reserveSql,[org,randomUUID(),user,'stem-3','nom-3','hash','f',randomUUID()])).acquired,true);
   assert.equal(await value("select status v from missing_nom_b_reminders where stem_id='stem-3'"),'Uncertain');
  });
  await t.test('Posting remains held despite lease expiry and supports verified reconciliation only',async()=>{
   const op4=randomUUID(),token4=randomUUID();await value(reserveSql,[org,op4,user,'stem-4','nom-4','hash','f',token4]);
   assert.equal(await value("select missing_nom_b_upload_transition($1,$2,$3,'Posting') v",[org,op4,token4]),true);
   await db.query("update missing_nom_b_upload_operations set claim_until=now()-interval '1 hour' where operation_id=$1",[op4]);
   await assert.rejects(db.query(reserveSql,[org,randomUUID(),user,'stem-4','nom-4','hash','f',randomUUID()]),/UPLOAD_IN_FLIGHT/);
   const retry=await value(reserveSql,[org,op4,user,'stem-4','nom-4','hash','changed',randomUUID()]);assert.equal(retry.acquired,false);assert.equal(retry.status,'Posting');
   assert.equal(await value("select missing_nom_b_upload_transition($1,$2,$3,'Completed',$4) v",[org,op4,token4,JSON.stringify({verified:true})]),true);
   assert.equal((await value(reserveSql,[org,op4,user,'stem-4','nom-4','hash','f',randomUUID()])).result.verified,true);
  });
 } finally {await other.end();await db.end();}
});
