const WAITING_BLOCKER_CODES = new Set(['source_not_issued', 'invoice_link_pending', 'invoice_authorisation_pending']);
const LEGACY_PAYMENT_DEPENDENCIES = new Set([
  'No linked buyer invoice exists for this STEM.',
  'The Salesforce document is not durably linked to Xero. Run the document check again.',
  'The linked Xero transaction is not authorised for payment.',
]);
const DOCUMENT_REVIEW_ACTIONS = new Set(['create_draft', 'safe_update', 'link', 'protected_legacy']);

export function savedPostingMode(preview) {
  return preview?.run?.postingMode || preview?.postingMode || 'draft';
}

export function previewMatchesPostingMode(preview, mode) {
  return Boolean(preview?.run?.id && savedPostingMode(preview) === mode);
}

function waitsOnDependency(row, kind) {
  const blockers = Array.isArray(row.blockers) ? row.blockers : [];
  if (!blockers.length) return false;
  const codes = Array.isArray(row.blockerCodes) ? row.blockerCodes : [];
  if (codes.length === blockers.length) return codes.every((code) => WAITING_BLOCKER_CODES.has(code));
  // Older payment previews lack structured codes. These exact server messages
  // are known dependencies; any additional blocker keeps the row in attention.
  return kind === 'payment' && !codes.length && blockers.every((reason) => LEGACY_PAYMENT_DEPENDENCIES.has(reason));
}

// A verified header summarizes allocations; it is never a matched Xero payment.
export function isRemittanceSummary(row = {}) {
  const proof = row.remittanceSummary;
  return row.action === 'remittance_summary' && row.status === 'informational'
    && !(row.blockers || []).length && !row.proposedPayment && !row.xeroPaymentId
    && proof?.policyVersion === 'remittance_summary_v1'
    && proof.allocationCount > 0
    && Array.isArray(proof.allocationIds) && proof.allocationIds.length === proof.allocationCount
    && new Set(proof.allocationIds).size === proof.allocationCount
    && /^[a-f0-9]{64}$/.test(proof.fingerprint || '');
}

export function reconciliationBucket(row = {}, kind = 'document') {
  const blockers = row.blockers || [];
  if (kind === 'payment') {
    if (isRemittanceSummary(row)) return 'summary';
    if (row.action === 'remittance_summary') return 'attention';
    if (waitsOnDependency(row, kind)) return 'waiting';
    if (blockers.length || row.status === 'blocked' || row.status === 'failed') return 'attention';
    if (row.action === 'payment_reference_link') return 'attention';
    return row.action === 'payment_link' ? 'matched' : 'ready';
  }
  if (waitsOnDependency(row, kind)) return 'waiting';
  if (blockers.length || ['blocked', 'failed'].includes(row.status)) return 'attention';
  if (row.acceptedLegacy) return 'matched';
  if (row.action === 'protected_legacy' && (row.differences?.length || row.reviewRequired === true)) return 'attention';
  if (row.reviewRequired && row.status === 'eligible') return 'ready';
  if (['link', 'protected_legacy'].includes(row.action) || ['linked', 'updated', 'created'].includes(row.status)) return 'matched';
  return 'ready';
}

// Attention is a reporting bucket, not an approval decision. A protected
// legacy difference can be approved explicitly as a link without changing Xero.
export function documentExplicitReviewEligible(row = {}) {
  if (row.status !== 'eligible' || (row.blockers || []).length || !DOCUMENT_REVIEW_ACTIONS.has(row.action)
    || !row.sourceFingerprint || !row.reviewFingerprint) return false;
  if (reconciliationBucket(row) === 'ready') return true;
  return row.action === 'protected_legacy' && row.reviewRequired === true
    && reconciliationBucket(row) === 'attention';
}

// A retained Xero reference is accepted only through its own explicit review.
// It cannot enter the exact-payment selection or be inferred from a saved check.
export function paymentReferenceReviewEligible(row = {}) {
  return row.action === 'payment_reference_link' && row.status === 'eligible'
    && row.reviewRequired === true && (row.blockers || []).length === 0
    && !row.proposedPayment && Boolean(row.salesforcePaymentId && row.xeroPaymentId
    && row.bankAccountId && row.xeroDocumentUrl && row.paymentDate && row.currency
      && Number.isFinite(Number(row.amount)) && Number(row.amount) > 0
      && row.sourceFingerprint && row.reviewFingerprint
      && row.referenceComparison && !row.referenceComparison.sourceReference
      && (row.referenceComparison.sourceFallbackReference || row.salesforcePaymentName)
      && row.referenceComparison.xeroReference);
}

