import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { previewEvidenceHash } from '../api/_xeroPreviewPersistence.js';

// Retain regression coverage of the immutable v1 database protocol. The current
// production client uses v2, covered by the separate bounded-chunk suite.
async function legacyRpc(client, name, parameters) {
  const result = await client.rpc(name, parameters);
  if (result.error) throw Object.assign(new Error(result.error.message), {
    code: result.error.message.match(/XERO_PREVIEW_CHECKPOINT_[A-Z_]+/)?.[0] || result.error.code,
  });
  return result.data;
}
const createPreviewCheckpoint = (client, scope, { id = randomUUID(), ttlSeconds = 900 } = {}) =>
  legacyRpc(client, 'xero_preview_checkpoint_create_v1', { p_id: id, p_scope: scope, p_ttl_seconds: ttlSeconds });
const loadPreviewCheckpoint = (client, scope, { id = null } = {}) =>
  legacyRpc(client, 'xero_preview_checkpoint_load_v1', { p_scope: scope, p_id: id });
const savePreviewCheckpoint = (client, { id, revision, scope, payload }) => {
  const text = JSON.stringify(payload);
  return legacyRpc(client, 'xero_preview_checkpoint_save_v1', { p_id: id, p_expected_revision: revision,
    p_scope: scope, p_payload: text, p_payload_hash: createHash('sha256').update(text).digest('hex') });
};
const markPreviewCheckpointPublished = (client, { id, revision, scope, runId }) =>
  legacyRpc(client, 'xero_preview_checkpoint_publish_v1', { p_id: id, p_expected_revision: revision, p_scope: scope, p_run_id: runId });

const actor = '00000000-0000-4000-8000-000000000099';
const otherActor = '00000000-0000-4000-8000-000000000098';
const tenant = '00000000-0000-4000-8000-000000000001';
const nativeUrl = process.env.FCOS_CHECKPOINT_TEST_DATABASE_URL || process.env.FCOS_CAMPAIGN_TEST_DATABASE_URL;
const checkpointMigration = '20260929192752_xero_preview_checkpoint.sql';

async function database(t) {
  if (!nativeUrl) {
    const db = new PGlite(); t.after(() => db.close());
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
    return { db };
  }
  const endpoint = new URL(nativeUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Only local PostgreSQL is permitted');
  assert.ok(['postgres:', 'postgresql:'].includes(endpoint.protocol));
  const owner = new pg.Client({ connectionString: endpoint.toString() }); await owner.connect();
  const name = `fcos_checkpoint_${randomUUID().replaceAll('-', '')}`;
  await owner.query(`create database "${name}"`); endpoint.pathname = `/${name}`;
  const clients = [];
  const connect = async () => {
    const client = new pg.Client({ connectionString: endpoint.toString() }); await client.connect(); clients.push(client);
    await client.query("set statement_timeout='10s'; set lock_timeout='4s'"); return client;
  };
  t.after(async () => {
    for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end(); }
    await owner.query(`drop database "${name}" with (force)`); await owner.end();
  });
  const primary = await connect();
  return { db: { query: (...args) => primary.query(...args), exec: sql => primary.query(sql) }, connect };
}

