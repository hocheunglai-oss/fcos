import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { evaluateIssuedPetroleumPreservation } from '../api/_xeroIssuedPetroleumPreservation.js';
import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { issuedPetroleumV2Fixture } from './xeroIssuedPetroleumV2Fixtures.js';
import { validateIssuedPetroleumAttachmentManifest } from '../api/_xeroIssuedPetroleumPaper.js';
import { issuedPetroleumFixture, issuedPetroleumOwnerFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { derivePetroleumOwnership, bindPetroleumOwnership, petroleumOwnershipFingerprint } from '../api/_xeroIssuedPetroleumOwnership.js';

const originalMigration = new URL('../supabase/migrations/20260927185526_xero_issued_petroleum_preservation_link.sql', import.meta.url);
const migration = new URL('../supabase/migrations/20260927213024_xero_petroleum_inactive_source_ownership.sql', import.meta.url);
const attachmentMigration = new URL('../supabase/migrations/20260928033217_xero_issued_petroleum_attachment_preservation_v2.sql', import.meta.url);
const v2Policy = 'issued_petroleum_preserve_v2';
const v2Rpc = 'public.link_xero_issued_petroleum_document_v2(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text)';
const v2Sql = 'select public.link_xero_issued_petroleum_document_v2($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as result';
const rpc = 'public.link_xero_issued_petroleum_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text)';
const sql = 'select public.link_xero_issued_petroleum_document_v1($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as result';
const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sf18 = (value) => value + [0, 5, 10].map((start) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[
  [...value.slice(start, start + 5)].reduce((mask, char, bit) => mask + (/[A-Z]/.test(char) ? 1 << bit : 0), 0)]).join('');
const iso = '2026-09-23T22:00:00.000Z';

// Use the actual independent pure evaluator for every positive transaction proof.
// The database suite then tampers/re-hashes evidence to test its own boundaries.
const evaluateDatabaseFixture = evaluateIssuedPetroleumPreservation;

async function applyPetroleumMigrations(db, ownership = true) {
  await db.exec(await readFile(originalMigration, 'utf8'));
  if (ownership) await db.exec(await readFile(migration, 'utf8'));
}

async function fixture(t, { migrate = true, ownership = true, attachmentPolicy = false, database = null, evaluator = evaluateDatabaseFixture, configure = () => {} } = {}) {
  const db = database || new PGlite();
  if (!database) {
    t.after(() => db.close());
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  }
  await db.exec('grant usage on schema public to service_role;');
  for (const file of ['20260827145608_xero_contact_sync.sql', '20260829080726_xero_financial_sync.sql', '20260923213339_xero_payment_reference_link.sql', '20260923222821_xero_grouped_preservation_link.sql', '20260927175805_xero_issued_supplier_preservation_link.sql']) {
    await db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace(/^create extension if not exists pgcrypto;$/m, ''));
  }
  if (migrate) await applyPetroleumMigrations(db, ownership);
  if (migrate && attachmentPolicy) await db.exec(await readFile(attachmentMigration, 'utf8'));
  const tenant = randomUUID(); const actor = { id: randomUUID(), email: ' FINANCE@example.test ' };
  const ids = { source: 'a01000000000001', account: '001000000000001', product: '01t000000000001', contact: randomUUID(), target: randomUUID(), productMapping: randomUUID() };
  const line = { description: 'Fuel', quantity: '1', unitAmount: '10.01', lineAmount: '10.01', accountCode: '51100',
    taxType: 'NONE', taxAmount: '0', discountRate: '0', discountAmount: '0', tracking: [], itemCode: '' };
  const input = {
    tenantId: tenant, salesforceOrgId: fcosSalesforceEnvironment('production').orgId, cutoffDate: '2026-01-01', organisation: { baseCurrency: 'USD' },
    source: { complete: true, salesforceObject: 'Supplier_Invoice__c', salesforceId: ids.source, accountId: ids.account,
      contactId: ids.contact, sourceFingerprint: hash('authoritative source'), documentNumber: 'PT202601', reference: 'HK26123T', stemKey: 'HK26123T', companyCode: 'HKPETROLEUM SUPPLIER',
      invoiceDate: '2026-01-03', dueDate: '2026-02-03', deliveryDate: '2026-01-02', xeroType: 'ACCPAY', xeroCollection: 'Invoices',
      currency: 'USD', subtotal: '30.03', total: '30.03', signedTotal: '30.03', totalTax: '0', lineAmountTypes: 'NoTax', isDiscounted: false,
      readiness: { ready: false, blockers: ['Supplier invoice has no verified issued source file.'], linkedChildren: ['a02000000000001'] },
      blockers: ['Supplier invoice has no verified issued source file.'], financialFingerprint: hash('financial'),
      stemId: 'a03000000000001', vessel: 'VESSEL ONE', issuedSupplierVessel: 'VESSEL ONE', accountName: 'PETROLEUM SUPPLIER',
      lines: [{ ...line, id: 'a02000000000001', productId: ids.product, currency: 'USD', quantity: '3', lineAmount: '30.03', productName: 'MARINE FUEL' }] },
    xero: { complete: true, id: ids.target, collection: 'Invoices', type: 'ACCPAY', status: 'AUTHORISED', contactId: ids.contact,
      invoiceNumber: '001P- VESSEL ONE', reference: 'Legacy retained reference', date: '2026-01-02', dueDate: '2026-02-02',
      currency: 'USD', currencyRate: '1', subtotal: '30.03', total: '30.03', totalTax: '0', lineAmountTypes: 'Exclusive',
      isDiscounted: false, amountDue: '30.03', amountPaid: '0', amountCredited: '0', paymentClaims: [], creditClaims: [], prepaymentClaims: [], overpaymentClaims: [],
      settlementEvidence: { basis: 'complete_invoice_zero_balances_optional_collections_v1',
        collections: Object.fromEntries(['Payments', 'CreditNotes', 'Prepayments', 'Overpayments'].map((key) => [key, { present: true, rows: [] }])) },
      lines: [{ ...line, id: randomUUID(), unitAmount: '30.03', lineAmount: '30.03' }] },
    productMappings: [{ id: ids.productMapping, direction: 'supplier', salesforceProductId: ids.product,
      xeroAccountCode: '51100', xeroTaxType: 'NONE', enabled: true, revision: 1,
      approvedBy: actor.id, approvedByEmail: actor.email.trim().toLowerCase(), approvedAt: iso }],
    identity: { complete: true, matchBasis: 'invoice_number', candidateXeroDocumentIds: [ids.target], documentIdentitySourceIds: [ids.source],
      numberCollisionXeroIds: [ids.target], numberCollisionSourceIds: [ids.source], creditCollisionIds: [], coverageFingerprint: hash('complete claim scope'),
      candidateContactIds: [ids.contact], accountIdsForContact: [ids.account], sourceMappings: [], targetMappings: [],
      contactIdentity: { salesforceAccountId: ids.account, xeroContactId: ids.contact, status: 'ACTIVE', matchBasis: 'account_name',
        sourceMatchValue: 'supplier', xeroMatchValue: 'supplier', evidenceFingerprint: hash('identity') } },
  };
  input.xero.rawLineItems = [{ LineItemID: input.xero.lines[0].id, Description: 'Original aggregate charge',
    Quantity: 1, UnitAmount: 30.03, LineAmount: 30.03, AccountCode: '51100', TaxType: 'NONE', TaxAmount: 0, Tracking: [] }];
  input.xero.unowned = { HasAttachments: false, SentToContact: false };
  input.fileEvidence = { orgId: fcosSalesforceEnvironment('production').orgId, parentId: ids.source,
    documentId: '069000000000001', versionId: '068000000000001', sha256: hash('issued PDF bytes'),
    checksum: createHash('md5').update('issued PDF bytes').digest('hex'), contentSize: 16, contentType: 'application/pdf',
    link: { id: '06A000000000001', parentId: ids.source, documentId: '069000000000001' },
    version: { id: '068000000000001', documentId: '069000000000001', isLatest: true, latestPublishedVersionId: '068000000000001',
      checksum: createHash('md5').update('issued PDF bytes').digest('hex'), contentSize: 16 },
    review: { reviewer: 'Fixture finance review', reviewedAt: iso, reviewRecordHash: hash('reviewed literal issued facts'),
      sourceNumber: 'PT202601', printedNumber: 'PT-2026-01', sellerName: 'PETROLEUM SUPPLIER',
      buyerName: 'FRATELLI COSULICH BUNKERS (HK) LTD', invoiceDate: '2026-01-03', dueDate: '2026-02-03',
      currency: 'USD', total: '30.03', totalTax: null, taxEvidence: 'no_tax_line_or_increment_observed', vessel: 'VESSEL ONE',
      numberRule: 'reviewed_ascii_hyphens', deliveryDate: null,
      counterparties: { accountId: ids.account, contactId: ids.contact, tenantId: tenant, sourceName: input.source.accountName,
        companyCode: input.source.companyCode, printedSeller: 'PETROLEUM SUPPLIER', printedBuyer: 'FRATELLI COSULICH BUNKERS (HK) LTD', basis: 'independently_reviewed_literal_pair' },
      lines: [{ description: 'Marine fuel', amount: '30.03', quantity: '3', unit: 'MT', unitPrice: '10.01',
        sourceProductId: ids.product, sourceProductName: 'MARINE FUEL', productEvidence: 'Reviewed exact current Product2 relationship' }] } };
  input.deliveryIdentity = { parentId: ids.source, stemId: input.source.stemId, stemKey: input.source.stemKey,
    vesselId: 'a04000000000001', vessel: 'VESSEL ONE', deliveryDate: '2026-01-02', childId: input.source.lines[0].id,
    supplierId: ids.account, productId: ids.product, productName: 'MARINE FUEL', productRecordType: 'Petroleum_Product',
    quantity: '3', unit: 'MT', unitAmount: '10.01', lineAmountCents: '3003', sourceFactsFingerprint: hash('authoritative raw delivery and child') };
  input.accountTax = { account: { AccountID: randomUUID(), Code: '51100', Name: 'Cost of marine fuel', Type: 'DIRECTCOSTS', Status: 'ACTIVE' },
    tax: { TaxType: 'NONE', Status: 'ACTIVE', DisplayTaxRate: 0, EffectiveRate: 0, CanApplyToExpenses: true } };
  if (attachmentPolicy) configureAttachments(input);
  configure(input);
  const evaluated = evaluator(input);
  assert.equal(evaluated.eligible, true, JSON.stringify(evaluated.blockers));
  const review = { policyVersion: evaluated.policyVersion, fingerprint: evaluated.fingerprint,
    evidenceFingerprint: hash(stable(evaluated.evidence)), reviewFingerprint: hash('review'), legacyReviewFingerprint: hash('legacy review'),
    evidence: evaluated.evidence, accountingCanonical: stable({ policyVersion: evaluated.policyVersion, accounting: evaluated.evidence.accounting }),
    evidenceCanonical: stable(evaluated.evidence) };
  const source = { ...input.source, salesforceId: sf18(ids.source), accountId: sf18(ids.account), documentKind: 'supplier_bill',
    financialFingerprint: hash('financial'), stemId: 'a03000000000001', issuedSupplierReviewFingerprint: review.reviewFingerprint,
    issuedSupplierPreservation: { policyVersion: review.policyVersion, eligible: true, fingerprint: review.fingerprint,
      evidenceFingerprint: review.evidenceFingerprint, accepted: false, requiresExplicitReview: true,
      sourceLineCount: 1, xeroLineCount: 1 } };
  const runId = randomUUID(); const itemId = randomUUID();
  await db.query("insert into public.xero_contact_sync_connections (tenant_id,refresh_token) values ($1,'test-only')", [tenant]);
  await db.query(`insert into public.xero_financial_product_mappings
    (id,direction,salesforce_product_id,salesforce_product_name,xero_account_code,xero_tax_type,approved_by,approved_by_email,approved_at)
    values ($1,'supplier',$2,'Fuel','51100','NONE',$3,$4,$5)`, [ids.productMapping, sf18(ids.product), actor.id, actor.email.trim().toLowerCase(), iso]);
  await db.query(`insert into public.xero_financial_sync_runs
    (id,idempotency_key,mode,status,revision,reviewed_by,reviewed_by_email,reviewed_at,control_totals)
    values ($1,$2,'preview','processing',3,$3,$4,$5,$6)`, [runId, runId, actor.id, actor.email.trim().toLowerCase(), iso, JSON.stringify({ preservationPolicy: evaluated.policyVersion })]);
  await db.query(`insert into public.xero_financial_sync_items
    (id,run_id,row_index,row_key,source_object,source_id,source_type,source_document_number,currency,source_total,proposed_action,
      status,selected,source_payload,xero_payload,xero_document_id,xero_document_status,idempotency_key,updated_at,differences)
    values ($1,$2,0,$3,'Supplier_Invoice__c',$4,'supplier_bill','PT202601','USD',30.03,'protected_legacy',
      'selected',true,$5,$6,$7,'AUTHORISED',$3,$8,'[{"field":"detailedLines"}]')`,
  [itemId, runId, itemId, source.salesforceId, JSON.stringify(source), JSON.stringify(input.xero), ids.target, iso]);
  const params = (overrides = {}) => ({ p_run_id: runId, p_expected_run_revision: 3, p_item_id: itemId,
    p_expected_item_updated_at: iso, p_tenant_id: tenant, p_review: review, p_actor_id: actor.id, p_actor_email: actor.email, ...overrides });
  const values = (overrides) => { const p = params(overrides); return [p.p_run_id, p.p_expected_run_revision, p.p_item_id,
    p.p_expected_item_updated_at, p.p_tenant_id, JSON.stringify(p.p_review), p.p_actor_id, p.p_actor_email]; };
  const linkSql = attachmentPolicy ? v2Sql : sql;
  const link = async (overrides) => (await db.query(linkSql, values(overrides))).rows[0].result;
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(m) order by id) from public.xero_financial_document_mappings m) as mappings,
    (select jsonb_agg(to_jsonb(i) order by id) from public.xero_financial_sync_items i) as items,
    (select jsonb_agg(to_jsonb(a) order by id) from public.xero_financial_audit_events a) as audits`)).rows[0];
  return { db, ids, actor, source, input, review, runId, itemId, tenant, params, values, link, linkSql, snapshot };
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

function configureInactiveOwners(input, inactiveCount = 1, contactPatch = {}) {
  const selected = { id: input.source.accountId, name: input.source.accountName, companyCode: input.source.companyCode,
    recordType: 'Supplier', inactiveSuspended: false };
  const owners = [selected, ...Array.from({ length: inactiveCount }, (_, index) => ({ id: `001${String(index + 2).padStart(12, '0')}`,
    name: contactPatch.name || selected.name, companyCode: `HKHISTORICAL ${index + 1}`, recordType: 'Buyer', inactiveSuspended: true }))];
  const contact = { id: input.source.contactId, name: selected.name, status: 'ACTIVE', contactNumber: '', accountNumber: '', ...contactPatch };
  const facts = derivePetroleumOwnership({ tenantId: input.tenantId, accountId: selected.id, contactId: contact.id,
    accounts: owners, contacts: [contact], complete: true });
  assert.equal(facts.eligible, true, JSON.stringify(facts.blockers));
  const bound = bindPetroleumOwnership(facts, { sourceAccountIds: facts.sourceAccountIds, contentFingerprint: input.identity.coverageFingerprint });
  assert.ok(bound);
  Object.assign(input.identity, bound);
  input.identity.accountIdsForContact = facts.sourceAccountIds;
  input.identity.contactIdentity.matchBasis = contact.name === selected.name ? 'account_name' : 'company_key';
  input.identity.contactIdentity.sourceMatchValue = (contact.name === selected.name ? selected.name : selected.companyCode.slice(2)).toUpperCase();
  input.identity.contactIdentity.xeroMatchValue = contact.name.toUpperCase();
}

async function rejectedOwnershipMutation(f, change, { repairOwnershipHash = true } = {}) {
  const review = structuredClone(f.review); const accounting = review.evidence.accounting;
  change(accounting);
  if (repairOwnershipHash && accounting.identityOwnership && typeof accounting.identityOwnership === 'object') {
    accounting.identityOwnership.accountContactFingerprint = petroleumOwnershipFingerprint(accounting.tenantId, accounting.identityOwnership);
  }
  review.accountingCanonical = stable({ policyVersion: review.policyVersion, accounting });
  review.evidenceCanonical = stable(review.evidence);
  review.fingerprint = hash(review.accountingCanonical); review.evidenceFingerprint = hash(review.evidenceCanonical);
  const source = { ...f.source, issuedSupplierPreservation: { ...f.source.issuedSupplierPreservation,
    fingerprint: review.fingerprint, evidenceFingerprint: review.evidenceFingerprint } };
  const before = await f.snapshot();
  await f.db.exec('begin');
  try {
    await f.db.query('update public.xero_financial_sync_items set source_payload=$1 where id=$2', [JSON.stringify(source), f.itemId]);
    await assert.rejects(f.link({ p_review: review }), { code: '40001' });
  } finally { await f.db.exec('rollback'); }
  assert.deepEqual(await f.snapshot(), before);
}

test('empty schema migration permits one atomic mapping, item outcome and authenticated actor audit', async (t) => {
  const f = await fixture(t); const result = await f.link();
  assert.deepEqual({ ...result, mappingId: 'id' }, { id: f.itemId, status: 'linked', xeroDocumentId: f.ids.target, mappingId: 'id', alreadyLinked: false });
  const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
  assert.equal(saved.items[0].status, 'linked'); assert.equal(saved.items[0].mutation_attempts, 0);
  assert.equal(saved.mappings[0].protected_legacy, true);
  assert.equal(saved.mappings[0].retained_differences.reviewFingerprint, f.review.legacyReviewFingerprint);
  assert.deepEqual(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence, f.review.evidence);
  assert.deepEqual(saved.mappings[0].retained_differences.issuedSupplierPreservation.reviewedXero, f.input.xero);
  assert.deepEqual(saved.items[0].source_payload, f.source);
  assert.deepEqual(saved.items[0].xero_payload, f.input.xero);
  assert.equal(saved.items[0].source_payload.readiness.ready, false);
  assert.equal(saved.audits[0].actor_id, f.actor.id); assert.equal(saved.audits[0].actor_email, 'finance@example.test');
  assert.equal(saved.audits[0].event_type, 'issued_petroleum_document_preservation_linked');
  assert.deepEqual(saved.audits[0].record_counts, { linked: 1, applied: 0, financialWrites: 0 });
  assert.equal(saved.items[0].applied_at, saved.mappings[0].created_at);
});

for (const [label, buildFixture] of [['singleton', issuedPetroleumFixture], ['inactive owners', issuedPetroleumOwnerFixture]]) {
test(`actual normal builder and petroleum adapter ${label} proof passes SQL with physical source quantity and original Xero fields`, async (t) => {
  const f = await fixture(t); const real = buildFixture(); const evaluated = real.build();
  assert.equal(evaluated.eligible, true, JSON.stringify(evaluated.blockers));
  const review = { ...f.review, policyVersion: evaluated.policyVersion, fingerprint: evaluated.fingerprint,
    evidenceFingerprint: evaluated.evidenceFingerprint, evidence: evaluated.evidence,
    accountingCanonical: stable({ policyVersion: evaluated.policyVersion, accounting: evaluated.evidence.accounting }),
    evidenceCanonical: stable(evaluated.evidence) };
  const source = { ...real.source, issuedSupplierReviewFingerprint: review.reviewFingerprint,
    issuedSupplierPreservation: { policyVersion: review.policyVersion, eligible: true, accepted: false, requiresExplicitReview: true,
      fingerprint: review.fingerprint, evidenceFingerprint: review.evidenceFingerprint } };
  const mapping = real.stored.productMappings[0];
  await f.db.query('update public.xero_contact_sync_connections set tenant_id=$1', [real.ids.tenant]);
  await f.db.query(`update public.xero_financial_product_mappings set id=$1,salesforce_product_id=$2,
    salesforce_product_name=$3,approved_by=$4,approved_by_email=$5,approved_at=$6`,
  [mapping.id, mapping.salesforce_product_id, mapping.salesforce_product_name, mapping.approved_by, mapping.approved_by_email, mapping.approved_at]);
  await f.db.query(`update public.xero_financial_sync_items set source_id=$1,source_document_number=$2,source_total=$3,
    source_payload=$4,xero_payload=$5,xero_document_id=$6 where id=$7`,
  [real.source.salesforceId, real.source.documentNumber, real.source.total, JSON.stringify(source), JSON.stringify(real.candidate), real.ids.target, f.itemId]);
  assert.equal((await f.link({ p_review: review, p_tenant_id: real.ids.tenant })).status, 'linked');
  const saved = await f.snapshot();
  assert.deepEqual(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence, evaluated.evidence);
  assert.deepEqual(saved.mappings[0].retained_differences.issuedSupplierPreservation.reviewedXero, real.candidate);
  assert.deepEqual(saved.items[0].source_payload.readiness, real.source.readiness);
  assert.equal(evaluated.evidence.accounting.source.lines[0].quantity, '1993.217');
  assert.equal(evaluated.evidence.accounting.source.invoiceDate, '2026-04-01');
  assert.equal(evaluated.evidence.accounting.xero.date, '2026-03-17');
});
}

test('inactive owners are retained as immutable evidence while only the selected document receives a link', async (t) => {
  for (const inactiveCount of [1, 2]) {
    await t.test(`${inactiveCount} inactive owners`, async (child) => {
      const f = await fixture(child, { configure: input => configureInactiveOwners(input, inactiveCount) });
      const first = await f.link(); const saved = await f.snapshot();
      assert.equal(first.status, 'linked'); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
      assert.equal(saved.mappings[0].salesforce_id, f.source.salesforceId);
      assert.deepEqual(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence, f.review.evidence);
      assert.equal(f.review.evidence.accounting.identityOwnership.owners.length, inactiveCount + 1);
      assert.deepEqual(saved.items[0].source_payload, f.source); assert.deepEqual(saved.items[0].xero_payload, f.input.xero);
      assert.equal(saved.items[0].mutation_attempts, 0);
      assert.deepEqual(saved.audits[0].record_counts, { linked: 1, applied: 0, financialWrites: 0 });
      assert.deepEqual(await f.link(), { ...first, alreadyLinked: true }); assert.deepEqual(await f.snapshot(), saved);
      await unchangedOnReject(f, () => f.db.query("update public.xero_financial_document_mappings set retained_differences=retained_differences #- '{issuedSupplierPreservation,evidence,accounting,identityOwnership}' where id=$1", [first.mappingId]));
      await unchangedOnReject(f, () => f.db.query('delete from public.xero_financial_document_mappings where id=$1', [first.mappingId]));
    });
  }
});

test('additive ownership upgrade preserves a pre-existing singleton receipt and its exact replay', async (t) => {
  const f = await fixture(t, { ownership: false });
  assert.equal(Object.hasOwn(f.review.evidence.accounting, 'identityOwnership'), false);
  assert.equal(Object.hasOwn(f.review.evidence.accounting, 'identityOwnershipPolicy'), false);
  const first = await f.link(); const before = await f.snapshot();
  await f.db.exec(await readFile(migration, 'utf8'));
  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await f.link(), { ...first, alreadyLinked: true }); assert.deepEqual(await f.snapshot(), before);
  const real = issuedPetroleumFixture().build();
  assert.equal(real.fingerprint, '5f83badf83d013bf405999b4022980f57838a6a702b258d59633b8ab043136d7');
  assert.equal(real.evidenceFingerprint, 'deda29ca0056df4a7eeeb556ce026782570ab87aac375a06b874fc640340cdc8');
});

test('independently rehashed malformed ownership proofs cannot create a mapping or audit', async (t) => {
  const f = await fixture(t, { configure: configureInactiveOwners });
  const changes = [
    ['missing discriminator', a => { delete a.identityOwnershipPolicy; }],
    ['missing proof', a => { delete a.identityOwnership; }],
    ['null discriminator', a => { a.identityOwnershipPolicy = null; }],
    ['null proof', a => { a.identityOwnership = null; }],
    ['unknown discriminator', a => { a.identityOwnershipPolicy = 'future_policy'; }],
    ['extra proof authority', a => { a.identityOwnership.approved = true; }],
    ['wrong selected Account', a => { a.identityOwnership.selectedAccountId = '001000000000099'; }],
    ['wrong Contact', a => { a.identityOwnership.contactId = randomUUID(); }],
    ['noncanonical Contact', a => { a.identityOwnership.contactId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; }],
    ['selected owner inactive', a => { a.identityOwnership.owners[0].inactiveSuspended = true; }],
    ['second active owner', a => { a.identityOwnership.owners[1].inactiveSuspended = false; }],
    ['unknown owner state', a => { delete a.identityOwnership.owners[1].inactiveSuspended; }],
    ['string owner state', a => { a.identityOwnership.owners[1].inactiveSuspended = 'true'; }],
    ['duplicate owners', a => { a.identityOwnership.owners[1] = structuredClone(a.identityOwnership.owners[0]); }],
    ['18-character owner', a => { a.identityOwnership.owners[1].id = sf18(a.identityOwnership.owners[1].id); }],
    ['unsupported owner type', a => { a.identityOwnership.owners[1].id = 'a01000000000099'; }],
    ['unordered owners', a => { a.identityOwnership.owners.reverse(); }],
    ['one owner marker', a => { a.identityOwnership.owners.pop(); a.identityOwnership.sourceAccountIds.pop(); a.identityOwnership.queriedSourceAccountIds.pop(); }],
    ['owner absent from source coverage', a => { a.identityOwnership.sourceAccountIds.pop(); }],
    ['owner absent from queried coverage', a => { a.identityOwnership.queriedSourceAccountIds.pop(); }],
    ['unrelated batch owner in row proof', a => { a.identityOwnership.queriedSourceAccountIds.push('001000000000099'); }],
    ['duplicate queried coverage', a => { a.identityOwnership.queriedSourceAccountIds.push(a.identityOwnership.queriedSourceAccountIds[0]); }],
    ['foreign all-years fingerprint', a => { a.identityOwnership.allYearsCoverageFingerprint = hash('other scope'); }],
    ['changed selected name', a => { a.identityOwnership.owners[0].name = 'OTHER'; }],
    ['changed selected key', a => { a.identityOwnership.owners[0].companyCode = 'HKOTHER'; }],
    ['duplicate selected own key', a => { a.identityOwnership.owners[1].companyCode = a.identityOwnership.owners[0].companyCode; }],
    ['unrelated purported owner', a => { a.identityOwnership.owners[1].name = 'OTHER'; }],
    ['unknown owner field', a => { a.identityOwnership.owners[1].verified = true; }],
    ['nonstring owner literal', a => { a.identityOwnership.owners[1].recordType = 3; }],
    ['unbounded owner literal', a => { a.identityOwnership.owners[1].recordType = 'x'.repeat(1001); }],
    ['control character in literal', a => { a.identityOwnership.owners[1].recordType = 'Buyer\n'; }],
    ['wrong Contact inner ID', a => { a.identityOwnership.contact.id = randomUUID(); }],
    ['archived Contact', a => { a.identityOwnership.contact.status = 'ARCHIVED'; }],
    ['unrelated Contact name', a => { a.identityOwnership.contact.name = 'OTHER'; }],
    ['missing Contact number', a => { delete a.identityOwnership.contact.contactNumber; }],
    ['merged proof property', a => { a.identityOwnership.contact.mergedToContactId = randomUUID(); }],
    ['absent foreign Account explicit ID', a => { a.identityOwnership.contact.contactNumber = '001000000000099'; }],
    ['retained inactive Account explicit ID', a => { a.identityOwnership.contact.accountNumber = a.identityOwnership.owners[1].id; }],
    ['malformed explicit Account ID', a => { a.identityOwnership.contact.accountNumber = '001BROKEN'; }],
    ['padded foreign Account ID', a => { a.identityOwnership.contact.accountNumber = ' 001000000000099 '; }],
    ['padded selected Account ID', a => { a.identityOwnership.contact.contactNumber = ` ${f.ids.account} `; }],
    ['Unicode-padded Account ID', a => { a.identityOwnership.contact.contactNumber = '\u00a0001000000000099\u00a0'; }],
    ['bad explicit Account checksum', a => { a.identityOwnership.contact.contactNumber = f.ids.account + 'ZZZ'; }],
    ['inactive full CL key claim', a => { a.identityOwnership.contact.accountNumber = ' hkhistorical 1 '; }],
    ['match proof switches basis', a => { a.contactIdentity.matchBasis = 'company_key'; a.contactIdentity.sourceMatchValue = 'OTHER'; a.contactIdentity.xeroMatchValue = 'OTHER'; }],
    ['competing source claim', a => { a.identityScope.sourceNumberIds.push('a01000000000099'); }],
  ];
  for (const [name, change] of changes) await t.test(name, () => rejectedOwnershipMutation(f, change));
  await t.test('independent ownership digest mismatch', () => rejectedOwnershipMutation(f,
    a => { a.identityOwnership.accountContactFingerprint = hash('forged'); }, { repairOwnershipHash: false }));
});

test('same selected Account IDs and arbitrary historical Contact numbers do not become foreign owner claims', async (t) => {
  for (const number of ['001000000000001', sf18('001000000000001'), 'HISTORICAL-CUSTOMER-42', 'PETROLEUM SUPPLIER']) {
    await t.test(number, async (child) => {
      const f = await fixture(child, { configure: input => configureInactiveOwners(input, 1, { contactNumber: number }) });
      assert.equal((await f.link()).status, 'linked');
    });
  }
});

test('canonical ownership hashes preserve Unicode and escaped literals and support the existing own-key match', async (t) => {
  await t.test('literal JSON escaping', async (child) => {
    const f = await fixture(child, { configure(input) {
      input.source.accountName = 'PÉTROLEUM "SUPPLY" \\ LTD';
      input.fileEvidence.review.sellerName = input.source.accountName;
      input.fileEvidence.review.counterparties.sourceName = input.source.accountName;
      input.fileEvidence.review.counterparties.printedSeller = input.source.accountName;
      configureInactiveOwners(input);
    } });
    assert.equal((await f.link()).status, 'linked');
  });
  await t.test('own HK key', async (child) => {
    const f = await fixture(child, { configure(input) {
      input.source.companyCode = 'HKTARGET OWN KEY';
      input.fileEvidence.review.counterparties.companyCode = input.source.companyCode;
      configureInactiveOwners(input, 1, { name: 'TARGET OWN KEY' });
    } });
    assert.equal((await f.link()).status, 'linked');
  });
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

test('the two RPCs reject each other policy and the additive migration does not change prior function bodies', async (t) => {
  const f = await fixture(t, { migrate: false });
  const definitions = async () => (await f.db.query(`select proname,prosrc,prosecdef,proacl from pg_proc where oid in
    ('public.link_xero_issued_supplier_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text)'::regprocedure,
     'public.link_xero_grouped_document_v1(uuid,integer,uuid,timestamptz,uuid,jsonb,uuid,text)'::regprocedure,
     'public.protect_xero_grouped_mapping_v1()'::regprocedure) order by proname`)).rows;
  const before = await definitions(); await applyPetroleumMigrations(f.db);
  assert.deepEqual(await definitions(), before);
  await unchangedOnReject(f, () => f.db.query(sql.replace('link_xero_issued_petroleum_document_v1', 'link_xero_issued_supplier_document_v1'), f.values()), { code: '22023' });
  await unchangedOnReject(f, () => f.link({ p_review: { ...f.review, policyVersion: 'issued_supplier_preserve_v1' } }), { code: '22023' });
  await f.db.query("update public.xero_financial_sync_runs set control_totals='{\"preservationPolicy\":\"issued_supplier_preserve_v1\"}' where id=$1", [f.runId]);
  await unchangedOnReject(f, () => f.link());
});

test('exact decimal half-cent rounds up and a literal paper due date before invoice date remains preservable', async (t) => {
  const f = await fixture(t, { configure(input) {
    input.source.lines[0].quantity = '1'; input.source.lines[0].unitAmount = '30.025';
    input.deliveryIdentity.quantity = '1'; input.deliveryIdentity.unitAmount = '30.025';
    input.fileEvidence.review.lines[0].quantity = '1'; input.fileEvidence.review.lines[0].unitPrice = '30.025';
    input.source.dueDate = '2025-12-31'; input.fileEvidence.review.dueDate = '2025-12-31';
  } });
  assert.equal((await f.link()).status, 'linked');
  assert.equal((await f.snapshot()).mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.source.lines[0].lineAmountCents, '3003');
});

test('original non-file source blockers, changed retained raw line and settlement are not erased by a valid compact summary', async (t) => {
  const f = await fixture(t);
  const changes = [
    ["source_payload=jsonb_set(source_payload,'{blockers}','[\"Unresolved source amount\"]')"],
    ["source_payload=jsonb_set(source_payload,'{readiness,blockers}','[\"Unapproved source\"]')"],
    ["source_payload=jsonb_set(source_payload,'{readiness,linkedChildren}','[]')"],
    ["source_payload=jsonb_set(source_payload,'{deliveryDate}','\"2026-01-01\"')"],
    ["source_payload=jsonb_set(source_payload,'{stemKey}','\"HK26999T\"')"],
    ["xero_payload=jsonb_set(xero_payload,'{amountPaid}','1')"],
    ["xero_payload=jsonb_set(xero_payload,'{amountDue}','30.02')"],
    ["xero_payload=jsonb_set(xero_payload,'{rawLineItems,0,UnitAmount}','30.02')"],
    ['source_total=null'],
  ];
  for (const [assignment] of changes) {
    await f.db.exec('begin');
    await f.db.query(`update public.xero_financial_sync_items set ${assignment} where id=$1`, [f.itemId]);
    await assert.rejects(f.link(), { code: '40001' }); await f.db.exec('rollback');
  }
  await f.db.query("update public.xero_financial_sync_runs set cutoff_date='2026-01-03' where id=$1", [f.runId]);
  await unchangedOnReject(f, () => f.link()); // Source date is in scope; delivery date is not.
});

test('missing source or Xero due date and impossible calendar dates fail even in a rehashed saved proof', async (t) => {
  const f = await fixture(t);
  for (const change of [
    (e, s) => { e.accounting.source.dueDate = s.dueDate = e.accounting.issuedFile.review.dueDate = null; },
    (e, _s, x) => { e.accounting.xero.dueDate = x.dueDate = null; },
    (e, s) => { e.accounting.source.invoiceDate = s.invoiceDate = e.accounting.issuedFile.review.invoiceDate = '2026-02-30'; },
    (e, s, x) => { e.accounting.deliveryIdentity.deliveryDate = s.deliveryDate = e.accounting.xero.date = x.date = '2026-02-30'; },
  ]) {
    const review = structuredClone(f.review), source = structuredClone(f.source), xero = structuredClone(f.input.xero);
    change(review.evidence, source, xero);
    review.accountingCanonical = stable({ policyVersion: review.policyVersion, accounting: review.evidence.accounting });
    review.evidenceCanonical = stable(review.evidence); review.fingerprint = hash(review.accountingCanonical); review.evidenceFingerprint = hash(review.evidenceCanonical);
    source.issuedSupplierPreservation.fingerprint = review.fingerprint; source.issuedSupplierPreservation.evidenceFingerprint = review.evidenceFingerprint;
    await f.db.exec('begin');
    await f.db.query('update public.xero_financial_sync_items set source_payload=$1,xero_payload=$2 where id=$3', [JSON.stringify(source), JSON.stringify(xero), f.itemId]);
    await assert.rejects(f.link({ p_review: review }), (error) => ['40001', '22008'].includes(error.code));
    await f.db.exec('rollback');
  }
});

test('replay requires the original durable zero-write audit and never repairs a changed acceptance', async (t) => {
  const f = await fixture(t); await f.link();
  for (const statement of ["delete from public.xero_financial_audit_events",
    "update public.xero_financial_audit_events set record_counts='{\"linked\":1,\"applied\":1,\"financialWrites\":1}'"]) {
    await f.db.exec('begin'); await f.db.exec(statement); const before = await f.snapshot();
    await f.db.exec('savepoint rejected_replay');
    await assert.rejects(f.link(), { code: '40001' });
    await f.db.exec('rollback to savepoint rejected_replay');
    assert.deepEqual(await f.snapshot(), before); await f.db.exec('rollback');
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

test('document run gate blocks another start and a payment-mode run cannot accept issued petroleum links', async (t) => {
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

test('first acceptance binds the reviewed human actor and dedicated preview policy', async (t) => {
  const f = await fixture(t);
  for (const change of [{ p_actor_id: randomUUID() }, { p_actor_email: 'other@example.test' }]) {
    await unchangedOnReject(f, () => f.link(change));
  }
  for (const update of ["reviewed_by=null", "reviewed_by_email=null", "reviewed_at=null", "mode='document_apply'",
    "control_totals='{}'", "control_totals='{\"preservationPolicy\":\"positive_many_to_one_v1\"}'"]) {
    await f.db.exec('begin');
    await f.db.query(`update public.xero_financial_sync_runs set ${update} where id=$1`, [f.runId]);
    await assert.rejects(f.link(), { code: '40001' }); await f.db.exec('rollback');
  }
  assert.equal((await f.snapshot()).mappings, null);
});

test('rehashed but unsupported policy economics fail even if the saved compact proof is changed', async (t) => {
  const f = await fixture(t);
  const changedEvidence = [
    (e) => { e.accounting.source.totalCents = '3004'; },
    (e) => { e.accounting.issuedFile.version.isLatest = false; },
    (e) => { e.accounting.issuedFile.link.parentId = 'a01000000000099'; },
    (e) => { e.accounting.issuedFile.sha256 = 'missing'; },
    (e) => { e.accounting.issuedFile.review.printedNumber = 'M-26-01-011'; },
    (e) => { e.accounting.xero.totalTax = '1'; },
    (e) => { e.accounting.xero.currencyRate = '0.99'; },
    (e) => { e.accounting.xero.lines[0].tracking = [{ Name: 'Unsupported' }]; },
    (e) => { e.accounting.source.lines[0].productId = '01t000000000099'; },
    (e) => { e.accounting.source.lines.push(e.accounting.source.lines[0]); },
    (e) => { e.accounting.source.financialFingerprint = hash('stale source economics'); },
    (e) => { e.observations.amountPaidCents = '1'; },
    (e) => { e.observations.ownership.kind = 'linked'; },
    (e) => { e.accounting.deliveryIdentity.parentId = 'a01000000000099'; },
    (e) => { e.accounting.deliveryIdentity.supplierId = '001000000000099'; },
    (e) => { e.accounting.deliveryIdentity.stemId = 'a03000000000099'; },
    (e) => { e.accounting.deliveryIdentity.stemKey = 'HK26999T'; },
    (e) => { e.accounting.deliveryIdentity.vesselId = null; },
    (e) => { e.accounting.deliveryIdentity.vessel = 'OTHER VESSEL'; },
    (e) => { e.accounting.deliveryIdentity.deliveryDate = '2026-01-01'; },
    (e) => { e.accounting.deliveryIdentity.childId = 'a02000000000099'; },
    (e) => { e.accounting.deliveryIdentity.productRecordType = 'Extra_Cost'; },
    (e) => { e.accounting.deliveryIdentity.sourceFactsFingerprint = null; },
    (e) => { e.accounting.deliveryIdentity.quantity = '1'; },
    (e) => { e.accounting.deliveryIdentity.unit = 'BBL'; },
    (e) => { e.accounting.deliveryIdentity.unitAmount = '10'; },
    (e) => { e.accounting.source.lines[0].quantity = '1'; },
    (e) => { e.accounting.xero.lines[0].unitAmount = '30.02'; },
    (e) => { e.accounting.xero.rawLineItems[0].LineItemID = randomUUID(); },
    (e) => { e.accounting.xero.unowned = {}; },
    (e) => { e.accounting.xero.settlementEvidence.collections.Prepayments.rows = [{}]; },
    (e) => { e.accounting.xero.settlementEvidence.collections.Overpayments.present = null; },
    (e) => { e.accounting.identityScope.coverageFingerprint = null; },
    (e) => { e.accounting.identityScope.sourceIds.push('a01000000000099'); },
    (e) => { e.accounting.identityScope.sourceNumberIds = []; },
    (e) => { e.accounting.identityScope.targetIds = [randomUUID()]; },
    (e) => { e.accounting.identityScope.targetNumberIds = [randomUUID()]; },
    (e) => { e.accounting.contactIdentity.status = 'ARCHIVED'; },
    (e) => { e.accounting.contactIdentity.xeroMatchValue = 'another'; },
    (e) => { e.accounting.issuedFile.review.numberRule = null; },
    (e) => { e.accounting.issuedFile.review.printedNumber = 'PT/2026/01'; },
    (e) => { e.accounting.issuedFile.review.deliveryDate = '2026-01-01'; },
    (e) => { e.accounting.issuedFile.review.lines[0].quantity = '3.001'; },
    (e) => { e.accounting.issuedFile.review.lines[0].unitPrice = '10.01000001'; },
    (e) => { e.accounting.issuedFile.review.lines[0].amount = '30.02'; },
    (e) => { e.accounting.issuedFile.review.lines[0].sourceProductId = '01t000000000099'; },
    (e) => { e.accounting.issuedFile.review.counterparties.accountId = '001000000000099'; },
    (e) => { e.accounting.issuedFile.review.counterparties.printedSeller = 'Fabricated seller'; },
    (e) => { e.accounting.issuedFile.review.taxEvidence = 'assumed'; },
    (e) => { e.accounting.issuedFile.review.totalTax = '0'; },
    (e) => { e.accounting.accountTax.account.Type = 'EXPENSE'; },
    (e) => { e.accounting.accountTax.account.Status = 'ARCHIVED'; },
    (e) => { e.accounting.accountTax.tax.EffectiveRate = 1; },
    (e) => { e.accounting.accountTax.tax.CanApplyToExpenses = false; },
    (e) => { e.accounting.productMappings[0].approvedBy = randomUUID(); },
    (e) => { e.accounting.productMappings[0].approvedAt = '2026-09-23T22:01:00.000Z'; },
  ];
  for (const change of changedEvidence) {
    const review = structuredClone(f.review); change(review.evidence);
    review.accountingCanonical = stable({ policyVersion: review.policyVersion, accounting: review.evidence.accounting });
    review.evidenceCanonical = stable(review.evidence);
    review.fingerprint = hash(review.accountingCanonical); review.evidenceFingerprint = hash(review.evidenceCanonical);
    const source = { ...f.source, issuedSupplierPreservation: { ...f.source.issuedSupplierPreservation,
      fingerprint: review.fingerprint, evidenceFingerprint: review.evidenceFingerprint } };
    await f.db.exec('begin');
    await f.db.query('update public.xero_financial_sync_items set source_payload=$1 where id=$2', [JSON.stringify(source), f.itemId]);
    await assert.rejects(f.link({ p_review: review }), { code: '40001' }); await f.db.exec('rollback');
  }
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
    "update public.xero_financial_product_mappings set xero_account_code='51200'", 'update public.xero_financial_product_mappings set enabled=false',
    'update public.xero_financial_product_mappings set approved_by=null', "update public.xero_financial_product_mappings set approved_by_email=''",
    'update public.xero_financial_product_mappings set approved_at=null']) {
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

for (const [label, configure] of [['singleton', () => {}], ['inactive owners', configureInactiveOwners]]) {
test(`audit and item outcome storage failures roll back ${label} mapping and permit retry after repair`, async (t) => {
  const f = await fixture(t, { configure });
  for (const [table, action] of [['xero_financial_audit_events', 'insert'], ['xero_financial_sync_items', 'update']]) {
    await f.db.exec(`create function public.reject_issued_write() returns trigger language plpgsql as $$
      begin raise exception 'Injected storage failure' using errcode='XX000'; end $$;
      create trigger reject_issued_write before ${action} on public.${table} for each row execute function public.reject_issued_write();`);
    await unchangedOnReject(f, () => f.link(), { code: 'XX000' });
    await f.db.exec(`drop trigger reject_issued_write on public.${table}; drop function public.reject_issued_write();`);
  }
  assert.equal((await f.link()).alreadyLinked, false);
});
}

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
  await applyPetroleumMigrations(f.db); await applyPetroleumMigrations(f.db);
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

test('upgrade preserves existing grouped acceptance and protects either proof even when malformed', async (t) => {
  const f = await fixture(t, { migrate: false });
  const ordinary = (await ordinaryMapping(f, 'a01000000000099', randomUUID())).rows[0];
  await f.db.query("update public.xero_financial_document_mappings set protected_legacy=true,retained_differences='{\"groupedPreservation\":{\"existing\":true}}' where id=$1", [ordinary.id]);
  const before = await f.snapshot();
  await applyPetroleumMigrations(f.db);
  assert.deepEqual(await f.snapshot(), before);
  await unchangedOnReject(f, () => f.db.query("update public.xero_financial_document_mappings set retained_differences='{}' where id=$1", [ordinary.id]));
  const malformed = (await ordinaryMapping(f, 'a01000000000098', randomUUID())).rows[0];
  await f.db.query("update public.xero_financial_document_mappings set retained_differences='{\"issuedSupplierPreservation\":null}' where id=$1", [malformed.id]);
  await unchangedOnReject(f, () => f.db.query('delete from public.xero_financial_document_mappings where id=$1', [malformed.id]));
  await f.link(); const linked = await f.snapshot();
  await applyPetroleumMigrations(f.db);
  assert.deepEqual(await f.snapshot(), linked);
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
const concurrencyUrl = process.env.FCOS_ISSUED_PETROLEUM_TEST_DATABASE_URL;
async function postgresFixture(t, options = {}) {
  const endpoint = new URL(concurrencyUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Issued petroleum concurrency tests require a local disposable PostgreSQL server');
  assert.ok(['postgres:', 'postgresql:'].includes(endpoint.protocol));
  const admin = new pg.Client({ connectionString: endpoint.toString() }); await admin.connect();
  const dbName = `fcos_petroleum_test_${randomUUID().replaceAll('-', '')}`;
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
  const f = await fixture(t, { ...options, database: { query: (...args) => primary.query(...args), exec: (text) => primary.query(text) } });
  const call = (client, overrides) => client.query(f.linkSql, f.values(overrides)).then((result) => result.rows[0].result);
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
  input.deliveryIdentity.parentId = sourceId;
  input.fileEvidence.parentId = sourceId; input.fileEvidence.link.parentId = sourceId;
  input.identity.documentIdentitySourceIds = [sourceId]; input.identity.candidateXeroDocumentIds = [targetId];
  input.identity.numberCollisionSourceIds = [sourceId]; input.identity.numberCollisionXeroIds = [targetId];
  const evaluated = evaluateDatabaseFixture(input); assert.equal(evaluated.eligible, true, JSON.stringify(evaluated.blockers));
  const review = { ...f.review, fingerprint: evaluated.fingerprint, evidenceFingerprint: hash(stable(evaluated.evidence)),
    evidence: evaluated.evidence, accountingCanonical: stable({ policyVersion: evaluated.policyVersion, accounting: evaluated.evidence.accounting }),
    evidenceCanonical: stable(evaluated.evidence) };
  const source = { ...f.source, salesforceId: sourceId, issuedSupplierPreservation: { ...f.source.issuedSupplierPreservation,
    fingerprint: review.fingerprint, evidenceFingerprint: review.evidenceFingerprint } };
  const runId = f.runId; const itemId = randomUUID();
  await f.db.query(`insert into public.xero_financial_sync_items
    select (jsonb_populate_record(null::public.xero_financial_sync_items,to_jsonb(i)||$1::jsonb)).*
    from public.xero_financial_sync_items i where id=$2`, [JSON.stringify({ id: itemId, run_id: runId, row_key: itemId, row_index: 1,
    idempotency_key: itemId, source_id: sourceId, source_payload: source, xero_payload: input.xero, xero_document_id: targetId }), f.itemId]);
  return { p_run_id: runId, p_item_id: itemId, p_review: review };
}

const competingClaimOptions = (f, conflict) => conflict === 'target'
  ? { sourceId: 'a01000000000099', targetId: f.ids.target.toUpperCase() }
  : { sourceId: f.ids.source, targetId: randomUUID() };

// Exercise both PostgreSQL race fixtures even when no independent-session server
// is available. Each claim must first pass the real evaluator and SQL on its own.
for (const conflict of ['target', 'source']) test(`an independently valid competing ${conflict} claim passes before ownership is accepted`, async (t) => {
  const f = await fixture(t);
  const options = competingClaimOptions(f, conflict);
  const competing = await addCompetingClaim(f, options);
  const accounting = competing.p_review.evidence.accounting;
  assert.equal(accounting.source.salesforceId, options.sourceId.slice(0, 15));
  assert.equal(accounting.xero.id, options.targetId.toLowerCase());
  assert.deepEqual(accounting.identityScope.targetNumberIds.map((id) => id.toLowerCase()), [options.targetId.toLowerCase()]);
  await f.db.exec('begin');
  try { assert.equal((await f.link(competing)).status, 'linked'); } finally { await f.db.exec('rollback'); }
  const before = await f.snapshot(); assert.equal(before.mappings, null); assert.equal(before.audits, null);
  await f.link(); await unchangedOnReject(f, () => f.link(competing));
});

for (const conflict of ['target', 'source']) test(`inactive-owner competing ${conflict} race fixture passes independent SQL before ownership`, async (t) => {
  const f = await fixture(t, { configure: configureInactiveOwners });
  const competing = await addCompetingClaim(f, competingClaimOptions(f, conflict));
  assert.equal(competing.p_review.evidence.accounting.identityOwnership.owners.length, 2);
  await f.db.exec('begin');
  try { assert.equal((await f.link(competing)).status, 'linked'); } finally { await f.db.exec('rollback'); }
  assert.equal((await f.snapshot()).mappings, null);
  await f.link(); await unchangedOnReject(f, () => f.link(competing));
});

test('PostgreSQL overlapping transactions serialize exact retries, ownership races and mapping drift', {
  skip: !concurrencyUrl && 'Set FCOS_ISSUED_PETROLEUM_TEST_DATABASE_URL to a disposable local Supabase-compatible PostgreSQL endpoint', timeout: 60000,
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
    const competing = await addCompetingClaim(f, competingClaimOptions(f, conflict));
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
  await t.test('connection tenant edit wins its lock and invalidates the stale acceptance', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect();
    await second.query('begin');
    await second.query("update public.xero_contact_sync_connections set tenant_id=$1 where id='primary'", [randomUUID()]);
    const pending = f.call(f.primary); const settled = pending.then(() => ({}), (error) => ({ error }));
    await f.waitForLock(f.primary); await second.query('commit');
    assert.equal((await settled).error?.code, '40001');
    const saved = await f.snapshot(); assert.equal(saved.mappings, null); assert.equal(saved.audits, null);
  });
  await t.test('product edit wins its lock and causes stale acceptance to roll back', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect();
    await second.query('begin'); await second.query('update public.xero_financial_product_mappings set revision=2 where id=$1', [f.ids.productMapping]);
    const pending = f.call(f.primary); const settled = pending.then(() => ({}), (error) => ({ error }));
    await f.waitForLock(f.primary); await second.query('commit'); assert.equal((await settled).error?.code, '40001');
    const saved = await f.snapshot(); assert.equal(saved.mappings, null); assert.equal(saved.audits, null); assert.equal(saved.items[0].status, 'selected');
  });
  await t.test('selection change wins the item lock and leaves no acceptance behind', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect();
    await second.query('begin');
    await second.query('update public.xero_financial_sync_items set selected=false where id=$1', [f.itemId]);
    const pending = f.call(f.primary); const settled = pending.then(() => ({}), (error) => ({ error }));
    await f.waitForLock(f.primary); await second.query('commit');
    assert.equal((await settled).error?.code, '40001');
    const saved = await f.snapshot(); assert.equal(saved.mappings, null); assert.equal(saved.audits, null);
  });
  await t.test('approval revocation wins its row lock and rolls back the stale link', async (child) => {
    const f = await postgresFixture(child); const second = await f.connect();
    await second.query('begin');
    await second.query('update public.xero_financial_product_mappings set approved_at=null where id=$1', [f.ids.productMapping]);
    const pending = f.call(f.primary); const settled = pending.then(() => ({}), (error) => ({ error }));
    await f.waitForLock(f.primary); await second.query('commit');
    assert.equal((await settled).error?.code, '40001');
    const saved = await f.snapshot(); assert.equal(saved.mappings, null); assert.equal(saved.audits, null);
  });
});

test('PostgreSQL inactive-owner proof validates independently and retains transaction race boundaries', {
  skip: !concurrencyUrl && 'Set FCOS_ISSUED_PETROLEUM_TEST_DATABASE_URL to a disposable local Supabase-compatible PostgreSQL endpoint', timeout: 60000,
}, async (t) => {
  await t.test('new proof retries wait and preserve one exact immutable actor receipt', async (child) => {
    const f = await postgresFixture(child, { configure: input => configureInactiveOwners(input, 2) });
    const second = await f.connect();
    await f.primary.query('begin'); const first = await f.call(f.primary);
    const settled = f.call(second).then(value => ({ value }), error => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit');
    assert.deepEqual((await settled).value, { ...first, alreadyLinked: true });
    const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
    assert.deepEqual(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence, f.review.evidence);
    assert.equal(saved.items[0].mutation_attempts, 0);
    await unchangedOnReject(f, () => f.link({ p_actor_id: randomUUID() }));
    await unchangedOnReject(f, () => f.primary.query('delete from public.xero_financial_document_mappings where id=$1', [first.mappingId]));
  });
  await t.test('rehashed ownership, coverage, policy and explicit-number lies fail with no writes', async (child) => {
    const f = await postgresFixture(child, { configure: configureInactiveOwners });
    for (const change of [
      a => { a.identityOwnership.owners[1].inactiveSuspended = false; },
      a => { a.identityOwnership.queriedSourceAccountIds.pop(); },
      a => { a.identityOwnership.contact.accountNumber = '001000000000099'; },
      a => { a.identityOwnershipPolicy = null; },
    ]) await rejectedOwnershipMutation(f, change);
    await rejectedOwnershipMutation(f, a => { a.identityOwnership.accountContactFingerprint = hash('wrong'); }, { repairOwnershipHash: false });
    assert.equal((await f.link()).status, 'linked');
  });
  for (const conflict of ['source', 'target']) await t.test(`inactive-owner proofs compete for canonical ${conflict}`, async (child) => {
    const f = await postgresFixture(child, { configure: configureInactiveOwners }); const second = await f.connect();
    const competing = await addCompetingClaim(f, competingClaimOptions(f, conflict));
    await f.primary.query('begin'); await f.call(f.primary);
    const settled = f.call(second, competing).then(value => ({ value }), error => ({ error }));
    await f.waitForLock(second); await f.primary.query('commit');
    assert.ok(['23505', '40001'].includes((await settled).error?.code));
    const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
  });
  await t.test('current mapping approval revocation defeats an overlapping inactive-owner acceptance', async (child) => {
    const f = await postgresFixture(child, { configure: configureInactiveOwners }); const second = await f.connect();
    await second.query('begin');
    await second.query('update public.xero_financial_product_mappings set approved_at=null where id=$1', [f.ids.productMapping]);
    const settled = f.call(f.primary).then(value => ({ value }), error => ({ error }));
    await f.waitForLock(f.primary); await second.query('commit');
    assert.equal((await settled).error?.code, '40001');
    const saved = await f.snapshot(); assert.equal(saved.mappings, null); assert.equal(saved.audits, null);
  });
});


function configureAttachments(input) {
  input.policyVersion = v2Policy;
  const file = input.fileEvidence;
  file.review.invoiceDate = null; file.review.dueDate = null; file.review.lines[0].unit = 'MTS';
  file.attachmentManifest = { complete: true, selectedDocumentId: file.documentId, selectedVersionId: file.versionId,
    entries: [{ linkId: file.link.id, documentId: file.documentId, versionId: file.versionId,
      sha256: file.sha256, checksum: file.checksum, contentSize: file.contentSize, fileType: 'PDF', fileExtension: 'pdf',
      role: 'issued_invoice', reviewRecordHash: file.review.reviewRecordHash },
    { linkId: '06A000000000002', documentId: '069000000000002', versionId: '068000000000002',
      sha256: hash('reviewed delivery receipt bytes'), checksum: '1'.repeat(32), contentSize: 5678,
      fileType: 'PDF', fileExtension: 'pdf', role: 'delivery_receipt', reviewRecordHash: hash('reviewed delivery receipt') }] };
}

const invalidManifestChanges = [
  ['missing manifest', f => { delete f.attachmentManifest; }],
  ['null manifest', f => { f.attachmentManifest = null; }],
  ['array manifest', f => { f.attachmentManifest = []; }],
  ['incomplete manifest', f => { f.attachmentManifest.complete = false; }],
  ['claimed completion string', f => { f.attachmentManifest.complete = 'true'; }],
  ['extra authority', f => { f.attachmentManifest.approved = true; }],
  ['wrong selected document', f => { f.attachmentManifest.selectedDocumentId = '069000000000099'; }],
  ['wrong selected version', f => { f.attachmentManifest.selectedVersionId = '068000000000099'; }],
  ['malformed selected checksum', f => { f.attachmentManifest.selectedDocumentId += 'ZZZ'; }],
  ['missing entries', f => { delete f.attachmentManifest.entries; }],
  ['null entries', f => { f.attachmentManifest.entries = null; }],
  ['empty entries', f => { f.attachmentManifest.entries = []; }],
  ['null entry', f => { f.attachmentManifest.entries[1] = null; }],
  ['extra entry field', f => { f.attachmentManifest.entries[1].isSafe = true; }],
  ['missing review hash', f => { delete f.attachmentManifest.entries[1].reviewRecordHash; }],
  ['bad review hash', f => { f.attachmentManifest.entries[1].reviewRecordHash = 'X'.repeat(64); }],
  ['bad SHA256', f => { f.attachmentManifest.entries[1].sha256 = 'A'.repeat(64); }],
  ['bad MD5', f => { f.attachmentManifest.entries[1].checksum = 'x'.repeat(32); }],
  ['numeric SHA256', f => { f.attachmentManifest.entries[1].sha256 = 123; }],
  ['string size', f => { f.attachmentManifest.entries[1].contentSize = '5678'; }],
  ['fractional size', f => { f.attachmentManifest.entries[1].contentSize = 5678.5; }],
  ['too small', f => { f.attachmentManifest.entries[1].contentSize = 4; }],
  ['too large', f => { f.attachmentManifest.entries[1].contentSize = 5000001; }],
  ['wrong native type', f => { f.attachmentManifest.entries[1].fileType = 'WORD_X'; }],
  ['wrong native extension', f => { f.attachmentManifest.entries[1].fileExtension = 'PDF'; }],
  ['unreviewed role', f => { f.attachmentManifest.entries[1].role = 'unknown'; }],
  ['credit role', f => { f.attachmentManifest.entries[1].role = 'credit_note'; }],
  ['second invoice role', f => { f.attachmentManifest.entries[1].role = 'issued_invoice'; }],
  ['no invoice role', f => { f.attachmentManifest.entries[0].role = 'terms'; }],
  ['wrong selected link', f => { f.attachmentManifest.entries[0].linkId = '06A000000000000'; }],
  ['changed selected bytes', f => { f.attachmentManifest.entries[0].sha256 = hash('changed native bytes'); }],
  ['changed selected checksum', f => { f.attachmentManifest.entries[0].checksum = '2'.repeat(32); }],
  ['changed selected size', f => { f.attachmentManifest.entries[0].contentSize += 1; }],
  ['changed selected review', f => { f.attachmentManifest.entries[0].reviewRecordHash = hash('another review'); }],
  ['wrong link prefix', f => { f.attachmentManifest.entries[1].linkId = '001000000000002'; }],
  ['wrong document prefix', f => { f.attachmentManifest.entries[1].documentId = '001000000000002'; }],
  ['wrong version prefix', f => { f.attachmentManifest.entries[1].versionId = '001000000000002'; }],
  ['invalid entry checksum', f => { f.attachmentManifest.entries[1].linkId += 'ZZZ'; }],
  ['duplicate canonical link', f => { f.attachmentManifest.entries[1].linkId = sf18(f.link.id); }],
  ['duplicate canonical document', f => { f.attachmentManifest.entries[1].documentId = sf18(f.documentId); }],
  ['duplicate canonical version', f => { f.attachmentManifest.entries[1].versionId = sf18(f.versionId); }],
  ['unsorted links', f => { f.attachmentManifest.entries.reverse(); }],
  ['false duplicate bytes', f => { f.attachmentManifest.entries[1].role = 'duplicate_selected_invoice'; }],
  ['duplicate SHA alone', f => { Object.assign(f.attachmentManifest.entries[1], { role: 'duplicate_selected_invoice', sha256: f.sha256 }); }],
  ['21 attachments', f => { f.attachmentManifest.entries = Array.from({ length: 21 }, (_, i) => {
    const suffix = String(i + 1).padStart(12, '0');
    return { ...f.attachmentManifest.entries[i ? 1 : 0], linkId: `06A${suffix}`, documentId: `069${suffix}`, versionId: `068${suffix}` };
  }); }],
];

test('v2 adds separate service-only invoker functions and leaves existing v1 function and acceptance byte-equivalent', async (t) => {
  const f = await fixture(t); const first = await f.link(); const before = await f.snapshot();
  const definition = async () => (await f.db.query('select pg_get_functiondef($1::regprocedure) as definition', [rpc])).rows[0].definition;
  const original = await definition();
  await f.db.exec(await readFile(attachmentMigration, 'utf8'));
  assert.equal(await definition(), original); assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await f.link(), { ...first, alreadyLinked: true }); assert.deepEqual(await f.snapshot(), before);
  for (const name of [v2Rpc, 'public.xero_issued_petroleum_attachment_manifest_v2(jsonb,jsonb)']) {
    const grants = (await f.db.query(`select prosecdef,has_function_privilege('anon',oid,'EXECUTE') as anon,
      has_function_privilege('authenticated',oid,'EXECUTE') as authenticated,has_function_privilege('service_role',oid,'EXECUTE') as service
      from pg_proc where oid=$1::regprocedure`, [name])).rows[0];
    assert.deepEqual(grants, { prosecdef: false, anon: false, authenticated: false, service: true });
  }
  await unchangedOnReject(f, () => f.db.query(v2Sql, f.values()), { code: '22023' });
});

test('v2 SQL preserves explicit null paper dates, source dates, full target and complete attachments with zero financial writes', async (t) => {
  const f = await fixture(t, { attachmentPolicy: true, configure: configureInactiveOwners });
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`set role ${role}`); await assert.rejects(f.link(), { code: '42501' }); await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role');
  await unchangedOnReject(f, () => f.db.query(sql, f.values()), { code: '22023' });
  const first = await f.link(); const saved = await f.snapshot();
  assert.equal(first.status, 'linked'); assert.equal(saved.items[0].mutation_attempts, 0);
  assert.deepEqual(saved.items[0].source_payload, f.source); assert.deepEqual(saved.items[0].xero_payload, f.input.xero);
  assert.deepEqual(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence, f.review.evidence);
  assert.equal(saved.mappings[0].retained_differences.issuedSupplierPreservation.policyVersion, v2Policy);
  assert.equal(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.issuedFile.review.invoiceDate, null);
  assert.equal(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.source.invoiceDate, '2026-01-03');
  assert.equal(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.xero.date, '2026-01-02');
  assert.deepEqual(saved.audits[0].record_counts, { linked: 1, applied: 0, financialWrites: 0 });
  assert.equal(saved.audits[0].actor_id, f.actor.id); assert.equal(saved.audits[0].actor_email, 'finance@example.test');
  assert.equal(saved.audits[0].event_type, 'issued_petroleum_document_preservation_linked');
  assert.deepEqual(await f.link(), { ...first, alreadyLinked: true }); assert.deepEqual(await f.snapshot(), saved);
  await unchangedOnReject(f, () => f.link({ p_actor_id: randomUUID() }));
  await unchangedOnReject(f, () => f.db.query("update public.xero_financial_document_mappings set retained_differences='{}'"));
  await unchangedOnReject(f, () => f.db.query('delete from public.xero_financial_document_mappings'));
});

for (const [index, unit] of ['MT', 'MTS', 'METRIC TON', 'METRIC TONS', 'METRIC TONNE', 'METRIC TONNES'].entries()) {
  test(`v2 SQL accepts literal ${unit} with only matching or explicitly null paper dates`, async (t) => {
    const f = await fixture(t, { attachmentPolicy: true, configure: input => {
      const review = input.fileEvidence.review; review.lines[0].unit = unit;
      if (index % 2) review.invoiceDate = input.source.invoiceDate;
      if (index % 3) review.dueDate = input.source.dueDate;
    } });
    assert.equal((await f.link()).status, 'linked');
    assert.deepEqual((await f.snapshot()).items[0].xero_payload, f.input.xero);
  });
}

test('v2 SQL retains twenty reviewed attachments, all supported roles and valid 15/18 IDs without truncation', async (t) => {
  const f = await fixture(t, { attachmentPolicy: true, configure: input => {
    const file = input.fileEvidence; const entries = file.attachmentManifest.entries;
    file.attachmentManifest.entries = Array.from({ length: 20 }, (_, index) => {
      const suffix = String(index + 1).padStart(12, '0');
      const entry = { ...entries[index ? 1 : 0], linkId: `06A${suffix}`, documentId: `069${suffix}`, versionId: `068${suffix}` };
      if (index) entry.role = ['delivery_receipt', 'order_confirmation', 'terms', 'duplicate_selected_invoice'][index % 4];
      if (entry.role === 'duplicate_selected_invoice') Object.assign(entry, { sha256: file.sha256, checksum: file.checksum, contentSize: file.contentSize });
      if (index % 2) for (const key of ['linkId', 'documentId', 'versionId']) entry[key] = sf18(entry[key]);
      return entry;
    });
    file.attachmentManifest.selectedDocumentId = sf18(file.documentId);
    file.attachmentManifest.selectedVersionId = sf18(file.versionId);
  } });
  assert.ok(Buffer.byteLength(f.review.accountingCanonical, 'utf8') < 100000);
  assert.ok(Buffer.byteLength(f.review.evidenceCanonical, 'utf8') < 100000);
  await f.db.exec('set role service_role'); assert.equal((await f.link()).status, 'linked');
  const saved = (await f.snapshot()).mappings[0].retained_differences.issuedSupplierPreservation.evidence.accounting.issuedFile;
  assert.equal(saved.attachmentManifest.entries.length, 20);
  assert.deepEqual(saved, f.review.evidence.accounting.issuedFile);
});

test('v2 manifest SQL mirrors the JS contract and rejects rehashed structural, identity and selected byte contradictions', async (t) => {
  const f = await fixture(t, { attachmentPolicy: true });
  await f.db.exec('set role service_role');
  const check = async file => (await f.db.query('select public.xero_issued_petroleum_attachment_manifest_v2($1::jsonb,$2::jsonb) as valid',
    [JSON.stringify(file.attachmentManifest ?? null), JSON.stringify(file)])).rows[0].valid;
  assert.equal(await check(f.input.fileEvidence), true);
  for (const [label, change] of invalidManifestChanges) {
    await t.test(label, async () => {
      const file = structuredClone(f.input.fileEvidence); change(file);
      assert.equal(validateIssuedPetroleumAttachmentManifest(file.attachmentManifest, file), false);
      assert.equal(await check(file), false);
      await rejectedOwnershipMutation(f, a => change(a.issuedFile));
    });
  }
  const positive = structuredClone(f.input.fileEvidence);
  for (const entry of positive.attachmentManifest.entries) for (const key of ['linkId', 'documentId', 'versionId']) entry[key] = sf18(entry[key]);
  Object.assign(positive.attachmentManifest.entries[1], { role: 'duplicate_selected_invoice', sha256: positive.sha256,
    checksum: positive.checksum, contentSize: positive.contentSize });
  assert.equal(validateIssuedPetroleumAttachmentManifest(positive.attachmentManifest, positive), true);
  assert.equal(await check(positive), true);
  assert.equal((await f.link()).status, 'linked');
});

test('v2 rehashed absent/conflicting paper dates and unsupported units fail without changing other financial gates', async (t) => {
  const f = await fixture(t, { attachmentPolicy: true, configure: configureInactiveOwners });
  const mutations = [
    ...['invoiceDate', 'dueDate'].flatMap(key => [
      [key + ' absent', a => { delete a.issuedFile.review[key]; }],
      [key + ' empty', a => { a.issuedFile.review[key] = ''; }],
      [key + ' conflict', a => { a.issuedFile.review[key] = '2026-12-31'; }],
      [key + ' object', a => { a.issuedFile.review[key] = {}; }],
    ]),
    ...['TN', 'TON', 'TONS', 'mts', 'M/T', 'MT ', null].map(unit => ['unit ' + unit, a => { a.issuedFile.review.lines[0].unit = unit; }]),
    ['changed source date', a => { a.source.invoiceDate = '2026-12-31'; }],
    ['changed delivery bridge', a => { a.deliveryIdentity.deliveryDate = '2026-12-31'; }],
    ['changed Xero date', a => { a.xero.date = '2026-12-31'; }],
    ['changed total', a => { a.source.totalCents = '3004'; }],
    ['changed Contact', a => { a.xero.contactId = randomUUID(); }],
    ['changed owner union', a => { a.identityOwnership.owners[1].inactiveSuspended = false; }],
    ['unproven source number', a => { a.issuedFile.review.printedNumber = 'DIFFERENT'; }],
  ];
  for (const [label, change] of mutations) {
    await t.test(label, () => rejectedOwnershipMutation(f, change));
  }
  await unchangedOnReject(f, () => f.link({ p_actor_id: randomUUID() }));
  await unchangedOnReject(f, () => f.link({ p_expected_run_revision: 2 }));
  await unchangedOnReject(f, () => f.link({ p_review: { ...f.review, policyVersion: 'unknown' } }), { code: '22023' });
  await f.db.exec('begin');
  try {
    await f.db.query('update public.xero_financial_product_mappings set approved_at=null');
    await assert.rejects(f.link(), { code: '40001' });
  } finally { await f.db.exec('rollback'); }
  assert.equal((await f.link()).status, 'linked');
});

test('actual v2 normal builder and adapter proof persists through SQL without rewriting literal dates or target fields', async (t) => {
  const f = await fixture(t, { attachmentPolicy: true }); const real = issuedPetroleumV2Fixture(); const evaluated = real.build();
  assert.equal(evaluated.eligible, true, JSON.stringify(evaluated.blockers));
  const review = { ...f.review, policyVersion: evaluated.policyVersion, fingerprint: evaluated.fingerprint,
    evidenceFingerprint: evaluated.evidenceFingerprint, evidence: evaluated.evidence,
    accountingCanonical: stable({ policyVersion: evaluated.policyVersion, accounting: evaluated.evidence.accounting }),
    evidenceCanonical: stable(evaluated.evidence) };
  const source = { ...real.source, issuedSupplierReviewFingerprint: review.reviewFingerprint,
    issuedSupplierPreservation: { policyVersion: review.policyVersion, eligible: true, accepted: false, requiresExplicitReview: true,
      fingerprint: review.fingerprint, evidenceFingerprint: review.evidenceFingerprint } };
  const mapping = real.stored.productMappings[0];
  await f.db.query('update public.xero_contact_sync_connections set tenant_id=$1', [real.ids.tenant]);
  await f.db.query(`update public.xero_financial_product_mappings set id=$1,salesforce_product_id=$2,
    salesforce_product_name=$3,approved_by=$4,approved_by_email=$5,approved_at=$6`,
  [mapping.id, mapping.salesforce_product_id, mapping.salesforce_product_name, mapping.approved_by, mapping.approved_by_email, mapping.approved_at]);
  await f.db.query(`update public.xero_financial_sync_items set source_id=$1,source_document_number=$2,source_total=$3,
    source_payload=$4,xero_payload=$5,xero_document_id=$6`, [real.source.salesforceId, real.source.documentNumber, real.source.total,
    JSON.stringify(source), JSON.stringify(real.candidate), real.candidate.id]);
  await f.db.exec('set role service_role');
  assert.equal((await f.link({ p_tenant_id: real.ids.tenant, p_review: review })).status, 'linked');
  const saved = await f.snapshot();
  assert.deepEqual(saved.items[0].xero_payload, real.candidate);
  assert.deepEqual(saved.items[0].source_payload, source);
  assert.deepEqual(saved.mappings[0].retained_differences.issuedSupplierPreservation.evidence, evaluated.evidence);
  assert.deepEqual(saved.audits[0].record_counts, { linked: 1, applied: 0, financialWrites: 0 });
});

test('PostgreSQL v2 preserves locking, immutable replay and rehashed attachment rejection under service_role', {
  skip: !concurrencyUrl && 'Set FCOS_ISSUED_PETROLEUM_TEST_DATABASE_URL to a disposable local Supabase-compatible PostgreSQL endpoint', timeout: 60000,
}, async (t) => {
  const f = await postgresFixture(t, { attachmentPolicy: true, configure: configureInactiveOwners });
  const second = await f.connect();
  await f.primary.query('set role service_role'); await second.query('set role service_role');
  await rejectedOwnershipMutation(f, a => { a.issuedFile.attachmentManifest.entries[1].role = 'credit_note'; });
  await f.primary.query('begin'); const first = await f.call(f.primary);
  const pending = f.call(second).then(value => ({ value }), error => ({ error }));
  await f.waitForLock(second); await f.primary.query('commit');
  assert.deepEqual((await pending).value, { ...first, alreadyLinked: true });
  const saved = await f.snapshot(); assert.equal(saved.mappings.length, 1); assert.equal(saved.audits.length, 1);
  assert.equal(saved.items[0].mutation_attempts, 0);
  await unchangedOnReject(f, () => f.call(f.primary, { p_actor_id: randomUUID() }));
});
