import test from 'node:test';
import assert from 'node:assert/strict';
import { issuedSupplierFixture, issuedSupplierRoundedWorkflowFixture } from './xeroIssuedSupplierPreservationFixtures.js';
import { issuedSupplierCents, issuedSupplierSourceRounding } from '../api/_xeroIssuedSupplierPreservation.js';
import { buildFinancialClassifications } from '../api/_xeroFinancialSync.js';
import { buildGroupedPreservationContext } from '../api/_xeroGroupedPreservationAdapter.js';
import { evaluateIssuedSupplierFinancialDocument } from '../api/_xeroIssuedSupplierPreservationAdapter.js';

function amounts(quantity, unit, raw, total) {
  const f = issuedSupplierFixture();
  Object.assign(f.source, { total, signedTotal: total });
  f.source.groupedAccounting.total = total;
  Object.assign(f.source.groupedAccounting.lines[0], { quantity, unitAmount: unit, lineAmount: raw });
  Object.assign(f.candidate, { total, amountDue: total });
  Object.assign(f.candidate.groupedAccounting, { subtotal: total, total, amountDue: total });
  Object.assign(f.candidate.lineItems[0], { UnitAmount: total, LineAmount: total });
  f.fileEvidence.review.total = total;
  f.fileEvidence.review.lines = [{ description: 'Trustee service', amount: total }];
  return f;
}

test('legacy cent-only proof bytes remain pinned and global cents stays strict', () => {
  const result = issuedSupplierFixture().build();
  assert.equal(result.fingerprint, '958948883e7e1a69523f2287a16da6dbfc60fdb4160c1ac1f2eb1b057a5b2b49');
  assert.equal(result.evidenceFingerprint, '9a8b8019c5dd06b3420a3fdc77c3a7864cd79d82e488d314b808cc39cd8f6216');
  assert.equal(Object.hasOwn(result.evidence.accounting.source.lines[0], 'centRounding'), false);
  assert.equal(issuedSupplierCents('124.197'), null);
});

for (const [quantity, unit, raw, total, cents] of [
  ['248.394', '0.5', '124.197', '124.20', '12420'],
  ['372.244', '0.5', '186.122', '186.12', '18612'],
  ['204.75', '0.5', '102.375', '102.38', '10238'],
  ['24.666', '2', '49.332', '49.33', '4933'],
]) test(`preserve exact raw source product ${raw} with independently matching cents`, () => {
  const f = amounts(quantity, unit, raw, total); const before = structuredClone(f.source);
  const result = f.build(); assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.evidence.accounting.source.lines[0].centRounding,
    { policy: 'trustee_source_decimal_half_up_v1', rawLineAmount: raw, roundedLineAmountCents: cents });
  assert.deepEqual(f.source, before); assert.equal(result.proposedPayload, undefined);
  assert.equal(result.evidence.accounting.source.lines[0].quantity, quantity);
});

test('real source builder retains raw124.197 through the adapter while paper aggregates two fees', () => {
  const f = issuedSupplierRoundedWorkflowFixture();
  const built = buildFinancialClassifications(f.salesforce, f.xero, f.stored);
  const source = built.sources[0]; source.issuedSupplierVessel = 'SEA STELLAR';
  assert.equal(source.groupedAccounting.lines[0].lineAmount, 124.197);
  const result = evaluateIssuedSupplierFinancialDocument(source, f.candidate,
    buildGroupedPreservationContext(f.salesforce, f.xero, f.stored, built.sources), f.fileEvidence);
  assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  assert.equal(result.evidence.accounting.issuedFile.review.lines.length, 2);
  assert.equal(result.evidence.accounting.source.lines[0].centRounding.rawLineAmount, '124.197');
});

test('rounding never hides a real cent difference, a same-cent raw mismatch or non-source subcents', async (t) => {
  for (const [name, change] of [
    ['same-cent raw product mismatch', (f) => { f.source.groupedAccounting.lines[0].lineAmount = '124.196'; }],
    ['raw one-cent mismatch', (f) => { f.source.groupedAccounting.lines[0].lineAmount = '124.207'; }],
    ['Xero subcent', (f) => { f.candidate.lineItems[0].LineAmount = '124.197'; }],
    ['header subcent', (f) => { f.source.groupedAccounting.total = '124.197'; }],
    ['paper subcent', (f) => { f.fileEvidence.review.lines[0].amount = '124.197'; }],
    ['paper one cent', (f) => { f.fileEvidence.review.lines[0].amount = '124.19'; }],
    ['paid amount subcent', (f) => { f.candidate.amountPaid = '0.001'; f.candidate.groupedAccounting.amountPaid = '0.001'; }],
    ['client supplied marker', (f) => { f.source.groupedAccounting.lines[0].centRounding = null; }],
  ]) await t.test(name, () => {
    const f = amounts('248.394', '0.5', '124.197', '124.20'); change(f); assert.equal(f.build().eligible, false);
  });
  assert.equal(amounts('1318.333', '0.5', '659.1665', '659.16').build().eligible, false);
  assert.equal(amounts('204.75', '0.5', '102.375', '102.37').build().eligible, false);
});

test('raw rounding rejects malformed, signed, unbounded and zero inputs', () => {
  for (const value of [null, undefined, false, {}, [], '', ' 124.197', '1e2', NaN, Infinity, '-124.197', '0', '124.197000001', '1000000000000.001']) {
    assert.equal(issuedSupplierSourceRounding({ quantity: '248.394', unitAmount: '.5', lineAmount: value }), null);
    assert.equal(issuedSupplierSourceRounding({ quantity: '248.394', unitAmount: '0.5', lineAmount: value }), null);
  }
  assert.equal(issuedSupplierSourceRounding({ quantity: '0', unitAmount: '0.5', lineAmount: '0.001' }), null);
});
