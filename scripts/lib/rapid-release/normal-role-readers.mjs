// Trusted read contracts reviewed against the maintained normal-role harness and
// API implementations. A module ID alone never grants a network request.
// Responses stay in memory; receipts contain only route, scope and row count.
const reader = (handler, fields, coverage = 'module_data_read', body = {}) => Object.freeze({
  path: `/api/functions/${handler}`, fields: Object.freeze(fields), coverage, body: Object.freeze(body),
});
const incomingPaymentSignAdvisory = 'Supplier-invoice-linked negative payments are classified as supplier refunds. Confirm if Salesforce uses the opposite sign.';
const stagedRefreshDenial = 'This verification environment permits read-only operations.';
export const MODULE_READERS = Object.freeze({
  dashboard: Object.freeze({ ...reader('dashboardSummary', []), route: '/', heading: 'Dashboard' }),
  markets: Object.freeze({ ...reader('marketPulseSnapshot', []), route: '/markets', heading: 'Markets' }),
  review: reader('salesforceDashboardFiltered', ['recentStems']),
  disputes: reader('disputeWorkflowList', ['rows']),
  buyer_invoices: reader('salesforceBuyerInvoicesDue', ['rows'], 'due_invoice_read', { daysAhead: 30 }),
  unofficial_compensation: reader('unofficialCompensationList', ['accounts']),
  incoming_payments: reader('incomingPaymentsList', ['rows', 'payments']),
  cashflow_forecast: reader('cashflowForecast', ['rows']),
  pnl: reader('stemPnl', ['rows']),
  hedge_desk: reader('hedgeDeskEntity', ['physicals'], 'book_snapshot_read', { action: 'snapshot' }),
  brokers: reader('salesforceBrokerRegister', ['rows']),
  buyers_administrator: reader('accountManagersList', ['accounts', 'buyers']),
  master_contracts: reader('masterContractsList', ['contracts']),
  special_terms: reader('specialTermsSummaryList', ['terms', 'items', 'rows'], 'module_data_read', { limit: 25 }),
  email_router: reader('emailRouterSettings', [], 'mailbox_configuration_read'),
  settings: reader('financeSettingsGet', [], 'finance_configuration_read'),
  admin: reader('adminUsersList', ['users'], 'access_model_read'),
  xero_portal: reader('xeroPortalStatus', [], 'connector_state_read'),
});

export function moduleReadBody(module, manifest) {
  const source = MODULE_READERS[module];
  if (!source) throw Object.assign(new Error('MODULE_SAFE_READER_COVERAGE_MISSING'), { code: 'MODULE_SAFE_READER_COVERAGE_MISSING' });
  const end = new Date(manifest.createdAt || Date.now());
  if (!Number.isFinite(end.getTime())) throw Object.assign(new Error('SMOKE_READ_SCOPE_INVALID'), { code: 'SMOKE_READ_SCOPE_INVALID' });
  const date = end.toISOString().slice(0, 10), start = new Date(end.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  if (module === 'review') return { mode: 'exception_review', trendYear: end.getUTCFullYear(), dateBasis: 'exception_schedule', dateWindows: [{ startDate: start, endDate: date }] };
  if (module === 'pnl') return { dateWindows: [{ startDate: start, endDate: date }], limit: 1 };
  if (module === 'incoming_payments') return { dateFrom: date, dateTo: date, limit: 100 };
  if (module === 'cashflow_forecast') return { dateFrom: date, dateTo: date, bucket: 'daily' };
  return { ...source.body };
}

export function moduleReaderPayloadVerified(module, payload) {
  const data = payload?.data ?? payload;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.error || data.cancelled
    || data.status === 'unavailable' || data.available === false || data.complete === false
    || (Array.isArray(data.unavailableSources) && data.unavailableSources.length > 0)
    || (Array.isArray(data.schemaWarnings) && data.schemaWarnings.some(warning =>
      module !== 'incoming_payments' || warning !== incomingPaymentSignAdvisory))) return false;
  if (module === 'dashboard') return data.complete === true && Array.isArray(data.financials);
  if (module === 'markets') return data.complete === true && data.reportCompleteness?.complete === true
    && /^\d{4}-\d{2}-\d{2}$/.test(data.asOfDate || '') && Array.isArray(data.products) && data.products.length === 3
    && ['hsfo380', 'vlsfo', 'lsmgo'].every(key => data.products.some(product => product.productKey === key
      && typeof product.latestMops?.value === 'number' && Number.isFinite(product.latestMops.value)));
  if (module === 'buyer_invoices') return Array.isArray(data.rows) && /^\d{4}-\d{2}-\d{2}$/.test(data.today || '')
    && /^\d{4}-\d{2}-\d{2}$/.test(data.dueThrough || '') && Number.isFinite(data.daysAhead);
  if (module === 'settings') return Number.isSafeInteger(data.settings?.revision) && data.settings.revision > 0
    && Number.isFinite(data.settings.annualInterestRatePct) && ['UBS', 'DBS'].every(bank => Number.isFinite(data.settings.bankChargesUsd?.[bank]));
  if (module === 'email_router') return typeof data.mailbox?.id === 'string' && Array.isArray(data.destinations) && Array.isArray(data.groups);
  if (module === 'xero_portal') {
    const gates = Object.values(data.externalActions || {});
    return typeof data.xero?.configured === 'boolean' && typeof data.xero.connected === 'boolean'
      && gates.length > 0 && gates.every(gate => gate?.enabled === false)
      && (!data.xero.refreshError || (data.xero.refreshError === stagedRefreshDenial
        && gates.every(gate => gate.control === 'deployment_read_only')));
  }
  if (module === 'hedge_desk') return ['physicals', 'swaps', 'mops', 'clearing', 'counterparties', 'invoices', 'auditLogs'].every(key => Array.isArray(data[key]))
    && data.capabilities && typeof data.capabilities === 'object' && data.expiryAutomation?.readOnly === true;
  if (module === 'pnl') return Array.isArray(data.rows) && Number.isSafeInteger(data.totals?.count) && data.totals.count === data.rows.length;
  if (module === 'buyers_administrator') return Array.isArray(data.accounts) && Array.isArray(data.users);
  if (module === 'admin') return Array.isArray(data.users) && Array.isArray(data.modules) && data.modules.length > 0
    && Array.isArray(data.userTypes) && data.userTypes.length > 0 && data.typePermissions && typeof data.typePermissions === 'object';
  return MODULE_READERS[module]?.fields.some(field => Array.isArray(data[field])) === true;
}

