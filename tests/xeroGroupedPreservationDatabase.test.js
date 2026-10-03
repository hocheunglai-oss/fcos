import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { evaluateGroupedPreservation } from '../api/_xeroGroupedPreservation.js';

const migration = new URL('../supabase/migrations/20260923222821_xero_grouped_preservation_link.sql', import.meta.url);
const rpc = 'public.link_xero_grouped_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text)';
const sql = 'select public.link_xero_grouped_document_v1($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as result';
const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sf18 = (value) => value + [0, 5, 10].map((start) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[
  [...value.slice(start, start + 5)].reduce((mask, char, bit) => mask + (/[A-Z]/.test(char) ? 1 << bit : 0), 0)]).join('');
const iso = '2026-09-23T22:00:00.000Z';

async function fixture(t, { migrate = true, database = null } = {}) {
  const db = database || new PGlite();
  if (!database) {
    t.after(() => db.close());
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  }
  await db.exec('grant usage on schema public to service_role;');
  for (const file of ['20260827145608_xero_contact_sync.sql', '20260829080726_xero_financial_sync.sql', '20260923213339_xero_payment_reference_link.sql']) {
    await db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace(/^create extension if not exists pgcrypto;$/m, ''));
  }
  if (migrate) await db.exec(await readFile(migration, 'utf8'));
  const tenant = randomUUID(); const actor = { id: randomUUID(), email: ' FINANCE@example.test ' };
  const ids = { source: 'a01000000000001', account: '001000000000001', product: '01t000000000001', contact: randomUUID(), target: randomUUID(), productMapping: randomUUID() };
  const line = { description: 'Fuel', quantity: '1', unitAmount: '10.01', lineAmount: '10.01', accountCode: '51100',
    taxType: 'NONE', taxAmount: '0', discountRate: '0', discountAmount: '0', tracking: [], itemCode: '' };
  const input = {
    tenantId: tenant, organisation: { baseCurrency: 'USD' },
    source: { complete: true, salesforceObject: 'Supplier_Invoice__c', salesforceId: ids.source, accountId: ids.account,
      contactId: ids.contact, sourceFingerprint: hash('authoritative source'), documentNumber: 'SF-2026-100', reference: 'STEM-100',
      invoiceDate: '2026-01-03', dueDate: '2026-02-03', deliveryDate: '2026-01-02', xeroType: 'ACCPAY', xeroCollection: 'Invoices',
      currency: 'USD', subtotal: '30.03', total: '30.03', signedTotal: '30.03', totalTax: '0', lineAmountTypes: 'NoTax', isDiscounted: false,
      readiness: { ready: true, evidenceFingerprint: hash('issued source children') },
      lines: [{ ...line, id: 'a02000000000001', productId: ids.product, currency: 'USD' },
        { ...line, id: 'a02000000000002', productId: ids.product, currency: 'USD', quantity: '2', lineAmount: '20.02' }] },
    xero: { complete: true, id: ids.target, collection: 'Invoices', type: 'ACCPAY', status: 'AUTHORISED', contactId: ids.contact,
      invoiceNumber: 'SF-2026-100', reference: 'Legacy retained reference', date: '2026-01-03', dueDate: '2026-02-02',
      currency: 'USD', currencyRate: '1', subtotal: '30.03', total: '30.03', totalTax: '0', lineAmountTypes: 'Exclusive',
      isDiscounted: false, amountDue: '30.03', amountPaid: '0', amountCredited: '0',
      lines: [{ ...line, id: randomUUID(), unitAmount: '30.03', lineAmount: '30.03' }] },
    productMappings: [{ id: ids.productMapping, direction: 'supplier', salesforceProductId: ids.product,
      xeroAccountCode: '51100', xeroTaxType: 'NONE', enabled: true, revision: 1 }],
    identity: { complete: true, matchBasis: 'invoice_number', candidateXeroDocumentIds: [ids.target], documentIdentitySourceIds: [ids.source],
      candidateContactIds: [ids.contact], accountIdsForContact: [ids.account], sourceMappings: [], targetMappings: [],
      contactIdentity: { salesforceAccountId: ids.account, xeroContactId: ids.contact, status: 'ACTIVE', matchBasis: 'account_name',
        sourceMatchValue: 'supplier', xeroMatchValue: 'supplier', evidenceFingerprint: hash('identity') } },
  };
  const evaluated = evaluateGroupedPreservation(input);
  assert.equal(evaluated.eligible, true, JSON.stringify(evaluated.blockers));
  const review = { policyVersion: evaluated.policyVersion, fingerprint: evaluated.fingerprint,
    evidenceFingerprint: hash(stable(evaluated.evidence)), reviewFingerprint: hash('review'), legacyReviewFingerprint: hash('legacy review'),
    evidence: evaluated.evidence, accountingCanonical: stable({ policyVersion: evaluated.policyVersion, accounting: evaluated.evidence.accounting }),
    evidenceCanonical: stable(evaluated.evidence) };
  const source = { ...input.source, salesforceId: sf18(ids.source), accountId: sf18(ids.account), documentKind: 'supplier_bill',
    financialFingerprint: hash('financial'), stemId: 'a03000000000001', groupedReviewFingerprint: review.reviewFingerprint,
    groupedPreservation: { policyVersion: review.policyVersion, eligible: true, fingerprint: review.fingerprint,
      evidenceFingerprint: review.evidenceFingerprint, accepted: false, requiresExplicitReview: true,
      sourceLineCount: 2, xeroLineCount: 1, groupedTotals: evaluated.evidence.accounting.groupedTotals } };
  const runId = randomUUID(); const itemId = randomUUID();
  await db.query("insert into public.xero_contact_sync_connections (tenant_id,refresh_token) values ($1,'test-only')", [tenant]);
  await db.query(`insert into public.xero_financial_product_mappings
    (id,direction,salesforce_product_id,salesforce_product_name,xero_account_code,xero_tax_type)
    values ($1,'supplier',$2,'Fuel','51100','NONE')`, [ids.productMapping, sf18(ids.product)]);
  await db.query(`insert into public.xero_financial_sync_runs
    (id,idempotency_key,mode,status,revision,reviewed_by,reviewed_by_email,reviewed_at)
    values ($1,$2,'preview','processing',3,$3,$4,$5)`, [runId, runId, actor.id, actor.email.trim().toLowerCase(), iso]);
  await db.query(`insert into public.xero_financial_sync_items
    (id,run_id,row_index,row_key,source_object,source_id,source_type,source_document_number,currency,source_total,proposed_action,
      status,selected,source_payload,xero_payload,xero_document_id,xero_document_status,idempotency_key,updated_at,differences)
    values ($1,$2,0,$3,'Supplier_Invoice__c',$4,'supplier_bill','SF-2026-100','USD',30.03,'protected_legacy',
      'selected',true,$5,$6,$7,'AUTHORISED',$3,$8,'[{"field":"detailedLines"}]')`,
  [itemId, runId, itemId, source.salesforceId, JSON.stringify(source), JSON.stringify(input.xero), ids.target, iso]);
  const params = (overrides = {}) => ({ p_run_id: runId, p_expected_run_revision: 3, p_item_id: itemId,
    p_expected_item_updated_at: iso, p_tenant_id: tenant, p_review: review, p_actor_id: actor.id, p_actor_email: actor.email, ...overrides });
  const values = (overrides) => { const p = params(overrides); return [p.p_run_id, p.p_expected_run_revision, p.p_item_id,
    p.p_expected_item_updated_at, p.p_tenant_id, JSON.stringify(p.p_review), p.p_actor_id, p.p_actor_email]; };
  const link = async (overrides) => (await db.query(sql, values(overrides))).rows[0].result;
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(m) order by id) from public.xero_financial_document_mappings m) as mappings,
    (select jsonb_agg(to_jsonb(i) order by id) from public.xero_financial_sync_items i) as items,
    (select jsonb_agg(to_jsonb(a) order by id) from public.xero_financial_audit_events a) as audits`)).rows[0];
  return { db, ids, actor, source, input, review, runId, itemId, tenant, params, values, link, snapshot };
}

async function ordinaryMapping(f, sourceId = f.ids.source, targetId = f.ids.target, type = 'ACCPAY') {
  return f.db.query(`insert into public.xero_financial_document_mappings
    (salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,
      xero_contact_id,source_fingerprint,financial_fingerprint)
    values ('Supplier_Invoice__c',$1,'OLD','supplier_bill',$2,$3,$4,'old-source','old-financial') returning *`,
  [sourceId, type, targetId, f.ids.contact]);
}

async function unchangedOnReject(f, work, error = { code: '40001' }) {
  const before = await f.snapshot(); await assert.rejects(work, error); assert.deepEqual(await f.snapshot(), before);
}

test('empty schema migration permits one atomic mapping, item outcome and authenticated actor audit', async (t) => {
  const f = await fixture(t); const result = await f.link();
  assert.deepEqual({ ...result, mappingId: 'id' }, { id: f.itemId, status: 'linked', xeroDocumentId: f.ids.target, mappingId: 'id', alreadyLinked: false });
  const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
  assert.equal(saved.items[0].status, 'linked'); assert.equal(saved.items[0].mutation_attempts, 0);
  assert.equal(saved.mappings[0].protected_legacy, true);
  assert.equal(saved.mappings[0].retained_differences.reviewFingerprint, f.review.legacyReviewFingerprint);
  assert.deepEqual(saved.mappings[0].retained_differences.groupedPreservation.evidence, f.review.evidence);
  assert.equal(saved.audits[0].actor_id, f.actor.id); assert.equal(saved.audits[0].actor_email, 'finance@example.test');
  assert.deepEqual(saved.audits[0].record_counts, { linked: 1, applied: 0, financialWrites: 0 });
  assert.equal(saved.items[0].applied_at, saved.mappings[0].created_at);
});

test('identical acceptance retry is read-only even after the containing run finishes', async (t) => {
  const f = await fixture(t); const first = await f.link(); const before = await f.snapshot();
  await f.db.query("update public.xero_financial_sync_runs set status='completed',revision=4 where id=$1", [f.runId]);
  assert.deepEqual(await f.link(), { ...first, alreadyLinked: true }); assert.deepEqual(await f.snapshot(), before);
  for (const change of [{ p_actor_id: randomUUID() }, { p_actor_email: 'other@example.test' }, { p_expected_run_revision: 4 },
    { p_expected_item_updated_at: '2026-09-23T22:01:00Z' }, { p_review: { ...f.review, legacyReviewFingerprint: hash('changed') } }]) {
    await unchangedOnReject(f, () => f.link(change));
  }
});

test('run and item CAS reject stale, unselected, failed and provider-write candidates without writes', async (t) => {
  const f = await fixture(t);
  for (const change of [{ p_expected_run_revision: 2 }, { p_expected_item_updated_at: '2026-09-23T22:01:00Z' },
    { p_run_id: randomUUID() }, { p_item_id: randomUUID() }]) await unchangedOnReject(f, () => f.link(change));
  for (const update of ["status='failed'", 'selected=false', "proposed_action='safe_update'", "proposed_payload='{\"Type\":\"ACCPAY\"}'",
    'mutation_attempts=1', "blockers='[\"blocked\"]'", "error_code='UNCERTAIN'", "xero_document_status='PAID'"]) {
    await f.db.exec('begin'); await f.db.query(`update public.xero_financial_sync_items set ${update} where id=$1`, [f.itemId]);
    await assert.rejects(f.link(), { code: '40001' }); await f.db.exec('rollback');
  }
  assert.equal((await f.snapshot()).mappings, null);
});

test('document run gate blocks another start and a payment-mode run cannot accept grouped links', async (t) => {
  const f = await fixture(t); const run = randomUUID();
  await f.db.query(`insert into public.xero_financial_sync_runs(id,idempotency_key,mode,status,revision)
    values ($1,$2,'document_apply','authorised',1)`, [run, run]);
  await assert.rejects(f.db.query('select public.start_xero_financial_sync_run_v1($1,1)', [run]),
    { code: '23505', constraint: 'xero_financial_one_processing_document_run_uidx' });
  await f.db.query("update public.xero_financial_sync_runs set mode='payment_apply' where id=$1", [f.runId]);
  await unchangedOnReject(f, () => f.link());
  await f.db.query('select public.start_xero_financial_sync_run_v1($1,1)', [run]);
  assert.equal((await f.db.query("select count(*)::int as n from public.xero_financial_sync_runs where status='processing'")).rows[0].n, 2);
});

test('invalid caller context and accounting-date scope cannot create acceptance', async (t) => {
  const f = await fixture(t);
  for (const change of [{ p_actor_id: null }, { p_actor_email: '' }, { p_tenant_id: null }, { p_review: null },
    { p_expected_item_updated_at: null }, { p_expected_run_revision: null },
    { p_actor_id: '00000000-0000-0000-0000-000000000000' }]) {
    await unchangedOnReject(f, () => f.link(change), { code: '22023' });
  }
  await f.db.query("update public.xero_financial_sync_runs set cutoff_date='2026-02-01' where id=$1", [f.runId]);
  await unchangedOnReject(f, () => f.link());
});

test('tampered proof, canonical serialization, source identity and review hashes fail closed', async (t) => {
  const f = await fixture(t);
  const tampered = structuredClone(f.review); tampered.evidence.accounting.xero.id = randomUUID();
  const changes = [{ fingerprint: hash('wrong') }, { evidenceFingerprint: hash('wrong') }, { reviewFingerprint: hash('wrong') },
    { accountingCanonical: '{}' }, { evidenceCanonical: '{}' }, { evidence: tampered.evidence }];
  for (const change of changes) await unchangedOnReject(f, () => f.link({ p_review: { ...f.review, ...change } }));
  await f.db.query("update public.xero_financial_sync_items set source_payload=jsonb_set(source_payload,'{accountId}','\"001000000000002AAA\"') where id=$1", [f.itemId]);
  await unchangedOnReject(f, () => f.link());
});

test('tenant switch, deleted mapping, changed revision and canonical product aliases invalidate the proof', async (t) => {
  const f = await fixture(t);
  for (const statement of ["update public.xero_contact_sync_connections set tenant_id='00000000-0000-4000-8000-000000000099'",
    'delete from public.xero_financial_product_mappings', 'update public.xero_financial_product_mappings set revision=2',
    "update public.xero_financial_product_mappings set xero_account_code='51200'", 'update public.xero_financial_product_mappings set enabled=false']) {
    await f.db.exec('begin'); await f.db.exec(statement); await assert.rejects(f.link(), { code: '40001' }); await f.db.exec('rollback');
  }
  await assert.rejects(f.db.query(`insert into public.xero_financial_product_mappings
    (direction,salesforce_product_id,salesforce_product_name,xero_account_code,xero_tax_type)
    values ('supplier',$1,'Alias','51100','NONE')`, [f.ids.product]), { code: '23505' });
  assert.equal((await f.snapshot()).mappings, null);
});

test('existing canonical Salesforce or cross-type UUID ownership is never overwritten', async (t) => {
  const f = await fixture(t);
  for (const [source, target, type] of [[f.ids.source, randomUUID(), 'ACCPAY'], ['a01000000000099', f.ids.target.toUpperCase(), 'ACCREC']]) {
    await f.db.exec('begin'); await ordinaryMapping(f, source, target, type);
    await assert.rejects(f.link(), { code: '40001' }); await f.db.exec('rollback');
  }
  await f.link();
  await unchangedOnReject(f, () => ordinaryMapping(f, f.ids.source, randomUUID()), { code: '23505' });
  await unchangedOnReject(f, () => ordinaryMapping(f, 'a01000000000099', f.ids.target.toUpperCase(), 'ACCREC'), { code: '23505' });
});

test('audit and item outcome storage failures roll back the mapping and permit retry after repair', async (t) => {
  const f = await fixture(t);
  for (const [table, action] of [['xero_financial_audit_events', 'insert'], ['xero_financial_sync_items', 'update']]) {
    await f.db.exec(`create function public.reject_grouped_write() returns trigger language plpgsql as $$
      begin raise exception 'Injected storage failure' using errcode='XX000'; end $$;
      create trigger reject_grouped_write before ${action} on public.${table} for each row execute function public.reject_grouped_write();`);
    await unchangedOnReject(f, () => f.link(), { code: 'XX000' });
    await f.db.exec(`drop trigger reject_grouped_write on public.${table}; drop function public.reject_grouped_write();`);
  }
  assert.equal((await f.link()).alreadyLinked, false);
});

test('sticky protection rejects ordinary upsert, proof clearing, remapping and deletion but permits reconciliation timestamps', async (t) => {
  const f = await fixture(t); await f.link();
  for (const assignment of ["retained_differences='{}'", 'protected_legacy=false', "source_fingerprint='changed'",
    `xero_document_id='${randomUUID()}'`, "salesforce_id='a01000000000099'", "xero_status='PAID'"]) {
    await unchangedOnReject(f, () => f.db.query(`update public.xero_financial_document_mappings set ${assignment}`));
  }
  await unchangedOnReject(f, () => f.db.exec('delete from public.xero_financial_document_mappings'));
  await unchangedOnReject(f, () => f.db.query(`insert into public.xero_financial_document_mappings
    (salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,source_fingerprint,financial_fingerprint)
    values ('Supplier_Invoice__c',$1,'OLD','supplier_bill','ACCPAY',$2,'old','old') on conflict (salesforce_object,salesforce_id)
    do update set retained_differences='{}',protected_legacy=false`, [f.source.salesforceId, f.ids.target]));
  await f.db.exec("update public.xero_financial_document_mappings set last_reconciled_at=now(),updated_at=now()");
  assert.equal((await f.link()).alreadyLinked, true);
});

test('populated upgrade retains ordinary mappings and payment links byte-for-byte and permits their normal updates', async (t) => {
  const f = await fixture(t, { migrate: false }); const mapping = (await ordinaryMapping(f, 'a01000000000099', randomUUID())).rows[0];
  await f.db.query(`insert into public.xero_financial_payment_mappings
    (salesforce_payment_id,document_mapping_id,xero_payment_id,source_fingerprint,amount,currency,payment_date,status)
    values ('a0S000000000001',$1,$2,'payment',10,'USD','2026-01-01','linked')`, [mapping.id, randomUUID()]);
  const before = await f.snapshot(); const payments = (await f.db.query('select to_jsonb(p) as row from public.xero_financial_payment_mappings p')).rows;
  await f.db.exec(await readFile(migration, 'utf8')); await f.db.exec(await readFile(migration, 'utf8'));
  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual((await f.db.query('select to_jsonb(p) as row from public.xero_financial_payment_mappings p')).rows, payments);
  await f.db.query("update public.xero_financial_document_mappings set source_fingerprint='changed',retained_differences='{\"old\":true}' where id=$1", [mapping.id]);
  await f.db.query(`insert into public.xero_financial_document_mappings
    (salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,source_fingerprint,financial_fingerprint)
    values ('Supplier_Invoice__c',$1,'OLD','supplier_bill','ACCPAY',$2,'normal-upsert','normal-upsert')
    on conflict (salesforce_object,salesforce_id) do update set source_fingerprint=excluded.source_fingerprint`,
  [mapping.salesforce_id, mapping.xero_document_id]);
  assert.equal((await f.db.query('select source_fingerprint from public.xero_financial_document_mappings where id=$1', [mapping.id])).rows[0].source_fingerprint, 'normal-upsert');
  assert.equal((await f.link()).status, 'linked');
});

test('upgrade rejects ambiguous aliases instead of rewriting either historical owner', async (t) => {
  for (const kind of ['source', 'target', 'product']) await t.test(kind, async (child) => {
    const f = await fixture(child, { migrate: false }); await ordinaryMapping(f);
    if (kind === 'product') await f.db.query(`insert into public.xero_financial_product_mappings
      (direction,salesforce_product_id,salesforce_product_name,xero_account_code,xero_tax_type)
      values ('supplier',$1,'Alias','51100','NONE')`, [f.ids.product]);
    else await ordinaryMapping(f, kind === 'source' ? sf18(f.ids.source) : 'a01000000000099', kind === 'target' ? f.ids.target.toUpperCase() : randomUUID());
    const before = await f.snapshot(); await assert.rejects(f.db.exec(await readFile(migration, 'utf8')), { code: '23505' });
    assert.deepEqual(await f.snapshot(), before);
  });
});

test('upgrade refuses overlapping active document runs without recovering or expiring either run', async (t) => {
  const f = await fixture(t, { migrate: false });
  await f.db.query(`insert into public.xero_financial_sync_runs(idempotency_key,mode,status,updated_at)
    values ($1,'document_apply','processing','2000-01-01')`, [randomUUID()]);
  const snapshot = () => f.db.query('select to_jsonb(r) as row from public.xero_financial_sync_runs r order by id');
  const before = (await snapshot()).rows;
  await assert.rejects(f.db.exec(await readFile(migration, 'utf8')), { code: '23505' });
  assert.deepEqual((await snapshot()).rows, before);
});

test('queued identical and conflicting calls produce one durable acceptance and one audit', async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.link(), f.link(), f.link({ p_actor_id: randomUUID() })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.code === '40001').length, 1);
  const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
  // PGlite serializes connections. This verifies retry arbitration, not overlapping transactions.
});

test('RPC and trigger helpers remain invoker/service-only; browser roles cannot read tables or execute', async (t) => {
  const f = await fixture(t);
  for (const name of [rpc, 'public.protect_xero_grouped_mapping_v1()', 'public.xero_grouped_salesforce_id_v1(text)']) {
    const grants = (await f.db.query(`select prosecdef,has_function_privilege('anon',oid,'EXECUTE') as anon,
      has_function_privilege('authenticated',oid,'EXECUTE') as authenticated,has_function_privilege('service_role',oid,'EXECUTE') as service
      from pg_proc where oid=$1::regprocedure`, [name])).rows[0];
    assert.deepEqual(grants, { prosecdef: false, anon: false, authenticated: false, service: true });
  }
  const tables = (await f.db.query(`select relrowsecurity,relforcerowsecurity from pg_class where oid in
    ('public.xero_financial_document_mappings'::regclass,'public.xero_financial_sync_items'::regclass,'public.xero_financial_audit_events'::regclass)`)).rows;
  assert.equal(tables.length, 3); assert.ok(tables.every((row) => row.relrowsecurity && row.relforcerowsecurity));
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`set role ${role}`); await assert.rejects(f.link(), { code: '42501' });
    await assert.rejects(f.db.exec('select * from public.xero_financial_document_mappings'), { code: '42501' }); await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role'); assert.equal((await f.link()).status, 'linked');
});

test('Salesforce canonicalization validates 18-character checksum and preserves 15-character case', async (t) => {
  const f = await fixture(t);
  const id = 'a0B00000XyzAB12';
  for (const [input, expected] of [[id, id], [sf18(id), id], [`${id}AAA`, null], ['invalid', null], [id.toLowerCase(), id.toLowerCase()]]) {
    assert.equal((await f.db.query('select public.xero_grouped_salesforce_id_v1($1) as id', [input])).rows[0].id, expected);
  }
});

// Optional independent-session PostgreSQL tests. The supplied endpoint must be
// local; create/drop only a uniquely named disposable database, never public in
// the supplied database. CI supplies its disposable Supabase postgres endpoint.
const concurrencyUrl = process.env.FCOS_GROUPED_TEST_DATABASE_URL;
async function postgresFixture(t) {
  const endpoint = new URL(concurrencyUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Grouped concurrency tests require a local disposable PostgreSQL server');
  assert.ok(['postgres:', 'postgresql:'].includes(endpoint.protocol));
  const admin = new pg.Client({ connectionString: endpoint.toString() }); await admin.connect();
  const dbName = `fcos_grouped_test_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  const clients = [];
  t.after(async () => {
    for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end(); }
    if (created) await admin.query(`drop database "${dbName}" with (force)`);
    await admin.end();
  });
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await admin.query('select count(*)::int as n from pg_roles where rolname=$1', [role])).rows[0].n, 1,
      'Use a local Supabase-compatible PostgreSQL cluster with the standard roles');
  }
  await admin.query(`create database "${dbName}"`); created = true;
  endpoint.pathname = `/${dbName}`;
  const connect = async () => {
    const client = new pg.Client({ connectionString: endpoint.toString() }); await client.connect();
    await client.query("set statement_timeout='8s'; set lock_timeout='6s'"); clients.push(client); return client;
  };
  const primary = await connect();
  const f = await fixture(t, { database: { query: (...args) => primary.query(...args), exec: (text) => primary.query(text) } });
  const call = (client, overrides) => client.query(sql, f.values(overrides)).then((result) => result.rows[0].result);
  const waitForLock = async (client) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const row = (await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [client.processID])).rows[0];
      if (row?.wait_event_type === 'Lock') return;
      await delay(25);
    }
    assert.fail('Expected an overlapping transaction to wait on a PostgreSQL lock');
  };
  return { ...f, primary, connect, call, waitForLock };
}

