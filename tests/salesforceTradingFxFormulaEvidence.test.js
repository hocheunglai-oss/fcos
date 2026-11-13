import test from 'node:test';
import assert from 'node:assert/strict';
import {
  supportsTradingFxFormulaWitness,
  verifyTradingFxFormulaWitnesses,
} from '../scripts/lib/salesforce-trading-fx-formula-evidence.mjs';

const bidTotal = 'Supplier_Bid__c.Total_Supplier_Price__c';
const bidDigest = '85e5eb158ecff6e90441756852927bee9ba9762fb45240ce83f77a657a56bf34';
const legacyBid = { Quantity__c: 2, Supplier_Unit_Price__c: -5, Total_Supplier_Price__c: -10 };

test('native formula witnesses apply only to a named formula with its exact reviewed digest', () => {
  assert.equal(supportsTradingFxFormulaWitness(bidTotal, bidDigest), true);
  assert.equal(supportsTradingFxFormulaWitness(bidTotal, '0'.repeat(64)), false);
  assert.equal(supportsTradingFxFormulaWitness('Another__c.Total_Supplier_Price__c', bidDigest), false);
});

test('one bounded native query distinguishes missing precise price from a substituted zero', () => {
  let calls = 0;
  const proof = verifyTradingFxFormulaWitnesses([bidTotal], query => {
    calls++;
    assert.match(query, /FROM Supplier_Bid__c WHERE .*Buy_USD_Unit_Price_Precise__c = null.* LIMIT 100$/u);
    return { records: [legacyBid] };
  });
  assert.equal(calls, 1);
  assert.deepEqual(proof.formulaWitnesses, { [bidTotal]: 1 });
  assert.match(proof.formulaWitnessEvidenceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(proof).includes('Supplier_Unit_Price__c'), false);
});

test('zero substitution, inconsistent totals, missing evidence and unknown fields fail closed', () => {
  for (const wrong of [0, -9, undefined]) {
    assert.throws(() => verifyTradingFxFormulaWitnesses([bidTotal],
      () => ({ records: [legacyBid, { ...legacyBid, Total_Supplier_Price__c: wrong }] })),
    /differs from the reviewed blank mode/u);
  }
  assert.throws(() => verifyTradingFxFormulaWitnesses([bidTotal], () => ({ records: [] })),
    /no distinguishing native readback/u);
  assert.throws(() => verifyTradingFxFormulaWitnesses([bidTotal], () => ({})), /invalid evidence/u);
  assert.throws(() => verifyTradingFxFormulaWitnesses(['Unreviewed__c.Unknown__c'], () => assert.fail()),
    /witness scope is incomplete/u);
});
