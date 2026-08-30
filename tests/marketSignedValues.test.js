import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatMarketSignedNumber,
  marketSignedTextParts,
  marketSignedTone,
} from '../src/hedge/lib/marketSignedValues.js';

test('market signed values use arithmetic tone and explicit signs', () => {
  assert.equal(marketSignedTone(3.25), 'up');
  assert.equal(marketSignedTone(-0.4), 'down');
  assert.equal(marketSignedTone(0), 'neutral');
  assert.equal(marketSignedTone(null), 'neutral');
  assert.equal(formatMarketSignedNumber(3.25), '+3.25');
  assert.equal(formatMarketSignedNumber(-0.4), '−0.40');
  assert.equal(formatMarketSignedNumber(0), '0.00');
  assert.equal(formatMarketSignedNumber(null), null);
});

test('signed prose parser highlights only explicit signed numeric tokens', () => {
  const value = 'S0.5% M1−M2 moved +3.25 USD/MT while EFS moved -0.40 on 2026-08-21.';
  assert.deepEqual(
    marketSignedTextParts(value).filter((part) => part.type === 'signed').map((part) => [part.value, part.tone]),
    [['+3.25', 'up'], ['-0.40', 'down']],
  );
});

test('signed prose parser does not mistake dates, codes, contracts, or hyphenated prose for values', () => {
  for (const value of ['2026-08-21', 'FOFS-001', 'Aug-26', 'BM-M1', 'front-month', 'PPXDK00']) {
    assert.equal(marketSignedTextParts(value).some((part) => part.type === 'signed'), false, value);
  }
});
