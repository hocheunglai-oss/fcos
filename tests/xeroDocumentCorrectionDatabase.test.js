import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { claimDocumentCorrection, finishDocumentCorrection, documentCorrectionCanonical as canonical, documentCorrectionHash as hash } from '../api/_xeroDocumentCorrectionPersistence.js';

const actor={id:'00000000-0000-4000-8000-000000000099',email:'finance@example.com'};
const ids={tenant:'00000000-0000-4000-8000-000000000001',invoice:'00000000-0000-4000-8000-000000000002',contact:'00000000-0000-4000-8000-000000000003',line:'00000000-0000-4000-8000-000000000004',mapping:'00000000-0000-4000-8000-000000000005'};
const migrations=['20260827145608_xero_contact_sync.sql','20260829080726_xero_financial_sync.sql',
  '20260923222821_xero_grouped_preservation_link.sql','20260927175805_xero_issued_supplier_preservation_link.sql',
  '20260928053229_xero_document_field_correction_journal.sql'];
const copy=structuredClone;
function fixture(type='ACCPAY',paid=false) {
  const before={InvoiceID:ids.invoice,Type:type,Status:paid?'PAID':'AUTHORISED',Contact:{ContactID:ids.contact},CurrencyCode:'USD',
    Date:'2026-02-02',DueDate:'2026-03-02',InvoiceNumber:'historic-number',Reference:'historic reference',Total:100,SubTotal:100,TotalTax:0,
    AmountPaid:paid?100:0,AmountCredited:0,AmountDue:paid?0:100,LineAmountTypes:'NoTax',Payments:paid?[{PaymentID:randomUUID(),Amount:100}]:[],CreditNotes:[],
    LineItems:[{LineItemID:ids.line,Description:'historic description',Quantity:2,UnitAmount:50,LineAmount:100,TaxAmount:0,AccountCode:type==='ACCPAY'?'51100':'41100',TaxType:'NONE',Tracking:[]}]};
  const source={object:type==='ACCPAY'?'Supplier_Invoice__c':'Invoice__c',id:type==='ACCPAY'?'a06000000000001':'a0K000000000001',accountId:'001000000000001',stemId:'a0H000000000001',
    sourceFingerprint:'a'.repeat(64),financialFingerprint:'b'.repeat(64),deliveryDate:'2026-02-02',documentNumber:'source-2026-1',documentKind:type==='ACCPAY'?'supplier_bill':'buyer_invoice',xeroType:type,contactId:ids.contact,currency:'USD',total:100};
  const header={Date:source.deliveryDate,DueDate:'2026-03-03',InvoiceNumber:'new-number',...(type==='ACCREC'?{Reference:'VESSEL'}:{})};
  const description=type==='ACCREC'?'INVOICE 2/2/2026':'2/2/2026';
  const expectedAfter={...copy(before),...header};expectedAfter.LineItems[0].Description=description;
  return {policyVersion:'document_field_correction_v1',source,before,expectedAfter,projection:{header,lineDescriptions:{[ids.line]:description}},
    authority:{basis:'explicit_user_requested_2026_field_correction',scopeHash:'c'.repeat(64),reviewedAt:'2026-09-28T05:00:00.000Z'},mappingSnapshot:null};
}
async function database(t) {
  const url=process.env.FCOS_CORRECTION_TEST_DATABASE_URL || process.env.FCOS_GROUPED_TEST_DATABASE_URL;
  if (!url) { const db=new PGlite();t.after(()=>db.close());await db.exec('create role anon;create role authenticated;create role service_role bypassrls');return {db}; }
  const endpoint=new URL(url);assert.ok(['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname));assert.ok(['postgres:','postgresql:'].includes(endpoint.protocol));
  const admin=new pg.Client({connectionString:endpoint.toString()});await admin.connect();const name=`fcos_correction_${randomUUID().replaceAll('-','')}`;
  await admin.query(`create database "${name}"`);endpoint.pathname=`/${name}`;
  const clients=[];const connect=async()=>{const c=new pg.Client({connectionString:endpoint.toString()});await c.connect();await c.query("set statement_timeout='8s';set lock_timeout='4s'");clients.push(c);return c;};
  const primary=await connect();const db={query:(...args)=>primary.query(...args),exec:sql=>primary.query(sql)};
  t.after(async()=>{for(const c of clients){await c.query('rollback').catch(()=>{});await c.end();}await admin.query(`drop database "${name}" with(force)`);await admin.end();});
  return {db,connect};
}
function rpcClient(db) {
  return {lastError:null,async rpc(name,body){
    assert.ok(['claim_xero_document_field_correction_v1','finish_xero_document_field_correction_v1'].includes(name));
    const entries=Object.entries(body), values=entries.map(([key,value])=>key==='p_evidence'?JSON.stringify(value):value);
    try {const result=await db.query(`select public.${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')}) as result`,values);return {data:result.rows[0].result,error:null};}
    catch(error){this.lastError=error;return {data:null,error};}
  }};
}
async function harness(t,{mapped=false,type='ACCPAY',paid=false}={}) {
  const {db,connect}=await database(t);
  for(const name of migrations) await db.exec((await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')).replace(/^create extension if not exists pgcrypto;$/m,''));
  await db.query("insert into public.xero_contact_sync_connections(tenant_id,refresh_token)values($1,'test-only')",[ids.tenant]);
  const evidence=fixture(type,paid);
  if(mapped){await db.query(`insert into public.xero_financial_document_mappings(id,salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,xero_contact_id,source_fingerprint,financial_fingerprint,protected_legacy,retained_differences)
    values($1,$2,$3,'historic',$4,$5,$6,$7,$8,$9,true,$10)`,[ids.mapping,evidence.source.object,evidence.source.id,evidence.source.documentKind,type,ids.invoice,ids.contact,'a'.repeat(64),'b'.repeat(64),JSON.stringify({issuedSupplierPreservation:{policyVersion:'issued_petroleum_preserve_v1',original:'retained'}})]);
    evidence.mappingSnapshot=(await db.query('select to_jsonb(m) as m from public.xero_financial_document_mappings m')).rows[0].m;
    await db.query(`insert into public.xero_financial_payment_mappings(salesforce_payment_id,document_mapping_id,xero_payment_id,source_fingerprint,amount,currency,payment_date,status)values('a0S000000000001',$1,$2,$3,100,'USD','2026-02-02','protected')`,[ids.mapping,randomUUID(),'d'.repeat(64)]);
  }
  await db.exec('grant usage on schema public to service_role;set role service_role');
  const client=rpcClient(db),args={tenantId:ids.tenant,xeroInvoiceId:ids.invoice,mappingId:mapped?ids.mapping:null,idempotencyKey:'correction-test',evidence,actor};
  return {db,connect,client,args,evidence,claim:async()=>{try{return await claimDocumentCorrection(client,args);}catch(error){error.message+=` [SQL: ${client.lastError?.message || 'none'}]`;throw error;}},finish:(claim,status='confirmed',proof)=>finishDocumentCorrection(client,{claimId:claim.id,status,actor,evidence:proof||{basis:'exact_provider_readback',observed:copy(evidence.expectedAfter)}}),
    rows:async table=>(await db.query(`select to_jsonb(t) as row from public.${table} t`)).rows.map(r=>r.row)};
}

for(const type of ['ACCREC','ACCPAY']) for(const paid of [false,true]) test(`${type} ${paid?'paid':'unpaid'} exact nonfinancial correction preserves originals and replay`,async t=>{
  const h=await harness(t,{mapped:true,type,paid}),before=await h.rows('xero_financial_document_mappings'),payments=await h.rows('xero_financial_payment_mappings');
  const claim=await h.claim();assert.equal(claim.status,'intent');assert.equal(claim.alreadyClaimed,false);assert.equal(claim.source_hash,hash(h.evidence.source));
  assert.equal(claim.before_hash,hash(h.evidence.before));assert.equal(claim.after_hash,hash(h.evidence.expectedAfter));assert.equal(claim.projection_hash,hash(h.evidence.projection));
  assert.equal((await h.claim()).alreadyClaimed,true);
  const receipt=await h.finish(claim);assert.equal(receipt.status,'confirmed');assert.equal(receipt.linkedMapping.id,ids.mapping);assert.equal(receipt.claim.id,claim.id);
  assert.deepEqual(await h.finish(claim),receipt);assert.equal((await h.claim()).status,'confirmed');
  assert.deepEqual(await h.rows('xero_financial_document_mappings'),before);assert.deepEqual(await h.rows('xero_financial_payment_mappings'),payments);
  assert.equal((await h.rows('xero_document_field_correction_events')).length,1);
});

test('unmapped exact confirmation atomically creates one real protected mapping, usable by payment FK',async t=>{
  const h=await harness(t),claim=await h.claim();assert.equal((await h.rows('xero_financial_document_mappings')).length,0);
  const receipt=await h.finish(claim),m=receipt.linkedMapping;assert.equal(m.protected_legacy,true);assert.equal(m.source_fingerprint,h.evidence.source.sourceFingerprint);
  assert.equal(m.retained_differences.documentFieldCorrection.claimId,claim.id);assert.equal(m.xero_document_number,'new-number');
  assert.deepEqual(await h.finish(claim),receipt);assert.equal((await h.rows('xero_financial_document_mappings')).length,1);
  await h.db.query(`insert into public.xero_financial_payment_mappings(salesforce_payment_id,document_mapping_id,xero_payment_id,source_fingerprint,amount,currency,payment_date,status)values('a0S000000000001',$1,$2,$3,100,'USD','2026-02-02','linked')`,[m.id,randomUUID(),'d'.repeat(64)]);
  await assert.rejects(h.db.query('update public.xero_financial_document_mappings set source_fingerprint=$2 where id=$1',[m.id,'e'.repeat(64)]),/immutable/);
});

test('uncertain journal retains barrier; unchanged readback alone cannot release it or retry provider',async t=>{
  const h=await harness(t,{mapped:true}),claim=await h.claim();
  const uncertain={basis:'unconfirmed_provider_outcome',observed:copy(h.evidence.before),reason:'transport interrupted'};
  await h.finish(claim,'uncertain',uncertain);assert.equal((await h.claim()).status,'uncertain');
  await assert.rejects(h.finish(claim,'rejected',{basis:'unconfirmed_provider_outcome',observed:copy(h.evidence.before),reason:'still old'}));
  for(const sql of [
    "insert into public.xero_financial_sync_runs(idempotency_key,mode,status)values('doc','document_apply','processing')",
    "insert into public.xero_financial_sync_runs(idempotency_key,mode,status)values('pay','payment_apply','completed')",
    "update public.xero_financial_document_mappings set last_reconciled_at=now()",
    "update public.xero_financial_payment_mappings set last_reconciled_at=now()",
  ]) await assert.rejects(h.db.exec(sql),/correction blocks/);
  await h.db.exec("insert into public.xero_financial_sync_runs(idempotency_key,mode,status)values('read-only','preview','ready_for_review')");
  h.args.idempotencyKey='second-key';await assert.rejects(h.claim());
  await h.finish(claim);await h.db.exec("insert into public.xero_financial_sync_runs(idempotency_key,mode,status)values('after','document_apply','processing')");
});

test('definite rejection plus exact unchanged readback releases barrier without mapping',async t=>{
  const h=await harness(t),claim=await h.claim();const proof={basis:'definitive_provider_rejection',observed:copy(h.evidence.before),reason:'Provider validation rejected these fields'};
  await h.finish(claim,'rejected',proof);assert.equal((await h.rows('xero_financial_document_mappings')).length,0);
  await assert.rejects(h.finish(claim));h.args.idempotencyKey='fresh-explicit-attempt';assert.equal((await h.claim()).status,'intent');
});

test('complete rehashed economic, identity, source and projection tampering fails before any intent',async t=>{
  const h=await harness(t);
  for(const [name,change] of [
    ['amount',e=>{e.expectedAfter.Total=101;}],['contact',e=>{e.expectedAfter.Contact.ContactID=randomUUID();}],
    ['AP Reference',e=>{e.expectedAfter.Reference='changed';e.projection.header.Reference='changed';}],
    ['line quantity',e=>{e.expectedAfter.LineItems[0].Quantity=3;}],['line ID',e=>{e.expectedAfter.LineItems[0].LineItemID=randomUUID();}],
    ['line count',e=>{e.expectedAfter.LineItems.push(copy(e.expectedAfter.LineItems[0]));}],
    ['source total',e=>{e.source.total=99;}],['source Contact',e=>{e.source.contactId=randomUUID();}],['wrong source type',e=>{e.source.object='Invoice__c';}],
    ['missing target type',e=>{delete e.before.Type;delete e.expectedAfter.Type;delete e.source.xeroType;}],
    ['null target type',e=>{e.before.Type=null;e.expectedAfter.Type=null;e.source.xeroType=null;}],
    ['SF checksum',e=>{e.source.id+='ZZZ';}],['precutoff',e=>{e.source.deliveryDate='2025-12-31';}],['invalid date',e=>{e.projection.header.DueDate='2026-02-30';e.expectedAfter.DueDate='2026-02-30';}],
    ['unknown authority',e=>{e.authority.approved=true;}],['missing paid',e=>{delete e.before.AmountPaid;delete e.expectedAfter.AmountPaid;}],
    ['settlement changed',e=>{e.expectedAfter.AmountPaid=1;}],['unknown line projection',e=>{e.projection.lineDescriptions[randomUUID()]='extra';}],
    ['reordered line binding',e=>{e.expectedAfter.LineItems[0].AccountCode='99999';}],
  ]) await t.test(name,async()=>{h.args.evidence=copy(h.evidence);change(h.args.evidence);await assert.rejects(h.claim());assert.equal((await h.rows('xero_document_field_correction_claims')).length,0);});
});

test('settled Date change is held although paid description and due-date changes are valid',async t=>{
  const h=await harness(t,{paid:true});h.evidence.source.deliveryDate='2026-02-03';h.evidence.projection.header.Date='2026-02-03';h.evidence.expectedAfter.Date='2026-02-03';
  await assert.rejects(h.claim());assert.match(h.client.lastError.message,/settlement/);
});

test('existing processing document and uncertain payment writers bar correction claims',async t=>{
  const h=await harness(t);
  for(const [mode,status,control] of [['document_apply','processing',{}],['payment_apply','failed',{paymentPosting:{state:'uncertain'}}],['payment_apply','failed',{paymentPosting:{state:'intent'}}]]){
    await h.db.query('insert into public.xero_financial_sync_runs(idempotency_key,mode,status,control_totals)values($1,$2,$3,$4)',[mode+JSON.stringify(control),mode,status,JSON.stringify(control)]);
    await assert.rejects(h.claim());assert.match(h.client.lastError.message,/unresolved accounting writer/);
    await h.db.exec('delete from public.xero_financial_sync_runs');
  }
});

test('idempotency binds actor, target, proof and mapping; terminal/append-only records cannot be rewritten',async t=>{
  const h=await harness(t),claim=await h.claim();
  for(const change of [a=>{a.actor={...actor,id:randomUUID()};},a=>{a.evidence.source.documentNumber='new';},a=>{a.xeroInvoiceId=randomUUID();}]){
    const args=copy(h.args);change(args);await assert.rejects(claimDocumentCorrection(h.client,args));
  }
  const receipt=await h.finish(claim);
  await assert.rejects(h.finish(claim,'uncertain',{basis:'unconfirmed_provider_outcome',observed:null}));
  for(const table of ['xero_document_field_correction_claims','xero_document_field_correction_events']){
    await assert.rejects(h.db.exec(`delete from public.${table}`),/permission denied/);
    await h.db.exec('reset role');await assert.rejects(h.db.exec(`delete from public.${table}`),/append-only/);await h.db.exec('set role service_role');
  }
  assert.equal(receipt.linked_mapping_id,receipt.linkedMapping.id);
});

test('private previews are immutable and browser roles have no table or RPC access',async t=>{
  const h=await harness(t);await h.db.query("insert into public.xero_document_field_correction_previews(tenant_id,created_by,policy,items,summary)values($1,$2,'document_field_correction_v1','[]','{}')",[ids.tenant,actor.id]);
  await assert.rejects(h.db.exec("update public.xero_document_field_correction_previews set summary='{}'"),/permission denied/);
  for(const role of ['anon','authenticated']){
    await h.db.exec(`reset role;set role ${role}`);
    for(const table of ['xero_document_field_correction_previews','xero_document_field_correction_claims','xero_document_field_correction_events'])await assert.rejects(h.db.exec(`select * from public.${table}`),/permission denied/);
    await assert.rejects(h.claim());assert.match(h.client.lastError.message,/permission denied/);
  }
  await h.db.exec('reset role;set role service_role');
  const flags=(await h.db.query("select prosecdef,proconfig from pg_proc where proname in ('claim_xero_document_field_correction_v1','finish_xero_document_field_correction_v1')")).rows;
  assert.equal(flags.length,2);assert.ok(flags.every(r=>r.prosecdef===false && r.proconfig.includes('search_path=public, pg_temp')));
});

test('RPC canonical text/hash mismatch and oversized proof fail closed',async t=>{
  const h=await harness(t);const body={p_tenant_id:ids.tenant,p_xero_invoice_id:ids.invoice,p_mapping_id:null,p_idempotency_key:'bad',p_evidence:h.evidence,p_canonical:canonical(h.evidence),p_fingerprint:'0'.repeat(64),p_actor_id:actor.id,p_actor_email:actor.email};
  assert.ok((await h.client.rpc('claim_xero_document_field_correction_v1',body)).error);
  h.evidence.source.extra='x'.repeat(250001);await assert.rejects(h.claim(),/exceeds/);
});

test('real PostgreSQL two-connection correction barrier serializes with payment writer', {skip:!process.env.FCOS_CORRECTION_TEST_DATABASE_URL && !process.env.FCOS_GROUPED_TEST_DATABASE_URL},async t=>{
  const h=await harness(t),other=await h.connect();await other.query('set role service_role');
  const otherPid=(await other.query('select pg_backend_pid() as pid')).rows[0].pid;
  await h.db.exec('begin');const claim=await h.claim();
  const attempt=other.query("insert into public.xero_financial_sync_runs(idempotency_key,mode,status)values('concurrent','payment_apply','processing')").then(()=>null,error=>error);
  let waited=false;
  for(let poll=0;poll<40;poll+=1){
    waited=(await h.db.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) as waited",[otherPid])).rows[0].waited;
    if(waited)break;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(waited,true,'Competing payment writer must wait for the correction transaction, not race past it');
  await h.db.exec('commit');const error=await attempt;assert.match(error.message,/correction blocks/);await h.finish(claim);
});

for(const status of ['DRAFT','SUBMITTED']) test(`${status} existing invoice fields can change without status promotion`,async t=>{
  const h=await harness(t);h.evidence.before.Status=status;h.evidence.expectedAfter.Status=status;
  const claim=await h.claim(),receipt=await h.finish(claim);assert.equal(receipt.linkedMapping.xero_status,status);
});
test('verified no-op creates protected identity through exact readback and has no payload or provider transport',async t=>{
  const h=await harness(t);h.evidence.before=copy(h.evidence.expectedAfter);
  const claim=await h.claim(),receipt=await h.finish(claim);assert.equal(receipt.status,'confirmed');assert.ok(receipt.linkedMapping.id);
  assert.deepEqual(claim.evidence.before,claim.evidence.expectedAfter);
});
test('15/18 Salesforce identities agree without allowing a checksum alias',async t=>{
  const h=await harness(t,{mapped:true});
  const to18=id=>id+Array.from({length:3},(_,chunk)=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[
    [...id.slice(chunk*5,chunk*5+5)].reduce((n,c,bit)=>n+(/[A-Z]/.test(c)?1<<bit:0),0)]).join('');
  h.evidence.source.id=to18(h.evidence.source.id);h.evidence.source.accountId=to18(h.evidence.source.accountId);h.evidence.source.stemId=to18(h.evidence.source.stemId);
  const claim=await h.claim();assert.equal((await h.finish(claim)).linkedMapping.id,ids.mapping);
});
test('source-key order changes survive JSONB while exact readback drift cannot be confirmed',async t=>{
  const h=await harness(t);h.args.evidence=Object.fromEntries(Object.entries(h.evidence).reverse());const claim=await h.claim();
  const observed=copy(h.evidence.expectedAfter);observed.LineItems[0].TaxAmount=0.01;
  await assert.rejects(h.finish(claim,'confirmed',{basis:'exact_provider_readback',observed}));assert.equal((await h.claim()).status,'intent');
  await h.finish(claim);
});
test('undefined, non-finite, sparse and non-JSON material never silently disappears from proof',async t=>{
  const h=await harness(t);
  for(const value of [undefined,NaN,Infinity,new Date(),()=>{},[,,]]){
    h.args.evidence=copy(h.evidence);h.args.evidence.source.invalid=value;await assert.rejects(h.claim(),/Complete JSON/);
  }
  assert.equal((await h.rows('xero_document_field_correction_claims')).length,0);
});
test('unmapped requests cannot take an existing mapping or a different source owner',async t=>{
  const h=await harness(t,{mapped:true});h.args.mappingId=null;h.evidence.mappingSnapshot=null;
  await assert.rejects(h.claim());assert.match(h.client.lastError.message,/existing or conflicting mapping/);
});
test('stronger-isolation writers fail closed instead of using an old snapshot',async t=>{
  const h=await harness(t);await h.db.exec('begin isolation level repeatable read');
  try {await assert.rejects(h.claim());assert.match(h.client.lastError.message,/read committed/);}finally{await h.db.exec('rollback');}
});

test('immutable 205-item preview returns only three bounded pages with exact metadata',async t=>{
  const h=await harness(t),previewId=randomUUID(),items=Array.from({length:205},(_,index)=>({id:`item-${index}`,source:{proof:`source-${index}`},before:{InvoiceNumber:`invoice-${index}`}}));
  const summary={eligible:205,blocked:0};
  await h.db.query("insert into public.xero_document_field_correction_previews(id,tenant_id,created_by,policy,items,summary)values($1,$2,$3,'document_field_correction_v1',$4,$5)",[previewId,ids.tenant,actor.id,JSON.stringify(items),JSON.stringify(summary)]);
  const seen=[];
  for(const offset of [0,100,200]){
    const page=(await h.db.query('select public.read_xero_document_field_correction_page_v1($1,$2) as page',[previewId,offset])).rows[0].page;
    assert.deepEqual(Object.keys(page).sort(),['id','policy','created_at','summary','totalCount','nextOffset','items'].sort());
    assert.equal(page.id,previewId);assert.equal(page.policy,'document_field_correction_v1');assert.equal(page.totalCount,205);assert.deepEqual(page.summary,summary);
    assert.equal(page.items.length,offset===200?5:100);assert.equal(page.nextOffset,offset===200?null:offset+100);
    assert.deepEqual(page.items,items.slice(offset,offset+100));seen.push(...page.items);
  }
  assert.deepEqual(seen,items);assert.deepEqual((await h.rows('xero_document_field_correction_previews'))[0].items,items);
  for(const offset of [-100,-1,1,99,101,300,2147483600,null])await assert.rejects(h.db.query('select public.read_xero_document_field_correction_page_v1($1,$2)',[previewId,offset]),{code:'22023'});
  await assert.rejects(h.db.query('select public.read_xero_document_field_correction_page_v1($1,0)',[randomUUID()]),{code:'22023'});
  await assert.rejects(h.db.query('select public.read_xero_document_field_correction_page_v1(null,0)'),{code:'22023'});
  const flags=(await h.db.query("select prosecdef,provolatile,proconfig from pg_proc where proname='read_xero_document_field_correction_page_v1'")).rows[0];
  assert.equal(flags.prosecdef,false);assert.equal(flags.provolatile,'s');assert.ok(flags.proconfig.includes('search_path=public, pg_temp'));
  for(const role of ['anon','authenticated']){
    await h.db.exec(`reset role;set role ${role}`);
    await assert.rejects(h.db.query('select public.read_xero_document_field_correction_page_v1($1,0)',[previewId]),/permission denied/);
  }
});
test('empty correction preview permits only offset zero and returns a literal empty page',async t=>{
  const h=await harness(t),previewId=randomUUID();
  await h.db.query("insert into public.xero_document_field_correction_previews(id,tenant_id,created_by,policy,items,summary)values($1,$2,$3,'document_field_correction_v1','[]','{}')",[previewId,ids.tenant,actor.id]);
  const page=(await h.db.query('select public.read_xero_document_field_correction_page_v1($1,0) as page',[previewId])).rows[0].page;
  assert.deepEqual(page.items,[]);assert.equal(page.totalCount,0);assert.equal(page.nextOffset,null);
  await assert.rejects(h.db.query('select public.read_xero_document_field_correction_page_v1($1,100)',[previewId]),{code:'22023'});
});
