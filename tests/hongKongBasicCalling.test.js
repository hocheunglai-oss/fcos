import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePortClearance,
  basicCallingSequence,
  isBasicCallingSupport,
} from '../src/lib/hongKongBasicCalling.js';

test('port clearance uses supplier-reported application count and passes through only extras', () => {
  assert.deepEqual(
    [1, 2, 3].map((applicationCount) => {
      const result = calculatePortClearance({ applicationCount, usdHkdRate: 7.84 });
      return [result.supplierHkd, result.buyerHkd];
    }),
    [[58, 0], [116, 58], [174, 116]],
  );
});

test('port clearance rejects missing, fractional, zero, and invalid FX values', () => {
  for (const applicationCount of [null, 0, -1, 1.5]) {
    assert.equal(calculatePortClearance({ applicationCount, usdHkdRate: 7.84 }).complete, false);
  }
  assert.equal(calculatePortClearance({ applicationCount: 1, usdHkdRate: 0 }).complete, false);
});

test('basic calling support sequence is stable and exact', () => {
  assert.equal(basicCallingSequence('Agency Fee'), 1);
  assert.equal(basicCallingSequence('PORT CLEARANCE EXTENSION'), 2);
  // Existing Salesforce rows remain compatible during the controlled Product rename.
  assert.equal(basicCallingSequence('PORT CLEARANCE FEE'), 2);
  assert.equal(basicCallingSequence('Light Dues'), 3);
  assert.equal(basicCallingSequence('Anchorage Dues'), 4);
  assert.equal(isBasicCallingSupport('light diesel oil'), false);
});
