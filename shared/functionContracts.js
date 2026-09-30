import { stemReadRequestIssues } from './salesforceReadRequest.js';

export const FUNCTION_CONTRACT_VERSION = 1;

const objectPayload = (payload) => payload != null && typeof payload === 'object' && !Array.isArray(payload);
const stringValue = (value) => typeof value === 'string' && value.trim().length > 0;
const stringArray = (value) => Array.isArray(value) && value.length > 0 && value.every(stringValue);

const CONTRACTS = Object.freeze({
  xeroPortalReceiptUploadPrepare(payload) {
    const issues = [];
    if (!objectPayload(payload.fields)) issues.push('Receipt fields are required.');
    const file = payload.file;
    if (!objectPayload(file) || !stringValue(file.fileName)
      || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.fileType)
      || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 10 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) issues.push('A JPEG, PNG, WebP, or PDF receipt up to 10 MiB with its file hash is required.');
    if (payload.autoSync != null && typeof payload.autoSync !== 'boolean') issues.push('autoSync must be a boolean.');
    if (file && ['base64', 'data', 'content'].some((key) => file[key] != null)) issues.push('Upload receipt bytes directly to private storage.');
    return issues;
  },
  xeroPortalReceiptCreate(payload) {
    const issues = [];
    if (!stringValue(payload.uploadTicket) || payload.uploadTicket.length > 4096) issues.push('Prepare a direct receipt upload first.');
    if (!objectPayload(payload.fields)) issues.push('Receipt fields are required.');
    if (Object.keys(payload).some((key) => !['uploadTicket', 'fields'].includes(key))) issues.push('Only the signed upload ticket and its original receipt fields may be submitted.');
    return issues;
  },
  adminPermissionGroupSave(payload) {
    const issues = [];
    if (!stringValue(payload.label) || payload.label.trim().length > 100) issues.push('Enter a group name up to 100 characters.');
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) issues.push('A current group revision is required.');
    if (!objectPayload(payload.permissions) || !objectPayload(payload.capabilities)) issues.push('Permissions and capabilities must be objects.');
    return issues;
  },
  adminPermissionGroupDelete(payload) {
    return stringValue(payload.id) && Number.isSafeInteger(payload.expectedRevision) && payload.expectedRevision > 0 ? [] : ['A group and current revision are required.'];
  },
  adminUserGroupsSave(payload) {
    const issues = [];
    if (!stringValue(payload.userId)) issues.push('A person is required.');
    if (!Array.isArray(payload.groupIds) || payload.groupIds.length > 100 || payload.groupIds.some((id) => !stringValue(id))) issues.push('Select valid permission groups.');
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 1) issues.push('A current membership revision is required.');
    return issues;
  },
  financeSettingsSave(payload) {
    const issues = [];
    if (!['number', 'string'].includes(typeof payload.annualInterestRatePct)
      || !/^\d{1,3}(?:\.\d{1,2})?$/.test(String(payload.annualInterestRatePct).trim())
      || Number(payload.annualInterestRatePct) > 100) issues.push('Enter a rate from 0 to 100 with at most two decimal places.');
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 1) issues.push('A current settings revision is required.');
    return issues;
  },
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
  missingNomBList(payload) {
    const issues = [];
    if (payload.cursor != null && typeof payload.cursor !== 'string') issues.push('cursor must be a string');
    if (payload.search != null && typeof payload.search !== 'string') issues.push('search must be a string');
    return issues;
  },
  missingNomBUpload(payload) {
    return ['nominationId', 'operationId', 'filename', 'contentBase64'].filter((key) => !stringValue(payload[key])).map((key) => `${key} is required`);
  },
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
