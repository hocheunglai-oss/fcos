// Pure contracts for the decision dashboard.  Financial values are deliberately
// keyed by ISO currency: callers must never collapse these buckets without an
// explicit, audited FX policy.

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function isDecisionDashboardSalesforceId(value) {
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(String(value || ''));
}

export function dashboardCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return currency || 'UNSPECIFIED';
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
