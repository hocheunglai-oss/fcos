import assert from 'node:assert/strict';
import test from 'node:test';
import { issuedSupplierFixture, issuedSupplierWorkflowFixture } from './xeroIssuedSupplierPreservationFixtures.js';
import { buildFinancialClassifications } from '../api/_xeroFinancialSync.js';
import { buildGroupedPreservationContext } from '../api/_xeroGroupedPreservationAdapter.js';
import { evaluateIssuedSupplierFinancialDocument } from '../api/_xeroIssuedSupplierPreservationAdapter.js';
import { hasIssuedSupplierPreservation } from '../api/_xeroIssuedSupplierPreservationAdapter.js';
import { evaluateIssuedSupplierPreservation, issuedSupplierAccountingFingerprint, issuedSupplierHash,
  issuedSupplierCents, issuedSupplierSfId, ISSUED_SUPPLIER_PRESERVATION_POLICY } from '../api/_xeroIssuedSupplierPreservation.js';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = (text) => issuedSupplierHash(text);
const copy = (value) => structuredClone(value);

test('verified issued trustee proof preserves all historical details without changing readiness or input', () => {
  const f = issuedSupplierFixture(); const before = copy([f.source, f.candidate, f.fileEvidence]);
  const result = f.build(); assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  assert.equal(result.policyVersion, ISSUED_SUPPLIER_PRESERVATION_POLICY); assert.equal(result.accepted, false);
  assert.equal(result.fingerprint, issuedSupplierAccountingFingerprint(result.evidence));
  assert.equal(result.evidenceFingerprint, issuedSupplierHash(result.evidence));
  assert.equal(result.evidence.accounting.source.totalCents, '12420');
  assert.equal(result.evidence.accounting.xero.invoiceNumber, '79117PT-SEA STELLAR');
  assert.equal(result.evidence.accounting.xero.dueDate, '2026-01-05');
  assert.equal(result.evidence.accounting.xero.lines[0].quantity, '1');
  assert.equal(result.evidence.accounting.source.lines[0].quantity, '248.394');
  assert.deepEqual(result.evidence.accounting.xero.rawLineItems, f.candidate.lineItems);
  assert.equal(f.source.readiness.ready, false); assert.equal(result.proposedPayload, undefined);
  assert.deepEqual([f.source, f.candidate, f.fileEvidence], before); assert.ok(Object.isFrozen(result.evidence.accounting));
  assert.equal(result.evidence.accounting.issuedFile.review.lines.length, 2);
});

test('only the missing legacy pointer hold is permitted', async (t) => {
  for (const [name, change] of [
    ['child supplier disagreement', (f) => f.source.readiness.blockers.push('Supplier invoice and linked accounting children identify different suppliers.')],
    ['source currency blocker', (f) => f.source.blockers.push('Currency missing')],
    ['missing readiness evidence', (f) => { delete f.source.readiness; }],
    ['wrong current child', (f) => { f.source.readiness.linkedChildren = ['a04000000000099']; }],
    ['cancelled child', (f) => f.source.readiness.blockers.push('Supplier posting requires current non-cancelled children linked to this exact issued invoice.')],
  ]) await t.test(name, () => { const f = issuedSupplierFixture(); change(f); assert.equal(f.build().eligible, false); });
});

