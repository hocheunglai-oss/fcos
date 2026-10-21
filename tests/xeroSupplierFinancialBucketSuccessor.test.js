import { originalFinancialBuilderSource } from './helpers/originalFinancialBuilderFixture.mjs';
// Held successor-v1 candidate; original test/loader remain unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ids, hash } from './xeroSupplierFinancialBucketPreservation.fixture.js';
import { successorFinancialFixture as financialFixture, loadSuccessorFixture, successorCaseRecord, successorMetrics, SUCCESSOR_CASES } from './xeroSupplierFinancialBucketSuccessor.fixture.js';
import { supplierDocumentSourceEvidence, supplierFinancialSourcePayload } from '../api/_xeroFinancialSync.js';
import { evaluateSettledSupplierPaymentProof } from '../api/_xeroSettledSupplierPaymentProof.js';
import { evaluateSupplierFinancialBucketPreservation as evaluate, supplierFinancialSignedCents as cents,
  supplierFinancialBucketReview, supplierFinancialBucketDiagnostics, supplierFinancialBucketApprovalMaterial } from '../api/_xeroSupplierFinancialBucketPreservation.js';
const held = (f, code) => { const p = evaluate(f.input); assert.equal(p.proofValid, false); assert.ok(p.blockers.some(b => b.code === code), JSON.stringify(p.blockers)); return p; };
const sourceArgs = f => ({ parent: f.source.parent, children: f.source.children, charges: f.source.charges, buyers: f.source.buyers,
  safetyContext: f.source.safetyContext, contacts: f.identity.contacts, productMappings: f.input.productMappings });

test('many signed source lines equal one original target bucket without PDF or execution authority', () => {
  const f = financialFixture(), before = structuredClone(f.input), p = evaluate(f.input);
  assert.equal(p.proofValid, true); assert.equal(p.financiallyEquivalent, true); assert.equal(p.evidence.accounting.sourceLines.length, 3);
  assert.deepEqual(p.evidence.accounting.sourceBuckets, p.evidence.accounting.targetBuckets);
  assert.equal(p.evidence.accounting.documentVerification, 'UNVERIFIED'); assert.equal(p.evidence.accounting.source.sourcePayload.readiness.ready, false);
  assert.equal(p.workflowEligible, false); assert.equal(p.approvalGranted, false); assert.equal(p.financialWrites, 0); assert.equal(p.proposedPayload, null);
  assert.deepEqual(f.input, before); assert.deepEqual(p.evidence.accounting.target, f.target); assert.deepEqual(p.evidence.accounting.source.sourcePayload, f.source.sourcePayload);
  assert.equal(p.localClaimScope.salesforceOrgId, f.source.orgId.slice(0, 15)); assert.equal(p.evidence.accounting.source.orgId.length, 18);
  assert.deepEqual(p.localClaimScope.sourcePaymentIds, ['a0S000000000001', 'a0S000000000002']);
  assert.equal(p.localClaimScope.sourceDependencyHash, hash({ payments: f.input.sourceDependencies.payments, families: [] }));
  assert.deepEqual(p.localClaimScope.xeroPaymentIds, []); assert.equal(p.limits.bankRemittanceProven, false);
});

test('PAID keeps the exact sealed original ledger proof and summary HasAccount=false', () => {
  const f = financialFixture({ paid: true }), p = evaluate(f.input), direct = evaluateSettledSupplierPaymentProof({ tenantId: ids.tenant, invoice: f.target,
    ...f.input.ledgerPaymentEvidence, organisation: f.input.organisation });
  assert.equal(p.proofValid, true); assert.deepEqual(p.evidence.accounting.settlement.ledgerPaymentProof, direct);
  assert.equal(direct.evidence.originals.accounts[0].Name, 'Prepaid to CPC Taiwan'); assert.deepEqual(p.localClaimScope.xeroPaymentIds, [f.target.Payments[0].PaymentID]);
  f.input.ledgerPaymentEvidence.payments[0].Amount = '30049.99'; held(f, 'EXISTING_XERO_LEDGER_PROOF_HELD');
});

test('exact decimal cents reject subcent rounding, null, exponent and negative zero', () => {
  assert.equal(cents('-1.23000000'), -123n); assert.equal(cents('1.23'), 123n); assert.equal(cents(0), 0n);
  for (const v of [undefined, null, true, '', ' 1', '+1', '01', '1e2', '0.001', '-0', '-0.00', -0, Infinity, 0.46000000000001]) assert.equal(cents(v), null);
  const f = financialFixture(); f.source.children[0].Total_Cost__c = '10000.004'; f.reseal(); held(f, 'SOURCE_SIGNED_LINES_HEADER_MISMATCH');
});

