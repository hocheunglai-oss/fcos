const EXPORT_PAGE_SIZE = 200;
const MAX_DATA_ROWS_PER_SHEET = 60_000;

function abortError() {
  const error = new Error('Dashboard export cancelled.');
  error.name = 'AbortError';
  return error;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError();
}

const incomplete = (reason) => new Error(`Dashboard export incomplete: ${reason}. No file was downloaded.`);

/**
 * Fetches the complete ordinary Dashboard STEM selection. Each page is checked
 * against the first page so a changing result set can never become a partial
 * download that looks complete.
 */
export async function fetchAllDashboardStems({
  invoke,
  filterPayload,
  search = '',
  sort,
  includeFinanceCosts = false,
  signal,
  onProgress,
  pageSize = EXPORT_PAGE_SIZE,
} = {}) {
  if (typeof invoke !== 'function') throw new TypeError('An authenticated Dashboard API invoker is required.');
  const safePageSize = Math.min(Math.max(Number(pageSize) || EXPORT_PAGE_SIZE, 1), EXPORT_PAGE_SIZE);
  const rows = [];
  const ids = new Set();
  const seenCursors = new Set();
  let cursor = null;
  let expectedCount = null;
  let finance = null;
  const financeWarnings = new Set();
  let pageNumber = 0;

  while (true) {
    assertNotAborted(signal);
    if (cursor != null) {
      const cursorKey = String(cursor);
      if (seenCursors.has(cursorKey)) throw incomplete('repeated a page cursor');
      seenCursors.add(cursorKey);
    }
    const payload = {
      ...(filterPayload || {}),
      cursor,
      pageSize: safePageSize,
      sort,
      search: String(search || '').trim() || null,
      ...(includeFinanceCosts ? { includeFinanceCosts: true } : {}),
      ...(includeFinanceCosts && finance ? { financeSnapshot: { revision: finance.revision, asOfDate: finance.asOfDate } } : {}),
    };
    const response = await invoke('dashboardStemList', payload, {
      cache: false,
      force: true,
      signal,
    });
    assertNotAborted(signal);
    if (response?.data?.cancelled) throw abortError();
    if (response?.data?.error) throw new Error(response.data.error);

    const data = response?.data || {};
    const currentRows = data.stems;
    if (!Array.isArray(currentRows)) throw incomplete('invalid STEM page');
    const matchingCount = Number(data.matchingCount);
    if (!Number.isSafeInteger(matchingCount) || matchingCount < 0) {
      throw incomplete('invalid matching row count');
    }
    if (expectedCount == null) expectedCount = matchingCount;
    else if (matchingCount !== expectedCount) {
      throw incomplete('selection changed; please export again');
    }

    const pageFinance = data.finance;
    if (includeFinanceCosts && pageNumber === 0) {
      if (!pageFinance || pageFinance.revision == null || !pageFinance.asOfDate) {
        throw incomplete('finance snapshot unavailable');
      }
      finance = pageFinance;
    } else if (includeFinanceCosts && !pageFinance) {
      throw incomplete('finance snapshot missing from a later page');
    } else if (includeFinanceCosts) {
      if (String(pageFinance.revision) !== String(finance.revision) || String(pageFinance.asOfDate) !== String(finance.asOfDate)) {
        throw incomplete('rate or calculation date changed; please export again');
      }
      if (Number(pageFinance.annualInterestRatePct) !== Number(finance.annualInterestRatePct) || String(pageFinance.dayCountBasis || '') !== String(finance.dayCountBasis || '')) {
        throw incomplete('finance methodology changed; please export again');
      }
    }
    if (includeFinanceCosts) for (const warning of pageFinance.warnings || []) if (warning) financeWarnings.add(String(warning));

    for (const row of currentRows) {
      const id = row?.id;
      if (!id) throw incomplete('STEM row has no stable ID');
      const key = String(id);
      if (ids.has(key)) throw incomplete('duplicate STEM');
      ids.add(key);
      rows.push(row);
    }

    if (rows.length > expectedCount) throw incomplete('more STEMs than the matching count');
    const nextCursor = data.nextCursor ?? null;
    pageNumber += 1;
    onProgress?.({ loaded: rows.length, total: expectedCount, page: pageNumber });

    if (nextCursor == null || nextCursor === '') {
      if (rows.length !== expectedCount) {
        throw incomplete(`export stopped at ${rows.length.toLocaleString()} of ${expectedCount.toLocaleString()} STEMs`);
      }
      break;
    }
    if (!currentRows.length || (currentRows.length < safePageSize && rows.length < expectedCount)) {
      throw incomplete('incomplete page before the end of the selection');
    }
    if (rows.length >= expectedCount) {
      throw incomplete('another page followed the matching count');
    }
    const nextKey = String(nextCursor);
    if (nextKey === String(cursor ?? '') || seenCursors.has(nextKey)) {
      throw incomplete('repeated a page cursor');
    }
    cursor = nextCursor;
  }

  if (finance) {
    finance = {
      ...finance,
      complete: rows.every((row) => row?.finance?.complete === true),
      warnings: [...financeWarnings],
    };
  }
  return { rows, matchingCount: expectedCount ?? 0, finance };
}

function cleanXmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replace(/\r?\n/g, '&#10;');
}

function textCell(value) {
  return `<Cell><Data ss:Type="String">${cleanXmlText(value)}</Data></Cell>`;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberCell(value) {
  const number = finiteNumber(value);
  return number != null
    ? `<Cell><Data ss:Type="Number">${number}</Data></Cell>`
    : textCell('Unavailable');
}

function workbookRow(cells) {
  return `<Row>${cells.join('')}</Row>`;
}

const BASE_HEADERS = ['STEM', 'Created Date', 'Delivery / Expected Date', 'Date Source', 'Vessel', 'Buyer', 'Suppliers', 'Products / Quantities', 'Port', 'Country', 'Currency', 'Turnover', 'Gross Profit', 'Status', 'Dispute', 'Dispute Information'];
const FINANCE_HEADERS = ['Finance Cost', 'EBIT', 'Evidence Status'];
const joined = (values) => [...new Set(values.filter(Boolean).map(String))].join('; ');
const dated = (value) => value ? String(value).slice(0, 10) : '';

function exportRowCells(row, includeFinanceCosts) {
  const products = (row.productQuantities || []).map((item) => joined([item.productName, item.quantityLabel]));
  products.push(...(row.supplierProductRows || []).map((item) => joined([item.itemName, item.quantityLabel])));
  const dispute = row.disputeStatus || (row.dispute ? 'Disputed' : 'No dispute');
  const cells = [
    textCell(row.name), textCell(dated(row.createdDate)), textCell(dated(row.deliveryDate)),
    textCell(row.deliveryDateSource === 'delivery' ? 'Actual delivery' : row.deliveryDateSource === 'expected' ? 'Expected delivery' : ''),
    textCell(row.vessel?.name), textCell(row.account?.name), textCell(joined(row.supplierNames || [])),
    textCell(joined(products)), textCell(row.port?.name), textCell(row.port?.countryCode), textCell(row.currency),
    numberCell(row.buyer), numberCell(row.netPnl), textCell(row.status), textCell(dispute),
    textCell(row.disputeInformation || dispute),
  ];
  if (!includeFinanceCosts) return cells;
  const finance = row.finance;
  const complete = finance?.complete === true;
  const issues = joined(finance?.issues || []);
  const evidence = finance ? `${finance.status || (complete ? 'Complete' : 'Unavailable')}${issues ? `: ${issues}` : ''}` : 'Unavailable';
  cells.push(
    complete ? numberCell(finance.financeCost) : textCell('Unavailable'),
    complete ? numberCell(finance.ebit) : textCell('Unavailable'),
    textCell(evidence),
  );
  return cells;
}

function scopeEntries({ filterPayload, scopeLabels = {}, search, sort, matchingCount, generatedAt, includeFinanceCosts, finance }) {
  const payload = filterPayload || {};
  const filters = payload.filters || {};
  const entries = [
    ['Generated at', generatedAt],
    ['Exported STEM rows', matchingCount],
    ['Submitted text search', String(search || '').trim() || 'None'],
    ['Sort', sort?.field ? `${sort.field} ${sort.direction || 'asc'}` : 'Server default'],
    ['Period', scopeLabels.period || 'Custom selection'],
    ['Counterparty', scopeLabels.counterparty || 'All'],
    ['Location', joined([scopeLabels.port, scopeLabels.country]) || 'All'],
    ['Korea Desk', scopeLabels.koreaDesk || 'All'],
    ['Active filters', JSON.stringify({ dateWindows: payload.dateWindows || [], disputedOnly: Boolean(payload.disputeOnly), counterpartyMode: payload.counterpartyMode || 'all', counterparty: payload.counterparty || null, ...filters })],
    ['Finance columns included', includeFinanceCosts ? 'Yes' : 'No'],
  ];
  if (includeFinanceCosts) {
    entries.push(
      ['Finance snapshot', `${finance?.annualInterestRatePct ?? 'Unavailable'}% annual; revision ${finance?.revision ?? 'Unavailable'}; calculated ${finance?.asOfDate ?? 'Unavailable'}; ${finance?.dayCountBasis || 'ACT/365'}`],
      ['Finance evidence complete', finance?.complete === true ? 'Yes' : 'No'],
      ['Finance methodology', 'Finance cost = sum of positive daily funded balances × annual rate ÷ 365 (Actual/365). Supplier payments increase funding, buyer receipts reduce it, same-day settlement costs zero, and open funding accrues through the calculation date.'],
      ['Missing-data note', finance?.complete === true ? 'No incomplete finance evidence reported.' : 'Finance cost and EBIT are unavailable for affected currencies or STEMs when payment evidence is incomplete.'],
    );
    if (Array.isArray(finance?.warnings) && finance.warnings.length) entries.push(['Finance warnings', finance.warnings.join('; ')]);
  }
  return entries;
}

function currencyTotals(rows, includeFinanceCosts) {
  const totals = new Map();
  for (const row of rows) {
    const currency = String(row?.currency || 'Unspecified').toUpperCase();
    const item = totals.get(currency) || { currency, rowCount: 0, turnover: 0, grossProfit: 0, turnoverComplete: true, grossProfitComplete: true, financeCost: 0, ebit: 0, financeComplete: true };
    item.rowCount += 1;
    const turnover = finiteNumber(row?.buyer);
    const grossProfit = finiteNumber(row?.netPnl);
    if (turnover != null) item.turnover += turnover;
    else item.turnoverComplete = false;
    if (grossProfit != null) item.grossProfit += grossProfit;
    else item.grossProfitComplete = false;
    if (includeFinanceCosts) {
      const financeCost = finiteNumber(row?.finance?.financeCost);
      const ebit = finiteNumber(row?.finance?.ebit);
      if (row?.finance?.complete !== true || financeCost == null || ebit == null) item.financeComplete = false;
      else {
        item.financeCost += financeCost;
        item.ebit += ebit;
      }
    }
    totals.set(currency, item);
  }
  return [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

function splitRows(rows, maxRowsPerSheet = MAX_DATA_ROWS_PER_SHEET) {
  const size = Math.max(1, Number(maxRowsPerSheet) || MAX_DATA_ROWS_PER_SHEET);
  const chunks = [];
  for (let offset = 0; offset < rows.length; offset += size) chunks.push(rows.slice(offset, offset + size));
  return chunks.length ? chunks : [[]];
}

export function buildDashboardStemWorkbookXml({
  rows = [],
  filterPayload = {},
  scopeLabels = {},
  search = '',
  sort = null,
  includeFinanceCosts = false,
  finance = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(rows)) throw new TypeError('Dashboard export rows must be an array.');
  const headers = includeFinanceCosts ? [...BASE_HEADERS, ...FINANCE_HEADERS] : BASE_HEADERS;
  const chunks = splitRows(rows);
  const dataSheets = chunks.map((chunk, index) => {
    const title = chunks.length === 1 ? 'STEMs' : `STEMs ${index + 1}`;
    const sheetRows = [
      workbookRow(headers.map(textCell)),
      ...chunk.map((row) => workbookRow(exportRowCells(row, includeFinanceCosts))),
    ];
    return `<Worksheet ss:Name="${cleanXmlText(title)}"><Table ss:ExpandedColumnCount="${headers.length}" ss:ExpandedRowCount="${sheetRows.length}">${headers.map(() => '<Column ss:AutoFitWidth="1" ss:Width="110"/>').join('')}${sheetRows.join('')}</Table></Worksheet>`;
  }).join('');

  const entries = scopeEntries({ filterPayload, scopeLabels, search, sort, matchingCount: rows.length, generatedAt, includeFinanceCosts, finance });
  const totals = currencyTotals(rows, includeFinanceCosts);
  const totalHeaders = ['Currency', 'Row Count', 'Turnover', 'Gross Profit', ...(includeFinanceCosts ? ['Finance Cost', 'EBIT', 'Evidence Complete'] : [])];
  const scopeRows = [
    workbookRow([textCell('Dashboard STEM Export Scope'), textCell('')]),
    ...entries.map(([label, value]) => workbookRow([textCell(label), textCell(value)])),
    workbookRow([textCell('Currency totals'), textCell('Totals remain separated by currency.')]),
    workbookRow(totalHeaders.map(textCell)),
    ...totals.map((total) => workbookRow([
      textCell(total.currency), numberCell(total.rowCount), total.turnoverComplete ? numberCell(total.turnover) : textCell('Unavailable'), total.grossProfitComplete ? numberCell(total.grossProfit) : textCell('Unavailable'),
      ...(includeFinanceCosts ? [
        total.financeComplete ? numberCell(total.financeCost) : textCell('Unavailable'),
        total.financeComplete ? numberCell(total.ebit) : textCell('Unavailable'),
        textCell(total.financeComplete ? 'Yes' : 'No'),
      ] : []),
    ])),
  ];
  const scopeColumnCount = Math.max(2, totalHeaders.length);
  const scopeSheet = `<Worksheet ss:Name="Scope"><Table ss:ExpandedColumnCount="${scopeColumnCount}" ss:ExpandedRowCount="${scopeRows.length}"><Column ss:Width="180"/><Column ss:Width="420"/>${Array.from({ length: Math.max(0, scopeColumnCount - 2) }, () => '<Column ss:Width="120"/>').join('')}${scopeRows.join('')}</Table></Worksheet>`;

  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${dataSheets}${scopeSheet}</Workbook>`;
}

export function createDashboardStemWorkbook(options) {
  const xml = buildDashboardStemWorkbookXml(options);
  return new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
}

export function dashboardStemExportFileName(generatedAt = new Date()) {
  const date = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  return `FCOS_Dashboard_STEMs_${date.toISOString().slice(0, 10)}.xls`;
}

export function downloadDashboardStemWorkbook(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const dashboardStemExportInternals = Object.freeze({
  MAX_DATA_ROWS_PER_SHEET,
  cleanXmlText,
  currencyTotals,
  splitRows,
});
