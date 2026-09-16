const READS = new Set(['dashboardSummary', 'dashboardAnalytics', 'dashboardStemList', 'disputeWorkflowList',
  'workNotificationsList', 'specialTermsWorkspace', 'hedgeDeskSalesforceMapping', 'hedgeMarkets',
  'salesforceQuery', 'xeroPortalContactLifecyclePreview', 'workspaceSearch']);

export function systemIncidentPresentation(handler) {
  if (READS.has(handler)) return { severity: 'warning', outcome: 'Refresh failed; no business change was requested', actionLabel: 'Open the workspace and refresh' };
  if (handler === 'marketReportDriveSyncCron') return { severity: 'warning', outcome: 'Latest source check unavailable; existing verified observations retained', actionLabel: 'Review Markets data notes and System Health' };
  return { severity: 'critical', outcome: 'Completion not confirmed', actionLabel: 'Review source records and activity before retrying' };
}
