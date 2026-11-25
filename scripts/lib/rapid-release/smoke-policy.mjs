// Trusted controller policy copied from the reviewed rapid-release source.
// Keep application authorization and existing main harness behavior unchanged.
export const BASELINE_NAVIGATION_CATEGORIES = Object.freeze([
  'timeout', 'interrupted', 'context_closed', 'redirect_limit', 'network_error', 'unclassified',
]);

export const READ_ONLY_CI_HANDLERS = Object.freeze([
  'authContext', 'portalApplicationsList', 'navigationPreferencesGet', 'workspacePreferencesGet',
  'workNotificationsList',
  'dashboardFilterOptions', 'dashboardSummary', 'dashboardStemList', 'dashboardAnalytics',
  'dashboardCounterpartySearch', 'dashboardAccountCreditDirectory', 'dashboardAccountExposureBatch',
  'dashboardAccountInsight', 'dashboardAccountCreditStatement', 'dashboardAiSettingsGet',
  'dashboardAccountInsightReportOptions', 'dashboardAccountInsightReportPresetsList',
  'salesforceStemDetail', 'salesforceStemDocuments',
  'marketPulseSnapshot', 'marketIntelligenceBrief', 'marketIntelligenceCurve',
  'marketIntelligenceValuation', 'marketIntelligenceAlertRulesGet', 'marketIntradayTimeline', 'marketReportCatalogue',
]);
const marketReadActions = new Set([
  'snapshot', 'market_history', 'intelligence_brief', 'intelligence_curve',
  'intelligence_valuation', 'intelligence_alert_rules_get',
]);

export function isReadOnlyMarketAction(body = {}) {
  return marketReadActions.has(String(body?.action || 'snapshot'));
}

export const CI_DENIAL_PROBES = Object.freeze([
  ['/api/functions/adminUserSave', {}],
  ['/api/functions/variableChargesBuyerConfirm', {}],
  ['/api/functions/hedgePhysicalSalesforceApply', {}],
  ['/api/functions/workspacePreferencesSave', {}],
  ['/api/functions/financeSettingsSave', {}],
  ['/api/functions/missingNomBList', {}],
  ['/api/functions/missingNomBUpload', {}],
  ['/api/functions/marketBookContext', {}],
  ['/api/functions/marketTraderWorkspace', {}],
  ['/api/functions/marketTraderWorkspaceSave', {}],
  ['/api/functions/hedgeMarkets', { action: 'save_spreads' }],
  ['/api/functions/dashboardAccountInsightExport', {}],
  ['/api/functions/salesforceDocumentDownload', {}],
  ['/api/work-notifications', {}],
].map(([path, body]) => Object.freeze({ path, body: Object.freeze(body) })));

// Closed vocabulary for failure evidence persisted outside the browser process.
export const SMOKE_BROWSER_DIAGNOSTIC_KINDS = Object.freeze(['gate_denial', 'runtime_error', 'websocket', 'cdp_failure', 'unknown']);
export const SMOKE_BROWSER_DIAGNOSTIC_ROLES = Object.freeze(['restricted', 'normal']);
export const SMOKE_BROWSER_DIAGNOSTIC_PHASES = Object.freeze(['setup', 'issuer_navigation', 'sign_in', 'normal_module_reads', 'baseline', 'desktop', 'restricted_access']);
export function isSafeSmokeBrowserDiagnostic(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3 && Object.keys(value).every(key => ['kind', 'role', 'phase'].includes(key))
    && SMOKE_BROWSER_DIAGNOSTIC_KINDS.includes(value.kind)
    && SMOKE_BROWSER_DIAGNOSTIC_ROLES.includes(value.role)
    && SMOKE_BROWSER_DIAGNOSTIC_PHASES.includes(value.phase);
}
