import { utils, write } from 'xlsx';

const MAX_DATA_ROWS_PER_SHEET = 60_000;

// Explicit string cells keep formula-like customer text literal in Excel and Numbers.
function textCell(value) {
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  // BIFF8 writer continuation records cannot split a single long Unicode string.
  // Fail before writing rather than hanging or silently truncating source evidence.
  if (text.length > 4_000) throw new Error('Dashboard export text exceeds the supported XLS limit of 4,000 characters per cell. No file was downloaded.');
  return { t: 's', v: text };
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberCell(value) {
  const number = finiteNumber(value);
  return number != null ? { t: 'n', v: number, z: '#,##0.00;[Red](#,##0.00);–' } : textCell('Unavailable');
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
    ['Period', scopeLabels.period || 'All delivery dates'],
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
      ['Missing-data note', 'Finance totals cover verified STEMs only; compare counts. Unknown costs are never zero.'],
    );
    if (Array.isArray(finance?.warnings) && finance.warnings.length) entries.push(['Finance warnings', finance.warnings.join('; ')]);
  }
  return entries;
}

function currencyTotals(rows, includeFinanceCosts) {
  const totals = new Map();
  for (const row of rows) {
    const currency = String(row?.currency || 'Unspecified').toUpperCase();
    const item = totals.get(currency) || { currency, rowCount: 0, turnover: 0, grossProfit: 0, turnoverComplete: true, grossProfitComplete: true, financeCost: 0, ebit: 0, financeComplete: true, verifiedStemCount: 0, verifiedGrossProfit: 0 };
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
      if (row?.finance?.complete !== true || financeCost == null || ebit == null || grossProfit == null) item.financeComplete = false;
      else {
        item.verifiedStemCount += 1;
        item.verifiedGrossProfit += grossProfit;
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

export function buildDashboardStemWorkbook({
  rows = [], filterPayload = {}, scopeLabels = {}, search = '', sort = null,
  includeFinanceCosts = false, finance = null, generatedAt = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(rows)) throw new TypeError('Dashboard export rows must be an array.');
  const book = utils.book_new();
  const headers = includeFinanceCosts ? [...BASE_HEADERS, ...FINANCE_HEADERS] : BASE_HEADERS;
  const chunks = splitRows(rows);
  chunks.forEach((chunk, index) => {
    const sheet = utils.aoa_to_sheet([headers.map(textCell), ...chunk.map((row) => exportRowCells(row, includeFinanceCosts))]);
    sheet['!cols'] = headers.map((_, column) => ({ wch: [0, 5, 6, 7, 15, 18].includes(column) ? 36 : 19 }));
    utils.book_append_sheet(book, sheet, chunks.length === 1 ? 'STEMs' : `STEMs ${index + 1}`);
  });
  const entries = scopeEntries({ filterPayload, scopeLabels, search, sort, matchingCount: rows.length, generatedAt, includeFinanceCosts, finance });
  const totalHeaders = ['Currency', 'Row Count', 'Turnover', 'Gross Profit', ...(includeFinanceCosts ? ['Verified STEMs', 'Verified Gross Profit', 'Verified Finance Cost', 'Verified EBIT', 'Evidence Complete'] : [])];
  const scope = utils.aoa_to_sheet([
    [textCell('Dashboard STEM Export Scope'), textCell('')],
    ...entries.map(([label, value]) => [textCell(label), textCell(value)]),
    [textCell('Currency totals'), textCell('Totals remain separated by currency.')],
    totalHeaders.map(textCell),
    ...currencyTotals(rows, includeFinanceCosts).map((total) => [
      textCell(total.currency), numberCell(total.rowCount), total.turnoverComplete ? numberCell(total.turnover) : textCell('Unavailable'), total.grossProfitComplete ? numberCell(total.grossProfit) : textCell('Unavailable'),
      ...(includeFinanceCosts ? [
        numberCell(total.verifiedStemCount),
        total.verifiedStemCount ? numberCell(total.verifiedGrossProfit) : textCell('Unavailable'),
        total.verifiedStemCount ? numberCell(total.financeCost) : textCell('Unavailable'),
        total.verifiedStemCount ? numberCell(total.ebit) : textCell('Unavailable'),
        textCell(total.financeComplete ? 'Yes' : 'No'),
      ] : []),
    ]),
  ]);
  scope['!cols'] = [{ wch: 30 }, { wch: 75 }, ...totalHeaders.slice(2).map(() => ({ wch: 24 }))];
  utils.book_append_sheet(book, scope, 'Scope');
  return book;
}

export function createDashboardStemWorkbookBytes(options) {
  return write(buildDashboardStemWorkbook(options), { bookType: 'biff8', type: 'array', bookSST: true });
}

export const dashboardStemWorkbookInternals = Object.freeze({ MAX_DATA_ROWS_PER_SHEET, currencyTotals, splitRows });
