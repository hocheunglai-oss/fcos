const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 86_400_000;

import { SALESFORCE_CORPORATE_CURRENCY } from './_decisionDashboard.js';

export const CREDIT_RECONCILIATION_TOLERANCE = 1;
export const CREDIT_EXPOSURE_DELIVERY_START = '2026-01-01';

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

function currencyAmount(input) {
  const amount = number(input);
  return amount == null ? null : Math.round((amount + Number.EPSILON) * 100) / 100;
}

function idKey(id) {
  const normalized = text(id);
  return SALESFORCE_ID.test(normalized) ? normalized.slice(0, 15) : '';
}

function dateOnly(input) {
  const normalized = text(input).slice(0, 10);
  return ISO_DATE.test(normalized) ? normalized : null;
}

function dateTime(input) {
  const normalized = text(input);
  const parsed = Date.parse(normalized);
  return normalized && Number.isFinite(parsed) ? parsed : null;
}

function addDays(date, days) {
  const parsed = dateOnly(date);
  const count = number(days);
  if (!parsed || count == null) return null;
  const result = new Date(`${parsed}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + Math.trunc(count));
  return result.toISOString().slice(0, 10);
}

function daysBetweenDates(fromDate, toDate) {
  const from = dateOnly(fromDate);
  const to = dateOnly(toDate);
  if (!from || !to) return null;
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / ONE_DAY_MS);
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
  return ['open_recent', 'open', 'all'].includes(scope) ? scope : 'open';
}

export function creditExposureDeliveryDate(stem = {}) {
  return dateOnly(stem.Delivery_Date__c) || dateOnly(stem.Expected_Delivery_Date__c);
}

export function isCreditExposureStemEligible(stem = {}, startDate = CREDIT_EXPOSURE_DELIVERY_START) {
  const deliveryDate = creditExposureDeliveryDate(stem);
  const cutoff = dateOnly(startDate);
  return Boolean(deliveryDate && cutoff && deliveryDate >= cutoff);
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
  const groups = accountChain.filter((account) => account?.Inactive_Suspended__c !== true && /^GROUP(?:\s*-|\s|$)/i.test(text(account?.Name || account?.name)));
  return groups.at(-1) || null;
}

export function accountCreditSnapshot(account = {}, currency = null) {
  const category = ['Individual', 'Group', 'Special'].includes(account.CL_Category__c)
    ? account.CL_Category__c
    : null;
  const snapshot = {
    category,
    currency: text(currency || account.CurrencyIsoCode) || SALESFORCE_CORPORATE_CURRENCY,
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

export function accountCreditPolicy(snapshot = {}) {
  const category = text(snapshot.category);
  const specialIndividualLimit = number(snapshot.specialIndividualLimit);
  if (category === 'Individual') {
    return {
      code: 'individual_only',
      label: 'Individual only',
      explanation: 'This Account uses only its individual credit limit and cannot share GROUP credit.',
      formula: 'CL_Individual__c − CL_Used_Customer__c',
    };
  }
  if (category === 'Group') {
    return {
      code: 'group_shared_uncapped',
      label: 'GROUP shared · no individual cap',
      explanation: 'This Account shares the remaining GROUP credit line without a separate individual cap.',
      formula: 'CL_Group__c − CL_Used_Group__c',
    };
  }
  if (category === 'Special' && specialIndividualLimit == null) {
    return {
      code: 'special_legacy_fallback',
      label: 'Special · legacy Salesforce fallback',
      explanation: 'The special individual limit is blank, so Salesforce applies its legacy Special-category fallback.',
      formula: 'MAX(CL_Individual__c, CL_Used_Customer__c)',
    };
  }
  if (category === 'Special') {
    return {
      code: specialIndividualLimit === 0 ? 'group_shared_zero_cap' : 'group_shared_special_cap',
      label: specialIndividualLimit === 0 ? 'GROUP shared · zero special cap' : 'GROUP shared · special cap',
      explanation: specialIndividualLimit === 0
        ? 'This Account is linked to GROUP credit but its special individual cap is zero, so no GROUP credit is available to it.'
        : 'This Account shares GROUP credit subject to both its special individual cap and the remaining GROUP capacity.',
      formula: 'MIN(CL_Special__c − CL_Used_Customer__c, CL_Group__c + CL_Special_Group__c − CL_Used_Group__c)',
    };
  }
  return {
    code: 'unavailable',
    label: 'Credit category unavailable',
    explanation: 'Salesforce did not provide a supported credit category, so FCOS does not calculate category availability.',
    formula: null,
  };
}

export function normalizeCreditAccountName(name) {
  return text(name).replace(/\s+/g, ' ').toUpperCase();
}

function compatibleCreditValue(left, right, tolerance = CREDIT_RECONCILIATION_TOLERANCE) {
  const first = number(left);
  const second = number(right);
  if (first == null || second == null) return first == null && second == null;
  return Math.abs(first - second) <= tolerance;
}

function compatibleCreditSnapshot(selectedAccount = {}, candidate = {}) {
  if (text(selectedAccount.CL_Category__c) !== text(candidate.CL_Category__c)) return false;
  return [
    'CL_Individual__c',
    'CL_Special__c',
    'CL_Group__c',
    'CL_Special_Group__c',
  ].every((field) => compatibleCreditValue(selectedAccount[field], candidate[field]));
}

function accountGroupKey(group) {
  return idKey(group?.Id || group?.id);
}

export function resolveCreditSnapshotCandidate({
  selectedAccount,
  selectedGroup = null,
  candidates = [],
  candidateGroupsById = {},
  openStems = [],
  complete = true,
} = {}) {
  const selectedId = idKey(selectedAccount?.Id);
  const selectedName = normalizeCreditAccountName(selectedAccount?.Name);
  const selectedGroupId = accountGroupKey(selectedGroup);
  if (!selectedId || !selectedName || !complete) return { status: 'unresolved', matches: [] };
  const candidatePool = [...new Map([selectedAccount, ...(candidates || [])]
    .filter((candidate) => idKey(candidate?.Id))
    .map((candidate) => [idKey(candidate.Id), candidate])).values()];
  const lineageWindows = [...new Map(candidatePool
    .map((candidate) => [dateTime(candidate.CreatedDate), candidate])
    .filter(([created]) => created != null)).entries()]
    .map(([created, source]) => ({ created, source }));
  const matches = [];
  const seenMatches = new Set();
  for (const candidate of candidatePool) {
    if (normalizeCreditAccountName(candidate.Name) !== selectedName) continue;
    if (!compatibleCreditSnapshot(selectedAccount, candidate)) continue;
    const candidateGroup = idKey(candidate.Id) === selectedId
      ? selectedGroup
      : candidateGroupsById[idKey(candidate.Id)] || null;
    if (accountGroupKey(candidateGroup) !== selectedGroupId) continue;
    for (const lineageWindow of lineageWindows) {
      const windowStart = String(lineageWindow.source.CreatedDate).slice(0, 10);
      const matchKey = `${idKey(candidate.Id)}:${windowStart}`;
      if (seenMatches.has(matchKey)) continue;
      seenMatches.add(matchKey);
      const windowStems = (openStems || []).filter((stem) => {
        const created = dateTime(stem?.CreatedDate);
        return created != null && created >= lineageWindow.created;
      });
      const individualExposure = windowStems
        .filter((stem) => idKey(stem.Account__c) === selectedId)
        .reduce((sum, stem) => sum + value(stem.QLIK_Receivable_Balance__c), 0);
      const groupExposure = windowStems.reduce((sum, stem) => sum + value(stem.QLIK_Receivable_Balance__c), 0);
      const snapshot = accountCreditSnapshot(candidate);
      const individual = reconcileCreditExposure(snapshot.usedCustomer, individualExposure, { complete });
      const group = reconcileCreditExposure(snapshot.usedGroup, groupExposure, { complete });
      if (individual.matches && group.matches) {
        matches.push({
          candidate,
          candidateGroup,
          windowSource: lineageWindow.source,
          windowStart,
          windowStems,
          individual,
          group,
        });
      }
    }
  }
  const distinctMatches = [...matches.reduce((resolved, match) => {
    const stemSet = match.windowStems.map((stem) => idKey(stem.Id)).filter(Boolean).sort().join(',');
    const key = `${idKey(match.candidate.Id)}:${stemSet}`;
    const existing = resolved.get(key);
    if (!existing || match.windowStart > existing.windowStart) resolved.set(key, match);
    return resolved;
  }, new Map()).values()];
  return distinctMatches.length === 1
    ? { status: 'resolved', ...distinctMatches[0], matches: distinctMatches.map((match) => match.candidate.Id) }
    : { status: distinctMatches.length ? 'ambiguous' : 'unresolved', matches: distinctMatches.map((match) => match.candidate.Id) };
}

export function accountCreditBalances(snapshot = {}, overrides = {}) {
  const usedCustomer = number(overrides.usedCustomer) ?? number(snapshot.usedCustomer);
  const usedGroup = number(overrides.usedGroup) ?? number(snapshot.usedGroup);
  const individualLimit = number(snapshot.individualLimit);
  const specialIndividualLimit = number(snapshot.specialIndividualLimit);
  const groupLimit = number(snapshot.groupLimit);
  const specialGroupLimit = number(snapshot.specialGroupLimit);
  const category = snapshot.category;
  const policy = accountCreditPolicy({ ...snapshot, category, specialIndividualLimit });
  let individualCapacity = null;
  let groupCapacity = null;
  let individualBalance = null;
  let groupBalance = null;
  let calculatedAvailable = null;
  if (category === 'Individual') {
    individualCapacity = individualLimit;
    individualBalance = individualCapacity == null || usedCustomer == null ? null : individualCapacity - usedCustomer;
    calculatedAvailable = individualBalance;
  } else if (category === 'Group') {
    groupCapacity = groupLimit;
    groupBalance = groupCapacity == null || usedGroup == null ? null : groupCapacity - usedGroup;
    calculatedAvailable = groupBalance;
  }
  else if (category === 'Special') {
    groupCapacity = value(groupLimit) + value(specialGroupLimit);
    groupBalance = usedGroup == null ? null : groupCapacity - usedGroup;
    if (specialIndividualLimit == null) {
      calculatedAvailable = Math.max(value(individualLimit), value(usedCustomer));
    } else {
      individualCapacity = specialIndividualLimit;
      individualBalance = usedCustomer == null ? null : individualCapacity - usedCustomer;
      calculatedAvailable = individualBalance == null || groupBalance == null ? null : Math.min(individualBalance, groupBalance);
    }
  }
  const salesforceAvailable = number(snapshot.salesforceAvailable);
  const availableDifference = calculatedAvailable == null || salesforceAvailable == null
    ? null
    : currencyAmount(calculatedAvailable - salesforceAvailable);
  const availableComparison = {
    comparable: availableDifference != null,
    difference: availableDifference,
    materiallyDifferent: availableDifference != null && Math.abs(availableDifference) > CREDIT_RECONCILIATION_TOLERANCE,
    tolerance: CREDIT_RECONCILIATION_TOLERANCE,
    formula: policy.formula,
    explanation: policy.explanation,
  };
  const referenceLimits = [];
  if (category === 'Individual' && individualLimit > 0) {
    referenceLimits.push({ key: 'individual_limit', scope: 'account', label: 'Individual limit', value: individualLimit });
  } else if (category === 'Group' && groupLimit > 0) {
    referenceLimits.push({ key: 'group_limit', scope: 'group', label: 'GROUP limit', value: groupLimit });
  } else if (category === 'Special') {
    if (specialIndividualLimit > 0) referenceLimits.push({ key: 'special_account_cap', scope: 'account', label: 'Special Account cap', value: specialIndividualLimit });
    if (groupCapacity > 0) referenceLimits.push({ key: 'special_group_capacity', scope: 'group', label: 'GROUP capacity', value: groupCapacity });
  }
  return {
    individualCapacity,
    groupCapacity,
    individualBalance,
    groupBalance,
    calculatedAvailable,
    policy,
    availableComparison,
    referenceLimits,
  };
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
    currency: text(stem.CurrencyIsoCode) || SALESFORCE_CORPORATE_CURRENCY,
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

export function buildCreditReleaseChart({
  releases = [],
  selectedAccountId,
  openingIndividualExposure = null,
  openingGroupExposure = null,
  individualProjection = true,
  groupProjection = true,
  today,
}) {
  const forecast = releases.flatMap((release) => release.forecastEvents.map((event) => ({
    ...event,
    stemId: release.stemId,
    stemName: release.stemName,
    accountId: release.accountId,
    accountName: release.accountName,
  })));
  const future = forecast.filter((event) => event.date && event.date >= today);
  const undated = forecast.filter((event) => !event.date);
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
  let individualExposure = currencyAmount(openingIndividualExposure);
  let groupExposure = currencyAmount(openingGroupExposure);
  const points = [{
    date: today,
    accountRelease: 0,
    otherGroupRelease: 0,
    individualExposure: individualProjection ? individualExposure : null,
    groupExposure: groupProjection ? groupExposure : null,
    events: [],
  }];
  for (const bucket of [...buckets.values()].sort((left, right) => left.date.localeCompare(right.date))) {
    if (individualExposure != null) individualExposure = currencyAmount(individualExposure - bucket.accountRelease);
    if (groupExposure != null) groupExposure = currencyAmount(groupExposure - bucket.accountRelease - bucket.otherGroupRelease);
    points.push({
      ...bucket,
      individualExposure: individualProjection ? individualExposure : null,
      groupExposure: groupProjection ? groupExposure : null,
    });
  }
  if (individualProjection || groupProjection) {
    const lastDate = points.at(-1)?.date || today;
    const plateauDays = granularity === 'month' ? 31 : granularity === 'week' ? 7 : 14;
    points.push({
      date: addDays(lastDate, plateauDays),
      accountRelease: 0,
      otherGroupRelease: 0,
      individualExposure: individualProjection ? individualExposure : null,
      groupExposure: groupProjection ? groupExposure : null,
      events: [],
      residualPlateau: true,
    });
  }
  const undatedStems = [...new Map(undated.map((event) => [idKey(event.stemId), {
    stemId: event.stemId,
    stemName: event.stemName,
    accountId: event.accountId,
    accountName: event.accountName,
    amount: event.amount,
    source: event.source,
    sourceLabel: event.sourceLabel,
    missedReleaseDate: event.missedDate || null,
  }])).values()];
  const undatedAccountStems = undatedStems.filter((stem) => idKey(stem.accountId) === idKey(selectedAccountId));
  return {
    granularity,
    points,
    exactEventCount: future.length,
    undatedExposure: {
      individual: currencyAmount(undated.filter((event) => idKey(event.accountId) === idKey(selectedAccountId)).reduce((sum, event) => sum + value(event.amount), 0)),
      group: currencyAmount(undated.reduce((sum, event) => sum + value(event.amount), 0)),
    },
    undatedStemCount: undatedStems.length,
    undatedAccountStemCount: undatedAccountStems.length,
    undatedGroupStemCount: undatedStems.length,
    undatedAccountStems,
    undatedStems,
  };
}

function expectedInvoiceQuantity(item, maxField) {
  if (item?.Is_Quantity_Range__c === true) {
    const maximum = number(item?.[maxField]);
    return maximum == null
      ? { complete: false, quantity: null, basis: 'range_max_quantity' }
      : { complete: true, quantity: maximum, basis: 'range_max_quantity' };
  }
  const ordered = number(item?.Quantity__c);
  return ordered == null
    ? { complete: false, quantity: null, basis: 'ordered_quantity' }
    : { complete: true, quantity: ordered, basis: 'ordered_quantity' };
}

function firstNumeric(...values) {
  for (const candidate of values) {
    const parsed = number(candidate);
    if (parsed != null) return parsed;
  }
  return null;
}

export function expectedBuyerInvoiceEstimate({
  lineItems = [],
  extraCosts = [],
  complete = true,
} = {}) {
  const activeLineItems = lineItems.filter((item) => item?.Cancelled__c !== true);
  const activeExtraCosts = extraCosts.filter((item) => item?.Cancelled__c !== true);
  if (!complete) {
    return {
      amount: null,
      complete: false,
      source: 'ordered_buyer_lines',
      basis: null,
      blockingReason: 'Expected invoice evidence is incomplete in Salesforce.',
    };
  }
  if (!activeLineItems.length && !activeExtraCosts.length) {
    return {
      amount: null,
      complete: false,
      source: 'ordered_buyer_lines',
      basis: null,
      blockingReason: 'No active buyer-billable rows are available for the expected invoice calculation.',
    };
  }

  let amount = 0;
  let usesMaximumQuantity = false;
  let missingInput = false;
  for (const item of activeLineItems) {
    const quantity = expectedInvoiceQuantity(item, 'Quantity_Max__c');
    const unitPrice = firstNumeric(item.Price_Per_Unit__c, item.Unit_Sell_At__c, item.Offer_Line_Item__r?.UnitPrice);
    if (!quantity.complete || unitPrice == null) {
      missingInput = true;
      continue;
    }
    amount += unitPrice * quantity.quantity;
    if (quantity.basis === 'range_max_quantity') usesMaximumQuantity = true;
  }
  for (const item of activeExtraCosts) {
    const unitPrice = number(item.Unit_Price__c);
    if (unitPrice == null) {
      const fixedAmount = number(item.Line_Total__c);
      if (fixedAmount == null) missingInput = true;
      else amount += fixedAmount;
      continue;
    }
    const quantity = expectedInvoiceQuantity(item, 'Quantity_Range_Max__c');
    if (!quantity.complete) {
      missingInput = true;
      continue;
    }
    amount += unitPrice * quantity.quantity;
    if (quantity.basis === 'range_max_quantity') usesMaximumQuantity = true;
  }
  if (missingInput) {
    return {
      amount: null,
      complete: false,
      source: 'ordered_buyer_lines',
      basis: usesMaximumQuantity ? 'range_max_quantity' : 'ordered_quantity',
      blockingReason: 'One or more active buyer-billable rows lack an ordered quantity or sell price.',
    };
  }
  return {
    amount: currencyAmount(amount),
    complete: true,
    source: 'ordered_buyer_lines',
    basis: usesMaximumQuantity ? 'range_max_quantity' : 'ordered_quantity',
    blockingReason: null,
  };
}

export function buildAccountCreditStatement({
  account,
  creditAccount = account,
  creditResolution = null,
  group,
  groupMembers = [],
  openStems = [],
  statementStems = [],
  paymentsByStem = {},
  cashflowsByStem = {},
  buyerInvoicesByStem = {},
  buyerInvoiceScopeComplete = true,
  expectedInvoiceLineItemsByStem = {},
  expectedInvoiceExtraCostsByStem = {},
  expectedInvoiceScopeComplete = true,
  today,
  complete = true,
  warnings = [],
} = {}) {
  const selectedAccountId = account?.Id;
  const snapshot = accountCreditSnapshot(creditAccount);
  const stemCurrency = (stem) => text(stem?.CurrencyIsoCode) || snapshot.currency;
  const currencyLabels = [...new Set([...openStems, ...statementStems]
    .map(stemCurrency)
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
      .filter((stem) => idKey(stem.Account__c) === idKey(selectedAccountId) && stemCurrency(stem) === currency)
      .reduce((sum, stem) => sum + value(stem.QLIK_Receivable_Balance__c), 0),
    group: openStems
      .filter((stem) => stemCurrency(stem) === currency)
      .reduce((sum, stem) => sum + value(stem.QLIK_Receivable_Balance__c), 0),
  }]));
  const individualReconciliation = reconcileCreditExposure(snapshot.usedCustomer, currencyConflict ? null : accountExposure, { complete: projectionComplete });
  const groupReconciliation = group
    ? reconcileCreditExposure(snapshot.usedGroup, currencyConflict ? null : groupExposure, { complete: projectionComplete })
    : { complete: true, matches: true, expected: snapshot.usedGroup, reconstructed: groupExposure, difference: 0, tolerance: CREDIT_RECONCILIATION_TOLERANCE, notApplicable: true };
  const chart = buildCreditReleaseChart({
    releases: projectionComplete ? releases : [],
    selectedAccountId,
    openingIndividualExposure: accountExposure,
    openingGroupExposure: groupExposure,
    individualProjection: individualReconciliation.matches,
    groupProjection: Boolean(group && groupReconciliation.matches),
    today,
  });
  const releaseByStem = new Map(releases.map((release) => [idKey(release.stemId), release]));
  const rows = statementStems.map((stem) => {
    const projectionRelease = releaseByStem.get(idKey(stem.Id));
    const release = projectionRelease || buildStemCreditRelease({
      stem,
      payments: paymentsByStem[stem.Id] || [],
      cashflows: cashflowsByStem[stem.Id] || [],
      today,
      accountId: stem.Account__c,
      accountName: stem.Account__r?.Name || null,
      currency: text(stem.CurrencyIsoCode) || snapshot.currency,
    });
    const actualReleased = release.actualReleases.reduce((sum, row) => sum + value(row.amount), 0);
    const buyerInvoices = buyerInvoicesByStem[stem.Id] || [];
    const buyerInvoiceAmounts = buyerInvoices.map((invoice) => number(invoice.Amount__c));
    const buyerInvoiceAmountComplete = buyerInvoiceScopeComplete && buyerInvoices.length > 0 && buyerInvoiceAmounts.every((amount) => amount != null);
    const buyerInvoiceDueDates = [...new Set(buyerInvoices.map((invoice) => dateOnly(invoice.Invoice_Due_Date__c)).filter(Boolean))].sort();
    const buyerInvoiceDueDate = buyerInvoiceDueDates[0] || null;
    const expectedDueCandidate = releaseCandidate(stem, cashflowsByStem[stem.Id] || [], dateOnly(today));
    const expectedBuyerInvoiceDueDate = expectedDueCandidate.date || expectedDueCandidate.missedDate || null;
    const expectedInvoice = buyerInvoices.length ? null : expectedBuyerInvoiceEstimate({
      lineItems: expectedInvoiceLineItemsByStem[stem.Id] || [],
      extraCosts: expectedInvoiceExtraCostsByStem[stem.Id] || [],
      complete: expectedInvoiceScopeComplete,
    });
    const salesforceCurrentExposure = number(stem.QLIK_Receivable_Balance__c);
    const statementExposure = buyerInvoices.length
      ? {
        amount: salesforceCurrentExposure,
        complete: salesforceCurrentExposure != null,
        source: 'salesforce_qlik_receivable_balance',
        basis: 'salesforce_receivable_balance',
        blockingReason: salesforceCurrentExposure == null ? 'Salesforce receivable balance is unavailable.' : null,
      }
      : expectedInvoice;
    return {
      stemId: stem.Id,
      stemName: stem.Name || stem.Id,
      accountId: stem.Account__c,
      accountName: stem.Account__r?.Name || null,
      currency: text(stem.CurrencyIsoCode) || snapshot.currency,
      effectiveDate: dateOnly(stem.Delivery_Date__c || stem.Expected_Delivery_Date__c),
      invoiceStatus: stem.Invoice_Status__c || null,
      paymentTerm: stem.Payment_Term__c || null,
      currentExposure: salesforceCurrentExposure ?? 0,
      statementExposureAmount: statementExposure?.amount ?? null,
      statementExposureComplete: statementExposure?.complete === true,
      statementExposureSource: statementExposure?.source ?? null,
      statementExposureBasis: statementExposure?.basis ?? null,
      statementExposureBlockingReason: statementExposure?.blockingReason ?? null,
      actualReleased,
      latestActualReleaseDate: release.actualReleases.at(-1)?.date || dateOnly(stem.Payment_Date__c),
      releaseDate: release.releaseDate,
      releaseSource: release.releaseSource,
      releaseSourceLabel: release.releaseSourceLabel,
      missedReleaseDate: release.missedReleaseDate,
      actualReleases: release.actualReleases,
      forecastEvents: release.forecastEvents,
      inCreditProjection: Boolean(projectionRelease),
      hasBuyerInvoice: buyerInvoices.length > 0,
      buyerInvoiceCount: buyerInvoices.length,
      buyerInvoiceNames: buyerInvoices.map((invoice) => invoice.Name || invoice.Id),
      buyerInvoiceAmount: buyerInvoiceAmountComplete ? currencyAmount(buyerInvoiceAmounts.reduce((sum, amount) => sum + amount, 0)) : null,
      buyerInvoiceAmountComplete,
      buyerInvoiceDueDate,
      expectedBuyerInvoiceAmount: expectedInvoice?.amount ?? null,
      expectedBuyerInvoiceAmountComplete: expectedInvoice?.complete === true,
      expectedBuyerInvoiceAmountSource: expectedInvoice?.source ?? null,
      expectedBuyerInvoiceAmountBasis: expectedInvoice?.basis ?? null,
      expectedBuyerInvoiceAmountBlockingReason: expectedInvoice?.blockingReason ?? null,
      expectedBuyerInvoiceDueDate,
      buyerInvoiceDaysUntilDue: daysBetweenDates(today, buyerInvoiceDueDate),
      buyerInvoiceLastModifiedAt: buyerInvoices.map((invoice) => invoice.LastModifiedDate).filter(Boolean).sort().at(-1) || null,
    };
  });
  const projectionWarnings = [
    ...warnings,
    ...(!individualReconciliation.matches ? ['Individual used credit does not reconcile to the selected Account’s current buyer-leg STEM exposure. The individual projection is hidden.'] : []),
    ...(group && !groupReconciliation.matches ? ['Group used credit does not reconcile to current buyer-leg STEM exposure across the Salesforce GROUP hierarchy. The group projection is hidden.'] : []),
    ...(!complete ? ['Salesforce did not return a complete credit scope. Projected balances are hidden.'] : []),
    ...(currencyConflict ? [`Buyer-leg STEM exposure spans multiple currencies (${currencyLabels.join(', ')}). Values remain separated by row and projected balances are hidden.`] : []),
  ];
  const releaseWarnings = releases.some((release) => release.forecastEvents.some((event) => !event.date))
    ? ['One or more open STEMs have no reliable future release date. Their exposure remains visible in the final forecast plateau until reliable evidence is available.']
    : [];
  return {
    identity: {
      accountId: selectedAccountId,
      name: account?.Name || selectedAccountId,
      clKey: account?.Company_Code__c || null,
      inactive: account?.Inactive_Suspended__c === true,
    },
    group: group ? { accountId: group.Id, name: group.Name, memberCount: groupMembers.length } : null,
    creditResolution: creditResolution || {
      mode: 'selected_account',
      accountId: account?.Id || null,
      clKey: account?.Company_Code__c || null,
      reconciliationWindowStart: null,
      notice: null,
    },
    credit: snapshot,
    reconciliation: { individual: individualReconciliation, group: groupReconciliation },
    exposureByCurrency,
    releases,
    chart,
    currencies: currencyLabels.length ? currencyLabels : [snapshot.currency],
    rows,
    complete,
    projectionWarnings: [...new Set(projectionWarnings.filter(Boolean))],
    releaseWarnings,
    warnings: [...new Set([...projectionWarnings, ...releaseWarnings].filter(Boolean))],
  };
}

export const dashboardAccountCreditStatementInternals = {
  addDays,
  dateOnly,
  idKey,
  releaseCandidate,
};
