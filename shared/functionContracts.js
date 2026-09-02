export const FUNCTION_CONTRACT_VERSION = 1;

const objectPayload = (payload) => payload != null && typeof payload === 'object' && !Array.isArray(payload);
const stringValue = (value) => typeof value === 'string' && value.trim().length > 0;
const stringArray = (value) => Array.isArray(value) && value.length > 0 && value.every(stringValue);

const CONTRACTS = Object.freeze({
  dashboardAccountCreditStatement(payload) {
    const issues = [];
    if (!['buyer', 'supplier', 'both'].includes(payload.side || 'buyer')) issues.push('side must be buyer, supplier, or both');
    if (payload.entityType != null && !['account', 'group'].includes(payload.entityType)) issues.push('entityType must be account or group');
    if (!stringValue(payload.accountId || payload.entityId)) issues.push('accountId or entityId is required');
    return issues;
  },
  dashboardCounterpartySearch(payload) {
    const issues = [];
    if (!stringValue(payload.query)) issues.push('query is required');
    if (payload.limit != null && (!Number.isInteger(Number(payload.limit)) || Number(payload.limit) < 1 || Number(payload.limit) > 100)) issues.push('limit must be an integer from 1 to 100');
    return issues;
  },
  systemErrorVerify(payload) {
    return stringValue(payload.incidentSignature || payload.incident_signature) ? [] : ['incidentSignature is required'];
  },
  workNotificationsRead(payload) {
    if (payload.notificationIds == null) return [];
    return stringArray(payload.notificationIds) ? [] : ['notificationIds must be a non-empty array of identifiers'];
  },
  workNotificationsState(payload) {
    const issues = [];
    if (!stringArray(payload.notificationIds)) issues.push('notificationIds must be a non-empty array of identifiers');
    if (!['handled', 'snoozed', 'unhandled'].includes(payload.state)) issues.push('state must be handled, snoozed, or unhandled');
    return issues;
  },
});

export function validateFunctionRequest(name, payload) {
  if (!objectPayload(payload)) return { ok: false, registered: Boolean(CONTRACTS[name]), issues: ['payload must be an object'] };
  const validate = CONTRACTS[name];
  if (!validate) return { ok: true, registered: false, issues: [] };
  const issues = validate(payload);
  return { ok: issues.length === 0, registered: true, issues };
}

export function functionContractNames() {
  return Object.keys(CONTRACTS);
}