test('documentary exceptions and exact invoice date remain held', async (t) => {
  for (const [name, change, code] of [
    ['vessel typo', (f) => { f.fileEvidence.review.vessel = 'SEA STELAR'; }, 'VESSEL_MISMATCH'],
    ['vessel substring', (f) => { f.candidate.invoiceNumber = '79117PT-SEA STELLAR II'; }, 'VESSEL_MISMATCH'],
    ['paper one-cent discrepancy', (f) => { f.fileEvidence.review.lines[1].amount = '14.61'; }, 'PAPER_ARITHMETIC_MISMATCH'],
    ['Xero accounting date difference', (f) => { f.candidate.date = '2026-01-04'; }, 'INVOICE_DATE_MISMATCH'],
    ['unreviewed punctuation pattern', (f) => { f.fileEvidence.review.printedNumber = 'M/26/01/010'; }, 'ISSUED_NUMBER_MISMATCH'],
    ['paper seller', (f) => { f.fileEvidence.review.sellerName = 'Other supplier'; }, 'SELLER_MISMATCH'],
    ['paper buyer', (f) => { f.fileEvidence.review.buyerName = 'Other customer'; }, 'BUYER_MISMATCH'],
  ]) await t.test(name, () => { const f = issuedSupplierFixture(); change(f); const r = f.build(); assert.equal(r.eligible, false); assert.ok(r.blockers.some((b) => b.code === code), JSON.stringify(r.blockers)); });
});

test('complete exclusive source, Contact, historical number and target ownership are mandatory', async (t) => {
  const scenarios = [
    ['context incomplete', (f) => { f.context.complete = false; }],
    ['same date amount and vessel second source', (f) => f.context.sources.push({ ...f.source, salesforceId: 'a06000000000002', documentNumber: 'M2601099' })],
    ['source vessel unknown', (f) => f.context.sources.push({ ...f.source, salesforceId: 'a06000000000002', documentNumber: 'M2601099', issuedSupplierVessel: null })],
    ['second target', (f) => f.context.documents.push({ ...f.candidate, id: uuid(33), invoiceNumber: '99999PT-SEA STELLAR' })],
    ['unparseable competing target', (f) => f.context.documents.push({ ...f.candidate, id: uuid(33), invoiceNumber: 'unresolved' })],
    ['source-number target outside date', (f) => f.context.documents.push({ ...f.candidate, id: uuid(33), invoiceNumber: 'M-26-01-010', date: '2026-02-01' })],
    ['historical-number target outside date', (f) => f.context.documents.push({ ...f.candidate, id: uuid(33), date: '2026-02-01' })],
    ['same-number source outside date', (f) => f.context.sources.push({ ...f.source, salesforceId: 'a06000000000002', invoiceDate: '2026-02-01' })],
    ['shared Contact Account', (f) => f.context.members.get(f.ids.contact).push({ id: '001000000000002' })],
    ['multiple active Contacts', (f) => { f.context.matchesFor = () => [f.xero.contacts[0], { ...f.xero.contacts[0], id: uuid(44) }]; }],
    ['changed Account outside source snapshot', (f) => { f.context.accountsById.get(f.ids.account).name = 'Other'; }],
    ['existing canonical source owner', (f) => f.stored.documentMappings.push({ salesforce_object: 'Supplier_Invoice__c', salesforce_id: f.ids.source, xero_document_id: uuid(90) })],
    ['existing target owner in another type', (f) => f.stored.documentMappings.push({ salesforce_object: 'Invoice__c', salesforce_id: 'a01000000000002', xero_document_id: f.ids.target.toUpperCase() })],
  ];
  for (const [name, change] of scenarios) await t.test(name, () => { const f = issuedSupplierFixture(); change(f); assert.equal(f.build().eligible, false, name); });
});

test('a stronger exact STEM reference must agree with the authoritative key', async (t) => {
  for (const [reference, stemKey, eligible] of [
    ['Historical memo', 'HK2524197T', true],
    ['Ref: HK2524197T / trustee', 'HK2524197T', true],
    ['Ref: hk2524197t', 'HK2524197T', true],
    ['Ref: HK2524198T', 'HK2524197T', false],
    ['HK2524197T and HK2524198T', 'HK2524197T', false],
    ['HK2524197T', null, false],
    ['HK2524197T', 'HK2524197T - SEA STELLAR', false],
  ]) await t.test(`${reference} / ${stemKey}`, () => {
    const f = issuedSupplierFixture(); f.candidate.reference = reference; f.source.stemKey = stemKey;
    f.source.stemName = 'HK2524197T - SEA STELLAR';
    const result = f.build(); assert.equal(result.eligible, eligible, JSON.stringify(result.blockers));
    if (!eligible) assert.equal(result.blockers[0].code, 'STEM_REFERENCE_CONFLICT');
  });
});

