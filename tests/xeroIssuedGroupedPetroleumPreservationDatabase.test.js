import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { buyerInvoiceApprovalProjection } from '../api/_buyerInvoiceApproval.js';
import { PGlite } from '@electric-sql/pglite';
import { issuedGroupedPetroleumFixture } from './xeroIssuedGroupedPetroleumPreservationFixtures.js';
import { issuedSupplierCanonical as stable, issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';

const policy = 'issued_grouped_petroleum_preserve_v1';
const migration = new URL('../supabase/migrations/20261111164003_xero_issued_grouped_petroleum_preservation.sql', import.meta.url);
const rpc = 'public.link_xero_issued_grouped_petroleum_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text)';
const sql = 'select public.link_xero_issued_grouped_petroleum_document_v1($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as result';
const iso = '2026-09-23T22:00:00.000Z';
const sf18 = value => value + [0, 5, 10].map(start => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[
  [...value.slice(start, start + 5)].reduce((mask, char, bit) => mask + (/[A-Z]/.test(char) ? 1 << bit : 0), 0)]).join('');
const migrations = ['20260827145608_xero_contact_sync.sql', '20260829080726_xero_financial_sync.sql',
  '20260923213339_xero_payment_reference_link.sql', '20260923222821_xero_grouped_preservation_link.sql',
  '20260927175805_xero_issued_supplier_preservation_link.sql', '20260927185526_xero_issued_petroleum_preservation_link.sql',
  '20260927213024_xero_petroleum_inactive_source_ownership.sql',
  '20260927223013_xero_trustee_source_cent_rounding.sql', '20260928005135_xero_group_remittance_bank_evidence.sql'];
function rehash(review) {
  review.accountingCanonical = stable({ policyVersion: review.policyVersion, accounting: review.evidence.accounting });
  review.evidenceCanonical = stable(review.evidence); review.fingerprint = hash(JSON.parse(review.accountingCanonical));
  review.evidenceFingerprint = hash(review.evidence); return review;
}
async function fixture(t, { direction = 'supplier', lineCount = 2, repeatedProduct = false, configure = () => {}, database = null, migrate = true } = {}) {
  const db = database || new PGlite();
  if (!database) { t.after(() => db.close()); await db.exec('create role anon; create role authenticated; create role service_role bypassrls;'); }
  await db.exec('grant usage on schema public to service_role;');
  for (const file of migrations) await db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace(/^create extension if not exists pgcrypto;$/m, ''));
  if (migrate) await db.exec(await readFile(migration, 'utf8'));
  const real = issuedGroupedPetroleumFixture({ direction, lineCount, repeatedProduct }); configure(real); real.rebuild();
  const evaluated = real.build(); assert.equal(evaluated.eligible, true, JSON.stringify(evaluated.blockers));
  const review = rehash({ policyVersion: policy, fingerprint: evaluated.fingerprint, evidenceFingerprint: evaluated.evidenceFingerprint,
    reviewFingerprint: hash('grouped review'), legacyReviewFingerprint: hash('legacy review'), evidence: evaluated.evidence });
  const source = { ...real.source, issuedGroupedSourceEvidence: structuredClone(real.facts), issuedGroupedSourceEvidenceFingerprint: hash(real.facts),
    issuedSupplierReviewFingerprint: review.reviewFingerprint, issuedSupplierPreservation: { policyVersion: policy, eligible: true,
      accepted: false, requiresExplicitReview: true, fingerprint: review.fingerprint, evidenceFingerprint: review.evidenceFingerprint,
      sourceLineCount: lineCount, xeroLineCount: 1 } };
  const actor = { id: real.ids.approver, email: ' FINANCE@example.test ' }; const runId = randomUUID(); const itemId = randomUUID();
  await db.query("insert into public.xero_contact_sync_connections (tenant_id,refresh_token) values ($1,'test-only')", [real.ids.tenant]);
  for (const row of real.stored.productMappings) await db.query(`insert into public.xero_financial_product_mappings
    (id,direction,salesforce_product_id,salesforce_product_name,xero_account_code,xero_tax_type,enabled,revision,approved_by,approved_by_email,approved_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [row.id, row.direction, row.salesforce_product_id, row.salesforce_product_name,
    row.xero_account_code, row.xero_tax_type, row.enabled, row.revision, row.approved_by, row.approved_by_email, row.approved_at]);
  await db.query(`insert into public.xero_financial_sync_runs
    (id,idempotency_key,mode,status,revision,reviewed_by,reviewed_by_email,reviewed_at,control_totals)
    values ($1::uuid,$1::text,'preview','processing',3,$2,$3,$4,$5)`, [runId, actor.id, actor.email.trim().toLowerCase(), iso, JSON.stringify({ preservationPolicy: policy })]);
  await db.query(`insert into public.xero_financial_sync_items
    (id,run_id,row_index,row_key,source_object,source_id,source_type,source_document_number,currency,source_total,proposed_action,
    status,selected,source_payload,xero_payload,xero_document_id,xero_document_status,idempotency_key,updated_at,differences)
    values ($1::uuid,$2,0,$1::text,$3,$4,$5,$6,'USD',$7,'protected_legacy','selected',true,$8,$9,$10,'AUTHORISED',$1::text,$11,'[{"field":"detailedLines"}]')`,
  [itemId, runId, source.salesforceObject, source.salesforceId, source.documentKind, source.documentNumber, source.total,
    JSON.stringify(source), JSON.stringify(real.candidate), real.ids.target, iso]);
  const values = overrides => { const p = { runId, revision: 3, itemId, updatedAt: iso, tenant: real.ids.tenant, review, actorId: actor.id, actorEmail: actor.email, ...overrides };
    return [p.runId, p.revision, p.itemId, p.updatedAt, p.tenant, JSON.stringify(p.review), p.actorId, p.actorEmail]; };
  const link = async overrides => (await db.query(sql, values(overrides))).rows[0].result;
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(m) order by id) from public.xero_financial_document_mappings m) as mappings,
    (select jsonb_agg(to_jsonb(i) order by id) from public.xero_financial_sync_items i) as items,
    (select jsonb_agg(to_jsonb(a) order by id) from public.xero_financial_audit_events a) as audits,
    (select jsonb_agg(to_jsonb(r) order by id) from public.xero_financial_sync_runs r) as runs`)).rows[0];
  return { db, real, review, source, actor, runId, itemId, values, link, snapshot };
}
async function unchangedOnReject(f, work, error = /./) {
  const before = await f.snapshot(); await assert.rejects(work, error); assert.deepEqual(await f.snapshot(), before);
}
// Rewrite both the received envelope and saved preview, including their hashes. A
// refusal then proves independent relational/raw validation instead of hash-only validation.
async function rejectRehashed(f, mutate) {
  const review = structuredClone(f.review); const source = structuredClone(f.source); mutate(review.evidence.accounting, review.evidence, source);
  const accounting = review.evidence.accounting; accounting.sourceEvidenceFingerprint = hash(accounting.sourceEvidence);
  source.issuedGroupedSourceEvidence = accounting.sourceEvidence; source.issuedGroupedSourceEvidenceFingerprint = accounting.sourceEvidenceFingerprint;
  rehash(review); source.issuedSupplierPreservation.fingerprint = review.fingerprint; source.issuedSupplierPreservation.evidenceFingerprint = review.evidenceFingerprint;
  const before = await f.snapshot(); await f.db.exec('begin');
  try { await f.db.query('update public.xero_financial_sync_items set source_payload=$1 where id=$2', [JSON.stringify(source), f.itemId]);
    await assert.rejects(f.link({ review }), /./); } finally { await f.db.exec('rollback'); }
  assert.deepEqual(await f.snapshot(), before);
}
async function ordinaryMapping(f, { sourceId = f.source.salesforceId, targetId = f.real.ids.target } = {}) {
  return f.db.query(`insert into public.xero_financial_document_mappings
    (salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,xero_contact_id,source_fingerprint,financial_fingerprint)
    values ($1,$2,'OLD',$3,$4,$5,$6,'old-source','old-financial') returning *`,
  [f.source.salesforceObject, sourceId, f.source.documentKind, f.source.xeroType, targetId, f.real.ids.contact]);
}
for (const direction of ['supplier', 'buyer']) {
  test(`${direction}: actual grouped evaluator proof atomically retains all Xero fields with no financial mutation`, async t => {
    const f = await fixture(t, { direction }); const result = await f.link(); const saved = await f.snapshot();
    assert.deepEqual({ ...result, mappingId: 'id' }, { id: f.itemId, status: 'linked', xeroDocumentId: f.real.ids.target, mappingId: 'id', alreadyLinked: false });
    assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1); assert.equal(saved.items[0].mutation_attempts, 0);
    assert.equal(saved.mappings[0].protected_legacy, true); assert.equal(saved.mappings[0].document_kind, f.source.documentKind);
    const receipt = saved.mappings[0].retained_differences.issuedSupplierPreservation;
    assert.deepEqual(receipt.evidence, f.review.evidence); assert.deepEqual(receipt.reviewedXero, f.real.candidate);
    assert.deepEqual(saved.items[0].source_payload, f.source); assert.deepEqual(saved.items[0].xero_payload, f.real.candidate);
    assert.equal(saved.audits[0].actor_id, f.actor.id); assert.equal(saved.audits[0].actor_email, 'finance@example.test');
    assert.equal(saved.audits[0].event_type, 'issued_grouped_petroleum_document_preservation_linked');
    assert.deepEqual(saved.audits[0].record_counts, { linked: 1, applied: 0, financialWrites: 0 });
    assert.equal((await f.link()).alreadyLinked, true); assert.deepEqual(await f.snapshot(), saved);
  });
  test(`${direction}: repeated Product2 on distinct physical children uses one current approved mapping`, async t => {
    const f = await fixture(t, { direction, lineCount: 3, repeatedProduct: true }); assert.equal((await f.link()).status, 'linked');
    assert.equal(f.review.evidence.accounting.productMappings.length, 1);
  });
}

