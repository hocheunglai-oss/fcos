import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { buildReconciliationCases } from '../api/_xeroReconciliationPolicy.js';
import { buildCampaignContactCases } from '../api/_xeroReconciliationContacts.js';
import { paymentPostingKey } from '../api/_xeroPaymentPosting.js';
import { resolveGroupRemittanceBankEvidence } from '../api/_xeroGroupRemittanceBankEvidence.js';
import { reviewedPaymentReferenceRow } from '../api/_xeroPaymentReferenceLink.js';
import { validatedGroupPaymentRow } from '../api/_xeroGroupPaymentPersistence.js';

const actor = '00000000-0000-4000-8000-000000000099';
const tenant = '00000000-0000-4000-8000-000000000001';
const contact = '00000000-0000-4000-8000-000000000002';
const migrations = [
  '20260827145608_xero_contact_sync.sql',
  '20260829080726_xero_financial_sync.sql',
  '20260923213339_xero_payment_reference_link.sql',
  '20260923222821_xero_grouped_preservation_link.sql',
  '20260927175805_xero_issued_supplier_preservation_link.sql',
  '20260928005135_xero_group_remittance_bank_evidence.sql',
  '20260928053229_xero_document_field_correction_journal.sql',
  '20260929170347_xero_shared_control.sql',
];
const campaignMigration = '20260929170953_xero_reconciliation_campaign.sql';
const tables = ['campaigns', 'cases', 'batches', 'events'].map((name) => `xero_reconciliation_${name}`);
const nativeUrl = process.env.FCOS_CAMPAIGN_TEST_DATABASE_URL
  || process.env.FCOS_CORRECTION_TEST_DATABASE_URL || process.env.FCOS_GROUPED_TEST_DATABASE_URL;