async function harness(t) {
  const { db, connect } = await database(t);
  await db.exec(`grant usage on schema public to service_role;
    create table checkpoint_test_access(id uuid primary key,active boolean not null);
    insert into checkpoint_test_access values('${actor}',true),('${otherActor}',true);
    create function public.fcos_has_access(p_actor uuid,p_module text) returns boolean language sql stable as
      'select coalesce((select active from public.checkpoint_test_access where id=p_actor),false) and p_module=''xero_portal''';`);
  for (const file of ['20260827145608_xero_contact_sync.sql', '20260829080726_xero_financial_sync.sql', checkpointMigration]) {
    const sql = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
    await db.exec(nativeUrl ? sql : sql.replace(/^create extension if not exists pgcrypto;$/m, ''));
  }
  await db.query("insert into xero_contact_sync_connections(id,tenant_id,refresh_token,token_version) values('primary',$1,'fixture-only',1)", [tenant]);
  await db.exec('set role service_role');
  const raw = async (name, values) => (await db.query(`select public.${name}(${values.map((_,i) => `$${i+1}`).join(',')}) result`, values)).rows[0].result;
  const client = { async rpc(name, parameters) {
    try { return { data: await raw(name, Object.values(parameters)), error: null }; }
    catch (error) { return { error: { message: error.message, code: error.code } }; }
  } };
  const scope = { actorId: actor, tenantId: tenant, salesforceOrgId: 'test-org', reconciliationVersion: 18,
    inputOptions: { linkFirst: true, includePayments: true, recordExactMatches: false, cutoffDate: '2026-01-01', postingMode: 'draft', campaignId: null },
    inputEvidenceHash: previewEvidenceHash({ source: 'complete', mappings: [], claims: [] }) };
  const payload = { complete: true, provider: { xero: { tenantId: tenant, contactsComplete: true, documents: [{ id: randomUUID(), amount: 12.3456 }], contacts: [] },
    accountResponse: { Accounts: [] }, taxResponse: { TaxRates: [] }, allMappings: { data: [] }, payments: { tenantId: tenant, rows: [] } },
    automaticMappingPolicy: { changedCount: 0 }, snapshotStartedAt: '2026-09-29T19:00:00Z', callForecast: { callsNeeded: 50 }, rate: { dayRemaining: 869 } };
  const capture = async (options = {}) => {
    const actualScope = options.scope || scope;
    const created = await createPreviewCheckpoint(client, actualScope, options);
    return savePreviewCheckpoint(client, { id: created.id, revision: created.revision, scope: actualScope, payload });
  };
  const asOwner = async work => { await db.exec('reset role'); try { return await work(); } finally { await db.exec('set role service_role'); } };
  const publishRun = async (checkpoint, mutate = () => {}) => {
    const run = { id: randomUUID(), idempotency_key: randomUUID(), mode: 'preview', status: 'ready_for_review', created_by: actor,
      cutoff_date: scope.inputOptions.cutoffDate, control_totals: { postingMode: scope.inputOptions.postingMode, workflowSnapshot: {
        complete: true, tenantId: tenant, salesforceOrgId: scope.salesforceOrgId, reconciliationVersion: scope.reconciliationVersion,
        linkFirst: true, includePayments: true, recordExactMatches: false, campaignId: scope.inputOptions.campaignId,
        previewCheckpointInputEvidenceHash: checkpoint.input_evidence_hash, previewCheckpointPayloadHash: checkpoint.payload_hash,
      } } };
    mutate(run);
    await asOwner(() => db.query('insert into xero_financial_sync_runs select * from jsonb_populate_record(null::xero_financial_sync_runs,$1::jsonb)',
      [{ revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), classification_summary: {}, rate_limit_snapshot: {}, ...run }]));
    return run;
  };
  return { db, connect, raw, client, scope, payload, capture, asOwner, publishRun };
}

test('real migration captures complete immutable evidence, allows renewal and publishes exact complete run', async t => {
  const f = await harness(t); const saved = await f.capture();
  assert.equal(saved.revision, 2); assert.deepEqual(saved.payload, f.payload);
  const retry = await savePreviewCheckpoint(f.client, { id: saved.id, revision: 1, scope: f.scope, payload: f.payload });
  assert.equal(retry.revision, 2); // Lost save response: identical capture only.
  await f.asOwner(() => f.db.exec("update xero_contact_sync_connections set token_version=2 where id='primary'"));
  assert.equal((await loadPreviewCheckpoint(f.client, { ...f.scope, tokenVersion: 2 })).id, saved.id);
  assert.equal((await loadPreviewCheckpoint(f.client, f.scope)).token_version, 1); // Actual capture provenance is retained.
  const run = await f.publishRun(saved);
  const published = await markPreviewCheckpointPublished(f.client, { id: saved.id, revision: saved.revision, scope: f.scope, runId: run.id });
  assert.equal(published.revision, 3); assert.equal(published.published_run_id, run.id);
  assert.equal((await markPreviewCheckpointPublished(f.client, { id: saved.id, revision: 2, scope: f.scope, runId: run.id })).revision, 3);
  assert.equal(await loadPreviewCheckpoint(f.client, f.scope), null);
});