export function paymentReferenceReviewTarget(rows, target) {
  if (!target) return null;
  const targets = Array.isArray(target) ? target : [target];
  const current = targets.map((item) => (rows || []).find((row) => row.salesforcePaymentId === item.salesforcePaymentId));
  return { rows: current.filter(Boolean), eligible: targets.length > 0 && targets.length <= 25
    && new Set(targets.map((item) => item.salesforcePaymentId)).size === targets.length
    && current.every((row, index) => row && paymentReferenceReviewEligible(row)
      && row.sourceFingerprint === targets[index].sourceFingerprint && row.reviewFingerprint === targets[index].reviewFingerprint) };
}

export function paymentReferenceOutcomesConfirmed(rows, outcomes = []) {
  return rows.length > 0 && Array.isArray(outcomes) && outcomes.length === rows.length
    && rows.every((row) => outcomes.filter((outcome) => outcome.salesforcePaymentId === row.salesforcePaymentId && outcome.status === 'linked').length === 1);
}

export function retainedReviewSelection(previousRows, nextRows, selectedIds) {
  return restoreReviewSelection(reviewSelectionSnapshot(previousRows, selectedIds), nextRows);
}

export function reviewSelectionSnapshot(rows, selectedIds, kind = 'document') {
  return rows.filter((row) => selectedIds.has(kind === 'payment' ? row.salesforcePaymentId : row.id)).map((row) => ({
    key: kind === 'payment' ? row.salesforcePaymentId : `${row.salesforceObject}:${row.salesforceId}`,
    reviewFingerprint: row.reviewFingerprint, sourceFingerprint: row.sourceFingerprint,
  }));
}

export function restoreReviewSelection(snapshot, rows, kind = 'document') {
  const previous = new Map((snapshot || []).map((row) => [row.key, row]));
  return new Set(rows.filter((row) => {
    const before = previous.get(kind === 'payment' ? row.salesforcePaymentId : `${row.salesforceObject}:${row.salesforceId}`);
    return before?.reviewFingerprint && before.reviewFingerprint === row.reviewFingerprint
      && before.sourceFingerprint && before.sourceFingerprint === row.sourceFingerprint
      && (kind === 'payment' ? paymentReferenceReviewEligible(row) || row.action === 'payment_apply' && row.status === 'eligible'
        && !(row.blockers || []).length && reconciliationBucket(row, kind) === 'ready'
        : documentExplicitReviewEligible(row));
  }).map((row) => kind === 'payment' ? row.salesforcePaymentId : row.id));
}

export function documentReviewTotals(rows) {
  return Object.values(rows.reduce((totals, row) => {
    const key = `${row.currency}:${row.action}`;
    totals[key] ||= { currency: row.currency, action: row.action, count: 0, total: 0 };
    totals[key].count += 1;
    totals[key].total += Number(row.total ?? row.amount ?? 0);
    return totals;
  }, {}));
}

export function documentReviewTarget(rows, target) {
  if (!target) return null;
  const row = (rows || []).find((candidate) => candidate.salesforceObject === target.salesforceObject
    && candidate.salesforceId === target.salesforceId) || null;
  const evidenceMissing = Boolean(row && (!target.sourceFingerprint || !row.sourceFingerprint || !row.reviewFingerprint));
  const changed = Boolean(row && !evidenceMissing && target.sourceFingerprint !== row.sourceFingerprint);
  return { row, changed, evidenceMissing, eligible: Boolean(row && !changed && !evidenceMissing && documentExplicitReviewEligible(row)) };
}

