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

function numberCell(value, format = '#,##0.00') {
  const number = finiteNumber(value);
  return number != null ? { t: 'n', v: number, z: format } : textCell('Unavailable');
}

const BASE_HEADERS = ['STEM', 'Delivery / Expected Date', 'Date Source', 'Vessel', 'Buyer', 'Suppliers', 'Products / Quantities', 'Port', 'Country', 'Turnover', 'Gross Profit', 'Dispute'];
const FINANCE_HEADERS = ['Finance Cost', 'Bank Charge', 'EBIT', 'Evidence Status'];
const MONEY_HEADERS = new Set(['Turnover', 'Gross Profit', 'Finance Cost', 'Bank Charge', 'EBIT']);
const WIDE_HEADERS = new Set(['STEM', 'Buyer', 'Suppliers', 'Products / Quantities', 'Evidence Status']);
const joined = (values) => [...new Set(values.filter(Boolean).map(String))].join('; ');
const dated = (value) => value ? String(value).slice(0, 10) : '';
const currencyCode = (value) => /^[A-Z]{3}$/.test(String(value || '')) ? value : 'Unspecified';
// Labels may contain ranges; group each endpoint without rounding or touching product names.
const quantityLabel = (value) => String(value || '').replace(/\d[\d,]*(?:\.\d+)?/g, (amount) => {
  const [integer, fraction] = amount.replaceAll(',', '').split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction == null ? '' : `.${fraction}`);
});

function exportRowCells(row, includeFinanceCosts, commonCurrency) {
  const products = (row.productQuantities || []).map((item) => joined([item.productName, quantityLabel(item.quantityLabel)]));
  products.push(...(row.supplierProductRows || []).map((item) => joined([item.itemName, quantityLabel(item.quantityLabel)])));
  // Keep numeric cells usable for calculations, with unambiguous currencies in mixed reports.
  const moneyCell = (value) => numberCell(value, commonCurrency ? '#,##0.00' : `"${currencyCode(row.currency)}" #,##0.00`);
  const dispute = row.disputeStatus || (row.dispute ? 'Disputed' : 'No dispute');
  const cells = [
    textCell(row.name), textCell(dated(row.deliveryDate)),
    textCell(row.deliveryDateSource === 'delivery' ? 'Actual delivery' : row.deliveryDateSource === 'expected' ? 'Expected delivery' : ''),
    textCell(row.vessel?.name), textCell(row.account?.name), textCell(joined(row.supplierNames || [])),
    textCell(joined(products)), textCell(row.port?.name), textCell(row.port?.countryCode),
    moneyCell(row.buyer), moneyCell(row.netPnl), textCell(dispute),
  ];
  if (!includeFinanceCosts) return cells;
  const finance = row.finance;
  const complete = finance?.complete === true;
  const financeCost = finiteNumber(finance?.financeCost);
  const bankCharge = finiteNumber(finance?.bankCharge);
  const ebit = finiteNumber(finance?.ebit);
  const issues = joined([...(finance?.issues || []), ...(finance?.bankChargeIssues || [])]);
  const evidence = finance ? `${finance.status || (complete ? 'Complete' : 'Unavailable')}${issues ? `: ${issues}` : ''}` : 'Unavailable';
  cells.push(
    financeCost != null ? moneyCell(financeCost) : textCell('Unavailable'),
    finance?.bankChargeComplete === true && bankCharge != null ? moneyCell(bankCharge) : textCell('Unavailable'),
    complete && ebit != null ? moneyCell(ebit) : textCell('Unavailable'),
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
    const bankCharges = Object.entries(finance?.bankChargesUsd || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bank, amount]) => `${bank} USD ${finiteNumber(amount)?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? 'Unavailable'} per remittance`)
      .join('; ') || 'Unavailable';
    entries.push(
      ['Finance snapshot', `${finance?.annualInterestRatePct ?? 'Unavailable'}% annual; revision ${finance?.revision ?? 'Unavailable'}; calculated ${finance?.asOfDate ?? 'Unavailable'}; ${finance?.dayCountBasis || 'ACT/365'}`],
      ['Bank charge snapshot', bankCharges],
      ['Finance evidence complete', finance?.complete === true ? 'Yes' : 'No'],
      ['Finance methodology', 'Finance cost = sum of positive daily funded balances × annual rate ÷ 365 (Actual/365). Supplier payments increase funding, buyer receipts reduce it, same-day settlement costs zero, and open funding accrues through the calculation date.'],
      ['Bank charge methodology', 'EBIT = gross profit minus finance cost minus bank charge. Bank Charge combines supplier remittance fees and actual recorded buyer receipt charges, net of signed fee refunds. No default fee is applied to buyer receipts. Receipt charges do not reduce cash received a second time. One configured supplier fee per remittance is allocated across its full positive cash allocations, including STEMs outside this export. Signed credits reconcile the net wire without another fee. Standalone supplier payments incur one fee each. No foreign exchange rate is invented.'],
      ['Missing-data note', 'Finance totals cover verified STEMs only; compare counts. Unknown costs are never zero; bank or currency costs without evidence are withheld.'],
    );
    if (Array.isArray(finance?.warnings) && finance.warnings.length) entries.push(['Finance warnings', finance.warnings.join('; ')]);
  }
  return entries;
}

