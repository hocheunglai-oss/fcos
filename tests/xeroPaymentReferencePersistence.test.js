import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { persistReviewedPaymentReferenceLinks } from '../api/_xeroPaymentReferenceLink.js';
import { paymentPostingKey } from '../api/_xeroPaymentPosting.js';

const migration = new URL('../supabase/migrations/20260923213339_xero_payment_reference_link.sql', import.meta.url);
const rpcName = 'public.link_xero_payment_references_v1(uuid,jsonb,uuid,text)';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sfId = (index, suffix = 'AAA') => `a0S${String(index).padStart(12, '0')}${suffix}`;
const conflict = { code: 'XERO_PAYMENT_REFERENCE_LINK_CONFLICT', status: 409 };

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
  const baseline = await readFile(new URL('../supabase/migrations/20260829080726_xero_financial_sync.sql', import.meta.url), 'utf8');
  await db.exec(baseline.replace(/^create extension if not exists pgcrypto;$/m, ''));
  await db.exec(await readFile(migration, 'utf8'));
  const tenantId = randomUUID(); const actor = { id: randomUUID(), email: ' FINANCE@example.test ' };
  const document = {
    id: randomUUID(), salesforce_object: 'Supplier_Invoice__c', salesforce_id: 'a06000000000001AAA',
    xero_document_id: randomUUID(), xero_document_type: 'ACCPAY', xero_contact_id: randomUUID(),
    source_fingerprint: hash('document-source'), retained_differences: { accountId: '001000000000001AAA', stemId: 'stem-1' }, protected_legacy: true,
  };
  const bank = { id: randomUUID(), salesforce_bank_name: 'UBS', xero_bank_account_id: randomUUID(), revision: 3, enabled: true };
  await db.query(`insert into public.xero_financial_document_mappings
    (id,salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,
      xero_contact_id,source_fingerprint,financial_fingerprint,protected_legacy,retained_differences)
    values ($1,$2,$3,'S2601128','supplier_bill',$4,$5,$6,$7,'financial',true,$8)`,
  [document.id, document.salesforce_object, document.salesforce_id, document.xero_document_type, document.xero_document_id,
    document.xero_contact_id, document.source_fingerprint, JSON.stringify(document.retained_differences)]);
  await db.query(`insert into public.xero_financial_bank_mappings
    (id,salesforce_bank_name,xero_bank_account_id,xero_bank_account_name,revision,enabled) values ($1,'UBS',$2,'UBS USD',3,true)`, [bank.id, bank.xero_bank_account_id]);
  let rpcCalls = 0;
  const client = { rpc: async (name, params) => {
    assert.equal(name, 'link_xero_payment_references_v1'); rpcCalls += 1;
    try {
      const result = await db.query('select public.link_xero_payment_references_v1($1,$2::jsonb,$3,$4) as result',
        [params.p_tenant_id, JSON.stringify(params.p_rows), params.p_actor_id, params.p_actor_email]);
      return { data: result.rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } };
  const row = (index = 1) => ({
    salesforcePaymentId: sfId(index), salesforcePaymentName: sfId(index, ''), documentMappingId: document.id,
    xeroPaymentId: randomUUID(), bankAccountId: bank.xero_bank_account_id, amount: 100 + index / 100,
    currency: 'USD', paymentDate: '2026-02-02', sourceFingerprint: hash(`source-${index}`),
    referenceReviewFingerprint: hash(`review-${index}`),
    retainedReferenceEvidence: { documentMapping: structuredClone(document), bankMapping: structuredClone(bank),
      sourceReference: null, xeroReference: `AP-${index}`, sourceFallbackReference: sfId(index, '') },
  });
  const persist = (rows, overrides = {}) => persistReviewedPaymentReferenceLinks(client, { tenantId, rows, actor, ...overrides });
  const raw = (rows, overrides = {}) => client.rpc('link_xero_payment_references_v1', {
    p_tenant_id: tenantId, p_rows: rows.map((r) => ({ ...r, idempotencyKey: paymentPostingKey(tenantId, r.salesforcePaymentId) })),
    p_actor_id: actor.id, p_actor_email: actor.email, ...overrides,
  });
  const counts = async () => (await db.query(`select
    (select count(*)::integer from public.xero_financial_payment_mappings) as mappings,
    (select count(*)::integer from public.xero_financial_sync_runs) as claims,
    (select count(*)::integer from public.xero_financial_audit_events) as audits`)).rows[0];
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(m) order by id) from public.xero_financial_payment_mappings m) as mappings,
    (select jsonb_agg(to_jsonb(r) order by id) from public.xero_financial_sync_runs r) as claims,
    (select jsonb_agg(to_jsonb(a) order by id) from public.xero_financial_audit_events a) as audits`)).rows[0];
  return { db, tenantId, actor, document, bank, row, persist, raw, counts, snapshot, rpcCalls: () => rpcCalls };
}

async function insertPostingClaim(f, row, state = 'intent') {
  await f.db.query(`insert into public.xero_financial_sync_runs (idempotency_key,mode,status,source_fingerprint,control_totals)
    values ($1,'payment_apply',$2,$3,$4)`, [paymentPostingKey(f.tenantId, row.salesforcePaymentId), state === 'intent' ? 'processing' : 'failed',
    row.sourceFingerprint, JSON.stringify({ paymentPosting: { tenantId: f.tenantId, paymentId: row.salesforcePaymentId.slice(0, 15), state, reviewed: row } })]);
}

async function insertMapping(f, row, sourceId = row.salesforcePaymentId, targetId = row.xeroPaymentId) {
  await f.db.query(`insert into public.xero_financial_payment_mappings
    (salesforce_payment_id,document_mapping_id,xero_payment_id,xero_bank_account_id,source_fingerprint,amount,currency,payment_date,status)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'linked')`,
  [sourceId, row.documentMappingId, targetId, row.bankAccountId, row.sourceFingerprint, row.amount, row.currency, row.paymentDate]);
}

test('one RPC atomically saves mappings, completed posting barriers and Finance audit without provider calls', async (t) => {
  const f = await fixture(t); const rows = [f.row(2), f.row(1)];
  const result = await f.persist(rows);
  assert.deepEqual(result.summary, { linked: 2, failed: 0, alreadyLinked: 0 });
  assert.equal(f.rpcCalls(), 1); assert.deepEqual(await f.counts(), { mappings: 2, claims: 2, audits: 2 });
  const saved = await f.snapshot();
  for (const row of rows) {
    const mapping = saved.mappings.find((item) => item.salesforce_payment_id === row.salesforcePaymentId);
    assert.deepEqual(mapping.retained_reference, { version: 1, tenantId: f.tenantId, sourceFingerprint: row.sourceFingerprint,
      referenceReviewFingerprint: row.referenceReviewFingerprint, evidence: row.retainedReferenceEvidence });
    assert.equal(mapping.xero_payment_id, row.xeroPaymentId); assert.equal(mapping.status, 'linked');
    const claim = saved.claims.find((item) => item.idempotency_key === paymentPostingKey(f.tenantId, row.salesforcePaymentId));
    assert.equal(claim.mode, 'payment_apply'); assert.equal(claim.status, 'completed');
    assert.equal(claim.control_totals.paymentPosting.state, 'reference_linked');
    assert.equal(claim.control_totals.paymentPosting.paymentId, row.salesforcePaymentId.slice(0, 15));
    assert.equal(claim.control_totals.paymentPosting.confirmedPaymentId, row.xeroPaymentId);
    assert.deepEqual(claim.control_totals.paymentPosting.reviewed, row);
    const audit = saved.audits.find((item) => item.run_id === claim.id);
    assert.equal(audit.actor_id, f.actor.id); assert.equal(audit.actor_email, 'finance@example.test');
    assert.equal(audit.event_type, 'payment_reference_linked');
    assert.deepEqual(audit.record_counts, { linked: 1, applied: 0, financialWrites: 0 });
    assert.deepEqual(audit.fingerprints.retainedReference, mapping.retained_reference);
  }
});

test('unchanged retry including equivalent 15-character source encoding performs no writes or duplicate audit', async (t) => {
  const f = await fixture(t); const row = f.row(); await f.persist([row]); const before = await f.snapshot();
  assert.equal((await f.raw([row])).error, null);
  assert.deepEqual((await f.persist([row])).summary, { linked: 1, failed: 0, alreadyLinked: 1 });
  assert.equal((await f.persist([{ ...row, salesforcePaymentId: row.salesforcePaymentId.slice(0, 15) }])).outcomes[0].alreadyLinked, true);
  assert.deepEqual(await f.snapshot(), before);
});

test('changed source, review, reference proof, amount or payment identity never overwrites a completed link', async (t) => {
  const f = await fixture(t); const row = f.row(); await f.persist([row]); const before = await f.snapshot();
  for (const update of [{ sourceFingerprint: hash('changed') }, { referenceReviewFingerprint: hash('changed') },
    { amount: row.amount + 1 }, { xeroPaymentId: randomUUID() }, { salesforcePaymentName: 'Changed' },
    { retainedReferenceEvidence: { ...row.retainedReferenceEvidence, xeroReference: 'OTHER' } }]) {
    await assert.rejects(f.persist([{ ...row, ...update }]), conflict);
    assert.deepEqual(await f.snapshot(), before);
  }
});

test('existing posting intent and uncertain claims win the same canonical source barrier and remain untouched', async (t) => {
  const f = await fixture(t);
  for (const [index, state] of [[1, 'intent'], [2, 'uncertain']]) {
    const row = f.row(index); await insertPostingClaim(f, { ...row, salesforcePaymentId: row.salesforcePaymentId.slice(0, 15) }, state);
    const before = await f.snapshot(); await assert.rejects(f.persist([row]), conflict); assert.deepEqual(await f.snapshot(), before);
  }
  assert.deepEqual(await f.counts(), { mappings: 0, claims: 2, audits: 0 });
});

test('a completed reference link prevents a later POST claim and alias claimant through the actual unique key', async (t) => {
  const f = await fixture(t); const row = f.row(); await f.persist([row]); const before = await f.snapshot();
  await assert.rejects(insertPostingClaim(f, { ...row, salesforcePaymentId: row.salesforcePaymentId.slice(0, 15) }), { code: '23505' });
  await assert.rejects(f.persist([{ ...row, salesforcePaymentId: `${row.salesforcePaymentId.slice(0, 15)}BBB`, xeroPaymentId: randomUUID() }]), conflict);
  assert.deepEqual(await f.snapshot(), before);
});

test('existing Salesforce alias or Xero ownership cannot be overwritten even without a posting claim', async (t) => {
  const f = await fixture(t); const sourceOwned = f.row(1); const targetOwned = f.row(2);
  await insertMapping(f, sourceOwned, sourceOwned.salesforcePaymentId.slice(0, 15), randomUUID());
  await insertMapping(f, targetOwned, sfId(99), targetOwned.xeroPaymentId.toUpperCase());
  const before = await f.snapshot();
  for (const row of [sourceOwned, targetOwned]) await assert.rejects(f.persist([row]), conflict);
  assert.deepEqual(await f.snapshot(), before);
  // The database also bars legacy direct inserts from bypassing canonical ownership.
  await assert.rejects(insertMapping(f, sourceOwned, sourceOwned.salesforcePaymentId, randomUUID()), { code: '23505' });
  await assert.rejects(insertMapping(f, targetOwned, sfId(98), targetOwned.xeroPaymentId), { code: '23505' });
});

test('audit failure rolls back claim and mapping, permitting an unchanged safe retry after storage recovery', async (t) => {
  const f = await fixture(t); const row = f.row();
  await f.db.exec(`create function public.reject_reference_link_audit() returns trigger language plpgsql as $$
    begin raise exception 'Injected audit storage failure' using errcode='XX000'; end $$;
    create trigger reject_reference_link_audit before insert on public.xero_financial_audit_events
    for each row execute function public.reject_reference_link_audit();`);
  await assert.rejects(f.persist([row]), { code: 'XERO_PAYMENT_REFERENCE_LINK_STORAGE_FAILED', status: 503 });
  assert.deepEqual(await f.counts(), { mappings: 0, claims: 0, audits: 0 });
  await f.db.exec('drop trigger reject_reference_link_audit on public.xero_financial_audit_events;');
  assert.equal((await f.persist([row])).summary.linked, 1);
});

test('a conflict on the second row rolls back the entire batch including the first audit', async (t) => {
  const f = await fixture(t); const first = f.row(1); const second = f.row(2);
  await insertPostingClaim(f, second); const before = await f.snapshot();
  await assert.rejects(f.persist([second, first]), conflict);
  assert.deepEqual(await f.snapshot(), before);
});

test('maximum 25-row batch succeeds and an identical batch retry preserves all stored rows', async (t) => {
  const f = await fixture(t); const rows = Array.from({ length: 25 }, (_, index) => f.row(index + 1));
  assert.deepEqual((await f.persist(rows)).summary, { linked: 25, failed: 0, alreadyLinked: 0 });
  const before = await f.snapshot();
  assert.deepEqual((await f.persist([...rows].reverse())).summary, { linked: 25, failed: 0, alreadyLinked: 25 });
  assert.deepEqual(await f.snapshot(), before);
});

test('an interrupted successful RPC is explicitly uncertain and retries without duplicating writes', async (t) => {
  const f = await fixture(t); const row = f.row();
  const interrupted = { rpc: async () => { assert.equal((await f.raw([row])).error, null); throw new Error('Connection interrupted'); } };
  await assert.rejects(persistReviewedPaymentReferenceLinks(interrupted, { tenantId: f.tenantId, rows: [row], actor: f.actor }),
    { code: 'XERO_PAYMENT_REFERENCE_LINK_CONFIRMATION_UNCERTAIN', status: 503 });
  const before = await f.snapshot(); assert.deepEqual(await f.counts(), { mappings: 1, claims: 1, audits: 1 });
  assert.equal((await f.persist([row])).summary.alreadyLinked, 1); assert.deepEqual(await f.snapshot(), before);
});

test('document or bank changes between server review and commit fail closed, including on retry', async (t) => {
  const f = await fixture(t); const row = f.row();
  await f.db.query('update public.xero_financial_document_mappings set xero_contact_id=$1 where id=$2', [randomUUID(), f.document.id]);
  await assert.rejects(f.persist([row]), conflict); assert.deepEqual(await f.counts(), { mappings: 0, claims: 0, audits: 0 });
  await f.db.query('update public.xero_financial_document_mappings set xero_contact_id=$1 where id=$2', [f.document.xero_contact_id, f.document.id]);
  await f.db.query('update public.xero_financial_bank_mappings set revision=revision+1 where id=$1', [f.bank.id]);
  await assert.rejects(f.persist([row]), conflict); assert.deepEqual(await f.counts(), { mappings: 0, claims: 0, audits: 0 });
  await f.db.query('update public.xero_financial_bank_mappings set revision=$1 where id=$2', [f.bank.revision, f.bank.id]);
  await f.persist([row]); const before = await f.snapshot();
  await f.db.query('update public.xero_financial_bank_mappings set enabled=false where id=$1', [f.bank.id]);
  await assert.rejects(f.persist([row]), conflict); assert.deepEqual(await f.snapshot(), before);
});

test('same source cannot acquire ownership in another tenant through a different posting key', async (t) => {
  const f = await fixture(t); const row = f.row(); await f.persist([row]); const before = await f.snapshot();
  await assert.rejects(f.persist([row], { tenantId: randomUUID() }), conflict);
  assert.deepEqual(await f.snapshot(), before);
});

test('helper rejects empty/oversized batches, aliases, duplicate targets and missing evidence before RPC', async (t) => {
  const f = await fixture(t); const row = f.row();
  for (const rows of [[], Array.from({ length: 26 }, (_, i) => f.row(i + 1)),
    [row, { ...row, salesforcePaymentId: row.salesforcePaymentId.slice(0, 15) }], [row, { ...row, salesforcePaymentId: sfId(2) }],
    [{ ...row, retainedReferenceEvidence: {} }], [{ ...row, sourceFingerprint: '' }],
    [{ ...row, paymentDate: '2026-02-30' }], [{ ...row, amount: 0 }], [{ ...row, amount: Infinity }]]) {
    await assert.rejects(f.persist(rows), { code: 'XERO_PAYMENT_REFERENCE_LINK_INVALID', status: 400 });
  }
  await assert.rejects(f.persist([row], { actor: { id: null, email: 'finance@example.test' } }), { code: 'XERO_PAYMENT_REFERENCE_LINK_INVALID' });
  assert.equal(f.rpcCalls(), 0); assert.deepEqual(await f.counts(), { mappings: 0, claims: 0, audits: 0 });
});

test('RPC independently rejects forged claim keys, duplicate aliases, invalid money and missing review snapshots', async (t) => {
  const f = await fixture(t); const row = f.row();
  for (const [rows, overrides] of [
    [[], {}], [[row, { ...row, salesforcePaymentId: row.salesforcePaymentId.slice(0, 15), xeroPaymentId: randomUUID() }], {}],
    [[{ ...row, amount: -1 }], {}], [[{ ...row, sourceFingerprint: '' }], {}],
    [[{ ...row, retainedReferenceEvidence: { xeroReference: 'AP' } }], {}],
    [[row], { p_rows: [{ ...row, idempotencyKey: 'wrong-key' }] }],
    [[row], { p_actor_id: null }],
  ]) {
    assert.ok((await f.raw(rows, overrides)).error);
    assert.deepEqual(await f.counts(), { mappings: 0, claims: 0, audits: 0 });
  }
});

test('RPC is invoker/service-only and preserves forced RLS and private table privileges', async (t) => {
  const f = await fixture(t);
  const grants = (await f.db.query(`select has_function_privilege('anon',$1,'EXECUTE') as anon,
    has_function_privilege('authenticated',$1,'EXECUTE') as authenticated,
    has_function_privilege('service_role',$1,'EXECUTE') as service`, [rpcName])).rows[0];
  assert.deepEqual(grants, { anon: false, authenticated: false, service: true });
  const fn = (await f.db.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [rpcName])).rows[0];
  assert.equal(fn.prosecdef, false); assert.deepEqual(fn.proconfig, ['search_path=public, pg_temp']);
  const tables = (await f.db.query(`select relrowsecurity,relforcerowsecurity from pg_class
    where oid in ('public.xero_financial_payment_mappings'::regclass,'public.xero_financial_sync_runs'::regclass,'public.xero_financial_audit_events'::regclass)`)).rows;
  assert.equal(tables.length, 3); assert.ok(tables.every((r) => r.relrowsecurity && r.relforcerowsecurity));
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`set role ${role}`);
    assert.equal((await f.raw([f.row()])).error.code, '42501');
    await assert.rejects(f.db.query('select retained_reference from public.xero_financial_payment_mappings'), { code: '42501' });
    await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role');
  assert.equal((await f.persist([f.row()])).summary.linked, 1);
});

test('unconfirmed RPC response fails closed instead of claiming a successful link', async () => {
  const row = { salesforcePaymentId: sfId(1), salesforcePaymentName: 'PAY', documentMappingId: randomUUID(), xeroPaymentId: randomUUID(),
    bankAccountId: randomUUID(), amount: 10, currency: 'USD', paymentDate: '2026-02-02', sourceFingerprint: hash('source'),
    referenceReviewFingerprint: hash('review'), retainedReferenceEvidence: { reference: 'AP' } };
  for (const outcomes of [[], [null], [{}]]) {
    await assert.rejects(persistReviewedPaymentReferenceLinks({ rpc: async () => ({ data: { outcomes }, error: null }) },
      { tenantId: randomUUID(), rows: [row], actor: { id: randomUUID(), email: 'finance@example.test' } }),
    { code: 'XERO_PAYMENT_REFERENCE_LINK_CONFIRMATION_UNCERTAIN', status: 503 });
  }
});
