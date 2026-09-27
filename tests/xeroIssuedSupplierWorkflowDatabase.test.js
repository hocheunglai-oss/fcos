import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { xeroFinancialDocumentPreservationPreview as preview, xeroFinancialDocumentPreservationRun as run } from '../api/_xeroIssuedSupplierWorkflow.js';
import { issuedSupplierWorkflowFixture } from './xeroIssuedSupplierPreservationFixtures.js';
import { issuedPetroleumFixture, issuedPetroleumOwnerFixture } from './xeroIssuedPetroleumPreservationFixtures.js';

const actor = { id: '00000000-0000-4000-8000-000000000099', email: 'finance@example.com' };
const clone = value => structuredClone(value);
const migrations = [
  '20260827145608_xero_contact_sync.sql', '20260829080726_xero_financial_sync.sql',
  '20260923210832_xero_financial_selection_scope.sql', '20260923213339_xero_payment_reference_link.sql',
  '20260923222821_xero_grouped_preservation_link.sql', '20260927154515_xero_financial_preview_persistence.sql',
  '20260927175805_xero_issued_supplier_preservation_link.sql', '20260927185526_xero_issued_petroleum_preservation_link.sql',
  '20260927213024_xero_petroleum_inactive_source_ownership.sql',
];
const rpcParameters = {
  persist_xero_financial_preview_v1: ['p_run', 'p_items', 'p_review_identity'],
  authorise_xero_financial_sync_run_v1: ['p_run_id', 'p_expected_revision', 'p_selected_item_ids', 'p_actor_id', 'p_actor_email'],
  start_xero_financial_sync_run_v1: ['p_run_id', 'p_expected_revision'],
  finish_xero_financial_sync_run_v1: ['p_run_id', 'p_status', 'p_expected_revision', 'p_classification_summary', 'p_rate_limit_snapshot', 'p_error_code', 'p_error_message'],
  link_xero_issued_supplier_document_v1: ['p_run_id', 'p_expected_run_revision', 'p_item_id', 'p_expected_item_updated_at', 'p_tenant_id', 'p_review', 'p_actor_id', 'p_actor_email'],
  link_xero_issued_petroleum_document_v1: ['p_run_id', 'p_expected_run_revision', 'p_item_id', 'p_expected_item_updated_at', 'p_tenant_id', 'p_review', 'p_actor_id', 'p_actor_email'],
};
const jsonParameters = new Set(['p_run', 'p_items', 'p_review', 'p_classification_summary', 'p_rate_limit_snapshot']);

