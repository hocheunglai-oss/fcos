import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('company financing rate is service-only, permission checked, revisioned and atomically audited', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  const admin = randomUUID(); const finance = randomUUID(); const viewer = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.user_profiles(id uuid primary key, active boolean not null, user_type text, email text);
    create table public.user_module_permissions(user_id uuid, module_id text, can_view boolean);
    create table public.user_type_module_permissions(user_type_id text, module_id text, can_view boolean);
    grant usage on schema public to service_role;
    grant select on public.user_profiles,public.user_module_permissions,public.user_type_module_permissions to service_role;`);
  await db.query("insert into user_profiles values ($1,true,'administrator','admin@example.test'),($2,true,'finance','finance@example.test'),($3,true,'viewer','viewer@example.test')", [admin, finance, viewer]);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const filename = (await readdir(directory)).find((name) => name.endsWith('_dashboard_finance_settings.sql'));
  await db.exec(await readFile(new URL(filename, directory), 'utf8'));
  const save = (rate, revision, actor = finance) => db.query('select * from save_company_finance_settings($1,$2,$3)', [rate, revision, actor]);
  await db.exec('set role service_role');
  assert.equal(Number((await db.query('select annual_interest_rate_pct from company_finance_settings')).rows[0].annual_interest_rate_pct), 5);
  await assert.rejects(save(6, 1, viewer), /permission/);
  for (const rate of [null, -1, 101, 5.001, 'NaN']) await assert.rejects(save(rate, 1), /financing rate/);
  const first = (await save(6.25, 1)).rows[0]; assert.equal(Number(first.revision), 2); assert.equal(first.updated_by_email, 'finance@example.test');
  await assert.rejects(save(7, 1, admin), /changed after/);
  assert.equal((await db.query('select count(*)::int n from company_finance_setting_events')).rows[0].n, 1);
  assert.equal(Number((await save(6.25, 2)).rows[0].revision), 2);
  await db.exec('reset role');
  await db.query("insert into user_module_permissions values ($1,'financial_report_settings_manage',false)", [finance]);
  await db.exec('set role service_role'); await assert.rejects(save(7, 2), /permission/);
  await save(0, 2, admin);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    for (const table of ['company_finance_settings', 'company_finance_setting_events']) await assert.rejects(db.exec(`select * from ${table}`), /permission denied/);
    await assert.rejects(save(7, 3, admin), /permission denied/);
  }
  await db.exec('reset role'); await db.query('update user_profiles set active=false where id=$1', [admin]);
  await db.exec('set role service_role'); await assert.rejects(save(7, 3, admin), /permission/);
  await db.exec('reset role'); await db.query('delete from user_profiles where id=$1', [finance]);
  const event = (await db.query('select actor_user_id,actor_email from company_finance_setting_events where revision=2')).rows[0];
  assert.equal(event.actor_user_id, null); assert.equal(event.actor_email, 'finance@example.test');
});
