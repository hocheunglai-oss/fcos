import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { createPreviewCheckpoint, savePreviewCheckpoint, previewCheckpointReference, markPreviewCheckpointPublished } from '../api/_xeroPreviewCheckpoint.js';
import { performance } from 'node:perf_hooks';
import { previewEvidenceHash } from '../api/_xeroPreviewPersistence.js';
import { loadPreviewCheckpoint, loadPublishedPreviewCheckpoint, partitionPreviewCheckpoint } from '../api/_xeroPreviewCheckpoint.js';
import { buildReconciliationCases } from '../api/_xeroReconciliationPolicy.js';

const nativeUrl = process.env.FCOS_PREVIEW_PAYMENT_REFERENCE_TEST_DATABASE_URL || process.env.FCOS_PREVIEW_TEST_DATABASE_URL || process.env.FCOS_CAMPAIGN_TEST_DATABASE_URL;
if (!nativeUrl && process.env.FCOS_REQUIRE_NATIVE_POSTGRES === '1') throw new Error('FCOS_PREVIEW_TEST_DATABASE_URL is required for native payment-reference checks');
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

async function backendRssSampler(pid, connectionUrl) {
  const run = promisify(execFile);
  const port = new URL(connectionUrl).port || '5432';
  // Supabase CI runs PostgreSQL in a PID namespace. Match the exact published
  // loopback database port before reading that backend inside its container.
  const candidates = await run('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.ID}}'])
    .then(result => result.stdout.trim().split(/\s+/).filter(Boolean), () => []);
  const matches = [];
  for (const id of candidates) {
    const inspected = JSON.parse((await run('docker', ['inspect', id])).stdout)[0];
    if ((inspected.NetworkSettings?.Ports?.['5432/tcp'] || []).some(binding => binding.HostPort === port)) matches.push(id);
  }
  assert.ok(matches.length <= 1, 'The disposable database port must identify one container');
  if (matches.length) {
    const id = matches[0];
    const command = (await run('docker', ['exec', id, 'cat', `/proc/${pid}/comm`])).stdout.trim();
    // Linux truncates comm to 15 bytes; the pinned Supabase image runs
    // .postgres-wrapped. Its readable status does not require ptrace access.
    assert.ok(['postgres', '.postgres-wrapp'].includes(command), 'The measured container process must be PostgreSQL');
    return async () => {
      const status = (await run('docker', ['exec', id, 'cat', `/proc/${pid}/status`])).stdout;
      const value = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
      assert.ok(value > 0, 'The PostgreSQL backend RSS must be measurable');
      return value;
    };
  }
  const command = (await run('/bin/ps', ['-o', 'comm=', '-p', String(pid)])).stdout.trim();
  assert.match(command, /(^|\/)postgres(?:$|\s|:)/, 'The measured host process must be PostgreSQL');
  return async () => {
    const value = Number((await run('/bin/ps', ['-o', 'rss=', '-p', String(pid)])).stdout.trim());
    assert.ok(value > 0, 'The PostgreSQL backend RSS must be measurable');
    return value;
  };
}

