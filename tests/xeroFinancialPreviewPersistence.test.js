import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

const migration = new URL('../supabase/migrations/20260927154515_xero_financial_preview_persistence.sql', import.meta.url);
const signature = 'public.persist_xero_financial_preview_v1(jsonb,jsonb,text)';
const statement = 'select public.persist_xero_financial_preview_v1($1::jsonb,$2::jsonb,$3) as result';
const iso = '2026-09-27T10:00:00.000Z';
const tenantId = '00000000-0000-4000-8000-000000000011';
const hash = (value) => createHash('sha256').update(value).digest('hex');

function payload({ count = 2, includePayments = false } = {}) {
  const id = randomUUID();
  const identity = hash('complete review');
  const run = {
    id, idempotency_key: `preview:${id}`, mode: 'preview', status: 'building', revision: 1,
    cutoff_date: '2026-01-01', source_snapshot_at: iso, xero_snapshot_at: iso,
    source_fingerprint: hash('source'), xero_fingerprint: hash('xero'),
    control_totals: { postingMode: 'draft', workflowSnapshot: {
      persistenceVersion: 1, complete: true, expectedItemCount: count, reviewIdentity: identity,
      tenantId, includePayments, recordExactMatches: false, reconciliationVersion: 10,
      salesforceOrgId: '00D2x000000Ei4oEAC', safetyHash: hash('safety'), inputEvidenceHash: hash('inputs'),
      products: [{ id: 'product', name: 'Fuel' }], mappingProposals: [], organisation: { baseCurrency: 'USD' },
      payments: includePayments ? { tenantId, rows: [{ salesforcePaymentId: 'payment', status: 'blocked', blockers: ['Review'], reviewFingerprint: hash('payment') }],
        actor: { id: randomUUID(), email: 'original@example.test' }, rateLimit: { dayRemaining: 600 } } : null,
      checkedAt: iso,
    } },
    classification_summary: { total: count, eligible: count }, rate_limit_snapshot: { dayRemaining: 600 },
    created_by: randomUUID(), created_by_email: 'original@example.test', created_at: iso, updated_at: iso,
  };
  const items = Array.from({ length: count }, (_, index) => {
    const sourceId = `invoice-${index}`;
    return { id: randomUUID(), run_id: id, row_index: index, row_key: `Invoice__c:${sourceId}`,
      source_object: 'Invoice__c', source_id: sourceId, source_type: 'buyer_invoice', source_document_number: `INV-${index}`,
      currency: 'USD', source_total: 100, proposed_action: 'create_draft', status: 'eligible', selected: false,
      blockers: [], warnings: [], differences: [],
      source_payload: { salesforceObject: 'Invoice__c', salesforceId: sourceId, postingMode: 'draft',
        sourceFingerprint: hash(sourceId), sourceFileDiscovery: { complete: true, capturedAt: iso, candidates: [] } },
      xero_payload: {}, proposed_payload: { Total: 100 }, xero_document_id: null, xero_document_status: null,
      idempotency_key: `${id}:Invoice__c:${sourceId}`, created_at: iso, updated_at: iso };
  });
  return { run, items, identity };
}

function nextRequest(original) {
  const next = structuredClone(original);
  const id = randomUUID();
  next.run.id = id; next.run.idempotency_key = `preview:${id}`;
  next.items = next.items.map((item) => ({ ...item, id: randomUUID(), run_id: id, idempotency_key: `${id}:${item.row_key}` }));
  return next;
}

async function fixture(t, { database = null } = {}) {
  const db = database || new PGlite();
  if (!database) {
    t.after(() => db.close());
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  }
  await db.exec('grant usage on schema public to service_role;');
  for (const file of ['20260829080726_xero_financial_sync.sql', '20260923210832_xero_financial_selection_scope.sql']) {
    await db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
      .replace(/^create extension if not exists pgcrypto;$/m, ''));
  }
  await db.exec(await readFile(migration, 'utf8'));
  const persist = async (input) => (await db.query(statement, [JSON.stringify(input.run), JSON.stringify(input.items), input.identity])).rows[0].result;
  const snapshot = async () => (await db.query(`select
    (select coalesce(jsonb_agg(to_jsonb(r) order by id), '[]') from public.xero_financial_sync_runs r) as runs,
    (select coalesce(jsonb_agg(to_jsonb(i) order by run_id,row_index), '[]') from public.xero_financial_sync_items i) as items,
    (select coalesce(jsonb_agg(to_jsonb(a) order by id), '[]') from public.xero_financial_audit_events a) as audits`)).rows[0];
  return { db, persist, snapshot };
}

