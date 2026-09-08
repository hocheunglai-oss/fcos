export const XERO_FINANCIAL_CUTOFF = '2026-01-01';

export function summarizeXeroFinancialReconciliation({ documents, payments } = {}) {
  const documentRows = Array.isArray(documents) ? documents : null;
  const paymentRows = Array.isArray(payments) ? payments : null;
  const documentsChecked = documentRows !== null;
  const paymentsChecked = paymentRows !== null;
  const documentSummary = summarizeRows(documentRows || [], classifyDocumentRow);
  const paymentSummary = summarizeRows(paymentRows || [], classifyPaymentRow);
  const total = documentSummary.total + paymentSummary.total;
  const reconciled = documentSummary.reconciled + paymentSummary.reconciled;
  const pending = documentSummary.pending + paymentSummary.pending;
  const exceptions = documentSummary.exceptions + paymentSummary.exceptions;
  const checked = documentsChecked && paymentsChecked;
  const completion = checked ? (total ? Math.round((reconciled / total) * 100) : 100) : null;
  const status = !documentsChecked && !paymentsChecked
    ? 'not_checked'
    : !checked
      ? 'incomplete_check'
      : exceptions > 0
        ? 'attention_required'
        : pending > 0
          ? 'sync_required'
          : 'reconciled';

  return {
    status,
    checked,
    completion,
    total,
    reconciled,
    pending,
    exceptions,
    documents: documentSummary,
    payments: paymentSummary,
  };
}

export function xeroFinancialReconciliationRank(row, kind = 'document') {
  const classification = kind === 'payment' ? classifyPaymentRow(row) : classifyDocumentRow(row);
  return { exception: 0, pending: 1, reconciled: 2 }[classification] ?? 3;
}

function summarizeRows(rows, classifier) {
  const summary = { total: rows.length, reconciled: 0, pending: 0, exceptions: 0 };
  for (const row of rows) {
    const classification = classifier(row);
    summary[classification === 'exception' ? 'exceptions' : classification] += 1;
  }
  return summary;
}

function classifyDocumentRow(row = {}) {
  const differences = Array.isArray(row.differences) ? row.differences : [];
  if (row.status === 'blocked' || (row.action === 'protected_legacy' && differences.length > 0)) return 'exception';
  if (row.action === 'link' && differences.length === 0) return 'reconciled';
  if (row.action === 'protected_legacy' && differences.length === 0) return 'reconciled';
  if (row.status === 'eligible' && ['create_draft', 'safe_update'].includes(row.action)) return 'pending';
  return 'exception';
}

function classifyPaymentRow(row = {}) {
  const blockers = Array.isArray(row.blockers) ? row.blockers : [];
  if (row.status === 'blocked' || blockers.length > 0) return 'exception';
  if (row.action === 'payment_link') return 'reconciled';
  if (row.action === 'payment_apply' && row.status === 'eligible') return 'pending';
  return 'exception';
}
