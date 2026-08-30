import assert from 'node:assert/strict';
import test from 'node:test';
import { removeLeadingShipAgentLine } from '../scripts/backfill-variable-charges.mjs';
import { readFile } from 'node:fs/promises';

test('the Is Agent backfill removes only an exact leading Ship Agent line', () => {
  assert.equal(removeLeadingShipAgentLine('Ship Agent\nAddress line'), 'Address line');
  assert.equal(removeLeadingShipAgentLine('sHiP aGeNt\r\n\r\nAddress line\r\nSecond'), 'Address line\r\nSecond');
  assert.equal(removeLeadingShipAgentLine('Ship Agent'), '');
  assert.equal(removeLeadingShipAgentLine('Ship Agent - Owner\nAddress'), 'Ship Agent - Owner\nAddress');
  assert.equal(removeLeadingShipAgentLine('Address\nShip Agent'), 'Address\nShip Agent');
});

test('the backfill filters the long-text marker locally instead of invalid SOQL', async () => {
  const source = await readFile(new URL('../scripts/backfill-variable-charges.mjs', import.meta.url), 'utf8');
  assert.match(source, /WHERE Inactive_Suspended__c = false/);
  assert.doesNotMatch(source, /Imported_Particulars__c LIKE/);
});
