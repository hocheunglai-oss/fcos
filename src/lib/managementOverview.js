export function managementOverviewLinks(hasModuleAccess) {
  const links = [{ label: 'My Commitments', to: '/my-commitments', description: 'Personal deadlines, blockers and document filing.' }];
  if (hasModuleAccess('buyer_invoices')) links.push({ label: 'Collection Queue', to: '/payment-collections?tab=collections', description: 'Verified receivables and collection follow-ups.' });
  if (hasModuleAccess('buyer_invoices') || hasModuleAccess('incoming_payments')) links.push({ label: 'Payment reconciliation', to: '/payment-collections?tab=reconciliation', description: 'Review the current payment evidence and exceptions.' });
  if (hasModuleAccess('xero_portal')) links.push({ label: 'Xero reconciliation', to: '/xero-portal', description: 'Open your saved campaign and held cases.' });
  return links;
}

export function managementWorkSummary(snapshot) {
  if (!Array.isArray(snapshot?.commitments) || !snapshot.counts || !Number.isFinite(Date.parse(snapshot.generatedAt))) {
    throw new Error('A verified personal work summary was not returned.');
  }
  return {
    overdue: snapshot.counts.overdue || 0,
    needsAction: snapshot.counts.needs_action || 0,
    loaded: snapshot.commitments.length,
    checkedAt: snapshot.generatedAt,
    partial: Boolean(snapshot.unavailableSources?.length || snapshot.sourcesAtLimit?.length),
  };
}
