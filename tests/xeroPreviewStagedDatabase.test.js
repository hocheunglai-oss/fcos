import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { createPreviewCheckpoint, savePreviewCheckpoint, previewCheckpointReference, markPreviewCheckpointPublished } from '../api/_xeroPreviewCheckpoint.js';
import { toSyncItemRow } from '../api/_xeroFinancialSync.js';

const nativeUrl = process.env.FCOS_PREVIEW_TEST_DATABASE_URL || process.env.FCOS_PREVIEW_STAGED_TEST_DATABASE_URL || process.env.FCOS_CAMPAIGN_TEST_DATABASE_URL;
if (!nativeUrl && process.env.FCOS_REQUIRE_NATIVE_POSTGRES === '1') throw new Error('FCOS_PREVIEW_TEST_DATABASE_URL is required for native staged-preview checks');
const opts = { skip: !nativeUrl && 'Set FCOS_PREVIEW_TEST_DATABASE_URL to disposable local PostgreSQL', timeout: 60000 };
const actor = '00000000-0000-4000-8000-000000000099';
const tenant = '00000000-0000-4000-8000-000000000011';
const iso = '2026-09-27T10:00:00.000Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const migrations = ['20260827145608_xero_contact_sync.sql', '20260829080726_xero_financial_sync.sql',
  '20260923210832_xero_financial_selection_scope.sql', '20260927154515_xero_financial_preview_persistence.sql',
  '20260929192752_xero_preview_checkpoint.sql', '20260930004000_xero_preview_checkpoint_chunks.sql',
  '20260930004100_xero_financial_preview_staged.sql'];

