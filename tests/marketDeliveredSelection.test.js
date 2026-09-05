import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { reconcileDeliveredPortSelection } from '../src/hedge/lib/marketDeliveredSelection.js';

test('fresh delivered responses preserve selected-port identity and do not restart history loading', () => {
  const selected = ['singapore', 'hong-kong'];
  let current = selected;
  for (let response = 0; response < 100; response += 1) {
    // Each API response contains newly allocated rows, even with unchanged data.
    current = reconcileDeliveredPortSelection(current, [['singapore', 'Singapore'], ['hong-kong', 'Hong Kong']]);
    assert.strictEqual(current, selected);
  }
});

test('changed availability removes an invalid selection once and then settles', () => {
  const selected = ['hong-kong', 'singapore'];
  const available = [['singapore', 'Singapore']];
  const next = reconcileDeliveredPortSelection(selected, available);
  assert.deepEqual(next, ['singapore']);
  assert.notStrictEqual(next, selected);
  assert.strictEqual(reconcileDeliveredPortSelection(next, [...available]), next);
  assert.deepEqual(selected, ['hong-kong', 'singapore']);
});

test('missing evidence preserves saved selections; unavailable ports get a stable valid fallback', () => {
  const selected = ['hong-kong'];
  assert.strictEqual(reconcileDeliveredPortSelection(selected, []), selected);
  assert.deepEqual(reconcileDeliveredPortSelection(selected, [['zhoushan', 'Zhoushan'], ['singapore', 'Singapore']]), ['singapore']);
  const fallback = reconcileDeliveredPortSelection(selected, [['zhoushan', 'Zhoushan']]);
  assert.deepEqual(fallback, ['zhoushan']);
  assert.strictEqual(reconcileDeliveredPortSelection(fallback, [['zhoushan', 'Zhoushan']]), fallback);
});

test('port-label changes do not restart requests and initial empty selection resolves safely', () => {
  const selected = ['singapore'];
  assert.strictEqual(reconcileDeliveredPortSelection(selected, [['singapore', 'Singapore delivered']]), selected);
  assert.deepEqual(reconcileDeliveredPortSelection([], [['singapore', 'Singapore']]), selected);
});

test('Delivered Prices uses stable selection reconciliation and empty evidence dependencies', () => {
  const source = readFileSync(new URL('../src/hedge/views/MarketIntelligenceWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /const delivered = intelligence\?\.delivered \|\| EMPTY_DELIVERED_ROWS/);
  assert.match(source, /setSelectedPorts\(\(current\) => reconcileDeliveredPortSelection\(current, datedPorts\)\)/);
  assert.doesNotMatch(source, /if \(retained\.length\) return retained/);
});