async function fixture(t, count = 3, { paymentRows = [{ salesforcePaymentId: 'payment-1', amount: 10 }], capture = null, compact = true, ttlSeconds = 900 } = {}) {
  const includePayments = capture !== null || paymentRows !== null;
  const actualTenant = capture?.provider?.xero?.tenantId || tenant;
  const payments = capture?.provider?.payments || (includePayments ? { tenantId: actualTenant, rows: paymentRows } : null);
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
  const dbName = `fcos_payment_ref_${randomUUID().replaceAll('-', '')}`;
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
  await db.query("insert into xero_contact_sync_connections(id,tenant_id,refresh_token,token_version) values('primary',$1,'fixture-only',1)", [actualTenant]);
  await db.query('set role service_role');
  const raw = async (name, values, connection = db) => (await connection.query(`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) result`,
    values.map((value, index) => ((name === 'authorise_xero_financial_sync_run_v1' && index === 2)
      || (name === 'xero_campaign_prepare_v1' && index === 4)) ? value : value && typeof value === 'object' ? JSON.stringify(value) : value))).rows[0].result;
  const client = { async rpc(name, parameters) { try { return { data: await raw(name, Object.values(parameters)), error: null }; }
    catch (error) { return { error: { code: error.code, message: error.message } }; } } };
  const scope = { actorId: actor, tenantId: actualTenant, salesforceOrgId: '00D2x000000Ei4oEAC', reconciliationVersion: 18,
    inputOptions: { linkFirst: true, includePayments, recordExactMatches: false, cutoffDate: '2026-01-01', postingMode: 'draft', campaignId: null },
    inputEvidenceHash: hash('complete checkpoint source') };
  const cpPayload = capture || { complete: true, provider: { xero: { tenantId: actualTenant, documents: [], contacts: [] },
    accountResponse: { Accounts: [] }, taxResponse: { TaxRates: [] }, allMappings: { data: [] }, payments },
    automaticMappingPolicy: { changedCount: 0 }, snapshotStartedAt: iso, callForecast: { callsNeeded: 50 }, rate: { dayRemaining: 869 } };
  const pending = await createPreviewCheckpoint(client, scope, { ttlSeconds });
  const checkpoint = await savePreviewCheckpoint(client, { id: pending.id, revision: pending.revision, scope, payload: cpPayload });
  const id = randomUUID(); const identity = hash(id);
  const run = { id, idempotency_key: `preview:${id}`, mode: 'preview', status: 'building', revision: 1,
    cutoff_date: '2026-01-01', source_snapshot_at: iso, xero_snapshot_at: iso, source_fingerprint: hash('source'), xero_fingerprint: hash('xero'),
    control_totals: { postingMode: 'draft', workflowSnapshot: { persistenceVersion: 2, complete: true, expectedItemCount: count,
      reviewIdentity: identity, tenantId: actualTenant, salesforceOrgId: scope.salesforceOrgId, reconciliationVersion: 18,
      includePayments, recordExactMatches: false, linkFirst: true, campaignId: null, payments, inputEvidenceHash: hash('source'),
      previewCheckpointInputEvidenceHash: checkpoint.input_evidence_hash, previewCheckpointPayloadHash: checkpoint.payload_hash,
      inventoryReference: previewCheckpointReference(checkpoint) } },
    classification_summary: { total: count, eligible: count }, rate_limit_snapshot: { dayRemaining: 600 },
    created_by: actor, created_by_email: 'fixture@example.test', created_at: iso, updated_at: iso };
  const inlineRun = structuredClone(run);
  if (includePayments && compact) {
    delete run.control_totals.workflowSnapshot.payments;
    run.control_totals.workflowSnapshot.paymentsReference = structuredClone(run.control_totals.workflowSnapshot.inventoryReference);
  }
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
  return { db, connect, raw, client, run, inlineRun, cpPayload, items, id, identity, checkpoint, scope, begin, append, finalize, asOwner, counts };
}

test('native exact payment reference publishes once and resolves the complete checkpoint only for its published run', opts, async t => {
  const f = await fixture(t);
  const snapshot = f.run.control_totals.workflowSnapshot;
  assert.equal(Object.keys(snapshot.paymentsReference).length, 13);
  assert.deepEqual(snapshot.paymentsReference, snapshot.inventoryReference);
  assert.equal(Object.hasOwn(snapshot, 'payments'), false);
  await assert.rejects(loadPublishedPreviewCheckpoint(f.client, snapshot.paymentsReference,
    { runId: f.id, actorId: actor, tenantId: f.scope.tenantId }), /checkpoint/i);
  await f.begin(); await f.append(); await f.finalize();
  const persisted = (await f.db.query('select control_totals from xero_financial_sync_runs where id=$1', [f.id])).rows[0].control_totals.workflowSnapshot;
  assert.deepEqual(persisted.paymentsReference, persisted.inventoryReference);
  assert.equal(Object.hasOwn(persisted, 'payments'), false);
  await assert.rejects(loadPublishedPreviewCheckpoint(f.client, persisted.paymentsReference,
    { runId: f.id, actorId: actor, tenantId: f.scope.tenantId }), /checkpoint/i);
  await markPreviewCheckpointPublished(f.client, { id: f.checkpoint.id, revision: f.checkpoint.revision, scope: f.scope, runId: f.id });
  const hydrated = await loadPublishedPreviewCheckpoint(f.client, persisted.paymentsReference,
    { runId: f.id, actorId: actor, tenantId: f.scope.tenantId });
  assert.deepEqual(hydrated.payload.provider.payments, f.cpPayload.provider.payments);
  assert.equal(hydrated.payload_hash, previewEvidenceHash(f.cpPayload));
  assert.equal((await f.begin()).reused, true);
  assert.deepEqual(await f.counts(), { runs: 1, items: 3, audits: 1, staged: 3 });
  for (const options of [{ runId: randomUUID(), actorId: actor, tenantId: f.scope.tenantId },
    { runId: f.id, actorId: randomUUID(), tenantId: f.scope.tenantId },
    { runId: f.id, actorId: actor, tenantId: randomUUID() }]) {
    await assert.rejects(loadPublishedPreviewCheckpoint(f.client, persisted.paymentsReference, options), /checkpoint/i);
  }
});

