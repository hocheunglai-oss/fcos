export const DISPUTE_STAGES = ['Prepare', 'Approve', 'Settle', 'Closed'];
export function disputeStage(status) {
  if (status === 'Closed') return 'Closed';
  if (status === 'Pending Approval') return 'Approve';
  if (['Approved - Pending Accounting', 'Accounting In Progress', 'Settled - Ready to Close'].includes(status)) return 'Settle';
  return 'Prepare';
}
export function disputeNextAction(caseRow = {}) {
  caseRow ??= {};
  if (caseRow.workflowStatus === 'Closed') return 'View settlement';
  if (caseRow.externalClosure) return 'Resolve closure mismatch';
  if (caseRow.workflowStatus === 'Pending Approval') return 'Review agreement';
  if (caseRow.workflowStatus === 'Settled - Ready to Close') return 'Complete closure';
  if (disputeStage(caseRow.workflowStatus) === 'Settle') return 'Record settlement';
  return 'Complete agreement';
}
export function disputeStatusLabel(caseRow = {}) {
  caseRow ??= {};
  if (caseRow.externalClosure) return 'Commercially closed — Finance completion required';
  if (caseRow.workflowStatus === 'Revision Requested' || caseRow.workflowStatus === 'Rejected') return `Prepare · ${caseRow.workflowStatus}`;
  if (caseRow.workflowStatus === 'Settled - Ready to Close') return 'Settle · Ready to close';
  return disputeStage(caseRow.workflowStatus);
}
export function remainingDisputeRequirements({ partiesValid, actions = [], missingDocuments = [], supplierAmounts = [], supplierConversions = [], reconciliationError } = {}) {
  return [!partiesValid && 'Select valid disputed Accounts.', !actions.length && 'Complete at least one commercial outcome.',
    missingDocuments.length > 0 && `Attach evidence to ${missingDocuments.length} outcome(s).`,
    supplierAmounts.length > 0 && 'Enter each agreed supplier amount.', supplierConversions.length > 0 && 'Update the legacy supplier instructions.',
    reconciliationError && String(reconciliationError)].filter(Boolean);
}

export function isFinalSettlement({ actionId, instructionId, actions = [], instructions = [] }) {
  const complete = (status) => ['Settled', 'Not Required'].includes(status);
  if (!actions.length || (!actionId && !instructionId)) return false;
  return actions.every((action) => {
    const active = instructions.filter((row) => row.actionId === action.id && row.status !== 'Superseded');
    if (active.length) return active.every((row) => row.id === instructionId || complete(row.status));
    return action.id === actionId || complete(action.accountingStatus || action.executionStatus);
  });
}
