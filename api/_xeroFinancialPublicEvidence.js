const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const scalar = value => value == null || ['string', 'number', 'boolean'].includes(typeof value);

function metadata(value, fields) {
  if (value == null) return value;
  if (!object(value)) return null;
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field) && scalar(value[field]))
    .map(field => [field, value[field]]));
}

const BANK_FIELDS = ['source', 'policyVersion', 'parentId', 'bank', 'date', 'currency',
  'allocationCount', 'siblingCount', 'fingerprint', 'siblingsDigest'];
const SUMMARY_FIELDS = ['policyVersion', 'parentId', 'allocationCount', 'date', 'currency', 'totalCents', 'fingerprint'];
const WORKFLOW_FIELDS = ['reconciliationVersion', 'tenantId', 'includePayments', 'recordExactMatches', 'checkedAt'];

function publicPaymentRow(row) {
  if (!object(row)) return row;
  const { bankSourceEvidence: _bankSource, buyerDocumentEvidence: _buyerDocuments,
    groupBankSourceRevalidation: _groupRevalidation,
    ordinaryRemittanceCashEvidence: _ordinaryCash, ordinaryRemittanceReviewBase: _ordinaryReview,
    retainedReferenceEvidence: _retainedReference, documentMappingSnapshot: _documentMapping,
    bankMappingSnapshot: _bankMapping, ...result } = row;
  if (Object.hasOwn(row, 'bankEvidence')) result.bankEvidence = metadata(row.bankEvidence, BANK_FIELDS);
  if (Object.hasOwn(row, 'remittanceSummary')) {
    result.remittanceSummary = metadata(row.remittanceSummary, SUMMARY_FIELDS);
    if (object(row.remittanceSummary) && Array.isArray(row.remittanceSummary.allocationIds)
      && row.remittanceSummary.allocationIds.every(value => typeof value === 'string')) {
      result.remittanceSummary.allocationIds = [...row.remittanceSummary.allocationIds];
    }
  }
  return result;
}

// Presentation projections only. Full evidence remains in the server snapshot
// and durable records; these compact objects cannot authorize financial actions.
export function publicPaymentSnapshot(snapshot) {
  if (!object(snapshot)) return snapshot;
  return { ...snapshot, ...(Array.isArray(snapshot.rows) ? { rows: snapshot.rows.map(publicPaymentRow) } : {}) };
}

export function publicFinancialControlTotals(controlTotals) {
  if (!object(controlTotals)) return controlTotals;
  return { ...controlTotals, ...(Object.hasOwn(controlTotals, 'workflowSnapshot')
    ? { workflowSnapshot: metadata(controlTotals.workflowSnapshot, WORKFLOW_FIELDS) } : {}) };
}