test('native payment references reject missing, both, null, caller paths/counts and mismatched immutable identity', opts, async t => {
  const f = await fixture(t);
  const mutations = [s => { delete s.paymentsReference; }, s => { s.payments = null; },
    s => { s.payments = { tenantId: f.scope.tenantId, rows: [] }; }, s => { s.paymentsReference = null; },
    s => { s.paymentsReference = []; }, s => { s.paymentsReference.path = 'provider.payments'; },
    s => { s.paymentsReference.rowCount = 1; }, s => { s.paymentsReference.checkpointId = randomUUID(); },
    s => { s.paymentsReference.actorId = randomUUID(); }, s => { s.paymentsReference.tenantId = randomUUID(); },
    s => { s.paymentsReference.payloadHash = hash('corrupt payload'); },
    s => { s.paymentsReference.storageHash = hash('corrupt manifest'); },
    s => { s.paymentsReference.inputEvidenceHash = hash('different source'); },
    s => { s.paymentsReference.capturedAt = '2026-09-29T00:00:00.000Z'; },
    s => { s.paymentsReference.revision += 1; }, s => { s.paymentsReference.tokenVersion += 1; },
    s => { s.paymentsReference.storageVersion = 1; }];
  for (const mutate of mutations) {
    const run = structuredClone(f.run); mutate(run.control_totals.workflowSnapshot);
    await assert.rejects(f.begin(run), /STAGED_/);
    assert.deepEqual(await f.counts(), { runs: 0, items: 0, audits: 0, staged: 0 });
  }
  // Equal-looking foreign references still have to match the immutable parent.
  for (const field of ['actorId', 'tenantId', 'inputEvidenceHash', 'payloadHash', 'storageHash']) {
    const run = structuredClone(f.run); const s = run.control_totals.workflowSnapshot;
    s.inventoryReference[field] = ['actorId', 'tenantId'].includes(field) ? randomUUID() : hash(`foreign-${field}`);
    s.paymentsReference = structuredClone(s.inventoryReference);
    await assert.rejects(f.begin(run), /SCOPE_CHANGED/);
  }
  const foreign = structuredClone(f.run); foreign.created_by = randomUUID();
  await assert.rejects(f.begin(foreign), /SCOPE_CHANGED/);
});

test('native payment-reference migration retains complete inline legacy manifests and excludes references when payments are disabled', opts, async t => {
  const inline = await fixture(t, 1, { compact: false, paymentRows: [{ id: 'legacy-payment', amount: 15, evidence: { retained: true } }] });
  await inline.begin(); await inline.append(); await inline.finalize();
  const persisted = (await inline.db.query('select control_totals from xero_financial_sync_runs where id=$1', [inline.id])).rows[0].control_totals.workflowSnapshot;
  assert.deepEqual(persisted.payments, inline.cpPayload.provider.payments);
  assert.equal(Object.hasOwn(persisted, 'paymentsReference'), false);
  const disabled = await fixture(t, 1, { paymentRows: null });
  for (const paymentsReference of [null, disabled.run.control_totals.workflowSnapshot.inventoryReference]) {
    const run = structuredClone(disabled.run); run.control_totals.workflowSnapshot.paymentsReference = paymentsReference;
    await assert.rejects(disabled.begin(run), /STAGED_INVALID/);
  }
  const withPayments = structuredClone(disabled.run);
  withPayments.control_totals.workflowSnapshot.payments = { tenantId: disabled.scope.tenantId, rows: [] };
  await assert.rejects(disabled.begin(withPayments), /STAGED_INVALID/);
  delete disabled.run.control_totals.workflowSnapshot.payments;
  await disabled.begin(); await disabled.append(); await disabled.finalize();
  assert.equal((await disabled.begin()).reused, true);
});