// Existing desktop navigation reads from the maintained protected normal-role
// harness. Mixed operations and all unknown handler names remain closed.
export const NORMAL_NAVIGATION_READS = Object.freeze([
  'collaborationNotificationsList', 'workCommitmentsList', 'improvementsList', 'adminFcosUpdatesList',
  'salesforceDashboardFiltered', 'exceptionReviewWorkflowList', 'salesforceDisputeStems', 'disputeWorkflowDocuments', 'disputeWorkflowCompensationClaims',
  'buyerInvoiceCollectionList', 'buyerInvoiceEmailSettingsGet', 'buyerInvoiceReminderRulesList', 'unofficialCompensationOptions',
  'incomingPaymentSettingsGet', 'incomingPaymentEmailSettingsGet', 'incomingPaymentInterestSettingsGet',
  'cashflowBuyerPaymentPerformance', 'cashflowSettingsGet', 'cashflowHolidayCalendar',
  'brokerCommissionSettingsGet', 'frankfurterUsdCnyRate', 'masterContractOptions', 'specialTermsOptions',
  'hedgeDeskSalesforceMapping', 'hedgeDeskAssistantSettings',
  'emailRouterList', 'emailRouterDirectory', 'emailRouterLeave', 'emailRouterPresets', 'emailRouterHealth',
  'xeroPortalReceiptsList', 'xeroPortalContactLifecycleLatest', 'xeroPortalContactAutoCreateLatest',
]);
export const MODULE_SURFACES = Object.freeze({
  review: { route: '/review', heading: /Exception Review/i },
  disputes: { route: '/disputes', heading: /Dispute Workflow/i },
  buyer_invoices: { route: '/payment-collections?tab=collections', heading: /Payment Collections/i },
  unofficial_compensation: { route: '/unofficial-compensation', heading: /Unofficial Compensation|Agreed Compensation/i },
  incoming_payments: { route: '/payment-collections?tab=incoming', heading: /^Incoming Payments$/i },
  cashflow_forecast: { route: '/cashflow-forecast', heading: /Cashflow/i },
  pnl: { route: '/pnl', heading: /^(?:Dashboard and )?Qlik Validator(?: Tool)?$/i, readControl: 'Run' },
  brokers: { route: '/brokers', heading: /Broker/i },
  buyers_administrator: { route: '/account-managers', heading: /Account Managers/i },
  master_contracts: { route: '/master-contracts', heading: /Master Contracts/i },
  special_terms: { route: '/special-terms', heading: /Special Terms/i },
  hedge_desk: { route: '/hedge-desk', heading: /Hedge Desk|Position control/i },
  email_router: { route: '/email-router', heading: /Email Router/i },
  settings: { route: '/settings?section=finance', heading: /^(?:Finance|Finance settings|Settings)$/i },
  admin: { route: '/settings?section=people', heading: /People|Settings/i },
  xero_portal: { route: '/xero-portal', heading: /Xero Portal|Salesforce–Xero integrity/i },
});