test('file identity, version, checksum and review are bound, never client readiness flags', async (t) => {
  for (const [name, change] of [
    ['wrong org', (f) => { f.fileEvidence.orgId = '00D000000000001'; }],
    ['foreign parent', (f) => { f.fileEvidence.link.parentId = 'a06000000000002'; }],
    ['foreign document', (f) => { f.fileEvidence.version.documentId = '069000000000002'; }],
    ['not latest', (f) => { f.fileEvidence.version.isLatest = false; }],
    ['replaced latest', (f) => { f.fileEvidence.version.latestPublishedVersionId = '068000000000002'; }],
    ['checksum mismatch', (f) => { f.fileEvidence.version.checksum = '1'.repeat(32); }],
    ['size mismatch', (f) => { f.fileEvidence.version.contentSize += 1; }],
    ['invalid SHA', (f) => { f.fileEvidence.sha256 = 'verified'; }],
    ['missing fact review', (f) => { delete f.fileEvidence.review.reviewRecordHash; }],
    ['invalid file ID checksum', (f) => { f.fileEvidence.versionId += 'xxx'; }],
    ['fabricated ready flag without content', (f) => { delete f.fileEvidence.review; f.fileEvidence.ready = true; }],
  ]) await t.test(name, () => { const f = issuedSupplierFixture(); change(f); assert.equal(f.build().eligible, false); });
  const f = issuedSupplierFixture(); const original = f.build(); f.fileEvidence.sha256 = hash('replaced bytes');
  assert.notEqual(f.build().fingerprint, original.fingerprint, 'A valid changed hash invalidates saved review, not silently reuse it');
});

test('authoritative cents, mapping and settlement cannot be relaxed for preservation', async (t) => {
  for (const [name, change] of [
    ['source fractional cent', (f) => { f.source.groupedAccounting.total = '124.201'; }],
    ['source quantity arithmetic', (f) => { f.source.groupedAccounting.lines[0].quantity = '248.3'; }],
    ['missing source line amount', (f) => { delete f.source.groupedAccounting.lines[0].lineAmount; }],
    ['missing source currency', (f) => { delete f.source.groupedAccounting.lines[0].currency; }],
    ['missing quantity', (f) => { delete f.source.groupedAccounting.lines[0].quantity; }],
    ['wrong product', (f) => { f.source.lines[0].productName = 'Other'; }],
    ['second source line', (f) => f.source.groupedAccounting.lines.push(copy(f.source.groupedAccounting.lines[0]))],
    ['second target line', (f) => f.candidate.lineItems.push(copy(f.candidate.lineItems[0]))],
    ['Xero header amount', (f) => { f.candidate.groupedAccounting.total = 124.21; }],
    ['Xero line amount', (f) => { f.candidate.lineItems[0].LineAmount = 124.21; }],
    ['Xero tax', (f) => { f.candidate.groupedAccounting.totalTax = 0.01; }],
    ['Xero discount', (f) => { f.candidate.lineItems[0].DiscountRate = 1; }],
    ['Xero tracking', (f) => { f.candidate.lineItems[0].Tracking = [{ Name: 'Desk' }]; }],
    ['Xero inventory', (f) => { f.candidate.lineItems[0].ItemCode = 'FUEL'; }],
    ['Xero currency rate', (f) => { f.candidate.groupedAccounting.currencyRate = 7.8; }],
    ['base currency', (f) => { f.context.organisation.baseCurrency = 'HKD'; }],
    ['mapping disabled', (f) => { f.stored.productMappings[0].enabled = false; }],
    ['mapping changed account', (f) => { f.stored.productMappings[0].xero_account_code = '51100'; }],
    ['mapping missing revision', (f) => { delete f.stored.productMappings[0].revision; }],
    ['duplicate mapping', (f) => f.stored.productMappings.push(copy(f.stored.productMappings[0]))],
    ['paid', (f) => { f.candidate.status = 'PAID'; }],
    ['allocated', (f) => { f.candidate.groupedAccounting.amountPaid = 1; f.candidate.groupedAccounting.amountDue = 123.2; }],
    ['credited', (f) => { f.candidate.groupedAccounting.amountCredited = 1; f.candidate.groupedAccounting.amountDue = 123.2; }],
    ['raw header incomplete', (f) => { f.candidate.groupedAccounting.complete = false; }],
  ]) await t.test(name, () => { const f = issuedSupplierFixture(); change(f); assert.equal(f.build().eligible, false, name); });
});