test('negative original quantity-one lump sum remains a signed adjustment with explicit raw basis', () => {
  const f = financialFixture(); Object.assign(f.source.charges[0], { Lumpsum_Cost__c: '-50', Line_Total_Buy__c: '-50' });
  f.source.parent.Invoice_Amount__c = '29950'; Object.assign(f.target, { Total: '29950', SubTotal: '29950', AmountDue: '29950' });
  Object.assign(f.target.LineItems[0], { LineAmount: '29950', UnitAmount: '29950' }); f.reseal(); const p = evaluate(f.input);
  assert.equal(p.proofValid, true); const adjustment = p.evidence.accounting.sourceLines.find(l => l.id === ids.charge);
  assert.equal(adjustment.amountCents, '-5000'); assert.deepEqual(adjustment.calculationBasis, { contract: 'explicit_source_quantity_one_lump_sum_v1', quantity: 1,
    unitCostPlaceholder: 0, lumpSum: '-50', authoritativeTotal: '-50' }); assert.equal(p.financialWrites, 0);
  const providedNull = financialFixture(); providedNull.source.charges[0].Unit_Cost__c = null; providedNull.reseal(); const flatFee = evaluate(providedNull.input);
  assert.equal(flatFee.proofValid, true); assert.equal(flatFee.evidence.accounting.sourceLines.find(l => l.id === ids.charge).calculationBasis.unitCostPlaceholder, null);
  for (const k of ['Quantity__c', 'Unit_Cost__c', 'Lumpsum_Cost__c', 'Line_Total_Buy__c']) {
    const g = financialFixture(); delete g.source.charges[0][k]; g.reseal(); held(g, 'SOURCE_ARITHMETIC_NOT_ESTABLISHED');
  }
});

test('missing unit arithmetic and builder fallbacks cannot manufacture authoritative accounting', () => {
  for (const [field, value] of [['Total_Cost__c', null], ['Quantity_Delivered_Per_BDN__c', null], ['Unit_Buy_At__c', null], ['Unit_Buy_At__c', '99.99']]) {
    const f = financialFixture(); f.source.children[0][field] = value; f.reseal(); const p = evaluate(f.input); assert.equal(p.financiallyEquivalent, false); assert.equal(p.proofValid, false);
  }
  const f = financialFixture(); f.source.sourcePayload.lines[0].unitAmount += 1; held(f, 'ORIGINAL_SOURCE_PAYLOAD_OR_FINGERPRINT_CHANGED');
});

test('declared source USD unit half-up preserves raw positive and signed negative ties without rounding supplied amounts', () => {
  for (const sign of [1, -1]) {
    const f = financialFixture(); Object.assign(f.source.children[0], { Quantity_Delivered_Per_BDN__c: 1, Unit_Buy_At__c: sign === 1 ? '0.005' : '-0.005', Total_Cost__c: sign === 1 ? '0.01' : '-0.01' });
    const total = sign === 1 ? '20050.01' : '20049.99'; f.source.parent.Invoice_Amount__c = total;
    Object.assign(f.target, { Total: total, SubTotal: total, AmountDue: total }); Object.assign(f.target.LineItems[0], { UnitAmount: total, LineAmount: total }); f.reseal();
    const p = evaluate(f.input); assert.equal(p.proofValid, true, JSON.stringify(p.blockers)); const line = p.evidence.accounting.sourceLines.find(l => l.id === ids.fuel1);
    assert.deepEqual(line.calculationBasis.unroundedProduct, { integer: String(sign * 5), scale: 3 });
    assert.equal(line.calculationBasis.calculatedAmountCents, String(sign)); assert.equal(line.calculationBasis.contract, 'explicit_source_unit_usd_half_up_v1');
    f.source.children[0].Total_Cost__c = sign === 1 ? '0.015' : '-0.015'; f.reseal(); held(f, 'SOURCE_SIGNED_LINES_HEADER_MISMATCH');
  }
});

