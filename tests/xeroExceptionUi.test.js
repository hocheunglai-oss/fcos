import assert from 'node:assert/strict';
import test from 'node:test';
import { documentReviewTotals, reconciliationBucket, restoreReviewSelection, reviewSelectionSnapshot, workflowCopy } from '../src/lib/financialWorkflowUi.js';
import { summarizeXeroFinancialReconciliation } from '../src/lib/xeroFinancialReconciliation.js';

const difference = { field: 'reference', salesforce: 'new', xero: 'historical' };
const review = {
  id: 'one', salesforceObject: 'Invoice__c', salesforceId: 'invoice-1',
  action: 'protected_legacy', status: 'eligible', reviewRequired: true,
  reviewFingerprint: 'review-1', sourceFingerprint: 'source-1',
  currency: 'USD', total: 100, blockers: [], differences: [difference],
};

test('protected legacy and link reviews remain pending and selectable despite retained differences', () => {
  for (const action of ['protected_legacy', 'link']) {
    const row = { ...review, action };
    assert.equal(reconciliationBucket(row), 'ready');
    const summary = summarizeXeroFinancialReconciliation({ documents: [row], payments: [] });
    assert.deepEqual([summary.pending, summary.exceptions, summary.reconciled], [1, 0, 0]);
    assert.equal(summary.status, 'sync_required');
  }
  const snapshot = reviewSelectionSnapshot([review], new Set([review.id]));
  assert.deepEqual([...restoreReviewSelection(snapshot, [{ ...review, id: 'next' }])], ['next']);
  assert.equal(restoreReviewSelection(snapshot, [{ ...review, id: 'changed', reviewFingerprint: 'other' }]).size, 0);
  assert.deepEqual(documentReviewTotals([review]).map(({ action, total }) => [action, total]), [['protected_legacy', 100]]);
});

test('accepted legacy is reconciled but its differences remain on the row and in the accepted count', () => {
  const accepted = { ...review, status: 'linked', acceptedLegacy: true };
  assert.equal(reconciliationBucket(accepted), 'matched');
  assert.deepEqual(accepted.differences, [difference]);
  const summary = summarizeXeroFinancialReconciliation({ documents: [accepted], payments: [] });
  assert.deepEqual([summary.documents.reconciled, summary.documents.acceptedLegacy, summary.completion], [1, 1, 100]);
  assert.equal(summary.status, 'reconciled');
});

test('blockers and blocked status take priority over review or accepted legacy flags', () => {
  for (const row of [{ ...review, blockers: ['Contact identity conflict'] }, { ...review, status: 'blocked' }, { ...review, status: 'blocked', acceptedLegacy: true }]) {
    assert.equal(reconciliationBucket(row), 'attention');
    const summary = summarizeXeroFinancialReconciliation({ documents: [row], payments: [] });
    assert.equal(summary.exceptions, 1);
    assert.equal(summary.documents.acceptedLegacy, 0);
  }
});

test('English and traditional Chinese identify protected links and match evidence', () => {
  for (const language of ['en', 'zh-Hant']) {
    const copy = workflowCopy(language);
    assert.ok(copy.legacyReview.includes('Xero'));
    assert.ok(copy.acceptedLegacy);
    assert.ok(copy.matchBasis.stored_link);
    assert.ok(copy.matchBasis.document_number);
    assert.ok(copy.matchBasis.stem_reference);
    assert.ok(copy.matchBasis.date_amount);
  }
});
