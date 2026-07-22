import { createHash } from 'node:crypto';

const SALESFORCE_ACCOUNT_ID_RE = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value || '').trim();
}

function compareText(left, right) {
  return text(left).localeCompare(text(right), undefined, { sensitivity: 'base' });
}

export function normalizeAccountName(value) {
  return text(value).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function accountNameKey(value) {
  const normalized = normalizeAccountName(value);
  return normalized ? createHash('sha256').update(normalized).digest('hex') : '';
}

export function normalizeAccountManagerUserIds(values) {
  if (!Array.isArray(values)) throw new Error('Account manager assignments must be a list.');
  const ids = values.map(text);
  if (ids.length > 3) throw new Error('An Account can have at most three managers.');
  if (ids.some((id) => !UUID_RE.test(id))) throw new Error('Every manager must be a valid FCOS user.');
  if (new Set(ids).size !== ids.length) throw new Error('The same manager cannot be assigned more than once.');
  return ids;
}

export function accountRole(record = {}) {
  if (record.Inactive_Suspended__c !== false) return null;
  if (record.Is_Broker__c === true) return 'broker';
  if (text(record.Buyer_Payment_Term__c)) {
    return text(record.Supplier_Payment_Term__c) ? 'buyer_supplier' : 'buyer';
  }
  return null;
}

export function groupEligibleSalesforceAccounts(records = []) {
  const groups = new Map();

  for (const record of records) {
    const role = accountRole(record);
    const id = text(record.Id);
    const name = text(record.Name);
    const key = accountNameKey(name);
    if (!role || !SALESFORCE_ACCOUNT_ID_RE.test(id) || !key) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        accountNameKey: key,
        accountName: name,
        salesforceAccountIds: [],
        roles: [],
        records: [],
      });
    }

    const group = groups.get(key);
    if (!group.salesforceAccountIds.includes(id)) group.salesforceAccountIds.push(id);
    if (!group.roles.includes(role)) group.roles.push(role);
    group.records.push(record);
  }

  const roleOrder = new Map([['buyer', 1], ['buyer_supplier', 2], ['broker', 3]]);
  return [...groups.values()]
    .map((group) => ({
      ...group,
      salesforceAccountIds: group.salesforceAccountIds.slice().sort(compareText),
      roles: group.roles.slice().sort((left, right) => roleOrder.get(left) - roleOrder.get(right)),
    }))
    .sort((left, right) => compareText(left.accountName, right.accountName));
}

export function managerDisplayText(profiles = []) {
  return profiles
    .map((profile) => text(profile?.full_name || profile?.fullName || profile?.email))
    .filter(Boolean)
    .join(' / ');
}

export function buildAccountManagerRows({
  salesforceAccounts = [],
  managedGroups = [],
  assignments = [],
  profiles = [],
} = {}) {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const storedByKey = new Map(managedGroups.map((group) => [group.account_name_key, group]));
  const assignmentsByKey = new Map();

  for (const assignment of assignments) {
    if (!assignmentsByKey.has(assignment.account_name_key)) assignmentsByKey.set(assignment.account_name_key, []);
    assignmentsByKey.get(assignment.account_name_key).push(assignment);
  }

  return groupEligibleSalesforceAccounts(salesforceAccounts).map((group) => {
    const stored = storedByKey.get(group.accountNameKey) || {};
    const managers = (assignmentsByKey.get(group.accountNameKey) || [])
      .slice()
      .sort((left, right) => Number(left.assignment_order || 0) - Number(right.assignment_order || 0))
      .map((assignment) => {
        const profile = profilesById.get(assignment.manager_user_id);
        return {
          id: assignment.manager_user_id,
          fullName: profile?.full_name || profile?.email || 'Unknown user',
          email: profile?.email || '',
          userType: profile?.user_type || '',
          active: profile?.active === true,
        };
      });
    const expectedManagerText = managerDisplayText(managers);
    const salesforceValues = new Set(group.records.map((record) => text(record.Account_Manager__c)));
    const salesforceMatches = salesforceValues.size === 1 && salesforceValues.has(expectedManagerText);
    const storedStatus = text(stored.salesforce_sync_status);
    const salesforceSyncStatus = storedStatus === 'pending' || storedStatus === 'failed'
      ? storedStatus
      : salesforceMatches ? 'synced' : 'drift';

    return {
      accountNameKey: group.accountNameKey,
      accountName: group.accountName,
      roles: group.roles,
      salesforceAccountCount: group.salesforceAccountIds.length,
      managers,
      managerCount: managers.length,
      revision: Number(stored.revision || 0),
      updatedAt: stored.updated_at || null,
      updatedByEmail: stored.updated_by_email || null,
      salesforceSyncStatus,
      salesforceSyncError: stored.salesforce_sync_error || null,
      salesforceSyncedAt: stored.salesforce_synced_at || null,
      salesforceActive: true,
      // Compatibility aliases for previously cached FCOS clients.
      buyerAccountKey: group.accountNameKey,
      buyerAccountId: group.salesforceAccountIds[0],
      buyerName: group.accountName,
      traders: managers,
      traderCount: managers.length,
    };
  });
}

export const LEGACY_ACCOUNT_MANAGER_MAP = Object.freeze({
  KZ: 'Kelvin Zeng',
  VL: 'Vincent Lee',
  SC: 'Stanley Chui',
  OL: 'Otto Lai',
  SY: 'Vincent Lee',
});

export function expandLegacyAccountManager(value, mapping = LEGACY_ACCOUNT_MANAGER_MAP) {
  const codes = text(value).split('/').map(text).filter(Boolean);
  const names = [];
  for (const code of codes) {
    const name = text(mapping[code]);
    if (!name) throw new Error(`Unknown legacy Account Manager code: ${code}`);
    if (!names.includes(name)) names.push(name);
  }
  return names.join(' / ');
}
