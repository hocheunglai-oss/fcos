import test from 'node:test';
import assert from 'node:assert/strict';
import { issuedGroupedPetroleumFixture } from './xeroIssuedGroupedPetroleumPreservationFixtures.js';
import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { evaluateIssuedGroupedPetroleumPreservation, validateIssuedGroupedPetroleumEvidence } from '../api/_xeroIssuedGroupedPetroleumPreservation.js';
import { evaluateGroupedPetroleumFinancialDocument } from '../api/_xeroIssuedGroupedPetroleumPreservationAdapter.js';
import { issuedSupplierHash as hash, issuedSupplierCanonical as canonical } from '../api/_xeroIssuedSupplierPreservation.js';
import { buyerInvoiceApprovalProjection } from '../api/_buyerInvoiceApproval.js';
import { normalizeXeroCreditNote, normalizeXeroInvoice } from '../api/_xeroFinancialSync.js';
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function sf18(short) { let tail = ''; for (let i = 0; i < 15; i += 5) { let n = 0; for (let j = 0; j < 5; j++) if (/[A-Z]/.test(short[i + j])) n |= 1 << j; tail += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[n]; } return short + tail; }
const held = f => { const r = f.build(); assert.equal(r.eligible, false, JSON.stringify(r)); assert.equal(r.evidence, null); assert.equal(r.fingerprint, null); assert.ok(r.blockers.length); assert.equal(Object.hasOwn(r, 'proposedPayload'), false); return r; };

