import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_POLICIES, NOM_B_POLICY } from '../shared/businessPolicies.js';
import { nomBDelivery, NOM_B_FROM } from '../api/_dashboardNomBPolicy.js';
import { NOM_B_ACCEPT, validateNomBFile } from '../src/lib/missingNomB.js';
import { NOM_B_FROM_LABEL } from '../shared/missingNomB.js';

test('reviewed Nom B policy remains immutable and retains the September cutoff', () => {
  assert.equal(BUSINESS_POLICIES.nomB, NOM_B_POLICY);
  assert.equal(NOM_B_FROM, '2026-09-01');
  assert.equal(NOM_B_FROM_LABEL, '1 September 2026');
  for (const object of [BUSINESS_POLICIES, NOM_B_POLICY, NOM_B_POLICY.deliveryFields, NOM_B_POLICY.extensions]) {
    assert.equal(Object.isFrozen(object), true);
  }
  assert.throws(() => { NOM_B_POLICY.deliveryFields.reverse(); }, TypeError);
});

test('delivery scenarios preserve actual-first scope, including invalid actual dates', () => {
  for (const [actual, expected, inScope, invalid] of [
    ['2026-08-31', '2026-09-02', false, false],
    ['2026-09-01', '2026-08-31', true, false],
    [null, '2026-09-01', true, false],
    ['2026-02-30', '2026-09-02', false, true],
  ]) {
    const result = nomBDelivery({ Delivery_Date__c: actual, Expected_Delivery_Date__c: expected });
    assert.equal(result.inScope, inScope);
    assert.equal(result.invalid, invalid);
  }
});

test('browser selection and decoded validation agree on every allowed format', () => {
  assert.deepEqual(NOM_B_ACCEPT.split(','), ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']);
  for (const extension of NOM_B_POLICY.extensions) {
    assert.equal(validateNomBFile({ name: `nom-b.${extension.toUpperCase()}`, size: NOM_B_POLICY.maxDecodedBytes }), null);
    assert.match(validateNomBFile({ name: `nom-b.${extension}`, size: NOM_B_POLICY.maxDecodedBytes + 1 }), /3 MiB/);
  }
  assert.match(validateNomBFile({ name: 'nom-b.exe', size: 100 }), /PDF/);
});
