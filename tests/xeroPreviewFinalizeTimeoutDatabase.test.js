import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createPreviewCheckpoint, savePreviewCheckpoint, previewCheckpointReference, markPreviewCheckpointPublished } from '../api/_xeroPreviewCheckpoint.js';
import { performance } from 'node:perf_hooks';

const nativeUrl = process.env.FCOS_PREVIEW_FINALIZE_TIMEOUT_TEST_DATABASE_URL || process.env.FCOS_PREVIEW_TEST_DATABASE_URL || process.env.FCOS_CAMPAIGN_TEST_DATABASE_URL;
if (!nativeUrl && process.env.FCOS_REQUIRE_NATIVE_POSTGRES === '1') throw new Error('FCOS_PREVIEW_TEST_DATABASE_URL is required for native preview-finalization timeout checks');
const opts = { skip: !nativeUrl && 'Set FCOS_PREVIEW_TEST_DATABASE_URL to disposable local PostgreSQL', timeout: 60000 };
const actor = '00000000-0000-4000-8000-000000000099';
const tenant = '00000000-0000-4000-8000-000000000011';
const iso = '2026-09-27T10:00:00.000Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const migrations = ['20260827145608_xero_contact_sync.sql', '20260829080726_xero_financial_sync.sql',
  '20260923210832_xero_financial_selection_scope.sql', '20260923213339_xero_payment_reference_link.sql',
  '20260923222821_xero_grouped_preservation_link.sql', '20260927175805_xero_issued_supplier_preservation_link.sql',
  '20260928005135_xero_group_remittance_bank_evidence.sql', '20260928053229_xero_document_field_correction_journal.sql',
  '20260929170347_xero_shared_control.sql', '20260929170953_xero_reconciliation_campaign.sql',
  '20260927154515_xero_financial_preview_persistence.sql',
  '20260929192752_xero_preview_checkpoint.sql', '20260930004000_xero_preview_checkpoint_chunks.sql',
  '20260930004100_xero_financial_preview_staged.sql', '20260930004200_xero_preview_payments_reference.sql'];

