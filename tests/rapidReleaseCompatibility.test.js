import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA_FINGERPRINT_SQL } from '../scripts/lib/rapid-release/compatibility.mjs';
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
