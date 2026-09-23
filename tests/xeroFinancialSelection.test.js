import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const functionName = 'public.authorise_xero_financial_sync_run_v1(uuid,integer,uuid[],uuid,text)';
const actorId = randomUUID();
const initialTimestamp = '2000-01-01T00:00:00.000Z';
const rowId = (index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
  const baseline = await readFile(new URL('../supabase/migrations/20260829080726_xero_financial_sync.sql', import.meta.url), 'utf8');
  // PGlite has built-in gen_random_uuid(), but does not bundle pgcrypto's extension files.
  await db.exec(baseline.replace(/^create extension if not exists pgcrypto;$/m, ''));
  await db.exec(await readFile(new URL('../supabase/migrations/20260923210832_xero_financial_selection_scope.sql', import.meta.url), 'utf8'));
  const runId = randomUUID();
  await db.query(`insert into public.xero_financial_sync_runs
    (id, idempotency_key, mode, status, revision, source_snapshot_at, xero_snapshot_at,
      source_fingerprint, xero_fingerprint, control_totals, classification_summary, rate_limit_snapshot, updated_at)
    values ($1, $2, 'preview', 'ready_for_review', 1, '2026-09-20T01:00:00Z', '2026-09-20T02:00:00Z',
      'salesforce-snapshot', 'xero-snapshot', '{"postingMode":"draft"}', '{"eligible":2054}',
      '{"remaining":900}', $3)`, [runId, `selection-${runId}`, initialTimestamp]);
  const authorise = (selectedIds, revision = 1) => db.query(`select * from public.authorise_xero_financial_sync_run_v1($1,$2,$3::uuid[],$4,$5)`,
    [runId, revision, selectedIds, actorId, '  FINANCE@example.test  ']);
  const snapshot = async () => (await db.query(`select status, revision, reviewed_by, reviewed_by_email, reviewed_at,
    source_snapshot_at, xero_snapshot_at, source_fingerprint, xero_fingerprint, control_totals,
    classification_summary, rate_limit_snapshot, cutoff_date from public.xero_financial_sync_runs where id=$1`, [runId])).rows[0];
  const audit = async () => (await db.query(`select event_type, outcome, actor_id, actor_email, record_counts
    from public.xero_financial_audit_events where run_id=$1 order by id`, [runId])).rows;
  return { db, runId, authorise, snapshot, audit };
}

async function insertItems(db, runId, count, { blockedIndex = null, selectedIndex = null } = {}) {
  await db.query(`insert into public.xero_financial_sync_items
    (id,run_id,row_index,row_key,source_object,source_id,source_type,currency,proposed_action,status,
      selected,idempotency_key,updated_at)
    select ('00000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid, $1, n, 'row-' || n,
      'Invoice__c', 'invoice-' || n, 'buyer_invoice', 'USD',
      case when n = 2048 then 'protected_legacy' else 'create_draft' end,
      case when n = $3 then 'blocked' else 'eligible' end,
      coalesce(n = $4, false), 'item-' || $1::uuid::text || '-' || n, $2::timestamptz
    from generate_series(1,$5::integer) n`, [runId, initialTimestamp, blockedIndex, selectedIndex, count]);
}

async function itemState(db, runId) {
  return (await db.query(`select id, row_index, status, selected, updated_at
    from public.xero_financial_sync_items where run_id=$1 order by row_index`, [runId])).rows;
}

test('2054 eligible rows authorise only the two chosen writes and preserve snapshot and exact actor audit', async (t) => {
  const { db, runId, authorise, snapshot, audit } = await fixture(t);
  await insertItems(db, runId, 2054);
  await db.exec(`create table public.xero_financial_item_write_probe(item_id uuid not null);
    create function public.probe_xero_financial_item_write() returns trigger language plpgsql as $$
    begin insert into public.xero_financial_item_write_probe(item_id) values (new.id); return new; end $$;
    create trigger probe_xero_financial_item_write after update on public.xero_financial_sync_items
      for each row execute function public.probe_xero_financial_item_write();`);
  const before = await snapshot();
  const chosen = [rowId(2), rowId(2048)];
  const authorised = (await authorise(chosen)).rows[0];
  assert.equal(authorised.status, 'authorised');
  assert.equal(authorised.revision, 2);
  const updates = (await db.query('select item_id from public.xero_financial_item_write_probe order by item_id')).rows.map((row) => row.item_id);
  assert.deepEqual(updates, chosen);
  const rows = await itemState(db, runId);
  assert.equal(rows.length, 2054);
  assert.deepEqual(rows.filter((row) => row.selected).map((row) => row.id), chosen);
  assert.deepEqual(rows.filter((row) => row.status === 'selected').map((row) => row.id), chosen);
  assert.ok(rows.filter((row) => !row.selected).every((row) => row.status === 'eligible'
    && new Date(row.updated_at).toISOString() === initialTimestamp));
  const after = await snapshot();
  for (const key of ['source_snapshot_at', 'xero_snapshot_at', 'source_fingerprint', 'xero_fingerprint',
    'control_totals', 'classification_summary', 'rate_limit_snapshot', 'cutoff_date']) assert.deepEqual(after[key], before[key], key);
  assert.equal(after.reviewed_by, actorId);
  assert.equal(after.reviewed_by_email, 'finance@example.test');
  assert.ok(after.reviewed_at);
  assert.deepEqual(await audit(), [{ event_type: 'run_authorised', outcome: 'success', actor_id: actorId,
    actor_email: 'finance@example.test', record_counts: { selected: 2 } }]);
});