test('atomic preview publication preserves rows and cross-actor exact reuse retains IDs and provenance', async (t) => {
  const f = await fixture(t); const firstInput = payload({ includePayments: true });
  const first = await f.persist(firstInput);
  assert.equal(first.reused, false); assert.equal(first.run.status, 'ready_for_review');
  assert.equal(first.run.revision, 1); assert.equal(first.items.length, firstInput.items.length);
  assert.match(first.run.control_totals.workflowSnapshot.persistencePayloadHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.items.map((item) => item.id), firstInput.items.map((item) => item.id));
  const before = await f.snapshot();
  assert.equal(before.runs.length, 1); assert.equal(before.items.length, 2); assert.equal(before.audits.length, 1);
  assert.equal(before.audits[0].event_type, 'preview_completed');
  const next = nextRequest(firstInput);
  Object.assign(next.run, { created_by: randomUUID(), created_by_email: 'second@example.test',
    source_snapshot_at: '2026-09-27T11:00:00Z', xero_snapshot_at: '2026-09-27T11:00:00Z',
    created_at: '2026-09-27T11:00:00Z', updated_at: '2026-09-27T11:00:00Z', rate_limit_snapshot: { dayRemaining: 590 } });
  next.run.control_totals.workflowSnapshot.checkedAt = '2026-09-27T11:00:00Z';
  next.run.control_totals.workflowSnapshot.payments.actor = { id: randomUUID(), email: 'second@example.test' };
  next.run.control_totals.workflowSnapshot.payments.rateLimit = { dayRemaining: 590 };
  next.items[0].source_payload.sourceFileDiscovery.capturedAt = '2026-09-27T11:00:00Z';
  const reused = await f.persist(next);
  assert.deepEqual(reused, { ...first, reused: true });
  const after = await f.snapshot();
  assert.deepEqual(after.runs, before.runs, 'reuse must not rewrite original provenance or times');
  assert.deepEqual(after.items, before.items);
  assert.deepEqual(after.audits.slice(0, 1), before.audits);
  assert.equal(after.audits.length, 2);
  assert.equal(after.audits[1].event_type, 'preview_reused');
  assert.equal(after.audits[1].fingerprints.previewRequestId, next.run.id);
  assert.equal(after.audits[1].actor_id, next.run.created_by);
  assert.deepEqual(await f.persist(next), reused);
  assert.deepEqual(await f.snapshot(), after, 'exact receipt retry adds no audit');
});

test('empty complete preview is valid and does not invent items', async (t) => {
  const f = await fixture(t); const input = payload({ count: 0 });
  const result = await f.persist(input);
  assert.deepEqual(result.items, []); assert.equal(result.run.status, 'ready_for_review');
  assert.equal((await f.persist(nextRequest(input))).run.id, result.run.id);
});

test('same caller UUID recovers committed approval and completion without resetting any row', async (t) => {
  const f = await fixture(t); const input = payload(); const published = await f.persist(input);
  await f.db.query('select public.authorise_xero_financial_sync_run_v1($1,1,$2::uuid[],$3,$4)',
    [published.run.id, [published.items[0].id], randomUUID(), 'finance@example.test']);
  let before = await f.snapshot();
  const approvedRetry = await f.persist(input);
  assert.equal(approvedRetry.reused, true); assert.equal(approvedRetry.run.status, 'authorised');
  assert.equal(approvedRetry.run.revision, 2); assert.deepEqual(await f.snapshot(), before);
  await f.db.query("update public.xero_financial_sync_runs set status='completed',revision=4,completed_at=now() where id=$1", [published.run.id]);
  await f.db.query("update public.xero_financial_sync_items set status='created',mutation_attempts=1,applied_at=now() where id=$1", [published.items[0].id]);
  before = await f.snapshot();
  assert.equal((await f.persist(input)).run.status, 'completed');
  assert.deepEqual(await f.snapshot(), before);
});