async function fixture(t, count = 3, { paymentRows = null } = {}) {
  const includePayments = paymentRows !== null;
  const url = new URL(nativeUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only disposable local PostgreSQL is allowed');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  const owner = new pg.Client({ connectionString: url.toString() }); await owner.connect();
  if (process.env.FCOS_CHECKPOINT_TEST_EXPECTED_DATA_DIRECTORY) {
    const row = (await owner.query("select current_setting('data_directory') data_directory,current_user")).rows[0];
    assert.equal(row.data_directory, process.env.FCOS_CHECKPOINT_TEST_EXPECTED_DATA_DIRECTORY);
    assert.equal(row.current_user, 'fcos_campaign_test');
  }
  await owner.query(`do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
  end$$`);
  const dbName = `fcos_finalize_timeout_${randomUUID().replaceAll('-', '')}`;
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
    create table public.user_profiles(id uuid primary key,email text,active boolean,user_type text);
    grant select on public.user_profiles to service_role;
    insert into public.user_profiles values('${actor}','fixture@example.test',true,'administrator');
    create table public.staged_test_access(id uuid primary key,active boolean not null);
    insert into public.staged_test_access values('${actor}',true);
    create function public.fcos_has_access(p_actor uuid,p_module text) returns boolean language sql stable as
      'select coalesce((select active from public.staged_test_access where id=p_actor),false) and p_module in (''xero_portal'',''xero_portal_manage'')';`);
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

const timeoutMigration = '20260930004300_xero_preview_finalize_timeout.sql';
const finalizerSignature = 'public.finalize_xero_financial_preview_v2(uuid,text)';
const timeoutFunctions = ['finalize_xero_financial_preview_v2','xero_campaign_create_v1','xero_campaign_refresh_v1'];
const catalog = async db => (await db.query(`select oid,proname,proowner,prolang,prosrc,prosecdef,provolatile,proparallel,
  proconfig,proacl from pg_proc where pronamespace='public'::regnamespace order by oid`)).rows;
const settings = async db => ({
  roles: (await db.query('select oid,rolconfig from pg_roles order by oid')).rows,
  database: (await db.query('select setdatabase,setrole,setconfig from pg_db_role_setting order by setdatabase,setrole')).rows,
});

test('native complete-preview timeout migration changes only three bounded function settings and schema notification', opts, async t => {
  const f = await fixture(t, 2); const before = await catalog(f.db); const beforeSettings = await settings(f.db);
  const old = before.find(row => row.proname === 'finalize_xero_financial_preview_v2');
  assert.ok(old); assert.equal(old.proconfig.some(value => value.startsWith('statement_timeout=')), false);
  const listener = await f.connect(); await listener.query('listen pgrst');
  let notification;
  const received = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Expected a schema-cache reload notification')), 2000);
    listener.once('notification', value => { notification = value; clearTimeout(timeout); resolve(); });
  });
  const migration = await readFile(new URL(`../supabase/migrations/${timeoutMigration}`, import.meta.url), 'utf8');
  await f.asOwner(() => f.db.query(migration)); await received;
  assert.equal(notification.channel, 'pgrst'); assert.equal(notification.payload, 'reload schema');
  const after = await catalog(f.db);
  for (const name of timeoutFunctions) {
    const previous = before.find(row => row.proname === name); const changed = after.find(row => row.oid === previous.oid);
    assert.deepEqual(changed.proconfig, [...previous.proconfig, 'statement_timeout=45s']);
  }
  assert.deepEqual(after.map(row => timeoutFunctions.includes(row.proname) ? { ...row, proconfig: before.find(prior => prior.oid === row.oid).proconfig } : row), before,
    'Function bodies, ownership, identity, security modes, language and ACLs must remain exact');
  assert.deepEqual(await settings(f.db), beforeSettings, 'No role or database defaults may change');
  assert.equal((await f.db.query('show statement_timeout')).rows[0].statement_timeout, '45s');
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await f.db.query('select has_function_privilege($1,$2,$3) allowed', [role, finalizerSignature, 'EXECUTE'])).rows[0].allowed, false);
    await f.db.query(`reset role; set role ${role}`); await assert.rejects(f.finalize(), /permission denied/);
  }
  await f.db.query('reset role; set role service_role');
  assert.equal((await f.db.query('select has_function_privilege(current_user,$1,$2) allowed', [finalizerSignature, 'EXECUTE'])).rows[0].allowed, true);
  const invalid = hash('wrong review identity');
  await f.begin(); await f.append(f.items.slice(0, 1));
  await assert.rejects(f.raw('finalize_xero_financial_preview_v2', [f.id, invalid]), /UUID_CONFLICT/);
  await assert.rejects(f.finalize(), /ITEMS_INCOMPLETE/);
  assert.deepEqual(await f.counts(), { runs: 0, items: 0, audits: 0, staged: 1 });
  t.diagnostic(JSON.stringify({ functionTimeout: '45s', functions: timeoutFunctions, unchangedBodySha256: hash(old.prosrc),
    unchangedFunctionOid: old.oid, unchangedAcl: true, unchangedRoleAndDatabaseSettings: true }));
});

test('native exact staged preview recovers after an inherited 8s cancellation when the RPC function timeout is hoisted',
  { ...opts, timeout: 35000 }, async t => {
    const f = await fixture(t, 2); await f.begin(); await f.append();
    const beforeBuild = (await f.db.query('select run_payload,run_storage_hash,run_material_hash,expected_item_count,received_item_count,created_at from xero_financial_preview_builds where request_id=$1', [f.id])).rows[0];
    const beforeCheckpoint = (await f.db.query('select expires_at,captured_at,payload_hash,storage_hash from xero_financial_preview_checkpoints where id=$1', [f.checkpoint.id])).rows[0];
    const blocker = await f.connect(); await blocker.query('begin');
    await blocker.query("select pg_advisory_xact_lock(hashtextextended('xero-preview-run:'||$1::text,0))", [f.id]);
    const request = await f.connect(); await request.query('set role service_role');
    await request.query("set statement_timeout='8s'"); await request.query("set lock_timeout='0'");
    const firstStarted = performance.now();
    let release = setTimeout(() => { void blocker.query('commit').catch(() => {}); }, 12000);
    try {
      await assert.rejects(f.finalize(request), error => error.code === '57014' && /statement timeout/.test(error.message));
      const cancelledMilliseconds = Math.round(performance.now() - firstStarted);
      assert.ok(cancelledMilliseconds >= 7500 && cancelledMilliseconds < 11000, 'Reproduce the inherited 8s RPC boundary');
      clearTimeout(release);
      assert.deepEqual(await f.counts(), { runs: 0, items: 0, audits: 0, staged: 2 });
      assert.equal((await f.db.query('select state from xero_financial_preview_builds where request_id=$1', [f.id])).rows[0].state, 'building');
      const migration = await readFile(new URL(`../supabase/migrations/${timeoutMigration}`, import.meta.url), 'utf8');
      await f.asOwner(() => f.db.query(migration));
      const config = (await request.query('select proconfig from pg_proc where oid=$1::regprocedure', [finalizerSignature])).rows[0].proconfig;
      const duration = config.find(value => value.startsWith('statement_timeout=')).split('=')[1];
      assert.equal(duration, '45s');
      // Emulate PostgREST's documented hoisting: apply the function's cached
      // setting transaction-locally before issuing the RPC's SQL statement.
      await request.query('begin'); await request.query("select set_config('statement_timeout',$1,true)", [duration]);
      assert.equal((await request.query('show statement_timeout')).rows[0].statement_timeout, '45s');
      const recoveredStarted = performance.now();
      release = setTimeout(() => { void blocker.query('commit').catch(() => {}); }, 9000);
      const saved = await f.finalize(request); const recoveredMilliseconds = Math.round(performance.now() - recoveredStarted);
      await request.query('commit'); clearTimeout(release);
      assert.ok(recoveredMilliseconds >= 8500 && recoveredMilliseconds < 20000, 'The bounded RPC budget must survive beyond 8s');
      assert.equal(saved.run.status, 'ready_for_review'); assert.equal(saved.run.revision, 1);
      assert.deepEqual(saved.items.map(row => row.id), f.items.map(row => row.id));
      assert.deepEqual(await f.counts(), { runs: 1, items: 2, audits: 1, staged: 2 });
      assert.equal((await request.query('show statement_timeout')).rows[0].statement_timeout, '8s', 'The timeout exemption must not leak to the session');
      assert.deepEqual((await f.db.query('select run_payload,run_storage_hash,run_material_hash,expected_item_count,received_item_count,created_at from xero_financial_preview_builds where request_id=$1', [f.id])).rows[0], beforeBuild);
      assert.deepEqual((await f.db.query('select expires_at,captured_at,payload_hash,storage_hash from xero_financial_preview_checkpoints where id=$1', [f.checkpoint.id])).rows[0], beforeCheckpoint);
      await markPreviewCheckpointPublished(f.client, { id: f.checkpoint.id, revision: f.checkpoint.revision, scope: f.scope, runId: f.id });
      assert.equal((await f.finalize()).reused, true); assert.equal((await f.begin()).reused, true);
      t.diagnostic(JSON.stringify({ inheritedTimeout: '8s', functionTimeout: duration, cancelledMilliseconds,
        recoveredMilliseconds, recoveredExactItems: 2, auditCount: 1, unchangedCheckpointTtlAndHashes: true,
        transactionHoistingEmulated: true, providerCalls: 0, financialApprovals: 0 }));
    } finally { clearTimeout(release); await blocker.query('rollback').catch(() => {}); await request.query('rollback').catch(() => {}); }
  });
