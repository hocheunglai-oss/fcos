import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const componentUrl = new URL(
  '../force-app/main/default/lwc/fcbSupplierBidExtraCosts/fcbSupplierBidExtraCosts.js',
  import.meta.url,
);

test('Quote Product Extra unit costs preserve decimal input', async () => {
  const source = await readFile(componentUrl, 'utf8');
  const unitCostHandlers = Array.from(source.matchAll(/case 'unitCost':([\s\S]*?)break;/gu));

  assert.equal(unitCostHandlers.length, 2);
  for (const [, handler] of unitCostHandlers) {
    assert.match(handler, /parseFloat\(value\)/u);
    assert.doesNotMatch(handler, /parseInt\(value/u);
  }
});
