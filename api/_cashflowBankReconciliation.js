import { createHash } from 'node:crypto';
import { sfQuery } from './_salesforce.js';
import { PAYMENT_DATA_RELIABLE_FROM } from '../src/lib/paymentDataReliability.js';

export const CASHFLOW_BANK_CODES = Object.freeze(['UBS', 'DBS', 'ISP']);
export const CASHFLOW_BANK_CURRENCIES = Object.freeze(['USD', 'EUR', 'HKD', 'CNY']);
export const CASHFLOW_BANK_MAX_CSV_BYTES = 2_000_000;

export const CASHFLOW_BANK_PROFILES = Object.freeze({
  UBS: Object.freeze({
    code: 'UBS',
    name: 'UBS',
    purpose: 'Day-to-day trading',
    currencies: Object.freeze(['USD', 'EUR']),
    notes: 'No HKD routing. USD and EUR trading flows may use UBS when it is the selected operating account.',
  }),
  DBS: Object.freeze({
    code: 'DBS',
    name: 'DBS',
    purpose: 'Trading and operations',
    currencies: Object.freeze(['USD', 'EUR', 'HKD', 'CNY']),
    notes: 'Supports trading flows plus general expenses and payroll. RMB is represented by ISO currency CNY.',
  }),
  ISP: Object.freeze({
    code: 'ISP',
    name: 'Intesa Sanpaolo',
    purpose: 'Treasury',
    currencies: Object.freeze(['USD', 'EUR', 'HKD', 'CNY']),
    notes: 'Reserved for reviewed fixed-term deposits and bank guarantees; it is not an automatic trading-flow route.',
  }),
});

const HEADER_ALIASES = Object.freeze({
  bookingDate: ['date', 'bookingdate', 'transactiondate', 'postingdate', 'bookdate'],
  valueDate: ['valuedate', 'valuedate'],
  currency: ['currency', 'ccy', 'currencycode'],
  amount: ['amount', 'transactionamount', 'netamount'],
  debit: ['debit', 'debitamount', 'withdrawal', 'moneyout'],
  credit: ['credit', 'creditamount', 'deposit', 'moneyin'],
  reference: ['reference', 'transactionreference', 'paymentreference', 'bankreference', 'transactionid'],
  description: ['description', 'narrative', 'details', 'memo', 'transactiondescription', 'counterparty'],
  runningBalance: ['balance', 'runningbalance', 'closingbalance', 'accountbalance'],
});

function bankError(message, status = 400, code = 'CASHFLOW_BANK_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function hash(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const source = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    const parsed = new Date(`${source}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== source ? null : source;
  }
  const match = source.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