test('native reference scope requires a complete captured rows array, current access/tenant and original capture TTL', opts, async t => {
  const f = await fixture(t);
  const pending = await createPreviewCheckpoint(f.client, f.scope);
  const incomplete = structuredClone(f.run); const s = incomplete.control_totals.workflowSnapshot;
  s.inventoryReference = previewCheckpointReference(pending); s.paymentsReference = structuredClone(s.inventoryReference);
  s.previewCheckpointPayloadHash = null;
  await assert.rejects(f.begin(incomplete), /SCOPE_CHANGED/);
  const { manifest, parts } = partitionPreviewCheckpoint(f.checkpoint.payload);
  await f.raw('xero_preview_checkpoint_save_chunks_v2', [pending.id, pending.revision, f.scope, parts.slice(0, -1)]);
  await assert.rejects(f.raw('xero_preview_checkpoint_finalize_v2', [pending.id, pending.revision, f.scope, manifest,
    { complete: true, tenantId: f.scope.tenantId, includePayments: true, snapshotStartedAt: f.cpPayload.snapshotStartedAt,
      providerKeys: ['accountResponse', 'allMappings', 'payments', 'taxResponse', 'xero'] }, previewEvidenceHash(f.cpPayload)]), /INCOMPLETE/);
  const badCapture = structuredClone(f.cpPayload); badCapture.provider.payments.rows = null;
  const bad = await fixture(t, 1, { capture: badCapture });
  await assert.rejects(bad.begin(), /PAYMENTS_INVALID/);
  await f.begin();
  await f.asOwner(() => f.db.query('update staged_test_access set active=false where id=$1', [actor]));
  await assert.rejects(f.append(), /ACCESS_REQUIRED/);
  await f.asOwner(() => f.db.query('update staged_test_access set active=true where id=$1', [actor]));
  await f.asOwner(() => f.db.query("update xero_contact_sync_connections set tenant_id=$1 where id='primary'", [randomUUID()]));
  await assert.rejects(f.finalize(), /CONNECTION_CHANGED/);
  const expiring = await fixture(t, 1, { ttlSeconds: 2 }); const originalExpiry = expiring.checkpoint.expires_at;
  await expiring.begin(); await new Promise(resolve => setTimeout(resolve, 2100));
  await assert.rejects(expiring.append(), /SCOPE_CHANGED/);
  assert.equal((await expiring.db.query('select expires_at from xero_financial_preview_checkpoints where id=$1', [expiring.checkpoint.id])).rows[0].expires_at.toISOString(), new Date(originalExpiry).toISOString());
  assert.deepEqual(await expiring.counts(), { runs: 0, items: 0, audits: 0, staged: 0 });
});

test('native payment references retain forced RLS, service-only RPCs and immutable stage/chunk evidence', opts, async t => {
  const f = await fixture(t); await f.begin();
  for (const table of ['xero_financial_preview_checkpoints', 'xero_financial_preview_checkpoint_chunks',
    'xero_financial_preview_builds', 'xero_financial_preview_build_items']) {
    assert.equal((await f.db.query('select relrowsecurity and relforcerowsecurity enabled from pg_class where oid=$1::regclass', [table])).rows[0].enabled, true);
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      assert.equal((await f.db.query('select has_table_privilege(current_user,$1,$2) ok', [table, privilege])).rows[0].ok, false);
    }
  }
  await assert.rejects(f.raw('xero_preview_build_scope_v2', [f.run, false]), /permission denied/);
  await assert.rejects(f.raw('xero_preview_payment_rows_v2', [f.id, actor, f.scope.tenantId, null, true]), /permission denied/);
  await assert.rejects(f.raw('xero_preview_checkpoint_node_value_v2', [f.checkpoint.id, {}, 0]), /permission denied/);
  await assert.rejects(f.asOwner(() => f.db.query("update xero_financial_preview_checkpoint_chunks set payload_text='{}' where checkpoint_id=$1", [f.checkpoint.id])), /CHECKPOINT_STALE/);
  await assert.rejects(f.asOwner(() => f.db.query("update xero_financial_preview_builds set run_payload='{}' where request_id=$1", [f.id])), /STAGED_IMMUTABLE/);
  for (const role of ['anon', 'authenticated']) {
    await f.db.query(`reset role; set role ${role}`);
    await assert.rejects(f.begin(), /permission denied/);
    await assert.rejects(f.raw('xero_preview_build_scope_v2', [f.run, false]), /permission denied/);
    await assert.rejects(f.raw('xero_preview_payment_rows_v2', [f.id, actor, f.scope.tenantId, null, true]), /permission denied/);
    await assert.rejects(f.raw('xero_preview_checkpoint_node_value_v2', [f.checkpoint.id, {}, 0]), /permission denied/);
  }
  await f.db.query('reset role; set role service_role');
  // Simulate corruption by a database administrator, beyond service ACLs.
  await f.asOwner(async () => {
    await f.db.query('alter table xero_financial_preview_builds disable trigger xero_preview_build_immutable');
    await f.db.query("update xero_financial_preview_builds set run_payload=jsonb_set(run_payload,'{control_totals,workflowSnapshot,paymentsReference,payloadHash}',to_jsonb($2::text)) where request_id=$1", [f.id, hash('tampered')]);
    await f.db.query('alter table xero_financial_preview_builds enable trigger xero_preview_build_immutable');
  });
  await assert.rejects(f.begin(), /STAGED_CORRUPT/);
  await assert.rejects(f.append(), /PAYMENTS_INVALID/);
  await assert.rejects(f.finalize(), /PAYMENTS_INVALID/);
  await f.asOwner(async () => {
    await f.db.query('alter table xero_financial_preview_checkpoint_chunks disable trigger xero_preview_checkpoint_chunk_immutable');
    await f.db.query("update xero_financial_preview_checkpoint_chunks set payload_text='{}' where checkpoint_id=$1 and ordinal=0", [f.checkpoint.id]);
    await f.db.query('alter table xero_financial_preview_checkpoint_chunks enable trigger xero_preview_checkpoint_chunk_immutable');
  });
  await assert.rejects(loadPreviewCheckpoint(f.client, f.scope, { id: f.checkpoint.id }), /checkpoint/i);
  assert.deepEqual(await f.counts(), { runs: 0, items: 0, audits: 0, staged: 0 });
});