for (const direction of ['supplier', 'buyer']) {
  test(`${direction}: independently rejects malformed or rehashed raw/native/accounting proof`, async t => {
    const f = await fixture(t, { direction }); const amount = direction === 'buyer' ? 'Total_Price__c' : 'Total_Cost__c';
    const invoice = direction === 'buyer' ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c';
    const changes = {
      'unknown normalized property': a => { a.unreviewed = true; },
      'missing normalized property': a => { delete a.source.companyCode; },
      'missing cutoff': a => { delete a.cutoffDate; },
      'wrong cutoff': a => { a.cutoffDate = '2025-01-01'; },
      'wrong org even with repaired file binding': a => { a.salesforceOrgId = '00D000000000099'; a.issuedFile.orgId = a.salesforceOrgId; },
      'one child': a => { a.sourceEvidence.lines.pop(); },
      'fifty-one children': a => { a.sourceEvidence.lines = Array.from({ length: 51 }, () => a.sourceEvidence.lines[0]); },
      'normalized target description differs': a => { a.xero.lines[0].description = 'DIFFERENT'; },
      'unknown policy': (_a, e) => { e.policyVersion = 'issued_petroleum_preserve_v1'; },
      'missing raw source': a => { delete a.sourceEvidence.parent; },
      'unknown raw source property': a => { a.sourceEvidence.authorised = true; },
      'missing raw product type': a => { delete a.sourceEvidence.products[0].RecordType.DeveloperName; },
      'wrong product type': a => { a.sourceEvidence.products[0].RecordType.DeveloperName = 'Extra'; },
      'missing product state': a => { delete a.sourceEvidence.products[0].IsActive; },
      'deleted product': a => { a.sourceEvidence.products[0].IsDeleted = true; },
      'wrong parent owner': a => { a.sourceEvidence.parent[direction === 'buyer' ? 'STEM__r' : 'Supplier__c'] = direction === 'buyer' ? { ...a.sourceEvidence.parent.STEM__r, Account__c: '001000000000099' } : '001000000000099'; },
      'wrong direction': a => { a.direction = direction === 'buyer' ? 'supplier' : 'buyer'; },
      'deleted child': a => { a.sourceEvidence.lines[0].IsDeleted = true; },
      'cancelled child': a => { a.sourceEvidence.lines[0].Cancelled__c = true; },
      'missing child deletion state': a => { delete a.sourceEvidence.lines[0].IsDeleted; },
      'wrong native child': a => { a.issuedFile.review.lines[0].sourceChildId = a.issuedFile.review.lines[1].sourceChildId; },
      'duplicate raw child': a => { a.sourceEvidence.lines[1] = a.sourceEvidence.lines[0]; },
      'missing inventory child': a => { a.sourceEvidence.stemLines.pop(); },
      'extra selected inventory child': a => { a.sourceEvidence.stemLines.push({ ...a.sourceEvidence.stemLines[0], Id: 'a05000000000099' }); },
      'extra selected charge': a => { a.sourceEvidence.extras.push({ Id: 'a0E000000000001' }); },
      'extra bound STEM charge': a => { a.sourceEvidence.stemExtras.push({ ...a.sourceEvidence.stemLines[0], Id: 'a0E000000000001' }); },
      'wrong invoice child': a => { a.sourceEvidence.lines[0][invoice] = direction === 'buyer' ? 'a0K000000000099' : 'a06000000000099'; },
      'missing opposite invoice binding': a => { delete a.sourceEvidence.lines[0][direction === 'buyer' ? 'Supplier_Invoice__c' : 'Buyer_Invoice__c']; },
      'unbound live nonzero physical child': a => { a.sourceEvidence.stemLines.push({ ...a.sourceEvidence.stemLines[0], Id: 'a05000000000099', [invoice]: null }); },
      'unbound live negative extra': a => { a.sourceEvidence.stemExtras.push({ ...a.sourceEvidence.stemLines[0], Id: 'a0E000000000099', [invoice]: null, Line_Total__c: -1, Line_Total_Buy__c: -1 }); },
      'unbound live unknown amount': a => { a.sourceEvidence.stemLines.push({ ...a.sourceEvidence.stemLines[0], Id: 'a05000000000099', [invoice]: null, [amount]: null }); },
      'malformed nonnull binding': a => { a.sourceEvidence.stemLines[0][invoice] = ''; },
      'wrong STEM': a => { a.sourceEvidence.lines[0].STEM__c = 'a0H000000000099'; },
      'wrong BDN date': a => { a.sourceEvidence.lines[0].BDN_Delivery_Date__c = '2026-01-02'; },
      'wrong BDN quantity': a => { a.sourceEvidence.lines[0].Quantity_Delivered_Per_BDN__c = 11; },
      'signed amount': a => { a.sourceEvidence.lines[0][amount] = -100; },
      'zero amount': a => { a.sourceEvidence.lines[0][amount] = 0; },
      'raw subcent extension': a => { a.sourceEvidence.lines[0][amount] = 100.001; },
      'raw arithmetic with repaired amount inventory': a => { a.sourceEvidence.lines[0].Quantity_Delivered_Per_BDN__c = 10.001; a.source.lines[0].quantity = '10.001'; a.deliveryIdentity.lines[0].quantity = '10.001'; a.issuedFile.review.lines[0].quantity = '10.001'; },
      'native price differs': a => { a.issuedFile.review.lines[0].unitPrice = '11'; },
      'native product differs': a => { a.issuedFile.review.lines[0].sourceProductId = a.issuedFile.review.lines[1].sourceProductId; },
      'native sourcefile parent differs': a => { a.issuedFile.link.parentId = direction === 'buyer' ? 'a0K000000000099' : 'a06000000000099'; },
      'native checksum differs': a => { a.issuedFile.version.checksum = 'f'.repeat(32); },
      'native version no longer latest': a => { a.issuedFile.version.isLatest = false; },
      'native wrong IMO': a => { a.issuedFile.review.imo = '1234567'; },
      'native wrong legal owner': a => { a.issuedFile.review[direction === 'buyer' ? 'buyerName' : 'sellerName'] = 'ANOTHER COMPANY'; },
      'wrong target raw line': a => { a.xero.rawLineItems[0].Description = 'mutated'; },
      'wrong target unowned field': a => { a.xero.unowned.HasAttachments = !a.xero.unowned.HasAttachments; },
      'tracking': a => { a.source.lines[0].tracking = [{ Name: 'Region', Option: 'test' }]; },
      'inventory': a => { a.source.lines[0].itemCode = 'FUEL'; },
      'wrong ledger': a => { a.source.lines[0].accountCode = '99999'; },
      'wrong applicability': a => { a.accountTax.tax[direction === 'buyer' ? 'CanApplyToRevenue' : 'CanApplyToExpenses'] = false; },
      'unknown ownership marker': a => { a.identityOwnershipPolicy = 'future_v2'; },
      'null ownership marker': a => { a.identityOwnership = null; },
      'ambiguous source identity': a => { a.identityScope.sourceIds.push(direction === 'buyer' ? 'a0K000000000099' : 'a06000000000099'); },
      'ambiguous target identity': a => { a.identityScope.targetIds.push(randomUUID()); },
      'duplicate product mapping': a => { a.productMappings.push(a.productMappings[0]); },
      'missing product mapping': a => { a.productMappings.pop(); },
    };
    if (direction === 'buyer') Object.assign(changes, {
      'buyer proforma': a => { a.sourceEvidence.parent.Proforma__c = true; },
      'buyer deprecated': a => { a.sourceEvidence.parent.Deprecated__c = true; },
      'buyer missing File': a => { a.sourceEvidence.parent.File__c = null; },
      'buyer malformed approval snapshot': a => { a.sourceEvidence.parent.Buyer_Charge_Snapshot__c = '{'; },
      'buyer absent snapshot fact': a => { delete a.sourceEvidence.parent.Buyer_Charge_Snapshot__c; },
      'buyer manufactured snapshot': a => { a.issuanceBasis.buyerSnapshotHash = 'a'.repeat(64); },
      'buyer wrong printed STEM': a => { a.issuedFile.review.printedNumber = 'HK2611111T'; },
    });
    else changes['supplier original owner differs'] = a => { a.sourceEvidence.lines[0].Original_Supplier__c = '001000000000099'; };
    for (const [name, change] of Object.entries(changes)) await t.test(name, () => rejectRehashed(f, change));
  });
}

