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

function shiftMonthYear(value, offset) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  return match ? `${Number(match[1]) + Number(offset || 0)}-${match[2]}` : null;
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

export function dashboardMonthlyCounterpartySeries(rows = [], counterpartyMode = 'buyer', limit = 10) {
  const mode = counterpartyMode === 'supplier' ? 'supplier' : 'buyer';
  const totals = new Map();
  const monthly = new Map();
  const identities = new Map();

  for (const row of rows) {
    const month = String(row?.deliveryDate || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const currency = dashboardCurrency(row?.currency);
    const entities = mode === 'supplier'
      ? (row?.supplierAllocations || []).map((item) => ({
          accountId: item?.id || null,
          name: String(item?.name || '').trim(),
          grossProfit: item?.netPnl,
        }))
      : row?.account
        ? [{ accountId: row.account.id || null, name: String(row.account.name || '').trim(), grossProfit: row.netPnl }]
        : [];
    for (const entity of entities) {
      if (!entity.name || !Number.isFinite(Number(entity.grossProfit))) continue;
      const identityKey = `${currency}\u001f${entity.accountId || ''}\u001f${entity.name}\u001f${mode}`;
      identities.set(identityKey, { accountId: entity.accountId, name: entity.name, currency, role: mode });
      totals.set(identityKey, (totals.get(identityKey) || 0) + Number(entity.grossProfit));
      const monthlyKey = `${month}\u001e${identityKey}`;
      monthly.set(monthlyKey, (monthly.get(monthlyKey) || 0) + Number(entity.grossProfit));
    }
  }

  const selected = [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || identities.get(left[0]).name.localeCompare(identities.get(right[0]).name))
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 10)));
  const series = selected.map(([identityKey, grossProfit], index) => ({
    ...identities.get(identityKey),
    identityKey,
    seriesKey: `counterparty:${index}`,
    grossProfit,
  }));
  const seriesByIdentity = new Map(series.map((item) => [item.identityKey, item.seriesKey]));
  const points = [...monthly.entries()].flatMap(([key, grossProfit]) => {
    const separator = key.indexOf('\u001e');
    const month = key.slice(0, separator);
    const identityKey = key.slice(separator + 1);
    const seriesKey = seriesByIdentity.get(identityKey);
    return seriesKey ? [{ month, seriesKey, grossProfit }] : [];
  }).sort((left, right) => left.month.localeCompare(right.month) || left.seriesKey.localeCompare(right.seriesKey));

  return {
    counterpartyMode: mode,
    series: series.map(({ identityKey, ...item }) => item),
    points,
  };
}
