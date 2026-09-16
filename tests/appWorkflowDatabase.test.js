import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { workflowRequestOutcome } from '../api/_workflowMetrics.js';

test('workflow migration gives atomic task retries and service-only aggregate metrics', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const actor = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.user_profiles(id uuid primary key, active boolean);
    create table public.test_items(id uuid primary key default gen_random_uuid(), title text);
    grant usage on schema public to service_role;
    grant all on public.user_profiles,public.test_items to service_role;
    create function public.create_collaboration_item(jsonb,uuid,text) returns jsonb language plpgsql as $$
    declare saved_id uuid;
    begin
      insert into public.test_items(title) values($1->>'title') returning id into saved_id;
      return jsonb_build_object('item',jsonb_build_object('id',saved_id));
    end;$$;
    create function public.save_collaboration_template(jsonb,uuid,text) returns jsonb language sql as $$
      select jsonb_build_object('project',public.create_collaboration_item($1->'project',$2,$3)->'item'); $$;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260916223258_app_workflow_reliability.sql', import.meta.url), 'utf8'));
  await db.query('insert into public.user_profiles values ($1,true)', [actor]);
  const key = randomUUID();
  await db.exec('set role service_role');
  const save = (values = { title: 'One task' }, request = key) => db.query('select public.create_collaboration_item_once($1,$2,$3,$4) result', [request, values, actor, 'test@example.invalid']);
  const first = (await save()).rows[0].result;
  const retry = (await save()).rows[0].result;
  assert.equal(retry.item.id, first.item.id);
  assert.equal(retry.replayed, true);
  await assert.rejects(save({ title: 'Changed request' }), /already saved different values/);
  assert.equal((await db.query('select count(*)::int count from test_items')).rows[0].count, 1);
  const templateKey = randomUUID();
  await save({ title: 'Project', _templateId: randomUUID() }, templateKey);
  await db.query('delete from test_items where id=$1', [first.item.id]);
  await save();
  assert.equal((await db.query('select count(*)::int count from test_items')).rows[0].count, 1, 'retry cannot recreate a deleted task');
  await db.query("select public.record_workflow_metric('variableChargesSideConfirm','completed',120)");
  await db.query("select public.record_workflow_metric('variableChargesSideConfirm','completed',80)");
  assert.deepEqual((await db.query('select request_count::int,duration_ms::int from workflow_daily_metrics')).rows, [{ request_count: 2, duration_ms: 200 }]);
  await assert.rejects(db.query("select public.record_workflow_metric('private@example.com','completed',1)"), /check constraint/);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(db.query('select * from workflow_daily_metrics'), /permission denied/);
    await assert.rejects(save(), /permission denied/);
    await assert.rejects(db.query("select public.record_workflow_metric('x','completed',1)"), /permission denied/);
  }
});

test('aggregate outcome classification keeps conflicts and uncertain writes separate', () => {
  assert.equal(workflowRequestOutcome(409), 'conflict');
  assert.equal(workflowRequestOutcome(403), 'denied');
  assert.equal(workflowRequestOutcome(400), 'invalid');
  assert.equal(workflowRequestOutcome(200, { run: { status: 'partial' } }), 'uncertain');
  assert.equal(workflowRequestOutcome(200, { error: 'failure' }), 'failed');
});
