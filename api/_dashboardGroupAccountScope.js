const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

function text(value) {
  return String(value ?? '').trim();
}

function idKey(value) {
  const normalized = text(value);
  return SALESFORCE_ID.test(normalized) ? normalized.slice(0, 15) : '';
}

function scopeError(message, status = 400, code = 'ACCOUNT_CREDIT_GROUP_SCOPE_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

export function normalizeRequestedGroupAccountIds(value, { max = 2_000 } = {}) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw scopeError('Selected GROUP Accounts must be an array.');
  if (value.length > max) throw scopeError('Selected GROUP Accounts exceed the supported scope.');
  const ids = [];
  const seen = new Set();
  for (const rawId of value) {
    const id = text(rawId);
    const key = idKey(id);
    if (!key) throw scopeError('A selected GROUP Account ID is invalid.');
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

export function resolveGroupAccountScope({ entityType = 'account', group = null, groupMembers = [], requestedAccountIds = null } = {}) {
  const members = (Array.isArray(groupMembers) ? groupMembers : []).filter((member) => idKey(member?.Id));
  const memberByKey = new Map(members.map((member) => [idKey(member.Id), member]));
  const selectable = entityType === 'group' && Boolean(group);
  const requested = normalizeRequestedGroupAccountIds(requestedAccountIds);
  let includedMembers = members;
  if (selectable && requested !== null) {
    const invalidIds = requested.filter((id) => !memberByKey.has(idKey(id)));
    if (invalidIds.length) {
      throw scopeError('One or more selected Accounts are not active members of this Salesforce GROUP.', 409);
    }
    const includedKeys = new Set(requested.map(idKey));
    includedMembers = members.filter((member) => includedKeys.has(idKey(member.Id)));
  }
  const includedKeys = new Set(includedMembers.map((member) => idKey(member.Id)));
  const availableAccounts = members
    .map((member) => ({
      accountId: member.Id,
      name: member.Name || 'Unavailable Account',
      clKey: member.Company_Code__c || null,
      isGroupRoot: idKey(member.Id) === idKey(group?.Id),
      included: includedKeys.has(idKey(member.Id)),
    }))
    .sort((left, right) => Number(right.isGroupRoot) - Number(left.isGroupRoot) || left.name.localeCompare(right.name) || left.accountId.localeCompare(right.accountId));
  return {
    selectable,
    availableAccounts,
    includedMembers,
    includedAccountIds: includedMembers.map((member) => member.Id),
    allSelected: includedMembers.length === members.length,
    partial: selectable && includedMembers.length !== members.length,
  };
}

export const dashboardGroupAccountScopeInternals = { idKey };