test('lost reuse response recovers the original run after approval without another run or receipt', async (t) => {
  const f = await fixture(t); const original = payload(); const first = await f.persist(original);
  const retry = nextRequest(original); const reused = await f.persist(retry);
  assert.equal(reused.run.id, first.run.id); assert.equal(reused.reused, true);
  await f.db.query('select public.authorise_xero_financial_sync_run_v1($1,1,$2::uuid[],$3,$4)',
    [first.run.id, [first.items[0].id], randomUUID(), 'finance@example.test']);
  const before = await f.snapshot();
  const recovered = await f.persist(retry);
  assert.equal(recovered.run.id, first.run.id); assert.equal(recovered.run.status, 'authorised');
  assert.deepEqual(recovered.items, first.items);
  assert.deepEqual(await f.snapshot(), before);
  const changed = structuredClone(retry); changed.items[0].warnings.push('Changed evidence');
  await assert.rejects(f.persist(changed), { code: '22023' });
  assert.deepEqual(await f.snapshot(), before);
});

test('same UUID rejects changed evidence or claimed identity without mutating existing work', async (t) => {
  const f = await fixture(t); const input = payload(); await f.persist(input);
  const before = await f.snapshot();
  for (const change of [
    (next) => { next.items[0].proposed_payload.Total = 101; },
    (next) => { next.identity = hash('different'); next.run.control_totals.workflowSnapshot.reviewIdentity = next.identity; },
    (next) => { next.run.control_totals.workflowSnapshot.tenantId = randomUUID(); },
  ]) {
    const next = structuredClone(input); change(next);
    await assert.rejects(f.persist(next), { code: '22023' });
    assert.deepEqual(await f.snapshot(), before);
  }
});

test('claimed review identity cannot conceal any material evidence change', async (t) => {
  const f = await fixture(t); const input = payload({ includePayments: true }); await f.persist(input);
  const before = await f.snapshot();
  for (const change of [
    (next) => { next.items[0].warnings.push('New review warning'); },
    (next) => { next.items[0].status = 'blocked'; next.items[0].blockers.push('New blocker'); },
    (next) => { next.items[0].source_payload.sourceFileDiscovery.candidates.push({ id: 'file', modifiedAt: iso }); },
    (next) => { next.items[0].source_payload.dispute = { updatedAt: iso, status: 'open' }; },
    (next) => { next.run.control_totals.workflowSnapshot.payments.rows[0].reviewFingerprint = hash('changed'); },
    (next) => { next.run.control_totals.workflowSnapshot.safetyHash = hash('changed'); },
    (next) => { next.run.control_totals.workflowSnapshot.inputEvidenceHash = hash('changed'); },
    (next) => { next.run.control_totals.workflowSnapshot.reconciliationVersion += 1; },
    (next) => { next.run.control_totals.workflowSnapshot.salesforceOrgId = '00D1m0000008kioEAA'; },
  ]) {
    const next = nextRequest(input); change(next);
    await assert.rejects(f.persist(next), { code: '22023' });
    assert.deepEqual(await f.snapshot(), before);
  }
});

test('new review identities create independent generations for changed scope or evidence', async (t) => {
  const f = await fixture(t); const input = payload(); await f.persist(input);
  const next = nextRequest(input); next.identity = hash('different tenant');
  Object.assign(next.run.control_totals.workflowSnapshot, { tenantId: randomUUID(), reviewIdentity: next.identity });
  const second = await f.persist(next);
  assert.equal(second.reused, false); assert.equal(second.run.id, next.run.id);
  assert.equal((await f.snapshot()).runs.length, 2);
});

