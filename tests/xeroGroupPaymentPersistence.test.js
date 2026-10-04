import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveGroupRemittanceBankEvidence } from '../api/_xeroGroupRemittanceBankEvidence.js';
import { issuedSupplierHash } from '../api/_xeroIssuedSupplierPreservation.js';
import { persistReviewedGroupPaymentLinks, claimReviewedGroupPayment, finishReviewedGroupPayment, validatedGroupPaymentRow } from '../api/_xeroGroupPaymentPersistence.js';
import { persistReviewedPaymentReferenceLinks } from '../api/_xeroPaymentReferenceLink.js';
import { paymentPostingKey, reviewPaymentPostingClaim, loadPaymentPostingClaims, postReviewedPaymentBatch } from '../api/_xeroPaymentPosting.js';
const key = (prefix, n) => `${prefix}${String(n).padStart(12, '0')}`;
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const migration = '20260928005135_xero_group_remittance_bank_evidence.sql';
function sourceFixture(count = 2) {
  const groupId = key('001', 1); const parentId = key('a0S', 1);
  const common = { IsDeleted: false, CreatedDate: '2026-01-02T00:00:00Z', LastModifiedDate: '2026-01-02T00:00:01Z',
    Date__c: '2026-01-02', Supplier_Invoice__c: null, Reference__c: null, Is_Deposit__c: false,
    Is_Volume_Discount__c: false, Commission_Invoice__c: null, CurrencyIsoCode: 'USD', _currency: { currency: 'USD', blockers: [] } };
  const parent = { ...clone(common), Id: parentId, Name: 'Group receipt', RecordType: { DeveloperName: 'Receivable_Remittance' },
    Account__c: groupId, Amount__c: count * 50, Bank__c: 'UBS', Remittance__c: null, STEM__c: null };
  const siblings = Array.from({ length: count }, (_, n) => ({ ...clone(common), Id: key('a0S', n + 2), Name: `Allocation ${n + 1}`,
    RecordType: { DeveloperName: 'Receivable' }, Account__c: key('001', n + 2), Amount__c: 50,
    Bank__c: null, Remittance__c: parentId, STEM__c: key('a0H', n + 1) }));
  const account = (Id, Name, type, ParentId, company) => ({ Id, IsDeleted: false, Name,
    RecordType: { DeveloperName: type }, ParentId, Company_Code__c: company, Inactive_Suspended__c: false,
    LastModifiedDate: '2026-01-01T00:00:00Z' });
  const accounts = [account(groupId, 'GROUP - FRATELLI COSULICH', 'Group', null, 'GROUP - FC'),
    ...siblings.map((row, index) => account(row.Account__c, 'FRATELLI COSULICH UNIPESSOAL SA', 'Buyer_Supplier', groupId, `HK DISTINCT ${index}`))];
  const buyerDocumentInventories = siblings.map((row, index) => ({ stemId: row.STEM__c, complete: true, creditFields: ['Is_Credit_Note__c'],
    records: [{ Id: key('a0K', index + 1), IsDeleted: false, Name: `${index + 20000}T-INV-1`, STEM__c: row.STEM__c,
      STEM__r: { Account__c: row.Account__c }, Amount__c: 50, Proforma__c: false, Deprecated__c: false, Is_Credit_Note__c: false,
      CreatedDate: '2025-12-30T00:00:00Z', LastModifiedDate: '2026-01-01T00:00:00Z', Invoice_Date__c: '2025-12-30',
      Invoice_Due_Date__c: '2026-01-13', CurrencyIsoCode: 'USD', _currency: { currency: 'USD', blockers: [] } }] }));
  const options = { parent, siblings, visiblePayments: [parent, ...siblings], accounts, buyerDocumentInventories, complete: true };
  return { payment: siblings[0], options };
}