function daysBetween(left, right) {
  const a = dateOnly(left);
  const b = dateOnly(right);
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T00:00:00.000Z`) - new Date(`${a}T00:00:00.000Z`)) / 86_400_000);
}

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function chooseDelimiter(source) {
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const candidates = [',', '\t', ';'];
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length - 1 }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ',';
}

function parseDelimited(source, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') {
      if (cell) throw bankError('A quote may begin only at the start of a bank-statement field.', 400, 'CASHFLOW_BANK_CSV_INVALID');
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw bankError('The bank statement has an unclosed quoted field.', 400, 'CASHFLOW_BANK_CSV_INVALID');
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => String(value).trim()));
}

function resolveColumns(headers) {
  const normalized = headers.map(normalizeHeader);
  const result = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) result[field] = index;
  }
  if (result.bookingDate == null) throw bankError('The bank statement needs a Date, Booking Date, Transaction Date, or Posting Date column.', 400, 'CASHFLOW_BANK_CSV_COLUMNS');
  if (result.amount == null && result.debit == null && result.credit == null) {
    throw bankError('The bank statement needs Amount, or separate Debit and Credit columns.', 400, 'CASHFLOW_BANK_CSV_COLUMNS');
  }
  return result;
}

function parseNumber(value, { allowBlank = true } = {}) {
  const original = String(value ?? '').trim();
  if (!original) {
    if (allowBlank) return null;
    throw bankError('A bank-statement amount is blank.', 400, 'CASHFLOW_BANK_CSV_AMOUNT');
  }
  const negative = /^\(.*\)$/.test(original) || /(?:^|\s)(?:DR|DEBIT)$/i.test(original);
  const positive = /(?:^|\s)(?:CR|CREDIT)$/i.test(original);
  const cleaned = original
    .replace(/[()]/g, '')
    .replace(/(?:DR|CR|DEBIT|CREDIT)$/i, '')
    .replace(/[A-Z]{3}\s*/gi, '')
    .replace(/\s/g, '')
    .replace(/,/g, '');
  const number = Number(cleaned);
  if (!Number.isFinite(number)) throw bankError(`Invalid bank-statement amount: ${original}`, 400, 'CASHFLOW_BANK_CSV_AMOUNT');
  if (negative) return -Math.abs(number);
  if (positive) return Math.abs(number);
  return number;
}

function rowAmount(row, columns) {
  if (columns.amount != null) return parseNumber(row[columns.amount], { allowBlank: false });
  const debit = parseNumber(columns.debit == null ? null : row[columns.debit]);
  const credit = parseNumber(columns.credit == null ? null : row[columns.credit]);
  if (debit != null && credit != null && Math.abs(debit) > 0 && Math.abs(credit) > 0) {
    throw bankError('A bank-statement row cannot contain both Debit and Credit.', 400, 'CASHFLOW_BANK_CSV_AMOUNT');
  }
  if (credit != null && Math.abs(credit) > 0) return Math.abs(credit);
  if (debit != null && Math.abs(debit) > 0) return -Math.abs(debit);
  throw bankError('A bank-statement row has no non-zero Debit or Credit.', 400, 'CASHFLOW_BANK_CSV_AMOUNT');
}

export function normalizeCashflowBankCode(value) {
  const normalized = text(value, 80).toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  if (normalized.includes('INTESA') || normalized === 'ISP') return 'ISP';
  if (normalized.includes('UBS')) return 'UBS';
  if (normalized.includes('DBS')) return 'DBS';
  return null;
}

export function cashflowBankCurrencyAllowed(bankCode, currency) {
  const profile = CASHFLOW_BANK_PROFILES[normalizeCashflowBankCode(bankCode)];
  return Boolean(profile?.currencies.includes(text(currency, 3).toUpperCase()));
}

export function parseCashflowBankStatementCsv(csvText, account = {}) {
  const source = String(csvText ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!source.trim()) throw bankError('The bank statement is empty.', 400, 'CASHFLOW_BANK_CSV_EMPTY');
  if (Buffer.byteLength(source, 'utf8') > CASHFLOW_BANK_MAX_CSV_BYTES) {
    throw bankError('The bank statement must be smaller than 2 MB.', 413, 'CASHFLOW_BANK_CSV_TOO_LARGE');
  }
  const bankCode = normalizeCashflowBankCode(account.bankCode || account.bank_code);
  const accountCurrency = text(account.currency, 3).toUpperCase();
  if (!bankCode || !cashflowBankCurrencyAllowed(bankCode, accountCurrency)) {
    throw bankError('The selected bank account has an unsupported bank or currency.', 409, 'CASHFLOW_BANK_ACCOUNT_INVALID');
  }
  const records = parseDelimited(source, chooseDelimiter(source));
  if (records.length < 2) throw bankError('The bank statement has no transaction rows.', 400, 'CASHFLOW_BANK_CSV_EMPTY');
  const columns = resolveColumns(records[0]);
  const occurrences = new Map();
  const rows = [];
  for (const [rowIndex, values] of records.slice(1).entries()) {
    const bookingDate = dateOnly(values[columns.bookingDate]);
    if (!bookingDate) throw bankError(`Row ${rowIndex + 2} has an invalid booking date. Use YYYY-MM-DD or DD/MM/YYYY.`, 400, 'CASHFLOW_BANK_CSV_DATE');
    const valueDate = columns.valueDate == null || !text(values[columns.valueDate]) ? null : dateOnly(values[columns.valueDate]);
    if (columns.valueDate != null && text(values[columns.valueDate]) && !valueDate) {
      throw bankError(`Row ${rowIndex + 2} has an invalid value date.`, 400, 'CASHFLOW_BANK_CSV_DATE');
    }
    const currency = text(columns.currency == null ? accountCurrency : values[columns.currency], 3).toUpperCase() || accountCurrency;
    if (currency !== accountCurrency) throw bankError(`Row ${rowIndex + 2} uses ${currency}; the selected account is ${accountCurrency}.`, 400, 'CASHFLOW_BANK_CURRENCY_MISMATCH');
    const amount = rowAmount(values, columns);
    if (Math.abs(amount) < 0.000001) throw bankError(`Row ${rowIndex + 2} has a zero amount.`, 400, 'CASHFLOW_BANK_CSV_AMOUNT');
    const reference = text(columns.reference == null ? '' : values[columns.reference], 500);
    const description = text(columns.description == null ? '' : values[columns.description], 1000);
    const runningBalance = columns.runningBalance == null ? null : parseNumber(values[columns.runningBalance]);
    const identity = JSON.stringify({ bookingDate, valueDate, amount, currency, reference, description, runningBalance });
    const occurrence = Number(occurrences.get(identity) || 0) + 1;
    occurrences.set(identity, occurrence);
    rows.push({
      bookingDate,
      valueDate,
      amount,
      currency,
      reference,
      description,
      runningBalance,
      entryHash: hash(`${identity}:${occurrence}`),
    });
  }
  rows.sort((left, right) => left.bookingDate.localeCompare(right.bookingDate) || left.entryHash.localeCompare(right.entryHash));
  return {
    sourceHash: hash(source),
    bankCode,
    currency: accountCurrency,
    statementFrom: rows[0].bookingDate,
    statementTo: rows.at(-1).bookingDate,
    rows,
    summary: {
      rowCount: rows.length,
      credits: rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0),
      debits: rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0),
      closingBalance: [...rows].reverse().find((row) => row.runningBalance != null)?.runningBalance ?? null,
    },
  };
}

function serializeAccount(row) {
  return {
    id: row.id,
    bankCode: row.bank_code,
    bankName: CASHFLOW_BANK_PROFILES[row.bank_code]?.name || row.bank_code,
    accountLabel: row.account_label,
    currency: row.currency,
    purpose: row.purpose,
    xeroBankAccountId: row.xero_bank_account_id || null,
    xeroBankAccountName: row.xero_bank_account_name || null,
    isDefaultOperating: row.is_default_operating === true,
    enabled: row.enabled !== false,
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at || null,
    updatedByEmail: row.updated_by_email || null,
  };
}

function serializeBalance(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    balanceDate: row.balance_date,
    availableBalance: Number(row.available_balance),
    ledgerBalance: row.ledger_balance == null ? null : Number(row.ledger_balance),
    source: row.source,
    note: row.note || null,
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at || null,
    updatedByEmail: row.updated_by_email || null,
  };
}

function serializeInstrument(row) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    instrumentType: row.instrument_type,
    reference: row.reference,
    amount: Number(row.amount),
    expectedInterest: Number(row.expected_interest || 0),
    startDate: row.start_date,
    maturityDate: row.maturity_date || null,
    tenor: row.tenor || null,
    status: row.status,
    rolloverExpected: row.rollover_expected === true,
    note: row.note || null,
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at || null,
    updatedByEmail: row.updated_by_email || null,
  };
}

function serializePlannedMovement(row) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    category: row.category,
    description: row.description,
    direction: row.direction,
    amount: Number(row.amount),
    startDate: row.start_date,
    recurrence: row.recurrence,
    endDate: row.end_date || null,
    enabled: row.enabled !== false,
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at || null,
    updatedByEmail: row.updated_by_email || null,
  };
}

function serializeEntry(row) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    importId: row.import_id,
    bookingDate: row.booking_date,
    valueDate: row.value_date || null,
    amount: Number(row.amount),
    currency: row.currency,
    reference: row.reference || null,
    description: row.description || null,
    runningBalance: row.running_balance == null ? null : Number(row.running_balance),
  };
}

function serializeMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    statementEntryId: row.statement_entry_id,
    status: row.match_status,
    salesforcePaymentId: row.salesforce_payment_id || null,
    salesforcePaymentName: row.salesforce_payment_name || null,
    reason: row.reason || null,
    revision: Number(row.revision || 0),
    reviewedByEmail: row.reviewed_by_email || null,
    reviewedAt: row.reviewed_at || null,
  };
}

function normalizePayment(row) {
  const direction = String(row.RecordType?.DeveloperName || '').toLowerCase() === 'receivable' ? 'inflow'
    : String(row.RecordType?.DeveloperName || '').toLowerCase() === 'payable' ? 'outflow' : null;
  return {
    id: row.Id,
    name: row.Name || row.Id,
    direction,
    stemId: row.STEM__c || null,
    supplierInvoiceId: row.Supplier_Invoice__c || null,
    date: dateOnly(row.Date__c),
    amount: Math.abs(Number(row.Amount__c || 0)),
    currency: row.CurrencyIsoCode || 'USD',
    bankCode: normalizeCashflowBankCode(row.Bank__c),
    reference: text(row.Reference__c || '', 500),
  };
}

export async function loadCashflowRecordedPayments(dateFrom, dateTo) {
  const reliableFrom = String(dateFrom || '') < PAYMENT_DATA_RELIABLE_FROM ? PAYMENT_DATA_RELIABLE_FROM : dateFrom;
  const result = await sfQuery(`
    SELECT Id, Name, RecordType.DeveloperName, STEM__c, Supplier_Invoice__c,
           Amount__c, Date__c, Bank__c, Reference__c
      FROM Payment__c
     WHERE Date__c >= ${reliableFrom}
       AND Date__c <= ${dateTo}
       AND RecordType.DeveloperName IN ('Receivable','Payable')
       AND Is_Deposit__c = false
       AND Commission_Invoice__c = null
       AND Is_Volume_Discount__c = false
     ORDER BY Date__c, Id`, { clean: true, limit: 100000 });
  return (result.records || []).map(normalizePayment).filter((row) => row.direction && row.date && row.amount > 0);
}

function matchScore(entry, payment, bankCode) {
  if (entry.currency !== payment.currency) return null;
  if ((entry.amount > 0 ? 'inflow' : 'outflow') !== payment.direction) return null;
  if (Math.abs(Math.abs(entry.amount) - payment.amount) > 0.01) return null;
  if (payment.bankCode && payment.bankCode !== bankCode) return null;
  const bookingDifference = Math.abs(daysBetween(entry.bookingDate, payment.date));
  const valueDifference = entry.valueDate ? Math.abs(daysBetween(entry.valueDate, payment.date)) : null;
  const dateDifference = Math.min(bookingDifference, valueDifference == null ? bookingDifference : valueDifference);
  if (!Number.isFinite(dateDifference) || dateDifference > 2) return null;
  const evidence = `${entry.reference || ''} ${entry.description || ''}`.toLowerCase();
  const referenceMatch = [payment.name, payment.reference].filter(Boolean).some((value) => evidence.includes(String(value).toLowerCase()));
  return 50 + (dateDifference === 0 ? 30 : dateDifference === 1 ? 20 : 10) + (referenceMatch ? 20 : 0) + (payment.bankCode === bankCode ? 5 : 0);
}

export function reconcileCashflowBankEntries(entries, payments, accounts, savedMatches = []) {
  const accountMap = new Map(accounts.map((row) => [row.id, row]));
  const savedMap = new Map(savedMatches.map((row) => [row.statementEntryId, row]));
  return entries.map((entry) => {
    const account = accountMap.get(entry.bankAccountId);
    const saved = savedMap.get(entry.id) || null;
    const candidates = payments
      .map((payment) => ({ payment, score: matchScore(entry, payment, account?.bankCode) }))
      .filter((candidate) => candidate.score != null)
      .sort((left, right) => right.score - left.score || left.payment.id.localeCompare(right.payment.id));
    const best = candidates[0] || null;
    const uniqueBest = best && (!candidates[1] || candidates[1].score < best.score);
    const automaticStatus = !best ? 'unmatched' : uniqueBest ? 'suggested' : 'ambiguous';
    return {
      ...entry,
      accountLabel: account?.accountLabel || null,
      bankCode: account?.bankCode || null,
      savedMatch: saved,
      reconciliationStatus: saved?.status || automaticStatus,
      suggestedPayment: uniqueBest ? best.payment : null,
      suggestionScore: uniqueBest ? best.score : null,
      candidateCount: candidates.length,
    };
  });
}

function latestBalanceByAccount(rows) {
  const result = new Map();
  for (const row of rows) {
    const current = result.get(row.bank_account_id);
    if (!current || row.balance_date > current.balance_date) result.set(row.bank_account_id, row);
  }
  return result;
}

function projectionForAccount(account, balance, entries, forecastRows, instruments, plannedOccurrences, dateTo) {
  const startDate = balance?.balanceDate || null;
  const actualMovement = startDate == null ? 0 : entries
    .filter((row) => row.bankAccountId === account.id && row.bookingDate > startDate && row.bookingDate <= dateTo)
    .reduce((sum, row) => sum + row.amount, 0);
  const forecastMovement = startDate == null || !account.isDefaultOperating ? 0 : forecastRows
    .filter((row) => row.currency === account.currency && row.forecastDate > startDate && row.forecastDate <= dateTo)
    .reduce((sum, row) => sum + (row.direction === 'inflow' ? Number(row.amount || 0) : -Number(row.amount || 0)), 0);
  const instrumentMovement = startDate == null ? 0 : instruments.reduce((sum, row) => {
    if (row.bankAccountId !== account.id || ['cancelled', 'released', 'called'].includes(row.status) || row.instrumentType !== 'term_deposit') return sum;
    let movement = sum;
    if (row.startDate > startDate && row.startDate <= dateTo) movement -= row.amount;
    if (row.maturityDate && row.maturityDate > startDate && row.maturityDate <= dateTo && !row.rolloverExpected) movement += row.amount + row.expectedInterest;
    return movement;
  }, 0);
  const plannedMovement = startDate == null ? 0 : plannedOccurrences
    .filter((row) => row.bankAccountId === account.id && row.date > startDate && row.date <= dateTo)
    .reduce((sum, row) => sum + (row.direction === 'inflow' ? row.amount : -row.amount), 0);
  const guaranteeReserve = instruments
    .filter((row) => row.bankAccountId === account.id && row.instrumentType === 'bank_guarantee' && ['planned', 'active'].includes(row.status) && row.startDate <= dateTo && (!row.maturityDate || row.maturityDate >= dateTo))
    .reduce((sum, row) => sum + row.amount, 0);
  const openingAvailable = balance?.availableBalance ?? null;
  const projectedBalance = openingAvailable == null ? null : openingAvailable + actualMovement + forecastMovement + instrumentMovement + plannedMovement;
  return {
    startDate,
    openingAvailable,
    actualMovement,
    forecastMovement,
    instrumentMovement,
    plannedMovement,
    guaranteeReserve,
    projectedBalance,
    projectedAvailableLiquidity: projectedBalance == null ? null : projectedBalance - guaranteeReserve,
  };
}

function nextMonthlyDate(date, targetDay) {
  const current = new Date(`${date}T00:00:00.000Z`);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year + Math.floor(month / 12)).padStart(4, '0')}-${String((month % 12) + 1).padStart(2, '0')}-${String(Math.min(targetDay, lastDay)).padStart(2, '0')}`;
}