test('stale preselected eligible row is cleared while untouched eligible rows receive no write', async (t) => {
  const { db, runId, authorise } = await fixture(t);
  await insertItems(db, runId, 3, { selectedIndex: 2 });
  await authorise([rowId(1)]);
  const rows = await itemState(db, runId);
  assert.deepEqual(rows.map((row) => [row.status, row.selected]), [
    ['selected', true], ['eligible', false], ['eligible', false],
  ]);
  assert.equal(new Date(rows[2].updated_at).toISOString(), initialTimestamp);
  assert.notEqual(new Date(rows[1].updated_at).toISOString(), initialTimestamp);
});

test('blocked, foreign, and missing selections roll back run, row, and audit changes atomically', async (t) => {
  const { db, runId, authorise, snapshot, audit } = await fixture(t);
  await insertItems(db, runId, 3, { blockedIndex: 3, selectedIndex: 2 });
  const foreignRunId = randomUUID();
  await db.query(`insert into public.xero_financial_sync_runs(id,idempotency_key,mode,status)
    values($1,$2,'preview','ready_for_review')`, [foreignRunId, `foreign-${foreignRunId}`]);
  const foreignItemId = randomUUID();
  await db.query(`insert into public.xero_financial_sync_items
    (id,run_id,row_index,row_key,source_object,source_id,source_type,currency,proposed_action,status,idempotency_key)
    values($1,$2,1,'foreign','Invoice__c','foreign','buyer_invoice','USD','create_draft','eligible',$3)`,
  [foreignItemId, foreignRunId, `foreign-item-${foreignItemId}`]);
  const beforeRun = await snapshot();
  const beforeRows = await itemState(db, runId);
  for (const invalid of [rowId(3), foreignItemId, randomUUID()]) {
    await assert.rejects(authorise([rowId(1), invalid]), /Selection contains a missing or ineligible row/);
    assert.deepEqual(await snapshot(), beforeRun);
    assert.deepEqual(await itemState(db, runId), beforeRows);
    assert.deepEqual(await audit(), []);
  }
  assert.equal((await db.query('select selected from public.xero_financial_sync_items where id=$1', [foreignItemId])).rows[0].selected, false);
});

test('stale revision and repeated authorisation reject without changing saved approval', async (t) => {
  const { db, runId, authorise, snapshot, audit } = await fixture(t);
  await insertItems(db, runId, 2);
  await assert.rejects(authorise([rowId(1)], 0), /Xero sync preview changed/);
  assert.equal((await snapshot()).revision, 1);
  await authorise([rowId(1)]);
  const authorised = await snapshot();
  const rows = await itemState(db, runId);
  const events = await audit();
  await assert.rejects(authorise([rowId(2)], 1), /Xero sync preview changed/);
  await assert.rejects(authorise([rowId(2)], 2), /Xero sync preview changed/);
  assert.deepEqual(await snapshot(), authorised);
  assert.deepEqual(await itemState(db, runId), rows);
  assert.deepEqual(await audit(), events);
});

test('only service_role can execute selection authorisation', async (t) => {
  const { db, runId, authorise } = await fixture(t);
  await insertItems(db, runId, 1);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(authorise([rowId(1)]), /permission denied/);
    await db.exec('reset role');
  }
  const privileges = (await db.query(`select
    has_function_privilege('anon',$1,'EXECUTE') as anon,
    has_function_privilege('authenticated',$1,'EXECUTE') as authenticated,
    has_function_privilege('service_role',$1,'EXECUTE') as service`, [functionName])).rows[0];
  assert.deepEqual(privileges, { anon: false, authenticated: false, service: true });
  await db.exec('set role service_role');
  const authorised = (await authorise([rowId(1)])).rows[0];
  assert.equal(authorised.status, 'authorised');
});
