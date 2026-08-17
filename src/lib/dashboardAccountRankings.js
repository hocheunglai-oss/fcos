function normalizedAccountName(value) {
  return String(value || '').trim().toUpperCase();
}

export function dashboardAccountRankings(rows = [], field, {
  excludedAccountIds = new Set(),
  excludedAccountNames = new Set(),
} = {}) {
  const totals = new Map();
  for (const row of rows) {
    const entities = field === 'account'
      ? row.account ? [{ id: row.account.id, name: row.account.name, value: row.netPnl, role: 'buyer' }] : []
      : field === 'port'
        ? row.port ? [{ id: row.port.id, name: row.port.name, value: row.netPnl, role: 'port' }] : []
        : (row.supplierAllocations || []).map((item) => ({ id: item.id, name: item.name, value: item.netPnl, role: 'supplier' }));
    for (const entity of entities) {
      if (!entity.name || entity.value == null) continue;
      if (excludedAccountIds.has(entity.id) || (!entity.id && excludedAccountNames.has(normalizedAccountName(entity.name)))) continue;
      const key = `${row.currency}\u001f${entity.id || ''}\u001f${entity.name}\u001f${entity.role}`;
      totals.set(key, (totals.get(key) || 0) + Number(entity.value));
    }
  }
  return [...totals.entries()].map(([key, netPnl]) => {
    const [currency, accountId, name, role] = key.split('\u001f');
    return { currency, accountId: accountId || null, name, role, netPnl, grossProfit: netPnl };
  }).sort((left, right) => right.netPnl - left.netPnl || left.name.localeCompare(right.name));
}