for (const direction of ['buyer', 'supplier']) {
  for (const [lineCount, repeatedProduct] of [[2, false], [3, false], [5, true], [50, true], [50, false]]) test(`${direction}: real builder ${lineCount} physical lines repeated=${repeatedProduct} preserves exact target`, () => {
    const f = issuedGroupedPetroleumFixture({ direction, lineCount, repeatedProduct }); const before = hash({ source: f.source, raw: f.raw, facts: f.facts }); const r = f.build();
    assert.equal(r.eligible, true, JSON.stringify(r.blockers)); assert.equal(validateIssuedGroupedPetroleumEvidence(r.evidence), true); assert.equal(before, hash({ source: f.source, raw: f.raw, facts: f.facts }));
    assert.equal(r.policyVersion, 'issued_grouped_petroleum_preserve_v1'); assert.equal(r.evidence.accounting.direction, direction); assert.equal(r.evidence.accounting.source.lines.length, lineCount);
    assert.equal(r.evidence.accounting.productMappings.length, repeatedProduct ? 1 : lineCount); assert.deepEqual(r.evidence.accounting.xero.rawLineItems, f.raw.LineItems);
    assert.equal(r.evidence.accounting.sourceEvidenceFingerprint, hash(f.facts)); assert.equal(Object.hasOwn(r, 'proposedPayload'), false); assert.equal(r.accepted, false);
  });
  const mutations = {
    'wrong invoice binding': f => { f.lines[0][direction === 'buyer' ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c'] = direction === 'buyer' ? 'a0K000000000099' : 'a06000000000099'; },
    'wrong STEM': f => { f.lines[0].STEM__c = 'a0H000000000099'; },
    'deleted bound child': f => { f.lines[0].IsDeleted = true; },
    'cancelled bound child': f => { f.lines[0].Cancelled__c = true; },
    'unknown cancellation': f => { delete f.lines[0].Cancelled__c; },
    'wrong product type': f => { f.products[0].RecordType.DeveloperName = 'Non_Petroleum_Product'; },
    'deleted product': f => { f.products[0].IsDeleted = true; },
    'missing product state': f => { delete f.products[0].IsActive; },
    'unmatched product': f => { f.products[0].Id = '01t000000000099'; },
    'unknown currency': f => { delete f.parent.CurrencyIsoCode; },
    'wrong child currency': f => { f.lines[0].CurrencyIsoCode = 'SGD'; },
    'missing actual BDN quantity': f => { delete f.lines[0].Quantity_Delivered_Per_BDN__c; },
    'wrong BDN date': f => { f.lines[0].BDN_Delivery_Date__c = '2026-02-30'; },
    'missing BDN date': f => { delete f.lines[0].BDN_Delivery_Date__c; },
    'non MT': f => { f.lines[0].Unit_of_Measure__c = 'MTS'; },
    'same cent but wrong raw unit price': f => { f.lines[0][direction === 'buyer' ? 'Unit_Sell_At__c' : 'Unit_Buy_At__c'] = 10.00001; },
    'one cent raw line mismatch': f => { f.lines[0][direction === 'buyer' ? 'Total_Price__c' : 'Total_Cost__c'] += 0.01; },
    'subcent raw line amount': f => { f.lines[0][direction === 'buyer' ? 'Total_Price__c' : 'Total_Cost__c'] += 0.001; },
    'header mismatch': f => { f.parent[direction === 'buyer' ? 'Amount__c' : 'Invoice_Amount__c'] += 0.01; },
    'printed price mismatch': f => { f.fileEvidence.review.lines[0].unitPrice = '10.00001'; },
    'printed amount mismatch': f => { f.fileEvidence.review.lines[0].amount = '100.01'; },
    'same product wrong paper child': f => { f.fileEvidence.review.lines[0].sourceChildId = f.lines[1].Id; },
    'unbound paper product': f => { f.fileEvidence.review.lines[0].sourceProductId = '01t000000000099'; },
    'wrong literal buyer': f => { f.fileEvidence.review.buyerName = 'UNRELATED BUYER'; },
    'wrong literal seller': f => { f.fileEvidence.review.sellerName = 'UNRELATED SELLER'; },
    'wrong paper issue date': f => { f.fileEvidence.review.invoiceDate = '2026-04-02'; },
    'invented paper tax': f => { f.fileEvidence.review.totalTax = 0; },
    'unknown number bridge': f => { f.fileEvidence.review.numberRule = 'strip_anything'; },
    'wrong native parent': f => { f.fileEvidence.parentId = 'a06000000000099'; },
    'stale version': f => { f.fileEvidence.version.isLatest = false; },
    'checksum mismatch': f => { f.fileEvidence.version.checksum = 'f'.repeat(32); },
    'wrong printed IMO': f => { f.fileEvidence.review.imo = '1111111'; },
    'missing printed IMO observation': f => { delete f.fileEvidence.review.imo; },
    'disabled mapping': f => { f.stored.productMappings[0].enabled = false; },
    'unapproved mapping': f => { f.stored.productMappings[0].approved_by = null; },
    'wrong direction mapping': f => { f.stored.productMappings[0].direction = direction === 'buyer' ? 'supplier' : 'buyer'; },
    'wrong ledger type': f => { f.scope.accountTax.accounts[0].Type = 'BANK'; },
    'wrong tax applicability': f => { f.scope.accountTax.taxRates[0][direction === 'buyer' ? 'CanApplyToRevenue' : 'CanApplyToExpenses'] = false; },
    'source owned': f => { f.stored.documentMappings.push({ salesforce_object: f.source.salesforceObject, salesforce_id: f.ids.source, xero_document_id: uuid(99) }); },
    'target owned': f => { f.stored.documentMappings.push({ salesforce_object: f.source.salesforceObject, salesforce_id: 'a06000000000099', xero_document_id: f.ids.target }); },
    'incomplete current context': f => { f.context.complete = false; },
    'incomplete all years': f => { f.scope.coverage.sourceQueryAll = false; },
    'missing typed query scope': f => { delete f.scope.coverage.sourceObjects; },
    'invalid canonical ID checksum': f => { f.lines[0].Id += 'BAD'; },
    'unknown source evidence direction': f => { f.facts.direction = 'other'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) test(`${direction}: holds ${name}`, () => { const f = issuedGroupedPetroleumFixture({ direction }); mutate(f); f.refreshScope(); held(f); });
  for (const field of ['Payments', 'CreditNotes', 'Prepayments', 'Overpayments']) for (const value of [null, {}, [{}]]) test(`${direction}: ${field} ${JSON.stringify(value)} held`, () => {
    const f = issuedGroupedPetroleumFixture({ direction }); f.raw[field] = value; f.rebuild(); held(f);
  });
  for (const [field, value] of [['Status', 'PAID'], ['AmountPaid', 0.01], ['AmountCredited', 0.01], ['AmountDue', 299.99], ['CurrencyCode', 'SGD'], ['CurrencyRate', 1.01]]) test(`${direction}: target ${field} guarded`, () => {
    const f = issuedGroupedPetroleumFixture({ direction }); f.raw[field] = value; f.rebuild(); held(f);
  });
  test(`${direction}: raw and normalized settlement race held without rebuilding target`, () => { const f = issuedGroupedPetroleumFixture({ direction }); f.raw.AmountPaid = 1; f.refreshScope(); held(f); });
  for (const [field, value] of [['Tracking', [{ Name: 'Desk', Option: 'A' }]], ['ItemCode', 'FUEL'], ['DiscountRate', 1], ['DiscountAmount', 1], ['TaxAmount', 0.01], ['LineItemID', null]]) test(`${direction}: target line ${field} held`, () => {
    const f = issuedGroupedPetroleumFixture({ direction }); f.raw.LineItems[0][field] = value; f.rebuild(); held(f);
  });
  for (const childType of ['physical', 'extra']) for (const amount of [null, -1, 1]) test(`${direction}: live unbound ${childType} amount ${amount} held`, () => {
    const f = issuedGroupedPetroleumFixture({ direction }); const buyer = direction === 'buyer'; const row = { Id: childType === 'physical' ? 'a05000000000099' : 'a04000000000099', IsDeleted: false, Cancelled__c: false, STEM__c: f.ids.stem, Buyer_Invoice__c: null, Supplier_Invoice__c: null,
      [buyer ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c']: null, [childType === 'physical' ? (buyer ? 'Total_Price__c' : 'Total_Cost__c') : (buyer ? 'Line_Total__c' : 'Line_Total_Buy__c')]: amount };
    f.facts[childType === 'physical' ? 'stemLines' : 'stemExtras'] = [...f.facts[childType === 'physical' ? 'stemLines' : 'stemExtras'], row]; f.refreshScope(); held(f);
  });
  test(`${direction}: explicit zero unbound extras retained, not billed`, () => { const f = issuedGroupedPetroleumFixture({ direction }); f.facts.stemExtras.push({ Id: 'a04000000000099', IsDeleted: false, Cancelled__c: false, STEM__c: f.ids.stem, Buyer_Invoice__c: null, Supplier_Invoice__c: null,
    [direction === 'buyer' ? 'Buyer_Invoice__c' : 'Supplier_Invoice__c']: null, [direction === 'buyer' ? 'Line_Total__c' : 'Line_Total_Buy__c']: 0 }); f.refreshScope(); const r = f.build(); assert.equal(r.eligible, true, JSON.stringify(r.blockers)); assert.equal(r.evidence.accounting.sourceEvidence.stemExtras.length, 1); });
  for (const strong of ['number', 'stem', 'key']) test(`${direction}: historical negative null-date ${strong} claim never excluded`, () => {
    const f = issuedGroupedPetroleumFixture({ direction }); const other = copy(f.parent); other.Id = direction === 'buyer' ? 'a0K000000000099' : 'a06000000000099'; other.Name = strong === 'number' ? f.parent.Name : 'HISTORICAL-CREDIT';
    other.STEM__c = strong === 'stem' ? f.ids.stem : 'a0H000000000099'; other.STEM__r.KeyStem__c = strong === 'key' ? f.source.stemKey : 'HK2512345T'; other.STEM__r.Delivery_Date__c = null; other[direction === 'buyer' ? 'Amount__c' : 'Invoice_Amount__c'] = -1;
    f.scope.sourceClaims.push({ direction, salesforceObject: f.source.salesforceObject, raw: other }); f.refreshScope(); held(f);
  });
  test(`${direction}: allocated historical credit held`, () => { const f = issuedGroupedPetroleumFixture({ direction }); const raw = { CreditNoteID: uuid(80), Type: direction === 'buyer' ? 'ACCRECCREDIT' : 'ACCPAYCREDIT', Contact: { ContactID: f.ids.contact }, CreditNoteNumber: 'OLD-CN', CurrencyCode: 'USD', Total: 1, Allocations: [{ Invoice: { InvoiceID: f.ids.target } }] };
    f.scope.creditClaims.push({ raw, document: normalizeXeroCreditNote(raw) }); f.refreshScope(); held(f); });
  test(`${direction}: archived target exact number claim held`, () => { const f = issuedGroupedPetroleumFixture({ direction }); const raw = { ...copy(f.raw), InvoiceID: uuid(90), Status: 'ARCHIVED', Total: 1, Date: '2025-01-01' };
    f.scope.targetClaims.push({ raw, document: normalizeXeroInvoice(raw) }); f.refreshScope(); held(f); });
  test(`${direction}: canonical 18 IDs in paper and raw child evidence are accepted`, () => { const f = issuedGroupedPetroleumFixture({ direction });
    for (const row of f.lines) for (const key of ['Id', 'STEM__c', 'Product__c', 'Original_Supplier__c', 'Buyer_Invoice__c', 'Supplier_Invoice__c']) if (row[key]) row[key] = sf18(row[key]);
    for (const row of f.products) row.Id = sf18(row.Id);
    for (const line of f.fileEvidence.review.lines) { line.sourceChildId = sf18(line.sourceChildId); line.sourceProductId = sf18(line.sourceProductId); }
    f.refreshScope(); assert.equal(f.build().eligible, true, JSON.stringify(f.build().blockers)); });
  test(`${direction}: source raw drift invalidates immutable evidence even if its source hash is recomputed`, () => { const f = issuedGroupedPetroleumFixture({ direction }); const proof = copy(f.build().evidence);
    proof.accounting.sourceEvidence.lines[0].Quantity_Delivered_Per_BDN__c = 9; proof.accounting.sourceEvidenceFingerprint = hash(proof.accounting.sourceEvidence);
    assert.equal(validateIssuedGroupedPetroleumEvidence(proof), false); });
  test(`${direction}: array/key order stable semantic validation, preserved original row order`, () => { const r = issuedGroupedPetroleumFixture({ direction }).build(); const jsonb = JSON.parse(canonical(r.evidence)); assert.equal(validateIssuedGroupedPetroleumEvidence(jsonb), true); });
}

test('buyer generated STEM number cannot use supplier hyphen rule', () => { const f = issuedGroupedPetroleumFixture({ direction: 'buyer' }); f.fileEvidence.review.printedNumber = f.parent.Name; f.fileEvidence.review.numberRule = 'exact'; held(f); });
test('buyer source version naming is explicit', () => { const f = issuedGroupedPetroleumFixture({ direction: 'buyer' }); f.parent.Name = 'OTHER-INV-1'; f.rebuild(); f.fileEvidence.review.sourceNumber = f.parent.Name; held(f); });
for (const flag of ['Proforma__c', 'Deprecated__c']) test(`buyer ${flag} held`, () => { const f = issuedGroupedPetroleumFixture({ direction: 'buyer' }); f.parent[flag] = true; f.refreshScope(); held(f); });
for (const value of ['{}', 'not-json', false]) test(`buyer malformed snapshot ${String(value)} held`, () => { const f = issuedGroupedPetroleumFixture({ direction: 'buyer' }); f.parent.Buyer_Charge_Snapshot__c = value; f.refreshScope(); held(f); });
test('buyer wrong STEM Account cannot become a supplier association', () => { const f = issuedGroupedPetroleumFixture({ direction: 'buyer' }); f.parent.STEM__r.Account__c = '001000000000099'; f.refreshScope(); held(f); });
test('supplier wrong Original_Supplier held', () => { const f = issuedGroupedPetroleumFixture(); f.lines[0].Original_Supplier__c = '001000000000099'; f.refreshScope(); held(f); });
test('buyer Original_Supplier is not debtor identity', () => { const f = issuedGroupedPetroleumFixture({ direction: 'buyer' }); f.lines.forEach(row => { row.Original_Supplier__c = '001000000000099'; }); f.refreshScope(); assert.equal(f.build().eligible, true); });
for (const lineCount of [0, 1, 51]) test(`line count ${lineCount} outside policy`, () => held(issuedGroupedPetroleumFixture({ lineCount })));
for (const value of [null, [], {}, { source: null }, { direction: 'buyer', sourceEvidence: { lines: [null] } }]) test(`pure malformed input ${JSON.stringify(value)} holds without throw`, () => { assert.equal(evaluateIssuedGroupedPetroleumPreservation(value).eligible, false); assert.equal(validateIssuedGroupedPetroleumEvidence(value), false); });
test('adapter malformed context holds without throw', () => { assert.equal(evaluateGroupedPetroleumFinancialDocument({}, {}, { complete: true }, null).eligible, false); });
test('stripped or unknown proof policy cannot replay', () => { const proof = copy(issuedGroupedPetroleumFixture().build().evidence); delete proof.accounting.sourceEvidence; assert.equal(validateIssuedGroupedPetroleumEvidence(proof), false); proof.policyVersion = 'issued_petroleum_preserve_v1'; assert.equal(validateIssuedGroupedPetroleumEvidence(proof), false); });
test('old single-line policy is still eligible with its unchanged proof discriminator', () => { const f = issuedPetroleumFixture(); const old = f.build(); assert.equal(old.eligible, true); assert.equal(old.policyVersion, 'issued_petroleum_preserve_v1'); assert.equal(validateIssuedGroupedPetroleumEvidence(old.evidence), false); });

for (const direction of ['buyer', 'supplier']) {
  test(`${direction}: 50 long literal grades fail byte bound without truncation`, () => { const f = issuedGroupedPetroleumFixture({ direction, lineCount: 50 });
    f.fileEvidence.review.lines.forEach(row => { row.productEvidence = 'Literal reviewed technical detail '.repeat(80); }); held(f); });
  test(`${direction}: 50-line proof fits both existing canonical bounds and full RPC envelope`, () => { const r = issuedGroupedPetroleumFixture({ direction, lineCount: 50 }).build(); assert.equal(r.eligible, true);
    const accountingCanonical = canonical({ policyVersion: r.policyVersion, accounting: r.evidence.accounting }); const evidenceCanonical = canonical(r.evidence);
    assert.ok(Buffer.byteLength(accountingCanonical) <= 100000); assert.ok(Buffer.byteLength(evidenceCanonical) <= 100000);
    assert.ok(Buffer.byteLength(JSON.stringify({ policyVersion: r.policyVersion, fingerprint: r.fingerprint, evidenceFingerprint: r.evidenceFingerprint, evidence: r.evidence, accountingCanonical, evidenceCanonical })) < 400000);
  });
  test(`${direction}: inactive same-name owner requires complete retained history and immutable ownership proof`, () => {
    const f = issuedGroupedPetroleumFixture({ direction }); const other = { id: '001000000000099', name: f.account.Name, companyCode: 'SINGAPORE EXAMPLE', recordType: 'Buyer', inactiveSuspended: true };
    f.salesforce.groupedAccountSnapshot.accounts.push(other); f.scope.coverage.sourceAccountIds.push(other.id); f.rebuild();
    const r = f.build(); assert.equal(r.eligible, true, JSON.stringify(r.blockers)); assert.equal(r.evidence.accounting.identityOwnership.owners.length, 2); assert.equal(validateIssuedGroupedPetroleumEvidence(r.evidence), true);
    f.scope.coverage.sourceAccountIds = [f.ids.account]; f.refreshScope(); held(f);
  });
  test(`${direction}: second active namesake never becomes an alias`, () => { const f = issuedGroupedPetroleumFixture({ direction });
    f.salesforce.groupedAccountSnapshot.accounts.push({ id: '001000000000099', name: f.account.Name, companyCode: 'SINGAPORE EXAMPLE', recordType: 'Buyer', inactiveSuspended: false });
    f.scope.coverage.sourceAccountIds.push('001000000000099'); f.rebuild(); held(f); });
  test(`${direction}: partial selection retains identical per-document proof`, () => { const f = issuedGroupedPetroleumFixture({ direction }); const other = copy(f.parent);
    other.Id = direction === 'buyer' ? 'a0K000000000099' : 'a06000000000099'; other.Name = 'OTHER'; other.STEM__c = 'a0H000000000099'; other.STEM__r.KeyStem__c = 'HK2612399T'; other.STEM__r.Delivery_Date__c = '2025-01-01';
    other[direction === 'buyer' ? 'Amount__c' : 'Invoice_Amount__c'] = 777; f.scope.sourceClaims.push({ direction, salesforceObject: f.source.salesforceObject, raw: other });
    f.scope.sourceFacts.set(other.Id, { ...f.facts, parent: other }); f.scope.coverage.stemIds.push(other.STEM__c); f.refreshScope(); const preview = f.build(); assert.equal(preview.eligible, true, JSON.stringify(preview.blockers));
    f.scope.sourceFacts.delete(other.Id); f.scope.coverage.stemIds = [f.ids.stem]; f.refreshScope(); const run = f.build(); assert.equal(run.eligible, true); assert.equal(run.fingerprint, preview.fingerprint); assert.equal(run.evidenceFingerprint, preview.evidenceFingerprint);
  });
  test(`${direction}: stale selected child in compact STEM inventory holds`, () => { const f = issuedGroupedPetroleumFixture({ direction }); f.facts.stemLines[0][direction === 'buyer' ? 'Total_Price__c' : 'Total_Cost__c'] = 100.001; f.refreshScope(); held(f); });
  test(`${direction}: changed raw Xero line cannot be hidden under rehashed proof`, () => { const proof = copy(issuedGroupedPetroleumFixture({ direction }).build().evidence); proof.accounting.xero.rawLineItems[0].Quantity = 2; assert.equal(validateIssuedGroupedPetroleumEvidence(proof), false); });
  test(`${direction}: malformed physical/STEM/product arrays never throw`, () => { for (const key of ['lines', 'stemLines', 'products', 'extras', 'stemExtras']) { const f = issuedGroupedPetroleumFixture({ direction }); f.facts[key] = [null]; f.refreshScope(); held(f); } });
}

test('buyer existing valid approval snapshot is independently revalidated', () => {
  const f = issuedGroupedPetroleumFixture({ direction: 'buyer' });
  const snapshot = buyerInvoiceApprovalProjection({ ...f.parent, _buyerInvoiceDocument: { Id: f.ids.document, LatestPublishedVersionId: f.ids.version } },
    { stem: { ...f.parent.STEM__r, Id: f.parent.STEM__c }, allLineItems: f.lines, allExtraCosts: f.facts.stemExtras });
  assert.ok(snapshot); f.parent.Buyer_Charge_Snapshot__c = canonical(snapshot); f.refreshScope(); const r = f.build();
  assert.equal(r.eligible, true, JSON.stringify(r.blockers)); assert.equal(r.evidence.accounting.issuanceBasis.buyerSnapshotHash, hash(snapshot));
  assert.equal(validateIssuedGroupedPetroleumEvidence(r.evidence), true);
  f.parent.Buyer_Charge_Snapshot__c = canonical({ ...snapshot, pdf: { ...snapshot.pdf, LatestPublishedVersionId: '068000000000099' } }); f.refreshScope(); held(f);
});