async function addCompetingClaim(f, { sourceId = f.source.salesforceId, targetId = f.ids.target } = {}) {
  const input = structuredClone(f.input);
  input.source.salesforceId = sourceId; input.xero.id = targetId;
  input.identity.documentIdentitySourceIds = [sourceId]; input.identity.candidateXeroDocumentIds = [targetId];
  const evaluated = evaluateGroupedPreservation(input); assert.equal(evaluated.eligible, true, JSON.stringify(evaluated.blockers));
  const review = { ...f.review, fingerprint: evaluated.fingerprint, evidenceFingerprint: hash(stable(evaluated.evidence)),
    evidence: evaluated.evidence, accountingCanonical: stable({ policyVersion: evaluated.policyVersion, accounting: evaluated.evidence.accounting }),
    evidenceCanonical: stable(evaluated.evidence) };
  const source = { ...f.source, salesforceId: sourceId, groupedPreservation: { ...f.source.groupedPreservation,
    fingerprint: review.fingerprint, evidenceFingerprint: review.evidenceFingerprint } };
  const runId = f.runId; const itemId = randomUUID();
  await f.db.query(`insert into public.xero_financial_sync_items
    select (jsonb_populate_record(null::public.xero_financial_sync_items,to_jsonb(i)||$1::jsonb)).*
    from public.xero_financial_sync_items i where id=$2`, [JSON.stringify({ id: itemId, run_id: runId, row_key: itemId, row_index: 1,
    idempotency_key: itemId, source_id: sourceId, source_payload: source, xero_payload: input.xero, xero_document_id: targetId }), f.itemId]);
  return { p_run_id: runId, p_item_id: itemId, p_review: review };
}