// Provider adapters return real builder fixtures; every database read and RPC
// below executes the checked-in SQL, with no synthetic acceptance implementation.
async function harness(t, f) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
  for (const file of migrations) await db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
    .replace(/^create extension if not exists pgcrypto;$/m, ''));
  // Only the two read-only columns consumed by this workflow are needed here.
  await db.exec('create table public.dispute_beta_cases(stem_id text,workflow_status text); grant select on public.dispute_beta_cases to service_role;');
  await db.query("insert into public.xero_contact_sync_connections(tenant_id,refresh_token) values($1,'fixture-only')", [f.ids.tenant]);
  for (const m of f.stored.productMappings) {
    await db.query(`insert into public.xero_financial_product_mappings
      (id,direction,salesforce_product_id,salesforce_product_name,xero_account_code,xero_tax_type,enabled,revision,approved_by,approved_by_email,approved_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [m.id, m.direction, m.salesforce_product_id, m.salesforce_product_name || 'Fixture product', m.xero_account_code, m.xero_tax_type,
      m.enabled, m.revision, m.approved_by || actor.id, m.approved_by_email || actor.email, m.approved_at || '2026-09-01T00:00:00.000Z']);
  }
  await db.exec('set role service_role');
  const calls = [], errors = [], transforms = { persist: null };
  const identifier = value => { assert.match(value, /^[a-z_]+$/); return `"${value}"`; };
  const allowedTables = new Set(['xero_financial_sync_runs', 'xero_financial_sync_items', 'xero_financial_document_mappings', 'xero_financial_audit_events', 'dispute_beta_cases']);
  const client = {
    from(table) {
      assert(allowedTables.has(table));
      const where = [], values = []; let order = ''; let limit = ''; let single = false;
      const bind = value => { values.push(value); return `$${values.length}`; };
      const q = {
        select() { return q; },
        eq(key, value) { where.push(`${identifier(key)}=${bind(value)}`); return q; },
        in(key, entries) { where.push(entries.length ? `${identifier(key)} in (${entries.map(bind).join(',')})` : 'false'); return q; },
        order(key) { order = ` order by ${identifier(key)}`; return q; },
        limit(value) { assert(Number.isSafeInteger(value) && value > 0); limit = ` limit ${value}`; return q; },
        maybeSingle() { single = true; return q; },
        then(resolve, reject) {
          calls.push({ type: 'read', table });
          return db.query(`select to_jsonb(t) as row from public.${identifier(table)} t${where.length ? ` where ${where.join(' and ')}` : ''}${order}${limit}`, values)
            .then(result => ({ data: single ? result.rows[0]?.row || null : result.rows.map(r => r.row), error: null }))
            .then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, body) {
      assert(Object.hasOwn(rpcParameters, name));
      const payload = clone(body);
      if (name === 'persist_xero_financial_preview_v1' && transforms.persist) transforms.persist(payload);
      calls.push({ type: 'rpc', name, body: payload });
      const names = rpcParameters[name]; assert.deepEqual(Object.keys(payload).sort(), [...names].sort());
      try {
        const result = await db.query(`select to_jsonb(public.${name}(${names.map((key, i) => `$${i + 1}${jsonParameters.has(key) ? '::jsonb' : ''}`).join(',')})) as result`,
          names.map(key => jsonParameters.has(key) ? JSON.stringify(payload[key]) : payload[key]));
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        const safe = { code: error.code, message: error.message };
        errors.push({ name, ...safe }); return { data: null, error: safe };
      }
    },
  };
  const read = (name, value) => async () => { calls.push({ type: 'provider', name }); return clone(value()); };
  const dependencies = { client, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC: 'true' }, accessContext: { profile: actor },
    fetchImpl: async () => assert.fail('Unexpected network or accounting request'),
    getConnection: read('connection', () => ({ tenantId: f.ids.tenant })), collectFiles: read('files', () => f.files),
    loadSalesforce: read('salesforce', () => f.salesforce), loadXero: read('xero', () => f.xero),
    loadControls: read('controls', () => f.stored), collectVessels: read('vessels', () => f.vessels),
    collectPetroleumScope: read('petroleum_scope', () => f.scope) };
  const snapshot = async () => (await db.query(`select
    (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.xero_financial_sync_runs r) as runs,
    (select coalesce(jsonb_agg(to_jsonb(i) order by row_index),'[]') from public.xero_financial_sync_items i) as items,
    (select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from public.xero_financial_document_mappings m) as mappings,
    (select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.xero_financial_audit_events a) as audits`)).rows[0];
  return { db, f, calls, errors, transforms, dependencies, client, snapshot,
    preview: () => preview({ packet: f.packet }, dependencies),
    body: result => ({ runId: result.run.id, revision: result.run.revision, selectedItemIds: result.rows.map(r => r.id), reviewed: true }) };
}

for (const [label, makeFixture, linkRpc] of [
  ['trustee', issuedSupplierWorkflowFixture, 'link_xero_issued_supplier_document_v1'],
  ['petroleum singleton', issuedPetroleumFixture, 'link_xero_issued_petroleum_document_v1'],
  ['petroleum inactive owners', issuedPetroleumOwnerFixture, 'link_xero_issued_petroleum_document_v1'],
]) test(`${label} real Preview → persistence SQL → Run → link SQL preserves original bills`, async t => {
  const h = await harness(t, makeFixture()); const before = clone({ salesforce: h.f.salesforce, xero: h.f.xero });
  const reviewed = await h.preview().catch(error => assert.fail(`${error.code}: ${JSON.stringify(h.errors)}`));
  assert.equal(reviewed.run.status, 'ready_for_review');
  assert.equal(reviewed.rows[0].status, 'eligible', JSON.stringify(reviewed.rows[0].blockers));
  const saved = await h.snapshot();
  assert.equal(saved.runs.length, 1); assert.equal(saved.items.length, 1); assert.equal(saved.mappings.length, 0);
  assert.equal(saved.runs[0].idempotency_key, `preview:${reviewed.run.id}`);
  assert.equal(saved.items[0].source_payload.postingMode, saved.runs[0].control_totals.postingMode);
  assert.deepEqual(saved.items[0].proposed_payload, {}); assert.equal(saved.items[0].mutation_attempts, 0);
  assert.equal(saved.items[0].source_payload.readiness.ready, false);
  assert.equal(saved.audits[0].event_type, 'preview_completed');
  const repeated = await h.preview().catch(error => assert.fail(`${error.code}: ${JSON.stringify(h.errors)}`));
  assert.equal(repeated.run.id, reviewed.run.id); assert.equal(repeated.rows[0].id, reviewed.rows[0].id);
  assert.equal((await h.snapshot()).runs.length, 1);
  const result = await run(h.body(reviewed), h.dependencies).catch(error => assert.fail(`${error.code}: ${JSON.stringify(h.errors)}`));
  assert.equal(result.run.status, 'completed'); assert.equal(result.outcomes[0].status, 'linked'); assert.equal(result.financialWrites, 0);
  const linked = await h.snapshot();
  assert.equal(linked.mappings.length, 1); assert.equal(linked.items[0].status, 'linked'); assert.equal(linked.items[0].mutation_attempts, 0);
  assert.deepEqual(linked.items[0].source_payload, saved.items[0].source_payload);
  assert.deepEqual(linked.items[0].xero_payload, saved.items[0].xero_payload);
  assert.deepEqual(linked.mappings[0].retained_differences.issuedSupplierPreservation.reviewedXero, saved.items[0].xero_payload);
  assert.equal(h.calls.filter(c => c.name === linkRpc).length, 1);
  assert.equal(linked.audits.filter(a => a.event_type.endsWith('_document_preservation_linked')).length, 1);
  assert.equal(linked.mappings[0].retained_differences.issuedSupplierPreservation.acceptance.actorId, actor.id);
  const start = h.calls.length;
  const replay = await run(h.body(reviewed), h.dependencies);
  assert.equal(replay.outcomes[0].alreadyLinked, true);
  assert(h.calls.slice(start).every(c => c.type === 'read'), 'Completed replay performs only durable receipt reads');
  assert.deepEqual(await h.snapshot(), linked);
  assert.deepEqual({ salesforce: h.f.salesforce, xero: h.f.xero }, before);
  assert.deepEqual(h.errors, []);
});

for (const [label, makeFixture] of [
  ['trustee', issuedSupplierWorkflowFixture], ['petroleum', issuedPetroleumFixture],
]) for (const [field, mutate, message] of [
  ['non-preview idempotency key', payload => { payload.p_run.idempotency_key = `issued-preserve:${payload.p_run.id}`; },
    'Only a new unreviewed financial preview may be published'],
  ['source posting-mode mismatch', payload => { payload.p_items[0].source_payload.postingMode = 'authorised'; },
    'Financial preview items are incomplete or contain noninitial state'],
]) test(`${label} actual persistence SQL rejects ${field} without publishing any state`, async t => {
  const h = await harness(t, makeFixture()); h.transforms.persist = mutate;
  await assert.rejects(h.preview(), { code: 'XERO_FINANCIAL_STORAGE_FAILED' });
  assert.deepEqual(h.errors, [{ name: 'persist_xero_financial_preview_v1', code: '22023', message }]);
  assert.deepEqual(await h.snapshot(), { runs: [], items: [], mappings: [], audits: [] });
  assert.deepEqual(h.calls.filter(c => c.type === 'rpc').map(c => c.name), ['persist_xero_financial_preview_v1']);
});