test('equal grand totals cannot conceal wrong signed accounts, tax, currency or target arithmetic', () => {
  for (const mutate of [f => { f.target.LineItems[0].AccountCode = '41100'; }, f => { f.target.LineItems[0].TaxType = 'OUTPUT'; },
    f => { f.target.LineItems[0].TaxAmount = null; }, f => { f.target.SubTotal = null; }, f => { f.target.TotalTax = null; },
    f => { f.target.CurrencyCode = 'EUR'; }, f => { f.target.CurrencyRate = '1.01'; }, f => { f.target.LineAmountTypes = 'Inclusive'; },
    f => { f.target.LineItems[0].Quantity = '0.99'; }, f => { f.target.LineItems[0].LineAmount = '30050.001'; },
    f => { f.target.LineItems[0].DiscountRate = '1'; }, f => { f.target.LineItems[0].ItemCode = 'INVENTORY'; }]) {
    const f = financialFixture(); mutate(f); f.reseal(); assert.equal(evaluate(f.input).financiallyEquivalent, false);
  }
  const f = financialFixture(); f.target.LineItems = [{ ...f.target.LineItems[0], UnitAmount: '30100', LineAmount: '30100' },
    { ...f.target.LineItems[0], LineItemID: '00000000-0000-4000-8000-000000000099', UnitAmount: '-50', LineAmount: '-50', AccountCode: '41100' }];
  f.reseal(); held(f, 'SIGNED_ACCOUNT_TAX_CURRENCY_BUCKET_MISMATCH');
});

test('original target Tracking is retained and disclosed with no inferred source reporting dimension', () => {
  const f = financialFixture(); const t = [{ Name: 'Job', Option: 'FCBV', Options: [], TrackingCategoryID: '22e6b474-7898-4c13-823e-814b005fbc5f' }];
  f.target.LineItems[0].Tracking = t; f.reseal(); const before = evaluate(f.input); assert.equal(before.proofValid, true);
  assert.deepEqual(before.evidence.accounting.retainedDifferences.targetTracking, [{ lineItemId: ids.line, originalTracking: t, sourceEquivalenceEstablished: false }]);
  f.target.LineItems[0].Tracking[0].Option = 'OTHER'; f.reseal(); const after = evaluate(f.input); assert.equal(after.proofValid, true); assert.notEqual(after.fingerprint, before.fingerprint);
  assert.equal(after.evidence.accounting.source.financialFingerprint, before.evidence.accounting.source.financialFingerprint);
});

test('exact selection and all-date ownership scopes independently hold wrong identity, unknown states and duplicates', () => {
  for (const [mutate, code] of [[f => { f.source.parent.IsDeleted = true; }, 'SOURCE_ACTIVE_STATE_UNPROVEN'],
    [f => { delete f.source.children[0].IsDeleted; }, 'SOURCE_ACTIVE_STATE_UNPROVEN'],
    [f => { f.source.children[0].Cancelled__c = true; }, 'SOURCE_ACTIVE_STATE_UNPROVEN'],
    [f => { f.source.children[0].Original_Supplier__c = '001000000000002'; }, 'SOURCE_LINE_OWNERSHIP_CONFLICT'],
    [f => { f.source.orgId = '00D000000000001'; }, 'PROVIDER_IDENTITY_UNPROVEN'],
    [f => { f.identity.contacts[0].status = 'ARCHIVED'; }, 'CONTACT_OWNER_UNION_UNPROVEN'],
    [f => { f.identity.coverage.sourceQueryAll = false; }, 'IDENTITY_SCOPE_INCOMPLETE'],
    [f => { f.source.children.push(structuredClone(f.source.children[0])); }, 'SOURCE_LINE_IDENTITY_INCOMPLETE_OR_DUPLICATE']]) {
    const f = financialFixture(); mutate(f); f.reseal(); held(f, code);
  }
  const f = financialFixture(); f.identity.selection.targetId = ids.ledger; held(f, 'SELECTED_DOCUMENT_IDENTITY_UNPROVEN');
  const g = financialFixture(); g.identity.sourceClaims.push({ ...structuredClone(g.source.parent), Id: 'a06000000000002' });
  g.identity.coverage.sourceCount = 2; g.identity.coverageFingerprint = hash(Object.fromEntries(Object.entries(g.identity).filter(([k]) => k !== 'coverageFingerprint')));
  held(g, 'SOURCE_DOCUMENT_IDENTITY_COLLISION');
});