test('PostgreSQL overlapping transactions serialize exact retries, ownership races and mapping drift', {
  skip: !concurrencyUrl && 'Set FCOS_GROUPED_TEST_DATABASE_URL to a disposable local Supabase-compatible PostgreSQL endpoint', timeout: 60000,
}, async (t) => {
  await t.test('same item retry waits then returns exactly one audit and mapping', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect();
    await f.primary.query('begin'); const first = await f.call(f.primary);
    const pending = f.call(second); const settled = pending.then((value) => ({ value }), (error) => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit');
    assert.deepEqual((await settled).value, { ...first, alreadyLinked: true });
    const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
  });
  await t.test('document start gate serializes before provider reads and never expires an interrupted run', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect(); const nextRun = randomUUID();
    await f.primary.query("update public.xero_financial_sync_runs set status='authorised',revision=2 where id=$1", [f.runId]);
    await f.primary.query(`insert into public.xero_financial_sync_runs
      (id,idempotency_key,mode,status,revision,reviewed_by,reviewed_at)
      values ($1::uuid,$1::text,'document_apply','authorised',2,$2,now())`, [nextRun, f.actor.id]);
    await f.primary.query('begin');
    await f.primary.query('select public.start_xero_financial_sync_run_v1($1,2)', [f.runId]);
    const pending = second.query('select public.start_xero_financial_sync_run_v1($1,2)', [nextRun]);
    const settled = pending.then(() => ({}), (error) => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit');
    assert.equal((await settled).error?.constraint, 'xero_financial_one_processing_document_run_uidx');
    await f.primary.query("update public.xero_financial_sync_runs set updated_at='2000-01-01' where id=$1", [f.runId]);
    await assert.rejects(second.query('select public.start_xero_financial_sync_run_v1($1,2)', [nextRun]), { code: '23505' });
    const paymentKey = randomUUID();
    await second.query(`insert into public.xero_financial_sync_runs(idempotency_key,mode,status) values ($1,'payment_apply','processing')`, [paymentKey]);
    await f.primary.query("update public.xero_financial_sync_runs set status='completed' where id=$1", [f.runId]);
    await second.query('select public.start_xero_financial_sync_run_v1($1,2)', [nextRun]);
  });
  for (const conflict of ['target', 'source']) await t.test(`same-run items compete for canonical ${conflict}`, async (child) => {
    const f = await postgresFixture(child); const second = await f.connect();
    const competing = await addCompetingClaim(f, conflict === 'target'
      ? { sourceId: 'a01000000000099', targetId: f.ids.target.toUpperCase() }
      : { sourceId: f.ids.source, targetId: randomUUID() });
    await f.primary.query('begin'); await f.call(f.primary);
    const pending = f.call(second, competing); const settled = pending.then((value) => ({ value }), (error) => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit');
    assert.ok(['23505', '40001'].includes((await settled).error?.code));
    const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
    assert.equal(saved.items.find((item) => item.id === competing.p_item_id).status, 'selected');
  });
  await t.test('ordinary alias insert loses against the accepted canonical ownership index', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect();
    await f.primary.query('begin'); await f.call(f.primary);
    const pending = second.query(`insert into public.xero_financial_document_mappings
      (salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,source_fingerprint,financial_fingerprint)
      values ('Supplier_Invoice__c',$1,'ORDINARY','supplier_bill','ACCPAY',$2,'ordinary','ordinary')`, [f.ids.source, randomUUID()]);
    const settled = pending.then(() => ({}), (error) => ({ error })); await f.waitForLock(second); await f.primary.query('commit');
    assert.equal((await settled).error?.code, '23505'); assert.equal((await f.snapshot()).mappings.length, 1);
  });
  await t.test('product edit wins its lock and causes stale acceptance to roll back', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect();
    await second.query('begin'); await second.query('update public.xero_financial_product_mappings set revision=2 where id=$1', [f.ids.productMapping]);
    const pending = f.call(f.primary); const settled = pending.then(() => ({}), (error) => ({ error }));
    await f.waitForLock(f.primary); await second.query('commit'); assert.equal((await settled).error?.code, '40001');
    const saved = await f.snapshot(); assert.equal(saved.mappings, null); assert.equal(saved.audits, null); assert.equal(saved.items[0].status, 'selected');
  });
});
