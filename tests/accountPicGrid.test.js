import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountPicGridCsvText,
  accountPicGridPayload,
  defaultAccountPicColumns,
  normalizeAccountPicColumn,
  normalizeAccountPicGridRow,
  parseAccountPicGridCsv,
  validateAccountPicGrid,
} from '../src/lib/accountPicGrid.js';
import {
  accountPicFlexibleDirectoryProjection,
  accountPicFlexiblePayloadHash,
  normalizeAccountPicGrid as normalizeServerGrid,
} from '../api/_accountPicDirectories.js';

test('default flexible layout matches the eight-column workbook structure', () => {
  const columns = defaultAccountPicColumns();
  assert.deepEqual(columns.map((column) => column.label), ['Port / Region', 'Responsible Personnel', 'Team', 'Under Supervision', 'Container', 'Tanker', 'Bulker', 'Specialized']);
  assert.deepEqual(columns.slice(4).map((column) => [column.inputType, column.columnKind]), Array(4).fill(['checkbox', 'vessel_type']));
});

test('dynamic CSV preserves text and independent vessel checkboxes', () => {
  const columns = defaultAccountPicColumns();
  const cells = Object.fromEntries(columns.map((column) => [column.id, '']));
  cells[columns[0].id] = 'Hong Kong (HK)';
  cells[columns[1].id] = 'Person One\nPerson Two';
  cells[columns[4].id] = true;
  cells[columns[6].id] = true;
  const rows = [normalizeAccountPicGridRow({ cells }, columns, 1)];
  const parsed = parseAccountPicGridCsv(accountPicGridCsvText(columns, rows), columns);
  assert.equal(parsed[0].cells[columns[1].id], 'Person One\nPerson Two');
  assert.equal(parsed[0].cells[columns[4].id], true);
  assert.equal(parsed[0].cells[columns[5].id], false);
  assert.equal(parsed[0].cells[columns[6].id], true);
});

test('grid supports renamed row and column headers plus every requested input type', () => {
  const types = ['text', 'multiline_text', 'checkbox', 'number', 'buyer_trader', 'supplier_trader'];
  const columns = types.map((inputType, index) => normalizeAccountPicColumn({ label: `Custom ${index + 1}`, inputType }, index + 1));
  const row = normalizeAccountPicGridRow({ rowLabel: 'Primary row', cells: {
    [columns[0].id]: 'Text', [columns[1].id]: 'Line 1\nLine 2', [columns[2].id]: true, [columns[3].id]: 12.5,
    [columns[4].id]: { profileId: '11111111-1111-4111-8111-111111111111', name: 'Buyer Trader', email: 'buyer@example.test' },
    [columns[5].id]: { profileId: '22222222-2222-4222-8222-222222222222', name: 'Supplier Trader', email: 'supplier@example.test' },
  } }, columns, 1);
  const payload = accountPicGridPayload(columns, [row]);
  assert.equal(validateAccountPicGrid(payload.columns, payload.rows), '');
  const normalized = normalizeServerGrid(payload);
  assert.equal(normalized.rows[0].rowLabel, 'Primary row');
  assert.equal(normalized.rows[0].cells[columns[3].id], 12.5);
  assert.equal(normalized.rows[0].cells[columns[5].id].name, 'Supplier Trader');
  assert.match(accountPicFlexiblePayloadHash({ accountId: '0012x00000A1B2CAA0', ...normalized }), /^[a-f0-9]{64}$/);
});

test('server projection retains typed cells', () => {
  const columns = defaultAccountPicColumns();
  const row = normalizeAccountPicGridRow({ cells: { [columns[0].id]: 'Piraeus', [columns[4].id]: true } }, columns, 1);
  const projection = accountPicFlexibleDirectoryProjection({ salesforce_account_id: '0012x00000A1B2CAA0', account_name: 'Buyer', account_role: 'buyer', revision: 3, row_count: 1, column_count: 8 }, columns.map((column, index) => ({ id: column.id, sequence: index + 1, label: column.label, input_type: column.inputType, column_kind: column.columnKind })), [{ id: row.id, sequence: 1, row_label: '', cells: row.cells }]);
  assert.equal(projection.columnCount, 8);
  assert.equal(projection.rows[0].cells[columns[4].id], true);
});

test('invalid headers and trader CSV assignment fail closed', () => {
  const columns = defaultAccountPicColumns();
  assert.match(validateAccountPicGrid([{ ...columns[0] }, { ...columns[1], label: columns[0].label }], []), /unique/i);
  const traderColumn = normalizeAccountPicColumn({ label: 'Buyer Trader', inputType: 'buyer_trader' }, 1);
  assert.throws(() => parseAccountPicGridCsv('Buyer Trader\r\nSomeone\r\n', [traderColumn]), /inside FCOS/i);
});
