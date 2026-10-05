import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { issuedSupplierRoundedWorkflowFixture } from './xeroIssuedSupplierPreservationFixtures.js';
import { xeroFinancialDocumentPreservationPreview as preview, xeroFinancialDocumentPreservationRun as run } from '../api/_xeroIssuedSupplierWorkflow.js';
import { issuedSupplierCanonical as canonical, issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';

const actor = { id: '00000000-0000-4000-8000-000000000099', email: 'finance@example.com' };
const copy = structuredClone;
const migration = '20260927223013_xero_trustee_source_cent_rounding.sql';
// CI's existing PostgreSQL job exercises the identical real workflow and SQL.
// Never connect to a remote endpoint or mutate the endpoint's own database.
async function database(t) {
  const url = process.env.FCOS_ISSUED_TEST_DATABASE_URL || process.env.FCOS_GROUPED_TEST_DATABASE_URL;
  if (!url) {
    const db = new PGlite(); t.after(() => db.close());
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    return db;
  }
  const endpoint = new URL(url);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname));
  assert.ok(['postgres:','postgresql:'].includes(endpoint.protocol));
  const admin = new pg.Client({connectionString:endpoint.toString()}); await admin.connect();
  const name = `fcos_trustee_rounding_${randomUUID().replaceAll('-','')}`;
  let created = false, primary;
  t.after(async () => {
    if (primary) { await primary.query('rollback').catch(() => {}); await primary.end(); }
    if (created) await admin.query(`drop database "${name}" with (force)`);
    await admin.end();
  });
  for (const role of ['anon','authenticated','service_role']) assert.equal(
    (await admin.query('select count(*)::int as n from pg_roles where rolname=$1',[role])).rows[0].n,1);
  await admin.query(`create database "${name}"`); created = true; endpoint.pathname = `/${name}`;
  primary = new pg.Client({connectionString:endpoint.toString()}); await primary.connect();
  await primary.query("set statement_timeout='8s'; set lock_timeout='6s'");
  return {query:(...args)=>primary.query(...args),exec:sql=>primary.query(sql)};
}
async function harness(t) {
  const db = await database(t);
  for (const name of ['20260827145608_xero_contact_sync.sql', '20260829080726_xero_financial_sync.sql',
    '20260923210832_xero_financial_selection_scope.sql', '20260923213339_xero_payment_reference_link.sql',
    '20260923222821_xero_grouped_preservation_link.sql', '20260927154515_xero_financial_preview_persistence.sql',
    '20260927175805_xero_issued_supplier_preservation_link.sql', migration]) {
    await db.exec((await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')).replace(/^create extension if not exists pgcrypto;$/m, ''));
  }
  const f = issuedSupplierRoundedWorkflowFixture(); const calls = [];
  await db.query("insert into public.xero_contact_sync_connections (tenant_id,refresh_token) values ($1,'test-only')", [f.ids.tenant]);
  await db.query(`insert into public.xero_financial_product_mappings
    (id,direction,salesforce_product_id,salesforce_product_name,xero_account_code,xero_tax_type,revision)
    values ($1,'supplier',$2,'TRUSTEE SERVICE','51106','NONE',2)`, [f.ids.mapping, f.ids.product]);
  await db.exec('grant usage on schema public to service_role; set role service_role');
  const state = { beforeLink: null };
  const client = {
    from(table) {
      assert.ok(['dispute_beta_cases','xero_financial_sync_runs','xero_financial_sync_items','xero_financial_document_mappings','xero_financial_audit_events'].includes(table));
      const filters = []; let single = false, order = null, limit = Infinity;
      const q = { select: () => q, eq: (key, value) => { filters.push(row => row[key] === value); return q; },
        in: (key, values) => { filters.push(row => values.includes(row[key])); return q; },
        maybeSingle: () => { single = true; return q; }, order: key => { order = key; return q; }, limit: value => { limit = value; return q; },
        then: (resolve, reject) => (async () => {
          let rows = table === 'dispute_beta_cases' ? [] : (await db.query(`select to_jsonb(t) as value from public.${table} t`)).rows.map(r => r.value);
          rows = rows.filter(row => filters.every(filter => filter(row)));
          if (order) rows.sort((a,b) => a[order] - b[order]); rows = rows.slice(0,limit);
          return { data: single ? rows[0] || null : rows, error: null };
        })().then(resolve,reject) };
      return q;
    },
    async rpc(name, body) {
      assert.ok(['persist_xero_financial_preview_v1','authorise_xero_financial_sync_run_v1','start_xero_financial_sync_run_v1',
        'finish_xero_financial_sync_run_v1','link_xero_issued_supplier_document_v1'].includes(name));
      calls.push({ name, body: copy(body) });
      if (name === 'link_xero_issued_supplier_document_v1' && state.beforeLink) await state.beforeLink(body);
      const entries = Object.entries(body); const params = entries.map(([key,value]) => ['p_run','p_items','p_review','p_classification_summary','p_rate_limit_snapshot'].includes(key) ? JSON.stringify(value) : value);
      const placeholders = entries.map(([key],i) => { assert.match(key,/^p_[a-z_]+$/); return `${key} => $${i+1}`; });
      try { const result = await db.query(`select to_jsonb(public.${name}(${placeholders.join(',')})) as result`, params); return { data: result.rows[0].result, error: null }; }
      catch (error) { return { data: null, error }; }
    },
  };
  const deps = { client, env: { FCOS_ENABLE_XERO_FINANCIAL_SYNC:'true' }, accessContext: { profile: actor },
    fetchImpl: async () => assert.fail('No provider writes or arbitrary network access'),
    getConnection: async () => ({ tenantId:f.ids.tenant }), collectFiles: async () => copy(f.files),
    loadSalesforce: async () => copy(f.salesforce), loadXero: async () => copy(f.xero), loadControls: async () => copy(f.stored), collectVessels: async () => copy(f.vessels) };
  const saved = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(i)) from public.xero_financial_sync_items i) as items,
    (select jsonb_agg(to_jsonb(m)) from public.xero_financial_document_mappings m) as mappings,
    (select jsonb_agg(to_jsonb(a)) from public.xero_financial_audit_events a where event_type='issued_supplier_document_preservation_linked') as audits`)).rows[0];
  return { db, f, deps, calls, state, saved,
    preview: () => preview({packet:f.packet},deps),
    run: result => run({runId:result.run.id,revision:result.run.revision,selectedItemIds:result.rows.map(r=>r.id),reviewed:true},deps) };
}

function rehash(review) {
  review.accountingCanonical = canonical({policyVersion:review.policyVersion,accounting:review.evidence.accounting});
  review.evidenceCanonical = canonical(review.evidence);
  review.fingerprint = hash({policyVersion:review.policyVersion,accounting:review.evidence.accounting});
  review.evidenceFingerprint = hash(review.evidence);
}

test('actual raw trustee Preview → authenticated Run → real SQL preserves all fields and replays idempotently', async t => {
  const h = await harness(t); const original = copy(h.f.candidate); const p = await h.preview();
  assert.equal(p.rows[0].status,'eligible');
  const before = await h.saved(); const payload = before.items[0].source_payload;
  assert.equal(Object.hasOwn(payload,'groupedAccounting'),false);
  assert.deepEqual(payload.issuedSupplierRoundingSource,{id:h.f.ids.child,quantity:248.394,unitAmount:0.5,lineAmount:124.197});
  assert.equal(payload.readiness.ready,false);
  const result = await h.run(p); assert.equal(result.financialWrites,0); assert.equal(result.outcomes[0].status,'linked');
  const after = await h.saved(); assert.equal(after.mappings.length,1);assert.equal(after.audits.length,1);
  assert.equal(after.items[0].mutation_attempts,0);assert.deepEqual(after.items[0].xero_payload,original);
  assert.deepEqual(after.mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.source.lines[0].centRounding,
    {policy:'trustee_source_decimal_half_up_v1',rawLineAmount:'124.197',roundedLineAmountCents:'12420'});
  assert.deepEqual(after.audits[0].record_counts,{linked:1,applied:0,financialWrites:0});
  const replay = await h.run(p);assert.equal(replay.outcomes[0].alreadyLinked,true);assert.deepEqual(await h.saved(),after);
  assert.equal(h.calls.filter(c=>c.name==='link_xero_issued_supplier_document_v1').length,1);
});

test('real SQL independently rejects rehashed marker/raw/paper/target contradictions without mappings or link audit', async t => {
  const h = await harness(t); const p = await h.preview(); let captured;
  h.state.beforeLink = body => { captured = copy(body); };
  // Roll back the successful real workflow so its exact persisted inputs and
  // transaction envelope can be attacked independently at the SQL boundary.
  await h.db.exec('begin'); await h.run(p); await h.db.exec('rollback');
  assert.ok(captured); const original = (await h.saved()).items[0];
  await h.db.query("update public.xero_financial_sync_runs set status='processing',revision=$2,reviewed_by=$3,reviewed_by_email=$4,reviewed_at=now() where id=$1",
    [captured.p_run_id,captured.p_expected_run_revision,actor.id,actor.email]);
  await h.db.query("update public.xero_financial_sync_items set status='selected',selected=true,updated_at=$2 where id=$1",[captured.p_item_id,captured.p_expected_item_updated_at]);
  for (const [name, change] of [
    ['strip marker', (proof) => { delete proof.accounting.source.lines[0].centRounding; }],
    ['null marker', (proof) => { proof.accounting.source.lines[0].centRounding=null; }],
    ['unknown policy', (proof) => { proof.accounting.source.lines[0].centRounding.policy='unknown'; }],
    ['extra marker key', (proof) => { proof.accounting.source.lines[0].centRounding.extra=true; }],
    ['changed rounded cents', (proof) => { proof.accounting.source.lines[0].centRounding.roundedLineAmountCents='12419'; }],
    ['same-cent product mismatch', (proof,payload) => { proof.accounting.source.lines[0].centRounding.rawLineAmount='124.196';payload.issuedSupplierRoundingSource.lineAmount=124.196; }],
    ['raw quantity drift', (_proof,payload) => { payload.issuedSupplierRoundingSource.quantity=248.392; }],
    ['missing raw', (_proof,payload) => { delete payload.issuedSupplierRoundingSource; }],
    ['wrong raw child', (_proof,payload) => { payload.issuedSupplierRoundingSource.id='a04000000000099'; }],
    ['paper subcent', (proof) => { proof.accounting.issuedFile.review.lines[0].amount='109.577'; }],
    ['paper one cent', (proof) => { proof.accounting.issuedFile.review.total='124.19'; }],
    ['Xero subcent', (proof,_payload,target) => { target.lineItems[0].LineAmount=124.197;proof.accounting.xero.rawLineItems=copy(target.lineItems); }],
  ]) await t.test(name, async () => {
    await h.db.exec('begin');
    try {
      const body=copy(captured),payload=copy(original.source_payload),target=copy(original.xero_payload);
      change(body.p_review.evidence,payload,target);rehash(body.p_review);
      Object.assign(payload.issuedSupplierPreservation,{fingerprint:body.p_review.fingerprint,evidenceFingerprint:body.p_review.evidenceFingerprint});
      await h.db.query('update public.xero_financial_sync_items set source_payload=$2,xero_payload=$3 where id=$1',[body.p_item_id,JSON.stringify(payload),JSON.stringify(target)]);
      const entries=Object.entries(body);const params=entries.map(([key,value])=>key==='p_review'?JSON.stringify(value):value);
      await assert.rejects(h.db.query(`select public.link_xero_issued_supplier_document_v1(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')})`,params),{code:'40001'});
    } finally { await h.db.exec('rollback'); }
    const saved=await h.saved();assert.equal(saved.mappings,null);assert.equal(saved.audits,null);
  });
});

