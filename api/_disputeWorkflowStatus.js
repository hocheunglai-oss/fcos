function validIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeSalesforceDisputeStatus(value) {
  return String(value || '').trim();
}

export function isSalesforceDisputeClosed(value) {
  return /^closed\b/i.test(normalizeSalesforceDisputeStatus(value));
}

export function hasRecordedFcosClosureWriteback(caseRow = {}) {
  const storedSalesforceStatus = caseRow.current_salesforce_status ?? caseRow.currentSalesforceStatus ?? '';
  const writebackStatus = caseRow.salesforce_writeback_status ?? caseRow.salesforceWritebackStatus ?? '';
  return isSalesforceDisputeClosed(storedSalesforceStatus) && writebackStatus === 'success';
}

export function projectExternalDisputeClosure(caseRow = {}, stem = {}) {
  const salesforceStatus = normalizeSalesforceDisputeStatus(stem.Dispute_Status__c);
  if (!caseRow?.id || !isSalesforceDisputeClosed(salesforceStatus)) return null;

  const workflowStatus = caseRow.workflow_status ?? caseRow.workflowStatus ?? '';
  if (hasRecordedFcosClosureWriteback(caseRow)) return null;
  return {
    workflowStatus: 'Closed',
    currentSalesforceStatus: salesforceStatus,
    internalWorkflowStatus: workflowStatus || 'Draft',
    externalClosure: true,
    legacyReadOnly: true,
    salesforceLastModifiedAt: validIsoDate(stem.LastModifiedDate),
  };
}
