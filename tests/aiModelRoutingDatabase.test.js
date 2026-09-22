import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const sql = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('AI routing migration preserves overrides, revisions, usage totals and server-only storage', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.user_profiles(id uuid primary key);
    create schema emailrouter;
    create table public.hedge_settings(key text primary key,value jsonb,revision bigint default 1);
    create table emailrouter.settings(key text primary key,value jsonb,revision bigint default 1,updated_at timestamptz default now());
    create function public.hedge_touch_revision() returns trigger language plpgsql as $$begin new.revision=old.revision+1; return new; end$$;
    create trigger hedge_settings_touch_revision before update on public.hedge_settings for each row execute function public.hedge_touch_revision();
    insert into hedge_settings(key,value) values('assistant_model','"gpt-5-mini-2025-08-07"');
    insert into emailrouter.settings(key,value) values('advisor.model','{"modelId":"gpt-5-mini-2025-08-07"}');`);
  await db.exec(await sql('20260730180403_dashboard_ai_settings.sql'));
  await db.exec(await sql('20260730190759_dashboard_ai_usage_tracking.sql'));
  const migration = await sql('20260922195630_ai_task_model_routing.sql');
  await db.exec(migration);
  assert.deepEqual((await db.query('select model_id,revision::int from dashboard_ai_settings')).rows, [{ model_id: 'auto', revision: 2 }]);
  assert.equal((await db.query('select value from hedge_settings')).rows[0].value, 'auto');
  assert.equal((await db.query('select revision::int from hedge_settings')).rows[0].revision, 2);
  assert.equal((await db.query('select value from emailrouter.settings')).rows[0].value.modelId, 'auto');
  await db.exec("insert into dashboard_ai_usage_events(openai_response_id,model_id,input_tokens,output_tokens,estimated_cost_usd,pricing_as_of) values('test-astra','gpt-6-astra',1000,100,0.015,'2026-09-23')");
  const summary = (await db.query("select * from dashboard_ai_usage_summary(current_date) where model_id='gpt-6-astra'")).rows[0];
  assert.equal(Number(summary.all_time_calls), 1);
  assert.equal(Number(summary.all_time_cost_usd), 0.015);
  await assert.rejects(db.exec("insert into dashboard_ai_usage_events(openai_response_id,model_id,pricing_as_of) values('bad','auto','2026-09-23')"), /check constraint/);
  await assert.rejects(db.exec("update dashboard_ai_settings set model_id='unapproved-model'"), /check constraint/);
  await db.exec("update dashboard_ai_settings set model_id='gpt-5.6-sol',revision=3; update hedge_settings set value='\"gpt-5.6-sol\"'; update emailrouter.settings set value='{\"modelId\":\"gpt-5.6-sol\"}',revision=3");
  await db.exec(migration);
  assert.equal((await db.query('select model_id from dashboard_ai_settings')).rows[0].model_id, 'gpt-5.6-sol');
  assert.equal((await db.query('select value from hedge_settings')).rows[0].value, 'gpt-5.6-sol');
  assert.equal((await db.query('select value from emailrouter.settings')).rows[0].value.modelId, 'gpt-5.6-sol');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from dashboard_ai_settings'), /permission denied/);
    await assert.rejects(db.query('select * from dashboard_ai_usage_summary(current_date)'), /permission denied/);
    await db.exec('reset role');
  }
});