test('raw same-cent drift after preview aborts before the real link RPC', async t => {
  const h=await harness(t);const p=await h.preview();h.f.child.Line_Total_Buy__c=124.196;
  await assert.rejects(h.run(p),/changed/);
  assert.equal(h.calls.some(c=>c.name==='link_xero_issued_supplier_document_v1'),false);
  assert.equal((await h.saved()).mappings,null);
});


for (const [quantity, unit, raw, total] of [[372.244,0.5,186.122,186.12],[204.75,0.5,102.375,102.38],[24.666,2,49.332,49.33]]) {
  test(`real workflow and SQL round exact source product ${raw} to ${total}`, async t => {
    const h=await harness(t);const f=h.f;
    Object.assign(f.child,{Quantity_Delivered_Per_BDN__c:quantity,Quantity__c:quantity,Unit_Cost__c:unit,Line_Total_Buy__c:raw});
    f.supplier.Invoice_Amount__c=total;
    Object.assign(f.candidate,{total,amountDue:total});
    Object.assign(f.candidate.groupedAccounting,{subtotal:total,total,amountDue:total});
    Object.assign(f.candidate.lineItems[0],{UnitAmount:total,LineAmount:total});
    f.fileEvidence.review.total=String(total);f.fileEvidence.review.lines=[{description:'Trustee charge',amount:String(total)}];
    // Packet retains the same literal-review object as the trusted file fixture.
    f.packet.records[0].review=f.fileEvidence.review;
    const p=await h.preview();assert.equal(p.rows[0].status,'eligible');
    const result=await h.run(p);assert.equal(result.outcomes[0].status,'linked');assert.equal(result.financialWrites,0);
    assert.equal((await h.saved()).mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.source.lines[0].centRounding.rawLineAmount,String(raw));
  });
}
