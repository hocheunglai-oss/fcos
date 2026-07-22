const SALESFORCE_ACCOUNT_ID_RE = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value || '').trim();
}

function compareText(left, right) {
  return text(left).localeCompare(text(right), undefined, { sensitivity: 'base' });
}

export function buyerAccountIdKey(value) {
  const id = text(value);
  return SALESFORCE_ACCOUNT_ID_RE.test(id) ? id.slice(0, 15) : '';
}

export function normalizeBuyerTraderUserIds(values) {
  if (!Array.isArray(values)) throw new Error('Trader assignments must be a list.');
  const ids = values.map(text);
  if (ids.length > 3) throw new Error('A buyer can have at most three traders.');
  if (ids.some((id) => !UUID_RE.test(id))) throw new Error('Every trader must be a valid FCOS user.');
  if (new Set(ids).size !== ids.length) throw new Error('The same trader cannot be assigned more than once.');
  return ids;
}

export function buildBuyerTraderRows({
  salesforceBuyers = [],
  managedAccounts = [],
  assignments = [],
  profiles = [],
} = {}) {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const assignmentRowsByAccount = new Map();

  for (const assignment of assignments) {
    if (!assignmentRowsByAccount.has(assignment.buyer_account_key)) {
      assignmentRowsByAccount.set(assignment.buyer_account_key, []);
    }
    assignmentRowsByAccount.get(assignment.buyer_account_key).push(assignment);
  }

  const accountsByKey = new Map();
  for (const account of managedAccounts) {
    const key = buyerAccountIdKey(account.buyer_account_id || account.buyer_account_key);
    if (!key) continue;
    accountsByKey.set(key, {
      buyerAccountKey: key,
      buyerAccountId: account.buyer_account_id || key,
      buyerName: account.buyer_account_name || key,
      stemCount: 0,
      latestDeliveryDate: null,
      salesforceActive: false,
      updatedAt: account.updated_at || null,
      updatedByEmail: account.updated_by_email || null,
    });
  }

  for (const buyer of salesforceBuyers) {
    const accountId = text(buyer.buyerAccountId || buyer.Account__c || buyer.Id);
    const key = buyerAccountIdKey(accountId);
    if (!key) continue;
    const existing = accountsByKey.get(key) || {};
    accountsByKey.set(key, {
      ...existing,
      buyerAccountKey: key,
      buyerAccountId: accountId,
      buyerName: text(buyer.buyerName || buyer.Account__r?.Name || buyer.Name) || existing.buyerName || accountId,
      stemCount: Number(buyer.stemCount || 0),
      latestDeliveryDate: buyer.latestDeliveryDate || null,
      salesforceActive: true,
    });
  }

  return [...accountsByKey.values()]
    .map((account) => {
      const traders = (assignmentRowsByAccount.get(account.buyerAccountKey) || [])
        .slice()
        .sort((left, right) => Number(left.assignment_order || 0) - Number(right.assignment_order || 0))
        .map((assignment) => {
          const profile = profilesById.get(assignment.trader_user_id);
          return {
            id: assignment.trader_user_id,
            fullName: profile?.full_name || profile?.email || 'Unknown user',
            email: profile?.email || '',
            userType: profile?.user_type || '',
            active: profile?.active === true,
          };
        });
      return { ...account, traders, traderCount: traders.length };
    })
    .sort((left, right) => compareText(left.buyerName, right.buyerName)
      || compareText(left.buyerAccountKey, right.buyerAccountKey));
}
