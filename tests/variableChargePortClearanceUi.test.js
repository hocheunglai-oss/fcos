import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('paired Variable Charges gives Port Clearance each commercial leg label', async () => {
  const source = await readFile(new URL('../src/components/payments/VariableCharges.jsx', import.meta.url), 'utf8');
  assert.match(source, /isPortClearanceItem\(row\.item\) \? 'Port Clearance Fee'/);
  assert.match(source, /isPortClearanceItem\(row\.item\) \? 'Port Clearance Extension'/);
  assert.match(source, /calculatePortClearance\(\{ applicationCount, usdHkdRate \}\)/);
  assert.match(source, /pricingType: 'fixed'/);
  assert.match(source, /supplierCost: draft\?\.inputCurrency === 'USD' \? calculation\.supplierTotalUsd : calculation\.supplierHkd/);
  assert.match(source, /buyerPrice: calculation\.buyerTotalUsd/);
  assert.match(source, /buyerChargeDecision: calculation\.additionalApplications > 0 \? 'include' : 'exclude'/);
  assert.equal(
    source.match(/quantity: isPortClearanceItem\(item\) \|\| draft\.pricingType === 'per_unit' \? Number\(draft\.quantity\) : null/g)?.length,
    2,
    'both supplier-only and combined GM approval payloads retain the fixed-row application count',
  );
  assert.match(source, /This default updates immediately when the Supplier Leg application count changes/);
});
