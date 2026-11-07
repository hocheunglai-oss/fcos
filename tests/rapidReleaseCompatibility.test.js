import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_FINGERPRINT_SQL, withPinnedReadOnlyDatabase } from '../scripts/lib/rapid-release/compatibility.mjs';
import { createManagedRoleFixture, dummyDelegation, PUBLIC_CA } from './helpers/rapidDatabaseDelegationFixture.mjs';
test('native compatibility fingerprint detects view semantics, owner and role drift without hashing business rows',async()=>{
 const db=new PGlite();try{
  await db.exec("create table public.compatibility_fixture(id int);create view public.compatibility_view as select 1::int as value;create role compatibility_owner;create function public.compatibility_function() returns int language sql as 'select 1'");
  const fingerprint=async()=> (await db.query(SCHEMA_FINGERPRINT_SQL)).rows[0].digest;
  const original=await fingerprint();assert.match(original,/^[a-f0-9]{64}$/);
  await db.exec('insert into public.compatibility_fixture values(123)');assert.equal(await fingerprint(),original);
  await db.exec('create or replace view public.compatibility_view as select 2::int as value');const view=await fingerprint();assert.notEqual(view,original);
  await db.exec('alter function public.compatibility_function() owner to compatibility_owner');const owner=await fingerprint();assert.notEqual(owner,view);
  await db.exec('alter role compatibility_owner inherit');const role=await fingerprint();
  await db.exec('grant compatibility_owner to postgres');assert.notEqual(await fingerprint(),role);
 }finally{await db.close();}
});

test('only exact managed CLI role expiry is operational metadata; all privileges and other expiries remain hashed', async () => {
 const db=new PGlite();try{
  await createManagedRoleFixture(db);
  await db.exec("create role other_expiring valid until '2030-01-01';create role cli_login_readonly valid until '2030-01-01'");
  const fingerprint=async()=> (await db.query(SCHEMA_FINGERPRINT_SQL)).rows[0].digest;
  const original=await fingerprint();
  await db.exec("alter role cli_login_postgres valid until '2031-01-01'");assert.equal(await fingerprint(),original);
  await db.exec("alter role other_expiring valid until '2031-01-01'");const other=await fingerprint();assert.notEqual(other,original);
  await db.exec("alter role cli_login_readonly valid until '2031-01-01'");const readonly=await fingerprint();assert.notEqual(readonly,other);
  await db.exec('alter role cli_login_postgres createdb');const privilege=await fingerprint();assert.notEqual(privilege,readonly);
  await db.exec("alter role cli_login_postgres valid until '2032-01-01'");assert.notEqual(await fingerprint(),privilege);
  await db.exec('alter role cli_login_postgres nocreatedb');const safe=await fingerprint();
  await db.exec('grant postgres to cli_login_postgres with inherit true granted by supabase_admin');assert.notEqual(await fingerprint(),safe);
 }finally{await db.close();}
});

test('read-only compatibility uses native delegated identity and legacy paths remain strict', async () => {
 const native=new PGlite();try{
  const fixture=await dummyDelegation(native);
  let observed;
  await withPinnedReadOnlyDatabase({openDatabase:fixture.open},async db=>{
   observed=(await db.query("select session_user,current_user,current_database() as database,current_setting('transaction_read_only') as read_only")).rows[0];
   assert.equal(observed.session_user,'cli_login_postgres');assert.equal(observed.current_user,'postgres');assert.equal(observed.read_only,'on');
  });
  assert.equal(observed.session_user,'cli_login_postgres');
  let callbackRan=false;
  const connection={host:'aws-0-ap-southeast-1.pooler.supabase.com',port:5432,user:'postgres.pjforfvchygdyqfcgpmw',database:'postgres',ssl:{rejectUnauthorized:true}};
  const db={query:sql=>native.query(sql),end:async()=>{}};
  await assert.rejects(withPinnedReadOnlyDatabase({openDatabase:async()=>({db,connection})},async()=>{callbackRan=true;}),/DATABASE_IDENTITY_MISMATCH/);
  assert.equal(callbackRan,false);
 }finally{await native.close();}
});

test('ambiguous env credentials refuse before Management store creation or provider calls', async () => {
 let created=false;
 await assert.rejects(withPinnedReadOnlyDatabase({env:{FCOS_RAPID_SUPABASE_ACCESS_TOKEN:'DUMMY_ONLY_TOKEN',FCOS_RAPID_DATABASE_URL:'postgresql://dummy'},
  createIntentStore:async()=>{created=true;}},async()=>{}),/CREDENTIAL_AMBIGUOUS/);
 assert.equal(created,false);
});

test('management env uses the source-owned intent factory and preserves actual delegated readonly identity', async t => {
 const native=new PGlite(),directory=mkdtempSync(join(tmpdir(),'fcos-management-compatibility-'));
 try{
  const fixture=await dummyDelegation(native),ca=join(directory,'public-project-ca.crt');writeFileSync(ca,PUBLIC_CA);
  t.mock.method(globalThis,'fetch',fixture.deps.fetchImpl);
  let storeContext,observed;
  await withPinnedReadOnlyDatabase({env:{FCOS_RAPID_SUPABASE_ACCESS_TOKEN:fixture.credential.token,FCOS_RAPID_DATABASE_CA:ca},
   createClient:fixture.deps.Client,createIntentStore:async context=>{storeContext=context;return fixture.intentStore;}},async db=>{
    observed=(await db.query('select session_user,current_user')).rows[0];
   });
  assert.equal(storeContext.credential.kind,'supabase_management');
  assert.equal(storeContext.purpose,'rapid_compatibility_read_only');
  assert.match(storeContext.source.sha,/^[a-f0-9]{40}$/);
  assert.equal(resolve(storeContext.directory),resolve(fileURLToPath(new URL('../',import.meta.url))));
  assert.equal(observed.session_user,'cli_login_postgres');assert.equal(observed.current_user,'postgres');
 }finally{await native.close();rmSync(directory,{recursive:true,force:true});}
});