test('SQL permissions are service-only and service-role executes the complete link', async t => {
  const f = await fixture(t);
  for (const role of ['public', 'anon', 'authenticated']) {
    if (role !== 'public') assert.equal((await f.db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, rpc])).rows[0].allowed, false);
  }
  assert.equal((await f.db.query('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') as allowed', [rpc])).rows[0].allowed, true);
  await f.db.exec('set role service_role'); assert.equal((await f.link()).status, 'linked'); await f.db.exec('reset role');
});

test('run/item/actor/tenant/current approved mappings are independently bound', async t => {
  const f = await fixture(t);
  for (const [name, overrides] of Object.entries({ actor: { actorId: randomUUID() }, email: { actorEmail: 'wrong@example.test' }, tenant: { tenant: randomUUID() }, revision: { revision: 4 }, itemTime: { updatedAt: '2026-09-23T22:00:01.000Z' } })) {
    await t.test(name, () => unchangedOnReject(f, () => f.link(overrides)));
  }
  const drifts = {
    'disabled mapping': "update public.xero_financial_product_mappings set enabled=false",
    'mapping revision': 'update public.xero_financial_product_mappings set revision=revision+1',
    'mapping ledger': "update public.xero_financial_product_mappings set xero_account_code='99999'",
    'mapping approval actor': 'update public.xero_financial_product_mappings set approved_by=null',
    'mapping approval timestamp': "update public.xero_financial_product_mappings set approved_at='2026-09-22'",
    'wrong run policy': "update public.xero_financial_sync_runs set control_totals='{}'",
    'unreviewed run': 'update public.xero_financial_sync_runs set reviewed_at=null',
    'missing selected state': 'update public.xero_financial_sync_items set selected=false',
    'posting proposal': "update public.xero_financial_sync_items set proposed_payload='{\"Invoices\":[]}'",
    'provider attempt': 'update public.xero_financial_sync_items set mutation_attempts=1',
    'stripped marker': "update public.xero_financial_sync_items set source_payload=source_payload-'issuedSupplierPreservation'",
    'stripped raw proof': "update public.xero_financial_sync_items set source_payload=source_payload-'issuedGroupedSourceEvidence'",
    'target edited': "update public.xero_financial_sync_items set xero_payload=jsonb_set(xero_payload,'{reference}','\"CHANGED\"')",
    'target omitted accounting': "update public.xero_financial_sync_items set xero_payload=xero_payload-'groupedAccounting'",
    'target contradictory accounting': "update public.xero_financial_sync_items set xero_payload=jsonb_set(xero_payload,'{groupedAccounting,totalTax}','1')",
    'target settled': "update public.xero_financial_sync_items set xero_payload=jsonb_set(xero_payload,'{amountPaid}','1')",
  };
  for (const [name, drift] of Object.entries(drifts)) await t.test(name, async () => {
    await f.db.exec('begin'); try { await f.db.exec(drift); const before = await f.snapshot(); await f.db.exec('savepoint rejected_link'); await assert.rejects(f.link()); await f.db.exec('rollback to rejected_link'); assert.deepEqual(await f.snapshot(), before); } finally { await f.db.exec('rollback'); }
  });
});

