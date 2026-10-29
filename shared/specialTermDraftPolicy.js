// Salesforce requires a nonempty audit reason even for work saved before review.
export const SPECIAL_TERM_PENDING_REASON = 'Draft saved; change reason pending.';

export function editableRevisionReason(revision) {
  if (!['Draft', 'In Review', 'Changes Requested'].includes(revision?.status)) return '';
  return revision.revisionReason === SPECIAL_TERM_PENDING_REASON ? '' : revision.revisionReason || '';
}
