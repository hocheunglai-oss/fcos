import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/dashboard/PnlTable.jsx', import.meta.url), 'utf8');

test('Dashboard Filtered STEMs hides raw and operational-only columns', () => {
  const hiddenBlock = source.slice(
    source.indexOf('const BASE_HIDDEN_COLS'),
    source.indexOf('// Columns that are right-aligned'),
  );
  for (const field of [
    "'_Extra_Cost_Names'",
    "'Port__c'",
    "'Port__r'",
    "'_Exception_Schedule'",
    "'_Has_Uncancelled_Line_Product_Item'",
  ]) {
    assert.ok(hiddenBlock.includes(field), `${field} should remain available but hidden from the table`);
  }
});

test('Dashboard Buyer and GROUP labels omit CL Keys while account labels remain deduplicated', () => {
  assert.equal(source.match(/showClKey=\{false\}/g)?.length, 2);
  assert.match(source, /hasDistinctClKey/);
  assert.match(source, /localeCompare/);
});
