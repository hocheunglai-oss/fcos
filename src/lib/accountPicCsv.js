export const ACCOUNT_PIC_CSV_HEADERS = Object.freeze([
  'Port / Region',
  'Responsible Personnel',
  'Team',
  'Reporting / Supervision',
  'Vessel Types Covered',
]);

const FIELD_NAMES = Object.freeze([
  'portRegion',
  'responsiblePersonnel',
  'team',
  'reportingSupervision',
  'vesselTypesCovered',
]);

export const ACCOUNT_PIC_MAX_ROWS = 500;
export const ACCOUNT_PIC_MAX_CELL_LENGTH = 4_000;
export const ACCOUNT_PIC_MAX_CSV_BYTES = 2_000_000;

function normalizedCell(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function parseCsvRecords(source) {
  const text = String(source ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;

  const finishField = () => {
    row.push(field);
    field = '';
    afterQuote = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ',') {
        finishField();
      } else if (character === '\n') {
        finishField();
        rows.push(row);
        row = [];
      } else {
        throw new Error('The CSV contains text after a closing quote.');
      }
    } else if (character === '"') {
      if (field) throw new Error('A quote may begin only at the start of a CSV value.');
      quoted = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\n') {
      finishField();
      rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('The CSV has an unclosed quoted value.');
  if (field || row.length || afterQuote) {
    finishField();
    rows.push(row);
  }
  return rows;
}

export function normalizeAccountPicRow(row = {}, position = 1) {
  return {
    id: row.id || row.rowId || null,
    clientKey: row.clientKey || globalThis.crypto?.randomUUID?.() || `pic-${Date.now()}-${position}`,
    position: Number.isFinite(Number(row.position)) ? Number(row.position) : position,
    portRegion: normalizedCell(row.portRegion),
    responsiblePersonnel: normalizedCell(row.responsiblePersonnel),
    team: normalizedCell(row.team),
    reportingSupervision: normalizedCell(row.reportingSupervision),
    vesselTypesCovered: normalizedCell(row.vesselTypesCovered),
  };
}

export function parseAccountPicCsv(source) {
  if (new TextEncoder().encode(String(source ?? '')).byteLength > ACCOUNT_PIC_MAX_CSV_BYTES) {
    throw new Error('The CSV is too large. Use a file smaller than 2 MB.');
  }
  const records = parseCsvRecords(source);
  if (!records.length) throw new Error('Choose a CSV with the five Buyer PIC Reference columns.');
  const header = records.shift().map(normalizedCell);
  const validHeader = header.length === ACCOUNT_PIC_CSV_HEADERS.length
    && header.every((value, index) => value === ACCOUNT_PIC_CSV_HEADERS[index]);
  if (!validHeader) {
    throw new Error(`CSV headers must be exactly: ${ACCOUNT_PIC_CSV_HEADERS.join(', ')}.`);
  }

  const rows = records
    .filter((record) => record.some((value) => normalizedCell(value)))
    .map((record, index) => {
      if (record.length !== ACCOUNT_PIC_CSV_HEADERS.length) {
        throw new Error(`CSV row ${index + 2} has ${record.length} columns; five are required.`);
      }
      if (record.some((value) => normalizedCell(value).length > ACCOUNT_PIC_MAX_CELL_LENGTH)) {
        throw new Error(`CSV row ${index + 2} contains a cell longer than ${ACCOUNT_PIC_MAX_CELL_LENGTH} characters.`);
      }
      return normalizeAccountPicRow(Object.fromEntries(FIELD_NAMES.map((fieldName, fieldIndex) => [fieldName, record[fieldIndex]])), index + 1);
    });

  if (!rows.length) throw new Error('The CSV has no Buyer PIC Reference rows.');
  if (rows.length > ACCOUNT_PIC_MAX_ROWS) throw new Error(`A Buyer PIC directory can contain at most ${ACCOUNT_PIC_MAX_ROWS} rows.`);
  if (rows.some((row) => !row.portRegion)) throw new Error('Each Buyer PIC Reference row requires Port / Region.');
  return rows;
}

function csvValue(value) {
  const text = normalizedCell(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function accountPicCsvText(rows = []) {
  const records = rows.map((row) => normalizeAccountPicRow(row));
  return `\uFEFF${[
    ACCOUNT_PIC_CSV_HEADERS.join(','),
    ...records.map((row) => FIELD_NAMES.map((fieldName) => csvValue(row[fieldName])).join(',')),
  ].join('\r\n')}\r\n`;
}

export function accountPicSaveRows(rows = []) {
  return rows.map((row, index) => {
    const normalized = normalizeAccountPicRow(row, index + 1);
    return {
      ...(normalized.id ? { id: normalized.id } : {}),
      position: index + 1,
      portRegion: normalized.portRegion,
      responsiblePersonnel: normalized.responsiblePersonnel,
      team: normalized.team,
      reportingSupervision: normalized.reportingSupervision,
      vesselTypesCovered: normalized.vesselTypesCovered,
    };
  });
}
