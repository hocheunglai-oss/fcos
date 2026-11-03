import assert from 'node:assert/strict';
import test from 'node:test';
import { issuedPetroleumFixture, issuedPetroleumOwnerFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { normalizeXeroInvoice, normalizeXeroCreditNote, buildFinancialClassifications } from '../api/_xeroFinancialSync.js';
import { issuedSupplierHash, issuedSupplierCents } from '../api/_xeroIssuedSupplierPreservation.js';
import { collectPetroleumPreservationScope, petroleumScopeFingerprint } from '../api/_xeroIssuedPetroleumScope.js';
import { evaluatePetroleumFinancialDocument } from '../api/_xeroIssuedPetroleumPreservationAdapter.js';

function target(f, patch) {
  Object.assign(f.raw, patch); Object.assign(f.candidate, normalizeXeroInvoice(f.raw));
}
const blocked = (f, code) => { f.refreshScope(); const result = f.build(); assert.equal(result.eligible, false, JSON.stringify(result));
  assert.equal(result.evidence, null); if (code) assert(result.blockers.some((row) => row.code === code), JSON.stringify(result.blockers)); };

test('petroleum bridge preserves aggregate Xero details and separate invoice/delivery dates without changing source readiness', () => {
  const f = issuedPetroleumFixture(); const before = structuredClone({ source: f.source, candidate: f.candidate });
  const result = f.build(); assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  assert.equal(result.accepted, false); assert.equal(result.policyVersion, 'issued_petroleum_preserve_v1');
  const a = result.evidence.accounting;
  assert.equal(a.source.invoiceDate, '2026-04-01'); assert.equal(a.xero.date, '2026-03-17'); assert.equal(a.deliveryIdentity.deliveryDate, a.xero.date);
  assert.equal(a.source.lines[0].quantity, '1993.217'); assert.equal(a.source.lines[0].unitAmount, '856.824');
  assert.equal(a.xero.lines[0].quantity, '1'); assert.equal(a.xero.lines[0].lineAmountCents, '170783616');
  assert.equal(a.issuedFile.review.totalTax, null); assert.equal(a.issuedFile.review.deliveryDate, null);
  assert.equal(a.productMappings[0].approvedBy, f.ids.approver);
  assert.deepEqual(a.xero.rawLineItems, f.raw.LineItems); assert.deepEqual(before, { source: f.source, candidate: f.candidate });
  assert.equal(f.source.readiness.ready, false); assert.equal(result.proposedPayload, undefined);
  assert.equal(result.fingerprint, issuedSupplierHash({ policyVersion: result.policyVersion, accounting: a }));
  assert.equal(result.evidenceFingerprint, issuedSupplierHash(result.evidence)); assert.equal(f.build().fingerprint, result.fingerprint);
});

for (const [name, patch] of [
  ['one-day historical date shift', f => target(f, { Date: '2026-03-18' })],
  ['expected date cannot replace missing delivery', f => { f.supplier.STEM__r.Delivery_Date__c = null; f.supplier.STEM__r.Expected_Delivery_Date__c = '2026-03-17'; }],
  ['missing authoritative vessel ID', f => { delete f.supplier.STEM__r.Vessel__c; }],
  ['different paper vessel spelling', f => { f.fileEvidence.review.vessel = 'VESSEL-ONE'; }],
  ['stronger conflicting exact HK reference', f => target(f, { Reference: 'HK2626999T' })],
  ['PI cannot equal printed FI', f => { f.source.documentNumber = f.supplier.Name = f.fileEvidence.review.sourceNumber = 'PET26PI1'; f.fileEvidence.review.printedNumber = 'PET-26-FI-1'; }],
  ['paper MAR cannot equal source APR', f => { f.fileEvidence.review.dueDate = '2026-03-15'; }],
  ['paper24 versus source27 dates', f => { f.fileEvidence.review.invoiceDate = '2026-03-24'; }],
  ['DMCC/FZCO is not a reviewed abbreviation', f => { f.fileEvidence.review.sellerName = f.fileEvidence.review.counterparties.printedSeller = 'EXAMPLE INTERNATIONAL SUPPLY DMCC'; }],
  ['paper missing explicit due date', f => { f.fileEvidence.review.dueDate = null; }],
  ['paper different quantity', f => { f.fileEvidence.review.lines[0].quantity = '1993.218'; }],
  ['paper price precision mismatch', f => { f.fileEvidence.review.lines[0].unitPrice = '856.82401'; }],
  ['mismatched authoritative Original_Supplier', f => { f.child.Original_Supplier__c = '001000000000002'; }],
  ['missing Original_Supplier cannot use substitute/input/nomination', f => { delete f.child.Original_Supplier__c; f.child.Supplier__c = f.ids.account; f.child.Substitute_Supplier__c = f.ids.account; f.child.Supplier_Input__c = f.ids.account; }],
  ['source ordered quantity fallback', f => { f.child.Quantity_Delivered_Per_BDN__c = null; }],
  ['source zero delivered quantity', f => { f.child.Quantity_Delivered_Per_BDN__c = 0; }],
  ['wrong physical unit', f => { f.child.Unit_of_Measure__c = 'BBL'; }],
  ['raw source line cent difference', f => { f.child.Total_Cost__c += 0.01; }],
  ['unapproved mapping', f => { delete f.stored.productMappings[0].approved_by; }],
  ['wrong account', f => { f.stored.productMappings[0].xero_account_code = '51106'; }],
  ['missing approval email', f => { f.stored.productMappings[0].approved_by_email = null; }],
  ['missing approval time', f => { f.stored.productMappings[0].approved_at = null; }],
  ['wrong product record type', f => { f.product.RecordType.DeveloperName = 'Extra_Cost'; }],
  ['changed exact product name', f => { f.product.Name = 'Another fuel'; }],
  ['cancelled selected child', f => { f.child.Cancelled__c = true; }],
  ['deleted selected child', f => { f.child.IsDeleted = true; }],
  ['duplicate selected child', f => { f.scope.sourceFacts.get(f.ids.source).lines.push({ ...f.child, Id: 'a05000000000002' }); }],
  ['additional extra charge', f => { f.scope.sourceFacts.get(f.ids.source).extras.push({ Id: 'a04000000000002' }); }],
  ['source unrelated readiness hold', f => { f.source.readiness.blockers.push('Supplier has a dispute.'); }],
  ['source unrelated accounting hold', f => { f.source.blockers.push('Different accounting issue.'); }],
  ['conflicting raw ledger AccountID', f => { f.candidate.lineItems[0].AccountID = f.ids.mapping; }],
  ['wrong tax type', f => { f.candidate.lineItems[0].TaxType = 'INPUT'; }],
  ['target missing explicit tax amount', f => { delete f.candidate.lineItems[0].TaxAmount; }],
  ['target changed line economics', f => { f.candidate.lineItems[0].LineAmount += 0.01; }],
  ['target tracking metadata', f => { f.candidate.lineItems[0].Tracking.push({ Name: 'Region', Option: 'HK' }); }],
  ['target inventory metadata', f => { f.candidate.lineItems[0].ItemCode = 'OIL'; }],
  ['target partly paid', f => target(f, { AmountPaid: 1, AmountDue: 1707835.16 })],
  ['target paid status', f => target(f, { Status: 'PAID' })],
  ['target different currency', f => target(f, { CurrencyCode: 'SGD' })],
  ['target different exchange rate', f => target(f, { CurrencyRate: 2 })],
  ['ledger inactive account', f => { f.scope.accountTax.accounts[0].Status = 'ARCHIVED'; }],
  ['ledger nonzero tax', f => { f.scope.accountTax.taxRates[0].EffectiveRate = 1; }],
  ['native latest version changed', f => { f.fileEvidence.version.isLatest = false; }],
  ['native parent changed', f => { f.fileEvidence.parentId = 'a06000000000002'; }],
  ['source already owned', f => { f.stored.documentMappings.push({ salesforce_object: 'Supplier_Invoice__c', salesforce_id: f.ids.source }); }],
  ['target already owned', f => { f.stored.documentMappings.push({ xero_document_id: f.ids.target }); }],
]) test(`petroleum rejects ${name}`, () => { const f = issuedPetroleumFixture(); patch(f); blocked(f); });

for (const field of ['Payments', 'CreditNotes', 'Prepayments', 'Overpayments']) {
  for (const value of [null, {}, 'invalid', [{ Amount: 1 }]]) test(`explicit ${field} ${JSON.stringify(value)} cannot become no-settlement evidence`, () => {
    const f = issuedPetroleumFixture(); f.raw[field] = value; blocked(f, 'SETTLEMENT_UNSUPPORTED');
  });
  test(`omitted optional ${field} is retained as absent alongside complete zero balances`, () => {
    const f = issuedPetroleumFixture(); delete f.raw[field]; f.refreshScope(); const result = f.build(); assert.equal(result.eligible, true);
    assert.deepEqual(result.evidence.accounting.xero.settlementEvidence.collections[field], { present: false, rows: [] });
  });
}

for (const invoiceDate of ['2025-01-01', null]) test(`all-years source number claim blocks despite invoice date ${invoiceDate}`, () => {
  const f = issuedPetroleumFixture(); f.scope.sourceClaims.push({ ...structuredClone(f.supplier), Id: 'a06000000000002', Invoice_Date__c: invoiceDate, Invoice_Amount__c: 10 }); blocked(f, 'IDENTITY_AMBIGUOUS');
});

test('a valid historical negative amount is known unequal, but negative same-STEM or number remains a stronger claim', () => {
  const f = issuedPetroleumFixture(); const historical = { ...structuredClone(f.supplier), Id: 'a06000000000002', Name: 'OLD-CREDIT', STEM__c: 'a0H000000000002', Invoice_Date__c: null, Invoice_Amount__c: -10 };
  f.scope.sourceClaims.push(historical); f.refreshScope(); assert.equal(f.build().eligible, true);
  historical.Name = f.supplier.Name; blocked(f, 'IDENTITY_AMBIGUOUS'); historical.Name = 'OLD-CREDIT'; historical.STEM__c = f.ids.stem; blocked(f, 'IDENTITY_AMBIGUOUS');
});

for (const [key, value] of [['Invoice_Amount__c', null], ['CurrencyIsoCode', null]]) test(`unknown historical source ${key} cannot be filtered away`, () => {
  const f = issuedPetroleumFixture(); const other = { ...structuredClone(f.supplier), Id: 'a06000000000002', Name: 'OTHER', STEM__c: 'a0H000000000002', [key]: value };
  f.scope.sourceClaims.push(other); blocked(f, 'IDENTITY_SCOPE_INCOMPLETE');
});
for (const key of ['Delivery_Date__c', 'Vessel__c', 'Vessel__r']) test(`unknown competing source ${key} is not difference evidence`, () => {
  const f = issuedPetroleumFixture(); const other = { ...structuredClone(f.supplier), Id: 'a06000000000002', Name: 'OTHER', STEM__c: 'a0H000000000002' };
  other.STEM__r[key] = null; f.scope.sourceClaims.push(other); blocked(f, 'IDENTITY_SCOPE_INCOMPLETE');
});

test('ARCHIVED pre-cutoff target with same number blocks regardless amount', () => {
  const f = issuedPetroleumFixture(); const raw = { ...structuredClone(f.raw), InvoiceID: '00000000-0000-4000-8000-000000000099', Date: '2025-01-01', Status: 'ARCHIVED', Total: 10 };
  f.scope.targetClaims.push({ raw, document: normalizeXeroInvoice(raw) }); blocked(f, 'NUMBER_COLLISION');
});

test('missing-date historical target with same amount is uncertain, not excluded', () => {
  const f = issuedPetroleumFixture(); const raw = { ...structuredClone(f.raw), InvoiceID: '00000000-0000-4000-8000-000000000099', InvoiceNumber: '123P-OTHER', Date: null };
  f.scope.targetClaims.push({ raw, document: normalizeXeroInvoice(raw) }); blocked(f, 'IDENTITY_SCOPE_INCOMPLETE');
});

test('credit note matching invoice number or current allocation blocks even if net balances claim zero', () => {
  const f = issuedPetroleumFixture(); const raw = { CreditNoteID: '00000000-0000-4000-8000-000000000099', Type: 'ACCPAYCREDIT', Contact: { ContactID: f.ids.contact }, CreditNoteNumber: f.source.documentNumber, Allocations: [] };
  f.scope.creditClaims.push({ raw, document: normalizeXeroCreditNote(raw) }); blocked(f, 'CREDIT_CLAIM');
  raw.CreditNoteNumber = 'OTHER'; raw.Allocations = [{ Invoice: { InvoiceID: f.ids.target }, Amount: 1 }]; f.scope.creditClaims[0].document = normalizeXeroCreditNote(raw); blocked(f, 'CREDIT_CLAIM');
  raw.Allocations = {}; blocked(f, 'CREDIT_CLAIM');
});

test('coverage mutation and selected raw/normal snapshot races are rejected', () => {
  const f = issuedPetroleumFixture(); f.scope.sourceClaims.push({ ...f.supplier }); assert.equal(f.build().eligible, false);
  const g = issuedPetroleumFixture(); g.scope.targetClaims[0].document = { ...g.candidate, dueDate: '2026-04-01' }; blocked(g, 'SNAPSHOT_CHANGED');
});

// These are reviewed paper arithmetic values in an otherwise synthetic provider
// fixture, not assertions that missing current live source facts were verified.
for (const [quantity, price, amount] of [
  ['1993.217', '856.824', '1707836.16'], ['1999.831', '705.06', '1410000.84'],
  ['1999.533', '742.961', '1485575.04'], ['79.200', '721.00', '57103.20'], ['2497.967', '705.06', '1761216.61'],
  ['1192.59', '0.5', '596.30'],
]) test(`exact physical ${quantity} × ${price} = ${amount}; absent printed tax remains null`, () => {
  const f = issuedPetroleumFixture(); f.child.Quantity_Delivered_Per_BDN__c = Number(quantity); f.child.Unit_Buy_At__c = Number(price);
  f.child.Total_Cost__c = f.supplier.Invoice_Amount__c = Number(amount);
  Object.assign(f.raw.LineItems[0], { UnitAmount: Number(amount), LineAmount: Number(amount) });
  target(f, { Total: Number(amount), SubTotal: Number(amount), AmountDue: Number(amount) });
  Object.assign(f.source, buildFinancialClassifications(f.salesforce, f.xero, f.stored).sources[0]);
  Object.assign(f.fileEvidence.review.lines[0], { quantity, unitPrice: price, amount }); f.fileEvidence.review.total = amount;
  f.refreshScope(); const result = f.build(); assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  assert.equal(result.evidence.accounting.issuedFile.review.totalTax, null);
  f.child.Total_Cost__c = Number(amount) + 0.01; blocked(f);
});


test('known different historical currency is unequal; missing/malformed currency and stronger number remain held', () => {
  const f = issuedPetroleumFixture(); const other = { ...structuredClone(f.supplier), Id: 'a06000000000002', Name: 'OTHER', STEM__c: 'a0H000000000002', CurrencyIsoCode: 'EUR' };
  other.STEM__r.Delivery_Date__c = null; f.scope.sourceClaims.push(other); f.refreshScope(); assert.equal(f.build().eligible, true);
  other.CurrencyIsoCode = 'bad'; blocked(f, 'IDENTITY_SCOPE_INCOMPLETE'); other.CurrencyIsoCode = 'EUR'; other.Name = f.source.documentNumber; blocked(f, 'IDENTITY_AMBIGUOUS');
});

function impreciseHistoricalSource(amount = 33759.200000000004, make = issuedPetroleumFixture) {
  const f = make();
  f.supplier.STEM__r.Vessel__c = 'a0C000000000001';
  const historical = { ...structuredClone(f.supplier), Id: 'a06000000000002', Name: 'HISTORICAL-OTHER',
    STEM__c: 'a0H000000000002', Invoice_Amount__c: amount,
    STEM__r: { KeyStem__c: 'HK2526002T', Vessel__c: 'a0C000000000002', Vessel__r: { Name: 'OTHER VESSEL' }, Delivery_Date__c: '2025-06-22' } };
  f.scope.sourceClaims.push(historical);
  f.refreshScope();
  return { f, historical };
}

for (const amount of [33759.200000000004, 340614.60000000003, 129295.26000000001,
  318493.01999999996, 390670.14999999997, 189693.99000000002, 801023.1900000001]) {
  test(`distinct authoritative source identity excludes raw numeric tail ${amount} without coercion`, () => {
    const { f, historical } = impreciseHistoricalSource(amount);
    assert.equal(issuedSupplierCents(amount), null);
    const before = structuredClone({ scope: f.scope, source: f.source, candidate: f.candidate, file: f.fileEvidence });
    const result = f.build();
    assert.equal(result.eligible, true, JSON.stringify(result.blockers));
    assert.equal(historical.Invoice_Amount__c, amount);
    assert.equal(issuedSupplierCents(historical.Invoice_Amount__c), null);
    assert.equal(result.evidence.accounting.identityScope.coverageFingerprint, f.scope.coverage.contentFingerprint);
    assert.equal(f.scope.sourceClaims.length, 2);
    assert.deepEqual({ scope: f.scope, source: f.source, candidate: f.candidate, file: f.fileEvidence }, before);
  });
}

test('distinct source identity uses actual dates and checksum-valid long vessel IDs without a cutoff', () => {
  const { f, historical } = impreciseHistoricalSource();
  f.supplier.STEM__r.Vessel__c = 'a0C000000000001EAA';
  historical.STEM__r.Vessel__c = 'a0C000000000002EAA';
  historical.STEM__r.Delivery_Date__c = '2026-07-03';
  f.refreshScope();
  assert.equal(f.build().eligible, true);
});

for (const [name, amount] of [
  ['positive decimal string', '33759.200000000004'], ['below-cent decimal string', '318493.01999999996'],
  ['negative numeric tail', -33759.200000000004], ['negative below-cent numeric tail', -318493.01999999996],
  ['negative string', '-33759.200000000004'], ['null', null], ['undefined', undefined],
  ['boolean', true], ['object', {}], ['array', []], ['NaN', NaN], ['infinity', Infinity],
  ['13-digit bound', 1e12], ['large exponent', 1e20], ['small exponent', 1e-10], ['scientific string', '1e5'],
]) test(`distinct source tuples do not excuse ${name} amount`, () => {
  const { f, historical } = impreciseHistoricalSource(); historical.Invoice_Amount__c = amount;
  blocked(f, 'IDENTITY_SCOPE_INCOMPLETE');
});

for (const [name, change] of [
  ['missing amount', (_f, row) => { delete row.Invoice_Amount__c; }],
  ['missing historical vessel ID', (_f, row) => { delete row.STEM__r.Vessel__c; }],
  ['null historical vessel ID', (_f, row) => { row.STEM__r.Vessel__c = null; }],
  ['malformed historical vessel ID', (_f, row) => { row.STEM__r.Vessel__c = 'a0Cbad'; }],
  ['historical vessel checksum mismatch', (_f, row) => { row.STEM__r.Vessel__c = 'a0C000000000002ZZZ'; }],
  ['wrong historical vessel object type', (_f, row) => { row.STEM__r.Vessel__c = 'a0V000000000002'; }],
  ['same vessel short ID', (f, row) => { row.STEM__r.Vessel__c = f.supplier.STEM__r.Vessel__c; }],
  ['same vessel equivalent long ID', (_f, row) => { row.STEM__r.Vessel__c = 'a0C000000000001EAA'; }],
  ['same vessel equivalent short ID', (f, row) => { f.supplier.STEM__r.Vessel__c = 'a0C000000000001EAA'; row.STEM__r.Vessel__c = 'a0C000000000001'; }],
  ['missing historical vessel name', (_f, row) => { delete row.STEM__r.Vessel__r.Name; }],
  ['null historical vessel name', (_f, row) => { row.STEM__r.Vessel__r.Name = null; }],
  ['blank historical vessel name', (_f, row) => { row.STEM__r.Vessel__r.Name = '  '; }],
  ['oversize historical vessel name', (_f, row) => { row.STEM__r.Vessel__r.Name = 'A'.repeat(1001); }],
  ['control in historical vessel name', (_f, row) => { row.STEM__r.Vessel__r.Name = 'OTHER\nVESSEL'; }],
  ['C1 control in historical vessel name', (_f, row) => { row.STEM__r.Vessel__r.Name = 'OTHER\u0085VESSEL'; }],
  ['same whitespace-normalized vessel name', (_f, row) => { row.STEM__r.Vessel__r.Name = ' VESSEL  ONE '; }],
  ['missing historical delivery', (_f, row) => { delete row.STEM__r.Delivery_Date__c; }],
  ['null historical delivery', (_f, row) => { row.STEM__r.Delivery_Date__c = null; }],
  ['invalid calendar delivery', (_f, row) => { row.STEM__r.Delivery_Date__c = '2025-02-30'; }],
  ['same delivery', (f, row) => { row.STEM__r.Delivery_Date__c = f.supplier.STEM__r.Delivery_Date__c; }],
  ['missing historical source ID', (_f, row) => { delete row.Id; }],
  ['wrong historical source object', (_f, row) => { row.Id = '001000000000003'; }],
  ['missing historical STEM ID', (_f, row) => { delete row.STEM__c; }],
  ['null historical STEM ID', (_f, row) => { row.STEM__c = null; }],
  ['malformed historical STEM ID', (_f, row) => { row.STEM__c = 'a0Hbad'; }],
  ['wrong historical STEM object', (_f, row) => { row.STEM__c = 'a0C000000000002'; }],
  ['historical STEM checksum mismatch', (_f, row) => { row.STEM__c = 'a0H000000000002ZZZ'; }],
  ['same STEM ID', (f, row) => { row.STEM__c = f.ids.stem; }],
  ['same STEM equivalent long ID', (_f, row) => { row.STEM__c = 'a0H000000000001EAA'; }],
  ['different STEM ID with selected key', (f, row) => { row.STEM__r.KeyStem__c = f.source.stemKey; }],
  ['selected key with surrounding whitespace', (f, row) => { row.STEM__r.KeyStem__c = ` ${f.source.stemKey} `; }],
  ['same source number', (f, row) => { row.Name = f.source.documentNumber; }],
  ['same printed number', (f, row) => { row.Name = f.fileEvidence.review.printedNumber; }],
  ['same target number', (f, row) => { row.Name = f.candidate.invoiceNumber; }],
  ['missing currency', (_f, row) => { delete row.CurrencyIsoCode; }],
  ['null currency', (_f, row) => { row.CurrencyIsoCode = null; }],
  ['malformed currency', (_f, row) => { row.CurrencyIsoCode = 'usd'; }],
  ['missing selected vessel ID', f => { delete f.supplier.STEM__r.Vessel__c; }],
  ['wrong selected vessel type', f => { f.supplier.STEM__r.Vessel__c = 'a0V000000000001'; }],
  ['bad selected vessel checksum', f => { f.supplier.STEM__r.Vessel__c = 'a0C000000000001ZZZ'; }],
  ['missing selected vessel name', f => { delete f.supplier.STEM__r.Vessel__r.Name; }],
  ['control in selected vessel name', f => { f.supplier.STEM__r.Vessel__r.Name = 'VESSEL\nONE'; }],
  ['invalid selected real date', f => { f.supplier.STEM__r.Delivery_Date__c = f.source.deliveryDate = '2026-02-30'; }],
]) test(`imprecise source still holds ${name}`, () => {
  const { f, historical } = impreciseHistoricalSource(); change(f, historical);
  blocked(f, 'IDENTITY_SCOPE_INCOMPLETE');
});

test('an exact-cent competing source remains an identity collision', () => {
  const { f, historical } = impreciseHistoricalSource();
  historical.Invoice_Amount__c = f.supplier.Invoice_Amount__c;
  historical.STEM__r = { ...structuredClone(f.supplier.STEM__r), KeyStem__c: 'HK2526002T' };
  blocked(f, 'IDENTITY_AMBIGUOUS');
});

test('known-cent stronger source claims still scan complete history', () => {
  for (const field of ['number', 'stem']) {
    const { f, historical } = impreciseHistoricalSource(10);
    if (field === 'number') historical.Name = f.source.documentNumber;
    else historical.STEM__c = f.source.stemId;
    blocked(f, 'IDENTITY_AMBIGUOUS');
  }
});

test('numeric target tails remain held even with a different vessel and date', () => {
  const { f } = impreciseHistoricalSource();
  const raw = { ...structuredClone(f.raw), InvoiceID: '00000000-0000-4000-8000-000000000099',
    InvoiceNumber: '123P-OTHER VESSEL', Date: '2025-06-22', Total: 33759.200000000004 };
  f.scope.targetClaims.push({ raw, document: normalizeXeroInvoice(raw) });
  blocked(f, 'IDENTITY_SCOPE_INCOMPLETE');
});

test('selected source amount precision remains strict', () => {
  const { f } = impreciseHistoricalSource();
  f.supplier.Invoice_Amount__c = 33759.200000000004;
  blocked(f, 'SOURCE_FACTS_INVALID');
});

for (const stemId of [undefined, null, 'a0Hbad', 'a0H000000000001ZZZ', 'a0C000000000001']) {
  test(`selected STEM must remain canonical and correctly typed: ${String(stemId)}`, () => {
    const { f } = impreciseHistoricalSource();
    f.source.stemId = f.supplier.STEM__c = f.child.STEM__c = stemId;
    f.scope.coverage.stemIds = [stemId];
    blocked(f, 'IDENTITY_SCOPE_INCOMPLETE');
  });
}

test('real collector retains inactive-owner numeric-tail history, stronger claims and changed proof fingerprints', async () => {
  const { f, historical } = impreciseHistoricalSource(33759.200000000004, issuedPetroleumOwnerFixture);
  historical.Supplier__c = '001000000000002';
  const queries = []; const calls = []; const creditNotes = [];
  const read = (soql, all) => {
    queries.push({ soql, all });
    const records = soql.includes('FROM Organization') ? [{ Id: f.fileEvidence.orgId, IsSandbox: false }]
      : soql.includes('FROM Supplier_Invoice__c') ? [f.supplier, historical]
        : soql.includes('FROM STEM_Line_Item__c') ? [f.child]
          : soql.includes('FROM STEM_Extra_Cost__c') ? [] : [f.product];
    return { records: structuredClone(records), totalSize: records.length, done: true };
  };
  const options = {
    query: async soql => read(soql, false), queryAll: async soql => read(soql, true),
    accountingFetch: async (_connection, path, request) => {
      calls.push({ path, request });
      if (path.startsWith('/Invoices?')) return { Invoices: structuredClone([f.raw]) };
      if (path.startsWith('/CreditNotes?')) return { CreditNotes: structuredClone(creditNotes) };
      if (path === '/Accounts') return { Accounts: f.scope.accountTax.accounts };
      if (path === '/TaxRates') return { TaxRates: f.scope.accountTax.taxRates };
      throw Error(`Unexpected mocked path ${path}`);
    },
  };
  const run = async () => {
    const scope = await collectPetroleumPreservationScope({ records: f.packet.records, connection: { tenantId: f.ids.tenant },
      salesforce: f.salesforce, xero: f.xero, sources: [f.source], stored: f.stored }, options);
    const before = structuredClone(scope);
    const result = evaluatePetroleumFinancialDocument(f.source, f.candidate, { ...f.context, petroleum: scope }, f.fileEvidence);
    assert.deepEqual(scope, before);
    assert.equal(scope.coverage.sourceCount, 2); assert.equal(scope.sourceClaims.length, 2);
    assert.equal(scope.sourceClaims.find(row => row.Id === historical.Id).Invoice_Amount__c, historical.Invoice_Amount__c);
    assert.equal(scope.coverage.contentFingerprint, petroleumScopeFingerprint(scope));
    return { scope, result };
  };
  const first = await run(); assert.equal(first.result.eligible, true, JSON.stringify(first.result.blockers));
  assert.deepEqual(first.scope.coverage.sourceAccountIds, ['001000000000001', '001000000000002']);
  assert.equal(first.result.evidence.accounting.identityOwnership.owners.length, 2);
  const sourceQuery = queries.find(row => row.soql.includes('FROM Supplier_Invoice__c'));
  assert.equal(sourceQuery.all, true);
  assert.match(sourceQuery.soql, /Supplier__c IN \('001000000000001','001000000000002'\)/);
  assert.doesNotMatch(sourceQuery.soql, /WHERE .*Invoice_Date__c|WHERE .*CreatedDate/);
  historical.Invoice_Amount__c = 129295.26000000001;
  const changed = await run(); assert.equal(changed.result.eligible, true);
  assert.notEqual(first.scope.coverage.contentFingerprint, changed.scope.coverage.contentFingerprint);
  assert.notEqual(first.result.fingerprint, changed.result.fingerprint);
  assert.notEqual(first.result.evidenceFingerprint, changed.result.evidenceFingerprint);
  for (const [key, value] of [['Name', f.source.documentNumber], ['STEM__c', f.source.stemId]]) {
    const old = historical[key]; historical[key] = value;
    const held = await run(); assert.equal(held.result.eligible, false);
    assert.equal(held.result.blockers[0].code, 'IDENTITY_SCOPE_INCOMPLETE'); historical[key] = old;
  }
  const oldKey = historical.STEM__r.KeyStem__c; historical.STEM__r.KeyStem__c = f.source.stemKey;
  assert.equal((await run()).result.eligible, false); historical.STEM__r.KeyStem__c = oldKey;
  creditNotes.push({ CreditNoteID: '00000000-0000-4000-8000-000000000099', Type: 'ACCPAYCREDIT', Status: 'AUTHORISED',
    Contact: f.raw.Contact, CreditNoteNumber: 'OTHER-CREDIT', Date: '2025-01-01', CurrencyCode: 'USD', Total: 10,
    Allocations: [{ Invoice: { InvoiceID: f.ids.target }, Amount: 10 }] });
  const creditHeld = await run(); assert.equal(creditHeld.result.eligible, false);
  assert(creditHeld.result.blockers.some(row => row.path === 'identity.creditCollisionIds'));
  assert(calls.every(({ request }) => request.method === 'GET' && request.body === undefined && request.retryOnRateLimit === false));
});