function currencyTotals(rows, includeFinanceCosts) {
  const totals = new Map();
  for (const row of rows) {
    const currency = String(row?.currency || 'Unspecified').toUpperCase();
    const item = totals.get(currency) || { currency, rowCount: 0, turnover: 0, grossProfit: 0, turnoverComplete: true, grossProfitComplete: true, financeCost: 0, bankCharge: 0, ebit: 0, financeComplete: true, verifiedStemCount: 0, verifiedGrossProfit: 0 };
    item.rowCount += 1;
    const turnover = finiteNumber(row?.buyer);
    const grossProfit = finiteNumber(row?.netPnl);
    if (turnover != null) item.turnover += turnover;
    else item.turnoverComplete = false;
    if (grossProfit != null) item.grossProfit += grossProfit;
    else item.grossProfitComplete = false;
    if (includeFinanceCosts) {
      const financeCost = finiteNumber(row?.finance?.financeCost);
      const bankCharge = finiteNumber(row?.finance?.bankCharge);
      const ebit = finiteNumber(row?.finance?.ebit);
      if (row?.finance?.complete !== true || row?.finance?.bankChargeComplete !== true || financeCost == null || bankCharge == null || ebit == null || grossProfit == null) item.financeComplete = false;
      else {
        item.verifiedStemCount += 1;
        item.verifiedGrossProfit += grossProfit;
        item.financeCost += financeCost;
        item.bankCharge += bankCharge;
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
  const currencies = [...new Set(rows.map((row) => currencyCode(row.currency)))];
  const commonCurrency = currencies.length === 1 ? currencies[0] : null;
  const displayHeaders = headers.map((header) => MONEY_HEADERS.has(header) && commonCurrency ? `${header} (${commonCurrency})` : header);
  const chunks = splitRows(rows);
  chunks.forEach((chunk, index) => {
    const sheet = utils.aoa_to_sheet([displayHeaders.map(textCell), ...chunk.map((row) => exportRowCells(row, includeFinanceCosts, commonCurrency))]);
    sheet['!cols'] = headers.map((header) => ({ wch: WIDE_HEADERS.has(header) ? 36 : 19 }));
    utils.book_append_sheet(book, sheet, chunks.length === 1 ? 'STEMs' : `STEMs ${index + 1}`);
  });
  const entries = scopeEntries({ filterPayload, scopeLabels, search, sort, matchingCount: rows.length, generatedAt, includeFinanceCosts, finance });
  const totalHeaders = ['Currency', 'Row Count', 'Turnover', 'Gross Profit', ...(includeFinanceCosts ? ['Verified STEMs', 'Verified Gross Profit', 'Verified Finance Cost', 'Verified Bank Charge', 'Verified EBIT', 'Evidence Complete'] : [])];
  const scope = utils.aoa_to_sheet([
    [textCell('Dashboard STEM Export Scope'), textCell('')],
    ...entries.map(([label, value]) => [textCell(label), textCell(value)]),
    [textCell('Currency totals'), textCell('Totals remain separated by currency.')],
    totalHeaders.map(textCell),
    ...currencyTotals(rows, includeFinanceCosts).map((total) => [
      textCell(total.currency), numberCell(total.rowCount, '#,##0'), total.turnoverComplete ? numberCell(total.turnover) : textCell('Unavailable'), total.grossProfitComplete ? numberCell(total.grossProfit) : textCell('Unavailable'),
      ...(includeFinanceCosts ? [
        numberCell(total.verifiedStemCount, '#,##0'),
        total.verifiedStemCount ? numberCell(total.verifiedGrossProfit) : textCell('Unavailable'),
        total.verifiedStemCount ? numberCell(total.financeCost) : textCell('Unavailable'),
        total.verifiedStemCount ? numberCell(total.bankCharge) : textCell('Unavailable'),
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
