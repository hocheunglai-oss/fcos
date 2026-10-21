import assert from 'node:assert/strict';
import test from 'node:test';
import { isRemittanceSummary, reconciliationBucket, restoreReviewSelection, paymentReferenceReviewEligible } from '../src/lib/financialWorkflowUi.js';
import { summarizeXeroFinancialReconciliation } from '../src/lib/xeroFinancialReconciliation.js';

const summary = () => ({
  salesforcePaymentId: 'a0S000000000001', action: 'remittance_summary', status: 'informational', blockers: [],
  proposedPayment: null, xeroPaymentId: null, sourceFingerprint: 'source', reviewFingerprint: 'review',
  remittanceSummary: { policyVersion: 'remittance_summary_v1', allocationCount: 2,
    allocationIds: ['a0S000000000002', 'a0S000000000003'], fingerprint: 'a'.repeat(64) },
});

test('verified remittance summaries remain visible separately from matched and ready payments', () => {
  const row = summary();
  assert.equal(isRemittanceSummary(row), true);
  assert.equal(reconciliationBucket(row, 'payment'), 'summary');
  assert.equal(paymentReferenceReviewEligible(row), false);
  assert.equal(restoreReviewSelection([{ key: row.salesforcePaymentId, sourceFingerprint: 'source', reviewFingerprint: 'review' }], [row], 'payment').size, 0);
});

test('summary classification requires a complete informational proof and no payment proposal', () => {
  for (const change of [
    { status: 'eligible' }, { blockers: ['Still held'] }, { proposedPayment: {} }, { xeroPaymentId: 'linked' },
    { remittanceSummary: null }, { remittanceSummary: { ...summary().remittanceSummary, policyVersion: 'unknown' } },
    { remittanceSummary: { ...summary().remittanceSummary, fingerprint: '' } },
    { remittanceSummary: { ...summary().remittanceSummary, allocationCount: 0 } },
    { remittanceSummary: { ...summary().remittanceSummary, allocationIds: ['duplicate', 'duplicate'] } },
    { remittanceSummary: { ...summary().remittanceSummary, allocationIds: ['one'] } },
  ]) {
    const row = { ...summary(), ...change };
    assert.equal(isRemittanceSummary(row), false);
    assert.equal(reconciliationBucket(row, 'payment'), 'attention');
    assert.equal(summarizeXeroFinancialReconciliation({ documents: [], payments: [row] }).exceptions, 1);
  }
});

test('summary headers are not counted as reconciled payments and cannot complete their blocked children', () => {
  const payments = [summary(), { action: 'payment_link', status: 'protected', blockers: [] },
    { action: 'blocked', status: 'blocked', blockers: ['Missing payment evidence'], blockerCodes: ['finance_exception'] }];
  const result = summarizeXeroFinancialReconciliation({ documents: [], payments });
  assert.equal(result.total, 3);
  assert.equal(result.summaries, 1);
  assert.equal(result.transactionTotal, 2);
  assert.equal(result.reconciled, 1);
  assert.equal(result.exceptions, 1);
  assert.equal(result.completion, 50);
  assert.equal(result.status, 'attention_required');
  assert.equal(result.payments.summaries, 1);
  assert.equal(reconciliationBucket(payments[2], 'payment'), 'attention');
});

test('without summaries, ordinary reconciliation totals and completion keep their meaning', () => {
  const result = summarizeXeroFinancialReconciliation({ documents: [], payments: [
    { action: 'payment_link', status: 'protected', blockers: [] },
    { action: 'payment_apply', status: 'eligible', blockers: [] },
  ] });
  assert.equal(result.summaries, 0);
  assert.equal(result.transactionTotal, result.total);
  assert.equal(result.completion, 50);
  assert.equal(result.pending, 1);
});