test('Finance grants/settings and local owner, dispute, posting and credit claims remain blocking', () => {
  for (const [mutate, code] of [[f => { f.input.productMappings[0].enabled = false; }, 'APPROVED_PRODUCT_GRANT_UNPROVEN'],
    [f => { delete f.input.productMappings[0].approved_at; }, 'APPROVED_PRODUCT_GRANT_UNPROVEN'],
    [f => { f.input.productMappings[0].revision = 0; }, 'APPROVED_PRODUCT_GRANT_UNPROVEN'],
    [f => { f.input.accountTax.accounts[0].Status = 'ARCHIVED'; }, 'ACCOUNT_METADATA_UNPROVEN'],
    [f => { f.input.accountTax.taxes[0].EffectiveRate = null; }, 'TAX_METADATA_UNPROVEN'],
    ...['sourceMappings', 'targetMappings', 'referenceClaims', 'postingClaims', 'disputes'].map(k => [f => { f.identity[k].push({ Id: 'held' }); }, 'LOCAL_OWNERSHIP_OR_UNRESOLVED_CLAIM'])]) {
    const f = financialFixture(); mutate(f); f.reseal(); held(f, code);
  }
  const f = financialFixture(); f.identity.creditClaims.push({ CreditNoteID: ids.ledger, Type: 'ACCPAYCREDIT', Status: 'AUTHORISED', CurrencyCode: 'USD', Total: '1',
    CreditNoteNumber: 'CN-X', Reference: '', Contact: { ContactID: ids.contact }, Allocations: [{ Invoice: { InvoiceID: ids.target } }] });
  f.reseal(); held(f, 'CREDIT_DOCUMENT_CLAIM');
});

test('inactive superseded histories and distinct bills sharing a STEM stay in coverage without becoming active duplicates', () => {
  const f = financialFixture();
  f.identity.sourceClaims.push({ ...structuredClone(f.source.parent), Id: 'a06000000000002', IsDeleted: true },
    { ...structuredClone(f.source.parent), Id: 'a06000000000003', Name: 'SYN-DISTINCT' });
  f.identity.targetClaims.push({ ...structuredClone(f.target), InvoiceID: '00000000-0000-4000-8000-000000000080', Status: 'VOIDED' },
    { ...structuredClone(f.target), InvoiceID: '00000000-0000-4000-8000-000000000081', InvoiceNumber: 'DISTINCT-BILL', Reference: f.source.parent.STEM__r.KeyStem__c });
  f.identity.coverage.sourceCount = 3; f.identity.coverage.targetCount = 3;
  f.identity.coverageFingerprint = hash(Object.fromEntries(Object.entries(f.identity).filter(([k]) => k !== 'coverageFingerprint')));
  const p = evaluate(f.input); assert.equal(p.proofValid, true, JSON.stringify(p.blockers)); assert.equal(p.evidence.accounting.identity.targetClaims.length, 3);
  f.identity.targetClaims[1].Status = 'AUTHORISED'; f.identity.coverageFingerprint = hash(Object.fromEntries(Object.entries(f.identity).filter(([k]) => k !== 'coverageFingerprint')));
  held(f, 'TARGET_DOCUMENT_IDENTITY_COLLISION');
});

test('unsupported refund/credit/prepayment/partial/error/deleted settlement never passes', () => {
  for (const mutate of [f => { f.target.AmountPaid = '1'; }, f => { f.target.AmountCredited = '1'; }, f => { f.target.AmountDue = null; },
    f => { f.target.Prepayments = [{}]; }, f => { delete f.target.Overpayments; }, f => { f.target.Payments = [{}]; },
    f => { f.target.Refunds = []; }, f => { f.target.Status = 'DRAFT'; }, f => { f.target.IsDeleted = true; },
    f => { f.target.HasValidationErrors = true; }, f => { f.target.ValidationErrors = [{}]; }, f => { f.target.Date = '2026-02-30'; }]) {
    const f = financialFixture(); mutate(f); f.reseal(); assert.equal(evaluate(f.input).proofValid, false);
  }
});

test('dependencies preserve cash/noncash/deleted facts without requiring payment links or summing cash to target', () => {
  const f = financialFixture(), before = evaluate(f.input); assert.equal(before.proofValid, true);
  const d = f.input.sourceDependencies; d.payments[1].Amount__c = -123.000000000001; const after = evaluate(f.input);
  assert.equal(after.proofValid, true); assert.notEqual(after.localClaimScope.sourceDependencyHash, before.localClaimScope.sourceDependencyHash);
  assert.deepEqual(after.evidence.accounting.sourceDependencies.payments, d.payments); assert.deepEqual(after.evidence.accounting.sourceBuckets, before.evidence.accounting.sourceBuckets);
  d.coverage.complete = false; held(f, 'SOURCE_DEPENDENCY_SCOPE_INCOMPLETE');
});