test('all retained values change review fingerprint while valid representational differences remain intact', () => {
  const f = issuedSupplierFixture(); const first = f.build();
  f.candidate.lineItems[0].Description = 'Another retained description';
  const second = f.build(); assert.equal(second.eligible, true); assert.notEqual(second.fingerprint, first.fingerprint);
  f.candidate.lineItems[0].AccountID = uuid(77);
  assert.notEqual(f.build().fingerprint, second.fingerprint, 'Raw retained line fields are bound');
  f.candidate.unowned.Url = 'https://example.invalid/retained';
  assert.notEqual(f.build().fingerprint, second.fingerprint);
  f.source.postingMode = 'authorised'; assert.equal(f.build().eligible, true); assert.equal(f.source.readiness.ready, false);
});

test('pure validator fails closed for malformed input and bounded decimal helpers do not coerce', () => {
  for (const value of [null, [], {}, { source: null }, { source: { lines: [null] } }, { source: { x: 'a'.repeat(200001) } }]) {
    const result = evaluateIssuedSupplierPreservation(value); assert.equal(result.eligible, false); assert.equal(result.evidence, null);
  }
  const circular = {}; circular.value = circular; assert.equal(evaluateIssuedSupplierPreservation(circular).eligible, false);
  for (const value of [true, null, '', '1e2', '01.2', '-1', '1.001', NaN, Infinity]) assert.equal(issuedSupplierCents(value), null);
  assert.equal(issuedSupplierCents('124.20'), 12420n); assert.equal(issuedSupplierSfId('001000000000001AAA'), '001000000000001');
  assert.equal(issuedSupplierSfId('001000000000001xxx'), null);
  assert.equal(hasIssuedSupplierPreservation({ retained_differences: { issuedSupplierPreservation: null } }), true, 'Malformed stored policy must remain sticky');
});

test('oversized but arithmetically valid paper detail cannot exceed the atomic proof limit', () => {
  const f = issuedSupplierFixture();
  f.fileEvidence.review.lines = Array.from({ length: 50 }, (_, index) => ({ description: 'x'.repeat(2000), amount: index === 49 ? '2.68' : '2.48' }));
  const result = f.build(); assert.equal(result.eligible, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'EVIDENCE_BOUND'));
});

test('raw workflow fixture passes through the real source builder without fabricating readiness', () => {
  const f = issuedSupplierWorkflowFixture();
  const built = buildFinancialClassifications(f.salesforce, f.xero, f.stored, { postingMode: 'draft' });
  const source = built.sources[0];
  source.issuedSupplierVessel = f.vessels.get(source.salesforceId).vessel;
  const context = buildGroupedPreservationContext(f.salesforce, f.xero, f.stored, built.sources);
  const result = evaluateIssuedSupplierFinancialDocument(source, f.candidate, context, f.fileEvidence);
  assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  assert.equal(source.readiness.ready, false);
  assert.equal(built.rows[0].status, 'blocked');
});
