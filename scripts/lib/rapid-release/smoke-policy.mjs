// Trusted controller policy copied from the reviewed rapid-release source.
// Keep application authorization and existing main harness behavior unchanged.
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