test('foreign actor, changed source/controls/options/org/version and reconnected tenant never reuse a capture', async t => {
  const f = await harness(t); const saved = await f.capture();
  for (const change of [{ actorId: otherActor }, { salesforceOrgId: 'other-org' }, { reconciliationVersion: 19 },
    { inputEvidenceHash: 'b'.repeat(64) }, { inputOptions: { ...f.scope.inputOptions, includePayments: false } },
    { inputOptions: { ...f.scope.inputOptions, postingMode: 'authorised' } },
    { inputOptions: { ...f.scope.inputOptions, campaignId: randomUUID() } }]) {
    const scope = { ...f.scope, ...change };
    assert.equal(await loadPreviewCheckpoint(f.client, scope), null);
    await assert.rejects(loadPreviewCheckpoint(f.client, scope, { id: saved.id }), { code: 'XERO_PREVIEW_CHECKPOINT_MISMATCH' });
  }
  await f.asOwner(() => f.db.exec(`update checkpoint_test_access set active=false where id='${actor}'`));
  await assert.rejects(loadPreviewCheckpoint(f.client, f.scope), { code: 'XERO_PREVIEW_CHECKPOINT_ACCESS_REQUIRED' });
  await f.asOwner(() => f.db.exec(`update checkpoint_test_access set active=true where id='${actor}'`));
  await f.asOwner(() => f.db.query("update xero_contact_sync_connections set tenant_id=$1 where id='primary'", [randomUUID()]));
  await assert.rejects(loadPreviewCheckpoint(f.client, f.scope), { code: 'XERO_PREVIEW_CHECKPOINT_CONNECTION_CHANGED' });
});

test('expiry, revision races and conflicting save payload fail closed without extending or replacing evidence', async t => {
  const f = await harness(t); const saved = await f.capture();
  const changed = structuredClone(f.payload); changed.provider.xero.documents[0].amount += 1;
  await assert.rejects(savePreviewCheckpoint(f.client, { id: saved.id, revision: 1, scope: f.scope, payload: changed }), { code: 'XERO_PREVIEW_CHECKPOINT_STALE' });
  await assert.rejects(savePreviewCheckpoint(f.client, { id: saved.id, revision: 2, scope: f.scope, payload: f.payload }), { code: 'XERO_PREVIEW_CHECKPOINT_STALE' });
  assert.equal((await loadPreviewCheckpoint(f.client, f.scope)).payload_hash, saved.payload_hash);
  const created = await createPreviewCheckpoint(f.client, f.scope, { id: saved.id, ttlSeconds: 3600 });
  assert.equal(created.expires_at, saved.expires_at); // A repeated create never renews TTL.
  await assert.rejects(f.asOwner(() => f.db.query("update xero_financial_preview_checkpoints set payload='{}' where id=$1", [saved.id])), /XERO_PREVIEW_CHECKPOINT_STALE/);
  await f.asOwner(async () => {
    await f.db.exec('alter table xero_financial_preview_checkpoints disable trigger xero_preview_checkpoint_immutable');
    await f.db.query("update xero_financial_preview_checkpoints set created_at=now()-interval '20 minutes',expires_at=now()-interval '1 second' where id=$1", [saved.id]);
    await f.db.exec('alter table xero_financial_preview_checkpoints enable trigger xero_preview_checkpoint_immutable');
  });
  assert.equal(await loadPreviewCheckpoint(f.client, f.scope), null);
  await assert.rejects(loadPreviewCheckpoint(f.client, f.scope, { id: saved.id }), { code: 'XERO_PREVIEW_CHECKPOINT_EXPIRED' });
});