export function expandCashflowPlannedMovements(rows, dateFrom, dateTo) {
  const from = dateOnly(dateFrom);
  const to = dateOnly(dateTo);
  if (!from || !to || from > to) return [];
  const occurrences = [];
  for (const row of rows.filter((item) => item.enabled !== false)) {
    let date = row.startDate;
    const targetDay = Number(String(row.startDate).slice(8, 10));
    const end = row.endDate && row.endDate < to ? row.endDate : to;
    let guard = 0;
    while (date && date <= end && guard < 600) {
      if (date >= from) occurrences.push({
        id: `${row.id}:${date}`,
        plannedMovementId: row.id,
        bankAccountId: row.bankAccountId,
        category: row.category,
        description: row.description,
        direction: row.direction,
        amount: row.amount,
        date,
      });
      if (row.recurrence === 'one_off') break;
      if (row.recurrence === 'weekly') {
        const next = new Date(`${date}T00:00:00.000Z`);
        next.setUTCDate(next.getUTCDate() + 7);
        date = next.toISOString().slice(0, 10);
      } else date = nextMonthlyDate(date, targetDay);
      guard += 1;
    }
  }
  return occurrences.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

export async function loadCashflowBankOverview({ client, dateFrom, dateTo, forecastRows = [], payments = null }) {
  const entryFrom = dateOnly(dateFrom) || dateOnly(new Date());
  const entryTo = dateOnly(dateTo) || entryFrom;
  const [accountResult, balanceResult, importResult, entryResult, matchResult, instrumentResult, plannedResult, recordedPayments] = await Promise.all([
    client.from('cashflow_bank_accounts').select('*').order('bank_code').order('currency').order('account_label'),
    client.from('cashflow_bank_balance_snapshots').select('*').lte('balance_date', entryTo).order('balance_date', { ascending: false }),
    client.from('cashflow_bank_statement_imports').select('*').order('imported_at', { ascending: false }).limit(30),
    client.from('cashflow_bank_statement_entries').select('*').gte('booking_date', entryFrom).lte('booking_date', entryTo).order('booking_date', { ascending: false }).limit(5000),
    client.from('cashflow_bank_matches').select('*').order('reviewed_at', { ascending: false }).limit(5000),
    client.from('cashflow_liquidity_instruments').select('*').order('start_date', { ascending: true }),
    client.from('cashflow_bank_planned_movements').select('*').order('start_date', { ascending: true }),
    payments || loadCashflowRecordedPayments(entryFrom, entryTo),
  ]);
  for (const result of [accountResult, balanceResult, importResult, entryResult, matchResult, instrumentResult, plannedResult]) {
    if (result.error) throw bankError(`Bank reconciliation storage is unavailable: ${result.error.message}`, 503, 'CASHFLOW_BANK_STORAGE_UNAVAILABLE');
  }
  const accounts = (accountResult.data || []).map(serializeAccount);
  const balanceIndex = latestBalanceByAccount(balanceResult.data || []);
  const balances = [...balanceIndex.values()].map(serializeBalance);
  const entries = (entryResult.data || []).map(serializeEntry);
  const matches = (matchResult.data || []).map(serializeMatch);
  const instruments = (instrumentResult.data || []).map(serializeInstrument);
  const plannedMovements = (plannedResult.data || []).map(serializePlannedMovement);
  const plannedOccurrences = expandCashflowPlannedMovements(plannedMovements, entryFrom, entryTo);
  const reconciledEntries = reconcileCashflowBankEntries(entries, recordedPayments, accounts, matches);
  const projections = accounts.filter((row) => row.enabled).map((account) => ({
    account,
    balance: balances.find((row) => row.bankAccountId === account.id) || null,
    projection: projectionForAccount(account, balances.find((row) => row.bankAccountId === account.id) || null, entries, forecastRows, instruments, plannedOccurrences, entryTo),
  }));
  const currencyRouting = Object.fromEntries(CASHFLOW_BANK_CURRENCIES.map((currency) => {
    const candidates = accounts.filter((row) => row.enabled && row.currency === currency && row.isDefaultOperating);
    return [currency, candidates.length === 1 ? candidates[0].id : null];
  }));
  const unallocatedForecast = forecastRows.filter((row) => !currencyRouting[row.currency]);
  return {
    profiles: Object.values(CASHFLOW_BANK_PROFILES),
    accounts,
    balances,
    imports: (importResult.data || []).map((row) => ({
      id: row.id,
      bankAccountId: row.bank_account_id,
      sourceFileName: row.source_file_name,
      statementFrom: row.statement_from,
      statementTo: row.statement_to,
      rowCount: Number(row.row_count || 0),
      duplicateRowCount: Number(row.duplicate_row_count || 0),
      importedAt: row.imported_at,
      importedByEmail: row.imported_by_email || null,
    })),
    entries: reconciledEntries,
    instruments,
    plannedMovements,
    plannedOccurrences,
    payments: recordedPayments,
    projections,
    currencyRouting,
    summary: {
      importedEntries: entries.length,
      confirmed: reconciledEntries.filter((row) => row.reconciliationStatus === 'confirmed').length,
      suggested: reconciledEntries.filter((row) => row.reconciliationStatus === 'suggested').length,
      ambiguous: reconciledEntries.filter((row) => row.reconciliationStatus === 'ambiguous').length,
      unmatched: reconciledEntries.filter((row) => row.reconciliationStatus === 'unmatched').length,
      dismissed: reconciledEntries.filter((row) => row.reconciliationStatus === 'dismissed').length,
      unallocatedForecastRows: unallocatedForecast.length,
      unallocatedForecastByCurrency: Object.fromEntries(CASHFLOW_BANK_CURRENCIES.map((currency) => [currency, unallocatedForecast.filter((row) => row.currency === currency).length])),
    },
  };
}

function actor(context) {
  return { id: context.profile?.id || null, email: context.profile?.email || null };
}

export async function saveCashflowBankAccount(body, context) {
  const bankCode = normalizeCashflowBankCode(body.bankCode);
  const currency = text(body.currency, 3).toUpperCase();
  if (!bankCode || !cashflowBankCurrencyAllowed(bankCode, currency)) throw bankError('Choose a supported bank and currency.');
  const purpose = bankCode === 'ISP' ? 'treasury' : bankCode === 'DBS' ? 'trading_operations' : 'trading';
  const currentActor = actor(context);
  const { data, error } = await context.client.rpc('save_cashflow_bank_account_v1', {
    p_id: body.id || null,
    p_bank_code: bankCode,
    p_account_label: text(body.accountLabel, 160),
    p_currency: currency,
    p_purpose: purpose,
    p_xero_bank_account_id: text(body.xeroBankAccountId, 160) || null,
    p_xero_bank_account_name: text(body.xeroBankAccountName, 255) || null,
    p_is_default_operating: body.isDefaultOperating === true && bankCode !== 'ISP',
    p_enabled: body.enabled !== false,
    p_expected_revision: body.revision == null ? null : Number(body.revision),
    p_actor_id: currentActor.id,
    p_actor_email: currentActor.email,
  });
  if (error) throw bankError(error.message, /changed after/i.test(error.message) ? 409 : 400, 'CASHFLOW_BANK_ACCOUNT_SAVE_FAILED');
  return { account: serializeAccount(data) };
}

export async function saveCashflowBankBalance(body, context) {
  const currentActor = actor(context);
  const available = Number(body.availableBalance);
  const ledger = body.ledgerBalance == null || body.ledgerBalance === '' ? null : Number(body.ledgerBalance);
  if (!body.bankAccountId || !dateOnly(body.balanceDate) || !Number.isFinite(available) || (ledger != null && !Number.isFinite(ledger))) {
    throw bankError('Choose an account and enter a valid balance date and amounts.');
  }
  const { data, error } = await context.client.rpc('save_cashflow_bank_balance_v1', {
    p_id: body.id || null,
    p_bank_account_id: body.bankAccountId,
    p_balance_date: dateOnly(body.balanceDate),
    p_available_balance: available,
    p_ledger_balance: ledger,
    p_note: text(body.note, 1000) || null,
    p_expected_revision: body.revision == null ? null : Number(body.revision),
    p_actor_id: currentActor.id,
    p_actor_email: currentActor.email,
  });
  if (error) throw bankError(error.message, /changed after/i.test(error.message) ? 409 : 400, 'CASHFLOW_BANK_BALANCE_SAVE_FAILED');
  return { balance: serializeBalance(data) };
}

async function bankAccountById(client, id) {
  const { data, error } = await client.from('cashflow_bank_accounts').select('*').eq('id', id).maybeSingle();
  if (error) throw bankError(error.message, 503, 'CASHFLOW_BANK_STORAGE_UNAVAILABLE');
  if (!data || data.enabled === false) throw bankError('Choose an active configured bank account.', 409, 'CASHFLOW_BANK_ACCOUNT_REQUIRED');
  return serializeAccount(data);
}

export async function previewCashflowBankStatement(body, context) {
  const account = await bankAccountById(context.client, body.bankAccountId);
  return { account, preview: parseCashflowBankStatementCsv(body.csvText, account) };
}

export async function importCashflowBankStatement(body, context) {
  const account = await bankAccountById(context.client, body.bankAccountId);
  const preview = parseCashflowBankStatementCsv(body.csvText, account);
  if (!body.expectedSourceHash || body.expectedSourceHash !== preview.sourceHash) {
    throw bankError('The statement changed after preview. Preview the file again before importing.', 409, 'CASHFLOW_BANK_STATEMENT_CHANGED');
  }
  const currentActor = actor(context);
  const { data, error } = await context.client.rpc('import_cashflow_bank_statement_v1', {
    p_bank_account_id: account.id,
    p_source_file_name: text(body.sourceFileName, 255) || 'bank-statement.csv',
    p_source_hash: preview.sourceHash,
    p_rows: preview.rows,
    p_actor_id: currentActor.id,
    p_actor_email: currentActor.email,
  });
  if (error) throw bankError(error.message, 400, 'CASHFLOW_BANK_STATEMENT_IMPORT_FAILED');
  return { account, preview: { ...preview, rows: undefined }, result: data };
}

export async function saveCashflowBankMatch(body, context) {
  const { data: entryRow, error: entryError } = await context.client.from('cashflow_bank_statement_entries').select('*').eq('id', body.statementEntryId).maybeSingle();
  if (entryError) throw bankError(entryError.message, 503, 'CASHFLOW_BANK_STORAGE_UNAVAILABLE');
  if (!entryRow) throw bankError('The bank entry no longer exists.', 404, 'CASHFLOW_BANK_ENTRY_NOT_FOUND');
  const entry = serializeEntry(entryRow);
  const account = await bankAccountById(context.client, entry.bankAccountId);
  const status = body.status === 'dismissed' ? 'dismissed' : 'confirmed';
  const reason = text(body.reason, 1000);
  let payment = null;
  if (status === 'confirmed') {
    if (!/^a\w{14,17}$/i.test(String(body.salesforcePaymentId || ''))) throw bankError('Choose an exact Salesforce Payment.');
    const result = await sfQuery(`SELECT Id, Name, RecordType.DeveloperName, STEM__c, Supplier_Invoice__c, Amount__c, Date__c, Bank__c, Reference__c FROM Payment__c WHERE Id = '${String(body.salesforcePaymentId).replaceAll("'", "\\'")}' LIMIT 1`, { clean: true, limit: 1 });
    payment = result.records?.[0] ? normalizePayment(result.records[0]) : null;
    if (!payment) throw bankError('The Salesforce Payment could not be re-read.', 409, 'CASHFLOW_BANK_PAYMENT_NOT_FOUND');
    const score = matchScore(entry, payment, account.bankCode);
    if (score == null) throw bankError('The selected Salesforce Payment does not match this bank, currency, direction, amount, and two-day date window.', 409, 'CASHFLOW_BANK_PAYMENT_MISMATCH');
  } else if (reason.length < 5) throw bankError('Enter a reason of at least 5 characters when dismissing an entry.');
  const currentActor = actor(context);
  const { data, error } = await context.client.rpc('save_cashflow_bank_match_v1', {
    p_statement_entry_id: entry.id,
    p_match_status: status,
    p_salesforce_payment_id: payment?.id || null,
    p_salesforce_payment_name: payment?.name || null,
    p_reason: reason || null,
    p_expected_revision: body.revision == null ? null : Number(body.revision),
    p_actor_id: currentActor.id,
    p_actor_email: currentActor.email,
  });
  if (error) throw bankError(error.message, /changed after/i.test(error.message) ? 409 : 400, 'CASHFLOW_BANK_MATCH_SAVE_FAILED');
  return { match: serializeMatch(data) };
}

export async function saveCashflowLiquidityInstrument(body, context) {
  const account = await bankAccountById(context.client, body.bankAccountId);
  if (account.bankCode !== 'ISP') throw bankError('Fixed-term deposits and bank guarantees must use a configured Intesa Sanpaolo account.', 409, 'CASHFLOW_BANK_ISP_REQUIRED');
  const instrumentType = body.instrumentType === 'bank_guarantee' ? 'bank_guarantee' : 'term_deposit';
  const amount = Number(body.amount);
  const interest = Number(body.expectedInterest || 0);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(interest) || interest < 0) throw bankError('Enter valid positive instrument amounts.');
  const currentActor = actor(context);
  const { data, error } = await context.client.rpc('save_cashflow_liquidity_instrument_v1', {
    p_id: body.id || null,
    p_bank_account_id: account.id,
    p_instrument_type: instrumentType,
    p_reference: text(body.reference, 255),
    p_amount: amount,
    p_expected_interest: instrumentType === 'term_deposit' ? interest : 0,
    p_start_date: dateOnly(body.startDate),
    p_maturity_date: dateOnly(body.maturityDate),
    p_tenor: instrumentType === 'term_deposit' ? text(body.tenor, 20) || 'custom' : null,
    p_status: text(body.status, 20) || 'active',
    p_rollover_expected: instrumentType === 'term_deposit' && body.rolloverExpected === true,
    p_note: text(body.note, 1000) || null,
    p_expected_revision: body.revision == null ? null : Number(body.revision),
    p_actor_id: currentActor.id,
    p_actor_email: currentActor.email,
  });
  if (error) throw bankError(error.message, /changed after/i.test(error.message) ? 409 : 400, 'CASHFLOW_BANK_INSTRUMENT_SAVE_FAILED');
  return { instrument: serializeInstrument(data) };
}

