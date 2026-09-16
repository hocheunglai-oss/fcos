export function reconciliationBucket(row = {}, kind = 'document') {
  const blockers = row.blockers || [];
  if (kind === 'payment') {
    if (blockers.length && blockers.every((reason) => /not durably linked|No linked buyer invoice|not authorised for payment/.test(reason))) return 'waiting';
    if (blockers.length || row.status === 'blocked' || row.status === 'failed') return 'attention';
    return row.action === 'payment_link' ? 'matched' : 'ready';
  }
  if (blockers.length || ['blocked', 'failed'].includes(row.status) || (row.action === 'protected_legacy' && row.differences?.length)) return 'attention';
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
    reviewDescription: '確認以下文件、幣別、金額及差異。此操作會保留審批記錄，並同步至 Xero；不會發送電郵或登記付款。',
    noRows: '此分類沒有項目。', waitInvoice: '等待發票同步或 Xero 審批', details: '差異及證據',
    setup: '連線及系統資料', search: '搜尋文件、公司或 STEM', resume: '繼續已核准的同步',
  } : {
    attention: 'Needs attention', ready: 'Ready to sync', waiting: 'Waiting', matched: 'Matched', all: 'All',
    review: 'Review and sync selected', confirm: 'Confirm and sync', cancel: 'Cancel', mapping: 'Fix mapping',
    checked: 'Last checked', saved: 'Saved check. Selected records are revalidated before syncing.',
    locked: 'Financial sync is disabled. Checks remain available; an administrator must enable the approved financial workflow.',
    reviewDescription: 'Review the documents, currencies, amounts and differences below. Confirmation records your approval and syncs these documents to Xero. It does not send emails or post payments.',
    noRows: 'No records in this view.', waitInvoice: 'Waiting for invoice sync or Xero approval', details: 'Differences and evidence',
    setup: 'Connection and system details', search: 'Search document, account or STEM', resume: 'Resume approved sync',
  };
}