function campaignCases(f) {
  return buildReconciliationCases({ tenantId: f.scope.tenantId, run: f.inlineRun, items: f.items, ownerId: actor });
}

test('native campaign create/refresh resolve references only after publication and retain exact case/actor controls', opts, async t => {
  const f = await fixture(t, 2); await f.begin(); await f.append(); await f.finalize();
  const cases = campaignCases(f);
  const create = (rows = cases, user = actor) => f.raw('xero_campaign_create_v1', [user, f.scope.tenantId, f.id, 1, rows]);
  await assert.rejects(create(), /PUBLICATION_INVALID/);
  await markPreviewCheckpointPublished(f.client, { id: f.checkpoint.id, revision: f.checkpoint.revision, scope: f.scope, runId: f.id });
  await assert.rejects(create(cases.slice(0, -1)), /complete unchanged/);
  const invented = structuredClone(cases); const payment = invented.find(row => row.sourceObject === 'Payment__c');
  payment.sourceId = 'foreign-payment'; payment.id = payment.caseKey = `${f.scope.tenantId}:Payment__c:foreign-payment`;
  await assert.rejects(create(invented), /saved source identities/);
  const foreignOwner = structuredClone(cases); foreignOwner[0].ownerId = randomUUID();
  await assert.rejects(create(foreignOwner), /ownership/);
  await assert.rejects(create(cases, randomUUID()), /management access/);
  const campaign = await create();
  assert.equal((await f.db.query('select count(*)::integer count from xero_reconciliation_cases where campaign_id=$1', [campaign.id])).rows[0].count, cases.length);
  const refreshed = await f.raw('xero_campaign_refresh_v1', [actor, campaign.id, 1, f.id, 1, cases]);
  assert.equal(refreshed.revision, 2); assert.equal(refreshed.baseline_at, campaign.baseline_at); assert.equal(refreshed.run_id, campaign.run_id);
  await assert.rejects(f.raw('xero_campaign_refresh_v1', [actor, campaign.id, 2, f.id, 1, invented]), /exact saved source identities/);
  assert.equal((await f.db.query('select revision from xero_reconciliation_campaigns where id=$1', [campaign.id])).rows[0].revision, 2);
  // A modified persisted reference cannot authorize campaign reads, even when
  // inventoryReference remains valid and a campaign already exists.
  await f.asOwner(() => f.db.query("update xero_financial_sync_runs set control_totals=jsonb_set(control_totals,'{workflowSnapshot,paymentsReference,payloadHash}',to_jsonb($2::text)) where id=$1", [f.id, hash('corrupt-payment-reference')]));
  await assert.rejects(create(), /PAYMENTS_INVALID/);
  await assert.rejects(f.raw('xero_campaign_refresh_v1', [actor, campaign.id, 2, f.id, 1, cases]), /PAYMENTS_INVALID/);
});

