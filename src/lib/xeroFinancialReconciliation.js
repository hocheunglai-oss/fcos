import { reconciliationBucket } from './financialWorkflowUi.js';
export const XERO_FINANCIAL_CUTOFF = '2026-01-01';

export function summarizeXeroFinancialReconciliation({ documents, payments } = {}) {
  const documentRows = Array.isArray(documents) ? documents : null;
  const paymentRows = Array.isArray(payments) ? payments : null;
  const documentsChecked = documentRows !== null;
  const paymentsChecked = paymentRows !== null;
  const documentSummary = summarizeRows(documentRows || [], classifyDocumentRow);
  documentSummary.acceptedLegacy = (documentRows || []).filter((row) => row.acceptedLegacy && classifyDocumentRow(row) === 'reconciled').length;
  const paymentSummary = summarizeRows(paymentRows || [], classifyPaymentRow);
  const total = documentSummary.total + paymentSummary.total;
  const reconciled = documentSummary.reconciled + paymentSummary.reconciled;
  const pending = documentSummary.pending + paymentSummary.pending;
  const waiting = documentSummary.waiting + paymentSummary.waiting;
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
          ? pending === waiting ? 'waiting' : 'sync_required'
          : 'reconciled';

  return {
    status,
    checked,
    completion,
    total,
    reconciled,
    pending,
    waiting,
    exceptions,
    documents: documentSummary,
    payments: paymentSummary,
  };
}

export function xeroFinancialReconciliationRank(row, kind = 'document') {
  const classification = kind === 'payment' ? classifyPaymentRow(row) : classifyDocumentRow(row);
  return { exception: 0, pending: 1, waiting: 2, reconciled: 3 }[classification] ?? 4;
}

function summarizeRows(rows, classifier) {
  const summary = { total: rows.length, reconciled: 0, pending: 0, waiting: 0, exceptions: 0 };
  for (const row of rows) {
    const classification = classifier(row);
    if (classification === 'waiting') { summary.pending += 1; summary.waiting += 1; }
    else summary[classification === 'exception' ? 'exceptions' : classification] += 1;
  }
  return summary;
}

function classifyDocumentRow(row = {}) {
  const differences = Array.isArray(row.differences) ? row.differences : [];
  if (reconciliationBucket(row) === 'waiting') return 'waiting';
  if (['blocked', 'failed'].includes(row.status) || row.blockers?.length) return 'exception';
  if (row.acceptedLegacy) return 'reconciled';
  if (row.action === 'protected_legacy' && (differences.length > 0 || row.reviewRequired === true)) return 'exception';
  if (row.reviewRequired && row.status === 'eligible') return 'pending';
  if (row.action === 'link' && differences.length === 0) return 'reconciled';
  if (row.action === 'protected_legacy' && differences.length === 0) return 'reconciled';
  if (row.status === 'eligible' && ['create_draft', 'safe_update'].includes(row.action)) return 'pending';
  return 'exception';
}

function classifyPaymentRow(row = {}) {
  if (reconciliationBucket(row, 'payment') === 'waiting') return 'waiting';
  const blockers = Array.isArray(row.blockers) ? row.blockers : [];
  if (['blocked', 'failed'].includes(row.status) || blockers.length > 0) return 'exception';
  if (row.action === 'payment_reference_link') return 'exception';
  if (row.action === 'payment_link') return 'reconciled';
  if (row.action === 'payment_apply' && row.status === 'eligible') return 'pending';
  return 'exception';
}
