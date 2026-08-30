import { createHash } from 'node:crypto';
import { normalizeAccountPicRowColorRules } from '../src/lib/accountPicRowColors.js';

export const ACCOUNT_PIC_CSV_HEADERS = Object.freeze([
  'Port / Region',
  'Responsible Personnel',
  'Team',
  'Reporting / Supervision',
  'Vessel Types Covered',
]);

const FIELD_BY_HEADER = Object.freeze({
  'Port / Region': 'portRegion',
  'Responsible Personnel': 'responsiblePersonnel',
  Team: 'team',
  'Reporting / Supervision': 'reportingSupervision',
  'Vessel Types Covered': 'vesselTypesCovered',
});

const PIC_FIELDS = Object.freeze(Object.values(FIELD_BY_HEADER));
const SALESFORCE_ID_RE = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const MAX_ROWS = 500;
const MAX_CELL_LENGTH = 4_000;
const MAX_COLUMNS = 50;
const MAX_CELLS = 25_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ACCOUNT_PIC_INPUT_TYPES = Object.freeze([
  'text',
  'multiline_text',
  'checkbox',
  'number',
  'buyer_trader',
  'supplier_trader',
]);
export const ACCOUNT_PIC_MAX_CSV_BYTES = 2_000_000;

function text(value) {
  return String(value ?? '');
}

export function normalizeAccountPicCell(value) {
  return text(value)
    .replace(/\r\n?/g, '\n')
    .trim();
}

export function validAccountPicAccountId(value) {
  return SALESFORCE_ID_RE.test(text(value).trim());
}

function parseCsvRecords(source) {
  const records = [];
  let record = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;

  const finishCell = () => {
    record.push(cell);
    cell = '';
    afterQuote = false;
  };
  const finishRecord = () => {
    finishCell();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ',') {
        finishCell();
      } else if (character === '\n') {
        finishRecord();
      } else {
        throw new Error('CSV contains text after a closing quote.');
      }
      continue;
    }

    if (character === '"') {
      if (cell !== '') throw new Error('CSV quotes must start at the beginning of a cell.');
      quoted = true;
    } else if (character === ',') {
      finishCell();
    } else if (character === '\n') {
      finishRecord();
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('CSV contains an unterminated quoted cell.');
  if (record.length || cell !== '' || afterQuote) finishRecord();
  return records;
}

function rowFromValues(values, position) {
  if (!Array.isArray(values) || values.length !== ACCOUNT_PIC_CSV_HEADERS.length) {
    throw new Error(`CSV row ${position + 1} must contain exactly ${ACCOUNT_PIC_CSV_HEADERS.length} columns.`);
  }
  return ACCOUNT_PIC_CSV_HEADERS.reduce((row, header, index) => {
    row[FIELD_BY_HEADER[header]] = normalizeAccountPicCell(values[index]);
    return row;
  }, { position });
}

export function normalizeAccountPicRows(rows, { requireAtLeastOne = false } = {}) {
  if (!Array.isArray(rows)) throw new Error('Buyer PIC rows must be a list.');
  if (rows.length > MAX_ROWS) throw new Error(`A Buyer PIC directory can contain at most ${MAX_ROWS} rows.`);
  if (requireAtLeastOne && rows.length === 0) throw new Error('CSV must contain at least one Buyer PIC row.');

  return rows.map((input, index) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error(`Buyer PIC row ${index + 1} is invalid.`);
    }
    const row = { position: index + 1 };
    for (const field of PIC_FIELDS) {
      const value = normalizeAccountPicCell(input[field]);
      if (value.length > MAX_CELL_LENGTH) {
        throw new Error(`Buyer PIC row ${index + 1} contains a cell longer than ${MAX_CELL_LENGTH} characters.`);
      }
      row[field] = value;
    }
    if (!row.portRegion) throw new Error(`Buyer PIC row ${index + 1} requires Port / Region.`);
    return row;
  });
}

export function parseAccountPicCsv(csvText) {
  if (Buffer.byteLength(text(csvText), 'utf8') > ACCOUNT_PIC_MAX_CSV_BYTES) {
    throw new Error('CSV is too large. Use a file smaller than 2 MB.');
  }
  const source = text(csvText).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!source.trim()) throw new Error('CSV is empty.');
  const records = parseCsvRecords(source);
  const [headers, ...rawRows] = records;
  if (!Array.isArray(headers)
    || headers.length !== ACCOUNT_PIC_CSV_HEADERS.length
    || headers.some((header, index) => header !== ACCOUNT_PIC_CSV_HEADERS[index])) {
    throw new Error(`CSV headers must be exactly: ${ACCOUNT_PIC_CSV_HEADERS.join(', ')}.`);
  }

  const rows = rawRows
    .filter((values) => values.some((value) => value !== ''))
    .map((values, index) => rowFromValues(values, index + 1));
  return normalizeAccountPicRows(rows, { requireAtLeastOne: true });
}

