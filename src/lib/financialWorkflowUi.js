export function reconciliationBucket(row = {}, kind = 'document') {
  const blockers = row.blockers || [];
  if (kind === 'payment') {
    if (blockers.length && blockers.every((reason) => /not durably linked|No linked buyer invoice|not authorised for payment/.test(reason))) return 'waiting';
    if (blockers.length || row.status === 'blocked' || row.status === 'failed') return 'attention';
    return row.action === 'payment_link' ? 'matched' : 'ready';
  }
  if (blockers.length || ['blocked', 'failed'].includes(row.status)) return 'attention';
  if (row.acceptedLegacy) return 'matched';
  if (row.reviewRequired && row.status === 'eligible') return 'ready';
  if (row.action === 'protected_legacy' && row.differences?.length) return 'attention';
  if (['link', 'protected_legacy'].includes(row.action) || ['linked', 'updated', 'created'].includes(row.status)) return 'matched';
  return 'ready';
}

export function retainedReviewSelection(previousRows, nextRows, selectedIds) {
  const selected = new Map(previousRows.filter((row) => selectedIds.has(row.id)).map((row) => [`${row.salesforceObject}:${row.salesforceId}`, row]));
  return new Set(nextRows.filter((row) => {
    const before = selected.get(`${row.salesforceObject}:${row.salesforceId}`);
    return before?.reviewFingerprint && before.reviewFingerprint === row.reviewFingerprint && reconciliationBucket(row) === 'ready';
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
      && before.sourceFingerprint === row.sourceFingerprint && row.status === 'eligible'
      && reconciliationBucket(row, kind) === 'ready';
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

export function workflowCopy(language) {
  return language === 'zh-Hant' ? {
    attention: '需要處理', ready: '可同步', waiting: '等待中', matched: '已核對', all: '全部',
    review: '檢閱並同步所選項目', confirm: '確認並同步', cancel: '取消', mapping: '修正對應',
    checked: '上次核對', saved: '已儲存的核對結果；同步前會重新驗證。',
    locked: '財務同步已停用。仍可核對；請聯絡管理員啟用已核准的財務流程。',
    reviewDescription: '檢閱文件及差異。確認會記錄審批；只有建立或更新操作會寫入 Xero，不會發送電郵或登記付款。',
    noRows: '此分類沒有項目。', waitInvoice: '等待發票同步或 Xero 審批', details: '差異及證據',
    search: '搜尋文件、帳戶 ID 或 STEM', resume: '繼續已核准的同步',
    accountId: 'Salesforce 帳戶 ID', evidence: '配對依據', sharedAccounts: '共用 Xero 聯絡人的帳戶', candidates: 'Xero 候選紀錄',
    blockers: '阻礙原因', warnings: '警告', differences: '保留差異', acceptedLegacy: '已核准舊紀錄差異',
    legacyReview: '受保護舊紀錄：確認只會記錄連結及審批；Xero 歷史紀錄不會變更。',
    matchBasis: { stored_link: '已儲存的連結', document_number: '文件編號', stem_reference: 'STEM 參考資料', date_amount: '日期及金額' },
  } : {
    attention: 'Needs attention', ready: 'Ready to sync', waiting: 'Waiting', matched: 'Matched', all: 'All',
    review: 'Review and sync selected', confirm: 'Confirm and sync', cancel: 'Cancel', mapping: 'Fix mapping',
    checked: 'Last checked', saved: 'Saved check. Selected records are revalidated before syncing.',
    locked: 'Financial sync is disabled. Checks remain available; an administrator must enable the approved financial workflow.',
    reviewDescription: 'Review the documents and differences. Confirmation records your approval; only create and update actions write to Xero. It does not send emails or post payments.',
    noRows: 'No records in this view.', waitInvoice: 'Waiting for invoice sync or Xero approval', details: 'Differences and evidence',
    search: 'Search document, account ID or STEM', resume: 'Resume approved sync',
    accountId: 'Salesforce account ID', evidence: 'Match basis', sharedAccounts: 'Accounts sharing the Xero contact', candidates: 'Xero candidates',
    blockers: 'Blockers', warnings: 'Warnings', differences: 'Retained differences', acceptedLegacy: 'Accepted legacy differences',
    legacyReview: 'Protected legacy: confirmation records the link and approval only; Xero accounting history remains unchanged.',
    matchBasis: { stored_link: 'Stored link', document_number: 'Document number', stem_reference: 'STEM reference', date_amount: 'Date and amount' },
  };
}
