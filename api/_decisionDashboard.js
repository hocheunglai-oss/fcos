// Pure contracts for the decision dashboard.  Financial values are deliberately
// keyed by ISO currency: callers must never collapse these buckets without an
// explicit, audited FX policy.

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export const SALESFORCE_CORPORATE_CURRENCY = 'USD';

export function isDecisionDashboardSalesforceId(value) {
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(String(value || ''));
}

export function dashboardCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return currency || SALESFORCE_CORPORATE_CURRENCY;
}

export function normalizeDecisionDashboardFilters(input = {}) {
  const ids = (value) => {
    const output = [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))].sort();
    if (output.some((item) => !isDecisionDashboardSalesforceId(item))) throw new Error('Dashboard ID filters must contain valid Salesforce IDs.');
    return output;
  };
  const text = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))].sort();
  return {
    accountIds: ids(input.accountIds || input.accounts),
    portIds: ids(input.portIds || input.ports),
    countryCodes: [...new Set(text(input.countryCodes || input.countries).map((value) => value.toUpperCase()))].sort(),
    supplierIds: ids(input.supplierIds || input.suppliers),
    includeCancelled: input.includeCancelled === true,
  };
}

function dashboardChildRowOrder(left, right) {
  return String(left?.createdDate || '').localeCompare(String(right?.createdDate || ''))
    || String(left?.sourceId || '').localeCompare(String(right?.sourceId || ''));
}

export function dashboardSupplierProductRows({ lineItems = [], extraCosts = [] } = {}) {
  const activeLines = (Array.isArray(lineItems) ? lineItems : [])
    .filter((item) => item?.cancelled !== true)
    .map((item) => ({
      sourceType: 'line_item',
      sourceId: item?.sourceId || null,
      createdDate: item?.createdDate || null,
      supplierAccount: item?.supplierAccountId
        ? { id: item.supplierAccountId, name: String(item?.supplierName || '').trim() || null }
        : null,
      itemName: String(item?.itemName || '').trim() || 'Product unavailable',
      quantityLabel: String(item?.quantityLabel || '').trim() || null,
      unitOfMeasure: String(item?.unitOfMeasure || '').trim() || null,
    }))
    .sort(dashboardChildRowOrder);
  const productSupplierIds = new Set(activeLines.map((item) => item.supplierAccount?.id).filter(Boolean));
  const visibleExtraCosts = (Array.isArray(extraCosts) ? extraCosts : [])
    .filter((item) => item?.cancelled !== true)
    .filter((item) => item?.supplierAccountId && !productSupplierIds.has(item.supplierAccountId))
    .map((item) => ({
      sourceType: 'extra_cost',
      sourceId: item?.sourceId || null,
      createdDate: item?.createdDate || null,
      supplierAccount: item?.supplierAccountId
        ? { id: item.supplierAccountId, name: String(item?.supplierName || '').trim() || null }
        : null,
      itemName: String(item?.chargeProductName || item?.description || item?.recordName || '').trim() || 'Extra cost unavailable',
      quantityLabel: null,
      unitOfMeasure: null,
    }))
    .sort(dashboardChildRowOrder);
  return [...activeLines, ...visibleExtraCosts].map(({ createdDate, ...item }) => item);
}

export function decisionDashboardSupplierAmount({
  invoicedSupplierAmount = 0,
  lineBuyAmount = 0,
  uninvoicedLineBuyAmount = 0,
  hasSupplierInvoice = false,
  uninvoicedExtraBuyAmount = 0,
  invoicedExtraBuyAmount = 0,
  sellOnlyUninvoicedExtraSellAmount = 0,
  qlikSupplierCost = null,
} = {}) {
  const uninvoicedExtra = finite(uninvoicedExtraBuyAmount);
  const supplierBase = finite(invoicedSupplierAmount)
    + (hasSupplierInvoice ? finite(uninvoicedLineBuyAmount) : finite(lineBuyAmount));
  const rawSupplier = supplierBase + uninvoicedExtra;
  const unmatchedSellOnlyExtra = hasSupplierInvoice
    ? Math.max(0, finite(sellOnlyUninvoicedExtraSellAmount) - finite(invoicedExtraBuyAmount))
    : 0;
  const qlik = qlikSupplierCost == null ? null : finite(qlikSupplierCost);
  const supplierOverstatement = qlik == null ? 0 : rawSupplier - qlik;
  return unmatchedSellOnlyExtra > 0
    && supplierOverstatement > 0
    && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05
    ? qlik
    : rawSupplier;
}