test('immutable receipt and audit survive exact retry; stripped or changed acceptance cannot retry', async t => {
  const f = await fixture(t); await f.link();
  const changes = ["update public.xero_financial_document_mappings set retained_differences='{}'",
    "update public.xero_financial_document_mappings set source_fingerprint='changed'",
    "update public.xero_financial_document_mappings set xero_document_id='00000000-0000-4000-8000-000000000099'",
    'delete from public.xero_financial_document_mappings', 'delete from public.xero_financial_audit_events',
    "update public.xero_financial_audit_events set fingerprints='{}'"];
  for (const query of changes) await unchangedOnReject(f, () => f.db.exec(query));
  await unchangedOnReject(f, () => f.link({ review: { ...f.review, reviewFingerprint: hash('another reviewer acceptance') } }));
});

test('audit failure rolls back mapping and selected-item outcome atomically', async t => {
  const f = await fixture(t); await f.db.exec(`create function public.test_reject_grouped_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit failure'; end; $$;
    create trigger test_reject_grouped_audit before insert on public.xero_financial_audit_events for each row execute function public.test_reject_grouped_audit();`);
  await unchangedOnReject(f, () => f.link(), /test audit failure/);
});

for (const conflict of ['source alias', 'target']) test(`existing ${conflict} owner refuses the entire acceptance`, async t => {
  const f = await fixture(t); await ordinaryMapping(f, { sourceId: conflict === 'source alias' ? sf18(f.source.salesforceId.slice(0, 15)) : 'a06000000000099', targetId: conflict === 'target' ? f.real.ids.target : randomUUID() });
  await unchangedOnReject(f, () => f.link());
});