test('native campaign reference readers reject duplicate payment identities and corrupt stored chunk bytes', opts, async t => {
  const duplicate = await fixture(t, 0, { paymentRows: [{ salesforcePaymentId: 'same' }, { salesforcePaymentId: 'same' }] });
  await duplicate.begin(); await duplicate.finalize();
  await markPreviewCheckpointPublished(duplicate.client, { id: duplicate.checkpoint.id, revision: duplicate.checkpoint.revision, scope: duplicate.scope, runId: duplicate.id });
  await assert.rejects(duplicate.raw('xero_campaign_create_v1', [actor, duplicate.scope.tenantId, duplicate.id, 1, []]), /unique saved payment identities/);
  const f = await fixture(t, 0); await f.begin(); await f.finalize();
  await markPreviewCheckpointPublished(f.client, { id: f.checkpoint.id, revision: f.checkpoint.revision, scope: f.scope, runId: f.id });
  await f.asOwner(async () => {
    await f.db.query('alter table xero_financial_preview_checkpoint_chunks disable trigger xero_preview_checkpoint_chunk_immutable');
    await f.db.query("update xero_financial_preview_checkpoint_chunks set payload_text='{}' where checkpoint_id=$1 and ordinal=0", [f.checkpoint.id]);
    await f.db.query('alter table xero_financial_preview_checkpoint_chunks enable trigger xero_preview_checkpoint_chunk_immutable');
  });
  await assert.rejects(f.raw('xero_campaign_create_v1', [actor, f.scope.tenantId, f.id, 1, campaignCases(f)]), /CHECKPOINT_CORRUPT|PAYMENTS_INVALID/);
});

test('native referenced payment finish retains exact approval, amount, target and original mapping proof', opts, async t => {
  const payment = { salesforcePaymentId: 'a0S000000000001', salesforcePaymentName: 'PAY-1', action: 'payment_link', status: 'eligible',
    blockers: [], amount: 100, currency: 'USD', paymentDate: '2026-09-01', documentMappingId: randomUUID(),
    xeroDocumentId: randomUUID(), xeroPaymentId: randomUUID(), bankAccountId: randomUUID(),
    sourceFingerprint: hash('payment-source'), reviewFingerprint: hash('payment-review') };
  const f = await fixture(t, 0, { paymentRows: [payment] });
  await f.asOwner(async () => {
    await f.db.query(`insert into xero_financial_document_mappings(id,salesforce_object,salesforce_id,salesforce_document_number,document_kind,
      xero_document_type,xero_document_id,xero_contact_id,source_fingerprint,financial_fingerprint,protected_legacy)
      values($1,'Invoice__c','a0K000000000001','INV-1','buyer_invoice','ACCREC',$2,$3,$4,$5,true)`,
    [payment.documentMappingId, payment.xeroDocumentId, randomUUID(), hash('document-source'), hash('document-financial')]);
    await f.db.query(`insert into xero_financial_bank_mappings(salesforce_bank_name,xero_bank_account_id,xero_bank_account_name)
      values('Fixture bank',$1,'Fixture USD')`, [payment.bankAccountId]);
  });
  await f.begin(); await f.finalize();
  await markPreviewCheckpointPublished(f.client, { id: f.checkpoint.id, revision: f.checkpoint.revision, scope: f.scope, runId: f.id });
  const cases = campaignCases(f); const row = cases[0];
  const campaign = await f.raw('xero_campaign_create_v1', [actor, f.scope.tenantId, f.id, 1, cases]);
  const prepared = await f.raw('xero_campaign_prepare_v1', [actor, campaign.id, 1, 'link_only', [row.id], { writeCalls: 0 }]);
  await assert.rejects(f.raw('xero_campaign_claim_v1', [actor, prepared.id, prepared.revision]), /unchanged approved batch/);
  const approved = await f.raw('xero_campaign_approve_v1', [actor, prepared.id, prepared.revision, prepared.evidence_fingerprint]);
  const claim = await f.raw('xero_campaign_claim_v1', [actor, approved.id, approved.revision]);
  const outcome = { caseId: row.id, evidenceFingerprint: row.evidenceFingerprint, status: 'reconciled',
    verificationFingerprint: hash('provider-readback-fixture'), paymentEvidence: payment,
    paymentMapping: { salesforce_payment_id: payment.salesforcePaymentId, salesforce_payment_name: payment.salesforcePaymentName,
      document_mapping_id: payment.documentMappingId, xero_payment_id: payment.xeroPaymentId, xero_bank_account_id: payment.bankAccountId,
      source_fingerprint: payment.sourceFingerprint, amount: 100, currency: 'USD', payment_date: payment.paymentDate, status: 'linked' } };
  const finish = value => f.raw('xero_campaign_finish_v1', [actor, claim.batch.id, claim.batch.claim_id, [value]]);
  for (const mutate of [o => { o.paymentMapping.amount = 999; }, o => { o.paymentMapping.xero_payment_id = randomUUID(); },
    o => { o.paymentEvidence.sourceFingerprint = hash('changed-source'); }, o => { o.evidenceFingerprint = hash('changed-case'); }]) {
    const changed = structuredClone(outcome); mutate(changed); await assert.rejects(finish(changed), /exact approved|after approval|Invalid case outcome/);
    assert.equal((await f.db.query('select count(*)::integer count from xero_financial_payment_mappings')).rows[0].count, 0);
  }
  const completed = await finish(outcome); assert.equal(completed.verified_count, 1); assert.equal(completed.status, 'completed');
  const persisted = (await f.db.query('select amount,xero_payment_id,source_fingerprint from xero_financial_payment_mappings')).rows[0];
  assert.equal(Number(persisted.amount), 100); assert.equal(persisted.xero_payment_id, payment.xeroPaymentId); assert.equal(persisted.source_fingerprint, payment.sourceFingerprint);
});

