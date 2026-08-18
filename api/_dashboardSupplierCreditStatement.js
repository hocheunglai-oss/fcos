const DAY_MS = 86_400_000;
const MONEY_TOLERANCE = 0.005;

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function amount(value) {
  const parsed = number(value);
  return parsed == null ? null : Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function dateOnly(value) {
  const token = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : null;
}

function dateMs(value) {
  const token = dateOnly(value);
  return token ? Date.parse(`${token}T00:00:00.000Z`) : null;
}

function addDays(value, days) {
  const date = dateOnly(value);
  const count = number(days);
  if (!date || count == null) return null;
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + Math.trunc(count));
  return result.toISOString().slice(0, 10);
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = number(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function paymentTermDays(value) {
  const parsed = number(value);
  if (parsed != null) return Math.max(0, Math.trunc(parsed));
  const match = text(value).match(/\b(\d{1,4})\b/);
  return match ? Math.max(0, Number(match[1])) : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeSupplierCreditScope(scope) {
  return ['open', 'open_recent', 'all'].includes(scope) ? scope : 'open';
}

export function supplierOpenUninvoicedRows(rows = []) {
  return rows.filter((row) => !row.exposureComplete || number(row.currentExposure) > MONEY_TOLERANCE);
}

export function resolveSupplierInvoiceIdentity({ invoice = {}, linkedSupplierAccountIds = [], selectedAccountIds = [] } = {}) {
  const actualSupplierId = text(invoice.Supplier__c || invoice.supplierAccountId);
  const linkedIds = unique(linkedSupplierAccountIds.map(text));
  const allowed = new Set(selectedAccountIds.map(text));
  if (actualSupplierId) {
    return allowed.has(actualSupplierId)
      ? { status: 'included', supplierAccountId: actualSupplierId, source: 'actual_supplier' }
      : {
        status: linkedIds.some((id) => allowed.has(id)) ? 'conflict' : 'excluded',
        supplierAccountId: actualSupplierId,
        source: 'actual_supplier',
        warning: linkedIds.some((id) => allowed.has(id))
          ? 'The Supplier Invoice actual supplier conflicts with its linked supplier child and was excluded.'
          : null,
      };
  }
  const matchingLinkedIds = linkedIds.filter((id) => allowed.has(id));
  if (matchingLinkedIds.length === 1) {
    return { status: 'included', supplierAccountId: matchingLinkedIds[0], source: 'linked_exact_supplier_child' };
  }
  return {
    status: matchingLinkedIds.length > 1 ? 'conflict' : 'excluded',
    supplierAccountId: null,
    source: matchingLinkedIds.length > 1 ? 'ambiguous_linked_supplier_children' : 'unresolved',
    warning: matchingLinkedIds.length > 1
      ? 'The Supplier Invoice is linked to more than one in-scope supplier Account and was excluded.'
      : null,
  };
}

function supplierQuantity(child, kind) {
  const delivered = number(child.Quantity_Delivered_Per_BDN__c);
  if (delivered != null && delivered > 0) return { quantity: delivered, basis: 'delivered_bdn', usesRangeMaximum: false };
  const maximumField = kind === 'extra_cost' ? 'Quantity_Range_Max__c' : 'Quantity_Max__c';
  const maximum = number(child[maximumField]);
  if (child.Is_Quantity_Range__c === true && maximum != null) {
    return { quantity: maximum, basis: 'range_max_quantity', usesRangeMaximum: true };
  }
  const ordered = number(child.Quantity__c);
  return { quantity: ordered, basis: 'ordered_quantity', usesRangeMaximum: false };
}

export function estimateUninvoicedSupplierChild(child = {}, kind = 'line_item') {
  if (child.Cancelled__c === true) return { complete: false, ignored: true, blockingReason: 'Cancelled supplier child.' };
  if (text(child.Supplier_Invoice__c)) return { complete: false, ignored: true, blockingReason: 'Supplier child is already linked to an invoice.' };
  const currency = text(child.CurrencyIsoCode) || 'USD';
  if (child._ambiguousInvoiceLinkage === true) {
    return { complete: false, currency, blockingReason: 'An unlinked supplier child shares this STEM and supplier with an issued Supplier Invoice, so FCOS cannot exclude double-counting.' };
  }
  if (kind === 'extra_cost') {
    const unitPrice = number(child.Unit_Cost__c);
    const fixedAmount = firstNumber(child.Line_Total_Buy__c, child.Lumpsum_Cost__c);
    if ((unitPrice == null || (Math.abs(unitPrice) <= MONEY_TOLERANCE && Math.abs(fixedAmount || 0) > MONEY_TOLERANCE)) && fixedAmount != null) {
      return {
        complete: true,
        amount: amount(fixedAmount),
        currency,
        basis: 'fixed',
        usesRangeMaximum: false,
        quantity: null,
        unitPrice: null,
      };
    }
    const quantity = supplierQuantity(child, kind);
    if (unitPrice == null) return { complete: false, currency, blockingReason: 'Supplier unit cost is unavailable.' };
    if (quantity.quantity == null) return { complete: false, currency, blockingReason: 'Supplier quantity is unavailable.' };
    if (!text(child._uom)) return { complete: false, currency, blockingReason: 'Supplier unit of measure is unavailable.' };
    return {
      complete: true,
      amount: amount(unitPrice * quantity.quantity),
      currency,
      ...quantity,
      unitPrice,
    };
  }
  const unitPrice = firstNumber(
    child.Cost_Per_Unit__c,
    child.Unit_Buy_At__c,
    child.Unit_Cost__c,
    child.Offer_Line_Item__r?.Supplier_Unit_Price__c,
  );
  const quantity = supplierQuantity(child, kind);
  if (unitPrice == null) return { complete: false, currency, blockingReason: 'Supplier buy price is unavailable.' };
  if (quantity.quantity == null) return { complete: false, currency, blockingReason: 'Supplier quantity is unavailable.' };
  if (!text(child._uom)) return { complete: false, currency, blockingReason: 'Supplier unit of measure is unavailable.' };
  return {
    complete: true,
    amount: amount(unitPrice * quantity.quantity),
    currency,
    ...quantity,
    unitPrice,
  };
}

function cashflowEventsForAmount(cashflows = [], obligation, today, { allowInvoiceDue = true } = {}) {
  const remaining = { value: Math.max(0, number(obligation) || 0) };
  const events = [];
  const ordered = [...cashflows].sort((left, right) => (
    text(left.Scheduled_Payment_Date__c || left.Invoice_Due_Date__c).localeCompare(text(right.Scheduled_Payment_Date__c || right.Invoice_Due_Date__c))
    || text(left.Id).localeCompare(text(right.Id))
  ));
  for (const cashflow of ordered) {
    if (remaining.value <= MONEY_TOLERANCE) break;
    const scheduledDate = dateOnly(cashflow.Scheduled_Payment_Date__c);
    const invoiceDueDate = dateOnly(cashflow.Invoice_Due_Date__c);
    const scheduledAmount = firstNumber(cashflow.Scheduled_Payment_Amount__c, cashflow.Payment_Amount__c);
    const date = scheduledDate || (allowInvoiceDue ? invoiceDueDate : null);
    if (!date || date < today) continue;
    const release = Math.min(remaining.value, scheduledAmount != null && scheduledAmount > 0 ? scheduledAmount : remaining.value);
    if (release <= MONEY_TOLERANCE) continue;
    events.push({
      date,
      amount: amount(release),
      source: scheduledDate ? 'cashflow_scheduled_payment' : 'cashflow_invoice_due',
      sourceLabel: scheduledDate ? 'Cashflow scheduled payment' : 'Cashflow invoice due date',
      cashflowId: cashflow.Id || null,
    });
    remaining.value -= release;
  }
  return { events, remaining: amount(Math.max(0, remaining.value)) };
}

function invoiceForecastEvents(invoice, cashflows, payableBalance, today) {
  const cashflow = cashflowEventsForAmount(cashflows, payableBalance, today, { allowInvoiceDue: false });
  let remaining = cashflow.remaining;
  const events = [...cashflow.events];
  const partialDate = dateOnly(invoice.Partial_Invoice_Due_Date__c || invoice.partialDueDate);
  const partialAmount = number(invoice.Partial_Amount__c ?? invoice.partialAmount);
  if (remaining > MONEY_TOLERANCE && partialDate && partialDate >= today && partialAmount != null && partialAmount > 0) {
    const release = Math.min(remaining, partialAmount);
    events.push({ date: partialDate, amount: amount(release), source: 'partial_invoice_due', sourceLabel: 'Partial Supplier Invoice due date' });
    remaining = amount(remaining - release);
  }
  const dueDate = dateOnly(invoice.Invoice_Due_Date__c || invoice.dueDate);
  if (remaining > MONEY_TOLERANCE && dueDate && dueDate >= today) {
    events.push({ date: dueDate, amount: remaining, source: 'supplier_invoice_due', sourceLabel: 'Supplier Invoice due date' });
    remaining = 0;
  }
  return { events, undatedAmount: amount(remaining) };
}

function uninvoicedChildForecast(child, estimate, cashflows, stem, today) {
  const cashflow = cashflowEventsForAmount(cashflows, estimate.amount, today);
  let remaining = cashflow.remaining;
  const events = [...cashflow.events];
  if (remaining > MONEY_TOLERANCE) {
    const cashflowDue = [...cashflows].map((row) => dateOnly(row.Invoice_Due_Date__c)).filter((date) => date && date >= today).sort()[0];
    const paymentDays = paymentTermDays(child.Payment_Term_Number__c ?? child.Payment_Term__c);
    const deliveryDate = dateOnly(stem.Delivery_Date__c || stem.Expected_Delivery_Date__c);
    const estimatedDate = cashflowDue || addDays(deliveryDate, paymentDays);
    if (estimatedDate && estimatedDate >= today) {
      events.push({
        date: estimatedDate,
        amount: remaining,
        source: cashflowDue ? 'cashflow_invoice_due' : 'delivery_payment_term',
        sourceLabel: cashflowDue ? 'Cashflow invoice due date' : 'Delivery date + supplier payment term',
      });
      remaining = 0;
    }
  }
  return { events, undatedAmount: amount(remaining) };
}

export function buildIssuedSupplierRow({ invoice = {}, identity, stem = {}, payments = [], cashflows = [], accountName = null, today } = {}) {
  const invoiceAmount = amount(invoice.Invoice_Amount__c ?? invoice.invoiceAmount);
  const rawPayable = amount(invoice.Payable_Balance__c ?? invoice.payableBalance);
  const payableBalance = rawPayable == null ? null : Math.max(0, rawPayable);
  const warnings = [];
  if (rawPayable != null && rawPayable < -MONEY_TOLERANCE) warnings.push('Supplier Invoice payable balance is negative; forecast exposure is floored at zero.');
  if (invoiceAmount != null && rawPayable != null && rawPayable > invoiceAmount + MONEY_TOLERANCE) warnings.push('Supplier Invoice payable balance exceeds the invoice amount.');
  const forecast = payableBalance == null
    ? { events: [], undatedAmount: null }
    : invoiceForecastEvents(invoice, cashflows, payableBalance, today);
  const dueDate = dateOnly(invoice.Invoice_Due_Date__c || invoice.dueDate);
  const partialDueDate = dateOnly(invoice.Partial_Invoice_Due_Date__c || invoice.partialDueDate);
  const partialAmount = number(invoice.Partial_Amount__c ?? invoice.partialAmount);
  const nextForecastDate = forecast.events.map((event) => event.date).filter(Boolean).sort()[0] || null;
  const overdueAmount = payableBalance > MONEY_TOLERANCE
    ? dueDate && dueDate < today
      ? payableBalance
      : partialDueDate && partialDueDate < today && partialAmount > 0
        ? Math.min(payableBalance, partialAmount)
        : 0
    : 0;
  return {
    rowId: `invoice:${text(invoice.Id || invoice.invoiceId)}`,
    rowType: 'issued',
    supplierInvoiceId: text(invoice.Id || invoice.invoiceId),
    supplierInvoiceName: text(invoice.Name || invoice.invoiceName) || 'Supplier Invoice',
    ownerAccountId: identity.supplierAccountId,
    supplierName: accountName || invoice.Supplier__r?.Name || invoice.supplierName || null,
    stemId: text(invoice.STEM__c || invoice.stemId),
    stemName: stem.Name || invoice.stemName || null,
    currency: text(invoice.CurrencyIsoCode || invoice.currency) || 'USD',
    invoiceAmount,
    payableBalance,
    currentExposure: payableBalance,
    exposureComplete: payableBalance != null,
    invoiceDate: dateOnly(invoice.Invoice_Date__c || invoice.invoiceDate || invoice.CreatedDate),
    dueDate: nextForecastDate || dueDate || partialDueDate,
    invoiceDueDate: dueDate,
    partialDueDate,
    partialAmount,
    overdue: overdueAmount > MONEY_TOLERANCE,
    overdueAmount: amount(overdueAmount),
    forecastEvents: forecast.events,
    undatedAmount: forecast.undatedAmount,
    payments: [...payments].map((payment) => ({
      paymentId: payment.Id || payment.paymentId || null,
      date: dateOnly(payment.Date__c || payment.paymentDate || payment.CreatedDate),
      amount: amount(payment.Amount__c ?? payment.amount),
    })).filter((payment) => payment.date && payment.amount != null),
    identitySource: identity.source,
    usesRangeMaximum: false,
    warnings,
  };
}

export function buildUninvoicedSupplierRows({ children = [], stemsById = {}, cashflowsByChildId = {}, today } = {}) {
  const groups = new Map();
  for (const child of children) {
    const kind = child._kind === 'extra_cost' ? 'extra_cost' : 'line_item';
    const estimate = estimateUninvoicedSupplierChild(child, kind);
    if (estimate.ignored) continue;
    const supplierAccountId = text(child._supplierAccountId);
    const currency = estimate.currency || text(child.CurrencyIsoCode) || 'USD';
    const key = `${text(child.STEM__c)}:${supplierAccountId}:${currency}`;
    const group = groups.get(key) || {
      rowId: `estimate:${key}`,
      rowType: 'uninvoiced',
      ownerAccountId: supplierAccountId,
      supplierName: child._supplierName || null,
      stemId: text(child.STEM__c),
      stemName: stemsById[text(child.STEM__c)]?.Name || null,
      currency,
      invoiceAmount: null,
      payableBalance: null,
      currentExposure: 0,
      exposureComplete: true,
      invoiceDate: null,
      dueDate: null,
      overdue: false,
      forecastEvents: [],
      undatedAmount: 0,
      payments: [],
      usesRangeMaximum: false,
      childEvidence: [],
      warnings: [],
    };
    const childEvidence = {
      childId: child.Id,
      childType: kind,
      label: child._label || child.Name || child.Description__c || (kind === 'extra_cost' ? 'Extra cost' : 'Product'),
      complete: estimate.complete,
      amount: estimate.amount ?? null,
      basis: estimate.basis || null,
      quantity: estimate.quantity ?? null,
      unitPrice: estimate.unitPrice ?? null,
      unitOfMeasure: child._uom || null,
      blockingReason: estimate.blockingReason || null,
    };
    group.childEvidence.push(childEvidence);
    if (!estimate.complete) {
      group.exposureComplete = false;
      group.warnings.push(`${childEvidence.label}: ${estimate.blockingReason || 'Supplier cost evidence is incomplete.'}`);
    } else {
      group.currentExposure = amount(group.currentExposure + estimate.amount);
      group.usesRangeMaximum = group.usesRangeMaximum || estimate.usesRangeMaximum;
      const forecast = uninvoicedChildForecast(
        child,
        estimate,
        cashflowsByChildId[text(child.Id)] || [],
        stemsById[text(child.STEM__c)] || {},
        today,
      );
      group.forecastEvents.push(...forecast.events.map((event) => ({ ...event, childId: child.Id })));
      group.undatedAmount = amount(group.undatedAmount + (forecast.undatedAmount || 0));
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((row) => {
    const dates = row.forecastEvents.map((event) => event.date).filter(Boolean).sort();
    return {
      ...row,
      currentExposure: row.exposureComplete ? amount(row.currentExposure) : null,
      expectedSupplierCost: row.exposureComplete ? amount(row.currentExposure) : null,
      expectedPaymentDate: dates[0] || null,
      dueDate: dates[0] || null,
      overdue: false,
      undatedAmount: row.exposureComplete ? amount(row.undatedAmount) : null,
      warnings: unique(row.warnings),
    };
  });
}

export function compareSupplierStatementRows(left, right) {
  const leftDue = dateOnly(left.dueDate);
  const rightDue = dateOnly(right.dueDate);
  if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
  if (leftDue && rightDue && leftDue !== rightDue) return leftDue.localeCompare(rightDue);
  if (leftDue && !rightDue) return -1;
  if (!leftDue && rightDue) return 1;
  return text(left.invoiceDate || '9999-12-31').localeCompare(text(right.invoiceDate || '9999-12-31'))
    || text(left.stemName).localeCompare(text(right.stemName))
    || text(left.rowId).localeCompare(text(right.rowId));
}

function sumRows(rows, selector) {
  return amount(rows.reduce((sum, row) => sum + (number(selector(row)) || 0), 0));
}

function daysAfter(date, count) {
  return addDays(date, count);
}

function currencyKpis(rows, today) {
  const currencies = unique(rows.map((row) => row.currency || 'USD')).sort();
  return currencies.map((currency) => {
    const currencyRows = rows.filter((row) => (row.currency || 'USD') === currency);
    const open = currencyRows.filter((row) => number(row.currentExposure) > MONEY_TOLERANCE);
    const estimates = currencyRows.filter((row) => row.rowType === 'uninvoiced');
    const openEstimates = estimates.filter((row) => number(row.currentExposure) > MONEY_TOLERANCE);
    const estimateComplete = estimates.every((row) => row.exposureComplete);
    const issuedPayable = sumRows(open.filter((row) => row.rowType === 'issued'), (row) => row.currentExposure);
    const uninvoicedEstimate = estimateComplete ? sumRows(openEstimates, (row) => row.currentExposure) : null;
    const totalExposure = estimateComplete ? amount(issuedPayable + uninvoicedEstimate) : null;
    const sevenDays = daysAfter(today, 7);
    const thirtyDays = daysAfter(today, 30);
    const recentStart = addDays(today, -365);
    return {
      currency,
      issuedPayable,
      uninvoicedEstimate,
      totalExposure,
      complete: estimateComplete,
      overdue: sumRows(open, (row) => row.overdueAmount ?? (row.dueDate && row.dueDate < today ? row.currentExposure : 0)),
      dueWithin7Days: sumRows(open.flatMap((row) => row.forecastEvents || []).filter((event) => event.date >= today && event.date <= sevenDays), (event) => event.amount),
      dueWithin30Days: sumRows(open.flatMap((row) => row.forecastEvents || []).filter((event) => event.date >= today && event.date <= thirtyDays), (event) => event.amount),
      recentlyPaid: sumRows(currencyRows.flatMap((row) => row.payments || []).filter((payment) => payment.date >= recentStart && payment.date <= today), (payment) => payment.amount),
      rowCount: currencyRows.length,
      openRowCount: open.length,
      incompleteEstimateCount: estimates.filter((row) => !row.exposureComplete).length,
    };
  });
}

function buildStepSeries(rows, currency, today) {
  const currencyRows = rows.filter((row) => row.currency === currency && row.exposureComplete && number(row.currentExposure) > MONEY_TOLERANCE);
  const opening = sumRows(currencyRows, (row) => row.currentExposure);
  const byDate = new Map();
  for (const row of currencyRows) {
    let available = number(row.currentExposure) || 0;
    for (const event of [...(row.forecastEvents || [])].sort((left, right) => text(left.date).localeCompare(text(right.date)))) {
      if (!event.date || event.date < today || available <= MONEY_TOLERANCE) continue;
      const release = Math.min(available, Math.max(0, number(event.amount) || 0));
      if (release <= MONEY_TOLERANCE) continue;
      byDate.set(event.date, amount((byDate.get(event.date) || 0) + release));
      available -= release;
    }
  }
  let remaining = opening;
  const points = [{ date: today, remaining: opening, released: 0 }];
  for (const [date, release] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    remaining = amount(Math.max(0, remaining - release));
    points.push({ date, remaining, released: release });
  }
  return {
    opening,
    undatedExposure: amount(Math.max(0, remaining)),
    undatedRowCount: currencyRows.filter((row) => number(row.undatedAmount) > MONEY_TOLERANCE).length,
    points,
  };
}

export function buildSupplierCreditStatement({
  account,
  group = null,
  groupMembers = [],
  issuedRows = [],
  uninvoicedRows = [],
  includeGroup = false,
  today,
  complete = true,
  warnings = [],
} = {}) {
  const accountId = text(account?.Id || account?.accountId);
  const allRows = [...issuedRows, ...uninvoicedRows].sort(compareSupplierStatementRows);
  const accountRows = allRows.filter((row) => text(row.ownerAccountId) === accountId);
  const visibleRows = includeGroup ? allRows : accountRows;
  const accountKpis = currencyKpis(accountRows, today);
  const groupKpis = includeGroup ? currencyKpis(allRows, today) : [];
  const accountKpisByCurrency = new Map(accountKpis.map((row) => [row.currency, row]));
  const groupKpisByCurrency = new Map(groupKpis.map((row) => [row.currency, row]));
  const currencies = unique(visibleRows.map((row) => row.currency || 'USD')).sort();
  const charts = currencies.map((currency) => {
    const chartComplete = accountKpisByCurrency.get(currency)?.complete !== false
      && (!includeGroup || groupKpisByCurrency.get(currency)?.complete !== false);
    return {
      currency,
      complete: chartComplete,
      account: chartComplete ? buildStepSeries(accountRows, currency, today) : null,
      group: chartComplete && includeGroup ? buildStepSeries(allRows, currency, today) : null,
    };
  });
  return {
    side: 'supplier',
    identity: {
      accountId,
      name: account?.Name || account?.name || null,
      clKey: account?.Company_Code__c || account?.clKey || null,
    },
    group: group ? {
      accountId: group.Id || group.accountId,
      name: group.Name || group.name,
      memberCount: groupMembers.length,
      included: includeGroup,
    } : null,
    includeGroup,
    kpis: { account: accountKpis, group: groupKpis },
    chart: { currencies: charts },
    rows: visibleRows,
    complete: complete && [...accountKpis, ...groupKpis].every((row) => row.complete),
    warnings: unique(warnings.concat(visibleRows.flatMap((row) => row.warnings || []))),
  };
}

export const dashboardSupplierCreditStatementInternals = {
  addDays,
  amount,
  buildStepSeries,
  cashflowEventsForAmount,
  currencyKpis,
  dateOnly,
  invoiceForecastEvents,
  paymentTermDays,
  supplierQuantity,
};
