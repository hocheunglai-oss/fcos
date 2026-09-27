import assert from 'node:assert/strict';
import test from 'node:test';
import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { normalizeXeroInvoice, normalizeXeroCreditNote, buildFinancialClassifications } from '../api/_xeroFinancialSync.js';
import { issuedSupplierHash } from '../api/_xeroIssuedSupplierPreservation.js';

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
