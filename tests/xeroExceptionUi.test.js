import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { documentExplicitReviewEligible, documentReviewTarget, documentReviewTotals, paymentReferenceReviewEligible, paymentReferenceReviewTarget, paymentReferenceOutcomesConfirmed, previewMatchesPostingMode, reconciliationBucket, retainedReviewSelection, restoreReviewSelection, reviewSelectionSnapshot, savedPostingMode, workflowCopy } from '../src/lib/financialWorkflowUi.js';
import { summarizeXeroFinancialReconciliation } from '../src/lib/xeroFinancialReconciliation.js';
import { xeroPortalUiCopy } from '../src/lib/xeroPortalUiCopy.js';

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

test('protected legacy stays in attention when changed evidence requires review without a visible difference', () => {
  const sticky = { ...review, differences: [] };
  assert.equal(reconciliationBucket(sticky), 'attention');
  assert.equal(documentExplicitReviewEligible(sticky), true);
  assert.equal(summarizeXeroFinancialReconciliation({ documents: [sticky], payments: [] }).exceptions, 1);
  assert.deepEqual([...restoreReviewSelection(reviewSelectionSnapshot([sticky], new Set([sticky.id])), [{ ...sticky, id: 'refreshed' }])], ['refreshed']);
  assert.equal(reconciliationBucket({ ...sticky, status: 'linked', acceptedLegacy: true }), 'matched');
});

test('retained payment reference requires complete evidence and explicit link review', () => {
  const retained = {
    salesforcePaymentId: 'payment-1', salesforcePaymentName: 'PAY-1', action: 'payment_reference_link',
    status: 'eligible', reviewRequired: true, blockers: [], proposedPayment: null,
    sourceFingerprint: 'source-1', reviewFingerprint: 'review-1', xeroPaymentId: 'xero-payment-1',
    bankAccountId: 'xero-bank-1', xeroDocumentUrl: 'https://go.xero.com/invoice/1',
    paymentDate: '2026-09-01', amount: 100, currency: 'USD',
    referenceComparison: { sourceReference: '', sourceFallbackReference: 'PAY-1', xeroReference: 'HISTORIC' },
  };
  assert.equal(reconciliationBucket(retained, 'payment'), 'attention');
  assert.equal(paymentReferenceReviewEligible(retained), true);
  assert.equal(summarizeXeroFinancialReconciliation({ documents: [], payments: [retained] }).exceptions, 1);
  assert.equal(restoreReviewSelection(reviewSelectionSnapshot([retained], new Set(['payment-1']), 'payment'), [retained], 'payment').size, 1);
  const target = { salesforcePaymentId: 'payment-1', sourceFingerprint: 'source-1', reviewFingerprint: 'review-1' };
  assert.equal(paymentReferenceReviewTarget([retained], target).eligible, true);
  assert.equal(paymentReferenceReviewTarget([{ ...retained, reviewFingerprint: 'changed' }], target).eligible, false);
  for (const invalid of [
    { blockers: ['Bank mapping changed'] }, { status: 'blocked' }, { status: 'failed' },
    { proposedPayment: { amount: 100 } }, { sourceFingerprint: null }, { reviewFingerprint: null },
    { bankAccountId: null }, { xeroPaymentId: null }, { xeroDocumentUrl: null },
    { referenceComparison: { ...retained.referenceComparison, sourceReference: 'EXPLICIT' } },
  ]) assert.equal(paymentReferenceReviewEligible({ ...retained, ...invalid }), false, JSON.stringify(invalid));
  const accepted = { ...retained, action: 'payment_link', status: 'protected', acceptedReference: true };
  assert.equal(reconciliationBucket(accepted, 'payment'), 'matched');
  assert.equal(summarizeXeroFinancialReconciliation({ documents: [], payments: [accepted] }).payments.reconciled, 1);
  for (const language of ['en', 'zh-Hant']) {
    const copy = xeroPortalUiCopy(language).financial;
    assert.ok(copy.actions.payment_reference_link);
    assert.ok(copy.paymentReferenceTitle && copy.paymentReferenceDescription && copy.approvePaymentReference);
    assert.ok(copy.sourceReference && copy.sourceFallbackReference && copy.retainedXeroReference);
  }
});

const existingPayment = (index, currency = 'USD') => ({ salesforcePaymentId: `payment-${index}`, salesforcePaymentName: `PAY-${index}`,
  action: 'payment_reference_link', status: 'eligible', reviewRequired: true, blockers: [], amount: 100, currency,
  sourceFingerprint: `source-${index}`, reviewFingerprint: `review-${index}`, xeroPaymentId: `xero-${index}`,
  bankAccountId: 'bank', xeroDocumentUrl: 'https://go.xero.com/invoice/1', paymentDate: '2026-09-01',
  referenceComparison: { sourceReference: '', sourceFallbackReference: `PAY-${index}`, xeroReference: 'HISTORIC' } });