test('strict whole input rejects hidden/symbol/accessor/undefined/sparse/cycle/non-JSON/oversized originals', () => {
  let accessed = 0;
  for (const mutate of [f => { f.input.unused = -0; }, f => { f.input.unused = undefined; }, f => { f.input.unused = new Date(); },
    f => { f.input[Symbol('hidden')] = true; }, f => { Object.defineProperty(f.input, 'hidden', { value: true }); },
    f => { Object.defineProperty(f.input, 'accessor', { enumerable: true, get() { accessed++; return true; } }); },
    f => { f.input.unused = f.input; }, f => { f.input.unused = Array(1); }, f => { f.input.unused = 'x'.repeat(1_000_001); }]) {
    const f = financialFixture(); mutate(f); held(f, 'EVIDENCE_JSON_INVALID_OR_BOUND');
  }
  assert.equal(accessed, 0); const p = evaluate(financialFixture().input); assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.evidence.accounting.source.parent));
  assert.throws(() => { p.evidence.accounting.target.LineItems[0].LineAmount = '0'; }, TypeError);
});

test('public diagnostics omit entire private originals/provider identity and reviews bind the full scope', () => {
  const p = evaluate(financialFixture({ paid: true }).input), safe = supplierFinancialBucketDiagnostics(p), json = JSON.stringify(safe);
  assert.equal(json.includes('APIKey'), false); assert.equal(json.includes('PRIVATE_SYNTHETIC'), false); assert.equal(Object.hasOwn(safe, 'evidence'), false);
  const r = supplierFinancialBucketReview(p, { reviewFingerprint: hash('specific scoped review'), legacyReviewFingerprint: hash('original legacy review') });
  assert.equal(Object.keys(r).length, 11); assert.equal(r.approvalMaterialHash, hash(supplierFinancialBucketApprovalMaterial(p.evidence, p.localClaimScope)));
  assert.equal(supplierFinancialBucketReview(p), null); assert.ok(Object.isFrozen(r.localClaimScope.sourcePaymentIds));
  const missing = financialFixture(); delete missing.source.parent.IsDeleted; missing.reseal(); assert.equal(supplierFinancialBucketReview(evaluate(missing.input),
    { reviewFingerprint: hash('x'), legacyReviewFingerprint: hash('y') }), null);
});