async function fixture(t, { database, roles = true, beforeMigration, amountTail = false } = {}) {
  const db = database || new PGlite(); if (!database) t.after(() => db.close());
  if (roles) await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec('grant usage on schema public to service_role;');
  for (const name of ['20260829080726_xero_financial_sync.sql','20260923213339_xero_payment_reference_link.sql','20260923222821_xero_grouped_preservation_link.sql']) {
    await db.exec((await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')).replace(/^create extension if not exists pgcrypto;$/m, ''));
  }
  const source = sourceFixture();
  if (amountTail) {
    source.options.siblings[0].Amount__c=131317.19999999995;
    source.options.parent.Amount__c=131367.19999999995;
    source.options.buyerDocumentInventories[0].records[0].Amount__c=131317.2;
  }
  const tenantId = randomUUID(); const actor = { id: randomUUID(), email: 'finance@example.test' };
  const bank = { id: randomUUID(), salesforce_bank_name: 'UBS', xero_bank_account_id: randomUUID(), revision: 2, enabled: true };
  await db.query(`insert into public.xero_financial_bank_mappings(id,salesforce_bank_name,xero_bank_account_id,xero_bank_account_name,revision,enabled)
    values($1,'UBS',$2,'UBS USD',2,true)`, [bank.id, bank.xero_bank_account_id]);
  const rows = [];
  for (const [index, payment] of source.options.siblings.entries()) {
    const invoice = source.options.buyerDocumentInventories[index].records[0];
    const document = { id: randomUUID(), salesforce_object: 'Invoice__c', salesforce_id: invoice.Id, xero_document_id: randomUUID(),
      xero_document_type: 'ACCREC', xero_contact_id: randomUUID(), source_fingerprint: hash(`document-${index}`),
      retained_differences: { accountId: payment.Account__c, stemId: payment.STEM__c }, protected_legacy: true };
    await db.query(`insert into public.xero_financial_document_mappings(id,salesforce_object,salesforce_id,salesforce_document_number,
      document_kind,xero_document_type,xero_document_id,xero_contact_id,source_fingerprint,financial_fingerprint,protected_legacy,retained_differences)
      values($1,'Invoice__c',$2,$3,'buyer_invoice','ACCREC',$4,$5,$6,'financial',true,$7)`,
    [document.id, document.salesforce_id, invoice.Name, document.xero_document_id, document.xero_contact_id, document.source_fingerprint, JSON.stringify(document.retained_differences)]);
    const evaluated = resolveGroupRemittanceBankEvidence(payment, source.options); assert.equal(evaluated.eligible, true, evaluated.blocker);
    rows.push({ salesforcePaymentId: payment.Id, salesforcePaymentName: payment.Name, documentMappingId: document.id, xeroPaymentId: randomUUID(),
      bankAccountId: bank.xero_bank_account_id, amount: payment.Amount__c, currency: 'USD', paymentDate: payment.Date__c,
      sourceFingerprint: hash(`payment-${index}`), bankSourceEvidence: evaluated.evidence, documentMappingSnapshot: document, bankMappingSnapshot: bank });
  }
  if (beforeMigration) await beforeMigration({ db, rows });
  await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261001011301_xero_group_payment_confirmed_cents.sql', import.meta.url), 'utf8'));
  const raw = async (name, p, connection = db) => {
    const entries = Object.entries(p); const sql = `select public.${name}(${entries.map(([key], n) => `${key} => $${n + 1}`).join(',')}) as result`;
    return (await connection.query(sql, entries.map(([,v]) => typeof v === 'object' && v !== null ? JSON.stringify(v) : v))).rows[0].result;
  };
  const client = { rpc: async (name, p) => { try { return { data: await raw(name,p), error:null }; } catch(error) { return { data:null,error:{code:error.code,message:error.message} }; } } };
  const params = (row = rows[0]) => ({ p_tenant_id: tenantId, p_rows: [row], p_actor_id: actor.id, p_actor_email: actor.email });
  const persist = (input = rows, overrides={}) => persistReviewedGroupPaymentLinks(client,{ tenantId, rows: input, actor, ...overrides });
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(m) order by id) from public.xero_financial_payment_mappings m) as mappings,
    (select jsonb_agg(to_jsonb(r) order by id) from public.xero_financial_sync_runs r) as claims,
    (select jsonb_agg(to_jsonb(a) order by id) from public.xero_financial_audit_events a) as audits`)).rows[0];
  const legacyMapping = (id=source.options.parent.Id, target=randomUUID(), connection=db) => connection.query(`insert into public.xero_financial_payment_mappings
    (salesforce_payment_id,document_mapping_id,xero_payment_id,source_fingerprint,amount,currency,payment_date,status)
    values($1,$2,$3,'legacy',100,'USD','2026-01-02','linked')`, [id,rows[0].documentMappingId,target]);
  const legacyClaim = (id=source.options.parent.Id, state='uncertain', connection=db) => connection.query(`insert into public.xero_financial_sync_runs
    (idempotency_key,mode,status,source_fingerprint,control_totals) values($1,'payment_apply','failed','legacy',$2)`,
  [paymentPostingKey(tenantId,id),JSON.stringify({paymentPosting:{tenantId,paymentId:id,state,reviewed:{salesforcePaymentId:id}}})]);
  return { db, source, tenantId, actor, bank, rows, client, params, raw, persist, snapshot, legacyMapping, legacyClaim };
}
const conflict = { code:'XERO_GROUP_PAYMENT_CONFLICT', status:409 };

test('new Group exact path atomically preserves every full receipt, actor audit, independent invoice and posting barrier', async t => {
  const f=await fixture(t); const result=await f.persist(); assert.deepEqual(result.summary,{linked:2,failed:0,alreadyLinked:0});
  const saved=await f.snapshot(); assert.equal(saved.mappings.length,2); assert.equal(saved.claims.length,2); assert.equal(saved.audits.length,2);
  for(const row of f.rows) {
    const map=saved.mappings.find(item=>item.salesforce_payment_id===row.salesforcePaymentId);
    assert.deepEqual(map.bank_source_evidence,row.bankSourceEvidence); assert.deepEqual(map.retained_reference,{});
    const claim=saved.claims.find(item=>item.idempotency_key===paymentPostingKey(f.tenantId,row.salesforcePaymentId));
    assert.deepEqual(claim.control_totals.paymentPosting.reviewed.bankSourceEvidence,row.bankSourceEvidence);
    assert.equal(claim.control_totals.paymentPosting.state,'group_linked'); assert.equal(claim.status,'completed');
    assert.deepEqual(saved.audits.find(item=>item.run_id===claim.id).fingerprints.bankSourceEvidence,row.bankSourceEvidence);
  }
  assert.equal((await f.persist()).summary.alreadyLinked,2); assert.deepEqual(await f.snapshot(),saved);
});

test('additive migration preserves populated legacy rows byte-for-byte except empty default column', async t => {
  let before;
  const f=await fixture(t,{beforeMigration:async ({db,rows})=>{
    await db.query(`insert into public.xero_financial_payment_mappings(salesforce_payment_id,document_mapping_id,xero_payment_id,source_fingerprint,amount,currency,payment_date,status)
      values('a0S000000000099',$1,$2,'legacy',2,'USD','2026-01-01','protected')`,[rows[0].documentMappingId,randomUUID()]);
    before=(await db.query('select to_jsonb(m) as value from public.xero_financial_payment_mappings m')).rows[0].value;
  }});
  const after=(await f.snapshot()).mappings[0]; assert.deepEqual(after,{...before,bank_source_evidence:{}});
  await f.db.query("update public.xero_financial_payment_mappings set source_fingerprint='legacy-next' where id=$1",[after.id]);
  await f.db.query('delete from public.xero_financial_payment_mappings where id=$1',[after.id]);
});

test('service-only permissions deny browser calls and table access', async t => {
  const f=await fixture(t);
  for(const role of ['anon','authenticated']) {
    for(const name of ['link_xero_group_payments_v1','link_xero_payment_references_v2','claim_xero_group_payment_v1']) {
      const signature=`public.${name}(uuid,jsonb,uuid,text)`;
      assert.equal((await f.db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed',[role,signature])).rows[0].allowed,false);
    }
    await f.db.exec(`set role ${role}`); await assert.rejects(f.raw('link_xero_group_payments_v1',f.params()),{code:'42501'}); await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role'); await f.persist(); await f.db.exec('reset role');
});

test('missing unknown null tampered or independently substituted Group evidence fails before any write', async t => {
  const f=await fixture(t); const before=await f.snapshot();
  const variants=[r=>{delete r.bankSourceEvidence;},r=>{r.bankSourceEvidence=null;},r=>{r.bankSourceEvidence.policyVersion='unknown';},
    r=>{r.bankSourceEvidence.fingerprint=hash('forged');},r=>{r.amount+=1;},r=>{r.paymentDate='2026-01-03';},
    r=>{r.documentMappingId=f.rows[1].documentMappingId;r.documentMappingSnapshot=clone(f.rows[1].documentMappingSnapshot);},
    r=>{r.bankAccountId=randomUUID();},r=>{r.salesforcePaymentId=f.rows[1].salesforcePaymentId;}];
  for(const edit of variants) {
    const row=clone(f.rows[0]);edit(row);await assert.rejects(f.persist([row]));
    await assert.rejects(f.raw('link_xero_group_payments_v1',f.params(row))); assert.deepEqual(await f.snapshot(),before);
  }
});

test('SQL rehashed raw debtor membership and invoice-owner tampering still fails independent invariants', async t => {
  const f=await fixture(t);
  for(const edit of [p=>{p.source.accounts[1].ParentId='001000000000099';},p=>{p.source.allocations[1].Is_Deposit__c=true;},
    p=>{p.source.buyerDocumentInventories[0].records[0].STEM__r.Account__c='001000000000099';}]) {
    const row=clone(f.rows[0]); const p=row.bankSourceEvidence;edit(p);
    const digest=(component,value)=>issuedSupplierHash({policyVersion:p.policyVersion,component,value});
    p.familyFingerprint=digest('family',{parent:p.source.parent,allocations:p.source.allocations});
    p.membershipFingerprint=digest('membership',p.source.accounts);p.invoiceOwnershipFingerprint=digest('invoice_ownership',p.source.buyerDocumentInventories);
    const {fingerprint:_,...basis}=p;p.fingerprint=digest('evidence',basis);
    await assert.rejects(f.raw('link_xero_group_payments_v1',f.params(row)),{code:'22023'});
  }
  assert.equal((await f.snapshot()).mappings,null);
});

test('saved mapping, source proof, claim review and audit cannot be stripped remapped rehashed or deleted', async t => {
  const f=await fixture(t);await f.persist([f.rows[0]]);const before=await f.snapshot(); const map=before.mappings[0];const claim=before.claims[0];
  for(const sql of ["update public.xero_financial_payment_mappings set bank_source_evidence='{}'",
    "update public.xero_financial_payment_mappings set source_fingerprint='changed'",'delete from public.xero_financial_payment_mappings',
    "update public.xero_financial_sync_runs set control_totals='{}'",'delete from public.xero_financial_sync_runs',
    "update public.xero_financial_audit_events set fingerprints='{}'",'delete from public.xero_financial_audit_events']) {
    await assert.rejects(f.db.exec(sql),{code:'40001'}); assert.deepEqual(await f.snapshot(),before);
  }
  await f.db.query('update public.xero_financial_payment_mappings set last_reconciled_at=now() where id=$1',[map.id]);
  await assert.rejects(f.legacyClaim(f.rows[0].salesforcePaymentId),{code:'40001'});
  assert.ok(claim.id);
});

test('any existing header mapping or claim state blocks children and child evidence blocks later header writes', async t => {
  for(const kind of ['mapping','intent','uncertain','confirmed','reference_linked']) {
    await t.test(kind,async c=>{
      const f=await fixture(c); if(kind==='mapping') await f.legacyMapping();else await f.legacyClaim(undefined,kind);
      const before=await f.snapshot();await assert.rejects(f.persist(),conflict);assert.deepEqual(await f.snapshot(),before);
    });
  }
  const f=await fixture(t);await f.persist([f.rows[0]]);const before=await f.snapshot();
  await assert.rejects(f.legacyMapping(),{code:'40001'});await assert.rejects(f.legacyClaim(),{code:'40001'});assert.deepEqual(await f.snapshot(),before);
});

test('target/source ownership and local bank/document drift fail closed, including unchanged retry', async t=>{
  const f=await fixture(t);await f.legacyMapping('a0S000000000099',f.rows[0].xeroPaymentId);const before=await f.snapshot();
  await assert.rejects(f.persist([f.rows[0]]),conflict);assert.deepEqual(await f.snapshot(),before);
  for(const sql of ['update public.xero_financial_bank_mappings set enabled=false',"update public.xero_financial_document_mappings set source_fingerprint='changed'"]) {
    await f.db.exec('begin'); await f.db.exec(sql); await assert.rejects(f.persist([f.rows[1]]),conflict); await f.db.exec('rollback');
  }
  await f.persist([f.rows[1]]);await f.db.exec('update public.xero_financial_bank_mappings set revision=revision+1');await assert.rejects(f.persist([f.rows[1]]),conflict);
});

test('audit storage failure and second-row conflict roll back the entire Group batch',async t=>{
  const f=await fixture(t);await f.db.exec(`create function reject_group_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure' using errcode='XX000'; end $$;
    create trigger reject_group_audit before insert on public.xero_financial_audit_events for each row execute function reject_group_audit();`);
  await assert.rejects(f.persist(),{code:'XERO_GROUP_PAYMENT_STORAGE_FAILED'});assert.deepEqual(await f.snapshot(),{mappings:null,claims:null,audits:null});
  await f.db.exec('drop trigger reject_group_audit on public.xero_financial_audit_events');await f.legacyMapping(f.rows[1].salesforcePaymentId);
  const before=await f.snapshot();await assert.rejects(f.persist(),conflict);assert.deepEqual(await f.snapshot(),before);
});

function postingRow(row) { return {...clone(row),xeroPaymentId:null,type:'Receivable',action:'payment_apply',status:'eligible',blockers:[],blockerCodes:[],reviewFingerprint:hash('review'),
  proposedPayment:{Invoice:{InvoiceID:row.documentMappingSnapshot.xero_document_id},Account:{AccountID:row.bankAccountId},Amount:row.amount,Date:row.paymentDate,Reference:row.salesforcePaymentName}}; }

test('Group posting intent and confirmed success retain full proof atomically without changing ordinary gates',async t=>{
  const f=await fixture(t);const row=postingRow(f.rows[0]);
  await assert.rejects(claimReviewedGroupPayment(f.client,f.tenantId,{...row,status:'blocked'},f.actor));
  const claim=await claimReviewedGroupPayment(f.client,f.tenantId,row,f.actor);assert.ok(claim.id);
  assert.equal(await claimReviewedGroupPayment(f.client,f.tenantId,row,f.actor),null);
  await assert.rejects(f.legacyMapping(),{code:'40001'});
  const values={xero_payment_id:f.rows[0].xeroPaymentId,xero_bank_account_id:row.bankAccountId,amount:row.amount,currency:row.currency,payment_date:row.paymentDate};
  await finishReviewedGroupPayment(f.client,claim,f.actor,'confirmed',null,[values.xero_payment_id],values);
  const saved=await f.snapshot();assert.equal(saved.mappings[0].status,'applied');assert.deepEqual(saved.mappings[0].bank_source_evidence,row.bankSourceEvidence);
  assert.equal(saved.claims[0].status,'completed');assert.equal(saved.audits.length,2);
  assert.deepEqual(saved.audits[1].fingerprints.paymentPosting.reviewed.bankSourceEvidence,row.bankSourceEvidence);
});

test('Group reference links use additive RPC and preserve full proof while legacy path keeps its cap',async t=>{
  const f=await fixture(t);const row=clone(f.rows[0]);row.referenceReviewFingerprint=hash('reference');
  row.retainedReferenceEvidence={documentMapping:row.documentMappingSnapshot,bankMapping:row.bankMappingSnapshot,bankSourceEvidence:row.bankSourceEvidence,xeroReference:'DIFFERENT'};
  row.referenceReviewFingerprint=issuedSupplierHash(row.retainedReferenceEvidence);
  await persistReviewedPaymentReferenceLinks(f.client,{tenantId:f.tenantId,rows:[row],actor:f.actor});const before=await f.snapshot();
  assert.deepEqual(before.mappings[0].retained_reference.evidence.bankSourceEvidence,row.bankSourceEvidence);
  assert.equal((await persistReviewedPaymentReferenceLinks(f.client,{tenantId:f.tenantId,rows:[row],actor:f.actor})).summary.alreadyLinked,1);
  assert.deepEqual(await f.snapshot(),before);
  row.retainedReferenceEvidence.padding='a'.repeat(65536);await assert.rejects(persistReviewedPaymentReferenceLinks(f.client,{tenantId:f.tenantId,rows:[row],actor:f.actor}));
});

test('Group claim readback cannot accept stripped or legacy proof even when source hash is equal',async t=>{
  const f=await fixture(t);await f.persist([f.rows[0]]);const claim=(await f.snapshot()).claims[0];
  const row={...f.rows[0],action:'payment_link',status:'protected',blockers:[],blockerCodes:[],proposedPayment:null};
  const actual={PaymentID:row.xeroPaymentId,Account:{AccountID:row.bankAccountId}};
  assert.equal(reviewPaymentPostingClaim(row,claim,actual).status,'protected');
  for(const edit of [r=>{delete r.bankSourceEvidence;},r=>{r.bankSourceEvidence=null;},r=>{r.bankSourceEvidence={policyVersion:'legacy'};}]) {
    const changed=clone(row);edit(changed);assert.equal(reviewPaymentPostingClaim(changed,claim,actual).status,'blocked');
  }
});

const rehashProof = p => {
  const digest=(component,value)=>issuedSupplierHash({policyVersion:p.policyVersion,component,value});
  p.familyFingerprint=digest('family',{parent:p.source.parent,allocations:p.source.allocations});
  p.membershipFingerprint=digest('membership',p.source.accounts);p.invoiceOwnershipFingerprint=digest('invoice_ownership',p.source.buyerDocumentInventories);
  const {fingerprint:_,...basis}=p;p.fingerprint=digest('evidence',basis);return p;
};
test('SQL rejects rehashed missing unknown contradictory literal facts and noncanonical arrays',async t=>{
  const f=await fixture(t);
  const edits=[p=>{delete p.source.accounts[1].RecordType.DeveloperName;},p=>{p.source.accounts[1].RecordType.extra=true;},
    p=>{delete p.source.buyerDocumentInventories[0].records[0].Name;},p=>{p.source.buyerDocumentInventories[0].records[0].Name='X-CN-1';},
    p=>{p.source.buyerDocumentInventories[0].records[0].CurrencyIsoCode='HKD';},p=>{p.source.buyerDocumentInventories[0].records[0].unknown=true;},
    p=>{p.source.buyerDocumentInventories[0].records[0].STEM__r.extra=true;},p=>{p.source.buyerDocumentInventories[0].records[0].Is_Credit_Note__c=true;},
    p=>{p.source.buyerDocumentInventories[0].records[0].Proforma__c=null;},p=>{p.source.buyerDocumentInventories[0].creditFields.push('Is_Credit_Note__c');},
    p=>{p.source.allocations[0].Reference__c=false;},p=>{delete p.source.allocations[0].Bank__c;},p=>{p.source.parent.Bank__c={name:'UBS'};p.bank={name:'UBS'};},
    p=>{p.source.accounts.reverse();},p=>{p.source.buyerDocumentInventories.reverse();}];
  for(const edit of edits) {
    const row=clone(f.rows[0]);edit(row.bankSourceEvidence);rehashProof(row.bankSourceEvidence);
    assert.throws(()=>validatedGroupPaymentRow(row));await assert.rejects(f.raw('link_xero_group_payments_v1',f.params(row)));
  }
  assert.deepEqual(await f.snapshot(),{mappings:null,claims:null,audits:null});
});

test('posting intent and confirmation audit failures roll back their own entire local transaction',async t=>{
  const f=await fixture(t);const row=postingRow(f.rows[0]);
  const reject=()=>f.db.exec(`create function reject_post_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure' using errcode='XX000'; end $$;
    create trigger reject_post_audit before insert on public.xero_financial_audit_events for each row execute function reject_post_audit();`);
  await reject();await assert.rejects(claimReviewedGroupPayment(f.client,f.tenantId,row,f.actor));assert.deepEqual(await f.snapshot(),{mappings:null,claims:null,audits:null});
  await f.db.exec('drop trigger reject_post_audit on public.xero_financial_audit_events; drop function reject_post_audit()');
  const claim=await claimReviewedGroupPayment(f.client,f.tenantId,row,f.actor);const before=await f.snapshot();await reject();
  const values={xero_payment_id:f.rows[0].xeroPaymentId,xero_bank_account_id:row.bankAccountId,amount:row.amount,currency:row.currency,payment_date:row.paymentDate};
  await assert.rejects(finishReviewedGroupPayment(f.client,claim,f.actor,'confirmed',null,[values.xero_payment_id],values));assert.deepEqual(await f.snapshot(),before);
});

test('canonical 15/18 aliases crossing a 200-key boundary query one claim once and retain all lookup aliases',async()=>{
  const tenant=randomUUID();const original='a0S000000000001EAA';const canonical=original.slice(0,15);
  const claim={id:randomUUID(),idempotency_key:paymentPostingKey(tenant,canonical),control_totals:{paymentPosting:{tenantId:tenant,paymentId:canonical}}};
  const queried=[]; const client={from:()=>({select(){return this;},eq(){return this;},async in(_key,keys){queried.push(...keys);return{data:keys.includes(claim.idempotency_key)?[claim]:[],error:null};}})};
  const ids=[original,...Array.from({length:201},(_,n)=>key('a0S',n+2)),canonical];
  const result=await loadPaymentPostingClaims(client,tenant,ids);assert.equal(result.get(original),claim);assert.equal(result.get(canonical),claim);
  assert.equal(new Set(queried).size,queried.length);assert.equal(queried.length,202);
});

const concurrencyUrl=process.env.FCOS_GROUP_PAYMENT_TEST_DATABASE_URL||process.env.FCOS_GROUPED_TEST_DATABASE_URL;
async function postgresFixture(t) {
  const endpoint=new URL(concurrencyUrl);assert.ok(['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname));assert.ok(['postgres:','postgresql:'].includes(endpoint.protocol));
  const admin=new pg.Client({connectionString:endpoint.toString()});await admin.connect();const dbName=`fcos_group_payment_test_${randomUUID().replaceAll('-','')}`;const clients=[];let created=false;
  t.after(async()=>{for(const client of clients){await client.query('rollback').catch(()=>{});await client.end();}if(created)await admin.query(`drop database "${dbName}" with (force)`);await admin.end();});
  for(const role of ['anon','authenticated','service_role'])assert.equal((await admin.query('select count(*)::int n from pg_roles where rolname=$1',[role])).rows[0].n,1);
  await admin.query(`create database "${dbName}"`);created=true;endpoint.pathname=`/${dbName}`;
  const connect=async()=>{const client=new pg.Client({connectionString:endpoint.toString()});await client.connect();await client.query("set statement_timeout='8s'; set lock_timeout='6s'");clients.push(client);return client;};
  const primary=await connect();const f=await fixture(t,{database:{query:(...args)=>primary.query(...args),exec:text=>primary.query(text)},roles:false});
  const waitForLock=async client=>{for(let i=0;i<120;i++){if((await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID])).rows[0]?.wait_event_type==='Lock')return;await delay(25);}assert.fail('Expected competing transaction to wait on PostgreSQL lock');};
  return{...f,primary,connect,waitForLock};
}
test('PostgreSQL overlapping Group mapping/header/claim/retry races and local snapshot locks',{
  skip:!concurrencyUrl&&'Set FCOS_GROUP_PAYMENT_TEST_DATABASE_URL to a disposable localhost PostgreSQL cluster',timeout:90000,
},async t=>{
  await t.test('same source and target retry waits, then exactly one mapping/audit survives',async c=>{
    const f=await postgresFixture(c);const second=await f.connect();await f.primary.query('begin');await f.raw('link_xero_group_payments_v1',f.params(),f.primary);
    const pending=f.raw('link_xero_group_payments_v1',f.params(),second);await f.waitForLock(second);await f.primary.query('commit');
    assert.equal((await pending).outcomes[0].alreadyLinked,true);const saved=await f.snapshot();assert.equal(saved.mappings.length,1);assert.equal(saved.audits.length,1);
  });
  for(const winner of ['header_mapping','header_claim','child'])await t.test(`${winner} wins header/child race`,async c=>{
    const f=await postgresFixture(c);const second=await f.connect();await f.primary.query('begin');
    if(winner==='header_mapping')await f.legacyMapping(undefined,undefined,f.primary);
    else if(winner==='header_claim')await f.legacyClaim(undefined,'uncertain',f.primary);
    else await f.raw('link_xero_group_payments_v1',f.params(),f.primary);
    const pending=(winner==='child'?f.legacyClaim(undefined,'intent',second):f.raw('link_xero_group_payments_v1',f.params(),second)).then(()=>({ok:true}),error=>({error}));
    await f.waitForLock(second);await f.primary.query('commit');assert.equal((await pending).error?.code,'40001');
  });
  await t.test('another source cannot win an already reserved target after waiting',async c=>{
    const f=await postgresFixture(c);const second=await f.connect();await f.primary.query('begin');await f.raw('link_xero_group_payments_v1',f.params(),f.primary);
    const row={...f.rows[1],xeroPaymentId:f.rows[0].xeroPaymentId};const pending=f.raw('link_xero_group_payments_v1',f.params(row),second).then(()=>({ok:true}),error=>({error}));
    await f.waitForLock(second);await f.primary.query('commit');assert.equal((await pending).error?.code,'40001');assert.equal((await f.snapshot()).mappings.length,1);
  });
  await t.test('a header winner rollback permits the waiting child unchanged',async c=>{
    const f=await postgresFixture(c);const second=await f.connect();await f.primary.query('begin');await f.legacyClaim(undefined,'uncertain',f.primary);
    const pending=f.raw('link_xero_group_payments_v1',f.params(),second);await f.waitForLock(second);await f.primary.query('rollback');assert.equal((await pending).outcomes[0].alreadyLinked,false);
  });
  for(const kind of ['bank','document'])await t.test(`${kind} snapshot edit wins and stale child rolls back after waiting`,async c=>{
    const f=await postgresFixture(c);const second=await f.connect();await f.primary.query('begin');
    if(kind==='bank')await f.primary.query('update public.xero_financial_bank_mappings set revision=revision+1 where id=$1',[f.bank.id]);
    else await f.primary.query("update public.xero_financial_document_mappings set source_fingerprint='changed' where id=$1",[f.rows[0].documentMappingId]);
    const pending=f.raw('link_xero_group_payments_v1',f.params(),second).then(()=>({ok:true}),error=>({error}));await f.waitForLock(second);await f.primary.query('commit');
    assert.equal((await pending).error?.code,'40001');assert.deepEqual(await f.snapshot(),{mappings:null,claims:null,audits:null});
  });
});

test('a malformed parent journal still reserves its canonical posting key in either race order',async t=>{
  const f=await fixture(t);const insert=()=>f.db.query(`insert into public.xero_financial_sync_runs(idempotency_key,mode,status,control_totals)
    values($1,'payment_apply','failed','{}')`,[paymentPostingKey(f.tenantId,f.source.options.parent.Id)]);
  await insert();const before=await f.snapshot();await assert.rejects(f.persist(),conflict);assert.deepEqual(await f.snapshot(),before);
  await f.db.exec('delete from public.xero_financial_sync_runs');await f.persist([f.rows[0]]);await assert.rejects(insert(),{code:'40001'});
});

test('legacy reference v1 and ordinary claims remain compatible after the new migration',async t=>{
  const f=await fixture(t);const row={...clone(f.rows[0]),salesforcePaymentId:'a0S000000000099',salesforcePaymentName:'Legacy payment',sourceFingerprint:hash('legacy')};
  delete row.bankSourceEvidence;delete row.documentMappingSnapshot;delete row.bankMappingSnapshot;
  row.referenceReviewFingerprint=hash('legacy-reference');row.retainedReferenceEvidence={documentMapping:f.rows[0].documentMappingSnapshot,bankMapping:f.bank,xeroReference:'Keep legacy'};
  const result=await persistReviewedPaymentReferenceLinks(f.client,{tenantId:f.tenantId,rows:[row],actor:f.actor});assert.equal(result.summary.linked,1);
  assert.deepEqual((await f.snapshot()).mappings[0].bank_source_evidence,{});
  assert.equal((await persistReviewedPaymentReferenceLinks(f.client,{tenantId:f.tenantId,rows:[row],actor:f.actor})).summary.alreadyLinked,1);
  await f.legacyClaim('a0S000000000098','intent');assert.equal((await f.snapshot()).claims.length,2);
});

test('exact Group receipt rejects changed replay fields or a different tenant without any partial mutation',async t=>{
  const f=await fixture(t);await f.persist([f.rows[0]]);const before=await f.snapshot();
  for(const patch of [{sourceFingerprint:hash('changed')},{xeroPaymentId:randomUUID()},{salesforcePaymentName:'Changed'},{amount:51}]) {
    await assert.rejects(f.persist([{...f.rows[0],...patch}]));assert.deepEqual(await f.snapshot(),before);
  }
  await assert.rejects(f.persist([f.rows[0]],{tenantId:randomUUID()}),conflict);assert.deepEqual(await f.snapshot(),before);
});

test('unconfirmed Group RPC response fails closed and an interrupted committed link can be reread unchanged',async t=>{
  const f=await fixture(t);
  for(const data of [null,{}, {outcomes:[]}, {outcomes:[null]}]) {
    await assert.rejects(persistReviewedGroupPaymentLinks({rpc:async()=>({data,error:null})},{tenantId:f.tenantId,rows:[f.rows[0]],actor:f.actor}));
  }
  const interrupted={rpc:async(name,p)=>{await f.raw(name,p);throw new Error('Transport interrupted');}};
  await assert.rejects(persistReviewedGroupPaymentLinks(interrupted,{tenantId:f.tenantId,rows:[f.rows[0]],actor:f.actor}),{code:'XERO_GROUP_PAYMENT_CONFIRMATION_UNCERTAIN'});
  assert.equal((await f.persist([f.rows[0]])).summary.alreadyLinked,1);assert.equal((await f.snapshot()).audits.length,1);
});

test('Group posting payload binds exactly to the reviewed invoice bank cents date and source reference at JS and SQL',async t=>{
  const f=await fixture(t);const original=postingRow(f.rows[0]);
  const edits=[r=>{r.proposedPayment.Invoice.InvoiceID=randomUUID();},r=>{r.proposedPayment.Account.AccountID=randomUUID();},
    r=>{r.proposedPayment.Amount+=1;},r=>{r.proposedPayment.Date='2026-01-03';},r=>{r.proposedPayment.Reference='Other';},
    r=>{r.proposedPayment.PaymentID=randomUUID();},r=>{r.proposedPayment.Invoice.Other='unknown';},r=>{r.proposedPayment.Account.Code='unknown';}];
  for(const edit of edits){const row=clone(original);edit(row);await assert.rejects(claimReviewedGroupPayment(f.client,f.tenantId,row,f.actor),{code:'XERO_GROUP_PAYMENT_INVALID'});
    await assert.rejects(f.raw('claim_xero_group_payment_v1',{p_tenant_id:f.tenantId,p_row:row,p_actor_id:f.actor.id,p_actor_email:f.actor.email}),{code:'22023'});}
  assert.deepEqual(await f.snapshot(),{mappings:null,claims:null,audits:null});
});

test('existing posting orchestrator uses Group atomic proof path before and after the mocked provider boundary',async t=>{
  for(const transportFails of [false,true])await t.test(transportFails?'uncertain outcome retains barrier':'confirmed outcome retains mapping proof',async c=>{
    const f=await fixture(c);const row=postingRow(f.rows[0]);let writes=0;
    const accountingFetch=async(_connection,path,options)=>{
      writes++;assert.equal(path,'/Payments?summarizeErrors=false');assert.deepEqual(options.body.Payments,[row.proposedPayment]);
      const before=await f.snapshot();assert.equal(before.claims[0].control_totals.paymentPosting.state,'intent');assert.equal(before.audits.length,1);
      if(transportFails)throw new Error('Mock transport failure');
      return{Payments:[{PaymentID:f.rows[0].xeroPaymentId,Invoice:{InvoiceID:row.proposedPayment.Invoice.InvoiceID,Type:'ACCREC',CurrencyCode:'USD'},
        Account:{AccountID:row.bankAccountId,CurrencyCode:'USD'},PaymentType:'ACCRECPAYMENT',Status:'AUTHORISED',Amount:row.amount,BankAmount:row.amount,
        CurrencyRate:1,Date:row.paymentDate,Reference:row.proposedPayment.Reference}]};
    };
    const options={client:f.client,connection:{tenantId:f.tenantId},actor:f.actor,accountingFetch};
    const result=await postReviewedPaymentBatch([row],options);assert.equal(result[0].status,transportFails?'failed':'applied');
    const saved=await f.snapshot();assert.equal(saved.claims[0].control_totals.paymentPosting.state,transportFails?'uncertain':'confirmed');
    assert.equal(saved.audits.length,2);if(transportFails)assert.equal(saved.mappings,null);else assert.deepEqual(saved.mappings[0].bank_source_evidence,row.bankSourceEvidence);
    assert.equal((await postReviewedPaymentBatch([row],options))[0].status,'failed');assert.equal(writes,1);
  });
});

test('confirmed cents retain a raw Salesforce binary tail, reject material differences and recover exactly once',async t=>{
  const f=await fixture(t,{amountTail:true});const row=postingRow(f.rows[0]);
  const claim=await claimReviewedGroupPayment(f.client,f.tenantId,row,f.actor);
  const before=await f.snapshot();
  const values={xero_payment_id:f.rows[0].xeroPaymentId,xero_bank_account_id:row.bankAccountId,amount:131317.2,currency:row.currency,payment_date:row.paymentDate};
  for(const amount of [131317.21,131317.19,131317.20001,0,-1]) {
    await assert.rejects(finishReviewedGroupPayment(f.client,claim,f.actor,'confirmed',null,[values.xero_payment_id],{...values,amount}));
    assert.deepEqual(await f.snapshot(),before);
  }
  await finishReviewedGroupPayment(f.client,claim,f.actor,'confirmed',null,[values.xero_payment_id],values);
  const saved=await f.snapshot();assert.equal(saved.mappings.length,1);assert.equal(Number(saved.mappings[0].amount),131317.2);
  assert.deepEqual(saved.mappings[0].bank_source_evidence,row.bankSourceEvidence);
  assert.equal(saved.claims[0].control_totals.paymentPosting.reviewed.amount,131317.19999999995);
  assert.equal(saved.claims[0].control_totals.paymentPosting.state,'confirmed');
  assert.equal(await claimReviewedGroupPayment(f.client,f.tenantId,row,f.actor),null);
  assert.deepEqual(await f.snapshot(),saved);
  const links=await fixture(t,{amountTail:true});await links.persist([links.rows[0]]);
  const linked=await links.persist([links.rows[0]]);assert.equal(linked.summary.alreadyLinked,1);
  assert.equal((await links.snapshot()).mappings.length,1);
});