test('existing payment batches require 1–25 unique unchanged eligible links and keep explicit selection through refresh', () => {
  const rows = Array.from({ length: 26 }, (_, index) => existingPayment(index, index % 2 ? 'HKD' : 'USD'));
  for (const count of [1, 25]) assert.equal(paymentReferenceReviewTarget(rows, rows.slice(0, count)).eligible, true);
  for (const targets of [[], rows, [rows[0], rows[0]], [rows[0], { ...rows[1], salesforcePaymentId: 'missing' }]]) {
    assert.equal(paymentReferenceReviewTarget(rows, targets).eligible, false);
  }
  for (const change of [{ sourceFingerprint: 'changed' }, { reviewFingerprint: 'changed' }, { blockers: ['changed'] }, { action: 'payment_apply' }]) {
    assert.equal(paymentReferenceReviewTarget([{ ...rows[0], ...change }, rows[1]], rows.slice(0, 2)).eligible, false);
  }
  const selected = new Set(['payment-0', 'payment-1']);
  const snapshot = reviewSelectionSnapshot(rows, selected, 'payment');
  assert.deepEqual([...restoreReviewSelection(snapshot, rows, 'payment')], [...selected]);
  assert.deepEqual([...restoreReviewSelection(snapshot, [{ ...rows[0], action: 'payment_link' }, rows[1]], 'payment')], ['payment-1']);
  assert.equal(restoreReviewSelection([], rows, 'payment').size, 0, 'reference links are never selected by default');
  assert.deepEqual(documentReviewTotals(rows.slice(0, 3)).map(({ currency, count, total }) => ({ currency, count, total })),
    [{ currency: 'USD', count: 2, total: 200 }, { currency: 'HKD', count: 1, total: 100 }]);
});

test('payment link confirmation requires exactly one linked outcome for every selected identity', () => {
  const rows = [existingPayment(0), existingPayment(1)];
  const outcomes = rows.map((row) => ({ salesforcePaymentId: row.salesforcePaymentId, status: 'linked' }));
  assert.equal(paymentReferenceOutcomesConfirmed(rows, outcomes.toReversed()), true);
  for (const result of [undefined, null, [], outcomes.slice(0, 1), [...outcomes, outcomes[0]], [outcomes[0], outcomes[0]],
    [outcomes[0], { ...outcomes[1], status: 'failed' }], [outcomes[0], { ...outcomes[1], salesforcePaymentId: 'other' }]]) {
    assert.equal(paymentReferenceOutcomesConfirmed(rows, result), false);
  }
});

test('the payment link UI submits once, preserves failure selection, and clears only confirmed links', async () => {
  const source = await readFile(new URL('../src/components/xero/XeroFinancialSync.jsx', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  async function linkExistingPaymentReference()'), source.indexOf('  function toggleSelection'));
  const rows = [existingPayment(0), existingPayment(1)];
  for (const response of ['success', 'incomplete', 'error', 'lost']) {
    let selected = new Set(['payment-0', 'payment-1', 'unrelated']); let target = rows; let refreshes = 0;
    const calls = []; const busy = [];
    const globals = `const busy='', financialGate={enabled:true}, MUTATION_OPTIONS={}, financialCopy={}, captureDailyAllowance=()=>{}, toast=()=>{};
      const paymentRequest=row=>({id:row.salesforcePaymentId,sourceFingerprint:row.sourceFingerprint,reviewFingerprint:row.reviewFingerprint});`;
    const run = new Function('appClient', 'paymentReferenceResult', 'paymentReferenceOutcomesConfirmed', 'setSelectedPayments',
      'setPaymentReferenceTarget', 'setBusy', 'runPreview', `${globals}${method}; return linkExistingPaymentReference();`);
    await run({ functions: { invoke: async (name, body) => {
      calls.push({ name, body }); if (response === 'lost') throw new Error('lost');
      return { data: response === 'error' ? { error: 'stopped' } : { outcomes: rows.slice(0, response === 'incomplete' ? 1 : 2)
        .map((row) => ({ salesforcePaymentId: row.salesforcePaymentId, status: 'linked' })) } };
    } } }, { rows, eligible: true }, paymentReferenceOutcomesConfirmed, (update) => { selected = update(selected); },
    (value) => { target = value; }, (value) => busy.push(value), async () => { refreshes += 1; });
    assert.equal(calls.length, 1); assert.equal(calls[0].body.mode, 'link_existing'); assert.equal(calls[0].body.reviewed, true);
    assert.deepEqual(calls[0].body.selectedPayments, rows.map((row) => ({ id: row.salesforcePaymentId, sourceFingerprint: row.sourceFingerprint, reviewFingerprint: row.reviewFingerprint })));
    assert.deepEqual([...selected], response === 'success' ? ['unrelated'] : ['payment-0', 'payment-1', 'unrelated']);
    assert.equal(target === null, response === 'success'); assert.equal(refreshes, response === 'success' ? 1 : 0); assert.equal(busy.at(-1), '');
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