test('SQL rejects credential or incomplete captures and detects tampered stored payload', async t => {
  const f = await harness(t); const created = await createPreviewCheckpoint(f.client, f.scope);
  const canonical = value => JSON.stringify(value);
  const secret = structuredClone(f.payload); secret.provider.xero.contacts = [{ access_token: 'fixture-only' }];
  const foreignPayments = structuredClone(f.payload); foreignPayments.provider.payments.tenantId = randomUUID();
  const foreignXero = structuredClone(f.payload); foreignXero.provider.xero.tenantId = randomUUID();
  for (const [payload, expected] of [[secret, 'SECRET'], [{ ...f.payload, complete: false }, 'INVALID'],
    [{ ...f.payload, snapshotStartedAt: null }, 'INVALID'], [foreignPayments, 'INVALID'], [foreignXero, 'INVALID']]) {
    const text = canonical(payload);
    await assert.rejects(f.raw('xero_preview_checkpoint_save_v1', [created.id, 1, f.scope, text,
      createHash('sha256').update(text).digest('hex')]), new RegExp(`XERO_PREVIEW_CHECKPOINT_${expected}`));
  }
  await assert.rejects(f.raw('xero_preview_checkpoint_save_v1', [created.id, 1, f.scope, canonical(f.payload), '0'.repeat(64)]), /CORRUPT/);
  const saved = await savePreviewCheckpoint(f.client, { id: created.id, revision: 1, scope: f.scope, payload: f.payload });
  await f.asOwner(async () => {
    await f.db.exec('alter table xero_financial_preview_checkpoints disable trigger xero_preview_checkpoint_immutable');
    await f.db.query("update xero_financial_preview_checkpoints set payload=jsonb_set(payload,'{provider,xero,documents,0,amount}','999'::jsonb) where id=$1", [saved.id]);
    await f.db.exec('alter table xero_financial_preview_checkpoints enable trigger xero_preview_checkpoint_immutable');
  });
  await assert.rejects(loadPreviewCheckpoint(f.client, f.scope), { code: 'XERO_PREVIEW_CHECKPOINT_CORRUPT' });
});

test('published proof requires exact run owner/options/tenant and both immutable evidence digests', async t => {
  const f = await harness(t); const saved = await f.capture();
  for (const mutate of [run => { run.created_by = otherActor; }, run => { run.status = 'building'; },
    run => { run.control_totals.workflowSnapshot.tenantId = randomUUID(); },
    run => { run.control_totals.workflowSnapshot.complete = false; },
    run => { run.control_totals.workflowSnapshot.previewCheckpointInputEvidenceHash = 'b'.repeat(64); },
    run => { run.control_totals.workflowSnapshot.previewCheckpointPayloadHash = 'b'.repeat(64); },
    run => { run.control_totals.workflowSnapshot.campaignId = randomUUID(); },
    run => { run.control_totals.postingMode = 'authorised'; }]) {
    const run = await f.publishRun(saved, mutate);
    await assert.rejects(markPreviewCheckpointPublished(f.client, { id: saved.id, revision: 2, scope: f.scope, runId: run.id }),
      { code: 'XERO_PREVIEW_CHECKPOINT_PUBLICATION_INVALID' });
  }
  const run = await f.publishRun(saved);
  await assert.rejects(markPreviewCheckpointPublished(f.client, { id: saved.id, revision: 1, scope: f.scope, runId: run.id }), { code: 'XERO_PREVIEW_CHECKPOINT_STALE' });
  assert.equal((await loadPreviewCheckpoint(f.client, f.scope)).state, 'captured');
});

test('browser roles have no table/RPC access and service cannot directly mutate or apply from checkpoint', async t => {
  const f = await harness(t); await f.capture();
  for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
    assert.equal((await f.db.query('select has_table_privilege(current_user,$1,$2) ok', ['xero_financial_preview_checkpoints', privilege])).rows[0].ok, false);
  }
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`reset role; set role ${role}`);
    await assert.rejects(f.db.exec('select * from xero_financial_preview_checkpoints'), /permission denied/);
    for (const [name, values] of [['xero_preview_checkpoint_create_v1', [randomUUID(), f.scope, 900]],
      ['xero_preview_checkpoint_load_v1', [f.scope, null]],
      ['xero_preview_checkpoint_save_v1', [randomUUID(), 1, f.scope, '{}', 'a'.repeat(64)]],
      ['xero_preview_checkpoint_publish_v1', [randomUUID(), 2, f.scope, randomUUID()]]]) await assert.rejects(f.raw(name, values), /permission denied/);
  }
});

test('native capture holds current tenant row until transaction commits', { skip: !nativeUrl }, async t => {
  const f = await harness(t); const contender = await f.connect();
  await contender.query("set lock_timeout='150ms'"); await f.db.exec('begin');
  await createPreviewCheckpoint(f.client, f.scope);
  await assert.rejects(contender.query("update xero_contact_sync_connections set tenant_id=$1 where id='primary'", [randomUUID()]), { code: '55P03' });
  await f.db.exec('commit');
  await contender.query("update xero_contact_sync_connections set tenant_id=$1 where id='primary'", [randomUUID()]);
  await assert.rejects(loadPreviewCheckpoint(f.client, f.scope), { code: 'XERO_PREVIEW_CHECKPOINT_CONNECTION_CHANGED' });
});