test('native split payment rows preserve exact evidence and fail closed at existing depth/run boundaries', { ...opts, timeout: 120000 }, async t => {
  const split = { salesforcePaymentId: 'split-row', action: 'payment_link', blockers: [],
    evidence: { first: 'a'.repeat(130000), second: 'b'.repeat(130000), third: 'c'.repeat(130000) } };
  const f = await fixture(t, 0, { paymentRows: [split] }); await f.begin(); await f.finalize();
  await markPreviewCheckpointPublished(f.client, { id: f.checkpoint.id, revision: f.checkpoint.revision, scope: f.scope, runId: f.id });
  const complete = await f.asOwner(() => f.raw('xero_preview_payment_rows_v2', [f.id, actor, f.scope.tenantId, split.salesforcePaymentId, false]));
  assert.deepEqual(complete, split);
  await assert.rejects(f.asOwner(() => f.raw('xero_preview_checkpoint_node_value_v2', [f.checkpoint.id, {}, 65])), /CHECKPOINT_INVALID/);
  const huge = { salesforcePaymentId: 'oversized-complete-row', action: 'payment_link', blockers: [],
    evidence: Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`part${index}`, 'x'.repeat(128000)])) };
  const large = await fixture(t, 0, { paymentRows: [huge] }); await large.begin(); await large.finalize();
  await markPreviewCheckpointPublished(large.client, { id: large.checkpoint.id, revision: large.checkpoint.revision, scope: large.scope, runId: large.id });
  const ids = await large.asOwner(() => large.raw('xero_preview_payment_rows_v2', [large.id, actor, large.scope.tenantId, null, true]));
  assert.equal(ids.salesforcePaymentId, huge.salesforcePaymentId);
  const cases = campaignCases(large);
  const campaign = await large.raw('xero_campaign_create_v1', [actor, large.scope.tenantId, large.id, 1, cases]);
  assert.equal((await large.db.query('select count(*)::integer count from xero_reconciliation_cases where campaign_id=$1', [campaign.id])).rows[0].count, 1);
  await assert.rejects(large.asOwner(() => large.raw('xero_preview_payment_rows_v2', [large.id, actor, large.scope.tenantId, huge.salesforcePaymentId, false])), /ROW_TOO_LARGE/);
});