async function fixture(t, count = 3, { paymentRows = null } = {}) {
  const includePayments = paymentRows !== null;
  const url = new URL(nativeUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only disposable local PostgreSQL is allowed');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  const owner = new pg.Client({ connectionString: url.toString() }); await owner.connect();
  await owner.query(`do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
  end$$`);
  const dbName = `fcos_staged_${randomUUID().replaceAll('-', '')}`;
  await owner.query(`create database "${dbName}"`); url.pathname = `/${dbName}`;
  const clients = [];
  const connect = async () => {
    const db = new pg.Client({ connectionString: url.toString() }); await db.connect(); clients.push(db);
    await db.query("set statement_timeout='45s'; set lock_timeout='4s'"); return db;
  };
  t.after(async () => {
    for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end(); }
    await owner.query(`drop database "${dbName}" with(force)`); await owner.end();
  });
  const db = await connect();
  await db.query(`grant usage on schema public to service_role;
    create table public.staged_test_access(id uuid primary key,active boolean not null);
    insert into public.staged_test_access values('${actor}',true);
    create function public.fcos_has_access(p_actor uuid,p_module text) returns boolean language sql stable as
      'select coalesce((select active from public.staged_test_access where id=p_actor),false) and p_module=''xero_portal''';`);
  for (const file of migrations) await db.query(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  await db.query("insert into xero_contact_sync_connections(id,tenant_id,refresh_token,token_version) values('primary',$1,'fixture-only',1)", [tenant]);
  await db.query('set role service_role');
  const raw = async (name, values, connection = db) => (await connection.query(`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) result`,
    values.map((value, index) => name === 'authorise_xero_financial_sync_run_v1' && index === 2 ? value : value && typeof value === 'object' ? JSON.stringify(value) : value))).rows[0].result;
  const client = { async rpc(name, parameters) { try { return { data: await raw(name, Object.values(parameters)), error: null }; }
    catch (error) { return { error: { code: error.code, message: error.message } }; } } };
  const scope = { actorId: actor, tenantId: tenant, salesforceOrgId: '00D2x000000Ei4oEAC', reconciliationVersion: 18,
    inputOptions: { linkFirst: true, includePayments, recordExactMatches: false, cutoffDate: '2026-01-01', postingMode: 'draft', campaignId: null },
    inputEvidenceHash: hash('complete checkpoint source') };
  const cpPayload = { complete: true, provider: { xero: { tenantId: tenant, documents: [], contacts: [] },
    accountResponse: { Accounts: [] }, taxResponse: { TaxRates: [] }, allMappings: { data: [] }, payments: includePayments ? { tenantId: tenant, rows: paymentRows } : null },
    automaticMappingPolicy: { changedCount: 0 }, snapshotStartedAt: iso, callForecast: { callsNeeded: 50 }, rate: { dayRemaining: 869 } };
  const pending = await createPreviewCheckpoint(client, scope);
  const checkpoint = await savePreviewCheckpoint(client, { id: pending.id, revision: pending.revision, scope, payload: cpPayload });
  const id = randomUUID(); const identity = hash(id);
  const run = { id, idempotency_key: `preview:${id}`, mode: 'preview', status: 'building', revision: 1,
    cutoff_date: '2026-01-01', source_snapshot_at: iso, xero_snapshot_at: iso, source_fingerprint: hash('source'), xero_fingerprint: hash('xero'),
    control_totals: { postingMode: 'draft', workflowSnapshot: { persistenceVersion: 2, complete: true, expectedItemCount: count,
      reviewIdentity: identity, tenantId: tenant, salesforceOrgId: scope.salesforceOrgId, reconciliationVersion: 18,
      includePayments, recordExactMatches: false, linkFirst: true, campaignId: null, payments: includePayments ? { tenantId: tenant, rows: paymentRows } : null, inputEvidenceHash: hash('source'),
      previewCheckpointInputEvidenceHash: checkpoint.input_evidence_hash, previewCheckpointPayloadHash: checkpoint.payload_hash,
      inventoryReference: previewCheckpointReference(checkpoint) } },
    classification_summary: { total: count, eligible: count }, rate_limit_snapshot: { dayRemaining: 600 },
    created_by: actor, created_by_email: 'fixture@example.test', created_at: iso, updated_at: iso };
  const items = Array.from({ length: count }, (_, index) => ({ id: randomUUID(), run_id: id, row_index: index,
    row_key: `Invoice__c:invoice-${index}`, source_object: 'Invoice__c', source_id: `invoice-${index}`, source_type: 'buyer_invoice',
    source_document_number: `INV-${index}`, currency: 'USD', source_total: 100, proposed_action: 'create_draft', status: 'eligible',
    selected: false, blockers: [], warnings: [], differences: [],
    source_payload: { salesforceObject: 'Invoice__c', salesforceId: `invoice-${index}`, postingMode: 'draft',
      sourceFingerprint: hash(`invoice-${index}`), sourceFileDiscovery: { complete: true, capturedAt: iso, candidates: [] } },
    xero_payload: {}, proposed_payload: { Total: 100 }, idempotency_key: `${id}:Invoice__c:invoice-${index}`, created_at: iso, updated_at: iso }));
  const begin = (r = run, n = count, identityValue = identity, connection = db) => raw('begin_xero_financial_preview_v2', [r, n, identityValue], connection);
  const append = (rows = items, identityValue = identity, connection = db) => raw('append_xero_financial_preview_v2', [id, identityValue, rows], connection);
  const finalize = (connection = db) => raw('finalize_xero_financial_preview_v2', [id, identity], connection);
  const asOwner = async action => { await db.query('reset role'); try { return await action(); } finally { await db.query('set role service_role'); } };
  const counts = async () => (await db.query(`select
    (select count(*)::integer from xero_financial_sync_runs) runs,
    (select count(*)::integer from xero_financial_sync_items) items,
    (select count(*)::integer from xero_financial_audit_events where event_type='preview_completed') audits,
    (select count(*)::integer from xero_financial_preview_build_items) staged`)).rows[0];
  return { db, connect, raw, client, run, items, id, identity, checkpoint, scope, begin, append, finalize, asOwner, counts };
}

test('native staged preview stays private until complete, then atomically publishes every row and one audit', opts, async t => {
  const f = await fixture(t); await f.begin(); await f.append(f.items.slice(0, 2));
  assert.deepEqual(await f.counts(), { runs: 0, items: 0, audits: 0, staged: 2 });
  await assert.rejects(f.finalize(), /ITEMS_INCOMPLETE/);
  await assert.rejects(f.raw('authorise_xero_financial_sync_run_v1', [f.id, 1, [f.items[0].id], actor, 'fixture@example.test']), /changed after/);
  assert.equal((await f.append(f.items.slice(0, 2))).receivedItemCount, 2);
  await f.append(f.items.slice(2)); const saved = await f.finalize();
  assert.equal(saved.reused, false); assert.equal(saved.run.status, 'ready_for_review');
  assert.deepEqual(saved.items.map(i => i.id), f.items.map(i => i.id));
  assert.deepEqual(await f.counts(), { runs: 1, items: 3, audits: 1, staged: 3 });
  assert.equal((await f.finalize()).reused, true); assert.equal((await f.begin()).reused, true);
  const published = await markPreviewCheckpointPublished(f.client, { id: f.checkpoint.id, revision: f.checkpoint.revision, scope: f.scope, runId: f.id });
  assert.equal(published.state, 'published'); assert.equal((await f.begin()).reused, true);
});

test('native staged preview rejects mismatched, duplicate, incomplete, reordered or noninitial items without partial append', opts, async t => {
  const f = await fixture(t); await f.begin();
  const cases = [rows => { rows[0].run_id = randomUUID(); }, rows => { rows[0].source_payload.salesforceId = 'foreign'; },
    rows => { rows[0].unknownEvidence = 'must not disappear'; }, rows => { rows[0].selected = true; }, rows => { rows[0].mutation_attempts = 1; },
    rows => { rows[1].id = rows[0].id; }, rows => { rows[1].row_key = rows[0].row_key; },
    rows => { rows[1].source_id = rows[0].source_id; rows[1].row_key = rows[0].row_key; rows[1].source_payload.salesforceId = rows[0].source_id; rows[1].idempotency_key = rows[0].idempotency_key; },
    rows => { rows[1].row_index = 2; }, rows => { rows.reverse(); }, rows => { rows[0].blockers = ['not eligible']; }];
  for (const mutate of cases) {
    const rows = structuredClone(f.items.slice(0, 2)); mutate(rows);
    await assert.rejects(f.append(rows), /STAGED_/);
    assert.equal((await f.counts()).staged, 0);
  }
  await assert.rejects(f.append(f.items.slice(1)), /ITEMS_INCOMPLETE/);
  await assert.rejects(f.append([], f.identity), /CHUNK_INVALID/);
  await assert.rejects(f.append(f.items, hash('other identity')), /UUID_CONFLICT/);
  await f.append(f.items); const changed = structuredClone(f.items); changed[0].proposed_payload.Total = 101;
  await assert.rejects(f.append(changed), /ITEM_CONFLICT/); await f.finalize();
});

test('native staged begin scope, stale UUID, changed checkpoint/source, and tenant/permission controls fail closed', opts, async t => {
  const f = await fixture(t); await f.begin();
  for (const change of [r => { r.source_fingerprint = hash('different'); }, r => { r.classification_summary.total += 1; },
    r => { r.control_totals.workflowSnapshot.inventoryReference.payloadHash = hash('wrong'); },
    r => { r.control_totals.workflowSnapshot.inventoryReference.actorId = randomUUID(); },
    r => { r.control_totals.workflowSnapshot.tenantId = randomUUID(); },
    r => { r.unknownEvidence = 'must not disappear'; }, r => { r.reviewed_at = iso; }, r => { r.control_totals.workflowSnapshot.inventory = {}; }]) {
    const r = structuredClone(f.run); change(r); await assert.rejects(f.begin(r), /STAGED_/);
  }
  await assert.rejects(f.begin(f.run, 4), /STAGED_INVALID/);
  await f.asOwner(() => f.db.query("update staged_test_access set active=false where id=$1", [actor]));
  await assert.rejects(f.append(f.items), /ACCESS_REQUIRED/);
  await f.asOwner(() => f.db.query("update staged_test_access set active=true where id=$1", [actor]));
  await f.asOwner(() => f.db.query("update xero_contact_sync_connections set tenant_id=$1 where id='primary'", [randomUUID()]));
  await assert.rejects(f.finalize(), /CONNECTION_CHANGED/);
  assert.deepEqual(await f.counts(), { runs: 0, items: 0, audits: 0, staged: 0 });
});

test('native exact transport retry observes reviewed state and detects changed persisted financial evidence', opts, async t => {
  const f = await fixture(t); await f.begin(); await f.append(); await f.finalize();
  await f.raw('authorise_xero_financial_sync_run_v1', [f.id, 1, [f.items[0].id], actor, 'finance@example.test']);
  const before = await f.counts(); const retry = await f.begin();
  assert.equal(retry.run.status, 'authorised'); assert.equal(retry.run.revision, 2); assert.equal(retry.reused, true);
  assert.equal((await f.append()).run.status, 'authorised'); assert.deepEqual(await f.counts(), before);
  assert.equal((await f.db.query('select selected from xero_financial_sync_items where id=$1', [f.items[0].id])).rows[0].selected, true);
  await f.asOwner(() => f.db.query("update xero_financial_sync_items set proposed_payload=jsonb_set(proposed_payload,'{Total}','101') where id=$1", [f.items[0].id]));
  await assert.rejects(f.finalize(), /STAGED_CORRUPT/);
  await assert.rejects(f.begin(), /STAGED_CORRUPT/);
});

test('native HTTP resume allows only regenerated metadata and preserves original intent, items, and later review state', opts, async t => {
  const f = await fixture(t);
  f.items[0].source_payload.sourceFileDiscovery.version = 'original';
  await f.begin(); await f.append(f.items.slice(0, 2));
  const intent = (await f.db.query('select run_payload,run_storage_hash,run_material_hash,staged_bytes from xero_financial_preview_builds where request_id=$1', [f.id])).rows[0];
  const savedItem = (await f.db.query('select payload,storage_hash,material_hash from xero_financial_preview_build_items where request_id=$1 and row_index=0', [f.id])).rows[0];
  const now = '2026-09-30T12:34:56.000Z'; const run = structuredClone(f.run);
  for (const field of ['created_at', 'updated_at', 'source_snapshot_at', 'xero_snapshot_at']) run[field] = now;
  run.rate_limit_snapshot = { dayRemaining: 500 }; run.created_by_email = 'regenerated@example.test';
  run.control_totals.workflowSnapshot.checkedAt = now;
  const rows = structuredClone(f.items);
  for (const item of rows) { item.created_at = now; item.updated_at = now; item.source_payload.sourceFileDiscovery.capturedAt = now; }
  assert.equal((await f.begin(run)).receivedItemCount, 2);
  assert.equal((await f.append(rows.slice(0, 2))).receivedItemCount, 2);
  assert.deepEqual((await f.db.query('select run_payload,run_storage_hash,run_material_hash,staged_bytes from xero_financial_preview_builds where request_id=$1', [f.id])).rows[0], intent);
  assert.deepEqual((await f.db.query('select payload,storage_hash,material_hash from xero_financial_preview_build_items where request_id=$1 and row_index=0', [f.id])).rows[0], savedItem);
  const foreignActor = structuredClone(run); foreignActor.created_by = randomUUID();
  await assert.rejects(f.begin(foreignActor), /SCOPE_CHANGED/);
  const foreignScope = structuredClone(run); foreignScope.control_totals.workflowSnapshot.inventoryReference.actorId = randomUUID();
  await assert.rejects(f.begin(foreignScope), /UUID_CONFLICT/);
  const financial = structuredClone(rows.slice(0, 2)); financial[0].proposed_payload.Total = 101;
  await assert.rejects(f.append(financial), /ITEM_CONFLICT/);
  const fileVersion = structuredClone(rows.slice(0, 2)); fileVersion[0].source_payload.sourceFileDiscovery.version = 'changed';
  await assert.rejects(f.append(fileVersion), /ITEM_CONFLICT/);
  const changedId = structuredClone(rows.slice(0, 2)); changedId[0].id = randomUUID();
  await assert.rejects(f.append(changedId), /ITEM_CONFLICT/);
  await f.append(rows.slice(2)); const result = await f.finalize();
  assert.deepEqual(result.items.map(i => i.id), f.items.map(i => i.id));
  await f.raw('authorise_xero_financial_sync_run_v1', [f.id, 1, [f.items[0].id], actor, 'finance@example.test']);
  assert.equal((await f.begin(run)).run.status, 'authorised');
  assert.equal((await f.append(rows)).run.status, 'authorised');
  assert.deepEqual((await f.db.query('select payload,storage_hash,material_hash from xero_financial_preview_build_items where request_id=$1 and row_index=0', [f.id])).rows[0], savedItem);
  assert.equal((await f.db.query('select created_by_email from xero_financial_sync_runs where id=$1', [f.id])).rows[0].created_by_email, f.run.created_by_email);
});

test('native bounded run/item/chunk caps and immutable service/browser ACLs reject payloads without publishing', opts, async t => {
  const f = await fixture(t); const tooLargeRun = structuredClone(f.run); tooLargeRun.control_totals.padding = 'x'.repeat(8388608);
  await assert.rejects(f.begin(tooLargeRun), /STAGED_INVALID/); await f.begin();
  const largeItem = structuredClone(f.items[0]); largeItem.proposed_payload.padding = 'x'.repeat(262144);
  await assert.rejects(f.append([largeItem]), /ITEM_TOO_LARGE/);
  const largeChunk = structuredClone(f.items); largeChunk.forEach(i => { i.proposed_payload.padding = 'x'.repeat(180000); });
  await assert.rejects(f.append(largeChunk), /CHUNK_INVALID/);
  for (const table of ['xero_financial_preview_builds', 'xero_financial_preview_build_items']) {
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal((await f.db.query('select has_table_privilege(current_user,$1,$2) ok', [table, privilege])).rows[0].ok, false);
    assert.equal((await f.db.query('select relrowsecurity and relforcerowsecurity enabled from pg_class where oid=$1::regclass', [table])).rows[0].enabled, true);
  }
  for (const role of ['anon', 'authenticated']) {
    await f.db.query(`reset role; set role ${role}`);
    for (const table of ['xero_financial_preview_builds', 'xero_financial_preview_build_items']) await assert.rejects(f.db.query(`select * from ${table}`), /permission denied/);
    for (const [name, args] of [['begin_xero_financial_preview_v2', [f.run, 3, f.identity]], ['append_xero_financial_preview_v2', [f.id, f.identity, f.items]],
      ['finalize_xero_financial_preview_v2', [f.id, f.identity]], ['xero_preview_run_material_v2', [f.run]]]) await assert.rejects(f.raw(name, args), /permission denied/);
  }
});

test('native stage evidence is immutable, cumulative cap rejects before insertion, and expired captures cannot publish', opts, async t => {
  const f = await fixture(t); await f.begin(); await f.append(f.items.slice(0, 1));
  await assert.rejects(f.asOwner(() => f.db.query("update xero_financial_preview_build_items set payload='{}' where request_id=$1", [f.id])), /STAGED_IMMUTABLE/);
  await assert.rejects(f.asOwner(() => f.db.query("update xero_financial_preview_builds set review_identity=$2 where request_id=$1", [f.id, hash('different')])), /STAGED_IMMUTABLE/);
  const original = (await f.db.query('select staged_bytes from xero_financial_preview_builds where request_id=$1', [f.id])).rows[0].staged_bytes;
  // Simulate a build at the persisted byte boundary without another 100 MiB allocation.
  await f.asOwner(async () => {
    await f.db.query('alter table xero_financial_preview_builds disable trigger xero_preview_build_immutable');
    await f.db.query('update xero_financial_preview_builds set staged_bytes=104857600 where request_id=$1', [f.id]);
    await f.db.query('alter table xero_financial_preview_builds enable trigger xero_preview_build_immutable');
  });
  await assert.rejects(f.append(f.items.slice(1)), /STAGED_TOO_LARGE/); assert.equal((await f.counts()).staged, 1);
  await f.asOwner(async () => {
    await f.db.query('alter table xero_financial_preview_builds disable trigger xero_preview_build_immutable');
    await f.db.query('update xero_financial_preview_builds set staged_bytes=$2 where request_id=$1', [f.id, original]);
    await f.db.query('alter table xero_financial_preview_builds enable trigger xero_preview_build_immutable');
  });
  await f.append(f.items.slice(1));
  await f.asOwner(async () => {
    await f.db.query('alter table xero_financial_preview_checkpoints disable trigger xero_preview_checkpoint_immutable');
    await f.db.query("update xero_financial_preview_checkpoints set created_at=now()-interval '20 minutes',expires_at=now()-interval '1 second' where id=$1", [f.checkpoint.id]);
    await f.db.query('alter table xero_financial_preview_checkpoints enable trigger xero_preview_checkpoint_immutable');
  });
  await assert.rejects(f.finalize(), /SCOPE_CHANGED/); assert.equal((await f.counts()).runs, 0);
});

test('native concurrent begin/finalize serializes once and zero-count previews publish completely', opts, async t => {
  const f = await fixture(t, 0); const contender = await f.connect(); await contender.query('set role service_role');
  const begins = await Promise.all([f.begin(), f.begin(f.run, 0, f.identity, contender)]);
  assert.ok(begins.every(r => r.runId === f.id && r.receivedItemCount === 0));
  const finals = await Promise.all([f.finalize(), f.finalize(contender)]);
  assert.deepEqual(finals.map(r => r.reused).sort(), [false, true]);
  assert.deepEqual(await f.counts(), { runs: 1, items: 0, audits: 1, staged: 0 });
});

// Optional sealed historical evidence: exact full classified document payloads,
// not current provider proof. Complete historical payment evidence is retained.
const historicPath = process.env.FCOS_PREVIEW_STAGED_HISTORIC_RESULT;
test('native historical complete document preview publishes bounded chunks and verifies immutable retry',
  { ...opts, skip: !nativeUrl || !historicPath, timeout: 120000 }, async t => {
    const envelope = JSON.parse(await readFile(historicPath, 'utf8'));
    const decode = n => n.t === 'object' ? Object.fromEntries(n.v.map(([key, value]) => [key, decode(value)]))
      : n.t === 'array' ? n.v.map(decode) : n.t === 'null' ? null : n.v;
    assert.equal(envelope.format, 'fcos-post-reset-readonly-evidence'); assert.equal(envelope.version, 1);
    const historic = decode(envelope.payload).result; const rows = historic.classification.documents.rows;
    assert.equal(rows.length, 2995);
    const f = await fixture(t, rows.length, { paymentRows: historic.classification.payments }); const items = rows.map((row, index) => toSyncItemRow(row, f.id, index, iso));
    f.run.classification_summary = historic.classification.documents.summary;
    f.run.control_totals = { ...historic.classification.documents.controlTotals, ...f.run.control_totals };
    const { rows: [{ pid }] } = await f.db.query('select pg_backend_pid() pid');
    let peakRss = 0; const rss = () => { try { peakRss = Math.max(peakRss, Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim())); } catch { /* Backend exited. */ } };
    const sample = setInterval(rss, 50); const started = performance.now();
    try {
      rss(); await f.begin(f.run, items.length); let chunk = []; let chunkBytes = 2; let chunks = 0; let maxChunkBytes = 0;
      const flush = async () => { if (!chunk.length) return; maxChunkBytes = Math.max(maxChunkBytes, chunkBytes); await f.append(chunk); chunks += 1; chunk = []; chunkBytes = 2; };
      for (const item of items) {
        const size = Buffer.byteLength(JSON.stringify(item)); assert.ok(size <= 256 * 1024);
        if (chunkBytes + size + 1 > 450 * 1024) await flush();
        chunkBytes += size + (chunk.length ? 1 : 0); chunk.push(item);
      }
      await flush(); const saved = await f.finalize(); assert.equal(saved.items.length, items.length);
      const retry = await f.begin(f.run, items.length); assert.equal(retry.reused, true); assert.deepEqual(retry.items, saved.items);
      assert.deepEqual(await f.counts(), { runs: 1, items: rows.length, audits: 1, staged: rows.length }); rss();
      t.diagnostic(JSON.stringify({ historicalOnly: true, providerCalls: 0, financialWrites: 0, documentItems: items.length, paymentRows: historic.classification.payments.length, runWireBytes: Buffer.byteLength(JSON.stringify(f.run)),
        itemWireBytes: items.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0), chunks, maxChunkBytes,
        elapsedMilliseconds: Math.round(performance.now() - started), backendPeakRssKiB: peakRss }));
    } finally { clearInterval(sample); }
  });
