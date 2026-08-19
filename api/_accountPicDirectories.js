import { createHash } from 'node:crypto';

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
    updatedAt: directory.updated_at ?? directory.updatedAt ?? null,
    updatedByEmail: directory.updated_by_email ?? directory.updatedByEmail ?? null,
    rows: normalizedRows,
  };
}

export const accountPicDirectoryInternals = Object.freeze({
  parseCsvRecords,
  PIC_FIELDS,
  MAX_ROWS,
  MAX_CELL_LENGTH,
});
