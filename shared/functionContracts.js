import { stemReadRequestIssues } from './salesforceReadRequest.js';

export const FUNCTION_CONTRACT_VERSION = 1;

const objectPayload = (payload) => payload != null && typeof payload === 'object' && !Array.isArray(payload);
const stringValue = (value) => typeof value === 'string' && value.trim().length > 0;
const stringArray = (value) => Array.isArray(value) && value.length > 0 && value.every(stringValue);

const CONTRACTS = Object.freeze({
  marketTraderWorkspace(payload) {
    return payload.visitId == null || /^[a-zA-Z0-9_-]{8,80}$/.test(payload.visitId) ? [] : ['A valid visit identifier is required.'];
  },
  marketTraderWorkspaceSave(payload) {
    const issues = [];
    if (!['preferences', 'visit', 'acknowledge', 'snooze'].includes(payload.action)) issues.push('Choose a supported personal Markets action.');
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) issues.push('A workspace revision is required.');
    if (payload.action === 'preferences' && !objectPayload(payload.preferences)) issues.push('Market preferences are required.');
    if (payload.action === 'visit' && !/^[a-zA-Z0-9_-]{8,80}$/.test(payload.visitId || '')) issues.push('A valid visit identifier is required.');
    if (['acknowledge', 'snooze'].includes(payload.action) && (!stringValue(payload.subscriptionId) || !stringValue(payload.eventKey))) issues.push('The current alert identifier is required.');
    if (payload.action === 'snooze' && ![1, 8, 24].includes(payload.hours)) issues.push('Choose a supported snooze duration.');
    return issues;
  },
  workspaceSearch(payload) {
    return typeof payload.query === 'string' && payload.query.trim().length >= 2 && payload.query.length <= 80 ? [] : ['Enter between 2 and 80 characters.'];
  },
  stemWorkspaceActivity: stemReadRequestIssues,
  salesforceStemDetail: stemReadRequestIssues,
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
