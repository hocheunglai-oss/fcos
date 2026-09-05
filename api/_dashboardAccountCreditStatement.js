const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 86_400_000;

import { SALESFORCE_CORPORATE_CURRENCY } from './_decisionDashboard.js';
import { PAYMENT_DATA_RELIABLE_FROM } from '../src/lib/paymentDataReliability.js';
import {
  BUYER_PAYMENT_CONSERVATIVENESS,
  DEFAULT_BUYER_PAYMENT_CONSERVATIVENESS,
  normalizeBuyerPaymentConservativeness,
  selectBuyerPaymentDelayModel,
} from './_buyerPaymentPerformance.js';

export const CREDIT_RECONCILIATION_TOLERANCE = 1;
export const CREDIT_EXPOSURE_DELIVERY_START = PAYMENT_DATA_RELIABLE_FROM;

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

function groupCreditSnapshotSignature(snapshot = {}) {
  const normalized = [
    snapshot.category,
    snapshot.groupLimit,
    snapshot.specialGroupLimit,
    snapshot.usedGroup,
    snapshot.salesforceAvailable,
  ].map((entry) => typeof entry === 'number' ? currencyAmount(entry) : entry ?? null);
  return JSON.stringify(normalized);
}

export function resolveGroupCreditAuthority({ group = null, members = [], openStems = [], complete = true } = {}) {
  const groupId = idKey(group?.Id);
  if (!groupId || !complete) return { status: 'unresolved', candidates: [] };
  const currencies = new Set(openStems.map((stem) => text(stem?.CurrencyIsoCode)).filter(Boolean));
  if (currencies.size > 1) return { status: 'unresolved', candidates: [] };
  const groupExposure = openStems.reduce((sum, stem) => sum + value(stem?.QLIK_Receivable_Balance__c), 0);
  const matches = (members || []).filter((member) => member?.Inactive_Suspended__c !== true).flatMap((member) => {
    const snapshot = accountCreditSnapshot(member);
    if (snapshot.category !== 'Group' || !(number(snapshot.groupLimit) > 0)) return [];
    const usedGroup = number(snapshot.usedGroup);
    const salesforceAvailable = number(snapshot.salesforceAvailable);
    if (usedGroup == null || salesforceAvailable == null) return [];
    const calculatedAvailable = number(snapshot.groupLimit) - usedGroup;
    const snapshotDifference = currencyAmount(calculatedAvailable - salesforceAvailable);
    if (snapshotDifference == null || Math.abs(snapshotDifference) > CREDIT_RECONCILIATION_TOLERANCE) return [];
    const reconciliation = reconcileCreditExposure(snapshot.usedGroup, groupExposure, { complete: true });
    return [{ member, snapshot, reconciliation, signature: groupCreditSnapshotSignature(snapshot) }];
  });
  if (!matches.length) return { status: 'unresolved', candidates: [] };
  const signatures = new Set(matches.map((match) => match.signature));
  if (signatures.size !== 1) {
    return { status: 'ambiguous', candidates: matches.map((match) => match.member.Id) };
  }
  const preferred = [...matches].sort((left, right) => {
    const leftIsRoot = idKey(left.member.Id) === groupId ? 1 : 0;
    const rightIsRoot = idKey(right.member.Id) === groupId ? 1 : 0;
    if (leftIsRoot !== rightIsRoot) return leftIsRoot - rightIsRoot;
    return text(left.member.Name).localeCompare(text(right.member.Name)) || idKey(left.member.Id).localeCompare(idKey(right.member.Id));
  })[0];
  return {
    status: 'resolved',
    candidate: preferred.member,
    reconciliation: preferred.reconciliation,
    matchingAccountIds: matches.map((match) => match.member.Id),
    groupExposure: currencyAmount(groupExposure),
  };
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

function contractualReleaseCandidate(stem, cashflows, today) {
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

export function adjustCreditForecastBusinessDay(date, today, blockedDates = []) {
  const effectiveToday = dateOnly(today);
  let current = dateOnly(date);
  if (!effectiveToday || !current) return { date: null, originalDate: null, adjusted: false };
  if (current < effectiveToday) current = effectiveToday;
  const originalDate = current;
  const blocked = blockedDates instanceof Set ? blockedDates : new Set(blockedDates || []);
  for (let guard = 0; guard < 30; guard += 1) {
    const day = new Date(`${current}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6 && !blocked.has(current)) {
      return { date: current, originalDate, adjusted: current !== dateOnly(date) };
    }
    current = addDays(current, 1);
  }
  return { date: originalDate, originalDate, adjusted: originalDate !== dateOnly(date) };
}

function releaseCandidate(stem, cashflows, today, paymentModel = null, blockedDates = []) {
  const contractual = contractualReleaseCandidate(stem, cashflows, today);
  if (!contractual.date && !contractual.missedDate) return contractual;
  if (!paymentModel) return contractual;
  const contractualDate = contractual.date || contractual.missedDate;
  const modeledDate = addDays(contractualDate, paymentModel.predictedDelayDays || 0);
  const adjusted = adjustCreditForecastBusinessDay(modeledDate, today, blockedDates);
  const forecastLabel = paymentModel.conservativeness && paymentModel.percentileLabel
    ? `${paymentModel.conservativeness.charAt(0).toUpperCase()}${paymentModel.conservativeness.slice(1)} ${paymentModel.percentileLabel} payment forecast`
    : 'Payment-performance forecast';
  return {
    date: adjusted.date,
    missedDate: null,
    source: 'payment_performance_forecast',
    sourceLabel: forecastLabel,
    contractualSource: contractual.source,
    contractualSourceLabel: contractual.sourceLabel,
    contractualDate,
    modeledDate,
    predictedDelayDays: paymentModel.predictedDelayDays || 0,
    modelLevel: paymentModel.level || 'Default',
    modelSampleCount: paymentModel.sampleCount || 0,
    modelConfidence: paymentModel.confidence || 'Low',
    conservativeness: paymentModel.conservativeness || null,
    percentileLabel: paymentModel.percentileLabel || null,
    businessDayAdjusted: adjusted.adjusted,
  };
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

function forecastEventsForExposure({ exposure, futurePayments, cashflows, stem, today, paymentModel, blockedDates }) {
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
    for (const scheduled of scheduledReleases(cashflows, today)) {
      const proposed = scheduled.amount == null ? remaining : scheduled.amount;
      const released = Math.min(Math.max(proposed, 0), remaining);
      if (!(released > 0)) continue;
      forecastEvents.push({ ...scheduled, amount: released });
      remaining -= released;
      if (remaining <= 0.01) break;
    }
  }
  if (Math.abs(remaining) > 0.01) {
    const candidate = releaseCandidate(stem, cashflows, today, paymentModel, blockedDates);
    forecastEvents.push({ ...candidate, amount: remaining });
  }
  return forecastEvents;
}

export function buildStemCreditRelease({ stem = {}, payments = [], cashflows = [], today, accountId, paymentModel = null, blockedDates = [], exposureRange = null }) {
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
  const forecastEvents = forecastEventsForExposure({ exposure, futurePayments, cashflows, stem, today: effectiveToday, paymentModel, blockedDates });
  const rangeComplete = exposureRange?.complete === true
    && number(exposureRange.minimumExposure) != null
    && number(exposureRange.maximumExposure) != null;
  const minimumForecastEvents = rangeComplete
    ? forecastEventsForExposure({ exposure: number(exposureRange.minimumExposure), futurePayments, cashflows, stem, today: effectiveToday, paymentModel, blockedDates })
    : [];
  const maximumForecastEvents = rangeComplete
    ? forecastEventsForExposure({ exposure: number(exposureRange.maximumExposure), futurePayments, cashflows, stem, today: effectiveToday, paymentModel, blockedDates })
    : [];
  const primaryForecast = forecastEvents.find((event) => event.date) || forecastEvents[0] || null;
  return {
    stemId: stem.Id,
    stemName: stem.Name || stem.Id,
    accountId: stem.Account__c || accountId || null,
    accountName: stem.Account__r?.Name || null,
    currency: text(stem.CurrencyIsoCode) || SALESFORCE_CORPORATE_CURRENCY,
    currentExposure: exposure,
    exposureRange: exposureRange || null,
    actualReleases,
    forecastEvents,
    minimumForecastEvents,
    maximumForecastEvents,
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
  const decorateEvents = (release, events, scenario) => events.map((event) => ({
    ...event,
    stemId: release.stemId,
    stemName: release.stemName,
    accountId: release.accountId,
    accountName: release.accountName,
    scenario,
  }));
  const forecast = releases.flatMap((release) => decorateEvents(release, release.forecastEvents, 'midpoint'));
  const rangeComplete = releases.length > 0 && releases.every((release) => release.exposureRange?.complete === true);
  const minimumForecast = rangeComplete
    ? releases.flatMap((release) => decorateEvents(release, release.minimumForecastEvents, 'minimum'))
    : [];
  const maximumForecast = rangeComplete
    ? releases.flatMap((release) => decorateEvents(release, release.maximumForecastEvents, 'maximum'))
    : [];
  const future = forecast.filter((event) => event.date && event.date >= today);
  const minimumFuture = minimumForecast.filter((event) => event.date && event.date >= today);
  const maximumFuture = maximumForecast.filter((event) => event.date && event.date >= today);
  const undated = forecast.filter((event) => !event.date);
  const granularity = chartGranularity([...future, ...minimumFuture, ...maximumFuture]);
  const bucketDate = granularity === 'month' ? monthStart : granularity === 'week' ? startOfWeek : (date) => date;
  const buckets = new Map();
  const addToBucket = (event) => {
    const date = bucketDate(event.date);
    const current = buckets.get(date) || {
      date,
      accountRelease: 0,
      otherGroupRelease: 0,
      minimumAccountRelease: 0,
      minimumOtherGroupRelease: 0,
      maximumAccountRelease: 0,
      maximumOtherGroupRelease: 0,
      events: [],
    };
    const selected = idKey(event.accountId) === idKey(selectedAccountId);
    if (event.scenario === 'minimum') {
      if (selected) current.minimumAccountRelease += event.amount;
      else current.minimumOtherGroupRelease += event.amount;
    } else if (event.scenario === 'maximum') {
      if (selected) current.maximumAccountRelease += event.amount;
      else current.maximumOtherGroupRelease += event.amount;
    } else {
      if (selected) current.accountRelease += event.amount;
      else current.otherGroupRelease += event.amount;
      current.events.push(event);
    }
    buckets.set(date, current);
  };
  for (const event of [...future, ...minimumFuture, ...maximumFuture]) {
    addToBucket(event);
  }
  let individualExposure = currencyAmount(openingIndividualExposure);
  let groupExposure = currencyAmount(openingGroupExposure);
  let individualExposureMinimum = rangeComplete ? currencyAmount(releases
    .filter((release) => idKey(release.accountId) === idKey(selectedAccountId))
    .reduce((sum, release) => sum + value(release.exposureRange?.minimumExposure), 0)) : null;
  let individualExposureMaximum = rangeComplete ? currencyAmount(releases
    .filter((release) => idKey(release.accountId) === idKey(selectedAccountId))
    .reduce((sum, release) => sum + value(release.exposureRange?.maximumExposure), 0)) : null;
  let groupExposureMinimum = rangeComplete ? currencyAmount(releases
    .reduce((sum, release) => sum + value(release.exposureRange?.minimumExposure), 0)) : null;
  let groupExposureMaximum = rangeComplete ? currencyAmount(releases
    .reduce((sum, release) => sum + value(release.exposureRange?.maximumExposure), 0)) : null;
  const points = [{
    date: today,
    accountRelease: 0,
    otherGroupRelease: 0,
    individualExposure: individualProjection ? individualExposure : null,
    groupExposure: groupProjection ? groupExposure : null,
    individualExposureMinimum: individualProjection ? individualExposureMinimum : null,
    individualExposureMaximum: individualProjection ? individualExposureMaximum : null,
    groupExposureMinimum: groupProjection ? groupExposureMinimum : null,
    groupExposureMaximum: groupProjection ? groupExposureMaximum : null,
    events: [],
  }];
  for (const bucket of [...buckets.values()].sort((left, right) => left.date.localeCompare(right.date))) {
    if (individualExposure != null) individualExposure = currencyAmount(individualExposure - bucket.accountRelease);
    if (groupExposure != null) groupExposure = currencyAmount(groupExposure - bucket.accountRelease - bucket.otherGroupRelease);
    if (individualExposureMinimum != null) individualExposureMinimum = currencyAmount(individualExposureMinimum - bucket.minimumAccountRelease);
    if (individualExposureMaximum != null) individualExposureMaximum = currencyAmount(individualExposureMaximum - bucket.maximumAccountRelease);
    if (groupExposureMinimum != null) groupExposureMinimum = currencyAmount(groupExposureMinimum - bucket.minimumAccountRelease - bucket.minimumOtherGroupRelease);
    if (groupExposureMaximum != null) groupExposureMaximum = currencyAmount(groupExposureMaximum - bucket.maximumAccountRelease - bucket.maximumOtherGroupRelease);
    points.push({
      ...bucket,
      individualExposure: individualProjection ? individualExposure : null,
      groupExposure: groupProjection ? groupExposure : null,
      individualExposureMinimum: individualProjection ? individualExposureMinimum : null,
      individualExposureMaximum: individualProjection ? individualExposureMaximum : null,
      groupExposureMinimum: groupProjection ? groupExposureMinimum : null,
      groupExposureMaximum: groupProjection ? groupExposureMaximum : null,
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
      individualExposureMinimum: individualProjection ? individualExposureMinimum : null,
      individualExposureMaximum: individualProjection ? individualExposureMaximum : null,
      groupExposureMinimum: groupProjection ? groupExposureMinimum : null,
      groupExposureMaximum: groupProjection ? groupExposureMaximum : null,
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
    range: {
      complete: rangeComplete,
      hasRange: releases.some((release) => release.exposureRange?.hasRange === true),
      basis: 'salesforce_qlik_midpoint_with_fcos_minimum_maximum',
    },
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

function exposureQuantityScenario(item, maxField) {
  const delivered = number(item?.Quantity_Delivered_Per_BDN__c);
  if (delivered != null && Math.abs(delivered) > 0.005) {
    return {
      complete: true,
      minimum: delivered,
      midpoint: delivered,
      maximum: delivered,
      basis: 'delivered_bdn',
      isRange: false,
    };
  }
  const ordered = number(item?.Quantity__c);
  if (item?.Is_Quantity_Range__c === true) {
    const maximum = number(item?.[maxField]);
    if (ordered == null || maximum == null || maximum < ordered) {
      return { complete: false, minimum: null, midpoint: null, maximum: null, basis: 'range_midpoint', isRange: true };
    }
    return {
      complete: true,
      minimum: ordered,
      midpoint: ordered + ((maximum - ordered) / 2),
      maximum,
      basis: 'range_midpoint',
      isRange: maximum > ordered,
    };
  }
  return ordered == null
    ? { complete: false, minimum: null, midpoint: null, maximum: null, basis: 'ordered_quantity', isRange: false }
    : { complete: true, minimum: ordered, midpoint: ordered, maximum: ordered, basis: 'ordered_quantity', isRange: false };
}

function scenarioAmounts(quantity, unitPrice, minimumAmount = null) {
  const calculate = (value) => {
    const calculated = value * unitPrice;
    return minimumAmount == null ? calculated : Math.max(minimumAmount, calculated);
  };
  return {
    minimum: calculate(quantity.minimum),
    midpoint: calculate(quantity.midpoint),
    maximum: calculate(quantity.maximum),
  };
}

export function buildBuyerExposureRange({ lineItems = [], extraCosts = [], currentExposure = null, complete = true } = {}) {
  const activeLineItems = lineItems.filter((item) => item?.Cancelled__c !== true);
  const activeExtraCosts = extraCosts.filter((item) => item?.Cancelled__c !== true);
  const authoritativeExposure = number(currentExposure);
  if (!complete || authoritativeExposure == null) {
    return {
      complete: false,
      minimumExposure: null,
      midpointExposure: authoritativeExposure,
      maximumExposure: null,
      maximumDelta: null,
      hasRange: false,
      basis: 'salesforce_qlik_midpoint',
      blockingReason: authoritativeExposure == null ? 'Salesforce QLIK receivable exposure is unavailable.' : 'Quantity-range evidence is incomplete in Salesforce.',
      children: [],
    };
  }
  if (!activeLineItems.length && !activeExtraCosts.length) {
    return {
      complete: false,
      minimumExposure: null,
      midpointExposure: authoritativeExposure,
      maximumExposure: null,
      maximumDelta: null,
      hasRange: false,
      basis: 'salesforce_qlik_midpoint',
      blockingReason: 'No active buyer-billable rows are available for the quantity-range calculation.',
      children: [],
    };
  }

  const children = [];
  let minimumTotal = 0;
  let midpointTotal = 0;
  let maximumTotal = 0;
  let missingInput = false;
  let hasRange = false;

  for (const item of activeLineItems) {
    const quantity = exposureQuantityScenario(item, 'Quantity_Max__c');
    const unitPrice = firstNumeric(item.Price_Per_Unit__c, item.Unit_Sell_At__c, item.Offer_Line_Item__r?.UnitPrice);
    if (!quantity.complete || unitPrice == null) {
      missingInput = true;
      children.push({
        childId: item.Id || null,
        childType: 'line_item',
        complete: false,
        basis: quantity.basis,
        blockingReason: !quantity.complete ? 'Ordered, maximum, or delivered quantity is invalid.' : 'Buyer sell unit price is unavailable.',
      });
      continue;
    }
    const amounts = scenarioAmounts(quantity, unitPrice);
    minimumTotal += amounts.minimum;
    midpointTotal += amounts.midpoint;
    maximumTotal += amounts.maximum;
    hasRange = hasRange || quantity.isRange;
    children.push({
      childId: item.Id || null,
      childType: 'line_item',
      complete: true,
      basis: quantity.basis,
      minimumQuantity: quantity.minimum,
      midpointQuantity: quantity.midpoint,
      maximumQuantity: quantity.maximum,
      unitPrice,
      minimumAmount: currencyAmount(amounts.minimum),
      midpointAmount: currencyAmount(amounts.midpoint),
      maximumAmount: currencyAmount(amounts.maximum),
    });
  }

  for (const item of activeExtraCosts) {
    const fixed = item.Fixed__c === true;
    const fixedAmount = firstNumeric(item.Lumpsum_Price__c, item.Line_Total__c);
    const unitPrice = number(item.Unit_Price__c);
    if (fixed || unitPrice == null) {
      if (fixedAmount == null) {
        missingInput = true;
        children.push({ childId: item.Id || null, childType: 'extra_cost', complete: false, basis: 'fixed', blockingReason: 'Fixed buyer amount is unavailable.' });
        continue;
      }
      minimumTotal += fixedAmount;
      midpointTotal += fixedAmount;
      maximumTotal += fixedAmount;
      children.push({
        childId: item.Id || null,
        childType: 'extra_cost',
        complete: true,
        basis: 'fixed',
        minimumQuantity: null,
        midpointQuantity: null,
        maximumQuantity: null,
        unitPrice: null,
        minimumAmount: currencyAmount(fixedAmount),
        midpointAmount: currencyAmount(fixedAmount),
        maximumAmount: currencyAmount(fixedAmount),
      });
      continue;
    }
    const quantity = exposureQuantityScenario(item, 'Quantity_Range_Max__c');
    const minimumSell = number(item.Minimum_Sell_At__c);
    if (!quantity.complete) {
      missingInput = true;
      children.push({ childId: item.Id || null, childType: 'extra_cost', complete: false, basis: quantity.basis, blockingReason: 'Ordered, maximum, or delivered quantity is invalid.' });
      continue;
    }
    const amounts = scenarioAmounts(quantity, unitPrice, minimumSell);
    minimumTotal += amounts.minimum;
    midpointTotal += amounts.midpoint;
    maximumTotal += amounts.maximum;
    hasRange = hasRange || quantity.isRange;
    children.push({
      childId: item.Id || null,
      childType: 'extra_cost',
      complete: true,
      basis: quantity.basis,
      minimumQuantity: quantity.minimum,
      midpointQuantity: quantity.midpoint,
      maximumQuantity: quantity.maximum,
      unitPrice,
      minimumAmount: currencyAmount(amounts.minimum),
      midpointAmount: currencyAmount(amounts.midpoint),
      maximumAmount: currencyAmount(amounts.maximum),
    });
  }

  if (missingInput) {
    return {
      complete: false,
      minimumExposure: null,
      midpointExposure: authoritativeExposure,
      maximumExposure: null,
      maximumDelta: null,
      hasRange,
      basis: 'salesforce_qlik_midpoint',
      blockingReason: 'One or more active buyer-billable rows lack complete quantity or pricing evidence.',
      children,
    };
  }

  const midpointOffset = authoritativeExposure - midpointTotal;
  const minimumExposure = currencyAmount(midpointOffset + minimumTotal);
  const maximumExposure = currencyAmount(midpointOffset + maximumTotal);
  return {
    complete: true,
    minimumExposure,
    midpointExposure: currencyAmount(authoritativeExposure),
    maximumExposure,
    maximumDelta: currencyAmount(maximumExposure - authoritativeExposure),
    hasRange,
    basis: hasRange ? 'salesforce_qlik_midpoint_with_fcos_range' : children.some((child) => child.basis === 'delivered_bdn') ? 'delivered_bdn' : 'ordered_quantity',
    blockingReason: null,
    children,
  };
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
    const fixedPrice = number(item.Lumpsum_Price__c);
    if (fixedPrice != null) {
      amount += fixedPrice;
      continue;
    }
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
  groupScope = null,
  openStems = [],
  reconciliationOpenStems = openStems,
  statementStems = [],
  paymentsByStem = {},
  cashflowsByStem = {},
  buyerInvoicesByStem = {},
  buyerInvoiceScopeComplete = true,
  expectedInvoiceLineItemsByStem = {},
  expectedInvoiceExtraCostsByStem = {},
  expectedInvoiceScopeComplete = true,
  paymentPerformanceModels = null,
  forecastSettings = null,
  blockedForecastDates = [],
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
  const companyConservativeness = normalizeBuyerPaymentConservativeness(forecastSettings?.companyConservativeness);
  const effectiveConservativeness = normalizeBuyerPaymentConservativeness(
    forecastSettings?.effectiveConservativeness,
    companyConservativeness,
  );
  const paymentModelForStem = (stem) => paymentPerformanceModels
    ? selectBuyerPaymentDelayModel({
      buyerAccountId: stem?.Account__c,
      buyerGroupId: group?.Id || null,
      buyerGroupName: group?.Name || null,
    }, paymentPerformanceModels, forecastSettings || {}, { conservativeness: effectiveConservativeness })
    : null;
  const exposureRangeForStem = (stem) => {
    const currentExposure = number(stem?.QLIK_Receivable_Balance__c);
    if (!buyerInvoiceScopeComplete) {
      return {
        complete: false,
        minimumExposure: null,
        midpointExposure: currentExposure,
        maximumExposure: null,
        maximumDelta: null,
        hasRange: false,
        basis: 'salesforce_qlik_midpoint',
        blockingReason: 'Buyer Invoice scope is incomplete, so FCOS cannot determine whether range evidence applies.',
        children: [],
      };
    }
    if ((buyerInvoicesByStem[stem.Id] || []).length) {
      return {
        complete: currentExposure != null,
        minimumExposure: currentExposure,
        midpointExposure: currentExposure,
        maximumExposure: currentExposure,
        maximumDelta: currentExposure == null ? null : 0,
        hasRange: false,
        basis: 'issued_receivable',
        blockingReason: currentExposure == null ? 'Salesforce QLIK receivable exposure is unavailable.' : null,
        children: [],
      };
    }
    return buildBuyerExposureRange({
      lineItems: expectedInvoiceLineItemsByStem[stem.Id] || [],
      extraCosts: expectedInvoiceExtraCostsByStem[stem.Id] || [],
      currentExposure,
      complete: expectedInvoiceScopeComplete,
    });
  };
  const exposureRangesByStem = Object.fromEntries(openStems.map((stem) => [stem.Id, exposureRangeForStem(stem)]));
  const releases = openStems.map((stem) => buildStemCreditRelease({
    stem,
    payments: paymentsByStem[stem.Id] || [],
    cashflows: cashflowsByStem[stem.Id] || [],
    today,
    accountId: stem.Account__c,
    paymentModel: paymentModelForStem(stem),
    blockedDates: blockedForecastDates,
    exposureRange: exposureRangesByStem[stem.Id],
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
    ? groupScope?.partial || groupScope?.operationalSubset
      ? {
        complete: projectionComplete,
        matches: projectionComplete,
        expected: null,
        reconstructed: groupExposure,
        difference: null,
        tolerance: CREDIT_RECONCILIATION_TOLERANCE,
        scoped: true,
        explanation: 'The displayed exposure is an operational subset and is not treated as a reconstruction of Salesforce’s maintained GROUP used-credit snapshot.',
      }
      : reconcileCreditExposure(
        snapshot.usedGroup,
        currencyConflict ? null : reconciliationOpenStems.reduce((sum, stem) => sum + value(stem.QLIK_Receivable_Balance__c), 0),
        { complete: projectionComplete },
      )
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
      paymentModel: paymentModelForStem(stem),
      blockedDates: blockedForecastDates,
      exposureRange: exposureRangesByStem[stem.Id] || exposureRangeForStem(stem),
    });
    const actualReleased = release.actualReleases.reduce((sum, row) => sum + value(row.amount), 0);
    const buyerInvoices = buyerInvoicesByStem[stem.Id] || [];
    const buyerInvoiceAmounts = buyerInvoices.map((invoice) => number(invoice.Amount__c));
    const buyerInvoiceAmountComplete = buyerInvoiceScopeComplete && buyerInvoices.length > 0 && buyerInvoiceAmounts.every((amount) => amount != null);
    const buyerInvoiceDueDates = [...new Set(buyerInvoices.map((invoice) => dateOnly(invoice.Invoice_Due_Date__c)).filter(Boolean))].sort();
    const buyerInvoiceDueDate = buyerInvoiceDueDates[0] || null;
    const expectedDueCandidate = contractualReleaseCandidate(stem, cashflowsByStem[stem.Id] || [], dateOnly(today));
    const expectedBuyerInvoiceDueDate = expectedDueCandidate.date || expectedDueCandidate.missedDate || null;
    const expectedInvoice = buyerInvoices.length ? null : expectedBuyerInvoiceEstimate({
      lineItems: expectedInvoiceLineItemsByStem[stem.Id] || [],
      extraCosts: expectedInvoiceExtraCostsByStem[stem.Id] || [],
      complete: expectedInvoiceScopeComplete,
    });
    const salesforceCurrentExposure = number(stem.QLIK_Receivable_Balance__c);
    const statementExposure = {
      amount: salesforceCurrentExposure,
      complete: salesforceCurrentExposure != null,
      source: 'salesforce_qlik_receivable_balance',
      basis: buyerInvoices.length ? 'issued_receivable' : 'salesforce_qlik_midpoint',
      blockingReason: salesforceCurrentExposure == null ? 'Salesforce receivable balance is unavailable.' : null,
    };
    const exposureRange = exposureRangesByStem[stem.Id] || exposureRangeForStem(stem);
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
      exposureRange,
      buyerInvoiceDaysUntilDue: daysBetweenDates(today, buyerInvoiceDueDate),
      buyerInvoiceLastModifiedAt: buyerInvoices.map((invoice) => invoice.LastModifiedDate).filter(Boolean).sort().at(-1) || null,
    };
  });
  const projectionWarnings = [
    ...warnings,
    ...(!individualReconciliation.matches ? ['Individual used credit does not reconcile to the selected Account’s current buyer-leg STEM exposure. The individual projection is hidden.'] : []),
    ...(creditResolution?.mode === 'group_hierarchy_authority' && creditResolution?.reconciliation?.complete && !creditResolution.reconciliation.matches
      ? [`Salesforce GROUP used credit does not currently reconcile to live buyer QLIK exposure within the ${CREDIT_RECONCILIATION_TOLERANCE}-unit tolerance. The Salesforce limit, used credit, and effective available credit remain the authoritative snapshot; the selected-Account forecast continues from live buyer exposure.`]
      : []),
    ...(creditResolution?.mode === 'group_hierarchy_authority' && creditResolution?.reconciliation?.complete === false
      ? ['The Salesforce GROUP credit snapshot could not be compared with a complete live buyer QLIK exposure scope. Salesforce credit values remain authoritative.']
      : []),
    ...(groupScope?.partial ? ['The GROUP forecast includes only the selected active Accounts. Salesforce’s effective available credit and used-credit fields still describe the full GROUP.'] : []),
    ...(groupScope?.operationalSubset && !groupScope?.partial ? ['The GROUP forecast uses the operational buyer-leg exposure scope from 1 January 2026. Salesforce’s used-credit and effective-available fields remain the authoritative full GROUP snapshot.'] : []),
    ...(!complete ? ['Salesforce did not return a complete credit scope. Projected balances are hidden.'] : []),
    ...(currencyConflict ? [`Buyer-leg STEM exposure spans multiple currencies (${currencyLabels.join(', ')}). Values remain separated by row and projected balances are hidden.`] : []),
  ];
  const releaseWarnings = releases.some((release) => release.forecastEvents.some((event) => !event.date))
    ? ['One or more open STEMs have no reliable future release date. Their exposure remains visible in the final forecast plateau until reliable evidence is available.']
    : [];
  const rangeWarnings = chart.range?.complete === false && releases.length
    ? ['The Salesforce midpoint forecast remains available, but the FCOS minimum-to-maximum quantity band is hidden because one or more un-invoiced STEMs lack complete range or pricing evidence.']
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
    forecastSettings: {
      companyConservativeness,
      effectiveConservativeness,
      temporaryPreview: companyConservativeness !== effectiveConservativeness,
      canManage: forecastSettings?.canManage === true,
      updatedAt: forecastSettings?.updatedAt || null,
      updatedByEmail: forecastSettings?.updatedByEmail || null,
      options: Object.values(BUYER_PAYMENT_CONSERVATIVENESS),
      lookbackMonths: forecastSettings?.lookbackMonths || 12,
      minBuyerSamples: forecastSettings?.minBuyerSamples || 3,
      minGroupSamples: forecastSettings?.minGroupSamples || 5,
      recencyHalfLifeDays: 90,
      default: DEFAULT_BUYER_PAYMENT_CONSERVATIVENESS,
    },
    reconciliation: { individual: individualReconciliation, group: groupReconciliation },
    exposureByCurrency,
    releases,
    chart,
    currencies: currencyLabels.length ? currencyLabels : [snapshot.currency],
    rows,
    complete,
    projectionWarnings: [...new Set(projectionWarnings.filter(Boolean))],
    releaseWarnings: [...releaseWarnings, ...rangeWarnings],
    warnings: [...new Set([...projectionWarnings, ...releaseWarnings, ...rangeWarnings].filter(Boolean))],
  };
}

export const dashboardAccountCreditStatementInternals = {
  addDays,
  contractualReleaseCandidate,
  dateOnly,
  idKey,
  releaseCandidate,
};