test('new migration leaves every older policy function and existing mapping/audit bytes unchanged', async t => {
  const f = await fixture(t, { migrate: false });
  await ordinaryMapping(f);
  for (const [index, marker] of [
    { groupedPreservation: { policyVersion: 'grouped_preserve_v1', fingerprint: hash('old grouped'), evidence: { literal: 'original grouped receipt' } } },
    { issuedSupplierPreservation: { policyVersion: 'issued_supplier_preserve_v1', evidence: { literal: 'original supplier receipt' } } },
    { issuedSupplierPreservation: { policyVersion: 'issued_petroleum_preserve_v1', evidence: { literal: 'original singleton petroleum receipt' } } },
    { issuedSupplierPreservation: { policyVersion: 'issued_petroleum_preserve_v1', evidence: { accounting: { identityOwnershipPolicy: 'document_specific_inactive_source_owners_v1', identityOwnership: { original: true } } } } },
  ].entries()) {
    const row = (await ordinaryMapping(f, { sourceId: `a06${String(index + 20).padStart(12, '0')}`, targetId: randomUUID() })).rows[0];
    await f.db.query('update public.xero_financial_document_mappings set retained_differences=$1 where id=$2', [JSON.stringify(marker), row.id]);
  }
  await f.db.query(`insert into public.xero_financial_audit_events (run_id,event_type,outcome,record_counts,fingerprints) values ($1,'legacy','success','{}','{"legacy":true}')`, [f.runId]);
  const before = await f.snapshot(); const definitions = async () => (await f.db.query("select proname,pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace and proname in ('link_xero_grouped_document_v1','link_xero_issued_supplier_document_v1','link_xero_issued_petroleum_document_v1') order by proname")).rows;
  const old = await definitions(); assert.equal(old.length, 3); await f.db.exec(await readFile(migration, 'utf8'));
  assert.deepEqual(await f.snapshot(), before); assert.deepEqual(await definitions(), old);
});