test('new request never reuses or resets reviewed, processing, failed or terminal generations', async (t) => {
  const f = await fixture(t); const input = payload();
  for (const status of ['authorised', 'processing', 'partial', 'failed', 'completed', 'cancelled']) {
    const current = await f.persist(nextRequest(input));
    await f.db.query('update public.xero_financial_sync_runs set status=$1,revision=2,reviewed_at=now() where id=$2', [status, current.run.id]);
    const preserved = (await f.snapshot()).runs;
    const next = await f.persist(nextRequest(input));
    assert.equal(next.reused, false); assert.notEqual(next.run.id, current.run.id);
    assert.deepEqual((await f.snapshot()).runs.filter((row) => row.id !== next.run.id), preserved);
    await f.db.query("update public.xero_financial_sync_runs set status='cancelled' where id=$1", [next.run.id]);
  }
});

test('incomplete or changed stored item evidence fails closed without reuse', async (t) => {
  const f = await fixture(t); const input = payload();
  const cases = [
    'delete from public.xero_financial_sync_items where id=$1',
    "update public.xero_financial_sync_items set proposed_payload='{\"Total\":101}' where id=$1",
  ];
  for (const sql of cases) {
    const request = nextRequest(input); request.identity = hash(sql);
    request.run.control_totals.workflowSnapshot.reviewIdentity = request.identity;
    const result = await f.persist(request);
    await f.db.query(sql, [result.items[0].id]);
    const before = await f.snapshot();
    await assert.rejects(f.persist(nextRequest(request)), { code: '40001' });
    assert.deepEqual(await f.snapshot(), before);
  }
});

test('ready but selected or attempted rows are preserved while a fresh snapshot publishes', async (t) => {
  const f = await fixture(t);
  for (const change of ['selected=true', 'mutation_attempts=1', "status='selected'"]) {
    const input = payload(); input.identity = hash(change);
    input.run.control_totals.workflowSnapshot.reviewIdentity = input.identity;
    const first = await f.persist(input);
    await f.db.query(`update public.xero_financial_sync_items set ${change} where id=$1`, [first.items[0].id]);
    const before = await f.snapshot();
    const fresh = await f.persist(nextRequest(input));
    assert.equal(fresh.reused, false); assert.notEqual(fresh.run.id, first.run.id);
    const after = await f.snapshot();
    assert.deepEqual(after.runs.filter((run) => run.id !== fresh.run.id), before.runs);
    assert.deepEqual(after.items.filter((item) => item.run_id !== fresh.run.id), before.items);
  }
});

test('a complete marker without a matching successful completion audit is not reusable', async (t) => {
  const f = await fixture(t);
  for (const alteration of ["outcome='failed'", "fingerprints=fingerprints - 'persistencePayloadHash'", "record_counts='{}'"]) {
    const input = payload(); input.identity = hash(alteration);
    input.run.control_totals.workflowSnapshot.reviewIdentity = input.identity;
    const first = await f.persist(input);
    await f.db.query(`update public.xero_financial_audit_events set ${alteration} where run_id=$1`, [first.run.id]);
    const fresh = await f.persist(nextRequest(input));
    assert.equal(fresh.reused, false); assert.notEqual(fresh.run.id, first.run.id);
  }
});

test('legacy or building records without new complete markers are never reused', async (t) => {
  const f = await fixture(t); const input = payload();
  await f.db.query("insert into public.xero_financial_sync_runs(id,idempotency_key,mode,status) values ($1,$2,'preview','building')", [randomUUID(), 'legacy']);
  const result = await f.persist(input);
  assert.equal(result.reused, false); assert.equal(result.run.id, input.run.id);
  assert.equal((await f.snapshot()).runs.length, 2);
});

