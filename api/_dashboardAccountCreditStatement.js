const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 86_400_000;

export const CREDIT_RECONCILIATION_TOLERANCE = 1;

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function value(value) {
  return number(value) ?? 0;
}

function idKey(id) {
  const normalized = text(id);
  return SALESFORCE_ID.test(normalized) ? normalized.slice(0, 15) : '';
}

function dateOnly(input) {
  const normalized = text(input).slice(0, 10);
  return ISO_DATE.test(normalized) ? normalized : null;
}

function addDays(date, days) {
  const parsed = dateOnly(date);
  const count = number(days);
  if (!parsed || count == null) return null;
  const result = new Date(`${parsed}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + Math.trunc(count));
  return result.toISOString().slice(0, 10);
}

function uniqueById(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = idKey(row?.Id || row?.id || row?.paymentId || row?.cashflowId);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeAccountCreditScope(scope) {
  return ['open_recent', 'open', 'all'].includes(scope) ? scope : 'open_recent';
}

export function encodeAccountCreditCursor(payload = {}) {
  return Buffer.from(JSON.stringify({ version: 1, ...payload })).toString('base64url');
}

export function decodeAccountCreditCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (parsed.version !== 1) return null;
    if (parsed.kind === 'directory') {
      if (!text(parsed.name) || !SALESFORCE_ID.test(text(parsed.id))) return null;
      return { kind: 'directory', name: text(parsed.name), id: text(parsed.id) };
    }
    if (parsed.kind === 'statement') {
      const offset = Number(parsed.offset);
      const scope = normalizeAccountCreditScope(parsed.scope);
      return Number.isInteger(offset) && offset >= 0 ? { kind: 'statement', offset, scope } : null;
    }
    if (parsed.kind === 'all') {
      if (!text(parsed.createdDate) || !SALESFORCE_ID.test(text(parsed.id))) return null;
      return { kind: 'all', createdDate: text(parsed.createdDate), id: text(parsed.id) };
    }
  } catch {
    return null;
  }
  return null;
}

export function selectUltimateCreditGroup(accountChain = []) {
  const groups = accountChain.filter((account) => /^GROUP(?:\s*-|\s|$)/i.test(text(account?.Name || account?.name)));
  return groups.at(-1) || null;
}

export function accountCreditSnapshot(account = {}, currency = null) {
  const category = ['Individual', 'Group', 'Special'].includes(account.CL_Category__c)
    ? account.CL_Category__c
    : null;
  const snapshot = {
    category,
    currency: text(currency || account.CurrencyIsoCode) || 'Salesforce corporate currency',
    legacyLimit: number(account.Credit_Limit__c),
    individualLimit: number(account.CL_Individual__c),
    specialIndividualLimit: number(account.CL_Special__c),
    usedCustomer: number(account.CL_Used_Customer__c),
    groupLimit: number(account.CL_Group__c),
    specialGroupLimit: number(account.CL_Special_Group__c),
    usedGroup: number(account.CL_Used_Group__c),
    salesforceAvailable: number(account.CL_Available_Credit__c),
  };
  return { ...snapshot, ...accountCreditBalances(snapshot) };
}

export function accountCreditBalances(snapshot = {}, overrides = {}) {
  const usedCustomer = number(overrides.usedCustomer) ?? number(snapshot.usedCustomer);
  const usedGroup = number(overrides.usedGroup) ?? number(snapshot.usedGroup);
  const individualLimit = number(snapshot.individualLimit);
  const specialIndividualLimit = number(snapshot.specialIndividualLimit);
  const groupLimit = number(snapshot.groupLimit);
  const specialGroupLimit = number(snapshot.specialGroupLimit);
  const category = snapshot.category;
  const individualCapacity = category === 'Special' ? specialIndividualLimit : individualLimit;
  const groupCapacity = category === 'Special'
    ? value(groupLimit) + value(specialGroupLimit)
    : groupLimit;
  const individualBalance = individualCapacity == null || usedCustomer == null ? null : individualCapacity - usedCustomer;
  const groupBalance = groupCapacity == null || usedGroup == null ? null : groupCapacity - usedGroup;
  let calculatedAvailable = null;
  if (category === 'Individual') calculatedAvailable = individualBalance;
  else if (category === 'Group') calculatedAvailable = groupBalance;
  else if (category === 'Special') {
    calculatedAvailable = individualBalance == null || groupBalance == null ? null : Math.min(individualBalance, groupBalance);
  }
  return { individualCapacity, groupCapacity, individualBalance, groupBalance, calculatedAvailable };
}

export function reconcileCreditExposure(expected, reconstructed, { complete = true, tolerance = CREDIT_RECONCILIATION_TOLERANCE } = {}) {
  const authoritative = number(expected);
  const calculated = number(reconstructed);
  if (!complete || authoritative == null || calculated == null) {
    return { complete: false, matches: false, expected: authoritative, reconstructed: calculated, difference: null, tolerance };
  }
  const difference = calculated - authoritative;
  return { complete: true, matches: Math.abs(difference) <= tolerance, expected: authoritative, reconstructed: calculated, difference, tolerance };
}

function paymentDate(payment) {
  return dateOnly(payment.paymentDate || payment.Date__c || payment.Payment_Date__c || payment.CreatedDate);
}

function paymentAmount(payment) {
  return number(payment.amount ?? payment.Amount__c ?? payment.Payment_Amount__c);
}

function cashflowDate(row, field) {
  return dateOnly(row[field]);
}

function earliestDated(rows, fields, today, { allowPast = false } = {}) {
  const candidates = [];
  for (const row of rows || []) {
    for (const field of fields) {
      const date = cashflowDate(row, field);
      if (date && (allowPast || date >= today)) candidates.push({ date, row });
    }
  }
  return candidates.sort((left, right) => left.date.localeCompare(right.date))[0] || null;
}

function releaseCandidate(stem, cashflows, today) {
  const cashflowDue = earliestDated(cashflows, ['Invoice_Due_Date__c'], today, { allowPast: true });
  const stemDue = [stem.Invoice_Due_Date__c, stem.QLIK_Invoice_Due_Date__c, stem.Due_Date__c]
    .map(dateOnly).filter(Boolean).sort()[0] || null;
  const authoritativeDue = cashflowDue?.date || stemDue;
  if (authoritativeDue) {
    return authoritativeDue < today
      ? { date: null, missedDate: authoritativeDue, source: 'past_due_unknown', sourceLabel: 'Past due — release unknown' }
      : { date: authoritativeDue, source: cashflowDue ? 'cashflow_invoice_due' : 'stem_invoice_due', sourceLabel: cashflowDue ? 'Cashflow invoice due' : 'STEM invoice due' };
  }

  const expectedPayment = dateOnly(stem.Expected_Delivery_Date_Payment_Term__c)
    || addDays(stem.Delivery_Date__c || stem.Expected_Delivery_Date__c, stem.Payment_Term_Number__c ?? stem.Payment_Term__c);
  if (expectedPayment) {
    return expectedPayment < today
      ? { date: null, missedDate: expectedPayment, source: 'past_due_unknown', sourceLabel: 'Past due — release unknown' }
      : { date: expectedPayment, source: 'expected_delivery_term', sourceLabel: 'Expected delivery + payment term' };
  }
  return { date: null, missedDate: null, source: 'unknown', sourceLabel: 'Release date unavailable' };
}

function scheduledReleases(cashflows, today) {
  return uniqueById(cashflows)
    .map((cashflow) => ({
      cashflowId: cashflow.Id,
      date: dateOnly(cashflow.Scheduled_Payment_Date__c || cashflow.Payment_Date__c),
      amount: number(cashflow.Scheduled_Payment_Amount__c ?? cashflow.Payment_Amount__c),
      source: 'scheduled_payment',
      sourceLabel: 'Scheduled payment',
    }))
    .filter((release) => release.date && release.date >= today)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function buildStemCreditRelease({ stem = {}, payments = [], cashflows = [], today, accountId }) {
  const effectiveToday = dateOnly(today);
  if (!effectiveToday) throw new TypeError('today must be an ISO date');
  const exposure = number(stem.QLIK_Receivable_Balance__c) ?? 0;
  const actualReleases = uniqueById(payments)
    .map((payment) => ({
      paymentId: payment.paymentId || payment.Id,
      date: paymentDate(payment),
      amount: paymentAmount(payment),
      source: 'actual_payment',
      sourceLabel: 'Actual payment',
    }))
    .filter((row) => row.date && row.amount != null && row.date <= effectiveToday)
    .sort((left, right) => left.date.localeCompare(right.date));
  const futurePayments = uniqueById(payments)
    .map((payment) => ({ date: paymentDate(payment), amount: paymentAmount(payment), paymentId: payment.paymentId || payment.Id }))
    .filter((row) => row.date && row.amount != null && row.date > effectiveToday)
    .sort((left, right) => left.date.localeCompare(right.date));
  const forecastEvents = [];
  let remaining = exposure;
  if (remaining > 0) {
    for (const payment of futurePayments) {
      const released = Math.min(Math.max(payment.amount, 0), remaining);
      if (!(released > 0)) continue;
      forecastEvents.push({ date: payment.date, amount: released, source: 'confirmed_payment', sourceLabel: 'Confirmed payment', paymentId: payment.paymentId });
      remaining -= released;
      if (remaining <= 0.01) break;
    }
  }
  if (remaining > 0) {
    for (const scheduled of scheduledReleases(cashflows, effectiveToday)) {
      const proposed = scheduled.amount == null ? remaining : scheduled.amount;
      const released = Math.min(Math.max(proposed, 0), remaining);
      if (!(released > 0)) continue;
      forecastEvents.push({ ...scheduled, amount: released });
      remaining -= released;
      if (remaining <= 0.01) break;
    }
  }
  if (Math.abs(remaining) > 0.01) {
    const candidate = releaseCandidate(stem, cashflows, effectiveToday);
    forecastEvents.push({ ...candidate, amount: remaining });
  }
  const primaryForecast = forecastEvents.find((event) => event.date) || forecastEvents[0] || null;
  return {
    stemId: stem.Id,
    stemName: stem.Name || stem.Id,
    accountId: stem.Account__c || accountId || null,
    accountName: stem.Account__r?.Name || null,
    currency: text(stem.CurrencyIsoCode) || 'Salesforce corporate currency',
    currentExposure: exposure,
    actualReleases,
    forecastEvents,
    releaseDate: primaryForecast?.date || null,
    releaseSource: primaryForecast?.source || null,
    releaseSourceLabel: primaryForecast?.sourceLabel || null,
    missedReleaseDate: primaryForecast?.missedDate || null,
  };
}

function startOfWeek(date) {
  const valueDate = new Date(`${date}T00:00:00.000Z`);
  const day = valueDate.getUTCDay();
  valueDate.setUTCDate(valueDate.getUTCDate() - ((day + 6) % 7));
  return valueDate.toISOString().slice(0, 10);
}

function monthStart(date) {
  return `${date.slice(0, 7)}-01`;
}

function chartGranularity(events) {
  const dates = [...new Set(events.map((event) => event.date).filter(Boolean))].sort();
  if (dates.length <= 60) return 'day';
  const span = (new Date(`${dates.at(-1)}T00:00:00Z`) - new Date(`${dates[0]}T00:00:00Z`)) / ONE_DAY_MS;
  return span <= 365 ? 'week' : 'month';
}

export function buildCreditReleaseChart({ releases = [], selectedAccountId, snapshot = {}, individualProjection = true, groupProjection = true, today }) {
  const future = releases.flatMap((release) => release.forecastEvents.map((event) => ({
    ...event,
    stemId: release.stemId,
    stemName: release.stemName,
    accountId: release.accountId,
    accountName: release.accountName,
  }))).filter((event) => event.date && event.date >= today);
  const granularity = chartGranularity(future);
  const bucketDate = granularity === 'month' ? monthStart : granularity === 'week' ? startOfWeek : (date) => date;
  const buckets = new Map();
  for (const event of future) {
    const date = bucketDate(event.date);
    const current = buckets.get(date) || { date, accountRelease: 0, otherGroupRelease: 0, events: [] };
    if (idKey(event.accountId) === idKey(selectedAccountId)) current.accountRelease += event.amount;
    else current.otherGroupRelease += event.amount;
    current.events.push(event);
    buckets.set(date, current);
  }
  let individualBalance = number(snapshot.individualBalance);
  let groupBalance = number(snapshot.groupBalance);
  const points = [{
    date: today,
    accountRelease: 0,
    otherGroupRelease: 0,
    individualBalance: individualProjection ? individualBalance : null,
    groupBalance: groupProjection ? groupBalance : null,
    events: [],
  }];
  for (const bucket of [...buckets.values()].sort((left, right) => left.date.localeCompare(right.date))) {
    if (individualBalance != null) individualBalance += bucket.accountRelease;
    if (groupBalance != null) groupBalance += bucket.accountRelease + bucket.otherGroupRelease;
    points.push({
      ...bucket,
      individualBalance: individualProjection ? individualBalance : null,
      groupBalance: groupProjection ? groupBalance : null,
    });
  }
  return { granularity, points, exactEventCount: future.length };
}

export function buildAccountCreditStatement({
  account,
  group,
  groupMembers = [],
  openStems = [],
  statementStems = [],
  paymentsByStem = {},
  cashflowsByStem = {},
  today,
  complete = true,
  warnings = [],
} = {}) {
  const selectedAccountId = account?.Id;
  const snapshot = accountCreditSnapshot(account);
  const currencyLabels = [...new Set([...openStems, ...statementStems]
    .map((stem) => text(stem.CurrencyIsoCode))
    .filter(Boolean))].sort();
  const currencyConflict = currencyLabels.length > 1;
  const projectionComplete = complete && !currencyConflict;
  const releases = openStems.map((stem) => buildStemCreditRelease({
    stem,
    payments: paymentsByStem[stem.Id] || [],
    cashflows: cashflowsByStem[stem.Id] || [],
    today,
    accountId: stem.Account__c,
  }));
  const accountExposure = openStems
    .filter((stem) => idKey(stem.Account__c) === idKey(selectedAccountId))
    .reduce((sum, stem) => sum + value(stem.QLIK_Receivable_Balance__c), 0);
  const groupExposure = openStems.reduce((sum, stem) => sum + value(stem.QLIK_Receivable_Balance__c), 0);
  const exposureByCurrency = Object.fromEntries(currencyLabels.map((currency) => [currency, {
    individual: openStems
      .filter((stem) => idKey(stem.Account__c) === idKey(selectedAccountId) && text(stem.CurrencyIsoCode) === currency)
      .reduce((sum, stem) => sum + value(stem.QLIK_Receivable_Balance__c), 0),
    group: openStems
      .filter((stem) => text(stem.CurrencyIsoCode) === currency)
      .reduce((sum, stem) => sum + value(stem.QLIK_Receivable_Balance__c), 0),
  }]));
  const individualReconciliation = reconcileCreditExposure(snapshot.usedCustomer, currencyConflict ? null : accountExposure, { complete: projectionComplete });
  const groupReconciliation = group
    ? reconcileCreditExposure(snapshot.usedGroup, currencyConflict ? null : groupExposure, { complete: projectionComplete })
    : { complete: true, matches: true, expected: snapshot.usedGroup, reconstructed: groupExposure, difference: 0, tolerance: CREDIT_RECONCILIATION_TOLERANCE, notApplicable: true };
  const chart = buildCreditReleaseChart({
    releases: projectionComplete ? releases : [],
    selectedAccountId,
    snapshot,
    individualProjection: individualReconciliation.matches,
    groupProjection: Boolean(group && groupReconciliation.matches),
    today,
  });
  const releaseByStem = new Map(releases.map((release) => [idKey(release.stemId), release]));
  const rows = statementStems.map((stem) => {
    const release = releaseByStem.get(idKey(stem.Id)) || buildStemCreditRelease({
      stem,
      payments: paymentsByStem[stem.Id] || [],
      cashflows: cashflowsByStem[stem.Id] || [],
      today,
      accountId: stem.Account__c,
      accountName: stem.Account__r?.Name || null,
      currency: text(stem.CurrencyIsoCode) || snapshot.currency,
    });
    const actualReleased = release.actualReleases.reduce((sum, row) => sum + value(row.amount), 0);
    return {
      stemId: stem.Id,
      stemName: stem.Name || stem.Id,
      accountId: stem.Account__c,
      accountName: stem.Account__r?.Name || null,
      currency: text(stem.CurrencyIsoCode) || snapshot.currency,
      effectiveDate: dateOnly(stem.Delivery_Date__c || stem.Expected_Delivery_Date__c),
      invoiceStatus: stem.Invoice_Status__c || null,
      paymentTerm: stem.Payment_Term__c || null,
      currentExposure: number(stem.QLIK_Receivable_Balance__c) ?? 0,
      actualReleased,
      latestActualReleaseDate: release.actualReleases.at(-1)?.date || dateOnly(stem.Payment_Date__c),
      releaseDate: release.releaseDate,
      releaseSource: release.releaseSource,
      releaseSourceLabel: release.releaseSourceLabel,
      missedReleaseDate: release.missedReleaseDate,
      actualReleases: release.actualReleases,
      forecastEvents: release.forecastEvents,
    };
  });
  const derivedWarnings = [
    ...warnings,
    ...(!individualReconciliation.matches ? ['Individual used credit does not reconcile to the selected Account’s current buyer-leg STEM exposure. The individual projection is hidden.'] : []),
    ...(group && !groupReconciliation.matches ? ['Group used credit does not reconcile to current buyer-leg STEM exposure across the Salesforce GROUP hierarchy. The group projection is hidden.'] : []),
    ...(!complete ? ['Salesforce did not return a complete credit scope. Projected balances are hidden.'] : []),
    ...(currencyConflict ? [`Buyer-leg STEM exposure spans multiple currencies (${currencyLabels.join(', ')}). Values remain separated by row and projected balances are hidden.`] : []),
    ...(releases.some((release) => release.forecastEvents.some((event) => !event.date)) ? ['One or more open STEMs have no reliable future release date. Their credit remains in current exposure and is not projected as released.'] : []),
  ];
  return {
    identity: {
      accountId: selectedAccountId,
      name: account?.Name || selectedAccountId,
      clKey: account?.Company_Code__c || null,
      inactive: account?.Inactive_Suspended__c === true,
    },
    group: group ? { accountId: group.Id, name: group.Name, memberCount: groupMembers.length } : null,
    credit: snapshot,
    reconciliation: { individual: individualReconciliation, group: groupReconciliation },
    exposureByCurrency,
    releases,
    chart,
    currencies: currencyLabels.length ? currencyLabels : [snapshot.currency],
    rows,
    complete,
    warnings: [...new Set(derivedWarnings.filter(Boolean))],
  };
}

export const dashboardAccountCreditStatementInternals = {
  addDays,
  dateOnly,
  idKey,
  releaseCandidate,
};
