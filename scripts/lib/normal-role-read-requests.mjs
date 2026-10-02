import { PREVIEW_EMAIL_SIGNER_BODY } from './preview-email-signer.mjs';

// Harness authority is independent of application dispatch metadata. Only the
// reviewed reads needed by module verification and its navigation may pass.
// New handlers fail closed until this protected harness is reviewed again.
const READ_HANDLERS = new Set([
  'authContext', 'portalApplicationsList', 'navigationPreferencesGet',
  'workspacePreferencesGet', 'collaborationNotificationsList', 'workNotificationsList',
  'workCommitmentsList', 'improvementsList', 'adminFcosUpdatesList',
  'dashboardStemList', 'dashboardSummary', 'dashboardAnalytics', 'dashboardFilterOptions',
  'dashboardCounterpartySearch', 'dashboardAccountExposureBatch', 'dashboardAccountCreditDirectory',
  'dashboardAccountCreditStatement', 'salesforceDashboardFiltered', 'salesforceStemDetail',
  'marketPulseSnapshot', 'marketIntelligenceBrief', 'marketIntelligenceCurve',
  'marketIntelligenceValuation', 'marketReportCatalogue', 'marketIntelligenceAlertRulesGet',
  'marketTraderWorkspace', 'marketBookContext', 'marketIntradayTimeline',
  'exceptionReviewWorkflowList', 'salesforceDisputeStems', 'disputeWorkflowList',
  'disputeWorkflowDocuments', 'disputeWorkflowCompensationClaims',
  'buyerInvoiceCollectionList', 'buyerInvoiceEmailSettingsGet', 'buyerInvoiceReminderRulesList',
  'unofficialCompensationList', 'unofficialCompensationOptions', 'incomingPaymentsList',
  'incomingPaymentSettingsGet', 'incomingPaymentEmailSettingsGet', 'incomingPaymentInterestSettingsGet',
  'cashflowForecast', 'cashflowBuyerPaymentPerformance', 'cashflowSettingsGet', 'cashflowHolidayCalendar',
  'salesforceBrokerRegister', 'brokerCommissionSettingsGet', 'frankfurterUsdCnyRate',
  'masterContractsList', 'masterContractOptions', 'specialTermsSummaryList', 'specialTermsOptions',
  'hedgeDeskSalesforceMapping', 'hedgeDeskAssistantSettings',
  'emailRouterList', 'emailRouterDirectory', 'emailRouterLeave', 'emailRouterPresets',
  'emailRouterSettings', 'emailRouterHealth', 'financeSettingsGet',
]);
const READ_ACTIONS = new Set(['list', 'filter', 'get', 'snapshot']);
const HEDGE_READ_ENTITIES = new Set([
  'PhysicalTrade', 'SwapHedge', 'MopsPrice', 'ClearingAccount', 'Invoice', 'Counterparty', 'AppConfig',
]);
const ACTION_KEYS = new Set([
  'action', 'actionname', 'actiontype', 'operation', 'operationname', 'operationtype',
  'command', 'commandname', 'commandtype', 'op', 'verb', 'method', 'intent', 'mode', 'requestaction',
]);
const UNSAFE_KEYS = new Set(['proto', 'prototype', 'constructor']);
// These execution controls are forbidden even when false, nested, or prefixed
// with force/auto/allow. Normalizing separators closes spelling aliases without
// treating a filter's string value (for example status="Processing") as authority.
const MUTATION_KEYS = /(?:create|update|delete|save|submit|approve|apply|sync|send|upload|execute|cancel|promote|write|mutation|refresh|reconcil|retry|resume|recover|finaliz|publish|process|rebuild|repair|reset|import|dispatch|trigger|invalidate|rerun|persist|rotate|provision)/i;
// These exact existing data filters contain verbs but are not execution flags.
// Admit text/null values only; aliases or control-shaped objects still deny.
const TEXT_FILTER_KEYS = new Set([
  'created_date', 'updated_date', 'created_at', 'updated_at', 'created_by', 'created_by_id', 'updated_by_id',
  'sender', 'senderEmail', 'senderAddress',
]);
const normalizeKey = key => key.replace(/[^a-z0-9]/gi, '').toLowerCase();
const plainObject = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function readBody(value, depth = 0) {
  if (depth > 8 || value === undefined || typeof value === 'function') return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => readBody(item, depth + 1));
  if (!plainObject(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    const normalized = normalizeKey(key);
    const textFilter = TEXT_FILTER_KEYS.has(key) && (item === null || typeof item === 'string'
      || Array.isArray(item) && item.every(entry => entry === null || typeof entry === 'string'));
    return !UNSAFE_KEYS.has(normalized) && (textFilter || !MUTATION_KEYS.test(normalized))
      && (!ACTION_KEYS.has(normalized) || READ_ACTIONS.has(item)) && readBody(item, depth + 1);
  });
}

function hedgeReadRequest(body) {
  const action = body.action === undefined ? 'list' : body.action;
  if (!READ_ACTIONS.has(action)) return false;
  if (action === 'snapshot') return Object.keys(body).every(key => key === 'action');
  if (!HEDGE_READ_ENTITIES.has(body.entity)) return false;
  const allowed = action === 'get' ? ['action', 'entity', 'id']
    : action === 'filter' ? ['action', 'entity', 'params', 'sort', 'limit'] : ['action', 'entity', 'sort', 'limit'];
  if (Object.keys(body).some(key => !allowed.includes(key))) return false;
  if (action === 'get') return typeof body.id === 'string' && body.id.trim() === body.id
    && body.id.length > 0 && body.id.length <= 128;
  if (body.sort !== undefined && (typeof body.sort !== 'string' || !/^-?[A-Za-z][A-Za-z0-9_]*$/.test(body.sort))) return false;
  if (body.limit !== undefined && (!Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 10000)) return false;
  if (body.params !== undefined && (!plainObject(body.params) || Object.entries(body.params).some(([key, value]) =>
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['table', 'tablename', 'entity', 'entityname'].includes(normalizeKey(key))
      || (Array.isArray(value) ? value.some(item => item !== null && typeof item === 'object') : value !== null && typeof value === 'object')))) return false;
  return true;
}

export function normalRoleReadRequest(name, body = {}) {
  if (!plainObject(body) || !readBody(body)) return false;
  if (name === 'emailRouterAttachmentUrl') return Object.keys(body).length === 2
    && Object.entries(PREVIEW_EMAIL_SIGNER_BODY).every(([key, value]) => body[key] === value);
  if (name === 'hedgeDeskEntity') return hedgeReadRequest(body);
  if (name === 'hedgeMarkets') return body.action === 'snapshot' && Object.keys(body).every(key => key === 'action');
  return READ_HANDLERS.has(name);
}