test('invalid completeness, scope, ownership, initial state and ordering fail without any rows', async (t) => {
  const f = await fixture(t);
  const cases = [
    (input) => { delete input.run.control_totals.workflowSnapshot.complete; },
    (input) => { input.run.control_totals.workflowSnapshot.persistenceVersion = 2; },
    (input) => { input.run.control_totals.workflowSnapshot.expectedItemCount = 1; },
    (input) => { input.run.classification_summary.total = 1; },
    (input) => { input.run.control_totals.workflowSnapshot.tenantId = ''; },
    (input) => { delete input.run.control_totals.workflowSnapshot.salesforceOrgId; },
    (input) => { delete input.run.control_totals.workflowSnapshot.inputEvidenceHash; },
    (input) => { input.run.control_totals.workflowSnapshot.recordExactMatches = true; },
    (input) => { input.run.control_totals.workflowSnapshot.includePayments = true; },
    (input) => { input.run.control_totals.workflowSnapshot.persistencePayloadHash = hash('caller'); },
    (input) => { input.run.mode = 'document_apply'; },
    (input) => { input.run.status = 'authorised'; },
    (input) => { input.run.reviewed_by = randomUUID(); },
    (input) => { input.run.revision = 2; },
    (input) => { input.items[0].run_id = randomUUID(); },
    (input) => { input.items[0].selected = true; },
    (input) => { input.items[0].mutation_attempts = 1; },
    (input) => { input.items[0].status = 'selected'; },
    (input) => { input.items[0].proposed_action = 'payment_apply'; },
    (input) => { input.items[0].blockers = ['Cannot be eligible']; },
    (input) => { input.items[0].source_payload.postingMode = 'authorised'; },
    (input) => { input.items[0].id = input.items[1].id; },
    (input) => { input.items[0].row_index = input.items[1].row_index; },
    (input) => { input.items.reverse(); },
  ];
  for (const change of cases) {
    const input = payload(); change(input);
    await assert.rejects(f.persist(input), { code: '22023' });
  }
  assert.deepEqual(await f.snapshot(), { runs: [], items: [], audits: [] });
});

test('item and audit failures roll back header and every item; retry can publish normally', async (t) => {
  const f = await fixture(t); const input = payload();
  await f.db.exec(`create function public.reject_preview_item() returns trigger language plpgsql as $$
    begin if new.row_index=1 then raise exception 'injected item failure'; end if; return new; end $$;
    create trigger reject_preview_item before insert on public.xero_financial_sync_items
      for each row execute function public.reject_preview_item();`);
  await assert.rejects(f.persist(input), /injected item failure/);
  assert.deepEqual(await f.snapshot(), { runs: [], items: [], audits: [] });
  await f.db.exec(`drop trigger reject_preview_item on public.xero_financial_sync_items;
    create function public.reject_preview_audit() returns trigger language plpgsql as $$
    begin raise exception 'injected audit failure'; end $$;
    create trigger reject_preview_audit before insert on public.xero_financial_audit_events
      for each row execute function public.reject_preview_audit();`);
  await assert.rejects(f.persist(input), /injected audit failure/);
  assert.deepEqual(await f.snapshot(), { runs: [], items: [], audits: [] });
  await f.db.exec('drop trigger reject_preview_audit on public.xero_financial_audit_events;');
  assert.equal((await f.persist(input)).run.status, 'ready_for_review');
});

test('reuse audit failure rolls back its receipt and permits an exact retry', async (t) => {
  const f = await fixture(t); const original = payload(); const first = await f.persist(original);
  const retry = nextRequest(original); const before = await f.snapshot();
  await f.db.exec(`create function public.reject_reuse_audit() returns trigger language plpgsql as $$
    begin if new.event_type='preview_reused' then raise exception 'injected reuse audit failure'; end if; return new; end $$;
    create trigger reject_reuse_audit before insert on public.xero_financial_audit_events
      for each row execute function public.reject_reuse_audit();`);
  await assert.rejects(f.persist(retry), /injected reuse audit failure/);
  assert.deepEqual(await f.snapshot(), before);
  await f.db.exec('drop trigger reject_reuse_audit on public.xero_financial_audit_events;');
  assert.equal((await f.persist(retry)).run.id, first.run.id);
  const receipt = (await f.snapshot()).audits.find((audit) => audit.event_type === 'preview_reused');
  await assert.rejects(f.db.query(`insert into public.xero_financial_audit_events(run_id,event_type,outcome,fingerprints)
    values ($1,'preview_reused','success',$2)`, [first.run.id, receipt.fingerprints]), { code: '23505' });
});