for (const direction of ['supplier', 'buyer']) test(`${direction}: fifty distinct product children retain the entire proof within unchanged byte bounds`, async t => {
  const f = await fixture(t, { direction, lineCount: 50 });
  assert.ok(Buffer.byteLength(f.review.accountingCanonical) <= 100000); assert.ok(Buffer.byteLength(f.review.evidenceCanonical) <= 100000);
  assert.ok(Buffer.byteLength(JSON.stringify(f.review)) <= 400000); assert.equal((await f.link()).status, 'linked');
  const retained = (await f.snapshot()).mappings[0].retained_differences.issuedSupplierPreservation.evidence;
  assert.equal(retained.accounting.sourceEvidence.lines.length, 50); assert.equal(retained.accounting.sourceEvidence.stemLines.length, 50);
  assert.equal(retained.accounting.productMappings.length, 50); assert.deepEqual(retained, f.review.evidence);
});

test('bounded envelope refuses oversized canonical/raw evidence without truncation', async t => {
  const f = await fixture(t);
  await rejectRehashed(f, a => { a.sourceEvidence.parent.Long_Observed_Field__c = 'x'.repeat(100000); });
  await unchangedOnReject(f, () => f.link({ review: { ...f.review, surplus: 'x'.repeat(400001) } }));
});

test('buyer approved projection is independently rebuilt from complete children, current STEM and native version', async t => {
  const f = await fixture(t, { direction: 'buyer', configure: real => {
    real.parent._buyerInvoiceDocument = { Id: real.ids.document, LatestPublishedVersionId: real.fileEvidence.versionId };
    const invoice = real.parent;
    real.parent.Buyer_Charge_Snapshot__c = JSON.stringify(buyerInvoiceApprovalProjection(invoice,
      { stem: { ...real.parent.STEM__r, Id: real.parent.STEM__c }, allLineItems: real.lines, allExtraCosts: [] }));
  } });
  assert.equal((await f.link()).status, 'linked'); assert.match(f.review.evidence.accounting.issuanceBasis.buyerSnapshotHash, /^[a-f0-9]{64}$/);
});