export function dashboardMonthlyFinancialTrend(rows = []) {
  const byMonth = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const month = String(row?.deliveryDate || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const currency = dashboardCurrency(row?.currency);
    const key = `${month}\u001f${currency}`;
    const current = byMonth.get(key) || {
      month,
      currency,
      buyer: 0,
      supplier: 0,
      brokerCommissions: 0,
      netPnl: 0,
      stemCount: 0,
    };
    for (const field of ['buyer', 'supplier', 'brokerCommissions', 'netPnl']) current[field] += finite(row?.[field]);
    current.stemCount += 1;
    byMonth.set(key, current);
  }
  return [...byMonth.values()].map((row) => ({
    ...row,
    // Margin is derived from this calendar month's aggregate profit and
    // turnover. It is never an average of STEM margins or of the selected period.
    grossMarginPct: row.buyer === 0 ? null : (row.netPnl / row.buyer) * 100,
  })).sort((left, right) => left.month.localeCompare(right.month) || left.currency.localeCompare(right.currency));
}

export function priorEquivalentDateWindows(dateWindows = []) {
  const windows = (Array.isArray(dateWindows) ? dateWindows : [])
    .map((window) => ({ startDate: window?.startDate || window?.start, endDate: window?.endDate || window?.end }))
    .filter((window) => /^\d{4}-\d{2}-\d{2}$/.test(window.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(window.endDate))
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  if (!windows.length) return [];
  const start = new Date(`${windows[0].startDate}T00:00:00Z`);
  const end = new Date(`${windows[windows.length - 1].endDate}T00:00:00Z`);
  const durationDays = Math.round((end - start) / 86400000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - durationDays + 1);
  const iso = (value) => value.toISOString().slice(0, 10);
  return [{ startDate: iso(previousStart), endDate: iso(previousEnd) }];
}

function shiftIsoDateYear(value, offset) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]) + Number(offset || 0);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function yearOverYearDateWindows(dateWindows = []) {
  return (Array.isArray(dateWindows) ? dateWindows : []).flatMap((window) => {
    const startDate = shiftIsoDateYear(window?.startDate || window?.start, -1);
    const endDate = shiftIsoDateYear(window?.endDate || window?.end, -1);
    return startDate && endDate ? [{ startDate, endDate }] : [];
  });
}

export function dashboardCurrentYearDateWindows(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  if (!Number.isInteger(year) || year < 2000 || year > 9999) return [];
  return [{ startDate: `${year}-01-01`, endDate: `${year}-12-31` }];
}

function shiftMonthYear(value, offset) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  return match ? `${Number(match[1]) + Number(offset || 0)}-${match[2]}` : null;
}

