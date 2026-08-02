const MONEY_TOLERANCE = 0.005;

export const PAYMENT_POSTING_ISSUE_STATES = new Set([
  'payment_posting_pending',
  'payment_partially_posted',
  'payment_posting_mismatch',
  'payment_posting_overdue',
]);

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value) {
  return Number(Number(value || 0).toFixed(2));
}

function dateOnly(value) {
  if (!value) return '';
  const direct = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function hongKongDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function hongKongBusinessDaysAfter(startedAt, now = new Date()) {
  const start = hongKongDate(startedAt);
  const end = hongKongDate(now);
  if (!start || !end || end <= start) return 0;
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const target = new Date(`${end}T00:00:00.000Z`);
  let count = 0;
  while (cursor < target) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (![0, 6].includes(cursor.getUTCDay())) count += 1;
  }
  return count;
}

export function normalizeBuyerPaymentSet(payments = []) {
  return payments
    .map((payment) => ({
      paymentId: String(payment?.paymentId || '').trim(),
      paymentDate: dateOnly(payment?.paymentDate) || null,
      amount: money(payment?.amount),
      currency: String(payment?.currency || '').trim() || null,
    }))
    .filter((payment) => payment.paymentId && payment.amount != null && payment.amount > 0)
    .sort((left, right) => left.paymentId.localeCompare(right.paymentId));
}

function paymentTotal(payments) {
  return rounded(payments.reduce((total, payment) => total + Number(payment.amount || 0), 0));
}

function paymentSetsMatch(left, right, tolerance) {
  if (left.length !== right.length) return false;
  return left.every((payment, index) => (
    payment.paymentId === right[index].paymentId
    && Math.abs(Number(payment.amount) - Number(right[index].amount)) < tolerance
    && String(payment.currency || '') === String(right[index].currency || '')
  ));
}

function cleanSnapshot({ payments, balance, state, nowIso }) {
  return {
    version: 1,
    state,
    knownPayments: payments,
    baselineBalance: rounded(balance),
    currentBalance: rounded(balance),
    expectedBalance: rounded(balance),
    detectedPaymentAmount: 0,
    postedAmount: 0,
    differenceAmount: 0,
    unpostedAmount: 0,
    startedAt: null,
    businessDaysOpen: 0,
    issueKey: null,
    lastCheckedAt: nowIso,
  };
}

function paymentIssueKey(startedAt, knownPayments, currentPayments) {
  const token = (payments) => payments.map((payment) => `${payment.paymentId}:${rounded(payment.amount)}`).join('|');
  return `${startedAt}:${token(knownPayments)}=>${token(currentPayments)}`;
}

export function reconcileBuyerPaymentPosting({
  previousSnapshot = null,
  previousBalance,
  currentBalance,
  payments = [],
  fullyPaidThreshold = 0,
  tolerance = MONEY_TOLERANCE,
  now = new Date(),
} = {}) {
  const balance = money(currentBalance);
  const priorBalance = money(previousBalance);
  const currentPayments = normalizeBuyerPaymentSet(payments);
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = Number.isNaN(nowDate.getTime()) ? new Date().toISOString() : nowDate.toISOString();

  if (balance == null) {
    return {
      state: 'balance_unavailable',
      snapshot: previousSnapshot,
      issue: null,
    };
  }

  if (balance <= Number(fullyPaidThreshold || 0)) {
    return {
      state: 'settled',
      snapshot: cleanSnapshot({ payments: currentPayments, balance, state: 'settled', nowIso }),
      issue: null,
    };
  }

  const validPrior = previousSnapshot?.version === 1 && Array.isArray(previousSnapshot.knownPayments);
  if (!validPrior || priorBalance == null) {
    const state = currentPayments.length ? 'partial_payment' : 'open';
    return {
      state,
      snapshot: cleanSnapshot({ payments: currentPayments, balance, state, nowIso }),
      issue: null,
    };
  }

  const priorState = String(previousSnapshot.state || '');
  const activeIssue = PAYMENT_POSTING_ISSUE_STATES.has(priorState)
    && previousSnapshot.startedAt
    && money(previousSnapshot.baselineBalance) != null;
  const knownPayments = normalizeBuyerPaymentSet(previousSnapshot.knownPayments);
  const baselineBalance = activeIssue ? money(previousSnapshot.baselineBalance) : priorBalance;
  const paymentSetChanged = !paymentSetsMatch(knownPayments, currentPayments, tolerance);

  if (!activeIssue && !paymentSetChanged) {
    const state = currentPayments.length ? 'partial_payment' : 'open';
    return {
      state,
      snapshot: cleanSnapshot({ payments: currentPayments, balance, state, nowIso }),
      issue: null,
    };
  }

  const knownPaymentTotal = paymentTotal(knownPayments);
  const currentPaymentTotal = paymentTotal(currentPayments);
  const detectedPaymentAmount = rounded(currentPaymentTotal - knownPaymentTotal);
  const expectedBalance = rounded(baselineBalance - detectedPaymentAmount);
  const postedAmount = rounded(baselineBalance - balance);
  const differenceAmount = rounded(balance - expectedBalance);

  if (Math.abs(differenceAmount) < tolerance) {
    return {
      state: 'partial_payment',
      snapshot: cleanSnapshot({ payments: currentPayments, balance, state: 'partial_payment', nowIso }),
      issue: null,
    };
  }

  const startedAt = activeIssue ? previousSnapshot.startedAt : nowIso;
  const businessDaysOpen = hongKongBusinessDaysAfter(startedAt, nowDate);
  let state = 'payment_posting_mismatch';
  if (detectedPaymentAmount > tolerance && Math.abs(postedAmount) < tolerance) {
    state = businessDaysOpen >= 1 ? 'payment_posting_overdue' : 'payment_posting_pending';
  } else if (detectedPaymentAmount > tolerance && postedAmount > tolerance && postedAmount < detectedPaymentAmount - tolerance) {
    state = 'payment_partially_posted';
  }

  const issueKey = paymentIssueKey(startedAt, knownPayments, currentPayments);
  const unpostedAmount = rounded(Math.max(0, detectedPaymentAmount - Math.max(0, postedAmount)));
  const issue = {
    state,
    issueKey,
    baselineBalance: rounded(baselineBalance),
    detectedPaymentAmount,
    expectedBalance,
    currentBalance: rounded(balance),
    postedAmount,
    differenceAmount,
    unpostedAmount,
    startedAt,
    businessDaysOpen,
    detectedPayments: currentPayments.filter((payment) => !knownPayments.some((known) => known.paymentId === payment.paymentId && Math.abs(known.amount - payment.amount) < tolerance)),
    removedPayments: knownPayments.filter((payment) => !currentPayments.some((current) => current.paymentId === payment.paymentId && Math.abs(current.amount - payment.amount) < tolerance)),
  };

  return {
    state,
    issue,
    snapshot: {
      version: 1,
      state,
      knownPayments,
      observedPayments: currentPayments,
      baselineBalance: issue.baselineBalance,
      currentBalance: issue.currentBalance,
      expectedBalance,
      detectedPaymentAmount,
      postedAmount,
      differenceAmount,
      unpostedAmount,
      startedAt,
      businessDaysOpen,
      issueKey,
      lastCheckedAt: nowIso,
    },
  };
}
