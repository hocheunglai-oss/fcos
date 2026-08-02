import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hongKongBusinessDaysAfter,
  reconcileBuyerPaymentPosting,
} from '../src/lib/paymentPostingReconciliation.js';

const payment = (paymentId, amount, paymentDate = '2026-08-03') => ({ paymentId, amount, paymentDate, currency: 'USD' });

function initializedSnapshot(balance = 1000, payments = []) {
  return reconcileBuyerPaymentPosting({
    currentBalance: balance,
    payments,
    now: '2026-08-03T01:00:00.000Z',
  }).snapshot;
}

test('initial reconciliation establishes a clean baseline without treating historical payments as new', () => {
  const result = reconcileBuyerPaymentPosting({
    currentBalance: 700,
    payments: [payment('p1', 300)],
    now: '2026-08-03T01:00:00.000Z',
  });
  assert.equal(result.state, 'partial_payment');
  assert.equal(result.issue, null);
  assert.equal(result.snapshot.knownPayments.length, 1);
  assert.equal(result.snapshot.baselineBalance, 700);
});

test('detects a new payment whose receivable balance has not posted', () => {
  const result = reconcileBuyerPaymentPosting({
    previousSnapshot: initializedSnapshot(),
    previousBalance: 1000,
    currentBalance: 1000,
    payments: [payment('p1', 300)],
    now: '2026-08-03T02:00:00.000Z',
  });
  assert.equal(result.state, 'payment_posting_pending');
  assert.equal(result.issue.expectedBalance, 700);
  assert.equal(result.issue.postedAmount, 0);
  assert.equal(result.issue.unpostedAmount, 300);
});

test('moves unchanged posting to overdue on the next Hong Kong business date', () => {
  const pending = reconcileBuyerPaymentPosting({
    previousSnapshot: initializedSnapshot(),
    previousBalance: 1000,
    currentBalance: 1000,
    payments: [payment('p1', 300, '2026-08-07')],
    now: '2026-08-07T02:00:00.000Z',
  });
  const overdue = reconcileBuyerPaymentPosting({
    previousSnapshot: pending.snapshot,
    previousBalance: 1000,
    currentBalance: 1000,
    payments: [payment('p1', 300, '2026-08-07')],
    now: '2026-08-10T02:00:00.000Z',
  });
  assert.equal(hongKongBusinessDaysAfter(pending.issue.startedAt, '2026-08-10T02:00:00.000Z'), 1);
  assert.equal(overdue.state, 'payment_posting_overdue');
});

test('distinguishes partial posting from an amount mismatch', () => {
  const snapshot = initializedSnapshot();
  const partial = reconcileBuyerPaymentPosting({
    previousSnapshot: snapshot,
    previousBalance: 1000,
    currentBalance: 850,
    payments: [payment('p1', 300)],
    now: '2026-08-03T02:00:00.000Z',
  });
  assert.equal(partial.state, 'payment_partially_posted');
  assert.equal(partial.issue.postedAmount, 150);
  assert.equal(partial.issue.unpostedAmount, 150);

  const mismatch = reconcileBuyerPaymentPosting({
    previousSnapshot: snapshot,
    previousBalance: 1000,
    currentBalance: 600,
    payments: [payment('p1', 300)],
    now: '2026-08-03T02:00:00.000Z',
  });
  assert.equal(mismatch.state, 'payment_posting_mismatch');
  assert.equal(mismatch.issue.differenceAmount, -100);
});

test('clears the exception only when payment movement and balance reconcile', () => {
  const pending = reconcileBuyerPaymentPosting({
    previousSnapshot: initializedSnapshot(),
    previousBalance: 1000,
    currentBalance: 1000,
    payments: [payment('p1', 300)],
    now: '2026-08-03T02:00:00.000Z',
  });
  const resolved = reconcileBuyerPaymentPosting({
    previousSnapshot: pending.snapshot,
    previousBalance: 1000,
    currentBalance: 700,
    payments: [payment('p1', 300)],
    now: '2026-08-03T03:00:00.000Z',
  });
  assert.equal(resolved.state, 'partial_payment');
  assert.equal(resolved.issue, null);
  assert.equal(resolved.snapshot.baselineBalance, 700);
  assert.equal(resolved.snapshot.knownPayments[0].paymentId, 'p1');
});

test('aggregates multiple new payments and accepts a fully settled live balance', () => {
  const snapshot = initializedSnapshot(500);
  const pending = reconcileBuyerPaymentPosting({
    previousSnapshot: snapshot,
    previousBalance: 500,
    currentBalance: 500,
    payments: [payment('p1', 200), payment('p2', 300)],
    fullyPaidThreshold: 0,
    now: '2026-08-03T02:00:00.000Z',
  });
  assert.equal(pending.issue.detectedPaymentAmount, 500);

  const settled = reconcileBuyerPaymentPosting({
    previousSnapshot: pending.snapshot,
    previousBalance: 500,
    currentBalance: 0,
    payments: [payment('p1', 200), payment('p2', 300)],
    fullyPaidThreshold: 0,
    now: '2026-08-03T03:00:00.000Z',
  });
  assert.equal(settled.state, 'settled');
  assert.equal(settled.snapshot.knownPayments.length, 2);
});

test('accepts a balance-only adjustment as a new clean baseline', () => {
  const result = reconcileBuyerPaymentPosting({
    previousSnapshot: initializedSnapshot(1000),
    previousBalance: 1000,
    currentBalance: 900,
    payments: [],
    now: '2026-08-03T02:00:00.000Z',
  });
  assert.equal(result.state, 'open');
  assert.equal(result.issue, null);
  assert.equal(result.snapshot.baselineBalance, 900);
});