function csvCell(value) {
  const normalized = normalizeAccountPicCell(value);
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

export function accountPicCsv(rows = []) {
  const normalizedRows = normalizeAccountPicRows(rows);
  const body = normalizedRows.map((row) => ACCOUNT_PIC_CSV_HEADERS.map((header) => csvCell(row[FIELD_BY_HEADER[header]])).join(','));
  return `\uFEFF${[ACCOUNT_PIC_CSV_HEADERS.join(','), ...body].join('\r\n')}\r\n`;
}

export function accountPicPayloadHash({ accountId, rows = [] } = {}) {
  const payload = {
    accountId: text(accountId).trim(),
    rows: normalizeAccountPicRows(rows),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeTraderCell(value, position, label) {
  if (value == null || value === '') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Buyer PIC row ${position} column ${label} requires a trader profile.`);
  }
  const profileId = text(value.profileId ?? value.id).trim();
  if (!UUID_RE.test(profileId)) throw new Error(`Buyer PIC row ${position} column ${label} requires a valid trader profile.`);
  const name = normalizeAccountPicCell(value.name);
  const email = normalizeAccountPicCell(value.email).toLowerCase();
  if (name.length > 300 || email.length > 320) throw new Error('Buyer PIC trader labels are too long.');
  return { profileId, name, email };
}

export function normalizeAccountPicColumns(columns) {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > MAX_COLUMNS) {
    throw new Error(`Buyer PIC columns must contain between 1 and ${MAX_COLUMNS} columns.`);
  }
  const labels = new Set();
  const ids = new Set();
  return columns.map((input, index) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`Buyer PIC column ${index + 1} is invalid.`);
    const id = text(input.id ?? input.columnId).trim();
    const label = normalizeAccountPicCell(input.label);
    const inputType = text(input.inputType ?? input.input_type).trim().toLowerCase();
    const columnKind = text(input.columnKind ?? input.column_kind ?? 'field').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new Error(`Buyer PIC column ${index + 1} requires a valid ID.`);
    if (!label || label.length > 200) throw new Error(`Buyer PIC column ${index + 1} requires a header of at most 200 characters.`);
    if (!ACCOUNT_PIC_INPUT_TYPES.includes(inputType)) throw new Error(`Buyer PIC column ${label} has an invalid input type.`);
    if (!['field', 'vessel_type'].includes(columnKind)) throw new Error(`Buyer PIC column ${label} has an invalid column kind.`);
    if (columnKind === 'vessel_type' && inputType !== 'checkbox') throw new Error('Vessel type columns must use checkboxes.');
    const normalizedLabel = label.toLocaleLowerCase('en-US');
    if (labels.has(normalizedLabel)) throw new Error('Buyer PIC column headers must be unique.');
    if (ids.has(id)) throw new Error('Buyer PIC column IDs must be unique.');
    labels.add(normalizedLabel);
    ids.add(id);
    return { id, position: index + 1, label, inputType, columnKind };
  });
}

export function normalizeAccountPicFlexibleRows(rows, columns) {
  if (!Array.isArray(rows)) throw new Error('Buyer PIC rows must be a list.');
  if (rows.length > MAX_ROWS) throw new Error(`A Buyer PIC directory can contain at most ${MAX_ROWS} rows.`);
  if (rows.length * columns.length > MAX_CELLS) throw new Error(`A Buyer PIC directory can contain at most ${MAX_CELLS} cells.`);
  const rowIds = new Set();
  const columnById = new Map(columns.map((column) => [column.id, column]));
  return rows.map((input, index) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`Buyer PIC row ${index + 1} is invalid.`);
    const id = text(input.id ?? input.rowId).trim();
    if (!UUID_RE.test(id) || rowIds.has(id)) throw new Error(`Buyer PIC row ${index + 1} requires a unique valid ID.`);
    rowIds.add(id);
    const rowLabel = normalizeAccountPicCell(input.rowLabel);
    if (rowLabel.length > 300) throw new Error(`Buyer PIC row ${index + 1} header is too long.`);
    const rawCells = input.cells && typeof input.cells === 'object' && !Array.isArray(input.cells) ? input.cells : {};
    for (const key of Object.keys(rawCells)) {
      if (!columnById.has(key)) throw new Error(`Buyer PIC row ${index + 1} contains an unknown column.`);
    }
    const cells = {};
    for (const column of columns) {
      const value = rawCells[column.id];
      if (column.inputType === 'checkbox') {
        cells[column.id] = value === true;
      } else if (column.inputType === 'number') {
        if (value == null || value === '') cells[column.id] = null;
        else {
          const number = Number(value);
          if (!Number.isFinite(number)) throw new Error(`Buyer PIC row ${index + 1} column ${column.label} requires a number.`);
          cells[column.id] = number;
        }
      } else if (column.inputType === 'buyer_trader' || column.inputType === 'supplier_trader') {
        cells[column.id] = normalizeTraderCell(value, index + 1, column.label);
      } else {
        const cell = normalizeAccountPicCell(value);
        if (cell.length > MAX_CELL_LENGTH) throw new Error(`Buyer PIC row ${index + 1} column ${column.label} is longer than ${MAX_CELL_LENGTH} characters.`);
        cells[column.id] = cell;
      }
    }
    return { id, position: index + 1, rowLabel, cells };
  });
}

export function normalizeAccountPicGrid({ columns, rows } = {}) {
  const normalizedColumns = normalizeAccountPicColumns(columns);
  return {
    columns: normalizedColumns,
    rows: normalizeAccountPicFlexibleRows(rows, normalizedColumns),
  };
}

export function accountPicFlexiblePayloadHash({ accountId, columns, rows } = {}) {
  const grid = normalizeAccountPicGrid({ columns, rows });
  return createHash('sha256').update(JSON.stringify({ accountId: text(accountId).trim(), ...grid })).digest('hex');
}

export function accountPicRowColorPayloadHash({ accountId, rules, columns } = {}) {
  const normalizedRules = normalizeAccountPicRowColorRules(rules, columns, { strict: true });
  return createHash('sha256').update(JSON.stringify({ accountId: text(accountId).trim(), rules: normalizedRules })).digest('hex');
}

export function accountPicFlexibleDirectoryProjection(directory = {}, columns = [], rows = []) {
  const normalizedColumns = (columns || []).slice()
    .sort((left, right) => Number(left.sequence || left.position || 0) - Number(right.sequence || right.position || 0))
    .map((column, index) => ({
      id: text(column.id).trim(),
      position: Number(column.sequence || column.position || index + 1),
      label: normalizeAccountPicCell(column.label),
      inputType: text(column.input_type ?? column.inputType).trim(),
      columnKind: text(column.column_kind ?? column.columnKind ?? 'field').trim(),
    }));
  const columnIds = new Set(normalizedColumns.map((column) => column.id));
  const normalizedRows = (rows || []).slice()
    .sort((left, right) => Number(left.sequence || left.position || 0) - Number(right.sequence || right.position || 0))
    .map((row, index) => {
      const rawCells = row.cells && typeof row.cells === 'object' && !Array.isArray(row.cells) ? row.cells : {};
      const cells = Object.fromEntries(Object.entries(rawCells).filter(([key]) => columnIds.has(key)));
      return {
        id: text(row.id).trim(),
        position: Number(row.sequence || row.position || index + 1),
        rowLabel: normalizeAccountPicCell(row.row_label ?? row.rowLabel),
        cells,
      };
    });
  const rowColorRules = normalizeAccountPicRowColorRules(directory.row_color_rules ?? directory.rowColorRules ?? [], normalizedColumns);
  return {
    accountId: text(directory.salesforce_account_id ?? directory.accountId).trim(),
    accountName: text(directory.account_name ?? directory.accountName).trim(),
    clKey: text(directory.cl_key ?? directory.clKey).trim(),
    role: text(directory.account_role ?? directory.role).trim(),
    revision: Number(directory.revision || 0),
    rowCount: Number(directory.row_count ?? normalizedRows.length),
    columnCount: Number(directory.column_count ?? normalizedColumns.length),
    updatedAt: directory.updated_at ?? directory.updatedAt ?? null,
    updatedByEmail: directory.updated_by_email ?? directory.updatedByEmail ?? null,
    columns: normalizedColumns,
    rows: normalizedRows,
    rowColorRules,
  };
}

export function accountPicDirectoryProjection(directory = {}, rows = []) {
  const normalizedRows = (rows || [])
    .slice()
    .sort((left, right) => Number(left.sequence || left.position || 0) - Number(right.sequence || right.position || 0))
    .map((row, index) => ({
      id: row.id || null,
      sequence: Number(row.sequence || row.position || index + 1),
      position: Number(row.sequence || row.position || index + 1),
      portRegion: normalizeAccountPicCell(row.port_region ?? row.portRegion),
      responsiblePersonnel: normalizeAccountPicCell(row.responsible_personnel ?? row.responsiblePersonnel),
      team: normalizeAccountPicCell(row.team),
      reportingSupervision: normalizeAccountPicCell(row.reporting_supervision ?? row.reportingSupervision),
      vesselTypesCovered: normalizeAccountPicCell(row.vessel_types_covered ?? row.vesselTypesCovered),
    }));

  return {
    accountId: text(directory.salesforce_account_id ?? directory.accountId).trim(),
    accountName: text(directory.account_name ?? directory.accountName).trim(),
    clKey: text(directory.cl_key ?? directory.clKey).trim(),
    role: text(directory.account_role ?? directory.role).trim(),
    revision: Number(directory.revision || 0),
    rowCount: Number(directory.row_count ?? normalizedRows.length),
    columnCount: Number(directory.column_count ?? 0),
    updatedAt: directory.updated_at ?? directory.updatedAt ?? null,
    updatedByEmail: directory.updated_by_email ?? directory.updatedByEmail ?? null,
    rowColorRules: [],
    rows: normalizedRows,
  };
}

export const accountPicDirectoryInternals = Object.freeze({
  parseCsvRecords,
  PIC_FIELDS,
  MAX_ROWS,
  MAX_CELL_LENGTH,
  MAX_COLUMNS,
  MAX_CELLS,
});
