export function accountInsightDirection(account = {}) {
  if (account.role === 'supplier') return 'supplier';
  return account.role === 'both' ? 'both' : 'buyer';
}

export function selectAccountInsightPresentation(response, direction = 'buyer') {
  const both = response?.buyer || response?.supplier ? response : null;
  const primary = both ? (direction === 'supplier' ? both.supplier : both.buyer) : response;
  return {
    primary: primary || null,
    buyer: both?.buyer || null,
    supplier: both?.supplier || null,
    currentExposure: both?.currentExposure || primary?.currentExposure || null,
    groupScope: both?.groupScope || primary?.groupScope || null,
    isBoth: Boolean(both),
  };
}

export function moveReportItem(selected, id, offset) {
  const index = selected.indexOf(id);
  const destination = index + offset;
  if (index < 0 || destination < 0 || destination >= selected.length) return selected;
  const next = [...selected];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

export function selectedGroupAccountIds(groupScope, selectedAccountIds) {
  if (Array.isArray(selectedAccountIds)) return selectedAccountIds;
  if (Array.isArray(groupScope?.includedAccountIds)) return groupScope.includedAccountIds;
  return Array.isArray(groupScope?.availableAccounts)
    ? groupScope.availableAccounts.filter((account) => account.included).map((account) => account.accountId)
    : [];
}

export function nextInsightLoadSection(activeTab, sections = {}) {
  if (!sections.overview) return 'overview';
  if (activeTab === 'credit' || sections[activeTab]) return null;
  return activeTab;
}