test('15/18 aliases bind raw child/inventory/product facts without broad string matching', async t => {
  const f = await fixture(t); const review = structuredClone(f.review); const raw = review.evidence.accounting.sourceEvidence;
  for (const row of [...raw.lines, ...raw.products, ...raw.stemLines]) {
    for (const key of ['Id', 'STEM__c', 'Product__c', 'Original_Supplier__c', 'Buyer_Invoice__c', 'Supplier_Invoice__c']) if (typeof row[key] === 'string' && row[key].length === 15) row[key] = sf18(row[key]);
  }
  review.evidence.accounting.sourceEvidenceFingerprint = hash(raw); rehash(review);
  const source = { ...f.source, issuedGroupedSourceEvidence: raw, issuedGroupedSourceEvidenceFingerprint: hash(raw),
    issuedSupplierPreservation: { ...f.source.issuedSupplierPreservation, fingerprint: review.fingerprint, evidenceFingerprint: review.evidenceFingerprint } };
  await f.db.query('update public.xero_financial_sync_items set source_payload=$1 where id=$2', [JSON.stringify(source), f.itemId]);
  assert.equal((await f.link({ review })).status, 'linked');
});

const concurrencyUrl = process.env.FCOS_ISSUED_GROUPED_PETROLEUM_TEST_DATABASE_URL;
async function postgresFixture(t, options = {}) {
  const endpoint = new URL(concurrencyUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Use a disposable local PostgreSQL endpoint');
  assert.ok(['postgres:', 'postgresql:'].includes(endpoint.protocol));
  const admin = new pg.Client({ connectionString: endpoint.toString() }); await admin.connect();
  const dbName = `fcos_grouped_petroleum_${randomUUID().replaceAll('-', '')}`; let created = false; const clients = [];
  t.after(async () => { for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end(); }
    if (created) await admin.query(`drop database "${dbName}" with (force)`); await admin.end(); });
  for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await admin.query('select count(*)::int as n from pg_roles where rolname=$1', [role])).rows[0].n, 1);
  await admin.query(`create database "${dbName}"`); created = true; endpoint.pathname = `/${dbName}`;
  const connect = async () => { const client = new pg.Client({ connectionString: endpoint.toString() }); await client.connect();
    await client.query("set statement_timeout='8s'; set lock_timeout='6s'"); clients.push(client); return client; };
  const primary = await connect(); const f = await fixture(t, { ...options, database: { query: (...args) => primary.query(...args), exec: text => primary.query(text) } });
  const call = (client, overrides) => client.query(sql, f.values(overrides)).then(result => result.rows[0].result);
  const waitForLock = async client => { for (let attempt = 0; attempt < 120; attempt += 1) {
    if ((await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [client.processID])).rows[0]?.wait_event_type === 'Lock') return;
    await delay(25); } assert.fail('Expected the competing transaction to wait on a PostgreSQL lock'); };
  return { ...f, primary, connect, call, waitForLock };
}

