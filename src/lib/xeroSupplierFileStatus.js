const MISSING_FILE = 'Supplier invoice has no verified issued source file.';

// Display only: attachment metadata never supplies readiness or approval.
export function supplierFileStatus(row, copy) {
  const blockers = row.blockers || [];
  if (row.salesforceObject !== 'Supplier_Invoice__c') return { status: null, blockers };
  const discovery = row.sourceFileDiscovery;
  if (!discovery && !blockers.includes(MISSING_FILE)) return { status: null, blockers };
  const accepted = row.acceptedLegacy === true && row.reviewRequired !== true
    && ['protected', 'linked'].includes(row.status) && ['protected_legacy', 'link'].includes(row.action);
  let status = ['partial', 'not_checked'].includes(discovery?.status) ? discovery.status : discovery ? 'unavailable' : 'not_checked';
  if (discovery?.sourceId === row.salesforceId && discovery.status === 'complete' && discovery.complete === true
    && Array.isArray(discovery.candidates) && discovery.linkedPdfCount === discovery.candidates.length
    && discovery.candidates.every(file => file?.fileType?.toUpperCase?.() === 'PDF' && file?.fileExtension?.toLowerCase?.() === 'pdf')) {
    status = discovery.candidates.length ? 'complete' : 'empty';
  }
  return { status: accepted ? null : status,
    blockers: blockers.filter(reason => !accepted || reason !== MISSING_FILE)
      .map(reason => reason === MISSING_FILE ? copy[status] : reason) };
}