test('service-only invoker permissions do not expose the RPC to PUBLIC, anon or authenticated', async (t) => {
  const f = await fixture(t); const input = payload();
  const permissions = (await f.db.query(`select p.prosecdef,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service,
    exists(select 1 from aclexplode(p.proacl) where grantee=0 and privilege_type='EXECUTE') as public
    from pg_proc p where p.oid=$1::regprocedure`, [signature])).rows[0];
  assert.deepEqual(permissions, { prosecdef: false, anon: false, authenticated: false, service: true, public: false });
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`set role ${role}`);
    await assert.rejects(f.persist(input), { code: '42501' });
    await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role');
  assert.equal((await f.persist(input)).run.status, 'ready_for_review');
});

test('representative 2995-document payload above 14 MiB stores one evidence set and small reuse receipt', async (t) => {
  const f = await fixture(t); const input = payload({ count: 2995, includePayments: true });
  for (const item of input.items) item.source_payload.accountingEvidence = {
    description: 'Synthetic accounting evidence. '.repeat(150),
  };
  const bytes = Buffer.byteLength(JSON.stringify({ p_run: input.run, p_items: input.items, p_review_identity: input.identity }));
  assert.ok(bytes >= 14 * 1024 * 1024, `Representative fixture must exceed 14 MiB: ${bytes}`);
  const startedAt = performance.now();
  const result = await f.persist(input);
  const publishMs = performance.now() - startedAt;
  assert.equal(result.items.length, 2995);
  const reuseStartedAt = performance.now();
  const reused = await f.persist(nextRequest(input));
  const reuseMs = performance.now() - reuseStartedAt;
  assert.equal(reused.reused, true); assert.equal(reused.run.id, result.run.id);
  const counts = (await f.db.query(`select (select count(*)::integer from public.xero_financial_sync_runs) as runs,
    (select count(*)::integer from public.xero_financial_sync_items) as items,
    (select count(*)::integer from public.xero_financial_audit_events) as audits`)).rows[0];
  assert.deepEqual(counts, { runs: 1, items: 2995, audits: 2 });
  t.diagnostic(`Synthetic request: ${bytes} bytes; PGlite publish ${Math.round(publishMs)} ms, reuse ${Math.round(reuseMs)} ms. HTTP limits and production latency remain unverified.`);
});