test('new fixed wrapper shares the original builder without changing its complete payload or old nine-field evidence', async () => {
  const path = new URL('../api/_xeroFinancialSync.js', import.meta.url), original = originalFinancialBuilderSource();
  const text = original.replace(/from '([^']+)'/g, (all, name) => name.startsWith('.') ? `from '${new URL(name, path).href}'` : all)
    + '\nexport function originalPayload({parent,children,charges,buyers,productMappings,contacts,safetyContext}) { const mappingByKey=new Map(productMappings.map(row=>[`${row.direction}:${row.salesforce_product_id}`,row])); return stripClassification(buildSalesforceDocument(parent,"supplier",[...children,...charges],mappingByKey,buildXeroContactIndex(contacts),{...safetyContext,postingMode:"draft",documentFieldSnapshot:{buyers,lines:children,extras:charges,cutoff:XERO_FINANCIAL_CUTOFF}})); }';
  const old = await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`), f = financialFixture(), args = sourceArgs(f);
  assert.deepEqual(supplierFinancialSourcePayload(args), old.originalPayload(args)); assert.deepEqual(supplierDocumentSourceEvidence(args), Object.fromEntries(['salesforceObject','salesforceId','accountId','contactId','stemId','sourceFingerprint','financialFingerprint','blockers','readiness'].map(key=>[key,old.originalPayload(args)[key]])));
});

// NEW successor integrity/coverage. These checks are proposed, not yet executed.
for(const name of SUCCESSOR_CASES)test('successor-v1 exact synthetic '+name,()=>{
 const f=loadSuccessorFixture(name),r=successorCaseRecord(name),p=f.proof;
 assert.equal(f.synthetic,true);assert.equal(f.nonExecutablePreparation,true);assert.equal(f.originalCaseEquivalence,false);assert.equal(f.currentBusinessCase,false);
 assert.deepEqual(evaluate(f.input),p);assert.equal(p.proofValid,true);assert.equal(p.financiallyEquivalent,true);
 assert.equal(p.proposedPayload,null);assert.equal(p.financialWrites,0);assert.equal(p.documentVerification,'UNVERIFIED');
 for(const k of ['workflowEligible','approvalGranted','accepted'])assert.equal(p[k],false);
 assert.deepEqual(p.evidence.accounting.sourceBuckets,p.evidence.accounting.targetBuckets);
 assert.deepEqual(p.evidence.accounting.target,f.input.target);assert.deepEqual(p.evidence.accounting.source.sourcePayload,f.input.source.sourcePayload);
 assert.equal(hash(f.review),r.reviewHash);assert.deepEqual(successorMetrics(p.evidence),r.metrics.evidence);
 if(name==='paid-positive'||name==='largest-current-guang-hua6-positive'){
  assert.equal(p.evidence.accounting.target.Status,'PAID');assert.equal(f.input.target.Payments[0].HasAccount,false);
  assert.equal(f.input.ledgerPaymentEvidence.payments[0].HasAccount,true);assert.equal(p.evidence.accounting.settlement.ledgerPaymentProof.proofValid,true);
 }
 if(name==='source-half-up'){
  const b=p.evidence.accounting.sourceLines[0].calculationBasis;
  assert.equal(b.contract,'explicit_source_unit_usd_half_up_v1');assert.deepEqual(b.unroundedProduct,{integer:'5',scale:3});assert.equal(b.calculatedAmountCents,'1');
 }
 if(name==='explicit-null-lump'){
  assert.equal(Object.hasOwn(f.input.source.charges[0],'Unit_Cost__c'),true);assert.equal(f.input.source.charges[0].Unit_Cost__c,null);
  assert.equal(p.evidence.accounting.sourceLines.find(x=>x.id===ids.charge).calculationBasis.unitCostPlaceholder,null);
 }
 if(name==='signed-discount')assert.equal(p.evidence.accounting.sourceLines.find(x=>x.id===ids.charge).amountCents,'-5000');
 if(name==='retained-tracking'){
  assert.deepEqual(p.evidence.accounting.retainedDifferences.targetTracking[0].originalTracking,f.input.target.LineItems[0].Tracking);
  assert.equal(p.limits.sourceTrackingEquivalenceEstablished,false);
 }
 if(name==='largest-current-guang-hua6-positive'){
  assert.match(f.input.source.parent.STEM__r.Vessel__r.Name,/SYNTHETIC/);
  assert.ok(r.metrics.evidence.canonicalBytes>=826970&&r.metrics.evidence.canonicalBytes<1000000);
  assert.ok(r.metrics.review.ordinaryBytes>=2660226&&r.metrics.review.canonicalBytes<4000000);
  for(const key of ['input','proof','evidence','targetOriginal','sourceOriginal','ledgerOriginal']){
   assert.ok(r.metrics[key].ordinaryBytes<=1000000);assert.ok(r.metrics[key].nodes<=100000);assert.ok(r.metrics[key].depth<=24);
  }
  assert.ok(r.metrics.compactReceiptProjection.canonicalBytes<4000000);
 }
});

test('successor-v1 loader rejects missing or altered bytes without original-loader or generator fallback',t=>{
 const directory=mkdtempSync(join(tmpdir(),'fcos-successor-loader-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const family=new URL('./fixtures/xero-supplier-financial-bucket-successor-v1-20261006/',import.meta.url);
 assert.throws(()=>loadSuccessorFixture('authorised-positive',{directory}));
 copyFileSync(new URL('successor-v1-manifest.json',family),join(directory,'successor-v1-manifest.json'));
 assert.throws(()=>loadSuccessorFixture('authorised-positive',{directory}));
 copyFileSync(new URL('successor-v1-authorised-positive.json',family),join(directory,'successor-v1-authorised-positive.json'));
 assert.equal(loadSuccessorFixture('authorised-positive',{directory}).synthetic,true);
 const original=readFileSync(join(directory,'successor-v1-authorised-positive.json'),'utf8');
 writeFileSync(join(directory,'successor-v1-authorised-positive.json'),original+' ');
 assert.throws(()=>loadSuccessorFixture('authorised-positive',{directory}),/raw bytes/);
 writeFileSync(join(directory,'successor-v1-authorised-positive.json'),original);
 writeFileSync(join(directory,'successor-v1-manifest.json'),'{}\n');
 assert.throws(()=>loadSuccessorFixture('authorised-positive',{directory}),/manifest pin/);
 assert.throws(()=>loadSuccessorFixture('synthetic-paid-financial-positive'),/Unknown successor/);
});
