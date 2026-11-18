import { reconciliationBucket, isRemittanceSummary } from './financialWorkflowUi.js';
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
  const summaries = paymentSummary.summaries;
  const transactionTotal = total - summaries;
  const completion = checked ? (transactionTotal ? Math.round((reconciled / transactionTotal) * 100) : 100) : null;
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
    summaries,
    transactionTotal,
    reconciled,
    pending,
    waiting,
    exceptions,
    documents: documentSummary,
    payments: paymentSummary,
  };
}

const SALESFORCE_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const TENANT_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const exactId = (value) => typeof value === 'string' && SALESFORCE_ID.test(value) ? value.slice(0, 15) : null;

/** Combine only independently verified document, payment, credit and managed-cash coverage. */
export function summarizeCombinedXeroFinancialReconciliation({ documentPayments, credits, prepayments } = {}) {
  const incomplete = { status: 'incomplete_check', checked: false, completion: null };
  const { tenantId, cutoff, through, documents, payments } = documentPayments || {};
  const throughTime = Date.parse(through);
  if (!TENANT_ID.test(tenantId || '') || cutoff !== XERO_FINANCIAL_CUTOFF
      || !Number.isFinite(throughTime) || new Date(throughTime).toISOString() !== through || throughTime < Date.parse(cutoff)
      || ![documentPayments, credits, prepayments].every((lane) =>
        lane?.complete === true && lane.tenantId === tenantId && lane.cutoff === cutoff && lane.through === through)
      || ![documents, payments, credits.rows, prepayments.rows, prepayments.paymentBridges].every(Array.isArray)) return incomplete;

  function indexRows(rows, keyFor) {
    const index = new Map();
    for (const row of rows) {
      const key = keyFor(row);
      if (!key || index.has(key)) return null;
      index.set(key, row);
    }
    return index;
  }
  const enteredDocuments = indexRows(documents, row => exactId(row?.salesforceId));
  const enteredPayments = indexRows(payments, row => exactId(row?.salesforcePaymentId));
  const creditCases = indexRows(credits.rows, row => exactId(row?.creditId));
  const cashCases = indexRows(prepayments.rows, row => exactId(row?.sourceId));
  const bridgePayments = indexRows(prepayments.paymentBridges, row => exactId(row?.paymentId));
  const bridgeAllocations = indexRows(prepayments.paymentBridges, row => exactId(row?.allocationId));
  if (![enteredDocuments, enteredPayments, creditCases, cashCases, bridgePayments, bridgeAllocations].every(Boolean)) return incomplete;

  // Deduplication requires a verified bridge. A competing direct Xero payment
  // needs reconciliation before the lanes agree.
  const duplicates = new Set();
  for (const [paymentId, bridge] of bridgePayments) {
    const allocation = cashCases.get(exactId(bridge.allocationId));
    if (!exactId(bridge.cashEventId) || typeof bridge.reversal !== 'boolean' || typeof bridge.inCohort !== 'boolean'
        || Boolean(allocation) !== bridge.inCohort) return incomplete;
    if (!allocation) continue;
    if (allocation.sourceObject !== 'Trade_Cash_Allocation__c' || exactId(allocation.cashEventId) !== exactId(bridge.cashEventId)) return incomplete;
    const payment = enteredPayments.get(paymentId);
    if (!payment) continue;
    if (payment.xeroPaymentId || payment.action === 'payment_link' || isRemittanceSummary(payment)) return incomplete;
    duplicates.add(paymentId);
  }
  if (prepayments.rows.some(row => row.sourceObject === 'Trade_Cash_Allocation__c'
      ? !bridgeAllocations.has(exactId(row.sourceId))
      : row.sourceObject !== 'Trade_Cash_Event__c')
      || payments.some(row => row.action === 'prepayment_allocation' && !duplicates.has(exactId(row.salesforcePaymentId)))) return incomplete;

  const settlementRows = [...credits.rows, ...prepayments.rows];
  const settlementStatuses = ['reconciled', 'eligible', 'waiting', 'held', 'unresolved'];
  if (settlementRows.some(row => !settlementStatuses.includes(row.status)
      || (row.status === 'reconciled' && row.verified !== true))) return incomplete;
  const describeSettlement = row => ({ reconciled: 'reconciled', eligible: 'pending', waiting: 'waiting' })[row.status] || 'exception';
  const base = summarizeXeroFinancialReconciliation({
    documents, payments: payments.filter(row => !duplicates.has(exactId(row.salesforcePaymentId))),
  });
  const allocationSummary = summarizeRows(credits.rows, describeSettlement);
  const prepaymentSummary = summarizeRows(prepayments.rows, describeSettlement);
  const total = base.total + allocationSummary.total + prepaymentSummary.total;
  const transactionTotal = total - base.summaries;
  const reconciled = base.reconciled + allocationSummary.reconciled + prepaymentSummary.reconciled;
  const pending = base.pending + allocationSummary.pending + prepaymentSummary.pending;
  const waiting = base.waiting + allocationSummary.waiting + prepaymentSummary.waiting;
  const exceptions = base.exceptions + allocationSummary.exceptions + prepaymentSummary.exceptions;
  return {
    ...base, total, transactionTotal, reconciled, pending, waiting, exceptions,
    completion: transactionTotal ? Math.round(100 * reconciled / transactionTotal) : 100,
    status: exceptions ? 'attention_required' : pending ? (pending === waiting ? 'waiting' : 'sync_required') : 'reconciled',
    allocations: allocationSummary, prepayments: prepaymentSummary, duplicatePaymentCount: duplicates.size,
  };
}

export function xeroFinancialReconciliationRank(row, kind = 'document') {
  const classification = kind === 'payment' ? classifyPaymentRow(row) : classifyDocumentRow(row);
  return { exception: 0, pending: 1, waiting: 2, reconciled: 3, summary: 4 }[classification] ?? 4;
}

function summarizeRows(rows, classifier) {
  const summary = { total: rows.length, reconciled: 0, pending: 0, waiting: 0, exceptions: 0, summaries: 0 };
  for (const row of rows) {
    const classification = classifier(row);
    if (classification === 'waiting') { summary.pending += 1; summary.waiting += 1; }
    else if (classification === 'summary') summary.summaries += 1;
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
  if (isRemittanceSummary(row)) return 'summary';
  if (reconciliationBucket(row, 'payment') === 'waiting') return 'waiting';
  const blockers = Array.isArray(row.blockers) ? row.blockers : [];
  if (['blocked', 'failed'].includes(row.status) || blockers.length > 0) return 'exception';
  if (row.action === 'payment_reference_link') return 'exception';
  if (row.action === 'payment_link') return 'reconciled';
  if (row.action === 'payment_apply' && row.status === 'eligible') return 'pending';
  return 'exception';
}
