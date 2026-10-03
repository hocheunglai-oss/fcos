import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('personal Markets storage is private, owner-scoped and rejects stale revisions atomically', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  const alice = randomUUID(); const bob = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.user_profiles(id uuid primary key, active boolean not null);
    grant usage on schema public to service_role;
    grant select on public.user_profiles to service_role;`);
  await db.query('insert into public.user_profiles values ($1,true),($2,true)', [alice,bob]);
  await db.exec(await readFile(new URL('../supabase/migrations/20260920105042_market_trader_workspace.sql', import.meta.url), 'utf8'));
  const save = (owner, actor, state, revision) => db.query('select * from public.save_market_trader_workspace($1,$2,$3,$4)', [owner,actor,state,revision]);
  await db.exec('set role service_role');
  const first = (await save(alice,alice,{ preferences: { pins: ['one'] } },0)).rows[0];
  assert.equal(Number(first.revision),1);
  await assert.rejects(save(alice,bob,{},1), /active owner/);
  await assert.rejects(save(alice,alice,{},0), /another session/);
  await assert.rejects(save(alice,alice,[],1), /Invalid personal/);
  await assert.rejects(save(alice,alice,{ tooLarge: 'x'.repeat(250001) },1), /Invalid personal/);
  assert.deepEqual((await db.query('select state from market_trader_workspaces where user_id=$1',[alice])).rows[0].state, first.state);
  const second = (await save(alice,alice,{ preferences: { pins: [] } },1)).rows[0];
  assert.equal(Number(second.revision),2);
  await save(bob,bob,{ preferences: { pins: ['different'] } },0);
  assert.equal((await db.query('select count(*)::int n from market_trader_workspaces')).rows[0].n,2);
  for (const role of ['anon','authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    for (const sql of ['select * from market_trader_workspaces', "insert into market_trader_workspaces(user_id) values (gen_random_uuid())", "update market_trader_workspaces set state='{}'", 'delete from market_trader_workspaces']) await assert.rejects(db.exec(sql), /permission denied/);
    await assert.rejects(save(alice,alice,{},2), /permission denied/);
  }
  await db.exec('reset role');
  await db.query('update user_profiles set active=false where id=$1',[alice]);
  await db.exec('set role service_role');
  await assert.rejects(save(alice,alice,{},2), /active owner/);
});