test('real PostgreSQL grouped acceptance/ownership/current-control races', {
  skip: !concurrencyUrl && 'Set FCOS_ISSUED_GROUPED_PETROLEUM_TEST_DATABASE_URL to a disposable local Supabase-compatible PostgreSQL endpoint', timeout: 60000,
}, async t => {
  for (const direction of ['supplier', 'buyer']) await t.test(`${direction}: same item retry serializes to one immutable acceptance`, async child => {
    const f = await postgresFixture(child, { direction }); const second = await f.connect(); await f.primary.query('begin'); const first = await f.call(f.primary);
    const pending = f.call(second).then(value => ({ value }), error => ({ error })); await f.waitForLock(second); await f.primary.query('commit');
    assert.deepEqual((await pending).value, { ...first, alreadyLinked: true }); const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
  });
  await t.test('distinct reviewed items in one run cannot create duplicate ownership', async child => {
    const f = await postgresFixture(child); const second = await f.connect(); const otherId = randomUUID();
    await f.primary.query(`insert into public.xero_financial_sync_items
      select (jsonb_populate_record(null::public.xero_financial_sync_items, to_jsonb(i)||jsonb_build_object('id',$1::uuid,'row_key',$1::text,'idempotency_key',$1::text,'row_index',1))).*
      from public.xero_financial_sync_items i where id=$2`, [otherId, f.itemId]);
    await f.primary.query('begin'); await f.call(f.primary);
    const pending = f.call(second, { itemId: otherId }).then(() => ({}), error => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit'); assert.equal((await pending).error?.code, '40001');
    const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
    assert.equal(saved.items.find(row => row.id === otherId).status, 'selected');
  });
  for (const conflict of ['source', 'target']) for (const first of ['grouped', 'ordinary']) await t.test(`${first} wins the canonical ${conflict} race without partial acceptance`, async child => {
    const f = await postgresFixture(child); const second = await f.connect();
    const ordinary = () => second.query(`insert into public.xero_financial_document_mappings
      (salesforce_object,salesforce_id,salesforce_document_number,document_kind,xero_document_type,xero_document_id,source_fingerprint,financial_fingerprint)
      values ('Supplier_Invoice__c',$1,'ORDINARY','supplier_bill','ACCPAY',$2,'ordinary','ordinary')`,
    [conflict === 'source' ? sf18(f.source.salesforceId.slice(0, 15)) : 'a06000000000099', conflict === 'target' ? f.real.ids.target.toUpperCase() : randomUUID()]);
    if (first === 'grouped') {
      await f.primary.query('begin'); await f.call(f.primary); const pending = ordinary().then(() => ({}), error => ({ error }));
      await f.waitForLock(second); await f.primary.query('commit'); assert.equal((await pending).error?.code, '23505');
      const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
    } else {
      await second.query('begin'); await ordinary(); const pending = f.call(f.primary).then(() => ({}), error => ({ error }));
      await f.waitForLock(f.primary); await second.query('commit'); assert.ok(['23505', '40001'].includes((await pending).error?.code));
      const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits, null); assert.equal(saved.items[0].status, 'selected');
    }
  });
  for (const drift of ['product revision', 'approval revoked', 'tenant', 'item selected']) await t.test(`${drift} change wins its lock and refuses the stale proof`, async child => {
    const f = await postgresFixture(child); const second = await f.connect(); await second.query('begin');
    const query = { 'product revision': 'update public.xero_financial_product_mappings set revision=revision+1',
      'approval revoked': 'update public.xero_financial_product_mappings set approved_at=null',
      tenant: "update public.xero_contact_sync_connections set tenant_id='00000000-0000-4000-8000-000000000099'",
      'item selected': 'update public.xero_financial_sync_items set selected=false' }[drift];
    await second.query(query); const pending = f.call(f.primary).then(() => ({}), error => ({ error }));
    await f.waitForLock(f.primary); await second.query('commit'); assert.equal((await pending).error?.code, '40001');
    const saved = await f.snapshot(); assert.equal(saved.mappings, null); assert.equal(saved.audits, null); assert.equal(saved.items[0].status, 'selected');
  });
});

for (const direction of ['supplier', 'buyer']) test(`${direction}: retained inactive owner proof is accepted without merging the Accounts`, async t => {
  const f = await fixture(t, { direction, configure: real => {
    const other = { id: '001000000000099', name: real.account.Name, companyCode: 'SINGAPORE EXAMPLE', recordType: 'Buyer', inactiveSuspended: true };
    real.salesforce.groupedAccountSnapshot.accounts.push(other); real.scope.coverage.sourceAccountIds.push(other.id);
  } });
  assert.equal(f.review.evidence.accounting.identityOwnership.owners.length, 2); await f.link();
  const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1);
  assert.deepEqual(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.identityOwnership,
    f.review.evidence.accounting.identityOwnership);
});

test('complete zero, cancelled and deleted unbound inventory remains retained without becoming a child charge', async t => {
  const f = await fixture(t, { configure: real => {
    const physical = { ...real.facts.stemLines[0], Id: 'a05000000000099', Supplier_Invoice__c: null, Total_Cost__c: 0 };
    real.facts.stemLines.push(physical, { ...physical, Id: 'a05000000000098', Cancelled__c: true, Total_Cost__c: 5 });
    real.facts.stemExtras.push({ ...physical, Id: 'a0E000000000099', IsDeleted: true, Line_Total_Buy__c: -5 },
      { ...physical, Id: 'a0E000000000098', Line_Total_Buy__c: 0 });
  } });
  await f.link(); const raw = (await f.snapshot()).mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.sourceEvidence;
  assert.equal(raw.lines.length, 2); assert.equal(raw.stemLines.length, 4); assert.equal(raw.stemExtras.length, 2);
});