const capturePath = process.env.FCOS_PREVIEW_PAYMENT_CAPTURE_PAYLOAD_PATH;
test('native payment reference preserves every value of a complete 4408-row capture while begin/finalize memory stays bounded',
  { ...opts, timeout: 120000 }, async t => {
    const capture = capturePath ? JSON.parse(await readFile(capturePath, 'utf8')) : {
      complete: true, provider: { xero: { tenantId: tenant, documents: [], contacts: [] }, accountResponse: { Accounts: [] },
        taxResponse: { TaxRates: [] }, allMappings: { data: [] },
        payments: { tenantId: tenant, evidenceFingerprint: hash('complete-payment-evidence'), summary: { total: 4408 },
          rows: Array.from({ length: 4408 }, (_, index) => ({ salesforcePaymentId: `payment-${index}`, amount: index + 0.1234,
            reference: 'Complete exact retained payment evidence 文'.repeat(48) })) } },
      automaticMappingPolicy: { changedCount: 0 }, snapshotStartedAt: iso, callForecast: { callsNeeded: 50 }, rate: { dayRemaining: 869 },
    };
    assert.equal(capture.complete, true); assert.equal(capture.provider.payments.rows.length, 4408);
    assert.ok(Buffer.byteLength(JSON.stringify(capture.provider.payments)) > 8 * 1024 * 1024);
    const f = await fixture(t, 3, { capture });
    const rejected = await f.connect(); await rejected.query('set role service_role');
    await assert.rejects(f.begin(f.inlineRun, 3, f.identity, rejected), /STAGED_INVALID/);
    const { rows: [{ pid }] } = await f.db.query('select pg_backend_pid() pid');
    const readRss = await backendRssSampler(pid, nativeUrl);
    let peakRss = 0; const rss = async () => {
      const value = await readRss(); peakRss = Math.max(peakRss, value); return value;
    };
    const pendingSamples = new Set(); let sampleError;
    const baselineRss = await rss();
    const sample = setInterval(() => {
      const task = rss(); pendingSamples.add(task);
      void task.catch(error => { sampleError = error; }).finally(() => pendingSamples.delete(task));
    }, 100);
    const started = performance.now();
    try {
      await f.begin(); await f.append(); await f.finalize(); await rss();
      assert.ok(peakRss - baselineRss < 64 * 1024, 'Begin/finalize must not reconstruct the 8+ MiB payment snapshot');
      const staged = (await f.db.query('select octet_length(run_payload::text) bytes from xero_financial_preview_builds where request_id=$1', [f.id])).rows[0].bytes;
      assert.ok(staged < 64 * 1024, 'The staged run must contain the exact compact reference');
      clearInterval(sample); await Promise.allSettled(pendingSamples); assert.ifError(sampleError);
      await markPreviewCheckpointPublished(f.client, { id: f.checkpoint.id, revision: f.checkpoint.revision, scope: f.scope, runId: f.id });
      const hydrated = await loadPublishedPreviewCheckpoint(f.client, f.run.control_totals.workflowSnapshot.paymentsReference,
        { runId: f.id, actorId: actor, tenantId: f.scope.tenantId });
      assert.equal(hydrated.payload.provider.payments.rows.length, 4408);
      assert.equal(previewEvidenceHash(hydrated.payload.provider.payments), previewEvidenceHash(capture.provider.payments));
      assert.deepEqual(hydrated.payload.provider.payments, capture.provider.payments);
      assert.equal(hydrated.payload_hash, previewEvidenceHash(capture));
      const cases = campaignCases(f); assert.equal(cases.length, 4411);
      const campaignStarted = performance.now();
      const campaign = await f.raw('xero_campaign_create_v1', [actor, f.scope.tenantId, f.id, 1, cases]);
      const createMilliseconds = performance.now() - campaignStarted;
      assert.ok(createMilliseconds < 10000, 'Campaign creation must scan captured payment identities once');
      assert.equal((await f.db.query('select count(*)::integer count from xero_reconciliation_cases where campaign_id=$1', [campaign.id])).rows[0].count, 4411);
      const refreshStarted = performance.now();
      const refreshed = await f.raw('xero_campaign_refresh_v1', [actor, campaign.id, 1, f.id, 1, cases]);
      const refreshMilliseconds = performance.now() - refreshStarted;
      assert.ok(refreshMilliseconds < 10000, 'Campaign refresh must scan captured payment identities once');
      assert.equal(refreshed.revision, 2);
      assert.equal((await f.begin()).reused, true);
      assert.deepEqual(await f.counts(), { runs: 1, items: 3, audits: 1, staged: 3 });
      t.diagnostic(JSON.stringify({ historicalOnly: Boolean(capturePath), providerCalls: 0, financialApprovals: 0,
        paymentRows: 4408, paymentUtf8Bytes: Buffer.byteLength(JSON.stringify(capture.provider.payments)),
        stagedRunBytes: staged, elapsedMilliseconds: Math.round(performance.now() - started),
        campaignCaseCount: cases.length, campaignCreateMilliseconds: Math.round(createMilliseconds), campaignRefreshMilliseconds: Math.round(refreshMilliseconds),
        backendBaselineRssKiB: baselineRss, backendPeakRssKiB: peakRss, backendRssGrowthKiB: peakRss - baselineRss }));
    } finally { clearInterval(sample); await Promise.allSettled(pendingSamples); }
  });
