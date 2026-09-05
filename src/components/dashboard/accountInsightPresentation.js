export function accountInsightDirection(account = {}) {
  if (account.role === 'supplier') return 'supplier';
  return account.role === 'both' ? 'both' : 'buyer';
}

export function accountInsightSelectionKey(account = {}) {
  return account.accountId ? `${account.accountId}:${account.entityType || 'account'}` : null;
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

function appendStemRows(existingRows = [], incomingRows = []) {
  const seen = new Set();
  return [...existingRows, ...incomingRows].filter((row) => {
    const key = row?.stemId || row?.id;
    if (!key || seen.has(key)) return !key;
    seen.add(key);
    return true;
  });
}

export function appendAccountInsightStemPage(currentResponse, nextResponse, direction = 'buyer') {
  if (!currentResponse) return nextResponse;
  const selectedLeg = direction === 'supplier' ? 'supplier' : 'buyer';
  if (currentResponse?.buyer || currentResponse?.supplier || nextResponse?.buyer || nextResponse?.supplier) {
    const otherLeg = selectedLeg === 'buyer' ? 'supplier' : 'buyer';
    const currentLeg = currentResponse[selectedLeg] || {};
    const nextLeg = nextResponse[selectedLeg] || {};
    return {
      ...currentResponse,
      ...nextResponse,
      [otherLeg]: currentResponse[otherLeg] || nextResponse[otherLeg],
      [selectedLeg]: {
        ...currentLeg,
        ...nextLeg,
        stems: { ...currentLeg.stems, ...nextLeg.stems, rows: appendStemRows(currentLeg.stems?.rows, nextLeg.stems?.rows) },
      },
    };
  }
  return {
    ...currentResponse,
    ...nextResponse,
    stems: { ...currentResponse.stems, ...nextResponse.stems, rows: appendStemRows(currentResponse.stems?.rows, nextResponse.stems?.rows) },
  };
}

export function groupIdentityLabel(group) {
  if (!group) return 'Not applicable';
  const name = String(group.name || '').trim();
  const clKey = String(group.clKey || '').trim();
  if (name && clKey && name.localeCompare(clKey, undefined, { sensitivity: 'accent' }) !== 0) return `${name} · ${clKey}`;
  return name || clKey || 'Not applicable';
}

export function activityTiming(daysSinceLastActivity) {
  if (daysSinceLastActivity == null || daysSinceLastActivity === '') return null;
  const days = Number(daysSinceLastActivity);
  if (!Number.isFinite(days)) return null;
  return { isUpcoming: days < 0, days: Math.abs(days) };
}

export function nextInsightLoadSection(activeTab, sections = {}) {
  if (!sections.overview) return 'overview';
  if (activeTab === 'credit' || sections[activeTab]) return null;
  return activeTab;
}
