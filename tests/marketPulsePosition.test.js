import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MARKET_PULSE_POSITION,
  normalizedUtilityPosition,
  utilityNormalizedFromPixels,
  utilityPixelsFromNormalized,
} from '../src/lib/marketPulsePosition.js';

const bounds = { left: 12, top: 8, maxLeft: 912, maxTop: 608 };

test('Market Pulse defaults to the top-right and clamps stored positions', () => {
  assert.deepEqual(DEFAULT_MARKET_PULSE_POSITION, { x: 1, y: 0 });
  assert.deepEqual(normalizedUtilityPosition({ x: 4, y: -3 }), { x: 1, y: 0 });
  assert.deepEqual(normalizedUtilityPosition({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 });
});

test('Market Pulse normalized positions survive viewport conversion', () => {
  const normalized = { x: 0.35, y: 0.8 };
  const pixels = utilityPixelsFromNormalized(normalized, bounds);
  assert.deepEqual(pixels, { left: 327, top: 488 });
  assert.deepEqual(utilityNormalizedFromPixels(pixels, bounds), normalized);
});

test('Market Pulse remains within zero-sized workspaces', () => {
  const collapsed = { left: 8, top: 8, maxLeft: 8, maxTop: 8 };
  assert.deepEqual(utilityPixelsFromNormalized({ x: 1, y: 1 }, collapsed), { left: 8, top: 8 });
  assert.deepEqual(utilityNormalizedFromPixels({ left: 50, top: 50 }, collapsed), { x: 0, y: 0 });
});