export function dashboardMonthlyComparison({
  currentFinancial = [],
  priorFinancial = [],
  currentVolume = [],
  priorVolume = [],
  priorComplete = true,
  calendarYear = null,
} = {}) {
  const financialKey = (row, month = row?.month) => `${month}\u001f${dashboardCurrency(row?.currency)}`;
  const currentFinancialByMonth = new Map((currentFinancial || []).flatMap((row) => /^\d{4}-\d{2}$/.test(String(row?.month || '')) ? [[financialKey(row), row]] : []));
  const priorFinancialByCurrentMonth = new Map((priorFinancial || []).flatMap((row) => {
    const month = shiftMonthYear(row?.month, 1);
    return month ? [[financialKey(row, month), row]] : [];
  }));
  const volumeFor = (rows, month, currency) => {
    const byFamily = new Map();
    let found = false;
    for (const row of rows || []) {
      if (row?.month !== month || dashboardCurrency(row?.currency) !== currency || String(row?.unitOfMeasure || 'MT').toUpperCase() !== 'MT') continue;
      found = true;
      const family = String(row?.family || 'Other').trim() || 'Other';
      byFamily.set(family, finite(byFamily.get(family)) + finite(row?.quantity));
    }
    const productVolumes = [...byFamily.entries()]
      .map(([family, quantity]) => ({ family, quantity, unitOfMeasure: 'MT' }))
      .sort((left, right) => left.family.localeCompare(right.family));
    return { found, total: productVolumes.reduce((sum, row) => sum + row.quantity, 0), productVolumes };
  };
  const normalizedCalendarYear = /^\d{4}$/.test(String(calendarYear || '')) ? String(calendarYear) : null;
  const currencies = [...new Set([
    ...(currentFinancial || []).map((row) => dashboardCurrency(row?.currency)),
    ...(priorFinancial || []).map((row) => dashboardCurrency(row?.currency)),
    ...(currentVolume || []).map((row) => dashboardCurrency(row?.currency)),
    ...(priorVolume || []).map((row) => dashboardCurrency(row?.currency)),
  ].filter(Boolean))].sort();
  const candidates = normalizedCalendarYear
    ? currencies.flatMap((currency) => Array.from({ length: 12 }, (_, index) => ({ month: `${normalizedCalendarYear}-${String(index + 1).padStart(2, '0')}`, currency })))
    : currentFinancial || [];
  return candidates.flatMap((candidate) => {
    const month = String(candidate?.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return [];
    const currency = dashboardCurrency(candidate.currency);
    const current = normalizedCalendarYear ? currentFinancialByMonth.get(financialKey(candidate)) || null : candidate;
    const priorMonth = shiftMonthYear(month, -1);
    const prior = priorComplete ? priorFinancialByCurrentMonth.get(financialKey(candidate)) || null : null;
    const currentVolumes = volumeFor(currentVolume, month, currency);
    const priorVolumes = priorComplete ? volumeFor(priorVolume, priorMonth, currency) : { found: false, total: 0, productVolumes: [] };
    return [{
      month,
      priorMonth,
      currency,
      unitOfMeasure: 'MT',
      currentGrossProfit: current ? finite(current.netPnl) : null,
      priorGrossProfit: prior ? finite(prior.netPnl) : null,
      currentGrossMarginPct: current?.grossMarginPct == null ? null : finite(current.grossMarginPct),
      priorGrossMarginPct: prior?.grossMarginPct == null ? null : finite(prior.grossMarginPct),
      currentVolume: current ? currentVolumes.found ? currentVolumes.total : 0 : null,
      priorVolume: priorVolumes.found ? priorVolumes.total : null,
      currentProductVolumes: currentVolumes.productVolumes,
      priorProductVolumes: priorVolumes.productVolumes,
      ...(normalizedCalendarYear ? { currentAvailable: Boolean(current) } : {}),
      priorComplete,
      priorAvailable: Boolean(prior),
    }];
  }).sort((left, right) => left.month.localeCompare(right.month) || left.currency.localeCompare(right.currency));
}

export function dashboardMonthlyYearOverYear(currentRows = [], priorYearRows = [], {
  valueField = 'netPnl',
  dimensions = ['currency'],
} = {}) {
  const dimensionNames = (Array.isArray(dimensions) ? dimensions : []).map(String);
  const key = (row, month = row?.month) => [month, ...dimensionNames.map((field) => String(row?.[field] ?? ''))].join('\u001f');
  const priorByCurrentMonth = new Map();
  for (const row of priorYearRows || []) {
    const alignedMonth = shiftMonthYear(row?.month, 1);
    const value = Number(row?.[valueField]);
    if (!alignedMonth || !Number.isFinite(value)) continue;
    const alignedKey = key(row, alignedMonth);
    const current = priorByCurrentMonth.get(alignedKey) || { value: 0, priorMonth: row.month };
    current.value += value;
    priorByCurrentMonth.set(alignedKey, current);
  }
  return (currentRows || []).flatMap((row) => {
    const currentValue = Number(row?.[valueField]);
    if (!/^\d{4}-\d{2}$/.test(String(row?.month || '')) || !Number.isFinite(currentValue)) return [];
    const priorKey = key(row);
    const hasPrior = priorByCurrentMonth.has(priorKey);
    const prior = hasPrior ? priorByCurrentMonth.get(priorKey) : null;
    const priorValue = prior?.value ?? null;
    const difference = hasPrior ? currentValue - priorValue : null;
    return [{
      month: row.month,
      priorMonth: prior?.priorMonth || shiftMonthYear(row.month, -1),
      comparisonBasis: 'same_calendar_month',
      ...Object.fromEntries(dimensionNames.map((field) => [field, row?.[field] ?? null])),
      currentValue,
      priorValue,
      difference,
      differencePct: hasPrior && priorValue !== 0 ? (difference / Math.abs(priorValue)) * 100 : null,
    }];
  });
}

const DASHBOARD_CURSOR_FIELDS = new Set(['createdDate', 'deliveryDate', 'name']);

export function encodeDashboardCursor(record, sort = {}) {
  const field = DASHBOARD_CURSOR_FIELDS.has(sort.field) ? sort.field : 'createdDate';
  const direction = String(sort.direction || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const value = field === 'name'
    ? record.Name
    : field === 'deliveryDate'
      ? record.Delivery_Date__c || null
      : record.CreatedDate;
  return Buffer.from(JSON.stringify({ version: 1, field, direction, value, id: record.Id })).toString('base64url');
}

export function decodeDashboardCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!isDecisionDashboardSalesforceId(parsed.id)) return null;
    // Compatibility with cursors issued by the first decision-dashboard build.
    if (parsed.createdDate && /^\d{4}-\d{2}-\d{2}T/.test(String(parsed.createdDate))) {
      return { field: 'createdDate', direction: 'desc', value: parsed.createdDate, id: parsed.id };
    }
    const field = DASHBOARD_CURSOR_FIELDS.has(parsed.field) ? parsed.field : null;
    const direction = parsed.direction === 'asc' || parsed.direction === 'desc' ? parsed.direction : null;
    const validValue = field === 'createdDate'
      ? /^\d{4}-\d{2}-\d{2}T/.test(String(parsed.value || ''))
      : field === 'deliveryDate'
        ? parsed.value == null || /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.value))
        : typeof parsed.value === 'string' && parsed.value.length <= 255;
    return field && direction && validValue ? { field, direction, value: parsed.value, id: parsed.id } : null;
  } catch {
    return null;
  }
}