async function database(t) {
  if (!nativeUrl) {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
    return { db };
  }
  const endpoint = new URL(nativeUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Tests may only use a local PostgreSQL server');
  assert.ok(['postgres:', 'postgresql:'].includes(endpoint.protocol));
  const admin = new pg.Client({ connectionString: endpoint.toString() });
  await admin.connect();
  const name = `fcos_campaign_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`create database "${name}"`);
  endpoint.pathname = `/${name}`;
  const clients = [];
  const connect = async () => {
    const client = new pg.Client({ connectionString: endpoint.toString() });
    await client.connect();
    clients.push(client);
    await client.query("set statement_timeout = '8s'; set lock_timeout = '4s'");
    return client;
  };
  t.after(async () => {
    for (const client of clients) {
      await client.query('rollback').catch(() => {});
      await client.end();
    }
    await admin.query(`drop database "${name}" with (force)`);
    await admin.end();
  });
  const primary = await connect();
  return { db: { query: (...args) => primary.query(...args), exec: (sql) => primary.query(sql) }, connect };
}

async function loadMigration(db, name) {
  // gen_random_uuid and sha256 are built-ins; PGlite does not ship pgcrypto.
  const sql = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  await db.exec(sql.replace(/^create extension if not exists pgcrypto;$/m, ''));
}

function fixtures(count = 1, payments = [], { draft = false, contactCases = [], configureItems } = {}) {
  const run = { id: randomUUID(), mode: 'preview', status: 'ready_for_review', revision: 1,
    created_at: '2026-09-30T00:00:00.000Z', control_totals: { workflowSnapshot: {
      complete: true, linkFirst: true, includePayments: true, tenantId: tenant,
      expectedItemCount: count, controlsFingerprint: 'c'.repeat(64), checkedAt: '2026-09-30T00:00:00.000Z',
      payments: { tenantId: tenant, rows: payments }, contactCases,
    } } };
  const items = Array.from({ length: count }, (_, index) => {
    const sourceId = `a0K${String(index + 1).padStart(12, '0')}`;
    const documentId = randomUUID();
    return { id: randomUUID(), run_id: run.id, row_index: index, row_key: `Invoice__c:${sourceId}`,
      source_object: 'Invoice__c', source_id: sourceId, source_type: 'buyer_invoice',
      source_document_number: `INV-${index + 1}`, currency: 'USD', source_total: 100,
      proposed_action: draft ? 'create_draft' : 'link', status: 'eligible', blockers: [], differences: [],
      xero_document_id: draft ? null : documentId, xero_document_status: draft ? null : 'AUTHORISED',
      source_payload: { salesforceObject: 'Invoice__c', salesforceId: sourceId,
        documentKind: 'buyer_invoice', xeroType: 'ACCREC', xeroCollection: 'Invoices', postingMode: 'draft', documentNumber: `INV-${index + 1}`, currency: 'USD', total: 100,
        deliveryDate: '2026-09-01', invoiceDate: '2026-09-01', documentFieldProjection: { scope: 'current' },
        contactId: contact, sourceFingerprint: 'a'.repeat(64), financialFingerprint: 'b'.repeat(64) },
      xero_payload: draft ? {} : { id: documentId, total: 100 },
      proposed_payload: draft ? { Type:'ACCREC',Status:'DRAFT',Contact:{ContactID:contact},InvoiceNumber:`INV-${index + 1}`,
        Date:'2026-09-01',DueDate:'2026-09-15',CurrencyCode:'USD',LineAmountTypes:'NoTax',
        LineItems:[{Description:'Marine fuel',Quantity:1,UnitAmount:100,AccountCode:'200',TaxType:'NONE'}] } : {},
      idempotency_key: `item-${run.id}-${index}` };
  });
  configureItems?.(items);
  return { run, items, cases: buildReconciliationCases({ tenantId: tenant, run, items, ownerId: actor }) };
}

async function harness(t, { count = 1, payments = [], draft = false, contactCases = [], configureItems } = {}) {
  const { db, connect } = await database(t);
  await db.exec('grant usage on schema public to anon, authenticated, service_role');
  await db.exec('create table public.user_profiles(id uuid primary key,email text,active boolean,user_type text)');
  await db.exec('grant select on public.user_profiles to service_role');
  await db.query("insert into public.user_profiles values($1,'reviewer@example.test',true,'administrator')", [actor]);
  for (const name of migrations) await loadMigration(db, name);
  // Model existing Supabase defaults, including privileges that bypass RLS.
  await db.exec('alter default privileges in schema public grant all on tables to public, anon, authenticated, service_role');
  await db.exec(`create function public.fcos_has_access(p_user uuid, p_module text)
    returns boolean language sql stable as $$ select p_user = '${actor}'::uuid
      and p_module in ('xero_portal', 'xero_portal_manage') $$`);
  await loadMigration(db, campaignMigration);
  await db.query("insert into public.xero_contact_sync_connections(tenant_id,refresh_token) values($1,'test-only')", [tenant]);
  const fixture = fixtures(count, payments, { draft, contactCases, configureItems });
  await db.query(`insert into public.xero_financial_sync_runs(id,idempotency_key,mode,status,revision,created_at,control_totals)
    values($1,$2,'preview','ready_for_review',1,$3,$4)`,
  [fixture.run.id, `run-${fixture.run.id}`, fixture.run.created_at, JSON.stringify(fixture.run.control_totals)]);
  for (const item of fixture.items) {
    const entries = Object.entries(item);
    await db.query(`insert into public.xero_financial_sync_items(${entries.map(([key]) => key).join(',')})
      values(${entries.map((_, index) => `$${index + 1}`).join(',')})`,
    entries.map(([, value]) => value && typeof value === 'object' ? JSON.stringify(value) : value));
  }
  await db.exec('set role service_role');
  const rpc = async (name, values) => (await db.query(
    `select public.xero_campaign_${name}_v1(${values.map((_, index) => `$${index + 1}`).join(',')}) as result`,
    values.map((value) => value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value),
  )).rows[0].result;
  const h = { db, connect, ...fixture, rpc,
    rows: async (table) => (await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows.map((row) => row.row),
    create: (cases = fixture.cases, revision = 1, user = actor) => rpc('create', [user, tenant, fixture.run.id, revision, JSON.stringify(cases)]),
    prepare: (campaign, ids = fixture.cases.map((row) => row.id), category = 'link_only') => rpc('prepare', [actor, campaign.id, campaign.revision, category, ids, { writeCalls: category==='link_only'?0:ids.length }]),
    approve: (batch, revision = batch.revision, fingerprint = batch.evidence_fingerprint) => rpc('approve', [actor, batch.id, revision, fingerprint]),
    claim: (batch, revision = batch.revision) => rpc('claim', [actor, batch.id, revision]),
    finish: (claim, outcomes) => rpc('finish', [actor, claim.batch.id, claim.batch.claim_id, JSON.stringify(outcomes)]),
    outcomes: (claim) => claim.cases.map((row) => {
      const item = fixture.items.find((entry) => entry.source_id === row.sourceId);
      return { caseId: row.id, evidenceFingerprint: row.evidenceFingerprint, status: 'reconciled',
        verificationFingerprint: 'd'.repeat(64), mapping: {
          salesforce_object: item.source_object, salesforce_id: item.source_id,
          xero_document_id: item.xero_document_id, xero_document_type: item.source_payload.xeroType, xero_document_number: item.source_document_number,
          xero_contact_id: contact, xero_status: item.xero_document_status, source_fingerprint: item.source_payload.sourceFingerprint,
          financial_fingerprint: item.source_payload.financialFingerprint, protected_legacy: true,
          retained_differences: { campaignLink: { verified: true } },
        } };
    }),
  };
  h.started = async () => {
    const campaign = await h.create();
    const prepared = await h.prepare(campaign);
    const approved = await h.approve(prepared);
    return { campaign, prepared, approved, claim: await h.claim(approved) };
  };
  return h;
}

async function saveRun(h, fixture) {
  await h.db.query(`insert into xero_financial_sync_runs(id,idempotency_key,mode,status,revision,created_at,control_totals)
    values($1,$2,'preview','ready_for_review',1,$3,$4)`,[fixture.run.id,`run-${fixture.run.id}`,fixture.run.created_at,JSON.stringify(fixture.run.control_totals)]);
  for(const item of fixture.items) {
    const entries=Object.entries(item);
    await h.db.query(`insert into xero_financial_sync_items(${entries.map(([key])=>key).join(',')}) values(${entries.map((_,i)=>'$'+(i+1)).join(',')})`,
      entries.map(([,value])=>value&&typeof value==='object'?JSON.stringify(value):value));
  }
}

test('complete inventory timeout remains RPC-local and preserves large evidence, authority and audit', async t => {
  const h = await harness(t);
  const { campaign, claim } = await h.started();
  const signature = 'public.xero_campaign_inventory_v1(uuid,uuid,uuid,jsonb)';
  const catalog = async () => (await h.db.query(`select oid,prosrc,proowner,prosecdef,proconfig,proacl
    from pg_proc where oid=$1::regprocedure`, [signature])).rows[0];
  const before = await catalog();
  await h.db.exec('reset role');
  await loadMigration(h.db, '20260930025541_xero_campaign_inventory_write_performance.sql');
  await h.db.exec('set role service_role');
  const after = await catalog();
  assert.deepEqual(after, { ...before, proconfig: [...before.proconfig, 'statement_timeout=45s'] });
  const inventory = { tenantId: tenant, complete: true, observedSince: '2026-09-30T03:00:00Z',
    documents: Array.from({ length: 1864 }, (_, index) => ({ id: String(index), evidence: 'x'.repeat(7200) })),
    contacts: Array.from({ length: 2378 }, (_, index) => ({ id: String(index) })), callCount: 1 };
  assert.ok(JSON.stringify(inventory).length > 13_000_000);
  await assert.rejects(h.rpc('inventory', [actor, campaign.id, randomUUID(), inventory]), /current claim/);
  await assert.rejects(h.rpc('inventory', [actor, campaign.id, claim.batch.claim_id, { ...inventory, complete: false }]), /complete verified/);
  const start = Date.now();
  const saved = await h.rpc('inventory', [actor, campaign.id, claim.batch.claim_id, inventory]);
  assert.equal(saved.complete, true);
  assert.deepEqual((await h.db.query('select inventory from xero_reconciliation_campaigns where id=$1', [campaign.id])).rows[0].inventory, inventory);
  const events = (await h.db.query(`select evidence, encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') expected
    from xero_reconciliation_events where campaign_id=$2 and event_type='inventory_refreshed'`, [JSON.stringify(inventory), campaign.id])).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].evidence.fingerprint, events[0].expected);
  assert.equal((await h.db.query('select claim_id from xero_reconciliation_batches where id=$1', [claim.batch.id])).rows[0].claim_id, claim.batch.claim_id);
  t.diagnostic(JSON.stringify({ bytes: JSON.stringify(inventory).length, milliseconds: Date.now() - start,
    unchangedBodyAndAcl: true, providerCalls: 0, inventoryEvents: events.length }));
});

async function claimCategory(h, category) {
  const campaign=await h.create(), ids=h.cases.filter(row=>row.category===category).map(row=>row.id);
  const batch=await h.approve(await h.prepare(campaign,ids,category));
  return {campaign,claim:await h.claim(batch)};
}

async function operationProof(h, campaign, claim, category='draft', { unknownPost=false }={}) {
  const row=claim.cases[0], item=h.items.find(item=>item.source_id===row.sourceId);
  const authority={campaignId:campaign.id,batchId:claim.batch.id,claimId:claim.batch.claim_id,
    tenantId:tenant,caseId:row.id,evidenceFingerprint:row.evidenceFingerprint};
  const audit=async(type,outcome,proof,actorId=actor)=>(await h.db.query(`insert into xero_financial_audit_events(event_type,outcome,actor_id,actor_email,fingerprints)
    values($1,$2,$3,'reviewer@example.test',$4) returning id`,[type,outcome,actorId,JSON.stringify(proof)])).rows[0].id;
  // Use actual shared admission and completion rather than a manufactured success row.
  const raw=async(name,values)=>(await h.db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result;
  const grant=await raw('xero_shared_authorize_probe',[tenant,randomUUID(),actor,new Date().toISOString(),'Explicit fixture probe']);
  const probe=await raw('xero_shared_admit',[tenant,randomUUID(),1,'GET','Organisations',null,'operation',grant.id]);
  await raw('xero_shared_observe',[tenant,probe.requestId,200,{dayRemaining:1000},false]);
  const budget=await raw('xero_shared_reserve',[tenant,randomUUID(),`campaign:${campaign.id}:${claim.batch.id}:${claim.batch.claim_id}`,1,1,600]);
  const intent={...authority,postRequestId:randomUUID(),postBudgetId:budget.id,postTokenVersion:1,
    ...(category==='contact'?{proposal:row.contactProposal,sourceFingerprint:row.contactEvidence.sourceFingerprint}
      :{itemId:item.id,sourceFingerprint:item.source_payload.sourceFingerprint,financialFingerprint:item.source_payload.financialFingerprint,proposedPayload:item.proposed_payload})};
  const intentId=await audit(`campaign_${category==='contact'?'contact':'document'}_intent`,'intent',intent);
  const post=await raw('xero_shared_admit',[tenant,intent.postRequestId,1,'POST',category==='contact'?'Contacts':'Invoices',budget.id,'operation',null]);
  await raw('xero_shared_observe',[tenant,post.requestId,unknownPost?500:200,{},unknownPost]);
  // The WASM clock has millisecond precision; preserve real ordering for the strict readback boundary.
  if (!nativeUrl) await new Promise(resolve=>setTimeout(resolve,2));
  const readback=await raw('xero_shared_admit',[tenant,randomUUID(),1,'GET',category==='contact'?'Contacts':'Invoices',budget.id,'verification',null]);
  await raw('xero_shared_observe',[tenant,readback.requestId,200,{},false]);
  const targetId=category==='contact'&&row.targetId?row.targetId:randomUUID(), mapping=category==='draft'?{
    salesforce_object:item.source_object,salesforce_id:item.source_id,xero_document_id:targetId,xero_document_type:'ACCREC',
    xero_document_number:item.source_document_number,xero_contact_id:contact,xero_status:'DRAFT',
    source_fingerprint:item.source_payload.sourceFingerprint,financial_fingerprint:item.source_payload.financialFingerprint,
    protected_legacy:false,retained_differences:{campaignDraft:{verified:true}},
  }:null;
  const verified={...authority,intentId,originalIntentId:intentId,postRequestId:intent.postRequestId,verificationRequestId:readback.requestId,verificationFingerprint:'d'.repeat(64),
    ...(category==='contact'?{sourceFingerprint:row.contactEvidence.sourceFingerprint,xeroContactId:targetId,
      verifiedContact:{ContactID:targetId,Name:row.contactProposal.Name,ContactStatus:'ACTIVE'}}:{itemId:item.id,targetId,mapping})};
  const receiptId=await audit(`campaign_${category==='contact'?'contact':'document'}_verified`,'verified',verified);
  const outcome={caseId:row.id,evidenceFingerprint:row.evidenceFingerprint,status:'reconciled',verificationFingerprint:'d'.repeat(64),receiptId,
    ...(category==='contact'?{xeroContactId:targetId}:{targetId,mapping})};
  return {intentId,receiptId,intent,verified,outcome,readback,budget,post};
}

function groupSource() {
  const common={IsDeleted:false,CreatedDate:'2026-01-02T00:00:00Z',LastModifiedDate:'2026-01-02T00:00:01Z',Date__c:'2026-01-02',
    Supplier_Invoice__c:null,Reference__c:null,Is_Deposit__c:false,Is_Volume_Discount__c:false,Commission_Invoice__c:null,
    CurrencyIsoCode:'USD',_currency:{currency:'USD',blockers:[]}};
  const parent={...common,Id:'a0S000000000001',Name:'Group receipt',RecordType:{DeveloperName:'Receivable_Remittance'},
    Account__c:'001000000000001',Amount__c:100,Bank__c:'UBS',Remittance__c:null,STEM__c:null};
  const child={...common,Id:'a0S000000000002',Name:'Allocation 1',RecordType:{DeveloperName:'Receivable'},
    Account__c:'001000000000002',Amount__c:100,Bank__c:null,Remittance__c:parent.Id,STEM__c:'a0H000000000001'};
  const account=(Id,Name,type,ParentId,company)=>({Id,IsDeleted:false,Name,RecordType:{DeveloperName:type},ParentId,
    Company_Code__c:company,Inactive_Suspended__c:false,LastModifiedDate:'2026-01-01T00:00:00Z'});
  const accounts=[account(parent.Account__c,'GROUP - TEST','Group',null,'GROUP - TEST'),
    account(child.Account__c,'Exact Maritime Ltd','Buyer_Supplier',parent.Account__c,'HK TEST')];
  const buyerDocumentInventories=[{stemId:child.STEM__c,complete:true,creditFields:['Is_Credit_Note__c'],records:[{
    Id:'a0K000000000001',IsDeleted:false,Name:'INV-1',STEM__c:child.STEM__c,STEM__r:{Account__c:child.Account__c},
    Amount__c:100,Proforma__c:false,Deprecated__c:false,Is_Credit_Note__c:false,CreatedDate:'2025-12-30T00:00:00Z',
    LastModifiedDate:'2026-01-01T00:00:00Z',Invoice_Date__c:'2025-12-30',Invoice_Due_Date__c:'2026-01-13',CurrencyIsoCode:'USD',_currency:{currency:'USD',blockers:[]}}]}];
  const result=resolveGroupRemittanceBankEvidence(child,{parent,siblings:[child],visiblePayments:[parent,child],accounts,buyerDocumentInventories,complete:true});
  assert.equal(result.eligible,true,result.blocker);return {child,evidence:result.evidence};
}

async function paymentFixture(t, { reference=false, group=false, existing=false }={}) {
  const h=await harness(t), source=group?groupSource():null;
  const mapping=await seedMapping(h,{retained_differences:{accountId:'001000000000002',stemId:'a0H000000000001'}});
  const bank={id:randomUUID(),salesforce_bank_name:'UBS',xero_bank_account_id:randomUUID(),revision:1,enabled:true};
  await h.db.query(`insert into xero_financial_bank_mappings(id,salesforce_bank_name,xero_bank_account_id,xero_bank_account_name,revision,enabled)
    values($1,'UBS',$2,'UBS USD',1,true)`,[bank.id,bank.xero_bank_account_id]);
  const document=Object.fromEntries(['id','salesforce_object','salesforce_id','xero_document_id','xero_document_type','xero_contact_id','source_fingerprint','retained_differences','protected_legacy'].map(key=>[key,mapping[key]]));
  const pay={salesforcePaymentId:source?.child.Id||'a0S000000000001',salesforcePaymentName:source?.child.Name||'PAY-1',
    action:reference?'payment_reference_link':'payment_link',status:'eligible',blockers:[],amount:100,currency:'USD',paymentDate:source?.child.Date__c||'2026-09-01',
    documentMappingId:mapping.id,xeroDocumentId:mapping.xero_document_id,xeroPaymentId:randomUUID(),bankAccountId:bank.xero_bank_account_id,
    sourceFingerprint:'e'.repeat(64),reviewFingerprint:'a'.repeat(64),
    ...(group?{bankSourceEvidence:source.evidence,documentMappingSnapshot:document,bankMappingSnapshot:bank}:{}),
    ...(reference?{referenceReviewFingerprint:'f'.repeat(64),retainedReferenceEvidence:{documentMapping:document,bankMapping:bank,sourceReference:null,xeroReference:'AP-1',sourceFallbackReference:'PAY-1'}}:{}),
  };
  h.run.control_totals.workflowSnapshot.payments.rows=[pay];await saveSnapshot(h,h.run.control_totals.workflowSnapshot);
  h.cases=buildReconciliationCases({tenantId:tenant,run:h.run,items:h.items,ownerId:actor});
  if(existing) await h.db.query(`insert into xero_financial_payment_mappings(salesforce_payment_id,salesforce_payment_name,document_mapping_id,xero_payment_id,
    xero_bank_account_id,source_fingerprint,amount,currency,payment_date,status,last_reconciled_at)
    values($1,'Historic payment',$2,$3,$4,$5,100,'USD',$6,'protected','2026-01-01')`,[pay.salesforcePaymentId,mapping.id,pay.xeroPaymentId,pay.bankAccountId,pay.sourceFingerprint,pay.paymentDate]);
  const campaign=await h.create(h.cases), row=h.cases.find(row=>row.sourceObject==='Payment__c');
  const claim=await h.claim(await h.approve(await h.prepare(campaign,[row.id])));
  const paymentMapping={salesforce_payment_id:pay.salesforcePaymentId,salesforce_payment_name:pay.salesforcePaymentName,document_mapping_id:mapping.id,
    xero_payment_id:pay.xeroPaymentId,xero_bank_account_id:pay.bankAccountId,source_fingerprint:pay.sourceFingerprint,amount:100,currency:'USD',payment_date:pay.paymentDate,status:'linked'};
  const proof=reference?reviewedPaymentReferenceRow(pay):group?validatedGroupPaymentRow(pay,{requireTarget:true}):null;
  const outcome={caseId:row.id,evidenceFingerprint:row.evidenceFingerprint,status:'reconciled',verificationFingerprint:'d'.repeat(64),paymentEvidence:pay,
    ...(proof?{[reference?'paymentReferenceRow':'groupPaymentRow']:{...proof,idempotencyKey:paymentPostingKey(tenant,pay.salesforcePaymentId)}}:{paymentMapping})};
  return {h,pay,claim,outcome};
}

async function saveSnapshot(h, snapshot) {
  await h.db.query('update public.xero_financial_sync_runs set control_totals=$2 where id=$1',
    [h.run.id, JSON.stringify({ workflowSnapshot: snapshot })]);
}

async function ownerQuery(h, sql, values) {
  await h.db.exec('reset role');
  try { return await h.db.query(sql, values); }
  finally { await h.db.exec('set role service_role'); }
}

async function seedMapping(h, overrides = {}) {
  const item = h.items[0];
  const mapping = { id: randomUUID(), salesforce_object: item.source_object, salesforce_id: item.source_id,
    salesforce_document_number: 'Historic original', document_kind: 'buyer_invoice', xero_document_type: 'ACCREC',
    xero_document_id: item.xero_document_id, xero_document_number: 'Historic target', xero_contact_id: contact,
    xero_status: 'PAID', source_fingerprint: item.source_payload.sourceFingerprint,
    financial_fingerprint: item.source_payload.financialFingerprint, protected_legacy: true,
    retained_differences: { issuedSupplierPreservation: { policyVersion: 'issued_petroleum_preserve_v1', original: 'preserve receipt' } },
    ...overrides };
  const entries = Object.entries(mapping);
  await h.db.query(`insert into public.xero_financial_document_mappings(${entries.map(([key]) => key).join(',')})
    values(${entries.map((_, index) => `$${index + 1}`).join(',')})`, entries.map(([, value]) =>
    value && typeof value === 'object' ? JSON.stringify(value) : value));
  return mapping;
}

test('campaign migration executes with inherited grants and exposes only service reads and RPCs', async (t) => {
  const h = await harness(t);
  const permissions = (await h.db.query(`select c.relname,c.relrowsecurity,
    has_table_privilege('service_role',c.oid,'SELECT') as readable,
    has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as writable,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_access,
    has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as user_access
    from pg_class c where c.relname = any($1) order by c.relname`, [tables])).rows;
  assert.equal(permissions.length, 4);
  assert.ok(permissions.every((row) => row.relrowsecurity && row.readable && !row.writable && !row.anon_access && !row.user_access));
  const functions = (await h.db.query(`select p.proname, p.prosecdef, p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_access,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as user_access,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_access
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'xero_campaign_%_v1'`)).rows;
  assert.ok(functions.length >= 7);
  assert.ok(functions.every((row) => row.prosecdef && row.service_access && !row.anon_access && !row.user_access));
  const campaign = await h.create();
  assert.equal(campaign.tenant_id, tenant);
  assert.deepEqual(await h.create(), campaign, 'Creating the same complete baseline is idempotent');
  for (const table of tables) {
    await assert.rejects(h.db.exec(`delete from public.${table}`), /permission denied/);
    await assert.rejects(h.db.exec(`truncate public.${table} cascade`), /permission denied/);
  }
  for (const role of ['anon', 'authenticated']) {
    await h.db.exec(`reset role; set role ${role}`);
    await assert.rejects(h.create(), /permission denied/);
    for (const table of tables) await assert.rejects(h.db.exec(`select * from public.${table}`), /permission denied/);
  }
});

test('baseline creation rejects incomplete, mismatched or missing document and payment snapshot evidence', async (t) => {
  const h = await harness(t);
  for (const [name, change] of [
    ['not complete', (s) => { s.complete = false; }],
    ['not link first', (s) => { s.linkFirst = false; }],
    ['payments omitted', (s) => { s.includePayments = false; }],
    ['wrong tenant', (s) => { s.tenantId = randomUUID(); }],
    ['wrong item count', (s) => { s.expectedItemCount = 2; }],
    ['missing item count', (s) => { delete s.expectedItemCount; }],
    ['null item count', (s) => { s.expectedItemCount = null; }],
    ['missing payment snapshot', (s) => { delete s.payments; }],
    ['wrong payment tenant', (s) => { s.payments.tenantId = randomUUID(); }],
    ['missing payment rows', (s) => { delete s.payments.rows; }],
  ]) await t.test(name, async () => {
    const snapshot = structuredClone(h.run.control_totals.workflowSnapshot);
    change(snapshot);
    await saveSnapshot(h, snapshot);
    await assert.rejects(h.create(), /complete|preview|snapshot|baseline/i);
    assert.equal((await h.rows('xero_reconciliation_campaigns')).length, 0);
  });
});

test('baseline requires all exact source cases and current revision, permission and tenant', async (t) => {
  const h = await harness(t);
  await assert.rejects(h.create(h.cases, 2), /unchanged|revision/i);
  await assert.rejects(h.create(h.cases, 1, randomUUID()), /access/i);
  await assert.rejects(h.create([]), /case|complete|baseline/i);
  const invented = structuredClone(h.cases);
  invented[0].sourceId = 'a0K999999999999';
  invented[0].id = invented[0].caseKey = `${tenant}:Invoice__c:${invented[0].sourceId}`;
  await assert.rejects(h.create(invented), /case|source|baseline|evidence/i);
  const owner = structuredClone(h.cases);
  owner[0].ownerId = randomUUID();
  await assert.rejects(h.create(owner), /owner/i);
  await h.db.exec('reset role');
  await h.db.query("update public.xero_contact_sync_connections set tenant_id=$1 where id='primary'", [randomUUID()]);
  await h.db.exec('set role service_role');
  await assert.rejects(h.create(), /tenant changed/i);
  assert.equal((await h.rows('xero_reconciliation_campaigns')).length, 0);
});

test('approval rejects stale revisions and changed fingerprints before a claim exists', async (t) => {
  const h = await harness(t), campaign = await h.create(), prepared = await h.prepare(campaign);
  await assert.rejects(h.approve(prepared, prepared.revision + 1), /revision|fingerprint/i);
  await assert.rejects(h.approve(prepared, prepared.revision, 'f'.repeat(64)), /revision|fingerprint/i);
  await assert.rejects(h.claim(prepared), /approved/i);
  const approved = await h.approve(prepared);
  await assert.rejects(h.approve(prepared), /revision|fingerprint/i);
  await assert.rejects(h.claim(approved, prepared.revision), /unchanged approved/i);
  assert.equal((await h.rows('xero_reconciliation_batches'))[0].status, 'approved');
  await h.db.exec('reset role');
  await h.db.query('update public.xero_reconciliation_cases set evidence_fingerprint=$1', ['e'.repeat(64)]);
  await h.db.exec('set role service_role');
  await assert.rejects(h.claim(approved), /unchanged approved|unchanged|evidence/i);
});

test('the fixed baseline includes every saved payment source as well as every document', async (t) => {
  const h = await harness(t, { payments: [{ salesforcePaymentId: 'a0S000000000001', action: 'payment_link',
    xeroPaymentId: randomUUID(), amount: 100, currency: 'USD', blockers: [], sourceFingerprint: 'e'.repeat(64) }] });
  const documents = h.cases.filter((row) => row.sourceObject !== 'Payment__c');
  await assert.rejects(h.create(documents), /complete|case|baseline/i);
  const wrongPayment = structuredClone(h.cases);
  const payment = wrongPayment.find((row) => row.sourceObject === 'Payment__c');
  payment.sourceId = 'a0S999999999999';
  payment.id = payment.caseKey = `${tenant}:Payment__c:${payment.sourceId}`;
  await assert.rejects(h.create(wrongPayment), /source|case/i);
  await h.create();
  assert.equal((await h.rows('xero_reconciliation_cases')).length, 2);
});

test('the first five sample invoices, bills, payments and paid states before later claims of twenty-five without stale approval bypass', async (t) => {
  const h = await harness(t, { count: 34, configureItems: (items) => {
    for (const [index, item] of items.entries()) {
      const supplier = index >= 20, paid = index >= 10 && index < 20 || index >= 30;
      item.source_object = supplier ? 'Supplier_Invoice__c' : 'Invoice__c';
      item.source_type = supplier ? 'supplier_bill' : 'buyer_invoice';
      item.row_key = `${item.source_object}:${item.source_id}`;
      Object.assign(item.source_payload, { salesforceObject: item.source_object,
        documentKind: item.source_type, xeroType: supplier ? 'ACCPAY' : 'ACCREC' });
      item.xero_document_status = item.xero_payload.status = paid ? 'PAID' : 'AUTHORISED';
    }
  } });
  const mapping = await seedMapping(h), bankId = randomUUID();
  await h.db.query(`insert into xero_financial_bank_mappings(salesforce_bank_name,xero_bank_account_id,xero_bank_account_name)
    values('UBS',$1,'UBS USD')`, [bankId]);
  const pay = { salesforcePaymentId: 'a0S000000000001', salesforcePaymentName: 'PAY-1', action: 'payment_link', status: 'eligible',
    blockers: [], amount: 100, currency: 'USD', paymentDate: '2026-09-01', documentMappingId: mapping.id,
    xeroDocumentId: mapping.xero_document_id, xeroPaymentId: randomUUID(), bankAccountId: bankId,
    sourceFingerprint: 'e'.repeat(64), reviewFingerprint: 'a'.repeat(64) };
  h.run.control_totals.workflowSnapshot.payments.rows = [pay];
  await saveSnapshot(h, h.run.control_totals.workflowSnapshot);
  h.cases = buildReconciliationCases({ tenantId: tenant, run: h.run, items: h.items, ownerId: actor });
  const campaign = await h.create(h.cases), approved = await h.approve(await h.prepare(campaign, h.cases.map(row => row.id)));
  const first = await h.claim(approved);
  assert.equal(first.cases.length, 5);
  assert.deepEqual(new Set(first.cases.map(row => row.sampleKey || row.sourceObject)), new Set([
    'Invoice__c:ACCREC:AUTHORISED', 'Invoice__c:ACCREC:PAID', 'Supplier_Invoice__c:ACCPAY:AUTHORISED',
    'Supplier_Invoice__c:ACCPAY:PAID', 'Payment__c',
  ]));
  const paymentCase = first.cases.find(row => row.sourceObject === 'Payment__c');
  const documentOutcomes = h.outcomes({ cases: first.cases.filter(row => row.sourceObject !== 'Payment__c') });
  const paymentOutcome = { caseId: paymentCase.id, evidenceFingerprint: paymentCase.evidenceFingerprint, status: 'reconciled',
    verificationFingerprint: 'd'.repeat(64), paymentEvidence: pay, paymentMapping: {
      salesforce_payment_id: pay.salesforcePaymentId, salesforce_payment_name: pay.salesforcePaymentName,
      document_mapping_id: mapping.id, xero_payment_id: pay.xeroPaymentId, xero_bank_account_id: bankId,
      source_fingerprint: pay.sourceFingerprint, amount: 100, currency: 'USD', payment_date: pay.paymentDate, status: 'linked',
    } };
  const partial = await h.finish(first, [...documentOutcomes, paymentOutcome]);
  assert.equal(partial.verified_count, 5);
  assert.equal((await h.rows('xero_financial_payment_mappings')).length, 1);
  const stale = h.cases.find(row => !first.batch.claim_case_ids.includes(row.id));
  await ownerQuery(h, 'update xero_reconciliation_cases set evidence_fingerprint=$1 where id=$2', ['f'.repeat(64), stale.id]);
  const second = await h.claim(partial);
  assert.equal(second.cases.length, 25);
  assert.equal(second.batch.evidence_fingerprint, approved.evidence_fingerprint);
  assert.ok(second.cases.every(row => row.id !== stale.id && !first.batch.claim_case_ids.includes(row.id)));
  assert.ok(second.cases.every(row => approved.evidence.some(saved => saved.id === row.id && saved.fingerprint === row.evidenceFingerprint)));
  const next = await h.finish(second, h.outcomes(second));
  assert.equal(next.verified_count, 30);
  const last = await h.claim(next);
  assert.equal(last.cases.length, 4);
  const incomplete = await h.finish(last, h.outcomes(last));
  assert.equal(incomplete.verified_count, 34);
  assert.equal(incomplete.status, 'partial');
  await assert.rejects(h.claim(incomplete), /No unchanged approved cases remain/i);
});

test('claims execute the first five, then at most twenty-five, with atomic links and audit outcomes', async (t) => {
  const h = await harness(t, { count: 31 }), { claim: first } = await h.started();
  assert.equal(first.recovering, false);
  assert.equal(first.cases.length, 5);
  assert.equal((await h.rows('xero_financial_document_mappings')).length, 0);
  const partial = await h.finish(first, h.outcomes(first));
  assert.equal(partial.status, 'partial');
  assert.equal(partial.verified_count, 5);
  assert.equal((await h.rows('xero_financial_document_mappings')).length, 5);
  const second = await h.claim(partial);
  assert.equal(second.cases.length, 25);
  assert.equal(second.cases.some((row) => first.batch.claim_case_ids.includes(row.id)), false);
  const next = await h.finish(second, h.outcomes(second));
  assert.equal(next.verified_count, 30);
  const third = await h.claim(next);
  assert.equal(third.cases.length, 1);
  const completed = await h.finish(third, h.outcomes(third));
  assert.equal(completed.status, 'completed');
  assert.equal(completed.verified_count, 31);
  assert.equal((await h.rows('xero_reconciliation_campaigns'))[0].status, 'completed');
  const mappings = await h.rows('xero_financial_document_mappings');
  const cases = await h.rows('xero_reconciliation_cases');
  const events = await h.rows('xero_reconciliation_events');
  assert.equal(mappings.length, 31);
  assert.equal(events.filter((row) => row.event_type === 'case_outcome').length, 31);
  for (const row of cases) {
    assert.equal(row.status, 'reconciled');
    assert.equal(mappings.find((mapping) => mapping.id === row.outcome.mappingId)?.salesforce_id, row.evidence.sourceId);
    assert.ok(events.some((event) => event.event_type === 'case_outcome' && event.evidence.mappingId === row.outcome.mappingId));
  }
  await assert.rejects(h.finish(third, h.outcomes(third)), /claim changed/i);
  await assert.rejects(h.db.exec('delete from public.xero_reconciliation_events'), /permission denied/);
  await h.db.exec('reset role');
  await assert.rejects(h.db.exec('delete from public.xero_reconciliation_events'), /append-only/);
});

test('an invalid final outcome rolls back earlier mapping, outcome and audit writes together', async (t) => {
  const h = await harness(t, { count: 2 }), { claim } = await h.started();
  const events = await h.rows('xero_reconciliation_events'), cases = await h.rows('xero_reconciliation_cases');
  const outcomes = h.outcomes(claim);
  outcomes[1].mapping.source_fingerprint = 'f'.repeat(64);
  await assert.rejects(h.finish(claim, outcomes), /proof|source|target/i);
  assert.equal((await h.rows('xero_financial_document_mappings')).length, 0);
  assert.deepEqual(await h.rows('xero_reconciliation_cases'), cases);
  assert.deepEqual(await h.rows('xero_reconciliation_events'), events);
  assert.equal((await h.rows('xero_reconciliation_batches'))[0].status, 'running');
  await h.finish(claim, h.outcomes(claim));
});

test('link confirmation rejects mismatched accounting document type', async (t) => {
  const h = await harness(t), { claim } = await h.started(), outcomes = h.outcomes(claim);
  outcomes[0].mapping.xero_document_type = 'ACCPAY';
  await assert.rejects(h.finish(claim, outcomes), /type|proof|source|target/i);
  assert.equal((await h.rows('xero_financial_document_mappings')).length, 0);
  assert.equal((await h.rows('xero_reconciliation_cases'))[0].status, 'ready');
});

test('existing protected mapping and its payment remain byte-identical after campaign confirmation', async (t) => {
  const h = await harness(t), mapping = await seedMapping(h);
  await h.db.query(`insert into public.xero_financial_payment_mappings(salesforce_payment_id,document_mapping_id,xero_payment_id,
    source_fingerprint,amount,currency,payment_date,status) values('a0S000000000001',$1,$2,$3,100,'USD','2026-09-01','protected')`,
  [mapping.id, randomUUID(), 'e'.repeat(64)]);
  const before = await h.rows('xero_financial_document_mappings'), payments = await h.rows('xero_financial_payment_mappings');
  const { claim } = await h.started();
  await h.finish(claim, h.outcomes(claim));
  assert.equal(JSON.stringify(await h.rows('xero_financial_document_mappings')), JSON.stringify(before));
  assert.equal(JSON.stringify(await h.rows('xero_financial_payment_mappings')), JSON.stringify(payments));
  assert.equal((await h.rows('xero_reconciliation_cases'))[0].outcome.mappingId, mapping.id);
});

test('a source cannot take a Xero target already owned by another mapping', async (t) => {
  const h = await harness(t);
  await seedMapping(h, { salesforce_id: 'a0K999999999999' });
  const before = await h.rows('xero_financial_document_mappings');
  const { claim } = await h.started();
  const events = await h.rows('xero_reconciliation_events');
  await assert.rejects(h.finish(claim, h.outcomes(claim)), /unique|conflict|owner|duplicate/i);
  assert.deepEqual(await h.rows('xero_financial_document_mappings'), before);
  assert.deepEqual(await h.rows('xero_reconciliation_events'), events);
  assert.equal((await h.rows('xero_reconciliation_cases'))[0].status, 'ready');
});

test('an interrupted claim recovers the same exact cases without duplicate claims or links', async (t) => {
  const h = await harness(t, { count: 7 }), { claim, approved } = await h.started();
  const events = await h.rows('xero_reconciliation_events');
  await assert.rejects(h.claim(approved), /unchanged approved/i);
  const recovered = await h.claim(claim.batch);
  assert.equal(recovered.recovering, true);
  assert.deepEqual(recovered.batch, claim.batch);
  assert.deepEqual(recovered.cases.map((row) => row.id).sort(), claim.cases.map((row) => row.id).sort());
  assert.deepEqual(await h.rows('xero_reconciliation_events'), events);
  assert.equal((await h.rows('xero_financial_document_mappings')).length, 0);
  await h.finish(recovered, h.outcomes(recovered));
  assert.equal((await h.rows('xero_financial_document_mappings')).length, 5);
});

test('running campaign blocks prior financial writers while preserving read-only preview persistence', async (t) => {
  const h = await harness(t), mapping = await seedMapping(h);
  await h.db.query(`insert into public.xero_financial_payment_mappings(salesforce_payment_id,document_mapping_id,xero_payment_id,
    source_fingerprint,amount,currency,payment_date,status) values('a0S000000000001',$1,$2,$3,100,'USD','2026-09-01','protected')`,
  [mapping.id, randomUUID(), 'e'.repeat(64)]);
  const { claim } = await h.started();
  for (const sql of [
    "insert into public.xero_financial_sync_runs(idempotency_key,mode,status) values('blocked-document','document_apply','processing')",
    "insert into public.xero_financial_sync_runs(idempotency_key,mode,status) values('blocked-payment','payment_apply','completed')",
    'update public.xero_financial_document_mappings set last_reconciled_at=now()',
    'update public.xero_financial_payment_mappings set last_reconciled_at=now()',
  ]) await assert.rejects(h.db.exec(sql), /reconciliation batch.*verification/i);
  await h.db.exec("insert into public.xero_financial_sync_runs(idempotency_key,mode,status) values('read-only','preview','ready_for_review')");
  await h.finish(claim, h.outcomes(claim));
  await h.db.exec("insert into public.xero_financial_sync_runs(idempotency_key,mode,status) values('after','payment_apply','completed')");
});

test('an unresolved prior payment operation prevents campaign claim', async (t) => {
  const h = await harness(t), campaign = await h.create(), approved = await h.approve(await h.prepare(campaign));
  await h.db.query(`insert into public.xero_financial_sync_runs(idempotency_key,mode,status,control_totals)
    values('prior','payment_apply','completed',$1)`, [JSON.stringify({ paymentPosting: { state: 'uncertain' } })]);
  await assert.rejects(h.claim(approved), /unresolved financial operation/i);
  assert.equal((await h.rows('xero_reconciliation_batches'))[0].status, 'approved');
});

test('real PostgreSQL concurrent payment writer waits for campaign claim then fails closed', { skip: !nativeUrl }, async (t) => {
  const h = await harness(t), campaign = await h.create(), approved = await h.approve(await h.prepare(campaign));
  const other = await h.connect();
  await other.query('set role service_role');
  const pid = (await other.query('select pg_backend_pid() as pid')).rows[0].pid;
  await h.db.exec('begin');
  const claim = await h.claim(approved);
  const pending = other.query("insert into public.xero_financial_sync_runs(idempotency_key,mode,status) values('concurrent','payment_apply','processing')")
    .then(() => null, (error) => error);
  let waited = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    waited = (await h.db.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) as waited", [pid])).rows[0].waited;
    if (waited) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(waited, true, 'The financial writer must wait on the shared lock before reading campaign state');
  await h.db.exec('commit');
  const error = await pending;
  assert.ok(error, 'The competing writer must not commit');
  assert.match(error.message, /reconciliation batch.*verification/i);
  await h.finish(claim, h.outcomes(claim));
});

test('real PostgreSQL reconnect waits for campaign finish and a completed reconnect rejects stale tenant writes', { skip: !nativeUrl }, async (t) => {
  const reconnect = (other, nextTenant) => other.query('select public.xero_reconnect_store($1,$2) as result', [1, JSON.stringify({
    tenantId: nextTenant, tenantName: 'Other fixture organisation', accessToken: 'test-only', refreshToken: 'test-only',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(), scope: 'accounting.invoices',
  })]);
  await t.test('finish pins the tenant until its financial transaction commits', async (child) => {
    const h = await harness(child), { claim } = await h.started(), other = await h.connect(), nextTenant = randomUUID();
    await other.query('set role service_role');
    const pid = (await other.query('select pg_backend_pid() as pid')).rows[0].pid;
    await h.db.exec('begin');
    await h.finish(claim, h.outcomes(claim));
    const pending = reconnect(other, nextTenant).then(result => ({ result }), error => ({ error }));
    let waited = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      waited = (await h.db.query("select exists(select 1 from pg_locks where pid=$1 and locktype in ('transactionid','tuple') and not granted) as waited", [pid])).rows[0].waited;
      if (waited) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(waited, true, 'Reconnection must wait for the checked tenant row lock');
    assert.equal((await h.db.query("select tenant_id from xero_contact_sync_connections where id='primary'")).rows[0].tenant_id, tenant);
    assert.equal((await h.rows('xero_financial_document_mappings')).length, 1);
    await h.db.exec('commit');
    const { result, error } = await pending;
    assert.equal(error, undefined);
    assert.equal(result.rows[0].result.tokenVersion, 2);
    assert.equal((await h.db.query("select tenant_id from xero_contact_sync_connections where id='primary'")).rows[0].tenant_id, nextTenant);
  });
  await t.test('reconnection committed first denies the stale campaign finish atomically', async (child) => {
    const h = await harness(child), { claim } = await h.started(), other = await h.connect();
    await other.query('set role service_role');
    await reconnect(other, randomUUID());
    const cases = await h.rows('xero_reconciliation_cases'), events = await h.rows('xero_reconciliation_events');
    await assert.rejects(h.finish(claim, h.outcomes(claim)), /tenant changed/i);
    assert.equal((await h.rows('xero_financial_document_mappings')).length, 0);
    assert.deepEqual(await h.rows('xero_reconciliation_cases'), cases);
    assert.deepEqual(await h.rows('xero_reconciliation_events'), events);
  });
});

test('refresh retains the fixed baseline, records changed evidence and segregates later activity without financial writes', async t => {
  const h=await harness(t), mapping=await seedMapping(h), campaign=await h.create();
  const prepared=await h.prepare(campaign), approved=await h.approve(prepared);
  const before=await h.rows('xero_financial_document_mappings');
  const fresh=fixtures(2); fresh.run.created_at='2026-09-30T01:00:00.000Z';
  fresh.items[0].xero_document_id=h.items[0].xero_document_id;
  fresh.items[0].source_payload.financialFingerprint='f'.repeat(64);
  fresh.cases=buildReconciliationCases({tenantId:tenant,run:fresh.run,items:fresh.items,ownerId:actor});
  await saveRun(h,fresh);
  const refresh=()=>h.rpc('refresh',[actor,campaign.id,campaign.revision,fresh.run.id,1,JSON.stringify(fresh.cases)]);
  const current=await refresh();
  assert.equal(current.run_id,campaign.run_id);assert.equal(current.baseline_at,campaign.baseline_at);
  assert.equal(current.review_run_id,fresh.run.id);assert.equal(current.revision,campaign.revision+1);
  const rows=await h.rows('xero_reconciliation_cases');
  assert.equal(rows.find(row=>row.id===h.cases[0].id).evidence_fingerprint,fresh.cases[0].evidenceFingerprint);
  const future=rows.find(row=>row.id===fresh.cases[1].id);
  assert.equal(future.category,'future_activity');assert.equal(future.status,'future_activity');
  await assert.rejects(refresh(),/changed|verification/i);
  await assert.rejects(h.rpc('refresh',[actor,current.id,current.revision,fresh.run.id,2,JSON.stringify(fresh.cases)]),/current|evidence/i);
  await assert.rejects(h.prepare(current,[future.id]),/no longer ready/i);
  await assert.rejects(h.claim(approved),/unchanged|approved|evidence/i);
  assert.deepEqual(await h.rows('xero_financial_document_mappings'),before);
  assert.equal(before[0].id,mapping.id);
  const events=await h.rows('xero_reconciliation_events');
  assert.ok(events.some(row=>row.event_type==='case_evidence_refreshed'&&row.evidence.previousEvidence.evidenceFingerprint===h.cases[0].evidenceFingerprint));
  assert.ok(events.some(row=>row.event_type==='campaign_evidence_refreshed'&&row.evidence.futureActivity===1));
  const missing=fixtures(0);await saveRun(h,missing);
  await h.rpc('refresh',[actor,current.id,current.revision,missing.run.id,1,'[]']);
  const absent=(await h.rows('xero_reconciliation_cases')).find(row=>row.id===h.cases[0].id);
  assert.equal(absent.status,'needs_decision');assert.match(absent.outcome.reason,/absent/i);
  assert.deepEqual(await h.rows('xero_financial_document_mappings'),before);
});

test('unchanged refresh preserves a verified baseline outcome and existing financial receipts',async t=>{
  const h=await harness(t),mapping=await seedMapping(h);
  await h.db.query(`insert into xero_financial_payment_mappings(salesforce_payment_id,document_mapping_id,xero_payment_id,
    source_fingerprint,amount,currency,payment_date,status) values('a0S000000000001',$1,$2,$3,100,'USD','2026-09-01','protected')`,
    [mapping.id,randomUUID(),'e'.repeat(64)]);
  const {claim}=await h.started();await h.finish(claim,h.outcomes(claim));
  const current=(await h.rows('xero_reconciliation_campaigns'))[0],before=(await h.rows('xero_reconciliation_cases'))[0];
  const mappings=await h.rows('xero_financial_document_mappings'),payments=await h.rows('xero_financial_payment_mappings');
  const fresh=fixtures(1);fresh.run.created_at='2026-09-30T01:00:00Z';
  fresh.items[0]={...structuredClone(h.items[0]),id:randomUUID(),run_id:fresh.run.id,status:'linked',idempotency_key:`item-${fresh.run.id}`};
  fresh.cases=buildReconciliationCases({tenantId:tenant,run:fresh.run,items:fresh.items,ownerId:actor});
  assert.equal(fresh.cases[0].evidenceFingerprint,before.evidence_fingerprint);
  await saveRun(h,fresh);await h.rpc('refresh',[actor,current.id,current.revision,fresh.run.id,1,JSON.stringify(fresh.cases)]);
  const after=(await h.rows('xero_reconciliation_cases'))[0];assert.equal(after.status,'reconciled');assert.deepEqual(after.outcome,before.outcome);
  assert.deepEqual(await h.rows('xero_financial_document_mappings'),mappings);assert.deepEqual(await h.rows('xero_financial_payment_mappings'),payments);
});

test('Contact baseline requires the exact saved Account family and finish requires exact journal/readback authority', async t => {
  const accounts=[1,2].map(n=>({id:`001${String(n).padStart(12,'0')}`,name:'Exact Maritime Ltd',companyCode:`CL-${n}`,inactiveSuspended:false,recordType:'Buyer'}));
  const contacts=buildCampaignContactCases({tenantId:tenant,accounts,contacts:[],complete:true,requiredAccountIds:[accounts[0].id],ownerId:actor,baselineAt:'2026-09-30T00:00:00.000Z'});
  assert.equal(contacts.length,1);assert.equal(contacts[0].sourceIds.length,2);
  const h=await harness(t,{count:0,contactCases:contacts});
  await assert.rejects(h.create([]),/complete|preview/i);
  const forged=structuredClone(h.cases);forged[0].contactProposal.accounts.pop();
  await assert.rejects(h.create(forged),/saved source/i);
  const {campaign,claim}=await claimCategory(h,'contact'), proof=await operationProof(h,campaign,claim,'contact');
  const before=await h.rows('xero_reconciliation_cases'), events=await h.rows('xero_reconciliation_events');
  const alter=async(id,proof)=>ownerQuery(h,'update xero_financial_audit_events set fingerprints=$2 where id=$1',[id,JSON.stringify(proof)]);
  for(const [label,change] of [
    ['wrong claim',p=>{p.claimId=randomUUID();}],['wrong tenant',p=>{p.tenantId=randomUUID();}],
    ['wrong case fingerprint',p=>{p.evidenceFingerprint='e'.repeat(64);}],['wrong verification fingerprint',p=>{p.verificationFingerprint='e'.repeat(64);}],
    ['wrong family',p=>{p.sourceFingerprint='e'.repeat(64);}],['wrong Contact identity',p=>{p.verifiedContact.ContactID=randomUUID();}],
    ['wrong legal name',p=>{p.verifiedContact.Name='Other Maritime Ltd';}],['inactive Contact',p=>{p.verifiedContact.ContactStatus='ARCHIVED';}],
  ]) await t.test(label,async()=>{
    const changed=structuredClone(proof.verified);change(changed);await alter(proof.receiptId,changed);
    await assert.rejects(h.finish(claim,[proof.outcome]),/journal|Contact proof/i);
    assert.deepEqual(await h.rows('xero_reconciliation_cases'),before);assert.deepEqual(await h.rows('xero_reconciliation_events'),events);
  });
  await alter(proof.receiptId,proof.verified);
  await ownerQuery(h,'update xero_financial_audit_events set actor_id=$2 where id=$1',[proof.receiptId,randomUUID()]);
  await assert.rejects(h.finish(claim,[proof.outcome]),/journal/i);
  await ownerQuery(h,'update xero_financial_audit_events set actor_id=$2 where id=$1',[proof.receiptId,actor]);
  const wrongIntent=structuredClone(proof.intent);wrongIntent.tenantId=randomUUID();await alter(proof.intentId,wrongIntent);
  await assert.rejects(h.finish(claim,[proof.outcome]),/intent|readback/i);
  wrongIntent.tenantId=tenant;wrongIntent.proposal.accounts.pop();await alter(proof.intentId,wrongIntent);
  await assert.rejects(h.finish(claim,[proof.outcome]),/Contact proof/i);
  await alter(proof.intentId,proof.intent);
  await h.db.query("update xero_shared_requests set resource_key='Invoices' where id=$1",[proof.readback.requestId]);
  await assert.rejects(h.finish(claim,[proof.outcome]),/intent|readback/i);
  await h.db.query("update xero_shared_requests set resource_key='Contacts' where id=$1",[proof.readback.requestId]);
  const completed=await h.finish(claim,[proof.outcome]);assert.equal(completed.verified_count,1);
  assert.equal((await h.rows('xero_reconciliation_cases'))[0].outcome.receiptId,proof.receiptId);
  assert.equal((await h.rows('xero_financial_document_mappings')).length,0);
  const fresh=fixtures(0);await saveRun(h,fresh);
  const current=(await h.rows('xero_reconciliation_campaigns'))[0];
  await h.rpc('refresh',[actor,current.id,current.revision,fresh.run.id,1,'[]']);
  assert.equal((await h.rows('xero_reconciliation_cases'))[0].status,'reconciled');
  assert.equal((await h.rows('xero_reconciliation_cases'))[0].outcome.receiptId,proof.receiptId);
});

test('draft finish binds generated audit IDs, exact source/payload/mapping and completed claim verification', async t => {
  const h=await harness(t,{draft:true}),{campaign,claim}=await claimCategory(h,'draft');
  const proof=await operationProof(h,campaign,claim);
  const before=await h.rows('xero_reconciliation_cases'),events=await h.rows('xero_reconciliation_events');
  await assert.rejects(h.rpc('finish',[actor,claim.batch.id,randomUUID(),JSON.stringify([proof.outcome])]),/claim changed/i);
  await assert.rejects(h.finish(claim,[{...proof.outcome,receiptId:'999999999'}]),/journal/i);
  for(const [label,change] of [
    ['wrong source',p=>{p.mapping.salesforce_id='a0K999999999999';}],
    ['wrong target',p=>{p.targetId=randomUUID();}],['authorised instead of draft',p=>{p.mapping.xero_status='AUTHORISED';}],
    ['wrong contact',p=>{p.mapping.xero_contact_id=randomUUID();}],['wrong financial evidence',p=>{p.mapping.financial_fingerprint='e'.repeat(64);}],
  ]) await t.test(label,async()=>{
    const changed=structuredClone(proof.outcome);change(changed);
    await assert.rejects(h.finish(claim,[changed]),/proof|authority/i);
    assert.equal((await h.rows('xero_financial_document_mappings')).length,0);
    assert.deepEqual(await h.rows('xero_reconciliation_cases'),before);assert.deepEqual(await h.rows('xero_reconciliation_events'),events);
  });
  const wrongIntent=structuredClone(proof.intent);wrongIntent.proposedPayload.LineItems[0].UnitAmount=999;
  await ownerQuery(h,'update xero_financial_audit_events set fingerprints=$2 where id=$1',[proof.intentId,JSON.stringify(wrongIntent)]);
  await assert.rejects(h.finish(claim,[proof.outcome]),/proof|authority/i);
  await ownerQuery(h,'update xero_financial_audit_events set fingerprints=$2 where id=$1',[proof.intentId,JSON.stringify(proof.intent)]);
  await h.db.query("update xero_shared_requests set response_status=503 where id=$1",[proof.readback.requestId]);
  await assert.rejects(h.finish(claim,[proof.outcome]),/intent|readback/i);
  await h.db.query("update xero_shared_requests set response_status=200,admitted_at='2020-01-01' where id=$1",[proof.readback.requestId]);
  await assert.rejects(h.finish(claim,[proof.outcome]),/intent|readback/i);
  await h.db.query('update xero_shared_requests set admitted_at=clock_timestamp() where id=$1',[proof.readback.requestId]);
  await h.db.query('update xero_shared_budgets set owner_key=$2 where id=$1',[proof.budget.id,`campaign:${campaign.id}:${claim.batch.id}:${randomUUID()}`]);
  await assert.rejects(h.finish(claim,[proof.outcome]),/intent|readback/i);
  await h.db.query('update xero_shared_budgets set owner_key=$2 where id=$1',[proof.budget.id,`campaign:${campaign.id}:${claim.batch.id}:${claim.batch.claim_id}`]);
  const completed=await h.finish(claim,[proof.outcome]);assert.equal(completed.verified_count,1);
  const mapping=(await h.rows('xero_financial_document_mappings'))[0];
  assert.equal(mapping.xero_document_id,proof.outcome.targetId);assert.equal(mapping.xero_status,'DRAFT');assert.equal(mapping.protected_legacy,false);
  const item=(await h.rows('xero_financial_sync_items'))[0];assert.equal(item.status,'created');assert.equal(item.xero_document_id,mapping.xero_document_id);
});

test('Contact restoration must verify the approved archived Contact identity',async t=>{
  const accounts=[{id:'001000000000001',name:'Exact Maritime Ltd',companyCode:'CL-1',inactiveSuspended:false,recordType:'Buyer'}];
  const contacts=buildCampaignContactCases({tenantId:tenant,accounts,contacts:[{id:contact,name:accounts[0].name,status:'ARCHIVED',accountNumber:'',contactNumber:''}],
    complete:true,requiredAccountIds:[accounts[0].id],ownerId:actor,baselineAt:'2026-09-30T00:00:00.000Z'});
  assert.equal(contacts[0].contactProposal.action,'restore');
  const h=await harness(t,{count:0,contactCases:contacts}),{campaign,claim}=await claimCategory(h,'contact');
  const proof=await operationProof(h,campaign,claim,'contact'),wrong=structuredClone(proof.verified),target=randomUUID();
  wrong.xeroContactId=target;wrong.verifiedContact.ContactID=target;
  await ownerQuery(h,'update xero_financial_audit_events set fingerprints=$2 where id=$1',[proof.receiptId,JSON.stringify(wrong)]);
  await assert.rejects(h.finish(claim,[{...proof.outcome,xeroContactId:target}]),/Contact proof/i);
  await ownerQuery(h,'update xero_financial_audit_events set fingerprints=$2 where id=$1',[proof.receiptId,JSON.stringify(proof.verified)]);
  await h.finish(claim,[proof.outcome]);
  assert.equal((await h.rows('xero_reconciliation_cases'))[0].outcome.xeroContactId,contact);
});

test('Contact and draft finishes bind exact original POST admission, budget, token and successful outcome', async t => {
  for (const category of ['contact','draft']) await t.test(category, async child => {
    const accounts=[{id:'001000000000001',name:'Exact Maritime Ltd',companyCode:'CL-1',inactiveSuspended:false,recordType:'Buyer'}];
    const contactCases=buildCampaignContactCases({tenantId:tenant,accounts,contacts:[],complete:true,
      requiredAccountIds:[accounts[0].id],ownerId:actor,baselineAt:'2026-09-30T00:00:00.000Z'});
    const h=await harness(child,category==='contact'?{count:0,contactCases}:{draft:true});
    const {campaign,claim}=await claimCategory(h,category), proof=await operationProof(h,campaign,claim,category);
    const changeIntent=async change=>{const intent=structuredClone(proof.intent);change(intent);
      await ownerQuery(h,'update xero_financial_audit_events set fingerprints=$2 where id=$1',[proof.intentId,JSON.stringify(intent)]);};
    const changeJournal=async change=>{const journal=structuredClone(proof.verified);change(journal);
      await ownerQuery(h,'update xero_financial_audit_events set fingerprints=$2 where id=$1',[proof.receiptId,JSON.stringify(journal)]);};
    const before=await h.rows('xero_reconciliation_cases'), events=await h.rows('xero_reconciliation_events');
    for(const [label,change] of [
      ['no admission',async()=>{const id=randomUUID();await changeIntent(p=>{p.postRequestId=id;});await changeJournal(p=>{p.postRequestId=id;});}],
      ['GET substituted for POST',async()=>{await changeIntent(p=>{p.postRequestId=proof.readback.requestId;});await changeJournal(p=>{p.postRequestId=proof.readback.requestId;});}],
      ['swapped verified POST ID',()=>changeJournal(p=>{p.postRequestId=randomUUID();})],
      ['swapped original budget',()=>changeIntent(p=>{p.postBudgetId=randomUUID();})],
      ['swapped token version',()=>changeIntent(p=>{p.postTokenVersion=2;})],
      ['missing token version',()=>changeIntent(p=>{delete p.postTokenVersion;})],
      ['string token version',()=>changeIntent(p=>{p.postTokenVersion='1';})],
      ['POST admitted before intent',()=>h.db.query("update xero_shared_requests set admitted_at='2020-01-01' where id=$1",[proof.post.requestId])],
      ['wrong resource',()=>h.db.query("update xero_shared_requests set resource_key='Payments' where id=$1",[proof.post.requestId])],
      ['wrong phase',()=>h.db.query("update xero_shared_requests set phase='verification' where id=$1",[proof.post.requestId])],
      ['rejected POST',()=>h.db.query('update xero_shared_requests set response_status=400 where id=$1',[proof.post.requestId])],
      ['unobserved POST',()=>h.db.query('update xero_shared_requests set response_status=null where id=$1',[proof.post.requestId])],
      ['unresolved POST',()=>h.db.query("update xero_shared_requests set response_status=500,outcome_unknown=true where id=$1",[proof.post.requestId])],
      ['verification before POST',()=>h.db.query('update xero_shared_requests set admitted_at=(select admitted_at from xero_shared_requests where id=$2) where id=$1',[proof.readback.requestId,proof.post.requestId])],
      ['verification before POST outcome',()=>h.db.query("update xero_shared_requests set completed_at=clock_timestamp()+interval '1 hour' where id=$1",[proof.post.requestId])],
    ]) await child.test(label, async()=>{
      await h.db.exec('begin');
      try {await change();await assert.rejects(h.finish(claim,[proof.outcome]),/POST admission|POST receipt/i);}
      finally {await h.db.exec('rollback');}
      assert.equal((await h.rows('xero_financial_document_mappings')).length,0);
      assert.deepEqual(await h.rows('xero_reconciliation_cases'),before);assert.deepEqual(await h.rows('xero_reconciliation_events'),events);
    });
    assert.equal((await h.finish(claim,[proof.outcome])).verified_count,1);
  });
});

test('resolved original POST receipt remains eligible after repeated verified recovery under the same exact intent', async t => {
  for(const category of ['contact','draft']) await t.test(category,async child=>{
    const accounts=[{id:'001000000000001',name:'Exact Maritime Ltd',companyCode:'CL-1',inactiveSuspended:false,recordType:'Buyer'}];
    const contactCases=buildCampaignContactCases({tenantId:tenant,accounts,contacts:[],complete:true,
      requiredAccountIds:[accounts[0].id],ownerId:actor,baselineAt:'2026-09-30T00:00:00.000Z'});
    const h=await harness(child,category==='contact'?{count:0,contactCases}:{draft:true}), {campaign,claim}=await claimCategory(h,category);
    const proof=await operationProof(h,campaign,claim,category,{unknownPost:true});
    await assert.rejects(h.finish(claim,[proof.outcome]),/POST receipt/i);
    await h.db.query('select xero_shared_resolve_unknown($1,$2,$3,$4)',[tenant,proof.post.requestId,proof.readback.requestId,`xero_financial_audit_events:${proof.receiptId}`]);
    const resource=category==='contact'?'Contacts':'Invoices', budgetId=randomUUID(), verificationId=randomUUID();
    await h.db.query('select xero_shared_reserve($1,$2,$3,0,1,600)',[tenant,budgetId,`campaign:${campaign.id}:${claim.batch.id}:${claim.batch.claim_id}`]);
    await h.db.query("select xero_shared_admit($1,$2,1,'GET',$3,$4,'verification',null)",[tenant,verificationId,resource,budgetId]);
    await h.db.query("select xero_shared_observe($1,$2,200,'{}',false)",[tenant,verificationId]);
    const repeated={...proof.verified,verificationRequestId:verificationId};
    const receiptId=(await h.db.query(`insert into xero_financial_audit_events(event_type,outcome,actor_id,fingerprints)
      values($1,'verified',$2,$3) returning id`,[category==='contact'?'campaign_contact_verified':'campaign_document_verified',actor,JSON.stringify(repeated)])).rows[0].id;
    const outcome={...proof.outcome,receiptId};
    for(const [label,change] of [
      ['unrelated resolution audit',()=>ownerQuery(h,'update xero_financial_audit_events set fingerprints=$2 where id=$1',
        [proof.receiptId,JSON.stringify({...proof.verified,claimId:randomUUID()})])],
      ['unrelated resolved target',()=>ownerQuery(h,'update xero_financial_audit_events set fingerprints=$2 where id=$1',
        [proof.receiptId,JSON.stringify({...proof.verified,[category==='contact'?'xeroContactId':'targetId']:randomUUID()})])],
      ['non-GET resolution receipt',()=>h.db.query('update xero_shared_requests set resolution_request_id=$2 where id=$1',[proof.post.requestId,proof.post.requestId])],
    ]) await child.test(label,async()=>{
      await h.db.exec('begin');
      try {await change();await assert.rejects(h.finish(claim,[outcome]),/POST receipt/i);}
      finally {await h.db.exec('rollback');}
    });
    assert.equal((await h.finish(claim,[outcome])).verified_count,1);
    const post=(await h.db.query('select state,outcome_unknown,resolution_request_id from xero_shared_requests where id=$1',[proof.post.requestId])).rows[0];
    assert.equal(post.state,'complete');assert.equal(post.outcome_unknown,false);assert.equal(post.resolution_request_id,proof.readback.requestId);
  });
});

test('ordinary payment finish binds approved amounts and preserves existing mappings byte-for-byte',async t=>{
  for(const existing of [false,true]) await t.test(existing?'existing protected receipt':'new exact link',async child=>{
    const {h,pay,claim,outcome}=await paymentFixture(child,{existing});
    const before=await h.rows('xero_financial_payment_mappings'),documents=await h.rows('xero_financial_document_mappings');
    const wrong=structuredClone(outcome);wrong.paymentMapping.amount=999;
    await assert.rejects(h.finish(claim,[wrong]),/exact approved|original financial/i);
    assert.deepEqual(await h.rows('xero_financial_payment_mappings'),before);
    await h.finish(claim,[outcome]);
    const after=await h.rows('xero_financial_payment_mappings');
    if(existing) assert.deepEqual(after,before);
    else {assert.equal(after.length,1);assert.equal(after[0].amount,100);assert.equal(after[0].xero_payment_id,pay.xeroPaymentId);}
    assert.deepEqual(await h.rows('xero_financial_document_mappings'),documents);
  });
});

test('reference and Group finish invoke their original proof transactions and reject altered approved payment inputs',async t=>{
  for(const reference of [true,false]) await t.test(reference?'reference proof RPC':'Group proof RPC',async child=>{
    const {h,pay,claim,outcome}=await paymentFixture(child,{reference,group:!reference});
    const key=reference?'paymentReferenceRow':'groupPaymentRow',documents=await h.rows('xero_financial_document_mappings');
    const runs=await h.rows('xero_financial_sync_runs'),audits=await h.rows('xero_financial_audit_events');
    for(const [label,change] of [
      ['other source',row=>{row.salesforcePaymentId='a0S999999999999';row.idempotencyKey=paymentPostingKey(tenant,row.salesforcePaymentId);}],
      ['other target',row=>{row.xeroPaymentId=randomUUID();}],['other amount',row=>{row.amount=99;}],
      ['other currency',row=>{row.currency='EUR';}],['other date',row=>{row.paymentDate='2026-09-02';}],
      ...(reference?[['other review',row=>{row.referenceReviewFingerprint='b'.repeat(64);}],
        ['other reference evidence',row=>{row.retainedReferenceEvidence.xeroReference='OTHER-AP';}]]:[]),
    ]) await child.test(label,async()=>{
      const wrong=structuredClone(outcome);change(wrong[key]);
      await h.db.exec('begin');
      try { await assert.rejects(h.finish(claim,[wrong]),/proof|claimed|approved|raw allocation|evidence/i); }
      finally { await h.db.exec('rollback'); }
      assert.equal((await h.rows('xero_financial_payment_mappings')).length,0);
      assert.deepEqual(await h.rows('xero_financial_sync_runs'),runs);assert.deepEqual(await h.rows('xero_financial_audit_events'),audits);
    });
    await h.finish(claim,[outcome]);
    const saved=(await h.rows('xero_financial_payment_mappings'))[0];assert.equal(saved.xero_payment_id,pay.xeroPaymentId);assert.equal(saved.amount,100);
    if(reference) assert.deepEqual(saved.retained_reference.evidence,pay.retainedReferenceEvidence);
    else assert.deepEqual(saved.bank_source_evidence,pay.bankSourceEvidence);
    assert.deepEqual(await h.rows('xero_financial_document_mappings'),documents);
    const posting=(await h.rows('xero_financial_sync_runs')).find(run=>run.mode==='payment_apply');
    assert.equal(posting.control_totals.paymentPosting.state,reference?'reference_linked':'group_linked');
    assert.ok((await h.rows('xero_financial_audit_events')).some(event=>event.event_type===(reference?'payment_reference_linked':'group_payment_linked')));
    const caseRow=(await h.rows('xero_reconciliation_cases')).find(row=>row.evidence.sourceObject==='Payment__c');
    assert.equal(caseRow.outcome.receiptId,saved.id);assert.equal(caseRow.outcome.originalReceipt.outcomes[0].status,'linked');
  });
});