// Opt-in real-session tests: local endpoint only, unique disposable database,
// never create/change roles or mutate public tables in the supplied database.
const concurrencyUrl = process.env.FCOS_PREVIEW_TEST_DATABASE_URL;
async function postgresFixture(t) {
  const endpoint = new URL(concurrencyUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Preview concurrency tests require localhost');
  assert.ok(['postgres:', 'postgresql:'].includes(endpoint.protocol));
  const admin = new pg.Client({ connectionString: endpoint.toString() }); await admin.connect();
  const dbName = `fcos_preview_test_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  const clients = [];
  t.after(async () => {
    for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end(); }
    if (created) await admin.query(`drop database "${dbName}" with (force)`);
    await admin.end();
  });
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await admin.query('select count(*)::int as n from pg_roles where rolname=$1', [role])).rows[0].n, 1,
      'Use a disposable local PostgreSQL cluster with standard Supabase roles');
  }
  await admin.query(`create database "${dbName}"`); created = true; endpoint.pathname = `/${dbName}`;
  const connect = async () => {
    const client = new pg.Client({ connectionString: endpoint.toString() }); await client.connect();
    await client.query("set statement_timeout='8s'; set lock_timeout='6s'"); clients.push(client); return client;
  };
  const primary = await connect();
  const f = await fixture(t, { database: { query: (...args) => primary.query(...args), exec: (text) => primary.query(text) } });
  const call = async (client, input) => (await client.query(statement, [JSON.stringify(input.run), JSON.stringify(input.items), input.identity])).rows[0].result;
  const waitForLock = async (client) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if ((await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [client.processID])).rows[0]?.wait_event_type === 'Lock') return;
      await delay(25);
    }
    assert.fail('Expected concurrent preview request to wait on a PostgreSQL lock');
  };
  return { ...f, primary, connect, call, waitForLock };
}

test('PostgreSQL concurrent preview requests serialize identity, UUID retry and approval races', {
  skip: !concurrencyUrl && 'Set FCOS_PREVIEW_TEST_DATABASE_URL to a disposable localhost PostgreSQL endpoint', timeout: 60000,
}, async (t) => {
  await t.test('same content waits for commit then reuses the winner IDs', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect(); const input = payload();
    await f.primary.query('begin'); const first = await f.call(f.primary, input);
    const observer = await f.connect();
    assert.equal((await observer.query('select count(*)::int as n from public.xero_financial_sync_runs')).rows[0].n, 0,
      'no ready header is visible before publication commits');
    const pending = f.call(second, nextRequest(input)).then((value) => ({ value }), (error) => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit');
    assert.deepEqual((await pending).value, { ...first, reused: true });
    assert.equal((await f.snapshot()).runs.length, 1);
  });
  await t.test('same reuse request waits then recovers one durable receipt', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect(); const input = payload();
    await f.call(f.primary, input); const retry = nextRequest(input);
    await f.primary.query('begin'); const first = await f.call(f.primary, retry);
    const pending = f.call(second, retry).then((value) => ({ value }), (error) => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit');
    assert.deepEqual((await pending).value, first);
    const saved = await f.snapshot(); assert.equal(saved.runs.length, 1); assert.equal(saved.audits.length, 2);
  });
  await t.test('same UUID with different identity waits then rejects without writes', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect(); const input = payload();
    await f.primary.query('begin'); await f.call(f.primary, input);
    const changed = structuredClone(input); changed.identity = hash('changed');
    changed.run.control_totals.workflowSnapshot.reviewIdentity = changed.identity;
    const pending = f.call(second, changed).then((value) => ({ value }), (error) => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit');
    assert.equal((await pending).error?.code, '22023');
    assert.equal((await f.snapshot()).runs.length, 1);
  });
  await t.test('concurrent approval wins without resetting its selection or revision', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect(); const input = payload();
    const first = await f.call(f.primary, input);
    await f.primary.query('begin');
    await f.primary.query('select public.authorise_xero_financial_sync_run_v1($1,1,$2::uuid[],$3,$4)',
      [first.run.id, [first.items[0].id], randomUUID(), 'finance@example.test']);
    const pending = f.call(second, nextRequest(input)).then((value) => ({ value }), (error) => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit');
    const result = await pending; assert.ifError(result.error);
    assert.equal(result.value.reused, false); assert.notEqual(result.value.run.id, first.run.id);
    const saved = await f.snapshot();
    assert.equal(saved.runs.find((run) => run.id === first.run.id).status, 'authorised');
    assert.equal(saved.items.find((item) => item.id === first.items[0].id).selected, true);
  });
  await t.test('2995-document payload above 14 MiB publishes and reuses on PostgreSQL', async (child) => {
    const f = await postgresFixture(child); const input = payload({ count: 2995, includePayments: true });
    for (const item of input.items) item.source_payload.accountingEvidence = { description: 'Synthetic accounting evidence. '.repeat(150) };
    const bytes = Buffer.byteLength(JSON.stringify({ p_run: input.run, p_items: input.items, p_review_identity: input.identity }));
    assert.ok(bytes >= 14 * 1024 * 1024);
    const startedAt = performance.now(); const first = await f.call(f.primary, input);
    const publishMs = performance.now() - startedAt;
    const reuseStartedAt = performance.now(); const second = await f.call(f.primary, nextRequest(input));
    const reuseMs = performance.now() - reuseStartedAt;
    assert.equal(second.run.id, first.run.id); assert.equal(second.items.length, 2995); assert.equal(second.reused, true);
    assert.equal((await f.primary.query('select count(*)::int as n from public.xero_financial_sync_items')).rows[0].n, 2995);
    child.diagnostic(`Synthetic request: ${bytes} bytes; PostgreSQL publish ${Math.round(publishMs)} ms, reuse ${Math.round(reuseMs)} ms. PostgREST HTTP limits remain unverified.`);
  });
});