export function dashboardFinancialBuckets(rows = []) {
  const buckets = new Map();
  for (const row of rows) {
    const currency = dashboardCurrency(row.currency || row.CurrencyIsoCode);
    const current = buckets.get(currency) || { currency, buyer: 0, supplier: 0, costs: 0, brokerCommissions: 0, netPnl: 0, stemCount: 0 };
    current.buyer += finite(row.buyer);
    current.supplier += finite(row.supplier);
    current.costs += finite(row.costs);
    current.brokerCommissions += finite(row.brokerCommissions);
    current.netPnl += finite(row.netPnl);
    current.stemCount += 1;
    buckets.set(currency, current);
  }
  return [...buckets.values()]
    .map((row) => ({ ...row, grossMarginPct: row.buyer === 0 ? null : (row.netPnl / row.buyer) * 100 }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

export function decisionDashboardCompleteness({ matchingCount = 0, processedCount = 0, failed = false } = {}) {
  const matching = Math.max(0, finite(matchingCount));
  const processed = Math.max(0, finite(processedCount));
  return { matchingCount: matching, processedCount: processed, complete: !failed && matching === processed };
}

export function decisionDashboardSummary(rows = [], completeness = {}) {
  const scope = decisionDashboardCompleteness({ ...completeness, processedCount: completeness.processedCount ?? rows.length });
  return {
    ...scope,
    financials: scope.complete ? dashboardFinancialBuckets(rows) : null,
  };
}
