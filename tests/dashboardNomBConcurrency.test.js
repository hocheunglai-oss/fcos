import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

test('Nom B real PostgreSQL serializes policy edits and rejects stale observations', { skip: !process.env.FCOS_NOM_B_TEST_DATABASE_URL }, async (t) => {
  const endpoint = new URL(process.env.FCOS_NOM_B_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Concurrency tests require a local PostgreSQL instance.');
  assert.ok(['postgres:', 'postgresql:'].includes(endpoint.protocol));
  const admin = new pg.Client({ connectionString: endpoint.toString() }); await admin.connect();
  const database = `fcos_nom_b_${randomUUID().replaceAll('-', '')}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end(); }
    await admin.query(`drop database if exists "${database}" with(force)`); await admin.end();
  });
  await admin.query(`create database "${database}"`); endpoint.pathname = `/${database}`;
  const connect = async () => { const client = new pg.Client({ connectionString: endpoint.toString() }); await client.connect(); clients.push(client); await client.query("set statement_timeout='8s'; set lock_timeout='4s'"); return client; };
  const primary = await connect(); const left = await connect(); const right = await connect();
  await primary.query(`create table public.user_profiles(id uuid primary key,active boolean,user_type text,email text,full_name text);
    create table public.collaboration_roles(user_id uuid,role text,active boolean);
    grant usage on schema public to service_role;
    grant select on public.user_profiles,public.collaboration_roles to service_role;`);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const filename = (await readdir(directory)).find((name) => name.endsWith('_dashboard_nom_b_policies.sql'));
  await primary.query(await readFile(new URL(filename, directory), 'utf8'));
  const actor = randomUUID(); const stem = 'a0H000000000001AAA';
  await primary.query("insert into user_profiles values($1,true,'administrator','admin@example.test','Admin')", [actor]);
  await left.query('set role service_role'); await right.query('set role service_role');
  const save = (client, mode, revision) => client.query('select * from save_dashboard_nom_b_policy($1,$2,$3,$4,$5,$6)', [stem, mode, mode === 'automatic' ? null : 'other', mode === 'automatic' ? '' : 'Reviewed', revision, actor]);
  const race = await Promise.allSettled([save(left, 'waive', 0), save(right, 'require', 0)]);
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(race.find((result) => result.status === 'rejected').reason.code, '40001');
  assert.equal((await primary.query('select count(*)::int n from dashboard_nom_b_events')).rows[0].n, 1);
  await save(left, 'automatic', 1);
  const observe = (client, revision, at, status = 'waived') => client.query('select observe_dashboard_nom_b($1,$2,$3)', [JSON.stringify([{ stemId: stem, status, waiverType: status === 'waived' ? 'automatic' : null, policyRevision: revision, evidence: { balance: '99.99', currency: 'USD', rate: '1', invoiceIds: ['invoice'] } }]), actor, at]);
  const base = new Date(Date.now() - 10000).toISOString(); const newer = new Date(Date.now() - 9000).toISOString();
  await Promise.all([observe(left, 2, base), observe(right, 2, newer)]);
  assert.equal((await primary.query("select count(*)::int n from dashboard_nom_b_events where event_type='status_changed'")).rows[0].n, 1);
  assert.equal(new Date((await primary.query('select observed_at from dashboard_nom_b_observations')).rows[0].observed_at).toISOString(), newer);
  await left.query('begin'); await save(left, 'require', 2);
  const pending = observe(right, 2, new Date(Date.now() - 5000).toISOString(), 'missing').then(() => ({ ok: true }), (error) => ({ error }));
  await left.query('commit');
  const outcome = await pending; assert.equal(outcome.error?.code, '40001');
  assert.equal((await primary.query('select status from dashboard_nom_b_observations')).rows[0].status, 'waived');
  assert.equal((await primary.query('select revision from dashboard_nom_b_policies')).rows[0].revision, '3');
  // A failing immutable-history write aborts the entire policy transaction.
  await left.query('begin'); await save(left, 'waive', 3);
  await assert.rejects(left.query("update dashboard_nom_b_events set reason_text='rewritten'"), /permission/i);
  await left.query('rollback');
  assert.equal((await primary.query('select revision from dashboard_nom_b_policies')).rows[0].revision, '3');
});