export async function saveCashflowPlannedMovement(body, context) {
  const account = await bankAccountById(context.client, body.bankAccountId);
  if (account.bankCode === 'ISP') throw bankError('Planned operating cash must use UBS or DBS. Use the treasury instrument register for Intesa Sanpaolo.', 409, 'CASHFLOW_BANK_OPERATING_ACCOUNT_REQUIRED');
  const category = ['general_expense', 'payroll', 'tax', 'bank_fee', 'other'].includes(body.category) ? body.category : 'other';
  const direction = body.direction === 'inflow' ? 'inflow' : 'outflow';
  const recurrence = ['one_off', 'weekly', 'monthly'].includes(body.recurrence) ? body.recurrence : 'one_off';
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !dateOnly(body.startDate) || !text(body.description, 500)) {
    throw bankError('Enter a description, positive amount, and valid start date.');
  }
  if (body.endDate && (!dateOnly(body.endDate) || dateOnly(body.endDate) < dateOnly(body.startDate))) {
    throw bankError('The optional end date cannot be before the start date.');
  }
  const currentActor = actor(context);
  const { data, error } = await context.client.rpc('save_cashflow_bank_planned_movement_v1', {
    p_id: body.id || null,
    p_bank_account_id: account.id,
    p_category: category,
    p_description: text(body.description, 500),
    p_direction: direction,
    p_amount: amount,
    p_start_date: dateOnly(body.startDate),
    p_recurrence: recurrence,
    p_end_date: body.endDate ? dateOnly(body.endDate) : null,
    p_enabled: body.enabled !== false,
    p_expected_revision: body.revision == null ? null : Number(body.revision),
    p_actor_id: currentActor.id,
    p_actor_email: currentActor.email,
  });
  if (error) throw bankError(error.message, /changed after/i.test(error.message) ? 409 : 400, 'CASHFLOW_BANK_PLANNED_SAVE_FAILED');
  return { plannedMovement: serializePlannedMovement(data) };
}
