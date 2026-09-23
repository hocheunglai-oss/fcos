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

export function reconciliationBucket(row = {}, kind = 'document') {
  const blockers = row.blockers || [];
  if (kind === 'payment') {
    if (waitsOnDependency(row, kind)) return 'waiting';
    if (blockers.length || row.status === 'blocked' || row.status === 'failed') return 'attention';
    return row.action === 'payment_link' ? 'matched' : 'ready';
  }
  if (waitsOnDependency(row, kind)) return 'waiting';
  if (blockers.length || ['blocked', 'failed'].includes(row.status)) return 'attention';
  if (row.acceptedLegacy) return 'matched';
  if (row.action === 'protected_legacy' && row.differences?.length) return 'attention';
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
    && Boolean(row.differences?.length) && reconciliationBucket(row) === 'attention';
}

export function retainedReviewSelection(previousRows, nextRows, selectedIds) {
  const selected = new Map(previousRows.filter((row) => selectedIds.has(row.id)).map((row) => [`${row.salesforceObject}:${row.salesforceId}`, row]));
  return new Set(nextRows.filter((row) => {
    const before = selected.get(`${row.salesforceObject}:${row.salesforceId}`);
    return before?.reviewFingerprint && before.reviewFingerprint === row.reviewFingerprint
      && before.sourceFingerprint && before.sourceFingerprint === row.sourceFingerprint
      && documentExplicitReviewEligible(row);
  }).map((row) => row.id));
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
      && (kind === 'payment' ? row.status === 'eligible' && reconciliationBucket(row, kind) === 'ready'
        : documentExplicitReviewEligible(row));
  }).map((row) => kind === 'payment' ? row.salesforcePaymentId : row.id));
}

export function documentReviewTotals(rows) {
  return Object.values(rows.reduce((totals, row) => {
    const key = `${row.currency}:${row.action}`;
    totals[key] ||= { currency: row.currency, action: row.action, count: 0, total: 0 };
    totals[key].count += 1;
    totals[key].total += Number(row.total || 0);
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
    attention: '需要處理', ready: '可同步', waiting: '等待中', matched: '已核對', all: '全部',
    postingMode: 'Xero 文件過帳方式', draftMode: '建立草稿', authorisedMode: '核准已核實文件',
    savedMode: '已儲存預覽方式', modeChanged: '過帳方式已變更。請重新核對後再選擇或執行文件。',
    waitingDescription: '文件或付款仍在等待發票發出、連結或核准；未計入已完成。',
    review: '檢閱並同步所選項目', reviewLinks: '檢閱所選連結', singleReview: '檢閱', resolve: '檢閱／解決', confirm: '確認並同步', cancel: '取消', mapping: '修正對應',
    approveUpdate: '核准並更新', approveDraft: '核准並建立草稿', approveLink: '只核准連結', protectedLinkAction: '受保護舊紀錄 · 只連結',
    correctAndRecheck: '請先修正阻礙原因，再重新核對。無法略過財務限制。', recheck: '重新核對文件',
    targetMissing: '此文件已不在最新核對結果中。', targetChanged: 'Salesforce 文件已變更；請關閉並重新檢閱。', targetEvidenceMissing: '文件核對證據不完整；請重新核對。',
    checked: '上次核對', saved: '已儲存的核對結果；同步前會重新驗證。',
    locked: '財務同步已停用。仍可核對；請聯絡管理員啟用已核准的財務流程。',
    reviewDescription: '檢閱文件及差異。確認會記錄審批；只有建立或更新操作會寫入 Xero，不會發送電郵或登記付款。',
    resumeDescription: '繼續已核准的同步。下列文件來自已儲存的選取範圍；執行前會重新驗證。',
    noRows: '此分類沒有項目。', waitInvoice: '等待發票同步或 Xero 審批', details: '差異及證據',
    search: '搜尋文件、帳戶 ID 或 STEM', resume: '繼續已核准的同步',
    accountId: 'Salesforce 帳戶 ID', evidence: '配對依據', sharedAccounts: '共用 Xero 聯絡人的帳戶', candidates: 'Xero 候選紀錄',
    blockers: '阻礙原因', warnings: '警告', differences: '保留差異', acceptedLegacy: '已核准舊紀錄差異',
    legacyReview: '受保護舊紀錄：確認只會記錄連結及審批；Xero 歷史紀錄不會變更。',
    matchBasis: { stored_link: '已儲存的連結', document_number: '文件編號', stem_reference: 'STEM 參考資料', date_amount: '日期及金額' },
  } : {
    attention: 'Needs attention', ready: 'Ready to sync', waiting: 'Waiting', matched: 'Matched', all: 'All',
    postingMode: 'Xero document posting', draftMode: 'Create drafts', authorisedMode: 'Authorise verified documents',
    savedMode: 'Saved preview mode', modeChanged: 'Posting mode changed. Recheck before selecting or running documents.',
    waitingDescription: 'Documents or payments await invoice issue, linkage or authorisation and do not count as complete.',
    review: 'Review and sync selected', reviewLinks: 'Review selected links', singleReview: 'Review', resolve: 'Review / resolve', confirm: 'Confirm and sync', cancel: 'Cancel', mapping: 'Fix mapping',
    approveUpdate: 'Approve and update', approveDraft: 'Approve and create draft', approveLink: 'Approve link only', protectedLinkAction: 'Protected legacy · link only',
    correctAndRecheck: 'Correct the blockers, then recheck. Financial safeguards cannot be overridden.', recheck: 'Recheck document',
    targetMissing: 'This document is absent from the latest check.', targetChanged: 'The Salesforce document changed; close and review it again.', targetEvidenceMissing: 'Document review evidence is incomplete; recheck it.',
    checked: 'Last checked', saved: 'Saved check. Selected records are revalidated before syncing.',
    locked: 'Financial sync is disabled. Checks remain available; an administrator must enable the approved financial workflow.',
    reviewDescription: 'Review the documents and differences. Confirmation records your approval; only create and update actions write to Xero. It does not send emails or post payments.',
    resumeDescription: 'Resume the approved sync. These documents come from the saved selection and are revalidated before execution.',
    noRows: 'No records in this view.', waitInvoice: 'Waiting for invoice sync or Xero approval', details: 'Differences and evidence',
    search: 'Search document, account ID or STEM', resume: 'Resume approved sync',
    accountId: 'Salesforce account ID', evidence: 'Match basis', sharedAccounts: 'Accounts sharing the Xero contact', candidates: 'Xero candidates',
    blockers: 'Blockers', warnings: 'Warnings', differences: 'Retained differences', acceptedLegacy: 'Accepted legacy differences',
    legacyReview: 'Protected legacy: confirmation records the link and approval only; Xero accounting history remains unchanged.',
    matchBasis: { stored_link: 'Stored link', document_number: 'Document number', stem_reference: 'STEM reference', date_amount: 'Date and amount' },
  };
}
