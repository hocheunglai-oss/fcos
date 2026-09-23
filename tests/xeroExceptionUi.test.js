import assert from 'node:assert/strict';
import test from 'node:test';
import { documentExplicitReviewEligible, documentReviewTarget, documentReviewTotals, previewMatchesPostingMode, reconciliationBucket, retainedReviewSelection, restoreReviewSelection, reviewSelectionSnapshot, savedPostingMode, workflowCopy } from '../src/lib/financialWorkflowUi.js';
import { summarizeXeroFinancialReconciliation } from '../src/lib/xeroFinancialReconciliation.js';

const difference = { field: 'reference', salesforce: 'new', xero: 'historical' };
const review = {
  id: 'one', salesforceObject: 'Invoice__c', salesforceId: 'invoice-1',
  action: 'protected_legacy', status: 'eligible', reviewRequired: true,
  reviewFingerprint: 'review-1', sourceFingerprint: 'source-1',
  currency: 'USD', total: 100, blockers: [], differences: [difference],
};

test('protected financial differences need attention until explicitly accepted; ordinary link review remains selectable', () => {
  assert.equal(reconciliationBucket(review), 'attention');
  assert.equal(documentExplicitReviewEligible(review), true);
  assert.equal(summarizeXeroFinancialReconciliation({ documents: [review], payments: [] }).exceptions, 1);
  const link = { ...review, action: 'link' };
  assert.equal(reconciliationBucket(link), 'ready');
  const summary = summarizeXeroFinancialReconciliation({ documents: [link], payments: [] });
  assert.deepEqual([summary.pending, summary.exceptions, summary.reconciled], [1, 0, 0]);
  const snapshot = reviewSelectionSnapshot([link], new Set([link.id]));
  assert.deepEqual([...restoreReviewSelection(snapshot, [{ ...link, id: 'next' }])], ['next']);
  assert.equal(restoreReviewSelection(snapshot, [{ ...link, id: 'changed', reviewFingerprint: 'other' }]).size, 0);
  assert.deepEqual(documentReviewTotals([review]).map(({ action, total }) => [action, total]), [['protected_legacy', 100]]);
});

test('explicit document review allows only eligible actionable rows without blockers', () => {
  for (const action of ['create_draft', 'safe_update', 'link', 'protected_legacy']) {
    assert.equal(documentExplicitReviewEligible({ ...review, action }), true, action);
  }
  for (const row of [
    { ...review, blockers: ['Accounting lines differ'] },
    { ...review, status: 'protected' }, { ...review, status: 'blocked' },
    { ...review, status: 'failed' }, { ...review, status: 'waiting' },
    { ...review, status: 'linked', acceptedLegacy: true },
    { ...review, action: 'unknown' },
    { ...review, reviewRequired: false },
    { ...review, sourceFingerprint: null },
    { ...review, reviewFingerprint: null },
  ]) assert.equal(documentExplicitReviewEligible(row), false, JSON.stringify(row));
});

test('explicit protected selection survives unchanged evidence and drops after source, review, or blocker changes', () => {
  const snapshot = reviewSelectionSnapshot([review], new Set([review.id]));
  const next = { ...review, id: 'next-preview-row' };
  assert.deepEqual([...restoreReviewSelection(snapshot, [next])], [next.id]);
  assert.deepEqual([...retainedReviewSelection([review], [next], new Set([review.id]))], [next.id]);
  for (const changed of [
    { ...next, sourceFingerprint: 'changed-source' },
    { ...next, reviewFingerprint: 'changed-review' },
    { ...next, blockers: ['Accounting evidence missing'] },
    { ...next, status: 'protected' },
  ]) {
    assert.equal(restoreReviewSelection(snapshot, [changed]).size, 0);
    assert.equal(retainedReviewSelection([review], [changed], new Set([review.id])).size, 0);
  }
});

