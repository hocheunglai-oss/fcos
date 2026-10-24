import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import { processEmailRouterLearningJobs } from '../api/_emailRouterLearning.js';

const migration = new URL('../supabase/migrations/20260930125611_email_router_learning_recovery.sql', import.meta.url);
const claimName = 'claim_emailrouter_learning_job';
const finalizeName = 'finalize_emailrouter_learning_job';
const result = {
  routing_category: 'market_report', sender_fingerprint: 'a'.repeat(64),
  sender_domain_fingerprint: 'b'.repeat(64), subject_token_fingerprints: ['c'.repeat(64)],
  attachment_profile: 'none', usage: {
    model_id: 'test-model', provider_request_id: 'response-1', input_tokens: 10,
    cached_input_tokens: 0, output_tokens: 5, reasoning_tokens: 0, total_tokens: 15, cost_usd: 0,
  },
};

function tableSql(source, name) {
  const start = source.indexOf(`create table if not exists emailrouter.${name} (`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n);', start) + 3);
}

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema emailrouter;
    create table public.user_profiles (id uuid primary key);
    create table emailrouter.mailbox_connections (id uuid primary key);
    create table emailrouter.routing_presets (id uuid primary key);
    create table emailrouter.routing_folders (id uuid primary key);
    create table emailrouter.destinations (id uuid primary key);
    create table emailrouter.destination_groups (id uuid primary key);
  `);
  const base = await readFile(new URL('../supabase/migrations/20260803090000_native_emailrouter_schema.sql', import.meta.url), 'utf8');
  const learning = await readFile(new URL('../supabase/migrations/20260807120000_email_router_forward_file_learning.sql', import.meta.url), 'utf8');
  for (const name of ['messages', 'mail_actions', 'mail_action_destinations', 'ai_usage_events']) {
    await db.exec(tableSql(base, name));
  }
  await db.exec(`alter table emailrouter.mail_actions add column post_action_mode text,
    add column post_action_folder_id uuid references emailrouter.routing_folders(id),
    add column learning_state text, add column learning_recipients_complete boolean;`);
  for (const name of ['advisor_learning_outcomes', 'advisor_learning_outcome_destinations', 'advisor_learning_jobs']) {
    await db.exec(tableSql(learning, name));
  }
  await db.exec(`grant usage on schema public, emailrouter to service_role;
    grant select, insert, update, delete on all tables in schema emailrouter to service_role;`);
  await db.exec(await readFile(migration, 'utf8'));
  const mailbox = { id: randomUUID() };
  await db.query('insert into emailrouter.mailbox_connections values ($1)', [mailbox.id]);
  const seed = async ({ mailboxId = mailbox.id, state = 'pending', attempts = 0, expired = false } = {}) => {
    const ids = { job: randomUUID(), action: randomUUID(), message: randomUUID(), destination: randomUUID() };
    await db.query('insert into emailrouter.mailbox_connections values ($1) on conflict do nothing', [mailboxId]);
    await db.query("insert into emailrouter.messages(id, mailbox_id, provider_message_id, folder_key) values ($1,$2,$3,'archive')", [ids.message, mailboxId, `provider-${ids.message}`]);
    await db.query(`insert into emailrouter.mail_actions(id,message_id,action_type,state,confirmed_at,idempotency_key,request_fingerprint,post_action_mode,learning_state,learning_recipients_complete)
      values ($1,$2,'forward','confirmed',now(),$3,$4,'keep_current','pending',true)`, [ids.action, ids.message, randomUUID(), 'f'.repeat(64)]);
    await db.query('insert into emailrouter.destinations values ($1)', [ids.destination]);
    await db.query("insert into emailrouter.mail_action_destinations(mail_action_id,destination_id,recipient_kind,position) values ($1,$2,'to',1)", [ids.action, ids.destination]);
    await db.query(`insert into emailrouter.advisor_learning_jobs(id,mail_action_id,state,attempt_count,updated_at)
      values ($1,$2,$3,$4,now() - case when $5 then interval '7 minutes' else interval '0' end)`, [ids.job, ids.action, state, attempts, expired]);
    return ids;
  };
  const claim = async (mailboxId = mailbox.id) => (await db.query(`select public.${claimName}($1) as result`, [mailboxId])).rows[0].result;
  const finish = async (job, payload = result, failure = null) => (await db.query(`select public.${finalizeName}($1,$2,$3,$4,$5) as result`,
    [job.id, job.attempt_count, job.updated_at, payload, failure])).rows[0].result;
  const snapshot = async () => (await db.query(`select
    (select coalesce(jsonb_agg(to_jsonb(j) order by id), '[]') from emailrouter.advisor_learning_jobs j) jobs,
    (select coalesce(jsonb_agg(to_jsonb(a) order by id), '[]') from emailrouter.mail_actions a) actions,
    (select coalesce(jsonb_agg(to_jsonb(o) order by id), '[]') from emailrouter.advisor_learning_outcomes o) outcomes,
    (select coalesce(jsonb_agg(to_jsonb(d) order by outcome_id), '[]') from emailrouter.advisor_learning_outcome_destinations d) destinations,
    (select coalesce(jsonb_agg(to_jsonb(u) order by id), '[]') from emailrouter.ai_usage_events u) usage`)).rows[0];
  return { db, mailbox, seed, claim, finish, snapshot };
}

function workerClient(f, { afterRpc, settings = [] } = {}) {
  const calls = [];
  return {
    calls,
    schema() { return { from(name) {
      assert.equal(name, 'settings');
      return { select() { return this; }, in() { return this; }, abortSignal() {
        return Promise.resolve({ data: settings, error: null });
      } };
    } }; },
    rpc(name, args) {
      calls.push({ name, args });
      return { abortSignal: async () => {
        try {
          const data = name === claimName ? await f.claim(args.p_mailbox_id)
            : await f.finish({ id: args.p_job_id, attempt_count: args.p_attempt_count, updated_at: args.p_claimed_at }, args.p_result ?? null, args.p_failure_code ?? null);
          await afterRpc?.(name, args, data);
          return { data, error: null };
        } catch (error) { return { data: null, error }; }
      } };
    },
  };
}

function providers(overrides = {}) {
  const calls = { detail: 0, ai: 0 };
  return { calls, dependencies: {
    apiKey: 'test-only', env: { FCOS_EMAIL_ROUTER_LEARNING_KEY: 'x'.repeat(32) },
    fetchDetail: async (_args, dependencies) => {
      calls.detail += 1;
      const response = await dependencies.fetchImpl('https://graph.microsoft.com/v1.0/test');
      return response.json();
    },
    fetchImpl: async (url, options = {}) => {
      assert.ok(options.signal, 'every provider request must have a bounded signal');
      if (String(url).includes('api.openai.com')) {
        calls.ai += 1;
        return new Response(JSON.stringify({ id: 'response-1', output_text: '{"routingCategory":"market_report"}', usage: { input_tokens: 10, output_tokens: 5 } }));
      }
      return new Response(JSON.stringify({ subject: 'Fuel report', from: { emailAddress: { address: 'reports@example.test' } }, bodyPreview: 'Market report' }));
    },
    ...overrides,
  } };
}

test('expired processing is reclaimed once; stale completion and failure cannot mutate replacement results', async (t) => {
  const f = await fixture(t);
  const ids = await f.seed();
  const first = await f.claim();
  assert.equal(await f.claim(), null, 'live leases cannot be reclaimed');
  await f.db.query("update emailrouter.advisor_learning_jobs set updated_at=now()-interval '5 minutes 30 seconds' where id=$1", [ids.job]);
  assert.equal(await f.claim(), null, 'rollout recovery must wait beyond the old 300s invocation lifetime');
  await f.db.query("update emailrouter.advisor_learning_jobs set updated_at=now()-interval '7 minutes' where id=$1", [ids.job]);
  const replacement = await f.claim();
  assert.equal(replacement.attempt_count, 2);
  assert.equal(await f.finish(first), false);
  assert.equal(await f.finish(replacement), true);
  const before = await f.snapshot();
  assert.equal(await f.finish(first, { ...result, routing_category: 'invoice' }), false);
  assert.equal(await f.finish(first, null, 'stale_worker_failed'), false);
  assert.deepEqual(await f.snapshot(), before);
  assert.equal(before.outcomes[0].routing_category, 'market_report');
  assert.equal(before.jobs[0].state, 'completed');
  assert.equal(before.actions[0].learning_state, 'completed');
});

test('finalization is atomic, idempotent, fenced after expiry, and rolls back invalid recipient persistence', async (t) => {
  const f = await fixture(t);
  const ids = await f.seed();
  const job = await f.claim();
  const before = await f.snapshot();
  await f.db.exec(`create function emailrouter.fail_recipient_test() returns trigger language plpgsql as $$
    begin raise exception 'synthetic recipient failure'; end; $$;
    create trigger fail_recipient before insert on emailrouter.advisor_learning_outcome_destinations
    for each row execute function emailrouter.fail_recipient_test();`);
  await assert.rejects(f.finish(job), /synthetic recipient failure/);
  assert.deepEqual(await f.snapshot(), before, 'outcome, usage, job and action changes must all roll back');
  await f.db.exec('drop trigger fail_recipient on emailrouter.advisor_learning_outcome_destinations');
  assert.equal(await f.finish(job), true);
  const completed = await f.snapshot();
  assert.equal(await f.finish(job, { ...result, routing_category: 'invoice' }), true);
  assert.deepEqual(await f.snapshot(), completed);
  assert.equal(completed.outcomes.length, 1);
  assert.equal(completed.destinations.length, 1);
  assert.equal(completed.usage.length, 1);
  await f.db.query("update emailrouter.advisor_learning_jobs set state='processing',updated_at=now()-interval '7 minutes' where id=$1", [ids.job]);
  const expired = (await f.db.query('select to_jsonb(j) j from emailrouter.advisor_learning_jobs j where id=$1', [ids.job])).rows[0].j;
  const expiredBefore = await f.snapshot();
  assert.equal(await f.finish(expired), false, 'even unreplaced expired owners cannot publish');
  assert.deepEqual(await f.snapshot(), expiredBefore);
});

test('claim eligibility is mailbox-scoped, confirmed-action-only, and caps exhausted attempts', async (t) => {
  const f = await fixture(t);
  const otherMailbox = randomUUID();
  await f.seed({ mailboxId: otherMailbox });
  const notConfirmed = await f.seed();
  await f.db.query("update emailrouter.mail_actions set state='submitted',submitted_at=now() where id=$1", [notConfirmed.action]);
  assert.equal(await f.claim(), null);
  const exhausted = await f.seed({ state: 'processing', attempts: 5, expired: true });
  const retired = await f.claim();
  assert.equal(retired.id, exhausted.job);
  assert.equal(retired.exhausted, true);
  assert.equal(await f.claim(), null);
  const state = await f.snapshot();
  assert.equal(state.jobs.find((j) => j.id === exhausted.job).failure_code, 'email_router_learning_attempts_exhausted');
  assert.equal(state.actions.find((a) => a.id === exhausted.action).learning_state, 'failed');
  assert.ok(await f.claim(otherMailbox));
});

test('service role can execute recovery RPCs; public, anon and authenticated cannot', async (t) => {
  const f = await fixture(t);
  await f.seed();
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`set role ${role}`);
    await assert.rejects(f.claim(), /permission denied/);
    await assert.rejects(f.finish({ id: randomUUID(), attempt_count: 1, updated_at: new Date().toISOString() }), /permission denied/);
    await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role');
  const job = await f.claim();
  assert.equal(await f.finish(job), true);
  await f.db.exec('reset role');
});

test('simultaneous workers call the providers only once and create one complete outcome', async (t) => {
  const f = await fixture(t);
  await f.seed();
  const provider = providers();
  const client = workerClient(f);
  const runs = await Promise.all([
    processEmailRouterLearningJobs({ client, mailbox: f.mailbox }, provider.dependencies),
    processEmailRouterLearningJobs({ client, mailbox: f.mailbox }, provider.dependencies),
  ]);
  assert.equal(runs.reduce((sum, run) => sum + run.processed, 0), 1);
  assert.equal(runs.reduce((sum, run) => sum + run.completed, 0), 1);
  assert.deepEqual(provider.calls, { detail: 1, ai: 1 });
  const saved = await f.snapshot();
  assert.equal(saved.outcomes.length, 1);
  assert.equal(saved.destinations.length, 1);
  assert.equal(saved.usage.length, 1);
  t.diagnostic('PGlite serializes SQL transactions; this exercises overlapping worker invocations and generation fencing, not separate database connections.');
});

test('ordinary failures back off, retry when due, and stop at five provider attempts', async (t) => {
  const f = await fixture(t);
  const ids = await f.seed();
  let providerCalls = 0;
  const provider = providers({ fetchImpl: async () => { providerCalls += 1; throw Object.assign(new Error('temporary failure'), { code: 'PROVIDER_UNAVAILABLE' }); } });
  const client = workerClient(f);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const run = await processEmailRouterLearningJobs({ client, mailbox: f.mailbox }, provider.dependencies);
    assert.equal(run.failed, 1);
    const saved = await f.snapshot();
    assert.equal(saved.jobs[0].state, 'failed');
    assert.equal(saved.jobs[0].attempt_count, attempt);
    assert.equal(saved.jobs[0].failure_code, 'provider_unavailable');
    assert.ok(Date.parse(saved.jobs[0].next_attempt_at) > Date.now());
    assert.equal(saved.actions[0].learning_state, 'failed');
    assert.equal((await processEmailRouterLearningJobs({ client, mailbox: f.mailbox }, provider.dependencies)).processed, 0);
    await f.db.query("update emailrouter.advisor_learning_jobs set next_attempt_at=now()-interval '1 second' where id=$1", [ids.job]);
  }
  assert.equal((await processEmailRouterLearningJobs({ client, mailbox: f.mailbox }, provider.dependencies)).processed, 0);
  assert.equal(providerCalls, 5);
});

test('recovery reuses legacy outcomes and repairs recipients without resurrecting forgotten learning', async (t) => {
  const f = await fixture(t);
  const ids = await f.seed({ state: 'processing', attempts: 1, expired: true });
  await f.db.query(`insert into emailrouter.advisor_learning_outcomes(mail_action_id,mailbox_id,routing_category,action_type,post_action_mode,active,disabled_at,disabled_reason)
    values ($1,$2,'invoice','forward','keep_current',false,now(),'Forgotten by user')`, [ids.action, f.mailbox.id]);
  const original = (await f.snapshot()).outcomes[0];
  const provider = providers();
  const run = await processEmailRouterLearningJobs({ client: workerClient(f), mailbox: f.mailbox }, provider.dependencies);
  assert.equal(run.completed, 1);
  assert.deepEqual(provider.calls, { detail: 0, ai: 0 });
  const saved = await f.snapshot();
  assert.deepEqual(saved.outcomes[0], original);
  assert.equal(saved.destinations.length, 1);
  assert.equal(saved.usage.length, 0);
});

test('a lost finalization response never downgrades completion or repeats provider calls', async (t) => {
  const f = await fixture(t);
  await f.seed();
  const provider = providers();
  let responseLost = false;
  const client = workerClient(f, { afterRpc(name, args) {
    if (name === finalizeName && args.p_result && !responseLost) {
      responseLost = true;
      throw new Error('connection lost after commit');
    }
  } });
  await processEmailRouterLearningJobs({ client, mailbox: f.mailbox }, provider.dependencies);
  assert.equal((await f.snapshot()).jobs[0].state, 'completed');
  assert.equal((await processEmailRouterLearningJobs({ client, mailbox: f.mailbox }, provider.dependencies)).processed, 0);
  assert.deepEqual(provider.calls, { detail: 1, ai: 1 });
});

test('deadline prevents claims and stops subsequent work when the budget is spent', async (t) => {
  const f = await fixture(t);
  await f.seed();
  await f.seed();
  const client = workerClient(f);
  let now = 1_000;
  const provider = providers({ now: () => now });
  const noTime = await processEmailRouterLearningJobs({ client, mailbox: f.mailbox, deadlineAt: now + 74_999 }, provider.dependencies);
  assert.equal(noTime.deferred, true);
  assert.equal(client.calls.length, 0);
  const slowClient = workerClient(f, { afterRpc(name, args) { if (name === finalizeName && args.p_result) now += 50_000; } });
  const run = await processEmailRouterLearningJobs({ client: slowClient, mailbox: f.mailbox, deadlineAt: now + 100_000 }, provider.dependencies);
  assert.equal(run.completed, 1);
  assert.equal(run.deferred, true);
  assert.deepEqual(provider.calls, { detail: 1, ai: 1 });
  const saved = await f.snapshot();
  assert.equal(saved.jobs.filter((j) => j.state === 'pending').length, 1);
});

test('disabled learning performs no claim or provider work', async (t) => {
  const f = await fixture(t);
  await f.seed();
  const client = workerClient(f, { settings: [{ key: 'advisor.learning_enabled', value: { enabled: false } }] });
  const provider = providers();
  const run = await processEmailRouterLearningJobs({ client, mailbox: f.mailbox }, provider.dependencies);
  assert.equal(run.disabled, true);
  assert.equal(client.calls.length, 0);
  assert.deepEqual(provider.calls, { detail: 0, ai: 0 });
});

test('default learning budget is finite and checked again after each job', async (t) => {
  const f = await fixture(t);
  await f.seed(); await f.seed(); await f.seed();
  let now = 1_000;
  const provider = providers({ now: () => now });
  const client = workerClient(f, { afterRpc(name, args) { if (name === finalizeName && args.p_result) now += 60_000; } });
  const run = await processEmailRouterLearningJobs({ client, mailbox: f.mailbox }, provider.dependencies);
  assert.equal(run.completed, 2);
  assert.equal(run.deferred, true);
  assert.deepEqual(provider.calls, { detail: 2, ai: 2 });
});

test('timed out detail work cannot start classification when its late result arrives', async (t) => {
  const f = await fixture(t);
  await f.seed();
  let started;
  const detailStarted = new Promise((resolve) => { started = resolve; });
  let release;
  const blockedDetail = new Promise((resolve) => { release = resolve; });
  const provider = providers({ fetchDetail: async () => { started(); return blockedDetail; } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const processing = processEmailRouterLearningJobs({ client: workerClient(f), mailbox: f.mailbox }, provider.dependencies);
  await detailStarted;
  t.mock.timers.tick(50_000);
  const run = await processing;
  t.mock.timers.reset();
  assert.equal(run.failed, 1);
  release({ subject: 'Late message', bodyPreview: 'Delayed provider response' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(provider.calls.ai, 0);
  const saved = await f.snapshot();
  assert.equal(saved.jobs[0].failure_code, 'email_router_learning_timeout');
  assert.equal(saved.outcomes.length, 0);
});

test('an unavailable settings read has a five-second abort bound and never claims jobs', async (t) => {
  let settingsSignal;
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    assert.equal(milliseconds, 5_000);
    return controller.signal;
  });
  const client = {
    schema() { return { from() { return {
      select() { return this; }, in() { return this; },
      abortSignal(signal) {
        settingsSignal = signal;
        return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ error: new Error('timeout') }), { once: true }));
      },
    }; } }; },
    rpc() { assert.fail('settings timeout must not claim a job'); },
  };
  const run = processEmailRouterLearningJobs({ client, mailbox: { id: randomUUID() } });
  assert.equal(settingsSignal, controller.signal);
  controller.abort();
  await assert.rejects(run, (error) => error.code === 'EMAIL_ROUTER_LEARNING_SETTINGS_UNAVAILABLE');
});
