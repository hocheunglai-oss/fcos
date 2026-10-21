import assert from 'node:assert/strict';
import test from 'node:test';
import { issuedPetroleumFixture, issuedPetroleumOwnerFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { issuedPetroleumV2Fixture } from './xeroIssuedPetroleumV2Fixtures.js';
import { evaluatePetroleumFinancialDocument } from '../api/_xeroIssuedPetroleumPreservationAdapter.js';
import { evaluateIssuedPetroleumPreservation, ISSUED_PETROLEUM_PRESERVATION_V2_POLICY as POLICY } from '../api/_xeroIssuedPetroleumPreservation.js';
import { validateIssuedPetroleumAttachmentManifest } from '../api/_xeroIssuedPetroleumPaper.js';
import { currentIssuedPetroleumMatches } from '../api/_xeroIssuedPetroleumSticky.js';
import { issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';
import { normalizeXeroInvoice } from '../api/_xeroFinancialSync.js';

const refreshTarget = (f) => { Object.assign(f.candidate, normalizeXeroInvoice(f.raw)); f.refreshScope(); };
const blocked = (f, code) => { f.refreshScope(); const r = f.build(); assert.equal(r.eligible, false, JSON.stringify(r));
  assert.equal(r.evidence, null); if (code) assert.ok(r.blockers.some((x) => x.code === code), JSON.stringify(r.blockers)); };
const stickyContext = (f) => ({ ...f.context, issuedPetroleumCurrent: { suppliers: f.salesforce.suppliers,
  lines: f.salesforce.lines, extras: f.salesforce.extras, products: f.salesforce.productRecords } });
const rehash = (proof) => { proof.fingerprint = hash({ policyVersion: proof.policyVersion, accounting: proof.evidence.accounting });
  proof.evidenceFingerprint = hash(proof.evidence); return proof; };

test('v1 singleton and inactive-owner receipt vectors remain byte-equivalent', () => {
  for (const [make, fingerprint, evidenceFingerprint] of [
    [issuedPetroleumFixture, '5f83badf83d013bf405999b4022980f57838a6a702b258d59633b8ab043136d7', 'deda29ca0056df4a7eeeb556ce026782570ab87aac375a06b874fc640340cdc8'],
    [issuedPetroleumOwnerFixture, '032c8c662cc742dbe9642a1ffa896d32acf72b15b284572043ef1ba2c9ccaf02', '61c52b0e12072fe7a8aa3217076429573b309b4528e7cca3fc26c50db21b0258'],
  ]) { const result = make().build(); assert.equal(result.eligible, true); assert.equal(result.fingerprint, fingerprint); assert.equal(result.evidenceFingerprint, evidenceFingerprint); }
});

test('v2 retains absent paper dates, literal units and every attachment while preserving source and Xero facts', () => {
  const f = issuedPetroleumV2Fixture(); const before = JSON.stringify({ source: f.source, candidate: f.candidate, file: f.fileEvidence });
  const result = f.build(); assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  const accounting = result.evidence.accounting;
  assert.equal(result.policyVersion, POLICY); assert.equal(result.accepted, false);
  assert.equal(accounting.issuedFile.review.invoiceDate, null); assert.equal(accounting.issuedFile.review.dueDate, null);
  assert.equal(accounting.source.invoiceDate, f.supplier.Invoice_Date__c); assert.equal(accounting.source.dueDate, f.supplier.Invoice_Due_Date__c);
  assert.equal(accounting.xero.date, f.raw.Date); assert.equal(accounting.xero.dueDate, f.raw.DueDate);
  assert.equal(accounting.issuedFile.review.lines[0].unit, 'MTS'); assert.deepEqual(accounting.issuedFile.attachmentManifest, f.fileEvidence.attachmentManifest);
  assert.equal(result.proposedPayload, undefined); assert.equal(f.source.readiness.ready, false);
  assert.equal(JSON.stringify({ source: f.source, candidate: f.candidate, file: f.fileEvidence }), before);
  assert.equal(currentIssuedPetroleumMatches(f.source, stickyContext(f), result), true);
});

for (const unit of ['MT', 'MTS', 'METRIC TON', 'METRIC TONS', 'METRIC TONNE', 'METRIC TONNES']) test(`v2 preserves explicit metric notation ${unit}`, () => {
  const f = issuedPetroleumV2Fixture(); f.fileEvidence.review.lines[0].unit = unit;
  const result = f.build(); assert.equal(result.eligible, true); assert.equal(result.evidence.accounting.issuedFile.review.lines[0].unit, unit);
});
for (const unit of ['TN', 'TON', 'TONS', 'TONNE', 'TONNES', 'BBL', '', null, undefined, 'MT\u0000', 'MTS\n']) test(`v2 rejects unsupported unit ${String(unit)}`, () => {
  const f = issuedPetroleumV2Fixture(); f.fileEvidence.review.lines[0].unit = unit; blocked(f, 'UNIT_UNSUPPORTED');
});
for (const key of ['invoiceDate', 'dueDate']) {
  test(`v2 accepts matching explicit ${key}`, () => { const f = issuedPetroleumV2Fixture(); f.fileEvidence.review[key] = f.source[key]; assert.equal(f.build().eligible, true); });
  for (const value of ['2026-04-02', '2026-02-30', '', undefined, false]) test(`v2 rejects conflicting or unknown ${key} ${String(value)}`, () => {
    const f = issuedPetroleumV2Fixture(); f.fileEvidence.review[key] = value; blocked(f);
  });
  test(`v2 still requires authoritative source ${key}`, () => { const f = issuedPetroleumV2Fixture(); f.source[key] = null; blocked(f); });
}

test('v2 does not substitute absent paper issue date for the delivery-to-Xero date bridge', () => {
  const f = issuedPetroleumV2Fixture(); f.raw.Date = f.supplier.Invoice_Date__c; refreshTarget(f); blocked(f);
});
test('v1 rejects v2 manifest/date/unit markers and v2 is only chosen by trusted adapter options', () => {
  const f = issuedPetroleumV2Fixture(); f.context.policyVersion = POLICY; f.fileEvidence.policyVersion = POLICY;
  assert.equal(evaluatePetroleumFinancialDocument(f.source, f.candidate, f.context, f.fileEvidence).eligible, false);
  for (const policyVersion of [null, '', 'issued_petroleum_preserve_v3', {}]) assert.equal(evaluatePetroleumFinancialDocument(f.source, f.candidate, f.context, f.fileEvidence, { policyVersion }).eligible, false);
  assert.ok(evaluateIssuedPetroleumPreservation({ policyVersion: 'unknown' }).blockers.some((b) => b.code === 'POLICY_UNSUPPORTED'));
});

for (const [name, change] of [
  ['missing', f => { delete f.fileEvidence.attachmentManifest; }],
  ['null', f => { f.fileEvidence.attachmentManifest = null; }],
  ['incomplete', f => { f.fileEvidence.attachmentManifest.complete = false; }],
  ['unknown marker', f => { f.fileEvidence.attachmentManifest.verified = true; }],
  ['wrong selected document', f => { f.fileEvidence.attachmentManifest.selectedDocumentId = '069000000000002'; }],
  ['wrong selected version', f => { f.fileEvidence.attachmentManifest.selectedVersionId = '068000000000002'; }],
  ['selected bytes', f => { f.fileEvidence.attachmentManifest.entries[0].sha256 = 'a'.repeat(64); }],
  ['selected review', f => { f.fileEvidence.attachmentManifest.entries[0].reviewRecordHash = 'a'.repeat(64); }],
  ['competing invoice', f => { f.fileEvidence.attachmentManifest.entries[1].role = 'issued_invoice'; }],
  ['credit', f => { f.fileEvidence.attachmentManifest.entries[1].role = 'credit_note'; }],
  ['unknown support', f => { f.fileEvidence.attachmentManifest.entries[1].role = 'unknown'; }],
  ['unreviewed support', f => { delete f.fileEvidence.attachmentManifest.entries[1].reviewRecordHash; }],
  ['duplicate claim different bytes', f => { f.fileEvidence.attachmentManifest.entries[1].role = 'duplicate_selected_invoice'; }],
  ['duplicate document', f => { f.fileEvidence.attachmentManifest.entries[1].documentId = f.fileEvidence.documentId; }],
  ['duplicate version', f => { f.fileEvidence.attachmentManifest.entries[1].versionId = f.fileEvidence.versionId; }],
  ['duplicate link', f => { f.fileEvidence.attachmentManifest.entries[1].linkId = f.fileEvidence.link.id; }],
  ['unsorted', f => { f.fileEvidence.attachmentManifest.entries.reverse(); }],
  ['non-PDF', f => { f.fileEvidence.attachmentManifest.entries[1].fileType = 'TXT'; }],
  ['malformed 18-character ID', f => { f.fileEvidence.attachmentManifest.entries[1].linkId += 'ZZZ'; }],
  ['unknown fields', f => { f.fileEvidence.attachmentManifest.entries[1].verified = true; }],
  ['null entry', f => { f.fileEvidence.attachmentManifest.entries[1] = null; }],
  ['empty', f => { f.fileEvidence.attachmentManifest.entries = []; }],
  ['unbounded file', f => { f.fileEvidence.attachmentManifest.entries[1].contentSize = 5_000_001; }],
]) test(`v2 rejects attachment ${name}`, () => { const f = issuedPetroleumV2Fixture(); change(f); blocked(f, 'ATTACHMENT_MANIFEST_INVALID'); });

test('identical reviewed native duplicates are retained, not counted as a competing invoice', () => {
  const f = issuedPetroleumV2Fixture(); const other = f.fileEvidence.attachmentManifest.entries[1];
  Object.assign(other, { role: 'duplicate_selected_invoice', sha256: f.fileEvidence.sha256, checksum: f.fileEvidence.checksum, contentSize: f.fileEvidence.contentSize });
  assert.equal(f.build().eligible, true); other.checksum = 'a'.repeat(32); blocked(f, 'ATTACHMENT_MANIFEST_INVALID');
});

test('complete attachment evidence is bounded at twenty entries without truncation', () => {
  const f = issuedPetroleumV2Fixture(); const entries = f.fileEvidence.attachmentManifest.entries;
  for (let n = 3; n <= 20; n++) entries.push({ ...entries[1], linkId: `06A${String(n).padStart(12, '0')}`,
    documentId: `069${String(n).padStart(12, '0')}`, versionId: `068${String(n).padStart(12, '0')}` });
  const result = f.build(); assert.equal(result.eligible, true); assert.equal(result.evidence.accounting.issuedFile.attachmentManifest.entries.length, 20);
  entries.push({ ...entries[1], linkId: '06A000000000021', documentId: '069000000000021', versionId: '068000000000021' });
  blocked(f, 'ATTACHMENT_MANIFEST_INVALID');
});

test('saved missing-issue-date shape needs complete independent source, delivery and identity facts', () => {
  // Anonymized reconstruction of the sealed 600 MT x USD460 documentary case.
  // Dates/economics reproduce its literal pattern; fixture IDs and assertions
  // are synthetic and do not claim eligibility for the real customer record.
  const f = issuedPetroleumV2Fixture();
  Object.assign(f.supplier, { Invoice_Date__c: '2026-02-03', Invoice_Due_Date__c: '2026-02-23', Invoice_Amount__c: 276000 });
  f.supplier.STEM__r.Delivery_Date__c = '2026-01-25';
  Object.assign(f.child, { Quantity_Delivered_Per_BDN__c: 600, Unit_Buy_At__c: 460, Total_Cost__c: 276000 });
  Object.assign(f.raw, { Date: '2026-01-25', DueDate: '2026-01-25', Total: 276000, SubTotal: 276000, AmountDue: 276000 });
  Object.assign(f.raw.LineItems[0], { UnitAmount: 276000, LineAmount: 276000 });
  Object.assign(f.fileEvidence.review, { invoiceDate: null, dueDate: '2026-02-23', deliveryDate: '2026-01-25', total: '276000.00' });
  Object.assign(f.fileEvidence.review.lines[0], { quantity: '600.000', unit: 'MT', unitPrice: '460.000', amount: '276000.00' });
  f.rebuild();
  const result = f.build(); assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  assert.equal(result.evidence.accounting.issuedFile.review.invoiceDate, null);
  assert.equal(result.evidence.accounting.source.invoiceDate, '2026-02-03');
  assert.equal(result.evidence.accounting.xero.date, '2026-01-25');
  f.scope.coverage.creditComplete = false;
  blocked(f, 'IDENTITY_SCOPE_INCOMPLETE');
});

test('manifest binding supports canonical 15/18 IDs and ignores JSON object key order', () => {
  const f = issuedPetroleumV2Fixture(); const suffix = (id) => { const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'; let s='';
    for(let p=0;p<15;p+=5){let n=0;for(let i=0;i<5;i++)if(/[A-Z]/.test(id[p+i]))n|=1<<i;s+=chars[n];}return id+s; };
  const manifest = f.fileEvidence.attachmentManifest;
  for (const row of manifest.entries) for (const key of ['linkId','documentId','versionId']) row[key] = suffix(row[key]);
  assert.equal(validateIssuedPetroleumAttachmentManifest(manifest, f.fileEvidence), true);
  const r=f.build(); assert.equal(r.eligible,true);
  manifest.entries = manifest.entries.map(row=>Object.fromEntries(Object.entries(row).reverse()));
  assert.equal(f.build().fingerprint,r.fingerprint);
});

test('v2 accepted proof rejects stripped or rehashed documentary markers and current source drift', () => {
  const f = issuedPetroleumV2Fixture(); const initial = f.build();
  for (const change of [p=>{delete p.evidence.accounting.issuedFile.attachmentManifest;},
    p=>{p.evidence.accounting.issuedFile.attachmentManifest.complete=false;},
    p=>{p.evidence.accounting.issuedFile.attachmentManifest.entries[1].role='credit_note';},
    p=>{p.evidence.accounting.issuedFile.review.invoiceDate='2026-01-01';},
    p=>{delete p.evidence.accounting.issuedFile.review.dueDate;},
    p=>{p.evidence.accounting.issuedFile.review.lines[0].unit='TN';},
    p=>{p.policyVersion=p.evidence.policyVersion='issued_petroleum_preserve_v1';},
  ]) { const proof=structuredClone(initial); change(proof); rehash(proof); assert.equal(currentIssuedPetroleumMatches(f.source,stickyContext(f),proof),false); }
  f.child.Unit_Buy_At__c += 0.00001;
  assert.equal(currentIssuedPetroleumMatches(f.source,stickyContext(f),initial),false);
});

for (const [name, change] of [
  ['settlement', f=>{f.raw.AmountPaid=1;f.raw.AmountDue-=1;refreshTarget(f);}],
  ['refund/credit', f=>{f.raw.CreditNotes=[{CreditNoteID:f.ids.target}];}],
  ['different paper total', f=>{f.fileEvidence.review.total='1707836.17';}],
  ['paper unit price precision', f=>{f.fileEvidence.review.lines[0].unitPrice='856.82401';}],
  ['wrong buyer', f=>{f.fileEvidence.review.buyerName='PENINSULA';}],
  ['wrong vessel', f=>{f.fileEvidence.review.vessel='VESSEL TWO';}],
  ['hidden source extra', f=>{f.scope.sourceFacts.get(f.ids.source).extras.push({Id:'a04000000000001'});}],
  ['missing mapping approval', f=>{f.stored.productMappings[0].approved_by=null;}],
  ['unknown currency', f=>{f.supplier.CurrencyIsoCode=null;}],
  ['tracking', f=>{f.raw.LineItems[0].Tracking.push({Name:'Region',Option:'HK'});refreshTarget(f);}],
  ['same-STEM negative credit', f=>{f.scope.sourceClaims.push({...structuredClone(f.supplier),Id:'a06000000000002',Name:'CR2500001',Invoice_Amount__c:-1,Invoice_Date__c:null});}],
  ['target number collision', f=>{const raw={...structuredClone(f.raw),InvoiceID:'00000000-0000-4000-8000-000000000020'};f.scope.targetClaims.push({raw,document:normalizeXeroInvoice(raw)});}],
]) test(`v2 retains ${name} hold despite optional paper dates`,()=>{const f=issuedPetroleumV2Fixture();change(f);blocked(f);});