export function workflowCopy(language) {
  return language === 'zh-Hant' ? {
    summary: '匯款摘要', summaryDescription: '已核實的匯款摘要並非額外付款，不計入完成率。',
    attention: '需要處理', ready: '可同步', waiting: '等待中', matched: '已核對', all: '全部',
    postingMode: 'Xero 文件過帳方式', draftMode: '建立草稿', authorisedMode: '核准已核實文件',
    savedMode: '已儲存預覽方式', modeChanged: '過帳方式已變更；重新核對後方可選取／執行。',
    waitingDescription: '等待發票發出、連結或核准，未計入完成。',
    review: '檢閱並同步選取項目', reviewLinks: '檢閱所選連結', reviewPaymentLinks: '檢閱現有付款連結', singleReview: '檢閱', resolve: '檢閱／解決', confirm: '確認並同步', cancel: '取消', mapping: '修正對應',
    approveUpdate: '核准並更新', approveDraft: '核准並建立草稿', approveLink: '只核准連結', protectedLinkAction: '受保護舊紀錄 · 只連結',
    correctAndRecheck: '先修正再核對；財務限制仍適用。', recheck: '重新核對文件',
    targetMissing: '最新核對已無此文件。', targetChanged: 'Salesforce 已變更，請關閉再檢閱。', targetEvidenceMissing: '證據不完整，請重新核對。',
    checked: '上次核對', saved: '已儲存；同步前重新驗證。',
    locked: '同步已停用，仍可核對。須由管理員啟用已核准流程。',
    reviewDescription: '確認會記錄審批。只有建立／更新會寫入 Xero；不寄電郵或登記付款。',
    resumeDescription: '繼續已核准的選取項目，執行前重新驗證。',
    noRows: '此分類沒有項目。', details: '差異及證據',
    search: '搜尋文件、帳戶 ID 或 STEM', resume: '繼續已核准的同步',
    accountId: 'Salesforce 帳戶 ID', evidence: '配對依據', sharedAccounts: '共用 Xero 聯絡人的帳戶', candidates: 'Xero 候選紀錄',
    blockers: '阻礙原因', warnings: '警告', differences: '保留差異', acceptedLegacy: '已核准舊紀錄差異',
    legacyReview: '只記錄連結及審批；保留 Xero 歷史紀錄。',
    matchBasis: { stored_link: '已儲存的連結', document_number: '文件編號', stem_reference: 'STEM 參考資料', date_amount: '日期及金額' },
  } : {
    summary: 'Remittance summaries', summaryDescription: 'Allocation summaries; no extra payments or sync completion.',
    attention: 'Needs attention', ready: 'Ready to sync', waiting: 'Waiting', matched: 'Matched', all: 'All',
    postingMode: 'Xero document posting', draftMode: 'Create drafts', authorisedMode: 'Authorise verified documents',
    savedMode: 'Saved mode', modeChanged: 'Mode changed; recheck before proceeding.',
    waitingDescription: 'Awaiting invoice issue, linkage or authorisation.',
    review: 'Review and sync selected', reviewLinks: 'Review selected links', reviewPaymentLinks: 'Review existing payment links', singleReview: 'Review', resolve: 'Review / resolve', confirm: 'Confirm and sync', cancel: 'Cancel', mapping: 'Fix mapping',
    approveUpdate: 'Approve and update', approveDraft: 'Approve and create draft', approveLink: 'Approve link only', protectedLinkAction: 'Protected legacy · link only',
    correctAndRecheck: 'Resolve blockers and recheck; safeguards remain.', recheck: 'Recheck document',
    targetMissing: 'Document absent from the latest check.', targetChanged: 'Salesforce changed; close and review again.', targetEvidenceMissing: 'Evidence incomplete; recheck.',
    checked: 'Last checked', saved: 'Saved check; revalidated before sync.',
    locked: 'Sync is disabled. Checks remain available; an administrator must enable the approved workflow.',
    reviewDescription: 'Confirm to record approval. Only create/update writes to Xero; no emails or payments.',
    resumeDescription: 'Revalidate and resume the approved selection.',
    noRows: 'No records in this view.', details: 'Differences and evidence',
    search: 'Document, account ID or STEM', resume: 'Resume approved sync',
    accountId: 'Salesforce account ID', evidence: 'Match basis', sharedAccounts: 'Accounts sharing the Xero contact', candidates: 'Xero candidates',
    blockers: 'Blockers', warnings: 'Warnings', differences: 'Retained differences', acceptedLegacy: 'Accepted legacy differences',
    legacyReview: 'Records the approved link and preserves Xero history.',
    matchBasis: { stored_link: 'Stored link', document_number: 'Document number', stem_reference: 'STEM reference', date_amount: 'Date and amount' },
  };
}