test('invoice dependencies wait without counting complete; mixed blockers and real financial exceptions need attention', () => {
  const sourceWaiting = { ...review, id: 'source-wait', action: 'blocked', status: 'blocked',
    blockers: ['Salesforce invoice has not been issued.'], blockerCodes: ['source_not_issued'], differences: [] };
  const paymentWaiting = { action: 'blocked', status: 'blocked',
    blockers: ['No linked buyer invoice exists for this STEM.', 'The Salesforce document is not durably linked to Xero. Run the document check again.'] };
  assert.equal(reconciliationBucket(sourceWaiting), 'waiting');
  assert.equal(reconciliationBucket(paymentWaiting, 'payment'), 'waiting');
  const waiting = summarizeXeroFinancialReconciliation({ documents: [sourceWaiting], payments: [paymentWaiting] });
  assert.deepEqual([waiting.pending, waiting.waiting, waiting.reconciled, waiting.completion, waiting.status], [2, 2, 0, 0, 'waiting']);
  assert.equal(summarizeXeroFinancialReconciliation({ documents: [sourceWaiting] }).completion, null);
  for (const row of [
    { ...sourceWaiting, blockers: [...sourceWaiting.blockers, 'Unknown currency.'] },
    { ...sourceWaiting, blockerCodes: ['source_not_issued', 'currency_unknown'], blockers: [...sourceWaiting.blockers, 'Unknown currency.'] },
  ]) assert.equal(reconciliationBucket(row), 'attention');
  assert.equal(reconciliationBucket({ ...paymentWaiting, blockers: [...paymentWaiting.blockers, 'Payment amount must be positive and finite.'] }, 'payment'), 'attention');
  assert.equal(reconciliationBucket({ ...paymentWaiting, blockers: ['The linked Xero invoice currency does not match the USD Salesforce payment.'] }, 'payment'), 'attention');
});

test('posting mode is read from saved run and an older mode cannot be applied under a new label', () => {
  const draft = { run: { id: 'run-1', postingMode: 'draft' } };
  const authorised = { run: { id: 'run-2', postingMode: 'authorised' } };
  assert.equal(savedPostingMode(draft), 'draft');
  assert.equal(previewMatchesPostingMode(draft, 'authorised'), false);
  assert.equal(previewMatchesPostingMode(authorised, 'authorised'), true);
  assert.equal(savedPostingMode({ run: { id: 'old-run' } }), 'draft');
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

test('single-document review follows Salesforce identity across a new preview and rejects changed source or blockers', () => {
  const target = { salesforceObject: review.salesforceObject, salesforceId: review.salesforceId, sourceFingerprint: review.sourceFingerprint };
  const refreshed = { ...review, action: 'link', id: 'new-preview-item', reviewFingerprint: 'new-mapping-review' };
  assert.deepEqual(documentReviewTarget([refreshed], target), { row: refreshed, changed: false, evidenceMissing: false, eligible: true });
  assert.equal(documentReviewTarget([review], target).eligible, true);
  assert.equal(documentReviewTarget([{ ...refreshed, status: 'blocked', blockers: ['Missing mapping'] }], target).eligible, false);
  assert.equal(documentReviewTarget([{ ...refreshed, sourceFingerprint: 'changed-source' }], target).changed, true);
  assert.deepEqual(documentReviewTarget([{ ...refreshed, sourceFingerprint: null }], target), { row: { ...refreshed, sourceFingerprint: null }, changed: false, evidenceMissing: true, eligible: false });
  assert.deepEqual(documentReviewTarget([{ ...refreshed, reviewFingerprint: null }], target), { row: { ...refreshed, reviewFingerprint: null }, changed: false, evidenceMissing: true, eligible: false });
  assert.deepEqual(documentReviewTarget([], target), { row: null, changed: false, evidenceMissing: false, eligible: false });
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
    assert.ok(copy.authorisedMode);
    assert.ok(copy.modeChanged);
    assert.ok(copy.protectedLinkAction);
    assert.ok(copy.reviewLinks);
  }
});
