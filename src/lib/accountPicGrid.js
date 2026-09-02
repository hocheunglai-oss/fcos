export const ACCOUNT_PIC_GRID_INPUT_TYPES = Object.freeze([
  { value: 'text', label: 'Free text' },
  { value: 'multiline_text', label: 'Multi-line text' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'number', label: 'Number' },
  { value: 'buyer_trader', label: 'Buyer Trader' },
  { value: 'supplier_trader', label: 'Supplier Trader' },
]);

export const ACCOUNT_PIC_GRID_MAX_COLUMNS = 50;
export const ACCOUNT_PIC_GRID_MAX_ROWS = 500;
export const ACCOUNT_PIC_GRID_MAX_CELLS = 25_000;
export const ACCOUNT_PIC_GRID_MAX_CSV_BYTES = 2_000_000;

const newId = () => globalThis.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`;
const normalizedText = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim();

export function defaultAccountPicColumns() {
  return [
    { label: 'Port / Region', inputType: 'text' },
    { label: 'Responsible Personnel', inputType: 'multiline_text' },
    { label: 'Team', inputType: 'text' },
    { label: 'Under Supervision', inputType: 'multiline_text' },
    { label: 'Container', inputType: 'checkbox', columnKind: 'vessel_type' },
    { label: 'Tanker', inputType: 'checkbox', columnKind: 'vessel_type' },
    { label: 'Bulker', inputType: 'checkbox', columnKind: 'vessel_type' },
    { label: 'Specialized', inputType: 'checkbox', columnKind: 'vessel_type' },
  ].map((column, index) => normalizeAccountPicColumn(column, index + 1));
}

export function normalizeAccountPicColumn(column = {}, position = 1) {
  const inputType = ACCOUNT_PIC_GRID_INPUT_TYPES.some((type) => type.value === column.inputType) ? column.inputType : 'text';
  return {
    id: column.id || column.columnId || newId(),
    position,
    label: normalizedText(column.label) || `Column ${position}`,
    inputType,
    columnKind: column.columnKind === 'vessel_type' && inputType === 'checkbox' ? 'vessel_type' : 'field',
  };
}

function normalizeCell(value, column) {
  if (column.inputType === 'checkbox') return value === true;
  if (column.inputType === 'number') return value == null || value === '' ? null : Number(value);
  if (column.inputType === 'buyer_trader' || column.inputType === 'supplier_trader') {
    if (!value?.profileId) return null;
    return { profileId: value.profileId, name: normalizedText(value.name), email: normalizedText(value.email).toLowerCase() };
  }
  return normalizedText(value);
}

export function normalizeAccountPicGridRow(row = {}, columns = [], position = 1) {
  const sourceCells = row.cells && typeof row.cells === 'object' ? row.cells : {};
  return {
    id: row.id || row.rowId || newId(),
    clientKey: row.clientKey || row.id || newId(),
    position,
    rowLabel: normalizedText(row.rowLabel),
    cells: Object.fromEntries(columns.map((column) => [column.id, normalizeCell(sourceCells[column.id], column)])),
  };
}

export function normalizeAccountPicGrid(directory = {}) {
  const columns = (directory.columns?.length ? directory.columns : defaultAccountPicColumns())
    .map((column, index) => normalizeAccountPicColumn(column, index + 1));
  const rows = (directory.rows || []).map((row, index) => normalizeAccountPicGridRow(row, columns, index + 1));
  return { columns, rows };
}

export function accountPicGridPayload(columns = [], rows = []) {
  const normalizedColumns = columns.map((column, index) => normalizeAccountPicColumn(column, index + 1));
  const normalizedRows = rows.map((row, index) => normalizeAccountPicGridRow(row, normalizedColumns, index + 1));
  return {
    columns: normalizedColumns.map(({ id, position, label, inputType, columnKind }) => ({ id, position, label, inputType, columnKind })),
    rows: normalizedRows.map(({ id, position, rowLabel, cells }) => ({ id, position, rowLabel, cells })),
  };
}

export function validateAccountPicGrid(columns = [], rows = []) {
  if (!columns.length) return 'Add at least one column.';
  if (columns.length > ACCOUNT_PIC_GRID_MAX_COLUMNS) return `Use no more than ${ACCOUNT_PIC_GRID_MAX_COLUMNS} columns.`;
  if (rows.length > ACCOUNT_PIC_GRID_MAX_ROWS) return `Use no more than ${ACCOUNT_PIC_GRID_MAX_ROWS} rows.`;
  if (columns.length * rows.length > ACCOUNT_PIC_GRID_MAX_CELLS) return `Use no more than ${ACCOUNT_PIC_GRID_MAX_CELLS.toLocaleString()} cells.`;
  const labels = columns.map((column) => normalizedText(column.label).toLocaleLowerCase('en-US'));
  if (labels.some((label) => !label)) return 'Every column needs a header.';
  if (new Set(labels).size !== labels.length) return 'Column headers must be unique.';
  for (const column of columns) {
    if (column.columnKind === 'vessel_type' && column.inputType !== 'checkbox') return 'Vessel type columns must use checkboxes.';
  }
  for (const row of rows) {
    for (const column of columns) {
      const value = row.cells?.[column.id];
      if (column.inputType === 'number' && value != null && value !== '' && !Number.isFinite(Number(value))) return `${column.label} contains an invalid number.`;
    }
  }
  return '';
}

function parseCsvRecords(source) {
  const text = String(source ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const records = [];
  let record = [];
  let value = '';
  let quoted = false;
  let afterQuote = false;
  const finishValue = () => { record.push(value); value = ''; afterQuote = false; };
  const finishRecord = () => { finishValue(); records.push(record); record = []; };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else value += character;
    } else if (afterQuote) {
      if (character === ',') finishValue();
      else if (character === '\n') finishRecord();
      else throw new Error('The CSV contains text after a closing quote.');
    } else if (character === '"') {
      if (value) throw new Error('A quote may begin only at the start of a CSV value.');
      quoted = true;
    } else if (character === ',') finishValue();
    else if (character === '\n') finishRecord();
    else value += character;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted value.');
  if (value || record.length || afterQuote) finishRecord();
  return records;
}

function checkboxValue(value) {
  const normalized = normalizedText(value).toLocaleLowerCase('en-US');
  if (!normalized) return false;
  if (['✓', 'x', 'yes', 'true', '1'].includes(normalized)) return true;
  if (['no', 'false', '0', '-'].includes(normalized)) return false;
  throw new Error(`Checkbox value “${value}” must be ✓, yes/no, true/false, 1/0, x, or blank.`);
}

export function parseAccountPicGridCsv(source, columns = []) {
  if (new TextEncoder().encode(String(source ?? '')).byteLength > ACCOUNT_PIC_GRID_MAX_CSV_BYTES) throw new Error('The CSV is too large. Use a file smaller than 2 MB.');
  const records = parseCsvRecords(source);
  if (!records.length) throw new Error('Choose a CSV with a header row.');
  const headers = records.shift().map(normalizedText);
  if (headers.length !== columns.length || headers.some((header, index) => header !== columns[index].label)) {
    throw new Error(`CSV headers must match the current table exactly: ${columns.map((column) => column.label).join(', ')}.`);
  }
  const dataRows = records.filter((record) => record.some((value) => normalizedText(value)));
  if (dataRows.length > ACCOUNT_PIC_GRID_MAX_ROWS) throw new Error(`Use no more than ${ACCOUNT_PIC_GRID_MAX_ROWS} rows.`);
  return dataRows.map((record, rowIndex) => {
    if (record.length !== columns.length) throw new Error(`CSV row ${rowIndex + 2} has ${record.length} columns; ${columns.length} are required.`);
    const cells = {};
    columns.forEach((column, columnIndex) => {
      const value = normalizedText(record[columnIndex]);
      if (column.inputType === 'checkbox') cells[column.id] = checkboxValue(value);
      else if (column.inputType === 'number') {
        if (!value) cells[column.id] = null;
        else if (!Number.isFinite(Number(value))) throw new Error(`CSV row ${rowIndex + 2} column ${column.label} requires a number.`);
        else cells[column.id] = Number(value);
      } else if (column.inputType === 'buyer_trader' || column.inputType === 'supplier_trader') {
        if (value) throw new Error(`CSV cannot assign ${column.label}. Choose the active trader inside FCOS after import.`);
        cells[column.id] = null;
      } else cells[column.id] = value;
    });
    return normalizeAccountPicGridRow({ cells }, columns, rowIndex + 1);
  });
}

function csvValue(value) {
  const text = normalizedText(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function accountPicGridCsvText(columns = [], rows = []) {
  const records = rows.map((row) => columns.map((column) => {
    const value = row.cells?.[column.id];
    if (column.inputType === 'checkbox') return value ? '✓' : '';
    if (column.inputType === 'buyer_trader' || column.inputType === 'supplier_trader') return value?.name || value?.email || '';
    return value ?? '';
  }));
  return `\uFEFF${[columns.map((column) => csvValue(column.label)).join(','), ...records.map((record) => record.map(csvValue).join(','))].join('\r\n')}\r\n`;
}
