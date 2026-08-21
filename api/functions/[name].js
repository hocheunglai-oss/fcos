import { chunkIds, cleanRecord, getApiVersion, getInstanceUrl, salesforceAuthMode, salesforceConfiguredAuthModes, sendJson, sfCompositeQueries, sfDownload, sfQuery, sfRequest } from '../_salesforce.js';
import { disputeWorkflowDirectionLabel, disputeWorkflowEditableFilename, disputeWorkflowFileExtension, disputeWorkflowHongKongDateToken } from '../_disputeDocuments.js';
import { buildDisputePartyRegistry, disputeSalesforceIdKey, findDisputeParty, resolveExtraCostSupplierLookup, resolveOriginalSupplierLookup } from '../_disputeParties.js';
import { disputeQueueExtraCostProductName } from '../_disputeQueue.js';
import { calculatedBuyerPayTermDate } from '../_buyerInvoiceDates.js';
import { buyerInvoiceEmailSettingsPatch, canonicalizeBuyerInvoiceEmail } from '../../src/lib/buyerInvoiceEmailSettings.js';
import { earliestEtaDate, summarizeBuyerPaymentEvidence } from '../../src/lib/paymentCollectionEvidence.js';
import { PAYMENT_POSTING_ISSUE_STATES, reconcileBuyerPaymentPosting } from '../../src/lib/paymentPostingReconciliation.js';
import { grossMarginPercent } from '../_dashboardMetrics.js';
import { buildDashboardDateScopeWhere } from '../_dashboardDateScope.js';
import { dashboardLineItemVolume, dashboardVolumeLabel, findDashboardUomField } from '../_dashboardVolume.js';
import { dashboardCurrency, dashboardCurrentYearDateWindows, dashboardMonthlyComparison, dashboardMonthlyFinancialTrend, dashboardMonthlyYearOverYear, dashboardSupplierProductRows, decodeDashboardCursor, decisionDashboardCompleteness, decisionDashboardSummary, decisionDashboardSupplierAmount, encodeDashboardCursor, normalizeDecisionDashboardFilters, priorEquivalentDateWindows, yearOverYearDateWindows } from '../_decisionDashboard.js';
import { dashboardAccountRankings } from '../../src/lib/dashboardAccountRankings.js';
import { loadDashboardAccountInsight } from '../_dashboardAccountInsightService.js';
import { generateDashboardAccountInsightExport } from '../_dashboardAccountInsightExport.js';
import { loadDashboardAccountCreditDirectory, loadDashboardAccountCreditStatement } from '../_dashboardAccountCreditStatementService.js';
import {
  buildBuyerPaymentDelayModels,
  normalizeBuyerPaymentConservativeness,
  selectBuyerPaymentDelayModel,
} from '../_buyerPaymentPerformance.js';
import { loadDashboardAccountExposureBatch, loadDashboardCounterpartySearch, resolveUnifiedCounterpartyMemberIds } from '../_dashboardUnifiedCounterpartyService.js';
import { generateSpecialTermsDocument } from '../_specialTermsExport.js';
import { groupPaymentReminderRows } from '../_paymentReminderRouting.js';
import { applyBuyerReminderRules, buyerReminderAccountType, buyerReminderCandidateByAccount, buyerReminderRuleMap, canonicalSalesforceAccountId, evaluateBuyerReminderSelection } from '../_buyerInvoiceReminderRules.js';
import {
  completePaymentReminderBatch,
  completePaymentReminderOperation,
  mapPaymentReminderBatches,
  paymentReminderBatchHash,
  paymentReminderDeliveryUncertain,
  paymentReminderPreviewSecret,
  paymentReminderRequestHash,
  repairPaymentReminderTimelines,
  reservePaymentReminderBatch,
  reservePaymentReminderOperation,
  savePaymentReminderTimeline,
  signPaymentReminderPreview,
  verifyPaymentReminderPreview,
} from '../_paymentReminderOperations.js';
import { accountNameKey, buildAccountManagerRows, groupEligibleSalesforceAccounts, managerDisplayText, normalizeAccountManagerUserIds } from '../_accountManagers.js';
import {
  ACCOUNT_PIC_MAX_CSV_BYTES,
  accountPicDirectoryProjection,
  accountPicFlexibleDirectoryProjection,
  accountPicFlexiblePayloadHash,
  accountPicPayloadHash,
  accountPicRowColorPayloadHash,
  normalizeAccountPicGrid,
  normalizeAccountPicRows,
  parseAccountPicCsv,
  validAccountPicAccountId,
} from '../_accountPicDirectories.js';
import { normalizeAccountPicRowColorRules } from '../../src/lib/accountPicRowColors.js';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { createHash } from 'node:crypto';
import { externalActionGates, isExternalActionEnabled, requireExternalActionGate } from '../_externalActionGates.js';
import { authenticatedBackboneBridgePayload, backboneBridgeConfig, backboneBridgeRequest, browserSafeBackboneFinanceHandoff, browserSafeBackboneTradeProjection } from '../_backboneBridge.js';
import { EXCEPTION_REVIEW_DATE_BASIS, EXCEPTION_SCHEDULE_FIELDS, buildExceptionReviewScheduleWhere, exceptionScheduleSchemaIssues, normalizeExceptionSchedule } from '../../src/lib/exceptionReviewSchedule.js';
import { DISPUTE_BUYER_CLOSE_REASONS as DISPUTE_BETA_BUYER_CLOSE_REASONS, DISPUTE_SUPPLIER_CLOSE_REASONS as DISPUTE_BETA_SUPPLIER_CLOSE_REASONS } from '../../src/lib/disputeWorkflowOptions.js';
import { disputeNotRequiredEligibility } from '../_disputeAccounting.js';
import { hasRecordedFcosClosureWriteback, isSalesforceDisputeClosed, projectExternalDisputeClosure } from '../_disputeWorkflowStatus.js';
import { allocateSupplierDispute, normalizeSupplierInvoiceExposure, resolveSupplierSettlementSchema, supplierInstructionRows, validSupplierSettlementPayment } from '../_disputeSupplierSettlement.js';
import { currentRequestTelemetry, logRequestTelemetry, recordRequestFailure, recordSupabaseRequest, requestIdFrom, runWithRequestTelemetry, salesforceLimitFromBody, telemetryResponseHeaders } from '../_requestTelemetry.js';
import { parseSupabasePrometheusMetrics } from '../_supabaseMetrics.js';
import { serverSupabaseConfig } from '../_supabaseConfig.js';
import { CONNECTION_INTEGRATIONS, connectionAttestationState, sanitizeConnectionAttestation } from '../../src/lib/connectionChecklist.js';
import { expireRuntimeCacheTags, getOrLoadRuntimeCache } from '../_runtimeCache.js';
import { checkPortalApplicationsHealth, launchPortalApplication, listPortalApplicationsForUser, portalAdminModel, preparePortalUserDeletion, processPortalOutbox, reconcilePortalEntitlementsForProfile, retryPortalAccessSync, revokePortalSessions, savePortalExplicitAccess, syncPortalEntitlement } from '../_portal.js';
import {
  collaborationArchive as collaborationArchiveService,
  collaborationAttachmentComplete as collaborationAttachmentCompleteService,
  collaborationAttachmentDelete as collaborationAttachmentDeleteService,
  collaborationAttachmentPrepare as collaborationAttachmentPrepareService,
  collaborationAttachmentUrl as collaborationAttachmentUrlService,
  collaborationCommentDelete as collaborationCommentDeleteService,
  collaborationCommentSave as collaborationCommentSaveService,
  collaborationCreate as collaborationCreateService,
  collaborationBulkUpdate as collaborationBulkUpdateService,
  collaborationDependencyRemove as collaborationDependencyRemoveService,
  collaborationDependencySave as collaborationDependencySaveService,
  collaborationDailyMaintenance,
  collaborationDetail as collaborationDetailService,
  collaborationFollowerToggle as collaborationFollowerToggleService,
  collaborationList as collaborationListService,
  collaborationMilestoneSave as collaborationMilestoneSaveService,
  collaborationNotificationsList as collaborationNotificationsListService,
  collaborationNotificationsRead as collaborationNotificationsReadService,
  collaborationTemplateList as collaborationTemplateListService,
  collaborationTemplateSave as collaborationTemplateSaveService,
  collaborationUpdate as collaborationUpdateService,
} from '../_collaborationService.js';
import { DASHBOARD_AI_MODELS, DEFAULT_DASHBOARD_AI_MODEL, compileDashboardAiWhere, dashboardAiModel, interpretDashboardAiSearch, isAllowedDashboardAiModel, normalizeDashboardAiPrompt } from '../_dashboardAi.js';
import { operationalMailConfig, operationalMailDeliveryAvailable, sendOperationalMail } from '../_operationalMail.js';
import { loadFinancialReportSettings, saveFinancialReportSettings } from '../_financialReportSettings.js';
import {
  loadPaymentCollectionThresholds,
  paymentCollectionBalanceIsSettled,
  paymentCollectionThresholdCacheKey,
  paymentCollectionThresholdPolicy,
  savePaymentCollectionThreshold,
  savePaymentCollectionThresholds,
} from '../_paymentCollectionThresholds.js';
import { emailSenderStatus as configuredEmailSenderStatus } from '../_emailSenderStatus.js';
import {
  graphEmailApplicationConfig,
  listGraphEmailRegistry,
  resolveGraphEmailSender,
  saveGraphEmailMailbox,
  saveGraphEmailRoute,
  verifyGraphEmailApplication,
} from '../_graphEmail.js';
import { growthCalendarHealth } from '../_growthOutlook.js';
import { workNotificationsList as workNotificationsListService, workNotificationsRead as workNotificationsReadService, workNotificationsState as workNotificationsStateService } from '../_workNotifications.js';
import { reportSystemError, resolveRecoveredSystemErrorHandler, resolveSystemErrorIncident, shouldNotifySystemError, validSystemErrorSignature } from '../_systemErrorNotifications.js';
import { workCommitmentsList as workCommitmentsListService } from '../_workCommitments.js';
import {
  getShipAgentChargeDetail,
  getVariableChargeDetail,
  confirmVariableChargeBuyer,
  listShipAgentCharges,
  listVariableCharges,
  overrideShipAgentChargeAssignment,
  overrideVariableChargeAssignment,
  resolveShipAgentPostInvoiceChange,
  resolveVariableChargePostInvoiceChange,
  saveAndConfirmShipAgentCharges,
  shipAgentChargeOptions,
  variableChargeOptions,
  syncShipAgentCharges,
  syncVariableCharges,
  verifyVariableChargeSupplier,
} from '../_variableCharges.js';
import {
  improvementAttachmentComplete as improvementAttachmentCompleteService,
  improvementAttachmentDelete as improvementAttachmentDeleteService,
  improvementAttachmentPrepare as improvementAttachmentPrepareService,
  improvementAttachmentUrl as improvementAttachmentUrlService,
  improvementCreate as improvementCreateService,
  improvementDecision as improvementDecisionService,
  improvementDetail as improvementDetailService,
  improvementPropose as improvementProposeService,
  improvementsList as improvementsListService,
} from '../_fcosImprovements.js';
import {
  coachingActionPublish as coachingActionPublishService,
  coachingActionProposalRespond as coachingActionProposalRespondService,
  coachingActionSave as coachingActionSaveService,
  coachingCalendarResolve as coachingCalendarResolveService,
  coachingCalendarRetry as coachingCalendarRetryService,
  coachingRelationshipEnd as coachingRelationshipEndService,
  coachingRelationshipInvite as coachingRelationshipInviteService,
  coachingRelationshipRespond as coachingRelationshipRespondService,
  coachingSessionConfirm as coachingSessionConfirmService,
  coachingSessionCancel as coachingSessionCancelService,
  coachingSessionContentSave as coachingSessionContentSaveService,
  coachingSessionSave as coachingSessionSaveService,
  growthAttachmentComplete as growthAttachmentCompleteService,
  growthAttachmentPrepare as growthAttachmentPrepareService,
  growthAttachmentUrl as growthAttachmentUrlService,
  growthCoachingBootstrap as growthCoachingBootstrapService,
  growthCoachingDailyMaintenance,
  growthEmailPreferencesSave as growthEmailPreferencesSaveService,
  growthGoalCompletion as growthGoalCompletionService,
  growthGoalEvidenceOptions as growthGoalEvidenceOptionsService,
  growthGoalEvidenceSave as growthGoalEvidenceSaveService,
  growthGoalDecision as growthGoalDecisionService,
  growthGoalProgressSave as growthGoalProgressSaveService,
  growthGoalSave as growthGoalSaveService,
  growthGoalSubmit as growthGoalSubmitService,
  growthPlanSave as growthPlanSaveService,
  growthPlanCloseout as growthPlanCloseoutService,
  growthReportingLineSave as growthReportingLineSaveService,
  growthReportingLinesSaveBatch as growthReportingLinesSaveBatchService,
  growthReportingLinesList as growthReportingLinesListService,
} from '../_growthCoachingService.js';
import { cancelFcosUpdateBatch as cancelFcosUpdateBatchService, listFcosUpdates as listFcosUpdatesService, restoreFcosUpdateItem as restoreFcosUpdateItemService, retryFcosUpdateDeliveries as retryFcosUpdateDeliveriesService, saveFcosUpdateBatch as saveFcosUpdateBatchService, saveFcosUpdateItem as saveFcosUpdateItemService, sendFcosUpdateBatch as sendFcosUpdateBatchService, skipFcosUpdateItem as skipFcosUpdateItemService, syncFcosUpdateItems as syncFcosUpdateItemsService } from '../_fcosUpdates.js';
import {
  agreedCompensationClaimsForAccount,
  createUnofficialCompensationClaim as createUnofficialCompensationClaimService,
  createUnofficialCompensationRecovery as createUnofficialCompensationRecoveryService,
  deleteUnofficialCompensationRecovery as deleteUnofficialCompensationRecoveryService,
  linkDisputeAgreedCompensationClaim,
  listUnofficialCompensation,
  unofficialCompensationOptions as unofficialCompensationOptionsService,
  updateUnofficialCompensationClaimGroupStatus as updateUnofficialCompensationClaimGroupStatusService,
  validateAgreedCompensationClaimLink,
} from '../_unofficialCompensationService.js';
import { canManageUnofficialCompensationStatus } from '../_unofficialCompensation.js';
import { handleHedgeDeskEntity, handleHedgeMarkets } from '../_hedgeDeskService.js';
import { parseMopsText } from '../_hedgeMops.js';
import { generateHedgeInvoicePdf, saveHedgeInvoicePdf, sendHedgeInvoiceEmailIdempotent } from '../_hedgeDocuments.js';
import { approveAndSendHedgeSfsReport, getHedgeSfsFile, getHedgeSfsMonthReport, hedgeSfsHealth } from '../_hedgeSfsService.js';
import { hedgeAssistantSettings, runHedgeAssistant } from '../_hedgeAssistant.js';
import { getHedgeSalesforceMapping, previewHedgeSalesforce, pushHedgeSalesforce } from '../_hedgeSalesforce.js';
import { financialQuantityLabel, financialQuantityValue as financialQuantity, nativeFinancialQuantity } from '../_financialQuantity.js';
import { buildHandlerPolicyRegistry, handlerPolicyFor } from '../_handlerPolicyRegistry.js';
import { runHedgeMaintenance } from '../_hedgeMaintenance.js';
import { runMarketReportArchiveReplayBatch, runMarketReportDriveSync } from '../_marketDriveSync.js';
import {
  getMarketIntelligenceAlertRules,
  loadMarketIntelligenceBrief,
  loadMarketIntelligenceCurve,
  loadGovernedMarketValuation,
  saveMarketForwardFallback,
  saveMarketCurveShadowCutover,
  saveMarketIntelligenceAlertRules,
} from '../_marketIntelligenceTrading.js';
import { loadMarketPulseSnapshot } from '../_marketPulse.js';
import { deleteSpecialTerm, deleteSpecialTermRule, getSpecialTermDocumentForExport, listSpecialTermSummaries, listSpecialTerms, previewSpecialTermDeletion, resolveSpecialTermsSchema, saveSpecialTerm, saveSpecialTermRule, specialTermOptions } from '../_specialTerms.js';
import {
  approveSpecialTermClause,
  getSpecialTermDetail,
  getSpecialTermMigrationInventory,
  listSpecialTermClauseBank,
  listSpecialTermClauseSimilar,
  previewSpecialTermMigration,
  previewSpecialTermMigrationAll,
  retireSpecialTermClause,
  saveSpecialTermClauseDraft,
  saveAllSpecialTermMigrationReview,
  saveSpecialTermMigrationReview,
  saveSpecialTermRevision,
  commitSpecialTermRevision,
  approveSpecialTermRevision,
  rollbackSpecialTermRevision,
  listSpecialTermMigrationBatches,
  listSpecialTermApprovalQueue,
  draftSpecialTermClausesWithAi,
  listSpecialTermClauseConsolidations,
  startSpecialTermClauseConsolidation,
  relinkSpecialTermClauseConsolidation,
  cancelSpecialTermClauseConsolidation,
  completeSpecialTermClauseConsolidation,
  deleteSpecialTermClause,
  discardSpecialTermClauseDraft,
  previewSpecialTermClauseDeletion,
  getSpecialTermClauseEditPreview,
  publishSpecialTermClauseGlobally,
} from '../_specialTermClauses.js';
import {
  emailRouterActionHandler as nativeEmailRouterAction,
  emailRouterActionStatusHandler as nativeEmailRouterActionStatus,
  emailRouterAdvisorHandler as nativeEmailRouterAdvisor,
  emailRouterAttachmentTextHandler as nativeEmailRouterAttachmentText,
  emailRouterAttachmentUrlHandler as nativeEmailRouterAttachmentUrl,
  emailRouterBackgroundSyncHandler as nativeEmailRouterBackgroundSync,
  emailRouterDeltaHandler as nativeEmailRouterDelta,
  emailRouterDetailHandler as nativeEmailRouterDetail,
  emailRouterDirectoryHandler as nativeEmailRouterDirectory,
  emailRouterDirectoryRefreshHandler as nativeEmailRouterDirectoryRefresh,
  emailRouterListHandler as nativeEmailRouterList,
  emailRouterLeaveHandler as nativeEmailRouterLeave,
  emailRouterLeaveSaveHandler as nativeEmailRouterLeaveSave,
  emailRouterOutboxHandler as nativeEmailRouterOutbox,
  emailRouterPresetsHandler as nativeEmailRouterPresets,
  emailRouterRetryHandler as nativeEmailRouterRetry,
  emailRouterFilingRetryHandler as nativeEmailRouterFilingRetry,
  emailRouterHealthHandler as nativeEmailRouterHealth,
  emailRouterSettingsHandler as nativeEmailRouterSettings,
  emailRouterSettingsSaveHandler as nativeEmailRouterSettingsSave,
  emailRouterSubscriptionHandler as nativeEmailRouterSubscription,
  emailRouterUndoHandler as nativeEmailRouterUndo,
} from '../_emailRouterHandlers.js';
import { createEmailRouterServiceClient, currentEmailRouterMailbox, emailRouterGraphFetch, maintainEmailRouterSubscriptions, processEmailRouterOutbox, recordEmailRouterAlert, resolveEmailRouterAlert, syncEmailRouterFolderFromStoredCursor } from '../_emailRouterCore.js';
import { processEmailRouterLearningJobs } from '../_emailRouterLearning.js';

async function readBody(req) {
  if (req.method === 'GET') return {};
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (typeof req.json === 'function') return req.json().catch(() => ({}));

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const ADMIN_APP_MODULES = [
  { id: 'dashboard', label: 'Dashboard', path: '/', sortOrder: 10 },
  { id: 'review', label: 'Exception Review', path: '/review', sortOrder: 20 },
  {
    id: 'disputes',
    label: 'Dispute Workflow',
    path: '/disputes',
    sortOrder: 30,
  },
  {
    id: 'buyer_invoices',
    label: 'Payment Collections',
    path: '/payment-collections?tab=collections',
    sortOrder: 40,
  },
  {
    id: 'unofficial_compensation',
    label: 'Unofficial Compensation',
    path: '/unofficial-compensation',
    sortOrder: 42,
  },
  {
    id: 'incoming_payments',
    label: 'Incoming Payments (Payment Collections)',
    path: '/payment-collections?tab=incoming',
    sortOrder: 45,
  },
  {
    id: 'cashflow_forecast',
    label: 'Cashflow Forecast',
    path: '/cashflow-forecast',
    sortOrder: 47,
  },
  {
    id: 'pnl',
    label: 'Dashboard and Qlik Validator Tool',
    path: '/pnl',
    sortOrder: 50,
  },
  {
    id: 'brokers',
    label: "Broker's Commission",
    path: '/brokers',
    sortOrder: 70,
  },
  {
    id: 'report_archive',
    label: 'Reports Archive',
    path: '/brokers?tab=archive',
    sortOrder: 75,
  },
  {
    id: 'buyers_administrator',
    label: 'Account Managers',
    path: '/account-managers',
    sortOrder: 85,
  },
  { id: 'markets', label: 'Markets', path: '/markets', sortOrder: 86 },
  { id: 'special_terms', label: 'Special Terms', path: '/special-terms', sortOrder: 87 },
  { id: 'hedge_desk', label: 'Hedge Desk', path: '/hedge-desk', sortOrder: 88 },
  { id: 'email_router', label: 'Email Router', path: '/email-router', sortOrder: 89 },
  { id: 'settings', label: 'Settings', path: '/settings', sortOrder: 90 },
  { id: 'admin', label: 'People & Access', path: '/settings?section=people', sortOrder: 100 },
];

let portalOutboxScheduledAt = 0;

function schedulePortalOutboxRetry(client) {
  const now = Date.now();
  if (now - portalOutboxScheduledAt < 60_000) return;
  portalOutboxScheduledAt = now;
  waitUntil(
    processPortalOutbox({
      client,
      limit: 3,
      requestId: activePortalRequestId(),
    }).catch((error) => {
      console.warn('[portal] Background retry deferred.', {
        code: error.code || 'PORTAL_RETRY_FAILED',
      });
    }),
  );
}

const ADMIN_MODULE_IDS = new Set(ADMIN_APP_MODULES.map((module) => module.id));
const ADMIN_FULL_ACCESS = Object.fromEntries(ADMIN_APP_MODULES.map((module) => [module.id, true]));
const ADMINISTRATIVE_USER_TYPES = new Set(['administrator', 'general_manager']);

function isAdministratorUserType(userType) {
  return ADMINISTRATIVE_USER_TYPES.has(String(userType || ''));
}

function canOverridePaymentPostingReminder(profile) {
  return isAdministratorUserType(profile?.user_type) || profile?.user_type === 'finance';
}
const ADMIN_CAPABILITIES = [
  {
    id: 'disputes_approve',
    label: 'Approve Dispute Instructions',
    description: 'Approve, reject, or return trader dispute instructions.',
  },
  {
    id: 'disputes_account',
    label: 'Settle and Close Disputes',
    description: 'Record payment instructions, final settlement, and case closure.',
  },
  {
    id: 'buyer_invoices_manage',
    label: 'Manage Buyer Invoice Settings',
    description: 'Change the shared internal report schedule and template.',
  },
  {
    id: 'financial_report_settings_manage',
    label: 'Manage Financial Report Settings',
    description: 'Change approved recipients and templates for internal financial reports.',
  },
  {
    id: 'cashflow_forecast_manage',
    label: 'Manage Cashflow Settings',
    description: 'Change forecast assumptions and blocked dates.',
  },
  { id: 'hedge_book_manage', label: 'Manage Hedge Book', description: 'Create and maintain physical trades, paper hedges, markets, and counterparties.' },
  { id: 'hedge_settlement_manage', label: 'Manage Hedge Settlement', description: 'Manage clearing entries, settlement invoices, and settlement notices.' },
  { id: 'hedge_close_approve', label: 'Approve Hedge Close and Reports', description: 'Close or reopen months and approve SFS reports.' },
  { id: 'hedge_admin', label: 'Administer Hedge Desk', description: 'Manage Hedge Desk configuration, integrations, and Trading Assistant model.' },
  { id: 'special_terms_manage', label: 'Manage Special Terms', description: 'Create, edit, and remove Salesforce Special Terms and matching rules.' },
  { id: 'special_terms_clause_approve', label: 'Approve Special Term Clauses', description: 'Approve, retire, migrate, and roll back versioned Salesforce clause wording.' },
  { id: 'broker_settings_manage', label: 'Manage Broker Commission Settings', description: 'Change the company exchange-rate provider used by Broker Commissions.' },
];
const ADMIN_CAPABILITY_IDS = new Set(ADMIN_CAPABILITIES.map((capability) => capability.id));
const ADMIN_FULL_CAPABILITIES = Object.fromEntries(ADMIN_CAPABILITIES.map((capability) => [capability.id, true]));
const REPORT_ARCHIVE_MODULE_ID = 'report_archive';
const REPORT_ARCHIVE_MANAGE_MODULE_ID = 'report_archive_manage';
const DEFAULT_USER_TYPES = [
  {
    id: 'general_manager',
    label: 'General Manager',
    description: 'Full administration access and the single reporting-hierarchy root.',
    is_system: true,
    sort_order: 5,
  },
  {
    id: 'administrator',
    label: 'Administrator',
    description: 'Full system administration access.',
    is_system: true,
    sort_order: 10,
  },
  {
    id: 'manager',
    label: 'Manager',
    description: 'Operational management access without user administration.',
    is_system: true,
    sort_order: 20,
  },
  {
    id: 'finance',
    label: 'Finance',
    description: 'Finance, invoice, report, and commission review access.',
    is_system: true,
    sort_order: 30,
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Operational review and dispute workflow access.',
    is_system: true,
    sort_order: 40,
  },
  {
    id: 'interoffice',
    label: 'Interoffice',
    description: 'Finance-style access with FRATELLI COSULICH buyer-group STEMs excluded from Salesforce data.',
    is_system: true,
    sort_order: 45,
  },
  {
    id: 'viewer',
    label: 'Viewer',
    description: 'Read-only dashboard access.',
    is_system: true,
    sort_order: 50,
  },
];
const FALLBACK_TYPE_PERMISSIONS = {
  general_manager: ADMIN_FULL_ACCESS,
  administrator: ADMIN_FULL_ACCESS,
  manager: {
    dashboard: true,
    review: true,
    disputes: true,
    buyer_invoices: true,
    unofficial_compensation: true,
    incoming_payments: true,
    cashflow_forecast: true,
    pnl: true,
    brokers: true,
    report_archive: true,
    buyers_administrator: false,
    hedge_desk: true,
    markets: true,
    special_terms: true,
    settings: true,
    admin: false,
  },
  finance: {
    dashboard: true,
    review: true,
    disputes: true,
    buyer_invoices: true,
    unofficial_compensation: true,
    incoming_payments: true,
    cashflow_forecast: true,
    pnl: true,
    brokers: true,
    report_archive: true,
    buyers_administrator: false,
    hedge_desk: true,
    markets: true,
    special_terms: true,
    settings: false,
    admin: false,
  },
  operations: {
    dashboard: true,
    review: true,
    disputes: true,
    buyer_invoices: false,
    unofficial_compensation: false,
    incoming_payments: true,
    cashflow_forecast: false,
    pnl: true,
    brokers: false,
    report_archive: false,
    buyers_administrator: false,
    hedge_desk: false,
    markets: true,
    special_terms: true,
    settings: false,
    admin: false,
  },
  interoffice: {
    dashboard: true,
    review: true,
    disputes: true,
    buyer_invoices: true,
    unofficial_compensation: true,
    incoming_payments: true,
    cashflow_forecast: true,
    pnl: true,
    brokers: true,
    report_archive: false,
    buyers_administrator: false,
    hedge_desk: false,
    markets: true,
    special_terms: true,
    settings: false,
    admin: false,
  },
  viewer: {
    dashboard: true,
    review: false,
    disputes: false,
    buyer_invoices: false,
    unofficial_compensation: false,
    incoming_payments: true,
    cashflow_forecast: false,
    pnl: false,
    brokers: false,
    report_archive: false,
    buyers_administrator: false,
    hedge_desk: false,
    markets: true,
    special_terms: true,
    settings: false,
    admin: false,
  },
};
const FALLBACK_TYPE_CAPABILITIES = {
  general_manager: ADMIN_FULL_CAPABILITIES,
  administrator: ADMIN_FULL_CAPABILITIES,
  manager: {
    disputes_approve: true,
    disputes_account: false,
    buyer_invoices_manage: true,
    financial_report_settings_manage: false,
    cashflow_forecast_manage: true,
    hedge_book_manage: true,
    hedge_settlement_manage: false,
    hedge_close_approve: false,
    hedge_admin: false,
    special_terms_manage: true,
    special_terms_clause_approve: false,
    broker_settings_manage: false,
  },
  finance: {
    disputes_approve: false,
    disputes_account: true,
    buyer_invoices_manage: true,
    financial_report_settings_manage: true,
    cashflow_forecast_manage: true,
    hedge_book_manage: false,
    hedge_settlement_manage: true,
    hedge_close_approve: false,
    hedge_admin: false,
    special_terms_manage: false,
    special_terms_clause_approve: false,
    broker_settings_manage: true,
  },
  operations: {
    disputes_approve: false,
    disputes_account: false,
    buyer_invoices_manage: false,
    financial_report_settings_manage: false,
    cashflow_forecast_manage: false,
    hedge_book_manage: false,
    hedge_settlement_manage: false,
    hedge_close_approve: false,
    hedge_admin: false,
    special_terms_manage: true,
    special_terms_clause_approve: false,
    broker_settings_manage: false,
  },
  interoffice: {
    disputes_approve: false,
    disputes_account: false,
    buyer_invoices_manage: false,
    financial_report_settings_manage: false,
    cashflow_forecast_manage: false,
    hedge_book_manage: false,
    hedge_settlement_manage: false,
    hedge_close_approve: false,
    hedge_admin: false,
    special_terms_manage: false,
    special_terms_clause_approve: false,
  },
  viewer: {
    disputes_approve: false,
    disputes_account: false,
    buyer_invoices_manage: false,
    financial_report_settings_manage: false,
    cashflow_forecast_manage: false,
    hedge_book_manage: false,
    hedge_settlement_manage: false,
    hedge_close_approve: false,
    hedge_admin: false,
    special_terms_manage: false,
    special_terms_clause_approve: false,
  },
};
const INTEROFFICE_USER_TYPE_ID = 'interoffice';
const INTEROFFICE_EXCLUDED_BUYER_GROUP = 'FRATELLI COSULICH';

function reportArchiveAccessLevel(value, canView = undefined) {
  if (value === 'full' || value === true) return 'full';
  if (value === 'read') return 'read';
  if (canView === true) return 'full';
  return 'none';
}

function permissionCanView(moduleId, value) {
  if (moduleId === REPORT_ARCHIVE_MODULE_ID) return reportArchiveAccessLevel(value) !== 'none';
  return value === true;
}

function permissionValueFromRow(row) {
  return row?.can_view === true;
}

function normalizedPermissionForModule(moduleId, permissions = {}, fallback = undefined) {
  const raw = Object.prototype.hasOwnProperty.call(permissions, moduleId) ? permissions[moduleId] : fallback;
  if (moduleId === REPORT_ARCHIVE_MODULE_ID) return reportArchiveAccessLevel(raw);
  return raw === true;
}

function reportArchiveAccessFromRows(rows = [], fallback = false) {
  const reportRow = rows.find((row) => row.module_id === REPORT_ARCHIVE_MODULE_ID);
  const manageRow = rows.find((row) => row.module_id === REPORT_ARCHIVE_MANAGE_MODULE_ID);
  const canViewArchive = reportRow ? reportRow.can_view === true : fallback === true;
  if (!canViewArchive) return 'none';
  if (!manageRow) return 'full';
  return manageRow.can_view === true ? 'full' : 'read';
}

function appError(message, status = 500, code = null, details = undefined, expose = status < 500) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  if (details !== undefined) error.details = details;
  error.expose = expose;
  return error;
}

function supabaseUrl() {
  return serverSupabaseConfig().url;
}

let cachedSupabaseAdmin = null;

function supabaseAdminClient() {
  const config = serverSupabaseConfig();
  if (!config.configured) {
    throw appError(`Missing Supabase server configuration: ${config.missingEnv.join(', ')}.`, 500);
  }
  if (!cachedSupabaseAdmin) {
    const trackedFetch = async (...args) => {
      const startedAt = Date.now();
      try {
        const response = await fetch(...args);
        recordSupabaseRequest({
          durationMs: Date.now() - startedAt,
          ok: response.ok,
        });
        return response;
      } catch (error) {
        recordSupabaseRequest({
          durationMs: Date.now() - startedAt,
          ok: false,
        });
        throw error;
      }
    };
    cachedSupabaseAdmin = createClient(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: trackedFetch,
      },
    });
  }
  return cachedSupabaseAdmin;
}

function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1];

  try {
    const url = new URL(req?.url || '', 'http://localhost');
    return url.searchParams.get('access_token') || url.searchParams.get('token') || null;
  } catch {
    return null;
  }
}

async function requireAdministrator(req) {
  const context = await requireActiveUser(req);
  if (!isAdministratorUserType(context.profile.user_type)) {
    throw appError('Administrator or General Manager access required.', 403);
  }
  return context;
}

function safeSupabaseAdminClient() {
  try {
    return supabaseAdminClient();
  } catch {
    return null;
  }
}

async function requireActiveUser(req) {
  const token = bearerToken(req);
  if (!token) throw appError('Sign-in required.', 401);

  const client = supabaseAdminClient();
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData?.user) throw appError('Invalid or expired session. Sign in again.', 401);

  const { data: profile, error: profileError } = await client.from('user_profiles').select('id,email,full_name,user_type,active,use_type_defaults').eq('id', userData.user.id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw appError('User is not registered.', 403);
  if (!profile.active) throw appError('User is inactive.', 403);

  return { client, authUser: userData.user, profile };
}

async function loadAuthBootstrapPreferences(client, userId) {
  const { data, error } = await client
    .from('user_navigation_preferences')
    .select('user_id,section_orders,hidden_item_ids,sidebar_mode,table_density,document_show_only_relevant,document_source_groups,workspace_preferences_initialized,revision,updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return {
    navigationPreferences: serializeNavigationPreferences(data),
    workspacePreferences: serializeWorkspacePreferences(data),
  };
}

async function authContext(body, req, accessContext) {
  const { client, authUser, profile } = accessContext || (await requireActiveUser(req));
  const preferencesPromise = loadAuthBootstrapPreferences(client, profile.id);
  let permissionValues;
  let capabilityValues;

  if (isAdministratorUserType(profile.user_type)) {
    permissionValues = ADMIN_FULL_ACCESS;
    capabilityValues = ADMIN_FULL_CAPABILITIES;
  } else {
    const permissionQuery = profile.use_type_defaults === false ? client.from('user_module_permissions').select('module_id,can_view').eq('user_id', profile.id) : client.from('user_type_module_permissions').select('module_id,can_view').eq('user_type_id', profile.user_type);
    const { data: rows, error } = await permissionQuery;
    if (error) throw error;

    const fallback = profile.use_type_defaults === false ? {} : FALLBACK_TYPE_PERMISSIONS[profile.user_type] || {};
    const rawPermissions = { ...fallback };
    for (const row of rows || []) {
      if (ADMIN_MODULE_IDS.has(row.module_id)) rawPermissions[row.module_id] = row.can_view === true;
    }
    rawPermissions[REPORT_ARCHIVE_MODULE_ID] = reportArchiveAccessFromRows(rows || [], fallback[REPORT_ARCHIVE_MODULE_ID]);
    permissionValues = normalizePermissions(profile.user_type, rawPermissions);
    const capabilityFallback = profile.use_type_defaults === false ? {} : FALLBACK_TYPE_CAPABILITIES[profile.user_type] || {};
    capabilityValues = { ...capabilityFallback };
    for (const row of rows || []) {
      if (ADMIN_CAPABILITY_IDS.has(row.module_id)) capabilityValues[row.module_id] = row.can_view === true;
    }
    capabilityValues = normalizeCapabilities(profile.user_type, capabilityValues);
  }

  const moduleAccess = Object.fromEntries(ADMIN_APP_MODULES.map((module) => [module.id, permissionCanView(module.id, permissionValues[module.id])]));
  const applications = await listPortalApplicationsForUser({
    client,
    profile,
    moduleAccess,
  });
  const bootstrapPreferences = await preferencesPromise;
  schedulePortalOutboxRetry(client);

  return {
    user: {
      id: profile.id,
      full_name: profile.full_name || authUser.user_metadata?.full_name || profile.email || authUser.email,
      email: profile.email || authUser.email,
      role: isAdministratorUserType(profile.user_type) ? 'admin' : profile.user_type,
      user_type: profile.user_type,
      use_type_defaults: profile.use_type_defaults !== false,
      active: profile.active === true,
    },
    moduleAccess,
    moduleAccessLevels: {
      [REPORT_ARCHIVE_MODULE_ID]: reportArchiveAccessLevel(permissionValues[REPORT_ARCHIVE_MODULE_ID]),
    },
    capabilities: capabilityValues,
    applications,
    navigationPreferences: bootstrapPreferences?.navigationPreferences || null,
    workspacePreferences: bootstrapPreferences?.workspacePreferences || null,
  };
}

function activePortalRequestId() {
  return currentRequestTelemetry()?.requestId || null;
}

async function portalApplicationsList(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const auth = await authContext(body, req, context);
  return { applications: auth.applications || [] };
}

async function portalApplicationLaunch(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const applicationId = String(body.applicationId || '').trim();
  if (!applicationId) throw appError('Application is required.', 400);
  return launchPortalApplication({
    client: context.client,
    profile: context.profile,
    applicationId,
    requestId: activePortalRequestId(),
  });
}

async function portalSignOut(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return revokePortalSessions({
    client: context.client,
    profile: context.profile,
    requestId: activePortalRequestId(),
  });
}

async function portalEntitlementSyncCron(body = {}, req = null) {
  requireCronAuthorization(req);
  const client = supabaseAdminClient();
  const results = await processPortalOutbox({
    client,
    limit: body.limit,
    requestId: activePortalRequestId(),
  });
  return {
    processed: results.length,
    succeeded: results.filter((row) => row.status === 'succeeded').length,
    failed: results.filter((row) => row.status !== 'succeeded').length,
    results,
  };
}

async function collaborationDailyCron(body = {}, req = null) {
  requireCronAuthorization(req);
  return collaborationDailyMaintenance(supabaseAdminClient());
}

async function collaborationList(body = {}, req = null, accessContext = null) {
  return collaborationListService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationDetail(body = {}, req = null, accessContext = null) {
  return collaborationDetailService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationCreate(body = {}, req = null, accessContext = null) {
  return collaborationCreateService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationUpdate(body = {}, req = null, accessContext = null) {
  return collaborationUpdateService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationBulkUpdate(body = {}, req = null, accessContext = null) {
  return collaborationBulkUpdateService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationFollowerToggle(body = {}, req = null, accessContext = null) {
  return collaborationFollowerToggleService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationDependencySave(body = {}, req = null, accessContext = null) {
  return collaborationDependencySaveService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationDependencyRemove(body = {}, req = null, accessContext = null) {
  return collaborationDependencyRemoveService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationMilestoneSave(body = {}, req = null, accessContext = null) {
  return collaborationMilestoneSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationTemplateList(body = {}, req = null, accessContext = null) {
  return collaborationTemplateListService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationTemplateSave(body = {}, req = null, accessContext = null) {
  return collaborationTemplateSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationArchive(body = {}, req = null, accessContext = null) {
  return collaborationArchiveService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationCommentSave(body = {}, req = null, accessContext = null) {
  return collaborationCommentSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationCommentDelete(body = {}, req = null, accessContext = null) {
  return collaborationCommentDeleteService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationAttachmentPrepare(body = {}, req = null, accessContext = null) {
  return collaborationAttachmentPrepareService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationAttachmentComplete(body = {}, req = null, accessContext = null) {
  return collaborationAttachmentCompleteService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationAttachmentUrl(body = {}, req = null, accessContext = null) {
  return collaborationAttachmentUrlService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationAttachmentDelete(body = {}, req = null, accessContext = null) {
  return collaborationAttachmentDeleteService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationNotificationsList(body = {}, req = null, accessContext = null) {
  return collaborationNotificationsListService(body, accessContext || (await requireActiveUser(req)));
}

async function collaborationNotificationsRead(body = {}, req = null, accessContext = null) {
  return collaborationNotificationsReadService(body, accessContext || (await requireActiveUser(req)));
}

async function improvementsList(body = {}, req = null, accessContext = null) {
  return improvementsListService(body, accessContext || (await requireActiveUser(req)));
}

async function improvementDetail(body = {}, req = null, accessContext = null) {
  return improvementDetailService(body, accessContext || (await requireActiveUser(req)));
}

async function improvementCreate(body = {}, req = null, accessContext = null) {
  return improvementCreateService(body, accessContext || (await requireActiveUser(req)));
}

async function improvementPropose(body = {}, req = null, accessContext = null) {
  return improvementProposeService(body, accessContext || (await requireActiveUser(req)));
}

async function improvementDecision(body = {}, req = null, accessContext = null) {
  return improvementDecisionService(body, accessContext || (await requireActiveUser(req)));
}

async function improvementAttachmentPrepare(body = {}, req = null, accessContext = null) {
  return improvementAttachmentPrepareService(body, accessContext || (await requireActiveUser(req)));
}

async function improvementAttachmentComplete(body = {}, req = null, accessContext = null) {
  return improvementAttachmentCompleteService(body, accessContext || (await requireActiveUser(req)));
}

async function improvementAttachmentUrl(body = {}, req = null, accessContext = null) {
  return improvementAttachmentUrlService(body, accessContext || (await requireActiveUser(req)));
}

async function improvementAttachmentDelete(body = {}, req = null, accessContext = null) {
  return improvementAttachmentDeleteService(body, accessContext || (await requireActiveUser(req)));
}

function requireAdministratorContext(accessContext) {
  if (!isAdministratorUserType(accessContext?.profile?.user_type)) {
    throw appError('Administrator or General Manager access required.', 403);
  }
  return accessContext;
}

async function workNotificationsAccessContext(req, accessContext) {
  const context = accessContext || (await requireActiveUser(req));
  const markets = await userHasAnyModuleAccess(context.client, context.profile, ['markets']);
  return { ...context, capabilities: { ...(context.capabilities || {}), markets } };
}

async function workNotificationsList(body = {}, req = null, accessContext = null) {
  return workNotificationsListService(body, await workNotificationsAccessContext(req, accessContext));
}

async function workNotificationsRead(body = {}, req = null, accessContext = null) {
  return workNotificationsReadService(body, await workNotificationsAccessContext(req, accessContext));
}

async function workNotificationsState(body = {}, req = null, accessContext = null) {
  return workNotificationsStateService(body, await workNotificationsAccessContext(req, accessContext));
}

async function verifyFinancialReportIncident(client, purposeKey) {
  await loadFinancialReportSettings(client, purposeKey, { required: true });
  await resolveGraphEmailSender(client, purposeKey);
}

async function systemErrorVerify(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const incidentSignature = String(body.incidentSignature || body.incident_signature || '').trim().toLowerCase();
  if (!validSystemErrorSignature(incidentSignature)) throw appError('A valid system incident is required.', 400);
  const { data: incident, error } = await context.client
    .from('system_error_events')
    .select('id,dedupe_key,handler')
    .eq('dedupe_key', incidentSignature)
    .maybeSingle();
  if (error) throw error;
  if (!incident) throw appError('This system incident is no longer available.', 404);

  switch (incident.handler) {
    case 'outstandingBuyerInvoicesEmailReport':
    case 'outstandingBuyerInvoicesEmailCron':
      await verifyFinancialReportIncident(context.client, 'outstanding_invoice_reports');
      break;
    case 'incomingPaymentEmailReport':
      await verifyFinancialReportIncident(context.client, 'incoming_payment_reports');
      break;
    case 'buyerInvoicePaymentReminderSend':
      await resolveGraphEmailSender(context.client, 'payment_reminders');
      await salesforceObjectFields({ objectName: 'stem__c' });
      break;
    case 'disputeWorkflowList': {
      const stemFields = await salesforceObjectFields({ objectName: 'stem__c' });
      await interofficeStemAccessCondition(context, stemFields.fields || []);
      break;
    }
    case 'workNotificationsList': {
      const { error: stateError } = await context.client
        .from('system_error_notification_states')
        .select('event_id', { count: 'exact', head: true });
      if (stateError) throw stateError;
      break;
    }
    case 'specialTermsWorkspace':
      await listSpecialTerms({ force: true });
      break;
    case 'hedgeDeskSalesforceMapping':
      await getHedgeSalesforceMapping(context.client);
      break;
    case 'hedgeMarkets':
      await hedgeMarkets({ action: 'snapshot' }, req, context);
      break;
    case 'emailRouterMaintenanceCron': {
      const serviceClient = createEmailRouterServiceClient();
      const mailbox = await currentEmailRouterMailbox(serviceClient);
      const expectedFolders = ['inbox', 'sentitems', 'archive'];
      const freshnessCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
      const [{ data: subscriptions, error: subscriptionsError }, { data: deltaStates, error: deltaStateError }] = await Promise.all([
        serviceClient
          .schema('emailrouter')
          .from('mailbox_subscriptions')
          .select('resource_key')
          .eq('mailbox_id', mailbox.id)
          .eq('state', 'active')
          .gt('expires_at', new Date().toISOString())
          .in('resource_key', expectedFolders),
        serviceClient
          .schema('emailrouter')
          .from('mailbox_delta_state')
          .select('folder_key')
          .eq('mailbox_id', mailbox.id)
          .eq('sync_state', 'ready')
          .gte('last_synced_at', freshnessCutoff)
          .in('folder_key', expectedFolders),
      ]);
      if (subscriptionsError) throw subscriptionsError;
      if (deltaStateError) throw deltaStateError;
      const activeFolders = new Set((subscriptions || []).map((row) => row.resource_key));
      const synchronizedFolders = new Set((deltaStates || []).map((row) => row.folder_key));
      if (expectedFolders.some((folder) => !activeFolders.has(folder))) {
        throw appError('Email Router does not have an active future-dated subscription for every managed folder.', 503, 'EMAIL_ROUTER_SUBSCRIPTION_UNAVAILABLE');
      }
      if (expectedFolders.some((folder) => !synchronizedFolders.has(folder))) {
        throw appError('Email Router has not synchronized every managed folder recently.', 503, 'EMAIL_ROUTER_SYNCHRONIZATION_STALE');
      }
      break;
    }
    case 'salesforceQuery':
      if (handlers.salesforceQuery) throw appError('The legacy Salesforce query endpoint is still registered.', 503, 'LEGACY_SALESFORCE_QUERY_ACTIVE');
      break;
    default:
      throw appError('This incident requires review in its affected workspace and cannot be verified automatically.', 400);
  }

  const resolved = await resolveSystemErrorIncident(context.client, incidentSignature);
  return { verified: true, resolved: resolved.resolved || 0, incidentSignature };
}

async function workCommitmentsList(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const [
    paymentCollections,
    disputes,
    disputeApprove,
    disputeAccount,
    hedgeDesk,
    hedgeCloseApprove,
    hedgeSettlementManage,
    emailRouter,
  ] = await Promise.all([
    userHasAnyModuleAccess(context.client, context.profile, ['buyer_invoices', 'incoming_payments']),
    userHasAnyModuleAccess(context.client, context.profile, ['disputes']),
    userHasCapability(context.client, context.profile, 'disputes_approve'),
    userHasCapability(context.client, context.profile, 'disputes_account'),
    userHasAnyModuleAccess(context.client, context.profile, ['hedge_desk']),
    userHasCapability(context.client, context.profile, 'hedge_close_approve'),
    userHasCapability(context.client, context.profile, 'hedge_settlement_manage'),
    userHasAnyModuleAccess(context.client, context.profile, ['email_router']),
  ]);
  return workCommitmentsListService(body, {
    ...context,
    capabilities: {
      paymentCollections,
      disputes,
      disputeApprove,
      disputeAccount,
      hedgeDesk,
      hedgeCloseApprove,
      hedgeSettlementManage,
      emailRouter,
    },
  });
}

async function growthReportingLinesList(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireAdministrator(req));
  return growthReportingLinesListService(body, requireAdministratorContext(context));
}

async function growthReportingLineSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireAdministrator(req));
  return growthReportingLineSaveService(body, requireAdministratorContext(context));
}

async function growthReportingLinesSaveBatch(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireAdministrator(req));
  return growthReportingLinesSaveBatchService(body, requireAdministratorContext(context));
}

async function growthCoachingBootstrap(body = {}, req = null, accessContext = null) {
  return growthCoachingBootstrapService(body, accessContext || (await requireActiveUser(req)));
}

async function growthPlanSave(body = {}, req = null, accessContext = null) {
  return growthPlanSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function growthPlanCloseout(body = {}, req = null, accessContext = null) {
  return growthPlanCloseoutService(body, accessContext || (await requireActiveUser(req)));
}

async function growthGoalSave(body = {}, req = null, accessContext = null) {
  return growthGoalSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function growthGoalSubmit(body = {}, req = null, accessContext = null) {
  return growthGoalSubmitService(body, accessContext || (await requireActiveUser(req)));
}

async function growthGoalDecision(body = {}, req = null, accessContext = null) {
  return growthGoalDecisionService(body, accessContext || (await requireActiveUser(req)));
}

async function growthGoalProgressSave(body = {}, req = null, accessContext = null) {
  return growthGoalProgressSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function growthGoalCompletion(body = {}, req = null, accessContext = null) {
  return growthGoalCompletionService(body, accessContext || (await requireActiveUser(req)));
}

async function growthGoalEvidenceOptions(body = {}, req = null, accessContext = null) {
  return growthGoalEvidenceOptionsService(body, accessContext || (await requireActiveUser(req)));
}

async function growthGoalEvidenceSave(body = {}, req = null, accessContext = null) {
  return growthGoalEvidenceSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingRelationshipInvite(body = {}, req = null, accessContext = null) {
  return coachingRelationshipInviteService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingRelationshipRespond(body = {}, req = null, accessContext = null) {
  return coachingRelationshipRespondService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingRelationshipEnd(body = {}, req = null, accessContext = null) {
  return coachingRelationshipEndService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingSessionSave(body = {}, req = null, accessContext = null) {
  return coachingSessionSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingSessionContentSave(body = {}, req = null, accessContext = null) {
  return coachingSessionContentSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingSessionConfirm(body = {}, req = null, accessContext = null) {
  return coachingSessionConfirmService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingSessionCancel(body = {}, req = null, accessContext = null) {
  return coachingSessionCancelService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingActionSave(body = {}, req = null, accessContext = null) {
  return coachingActionSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingActionPublish(body = {}, req = null, accessContext = null) {
  return coachingActionPublishService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingActionProposalRespond(body = {}, req = null, accessContext = null) {
  return coachingActionProposalRespondService(body, accessContext || (await requireActiveUser(req)));
}

async function growthAttachmentPrepare(body = {}, req = null, accessContext = null) {
  return growthAttachmentPrepareService(body, accessContext || (await requireActiveUser(req)));
}

async function growthAttachmentComplete(body = {}, req = null, accessContext = null) {
  return growthAttachmentCompleteService(body, accessContext || (await requireActiveUser(req)));
}

async function growthAttachmentUrl(body = {}, req = null, accessContext = null) {
  return growthAttachmentUrlService(body, accessContext || (await requireActiveUser(req)));
}

async function growthEmailPreferencesSave(body = {}, req = null, accessContext = null) {
  return growthEmailPreferencesSaveService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingCalendarResolve(body = {}, req = null, accessContext = null) {
  return coachingCalendarResolveService(body, accessContext || (await requireActiveUser(req)));
}

async function coachingCalendarRetry(body = {}, req = null, accessContext = null) {
  return coachingCalendarRetryService(body, accessContext || (await requireActiveUser(req)));
}

async function growthCoachingDailyCron(body = {}, req = null) {
  requireCronAuthorization(req);
  return growthCoachingDailyMaintenance(supabaseAdminClient());
}

function normalizePermissions(userType, permissions = {}) {
  if (isAdministratorUserType(userType)) return ADMIN_FULL_ACCESS;
  const normalized = {};
  for (const module of ADMIN_APP_MODULES) {
    normalized[module.id] = normalizedPermissionForModule(module.id, permissions, false);
  }
  return normalized;
}

function slugifyUserTypeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function normalizeUserTypePermissions(userTypeId, permissions = {}) {
  if (isAdministratorUserType(userTypeId)) return ADMIN_FULL_ACCESS;
  const base = FALLBACK_TYPE_PERMISSIONS[userTypeId] || {};
  const normalized = {};
  for (const module of ADMIN_APP_MODULES) {
    normalized[module.id] = normalizedPermissionForModule(module.id, permissions, base[module.id] ?? false);
  }
  return normalized;
}

function normalizeCapabilities(userTypeId, capabilities = {}) {
  if (isAdministratorUserType(userTypeId)) return ADMIN_FULL_CAPABILITIES;
  const fallback = FALLBACK_TYPE_CAPABILITIES[userTypeId] || {};
  return Object.fromEntries(ADMIN_CAPABILITIES.map((capability) => [capability.id, Object.prototype.hasOwnProperty.call(capabilities, capability.id) ? capabilities[capability.id] === true : fallback[capability.id] === true]));
}

async function listAccessModel(client) {
  const [typesRes, permissionsRes] = await Promise.all([client.from('user_types').select('id,label,description,is_system,sort_order,created_at,updated_at').order('sort_order', { ascending: true }).order('label', { ascending: true }), client.from('user_type_module_permissions').select('user_type_id,module_id,can_view')]);
  if (typesRes.error) throw typesRes.error;
  if (permissionsRes.error) throw permissionsRes.error;

  const userTypes = (typesRes.data?.length ? typesRes.data : DEFAULT_USER_TYPES).map((type) => ({
    ...type,
    label: type.label || type.id,
    description: type.description || '',
    is_system: type.is_system === true,
    sort_order: Number(type.sort_order ?? 100),
  }));
  const typePermissions = Object.fromEntries(userTypes.map((type) => [type.id, normalizeUserTypePermissions(type.id)]));
  const typeCapabilities = Object.fromEntries(userTypes.map((type) => [type.id, normalizeCapabilities(type.id)]));
  const manageRowsByType = {};
  for (const row of permissionsRes.data || []) {
    if (row.module_id === REPORT_ARCHIVE_MANAGE_MODULE_ID) {
      manageRowsByType[row.user_type_id] = row.can_view === true;
      continue;
    }
    if (ADMIN_CAPABILITY_IDS.has(row.module_id)) {
      if (!typeCapabilities[row.user_type_id]) typeCapabilities[row.user_type_id] = normalizeCapabilities(row.user_type_id);
      typeCapabilities[row.user_type_id][row.module_id] = row.can_view === true;
      continue;
    }
    if (!ADMIN_MODULE_IDS.has(row.module_id)) continue;
    if (!typePermissions[row.user_type_id]) typePermissions[row.user_type_id] = normalizeUserTypePermissions(row.user_type_id);
    typePermissions[row.user_type_id][row.module_id] = permissionValueFromRow(row);
  }
  for (const type of userTypes) {
    if (typePermissions[type.id]?.[REPORT_ARCHIVE_MODULE_ID] === true) {
      typePermissions[type.id][REPORT_ARCHIVE_MODULE_ID] = Object.prototype.hasOwnProperty.call(manageRowsByType, type.id) ? (manageRowsByType[type.id] ? 'full' : 'read') : 'full';
    }
    typePermissions[type.id] = normalizeUserTypePermissions(type.id, typePermissions[type.id]);
    typeCapabilities[type.id] = normalizeCapabilities(type.id, typeCapabilities[type.id]);
  }
  return { userTypes, typePermissions, typeCapabilities };
}

const AUTH_EXEMPT_HANDLERS = new Set(['outstandingBuyerInvoicesEmailCron', 'paymentCollectionsReconcileCron', 'portalEntitlementSyncCron', 'collaborationDailyCron', 'growthCoachingDailyCron', 'hedgeDeskMaintenanceCron', 'marketReportDriveSyncCron', 'emailRouterMaintenanceCron']);

const HANDLER_MODULE_ACCESS = {
  authContext: [],
  portalApplicationsList: [],
  portalApplicationLaunch: [],
  portalSignOut: [],
  portalEntitlementSyncCron: [],
  collaborationList: [],
  collaborationDetail: [],
  collaborationCreate: [],
  collaborationUpdate: [],
  collaborationBulkUpdate: [],
  collaborationFollowerToggle: [],
  collaborationDependencySave: [],
  collaborationDependencyRemove: [],
  collaborationMilestoneSave: [],
  collaborationTemplateList: [],
  collaborationTemplateSave: [],
  collaborationArchive: [],
  collaborationCommentSave: [],
  collaborationCommentDelete: [],
  collaborationAttachmentPrepare: [],
  collaborationAttachmentComplete: [],
  collaborationAttachmentUrl: [],
  collaborationAttachmentDelete: [],
  collaborationNotificationsList: [],
  collaborationNotificationsRead: [],
  collaborationDailyCron: [],
  improvementsList: [],
  improvementDetail: [],
  improvementCreate: [],
  improvementPropose: [],
  improvementDecision: [],
  improvementAttachmentPrepare: [],
  improvementAttachmentComplete: [],
  improvementAttachmentUrl: [],
  improvementAttachmentDelete: [],
  workNotificationsList: [],
  workNotificationsRead: [],
  workNotificationsState: [],
  systemErrorVerify: [],
  workCommitmentsList: [],
  navigationPreferencesGet: [],
  navigationPreferencesSave: [],
  navigationPreferencesReset: [],
  workspacePreferencesGet: [],
  workspacePreferencesSave: [],
  emailRouterList: ['email_router'],
  emailRouterBackgroundSync: ['email_router'],
  emailRouterLeave: ['email_router'],
  emailRouterLeaveSave: ['email_router'],
  emailRouterDetail: ['email_router'],
  emailRouterDirectory: ['email_router'],
  emailRouterDirectoryRefresh: ['email_router'],
  emailRouterPresets: ['email_router'],
  emailRouterAction: ['email_router'],
  emailRouterActionStatus: ['email_router'],
  emailRouterUndo: ['email_router'],
  emailRouterRetry: ['email_router'],
  emailRouterFilingRetry: ['email_router'],
  emailRouterAttachmentText: ['email_router'],
  emailRouterAttachmentUrl: ['email_router'],
  emailRouterHealth: ['email_router'],
  emailRouterAdvisor: ['email_router'],
  emailRouterSettings: ['email_router'],
  emailRouterSettingsSave: ['email_router'],
  emailRouterOutbox: ['email_router'],
  emailRouterDelta: ['email_router'],
  emailRouterSubscription: ['email_router'],
  emailRouterMaintenanceCron: [],
  hedgeDeskEntity: ['hedge_desk'],
  hedgeMarkets: ['markets'],
  marketPulseSnapshot: ['markets'],
  marketIntelligenceBrief: ['markets'],
  marketIntelligenceCurve: ['markets'],
  marketIntelligenceValuation: ['markets'],
  marketForwardFallbackSave: ['markets'],
  marketIntelligenceAlertRulesGet: ['markets'],
  marketIntelligenceAlertRulesSave: ['markets'],
  marketIntelligenceCurveCutoverSave: ['markets'],
  marketIntelligenceArchiveReplay: ['markets'],
  hedgeDeskParseMops: ['hedge_desk', 'markets'],
  hedgeDeskGenerateInvoice: ['hedge_desk'],
  hedgeDeskSaveInvoicePdf: ['hedge_desk'],
  hedgeDeskSendInvoiceEmail: ['hedge_desk'],
  hedgeDeskSfsReport: ['hedge_desk'],
  hedgeDeskSfsFile: ['hedge_desk'],
  hedgeDeskSfsSend: ['hedge_desk'],
  hedgeDeskSalesforcePush: ['hedge_desk'],
  hedgeDeskSalesforcePreview: ['hedge_desk'],
  hedgeDeskSalesforceMapping: ['hedge_desk'],
  hedgeDeskAssistant: ['hedge_desk'],
  hedgeDeskAssistantSettings: ['hedge_desk', 'settings'],
  hedgeDeskMaintenanceCron: [],
  marketReportDriveSyncCron: [],
  specialTermsWorkspace: ['special_terms'],
  specialTermsSummaryList: ['special_terms'],
  specialTermsPdfExport: ['special_terms'],
  specialTermsDocumentExport: ['special_terms'],
  specialTermsOptions: ['special_terms'],
  specialTermDetail: ['special_terms'],
  specialTermClauseBank: ['special_terms'],
  specialTermClauseSimilar: ['special_terms'],
  specialTermClauseEditPreview: ['special_terms'],
  specialTermClauseGlobalPublish: ['special_terms'],
  specialTermDeletePreview: ['special_terms'],
  specialTermMigrationInventory: ['special_terms'],
  specialTermClauseDraftSave: ['special_terms'],
  specialTermClauseApprove: ['special_terms'],
  specialTermClauseRetire: ['special_terms'],
  specialTermClauseDelete: ['special_terms'],
  specialTermClauseDraftDiscard: ['special_terms'],
  specialTermClauseConsolidationList: ['special_terms'],
  specialTermClauseConsolidationStart: ['special_terms'],
  specialTermClauseConsolidationRelink: ['special_terms'],
  specialTermClauseConsolidationCancel: ['special_terms'],
  specialTermClauseConsolidationComplete: ['special_terms'],
  specialTermCompositionSave: ['special_terms'],
  specialTermMigrationPreview: ['special_terms'],
  specialTermMigrationPreviewAll: ['special_terms'],
  specialTermMigrationSaveAll: ['special_terms'],
  specialTermMigrationSave: ['special_terms'],
  specialTermMigrationActivate: ['special_terms'],
  specialTermMigrationRollback: ['special_terms'],
  specialTermRevisionSave: ['special_terms'],
  specialTermRevisionCommit: ['special_terms'],
  specialTermRevisionApprove: ['special_terms'],
  specialTermRevisionRollback: ['special_terms'],
  specialTermMigrationBatchList: ['special_terms'],
  specialTermApprovalQueue: ['special_terms'],
  specialTermClauseAiDraft: ['special_terms'],
  specialTermsSave: ['special_terms'],
  specialTermsDelete: ['special_terms'],
  specialTermRuleSave: ['special_terms'],
  specialTermRuleDelete: ['special_terms'],
  paymentCollectionsReconcileCron: [],
  growthReportingLinesList: [],
  growthReportingLineSave: [],
  growthReportingLinesSaveBatch: [],
  growthCoachingBootstrap: [],
  growthPlanSave: [],
  growthPlanCloseout: [],
  growthGoalSave: [],
  growthGoalSubmit: [],
  growthGoalDecision: [],
  growthGoalProgressSave: [],
  growthGoalCompletion: [],
  growthGoalEvidenceOptions: [],
  growthGoalEvidenceSave: [],
  coachingRelationshipInvite: [],
  coachingRelationshipRespond: [],
  coachingRelationshipEnd: [],
  coachingSessionSave: [],
  coachingSessionContentSave: [],
  coachingSessionConfirm: [],
  coachingSessionCancel: [],
  coachingActionSave: [],
  coachingActionPublish: [],
  coachingActionProposalRespond: [],
  growthAttachmentPrepare: [],
  growthAttachmentComplete: [],
  growthAttachmentUrl: [],
  growthEmailPreferencesSave: [],
  coachingCalendarResolve: [],
  coachingCalendarRetry: [],
  growthCoachingDailyCron: [],
  salesforceDashboard: ['dashboard'],
  salesforceDashboardFiltered: ['dashboard', 'review'],
  dashboardSummary: ['dashboard'],
  dashboardStemList: ['dashboard'],
  dashboardAnalytics: ['dashboard'],
  dashboardAccountInsight: ['dashboard'],
  dashboardAccountCreditDirectory: ['dashboard'],
  dashboardAccountCreditStatement: ['dashboard'],
  dashboardCreditForecastSettingsSave: ['dashboard'],
  dashboardCounterpartySearch: ['dashboard'],
  dashboardAccountExposureBatch: ['dashboard'],
  dashboardAccountInsightExport: ['dashboard'],
  salesforceTopBuyers: ['dashboard'],
  salesforceStemDetail: ['dashboard', 'review', 'disputes', 'buyer_invoices', 'incoming_payments', 'cashflow_forecast', 'pnl', 'brokers'],
  salesforceStemDocuments: ['dashboard', 'review', 'disputes', 'buyer_invoices', 'incoming_payments', 'cashflow_forecast', 'pnl', 'brokers'],
  salesforceDocumentDownload: ['dashboard', 'review', 'disputes', 'buyer_invoices', 'incoming_payments', 'pnl', 'brokers'],
  unofficialCompensationList: ['unofficial_compensation'],
  unofficialCompensationOptions: ['unofficial_compensation'],
  unofficialCompensationClaimCreate: ['unofficial_compensation'],
  unofficialCompensationClaimGroupStatus: ['unofficial_compensation'],
  unofficialCompensationRecoveryCreate: ['unofficial_compensation'],
  unofficialCompensationRecoveryDelete: ['unofficial_compensation'],
  exceptionReviewWorkflowList: ['review'],
  exceptionReviewWorkflowSave: ['review'],
  salesforceDisputeStems: ['disputes'],
  disputeBetaList: ['disputes'],
  disputeBetaSaveDraft: ['disputes'],
  disputeBetaSubmitApproval: ['disputes'],
  disputeBetaApprove: ['disputes'],
  disputeBetaReject: ['disputes'],
  disputeBetaMarkExecuted: ['disputes'],
  disputeBetaClose: ['disputes'],
  disputeWorkflowList: ['disputes'],
  disputeWorkflowSaveDraft: ['disputes'],
  disputeWorkflowSubmitApproval: ['disputes'],
  disputeWorkflowApprove: ['disputes'],
  disputeWorkflowReject: ['disputes'],
  disputeWorkflowAccountingUpdate: ['disputes'],
  disputeWorkflowSupplierInstructionUpdate: ['disputes'],
  disputeWorkflowSupplierOffsetOptions: ['disputes'],
  disputeWorkflowSupplierAmountAmend: ['disputes'],
  disputeWorkflowUploadDocument: ['disputes'],
  disputeWorkflowDocuments: ['disputes'],
  disputeWorkflowMarkExecuted: ['disputes'],
  disputeWorkflowClose: ['disputes'],
  disputeWorkflowCompensationClaims: ['disputes'],
  disputeWorkflowCompensationClaimLink: ['disputes'],
  disputeWorkflowAcceptExternalClosure: ['disputes'],
  salesforceBuyerInvoicesDue: ['buyer_invoices'],
  buyerInvoiceCollectionList: ['buyer_invoices'],
  buyerInvoiceCollectionSave: ['buyer_invoices'],
  buyerInvoiceCollectionEventCreate: ['buyer_invoices'],
  buyerInvoicePaymentAdviceSave: ['buyer_invoices'],
  paymentCollectionsReconcile: ['buyer_invoices', 'incoming_payments'],
  shipAgentChargesList: ['buyer_invoices', 'incoming_payments'],
  shipAgentChargesDetail: ['buyer_invoices', 'incoming_payments'],
  shipAgentChargesOptions: ['buyer_invoices', 'incoming_payments'],
  shipAgentChargesSaveConfirm: ['buyer_invoices', 'incoming_payments'],
  shipAgentChargesGmOverride: ['buyer_invoices', 'incoming_payments'],
  shipAgentChargesPostInvoiceResolve: ['buyer_invoices', 'incoming_payments'],
  shipAgentChargesSync: ['buyer_invoices', 'incoming_payments'],
  variableChargesList: ['buyer_invoices', 'incoming_payments'],
  variableChargesDetail: ['buyer_invoices', 'incoming_payments'],
  variableChargesOptions: ['buyer_invoices', 'incoming_payments'],
  variableChargesSupplierVerify: ['buyer_invoices', 'incoming_payments'],
  variableChargesBuyerConfirm: ['buyer_invoices', 'incoming_payments'],
  variableChargesGmOverride: ['buyer_invoices', 'incoming_payments'],
  variableChargesPostInvoiceResolve: ['buyer_invoices', 'incoming_payments'],
  variableChargesSync: ['buyer_invoices', 'incoming_payments'],
  buyerInvoicePostingReminderOverrideSave: ['incoming_payments'],
  buyerInvoiceEmailSettingsGet: ['buyer_invoices'],
  buyerInvoiceEmailSettingsSave: ['buyer_invoices'],
  buyerInvoiceReminderRulesList: ['buyer_invoices'],
  buyerInvoiceReminderRuleSave: ['buyer_invoices'],
  buyerInvoiceReminderRuleRemove: ['buyer_invoices'],
  buyerInvoicePaymentReminderPrepare: ['buyer_invoices'],
  buyerInvoicePaymentReminderSend: ['buyer_invoices'],
  outstandingBuyerInvoicesEmailReport: ['buyer_invoices'],
  outstandingBuyerInvoicesEmailCron: [],
  incomingPaymentsList: ['incoming_payments'],
  incomingPaymentEmailSettingsGet: ['incoming_payments'],
  incomingPaymentEmailSettingsSave: ['incoming_payments'],
  incomingPaymentInterestSettingsGet: ['incoming_payments'],
  incomingPaymentInterestSettingsSave: ['incoming_payments'],
  incomingPaymentEmailReport: ['incoming_payments'],
  incomingPaymentInterestInvoiceRequest: ['incoming_payments'],
  incomingPaymentSettingsGet: ['incoming_payments'],
  incomingPaymentSettingsSave: ['incoming_payments'],
  incomingPaymentAllocationConfirm: ['incoming_payments'],
  cashflowForecast: ['cashflow_forecast'],
  cashflowBuyerPaymentPerformance: ['cashflow_forecast'],
  cashflowSettingsGet: ['cashflow_forecast'],
  cashflowSettingsSave: ['cashflow_forecast'],
  cashflowHolidayCalendar: ['cashflow_forecast'],
  stemPnl: ['pnl'],
  salesforceBrokerRegister: ['brokers'],
  frankfurterUsdCnyRate: ['brokers'],
  brokerCommissionSettingsGet: ['brokers'],
  brokerCommissionSettingsSave: ['brokers'],
  reportExportCreate: ['brokers', 'report_archive'],
  reportExportsList: ['report_archive'],
  reportExportRename: ['report_archive'],
  reportExportDelete: ['report_archive'],
  reportExportDownload: ['report_archive'],
  buyersAdministratorList: ['buyers_administrator'],
  buyersAdministratorSave: ['buyers_administrator'],
  accountManagersList: ['buyers_administrator'],
  accountManagersSave: ['buyers_administrator'],
  accountManagersSaveNote: ['buyers_administrator'],
  accountManagersRetrySync: ['buyers_administrator'],
  accountPicDirectoryList: ['buyers_administrator'],
  accountPicAccountOptions: ['buyers_administrator'],
  accountPicTraderOptions: ['buyers_administrator'],
  accountPicDirectoryDetail: ['buyers_administrator'],
  accountPicDirectorySave: ['buyers_administrator'],
  accountPicDirectoryImport: ['buyers_administrator'],
  accountPicRowColorsSave: ['buyers_administrator'],
  emailSenderStatus: ['settings'],
  emailSenderMailboxSave: ['admin'],
  emailSenderRouteSave: ['admin'],
  systemHealth: [],
  dashboardAiSettingsGet: ['settings'],
  dashboardAiSettingsSave: ['settings'],
  dashboardAiSearch: ['dashboard'],
  backboneBridgeIdentity: ['settings'],
  backboneTradeProjection: ['dashboard', 'review', 'disputes', 'buyer_invoices', 'incoming_payments', 'cashflow_forecast', 'pnl', 'brokers'],
  backboneFinanceHandoffs: ['review'],
  backboneFinanceHandoffDetail: ['review'],
  salesforceSchema: ['admin'],
  salesforceObjectFields: ['admin'],
  salesforceFullSchema: ['admin'],
  dashboardFilterOptions: ['dashboard'],
  salesforceDescribeChildren: ['admin'],
  adminUsersList: ['admin'],
  adminAuditLogs: ['admin'],
  adminUserSave: ['admin'],
  adminPortalAccessSave: ['admin'],
  adminPortalAccessRetry: ['admin'],
  adminPortalApplicationsHealth: ['admin'],
  adminUserDelete: ['admin'],
  adminUserTypeSave: ['admin'],
  adminUserTypeDelete: ['admin'],
  adminFcosUpdatesList: ['admin'],
  adminFcosUpdatesSync: ['admin'],
  adminFcosUpdateItemSave: ['admin'],
  adminFcosUpdateBatchSave: ['admin'],
  adminFcosUpdateBatchCancel: ['admin'],
  adminFcosUpdateItemSkip: ['admin'],
  adminFcosUpdateItemRestore: ['admin'],
  adminFcosUpdateBatchSend: ['admin'],
  adminFcosUpdateDeliveryRetry: ['admin'],
  universalAuditTrail: ['admin'],
};

const HANDLER_POLICY_REGISTRY = buildHandlerPolicyRegistry(HANDLER_MODULE_ACCESS, AUTH_EXEMPT_HANDLERS);

async function userHasAnyModuleAccess(client, profile, moduleIds) {
  if (!moduleIds?.length) return true;
  if (isAdministratorUserType(profile?.user_type)) return true;

  const validModuleIds = moduleIds.filter((moduleId) => ADMIN_MODULE_IDS.has(moduleId));
  if (!validModuleIds.length) return false;

  if (profile?.use_type_defaults === false) {
    const { data, error } = await client.from('user_module_permissions').select('module_id,can_view').eq('user_id', profile.id).in('module_id', validModuleIds);
    if (error) throw error;
    return (data || []).some((row) => row.can_view === true);
  }

  const { data, error } = await client.from('user_type_module_permissions').select('module_id,can_view').eq('user_type_id', profile.user_type).in('module_id', validModuleIds);
  if (error) throw error;
  if ((data || []).length) return (data || []).some((row) => row.can_view === true);

  const fallback = FALLBACK_TYPE_PERMISSIONS[profile?.user_type] || {};
  return validModuleIds.some((moduleId) => fallback[moduleId] === true);
}

async function userHasCapability(client, profile, capabilityId) {
  if (!ADMIN_CAPABILITY_IDS.has(capabilityId)) return false;
  if (isAdministratorUserType(profile?.user_type)) return true;

  const { data: userPermission, error: userError } = await client.from('user_module_permissions').select('can_view').eq('user_id', profile?.id).eq('module_id', capabilityId).maybeSingle();
  if (userError) throw userError;
  if (userPermission) return userPermission.can_view === true;

  const { data: typePermission, error: typeError } = await client.from('user_type_module_permissions').select('can_view').eq('user_type_id', profile?.user_type).eq('module_id', capabilityId).maybeSingle();
  if (typeError) throw typeError;
  if (typePermission) return typePermission.can_view === true;

  return FALLBACK_TYPE_CAPABILITIES[profile?.user_type]?.[capabilityId] === true;
}

async function requireCapability(client, profile, capabilityId, message) {
  if (!(await userHasCapability(client, profile, capabilityId))) {
    throw appError(message || 'You do not have permission for this action.', 403);
  }
}

async function reportArchiveAccessForUser(client, profile) {
  if (isAdministratorUserType(profile?.user_type)) return 'full';
  if (profile?.use_type_defaults === false) {
    const { data, error } = await client.from('user_module_permissions').select('module_id,can_view').eq('user_id', profile.id).in('module_id', [REPORT_ARCHIVE_MODULE_ID, REPORT_ARCHIVE_MANAGE_MODULE_ID]);
    if (error) throw error;
    return reportArchiveAccessFromRows(data || []);
  }

  const { data, error } = await client.from('user_type_module_permissions').select('module_id,can_view').eq('user_type_id', profile?.user_type).in('module_id', [REPORT_ARCHIVE_MODULE_ID, REPORT_ARCHIVE_MANAGE_MODULE_ID]);
  if (error) throw error;

  const fallback = FALLBACK_TYPE_PERMISSIONS[profile?.user_type] || {};
  return reportArchiveAccessFromRows(data || [], fallback[REPORT_ARCHIVE_MODULE_ID]);
}

async function requireReportArchiveFullAccess(client, profile) {
  const accessLevel = await reportArchiveAccessForUser(client, profile);
  if (accessLevel !== 'full') {
    throw appError('Full Reports Archive access is required for this action.', 403);
  }
}

function isInterofficeAccess(accessContext) {
  return accessContext?.profile?.user_type === INTEROFFICE_USER_TYPE_ID;
}

function salesforceCacheAccessScope(accessContext) {
  return isInterofficeAccess(accessContext) ? 'interoffice' : 'standard';
}

function salesforceCacheApiIdentity() {
  let host = 'unknown-instance';
  try {
    host = new URL(getInstanceUrl()).hostname.toLowerCase();
  } catch {
    host = String(getInstanceUrl() || 'unknown-instance').toLowerCase();
  }
  return `${getApiVersion()}@${host}`;
}

function requestForcesRefresh(body = {}, req = null) {
  const header = req?.headers?.['x-fcos-cache-bypass'] || req?.headers?.['X-FCOS-Cache-Bypass'];
  return body?.force === true || body?.forceRefresh === true || body?.refresh === true || String(header || '') === '1';
}

async function cachedSalesforceValue({ namespace, ttlSeconds, payload, tags, body, req, accessContext, loader }) {
  const force = requestForcesRefresh(body, req);
  if (force) await expireRuntimeCacheTags([...(tags || []), 'salesforce:schema']);
  return getOrLoadRuntimeCache({
    namespace,
    version: '1',
    accessScope: salesforceCacheAccessScope(accessContext),
    apiVersion: salesforceCacheApiIdentity(),
    payload,
    ttlSeconds,
    tags,
    force,
    loader,
  });
}

function fieldNameSetFrom(input) {
  if (!input) return new Set();
  if (input instanceof Set) return input;
  return new Set(input.map((field) => (typeof field === 'string' ? field : field?.name)).filter(Boolean));
}

function combineWhereConditions(conditions = []) {
  return conditions
    .filter(Boolean)
    .map((condition) => `(${condition})`)
    .join(' AND ');
}

async function accountFieldNameSet() {
  const describe = await salesforceObjectFields({ objectName: 'Account' });
  return fieldNameSetFrom(describe.fields || []);
}

async function interofficeStemAccessCondition(accessContext, stemFields = null, accountFields = null, relationshipPrefix = '') {
  if (!isInterofficeAccess(accessContext)) return '';
  let stemFieldNames;
  let accountFieldNames;
  try {
    stemFieldNames = stemFields ? fieldNameSetFrom(stemFields) : fieldNameSetFrom((await salesforceObjectFields({ objectName: 'stem__c' })).fields || []);
    accountFieldNames = accountFields ? fieldNameSetFrom(accountFields) : await accountFieldNameSet();
  } catch {
    throw appError('Interoffice access validation is temporarily unavailable. No Salesforce records were returned.', 503, 'INTEROFFICE_SCHEMA_UNAVAILABLE', undefined, true);
  }
  if (!stemFieldNames.has('Account__c')) {
    throw appError('Interoffice access validation requires STEM__c.Account__c. No Salesforce records were returned.', 503, 'INTEROFFICE_STEM_ACCOUNT_SCHEMA', undefined, true);
  }
  const escapedGroup = escapeSoql(INTEROFFICE_EXCLUDED_BUYER_GROUP);
  const conditions = [];
  const accountRelationship = `${relationshipPrefix}Account__r`;
  if (accountFieldNames.has('Group_Name__c')) {
    conditions.push(`(${accountRelationship}.Group_Name__c = null OR ${accountRelationship}.Group_Name__c != '${escapedGroup}')`);
  }
  if (accountFieldNames.has('ParentId')) {
    conditions.push(`(${accountRelationship}.Parent.Name = null OR ${accountRelationship}.Parent.Name != '${escapedGroup}')`);
  }
  if (!conditions.length) {
    throw appError('Interoffice access validation requires Account Group or Parent metadata. No Salesforce records were returned.', 503, 'INTEROFFICE_ACCOUNT_GROUP_SCHEMA', undefined, true);
  }
  return combineWhereConditions(conditions);
}

async function requireInterofficeStemAccess(stemId, accessContext) {
  if (!isInterofficeAccess(accessContext)) return;
  if (!stemId) throw appError('A STEM is required for Interoffice access validation.', 400, 'INTEROFFICE_STEM_REQUIRED');
  const condition = await interofficeStemAccessCondition(accessContext);
  const rows = await queryRows(
    `
    SELECT Id
    FROM stem__c
    WHERE Id = '${escapeSoql(stemId)}' AND ${condition}
    LIMIT 1
  `,
    { limit: 1, softFail: true },
  );
  if (!rows.length) throw appError('This STEM is not available for Interoffice users.', 403);
}

async function requireHandlerAccess(name, req) {
  const policy = handlerPolicyFor(HANDLER_POLICY_REGISTRY, name);
  if (!policy) {
    throw appError('This FCOS operation has no access policy and is unavailable.', 500, 'HANDLER_ACCESS_POLICY_MISSING');
  }
  if (policy.authentication === 'cron') return null;
  const context = await requireActiveUser(req);
  const allowed = await userHasAnyModuleAccess(context.client, context.profile, policy.modules);
  if (!allowed) throw appError('You do not have access to this module.', 403);
  if (policy.capability) {
    await requireCapability(context.client, context.profile, policy.capability, 'You do not have permission to perform this FCOS operation.');
  }
  return context;
}

function unofficialCompensationServiceContext(accessContext) {
  return {
    client: accessContext.client,
    profile: accessContext.profile,
    interoffice: isInterofficeAccess(accessContext),
  };
}

async function unofficialCompensationList(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const workspace = await listUnofficialCompensation({
    force: requestForcesRefresh(body, req),
    interoffice: isInterofficeAccess(context),
  });
  return {
    ...workspace,
    permissions: {
      canChangeSalesforceStatus: canManageUnofficialCompensationStatus(context.profile.user_type),
    },
  };
}

async function unofficialCompensationOptions(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return unofficialCompensationOptionsService(body, { interoffice: isInterofficeAccess(context) });
}

async function unofficialCompensationClaimCreate(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return createUnofficialCompensationClaimService(body, unofficialCompensationServiceContext(context));
}

async function unofficialCompensationClaimGroupStatus(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  if (!canManageUnofficialCompensationStatus(context.profile.user_type)) {
    throw appError('Only Finance, an Administrator, or the General Manager can change Unofficial Compensation status in Salesforce.', 403);
  }
  return updateUnofficialCompensationClaimGroupStatusService(body, unofficialCompensationServiceContext(context));
}

async function unofficialCompensationRecoveryCreate(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return createUnofficialCompensationRecoveryService(body, unofficialCompensationServiceContext(context));
}

async function unofficialCompensationRecoveryDelete(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return deleteUnofficialCompensationRecoveryService(body, unofficialCompensationServiceContext(context));
}

const EXCEPTION_REVIEW_STATUSES = ['Open', 'Acknowledged', 'In Progress', 'Resolved', 'Dismissed'];
const EXCEPTION_REVIEW_DEPARTMENTS = ['Unassigned', 'Trading', 'Operations', 'Accounting', 'Management'];
const EXCEPTION_REVIEW_PRIORITIES = ['High', 'Medium', 'Low'];

function serializeExceptionReviewItem(row) {
  if (!row) return null;
  return {
    stemId: row.stem_id,
    status: row.status,
    department: row.department,
    ownerUserId: row.owner_user_id || null,
    ownerName: row.owner_name || '',
    priority: row.priority,
    dueDate: row.due_date || null,
    latestNote: row.latest_note || '',
    resolutionNote: row.resolution_note || '',
    lastEventAt: row.last_event_at || null,
    lastUpdatedByEmail: row.last_updated_by_email || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeExceptionReviewEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    stemId: row.stem_id,
    eventType: row.event_type,
    status: row.status || null,
    department: row.department || null,
    ownerName: row.owner_name || '',
    priority: row.priority || null,
    dueDate: row.due_date || null,
    note: row.note || '',
    actorEmail: row.actor_email || null,
    createdAt: row.created_at || null,
  };
}

async function exceptionReviewWorkflowList(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const { client } = context;
  const stemIds = [...new Set((Array.isArray(body.stemIds) ? body.stemIds : []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 500);
  await Promise.all(stemIds.map((stemId) => requireInterofficeStemAccess(stemId, context)));

  const [itemsResult, eventsResult, ownersResult] = await Promise.all([stemIds.length ? client.from('exception_review_items').select('*').in('stem_id', stemIds) : Promise.resolve({ data: [], error: null }), stemIds.length ? client.from('exception_review_events').select('*').in('stem_id', stemIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }), client.from('user_profiles').select('id,email,full_name,user_type').eq('active', true).order('full_name')]);
  if (itemsResult.error) throw itemsResult.error;
  if (eventsResult.error) throw eventsResult.error;
  if (ownersResult.error) throw ownersResult.error;

  const eventsByStem = {};
  for (const row of eventsResult.data || []) {
    if (!eventsByStem[row.stem_id]) eventsByStem[row.stem_id] = [];
    eventsByStem[row.stem_id].push(serializeExceptionReviewEvent(row));
  }
  const byStemId = Object.fromEntries(
    (itemsResult.data || []).map((row) => [
      row.stem_id,
      {
        ...serializeExceptionReviewItem(row),
        events: eventsByStem[row.stem_id] || [],
      },
    ]),
  );
  return {
    byStemId,
    ownerOptions: (ownersResult.data || []).map((owner) => ({
      id: owner.id,
      name: owner.full_name || owner.email,
      email: owner.email,
      userType: owner.user_type,
    })),
    statuses: EXCEPTION_REVIEW_STATUSES,
    departments: EXCEPTION_REVIEW_DEPARTMENTS,
    priorities: EXCEPTION_REVIEW_PRIORITIES,
  };
}

async function exceptionReviewWorkflowSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const { client, profile } = context;
  const stemId = String(body.stemId || '').trim();
  if (!stemId) throw appError('STEM is required.', 400);
  await requireInterofficeStemAccess(stemId, context);
  const status = EXCEPTION_REVIEW_STATUSES.includes(body.status) ? body.status : 'Open';
  const department = EXCEPTION_REVIEW_DEPARTMENTS.includes(body.department) ? body.department : 'Unassigned';
  const priority = EXCEPTION_REVIEW_PRIORITIES.includes(body.priority) ? body.priority : 'High';
  const ownerUserId = String(body.ownerUserId || '').trim() || null;
  let ownerName = '';
  if (ownerUserId) {
    const { data: owner, error: ownerError } = await client.from('user_profiles').select('id,email,full_name,active').eq('id', ownerUserId).eq('active', true).maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) throw appError('The selected owner is no longer active.', 400);
    ownerName = owner.full_name || owner.email;
  }
  const latestNote = String(body.latestNote || '').trim();
  const resolutionNote = String(body.resolutionNote || '').trim();
  if ((status === 'Resolved' || status === 'Dismissed') && !resolutionNote) {
    throw appError('A resolution note is required before resolving or dismissing an exception.', 400);
  }
  const { data, error } = await client.rpc('save_exception_review_item', {
    p_stem_id: stemId,
    p_updates: {
      status,
      department,
      owner_user_id: ownerUserId,
      owner_name: ownerName,
      priority,
      due_date: body.dueDate || null,
      latest_note: latestNote,
      resolution_note: resolutionNote,
    },
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_updated_at: body.expectedUpdatedAt || null,
  });
  if (error) {
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    throw error;
  }
  return {
    item: serializeExceptionReviewItem(data?.item),
    event: serializeExceptionReviewEvent(data?.event),
  };
}

async function sanitizeManagedUserPayload(client, body = {}) {
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const fullName = String(body.full_name || body.fullName || '').trim();
  const { userTypes, typePermissions, typeCapabilities } = await listAccessModel(client);
  const typeIds = new Set(userTypes.map((type) => type.id));
  const userType = typeIds.has(body.user_type) ? body.user_type : 'viewer';
  const active = body.active !== false;
  const password = String(body.password || '');
  const id = body.id ? String(body.id) : null;
  const useTypeDefaults = isAdministratorUserType(userType) ? true : body.use_type_defaults !== false;

  if (!email || !email.includes('@')) throw appError('Valid email is required.', 400);
  if (!id && password.length < 8) throw appError('Password must be at least 8 characters.', 400);
  if (id && password && password.length < 8) throw appError('New password must be at least 8 characters.', 400);

  return {
    id,
    email,
    full_name: fullName || email,
    user_type: userType,
    active,
    password,
    use_type_defaults: useTypeDefaults,
    permissions: useTypeDefaults ? normalizePermissions(userType, typePermissions[userType] || {}) : normalizePermissions(userType, body.permissions || {}),
    capabilities: useTypeDefaults ? normalizeCapabilities(userType, typeCapabilities[userType] || {}) : normalizeCapabilities(userType, body.capabilities || {}),
  };
}

async function findAuthUserByEmail(client, email) {
  const target = String(email || '').toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const found = (data?.users || []).find((user) => String(user.email || '').toLowerCase() === target);
    if (found) return found;
    if (!data?.users?.length || data.users.length < 1000) break;
  }
  return null;
}

async function writeAdminAudit(client, actor, action, targetUserId, targetEmail, metadata = {}) {
  const row = {
    actor_user_id: actor?.id || null,
    actor_email: actor?.email || null,
    action,
    target_user_id: targetUserId || null,
    target_email: targetEmail || null,
    metadata,
  };
  const { error } = await client.from('admin_audit_logs').insert(row);
  if (error) console.error('Failed to write admin audit log', error.message);
}

async function loadActiveGeneralManager(client) {
  const { data: roleRows, error: roleError } = await client
    .from('collaboration_roles')
    .select('user_id')
    .eq('role', 'general_manager')
    .eq('active', true)
    .limit(2);
  if (roleError) throw roleError;
  if ((roleRows || []).length !== 1) {
    throw appError('General Manager role validation failed. Exactly one active General Manager is required.', 503);
  }

  const { data: generalManager, error: profileError } = await client
    .from('user_profiles')
    .select('id,email,full_name,user_type,active')
    .eq('id', roleRows[0].user_id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!generalManager?.active || generalManager.user_type !== 'general_manager') {
    throw appError('General Manager role validation failed. The authority role and user type are inconsistent.', 503);
  }
  return generalManager;
}

async function assertAdministratorContinuity(client, { userId, nextActive = false, nextUserType = null, deleting = false }) {
  if (!userId) return;
  const { data: current, error: currentError } = await client.from('user_profiles').select('id,user_type,active').eq('id', userId).maybeSingle();
  if (currentError) throw currentError;
  const generalManager = await loadActiveGeneralManager(client);
  if (current?.id === generalManager.id && (deleting || !nextActive || nextUserType !== 'general_manager')) {
    throw appError('Transfer General Manager authority to another active user before changing or deleting the current General Manager.', 409);
  }
  if (!current?.active || !isAdministratorUserType(current.user_type)) return;
  if (!deleting && nextActive && isAdministratorUserType(nextUserType)) return;

  const { count, error: countError } = await client
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('active', true)
    .in('user_type', [...ADMINISTRATIVE_USER_TYPES])
    .neq('id', userId);
  if (countError) throw countError;
  if (!count) {
    throw appError('At least one active FCOS Administrator or General Manager is required.', 409);
  }
}

async function ensureReportArchiveManageModule(client) {
  const { error } = await client.from('app_modules').upsert(
    {
      id: REPORT_ARCHIVE_MANAGE_MODULE_ID,
      label: 'Reports Archive Management',
      path: '/report-archive',
      sort_order: 76,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

async function persistManagedUser(client, body, actor = null) {
  const payload = await sanitizeManagedUserPayload(client, body);
  const isUpdate = Boolean(payload.id);
  const generalManager = await loadActiveGeneralManager(client);
  let authUser = isUpdate ? { id: payload.id } : await findAuthUserByEmail(client, payload.email);
  let managedProfile = null;

  if (authUser?.id) {
    const { data, error } = await client
      .from('user_profiles')
      .select('id,email,full_name,user_type,active')
      .eq('id', authUser.id)
      .maybeSingle();
    if (error) throw error;
    managedProfile = data;
    await assertAdministratorContinuity(client, {
      userId: authUser.id,
      nextActive: payload.active,
      nextUserType: payload.user_type,
    });
  }

  const transferRequested = payload.user_type === 'general_manager'
    && authUser?.id !== generalManager.id;
  if (payload.user_type === 'general_manager' && !payload.active) {
    throw appError('The General Manager must remain an active user.', 400);
  }
  if (transferRequested && body.confirmGeneralManagerTransfer !== true) {
    throw appError(`Confirm the General Manager transfer from ${generalManager.full_name || generalManager.email}.`, 409);
  }

  const stagedUserType = transferRequested
    ? managedProfile?.user_type || 'viewer'
    : payload.user_type;

  if (authUser?.id) {
    const updatePayload = {
      email: payload.email,
      user_metadata: { full_name: payload.full_name },
      app_metadata: { user_type: stagedUserType },
    };
    if (payload.password) updatePayload.password = payload.password;
    const { data, error } = await client.auth.admin.updateUserById(authUser.id, updatePayload);
    if (error) throw error;
    authUser = data.user;
  } else {
    const { data, error } = await client.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: { full_name: payload.full_name },
      app_metadata: { user_type: stagedUserType },
    });
    if (error) throw error;
    authUser = data.user;
  }

  if (!authUser?.id) throw appError('Supabase did not return a user id.', 500);

  const nowIso = new Date().toISOString();
  const { error: profileError } = await client.from('user_profiles').upsert(
    {
      id: authUser.id,
      email: payload.email,
      full_name: payload.full_name,
      user_type: stagedUserType,
      active: payload.active,
      use_type_defaults: payload.use_type_defaults,
      updated_at: nowIso,
    },
    { onConflict: 'id' },
  );
  if (profileError) throw profileError;

  const { error: deletePermissionError } = await client.from('user_module_permissions').delete().eq('user_id', authUser.id);
  if (deletePermissionError) throw deletePermissionError;

  if (!payload.use_type_defaults) {
    await ensureReportArchiveManageModule(client);
    const permissionRows = ADMIN_APP_MODULES.map((module) => ({
      user_id: authUser.id,
      module_id: module.id,
      can_view: permissionCanView(module.id, payload.permissions[module.id]),
      updated_at: nowIso,
    }));
    permissionRows.push({
      user_id: authUser.id,
      module_id: REPORT_ARCHIVE_MANAGE_MODULE_ID,
      can_view: reportArchiveAccessLevel(payload.permissions[REPORT_ARCHIVE_MODULE_ID]) === 'full',
      updated_at: nowIso,
    });
    permissionRows.push(
      ...ADMIN_CAPABILITIES.map((capability) => ({
        user_id: authUser.id,
        module_id: capability.id,
        can_view: payload.capabilities[capability.id] === true,
        updated_at: nowIso,
      })),
    );
    const { error: insertPermissionError } = await client.from('user_module_permissions').insert(permissionRows);
    if (insertPermissionError) throw insertPermissionError;
  }

  let generalManagerTransfer = null;
  const authMetadataWarnings = [];
  if (payload.user_type === 'general_manager') {
    const { data, error } = await client.rpc('assign_general_manager_user_type', {
      p_target_user_id: authUser.id,
      p_actor_id: actor?.id || null,
      p_actor_email: actor?.email || null,
      p_confirm_transfer: body.confirmGeneralManagerTransfer === true,
    });
    if (error) {
      if (/confirm the general manager transfer/i.test(error.message || '')) {
        throw appError(error.message, 409);
      }
      throw error;
    }
    generalManagerTransfer = data || null;

    if (generalManagerTransfer?.transferred) {
      const metadataUpdates = [
        [authUser.id, 'general_manager'],
        [generalManagerTransfer.formerGeneralManagerUserId, 'administrator'],
      ];
      for (const [userId, userType] of metadataUpdates) {
        if (!userId) continue;
        const { error: metadataError } = await client.auth.admin.updateUserById(userId, {
          app_metadata: { user_type: userType },
        });
        if (metadataError) {
          authMetadataWarnings.push({ userId, message: metadataError.message });
        }
      }
    }
  }

  await writeAdminAudit(client, actor, isUpdate ? 'user_updated' : 'user_created', authUser.id, payload.email, {
    user_type: payload.user_type,
    active: payload.active,
    use_type_defaults: payload.use_type_defaults,
    modules: Object.entries(payload.permissions)
      .filter(([moduleId, value]) => permissionCanView(moduleId, value))
      .map(([moduleId]) => moduleId),
    access_levels: {
      [REPORT_ARCHIVE_MODULE_ID]: reportArchiveAccessLevel(payload.permissions[REPORT_ARCHIVE_MODULE_ID]),
    },
    capabilities: Object.entries(payload.capabilities)
      .filter(([, allowed]) => allowed)
      .map(([id]) => id),
  });

  return {
    id: authUser.id,
    email: payload.email,
    full_name: payload.full_name,
    user_type: payload.user_type,
    active: payload.active,
    use_type_defaults: payload.use_type_defaults,
    permissions: payload.permissions,
    capabilities: payload.capabilities,
    generalManagerTransfer,
    authMetadataWarnings,
  };
}

async function adminUsersList(body, req) {
  const { client } = await requireAdministrator(req);
  const { userTypes, typePermissions, typeCapabilities } = await listAccessModel(client);
  const { data: profiles, error: profileError } = await client.from('user_profiles').select('id,email,full_name,user_type,active,use_type_defaults,created_at,updated_at').order('created_at', { ascending: false });
  if (profileError) throw profileError;

  const userIds = (profiles || []).map((profile) => profile.id);
  let permissionRows = [];
  if (userIds.length) {
    const { data, error } = await client.from('user_module_permissions').select('user_id,module_id,can_view').in('user_id', userIds);
    if (error) throw error;
    permissionRows = data || [];
  }

  const permissionsByUser = {};
  const capabilitiesByUser = {};
  const manageRowsByUser = {};
  for (const row of permissionRows) {
    if (row.module_id === REPORT_ARCHIVE_MANAGE_MODULE_ID) {
      manageRowsByUser[row.user_id] = row.can_view === true;
      continue;
    }
    if (ADMIN_CAPABILITY_IDS.has(row.module_id)) {
      if (!capabilitiesByUser[row.user_id]) capabilitiesByUser[row.user_id] = {};
      capabilitiesByUser[row.user_id][row.module_id] = row.can_view === true;
      continue;
    }
    if (!ADMIN_MODULE_IDS.has(row.module_id)) continue;
    if (!permissionsByUser[row.user_id]) permissionsByUser[row.user_id] = {};
    permissionsByUser[row.user_id][row.module_id] = permissionValueFromRow(row);
  }
  for (const [userId, permissions] of Object.entries(permissionsByUser)) {
    if (permissions[REPORT_ARCHIVE_MODULE_ID] === true) {
      permissions[REPORT_ARCHIVE_MODULE_ID] = Object.prototype.hasOwnProperty.call(manageRowsByUser, userId) ? (manageRowsByUser[userId] ? 'full' : 'read') : 'full';
    }
  }

  const users = (profiles || []).map((profile) => ({
    ...profile,
    type_label: userTypes.find((type) => type.id === profile.user_type)?.label || profile.user_type,
    use_type_defaults: isAdministratorUserType(profile.user_type) ? true : profile.use_type_defaults !== false,
    permissions: isAdministratorUserType(profile.user_type) ? ADMIN_FULL_ACCESS : profile.use_type_defaults !== false ? normalizePermissions(profile.user_type, typePermissions[profile.user_type] || {}) : normalizePermissions(profile.user_type, permissionsByUser[profile.id] || {}),
    capabilities: isAdministratorUserType(profile.user_type) ? ADMIN_FULL_CAPABILITIES : profile.use_type_defaults !== false ? normalizeCapabilities(profile.user_type, typeCapabilities[profile.user_type] || {}) : normalizeCapabilities(profile.user_type, capabilitiesByUser[profile.id] || {}),
  }));
  const generalManager = await loadActiveGeneralManager(client);
  const portal = await portalAdminModel({ client, profiles: profiles || [] });
  for (const user of users) {
    user.applicationAccess = portal.accessByUser[user.id] || {};
  }
  return {
    users,
    modules: ADMIN_APP_MODULES,
    capabilities: ADMIN_CAPABILITIES,
    userTypes,
    typePermissions,
    typeCapabilities,
    portalApplications: portal.applications,
    generalManager: {
      userId: generalManager.id,
      name: generalManager.full_name || generalManager.email,
      email: generalManager.email,
    },
  };
}

async function adminAuditLogs(body, req) {
  const { client } = await requireAdministrator(req);
  const limit = Math.max(10, Math.min(Number(body.limit) || 100, 500));
  const { data, error } = await client.from('admin_audit_logs').select('id,created_at,actor_user_id,actor_email,action,target_user_id,target_email,metadata').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return { logs: data || [] };
}

async function adminFcosUpdatesList(body, req) {
  const { client, profile } = await requireAdministrator(req);
  return listFcosUpdatesService({
    client,
    profile,
    sync: body.sync !== false,
    includePreparation: body.includePreparation !== false,
  });
}

async function adminFcosUpdatesSync(body, req) {
  const { client, profile } = await requireAdministrator(req);
  const sync = await syncFcosUpdateItemsService({ client, profile });
  return {
    sync,
    ...(await listFcosUpdatesService({ client, profile, sync: false })),
  };
}

async function adminFcosUpdateItemSave(body, req) {
  const { client, profile } = await requireAdministrator(req);
  return saveFcosUpdateItemService({ client, profile, body });
}

async function adminFcosUpdateBatchSave(body, req) {
  const { client, profile } = await requireAdministrator(req);
  return saveFcosUpdateBatchService({ client, profile, body });
}

async function adminFcosUpdateBatchCancel(body, req) {
  const { client, profile } = await requireAdministrator(req);
  return cancelFcosUpdateBatchService({ client, profile, body });
}

async function adminFcosUpdateItemSkip(body, req) {
  const { client, profile } = await requireAdministrator(req);
  return skipFcosUpdateItemService({ client, profile, body });
}

async function adminFcosUpdateItemRestore(body, req) {
  const { client, profile } = await requireAdministrator(req);
  return restoreFcosUpdateItemService({ client, profile, body });
}

async function adminFcosUpdateBatchSend(body, req) {
  const { client, profile } = await requireAdministrator(req);
  return sendFcosUpdateBatchService({ client, profile, body });
}

async function adminFcosUpdateDeliveryRetry(body, req) {
  const { client, profile } = await requireAdministrator(req);
  return retryFcosUpdateDeliveriesService({ client, profile, body });
}

function auditTableUnavailable(error) {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /does not exist|could not find the table/i.test(error?.message || '');
}

async function safeAuditRows(promise, mapper) {
  const { data, error } = await promise;
  if (error) {
    if (auditTableUnavailable(error)) return [];
    throw error;
  }
  return (data || []).map(mapper);
}

function compactAuditSummary(parts = []) {
  return (
    parts
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' Â· ') || 'â€”'
  );
}

function normalizedAuditAction(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function universalAuditTrail(body, req) {
  const { client } = await requireAdministrator(req);
  const limit = Math.max(25, Math.min(Number(body.limit) || 300, 1000));
  const sourceFilter = String(body.source || 'all').trim();
  const keyword = String(body.keyword || '')
    .trim()
    .toLowerCase();
  const queryLimit = Math.max(100, Math.min(limit, 1000));

  const [adminRows, collaborationRows, improvementRows, portalRows, collectionRows, reportRows, interestRows, disputeRows, internalEmailRows, fcosUpdateRows, growthRows, compensationRows, specialTermsRows, hedgeRows, emailSenderRows, emailRouterRows, workspacePreferenceRows, brokerSettingRows, shipAgentRows, connectionRows] = await Promise.all([
    safeAuditRows(client.from('admin_audit_logs').select('id,created_at,actor_email,action,target_user_id,target_email,metadata').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `admin:${row.id}`,
      source: 'Admin Control',
      module: 'Admin',
      action: normalizedAuditAction(row.action),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.target_email || row.target_user_id || 'â€”',
      summary: compactAuditSummary([row.target_email || row.target_user_id, row.metadata?.user_type, row.metadata?.type_id]),
      metadata: row.metadata || {},
    })),
    safeAuditRows(client.from('collaboration_events').select('id,item_id,event_type,summary,metadata,actor_email,created_at,collaboration_items(item_key,title)').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `collaboration:${row.id}`,
      source: 'Projects & Tasks',
      module: 'Projects & Tasks',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.collaboration_items?.item_key || row.item_id || 'â€”',
      summary: compactAuditSummary([row.collaboration_items?.title, row.summary, row.metadata?.status]),
      metadata: row.metadata || {},
    })),
    safeAuditRows(client.from('fcos_improvement_events').select('id,ticket_id,event_type,summary,metadata,actor_email,created_at,fcos_improvement_tickets(ticket_key)').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `fcos-improvement:${row.id}`,
      source: 'FCOS Improvements',
      module: 'FCOS Improvements',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.fcos_improvement_tickets?.ticket_key || row.ticket_id || 'â€”',
      summary: row.summary || 'FCOS Improvement workflow event.',
      metadata: {
        changeType: row.metadata?.changeType || null,
        hasProposal: Boolean(row.metadata?.changeType),
        hasAttachment: row.event_type === 'attachment_added' || row.event_type === 'attachment_removed',
      },
    })),
    safeAuditRows(client.from('portal_access_events').select('id,application_id,target_user_id,actor_email,action,outcome,request_id,metadata,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `portal:${row.id}`,
      source: 'Application Portal',
      module: 'Admin',
      action: normalizedAuditAction(row.action),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.application_id || row.target_user_id || 'â€”',
      summary: compactAuditSummary([row.application_id, row.outcome, row.metadata?.reason, row.metadata?.role]),
      metadata: {
        ...(row.metadata || {}),
        outcome: row.outcome,
        requestId: row.request_id,
        targetUserId: row.target_user_id,
      },
    })),
    safeAuditRows(client.from('buyer_invoice_collection_events').select('id,stem_id,event_type,status,owner_name,note,next_follow_up_date,promised_payment_date,promised_amount,actor_email,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `collection:${row.id}`,
      source: 'Buyer Invoice Collection',
      module: 'Outstanding Buyer Invoices',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.stem_id || 'â€”',
      summary: compactAuditSummary([row.status, row.owner_name, row.note, row.next_follow_up_date, row.promised_payment_date]),
      metadata: {
        status: row.status,
        ownerName: row.owner_name,
        note: row.note,
        nextFollowUpDate: row.next_follow_up_date,
        promisedPaymentDate: row.promised_payment_date,
        promisedAmount: row.promised_amount,
      },
    })),
    safeAuditRows(client.from('report_export_events').select('id,report_export_id,event_type,actor_email,previous_file_name,new_file_name,metadata,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `report:${row.id}`,
      source: 'Reports Archive',
      module: 'Reports Archive',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.new_file_name || row.previous_file_name || row.report_export_id || 'â€”',
      summary: compactAuditSummary([row.previous_file_name, row.new_file_name, row.metadata?.reportType || row.metadata?.report_type]),
      metadata: row.metadata || {},
    })),
    safeAuditRows(client.from('incoming_payment_interest_notifications').select('id,payment_id,payment_name,stem_id,stem_name,buyer_name,buyer_group_name,delay_days,amount,currency,recipient_email,email_subject,actor_email,actor_name,metadata,sent_at,created_at').order('sent_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `interest:${row.id}`,
      source: 'Late Payment Interest',
      module: 'Incoming Payment',
      action: row.metadata?.resent === true ? 'Interest Request Resent' : 'Interest Request Sent',
      createdAt: row.sent_at || row.created_at,
      actor: row.actor_email || row.actor_name || 'System',
      target: row.stem_name || row.stem_id || row.payment_name || row.payment_id || 'â€”',
      summary: compactAuditSummary([row.buyer_name, row.recipient_email, row.delay_days != null ? `${row.delay_days} delay days` : '', row.email_subject]),
      metadata: row.metadata || {},
    })),
    safeAuditRows(client.from('dispute_beta_events').select('id,stem_id,event_type,note,metadata,actor_email,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `dispute:${row.id}`,
      source: 'Dispute Workflow',
      module: 'Dispute Workflow',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.stem_id || 'â€”',
      summary: compactAuditSummary([row.note, row.metadata?.workflowStatus, row.metadata?.approvalStatus]),
      metadata: row.metadata || {},
    })),
    safeAuditRows(client.from('buyer_invoice_email_runs').select('id,run_key,schedule_time,status,rows_count,totals,error,provider_result,created_at,completed_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `internal-email:${row.id}`,
      source: 'Internal Daily Report',
      module: 'Outstanding Buyer Invoices',
      action: normalizedAuditAction(row.status),
      createdAt: row.completed_at || row.created_at,
      actor: 'System',
      target: row.run_key || row.schedule_time || 'â€”',
      summary: compactAuditSummary([row.schedule_time, row.rows_count != null ? `${row.rows_count} rows` : '', row.error]),
      metadata: {
        totals: row.totals || {},
        providerResult: row.provider_result || {},
      },
    })),
    safeAuditRows(client.from('fcos_update_events').select('id,item_id,batch_id,delivery_id,event_type,actor_email,summary,metadata,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `fcos-update:${row.id}`,
      source: 'FCOS Updates',
      module: 'Admin Control',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.metadata?.version || row.summary || 'FCOS update',
      summary: row.summary || 'FCOS update email workflow event.',
      metadata: {
        ...(row.metadata || {}),
        hasItem: Boolean(row.item_id),
        hasBatch: Boolean(row.batch_id),
        hasDelivery: Boolean(row.delivery_id),
      },
    })),
    safeAuditRows(client.from('growth_events').select('id,subject_type,subject_id,event_type,actor_email,target_user_id,summary,metadata,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `growth:${row.id}`,
      source: 'Growth & Coaching',
      module: 'Growth & Coaching',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.subject_type || 'Growth & Coaching',
      summary: row.summary || 'Growth & Coaching workflow event.',
      metadata: {
        ...(row.metadata || {}),
        subjectType: row.subject_type,
        hasSubject: Boolean(row.subject_id),
        hasTargetUser: Boolean(row.target_user_id),
      },
    })),
    safeAuditRows(client.from('unofficial_compensation_operations').select('id,operation_type,operation_status,salesforce_object,error_code,actor_email,created_at,completed_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `unofficial-compensation:${row.id}`,
      source: 'Unofficial Compensation',
      module: 'Unofficial Compensation',
      action: normalizedAuditAction(row.operation_type),
      createdAt: row.completed_at || row.created_at,
      actor: row.actor_email || 'System',
      target: row.salesforce_object || 'Compensation workflow',
      summary: compactAuditSummary([normalizedAuditAction(row.operation_status), row.salesforce_object, row.error_code]),
      metadata: {
        status: row.operation_status,
        salesforceObject: row.salesforce_object,
        errorCode: row.error_code,
      },
    })),
    safeAuditRows(client.from('special_terms_operations').select('id,operation_type,operation_status,salesforce_object,error_code,actor_email,created_at,completed_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `special-terms:${row.id}`,
      source: 'Special Terms',
      module: 'Special Terms',
      action: normalizedAuditAction(row.operation_type),
      createdAt: row.completed_at || row.created_at,
      actor: row.actor_email || 'System',
      target: row.salesforce_object || 'Special Terms',
      summary: compactAuditSummary([normalizedAuditAction(row.operation_status), row.salesforce_object, row.error_code]),
      metadata: {
        status: row.operation_status,
        salesforceObject: row.salesforce_object,
        errorCode: row.error_code,
      },
    })),
    safeAuditRows(client.from('hedge_events').select('id,event_type,entity_type,entity_legacy_id,label,metadata,actor_email,source,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `hedge:${row.id}`,
      source: 'Hedge Desk',
      module: 'Hedge Desk',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.label || row.entity_type || 'Hedge Desk',
      summary: compactAuditSummary([row.label, row.entity_type, row.source === 'fc-hedge-desk' ? 'Migrated history' : 'FCOS']),
      metadata: {
        eventSource: row.source,
        entityType: row.entity_type,
        hasLegacyReference: Boolean(row.entity_legacy_id),
        ...(row.metadata || {}),
      },
    })),
    safeAuditRows(client.from('email_sender_events').select('id,event_type,purpose_key,reason,metadata,actor_email,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `email-sender:${row.id}`,
      source: 'Email Senders',
      module: 'Settings',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.purpose_key || 'Microsoft Graph mailbox registry',
      summary: compactAuditSummary([normalizedAuditAction(row.purpose_key), row.reason]),
      metadata: row.metadata || {},
    })),
    safeAuditRows(client.schema('emailrouter').from('events').select('id,event_type,entity_type,entity_id,actor_user_id,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `email-router:${row.id}`,
      source: 'Email Router',
      module: 'Email Router',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_user_id ? 'FCOS user' : 'System',
      target: row.entity_type || 'Email Router',
      summary: compactAuditSummary([normalizedAuditAction(row.entity_type), normalizedAuditAction(row.event_type)]),
      metadata: {
        entityType: row.entity_type,
        hasEntityReference: Boolean(row.entity_id),
      },
    })),
    safeAuditRows(client.from('workspace_preference_events').select('id,user_id,actor_user_id,event_type,changed_fields,resulting_revision,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `workspace-preference:${row.id}`,
      source: 'My Settings',
      module: 'Settings',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_user_id ? 'FCOS user' : 'System',
      target: 'Personal workspace preferences',
      summary: compactAuditSummary([(row.changed_fields || []).map(normalizedAuditAction).join(', '), `Revision ${row.resulting_revision}`]),
      metadata: { changedFields: row.changed_fields || [], revision: row.resulting_revision },
    })),
    safeAuditRows(client.from('broker_commission_setting_events').select('id,actor_user_id,previous_provider,next_provider,resulting_revision,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `broker-setting:${row.id}`,
      source: 'Broker Commission Configuration',
      module: 'Broker Commissions',
      action: 'Exchange Rate Provider Changed',
      createdAt: row.created_at,
      actor: row.actor_user_id ? 'FCOS user' : 'System',
      target: 'Company exchange-rate provider',
      summary: compactAuditSummary([row.previous_provider, row.next_provider, `Revision ${row.resulting_revision}`]),
      metadata: { previousProvider: row.previous_provider, nextProvider: row.next_provider, revision: row.resulting_revision },
    })),
    safeAuditRows(client.from('variable_charge_events').select('id,event_type,summary,metadata,actor_email,created_at,variable_charge_cases(stem_id,stem_name)').order('created_at', { ascending: false }).limit(queryLimit), (row) => ({
      id: `ship-agent-charge:${row.id}`,
      source: 'Variable Charges',
      module: 'Payment Collections',
      action: normalizedAuditAction(row.event_type),
      createdAt: row.created_at,
      actor: row.actor_email || 'System',
      target: row.variable_charge_cases?.stem_name || row.variable_charge_cases?.stem_id || 'Variable Charges case',
      summary: row.summary || 'Variable Charges workflow event.',
      metadata: {
        caseState: row.metadata?.caseState || null,
        previousState: row.metadata?.previousState || null,
        sourceChanged: row.metadata?.sourceChanged === true,
        assignmentChanged: row.metadata?.assignmentChanged === true,
        chargeToBuyer: row.metadata?.chargeToBuyer === true,
        evidencePresent: row.metadata?.evidencePresent === true,
        reasonProvided: row.metadata?.reasonProvided === true,
        resolution: row.metadata?.resolution || null,
      },
    })),
    safeAuditRows(client.from('connection_attestations').select('id,profile,revision,schema_version,policy_version,key_id,verified_at,expires_at,duration_ms,providers,created_at').order('created_at', { ascending: false }).limit(queryLimit), (row) => {
      const attestation = connectionAttestationFromRow(row);
      const state = connectionAttestationState(attestation, row.created_at);
      return {
        id: `connection-attestation:${row.id}`,
        source: 'System Connections',
        module: 'System Health',
        action: 'Connection Attestation Published',
        createdAt: row.created_at,
        actor: 'FCOS workstation',
        target: row.profile,
        summary: compactAuditSummary([`${state.verifiedCount}/4 providers verified`, state.warningCount ? `${state.warningCount} warnings` : 'No warnings', `Policy ${row.policy_version}`]),
        metadata: {
          revision: row.revision,
          policyVersion: row.policy_version,
          keyId: row.key_id,
          durationMs: row.duration_ms,
          verifiedCount: state.verifiedCount,
          warningCount: state.warningCount,
          providerStates: Object.fromEntries(Object.entries(attestation?.providers || {}).map(([provider, report]) => [provider, {
            identityStatus: report.identityStatus,
            targetPin: report.targetPin,
            permissionStatus: report.permissionStatus,
            cliVersionStatus: report.cliVersionStatus,
            credentialLifecycle: report.credentialLifecycle,
            warningCodes: report.warningCodes,
          }])),
        },
      };
    }),
  ]);

  let rows = [...adminRows, ...portalRows, ...collaborationRows, ...improvementRows, ...collectionRows, ...reportRows, ...interestRows, ...disputeRows, ...internalEmailRows, ...fcosUpdateRows, ...growthRows, ...compensationRows, ...specialTermsRows, ...hedgeRows, ...emailSenderRows, ...emailRouterRows, ...workspacePreferenceRows, ...brokerSettingRows, ...shipAgentRows, ...connectionRows].filter((row) => row.createdAt);

  if (sourceFilter && sourceFilter !== 'all') rows = rows.filter((row) => row.source === sourceFilter);
  if (keyword) {
    rows = rows.filter((row) => [row.source, row.module, row.action, row.actor, row.target, row.summary, JSON.stringify(row.metadata || {})].join(' ').toLowerCase().includes(keyword));
  }

  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const sources = [...new Set(rows.map((row) => row.source))].sort((a, b) => a.localeCompare(b));
  return { rows: rows.slice(0, limit), sources, total: rows.length };
}

async function adminUserSave(body, req) {
  const { client, profile } = await requireAdministrator(req);
  const user = await persistManagedUser(client, body, profile);
  const entitlements = await reconcilePortalEntitlementsForProfile(client, user, profile, { forceRevision: true });
  const portalSyncErrors = [];
  for (const entitlement of entitlements.filter((row) => row.sync_status === 'pending' || row.sync_status === 'error')) {
    try {
      await syncPortalEntitlement({
        client,
        entitlementId: entitlement.id,
        requestId: activePortalRequestId(),
      });
    } catch (error) {
      portalSyncErrors.push({
        applicationId: entitlement.application_id,
        message: 'External application access synchronization needs attention.',
      });
    }
  }
  let emailRouterDirectorySyncError = null;
  const directorySync = await client.rpc('sync_emailrouter_fcos_destinations', { p_actor: profile.id });
  if (directorySync.error) emailRouterDirectorySyncError = 'The user was saved, but Email Router directory synchronization needs to be retried.';
  return { user, portalSyncErrors, emailRouterDirectorySyncError };
}

async function adminUserDelete(body, req) {
  const { client, authUser, profile } = await requireAdministrator(req);
  const userId = String(body.id || '');
  if (!userId) throw appError('User id is required.', 400);
  if (userId === authUser.id) throw appError('You cannot delete your own administrator account.', 400);

  const { data: target, error: targetError } = await client.from('user_profiles').select('id,email,full_name,user_type,active').eq('id', userId).maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw appError('User not found.', 404);
  await assertAdministratorContinuity(client, {
    userId: target.id,
    deleting: true,
  });

  await preparePortalUserDeletion({
    client,
    profile: target,
    actor: profile,
    requestId: activePortalRequestId(),
  });

  const { error: deleteError } = await client.auth.admin.deleteUser(userId);
  if (deleteError) throw deleteError;

  await writeAdminAudit(client, profile, 'user_deleted', target.id, target.email, {
    user_type: target.user_type,
  });
  const directorySync = await client.rpc('sync_emailrouter_fcos_destinations', { p_actor: profile.id });
  return {
    deleted: true,
    id: userId,
    emailRouterDirectorySyncError: directorySync.error
      ? 'The user was deleted, but Email Router directory synchronization needs to be retried.'
      : null,
  };
}

async function adminPortalAccessSave(body, req) {
  const { client, profile } = await requireAdministrator(req);
  return savePortalExplicitAccess({
    client,
    actor: profile,
    userId: String(body.userId || '').trim(),
    applicationId: String(body.applicationId || '').trim(),
    enabled: body.enabled === true,
    roleId: String(body.roleId || '').trim() || null,
    expectedRevision: Number(body.expectedRevision || 0),
    reason: body.reason,
    requestId: activePortalRequestId(),
  });
}

async function adminPortalAccessRetry(body, req) {
  const { client } = await requireAdministrator(req);
  const entitlementId = String(body.entitlementId || '').trim();
  if (!entitlementId) throw appError('Application entitlement is required.', 400);
  const entitlement = await retryPortalAccessSync({
    client,
    entitlementId,
    requestId: activePortalRequestId(),
  });
  return { entitlement };
}

async function adminPortalApplicationsHealth(body, req) {
  const { client } = await requireAdministrator(req);
  const applications = await checkPortalApplicationsHealth({
    client,
    requestId: activePortalRequestId(),
  });
  return { applications };
}

async function adminUserTypeSave(body, req) {
  const { client, profile } = await requireAdministrator(req);
  const existingId = body.id ? String(body.id) : null;
  let label = String(body.label || '').trim();
  const id = slugifyUserTypeId(existingId || label);
  if (!id) throw appError('User type name is required.', 400);
  if (!label) throw appError('User type label is required.', 400);

  const protectedType = {
    administrator: {
      label: 'Administrator',
      description: 'Full system administration access.',
      sortOrder: 10,
    },
    general_manager: {
      label: 'General Manager',
      description: 'Full administration access and the single reporting-hierarchy root.',
      sortOrder: 5,
    },
  }[id];
  if (protectedType) label = protectedType.label;

  const { data: existing, error: existingError } = await client.from('user_types').select('id,is_system,sort_order').eq('id', id).maybeSingle();
  if (existingError) throw existingError;

  const sortOrder = protectedType?.sortOrder
    ?? (Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : (existing?.sort_order ?? 100));
  const userType = {
    id,
    label,
    description: protectedType?.description || String(body.description || '').trim(),
    is_system: protectedType ? true : existing?.is_system === true,
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  };
  const { error: typeError } = await client.from('user_types').upsert(userType, { onConflict: 'id' });
  if (typeError) throw typeError;

  const permissions = normalizeUserTypePermissions(id, body.permissions || {});
  const capabilities = normalizeCapabilities(id, body.capabilities || {});
  await ensureReportArchiveManageModule(client);
  const { error: deletePermissionError } = await client.from('user_type_module_permissions').delete().eq('user_type_id', id);
  if (deletePermissionError) throw deletePermissionError;
  const { error: insertPermissionError } = await client.from('user_type_module_permissions').insert([
    ...ADMIN_APP_MODULES.map((module) => ({
      user_type_id: id,
      module_id: module.id,
      can_view: permissionCanView(module.id, permissions[module.id]),
      updated_at: new Date().toISOString(),
    })),
    {
      user_type_id: id,
      module_id: REPORT_ARCHIVE_MANAGE_MODULE_ID,
      can_view: reportArchiveAccessLevel(permissions[REPORT_ARCHIVE_MODULE_ID]) === 'full',
      updated_at: new Date().toISOString(),
    },
    ...ADMIN_CAPABILITIES.map((capability) => ({
      user_type_id: id,
      module_id: capability.id,
      can_view: capabilities[capability.id] === true,
      updated_at: new Date().toISOString(),
    })),
  ]);
  if (insertPermissionError) throw insertPermissionError;

  await writeAdminAudit(client, profile, existing ? 'user_type_updated' : 'user_type_created', null, id, {
    label,
    modules: Object.entries(permissions)
      .filter(([moduleId, value]) => permissionCanView(moduleId, value))
      .map(([moduleId]) => moduleId),
    access_levels: {
      [REPORT_ARCHIVE_MODULE_ID]: reportArchiveAccessLevel(permissions[REPORT_ARCHIVE_MODULE_ID]),
    },
    capabilities: Object.entries(capabilities)
      .filter(([, allowed]) => allowed)
      .map(([capabilityId]) => capabilityId),
  });

  return { userType: { ...userType, permissions, capabilities } };
}

async function adminUserTypeDelete(body, req) {
  const { client, profile } = await requireAdministrator(req);
  const id = String(body.id || '').trim();
  if (!id) throw appError('User type id is required.', 400);
  if (isAdministratorUserType(id)) throw appError('Administrator and General Manager user types cannot be deleted.', 400);

  const { data: userType, error: typeError } = await client.from('user_types').select('id,label,is_system').eq('id', id).maybeSingle();
  if (typeError) throw typeError;
  if (!userType) throw appError('User type not found.', 404);

  const { count, error: assignedError } = await client.from('user_profiles').select('id', { count: 'exact', head: true }).eq('user_type', id);
  if (assignedError) throw assignedError;
  if (count > 0) throw appError('This user type is assigned to users. Reassign those users before deleting it.', 400);

  const { error: deleteError } = await client.from('user_types').delete().eq('id', id);
  if (deleteError) throw deleteError;

  await writeAdminAudit(client, profile, 'user_type_deleted', null, id, {
    label: userType.label,
  });
  return { deleted: true, id };
}

function accountManagerStorageError(error) {
  const message = String(error?.message || '');
  if (error?.code === '42P01' || error?.code === 'PGRST205' || /account_manager_(?:groups|assignments|notes).*does not exist/i.test(message)) {
    return appError('Account Manager storage is not ready. Apply the latest Supabase migration and try again.', 503);
  }
  if (error?.code === 'PGRST202' || (/(?:save|finalize)_account_manager/i.test(message) && /schema cache|could not find/i.test(message))) {
    return appError('Account Manager storage is not ready. Refresh the Supabase schema cache after applying the latest migration.', 503);
  }
  return error;
}

function accountManagerProfile(profile = {}) {
  return {
    id: profile.id,
    fullName: profile.full_name || profile.email || 'Unknown user',
    email: profile.email || '',
    userType: profile.user_type || '',
    active: profile.active === true,
  };
}

const ACCOUNT_MANAGER_ACCOUNT_FIELDS = ['Id', 'Name', 'Company_Code__c', 'RecordType.Name', 'ParentId', 'Parent.Name', 'Parent.Company_Code__c', 'Buyer_Payment_Term__c', 'Supplier_Payment_Term__c', 'Is_Broker__c', 'Inactive_Suspended__c', 'Account_Manager__c'];

async function accountManagerSchema() {
  const describe = await salesforceObjectFields({ objectName: 'Account' });
  const fieldsByName = new Map((describe.fields || []).map((field) => [field.name, field]));
  const requiredFields = [
    ['ParentId', 'reference'],
    ['Company_Code__c', 'string'],
    ['Buyer_Payment_Term__c', null],
    ['Supplier_Payment_Term__c', null],
    ['Is_Broker__c', 'boolean'],
    ['Inactive_Suspended__c', 'boolean'],
    ['Account_Manager__c', 'string'],
  ];

  for (const [fieldName, expectedType] of requiredFields) {
    const field = fieldsByName.get(fieldName);
    if (!field || (expectedType && field.type !== expectedType)) {
      throw appError(`Salesforce Account.${fieldName} is missing or has an incompatible type. Account Managers is unavailable until the schema is corrected.`, 503);
    }
  }

  const parentField = fieldsByName.get('ParentId');
  if (!parentField.referenceTo?.includes('Account')) {
    throw appError('Salesforce Account.ParentId is not an Account lookup. Account Managers is unavailable until the schema is corrected.', 503);
  }

  const managerField = fieldsByName.get('Account_Manager__c');
  if (managerField.updateable !== true) {
    throw appError('Salesforce Account.Account_Manager__c is not writable. Account Managers is unavailable until field access is corrected.', 503);
  }
  if (Number(managerField.length || 0) < 255) {
    throw appError(`Salesforce Account.Account_Manager__c supports only ${Number(managerField.length || 0)} characters. Increase it to 255 before using Account Managers.`, 503);
  }

  return { managerFieldLength: Number(managerField.length || 0) };
}

function accountManagerResponse({ salesforceGroup, groupRow = {}, managers = [] }) {
  const status = groupRow.salesforce_sync_status || 'synced';
  return {
    accountNameKey: salesforceGroup.accountNameKey,
    accountName: salesforceGroup.accountName,
    clKeys: salesforceGroup.clKeys || [],
    roles: salesforceGroup.roles,
    salesforceAccountCount: (salesforceGroup.directSalesforceAccountIds || salesforceGroup.salesforceAccountIds).length,
    isGroupAccount: salesforceGroup.isGroupAccount === true,
    parentAccounts: salesforceGroup.parentAccounts || [],
    parentGroupNames: salesforceGroup.parentGroupNames || [],
    childAccountCount: Number(salesforceGroup.childAccountCount || 0),
    childAccountNames: salesforceGroup.childAccountNames || [],
    propagateToChildren: salesforceGroup.isGroupAccount === true && groupRow.propagate_to_children === true,
    managers,
    managerCount: managers.length,
    assignmentSource: 'direct',
    inheritedFromGroupName: '',
    revision: Number(groupRow.revision || 0),
    updatedAt: groupRow.updated_at || null,
    updatedByEmail: groupRow.updated_by_email || null,
    salesforceSyncStatus: status,
    salesforceSyncError: groupRow.salesforce_sync_error || null,
    salesforceSyncedAt: groupRow.salesforce_synced_at || null,
    salesforceActive: true,
    buyerAccountKey: salesforceGroup.accountNameKey,
    buyerAccountId: salesforceGroup.salesforceAccountIds[0],
    buyerName: salesforceGroup.accountName,
    traders: managers,
    traderCount: managers.length,
  };
}

async function currentEligibleAccountGroup(body = {}, { includeGroupChildren = true, enforceSalesforceWriteLimit = true } = {}) {
  await accountManagerSchema();
  let requestedName = String(body.accountName || body.buyerName || '').trim();
  const legacyAccountId = String(body.buyerAccountId || '').trim();

  if (!requestedName && legacyAccountId) {
    const legacyRows = await queryRows(
      `
      SELECT Id, Name
      FROM Account
      WHERE Id = '${escapeSoql(legacyAccountId)}'
      LIMIT 1
    `,
      { limit: 1 },
    );
    requestedName = String(legacyRows[0]?.Name || '').trim();
  }
  if (!requestedName) throw appError('Account name is required.', 400);

  const rows = await queryRows(
    `
    SELECT ${ACCOUNT_MANAGER_ACCOUNT_FIELDS.join(', ')}
    FROM Account
    WHERE Name = '${escapeSoql(requestedName)}'
      AND Inactive_Suspended__c = false
      AND (Is_Broker__c = true OR Buyer_Payment_Term__c != null)
    ORDER BY Id ASC
    LIMIT 200
  `,
    { limit: 200 },
  );
  const requestedKey = String(body.accountNameKey || body.buyerAccountKey || accountNameKey(requestedName));
  const group = groupEligibleSalesforceAccounts(rows).find((candidate) => candidate.accountNameKey === requestedKey);
  if (!group) {
    throw appError('This Account name no longer has an active Buyer, Buyer & Supplier, or Broker record. Refresh the page and review the latest Salesforce data.', 409);
  }
  group.directSalesforceAccountIds = group.salesforceAccountIds.slice();
  if (group.isGroupAccount && includeGroupChildren) {
    const parentIds = group.directSalesforceAccountIds.map((id) => `'${escapeSoql(id)}'`).join(',');
    const childResult = await queryResult(
      `
      SELECT ${ACCOUNT_MANAGER_ACCOUNT_FIELDS.join(', ')}
      FROM Account
      WHERE ParentId IN (${parentIds})
        AND Inactive_Suspended__c = false
      ORDER BY Name ASC, Id ASC
    `,
      { limit: 5000 },
    );
    if (Number(childResult.totalSize || 0) > (childResult.records || []).length) {
      throw appError('This GROUP has more than 5,000 direct child Accounts and cannot be updated safely.', 409);
    }

    const childRecords = childResult.records || [];
    const childGroups = groupEligibleSalesforceAccounts(childRecords);
    const childAccountsByKey = new Map();
    for (const record of childRecords) {
      const accountName = String(record.Name || '').trim();
      const childKey = accountNameKey(accountName);
      if (childKey && childKey !== group.accountNameKey && !childAccountsByKey.has(childKey)) {
        childAccountsByKey.set(childKey, {
          accountNameKey: childKey,
          accountName,
        });
      }
    }
    group.childAccounts = [...childAccountsByKey.values()].sort((left, right) =>
      left.accountName.localeCompare(right.accountName, undefined, {
        sensitivity: 'base',
      }),
    );
    group.childAccountNameKeys = group.childAccounts.map((account) => account.accountNameKey);
    group.childAccountNames = [...new Set(childGroups.map((child) => child.accountName))];
    group.childAccountCount = childRecords.length;
    group.salesforceAccountIds = [...new Set([...group.directSalesforceAccountIds, ...childRecords.map((record) => String(record.Id || '').trim()).filter(Boolean)])];
    if (enforceSalesforceWriteLimit && group.salesforceAccountIds.length > 200) {
      throw appError(`This GROUP contains ${group.salesforceAccountIds.length} Account records, which exceeds the 200-record all-or-none Salesforce update limit.`, 409);
    }
  }
  return group;
}

async function finalizeAccountManagerSync(client, groupRow, status, error, profile) {
  const result = await client.rpc('finalize_account_manager_sync', {
    p_account_name_key: groupRow.account_name_key,
    p_revision: groupRow.revision,
    p_sync_status: status,
    p_sync_error: error || null,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
  });
  if (result.error) throw accountManagerStorageError(result.error);
  return result.data || groupRow;
}

async function syncAccountManagerToSalesforce(client, groupRow, profile) {
  try {
    const records = (groupRow.salesforce_account_ids || []).map((accountId) => ({
      attributes: { type: 'Account' },
      Id: accountId,
      Account_Manager__c: groupRow.salesforce_manager_text || null,
    }));
    if (!records.length) throw new Error('No active eligible Salesforce Accounts were found for synchronization.');

    const result = await sfRequest('/composite/sobjects', {
      method: 'PATCH',
      body: { allOrNone: true, records },
    });
    const failures = (Array.isArray(result) ? result : []).filter((item) => item?.success !== true);
    if (failures.length) {
      const message = failures
        .flatMap((item) => item.errors || [])
        .map((item) => item.message)
        .filter(Boolean)
        .join('; ');
      throw new Error(message || 'Salesforce rejected the Account Manager update.');
    }

    return {
      groupRow: await finalizeAccountManagerSync(client, groupRow, 'synced', null, profile),
      syncError: null,
    };
  } catch (error) {
    const message = String(error?.message || 'Salesforce Account Manager synchronization failed.').slice(0, 2000);
    let failedRow = {
      ...groupRow,
      salesforce_sync_status: 'failed',
      salesforce_sync_error: message,
    };
    try {
      failedRow = await finalizeAccountManagerSync(client, groupRow, 'failed', message, profile);
    } catch (finalizeError) {
      failedRow.salesforce_sync_error = `${message} Sync status could not be finalized: ${finalizeError.message}`.slice(0, 2000);
    }
    return { groupRow: failedRow, syncError: message };
  }
}

async function accountManagersList(body = {}, req = null, accessContext = null) {
  const client = accessContext?.client || supabaseAdminClient();
  await accountManagerSchema();
  const [salesforceAccountResult, groupsResult, assignmentsResult, profilesResult, notesResult] = await Promise.all([
    cachedSalesforceValue({
      namespace: 'account-manager-directory',
      payload: null,
      ttlSeconds: 10 * 60,
      tags: ['salesforce:account', 'salesforce:reference'],
      body,
      req,
      accessContext,
      loader: () =>
        queryResult(
          `
        SELECT ${ACCOUNT_MANAGER_ACCOUNT_FIELDS.join(', ')}
        FROM Account
        WHERE Inactive_Suspended__c = false
          AND (Is_Broker__c = true OR Buyer_Payment_Term__c != null)
        ORDER BY Name ASC
      `,
          { limit: 10000 },
        ),
    }).then((cached) => cached.value),
    client.from('account_manager_groups').select('account_name_key,account_name,salesforce_account_ids,account_roles,salesforce_manager_text,propagate_to_children,salesforce_sync_status,salesforce_sync_error,salesforce_synced_at,revision,updated_at,updated_by_email'),
    client.from('account_manager_assignments').select('account_name_key,manager_user_id,assignment_order'),
    client.from('user_profiles').select('id,email,full_name,user_type,active').order('full_name', { ascending: true }),
    client.from('account_manager_notes').select('account_name_key,account_name,account_note,source_group_account_name_key,source_group_account_name,revision,updated_at,updated_by_email'),
  ]);

  for (const result of [groupsResult, assignmentsResult, profilesResult, notesResult]) {
    if (result.error) throw accountManagerStorageError(result.error);
  }
  const salesforceAccounts = salesforceAccountResult.records || [];
  if (Number(salesforceAccountResult.totalSize || 0) > salesforceAccounts.length) {
    throw appError('The active Salesforce Account directory exceeds 10,000 records. Narrow the server query before managing assignments.', 503);
  }

  const profiles = profilesResult.data || [];
  const accounts = buildAccountManagerRows({
    salesforceAccounts,
    managedGroups: groupsResult.data || [],
    assignments: assignmentsResult.data || [],
    profiles,
    accountNotes: notesResult.data || [],
  });
  return {
    accounts,
    buyers: accounts,
    users: profiles.map(accountManagerProfile),
  };
}

async function accountManagersSaveNote(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);

  const requestedPropagation = body.propagateToChildren === true;
  const salesforceGroup = await currentEligibleAccountGroup(body, {
    includeGroupChildren: requestedPropagation,
    enforceSalesforceWriteLimit: false,
  });
  const propagateToChildren = salesforceGroup.isGroupAccount && requestedPropagation;
  const accountNote = String(body.accountNote ?? body.note ?? '').trim();
  if (Array.from(accountNote).length > 255) {
    throw appError('Account note cannot exceed 255 characters.', 400);
  }

  const rpcName = propagateToChildren ? 'save_account_manager_note_family' : 'save_account_manager_note';
  const rpcPayload = {
    p_account_name_key: salesforceGroup.accountNameKey,
    p_account_name: salesforceGroup.accountName,
    p_account_note: accountNote,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: Number(body.expectedRevision ?? body.noteRevision ?? 0),
  };
  if (propagateToChildren) {
    const childAccounts = salesforceGroup.childAccounts || [];
    let childNotes = [];
    if (childAccounts.length) {
      const childNotesResult = await client
        .from('account_manager_notes')
        .select('account_name_key,revision')
        .in(
          'account_name_key',
          childAccounts.map((account) => account.accountNameKey),
        );
      if (childNotesResult.error) throw accountManagerStorageError(childNotesResult.error);
      childNotes = childNotesResult.data || [];
    }
    const revisionsByKey = new Map(childNotes.map((note) => [note.account_name_key, Number(note.revision || 0)]));
    rpcPayload.p_child_accounts = childAccounts.map((account) => ({
      accountNameKey: account.accountNameKey,
      accountName: account.accountName,
      expectedRevision: revisionsByKey.get(account.accountNameKey) || 0,
    }));
  }
  const { data, error } = await client.rpc(rpcName, rpcPayload);
  if (error) {
    const storageError = accountManagerStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|cannot exceed 255|active FCOS user/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }

  return {
    note: {
      accountNameKey: salesforceGroup.accountNameKey,
      accountName: salesforceGroup.accountName,
      accountNote: data?.account_note || '',
      noteRevision: Number(data?.revision || 0),
      noteUpdatedAt: data?.updated_at || null,
      noteUpdatedByEmail: data?.updated_by_email || null,
      noteSourceGroupAccountNameKey: data?.source_group_account_name_key || null,
      noteSourceGroupAccountName: data?.source_group_account_name || '',
    },
    propagatedChildCount: propagateToChildren ? (salesforceGroup.childAccounts || []).length : 0,
  };
}

async function accountManagersSave(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);

  let managerUserIds;
  try {
    managerUserIds = normalizeAccountManagerUserIds(body.managerUserIds || body.traderUserIds || []);
  } catch (error) {
    throw appError(error.message, 400);
  }

  const requestedPropagation = body.propagateToChildren !== false;
  const salesforceGroup = await currentEligibleAccountGroup(body, {
    includeGroupChildren: requestedPropagation,
  });
  const propagateToChildren = salesforceGroup.isGroupAccount && requestedPropagation;
  let selectedProfiles = [];
  if (managerUserIds.length) {
    const { data, error } = await client.from('user_profiles').select('id,email,full_name,user_type,active').in('id', managerUserIds);
    if (error) throw error;
    const profilesById = new Map((data || []).map((candidate) => [candidate.id, candidate]));
    selectedProfiles = managerUserIds.map((userId) => profilesById.get(userId)).filter(Boolean);
    if (selectedProfiles.length !== managerUserIds.length || selectedProfiles.some((candidate) => candidate.active !== true)) {
      throw appError('Every assigned manager must be an active FCOS user.', 400);
    }
  }

  const managerText = managerDisplayText(selectedProfiles);
  const schema = await accountManagerSchema();
  if (managerText.length > schema.managerFieldLength) {
    throw appError(`Selected manager names exceed the Salesforce ${schema.managerFieldLength}-character limit.`, 400);
  }

  const rpcName = salesforceGroup.isGroupAccount ? 'save_account_manager_group_with_scope' : 'save_account_manager_group';
  const rpcPayload = {
    p_account_name_key: salesforceGroup.accountNameKey,
    p_account_name: salesforceGroup.accountName,
    p_salesforce_account_ids: salesforceGroup.salesforceAccountIds,
    p_account_roles: salesforceGroup.roles,
    p_salesforce_manager_text: managerText || null,
    p_manager_user_ids: managerUserIds,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: Number(body.expectedRevision ?? body.revision ?? 0),
  };
  if (salesforceGroup.isGroupAccount) {
    rpcPayload.p_child_account_name_keys = salesforceGroup.childAccountNameKeys || [];
    rpcPayload.p_propagate_to_children = propagateToChildren;
  }
  const { data, error } = await client.rpc(rpcName, rpcPayload);
  if (error) {
    const storageError = accountManagerStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|at most three|same manager|active FCOS user|exceeds 255/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }

  const syncResult = await syncAccountManagerToSalesforce(client, data || {}, profile);
  const managers = selectedProfiles.map(accountManagerProfile);
  const account = accountManagerResponse({
    salesforceGroup,
    groupRow: syncResult.groupRow,
    managers,
  });
  return { account, buyer: account, syncError: syncResult.syncError };
}

async function accountManagersRetrySync(body = {}, req = null, accessContext = null) {
  const { client } = accessContext || {};
  if (!client) throw appError('Sign-in required.', 401);
  const key = String(body.accountNameKey || '').trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw appError('A valid Account name key is required.', 400);

  const [groupResult, assignmentResult] = await Promise.all([client.from('account_manager_groups').select('account_name_key,account_name,propagate_to_children,revision').eq('account_name_key', key).maybeSingle(), client.from('account_manager_assignments').select('manager_user_id,assignment_order').eq('account_name_key', key).order('assignment_order', { ascending: true })]);
  if (groupResult.error) throw accountManagerStorageError(groupResult.error);
  if (assignmentResult.error) throw accountManagerStorageError(assignmentResult.error);
  if (!groupResult.data) throw appError('This Account Manager assignment no longer exists.', 404);

  return accountManagersSave(
    {
      accountNameKey: key,
      accountName: groupResult.data.account_name,
      managerUserIds: (assignmentResult.data || []).map((row) => row.manager_user_id),
      expectedRevision: groupResult.data.revision,
      propagateToChildren: groupResult.data.propagate_to_children === true,
    },
    req,
    accessContext,
  );
}

const ACCOUNT_PIC_ACCOUNT_FIELDS = ['Id', 'Name', 'Company_Code__c', 'RecordType.Name', 'Buyer_Payment_Term__c', 'Supplier_Payment_Term__c', 'Is_Broker__c', 'Inactive_Suspended__c'];
const ACCOUNT_PIC_DIRECTORY_SELECT = 'salesforce_account_id,account_name,cl_key,account_role,row_count,column_count,row_color_rules,revision,updated_at,updated_by_email';
const ACCOUNT_PIC_COLUMN_SELECT = 'id,salesforce_account_id,sequence,label,input_type,column_kind';
const ACCOUNT_PIC_ROW_SELECT = 'id,salesforce_account_id,sequence,row_label,cells,port_region,responsible_personnel,team,reporting_supervision,vessel_types_covered';

function accountPicStorageError(error) {
  const message = String(error?.message || '');
  if (error?.code === '42P01' || error?.code === 'PGRST205' || /account_pic_directory/i.test(message)) {
    return appError('Buyer PIC Reference storage is not ready. Apply the latest Supabase migration and try again.', 503);
  }
  if (error?.code === 'PGRST202' || (/save_account_pic_(?:directory(?:_v2)?|row_color_rules)/i.test(message) && /schema cache|could not find/i.test(message))) {
    return appError('Buyer PIC Reference storage is not ready. Refresh the Supabase schema cache after applying the latest migration.', 503);
  }
  return error;
}

function accountPicRole(record = {}) {
  if (record.Inactive_Suspended__c !== false || record.Is_Broker__c === true) return null;
  if (String(record.RecordType?.Name || '').trim().toLowerCase() === 'group') return null;
  if (!String(record.Buyer_Payment_Term__c || '').trim()) return null;
  return String(record.Supplier_Payment_Term__c || '').trim() ? 'buyer_supplier' : 'buyer';
}

function accountPicAccountProjection(record = {}) {
  const role = accountPicRole(record);
  if (!role || !validAccountPicAccountId(record.Id)) return null;
  return {
    id: String(record.Id).trim(),
    name: String(record.Name || '').trim(),
    clKey: String(record.Company_Code__c || '').trim(),
    role,
  };
}

async function currentAccountPicAccount(accountId) {
  const normalizedId = String(accountId || '').trim();
  if (!validAccountPicAccountId(normalizedId)) throw appError('A valid Salesforce Account ID is required.', 400);
  const rows = await queryRows(
    `
      SELECT ${ACCOUNT_PIC_ACCOUNT_FIELDS.join(', ')}
      FROM Account
      WHERE Id = '${escapeSoql(normalizedId)}'
      LIMIT 1
    `,
    { limit: 1 },
  );
  const account = accountPicAccountProjection(rows[0]);
  if (!account) {
    throw appError('This Account is not an active non-broker Buyer or Buyer & Supplier. Refresh and review the latest Salesforce Account record.', 409);
  }
  return account;
}

async function currentAccountPicAccounts(accountIds = []) {
  const ids = [...new Set((accountIds || []).map((value) => String(value || '').trim()).filter(validAccountPicAccountId))];
  if (!ids.length) return new Map();
  const records = [];
  for (const batch of chunkIds(ids, 100)) {
    const rows = await queryRows(
      `
        SELECT ${ACCOUNT_PIC_ACCOUNT_FIELDS.join(', ')}
        FROM Account
        WHERE Id IN (${batch.map((id) => `'${escapeSoql(id)}'`).join(',')})
      `,
      { limit: 100 },
    );
    records.push(...rows);
  }
  return new Map(records.map(accountPicAccountProjection).filter(Boolean).map((account) => [account.id, account]));
}

function accountPicDirectoryResponse(directory, rows = [], columns = []) {
  if (columns.length) return accountPicFlexibleDirectoryProjection(directory, columns, rows);
  return accountPicDirectoryProjection(directory, rows);
}

async function loadAccountPicDirectory(client, accountId, { revalidate = true } = {}) {
  const result = await client
    .from('account_pic_directories')
    .select(ACCOUNT_PIC_DIRECTORY_SELECT)
    .eq('salesforce_account_id', accountId)
    .maybeSingle();
  if (result.error) throw accountPicStorageError(result.error);
  if (!result.data) throw appError('This Buyer PIC Reference table no longer exists.', 404);
  const currentAccount = revalidate ? await currentAccountPicAccount(accountId) : null;
  const [rowsResult, columnsResult] = await Promise.all([
    client.from('account_pic_directory_rows').select(ACCOUNT_PIC_ROW_SELECT).eq('salesforce_account_id', accountId).order('sequence', { ascending: true }),
    client.from('account_pic_directory_columns').select(ACCOUNT_PIC_COLUMN_SELECT).eq('salesforce_account_id', accountId).order('sequence', { ascending: true }),
  ]);
  if (rowsResult.error) throw accountPicStorageError(rowsResult.error);
  if (columnsResult.error) throw accountPicStorageError(columnsResult.error);
  return accountPicDirectoryResponse({
    ...result.data,
    ...(currentAccount ? {
      account_name: currentAccount.name,
      cl_key: currentAccount.clKey,
      account_role: currentAccount.role,
    } : {}),
  }, rowsResult.data || [], columnsResult.data || []);
}

async function accountPicDirectoryList(body = {}, req = null, accessContext = null) {
  const client = accessContext?.client || supabaseAdminClient();
  const query = String(body.query || '').trim().toLocaleLowerCase('en-US');
  const requestedLimit = Number(body.limit || 100);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 100;
  const storedResult = await client
    .from('account_pic_directories')
    .select(ACCOUNT_PIC_DIRECTORY_SELECT)
    .order('account_name', { ascending: true })
    .limit(1000);
  if (storedResult.error) throw accountPicStorageError(storedResult.error);
  const stored = storedResult.data || [];
  const activeById = await currentAccountPicAccounts(stored.map((directory) => directory.salesforce_account_id));
  const directories = stored
    .filter((directory) => activeById.has(directory.salesforce_account_id))
    .map((directory) => {
      const currentAccount = activeById.get(directory.salesforce_account_id);
      return accountPicDirectoryResponse({
        ...directory,
        account_name: currentAccount.name,
        cl_key: currentAccount.clKey,
        account_role: currentAccount.role,
      });
    })
    .filter((directory) => !query || `${directory.accountName} ${directory.clKey}`.toLocaleLowerCase('en-US').includes(query))
    .slice(0, limit)
    .map((directory) => ({
      accountId: directory.accountId,
      accountName: directory.accountName,
      clKey: directory.clKey,
      revision: directory.revision,
      rowCount: directory.rowCount,
      columnCount: directory.columnCount,
      updatedAt: directory.updatedAt,
      updatedByEmail: directory.updatedByEmail,
      isActive: true,
    }));
  return { directories, accounts: directories };
}

async function accountPicAccountOptions(body = {}, req = null, accessContext = null) {
  const query = String(body.query || '').trim();
  const requestedLimit = Number(body.limit || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 50;
  const match = query ? ` AND (Name LIKE '%${escapeSoql(query)}%' OR Company_Code__c LIKE '%${escapeSoql(query)}%')` : '';
  const rows = await queryRows(
    `
      SELECT ${ACCOUNT_PIC_ACCOUNT_FIELDS.join(', ')}
      FROM Account
      WHERE Inactive_Suspended__c = false
        AND Is_Broker__c = false
        AND Buyer_Payment_Term__c != null
        AND RecordType.Name != 'Group'${match}
      ORDER BY Name ASC, Id ASC
      LIMIT ${limit}
    `,
    { limit },
  );
  const accounts = rows.map(accountPicAccountProjection).filter(Boolean).map((account) => ({
    accountId: account.id,
    accountName: account.name,
    clKey: account.clKey,
    role: account.role,
  }));
  return { accounts };
}

async function accountPicTraderOptions(body = {}, req = null, accessContext = null) {
  const client = accessContext?.client || supabaseAdminClient();
  const query = String(body.query || '').trim().toLocaleLowerCase('en-US');
  const { data, error } = await client
    .from('user_profiles')
    .select('id,email,full_name,user_type,active')
    .eq('active', true)
    .order('full_name', { ascending: true })
    .limit(500);
  if (error) throw error;
  const profiles = (data || [])
    .map((profile) => ({
      profileId: profile.id,
      name: String(profile.full_name || profile.email || '').trim(),
      email: String(profile.email || '').trim().toLowerCase(),
      userType: String(profile.user_type || '').trim(),
    }))
    .filter((profile) => !query || `${profile.name} ${profile.email} ${profile.userType}`.toLocaleLowerCase('en-US').includes(query));
  return { profiles };
}

async function accountPicDirectoryDetail(body = {}, req = null, accessContext = null) {
  const client = accessContext?.client || supabaseAdminClient();
  const accountId = String(body.accountId || '').trim();
  const directory = await loadAccountPicDirectory(client, accountId);
  return { directory };
}

function accountPicIdempotencyKey(body = {}) {
  const key = String(body.idempotencyKey || '').trim();
  if (key.length < 16 || key.length > 200) {
    throw appError('A valid Buyer PIC operation ID is required.', 400);
  }
  return key;
}

async function saveAccountPicDirectory(body = {}, accessContext = null, { operation = 'save' } = {}) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);
  const account = await currentAccountPicAccount(body.accountId);
  let rows;
  try {
    rows = normalizeAccountPicRows(body.rows || []);
  } catch (error) {
    throw appError(error.message, 400);
  }
  const idempotencyKey = accountPicIdempotencyKey(body);
  const expectedRevision = Number(body.expectedRevision ?? body.revision ?? 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw appError('A valid expected revision is required.', 400);
  }
  const { error } = await client.rpc('save_account_pic_directory', {
    p_salesforce_account_id: account.id,
    p_account_name: account.name,
    p_cl_key: account.clKey,
    p_account_role: account.role,
    p_rows: rows,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: expectedRevision,
    p_idempotency_key: idempotencyKey,
    p_request_hash: accountPicPayloadHash({ accountId: account.id, rows }),
    p_operation: operation,
  });
  if (error) {
    const storageError = accountPicStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened|idempotency key/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|invalid|cannot exceed|at most/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }
  const directory = await loadAccountPicDirectory(client, account.id, { revalidate: false });
  return { directory };
}

async function saveFlexibleAccountPicDirectory(body = {}, accessContext = null, { operation = 'save' } = {}) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);
  const account = await currentAccountPicAccount(body.accountId);
  let grid;
  try {
    grid = normalizeAccountPicGrid({ columns: body.columns, rows: body.rows });
  } catch (error) {
    throw appError(error.message, 400);
  }

  const selectedProfileIds = [...new Set(grid.columns
    .filter((column) => column.inputType === 'buyer_trader' || column.inputType === 'supplier_trader')
    .flatMap((column) => grid.rows.map((row) => row.cells[column.id]?.profileId).filter(Boolean)))];
  if (selectedProfileIds.length) {
    const { data, error } = await client.from('user_profiles').select('id,email,full_name,active').in('id', selectedProfileIds).eq('active', true);
    if (error) throw error;
    const profiles = new Map((data || []).map((entry) => [entry.id, entry]));
    if (profiles.size !== selectedProfileIds.length) throw appError('One or more selected trader profiles are no longer active.', 409);
    grid.rows = grid.rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(grid.columns.map((column) => {
        const value = row.cells[column.id];
        if (!value?.profileId) return [column.id, value];
        const current = profiles.get(value.profileId);
        return [column.id, { profileId: current.id, name: String(current.full_name || current.email || '').trim(), email: String(current.email || '').trim().toLowerCase() }];
      })),
    }));
  }

  const idempotencyKey = accountPicIdempotencyKey(body);
  const expectedRevision = Number(body.expectedRevision ?? body.revision ?? 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw appError('A valid expected revision is required.', 400);
  const { error } = await client.rpc('save_account_pic_directory_v2', {
    p_salesforce_account_id: account.id,
    p_account_name: account.name,
    p_cl_key: account.clKey,
    p_account_role: account.role,
    p_columns: grid.columns,
    p_rows: grid.rows,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: expectedRevision,
    p_idempotency_key: idempotencyKey,
    p_request_hash: accountPicFlexiblePayloadHash({ accountId: account.id, ...grid }),
    p_operation: operation,
  });
  if (error) {
    const storageError = accountPicStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened|idempotency key|no longer active/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|invalid|cannot exceed|at most|must contain|unique/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }
  return { directory: await loadAccountPicDirectory(client, account.id, { revalidate: false }) };
}

async function accountPicDirectorySave(body = {}, req = null, accessContext = null) {
  if (Array.isArray(body.columns)) return saveFlexibleAccountPicDirectory(body, accessContext, { operation: 'save' });
  return saveAccountPicDirectory(body, accessContext, { operation: 'save' });
}

async function accountPicDirectoryImport(body = {}, req = null, accessContext = null) {
  if (Array.isArray(body.columns)) return saveFlexibleAccountPicDirectory(body, accessContext, { operation: 'import' });
  if (typeof body.csvText === 'string' && Buffer.byteLength(body.csvText, 'utf8') > ACCOUNT_PIC_MAX_CSV_BYTES) {
    throw appError('CSV is too large. Use a file smaller than 2 MB.', 413);
  }
  let rows;
  try {
    rows = typeof body.csvText === 'string'
      ? parseAccountPicCsv(body.csvText)
      : normalizeAccountPicRows(body.rows || [], { requireAtLeastOne: true });
  } catch (error) {
    throw appError(error.message, 400);
  }
  return saveAccountPicDirectory({ ...body, rows }, accessContext, { operation: 'import' });
}

async function accountPicRowColorsSave(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);
  const account = await currentAccountPicAccount(body.accountId);
  const current = await loadAccountPicDirectory(client, account.id, { revalidate: false });
  let rules;
  try {
    rules = normalizeAccountPicRowColorRules(body.rules || [], current.columns || [], { strict: true });
  } catch (error) {
    throw appError(error.message, 400);
  }
  const expectedRevision = Number(body.expectedRevision ?? body.revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw appError('A valid expected revision is required.', 400);
  const idempotencyKey = accountPicIdempotencyKey(body);
  const { error } = await client.rpc('save_account_pic_row_color_rules', {
    p_salesforce_account_id: account.id,
    p_rules: rules,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: expectedRevision,
    p_idempotency_key: idempotencyKey,
    p_request_hash: accountPicRowColorPayloadHash({ accountId: account.id, rules, columns: current.columns }),
  });
  if (error) {
    const storageError = accountPicStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened|idempotency key|no longer exists/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|invalid|no more than|unavailable column|only one/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }
  return { directory: await loadAccountPicDirectory(client, account.id, { revalidate: false }) };
}

const buyersAdministratorList = accountManagersList;
const buyersAdministratorSave = accountManagersSave;

const BUYER_REMINDER_RULE_SELECT = 'salesforce_account_id,account_name,account_type,parent_salesforce_account_id,policy,note,inherit_to_children,revision,updated_by_email,created_at,updated_at';
const BUYER_REMINDER_ACCOUNT_FIELDS = ['Id', 'Name', 'Company_Code__c', 'RecordType.Name', 'ParentId', 'Parent.Name', 'Parent.Company_Code__c', 'Buyer_Payment_Term__c', 'Supplier_Payment_Term__c', 'Is_Broker__c', 'Inactive_Suspended__c'];

function buyerReminderStorageError(error) {
  const message = String(error?.message || '');
  if (error?.code === '42P01' || error?.code === 'PGRST205' || /buyer_invoice_reminder_rules.*does not exist/i.test(message)) {
    return appError('Buyer Invoice reminder rule storage is not ready. Apply the latest Supabase migration and try again.', 503);
  }
  if (error?.code === 'PGRST202' || (/buyer_invoice_reminder_rule/i.test(message) && /schema cache|could not find/i.test(message))) {
    return appError('Buyer Invoice reminder rule storage is not ready. Refresh the Supabase schema cache after applying the latest migration.', 503);
  }
  return error;
}

async function loadBuyerInvoiceReminderRules({ required = false, client = null } = {}) {
  const supabase = client || safeSupabaseAdminClient();
  if (!supabase) {
    if (required) throw appError('Buyer Invoice reminder rule storage is unavailable. External payment reminders are disabled.', 503);
    return { available: false, rules: [], error: 'storage_unavailable' };
  }

  const { data, error } = await supabase.from('buyer_invoice_reminder_rules').select(BUYER_REMINDER_RULE_SELECT);
  if (error) {
    if (required) throw buyerReminderStorageError(error);
    console.error('[buyerInvoiceReminderRules] storage unavailable', {
      code: error.code,
    });
    return { available: false, rules: [], error: 'storage_unavailable' };
  }
  return { available: true, rules: data || [], error: null };
}

async function buyerReminderAccountSchema() {
  const describe = await salesforceObjectFields({ objectName: 'Account' });
  const fieldsByName = new Map((describe.fields || []).map((field) => [field.name, field]));
  const requiredFields = [
    ['RecordTypeId', 'reference'],
    ['ParentId', 'reference'],
    ['Company_Code__c', 'string'],
    ['Buyer_Payment_Term__c', null],
    ['Supplier_Payment_Term__c', null],
    ['Is_Broker__c', 'boolean'],
    ['Inactive_Suspended__c', 'boolean'],
  ];
  for (const [fieldName, expectedType] of requiredFields) {
    const field = fieldsByName.get(fieldName);
    if (!field || (expectedType && field.type !== expectedType)) {
      throw appError(`Salesforce Account.${fieldName} is missing or has an incompatible type. Reminder Rules is unavailable until the schema is corrected.`, 503);
    }
  }
  if (!fieldsByName.get('ParentId')?.referenceTo?.includes('Account')) {
    throw appError('Salesforce Account.ParentId is not an Account lookup. Reminder Rules is unavailable until the schema is corrected.', 503);
  }
  return true;
}

function buyerReminderAccountSnapshot(account = {}) {
  const accountId = canonicalSalesforceAccountId(account.Id);
  const parentAccountId = canonicalSalesforceAccountId(account.ParentId);
  const accountType = buyerReminderAccountType(account);
  return {
    accountId,
    accountName: String(account.Name || '').trim(),
    clKey: String(account.Company_Code__c || '').trim(),
    accountType,
    accountTypeLabel: accountType === 'group' ? 'GROUP' : accountType === 'buyer_supplier' ? 'Buyer & Supplier' : 'Buyer',
    parentAccountId: parentAccountId || null,
    parentAccountName: String(account.Parent?.Name || '').trim(),
    parentClKey: String(account.Parent?.Company_Code__c || '').trim(),
    isGroup: accountType === 'group',
  };
}

function isActiveBuyerReminderAccount(account = {}) {
  return account.Inactive_Suspended__c === false && Boolean(buyerReminderAccountType(account)) && Boolean(String(account.Company_Code__c || '').trim());
}

async function loadBuyerReminderAccountDirectory(body = {}, req = null, accessContext = null) {
  await buyerReminderAccountSchema();
  const { value: result } = await cachedSalesforceValue({
    namespace: 'buyer-reminder-account-directory',
    payload: null,
    ttlSeconds: 10 * 60,
    tags: ['salesforce:account', 'salesforce:reference', 'salesforce:buyer-invoices'],
    body,
    req,
    accessContext,
    loader: () =>
      queryResult(
        `
      SELECT ${BUYER_REMINDER_ACCOUNT_FIELDS.join(', ')}
      FROM Account
      WHERE Inactive_Suspended__c = false
        AND Is_Broker__c = false
        AND Company_Code__c != null
        AND (Buyer_Payment_Term__c != null OR RecordType.Name = 'Group')
      ORDER BY Name ASC, Id ASC
    `,
        { limit: 10000 },
      ),
  });
  const records = (result.records || []).filter(isActiveBuyerReminderAccount);
  if (Number(result.totalSize || 0) > records.length) {
    throw appError('The active Buyer Account directory exceeds 10,000 records. Narrow the Salesforce directory before managing reminder rules.', 503);
  }
  return records;
}

async function currentBuyerReminderAccount(accountId, { includeChildren = false } = {}) {
  await buyerReminderAccountSchema();
  const canonicalId = canonicalSalesforceAccountId(accountId);
  if (!canonicalId) throw appError('A valid Salesforce Account ID is required.', 400);
  const records = await queryRows(
    `
    SELECT ${BUYER_REMINDER_ACCOUNT_FIELDS.join(', ')}
    FROM Account
    WHERE Id = '${escapeSoql(canonicalId)}'
    LIMIT 1
  `,
    { limit: 1 },
  );
  const account = records[0];
  if (!account || !isActiveBuyerReminderAccount(account)) {
    throw appError('This Account is no longer an active Buyer, Buyer & Supplier, or GROUP Account with a CL Key. Refresh Reminder Rules.', 409);
  }

  const snapshot = buyerReminderAccountSnapshot(account);
  let children = [];
  if (includeChildren && snapshot.isGroup) {
    const result = await queryResult(
      `
      SELECT ${BUYER_REMINDER_ACCOUNT_FIELDS.join(', ')}
      FROM Account
      WHERE ParentId = '${escapeSoql(canonicalId)}'
        AND Inactive_Suspended__c = false
        AND Is_Broker__c = false
        AND Company_Code__c != null
        AND (Buyer_Payment_Term__c != null OR RecordType.Name = 'Group')
      ORDER BY Name ASC, Id ASC
    `,
      { limit: 10000 },
    );
    children = (result.records || []).filter(isActiveBuyerReminderAccount);
    if (Number(result.totalSize || 0) > children.length) {
      throw appError('This GROUP has more than 10,000 eligible direct child Accounts and cannot be updated safely.', 409);
    }
  }
  return { account, snapshot, children };
}

function serializeBuyerReminderRule(rule = null) {
  if (!rule) return null;
  return {
    accountId: canonicalSalesforceAccountId(rule.salesforce_account_id || rule.accountId),
    accountName: rule.account_name || rule.accountName || '',
    accountType: rule.account_type || rule.accountType || '',
    parentAccountId: canonicalSalesforceAccountId(rule.parent_salesforce_account_id || rule.parentAccountId) || null,
    policy: rule.policy === 'overdue_only' ? 'overdue_only' : 'standard',
    note: rule.note || '',
    inheritToChildren: rule.inherit_to_children === true || rule.inheritToChildren === true,
    revision: Number(rule.revision || 0),
    updatedAt: rule.updated_at || rule.updatedAt || null,
    updatedByEmail: rule.updated_by_email || rule.updatedByEmail || null,
  };
}

async function buyerInvoiceReminderRulesList(body = {}, req = null, accessContext = null) {
  const client = accessContext?.client || supabaseAdminClient();
  const [salesforceAccounts, stored] = await Promise.all([loadBuyerReminderAccountDirectory(body, req, accessContext), loadBuyerInvoiceReminderRules({ required: true, client })]);
  const ruleMap = buyerReminderRuleMap(stored.rules);
  const snapshots = salesforceAccounts.map(buyerReminderAccountSnapshot);
  const childrenByParent = new Map();
  for (const account of snapshots) {
    if (!account.parentAccountId) continue;
    if (!childrenByParent.has(account.parentAccountId)) childrenByParent.set(account.parentAccountId, []);
    childrenByParent.get(account.parentAccountId).push(account);
  }

  const accounts = snapshots
    .map((account) => {
      const directRule = ruleMap.get(account.accountId) || null;
      const parentRule = ruleMap.get(account.parentAccountId);
      const inheritedRule = !directRule && parentRule?.inheritToChildren ? parentRule : null;
      const effectiveRule = directRule || inheritedRule || null;
      const availableGroupRule = parentRule?.inheritToChildren ? parentRule : null;
      const children = childrenByParent.get(account.accountId) || [];
      const childOverrideCount = children.filter((child) => ruleMap.has(child.accountId)).length;
      return {
        ...account,
        policy: effectiveRule?.policy || 'standard',
        note: effectiveRule?.note || '',
        source: directRule ? 'direct' : inheritedRule ? 'group' : 'default',
        sourceAccountId: inheritedRule?.accountId || directRule?.accountId || null,
        sourceAccountName: inheritedRule?.accountName || directRule?.accountName || '',
        hasDirectRule: Boolean(directRule),
        canUseGroupRule: Boolean(directRule && availableGroupRule),
        availableGroupRule: serializeBuyerReminderRule(availableGroupRule),
        directRule: serializeBuyerReminderRule(directRule),
        revision: Number(directRule?.revision || 0),
        inheritToChildren: directRule?.inheritToChildren === true,
        childCount: children.length,
        eligibleChildCount: children.length,
        childOverrideCount,
        updatedAt: (directRule || inheritedRule)?.updatedAt || null,
        updatedByEmail: (directRule || inheritedRule)?.updatedByEmail || null,
      };
    })
    .sort(
      (left, right) =>
        Number(right.isGroup) - Number(left.isGroup) ||
        left.accountName.localeCompare(right.accountName, undefined, {
          sensitivity: 'base',
        }) ||
        left.accountId.localeCompare(right.accountId),
    );

  return { accounts };
}

async function buyerInvoiceReminderRuleSave(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);
  const policy = body.policy === 'overdue_only' ? 'overdue_only' : body.policy === 'standard' ? 'standard' : '';
  if (!policy) throw appError('Reminder policy must be Standard or Overdue only.', 400);
  const note = String(body.note || '').trim();
  if (Array.from(note).length > 255) throw appError('Reminder rule note cannot exceed 255 characters.', 400);

  const requestedScope = String(body.groupScope || body.scope || 'group_only');
  if (!['group_only', 'group_children'].includes(requestedScope)) {
    throw appError('GROUP scope must be GROUP only or GROUP + children.', 400);
  }
  const replaceChildOverrides = body.replaceChildOverrides === true;
  const includeChildren = requestedScope === 'group_children';
  const { snapshot, children } = await currentBuyerReminderAccount(body.accountId, { includeChildren: true });
  if (!snapshot.isGroup && (includeChildren || replaceChildOverrides)) {
    throw appError('Only GROUP Accounts can apply a reminder rule to child Accounts.', 400);
  }
  if (replaceChildOverrides && !includeChildren) {
    throw appError('Replace direct child overrides is available only with GROUP + children.', 400);
  }

  const expectedRevision = Number(body.expectedRevision || 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw appError('Reminder rule revision is invalid. Refresh Reminder Rules.', 400);
  }
  const { data, error } = await client.rpc('save_buyer_invoice_reminder_rule', {
    p_salesforce_account_id: snapshot.accountId,
    p_account_name: snapshot.accountName,
    p_account_type: snapshot.accountType,
    p_parent_salesforce_account_id: snapshot.parentAccountId,
    p_policy: policy,
    p_note: note,
    p_inherit_to_children: snapshot.isGroup && includeChildren,
    p_replace_child_overrides: replaceChildOverrides,
    p_child_account_ids: includeChildren ? children.map((child) => canonicalSalesforceAccountId(child.Id)).filter(Boolean) : [],
    p_expected_revision: expectedRevision,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error) {
    const storageError = buyerReminderStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|eligible|policy|cannot exceed|only GROUP|active FCOS/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }
  return {
    saved: true,
    rule: serializeBuyerReminderRule(data),
    replacedChildOverrideCount: Number(data?.replaced_child_override_count || 0),
  };
}

async function buyerInvoiceReminderRuleRemove(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);
  const { snapshot } = await currentBuyerReminderAccount(body.accountId);
  const expectedRevision = Number(body.expectedRevision || 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision <= 0) {
    throw appError('A current direct reminder rule revision is required.', 400);
  }
  const { data, error } = await client.rpc('remove_buyer_invoice_reminder_rule', {
    p_salesforce_account_id: snapshot.accountId,
    p_expected_revision: expectedRevision,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error) {
    const storageError = buyerReminderStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|active FCOS/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }
  return data || { removed: true, accountId: snapshot.accountId };
}

const REPORT_EXPORT_MAX_BYTES = 15 * 1024 * 1024;
const REPORT_EXPORT_MIME_TYPE = 'application/vnd.ms-excel';
const REPORT_TYPE_LABELS = {
  broker_commission: "Broker's Commission",
};
const REPORT_EXPORT_SELECT = 'id,report_type,report_label,file_name,mime_type,size_bytes,checksum_sha256,drive_file_id,drive_web_view_link,drive_web_content_link,status,exported_by,exported_by_email,deleted_by,deleted_by_email,metadata,error_message,created_at,updated_at,deleted_at';

function reportTypeLabel(reportType) {
  return REPORT_TYPE_LABELS[reportType] || String(reportType || 'Report').replaceAll('_', ' ');
}

function safeReportFileName(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
  if (!cleaned) throw appError('File name is required.', 400);
  return cleaned.toLowerCase().endsWith('.xls') ? cleaned : `${cleaned}.xls`;
}

function decodeBase64File(value) {
  const raw = String(value || '')
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s/g, '');
  if (!raw) throw appError('XLS content is required.', 400);
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw appError('XLS content is empty.', 400);
  if (buffer.length > REPORT_EXPORT_MAX_BYTES) throw appError('XLS file is too large. Maximum size is 15 MB.', 413);
  return buffer;
}

function checksumSha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function serializeReportEvent(row = {}) {
  return {
    id: row.id,
    reportExportId: row.report_export_id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    previousFileName: row.previous_file_name,
    newFileName: row.new_file_name,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function serializeReportExport(row = {}, events = []) {
  return {
    id: row.id,
    reportType: row.report_type,
    reportLabel: row.report_label || reportTypeLabel(row.report_type),
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    checksumSha256: row.checksum_sha256,
    driveFileId: row.drive_file_id,
    driveWebViewLink: row.drive_web_view_link,
    driveWebContentLink: row.drive_web_content_link,
    status: row.status,
    exportedBy: row.exported_by,
    exportedByEmail: row.exported_by_email,
    deletedBy: row.deleted_by,
    deletedByEmail: row.deleted_by_email,
    metadata: row.metadata || {},
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    events: events.map(serializeReportEvent),
  };
}

async function writeReportExportEvent(client, reportExportId, eventType, actor, payload = {}) {
  const { error } = await client.from('report_export_events').insert({
    report_export_id: reportExportId,
    event_type: eventType,
    actor_user_id: actor?.id || null,
    actor_email: actor?.email || null,
    previous_file_name: payload.previousFileName || null,
    new_file_name: payload.newFileName || null,
    metadata: payload.metadata || {},
  });
  if (error) console.error('Failed to write report export event', error.message);
}

function googleDriveConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const folderId = process.env.GOOGLE_DRIVE_REPORT_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    throw appError('Missing Google Drive env vars. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, and GOOGLE_DRIVE_REPORT_FOLDER_ID in Vercel.', 500);
  }
  return { clientId, clientSecret, refreshToken, folderId };
}

async function googleDriveAccessToken() {
  requireExternalActionGate('google_drive');
  const { clientId, clientSecret, refreshToken } = googleDriveConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw appError(data.error_description || data.error || 'Google Drive token refresh failed.', 502);
  if (!data.access_token) throw appError('Google Drive token refresh did not return an access token.', 502);
  return data.access_token;
}

async function googleDriveFetch(url, options = {}) {
  const accessToken = await googleDriveAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || errorData.error_description || errorData.error || `Google Drive request failed: ${response.status}`;
    throw appError(message, 502);
  }
  return response;
}

async function googleDriveUploadFile({ fileName, mimeType, buffer }) {
  const { folderId } = googleDriveConfig();
  const boundary = `fcos-${Date.now()}`;
  const metadata = {
    name: fileName,
    mimeType,
    parents: [folderId],
  };
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`, 'utf8'), Buffer.from(`--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`, 'utf8'), buffer, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]);
  const fields = encodeURIComponent('id,name,mimeType,size,webViewLink,webContentLink,createdTime,modifiedTime');
  const response = await googleDriveFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${fields}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return response.json();
}

async function googleDriveRenameFile(fileId, fileName) {
  const fields = encodeURIComponent('id,name,mimeType,size,webViewLink,webContentLink,modifiedTime');
  const response = await googleDriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: fileName }),
  });
  return response.json();
}

async function googleDriveTrashFile(fileId) {
  const fields = encodeURIComponent('id,name,trashed,modifiedTime');
  const response = await googleDriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  return response.json();
}

async function googleDriveRestoreFile(fileId) {
  const fields = encodeURIComponent('id,name,trashed,modifiedTime');
  const response = await googleDriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trashed: false }),
  });
  return response.json();
}

async function googleDriveDownloadFile(fileId) {
  const response = await googleDriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return Buffer.from(await response.arrayBuffer());
}

async function reportExportCreate(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  requireExternalActionGate('google_drive');
  const reportType = String(body.reportType || body.report_type || 'xls_report')
    .trim()
    .toLowerCase();
  const fileName = safeReportFileName(body.fileName || body.file_name);
  const mimeType = String(body.mimeType || body.mime_type || REPORT_EXPORT_MIME_TYPE);
  if (mimeType !== REPORT_EXPORT_MIME_TYPE && !mimeType.includes('excel')) throw appError('Only XLS report files are supported.', 400);

  const buffer = decodeBase64File(body.contentBase64 || body.content_base64);
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const nowIso = new Date().toISOString();
  const checksum = checksumSha256(buffer);
  const insertPayload = {
    report_type: reportType,
    report_label: body.reportLabel || body.report_label || reportTypeLabel(reportType),
    file_name: fileName,
    mime_type: REPORT_EXPORT_MIME_TYPE,
    size_bytes: buffer.length,
    checksum_sha256: checksum,
    status: 'uploading',
    exported_by: profile.id,
    exported_by_email: profile.email,
    metadata,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const { data: inserted, error: insertError } = await client.from('report_exports').insert(insertPayload).select(REPORT_EXPORT_SELECT).single();
  if (insertError) throw insertError;

  let driveFile = null;
  try {
    driveFile = await googleDriveUploadFile({
      fileName,
      mimeType: REPORT_EXPORT_MIME_TYPE,
      buffer,
    });
    const updatePayload = {
      drive_file_id: driveFile.id || null,
      drive_web_view_link: driveFile.webViewLink || null,
      drive_web_content_link: driveFile.webContentLink || null,
      status: 'active',
      error_message: null,
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error: updateError } = await client.from('report_exports').update(updatePayload).eq('id', inserted.id).select(REPORT_EXPORT_SELECT).single();
    if (updateError) throw updateError;
    await writeReportExportEvent(client, updated.id, 'exported', profile, {
      newFileName: fileName,
      metadata: {
        driveFileId: driveFile.id,
        rowCount: metadata.rowCount,
        sizeBytes: buffer.length,
      },
    });
    return { report: serializeReportExport(updated, []) };
  } catch (error) {
    const message = error.message || 'Google Drive upload failed.';
    if (driveFile?.id) {
      await googleDriveTrashFile(driveFile.id).catch((cleanupError) => {
        console.error('Failed to clean up orphaned Google Drive report', cleanupError.message);
      });
    }
    const { data: failed } = await client
      .from('report_exports')
      .update({
        status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inserted.id)
      .select(REPORT_EXPORT_SELECT)
      .maybeSingle();
    await writeReportExportEvent(client, inserted.id, 'upload_failed', profile, {
      newFileName: fileName,
      metadata: {
        error: message,
        rowCount: metadata.rowCount,
        sizeBytes: buffer.length,
      },
    });
    const failure = appError(`Google Drive upload failed: ${message}`, error.status || 502);
    failure.report = failed;
    throw failure;
  }
}

async function reportExportsList(body, req, accessContext = null) {
  const { client } = accessContext || (await requireActiveUser(req));
  const includeDeleted = body.includeDeleted === true || body.include_deleted === true;
  const limit = Math.max(10, Math.min(Number(body.limit) || 200, 500));
  let query = client.from('report_exports').select(REPORT_EXPORT_SELECT).order('created_at', { ascending: false }).limit(limit);
  if (!includeDeleted) query = query.eq('status', 'active');
  const { data: rows, error } = await query;
  if (error) throw error;

  const ids = (rows || []).map((row) => row.id);
  let eventsByReport = {};
  if (ids.length) {
    const { data: events, error: eventsError } = await client.from('report_export_events').select('id,report_export_id,event_type,actor_user_id,actor_email,previous_file_name,new_file_name,metadata,created_at').in('report_export_id', ids).order('created_at', { ascending: false });
    if (eventsError) throw eventsError;
    eventsByReport = (events || []).reduce((acc, event) => {
      if (!acc[event.report_export_id]) acc[event.report_export_id] = [];
      acc[event.report_export_id].push(event);
      return acc;
    }, {});
  }

  return {
    reports: (rows || []).map((row) => serializeReportExport(row, eventsByReport[row.id] || [])),
  };
}

async function loadReportExportForAction(client, id) {
  const { data, error } = await client.from('report_exports').select(REPORT_EXPORT_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw appError('Report export not found.', 404);
  if (data.status !== 'active') throw appError('Only active report exports can be managed.', 400);
  if (!data.drive_file_id) throw appError('This report has no Google Drive file id.', 400);
  return data;
}

async function reportExportRename(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  requireExternalActionGate('google_drive');
  await requireReportArchiveFullAccess(client, profile);
  const id = String(body.id || '').trim();
  if (!id) throw appError('Report export id is required.', 400);
  const fileName = safeReportFileName(body.fileName || body.file_name);
  const current = await loadReportExportForAction(client, id);
  const driveFile = await googleDriveRenameFile(current.drive_file_id, fileName);
  const { data: updated, error } = await client
    .from('report_exports')
    .update({
      file_name: driveFile.name || fileName,
      drive_web_view_link: driveFile.webViewLink || current.drive_web_view_link,
      drive_web_content_link: driveFile.webContentLink || current.drive_web_content_link,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(REPORT_EXPORT_SELECT)
    .single();
  if (error) {
    await googleDriveRenameFile(current.drive_file_id, current.file_name).catch((rollbackError) => {
      console.error('Failed to roll back Google Drive report rename', rollbackError.message);
    });
    throw error;
  }
  await writeReportExportEvent(client, id, 'renamed', profile, {
    previousFileName: current.file_name,
    newFileName: updated.file_name,
  });
  return { report: serializeReportExport(updated, []) };
}

async function reportExportDelete(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  requireExternalActionGate('google_drive');
  await requireReportArchiveFullAccess(client, profile);
  const id = String(body.id || '').trim();
  if (!id) throw appError('Report export id is required.', 400);
  const current = await loadReportExportForAction(client, id);
  await googleDriveTrashFile(current.drive_file_id);
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await client
    .from('report_exports')
    .update({
      status: 'deleted',
      deleted_at: nowIso,
      deleted_by: profile.id,
      deleted_by_email: profile.email,
      updated_at: nowIso,
    })
    .eq('id', id)
    .select(REPORT_EXPORT_SELECT)
    .single();
  if (error) {
    await googleDriveRestoreFile(current.drive_file_id).catch((rollbackError) => {
      console.error('Failed to restore Google Drive report after archive delete failure', rollbackError.message);
    });
    throw error;
  }
  await writeReportExportEvent(client, id, 'deleted', profile, {
    previousFileName: current.file_name,
    metadata: { driveFileId: current.drive_file_id },
  });
  return { report: serializeReportExport(updated, []) };
}

async function reportExportDownload(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  requireExternalActionGate('google_drive');
  const id = String(body.id || '').trim();
  if (!id) throw appError('Report export id is required.', 400);
  const current = await loadReportExportForAction(client, id);
  const buffer = await googleDriveDownloadFile(current.drive_file_id);
  await writeReportExportEvent(client, id, 'downloaded', profile, {
    newFileName: current.file_name,
    metadata: { sizeBytes: buffer.length },
  });
  return {
    id: current.id,
    fileName: current.file_name,
    mimeType: current.mime_type || REPORT_EXPORT_MIME_TYPE,
    contentBase64: buffer.toString('base64'),
  };
}

const NAVIGATION_SECTION_DEFAULTS = Object.freeze({
  personal: ['my_commitments', 'growth_coaching', 'projects_tasks'],
  trading: ['dashboard', 'buyers_administrator', 'markets', 'special_terms', 'hedge_desk'],
  cross_functions: ['payment_collections', 'disputes', 'unofficial_compensation', 'brokers'],
  finance: ['cashflow_forecast'],
  tools: ['email_router', 'review', 'pnl', 'report_archive'],
});
const NAVIGATION_ITEM_IDS = new Set(Object.values(NAVIGATION_SECTION_DEFAULTS).flat());
const NAVIGATION_DEFAULT_HIDDEN_IDS = ['review', 'pnl', 'report_archive'];
const LEGACY_TRADING_DEFAULT_ORDER = ['dashboard', 'payment_collections', 'unofficial_compensation', 'cashflow_forecast', 'disputes', 'brokers', 'buyers_administrator'];

function normalizeNavigationSectionOrders(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const legacyTradingOrder = Array.isArray(source.trading) ? source.trading : [];
  const legacyTradingWasDefault = legacyTradingOrder.length === LEGACY_TRADING_DEFAULT_ORDER.length
    && legacyTradingOrder.every((id, index) => id === LEGACY_TRADING_DEFAULT_ORDER[index]);
  return Object.fromEntries(Object.entries(NAVIGATION_SECTION_DEFAULTS).map(([section, defaults]) => {
    const hasDirectOrder = Array.isArray(source[section]);
    const requested = hasDirectOrder
      ? source[section]
      : ['cross_functions', 'finance'].includes(section) && !legacyTradingWasDefault
        ? legacyTradingOrder
        : [];
    const allowed = new Set(defaults);
    const ordered = [...new Set(requested.map((id) => String(id || '').trim()).filter((id) => allowed.has(id)))];
    if (section === 'tools' && !ordered.includes('email_router')) ordered.unshift('email_router');
    ordered.push(...defaults.filter((itemId) => !ordered.includes(itemId)));
    return [section, ordered];
  }));
}

function normalizeNavigationHiddenItems(value, useDefaults = false) {
  const requested = Array.isArray(value) ? value : useDefaults ? NAVIGATION_DEFAULT_HIDDEN_IDS : [];
  return [...new Set(requested.map((id) => String(id || '').trim()).filter((id) => NAVIGATION_ITEM_IDS.has(id)))];
}

function serializeNavigationPreferences(row = null) {
  return {
    sectionOrders: normalizeNavigationSectionOrders(row?.section_orders),
    hiddenItemIds: normalizeNavigationHiddenItems(row?.hidden_item_ids, !row),
    revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null,
  };
}

const WORKSPACE_DOCUMENT_SOURCE_GROUPS = new Set([
  'Direct STEM',
  'Invoices to Buyer',
  'Invoices from Suppliers',
  'Contracts and Compliance',
  'Dispute / Support',
  'Product Line Attachments',
  'Extra Cost',
  'Broker',
  'Email',
  'Other Related',
]);
const DEFAULT_WORKSPACE_DOCUMENT_SOURCE_GROUPS = [
  'Direct STEM',
  'Invoices to Buyer',
  'Invoices from Suppliers',
  'Contracts and Compliance',
  'Dispute / Support',
  'Product Line Attachments',
  'Email',
];

function normalizeWorkspaceDocumentSourceGroups(value) {
  const requested = Array.isArray(value) ? value : DEFAULT_WORKSPACE_DOCUMENT_SOURCE_GROUPS;
  return [...new Set(requested.map((item) => String(item || '').trim()).filter((item) => WORKSPACE_DOCUMENT_SOURCE_GROUPS.has(item)))];
}

function serializeWorkspacePreferences(row = null) {
  return {
    sidebarMode: row?.sidebar_mode === 'fixed' ? 'fixed' : 'auto_hide',
    tableDensity: row?.table_density === 'comfort' ? 'comfort' : 'compact',
    documentShowOnlyRelevant: row?.document_show_only_relevant ?? true,
    documentSourceGroups: normalizeWorkspaceDocumentSourceGroups(row?.document_source_groups),
    initialized: row?.workspace_preferences_initialized === true,
    revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null,
  };
}

async function navigationPreferencesGet(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const { data, error } = await client.from('user_navigation_preferences').select('user_id,section_orders,hidden_item_ids,revision,updated_at').eq('user_id', profile.id).maybeSingle();
  if (error) throw error;
  return { preferences: serializeNavigationPreferences(data) };
}

async function navigationPreferencesSave(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const sectionOrders = normalizeNavigationSectionOrders(body.sectionOrders || body.section_orders);
  const hiddenItemIds = normalizeNavigationHiddenItems(body.hiddenItemIds || body.hidden_item_ids);
  const expectedRevision = Number(body.expectedRevision ?? body.expected_revision ?? 0);
  const { data, error } = await client.rpc('save_user_navigation_preferences', {
    p_user_id: profile.id,
    p_section_orders: sectionOrders,
    p_hidden_item_ids: hiddenItemIds,
    p_expected_revision: expectedRevision,
    p_actor_user_id: profile.id,
  });
  if (error) {
    if (/changed after they were opened/i.test(error.message || '')) throw appError(error.message, 409);
    throw error;
  }
  return { preferences: serializeNavigationPreferences(data) };
}

async function navigationPreferencesReset(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const expectedRevision = Number(body.expectedRevision ?? body.expected_revision ?? 0);
  const { data: current, error: currentError } = await client.from('user_navigation_preferences').select('revision').eq('user_id', profile.id).maybeSingle();
  if (currentError) throw currentError;
  if (!current) return { preferences: serializeNavigationPreferences(null) };
  if (expectedRevision !== Number(current.revision)) throw appError('Navigation preferences changed after they were opened. Refresh and try again.', 409);
  const { data, error } = await client.rpc('save_user_navigation_preferences', {
    p_user_id: profile.id,
    p_section_orders: NAVIGATION_SECTION_DEFAULTS,
    p_hidden_item_ids: NAVIGATION_DEFAULT_HIDDEN_IDS,
    p_expected_revision: expectedRevision,
    p_actor_user_id: profile.id,
  });
  if (error) {
    if (/changed after they were opened/i.test(error.message || '')) throw appError(error.message, 409);
    throw error;
  }
  return { preferences: serializeNavigationPreferences(data) };
}

async function workspacePreferencesGet(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const { data, error } = await client
    .from('user_navigation_preferences')
    .select('user_id,sidebar_mode,table_density,document_show_only_relevant,document_source_groups,workspace_preferences_initialized,revision,updated_at')
    .eq('user_id', profile.id)
    .maybeSingle();
  if (error) throw error;
  return { preferences: serializeWorkspacePreferences(data) };
}

async function workspacePreferencesSave(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const sidebarMode = body.sidebarMode === 'fixed' ? 'fixed' : body.sidebarMode === 'auto_hide' ? 'auto_hide' : null;
  const tableDensity = body.tableDensity === 'comfort' ? 'comfort' : body.tableDensity === 'compact' ? 'compact' : null;
  const documentShowOnlyRelevant = typeof body.documentShowOnlyRelevant === 'boolean' ? body.documentShowOnlyRelevant : null;
  const documentSourceGroups = normalizeWorkspaceDocumentSourceGroups(body.documentSourceGroups);
  if (!sidebarMode) throw appError('Choose a valid sidebar mode.', 400);
  if (!tableDensity) throw appError('Choose a valid table density.', 400);
  if (documentShowOnlyRelevant === null) throw appError('Choose a document filtering preference.', 400);
  if (documentShowOnlyRelevant && !documentSourceGroups.length) throw appError('Select at least one relevant document source.', 400);
  const expectedRevision = Number(body.expectedRevision ?? body.expected_revision ?? 0);
  const { data, error } = await client.rpc('save_user_workspace_preferences', {
    p_user_id: profile.id,
    p_sidebar_mode: sidebarMode,
    p_table_density: tableDensity,
    p_document_show_only_relevant: documentShowOnlyRelevant,
    p_document_source_groups: documentSourceGroups,
    p_expected_revision: expectedRevision,
    p_actor_user_id: profile.id,
  });
  if (error) {
    if (/changed after they were opened/i.test(error.message || '')) throw appError(error.message, 409);
    throw error;
  }
  return { preferences: serializeWorkspacePreferences(data) };
}

async function buyerInvoiceCollectionList(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const stemIds = Array.isArray(body.stemIds) ? body.stemIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  await Promise.all(stemIds.map((stemId) => requireInterofficeStemAccess(stemId, { client, profile })));
  const map = await loadBuyerInvoiceCollectionMap(stemIds);
  return {
    items: Object.values(map)
      .map((entry) => entry.item)
      .filter(Boolean),
    events: Object.values(map).flatMap((entry) => entry.events || []),
    byStemId: map,
  };
}

async function currentBuyerInvoiceCollection(client, stemId) {
  const { data, error } = await client
    .from('buyer_invoice_collection_items')
    .select(BUYER_COLLECTION_ITEM_SELECT)
    .eq('stem_id', stemId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function validateBuyerInvoiceCollectionUpdate(current, updates) {
  const merged = { ...(current || {}), ...updates };
  const status = normalizeCollectionStatus(merged.status);
  if (status === 'Promise to Pay') {
    if (!merged.promised_payment_date) throw appError('Promised payment date is required for Promise to Pay.', 400);
    if (!(Number(merged.promised_amount) > 0)) throw appError('Promised payment amount must be greater than zero.', 400);
  }
  if (status === 'Payment Advice Received') {
    const currentStatus = current ? normalizeCollectionStatus(current.status) : 'To Contact';
    if (currentStatus !== status && !BUYER_COLLECTION_ADVICE_SOURCE_STATUSES.has(currentStatus)) {
      throw appError('Payment Advice Received may follow Awaiting Buyer, Promise to Pay, or Escalated.', 409);
    }
    if (!merged.advice_received_date) throw appError('Payment advice received date is required.', 400);
    if (!(Number(merged.advice_amount) > 0)) throw appError('Payment advice amount must be greater than zero.', 400);
    if (!merged.advice_verification_date) throw appError('Payment advice verification date is required.', 400);
    const documentIds = Array.isArray(merged.advice_document_ids) ? merged.advice_document_ids : [];
    if (!String(merged.advice_reference || '').trim() && !documentIds.length) {
      throw appError('Enter the buyer payment reference or upload the payment advice document.', 400);
    }
  }
  if (status === 'On Hold') {
    if (!String(merged.on_hold_reason || '').trim()) throw appError('A reason is required when putting a collection on hold.', 400);
    if (!merged.on_hold_review_date) throw appError('A review date is required when putting a collection on hold.', 400);
  }
  return merged;
}

async function persistBuyerInvoiceCollection(body, req, eventOverride = null, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const stemId = String(body.stemId || body.stem_id || '').trim();
  if (!stemId) throw appError('stemId is required.', 400);
  await requireInterofficeStemAccess(stemId, { client, profile });

  const current = await currentBuyerInvoiceCollection(client, stemId);
  const updates = normalizeCollectionUpdates(body.updates || body, profile);
  if (updates.status === 'Paid / Closed' && !Object.prototype.hasOwnProperty.call(updates, 'closure_source')) updates.closure_source = 'manual';
  if (updates.status && updates.status !== 'Paid / Closed' && !Object.prototype.hasOwnProperty.call(updates, 'closure_source')) updates.closure_source = null;
  validateBuyerInvoiceCollectionUpdate(current, updates);
  const eventInput = eventOverride || body.event || {};
  const eventPayload = {
    event_type: normalizeEventType(eventInput.eventType || eventInput.event_type || collectionEventTypeFromChanges(updates)),
    status: Object.prototype.hasOwnProperty.call(updates, 'status') ? updates.status : eventInput.status || null,
    owner_name: Object.prototype.hasOwnProperty.call(updates, 'owner_name') ? updates.owner_name : eventInput.ownerName || eventInput.owner_name || null,
    note: Object.prototype.hasOwnProperty.call(updates, 'latest_note') ? updates.latest_note : eventInput.note || null,
    next_follow_up_date: Object.prototype.hasOwnProperty.call(updates, 'next_follow_up_date') ? updates.next_follow_up_date : dateOrNull(eventInput.nextFollowUpDate || eventInput.next_follow_up_date),
    promised_payment_date: Object.prototype.hasOwnProperty.call(updates, 'promised_payment_date') ? updates.promised_payment_date : dateOrNull(eventInput.promisedPaymentDate || eventInput.promised_payment_date),
    promised_amount: Object.prototype.hasOwnProperty.call(updates, 'promised_amount') ? updates.promised_amount : decimalOrNull(eventInput.promisedAmount || eventInput.promised_amount),
    event_key: String(eventInput.eventKey || eventInput.event_key || '').trim() || null,
    metadata: {
      ...(eventInput.metadata && typeof eventInput.metadata === 'object' ? eventInput.metadata : {}),
      ...(Object.prototype.hasOwnProperty.call(updates, 'on_hold_reason') ? { onHoldReason: updates.on_hold_reason, onHoldReviewDate: updates.on_hold_review_date || null } : {}),
      ...(Object.prototype.hasOwnProperty.call(updates, 'advice_received_date') ? { adviceReceivedDate: updates.advice_received_date, adviceAmount: updates.advice_amount, adviceReference: updates.advice_reference, adviceVerificationDate: updates.advice_verification_date } : {}),
    },
  };
  const expectedUpdatedAt = body.expectedUpdatedAt || body.expected_updated_at || null;
  const { data, error } = await client.rpc('save_buyer_invoice_collection', {
    p_stem_id: stemId,
    p_updates: updates,
    p_event: eventPayload,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    throw error;
  }
  const item = data?.item;
  const event = data?.event;
  if (!item || !event) throw appError('Collection save did not return the updated workflow state.', 500);

  return {
    item: serializeCollectionItem(item),
    event: serializeCollectionEvent(event),
  };
}

async function buyerInvoiceCollectionSave(body, req, accessContext = null) {
  return persistBuyerInvoiceCollection(body, req, null, accessContext);
}

async function buyerInvoiceCollectionEventCreate(body, req, accessContext = null) {
  const event = body.event || {};
  const updates = {};
  if (event.status) updates.status = event.status;
  if (event.ownerName || event.owner_name) updates.ownerName = event.ownerName || event.owner_name;
  if (event.note) updates.latestNote = event.note;
  if (Object.prototype.hasOwnProperty.call(event, 'nextFollowUpDate') || Object.prototype.hasOwnProperty.call(event, 'next_follow_up_date')) {
    updates.nextFollowUpDate = event.nextFollowUpDate || event.next_follow_up_date;
  }
  if (Object.prototype.hasOwnProperty.call(event, 'promisedPaymentDate') || Object.prototype.hasOwnProperty.call(event, 'promised_payment_date')) {
    updates.promisedPaymentDate = event.promisedPaymentDate || event.promised_payment_date;
  }
  if (Object.prototype.hasOwnProperty.call(event, 'promisedAmount') || Object.prototype.hasOwnProperty.call(event, 'promised_amount')) {
    updates.promisedAmount = event.promisedAmount ?? event.promised_amount;
  }
  for (const [camel, snake] of [
    ['onHoldReason', 'on_hold_reason'],
    ['onHoldReviewDate', 'on_hold_review_date'],
    ['adviceReceivedDate', 'advice_received_date'],
    ['adviceAmount', 'advice_amount'],
    ['adviceReference', 'advice_reference'],
    ['adviceVerificationDate', 'advice_verification_date'],
    ['adviceDocumentIds', 'advice_document_ids'],
  ]) {
    if (Object.prototype.hasOwnProperty.call(event, camel) || Object.prototype.hasOwnProperty.call(event, snake)) {
      updates[camel] = event[camel] ?? event[snake];
    }
  }
  return persistBuyerInvoiceCollection({ ...body, updates }, req, event, accessContext);
}

const BUYER_COLLECTION_ITEM_SELECT = 'stem_id,status,owner_user_id,owner_name,latest_note,next_follow_up_date,promised_payment_date,promised_amount,on_hold_reason,on_hold_review_date,advice_received_date,advice_amount,advice_reference,advice_verification_date,advice_document_ids,reconciliation_state,verified_receivable_balance,latest_payment_snapshot,payment_reconciliation_snapshot,posting_reminder_override_reason,posting_reminder_override_by,posting_reminder_override_by_email,posting_reminder_override_at,posting_reminder_override_issue_key,previous_active_status,closure_source,last_reconciled_at,last_event_at,last_updated_by,last_updated_by_email,created_at,updated_at';

function collectionPaymentSnapshot(payment, { dateField, amountField, referenceFields }) {
  if (!payment) return null;
  return {
    paymentId: payment.Id,
    paymentName: payment.Name || null,
    paymentDate: (dateField && payment[dateField]) || payment.CreatedDate || null,
    amount: amountField ? incomingPaymentNumber(payment[amountField]) : null,
    currency: payment.CurrencyIsoCode || payment.Currency__c || null,
    reference: incomingPaymentReference(payment, referenceFields) || null,
  };
}

async function buyerCollectionSalesforceState(stemIds, accessContext = null) {
  const ids = [...new Set((stemIds || []).map((id) => String(id || '').trim()).filter(isSalesforceId))];
  if (!ids.length) return { stems: {}, buyerPayments: {}, latestPayments: {}, warnings: [] };
  const [stemDescribe, paymentDescribe] = await Promise.all([
    salesforceObjectFields({ objectName: 'stem__c' }),
    salesforceObjectFields({ objectName: 'Payment__c' }).catch(() => ({ fields: [] })),
  ]);
  const stemFieldNames = new Set((stemDescribe.fields || []).map((field) => field.name));
  if (!stemFieldNames.has('Receivable_Balance__c')) {
    throw appError('Payment Collections requires STEM__c.Receivable_Balance__c for live reconciliation.', 503);
  }
  const accountDescribe = stemFieldNames.has('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({ fields: [] }))
    : { fields: [] };
  const accountFieldNames = new Set((accountDescribe.fields || []).map((field) => field.name));
  const accessCondition = await interofficeStemAccessCondition(accessContext, [...stemFieldNames], [...accountFieldNames]);
  const dueFields = selectedFields(stemFieldNames, ['Invoice_Due_Date__c', 'Buyer_Pay_Term_Date__c', 'Due_Date__c']);
  const stemFields = [
    'Id',
    'Name',
    'Receivable_Balance__c',
    ...selectedFields(stemFieldNames, [
      'KeyStem__c',
      'Payment_Date__c',
      'CurrencyIsoCode',
      'ETA_Start_Date__c',
      'ETA_End_Date__c',
      'Delivery_Date__c',
      'Delivery_Date_Or_Expected__c',
      'Expected_Delivery_Date__c',
      'Payment_Term__c',
      'Buyer_Name__c',
      'Buyer__c',
      'Dispute_Status__c',
    ]),
    ...dueFields,
  ];
  if (stemFieldNames.has('Vessel__c')) stemFields.push('Vessel__r.Name');
  if (stemFieldNames.has('Port__c')) stemFields.push('Port__r.Name');
  if (stemFieldNames.has('Account__c')) {
    stemFields.push('Account__c', 'Account__r.Name');
    if (accountFieldNames.has('Group_Name__c')) stemFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.has('ParentId')) stemFields.push('Account__r.ParentId', 'Account__r.Parent.Name');
  }
  const stemRows = (await compositeQueryRows(chunkIds(ids).map((chunk) => ({
    soql: `SELECT ${[...new Set(stemFields)].join(', ')} FROM stem__c WHERE ${combineWhereConditions([`Id IN (${chunk.map((id) => `'${escapeSoql(id)}'`).join(',')})`, accessCondition])} LIMIT 5000`,
    limit: 5000,
    softFail: false,
  })))).flat();
  const stems = Object.fromEntries(stemRows.map((stem) => [stem.Id, stem]));

  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  if (!paymentFieldNames.has('STEM__c')) {
    return { stems, buyerPayments: {}, latestPayments: {}, warnings: ['Payment__c.STEM__c is unavailable; balances remain authoritative but payment evidence cannot be linked.'] };
  }
  const dateField = firstAvailableField(paymentFieldNames, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const amountField = firstAvailableField(paymentFieldNames, ['Amount__c', 'Payment_Amount__c', 'Paid_Amount__c', 'Received_Amount__c', 'Total_Amount__c', 'Amount_Paid__c', 'Payment_Value__c', 'Actual_Amount__c']);
  const referenceFields = incomingPaymentReferenceFields(paymentFields);
  const statusFields = selectedFields(paymentFieldNames, ['Status__c', 'Payment_Status__c']);
  const typeFields = selectedFields(paymentFieldNames, ['Type__c', 'Payment_Type__c']);
  const directionFields = incomingPaymentDirectionFields(paymentFields);
  const supplierInvoiceFields = incomingPaymentSupplierInvoiceFields(paymentFields);
  const selectFields = [
    'Id',
    'Name',
    'STEM__c',
    'CreatedDate',
    ...selectedFields(paymentFieldNames, ['RecordTypeId', 'CurrencyIsoCode', 'Currency__c']),
    paymentFieldNames.has('RecordTypeId') ? 'RecordType.Name' : null,
    paymentFieldNames.has('RecordTypeId') ? 'RecordType.DeveloperName' : null,
    dateField,
    amountField,
    ...referenceFields,
    ...statusFields,
    ...typeFields,
    ...directionFields,
    ...supplierInvoiceFields,
  ].filter(Boolean);
  const paymentRows = (await compositeQueryRows(chunkIds(Object.keys(stems)).map((chunk) => ({
    soql: `SELECT ${[...new Set(selectFields)].join(', ')} FROM Payment__c WHERE STEM__c IN (${chunk.map((id) => `'${escapeSoql(id)}'`).join(',')}) ORDER BY ${dateField || 'CreatedDate'} DESC NULLS LAST, CreatedDate DESC LIMIT 5000`,
    limit: 5000,
    softFail: true,
  })))).flat();
  const buyerPayments = {};
  for (const payment of paymentRows) {
    if (!payment.STEM__c) continue;
    if (incomingPaymentSupplierInvoiceId(payment, supplierInvoiceFields)) continue;
    if (incomingPaymentIsReceivableRemittance(payment, [...referenceFields, ...directionFields, ...typeFields, ...statusFields])) continue;
    const paymentType = incomingPaymentTypeFromContext(payment, {
      amount: amountField ? incomingPaymentNumber(payment[amountField]) : null,
      stem: stems[payment.STEM__c],
      supplierInvoice: null,
      supplierInvoiceFields,
      directionFields,
      typeFields,
      statusFields,
    });
    if (paymentType !== 'Buyer Payment') continue;
    const snapshot = collectionPaymentSnapshot(payment, { dateField, amountField, referenceFields });
    if (!(Number(snapshot?.amount) > 0) || !snapshot?.paymentDate) continue;
    if (!buyerPayments[payment.STEM__c]) buyerPayments[payment.STEM__c] = [];
    buyerPayments[payment.STEM__c].push(snapshot);
  }
  const latestPayments = {};
  for (const [stemId, payments] of Object.entries(buyerPayments)) {
    payments.sort((left, right) => (
      String(left.paymentDate).localeCompare(String(right.paymentDate))
      || String(left.paymentId || '').localeCompare(String(right.paymentId || ''))
    ));
    latestPayments[stemId] = payments.at(-1) || null;
  }
  return { stems, buyerPayments, latestPayments, warnings: [], dueFields };
}

function paymentPostingIssueNote(issue) {
  if (!issue) return null;
  const amounts = `baseline ${issue.baselineBalance.toFixed(2)}, detected payments ${issue.detectedPaymentAmount.toFixed(2)}, expected balance ${issue.expectedBalance.toFixed(2)}, current balance ${issue.currentBalance.toFixed(2)}`;
  if (issue.state === 'payment_posting_pending') return `Buyer payment posting is pending: ${amounts}. No receivable-balance movement was detected.`;
  if (issue.state === 'payment_posting_overdue') return `Buyer payment posting is overdue after ${issue.businessDaysOpen} Hong Kong business day(s): ${amounts}.`;
  if (issue.state === 'payment_partially_posted') return `Buyer payment was only partly posted: ${amounts}, leaving ${issue.unpostedAmount.toFixed(2)} unposted.`;
  return `Buyer payment and receivable balance do not reconcile: ${amounts}, difference ${issue.differenceAmount.toFixed(2)}.`;
}

function buyerCollectionReconciliationDecision(item, stem, latestPayment, posting, thresholdPolicy, today) {
  const currentStatus = normalizeCollectionStatus(item.status);
  const balance = incomingPaymentNumber(stem?.Receivable_Balance__c);
  if (balance == null) {
    return { status: currentStatus, state: 'balance_unavailable', balance: null, paymentReconciliationSnapshot: posting.snapshot, eventType: currentStatus === 'Paid / Closed' && item.reconciliation_state !== 'balance_unavailable' ? 'reconciliation_warning' : null, note: 'Salesforce receivable balance is unavailable.' };
  }
  const settled = paymentCollectionBalanceIsSettled(balance, thresholdPolicy);
  const thresholdLabel = thresholdPolicy.configured
    ? `${thresholdPolicy.threshold.toFixed(4)} ${thresholdPolicy.currencyIsoCode || ''}`.trim()
    : `<0.005 ${thresholdPolicy.currencyIsoCode || ''}`.trim();
  if (settled && currentStatus !== 'Paid / Closed') {
    return { status: 'Paid / Closed', state: 'settled', balance, paymentReconciliationSnapshot: posting.snapshot, closureSource: 'system', previousActiveStatus: currentStatus, eventType: 'auto_closed', note: `Salesforce receivable balance ${balance.toFixed(2)} is within the fully-paid threshold ${thresholdLabel}.` };
  }
  if (settled && currentStatus === 'Paid / Closed') {
    return { status: currentStatus, state: 'settled', balance, paymentReconciliationSnapshot: posting.snapshot, eventType: null, note: null };
  }
  if (!settled && currentStatus === 'Paid / Closed' && item.closure_source === 'system') {
    const previous = BUYER_INVOICE_COLLECTION_STATUSES.includes(item.previous_active_status) && item.previous_active_status !== 'Paid / Closed' ? item.previous_active_status : 'To Contact';
    return { status: previous, state: 'reopened', balance, paymentReconciliationSnapshot: posting.snapshot, closureSource: null, previousActiveStatus: null, eventType: 'auto_reopened', note: `Salesforce receivable balance returned to ${balance.toFixed(2)}.` };
  }
  if (!settled && currentStatus === 'Paid / Closed') {
    return { status: currentStatus, state: 'manual_closure_mismatch', balance, paymentReconciliationSnapshot: posting.snapshot, eventType: item.reconciliation_state === 'manual_closure_mismatch' ? null : 'reconciliation_warning', note: `The manually closed collection has an open Salesforce balance of ${balance.toFixed(2)}.` };
  }

  const newPayment = latestPayment?.paymentId && latestPayment.paymentId !== item.latest_payment_snapshot?.paymentId;
  const wasPostingIssue = PAYMENT_POSTING_ISSUE_STATES.has(String(item.reconciliation_state || ''));
  if (PAYMENT_POSTING_ISSUE_STATES.has(posting.state)) {
    const issueChanged = item.payment_reconciliation_snapshot?.issueKey !== posting.issue?.issueKey;
    return {
      status: currentStatus,
      state: posting.state,
      balance,
      paymentReconciliationSnapshot: posting.snapshot,
      paymentPostingIssue: posting.issue,
      eventType: newPayment ? 'payment_detected' : issueChanged || item.reconciliation_state !== posting.state ? 'reconciliation_warning' : null,
      eventIdentity: `${posting.state}:${posting.issue?.issueKey || latestPayment?.paymentId || 'posting'}`,
      note: paymentPostingIssueNote(posting.issue),
    };
  }

  const postingResolved = wasPostingIssue && !PAYMENT_POSTING_ISSUE_STATES.has(posting.state);
  if (currentStatus === 'Payment Advice Received') {
    const overdue = Boolean(item.advice_verification_date && item.advice_verification_date <= today);
    return {
      status: currentStatus,
      state: overdue ? 'advice_overdue' : 'advice_pending',
      balance,
      paymentReconciliationSnapshot: posting.snapshot,
      eventType: postingResolved ? 'reconciliation_resolved' : overdue && item.reconciliation_state !== 'advice_overdue' ? 'reconciliation_warning' : null,
      note: postingResolved ? 'The detected buyer payments now reconcile to the Salesforce receivable balance.' : overdue ? 'Payment advice has not posted to the Salesforce receivable balance by its verification date.' : null,
    };
  }
  return {
    status: currentStatus,
    state: posting.state,
    balance,
    paymentReconciliationSnapshot: posting.snapshot,
    eventType: postingResolved ? 'reconciliation_resolved' : newPayment ? 'payment_detected' : null,
    note: postingResolved
      ? 'The detected buyer payments now reconcile to the Salesforce receivable balance.'
      : newPayment
        ? 'A buyer payment was detected and reconciled to the current Salesforce receivable balance.'
        : null,
  };
}

function collectionReconciliationChanged(item, decision, latestPayment, overrideValues) {
  const sameNumber = (left, right) => {
    const a = incomingPaymentNumber(left);
    const b = incomingPaymentNumber(right);
    return a == null && b == null ? true : a != null && b != null && Math.abs(a - b) < 0.005;
  };
  return (
    normalizeCollectionStatus(item.status) !== decision.status
    || String(item.reconciliation_state || '') !== String(decision.state || '')
    || !sameNumber(item.verified_receivable_balance, decision.balance)
    || JSON.stringify(item.latest_payment_snapshot || null) !== JSON.stringify(latestPayment || null)
    || JSON.stringify(item.payment_reconciliation_snapshot || null) !== JSON.stringify(decision.paymentReconciliationSnapshot || null)
    || String(item.posting_reminder_override_issue_key || '') !== String(overrideValues.posting_reminder_override_issue_key || '')
    || (Object.prototype.hasOwnProperty.call(decision, 'closureSource') && (item.closure_source || null) !== (decision.closureSource || null))
    || (Object.prototype.hasOwnProperty.call(decision, 'previousActiveStatus') && (item.previous_active_status || null) !== (decision.previousActiveStatus || null))
  );
}

async function reconcileBuyerInvoiceCollections({ client, profile = null, accessContext = null, stemIds = null } = {}) {
  let query = client.from('buyer_invoice_collection_items').select(BUYER_COLLECTION_ITEM_SELECT).order('updated_at', { ascending: false }).limit(5000);
  const requestedIds = Array.isArray(stemIds) ? [...new Set(stemIds.map((id) => String(id || '').trim()).filter(isSalesforceId))] : [];
  if (requestedIds.length) query = query.in('stem_id', requestedIds);
  const { data: items, error } = await query;
  if (error) throw error;
  if (!(items || []).length) return { items: [], exceptions: [], summary: { checked: 0, closed: 0, reopened: 0, exceptions: 0 }, warnings: [] };
  const thresholdState = await loadPaymentCollectionThresholds(client);
  const today = hongKongScheduleParts().date;
  const reconciliationNow = new Date();
  const live = await buyerCollectionSalesforceState(items.map((item) => item.stem_id), accessContext);
  const reconciled = [];
  const exceptions = [];
  let closed = 0;
  let reopened = 0;
  for (const item of items) {
    const stem = live.stems[item.stem_id];
    if (!stem) continue;
    const thresholdPolicy = paymentCollectionThresholdPolicy(thresholdState, stem.CurrencyIsoCode);
    const buyerPayments = live.buyerPayments[item.stem_id] || [];
    const latestPayment = live.latestPayments[item.stem_id] || null;
    const posting = reconcileBuyerPaymentPosting({
      previousSnapshot: item.payment_reconciliation_snapshot,
      previousBalance: item.verified_receivable_balance,
      currentBalance: stem.Receivable_Balance__c,
      payments: buyerPayments,
      fullyPaidThreshold: thresholdPolicy.threshold,
      fullyPaidThresholdInclusive: thresholdPolicy.inclusive,
      now: reconciliationNow,
    });
    const decision = buyerCollectionReconciliationDecision(item, stem, latestPayment, posting, thresholdPolicy, today);
    const paymentEvidenceSummary = summarizeBuyerPaymentEvidence({
      payments: buyerPayments,
      etaStartDate: stem.ETA_Start_Date__c,
      etaEndDate: stem.ETA_End_Date__c,
      deliveryDate: stem.Delivery_Date__c,
      isFullyPaid: decision.balance != null && paymentCollectionBalanceIsSettled(decision.balance, thresholdPolicy),
    });
    const paymentEvidence = paymentEvidenceSummary.latestEvidence;
    const nowIso = reconciliationNow.toISOString();
    const overrideMatchesIssue = Boolean(
      posting.issue?.issueKey
      && item.posting_reminder_override_issue_key === posting.issue.issueKey
      && item.posting_reminder_override_reason,
    );
    const overrideValues = {
      posting_reminder_override_reason: overrideMatchesIssue ? item.posting_reminder_override_reason : null,
      posting_reminder_override_by: overrideMatchesIssue ? item.posting_reminder_override_by : null,
      posting_reminder_override_by_email: overrideMatchesIssue ? item.posting_reminder_override_by_email : null,
      posting_reminder_override_at: overrideMatchesIssue ? item.posting_reminder_override_at : null,
      posting_reminder_override_issue_key: overrideMatchesIssue ? item.posting_reminder_override_issue_key : null,
    };
    const updates = {
      status: decision.status,
      reconciliation_state: decision.state,
      verified_receivable_balance: decision.balance,
      latest_payment_snapshot: latestPayment,
      payment_reconciliation_snapshot: decision.paymentReconciliationSnapshot,
      ...overrideValues,
      last_reconciled_at: nowIso,
    };
    if (Object.prototype.hasOwnProperty.call(decision, 'closureSource')) updates.closure_source = decision.closureSource;
    if (Object.prototype.hasOwnProperty.call(decision, 'previousActiveStatus')) updates.previous_active_status = decision.previousActiveStatus;
    const transition = decision.status !== normalizeCollectionStatus(item.status);
    const stateChanged = collectionReconciliationChanged(item, decision, latestPayment, overrideValues);
    let savedItem = null;
    let savedEvent = null;
    if (decision.eventType) {
      const eventIdentity = decision.eventIdentity || latestPayment?.paymentId || `${decision.state}:${item.updated_at}`;
      const { data, error: saveError } = await client.rpc('save_buyer_invoice_collection', {
        p_stem_id: item.stem_id,
        p_updates: updates,
        p_event: {
          event_type: decision.eventType,
          event_key: `${decision.eventType}:${eventIdentity}`,
          status: decision.status,
          note: decision.note,
          metadata: {
            verifiedReceivableBalance: decision.balance,
            fullyPaidThreshold: thresholdPolicy.threshold,
            fullyPaidThresholdInclusive: thresholdPolicy.inclusive,
            fullyPaidThresholdConfigured: thresholdPolicy.configured,
            currencyIsoCode: thresholdPolicy.currencyIsoCode,
            latestPayment,
            paymentEvidence,
            paymentEvidenceSummary: {
              paymentCount: paymentEvidenceSummary.paymentCount,
              totalReceivedAmount: paymentEvidenceSummary.totalReceivedAmount,
              ciaReceivedAmount: paymentEvidenceSummary.ciaReceivedAmount,
              otherReceivedAmount: paymentEvidenceSummary.otherReceivedAmount,
              earliestEtaDate: paymentEvidenceSummary.earliestEtaDate,
              actualDeliveryDate: paymentEvidenceSummary.actualDeliveryDate,
            },
            paymentPostingIssue: decision.paymentPostingIssue || null,
            reconciliationState: decision.state,
          },
        },
        p_actor_user_id: profile?.id || null,
        p_actor_email: profile?.email || 'FCOS system',
        p_expected_updated_at: item.updated_at,
      });
      if (saveError) {
        const message = String(saveError.message || '');
        if (!message.includes('buyer_invoice_collection_events_event_key_idx') && !message.includes('changed after it was opened')) {
          throw saveError;
        }
        const { data: latestItem, error: latestError } = await client
          .from('buyer_invoice_collection_items')
          .select(BUYER_COLLECTION_ITEM_SELECT)
          .eq('stem_id', item.stem_id)
          .maybeSingle();
        if (latestError) throw latestError;
        savedItem = latestItem || item;
      } else {
        savedItem = data?.item || null;
        savedEvent = data?.event || null;
      }
    } else if (stateChanged) {
      const { data, error: updateError } = await client
        .from('buyer_invoice_collection_items')
        .update({
          reconciliation_state: decision.state,
          verified_receivable_balance: decision.balance,
          latest_payment_snapshot: latestPayment,
          payment_reconciliation_snapshot: decision.paymentReconciliationSnapshot,
          ...overrideValues,
          last_reconciled_at: nowIso,
          last_updated_by: profile?.id || null,
          last_updated_by_email: profile?.email || 'FCOS system',
          updated_at: nowIso,
        })
        .eq('stem_id', item.stem_id)
        .eq('updated_at', item.updated_at)
        .select(BUYER_COLLECTION_ITEM_SELECT)
        .maybeSingle();
      if (updateError) throw updateError;
      if (data) {
        savedItem = data;
      } else {
        const { data: latestItem, error: latestError } = await client
          .from('buyer_invoice_collection_items')
          .select(BUYER_COLLECTION_ITEM_SELECT)
          .eq('stem_id', item.stem_id)
          .maybeSingle();
        if (latestError) throw latestError;
        savedItem = latestItem || item;
      }
    } else {
      savedItem = {
        ...item,
        reconciliation_state: decision.state,
        verified_receivable_balance: decision.balance,
        latest_payment_snapshot: latestPayment,
        payment_reconciliation_snapshot: decision.paymentReconciliationSnapshot,
        ...overrideValues,
        last_reconciled_at: nowIso,
      };
    }
    if (transition && decision.status === 'Paid / Closed') closed += 1;
    if (transition && decision.state === 'reopened') reopened += 1;
    const serialized = {
      item: serializeCollectionItem(savedItem),
      event: serializeCollectionEvent(savedEvent),
      stemName: formatStemName(stem),
      buyerAccountId: stem.Account__c || null,
      buyerName: incomingPaymentBuyerName(stem),
      buyerGroupName: incomingPaymentBuyerGroup(stem),
      disputeStatus: stem.Dispute_Status__c || null,
      buyerInvoiceDueDate: calculatedBuyerPayTermDate(stem) || stem.Invoice_Due_Date__c || stem.Due_Date__c || stem.Buyer_Pay_Term_Date__c || earliestDate((live.dueFields || []).map((field) => stem[field])),
      currency: stem.CurrencyIsoCode || latestPayment?.currency || 'USD',
      latestPayment,
      earliestEtaDate: earliestEtaDate(stem.ETA_Start_Date__c, stem.ETA_End_Date__c),
      actualDeliveryDate: stem.Delivery_Date__c || null,
      paymentEvidence,
      paymentEvidenceSummary,
      paymentPostingIssue: decision.paymentPostingIssue || null,
    };
    reconciled.push(serialized);
    if (['advice_overdue', 'balance_unavailable', 'manual_closure_mismatch', 'payment_posting_pending', 'payment_partially_posted', 'payment_posting_mismatch', 'payment_posting_overdue', 'reopened'].includes(decision.state)) exceptions.push(serialized);
  }
  return { items: reconciled, exceptions, summary: { checked: reconciled.length, closed, reopened, exceptions: exceptions.length }, warnings: live.warnings };
}

async function paymentCollectionsReconcile(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const context = accessContext || { client, profile };
  const result = await reconcileBuyerInvoiceCollections({ client, profile, accessContext: context, stemIds: body.stemIds });
  const stemAccessCondition = isInterofficeAccess(context)
    ? await interofficeStemAccessCondition(context)
    : null;
  const shipAgentCharges = await syncShipAgentCharges({ ...context, stemAccessCondition }, { stemIds: body.stemIds });
  return {
    ...result,
    shipAgentCharges,
    capabilities: {
      canOverridePostingReminder: canOverridePaymentPostingReminder(profile),
    },
  };
}

async function shipAgentChargesContext(req, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const stemAccessCondition = isInterofficeAccess(context)
    ? await interofficeStemAccessCondition(context)
    : null;
  return { ...context, stemAccessCondition };
}

async function requireShipAgentStemAccess(body, context) {
  const stemId = String(body?.stemId || '').trim();
  if (!isSalesforceId(stemId)) throw appError('A valid Salesforce STEM is required.', 400);
  await requireInterofficeStemAccess(stemId, context);
  return stemId;
}

async function recordLegacyVariableChargeTraffic(context, handler) {
  const { error } = await context.client.from('variable_charge_legacy_traffic').insert({
    handler,
    actor_user_id: context.profile?.id || null,
  });
  if (error && !/does not exist|schema cache/i.test(String(error.message || ''))) throw error;
}

async function shipAgentChargesList(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await recordLegacyVariableChargeTraffic(context, 'shipAgentChargesList');
  return listShipAgentCharges(body, context);
}

async function shipAgentChargesDetail(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await recordLegacyVariableChargeTraffic(context, 'shipAgentChargesDetail');
  await requireShipAgentStemAccess(body, context);
  return getShipAgentChargeDetail(body, context);
}

async function shipAgentChargesOptions(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await recordLegacyVariableChargeTraffic(context, 'shipAgentChargesOptions');
  return shipAgentChargeOptions(body, context);
}

async function shipAgentChargesSaveConfirm(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await recordLegacyVariableChargeTraffic(context, 'shipAgentChargesSaveConfirm');
  await requireShipAgentStemAccess(body, context);
  return saveAndConfirmShipAgentCharges(body, context);
}

async function shipAgentChargesGmOverride(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await recordLegacyVariableChargeTraffic(context, 'shipAgentChargesGmOverride');
  await requireShipAgentStemAccess(body, context);
  return overrideShipAgentChargeAssignment(body, context);
}

async function shipAgentChargesPostInvoiceResolve(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await recordLegacyVariableChargeTraffic(context, 'shipAgentChargesPostInvoiceResolve');
  await requireShipAgentStemAccess(body, context);
  return resolveShipAgentPostInvoiceChange(body, context);
}

async function shipAgentChargesSync(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await recordLegacyVariableChargeTraffic(context, 'shipAgentChargesSync');
  const stemIds = Array.isArray(body?.stemIds) ? body.stemIds : null;
  if (stemIds?.length) {
    for (const stemId of stemIds) await requireShipAgentStemAccess({ stemId }, context);
  }
  return syncShipAgentCharges(context, { stemIds });
}

async function variableChargesList(body, req, accessContext = null) {
  return listVariableCharges(body, await shipAgentChargesContext(req, accessContext));
}

async function variableChargesDetail(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await requireShipAgentStemAccess(body, context);
  return getVariableChargeDetail(body, context);
}

async function variableChargesOptions(body, req, accessContext = null) {
  return variableChargeOptions(body, await shipAgentChargesContext(req, accessContext));
}

async function variableChargesSupplierVerify(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await requireShipAgentStemAccess(body, context);
  if (!isSalesforceId(String(body?.supplierId || '').trim())) throw appError('A valid exact Supplier Account is required.', 400);
  return verifyVariableChargeSupplier(body, context);
}

async function variableChargesBuyerConfirm(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await requireShipAgentStemAccess(body, context);
  return confirmVariableChargeBuyer(body, context);
}

async function variableChargesGmOverride(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await requireShipAgentStemAccess(body, context);
  return overrideVariableChargeAssignment(body, context);
}

async function variableChargesPostInvoiceResolve(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await requireShipAgentStemAccess(body, context);
  return resolveVariableChargePostInvoiceChange(body, context);
}

async function variableChargesSync(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  const stemIds = Array.isArray(body?.stemIds) ? body.stemIds : null;
  if (stemIds?.length) for (const stemId of stemIds) await requireShipAgentStemAccess({ stemId }, context);
  return syncVariableCharges(context, { stemIds });
}

async function buyerInvoicePostingReminderOverrideSave(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  if (!canOverridePaymentPostingReminder(profile)) {
    throw appError('Only Finance, an Administrator, or the General Manager may override a payment-posting reminder pause.', 403);
  }

  const stemId = String(body.stemId || '').trim();
  const issueKey = String(body.issueKey || '').trim();
  const operationId = String(body.operationId || '').trim();
  const reason = String(body.reason || '').trim();
  const allowReminder = body.allowReminder === true;
  if (!isSalesforceId(stemId)) throw appError('A valid Salesforce STEM is required.', 400);
  if (!issueKey) throw appError('The payment-posting issue identity is required. Refresh and try again.', 400);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(operationId)) throw appError('A valid operation identity is required.', 400);
  if (reason.length < 5 || reason.length > 1000) throw appError('Enter an override reason between 5 and 1,000 characters.', 400);

  const context = accessContext || { client, profile };
  await requireInterofficeStemAccess(stemId, context);
  const live = await reconcileBuyerInvoiceCollections({ client, profile, accessContext: context, stemIds: [stemId] });
  const liveEntry = live.items.find((entry) => entry.item?.stemId === stemId);
  const current = await currentBuyerInvoiceCollection(client, stemId);
  const currentIssueKey = String(current?.payment_reconciliation_snapshot?.issueKey || '');
  if (!current || !PAYMENT_POSTING_ISSUE_STATES.has(String(current.reconciliation_state || '')) || !currentIssueKey) {
    throw appError('The payment-posting exception is no longer active. Refresh the workspace.', 409);
  }
  if (currentIssueKey !== issueKey) {
    throw appError('The payment-posting exception changed after it was opened. Refresh and review the current amounts.', 409);
  }
  if (!allowReminder && !current.posting_reminder_override_reason) {
    throw appError('The reminder pause is already active for this payment-posting exception.', 409);
  }

  const nowIso = new Date().toISOString();
  const overrideUpdates = allowReminder ? {
    posting_reminder_override_reason: reason,
    posting_reminder_override_by: profile.id,
    posting_reminder_override_by_email: profile.email,
    posting_reminder_override_at: nowIso,
    posting_reminder_override_issue_key: currentIssueKey,
  } : {
    posting_reminder_override_reason: null,
    posting_reminder_override_by: null,
    posting_reminder_override_by_email: null,
    posting_reminder_override_at: null,
    posting_reminder_override_issue_key: null,
  };
  const issue = liveEntry?.paymentPostingIssue || current.payment_reconciliation_snapshot || {};
  const { data, error } = await client.rpc('save_buyer_invoice_collection', {
    p_stem_id: stemId,
    p_updates: overrideUpdates,
    p_event: {
      event_type: 'posting_reminder_override',
      event_key: `posting-reminder-override:${operationId}`,
      status: current.status,
      note: allowReminder
        ? `Finance allowed external reminders during the active payment-posting exception. Reason: ${reason}`
        : `Finance restored the external reminder pause. Reason: ${reason}`,
      metadata: {
        action: allowReminder ? 'allowed' : 'pause_restored',
        reconciliationState: current.reconciliation_state,
        issueKey: currentIssueKey,
        baselineBalance: issue.baselineBalance ?? null,
        detectedPaymentAmount: issue.detectedPaymentAmount ?? null,
        expectedBalance: issue.expectedBalance ?? null,
        currentBalance: issue.currentBalance ?? null,
        differenceAmount: issue.differenceAmount ?? null,
      },
    },
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_updated_at: current.updated_at,
  });
  if (error) {
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    throw error;
  }
  return {
    item: serializeCollectionItem(data?.item),
    event: serializeCollectionEvent(data?.event),
    capabilities: { canOverridePostingReminder: true },
  };
}

async function paymentCollectionsReconcileCron(body, req) {
  requireCronAuthorization(req);
  const client = safeSupabaseAdminClient();
  if (!client) throw appError('Supabase service configuration is required for Payment Collections reconciliation.', 503);
  const paymentReminderTimelines = await repairPaymentReminderTimelines(client, 50);
  const collections = await reconcileBuyerInvoiceCollections({ client, profile: null, accessContext: null });
  const shipAgentCharges = await syncShipAgentCharges({ client, profile: null });
  return { ...collections, paymentReminderTimelines, shipAgentCharges };
}

function paymentAdviceExtension(fileName) {
  const extension = String(fileName || '').split('.').pop()?.toLowerCase() || '';
  const allowed = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'msg']);
  return allowed.has(extension) ? extension : '';
}

async function buyerInvoicePaymentAdviceSave(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const stemId = String(body.stemId || '').trim();
  if (!isSalesforceId(stemId)) throw appError('Valid Salesforce STEM is required.', 400);
  await requireInterofficeStemAccess(stemId, accessContext || { client, profile });
  const current = await currentBuyerInvoiceCollection(client, stemId);
  const currentStatus = normalizeCollectionStatus(current?.status);
  if (!BUYER_COLLECTION_ADVICE_SOURCE_STATUSES.has(currentStatus)) {
    throw appError('Payment Advice Received may follow Awaiting Buyer, Promise to Pay, or Escalated.', 409);
  }
  const adviceReceivedDate = dateOrNull(body.adviceReceivedDate);
  const adviceAmount = decimalOrNull(body.adviceAmount);
  const adviceReference = String(body.adviceReference || '').trim();
  const adviceVerificationDate = dateOrNull(body.adviceVerificationDate);
  if (!adviceReceivedDate) throw appError('Payment advice received date is required.', 400);
  if (!(adviceAmount > 0)) throw appError('Payment advice amount must be greater than zero.', 400);
  if (!adviceVerificationDate) throw appError('Payment advice verification date is required.', 400);

  const adviceStemDescribe = await salesforceObjectFields({ objectName: 'stem__c' });
  const adviceStemFields = new Set((adviceStemDescribe.fields || []).map((field) => field.name));
  const stemRows = await queryRows(`SELECT Id, Name${adviceStemFields.has('CurrencyIsoCode') ? ', CurrencyIsoCode' : ''} FROM stem__c WHERE Id = '${escapeSoql(stemId)}' LIMIT 1`, { softFail: false });
  const stem = stemRows[0];
  if (!stem) throw appError('The selected STEM is no longer available in Salesforce.', 404);
  const adviceCurrency = stem.CurrencyIsoCode || null;

  const rawBase64 = String(body.base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!adviceReference && !rawBase64) throw appError('Enter the buyer payment reference or upload the payment advice document.', 400);
  let contentDocumentId = null;
  let contentVersionId = null;
  let document = null;
  if (rawBase64) {
    requireExternalActionGate('salesforce_write');
    const originalFileName = String(body.originalFileName || '').trim();
    const extension = paymentAdviceExtension(originalFileName);
    if (!extension) throw appError('Payment advice must be a PDF, image, Office, CSV, text, or Outlook message file.', 400);
    const buffer = Buffer.from(rawBase64, 'base64');
    if (!buffer.length) throw appError('Payment advice document is empty or invalid.', 400);
    if (buffer.length > BUYER_COLLECTION_DOCUMENT_MAX_BYTES) throw appError('Payment advice document is too large. Maximum size is 3 MB.', 413);
    const dateToken = adviceReceivedDate.replaceAll('-', '');
    const baseTitle = `${dateToken} Payment advice ${formatStemName(stem)}`.slice(0, 200);
    const existingLinks = await queryRows(`SELECT ContentDocument.Title FROM ContentDocumentLink WHERE LinkedEntityId = '${escapeSoql(stemId)}' LIMIT 2000`, { limit: 2000, softFail: true });
    const existingTitles = new Set(existingLinks.map((link) => String(link.ContentDocument?.Title || '').toLowerCase()));
    let title = baseTitle;
    for (let suffix = 1; existingTitles.has(title.toLowerCase()); suffix += 1) title = `${baseTitle}-${suffix}`;
    try {
      const contentVersion = await sfRequest('/sobjects/ContentVersion', {
        method: 'POST',
        body: { Title: title, PathOnClient: `/${title}.${extension}`, VersionData: buffer.toString('base64'), FirstPublishLocationId: stemId },
      });
      contentVersionId = contentVersion?.id;
      if (!isSalesforceId(contentVersionId)) throw appError('Salesforce did not return a ContentVersion id.', 502);
      const versions = await queryRows(`SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${escapeSoql(contentVersionId)}' LIMIT 1`, { softFail: false });
      contentDocumentId = versions[0]?.ContentDocumentId || null;
      if (!isSalesforceId(contentDocumentId)) throw appError('Salesforce did not return a ContentDocument id.', 502);
      document = {
        contentDocumentId,
        versionId: contentVersionId,
        fileName: `${title}.${extension}`,
        downloadUrl: `/api/functions/salesforceDocumentDownload?kind=contentVersion&id=${encodeURIComponent(contentVersionId)}&filename=${encodeURIComponent(`${title}.${extension}`)}`,
        salesforceUrl: `${getInstanceUrl()}/lightning/r/ContentDocument/${contentDocumentId}/view`,
      };
    } catch (error) {
      if (contentDocumentId) await sfRequest(`/sobjects/ContentDocument/${encodeURIComponent(contentDocumentId)}`, { method: 'DELETE' }).catch(() => null);
      else if (contentVersionId) await sfRequest(`/sobjects/ContentVersion/${encodeURIComponent(contentVersionId)}`, { method: 'DELETE' }).catch(() => null);
      throw error;
    }
  }

  const documentIds = [...new Set([...(current?.advice_document_ids || []), contentDocumentId].filter(isSalesforceId))];
  try {
    const result = await persistBuyerInvoiceCollection({
      stemId,
      expectedUpdatedAt: body.expectedUpdatedAt || current?.updated_at || null,
      updates: {
        status: 'Payment Advice Received',
        adviceReceivedDate,
        adviceAmount,
        adviceReference,
        adviceVerificationDate,
        adviceDocumentIds: documentIds,
        nextFollowUpDate: adviceVerificationDate,
      },
      event: {
        eventType: 'payment_advice',
        note: adviceReference ? `Payment advice received. Reference: ${adviceReference}` : 'Payment advice document received.',
        metadata: { adviceReceivedDate, adviceAmount, adviceReference: adviceReference || null, adviceVerificationDate, currency: adviceCurrency, document },
      },
    }, req, null, accessContext || { client, profile });
    if (document) await expireRuntimeCacheTags(['salesforce:documents', `salesforce:documents:${stemId}`]);
    return { ...result, document };
  } catch (error) {
    if (contentDocumentId) await sfRequest(`/sobjects/ContentDocument/${encodeURIComponent(contentDocumentId)}`, { method: 'DELETE' }).catch(() => null);
    throw error;
  }
}

async function salesforceSchema() {
  const data = await sfRequest('/sobjects/');
  const objects = (data.sobjects || [])
    .filter((o) => o.queryable)
    .map((o) => ({
      name: o.name,
      label: o.label,
      queryable: o.queryable,
      custom: o.custom,
    }));
  return { objects };
}

async function salesforceObjectFields(body) {
  const { objectName } = body;
  if (!objectName) throw new Error('objectName required');
  const normalizedObjectName = String(objectName).trim();
  const cached = await getOrLoadRuntimeCache({
    namespace: 'salesforce-describe',
    version: '1',
    accessScope: 'schema',
    apiVersion: salesforceCacheApiIdentity(),
    payload: { objectName: normalizedObjectName.toLowerCase() },
    ttlSeconds: 6 * 60 * 60,
    tags: ['salesforce:schema', `salesforce:schema:${normalizedObjectName.toLowerCase()}`],
    force: body.forceRefresh === true,
    loader: async () => {
      const data = await sfRequest(`/sobjects/${encodeURIComponent(normalizedObjectName)}/describe/`);
      const fields = (data.fields || []).map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        filterable: f.filterable,
        sortable: f.sortable,
        groupable: f.groupable,
        aggregatable: f.aggregatable,
        custom: f.custom,
        length: f.length || 0,
        updateable: f.updateable === true,
        createable: f.createable === true,
        nillable: f.nillable === true,
        relationshipName: f.relationshipName || null,
        referenceTo: f.referenceTo || [],
      }));
      const childRelationships = (data.childRelationships || [])
        .filter((r) => r.relationshipName && r.childSObject)
        .map((r) => ({
          relationshipName: r.relationshipName,
          childSObject: r.childSObject,
          field: r.field,
        }));
      return {
        objectName: normalizedObjectName,
        label: data.label,
        fields,
        childRelationships,
      };
    },
  });
  return cached.value;
}

const DASHBOARD_AI_SETTINGS_ID = 'default';

function serializeDashboardAiSettings(row = null, storageAvailable = true) {
  const configuredModel = isAllowedDashboardAiModel(row?.model_id) ? row.model_id : DEFAULT_DASHBOARD_AI_MODEL;
  return {
    modelId: configuredModel,
    model: dashboardAiModel(configuredModel),
    revision: Math.max(1, Number(row?.revision || 1)),
    updatedAt: row?.updated_at || null,
    updatedByEmail: row?.updated_by_email || null,
    storageAvailable,
    apiConfigured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
  };
}

async function loadDashboardAiSettings(client = safeSupabaseAdminClient()) {
  if (!client) return serializeDashboardAiSettings(null, false);
  const { data, error } = await client.from('dashboard_ai_settings').select('id,model_id,revision,updated_at,updated_by_email').eq('id', DASHBOARD_AI_SETTINGS_ID).maybeSingle();
  if (error) return serializeDashboardAiSettings(null, false);
  return serializeDashboardAiSettings(data, true);
}

function emptyDashboardAiUsage(modelId) {
  return {
    modelId,
    monthCalls: 0,
    monthCostUsd: 0,
    monthInputTokens: 0,
    monthOutputTokens: 0,
    allTimeCalls: 0,
    allTimeCostUsd: 0,
    allTimeInputTokens: 0,
    allTimeOutputTokens: 0,
    lastUsedAt: null,
  };
}

function dashboardAiUsageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

async function loadDashboardAiUsage(client = safeSupabaseAdminClient()) {
  const today = dateOnly(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthLabel = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Hong_Kong',
  }).format(new Date(`${monthStart}T00:00:00+08:00`));
  const fallback = {
    available: false,
    currency: 'USD',
    monthStart,
    monthLabel,
    models: DASHBOARD_AI_MODELS.map((model) => emptyDashboardAiUsage(model.id)),
  };
  if (!client) return fallback;
  const { data, error } = await client.rpc('dashboard_ai_usage_summary', {
    p_month_start: monthStart,
  });
  if (error || !Array.isArray(data)) return fallback;
  const byModel = new Map(data.map((row) => [row.model_id, row]));
  return {
    ...fallback,
    available: true,
    models: DASHBOARD_AI_MODELS.map((model) => {
      const row = byModel.get(model.id);
      if (!row) return emptyDashboardAiUsage(model.id);
      return {
        modelId: model.id,
        monthCalls: dashboardAiUsageNumber(row.month_calls),
        monthCostUsd: dashboardAiUsageNumber(row.month_cost_usd),
        monthInputTokens: dashboardAiUsageNumber(row.month_input_tokens),
        monthOutputTokens: dashboardAiUsageNumber(row.month_output_tokens),
        allTimeCalls: dashboardAiUsageNumber(row.all_time_calls),
        allTimeCostUsd: dashboardAiUsageNumber(row.all_time_cost_usd),
        allTimeInputTokens: dashboardAiUsageNumber(row.all_time_input_tokens),
        allTimeOutputTokens: dashboardAiUsageNumber(row.all_time_output_tokens),
        lastUsedAt: row.last_used_at || null,
      };
    }),
  };
}

async function recordDashboardAiUsage(client, profile, usage) {
  if (!client || !usage?.openAiResponseId || !isAllowedDashboardAiModel(usage.modelId)) return;
  const { error } = await client.from('dashboard_ai_usage_events').upsert(
    {
      openai_response_id: usage.openAiResponseId,
      model_id: usage.modelId,
      service_tier: usage.serviceTier,
      input_tokens: usage.inputTokens,
      cached_input_tokens: usage.cachedInputTokens,
      cache_write_input_tokens: usage.cacheWriteInputTokens,
      output_tokens: usage.outputTokens,
      reasoning_tokens: usage.reasoningTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: usage.estimatedCostUsd,
      pricing_as_of: usage.pricingAsOf,
      actor_id: profile?.id || null,
    },
    {
      onConflict: 'openai_response_id',
      ignoreDuplicates: true,
    },
  );
  if (error) throw error;
}

async function dashboardAiSettingsGet(body, req, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const [settings, usage] = await Promise.all([loadDashboardAiSettings(context.client), loadDashboardAiUsage(context.client)]);
  return {
    settings,
    models: DASHBOARD_AI_MODELS,
    usage,
    capabilities: {
      canManageSettings: isAdministratorUserType(context.profile.user_type),
    },
  };
}

async function dashboardAiSettingsSave(body, req) {
  const { client, profile } = await requireAdministrator(req);
  const modelId = String(body.modelId || body.model_id || '').trim();
  if (!isAllowedDashboardAiModel(modelId)) {
    throw appError('Select an allowed Dashboard AI model.', 400);
  }
  const expectedRevision = Number(body.expectedRevision ?? body.expected_revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw appError('The current Dashboard AI settings revision is required.', 400);
  }
  const { data: current, error: currentError } = await client.from('dashboard_ai_settings').select('id,model_id,revision,updated_at,updated_by_email').eq('id', DASHBOARD_AI_SETTINGS_ID).maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw appError('Dashboard AI settings storage is unavailable. Apply the database migration first.', 503);
  if (Number(current.revision) !== expectedRevision) {
    const error = appError('Dashboard AI settings changed in another session. Refresh before saving.', 409);
    error.details = { settings: serializeDashboardAiSettings(current, true) };
    throw error;
  }
  const updatedAt = new Date().toISOString();
  const { data, error } = await client
    .from('dashboard_ai_settings')
    .update({
      model_id: modelId,
      revision: expectedRevision + 1,
      updated_by: profile.id,
      updated_by_email: profile.email,
      updated_at: updatedAt,
    })
    .eq('id', DASHBOARD_AI_SETTINGS_ID)
    .eq('revision', expectedRevision)
    .select('id,model_id,revision,updated_at,updated_by_email')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const conflict = appError('Dashboard AI settings changed in another session. Refresh before saving.', 409);
    conflict.details = { settings: await loadDashboardAiSettings(client) };
    throw conflict;
  }
  await writeAdminAudit(client, profile, 'dashboard_ai_model_changed', null, null, {
    previousModelId: current.model_id,
    modelId,
    revision: expectedRevision + 1,
  });
  await expireRuntimeCacheTags(['dashboard:ai-interpretation']);
  return {
    settings: serializeDashboardAiSettings(data, true),
    models: DASHBOARD_AI_MODELS,
    usage: await loadDashboardAiUsage(client),
    capabilities: { canManageSettings: true },
  };
}

function dashboardAiSelectedPeriodLabel(selectedYears, selectedMonths) {
  const years = [...new Set((Array.isArray(selectedYears) ? selectedYears : []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const months = [...new Set((Array.isArray(selectedMonths) ? selectedMonths : []).map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))].sort((a, b) => a - b);
  const monthFormatter = new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    timeZone: 'Asia/Hong_Kong',
  });
  const monthLabels = months.map((month) => monthFormatter.format(new Date(Date.UTC(2026, month - 1, 1))));
  return `${years.join(', ') || 'Current year'} Â· ${monthLabels.join(', ') || 'Current month'}`;
}

function dashboardAiTrendYear(interpretation, selectedYears) {
  if (interpretation?.dateScope?.mode === 'range') {
    const startYear = Number(String(interpretation.dateScope.start || '').slice(0, 4));
    const endYear = Number(String(interpretation.dateScope.end || '').slice(0, 4));
    if (startYear && startYear === endYear) return startYear;
  }
  const years = [...new Set((Array.isArray(selectedYears) ? selectedYears : []).map(Number).filter(Number.isInteger))];
  return years.length === 1 ? years[0] : new Date().getFullYear();
}

async function dashboardAiSearch(body, req, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const prompt = normalizeDashboardAiPrompt(body.prompt);
  const clarification = String(body.clarification || '')
    .trim()
    .slice(0, 200);
  const currentYear = new Date().getFullYear();
  const selectedYears = Array.isArray(body.selectedYears) && body.selectedYears.length ? body.selectedYears : [currentYear];
  const selectedMonths = Array.isArray(body.selectedMonths) && body.selectedMonths.length ? body.selectedMonths : [new Date().getMonth() + 1];
  const selectedPeriodLabel = dashboardAiSelectedPeriodLabel(selectedYears, selectedMonths);
  const settings = await loadDashboardAiSettings(context.client);
  if (!settings.apiConfigured) throw appError('Dashboard AI Search is not configured in Vercel.', 503);
  const force = requestForcesRefresh(body, req);
  const safetyIdentifier = `fcos-dashboard-${createHash('sha256').update(String(context.profile.id)).digest('hex').slice(0, 32)}`;
  const interpretationResult = await getOrLoadRuntimeCache({
    namespace: 'dashboard-ai-interpretation',
    version: '1',
    accessScope: salesforceCacheAccessScope(context),
    apiVersion: settings.modelId,
    payload: {
      modelId: settings.modelId,
      prompt,
      clarification,
    },
    ttlSeconds: 5 * 60,
    tags: ['dashboard:ai-interpretation'],
    force,
    loader: () =>
      interpretDashboardAiSearch({
        prompt,
        clarification,
        modelId: settings.modelId,
        selectedPeriodLabel,
        today: dateOnly(new Date()),
        safetyIdentifier,
        signal: AbortSignal.timeout(15_000),
        onUsage: (usage) => recordDashboardAiUsage(context.client, context.profile, usage),
      }),
  });
  const interpretation = interpretationResult.value;
  const baseAiSearch = {
    status: interpretation.status,
    interpretation: interpretation.interpretation,
    chips: interpretation.chips,
    includeCancelled: interpretation.includeCancelled,
    dateScope: {
      ...interpretation.dateScope,
      label: interpretation.dateScope.mode === 'selected_period' ? selectedPeriodLabel : interpretation.dateScope.label,
    },
    clarification: interpretation.clarification,
    model: settings.model,
    modelId: settings.modelId,
    interpretationCache: interpretationResult.cache.status,
  };
  if (interpretation.status === 'needs_clarification') {
    return { aiSearch: baseAiSearch };
  }
  if (interpretation.status === 'unsupported') {
    throw appError(interpretation.interpretation, 400);
  }

  const [stem, account, lineItem, extraCost, product, port] = await Promise.all([
    salesforceObjectFields({ objectName: 'stem__c', forceRefresh: force }),
    salesforceObjectFields({
      objectName: 'Account',
      forceRefresh: force,
    }).catch(() => ({ fields: [] })),
    salesforceObjectFields({
      objectName: 'STEM_Line_Item__c',
      forceRefresh: force,
    }).catch(() => ({ fields: [] })),
    salesforceObjectFields({
      objectName: 'STEM_Extra_Cost__c',
      forceRefresh: force,
    }).catch(() => ({ fields: [] })),
    salesforceObjectFields({
      objectName: 'Product2',
      forceRefresh: force,
    }).catch(() => ({ fields: [] })),
    salesforceObjectFields({
      objectName: 'Port__c',
      forceRefresh: force,
    }).catch(() => ({ fields: [] })),
  ]);
  const where = compileDashboardAiWhere(interpretation, { stem, account, lineItem, extraCost, product, port }, { selectedYears, selectedMonths });
  // AI results intentionally use the same paginated, access-filtered scope as
  // the dashboard APIs.  The old 3,000-record dashboard path is not safe for
  // AI because it can turn a complete natural-language result into a subset.
  const aiScope = await loadDecisionDashboardScope({ force }, req, context, { additionalWhere: where });
  const dashboard = {
    ...decisionDashboardSummary(aiScope.rows, aiScope.completeness),
    recentStems: publicDecisionDashboardRows(aiScope.rows),
    timing: aiScope.timing,
    dataWarnings: aiScope.dataWarnings,
  };
  const matchedCount = Number(aiScope.completeness.matchingCount || 0);
  const loadedCount = aiScope.rows.length;
  return {
    ...dashboard,
    aiSearch: {
      ...baseAiSearch,
      status: 'ready',
      matchedCount,
      loadedCount,
      resultLimit: null,
      truncated: false,
      nextCursor: null,
    },
  };
}

async function dashboardFilterOptions(body = {}, req = null, accessContext = null) {
  const optionType = String(body.optionType || '').trim().toLowerCase();
  if (!['ports', 'companies', 'groups'].includes(optionType)) {
    throw appError('Dashboard filter option type is invalid.', 400, 'DASHBOARD_FILTER_OPTION_INVALID');
  }
  const mode = body.counterpartyMode === 'supplier' ? 'supplier' : 'buyer';
  const cached = await cachedSalesforceValue({
    namespace: 'dashboard-filter-options-v2',
    ttlSeconds: 10 * 60,
    payload: { optionType, mode },
    tags: ['salesforce:dashboard', 'salesforce:reference'],
    body,
    req,
    accessContext,
    loader: async () => {
      if (optionType === 'ports') {
        const describe = await salesforceObjectFields({ objectName: 'Port__c' });
        const fields = fieldNameSetFrom(describe.fields || []);
        if (!fields.has('Name')) {
          throw appError('Dashboard port filtering requires Port__c.Name.', 503, 'DASHBOARD_PORT_SCHEMA', undefined, true);
        }
        const selected = ['Id', 'Name', fields.has('Country__c') ? 'Country__c' : null].filter(Boolean);
        const where = fields.has('Country__c') ? 'WHERE Country__c != null OR Name != null' : 'WHERE Name != null';
        const result = await sfQuery(`SELECT ${selected.join(',')} FROM Port__c ${where} ORDER BY Name`, { clean: true, limit: Number.MAX_SAFE_INTEGER });
        const countries = uniqueTextList((result.records || []).map((row) => row.Country__c)).sort((left, right) => left.localeCompare(right));
        return {
          options: [
            ...(result.records || []).filter((row) => row.Id && row.Name).map((row) => ({
              kind: 'port',
              id: row.Id,
              value: row.Id,
              name: row.Name,
              countryCode: row.Country__c || null,
              label: [row.Name, row.Country__c].filter(Boolean).join(' Â· '),
            })),
            ...countries.map((countryCode) => ({
              kind: 'country',
              value: `country:${countryCode}`,
              countryCode,
              label: `COUNTRY - ${countryCode}`,
            })),
          ],
        };
      }

      if (optionType === 'groups') {
        const [accountDescribe, stemDescribe] = await Promise.all([
          salesforceObjectFields({ objectName: 'Account' }),
          salesforceObjectFields({ objectName: 'stem__c' }),
        ]);
        const accountFields = fieldNameSetFrom(accountDescribe.fields || []);
        const stemFields = fieldNameSetFrom(stemDescribe.fields || []);
        if (!accountFields.has('ParentId') || !stemFields.has('Account__c')) {
          throw appError('Dashboard GROUP filtering requires the Salesforce Account hierarchy and STEM buyer Account lookup.', 503, 'DASHBOARD_GROUP_SCHEMA', undefined, true);
        }
        if (!accountFields.has('Inactive_Suspended__c')) throw appError('Dashboard Account filtering cannot verify active Salesforce Accounts.', 503, 'DASHBOARD_ACCOUNT_STATUS_SCHEMA', undefined, true);
        const accountSelect = ['Id', 'Name', 'ParentId', 'Inactive_Suspended__c', accountFields.has('Company_Code__c') ? 'Company_Code__c' : null, 'RecordType.Name'].filter(Boolean);
        const [accounts, stems] = await Promise.all([
          decisionDashboardQueryAll(`SELECT ${accountSelect.join(',')} FROM Account WHERE Inactive_Suspended__c = false ORDER BY Name,Id`),
          decisionDashboardQueryAll('SELECT Account__c FROM stem__c WHERE Account__c != null'),
        ]);
        const accountsById = new Map(accounts.map((account) => [account.Id, account]));
        const groupBuyerIds = new Map();
        const interoffice = isInterofficeAccess(accessContext);
        for (const buyerId of new Set(stems.map((stem) => stem.Account__c).filter(Boolean))) {
          const chain = [];
          const seen = new Set();
          let current = accountsById.get(buyerId);
          while (current && chain.length < 20) {
            if (seen.has(current.Id)) throw appError('Salesforce Account hierarchy contains a cycle.', 503, 'DASHBOARD_GROUP_HIERARCHY', undefined, true);
            seen.add(current.Id);
            chain.push(current);
            current = current.ParentId ? accountsById.get(current.ParentId) : null;
          }
          if (current) throw appError('Salesforce Account hierarchy exceeds 20 levels.', 503, 'DASHBOARD_GROUP_HIERARCHY', undefined, true);
          if (interoffice && chain.some((account) => String(account.Name || '').trim().toUpperCase() === INTEROFFICE_EXCLUDED_BUYER_GROUP)) continue;
          for (const account of chain) {
            const isGroup = /^GROUP\b/i.test(String(account.Name || '').trim()) || /group/i.test(String(account.RecordType?.Name || ''));
            if (!isGroup) continue;
            if (!groupBuyerIds.has(account.Id)) groupBuyerIds.set(account.Id, new Set());
            groupBuyerIds.get(account.Id).add(buyerId);
          }
        }
        return {
          options: [...groupBuyerIds.entries()].map(([id, buyerIds]) => {
            const account = accountsById.get(id) || {};
            const name = account.Name || 'GROUP name unavailable';
            const clKey = account.Company_Code__c || null;
            return { kind: 'group', id, value: id, name, clKey, accountIds: [...buyerIds].sort(), label: [name, clKey].filter(Boolean).join(' Â· ') };
          }).sort((left, right) => left.label.localeCompare(right.label)),
        };
      }

      const [stemDescribe, accountDescribe] = await Promise.all([
        salesforceObjectFields({ objectName: 'stem__c' }),
        salesforceObjectFields({ objectName: 'Account' }),
      ]);
      const stemFields = fieldNameSetFrom(stemDescribe.fields || []);
      const accountFields = fieldNameSetFrom(accountDescribe.fields || []);
      if (!accountFields.has('Inactive_Suspended__c')) throw appError('Dashboard Account filtering cannot verify active Salesforce Accounts.', 503, 'DASHBOARD_ACCOUNT_STATUS_SCHEMA', undefined, true);
      if (mode === 'supplier') {
        const [lineDescribe, extraDescribe] = await Promise.all([
          salesforceObjectFields({ objectName: 'STEM_Line_Item__c' }),
          salesforceObjectFields({ objectName: 'STEM_Extra_Cost__c' }),
        ]);
        const lineFields = fieldNameSetFrom(lineDescribe.fields || []);
        const extraFields = fieldNameSetFrom(extraDescribe.fields || []);
        const lineLookup = resolveOriginalSupplierLookup(lineDescribe.fields || []);
        const extraLookup = resolveExtraCostSupplierLookup(extraDescribe.fields || []);
        if (!lineLookup.valid && !extraLookup.valid) throw appError('Dashboard supplier filtering requires supplier Account lookups.', 503, 'DASHBOARD_SUPPLIER_SCHEMA', undefined, true);
        const scope = await interofficeStemAccessCondition(accessContext, stemFields, accountFields, 'STEM__r.');
        const supplierRows = await Promise.all([
          lineLookup.valid ? decisionDashboardQueryAll(`SELECT ${[
            lineLookup.fieldName,
            `${lineLookup.relationshipName}.Name`,
            accountFields.has('Company_Code__c') ? `${lineLookup.relationshipName}.Company_Code__c` : null,
            `${lineLookup.relationshipName}.Inactive_Suspended__c`,
          ].filter(Boolean).join(', ')} FROM STEM_Line_Item__c WHERE ${combineWhereConditions([
            `${lineLookup.fieldName} != null`,
            `${lineLookup.relationshipName}.Inactive_Suspended__c = false`,
            lineFields.has('Cancelled__c') ? 'Cancelled__c = false' : '',
            scope,
          ])}`) : [],
          extraLookup.valid ? decisionDashboardQueryAll(`SELECT ${[
            extraLookup.fieldName,
            `${extraLookup.relationshipName}.Name`,
            accountFields.has('Company_Code__c') ? `${extraLookup.relationshipName}.Company_Code__c` : null,
            `${extraLookup.relationshipName}.Inactive_Suspended__c`,
          ].filter(Boolean).join(', ')} FROM STEM_Extra_Cost__c WHERE ${combineWhereConditions([
            `${extraLookup.fieldName} != null`,
            `${extraLookup.relationshipName}.Inactive_Suspended__c = false`,
            extraFields.has('Cancelled__c') ? 'Cancelled__c = false' : '',
            scope,
          ])}`) : [],
        ]);
        const optionsById = new Map();
        for (const [rows, lookup] of [[supplierRows[0], lineLookup], [supplierRows[1], extraLookup]]) {
          if (!lookup.valid) continue;
          for (const row of rows) {
            const id = row[lookup.fieldName];
            const account = row[lookup.relationshipName] || {};
            if (!id || optionsById.has(id)) continue;
            const name = account.Name || 'Supplier name unavailable';
            const clKey = account.Company_Code__c || null;
            optionsById.set(id, { kind: 'account', id, value: id, name, clKey, label: [name, clKey].filter(Boolean).join(' Â· ') });
          }
        }
        return {
          options: [...optionsById.values()].sort((left, right) => left.label.localeCompare(right.label)),
        };
      }

      if (!stemFields.has('Account__c')) {
        throw appError('Dashboard buyer filtering requires STEM__c.Account__c.', 503, 'DASHBOARD_BUYER_SCHEMA', undefined, true);
      }
      const selected = [
        'Account__c',
        'Account__r.Name',
        accountFields.has('Company_Code__c') ? 'Account__r.Company_Code__c' : null,
        'Account__r.Inactive_Suspended__c',
      ].filter(Boolean);
      const scope = await interofficeStemAccessCondition(accessContext, stemFields, accountFields);
      const result = await sfQuery(`SELECT ${selected.join(',')} FROM stem__c WHERE ${combineWhereConditions([scope, 'Account__r.Inactive_Suspended__c = false'])}`, { clean: true, limit: Number.MAX_SAFE_INTEGER });
      const optionsById = new Map();
      for (const row of result.records || []) {
        if (!row.Account__c || optionsById.has(row.Account__c)) continue;
        const name = row.Account__r?.Name || 'Buyer name unavailable';
        const clKey = row.Account__r?.Company_Code__c || null;
        optionsById.set(row.Account__c, { kind: 'account', id: row.Account__c, value: row.Account__c, name, clKey, label: [name, clKey].filter(Boolean).join(' Â· ') });
      }
      return {
        options: [...optionsById.values()].sort((left, right) => left.label.localeCompare(right.label)),
      };
    },
  });
  return cached.value;
}

async function salesforceFullSchema() {
  const list = await salesforceSchema();
  const objects = await Promise.all(
    list.objects.slice(0, 2000).map(async (object) => {
      try {
        return {
          ...object,
          ...(await salesforceObjectFields({ objectName: object.name })),
        };
      } catch {
        return object;
      }
    }),
  );
  return { objects };
}

async function salesforceDashboard(body = {}, req = null, accessContext = null) {
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames);
  const whereClause = interofficeCondition ? `WHERE ${interofficeCondition}` : '';
  const hasStatus = fieldNames.includes('Status__c');
  const hasType = fieldNames.includes('Type__c');
  const hasAmount = fieldNames.includes('Amount__c');
  const profitField = ['Profit__c', 'Net_Profit__c', 'Gross_Profit__c', 'Total_Profit__c', 'ProfitAmount__c'].find((f) => fieldNames.includes(f)) || null;
  const usefulFields = ['Id', 'Name', 'CreatedDate'];
  if (hasStatus) usefulFields.push('Status__c');
  if (hasType) usefulFields.push('Type__c');
  if (hasAmount) usefulFields.push('Amount__c');
  if (fieldNames.includes('OwnerId')) usefulFields.push('OwnerId');

  const [totalRes, statusRes, typeRes, recentRes, accountRes, amountRes, profitRes] = await Promise.all([
    sfQuery(`SELECT COUNT(Id) total FROM stem__c ${whereClause}`, {
      softFail: true,
    }),
    hasStatus ? sfQuery(`SELECT Status__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Status__c`, { softFail: true }) : { records: [] },
    hasType ? sfQuery(`SELECT Type__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Type__c`, { softFail: true }) : { records: [] },
    sfQuery(`SELECT ${usefulFields.join(', ')} FROM stem__c ${whereClause} ORDER BY CreatedDate DESC LIMIT 20`, { clean: true, softFail: true }),
    sfQuery('SELECT COUNT(Id) total FROM Account', { softFail: true }),
    hasAmount
      ? sfQuery(`SELECT SUM(Amount__c) total FROM stem__c ${whereClause}`, {
          softFail: true,
        })
      : { records: [] },
    profitField ? sfQuery(`SELECT SUM(${profitField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
  ]);

  return {
    stemTotal: totalRes.records?.[0]?.total ?? totalRes.totalSize ?? 0,
    accountTotal: accountRes.records?.[0]?.total ?? 0,
    totalAmount: amountRes.records?.[0]?.total ?? null,
    totalProfit: profitRes.records?.[0]?.total ?? null,
    profitField,
    stemByStatus: (statusRes.records || []).map((r) => ({
      label: r.val || 'Unknown',
      value: r.total,
    })),
    stemByType: (typeRes.records || []).map((r) => ({
      label: r.val || 'Unknown',
      value: r.total,
    })),
    recentStems: recentRes.records || [],
    availableFields: fieldNames,
    hasStatus,
    hasType,
    hasAmount,
  };
}

async function salesforceStemDetail(body) {
  const { stemId, updates, childObject, childId, childUpdates } = body;
  if (!stemId) throw new Error('stemId required');
  let actualStemId = stemId;
  if (stemId.length < 15) {
    const lookup = await sfQuery(`SELECT Id FROM stem__c WHERE KeyStem__c = '${String(stemId).replace(/'/g, "\\'")}' LIMIT 1`, { clean: true });
    if (!lookup.records.length) throw new Error(`STEM with KeyStem__c '${stemId}' not found`);
    actualStemId = lookup.records[0].Id;
  }
  if (childObject && childId && childUpdates && Object.keys(childUpdates).length) {
    await sfRequest(`/sobjects/${childObject}/${childId}`, {
      method: 'PATCH',
      body: childUpdates,
    });
  }
  if (updates && Object.keys(updates).length) {
    await sfRequest(`/sobjects/stem__c/${actualStemId}`, {
      method: 'PATCH',
      body: updates,
    });
  }
  const [record, lineItems, extraCosts, buyerBrokers] = await Promise.all([
    sfRequest(`/sobjects/stem__c/${actualStemId}`).then(cleanRecord),
    sfQuery(`SELECT Id, Name, Product__c, Product__r.Name, Product__r.Family, Supplier_Name__c, BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Payment_Term__c, BDN_Number__c, Quantity_in_MT__c, Is_Quantity_Range__c, Cancelled__c, Buyers_Brokers_Commission_Per_Unit__c, Commission_Cost__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Lumpsum__c, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
    sfQuery(`SELECT Id, Name, Description__c, Product2Id__c, Product2Id__r.Name, Supplier_Name__c, Quantity__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Supplier_Issued__c, Payment_Term__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
    sfQuery(`SELECT Id, Buyer_Broker__c, Refcode_Index__c, Exported__c, Commission_Lumpsum__c, STEM_Line_Item__r.Id FROM STEM_Buyer_Broker__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
  ]);
  return {
    record,
    lineItems: lineItems.records || [],
    extraCosts: extraCosts.records || [],
    buyerBrokers: buyerBrokers.records || [],
  };
}

async function salesforceDescribeChildren(body) {
  const { objectType, recordId } = body;
  if (!objectType || !recordId) throw new Error('objectType and recordId required');
  const record = await sfRequest(`/sobjects/${objectType}/${recordId}`);
  return cleanRecord(record);
}

async function salesforceTopBuyers(body = {}, req = null, accessContext = null) {
  const interofficeCondition = await interofficeStemAccessCondition(accessContext);
  const whereClause = interofficeCondition ? `WHERE ${interofficeCondition}` : '';
  const rows = await sfQuery(`SELECT Account__r.Name buyer, SUM(Total_Invoice_Amount__c) total FROM stem__c ${whereClause} GROUP BY Account__r.Name ORDER BY SUM(Total_Invoice_Amount__c) DESC LIMIT 10`, { clean: true, softFail: true });
  return {
    buyers: (rows.records || []).map((r) => ({
      name: r.buyer || 'Unknown',
      total: r.total || 0,
    })),
  };
}

async function queryRows(soql, { limit = 5000, softFail = false } = {}) {
  const result = await sfQuery(soql, { clean: true, limit, softFail });
  return result.records || [];
}

async function queryResult(soql, { limit = 5000, softFail = false } = {}) {
  return sfQuery(soql, { clean: true, limit, softFail });
}

async function compositeQueryBatch(specs = []) {
  const active = [];
  const activeIndexes = [];
  specs.forEach((spec, index) => {
    if (!spec?.soql) return;
    active.push({
      soql: spec.soql,
      clean: spec.clean !== false,
      limit: spec.limit ?? 5000,
      softFail: spec.softFail === true,
    });
    activeIndexes.push(index);
  });
  const activeResults = active.length ? await sfCompositeQueries(active) : [];
  const results = specs.map((spec) => spec?.fallback || { records: [], totalSize: 0 });
  activeIndexes.forEach((index, resultIndex) => {
    results[index] = activeResults[resultIndex];
  });
  return results;
}

async function compositeQueryRows(specs = []) {
  const results = await compositeQueryBatch(specs);
  return results.map((result) => result.records || []);
}

function brokerAmount(value, qty) {
  return Number(value || 0) * Number(qty || 0);
}

function paymentDelayDays(paymentDate, dueDate) {
  if (!paymentDate || !dueDate) return null;
  const payment = new Date(paymentDate);
  const due = new Date(dueDate);
  if (Number.isNaN(payment.getTime()) || Number.isNaN(due.getTime())) return null;
  return Math.round((payment - due) / 86400000);
}

function escapeSoql(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function supplierMatchKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[*]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function dateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function latestDate(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function prpspDisplayStatus(rawStatus, uploadDate) {
  const status = String(rawStatus || '').trim();
  const uploadLabel = uploadDate ? prettyDate(uploadDate) : null;
  if (!status) return 'Not required';
  if (status === 'A - w/ Agreement (Payment Conditional)') {
    return uploadLabel ? `Conditional-Sent on ${uploadLabel}` : 'Conditional-Not Sent';
  }
  if (['B - w/ Agreement (Payment Unconditional)', 'C - w/o Agreement (Payment Received)', 'D - w/o Agreement (Payment NOT Received)'].includes(status)) {
    return uploadLabel ? `Not Conditional-Sent on ${uploadLabel}` : 'Not Conditional-Not Sent';
  }
  if (status === 'Sent') return uploadLabel ? `Sent on ${uploadLabel}` : 'Sent';
  return status;
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / 86400000);
}

function isBeforeCashflowForecastStart(dateString) {
  return Boolean(dateString && String(dateString).slice(0, 10) < CASHFLOW_FORECAST_START_DATE);
}

const FRANKFURTER_PROVIDER_DETAILS = {
  blended: {
    key: 'blended',
    label: 'Frankfurter blended rate',
    rateType: 'blended provider rate',
  },
  ECB: {
    key: 'ECB',
    label: 'European Central Bank',
    rateType: 'reference rate',
  },
};

function normalizeFrankfurterProvider(provider) {
  const key = String(provider || 'blended')
    .trim()
    .toUpperCase();
  if (!key || key === 'BLENDED' || key === 'DEFAULT') return 'blended';
  return FRANKFURTER_PROVIDER_DETAILS[key] ? key : 'blended';
}

function previousIsoDate(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateOnly(date);
}

async function fetchFrankfurterRate(date, provider) {
  const url = new URL('https://api.frankfurter.dev/v2/rate/USD/CNY');
  url.searchParams.set('date', date);
  if (provider !== 'blended') url.searchParams.set('providers', provider);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Frankfurter request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function serializeBrokerCommissionSettings(row = null) {
  const provider = normalizeFrankfurterProvider(row?.exchange_rate_provider);
  return {
    provider,
    providerLabel: FRANKFURTER_PROVIDER_DETAILS[provider].label,
    revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null,
  };
}

async function loadBrokerCommissionSettings(client) {
  const { data, error } = await client
    .from('broker_commission_settings')
    .select('setting_key,exchange_rate_provider,revision,updated_at')
    .eq('setting_key', 'company')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw appError('Broker Commission exchange-rate settings are unavailable.', 503);
  return data;
}

async function brokerCommissionSettingsGet(body = {}, req = null, accessContext = null) {
  const { client } = accessContext || (await requireActiveUser(req));
  return { settings: serializeBrokerCommissionSettings(await loadBrokerCommissionSettings(client)) };
}

async function brokerCommissionSettingsSave(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'broker_settings_manage', 'You do not have permission to change Broker Commission settings.');
  const provider = normalizeFrankfurterProvider(body.provider);
  if (provider !== String(body.provider || '').trim()) throw appError('Choose a valid exchange-rate provider.', 400);
  const { data, error } = await client.rpc('save_broker_commission_settings', {
    p_exchange_rate_provider: provider,
    p_expected_revision: Number(body.expectedRevision ?? body.expected_revision ?? 0),
    p_actor_user_id: profile.id,
  });
  if (error) {
    if (/changed after they were opened/i.test(error.message || '')) throw appError(error.message, 409);
    throw error;
  }
  return { settings: serializeBrokerCommissionSettings(data) };
}

async function frankfurterUsdCnyRate(body, req = null, accessContext = null) {
  const { client } = accessContext || (await requireActiveUser(req));
  const companySettings = await loadBrokerCommissionSettings(client);
  const provider = normalizeFrankfurterProvider(companySettings.exchange_rate_provider);
  const requestedDate = dateOnly(body.date || new Date());
  if (!requestedDate) throw new Error('Valid date required');

  const today = dateOnly(new Date());
  let probeDate = requestedDate > today ? today : requestedDate;
  let lastError = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      const rate = await fetchFrankfurterRate(probeDate, provider);
      const providerDetails = FRANKFURTER_PROVIDER_DETAILS[provider];
      return {
        source: 'Frankfurter API',
        apiUrl: 'https://api.frankfurter.dev/v2/rate/USD/CNY',
        requestedDate,
        date: rate.date,
        base: rate.base,
        quote: rate.quote,
        rate: rate.rate,
        provider,
        providerLabel: providerDetails.label,
        rateType: providerDetails.rateType,
        settingsRevision: Number(companySettings.revision || 0),
      };
    } catch (error) {
      lastError = error;
      if (error.status && ![404, 422].includes(error.status)) break;
      probeDate = previousIsoDate(probeDate);
    }
  }
  throw new Error(lastError?.message || 'Unable to fetch USD/CNY exchange rate');
}

function earliestDate(values) {
  return values.filter(Boolean).sort()[0] || null;
}

function splitBuyerTraderNames(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function traderEmailLookupKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const MIN_BUYER_INVOICE_DUE_DATE = '2026-01-01';
const CASHFLOW_FORECAST_START_DATE = '2026-01-01';
const INVOICE_TABLE_TOKEN_PATTERN = /\{\{\s*invoiceTable\s*\}\}/i;
const DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS = {
  enabled: true,
  to: [],
  cc: [],
  bcc: [],
  daysAhead: 7,
  subject: '',
  intro: '',
  includeSummary: true,
  includeTable: true,
  buyerTraders: [],
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  sendTimes: ['08:00', '14:00'],
  paymentReminderRecipientFieldPath: '',
  paymentReminderCc: [],
  paymentReminderBcc: [],
  paymentReminderSubject: 'Payment Reminder - {{buyerName}} - Outstanding Buyer Invoices',
  paymentReminderBody: '<p>Dear {{primaryRecipientName}},</p><p>Please find below the outstanding buyer invoices for your attention.</p><p>{{invoiceTable}}</p><p>This reminder includes overdue invoices and invoices due within {{daysAhead}} days. Please arrange payment or let us know the expected payment date.</p><p><strong>Late payment interest warning:</strong> where payment remains overdue, a late payment interest charge of <strong>2.00% per month</strong> may apply.</p><p>Regards,<br>Fratelli Cosulich</p>',
};
const BUYER_INVOICE_COLLECTION_STATUSES = ['To Contact', 'Awaiting Buyer', 'Promise to Pay', 'Payment Advice Received', 'Escalated', 'On Hold', 'Paid / Closed'];
const LEGACY_BUYER_INVOICE_COLLECTION_STATUSES = {
  'Not Started': 'To Contact',
  'Reminder Sent': 'Awaiting Buyer',
  'Awaiting Buyer Reply': 'Awaiting Buyer',
};
const BUYER_INVOICE_EVENT_TYPES = ['update', 'status_change', 'note', 'follow_up', 'promise', 'owner_change', 'contact', 'reminder_sent', 'payment_advice', 'payment_detected', 'auto_closed', 'auto_reopened', 'reconciliation_warning', 'reconciliation_resolved', 'posting_reminder_override'];
const BUYER_COLLECTION_RECONCILIATION_STATES = new Set(['not_checked', 'open', 'partial_payment', ...PAYMENT_POSTING_ISSUE_STATES, 'advice_pending', 'advice_overdue', 'settled', 'reopened', 'balance_unavailable', 'manual_closure_mismatch']);
const BUYER_COLLECTION_ADVICE_SOURCE_STATUSES = new Set(['Awaiting Buyer', 'Promise to Pay', 'Escalated', 'Payment Advice Received']);
const BUYER_COLLECTION_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;
const DISPUTE_BETA_WORKFLOW_STATUSES = ['Draft', 'Pending Approval', 'Revision Requested', 'Rejected', 'Approved - Pending Accounting', 'Accounting In Progress', 'Settled - Ready to Close', 'Closed'];
const DISPUTE_BETA_APPROVAL_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Revision Requested'];
const DISPUTE_BETA_EXECUTION_STATUSES = ['Pending Accounting', 'Instruction Issued', 'Settled', 'Not Required'];
const DISPUTE_BETA_ACTION_LABELS = {
  hold_supplier_payment: 'Hold supplier payment',
  pay_full_supplier_invoice: 'Pay full supplier invoice amount',
  deduct_specific_amount: 'Deduct specific amount',
  resolve_supplier_dispute: 'Recover agreed amount from supplier',
  issue_buyer_credit_note: 'Issue credit note to buyer',
  close_supplier_dispute: 'Close dispute with supplier (no recovery)',
  close_buyer_dispute: 'Close dispute with buyer (no credit note)',
};
const DISPUTE_LEGACY_SUPPLIER_FINANCIAL_ACTIONS = new Set(['hold_supplier_payment', 'pay_full_supplier_invoice', 'deduct_specific_amount']);
const DISPUTE_BETA_BALANCE_PAYMENT_INSTRUCTIONS = ['No Balance Payment', 'Pay Immediately', 'Pay with next supplier invoice'];
const DISPUTE_WORKFLOW_DOCUMENT_TYPES = new Set(['settlement_agreement', 'buyer_credit_note', 'supplier_credit_note', 'payment_instruction', 'proof_of_payment', 'correspondence', 'other_support']);
const DISPUTE_WORKFLOW_MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
const DISPUTE_WORKFLOW_DOCUMENT_DIRECTIONS = new Set(['from_supplier', 'to_supplier', 'from_buyer', 'to_buyer']);
const DISPUTE_BETA_CASE_SELECT = 'id,stem_id,stem_name,buyer_name,supplier_names,current_salesforce_status,workflow_status,approval_status,latest_note,submitted_by,submitted_by_email,submitted_at,approved_by,approved_by_email,approved_at,rejected_by,rejected_by_email,rejected_at,rejection_reason,closed_by,closed_by_email,closed_at,settlement_financials,settlement_pnl,salesforce_writeback_status,salesforce_writeback_error,external_closure_detected_at,external_closure_salesforce_status,external_closure_salesforce_modified_at,external_closure_accepted_at,external_closure_accepted_by,external_closure_accepted_by_email,external_closure_acceptance_reason,created_at,updated_at';
const DISPUTE_WORKFLOW_PARTY_SELECT = 'id,case_id,stem_id,account_id,account_key,account_name,roles,source_types,source_record_ids,payment_terms,products,cancelled_source_only,created_by,created_by_email,updated_by,updated_by_email,created_at,updated_at';
const DISPUTE_BETA_ACTION_SELECT = 'id,case_id,stem_id,party_id,party_side,action_type,action_label,amount,special_sell_price,special_buy_price,quantity,quantity_unit,close_reason,balance_payment_instruction,description,requires_attachment,execution_status,instruction_reference,instruction_date,instruction_amount,settlement_reference,settlement_date,settlement_amount,accounting_note,accounting_by,accounting_by_email,accounting_at,executed_by,executed_by_email,executed_at,execution_note,linked_agreed_compensation_id,linked_compensation_snapshot,linked_compensation_by,linked_compensation_by_email,linked_compensation_at,created_by,created_by_email,updated_by,updated_by_email,created_at,updated_at';
const DISPUTE_SUPPLIER_INSTRUCTION_SELECT = 'id,case_id,action_id,party_id,stem_id,instruction_type,recovery_method,source_supplier_invoice_id,source_supplier_invoice_name,source_stem_id,target_supplier_invoice_id,target_supplier_invoice_name,target_stem_id,currency_iso_code,planned_amount,allocated_amount,source_invoice_amount_snapshot,source_payable_balance_snapshot,source_paid_amount_snapshot,target_invoice_amount_snapshot,target_payable_amount_snapshot,source_invoice_snapshot,source_stem_snapshot,target_invoice_snapshot,target_stem_snapshot,payment_snapshot,allocation_fingerprint,status,matched_salesforce_payment_id,matching_payment_snapshot,instruction_reference,instruction_date,instruction_amount,settlement_reference,settlement_date,settlement_amount,accounting_note,revision,created_by,created_by_email,updated_by,updated_by_email,created_at,updated_at,acknowledged_by,acknowledged_by_email,acknowledged_at,settled_by,settled_by_email,settled_at';
const DISPUTE_SUPPLIER_INSTRUCTION_STATUSES = new Set(['Provisional Hold', 'Hold Acknowledged', 'Pending Accounting', 'Instruction Issued', 'Settled', 'Not Required', 'Superseded']);
const DISPUTE_BETA_EVENT_SELECT = 'id,case_id,action_id,stem_id,event_type,note,metadata,actor_user_id,actor_email,created_at';
const DISPUTE_WORKFLOW_DOCUMENT_SELECT = 'id,case_id,action_id,supplier_instruction_id,party_id,party_side,stem_id,party_name,party_account_id,document_direction,document_type,original_filename,requested_filename,smart_filename,upload_status,content_type,file_extension,content_size,salesforce_content_version_id,salesforce_content_document_id,salesforce_linked_record_id,salesforce_url,uploaded_by,uploaded_by_email,created_at';

function canonicalDisputeBetaCloseReason(value, allowed = []) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return allowed.find((reason) => reason.toLowerCase() === raw.toLowerCase()) || raw;
}

function normalizedUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

function fcosPublicUrl() {
  return normalizedUrl(process.env.FCOS_PUBLIC_URL) || normalizedUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) || normalizedUrl(process.env.VERCEL_URL) || 'https://fcos.fcuno.com';
}

function buyerInvoiceAppUrl() {
  return fcosPublicUrl();
}

function buyerInvoiceFilterUrl(settings, report, buyerTrader) {
  const url = new URL('/buyer-invoices', buyerInvoiceAppUrl());
  url.searchParams.set('daysAhead', String(settings.daysAhead ?? report.daysAhead ?? DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead));
  if (buyerTrader) url.searchParams.set('buyerTrader', buyerTrader);
  return url.toString();
}

function incomingPaymentAppUrl() {
  return fcosPublicUrl();
}

function incomingPaymentFilterUrl(settings, report) {
  const url = new URL('/incoming-payments', incomingPaymentAppUrl());
  if (report.dateFrom) url.searchParams.set('dateFrom', String(report.dateFrom));
  if (report.dateTo) url.searchParams.set('dateTo', String(report.dateTo));
  if (report.search) url.searchParams.set('search', String(report.search));
  return url.toString();
}

function incomingPaymentStemUrl(settings = {}, stemId) {
  const url = new URL('/incoming-payments', incomingPaymentAppUrl());
  if (stemId) url.searchParams.set('stemId', String(stemId));
  return url.toString();
}

function serverEmailDeliveryStatus() {
  const mailConfig = operationalMailConfig();
  const enabled = isExternalActionEnabled('email_delivery');
  return {
    hasServerProvider: mailConfig.configured && enabled,
    configured: mailConfig.configured,
    enabled,
    provider: mailConfig.configured ? mailConfig.deliveryMethod : 'none',
    sender: null,
    scope: mailConfig.configured ? 'operational_server' : 'none',
  };
}

async function emailSenderStatus(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return configuredEmailSenderStatus(context.client, process.env);
}

async function emailSenderMailboxSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const mailbox = await saveGraphEmailMailbox(context.client, context.profile, body);
  return { mailbox, registry: await listGraphEmailRegistry(context.client) };
}

async function emailSenderRouteSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const route = await saveGraphEmailRoute(context.client, context.profile, body);
  return { route, registry: await listGraphEmailRegistry(context.client) };
}

function maskValue(value, visibleStart = 3, visibleEnd = 3) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) {
    const [name, domain] = raw.split('@');
    const maskedName = name.length <= 2 ? `${name[0] || ''}***` : `${name.slice(0, 2)}***`;
    return `${maskedName}@${domain}`;
  }
  if (raw.length <= visibleStart + visibleEnd) return '***';
  return `${raw.slice(0, visibleStart)}***${raw.slice(-visibleEnd)}`;
}

function configuredEnv(names) {
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}

function missingEnv(names) {
  return names.filter((name) => !process.env[name]);
}

function jwtExpiresAt(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function addSecondsIso(seconds) {
  const amount = Number(seconds);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return new Date(Date.now() + amount * 1000).toISOString();
}

function safeHealthFailure(error) {
  const code = String(error?.code || error?.status || error?.statusCode || 'HEALTH_CHECK_FAILED')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 80) || 'HEALTH_CHECK_FAILED';
  const status = Number(error?.status || error?.statusCode || 0);
  const message = error?.name === 'AbortError'
    ? 'The health check timed out.'
    : status === 401 || status === 403
      ? 'The provider rejected the configured authorization.'
      : status === 404
        ? 'The configured provider endpoint was not found.'
        : status === 429
          ? 'The provider temporarily throttled the health check.'
          : 'The health check is unavailable. Review the redacted server diagnostics.';
  return { code, message };
}

async function timedCheck(run) {
  const startedAt = Date.now();
  try {
    const details = await run();
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      details: details || {},
    };
  } catch (error) {
    const failure = safeHealthFailure(error);
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: failure.message,
      errorCode: failure.code,
    };
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error_description || data.error?.message || data.message || `Request failed: ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function healthRow(base, result = null) {
  const checkedAt = new Date().toISOString();
  if (!base.configured) {
    return {
      ...base,
      status: 'not_configured',
      checkedAt,
      latencyMs: null,
      error: null,
    };
  }
  if (!result) {
    return {
      ...base,
      status: 'configured',
      checkedAt,
      latencyMs: null,
      error: null,
    };
  }
  const reportedStatus = result.status || result.details?.healthStatus || null;
  return {
    ...base,
    status: result.ok
      ? base.warning && (!reportedStatus || reportedStatus === 'online') ? 'warning' : reportedStatus || 'online'
      : result.status || 'unavailable',
    checkedAt,
    latencyMs: result.latencyMs,
    error: result.error || null,
    errorCode: result.errorCode || null,
    details: { ...(base.details || {}), ...(result.details || {}) },
  };
}

async function salesforceHealthRow({ force = false } = {}) {
  const authMode = salesforceAuthMode();
  const usesJwt = authMode === 'jwt';
  const usesRefreshToken = authMode === 'refresh_token';
  const usesAccessToken = authMode === 'access_token';
  const isMisconfigured = authMode === 'misconfigured';
  const configuredAuthModes = salesforceConfiguredAuthModes();
  const redundantAuthModes = configuredAuthModes.filter((mode) => mode !== authMode);
  const required = usesJwt ? ['SALESFORCE_JWT_CLIENT_ID', 'SALESFORCE_JWT_USERNAME', 'SALESFORCE_JWT_PRIVATE_KEY'] : usesRefreshToken ? ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_REFRESH_TOKEN'] : isMisconfigured ? ['SALESFORCE_JWT_CLIENT_ID', 'SALESFORCE_JWT_USERNAME', 'SALESFORCE_JWT_PRIVATE_KEY', 'SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_REFRESH_TOKEN'] : ['SALESFORCE_ACCESS_TOKEN'];
  const configured = authMode !== 'missing' && !isMisconfigured;
  const result = isMisconfigured
    ? {
        ok: false,
        latencyMs: null,
        error: 'Salesforce OAuth env vars are missing or blank.',
      }
    : configured
      ? await timedCheck(async () => {
          const limitsResult = await getOrLoadRuntimeCache({
            namespace: 'salesforce-api-limits',
            version: '1',
            accessScope: 'health',
            apiVersion: salesforceCacheApiIdentity(),
            payload: null,
            ttlSeconds: 60,
            tags: ['salesforce:health'],
            force,
            loader: () => sfRequest('/limits'),
          });
          const limits = limitsResult.value;
          const dailyApi = salesforceLimitFromBody(limits);
          const healthStatus = dailyApi == null ? 'monitoring_unavailable' : dailyApi.usedPct >= 85 ? 'critical' : dailyApi.usedPct >= 70 ? 'warning' : 'online';
          return {
            apiVersion: process.env.SALESFORCE_API_VERSION || 'v67.0',
            instanceUrl: getInstanceUrl(),
            limitsChecked: Boolean(limits),
            dailyApi,
            healthStatus,
          };
        })
      : null;
  return healthRow(
    {
      id: 'salesforce',
      name: 'Salesforce REST API',
      category: 'Salesforce',
      purpose: 'Dashboard, STEM details, documents, invoices, brokers, disputes, and payments.',
      scope: 'server',
      provider: 'Salesforce',
      endpoint: getInstanceUrl(),
      authType: usesJwt ? 'OAuth JWT bearer' : usesRefreshToken ? 'OAuth refresh token' : usesAccessToken ? 'Temporary access token' : isMisconfigured ? 'OAuth misconfigured' : 'OAuth',
      configured: configured || isMisconfigured,
      configuredEnv: configuredEnv(['SALESFORCE_JWT_CLIENT_ID', 'SALESFORCE_JWT_USERNAME', 'SALESFORCE_JWT_PRIVATE_KEY', 'SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_REFRESH_TOKEN', 'SALESFORCE_ACCESS_TOKEN', 'SALESFORCE_INSTANCE_URL', 'SALESFORCE_LOGIN_URL', 'SALESFORCE_API_VERSION']),
      missingEnv: usesJwt || usesRefreshToken ? [] : missingEnv(required),
      tokenExpiry: usesJwt ? 'JWT bearer issues short-lived access tokens on demand. Long-term validity depends on the Connected App certificate and user access.' : usesRefreshToken ? 'Refresh token expiry is not exposed by Salesforce; access tokens are refreshed on demand.' : usesAccessToken ? 'Temporary access token expiry is not exposed to the app.' : null,
      warning: isMisconfigured || usesAccessToken || redundantAuthModes.length > 0,
      notes: [
        ...(usesJwt ? ['Preferred durable mode. Rotate the Connected App certificate before it expires.'] : isMisconfigured ? ['Salesforce OAuth variables exist but at least one required value is blank. The temporary access-token fallback is intentionally blocked until durable auth is fixed.'] : usesAccessToken ? ['Using SALESFORCE_ACCESS_TOKEN fallback. Replace with JWT bearer or refresh-token OAuth env vars for durable production use.'] : ['Connected app refresh-token policy controls long-term validity.']),
        ...(redundantAuthModes.length > 0 ? [`Redundant Salesforce authentication modes are configured but inactive: ${redundantAuthModes.join(', ')}. Remove them after the active ${authMode} mode is verified and rollback is no longer required.`] : []),
      ],
    },
    result,
  );
}

async function specialTermsMigrationHealthRow({ force = false } = {}) {
  const result = await timedCheck(async () => {
    const inventory = await getSpecialTermMigrationInventory({ force });
    const summary = inventory?.summary || {};
    const termCount = Number(summary.termCount || 0);
    const approvedOrStructured = Number(summary.approvedOrRetiredTermCount ?? summary.structuredTermCount ?? 0);
    const manualReview = Number(summary.manualReviewTermCount || 0);
    const pendingApproval = Number(summary.pendingApprovalTermCount || 0);
    const legacyTerms = Math.max(0, Number(summary.legacyTermCount ?? termCount - approvedOrStructured));
    return {
      termCount,
      approvedOrStructured,
      legacyTerms,
      pendingApproval,
      manualReview,
      duplicateGroups: Number(summary.duplicateGroupCount || 0),
      duplicateCandidateOccurrences: Number(summary.duplicateCandidateOccurrenceCount || 0),
      aiDraftingConfigured: Boolean(process.env.OPENAI_API_KEY),
      healthStatus: legacyTerms || pendingApproval || manualReview ? 'warning' : 'online',
    };
  });
  return healthRow({
    id: 'special-terms-migration',
    name: 'Special-Term Clause Migration',
    category: 'Salesforce',
    purpose: 'Tracks whole-term migration, clause approval, manual segmentation, and protected AI drafting readiness without copying contractual text outside Salesforce.',
    scope: 'server',
    provider: 'FCOS and Salesforce',
    endpoint: '/special-terms?tab=migration',
    authType: 'FCOS session with live Salesforce revalidation',
    configured: true,
    configuredEnv: { OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY) },
    missingEnv: process.env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY'],
    tokenExpiry: 'Salesforce OAuth and the protected OpenAI server credential are checked independently.',
    notes: [
      'Clause text and revision lineage remain authoritative in Salesforce.',
      'A warning means migration or approval work remains; it does not change the current live contractual wording.',
    ],
  }, result);
}

async function supabaseMetricsHealth({ force = false } = {}) {
  const config = serverSupabaseConfig();
  if (!config.configured) throw new Error('Supabase Metrics credentials are not configured.');
  const cached = await getOrLoadRuntimeCache({
    namespace: 'supabase-prometheus-metrics',
    version: '1',
    accessScope: 'health',
    apiVersion: 'metrics-v1',
    payload: null,
    ttlSeconds: 60,
    tags: ['supabase:health'],
    force,
    loader: async () => {
      const startedAt = Date.now();
      let ok = false;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(`${config.url.replace(/\/+$/, '')}/customer/v1/privileged/metrics`, {
          headers: {
            authorization: `Basic ${Buffer.from(`service_role:${config.key}`).toString('base64')}`,
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Supabase Metrics request failed: ${response.status}`);
        const metrics = parseSupabasePrometheusMetrics(await response.text());
        ok = metrics.monitoringAvailable === true;
        return metrics;
      } finally {
        clearTimeout(timeout);
        recordSupabaseRequest({ durationMs: Date.now() - startedAt, ok });
      }
    },
  });
  return cached.value;
}

async function supabaseHealthRow({ force = false } = {}) {
  const config = serverSupabaseConfig();
  const result = config.configured
    ? await timedCheck(async () => {
        const client = supabaseAdminClient();
        const [authResult, profileResult, metricsResult] = await Promise.all([
          client.auth.admin.listUsers({ page: 1, perPage: 1 }),
          client.from('user_profiles').select('id', { count: 'exact', head: true }),
          supabaseMetricsHealth({ force })
            .then((metrics) => ({ metrics, error: null }))
            .catch((error) => ({ metrics: null, error: safeHealthFailure(error).message })),
        ]);
        const { error: authError } = authResult;
        if (authError) throw authError;
        const { count, error: profileError } = profileResult;
        if (profileError) throw profileError;
        const metrics = metricsResult.metrics;
        return {
          userProfilesCount: count ?? null,
          monitoringAvailable: metrics?.monitoringAvailable === true,
          monitoringError: metricsResult.error || null,
          healthStatus: metrics?.monitoringAvailable ? metrics.severity : 'monitoring_unavailable',
          metrics: metrics?.kpis || null,
          metricSeverities: metrics?.severities || null,
          thresholds: metrics?.thresholds || null,
        };
      })
    : null;
  return healthRow(
    {
      id: 'supabase',
      name: 'Supabase Auth and Database',
      category: 'Database',
      purpose: 'User access control, collection workflow, email schedules, report archive audit, dispute workflow, cashflow settings, and universal audit trail.',
      scope: 'server',
      provider: 'Supabase',
      endpoint: config.url ? maskValue(config.url, 18, 8) : null,
      authType: config.keyType === 'secret' ? 'Secret key' : 'Legacy service role key',
      configured: config.configured,
      configuredEnv: {
        SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
        VITE_SUPABASE_URL: Boolean(process.env.VITE_SUPABASE_URL),
        SUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
      missingEnv: config.missingEnv,
      tokenExpiry: config.keyType === 'legacy_service_role' ? jwtExpiresAt(config.key) || 'No expiry claim exposed.' : 'Managed server secret; no JWT expiry claim.',
      warning: config.keyType === 'legacy_service_role' || config.urlEnv === 'VITE_SUPABASE_URL',
      notes: [
        'Elevated Supabase credentials are never sent to the browser.',
        ...(config.keyType === 'legacy_service_role' ? ['Migrate to a scoped SUPABASE_SECRET_KEY before legacy service-role keys are deprecated.'] : []),
        ...(config.urlEnv === 'VITE_SUPABASE_URL' ? ['Set SUPABASE_URL for server code instead of relying on a browser-prefixed fallback.'] : []),
      ],
    },
    result,
  );
}

async function backboneBridgeHealthRow(accessContext) {
  const config = backboneBridgeConfig();
  const result = config.configured
    ? await timedCheck(async () => {
        const response = await backboneBridgeRequest(authenticatedBackboneBridgePayload({ operation: 'identity.resolve' }, accessContext));
        return {
          schemaVersion: response.schemaVersion,
          identityLinked: Boolean(response.identity?.userId),
          officeCodes: response.identity?.officeCodes || [],
          roles: response.identity?.roles || [],
          mode: response.authority?.mode || null,
          credentialVersion: response.bridgeCredentialVersion,
        };
      })
    : null;
  return healthRow(
    {
      id: 'fcos-backbone-bridge',
      name: 'FCOS Backbone Shared Boundary',
      category: 'Shared Platform',
      purpose: 'Resolves the current FCOS user to Backbone and reads scoped trade projections and audit without changing FCOS live operations.',
      scope: 'server',
      provider: 'FCOS Backbone',
      endpoint: `${config.baseUrl}/api/fcos/v1/bridge`,
      authType: 'Timestamped HMAC with one-time request id',
      details: {
        credentialRotation: 'Backbone reports only the accepted credential label after a valid signed request.',
      },
      configured: config.configured,
      configuredEnv: {
        FCOS_BACKBONE_URL: Boolean(process.env.FCOS_BACKBONE_URL),
        FCOS_BACKBONE_BRIDGE_SECRET: Boolean(process.env.FCOS_BACKBONE_BRIDGE_SECRET),
      },
      missingEnv: config.configured ? [] : ['FCOS_BACKBONE_BRIDGE_SECRET'],
      tokenExpiry: 'Each signed request expires after five minutes and its request id cannot be replayed.',
      notes: ['Read-only shadow boundary. Salesforce and the dedicated FCOS Supabase project remain live during parallel operation.', 'During a rotation window, credentialVersion should return primary before the previous Backbone secret is removed.'],
    },
    result,
  );
}

async function googleDriveHealthRow() {
  const required = ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'GOOGLE_DRIVE_REPORT_FOLDER_ID'];
  const configured = missingEnv(required).length === 0;
  const gateEnabled = isExternalActionEnabled('google_drive');
  const result =
    configured && gateEnabled
      ? await timedCheck(async () => {
          const { clientId, clientSecret, refreshToken, folderId } = googleDriveConfig();
          const token = await fetchJsonWithTimeout('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
            }),
          });
          if (!token.access_token) throw new Error('Google OAuth did not return an access token.');
          const marketConfig = CONNECTION_INTEGRATIONS.googleDriveMarketReports;
          const about = await fetchJsonWithTimeout('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
            headers: { Authorization: `Bearer ${token.access_token}` },
          });
          if (String(about.user?.emailAddress || '').trim().toLowerCase() !== marketConfig.accountEmail.toLowerCase()) {
            throw new Error('Google Drive market-report authorization does not match the approved account.');
          }
          const marketRootFields = encodeURIComponent('id,name,mimeType,trashed');
          const marketRoot = await fetchJsonWithTimeout(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(marketConfig.rootFolderId)}?fields=${marketRootFields}`, {
            headers: { Authorization: `Bearer ${token.access_token}` },
          });
          if (marketRoot.id !== marketConfig.rootFolderId
              || marketRoot.mimeType !== 'application/vnd.google-apps.folder'
              || marketRoot.trashed === true) {
            throw new Error('Google Drive market-report root does not match the approved folder.');
          }
          const fields = encodeURIComponent('id,name,mimeType,trashed');
          const folder = await fetchJsonWithTimeout(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=${fields}`, {
            headers: { Authorization: `Bearer ${token.access_token}` },
          });
          const marketFolders = [];
          for (const marketFolder of marketConfig.folders) {
            const marketFields = encodeURIComponent('id,name,mimeType,trashed,parents');
            const marketMetadata = await fetchJsonWithTimeout(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(marketFolder.folderId)}?fields=${marketFields}`, {
              headers: { Authorization: `Bearer ${token.access_token}` },
            });
            if (marketMetadata.id !== marketFolder.folderId
                || marketMetadata.mimeType !== 'application/vnd.google-apps.folder'
                || marketMetadata.trashed === true
                || !Array.isArray(marketMetadata.parents)
                || !marketMetadata.parents.includes(marketConfig.rootFolderId)) {
              throw new Error('Google Drive market-report folders do not match the approved hierarchy.');
            }
            marketFolders.push({ label: marketFolder.label, folderId: maskValue(marketMetadata.id, 6, 4), folderName: marketMetadata.name || null });
          }
          const healthClient = supabaseAdminClient();
          const [syncRun, imports, published, matched, incomplete, conflicts] = await Promise.all([
            healthClient.from('market_report_sync_runs').select('status,discovered_count,skipped_count,imported_count,failed_count,deferred_count,error_code,started_at,completed_at').eq('status', 'completed').order('completed_at', { ascending: false }).limit(1).maybeSingle(),
            healthClient.from('market_report_imports').select('id', { count: 'exact', head: true }).gte('report_date', '2025-01-01'),
            healthClient.from('market_report_imports').select('id', { count: 'exact', head: true }).eq('mops_publication_status', 'published'),
            healthClient.from('market_report_imports').select('id', { count: 'exact', head: true }).eq('mops_publication_status', 'matched'),
            healthClient.from('market_report_imports').select('id', { count: 'exact', head: true }).eq('mops_publication_status', 'incomplete'),
            healthClient.from('market_report_imports').select('id', { count: 'exact', head: true }).eq('mops_publication_status', 'conflict'),
          ]);
          const marketDatabaseError = [syncRun, imports, published, matched, incomplete, conflicts].find((entry) => entry.error)?.error;
          if (marketDatabaseError) throw marketDatabaseError;
          return {
            accessTokenExpiresAt: addSecondsIso(token.expires_in),
            accountEmail: marketConfig.accountEmail,
            folderName: folder.name || null,
            folderId: maskValue(folder.id, 6, 4),
            folderTrashed: folder.trashed === true,
            marketFolders,
            lastSuccessfulMarketScan: syncRun.data?.completed_at || null,
            lastMarketScanDiscovered: syncRun.data?.discovered_count ?? null,
            lastMarketScanImported: syncRun.data?.imported_count ?? null,
            importedReportsSince2025: imports.count || 0,
            mopsDatesPublished: published.count || 0,
            mopsDatesMatched: matched.count || 0,
            missingMopsTriples: incomplete.count || 0,
            mopsConflicts: conflicts.count || 0,
          };
        })
      : null;
  const row = healthRow(
    {
      id: 'google-drive',
      name: 'Google Drive Reports',
      category: 'Reports',
      purpose: 'Stores exported XLS reports and reads licensed Bunkerwire and European Marketscan PDFs for the hourly Markets update.',
      scope: 'server',
      provider: 'Google Drive API',
      endpoint: 'https://www.googleapis.com/drive/v3',
      authType: 'OAuth refresh token',
      configured,
      configuredEnv: configuredEnv(required),
      missingEnv: missingEnv(required),
      tokenExpiry: configured ? 'Refresh token expiry is not exposed by Google; short-lived access-token expiry is checked live.' : null,
      details: {
        gateEnabled,
        marketReportAccount: CONNECTION_INTEGRATIONS.googleDriveMarketReports.accountEmail,
        marketReportBrowserProfile: CONNECTION_INTEGRATIONS.googleDriveMarketReports.browserProfile,
        marketReportRootFolder: maskValue(CONNECTION_INTEGRATIONS.googleDriveMarketReports.rootFolderId, 6, 4),
        marketReportSchedule: CONNECTION_INTEGRATIONS.googleDriveMarketReports.syncSchedule,
      },
      notes: gateEnabled ? ['Archive files remain XLS. Market-report PDFs are read only; FCOS stores configured observations and checksums, not PDF bytes or report text.'] : ['Google Drive has been paused by its emergency control. The legacy archive path remains intact.'],
    },
    result,
  );
  return gateEnabled ? row : { ...row, status: 'disabled', latencyMs: null, error: null };
}

function externalActionGateHealthRow() {
  const gates = externalActionGates();
  const unexpected = Object.values(gates).filter((gate) => (gate.expectedState === 'live' ? !gate.enabled : gate.enabled));
  return {
    id: 'external-action-gates',
    name: 'External action gates',
    category: 'Safety',
    purpose: 'Keeps established FCOS integrations live while retaining emergency controls and UAT gates for new side effects.',
    scope: 'server',
    provider: 'FCOS',
    endpoint: null,
    authType: 'Deployment-controlled operational controls',
    configured: true,
    status: unexpected.length ? 'warning' : 'online',
    checkedAt: new Date().toISOString(),
    latencyMs: null,
    error: null,
    tokenExpiry: 'Not applicable.',
    details: Object.fromEntries(Object.values(gates).map((gate) => [gate.label, `${gate.enabled ? 'Enabled' : 'Disabled'} (${gate.expectedState === 'live' ? 'existing live function' : 'UAT gated'})`])),
    notes: unexpected.length ? [`Review unexpected connector state: ${unexpected.map((gate) => gate.label).join(', ')}.`] : ['Existing Salesforce, Google Drive, and operational email delivery functions are live. Growth & Coaching email and Outlook actions, bank execution, and payment promotion remain UAT gated.'],
  };
}

async function frankfurterHealthRow() {
  const result = await timedCheck(async () => {
    const data = await fetchJsonWithTimeout('https://api.frankfurter.dev/v2/rate/USD/CNY?date=2024-01-02');
    return {
      sampleDate: data.date,
      base: data.base,
      quote: data.quote,
      rateAvailable: Number.isFinite(Number(data.rate)),
    };
  });
  return healthRow(
    {
      id: 'frankfurter',
      name: 'Frankfurter USD/CNY API',
      category: 'Exchange Rate',
      purpose: "Broker's Commission CNY conversion. API mid-rate is reduced by 0.2% to estimate bank buy rate.",
      scope: 'public',
      provider: 'Frankfurter',
      endpoint: 'https://api.frankfurter.dev/v2/rate/USD/CNY',
      authType: 'No API key',
      configured: true,
      tokenExpiry: 'Not applicable.',
    },
    result,
  );
}

async function nagerHealthRow() {
  const year = new Date().getUTCFullYear();
  const result = await timedCheck(async () => {
    const data = await fetchJsonWithTimeout(`https://date.nager.at/api/v4/Holidays/SG/${year}`);
    return {
      sampleCountry: 'SG',
      sampleYear: year,
      holidayCount: Array.isArray(data) ? data.length : null,
    };
  });
  return healthRow(
    {
      id: 'nager-date',
      name: 'Nager.Date Holiday API',
      category: 'Cashflow Forecast',
      purpose: 'Weekend, Singapore public holiday, and US holiday blocking for cashflow forecast dates.',
      scope: 'public',
      provider: 'Nager.Date',
      endpoint: 'https://date.nager.at/api/v4/Holidays',
      authType: 'No API key',
      configured: true,
      tokenExpiry: 'Not applicable.',
      notes: ['Holiday results are cached in Supabase when available.'],
    },
    result,
  );
}

async function operationalMailHealthRow() {
  const graphConfig = graphEmailApplicationConfig();
  const deliveryGateEnabled = isExternalActionEnabled('email_delivery');
  let result = graphConfig.configured
    ? await timedCheck(async () => {
        const registry = await listGraphEmailRegistry(supabaseAdminClient());
        const token = await verifyGraphEmailApplication();
        return {
          method: token.method,
          accessTokenExpiresAt: token.accessTokenExpiresAt,
          mailboxCount: registry.mailboxes.length,
          purposeCount: registry.purposes.length,
          unassignedPurposes: registry.purposes.filter((purpose) => purpose.enabled && !purpose.mailbox?.active).map((purpose) => purpose.label),
          deliveryGateEnabled,
        };
      })
    : null;
  if (result?.ok && !deliveryGateEnabled) result.status = 'disabled';
  if (result?.ok && result.details?.unassignedPurposes?.length) {
    result.status = 'warning';
  }
  return healthRow(
    {
      id: 'microsoft-graph-email',
      name: 'Microsoft Graph Email Routing',
      category: 'Email',
      purpose: 'Graph-only delivery for every FCOS email purpose using administrator-assigned Microsoft 365 mailboxes.',
      scope: 'server',
      provider: 'Microsoft Graph',
      endpoint: 'https://graph.microsoft.com/v1.0',
      authType: 'Vercel OIDC to Microsoft OAuth',
      configured: graphConfig.configured,
      configuredEnv: configuredEnv([
        'FCOS_MICROSOFT_TENANT_ID',
        'FCOS_MICROSOFT_CLIENT_ID',
      ]),
      missingEnv: [
        ...(!graphConfig.tenantId ? ['FCOS_MICROSOFT_TENANT_ID'] : []),
        ...(!graphConfig.clientId ? ['FCOS_MICROSOFT_CLIENT_ID'] : []),
      ],
      tokenExpiry: null,
      details: {
        deliveryMethod: 'microsoft_graph_oidc',
        deliveryGateEnabled,
      },
      notes: [
        'This check verifies Vercel OIDC, Microsoft token exchange, and configured purpose routes without sending email.',
        'Mailbox-scoped Mail.Send authorization is confirmed only by an actual controlled delivery.',
        'Failed or uncertain Graph deliveries remain reserved for controlled review and explicit retry.',
      ],
    },
    result,
  );
}

async function fcosUpdatesMailHealthRow() {
  const registry = await listGraphEmailRegistry(supabaseAdminClient()).catch(() => null);
  const purpose = registry?.purposes?.find((item) => item.key === 'fcos_updates');
  const configured = Boolean(purpose?.mailbox?.active);
  const result = configured
    ? { ok: true, status: purpose.mailbox.verificationState === 'failed' ? 'warning' : 'online', durationMs: null, details: { senderAddress: purpose.mailbox.emailAddress, verificationState: purpose.mailbox.verificationState } }
    : null;

  return healthRow(
    {
      id: 'fcos-updates-mail',
      name: 'FCOS Updates Graph Sender Route',
      category: 'Email',
      purpose: 'The configurable Microsoft Graph mailbox assigned to FCOS Updates.',
      scope: 'server',
      provider: 'Microsoft Graph',
      endpoint: 'https://graph.microsoft.com/v1.0',
      authType: 'Vercel OIDC to Microsoft OAuth',
      configured,
      configuredEnv: {},
      missingEnv: configured ? [] : ['FCOS Updates mailbox assignment in Settings'],
      tokenExpiry: null,
      details: {
        senderAddress: purpose?.mailbox?.emailAddress || null,
        deliveryMethod: 'microsoft_graph_oidc',
        verificationState: purpose?.mailbox?.verificationState || 'unverified',
      },
      notes: [
        'The sender is assigned in Settings and its display identity is controlled by Microsoft 365.',
        'General Manager authority and the configured sender mailbox are independent.',
      ],
    },
    result,
  );
}

async function hedgeDeskHealthRow() {
  const client = supabaseAdminClient();
  const result = await timedCheck(async () => {
    const [physical, hedge, market, settlement, sfs, assistant, registry] = await Promise.all([
      client.from('hedge_physical_trades').select('id', { count: 'exact', head: true }),
      client.from('hedge_swap_hedges').select('id', { count: 'exact', head: true }),
      client.from('hedge_market_prices').select('id', { count: 'exact', head: true }),
      client.from('hedge_invoices').select('id', { count: 'exact', head: true }),
      hedgeSfsHealth(client),
      hedgeAssistantSettings(client).catch((error) => ({ error: error.message })),
      listGraphEmailRegistry(client),
    ]);
    const databaseError = physical.error || hedge.error || market.error || settlement.error;
    if (databaseError) throw databaseError;
    const purposeKeys = ['hedge_settlement', 'hedge_sfs_reports'];
    const emailRoutes = purposeKeys.map((key) => registry.purposes.find((purpose) => purpose.key === key));
    const missingRoutes = emailRoutes.filter((route) => !route?.mailbox?.active).map((route, index) => route?.label || purposeKeys[index]);
    return {
      physicalTrades: physical.count || 0,
      paperHedges: hedge.count || 0,
      marketPrices: market.count || 0,
      settlementInvoices: settlement.count || 0,
      sfs,
      assistantModel: assistant.modelId || null,
      assistantApiConfigured: assistant.apiConfigured === true,
      missingEmailRoutes: missingRoutes,
      healthStatus: missingRoutes.length || sfs.status === 'Warning' ? 'warning' : 'online',
    };
  });
  return healthRow({
    id: 'hedge-desk',
    name: 'Hedge Desk Services',
    category: 'Trading',
    purpose: 'Native physical trades, paper hedges, markets, settlement, SFS reporting, Salesforce synchronization, private documents, and Trading Assistant.',
    scope: 'server',
    provider: 'FCOS',
    endpoint: '/api/functions/hedgeDeskEntity',
    authType: 'FCOS authenticated service handlers',
    configured: true,
    configuredEnv: { OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY) },
    missingEnv: [],
    notes: ['Hedge settlement and SFS email routes are independently assigned in Email Senders.', 'Salesforce writes and email delivery remain protected by external-action gates.'],
  }, result);
}

async function emailRouterHealthRow() {
  const configured = Boolean(
    process.env.FCOS_MICROSOFT_TENANT_ID
    && process.env.FCOS_MICROSOFT_CLIENT_ID
    && process.env.FCOS_EMAIL_ROUTER_WEBHOOK_URL
    && process.env.FCOS_EMAIL_ROUTER_WEBHOOK_CLIENT_STATE
    && process.env.FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET,
  );
  const result = configured ? await timedCheck(async () => {
    const client = createEmailRouterServiceClient();
    const mailbox = await currentEmailRouterMailbox(client);
    await emailRouterGraphFetch(`/users/${encodeURIComponent(mailbox.emailAddress)}/mailFolders/inbox?$select=id`);
    const schema = client.schema('emailrouter');
    const [subscriptions, pendingActions, uncertainActions, alerts, delta] = await Promise.all([
      schema.from('mailbox_subscriptions').select('resource_key,state,expires_at').eq('mailbox_id', mailbox.id),
      schema.from('mail_action_outbox').select('id', { count: 'exact', head: true }).in('state', ['reserved', 'draft_created', 'submitted']),
      schema.from('mail_action_outbox').select('id', { count: 'exact', head: true }).eq('state', 'uncertain'),
      schema.from('alerts').select('id', { count: 'exact', head: true }).in('state', ['open', 'acknowledged']),
      schema.from('mailbox_delta_state').select('folder_key,sync_state,last_synced_at,failure_code').eq('mailbox_id', mailbox.id),
    ]);
    const databaseError = [subscriptions, pendingActions, uncertainActions, alerts, delta].find((item) => item.error)?.error;
    if (databaseError) throw databaseError;
    const expiringSubscriptions = (subscriptions.data || []).filter((item) => item.state !== 'active' || new Date(item.expires_at || 0).getTime() < Date.now() + 12 * 60 * 60 * 1000);
    return {
      mailboxLabel: mailbox.label,
      mailboxVerification: mailbox.verificationState,
      subscriptionCount: subscriptions.data?.length || 0,
      subscriptionWarnings: expiringSubscriptions.map((item) => item.resource_key),
      pendingActions: pendingActions.count || 0,
      uncertainActions: uncertainActions.count || 0,
      openAlerts: alerts.count || 0,
      folderSync: delta.data || [],
      healthStatus: expiringSubscriptions.length || uncertainActions.count || alerts.count ? 'warning' : 'online',
    };
  }) : null;
  return healthRow({
    id: 'email-router',
    name: 'Native Email Router',
    category: 'Tools',
    purpose: 'Microsoft 365 mailbox reading, routing actions, Sent Items confirmation, folder synchronization, and subscriptions.',
    scope: 'server',
    provider: 'Microsoft Graph',
    endpoint: '/email-router',
    authType: 'FCOS session and Vercel OIDC to Microsoft OAuth',
    configured,
    configuredEnv: configuredEnv([
      'FCOS_MICROSOFT_TENANT_ID',
      'FCOS_MICROSOFT_CLIENT_ID',
      'FCOS_EMAIL_ROUTER_WEBHOOK_URL',
      'FCOS_EMAIL_ROUTER_WEBHOOK_CLIENT_STATE',
      'FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET',
    ]),
    missingEnv: [
      ...(!process.env.FCOS_MICROSOFT_TENANT_ID ? ['FCOS_MICROSOFT_TENANT_ID'] : []),
      ...(!process.env.FCOS_MICROSOFT_CLIENT_ID ? ['FCOS_MICROSOFT_CLIENT_ID'] : []),
      ...(!process.env.FCOS_EMAIL_ROUTER_WEBHOOK_URL ? ['FCOS_EMAIL_ROUTER_WEBHOOK_URL'] : []),
      ...(!process.env.FCOS_EMAIL_ROUTER_WEBHOOK_CLIENT_STATE ? ['FCOS_EMAIL_ROUTER_WEBHOOK_CLIENT_STATE'] : []),
      ...(!process.env.FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET ? ['FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET'] : []),
    ],
    notes: [
      'The probe verifies mailbox-scoped Mail.ReadWrite access without sending email.',
      'Submitted messages become Confirmed only after Sent Items reconciliation.',
      'Uncertain submissions require human review and are never automatically resent.',
    ],
  }, result);
}

async function outlookCalendarHealthRow() {
  const required = ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'];
  const calendarGateEnabled = isExternalActionEnabled('outlook_calendar');
  const configured = missingEnv(required).length === 0;
  const result = configured && calendarGateEnabled
    ? await timedCheck(async () => {
        const health = await growthCalendarHealth();
        if (health.status !== 'Online') throw new Error(health.error || 'Microsoft Graph calendar authentication failed.');
        return {
          permission: 'Application Calendars.ReadWrite',
          mailboxScope: 'Exchange Online Application RBAC',
          calendarGateEnabled,
        };
      })
    : null;
  const row = healthRow(
    {
      id: 'outlook-growth-calendar',
      name: 'Outlook Coaching Calendar',
      category: 'Growth & Coaching',
      purpose: 'Creates and updates private 1:1 coaching invitations without placing agendas or notes in Outlook.',
      scope: 'server',
      provider: 'Microsoft Graph',
      endpoint: 'https://graph.microsoft.com/v1.0',
      authType: 'OAuth client credentials with Exchange Application RBAC',
      configured,
      configuredEnv: configuredEnv(required),
      missingEnv: calendarGateEnabled ? missingEnv(required) : [],
      tokenExpiry: 'Short-lived Microsoft Graph tokens are refreshed server-side.',
      details: {
        calendarGateEnabled,
      },
      notes: calendarGateEnabled
        ? ['This check validates credentials only and never creates a calendar event.']
        : ['Outlook coaching calendar synchronization is intentionally disabled by its UAT gate; credentials are not required until enablement is approved.'],
    },
    result,
  );
  return calendarGateEnabled ? row : { ...row, status: 'disabled', latencyMs: null, error: null };
}

function cronHealthRow() {
  const configured = Boolean(process.env.CRON_SECRET);
  return healthRow({
    id: 'vercel-cron',
    name: 'Vercel Cron Protection',
    category: 'Scheduling',
    purpose: 'Protects the retained scheduled Outstanding Buyer Invoices email path; delivery can be paused by its emergency control.',
    scope: 'server',
    provider: 'Vercel Cron',
    endpoint: '/api/functions/outstandingBuyerInvoicesEmailCron',
    authType: 'Bearer CRON_SECRET',
    configured,
    configuredEnv: configuredEnv(['CRON_SECRET']),
    missingEnv: configured ? [] : ['CRON_SECRET'],
    tokenExpiry: 'Not applicable.',
    details: { deliveryGateEnabled: isExternalActionEnabled('email_delivery') },
  });
}

function vercelRuntimeHealthRow() {
  const configured = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
  const telemetry = currentRequestTelemetry();
  const runtimeDurationMs = telemetry ? Date.now() - telemetry.startedAtMs : 0;
  return healthRow(
    {
      id: 'vercel-runtime',
      name: 'Vercel Runtime',
      category: 'Hosting',
      purpose: 'Hosts the React app and serverless API functions.',
      scope: 'server',
      provider: 'Vercel',
      endpoint: process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || null,
      authType: 'Deployment environment',
      configured,
      details: {
        environment: process.env.VERCEL_ENV || null,
        region: process.env.VERCEL_REGION || process.env.AWS_REGION || null,
        deploymentId: maskValue(process.env.VERCEL_DEPLOYMENT_ID, 8, 6),
        commit: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 8) || null,
        nodeVersion: process.version,
        functionCheckDurationMs: runtimeDurationMs,
      },
      tokenExpiry: 'Not applicable.',
    },
    configured
      ? {
          ok: true,
          latencyMs: runtimeDurationMs,
          status: 'online',
          details: {},
        }
      : null,
  );
}

function googleFontsHealthRow() {
  return healthRow({
    id: 'google-fonts',
    name: 'Google Fonts',
    category: 'Frontend Asset',
    purpose: 'Loads Inter and DM Sans web fonts from the CSS import.',
    scope: 'browser',
    provider: 'Google Fonts',
    endpoint: 'https://fonts.googleapis.com',
    authType: 'No API key',
    configured: true,
    tokenExpiry: 'Not applicable.',
    notes: ['Loaded by the browser as a frontend asset, not through the server API.'],
  });
}

function providerDashboardLinks() {
  const supabaseHost = (() => {
    try {
      return new URL(supabaseUrl()).hostname;
    } catch {
      return '';
    }
  })();
  const supabaseProjectRef = supabaseHost.endsWith('.supabase.co') ? supabaseHost.split('.')[0] : '';
  const vercelDashboard = process.env.VERCEL_DASHBOARD_URL || 'https://vercel.com/dashboard';
  return {
    supabaseReports: process.env.SUPABASE_DASHBOARD_URL || (supabaseProjectRef ? `https://supabase.com/dashboard/project/${supabaseProjectRef}/reports/database` : 'https://supabase.com/dashboard/projects'),
    vercelObservability: process.env.VERCEL_OBSERVABILITY_URL || vercelDashboard,
    vercelRuntimeCache: process.env.VERCEL_RUNTIME_CACHE_URL || vercelDashboard,
    vercelSpeedInsights: process.env.VERCEL_SPEED_INSIGHTS_URL || vercelDashboard,
  };
}

async function cachedHealthCheck(namespace, ttlSeconds, force, loader, payload = null) {
  const cached = await getOrLoadRuntimeCache({
    namespace: `system-health-${namespace}`,
    version: '1',
    accessScope: 'health',
    apiVersion: '1',
    payload,
    ttlSeconds,
    tags: [`system-health:${namespace}`],
    force,
    loader,
  });
  return cached.value;
}

function connectionAttestationFromRow(row) {
  const attestation = sanitizeConnectionAttestation({
    schemaVersion: row?.schema_version,
    policyVersion: row?.policy_version,
    profile: row?.profile,
    keyId: row?.key_id,
    verifiedAt: row?.verified_at,
    expiresAt: row?.expires_at,
    durationMs: row?.duration_ms,
    providers: row?.providers,
  });
  return attestation ? { ...attestation, revision: Number(row.revision) } : null;
}

async function connectionAttestationHealthRow() {
  const base = {
    id: 'connection-attestation',
    name: 'CLI Connection Attestation',
    category: 'Shared Platform',
    purpose: 'Publishes signed, non-secret CLI identity, target, version, permission, and credential-lifecycle checks.',
    scope: 'server',
    provider: 'FCOS Connection Policy',
    endpoint: '/api/connection-attestation',
    authType: 'Ed25519 machine signature',
    configured: true,
  };
  const startedAt = Date.now();
  try {
    const { data, error } = await supabaseAdminClient()
      .from('connection_attestations')
      .select('profile,revision,schema_version,policy_version,key_id,verified_at,expires_at,duration_ms,providers')
      .eq('profile', 'fcos-production')
      .order('verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const attestation = connectionAttestationFromRow(data);
    const state = connectionAttestationState(attestation);
    const status = state.status === 'verified'
      ? 'online'
      : state.status === 'warning'
        ? 'warning'
        : state.status === 'unavailable'
          ? 'unavailable'
          : 'critical';
    return {
      attestation,
      row: healthRow(base, {
        ok: status !== 'unavailable',
        status,
        latencyMs: Date.now() - startedAt,
        error: status === 'unavailable' ? 'No signed connection attestation is available.' : null,
        details: { state },
      }),
    };
  } catch (error) {
    const failure = safeHealthFailure(error);
    return {
      attestation: null,
      row: healthRow(base, {
        ok: false,
        status: 'unavailable',
        latencyMs: Date.now() - startedAt,
        error: failure.message,
        errorCode: failure.code,
      }),
    };
  }
}

async function systemHealth(body = {}, req = null, accessContext) {
  const profile = accessContext?.profile;
  const force = requestForcesRefresh(body, req);
  const [providerRows, connectionAttestation] = await Promise.all([
    Promise.all([
    salesforceHealthRow({ force }),
    cachedHealthCheck('special-terms-migration', 60, force, () => specialTermsMigrationHealthRow({ force })),
    supabaseHealthRow({ force }),
    profile
      ? cachedHealthCheck('backbone', 60, force, () => backboneBridgeHealthRow(accessContext), { profileId: profile.id })
      : Promise.resolve(
          healthRow({
            id: 'fcos-backbone-bridge',
            name: 'FCOS Backbone Shared Boundary',
            category: 'Shared Platform',
            purpose: 'Resolves FCOS identities and reads Backbone projections.',
            scope: 'server',
            provider: 'FCOS Backbone',
            endpoint: null,
            authType: 'Timestamped HMAC',
            configured: false,
            missingEnv: ['Active FCOS profile'],
          }),
        ),
    cachedHealthCheck('google-drive', 5 * 60, force, googleDriveHealthRow),
    cachedHealthCheck('frankfurter', 30 * 60, force, frankfurterHealthRow),
    cachedHealthCheck('nager-date', 30 * 60, force, nagerHealthRow),
    cachedHealthCheck('operational-mail', 5 * 60, force, operationalMailHealthRow),
    cachedHealthCheck('fcos-updates-mail', 5 * 60, force, fcosUpdatesMailHealthRow),
    cachedHealthCheck('hedge-desk', 60, force, hedgeDeskHealthRow),
    cachedHealthCheck('email-router', 60, force, emailRouterHealthRow),
    cachedHealthCheck('outlook-calendar', 5 * 60, force, outlookCalendarHealthRow),
    ]),
    connectionAttestationHealthRow(),
  ]);
  const rows = [...providerRows, connectionAttestation.row];
  rows.push(externalActionGateHealthRow(), cronHealthRow(), vercelRuntimeHealthRow(), googleFontsHealthRow());
  const summary = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    },
    { total: 0 },
  );
  const rowById = Object.fromEntries(rows.map((row) => [row.id, row]));
  const telemetry = currentRequestTelemetry();
  const providerLinks = providerDashboardLinks();
  return {
    generatedAt: new Date().toISOString(),
    summary,
    thresholds: {
      errorRateWarningPct: 1,
      errorRateCriticalPct: 3,
      connectionWarningPct: 70,
      connectionCriticalPct: 85,
      memoryWarningPct: 80,
      memoryCriticalPct: 90,
      diskWarningPct: 70,
      diskCriticalPct: 85,
    },
    providerLinks,
    connectionAttestation: connectionAttestation.attestation,
    kpis: {
      salesforce: {
        ...(rowById.salesforce?.details?.dailyApi || {}),
        probeLatencyMs: rowById.salesforce?.latencyMs ?? null,
      },
      supabase: {
        ...(rowById.supabase?.details?.metrics || {}),
        probeLatencyMs: rowById.supabase?.latencyMs ?? null,
        monitoringAvailable: rowById.supabase?.details?.monitoringAvailable === true,
        monitoringError: rowById.supabase?.details?.monitoringError || null,
      },
      vercel: {
        environment: rowById['vercel-runtime']?.details?.environment || null,
        region: rowById['vercel-runtime']?.details?.region || null,
        nodeVersion: rowById['vercel-runtime']?.details?.nodeVersion || null,
        functionCheckDurationMs: rowById['vercel-runtime']?.details?.functionCheckDurationMs ?? null,
      },
      request: telemetry
        ? {
            salesforceCalls: telemetry.salesforce.quotaCalls,
            salesforceLogicalQueries: telemetry.salesforce.logicalQueries,
            salesforceCompositeCalls: telemetry.salesforce.compositeCalls,
            cacheHits: telemetry.cache.hits,
            cacheMisses: telemetry.cache.misses,
            supabaseRequests: telemetry.supabase.requests,
          }
        : null,
    },
    externalActionGates: externalActionGates(),
    rows,
  };
}

async function backboneBridgeIdentity(_body, req, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return backboneBridgeRequest(authenticatedBackboneBridgePayload({ operation: 'identity.resolve' }, context));
}

async function backboneTradeProjection(body, req, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const operation = String(body.operation || 'trade.find');
  if (!['trade.find', 'trade.changes', 'audit.list'].includes(operation)) {
    throw appError('Unsupported FCOS Backbone read operation.', 400);
  }
  const payload = authenticatedBackboneBridgePayload({ ...body, operation }, context);
  const response = await backboneBridgeRequest(payload);
  return browserSafeBackboneTradeProjection(response);
}

async function backboneFinanceHandoffs(body = {}, req, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const limit = body.limit == null ? 50 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw appError('Finance handoff limit must be between 1 and 100.', 400);
  }
  return backboneBridgeRequest(authenticatedBackboneBridgePayload({ operation: 'finance.handoffs', limit }, context));
}

async function backboneFinanceHandoffDetail(body = {}, req, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const handoffId = String(body.handoffId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(handoffId)) {
    throw appError('A valid Finance handoff is required.', 400);
  }
  const response = await backboneBridgeRequest(authenticatedBackboneBridgePayload({ operation: 'finance.handoff.detail', handoffId }, context));
  return browserSafeBackboneFinanceHandoff(response);
}

function isSafeSalesforceFieldPath(value) {
  const parts = String(value || '')
    .trim()
    .split('.')
    .filter(Boolean);
  if (!parts.length || parts.length > 4) return false;
  return parts.every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part));
}

function normalizeSalesforceFieldPath(value) {
  const raw = String(value || '').trim();
  return isSafeSalesforceFieldPath(raw) ? raw : '';
}

function numericValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numericValue(value);
    if (number != null) return number;
  }
  return null;
}

function dashboardProductFamily(item) {
  const family = String(item['Product__r']?.Family || item['Product2Id__r']?.Family || '').toUpperCase();
  const productName = String(item['Product__r']?.Name || item['Product2Id__r']?.Name || item.Name || item.Description__c || '').toUpperCase();
  const text = `${family} ${productName}`;
  if (text.includes('LSMGO') || text.includes('MGO') || text.includes('DIESEL') || /\bDMA\b/.test(text) || /\bDMB\b/.test(text)) return 'LSMGO';
  if (text.includes('VLSFO')) return 'VLSFO';
  if (text.includes('HSFO')) return 'HSFO';
  if (text.includes('RMG') || text.includes('RME') || text.includes('RMK')) {
    if (/3\.?5|380CST|180CST|500CST/.test(text) && !/0\.5|0\.50|0\.1|0\.10|0\.05/.test(text)) return 'HSFO';
    return 'VLSFO';
  }
  return family || productName || 'Unspecified';
}

function formatQuantityLabel(value, unit = 'MT') {
  return `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`;
}

function lineItemQuantityLabel(item, stemHasDelivery) {
  return financialQuantityLabel(item, stemHasDelivery);
}

function lineSellAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Total_Price__c ?? 0;
  const unit = firstNumber(item.Price_Per_Unit__c, item.Unit_Sell_At__c, item['Offer_Line_Item__r']?.UnitPrice);
  const qty = financialQuantity(item, false);
  return unit != null ? unit * qty : (item.Total_Price__c ?? 0);
}

function lineBuyAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Total_Cost__c ?? 0;
  const unit = firstNumber(item.Cost_Per_Unit__c, item.Unit_Buy_At__c, item.Unit_Cost__c, item['Offer_Line_Item__r']?.Supplier_Unit_Price__c);
  const qty = financialQuantity(item, false);
  return unit != null ? unit * qty : (item.Total_Cost__c ?? 0);
}

function extraSellAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Line_Total__c ?? 0;
  const unit = firstNumber(item.Unit_Price__c);
  const qty = financialQuantity(item, false, 'Quantity_Range_Max__c');
  return unit != null ? unit * qty : (item.Line_Total__c ?? 0);
}

function extraBuyAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Line_Total_Buy__c ?? 0;
  const unit = firstNumber(item.Unit_Cost__c);
  const qty = financialQuantity(item, false, 'Quantity_Range_Max__c');
  return unit != null ? unit * qty : (item.Line_Total_Buy__c ?? 0);
}

function supplierBrokerCommission(item, stemHasDelivery) {
  return (item.Suppliers_Brokers_Commission_Per_Unit__c ?? 0) * financialQuantity(item, stemHasDelivery);
}

function buyerBrokerCommission(item, stemHasDelivery) {
  const qty = financialQuantity(item, stemHasDelivery);
  const buyerPerUnitTotal = (item.Buyers_Brokers_Commission_Per_Unit__c ?? 0) * qty;
  const suppBrokerPerUnit = item.Suppliers_Brokers_Commission_Per_Unit__c ?? 0;
  if (suppBrokerPerUnit !== 0 || item.Buyers_Brokers_Commission_Per_Unit__c != null) return buyerPerUnitTotal;
  return item.Commission_Cost__c ?? buyerPerUnitTotal;
}

function formatStemName(stem) {
  const parts = [stem.KeyStem__c, stem['Vessel__r']?.Name, stem['Port__r']?.Name].filter(Boolean);
  return parts.length ? parts.join(' - ') : stem.Name;
}

function parseEmailList(value, fallback = []) {
  if (Array.isArray(value)) return value.map(canonicalizeBuyerInvoiceEmail).filter(Boolean);
  if (typeof value !== 'string') return fallback;
  const parsed = value
    .split(/[,\n;]/)
    .map(canonicalizeBuyerInvoiceEmail)
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function uniqueEmailList(...values) {
  const seen = new Set();
  const emails = [];
  const addValue = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) addValue(item);
      return;
    }
    if (typeof value !== 'string') return;
    for (const email of value
      .split(/[,\n;]/)
      .map((item) => item.trim())
      .filter(Boolean)) {
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(email);
    }
  };
  for (const value of values) addValue(value);
  return emails;
}

function uniqueTextList(values = []) {
  const seen = new Set();
  const items = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(text);
  }
  return items;
}

function normalizedFieldToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function fieldMatchesAny(field, exactTokens = [], includeTokens = []) {
  const values = [field?.name, field?.label].map(normalizedFieldToken).filter(Boolean);
  if (values.some((value) => exactTokens.includes(value))) return true;
  return values.some((value) => includeTokens.some((token) => value.includes(token)));
}

function accountInvoiceFormatFields(accountFields = []) {
  return accountFields
    .filter((field) => {
      const token = normalizedFieldToken(`${field?.name || ''} ${field?.label || ''}`);
      return fieldMatchesAny(field, ['invoiceformat', 'invoiceformatc', 'invoiceemailsetting', 'invoiceemailsettingc', 'invoiceemailformat', 'invoiceemailformatc', 'invoiceemailrouting', 'invoiceemailroutingc'], ['invoiceformat', 'invoiceemailsetting', 'invoiceemailformat', 'invoiceemailrouting', 'brokerinvoiceformat', 'brokerinvoiceemail']) || (token.includes('invoiceemail') && ['picklist', 'multipicklist', 'string'].includes(field?.type));
    })
    .map((field) => field.name);
}

function accountBrokerEmailFields(accountFields = []) {
  const excluded = (field) => {
    const token = normalizedFieldToken(`${field?.name || ''} ${field?.label || ''}`);
    return token.includes('invoice') || token.includes('accounts') || token.includes('accounting');
  };
  return accountFields
    .filter((field) => {
      if (excluded(field)) return false;
      const token = normalizedFieldToken(`${field?.name || ''} ${field?.label || ''}`);
      return fieldMatchesAny(field, ['email', 'emailc', 'emailaddress', 'emailaddressc', 'brokeremail', 'brokeremailc', 'brokeremailaddress', 'brokeremailaddressc']) || field.type === 'email' || token.includes('email') || token.includes('mail');
    })
    .map((field) => field.name);
}

function emailTokensFromValue(value) {
  if (Array.isArray(value)) return value.flatMap(emailTokensFromValue);
  return [...String(value || '').matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]);
}

function routingFormatValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const text = raw
    .toLowerCase()
    .replace(/[./_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.includes('buyer only') || text.includes('broker only') || /^to broker\b/.test(text) || text.includes('buyer c o broker') || text.includes('buyer co broker') || text.includes('buyer cc broker') || text.includes('cc broker') || text.includes('copy broker') || text.includes('c o broker')) {
    return raw;
  }
  return null;
}

function buyerBrokerRoutingMode(format, brokerEmails = []) {
  const raw = String(format || '').trim();
  const text = raw
    .toLowerCase()
    .replace(/[./_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasBrokerEmail = uniqueEmailList(brokerEmails).length > 0;
  if (!raw) {
    return {
      mode: 'buyer_only',
      label: 'Buyer Only',
      warnings: ['Broker invoice/email format is blank; broker email is not automatically added to BCC.'],
    };
  }
  if (text.includes('buyer only')) {
    return { mode: 'buyer_only', label: raw, warnings: [] };
  }
  if (text.includes('broker only') || /^to broker\b/.test(text)) {
    return {
      mode: 'broker_only',
      label: raw,
      warnings: hasBrokerEmail ? [] : [`Broker email is missing for ${raw}; enter the broker email manually before sending.`],
    };
  }
  if (text.includes('buyer c o broker') || text.includes('buyer co broker') || text.includes('buyer cc broker') || text.includes('cc broker') || text.includes('copy broker') || text.includes('c o broker')) {
    return {
      mode: 'buyer_cc_broker',
      label: raw,
      warnings: hasBrokerEmail ? [] : [`Broker email is missing for ${raw}; buyer remains the recipient and broker CC is blank.`],
    };
  }
  return {
    mode: 'buyer_only',
    label: raw,
    warnings: [`Unknown broker invoice/email format "${raw}"; broker email is not automatically added to BCC.`],
  };
}

function combineBuyerBrokerRouting(details = []) {
  if (!details.length) {
    return {
      buyerBrokerNames: '',
      buyerBrokerInvoiceFormats: '',
      buyerBrokerEmails: '',
      buyerBrokerRoutingMode: 'buyer_only',
      buyerBrokerRoutingWarnings: [],
      buyerBrokerDetails: [],
    };
  }
  const warnings = [];
  const brokerEmails = [];
  const buyerOnlyBrokerEmails = [];
  const modes = [];
  for (const detail of details) {
    const routing = buyerBrokerRoutingMode(detail.invoiceFormat, detail.emails);
    modes.push(routing.mode);
    warnings.push(...routing.warnings.map((warning) => `${detail.name || 'Buyer broker'}: ${warning}`));
    if (routing.mode !== 'buyer_only') {
      brokerEmails.push(...(detail.emails || []));
    } else if (/\bbuyer\s+only\b/i.test(String(routing.label || detail.invoiceFormat || ''))) {
      buyerOnlyBrokerEmails.push(...(detail.emails || []));
    }
  }
  const validModes = modes.filter((mode) => mode !== 'buyer_only');
  const routingMode = validModes.includes('broker_only') && !validModes.includes('buyer_cc_broker') ? 'broker_only' : validModes.includes('buyer_cc_broker') ? 'buyer_cc_broker' : 'buyer_only';
  if (new Set(validModes).size > 1) {
    warnings.push('Multiple buyer broker routing formats found on this invoice; buyer with broker copied is used.');
  }
  return {
    buyerBrokerNames: uniqueTextList(details.map((detail) => detail.name)).join(', '),
    buyerBrokerInvoiceFormats: uniqueTextList(details.map((detail) => detail.invoiceFormat)).join(', '),
    buyerBrokerEmails: uniqueEmailList(routingMode === 'buyer_only' ? buyerOnlyBrokerEmails : brokerEmails).join(', '),
    buyerBrokerRoutingMode: routingMode,
    buyerBrokerRoutingWarnings: warnings,
    buyerBrokerDetails: details.map((detail) => ({
      brokerId: detail.id,
      name: detail.name,
      invoiceFormat: detail.invoiceFormat || null,
      emails: detail.emails || [],
      routingMode: buyerBrokerRoutingMode(detail.invoiceFormat, detail.emails).mode,
    })),
  };
}

function parseStringList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return fallback;
  const parsed = value
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function normalizeCollectionStatus(value) {
  const status = String(value || '').trim();
  const migratedStatus = LEGACY_BUYER_INVOICE_COLLECTION_STATUSES[status] || status;
  return BUYER_INVOICE_COLLECTION_STATUSES.includes(migratedStatus) ? migratedStatus : 'To Contact';
}

function dateOrNull(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : raw;
}

function decimalOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeEventType(value) {
  const type = String(value || '').trim();
  return BUYER_INVOICE_EVENT_TYPES.includes(type) ? type : 'update';
}

function collectionEventTypeFromChanges(changes) {
  if (Object.prototype.hasOwnProperty.call(changes, 'status')) return 'status_change';
  if (Object.prototype.hasOwnProperty.call(changes, 'owner_name')) return 'owner_change';
  if (Object.prototype.hasOwnProperty.call(changes, 'promised_payment_date') || Object.prototype.hasOwnProperty.call(changes, 'promised_amount')) return 'promise';
  if (Object.prototype.hasOwnProperty.call(changes, 'next_follow_up_date')) return 'follow_up';
  if (Object.prototype.hasOwnProperty.call(changes, 'latest_note')) return 'note';
  return 'update';
}

function serializeCollectionItem(row) {
  if (!row) return null;
  return {
    stemId: row.stem_id,
    status: normalizeCollectionStatus(row.status),
    ownerUserId: row.owner_user_id || null,
    ownerName: row.owner_name || '',
    latestNote: row.latest_note || '',
    nextFollowUpDate: row.next_follow_up_date || null,
    promisedPaymentDate: row.promised_payment_date || null,
    promisedAmount: row.promised_amount == null ? null : Number(row.promised_amount),
    onHoldReason: row.on_hold_reason || null,
    onHoldReviewDate: row.on_hold_review_date || null,
    adviceReceivedDate: row.advice_received_date || null,
    adviceAmount: row.advice_amount == null ? null : Number(row.advice_amount),
    adviceReference: row.advice_reference || null,
    adviceVerificationDate: row.advice_verification_date || null,
    adviceDocumentIds: Array.isArray(row.advice_document_ids) ? row.advice_document_ids : [],
    reconciliationState: row.reconciliation_state || 'not_checked',
    verifiedReceivableBalance: row.verified_receivable_balance == null ? null : Number(row.verified_receivable_balance),
    latestPaymentSnapshot: row.latest_payment_snapshot || null,
    paymentReconciliationSnapshot: row.payment_reconciliation_snapshot || null,
    postingReminderOverrideReason: row.posting_reminder_override_reason || null,
    postingReminderOverrideBy: row.posting_reminder_override_by || null,
    postingReminderOverrideByEmail: row.posting_reminder_override_by_email || null,
    postingReminderOverrideAt: row.posting_reminder_override_at || null,
    postingReminderOverrideIssueKey: row.posting_reminder_override_issue_key || null,
    postingReminderOverrideActive: Boolean(
      row.posting_reminder_override_reason
      && row.posting_reminder_override_issue_key
      && row.posting_reminder_override_issue_key === row.payment_reconciliation_snapshot?.issueKey
      && PAYMENT_POSTING_ISSUE_STATES.has(String(row.reconciliation_state || ''))
    ),
    previousActiveStatus: row.previous_active_status || null,
    closureSource: row.closure_source || null,
    lastReconciledAt: row.last_reconciled_at || null,
    lastEventAt: row.last_event_at || null,
    lastUpdatedBy: row.last_updated_by || null,
    lastUpdatedByEmail: row.last_updated_by_email || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeCollectionEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    stemId: row.stem_id,
    eventType: row.event_type || 'update',
    status: row.status || null,
    ownerName: row.owner_name || null,
    note: row.note || null,
    nextFollowUpDate: row.next_follow_up_date || null,
    promisedPaymentDate: row.promised_payment_date || null,
    promisedAmount: row.promised_amount == null ? null : Number(row.promised_amount),
    eventKey: row.event_key || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    actorUserId: row.actor_user_id || null,
    actorEmail: row.actor_email || null,
    createdAt: row.created_at || null,
  };
}

async function loadBuyerInvoiceCollectionMap(stemIds = []) {
  const ids = [...new Set((stemIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const client = safeSupabaseAdminClient();
  if (!client) return {};

  try {
    const [itemsRes, eventsRes] = await Promise.all([
      client.from('buyer_invoice_collection_items').select(BUYER_COLLECTION_ITEM_SELECT).in('stem_id', ids),
      client
        .from('buyer_invoice_collection_events')
        .select('id,stem_id,event_type,event_key,status,owner_name,note,next_follow_up_date,promised_payment_date,promised_amount,metadata,actor_user_id,actor_email,created_at')
        .in('stem_id', ids)
        .order('created_at', { ascending: false })
        .limit(Math.max(100, Math.min(ids.length * 20, 2000))),
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (eventsRes.error) throw eventsRes.error;

    const map = {};
    for (const item of itemsRes.data || []) {
      map[item.stem_id] = { item: serializeCollectionItem(item), events: [] };
    }
    for (const event of eventsRes.data || []) {
      if (!map[event.stem_id]) map[event.stem_id] = { item: null, events: [] };
      map[event.stem_id].events.push(serializeCollectionEvent(event));
    }
    return map;
  } catch (error) {
    console.error('Failed to load buyer invoice collection metadata', error.message);
    return {};
  }
}

function normalizeCollectionUpdates(updates = {}, profile = {}) {
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(updates, 'status')) normalized.status = normalizeCollectionStatus(updates.status);
  if (Object.prototype.hasOwnProperty.call(updates, 'ownerName') || Object.prototype.hasOwnProperty.call(updates, 'owner_name')) {
    normalized.owner_name = String(updates.ownerName ?? updates.owner_name ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'latestNote') || Object.prototype.hasOwnProperty.call(updates, 'latest_note')) {
    normalized.latest_note = String(updates.latestNote ?? updates.latest_note ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'nextFollowUpDate') || Object.prototype.hasOwnProperty.call(updates, 'next_follow_up_date')) {
    normalized.next_follow_up_date = dateOrNull(updates.nextFollowUpDate ?? updates.next_follow_up_date);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'promisedPaymentDate') || Object.prototype.hasOwnProperty.call(updates, 'promised_payment_date')) {
    normalized.promised_payment_date = dateOrNull(updates.promisedPaymentDate ?? updates.promised_payment_date);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'promisedAmount') || Object.prototype.hasOwnProperty.call(updates, 'promised_amount')) {
    normalized.promised_amount = decimalOrNull(updates.promisedAmount ?? updates.promised_amount);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'onHoldReason') || Object.prototype.hasOwnProperty.call(updates, 'on_hold_reason')) {
    normalized.on_hold_reason = String(updates.onHoldReason ?? updates.on_hold_reason ?? '').trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'onHoldReviewDate') || Object.prototype.hasOwnProperty.call(updates, 'on_hold_review_date')) {
    normalized.on_hold_review_date = dateOrNull(updates.onHoldReviewDate ?? updates.on_hold_review_date);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'adviceReceivedDate') || Object.prototype.hasOwnProperty.call(updates, 'advice_received_date')) {
    normalized.advice_received_date = dateOrNull(updates.adviceReceivedDate ?? updates.advice_received_date);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'adviceAmount') || Object.prototype.hasOwnProperty.call(updates, 'advice_amount')) {
    normalized.advice_amount = decimalOrNull(updates.adviceAmount ?? updates.advice_amount);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'adviceReference') || Object.prototype.hasOwnProperty.call(updates, 'advice_reference')) {
    normalized.advice_reference = String(updates.adviceReference ?? updates.advice_reference ?? '').trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'adviceVerificationDate') || Object.prototype.hasOwnProperty.call(updates, 'advice_verification_date')) {
    normalized.advice_verification_date = dateOrNull(updates.adviceVerificationDate ?? updates.advice_verification_date);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'adviceDocumentIds') || Object.prototype.hasOwnProperty.call(updates, 'advice_document_ids')) {
    normalized.advice_document_ids = [...new Set((updates.adviceDocumentIds ?? updates.advice_document_ids ?? []).map((id) => String(id || '').trim()).filter(isSalesforceId))];
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'reconciliationState') || Object.prototype.hasOwnProperty.call(updates, 'reconciliation_state')) {
    const state = String(updates.reconciliationState ?? updates.reconciliation_state ?? '').trim();
    normalized.reconciliation_state = BUYER_COLLECTION_RECONCILIATION_STATES.has(state) ? state : 'not_checked';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'verifiedReceivableBalance') || Object.prototype.hasOwnProperty.call(updates, 'verified_receivable_balance')) {
    normalized.verified_receivable_balance = decimalOrNull(updates.verifiedReceivableBalance ?? updates.verified_receivable_balance);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'latestPaymentSnapshot') || Object.prototype.hasOwnProperty.call(updates, 'latest_payment_snapshot')) {
    const snapshot = updates.latestPaymentSnapshot ?? updates.latest_payment_snapshot;
    normalized.latest_payment_snapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'previousActiveStatus') || Object.prototype.hasOwnProperty.call(updates, 'previous_active_status')) {
    const previous = updates.previousActiveStatus ?? updates.previous_active_status;
    normalized.previous_active_status = previous ? normalizeCollectionStatus(previous) : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'closureSource') || Object.prototype.hasOwnProperty.call(updates, 'closure_source')) {
    const closureSource = String(updates.closureSource ?? updates.closure_source ?? '').trim();
    normalized.closure_source = ['manual', 'system'].includes(closureSource) ? closureSource : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'lastReconciledAt') || Object.prototype.hasOwnProperty.call(updates, 'last_reconciled_at')) {
    const timestamp = updates.lastReconciledAt ?? updates.last_reconciled_at;
    normalized.last_reconciled_at = timestamp ? new Date(timestamp).toISOString() : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'ownerUserId') || Object.prototype.hasOwnProperty.call(updates, 'owner_user_id')) {
    normalized.owner_user_id = updates.ownerUserId || updates.owner_user_id || null;
  } else if (normalized.owner_name && profile?.full_name && normalized.owner_name === profile.full_name) {
    normalized.owner_user_id = profile.id;
  }
  return normalized;
}

function normalizeBuyerInvoiceEmailSettings(input = {}, defaults = DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS) {
  const safeInput = { ...input };
  delete safeInput.from;
  const reminderBody = String(input.paymentReminderBody ?? defaults.paymentReminderBody)
    .replace(/Dear\s+\{\{\s*buyerName\s*\}\}/i, 'Dear {{primaryRecipientName}}')
    .replace(/To\s+\{\{\s*buyerName\s*\}\}/i, 'To {{primaryRecipientName}}');
  return {
    ...defaults,
    ...safeInput,
    enabled: input.enabled ?? defaults.enabled,
    to: parseEmailList(input.to, defaults.to),
    cc: parseEmailList(input.cc, defaults.cc),
    bcc: parseEmailList(input.bcc, defaults.bcc),
    daysAhead: Math.max(0, Math.min(Number(input.daysAhead ?? defaults.daysAhead) || defaults.daysAhead, 365)),
    subject: String(input.subject ?? defaults.subject),
    intro: String(input.intro ?? defaults.intro),
    includeSummary: input.includeSummary ?? defaults.includeSummary,
    includeTable: input.includeTable ?? defaults.includeTable,
    buyerTraders: parseStringList(input.buyerTraders, defaults.buyerTraders),
    weekdays: parseStringList(input.weekdays, defaults.weekdays),
    sendTimes: parseStringList(input.sendTimes, defaults.sendTimes),
    paymentReminderRecipientFieldPath: normalizeSalesforceFieldPath(input.paymentReminderRecipientFieldPath ?? defaults.paymentReminderRecipientFieldPath),
    paymentReminderCc: parseEmailList(input.paymentReminderCc, defaults.paymentReminderCc),
    paymentReminderBcc: parseEmailList(input.paymentReminderBcc, defaults.paymentReminderBcc),
    paymentReminderSubject: String(input.paymentReminderSubject ?? defaults.paymentReminderSubject),
    paymentReminderBody: reminderBody,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value) {
  if (value == null || value === '') return '-';
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function prettyDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

async function resolveViaQuery(objectType, id, nameField = 'Name') {
  if (!id) return null;
  try {
    const rows = await queryRows(`SELECT ${nameField} FROM ${objectType} WHERE Id = '${escapeSoql(id)}' LIMIT 1`, { softFail: true });
    return rows[0]?.[nameField] ?? null;
  } catch {
    return null;
  }
}

const DOCUMENT_SOURCE_GROUPS = ['Direct STEM', 'Invoices to Buyer', 'Invoices from Suppliers', 'Contracts and Compliance', 'Dispute / Support', 'Product Line Attachments', 'Extra Cost', 'Broker', 'Email', 'Other Related'];

const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

function isSalesforceId(value) {
  return typeof value === 'string' && SALESFORCE_ID_RE.test(value);
}

function cleanDownloadFilename(value, fallback = 'salesforce-document') {
  return (
    String(value || fallback)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || fallback
  );
}

const DOCUMENT_MIME_TYPES = {
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  eml: 'message/rfc822',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  msg: 'application/vnd.ms-outlook',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function documentContentType(filename, salesforceContentType) {
  const rawType = String(salesforceContentType || '')
    .trim()
    .toLowerCase();
  const genericTypes = new Set(['', 'application/octet-stream', 'application/octetstream', 'binary/octet-stream']);
  if (!genericTypes.has(rawType)) return salesforceContentType;
  const extension = String(filename || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  return DOCUMENT_MIME_TYPES[extension] || 'application/octet-stream';
}

function inferStemFieldSourceGroup(fieldName) {
  const lower = String(fieldName || '').toLowerCase();
  if (lower.includes('supplier') && lower.includes('invoice')) return 'Invoices from Suppliers';
  if (lower.includes('invoice') || lower.includes('factoring')) return 'Invoices to Buyer';
  if (lower.includes('nomination')) return 'Contracts and Compliance';
  if (lower.includes('dispute')) return 'Dispute / Support';
  if (lower.includes('email') || lower.includes('mail')) return 'Email';
  return null;
}

function addRelatedRecord(records, seen, { id, sourceGroup, sourceLabel, sourceObject, name }) {
  if (!isSalesforceId(id) || seen.has(id)) return;
  seen.add(id);
  records.push({
    id,
    sourceGroup: DOCUMENT_SOURCE_GROUPS.includes(sourceGroup) ? sourceGroup : 'Other Related',
    sourceLabel: sourceLabel || sourceGroup || 'Related Record',
    sourceObject: sourceObject || null,
    name: name || sourceLabel || id,
  });
}

async function resolveStemId(stemId, accessContext = null) {
  if (!stemId) throw new Error('stemId required');
  if (isSalesforceId(stemId)) {
    await requireInterofficeStemAccess(stemId, accessContext);
    return stemId;
  }
  const lookup = await queryRows(`SELECT Id FROM stem__c WHERE KeyStem__c = '${escapeSoql(stemId)}' LIMIT 1`, { softFail: true });
  if (!lookup.length) throw new Error(`STEM with KeyStem__c '${stemId}' not found`);
  await requireInterofficeStemAccess(lookup[0].Id, accessContext);
  return lookup[0].Id;
}

async function namesByIds(objectName, ids) {
  const uniqueIds = [...new Set(ids.filter(isSalesforceId))];
  const names = {};
  if (!uniqueIds.length) return names;
  for (const chunk of chunkIds(uniqueIds)) {
    const inList = chunk.map((id) => `'${id}'`).join(',');
    const rows = await queryRows(`SELECT Id, Name FROM ${objectName} WHERE Id IN (${inList}) LIMIT 200`, { limit: 200, softFail: true });
    for (const row of rows) names[row.Id] = row.Name || row.Id;
  }
  return names;
}

async function recordsLinkedToStemByLookup(objectName, stemId, sourceGroup, sourceLabel) {
  let describe;
  try {
    describe = await salesforceObjectFields({ objectName });
  } catch {
    return [];
  }
  const fields = describe.fields || [];
  const nameField = fields.some((field) => field.name === 'Name') ? 'Name' : null;
  const lookupFields = fields.filter((field) => {
    const referenceTargets = (field.referenceTo || []).map((target) => String(target).toLowerCase());
    return field.type === 'reference' && (referenceTargets.includes('stem__c') || field.name.toLowerCase() === 'stem__c' || String(field.relationshipName || '').toLowerCase() === 'stem__r');
  });
  const records = [];
  const seen = new Set();
  for (const field of lookupFields) {
    const selectFields = ['Id', nameField].filter(Boolean).join(', ');
    const rows = await queryRows(`SELECT ${selectFields} FROM ${objectName} WHERE ${field.name} = '${stemId}' LIMIT 200`, { limit: 200, softFail: true });
    for (const row of rows) {
      addRelatedRecord(records, seen, {
        id: row.Id,
        sourceGroup,
        sourceLabel,
        sourceObject: objectName,
        name: row.Name || sourceLabel,
      });
    }
  }
  return records;
}

function buildContentVersionFilename(document, version) {
  const title = document?.Title || version?.Title || 'Salesforce File';
  const extension = version?.FileExtension || '';
  if (!extension || title.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) return cleanDownloadFilename(title);
  return cleanDownloadFilename(`${title}.${extension}`);
}

async function salesforceStemDocumentsUncached(body = {}, req = null, accessContext = null) {
  const actualStemId = await resolveStemId(body.stemId, accessContext);
  const record = await sfRequest(`/sobjects/stem__c/${actualStemId}`).then(cleanRecord);
  const relatedRecords = [];
  const seenRecordIds = new Set();

  addRelatedRecord(relatedRecords, seenRecordIds, {
    id: actualStemId,
    sourceGroup: 'Direct STEM',
    sourceLabel: 'STEM',
    sourceObject: 'stem__c',
    name: record.Name || record.KeyStem__c || actualStemId,
  });

  for (const [fieldName, value] of Object.entries(record || {})) {
    const sourceGroup = inferStemFieldSourceGroup(fieldName);
    if (!sourceGroup || !isSalesforceId(value)) continue;
    addRelatedRecord(relatedRecords, seenRecordIds, {
      id: value,
      sourceGroup,
      sourceLabel: fieldName.replace(/__c$/i, '').replace(/_/g, ' '),
      sourceObject: null,
      name: fieldName,
    });
  }

  const [lineItems, extraCosts, buyerBrokers] = await Promise.all([queryRows(`SELECT Id, Name, Supplier_Invoice__c, Supplier_Name__c, Product__r.Name FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC LIMIT 500`, { limit: 500, softFail: true }), queryRows(`SELECT Id, Name, Supplier_Invoice__c, Supplier_Name__c, Description__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC LIMIT 500`, { limit: 500, softFail: true }), queryRows(`SELECT Id, Refcode_Index__c, Buyer_Broker__c FROM STEM_Buyer_Broker__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC LIMIT 500`, { limit: 500, softFail: true })]);

  const supplierInvoiceIds = [...lineItems.map((row) => row.Supplier_Invoice__c), ...extraCosts.map((row) => row.Supplier_Invoice__c)].filter(isSalesforceId);
  const supplierInvoiceNames = await namesByIds('Supplier_Invoice__c', supplierInvoiceIds);

  for (const item of lineItems) {
    addRelatedRecord(relatedRecords, seenRecordIds, {
      id: item.Id,
      sourceGroup: 'Product Line Attachments',
      sourceLabel: item['Product__r']?.Name || item.Name || 'Product Line',
      sourceObject: 'STEM_Line_Item__c',
      name: item.Name || item['Product__r']?.Name,
    });
    if (item.Supplier_Invoice__c) {
      addRelatedRecord(relatedRecords, seenRecordIds, {
        id: item.Supplier_Invoice__c,
        sourceGroup: 'Invoices from Suppliers',
        sourceLabel: item.Supplier_Name__c || 'Supplier Invoice',
        sourceObject: 'Supplier_Invoice__c',
        name: supplierInvoiceNames[item.Supplier_Invoice__c] || item.Supplier_Name__c || 'Supplier Invoice',
      });
    }
  }

  for (const cost of extraCosts) {
    addRelatedRecord(relatedRecords, seenRecordIds, {
      id: cost.Id,
      sourceGroup: 'Extra Cost',
      sourceLabel: cost.Name || cost.Description__c || 'Extra Cost',
      sourceObject: 'STEM_Extra_Cost__c',
      name: cost.Name || cost.Description__c,
    });
    if (cost.Supplier_Invoice__c) {
      addRelatedRecord(relatedRecords, seenRecordIds, {
        id: cost.Supplier_Invoice__c,
        sourceGroup: 'Invoices from Suppliers',
        sourceLabel: cost.Supplier_Name__c || 'Supplier Invoice',
        sourceObject: 'Supplier_Invoice__c',
        name: supplierInvoiceNames[cost.Supplier_Invoice__c] || cost.Supplier_Name__c || 'Supplier Invoice',
      });
    }
  }

  for (const broker of buyerBrokers) {
    addRelatedRecord(relatedRecords, seenRecordIds, {
      id: broker.Id,
      sourceGroup: 'Broker',
      sourceLabel: broker.Refcode_Index__c || 'Buyer Broker',
      sourceObject: 'STEM_Buyer_Broker__c',
      name: broker.Refcode_Index__c || 'Buyer Broker',
    });
  }

  const lookupRelatedGroups = await Promise.all([recordsLinkedToStemByLookup('Supplier_Invoice__c', actualStemId, 'Invoices from Suppliers', 'Supplier Invoice'), recordsLinkedToStemByLookup('Invoice__c', actualStemIdÛmzÛ–òµë(š+myÜœ¤ñð™¥•±‘5…Ñ¡•Í¹ä¡™¥•±°lÍÕÁÁ±¥•É¥¹Ù½¥”œ°€ÍÕÁÁ±¥•É¥¹Ù½¥•Œœ°€ÍÕÁÁ±¥•É¥¹Ù½¥•¥œ°€ÍÕÁÁ±¥•É¥¹Ù½¥•¥‘Œt°lÍÕÁÁ±¥•É¥¹Ù½¥”œ°€ÍÕÁÁ±¥•É¥¹Øœ°€Ù•¹‘½É¥¹Ù½¥”t¤ì(€€€ô¤(€€€€¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤ì(€É•ÑÕÉ¸Õ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡l¸¸¹•á…Ñ¥•±‘Ì°€¸¸¹‘å¹…µ¥¥•±‘Ít¤¹Í±¥” À°€à¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì€ômt¤ì(€½¹ÍÐ™¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡Á…åµ•¹Ñ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐ•á…Ñ¥•±‘Ì€ôlQåÁ•}}Œœ°€A…åµ•¹Ñ}QåÁ•}}Œœ°€MÑ…ÑÕÍ}}Œœ°€A…åµ•¹Ñ}MÑ…ÑÕÍ}}Œœ°€¥É•Ñ¥½¹}}Œœ°€A…åµ•¹Ñ}¥É•Ñ¥½¹}}Œœ°€…Ñ•½Éå}}Œœ°€A…åµ•¹Ñ}…Ñ•½Éå}}Œœ°€A…å…‰±•}I••¥Ù…‰±•}}Œœ°€A}I}}Œœ°€A…å•É}}Œœ°€A…å½É}}Œœ°€A…å••}}Œœ°€É½µ}}Œœ°€Q½}}Œœ°€MÕÁÁ±¥•É}}Œœ°€Y•¹‘½É}}Œœ°€½Õ¹Ñ}}Œt¹™¥±Ñ•È ¡™¥•±¤€ôø™¥•±‘9…µ•Ì¹¡…Ì¡™¥•±¤¤ì(€½¹ÍÐ…±±½Ý•‘QåÁ•Ì€ô¹•ÜM•Ð¡lÍÑÉ¥¹œœ°€Ñ•áÑ…É•„œ°€Á¥­±¥ÍÐœ°€É•™•É•¹”t¤ì(€½¹ÍÐ‘å¹…µ¥¥•±‘Ì€ôÁ…åµ•¹Ñ¥•±‘Ì¹™¥±Ñ•È ¡™¥•±¤€ôø™¥•±ü¹¹…µ”€˜˜™¥•±¹¹…µ”€„ôô€9…µ”œ€˜˜…±±½Ý•‘QåÁ•Ì¹¡…Ì¡™¥•±¹ÑåÁ”¤€˜˜™¥•±‘5…Ñ¡•Í¹ä¡™¥•±°lÁ…åµ•¹ÑÑåÁ”œ°€Á…åµ•¹ÑÑåÁ•Œœ°€Á…åµ•¹Ñ‘¥É•Ñ¥½¸œ°€Á…åµ•¹Ñ‘¥É•Ñ¥½¹Œœ°€‘¥É•Ñ¥½¸œ°€‘¥É•Ñ¥½¹Œœ°€Á…å…‰±•É••¥Ù…‰±”œ°€Á…å…‰±•É••¥Ù…‰±•Œœ°€…Á…Èœ°€…Á…ÉŒœ°€ÍÕÁÁ±¥•Èœ°€ÍÕÁÁ±¥•ÉŒœ°€Ù•¹‘½Èœ°€Ù•¹‘½ÉŒœ°€Á…å•”œ°€Á…å••Œœ°€Á…å•Èœ°€Á…å•ÉŒœ°€Á…å½Èœ°€Á…å½ÉŒt°lÁ…åµ•¹ÑÑåÁ”œ°€‘¥É•Ñ¥½¸œ°€Á…å…‰±”œ°€É••¥Ù…‰±”œ°€ÍÕÁÁ±¥•Èœ°€Ù•¹‘½Èœ°€Á…å•”œ°€Á…å•Èœ°€Á…å½Èœ°€Á…å™É½´œ°€Á…åÑ¼œ°€É•¥Á¥•¹Ðœ°€‰•¹•™¥¥…Éäœ°€Á…ÉÑät¤¤¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤ì(€É•ÑÕÉ¸Õ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡l¸¸¹•á…Ñ¥•±‘Ì°€¸¸¹‘å¹…µ¥¥•±‘Ít¤¹Í±¥” À°€ÈÀ¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•%¡Á…åµ•¹Ð°ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì€ômt¤ì(€É•ÑÕÉ¸ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ðü¹m™¥•±‘t¤¹™¥¹ ¡Ù…±Õ”¤€ôø¥ÍM…±•Í™½É•%¡Ù…±Õ”¤¤ñð¹Õ±°ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ1½½­ÍMÕÁÁ±¥•ÉM¥‘”¡Á…åµ•¹Ð°ìÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì€ômt°‘¥É•Ñ¥½¹¥•±‘Ì€ômt°ÑåÁ•¥•±‘Ì€ômt°ÍÑ…ÑÕÍ¥•±‘Ì€ômtô€ôíô¤ì(€¥˜€¡¥¹½µ¥¹A…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•%¡Á…åµ•¹Ð°ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¤¤É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐ™¥•±‘Ì€ôÕ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡l¸¸¹‘¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ít¤ì(€½¹ÍÐ¡…ÍMÕÁÁ±¥•É1½½­ÕÀ€ô™¥•±‘Ì¹Í½µ” ¡™¥•±¤€ôøì(€€€½¹ÍÐÙ…±Õ”€ôÁ…åµ•¹Ðü¹m™¥•±‘tì(€€€¥˜€¡Ù…±Õ”€ôô¹Õ±°ñðÙ…±Õ”€ôôô€œœ¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐ™¥•±‘Q½­•¸€ô¹½Éµ…±¥é•‘¥•±‘Q½­•¸¡™¥•±¤ì(€€€¥˜€¡™¥•±‘Q½­•¸¹¥¹±Õ‘•Ì ‰Õå•ÉÍÕÁÁ±¥•Èœ¤¤É•ÑÕÉ¸™…±Í”ì(€€€É•ÑÕÉ¸™¥•±‘Q½­•¸¹¥¹±Õ‘•Ì ÍÕÁÁ±¥•Èœ¤ñð™¥•±‘Q½­•¸¹¥¹±Õ‘•Ì Ù•¹‘½Èœ¤ñð™¥•±‘Q½­•¸¹¥¹±Õ‘•Ì ÍÕÁÁ±¥•É¥¹Ù½¥”œ¤ì(€ô¤ì(€¥˜€¡¡…ÍMÕÁÁ±¥•É1½½­ÕÀ¤É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐÙ…±Õ•Q½­•¸€ô¹½Éµ…±¥é•‘¥•±‘Q½­•¸ (€€€™¥•±‘Ì(€€€€€€¹™¥±Ñ•È ¡™¥•±¤€ôøÁ…åµ•¹Ðü¹m™¥•±‘t€„ô¹Õ±°€˜˜Á…åµ•¹Ñm™¥•±‘t€„ôô€œœ¤(€€€€€€¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ñm™¥•±‘t¤(€€€€€€¹©½¥¸ œ€œ¤°(€€¤ì(€¥˜€ …Ù…±Õ•Q½­•¸¤É•ÑÕÉ¸™…±Í”ì(€½¹ÍÐÍÕÁÁ±¥•ÉM¥¹…±Ì€ôlÍÕÁÁ±¥•É¥¹Ù½¥”œ°€ÍÕÁÁ±¥•ÉÁ…åµ•¹Ðœ°€ÍÕÁÁ±¥•ÉÉ•™Õ¹œ°€Ù•¹‘½Èœ°€Á…å…‰±”œ°€…½Õ¹ÑÍÁ…å…‰±”œ°€½ÕÑ½¥¹œœ°€Á…åµ•¹ÑÑ½ÍÕÁÁ±¥•Èœ°€Ñ½ÍÕÁÁ±¥•Èœ°€™É½µÍÕÁÁ±¥•Èœ°€ÍÕÁÁ±¥•É…½Õ¹Ðœ°€ÍÕÁÁ±¥•ÉŒœ°€ÍÕÁÁ±¥•É¹…µ”tì(€½¹ÍÐ¡…ÍMÕÁÁ±¥•ÉM¥¹…°€ôÍÕÁÁ±¥•ÉM¥¹…±Ì¹Í½µ” ¡Í¥¹…°¤€ôøÙ…±Õ•Q½­•¸¹¥¹±Õ‘•Ì¡Í¥¹…°¤¤ì(€¥˜€ …¡…ÍMÕÁÁ±¥•ÉM¥¹…°¤É•ÑÕÉ¸™…±Í”ì(€½¹ÍÐµ¥á•‘	Õå•ÉMÕÁÁ±¥•É=¹±ä€ôÙ…±Õ•Q½­•¸¹¥¹±Õ‘•Ì ‰Õå•ÉÍÕÁÁ±¥•Èœ¤€˜˜€…lÍÕÁÁ±¥•É¥¹Ù½¥”œ°€ÍÕÁÁ±¥•ÉÁ…åµ•¹Ðœ°€ÍÕÁÁ±¥•ÉÉ•™Õ¹œ°€Á…åµ•¹ÑÑ½ÍÕÁÁ±¥•Èœ°€Á…å…‰±”œ°€Ù•¹‘½Èt¹Í½µ” ¡Í¥¹…°¤€ôøÙ…±Õ•Q½­•¸¹¥¹±Õ‘•Ì¡Í¥¹…°¤¤ì(€É•ÑÕÉ¸€…µ¥á•‘	Õå•ÉMÕÁÁ±¥•É=¹±äì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ1½½­Í	…¹­¡…É”¡Á…åµ•¹Ð°ìÉ•™•É•¹•¥•±‘Ì€ômt°‘¥É•Ñ¥½¹¥•±‘Ì€ômt°ÑåÁ•¥•±‘Ì€ômt°ÍÑ…ÑÕÍ¥•±‘Ì€ômtô€ôíô¤ì(€¥˜€¡Á…åµ•¹Ðü¹%€ôôô€„ÁM™ÔÀÀÀÀÁÍ8ÁŒœñðMÑÉ¥¹œ¡Á…åµ•¹Ðü¹%ñð€œœ¤¹ÍÑ…ÉÑÍ]¥Ñ  „ÁM™ÔÀÀÀÀÁÍ8ÁŒœ¤¤É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐ™¥•±‘Ì€ôÕ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡l¸¸¹É•™•É•¹•¥•±‘Ì°€¸¸¹‘¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ì°€9…µ”t¤ì(€½¹ÍÐÙ…±Õ•Q½­•¸€ô¹½Éµ…±¥é•‘¥•±‘Q½­•¸ (€€€™¥•±‘Ì(€€€€€€¹™¥±Ñ•È ¡™¥•±¤€ôøÁ…åµ•¹Ðü¹m™¥•±‘t€„ô¹Õ±°€˜˜Á…åµ•¹Ñm™¥•±‘t€„ôô€œœ¤(€€€€€€¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ñm™¥•±‘t¤(€€€€€€¹©½¥¸ œ€œ¤°(€€¤ì(€¥˜€ …Ù…±Õ•Q½­•¸¤É•ÑÕÉ¸™…±Í”ì(€É•ÑÕÉ¸l‰…¹­¡…É”œ°€‰…¹­¡…É•Ìœ°€‰…¹­™•”œ°€‰…¹­™••Ìœ°€É•µ¥ÑÑ…¹•¡…É”œ°€É•µ¥ÑÑ…¹•™•”œ°€ÑÉ…¹Í™•É¡…É”œ°€ÑÉ…¹Í™•É™•”t¹Í½µ” ¡Í¥¹…°¤€ôøÙ…±Õ•Q½­•¸¹¥¹±Õ‘•Ì¡Í¥¹…°¤¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ1½½­Í	Õå•ÉM¥‘”¡Á…åµ•¹Ð°ìÉ•™•É•¹•¥•±‘Ì€ômt°‘¥É•Ñ¥½¹¥•±‘Ì€ômt°ÑåÁ•¥•±‘Ì€ômt°ÍÑ…ÑÕÍ¥•±‘Ì€ômtô€ôíô¤ì(€½¹ÍÐ™¥•±‘Ì€ôÕ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡l¸¸¹É•™•É•¹•¥•±‘Ì°€¸¸¹‘¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ì°€9…µ”t¤ì(€½¹ÍÐÙ…±Õ•Q½­•¸€ô¹½Éµ…±¥é•‘¥•±‘Q½­•¸ (€€€™¥•±‘Ì(€€€€€€¹™¥±Ñ•È ¡™¥•±¤€ôøÁ…åµ•¹Ðü¹m™¥•±‘t€„ô¹Õ±°€˜˜Á…åµ•¹Ñm™¥•±‘t€„ôô€œœ¤(€€€€€€¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ñm™¥•±‘t¤(€€€€€€¹©½¥¸ œ€œ¤°(€€¤ì(€¥˜€ …Ù…±Õ•Q½­•¸¤É•ÑÕÉ¸™…±Í”ì(€É•ÑÕÉ¸l‰Õå•ÉÁ…åµ•¹Ðœ°€‰Õå•ÉÉ••¥ÁÐœ°€Á…åµ•¹Ñ™É½µ‰Õå•Èœ°€™É½µ‰Õå•Èœ°€ÕÍÑ½µ•ÉÁ…åµ•¹Ðœ°€ÕÍÑ½µ•ÉÉ••¥ÁÐœ°€É••¥Ù…‰±”œ°€…½Õ¹ÑÍÉ••¥Ù…‰±”t¹Í½µ” ¡Í¥¹…°¤€ôøÙ…±Õ•Q½­•¸¹¥¹±Õ‘•Ì¡Í¥¹…°¤¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ1½½­ÍMÑ•µA…å…‰±•…±Õ±…Ñ¥½¸¡Á…åµ•¹Ð°ì…µ½Õ¹Ð°Á…å…‰±•µ½Õ¹ÑÌ€ômt°É•™•É•¹•¥•±‘Ì€ômt°‘¥É•Ñ¥½¹¥•±‘Ì€ômt°ÑåÁ•¥•±‘Ì€ômt°ÍÑ…ÑÕÍ¥•±‘Ì€ômt°…±±½Ý	±…¹­M¥¹…°€ô™…±Í”ô€ôíô¤ì(€¥˜€¡…µ½Õ¹Ð€ôô¹Õ±°ñð…µ½Õ¹Ð€ðô€À¤É•ÑÕÉ¸™…±Í”ì(€½¹ÍÐµ…Ñ¡•ÍA…å…‰±•µ½Õ¹Ð€ôÁ…å…‰±•µ½Õ¹ÑÌ¹™¥±Ñ•È ¡Ù…±Õ”¤€ôøÙ…±Õ”€„ô¹Õ±°€˜˜9Õµ‰•È¹¥Í¥¹¥Ñ”¡9Õµ‰•È¡Ù…±Õ”¤¤€˜˜5…Ñ ¹…‰Ì¡9Õµ‰•È¡Ù…±Õ”¤¤€ø€À¤¹Í½µ” ¡Ù…±Õ”¤€ôø…µ½Õ¹Ñ9•…É±åÅÕ…°¡…µ½Õ¹Ð°Ù…±Õ”°€Ä¤¤ì(€¥˜€ …µ…Ñ¡•ÍA…å…‰±•µ½Õ¹Ð¤É•ÑÕÉ¸™…±Í”ì(€¥˜€ (€€€¥¹½µ¥¹A…åµ•¹Ñ1½½­Í	Õå•ÉM¥‘”¡Á…åµ•¹Ð°ì(€€€€€É•™•É•¹•¥•±‘Ì°(€€€€€‘¥É•Ñ¥½¹¥•±‘Ì°(€€€€€ÑåÁ•¥•±‘Ì°(€€€€€ÍÑ…ÑÕÍ¥•±‘Ì°(€€€ô¤(€€¤(€€€É•ÑÕÉ¸™…±Í”ì((€½¹ÍÐ™¥•±‘Ì€ôÕ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡l¸¸¹É•™•É•¹•¥•±‘Ì°€¸¸¹‘¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ì°€9…µ”t¤ì(€½¹ÍÐÙ…±Õ•Q½­•¸€ô¹½Éµ…±¥é•‘¥•±‘Q½­•¸ (€€€™¥•±‘Ì(€€€€€€¹™¥±Ñ•È ¡™¥•±¤€ôøÁ…åµ•¹Ðü¹m™¥•±‘t€„ô¹Õ±°€˜˜Á…åµ•¹Ñm™¥•±‘t€„ôô€œœ¤(€€€€€€¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ñm™¥•±‘t¤(€€€€€€¹©½¥¸ œ€œ¤°(€€¤ì(€¥˜€ …Ù…±Õ•Q½­•¸¤É•ÑÕÉ¸…±±½Ý	±…¹­M¥¹…°ì(€É•ÑÕÉ¸ÑÉÕ”ì)ô()™Õ¹Ñ¥½¸ÍÑ•µA…å…‰±•µ½Õ¹Ñ…¹‘¥‘…Ñ•Ì¡ìÍÑ•´€ôíô°±¥¹•%Ñ•µÌ€ômt°•áÑÉ…½ÍÑÌ€ômtô€ôíô¤ì(€½¹ÍÐÍÑ•µ!…Í•±¥Ù•Éä€ô€„…ÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œì(€½¹ÍÐ…Ñ¥Ù•1¥¹•%Ñ•µÌ€ô±¥¹•%Ñ•µÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø€…¥Ñ•´¹…¹•±±•‘}}Œ¤ì(€½¹ÍÐ…Ñ¥Ù•áÑÉ…½ÍÑÌ€ô•áÑÉ…½ÍÑÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø€…¥Ñ•´¹…¹•±±•‘}}Œ¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•Q½Ñ…°€ô¹Õµ•É¥Y…±Õ”¡ÍÑ•´¹Q½Ñ…±}%¹Ù½¥•‘}µ½Õ¹Ñ}É½µ}MÕÁÁ±¥•ÉÍ}}Œ¤€üü€Àì(€½¹ÍÐÍÕÁÁ±¥•É1¥¹•	ÕåQ½Ñ…°€ô…Ñ¥Ù•1¥¹•%Ñ•µÌ¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬±¥¹•	Õåµ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤°€À¤ì(€½¹ÍÐÕ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	ÕåQ½Ñ…°€ô…Ñ¥Ù•1¥¹•%Ñ•µÌ¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôø€¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ€üÍÕ´€èÍÕ´€¬±¥¹•	Õåµ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤¤°€À¤ì(€½¹ÍÐÍÕÁÁ±¥•ÉáÑÉ…	ÕåQ½Ñ…°€ô…Ñ¥Ù•áÑÉ…½ÍÑÌ¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬•áÑÉ…	Õåµ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤°€À¤ì(€½¹ÍÐÕ¹¥¹Ù½¥•‘MÕÁÁ±¥•ÉáÑÉ…	ÕåQ½Ñ…°€ô…Ñ¥Ù•áÑÉ…½ÍÑÌ¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôø€¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ€üÍÕ´€èÍÕ´€¬•áÑÉ…	Õåµ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤¤°€À¤ì(€½¹ÍÐ¡…ÍMÕÁÁ±¥•É%¹Ù½¥•1¥¹•Ì€ô…Ñ¥Ù•1¥¹•%Ñ•µÌ¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¤ì(€½¹ÍÐ…±Õ±…Ñ•‘MÕÁÁ±¥•É%¹Ù½¥”€ôÍÕÁÁ±¥•É%¹Ù½¥•Q½Ñ…°€¬€¡¡…ÍMÕÁÁ±¥•É%¹Ù½¥•1¥¹•Ì€üÕ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	ÕåQ½Ñ…°€èÍÕÁÁ±¥•É1¥¹•	ÕåQ½Ñ…°¤ì(€É•ÑÕÉ¸m…±Õ±…Ñ•‘MÕÁÁ±¥•É%¹Ù½¥”°…±Õ±…Ñ•‘MÕÁÁ±¥•É%¹Ù½¥”€¬ÍÕÁÁ±¥•ÉáÑÉ…	ÕåQ½Ñ…°°…±Õ±…Ñ•‘MÕÁÁ±¥•É%¹Ù½¥”€¬Õ¹¥¹Ù½¥•‘MÕÁÁ±¥•ÉáÑÉ…	ÕåQ½Ñ…°°ÍÕÁÁ±¥•É1¥¹•	ÕåQ½Ñ…°°Õ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	ÕåQ½Ñ…°°ÍÕÁÁ±¥•ÉáÑÉ…	ÕåQ½Ñ…°°Õ¹¥¹Ù½¥•‘MÕÁÁ±¥•ÉáÑÉ…	ÕåQ½Ñ…°°ÍÕÁÁ±¥•É1¥¹•	ÕåQ½Ñ…°€¬ÍÕÁÁ±¥•ÉáÑÉ…	ÕåQ½Ñ…°°Õ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	ÕåQ½Ñ…°€¬Õ¹¥¹Ù½¥•‘MÕÁÁ±¥•ÉáÑÉ…	ÕåQ½Ñ…°°ÍÕÁÁ±¥•É%¹Ù½¥•Q½Ñ…°°¹Õµ•É¥Y…±Õ”¡ÍÑ•´¹A…å…‰±•}	…±…¹•}}Œ¤°¹Õµ•É¥Y…±Õ”¡ÍÑ•´¹Q½Ñ…±}½ÍÑÍ}}Œ¤°¹Õµ•É¥Y…±Õ”¡ÍÑ•´¹Q½Ñ…±}½ÍÑ}}Œ¤°¹Õµ•É¥Y…±Õ”¡ÍÑ•´¹Q½Ñ…±}½ÍÑ}µ½Õ¹Ñ}}Œ¤°€¸¸¹…Ñ¥Ù•1¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø±¥¹•	Õåµ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤¤°€¸¸¹…Ñ¥Ù•áÑÉ…½ÍÑÌ¹µ…À ¡¥Ñ•´¤€ôø•áÑÉ…	Õåµ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤¥t¹™¥±Ñ•È ¡Ù…±Õ”¤€ôøÙ…±Õ”€„ô¹Õ±°€˜˜9Õµ‰•È¹¥Í¥¹¥Ñ”¡9Õµ‰•È¡Ù…±Õ”¤¤€˜˜5…Ñ ¹…‰Ì¡9Õµ‰•È¡Ù…±Õ”¤¤€ø€À¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑQåÁ•É½µ½¹Ñ•áÐ¡Á…åµ•¹Ð°ì…µ½Õ¹Ð°ÍÑ•´°ÍÕÁÁ±¥•É%¹Ù½¥”°ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì°‘¥É•Ñ¥½¹¥•±‘Ì°ÑåÁ•¥•±‘Ì°ÍÑ…ÑÕÍ¥•±‘Ìô¤ì(€½¹ÍÐÍÕÁÁ±¥•ÉM¥‘”€ô(€€€ÍÕÁÁ±¥•É%¹Ù½¥”ñð(€€€¥¹½µ¥¹A…åµ•¹Ñ1½½­ÍMÕÁÁ±¥•ÉM¥‘”¡Á…åµ•¹Ð°ì(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì°(€€€€€‘¥É•Ñ¥½¹¥•±‘Ì°(€€€€€ÑåÁ•¥•±‘Ì°(€€€€€ÍÑ…ÑÕÍ¥•±‘Ì°(€€€ô¤ì(€¥˜€¡ÍÕÁÁ±¥•ÉM¥‘”¤É•ÑÕÉ¸…µ½Õ¹Ð€„ô¹Õ±°€˜˜…µ½Õ¹Ð€ð€À€ü€MÕÁÁ±¥•ÈI•™Õ¹œ€è€MÕÁÁ±¥•ÈA…åµ•¹Ðœì(€¥˜€¡ÍÑ•´€˜˜€¡…µ½Õ¹Ð€ôô¹Õ±°ñð…µ½Õ¹Ð€øô€À¤¤É•ÑÕÉ¸€	Õå•ÈA…åµ•¹Ðœì(€É•ÑÕÉ¸€U¹µ…Ñ¡•œì)ô()™Õ¹Ñ¥½¸…µ½Õ¹Ñ9•…É±åÅÕ…°¡±•™Ð°É¥¡Ð°Ñ½±•É…¹”€ô€À¸ÀÔ¤ì(€½¹ÍÐ„€ô9Õµ‰•È¡±•™Ð¤ì(€½¹ÍÐˆ€ô9Õµ‰•È¡É¥¡Ð¤ì(€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡„¤ñð€…9Õµ‰•È¹¥Í¥¹¥Ñ”¡ˆ¤¤É•ÑÕÉ¸™…±Í”ì(€É•ÑÕÉ¸5…Ñ ¹…‰Ì¡5…Ñ ¹…‰Ì¡„¤€´5…Ñ ¹…‰Ì¡ˆ¤¤€ðôÑ½±•É…¹”ì)ô()™Õ¹Ñ¥½¸Á…åµ•¹ÑM•…É¡Q½­•¸¡Á…åµ•¹Ð°™¥•±‘Ì€ômt¤ì(€É•ÑÕÉ¸¹½Éµ…±¥é•‘¥•±‘Q½­•¸ (€€€Õ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡l¸¸¹™¥•±‘Ì°€9…µ”t¤(€€€€€€¹™¥±Ñ•È ¡™¥•±¤€ôøÁ…åµ•¹Ðü¹m™¥•±‘t€„ô¹Õ±°€˜˜Á…åµ•¹Ñm™¥•±‘t€„ôô€œœ¤(€€€€€€¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ñm™¥•±‘t¤(€€€€€€¹©½¥¸ œ€œ¤°(€€¤ì)ô()™Õ¹Ñ¥½¸…‘‘	É½­•É½µµ¥ÍÍ¥½¹É½ÕÀ¡É½ÕÁÍ	åMÑ•´°É½ÕÀ¤ì(€¥˜€ …É½ÕÀü¹ÍÑ•µ%ñð€…É½ÕÀ¹‰É½­•ÉQåÁ”ñð€…É½ÕÀ¹…µ½Õ¹Ð¤É•ÑÕÉ¸ì(€½¹ÍÐ­•ä€ômÉ½ÕÀ¹ÍÑ•µ%°É½ÕÀ¹‰É½­•ÉQåÁ”°É½ÕÀ¹‰É½­•É%ñðÉ½ÕÀ¹‰É½­•É9…µ”ñð€Õ¹­¹½Ý¸t¹©½¥¸ œèèœ¤ì(€¥˜€ …É½ÕÁÍ	åMÑ•µmÉ½ÕÀ¹ÍÑ•µ%‘t¤É½ÕÁÍ	åMÑ•µmÉ½ÕÀ¹ÍÑ•µ%‘t€ômtì(€½¹ÍÐ•á¥ÍÑ¥¹œ€ôÉ½ÕÁÍ	åMÑ•µmÉ½ÕÀ¹ÍÑ•µ%‘t¹™¥¹ ¡¥Ñ•´¤€ôø¥Ñ•´¹­•ä€ôôô­•ä¤ì(€¥˜€¡•á¥ÍÑ¥¹œ¤ì(€€€•á¥ÍÑ¥¹œ¹…µ½Õ¹Ð€¬ô9Õµ‰•È¡É½ÕÀ¹…µ½Õ¹Ðñð€À¤ì(€€€É•ÑÕÉ¸ì(€ô(€É½ÕÁÍ	åMÑ•µmÉ½ÕÀ¹ÍÑ•µ%‘t¹ÁÕÍ ¡ì(€€€­•ä°(€€€ÍÑ•µ%èÉ½ÕÀ¹ÍÑ•µ%°(€€€‰É½­•É%èÉ½ÕÀ¹‰É½­•É%ñð¹Õ±°°(€€€‰É½­•É9…µ”èÉ½ÕÀ¹‰É½­•É9…µ”ñðÉ½ÕÀ¹‰É½­•É%ñðÉ½ÕÀ¹‰É½­•ÉQåÁ”°(€€€‰É½­•ÉQåÁ”èÉ½ÕÀ¹‰É½­•ÉQåÁ”°(€€€Í¥‘”èÉ½ÕÀ¹Í¥‘”°(€€€…µ½Õ¹Ðè9Õµ‰•È¡É½ÕÀ¹…µ½Õ¹Ðñð€À¤°(€ô¤ì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘	É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÌ¡ìÍÑ•µ5…À€ôíô°±¥¹•%Ñ•µÌ€ômt°‰Õå•É	É½­•ÉÌ€ômt°…½Õ¹Ñ5…À€ôíôô€ôíô¤ì(€½¹ÍÐÉ½ÕÁÍ	åMÑ•´€ôíôì(€½¹ÍÐ‰Õå•É	É½­•ÉÍ	åMÑ•´€ôíôì(€™½È€¡½¹ÍÐ‰É½­•È½˜‰Õå•É	É½­•ÉÌ¤ì(€€€¥˜€ …‰É½­•È¹MQ5}}Œ¤½¹Ñ¥¹Õ”ì(€€€¥˜€ …‰Õå•É	É½­•ÉÍ	åMÑ•µm‰É½­•È¹MQ5}}t¤‰Õå•É	É½­•ÉÍ	åMÑ•µm‰É½­•È¹MQ5}}t€ômtì(€€€‰Õå•É	É½­•ÉÍ	åMÑ•µm‰É½­•È¹MQ5}}t¹ÁÕÍ ¡‰É½­•È¤ì(€ô((€™½È€¡½¹ÍÐ¥Ñ•´½˜±¥¹•%Ñ•µÌ¤ì(€€€¥˜€ …¥Ñ•´¹MQ5}}Œñð¥Ñ•´¹…¹•±±•‘}}Œ¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐÍÑ•´€ôÍÑ•µ5…Ám¥Ñ•´¹MQ5}}tì(€€€¥˜€ …ÍÑ•´¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐÅÑä€ô™¥¹…¹¥…±EÕ…¹Ñ¥Ñä¡¥Ñ•´°€„…ÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œ¤ì(€€€½¹ÍÐÍÕÁÁ±¥•Éµ½Õ¹Ð€ô‰É½­•Éµ½Õ¹Ð¡¥Ñ•´¹MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°ÅÑä¤ì(€€€¥˜€¡¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ€˜˜ÍÕÁÁ±¥•Éµ½Õ¹Ð€„ôô€À¤ì(€€€€€…‘‘	É½­•É½µµ¥ÍÍ¥½¹É½ÕÀ¡É½ÕÁÍ	åMÑ•´°ì(€€€€€€€ÍÑ•µ%è¥Ñ•´¹MQ5}}Œ°(€€€€€€€‰É½­•É%è¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ°(€€€€€€€‰É½­•É9…µ”è…½Õ¹Ñ5…Ám¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}tñð…½Õ¹Ñ5…ÁmMÑÉ¥¹œ¡¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ¤¹Í±¥” À°€ÄÔ¥tñð¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ°(€€€€€€€‰É½­•ÉQåÁ”è€MÕÁÁ±¥•È	É½­•Èœ°(€€€€€€€Í¥‘”è€ÍÕÁÁ±¥•Èœ°(€€€€€€€…µ½Õ¹ÐèÍÕÁÁ±¥•Éµ½Õ¹Ð°(€€€€€ô¤ì(€€€ô((€€€½¹ÍÐ‰Õå•É	É½­•É%€ô¥Ñ•´¹	Õå•ÉÍ}	É½­•É}}Œñð¥Ñ•´¹	Õå•É}	É½­•É}}Œì(€€€½¹ÍÐ¡…ÍMÕÁÁ±¥•É	É½­•ÉU¹¥Ð€ô9Õµ‰•È¡¥Ñ•´¹MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œñð€À¤€„ôô€Àì(€€€½¹ÍÐ‰Õå•ÉA•ÉU¹¥Ñµ½Õ¹Ð€ô‰É½­•Éµ½Õ¹Ð¡¥Ñ•´¹	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°ÅÑä¤ì(€€€½¹ÍÐ‰Õå•É1ÕµÁÍÕµµ½Õ¹Ð€ô9Õµ‰•È¡¥Ñ•´¹	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}1ÕµÁÍÕµ}}Œñð€À¤ì(€€€½¹ÍÐ‰Õå•Éµ½Õ¹Ð€ô‰Õå•É1ÕµÁÍÕµµ½Õ¹Ðñð‰Õå•ÉA•ÉU¹¥Ñµ½Õ¹Ðì(€€€¥˜€¡‰Õå•É	É½­•É%€˜˜‰Õå•Éµ½Õ¹Ð€„ôô€À¤ì(€€€€€…‘‘	É½­•É½µµ¥ÍÍ¥½¹É½ÕÀ¡É½ÕÁÍ	åMÑ•´°ì(€€€€€€€ÍÑ•µ%è¥Ñ•´¹MQ5}}Œ°(€€€€€€€‰É½­•É%è‰Õå•É	É½­•É%°(€€€€€€€‰É½­•É9…µ”è…½Õ¹Ñ5…Ám‰Õå•É	É½­•É%‘tñð…½Õ¹Ñ5…ÁmMÑÉ¥¹œ¡‰Õå•É	É½­•É%¤¹Í±¥” À°€ÄÔ¥tñð‰Õå•É	É½­•É%°(€€€€€€€‰É½­•ÉQåÁ”è€	Õå•È	É½­•Èœ°(€€€€€€€Í¥‘”è€‰Õå•Èœ°(€€€€€€€…µ½Õ¹Ðè‰Õå•Éµ½Õ¹Ð°(€€€€€ô¤ì(€€€ô((€€€½¹ÍÐÍ•½¹‘…Éåµ½Õ¹Ð€ô€…¡…ÍMÕÁÁ±¥•É	É½­•ÉU¹¥Ð€˜˜¥Ñ•´¹½µµ¥ÍÍ¥½¹}½ÍÑ}}Œ€„ô¹Õ±°€ü9Õµ‰•È¡¥Ñ•´¹½µµ¥ÍÍ¥½¹}½ÍÑ}}Œñð€À¤€´‰Õå•ÉA•ÉU¹¥Ñµ½Õ¹Ð€è€Àì(€€€½¹ÍÐÍ•½¹‘…Éå	É½­•ÉÌ€ô€¡‰Õå•É	É½­•ÉÍ	åMÑ•µm¥Ñ•´¹MQ5}}tñðmt¤¹™¥±Ñ•È ¡‰É½­•È¤€ôøì(€€€€€¥˜€ …‰É½­•È¹	Õå•É}	É½­•É}}Œ¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€¥˜€ …‰Õå•É	É½­•É%¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€É•ÑÕÉ¸MÑÉ¥¹œ¡‰É½­•È¹	Õå•É}	É½­•É}}Œ¤¹Í±¥” À°€ÄÔ¤€„ôôMÑÉ¥¹œ¡‰Õå•É	É½­•É%¤¹Í±¥” À°€ÄÔ¤ì(€€€ô¤ì(€€€¥˜€¡Í•½¹‘…Éåµ½Õ¹Ð€ø€À€˜˜Í•½¹‘…Éå	É½­•ÉÌ¹±•¹Ñ €ø€À¤ì(€€€€€™½È€¡½¹ÍÐ‰É½­•È½˜Í•½¹‘…Éå	É½­•ÉÌ¤ì(€€€€€€€…‘‘	É½­•É½µµ¥ÍÍ¥½¹É½ÕÀ¡É½ÕÁÍ	åMÑ•´°ì(€€€€€€€€€ÍÑ•µ%è¥Ñ•´¹MQ5}}Œ°(€€€€€€€€€‰É½­•É%è‰É½­•È¹	Õå•É}	É½­•É}}Œñð¹Õ±°°(€€€€€€€€€‰É½­•É9…µ”è…½Õ¹Ñ5…Ám‰É½­•È¹	Õå•É}	É½­•É}}tñð…½Õ¹Ñ5…ÁmMÑÉ¥¹œ¡‰É½­•È¹	Õå•É}	É½­•É}}Œñð€œœ¤¹Í±¥” À°€ÄÔ¥tñð‰É½­•È¹	Õå•É}	É½­•É}}Œñð€M•½¹‘…Éä	Õå•È	É½­•Èœ°(€€€€€€€€€‰É½­•ÉQåÁ”è€M•½¹‘…Éä	Õå•È	É½­•Èœ°(€€€€€€€€€Í¥‘”è€‰Õå•Èœ°(€€€€€€€€€…µ½Õ¹ÐèÍ•½¹‘…Éåµ½Õ¹Ð°(€€€€€€€ô¤ì(€€€€€ô(€€€ô(€ô(€É•ÑÕÉ¸É½ÕÁÍ	åMÑ•´ì)ô()™Õ¹Ñ¥½¸™¥¹‘	É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ñ5…Ñ ¡Á…åµ•¹Ð°…µ½Õ¹Ð°É½ÕÁÌ€ômt°Ñ•áÑ¥•±‘Ì€ômt¤ì(€¥˜€ …É½ÕÁÌ¹±•¹Ñ ñð…µ½Õ¹Ð€ôô¹Õ±°¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐ…µ½Õ¹Ñ5…Ñ¡•Ì€ôÉ½ÕÁÌ¹™¥±Ñ•È ¡É½ÕÀ¤€ôø…µ½Õ¹Ñ9•…É±åÅÕ…°¡…µ½Õ¹Ð°É½ÕÀ¹…µ½Õ¹Ð¤¤ì(€¥˜€ ……µ½Õ¹Ñ5…Ñ¡•Ì¹±•¹Ñ ¤É•ÑÕÉ¸¹Õ±°ì(€¥˜€¡…µ½Õ¹Ñ5…Ñ¡•Ì¹±•¹Ñ €ôôô€Ä¤É•ÑÕÉ¸…µ½Õ¹Ñ5…Ñ¡•ÍlÁtì(€½¹ÍÐÑ½­•¸€ôÁ…åµ•¹ÑM•…É¡Q½­•¸¡Á…åµ•¹Ð°Ñ•áÑ¥•±‘Ì¤ì(€¥˜€¡Ñ½­•¸¤ì(€€€½¹ÍÐÑ•áÑ5…Ñ €ô…µ½Õ¹Ñ5…Ñ¡•Ì¹™¥¹ ¡É½ÕÀ¤€ôø¹½Éµ…±¥é•‘¥•±‘Q½­•¸¡É½ÕÀ¹‰É½­•É9…µ”¤€˜˜Ñ½­•¸¹¥¹±Õ‘•Ì¡¹½Éµ…±¥é•‘¥•±‘Q½­•¸¡É½ÕÀ¹‰É½­•É9…µ”¤¤¤ì(€€€¥˜€¡Ñ•áÑ5…Ñ ¤É•ÑÕÉ¸Ñ•áÑ5…Ñ ì(€ô(€É•ÑÕÉ¸…µ½Õ¹Ñ5…Ñ¡•ÍlÁtì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑI•™•É•¹”¡Á…åµ•¹Ð°É•™•É•¹•¥•±‘Ì€ômt¤ì(€½¹ÍÐÙ…±Õ”€ôÉ•™•É•¹•¥•±‘Ì¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ñm™¥•±‘t¤¹™¥¹ ¡¥Ñ•´¤€ôø¥Ñ•´€„ô¹Õ±°€˜˜¥Ñ•´€„ôô€œœ¤ì(€É•ÑÕÉ¸Ù…±Õ”€ôô¹Õ±°€ü¹Õ±°€èMÑÉ¥¹œ¡Ù…±Õ”¤¹ÑÉ¥´ ¤ñð¹Õ±°ì)ô()™Õ¹Ñ¥½¸•¹•É…Ñ•‘A…åµ•¹Ñ9…µ”¡Ù…±Õ”¤ì(€½¹ÍÐÑ•áÐ€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …Ñ•áÐ¤É•ÑÕÉ¸ÑÉÕ”ì(€É•ÑÕÉ¸€½yÁ…ä üéµ•¹Ð¤ýlµ}qÍtýq¬½¤¹Ñ•ÍÐ¡Ñ•áÐ¤ñð€½yÁlµ}qÍtýq¬½¤¹Ñ•ÍÐ¡Ñ•áÐ¤ñð€½ym„µéuìÀ°Ñõq‘ìÔ±ô½¤¹Ñ•ÍÐ¡Ñ•áÐ¤ñð€½ym„µèÀ´åuìÄÔ°Äáô½¤¹Ñ•ÍÐ¡Ñ•áÐ¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ¥ÍÁ±…å9…µ”¡ìÁ…åµ•¹Ð°É•™•É•¹•¥•±‘Ì€ômt°ÍÑ•´°ÍÕÁÁ±¥•É%¹Ù½¥”°ÑåÁ”ô¤ì(€½¹ÍÐÉ•™•É•¹”€ô¥¹½µ¥¹A…åµ•¹ÑI•™•É•¹”¡Á…åµ•¹Ð°É•™•É•¹•¥•±‘Ì¤ì(€¥˜€¡É•™•É•¹”¤É•ÑÕÉ¸É•™•É•¹”ì((€½¹ÍÐÉ…Ý9…µ”€ôMÑÉ¥¹œ¡Á…åµ•¹Ðü¹9…µ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€¡É…Ý9…µ”€˜˜€…•¹•É…Ñ•‘A…åµ•¹Ñ9…µ”¡É…Ý9…µ”¤¤É•ÑÕÉ¸É…Ý9…µ”ì((€¥˜€¡ÍÕÁÁ±¥•É%¹Ù½¥”ü¹9…µ”¤ì(€€€É•ÑÕÉ¸€‘íÑåÁ”€ôôô€MÕÁÁ±¥•ÈI•™Õ¹œ€ü€MÕÁÁ±¥•ÈÉ•™Õ¹œ€è€MÕÁÁ±¥•ÈÁ…åµ•¹Ðô€´€‘íÍÕÁÁ±¥•É%¹Ù½¥”¹9…µ•õ€ì(€ô(€¥˜€¡ÍÑ•´¤ì(€€€É•ÑÕÉ¸€‘íÑåÁ”€ôôô€	Õå•ÈA…åµ•¹Ðœ€ü€	Õå•ÈÁ…åµ•¹Ðœ€è€A…åµ•¹Ðô€´€‘í™½Éµ…ÑMÑ•µ9…µ”¡ÍÑ•´¥õ€ì(€ô(€É•ÑÕÉ¸É…Ý9…µ”ñðÁ…åµ•¹Ðü¹%ñð€A…åµ•¹Ðœì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ	Õå•ÉÉ½ÕÀ¡ÍÑ•´¤ì(€½¹ÍÐ…½Õ¹Ð€ôÍÑ•´ü¹l½Õ¹Ñ}}Ètñðíôì(€É•ÑÕÉ¸…½Õ¹Ð¹É½ÕÁ}9…µ•}}Œñð…½Õ¹Ð¹A…É•¹Ðü¹9…µ”ñðÍÑ•´ü¹	Õå•É}9…µ•}}Œñð…½Õ¹Ð¹9…µ”ñðÍÑ•´ü¹	Õå•É}}Œñð¹Õ±°ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ	Õå•É9…µ”¡ÍÑ•´¤ì(€½¹ÍÐ…½Õ¹Ð€ôÍÑ•´ü¹l½Õ¹Ñ}}Ètñðíôì(€É•ÑÕÉ¸ÍÑ•´ü¹	Õå•É}9…µ•}}Œñð…½Õ¹Ð¹9…µ”ñðÍÑ•´ü¹	Õå•É}}Œñð¹Õ±°ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑMÑ…ÑÕÌ¡ìÑåÁ”°…µ½Õ¹Ð°ÍÑ•´°ÍÕÁÁ±¥•É%¹Ù½¥”°Ñ¡É•Í¡½±‘A½±¥äô¤ì(€¥˜€ …ÍÑ•´€˜˜€…ÍÕÁÁ±¥•É%¹Ù½¥”¤É•ÑÕÉ¸ì±…‰•°è€9••‘ÌÉ•Ù¥•Üœ°Ñ½¹”è€…µ‰•Èœôì(€¥˜€¡ÑåÁ”€ôôô€	…¹¬¡…É”œ¤É•ÑÕÉ¸ì±…‰•°è€	…¹¬¡…É”œ°Ñ½¹”è€…µ‰•Èœôì(€¥˜€¡ÑåÁ”€ôôô€MÕÁÁ±¥•ÈI•™Õ¹œ¤É•ÑÕÉ¸ì±…‰•°è€MÕÁÁ±¥•ÈÉ•™Õ¹œ°Ñ½¹”è€É••¸œôì(€¥˜€¡ÑåÁ”€ôôô€MÕÁÁ±¥•ÈA…åµ•¹Ðœ¤É•ÑÕÉ¸ì±…‰•°è€MÕÁÁ±¥•ÈÁ…åµ•¹Ðœ°Ñ½¹”è€Í±…Ñ”œôì(€½¹ÍÐÉ••¥Ù…‰±”€ô¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÑ•´ü¹I••¥Ù…‰±•}	…±…¹•}}Œ¤ì(€¥˜€¡É••¥Ù…‰±”€„ô¹Õ±°€˜˜É••¥Ù…‰±”€ð€À¤É•ÑÕÉ¸ì±…‰•°è€=Ù•ÉÁ…¥€¼…Ù…¥±…‰±”‰…±…¹”œ°Ñ½¹”è€ÁÕÉÁ±”œôì(€¥˜€¡É••¥Ù…‰±”€„ô¹Õ±°€˜˜Á…åµ•¹Ñ½±±•Ñ¥½¹	…±…¹•%ÍM•ÑÑ±•¡É••¥Ù…‰±”°Ñ¡É•Í¡½±‘A½±¥ä¤¤É•ÑÕÉ¸ì±…‰•°è€Õ±±äÁ…¥œ°Ñ½¹”è€É••¸œôì(€¥˜€¡…µ½Õ¹Ð€ôô¹Õ±°¤É•ÑÕÉ¸ì±…‰•°è€µ½Õ¹Ðµ¥ÍÍ¥¹œœ°Ñ½¹”è€…µ‰•Èœôì(€É•ÑÕÉ¸ì±…‰•°è€A…ÉÑ¥…±±äÁ…¥œ°Ñ½¹”è€‰±Õ”œôì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ	…¹­¡…É•Q…É•Ð¡¡…É”°É½ÝÌ€ômt¤ì(€¥˜€ …¡…É”ü¹ÍÑ•µ%ñð¡…É”¹ÑåÁ”€„ôô€	Õå•ÈA…åµ•¹Ðœ¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐ¡…É•µ½Õ¹Ð€ô5…Ñ ¹…‰Ì¡9Õµ‰•È¡¡…É”¹…µ½Õ¹Ðñð€À¤¤ì(€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡¡…É•µ½Õ¹Ð¤ñð¡…É•µ½Õ¹Ð€ðô€Àñð¡…É•µ½Õ¹Ð€ø€ÄÀÀÀ¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐ¡…É•…Ñ”€ô‘…Ñ•=¹±ä¡¡…É”¹Á…åµ•¹Ñ…Ñ”¤ì(€½¹ÍÐ¡…É•É•…Ñ•‘…Ñ”€ô‘…Ñ•=¹±ä¡¡…É”¹É•…Ñ•‘…Ñ”¤ì(€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôÉ½ÝÌ(€€€€¹™¥±Ñ•È ¡É½Ü¤€ôøì(€€€€€¥˜€ …É½ÜñðÉ½Ü¹¥€ôôô¡…É”¹¥ñðÉ½Ü¹Á…åµ•¹Ñ%€ôôô¡…É”¹Á…åµ•¹Ñ%¤É•ÑÕÉ¸™…±Í”ì(€€€€€¥˜€¡É½Ü¹ÑåÁ”€„ôô€	Õå•ÈA…åµ•¹ÐœñðÉ½Ü¹ÍÑ•µ%€„ôô¡…É”¹ÍÑ•µ%¤É•ÑÕÉ¸™…±Í”ì(€€€€€¥˜€¡¡…É”¹ÕÉÉ•¹ä€˜˜É½Ü¹ÕÉÉ•¹ä€˜˜¡…É”¹ÕÉÉ•¹ä€„ôôÉ½Ü¹ÕÉÉ•¹ä¤É•ÑÕÉ¸™…±Í”ì(€€€€€½¹ÍÐÑ…É•Ñµ½Õ¹Ð€ô5…Ñ ¹…‰Ì¡9Õµ‰•È¡É½Ü¹…µ½Õ¹Ðñð€À¤¤ì(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡Ñ…É•Ñµ½Õ¹Ð¤ñðÑ…É•Ñµ½Õ¹Ð€ðô¡…É•µ½Õ¹Ð¤É•ÑÕÉ¸™…±Í”ì(€€€€€¥˜€¡Ñ…É•Ñµ½Õ¹Ð€ð¡…É•µ½Õ¹Ð€¨€ÄÀ¤É•ÑÕÉ¸™…±Í”ì(€€€€€½¹ÍÐÑ…É•Ñ…Ñ”€ô‘…Ñ•=¹±ä¡É½Ü¹Á…åµ•¹Ñ…Ñ”¤ì(€€€€€½¹ÍÐÑ…É•ÑÉ•…Ñ•‘…Ñ”€ô‘…Ñ•=¹±ä¡É½Ü¹É•…Ñ•‘…Ñ”¤ì(€€€€€É•ÑÕÉ¸€¡¡…É•…Ñ”€˜˜Ñ…É•Ñ…Ñ”€˜˜¡…É•…Ñ”€ôôôÑ…É•Ñ…Ñ”¤ñð€¡¡…É•É•…Ñ•‘…Ñ”€˜˜Ñ…É•ÑÉ•…Ñ•‘…Ñ”€˜˜¡…É•É•…Ñ•‘…Ñ”€ôôôÑ…É•ÑÉ•…Ñ•‘…Ñ”¤ì(€€€ô¤(€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø5…Ñ ¹…‰Ì¡9Õµ‰•È¡ˆ¹…µ½Õ¹Ðñð€À¤¤€´5…Ñ ¹…‰Ì¡9Õµ‰•È¡„¹…µ½Õ¹Ðñð€À¤¤¤ì(€É•ÑÕÉ¸…¹‘¥‘…Ñ•ÍlÁtñð¹Õ±°ì)ô()™Õ¹Ñ¥½¸…ÑÑ…¡	…¹­¡…É•Q½A…åµ•¹Ð¡Ñ…É•Ð°¡…É”¤ì(€¥˜€ …Ñ…É•Ðñð€…¡…É”¤É•ÑÕÉ¸ì(€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Ñ…É•Ð¹‰…¹­¡…É•Ì¤¤Ñ…É•Ð¹‰…¹­¡…É•Ì€ômtì(€Ñ…É•Ð¹‰…¹­¡…É•Ì¹ÁÕÍ ¡ì(€€€¥è¡…É”¹¥°(€€€Á…åµ•¹Ñ%è¡…É”¹Á…åµ•¹Ñ%°(€€€Á…åµ•¹Ñ…Ñ”è¡…É”¹Á…åµ•¹Ñ…Ñ”°(€€€…µ½Õ¹Ðè5…Ñ ¹…‰Ì¡9Õµ‰•È¡¡…É”¹…µ½Õ¹Ðñð€À¤¤°(€€€ÕÉÉ•¹äè¡…É”¹ÕÉÉ•¹ä°(€€€É•™•É•¹”è¡…É”¹É•™•É•¹”°(€€€Á…åµ•¹Ñ9…µ”è¡…É”¹Á…åµ•¹Ñ¥ÍÁ±…å9…µ”ñð¡…É”¹Á…åµ•¹Ñ9…µ”ñð¡…É”¹Í…±•Í™½É•A…åµ•¹Ñ9…µ”ñð¡…É”¹Á…åµ•¹Ñ%°(€ô¤ì(€Ñ…É•Ð¹‰…¹­¡…É•Q½Ñ…°€ô€¡Ñ…É•Ð¹‰…¹­¡…É•Q½Ñ…°ñð€À¤€¬5…Ñ ¹…‰Ì¡9Õµ‰•È¡¡…É”¹…µ½Õ¹Ðñð€À¤¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑI•½É‘QåÁ•Q½­•¸¡Á…åµ•¹Ð¤ì(€É•ÑÕÉ¸¹½Éµ…±¥é•‘¥•±‘Q½­•¸¡mÁ…åµ•¹Ðü¹I•½É‘QåÁ•%°Á…åµ•¹Ðü¹I•½É‘QåÁ”ü¹•Ù•±½Á•É9…µ”°Á…åµ•¹Ðü¹I•½É‘QåÁ”ü¹9…µ•t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€œ¤¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%ÍI•µ¥ÑÑ…¹•I•½É¡Á…åµ•¹Ð°™¥•±‘Ì€ômt¤ì(€½¹ÍÐÑ½­•¸€ô¥¹½µ¥¹A…åµ•¹ÑI•½É‘QåÁ•Q½­•¸¡Á…åµ•¹Ð¤ì(€¥˜€¡Ñ½­•¸¹¥¹±Õ‘•Ì É•µ¥ÑÑ…¹”œ¤¤É•ÑÕÉ¸ÑÉÕ”ì(€É•ÑÕÉ¸Õ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡™¥•±‘Ì¤¹Í½µ” ¡™¥•±¤€ôøì(€€€½¹ÍÐÙ…±Õ•Q½­•¸€ô¹½Éµ…±¥é•‘¥•±‘Q½­•¸¡Á…åµ•¹Ðü¹m™¥•±‘t¤ì(€€€É•ÑÕÉ¸Ù…±Õ•Q½­•¸¹¥¹±Õ‘•Ì É••¥Ù…‰±•É•µ¥ÑÑ…¹”œ¤ñðÙ…±Õ•Q½­•¸¹¥¹±Õ‘•Ì É•µ¥ÑÑ…¹•É••¥Ù…‰±”œ¤ñðÙ…±Õ•Q½­•¸¹¥¹±Õ‘•Ì Á…å…‰±•É•µ¥ÑÑ…¹”œ¤ñðÙ…±Õ•Q½­•¸¹¥¹±Õ‘•Ì É•µ¥ÑÑ…¹•Á…å…‰±”œ¤ì(€ô¤ì)ô()½¹ÍÐ¥¹½µ¥¹A…åµ•¹Ñ%ÍI••¥Ù…‰±•I•µ¥ÑÑ…¹”€ô¥¹½µ¥¹A…åµ•¹Ñ%ÍI•µ¥ÑÑ…¹•I•½Éì()™Õ¹Ñ¥½¸ÍÕÁÁ±¥•É%¹Ù½¥•A…ÉÑå9…µ”¡¥¹Ù½¥”°ÍÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥ÁÌ€ômt¤ì(€É•ÑÕÉ¸¥¹Ù½¥”ü¹MÕÁÁ±¥•É}9…µ•}}Œñð¥¹Ù½¥”ü¹lMÕÁÁ±¥•É}}Ètü¹9…µ”ñð¥¹Ù½¥”ü¹láÁ•Ñ•‘}MÕÁÁ±¥•É}}Ètü¹9…µ”ñð¥¹Ù½¥”ü¹lMÕ‰ÍÑ¥ÑÕÑ•}MÕÁÁ±¥•É}}Ètü¹9…µ”ñðÍÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥ÁÌ¹µ…À ¡É•±…Ñ¥½¹Í¡¥À¤€ôø¥¹Ù½¥”ü¹mÉ•±…Ñ¥½¹Í¡¥Átü¹9…µ”¤¹™¥¹¡	½½±•…¸¤ñð¹Õ±°ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹	Õå•É¥…%¹Ù½¥•Ì¡ìÑ¡É•Í¡½±‘MÑ…Ñ”°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°ô€ôíô¤ì(€½¹ÍÐ‘•ÍÉ¥‰”€ô…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì(€€€½‰©•Ñ9…µ”è€ÍÑ•µ}}Œœ°(€ô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤ì(€½¹ÍÐ™¥•±‘Ì€ô‘•ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐ™¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡™¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€¥˜€ …™¥•±‘9…µ•Ì¹¡…Ì A…åµ•¹Ñ}Q•Éµ}}Œœ¤¤É•ÑÕÉ¸mtì((€½¹ÍÐ…½Õ¹Ñ•ÍÉ¥‰”€ô™¥•±‘9…µ•Ì¹¡…Ì ½Õ¹Ñ}}Œœ¤(€€€€ü…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€½Õ¹Ðœô¤¹…Ñ   ¤€ôø€¡ì(€€€€€€€™¥•±‘Ìèmt°(€€€€€ô¤¤(€€€€èì™¥•±‘Ìèmtôì(€½¹ÍÐ…½Õ¹Ñ¥•±‘9…µ•Ì€ô¹•ÜM•Ð ¡…½Õ¹Ñ•ÍÉ¥‰”¹™¥•±‘Ìñðmt¤¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐ¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¸€ô…Ý…¥Ð¥¹Ñ•É½™™¥•MÑ•µ•ÍÍ½¹‘¥Ñ¥½¸¡…•ÍÍ½¹Ñ•áÐ°™¥•±‘9…µ•Ì°…½Õ¹Ñ¥•±‘9…µ•Ì¤ì(€½¹ÍÐÍ•±•Ñ¥•±‘Ì€ôl%œ°€9…µ”œ°€¸¸¹Í•±•Ñ•‘¥•±‘Ì¡™¥•±‘9…µ•Ì°l-•åMÑ•µ}}Œœ°€	Õå•É}9…µ•}}Œœ°€	Õå•É}}Œœ°€½Õ¹Ñ}}Œœ°€A…åµ•¹Ñ}Q•Éµ}}Œœ°€Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œœ°€I••¥Ù…‰±•}	…±…¹•}}Œœ°€A…åµ•¹Ñ}…Ñ•}}Œœ°€•±¥Ù•Éå}…Ñ•}}Œœ°€áÁ•Ñ•‘}•±¥Ù•Éå}…Ñ•}}Œœ°€ÕÉÉ•¹å%Í½½‘”t¥tì(€¥˜€¡™¥•±‘9…µ•Ì¹¡…Ì Y•ÍÍ•±}}Œœ¤¤Í•±•Ñ¥•±‘Ì¹ÁÕÍ  Y•ÍÍ•±}}È¹9…µ”œ¤ì(€¥˜€¡™¥•±‘9…µ•Ì¹¡…Ì A½ÉÑ}}Œœ¤¤Í•±•Ñ¥•±‘Ì¹ÁÕÍ  A½ÉÑ}}È¹9…µ”œ¤ì(€¥˜€¡™¥•±‘9…µ•Ì¹¡…Ì ½Õ¹Ñ}}Œœ¤¤ì(€€€Í•±•Ñ¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹9…µ”œ¤ì(€€€¥˜€¡…½Õ¹Ñ¥•±‘9…µ•Ì¹¡…Ì É½ÕÁ}9…µ•}}Œœ¤¤Í•±•Ñ¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹É½ÕÁ}9…µ•}}Œœ¤ì(€€€¥˜€¡…½Õ¹Ñ¥•±‘9…µ•Ì¹¡…Ì A…É•¹Ñ%œ¤¤Í•±•Ñ¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹A…É•¹Ð¹9…µ”œ¤ì(€ô((€½¹ÍÐÝ¡•É•A…ÉÑÌ€ôl‰A…åµ•¹Ñ}Q•Éµ}}Œ1%-€œ•%”œ‰tì(€¥˜€¡™¥•±‘9…µ•Ì¹¡…Ì A…åµ•¹Ñ}…Ñ•}}Œœ¤¤Ý¡•É•A…ÉÑÌ¹ÁÕÍ  A…åµ•¹Ñ}…Ñ•}}Œ€ô¹Õ±°œ¤ì(€¥˜€¡™¥•±‘9…µ•Ì¹¡…Ì •±¥Ù•Éå}…Ñ•}}Œœ¤¤Ý¡•É•A…ÉÑÌ¹ÁÕÍ  œ¡•±¥Ù•Éå}…Ñ•}}Œ€ô¹Õ±°=H•±¥Ù•Éå}…Ñ•}}Œ€øô€ÈÀÈØ´ÀÄ´ÀÄ¤œ¤ì(€¥˜€¡¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¸¤Ý¡•É•A…ÉÑÌ¹ÁÕÍ ¡¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¸¤ì(€½¹ÍÐ½É‘•É	ä€ô™¥•±‘9…µ•Ì¹¡…Ì •±¥Ù•Éå}…Ñ•}}Œœ¤€ü€•±¥Ù•Éå}…Ñ•}}ŒM9U11L1MP°É•…Ñ•‘…Ñ”Mœ€è€É•…Ñ•‘…Ñ”Mœì((€½¹ÍÐÍÑ•µÌ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ (€€€€(€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡Í•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€I=4ÍÑ•µ}}Œ(€€€]!I€‘íÝ¡•É•A…ÉÑÌ¹©½¥¸ œ9€œ¥ô(€€€=IH	d€‘í½É‘•É	åô(€€€1%5%P€ÄÀÀÀ(€€°(€€€ì±¥µ¥Ðè€ÄÀÀÀ°Í½™Ñ…¥°èÑÉÕ”ô°(€€¤ì(€½¹ÍÐÍÑ•µ%‘Ì€ôÍÑ•µÌ¹µ…À ¡ÍÑ•´¤€ôøÍÑ•´¹%¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€¥˜€ …ÍÑ•µ%‘Ì¹±•¹Ñ ¤É•ÑÕÉ¸mtì((€½¹ÍÐÑÉ…‘•É	åMÑ•´€ôíôì(€½¹ÍÐm¹½µ¥¹…Ñ¥½¹ÉÉ…åÌ°±¥¹•%Ñ•µÉÉ…åÌ°•áÑÉ…½ÍÑÉÉ…åÍt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Í½Å°è€(€€€€€€€M1P%°9…µ”°MQ5}}Œ°	Õå•É}MÕÁÁ±¥•É}QÉ…‘•É}}Œ(€€€€€€€I=49½µ¥¹…Ñ¥½¹}}Œ(€€€€€€€]!IMQ5}}Œ%8€ ‘í¥¹1¥ÍÑô¤9	Õå•É}MÕÁÁ±¥•É}QÉ…‘•É}}Œ€„ô¹Õ±°(€€€€€€€=IH	dÉ•…Ñ•‘…Ñ”M(€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€°(€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€ôì(€€€€€ô¤°(€€€€¤°(€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Í½Å°è€(€€€€€€€M1PMQ5}}Œ°Q½Ñ…±}AÉ¥•}}Œ°…¹•±±•‘}}Œ°EÕ…¹Ñ¥Ñå}}Œ°EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œ°(€€€€€€€€€€€€€€EÕ…¹Ñ¥Ñå}5…á}}Œ°EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œ°%Í}EÕ…¹Ñ¥Ñå}I…¹•}}Œ°(€€€€€€€€€€€€€€AÉ¥•}A•É}U¹¥Ñ}}Œ°U¹¥Ñ}M•±±}Ñ}}Œ°=™™•É}1¥¹•}%Ñ•µ}}È¹U¹¥ÑAÉ¥”(€€€€€€€I=4MQ5}1¥¹•}%Ñ•µ}}Œ(€€€€€€€]!IMQ5}}Œ%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€°(€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€ôì(€€€€€ô¤°(€€€€¤°(€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Í½Å°è€(€€€€€€€M1PMQ5}}Œ°1¥¹•}Q½Ñ…±}}Œ°…¹•±±•‘}}Œ°EÕ…¹Ñ¥Ñå}}Œ°EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œ°(€€€€€€€€€€€€€€EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œ°EÕ…¹Ñ¥Ñå}I…¹•}5…á}}Œ°%Í}EÕ…¹Ñ¥Ñå}I…¹•}}Œ°U¹¥Ñ}AÉ¥•}}Œ(€€€€€€€I=4MQ5}áÑÉ…}½ÍÑ}}Œ(€€€€€€€]!IMQ5}}Œ%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€°(€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€ôì(€€€€€ô¤°(€€€€¤°(€t¤ì((€™½È€¡½¹ÍÐ¹½µ¥¹…Ñ¥½¸½˜¹½µ¥¹…Ñ¥½¹ÉÉ…åÌ¹™±…Ð ¤¤ì(€€€¥˜€ …¹½µ¥¹…Ñ¥½¸¹MQ5}}Œñð€…¹½µ¥¹…Ñ¥½¸¹	Õå•É}MÕÁÁ±¥•É}QÉ…‘•É}}Œ¤½¹Ñ¥¹Õ”ì(€€€¥˜€ …ÑÉ…‘•É	åMÑ•µm¹½µ¥¹…Ñ¥½¸¹MQ5}}t¤ÑÉ…‘•É	åMÑ•µm¹½µ¥¹…Ñ¥½¸¹MQ5}}t€ôì‰Õå•Èèmt°…±°èmtôì(€€€¥˜€ …ÑÉ…‘•É	åMÑ•µm¹½µ¥¹…Ñ¥½¸¹MQ5}}t¹…±°¹¥¹±Õ‘•Ì¡¹½µ¥¹…Ñ¥½¸¹	Õå•É}MÕÁÁ±¥•É}QÉ…‘•É}}Œ¤¤ì(€€€€€ÑÉ…‘•É	åMÑ•µm¹½µ¥¹…Ñ¥½¸¹MQ5}}t¹…±°¹ÁÕÍ ¡¹½µ¥¹…Ñ¥½¸¹	Õå•É}MÕÁÁ±¥•É}QÉ…‘•É}}Œ¤ì(€€€ô(€€€¥˜€¡MÑÉ¥¹œ¡¹½µ¥¹…Ñ¥½¸¹9…µ”ñð€œœ¤¹ÍÑ…ÉÑÍ]¥Ñ  ½¹™¥Éµ…Ñ¥½¸Ñ¼€œ¤€˜˜€…ÑÉ…‘•É	åMÑ•µm¹½µ¥¹…Ñ¥½¸¹MQ5}}t¹‰Õå•È¹¥¹±Õ‘•Ì¡¹½µ¥¹…Ñ¥½¸¹	Õå•É}MÕÁÁ±¥•É}QÉ…‘•É}}Œ¤¤ì(€€€€€ÑÉ…‘•É	åMÑ•µm¹½µ¥¹…Ñ¥½¸¹MQ5}}t¹‰Õå•È¹ÁÕÍ ¡¹½µ¥¹…Ñ¥½¸¹	Õå•É}MÕÁÁ±¥•É}QÉ…‘•É}}Œ¤ì(€€€ô(€ô((€½¹ÍÐ…±Õ±…Ñ•‘	åMÑ•´€ôíôì(€™½È€¡½¹ÍÐ¥Ñ•´½˜±¥¹•%Ñ•µÉÉ…åÌ¹™±…Ð ¤¤ì(€€€¥˜€ …¥Ñ•´¹MQ5}}Œñð¥Ñ•´¹…¹•±±•‘}}Œ¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐÍÑ•´€ôÍÑ•µÌ¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹%€ôôô¥Ñ•´¹MQ5}}Œ¤ì(€€€…±Õ±…Ñ•‘	åMÑ•µm¥Ñ•´¹MQ5}}t€ô€¡…±Õ±…Ñ•‘	åMÑ•µm¥Ñ•´¹MQ5}}tñð€À¤€¬±¥¹•M•±±µ½Õ¹Ð¡¥Ñ•´°€„…ÍÑ•´ü¹•±¥Ù•Éå}…Ñ•}}Œ¤ì(€ô(€™½È€¡½¹ÍÐ¥Ñ•´½˜•áÑÉ…½ÍÑÉÉ…åÌ¹™±…Ð ¤¤ì(€€€¥˜€ …¥Ñ•´¹MQ5}}Œñð¥Ñ•´¹…¹•±±•‘}}Œ¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐÍÑ•´€ôÍÑ•µÌ¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹%€ôôô¥Ñ•´¹MQ5}}Œ¤ì(€€€…±Õ±…Ñ•‘	åMÑ•µm¥Ñ•´¹MQ5}}t€ô€¡…±Õ±…Ñ•‘	åMÑ•µm¥Ñ•´¹MQ5}}tñð€À¤€¬•áÑÉ…M•±±µ½Õ¹Ð¡¥Ñ•´°€„…ÍÑ•´ü¹•±¥Ù•Éå}…Ñ•}}Œ¤ì(€ô((€É•ÑÕÉ¸ÍÑ•µÌ¹™¥±Ñ•È ¡ÍÑ•´¤€ôøì(€€€¥˜€¡ÍÑ•´¹I••¥Ù…‰±•}	…±…¹•}}Œ€ôô¹Õ±°¤É•ÑÕÉ¸ÑÉÕ”ì(€€€É•ÑÕÉ¸€…Á…åµ•¹Ñ½±±•Ñ¥½¹	…±…¹•%ÍM•ÑÑ±• (€€€€€ÍÑ•´¹I••¥Ù…‰±•}	…±…¹•}}Œ°(€€€€€Á…åµ•¹Ñ½±±•Ñ¥½¹Q¡É•Í¡½±‘A½±¥ä¡Ñ¡É•Í¡½±‘MÑ…Ñ”°ÍÑ•´¹ÕÉÉ•¹å%Í½½‘”¤°(€€€€¤ì(€ô¤¹µ…À ¡ÍÑ•´¤€ôøì(€€€½¹ÍÐ…½Õ¹Ð€ôÍÑ•µl½Õ¹Ñ}}Ètñðíôì(€€€½¹ÍÐÑÉ…‘•É%¹™¼€ôÑÉ…‘•É	åMÑ•µmÍÑ•´¹%‘tñðíôì(€€€½¹ÍÐ…±Õ±…Ñ•‘µ½Õ¹Ð€ô…±Õ±…Ñ•‘	åMÑ•µmÍÑ•´¹%‘t€ø€À€ü…±Õ±…Ñ•‘	åMÑ•µmÍÑ•´¹%‘t€è¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÑ•´¹Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œ¤ì(€€€É•ÑÕÉ¸ì(€€€€€¥èÍÑ•´¹%°(€€€€€ÍÑ•µ%èÍÑ•´¹%°(€€€€€ÍÑ•µ9…µ”è™½Éµ…ÑMÑ•µ9…µ”¡ÍÑ•´¤°(€€€€€­•åMÑ•´èÍÑ•´¹-•åMÑ•µ}}Œñð¹Õ±°°(€€€€€‰Õå•É9…µ”è¥¹½µ¥¹A…åµ•¹Ñ	Õå•É9…µ”¡ÍÑ•´¤°(€€€€€‰Õå•ÉÉ½ÕÁ9…µ”è…½Õ¹Ð¹É½ÕÁ}9…µ•}}Œñð…½Õ¹Ð¹A…É•¹Ðü¹9…µ”ñð¥¹½µ¥¹A…åµ•¹Ñ	Õå•É9…µ”¡ÍÑ•´¤°(€€€€€‰Õå•ÉQÉ…‘•Èè€¡ÑÉ…‘•É%¹™¼¹‰Õå•Èü¹±•¹Ñ €üÑÉ…‘•É%¹™¼¹‰Õå•È€èÑÉ…‘•É%¹™¼¹…±°ñðmt¤¹©½¥¸ œ°€œ¤ñð¹Õ±°°(€€€€€Á…åµ•¹ÑQ•ÉµÌèÍÑ•´¹A…åµ•¹Ñ}Q•Éµ}}Œñð¹Õ±°°(€€€€€…±Õ±…Ñ•‘µ½Õ¹Ð°(€€€€€É••¥Ù…‰±•	…±…¹”è¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÑ•´¹I••¥Ù…‰±•}	…±…¹•}}Œ¤°(€€€€€ÕÉÉ•¹äèÍÑ•´¹ÕÉÉ•¹å%Í½½‘”ñð¹Õ±°°(€€€€€‘•±¥Ù•Éå…Ñ”èÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œñð¹Õ±°°(€€€ôì(€ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑÍ1¥ÍÑM¹…ÁÍ¡½Ð¡‰½‘ä°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐÍ•ÑÑ¥¹Ì€ô‰½‘ä¹}Í•ÑÑ¥¹Í=Ù•ÉÉ¥‘”ñð€¡…Ý…¥Ð±½…‘%¹½µ¥¹A…åµ•¹ÑM•ÑÑ¥¹Ì ¤¤ì(€½¹ÍÐÑ½‘…ä€ô‘…Ñ•=¹±ä¡¹•Ü…Ñ” ¤¤ì(€½¹ÍÐ‘…Ñ•É½´€ô‘…Ñ•=¹±ä¡‰½‘ä¹‘…Ñ•É½´ñð‰½‘ä¹‘…Ñ•}™É½´ñðÑ½‘…ä¤ì(€½¹ÍÐ‘…Ñ•Q¼€ô‘…Ñ•=¹±ä¡‰½‘ä¹‘…Ñ•Q¼ñð‰½‘ä¹‘…Ñ•}Ñ¼ñðÑ½‘…ä¤ì(€½¹ÍÐ±¥µ¥Ð€ô5…Ñ ¹µ…à ÄÀÀ°5…Ñ ¹µ¥¸¡9Õµ‰•È¡‰½‘ä¹±¥µ¥Ð¤ñð€ÔÀÀÀ°€ÄÀÀÀÀ¤¤ì((€½¹ÍÐÁ…åµ•¹Ñ•ÍÉ¥‰”€ô…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì(€€€½‰©•Ñ9…µ”è€A…åµ•¹Ñ}}Œœ°(€ô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤ì(€½¹ÍÐÁ…åµ•¹Ñ¥•±‘Ì€ôÁ…åµ•¹Ñ•ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐÁ…åµ•¹Ñ¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡Á…åµ•¹Ñ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐÁ…åµ•¹Ñ¥•±‘	å9…µ”€ô=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡Á…åµ•¹Ñ¥•±‘Ì¹µ…À ¡™¥•±¤€ôøm™¥•±¹¹…µ”°™¥•±‘t¤¤ì(€¥˜€ …Á…åµ•¹Ñ¥•±‘9…µ•Ì¹Í¥é”¤(€€€É•ÑÕÉ¸ì(€€€€€É½ÝÌèmt°(€€€€€…Ù…¥±…‰±•	…±…¹•Ìèmt°(€€€€€ÍÕµµ…Éäèíô°(€€€€€Í•ÑÑ¥¹Ì°(€€€€€Í¡•µ…]…É¹¥¹ÌèlA…åµ•¹Ñ}}Œ¥Ì¹½ÐÅÕ•Éå…‰±”¸t°(€€€ôì((€½¹ÍÐ‘…Ñ•¥•±€ô™¥ÉÍÑÙ…¥±…‰±•¥•±¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°l…Ñ•}}Œœ°€A…åµ•¹Ñ}…Ñ•}}Œœ°€I••¥Ù•‘}…Ñ•}}Œœ°€A…¥‘}…Ñ•}}Œœ°€É•…Ñ•‘…Ñ”t¤ì(€½¹ÍÐ…µ½Õ¹Ñ¥•±€ô™¥ÉÍÑÙ…¥±…‰±•¥•±¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°lµ½Õ¹Ñ}}Œœ°€A…åµ•¹Ñ}µ½Õ¹Ñ}}Œœ°€A…¥‘}µ½Õ¹Ñ}}Œœ°€I••¥Ù•‘}µ½Õ¹Ñ}}Œœ°€Q½Ñ…±}µ½Õ¹Ñ}}Œœ°€µ½Õ¹Ñ}A…¥‘}}Œœ°€A…åµ•¹Ñ}Y…±Õ•}}Œœ°€ÑÕ…±}µ½Õ¹Ñ}}Œt¤ì(€½¹ÍÐÉ•™•É•¹•¥•±‘Ì€ô¥¹½µ¥¹A…åµ•¹ÑI•™•É•¹•¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì¤ì(€½¹ÍÐÍÑ…ÑÕÍ¥•±‘Ì€ôÍ•±•Ñ•‘¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°lMÑ…ÑÕÍ}}Œœ°€A…åµ•¹Ñ}MÑ…ÑÕÍ}}Œt¤ì(€½¹ÍÐÑåÁ•¥•±‘Ì€ôÍ•±•Ñ•‘¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°lQåÁ•}}Œœ°€A…åµ•¹Ñ}QåÁ•}}Œt¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì€ô¥¹½µ¥¹A…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì¤ì(€½¹ÍÐ‘¥É•Ñ¥½¹¥•±‘Ì€ô¥¹½µ¥¹A…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì¤ì(€½¹ÍÐÁ…åµ•¹ÑM•±•Ñ¥•±‘Ì€ôl%œ°€¸¸¹Í•±•Ñ•‘¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°l9…µ”œ°€I•½É‘QåÁ•%œ°€É•…Ñ•‘…Ñ”œ°€1…ÍÑ5½‘¥™¥•‘…Ñ”œ°€MQ5}}Œœ°€ÕÉÉ•¹å%Í½½‘”œ°€ÕÉÉ•¹å}}Œt¤°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì I•½É‘QåÁ•%œ¤€ü€I•½É‘QåÁ”¹9…µ”œ€è¹Õ±°°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì I•½É‘QåÁ•%œ¤€ü€I•½É‘QåÁ”¹•Ù•±½Á•É9…µ”œ€è¹Õ±°°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì°‘…Ñ•¥•±°…µ½Õ¹Ñ¥•±°€¸¸¹É•™•É•¹•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹‘¥É•Ñ¥½¹¥•±‘Ít¹™¥±Ñ•È¡	½½±•…¸¤ì((€½¹ÍÐ™¥±Ñ•É…Ñ•¥•±€ôÁ…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì É•…Ñ•‘…Ñ”œ¤€ü€É•…Ñ•‘…Ñ”œ€è‘…Ñ•¥•±ì(€½¹ÍÐ™¥±Ñ•É…Ñ•QåÁ”€ôÁ…åµ•¹Ñ¥•±‘	å9…µ•m™¥±Ñ•É…Ñ•¥•±‘tü¹ÑåÁ”ñð¹Õ±°ì(€½¹ÍÐ™¥±Ñ•É…Ñ•Y…±Õ”€ô€¡¥Í½…Ñ”°•¹‘=™…ä€ô™…±Í”¤€ôø€¡™¥±Ñ•É…Ñ•¥•±€ôôô€É•…Ñ•‘…Ñ”œ€üÍ½Å±!½¹-½¹…Ñ•Q¥µ•Y…±Õ”¡¥Í½…Ñ”°•¹‘=™…ä¤€èÍ½Å±…Ñ•Y…±Õ”¡™¥±Ñ•É…Ñ•¥•±°™¥±Ñ•É…Ñ•QåÁ”°¥Í½…Ñ”°•¹‘=™…ä¤¤ì(€½¹ÍÐÝ¡•É•A…ÉÑÌ€ômtì(€¥˜€¡™¥±Ñ•É…Ñ•¥•±€˜˜‘…Ñ•É½´¤Ý¡•É•A…ÉÑÌ¹ÁÕÍ ¡€‘í™¥±Ñ•É…Ñ•¥•±‘ô€øô€‘í™¥±Ñ•É…Ñ•Y…±Õ”¡‘…Ñ•É½´°™…±Í”¥õ€¤ì(€¥˜€¡™¥±Ñ•É…Ñ•¥•±€˜˜‘…Ñ•Q¼¤Ý¡•É•A…ÉÑÌ¹ÁÕÍ ¡€‘í™¥±Ñ•É…Ñ•¥•±‘ô€ðô€‘í™¥±Ñ•É…Ñ•Y…±Õ”¡‘…Ñ•Q¼°ÑÉÕ”¥õ€¤ì(€½¹ÍÐ½É‘•É	ä€ô™¥±Ñ•É…Ñ•¥•±€ü€‘í™¥±Ñ•É…Ñ•¥•±‘ôM9U11L1MP‘í™¥±Ñ•É…Ñ•¥•±€„ôô€É•…Ñ•‘…Ñ”œ€ü€œ°É•…Ñ•‘…Ñ”Mœ€è€œõ€€è€É•…Ñ•‘…Ñ”Mœì(€½¹ÍÐÁ…åµ•¹ÑÌ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ (€€€€(€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡Á…åµ•¹ÑM•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€I=4A…åµ•¹Ñ}}Œ(€€€€‘íÝ¡•É•A…ÉÑÌ¹±•¹Ñ €ü]!I€‘íÝ¡•É•A…ÉÑÌ¹©½¥¸ œ9€œ¥õ€€è€œô(€€€=IH	d€‘í½É‘•É	åô(€€€1%5%P€‘í±¥µ¥Ñô(€€°(€€€ì±¥µ¥Ð°Í½™Ñ…¥°èÑÉÕ”ô°(€€¤ì((€½¹ÍÐ•±¥¥‰±•A…åµ•¹ÑÌ€ôÁ…åµ•¹ÑÌ¹™¥±Ñ•È ¡Á…åµ•¹Ð¤€ôø€…¥¹½µ¥¹A…åµ•¹Ñ%ÍI••¥Ù…‰±•I•µ¥ÑÑ…¹”¡Á…åµ•¹Ð°l¸¸¹É•™•É•¹•¥•±‘Ì°€¸¸¹‘¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ít¤¤ì(€½¹ÍÐ‘¥É•ÑMÑ•µ%‘Ì€ô•±¥¥‰±•A…åµ•¹ÑÌ¹µ…À ¡Á…åµ•¹Ð¤€ôøÁ…åµ•¹Ð¹MQ5}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì€ô•±¥¥‰±•A…åµ•¹ÑÌ¹µ…À ¡Á…åµ•¹Ð¤€ôø¥¹½µ¥¹A…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•%¡Á…åµ•¹Ð°ÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì¤¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥••ÍÉ¥‰”€ôÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì¹±•¹Ñ €ü…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€MÕÁÁ±¥•É}%¹Ù½¥•}}Œœô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤€èì™¥•±‘Ìèmtôì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì€ôÍÕÁÁ±¥•É%¹Ù½¥••ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘	å9…µ”€ô=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¹µ…À ¡™¥•±¤€ôøm™¥•±¹¹…µ”°™¥•±‘t¤¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±€ô™¥ÉÍÑÙ…¥±…‰±•¥•±¡ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì°lA…å…‰±•}	…±…¹•}}Œœ°€	…±…¹•}}Œœ°€ÑÕ…±}	…±…¹•}}Œœ°€=ÕÑÍÑ…¹‘¥¹}	…±…¹•}}Œt¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ñ¥•±€ô™¥ÉÍÑÙ…¥±…‰±•¥•±¡ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì°l%¹Ù½¥•}µ½Õ¹Ñ}}Œœ°€…±Õ±…Ñ•‘}µ½Õ¹Ñ}}Œœ°€µ½Õ¹Ñ}}Œœ°€Q½Ñ…±}µ½Õ¹Ñ}}Œt¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É¥•±‘Ì€ôÍ•±•Ñ•‘¥•±‘Ì¡ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì°lMÕÁÁ±¥•É}}Œœ°€áÁ•Ñ•‘}MÕÁÁ±¥•É}}Œœ°€MÕ‰ÍÑ¥ÑÕÑ•}MÕÁÁ±¥•É}}Œt¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥ÁÌ€ôÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É¥•±‘Ì¹µ…À ¡™¥•±¤€ôøÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘	å9…µ•m™¥•±‘tü¹É•±…Ñ¥½¹Í¡¥Á9…µ”¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•5…À€ôíôì(€¥˜€¡ÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì¹±•¹Ñ €˜˜ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì¹Í¥é”¤ì(€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•M•±•Ñ¥•±‘Ì€ôl%œ°€9…µ”œ°€¸¸¹Í•±•Ñ•‘¥•±‘Ì¡ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì°lMQ5}}Œœ°€MÕÁÁ±¥•É}9…µ•}}Œt¤°ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ñ¥•±°ÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É¥•±‘Ì°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥ÁÌ¹µ…À ¡É•±…Ñ¥½¹Í¡¥À¤€ôø€‘íÉ•±…Ñ¥½¹Í¡¥Áô¹9…µ•€¥t¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€½¹ÍÐ¥¹Ù½¥•¡Õ¹­Ì€ô…Ý…¥Ð½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€¡Õ¹­%‘Ì¡l¸¸¹¹•ÜM•Ð¡ÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì¥t¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Í½Å°è€(€€€€€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡ÍÕÁÁ±¥•É%¹Ù½¥•M•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€€€€€I=4MÕÁÁ±¥•É}%¹Ù½¥•}}Œ(€€€€€€€]!I%%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€°(€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€ôì(€€€€€ô¤°(€€€€¤ì(€€€™½È€¡½¹ÍÐ¥¹Ù½¥”½˜¥¹Ù½¥•¡Õ¹­Ì¹™±…Ð ¤¤ÍÕÁÁ±¥•É%¹Ù½¥•5…Ám¥¹Ù½¥”¹%‘t€ô¥¹Ù½¥”ì(€ô((€½¹ÍÐÍÑ•µ%‘Ì€ôl(€€€€¸¸¹¹•ÜM•Ð¡l(€€€€€€¸¸¹‘¥É•ÑMÑ•µ%‘Ì°(€€€€€€¸¸¹=‰©•Ð¹Ù…±Õ•Ì¡ÍÕÁÁ±¥•É%¹Ù½¥•5…À¤(€€€€€€€€¹µ…À ¡¥¹Ù½¥”¤€ôø¥¹Ù½¥”¹MQ5}}Œ¤(€€€€€€€€¹™¥±Ñ•È¡	½½±•…¸¤°(€€€t¤°(€tì(€½¹ÍÐÍÑ•µ•ÍÉ¥‰”€ôÍÑ•µ%‘Ì¹±•¹Ñ (€€€€ü…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€ÍÑ•µ}}Œœô¤¹…Ñ   ¤€ôø€¡ì(€€€€€€€™¥•±‘Ìèmt°(€€€€€ô¤¤(€€€€èì™¥•±‘Ìèmtôì(€½¹ÍÐÍÑ•µ¥•±‘Ì€ôÍÑ•µ•ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐÍÑ•µ¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡ÍÑ•µ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐ…½Õ¹Ñ•ÍÉ¥‰”€ôÍÑ•µ¥•±‘9…µ•Ì¹¡…Ì ½Õ¹Ñ}}Œœ¤(€€€€ü…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€½Õ¹Ðœô¤¹…Ñ   ¤€ôø€¡ì(€€€€€€€™¥•±‘Ìèmt°(€€€€€ô¤¤(€€€€èì™¥•±‘Ìèmtôì(€½¹ÍÐ…½Õ¹Ñ¥•±‘9…µ•Ì€ô¹•ÜM•Ð ¡…½Õ¹Ñ•ÍÉ¥‰”¹™¥•±‘Ìñðmt¤¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐ¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¸€ô…Ý…¥Ð¥¹Ñ•É½™™¥•MÑ•µ•ÍÍ½¹‘¥Ñ¥½¸¡…•ÍÍ½¹Ñ•áÐ°ÍÑ•µ¥•±‘9…µ•Ì°…½Õ¹Ñ¥•±‘9…µ•Ì¤ì(€½¹ÍÐÍÑ•µM•±•Ñ¥•±‘Ì€ôl%œ°€9…µ”œ°€¸¸¹Í•±•Ñ•‘¥•±‘Ì¡ÍÑ•µ¥•±‘9…µ•Ì°l-•åMÑ•µ}}Œœ°€	Õå•É}9…µ•}}Œœ°€	Õå•É}}Œœ°€½Õ¹Ñ}}Œœ°€Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œœ°€Q½Ñ…±}%¹Ù½¥•‘}µ½Õ¹Ñ}É½µ}MÕÁÁ±¥•ÉÍ}}Œœ°€I••¥Ù…‰±•}	…±…¹•}}Œœ°€A…å…‰±•}	…±…¹•}}Œœ°€Q½Ñ…±}½ÍÑÍ}}Œœ°€Q½Ñ…±}½ÍÑ}}Œœ°€Q½Ñ…±}½ÍÑ}µ½Õ¹Ñ}}Œœ°€A…åµ•¹Ñ}…Ñ•}}Œœ°€A…åµ•¹Ñ}Q•Éµ}}Œœ°€%¹Ù½¥•}Õ•}…Ñ•}}Œœ°€	Õå•É}A…å}Q•Éµ}…Ñ•}}Œœ°€Õ•}…Ñ•}}Œœ°€•±¥Ù•Éå}…Ñ•}}Œœ°€•±¥Ù•Éå}…Ñ•}=É}áÁ•Ñ•‘}}Œœ°€áÁ•Ñ•‘}•±¥Ù•Éå}…Ñ•}}Œœ°€ÕÉÉ•¹å%Í½½‘”t¥tì(€¥˜€¡ÍÑ•µ¥•±‘9…µ•Ì¹¡…Ì Y•ÍÍ•±}}Œœ¤¤ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  Y•ÍÍ•±}}È¹9…µ”œ¤ì(€¥˜€¡ÍÑ•µ¥•±‘9…µ•Ì¹¡…Ì A½ÉÑ}}Œœ¤¤ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  A½ÉÑ}}È¹9…µ”œ¤ì(€¥˜€¡ÍÑ•µ¥•±‘9…µ•Ì¹¡…Ì ½Õ¹Ñ}}Œœ¤¤ì(€€€ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹9…µ”œ¤ì(€€€¥˜€¡…½Õ¹Ñ¥•±‘9…µ•Ì¹¡…Ì É½ÕÁ}9…µ•}}Œœ¤¤ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹É½ÕÁ}9…µ•}}Œœ¤ì(€€€¥˜€¡…½Õ¹Ñ¥•±‘9…µ•Ì¹¡…Ì A…É•¹Ñ%œ¤¤ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹A…É•¹Ð¹9…µ”œ¤ì(€ô(€½¹ÍÐÍÑ•µ5…À€ôíôì(€¥˜€¡ÍÑ•µ%‘Ì¹±•¹Ñ €˜˜ÍÑ•µ¥•±‘9…µ•Ì¹Í¥é”¤ì(€€€½¹ÍÐÍÑ•µ¡Õ¹­Ì€ô…Ý…¥Ð½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€½¹ÍÐÍÑ•µ]¡•É”€ô½µ‰¥¹•]¡•É•½¹‘¥Ñ¥½¹Ì¡m%%8€ ‘í¥¹1¥ÍÑô¥€°¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¹t¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Í½Å°è€(€€€€€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡ÍÑ•µM•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€€€€€I=4ÍÑ•µ}}Œ(€€€€€€€]!I€‘íÍÑ•µ]¡•É•ô(€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€°(€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€ôì(€€€€€ô¤°(€€€€¤ì(€€€™½È€¡½¹ÍÐÍÑ•´½˜ÍÑ•µ¡Õ¹­Ì¹™±…Ð ¤¤ÍÑ•µ5…ÁmÍÑ•´¹%‘t€ôÍÑ•´ì(€ô(€±•Ð‰É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÍ	åMÑ•´€ôíôì(€±•Ð±¥¹•%Ñ•µÍ	åMÑ•´€ôíôì(€±•Ð•áÑÉ…½ÍÑÍ	åMÑ•´€ôíôì(€¥˜€¡ÍÑ•µ%‘Ì¹±•¹Ñ ¤ì(€€€½¹ÍÐm±¥¹•%Ñ•µ¡Õ¹­Ì°‰Õå•É	É½­•É¡Õ¹­Ì°•áÑÉ…½ÍÑ¡Õ¹­Ít€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€Í½Å°è€(€€€€€€€€€M1P%°MQ5}}Œ°…¹•±±•‘}}Œ°EÕ…¹Ñ¥Ñå}}Œ°EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œ°(€€€€€€€€€€€€€€€€EÕ…¹Ñ¥Ñå}5…á}}Œ°EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œ°%Í}EÕ…¹Ñ¥Ñå}I…¹•}}Œ°(€€€€€€€€€€€€€€€€½ÍÑ}A•É}U¹¥Ñ}}Œ°U¹¥Ñ}	Õå}Ñ}}Œ°U¹¥Ñ}½ÍÑ}}Œ°Q½Ñ…±}½ÍÑ}}Œ°(€€€€€€€€€€€€€€€€MÕÁÁ±¥•É}	É½­•É}}Œ°MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°(€€€€€€€€€€€€€€€€	Õå•ÉÍ}	É½­•É}}Œ°	Õå•É}	É½­•É}}Œ°	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°(€€€€€€€€€€€€€€€€	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}1ÕµÁÍÕµ}}Œ°½µµ¥ÍÍ¥½¹}½ÍÑ}}Œ°MÕÁÁ±¥•É}%¹Ù½¥•}}Œ°(€€€€€€€€€€€€€€€€=™™•É}1¥¹•}%Ñ•µ}}È¹MÕÁÁ±¥•É}U¹¥Ñ}AÉ¥•}}Œ(€€€€€€€€€I=4MQ5}1¥¹•}%Ñ•µ}}Œ(€€€€€€€€€]!IMQ5}}Œ%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€€€°(€€€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€ôì(€€€€€€€ô¤°(€€€€€€¤°(€€€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€Í½Å°è€(€€€€€€€€€M1P%°MQ5}}Œ°	Õå•É}	É½­•É}}Œ(€€€€€€€€€I=4MQ5}	Õå•É}	É½­•É}}Œ(€€€€€€€€€]!IMQ5}}Œ%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€€€°(€€€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€ôì(€€€€€€€ô¤°(€€€€€€¤°(€€€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€Í½Å°è€(€€€€€€€€€M1P%°MQ5}}Œ°…¹•±±•‘}}Œ°EÕ…¹Ñ¥Ñå}}Œ°EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œ°(€€€€€€€€€€€€€€€€EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œ°EÕ…¹Ñ¥Ñå}I…¹•}5…á}}Œ°%Í}EÕ…¹Ñ¥Ñå}I…¹•}}Œ°(€€€€€€€€€€€€€€€€U¹¥Ñ}½ÍÑ}}Œ°1¥¹•}Q½Ñ…±}	Õå}}Œ°MÕÁÁ±¥•É}%¹Ù½¥•}}Œ(€€€€€€€€€I=4MQ5}áÑÉ…}½ÍÑ}}Œ(€€€€€€€€€]!IMQ5}}Œ%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€€€°(€€€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€ôì(€€€€€€€ô¤°(€€€€€€¤°(€€€t¤ì(€€€½¹ÍÐ‰É½­•É1¥¹•%Ñ•µÌ€ô±¥¹•%Ñ•µ¡Õ¹­Ì¹™±…Ð ¤ì(€€€½¹ÍÐ‰É½­•ÉI½ÝÌ€ô‰Õå•É	É½­•É¡Õ¹­Ì¹™±…Ð ¤ì(€€€½¹ÍÐ•áÑÉ…½ÍÑI½ÝÌ€ô•áÑÉ…½ÍÑ¡Õ¹­Ì¹™±…Ð ¤ì(€€€±¥¹•%Ñ•µÍ	åMÑ•´€ô‰É½­•É1¥¹•%Ñ•µÌ¹É•‘Õ” ¡…Œ°¥Ñ•´¤€ôøì(€€€€€¥˜€ …¥Ñ•´¹MQ5}}Œ¤É•ÑÕÉ¸…Œì(€€€€€¥˜€ ……m¥Ñ•´¹MQ5}}t¤…m¥Ñ•´¹MQ5}}t€ômtì(€€€€€…m¥Ñ•´¹MQ5}}t¹ÁÕÍ ¡¥Ñ•´¤ì(€€€€€É•ÑÕÉ¸…Œì(€€€ô°íô¤ì(€€€•áÑÉ…½ÍÑÍ	åMÑ•´€ô•áÑÉ…½ÍÑI½ÝÌ¹É•‘Õ” ¡…Œ°¥Ñ•´¤€ôøì(€€€€€¥˜€ …¥Ñ•´¹MQ5}}Œ¤É•ÑÕÉ¸…Œì(€€€€€¥˜€ ……m¥Ñ•´¹MQ5}}t¤…m¥Ñ•´¹MQ5}}t€ômtì(€€€€€…m¥Ñ•´¹MQ5}}t¹ÁÕÍ ¡¥Ñ•´¤ì(€€€€€É•ÑÕÉ¸…Œì(€€€ô°íô¤ì(€€€½¹ÍÐ‰É½­•É½Õ¹Ñ%‘Ì€ôl¸¸¹¹•ÜM•Ð¡l¸¸¹‰É½­•É1¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤°€¸¸¹‰É½­•É1¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹	Õå•ÉÍ}	É½­•É}}Œñð¥Ñ•´¹	Õå•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤°€¸¸¹‰É½­•ÉI½ÝÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹	Õå•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¥t¥tì(€€€½¹ÍÐ…½Õ¹Ñ5…À€ô…Ý…¥Ð¹…µ•Í	å%‘Ì ½Õ¹Ðœ°‰É½­•É½Õ¹Ñ%‘Ì¤ì(€€€™½È€¡½¹ÍÐm¥°¹…µ•t½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡…½Õ¹Ñ5…À¤¤…½Õ¹Ñ5…ÁmMÑÉ¥¹œ¡¥¤¹Í±¥” À°€ÄÔ¥t€ô¹…µ”ì(€€€‰É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÍ	åMÑ•´€ô‰Õ¥±‘	É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÌ¡ì(€€€€€ÍÑ•µ5…À°(€€€€€±¥¹•%Ñ•µÌè‰É½­•É1¥¹•%Ñ•µÌ°(€€€€€‰Õå•É	É½­•ÉÌè‰É½­•ÉI½ÝÌ°(€€€€€…½Õ¹Ñ5…À°(€€€ô¤ì(€ô((€½¹ÍÐ…Ù…¥±…‰±•MÑ•µ-•åÌ€ô¹•ÜM•Ð ¤ì(€½¹ÍÐ…Ù…¥±…‰±•	…±…¹•Í	åÉ½ÕÀ€ôíôì(€½¹ÍÐ…±±I½ÝÌ€ô•±¥¥‰±•A…åµ•¹ÑÌ(€€€€¹µ…À ¡Á…åµ•¹Ð¤€ôøì(€€€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•%€ô¥¹½µ¥¹A…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•%¡Á…åµ•¹Ð°ÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì¤ì(€€€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥”€ôÍÕÁÁ±¥•É%¹Ù½¥•%€üÍÕÁÁ±¥•É%¹Ù½¥•5…ÁmÍÕÁÁ±¥•É%¹Ù½¥•%‘tñð¹Õ±°€è¹Õ±°ì(€€€€€½¹ÍÐÍÑ•µ%€ôÁ…åµ•¹Ð¹MQ5}}ŒñðÍÕÁÁ±¥•É%¹Ù½¥”ü¹MQ5}}Œñð¹Õ±°ì(€€€€€½¹ÍÐÍÑ•´€ôÍÑ•µ%€üÍÑ•µ5…ÁmÍÑ•µ%‘tñð¹Õ±°€è¹Õ±°ì(€€€€€¥˜€¡ÍÑ•µ%€˜˜€…ÍÑ•´¤É•ÑÕÉ¸¹Õ±°ì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô…µ½Õ¹Ñ¥•±€ü¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡Á…åµ•¹Ñm…µ½Õ¹Ñ¥•±‘t¤€è¹Õ±°ì(€€€€€½¹ÍÐ‰É½­•É½µµ¥ÍÍ¥½¹5…Ñ €ôÍÑ•´ü¹%€ü™¥¹‘	É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ñ5…Ñ ¡Á…åµ•¹Ð°…µ½Õ¹Ð°‰É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÍ	åMÑ•µmÍÑ•´¹%‘tñðmt°l¸¸¹É•™•É•¹•¥•±‘Ì°€¸¸¹‘¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ít¤€è¹Õ±°ì(€€€€€½¹ÍÐ‰…¹­¡…É”€ô¥¹½µ¥¹A…åµ•¹Ñ1½½­Í	…¹­¡…É”¡Á…åµ•¹Ð°ì(€€€€€€€É•™•É•¹•¥•±‘Ì°(€€€€€€€‘¥É•Ñ¥½¹¥•±‘Ì°(€€€€€€€ÑåÁ•¥•±‘Ì°(€€€€€€€ÍÑ…ÑÕÍ¥•±‘Ì°(€€€€€ô¤ì(€€€€€½¹ÍÐÁ…å…‰±•…±Õ±…Ñ¥½¸€ôÍÑ•´ü¹%(€€€€€€€€ü¥¹½µ¥¹A…åµ•¹Ñ1½½­ÍMÑ•µA…å…‰±•…±Õ±…Ñ¥½¸¡Á…åµ•¹Ð°ì(€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€Á…å…‰±•µ½Õ¹ÑÌèÍÑ•µA…å…‰±•µ½Õ¹Ñ…¹‘¥‘…Ñ•Ì¡ì(€€€€€€€€€€€€€ÍÑ•´°(€€€€€€€€€€€€€±¥¹•%Ñ•µÌè±¥¹•%Ñ•µÍ	åMÑ•µmÍÑ•´¹%‘tñðmt°(€€€€€€€€€€€€€•áÑÉ…½ÍÑÌè•áÑÉ…½ÍÑÍ	åMÑ•µmÍÑ•´¹%‘tñðmt°(€€€€€€€€€€€ô¤°(€€€€€€€€€€€É•™•É•¹•¥•±‘Ì°(€€€€€€€€€€€‘¥É•Ñ¥½¹¥•±‘Ì°(€€€€€€€€€€€ÑåÁ•¥•±‘Ì°(€€€€€€€€€€€ÍÑ…ÑÕÍ¥•±‘Ì°(€€€€€€€€€€€…±±½Ý	±…¹­M¥¹…°è€…ÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œ°(€€€€€€€€€ô¤(€€€€€€€€è™…±Í”ì(€€€€€½¹ÍÐÑåÁ”€ô‰É½­•É½µµ¥ÍÍ¥½¹5…Ñ (€€€€€€€€ü€	É½­•È½µµ¥ÍÍ¥½¸œ(€€€€€€€€è‰…¹­¡…É”(€€€€€€€€€€ü€	…¹¬¡…É”œ(€€€€€€€€€€èÁ…å…‰±•…±Õ±…Ñ¥½¸(€€€€€€€€€€€€ü€MÕÁÁ±¥•ÈA…åµ•¹Ðœ(€€€€€€€€€€€€è¥¹½µ¥¹A…åµ•¹ÑQåÁ•É½µ½¹Ñ•áÐ¡Á…åµ•¹Ð°ì(€€€€€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€€€€€ÍÑ•´°(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥”°(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘ÌèÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì°(€€€€€€€€€€€€€€€‘¥É•Ñ¥½¹¥•±‘Ì°(€€€€€€€€€€€€€€€ÑåÁ•¥•±‘Ì°(€€€€€€€€€€€€€€€ÍÑ…ÑÕÍ¥•±‘Ì°(€€€€€€€€€€€€€ô¤ì(€€€€€±•Ð¥¹½µ¥¹µ½Õ¹Ð€ô…µ½Õ¹Ðì(€€€€€¥˜€¡ÑåÁ”¹ÍÑ…ÉÑÍ]¥Ñ  MÕÁÁ±¥•Èœ¤¤ì(€€€€€€€¥¹½µ¥¹µ½Õ¹Ð€ôÑåÁ”€ôôô€MÕÁÁ±¥•ÈI•™Õ¹œ€˜˜…µ½Õ¹Ð€„ô¹Õ±°€ü5…Ñ ¹…‰Ì¡…µ½Õ¹Ð¤€è…µ½Õ¹Ðì(€€€€€ô(€€€€€½¹ÍÐÁ…åµ•¹Ñ…Ñ”€ô‘…Ñ•¥•±€üÁ…åµ•¹Ñm‘…Ñ•¥•±‘tñð¹Õ±°€èÁ…åµ•¹Ð¹É•…Ñ•‘…Ñ”ñð¹Õ±°ì(€€€€€½¹ÍÐ‰Õå•É%¹Ù½¥•Õ•…Ñ”€ôÑåÁ”€ôôô€	Õå•ÈA…åµ•¹Ðœ€˜˜ÍÑ•´€ü…±Õ±…Ñ•‘	Õå•ÉA…åQ•Éµ…Ñ”¡ÍÑ•´¤ñðÍÑ•´¹%¹Ù½¥•}Õ•}…Ñ•}}ŒñðÍÑ•´¹Õ•}…Ñ•}}ŒñðÍÑ•´¹	Õå•É}A…å}Q•Éµ}…Ñ•}}Œñð¹Õ±°€è¹Õ±°ì(€€€€€½¹ÍÐ‘•±…å…åÌ€ôÑåÁ”€ôôô€	Õå•ÈA…åµ•¹Ðœ€˜˜‰Õå•É%¹Ù½¥•Õ•…Ñ”€˜˜Á…åµ•¹Ñ…Ñ”€ü‘…åÍ	•ÑÝ••¸¡‰Õå•É%¹Ù½¥•Õ•…Ñ”°‘…Ñ•=¹±ä¡Á…åµ•¹Ñ…Ñ”¤¤€è¹Õ±°ì(€€€€€½¹ÍÐÍÑ…ÑÕÌ€ô¥¹½µ¥¹A…åµ•¹ÑMÑ…ÑÕÌ¡ì(€€€€€€€ÑåÁ”°(€€€€€€€…µ½Õ¹Ð°(€€€€€€€ÍÑ•´°(€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥”°(€€€€€€€Ñ¡É•Í¡½±‘A½±¥äèÁ…åµ•¹Ñ½±±•Ñ¥½¹Q¡É•Í¡½±‘A½±¥ä¡Í•ÑÑ¥¹Ì°ÍÑ•´ü¹ÕÉÉ•¹å%Í½½‘”ñðÁ…åµ•¹Ð¹ÕÉÉ•¹å%Í½½‘”ñðÁ…åµ•¹Ð¹ÕÉÉ•¹å}}Œ¤°(€€€€€ô¤ì(€€€€€½¹ÍÐÉ••¥Ù…‰±”€ô¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÑ•´ü¹I••¥Ù…‰±•}	…±…¹•}}Œ¤ì(€€€€€½¹ÍÐ‰Õå•É9…µ”€ô¥¹½µ¥¹A…åµ•¹Ñ	Õå•É9…µ”¡ÍÑ•´¤ì(€€€€€½¹ÍÐ‰Õå•ÉÉ½ÕÁ9…µ”€ô¥¹½µ¥¹A…åµ•¹Ñ	Õå•ÉÉ½ÕÀ¡ÍÑ•´¤ì(€€€€€½¹ÍÐÁ…ÉÑå9…µ”€ôÑåÁ”¹ÍÑ…ÉÑÍ]¥Ñ  MÕÁÁ±¥•Èœ¤€üÍÕÁÁ±¥•É%¹Ù½¥•A…ÉÑå9…µ”¡ÍÕÁÁ±¥•É%¹Ù½¥”°ÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥ÁÌ¤€è‰Õå•É9…µ”ì(€€€€€¥˜€¡ÍÑ•´ü¹%€˜˜É••¥Ù…‰±”€„ô¹Õ±°€˜˜É••¥Ù…‰±”€ð€À¤ì(€€€€€€€½¹ÍÐ­•ä€ôÍÑ•´¹%ì(€€€€€€€¥˜€ ……Ù…¥±…‰±•MÑ•µ-•åÌ¹¡…Ì¡­•ä¤¤ì(€€€€€€€€€…Ù…¥±…‰±•MÑ•µ-•åÌ¹…‘¡­•ä¤ì(€€€€€€€€€½¹ÍÐÉ½ÕÁ-•ä€ô‰Õå•ÉÉ½ÕÁ9…µ”ñð‰Õå•É9…µ”ñð€U¹É½ÕÁ•‰Õå•Èœì(€€€€€€€€€¥˜€ ……Ù…¥±…‰±•	…±…¹•Í	åÉ½ÕÁmÉ½ÕÁ-•åt¤ì(€€€€€€€€€€€…Ù…¥±…‰±•	…±…¹•Í	åÉ½ÕÁmÉ½ÕÁ-•åt€ôì(€€€€€€€€€€€€€‰Õå•ÉÉ½ÕÁ9…µ”èÉ½ÕÁ-•ä°(€€€€€€€€€€€€€‰Õå•É9…µ•Ìè¹•ÜM•Ð ¤°(€€€€€€€€€€€€€Ñ½Ñ…±Ù…¥±…‰±•	…±…¹”è€À°(€€€€€€€€€€€€€ÍÑ•µÌèmt°(€€€€€€€€€€€ôì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡‰Õå•É9…µ”¤…Ù…¥±…‰±•	…±…¹•Í	åÉ½ÕÁmÉ½ÕÁ-•åt¹‰Õå•É9…µ•Ì¹…‘¡‰Õå•É9…µ”¤ì(€€€€€€€€€…Ù…¥±…‰±•	…±…¹•Í	åÉ½ÕÁmÉ½ÕÁ-•åt¹Ñ½Ñ…±Ù…¥±…‰±•	…±…¹”€¬ô5…Ñ ¹…‰Ì¡É••¥Ù…‰±”¤ì(€€€€€€€€€…Ù…¥±…‰±•	…±…¹•Í	åÉ½ÕÁmÉ½ÕÁ-•åt¹ÍÑ•µÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€ÍÑ•µ%èÍÑ•´¹%°(€€€€€€€€€€€ÍÑ•µ9…µ”è™½Éµ…ÑMÑ•µ9…µ”¡ÍÑ•´¤°(€€€€€€€€€€€‰Õå•É9…µ”°(€€€€€€€€€€€…Ù…¥±…‰±•	…±…¹”è5…Ñ ¹…‰Ì¡É••¥Ù…‰±”¤°(€€€€€€€€€€€É••¥Ù…‰±•	…±…¹”èÉ••¥Ù…‰±”°(€€€€€€€€€€€Á…åµ•¹Ñ…Ñ”èÍÑ•´¹A…åµ•¹Ñ}…Ñ•}}ŒñðÁ…åµ•¹Ñm‘…Ñ•¥•±‘tñðÁ…åµ•¹Ð¹É•…Ñ•‘…Ñ”ñð¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€ô(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€€€€€¥èÁ…åµ•¹Ð¹%°(€€€€€€€Á…åµ•¹Ñ%èÁ…åµ•¹Ð¹%°(€€€€€€€Á…åµ•¹Ñ9…µ”è¥¹½µ¥¹A…åµ•¹Ñ¥ÍÁ±…å9…µ”¡ì(€€€€€€€€€Á…åµ•¹Ð°(€€€€€€€€€É•™•É•¹•¥•±‘Ì°(€€€€€€€€€ÍÑ•´°(€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥”°(€€€€€€€€€ÑåÁ”°(€€€€€€€ô¤°(€€€€€€€Á…åµ•¹Ñ¥ÍÁ±…å9…µ”è¥¹½µ¥¹A…åµ•¹Ñ¥ÍÁ±…å9…µ”¡ì(€€€€€€€€€Á…åµ•¹Ð°(€€€€€€€€€É•™•É•¹•¥•±‘Ì°(€€€€€€€€€ÍÑ•´°(€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥”°(€€€€€€€€€ÑåÁ”°(€€€€€€€ô¤°(€€€€€€€Í…±•Í™½É•A…åµ•¹Ñ9…µ”èÁ…åµ•¹Ð¹9…µ”ñð¹Õ±°°(€€€€€€€Á…åµ•¹ÑI•½É‘QåÁ•9…µ”èÁ…åµ•¹Ð¹I•½É‘QåÁ”ü¹9…µ”ñð¹Õ±°°(€€€€€€€Á…åµ•¹ÑI•½É‘QåÁ••Ù•±½Á•É9…µ”èÁ…åµ•¹Ð¹I•½É‘QåÁ”ü¹•Ù•±½Á•É9…µ”ñð¹Õ±°°(€€€€€€€Á…åµ•¹Ñ…Ñ”°(€€€€€€€É•…Ñ•‘…Ñ”èÁ…åµ•¹Ð¹É•…Ñ•‘…Ñ”ñð¹Õ±°°(€€€€€€€¥¹Ù½¥•Õ•…Ñ”è‰Õå•É%¹Ù½¥•Õ•…Ñ”°(€€€€€€€‘•±…å…åÌ°(€€€€€€€Á…åµ•¹ÑQ•ÉµÌèÑåÁ”€ôôô€	Õå•ÈA…åµ•¹Ðœ€üÍÑ•´ü¹A…åµ•¹Ñ}Q•Éµ}}Œñð¹Õ±°€è¹Õ±°°(€€€€€€€ÑåÁ”°(€€€€€€€¥Í%¹½µ¥¹œèÑåÁ”€ôôô€	Õå•ÈA…åµ•¹ÐœñðÑåÁ”€ôôô€MÕÁÁ±¥•ÈI•™Õ¹œ°(€€€€€€€¥Í	…¹­¡…É”èÑåÁ”€ôôô€	…¹¬¡…É”œ°(€€€€€€€…µ½Õ¹Ð°(€€€€€€€¥¹½µ¥¹µ½Õ¹Ð°(€€€€€€€ÕÉÉ•¹äèÁ…åµ•¹Ð¹ÕÉÉ•¹å%Í½½‘”ñðÁ…åµ•¹Ð¹ÕÉÉ•¹å}}Œñð€UMœ°(€€€€€€€É•™•É•¹”è¥¹½µ¥¹A…åµ•¹ÑI•™•É•¹”¡Á…åµ•¹Ð°É•™•É•¹•¥•±‘Ì¤°(€€€€€€€Í…±•Í™½É•MÑ…ÑÕÌèÍÑ…ÑÕÍ¥•±‘Ì¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ñm™¥•±‘t¤¹™¥¹¡	½½±•…¸¤ñð¹Õ±°°(€€€€€€€Í…±•Í™½É•QåÁ”èÑåÁ•¥•±‘Ì¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ñm™¥•±‘t¤¹™¥¹¡	½½±•…¸¤ñð¹Õ±°°(€€€€€€€ÍÑ•µ%°(€€€€€€€ÍÑ•µ9…µ”èÍÑ•´€ü™½Éµ…ÑMÑ•µ9…µ”¡ÍÑ•´¤€è¹Õ±°°(€€€€€€€­•åMÑ•´èÍÑ•´ü¹-•åMÑ•µ}}Œñð¹Õ±°°(€€€€€€€‰Õå•É9…µ”°(€€€€€€€‰Õå•ÉÉ½ÕÁ9…µ”°(€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•%èÍÕÁÁ±¥•É%¹Ù½¥”ü¹%ñðÍÕÁÁ±¥•É%¹Ù½¥•%ñð¹Õ±°°(€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•9…µ”èÍÕÁÁ±¥•É%¹Ù½¥”ü¹9…µ”ñð¹Õ±°°(€€€€€€€ÍÕÁÁ±¥•É9…µ”èÍÕÁÁ±¥•É%¹Ù½¥•A…ÉÑå9…µ”¡ÍÕÁÁ±¥•É%¹Ù½¥”°ÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥ÁÌ¤°(€€€€€€€Á…ÉÑå9…µ”°(€€€€€€€¥¹Ù½¥•µ½Õ¹Ðè¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÑ•´ü¹Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œ¤°(€€€€€€€É••¥Ù…‰±•	…±…¹”èÉ••¥Ù…‰±”°(€€€€€€€Á…å…‰±•	…±…¹”èÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±€ü¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÕÁÁ±¥•É%¹Ù½¥”ü¹mÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±‘t¤€è¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÑ•´ü¹A…å…‰±•}	…±…¹•}}Œ¤°(€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹ÐèÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ñ¥•±€ü¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÕÁÁ±¥•É%¹Ù½¥”ü¹mÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ñ¥•±‘t¤€è¹Õ±°°(€€€€€€€ÍÑ…ÑÕÌèÍÑ…ÑÕÌ¹±…‰•°°(€€€€€€€ÍÑ…ÑÕÍQ½¹”èÍÑ…ÑÕÌ¹Ñ½¹”°(€€€€€€€Á…åµ•¹Ñ=‰©•Ñµ½Õ¹Ñ¥•±è…µ½Õ¹Ñ¥•±°(€€€€€€€Á…åµ•¹Ñ=‰©•ÑMÕÁÁ±¥•É%¹Ù½¥•¥•±‘ÌèÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì°(€€€€€€€‰É½­•É½µµ¥ÍÍ¥½¹5…Ñ °(€€€€€ôì(€€€ô¤(€€€€¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐÉ½ÝÌ€ô…±±I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÑåÁ”€„ôô€MÕÁÁ±¥•ÈA…åµ•¹Ðœ€˜˜É½Ü¹ÑåÁ”€„ôô€	…¹¬¡…É”œ€˜˜É½Ü¹ÑåÁ”€„ôô€	É½­•È½µµ¥ÍÍ¥½¸œ¤¹µ…À ¡É½Ü¤€ôø€¡ì€¸¸¹É½Ü°‰…¹­¡…É•Ìèmtô¤¤ì(€½¹ÍÐÕ¹É½ÕÁ•‘	…¹­¡…É•Ì€ômtì(€™½È€¡½¹ÍÐ¡…É”½˜…±±I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÑåÁ”€ôôô€	…¹¬¡…É”œ¤¤ì(€€€½¹ÍÐ¡…É•…Ñ”€ô‘…Ñ•=¹±ä¡¡…É”¹Á…åµ•¹Ñ…Ñ”¤ì(€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôÉ½ÝÌ(€€€€€€¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÑåÁ”€ôôô€	Õå•ÈA…åµ•¹Ðœ€˜˜É½Ü¹ÍÑ•µ%€˜˜É½Ü¹ÍÑ•µ%€ôôô¡…É”¹ÍÑ•µ%¤(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøì(€€€€€€€½¹ÍÐ…M…µ•…Ñ”€ô‘…Ñ•=¹±ä¡„¹Á…åµ•¹Ñ…Ñ”¤€ôôô¡…É•…Ñ”€ü€Ä€è€Àì(€€€€€€€½¹ÍÐ‰M…µ•…Ñ”€ô‘…Ñ•=¹±ä¡ˆ¹Á…åµ•¹Ñ…Ñ”¤€ôôô¡…É•…Ñ”€ü€Ä€è€Àì(€€€€€€€¥˜€¡…M…µ•…Ñ”€„ôô‰M…µ•…Ñ”¤É•ÑÕÉ¸‰M…µ•…Ñ”€´…M…µ•…Ñ”ì(€€€€€€€É•ÑÕÉ¸5…Ñ ¹…‰Ì¡9Õµ‰•È¡ˆ¹…µ½Õ¹Ðñð€À¤¤€´5…Ñ ¹…‰Ì¡9Õµ‰•È¡„¹…µ½Õ¹Ðñð€À¤¤ì(€€€€€ô¤ì(€€€½¹ÍÐÑ…É•Ð€ô…¹‘¥‘…Ñ•ÍlÁtñð¹Õ±°ì(€€€¥˜€¡Ñ…É•Ð¤ì(€€€€€…ÑÑ…¡	…¹­¡…É•Q½A…åµ•¹Ð¡Ñ…É•Ð°¡…É”¤ì(€€€ô•±Í”ì(€€€€€Õ¹É½ÕÁ•‘	…¹­¡…É•Ì¹ÁÕÍ ¡¡…É”¤ì(€€€ô(€ô(€½¹ÍÐ¥µÁ±¥¥Ñ	…¹­¡…É•%‘Ì€ô¹•ÜM•Ð ¤ì(€™½È€¡½¹ÍÐ¡…É”½˜É½ÝÌ¤ì(€€€½¹ÍÐÑ…É•Ð€ô¥¹½µ¥¹A…åµ•¹Ñ	…¹­¡…É•Q…É•Ð¡¡…É”°É½ÝÌ¤ì(€€€¥˜€ …Ñ…É•Ð¤½¹Ñ¥¹Õ”ì(€€€…ÑÑ…¡	…¹­¡…É•Q½A…åµ•¹Ð¡Ñ…É•Ð°¡…É”¤ì(€€€¥µÁ±¥¥Ñ	…¹­¡…É•%‘Ì¹…‘¡¡…É”¹¥ñð¡…É”¹Á…åµ•¹Ñ%¤ì(€ô(€½¹ÍÐ‘¥ÍÁ±…åI½ÝÌ€ôÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôø€…¥µÁ±¥¥Ñ	…¹­¡…É•%‘Ì¹¡…Ì¡É½Ü¹¥ñðÉ½Ü¹Á…åµ•¹Ñ%¤¤ì(€‘¥ÍÁ±…åI½ÝÌ¹ÁÕÍ  ¸¸¹Õ¹É½ÕÁ•‘	…¹­¡…É•Ì¤ì((€½¹ÍÐ¥¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹5…À€ô‰½‘ä¹}½µ¥Ñ%¹½µ¥¹1¥Ù•MÑ…Ñ”€üíô€è…Ý…¥Ð±½…‘%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹5…À¡‘¥ÍÁ±…åI½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹Á…åµ•¹Ñ%ñðÉ½Ü¹¥¤¤ì(€½¹ÍÐÉ½ÝÍ]¥Ñ¡%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹Ì€ô‘¥ÍÁ±…åI½ÝÌ¹µ…À ¡É½Ü¤€ôøì(€€€½¹ÍÐ¹½Ñ¥™¥…Ñ¥½¸€ô¥¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹5…ÁmÉ½Ü¹Á…åµ•¹Ñ%ñðÉ½Ü¹¥‘tñð¹Õ±°ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹É½Ü°(€€€€€¥¹Ñ•É•ÍÑ%¹Ù½¥•9½Ñ¥™¥…Ñ¥½¸è¹½Ñ¥™¥…Ñ¥½¸°(€€€€€¥¹Ñ•É•ÍÑ%¹Ù½¥•9½Ñ¥™¥…Ñ¥½¹M•¹Ðè¹½Ñ¥™¥…Ñ¥½¸ü¹‘•±¥Ù•ÉåMÑ…ÑÕÌ€ôôô€Í•¹Ðœ°(€€€€€¥¹Ñ•É•ÍÑ%¹Ù½¥•9½Ñ¥™¥…Ñ¥½¹A•¹‘¥¹œèlÍ•¹‘¥¹œœ°€Õ¹•ÉÑ…¥¸t¹¥¹±Õ‘•Ì¡¹½Ñ¥™¥…Ñ¥½¸ü¹‘•±¥Ù•ÉåMÑ…ÑÕÌ¤°(€€€ôì(€ô¤ì((€½¹ÍÐ¥¹±Õ‘•‘%¹½µ¥¹I½ÝÌ€ôÉ½ÝÍ]¥Ñ¡%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹Ì¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹¥Í%¹½µ¥¹œ¤ì(€½¹ÍÐ‰Õå•É¥…%¹Ù½¥•Ì€ô…Ý…¥Ð¥¹½µ¥¹	Õå•É¥…%¹Ù½¥•Ì¡ì(€€€Ñ¡É•Í¡½±‘MÑ…Ñ”èÍ•ÑÑ¥¹Ì°(€€€…•ÍÍ½¹Ñ•áÐ°(€ô¤ì(€½¹ÍÐ…Ù…¥±…‰±•	…±…¹•Ì€ô=‰©•Ð¹Ù…±Õ•Ì¡…Ù…¥±…‰±•	…±…¹•Í	åÉ½ÕÀ¤(€€€€¹µ…À ¡É½ÕÀ¤€ôø€¡ì(€€€€€‰Õå•ÉÉ½ÕÁ9…µ”èÉ½ÕÀ¹‰Õå•ÉÉ½ÕÁ9…µ”°(€€€€€‰Õå•É9…µ•Ìèl¸¸¹É½ÕÀ¹‰Õå•É9…µ•Ít¹Í½ÉÐ ¡„°ˆ¤€ôø„¹±½…±•½µÁ…É”¡ˆ¤¤°(€€€€€Ñ½Ñ…±Ù…¥±…‰±•	…±…¹”èÉ½ÕÀ¹Ñ½Ñ…±Ù…¥±…‰±•	…±…¹”°(€€€€€ÍÑ•µÌèÉ½ÕÀ¹ÍÑ•µÌ¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡ˆ¹Á…åµ•¹Ñ…Ñ”ñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡„¹Á…åµ•¹Ñ…Ñ”ñð€œœ¤¤¤°(€€€ô¤¤(€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹Ñ½Ñ…±Ù…¥±…‰±•	…±…¹”€´„¹Ñ½Ñ…±Ù…¥±…‰±•	…±…¹”¤ì((€É•ÑÕÉ¸ì(€€€É½ÝÌèÉ½ÝÍ]¥Ñ¡%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹Ì°(€€€‰Õå•É¥…%¹Ù½¥•Ì°(€€€…Ù…¥±…‰±•	…±…¹•Ì°(€€€Í•ÑÑ¥¹Ì°(€€€‘…Ñ•É½´°(€€€‘…Ñ•Q¼°(€€€Í¡•µ„èì(€€€€€Á…åµ•¹Ñ…Ñ•¥•±è‘…Ñ•¥•±°(€€€€€Á…åµ•¹Ñ¥±Ñ•É…Ñ•¥•±è™¥±Ñ•É…Ñ•¥•±°(€€€€€Á…åµ•¹Ñµ½Õ¹Ñ¥•±è…µ½Õ¹Ñ¥•±°(€€€€€Á…åµ•¹ÑI•™•É•¹•¥•±‘ÌèÉ•™•É•¹•¥•±‘Ì°(€€€€€Á…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•¥•±‘ÌèÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì°(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±°(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ñ¥•±°(€€€ô°(€€€Í¡•µ…]…É¹¥¹Ìèm…µ½Õ¹Ñ¥•±€ü¹Õ±°€è€9¼…µ½Õ¹Ðµ±¥­”™¥•±Ý…Ì™½Õ¹½¸A…åµ•¹Ñ}}Œ¸œ°‘…Ñ•¥•±€ü¹Õ±°€è€9¼‘…Ñ”µ±¥­”™¥•±Ý…Ì™½Õ¹½¸A…åµ•¹Ñ}}Œ¸œ°€MÕÁÁ±¥•Èµ¥¹Ù½¥”µ±¥¹­•¹•…Ñ¥Ù”Á…åµ•¹ÑÌ…É”±…ÍÍ¥™¥•…ÌÍÕÁÁ±¥•ÈÉ•™Õ¹‘Ì¸½¹™¥É´¥˜M…±•Í™½É”ÕÍ•ÌÑ¡”½ÁÁ½Í¥Ñ”Í¥¸¸t¹™¥±Ñ•È¡	½½±•…¸¤°(€€€ÍÕµµ…Éäèì(€€€€€Ñ½Ñ…±I½ÝÌèÉ½ÝÍ]¥Ñ¡%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹Ì¹±•¹Ñ °(€€€€€¥¹½µ¥¹I½ÝÌè¥¹±Õ‘•‘%¹½µ¥¹I½ÝÌ¹±•¹Ñ °(€€€€€Ñ½Ñ…±%¹½µ¥¹µ½Õ¹Ðè¥¹±Õ‘•‘%¹½µ¥¹I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬5…Ñ ¹…‰Ì¡9Õµ‰•È¡É½Ü¹¥¹½µ¥¹µ½Õ¹Ðñð€À¤¤°€À¤°(€€€€€‰Õå•ÉA…åµ•¹ÑQ½Ñ…°èÉ½ÝÍ]¥Ñ¡%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹Ì¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÑåÁ”€ôôô€	Õå•ÈA…åµ•¹Ðœ¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬5…Ñ ¹…‰Ì¡9Õµ‰•È¡É½Ü¹¥¹½µ¥¹µ½Õ¹Ðñð€À¤¤°€À¤°(€€€€€ÍÕÁÁ±¥•ÉI•™Õ¹‘Q½Ñ…°èÉ½ÝÍ]¥Ñ¡%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹Ì¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÑåÁ”€ôôô€MÕÁÁ±¥•ÈI•™Õ¹œ¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬5…Ñ ¹…‰Ì¡9Õµ‰•È¡É½Ü¹¥¹½µ¥¹µ½Õ¹Ðñð€À¤¤°€À¤°(€€€€€Õ¹µ…Ñ¡•‘½Õ¹ÐèÉ½ÝÍ]¥Ñ¡%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹Ì¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÑåÁ”€ôôô€U¹µ…Ñ¡•œñðÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€9••‘ÌÉ•Ù¥•Üœ¤¹±•¹Ñ °(€€€€€™Õ±±åA…¥‘½Õ¹ÐèÉ½ÝÍ]¥Ñ¡%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹Ì¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€Õ±±äÁ…¥œ¤¹±•¹Ñ °(€€€€€…Ù…¥±…‰±•	…±…¹•Q½Ñ…°è…Ù…¥±…‰±•	…±…¹•Ì¹É•‘Õ” ¡ÍÕ´°É½ÕÀ¤€ôøÍÕ´€¬9Õµ‰•È¡É½ÕÀ¹Ñ½Ñ…±Ù…¥±…‰±•	…±…¹”ñð€À¤°€À¤°(€€€€€…Ù…¥±…‰±•	…±…¹•½Õ¹Ðè…Ù…¥±…‰±•	…±…¹•Ì¹É•‘Õ” ¡ÍÕ´°É½ÕÀ¤€ôøÍÕ´€¬€¡É½ÕÀ¹ÍÑ•µÌü¹±•¹Ñ ñð€À¤°€À¤°(€€€ô°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑÍ1¥ÍÐ¡‰½‘ä°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐÍ•ÑÑ¥¹Ì€ô…Ý…¥Ð±½…‘%¹½µ¥¹A…åµ•¹ÑM•ÑÑ¥¹Ì ¤ì(€½¹ÍÐÑ½‘…ä€ô‘…Ñ•=¹±ä¡¹•Ü…Ñ” ¤¤ì(€½¹ÍÐ‘…Ñ•É½´€ô‘…Ñ•=¹±ä¡‰½‘ä¹‘…Ñ•É½´ñð‰½‘ä¹‘…Ñ•}™É½´ñðÑ½‘…ä¤ì(€½¹ÍÐ‘…Ñ•Q¼€ô‘…Ñ•=¹±ä¡‰½‘ä¹‘…Ñ•Q¼ñð‰½‘ä¹‘…Ñ•}Ñ¼ñðÑ½‘…ä¤ì(€½¹ÍÐ±¥µ¥Ð€ô5…Ñ ¹µ…à ÄÀÀ°5…Ñ ¹µ¥¸¡9Õµ‰•È¡‰½‘ä¹±¥µ¥Ð¤ñð€ÔÀÀÀ°€ÄÀÀÀÀ¤¤ì(€½¹ÍÐìÙ…±Õ”èÍ¹…ÁÍ¡½Ðô€ô…Ý…¥Ð…¡•‘M…±•Í™½É•Y…±Õ”¡ì(€€€¹…µ•ÍÁ…”è€¥¹½µ¥¹œµÁ…åµ•¹ÑÌœ°(€€€Á…å±½…èì‘…Ñ•É½´°‘…Ñ•Q¼°±¥µ¥Ð°Ñ¡É•Í¡½±‘ÌèÁ…åµ•¹Ñ½±±•Ñ¥½¹Q¡É•Í¡½±‘…¡•-•ä¡Í•ÑÑ¥¹Ì¤ô°(€€€ÑÑ±M•½¹‘Ìè€ØÀ°(€€€Ñ…ÌèlÍ…±•Í™½É”é¥¹½µ¥¹œµÁ…åµ•¹ÑÌœ°€Í…±•Í™½É”éÍÑ•´œ°€Í…±•Í™½É”é…½Õ¹Ðœ°€Í…±•Í™½É”é½‰©•ÐéA…åµ•¹Ñ}}Œœ°€Í…±•Í™½É”é½‰©•ÐéMÕÁÁ±¥•É}%¹Ù½¥•}}Œt°(€€€‰½‘ä°(€€€É•Ä°(€€€…•ÍÍ½¹Ñ•áÐ°(€€€±½…‘•Èè€ ¤€ôø(€€€€€¥¹½µ¥¹A…åµ•¹ÑÍ1¥ÍÑM¹…ÁÍ¡½Ð (€€€€€€€ì(€€€€€€€€€€¸¸¹‰½‘ä°(€€€€€€€€€‘…Ñ•É½´°(€€€€€€€€€‘…Ñ•Q¼°(€€€€€€€€€±¥µ¥Ð°(€€€€€€€€€}Í•ÑÑ¥¹Í=Ù•ÉÉ¥‘”èÍ•ÑÑ¥¹Ì°(€€€€€€€€€}½µ¥Ñ%¹½µ¥¹1¥Ù•MÑ…Ñ”èÑÉÕ”°(€€€€€€€ô°(€€€€€€€É•Ä°(€€€€€€€…•ÍÍ½¹Ñ•áÐ°(€€€€€€¤°(€ô¤ì(€½¹ÍÐ¹½Ñ¥™¥…Ñ¥½¹5…À€ô…Ý…¥Ð±½…‘%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹5…À ¡Í¹…ÁÍ¡½Ð¹É½ÝÌñðmt¤¹µ…À ¡É½Ü¤€ôøÉ½Ü¹Á…åµ•¹Ñ%ñðÉ½Ü¹¥¤¤ì(€½¹ÍÐ½±±•Ñ¥½¹5…À€ô…Ý…¥Ð±½…‘	Õå•É%¹Ù½¥•½±±•Ñ¥½¹5…À ¡Í¹…ÁÍ¡½Ð¹É½ÝÌñðmt¤¹µ…À ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%¤¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹Í¹…ÁÍ¡½Ð°(€€€Í•ÑÑ¥¹Ì°(€€€É½ÝÌè€¡Í¹…ÁÍ¡½Ð¹É½ÝÌñðmt¤¹µ…À ¡É½Ü¤€ôøì(€€€€€½¹ÍÐ¹½Ñ¥™¥…Ñ¥½¸€ô¹½Ñ¥™¥…Ñ¥½¹5…ÁmÉ½Ü¹Á…åµ•¹Ñ%ñðÉ½Ü¹¥‘tñð¹Õ±°ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹É½Ü°(€€€€€€€½±±•Ñ¥½¸è½±±•Ñ¥½¹5…ÁmÉ½Ü¹ÍÑ•µ%‘tü¹¥Ñ•´ñð¹Õ±°°(€€€€€€€½±±•Ñ¥½¹Ù•¹ÑÌè½±±•Ñ¥½¹5…ÁmÉ½Ü¹ÍÑ•µ%‘tü¹•Ù•¹ÑÌñðmt°(€€€€€€€¥¹Ñ•É•ÍÑ%¹Ù½¥•9½Ñ¥™¥…Ñ¥½¸è¹½Ñ¥™¥…Ñ¥½¸°(€€€€€€€¥¹Ñ•É•ÍÑ%¹Ù½¥•9½Ñ¥™¥…Ñ¥½¹M•¹Ðè¹½Ñ¥™¥…Ñ¥½¸ü¹‘•±¥Ù•ÉåMÑ…ÑÕÌ€ôôô€Í•¹Ðœ°(€€€€€€€¥¹Ñ•É•ÍÑ%¹Ù½¥•9½Ñ¥™¥…Ñ¥½¹A•¹‘¥¹œèlÍ•¹‘¥¹œœ°€Õ¹•ÉÑ…¥¸t¹¥¹±Õ‘•Ì¡¹½Ñ¥™¥…Ñ¥½¸ü¹‘•±¥Ù•ÉåMÑ…ÑÕÌ¤°(€€€€€ôì(€€€ô¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ±±½…Ñ¥½¹½¹™¥É´¡‰½‘ä°É•Ä¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•‘µ¥¹¥ÍÑÉ…Ñ½È¡É•Ä¤ì(€½¹ÍÐ‰Õå•ÉÉ½ÕÁ9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹‰Õå•ÉÉ½ÕÁ9…µ”ñð‰½‘ä¹‰Õå•É}É½ÕÁ}¹…µ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …‰Õå•ÉÉ½ÕÁ9…µ”¤Ñ¡É½Ü…ÁÁÉÉ½È 	Õå•ÈÉ½ÕÀ¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€Ñ¡É½Ü…ÁÁÉÉ½È M…±•Í™½É”Á…åµ•¹Ð…±±½…Ñ¥½¸ÝÉ¥Ñ”µ‰…¬¥Ì¹½Ð•¹…‰±•å•Ð¸½¹™¥É´Ñ¡”M…±•Í™½É”½‰©•Ð…¹™¥•±‘Ì™½È…ÁÁ±å¥¹œ…Ù…¥±…‰±”‰Õå•È‰…±…¹•ÌÑ¼…¹½Ñ¡•ÈMQ4¸œ°€ÔÀÄ¤ì)ô()½¹ÍÐ%9=5%9}Ae59Q}%9QIMQ}9=Q%%Q%=9}%1L€ôl¥œ°€Á…åµ•¹Ñ}¥œ°€Á…åµ•¹Ñ}¹…µ”œ°€ÍÑ•µ}¥œ°€ÍÑ•µ}¹…µ”œ°€‰Õå•É}¹…µ”œ°€‰Õå•É}É½ÕÁ}¹…µ”œ°€É••¥Ù•‘}‘…Ñ”œ°€Á…åµ•¹Ñ}É•…Ñ•‘}‘…Ñ”œ°€‘•±…å}‘…åÌœ°€…µ½Õ¹Ðœ°€ÕÉÉ•¹äœ°€É••¥Ù…‰±•}‰…±…¹”œ°€É•¥Á¥•¹Ñ}•µ…¥°œ°€•µ…¥±}ÍÕ‰©•Ðœ°€•µ…¥±}µ•ÍÍ…•}¥œ°€•µ…¥±}ÁÉ½Ù¥‘•Èœ°€…Ñ½É}ÕÍ•É}¥œ°€…Ñ½É}•µ…¥°œ°€…Ñ½É}¹…µ”œ°€µ•Ñ…‘…Ñ„œ°€‘•±¥Ù•Éå}ÍÑ…ÑÕÌœ°€±…ÍÑ}…ÑÑ•µÁÑ}…Ðœ°€±…ÍÑ}•ÉÉ½Èœ°€Í•¹‘•É}µ…¥±‰½á}¥œ°€Í•¹‘•É}µ…¥±‰½á}Í¹…ÁÍ¡½Ðœ°€Í•¹Ñ}…Ðœ°€É•…Ñ•‘}…Ðœ°€ÕÁ‘…Ñ•‘}…Ðt¹©½¥¸ œ°œ¤ì()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ‰9Õµ‰•È¡Ù…±Õ”¤ì(€½¹ÍÐ¹Õµ‰•È€ô9Õµ‰•È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸9Õµ‰•È¹¥Í¥¹¥Ñ”¡¹Õµ‰•È¤€ü9Õµ‰•È¡¹Õµ‰•È¹Ñ½¥á• È¤¤€è¹Õ±°ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ‰…Ñ”¡Ù…±Õ”¤ì(€¥˜€ …Ù…±Õ”¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐ‘…Ñ”€ô¹•Ü…Ñ”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸9Õµ‰•È¹¥Í9…8¡‘…Ñ”¹•ÑQ¥µ” ¤¤€ü¹Õ±°€è‘…Ñ”¹Ñ½%M=MÑÉ¥¹œ ¤ì)ô()™Õ¹Ñ¥½¸Í•É¥…±¥é•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¸¡É½Ü€ô¹Õ±°¤ì(€¥˜€ …É½Ü¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸ì(€€€¥èÉ½Ü¹¥°(€€€Á…åµ•¹Ñ%èÉ½Ü¹Á…åµ•¹Ñ}¥°(€€€Á…åµ•¹Ñ9…µ”èÉ½Ü¹Á…åµ•¹Ñ}¹…µ”°(€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ}¥°(€€€ÍÑ•µ9…µ”èÉ½Ü¹ÍÑ•µ}¹…µ”°(€€€‰Õå•É9…µ”èÉ½Ü¹‰Õå•É}¹…µ”°(€€€‰Õå•ÉÉ½ÕÁ9…µ”èÉ½Ü¹‰Õå•É}É½ÕÁ}¹…µ”°(€€€É••¥Ù•‘…Ñ”èÉ½Ü¹É••¥Ù•‘}‘…Ñ”°(€€€Á…åµ•¹ÑÉ•…Ñ•‘…Ñ”èÉ½Ü¹Á…åµ•¹Ñ}É•…Ñ•‘}‘…Ñ”°(€€€‘•±…å…åÌèÉ½Ü¹‘•±…å}‘…åÌ°(€€€…µ½Õ¹Ðè¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð¤°(€€€ÕÉÉ•¹äèÉ½Ü¹ÕÉÉ•¹ä°(€€€É••¥Ù…‰±•	…±…¹”è¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡É½Ü¹É••¥Ù…‰±•}‰…±…¹”¤°(€€€É•¥Á¥•¹Ñµ…¥°èÉ½Ü¹É•¥Á¥•¹Ñ}•µ…¥°°(€€€•µ…¥±MÕ‰©•ÐèÉ½Ü¹•µ…¥±}ÍÕ‰©•Ð°(€€€•µ…¥±5•ÍÍ…•%èÉ½Ü¹•µ…¥±}µ•ÍÍ…•}¥°(€€€•µ…¥±AÉ½Ù¥‘•ÈèÉ½Ü¹•µ…¥±}ÁÉ½Ù¥‘•È°(€€€…Ñ½ÉUÍ•É%èÉ½Ü¹…Ñ½É}ÕÍ•É}¥°(€€€…Ñ½Éµ…¥°èÉ½Ü¹…Ñ½É}•µ…¥°°(€€€…Ñ½É9…µ”èÉ½Ü¹…Ñ½É}¹…µ”°(€€€µ•Ñ…‘…Ñ„èÉ½Ü¹µ•Ñ…‘…Ñ„ñðíô°(€€€‘•±¥Ù•ÉåMÑ…ÑÕÌèÉ½Ü¹‘•±¥Ù•Éå}ÍÑ…ÑÕÌñð€Í•¹Ðœ°(€€€±…ÍÑÑÑ•µÁÑÐèÉ½Ü¹±…ÍÑ}…ÑÑ•µÁÑ}…Ðñð¹Õ±°°(€€€±…ÍÑÉÉ½ÈèÉ½Ü¹±…ÍÑ}•ÉÉ½Èñð¹Õ±°°(€€€Í•¹‘•É5…¥±‰½á%èÉ½Ü¹Í•¹‘•É}µ…¥±‰½á}¥ñð¹Õ±°°(€€€Í•¹‘•É5…¥±‰½áM¹…ÁÍ¡½ÐèÉ½Ü¹Í•¹‘•É}µ…¥±‰½á}Í¹…ÁÍ¡½Ðñð¹Õ±°°(€€€Í•¹ÑÐèÉ½Ü¹Í•¹Ñ}…Ð°(€€€É•…Ñ•‘ÐèÉ½Ü¹É•…Ñ•‘}…Ð°(€€€ÕÁ‘…Ñ•‘ÐèÉ½Ü¹ÕÁ‘…Ñ•‘}…ÐñðÉ½Ü¹É•…Ñ•‘}…Ð°(€ôì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ…‰±•U¹…Ù…¥±…‰±”¡•ÉÉ½È¤ì(€É•ÑÕÉ¸•ÉÉ½Èü¹½‘”€ôôô€œÐÉ@ÀÄœñð€½¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}¹½Ñ¥™¥…Ñ¥½¹Ì½¤¹Ñ•ÍÐ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð€œœ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¹5…À¡Á…åµ•¹Ñ%‘Ì€ômt¤ì(€½¹ÍÐ±¥•¹Ð€ôÍ…™•MÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤ì(€¥˜€ …±¥•¹Ð¤É•ÑÕÉ¸íôì(€½¹ÍÐ¥‘Ì€ôl¸¸¹¹•ÜM•Ð¡Á…åµ•¹Ñ%‘Ì¹µ…À ¡¥¤€ôøMÑÉ¥¹œ¡¥ñð€œœ¤¹ÑÉ¥´ ¤¤¹™¥±Ñ•È¡	½½±•…¸¤¥tì(€¥˜€ …¥‘Ì¹±•¹Ñ ¤É•ÑÕÉ¸íôì(€½¹ÍÐ¹½Ñ¥™¥…Ñ¥½¹Ì€ôíôì(€™½È€¡½¹ÍÐ¡Õ¹¬½˜¡Õ¹­%‘Ì¡¥‘Ì°€ÔÀÀ¤¤ì(€€€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}¹½Ñ¥™¥…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%9=5%9}Ae59Q}%9QIMQ}9=Q%%Q%=9}%1L¤¹¥¸ Á…åµ•¹Ñ}¥œ°¡Õ¹¬¤ì(€€€¥˜€¡•ÉÉ½È¤ì(€€€€€¥˜€ …¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ…‰±•U¹…Ù…¥±…‰±”¡•ÉÉ½È¤¤ì(€€€€€€€½¹Í½±”¹•ÉÉ½È …¥±•Ñ¼±½…¥¹½µ¥¹œÁ…åµ•¹Ð¥¹Ñ•É•ÍÐ¹½Ñ¥™¥…Ñ¥½¹Ìœ°•ÉÉ½È¹µ•ÍÍ…”¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸íôì(€€€ô(€€€™½È€¡½¹ÍÐÉ½Ü½˜‘…Ñ„ñðmt¤¹½Ñ¥™¥…Ñ¥½¹ÍmÉ½Ü¹Á…åµ•¹Ñ}¥‘t€ôÍ•É¥…±¥é•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¸¡É½Ü¤ì(€ô(€É•ÑÕÉ¸¹½Ñ¥™¥…Ñ¥½¹Ìì)ô()…Íå¹Œ™Õ¹Ñ¥½¸™•Ñ¡%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¸¡±¥•¹Ð°Á…åµ•¹Ñ%¤ì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}¹½Ñ¥™¥…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%9=5%9}Ae59Q}%9QIMQ}9=Q%%Q%=9}%1L¤¹•Ä Á…åµ•¹Ñ}¥œ°Á…åµ•¹Ñ%¤¹µ…å‰•M¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤ì(€€€¥˜€¡¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ…‰±•U¹…Ù…¥±…‰±”¡•ÉÉ½È¤¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È 5¥ÍÍ¥¹œMÕÁ…‰…Í”Ñ…‰±”¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}¹½Ñ¥™¥…Ñ¥½¹Ì¸IÕ¸Ñ¡”±…Ñ•ÍÐMÕÁ…‰…Í”µ¥É…Ñ¥½¸‰•™½É”É•ÅÕ•ÍÑ¥¹œ±…Ñ”Á…åµ•¹Ð¥¹Ñ•É•ÍÐ¥¹Ù½¥•Ì¸œ°€ÔÀÀ¤ì(€€€ô(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô(€É•ÑÕÉ¸Í•É¥…±¥é•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¸¡‘…Ñ„¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑI…Ñ•¥•±¡…½Õ¹Ñ¥•±‘Ì€ômt¤ì(€½¹ÍÐ…±±½Ý•‘QåÁ•Ì€ô¹•ÜM•Ð¡l‘½Õ‰±”œ°€Á•É•¹Ðœ°€ÕÉÉ•¹äœ°€¥¹Ðœ°€ÍÑÉ¥¹œœ°€Á¥­±¥ÍÐt¤ì(€½¹ÍÐµ…Ñ¡•Ì€ô…½Õ¹Ñ¥•±‘Ì¹™¥±Ñ•È ¡™¥•±¤€ôø™¥•±ü¹¹…µ”€˜˜…±±½Ý•‘QåÁ•Ì¹¡…Ì¡™¥•±¹ÑåÁ”¤€˜˜™¥•±‘5…Ñ¡•Í¹ä¡™¥•±°l±…Ñ•Á…åµ•¹Ñ¥¹Ñ•É•ÍÑÉ…Ñ”œ°€±…Ñ•Á…åµ•¹Ñ¥¹Ñ•É•ÍÑÉ…Ñ•Œœ°€Á…åµ•¹Ñ¥¹Ñ•É•ÍÑÉ…Ñ”œ°€Á…åµ•¹Ñ¥¹Ñ•É•ÍÑÉ…Ñ•Œœ°€½Ù•É‘Õ•¥¹Ñ•É•ÍÑÉ…Ñ”œ°€½Ù•É‘Õ•¥¹Ñ•É•ÍÑÉ…Ñ•Œœ°€¥¹Ñ•É•ÍÑÉ…Ñ”œ°€¥¹Ñ•É•ÍÑÉ…Ñ•Œœ°€™¥¹…¹•¡…É•É…Ñ”œ°€™¥¹…¹•¡…É•É…Ñ•Œt°l±…Ñ•Á…åµ•¹Ñ¥¹Ñ•É•ÍÐœ°€½Ù•É‘Õ•¥¹Ñ•É•ÍÐœ°€¥¹Ñ•É•ÍÑÉ…Ñ”œ°€™¥¹…¹•¡…É”t¤¤ì(€É•ÑÕÉ¸µ…Ñ¡•ÍlÁtñð¹Õ±°ì)ô()™Õ¹Ñ¥½¸Á…ÉÍ•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑI…Ñ”¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”€ôô¹Õ±°ñðÙ…±Õ”€ôôô€œœ¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐµ…Ñ €ôMÑÉ¥¹œ¡Ù…±Õ”¤(€€€€¹É•Á±…” ¼°½œ°€œœ¤(€€€€¹µ…Ñ  ¼´ýq¬¡p¹q¬¤ü¼¤ì(€¥˜€ …µ…Ñ ¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐ¹Õµ‰•È€ô9Õµ‰•È¡µ…Ñ¡lÁt¤ì(€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡¹Õµ‰•È¤ñð¹Õµ‰•È€ð€À¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸5…Ñ ¹…‰Ì¡¹Õµ‰•È¤€ø€Ä€ü¹Õµ‰•È€¼€ÄÀÀ€è¹Õµ‰•Èì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑI…Ñ•1…‰•°¡É…Ñ••¥µ…°¤ì(€¥˜€¡É…Ñ••¥µ…°€ôô¹Õ±°¤É•ÑÕÉ¸€œ´œì(€É•ÑÕÉ¸€‘ì¡9Õµ‰•È¡É…Ñ••¥µ…°¤€¨€ÄÀÀ¤¹Ñ½1½…±•MÑÉ¥¹œ •¸µULœ°ìµ¥¹¥µÕµÉ…Ñ¥½¹¥¥ÑÌè€È°µ…á¥µÕµÉ…Ñ¥½¹¥¥ÑÌè€Èô¥ô”Á•Èµ½¹Ñ¡€ì)ô()™Õ¹Ñ¥½¸¥¹Ñ•É•ÍÑ½ÉµÕ±…Q•áÐ¡‰…±…¹”°É…Ñ••¥µ…°°‘…åÌ¤ì(€É•ÑÕÉ¸€‘íµ½¹•ä¡‰…±…¹”¥ôà€‘í¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑI…Ñ•1…‰•°¡É…Ñ••¥µ…°¥ôà€‘í‘…åÍô€¼€ÌÁ€ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ…±Õ±…Ñ¥½¸¡‰½‘ä€ôíô°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐÍÑ•µ%€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÑ•µ%ñð‰½‘ä¹ÍÑ•µ}¥ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …¥ÍM…±•Í™½É•%¡ÍÑ•µ%¤¤Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥ÍÑ•µ%¥ÌÉ•ÅÕ¥É•™½È±…Ñ”Á…åµ•¹Ð¥¹Ñ•É•ÍÐ…±Õ±…Ñ¥½¸¸œ°€ÐÀÀ¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡ÍÑ•µ%°…•ÍÍ½¹Ñ•áÐ¤ì((€½¹ÍÐmÍÑ•µ•ÍÉ¥‰”°Á…åµ•¹Ñ•ÍÉ¥‰•t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€Í…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€ÍÑ•µ}}Œœô¤¹…Ñ   ¤€ôø€¡ì(€€€€€™¥•±‘Ìèmt°(€€€ô¤¤°(€€€Í…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€A…åµ•¹Ñ}}Œœô¤¹…Ñ   ¤€ôø€¡ì(€€€€€™¥•±‘Ìèmt°(€€€ô¤¤°(€t¤ì(€½¹ÍÐÍÑ•µ¥•±‘Ì€ôÍÑ•µ•ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐÍÑ•µ¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡ÍÑ•µ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐÁ…åµ•¹Ñ¥•±‘Ì€ôÁ…åµ•¹Ñ•ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐÁ…åµ•¹Ñ¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡Á…åµ•¹Ñ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€¥˜€ …Á…åµ•¹Ñ¥•±‘9…µ•Ì¹Í¥é”¤Ñ¡É½Ü…ÁÁÉÉ½È A…åµ•¹Ñ}}Œ¥Ì¹½ÐÅÕ•Éå…‰±”°Í¼¥¹Ñ•É•ÍÐ…¹¹½Ð‰”…±Õ±…Ñ•¸œ°€ÔÀÀ¤ì((€½¹ÍÐ…½Õ¹Ñ•ÍÉ¥‰”€ôÍÑ•µ¥•±‘9…µ•Ì¹¡…Ì ½Õ¹Ñ}}Œœ¤(€€€€ü…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€½Õ¹Ðœô¤¹…Ñ   ¤€ôø€¡ì(€€€€€€€™¥•±‘Ìèmt°(€€€€€ô¤¤(€€€€èì™¥•±‘Ìèmtôì(€½¹ÍÐ…½Õ¹Ñ¥•±‘Ì€ô…½Õ¹Ñ•ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐ…½Õ¹Ñ¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡…½Õ¹Ñ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐ¥¹Ñ•É•ÍÑ¥•±€ô¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑI…Ñ•¥•±¡…½Õ¹Ñ¥•±‘Ì¤ì((€½¹ÍÐÍÑ•µM•±•Ñ¥•±‘Ì€ôl%œ°€9…µ”œ°€¸¸¹Í•±•Ñ•‘¥•±‘Ì¡ÍÑ•µ¥•±‘9…µ•Ì°l-•åMÑ•µ}}Œœ°€	Õå•É}9…µ•}}Œœ°€	Õå•É}}Œœ°€½Õ¹Ñ}}Œœ°€Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œœ°€I••¥Ù…‰±•}	…±…¹•}}Œœ°€A…åµ•¹Ñ}Q•Éµ}}Œœ°€%¹Ù½¥•}Õ•}…Ñ•}}Œœ°€	Õå•É}A…å}Q•Éµ}…Ñ•}}Œœ°€Õ•}…Ñ•}}Œœ°€•±¥Ù•Éå}…Ñ•}}Œœ°€•±¥Ù•Éå}…Ñ•}=É}áÁ•Ñ•‘}}Œœ°€áÁ•Ñ•‘}•±¥Ù•Éå}…Ñ•}}Œt¥tì(€¥˜€¡ÍÑ•µ¥•±‘9…µ•Ì¹¡…Ì Y•ÍÍ•±}}Œœ¤¤ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  Y•ÍÍ•±}}È¹9…µ”œ¤ì(€¥˜€¡ÍÑ•µ¥•±‘9…µ•Ì¹¡…Ì A½ÉÑ}}Œœ¤¤ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  A½ÉÑ}}È¹9…µ”œ¤ì(€¥˜€¡ÍÑ•µ¥•±‘9…µ•Ì¹¡…Ì ½Õ¹Ñ}}Œœ¤¤ì(€€€ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹9…µ”œ¤ì(€€€¥˜€¡…½Õ¹Ñ¥•±‘9…µ•Ì¹¡…Ì É½ÕÁ}9…µ•}}Œœ¤¤ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹É½ÕÁ}9…µ•}}Œœ¤ì(€€€¥˜€¡…½Õ¹Ñ¥•±‘9…µ•Ì¹¡…Ì A…É•¹Ñ%œ¤¤ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹A…É•¹Ð¹9…µ”œ¤ì(€€€¥˜€¡¥¹Ñ•É•ÍÑ¥•±ü¹¹…µ”¤ÍÑ•µM•±•Ñ¥•±‘Ì¹ÁÕÍ ¡½Õ¹Ñ}}È¸‘í¥¹Ñ•É•ÍÑ¥•±¹¹…µ•õ€¤ì(€ô((€½¹ÍÐÍÑ•µI½ÝÌ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ (€€€€(€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡ÍÑ•µM•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€I=4ÍÑ•µ}}Œ(€€€]!I%€ô€œ‘í•Í…Á•M½Å°¡ÍÑ•µ%¥ôœ(€€€1%5%P€Ä(€€°(€€€ì±¥µ¥Ðè€Ä°Í½™Ñ…¥°èÑÉÕ”ô°(€€¤ì(€½¹ÍÐÍÑ•´€ôÍÑ•µI½ÝÍlÁtì(€¥˜€ …ÍÑ•´¤Ñ¡É½Ü…ÁÁÉÉ½È MQ4Ý…Ì¹½Ð™½Õ¹¥¸M…±•Í™½É”¸œ°€ÐÀÐ¤ì((€½¹ÍÐ‘…Ñ•¥•±€ô™¥ÉÍÑÙ…¥±…‰±•¥•±¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°l…Ñ•}}Œœ°€A…åµ•¹Ñ}…Ñ•}}Œœ°€I••¥Ù•‘}…Ñ•}}Œœ°€A…¥‘}…Ñ•}}Œœ°€É•…Ñ•‘…Ñ”t¤ì(€½¹ÍÐ…µ½Õ¹Ñ¥•±€ô™¥ÉÍÑÙ…¥±…‰±•¥•±¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°lµ½Õ¹Ñ}}Œœ°€A…åµ•¹Ñ}µ½Õ¹Ñ}}Œœ°€A…¥‘}µ½Õ¹Ñ}}Œœ°€I••¥Ù•‘}µ½Õ¹Ñ}}Œœ°€Q½Ñ…±}µ½Õ¹Ñ}}Œœ°€µ½Õ¹Ñ}A…¥‘}}Œœ°€A…åµ•¹Ñ}Y…±Õ•}}Œœ°€ÑÕ…±}µ½Õ¹Ñ}}Œt¤ì(€¥˜€ …‘…Ñ•¥•±ñð€……µ½Õ¹Ñ¥•±¤Ñ¡É½Ü…ÁÁÉÉ½È A…åµ•¹Ð‘…Ñ”½È…µ½Õ¹Ð™¥•±Ý…Ì¹½Ð™½Õ¹½¸A…åµ•¹Ñ}}Œ¸œ°€ÔÀÀ¤ì((€½¹ÍÐÉ•™•É•¹•¥•±‘Ì€ô¥¹½µ¥¹A…åµ•¹ÑI•™•É•¹•¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì¤ì(€½¹ÍÐÍÑ…ÑÕÍ¥•±‘Ì€ôÍ•±•Ñ•‘¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°lMÑ…ÑÕÍ}}Œœ°€A…åµ•¹Ñ}MÑ…ÑÕÍ}}Œt¤ì(€½¹ÍÐÑåÁ•¥•±‘Ì€ôÍ•±•Ñ•‘¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°lQåÁ•}}Œœ°€A…åµ•¹Ñ}QåÁ•}}Œt¤ì(€½¹ÍÐ‘¥É•Ñ¥½¹¥•±‘Ì€ô¥¹½µ¥¹A…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì€ô¥¹½µ¥¹A…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì¤ì(€½¹ÍÐÁ…åµ•¹ÑM•±•Ñ¥•±‘Ì€ôl%œ°€¸¸¹Í•±•Ñ•‘¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°l9…µ”œ°€I•½É‘QåÁ•%œ°€É•…Ñ•‘…Ñ”œ°€1…ÍÑ5½‘¥™¥•‘…Ñ”œ°€MQ5}}Œœ°€ÕÉÉ•¹å%Í½½‘”œ°€ÕÉÉ•¹å}}Œt¤°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì I•½É‘QåÁ•%œ¤€ü€I•½É‘QåÁ”¹9…µ”œ€è¹Õ±°°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì I•½É‘QåÁ•%œ¤€ü€I•½É‘QåÁ”¹•Ù•±½Á•É9…µ”œ€è¹Õ±°°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì°‘…Ñ•¥•±°…µ½Õ¹Ñ¥•±°€¸¸¹É•™•É•¹•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹‘¥É•Ñ¥½¹¥•±‘Ít¹™¥±Ñ•È¡	½½±•…¸¤ì((€½¹ÍÐm±¥¹•%Ñ•µÌ°‰Õå•É	É½­•ÉÌ°Á…åµ•¹ÑÍt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€ÅÕ•ÉåI½ÝÌ (€€€€€€(€€€€€M1P%°MQ5}}Œ°…¹•±±•‘}}Œ°EÕ…¹Ñ¥Ñå}}Œ°EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œ°(€€€€€€€€€€€€EÕ…¹Ñ¥Ñå}5…á}}Œ°EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œ°%Í}EÕ…¹Ñ¥Ñå}I…¹•}}Œ°(€€€€€€€€€€€€MÕÁÁ±¥•É}	É½­•É}}Œ°MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°(€€€€€€€€€€€€	Õå•ÉÍ}	É½­•É}}Œ°	Õå•É}	É½­•É}}Œ°	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°(€€€€€€€€€€€€	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}1ÕµÁÍÕµ}}Œ°½µµ¥ÍÍ¥½¹}½ÍÑ}}Œ(€€€€€I=4MQ5}1¥¹•}%Ñ•µ}}Œ(€€€€€]!IMQ5}}Œ€ô€œ‘í•Í…Á•M½Å°¡ÍÑ•µ%¥ôœ(€€€€€1%5%P€ÔÀÀÀ(€€€€°(€€€€€ì±¥µ¥Ðè€ÔÀÀÀ°Í½™Ñ…¥°èÑÉÕ”ô°(€€€€¤°(€€€ÅÕ•ÉåI½ÝÌ (€€€€€€(€€€€€M1P%°MQ5}}Œ°	Õå•É}	É½­•É}}Œ(€€€€€I=4MQ5}	Õå•É}	É½­•É}}Œ(€€€€€]!IMQ5}}Œ€ô€œ‘í•Í…Á•M½Å°¡ÍÑ•µ%¥ôœ(€€€€€1%5%P€ÔÀÀÀ(€€€€°(€€€€€ì±¥µ¥Ðè€ÔÀÀÀ°Í½™Ñ…¥°èÑÉÕ”ô°(€€€€¤°(€€€ÅÕ•ÉåI½ÝÌ (€€€€€€(€€€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡Á…åµ•¹ÑM•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€€€I=4A…åµ•¹Ñ}}Œ(€€€€€]!IMQ5}}Œ€ô€œ‘í•Í…Á•M½Å°¡ÍÑ•µ%¥ôœ(€€€€€=IH	d€‘í‘…Ñ•¥•±‘ôM9U11L1MP°É•…Ñ•‘…Ñ”M(€€€€€1%5%P€ÔÀÀÀ(€€€€°(€€€€€ì±¥µ¥Ðè€ÔÀÀÀ°Í½™Ñ…¥°èÑÉÕ”ô°(€€€€¤°(€t¤ì((€½¹ÍÐ‰É½­•É½Õ¹Ñ%‘Ì€ôl¸¸¹¹•ÜM•Ð¡l¸¸¹±¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤°€¸¸¹±¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹	Õå•ÉÍ}	É½­•É}}Œñð¥Ñ•´¹	Õå•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤°€¸¸¹‰Õå•É	É½­•ÉÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹	Õå•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¥t¥tì(€½¹ÍÐ‰É½­•É½Õ¹Ñ5…À€ô…Ý…¥Ð¹…µ•Í	å%‘Ì ½Õ¹Ðœ°‰É½­•É½Õ¹Ñ%‘Ì¤ì(€™½È€¡½¹ÍÐm¥°¹…µ•t½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡‰É½­•É½Õ¹Ñ5…À¤¤‰É½­•É½Õ¹Ñ5…ÁmMÑÉ¥¹œ¡¥¤¹Í±¥” À°€ÄÔ¥t€ô¹…µ”ì(€½¹ÍÐ‰É½­•ÉÉ½ÕÁÌ€ô(€€€‰Õ¥±‘	É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÌ¡ì(€€€€€ÍÑ•µ5…ÀèìmÍÑ•´¹%‘tèÍÑ•´ô°(€€€€€±¥¹•%Ñ•µÌ°(€€€€€‰Õå•É	É½­•ÉÌ°(€€€€€…½Õ¹Ñ5…Àè‰É½­•É½Õ¹Ñ5…À°(€€€ô¥mÍÑ•´¹%‘tñðmtì((€½¹ÍÐ‰Õå•ÉA…åµ•¹ÑÌ€ôÁ…åµ•¹ÑÌ(€€€€¹™¥±Ñ•È ¡Á…åµ•¹Ð¤€ôø€…¥¹½µ¥¹A…åµ•¹Ñ%ÍI••¥Ù…‰±•I•µ¥ÑÑ…¹”¡Á…åµ•¹Ð°l¸¸¹É•™•É•¹•¥•±‘Ì°€¸¸¹‘¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ít¤¤(€€€€¹µ…À ¡Á…åµ•¹Ð¤€ôøì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡Á…åµ•¹Ñm…µ½Õ¹Ñ¥•±‘t¤ì(€€€€€½¹ÍÐÁ…åµ•¹Ñ…Ñ”€ôÁ…åµ•¹Ñm‘…Ñ•¥•±‘tñðÁ…åµ•¹Ð¹É•…Ñ•‘…Ñ”ñð¹Õ±°ì(€€€€€½¹ÍÐ‰É½­•É½µµ¥ÍÍ¥½¹5…Ñ €ô™¥¹‘	É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ñ5…Ñ ¡Á…åµ•¹Ð°…µ½Õ¹Ð°‰É½­•ÉÉ½ÕÁÌ°l¸¸¹É•™•É•¹•¥•±‘Ì°€¸¸¹‘¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹ÑåÁ•¥•±‘Ì°€¸¸¹ÍÑ…ÑÕÍ¥•±‘Ít¤ì(€€€€€½¹ÍÐÑåÁ”€ô‰É½­•É½µµ¥ÍÍ¥½¹5…Ñ (€€€€€€€€ü€	É½­•È½µµ¥ÍÍ¥½¸œ(€€€€€€€€è¥¹½µ¥¹A…åµ•¹Ñ1½½­Í	…¹­¡…É”¡Á…åµ•¹Ð°ì(€€€€€€€€€€€€€É•™•É•¹•¥•±‘Ì°(€€€€€€€€€€€€€‘¥É•Ñ¥½¹¥•±‘Ì°(€€€€€€€€€€€€€ÑåÁ•¥•±‘Ì°(€€€€€€€€€€€€€ÍÑ…ÑÕÍ¥•±‘Ì°(€€€€€€€€€€€ô¤(€€€€€€€€€€ü€	…¹¬¡…É”œ(€€€€€€€€€€è¥¹½µ¥¹A…åµ•¹ÑQåÁ•É½µ½¹Ñ•áÐ¡Á…åµ•¹Ð°ì(€€€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€€€ÍÑ•´°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥”è¹Õ±°°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘ÌèÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì°(€€€€€€€€€€€€€‘¥É•Ñ¥½¹¥•±‘Ì°(€€€€€€€€€€€€€ÑåÁ•¥•±‘Ì°(€€€€€€€€€€€€€ÍÑ…ÑÕÍ¥•±‘Ì°(€€€€€€€€€€€ô¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€¥èÁ…åµ•¹Ð¹%°(€€€€€€€¹…µ”è¥¹½µ¥¹A…åµ•¹Ñ¥ÍÁ±…å9…µ”¡ì(€€€€€€€€€Á…åµ•¹Ð°(€€€€€€€€€É•™•É•¹•¥•±‘Ì°(€€€€€€€€€ÍÑ•´°(€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥”è¹Õ±°°(€€€€€€€€€ÑåÁ”°(€€€€€€€ô¤°(€€€€€€€…µ½Õ¹Ð°(€€€€€€€Á…åµ•¹Ñ…Ñ”°(€€€€€€€‘…Ñ•=¹±äè‘…Ñ•=¹±ä¡Á…åµ•¹Ñ…Ñ”¤°(€€€€€€€ÑåÁ”°(€€€€€ôì(€€€ô¤(€€€€¹™¥±Ñ•È ¡Á…åµ•¹Ð¤€ôøÁ…åµ•¹Ð¹ÑåÁ”€ôôô€	Õå•ÈA…åµ•¹Ðœ€˜˜Á…åµ•¹Ð¹…µ½Õ¹Ð€„ô¹Õ±°€˜˜Á…åµ•¹Ð¹…µ½Õ¹Ð€ø€À€˜˜Á…åµ•¹Ð¹‘…Ñ•=¹±ä¤(€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡„¹‘…Ñ•=¹±ä¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹‘…Ñ•=¹±ä¤¤ñðMÑÉ¥¹œ¡„¹¥¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹¥¤¤¤ì((€½¹ÍÐÉ…ÝÕ•…Ñ”€ô…±Õ±…Ñ•‘	Õå•ÉA…åQ•Éµ…Ñ”¡ÍÑ•´¤ñðÍÑ•´¹%¹Ù½¥•}Õ•}…Ñ•}}ŒñðÍÑ•´¹Õ•}…Ñ•}}ŒñðÍÑ•´¹	Õå•É}A…å}Q•Éµ}…Ñ•}}Œñð¹Õ±°ì(€½¹ÍÐ‘Õ•…Ñ”€ô‘…Ñ•=¹±ä¡É…ÝÕ•…Ñ”¤ì(€¥˜€ …‘Õ•…Ñ”¤Ñ¡É½Ü…ÁÁÉÉ½È 	Õå•È¥¹Ù½¥”‘Õ”‘…Ñ”¥Ìµ¥ÍÍ¥¹œ°Í¼±…Ñ”Á…åµ•¹Ð¥¹Ñ•É•ÍÐ…¹¹½Ð‰”…±Õ±…Ñ•¸œ°€ÐÀÀ¤ì((€½¹ÍÐÉ…ÝI…Ñ”€ô¥¹Ñ•É•ÍÑ¥•±ü¹¹…µ”€üÍÑ•µl½Õ¹Ñ}}Ètü¹m¥¹Ñ•É•ÍÑ¥•±¹¹…µ•t€è¹Õ±°ì(€½¹ÍÐµ½¹Ñ¡±åI…Ñ”€ôÁ…ÉÍ•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑI…Ñ”¡É…ÝI…Ñ”¤€üü€À¸ÀÈì(€½¹ÍÐÉ…Ñ•]…É¹¥¹œ€ôÉ…ÝI…Ñ”€ôô¹Õ±°ñðÉ…ÝI…Ñ”€ôôô€œœ€ü€	Õå•È…½Õ¹Ð¥¹Ñ•É•ÍÐÉ…Ñ”Ý…Ì¹½Ð™½Õ¹ì‘•™…Õ±Ñ•Ñ¼€È¸ÀÀ”Á•Èµ½¹Ñ ¸œ€è¹Õ±°ì(€½¹ÍÐ¥¹Ù½¥•µ½Õ¹Ð€ô¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÑ•´¹Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œ¤€üü¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡‰½‘ä¹¥¹Ù½¥•µ½Õ¹Ð¤€üü‰Õå•ÉA…åµ•¹ÑÌ¹É•‘Õ” ¡ÍÕ´°Á…åµ•¹Ð¤€ôøÍÕ´€¬9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤°€À¤€¬5…Ñ ¹µ…à À°9Õµ‰•È¡‰½‘ä¹É••¥Ù…‰±•	…±…¹”ñð€À¤¤ì(€¥˜€ …¥¹Ù½¥•µ½Õ¹Ðñð¥¹Ù½¥•µ½Õ¹Ð€ðô€À¤Ñ¡É½Ü…ÁÁÉÉ½È 	Õå•È¥¹Ù½¥”…µ½Õ¹Ð¥Ìµ¥ÍÍ¥¹œ°Í¼±…Ñ”Á…åµ•¹Ð¥¹Ñ•É•ÍÐ…¹¹½Ð‰”…±Õ±…Ñ•¸œ°€ÐÀÀ¤ì((€½¹ÍÐÑ½‘…ä€ô‘…Ñ•=¹±ä¡¹•Ü…Ñ” ¤¤ì(€±•Ð‰…±…¹”€ô¥¹Ù½¥•µ½Õ¹Ðì(€±•Ð±…ÍÑ…Ñ”€ô‘Õ•…Ñ”ì(€½¹ÍÐÍ•µ•¹ÑÌ€ômtì(€½¹ÍÐÁ…åµ•¹ÑM¡•‘Õ±”€ômtì(€™½È€¡½¹ÍÐÁ…åµ•¹Ð½˜‰Õå•ÉA…åµ•¹ÑÌ¤ì(€€€½¹ÍÐÁ…åµ•¹Ñµ½Õ¹Ð€ô5…Ñ ¹µ¥¸¡9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤°5…Ñ ¹µ…à À°‰…±…¹”¤¤ì(€€€¥˜€¡Á…åµ•¹Ð¹‘…Ñ•=¹±ä€ðô‘Õ•…Ñ”¤ì(€€€€€‰…±…¹”€ô5…Ñ ¹µ…à À°‰…±…¹”€´Á…åµ•¹Ñµ½Õ¹Ð¤ì(€€€€€Á…åµ•¹ÑM¡•‘Õ±”¹ÁÕÍ ¡ì(€€€€€€€€¸¸¹Á…åµ•¹Ð°(€€€€€€€‰…±…¹•™Ñ•Èè‰…±…¹”°(€€€€€€€¹½Ñ”è€A…¥½¸½‰•™½É”‘Õ”‘…Ñ”œ°(€€€€€ô¤ì(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€¥˜€¡‰…±…¹”€ø€À€˜˜Á…åµ•¹Ð¹‘…Ñ•=¹±ä€ø±…ÍÑ…Ñ”¤ì(€€€€€½¹ÍÐ‘…åÌ€ô5…Ñ ¹µ…à À°‘…åÍ	•ÑÝ••¸¡±…ÍÑ…Ñ”°Á…åµ•¹Ð¹‘…Ñ•=¹±ä¤¤ì(€€€€€¥˜€¡‘…åÌ€ø€À¤ì(€€€€€€€½¹ÍÐ¥¹Ñ•É•ÍÐ€ô‰…±…¹”€¨µ½¹Ñ¡±åI…Ñ”€¨€¡‘…åÌ€¼€ÌÀ¤ì(€€€€€€€Í•µ•¹ÑÌ¹ÁÕÍ ¡ì(€€€€€€€€€™É½µ…Ñ”è±…ÍÑ…Ñ”°(€€€€€€€€€Ñ½…Ñ”èÁ…åµ•¹Ð¹‘…Ñ•=¹±ä°(€€€€€€€€€‰…±…¹”°(€€€€€€€€€‘…åÌ°(€€€€€€€€€É…Ñ••¥µ…°èµ½¹Ñ¡±åI…Ñ”°(€€€€€€€€€¥¹Ñ•É•ÍÐ°(€€€€€€€€€™½ÉµÕ±„è¥¹Ñ•É•ÍÑ½ÉµÕ±…Q•áÐ¡‰…±…¹”°µ½¹Ñ¡±åI…Ñ”°‘…åÌ¤°(€€€€€€€ô¤ì(€€€€€ô(€€€ô(€€€‰…±…¹”€ô5…Ñ ¹µ…à À°‰…±…¹”€´Á…åµ•¹Ñµ½Õ¹Ð¤ì(€€€Á…åµ•¹ÑM¡•‘Õ±”¹ÁÕÍ ¡ì(€€€€€€¸¸¹Á…åµ•¹Ð°(€€€€€‰…±…¹•™Ñ•Èè‰…±…¹”°(€€€€€¹½Ñ”èÁ…åµ•¹Ñµ½Õ¹Ð€ð9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤€ü€A…åµ•¹Ð•á••‘ÌÉ•µ…¥¹¥¹œ‰…±…¹”œ€è€œœ°(€€€ô¤ì(€€€±…ÍÑ…Ñ”€ôÁ…åµ•¹Ð¹‘…Ñ•=¹±äì(€ô(€½¹ÍÐÕÉÉ•¹ÑI••¥Ù…‰±”€ô¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡ÍÑ•´¹I••¥Ù…‰±•}	…±…¹•}}Œ¤ì(€¥˜€¡ÕÉÉ•¹ÑI••¥Ù…‰±”€„ô¹Õ±°€˜˜ÕÉÉ•¹ÑI••¥Ù…‰±”€øô€À¤‰…±…¹”€ô5…Ñ ¹µ¥¸¡‰…±…¹”°ÕÉÉ•¹ÑI••¥Ù…‰±”¤ì(€¥˜€¡‰…±…¹”€ø€À€˜˜Ñ½‘…ä€ø±…ÍÑ…Ñ”¤ì(€€€½¹ÍÐ‘…åÌ€ô5…Ñ ¹µ…à À°‘…åÍ	•ÑÝ••¸¡±…ÍÑ…Ñ”°Ñ½‘…ä¤¤ì(€€€¥˜€¡‘…åÌ€ø€À¤ì(€€€€€½¹ÍÐ¥¹Ñ•É•ÍÐ€ô‰…±…¹”€¨µ½¹Ñ¡±åI…Ñ”€¨€¡‘…åÌ€¼€ÌÀ¤ì(€€€€€Í•µ•¹ÑÌ¹ÁÕÍ ¡ì(€€€€€€€™É½µ…Ñ”è±…ÍÑ…Ñ”°(€€€€€€€Ñ½…Ñ”èÑ½‘…ä°(€€€€€€€‰…±…¹”°(€€€€€€€‘…åÌ°(€€€€€€€É…Ñ••¥µ…°èµ½¹Ñ¡±åI…Ñ”°(€€€€€€€¥¹Ñ•É•ÍÐ°(€€€€€€€™½ÉµÕ±„è¥¹Ñ•É•ÍÑ½ÉµÕ±…Q•áÐ¡‰…±…¹”°µ½¹Ñ¡±åI…Ñ”°‘…åÌ¤°(€€€€€€€¹½Ñ”è€ÕÉÉ•¹ÐÕ¹Á…¥‰…±…¹”Ñ¼É•ÅÕ•ÍÐ‘…Ñ”œ°(€€€€€ô¤ì(€€€ô(€ô((€½¹ÍÐÑ½Ñ…±%¹Ñ•É•ÍÐ€ôÍ•µ•¹ÑÌ¹É•‘Õ” ¡ÍÕ´°Í•µ•¹Ð¤€ôøÍÕ´€¬9Õµ‰•È¡Í•µ•¹Ð¹¥¹Ñ•É•ÍÐñð€À¤°€À¤ì(€É•ÑÕÉ¸ì(€€€ÍÑ•´°(€€€‰Õå•É9…µ”è¥¹½µ¥¹A…åµ•¹Ñ	Õå•É9…µ”¡ÍÑ•´¤°(€€€‰Õå•ÉÉ½ÕÁ9…µ”è¥¹½µ¥¹A…åµ•¹Ñ	Õå•ÉÉ½ÕÀ¡ÍÑ•´¤°(€€€ÍÑ•µ9…µ”è™½Éµ…ÑMÑ•µ9…µ”¡ÍÑ•´¤°(€€€‘Õ•…Ñ”°(€€€¥¹Ù½¥•µ½Õ¹Ð°(€€€É••¥Ù…‰±•	…±…¹”èÕÉÉ•¹ÑI••¥Ù…‰±”°(€€€¥¹Ñ•É•ÍÑI…Ñ•¥•±è¥¹Ñ•É•ÍÑ¥•±(€€€€€€üì(€€€€€€€€€¹…µ”è¥¹Ñ•É•ÍÑ¥•±¹¹…µ”°(€€€€€€€€€±…‰•°è¥¹Ñ•É•ÍÑ¥•±¹±…‰•°ñð¥¹Ñ•É•ÍÑ¥•±¹¹…µ”°(€€€€€€€ô(€€€€€€è¹Õ±°°(€€€É…Ý%¹Ñ•É•ÍÑI…Ñ”èÉ…ÝI…Ñ”°(€€€µ½¹Ñ¡±åI…Ñ”°(€€€É…Ñ•]…É¹¥¹œ°(€€€Á…åµ•¹ÑM¡•‘Õ±”°(€€€Í•µ•¹ÑÌ°(€€€Ñ½Ñ…±%¹Ñ•É•ÍÐ°(€ôì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ…±Õ±…Ñ¥½¹!Ñµ°¡…±Õ±…Ñ¥½¸¤ì(€½¹ÍÐÍ•µ•¹ÑI½ÝÌ€ô€¡…±Õ±…Ñ¥½¸¹Í•µ•¹ÑÌñðmt¤(€€€€¹µ…À (€€€€€€¡Í•µ•¹Ð¤€ôø€(€€€€ñÑÈø(€€€€€€ñÑÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íÁÉ•ÑÑå…Ñ”¡Í•µ•¹Ð¹™É½µ…Ñ”¥ôÑ¼€‘íÁÉ•ÑÑå…Ñ”¡Í•µ•¹Ð¹Ñ½…Ñ”¥ôð½Ñø(€€€€€€ñÑÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íµ½¹•ä¡Í•µ•¹Ð¹‰…±…¹”¥ôð½Ñø(€€€€€€ñÑÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íÍ•µ•¹Ð¹‘…åÍôð½Ñø(€€€€€€ñÑÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàˆø‘í•Í…Á•!Ñµ°¡Í•µ•¹Ð¹™½ÉµÕ±„¥ôð½Ñø(€€€€€€ñÑÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡Ðí™½¹ÐµÝ•¥¡ÐèÜÀÀíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íµ½¹•ä¡Í•µ•¹Ð¹¥¹Ñ•É•ÍÐ¥ôð½Ñø(€€€€ð½ÑÈù€°(€€€€¤(€€€€¹©½¥¸ œœ¤ì(€½¹ÍÐÁ…åµ•¹ÑI½ÝÌ€ô€¡…±Õ±…Ñ¥½¸¹Á…åµ•¹ÑM¡•‘Õ±”ñðmt¤(€€€€¹µ…À (€€€€€€¡Á…åµ•¹Ð¤€ôø€(€€€€ñÑÈø(€€€€€€ñÑÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íÁÉ•ÑÑå…Ñ”¡Á…åµ•¹Ð¹Á…åµ•¹Ñ…Ñ”¥ôð½Ñø(€€€€€€ñÑÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàˆø‘í•Í…Á•!Ñµ°¡Á…åµ•¹Ð¹¹…µ”ñðÁ…åµ•¹Ð¹¥ñð€œ´œ¥ôð½Ñø(€€€€€€ñÑÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íµ½¹•ä¡Á…åµ•¹Ð¹…µ½Õ¹Ð¥ôð½Ñø(€€€€€€ñÑÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íµ½¹•ä¡Á…åµ•¹Ð¹‰…±…¹•™Ñ•È¥ôð½Ñø(€€€€ð½ÑÈù€°(€€€€¤(€€€€¹©½¥¸ œœ¤ì(€É•ÑÕÉ¸€(€€€€ñ‘¥ØÍÑå±”ô‰µ…É¥¸µÑ½ÀèÄÙÁàˆø(€€€€€€ñ ÌÍÑå±”ô‰µ…É¥¸èÀ€À€áÁàí™½¹ÐµÍ¥é”èÄÕÁàˆù1…Ñ”A…åµ•¹Ð%¹Ñ•É•ÍÐ…±Õ±…Ñ¥½¸ð½ Ìø(€€€€€€‘í…±Õ±…Ñ¥½¸¹É…Ñ•]…É¹¥¹œ€ü€ñÀÍÑå±”ô‰µ…É¥¸èÀ€À€áÁàí½±½ÈèŒäÈÐÀÁ”í™½¹ÐµÝ•¥¡ÐèØÀÀˆø‘í•Í…Á•!Ñµ°¡…±Õ±…Ñ¥½¸¹É…Ñ•]…É¹¥¹œ¥ôð½Àù€€è€œô(€€€€€€ñÀÍÑå±”ô‰µ…É¥¸èÀ€À€áÁàí½±½ÈèŒØØÜÀàÔˆù½ÉµÕ±„è=ÕÑÍÑ…¹‘¥¹œ	…±…¹”à5½¹Ñ¡±ä%¹Ñ•É•ÍÐI…Ñ”à=Ù•É‘Õ”…åÌ€¼€ÌÀ¸ð½Àø(€€€€€€ñÑ…‰±”ÍÑå±”ô‰‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íÝ¥‘Ñ èÄÀÀ”íµ…àµÝ¥‘Ñ èàØÁÁàí™½¹ÐµÍ¥é”èÄÉÁàíµ…É¥¸µ‰½ÑÑ½´èÄÉÁàˆø(€€€€€€€€ñÑ‰½‘äø(€€€€€€€€€€ñÑÈøñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸é±•™Ðí½±½ÈèŒØØÜÀàÔíÁ…‘‘¥¹œèÕÁà€áÁàíÝ¥‘Ñ èÈÄÁÁàˆù	Õå•È¥¹Ù½¥”…µ½Õ¹Ðð½Ñ øñÑÍÑå±”ô‰Á…‘‘¥¹œèÕÁà€áÁàí™½¹ÐµÝ•¥¡ÐèÜÀÀˆø‘íµ½¹•ä¡…±Õ±…Ñ¥½¸¹¥¹Ù½¥•µ½Õ¹Ð¥ôð½Ñøð½ÑÈø(€€€€€€€€€€ñÑÈøñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸é±•™Ðí½±½ÈèŒØØÜÀàÔíÁ…‘‘¥¹œèÕÁà€áÁàˆù	Õå•È¥¹Ù½¥”‘Õ”‘…Ñ”ð½Ñ øñÑÍÑå±”ô‰Á…‘‘¥¹œèÕÁà€áÁàˆø‘íÁÉ•ÑÑå…Ñ”¡…±Õ±…Ñ¥½¸¹‘Õ•…Ñ”¥ôð½Ñøð½ÑÈø(€€€€€€€€€€ñÑÈøñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸é±•™Ðí½±½ÈèŒØØÜÀàÔíÁ…‘‘¥¹œèÕÁà€áÁàˆù½Õ¹Ð¥¹Ñ•É•ÍÐÉ…Ñ”ð½Ñ øñÑÍÑå±”ô‰Á…‘‘¥¹œèÕÁà€áÁàˆø‘í¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑI…Ñ•1…‰•°¡…±Õ±…Ñ¥½¸¹µ½¹Ñ¡±åI…Ñ”¥ô‘í…±Õ±…Ñ¥½¸¹¥¹Ñ•É•ÍÑI…Ñ•¥•±€ü€€ ‘í•Í…Á•!Ñµ°¡…±Õ±…Ñ¥½¸¹¥¹Ñ•É•ÍÑI…Ñ•¥•±¹±…‰•°¥ô¥€€è€œôð½Ñøð½ÑÈø(€€€€€€€€€€ñÑÈøñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸é±•™Ðí½±½ÈèŒØØÜÀàÔíÁ…‘‘¥¹œèÕÁà€áÁàˆù…±Õ±…Ñ•¥¹Ñ•É•ÍÐÑ½Ñ…°ð½Ñ øñÑÍÑå±”ô‰Á…‘‘¥¹œèÕÁà€áÁàí™½¹ÐµÍ¥é”èÄÕÁàí™½¹ÐµÝ•¥¡ÐèàÀÀí½±½ÈèŒÅ˜ÈäÌÜˆø‘íµ½¹•ä¡…±Õ±…Ñ¥½¸¹Ñ½Ñ…±%¹Ñ•É•ÍÐ¥ôð½Ñøð½ÑÈø(€€€€€€€€ð½Ñ‰½‘äø(€€€€€€ð½Ñ…‰±”ø(€€€€€€ñÑ…‰±”ÍÑå±”ô‰‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íÝ¥‘Ñ èÄÀÀ”íµ…àµÝ¥‘Ñ èäØÁÁàí™½¹ÐµÍ¥é”èÄÉÁàíµ…É¥¸µ‰½ÑÑ½´èÄÉÁàˆø(€€€€€€€€ñÑ¡•…øñÑÈÍÑå±”ô‰‰…­É½Õ¹è˜á™…™Œí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í™½¹ÐµÍ¥é”èÄÅÁàˆøñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸é±•™ÐíÁ…‘‘¥¹œèÝÁà€áÁàˆùA•É¥½ð½Ñ øñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸éÉ¥¡ÐíÁ…‘‘¥¹œèÝÁà€áÁàˆù	…±…¹”ð½Ñ øñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸éÉ¥¡ÐíÁ…‘‘¥¹œèÝÁà€áÁàˆù…åÌð½Ñ øñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸é±•™ÐíÁ…‘‘¥¹œèÝÁà€áÁàˆù½ÉµÕ±„ð½Ñ øñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸éÉ¥¡ÐíÁ…‘‘¥¹œèÝÁà€áÁàˆù%¹Ñ•É•ÍÐð½Ñ øð½ÑÈøð½Ñ¡•…ø(€€€€€€€€ñÑ‰½‘äø‘íÍ•µ•¹ÑI½ÝÌñð€œñÑÈøñÑ½±ÍÁ…¸ôˆÔˆÍÑå±”ô‰Á…‘‘¥¹œèÄÉÁàíÑ•áÐµ…±¥¸é•¹Ñ•Èí½±½ÈèŒØØÜÀàÔˆù9¼½Ù•É‘Õ”¥¹Ñ•É•ÍÐÍ•µ•¹ÐÝ…Ì…±Õ±…Ñ•¸ð½Ñøð½ÑÈøôð½Ñ‰½‘äø(€€€€€€ð½Ñ…‰±”ø(€€€€€€ñÑ…‰±”ÍÑå±”ô‰‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íÝ¥‘Ñ èÄÀÀ”íµ…àµÝ¥‘Ñ èàØÁÁàí™½¹ÐµÍ¥é”èÄÉÁàˆø(€€€€€€€€ñÑ¡•…øñÑÈÍÑå±”ô‰‰…­É½Õ¹è˜á™…™Œí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í™½¹ÐµÍ¥é”èÄÅÁàˆøñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸é±•™ÐíÁ…‘‘¥¹œèÝÁà€áÁàˆùA…åµ•¹Ð…Ñ”ð½Ñ øñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸é±•™ÐíÁ…‘‘¥¹œèÝÁà€áÁàˆùA…åµ•¹Ðð½Ñ øñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸éÉ¥¡ÐíÁ…‘‘¥¹œèÝÁà€áÁàˆùµ½Õ¹Ðð½Ñ øñÑ ÍÑå±”ô‰Ñ•áÐµ…±¥¸éÉ¥¡ÐíÁ…‘‘¥¹œèÝÁà€áÁàˆù	…±…¹”™Ñ•Èð½Ñ øð½ÑÈøð½Ñ¡•…ø(€€€€€€€€ñÑ‰½‘äø‘íÁ…åµ•¹ÑI½ÝÌñð€œñÑÈøñÑ½±ÍÁ…¸ôˆÐˆÍÑå±”ô‰Á…‘‘¥¹œèÄÉÁàíÑ•áÐµ…±¥¸é•¹Ñ•Èí½±½ÈèŒØØÜÀàÔˆù9¼‰Õå•ÈÁ…åµ•¹ÑÌÝ•É”™½Õ¹™½ÈÑ¡¥ÌMQ4¸ð½Ñøð½ÑÈøôð½Ñ‰½‘äø(€€€€€€ð½Ñ…‰±”ø(€€€€ð½‘¥Øù€ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ…±Õ±…Ñ¥½¹Q•áÐ¡…±Õ±…Ñ¥½¸¤ì(€É•ÑÕÉ¸l1…Ñ”A…åµ•¹Ð%¹Ñ•É•ÍÐ…±Õ±…Ñ¥½¸œ°½ÉµÕ±„è=ÕÑÍÑ…¹‘¥¹œ	…±…¹”à5½¹Ñ¡±ä%¹Ñ•É•ÍÐI…Ñ”à=Ù•É‘Õ”…åÌ€¼€ÌÁ€°…±Õ±…Ñ¥½¸¹É…Ñ•]…É¹¥¹œñð€œœ°	Õå•È¥¹Ù½¥”…µ½Õ¹Ðè€‘íµ½¹•ä¡…±Õ±…Ñ¥½¸¹¥¹Ù½¥•µ½Õ¹Ð¥õ€°	Õå•È¥¹Ù½¥”‘Õ”‘…Ñ”è€‘íÁÉ•ÑÑå…Ñ”¡…±Õ±…Ñ¥½¸¹‘Õ•…Ñ”¥õ€°½Õ¹Ð¥¹Ñ•É•ÍÐÉ…Ñ”è€‘í¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑI…Ñ•1…‰•°¡…±Õ±…Ñ¥½¸¹µ½¹Ñ¡±åI…Ñ”¥ô‘í…±Õ±…Ñ¥½¸¹¥¹Ñ•É•ÍÑI…Ñ•¥•±€ü€€ ‘í…±Õ±…Ñ¥½¸¹¥¹Ñ•É•ÍÑI…Ñ•¥•±¹±…‰•±ô¥€€è€œõ€°…±Õ±…Ñ•¥¹Ñ•É•ÍÐÑ½Ñ…°è€‘íµ½¹•ä¡…±Õ±…Ñ¥½¸¹Ñ½Ñ…±%¹Ñ•É•ÍÐ¥õ€°€œœ°€%¹Ñ•É•ÍÐÍ•µ•¹ÑÌèœ°€¸¸¸¡…±Õ±…Ñ¥½¸¹Í•µ•¹ÑÌñðmt¤¹µ…À ¡Í•µ•¹Ð¤€ôø€‘íÁÉ•ÑÑå…Ñ”¡Í•µ•¹Ð¹™É½µ…Ñ”¥ôÑ¼€‘íÁÉ•ÑÑå…Ñ”¡Í•µ•¹Ð¹Ñ½…Ñ”¥ôð€‘íÍ•µ•¹Ð¹™½ÉµÕ±…ô€ô€‘íµ½¹•ä¡Í•µ•¹Ð¹¥¹Ñ•É•ÍÐ¥õ€¤°€œœ°€	Õå•ÈÁ…åµ•¹ÐÍ¡•‘Õ±”èœ°€¸¸¸¡…±Õ±…Ñ¥½¸¹Á…åµ•¹ÑM¡•‘Õ±”ñðmt¤¹µ…À ¡Á…åµ•¹Ð¤€ôø€‘íÁÉ•ÑÑå…Ñ”¡Á…åµ•¹Ð¹Á…åµ•¹Ñ…Ñ”¥ôð€‘íÁ…åµ•¹Ð¹¹…µ”ñðÁ…åµ•¹Ð¹¥ñð€œ´ôðA…åµ•¹Ð€‘íµ½¹•ä¡Á…åµ•¹Ð¹…µ½Õ¹Ð¥ôð	…±…¹”…™Ñ•È€‘íµ½¹•ä¡Á…åµ•¹Ð¹‰…±…¹•™Ñ•È¥õ€¥t¹™¥±Ñ•È ¡±¥¹”¤€ôø±¥¹”€„ôô€œœ¤¹©½¥¸ q¸œ¤ì)ô()½¹ÍÐ%9=5%9}Ae59Q}%9QIMQ}1U1Q%=9}Q	1}AQQI8€ô€½qíqíqÌ©¥¹Ñ•É•ÍÑ…±Õ±…Ñ¥½¹Q…‰±•qÌ©qõqô½¤ì)½¹ÍÐ%9=5%9}Ae59Q}%9QIMQ}MQ5}1%9-}Q=-9}AQQI8€ô€½qíqíqÌ©ÍÑ•µ1¥¹­qÌ©qõqô½¤ì)½¹ÍÐU1Q}%9=5%9}Ae59Q}%9QIMQ}Q5A1Q€ôì(€Ñ¼èmt°(€Œèmt°(€‰Œèmt°(€ÍÕ‰©•Ðè€œœ°(€‰½‘äè€œœ°)ôì()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ•µÁ±…Ñ”¡¥¹ÁÕÐ€ôíô¤ì(€É•ÑÕÉ¸ì(€€€Ñ¼èMÑÉ¥¹œ¡¥¹ÁÕÐ¹Ñ¼€üüU1Q}%9=5%9}Ae59Q}%9QIMQ}Q5A1Q¹Ñ¼¤°(€€€ŒèMÑÉ¥¹œ¡¥¹ÁÕÐ¹Œ€üüU1Q}%9=5%9}Ae59Q}%9QIMQ}Q5A1Q¹Œ¤°(€€€‰ŒèMÑÉ¥¹œ¡¥¹ÁÕÐ¹‰Œ€üüU1Q}%9=5%9}Ae59Q}%9QIMQ}Q5A1Q¹‰Œ¤°(€€€ÍÕ‰©•ÐèMÑÉ¥¹œ¡¥¹ÁÕÐ¹ÍÕ‰©•ÐñðU1Q}%9=5%9}Ae59Q}%9QIMQ}Q5A1Q¹ÍÕ‰©•Ð¤°(€€€‰½‘äèMÑÉ¥¹œ¡¥¹ÁÕÐ¹‰½‘äñð¥¹ÁÕÐ¹¥¹ÑÉ¼ñðU1Q}%9=5%9}Ae59Q}%9QIMQ}Q5A1Q¹‰½‘ä¤°(€ôì)ô()™Õ¹Ñ¥½¸É•¹‘•É%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ•µÁ±…Ñ”¡Ù…±Õ”°½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤¹É•Á±…” ½qíqíqÌ¨¡mµi„µèÀ´å}t¬¥qÌ©qõqô½œ°€¡µ…Ñ °­•ä¤€ôø€¡=‰©•Ð¹ÁÉ½Ñ½ÑåÁ”¹¡…Í=Ý¹AÉ½Á•ÉÑä¹…±°¡½¹Ñ•áÐ°­•ä¤€ü½¹Ñ•áÑm­•åt€èµ…Ñ ¤¤ì)ô()™Õ¹Ñ¥½¸É•Á±…•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ½­•¸¡Í½ÕÉ”°Á…ÑÑ•É¸°É•Á±…•µ•¹Ð¤ì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Í½ÕÉ”ñð€œœ¤(€€€€¹É•Á±…”¡¹•ÜI•áÀ¡€ñÁqq‰mxùt¨ùqqÌ¨‘íÁ…ÑÑ•É¸¹Í½ÕÉ•õqqÌ¨ñqp½Àù€°€¤œ¤°É•Á±…•µ•¹Ð¤(€€€€¹É•Á±…”¡Á…ÑÑ•É¸°É•Á±…•µ•¹Ð¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑMÑ•µ1¥¹­!Ñµ°¡ÕÉ°¤ì(€É•ÑÕÉ¸€ñÀÍÑå±”ô‰µ…É¥¸èÀ€À€ÄÑÁàˆøñ„¡É•˜ôˆ‘í•Í…Á•!Ñµ°¡ÕÉ°¥ôˆÍÑå±”ô‰‘¥ÍÁ±…äé¥¹±¥¹”µ‰±½¬í‰½É‘•ÈµÉ…‘¥ÕÌèáÁàí‰…­É½Õ¹èŒÅ˜ÈäÌÜí½±½Èè™™™™™˜íÑ•áÐµ‘•½É…Ñ¥½¸é¹½¹”í™½¹ÐµÝ•¥¡ÐèÜÀÀíÁ…‘‘¥¹œèåÁà€ÄÍÁàˆù1¥¹¬Ñ¼MQ4ð½„øð½Àù€ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑMÑ•µ1¥¹­Q•áÐ¡ÕÉ°¤ì(€É•ÑÕÉ¸1¥¹¬Ñ¼MQ4è€‘íÕÉ±õ€ì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑµ…¥°¡‰½‘ä°ÁÉ½™¥±”°…±Õ±…Ñ¥½¸¤ì(€½¹ÍÐÉ•ÅÕ•ÍÑ•‘	ä€ôÁÉ½™¥±”ü¹™Õ±±}¹…µ”ñðÁÉ½™¥±”ü¹•µ…¥°ñð€1½•µ¥¸ÕÍ•Èœì(€½¹ÍÐÁ…åµ•¹Ñ9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ9…µ”ñð‰½‘ä¹Á…åµ•¹Ñ¥ÍÁ±…å9…µ”ñð‰½‘ä¹Í…±•Í™½É•A…åµ•¹Ñ9…µ”ñð‰½‘ä¹Á…åµ•¹Ñ%ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐÍÑ•µ9…µ”€ô…±Õ±…Ñ¥½¸ü¹ÍÑ•µ9…µ”ñðMÑÉ¥¹œ¡‰½‘ä¹ÍÑ•µ9…µ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐ‰Õå•É9…µ”€ô…±Õ±…Ñ¥½¸ü¹‰Õå•É9…µ”ñðMÑÉ¥¹œ¡‰½‘ä¹‰Õå•É9…µ”ñð‰½‘ä¹Á…ÉÑå9…µ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐ‰Õå•ÉÉ½ÕÁ9…µ”€ô…±Õ±…Ñ¥½¸ü¹‰Õå•ÉÉ½ÕÁ9…µ”ñðMÑÉ¥¹œ¡‰½‘ä¹‰Õå•ÉÉ½ÕÁ9…µ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐÉ••¥Ù•‘…Ñ”€ôÁÉ•ÑÑå…Ñ”¡‰½‘ä¹Á…åµ•¹Ñ…Ñ”ñð‰½‘ä¹É••¥Ù•‘…Ñ”¤ì(€½¹ÍÐ¥¹Í•ÉÑ•‘…Ñ”€ô‰½‘ä¹É•…Ñ•‘…Ñ”€˜˜‘…Ñ•=¹±ä¡‰½‘ä¹É•…Ñ•‘…Ñ”¤€„ôô‘…Ñ•=¹±ä¡‰½‘ä¹Á…åµ•¹Ñ…Ñ”ñð‰½‘ä¹É••¥Ù•‘…Ñ”¤€üÁÉ•ÑÑå…Ñ”¡‰½‘ä¹É•…Ñ•‘…Ñ”¤€è€œœì(€½¹ÍÐ‘•±…å1…‰•°€ô‰½‘ä¹‘•±…å…åÌ€ôô¹Õ±°€ü€œ´œ€è€‘í9Õµ‰•È¡‰½‘ä¹‘•±…å…åÌ¤¹Ñ½1½…±•MÑÉ¥¹œ ¥ô…åÍ€ì(€½¹ÍÐ½¹Ñ•áÐ€ôì(€€€É•ÅÕ•ÍÑ•‘	ä°(€€€É•ÅÕ•ÍÑ•Éµ…¥°èÁÉ½™¥±”ü¹•µ…¥°ñð€œœ°(€€€‰Õå•É9…µ”è‰Õå•É9…µ”ñð€œ´œ°(€€€‰Õå•ÉÉ½ÕÁ9…µ”è‰Õå•ÉÉ½ÕÁ9…µ”ñð€œ´œ°(€€€ÍÑ•µ9…µ”èÍÑ•µ9…µ”ñð€œ´œ°(€€€Á…åµ•¹Ñ9…µ”èÁ…åµ•¹Ñ9…µ”ñð‰½‘ä¹Á…åµ•¹Ñ%ñð€œ´œ°(€€€É••¥Ù•‘…Ñ”°(€€€¥¹Í•ÉÑ•‘…Ñ”°(€€€‘•±…å…åÌè‘•±…å1…‰•°°(€€€Á…åµ•¹Ñµ½Õ¹Ðèµ½¹•ä¡‰½‘ä¹…µ½Õ¹Ð¤°(€€€É••¥Ù…‰±•	…±…¹”èµ½¹•ä¡…±Õ±…Ñ¥½¸ü¹É••¥Ù…‰±•	…±…¹”€üü‰½‘ä¹É••¥Ù…‰±•	…±…¹”¤°(€€€¥¹Ù½¥•µ½Õ¹Ðèµ½¹•ä¡…±Õ±…Ñ¥½¸ü¹¥¹Ù½¥•µ½Õ¹Ð€üü‰½‘ä¹¥¹Ù½¥•µ½Õ¹Ð¤°(€€€¥¹Ù½¥•Õ•…Ñ”è…±Õ±…Ñ¥½¸ü¹‘Õ•…Ñ”€üÁÉ•ÑÑå…Ñ”¡…±Õ±…Ñ¥½¸¹‘Õ•…Ñ”¤€è€œ´œ°(€€€¥¹Ñ•É•ÍÑI…Ñ”è¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑI…Ñ•1…‰•°¡…±Õ±…Ñ¥½¸ü¹µ½¹Ñ¡±åI…Ñ”¤°(€€€¥¹Ñ•É•ÍÑI…Ñ•¥•±è…±Õ±…Ñ¥½¸ü¹¥¹Ñ•É•ÍÑI…Ñ•¥•±ü¹±…‰•°ñð…±Õ±…Ñ¥½¸ü¹¥¹Ñ•É•ÍÑI…Ñ•¥•±ü¹¹…µ”ñð€œœ°(€€€¥¹Ñ•É•ÍÑQ½Ñ…°èµ½¹•ä¡…±Õ±…Ñ¥½¸ü¹Ñ½Ñ…±%¹Ñ•É•ÍÐ¤°(€ôì(€½¹ÍÐÑ•µÁ±…Ñ”€ô¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ•µÁ±…Ñ”¡‰½‘ä¹É•Á½ÉÑM•ÑÑ¥¹Ìñðíô¤ì(€½¹ÍÐÍÑ•µUÉ°€ô¥¹½µ¥¹A…åµ•¹ÑMÑ•µUÉ°¡íô°…±Õ±…Ñ¥½¸ü¹ÍÑ•´ü¹%ñð‰½‘ä¹ÍÑ•µ%¤ì(€½¹ÍÐÑ¼€ôÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É•¹‘•É%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ•µÁ±…Ñ”¡Ñ•µÁ±…Ñ”¹Ñ¼°½¹Ñ•áÐ¤¤ì(€½¹ÍÐŒ€ôÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É•¹‘•É%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ•µÁ±…Ñ”¡Ñ•µÁ±…Ñ”¹Œ°½¹Ñ•áÐ¤¤ì(€½¹ÍÐ‰Œ€ôÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É•¹‘•É%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ•µÁ±…Ñ”¡Ñ•µÁ±…Ñ”¹‰Œ°½¹Ñ•áÐ¤¤ì(€½¹ÍÐÍÕ‰©•Ð€ôÉ•¹‘•É%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ•µÁ±…Ñ”¡Ñ•µÁ±…Ñ”¹ÍÕ‰©•Ð°½¹Ñ•áÐ¤ì(€½¹ÍÐ‰½‘å½¹Ñ•¹Ð€ôÉ•¹‘•É%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ•µÁ±…Ñ”¡Ñ•µÁ±…Ñ”¹‰½‘ä°½¹Ñ•áÐ¤ì(€½¹ÍÐ‰½‘åQ•áÐ€ô¡…Í!Ñµ±5…É­ÕÀ¡‰½‘å½¹Ñ•¹Ð¤€ü¡Ñµ±Q½A±…¥¹Q•áÐ¡‰½‘å½¹Ñ•¹Ð¤€è‰½‘å½¹Ñ•¹Ðì(€½¹ÍÐ…±Õ±…Ñ¥½¹!Ñµ°€ô…±Õ±…Ñ¥½¸€ü¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ…±Õ±…Ñ¥½¹!Ñµ°¡…±Õ±…Ñ¥½¸¤€è€œœì(€½¹ÍÐ…±Õ±…Ñ¥½¹Q•áÐ€ô…±Õ±…Ñ¥½¸€ü¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ…±Õ±…Ñ¥½¹Q•áÐ¡…±Õ±…Ñ¥½¸¤€è€œœì(€½¹ÍÐ¡Ñµ±	½‘ä€ôÉ•Á±…•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ½­•¸¡•µ…¥±½¹Ñ•¹Ñ!Ñµ°¡‰½‘å½¹Ñ•¹Ð¤°%9=5%9}Ae59Q}%9QIMQ}MQ5}1%9-}Q=-9}AQQI8°¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑMÑ•µ1¥¹­!Ñµ°¡ÍÑ•µUÉ°¤¤(€€€€¹É•Á±…” ¼ñÁq‰mxùt¨ùqÌ©qíqíqÌ©¥¹Ñ•É•ÍÑ…±Õ±…Ñ¥½¹Q…‰±•qÌ©qõqõqÌ¨ñp½Àø½¤°…±Õ±…Ñ¥½¹!Ñµ°¤(€€€€¹É•Á±…”¡%9=5%9}Ae59Q}%9QIMQ}1U1Q%=9}Q	1}AQQI8°…±Õ±…Ñ¥½¹!Ñµ°¤ì(€½¹ÍÐÑ•áÑ	½‘ä€ôÉ•Á±…•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ½­•¸¡‰½‘åQ•áÐ°%9=5%9}Ae59Q}%9QIMQ}MQ5}1%9-}Q=-9}AQQI8°¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑMÑ•µ1¥¹­Q•áÐ¡ÍÑ•µUÉ°¤¤¹É•Á±…”¡%9=5%9}Ae59Q}%9QIMQ}1U1Q%=9}Q	1}AQQI8°…±Õ±…Ñ¥½¹Q•áÐ¤ì(€½¹ÍÐ¡Ñµ°€ô€(€€€€ñ‘¥ØÍÑå±”ô‰™½¹Ðµ™…µ¥±äé%¹Ñ•È±É¥…°±Í…¹ÌµÍ•É¥˜í½±½ÈèŒÅ˜ÈäÌÜí±¥¹”µ¡•¥¡ÐèÄ¸ÐÔˆø(€€€€€€‘í¡Ñµ±	½‘åô(€€€€ð½‘¥Øù€ì(€É•ÑÕÉ¸ìÑ¼°Œ°‰Œ°ÍÕ‰©•Ð°¡Ñµ°°Ñ•áÐèÑ•áÑ	½‘äôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ%¹Ù½¥•I•ÅÕ•ÍÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐÁ…åµ•¹Ñ%€ôMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ%ñð‰½‘ä¹Á…åµ•¹Ñ}¥ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …Á…åµ•¹Ñ%¤Ñ¡É½Ü…ÁÁÉÉ½È Á…åµ•¹Ñ%¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì((€½¹ÍÐ‘•±…å…åÌ€ô9Õµ‰•È¡‰½‘ä¹‘•±…å…åÌ€üü‰½‘ä¹‘•±…å}‘…åÌ¤ì(€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡‘•±…å…åÌ¤ñð‘•±…å…åÌ€ðô€Ì¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È 1…Ñ”Á…åµ•¹Ð¥¹Ñ•É•ÍÐ¥¹Ù½¥”É•ÅÕ•ÍÐ¥Ì½¹±ä…Ù…¥±…‰±”™½È‰Õå•ÈÁ…åµ•¹ÑÌ‘•±…å•µ½É”Ñ¡…¸€Ì‘…åÌ¸œ°€ÐÀÀ¤ì(€ô((€½¹ÍÐ•á¥ÍÑ¥¹œ€ô…Ý…¥Ð™•Ñ¡%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¸¡±¥•¹Ð°Á…åµ•¹Ñ%¤ì(€½¹ÍÐ™½É•I•Í•¹€ô‰½‘ä¹™½É”€ôôôÑÉÕ”ñð‰½‘ä¹½¹™¥ÉµI•Í•¹€ôôôÑÉÕ”ñð‰½‘ä¹…±±½ÝI•Í•¹€ôôôÑÉÕ”ì(€¥˜€¡•á¥ÍÑ¥¹œ€˜˜€…™½É•I•Í•¹¤ì(€€€½¹ÍÐ‘•±¥Ù•ÉåU¹•ÉÑ…¥¸€ôlÍ•¹‘¥¹œœ°€Õ¹•ÉÑ…¥¸t¹¥¹±Õ‘•Ì¡•á¥ÍÑ¥¹œ¹‘•±¥Ù•ÉåMÑ…ÑÕÌ¤ì(€€€É•ÑÕÉ¸ì(€€€€€Í•¹Ðè™…±Í”°(€€€€€…±É•…‘åM•¹Ðè•á¥ÍÑ¥¹œ¹‘•±¥Ù•ÉåMÑ…ÑÕÌ€ôôô€Í•¹Ðœ°(€€€€€‘•±¥Ù•ÉåU¹•ÉÑ…¥¸°(€€€€€É•ÅÕ¥É•Í½¹™¥Éµ…Ñ¥½¸èÑÉÕ”°(€€€€€¹½Ñ¥™¥…Ñ¥½¸è•á¥ÍÑ¥¹œ°(€€€ôì(€ô((€½¹ÍÐÉ•Á½ÉÑM•ÑÑ¥¹Ì€ô…Ý…¥Ð±½…‘¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}É•ÅÕ•ÍÑÌœ°ìÉ•ÅÕ¥É•èÑÉÕ”ô¤ì(€¥˜€ …MÑÉ¥¹œ¡É•Á½ÉÑM•ÑÑ¥¹Ì¹Í•ÑÑ¥¹Ìü¹ÍÕ‰©•Ðñð€œœ¤¹ÑÉ¥´ ¤ñð€…MÑÉ¥¹œ¡É•Á½ÉÑM•ÑÑ¥¹Ì¹Í•ÑÑ¥¹Ìü¹‰½‘äñð€œœ¤¹ÑÉ¥´ ¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È 1…Ñ”Á…åµ•¹Ð¥¹Ñ•É•ÍÐÉ•ÅÕ•ÍÐÍÕ‰©•Ð…¹‰½‘ä…É”¹½Ð½¹™¥ÕÉ•¸M•¹‘¥¹œ¥Ì‘¥Í…‰±•¸œ°€ÔÀÌ°€%99%1}IA=IQ}Q5A1Q}9=Q}=9%UIœ°Õ¹‘•™¥¹•°ÑÉÕ”¤ì(€ô(€½¹ÍÐ…±Õ±…Ñ¥½¸€ô…Ý…¥Ð¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ…±Õ±…Ñ¥½¸¡ì€¸¸¹‰½‘ä°‘•±…å…åÌ°Á…åµ•¹Ñ%ô°…•ÍÍ½¹Ñ•áÐ¤ì(€½¹ÍÐ•µ…¥°€ô‰Õ¥±‘%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑµ…¥°¡ì€¸¸¹‰½‘ä°‘•±…å…åÌ°Á…åµ•¹Ñ%°É•Á½ÉÑM•ÑÑ¥¹ÌèÉ•Á½ÉÑM•ÑÑ¥¹Ì¹Í•ÑÑ¥¹Ìô°ÁÉ½™¥±”°…±Õ±…Ñ¥½¸¤ì(€¥˜€ …½Á•É…Ñ¥½¹…±5…¥±•±¥Ù•ÉåÙ…¥±…‰±” ¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡”½Á•É…Ñ¥½¹…°•µ…¥°Í•¹‘•È¥ÌÕ¹…Ù…¥±…‰±”¸Í¬…¸…‘µ¥¹¥ÍÑÉ…Ñ½ÈÑ¼¡•¬M•ÑÑ¥¹Ì€øMåÍÑ•´!•…±Ñ ¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐµ…¥±½¹™¥œ€ô½Á•É…Ñ¥½¹…±5…¥±½¹™¥œ ¤ì(€½¹ÍÐÉ•¥Á¥•¹ÑÌ€ô•µ…¥°¹Ñ¼ì(€¥˜€ …É•¥Á¥•¹ÑÌ¹±•¹Ñ ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È 1…Ñ”Á…åµ•¹Ð¥¹Ñ•É•ÍÐÉ•ÅÕ•ÍÐÉ•¥Á¥•¹Ð¥Ì¹½Ð½¹™¥ÕÉ•¸‘…Ð±•…ÍÐ½¹”Q¼É•¥Á¥•¹Ð¥¸Ñ¡”Ñ•µÁ±…Ñ”¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐÍ•¹‘•ÉM¹…ÁÍ¡½Ð€ô•á¥ÍÑ¥¹œü¹Í•¹‘•É5…¥±‰½áM¹…ÁÍ¡½Ð(€€€€üì¥è•á¥ÍÑ¥¹œ¹Í•¹‘•É5…¥±‰½á%ñð¹Õ±°°•µ…¥±‘‘É•ÍÌè•á¥ÍÑ¥¹œ¹Í•¹‘•É5…¥±‰½áM¹…ÁÍ¡½Ðô(€€€€è…Ý…¥ÐÉ•Í½±Ù•É…Á¡µ…¥±M•¹‘•È¡±¥•¹Ð°€¥¹½µ¥¹}Á…åµ•¹Ñ}É•Á½ÉÑÌœ¤¹Ñ¡•¸ ¡Í•¹‘•È¤€ôø€¡ì(€€€€€€€¥èÍ•¹‘•È¹µ…¥±‰½á%°(€€€€€€€•µ…¥±‘‘É•ÍÌèÍ•¹‘•È¹•µ…¥±‘‘É•ÍÌ°(€€€€€ô¤¤ì(€½¹ÍÐ…ÑÑ•µÁÑÐ€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€½¹ÍÐÁ…å±½…€ôì(€€€Á…åµ•¹Ñ}¥èÁ…åµ•¹Ñ%°(€€€Á…åµ•¹Ñ}¹…µ”èMÑÉ¥¹œ¡‰½‘ä¹Á…åµ•¹Ñ9…µ”ñð‰½‘ä¹Á…åµ•¹Ñ¥ÍÁ±…å9…µ”ñð‰½‘ä¹Í…±•Í™½É•A…åµ•¹Ñ9…µ”ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€ÍÑ•µ}¥èMÑÉ¥¹œ¡‰½‘ä¹ÍÑ•µ%ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€ÍÑ•µ}¹…µ”è…±Õ±…Ñ¥½¸¹ÍÑ•µ9…µ”ñðMÑÉ¥¹œ¡‰½‘ä¹ÍÑ•µ9…µ”ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€‰Õå•É}¹…µ”è…±Õ±…Ñ¥½¸¹‰Õå•É9…µ”ñðMÑÉ¥¹œ¡‰½‘ä¹‰Õå•É9…µ”ñð‰½‘ä¹Á…ÉÑå9…µ”ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€‰Õå•É}É½ÕÁ}¹…µ”è…±Õ±…Ñ¥½¸¹‰Õå•ÉÉ½ÕÁ9…µ”ñðMÑÉ¥¹œ¡‰½‘ä¹‰Õå•ÉÉ½ÕÁ9…µ”ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€É••¥Ù•‘}‘…Ñ”è¥¹½µ¥¹A…åµ•¹Ñ‰…Ñ”¡‰½‘ä¹Á…åµ•¹Ñ…Ñ”ñð‰½‘ä¹É••¥Ù•‘…Ñ”¤°(€€€Á…åµ•¹Ñ}É•…Ñ•‘}‘…Ñ”è¥¹½µ¥¹A…åµ•¹Ñ‰…Ñ”¡‰½‘ä¹É•…Ñ•‘…Ñ”¤°(€€€‘•±…å}‘…åÌè5…Ñ ¹ÑÉÕ¹Œ¡‘•±…å…åÌ¤°(€€€…µ½Õ¹Ðè¥¹½µ¥¹A…åµ•¹Ñ‰9Õµ‰•È¡‰½‘ä¹…µ½Õ¹Ð¤°(€€€ÕÉÉ•¹äèMÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹äñð€UMœ¤¹ÑÉ¥´ ¤ñð€UMœ°(€€€É••¥Ù…‰±•}‰…±…¹”è¥¹½µ¥¹A…åµ•¹Ñ‰9Õµ‰•È¡…±Õ±…Ñ¥½¸¹É••¥Ù…‰±•	…±…¹”€üü‰½‘ä¹É••¥Ù…‰±•	…±…¹”¤°(€€€É•¥Á¥•¹Ñ}•µ…¥°èÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É•¥Á¥•¹ÑÌ°•µ…¥°¹Œ°•µ…¥°¹‰Œ¤¹©½¥¸ œ°€œ¤°(€€€•µ…¥±}ÍÕ‰©•Ðè•µ…¥°¹ÍÕ‰©•Ð°(€€€•µ…¥±}µ•ÍÍ…•}¥è¹Õ±°°(€€€•µ…¥±}ÁÉ½Ù¥‘•Èèµ…¥±½¹™¥œ¹‘•±¥Ù•Éå5•Ñ¡½°(€€€…Ñ½É}ÕÍ•É}¥èÁÉ½™¥±”¹¥°(€€€…Ñ½É}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€…Ñ½É}¹…µ”èÁÉ½™¥±”¹™Õ±±}¹…µ”ñðÁÉ½™¥±”¹•µ…¥°ñð¹Õ±°°(€€€‘•±¥Ù•Éå}ÍÑ…ÑÕÌè€Í•¹‘¥¹œœ°(€€€Í•¹‘•É}µ…¥±‰½á}¥èÍ•¹‘•ÉM¹…ÁÍ¡½Ð¹¥°(€€€Í•¹‘•É}µ…¥±‰½á}Í¹…ÁÍ¡½ÐèÍ•¹‘•ÉM¹…ÁÍ¡½Ð¹•µ…¥±‘‘É•ÍÌ°(€€€±…ÍÑ}…ÑÑ•µÁÑ}…Ðè…ÑÑ•µÁÑÐ°(€€€±…ÍÑ}•ÉÉ½Èè¹Õ±°°(€€€Í•¹Ñ}…Ðè¹Õ±°°(€€€ÕÁ‘…Ñ•‘}…Ðè…ÑÑ•µÁÑÐ°(€€€µ•Ñ…‘…Ñ„èì(€€€€€Í½ÕÉ”è€¥¹½µ¥¹}Á…åµ•¹Ðœ°(€€€€€‘•±…åQ¡É•Í¡½±‘…åÌè€Ì°(€€€€€É•ÅÕ•ÍÑ•‘ÑQ¥µ•é½¹”è€Í¥„½!½¹}-½¹œœ°(€€€€€É•Í•¹Ðè	½½±•…¸¡•á¥ÍÑ¥¹œ¤°(€€€€€É•Í•¹‘½Õ¹Ðè9Õµ‰•È¡•á¥ÍÑ¥¹œü¹µ•Ñ…‘…Ñ„ü¹É•Í•¹‘½Õ¹Ðñð€À¤€¬€¡•á¥ÍÑ¥¹œ€ü€Ä€è€À¤°(€€€€€ÁÉ•Ù¥½ÕÍI•ÅÕ•ÍÐè•á¥ÍÑ¥¹œ(€€€€€€€€üì(€€€€€€€€€€€Í•¹ÑÐè•á¥ÍÑ¥¹œ¹Í•¹ÑÐñð¹Õ±°°(€€€€€€€€€€€…Ñ½Éµ…¥°è•á¥ÍÑ¥¹œ¹…Ñ½Éµ…¥°ñð¹Õ±°°(€€€€€€€€€€€É•¥Á¥•¹Ñµ…¥°è•á¥ÍÑ¥¹œ¹É•¥Á¥•¹Ñµ…¥°ñð¹Õ±°°(€€€€€€€€€€€•µ…¥±MÕ‰©•Ðè•á¥ÍÑ¥¹œ¹•µ…¥±MÕ‰©•Ðñð¹Õ±°°(€€€€€€€€€ô(€€€€€€€€è¹Õ±°°(€€€€€¥¹Ñ•É•ÍÑ…±Õ±…Ñ¥½¸èì(€€€€€€€¥¹Ù½¥•µ½Õ¹Ðè…±Õ±…Ñ¥½¸¹¥¹Ù½¥•µ½Õ¹Ð°(€€€€€€€‘Õ•…Ñ”è…±Õ±…Ñ¥½¸¹‘Õ•…Ñ”°(€€€€€€€¥¹Ñ•É•ÍÑI…Ñ•¥•±è…±Õ±…Ñ¥½¸¹¥¹Ñ•É•ÍÑI…Ñ•¥•±°(€€€€€€€É…Ý%¹Ñ•É•ÍÑI…Ñ”è…±Õ±…Ñ¥½¸¹É…Ý%¹Ñ•É•ÍÑI…Ñ”°(€€€€€€€µ½¹Ñ¡±åI…Ñ”è…±Õ±…Ñ¥½¸¹µ½¹Ñ¡±åI…Ñ”°(€€€€€€€É…Ñ•]…É¹¥¹œè…±Õ±…Ñ¥½¸¹É…Ñ•]…É¹¥¹œ°(€€€€€€€Ñ½Ñ…±%¹Ñ•É•ÍÐè…±Õ±…Ñ¥½¸¹Ñ½Ñ…±%¹Ñ•É•ÍÐ°(€€€€€€€Í•µ•¹ÑÌè…±Õ±…Ñ¥½¸¹Í•µ•¹ÑÌ°(€€€€€€€Á…åµ•¹ÑM¡•‘Õ±”è…±Õ±…Ñ¥½¸¹Á…åµ•¹ÑM¡•‘Õ±”°(€€€€€ô°(€€€ô°(€ôì((€½¹ÍÐÉ•Í•ÉÙ•EÕ•Éä€ô•á¥ÍÑ¥¹œ€ü±¥•¹Ð¹™É½´ ¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}¹½Ñ¥™¥…Ñ¥½¹Ìœ¤¹ÕÁ‘…Ñ”¡Á…å±½…¤¹•Ä Á…åµ•¹Ñ}¥œ°Á…åµ•¹Ñ%¤€è±¥•¹Ð¹™É½´ ¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}¹½Ñ¥™¥…Ñ¥½¹Ìœ¤¹¥¹Í•ÉÐ¡Á…å±½…¤ì(€½¹ÍÐì‘…Ñ„èÉ•Í•ÉÙ•°•ÉÉ½ÈèÉ•Í•ÉÙ•ÉÉ½Èô€ô…Ý…¥ÐÉ•Í•ÉÙ•EÕ•Éä¹Í•±•Ð¡%9=5%9}Ae59Q}%9QIMQ}9=Q%%Q%=9}%1L¤¹Í¥¹±” ¤ì(€¥˜€¡É•Í•ÉÙ•ÉÉ½È¤Ñ¡É½ÜÉ•Í•ÉÙ•ÉÉ½Èì((€±•ÐÉ•ÍÕ±Ðì(€ÑÉäì(€€€É•ÍÕ±Ð€ô…Ý…¥ÐÍ•¹‘=Á•É…Ñ¥½¹…±5…¥°¡ì(€€€€€Ñ¼èÉ•¥Á¥•¹ÑÌ°(€€€€€Œè•µ…¥°¹Œ°(€€€€€‰Œè•µ…¥°¹‰Œ°(€€€€€ÍÕ‰©•Ðè•µ…¥°¹ÍÕ‰©•Ð°(€€€€€¡Ñµ°è•µ…¥°¹¡Ñµ°°(€€€€€Ñ•áÐè•µ…¥°¹Ñ•áÐ°(€€€ô°ì±¥•¹Ð°ÁÕÉÁ½Í•-•äè€¥¹½µ¥¹}Á…åµ•¹Ñ}É•Á½ÉÑÌœ°µ…¥±‰½áM¹…ÁÍ¡½ÐèÍ•¹‘•ÉM¹…ÁÍ¡½Ðô¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€…Ý…¥Ð±¥•¹Ð(€€€€€€¹™É½´ ¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}¹½Ñ¥™¥…Ñ¥½¹Ìœ¤(€€€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€€€‘•±¥Ù•Éå}ÍÑ…ÑÕÌè•ÉÉ½È¹µ…¥±•±¥Ù•ÉåU¹•ÉÑ…¥¸€ü€Õ¹•ÉÑ…¥¸œ€è€™…¥±•œ°(€€€€€€€±…ÍÑ}•ÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”°(€€€€€€€ÕÁ‘…Ñ•‘}…Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€ô¤(€€€€€€¹•Ä Á…åµ•¹Ñ}¥œ°Á…åµ•¹Ñ%¤ì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô((€½¹ÍÐÍ•¹ÑÐ€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}¹½Ñ¥™¥…Ñ¥½¹Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€‘•±¥Ù•Éå}ÍÑ…ÑÕÌè€Í•¹Ðœ°(€€€€€•µ…¥±}µ•ÍÍ…•}¥èÉ•ÍÕ±Ð¹¥ñðÉ•ÍÕ±Ð¹µ•ÍÍ…•%ñð¹Õ±°°(€€€€€•µ…¥±}ÁÉ½Ù¥‘•ÈèÉ•ÍÕ±Ð¹‘•±¥Ù•Éå5•Ñ¡½ñðµ…¥±½¹™¥œ¹‘•±¥Ù•Éå5•Ñ¡½°(€€€€€Í•¹Ñ}…ÐèÍ•¹ÑÐ°(€€€€€±…ÍÑ}•ÉÉ½Èè¹Õ±°°(€€€€€ÕÁ‘…Ñ•‘}…ÐèÍ•¹ÑÐ°(€€€ô¤(€€€€¹•Ä Á…åµ•¹Ñ}¥œ°Á…åµ•¹Ñ%¤(€€€€¹Í•±•Ð¡%9=5%9}Ae59Q}%9QIMQ}9=Q%%Q%=9}%1L¤(€€€€¹Í¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤ì(€€€…Ý…¥Ð±¥•¹Ð(€€€€€€¹™É½´ ¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}¹½Ñ¥™¥…Ñ¥½¹Ìœ¤(€€€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€€€‘•±¥Ù•Éå}ÍÑ…ÑÕÌè€Õ¹•ÉÑ…¥¸œ°(€€€€€€€±…ÍÑ}•ÉÉ½Èèµ…¥°Í•¹Ð‰ÕÐÑÉ…­¥¹œÕÁ‘…Ñ”™…¥±•è€‘í•ÉÉ½È¹µ•ÍÍ…•õ€°(€€€€€€€ÕÁ‘…Ñ•‘}…Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€ô¤(€€€€€€¹•Ä Á…åµ•¹Ñ}¥œ°Á…åµ•¹Ñ%¤ì(€€€É•ÑÕÉ¸ì(€€€€€Í•¹ÐèÑÉÕ”°(€€€€€ÑÉ…­¥¹]…É¹¥¹œè€µ…¥°Ý…ÌÍ•¹Ð°‰ÕÐ=L½Õ±¹½Ð™¥¹…±¥é”¥ÑÌ‘•±¥Ù•ÉäÉ•½É¸¼¹½ÐÉ•Í•¹Õ¹Ñ¥°…¸…‘µ¥¹¥ÍÑÉ…Ñ½ÈÉ•½¹¥±•Ì¥Ð¸œ°(€€€€€Ñ¼èÉ•¥Á¥•¹ÑÌ°(€€€€€¹½Ñ¥™¥…Ñ¥½¸èì(€€€€€€€€¸¸¹Í•É¥…±¥é•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¸¡É•Í•ÉÙ•¤°(€€€€€€€‘•±¥Ù•ÉåMÑ…ÑÕÌè€Õ¹•ÉÑ…¥¸œ°(€€€€€ô°(€€€ôì(€ô(€É•ÑÕÉ¸ì(€€€Í•¹ÐèÑÉÕ”°(€€€…±É•…‘åM•¹Ðè	½½±•…¸¡•á¥ÍÑ¥¹œ¤°(€€€É•Í•¹Ðè	½½±•…¸¡•á¥ÍÑ¥¹œ¤°(€€€Ñ¼èÉ•¥Á¥•¹ÑÌ°(€€€¹½Ñ¥™¥…Ñ¥½¸èÍ•É¥…±¥é•%¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ9½Ñ¥™¥…Ñ¥½¸¡‘…Ñ„¤°(€ôì)ô()½¹ÍÐ%9=5%9}Ae59Q}I%Y	1}Q	1}Q=-9}AQQI8€ô€½qíqíqÌ©É••¥Ù…‰±•A…åµ•¹ÑÍQ…‰±•qÌ©qõqô½¤ì)½¹ÍÐ%9=5%9}Ae59Q}	UeI}%}Q	1}Q=-9}AQQI8€ô€½qíqíqÌ©‰Õå•É¥…%¹Ù½¥•ÍQ…‰±•qÌ©qõqô½¤ì)½¹ÍÐ%9=5%9}Ae59Q}1Q}%9QIMQ}1%9-}Q=-9}AQQI9L€ôl½qíqíqÌ©É•ÅÕ•ÍÑ1…Ñ•A…åµ•¹Ñ%¹Ñ•É•ÍÑ%¹Ù½¥•1¥¹­qÌ©qõqô½¤°€½qíqíqÌ©±…Ñ•A…åµ•¹Ñ%¹Ñ•É•ÍÑ1¥¹­qÌ©qõqô½¥tì)½¹ÍÐU1Q}%9=5%9}Ae59Q}5%1}MQQ%9L€ôì(€Ñ¼èmt°(€Œèmt°(€‰Œèmt°(€ÍÕ‰©•Ðè€œœ°(€¥¹ÑÉ¼è€œœ°(€¥¹±Õ‘•I••¥Ù…‰±•A…åµ•¹ÑÌèÑÉÕ”°(€¥¹±Õ‘•	Õå•É¥…%¹Ù½¥•ÌèÑÉÕ”°)ôì()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñµ…¥±M•ÑÑ¥¹Ì¡¥¹ÁÕÐ€ôíô¤ì(€½¹ÍÐÍ…™•%¹ÁÕÐ€ôì€¸¸¹¥¹ÁÕÐôì(€‘•±•Ñ”Í…™•%¹ÁÕÐ¹™É½´ì(€½¹ÍÐ‘•™…Õ±ÑÌ€ôU1Q}%9=5%9}Ae59Q}5%1}MQQ%9Lì(€É•ÑÕÉ¸ì(€€€€¸¸¹‘•™…Õ±ÑÌ°(€€€€¸¸¹Í…™•%¹ÁÕÐ°(€€€Ñ¼èÁ…ÉÍ•µ…¥±1¥ÍÐ¡¥¹ÁÕÐ¹Ñ¼°‘•™…Õ±ÑÌ¹Ñ¼¤°(€€€ŒèÁ…ÉÍ•µ…¥±1¥ÍÐ¡¥¹ÁÕÐ¹Œ°‘•™…Õ±ÑÌ¹Œ¤°(€€€‰ŒèÁ…ÉÍ•µ…¥±1¥ÍÐ¡¥¹ÁÕÐ¹‰Œ°‘•™…Õ±ÑÌ¹‰Œ¤°(€€€ÍÕ‰©•ÐèMÑÉ¥¹œ¡¥¹ÁÕÐ¹ÍÕ‰©•Ð€üü‘•™…Õ±ÑÌ¹ÍÕ‰©•Ð¤°(€€€¥¹ÑÉ¼èMÑÉ¥¹œ¡¥¹ÁÕÐ¹¥¹ÑÉ¼€üü‘•™…Õ±ÑÌ¹¥¹ÑÉ¼¤°(€€€¥¹±Õ‘•I••¥Ù…‰±•A…åµ•¹ÑÌè¥¹ÁÕÐ¹¥¹±Õ‘•I••¥Ù…‰±•A…åµ•¹ÑÌ€üü‘•™…Õ±ÑÌ¹¥¹±Õ‘•I••¥Ù…‰±•A…åµ•¹ÑÌ°(€€€¥¹±Õ‘•	Õå•É¥…%¹Ù½¥•Ìè¥¹ÁÕÐ¹¥¹±Õ‘•	Õå•É¥…%¹Ù½¥•Ì€üü‘•™…Õ±ÑÌ¹¥¹±Õ‘•	Õå•É¥…%¹Ù½¥•Ì°(€ôì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑM•…É¡5…Ñ¡•Ì¡É½Ü°Í•…É °™¥•±‘Ì¤ì(€½¹ÍÐÅÕ•Éä€ôMÑÉ¥¹œ¡Í•…É ñð€œœ¤(€€€€¹ÑÉ¥´ ¤(€€€€¹Ñ½1½Ý•É…Í” ¤ì(€¥˜€ …ÅÕ•Éä¤É•ÑÕÉ¸ÑÉÕ”ì(€É•ÑÕÉ¸™¥•±‘Ì¹Í½µ” ¡™¥•±¤€ôø(€€€MÑÉ¥¹œ¡É½Üü¹m™¥•±‘tñð€œœ¤(€€€€€€¹Ñ½1½Ý•É…Í” ¤(€€€€€€¹¥¹±Õ‘•Ì¡ÅÕ•Éä¤°(€€¤ì)ô()™Õ¹Ñ¥½¸É•¹‘•É%¹½µ¥¹A…åµ•¹ÑQ•µÁ±…Ñ”¡Ù…±Õ”°½¹Ñ•áÐ€ôíô¤ì(€±•Ð½ÕÑÁÕÐ€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤ì(€™½È€¡½¹ÍÐm­•ä°É•Á±…•µ•¹Ñt½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡½¹Ñ•áÐ¤¤ì(€€€½ÕÑÁÕÐ€ô½ÕÑÁÕÐ¹É•Á±…”¡¹•ÜI•áÀ¡qqíqqíqqÌ¨‘í­•åõqqÌ©qqõqqõ€°€¤œ¤°MÑÉ¥¹œ¡É•Á±…•µ•¹Ð€üü€œœ¤¤ì(€ô(€É•ÑÕÉ¸½ÕÑÁÕÐì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑI•Á½ÉÑMÕµµ…Éä¡É½ÝÌ€ômt¤ì(€½¹ÍÐ¥¹½µ¥¹I½ÝÌ€ôÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹¥Í%¹½µ¥¹œ¤ì(€É•ÑÕÉ¸ì(€€€¥¹½µ¥¹I½ÝÌè¥¹½µ¥¹I½ÝÌ¹±•¹Ñ °(€€€Ñ½Ñ…±%¹½µ¥¹µ½Õ¹Ðè¥¹½µ¥¹I½ÝÌ¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬5…Ñ ¹…‰Ì¡9Õµ‰•È¡É½Ü¹¥¹½µ¥¹µ½Õ¹Ðñð€À¤¤°€À¤°(€€€‰Õå•ÉA…åµ•¹ÑQ½Ñ…°èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÑåÁ”€ôôô€	Õå•ÈA…åµ•¹Ðœ¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬5…Ñ ¹…‰Ì¡9Õµ‰•È¡É½Ü¹¥¹½µ¥¹µ½Õ¹Ðñð€À¤¤°€À¤°(€€€ÍÕÁÁ±¥•ÉI•™Õ¹‘Q½Ñ…°èÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÑåÁ”€ôôô€MÕÁÁ±¥•ÈI•™Õ¹œ¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬5…Ñ ¹…‰Ì¡9Õµ‰•È¡É½Ü¹¥¹½µ¥¹µ½Õ¹Ðñð€À¤¤°€À¤°(€€€Õ¹µ…Ñ¡•‘½Õ¹ÐèÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÑåÁ”€ôôô€U¹µ…Ñ¡•œñðÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€9••‘ÌÉ•Ù¥•Üœ¤¹±•¹Ñ °(€ôì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Í•ÉÑ•‘9½Ñ”¡É½Ü¤ì(€¥˜€ …É½Üü¹Á…åµ•¹Ñ…Ñ”ñð€…É½Üü¹É•…Ñ•‘…Ñ”¤É•ÑÕÉ¸€œœì(€¥˜€¡‘…Ñ•=¹±ä¡É½Ü¹Á…åµ•¹Ñ…Ñ”¤€ôôô‘…Ñ•=¹±ä¡É½Ü¹É•…Ñ•‘…Ñ”¤¤É•ÑÕÉ¸€œœì(€É•ÑÕÉ¸%¹Í•ÉÑ•½¸€‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹É•…Ñ•‘…Ñ”¥õ€ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑQ•ÉµÍY…±Õ”¡É½Ü¤ì(€É•ÑÕÉ¸É½Üü¹ÑåÁ”€ôôô€	Õå•ÈA…åµ•¹Ðœ€üÉ½Ü¹Á…åµ•¹ÑQ•ÉµÌñð€œ´œ€è€8½œì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ•±…åY…±Õ”¡É½Ü¤ì(€¥˜€¡É½Üü¹ÑåÁ”€„ôô€	Õå•ÈA…åµ•¹Ðœ¤É•ÑÕÉ¸€8½œì(€É•ÑÕÉ¸É½Ü¹‘•±…å…åÌ€ôô¹Õ±°€ü€œ´œ€è9Õµ‰•È¡É½Ü¹‘•±…å…åÌ¤¹Ñ½1½…±•MÑÉ¥¹œ ¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñµ½Õ¹ÑQ•áÐ¡É½Ü¤ì(€½¹ÍÐ‰…¹­¡…É•Ì€ô€¡É½Üü¹‰…¹­¡…É•Ìñðmt¤¹µ…À ¡¡…É”¤€ôø	…¹¬¡…É”€‘íµ½¹•ä¡¡…É”¹…µ½Õ¹Ð¥õ€¤ì(€É•ÑÕÉ¸mµ½¹•ä¡É½Üü¹…µ½Õ¹Ð¤°€¸¸¹‰…¹­¡…É•Ít¹©½¥¸ œ€¼€œ¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑI••¥Ù…‰±•Q…‰±•!Ñµ°¡É½ÝÌ€ômt¤ì(€½¹ÍÐÑ…‰±•I½ÝÌ€ôÉ½ÝÌ(€€€€¹µ…À ¡É½Ü¤€ôøì(€€€€€½¹ÍÐ•±°€ô€‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàíÙ•ÉÑ¥…°µ…±¥¸éÑ½Àœì(€€€€€½¹ÍÐ…µ½Õ¹Ñ1¥¹•Ì€ôm•Í…Á•!Ñµ°¡µ½¹•ä¡É½Ü¹…µ½Õ¹Ð¤¤°€¸¸¸¡É½Ü¹‰…¹­¡…É•Ìñðmt¤¹µ…À ¡¡…É”¤€ôø€ñÍÁ…¸ÍÑå±”ô‰‘¥ÍÁ±…äé‰±½¬í½±½ÈèŒäÈÐÀÁ”í™½¹ÐµÝ•¥¡ÐèØÀÀˆù	…¹¬¡…É”€‘í•Í…Á•!Ñµ°¡µ½¹•ä¡¡…É”¹…µ½Õ¹Ð¤¥ôð½ÍÁ…¸ù€¥t¹©½¥¸ œœ¤ì(€€€€€É•ÑÕÉ¸€(€€€€€€ñÑÈø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹Á…åµ•¹Ñ…Ñ”¥ô‘í¥¹½µ¥¹A…åµ•¹Ñ%¹Í•ÉÑ•‘9½Ñ”¡É½Ü¤€ü€ñÍÁ…¸ÍÑå±”ô‰‘¥ÍÁ±…äé‰±½¬í½±½ÈèŒäÈÐÀÁ”í™½¹ÐµÍ¥é”èÄÅÁàí™½¹ÐµÝ•¥¡ÐèØÀÀˆù%¹Í•ÉÑ•½¸€‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹É•…Ñ•‘…Ñ”¥ôð½ÍÁ…¸ù€€è€œôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀíÑ•áÐµ…±¥¸éÉ¥¡Ðˆø‘í•Í…Á•!Ñµ°¡¥¹½µ¥¹A…åµ•¹ÑQ•ÉµÍY…±Õ”¡É½Ü¤¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀíÑ•áÐµ…±¥¸éÉ¥¡Ðˆø‘í•Í…Á•!Ñµ°¡¥¹½µ¥¹A…åµ•¹Ñ•±…åY…±Õ”¡É½Ü¤¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíµ¥¸µÝ¥‘Ñ èÄØÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹Á…ÉÑå9…µ”ñð€œ´œ¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíµ¥¸µÝ¥‘Ñ èÄÐÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹‰Õå•ÉÉ½ÕÁ9…µ”ñð€œ´œ¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíµ¥¸µÝ¥‘Ñ èÄàÁÁàí™½¹ÐµÝ•¥¡ÐèØÀÀˆø‘í•Í…Á•!Ñµ°¡É½Ü¹ÍÑ•µ9…µ”ñð€œ´œ¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀíÑ•áÐµ…±¥¸éÉ¥¡Ðí™½¹ÐµÝ•¥¡ÐèØÀÀˆø‘í…µ½Õ¹Ñ1¥¹•Íôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀíÑ•áÐµ…±¥¸éÉ¥¡Ðˆø‘íµ½¹•ä¡É½Ü¹É••¥Ù…‰±•	…±…¹”¥ôð½Ñø(€€€€€€ð½ÑÈù€ì(€€€ô¤(€€€€¹©½¥¸ œœ¤ì(€É•ÑÕÉ¸€(€€€€ñ‘¥ØÍÑå±”ô‰µ…É¥¸èÄÑÁà€À€ÄáÁàˆø(€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÄÍÁàí™½¹ÐµÝ•¥¡ÐèÜÀÀíµ…É¥¸èÀ€À€áÁàí½±½ÈèŒÅ˜ÈäÌÜˆùI••¥Ù…‰±”A…åµ•¹ÑÌ€ ‘íÉ½ÝÌ¹±•¹Ñ ¹Ñ½1½…±•MÑÉ¥¹œ ¥ô¤ð½‘¥Øø(€€€€€€ñ‘¥ØÍÑå±”ô‰½Ù•É™±½Üµàé…ÕÑ¼í‰½É‘•ÈèÅÁàÍ½±¥€å”É•˜í‰½É‘•ÈµÉ…‘¥ÕÌèÄÁÁàˆø(€€€€€€€€ñÑ…‰±”ÍÑå±”ô‰‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íÝ¥‘Ñ é…ÕÑ¼íµ¥¸µÝ¥‘Ñ èÄÀÐÁÁàí™½¹ÐµÍ¥é”èÄÉÁàí±¥¹”µ¡•¥¡ÐèÄ¸Ìˆø(€€€€€€€€€€ñÑ¡•…ø(€€€€€€€€€€€€ñÑÈÍÑå±”ô‰‰…­É½Õ¹è˜á™…™Œí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í™½¹ÐµÍ¥é”èÄÅÁàí±•ÑÑ•ÈµÍÁ…¥¹œè¸ÀÑ•´ˆø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùI••¥Ù•…Ñ”ð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùQ•ÉµÌð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆù•±…äð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùÉ½´ð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùÉ½ÕÀð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùMQ4ð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆùµ½Õ¹Ðð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùI••¥Ù…‰±”ð½Ñ ø(€€€€€€€€€€€€ð½ÑÈø(€€€€€€€€€€ð½Ñ¡•…ø(€€€€€€€€€€ñÑ‰½‘äø‘íÑ…‰±•I½ÝÌñð€œñÑÈøñÑ½±ÍÁ…¸ôˆàˆÍÑå±”ô‰Á…‘‘¥¹œèÄÙÁàíÑ•áÐµ…±¥¸é•¹Ñ•Èí½±½ÈèŒØØÜÀàÔˆù9¼É••¥Ù…‰±”Á…åµ•¹ÑÌ™½Õ¹™½ÈÑ¡”Í•±•Ñ•™¥±Ñ•ÉÌ¸ð½Ñøð½ÑÈøôð½Ñ‰½‘äø(€€€€€€€€ð½Ñ…‰±”ø(€€€€€€ð½‘¥Øø(€€€€ð½‘¥Øù€ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ	Õå•É¥…Q…‰±•!Ñµ°¡É½ÝÌ€ômt¤ì(€½¹ÍÐÑ…‰±•I½ÝÌ€ôÉ½ÝÌ(€€€€¹µ…À ¡É½Ü¤€ôøì(€€€€€½¹ÍÐ•±°€ô€‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€”Õ”Ý•ˆíÁ…‘‘¥¹œèÝÁà€áÁàíÙ•ÉÑ¥…°µ…±¥¸éÑ½Àœì(€€€€€É•ÑÕÉ¸€(€€€€€€ñÑÈø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíµ¥¸µÝ¥‘Ñ èÄàÁÁàí™½¹ÐµÝ•¥¡ÐèØÀÀˆø‘í•Í…Á•!Ñµ°¡É½Ü¹‰Õå•É9…µ”ñð€œ´œ¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíµ¥¸µÝ¥‘Ñ èÄÐÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹‰Õå•ÉÉ½ÕÁ9…µ”ñð€œ´œ¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíµ¥¸µÝ¥‘Ñ èÄÌÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹‰Õå•ÉQÉ…‘•Èñð€œ´œ¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíµ¥¸µÝ¥‘Ñ èÄàÁÁàí™½¹ÐµÝ•¥¡ÐèØÀÀˆø‘í•Í…Á•!Ñµ°¡É½Ü¹ÍÑ•µ9…µ”ñð€œ´œ¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀíÑ•áÐµ…±¥¸éÉ¥¡Ðˆø‘íµ½¹•ä¡É½Ü¹…±Õ±…Ñ•‘µ½Õ¹Ð¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀíÑ•áÐµ…±¥¸éÉ¥¡Ðí™½¹ÐµÝ•¥¡ÐèØÀÀˆø‘íµ½¹•ä¡É½Ü¹É••¥Ù…‰±•	…±…¹”¥ôð½Ñø(€€€€€€€€ñÑÍÑå±”ôˆ‘í•±±ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹‘•±¥Ù•Éå…Ñ”¥ôð½Ñø(€€€€€€ð½ÑÈù€ì(€€€ô¤(€€€€¹©½¥¸ œœ¤ì(€É•ÑÕÉ¸€(€€€€ñ‘¥ØÍÑå±”ô‰µ…É¥¸èÄÑÁà€À€ÄáÁàˆø(€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÄÍÁàí™½¹ÐµÝ•¥¡ÐèÜÀÀíµ…É¥¸èÀ€À€áÁàí½±½ÈèŒÅ˜ÈäÌÜˆù	Õå•È%%¹Ù½¥•Ì€ ‘íÉ½ÝÌ¹±•¹Ñ ¹Ñ½1½…±•MÑÉ¥¹œ ¥ô¤ð½‘¥Øø(€€€€€€ñ‘¥ØÍÑå±”ô‰½Ù•É™±½Üµàé…ÕÑ¼í‰½É‘•ÈèÅÁàÍ½±¥€å”É•˜í‰½É‘•ÈµÉ…‘¥ÕÌèÄÁÁàˆø(€€€€€€€€ñÑ…‰±”ÍÑå±”ô‰‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íÝ¥‘Ñ é…ÕÑ¼íµ¥¸µÝ¥‘Ñ èäÀÁÁàí™½¹ÐµÍ¥é”èÄÉÁàí±¥¹”µ¡•¥¡ÐèÄ¸Ìˆø(€€€€€€€€€€ñÑ¡•…ø(€€€€€€€€€€€€ñÑÈÍÑå±”ô‰‰…­É½Õ¹è˜á™…™Œí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í™½¹ÐµÍ¥é”èÄÅÁàí±•ÑÑ•ÈµÍÁ…¥¹œè¸ÀÑ•´ˆø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆù	Õå•Èð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùÉ½ÕÀð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆù	Õå•ÈQÉ…‘•Èð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùMQ4ð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆù…±Õ±…Ñ•µ½Õ¹Ðð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùI••¥Ù…‰±”	…±…¹”ð½Ñ ø(€€€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆù•±¥Ù•Éä…Ñ”ð½Ñ ø(€€€€€€€€€€€€ð½ÑÈø(€€€€€€€€€€ð½Ñ¡•…ø(€€€€€€€€€€ñÑ‰½‘äø‘íÑ…‰±•I½ÝÌñð€œñÑÈøñÑ½±ÍÁ…¸ôˆÜˆÍÑå±”ô‰Á…‘‘¥¹œèÄÙÁàíÑ•áÐµ…±¥¸é•¹Ñ•Èí½±½ÈèŒØØÜÀàÔˆù9¼	Õå•È%¥¹Ù½¥•Ì™½Õ¹™½ÈÑ¡”Í•±•Ñ•™¥±Ñ•ÉÌ¸ð½Ñøð½ÑÈøôð½Ñ‰½‘äø(€€€€€€€€ð½Ñ…‰±”ø(€€€€€€ð½‘¥Øø(€€€€ð½‘¥Øù€ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹ÑI••¥Ù…‰±•Q…‰±•Q•áÐ¡É½ÝÌ€ômt¤ì(€¥˜€ …É½ÝÌ¹±•¹Ñ ¤É•ÑÕÉ¸€I••¥Ù…‰±”A…åµ•¹ÑÌè¹½¹”œì(€É•ÑÕÉ¸mI••¥Ù…‰±”A…åµ•¹ÑÌ€ ‘íÉ½ÝÌ¹±•¹Ñ¡ô¥€°€I••¥Ù•…Ñ”ðQ•ÉµÌð•±…äðÉ½´ðÉ½ÕÀðMQ4ðµ½Õ¹ÐðI••¥Ù…‰±”œ°€¸¸¹É½ÝÌ¹µ…À ¡É½Ü¤€ôø€‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹Á…åµ•¹Ñ…Ñ”¥ô‘í¥¹½µ¥¹A…åµ•¹Ñ%¹Í•ÉÑ•‘9½Ñ”¡É½Ü¤€ü€€ ‘í¥¹½µ¥¹A…åµ•¹Ñ%¹Í•ÉÑ•‘9½Ñ”¡É½Ü¥ô¥€€è€œôð€‘í¥¹½µ¥¹A…åµ•¹ÑQ•ÉµÍY…±Õ”¡É½Ü¥ôð€‘í¥¹½µ¥¹A…åµ•¹Ñ•±…åY…±Õ”¡É½Ü¥ôð€‘íÉ½Ü¹Á…ÉÑå9…µ”ñð€œ´ôð€‘íÉ½Ü¹‰Õå•ÉÉ½ÕÁ9…µ”ñð€œ´ôð€‘íÉ½Ü¹ÍÑ•µ9…µ”ñð€œ´ôð€‘í¥¹½µ¥¹A…åµ•¹Ñµ½Õ¹ÑQ•áÐ¡É½Ü¥ôð€‘íµ½¹•ä¡É½Ü¹É••¥Ù…‰±•	…±…¹”¥õ€¥t¹©½¥¸ q¸œ¤ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ	Õå•É¥…Q…‰±•Q•áÐ¡É½ÝÌ€ômt¤ì(€¥˜€ …É½ÝÌ¹±•¹Ñ ¤É•ÑÕÉ¸€	Õå•È%%¹Ù½¥•Ìè¹½¹”œì(€É•ÑÕÉ¸m	Õå•È%%¹Ù½¥•Ì€ ‘íÉ½ÝÌ¹±•¹Ñ¡ô¥€°€¸¸¹É½ÝÌ¹µ…À ¡É½Ü¤€ôø€‘íÉ½Ü¹‰Õå•É9…µ”ñð€œ´ôð€‘íÉ½Ü¹‰Õå•ÉÉ½ÕÁ9…µ”ñð€œ´ôð€‘íÉ½Ü¹‰Õå•ÉQÉ…‘•Èñð€œ´ôð€‘íÉ½Ü¹ÍÑ•µ9…µ”ñð€œ´ôð…±Õ±…Ñ•€‘íµ½¹•ä¡É½Ü¹…±Õ±…Ñ•‘µ½Õ¹Ð¥ôðI••¥Ù…‰±”€‘íµ½¹•ä¡É½Ü¹É••¥Ù…‰±•	…±…¹”¥ôð•±¥Ù•Éä€‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹‘•±¥Ù•Éå…Ñ”¥õ€¥t¹©½¥¸ q¸œ¤ì)ô()™Õ¹Ñ¥½¸É•Á±…•%¹½µ¥¹A…åµ•¹ÑQ½­•¸¡Í½ÕÉ”°Á…ÑÑ•É¸°É•Á±…•µ•¹Ð¤ì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Í½ÕÉ”ñð€œœ¤(€€€€¹É•Á±…”¡¹•ÜI•áÀ¡€ñÁqq‰mxùt¨ùqqÌ¨‘íÁ…ÑÑ•É¸¹Í½ÕÉ•õqqÌ¨ñqp½Àù€°€¤œ¤°É•Á±…•µ•¹Ð¤(€€€€¹É•Á±…”¡Á…ÑÑ•É¸°É•Á±…•µ•¹Ð¤ì)ô()™Õ¹Ñ¥½¸¥¹©•Ñ%¹½µ¥¹A…åµ•¹ÑQ…‰±•Ì¡½¹Ñ•¹Ð°Í•ÑÑ¥¹Ì°É••¥Ù…‰±•Q…‰±”°‰Õå•É¥…Q…‰±”¤ì(€±•Ð½ÕÑÁÕÐ€ôMÑÉ¥¹œ¡½¹Ñ•¹Ðñð€œœ¤ì(€½¹ÍÐ¡…ÍI••¥Ù…‰±•Q½­•¸€ô%9=5%9}Ae59Q}I%Y	1}Q	1}Q=-9}AQQI8¹Ñ•ÍÐ¡½ÕÑÁÕÐ¤ì(€½¹ÍÐ¡…Í	Õå•É¥…Q½­•¸€ô%9=5%9}Ae59Q}	UeI}%}Q	1}Q=-9}AQQI8¹Ñ•ÍÐ¡½ÕÑÁÕÐ¤ì(€½ÕÑÁÕÐ€ôÉ•Á±…•%¹½µ¥¹A…åµ•¹ÑQ½­•¸¡½ÕÑÁÕÐ°%9=5%9}Ae59Q}I%Y	1}Q	1}Q=-9}AQQI8°Í•ÑÑ¥¹Ì¹¥¹±Õ‘•I••¥Ù…‰±•A…åµ•¹ÑÌ€üÉ••¥Ù…‰±•Q…‰±”€è€œœ¤ì(€½ÕÑÁÕÐ€ôÉ•Á±…•%¹½µ¥¹A…åµ•¹ÑQ½­•¸¡½ÕÑÁÕÐ°%9=5%9}Ae59Q}	UeI}%}Q	1}Q=-9}AQQI8°Í•ÑÑ¥¹Ì¹¥¹±Õ‘•	Õå•É¥…%¹Ù½¥•Ì€ü‰Õå•É¥…Q…‰±”€è€œœ¤ì(€¥˜€¡Í•ÑÑ¥¹Ì¹¥¹±Õ‘•I••¥Ù…‰±•A…åµ•¹ÑÌ€˜˜€…¡…ÍI••¥Ù…‰±•Q½­•¸¤½ÕÑÁÕÐ€¬ôÉ••¥Ù…‰±•Q…‰±”ì(€¥˜€¡Í•ÑÑ¥¹Ì¹¥¹±Õ‘•	Õå•É¥…%¹Ù½¥•Ì€˜˜€…¡…Í	Õå•É¥…Q½­•¸¤½ÕÑÁÕÐ€¬ô‰Õå•É¥…Q…‰±”ì(€É•ÑÕÉ¸½ÕÑÁÕÐì)ô()™Õ¹Ñ¥½¸¥¹©•Ñ%¹½µ¥¹A…åµ•¹Ñ1…Ñ•%¹Ñ•É•ÍÑ1¥¹¬¡½¹Ñ•¹Ð°É•Á±…•µ•¹Ð¤ì(€±•Ð½ÕÑÁÕÐ€ôMÑÉ¥¹œ¡½¹Ñ•¹Ðñð€œœ¤ì(€™½È€¡½¹ÍÐÁ…ÑÑ•É¸½˜%9=5%9}Ae59Q}1Q}%9QIMQ}1%9-}Q=-9}AQQI9L¤ì(€€€½ÕÑÁÕÐ€ôÉ•Á±…•%¹½µ¥¹A…åµ•¹ÑQ½­•¸¡½ÕÑÁÕÐ°Á…ÑÑ•É¸°É•Á±…•µ•¹Ð¤ì(€ô(€É•ÑÕÉ¸½ÕÑÁÕÐì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ1…Ñ•%¹Ñ•É•ÍÑ1¥¹­!Ñµ°¡ÕÉ°¤ì(€É•ÑÕÉ¸€ñÀÍÑå±”ô‰µ…É¥¸èÀ€À€ÄÑÁàˆøñ„¡É•˜ôˆ‘í•Í…Á•!Ñµ°¡ÕÉ°¥ôˆÍÑå±”ô‰‘¥ÍÁ±…äé¥¹±¥¹”µ‰±½¬í‰½É‘•ÈµÉ…‘¥ÕÌèáÁàí‰…­É½Õ¹èÈàÀÀí½±½Èè™™™™™˜íÑ•áÐµ‘•½É…Ñ¥½¸é¹½¹”í™½¹ÐµÝ•¥¡ÐèÜÀÀíÁ…‘‘¥¹œèåÁà€ÄÍÁàˆù1…Ñ”A…åµ•¹Ð%¹Ñ•É•ÍÐ%¹Ù½¥”ð½„øð½Àù€ì)ô()™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ1…Ñ•%¹Ñ•É•ÍÑ1¥¹­Q•áÐ¡ÕÉ°¤ì(€É•ÑÕÉ¸1…Ñ”A…åµ•¹Ð%¹Ñ•É•ÍÐ%¹Ù½¥”è€‘íÕÉ±õ€ì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘%¹½µ¥¹A…åµ•¹Ñµ…¥°¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì¤ì(€½¹ÍÐÍÕµµ…Éä€ôÉ•Á½ÉÐ¹ÍÕµµ…Éäñð¥¹½µ¥¹A…åµ•¹ÑI•Á½ÉÑMÕµµ…Éä¡É•Á½ÉÐ¹É½ÝÌñðmt¤ì(€½¹ÍÐ±…Ñ•%¹Ñ•É•ÍÑUÉ°€ô¥¹½µ¥¹A…åµ•¹Ñ¥±Ñ•ÉUÉ°¡Í•ÑÑ¥¹Ì°É•Á½ÉÐ¤ì(€½¹ÍÐ¥¹½µ¥¹I½ÝÌ€ô9Õµ‰•È¡ÍÕµµ…Éä¹¥¹½µ¥¹I½ÝÌñð€À¤ì(€½¹ÍÐ¹••‘ÍI•Ù¥•Ý½Õ¹Ð€ô9Õµ‰•È¡ÍÕµµ…Éä¹Õ¹µ…Ñ¡•‘½Õ¹Ðñð€À¤ì(€½¹ÍÐ½¹Ñ•áÐ€ôì(€€€‘…Ñ•É½´èÁÉ•ÑÑå…Ñ”¡É•Á½ÉÐ¹‘…Ñ•É½´¤°(€€€‘…Ñ•Q¼èÁÉ•ÑÑå…Ñ”¡É•Á½ÉÐ¹‘…Ñ•Q¼¤°(€€€Ñ½‘…äèÁÉ•ÑÑå…Ñ”¡‘…Ñ•=¹±ä¡¹•Ü…Ñ” ¤¤¤°(€€€Á…åµ•¹Ñ½Õ¹Ðè€¡É•Á½ÉÐ¹É½ÝÌñðmt¤¹±•¹Ñ ¹Ñ½1½…±•MÑÉ¥¹œ ¤°(€€€É••¥Ù…‰±•A…åµ•¹Ñ½Õ¹Ðè€¡É•Á½ÉÐ¹É½ÝÌñðmt¤¹±•¹Ñ ¹Ñ½1½…±•MÑÉ¥¹œ ¤°(€€€‰Õå•É¥…½Õ¹Ðè€¡É•Á½ÉÐ¹‰Õå•É¥…%¹Ù½¥•Ìñðmt¤¹±•¹Ñ ¹Ñ½1½…±•MÑÉ¥¹œ ¤°(€€€¥¹½µ¥¹Q½Ñ…°èµ½¹•ä¡ÍÕµµ…Éä¹Ñ½Ñ…±%¹½µ¥¹µ½Õ¹Ð¤°(€€€‰Õå•ÉA…åµ•¹ÑQ½Ñ…°èµ½¹•ä¡ÍÕµµ…Éä¹‰Õå•ÉA…åµ•¹ÑQ½Ñ…°¤°(€€€ÍÕÁÁ±¥•ÉI•™Õ¹‘Q½Ñ…°èµ½¹•ä¡ÍÕµµ…Éä¹ÍÕÁÁ±¥•ÉI•™Õ¹‘Q½Ñ…°¤°(€€€¹••‘ÍI•Ù¥•Ý½Õ¹ÐèMÑÉ¥¹œ¡¹••‘ÍI•Ù¥•Ý½Õ¹Ð¤°(€€€­•åÝ½ÉèÉ•Á½ÉÐ¹Í•…É ñð€œœ°(€ôì(€½¹ÍÐÍÕ‰©•Ð€ôÉ•¹‘•É%¹½µ¥¹A…åµ•¹ÑQ•µÁ±…Ñ”¡Í•ÑÑ¥¹Ì¹ÍÕ‰©•Ð°½¹Ñ•áÐ¤ì(€½¹ÍÐ½¹Ñ•¹Ð€ôÉ•¹‘•É%¹½µ¥¹A…åµ•¹ÑQ•µÁ±…Ñ”¡Í•ÑÑ¥¹Ì¹¥¹ÑÉ¼°½¹Ñ•áÐ¤ì(€½¹ÍÐ½¹Ñ•¹ÑQ•áÐ€ô¡…Í!Ñµ±5…É­ÕÀ¡½¹Ñ•¹Ð¤€ü¡Ñµ±Q½A±…¥¹Q•áÐ¡½¹Ñ•¹Ð¤€è½¹Ñ•¹Ðì(€½¹ÍÐÍÕµµ…Éå!Ñµ°€ô€(€€€€ñÑ…‰±”É½±”ô‰ÁÉ•Í•¹Ñ…Ñ¥½¸ˆÍÑå±”ô‰‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íµ…É¥¸èÄáÁà€ÀíÝ¥‘Ñ èÄÀÀ”íµ…àµÝ¥‘Ñ èÜÈÁÁàˆø(€€€€€€ñÑÈø(€€€€€€€€ñÑÍÑå±”ô‰‰½É‘•ÈèÅÁàÍ½±¥€å”É•˜í‰½É‘•ÈµÉ…‘¥ÕÌèáÁà€À€À€áÁàíÁ…‘‘¥¹œèÄÉÁàí‰…­É½Õ¹è˜Ù™•˜äˆø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÄÉÁàí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í±•ÑÑ•ÈµÍÁ…¥¹œè¸ÀÑ•´ˆù%¹½µ¥¹œQ½Ñ…°ð½‘¥Øø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÈÁÁàí™½¹ÐµÝ•¥¡ÐèÜÀÀí½±½ÈèŒÀÔäØØäˆø‘íµ½¹•ä¡ÍÕµµ…Éä¹Ñ½Ñ…±%¹½µ¥¹µ½Õ¹Ð¥ôð½‘¥Øø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰µ…É¥¸µÑ½ÀèÑÁàí™½¹ÐµÍ¥é”èÄÉÁàí½±½ÈèŒØØÜÀàÔˆù	Õå•ÈA…åµ•¹ÑÌ€‘íµ½¹•ä¡ÍÕµµ…Éä¹‰Õå•ÉA…åµ•¹ÑQ½Ñ…°¥ôƒ
ÜMÕÁÁ±¥•ÈI•™Õ¹‘Ì€‘íµ½¹•ä¡ÍÕµµ…Éä¹ÍÕÁÁ±¥•ÉI•™Õ¹‘Q½Ñ…°¥ôƒ
Ü€‘í¥¹½µ¥¹I½ÝÌ¹Ñ½1½…±•MÑÉ¥¹œ ¥ôÉ•½É‘Ìð½‘¥Øø(€€€€€€€€ð½Ñø(€€€€€€€€ñÑÍÑå±”ô‰‰½É‘•ÈèÅÁàÍ½±¥€å”É•˜í‰½É‘•Èµ±•™ÐèÀí‰½É‘•ÈµÉ…‘¥ÕÌèÀ€áÁà€áÁà€ÀíÁ…‘‘¥¹œèÄÉÁàí‰…­É½Õ¹è™™™‰•ˆˆø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÄÉÁàí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í±•ÑÑ•ÈµÍÁ…¥¹œè¸ÀÑ•´ˆù9••‘ÌI•Ù¥•Üð½‘¥Øø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÈÁÁàí™½¹ÐµÝ•¥¡ÐèÜÀÀí½±½ÈèäÜÜÀØˆø‘í¹••‘ÍI•Ù¥•Ý½Õ¹Ð¹Ñ½1½…±•MÑÉ¥¹œ ¥ôð½‘¥Øø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰µ…É¥¸µÑ½ÀèÑÁàí™½¹ÐµÍ¥é”èÄÉÁàí½±½ÈèŒØØÜÀàÔˆùU¹µ…Ñ¡•½È¥¹½µÁ±•Ñ”Á…åµ•¹ÑÌð½‘¥Øø(€€€€€€€€ð½Ñø(€€€€€€ð½ÑÈø(€€€€ð½Ñ…‰±”ù€ì(€½¹ÍÐ½¹Ñ•¹Ñ!Ñµ°€ô¥¹©•Ñ%¹½µ¥¹A…åµ•¹Ñ1…Ñ•%¹Ñ•É•ÍÑ1¥¹¬¡•µ…¥±½¹Ñ•¹Ñ!Ñµ°¡½¹Ñ•¹Ð¤°¥¹½µ¥¹A…åµ•¹Ñ1…Ñ•%¹Ñ•É•ÍÑ1¥¹­!Ñµ°¡±…Ñ•%¹Ñ•É•ÍÑUÉ°¤¤ì(€½¹ÍÐ¡Ñµ°€ô€(€€€€ñ‘¥ØÍÑå±”ô‰™½¹Ðµ™…µ¥±äé%¹Ñ•È±É¥…°±Í…¹ÌµÍ•É¥˜í½±½ÈèŒÅ˜ÈäÌÜí±¥¹”µ¡•¥¡ÐèÄ¸ÐÔˆø(€€€€€€‘íÍÕµµ…Éå!Ñµ±ô(€€€€€€‘í¥¹©•Ñ%¹½µ¥¹A…åµ•¹ÑQ…‰±•Ì¡½¹Ñ•¹Ñ!Ñµ°°Í•ÑÑ¥¹Ì°¥¹½µ¥¹A…åµ•¹ÑI••¥Ù…‰±•Q…‰±•!Ñµ°¡É•Á½ÉÐ¹É½ÝÌñðmt¤°¥¹½µ¥¹A…åµ•¹Ñ	Õå•É¥…Q…‰±•!Ñµ°¡É•Á½ÉÐ¹‰Õå•É¥…%¹Ù½¥•Ìñðmt¤¥ô(€€€€ð½‘¥Øù€ì(€½¹ÍÐÑ•áÑ½¹Ñ•¹Ð€ô¥¹©•Ñ%¹½µ¥¹A…åµ•¹ÑQ…‰±•Ì¡m%¹½µ¥¹œQ½Ñ…°è€‘íµ½¹•ä¡ÍÕµµ…Éä¹Ñ½Ñ…±%¹½µ¥¹µ½Õ¹Ð¥õ€°	Õå•ÈA…åµ•¹ÑÌè€‘íµ½¹•ä¡ÍÕµµ…Éä¹‰Õå•ÉA…åµ•¹ÑQ½Ñ…°¥õ€°MÕÁÁ±¥•ÈI•™Õ¹‘Ìè€‘íµ½¹•ä¡ÍÕµµ…Éä¹ÍÕÁÁ±¥•ÉI•™Õ¹‘Q½Ñ…°¥õ€°%¹½µ¥¹œI•½É‘Ìè€‘í¥¹½µ¥¹I½ÝÌ¹Ñ½1½…±•MÑÉ¥¹œ ¥õ€°9••‘ÌI•Ù¥•Üè€‘í¹••‘ÍI•Ù¥•Ý½Õ¹Ð¹Ñ½1½…±•MÑÉ¥¹œ ¥õ€°€œœ°¥¹©•Ñ%¹½µ¥¹A…åµ•¹Ñ1…Ñ•%¹Ñ•É•ÍÑ1¥¹¬¡½¹Ñ•¹ÑQ•áÐ°¥¹½µ¥¹A…åµ•¹Ñ1…Ñ•%¹Ñ•É•ÍÑ1¥¹­Q•áÐ¡±…Ñ•%¹Ñ•É•ÍÑUÉ°¤¥t¹©½¥¸ q¸œ¤°Í•ÑÑ¥¹Ì°q¹q¸‘í¥¹½µ¥¹A…åµ•¹ÑI••¥Ù…‰±•Q…‰±•Q•áÐ¡É•Á½ÉÐ¹É½ÝÌñðmt¥õq¹q¹€°q¹q¸‘í¥¹½µ¥¹A…åµ•¹Ñ	Õå•É¥…Q…‰±•Q•áÐ¡É•Á½ÉÐ¹‰Õå•É¥…%¹Ù½¥•Ìñðmt¥õq¹q¹€¤ì(€É•ÑÕÉ¸ìÍÕ‰©•Ð°¡Ñµ°°Ñ•áÐèÑ•áÑ½¹Ñ•¹Ð°ÍÕµµ…Éäôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñµ…¥±I•Á½ÉÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ…Ñ¥Ù••ÍÌ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐÍÑ½É•€ô…Ý…¥Ð±½…‘¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡…Ñ¥Ù••ÍÌ¹±¥•¹Ð°€¥¹½µ¥¹}Á…åµ•¹Ñ}É•Á½ÉÑÌœ°ìÉ•ÅÕ¥É•è€…‰½‘ä¹ÁÉ•Ù¥•Ü€˜˜€…‰½‘ä¹‘ÉåIÕ¸ô¤ì(€½¹ÍÐÍ•ÑÑ¥¹Ì€ô¥¹½µ¥¹A…åµ•¹Ñµ…¥±M•ÑÑ¥¹Ì¡ÍÑ½É•¹Í•ÑÑ¥¹Ì¤ì(€¥˜€ …‰½‘ä¹ÁÉ•Ù¥•Ü€˜˜€…‰½‘ä¹‘ÉåIÕ¸€˜˜€ …Í•ÑÑ¥¹Ì¹ÍÕ‰©•Ð¹ÑÉ¥´ ¤ñð€…Í•ÑÑ¥¹Ì¹¥¹ÑÉ¼¹ÑÉ¥´ ¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È %¹½µ¥¹œA…åµ•¹ÐÉ•Á½ÉÐÍÕ‰©•Ð…¹‰½‘ä…É”¹½Ð½¹™¥ÕÉ•¸M•¹‘¥¹œ¥Ì‘¥Í…‰±•¸œ°€ÔÀÌ°€%99%1}IA=IQ}Q5A1Q}9=Q}=9%UIœ°Õ¹‘•™¥¹•°ÑÉÕ”¤ì(€ô(€½¹ÍÐÍ½ÕÉ”€ô…Ý…¥Ð¥¹½µ¥¹A…åµ•¹ÑÍ1¥ÍÐ (€€€ì(€€€€€‘…Ñ•É½´è‰½‘ä¹‘…Ñ•É½´°(€€€€€‘…Ñ•Q¼è‰½‘ä¹‘…Ñ•Q¼°(€€€€€±¥µ¥Ðè‰½‘ä¹±¥µ¥Ðñð€ÔÀÀÀ°(€€€ô°(€€€¹Õ±°°(€€€…Ñ¥Ù••ÍÌ°(€€¤ì(€½¹ÍÐÍ•…É €ôMÑÉ¥¹œ¡‰½‘ä¹Í•…É ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐÉ½ÝÌ€ô€¡Í½ÕÉ”¹É½ÝÌñðmt¤¹™¥±Ñ•È ¡É½Ü¤€ôø¥¹½µ¥¹A…åµ•¹ÑM•…É¡5…Ñ¡•Ì¡É½Ü°Í•…É °lÁ…ÉÑå9…µ”œ°€ÍÑ•µ9…µ”œ°€­•åMÑ•´œ°€‰Õå•É9…µ”œ°€‰Õå•ÉÉ½ÕÁ9…µ”œ°€ÍÕÁÁ±¥•É9…µ”œ°€ÍÕÁÁ±¥•É%¹Ù½¥•9…µ”t¤¤ì(€½¹ÍÐ‰Õå•É¥…%¹Ù½¥•Ì€ô€¡Í½ÕÉ”¹‰Õå•É¥…%¹Ù½¥•Ìñðmt¤¹™¥±Ñ•È ¡É½Ü¤€ôø¥¹½µ¥¹A…åµ•¹ÑM•…É¡5…Ñ¡•Ì¡É½Ü°Í•…É °l‰Õå•É9…µ”œ°€‰Õå•ÉÉ½ÕÁ9…µ”œ°€‰Õå•ÉQÉ…‘•Èœ°€ÍÑ•µ9…µ”œ°€­•åMÑ•´t¤¤ì(€½¹ÍÐÉ•Á½ÉÐ€ôì(€€€€¸¸¹Í½ÕÉ”°(€€€É½ÝÌ°(€€€‰Õå•É¥…%¹Ù½¥•Ì°(€€€Í•…É °(€€€ÍÕµµ…Éäè¥¹½µ¥¹A…åµ•¹ÑI•Á½ÉÑMÕµµ…Éä¡É½ÝÌ¤°(€ôì(€½¹ÍÐ•µ…¥°€ô‰Õ¥±‘%¹½µ¥¹A…åµ•¹Ñµ…¥°¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì¤ì(€½¹ÍÐÉ•Á½ÉÑ5•Ñ„€ôì(€€€‘…Ñ•É½´èÉ•Á½ÉÐ¹‘…Ñ•É½´°(€€€‘…Ñ•Q¼èÉ•Á½ÉÐ¹‘…Ñ•Q¼°(€€€Í•…É °(€€€É••¥Ù…‰±•I½ÝÌèÉ½ÝÌ¹±•¹Ñ °(€€€‰Õå•É¥…I½ÝÌè‰Õå•É¥…%¹Ù½¥•Ì¹±•¹Ñ °(€€€ÍÕµµ…Éäè•µ…¥°¹ÍÕµµ…Éä°(€ôì(€¥˜€¡‰½‘ä¹ÁÉ•Ù¥•Üñð‰½‘ä¹‘ÉåIÕ¸¤ì(€€€É•ÑÕÉ¸ì(€€€€€Í•¹Ðè™…±Í”°(€€€€€ÁÉ•Ù¥•ÜèÑÉÕ”°(€€€€€Í•ÑÑ¥¹Ì°(€€€€€É•Á½ÉÐèÉ•Á½ÉÑ5•Ñ„°(€€€€€•µ…¥°èì(€€€€€€€ÍÕ‰©•Ðè•µ…¥°¹ÍÕ‰©•Ð°(€€€€€€€¡Ñµ°è•µ…¥°¹¡Ñµ°°(€€€€€€€Ñ•áÐè•µ…¥°¹Ñ•áÐ°(€€€€€€€ÍÕµµ…Éäè•µ…¥°¹ÍÕµµ…Éä°(€€€€€ô°(€€€ôì(€ô(€¥˜€ …Í•ÑÑ¥¹Ì¹Ñ¼¹±•¹Ñ ¤Ñ¡É½Ü…ÁÁÉÉ½È Ð±•…ÍÐ½¹”Q¼É•¥Á¥•¹Ð¥ÌÉ•ÅÕ¥É•‰•™½É”Í•¹‘¥¹œÑ¡”%¹½µ¥¹œA…åµ•¹ÐÉ•Á½ÉÐ¸œ°€ÐÀÀ¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÍ•¹‘=Á•É…Ñ¥½¹…±5…¥°¡ì(€€€Ñ¼èÍ•ÑÑ¥¹Ì¹Ñ¼°(€€€ŒèÍ•ÑÑ¥¹Ì¹Œ°(€€€‰ŒèÍ•ÑÑ¥¹Ì¹‰Œ°(€€€ÍÕ‰©•Ðè•µ…¥°¹ÍÕ‰©•Ð°(€€€¡Ñµ°è•µ…¥°¹¡Ñµ°°(€€€Ñ•áÐè•µ…¥°¹Ñ•áÐ°(€ô°ì±¥•¹Ðè…Ñ¥Ù••ÍÌ¹±¥•¹Ð°ÁÕÉÁ½Í•-•äè€¥¹½µ¥¹}Á…åµ•¹Ñ}É•Á½ÉÑÌœô¤ì(€É•ÑÕÉ¸ì(€€€Í•¹ÐèÑÉÕ”°(€€€¥èÉ•ÍÕ±Ð¹¥°(€€€Ñ¼èÍ•ÑÑ¥¹Ì¹Ñ¼°(€€€ŒèÍ•ÑÑ¥¹Ì¹Œ°(€€€‰ŒèÍ•ÑÑ¥¹Ì¹‰Œ°(€€€ÍÕ‰©•Ðè•µ…¥°¹ÍÕ‰©•Ð°(€€€É•Á½ÉÐèÉ•Á½ÉÑ5•Ñ„°(€€€É½ÝÌèÉ½ÝÌ¹±•¹Ñ °(€€€‰Õå•É¥…I½ÝÌè‰Õå•É¥…%¹Ù½¥•Ì¹±•¹Ñ °(€€€•µ…¥°èì(€€€€€ÍÕ‰©•Ðè•µ…¥°¹ÍÕ‰©•Ð°(€€€€€¡Ñµ°è•µ…¥°¹¡Ñµ°°(€€€€€Ñ•áÐè•µ…¥°¹Ñ•áÐ°(€€€€€ÍÕµµ…Éäè•µ…¥°¹ÍÕµµ…Éä°(€€€ô°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñµ…¥±M•ÑÑ¥¹Í•Ð¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐÍÑ½É•€ô…Ý…¥Ð±½…‘¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€¥¹½µ¥¹}Á…åµ•¹Ñ}É•Á½ÉÑÌœ¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹ÍÑ½É•°(€€€Í•ÑÑ¥¹Ìè¥¹½µ¥¹A…åµ•¹Ñµ…¥±M•ÑÑ¥¹Ì¡ÍÑ½É•¹Í•ÑÑ¥¹Ì¤°(€€€…Á…‰¥±¥Ñ¥•Ìèì(€€€€€…¹5…¹…•M•ÑÑ¥¹Ìè…Ý…¥ÐÕÍ•É!…Í…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€™¥¹…¹¥…±}É•Á½ÉÑ}Í•ÑÑ¥¹Í}µ…¹…”œ¤°(€€€ô°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñµ…¥±M•ÑÑ¥¹ÍM…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€™¥¹…¹¥…±}É•Á½ÉÑ}Í•ÑÑ¥¹Í}µ…¹…”œ°€¥¹…¹¥…°É•Á½ÉÐÍ•ÑÑ¥¹Ìµ…¹…•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸œ¤ì(€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥Ð±½…‘¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€¥¹½µ¥¹}Á…åµ•¹Ñ}É•Á½ÉÑÌœ¤ì(€½¹ÍÐÍ•ÑÑ¥¹Ì€ô¥¹½µ¥¹A…åµ•¹Ñµ…¥±M•ÑÑ¥¹Ì¡ì€¸¸¹ÕÉÉ•¹Ð¹Í•ÑÑ¥¹Ì°€¸¸¸¡‰½‘ä¹Í•ÑÑ¥¹Ìñð‰½‘ä¤ô¤ì(€É•ÑÕÉ¸Í…Ù•¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€¥¹½µ¥¹}Á…åµ•¹Ñ}É•Á½ÉÑÌœ°ì(€€€Í•ÑÑ¥¹Ì°(€€€•áÁ•Ñ•‘I•Ù¥Í¥½¸è‰½‘ä¹•áÁ•Ñ•‘I•Ù¥Í¥½¸€üü‰½‘ä¹•áÁ•Ñ•‘}É•Ù¥Í¥½¸°(€ô°ÁÉ½™¥±”¤ì)ô()™Õ¹Ñ¥½¸™¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Í‘¥Ñ½È¡Í•ÑÑ¥¹Ì€ôíô¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹Í•ÑÑ¥¹Ì°(€€€Ñ¼èÁ…ÉÍ•µ…¥±1¥ÍÐ¡Í•ÑÑ¥¹Ì¹Ñ¼°mt¤¹©½¥¸ œ°€œ¤°(€€€ŒèÁ…ÉÍ•µ…¥±1¥ÍÐ¡Í•ÑÑ¥¹Ì¹Œ°mt¤¹©½¥¸ œ°€œ¤°(€€€‰ŒèÁ…ÉÍ•µ…¥±1¥ÍÐ¡Í•ÑÑ¥¹Ì¹‰Œ°mt¤¹©½¥¸ œ°€œ¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑM•ÑÑ¥¹Í•Ð¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐÍÑ½É•€ô…Ý…¥Ð±½…‘¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}É•ÅÕ•ÍÑÌœ¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹ÍÑ½É•°(€€€Í•ÑÑ¥¹Ìè™¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Í‘¥Ñ½È¡ÍÑ½É•¹Í•ÑÑ¥¹Ì¤°(€€€…Á…‰¥±¥Ñ¥•Ìèì(€€€€€…¹5…¹…•M•ÑÑ¥¹Ìè…Ý…¥ÐÕÍ•É!…Í…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€™¥¹…¹¥…±}É•Á½ÉÑ}Í•ÑÑ¥¹Í}µ…¹…”œ¤°(€€€ô°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑM•ÑÑ¥¹ÍM…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€™¥¹…¹¥…±}É•Á½ÉÑ}Í•ÑÑ¥¹Í}µ…¹…”œ°€¥¹…¹¥…°É•Á½ÉÐÍ•ÑÑ¥¹Ìµ…¹…•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸œ¤ì(€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥Ð±½…‘¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}É•ÅÕ•ÍÑÌœ¤ì(€½¹ÍÐ…¹‘¥‘…Ñ”€ô¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑQ•µÁ±…Ñ”¡ì€¸¸¹ÕÉÉ•¹Ð¹Í•ÑÑ¥¹Ì°€¸¸¸¡‰½‘ä¹Í•ÑÑ¥¹Ìñð‰½‘ä¤ô¤ì(€É•ÑÕÉ¸Í…Ù•¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€¥¹½µ¥¹}Á…åµ•¹Ñ}¥¹Ñ•É•ÍÑ}É•ÅÕ•ÍÑÌœ°ì(€€€Í•ÑÑ¥¹Ìè…¹‘¥‘…Ñ”°(€€€•áÁ•Ñ•‘I•Ù¥Í¥½¸è‰½‘ä¹•áÁ•Ñ•‘I•Ù¥Í¥½¸€üü‰½‘ä¹•áÁ•Ñ•‘}É•Ù¥Í¥½¸°(€ô°ÁÉ½™¥±”¤ì)ô()™Õ¹Ñ¥½¸‰Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì¡¥¹ÁÕÐ€ôíô¤ì(€½¹ÍÐ¡…Í	Õå•ÉQÉ…‘•É¥±Ñ•È€ô=‰©•Ð¹ÁÉ½Ñ½ÑåÁ”¹¡…Í=Ý¹AÉ½Á•ÉÑä¹…±°¡¥¹ÁÕÐ°€‰Õå•ÉQÉ…‘•ÉÌœ¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹¹½Éµ…±¥é•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì¡¥¹ÁÕÐ°ì(€€€€€€¸¸¹U1Q}	UeI}%9Y=%}5%1}MQQ%9L°(€€€ô¤°(€€€¡…Í	Õå•ÉQÉ…‘•É¥±Ñ•È°(€ôì)ô()™Õ¹Ñ¥½¸Í•É¥…±¥é•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹ÍI½Ü¡É•Á½ÉÑM•ÑÑ¥¹Ì°±•…å5•Ñ„€ô¹Õ±°¤ì(€½¹ÍÐÍ•ÑÑ¥¹Ì€ô¹½Éµ…±¥é•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì¡É•Á½ÉÑM•ÑÑ¥¹Ìü¹Í•ÑÑ¥¹Ìñðíô¤ì(€É•ÑÕÉ¸ì(€€€Í•ÑÑ¥¹Ì°(€€€µ•Ñ„èì(€€€€€ÍÑ½É…•Ù…¥±…‰±”èÑÉÕ”°(€€€€€½¹™¥ÕÉ•èÉ•Á½ÉÑM•ÑÑ¥¹Ìü¹½¹™¥ÕÉ•€ôôôÑÉÕ”°(€€€€€É•Ù¥Í¥½¸è9Õµ‰•È¡É•Á½ÉÑM•ÑÑ¥¹Ìü¹É•Ù¥Í¥½¸ñð€À¤°(€€€€€±…ÍÑAÉ•Ù¥•ÝÐè±•…å5•Ñ„ü¹±…ÍÑ}ÁÉ•Ù¥•Ý}…Ðñð¹Õ±°°(€€€€€±…ÍÑAÉ•Ù¥•ÝI½Ý½Õ¹Ðè±•…å5•Ñ„ü¹±…ÍÑ}ÁÉ•Ù¥•Ý}É½Ý}½Õ¹Ð€üü¹Õ±°°(€€€€€±…ÍÑM•¹ÑÐè±•…å5•Ñ„ü¹±…ÍÑ}Í•¹Ñ}…Ðñð¹Õ±°°(€€€€€±…ÍÑM•¹ÑI½Ý½Õ¹Ðè±•…å5•Ñ„ü¹±…ÍÑ}Í•¹Ñ}É½Ý}½Õ¹Ð€üü¹Õ±°°(€€€€€±…ÍÑÉÉ½Èè±•…å5•Ñ„ü¹±…ÍÑ}•ÉÉ½Èñð¹Õ±°°(€€€€€ÕÁ‘…Ñ•‘	åµ…¥°èÉ•Á½ÉÑM•ÑÑ¥¹Ìü¹ÕÁ‘…Ñ•‘	åµ…¥°ñð¹Õ±°°(€€€€€ÕÁ‘…Ñ•‘ÐèÉ•Á½ÉÑM•ÑÑ¥¹Ìü¹ÕÁ‘…Ñ•‘Ðñð¹Õ±°°(€€€€€¹•áÑM¡•‘Õ±•‘IÕ¸è¹•áÑ	Õå•É%¹Ù½¥•M¡•‘Õ±•IÕ¸¡Í•ÑÑ¥¹Ì¤°(€€€ô°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘MÑ½É•‘	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì ¤ì(€½¹ÍÐ±¥•¹Ð€ôÍ…™•MÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤ì(€¥˜€ …±¥•¹Ð¤Ñ¡É½Ü…ÁÁÉÉ½È ¥¹…¹¥…°É•Á½ÉÐÍ•ÑÑ¥¹Ì…É”Õ¹…Ù…¥±…‰±”¸M•¹‘¥¹œ¥Ì‘¥Í…‰±•Õ¹Ñ¥°ÍÑ½É…”¥ÌÉ•ÍÑ½É•¸œ°€ÔÀÌ°€%99%1}IA=IQ}MQQ%9M}U9Y%1	1œ°Õ¹‘•™¥¹•°ÑÉÕ”¤ì(€½¹ÍÐmÉ•Á½ÉÑM•ÑÑ¥¹Ì°±•…åt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€±½…‘¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€½ÕÑÍÑ…¹‘¥¹}¥¹Ù½¥•}É•Á½ÉÑÌœ¤°(€€€±¥•¹Ð¹™É½´ ‰Õå•É}¥¹Ù½¥•}•µ…¥±}Í•ÑÑ¥¹Ìœ¤¹Í•±•Ð ±…ÍÑ}ÁÉ•Ù¥•Ý}…Ð±±…ÍÑ}ÁÉ•Ù¥•Ý}É½Ý}½Õ¹Ð±±…ÍÑ}Í•¹Ñ}…Ð±±…ÍÑ}Í•¹Ñ}É½Ý}½Õ¹Ð±±…ÍÑ}•ÉÉ½Èœ¤¹•Ä ¥œ°€‘•™…Õ±Ðœ¤¹µ…å‰•M¥¹±” ¤°(€t¤ì(€¥˜€¡±•…ä¹•ÉÉ½È¤Ñ¡É½Ü…ÁÁÉÉ½È 	Õå•È¥¹Ù½¥”É•Á½ÉÐ¡¥ÍÑ½Éä¥ÌÕ¹…Ù…¥±…‰±”¸M•¹‘¥¹œ¥Ì‘¥Í…‰±•Õ¹Ñ¥°ÍÑ½É…”¥ÌÉ•ÍÑ½É•¸œ°€ÔÀÌ°€%99%1}IA=IQ}MQQ%9M}U9Y%1	1œ°Õ¹‘•™¥¹•°ÑÉÕ”¤ì(€É•ÑÕÉ¸Í•É¥…±¥é•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹ÍI½Ü¡É•Á½ÉÑM•ÑÑ¥¹Ì°±•…ä¹‘…Ñ„¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í…Ù•MÑ½É•‘	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì¡Í•ÑÑ¥¹Ì°ÁÉ½™¥±”€ô¹Õ±°°•áÁ•Ñ•‘I•Ù¥Í¥½¸€ô¹Õ±°¤ì(€½¹ÍÐ±¥•¹Ð€ôÍÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤ì(€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥Ð±½…‘¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€½ÕÑÍÑ…¹‘¥¹}¥¹Ù½¥•}É•Á½ÉÑÌœ¤ì(€½¹ÍÐ¥¹ÁÕÑA…Ñ €ô‰Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹ÍA…Ñ ¡Í•ÑÑ¥¹Ì¤ì(€½¹ÍÐ¹½Éµ…±¥é•€ô¹½Éµ…±¥é•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì¡ì€¸¸¹ÕÉÉ•¹Ð¹Í•ÑÑ¥¹Ì°€¸¸¹¥¹ÁÕÑA…Ñ ô¤ì(€½¹ÍÐÍ•ÑÑ¥¹ÍA…Ñ €ô=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡=‰©•Ð¹­•åÌ¡¥¹ÁÕÑA…Ñ ¤¹µ…À ¡­•ä¤€ôøm­•ä°¹½Éµ…±¥é•‘m­•åut¤¤ì(€¥˜€ …=‰©•Ð¹­•åÌ¡Í•ÑÑ¥¹ÍA…Ñ ¤¹±•¹Ñ ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È 9¼É•½¹¥é•‰Õå•È¥¹Ù½¥”•µ…¥°Í•ÑÑ¥¹ÌÝ•É”ÍÕÁÁ±¥•¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐÍ…Ù•€ô…Ý…¥ÐÍ…Ù•¥¹…¹¥…±I•Á½ÉÑM•ÑÑ¥¹Ì¡±¥•¹Ð°€½ÕÑÍÑ…¹‘¥¹}¥¹Ù½¥•}É•Á½ÉÑÌœ°ì(€€€Í•ÑÑ¥¹Ìèì€¸¸¹ÕÉÉ•¹Ð¹Í•ÑÑ¥¹Ì°€¸¸¹Í•ÑÑ¥¹ÍA…Ñ ô°(€€€•áÁ•Ñ•‘I•Ù¥Í¥½¸°(€ô°ÁÉ½™¥±”¤ì(€É•ÑÕÉ¸Í•É¥…±¥é•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹ÍI½Ü¡Í…Ù•¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÕÁ‘…Ñ•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Í5•Ñ„¡Á…Ñ €ôíô¤ì(€½¹ÍÐ±¥•¹Ð€ôÍ…™•MÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤ì(€¥˜€ …±¥•¹Ð¤É•ÑÕÉ¸ì(€½¹ÍÐì•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‰Õå•É}¥¹Ù½¥•}•µ…¥±}Í•ÑÑ¥¹Ìœ¤¹ÕÁÍ•ÉÐ¡ì¥è€‘•™…Õ±Ðœ°€¸¸¹Á…Ñ ô°ì½¹½¹™±¥Ðè€¥œô¤ì(€¥˜€¡•ÉÉ½È¤½¹Í½±”¹•ÉÉ½È …¥±•Ñ¼ÕÁ‘…Ñ”‰Õå•È¥¹Ù½¥”•µ…¥°Í•ÑÑ¥¹Ìµ•Ñ…‘…Ñ„œ°•ÉÉ½È¹µ•ÍÍ…”¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‰Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Í•Ð¡‰½‘ä°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¸¡…Ý…¥Ð±½…‘MÑ½É•‘	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì ¤¤°(€€€…Á…‰¥±¥Ñ¥•Ìèì(€€€€€…¹5…¹…•M•ÑÑ¥¹Ìè…Ý…¥ÐÕÍ•É!…Í…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€™¥¹…¹¥…±}É•Á½ÉÑ}Í•ÑÑ¥¹Í}µ…¹…”œ¤°(€€€ô°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‰Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹ÍM…Ù”¡‰½‘ä°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€™¥¹…¹¥…±}É•Á½ÉÑ}Í•ÑÑ¥¹Í}µ…¹…”œ°€¥¹…¹¥…°É•Á½ÉÐÍ•ÑÑ¥¹Ìµ…¹…•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸œ¤ì(€É•ÑÕÉ¸Í…Ù•MÑ½É•‘	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì¡‰½‘ä¹Í•ÑÑ¥¹Ìñð‰½‘ä°ÁÉ½™¥±”°‰½‘ä¹•áÁ•Ñ•‘I•Ù¥Í¥½¸€üü‰½‘ä¹•áÁ•Ñ•‘}É•Ù¥Í¥½¸¤ì)ô()™Õ¹Ñ¥½¸¡½¹-½¹M¡•‘Õ±•A…ÉÑÌ¡‘…Ñ”€ô¹•Ü…Ñ” ¤¤ì(€½¹ÍÐÁ…ÉÑÌ€ô¹•Ü%¹Ñ°¹…Ñ•Q¥µ•½Éµ…Ð •¸µULœ°ì(€€€Ñ¥µ•i½¹”è€Í¥„½!½¹}-½¹œœ°(€€€Ý••­‘…äè€Í¡½ÉÐœ°(€€€å•…Èè€¹Õµ•É¥Œœ°(€€€µ½¹Ñ è€œÈµ‘¥¥Ðœ°(€€€‘…äè€œÈµ‘¥¥Ðœ°(€€€¡½ÕÈè€œÈµ‘¥¥Ðœ°(€€€µ¥¹ÕÑ”è€œÈµ‘¥¥Ðœ°(€€€¡½ÕÉå±”è€ ÈÌœ°(€ô¤¹™½Éµ…ÑQ½A…ÉÑÌ¡‘…Ñ”¤ì(€½¹ÍÐÙ…±Õ”€ô€¡ÑåÁ”¤€ôøÁ…ÉÑÌ¹™¥¹ ¡Á…ÉÐ¤€ôøÁ…ÉÐ¹ÑåÁ”€ôôôÑåÁ”¤ü¹Ù…±Õ”ì(€É•ÑÕÉ¸ì(€€€Ý••­‘…äèÙ…±Õ” Ý••­‘…äœ¤°(€€€‘…Ñ”è€‘íÙ…±Õ” å•…Èœ¥ô´‘íÙ…±Õ” µ½¹Ñ œ¥ô´‘íÙ…±Õ” ‘…äœ¥õ€°(€€€Ñ¥µ”è€‘íÙ…±Õ” ¡½ÕÈœ¥ôè‘íÙ…±Õ” µ¥¹ÕÑ”œ¥õ€°(€€€µ¥¹ÕÑ•=™…äè9Õµ‰•È¡Ù…±Õ” ¡½ÕÈœ¤¤€¨€ØÀ€¬9Õµ‰•È¡Ù…±Õ” µ¥¹ÕÑ”œ¤¤°(€ôì)ô()™Õ¹Ñ¥½¸Í¡•‘Õ±•5¥¹ÕÑ•=™…ä¡Ñ¥µ”¤ì(€½¹ÍÐµ…Ñ €ôMÑÉ¥¹œ¡Ñ¥µ”ñð€œœ¤(€€€€¹ÑÉ¥´ ¤(€€€€¹µ…Ñ  ½x¡q‘ìÄ°Éô¤è¡q‘ìÉô¤¼¤ì(€¥˜€ …µ…Ñ ¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐ¡½ÕÈ€ô9Õµ‰•È¡µ…Ñ¡lÅt¤ì(€½¹ÍÐµ¥¹ÕÑ”€ô9Õµ‰•È¡µ…Ñ¡lÉt¤ì(€¥˜€¡¡½ÕÈ€ð€Àñð¡½ÕÈ€ø€ÈÌñðµ¥¹ÕÑ”€ð€Àñðµ¥¹ÕÑ”€ø€Ôä¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸¡½ÕÈ€¨€ØÀ€¬µ¥¹ÕÑ”ì)ô()™Õ¹Ñ¥½¸‰Õå•É%¹Ù½¥•M¡•‘Õ±•‘]¥¹‘½Ü¡Í•ÑÑ¥¹Ì°‘…Ñ”€ô¹•Ü…Ñ” ¤¤ì(€½¹ÍÐ¹½Ü€ô¡½¹-½¹M¡•‘Õ±•A…ÉÑÌ¡‘…Ñ”¤ì(€½¹ÍÐÝ••­‘…åÌ€ô¹•ÜM•Ð ¡Í•ÑÑ¥¹Ì¹Ý••­‘…åÌñðmt¤¹µ…À ¡‘…ä¤€ôøMÑÉ¥¹œ¡‘…ä¤¹Í±¥” À°€Ì¤¹Ñ½1½Ý•É…Í” ¤¤¤ì(€¥˜€ …Ý••­‘…åÌ¹¡…Ì¡MÑÉ¥¹œ¡¹½Ü¹Ý••­‘…ä¤¹Í±¥” À°€Ì¤¹Ñ½1½Ý•É…Í” ¤¤¤É•ÑÕÉ¸¹Õ±°ì(€™½È€¡½¹ÍÐÑ¥µ”½˜Í•ÑÑ¥¹Ì¹Í•¹‘Q¥µ•Ìñðmt¤ì(€€€½¹ÍÐÍ¡•‘Õ±•5¥¹ÕÑ”€ôÍ¡•‘Õ±•5¥¹ÕÑ•=™…ä¡Ñ¥µ”¤ì(€€€¥˜€¡Í¡•‘Õ±•5¥¹ÕÑ”€ôô¹Õ±°¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐ‘¥™˜€ô¹½Ü¹µ¥¹ÕÑ•=™…ä€´Í¡•‘Õ±•5¥¹ÕÑ”ì(€€€¥˜€¡‘¥™˜€øô€À€˜˜‘¥™˜€ð€Ô¤ì(€€€€€½¹ÍÐÍ¡•‘Õ±•Q¥µ”€ôMÑÉ¥¹œ¡Ñ¥µ”¤¹ÑÉ¥´ ¤¹Á…‘MÑ…ÉÐ Ô°€œÀœ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€‘…Ñ”è¹½Ü¹‘…Ñ”°(€€€€€€€Ñ¥µ”èÍ¡•‘Õ±•Q¥µ”°(€€€€€€€ÉÕ¹-•äè‰Õå•Èµ¥¹Ù½¥•Ìè‘í¹½Ü¹‘…Ñ•ôè‘íÍ¡•‘Õ±•Q¥µ•õ€°(€€€€€ôì(€€€ô(€ô(€É•ÑÕÉ¸¹Õ±°ì)ô()™Õ¹Ñ¥½¸¥Í	Õå•É%¹Ù½¥•I•Á½ÉÑÕ”¡Í•ÑÑ¥¹Ì°‘…Ñ”€ô¹•Ü…Ñ” ¤¤ì(€É•ÑÕÉ¸	½½±•…¸¡‰Õå•É%¹Ù½¥•M¡•‘Õ±•‘]¥¹‘½Ü¡Í•ÑÑ¥¹Ì°‘…Ñ”¤¤ì)ô()™Õ¹Ñ¥½¸¹•áÑ	Õå•É%¹Ù½¥•M¡•‘Õ±•IÕ¸¡Í•ÑÑ¥¹Ì°™É½µ…Ñ”€ô¹•Ü…Ñ” ¤¤ì(€½¹ÍÐÝ••­‘…åÌ€ô¹•ÜM•Ð ¡Í•ÑÑ¥¹Ì¹Ý••­‘…åÌñðmt¤¹µ…À ¡‘…ä¤€ôøMÑÉ¥¹œ¡‘…ä¤¹Í±¥” À°€Ì¤¹Ñ½1½Ý•É…Í” ¤¤¤ì(€½¹ÍÐÍ•¹‘Q¥µ•Ì€ô€¡Í•ÑÑ¥¹Ì¹Í•¹‘Q¥µ•Ìñðmt¤(€€€€¹µ…À ¡Ñ¥µ”¤€ôøMÑÉ¥¹œ¡Ñ¥µ”¤¹ÑÉ¥´ ¤¹Á…‘MÑ…ÉÐ Ô°€œÀœ¤¤(€€€€¹™¥±Ñ•È ¡Ñ¥µ”¤€ôøÍ¡•‘Õ±•5¥¹ÕÑ•=™…ä¡Ñ¥µ”¤€„ô¹Õ±°¤(€€€€¹Í½ÉÐ ¤ì(€¥˜€ …Ý••­‘…åÌ¹Í¥é”ñð€…Í•¹‘Q¥µ•Ì¹±•¹Ñ ¤É•ÑÕÉ¸¹Õ±°ì((€½¹ÍÐ¹½Ü€ô¡½¹-½¹M¡•‘Õ±•A…ÉÑÌ¡™É½µ…Ñ”¤ì(€™½È€¡±•Ð½™™Í•Ð€ô€Àì½™™Í•Ð€ð€ÄÐì½™™Í•Ð€¬ô€Ä¤ì(€€€½¹ÍÐÁÉ½‰”€ô¡½¹-½¹M¡•‘Õ±•A…ÉÑÌ¡¹•Ü…Ñ”¡™É½µ…Ñ”¹•ÑQ¥µ” ¤€¬½™™Í•Ð€¨€àØÐÀÀÀÀÀ¤¤ì(€€€¥˜€ …Ý••­‘…åÌ¹¡…Ì¡MÑÉ¥¹œ¡ÁÉ½‰”¹Ý••­‘…ä¤¹Í±¥” À°€Ì¤¹Ñ½1½Ý•É…Í” ¤¤¤½¹Ñ¥¹Õ”ì(€€€™½È€¡½¹ÍÐÑ¥µ”½˜Í•¹‘Q¥µ•Ì¤ì(€€€€€¥˜€¡½™™Í•Ð€ôôô€À€˜˜Í¡•‘Õ±•5¥¹ÕÑ•=™…ä¡Ñ¥µ”¤€ðô¹½Ü¹µ¥¹ÕÑ•=™…ä¤½¹Ñ¥¹Õ”ì(€€€€€É•ÑÕÉ¸€‘íÁÉ½‰”¹‘…Ñ•ô€‘íÑ¥µ•ô!-Q€ì(€€€ô(€ô(€É•ÑÕÉ¸¹Õ±°ì)ô()™Õ¹Ñ¥½¸½Ù•É‘Õ•M•Ù•É¥Ñä¡‘…åÍU¹Ñ¥±Õ”¤ì(€¥˜€¡‘…åÍU¹Ñ¥±Õ”€ôô¹Õ±°ñð9Õµ‰•È¡‘…åÍU¹Ñ¥±Õ”¤€ø€À¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐ½Ù•É‘Õ•…åÌ€ô5…Ñ ¹…‰Ì¡9Õµ‰•È¡‘…åÍU¹Ñ¥±Õ”¤¤ì(€¥˜€¡½Ù•É‘Õ•…åÌ€øô€ÄÐ¤É•ÑÕÉ¸€É•œì(€¥˜€¡½Ù•É‘Õ•…åÌ€øô€Ü¤É•ÑÕÉ¸€½É…¹”œì(€É•ÑÕÉ¸€å•±±½Üœì)ô()™Õ¹Ñ¥½¸½Ù•É‘Õ•¥ÍÁ±…åY…±Õ”¡‘…åÍU¹Ñ¥±Õ”¤ì(€¥˜€¡‘…åÍU¹Ñ¥±Õ”€ôô¹Õ±°¤É•ÑÕÉ¸€œ´œì(€½¹ÍÐ½Ù•É‘Õ”€ô€µ9Õµ‰•È¡‘…åÍU¹Ñ¥±Õ”¤ì(€½¹ÍÐÙ…±Õ”€ô=‰©•Ð¹¥Ì¡½Ù•É‘Õ”°€´À¤€ü€À€è½Ù•É‘Õ”ì(€É•ÑÕÉ¸Ù…±Õ”¹Ñ½1½…±•MÑÉ¥¹œ ¤ì)ô()™Õ¹Ñ¥½¸½Ù•É‘Õ•µ…¥±MÑå±•Ì¡‘…åÍU¹Ñ¥±Õ”°ÁÉÁÍÁMÑ…ÑÕÌ¤ì(€½¹ÍÐÍ•Ù•É¥Ñä€ô½Ù•É‘Õ•M•Ù•É¥Ñä¡‘…åÍU¹Ñ¥±Õ”¤ì(€½¹ÍÐÍÑå±•Ì€ôì(€€€É•èì(€€€€€É½Üè€‰…­É½Õ¹è™•”É”Èœ°(€€€€€‰½É‘•Èè€œ™„Õ„Ôœ°(€€€€€Ñ•áÐè€œŒääÅˆÅˆœ°(€€€€€Á¥±°è€‰…­É½Õ¹è™•…„í‰½É‘•Èµ½±½Èè˜àÜÄÜÄí½±½ÈèŒÝ˜ÅÅœ°(€€€ô°(€€€½É…¹”èì(€€€€€É½Üè€‰…­É½Õ¹è™•Ý…„œ°(€€€€€‰½É‘•Èè€œ™ˆäÈÍŒœ°(€€€€€Ñ•áÐè€œŒå„ÌÐÄÈœ°(€€€€€Á¥±°è€‰…­É½Õ¹è™‘‰„ÜÐí‰½É‘•Èµ½±½Èè˜äÜÌÄØí½±½ÈèŒÝŒÉÄÈœ°(€€€ô°(€€€å•±±½Üèì(€€€€€É½Üè€‰…­É½Õ¹è™‘”Øá„œ°(€€€€€‰½É‘•Èè€œ™…ŒÄÔœ°(€€€€€Ñ•áÐè€œŒàÔÑÁ”œ°(€€€€€Á¥±°è€‰…­É½Õ¹è™ÌÑí‰½É‘•Èµ½±½Èè•…ˆÌÀàí½±½ÈèŒÜÄÍ˜ÄÈœ°(€€€ô°(€ôì(€½¹ÍÐ‰…Í”€ôÍÑå±•ÍmÍ•Ù•É¥Ñåtñðì(€€€É½Üè€œœ°(€€€‰½É‘•Èè€œ”Õ”Ý•ˆœ°(€€€Ñ•áÐè€œŒÈÔØÍ•ˆœ°(€€€Á¥±°è€‰…­É½Õ¹è•™˜Ù™˜í‰½É‘•Èµ½±½Èè‰™‘‰™”í½±½ÈèŒÅÑ•àœ°(€ôì(€É•ÑÕÉ¸ÁÉÁÍÁMÑ…ÑÕÌ€ôôô€½¹‘¥Ñ¥½¹…°µ9½ÐM•¹Ðœ€üì€¸¸¹‰…Í”°É½Üè€‰…­É½Õ¹è”åÕ™˜œ°‰½É‘•Èè€œŒÀàÑ™Œœô€è‰…Í”ì)ô()™Õ¹Ñ¥½¸É•¹‘•É	Õå•É%¹Ù½¥•µ…¥±½¹Ñ•¹Ð¡Ñ•µÁ±…Ñ”°É•Á½ÉÐ°Í•ÑÑ¥¹Ì¤ì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Ñ•µÁ±…Ñ”ñðU1Q}	UeI}%9Y=%}5%1}MQQ%9L¹¥¹ÑÉ¼¤(€€€€¹É•Á±…•±° ííÉ•Á½ÉÑMÑ…ÉÑõôœ°ÁÉ•ÑÑå…Ñ”¡É•Á½ÉÐ¹Ñ½‘…ä¤¤(€€€€¹É•Á±…•±° ííÉ•Á½ÉÑ¹‘õôœ°ÁÉ•ÑÑå…Ñ”¡É•Á½ÉÐ¹‘Õ•Q¡É½Õ ¤¤(€€€€¹É•Á±…•±° íí‘…åÍ¡•…‘õôœ°MÑÉ¥¹œ¡Í•ÑÑ¥¹Ì¹‘…åÍ¡•…€üüÉ•Á½ÉÐ¹‘…åÍ¡•…€üüU1Q}	UeI}%9Y=%}5%1}MQQ%9L¹‘…åÍ¡•…¤¤ì)ô()™Õ¹Ñ¥½¸•µ…¥±½¹Ñ•¹Ñ!Ñµ°¡½¹Ñ•¹Ð¤ì(€¥˜€¡¡…Í!Ñµ±5…É­ÕÀ¡½¹Ñ•¹Ð¤¤É•ÑÕÉ¸Í…¹¥Ñ¥é•I•µ¥¹‘•É!Ñµ°¡½¹Ñ•¹Ð¤ì(€½¹ÍÐ‰±½­Ì€ôMÑÉ¥¹œ¡½¹Ñ•¹Ðñð€œœ¤(€€€€¹ÍÁ±¥Ð ½q¹ìÈ±ô¼¤(€€€€¹µ…À ¡‰±½¬¤€ôø‰±½¬¹ÑÉ¥´ ¤¤(€€€€¹™¥±Ñ•È¡	½½±•…¸¤ì(€¥˜€ …‰±½­Ì¹±•¹Ñ ¤É•ÑÕÉ¸€œœì(€É•ÑÕÉ¸‰±½­Ì(€€€€¹µ…À ¡‰±½¬°¥¹‘•à¤€ôøì(€€€€€½¹ÍÐ¡Ñµ°€ô•Í…Á•!Ñµ°¡‰±½¬¤¹É•Á±…•±° q¸œ°€œñ‰Èøœ¤ì(€€€€€¥˜€¡¥¹‘•à€ôôô€À¤É•ÑÕÉ¸€ñ ÈÍÑå±”ô‰µ…É¥¸èÀ€À€ÙÁàí™½¹ÐµÍ¥é”èÈÁÁàˆø‘í¡Ñµ±ôð½ Èù€ì(€€€€€É•ÑÕÉ¸€ñÀÍÑå±”ô‰µ…É¥¸èÀ€À€ÄÑÁàí½±½ÈèŒØØÜÀàÔˆø‘í¡Ñµ±ôð½Àù€ì(€€€ô¤(€€€€¹©½¥¸ œœ¤ì)ô()™Õ¹Ñ¥½¸‰Õå•ÉQÉ…‘•É¥±Ñ•É!Ñµ°¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì¤ì(€½¹ÍÐ½ÁÑ¥½¹Ì€ôÉ•Á½ÉÐ¹‰Õå•ÉQÉ…‘•É=ÁÑ¥½¹Ìñðmtì(€¥˜€ …½ÁÑ¥½¹Ì¹±•¹Ñ ¤É•ÑÕÉ¸€œœì(€½¹ÍÐÍ•±•Ñ•€ô¹•ÜM•Ð¡É•Á½ÉÐ¹¡…Í	Õå•ÉQÉ…‘•É¥±Ñ•È€üÉ•Á½ÉÐ¹Í•±•Ñ•‘	Õå•ÉQÉ…‘•ÉÌñðmt€è½ÁÑ¥½¹Ì¤ì(€½¹ÍÐ…±±Ñ¥Ù”€ôÍ•±•Ñ•¹Í¥é”€ôôô½ÁÑ¥½¹Ì¹±•¹Ñ ì(€½¹ÍÐ…±±UÉ°€ô‰Õå•É%¹Ù½¥•¥±Ñ•ÉUÉ°¡Í•ÑÑ¥¹Ì°É•Á½ÉÐ°¹Õ±°¤ì(€½¹ÍÐ…±±¡¥À€ô€ñ„¡É•˜ôˆ‘í•Í…Á•!Ñµ°¡…±±UÉ°¥ôˆÍÑå±”ô‰‘¥ÍÁ±…äé¥¹±¥¹”µ‰±½¬íÑ•áÐµ‘•½É…Ñ¥½¸é¹½¹”í‰½É‘•ÈèÅÁàÍ½±¥€‘í…±±Ñ¥Ù”€ü€œŒÈÔØÍ•ˆœ€è€œå”É•˜ôí‰½É‘•ÈµÉ…‘¥ÕÌèÙÁàíÁ…‘‘¥¹œèÑÁà€ÄÁÁàíµ…É¥¸èÀ€ÙÁà€ÙÁà€Àí™½¹ÐµÍ¥é”èÄÉÁàí™½¹ÐµÝ•¥¡ÐèØÀÀì‘í…±±Ñ¥Ù”€ü€‰…­É½Õ¹èŒÈÔØÍ•ˆí½±½Èè™™˜œ€è€‰…­É½Õ¹è˜á™…™Œí½±½ÈèŒÈÔØÍ•ˆôˆù±°ð½„ù€ì(€½¹ÍÐ¡¥ÁÌ€ô½ÁÑ¥½¹Ì(€€€€¹µ…À ¡¹…µ”¤€ôøì(€€€€€½¹ÍÐ…Ñ¥Ù”€ôÍ•±•Ñ•¹¡…Ì¡¹…µ”¤ì(€€€€€½¹ÍÐÕÉ°€ô‰Õå•É%¹Ù½¥•¥±Ñ•ÉUÉ°¡Í•ÑÑ¥¹Ì°É•Á½ÉÐ°¹…µ”¤ì(€€€€€É•ÑÕÉ¸€ñ„¡É•˜ôˆ‘í•Í…Á•!Ñµ°¡ÕÉ°¥ôˆÍÑå±”ô‰‘¥ÍÁ±…äé¥¹±¥¹”µ‰±½¬íÑ•áÐµ‘•½É…Ñ¥½¸é¹½¹”í‰½É‘•ÈèÅÁàÍ½±¥€‘í…Ñ¥Ù”€ü€œŒÈÔØÍ•ˆœ€è€œå”É•˜ôí‰½É‘•ÈµÉ…‘¥ÕÌèÙÁàíÁ…‘‘¥¹œèÑÁà€ÄÁÁàíµ…É¥¸èÀ€ÙÁà€ÙÁà€Àí™½¹ÐµÍ¥é”èÄÉÁàí™½¹ÐµÝ•¥¡ÐèØÀÀì‘í…Ñ¥Ù”€ü€‰…­É½Õ¹èŒÈÔØÍ•ˆí½±½Èè™™˜œ€è€‰…­É½Õ¹è˜á™…™Œí½±½ÈèŒÈÔØÍ•ˆôˆø‘í•Í…Á•!Ñµ°¡¹…µ”¥ôð½„ù€ì(€€€ô¤(€€€€¹©½¥¸ œœ¤ì(€É•ÑÕÉ¸€(€€€€ñ‘¥ØÍÑå±”ô‰µ…É¥¸èÀ€À€ÄÉÁàˆø(€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÄÅÁàí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í±•ÑÑ•ÈµÍÁ…¥¹œè¸ÀÑ•´í™½¹ÐµÝ•¥¡ÐèÜÀÀíµ…É¥¸µ‰½ÑÑ½´èÙÁàˆù=Á•¸™¥±Ñ•É•Ù¥•Ü‰ä	Õå•ÈQÉ…‘•È€¼A…åµ•¹Ð!…¹‘±•Èð½‘¥Øø(€€€€€€ñ‘¥Øø‘í…±±¡¥Áô‘í¡¥ÁÍôð½‘¥Øø(€€€€ð½‘¥Øù€ì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘	Õå•É%¹Ù½¥•I•Á½ÉÑµ…¥°¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì¤ì(€½¹ÍÐÉ½ÝÌ€ôÉ•Á½ÉÐ¹É½ÝÌñðmtì(€½¹ÍÐ½Ù•É‘Õ”€ôÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€ôôô€=Ù•É‘Õ”œ¤ì(€½¹ÍÐ‘Õ•M½½¸€ôÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€„ôô€=Ù•É‘Õ”œ¤ì(€½¹ÍÐ‘Õ•M½½¹1…‰•°€ôÕ”¥¸€‘í9Õµ‰•È¡Í•ÑÑ¥¹Ì¹‘…åÍ¡•…ñðÉ•Á½ÉÐ¹‘…åÍ¡•…ñð€Ü¤¹Ñ½1½…±•MÑÉ¥¹œ ¥ô…åÍ€ì(€½¹ÍÐ½¹Ñ•¹Ð€ôÉ•¹‘•É	Õå•É%¹Ù½¥•µ…¥±½¹Ñ•¹Ð¡Í•ÑÑ¥¹Ì¹¥¹ÑÉ¼°É•Á½ÉÐ°Í•ÑÑ¥¹Ì¤ì(€½¹ÍÐÑ½Ñ…±Ì€ôì(€€€½Ù•É‘Õ•½Õ¹Ðè½Ù•É‘Õ”¹±•¹Ñ °(€€€½Ù•É‘Õ•I••¥Ù…‰±”è½Ù•É‘Õ”¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É••¥Ù…‰±•	…±…¹”ñð€À¤°€À¤°(€€€‘Õ•M½½¹½Õ¹Ðè‘Õ•M½½¸¹±•¹Ñ °(€€€‘Õ•M½½¹I••¥Ù…‰±”è‘Õ•M½½¸¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É••¥Ù…‰±•	…±…¹”ñð€À¤°€À¤°(€ôì(€½¹ÍÐÍÕ‰©•Ð€ô€‘íÍ•ÑÑ¥¹Ì¹ÍÕ‰©•Ñô€´€‘íÁÉ•ÑÑå…Ñ”¡É•Á½ÉÐ¹Ñ½‘…ä¥õ€ì(€½¹ÍÐÍÕµµ…Éå!Ñµ°€ôÍ•ÑÑ¥¹Ì¹¥¹±Õ‘•MÕµµ…Éä(€€€€ü€(€€€€ñÑ…‰±”É½±”ô‰ÁÉ•Í•¹Ñ…Ñ¥½¸ˆÍÑå±”ô‰‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íµ…É¥¸èÄáÁà€ÀíÝ¥‘Ñ èÄÀÀ”íµ…àµÝ¥‘Ñ èØÈÁÁàˆø(€€€€€€ñÑÈø(€€€€€€€€ñÑÍÑå±”ô‰‰½É‘•ÈèÅÁàÍ½±¥€å”É•˜í‰½É‘•ÈµÉ…‘¥ÕÌèáÁà€À€À€áÁàíÁ…‘‘¥¹œèÄÉÁàí‰…­É½Õ¹è™™˜Ý˜Üˆø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÄÉÁàí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í±•ÑÑ•ÈµÍÁ…¥¹œè¸ÀÑ•´ˆù=Ù•É‘Õ”ð½‘¥Øø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÈÁÁàí™½¹ÐµÝ•¥¡ÐèÜÀÀí½±½Èè‘ŒÈØÈØˆø‘íµ½¹•ä¡Ñ½Ñ…±Ì¹½Ù•É‘Õ•I••¥Ù…‰±”¥ô€ ‘íÑ½Ñ…±Ì¹½Ù•É‘Õ•½Õ¹Ñô¤ð½‘¥Øø(€€€€€€€€ð½Ñø(€€€€€€€€ñÑÍÑå±”ô‰‰½É‘•ÈèÅÁàÍ½±¥€å”É•˜í‰½É‘•Èµ±•™ÐèÀí‰½É‘•ÈµÉ…‘¥ÕÌèÀ€áÁà€áÁà€ÀíÁ…‘‘¥¹œèÄÉÁàí‰…­É½Õ¹è˜Ý™‰™˜ˆø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÄÉÁàí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í±•ÑÑ•ÈµÍÁ…¥¹œè¸ÀÑ•´ˆø‘í•Í…Á•!Ñµ°¡‘Õ•M½½¹1…‰•°¥ôð½‘¥Øø(€€€€€€€€€€ñ‘¥ØÍÑå±”ô‰™½¹ÐµÍ¥é”èÈÁÁàí™½¹ÐµÝ•¥¡ÐèÜÀÀí½±½ÈèŒÈÔØÍ•ˆˆø‘íµ½¹•ä¡Ñ½Ñ…±Ì¹‘Õ•M½½¹I••¥Ù…‰±”¥ô€ ‘íÑ½Ñ…±Ì¹‘Õ•M½½¹½Õ¹Ñô¤ð½‘¥Øø(€€€€€€€€ð½Ñø(€€€€€€ð½ÑÈø(€€€€ð½Ñ…‰±”ù€(€€€€è€œœì(€½¹ÍÐÑ…‰±•I½ÝÌ€ôÉ½ÝÌ(€€€€¹µ…À ¡É½Ü¤€ôøì(€€€€€½¹ÍÐÍ•Ù•É¥Ñä€ô½Ù•É‘Õ•µ…¥±MÑå±•Ì¡É½Ü¹‘…åÍU¹Ñ¥±Õ”°É½Ü¹ÁÉÁÍÁMÑ…ÑÕÌ¤ì(€€€€€½¹ÍÐ•±±MÑå±”€ô‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€‘íÍ•Ù•É¥Ñä¹‰½É‘•ÉôíÁ…‘‘¥¹œèáÁà€ÄÁÁá€ì(€€€€€É•ÑÕÉ¸€(€€€€ñÑÈÍÑå±”ôˆ‘íÍ•Ù•É¥Ñä¹É½Ýôˆø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôí™½¹ÐµÝ•¥¡ÐèØÀÀíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘í•Í…Á•!Ñµ°¡É½Ü¹ÍÑ•µ9…µ”¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíµ¥¸µÝ¥‘Ñ èÄàÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹‰Õå•É9…µ”ñð€œ´œ¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíµ¥¸µÝ¥‘Ñ èÄÔÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹‰Õå•É	É½­•É9…µ•Ìñð€œ´œ¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íµ½¹•ä¡É½Ü¹¥¹Ù½¥•µ½Õ¹Ð¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíÑ•áÐµ…±¥¸éÉ¥¡Ðí™½¹ÐµÝ•¥¡ÐèØÀÀíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íµ½¹•ä¡É½Ü¹É••¥Ù…‰±•	…±…¹”¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹‰Õå•É%¹Ù½¥•Õ•…Ñ”¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíµ¥¸µÝ¥‘Ñ èÄÐÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹‰Õå•ÉQÉ…‘•É%¹¡…É”ñð€œ´œ¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíµ¥¸µÝ¥‘Ñ èÄØÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹Á…åµ•¹Ñ!…¹‘±•É9…µ”ñðÉ½Ü¹½±±•Ñ¥½¸ü¹½Ý¹•É9…µ”ñð€œ´œ¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíµ¥¸µÝ¥‘Ñ èÄØÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹ÁÉÁÍÁMÑ…ÑÕÌñð€œ´œ¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôˆø(€€€€€€€€ñÍÁ…¸ÍÑå±”ô‰‘¥ÍÁ±…äé¥¹±¥¹”µ‰±½¬í‰½É‘•ÈèÅÁàÍ½±¥í‰½É‘•ÈµÉ…‘¥ÕÌèääåÁàíÁ…‘‘¥¹œèÉÁà€áÁàí™½¹ÐµÍ¥é”èÄÉÁàí™½¹ÐµÝ•¥¡ÐèØÀÀíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àì‘íÍ•Ù•É¥Ñä¹Á¥±±ôˆø‘í•Í…Á•!Ñµ°¡É½Ü¹ÍÑ…ÑÕÌ¥ôð½ÍÁ…¸ø(€€€€€€ð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíÑ•áÐµ…±¥¸éÉ¥¡Ðí™½¹ÐµÝ•¥¡ÐèØÀÀí½±½Èè‘íÍ•Ù•É¥Ñä¹Ñ•áÑôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆø‘í½Ù•É‘Õ•¥ÍÁ±…åY…±Õ”¡É½Ü¹‘…åÍU¹Ñ¥±Õ”¥ôð½Ñø(€€€€ð½ÑÈù€ì(€€€ô¤(€€€€¹©½¥¸ œœ¤ì(€½¹ÍÐÑ…‰±•!Ñµ°€ôÍ•ÑÑ¥¹Ì¹¥¹±Õ‘•Q…‰±”(€€€€ü€(€€€€‘í‰Õå•ÉQÉ…‘•É¥±Ñ•É!Ñµ°¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì¥ô(€€€€ñ‘¥ØÍÑå±”ô‰µ…àµ¡•¥¡ÐèÐÈÁÁàí½Ù•É™±½Üé…ÕÑ¼í‰½É‘•ÈèÅÁàÍ½±¥€å”É•˜í‰½É‘•ÈµÉ…‘¥ÕÌèÄÁÁàˆø(€€€€€€ñÑ…‰±”ÍÑå±”ô‰‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íÝ¥‘Ñ èÄÀÀ”íµ¥¸µÝ¥‘Ñ èÄÈØÁÁàí™½¹ÐµÍ¥é”èÄÍÁàˆø(€€€€€€€€ñÑ¡•…ø(€€€€€€€€€€ñÑÈÍÑå±”ô‰‰…­É½Õ¹è˜á™…™Œí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í™½¹ÐµÍ¥é”èÄÅÁàí±•ÑÑ•ÈµÍÁ…¥¹œè¸ÀÑ•´ˆø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸é±•™ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™ŒˆùMÑ•´ð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸é±•™ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™Œˆù	Õå•Èð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸é±•™ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™Œˆù	Õå•È	É½­•Èð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™Œˆù%¹Ù½¥”µ½Õ¹Ðð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™ŒˆùI••¥Ù…‰±”	…±…¹”ð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸é±•™ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™ŒˆùÕ”…Ñ”ð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸é±•™ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™Œˆù	Õå•ÈQÉ…‘•Èð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸é±•™ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™ŒˆùA…åµ•¹Ð½±±•Ñ¥½¸!…¹‘±•Èð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸é±•™ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™ŒˆùAMAILð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸é±•™ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™ŒˆùMÑ…ÑÕÌð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèáÁà€ÄÁÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÁ½Í¥Ñ¥½¸éÍÑ¥­äíÑ½ÀèÀí‰…­É½Õ¹è˜á™…™Œˆù=Ù•É‘Õ”ð½Ñ ø(€€€€€€€€€€ð½ÑÈø(€€€€€€€€ð½Ñ¡•…ø(€€€€€€€€ñÑ‰½‘äø‘íÑ…‰±•I½ÝÌñð€œñÑÈøñÑ½±ÍÁ…¸ôˆÄÄˆÍÑå±”ô‰Á…‘‘¥¹œèÄáÁàíÑ•áÐµ…±¥¸é•¹Ñ•Èí½±½ÈèŒØØÜÀàÔˆù9¼½ÕÑÍÑ…¹‘¥¹œ‰Õå•È¥¹Ù½¥•Ì™½Õ¹¸ð½Ñøð½ÑÈøôð½Ñ‰½‘äø(€€€€€€ð½Ñ…‰±”ø(€€€€ð½‘¥Øù€(€€€€è€œœì(€½¹ÍÐ½¹Ñ•¹Ñ!Ñµ°€ô•µ…¥±½¹Ñ•¹Ñ!Ñµ°¡½¹Ñ•¹Ð¤ì(€½¹ÍÐ¡…ÍÑÑ•¹Ñ¥½¹5…É­•È€ô€½™½Èå½ÕÈ…ÑÑ•¹Ñ¥½¹p¸½¤¹Ñ•ÍÐ¡½¹Ñ•¹Ñ!Ñµ°¤ì(€½¹ÍÐ½¹Ñ•¹ÑQ•áÐ€ô¡…Í!Ñµ±5…É­ÕÀ¡½¹Ñ•¹Ð¤€ü¡Ñµ±Q½A±…¥¹Q•áÐ¡½¹Ñ•¹Ð¤€è½¹Ñ•¹Ðì(€½¹ÍÐÉ•Á½ÉÑ	½‘å!Ñµ°€ô¡…ÍÑÑ•¹Ñ¥½¹5…É­•È€˜˜Ñ…‰±•!Ñµ°€ü€‘í¥¹Í•ÉÑ™Ñ•ÉÑÑ•¹Ñ¥½¹M•¹Ñ•¹”¡½¹Ñ•¹Ñ!Ñµ°°Ñ…‰±•!Ñµ°¥ô‘íÍÕµµ…Éå!Ñµ±õ€€è€‘í½¹Ñ•¹Ñ!Ñµ±ô‘íÍÕµµ…Éå!Ñµ±ô‘íÑ…‰±•!Ñµ±õ€ì(€½¹ÍÐ¡Ñµ°€ô€(€€€€ñ‘¥ØÍÑå±”ô‰™½¹Ðµ™…µ¥±äé%¹Ñ•È±É¥…°±Í…¹ÌµÍ•É¥˜í½±½ÈèŒÅ˜ÈäÌÜí±¥¹”µ¡•¥¡ÐèÄ¸ÐÔˆø(€€€€€€‘íÉ•Á½ÉÑ	½‘å!Ñµ±ô(€€€€ð½‘¥Øù€ì(€½¹ÍÐÑ…‰±•Q•áÐ€ôÉ½ÝÌ¹µ…À ¡É½Ü¤€ôø€‘íÉ½Ü¹ÍÑ•µ9…µ•ôð€‘íÉ½Ü¹‰Õå•É9…µ”ñð€œ´ôð	Õå•È	É½­•È€‘íÉ½Ü¹‰Õå•É	É½­•É9…µ•Ìñð€œ´ôðI••¥Ù…‰±”	…±…¹”€‘íµ½¹•ä¡É½Ü¹É••¥Ù…‰±•	…±…¹”¥ôðÕ”€‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹‰Õå•É%¹Ù½¥•Õ•…Ñ”¥ôð	Õå•ÈQÉ…‘•È€‘íÉ½Ü¹‰Õå•ÉQÉ…‘•É%¹¡…É”ñð€œ´ôðA…åµ•¹Ð½±±•Ñ¥½¸!…¹‘±•È€‘íÉ½Ü¹Á…åµ•¹Ñ!…¹‘±•É9…µ”ñðÉ½Ü¹½±±•Ñ¥½¸ü¹½Ý¹•É9…µ”ñð€œ´ôðAMAIL€‘íÉ½Ü¹ÁÉÁÍÁMÑ…ÑÕÌñð€œ´ôð€‘íÉ½Ü¹ÍÑ…ÑÕÍôð=Ù•É‘Õ”€‘í½Ù•É‘Õ•¥ÍÁ±…åY…±Õ”¡É½Ü¹‘…åÍU¹Ñ¥±Õ”¥õ€¤¹©½¥¸ q¸œ¤ì(€½¹ÍÐ¥¹ÑÉ½Q•áÐ€ô¡…ÍÑÑ•¹Ñ¥½¹5…É­•È€˜˜Ñ…‰±•Q•áÐ€ü¥¹Í•ÉÑ™Ñ•ÉÑÑ•¹Ñ¥½¹M•¹Ñ•¹”¡½¹Ñ•¹ÑQ•áÐ°q¹q¸‘íÑ…‰±•Q•áÑõq¹q¹€¤€è½¹Ñ•¹ÑQ•áÐì(€½¹ÍÐÑ•áÑ1¥¹•Ì€ôm¥¹ÑÉ½Q•áÐ°=Ù•É‘Õ”è€‘íµ½¹•ä¡Ñ½Ñ…±Ì¹½Ù•É‘Õ•I••¥Ù…‰±”¥ô€ ‘íÑ½Ñ…±Ì¹½Ù•É‘Õ•½Õ¹Ñô¥€°€‘í‘Õ•M½½¹1…‰•±ôè€‘íµ½¹•ä¡Ñ½Ñ…±Ì¹‘Õ•M½½¹I••¥Ù…‰±”¥ô€ ‘íÑ½Ñ…±Ì¹‘Õ•M½½¹½Õ¹Ñô¥€°=Á•¸…±°¥¹Ù½¥•Ìè€‘í‰Õå•É%¹Ù½¥•¥±Ñ•ÉUÉ°¡Í•ÑÑ¥¹Ì°É•Á½ÉÐ°¹Õ±°¥õ€°€¸¸¸¡É•Á½ÉÐ¹‰Õå•ÉQÉ…‘•É=ÁÑ¥½¹Ìñðmt¤¹µ…À ¡¹…µ”¤€ôø=Á•¸€‘í¹…µ•ôè€‘í‰Õå•É%¹Ù½¥•¥±Ñ•ÉUÉ°¡Í•ÑÑ¥¹Ì°É•Á½ÉÐ°¹…µ”¥õ€¤°€œœ°€¸¸¸¡¡…ÍÑÑ•¹Ñ¥½¹5…É­•È€ümt€èÉ½ÝÌ¹µ…À ¡É½Ü¤€ôø€‘íÉ½Ü¹ÍÑ•µ9…µ•ôð€‘íÉ½Ü¹‰Õå•É9…µ”ñð€œ´ôð	Õå•È	É½­•È€‘íÉ½Ü¹‰Õå•É	É½­•É9…µ•Ìñð€œ´ôðI••¥Ù…‰±”	…±…¹”€‘íµ½¹•ä¡É½Ü¹É••¥Ù…‰±•	…±…¹”¥ôðÕ”€‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹‰Õå•É%¹Ù½¥•Õ•…Ñ”¥ôð	Õå•ÈQÉ…‘•È€‘íÉ½Ü¹‰Õå•ÉQÉ…‘•É%¹¡…É”ñð€œ´ôðA…åµ•¹Ð½±±•Ñ¥½¸!…¹‘±•È€‘íÉ½Ü¹Á…åµ•¹Ñ!…¹‘±•É9…µ”ñðÉ½Ü¹½±±•Ñ¥½¸ü¹½Ý¹•É9…µ”ñð€œ´ôðAMAIL€‘íÉ½Ü¹ÁÉÁÍÁMÑ…ÑÕÌñð€œ´ôð€‘íÉ½Ü¹ÍÑ…ÑÕÍôð=Ù•É‘Õ”€‘í½Ù•É‘Õ•¥ÍÁ±…åY…±Õ”¡É½Ü¹‘…åÍU¹Ñ¥±Õ”¥õ€¤¥tì(€É•ÑÕÉ¸ìÍÕ‰©•Ð°¡Ñµ°°Ñ•áÐèÑ•áÑ1¥¹•Ì¹©½¥¸ q¸œ¤°Ñ½Ñ…±Ìôì)ô()™Õ¹Ñ¥½¸¥ÍÉ…Ñ•±±¥½ÍÕ±¥¡	Õå•ÉÉ½ÕÀ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸€½q‰™É…Ñ•±±¥qÌ­½ÍÕ±¥¡qˆ½¤¹Ñ•ÍÐ¡MÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤¤ì)ô()™Õ¹Ñ¥½¸É½Ý	Õå•ÉI•µ¥¹‘•ÉI•¥Á¥•¹ÑÌ¡É½Ü¤ì(€É•ÑÕÉ¸Õ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É½Üü¹Á…åµ•¹ÑI•µ¥¹‘•ÉI•¥Á¥•¹ÑÌñðmt°É½Üü¹Á…åµ•¹ÑI•µ¥¹‘•ÉI•¥Á¥•¹Ðñð€œœ°É½Üü¹‰Õå•É½Õ¹ÑÍµ…¥°ñð€œœ°É½Üü¹‰Õå•ÉQÉ…‘•Éµ…¥°ñð€œœ°É½Üü¹Á…åµ•¹Ñ!…¹‘±•Éµ…¥°ñð€œœ¤ì)ô()™Õ¹Ñ¥½¸É½Ý	É½­•ÉI•µ¥¹‘•Éµ…¥±Ì¡É½Ü¤ì(€É•ÑÕÉ¸Õ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É½Üü¹‰Õå•É	É½­•Éµ…¥±Ìñð€œœ¤ì)ô()™Õ¹Ñ¥½¸Á…åµ•¹ÑI•µ¥¹‘•ÉI½ÝI½ÕÑ¥¹œ¡É½Ü¤ì(€½¹ÍÐ‰Õå•ÉI•¥Á¥•¹ÑÌ€ôÉ½Ý	Õå•ÉI•µ¥¹‘•ÉI•¥Á¥•¹ÑÌ¡É½Ü¤ì(€½¹ÍÐ‰É½­•Éµ…¥±Ì€ôÉ½Ý	É½­•ÉI•µ¥¹‘•Éµ…¥±Ì¡É½Ü¤ì(€½¹ÍÐ‰É½­•É9…µ•Ì€ôÕ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡MÑÉ¥¹œ¡É½Üü¹‰Õå•É	É½­•É9…µ•Ìñð€œœ¤¹ÍÁ±¥Ð œ°œ¤¤ì(€½¹ÍÐµ½‘”€ôÉ½Üü¹‰Õå•É	É½­•ÉI½ÕÑ¥¹5½‘”ñð€‰Õå•É}½¹±äœì(€¥˜€¡µ½‘”€ôôô€‰É½­•É}½¹±äœ¤ì(€€€É•ÑÕÉ¸ì(€€€€€µ½‘”°(€€€€€Ñ¼è‰É½­•Éµ…¥±Ì°(€€€€€Œèmt°(€€€€€‰Œèmt°(€€€€€ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”è‰É½­•É9…µ•ÍlÁtñðÉ½Üü¹‰Õå•É	É½­•É9…µ•Ìñð€	É½­•Èœ°(€€€€€Ý…É¹¥¹ÌèÉ½Üü¹‰Õå•É	É½­•ÉI½ÕÑ¥¹]…É¹¥¹Ìñðmt°(€€€ôì(€ô(€¥˜€¡µ½‘”€ôôô€‰Õå•É}}‰É½­•Èœ¤ì(€€€É•ÑÕÉ¸ì(€€€€€µ½‘”°(€€€€€Ñ¼è‰Õå•ÉI•¥Á¥•¹ÑÌ°(€€€€€Œè‰É½­•Éµ…¥±Ì°(€€€€€‰Œèmt°(€€€€€ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”èÉ½Üü¹‰Õå•É9…µ”ñð€ÕÍÑ½µ•Èœ°(€€€€€Ý…É¹¥¹ÌèÉ½Üü¹‰Õå•É	É½­•ÉI½ÕÑ¥¹]…É¹¥¹Ìñðmt°(€€€ôì(€ô(€É•ÑÕÉ¸ì(€€€µ½‘”è€‰Õå•É}½¹±äœ°(€€€Ñ¼è‰Õå•ÉI•¥Á¥•¹ÑÌ°(€€€Œèmt°(€€€‰Œè‰É½­•Éµ…¥±Ì°(€€€ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”èÉ½Üü¹‰Õå•É9…µ”ñð€ÕÍÑ½µ•Èœ°(€€€Ý…É¹¥¹ÌèÉ½Üü¹‰Õå•É	É½­•ÉI½ÕÑ¥¹]…É¹¥¹Ìñðmt°(€ôì)ô()™Õ¹Ñ¥½¸Á…åµ•¹ÑI•µ¥¹‘•ÉI½ÕÑ¥¹½ÉI½ÝÌ¡É½ÝÌ€ômt¤ì(€½¹ÍÐÉ•ÍÕ±ÑÉ½ÕÁÌ€ôÉ½ÕÁA…åµ•¹ÑI•µ¥¹‘•ÉI½ÝÌ¡É½ÝÌ°Á…åµ•¹ÑI•µ¥¹‘•ÉI½ÝI½ÕÑ¥¹œ¤ì(€É•ÑÕÉ¸ì(€€€É½ÕÁÌèÉ•ÍÕ±ÑÉ½ÕÁÌ°(€€€Ñ¼èÕ¹¥ÅÕ•µ…¥±1¥ÍÐ ¸¸¹É•ÍÕ±ÑÉ½ÕÁÌ¹µ…À ¡É½ÕÀ¤€ôøÉ½ÕÀ¹Ñ¼¤¤°(€€€ŒèÕ¹¥ÅÕ•µ…¥±1¥ÍÐ ¸¸¹É•ÍÕ±ÑÉ½ÕÁÌ¹µ…À ¡É½ÕÀ¤€ôøÉ½ÕÀ¹Œ¤¤°(€€€‰ŒèÕ¹¥ÅÕ•µ…¥±1¥ÍÐ ¸¸¹É•ÍÕ±ÑÉ½ÕÁÌ¹µ…À ¡É½ÕÀ¤€ôøÉ½ÕÀ¹‰Œ¤¤°(€€€Ý…É¹¥¹ÌèÕ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡É•ÍÕ±ÑÉ½ÕÁÌ¹™±…Ñ5…À ¡É½ÕÀ¤€ôøÉ½ÕÀ¹Ý…É¹¥¹Ì¤¤°(€ôì)ô()™Õ¹Ñ¥½¸Á…åµ•¹ÑI•µ¥¹‘•ÉI•¥Á¥•¹ÑÌ¡É½ÝÌ¤ì(€É•ÑÕÉ¸Á…åµ•¹ÑI•µ¥¹‘•ÉI½ÕÑ¥¹½ÉI½ÝÌ¡É½ÝÌ¤¹Ñ¼ì)ô()™Õ¹Ñ¥½¸Á…åµ•¹ÑI•µ¥¹‘•ÉQ•µÁ±…Ñ•½¹Ñ•áÐ¡É•Á½ÉÐ°É½ÝÌ°Í•±•Ñ•°É½ÕÑ¥¹œ€ô¹Õ±°¤ì(€½¹ÍÐÑ½Ñ…±I••¥Ù…‰±”€ô€¡É½ÝÌñðmt¤¹É•‘Õ” ¡ÍÕ´°É½Ü¤€ôøÍÕ´€¬9Õµ‰•È¡É½Ü¹É••¥Ù…‰±•	…±…¹”ñð€À¤°€À¤ì(€½¹ÍÐÍ•±•Ñ•‘I½Ü€ôÍ•±•Ñ•ñðíôì(€½¹ÍÐ‰É½­•ÉI½ÝÌ€ôÉ½ÝÌü¹±•¹Ñ €üÉ½ÝÌ€èmÍ•±•Ñ•‘I½Ýtì(€½¹ÍÐÉ½ÕÑ¥¹%¹™¼€ôÉ½ÕÑ¥¹œñðÁ…åµ•¹ÑI•µ¥¹‘•ÉI½ÕÑ¥¹½ÉI½ÝÌ¡É½ÝÌñðmt¤¹É½ÕÁÍlÁtñð¹Õ±°ì(€É•ÑÕÉ¸ì(€€€ÍÑ•µ9…µ”èÍ•±•Ñ•‘I½Ü¹ÍÑ•µ9…µ”ñð€œœ°(€€€­•åMÑ•´èÍ•±•Ñ•‘I½Ü¹­•åMÑ•´ñð€œœ°(€€€‰Õå•É9…µ”èÍ•±•Ñ•‘I½Ü¹‰Õå•É9…µ”ñð€ÕÍÑ½µ•Èœ°(€€€ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”èÉ½ÕÑ¥¹%¹™¼ü¹ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”ñðÍ•±•Ñ•‘I½Ü¹‰Õå•É9…µ”ñð€ÕÍÑ½µ•Èœ°(€€€‰Õå•ÉÉ½ÕÁ9…µ”èÍ•±•Ñ•‘I½Ü¹‰Õå•ÉÉ½ÕÁ9…µ”ñð€œœ°(€€€¥¹Ù½¥•µ½Õ¹Ðèµ½¹•ä¡Í•±•Ñ•‘I½Ü¹¥¹Ù½¥•µ½Õ¹Ð¤°(€€€É••¥Ù…‰±•	…±…¹”èµ½¹•ä¡Í•±•Ñ•‘I½Ü¹É••¥Ù…‰±•	…±…¹”¤°(€€€‰Õå•É%¹Ù½¥•Õ•…Ñ”èÁÉ•ÑÑå…Ñ”¡Í•±•Ñ•‘I½Ü¹‰Õå•É%¹Ù½¥•Õ•…Ñ”¤°(€€€‰Õå•ÉQÉ…‘•É%¹¡…É”èÍ•±•Ñ•‘I½Ü¹‰Õå•ÉQÉ…‘•É%¹¡…É”ñð€œœ°(€€€‰Õå•É½Õ¹ÑÍµ…¥°èÍ•±•Ñ•‘I½Ü¹‰Õå•É½Õ¹ÑÍµ…¥°ñð€œœ°(€€€‰Õå•ÉQÉ…‘•Éµ…¥°èÍ•±•Ñ•‘I½Ü¹‰Õå•ÉQÉ…‘•Éµ…¥°ñð€œœ°(€€€Á…åµ•¹Ñ!…¹‘±•É9…µ”èÍ•±•Ñ•‘I½Ü¹Á…åµ•¹Ñ!…¹‘±•É9…µ”ñðÍ•±•Ñ•‘I½Ü¹½±±•Ñ¥½¸ü¹½Ý¹•É9…µ”ñð€œœ°(€€€Á…åµ•¹Ñ!…¹‘±•Éµ…¥°èÍ•±•Ñ•‘I½Ü¹Á…åµ•¹Ñ!…¹‘±•Éµ…¥°ñð€œœ°(€€€‰Õå•É	É½­•É9…µ•ÌèÕ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡‰É½­•ÉI½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹‰Õå•É	É½­•É9…µ•Ì¤¤¹©½¥¸ œ°€œ¤°(€€€‰Õå•É	É½­•Éµ…¥±ÌèÕ¹¥ÅÕ•µ…¥±1¥ÍÐ ¸¸¹‰É½­•ÉI½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹‰Õå•É	É½­•Éµ…¥±Ìñð€œœ¤¤¹©½¥¸ œ°€œ¤°(€€€‰Õå•É	É½­•É%¹Ù½¥•½Éµ…ÑÌèÕ¹¥ÅÕ•Q•áÑ1¥ÍÐ¡‰É½­•ÉI½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹‰Õå•É	É½­•É%¹Ù½¥•½Éµ…ÑÌ¤¤¹©½¥¸ œ°€œ¤°(€€€Ñ½I•¥Á¥•¹ÑÌèÉ½ÕÑ¥¹%¹™¼€üÉ½ÕÑ¥¹%¹™¼¹Ñ¼¹©½¥¸ œ°€œ¤€èÁ…åµ•¹ÑI•µ¥¹‘•ÉI•¥Á¥•¹ÑÌ¡É½ÝÌ¤¹©½¥¸ œ°€œ¤°(€€€ÁÍÁÉÍMÑ…ÑÕÌèÍ•±•Ñ•‘I½Ü¹ÁÉÁÍÁMÑ…ÑÕÌñð€œœ°(€€€½Ù•É‘Õ”è½Ù•É‘Õ•¥ÍÁ±…åY…±Õ”¡Í•±•Ñ•‘I½Ü¹‘…åÍU¹Ñ¥±Õ”¤°(€€€¥¹Ù½¥•MÑ…ÑÕÌèÍ•±•Ñ•‘I½Ü¹ÍÑ…ÑÕÌñð€œœ°(€€€‘…åÍ¡•…èMÑÉ¥¹œ¡É•Á½ÉÐ¹‘…åÍ¡•…€üüU1Q}	UeI}%9Y=%}5%1}MQQ%9L¹‘…åÍ¡•…¤°(€€€Ñ½‘…äèÁÉ•ÑÑå…Ñ”¡É•Á½ÉÐ¹Ñ½‘…ä¤°(€€€‘Õ•Q¡É½Õ èÁÉ•ÑÑå…Ñ”¡É•Á½ÉÐ¹‘Õ•Q¡É½Õ ¤°(€€€¥¹Ù½¥•½Õ¹ÐèMÑÉ¥¹œ ¡É½ÝÌñðmt¤¹±•¹Ñ ¤°(€€€Ñ½Ñ…±I••¥Ù…‰±”èµ½¹•ä¡Ñ½Ñ…±I••¥Ù…‰±”¤°(€ôì)ô()™Õ¹Ñ¥½¸É•¹‘•ÉA…åµ•¹ÑI•µ¥¹‘•ÉQ•µÁ±…Ñ”¡Ñ•µÁ±…Ñ”°½¹Ñ•áÐ¤ì(€½¹ÍÐÙ…±Õ•Ì€ô½¹Ñ•áÐñðíôì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Ñ•µÁ±…Ñ”ñð€œœ¤¹É•Á±…” ½qíqíqÌ¨¡mµi„µèÀ´å}t¬¥qÌ©qõqô½œ°€¡µ…Ñ °­•ä¤€ôø€¡=‰©•Ð¹ÁÉ½Ñ½ÑåÁ”¹¡…Í=Ý¹AÉ½Á•ÉÑä¹…±°¡Ù…±Õ•Ì°­•ä¤€üÙ…±Õ•Ím­•åt€èµ…Ñ ¤¤ì)ô()™Õ¹Ñ¥½¸É•¹‘•ÉA…åµ•¹ÑI•µ¥¹‘•Éµ…¥±1¥ÍÐ¡Ù…±Õ”°½¹Ñ•áÐ¤ì(€½¹ÍÐÉ…Ü€ôÉÉ…ä¹¥ÍÉÉ…ä¡Ù…±Õ”¤€üÙ…±Õ”¹©½¥¸ œ°€œ¤€èMÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤ì(€É•ÑÕÉ¸Á…ÉÍ•µ…¥±1¥ÍÐ¡É•¹‘•ÉA…åµ•¹ÑI•µ¥¹‘•ÉQ•µÁ±…Ñ”¡É…Ü°½¹Ñ•áÐ¤°mt¤ì)ô()™Õ¹Ñ¥½¸¡…Í!Ñµ±5…É­ÕÀ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸€¼ñp¼ým„µéumqÍqMt¨ø½¤¹Ñ•ÍÐ¡MÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤¤ì)ô()™Õ¹Ñ¥½¸Í…¹¥Ñ¥é•I•µ¥¹‘•É!Ñµ°¡Ù…±Õ”¤ì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤(€€€€¹É•Á±…” ¼ñÍÉ¥ÁÑmqÍqMt¨üùmqÍqMt¨üñp½ÍÉ¥ÁÐø½¤°€œœ¤(€€€€¹É•Á±…” ¼ñÍÑå±•mqÍqMt¨üùmqÍqMt¨üñp½ÍÑå±”ø½¤°€œœ¤(€€€€¹É•Á±…” ½qÍ½¹m„µét­qÌ¨õqÌ¨¡lœ‰t¤¸¨ýpÄ½¤°€œœ¤(€€€€¹É•Á±…” ½qÍ½¹m„µét­qÌ¨õqÌ©myqÌùt¬½¤°€œœ¤(€€€€¹É•Á±…” ½©…Ù…ÍÉ¥ÁÐè½¤°€œœ¤ì)ô()™Õ¹Ñ¥½¸¡Ñµ±Q½A±…¥¹Q•áÐ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤(€€€€¹É•Á±…” ¼ñ‰ÉqÌ©p¼üø½¤°€q¸œ¤(€€€€¹É•Á±…” ¼ñp½Àø½¤°€q¹q¸œ¤(€€€€¹É•Á±…” ¼ñmxùt¬ø½œ°€œœ¤(€€€€¹É•Á±…” ¼™¹‰ÍÀì½œ°€œ€œ¤(€€€€¹É•Á±…” ¼™…µÀì½œ°€œ˜œ¤(€€€€¹É•Á±…” ¼™±Ðì½œ°€œðœ¤(€€€€¹É•Á±…” ¼™Ðì½œ°€œøœ¤(€€€€¹É•Á±…” ¼™ÅÕ½Ðì½œ°€œˆœ¤(€€€€¹É•Á±…” ¼˜ŒÀÌäì½œ°€ˆœˆ¤(€€€€¹É•Á±…” ½q¹ìÌ±ô½œ°€q¹q¸œ¤(€€€€¹ÑÉ¥´ ¤ì)ô()™Õ¹Ñ¥½¸Á…åµ•¹ÑI•µ¥¹‘•É½¹Ñ•¹Ñ!Ñµ°¡½¹Ñ•¹Ð¤ì(€½¹ÍÐ¡Ñµ°€ô¡…Í!Ñµ±5…É­ÕÀ¡½¹Ñ•¹Ð¤(€€€€üÍ…¹¥Ñ¥é•I•µ¥¹‘•É!Ñµ°¡½¹Ñ•¹Ð¤(€€€€èMÑÉ¥¹œ¡½¹Ñ•¹Ðñð€œœ¤(€€€€€€€€¹ÍÁ±¥Ð ½q¹ìÈ±ô¼¤(€€€€€€€€¹µ…À ¡‰±½¬¤€ôø€ñÀø‘í•Í…Á•!Ñµ°¡‰±½¬¹ÑÉ¥´ ¤¤¹É•Á±…•±° q¸œ°€œñ‰Èøœ¥ôð½Àù€¤(€€€€€€€€¹©½¥¸ œœ¤ì(€½¹ÍÐµ…Ñ¡•Ì€ôl¸¸¹¡Ñµ°¹µ…Ñ¡±° ¼ñÁq‰mxùt¨ø¡mqÍqMt¨ü¤ñp½Àø½¤¥tì(€½¹ÍÐÁ…É…É…Á¡Ì€ôµ…Ñ¡•Ì¹±•¹Ñ €üµ…Ñ¡•Ì¹µ…À ¡µ…Ñ ¤€ôøµ…Ñ¡lÅt¤€è¡Ñµ°¹ÍÁ±¥Ð ¼ñ‰ÉqÌ©p¼üùñq¹ìÈ±ô½¤¤¹µ…À ¡‰±½¬¤€ôø•Í…Á•!Ñµ°¡‰±½¬¹ÑÉ¥´ ¤¤¤ì(€É•ÑÕÉ¸Á…É…É…Á¡Ì(€€€€¹µ…À ¡¥¹¹•È¤€ôø¥¹¹•È¹ÑÉ¥´ ¤¤(€€€€¹™¥±Ñ•È ¡¥¹¹•È¤€ôø¡Ñµ±Q½A±…¥¹Q•áÐ¡¥¹¹•È¤¹ÑÉ¥´ ¤¤(€€€€¹µ…À ¡¥¹¹•È¤€ôøì(€€€€€½¹ÍÐÑ•áÐ€ô¡Ñµ±Q½A±…¥¹Q•áÐ¡¥¹¹•È¤¹É•Á±…” ½qÌ¬½œ°€œ€œ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€€€€€±•Ðµ…É¥¸€ô€œÀ€À€ÄÉÁàœì(€€€€€¥˜€ ½yÑ½qÌ¬¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤µ…É¥¸€ô€œÀ€À€ÍÁàœì(€€€€€•±Í”¥˜€ ½y…ÑÑ¹qˆ¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤µ…É¥¸€ô€œÀ€À€ÄáÁàœì(€€€€€•±Í”¥˜€ ½yÉ•…É‘Ì°ü¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤µ…É¥¸€ô€œÈÑÁà€À€ÍÁàœì(€€€€€•±Í”¥˜€ ½y™É…Ñ•±±¥qÌ­½ÍÕ±¥ ¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤µ…É¥¸€ô€œÀœì(€€€€€É•ÑÕÉ¸€ñÀÍÑå±”ô‰µ…É¥¸è‘íµ…É¥¹ôíÁ…‘‘¥¹œèÀí½±½ÈèŒÅ˜ÈäÌÜí±¥¹”µ¡•¥¡ÐèÄ¸ÌÔíÑ•áÐµ…±¥¸é±•™Ðˆø‘í¥¹¹•Éôð½Àù€ì(€€€ô¤(€€€€¹©½¥¸ œœ¤ì)ô()™Õ¹Ñ¥½¸¥¹Í•ÉÑ™Ñ•ÉÑÑ•¹Ñ¥½¹M•¹Ñ•¹”¡½¹Ñ•¹Ð°¥¹Í•ÉÑ½¹Ñ•¹Ð¤ì(€½¹ÍÐÍ½ÕÉ”€ôMÑÉ¥¹œ¡½¹Ñ•¹Ðñð€œœ¤ì(€½¹ÍÐµ…É­•È€ô€½™½Èå½ÕÈ…ÑÑ•¹Ñ¥½¹p¸½¤¹•á•Œ¡Í½ÕÉ”¤ì(€¥˜€ …µ…É­•È¤É•ÑÕÉ¸€‘íÍ½ÕÉ•ô‘í¥¹Í•ÉÑ½¹Ñ•¹Ñõ€ì(€½¹ÍÐ…™Ñ•É5…É­•È€ôµ…É­•È¹¥¹‘•à€¬µ…É­•ÉlÁt¹±•¹Ñ ì(€½¹ÍÐÉ•ÍÐ€ôÍ½ÕÉ”¹Í±¥”¡…™Ñ•É5…É­•È¤ì(€½¹ÍÐÁ…É…É…Á¡±½Í”€ô€¼ñp½Àø½¤¹•á•Œ¡É•ÍÐ¤ì(€¥˜€¡Á…É…É…Á¡±½Í”€˜˜Á…É…É…Á¡±½Í”¹¥¹‘•à€ð€ÌÀÀ¤ì(€€€½¹ÍÐ¥¹Í•ÉÑÐ€ô…™Ñ•É5…É­•È€¬Á…É…É…Á¡±½Í”¹¥¹‘•à€¬Á…É…É…Á¡±½Í•lÁt¹±•¹Ñ ì(€€€É•ÑÕÉ¸€‘íÍ½ÕÉ”¹Í±¥” À°¥¹Í•ÉÑÐ¥ô‘í¥¹Í•ÉÑ½¹Ñ•¹Ñô‘íÍ½ÕÉ”¹Í±¥”¡¥¹Í•ÉÑÐ¥õ€ì(€ô(€É•ÑÕÉ¸€‘íÍ½ÕÉ”¹Í±¥” À°…™Ñ•É5…É­•È¥õq¹q¸‘í¥¹Í•ÉÑ½¹Ñ•¹Ñô‘íÍ½ÕÉ”¹Í±¥”¡…™Ñ•É5…É­•È¥õ€ì)ô()™Õ¹Ñ¥½¸¥¹Í•ÉÑ%¹Ù½¥•Q…‰±”¡½¹Ñ•¹Ð°¥¹Í•ÉÑ½¹Ñ•¹Ð¤ì(€½¹ÍÐÍ½ÕÉ”€ôMÑÉ¥¹œ¡½¹Ñ•¹Ðñð€œœ¤ì(€¥˜€¡%9Y=%}Q	1}Q=-9}AQQI8¹Ñ•ÍÐ¡Í½ÕÉ”¤¤ì(€€€É•ÑÕÉ¸Í½ÕÉ”¹É•Á±…”¡¹•ÜI•áÀ¡€ñÁqq‰mxùt¨ùqqÌ¨‘í%9Y=%}Q	1}Q=-9}AQQI8¹Í½ÕÉ•õqqÌ¨ñqp½Àù€°€¤œ¤°¥¹Í•ÉÑ½¹Ñ•¹Ð¤¹É•Á±…”¡%9Y=%}Q	1}Q=-9}AQQI8°¥¹Í•ÉÑ½¹Ñ•¹Ð¤ì(€ô(€É•ÑÕÉ¸¥¹Í•ÉÑ™Ñ•ÉÑÑ•¹Ñ¥½¹M•¹Ñ•¹”¡Í½ÕÉ”°¥¹Í•ÉÑ½¹Ñ•¹Ð¤ì)ô()™Õ¹Ñ¥½¸‰Õ¥±‘	Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•Éµ…¥°¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì°Í•±•Ñ•°É½ÝÌ°½Ù•ÉÉ¥‘•Ì€ôíô°É½ÕÑ¥¹œ€ô¹Õ±°¤ì(€½¹ÍÐÍ•±•Ñ•‘I½ÝÌ€ôÉ½ÝÌñðmtì(€½¹ÍÐ½¹Ñ•áÐ€ôÁ…åµ•¹ÑI•µ¥¹‘•ÉQ•µÁ±…Ñ•½¹Ñ•áÐ¡É•Á½ÉÐ°Í•±•Ñ•‘I½ÝÌ°Í•±•Ñ•°É½ÕÑ¥¹œ¤ì(€½¹ÍÐÍÕ‰©•Ð€ôÉ•¹‘•ÉA…åµ•¹ÑI•µ¥¹‘•ÉQ•µÁ±…Ñ”¡½Ù•ÉÉ¥‘•Ì¹ÍÕ‰©•ÐñðÍ•ÑÑ¥¹Ì¹Á…åµ•¹ÑI•µ¥¹‘•ÉMÕ‰©•Ð°½¹Ñ•áÐ¤ì(€½¹ÍÐ‰½‘ä€ôÉ•¹‘•ÉA…åµ•¹ÑI•µ¥¹‘•ÉQ•µÁ±…Ñ”¡½Ù•ÉÉ¥‘•Ì¹‰½‘äñðÍ•ÑÑ¥¹Ì¹Á…åµ•¹ÑI•µ¥¹‘•É	½‘ä°½¹Ñ•áÐ¤ì(€½¹ÍÐÑ…‰±•I½ÝÌ€ôÍ•±•Ñ•‘I½ÝÌ(€€€€¹µ…À ¡É½Ü¤€ôøì(€€€€€½¹ÍÐÍ•Ù•É¥Ñä€ô½Ù•É‘Õ•µ…¥±MÑå±•Ì¡É½Ü¹‘…åÍU¹Ñ¥±Õ”°É½Ü¹ÁÉÁÍÁMÑ…ÑÕÌ¤ì(€€€€€½¹ÍÐ•±±MÑå±”€ô‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€‘íÍ•Ù•É¥Ñä¹‰½É‘•ÉôíÁ…‘‘¥¹œèÝÁà€áÁàíÙ•ÉÑ¥…°µ…±¥¸éÑ½Á€ì(€€€€€½¹ÍÐ¹½ÝÉ…Á•±±MÑå±”€ô€‘í•±±MÑå±•ôíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Á€ì(€€€€€É•ÑÕÉ¸€(€€€€ñÑÈÍÑå±”ôˆ‘íÍ•Ù•É¥Ñä¹É½Ýôˆø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôí™½¹ÐµÝ•¥¡ÐèØÀÀíµ¥¸µÝ¥‘Ñ èÄÔÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹ÍÑ•µ9…µ”¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíµ¥¸µÝ¥‘Ñ èÄÄÁÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹‰Õå•É9…µ”ñð€œ´œ¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í¹½ÝÉ…Á•±±MÑå±•ôíÑ•áÐµ…±¥¸éÉ¥¡Ðˆø‘íµ½¹•ä¡É½Ü¹¥¹Ù½¥•µ½Õ¹Ð¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í¹½ÝÉ…Á•±±MÑå±•ôíÑ•áÐµ…±¥¸éÉ¥¡Ðí™½¹ÐµÝ•¥¡ÐèØÀÀˆø‘íµ½¹•ä¡É½Ü¹É••¥Ù…‰±•	…±…¹”¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í¹½ÝÉ…Á•±±MÑå±•ôˆø‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹‰Õå•É%¹Ù½¥•Õ•…Ñ”¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í•±±MÑå±•ôíµ¥¸µÝ¥‘Ñ èàÑÁàˆø‘í•Í…Á•!Ñµ°¡É½Ü¹‰Õå•ÉQÉ…‘•É%¹¡…É”ñð€œ´œ¥ôð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í¹½ÝÉ…Á•±±MÑå±•ôˆø(€€€€€€€€ñÍÁ…¸ÍÑå±”ô‰‘¥ÍÁ±…äé¥¹±¥¹”µ‰±½¬í‰½É‘•ÈèÅÁàÍ½±¥í‰½É‘•ÈµÉ…‘¥ÕÌèääåÁàíÁ…‘‘¥¹œèÉÁà€áÁàí™½¹ÐµÍ¥é”èÄÉÁàí™½¹ÐµÝ•¥¡ÐèØÀÀíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àì‘íÍ•Ù•É¥Ñä¹Á¥±±ôˆø‘í•Í…Á•!Ñµ°¡É½Ü¹ÍÑ…ÑÕÌ¥ôð½ÍÁ…¸ø(€€€€€€ð½Ñø(€€€€€€ñÑÍÑå±”ôˆ‘í¹½ÝÉ…Á•±±MÑå±•ôíÑ•áÐµ…±¥¸éÉ¥¡Ðí™½¹ÐµÝ•¥¡ÐèØÀÀí½±½Èè‘íÍ•Ù•É¥Ñä¹Ñ•áÑôˆø‘í½Ù•É‘Õ•¥ÍÁ±…åY…±Õ”¡É½Ü¹‘…åÍU¹Ñ¥±Õ”¥ôð½Ñø(€€€€ð½ÑÈù€ì(€€€ô¤(€€€€¹©½¥¸ œœ¤ì(€½¹ÍÐÑ…‰±•!Ñµ°€ô€(€€€€ñ‘¥ØÍÑå±”ô‰½Ù•É™±½Üµàé…ÕÑ¼ìµÝ•‰­¥Ðµ½Ù•É™±½ÜµÍÉ½±±¥¹œéÑ½Õ í‰½É‘•ÈèÅÁàÍ½±¥€å”É•˜í‰½É‘•ÈµÉ…‘¥ÕÌèÄÁÁàíµ…É¥¸èÄÑÁà€À€ÄÙÁàíµ…àµÝ¥‘Ñ èÄÀÀ”ˆø(€€€€€€ñÑ…‰±”ÍÑå±”ô‰‰½É‘•Èµ½±±…ÁÍ”é½±±…ÁÍ”íÝ¥‘Ñ é…ÕÑ¼íµ¥¸µÝ¥‘Ñ èÄÀÀ”íµ…àµÝ¥‘Ñ é¹½¹”í™½¹ÐµÍ¥é”èÄÉÁàí±¥¹”µ¡•¥¡ÐèÄ¸ÈÔíÑ…‰±”µ±…å½ÕÐé…ÕÑ¼ˆø(€€€€€€€€ñÑ¡•…ø(€€€€€€€€€€ñÑÈÍÑå±”ô‰‰…­É½Õ¹è˜á™…™Œí½±½ÈèŒØØÜÀàÔíÑ•áÐµÑÉ…¹Í™½É´éÕÁÁ•É…Í”í™½¹ÐµÍ¥é”èÄÅÁàí±•ÑÑ•ÈµÍÁ…¥¹œè¸ÀÑ•´ˆø($€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùMÑ•´ð½Ñ ø($€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆù	Õå•Èð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆù%¹Ù½¥”ð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùI••¥Ù…‰±”ð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùÕ”…Ñ”ð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùQÉ…‘•Èð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸é±•™ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…ÀˆùMÑ…ÑÕÌð½Ñ ø(€€€€€€€€€€€€ñÑ ÍÑå±”ô‰‰½É‘•Èµ‰½ÑÑ½´èÅÁàÍ½±¥€å”É•˜íÁ…‘‘¥¹œèÝÁà€áÁàíÑ•áÐµ…±¥¸éÉ¥¡ÐíÝ¡¥Ñ”µÍÁ…”é¹½ÝÉ…Àˆù=Ù•É‘Õ”ð½Ñ ø(€€€€€€€€€€ð½ÑÈø(€€€€€€€€ð½Ñ¡•…ø(€€€€€€€€ñÑ‰½‘äø‘íÑ…‰±•I½ÝÌñð€œñÑÈøñÑ½±ÍÁ…¸ôˆàˆÍÑå±”ô‰Á…‘‘¥¹œèÄáÁàíÑ•áÐµ…±¥¸é•¹Ñ•Èí½±½ÈèŒØØÜÀàÔˆù9¼¥¹Ù½¥•ÌÍ•±•Ñ•¸ð½Ñøð½ÑÈøôð½Ñ‰½‘äø(€€€€€€ð½Ñ…‰±”ø(€€€€ð½‘¥Øù€ì(€½¹ÍÐ‰½‘å!Ñµ°€ôÁ…åµ•¹ÑI•µ¥¹‘•É½¹Ñ•¹Ñ!Ñµ°¡‰½‘ä¤ì(€½¹ÍÐ¡Ñµ±]¥Ñ¡Q…‰±”€ô¥¹Í•ÉÑ%¹Ù½¥•Q…‰±”¡‰½‘å!Ñµ°°Ñ…‰±•!Ñµ°¤ì(€½¹ÍÐ¥¹Ù½¥•Q•áÐ€ôÍ•±•Ñ•‘I½ÝÌ¹µ…À ¡É½Ü¤€ôø€‘íÉ½Ü¹ÍÑ•µ9…µ•ôð€‘íÉ½Ü¹‰Õå•É9…µ”ñð€œ´ôðI••¥Ù…‰±”	…±…¹”€‘íµ½¹•ä¡É½Ü¹É••¥Ù…‰±•	…±…¹”¥ôðÕ”€‘íÁÉ•ÑÑå…Ñ”¡É½Ü¹‰Õå•É%¹Ù½¥•Õ•…Ñ”¥ôð€‘íÉ½Ü¹ÍÑ…ÑÕÍôð=Ù•É‘Õ”€‘í½Ù•É‘Õ•¥ÍÁ±…åY…±Õ”¡É½Ü¹‘…åÍU¹Ñ¥±Õ”¥ôð	Õå•ÈQÉ…‘•È€‘íÉ½Ü¹‰Õå•ÉQÉ…‘•É%¹¡…É”ñð€œ´õ€¤¹©½¥¸ q¸œ¤ì(€½¹ÍÐ‰½‘åQ•áÐ€ô¡…Í!Ñµ±5…É­ÕÀ¡‰½‘ä¤€ü¡Ñµ±Q½A±…¥¹Q•áÐ¡‰½‘ä¤€è‰½‘äì(€½¹ÍÐ¡Ñµ°€ô€(€€€€ñ‘¥ØÍÑå±”ô‰™½¹Ðµ™…µ¥±äé%¹Ñ•È±É¥…°±Í…¹ÌµÍ•É¥˜í½±½ÈèŒÅ˜ÈäÌÜí±¥¹”µ¡•¥¡ÐèÄ¸ÐÔˆø(€€€€€€‘í¡Ñµ±]¥Ñ¡Q…‰±•ô(€€€€ð½‘¥Øù€ì(€½¹ÍÐÑ•áÐ€ô¥¹Í•ÉÑ%¹Ù½¥•Q…‰±”¡‰½‘åQ•áÐ°q¹q¸‘í¥¹Ù½¥•Q•áÑõq¹q¹€¤ì(€É•ÑÕÉ¸ìÍÕ‰©•Ð°‰½‘ä°¡Ñµ°°Ñ•áÐôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘	Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•É½¹Ñ•áÐ¡‰½‘ä€ôíô°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐÍÑ•µ%€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÑ•µ%ñð‰½‘ä¹ÍÑ•µ}¥ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …¥ÍM…±•Í™½É•%¡ÍÑ•µ%¤¤Ñ¡É½Ü…ÁÁÉÉ½È Ù…±¥M…±•Í™½É”MQ4¥ÌÉ•ÅÕ¥É•™½È„Á…åµ•¹ÐÉ•µ¥¹‘•È¸œ°€ÐÀÀ¤ì(€¥˜€¡…•ÍÍ½¹Ñ•áÐ¤…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡ÍÑ•µ%°…•ÍÍ½¹Ñ•áÐ¤ì(€½¹ÍÐmÍÑ½É•°Í•¹‘•Ét€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€±½…‘MÑ½É•‘	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì ¤°(€€€…•ÍÍ½¹Ñ•áÐü¹±¥•¹Ð(€€€€€€üÉ•Í½±Ù•É…Á¡µ…¥±M•¹‘•È¡…•ÍÍ½¹Ñ•áÐ¹±¥•¹Ð°€Á…åµ•¹Ñ}É•µ¥¹‘•ÉÌœ¤(€€€€€€èAÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤°(€t¤ì(€¥˜€¡ÍÑ½É•¹µ•Ñ„¹ÍÑ½É…•Ù…¥±…‰±”€„ôôÑÉÕ”¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È 	Õå•È%¹Ù½¥”•µ…¥°Í•ÑÑ¥¹Ì…É”Ñ•µÁ½É…É¥±äÕ¹…Ù…¥±…‰±”¸áÑ•É¹…°Á…åµ•¹ÐÉ•µ¥¹‘•ÉÌ…É”‘¥Í…‰±•Õ¹Ñ¥°ÍÑ½É…”¥ÌÉ•ÍÑ½É•¸œ°€ÔÀÌ¤ì(€ô(€½¹ÍÐÍ•ÑÑ¥¹Ì€ôì(€€€€¸¸¹‰Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì¡ÍÑ½É•¹Í•ÑÑ¥¹Ì¤°(€€€¡…Í	Õå•ÉQÉ…‘•É¥±Ñ•Èè€¡ÍÑ½É•¹Í•ÑÑ¥¹Ì¹‰Õå•ÉQÉ…‘•ÉÌñðmt¤¹±•¹Ñ €ø€À°(€ôì(€½¹ÍÐÉ•Á½ÉÐ€ô…Ý…¥ÐÍ…±•Í™½É•	Õå•É%¹Ù½¥•ÍÕ•Q…É•Ñ• (€€€ì(€€€€€‘…åÍ¡•…è‰½‘ä¹‘…åÍ¡•…€üüÍ•ÑÑ¥¹Ì¹‘…åÍ¡•…°(€€€€€…¹¡½ÉMÑ•µ%èÍÑ•µ%°(€€€€€É•ÅÕ•ÍÑ•‘MÑ•µ%‘Ìè‰½‘ä¹É•ÅÕ•ÍÑ•‘MÑ•µ%‘Ìñð‰½‘ä¹¥¹Ù½¥•MÑ•µ%‘Ì°(€€€ô°(€€€¹Õ±°°(€€€…•ÍÍ½¹Ñ•áÐ°(€€¤ì(€¥˜€¡É•Á½ÉÐ¹Á…åµ•¹ÑI•µ¥¹‘•ÉIÕ±•ÍÙ…¥±…‰±”€„ôôÑÉÕ”¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È 	Õå•È%¹Ù½¥”É•µ¥¹‘•ÈÉÕ±•Ì…É”Ñ•µÁ½É…É¥±äÕ¹…Ù…¥±…‰±”¸áÑ•É¹…°Á…åµ•¹ÐÉ•µ¥¹‘•ÉÌ…É”‘¥Í…‰±•Õ¹Ñ¥°ÍÑ½É…”¥ÌÉ•ÍÑ½É•¸œ°€ÔÀÌ¤ì(€ô(€½¹ÍÐÍ•±•Ñ•€ôÉ•Á½ÉÐ¹É½ÝÌ¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%€ôôôÍÑ•µ%¤ì(€¥˜€ …Í•±•Ñ•¤Ñ¡É½Ü…ÁÁÉÉ½È M•±•Ñ•¥¹Ù½¥”¥Ì¹¼±½¹•È¥¸Ñ¡”ÕÉÉ•¹Ð½ÕÑÍÑ…¹‘¥¹œ¥¹Ù½¥”Ý¥¹‘½Ü¸œ°€ÐÀÐ¤ì(€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôÉ•Á½ÉÐ¹É½ÝÌ(€€€€¹™¥±Ñ•È ¡É½Ü¤€ôø‰Õå•ÉI•µ¥¹‘•É…¹‘¥‘…Ñ•	å½Õ¹Ð¡É½Ü°Í•±•Ñ•¤¤(€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøì(€€€€€¥˜€¡„¹‰Õå•É%¹Ù½¥•Õ•…Ñ”€„ôôˆ¹‰Õå•É%¹Ù½¥•Õ•…Ñ”¤É•ÑÕÉ¸„¹‰Õå•É%¹Ù½¥•Õ•…Ñ”¹±½…±•½µÁ…É”¡ˆ¹‰Õå•É%¹Ù½¥•Õ•…Ñ”¤ì(€€€€€É•ÑÕÉ¸MÑÉ¥¹œ¡„¹ÍÑ•µ9…µ”ñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡ˆ¹ÍÑ•µ9…µ”ñð€œœ¤¤ì(€€€ô¤ì(€É•ÑÕÉ¸ìÍ•ÑÑ¥¹Ì°Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸è9Õµ‰•È¡ÍÑ½É•¹µ•Ñ„¹É•Ù¥Í¥½¸ñð€À¤°É•Á½ÉÐ°Í•±•Ñ•°…¹‘¥‘…Ñ•Ì°Í•¹‘•Èôì)ô()™Õ¹Ñ¥½¸ÁÉ•Á…É•A…åµ•¹ÑI•µ¥¹‘•ÉI½ÕÑ¥¹œ¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì°Í•±•Ñ•°…¹‘¥‘…Ñ•Ì¤ì(€½¹ÍÐ•±¥¥‰±•…¹‘¥‘…Ñ•Ì€ô…¹‘¥‘…Ñ•Ì¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹Á…åµ•¹ÑI•µ¥¹‘•É±¥¥‰±”€ôôôÑÉÕ”¤ì(€½¹ÍÐÉ½ÕÑ¥¹œ€ôÁ…åµ•¹ÑI•µ¥¹‘•ÉI½ÕÑ¥¹½ÉI½ÝÌ¡•±¥¥‰±•…¹‘¥‘…Ñ•Ì¤ì(€½¹ÍÐ™¥ÉÍÑÉ½ÕÀ€ôÉ½ÕÑ¥¹œ¹É½ÕÁÌ¹™¥¹ ¡É½ÕÀ¤€ôøÉ½ÕÀ¹É½ÝÌ¹Í½µ” ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%€ôôôÍ•±•Ñ•¹ÍÑ•µ%¤¤(€€€ñðÉ½ÕÑ¥¹œ¹É½ÕÁÍlÁt(€€€ñðì(€€€€€­•äè€‘•™…Õ±Ðœ°É½ÝÌè•±¥¥‰±•…¹‘¥‘…Ñ•Ì°Ñ¼èmt°Œèmt°‰Œèmt°(€€€€€ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”èÍ•±•Ñ•¹‰Õå•É9…µ”ñð€ÕÍÑ½µ•Èœ°µ½‘”è€‰Õå•É}½¹±äœ°Ý…É¹¥¹Ìèmt°(€€€ôì(€½¹ÍÐ™¥ÉÍÑM•±•Ñ•€ô™¥ÉÍÑÉ½ÕÀ¹É½ÝÌ¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%€ôôôÍ•±•Ñ•¹ÍÑ•µ%¤ñð™¥ÉÍÑÉ½ÕÀ¹É½ÝÍlÁtñðÍ•±•Ñ•ì(€½¹ÍÐÁÉ•Á…É•‘É½ÕÁÌ€ôÉ½ÕÑ¥¹œ¹É½ÕÁÌ¹µ…À ¡É½ÕÀ¤€ôøì(€€€½¹ÍÐÉ½ÕÁM•±•Ñ•€ôÉ½ÕÀ¹É½ÝÌ¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%€ôôôÍ•±•Ñ•¹ÍÑ•µ%¤ñðÉ½ÕÀ¹É½ÝÍlÁtñðÍ•±•Ñ•ì(€€€½¹ÍÐÉ½ÕÁ½¹Ñ•áÐ€ôÁ…åµ•¹ÑI•µ¥¹‘•ÉQ•µÁ±…Ñ•½¹Ñ•áÐ¡É•Á½ÉÐ°É½ÕÀ¹É½ÝÌ°É½ÕÁM•±•Ñ•°É½ÕÀ¤ì(€€€É•ÑÕÉ¸ì(€€€€€µ½‘”èÉ½ÕÀ¹µ½‘”°(€€€€€­•äèÉ½ÕÀ¹­•ä°(€€€€€Ñ¼èÉ½ÕÀ¹Ñ¼°(€€€€€ŒèÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É½ÕÀ¹Œ°É•¹‘•ÉA…åµ•¹ÑI•µ¥¹‘•Éµ…¥±1¥ÍÐ¡Í•ÑÑ¥¹Ì¹Á…åµ•¹ÑI•µ¥¹‘•ÉŒ°É½ÕÁ½¹Ñ•áÐ¤¤°(€€€€€‰ŒèÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É½ÕÀ¹‰Œ°É•¹‘•ÉA…åµ•¹ÑI•µ¥¹‘•Éµ…¥±1¥ÍÐ¡Í•ÑÑ¥¹Ì¹Á…åµ•¹ÑI•µ¥¹‘•É	Œ°É½ÕÁ½¹Ñ•áÐ¤¤°(€€€€€ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”èÉ½ÕÀ¹ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”°(€€€€€Ý…É¹¥¹ÌèÉ½ÕÀ¹Ý…É¹¥¹Ì°(€€€€€ÍÑ•µ%‘ÌèÉ½ÕÀ¹É½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%¤°(€€€ôì(€ô¤ì(€½¹ÍÐ™¥ÉÍÑAÉ•Á…É•‘É½ÕÀ€ôÁÉ•Á…É•‘É½ÕÁÌ¹™¥¹ ¡É½ÕÀ¤€ôøÉ½ÕÀ¹­•ä€ôôô™¥ÉÍÑÉ½ÕÀ¹­•ä¤(€€€ñðÁÉ•Á…É•‘É½ÕÁÍlÁt(€€€ñðìÑ¼è™¥ÉÍÑÉ½ÕÀ¹Ñ¼°Œè™¥ÉÍÑÉ½ÕÀ¹Œ°‰Œè™¥ÉÍÑÉ½ÕÀ¹‰Œôì(€½¹ÍÐ•µ…¥°€ô‰Õ¥±‘	Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•Éµ…¥°¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì°™¥ÉÍÑM•±•Ñ•°™¥ÉÍÑÉ½ÕÀ¹É½ÝÌ°íô°™¥ÉÍÑÉ½ÕÀ¤ì(€É•ÑÕÉ¸ì•±¥¥‰±•…¹‘¥‘…Ñ•Ì°É½ÕÑ¥¹œ°™¥ÉÍÑÉ½ÕÀ°™¥ÉÍÑAÉ•Á…É•‘É½ÕÀ°ÁÉ•Á…É•‘É½ÕÁÌ°•µ…¥°ôì)ô()™Õ¹Ñ¥½¸Á…åµ•¹ÑI•µ¥¹‘•ÉAÉ•Á…É…Ñ¥½¹¥¹•ÉÁÉ¥¹Ð¡ì…¹‘¥‘…Ñ•Ì°ÁÉ•Á…É•‘É½ÕÁÌ°Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸ô¤ì(€É•ÑÕÉ¸É•…Ñ•!…Í  Í¡„ÈÔØœ¤¹ÕÁ‘…Ñ”¡)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€…¹‘¥‘…Ñ•Ìè…¹‘¥‘…Ñ•Ì¹µ…À ¡É½Ü¤€ôø€¡ì(€€€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ%°(€€€€€±…ÍÑ5½‘¥™¥•‘ÐèÉ½Ü¹±…ÍÑ5½‘¥™¥•‘Ðñð¹Õ±°°(€€€€€•±¥¥‰±”èÉ½Ü¹Á…åµ•¹ÑI•µ¥¹‘•É±¥¥‰±”€ôôôÑÉÕ”°(€€€€€ÉÕ±•I•Ù¥Í¥½¸è9Õµ‰•È¡É½Ü¹É•µ¥¹‘•ÉIÕ±•I•Ù¥Í¥½¸ñð€À¤°(€€€€€ÉÕ±•UÁ‘…Ñ•‘ÐèÉ½Ü¹É•µ¥¹‘•ÉIÕ±•UÁ‘…Ñ•‘Ðñð¹Õ±°°(€€€ô¤¤¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹ÍÑ•µ%¹±½…±•½µÁ…É”¡É¥¡Ð¹ÍÑ•µ%¤¤°(€€€É½ÕÁÌèÁÉ•Á…É•‘É½ÕÁÌ¹µ…À ¡É½ÕÀ¤€ôø€¡ì(€€€€€­•äèÉ½ÕÀ¹­•ä°(€€€€€ÍÑ•µ%‘Ìèl¸¸¹É½ÕÀ¹ÍÑ•µ%‘Ít¹Í½ÉÐ ¤°(€€€€€Ñ¼èÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É½ÕÀ¹Ñ¼¤¹µ…À ¡•µ…¥°¤€ôø•µ…¥°¹Ñ½1½Ý•É…Í” ¤¤¹Í½ÉÐ ¤°(€€€€€ŒèÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É½ÕÀ¹Œ¤¹µ…À ¡•µ…¥°¤€ôø•µ…¥°¹Ñ½1½Ý•É…Í” ¤¤¹Í½ÉÐ ¤°(€€€€€‰ŒèÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É½ÕÀ¹‰Œ¤¹µ…À ¡•µ…¥°¤€ôø•µ…¥°¹Ñ½1½Ý•É…Í” ¤¤¹Í½ÉÐ ¤°(€€€ô¤¤¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹­•ä¹±½…±•½µÁ…É”¡É¥¡Ð¹­•ä¤¤°(€€€Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸°(€ô¤¤¹‘¥•ÍÐ ¡•àœ¤ì)ô()™Õ¹Ñ¥½¸Á…åµ•¹ÑI•µ¥¹‘•É½¹™±¥Ñ•Ñ…¥±Ì¡…¹‘¥‘…Ñ•Ì€ômt¤ì(€É•ÑÕÉ¸ì(€€€…¹‘¥‘…Ñ•Ìè…¹‘¥‘…Ñ•Ì¹µ…À ¡É½Ü¤€ôø€¡ì(€€€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ%°(€€€€€ÍÑ•µ9…µ”èÉ½Ü¹ÍÑ•µ9…µ”°(€€€€€‰Õå•É9…µ”èÉ½Ü¹‰Õå•É9…µ”°(€€€€€É••¥Ù…‰±•	…±…¹”èÉ½Ü¹É••¥Ù…‰±•	…±…¹”°(€€€€€‰Õå•É%¹Ù½¥•Õ•…Ñ”èÉ½Ü¹‰Õå•É%¹Ù½¥•Õ•…Ñ”°(€€€€€Á…åµ•¹ÑI•µ¥¹‘•É±¥¥‰±”èÉ½Ü¹Á…åµ•¹ÑI•µ¥¹‘•É±¥¥‰±”€ôôôÑÉÕ”°(€€€€€Á…åµ•¹ÑI•µ¥¹‘•É	±½­¥¹I•…Í½¸èÉ½Ü¹Á…åµ•¹ÑI•µ¥¹‘•É	±½­¥¹I•…Í½¸ñð¹Õ±°°(€€€€€±…ÍÑ5½‘¥™¥•‘ÐèÉ½Ü¹±…ÍÑ5½‘¥™¥•‘Ðñð¹Õ±°°(€€€ô¤¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‰Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•ÉAÉ•Á…É”¡‰½‘ä°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐÍÑ…ÉÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€½¹ÍÐ…Ñ¥Ù••ÍÌ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐìÍ•ÑÑ¥¹Ì°Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸°É•Á½ÉÐ°Í•±•Ñ•°…¹‘¥‘…Ñ•Ìô€ô…Ý…¥Ð±½…‘	Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•É½¹Ñ•áÐ¡‰½‘ä°…Ñ¥Ù••ÍÌ¤ì(€¥˜€¡Í•±•Ñ•¹Á…åµ•¹ÑI•µ¥¹‘•É±¥¥‰±”€„ôôÑÉÕ”¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È¡Í•±•Ñ•¹Á…åµ•¹ÑI•µ¥¹‘•É	±½­¥¹I•…Í½¸ñð€Q¡¥Ì¥¹Ù½¥”¥Ì¹½Ð•±¥¥‰±”™½È…¸•áÑ•É¹…°Á…åµ•¹ÐÉ•µ¥¹‘•È¸œ°€ÐÀä¤ì(€ô(€½¹ÍÐìÉ½ÕÑ¥¹œ°™¥ÉÍÑAÉ•Á…É•‘É½ÕÀ°ÁÉ•Á…É•‘É½ÕÁÌ°•µ…¥°ô€ôÁÉ•Á…É•A…åµ•¹ÑI•µ¥¹‘•ÉI½ÕÑ¥¹œ¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì°Í•±•Ñ•°…¹‘¥‘…Ñ•Ì¤ì(€½¹ÍÐÁÉ•Á…É•5Ì€ô…Ñ”¹¹½Ü ¤€´ÍÑ…ÉÑ•‘Ðì(€½¹ÍÐÁÉ•Á…É…Ñ¥½¹!…Í €ôÁ…åµ•¹ÑI•µ¥¹‘•ÉAÉ•Á…É…Ñ¥½¹¥¹•ÉÁÉ¥¹Ð¡ì…¹‘¥‘…Ñ•Ì°ÁÉ•Á…É•‘É½ÕÁÌ°Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸ô¤ì(€½¹ÍÐÁÉ•Ù¥•ÝQ½­•¸€ôÍ¥¹A…åµ•¹ÑI•µ¥¹‘•ÉAÉ•Ù¥•Ü¡ì(€€€…¹¡½ÉMÑ•µ%èÍ•±•Ñ•¹ÍÑ•µ%°(€€€…¹‘¥‘…Ñ•MÑ•µ%‘Ìè…¹‘¥‘…Ñ•Ì¹µ…À ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%¤¹Í½ÉÐ ¤°(€€€ÁÉ•Á…É…Ñ¥½¹!…Í °(€€€Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸°(€€€ÁÉ•Á…É•5Ì°(€ô°Á…åµ•¹ÑI•µ¥¹‘•ÉAÉ•Ù¥•ÝM•É•Ð ¤¤ì(€É•ÑÕÉ¸ì(€€€Í•±•Ñ•°(€€€…¹‘¥‘…Ñ•Ì°(€€€Ñ¼è™¥ÉÍÑAÉ•Á…É•‘É½ÕÀ¹Ñ¼°(€€€…±±Q¼èÉ½ÕÑ¥¹œ¹Ñ¼°(€€€Œè™¥ÉÍÑAÉ•Á…É•‘É½ÕÀ¹Œ°(€€€‰Œè™¥ÉÍÑAÉ•Á…É•‘É½ÕÀ¹‰Œ°(€€€…ÕÑ½	Œè™¥ÉÍÑAÉ•Á…É•‘É½ÕÀ¹‰Œ°(€€€ÍÕ‰©•ÐèÍ•ÑÑ¥¹Ì¹Á…åµ•¹ÑI•µ¥¹‘•ÉMÕ‰©•Ð°(€€€‰½‘äèÍ•ÑÑ¥¹Ì¹Á…åµ•¹ÑI•µ¥¹‘•É	½‘ä°(€€€ÁÉ•Ù¥•Üèì¡Ñµ°è•µ…¥°¹¡Ñµ°°Ñ•áÐè•µ…¥°¹Ñ•áÐô°(€€€É½ÕÑ¥¹É½ÕÁÌèÁÉ•Á…É•‘É½ÕÁÌ°(€€€É½ÕÑ¥¹]…É¹¥¹ÌèÉ½ÕÑ¥¹œ¹Ý…É¹¥¹Ì°(€€€Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸°(€€€ÁÉ•Ù¥•ÝQ½­•¸°(€€€ÁÉ•Á…É…Ñ¥½¹!…Í °(€€€Ñ¥µ¥¹ÌèìÁÉ•Á…É•5Ìô°(€€€Í•ÑÑ¥¹Ìèì(€€€€€Á…åµ•¹ÑI•µ¥¹‘•ÉQ½M½ÕÉ”è€	Õå•È…½Õ¹Ð½ÑÉ…‘•È½Á…åµ•¹Ð¡…¹‘±•ÈÁ±ÕÌ‰Õå•È‰É½­•È½Õ¹Ð¹µ…¥°‰ä%¹Ù½¥”½Éµ…Ðœ°(€€€€€•µ…¥±•±¥Ù•ÉäèÍ•ÉÙ•Éµ…¥±•±¥Ù•ÉåMÑ…ÑÕÌ ¤°(€€€€€‘…åÍ¡•…èÉ•Á½ÉÐ¹‘…åÍ¡•…°(€€€€€Á…åµ•¹ÑI•µ¥¹‘•ÉŒèÍ•ÑÑ¥¹Ì¹Á…åµ•¹ÑI•µ¥¹‘•ÉŒ°(€€€€€Á…åµ•¹ÑI•µ¥¹‘•É	ŒèÍ•ÑÑ¥¹Ì¹Á…åµ•¹ÑI•µ¥¹‘•É	Œ°(€€€ô°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‰Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•ÉM•¹¡‰½‘ä°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ…Ñ¥Ù••ÍÌ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐÍ•±•Ñ•‘MÑ•µ%‘Ì€ô¹•ÜM•Ð ¡ÉÉ…ä¹¥ÍÉÉ…ä¡‰½‘ä¹¥¹Ù½¥•MÑ•µ%‘Ì¤€ü‰½‘ä¹¥¹Ù½¥•MÑ•µ%‘Ì€èmt¤¹µ…À ¡¥¤€ôøMÑÉ¥¹œ¡¥ñð€œœ¤¹ÑÉ¥´ ¤¤¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€¥˜€ …Í•±•Ñ•‘MÑ•µ%‘Ì¹Í¥é”¤Ñ¡É½Ü…ÁÁÉÉ½È M•±•Ð…Ð±•…ÍÐ½¹”¥¹Ù½¥”Ñ¼¥¹±Õ‘”¥¸Ñ¡”Á…åµ•¹ÐÉ•µ¥¹‘•È¸œ°€ÐÀÀ¤ì(€½¹ÍÐ¥‘•µÁ½Ñ•¹å-•ä€ôMÑÉ¥¹œ¡‰½‘ä¹¥‘•µÁ½Ñ•¹å-•äñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€¡¥‘•µÁ½Ñ•¹å-•ä¹±•¹Ñ €ð€ÄØñð¥‘•µÁ½Ñ•¹å-•ä¹±•¹Ñ €ø€ÈÀÀ¤Ñ¡É½Ü…ÁÁÉÉ½È Ù…±¥Á…åµ•¹ÐÉ•µ¥¹‘•È½Á•É…Ñ¥½¸%¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐÁÉ•Ù¥•Ü€ôÙ•É¥™åA…åµ•¹ÑI•µ¥¹‘•ÉAÉ•Ù¥•Ü¡‰½‘ä¹ÁÉ•Ù¥•ÝQ½­•¸°Á…åµ•¹ÑI•µ¥¹‘•ÉAÉ•Ù¥•ÝM•É•Ð ¤¤ì(€½¹ÍÐ…¹¡½ÉMÑ•µ%€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÑ•µ%ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€¡ÁÉ•Ù¥•Ü¹…¹¡½ÉMÑ•µ%€„ôô…¹¡½ÉMÑ•µ%¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Á…åµ•¹ÐÉ•µ¥¹‘•ÈÉ•Ù¥•Ü‰•±½¹ÌÑ¼…¹½Ñ¡•È¥¹Ù½¥”¸I•½Á•¸¥Ð‰•™½É”Í•¹‘¥¹œ¸œ°€ÐÀä¤ì(€¥˜€¡l¸¸¹Í•±•Ñ•‘MÑ•µ%‘Ít¹Í½µ” ¡ÍÑ•µ%¤€ôø€…ÁÉ•Ù¥•Ü¹…¹‘¥‘…Ñ•MÑ•µ%‘Ìü¹¥¹±Õ‘•Ì¡ÍÑ•µ%¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•¥¹Ù½¥”±¥ÍÐ¡…¹•…™Ñ•ÈÉ•Ù¥•Ü¸I•½Á•¸Ñ¡”Á…åµ•¹ÐÉ•µ¥¹‘•È‰•™½É”Í•¹‘¥¹œ¸œ°€ÐÀä¤ì(€ô(€½¹ÍÐÙ…±¥‘…Ñ¥½¹MÑ…ÉÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€…Ý…¥ÐÉ•½¹¥±•	Õå•É%¹Ù½¥•½±±•Ñ¥½¹Ì¡ì(€€€±¥•¹Ðè…Ñ¥Ù••ÍÌ¹±¥•¹Ð°(€€€ÁÉ½™¥±”è…Ñ¥Ù••ÍÌ¹ÁÉ½™¥±”°(€€€…•ÍÍ½¹Ñ•áÐè…Ñ¥Ù••ÍÌ°(€€€ÍÑ•µ%‘Ìèl¸¸¹Í•±•Ñ•‘MÑ•µ%‘Ít°(€ô¤ì(€½¹ÍÐìÍ•ÑÑ¥¹Ì°Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸è±¥Ù•M•ÑÑ¥¹ÍI•Ù¥Í¥½¸°É•Á½ÉÐ°Í•±•Ñ•°…¹‘¥‘…Ñ•Ì°Í•¹‘•Èô€ô…Ý…¥Ð±½…‘	Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•É½¹Ñ•áÐ (€€€ì€¸¸¹‰½‘ä°É•ÅÕ•ÍÑ•‘MÑ•µ%‘Ìè¹Õ±°ô°(€€€…Ñ¥Ù••ÍÌ°(€€¤ì(€½¹ÍÐ±¥Ù•I½ÕÑ¥¹œ€ôÁÉ•Á…É•A…åµ•¹ÑI•µ¥¹‘•ÉI½ÕÑ¥¹œ¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì°Í•±•Ñ•°…¹‘¥‘…Ñ•Ì¤ì(€½¹ÍÐ±¥Ù•AÉ•Á…É…Ñ¥½¹!…Í €ôÁ…åµ•¹ÑI•µ¥¹‘•ÉAÉ•Á…É…Ñ¥½¹¥¹•ÉÁÉ¥¹Ð¡ì(€€€…¹‘¥‘…Ñ•Ì°(€€€ÁÉ•Á…É•‘É½ÕÁÌè±¥Ù•I½ÕÑ¥¹œ¹ÁÉ•Á…É•‘É½ÕÁÌ°(€€€Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸è±¥Ù•M•ÑÑ¥¹ÍI•Ù¥Í¥½¸°(€ô¤ì(€¥˜€¡9Õµ‰•È¡ÁÉ•Ù¥•Ü¹Í•ÑÑ¥¹ÍI•Ù¥Í¥½¸¤€„ôô9Õµ‰•È¡±¥Ù•M•ÑÑ¥¹ÍI•Ù¥Í¥½¸¤ñðÁÉ•Ù¥•Ü¹ÁÉ•Á…É…Ñ¥½¹!…Í €„ôô±¥Ù•AÉ•Á…É…Ñ¥½¹!…Í ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È M…±•Í™½É”°É•µ¥¹‘•ÈÉÕ±•Ì°É•¥Á¥•¹ÑÌ°½È•µ…¥°Í•ÑÑ¥¹Ì¡…¹•…™Ñ•ÈÉ•Ù¥•Ü¸I•Ù¥•ÜÑ¡”É•™É•Í¡•É•µ¥¹‘•È‰•™½É”Í•¹‘¥¹œ¸œ°€ÐÀä°€Ae59Q}I5%9I}IY%]}MQ1œ°Á…åµ•¹ÑI•µ¥¹‘•É½¹™±¥Ñ•Ñ…¥±Ì¡…¹‘¥‘…Ñ•Ì¤¤ì(€ô(€½¹ÍÐÍ•±•Ñ¥½¸€ô•Ù…±Õ…Ñ•	Õå•ÉI•µ¥¹‘•ÉM•±•Ñ¥½¸¡…¹‘¥‘…Ñ•Ì°l¸¸¹Í•±•Ñ•‘MÑ•µ%‘Ít¤ì(€¥˜€¡Í•±•Ñ¥½¸¹Õ¹­¹½Ý¹MÑ•µ%‘Ì¹±•¹Ñ ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•¥¹Ù½¥”±¥ÍÐ¡…¹•…™Ñ•ÈÉ•Ù¥•Ü¸I•Ù¥•ÜÑ¡”É•™É•Í¡•É•µ¥¹‘•È‰•™½É”Í•¹‘¥¹œ¸œ°€ÐÀä°€Ae59Q}I5%9I}M1Q%=9}MQ1œ°Á…åµ•¹ÑI•µ¥¹‘•É½¹™±¥Ñ•Ñ…¥±Ì¡…¹‘¥‘…Ñ•Ì¤¤ì(€ô(€¥˜€¡Í•±•Ñ¥½¸¹É•ÍÑÉ¥Ñ•‘I½ÝÌ¹±•¹Ñ ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È¡Í•±•Ñ¥½¸¹É•ÍÑÉ¥Ñ•‘I½ÝÍlÁt¹Á…åµ•¹ÑI•µ¥¹‘•É	±½­¥¹I•…Í½¸ñð€=¹”½Èµ½É”Í•±•Ñ•¥¹Ù½¥•Ì…É”¹¼±½¹•È•±¥¥‰±”™½È…¸•áÑ•É¹…°Á…åµ•¹ÐÉ•µ¥¹‘•È¸œ°€ÐÀä°€Ae59Q}I5%9I}M1Q%=9}IMQI%Qœ°Á…åµ•¹ÑI•µ¥¹‘•É½¹™±¥Ñ•Ñ…¥±Ì¡…¹‘¥‘…Ñ•Ì¤¤ì(€ô(€½¹ÍÐÉ½ÝÌ€ôÍ•±•Ñ¥½¸¹É½ÝÌì(€½¹ÍÐÉ½ÕÑ¥¹œ€ôÁ…åµ•¹ÑI•µ¥¹‘•ÉI½ÕÑ¥¹½ÉI½ÝÌ¡É½ÝÌ¤ì(€¥˜€ …É½ÕÑ¥¹œ¹É½ÕÁÌ¹±•¹Ñ ¤Ñ¡É½Ü…ÁÁÉÉ½È 9¼Á…åµ•¹ÐÉ•µ¥¹‘•ÈÉ•¥Á¥•¹ÐÉ½ÕÀ½Õ±‰”‰Õ¥±Ð¸œ°€ÐÀÀ¤ì(€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡‰½‘ä¹É•¥Á¥•¹Ñ	…Ñ¡•Ì¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È I•Ù¥•Ý••µ…¥°É•¥Á¥•¹Ð™¥•±‘Ì…É”É•ÅÕ¥É•¸I•½Á•¸Ñ¡”Á…åµ•¹ÐÉ•µ¥¹‘•ÈÁÉ•Ù¥•Ü…¹½¹™¥É´•… •µ…¥°‰…Ñ ‰•™½É”Í•¹‘¥¹œ¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐÉ•Ù¥•Ý•‘I•¥Á¥•¹Ñ	…Ñ¡•Ì€ô¹•Ü5…À¡‰½‘ä¹É•¥Á¥•¹Ñ	…Ñ¡•Ì¹™¥±Ñ•È ¡‰…Ñ ¤€ôø‰…Ñ ü¹­•ä¤¹µ…À ¡‰…Ñ ¤€ôøm‰…Ñ ¹­•ä°‰…Ñ¡t¤¤ì(€½¹ÍÐ½ÕÑ‰½Õ¹‘	…Ñ¡•Ì€ôÉ½ÕÑ¥¹œ¹É½ÕÁÌ¹µ…À ¡É½ÕÀ¤€ôøì(€€€½¹ÍÐÉ½ÕÁM•±•Ñ•€ôÉ½ÕÀ¹É½ÝÌ¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%€ôôôÍ•±•Ñ•¹ÍÑ•µ%¤ñðÉ½ÕÀ¹É½ÝÍlÁtñðÍ•±•Ñ•ì(€€€½¹ÍÐÉ•Ù¥•Ý•‘	…Ñ €ôÉ•Ù¥•Ý•‘I•¥Á¥•¹Ñ	…Ñ¡•Ì¹•Ð¡É½ÕÀ¹­•ä¤ì(€€€¥˜€ …É•Ù¥•Ý•‘	…Ñ ¤Ñ¡É½Ü…ÁÁÉÉ½È¡I•Ù¥•Ý•É•¥Á¥•¹Ð™¥•±‘Ì…É”µ¥ÍÍ¥¹œ™½È€‘íÉ½ÕÀ¹ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”ñð€É•¥Á¥•¹ÐÉ½ÕÀô¸I•½Á•¸Ñ¡”ÁÉ•Ù¥•Ü‰•™½É”Í•¹‘¥¹œ¹€°€ÐÀÀ¤ì(€€€½¹ÍÐÑ¼€ôÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É•Ù¥•Ý•‘	…Ñ ¹Ñ¼ñð€œœ¤ì(€€€½¹ÍÐŒ€ôÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É•Ù¥•Ý•‘	…Ñ ¹Œñð€œœ¤ì(€€€½¹ÍÐ‰Œ€ôÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡É•Ù¥•Ý•‘	…Ñ ¹‰Œñð€œœ¤ì(€€€¥˜€ …Ñ¼¹±•¹Ñ ¤Ñ¡É½Ü…ÁÁÉÉ½È¡A…åµ•¹ÐÉ•µ¥¹‘•ÈÉ•¥Á¥•¹Ð¥ÌÉ•ÅÕ¥É•™½È€‘íÉ½ÕÀ¹ÁÉ¥µ…ÉåI•¥Á¥•¹Ñ9…µ”ñð€É•¥Á¥•¹ÐÉ½ÕÀô¹€°€ÐÀÀ¤ì(€€€½¹ÍÐ•µ…¥°€ô‰Õ¥±‘	Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•Éµ…¥°¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì°É½ÕÁM•±•Ñ•°É½ÕÀ¹É½ÝÌ°ìÍÕ‰©•Ðè‰½‘ä¹ÍÕ‰©•Ð°‰½‘äè‰½‘ä¹‰½‘äô°ì€¸¸¹É½ÕÀ°Ñ¼ô¤ì(€€€É•ÑÕÉ¸ìÉ½ÕÀ°Ñ¼°Œ°‰Œ°•µ…¥°ôì(€ô¤ì(€½¹ÍÐÙ…±¥‘…Ñ¥½¹5Ì€ô…Ñ”¹¹½Ü ¤€´Ù…±¥‘…Ñ¥½¹MÑ…ÉÑ•‘Ðì(€½¹ÍÐÉ•ÅÕ•ÍÑ!…Í €ôÁ…åµ•¹ÑI•µ¥¹‘•ÉI•ÅÕ•ÍÑ!…Í ¡ì(€€€…¹¡½ÉMÑ•µ%°(€€€¥¹Ù½¥•MÑ•µ%‘Ìèl¸¸¹Í•±•Ñ•‘MÑ•µ%‘Ít°(€€€É•¥Á¥•¹Ñ	…Ñ¡•Ìè‰½‘ä¹É•¥Á¥•¹Ñ	…Ñ¡•Ì°(€€€ÍÕ‰©•Ðè‰½‘ä¹ÍÕ‰©•Ð°(€€€‰½‘äè‰½‘ä¹‰½‘ä°(€ô¤ì(€½¹ÍÐÉ•Í•ÉÙ…Ñ¥½¸€ô…Ý…¥ÐÉ•Í•ÉÙ•A…åµ•¹ÑI•µ¥¹‘•É=Á•É…Ñ¥½¸¡…Ñ¥Ù••ÍÌ¹±¥•¹Ð°ì(€€€¥‘•µÁ½Ñ•¹å-•ä°(€€€É•ÅÕ•ÍÑ!…Í °(€€€…¹¡½ÉMÑ•µ%°(€€€Í•±•Ñ•‘MÑ•µ%‘Ìèl¸¸¹Í•±•Ñ•‘MÑ•µ%‘Ít°(€€€‰…Ñ¡½Õ¹Ðè½ÕÑ‰½Õ¹‘	…Ñ¡•Ì¹±•¹Ñ °(€€€…Ñ½ÉUÍ•É%è…Ñ¥Ù••ÍÌ¹ÁÉ½™¥±”¹¥°(€€€…Ñ½Éµ…¥°è…Ñ¥Ù••ÍÌ¹ÁÉ½™¥±”¹•µ…¥°°(€ô¤ì(€¥˜€¡É•Í•ÉÙ…Ñ¥½¸¹É•Á±…ä¤É•ÑÕÉ¸ìÍ•¹ÐèÑÉÕ”°¥‘•µÁ½Ñ•¹åI•Á±…å•èÑÉÕ”°€¸¸¹É•Í•ÉÙ…Ñ¥½¸¹É•ÍÕ±Ðôì(€¥˜€¡É•Í•ÉÙ…Ñ¥½¸¹Õ¹•ÉÑ…¥¸¤Ñ¡É½Ü…ÁÁÉÉ½È ÁÉ•Ù¥½ÕÌ‘•±¥Ù•Éä…ÑÑ•µÁÐ¡…Ì…¸Õ¹•ÉÑ…¥¸5¥É½Í½™ÐÉ…Á ½ÕÑ½µ”¸Y•É¥™äM•¹Ð%Ñ•µÌ‰•™½É”É•ÑÉå¥¹œ¸œ°€ÐÀä¤ì(€¥˜€¡É•Í•ÉÙ…Ñ¥½¸¹‰±½­•¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡¥ÌÁ…åµ•¹ÐÉ•µ¥¹‘•È¥Ì…±É•…‘ä‰•¥¹œÁÉ½•ÍÍ•¸œ°€ÐÀä¤ì(€½¹ÍÐ½Á•É…Ñ¥½¹%€ôÉ•Í•ÉÙ…Ñ¥½¸¹½Á•É…Ñ¥½¹%ì(€½¹ÍÐÉ…Á¡MÑ…ÉÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€½¹ÍÐ‘•±¥Ù•ÉåI•ÍÕ±ÑÌ€ô…Ý…¥Ðµ…ÁA…åµ•¹ÑI•µ¥¹‘•É	…Ñ¡•Ì¡½ÕÑ‰½Õ¹‘	…Ñ¡•Ì°…Íå¹Œ€¡‰…Ñ ¤€ôøì(€€€½¹ÍÐ‰…Ñ¡-•å!…Í €ôÉ•…Ñ•!…Í  Í¡„ÈÔØœ¤¹ÕÁ‘…Ñ”¡‰…Ñ ¹É½ÕÀ¹­•ä¤¹‘¥•ÍÐ ¡•àœ¤ì(€€€½¹ÍÐ‰…Ñ¡I•ÅÕ•ÍÑ!…Í €ôÁ…åµ•¹ÑI•µ¥¹‘•É	…Ñ¡!…Í ¡ì(€€€€€­•äè‰…Ñ ¹É½ÕÀ¹­•ä°(€€€€€ÍÑ•µ%‘Ìè‰…Ñ ¹É½ÕÀ¹É½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%¤°(€€€€€Ñ¼è‰…Ñ ¹Ñ¼°(€€€€€Œè‰…Ñ ¹Œ°(€€€€€‰Œè‰…Ñ ¹‰Œ°(€€€ô°ìÍÕ‰©•Ðè‰…Ñ ¹•µ…¥°¹ÍÕ‰©•Ð°¡Ñµ°è‰…Ñ ¹•µ…¥°¹¡Ñµ°ô¤ì(€€€½¹ÍÐÉ•¥Á¥•¹Ñ½Õ¹Ð€ôÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡‰…Ñ ¹Ñ¼°‰…Ñ ¹Œ°‰…Ñ ¹‰Œ¤¹±•¹Ñ ì(€€€±•Ð‰…Ñ¡I•Í•ÉÙ…Ñ¥½¸ì(€€€ÑÉäì(€€€€€‰…Ñ¡I•Í•ÉÙ…Ñ¥½¸€ô…Ý…¥ÐÉ•Í•ÉÙ•A…åµ•¹ÑI•µ¥¹‘•É	…Ñ ¡…Ñ¥Ù••ÍÌ¹±¥•¹Ð°ì(€€€€€€€½Á•É…Ñ¥½¹%°(€€€€€€€‰…Ñ¡-•å!…Í °(€€€€€€€É•ÅÕ•ÍÑ!…Í è‰…Ñ¡I•ÅÕ•ÍÑ!…Í °(€€€€€€€ÍÑ•µ%‘Ìè‰…Ñ ¹É½ÕÀ¹É½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹ÍÑ•µ%¤°(€€€€€€€É½Ý½Õ¹Ðè‰…Ñ ¹É½ÕÀ¹É½ÝÌ¹±•¹Ñ °(€€€€€€€É•¥Á¥•¹Ñ½Õ¹Ð°(€€€€€ô¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹‰…Ñ °ÍÑ…ÑÕÌè€™…¥±•œ°•ÉÉ½É½‘”è€Ae59Q}I5%9I}	Q!}IMIY}%1œ°•ÉÉ½È°É…Á¡5Ìè€Àôì(€€€ô(€€€¥˜€¡‰…Ñ¡I•Í•ÉÙ…Ñ¥½¸¹É•Á±…ä¤É•ÑÕÉ¸ì€¸¸¹‰…Ñ °ÍÑ…ÑÕÌè€…•ÁÑ•œ°É•Á±…äèÑÉÕ”°ÁÉ½Ù¥‘•ÉI•ÅÕ•ÍÑ%è‰…Ñ¡I•Í•ÉÙ…Ñ¥½¸¹ÁÉ½Ù¥‘•ÉI•ÅÕ•ÍÑ%°É…Á¡5Ìè€Àôì(€€€¥˜€¡‰…Ñ¡I•Í•ÉÙ…Ñ¥½¸¹Õ¹•ÉÑ…¥¸¤É•ÑÕÉ¸ì€¸¸¹‰…Ñ °ÍÑ…ÑÕÌè€Õ¹•ÉÑ…¥¸œ°•ÉÉ½É½‘”è€Ae59Q}I5%9I}	Q!}U9IQ%8œ°É…Á¡5Ìè€Àôì(€€€½¹ÍÐ‰…Ñ¡MÑ…ÉÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€€€ÑÉäì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÍ•¹‘=Á•É…Ñ¥½¹…±5…¥°¡ì(€€€€€€€Ñ¼è‰…Ñ ¹Ñ¼°Œè‰…Ñ ¹Œ°‰Œè‰…Ñ ¹‰Œ°(€€€€€€€ÍÕ‰©•Ðè‰…Ñ ¹•µ…¥°¹ÍÕ‰©•Ð°¡Ñµ°è‰…Ñ ¹•µ…¥°¹¡Ñµ°°Ñ•áÐè‰…Ñ ¹•µ…¥°¹Ñ•áÐ°(€€€€€ô°ì(€€€€€€€±¥•¹Ðè…Ñ¥Ù••ÍÌ¹±¥•¹Ð°ÁÕÉÁ½Í•-•äè€Á…åµ•¹Ñ}É•µ¥¹‘•ÉÌœ°(€€€€€€€µ…¥±‰½áM¹…ÁÍ¡½Ðèì¥èÍ•¹‘•È¹µ…¥±‰½á%°•µ…¥±‘‘É•ÍÌèÍ•¹‘•È¹•µ…¥±‘‘É•ÍÌô°(€€€€€ô¤ì(€€€€€½¹ÍÐÉ…Á¡5Ì€ô…Ñ”¹¹½Ü ¤€´‰…Ñ¡MÑ…ÉÑ•‘Ðì(€€€€€…Ý…¥Ð½µÁ±•Ñ•A…åµ•¹ÑI•µ¥¹‘•É	…Ñ ¡…Ñ¥Ù••ÍÌ¹±¥•¹Ð°ì(€€€€€€€½Á•É…Ñ¥½¹%°‰…Ñ¡-•å!…Í °ÍÑ…ÑÕÌè€…•ÁÑ•œ°(€€€€€€€ÁÉ½Ù¥‘•ÉI•ÅÕ•ÍÑ%èÉ•ÍÕ±Ð¹¥ñðÉ•ÍÕ±Ð¹µ•ÍÍ…•%ñð¹Õ±°°É…Á¡5Ì°(€€€€€ô¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹‰…Ñ °ÍÑ…ÑÕÌè€…•ÁÑ•œ°É•ÍÕ±Ð°É…Á¡5Ìôì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€½¹ÍÐÉ…Á¡5Ì€ô…Ñ”¹¹½Ü ¤€´‰…Ñ¡MÑ…ÉÑ•‘Ðì(€€€€€½¹ÍÐÕ¹•ÉÑ…¥¸€ôÁ…åµ•¹ÑI•µ¥¹‘•É•±¥Ù•ÉåU¹•ÉÑ…¥¸¡•ÉÉ½È¤ì(€€€€€ÑÉäì(€€€€€€€…Ý…¥Ð½µÁ±•Ñ•A…åµ•¹ÑI•µ¥¹‘•É	…Ñ ¡…Ñ¥Ù••ÍÌ¹±¥•¹Ð°ì(€€€€€€€€€½Á•É…Ñ¥½¹%°‰…Ñ¡-•å!…Í °ÍÑ…ÑÕÌèÕ¹•ÉÑ…¥¸€ü€Õ¹•ÉÑ…¥¸œ€è€™…¥±•œ°(€€€€€€€€€É…Á¡5Ì°•ÉÉ½É½‘”èMÑÉ¥¹œ¡•ÉÉ½Èü¹½‘”ñð€Ae59Q}I5%9I}1%YIe}%1œ¤¹Í±¥” À°€ÄÀÀ¤°(€€€€€€€ô¤ì(€€€€€ô…Ñ €¡±•‘•ÉÉÉ½È¤ì(€€€€€€€½¹Í½±”¹•ÉÉ½È mÁ…åµ•¹ÐµÉ•µ¥¹‘•Ét‘•±¥Ù•Éä±•‘•ÈÕÁ‘…Ñ”™…¥±•œ°ìÉ•ÅÕ•ÍÑ%èÉ•ÅÕ•ÍÑ%‘É½´¡É•Ä¤°½‘”è±•‘•ÉÉÉ½Èü¹½‘”ñð¹Õ±°ô¤ì(€€€€€€€É•ÑÕÉ¸ì€¸¸¹‰…Ñ °ÍÑ…ÑÕÌè€Õ¹•ÉÑ…¥¸œ°•ÉÉ½É½‘”è€Ae59Q}I5%9I}1I}U9IQ%8œ°•ÉÉ½È°É…Á¡5Ìôì(€€€€€ô(€€€€€½¹Í½±”¹•ÉÉ½È m‰Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•ÉM•¹‘t•µ…¥°ÁÉ½Ù¥‘•È™…¥±•œ°ì(€€€€€€€½‘”èMÑÉ¥¹œ¡•ÉÉ½Èü¹½‘”ñð•ÉÉ½Èü¹¹…µ”ñð€ÁÉ½Ù¥‘•É}•ÉÉ½Èœ¤¹Í±¥” À°€àÀ¤°(€€€€€€€ÁÉ½Ù¥‘•Èè½Á•É…Ñ¥½¹…±5…¥±½¹™¥œ ¤¹‘•±¥Ù•Éå5•Ñ¡½°(€€€€€€€Ñ½½Õ¹Ðè‰…Ñ ¹Ñ¼¹±•¹Ñ °½Õ¹Ðè‰…Ñ ¹Œ¹±•¹Ñ °‰½Õ¹Ðè‰…Ñ ¹‰Œ¹±•¹Ñ °(€€€€€€€É½ÝÌè‰…Ñ ¹É½ÕÀ¹É½ÝÌ¹±•¹Ñ °É½ÕÑ¥¹5½‘”è‰…Ñ ¹É½ÕÀ¹µ½‘”°(€€€€€ô¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹‰…Ñ °ÍÑ…ÑÕÌèÕ¹•ÉÑ…¥¸€ü€Õ¹•ÉÑ…¥¸œ€è€™…¥±•œ°•ÉÉ½É½‘”è•ÉÉ½Èü¹½‘”ñð¹Õ±°°•ÉÉ½È°É…Á¡5Ìôì(€€€ô(€ô°€Ì¤ì(€½¹ÍÐÉ…Á¡5Ì€ô…Ñ”¹¹½Ü ¤€´É…Á¡MÑ…ÉÑ•‘Ðì(€½¹ÍÐ…•ÁÑ•€ô‘•±¥Ù•ÉåI•ÍÕ±ÑÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÑ…ÑÕÌ€ôôô€…•ÁÑ•œ¤ì(€½¹ÍÐ™…¥±•€ô‘•±¥Ù•ÉåI•ÍÕ±ÑÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÑ…ÑÕÌ€ôôô€™…¥±•œ¤ì(€½¹ÍÐÕ¹•ÉÑ…¥¸€ô‘•±¥Ù•ÉåI•ÍÕ±ÑÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÑ…ÑÕÌ€ôôô€Õ¹•ÉÑ…¥¸œ¤ì(€½¹ÍÐÁÉ•Q¥µ•±¥¹•MÑ…ÑÕÌ€ôÕ¹•ÉÑ…¥¸¹±•¹Ñ €ü€Õ¹•ÉÑ…¥¸œ€è…•ÁÑ•¹±•¹Ñ €ôôô½ÕÑ‰½Õ¹‘	…Ñ¡•Ì¹±•¹Ñ €ü€…•ÁÑ•œ€è…•ÁÑ•¹±•¹Ñ €ü€Á…ÉÑ¥…°œ€è€™…¥±•œì(€…Ý…¥Ð½µÁ±•Ñ•A…åµ•¹ÑI•µ¥¹‘•É=Á•É…Ñ¥½¸¡…Ñ¥Ù••ÍÌ¹±¥•¹Ð°ì(€€€½Á•É…Ñ¥½¹%°(€€€ÍÑ…ÑÕÌèÁÉ•Q¥µ•±¥¹•MÑ…ÑÕÌ°(€€€…•ÁÑ•‘	…Ñ¡½Õ¹Ðè…•ÁÑ•¹±•¹Ñ °(€€€™…¥±•‘	…Ñ¡½Õ¹Ðè™…¥±•¹±•¹Ñ °(€€€Ñ¥µ•±¥¹•I•½É‘•è™…±Í”°(€€€ÁÉ•Á…É•5Ìè9Õµ‰•È¡ÁÉ•Ù¥•Ü¹ÁÉ•Á…É•5Ìñð€À¤°Ù…±¥‘…Ñ¥½¹5Ì°É…Á¡5Ì°Ñ¥µ•±¥¹•5Ìè€À°(€€€•ÉÉ½É½‘”èÕ¹•ÉÑ…¥¹lÁtü¹•ÉÉ½É½‘”ñð™…¥±•‘lÁtü¹•ÉÉ½É½‘”ñð¹Õ±°°(€ô¤ì((€½¹ÍÐ½±±•Ñ¥½¹]…É¹¥¹Ì€ômtì(€±•Ð½±±•Ñ¥½¹I•ÍÕ±ÑÌ€ômtì(€±•ÐÑ¥µ•±¥¹•5Ì€ô€Àì(€¥˜€¡…•ÁÑ•¹±•¹Ñ ¤ì(€€€½¹ÍÐÑ¥µ•±¥¹•MÑ…ÉÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€€€½¹ÍÐÑ¥µ•±¥¹•I½ÝÌ€ô…•ÁÑ•¹™±…Ñ5…À ¡¥Ñ•´¤€ôøì(€€€€€½¹ÍÐÉ•¥Á¥•¹Ñ½Õ¹Ð€ôÕ¹¥ÅÕ•µ…¥±1¥ÍÐ¡¥Ñ•´¹Ñ¼°¥Ñ•´¹Œ°¥Ñ•´¹‰Œ¤¹±•¹Ñ ì(€€€€€½¹ÍÐ¹½Ñ”€ômA…åµ•¹ÐÉ•µ¥¹‘•È…•ÁÑ•‰ä5¥É½Í½™ÐÉ…Á ¹€°I•¥Á¥•¹ÑÌè€‘íÉ•¥Á¥•¹Ñ½Õ¹Ñõ€°I½ÕÑ¥¹œè€‘í¥Ñ•´¹É½ÕÀ¹µ½‘•õ€°%¹±Õ‘•¥¹Ù½¥•Ìè€‘í¥Ñ•´¹É½ÕÀ¹É½ÝÌ¹±•¹Ñ¡õt¹©½¥¸ q¸œ¤ì(€€€€€½¹ÍÐÍÕ‰©•Ñ!…Í €ôÉ•…Ñ•!…Í  Í¡„ÈÔØœ¤¹ÕÁ‘…Ñ”¡¥Ñ•´¹•µ…¥°¹ÍÕ‰©•Ð¤¹‘¥•ÍÐ ¡•àœ¤ì(€€€€€É•ÑÕÉ¸¥Ñ•´¹É½ÕÀ¹É½ÝÌ¹µ…À ¡É½Ü¤€ôø€¡ì(€€€€€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ%°(€€€€€€€½Ý¹•É9…µ”èÉ½Ü¹½±±•Ñ¥½¸ü¹½Ý¹•É9…µ”ñðÍÁ±¥Ñ	Õå•ÉQÉ…‘•É9…µ•Ì¡É½Ü¹‰Õå•ÉQÉ…‘•É%¹¡…É”¥lÁtñð€œœ°(€€€€€€€¹½Ñ”°É•¥Á¥•¹Ñ½Õ¹Ð°ÍÕ‰©•Ñ!…Í °(€€€€€ô¤¤ì(€€€ô¤ì(€€€ÑÉäì(€€€€€½¹ÍÐÍ…Ù•€ô…Ý…¥ÐÍ…Ù•A…åµ•¹ÑI•µ¥¹‘•ÉQ¥µ•±¥¹”¡…Ñ¥Ù••ÍÌ¹±¥•¹Ð°ì(€€€€€€€½Á•É…Ñ¥½¹%°É½ÝÌèÑ¥µ•±¥¹•I½ÝÌ°(€€€€€€€…Ñ½ÉUÍ•É%è…Ñ¥Ù••ÍÌ¹ÁÉ½™¥±”¹¥°…Ñ½Éµ…¥°è…Ñ¥Ù••ÍÌ¹ÁÉ½™¥±”¹•µ…¥°°(€€€€€ô¤ì(€€€€€½±±•Ñ¥½¹I•ÍÕ±ÑÌ€ô€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Í…Ù•¤€üÍ…Ù•€èmt¤¹µ…À ¡¥Ñ•´¤€ôø€¡ì(€€€€€€€¥Ñ•´èÍ•É¥…±¥é•½±±•Ñ¥½¹%Ñ•´¡¥Ñ•´ü¹¥Ñ•´¤°(€€€€€€€•Ù•¹ÐèÍ•É¥…±¥é•½±±•Ñ¥½¹Ù•¹Ð¡¥Ñ•´ü¹•Ù•¹Ð¤°(€€€€€ô¤¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€½¹Í½±”¹•ÉÉ½È mÁ…åµ•¹ÐµÉ•µ¥¹‘•Ét…Ñ½µ¥ŒÑ¥µ•±¥¹”ÕÁ‘…Ñ”™…¥±•œ°ìÉ•ÅÕ•ÍÑ%èÉ•ÅÕ•ÍÑ%‘É½´¡É•Ä¤°½‘”è•ÉÉ½Èü¹½‘”ñð¹Õ±°ô¤ì(€€€€€½±±•Ñ¥½¹]…É¹¥¹Ì¹ÁÕÍ ¡ì•ÉÉ½Èè€Q¡”É•µ¥¹‘•ÈÝ…ÌÍ•¹Ð°‰ÕÐ=LÝ¥±°É•Á…¥È¥ÑÌ½±±•Ñ¥½¸Ñ¥µ•±¥¹”‘ÕÉ¥¹œÉ•½¹¥±¥…Ñ¥½¸¸œô¤ì(€€€ô(€€€Ñ¥µ•±¥¹•5Ì€ô…Ñ”¹¹½Ü ¤€´Ñ¥µ•±¥¹•MÑ…ÉÑ•‘Ðì(€ô((€½¹ÍÐ½µÁ±•Ñ•€ô…•ÁÑ•¹±•¹Ñ €ôôô½ÕÑ‰½Õ¹‘	…Ñ¡•Ì¹±•¹Ñ €˜˜½±±•Ñ¥½¹]…É¹¥¹Ì¹±•¹Ñ €ôôô€Àì(€½¹ÍÐ™¥¹…±MÑ…ÑÕÌ€ô½µÁ±•Ñ•€ü€½µÁ±•Ñ•œ€èÁÉ•Q¥µ•±¥¹•MÑ…ÑÕÌì(€½¹ÍÐÉ•‘…Ñ•‘I•ÍÕ±Ð€ôì(€€€½Á•É…Ñ¥½¹%°(€€€•µ…¥±Ìè…•ÁÑ•¹±•¹Ñ °(€€€É½ÝÌè…•ÁÑ•¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬¥Ñ•´¹É½ÕÀ¹É½ÝÌ¹±•¹Ñ °€À¤°(€€€É•¥Á¥•¹Ñ½Õ¹Ðè…•ÁÑ•¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬Õ¹¥ÅÕ•µ…¥±1¥ÍÐ¡¥Ñ•´¹Ñ¼°¥Ñ•´¹Œ°¥Ñ•´¹‰Œ¤¹±•¹Ñ °€À¤°(€€€…•ÁÑ•‘	…Ñ¡½Õ¹Ðè…•ÁÑ•¹±•¹Ñ °(€€€™…¥±•‘	…Ñ¡½Õ¹Ðè™…¥±•¹±•¹Ñ °(€€€Õ¹•ÉÑ…¥¹	…Ñ¡½Õ¹ÐèÕ¹•ÉÑ…¥¸¹±•¹Ñ °(€ôì(€…Ý…¥Ð½µÁ±•Ñ•A…åµ•¹ÑI•µ¥¹‘•É=Á•É…Ñ¥½¸¡…Ñ¥Ù••ÍÌ¹±¥•¹Ð°ì(€€€½Á•É…Ñ¥½¹%°ÍÑ…ÑÕÌè™¥¹…±MÑ…ÑÕÌ°(€€€…•ÁÑ•‘	…Ñ¡½Õ¹Ðè…•ÁÑ•¹±•¹Ñ °™…¥±•‘	…Ñ¡½Õ¹Ðè™…¥±•¹±•¹Ñ °(€€€Ñ¥µ•±¥¹•I•½É‘•è½±±•Ñ¥½¹]…É¹¥¹Ì¹±•¹Ñ €ôôô€À°(€€€ÁÉ•Á…É•5Ìè9Õµ‰•È¡ÁÉ•Ù¥•Ü¹ÁÉ•Á…É•5Ìñð€À¤°Ù…±¥‘…Ñ¥½¹5Ì°É…Á¡5Ì°Ñ¥µ•±¥¹•5Ì°(€€€É•ÍÕ±ÑM¹…ÁÍ¡½ÐèÉ•‘…Ñ•‘I•ÍÕ±Ð°(€€€•ÉÉ½É½‘”èÕ¹•ÉÑ…¥¹lÁtü¹•ÉÉ½É½‘”ñð™…¥±•‘lÁtü¹•ÉÉ½É½‘”ñð¹Õ±°°(€ô¤ì((€¥˜€ ……•ÁÑ•¹±•¹Ñ ¤ì(€€€½¹ÍÐ™¥ÉÍÑÉÉ½È€ôÕ¹•ÉÑ…¥¹lÁtü¹•ÉÉ½Èñð™…¥±•‘lÁtü¹•ÉÉ½Èì(€€€¥˜€¡Õ¹•ÉÑ…¥¸¹±•¹Ñ ¤Ñ¡É½Ü…ÁÁÉÉ½È 5¥É½Í½™ÐÉ…Á ‘•±¥Ù•Éä½Õ±¹½Ð‰”½¹™¥Éµ•¸Y•É¥™äM•¹Ð%Ñ•µÌ‰•™½É”É•ÑÉå¥¹œ¸œ°€ÐÀä¤ì(€€€Ñ¡É½Ü™¥ÉÍÑÉÉ½Èñð…ÁÁÉÉ½È 5¥É½Í½™ÐÉ…Á É•©•Ñ••Ù•ÉäÁ…åµ•¹ÐÉ•µ¥¹‘•È‰…Ñ ¸œ°€ÔÀÈ¤ì(€ô((€Ý…¥ÑU¹Ñ¥°¡AÉ½µ¥Í”¹É•Í½±Ù” ¤¹Ñ¡•¸  ¤€ôøì(€€€•áÁ¥É•IÕ¹Ñ¥µ•…¡•Q…Ì¡lÍ…±•Í™½É”é‰Õå•Èµ¥¹Ù½¥•Ìt¤ì(€ô¤¹…Ñ   ¤€ôøíô¤¤ì(€É•ÑÕÉ¸ì(€€€Í•¹Ðè½µÁ±•Ñ•°(€€€Á…ÉÑ¥…°è€…½µÁ±•Ñ•°(€€€½Á•É…Ñ¥½¹%°(€€€¥è…•ÁÑ•‘lÁtü¹É•ÍÕ±Ðü¹¥ñð…•ÁÑ•‘lÁtü¹ÁÉ½Ù¥‘•ÉI•ÅÕ•ÍÑ%ñð¹Õ±°°(€€€•µ…¥±Ìè…•ÁÑ•¹±•¹Ñ °(€€€‰…Ñ¡•Ìè…•ÁÑ•¹µ…À ¡¥Ñ•´¤€ôø€¡ì(€€€€€Ñ¼è¥Ñ•´¹Ñ¼°Œè¥Ñ•´¹Œ°‰Œè¥Ñ•´¹‰Œ°(€€€€€ÍÕ‰©•Ðè¥Ñ•´¹•µ…¥°¹ÍÕ‰©•Ð°É½ÝÌè¥Ñ•´¹É½ÕÀ¹É½ÝÌ¹±•¹Ñ °µ½‘”è¥Ñ•´¹É½ÕÀ¹µ½‘”°(€€€ô¤¤°(€€€™…¥±•‘	…Ñ¡•Ìèl¸¸¹™…¥±•°€¸¸¹Õ¹•ÉÑ…¥¹t¹µ…À ¡¥Ñ•´¤€ôø€¡ì(€€€€€­•äè¥Ñ•´¹É½ÕÀ¹­•ä°µ½‘”è¥Ñ•´¹É½ÕÀ¹µ½‘”°É½ÝÌè¥Ñ•´¹É½ÕÀ¹É½ÝÌ¹±•¹Ñ °(€€€€€ÍÑ…ÑÕÌè¥Ñ•´¹ÍÑ…ÑÕÌ°•ÉÉ½É½‘”è¥Ñ•´¹•ÉÉ½É½‘”ñð¹Õ±°°(€€€ô¤¤°(€€€Ñ¼èÕ¹¥ÅÕ•µ…¥±1¥ÍÐ ¸¸¹…•ÁÑ•¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹Ñ¼¤¤°(€€€ŒèÕ¹¥ÅÕ•µ…¥±1¥ÍÐ ¸¸¹…•ÁÑ•¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹Œ¤¤°(€€€‰ŒèÕ¹¥ÅÕ•µ…¥±1¥ÍÐ ¸¸¹…•ÁÑ•¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹‰Œ¤¤°(€€€ÍÕ‰©•Ðè…•ÁÑ•‘lÁtü¹•µ…¥°¹ÍÕ‰©•Ðñð¹Õ±°°(€€€É½ÝÌè…•ÁÑ•¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬¥Ñ•´¹É½ÕÀ¹É½ÝÌ¹±•¹Ñ °€À¤°(€€€½±±•Ñ¥½¹I•ÍÕ±ÑÌ°(€€€½±±•Ñ¥½¹]…É¹¥¹Ì°(€€€Ñ¥µ¥¹ÌèìÁÉ•Á…É•5Ìè9Õµ‰•È¡ÁÉ•Ù¥•Ü¹ÁÉ•Á…É•5Ìñð€À¤°Ù…±¥‘…Ñ¥½¹5Ì°É…Á¡5Ì°Ñ¥µ•±¥¹•5Ìô°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÑ…ÉÑ	Õå•É%¹Ù½¥•µ…¥±IÕ¸¡Ý¥¹‘½Ü¤ì(€½¹ÍÐ±¥•¹Ð€ôÍ…™•MÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤ì(€¥˜€ …±¥•¹Ð¤É•ÑÕÉ¸ì…±±½Ý•èÑÉÕ”°ÉÕ¸è¹Õ±°ôì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‰Õå•É}¥¹Ù½¥•}•µ…¥±}ÉÕ¹Ìœ¤(€€€€¹¥¹Í•ÉÐ¡ì(€€€€€ÉÕ¹}­•äèÝ¥¹‘½Ü¹ÉÕ¹-•ä°(€€€€€Í¡•‘Õ±•}Ñ¥µ”èÝ¥¹‘½Ü¹Ñ¥µ”°(€€€€€ÍÑ…ÑÕÌè€ÉÕ¹¹¥¹œœ°(€€€ô¤(€€€€¹Í•±•Ð ¥±ÉÕ¹}­•ä±ÍÑ…ÑÕÌ±É•…Ñ•‘}…Ðœ¤(€€€€¹Í¥¹±” ¤ì(€¥˜€¡•ÉÉ½Èü¹½‘”€ôôô€œÈÌÔÀÔœ¤É•ÑÕÉ¸ì…±±½Ý•è™…±Í”°‘ÕÁ±¥…Ñ”èÑÉÕ”ôì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€É•ÑÕÉ¸ì…±±½Ý•èÑÉÕ”°ÉÕ¸è‘…Ñ„ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸™¥¹¥Í¡	Õå•É%¹Ù½¥•µ…¥±IÕ¸¡ÉÕ¹-•ä°Á…Ñ €ôíô¤ì(€½¹ÍÐ±¥•¹Ð€ôÍ…™•MÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤ì(€¥˜€ …±¥•¹Ðñð€…ÉÕ¹-•ä¤É•ÑÕÉ¸ì(€½¹ÍÐì•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‰Õå•É}¥¹Ù½¥•}•µ…¥±}ÉÕ¹Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€€¸¸¹Á…Ñ °(€€€€€½µÁ±•Ñ•‘}…Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€ô¤(€€€€¹•Ä ÉÕ¹}­•äœ°ÉÕ¹-•ä¤ì(€¥˜€¡•ÉÉ½È¤½¹Í½±”¹•ÉÉ½È …¥±•Ñ¼ÕÁ‘…Ñ”‰Õå•È¥¹Ù½¥”•µ…¥°ÉÕ¸œ°•ÉÉ½È¹µ•ÍÍ…”¤ì)ô()™Õ¹Ñ¥½¸É•ÅÕ¥É•É½¹ÕÑ¡½É¥é…Ñ¥½¸¡É•Ä¤ì(€½¹ÍÐÍ•É•Ð€ôÁÉ½•ÍÌ¹•¹Ø¹I=9}MIPì(€¥˜€ …Í•É•Ð¤Ñ¡É½Ü…ÁÁÉÉ½È 5¥ÍÍ¥¹œI=9}MIP¥¸Y•É•°¸œ°€ÔÀÀ¤ì(€½¹ÍÐ¡•…‘•È€ôÉ•Äü¹¡•…‘•ÉÌü¹…ÕÑ¡½É¥é…Ñ¥½¸ñðÉ•Äü¹¡•…‘•ÉÌü¹ÕÑ¡½É¥é…Ñ¥½¸ñð€œœì(€¥˜€¡MÑÉ¥¹œ¡¡•…‘•È¤€„ôô	•…É•È€‘íÍ•É•Ñõ€¤Ñ¡É½Ü…ÁÁÉÉ½È U¹…ÕÑ¡½É¥é•É½¸É•ÅÕ•ÍÐ¸œ°€ÐÀÄ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸½ÕÑÍÑ…¹‘¥¹	Õå•É%¹Ù½¥•Íµ…¥±I•Á½ÉÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ…Ñ¥Ù••ÍÌ€ô…•ÍÍ½¹Ñ•áÐñð€¡‰½‘ä¹Í¡•‘Õ±•€ü¹Õ±°€è…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ‘•±¥Ù•Éå±¥•¹Ð€ô…Ñ¥Ù••ÍÌü¹±¥•¹ÐñðÍ…™•MÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤ì(€¥˜€ …‘•±¥Ù•Éå±¥•¹Ð¤Ñ¡É½Ü…ÁÁÉÉ½È =L‘…Ñ…‰…Í”…•ÍÌ¥ÌÕ¹…Ù…¥±…‰±”™½ÈÑ¡”¥¹Ñ•É¹…°É•Á½ÉÐ¸œ°€ÔÀÌ¤ì(€½¹ÍÐÍÑ½É•€ô…Ý…¥Ð±½…‘MÑ½É•‘	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì ¤ì(€¥˜€  …‰½‘ä¹ÁÉ•Ù¥•Ü€˜˜€…‰½‘ä¹‘ÉåIÕ¸¤€˜˜ÍÑ½É•¹µ•Ñ„¹½¹™¥ÕÉ•€„ôôÑÉÕ”¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È =ÕÑÍÑ…¹‘¥¹œ‰Õå•È¥¹Ù½¥”É•Á½ÉÐÉ•¥Á¥•¹ÑÌ…É”¹½Ð½¹™¥ÕÉ•¸M•¹‘¥¹œ¥Ì‘¥Í…‰±•¸œ°€ÔÀÌ°€%99%1}IA=IQ}9=Q}=9%UIœ°Õ¹‘•™¥¹•°ÑÉÕ”¤ì(€ô(€¥˜€ …‰½‘ä¹ÁÉ•Ù¥•Ü€˜˜€…‰½‘ä¹‘ÉåIÕ¸€˜˜€ …MÑÉ¥¹œ¡ÍÑ½É•¹Í•ÑÑ¥¹Ìü¹ÍÕ‰©•Ðñð€œœ¤¹ÑÉ¥´ ¤ñð€…MÑÉ¥¹œ¡ÍÑ½É•¹Í•ÑÑ¥¹Ìü¹¥¹ÑÉ¼ñð€œœ¤¹ÑÉ¥´ ¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È =ÕÑÍÑ…¹‘¥¹œ‰Õå•È¥¹Ù½¥”É•Á½ÉÐÍÕ‰©•Ð…¹‰½‘ä…É”¹½Ð½¹™¥ÕÉ•¸M•¹‘¥¹œ¥Ì‘¥Í…‰±•¸œ°€ÔÀÌ°€%99%1}IA=IQ}Q5A1Q}9=Q}=9%UIœ°Õ¹‘•™¥¹•°ÑÉÕ”¤ì(€ô(€½¹ÍÐÍ•ÑÑ¥¹Ì€ôì(€€€€¸¸¹‰Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì¡ÍÑ½É•¹Í•ÑÑ¥¹Ì¤°(€€€¡…Í	Õå•ÉQÉ…‘•É¥±Ñ•Èè€¡ÍÑ½É•¹Í•ÑÑ¥¹Ì¹‰Õå•ÉQÉ…‘•ÉÌñðmt¤¹±•¹Ñ €ø€À°(€ôì(€¥˜€ …‰½‘ä¹ÁÉ•Ù¥•Ü€˜˜€…‰½‘ä¹‘ÉåIÕ¸€˜˜€…‰½‘ä¹™½É”€˜˜€…¥Í	Õå•É%¹Ù½¥•I•Á½ÉÑÕ”¡Í•ÑÑ¥¹Ì¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€Í•¹Ðè™…±Í”°(€€€€€Í­¥ÁÁ•èÑÉÕ”°(€€€€€É•…Í½¸è€ÕÉÉ•¹Ð!½¹œ-½¹œÑ¥µ”¥Ì½ÕÑÍ¥‘”Ñ¡”½¹™¥ÕÉ•É•Á½ÉÐÍ¡•‘Õ±”¸œ°(€€€€€Í¡•‘Õ±”èì(€€€€€€€Ý••­‘…åÌèÍ•ÑÑ¥¹Ì¹Ý••­‘…åÌ°(€€€€€€€Í•¹‘Q¥µ•ÌèÍ•ÑÑ¥¹Ì¹Í•¹‘Q¥µ•Ì°(€€€€€€€¹½Üè¡½¹-½¹M¡•‘Õ±•A…ÉÑÌ ¤°(€€€€€ô°(€€€ôì(€ô(€½¹ÍÐÉ•Á½ÉÑA…å±½…€ôì‘…åÍ¡•…èÍ•ÑÑ¥¹Ì¹‘…åÍ¡•…ôì(€¥˜€¡Í•ÑÑ¥¹Ì¹¡…Í	Õå•ÉQÉ…‘•É¥±Ñ•È¤É•Á½ÉÑA…å±½…¹‰Õå•ÉQÉ…‘•ÉÌ€ôÍ•ÑÑ¥¹Ì¹‰Õå•ÉQÉ…‘•ÉÌì(€¥˜€ …‰½‘ä¹ÁÉ•Ù¥•Ü€˜˜€…‰½‘ä¹‘ÉåIÕ¸¤É•Á½ÉÑA…å±½…¹™½É”€ôÑÉÕ”ì(€½¹ÍÐÉ•Á½ÉÐ€ô…Ý…¥ÐÍ…±•Í™½É•	Õå•É%¹Ù½¥•ÍÕ”¡É•Á½ÉÑA…å±½…°¹Õ±°°…Ñ¥Ù••ÍÌ¤ì(€½¹ÍÐ•µ…¥°€ô‰Õ¥±‘	Õå•É%¹Ù½¥•I•Á½ÉÑµ…¥°¡É•Á½ÉÐ°Í•ÑÑ¥¹Ì¤ì(€¥˜€¡‰½‘ä¹ÁÉ•Ù¥•Üñð‰½‘ä¹‘ÉåIÕ¸¤ì(€€€…Ý…¥ÐÕÁ‘…Ñ•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Í5•Ñ„¡ì(€€€€€±…ÍÑ}ÁÉ•Ù¥•Ý}…Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€±…ÍÑ}ÁÉ•Ù¥•Ý}É½Ý}½Õ¹ÐèÉ•Á½ÉÐ¹É½ÝÌ¹±•¹Ñ °(€€€€€±…ÍÑ}•ÉÉ½Èè¹Õ±°°(€€€ô¤ì(€€€É•ÑÕÉ¸ì(€€€€€Í•¹Ðè™…±Í”°(€€€€€ÁÉ•Ù¥•ÜèÑÉÕ”°(€€€€€Í•ÑÑ¥¹Ìèì€¸¸¹Í•ÑÑ¥¹Ì°Ñ¼èÍ•ÑÑ¥¹Ì¹Ñ¼°ŒèÍ•ÑÑ¥¹Ì¹Œô°(€€€€€É•Á½ÉÐèì(€€€€€€€É½ÝÌèÉ•Á½ÉÐ¹É½ÝÌ°(€€€€€€€Ñ½‘…äèÉ•Á½ÉÐ¹Ñ½‘…ä°(€€€€€€€‘Õ•Q¡É½Õ èÉ•Á½ÉÐ¹‘Õ•Q¡É½Õ °(€€€€€€€‘…åÍ¡•…èÉ•Á½ÉÐ¹‘…åÍ¡•…°(€€€€€€€‰Õå•ÉQÉ…‘•É=ÁÑ¥½¹ÌèÉ•Á½ÉÐ¹‰Õå•ÉQÉ…‘•É=ÁÑ¥½¹Ì°(€€€€€€€Í•±•Ñ•‘	Õå•ÉQÉ…‘•ÉÌèÉ•Á½ÉÐ¹Í•±•Ñ•‘	Õå•ÉQÉ…‘•ÉÌ°(€€€€€€€¡…Í	Õå•ÉQÉ…‘•É¥±Ñ•ÈèÉ•Á½ÉÐ¹¡…Í	Õå•ÉQÉ…‘•É¥±Ñ•È°(€€€€€ô°(€€€€€•µ…¥°èì(€€€€€€€ÍÕ‰©•Ðè•µ…¥°¹ÍÕ‰©•Ð°(€€€€€€€¡Ñµ°è•µ…¥°¹¡Ñµ°°(€€€€€€€Ñ•áÐè•µ…¥°¹Ñ•áÐ°(€€€€€€€Ñ½Ñ…±Ìè•µ…¥°¹Ñ½Ñ…±Ì°(€€€€€ô°(€€€ôì(€ô(€±•ÐÉ•ÍÕ±Ðì(€ÑÉäì(€€€É•ÍÕ±Ð€ô…Ý…¥ÐÍ•¹‘=Á•É…Ñ¥½¹…±5…¥°¡ì(€€€€€Ñ¼èÍ•ÑÑ¥¹Ì¹Ñ¼°(€€€€€ŒèÍ•ÑÑ¥¹Ì¹Œ°(€€€€€‰ŒèÍ•ÑÑ¥¹Ì¹‰Œ°(€€€€€ÍÕ‰©•Ðè•µ…¥°¹ÍÕ‰©•Ð°(€€€€€¡Ñµ°è•µ…¥°¹¡Ñµ°°(€€€€€Ñ•áÐè•µ…¥°¹Ñ•áÐ°(€€€ô°ì±¥•¹Ðè‘•±¥Ù•Éå±¥•¹Ð°ÁÕÉÁ½Í•-•äè€½ÕÑÍÑ…¹‘¥¹}¥¹Ù½¥•}É•Á½ÉÑÌœô¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€…Ý…¥ÐÕÁ‘…Ñ•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Í5•Ñ„¡ì±…ÍÑ}•ÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”ô¤ì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô(€…Ý…¥ÐÕÁ‘…Ñ•	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Í5•Ñ„¡ì(€€€±…ÍÑ}Í•¹Ñ}…Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€±…ÍÑ}Í•¹Ñ}É½Ý}½Õ¹ÐèÉ•Á½ÉÐ¹É½ÝÌ¹±•¹Ñ °(€€€±…ÍÑ}•ÉÉ½Èè¹Õ±°°(€ô¤ì(€É•ÑÕÉ¸ì(€€€Í•¹ÐèÑÉÕ”°(€€€¥èÉ•ÍÕ±Ð¹¥°(€€€Ñ¼èÍ•ÑÑ¥¹Ì¹Ñ¼°(€€€ŒèÍ•ÑÑ¥¹Ì¹Œ°(€€€‰ŒèÍ•ÑÑ¥¹Ì¹‰Œ°(€€€ÍÕ‰©•Ðè•µ…¥°¹ÍÕ‰©•Ð°(€€€É½ÝÌèÉ•Á½ÉÐ¹É½ÝÌ¹±•¹Ñ °(€€€Ñ½Ñ…±Ìè•µ…¥°¹Ñ½Ñ…±Ì°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸½ÕÑÍÑ…¹‘¥¹	Õå•É%¹Ù½¥•Íµ…¥±É½¸¡‰½‘ä°É•Ä¤ì(€É•ÅÕ¥É•É½¹ÕÑ¡½É¥é…Ñ¥½¸¡É•Ä¤ì(€¥˜€ …¥ÍáÑ•É¹…±Ñ¥½¹¹…‰±• •µ…¥±}‘•±¥Ù•Éäœ¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€Í•¹Ðè™…±Í”°(€€€€€Í­¥ÁÁ•èÑÉÕ”°(€€€€€…Ñ•èÑÉÕ”°(€€€€€É•…Í½¸è€M¡•‘Õ±••µ…¥°‘•±¥Ù•Éä¡…Ì‰••¸Á…ÕÍ•‰ä…¸•µ•É•¹ä½Á•É…Ñ¥½¹…°½¹ÑÉ½°¸œ°(€€€ôì(€ô(€½¹ÍÐÍÑ½É•€ô…Ý…¥Ð±½…‘MÑ½É•‘	Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì ¤ì(€¥˜€¡ÍÑ½É•¹µ•Ñ„¹ÍÑ½É…•Ù…¥±…‰±”€„ôôÑÉÕ”¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È 	Õå•È%¹Ù½¥”•µ…¥°Í•ÑÑ¥¹Ì…É”Ñ•µÁ½É…É¥±äÕ¹…Ù…¥±…‰±”¸M¡•‘Õ±•É•Á½ÉÐÍ•¹‘¥¹œ¥Ì‘¥Í…‰±•Õ¹Ñ¥°ÍÑ½É…”¥ÌÉ•ÍÑ½É•¸œ°€ÔÀÌ¤ì(€ô(€½¹ÍÐÍ•ÑÑ¥¹Ì€ôì(€€€€¸¸¹‰Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Ì¡ÍÑ½É•¹Í•ÑÑ¥¹Ì¤°(€€€¡…Í	Õå•ÉQÉ…‘•É¥±Ñ•Èè€¡ÍÑ½É•¹Í•ÑÑ¥¹Ì¹‰Õå•ÉQÉ…‘•ÉÌñðmt¤¹±•¹Ñ €ø€À°(€ôì(€¥˜€¡Í•ÑÑ¥¹Ì¹•¹…‰±•€ôôô™…±Í”¤(€€€É•ÑÕÉ¸ì(€€€€€Í•¹Ðè™…±Í”°(€€€€€Í­¥ÁÁ•èÑÉÕ”°(€€€€€É•…Í½¸è€µ…¥°Í¡•‘Õ±”¥Ì‘¥Í…‰±•¸œ°(€€€ôì((€½¹ÍÐÝ¥¹‘½Ü€ô‰Õå•É%¹Ù½¥•M¡•‘Õ±•‘]¥¹‘½Ü¡Í•ÑÑ¥¹Ì¤ì(€¥˜€ …Ý¥¹‘½Ü¤ì(€€€É•ÑÕÉ¸ì(€€€€€Í•¹Ðè™…±Í”°(€€€€€Í­¥ÁÁ•èÑÉÕ”°(€€€€€É•…Í½¸è€ÕÉÉ•¹Ð!½¹œ-½¹œÑ¥µ”¥Ì½ÕÑÍ¥‘”Ñ¡”½¹™¥ÕÉ•É•Á½ÉÐÍ¡•‘Õ±”¸œ°(€€€€€Í¡•‘Õ±”èì(€€€€€€€Ý••­‘…åÌèÍ•ÑÑ¥¹Ì¹Ý••­‘…åÌ°(€€€€€€€Í•¹‘Q¥µ•ÌèÍ•ÑÑ¥¹Ì¹Í•¹‘Q¥µ•Ì°(€€€€€€€¹½Üè¡½¹-½¹M¡•‘Õ±•A…ÉÑÌ ¤°(€€€€€ô°(€€€ôì(€ô((€½¹ÍÐÉÕ¸€ô…Ý…¥ÐÍÑ…ÉÑ	Õå•É%¹Ù½¥•µ…¥±IÕ¸¡Ý¥¹‘½Ü¤ì(€¥˜€ …ÉÕ¸¹…±±½Ý•¤(€€€É•ÑÕÉ¸ì(€€€€€Í•¹Ðè™…±Í”°(€€€€€Í­¥ÁÁ•èÑÉÕ”°(€€€€€‘ÕÁ±¥…Ñ”èÑÉÕ”°(€€€€€ÉÕ¹-•äèÝ¥¹‘½Ü¹ÉÕ¹-•ä°(€€€ôì((€ÑÉäì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð½ÕÑÍÑ…¹‘¥¹	Õå•É%¹Ù½¥•Íµ…¥±I•Á½ÉÐ¡ì(€€€€€Í•ÑÑ¥¹Ì°(€€€€€™½É”èÑÉÕ”°(€€€€€Í¡•‘Õ±•èÑÉÕ”°(€€€ô¤ì(€€€…Ý…¥Ð™¥¹¥Í¡	Õå•É%¹Ù½¥•µ…¥±IÕ¸¡Ý¥¹‘½Ü¹ÉÕ¹-•ä°ì(€€€€€ÍÑ…ÑÕÌè€Í•¹Ðœ°(€€€€€É½ÝÍ}½Õ¹ÐèÉ•ÍÕ±Ð¹É½ÝÌ°(€€€€€Ñ½Ñ…±ÌèÉ•ÍÕ±Ð¹Ñ½Ñ…±Ìñðíô°(€€€€€ÁÉ½Ù¥‘•É}É•ÍÕ±Ðèì(€€€€€€€¥èÉ•ÍÕ±Ð¹¥ñð¹Õ±°°(€€€€€€€Ñ¼èÉ•ÍÕ±Ð¹Ñ¼ñðmt°(€€€€€€€ŒèÉ•ÍÕ±Ð¹Œñðmt°(€€€€€€€ÍÕ‰©•ÐèÉ•ÍÕ±Ð¹ÍÕ‰©•Ðñð¹Õ±°°(€€€€€ô°(€€€ô¤ì(€€€É•ÑÕÉ¸ì€¸¸¹É•ÍÕ±Ð°Í¡•‘Õ±•èÑÉÕ”°ÉÕ¹-•äèÝ¥¹‘½Ü¹ÉÕ¹-•äôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€…Ý…¥Ð™¥¹¥Í¡	Õå•É%¹Ù½¥•µ…¥±IÕ¸¡Ý¥¹‘½Ü¹ÉÕ¹-•ä°ì(€€€€€ÍÑ…ÑÕÌè€™…¥±•œ°(€€€€€•ÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”°(€€€ô¤ì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í…±•Í™½É•¥ÍÁÕÑ•MÑ•µÌ¡‰½‘ä°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ±¥µ¥Ð€ô5…Ñ ¹µ…à ÄÀÀ°5…Ñ ¹µ¥¸¡9Õµ‰•È¡‰½‘ä¹±¥µ¥Ð¤ñð€ÔÀÀÀ°€ÄÀÀÀÀ¤¤ì(€½¹ÍÐÉ•ÅÕ•ÍÑ•‘MÑ•µ%€ô¥ÍM…±•Í™½É•%¡MÑÉ¥¹œ¡‰½‘ä¹ÍÑ•µ%ñð€œœ¤¹ÑÉ¥´ ¤¤€üMÑÉ¥¹œ¡‰½‘ä¹ÍÑ•µ%¤¹ÑÉ¥´ ¤€è¹Õ±°ì(€½¹ÍÐm‘•ÍÉ¥‰”°…½Õ¹Ñ•ÍÉ¥‰•t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€Í…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€ÍÑ•µ}}Œœô¤°(€€€Í…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€½Õ¹Ðœô¤°(€t¤ì(€½¹ÍÐ™¥•±‘9…µ•Ì€ô‘•ÍÉ¥‰”¹™¥•±‘Ì¹µ…À ¡˜¤€ôø˜¹¹…µ”¤ì(€½¹ÍÐ‘¥ÍÁÕÑ•½Õ¹Ñ¥•±‘Ì€ô¹•ÜM•Ð ¡…½Õ¹Ñ•ÍÉ¥‰”¹™¥•±‘Ìñðmt¤¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€¥˜€ …‘¥ÍÁÕÑ•½Õ¹Ñ¥•±‘Ì¹¡…Ì %¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œœ¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È ¥ÍÁÕÑ”½Õ¹Ð‘¥Í½Ù•Éä…¹¹½ÐÙ•É¥™ä…Ñ¥Ù”M…±•Í™½É”½Õ¹ÑÌ¸œ°€ÔÀÌ°€%MAUQ}=U9Q}MQQUM}M!5œ°Õ¹‘•™¥¹•°ÑÉÕ”¤ì(€ô(€½¹ÍÐ¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¸€ô…Ý…¥Ð¥¹Ñ•É½™™¥•MÑ•µ•ÍÍ½¹‘¥Ñ¥½¸¡…•ÍÍ½¹Ñ•áÐ°™¥•±‘9…µ•Ì¤ì(€½¹ÍÐ¡…Í¥ÍÁÕÑ”€ô™¥•±‘9…µ•Ì¹¥¹±Õ‘•Ì ¥ÍÁÕÑ•}}Œœ¤ì(€½¹ÍÐ¡…Í¥ÍÁÕÑ•MÑ…ÑÕÌ€ô™¥•±‘9…µ•Ì¹¥¹±Õ‘•Ì ¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œœ¤ì(€¥˜€ …¡…Í¥ÍÁÕÑ”€˜˜€…¡…Í¥ÍÁÕÑ•MÑ…ÑÕÌ¤É•ÑÕÉ¸ìÉ½ÝÌèmtôì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥••ÍÉ¥‰”€ô…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì(€€€½‰©•Ñ9…µ”è€MÕÁÁ±¥•É}%¹Ù½¥•}}Œœ°(€ô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì€ôÍÕÁÁ±¥•É%¹Ù½¥••ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì€ôÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¹µ…À ¡˜¤€ôø˜¹¹…µ”¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘	å9…µ”€ô=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¹µ…À ¡™¥•±¤€ôøm™¥•±¹¹…µ”°™¥•±‘t¤¤ì(€½¹ÍÐÁ…åµ•¹Ñ•ÍÉ¥‰”€ô…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì(€€€½‰©•Ñ9…µ”è€A…åµ•¹Ñ}}Œœ°(€ô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤ì(€½¹ÍÐÁ…åµ•¹Ñ¥•±‘Ì€ôÁ…åµ•¹Ñ•ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐÁ…åµ•¹Ñ¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡Á…åµ•¹Ñ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„€ôÉ•Í½±Ù•MÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¡ì(€€€ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì°(€€€Á…åµ•¹Ñ¥•±‘Ì°(€ô¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±€ôÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹¥¹Ù½¥•A…å…‰±•¥•±ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ñ¥•±‘Ì€ôÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹¥¹Ù½¥•µ½Õ¹Ñ¥•±€ümÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹¥¹Ù½¥•µ½Õ¹Ñ¥•±‘t€èmtì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•Õ•…Ñ•¥•±‘Ì€ôÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹¥¹Ù½¥•Õ•…Ñ•¥•±‘Ìì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•…Ñ•¥•±‘Ì€ôÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹¥¹Ù½¥•…Ñ•¥•±‘Ìì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•MÑ…ÑÕÍ¥•±‘Ì€ôÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹¥¹Ù½¥•MÑ…ÑÕÍ¥•±‘Ìì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É¥•±‘Ì€ôÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹ÍÕÁÁ±¥•É½Õ¹Ñ¥•±‘Ìì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É9…µ•I•±…Ñ¥½¹Í¡¥ÁÌ€ôÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É¥•±‘Ì¹µ…À ¡™¥•±¤€ôøÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘	å9…µ•m™¥•±‘tü¹É•±…Ñ¥½¹Í¡¥Á9…µ”¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐ±¥¹•%Ñ•µ•ÍÉ¥‰”€ô…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì(€€€½‰©•Ñ9…µ”è€MQ5}1¥¹•}%Ñ•µ}}Œœ°(€ô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤ì(€½¹ÍÐ½É¥¥¹…±MÕÁÁ±¥•É1½½­ÕÀ€ôÉ•Í½±Ù•=É¥¥¹…±MÕÁÁ±¥•É1½½­ÕÀ¡±¥¹•%Ñ•µ•ÍÉ¥‰”¹™¥•±‘Ìñðmt¤ì(€½¹ÍÐ½É¥¥¹…±MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥À€ô½É¥¥¹…±MÕÁÁ±¥•É1½½­ÕÀ¹É•±…Ñ¥½¹Í¡¥Á9…µ”ñð€=É¥¥¹…±}MÕÁÁ±¥•É}}Èœì(€½¹ÍÐ•áÑÉ…½ÍÑ•ÍÉ¥‰”€ô…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì(€€€½‰©•Ñ9…µ”è€MQ5}áÑÉ…}½ÍÑ}}Œœ°(€ô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤ì(€½¹ÍÐ•áÑÉ…½ÍÑ¥•±‘Ì€ô•áÑÉ…½ÍÑ•ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐ•áÑÉ…½ÍÑ¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡•áÑÉ…½ÍÑ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐ•áÑÉ…½ÍÑMÕÁÁ±¥•É1½½­ÕÀ€ôÉ•Í½±Ù•áÑÉ…½ÍÑMÕÁÁ±¥•É1½½­ÕÀ¡•áÑÉ…½ÍÑ¥•±‘Ì¤ì(€½¹ÍÐ•áÑÉ…½ÍÑMÕÁÁ±¥•É¥•±€ô•áÑÉ…½ÍÑMÕÁÁ±¥•É1½½­ÕÀ¹™¥•±‘9…µ”ì(€½¹ÍÐ•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥À€ô•áÑÉ…½ÍÑMÕÁÁ±¥•É1½½­ÕÀ¹É•±…Ñ¥½¹Í¡¥Á9…µ”ì((€½¹ÍÐ™¥•±‘Ì€ôl%œ°€9…µ”œ°€É•…Ñ•‘…Ñ”œ°€1…ÍÑ5½‘¥™¥•‘…Ñ”tì(€™½È€¡½¹ÍÐ™¥•±½˜l-•åMÑ•µ}}Œœ°€•±¥Ù•Éå}…Ñ•}}Œœ°€áÁ•Ñ•‘}•±¥Ù•Éå}…Ñ•}}Œœ°€Q}MÑ…ÉÑ}…Ñ•}}Œœ°€	Õå•É}A…å}Q•Éµ}…Ñ•}}Œœ°€%¹Ù½¥•}Õ•}…Ñ•}}Œœ°€Õ•}…Ñ•}}Œœ°€	Õå•É}9…µ•}}Œœ°€	Õå•É}}Œœ°€½Õ¹Ñ}}Œœ°€¥ÍÁÕÑ•}}Œœ°€¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œœ°€Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œœ°€Q½Ñ…±}%¹Ù½¥•‘}µ½Õ¹Ñ}É½µ}MÕÁÁ±¥•ÉÍ}}Œœ°€A…å…‰±•}	…±…¹•}}Œœ°€I••¥Ù…‰±•}	…±…¹•}}Œœ°€E1%-}MQ5}1¥¹•}%Ñ•µ}Q½Ñ…±}½ÍÑ}}Œœ°€E1%-}½ÍÑÍ}Q½Ñ…±}½ÍÑ}}Œt¤ì(€€€¥˜€¡™¥•±‘9…µ•Ì¹¥¹±Õ‘•Ì¡™¥•±¤¤™¥•±‘Ì¹ÁÕÍ ¡™¥•±¤ì(€ô(€¥˜€¡™¥•±‘9…µ•Ì¹¥¹±Õ‘•Ì Y•ÍÍ•±}}Œœ¤¤™¥•±‘Ì¹ÁÕÍ  Y•ÍÍ•±}}È¹9…µ”œ¤ì(€¥˜€¡™¥•±‘9…µ•Ì¹¥¹±Õ‘•Ì A½ÉÑ}}Œœ¤¤™¥•±‘Ì¹ÁÕÍ  A½ÉÑ}}È¹9…µ”œ¤ì(€¥˜€¡™¥•±‘9…µ•Ì¹¥¹±Õ‘•Ì ½Õ¹Ñ}}Œœ¤¤™¥•±‘Ì¹ÁÕÍ  ½Õ¹Ñ}}È¹9…µ”œ°€½Õ¹Ñ}}È¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œœ¤ì((€½¹ÍÐ…Ñ¥Ù•¥ÍÁÕÑ•MÑ…ÑÕÍ½¹‘¥Ñ¥½¸€ô€ˆ¡¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ€„ô¹Õ±°9¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ€„ô€9¼¥ÍÁÕÑ”œ9¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ€„ô€9¼¥ÍÁÕÑ•Ìœ9¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ€„ô€¹¼‘¥ÍÁÕÑ”œ9¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ€„ô€¹¼‘¥ÍÁÕÑ•Ìœ¤ˆì(€½¹ÍÐ‘¥ÍÁÕÑ•½¹‘¥Ñ¥½¸€ô¡…Í¥ÍÁÕÑ•MÑ…ÑÕÌ€ü…Ñ¥Ù•¥ÍÁÕÑ•MÑ…ÑÕÍ½¹‘¥Ñ¥½¸€è€¥ÍÁÕÑ•}}Œ€ôÑÉÕ”œì(€½¹ÍÐÍÑ•µ]¡•É”€ô½µ‰¥¹•]¡•É•½¹‘¥Ñ¥½¹Ì¡m‘¥ÍÁÕÑ•½¹‘¥Ñ¥½¸°¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¸°É•ÅÕ•ÍÑ•‘MÑ•µ%€ü%€ô€œ‘í•Í…Á•M½Å°¡É•ÅÕ•ÍÑ•‘MÑ•µ%¥ô€€è€œt¤ì(€½¹ÍÐÉ½ÝÌ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ (€€€€(€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡™¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€I=4ÍÑ•µ}}Œ(€€€]!I€‘íÍÑ•µ]¡•É•ô(€€€=IH	d1…ÍÑ5½‘¥™¥•‘…Ñ”M(€€€1%5%P€‘í±¥µ¥Ñô(€€°(€€€ì±¥µ¥Ð°Í½™Ñ…¥°èÑÉÕ”ô°(€€¤ì((€½¹ÍÐÍÑ•µ%‘Ì€ôÉ½ÝÌ¹µ…À ¡ÍÑ•´¤€ôøÍÑ•´¹%¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐ±¥¹•%Ñ•µÍ	åMÑ•´€ôíôì(€½¹ÍÐ•áÑÉ…½ÍÑÍ	åMÑ•´€ôíôì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•Í	åMÑ•´€ôíôì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•	åMÑ•´€ôíôì(€½¹ÍÐÍÕÁÁ±¥•ÉA…åµ•¹ÑÍ	å%¹Ù½¥”€ôíôì((€¥˜€¡ÍÑ•µ%‘Ì¹±•¹Ñ ¤ì(€€€½¹ÍÐm±¥¹•%Ñ•µÉÉ…åÌ°•áÑÉ…½ÍÑÉÉ…åÌ°ÍÕÁÁ±¥•É%¹Ù½¥•ÉÉ…åÍt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€Í½Å°è€(€€€€€€€€€M1P%°MQ5}}Œ°AÉ½‘ÕÑ}}È¹9…µ”°MÕÁÁ±¥•É}9…µ•}}Œ°(€€€€€€€€€€€€€€€€€‘í½É¥¥¹…±MÕÁÁ±¥•É1½½­ÕÀ¹Ù…±¥€ü=É¥¥¹…±}MÕÁÁ±¥•É}}Œ°€‘í½É¥¥¹…±MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥Áô¹9…µ”°€‘í½É¥¥¹…±MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥Áô¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œ±€€è€œô(€€€€€€€€€€€€€€€€A…åµ•¹Ñ}Q•Éµ}}Œ°EÕ…¹Ñ¥Ñå}}Œ°EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œ°(€€€€€€€€€€€€€€€€EÕ…¹Ñ¥Ñå}5…á}}Œ°EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œ°%Í}EÕ…¹Ñ¥Ñå}I…¹•}}Œ°(€€€€€€€€€€€€€€€€AÉ¥•}A•É}U¹¥Ñ}}Œ°½ÍÑ}A•É}U¹¥Ñ}}Œ°U¹¥Ñ}M•±±}Ñ}}Œ°U¹¥Ñ}	Õå}Ñ}}Œ°U¹¥Ñ}½ÍÑ}}Œ°(€€€€€€€€€€€€€€€€Q½Ñ…±}AÉ¥•}}Œ°Q½Ñ…±}½ÍÑ}}Œ°MÕÁÁ±¥•É}%¹Ù½¥•}}Œ°…¹•±±•‘}}Œ°(€€€€€€€€€€€€€€€€=™™•É}1¥¹•}%Ñ•µ}}È¹U¹¥ÑAÉ¥”°=™™•É}1¥¹•}%Ñ•µ}}È¹MÕÁÁ±¥•É}U¹¥Ñ}AÉ¥•}}Œ(€€€€€€€€€I=4MQ5}1¥¹•}%Ñ•µ}}Œ(€€€€€€€€€]!IMQ5}}Œ%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€€€=IH	dMQ5}}Œ°É•…Ñ•‘…Ñ”M(€€€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€€€°(€€€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€ôì(€€€€€€€ô¤°(€€€€€€¤°(€€€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€€€½¹ÍÐ•áÑÉ…½ÍÑM•±•Ñ¥•±‘Ì€ôl%œ°€MQ5}}Œœ°€MÕÁÁ±¥•É}9…µ•}}Œœ°€EÕ…¹Ñ¥Ñå}}Œœ°€EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œœ°€EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œœ°€EÕ…¹Ñ¥Ñå}I…¹•}5…á}}Œœ°€%Í}EÕ…¹Ñ¥Ñå}I…¹•}}Œœ°€U¹¥Ñ}AÉ¥•}}Œœ°€U¹¥Ñ}½ÍÑ}}Œœ°€1¥¹•}Q½Ñ…±}}Œœ°€1¥¹•}Q½Ñ…±}	Õå}}Œœ°€MÕÁÁ±¥•É}%¹Ù½¥•}}Œœ°€…¹•±±•‘}}Œœ°•áÑÉ…½ÍÑ¥•±‘9…µ•Ì¹¡…Ì A…åµ•¹Ñ}Q•Éµ}}Œœ¤€ü€A…åµ•¹Ñ}Q•Éµ}}Œœ€è¹Õ±°°•áÑÉ…½ÍÑ¥•±‘9…µ•Ì¹¡…Ì AÉ½‘ÕÐÉ%‘}}Œœ¤€ü€AÉ½‘ÕÐÉ%‘}}È¹9…µ”œ€è¹Õ±°°•áÑÉ…½ÍÑMÕÁÁ±¥•É1½½­ÕÀ¹Ù…±¥€ü•áÑÉ…½ÍÑMÕÁÁ±¥•É¥•±€è¹Õ±°°•áÑÉ…½ÍÑMÕÁÁ±¥•É1½½­ÕÀ¹Ù…±¥€˜˜•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥À€ü€‘í•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥Áô¹9…µ•€€è¹Õ±°°•áÑÉ…½ÍÑMÕÁÁ±¥•É1½½­ÕÀ¹Ù…±¥€˜˜•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥À€ü€‘í•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥Áô¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}€€è¹Õ±±t¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€Í½Å°è€(€€€€€€€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡•áÑÉ…½ÍÑM•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€€€€€€€I=4MQ5}áÑÉ…}½ÍÑ}}Œ(€€€€€€€€€]!IMQ5}}Œ%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€€€°(€€€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€ôì(€€€€€€€ô¤°(€€€€€€¤°(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì¹¥¹±Õ‘•Ì MQ5}}Œœ¤(€€€€€€€€ü½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€€€€€€€¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•M•±•Ñ¥•±‘Ì€ôlMQ5}}Œœ°€%œ°€9…µ”œ°€É•…Ñ•‘…Ñ”œ°€1…ÍÑ5½‘¥™¥•‘…Ñ”œ°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ñ¥•±‘Ì°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•Õ•…Ñ•¥•±‘Ì°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•…Ñ•¥•±‘Ì°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•MÑ…ÑÕÍ¥•±‘Ì°ÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±°ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì¹¥¹±Õ‘•Ì ÕÉÉ•¹å%Í½½‘”œ¤€ü€ÕÉÉ•¹å%Í½½‘”œ€è¹Õ±°°ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘9…µ•Ì¹¥¹±Õ‘•Ì MÕÁÁ±¥•É}9…µ•}}Œœ¤€ü€MÕÁÁ±¥•É}9…µ•}}Œœ€è¹Õ±°°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É¥•±‘Ì°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É9…µ•I•±…Ñ¥½¹Í¡¥ÁÌ¹™±…Ñ5…À ¡É•±…Ñ¥½¹Í¡¥À¤€ôøm€‘íÉ•±…Ñ¥½¹Í¡¥Áô¹9…µ•€°€‘íÉ•±…Ñ¥½¹Í¡¥Áô¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}t¥t¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€Í½Å°è€(€€€€€€€€€€€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡ÍÕÁÁ±¥•É%¹Ù½¥•M•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€€€€€€€€€€€I=4MÕÁÁ±¥•É}%¹Ù½¥•}}Œ(€€€€€€€€€€€€€]!IMQ5}}Œ%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€€€€€€€°(€€€€€€€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€€€€€ôì(€€€€€€€€€€€ô¤°(€€€€€€€€€€¤(€€€€€€€€èAÉ½µ¥Í”¹É•Í½±Ù”¡mt¤°(€€€t¤ì((€€€™½È€¡½¹ÍÐ¥Ñ•´½˜±¥¹•%Ñ•µÉÉ…åÌ¹™±…Ð ¤¤ì(€€€€€¥˜€ …¥Ñ•´¹MQ5}}Œ¤½¹Ñ¥¹Õ”ì(€€€€€¥˜€ …±¥¹•%Ñ•µÍ	åMÑ•µm¥Ñ•´¹MQ5}}t¤±¥¹•%Ñ•µÍ	åMÑ•µm¥Ñ•´¹MQ5}}t€ômtì(€€€€€±¥¹•%Ñ•µÍ	åMÑ•µm¥Ñ•´¹MQ5}}t¹ÁÕÍ ¡¥Ñ•´¤ì(€€€ô(€€€™½È€¡½¹ÍÐ¥Ñ•´½˜•áÑÉ…½ÍÑÉÉ…åÌ¹™±…Ð ¤¤ì(€€€€€¥˜€ …¥Ñ•´¹MQ5}}Œ¤½¹Ñ¥¹Õ”ì(€€€€€¥˜€ …•áÑÉ…½ÍÑÍ	åMÑ•µm¥Ñ•´¹MQ5}}t¤•áÑÉ…½ÍÑÍ	åMÑ•µm¥Ñ•´¹MQ5}}t€ômtì(€€€€€•áÑÉ…½ÍÑÍ	åMÑ•µm¥Ñ•´¹MQ5}}t¹ÁÕÍ ¡¥Ñ•´¤ì(€€€ô(€€€™½È€¡½¹ÍÐ¥¹Ù½¥”½˜ÍÕÁÁ±¥•É%¹Ù½¥•ÉÉ…åÌ¹™±…Ð ¤¤ì(€€€€€¥˜€ …¥¹Ù½¥”¹MQ5}}Œ¤½¹Ñ¥¹Õ”ì(€€€€€¥˜€ …ÍÕÁÁ±¥•É%¹Ù½¥•Í	åMÑ•µm¥¹Ù½¥”¹MQ5}}t¤ÍÕÁÁ±¥•É%¹Ù½¥•Í	åMÑ•µm¥¹Ù½¥”¹MQ5}}t€ômtì(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•Í	åMÑ•µm¥¹Ù½¥”¹MQ5}}t¹ÁÕÍ ¡¥¹Ù½¥”¤ì(€€€€€¥˜€¡ÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±€ôô¹Õ±°¤½¹Ñ¥¹Õ”ì(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•	åMÑ•µm¥¹Ù½¥”¹MQ5}}t€ô€¡ÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•	åMÑ•µm¥¹Ù½¥”¹MQ5}}tñð€À¤€¬9Õµ‰•È¡¥¹Ù½¥•mÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±‘tñð€À¤ì(€€€ô((€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì€ôÍÕÁÁ±¥•É%¹Ù½¥•ÉÉ…åÌ(€€€€€€¹™±…Ð ¤(€€€€€€¹µ…À ¡¥¹Ù½¥”¤€ôø¥¹Ù½¥”¹%¤(€€€€€€¹™¥±Ñ•È¡¥ÍM…±•Í™½É•%¤ì(€€€¥˜€¡ÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì¹±•¹Ñ €˜˜ÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¹±•¹Ñ €˜˜ÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹Ñµ½Õ¹Ñ¥•±¤ì(€€€€€½¹ÍÐÁ…åµ•¹ÑM•±•Ñ¥•±‘Ì€ôl%œ°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì 9…µ”œ¤€ü€9…µ”œ€è¹Õ±°°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì É•…Ñ•‘…Ñ”œ¤€ü€É•…Ñ•‘…Ñ”œ€è¹Õ±°°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì ÕÉÉ•¹å%Í½½‘”œ¤€ü€ÕÉÉ•¹å%Í½½‘”œ€è¹Õ±°°ÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹Ñµ½Õ¹Ñ¥•±°ÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹Ñ…Ñ•¥•±°€¸¸¹ÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì°€¸¸¹ÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ít¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±° (€€€€€€€ÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¹µ…À¡…Íå¹Œ€¡±½½­ÕÁ¥•±¤€ôøì(€€€€€€€€€½¹ÍÐÁ…åµ•¹Ñ¡Õ¹­Ì€ô…Ý…¥Ð½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€€€€€€€¡Õ¹­%‘Ì¡ÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€Í½Å°è€(€€€€€€€€€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡Á…åµ•¹ÑM•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€€€€€€€€€I=4A…åµ•¹Ñ}}Œ(€€€€€€€€€€€]!I€‘í±½½­ÕÁ¥•±‘ô%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€€€€€=IH	d€‘íÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹Ñ…Ñ•¥•±ñð€É•…Ñ•‘…Ñ”ôM9U11L1MP(€€€€€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€€€€€°(€€€€€€€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€€€€€ôì(€€€€€€€€€€€ô¤°(€€€€€€€€€€¤ì(€€€€€€€€€™½È€¡½¹ÍÐÁ…åµ•¹Ð½˜Á…åµ•¹Ñ¡Õ¹­Ì¹™±…Ð ¤¤ì(€€€€€€€€€€€¥˜€ …Ù…±¥‘MÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑA…åµ•¹Ð¡Á…åµ•¹Ð°ÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ì¤¤½¹Ñ¥¹Õ”ì(€€€€€€€€€€€½¹ÍÐ¥¹Ù½¥•%€ôÁ…åµ•¹Ñm±½½­ÕÁ¥•±‘tì(€€€€€€€€€€€¥˜€ …¥ÍM…±•Í™½É•%¡¥¹Ù½¥•%¤¤½¹Ñ¥¹Õ”ì(€€€€€€€€€€€¥˜€ …ÍÕÁÁ±¥•ÉA…åµ•¹ÑÍ	å%¹Ù½¥•m¥¹Ù½¥•%‘t¤ÍÕÁÁ±¥•ÉA…åµ•¹ÑÍ	å%¹Ù½¥•m¥¹Ù½¥•%‘t€ômtì(€€€€€€€€€€€¥˜€¡ÍÕÁÁ±¥•ÉA…åµ•¹ÑÍ	å%¹Ù½¥•m¥¹Ù½¥•%‘t¹Í½µ” ¡•á¥ÍÑ¥¹œ¤€ôø•á¥ÍÑ¥¹œ¹¥€ôôôÁ…åµ•¹Ð¹%¤¤½¹Ñ¥¹Õ”ì(€€€€€€€€€€€ÍÕÁÁ±¥•ÉA…åµ•¹ÑÍ	å%¹Ù½¥•m¥¹Ù½¥•%‘t¹ÁÕÍ ¡ì(€€€€€€€€€€€€€¥èÁ…åµ•¹Ð¹%°(€€€€€€€€€€€€€¹…µ”èÁ…åµ•¹Ð¹9…µ”ñðÁ…åµ•¹Ð¹%°(€€€€€€€€€€€€€…µ½Õ¹Ðè9Õµ‰•È¡Á…åµ•¹ÑmÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹Ñµ½Õ¹Ñ¥•±‘tñð€À¤°(€€€€€€€€€€€€€‘…Ñ”èÁ…åµ•¹ÑmÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹Ñ…Ñ•¥•±‘tñðÁ…åµ•¹Ð¹É•…Ñ•‘…Ñ”ñð¹Õ±°°(€€€€€€€€€€€€€ÕÉÉ•¹å%Í½½‘”èÁ…åµ•¹Ð¹ÕÉÉ•¹å%Í½½‘”ñð€UMœ°(€€€€€€€€€€€€€ÍÑ…ÑÕÌèÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¹Á…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ì¹µ…À ¡™¥•±¤€ôøÁ…åµ•¹Ñm™¥•±‘t¤¹™¥¹¡	½½±•…¸¤ñð¹Õ±°°(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô(€€€€€€€ô¤°(€€€€€€¤ì(€€€ô(€ô((€É•ÑÕÉ¸ì(€€€É½ÝÌèÉ½ÝÌ(€€€€€€¹™¥±Ñ•È ¡ÍÑ•´¤€ôø€…¡…Í¥ÍÁÕÑ•MÑ…ÑÕÌñð€…l¹¼‘¥ÍÁÕÑ”œ°€¹¼‘¥ÍÁÕÑ•Ìt¹¥¹±Õ‘•Ì¡MÑÉ¥¹œ¡ÍÑ•´¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œñð€œœ¤¹Ñ½1½Ý•É…Í” ¤¤¤(€€€€€€¹µ…À ¡ÍÑ•´¤€ôøì(€€€€€€€½¹ÍÐÍÑ•µ!…Í•±¥Ù•Éä€ô€„…ÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œì(€€€€€€€½¹ÍÐ±¥¹•%Ñ•µÌ€ô±¥¹•%Ñ•µÍ	åMÑ•µmÍÑ•´¹%‘tñðmtì(€€€€€€€½¹ÍÐ•áÑÉ…½ÍÑÌ€ô•áÑÉ…½ÍÑÍ	åMÑ•µmÍÑ•´¹%‘tñðmtì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•Ì€ôÍÕÁÁ±¥•É%¹Ù½¥•Í	åMÑ•µmÍÑ•´¹%‘tñðmtì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É9…µ•Ì€ô¹•ÜM•Ð ¤ì(€€€€€€€½¹ÍÐÁÉ½‘ÕÑ9…µ•Ì€ô¹•ÜM•Ð ¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•ÉAÉ½‘ÕÑA…¥ÉÌ€ômtì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•ÉAÉ½‘ÕÑA…¥É-•åÌ€ô¹•ÜM•Ð ¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•AÉ½‘ÕÑI½ÝÍ	å%€ô¹•Ü5…À ¤ì(€€€€€€€½¹ÍÐÕ¹¥¹Ù½¥•‘áÑÉ…½ÍÑAÉ½‘ÕÑI½ÝÌ€ômtì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É1¥¹•	Õå	å½Õ¹Ð€ô¹•Ü5…À ¤ì(€€€€€€€½¹ÍÐÕ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	Õå	å½Õ¹Ð€ô¹•Ü5…À ¤ì(€€€€€€€±•Ð±¥¹•M•±±Q½Ñ…°€ô€Àì(€€€€€€€±•ÐÍÕÁÁ±¥•É1¥¹•	Õä€ô€Àì(€€€€€€€±•ÐÕ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	Õä€ô€Àì(€€€€€€€±•Ð•áÑÉ…M•±±Q½Ñ…°€ô€Àì(€€€€€€€±•Ð•áÑÉ…½ÍÑ	Õä€ô€Àì(€€€€€€€±•Ð¥¹Ù½¥•‘áÑÉ…½ÍÑ	Õä€ô€Àì(€€€€€€€±•ÐÍ•±±=¹±åáÑÉ…M•±°€ô€Àì(€€€€€€€±•Ð¡…ÍMÕÁÁ±¥•É%¹Ù½¥”€ô™…±Í”ì((€€€€€€€™½È€¡½¹ÍÐ¥Ñ•´½˜±¥¹•%Ñ•µÌ¤ì(€€€€€€€€€¥˜€¡¥Ñ•´¹…¹•±±•‘}}Œ¤½¹Ñ¥¹Õ”ì(€€€€€€€€€½¹ÍÐ½É¥¥¹…±MÕÁÁ±¥•É%¹…Ñ¥Ù”€ô¥Ñ•µm½É¥¥¹…±MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥Átü¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œ€ôôôÑÉÕ”ì(€€€€€€€€€½¹ÍÐ½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ%€ô½É¥¥¹…±MÕÁÁ±¥•É%¹…Ñ¥Ù”€ü¹Õ±°€è¥Ñ•´¹=É¥¥¹…±}MÕÁÁ±¥•É}}Œñð¹Õ±°ì(€€€€€€€€€½¹ÍÐ½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ-•ä€ô‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ%¤ì(€€€€€€€€€½¹ÍÐ½É¥¥¹…±MÕÁÁ±¥•É9…µ”€ô½É¥¥¹…±MÕÁÁ±¥•É%¹…Ñ¥Ù”€ü¹Õ±°€è¥Ñ•µm½É¥¥¹…±MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥Átü¹9…µ”ñð¥Ñ•´¹MÕÁÁ±¥•É}9…µ•}}Œñð½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ%ñð¹Õ±°ì(€€€€€€€€€¥˜€¡½É¥¥¹…±MÕÁÁ±¥•É9…µ”¤ÍÕÁÁ±¥•É9…µ•Ì¹…‘¡½É¥¥¹…±MÕÁÁ±¥•É9…µ”¤ì(€€€€€€€€€½¹ÍÐÁÉ½‘ÕÑ9…µ”€ô¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹9…µ”ì(€€€€€€€€€¥˜€¡ÁÉ½‘ÕÑ9…µ”¤ÁÉ½‘ÕÑ9…µ•Ì¹…‘¡ÁÉ½‘ÕÑ9…µ”¤ì(€€€€€€€€€½¹ÍÐÅÕ…¹Ñ¥Ñå1…‰•°€ô±¥¹•%Ñ•µEÕ…¹Ñ¥Ñå1…‰•°¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€€€€€€€¥˜€¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¤ì(€€€€€€€€€€€½¹ÍÐ¥¹Ù½¥•I½ÝÌ€ôÍÕÁÁ±¥•É%¹Ù½¥•AÉ½‘ÕÑI½ÝÍ	å%¹•Ð¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¤ñðmtì(€€€€€€€€€€€¥¹Ù½¥•I½ÝÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€ÁÉ½‘ÕÑ9…µ”èÁÉ½‘ÕÑ9…µ”ñð¥Ñ•´¹9…µ”ñð€AÉ½‘ÕÐœ°(€€€€€€€€€€€€€ÅÕ…¹Ñ¥Ñå1…‰•°°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”è½É¥¥¹…±MÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É½Õ¹Ñ%è½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ%°(€€€€€€€€€€€€€Á…åµ•¹ÑQ•É´è¥Ñ•´¹A…åµ•¹Ñ}Q•Éµ}}Œñð¹Õ±°°(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•AÉ½‘ÕÑI½ÝÍ	å%¹Í•Ð¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ°¥¹Ù½¥•I½ÝÌ¤ì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡½É¥¥¹…±MÕÁÁ±¥•É9…µ”ñðÁÉ½‘ÕÑ9…µ”¤ì(€€€€€€€€€€€½¹ÍÐÁ…¥É-•ä€ô€‘í½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ-•äñð½É¥¥¹…±MÕÁÁ±¥•É9…µ”ñð€œõqÔÀÀÀÀ‘íÁÉ½‘ÕÑ9…µ”ñð€œõ€ì(€€€€€€€€€€€¥˜€ …ÍÕÁÁ±¥•ÉAÉ½‘ÕÑA…¥É-•åÌ¹¡…Ì¡Á…¥É-•ä¤¤ì(€€€€€€€€€€€€€ÍÕÁÁ±¥•ÉAÉ½‘ÕÑA…¥É-•åÌ¹…‘¡Á…¥É-•ä¤ì(€€€€€€€€€€€€€ÍÕÁÁ±¥•ÉAÉ½‘ÕÑA…¥ÉÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”è½É¥¥¹…±MÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É½Õ¹Ñ%è½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ%°(€€€€€€€€€€€€€€€ÁÉ½‘ÕÑ9…µ”èÁÉ½‘ÕÑ9…µ”ñð¹Õ±°°(€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€€€±¥¹•M•±±Q½Ñ…°€¬ô±¥¹•M•±±µ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€€€€€€€½¹ÍÐ‰Õä€ô±¥¹•	Õåµ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€€€€€€€ÍÕÁÁ±¥•É1¥¹•	Õä€¬ô‰Õäì(€€€€€€€€€¥˜€¡½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ-•ä¤ì(€€€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É1¥¹”€ôÍÕÁÁ±¥•É1¥¹•	Õå	å½Õ¹Ð¹•Ð¡½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ-•ä¤ñðì(€€€€€€€€€€€€€…½Õ¹Ñ%è½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ%°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”è½É¥¥¹…±MÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€€€…µ½Õ¹Ðè€À°(€€€€€€€€€€€ôì(€€€€€€€€€€€ÍÕÁÁ±¥•É1¥¹”¹…µ½Õ¹Ð€¬ô‰Õäì(€€€€€€€€€€€ÍÕÁÁ±¥•É1¥¹•	Õå	å½Õ¹Ð¹Í•Ð¡½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ-•ä°ÍÕÁÁ±¥•É1¥¹”¤ì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¤ì(€€€€€€€€€€€¡…ÍMÕÁÁ±¥•É%¹Ù½¥”€ôÑÉÕ”ì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€Õ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	Õä€¬ô‰Õäì(€€€€€€€€€€€¥˜€¡½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ-•ä¤ì(€€€€€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É1¥¹”€ôÕ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	Õå	å½Õ¹Ð¹•Ð¡½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ-•ä¤ñðì(€€€€€€€€€€€€€€€…½Õ¹Ñ%è½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ%°(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”è½É¥¥¹…±MÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€€€€€…µ½Õ¹Ðè€À°(€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€ÍÕÁÁ±¥•É1¥¹”¹…µ½Õ¹Ð€¬ô‰Õäì(€€€€€€€€€€€€€Õ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	Õå	å½Õ¹Ð¹Í•Ð¡½É¥¥¹…±MÕÁÁ±¥•É½Õ¹Ñ-•ä°ÍÕÁÁ±¥•É1¥¹”¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€ô((€€€€€€€™½È€¡½¹ÍÐ¥Ñ•´½˜•áÑÉ…½ÍÑÌ¤ì(€€€€€€€€€¥˜€¡¥Ñ•´¹…¹•±±•‘}}Œ¤½¹Ñ¥¹Õ”ì(€€€€€€€€€½¹ÍÐÁÉ½‘ÕÑ9…µ”€ô‘¥ÍÁÕÑ•EÕ•Õ•áÑÉ…½ÍÑAÉ½‘ÕÑ9…µ”¡¥Ñ•´¤ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É%¹…Ñ¥Ù”€ô•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥À€˜˜¥Ñ•µm•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥Átü¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œ€ôôôÑÉÕ”ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É½Õ¹Ñ%€ôÍÕÁÁ±¥•É%¹…Ñ¥Ù”€ü¹Õ±°€è•áÑÉ…½ÍÑMÕÁÁ±¥•É¥•±€ü¥Ñ•µm•áÑÉ…½ÍÑMÕÁÁ±¥•É¥•±‘t€è¹Õ±°ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É½Õ¹Ñ-•ä€ô‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡ÍÕÁÁ±¥•É½Õ¹Ñ%¤ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É9…µ”€ôÍÕÁÁ±¥•É%¹…Ñ¥Ù”€ü¹Õ±°€è€¡•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥À€ü¥Ñ•µm•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥Átü¹9…µ”€è¹Õ±°¤ñð¥Ñ•´¹MÕÁÁ±¥•É}9…µ•}}ŒñðÍÕÁÁ±¥•É½Õ¹Ñ%ñð¹Õ±°ì(€€€€€€€€€¥˜€¡ÁÉ½‘ÕÑ9…µ”¤ÁÉ½‘ÕÑ9…µ•Ì¹…‘¡ÁÉ½‘ÕÑ9…µ”¤ì(€€€€€€€€€¥˜€¡ÍÕÁÁ±¥•É9…µ”ñðÁÉ½‘ÕÑ9…µ”¤ì(€€€€€€€€€€€½¹ÍÐÁ…¥É-•ä€ô€‘íÍÕÁÁ±¥•É½Õ¹Ñ-•äñðÍÕÁÁ±¥•É9…µ”ñð€œõqÔÀÀÀÀ‘íÁÉ½‘ÕÑ9…µ”ñð€œõ€ì(€€€€€€€€€€€¥˜€ …ÍÕÁÁ±¥•ÉAÉ½‘ÕÑA…¥É-•åÌ¹¡…Ì¡Á…¥É-•ä¤¤ì(€€€€€€€€€€€€€ÍÕÁÁ±¥•ÉAÉ½‘ÕÑA…¥É-•åÌ¹…‘¡Á…¥É-•ä¤ì(€€€€€€€€€€€€€ÍÕÁÁ±¥•ÉAÉ½‘ÕÑA…¥ÉÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É½Õ¹Ñ%°(€€€€€€€€€€€€€€€ÁÉ½‘ÕÑ9…µ”°(€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€€€¥˜€¡ÁÉ½‘ÕÑ9…µ”¤ì(€€€€€€€€€€€½¹ÍÐÁÉ½‘ÕÑI½Ü€ôì(€€€€€€€€€€€€€ÁÉ½‘ÕÑ9…µ”°(€€€€€€€€€€€€€ÅÕ…¹Ñ¥Ñå1…‰•°è¹Õ±°°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É½Õ¹Ñ%°(€€€€€€€€€€€€€Á…åµ•¹ÑQ•É´è¥Ñ•´¹A…åµ•¹Ñ}Q•Éµ}}Œñð¹Õ±°°(€€€€€€€€€€€€€Í½ÕÉ•QåÁ”è€•áÑÉ…}½ÍÐœ°(€€€€€€€€€€€€€Í½ÕÉ•I•½É‘%è¥Ñ•´¹%°(€€€€€€€€€€€ôì(€€€€€€€€€€€¥˜€¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¤ì(€€€€€€€€€€€€€½¹ÍÐ¥¹Ù½¥•I½ÝÌ€ôÍÕÁÁ±¥•É%¹Ù½¥•AÉ½‘ÕÑI½ÝÍ	å%¹•Ð¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¤ñðmtì(€€€€€€€€€€€€€¥¹Ù½¥•I½ÝÌ¹ÁÕÍ ¡ÁÉ½‘ÕÑI½Ü¤ì(€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•AÉ½‘ÕÑI½ÝÍ	å%¹Í•Ð¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ°¥¹Ù½¥•I½ÝÌ¤ì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€Õ¹¥¹Ù½¥•‘áÑÉ…½ÍÑAÉ½‘ÕÑI½ÝÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•%è¹Õ±°°(€€€€€€€€€€€€€€€¥¹Ù½¥•9…µ”è¹Õ±°°(€€€€€€€€€€€€€€€€¸¸¹ÁÉ½‘ÕÑI½Ü°(€€€€€€€€€€€€€€€‘Õ•…Ñ”è¹Õ±°°(€€€€€€€€€€€€€€€ÁÉ½‘ÕÑEÕ…¹Ñ¥Ñå1…‰•°èmÁÉ½‘ÕÑI½Ü¹ÁÉ½‘ÕÑ9…µ”°ÁÉ½‘ÕÑI½Ü¹ÅÕ…¹Ñ¥Ñå1…‰•±t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€´€œ¤°(€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐ‰Õä€ô•áÑÉ…	Õåµ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€€€€€€€½¹ÍÐÍ•±°€ô•áÑÉ…M•±±µ½Õ¹Ð¡¥Ñ•´°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€€€€€€€•áÑÉ…M•±±Q½Ñ…°€¬ôÍ•±°ì(€€€€€€€€€¥˜€¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¤ì(€€€€€€€€€€€¥¹Ù½¥•‘áÑÉ…½ÍÑ	Õä€¬ô‰Õäì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€•áÑÉ…½ÍÑ	Õä€¬ô‰Õäì(€€€€€€€€€€€¥˜€¡‰Õä€ôôô€À€˜˜Í•±°€ø€À¤Í•±±=¹±åáÑÉ…M•±°€¬ôÍ•±°ì(€€€€€€€€€ô(€€€€€€€ô((€€€€€€€½¹ÍÐÍÕÁÁ±¥•É	…Í”€ô9Õµ‰•È¡ÍÑ•´¹Q½Ñ…±}%¹Ù½¥•‘}µ½Õ¹Ñ}É½µ}MÕÁÁ±¥•ÉÍ}}Œñð€À¤€¬€¡¡…ÍMÕÁÁ±¥•É%¹Ù½¥”€üÕ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	Õä€èÍÕÁÁ±¥•É1¥¹•	Õä¤ì(€€€€€€€½¹ÍÐÉ…ÝMÕÁÁ±¥•È€ôÍÕÁÁ±¥•É	…Í”€¬•áÑÉ…½ÍÑ	Õäì(€€€€€€€½¹ÍÐÕ¹µ…Ñ¡•‘M•±±=¹±åáÑÉ„€ô¡…ÍMÕÁÁ±¥•É%¹Ù½¥”€ü5…Ñ ¹µ…à À°Í•±±=¹±åáÑÉ…M•±°€´¥¹Ù½¥•‘áÑÉ…½ÍÑ	Õä¤€è€Àì(€€€€€€€½¹ÍÐÅ±¥­MÕÁÁ±¥•É½ÍÐ€ôÍÑ•´¹E1%-}MQ5}1¥¹•}%Ñ•µ}Q½Ñ…±}½ÍÑ}}Œ€„ô¹Õ±°ñðÍÑ•´¹E1%-}½ÍÑÍ}Q½Ñ…±}½ÍÑ}}Œ€„ô¹Õ±°€ü€¡ÍÑ•´¹E1%-}MQ5}1¥¹•}%Ñ•µ}Q½Ñ…±}½ÍÑ}}Œñð€À¤€¬€¡ÍÑ•´¹E1%-}½ÍÑÍ}Q½Ñ…±}½ÍÑ}}Œñð€À¤€è¹Õ±°ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É=Ù•ÉÍÑ…Ñ•µ•¹Ð€ôÅ±¥­MÕÁÁ±¥•É½ÍÐ€ôô¹Õ±°€ü€À€èÉ…ÝMÕÁÁ±¥•È€´Å±¥­MÕÁÁ±¥•É½ÍÐì(€€€€€€€½¹ÍÐ…±Õ±…Ñ•‘MÕÁÁ±¥•É%¹Ù½¥”€ôÕ¹µ…Ñ¡•‘M•±±=¹±åáÑÉ„€ø€À€˜˜ÍÕÁÁ±¥•É=Ù•ÉÍÑ…Ñ•µ•¹Ð€ø€À€˜˜ÍÕÁÁ±¥•É=Ù•ÉÍÑ…Ñ•µ•¹Ð€ðôÕ¹µ…Ñ¡•‘M•±±=¹±åáÑÉ„€¬€À¸ÀÔ€üÅ±¥­MÕÁÁ±¥•É½ÍÐ€èÉ…ÝMÕÁÁ±¥•Èì(€€€€€€€½¹ÍÐ…±Õ±…Ñ•‘	Õå•É%¹Ù½¥”€ô±¥¹•M•±±Q½Ñ…°€¬•áÑÉ…M•±±Q½Ñ…°ì(€€€€€€€½¹ÍÐ‰Õå•É%¹Ù½¥•µ½Õ¹Ð€ô€…ÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œ€˜˜…±Õ±…Ñ•‘	Õå•É%¹Ù½¥”€ø€À€ü…±Õ±…Ñ•‘	Õå•É%¹Ù½¥”€èÍÑ•´¹Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œì(€€€€€€€½¹ÍÐÍÑ•µ	…Í•A¹°€ô‰Õå•É%¹Ù½¥•µ½Õ¹Ð€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡‰Õå•É%¹Ù½¥•µ½Õ¹Ðñð€À¤€´9Õµ‰•È¡…±Õ±…Ñ•‘MÕÁÁ±¥•É%¹Ù½¥”ñð€À¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±”€ôÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•	åMÑ•µmÍÑ•´¹%‘tì(€€€€€€€½¹ÍÐÁ…å…‰±•	…±…¹”€ôÍÑ•´¹A…å…‰±•}	…±…¹•}}Œ€üü€¡ÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±”€„ô¹Õ±°€üÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±”€è¹Õ±°¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É¥¹…¹•	å½Õ¹Ð€ô¹•Ü5…À ¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•Õ•I½ÝÌ€ômtì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•áÁ½ÍÕÉ•I½ÝÌ€ômtì(€€€€€€€½¹ÍÐ…‘‘MÕÁÁ±¥•É¥¹…¹•	å½Õ¹Ð€ô€¡…½Õ¹Ñ%°ÍÕÁÁ±¥•É9…µ”°¥¹Ù½¥•µ½Õ¹Ð€ô€À°ÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹”€ô€À¤€ôøì(€€€€€€€€€½¹ÍÐ…½Õ¹Ñ-•ä€ô‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡…½Õ¹Ñ%¤ì(€€€€€€€€€¥˜€ ……½Õ¹Ñ-•ä¤É•ÑÕÉ¸ì(€€€€€€€€€½¹ÍÐÕÉÉ•¹Ð€ôÍÕÁÁ±¥•É¥¹…¹•	å½Õ¹Ð¹•Ð¡…½Õ¹Ñ-•ä¤ñðì(€€€€€€€€€€€…½Õ¹Ñ%°(€€€€€€€€€€€…½Õ¹Ñ-•ä°(€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”èÍÕÁÁ±¥•É9…µ”ñð…½Õ¹Ñ%°(€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ðè€À°(€€€€€€€€€€€Á…å…‰±•	…±…¹”è€À°(€€€€€€€€€ôì(€€€€€€€€€ÕÉÉ•¹Ð¹ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ð€¬ô9Õµ‰•È¡¥¹Ù½¥•µ½Õ¹Ðñð€À¤ì(€€€€€€€€€ÕÉÉ•¹Ð¹Á…å…‰±•	…±…¹”€¬ô9Õµ‰•È¡ÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹”ñð€À¤ì(€€€€€€€€€ÍÕÁÁ±¥•É¥¹…¹•	å½Õ¹Ð¹Í•Ð¡…½Õ¹Ñ-•ä°ÕÉÉ•¹Ð¤ì(€€€€€€€ôì(€€€€€€€™½È€¡½¹ÍÐ¥¹Ù½¥”½˜ÍÕÁÁ±¥•É%¹Ù½¥•Ì¤ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É½Õ¹Ñ¥•±€ôÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É¥•±‘Ì¹™¥¹ ¡™¥•±¤€ôø¥¹Ù½¥•m™¥•±‘t¤ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É½Õ¹ÑI•±…Ñ¥½¹Í¡¥À€ôÍÕÁÁ±¥•É½Õ¹Ñ¥•±€üÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘	å9…µ•mÍÕÁÁ±¥•É½Õ¹Ñ¥•±‘tü¹É•±…Ñ¥½¹Í¡¥Á9…µ”€è¹Õ±°ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É½Õ¹Ñ%¹…Ñ¥Ù”€ôÍÕÁÁ±¥•É½Õ¹ÑI•±…Ñ¥½¹Í¡¥À€˜˜¥¹Ù½¥•mÍÕÁÁ±¥•É½Õ¹ÑI•±…Ñ¥½¹Í¡¥Átü¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œ€ôôôÑÉÕ”ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É½Õ¹Ñ%€ôÍÕÁÁ±¥•É½Õ¹Ñ%¹…Ñ¥Ù”€ü¹Õ±°€èÍÕÁÁ±¥•É½Õ¹Ñ¥•±€ü¥¹Ù½¥•mÍÕÁÁ±¥•É½Õ¹Ñ¥•±‘t€è¹Õ±°ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•É9…µ”€ôÍÕÁÁ±¥•É½Õ¹Ñ%¹…Ñ¥Ù”€ü¹Õ±°€è€¡ÍÕÁÁ±¥•É½Õ¹ÑI•±…Ñ¥½¹Í¡¥À€ü¥¹Ù½¥•mÍÕÁÁ±¥•É½Õ¹ÑI•±…Ñ¥½¹Í¡¥Átü¹9…µ”€è¹Õ±°¤ñð¥¹Ù½¥•lMÕÁÁ±¥•É}}Ètü¹9…µ”ñð¥¹Ù½¥”¹MÕÁÁ±¥•É}9…µ•}}Œñð¥¹Ù½¥•láÁ•Ñ•‘}MÕÁÁ±¥•É}}Ètü¹9…µ”ñð¥¹Ù½¥•lMÕ‰ÍÑ¥ÑÕÑ•}MÕÁÁ±¥•É}}Ètü¹9…µ”ñðÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É9…µ•I•±…Ñ¥½¹Í¡¥ÁÌ¹µ…À ¡É•±…Ñ¥½¹Í¡¥À¤€ôø¥¹Ù½¥•mÉ•±…Ñ¥½¹Í¡¥Átü¹9…µ”¤¹™¥¹¡	½½±•…¸¤ñð¹Õ±°ì(€€€€€€€€€½¹ÍÐ¥¹Ù½¥•µ½Õ¹Ñ¥•±€ôÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ñ¥•±‘Ì¹™¥¹ ¡™¥•±¤€ôø¥¹Ù½¥•m™¥•±‘t€„ô¹Õ±°¤ì(€€€€€€€€€½¹ÍÐ¥¹Ù½¥•µ½Õ¹Ð€ô¥¹Ù½¥•µ½Õ¹Ñ¥•±€ü9Õµ‰•È¡¥¹Ù½¥•m¥¹Ù½¥•µ½Õ¹Ñ¥•±‘tñð€À¤€è€Àì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹•Y…±Õ”€ôÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±€ü¥¹Ù½¥•mÍÕÁÁ±¥•É%¹Ù½¥•A…å…‰±•¥•±‘t€è¹Õ±°ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹•Ù…¥±…‰±”€ôÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹•Y…±Õ”€„ô¹Õ±°€˜˜ÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹•Y…±Õ”€„ôô€œœ€˜˜9Õµ‰•È¹¥Í¥¹¥Ñ”¡9Õµ‰•È¡ÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹•Y…±Õ”¤¤ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹”€ôÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹•Ù…¥±…‰±”€ü9Õµ‰•È¡ÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹•Y…±Õ”¤€è€Àì(€€€€€€€€€…‘‘MÕÁÁ±¥•É¥¹…¹•	å½Õ¹Ð¡ÍÕÁÁ±¥•É½Õ¹Ñ%°ÍÕÁÁ±¥•É9…µ”°¥¹Ù½¥•µ½Õ¹Ð°ÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹”¤ì(€€€€€€€€€½¹ÍÐ‘Õ•…Ñ•¥•±€ôÍÕÁÁ±¥•É%¹Ù½¥•Õ•…Ñ•¥•±‘Ì¹™¥¹ ¡™¥•±¤€ôø¥¹Ù½¥•m™¥•±‘t¤ì(€€€€€€€€€½¹ÍÐ‘Õ•…Ñ”€ô‘Õ•…Ñ•¥•±€ü¥¹Ù½¥•m‘Õ•…Ñ•¥•±‘t€è¹Õ±°ì(€€€€€€€€€½¹ÍÐ¥¹Ù½¥•…Ñ•¥•±€ôÍÕÁÁ±¥•É%¹Ù½¥•…Ñ•¥•±‘Ì¹™¥¹ ¡™¥•±¤€ôø¥¹Ù½¥•m™¥•±‘t¤ì(€€€€€€€€€½¹ÍÐ¥¹Ù½¥•…Ñ”€ô¥¹Ù½¥•…Ñ•¥•±€ü¥¹Ù½¥•m¥¹Ù½¥•…Ñ•¥•±‘t€è¥¹Ù½¥”¹É•…Ñ•‘…Ñ”ñð¹Õ±°ì(€€€€€€€€€½¹ÍÐ¥¹Ù½¥•MÑ…ÑÕÌ€ôÍÕÁÁ±¥•É%¹Ù½¥•MÑ…ÑÕÍ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø¥¹Ù½¥•m™¥•±‘t¤¹™¥¹¡	½½±•…¸¤ñð¹Õ±°ì(€€€€€€€€€½¹ÍÐÁ…åµ•¹ÑI½ÝÌ€ôÍÕÁÁ±¥•ÉA…åµ•¹ÑÍ	å%¹Ù½¥•m¥¹Ù½¥”¹%‘tñðmtì(€€€€€€€€€½¹ÍÐÁ½Í¥Ñ¥Ù•A…åµ•¹ÑÌ€ôÁ…åµ•¹ÑI½ÝÌ¹™¥±Ñ•È ¡Á…åµ•¹Ð¤€ôø9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ð¤€ø€À¤¹É•‘Õ” ¡ÍÕ´°Á…åµ•¹Ð¤€ôøÍÕ´€¬9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤°€À¤ì(€€€€€€€€€½¹ÍÐÍÕÁÁ±¥•ÉI•™Õ¹‘Ì€ô5…Ñ ¹…‰Ì¡Á…åµ•¹ÑI½ÝÌ¹™¥±Ñ•È ¡Á…åµ•¹Ð¤€ôø9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ð¤€ð€À¤¹É•‘Õ” ¡ÍÕ´°Á…åµ•¹Ð¤€ôøÍÕ´€¬9Õµ‰•È¡Á…åµ•¹Ð¹…µ½Õ¹Ðñð€À¤°€À¤¤ì(€€€€€€€€€½¹ÍÐ•áÁ½ÍÕÉ”€ô¹½Éµ…±¥é•MÕÁÁ±¥•É%¹Ù½¥•áÁ½ÍÕÉ”¡ì(€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•%è¥¹Ù½¥”¹%°(€€€€€€€€€€€¥¹Ù½¥•9…µ”è¥¹Ù½¥”¹9…µ”°(€€€€€€€€€€€Í½ÕÉ•MÑ•µ%èÍÑ•´¹%°(€€€€€€€€€€€ÍÕÁÁ±¥•É½Õ¹Ñ%°(€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€ÕÉÉ•¹å%Í½½‘”è¥¹Ù½¥”¹ÕÉÉ•¹å%Í½½‘”ñð€UMœ°(€€€€€€€€€€€‘Õ•…Ñ”°(€€€€€€€€€€€¥¹Ù½¥•…Ñ”°(€€€€€€€€€€€É•…Ñ•‘…Ñ”è¥¹Ù½¥”¹É•…Ñ•‘…Ñ”ñð¹Õ±°°(€€€€€€€€€€€¥¹Ù½¥•µ½Õ¹Ð°(€€€€€€€€€€€Á…å…‰±•	…±…¹”èÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹”°(€€€€€€€€€€€Á…å…‰±•	…±…¹•Ù…¥±…‰±”èÍÕÁÁ±¥•ÉA…å…‰±•	…±…¹•Ù…¥±…‰±”°(€€€€€€€€€€€ÍÑ…ÑÕÌè¥¹Ù½¥•MÑ…ÑÕÌ°(€€€€€€€€€€€Á…åµ•¹ÑÌèÁ…åµ•¹ÑI½ÝÌ°(€€€€€€€€€ô¤ì(€€€€€€€€€½¹ÍÐ¹•ÑA…åµ•¹ÑÕ‘¥Ð€ôÁ½Í¥Ñ¥Ù•A…åµ•¹ÑÌ€´ÍÕÁÁ±¥•ÉI•™Õ¹‘Ìì(€€€€€€€€€½¹ÍÐ•áÁ•Ñ•‘A…¥€ô5…Ñ ¹µ…à À°•áÁ½ÍÕÉ”¹¥¹Ù½¥•µ½Õ¹Ð€´•áÁ½ÍÕÉ”¹Á…å…‰±•	…±…¹”¤ì(€€€€€€€€€½¹ÍÐ•áÁ½ÍÕÉ•]…É¹¥¹Ì€ôl¸¸¹•áÁ½ÍÕÉ”¹Ý…É¹¥¹Ítì(€€€€€€€€€¥˜€ …‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡ÍÕÁÁ±¥•É½Õ¹Ñ%¤¤ì(€€€€€€€€€€€•áÁ½ÍÕÉ•]…É¹¥¹Ì¹ÁÕÍ  MÕÁÁ±¥•È¥¹Ù½¥”¡…Ì¹¼Ù…±¥ÍÕÁÁ±¥•È½Õ¹Ð±½½­ÕÀ¸œ¤ì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡Á…åµ•¹ÑI½ÝÌ¹±•¹Ñ €˜˜5…Ñ ¹…‰Ì¡•áÁ•Ñ•‘A…¥€´¹•ÑA…åµ•¹ÑÕ‘¥Ð¤€ø€À¸ÀÔ¤ì(€€€€€€€€€€€•áÁ½ÍÕÉ•]…É¹¥¹Ì¹ÁÕÍ  A…åµ•¹ÐÉ•½É‘Ì‘¼¹½ÐÉ•½¹¥±”Ñ¼Ñ¡”ÕÉÉ•¹ÐÁ…å…‰±”‰…±…¹”ì¥¹…¹”½¹™¥Éµ…Ñ¥½¸¥ÌÉ•ÅÕ¥É•¸œ¤ì(€€€€€€€€€ô(€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•áÁ½ÍÕÉ•I½ÝÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€¸¸¹•áÁ½ÍÕÉ”°(€€€€€€€€€€€Á…åµ•¹ÑÌèÁ…åµ•¹ÑI½ÝÌ°(€€€€€€€€€€€Á½Í¥Ñ¥Ù•A…åµ•¹ÑÌ°(€€€€€€€€€€€ÍÕÁÁ±¥•ÉI•™Õ¹‘Ì°(€€€€€€€€€€€¹•ÑA…åµ•¹ÑÕ‘¥Ð°(€€€€€€€€€€€ÍÑ…ÑÕÌè¥¹Ù½¥•MÑ…ÑÕÌ°(€€€€€€€€€€€Ý…É¹¥¹Ìèl¸¸¹¹•ÜM•Ð¡•áÁ½ÍÕÉ•]…É¹¥¹Ì¥t°(€€€€€€€€€ô¤ì(€€€€€€€€€½¹ÍÐÁÉ½‘ÕÑI½ÝÌ€ôÍÕÁÁ±¥•É%¹Ù½¥•AÉ½‘ÕÑI½ÝÍ	å%¹•Ð¡¥¹Ù½¥”¹%¤ñðmtì(€€€€€€€€€¥˜€¡ÁÉ½‘ÕÑI½ÝÌ¹±•¹Ñ ¤ì(€€€€€€€€€€€™½È€¡½¹ÍÐÁÉ½‘ÕÑI½Ü½˜ÁÉ½‘ÕÑI½ÝÌ¤ì(€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•Õ•I½ÝÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•%è¥¹Ù½¥”¹%ñð¹Õ±°°(€€€€€€€€€€€€€€€¥¹Ù½¥•9…µ”è¥¹Ù½¥”¹9…µ”ñð¹Õ±°°(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”èÁÉ½‘ÕÑI½Ü¹ÍÕÁÁ±¥•É9…µ”ñðÍÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€€€€€ÍÕÁÁ±¥•É½Õ¹Ñ%èÁÉ½‘ÕÑI½Ü¹ÍÕÁÁ±¥•É½Õ¹Ñ%ñðÍÕÁÁ±¥•É½Õ¹Ñ%°(€€€€€€€€€€€€€€€Á…åµ•¹ÑQ•É´èÁÉ½‘ÕÑI½Ü¹Á…åµ•¹ÑQ•É´ñð¹Õ±°°(€€€€€€€€€€€€€€€‘Õ•…Ñ”°(€€€€€€€€€€€€€€€ÁÉ½‘ÕÑ9…µ”èÁÉ½‘ÕÑI½Ü¹ÁÉ½‘ÕÑ9…µ”°(€€€€€€€€€€€€€€€ÅÕ…¹Ñ¥Ñå1…‰•°èÁÉ½‘ÕÑI½Ü¹ÅÕ…¹Ñ¥Ñå1…‰•°°(€€€€€€€€€€€€€€€ÁÉ½‘ÕÑEÕ…¹Ñ¥Ñå1…‰•°èmÁÉ½‘ÕÑI½Ü¹ÁÉ½‘ÕÑ9…µ”°ÁÉ½‘ÕÑI½Ü¹ÅÕ…¹Ñ¥Ñå1…‰•±t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€´€œ¤°(€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•Õ•I½ÝÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•%è¥¹Ù½¥”¹%ñð¹Õ±°°(€€€€€€€€€€€€€¥¹Ù½¥•9…µ”è¥¹Ù½¥”¹9…µ”ñð¹Õ±°°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É½Õ¹Ñ%°(€€€€€€€€€€€€€Á…åµ•¹ÑQ•É´è¹Õ±°°(€€€€€€€€€€€€€‘Õ•…Ñ”°(€€€€€€€€€€€€€ÁÉ½‘ÕÑ9…µ”è¹Õ±°°(€€€€€€€€€€€€€ÅÕ…¹Ñ¥Ñå1…‰•°è¹Õ±°°(€€€€€€€€€€€€€ÁÉ½‘ÕÑEÕ…¹Ñ¥Ñå1…‰•°è¹Õ±°°(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•Õ•I½ÝÌ¹ÁÕÍ  ¸¸¹Õ¹¥¹Ù½¥•‘áÑÉ…½ÍÑAÉ½‘ÕÑI½ÝÌ¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•ÉA…åµ•¹ÑÕ•…Ñ•Í	å½Õ¹Ð€ô¹•Ü5…À ¤ì(€€€€€€€™½È€¡½¹ÍÐ‘Õ•I½Ü½˜ÍÕÁÁ±¥•É%¹Ù½¥•Õ•I½ÝÌ¤ì(€€€€€€€€€½¹ÍÐ…½Õ¹Ñ-•ä€ô‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡‘Õ•I½Ü¹ÍÕÁÁ±¥•É½Õ¹Ñ%¤ì(€€€€€€€€€¥˜€ ……½Õ¹Ñ-•äñð€…‘Õ•I½Ü¹‘Õ•…Ñ”¤½¹Ñ¥¹Õ”ì(€€€€€€€€€½¹ÍÐ‘Õ•…Ñ•Ì€ôÍÕÁÁ±¥•ÉA…åµ•¹ÑÕ•…Ñ•Í	å½Õ¹Ð¹•Ð¡…½Õ¹Ñ-•ä¤ñð¹•ÜM•Ð ¤ì(€€€€€€€€€‘Õ•…Ñ•Ì¹…‘¡‘Õ•I½Ü¹‘Õ•…Ñ”¤ì(€€€€€€€€€ÍÕÁÁ±¥•ÉA…åµ•¹ÑÕ•…Ñ•Í	å½Õ¹Ð¹Í•Ð¡…½Õ¹Ñ-•ä°‘Õ•…Ñ•Ì¤ì(€€€€€€€ô(€€€€€€€½¹ÍÐÁ…åµ•¹ÑÕ•…Ñ•Í½É½Õ¹Ð€ô€¡…½Õ¹Ñ-•ä¤€ôøl¸¸¸¡ÍÕÁÁ±¥•ÉA…åµ•¹ÑÕ•…Ñ•Í	å½Õ¹Ð¹•Ð¡…½Õ¹Ñ-•ä¤ñðmt¥t¹Í½ÉÐ ¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±•µ•¹Ñ…±1¥¹•	Õå	å½Õ¹Ð€ô¡…ÍMÕÁÁ±¥•É%¹Ù½¥”ñðÍÕÁÁ±¥•É%¹Ù½¥•Ì¹±•¹Ñ €üÕ¹¥¹Ù½¥•‘MÕÁÁ±¥•É1¥¹•	Õå	å½Õ¹Ð€èÍÕÁÁ±¥•É1¥¹•	Õå	å½Õ¹Ðì(€€€€€€€™½È€¡½¹ÍÐÍÕÁÁ±¥•É1¥¹”½˜ÍÕÁÁ±•µ•¹Ñ…±1¥¹•	Õå	å½Õ¹Ð¹Ù…±Õ•Ì ¤¤ì(€€€€€€€€€…‘‘MÕÁÁ±¥•É¥¹…¹•	å½Õ¹Ð¡ÍÕÁÁ±¥•É1¥¹”¹…½Õ¹Ñ%°ÍÕÁÁ±¥•É1¥¹”¹ÍÕÁÁ±¥•É9…µ”°ÍÕÁÁ±¥•É1¥¹”¹…µ½Õ¹Ð°€À¤ì(€€€€€€€ô(€€€€€€€½¹ÍÐ‘¥ÍÁÕÑ•A…ÉÑåI•¥ÍÑÉä€ô‰Õ¥±‘¥ÍÁÕÑ•A…ÉÑåI•¥ÍÑÉä¡ì(€€€€€€€€€ÍÑ•´°(€€€€€€€€€±¥¹•%Ñ•µÌ°(€€€€€€€€€•áÑÉ…½ÍÑÌ°(€€€€€€€€€½É¥¥¹…±MÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥À°(€€€€€€€€€•áÑÉ…½ÍÑMÕÁÁ±¥•É¥•±°(€€€€€€€€€•áÑÉ…½ÍÑMÕÁÁ±¥•ÉI•±…Ñ¥½¹Í¡¥À°(€€€€€€€€€Í¡•µ…%ÍÍÕ•Ìèm½É¥¥¹…±MÕÁÁ±¥•É1½½­ÕÀ¹¥ÍÍÕ”°•áÑÉ…½ÍÑMÕÁÁ±¥•É1½½­ÕÀ¹¥ÍÍÕ•t°(€€€€€€€ô¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É…¹‘¥‘…Ñ•I½ÝÌ€ô‘¥ÍÁÕÑ•A…ÉÑåI•¥ÍÑÉä¹ÍÕÁÁ±¥•ÉÌ¹µ…À ¡Á…ÉÑä¤€ôøì(€€€€€€€€€½¹ÍÐ™¥¹…¹”€ôÍÕÁÁ±¥•É¥¹…¹•	å½Õ¹Ð¹•Ð¡Á…ÉÑä¹…½Õ¹Ñ-•ä¤ì(€€€€€€€€€½¹ÍÐÁ…åµ•¹ÑÕ•…Ñ•Ì€ôÁ…åµ•¹ÑÕ•…Ñ•Í½É½Õ¹Ð¡Á…ÉÑä¹…½Õ¹Ñ-•ä¤ì(€€€€€€€€€½¹ÍÐ¥¹Ù½¥•Ì€ôÍÕÁÁ±¥•É%¹Ù½¥•áÁ½ÍÕÉ•I½ÝÌ¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡¥¹Ù½¥”¹ÍÕÁÁ±¥•É½Õ¹Ñ%¤€ôôôÁ…ÉÑä¹…½Õ¹Ñ-•ä¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€¸¸¹Á…ÉÑä°(€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”èÁ…ÉÑä¹¹…µ”°(€€€€€€€€€€€ÍÑ…ÑÕÌè¹Õ±°°(€€€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è¹Õ±°°(€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ðè™¥¹…¹”ü¹ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ð€üü¹Õ±°°(€€€€€€€€€€€Á…åµ•¹ÑÕ•…Ñ”èÁ…åµ•¹ÑÕ•…Ñ•ÍlÁtñð¹Õ±°°(€€€€€€€€€€€Á…åµ•¹ÑÕ•…Ñ•Ì°(€€€€€€€€€€€Á…å…‰±•	…±…¹”è™¥¹…¹”ü¹Á…å…‰±•	…±…¹”€üü¹Õ±°°(€€€€€€€€€€€¥¹Ù½¥•Ì°(€€€€€€€€€ôì(€€€€€€€ô¤ì(€€€€€€€½¹ÍÐ‘¥ÍÁÕÑ•‘MÕÁÁ±¥•É-•åÌ€ô¹•ÜM•Ð¡‘¥ÍÁÕÑ•A…ÉÑåI•¥ÍÑÉä¹ÍÕÁÁ±¥•ÉÌ¹µ…À ¡Á…ÉÑä¤€ôøÁ…ÉÑä¹…½Õ¹Ñ-•ä¤¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É¥¹…¹•=¹±åI½ÝÌ€ôl¸¸¹ÍÕÁÁ±¥•É¥¹…¹•	å½Õ¹Ð¹Ù…±Õ•Ì ¥t(€€€€€€€€€€¹™¥±Ñ•È ¡™¥¹…¹”¤€ôø€…‘¥ÍÁÕÑ•‘MÕÁÁ±¥•É-•åÌ¹¡…Ì¡™¥¹…¹”¹…½Õ¹Ñ-•ä¤¤(€€€€€€€€€€¹µ…À ¡™¥¹…¹”¤€ôøì(€€€€€€€€€€€½¹ÍÐÁ…åµ•¹ÑÕ•…Ñ•Ì€ôÁ…åµ•¹ÑÕ•…Ñ•Í½É½Õ¹Ð¡™¥¹…¹”¹…½Õ¹Ñ-•ä¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€…½Õ¹Ñ%è™¥¹…¹”¹…½Õ¹Ñ%°(€€€€€€€€€€€€€…½Õ¹Ñ-•äè™¥¹…¹”¹…½Õ¹Ñ-•ä°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É9…µ”è™¥¹…¹”¹ÍÕÁÁ±¥•É9…µ”°(€€€€€€€€€€€€€ÍÑ…ÑÕÌè¹Õ±°°(€€€€€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ðè™¥¹…¹”¹ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ð°(€€€€€€€€€€€€€Á…åµ•¹ÑÕ•…Ñ”èÁ…åµ•¹ÑÕ•…Ñ•ÍlÁtñð¹Õ±°°(€€€€€€€€€€€€€Á…åµ•¹ÑÕ•…Ñ•Ì°(€€€€€€€€€€€€€Á…å…‰±•	…±…¹”è™¥¹…¹”¹Á…å…‰±•	…±…¹”°(€€€€€€€€€€€€€¥¹Ù½¥•ÌèÍÕÁÁ±¥•É%¹Ù½¥•áÁ½ÍÕÉ•I½ÝÌ¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡¥¹Ù½¥”¹ÍÕÁÁ±¥•É½Õ¹Ñ%¤€ôôô™¥¹…¹”¹…½Õ¹Ñ-•ä¤°(€€€€€€€€€€€ôì(€€€€€€€€€ô¤ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É¥¹…¹•I½ÝÍ±°€ôl¸¸¹ÍÕÁÁ±¥•É…¹‘¥‘…Ñ•I½ÝÌ°€¸¸¹ÍÕÁÁ±¥•É¥¹…¹•=¹±åI½ÝÍtì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•É¥¹…¹•I½ÝÌ€ôÍÕÁÁ±¥•É…¹‘¥‘…Ñ•I½ÝÌ¹±•¹Ñ €üÍÕÁÁ±¥•É…¹‘¥‘…Ñ•I½ÝÌ€èÍÕÁÁ±¥•É¥¹…¹•=¹±åI½ÝÌì(€€€€€€€½¹ÍÐ‰Õå•É¥¹…¹•I½Ü€ôì(€€€€€€€€€‰Õå•É9…µ”è‘¥ÍÁÕÑ•A…ÉÑåI•¥ÍÑÉä¹‰Õå•Èü¹¹…µ”ñð€¡ÍÑ•´¹½Õ¹Ñ}}Èü¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œ€ôôôÑÉÕ”€ü€½Õ¹ÐÕ¹…Ù…¥±…‰±”œ€èÍÑ•´¹	Õå•É}9…µ•}}ŒñðÍÑ•µl½Õ¹Ñ}}Ètü¹9…µ”ñðÍÑ•´¹	Õå•É}}Œñð¹Õ±°¤°(€€€€€€€€€‰Õå•É%¹Ù½¥•µ½Õ¹Ðè‰Õå•É%¹Ù½¥•µ½Õ¹Ð€üü¹Õ±°°(€€€€€€€€€Á…åµ•¹ÑÕ•…Ñ”èÍÑ•´¹%¹Ù½¥•}Õ•}…Ñ•}}ŒñðÍÑ•´¹Õ•}…Ñ•}}ŒñðÍÑ•´¹	Õå•É}A…å}Q•Éµ}…Ñ•}}Œñð¹Õ±°°(€€€€€€€€€É••¥Ù…‰±•	…±…¹”èÍÑ•´¹I••¥Ù…‰±•}	…±…¹•}}Œ€üü¹Õ±°°(€€€€€€€€€‘¥ÍÁÕÑ•I½ÝÌèmt°(€€€€€€€€€ÍÑ…ÑÕÌè¹Õ±°°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è¹Õ±°°(€€€€€€€ôì((€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€¸¸¹ÍÑ•´°(€€€€€€€€€€¸¸¸¡ÍÑ•´¹½Õ¹Ñ}}Èü¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œ€ôôôÑÉÕ”€üì½Õ¹Ñ}}Èè¹Õ±°°½Õ¹Ñ}}Œè¹Õ±°ô€èíô¤°(€€€€€€€€€Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œè‰Õå•É%¹Ù½¥•µ½Õ¹Ð€üüÍÑ•´¹Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œ€üü¹Õ±°°(€€€€€€€€€Q½Ñ…±}%¹Ù½¥•‘}µ½Õ¹Ñ}É½µ}MÕÁÁ±¥•ÉÍ}}Œè…±Õ±…Ñ•‘MÕÁÁ±¥•É%¹Ù½¥”ñðÍÑ•´¹Q½Ñ…±}%¹Ù½¥•‘}µ½Õ¹Ñ}É½µ}MÕÁÁ±¥•ÉÍ}}Œñð¹Õ±°°(€€€€€€€€€}MÕÁÁ±¥•É}9…µ•Ìèl¸¸¹ÍÕÁÁ±¥•É9…µ•Ít¹Í½ÉÐ ¤¹©½¥¸ œ°€œ¤ñð¹Õ±°°(€€€€€€€€€}AÉ½‘ÕÑ}9…µ•Ìèl¸¸¹ÁÉ½‘ÕÑ9…µ•Ít¹Í½ÉÐ ¤¹©½¥¸ œ°€œ¤ñð¹Õ±°°(€€€€€€€€€}MÕÁÁ±¥•É}AÉ½‘ÕÑ}A…¥ÉÌèÍÕÁÁ±¥•ÉAÉ½‘ÕÑA…¥ÉÌ°(€€€€€€€€€}	Õå•É}¥ÍÁÕÑ•Ìèmt°(€€€€€€€€€}	Õå•É}¥ÍÁÕÑ•}I½ÝÌèmt°(€€€€€€€€€}	Õå•É}¥¹…¹•}I½Üè‰Õå•É¥¹…¹•I½Ü°(€€€€€€€€€}MÕÁÁ±¥•É}¥ÍÁÕÑ•Ìèmt°(€€€€€€€€€}MÕÁÁ±¥•É}¥ÍÁÕÑ•}I½ÝÌèÍÕÁÁ±¥•É¥¹…¹•I½ÝÌ°(€€€€€€€€€}MÕÁÁ±¥•É}¥¹…¹•}I½ÝÍ}±°èÍÕÁÁ±¥•É¥¹…¹•I½ÝÍ±°°(€€€€€€€€€}¥ÍÁÕÑ•}A…ÉÑ¥•Ìè‘¥ÍÁÕÑ•A…ÉÑåI•¥ÍÑÉä°(€€€€€€€€€}	Õå•É}%¹Ù½¥•}Õ•}…Ñ”èÍÑ•´¹%¹Ù½¥•}Õ•}…Ñ•}}ŒñðÍÑ•´¹Õ•}…Ñ•}}ŒñðÍÑ•´¹	Õå•É}A…å}Q•Éµ}…Ñ•}}Œñð¹Õ±°°(€€€€€€€€€}MÕÁÁ±¥•É}%¹Ù½¥•}Õ•}I½ÝÌèÍÕÁÁ±¥•É%¹Ù½¥•Õ•I½ÝÌ°(€€€€€€€€€}MÕÁÁ±¥•É}%¹Ù½¥•}áÁ½ÍÕÉ•}I½ÝÌèÍÕÁÁ±¥•É%¹Ù½¥•áÁ½ÍÕÉ•I½ÝÌ°(€€€€€€€€€}MÕÁÁ±¥•É}M•ÑÑ±•µ•¹Ñ}M¡•µ„èÍÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„°(€€€€€€€€€}MÑ•µ}	…Í•}A¹°èÍÑ•µ	…Í•A¹°°(€€€€€€€€€}	Õå•É}¥ÍÁÕÑ•}1…‰•°è¹Õ±°°(€€€€€€€€€}MÕÁÁ±¥•É}¥ÍÁÕÑ•}1…‰•°è¹Õ±°°(€€€€€€€€€}MÕÁÁ±¥•É}%¹Ù½¥•}MÁ±¥Ñ}1…‰•°èÍÕÁÁ±¥•É¥¹…¹•I½ÝÌ¹µ…À ¡‘¥ÍÁÕÑ”¤€ôø‘¥ÍÁÕÑ”¹ÍÕÁÁ±¥•É%¹Ù½¥•µ½Õ¹Ð¤¹©½¥¸ q¸œ¤ñð¹Õ±°°(€€€€€€€€€}A…å…‰±•}	…±…¹•}MÁ±¥Ñ}1…‰•°èÍÕÁÁ±¥•É¥¹…¹•I½ÝÌ¹µ…À ¡‘¥ÍÁÕÑ”¤€ôø‘¥ÍÁÕÑ”¹Á…å…‰±•	…±…¹”¤¹©½¥¸ q¸œ¤ñð¹Õ±°°(€€€€€€€€€}A…å…‰±•}	…±…¹”èÁ…å…‰±•	…±…¹”°(€€€€€€€€€}¥ÍÁ±…å}9…µ”è™½Éµ…ÑMÑ•µ9…µ”¡ÍÑ•´¤°(€€€€€€€€€}	Õå•É}9…µ”èÍÑ•´¹½Õ¹Ñ}}Èü¹%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œ€ôôôÑÉÕ”€ü€½Õ¹ÐÕ¹…Ù…¥±…‰±”œ€èÍÑ•´¹	Õå•É}9…µ•}}ŒñðÍÑ•µl½Õ¹Ñ}}Ètü¹9…µ”ñðÍÑ•´¹	Õå•É}}Œñð¹Õ±°°(€€€€€€€€€}™™•Ñ¥Ù•}…Ñ”èÍÑ•´¹•±¥Ù•Éå}…Ñ•}}ŒñðÍÑ•´¹áÁ•Ñ•‘}•±¥Ù•Éå}…Ñ•}}Œñð¹Õ±°°(€€€€€€€ôì(€€€€€ô¤°(€ôì)ô()™Õ¹Ñ¥½¸Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¡É½Ü¤ì(€¥˜€ …É½Ü¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸ì(€€€¥èÉ½Ü¹¥°(€€€…Í•%èÉ½Ü¹…Í•}¥ñðÉ½Ü¹…Í•%°(€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ}¥ñðÉ½Ü¹ÍÑ•µ%°(€€€…½Õ¹Ñ%èÉ½Ü¹…½Õ¹Ñ}¥ñðÉ½Ü¹…½Õ¹Ñ%°(€€€…½Õ¹Ñ-•äèÉ½Ü¹…½Õ¹Ñ}­•äñðÉ½Ü¹…½Õ¹Ñ-•ä°(€€€¹…µ”èÉ½Ü¹…½Õ¹Ñ}¹…µ”ñðÉ½Ü¹¹…µ”ñðÉ½Ü¹…½Õ¹Ñ}¥ñðÉ½Ü¹…½Õ¹Ñ%°(€€€É½±•ÌèÉÉ…ä¹¥ÍÉÉ…ä¡É½Ü¹É½±•Ì¤€üÉ½Ü¹É½±•Ì€èmt°(€€€Í½ÕÉ•QåÁ•ÌèÉÉ…ä¹¥ÍÉÉ…ä¡É½Ü¹Í½ÕÉ•}ÑåÁ•Ì¤€üÉ½Ü¹Í½ÕÉ•}ÑåÁ•Ì€èÉ½Ü¹Í½ÕÉ•QåÁ•Ìñðmt°(€€€Í½ÕÉ•I•½É‘%‘ÌèÉÉ…ä¹¥ÍÉÉ…ä¡É½Ü¹Í½ÕÉ•}É•½É‘}¥‘Ì¤€üÉ½Ü¹Í½ÕÉ•}É•½É‘}¥‘Ì€èÉ½Ü¹Í½ÕÉ•I•½É‘%‘Ìñðmt°(€€€Á…åµ•¹ÑQ•ÉµÌèÉÉ…ä¹¥ÍÉÉ…ä¡É½Ü¹Á…åµ•¹Ñ}Ñ•ÉµÌ¤€üÉ½Ü¹Á…åµ•¹Ñ}Ñ•ÉµÌ€èÉ½Ü¹Á…åµ•¹ÑQ•ÉµÌñðmt°(€€€ÁÉ½‘ÕÑÌèÉÉ…ä¹¥ÍÉÉ…ä¡É½Ü¹ÁÉ½‘ÕÑÌ¤€üÉ½Ü¹ÁÉ½‘ÕÑÌ€èmt°(€€€…¹•±±•‘M½ÕÉ•=¹±äèÉ½Ü¹…¹•±±•‘}Í½ÕÉ•}½¹±ä€ôôôÑÉÕ”ñðÉ½Ü¹…¹•±±•‘M½ÕÉ•=¹±ä€ôôôÑÉÕ”°(€€€É•…Ñ•‘ÐèÉ½Ü¹É•…Ñ•‘}…ÐñðÉ½Ü¹É•…Ñ•‘Ðñð¹Õ±°°(€€€ÕÁ‘…Ñ•‘ÐèÉ½Ü¹ÕÁ‘…Ñ•‘}…ÐñðÉ½Ü¹ÕÁ‘…Ñ•‘Ðñð¹Õ±°°(€ôì)ô()™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•I•¥ÍÑÉå]¥Ñ¡M•±•Ñ¥½¸¡É•¥ÍÑÉä°Á…ÉÑåI½ÝÌ€ômt¤ì(€½¹ÍÐÍ•±•Ñ•€ômtì(€½¹ÍÐ¥ÍÍÕ•Ì€ôl¸¸¸¡É•¥ÍÑÉäü¹¥ÍÍÕ•Ìñðmt¥tì(€½¹ÍÐ…¹‘¥‘…Ñ•	å-•ä€ô¹•Ü5…À ¡É•¥ÍÑÉäü¹…¹‘¥‘…Ñ•Ìñðmt¤¹µ…À ¡…¹‘¥‘…Ñ”¤€ôøm…¹‘¥‘…Ñ”¹…½Õ¹Ñ-•ä°…¹‘¥‘…Ñ•t¤¤ì(€™½È€¡½¹ÍÐÉ½Ü½˜Á…ÉÑåI½ÝÌ¤ì(€€€½¹ÍÐÍÑ½É•€ôÍ•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¡É½Ü¤ì(€€€½¹ÍÐ…¹‘¥‘…Ñ”€ô…¹‘¥‘…Ñ•	å-•ä¹•Ð¡ÍÑ½É•¹…½Õ¹Ñ-•ä¤ì(€€€¥˜€ ……¹‘¥‘…Ñ”¤ì(€€€€€¥ÍÍÕ•Ì¹ÁÕÍ ¡ì(€€€€€€€½‘”è€Í•±•Ñ•‘}…½Õ¹Ñ}ÍÑ…±”œ°(€€€€€€€µ•ÍÍ…”è€‘íÍÑ½É•¹¹…µ•ô¥Ì¹¼±½¹•ÈÑ¡”‰Õå•È½È„ÍÕÁÁ±¥•È½¸Ñ¡¥ÌMQ4¹€°(€€€€€€€É•½É‘%‘ÌèÍÑ½É•¹Í½ÕÉ•I•½É‘%‘Ì°(€€€€€€€‘•Ñ…¥±Ìèì…½Õ¹Ñ%èÍÑ½É•¹…½Õ¹Ñ%ô°(€€€€€ô¤ì(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€Í•±•Ñ•¹ÁÕÍ ¡ì(€€€€€€¸¸¹…¹‘¥‘…Ñ”°(€€€€€¥èÍÑ½É•¹¥°(€€€€€…Í•%èÍÑ½É•¹…Í•%°(€€€€€Í•±•Ñ•èÑÉÕ”°(€€€ô¤ì(€ô(€½¹ÍÐ…¹‘¥‘…Ñ•M¡•µ…Y…±¥€ôÉ•¥ÍÑÉäü¹…¹‘¥‘…Ñ•M¡•µ…Y…±¥€ôôôÑÉÕ”ì(€½¹ÍÐÍ•±•Ñ¥½¹Y…±¥€ôÍ•±•Ñ•¹±•¹Ñ €ø€À€˜˜€…¥ÍÍÕ•Ì¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹½‘”€ôôô€Í•±•Ñ•‘}…½Õ¹Ñ}ÍÑ…±”œ¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹É•¥ÍÑÉä°(€€€…¹‘¥‘…Ñ•M¡•µ…Y…±¥°(€€€Í•±•Ñ¥½¹Y…±¥°(€€€Ù…±¥è…¹‘¥‘…Ñ•M¡•µ…Y…±¥€˜˜Í•±•Ñ¥½¹Y…±¥°(€€€Í•±•Ñ•°(€€€¥ÍÍÕ•Ì°(€ôì)ô()™Õ¹Ñ¥½¸…ÍÍ•ÉÑY…±¥‘¥ÍÁÕÑ•A…ÉÑ¥•Ì¡ÍÑ•´°Á…ÉÑåI½ÝÌ€ômt¤ì(€½¹ÍÐÉ•¥ÍÑÉä€ô‘¥ÍÁÕÑ•I•¥ÍÑÉå]¥Ñ¡M•±•Ñ¥½¸¡ÍÑ•´ü¹}¥ÍÁÕÑ•}A…ÉÑ¥•Ì°Á…ÉÑåI½ÝÌ¤ì(€¥˜€ …ÍÑ•´ü¹}¥ÍÁÕÑ•}A…ÉÑ¥•Ì¤Ñ¡É½Ü…ÁÁÉÉ½È M…±•Í™½É”‘¥ÍÁÕÑ”Á…ÉÑä…¹‘¥‘…Ñ•Ì½Õ±¹½Ð‰”É•Í½±Ù•¸œ°€ÔÀÈ¤ì(€¥˜€¡É•¥ÍÑÉä¹Ù…±¥¤É•ÑÕÉ¸É•¥ÍÑÉäì(€½¹ÍÐµ•ÍÍ…•Ì€ôÉ•¥ÍÑÉä¹¥ÍÍÕ•Ì¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹µ•ÍÍ…”¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€¥˜€ …É•¥ÍÑÉä¹Í•±•Ñ¥½¹Y…±¥€˜˜€…µ•ÍÍ…•Ì¹±•¹Ñ ¤µ•ÍÍ…•Ì¹ÁÕÍ  M•±•Ð…Ð±•…ÍÐ½¹”‘¥ÍÁÕÑ•½Õ¹Ð¸œ¤ì(€Ñ¡É½Ü…ÁÁÉÉ½È¡½ÉÉ•ÐÑ¡”‘¥ÍÁÕÑ”Á…ÉÑäÍ•±•Ñ¥½¸‰•™½É”½¹Ñ¥¹Õ¥¹œè€‘íµ•ÍÍ…•Ì¹©½¥¸ œ€œ¥õ€°€ÐÀÀ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡ÍÑ•µ%°…•ÍÍ½¹Ñ•áÐ¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÍ…±•Í™½É•¥ÍÁÕÑ•MÑ•µÌ¡ìÍÑ•µ%°±¥µ¥Ðè€ÄÀÀô°¹Õ±°°…•ÍÍ½¹Ñ•áÐ¤ì(€½¹ÍÐÍÑ•´€ô€¡É•ÍÕ±Ð¹É½ÝÌñðmt¤¹™¥¹ ¡É½Ü¤€ôø‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡É½Ü¹%¤€ôôô‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡ÍÑ•µ%¤¤ì(€¥˜€ …ÍÑ•´¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”‘¥ÍÁÕÑ•ÍÑ•´½Õ±¹½Ð‰”™½Õ¹¥¸Ñ¡”ÕÉÉ•¹ÐM…±•Í™½É”‘¥ÍÁÕÑ”ÅÕ•Õ”¸œ°€ÐÀÐ¤ì(€É•ÑÕÉ¸ÍÑ•´ì)ô()™Õ¹Ñ¥½¸…¹½¹¥…±¥ÍÁÕÑ•Ñ¥½¹Q…É•Ð¡¥¹ÁÕÐ°Á…ÉÑåM¥‘”°É•¥ÍÑÉä¤ì(€½¹ÍÐ…½Õ¹Ñ%€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹Á…ÉÑå½Õ¹Ñ%ñð¥¹ÁÕÐ¹Á…ÉÑå}…½Õ¹Ñ}¥ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ ……½Õ¹Ñ%¤Ñ¡É½Ü…ÁÁÉÉ½È M…±•Í™½É”Á…ÉÑä½Õ¹Ð%¥ÌÉ•ÅÕ¥É•™½È•Ù•Éä‘¥ÍÁÕÑ”…Ñ¥½¸¸œ°€ÐÀÀ¤ì(€½¹ÍÐ…¹‘¥‘…Ñ”€ô™¥¹‘¥ÍÁÕÑ•A…ÉÑä¡É•¥ÍÑÉä°Á…ÉÑåM¥‘”°…½Õ¹Ñ%¤ì(€½¹ÍÐÁ…ÉÑä€ô€¡É•¥ÍÑÉäü¹Í•±•Ñ•ñðmt¤¹™¥¹ ¡Í•±•Ñ•¤€ôøÍ•±•Ñ•¹…½Õ¹Ñ-•ä€ôôô…¹‘¥‘…Ñ”ü¹…½Õ¹Ñ-•ä¤ì(€¥˜€ ……¹‘¥‘…Ñ”ñð€…Á…ÉÑä¤Ñ¡É½Ü…ÁÁÉÉ½È¡Q¡”Í•±•Ñ•€‘íÁ…ÉÑåM¥‘•ô½Õ¹Ð¥Ì¹½ÐÍ•±•Ñ•™½ÈÑ¡¥Ì‘¥ÍÁÕÑ”¸I•™É•Í …¹Í•±•ÐÑ¡”Á…ÉÑä……¥¸¹€°€ÐÀÀ¤ì(€É•ÑÕÉ¸Á…ÉÑäì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•¥ÍÁÕÑ•	•Ñ…MÑ…ÑÕÌ¡Ù…±Õ”°…±±½Ý•°™…±±‰…¬¤ì(€½¹ÍÐÉ…Ü€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€É•ÑÕÉ¸…±±½Ý•¹¥¹±Õ‘•Ì¡É…Ü¤€üÉ…Ü€è™…±±‰…¬ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½Ý…Á…‰¥±¥Ñ¥•Ì¡±¥•¹Ð°ÁÉ½™¥±”€ôíô¤ì(€½¹ÍÐm¥ÍÁÁÉ½Ù•È°¥Í½Õ¹Ñ¥¹t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡mÕÍ•É!…Í…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…ÁÁÉ½Ù”œ¤°ÕÍ•É!…Í…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…½Õ¹Ðœ¥t¤ì(€½¹ÍÐ…¹•ÁÑáÑ•É¹…±±½ÍÕÉ”€ôÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”€ôôô€…‘µ¥¹¥ÍÑÉ…Ñ½Èœ(€€€ñð€¡ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”€ôôô€•¹•É…±}µ…¹…•Èœ€˜˜€¡…Ý…¥Ð±½…‘Ñ¥Ù••¹•É…±5…¹…•È¡±¥•¹Ð¤¤¹¥€ôôôÁÉ½™¥±”¹¥¤ì(€É•ÑÕÉ¸ì(€€€É½±”èÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”ñð€ÕÍ•Èœ°(€€€…¹AÉ•Á…É”èÑÉÕ”°(€€€…¹ÁÁÉ½Ù”è¥ÍÁÁÉ½Ù•È°(€€€…¹½Õ¹Ðè¥Í½Õ¹Ñ¥¹œ°(€€€…¹±½Í”è¥Í½Õ¹Ñ¥¹œ°(€€€…¹•ÁÑáÑ•É¹…±±½ÍÕÉ”°(€€€…¹Y¥•Ý±±IÕ±•ÌèÑÉÕ”°(€ôì)ô()™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•	•Ñ……Í•É½µMÑ•´¡ÍÑ•´€ôíô¤ì(€É•ÑÕÉ¸ì(€€€ÍÑ•µ}¥èÍÑ•´¹%°(€€€ÍÑ•µ}¹…µ”èÍÑ•´¹}¥ÍÁ±…å}9…µ”ñðÍÑ•´¹9…µ”ñðÍÑ•´¹-•åMÑ•µ}}ŒñðÍÑ•´¹%°(€€€‰Õå•É}¹…µ”èÍÑ•´¹}	Õå•É}9…µ”ñðÍÑ•´¹	Õå•É}9…µ•}}Œñð¹Õ±°°(€€€ÍÕÁÁ±¥•É}¹…µ•ÌèÍÑ•´¹}MÕÁÁ±¥•É}9…µ•Ìñð¹Õ±°°(€€€ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌèÍÑ•´¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œñð¹Õ±°°(€ôì)ô()™Õ¹Ñ¥½¸±•…å±½Í•‘¥ÍÁÕÑ•…Í”¡ÍÑ•´€ôíô¤ì(€½¹ÍÐÍ…±•Í™½É•MÑ…ÑÕÌ€ôMÑÉ¥¹œ¡ÍÑ•´¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …¥ÍM…±•Í™½É•¥ÍÁÕÑ•±½Í•¡Í…±•Í™½É•MÑ…ÑÕÌ¤¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸ì(€€€¥è¹Õ±°°(€€€ÍÑ•µ%èÍÑ•´¹%°(€€€ÍÑ•µ9…µ”èÍÑ•´¹}¥ÍÁ±…å}9…µ”ñðÍÑ•´¹9…µ”ñðÍÑ•´¹-•åMÑ•µ}}ŒñðÍÑ•´¹%°(€€€‰Õå•É9…µ”èÍÑ•´¹}	Õå•É}9…µ”ñðÍÑ•´¹	Õå•É}9…µ•}}Œñð€œœ°(€€€ÍÕÁÁ±¥•É9…µ•ÌèÍÑ•´¹}MÕÁÁ±¥•É}9…µ•Ìñð€œœ°(€€€ÕÉÉ•¹ÑM…±•Í™½É•MÑ…ÑÕÌèÍ…±•Í™½É•MÑ…ÑÕÌ°(€€€Ý½É­™±½ÝMÑ…ÑÕÌè€±½Í•œ°(€€€…ÁÁÉ½Ù…±MÑ…ÑÕÌè€ÁÁÉ½Ù•œ°(€€€±…Ñ•ÍÑ9½Ñ”è€±½Í•¥¸M…±•Í™½É”‰•™½É”=LÝ½É­™±½ÜÑÉ…­¥¹œ¸œ°(€€€Í•ÑÑ±•µ•¹Ñ¥¹…¹¥…±Ìèíô°(€€€Í•ÑÑ±•µ•¹ÑA¹°è€À°(€€€Í…±•Í™½É•]É¥Ñ•‰…­MÑ…ÑÕÌè€±•…äœ°(€€€±•…åI•…‘=¹±äèÑÉÕ”°(€ôì)ô()™Õ¹Ñ¥½¸Í•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡É½Ü¤ì(€¥˜€ …É½Ü¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸ì(€€€¥èÉ½Ü¹¥°(€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ}¥°(€€€ÍÑ•µ9…µ”èÉ½Ü¹ÍÑ•µ}¹…µ”ñð€œœ°(€€€‰Õå•É9…µ”èÉ½Ü¹‰Õå•É}¹…µ”ñð€œœ°(€€€ÍÕÁÁ±¥•É9…µ•ÌèÉ½Ü¹ÍÕÁÁ±¥•É}¹…µ•Ìñð€œœ°(€€€ÕÉÉ•¹ÑM…±•Í™½É•MÑ…ÑÕÌèÉ½Ü¹ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌñð€œœ°(€€€Ý½É­™±½ÝMÑ…ÑÕÌèÉ½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌñð€É…™Ðœ°(€€€…ÁÁÉ½Ù…±MÑ…ÑÕÌèÉ½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌñð€É…™Ðœ°(€€€±…Ñ•ÍÑ9½Ñ”èÉ½Ü¹±…Ñ•ÍÑ}¹½Ñ”ñð€œœ°(€€€ÍÕ‰µ¥ÑÑ•‘	äèÉ½Ü¹ÍÕ‰µ¥ÑÑ•‘}‰äñð¹Õ±°°(€€€ÍÕ‰µ¥ÑÑ•‘	åµ…¥°èÉ½Ü¹ÍÕ‰µ¥ÑÑ•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€ÍÕ‰µ¥ÑÑ•‘ÐèÉ½Ü¹ÍÕ‰µ¥ÑÑ•‘}…Ðñð¹Õ±°°(€€€…ÁÁÉ½Ù•‘	äèÉ½Ü¹…ÁÁÉ½Ù•‘}‰äñð¹Õ±°°(€€€…ÁÁÉ½Ù•‘	åµ…¥°èÉ½Ü¹…ÁÁÉ½Ù•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€…ÁÁÉ½Ù•‘ÐèÉ½Ü¹…ÁÁÉ½Ù•‘}…Ðñð¹Õ±°°(€€€É•©•Ñ•‘	äèÉ½Ü¹É•©•Ñ•‘}‰äñð¹Õ±°°(€€€É•©•Ñ•‘	åµ…¥°èÉ½Ü¹É•©•Ñ•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€É•©•Ñ•‘ÐèÉ½Ü¹É•©•Ñ•‘}…Ðñð¹Õ±°°(€€€É•©•Ñ¥½¹I•…Í½¸èÉ½Ü¹É•©•Ñ¥½¹}É•…Í½¸ñð¹Õ±°°(€€€±½Í•‘	äèÉ½Ü¹±½Í•‘}‰äñð¹Õ±°°(€€€±½Í•‘	åµ…¥°èÉ½Ü¹±½Í•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€±½Í•‘ÐèÉ½Ü¹±½Í•‘}…Ðñð¹Õ±°°(€€€Í•ÑÑ±•µ•¹Ñ¥¹…¹¥…±ÌèÉ½Ü¹Í•ÑÑ±•µ•¹Ñ}™¥¹…¹¥…±Ìñðíô°(€€€Í•ÑÑ±•µ•¹ÑA¹°è9Õµ‰•È¡É½Ü¹Í•ÑÑ±•µ•¹Ñ}Á¹°ñð€À¤°(€€€Í…±•Í™½É•]É¥Ñ•‰…­MÑ…ÑÕÌèÉ½Ü¹Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}ÍÑ…ÑÕÌñð€¹½Ñ}ÍÑ…ÉÑ•œ°(€€€Í…±•Í™½É•]É¥Ñ•‰…­ÉÉ½ÈèÉ½Ü¹Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}•ÉÉ½Èñð¹Õ±°°(€€€•áÑ•É¹…±±½ÍÕÉ••Ñ•Ñ•‘ÐèÉ½Ü¹•áÑ•É¹…±}±½ÍÕÉ•}‘•Ñ•Ñ•‘}…Ðñð¹Õ±°°(€€€•áÑ•É¹…±±½ÍÕÉ•M…±•Í™½É•MÑ…ÑÕÌèÉ½Ü¹•áÑ•É¹…±}±½ÍÕÉ•}Í…±•Í™½É•}ÍÑ…ÑÕÌñð¹Õ±°°(€€€•áÑ•É¹…±±½ÍÕÉ•M…±•Í™½É•5½‘¥™¥•‘ÐèÉ½Ü¹•áÑ•É¹…±}±½ÍÕÉ•}Í…±•Í™½É•}µ½‘¥™¥•‘}…Ðñð¹Õ±°°(€€€•áÑ•É¹…±±½ÍÕÉ••ÁÑ•‘ÐèÉ½Ü¹•áÑ•É¹…±}±½ÍÕÉ•}…•ÁÑ•‘}…Ðñð¹Õ±°°(€€€•áÑ•É¹…±±½ÍÕÉ••ÁÑ•‘	äèÉ½Ü¹•áÑ•É¹…±}±½ÍÕÉ•}…•ÁÑ•‘}‰äñð¹Õ±°°(€€€•áÑ•É¹…±±½ÍÕÉ••ÁÑ•‘	åµ…¥°èÉ½Ü¹•áÑ•É¹…±}±½ÍÕÉ•}…•ÁÑ•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€•áÑ•É¹…±±½ÍÕÉ••ÁÑ…¹•I•…Í½¸èÉ½Ü¹•áÑ•É¹…±}±½ÍÕÉ•}…•ÁÑ…¹•}É•…Í½¸ñð¹Õ±°°(€€€É•…Ñ•‘ÐèÉ½Ü¹É•…Ñ•‘}…Ðñð¹Õ±°°(€€€ÕÁ‘…Ñ•‘ÐèÉ½Ü¹ÕÁ‘…Ñ•‘}…Ðñð¹Õ±°°(€ôì)ô()™Õ¹Ñ¥½¸Í•É¥…±¥é•¥ÍÁÕÑ•MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¸¡É½Ü¤ì(€¥˜€ …É½Ü¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸ì(€€€¥èÉ½Ü¹¥°(€€€…Í•%èÉ½Ü¹…Í•}¥°(€€€…Ñ¥½¹%èÉ½Ü¹…Ñ¥½¹}¥°(€€€Á…ÉÑå%èÉ½Ü¹Á…ÉÑå}¥°(€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ}¥°(€€€¥¹ÍÑÉÕÑ¥½¹QåÁ”èÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}ÑåÁ”°(€€€¥¹ÍÑÉÕÑ¥½¹1…‰•°èÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}ÑåÁ”€ôôô€Ý¥Ñ¡¡½±‘}Õ¹Á…¥œ€ü€¼¹½ÐÁ…äœ€è€•Ð‰…¬Á…¥…µ½Õ¹Ðœ°(€€€É•½Ù•Éå5•Ñ¡½èÉ½Ü¹É•½Ù•Éå}µ•Ñ¡½ñð¹Õ±°°(€€€Í½ÕÉ•MÕÁÁ±¥•É%¹Ù½¥•%èÉ½Ü¹Í½ÕÉ•}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥°(€€€Í½ÕÉ•MÕÁÁ±¥•É%¹Ù½¥•9…µ”èÉ½Ü¹Í½ÕÉ•}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¹…µ”ñð€œœ°(€€€Í½ÕÉ•MÑ•µ%èÉ½Ü¹Í½ÕÉ•}ÍÑ•µ}¥ñðÉ½Ü¹ÍÑ•µ}¥°(€€€Ñ…É•ÑMÕÁÁ±¥•É%¹Ù½¥•%èÉ½Ü¹Ñ…É•Ñ}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥ñð¹Õ±°°(€€€Ñ…É•ÑMÕÁÁ±¥•É%¹Ù½¥•9…µ”èÉ½Ü¹Ñ…É•Ñ}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¹…µ”ñð€œœ°(€€€Ñ…É•ÑMÑ•µ%èÉ½Ü¹Ñ…É•Ñ}ÍÑ•µ}¥ñð¹Õ±°°(€€€ÕÉÉ•¹å%Í½½‘”èÉ½Ü¹ÕÉÉ•¹å}¥Í½}½‘”ñð€UMœ°(€€€Á±…¹¹•‘µ½Õ¹Ðè9Õµ‰•È¡É½Ü¹Á±…¹¹•‘}…µ½Õ¹Ðñð€À¤°(€€€…±±½…Ñ•‘µ½Õ¹Ðè9Õµ‰•È¡É½Ü¹…±±½…Ñ•‘}…µ½Õ¹Ðñð€À¤°(€€€Í½ÕÉ•%¹Ù½¥•µ½Õ¹ÑM¹…ÁÍ¡½Ðè9Õµ‰•È¡É½Ü¹Í½ÕÉ•}¥¹Ù½¥•}…µ½Õ¹Ñ}Í¹…ÁÍ¡½Ðñð€À¤°(€€€Í½ÕÉ•A…å…‰±•	…±…¹•M¹…ÁÍ¡½Ðè9Õµ‰•È¡É½Ü¹Í½ÕÉ•}Á…å…‰±•}‰…±…¹•}Í¹…ÁÍ¡½Ðñð€À¤°(€€€Í½ÕÉ•A…¥‘µ½Õ¹ÑM¹…ÁÍ¡½Ðè9Õµ‰•È¡É½Ü¹Í½ÕÉ•}Á…¥‘}…µ½Õ¹Ñ}Í¹…ÁÍ¡½Ðñð€À¤°(€€€Ñ…É•Ñ%¹Ù½¥•µ½Õ¹ÑM¹…ÁÍ¡½ÐèÉ½Ü¹Ñ…É•Ñ}¥¹Ù½¥•}…µ½Õ¹Ñ}Í¹…ÁÍ¡½Ð€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹Ñ…É•Ñ}¥¹Ù½¥•}…µ½Õ¹Ñ}Í¹…ÁÍ¡½Ð¤°(€€€Ñ…É•ÑA…å…‰±•µ½Õ¹ÑM¹…ÁÍ¡½ÐèÉ½Ü¹Ñ…É•Ñ}Á…å…‰±•}…µ½Õ¹Ñ}Í¹…ÁÍ¡½Ð€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹Ñ…É•Ñ}Á…å…‰±•}…µ½Õ¹Ñ}Í¹…ÁÍ¡½Ð¤°(€€€Í½ÕÉ•%¹Ù½¥•M¹…ÁÍ¡½ÐèÉ½Ü¹Í½ÕÉ•}¥¹Ù½¥•}Í¹…ÁÍ¡½Ðñðíô°(€€€Í½ÕÉ•MÑ•µM¹…ÁÍ¡½ÐèÉ½Ü¹Í½ÕÉ•}ÍÑ•µ}Í¹…ÁÍ¡½Ðñðíô°(€€€Ñ…É•Ñ%¹Ù½¥•M¹…ÁÍ¡½ÐèÉ½Ü¹Ñ…É•Ñ}¥¹Ù½¥•}Í¹…ÁÍ¡½Ðñðíô°(€€€Ñ…É•ÑMÑ•µM¹…ÁÍ¡½ÐèÉ½Ü¹Ñ…É•Ñ}ÍÑ•µ}Í¹…ÁÍ¡½Ðñðíô°(€€€Á…åµ•¹ÑM¹…ÁÍ¡½ÐèÉ½Ü¹Á…åµ•¹Ñ}Í¹…ÁÍ¡½Ðñðíô°(€€€…±±½…Ñ¥½¹¥¹•ÉÁÉ¥¹ÐèÉ½Ü¹…±±½…Ñ¥½¹}™¥¹•ÉÁÉ¥¹Ðñð€œœ°(€€€ÍÑ…ÑÕÌèÉ½Ü¹ÍÑ…ÑÕÌñð€A•¹‘¥¹œ½Õ¹Ñ¥¹œœ°(€€€µ…Ñ¡•‘M…±•Í™½É•A…åµ•¹Ñ%èÉ½Ü¹µ…Ñ¡•‘}Í…±•Í™½É•}Á…åµ•¹Ñ}¥ñð¹Õ±°°(€€€µ…Ñ¡¥¹A…åµ•¹ÑM¹…ÁÍ¡½ÐèÉ½Ü¹µ…Ñ¡¥¹}Á…åµ•¹Ñ}Í¹…ÁÍ¡½Ðñðíô°(€€€¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”èÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}É•™•É•¹”ñð€œœ°(€€€¥¹ÍÑÉÕÑ¥½¹…Ñ”èÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}‘…Ñ”ñð¹Õ±°°(€€€¥¹ÍÑÉÕÑ¥½¹µ½Õ¹ÐèÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹¥¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð¤°(€€€Í•ÑÑ±•µ•¹ÑI•™•É•¹”èÉ½Ü¹Í•ÑÑ±•µ•¹Ñ}É•™•É•¹”ñð€œœ°(€€€Í•ÑÑ±•µ•¹Ñ…Ñ”èÉ½Ü¹Í•ÑÑ±•µ•¹Ñ}‘…Ñ”ñð¹Õ±°°(€€€Í•ÑÑ±•µ•¹Ñµ½Õ¹ÐèÉ½Ü¹Í•ÑÑ±•µ•¹Ñ}…µ½Õ¹Ð€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹Í•ÑÑ±•µ•¹Ñ}…µ½Õ¹Ð¤°(€€€…½Õ¹Ñ¥¹9½Ñ”èÉ½Ü¹…½Õ¹Ñ¥¹}¹½Ñ”ñð€œœ°(€€€É•Ù¥Í¥½¸è9Õµ‰•È¡É½Ü¹É•Ù¥Í¥½¸ñð€Ä¤°(€€€…­¹½Ý±•‘•‘	äèÉ½Ü¹…­¹½Ý±•‘•‘}‰äñð¹Õ±°°(€€€…­¹½Ý±•‘•‘	åµ…¥°èÉ½Ü¹…­¹½Ý±•‘•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€…­¹½Ý±•‘•‘ÐèÉ½Ü¹…­¹½Ý±•‘•‘}…Ðñð¹Õ±°°(€€€Í•ÑÑ±•‘	äèÉ½Ü¹Í•ÑÑ±•‘}‰äñð¹Õ±°°(€€€Í•ÑÑ±•‘	åµ…¥°èÉ½Ü¹Í•ÑÑ±•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€Í•ÑÑ±•‘ÐèÉ½Ü¹Í•ÑÑ±•‘}…Ðñð¹Õ±°°(€€€É•…Ñ•‘ÐèÉ½Ü¹É•…Ñ•‘}…Ðñð¹Õ±°°(€€€ÕÁ‘…Ñ•‘ÐèÉ½Ü¹ÕÁ‘…Ñ•‘}…Ðñð¹Õ±°°(€ôì)ô()™Õ¹Ñ¥½¸Í•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ñ¥½¸¡É½Ü°Á…ÉÑå5…À€ô¹•Ü5…À ¤°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ€ômt¤ì(€¥˜€ …É½Ü¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐÁ…ÉÑä€ôÁ…ÉÑå5…À¹•Ð¡É½Ü¹Á…ÉÑå}¥¤ñð¹Õ±°ì(€½¹ÍÐ…Ñ¥½¹QåÁ”€ôÉ½Ü¹…Ñ¥½¹}ÑåÁ”ì(€½¹ÍÐÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì€ô¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¹™¥±Ñ•È ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø¥¹ÍÑÉÕÑ¥½¸¹…Ñ¥½¹}¥€ôôôÉ½Ü¹¥€˜˜¥¹ÍÑÉÕÑ¥½¸¹ÍÑ…ÑÕÌ€„ôô€MÕÁ•ÉÍ•‘•œ¤¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¸¤ì(€½¹ÍÐ¥¹Ù½¥•±±½…Ñ¥½¹5…À€ô¹•Ü5…À ¤ì(€™½È€¡½¹ÍÐ¥¹ÍÑÉÕÑ¥½¸½˜ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¤ì(€€€½¹ÍÐ•á¥ÍÑ¥¹œ€ô¥¹Ù½¥•±±½…Ñ¥½¹5…À¹•Ð¡¥¹ÍÑÉÕÑ¥½¸¹Í½ÕÉ•MÕÁÁ±¥•É%¹Ù½¥•%¤ñðì(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•%è¥¹ÍÑÉÕÑ¥½¸¹Í½ÕÉ•MÕÁÁ±¥•É%¹Ù½¥•%°(€€€€€¥¹Ù½¥•9…µ”è¥¹ÍÑÉÕÑ¥½¸¹Í½ÕÉ•MÕÁÁ±¥•É%¹Ù½¥•9…µ”°(€€€€€…µ½Õ¹Ðè¥¹ÍÑÉÕÑ¥½¸¹…±±½…Ñ•‘µ½Õ¹Ð°(€€€ôì(€€€•á¥ÍÑ¥¹œ¹…µ½Õ¹Ð€ô5…Ñ ¹µ…à¡•á¥ÍÑ¥¹œ¹…µ½Õ¹Ð°¥¹ÍÑÉÕÑ¥½¸¹…±±½…Ñ•‘µ½Õ¹Ð¤ì(€€€¥¹Ù½¥•±±½…Ñ¥½¹5…À¹Í•Ð¡¥¹ÍÑÉÕÑ¥½¸¹Í½ÕÉ•MÕÁÁ±¥•É%¹Ù½¥•%°•á¥ÍÑ¥¹œ¤ì(€ô(€½¹ÍÐ±½Í•I•…Í½¸€ô…Ñ¥½¹QåÁ”€ôôô€±½Í•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ€ü…¹½¹¥…±¥ÍÁÕÑ•	•Ñ…±½Í•I•…Í½¸¡É½Ü¹±½Í•}É•…Í½¸°%MAUQ}	Q}MUAA1%I}1=M}IM=9L¤€è…Ñ¥½¹QåÁ”€ôôô€±½Í•}‰Õå•É}‘¥ÍÁÕÑ”œ€ü…¹½¹¥…±¥ÍÁÕÑ•	•Ñ…±½Í•I•…Í½¸¡É½Ü¹±½Í•}É•…Í½¸°%MAUQ}	Q}	UeI}1=M}IM=9L¤€èÉ½Ü¹±½Í•}É•…Í½¸ì(€É•ÑÕÉ¸ì(€€€¥èÉ½Ü¹¥°(€€€…Í•%èÉ½Ü¹…Í•}¥°(€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ}¥°(€€€Á…ÉÑå%èÉ½Ü¹Á…ÉÑå}¥°(€€€Á…ÉÑåM¥‘”èÉ½Ü¹Á…ÉÑå}Í¥‘”°(€€€Á…ÉÑåQåÁ”èÉ½Ü¹Á…ÉÑå}Í¥‘”°(€€€Á…ÉÑå9…µ”èÁ…ÉÑäü¹…½Õ¹Ñ}¹…µ”ñðÁ…ÉÑäü¹¹…µ”ñð€œœ°(€€€Á…ÉÑå½Õ¹Ñ%èÁ…ÉÑäü¹…½Õ¹Ñ}¥ñðÁ…ÉÑäü¹…½Õ¹Ñ%ñð¹Õ±°°(€€€Á…ÉÑå-•äèÁ…ÉÑäü¹…½Õ¹Ñ}¥€ü…½Õ¹Ðè‘íÁ…ÉÑä¹…½Õ¹Ñ}¥‘õ€€èÁ…ÉÑäü¹…½Õ¹Ñ%€ü…½Õ¹Ðè‘íÁ…ÉÑä¹…½Õ¹Ñ%‘õ€€è¹Õ±°°(€€€Á…ÉÑåI½±•ÌèÁ…ÉÑäü¹É½±•Ìñðmt°(€€€…Ñ¥½¹QåÁ”°(€€€…Ñ¥½¹1…‰•°è%MAUQ}	Q}Q%=9}1	1Mm…Ñ¥½¹QåÁ•tñðÉ½Ü¹…Ñ¥½¹}±…‰•°ñð…Ñ¥½¹QåÁ”°(€€€…µ½Õ¹ÐèÉ½Ü¹…µ½Õ¹Ð€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð¤°(€€€‘¥ÍÁÕÑ•µ½Õ¹ÐèÉ½Ü¹…µ½Õ¹Ð€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð¤°(€€€ÕÉÉ•¹å%Í½½‘”èÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹ÍlÁtü¹ÕÉÉ•¹å%Í½½‘”ñð€UMœ°(€€€¥¹Ù½¥•±±½…Ñ¥½¹Ìèl¸¸¹¥¹Ù½¥•±±½…Ñ¥½¹5…À¹Ù…±Õ•Ì ¥t°(€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì°(€€€Ñ½Ñ…±½9½ÑA…äèÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¹™¥±Ñ•È ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø¥¹ÍÑÉÕÑ¥½¸¹¥¹ÍÑÉÕÑ¥½¹QåÁ”€ôôô€Ý¥Ñ¡¡½±‘}Õ¹Á…¥œ¤¹É•‘Õ” ¡ÍÕ´°¥¹ÍÑÉÕÑ¥½¸¤€ôøÍÕ´€¬¥¹ÍÑÉÕÑ¥½¸¹Á±…¹¹•‘µ½Õ¹Ð°€À¤°(€€€Ñ½Ñ…±•Ñ	…­A…¥èÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¹™¥±Ñ•È ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø¥¹ÍÑÉÕÑ¥½¸¹¥¹ÍÑÉÕÑ¥½¹QåÁ”€ôôô€•Ñ}‰…­}Á…¥œ¤¹É•‘Õ” ¡ÍÕ´°¥¹ÍÑÉÕÑ¥½¸¤€ôøÍÕ´€¬¥¹ÍÑÉÕÑ¥½¸¹Á±…¹¹•‘µ½Õ¹Ð°€À¤°(€€€ÍÕÁÁ±¥•É¥ÍÁÕÑ•µ½Õ¹ÑI•ÅÕ¥É•èÉ½Ü¹Á…ÉÑå}Í¥‘”€ôôô€ÍÕÁÁ±¥•Èœ€˜˜%MAUQ}1e}MUAA1%I}%99%1}Q%=9L¹¡…Ì¡É½Ü¹…Ñ¥½¹}ÑåÁ”¤€˜˜É½Ü¹…µ½Õ¹Ð€ôô¹Õ±°°(€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹½¹Ù•ÉÍ¥½¹I•ÅÕ¥É•èÉ½Ü¹Á…ÉÑå}Í¥‘”€ôôô€ÍÕÁÁ±¥•Èœ€˜˜É½Ü¹…µ½Õ¹Ð€„ô¹Õ±°€˜˜%MAUQ}1e}MUAA1%I}%99%1}Q%=9L¹¡…Ì¡É½Ü¹…Ñ¥½¹}ÑåÁ”¤°(€€€ÍÁ•¥…±M•±±AÉ¥”èÉ½Ü¹ÍÁ•¥…±}Í•±±}ÁÉ¥”€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹ÍÁ•¥…±}Í•±±}ÁÉ¥”¤°(€€€ÍÁ•¥…±	ÕåAÉ¥”èÉ½Ü¹ÍÁ•¥…±}‰Õå}ÁÉ¥”€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹ÍÁ•¥…±}‰Õå}ÁÉ¥”¤°(€€€ÅÕ…¹Ñ¥ÑäèÉ½Ü¹ÅÕ…¹Ñ¥Ñä€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹ÅÕ…¹Ñ¥Ñä¤°(€€€ÅÕ…¹Ñ¥ÑåU¹¥ÐèÉ½Ü¹ÅÕ…¹Ñ¥Ñå}Õ¹¥Ðñð€5Pœ°(€€€±½Í•I•…Í½¸è±½Í•I•…Í½¸ñð¹Õ±°°(€€€‰…±…¹•A…åµ•¹Ñ%¹ÍÑÉÕÑ¥½¸èÉ½Ü¹‰…±…¹•}Á…åµ•¹Ñ}¥¹ÍÑÉÕÑ¥½¸ñð¹Õ±°°(€€€‘•ÍÉ¥ÁÑ¥½¸èÉ½Ü¹‘•ÍÉ¥ÁÑ¥½¸ñð€œœ°(€€€É•ÅÕ¥É•ÍÑÑ…¡µ•¹ÐèÉ½Ü¹É•ÅÕ¥É•Í}…ÑÑ…¡µ•¹Ð€ôôôÑÉÕ”°(€€€…½Õ¹Ñ¥¹MÑ…ÑÕÌèÉ½Ü¹•á•ÕÑ¥½¹}ÍÑ…ÑÕÌñð€A•¹‘¥¹œ½Õ¹Ñ¥¹œœ°(€€€•á•ÕÑ¥½¹MÑ…ÑÕÌèÉ½Ü¹•á•ÕÑ¥½¹}ÍÑ…ÑÕÌñð€A•¹‘¥¹œ½Õ¹Ñ¥¹œœ°(€€€¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”èÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}É•™•É•¹”ñð€œœ°(€€€¥¹ÍÑÉÕÑ¥½¹…Ñ”èÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}‘…Ñ”ñð¹Õ±°°(€€€¥¹ÍÑÉÕÑ¥½¹µ½Õ¹ÐèÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹¥¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð¤°(€€€Í•ÑÑ±•µ•¹ÑI•™•É•¹”èÉ½Ü¹Í•ÑÑ±•µ•¹Ñ}É•™•É•¹”ñð€œœ°(€€€Í•ÑÑ±•µ•¹Ñ…Ñ”èÉ½Ü¹Í•ÑÑ±•µ•¹Ñ}‘…Ñ”ñð¹Õ±°°(€€€Í•ÑÑ±•µ•¹Ñµ½Õ¹ÐèÉ½Ü¹Í•ÑÑ±•µ•¹Ñ}…µ½Õ¹Ð€ôô¹Õ±°€ü¹Õ±°€è9Õµ‰•È¡É½Ü¹Í•ÑÑ±•µ•¹Ñ}…µ½Õ¹Ð¤°(€€€…½Õ¹Ñ¥¹9½Ñ”èÉ½Ü¹…½Õ¹Ñ¥¹}¹½Ñ”ñð€œœ°(€€€…½Õ¹Ñ¥¹	äèÉ½Ü¹…½Õ¹Ñ¥¹}‰äñð¹Õ±°°(€€€…½Õ¹Ñ¥¹	åµ…¥°èÉ½Ü¹…½Õ¹Ñ¥¹}‰å}•µ…¥°ñð¹Õ±°°(€€€…½Õ¹Ñ¥¹ÐèÉ½Ü¹…½Õ¹Ñ¥¹}…Ðñð¹Õ±°°(€€€•á•ÕÑ•‘	äèÉ½Ü¹•á•ÕÑ•‘}‰äñð¹Õ±°°(€€€•á•ÕÑ•‘	åµ…¥°èÉ½Ü¹•á•ÕÑ•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€•á•ÕÑ•‘ÐèÉ½Ü¹•á•ÕÑ•‘}…Ðñð¹Õ±°°(€€€•á•ÕÑ¥½¹9½Ñ”èÉ½Ü¹•á•ÕÑ¥½¹}¹½Ñ”ñð¹Õ±°°(€€€±¥¹­•‘É••‘½µÁ•¹Í…Ñ¥½¹%èÉ½Ü¹±¥¹­•‘}…É••‘}½µÁ•¹Í…Ñ¥½¹}¥ñð¹Õ±°°(€€€±¥¹­•‘½µÁ•¹Í…Ñ¥½¹M¹…ÁÍ¡½ÐèÉ½Ü¹±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}Í¹…ÁÍ¡½Ðñðíô°(€€€±¥¹­•‘½µÁ•¹Í…Ñ¥½¹	äèÉ½Ü¹±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}‰äñð¹Õ±°°(€€€±¥¹­•‘½µÁ•¹Í…Ñ¥½¹	åµ…¥°èÉ½Ü¹±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}‰å}•µ…¥°ñð¹Õ±°°(€€€±¥¹­•‘½µÁ•¹Í…Ñ¥½¹ÐèÉ½Ü¹±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}…Ðñð¹Õ±°°(€€€É•…Ñ•‘	äèÉ½Ü¹É•…Ñ•‘}‰äñð¹Õ±°°(€€€É•…Ñ•‘	åµ…¥°èÉ½Ü¹É•…Ñ•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€ÕÁ‘…Ñ•‘	äèÉ½Ü¹ÕÁ‘…Ñ•‘}‰äñð¹Õ±°°(€€€ÕÁ‘…Ñ•‘	åµ…¥°èÉ½Ü¹ÕÁ‘…Ñ•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€É•…Ñ•‘ÐèÉ½Ü¹É•…Ñ•‘}…Ðñð¹Õ±°°(€€€ÕÁ‘…Ñ•‘ÐèÉ½Ü¹ÕÁ‘…Ñ•‘}…Ðñð¹Õ±°°(€ôì)ô()™Õ¹Ñ¥½¸Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¡É½Ü¤ì(€¥˜€ …É½Ü¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐ™¥±•9…µ”€ôÉ½Ü¹Íµ…ÉÑ}™¥±•¹…µ”ñðÉ½Ü¹½É¥¥¹…±}™¥±•¹…µ”ñð€¥ÍÁÕÑ”‘½Õµ•¹Ðœì(€½¹ÍÐÙ•ÉÍ¥½¹%€ôÉ½Ü¹Í…±•Í™½É•}½¹Ñ•¹Ñ}Ù•ÉÍ¥½¹}¥ì(€É•ÑÕÉ¸ì(€€€¥èÉ½Ü¹¥°(€€€…Í•%èÉ½Ü¹…Í•}¥°(€€€…Ñ¥½¹%èÉ½Ü¹…Ñ¥½¹}¥ñð¹Õ±°°(€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹%èÉ½Ü¹ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹}¥ñð¹Õ±°°(€€€Á…ÉÑå%èÉ½Ü¹Á…ÉÑå}¥°(€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ}¥°(€€€Á…ÉÑåM¥‘”èÉ½Ü¹Á…ÉÑå}Í¥‘”°(€€€Á…ÉÑåQåÁ”èÉ½Ü¹Á…ÉÑå}Í¥‘”°(€€€Á…ÉÑå9…µ”èÉ½Ü¹Á…ÉÑå}¹…µ”ñð€œœ°(€€€Á…ÉÑå½Õ¹Ñ%èÉ½Ü¹Á…ÉÑå}…½Õ¹Ñ}¥ñð¹Õ±°°(€€€‘½Õµ•¹Ñ¥É•Ñ¥½¸èÉ½Ü¹‘½Õµ•¹Ñ}‘¥É•Ñ¥½¸°(€€€‘½Õµ•¹ÑQåÁ”èÉ½Ü¹‘½Õµ•¹Ñ}ÑåÁ”°(€€€½É¥¥¹…±¥±•9…µ”èÉ½Ü¹½É¥¥¹…±}™¥±•¹…µ”°(€€€É•ÅÕ•ÍÑ•‘¥±•9…µ”èÉ½Ü¹É•ÅÕ•ÍÑ•‘}™¥±•¹…µ”ñð™¥±•9…µ”°(€€€™¥±•9…µ”°(€€€Íµ…ÉÑ¥±•9…µ”è™¥±•9…µ”°(€€€½¹Ñ•¹ÑQåÁ”èÉ½Ü¹½¹Ñ•¹Ñ}ÑåÁ”ñð€…ÁÁ±¥…Ñ¥½¸½½Ñ•ÐµÍÑÉ•…´œ°(€€€™¥±•áÑ•¹Í¥½¸èÉ½Ü¹™¥±•}•áÑ•¹Í¥½¸ñð€œœ°(€€€½¹Ñ•¹ÑM¥é”è9Õµ‰•È¡É½Ü¹½¹Ñ•¹Ñ}Í¥é”ñð€À¤°(€€€½¹Ñ•¹ÑY•ÉÍ¥½¹%èÙ•ÉÍ¥½¹%°(€€€½¹Ñ•¹Ñ½Õµ•¹Ñ%èÉ½Ü¹Í…±•Í™½É•}½¹Ñ•¹Ñ}‘½Õµ•¹Ñ}¥ñð¹Õ±°°(€€€±¥¹­•‘I•½É‘%èÉ½Ü¹Í…±•Í™½É•}±¥¹­•‘}É•½É‘}¥°(€€€±¥¹­•‘I•½É‘%‘ÌèÉ½Ü¹Í…±•Í™½É•}±¥¹­•‘}É•½É‘}¥€ümÉ½Ü¹Í…±•Í™½É•}±¥¹­•‘}É•½É‘}¥‘t€èmt°(€€€ÕÁ±½…‘MÑ…ÑÕÌèÉ½Ü¹ÕÁ±½…‘}ÍÑ…ÑÕÌñð€½µÁ±•Ñ”œ°(€€€Í…±•Í™½É•UÉ°èÉ½Ü¹Í…±•Í™½É•}ÕÉ°ñð¹Õ±°°(€€€‘½Ý¹±½…‘UÉ°è€½…Á¤½™Õ¹Ñ¥½¹Ì½Í…±•Í™½É•½Õµ•¹Ñ½Ý¹±½…ý­¥¹õ½¹Ñ•¹ÑY•ÉÍ¥½¸™¥ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡Ù•ÉÍ¥½¹%¥ô™™¥±•¹…µ”ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡™¥±•9…µ”¥õ€°(€€€ÕÁ±½…‘•‘	äèÉ½Ü¹ÕÁ±½…‘•‘}‰äñð¹Õ±°°(€€€ÕÁ±½…‘•‘	åµ…¥°èÉ½Ü¹ÕÁ±½…‘•‘}‰å}•µ…¥°ñð¹Õ±°°(€€€É•…Ñ•‘ÐèÉ½Ü¹É•…Ñ•‘}…Ðñð¹Õ±°°(€ôì)ô()™Õ¹Ñ¥½¸Í•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡É½Ü¤ì(€¥˜€ …É½Ü¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸ì(€€€¥èÉ½Ü¹¥°(€€€…Í•%èÉ½Ü¹…Í•}¥°(€€€…Ñ¥½¹%èÉ½Ü¹…Ñ¥½¹}¥ñð¹Õ±°°(€€€ÍÑ•µ%èÉ½Ü¹ÍÑ•µ}¥°(€€€•Ù•¹ÑQåÁ”èÉ½Ü¹•Ù•¹Ñ}ÑåÁ”°(€€€¹½Ñ”èÉ½Ü¹¹½Ñ”ñð€œœ°(€€€µ•Ñ…‘…Ñ„èÉ½Ü¹µ•Ñ…‘…Ñ„ñðíô°(€€€…Ñ½ÉUÍ•É%èÉ½Ü¹…Ñ½É}ÕÍ•É}¥ñð¹Õ±°°(€€€…Ñ½Éµ…¥°èÉ½Ü¹…Ñ½É}•µ…¥°ñð¹Õ±°°(€€€É•…Ñ•‘ÐèÉ½Ü¹É•…Ñ•‘}…Ðñð¹Õ±°°(€ôì)ô()™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•	•Ñ…Ñ¥½¹A…ÉÑåQåÁ”¡…Ñ¥½¹QåÁ”°¥¹ÁÕÑA…ÉÑåQåÁ”¤ì(€¥˜€¡…Ñ¥½¹QåÁ”€ôôô€¥ÍÍÕ•}‰Õå•É}É•‘¥Ñ}¹½Ñ”œñð…Ñ¥½¹QåÁ”€ôôô€±½Í•}‰Õå•É}‘¥ÍÁÕÑ”œ¤É•ÑÕÉ¸€‰Õå•Èœì(€¥˜€¡…Ñ¥½¹QåÁ”€ôôô€¡½±‘}ÍÕÁÁ±¥•É}Á…åµ•¹Ðœñð…Ñ¥½¹QåÁ”€ôôô€Á…å}™Õ±±}ÍÕÁÁ±¥•É}¥¹Ù½¥”œñð…Ñ¥½¹QåÁ”€ôôô€‘•‘ÕÑ}ÍÁ•¥™¥}…µ½Õ¹Ðœñð…Ñ¥½¹QåÁ”€ôôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œñð…Ñ¥½¹QåÁ”€ôôô€±½Í•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ¤É•ÑÕÉ¸€ÍÕÁÁ±¥•Èœì(€É•ÑÕÉ¸MÑÉ¥¹œ¡¥¹ÁÕÑA…ÉÑåQåÁ”ñð€œœ¤¹Ñ½1½Ý•É…Í” ¤€ôôô€‰Õå•Èœ€ü€‰Õå•Èœ€è€ÍÕÁÁ±¥•Èœì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•¥ÍÁÕÑ•	•Ñ…Ñ¥½¸¡¥¹ÁÕÐ€ôíô°…Í•I½Ü°ÁÉ½™¥±”€ôíô°É•¥ÍÑÉä¤ì(€½¹ÍÐ…Ñ¥½¹QåÁ”€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹…Ñ¥½¹QåÁ”ñð¥¹ÁÕÐ¹…Ñ¥½¹}ÑåÁ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …%MAUQ}	Q}Q%=9}1	1Mm…Ñ¥½¹QåÁ•t¤Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥‘¥ÍÁÕÑ”Ý½É­™±½Ü…Ñ¥½¸ÑåÁ”¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐÁ…ÉÑåM¥‘”€ô‘¥ÍÁÕÑ•	•Ñ…Ñ¥½¹A…ÉÑåQåÁ”¡…Ñ¥½¹QåÁ”°¥¹ÁÕÐ¹Á…ÉÑåM¥‘”ñð¥¹ÁÕÐ¹Á…ÉÑå}Í¥‘”ñð¥¹ÁÕÐ¹Á…ÉÑåQåÁ”ñð¥¹ÁÕÐ¹Á…ÉÑå}ÑåÁ”¤ì(€½¹ÍÐÁ…ÉÑä€ô…¹½¹¥…±¥ÍÁÕÑ•Ñ¥½¹Q…É•Ð¡¥¹ÁÕÐ°Á…ÉÑåM¥‘”°É•¥ÍÑÉä¤ì(€½¹ÍÐ…µ½Õ¹Ð€ô‘•¥µ…±=É9Õ±°¡¥¹ÁÕÐ¹…µ½Õ¹Ð¤ì(€¥˜€¡…Ñ¥½¹QåÁ”€ôôô€‘•‘ÕÑ}ÍÁ•¥™¥}…µ½Õ¹Ðœ€˜˜…µ½Õ¹Ð€ôô¹Õ±°¤Ñ¡É½Ü…ÁÁÉÉ½È •‘ÕÑ¥½¸…µ½Õ¹Ð¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€¥˜€¡…Ñ¥½¹QåÁ”€ôôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ€˜˜€¡…µ½Õ¹Ð€ôô¹Õ±°ñð…µ½Õ¹Ð€ðô€À¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È ¹Ñ•È…¸…É••ÍÕÁÁ±¥•ÈÉ•½Ù•Éä…µ½Õ¹Ð…‰½Ù”é•É¼°½È¡½½Í”±½Í”‘¥ÍÁÕÑ”Ý¥Ñ ÍÕÁÁ±¥•È€¡¹¼É•½Ù•Éä¤¸œ°€ÐÀÀ¤ì(€ô(€¥˜€¡…Ñ¥½¹QåÁ”€ôôô€¥ÍÍÕ•}‰Õå•É}É•‘¥Ñ}¹½Ñ”œ€˜˜€¡…µ½Õ¹Ð€ôô¹Õ±°ñð…µ½Õ¹Ð€ðô€À¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È ¹Ñ•È…¸…É••‰Õå•ÈÉ•‘¥Ð¹½Ñ”…µ½Õ¹Ð…‰½Ù”é•É¼°½È¡½½Í”±½Í”‘¥ÍÁÕÑ”Ý¥Ñ ‰Õå•È€¡¹¼É•‘¥Ð¹½Ñ”¤¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐ±½Í•I•…Í½¹%¹ÁÕÐ€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹±½Í•I•…Í½¸ñð¥¹ÁÕÐ¹±½Í•}É•…Í½¸ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐ±½Í•I•…Í½¸€ô…Ñ¥½¹QåÁ”€ôôô€±½Í•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ€ü…¹½¹¥…±¥ÍÁÕÑ•	•Ñ…±½Í•I•…Í½¸¡±½Í•I•…Í½¹%¹ÁÕÐ°%MAUQ}	Q}MUAA1%I}1=M}IM=9L¤€è…Ñ¥½¹QåÁ”€ôôô€±½Í•}‰Õå•É}‘¥ÍÁÕÑ”œ€ü…¹½¹¥…±¥ÍÁÕÑ•	•Ñ…±½Í•I•…Í½¸¡±½Í•I•…Í½¹%¹ÁÕÐ°%MAUQ}	Q}	UeI}1=M}IM=9L¤€è±½Í•I•…Í½¹%¹ÁÕÐñð¹Õ±°ì(€¥˜€¡…Ñ¥½¹QåÁ”€ôôô€±½Í•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ€˜˜€…%MAUQ}	Q}MUAA1%I}1=M}IM=9L¹¥¹±Õ‘•Ì¡±½Í•I•…Í½¸¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥ÍÕÁÁ±¥•È±½Í”É•…Í½¸¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€ô(€¥˜€¡…Ñ¥½¹QåÁ”€ôôô€±½Í•}‰Õå•É}‘¥ÍÁÕÑ”œ€˜˜€…%MAUQ}	Q}	UeI}1=M}IM=9L¹¥¹±Õ‘•Ì¡±½Í•I•…Í½¸¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥‰Õå•È±½Í”É•…Í½¸¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐ‰…±…¹•A…åµ•¹Ñ%¹ÍÑÉÕÑ¥½¸€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹‰…±…¹•A…åµ•¹Ñ%¹ÍÑÉÕÑ¥½¸ñð¥¹ÁÕÐ¹‰…±…¹•}Á…åµ•¹Ñ}¥¹ÍÑÉÕÑ¥½¸ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€¥˜€¡‰…±…¹•A…åµ•¹Ñ%¹ÍÑÉÕÑ¥½¸€˜˜€…%MAUQ}	Q}	19}Ae59Q}%9MQIUQ%=9L¹¥¹±Õ‘•Ì¡‰…±…¹•A…åµ•¹Ñ%¹ÍÑÉÕÑ¥½¸¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥‰…±…¹”Á…åµ•¹Ð¥¹ÍÑÉÕÑ¥½¸¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€ô(€¥˜€¡…Ñ¥½¹QåÁ”€ôôô€±½Í•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ€˜˜€…‰…±…¹•A…åµ•¹Ñ%¹ÍÑÉÕÑ¥½¸¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È 	…±…¹”Á…åµ•¹Ð¥¹ÍÑÉÕÑ¥½¸¥ÌÉ•ÅÕ¥É•Ý¡•¸±½Í¥¹œ„ÍÕÁÁ±¥•È‘¥ÍÁÕÑ”Ý¥Ñ¡½ÕÐÉ•½Ù•Éä¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐÕÉÉ•¹å%Í½½‘”€ô(€€€MÑÉ¥¹œ¡¥¹ÁÕÐ¹ÕÉÉ•¹å%Í½½‘”ñð¥¹ÁÕÐ¹ÕÉÉ•¹å}¥Í½}½‘”ñð€UMœ¤(€€€€€€¹ÑÉ¥´ ¤(€€€€€€¹Ñ½UÁÁ•É…Í” ¤ñð€UMœì(€¥˜€¡…Ñ¥½¹QåÁ”€ôôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ€˜˜€„½ymµiuìÍô¼¹Ñ•ÍÐ¡ÕÉÉ•¹å%Í½½‘”¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•È‘¥ÍÁÕÑ”ÕÉÉ•¹äµÕÍÐ‰”„Ñ¡É•”µ±•ÑÑ•È%M<½‘”¸œ°€ÐÀÀ¤ì(€ô((€É•ÑÕÉ¸ì(€€€ÍÑ•µ}¥è…Í•I½Ü¹ÍÑ•µ}¥°(€€€Á…ÉÑå}¥èÁ…ÉÑä¹¥°(€€€Á…ÉÑå}Í¥‘”èÁ…ÉÑåM¥‘”°(€€€Á…ÉÑå}…½Õ¹Ñ}­•äèÁ…ÉÑä¹…½Õ¹Ñ-•ä°(€€€…Ñ¥½¹}ÑåÁ”è…Ñ¥½¹QåÁ”°(€€€…Ñ¥½¹}±…‰•°è%MAUQ}	Q}Q%=9}1	1Mm…Ñ¥½¹QåÁ•t°(€€€…µ½Õ¹Ð°(€€€ÍÁ•¥…±}Í•±±}ÁÉ¥”è‘•¥µ…±=É9Õ±°¡¥¹ÁÕÐ¹ÍÁ•¥…±M•±±AÉ¥”€üü¥¹ÁÕÐ¹ÍÁ•¥…±}Í•±±}ÁÉ¥”¤°(€€€ÍÁ•¥…±}‰Õå}ÁÉ¥”è‘•¥µ…±=É9Õ±°¡¥¹ÁÕÐ¹ÍÁ•¥…±	ÕåAÉ¥”€üü¥¹ÁÕÐ¹ÍÁ•¥…±}‰Õå}ÁÉ¥”¤°(€€€ÅÕ…¹Ñ¥Ñäè‘•¥µ…±=É9Õ±°¡¥¹ÁÕÐ¹ÅÕ…¹Ñ¥Ñä¤°(€€€ÅÕ…¹Ñ¥Ñå}Õ¹¥ÐèMÑÉ¥¹œ¡¥¹ÁÕÐ¹ÅÕ…¹Ñ¥ÑåU¹¥Ðñð¥¹ÁÕÐ¹ÅÕ…¹Ñ¥Ñå}Õ¹¥Ðñð€5Pœ¤¹ÑÉ¥´ ¤ñð€5Pœ°(€€€±½Í•}É•…Í½¸è±½Í•I•…Í½¸°(€€€‰…±…¹•}Á…åµ•¹Ñ}¥¹ÍÑÉÕÑ¥½¸è‰…±…¹•A…åµ•¹Ñ%¹ÍÑÉÕÑ¥½¸°(€€€‘•ÍÉ¥ÁÑ¥½¸èMÑÉ¥¹œ¡¥¹ÁÕÐ¹‘•ÍÉ¥ÁÑ¥½¸ñð€œœ¤¹ÑÉ¥´ ¤°(€€€É•ÅÕ¥É•Í}…ÑÑ…¡µ•¹Ðè	½½±•…¸¡¥¹ÁÕÐ¹É•ÅÕ¥É•ÍÑÑ…¡µ•¹Ð€üü¥¹ÁÕÐ¹É•ÅÕ¥É•Í}…ÑÑ…¡µ•¹Ð¤°(€€€•á•ÕÑ¥½¹}ÍÑ…ÑÕÌè¹½Éµ…±¥é•¥ÍÁÕÑ•	•Ñ…MÑ…ÑÕÌ¡¥¹ÁÕÐ¹…½Õ¹Ñ¥¹MÑ…ÑÕÌñð¥¹ÁÕÐ¹•á•ÕÑ¥½¹MÑ…ÑÕÌñð¥¹ÁÕÐ¹•á•ÕÑ¥½¹}ÍÑ…ÑÕÌ°%MAUQ}	Q}aUQ%=9}MQQUML°€A•¹‘¥¹œ½Õ¹Ñ¥¹œœ¤°(€€€ÕÉÉ•¹å}¥Í½}½‘”èÕÉÉ•¹å%Í½½‘”°(€€€¥¹Ù½¥•}…±±½…Ñ¥½¹ÌèÉÉ…ä¹¥ÍÉÉ…ä¡¥¹ÁÕÐ¹¥¹Ù½¥•±±½…Ñ¥½¹Ìñð¥¹ÁÕÐ¹¥¹Ù½¥•}…±±½…Ñ¥½¹Ì¤€ü¥¹ÁÕÐ¹¥¹Ù½¥•±±½…Ñ¥½¹Ìñð¥¹ÁÕÐ¹¥¹Ù½¥•}…±±½…Ñ¥½¹Ì€èmt°(€€€ÕÁ‘…Ñ•‘}‰äèÁÉ½™¥±”¹¥°(€€€ÕÁ‘…Ñ•‘}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€ôì)ô()™Õ¹Ñ¥½¸ÁÉ•Á…É•MÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑÑ¥½¸¡…Ñ¥½¸°ÕÉÉ•¹ÑMÑ•´¤ì(€¥˜€¡…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”€„ôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ¤É•ÑÕÉ¸…Ñ¥½¸ì(€½¹ÍÐÍ¡•µ„€ôÕÉÉ•¹ÑMÑ•´ü¹}MÕÁÁ±¥•É}M•ÑÑ±•µ•¹Ñ}M¡•µ„ì(€¥˜€ …Í¡•µ„ü¹Ù…±¥¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È¡MÕÁÁ±¥•ÈÁ…åµ•¹Ð…ÕÑ½µ…Ñ¥½¸¥ÌÕ¹…Ù…¥±…‰±”è€‘ì¡Í¡•µ„ü¹¥ÍÍÕ•ÌñðlM…±•Í™½É”¥¹Ù½¥”½Á…åµ•¹ÐÍ¡•µ„¥Ì¥¹½µÁ±•Ñ”¸t¤¹©½¥¸ œ€œ¥õ€°€ÐÀÀ¤ì(€ô(€½¹ÍÐ…½Õ¹Ñ-•ä€ô‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡…Ñ¥½¸¹Á…ÉÑå}…½Õ¹Ñ}­•ä¤ì(€½¹ÍÐ¥¹Ù½¥•Ì€ô€¡ÕÉÉ•¹ÑMÑ•´ü¹}MÕÁÁ±¥•É}%¹Ù½¥•}áÁ½ÍÕÉ•}I½ÝÌñðmt¤¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡¥¹Ù½¥”¹ÍÕÁÁ±¥•É½Õ¹Ñ%¤€ôôô…½Õ¹Ñ-•ä¤ì(€½¹ÍÐ¥¹Ù…±¥‘%¹Ù½¥•Ì€ô¥¹Ù½¥•Ì¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø€¡¥¹Ù½¥”¹Ý…É¹¥¹Ìñðmt¤¹Í½µ” ¡Ý…É¹¥¹œ¤€ôø€½¹¼Ù…±¥ÍÕÁÁ±¥•È½Õ¹Ð±½½­ÕÁñ¹•…Ñ¥Ù•ñ•á••‘Ì¥ÑÌ¥¹Ù½¥”…µ½Õ¹Ð½¤¹Ñ•ÍÐ¡Ý…É¹¥¹œ¤¤¤ì(€¥˜€¡¥¹Ù…±¥‘%¹Ù½¥•Ì¹±•¹Ñ ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È ½ÉÉ•ÐÑ¡”ÍÕÁÁ±¥•È¥¹Ù½¥”½Õ¹Ð½ÈÁ…å…‰±”‰…±…¹”¥¸M…±•Í™½É”‰•™½É”Í…Ù¥¹œÑ¡¥ÌÍÕÁÁ±¥•ÈÉ•Í½±ÕÑ¥½¸¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐ…±±½…Ñ¥½¸€ô…±±½…Ñ•MÕÁÁ±¥•É¥ÍÁÕÑ”¡ì(€€€¥¹Ù½¥•Ì°(€€€‘¥ÍÁÕÑ•µ½Õ¹Ðè…Ñ¥½¸¹…µ½Õ¹Ð°(€€€ÕÉÉ•¹å%Í½½‘”è…Ñ¥½¸¹ÕÉÉ•¹å}¥Í½}½‘”°(€€€¥¹Ù½¥•±±½…Ñ¥½¹Ìè…Ñ¥½¸¹¥¹Ù½¥•}…±±½…Ñ¥½¹Ì°(€ô¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹…Ñ¥½¸°(€€€¥¹Ù½¥•}…±±½…Ñ¥½¹Ìè…±±½…Ñ¥½¸¹…±±½…Ñ¥½¹Ì¹µ…À ¡¥Ñ•´¤€ôø€¡ì(€€€€€ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥è¥Ñ•´¹ÍÕÁÁ±¥•É%¹Ù½¥•%°(€€€€€…µ½Õ¹Ðè¥Ñ•´¹…±±½…Ñ•‘µ½Õ¹Ð°(€€€ô¤¤°(€€€ÍÕÁÁ±¥•É}…±±½…Ñ¥½¸è…±±½…Ñ¥½¸°(€€€ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹ÌèÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹I½ÝÌ¡…±±½…Ñ¥½¸¤¹µ…À ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø€¡ì(€€€€€€¸¸¹¥¹ÍÑÉÕÑ¥½¸°(€€€€€Í½ÕÉ•}ÍÑ•µ}¥èÕÉÉ•¹ÑMÑ•´¹%°(€€€€€Í½ÕÉ•}ÍÑ•µ}Í¹…ÁÍ¡½Ðèì(€€€€€€€ÍÑ•µ%èÕÉÉ•¹ÑMÑ•´¹%°(€€€€€€€ÍÑ•µ9…µ”èÕÉÉ•¹ÑMÑ•´¹}¥ÍÁ±…å}9…µ”ñðÕÉÉ•¹ÑMÑ•´¹9…µ”ñðÕÉÉ•¹ÑMÑ•´¹-•åMÑ•µ}}Œñð€œœ°(€€€€€€€‘•±¥Ù•Éå…Ñ”èÕÉÉ•¹ÑMÑ•´¹•±¥Ù•Éå}…Ñ•}}Œñð¹Õ±°°(€€€€€ô°(€€€ô¤¤°(€ôì)ô()™Õ¹Ñ¥½¸…±Õ±…Ñ•¥ÍÁÕÑ•	•Ñ…M•ÑÑ±•µ•¹Ð¡…Ñ¥½¹Ì€ômt¤ì(€±•Ð‰Õå•É%µÁ…Ð€ô€Àì(€±•ÐÍÕÁÁ±¥•É%µÁ…Ð€ô€Àì(€±•Ð‰Õå•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ð€ô€Àì(€±•ÐÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ð€ô€Àì(€½¹ÍÐ±¥¹•Ì€ômtì((€™½È€¡½¹ÍÐ…Ñ¥½¸½˜…Ñ¥½¹Ì¤ì(€€€½¹ÍÐ…µ½Õ¹Ð€ô9Õµ‰•È¡…Ñ¥½¸¹…µ½Õ¹Ð€üü…Ñ¥½¸¹…µ½Õ¹Ñ}•¹ÑÌ€üü€À¤ñð€Àì(€€€¥˜€¡…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”€ôôô€¥ÍÍÕ•}‰Õå•É}É•‘¥Ñ}¹½Ñ”œñð…Ñ¥½¸¹…Ñ¥½¹QåÁ”€ôôô€¥ÍÍÕ•}‰Õå•É}É•‘¥Ñ}¹½Ñ”œ¤ì(€€€€€‰Õå•É%µÁ…Ð€´ô…µ½Õ¹Ðì(€€€€€±¥¹•Ì¹ÁÕÍ ¡ì(€€€€€€€±…‰•°è…Ñ¥½¸¹…Ñ¥½¹}±…‰•°ñð…Ñ¥½¸¹…Ñ¥½¹1…‰•°ñð€	Õå•ÈÉ•‘¥Ð¹½Ñ”œ°(€€€€€€€¥µÁ…Ðè€µ…µ½Õ¹Ð°(€€€€€ô¤ì(€€€ô(€€€¥˜€¡…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”€ôôô€‘•‘ÕÑ}ÍÁ•¥™¥}…µ½Õ¹Ðœñð…Ñ¥½¸¹…Ñ¥½¹QåÁ”€ôôô€‘•‘ÕÑ}ÍÁ•¥™¥}…µ½Õ¹Ðœ¤ì(€€€€€ÍÕÁÁ±¥•É%µÁ…Ð€¬ô…µ½Õ¹Ðì(€€€€€±¥¹•Ì¹ÁÕÍ ¡ì(€€€€€€€±…‰•°è…Ñ¥½¸¹…Ñ¥½¹}±…‰•°ñð…Ñ¥½¸¹…Ñ¥½¹1…‰•°ñð€MÕÁÁ±¥•È‘•‘ÕÑ¥½¸œ°(€€€€€€€¥µÁ…Ðè…µ½Õ¹Ð°(€€€€€ô¤ì(€€€ô(€€€¥˜€¡…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”€ôôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œñð…Ñ¥½¸¹…Ñ¥½¹QåÁ”€ôôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ¤ì(€€€€€ÍÕÁÁ±¥•É%µÁ…Ð€¬ô…µ½Õ¹Ðì(€€€€€±¥¹•Ì¹ÁÕÍ ¡ì(€€€€€€€±…‰•°è…Ñ¥½¸¹…Ñ¥½¹}±…‰•°ñð…Ñ¥½¸¹…Ñ¥½¹1…‰•°ñð€MÕÁÁ±¥•È‘¥ÍÁÕÑ”É•Í½±ÕÑ¥½¸œ°(€€€€€€€¥µÁ…Ðè…µ½Õ¹Ð°(€€€€€ô¤ì(€€€ô((€€€½¹ÍÐ‰Õå•ÉÉ•‘¥Ñ9½Ñ”€ô9Õµ‰•È¡…Ñ¥½¸¹ÍÁ•¥…±}Í•±±}ÁÉ¥”€üü…Ñ¥½¸¹ÍÁ•¥…±M•±±AÉ¥”¤ì(€€€¥˜€¡9Õµ‰•È¹¥Í¥¹¥Ñ”¡‰Õå•ÉÉ•‘¥Ñ9½Ñ”¤€˜˜‰Õå•ÉÉ•‘¥Ñ9½Ñ”€ø€À¤ì(€€€€€½¹ÍÐ¥µÁ…Ð€ô€µ‰Õå•ÉÉ•‘¥Ñ9½Ñ”ì(€€€€€‰Õå•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ð€¬ô¥µÁ…Ðì(€€€€€±¥¹•Ì¹ÁÕÍ ¡ì(€€€€€€€±…‰•°è€	Õå•È…É••É•‘¥Ð¹½Ñ”œ°(€€€€€€€‰Õå•ÉÉ•‘¥Ñ9½Ñ”°(€€€€€€€¥µÁ…Ð°(€€€€€ô¤ì(€€€ô((€€€½¹ÍÐÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ”€ô9Õµ‰•È¡…Ñ¥½¸¹ÍÁ•¥…±}‰Õå}ÁÉ¥”€üü…Ñ¥½¸¹ÍÁ•¥…±	ÕåAÉ¥”¤ì(€€€¥˜€¡9Õµ‰•È¹¥Í¥¹¥Ñ”¡ÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ”¤€˜˜ÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ”€ø€À¤ì(€€€€€½¹ÍÐ¥µÁ…Ð€ôÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ”ì(€€€€€ÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ð€¬ô¥µÁ…Ðì(€€€€€±¥¹•Ì¹ÁÕÍ ¡ì(€€€€€€€±…‰•°è€MÕÁÁ±¥•È…É••É•‘¥Ð¹½Ñ”œ°(€€€€€€€ÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ”°(€€€€€€€¥µÁ…Ð°(€€€€€ô¤ì(€€€ô(€ô((€½¹ÍÐÍ•ÑÑ±•µ•¹ÑA¹°€ô‰Õå•É%µÁ…Ð€¬ÍÕÁÁ±¥•É%µÁ…Ð€¬‰Õå•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ð€¬ÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ðì(€É•ÑÕÉ¸ì(€€€‰Õå•É%µÁ…Ð°(€€€ÍÕÁÁ±¥•É%µÁ…Ð°(€€€‰Õå•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ð°(€€€ÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ð°(€€€ÍÁ•¥…±AÉ¥•A¹°è‰Õå•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ð€¬ÍÕÁÁ±¥•ÉÉ•‘¥Ñ9½Ñ•%µÁ…Ð°(€€€Í•ÑÑ±•µ•¹ÑA¹°°(€€€±¥¹•Ì°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘¥ÍÁÕÑ•	•Ñ…]½É­™±½Ý5…À¡±¥•¹Ð°ÍÑ•µ%‘Ì€ômt¤ì(€½¹ÍÐ¥‘Ì€ôl¸¸¹¹•ÜM•Ð¡ÍÑ•µ%‘Ì¹™¥±Ñ•È¡	½½±•…¸¤¥tì(€¥˜€ …¥‘Ì¹±•¹Ñ ¤É•ÑÕÉ¸íôì(€½¹ÍÐm…Í•ÍI•Ì°Á…ÉÑ¥•ÍI•Ì°…Ñ¥½¹ÍI•Ì°¥¹ÍÑÉÕÑ¥½¹ÍI•Ì°•Ù•¹ÑÍI•Ì°‘½Õµ•¹ÑÍI•Ít€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤¹¥¸ ÍÑ•µ}¥œ°¥‘Ì¤°(€€€±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}Á…ÉÑ¥•Ìœ¤¹Í•±•Ð¡%MAUQ}]=I-1=]}AIQe}M1P¤¹¥¸ ÍÑ•µ}¥œ°¥‘Ì¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œèÑÉÕ”ô¤°(€€€±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}Q%=9}M1P¤¹¥¸ ÍÑ•µ}¥œ°¥‘Ì¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œèÑÉÕ”ô¤°(€€€±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}MUAA1%I}%9MQIUQ%=9}M1P¤¹¥¸ ÍÑ•µ}¥œ°¥‘Ì¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œèÑÉÕ”ô¤°(€€€±¥•¹Ð(€€€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}•Ù•¹ÑÌœ¤(€€€€€€¹Í•±•Ð¡%MAUQ}	Q}Y9Q}M1P¤(€€€€€€¹¥¸ ÍÑ•µ}¥œ°¥‘Ì¤(€€€€€€¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œè™…±Í”ô¤(€€€€€€¹±¥µ¥Ð¡5…Ñ ¹µ…à ÄÀÀ°5…Ñ ¹µ¥¸¡¥‘Ì¹±•¹Ñ €¨€ÈÔ°€ÈÔÀÀ¤¤¤°(€€€±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}‘½Õµ•¹ÑÌœ¤¹Í•±•Ð¡%MAUQ}]=I-1=]}=U59Q}M1P¤¹¥¸ ÍÑ•µ}¥œ°¥‘Ì¤¹•Ä ÕÁ±½…‘}ÍÑ…ÑÕÌœ°€½µÁ±•Ñ”œ¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œè™…±Í”ô¤°(€t¤ì(€¥˜€¡…Í•ÍI•Ì¹•ÉÉ½È¤Ñ¡É½Ü…Í•ÍI•Ì¹•ÉÉ½Èì(€¥˜€¡Á…ÉÑ¥•ÍI•Ì¹•ÉÉ½È¤Ñ¡É½ÜÁ…ÉÑ¥•ÍI•Ì¹•ÉÉ½Èì(€¥˜€¡…Ñ¥½¹ÍI•Ì¹•ÉÉ½È¤Ñ¡É½Ü…Ñ¥½¹ÍI•Ì¹•ÉÉ½Èì(€¥˜€¡¥¹ÍÑÉÕÑ¥½¹ÍI•Ì¹•ÉÉ½È¤Ñ¡É½Ü¥¹ÍÑÉÕÑ¥½¹ÍI•Ì¹•ÉÉ½Èì(€¥˜€¡•Ù•¹ÑÍI•Ì¹•ÉÉ½È¤Ñ¡É½Ü•Ù•¹ÑÍI•Ì¹•ÉÉ½Èì(€¥˜€¡‘½Õµ•¹ÑÍI•Ì¹•ÉÉ½È¤Ñ¡É½Ü‘½Õµ•¹ÑÍI•Ì¹•ÉÉ½Èì((€½¹ÍÐµ…À€ôíôì(€™½È€¡½¹ÍÐÉ½Ü½˜…Í•ÍI•Ì¹‘…Ñ„ñðmt¤ì(€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t€ôì(€€€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡É½Ü¤°(€€€€€Á…ÉÑ¥•Ìèmt°(€€€€€…Ñ¥½¹Ìèmt°(€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìèmt°(€€€€€•Ù•¹ÑÌèmt°(€€€€€‘½Õµ•¹ÑÌèmt°(€€€ôì(€ô(€½¹ÍÐÁ…ÉÑå	å%€ô¹•Ü5…À ¤ì(€™½È€¡½¹ÍÐÉ½Ü½˜Á…ÉÑ¥•ÍI•Ì¹‘…Ñ„ñðmt¤ì(€€€Á…ÉÑå	å%¹Í•Ð¡É½Ü¹¥°É½Ü¤ì(€€€¥˜€ …µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¤(€€€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t€ôì(€€€€€€€…Í”è¹Õ±°°(€€€€€€€Á…ÉÑ¥•Ìèmt°(€€€€€€€…Ñ¥½¹Ìèmt°(€€€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìèmt°(€€€€€€€•Ù•¹ÑÌèmt°(€€€€€€€‘½Õµ•¹ÑÌèmt°(€€€€€ôì(€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¹Á…ÉÑ¥•Ì¹ÁÕÍ ¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¡É½Ü¤¤ì(€ô(€™½È€¡½¹ÍÐÉ½Ü½˜¥¹ÍÑÉÕÑ¥½¹ÍI•Ì¹‘…Ñ„ñðmt¤ì(€€€¥˜€ …µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¤(€€€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t€ôì(€€€€€€€…Í”è¹Õ±°°(€€€€€€€Á…ÉÑ¥•Ìèmt°(€€€€€€€…Ñ¥½¹Ìèmt°(€€€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìèmt°(€€€€€€€•Ù•¹ÑÌèmt°(€€€€€€€‘½Õµ•¹ÑÌèmt°(€€€€€ôì(€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¹ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¹ÁÕÍ ¡Í•É¥…±¥é•¥ÍÁÕÑ•MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¸¡É½Ü¤¤ì(€ô(€™½È€¡½¹ÍÐÉ½Ü½˜…Ñ¥½¹ÍI•Ì¹‘…Ñ„ñðmt¤ì(€€€¥˜€ …µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¤(€€€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t€ôì(€€€€€€€…Í”è¹Õ±°°(€€€€€€€Á…ÉÑ¥•Ìèmt°(€€€€€€€…Ñ¥½¹Ìèmt°(€€€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìèmt°(€€€€€€€•Ù•¹ÑÌèmt°(€€€€€€€‘½Õµ•¹ÑÌèmt°(€€€€€ôì(€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¹…Ñ¥½¹Ì¹ÁÕÍ ¡Í•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ñ¥½¸¡É½Ü°Á…ÉÑå	å%°¥¹ÍÑÉÕÑ¥½¹ÍI•Ì¹‘…Ñ„ñðmt¤¤ì(€ô(€™½È€¡½¹ÍÐÉ½Ü½˜•Ù•¹ÑÍI•Ì¹‘…Ñ„ñðmt¤ì(€€€¥˜€ …µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¤(€€€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t€ôì(€€€€€€€…Í”è¹Õ±°°(€€€€€€€Á…ÉÑ¥•Ìèmt°(€€€€€€€…Ñ¥½¹Ìèmt°(€€€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìèmt°(€€€€€€€•Ù•¹ÑÌèmt°(€€€€€€€‘½Õµ•¹ÑÌèmt°(€€€€€ôì(€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¹•Ù•¹ÑÌ¹ÁÕÍ ¡Í•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡É½Ü¤¤ì(€ô(€™½È€¡½¹ÍÐÉ½Ü½˜‘½Õµ•¹ÑÍI•Ì¹‘…Ñ„ñðmt¤ì(€€€¥˜€ …µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¤(€€€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t€ôì(€€€€€€€…Í”è¹Õ±°°(€€€€€€€Á…ÉÑ¥•Ìèmt°(€€€€€€€…Ñ¥½¹Ìèmt°(€€€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìèmt°(€€€€€€€•Ù•¹ÑÌèmt°(€€€€€€€‘½Õµ•¹ÑÌèmt°(€€€€€ôì(€€€µ…ÁmÉ½Ü¹ÍÑ•µ}¥‘t¹‘½Õµ•¹ÑÌ¹ÁÕÍ ¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¡É½Ü¤¤ì(€ô(€É•ÑÕÉ¸µ…Àì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°…Í•I½Ü°•Ù•¹ÑQåÁ”°ÁÉ½™¥±”°Á…å±½…€ôíô¤ì(€½¹ÍÐì•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}•Ù•¹ÑÌœ¤¹¥¹Í•ÉÐ¡ì(€€€…Í•}¥è…Í•I½Ü¹¥°(€€€…Ñ¥½¹}¥èÁ…å±½…¹…Ñ¥½¹%ñð¹Õ±°°(€€€ÍÑ•µ}¥è…Í•I½Ü¹ÍÑ•µ}¥°(€€€•Ù•¹Ñ}ÑåÁ”è•Ù•¹ÑQåÁ”°(€€€¹½Ñ”èÁ…å±½…¹¹½Ñ”ñð¹Õ±°°(€€€µ•Ñ…‘…Ñ„èÁ…å±½…¹µ•Ñ…‘…Ñ„ñðíô°(€€€…Ñ½É}ÕÍ•É}¥èÁÉ½™¥±”ü¹¥ñð¹Õ±°°(€€€…Ñ½É}•µ…¥°èÁÉ½™¥±”ü¹•µ…¥°ñð¹Õ±°°(€ô¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì)ô()™Õ¹Ñ¥½¸…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÍÑ•´€ôíô¤ì(€¥˜€ …¥ÍM…±•Í™½É•¥ÍÁÕÑ•±½Í•¡ÍÑ•´¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ¤¤É•ÑÕÉ¸ì(€Ñ¡É½Ü…ÁÁÉÉ½È¡Q¡¥Ì‘¥ÍÁÕÑ”¥Ì…±É•…‘ä€‘íMÑÉ¥¹œ¡ÍÑ•´¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ¤¹ÑÉ¥´ ¥ô¥¸M…±•Í™½É”¸½µµ•É¥…°Ý½É­™±½Ü¡…¹•Ì…É”±½­•ì¥¹…¹”µ…ä½¹Ñ¥¹Õ”…¸…±É•…‘ä…ÁÁÉ½Ù•=L…½Õ¹Ñ¥¹œÝ½É­™±½Ü¹€°€ÐÀä¤ì)ô()™Õ¹Ñ¥½¸¡…ÍU¹…•ÁÑ•‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡…Í•I½Ü°ÍÑ•´¤ì(€É•ÑÕÉ¸	½½±•…¸ (€€€…Í•I½Üü¹¥(€€€€˜˜…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ€„ôô€±½Í•œ(€€€€˜˜¥ÍM…±•Í™½É•¥ÍÁÕÑ•±½Í•¡ÍÑ•´ü¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ¤(€€€€˜˜€…¡…ÍI•½É‘•‘½Í±½ÍÕÉ•]É¥Ñ•‰…¬¡…Í•I½Ü¤°(€€¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•½É‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡±¥•¹Ð°…Í•I½Ü°ÍÑ•´°ÁÉ½™¥±”°Ý½É­™±½ÝMÑ…ÑÕÌ€ô¹Õ±°¤ì(€¥˜€ …¡…ÍU¹…•ÁÑ•‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡…Í•I½Ü°ÍÑ•´¤¤É•ÑÕÉ¸…Í•I½Üì(€½¹ÍÐ™¥ÉÍÑ•Ñ•Ñ¥½¸€ô€……Í•I½Ü¹•áÑ•É¹…±}±½ÍÕÉ•}‘•Ñ•Ñ•‘}…Ðì(€½¹ÍÐ¹½Ý%Í¼€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€½¹ÍÐÍ…±•Í™½É•MÑ…ÑÕÌ€ôMÑÉ¥¹œ¡ÍÑ•´¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐì‘…Ñ„èÕÁ‘…Ñ•‘…Í”°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€€¸¸¸¡Ý½É­™±½ÝMÑ…ÑÕÌ€üìÝ½É­™±½Ý}ÍÑ…ÑÕÌèÝ½É­™±½ÝMÑ…ÑÕÌô€èíô¤°(€€€€€ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌèÍ…±•Í™½É•MÑ…ÑÕÌ°(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}ÍÑ…ÑÕÌè€•áÑ•É¹…°œ°(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}•ÉÉ½Èè¹Õ±°°(€€€€€•áÑ•É¹…±}±½ÍÕÉ•}‘•Ñ•Ñ•‘}…Ðè…Í•I½Ü¹•áÑ•É¹…±}±½ÍÕÉ•}‘•Ñ•Ñ•‘}…Ðñð¹½Ý%Í¼°(€€€€€•áÑ•É¹…±}±½ÍÕÉ•}Í…±•Í™½É•}ÍÑ…ÑÕÌèÍ…±•Í™½É•MÑ…ÑÕÌ°(€€€€€•áÑ•É¹…±}±½ÍÕÉ•}Í…±•Í™½É•}µ½‘¥™¥•‘}…ÐèÍÑ•´¹1…ÍÑ5½‘¥™¥•‘…Ñ”ñð¹Õ±°°(€€€€€ÕÁ‘…Ñ•‘}…Ðè¹½Ý%Í¼°(€€€ô¤(€€€€¹•Ä ¥œ°…Í•I½Ü¹¥¤(€€€€¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤(€€€€¹Í¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€¥˜€¡™¥ÉÍÑ•Ñ•Ñ¥½¸¤ì(€€€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°€•áÑ•É¹…±}±½ÍÕÉ•}‘•Ñ•Ñ•œ°ÁÉ½™¥±”°ì(€€€€€¹½Ñ”èM…±•Í™½É”Ý…Ì¡…¹•‘¥É•Ñ±äÑ¼€‘íÍ…±•Í™½É•MÑ…ÑÕÍô¸=LÉ•Ñ…¥¹•Ñ¡”€‘íÕÁ‘…Ñ•‘…Í”¹Ý½É­™±½Ý}ÍÑ…ÑÕÍô…½Õ¹Ñ¥¹œÍÑ…”¹€°(€€€€€µ•Ñ…‘…Ñ„èì(€€€€€€€Í…±•Í™½É•MÑ…ÑÕÌ°(€€€€€€€Í…±•Í™½É•1…ÍÑ5½‘¥™¥•‘ÐèÍÑ•´¹1…ÍÑ5½‘¥™¥•‘…Ñ”ñð¹Õ±°°(€€€€€€€¥¹Ñ•É¹…±]½É­™±½ÝMÑ…ÑÕÌèÕÁ‘…Ñ•‘…Í”¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ°(€€€€€ô°(€€€ô¤ì(€ô(€É•ÑÕÉ¸ÕÁ‘…Ñ•‘…Í”ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Á•ÉÍ¥ÍÑ¥ÍÁÕÑ•½Õ¹Ñ¥¹MÑ…ÑÕÌ¡±¥•¹Ð°…Í•I½Ü°ÍÑ•´°ÁÉ½™¥±”°Ý½É­™±½ÝMÑ…ÑÕÌ¤ì(€¥˜€¡¡…ÍU¹…•ÁÑ•‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡…Í•I½Ü°ÍÑ•´¤¤ì(€€€É•ÑÕÉ¸É•½É‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡±¥•¹Ð°…Í•I½Ü°ÍÑ•´°ÁÉ½™¥±”°Ý½É­™±½ÝMÑ…ÑÕÌ¤ì(€ô(€É•ÑÕÉ¸ÝÉ¥Ñ•¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍQ½M…±•Í™½É”¡±¥•¹Ð°…Í•I½Ü°ÁÉ½™¥±”°Ý½É­™±½ÝMÑ…ÑÕÌ¤ì)ô()™Õ¹Ñ¥½¸ÁÉ½©•ÑáÑ•É¹…±±å±½Í•‘¥ÍÁÕÑ•]½É­™±½ÝÌ¡ÍÑ•µÌ€ômt°Ý½É­™±½Ý5…À€ôíô¤ì(€™½È€¡½¹ÍÐÍÑ•´½˜ÍÑ•µÌ¤ì(€€€½¹ÍÐÝ½É­™±½Ü€ôÝ½É­™±½Ý5…ÁmÍÑ•´¹%‘tì(€€€½¹ÍÐÁÉ½©•Ñ¥½¸€ôÁÉ½©•ÑáÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡Ý½É­™±½Üü¹…Í”°ÍÑ•´¤ì(€€€¥˜€¡ÁÉ½©•Ñ¥½¸¤Ý½É­™±½Ü¹…Í”€ôì€¸¸¹Ý½É­™±½Ü¹…Í”°€¸¸¹ÁÉ½©•Ñ¥½¸ôì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑ¥•Ì¡±¥•¹Ð°…Í•%¤ì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}Á…ÉÑ¥•Ìœ¤¹Í•±•Ð¡%MAUQ}]=I-1=]}AIQe}M1P¤¹•Ä …Í•}¥œ°…Í•%¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œèÑÉÕ”ô¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€É•ÑÕÉ¸‘…Ñ„ñðmtì)ô()™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Á…ÉÑåI½ÝÌ€ômt¤ì(€É•ÑÕÉ¸¹•Ü5…À¡Á…ÉÑåI½ÝÌ¹µ…À ¡Á…ÉÑä¤€ôømÁ…ÉÑä¹¥°Á…ÉÑåt¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•%¤ì(€½¹ÍÐmÁ…ÉÑåI½ÝÌ°…Ñ¥½¹ÍI•ÍÕ±Ð°¥¹ÍÑÉÕÑ¥½¹ÍI•ÍÕ±Ñt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡m±½…‘¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑ¥•Ì¡±¥•¹Ð°…Í•%¤°±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}Q%=9}M1P¤¹•Ä …Í•}¥œ°…Í•%¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œèÑÉÕ”ô¤°±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}MUAA1%I}%9MQIUQ%=9}M1P¤¹•Ä …Í•}¥œ°…Í•%¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œèÑÉÕ”ô¥t¤ì(€¥˜€¡…Ñ¥½¹ÍI•ÍÕ±Ð¹•ÉÉ½È¤Ñ¡É½Ü…Ñ¥½¹ÍI•ÍÕ±Ð¹•ÉÉ½Èì(€¥˜€¡¥¹ÍÑÉÕÑ¥½¹ÍI•ÍÕ±Ð¹•ÉÉ½È¤Ñ¡É½Ü¥¹ÍÑÉÕÑ¥½¹ÍI•ÍÕ±Ð¹•ÉÉ½Èì(€½¹ÍÐ¥¹ÍÑÉÕÑ¥½¹I½ÝÌ€ô¥¹ÍÑÉÕÑ¥½¹ÍI•ÍÕ±Ð¹‘…Ñ„ñðmtì(€É•ÑÕÉ¸ì(€€€Á…ÉÑåI½ÝÌ°(€€€…Ñ¥½¹I½ÝÌè…Ñ¥½¹ÍI•ÍÕ±Ð¹‘…Ñ„ñðmt°(€€€¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°(€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìè¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¸¤°(€€€…Ñ¥½¹Ìè€¡…Ñ¥½¹ÍI•ÍÕ±Ð¹‘…Ñ„ñðmt¤¹µ…À ¡É½Ü¤€ôøÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ñ¥½¸¡É½Ü°‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Á…ÉÑåI½ÝÌ¤°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¤¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±•…É%¹Ù…±¥‘¥ÍÁÕÑ•½µÁ•¹Í…Ñ¥½¹1¥¹­Ì¡±¥•¹Ð°…Í•I½Ü°ÁÉ½™¥±”¤ì(€½¹ÍÐÝ½É­™±½Ü€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÁ…ÉÑå5…À€ô‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Ý½É­™±½Ü¹Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐ¥¹Ù…±¥€ôÝ½É­™±½Ü¹…Ñ¥½¹I½ÝÌ¹™¥±Ñ•È ¡…Ñ¥½¸¤€ôøì(€€€¥˜€ ……Ñ¥½¸¹±¥¹­•‘}…É••‘}½µÁ•¹Í…Ñ¥½¹}¥¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÁ…ÉÑä€ôÁ…ÉÑå5…À¹•Ð¡…Ñ¥½¸¹Á…ÉÑå}¥¤ì(€€€½¹ÍÐÍ¹…ÁÍ¡½Ñ½Õ¹Ñ%€ô…Ñ¥½¸¹±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}Í¹…ÁÍ¡½Ðü¹…½Õ¹Ñ%ì(€€€É•ÑÕÉ¸€…l±½Í•}‰Õå•É}‘¥ÍÁÕÑ”œ°€±½Í•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”t¹¥¹±Õ‘•Ì¡…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”¤(€€€€€ñðMÑÉ¥¹œ¡…Ñ¥½¸¹±½Í•}É•…Í½¸ñð€œœ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤€„ôô€Õ½Œ½Á•¹•œ(€€€€€ñð€…Á…ÉÑäü¹…½Õ¹Ñ}¥(€€€€€ñðÍ¹…ÁÍ¡½Ñ½Õ¹Ñ%€„ôôÁ…ÉÑä¹…½Õ¹Ñ}¥ì(€ô¤ì(€™½È€¡½¹ÍÐ…Ñ¥½¸½˜¥¹Ù…±¥¤ì(€€€½¹ÍÐ¹½Ü€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€€€½¹ÍÐì•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹ÕÁ‘…Ñ”¡ì(€€€€€±¥¹­•‘}…É••‘}½µÁ•¹Í…Ñ¥½¹}¥è¹Õ±°°(€€€€€±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}Í¹…ÁÍ¡½Ðèíô°(€€€€€±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}‰äè¹Õ±°°(€€€€€±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}‰å}•µ…¥°è¹Õ±°°(€€€€€±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}…Ðè¹Õ±°°(€€€€€ÕÁ‘…Ñ•‘}‰äèÁÉ½™¥±”¹¥°(€€€€€ÕÁ‘…Ñ•‘}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€€€ÕÁ‘…Ñ•‘}…Ðè¹½Ü°(€€€ô¤¹•Ä ¥œ°…Ñ¥½¸¹¥¤ì(€€€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€€€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°…Í•I½Ü°€½µÁ•¹Í…Ñ¥½¹}±…¥µ}±¥¹­•œ°ÁÉ½™¥±”°ì(€€€€€…Ñ¥½¹%è…Ñ¥½¸¹¥°(€€€€€¹½Ñ”è€É••½µÁ•¹Í…Ñ¥½¸±…¥´±¥¹¬±•…É•‰•…ÕÍ”Ñ¡”‘¥ÍÁÕÑ”Á…ÉÑä½È±½ÍÕÉ”É•…Í½¸¡…¹•¸œ°(€€€€€µ•Ñ…‘…Ñ„èì±…¥µI•µ½Ù•èÑÉÕ”ô°(€€€ô¤ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸…ÍÍ•ÉÑ¥ÍÁÕÑ•U½±…¥µÍI•…‘å½É±½ÍÕÉ”¡…Ñ¥½¹Ì°Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐÁ…ÉÑå5…À€ô‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Á…ÉÑåI½ÝÌ¤ì(€™½È€¡½¹ÍÐ…Ñ¥½¸½˜…Ñ¥½¹Ì¹™¥±Ñ•È ¡É½Ü¤€ôøMÑÉ¥¹œ¡É½Ü¹±½Í•}É•…Í½¸ñð€œœ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤€ôôô€Õ½Œ½Á•¹•œ¤¤ì(€€€½¹ÍÐÁ…ÉÑä€ôÁ…ÉÑå5…À¹•Ð¡…Ñ¥½¸¹Á…ÉÑå}¥¤ì(€€€¥˜€ ……Ñ¥½¸¹±¥¹­•‘}…É••‘}½µÁ•¹Í…Ñ¥½¹}¥¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È¡€‘íÁ…ÉÑäü¹…½Õ¹Ñ}¹…µ”ñð€Q¡”‘¥ÍÁÕÑ”Á…ÉÑäôÉ•ÅÕ¥É•Ì„±¥¹­•É••½µÁ•¹Í…Ñ¥½¸±…¥´‰•™½É”™¥¹…°±½ÍÕÉ”¹€°€ÐÀä¤ì(€€€ô(€€€½¹ÍÐÍ¹…ÁÍ¡½Ð€ô…Ñ¥½¸¹±¥¹­•‘}½µÁ•¹Í…Ñ¥½¹}Í¹…ÁÍ¡½Ðñðíôì(€€€¥˜€¡Í¹…ÁÍ¡½Ð¹±¥¹­•‘]¡¥±•=Á•¸€„ôôÑÉÕ”ñðÍ¹…ÁÍ¡½Ð¹…½Õ¹Ñ%€„ôôÁ…ÉÑäü¹…½Õ¹Ñ}¥¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È¡€‘íÁ…ÉÑäü¹…½Õ¹Ñ}¹…µ”ñð€Q¡”‘¥ÍÁÕÑ”Á…ÉÑäô¡…Ì…¸¥¹Ù…±¥½µÁ•¹Í…Ñ¥½¸±…¥´±¥¹¬¸I•µ½Ù”¥Ð…¹Í•±•ÐÑ¡”½ÉÉ•Ð½Á•¸±…¥´¹€°€ÐÀä¤ì(€€€ô(€€€…Ý…¥ÐÙ…±¥‘…Ñ•É••‘½µÁ•¹Í…Ñ¥½¹±…¥µ1¥¹¬¡…Ñ¥½¸¹±¥¹­•‘}…É••‘}½µÁ•¹Í…Ñ¥½¹}¥°Á…ÉÑä¹…½Õ¹Ñ}¥°ìÉ•ÅÕ¥É•=Á•¸è™…±Í”ô¤ì(€ô)ô()™Õ¹Ñ¥½¸ÍÑ½É•‘MÕÁÁ±¥•É%¹Ù½¥•±±½…Ñ¥½¹Ì¡¥¹ÍÑÉÕÑ¥½¹I½ÝÌ€ômt¤ì(€½¹ÍÐ…±±½…Ñ¥½¹Ì€ô¹•Ü5…À ¤ì(€™½È€¡½¹ÍÐ¥¹ÍÑÉÕÑ¥½¸½˜¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€„ôô€MÕÁ•ÉÍ•‘•œ¤¤ì(€€€½¹ÍÐ¥€ô¥¹ÍÑÉÕÑ¥½¸¹Í½ÕÉ•}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥ì(€€€¥˜€ …¥¤½¹Ñ¥¹Õ”ì(€€€…±±½…Ñ¥½¹Ì¹Í•Ð¡¥°5…Ñ ¹µ…à¡9Õµ‰•È¡…±±½…Ñ¥½¹Ì¹•Ð¡¥¤ñð€À¤°9Õµ‰•È¡¥¹ÍÑÉÕÑ¥½¸¹…±±½…Ñ•‘}…µ½Õ¹Ðñð€À¤¤¤ì(€ô(€É•ÑÕÉ¸l¸¸¹…±±½…Ñ¥½¹Ít¹µ…À ¡mÍÕÁÁ±¥•É%¹Ù½¥•%°…µ½Õ¹Ñt¤€ôø€¡ì(€€€ÍÕÁÁ±¥•É%¹Ù½¥•%°(€€€…µ½Õ¹Ð°(€ô¤¤ì)ô()™Õ¹Ñ¥½¸ÕÉÉ•¹ÑMÕÁÁ±¥•ÉÑ¥½¹±±½…Ñ¥½¸¡…Ñ¥½¸°Á…ÉÑåI½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´¤ì(€½¹ÍÐÁ…ÉÑä€ô‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Á…ÉÑåI½ÝÌ¤¹•Ð¡…Ñ¥½¸¹Á…ÉÑå}¥¤ì(€¥˜€ …Á…ÉÑä¤Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•ÈÉ•Í½±ÕÑ¥½¸¡…Ì¹¼Í•±•Ñ•½Õ¹Ð¸œ°€ÐÀÀ¤ì(€½¹ÍÐ…½Õ¹Ñ-•ä€ô‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡Á…ÉÑä¹…½Õ¹Ñ}¥¤ì(€½¹ÍÐ…Ñ¥½¹%¹ÍÑÉÕÑ¥½¹Ì€ô¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¹™¥±Ñ•È ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø¥¹ÍÑÉÕÑ¥½¸¹…Ñ¥½¹}¥€ôôô…Ñ¥½¸¹¥€˜˜¥¹ÍÑÉÕÑ¥½¸¹ÍÑ…ÑÕÌ€„ôô€MÕÁ•ÉÍ•‘•œ¤ì(€½¹ÍÐÕÉÉ•¹å%Í½½‘”€ô…Ñ¥½¹%¹ÍÑÉÕÑ¥½¹ÍlÁtü¹ÕÉÉ•¹å}¥Í½}½‘”ñð€UMœì(€½¹ÍÐ¥¹Ù½¥•Ì€ô€¡ÕÉÉ•¹ÑMÑ•´ü¹}MÕÁÁ±¥•É}%¹Ù½¥•}áÁ½ÍÕÉ•}I½ÝÌñðmt¤¹™¥±Ñ•È ¡¥¹Ù½¥”¤€ôø‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡¥¹Ù½¥”¹ÍÕÁÁ±¥•É½Õ¹Ñ%¤€ôôô…½Õ¹Ñ-•ä¤ì(€¥˜€ …ÕÉÉ•¹ÑMÑ•´ü¹}MÕÁÁ±¥•É}M•ÑÑ±•µ•¹Ñ}M¡•µ„ü¹Ù…±¥¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È¡MÕÁÁ±¥•ÈÁ…åµ•¹Ð…ÕÑ½µ…Ñ¥½¸¥ÌÕ¹…Ù…¥±…‰±”è€‘ì¡ÕÉÉ•¹ÑMÑ•´ü¹}MÕÁÁ±¥•É}M•ÑÑ±•µ•¹Ñ}M¡•µ„ü¹¥ÍÍÕ•Ìñðmt¤¹©½¥¸ œ€œ¥õ€°€ÐÀä¤ì(€ô(€É•ÑÕÉ¸…±±½…Ñ•MÕÁÁ±¥•É¥ÍÁÕÑ”¡ì(€€€¥¹Ù½¥•Ì°(€€€‘¥ÍÁÕÑ•µ½Õ¹Ðè…Ñ¥½¸¹…µ½Õ¹Ð°(€€€ÕÉÉ•¹å%Í½½‘”°(€€€¥¹Ù½¥•±±½…Ñ¥½¹ÌèÍÑ½É•‘MÕÁÁ±¥•É%¹Ù½¥•±±½…Ñ¥½¹Ì¡…Ñ¥½¹%¹ÍÑÉÕÑ¥½¹Ì¤°(€ô¤ì)ô()™Õ¹Ñ¥½¸ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹MÑ…Ñ•¡…¹•¡ÕÉÉ•¹ÑI½ÝÌ€ômt°…±±½…Ñ¥½¸€ôíô¤ì(€½¹ÍÐ…Ñ¥Ù•I½ÝÌ€ôÕÉÉ•¹ÑI½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹ÍÑ…ÑÕÌ€„ôô€MÕÁ•ÉÍ•‘•œ¤ì(€½¹ÍÐÕÉÉ•¹Ñ¥¹•ÉÁÉ¥¹Ð€ô…Ñ¥Ù•I½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹…±±½…Ñ¥½¹}™¥¹•ÉÁÉ¥¹Ð¤¹™¥¹¡	½½±•…¸¤ì(€¥˜€¡ÕÉÉ•¹Ñ¥¹•ÉÁÉ¥¹Ð¤É•ÑÕÉ¸ÕÉÉ•¹Ñ¥¹•ÉÁÉ¥¹Ð€„ôô…±±½…Ñ¥½¸¹™¥¹•ÉÁÉ¥¹Ðì(€½¹ÍÐÕÉÉ•¹ÑM¡…Á”€ô…Ñ¥Ù•I½ÝÌ¹µ…À ¡É½Ü¤€ôø€‘íÉ½Ü¹Í½ÕÉ•}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥‘ôè‘íÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}ÑåÁ•ôè‘í9Õµ‰•È¡É½Ü¹Á±…¹¹•‘}…µ½Õ¹Ðñð€À¤¹Ñ½¥á• È¥õ€¤¹Í½ÉÐ ¤ì(€½¹ÍÐ¹•áÑM¡…Á”€ôÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹I½ÝÌ¡…±±½…Ñ¥½¸¤(€€€€¹µ…À ¡É½Ü¤€ôø€‘íÉ½Ü¹Í½ÕÉ•}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥‘ôè‘íÉ½Ü¹¥¹ÍÑÉÕÑ¥½¹}ÑåÁ•ôè‘í9Õµ‰•È¡É½Ü¹Á±…¹¹•‘}…µ½Õ¹Ðñð€À¤¹Ñ½¥á• È¥õ€¤(€€€€¹Í½ÉÐ ¤ì(€É•ÑÕÉ¸)M=8¹ÍÑÉ¥¹¥™ä¡ÕÉÉ•¹ÑM¡…Á”¤€„ôô)M=8¹ÍÑÉ¥¹¥™ä¡¹•áÑM¡…Á”¤ì)ô()™Õ¹Ñ¥½¸…ÍÍ•ÉÑMÕÁÁ±¥•É±±½…Ñ¥½¹ÍÕÉÉ•¹Ð¡…Ñ¥½¹Ì°Á…ÉÑåI½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´¤ì(€™½È€¡½¹ÍÐ…Ñ¥½¸½˜…Ñ¥½¹Ì¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹…Ñ¥½¹}ÑåÁ”€ôôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ¤¤ì(€€€½¹ÍÐ…±±½…Ñ¥½¸€ôÕÉÉ•¹ÑMÕÁÁ±¥•ÉÑ¥½¹±±½…Ñ¥½¸¡…Ñ¥½¸°Á…ÉÑåI½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´¤ì(€€€½¹ÍÐ…Ñ¥½¹%¹ÍÑÉÕÑ¥½¹Ì€ô¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¹™¥±Ñ•È ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø¥¹ÍÑÉÕÑ¥½¸¹…Ñ¥½¹}¥€ôôô…Ñ¥½¸¹¥¤ì(€€€¥˜€¡ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹MÑ…Ñ•¡…¹•¡…Ñ¥½¹%¹ÍÑÉÕÑ¥½¹Ì°…±±½…Ñ¥½¸¤¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•È¥¹Ù½¥”Á…åµ•¹Ð‘…Ñ„¡…¹•¸M…Ù”Ñ¡”‘É…™Ð……¥¸Ñ¼É•Ù¥•ÜÑ¡”ÕÁ‘…Ñ•¼¹½ÐÁ…ä…¹•Ð‰…¬Á…¥…µ½Õ¹Ð…±±½…Ñ¥½¸¸œ°€ÐÀä¤ì(€€€ô(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•½¹¥±•ÁÁÉ½Ù•‘MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü°Á…ÉÑåI½ÝÌ°…Ñ¥½¹I½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”¤ì(€¥˜€¡…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€„ôô€ÁÁÉ½Ù•œñð…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ€ôôô€±½Í•œ¤ì(€€€É•ÑÕÉ¸ì¡…¹•è™…±Í”°¥¹ÍÑÉÕÑ¥½¹I½ÝÌôì(€ô(€½¹ÍÐÉ•½¹¥±¥…Ñ¥½¹Ì€ômtì(€™½È€¡½¹ÍÐ…Ñ¥½¸½˜…Ñ¥½¹I½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ½Ü¹…Ñ¥½¹}ÑåÁ”€ôôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ¤¤ì(€€€½¹ÍÐ…±±½…Ñ¥½¸€ôÕÉÉ•¹ÑMÕÁÁ±¥•ÉÑ¥½¹±±½…Ñ¥½¸¡…Ñ¥½¸°Á…ÉÑåI½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´¤ì(€€€½¹ÍÐÕÉÉ•¹ÑI½ÝÌ€ô¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¹™¥±Ñ•È ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø¥¹ÍÑÉÕÑ¥½¸¹…Ñ¥½¹}¥€ôôô…Ñ¥½¸¹¥¤ì(€€€¥˜€ …ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹MÑ…Ñ•¡…¹•¡ÕÉÉ•¹ÑI½ÝÌ°…±±½…Ñ¥½¸¤¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐÍ½ÕÉ•MÑ•µM¹…ÁÍ¡½Ð€ôì(€€€€€ÍÑ•µ%èÕÉÉ•¹ÑMÑ•´¹%°(€€€€€ÍÑ•µ9…µ”èÕÉÉ•¹ÑMÑ•´¹}¥ÍÁ±…å}9…µ”ñðÕÉÉ•¹ÑMÑ•´¹9…µ”ñðÕÉÉ•¹ÑMÑ•´¹-•åMÑ•µ}}Œñð€œœ°(€€€€€‘•±¥Ù•Éå…Ñ”èÕÉÉ•¹ÑMÑ•´¹•±¥Ù•Éå}…Ñ•}}Œñð¹Õ±°°(€€€ôì(€€€É•½¹¥±¥…Ñ¥½¹Ì¹ÁÕÍ ¡ì(€€€€€…Ñ¥½¹}¥è…Ñ¥½¸¹¥°(€€€€€¥¹ÍÑÉÕÑ¥½¹ÌèÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹I½ÝÌ¡…±±½…Ñ¥½¸¤¹µ…À ¡‘•Í¥É•¤€ôø€¡ì(€€€€€€€€¸¸¹‘•Í¥É•°(€€€€€€€Á…ÉÑå}¥è…Ñ¥½¸¹Á…ÉÑå}¥°(€€€€€€€Í½ÕÉ•}ÍÑ•µ}¥è…Í•I½Ü¹ÍÑ•µ}¥°(€€€€€€€Í½ÕÉ•}ÍÑ•µ}Í¹…ÁÍ¡½ÐèÍ½ÕÉ•MÑ•µM¹…ÁÍ¡½Ð°(€€€€€€€…±±½…Ñ¥½¹}™¥¹•ÉÁÉ¥¹Ðè…±±½…Ñ¥½¸¹™¥¹•ÉÁÉ¥¹Ð°(€€€€€ô¤¤°(€€€€€¹½Ñ”èMÕÁÁ±¥•ÈÁ…åµ•¹Ð¡…¹•¸¼¹½ÐÁ…ä¥Ì¹½Ü€‘í…±±½…Ñ¥½¸¹Ñ½Ñ…±½9½ÑA…ä¹Ñ½¥á• È¥ô€‘í…±±½…Ñ¥½¸¹ÕÉÉ•¹å%Í½½‘•ôì•Ð‰…¬Á…¥…µ½Õ¹Ð¥Ì€‘í…±±½…Ñ¥½¸¹Ñ½Ñ…±•Ñ	…­A…¥¹Ñ½¥á• È¥ô€‘í…±±½…Ñ¥½¸¹ÕÉÉ•¹å%Í½½‘•ô¹€°(€€€€€µ•Ñ…‘…Ñ„èì(€€€€€€€‘¥ÍÁÕÑ•µ½Õ¹Ðè…±±½…Ñ¥½¸¹‘¥ÍÁÕÑ•µ½Õ¹Ð°(€€€€€€€Ñ½Ñ…±½9½ÑA…äè…±±½…Ñ¥½¸¹Ñ½Ñ…±½9½ÑA…ä°(€€€€€€€Ñ½Ñ…±•Ñ	…­A…¥è…±±½…Ñ¥½¸¹Ñ½Ñ…±•Ñ	…­A…¥°(€€€€€€€…±±½…Ñ¥½¹¥¹•ÉÁÉ¥¹Ðè…±±½…Ñ¥½¸¹™¥¹•ÉÁÉ¥¹Ð°(€€€€€ô°(€€€ô¤ì(€ô(€¥˜€ …É•½¹¥±¥…Ñ¥½¹Ì¹±•¹Ñ ¤ì(€€€¥˜€ …¡…ÍU¹…•ÁÑ•‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡…Í•I½Ü°ÕÉÉ•¹ÑMÑ•´¤€˜˜…Í•I½Ü¹Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}ÍÑ…ÑÕÌ€ôôô€™…¥±•œ€˜˜lÁÁÉ½Ù•€´A•¹‘¥¹œ½Õ¹Ñ¥¹œœ°€½Õ¹Ñ¥¹œ%¸AÉ½É•ÍÌœ°€M•ÑÑ±•€´I•…‘äÑ¼±½Í”t¹¥¹±Õ‘•Ì¡…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ¤¤ì(€€€€€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍQ½M…±•Í™½É”¡±¥•¹Ð°…Í•I½Ü°ÁÉ½™¥±”°…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ¤ì(€€€€€É•ÑÕÉ¸ì¡…¹•è™…±Í”°ÝÉ¥Ñ•‰…­I•ÑÉ¥•èÑÉÕ”°¥¹ÍÑÉÕÑ¥½¹I½ÝÌôì(€€€ô(€€€É•ÑÕÉ¸ì¡…¹•è™…±Í”°ÝÉ¥Ñ•‰…­I•ÑÉ¥•è™…±Í”°¥¹ÍÑÉÕÑ¥½¹I½ÝÌôì(€ô(€½¹ÍÐì•ÉÉ½ÈèÉ•½¹¥±¥…Ñ¥½¹ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹ÉÁŒ É•½¹¥±•}‘¥ÍÁÕÑ•}ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹Ìœ°ì(€€€Á}…Í•}¥è…Í•I½Ü¹¥°(€€€Á}É•½¹¥±¥…Ñ¥½¹ÌèÉ•½¹¥±¥…Ñ¥½¹Ì°(€€€Á}…Ñ½Èèì¥èÁÉ½™¥±”¹¥°•µ…¥°èÁÉ½™¥±”¹•µ…¥°ô°(€ô¤ì(€¥˜€¡É•½¹¥±¥…Ñ¥½¹ÉÉ½È¤Ñ¡É½ÜÉ•½¹¥±¥…Ñ¥½¹ÉÉ½Èì(€½¹ÍÐÕÁ‘…Ñ•‘…Í”€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€…Ý…¥ÐÁ•ÉÍ¥ÍÑ¥ÍÁÕÑ•½Õ¹Ñ¥¹MÑ…ÑÕÌ¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”°€½Õ¹Ñ¥¹œ%¸AÉ½É•ÍÌœ¤ì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}MUAA1%I}%9MQIUQ%=9}M1P¤¹•Ä …Í•}¥œ°…Í•I½Ü¹¥¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œèÑÉÕ”ô¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€É•ÑÕÉ¸ì(€€€¡…¹•èÑÉÕ”°(€€€ÝÉ¥Ñ•‰…­I•ÑÉ¥•è™…±Í”°(€€€¥¹ÍÑÉÕÑ¥½¹I½ÝÌè‘…Ñ„ñðmt°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡±¥•¹Ð°…Í•%¤ì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}‘½Õµ•¹ÑÌœ¤¹Í•±•Ð¡%MAUQ}]=I-1=]}=U59Q}M1P¤¹•Ä …Í•}¥œ°…Í•%¤¹•Ä ÕÁ±½…‘}ÍÑ…ÑÕÌœ°€½µÁ±•Ñ”œ¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œè™…±Í”ô¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€É•ÑÕÉ¸‘…Ñ„ñðmtì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘¥ÍÁÕÑ•]½É­™±½ÝÙ•¹ÑÌ¡±¥•¹Ð°…Í•%°±¥µ¥Ð€ô€ÄÀÀ¤ì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}•Ù•¹ÑÌœ¤¹Í•±•Ð¡%MAUQ}	Q}Y9Q}M1P¤¹•Ä …Í•}¥œ°…Í•%¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œè™…±Í”ô¤¹±¥µ¥Ð¡±¥µ¥Ð¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€É•ÑÕÉ¸‘…Ñ„ñðmtì)ô()™Õ¹Ñ¥½¸µ¥ÍÍ¥¹I•ÅÕ¥É•‘¥ÍÁÕÑ•½Õµ•¹ÑÌ¡…Ñ¥½¹Ì€ômt°‘½Õµ•¹ÑÌ€ômt¤ì(€½¹ÍÐ…Ñ¥½¹%‘Í]¥Ñ¡½Õµ•¹ÑÌ€ô¹•ÜM•Ð¡‘½Õµ•¹ÑÌ¹µ…À ¡‘½Õµ•¹Ð¤€ôø‘½Õµ•¹Ð¹…Ñ¥½¹}¥¤¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€É•ÑÕÉ¸…Ñ¥½¹Ì¹™¥±Ñ•È ¡…Ñ¥½¸¤€ôø…Ñ¥½¸¹É•ÅÕ¥É•Í}…ÑÑ…¡µ•¹Ð€ôôôÑÉÕ”€˜˜€……Ñ¥½¹%‘Í]¥Ñ¡½Õµ•¹ÑÌ¹¡…Ì¡…Ñ¥½¸¹¥¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸…ÍÍ•ÉÑI•ÅÕ¥É•‘¥ÍÁÕÑ•½Õµ•¹ÑÌ¡±¥•¹Ð°…Ñ¥½¹Ì€ômt¤ì(€½¹ÍÐ…Í•%€ô…Ñ¥½¹ÍlÁtü¹…Í•}¥ì(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Í•%€ü…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡±¥•¹Ð°…Í•%¤€èmtì(€¥˜€ ……Ñ¥½¹Ì¹Í½µ” ¡…Ñ¥½¸¤€ôø…Ñ¥½¸¹É•ÅÕ¥É•Í}…ÑÑ…¡µ•¹Ð€ôôôÑÉÕ”¤¤É•ÑÕÉ¸‘½Õµ•¹ÑÌì(€½¹ÍÐµ¥ÍÍ¥¹œ€ôµ¥ÍÍ¥¹I•ÅÕ¥É•‘¥ÍÁÕÑ•½Õµ•¹ÑÌ¡…Ñ¥½¹Ì°‘½Õµ•¹ÑÌ¤ì(€¥˜€¡µ¥ÍÍ¥¹œ¹±•¹Ñ ¤ì(€€€½¹ÍÐ±…‰•±Ì€ôµ¥ÍÍ¥¹œ¹µ…À ¡…Ñ¥½¸¤€ôø€‘í…Ñ¥½¸¹…Ñ¥½¹}±…‰•°ñð…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ•ô€ ‘í…Ñ¥½¸¹Á…ÉÑå}Í¥‘•ô¥€¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È¡UÁ±½…Ñ¡”É•ÅÕ¥É•‘½Õµ•¹Ð™½Èè€‘í±…‰•±Ì¹©½¥¸ œ°€œ¥ô¹€°€ÐÀÀ¤ì(€ô(€É•ÑÕÉ¸‘½Õµ•¹ÑÌì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Á…Ñ¡¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍ%¹M…±•Í™½É”¡…Í•I½Ü°Í…±•Í™½É•MÑ…ÑÕÌ¤ì(€½¹ÍÐÕÉÉ•¹ÑI½ÝÌ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ¡€(€€€M1P%°¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ°1…ÍÑ5½‘¥™¥•‘…Ñ”(€€€I=4ÍÑ•µ}}Œ(€€€]!I%€ô€œ‘í•Í…Á•M½Å°¡…Í•I½Ü¹ÍÑ•µ}¥¥ôœ(€€€1%5%P€Ä(€€¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ôÕÉÉ•¹ÑI½ÝÍlÁtì(€¥˜€ …ÕÉÉ•¹ÑMÑ•´¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”‘¥ÍÁÕÑ•MQ4¹¼±½¹•È•á¥ÍÑÌ¥¸M…±•Í™½É”¸œ°€ÐÀÐ¤ì((€¥˜€¡¥ÍM…±•Í™½É•¥ÍÁÕÑ•±½Í•¡ÕÉÉ•¹ÑMÑ•´¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ¤¤ì(€€€½¹ÍÐ½¹Ñ¥¹Õ¥¹I•½É‘•‘±½Í”€ô¥ÍM…±•Í™½É•¥ÍÁÕÑ•±½Í•¡Í…±•Í™½É•MÑ…ÑÕÌ¤€˜˜¥ÍM…±•Í™½É•¥ÍÁÕÑ•±½Í•¡…Í•I½Ü¹ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌ¤€˜˜…Í•I½Ü¹Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}ÍÑ…ÑÕÌ€ôôô€ÍÕ•ÍÌœì(€€€¥˜€¡½¹Ñ¥¹Õ¥¹I•½É‘•‘±½Í”¤É•ÑÕÉ¸ì(€€€…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€ô((€½¹ÍÐ¥™U¹µ½‘¥™¥•‘M¥¹”€ôÕÉÉ•¹ÑMÑ•´¹1…ÍÑ5½‘¥™¥•‘…Ñ”€ü¹•Ü…Ñ”¡ÕÉÉ•¹ÑMÑ•´¹1…ÍÑ5½‘¥™¥•‘…Ñ”¤¹Ñ½UQMÑÉ¥¹œ ¤€è¹Õ±°ì(€ÑÉäì(€€€…Ý…¥ÐÍ™I•ÅÕ•ÍÐ¡€½Í½‰©•ÑÌ½ÍÑ•µ}}Œ¼‘í•¹½‘•UI%½µÁ½¹•¹Ð¡…Í•I½Ü¹ÍÑ•µ}¥¥õ€°ì(€€€€€µ•Ñ¡½è€AQ œ°(€€€€€‰½‘äèì¥ÍÁÕÑ•}MÑ…ÑÕÍ}}ŒèÍ…±•Í™½É•MÑ…ÑÕÌô°(€€€€€¡•…‘•ÉÌè¥™U¹µ½‘¥™¥•‘M¥¹”€üì€%˜µU¹µ½‘¥™¥•µM¥¹”œè¥™U¹µ½‘¥™¥•‘M¥¹”ô€èÕ¹‘•™¥¹•°(€€€ô¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹ÍÑ…ÑÕÌ€ôôô€ÐÄÈ¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È M…±•Í™½É”¡…¹•Ý¡¥±”=LÝ…ÌÍ…Ù¥¹œÑ¡¥ÌÝ½É­™±½Ü¸I•™É•Í Ñ¡”¥ÍÁÕÑ”]½É­™±½ÜÅÕ•Õ”…¹ÑÉä……¥¸¸œ°€ÐÀä¤ì(€€€ô(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•½É‘¥ÍÁÕÑ•]½É­™±½ÝM…±•Í™½É•]É¥Ñ•‰…¬¡±¥•¹Ð°…Í•I½Ü°ÁÉ½™¥±”°Í…±•Í™½É•MÑ…ÑÕÌ°ÝÉ¥Ñ•‰…­MÑ…ÑÕÌ€ô€ÍÕ•ÍÌœ°ÝÉ¥Ñ•‰…­ÉÉ½È€ô¹Õ±°¤ì(€½¹ÍÐì‘…Ñ„èÕÁ‘…Ñ•‘…Í”°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌèÝÉ¥Ñ•‰…­MÑ…ÑÕÌ€ôôô€ÍÕ•ÍÌœ€üÍ…±•Í™½É•MÑ…ÑÕÌ€è…Í•I½Ü¹ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌ°(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}ÍÑ…ÑÕÌèÝÉ¥Ñ•‰…­MÑ…ÑÕÌ°(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}•ÉÉ½ÈèÝÉ¥Ñ•‰…­ÉÉ½È°(€€€€€ÕÁ‘…Ñ•‘}…Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€ô¤(€€€€¹•Ä ¥œ°…Í•I½Ü¹¥¤(€€€€¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤(€€€€¹Í¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°€Í…±•Í™½É•}ÝÉ¥Ñ•‰…¬œ°ÁÉ½™¥±”°ì(€€€¹½Ñ”èÝÉ¥Ñ•‰…­MÑ…ÑÕÌ€ôôô€ÍÕ•ÍÌœ€üM…±•Í™½É”‘¥ÍÁÕÑ”ÍÑ…ÑÕÌÕÁ‘…Ñ•Ñ¼€‘íÍ…±•Í™½É•MÑ…ÑÕÍô¹€€èM…±•Í™½É”‘¥ÍÁÕÑ”ÍÑ…ÑÕÌÕÁ‘…Ñ”Ñ¼€‘íÍ…±•Í™½É•MÑ…ÑÕÍô™…¥±•¹€°(€€€µ•Ñ…‘…Ñ„èìÍ…±•Í™½É•MÑ…ÑÕÌ°•ÉÉ½ÈèÝÉ¥Ñ•‰…­ÉÉ½Èô°(€ô¤ì(€É•ÑÕÉ¸ÕÁ‘…Ñ•‘…Í”ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÝÉ¥Ñ•¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍQ½M…±•Í™½É”¡±¥•¹Ð°…Í•I½Ü°ÁÉ½™¥±”°Í…±•Í™½É•MÑ…ÑÕÌ°½ÁÑ¥½¹Ì€ôíô¤ì(€±•ÐÝÉ¥Ñ•‰…­MÑ…ÑÕÌ€ô€ÍÕ•ÍÌœì(€±•ÐÝÉ¥Ñ•‰…­ÉÉ½È€ô¹Õ±°ì(€±•ÐÝÉ¥Ñ•‰…­…¥±ÕÉ”€ô¹Õ±°ì(€ÑÉäì(€€€…Ý…¥ÐÁ…Ñ¡¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍ%¹M…±•Í™½É”¡…Í•I½Ü°Í…±•Í™½É•MÑ…ÑÕÌ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€ÝÉ¥Ñ•‰…­MÑ…ÑÕÌ€ô€™…¥±•œì(€€€ÝÉ¥Ñ•‰…­ÉÉ½È€ô•ÉÉ½È¹µ•ÍÍ…”ì(€€€ÝÉ¥Ñ•‰…­…¥±ÕÉ”€ô•ÉÉ½Èì(€ô(€½¹ÍÐÕÁ‘…Ñ•‘…Í”€ô…Ý…¥ÐÉ•½É‘¥ÍÁÕÑ•]½É­™±½ÝM…±•Í™½É•]É¥Ñ•‰…¬¡±¥•¹Ð°…Í•I½Ü°ÁÉ½™¥±”°Í…±•Í™½É•MÑ…ÑÕÌ°ÝÉ¥Ñ•‰…­MÑ…ÑÕÌ°ÝÉ¥Ñ•‰…­ÉÉ½È¤ì(€¥˜€¡½ÁÑ¥½¹Ì¹É•ÅÕ¥É•€˜˜ÝÉ¥Ñ•‰…­MÑ…ÑÕÌ€ôôô€™…¥±•œ¤ì(€€€¥˜€¡ÝÉ¥Ñ•‰…­…¥±ÕÉ”ü¹ÍÑ…ÑÕÌ¤Ñ¡É½ÜÝÉ¥Ñ•‰…­…¥±ÕÉ”ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È¡M…±•Í™½É”‘¥ÍÁÕÑ”ÍÑ…ÑÕÌ½Õ±¹½Ð‰”ÕÁ‘…Ñ•è€‘íÝÉ¥Ñ•‰…­ÉÉ½Éõ€°€ÔÀÈ¤ì(€ô(€É•ÑÕÉ¸ÕÁ‘…Ñ•‘…Í”ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÕÁÍ•ÉÑ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°ÍÑ•´°•áÑÉ„€ôíô¤ì(€½¹ÍÐ¹½Ý%Í¼€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€½¹ÍÐ…Í•A…å±½…€ôì(€€€€¸¸¹‘¥ÍÁÕÑ•	•Ñ……Í•É½µMÑ•´¡ÍÑ•´¤°(€€€±…Ñ•ÍÑ}¹½Ñ”èMÑÉ¥¹œ¡•áÑÉ„¹±…Ñ•ÍÑ9½Ñ”€üü•áÑÉ„¹±…Ñ•ÍÑ}¹½Ñ”€üü€œœ¤¹ÑÉ¥´ ¤°(€€€ÕÁ‘…Ñ•‘}…Ðè¹½Ý%Í¼°(€ôì(€¥˜€¡•áÑÉ„¹Ý½É­™±½ÝMÑ…ÑÕÌ¤…Í•A…å±½…¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ€ô¹½Éµ…±¥é•¥ÍÁÕÑ•	•Ñ…MÑ…ÑÕÌ¡•áÑÉ„¹Ý½É­™±½ÝMÑ…ÑÕÌ°%MAUQ}	Q}]=I-1=]}MQQUML°€É…™Ðœ¤ì(€¥˜€¡•áÑÉ„¹…ÁÁÉ½Ù…±MÑ…ÑÕÌ¤…Í•A…å±½…¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€ô¹½Éµ…±¥é•¥ÍÁÕÑ•	•Ñ…MÑ…ÑÕÌ¡•áÑÉ„¹…ÁÁÉ½Ù…±MÑ…ÑÕÌ°%MAUQ}	Q}AAI=Y1}MQQUML°€É…™Ðœ¤ì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤¹ÕÁÍ•ÉÐ¡…Í•A…å±½…°ì½¹½¹™±¥Ðè€ÍÑ•µ}¥œô¤¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤¹Í¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€É•ÑÕÉ¸‘…Ñ„ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°…Í•%‘=ÉMÑ•µ%¤ì(€½¹ÍÐÙ…±Õ”€ôMÑÉ¥¹œ¡…Í•%‘=ÉMÑ•µ%ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …Ù…±Õ”¤Ñ¡É½Ü…ÁÁÉÉ½È …Í•%½ÈÍÑ•µ%¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐÅÕ•Éä€ô±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤ì(€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô¥ÍM…±•Í™½É•%¡Ù…±Õ”¤€ü…Ý…¥ÐÅÕ•Éä¹•Ä ÍÑ•µ}¥œ°Ù…±Õ”¤¹µ…å‰•M¥¹±” ¤€è…Ý…¥ÐÅÕ•Éä¹•Ä ¥œ°Ù…±Õ”¤¹µ…å‰•M¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€¥˜€ …‘…Ñ„¤Ñ¡É½Ü…ÁÁÉÉ½È ¥ÍÁÕÑ”]½É­™±½Ü…Í”¹½Ð™½Õ¹¸œ°€ÐÀÐ¤ì(€É•ÑÕÉ¸‘…Ñ„ì)ô()™Õ¹Ñ¥½¸Í•±•Ñ•‘A…ÉÑåI½ÝÍÉ½µ½Õ¹ÑÌ¡É•¥ÍÑÉä°…½Õ¹Ñ%‘Ì€ômt¤ì(€½¹ÍÐÍ•±•Ñ•‘-•åÌ€ô¹•ÜM•Ð¡…½Õ¹Ñ%‘Ì¹µ…À¡‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¤¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€½¹ÍÐ…¹‘¥‘…Ñ•	å-•ä€ô¹•Ü5…À ¡É•¥ÍÑÉäü¹…¹‘¥‘…Ñ•Ìñðmt¤¹µ…À ¡…¹‘¥‘…Ñ”¤€ôøm…¹‘¥‘…Ñ”¹…½Õ¹Ñ-•ä°…¹‘¥‘…Ñ•t¤¤ì(€½¹ÍÐ¥¹Ù…±¥‘-•åÌ€ôl¸¸¹Í•±•Ñ•‘-•åÍt¹™¥±Ñ•È ¡­•ä¤€ôø€……¹‘¥‘…Ñ•	å-•ä¹¡…Ì¡­•ä¤¤ì(€¥˜€¡¥¹Ù…±¥‘-•åÌ¹±•¹Ñ ¤Ñ¡É½Ü…ÁÁÉÉ½È =¹”½Èµ½É”Í•±•Ñ•½Õ¹ÑÌ…É”¹¼±½¹•È•±¥¥‰±”™½ÈÑ¡¥ÌMQ4¸œ°€ÐÀÀ¤ì(€¥˜€ …Í•±•Ñ•‘-•åÌ¹Í¥é”¤Ñ¡É½Ü…ÁÁÉÉ½È M•±•Ð…Ð±•…ÍÐ½¹”‘¥ÍÁÕÑ•½Õ¹Ð‰•™½É”Í…Ù¥¹œ¸œ°€ÐÀÀ¤ì(€É•ÑÕÉ¸l¸¸¹Í•±•Ñ•‘-•åÍt¹µ…À ¡­•ä¤€ôøì(€€€½¹ÍÐ…¹‘¥‘…Ñ”€ô…¹‘¥‘…Ñ•	å-•ä¹•Ð¡­•ä¤ì(€€€É•ÑÕÉ¸ì(€€€€€¥è¹Õ±°°(€€€€€…Í•}¥è¹Õ±°°(€€€€€ÍÑ•µ}¥è¹Õ±°°(€€€€€…½Õ¹Ñ}¥è…¹‘¥‘…Ñ”¹…½Õ¹Ñ%°(€€€€€…½Õ¹Ñ}­•äè…¹‘¥‘…Ñ”¹…½Õ¹Ñ-•ä°(€€€€€…½Õ¹Ñ}¹…µ”è…¹‘¥‘…Ñ”¹¹…µ”°(€€€€€É½±•Ìè…¹‘¥‘…Ñ”¹É½±•Ì°(€€€€€Í½ÕÉ•}ÑåÁ•Ìè…¹‘¥‘…Ñ”¹Í½ÕÉ•QåÁ•Ì°(€€€€€Í½ÕÉ•}É•½É‘}¥‘Ìè…¹‘¥‘…Ñ”¹Í½ÕÉ•I•½É‘%‘Ì°(€€€€€Á…åµ•¹Ñ}Ñ•ÉµÌè…¹‘¥‘…Ñ”¹Á…åµ•¹ÑQ•ÉµÌ°(€€€€€ÁÉ½‘ÕÑÌè…¹‘¥‘…Ñ”¹ÁÉ½‘ÕÑÌ°(€€€€€…¹•±±•‘}Í½ÕÉ•}½¹±äè…¹‘¥‘…Ñ”¹…¹•±±•‘M½ÕÉ•=¹±ä°(€€€ôì(€ô¤ì)ô()™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•MÑ½É•‘¥ÍÁÕÑ•Ñ¥½¹Ì¡…Ñ¥½¹Ì°Á…ÉÑåI½ÝÌ°É•¥ÍÑÉä¤ì(€½¹ÍÐÁ…ÉÑå	å%€ô‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐÍ••¸€ô¹•ÜM•Ð ¤ì(€™½È€¡½¹ÍÐ…Ñ¥½¸½˜…Ñ¥½¹Ìñðmt¤ì(€€€½¹ÍÐÁ…ÉÑä€ôÁ…ÉÑå	å%¹•Ð¡…Ñ¥½¸¹Á…ÉÑå}¥¤ì(€€€¥˜€ …Á…ÉÑä¤Ñ¡É½Ü…ÁÁÉÉ½È¡Ñ¥½¸€‘í…Ñ¥½¸¹…Ñ¥½¹}±…‰•°ñð…Ñ¥½¸¹¥‘ô¡…Ì¹¼Í•±•Ñ•‘¥ÍÁÕÑ•½Õ¹Ð¹€°€ÐÀÀ¤ì(€€€½¹ÍÐ…¹‘¥‘…Ñ”€ô™¥¹‘¥ÍÁÕÑ•A…ÉÑä¡É•¥ÍÑÉä°…Ñ¥½¸¹Á…ÉÑå}Í¥‘”°Á…ÉÑä¹…½Õ¹Ñ}¥¤ì(€€€¥˜€ ……¹‘¥‘…Ñ”¤Ñ¡É½Ü…ÁÁÉÉ½È¡€‘íÁ…ÉÑä¹…½Õ¹Ñ}¹…µ•ô¥Ì¹¼±½¹•È•±¥¥‰±”½¸Ñ¡”€‘í…Ñ¥½¸¹Á…ÉÑå}Í¥‘•ôÍ¥‘”¹€°€ÐÀÀ¤ì(€€€½¹ÍÐ­•ä€ô€‘íÁ…ÉÑä¹…½Õ¹Ñ}­•åôè‘í…Ñ¥½¸¹Á…ÉÑå}Í¥‘•õ€ì(€€€¥˜€¡Í••¸¹¡…Ì¡­•ä¤¤Ñ¡É½Ü…ÁÁÉÉ½È¡=¹±ä½¹”€‘í…Ñ¥½¸¹Á…ÉÑå}Í¥‘•ô…Ñ¥½¸µ…ä‰”…‘‘•™½È€‘íÁ…ÉÑä¹…½Õ¹Ñ}¹…µ•ô¹€°€ÐÀÀ¤ì(€€€Í••¸¹…‘¡­•ä¤ì(€ô(€É•ÑÕÉ¸…Ñ¥½¹Ìñðmtì)ô()™Õ¹Ñ¥½¸ÍÕÁÁ±¥•ÉÑ¥½¹Í5¥ÍÍ¥¹¥ÍÁÕÑ•µ½Õ¹Ð¡…Ñ¥½¹Ì€ômt¤ì(€É•ÑÕÉ¸…Ñ¥½¹Ì¹™¥±Ñ•È ¡…Ñ¥½¸¤€ôø…Ñ¥½¸¹Á…ÉÑå}Í¥‘”€ôôô€ÍÕÁÁ±¥•Èœ€˜˜%MAUQ}1e}MUAA1%I}%99%1}Q%=9L¹¡…Ì¡…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”¤€˜˜…Ñ¥½¸¹…µ½Õ¹Ð€ôô¹Õ±°¤ì)ô()™Õ¹Ñ¥½¸…ÍÍ•ÉÑMÕÁÁ±¥•É¥ÍÁÕÑ•µ½Õ¹ÑÌ¡…Ñ¥½¹Ì€ômt¤ì(€½¹ÍÐµ¥ÍÍ¥¹œ€ôÍÕÁÁ±¥•ÉÑ¥½¹Í5¥ÍÍ¥¹¥ÍÁÕÑ•µ½Õ¹Ð¡…Ñ¥½¹Ì¤ì(€¥˜€¡µ¥ÍÍ¥¹œ¹±•¹Ñ ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•È‘¥ÍÁÕÑ”…µ½Õ¹ÐÉ•ÅÕ¥É•¸I•½ÉÑ¡”…É••…µ½Õ¹Ð‰•™½É”Ñ¡¥Ì±•…äÝ½É­™±½Ü…¸ÁÉ½É•ÍÌ¸œ°€ÐÀä¤ì(€ô(€½¹ÍÐ±•…ä€ô…Ñ¥½¹Ì¹™¥±Ñ•È ¡…Ñ¥½¸¤€ôø…Ñ¥½¸¹Á…ÉÑå}Í¥‘”€ôôô€ÍÕÁÁ±¥•Èœ€˜˜%MAUQ}1e}MUAA1%I}%99%1}Q%=9L¹¡…Ì¡…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”¤¤ì(€¥˜€¡±•…ä¹±•¹Ñ ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È ½¹Ù•ÉÐ•… ±•…äÍÕÁÁ±¥•È…Ñ¥½¸¥¹Ñ¼¥¹Ù½¥”µ±•Ù•°¥¹…¹”¥¹ÍÑÉÕÑ¥½¹Ì‰•™½É”Ñ¡¥ÌÝ½É­™±½Ü…¸ÁÉ½É•ÍÌ¸œ°€ÐÀä¤ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•	•Ñ…1¥ÍÐ¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ±¥µ¥Ð€ô‰½‘ä¹±¥µ¥Ðñð€ÄÀÀÀÀì(€½¹ÍÐ…¡•€ô…Ý…¥Ð…¡•‘M…±•Í™½É•Y…±Õ”¡ì(€€€¹…µ•ÍÁ…”è€Í…±•Í™½É”µ‘¥ÍÁÕÑ”µÅÕ•Õ”œ°(€€€ÑÑ±M•½¹‘Ìè€ÌÀ°(€€€Á…å±½…èì±¥µ¥Ðô°(€€€Ñ…ÌèlÍ…±•Í™½É”é‘¥ÍÁÕÑ•Ìœ°€Í…±•Í™½É”éÍÑ•´œ°€Í…±•Í™½É”é…½Õ¹Ðt°(€€€‰½‘ä°(€€€É•Ä°(€€€…•ÍÍ½¹Ñ•áÐè…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô°(€€€±½…‘•Èè€ ¤€ôøÍ…±•Í™½É•¥ÍÁÕÑ•MÑ•µÌ¡ì±¥µ¥Ðô°¹Õ±°°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤°(€ô¤ì(€½¹ÍÐÍ…±•Í™½É•…Ñ„€ô…¡•¹Ù…±Õ”ì(€½¹ÍÐÉ½ÝÌ€ôÍ…±•Í™½É•…Ñ„¹É½ÝÌñðmtì(€±•ÐmÝ½É­™±½Ý5…À°…Á…‰¥±¥Ñ¥•Ít€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€±½…‘¥ÍÁÕÑ•	•Ñ…]½É­™±½Ý5…À (€€€€€±¥•¹Ð°(€€€€€É½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹%¤°(€€€€¤°(€€€‘¥ÍÁÕÑ•]½É­™±½Ý…Á…‰¥±¥Ñ¥•Ì¡±¥•¹Ð°ÁÉ½™¥±”¤°(€t¤ì(€±•ÐÉ•½¹¥±•€ô™…±Í”ì(€½¹ÍÐÉ•½¹¥±¥…Ñ¥½¹ÉÉ½ÉÌ€ô¹•Ü5…À ¤ì(€™½È€¡½¹ÍÐÍÑ•´½˜É½ÝÌ¤ì(€€€½¹ÍÐÝ½É­™±½Ü€ôÝ½É­™±½Ý5…ÁmÍÑ•´¹%‘tì(€€€¥˜€¡Ý½É­™±½Üü¹…Í”ü¹…ÁÁÉ½Ù…±MÑ…ÑÕÌ€„ôô€ÁÁÉ½Ù•œñðÝ½É­™±½Ü¹…Í”¹Ý½É­™±½ÝMÑ…ÑÕÌ€ôôô€±½Í•œñð€…Ý½É­™±½Ü¹…Ñ¥½¹Ì¹Í½µ” ¡…Ñ¥½¸¤€ôø…Ñ¥½¸¹…Ñ¥½¹QåÁ”€ôôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ¤ñð€…ÍÑ•´¹}MÕÁÁ±¥•É}M•ÑÑ±•µ•¹Ñ}M¡•µ„ü¹Ù…±¥¤½¹Ñ¥¹Õ”ì(€€€ÑÉäì(€€€€€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°Ý½É­™±½Ü¹…Í”¹¥¤ì(€€€€€½¹ÍÐÍÑ½É•€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÉ•½¹¥±•ÁÁÉ½Ù•‘MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü°ÍÑ½É•¹Á…ÉÑåI½ÝÌ°ÍÑ½É•¹…Ñ¥½¹I½ÝÌ°ÍÑ½É•¹¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÍÑ•´°ÁÉ½™¥±”¤ì(€€€€€É•½¹¥±•€ôÉ•½¹¥±•ñðÉ•ÍÕ±Ð¹¡…¹•ñðÉ•ÍÕ±Ð¹ÝÉ¥Ñ•‰…­I•ÑÉ¥•ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€½¹Í½±”¹•ÉÉ½È m‘¥ÍÁÕÑ”µÝ½É­™±½ÝtÍÕÁÁ±¥•ÈÉ•½¹¥±¥…Ñ¥½¸™…¥±•œ°ì(€€€€€€€É•ÅÕ•ÍÑ%èÉ•ÅÕ•ÍÑ%‘É½´¡É•Ä¤°(€€€€€€€½‘”è•ÉÉ½Èü¹½‘”ñð¹Õ±°°(€€€€€ô¤ì(€€€€€É•½¹¥±¥…Ñ¥½¹ÉÉ½ÉÌ¹Í•Ð¡ÍÑ•´¹%°€MÕÁÁ±¥•ÈÁ…åµ•¹ÐÉ•½¹¥±¥…Ñ¥½¸¥ÌÑ•µÁ½É…É¥±äÕ¹…Ù…¥±…‰±”¸¥¹…¹”…½Õ¹Ñ¥¹œÉ•µ…¥¹ÌÕ¹¡…¹•¸œ¤ì(€€€ô(€ô(€¥˜€¡É•½¹¥±•¤ì(€€€Ý½É­™±½Ý5…À€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•	•Ñ…]½É­™±½Ý5…À (€€€€€±¥•¹Ð°(€€€€€É½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹%¤°(€€€€¤ì(€ô(€™½È€¡½¹ÍÐmÍÑ•µ%°•ÉÉ½Ét½˜É•½¹¥±¥…Ñ¥½¹ÉÉ½ÉÌ¤ì(€€€¥˜€¡Ý½É­™±½Ý5…ÁmÍÑ•µ%‘t¤Ý½É­™±½Ý5…ÁmÍÑ•µ%‘t¹É•½¹¥±¥…Ñ¥½¹ÉÉ½È€ô•ÉÉ½Èì(€ô(€ÁÉ½©•ÑáÑ•É¹…±±å±½Í•‘¥ÍÁÕÑ•]½É­™±½ÝÌ¡É½ÝÌ°Ý½É­™±½Ý5…À¤ì(€É•ÑÕÉ¸ì(€€€¥Í¥ÍÁÕÑ•‘µ¥¸è…Á…‰¥±¥Ñ¥•Ì¹…¹ÁÁÉ½Ù”°(€€€¥Í¥ÍÁÕÑ•½Õ¹Ñ¥¹œè…Á…‰¥±¥Ñ¥•Ì¹…¹½Õ¹Ð°(€€€…Á…‰¥±¥Ñ¥•Ì°(€€€É•ÅÕ¥É•‘M…±•Í™½É•¥•±‘Í5¥ÍÍ¥¹œèÑÉÕ”°(€€€™¥•±‘]…É¹¥¹œè€¥ÍÁÕÑ•½Õ¹ÑÌ°…ÁÁÉ½Ù…°°…½Õ¹Ñ¥¹œ°‘½Õµ•¹ÑÌ°…¹…Õ‘¥ÐÍÑ…Ñ”…É”ÍÑ½É•¥¸MÕÁ…‰…Í”¸M…±•Í™½É”É••¥Ù•Ì½¹±äÑ¡”¡¥ µ±•Ù•°MQ4¥ÍÁÕÑ”MÑ…ÑÕÌ¸œ°(€€€É½ÝÌèÉ½ÝÌ¹µ…À ¡É½Ü¤€ôøì(€€€€€½¹ÍÐÝ½É­™±½Ü€ôÝ½É­™±½Ý5…ÁmÉ½Ü¹%‘tñðì(€€€€€€€…Í”è¹Õ±°°(€€€€€€€Á…ÉÑ¥•Ìèmt°(€€€€€€€…Ñ¥½¹Ìèmt°(€€€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìèmt°(€€€€€€€•Ù•¹ÑÌèmt°(€€€€€€€‘½Õµ•¹ÑÌèmt°(€€€€€ôì(€€€€€¥˜€ …Ý½É­™±½Ü¹…Í”¤Ý½É­™±½Ü¹…Í”€ô±•…å±½Í•‘¥ÍÁÕÑ•…Í”¡É½Ü¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹É½Ü°(€€€€€€€}¥ÍÁÕÑ•}A…ÉÑ¥•Ìè‘¥ÍÁÕÑ•I•¥ÍÑÉå]¥Ñ¡M•±•Ñ¥½¸¡É½Ü¹}¥ÍÁÕÑ•}A…ÉÑ¥•Ì°Ý½É­™±½Ü¹Á…ÉÑ¥•Ì¤°(€€€€€€€}¥ÍÁÕÑ•}]½É­™±½ÜèÝ½É­™±½Ü°(€€€€€ôì(€€€ô¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•	•Ñ…M…Ù•É…™Ð¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐÍÑ•´€ô‰½‘ä¹ÍÑ•´ñðíôì(€½¹ÍÐÍÑ•µ%€ôÍÑ•´¹%ñð‰½‘ä¹ÍÑ•µ%ì(€¥˜€ …ÍÑ•µ%¤Ñ¡É½Ü…ÁÁÉÉ½È ÍÑ•µ%¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐmÕÉÉ•¹ÑMÑ•´°•á¥ÍÑ¥¹…Í•I•ÍÕ±Ñt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡m±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡ÍÑ•µ%°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤°±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤¹•Ä ÍÑ•µ}¥œ°ÍÑ•µ%¤¹µ…å‰•M¥¹±” ¥t¤ì(€…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€½¹ÍÐ…¹‘¥‘…Ñ•I•¥ÍÑÉä€ôÕÉÉ•¹ÑMÑ•´¹}¥ÍÁÕÑ•}A…ÉÑ¥•Ìì(€¥˜€ ……¹‘¥‘…Ñ•I•¥ÍÑÉäü¹…¹‘¥‘…Ñ•M¡•µ…Y…±¥¤ì(€€€½¹ÍÐµ•ÍÍ…•Ì€ô€¡…¹‘¥‘…Ñ•I•¥ÍÑÉäü¹¥ÍÍÕ•Ìñðmt¤¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹µ•ÍÍ…”¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È¡½ÉÉ•ÐÑ¡”M…±•Í™½É”½Õ¹ÐÍ½ÕÉ•Ì‰•™½É”½¹Ñ¥¹Õ¥¹œè€‘íµ•ÍÍ…•Ì¹©½¥¸ œ€œ¥õ€°€ÐÀÀ¤ì(€ô(€¥˜€¡•á¥ÍÑ¥¹…Í•I•ÍÕ±Ð¹•ÉÉ½È¤Ñ¡É½Ü•á¥ÍÑ¥¹…Í•I•ÍÕ±Ð¹•ÉÉ½Èì(€½¹ÍÐ•á¥ÍÑ¥¹…Í”€ô•á¥ÍÑ¥¹…Í•I•ÍÕ±Ð¹‘…Ñ„ì(€¥˜€¡•á¥ÍÑ¥¹…Í”€˜˜€…lÉ…™Ðœ°€I•©•Ñ•œ°€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•t¹¥¹±Õ‘•Ì¡•á¥ÍÑ¥¹…Í”¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È QÉ…‘•È¥¹ÍÑÉÕÑ¥½¹Ì…É”±½­•…™Ñ•ÈÍÕ‰µ¥ÍÍ¥½¸¸I•ÅÕ•ÍÐ„É•Ù¥Í¥½¸‰•™½É”•‘¥Ñ¥¹œÑ¡•´¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐÍ•±•Ñ•‘A…ÉÑåI½ÝÌ€ôÍ•±•Ñ•‘A…ÉÑåI½ÝÍÉ½µ½Õ¹ÑÌ¡…¹‘¥‘…Ñ•I•¥ÍÑÉä°‰½‘ä¹Í•±•Ñ•‘A…ÉÑå½Õ¹Ñ%‘Ìñðmt¤ì(€¥˜€¡•á¥ÍÑ¥¹…Í”¤ì(€€€½¹ÍÐÍ•±•Ñ•‘½Õ¹Ñ-•åÌ€ô¹•ÜM•Ð¡Í•±•Ñ•‘A…ÉÑåI½ÝÌ¹µ…À ¡Á…ÉÑä¤€ôøÁ…ÉÑä¹…½Õ¹Ñ}­•ä¤¤ì(€€€½¹ÍÐmÍÑ½É•‘A…ÉÑ¥•ÍI•ÍÕ±Ð°ÍÑ½É•‘½Õµ•¹ÑÍI•ÍÕ±Ñt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡m±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}Á…ÉÑ¥•Ìœ¤¹Í•±•Ð ¥±…½Õ¹Ñ}­•ä±…½Õ¹Ñ}¹…µ”œ¤¹•Ä …Í•}¥œ°•á¥ÍÑ¥¹…Í”¹¥¤°±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}‘½Õµ•¹ÑÌœ¤¹Í•±•Ð Á…ÉÑå}¥œ¤¹•Ä …Í•}¥œ°•á¥ÍÑ¥¹…Í”¹¥¥t¤ì(€€€¥˜€¡ÍÑ½É•‘A…ÉÑ¥•ÍI•ÍÕ±Ð¹•ÉÉ½È¤Ñ¡É½ÜÍÑ½É•‘A…ÉÑ¥•ÍI•ÍÕ±Ð¹•ÉÉ½Èì(€€€¥˜€¡ÍÑ½É•‘½Õµ•¹ÑÍI•ÍÕ±Ð¹•ÉÉ½È¤Ñ¡É½ÜÍÑ½É•‘½Õµ•¹ÑÍI•ÍÕ±Ð¹•ÉÉ½Èì(€€€½¹ÍÐ‘½Õµ•¹Ñ•‘A…ÉÑå%‘Ì€ô¹•ÜM•Ð ¡ÍÑ½É•‘½Õµ•¹ÑÍI•ÍÕ±Ð¹‘…Ñ„ñðmt¤¹µ…À ¡‘½Õµ•¹Ð¤€ôø‘½Õµ•¹Ð¹Á…ÉÑå}¥¤¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€€€½¹ÍÐ‘½Õµ•¹Ñ•‘I•µ½Ù•‘A…ÉÑ¥•Ì€ô€¡ÍÑ½É•‘A…ÉÑ¥•ÍI•ÍÕ±Ð¹‘…Ñ„ñðmt¤¹™¥±Ñ•È ¡Á…ÉÑä¤€ôø€…Í•±•Ñ•‘½Õ¹Ñ-•åÌ¹¡…Ì¡Á…ÉÑä¹…½Õ¹Ñ}­•ä¤€˜˜‘½Õµ•¹Ñ•‘A…ÉÑå%‘Ì¹¡…Ì¡Á…ÉÑä¹¥¤¤ì(€€€¥˜€¡‘½Õµ•¹Ñ•‘I•µ½Ù•‘A…ÉÑ¥•Ì¹±•¹Ñ ¤ì(€€€€€½¹ÍÐ¹…µ•Ì€ô‘½Õµ•¹Ñ•‘I•µ½Ù•‘A…ÉÑ¥•Ì¹µ…À ¡Á…ÉÑä¤€ôøÁ…ÉÑä¹…½Õ¹Ñ}¹…µ”ñðÁ…ÉÑä¹…½Õ¹Ñ}­•ä¤¹©½¥¸ œ°€œ¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È¡-••À€‘í¹…µ•ÍôÍ•±•Ñ•‰•…ÕÍ”‘¥ÍÁÕÑ”‘½Õµ•¹ÑÌ…É”…±É•…‘ä±¥¹­•Ñ¼Ñ¡”½Õ¹Ð¹€°€ÐÀÀ¤ì(€€€ô(€ô(€½¹ÍÐÉ•¥ÍÑÉä€ô‘¥ÍÁÕÑ•I•¥ÍÑÉå]¥Ñ¡M•±•Ñ¥½¸¡…¹‘¥‘…Ñ•I•¥ÍÑÉä°Í•±•Ñ•‘A…ÉÑåI½ÝÌ¤ì(€½¹ÍÐ…Í•%¹ÁÕÐ€ôì¥è•á¥ÍÑ¥¹…Í”ü¹¥ñð¹Õ±°°ÍÑ•µ}¥èÍÑ•µ%ôì(€½¹ÍÐ¹½Éµ…±¥é•‘Ñ¥½¹Ì€ô€¡‰½‘ä¹…Ñ¥½¹Ìñðmt¤¹µ…À ¡…Ñ¥½¸¤€ôø(€€€ÁÉ•Á…É•MÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑÑ¥½¸ (€€€€€ì(€€€€€€€¥èMÑÉ¥¹œ¡…Ñ¥½¸¹¥ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°°(€€€€€€€€¸¸¹¹½Éµ…±¥é•¥ÍÁÕÑ•	•Ñ…Ñ¥½¸¡…Ñ¥½¸°…Í•%¹ÁÕÐ°ÁÉ½™¥±”°É•¥ÍÑÉä¤°(€€€€€ô°(€€€€€ÕÉÉ•¹ÑMÑ•´°(€€€€¤°(€€¤ì(€½¹ÍÐÍ••¹Ñ¥½¹M¥‘•Ì€ô¹•ÜM•Ð ¤ì(€™½È€¡½¹ÍÐ…Ñ¥½¸½˜¹½Éµ…±¥é•‘Ñ¥½¹Ì¤ì(€€€½¹ÍÐ­•ä€ô€‘í…Ñ¥½¸¹Á…ÉÑå}…½Õ¹Ñ}­•åôè‘í…Ñ¥½¸¹Á…ÉÑå}Í¥‘•õ€ì(€€€¥˜€¡Í••¹Ñ¥½¹M¥‘•Ì¹¡…Ì¡­•ä¤¤Ñ¡É½Ü…ÁÁÉÉ½È =¹±ä½¹”…Ñ¥½¸Á•ÈÍ•±•Ñ•½Õ¹ÐÍ¥‘”¥Ì…±±½Ý•¸œ°€ÐÀÀ¤ì(€€€Í••¹Ñ¥½¹M¥‘•Ì¹…‘¡­•ä¤ì(€ô(€½¹ÍÐ™¥¹…¹¥…±Ì€ô…±Õ±…Ñ•¥ÍÁÕÑ•	•Ñ…M•ÑÑ±•µ•¹Ð¡¹½Éµ…±¥é•‘Ñ¥½¹Ì¤ì(€…Ý…¥ÐÁ…Ñ¡¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍ%¹M…±•Í™½É”¡•á¥ÍÑ¥¹…Í”ñðìÍÑ•µ}¥èÍÑ•µ%ô°€=Á•¸€´QÉ…‘•ÈI•Ù¥•Üœ¤ì(€½¹ÍÐ…Í•A…å±½…€ôì(€€€€¸¸¹‘¥ÍÁÕÑ•	•Ñ……Í•É½µMÑ•´¡ÕÉÉ•¹ÑMÑ•´¤°(€€€ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌè€=Á•¸€´QÉ…‘•ÈI•Ù¥•Üœ°(€€€Ý½É­™±½Ý}ÍÑ…ÑÕÌè€É…™Ðœ°(€€€…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌè€É…™Ðœ°(€€€±…Ñ•ÍÑ}¹½Ñ”èMÑÉ¥¹œ¡‰½‘ä¹±…Ñ•ÍÑ9½Ñ”ñð€œœ¤¹ÑÉ¥´ ¤°(€€€Í•ÑÑ±•µ•¹Ñ}™¥¹…¹¥…±Ìè™¥¹…¹¥…±Ì°(€€€Í•ÑÑ±•µ•¹Ñ}Á¹°è™¥¹…¹¥…±Ì¹Í•ÑÑ±•µ•¹ÑA¹°°(€ôì(€½¹ÍÐì‘…Ñ„èÍ…Ù•‘…Í•%°•ÉÉ½ÈèÍ…Ù•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹ÉÁŒ Í…Ù•}‘¥ÍÁÕÑ•}Ý½É­™±½Ý}‘É…™Ðœ°ì(€€€Á}…Í”è…Í•A…å±½…°(€€€Á}Á…ÉÑ¥•ÌèÍ•±•Ñ•‘A…ÉÑåI½ÝÌ¹µ…À ¡Á…ÉÑä¤€ôø€¡ì(€€€€€…½Õ¹Ñ}¥èÁ…ÉÑä¹…½Õ¹Ñ}¥°(€€€€€…½Õ¹Ñ}­•äèÁ…ÉÑä¹…½Õ¹Ñ}­•ä°(€€€€€…½Õ¹Ñ}¹…µ”èÁ…ÉÑä¹…½Õ¹Ñ}¹…µ”°(€€€€€É½±•ÌèÁ…ÉÑä¹É½±•Ì°(€€€€€Í½ÕÉ•}ÑåÁ•ÌèÁ…ÉÑä¹Í½ÕÉ•}ÑåÁ•Ì°(€€€€€Í½ÕÉ•}É•½É‘}¥‘ÌèÁ…ÉÑä¹Í½ÕÉ•}É•½É‘}¥‘Ì°(€€€€€Á…åµ•¹Ñ}Ñ•ÉµÌèÁ…ÉÑä¹Á…åµ•¹Ñ}Ñ•ÉµÌ°(€€€€€ÁÉ½‘ÕÑÌèÁ…ÉÑä¹ÁÉ½‘ÕÑÌ°(€€€€€…¹•±±•‘}Í½ÕÉ•}½¹±äèÁ…ÉÑä¹…¹•±±•‘}Í½ÕÉ•}½¹±ä°(€€€ô¤¤°(€€€Á}…Ñ¥½¹Ìè¹½Éµ…±¥é•‘Ñ¥½¹Ì°(€€€Á}…Ñ½Èèì¥èÁÉ½™¥±”¹¥°•µ…¥°èÁÉ½™¥±”¹•µ…¥°ô°(€€€Á}•Ù•¹Ñ}¹½Ñ”è‰½‘ä¹±…Ñ•ÍÑ9½Ñ”ñð€É…™ÐÍ…Ù•¸œ°(€ô¤ì(€¥˜€¡Í…Ù•ÉÉ½È¤Ñ¡É½ÜÍ…Ù•ÉÉ½Èì(€½¹ÍÐÕÁ‘…Ñ•‘…Í”€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°Í…Ù•‘…Í•%ñðÍÑ•µ%¤ì(€…Ý…¥Ð±•…É%¹Ù…±¥‘¥ÍÁÕÑ•½µÁ•¹Í…Ñ¥½¹1¥¹­Ì¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°ÁÉ½™¥±”¤ì(€½¹ÍÐÝ½É­™±½ÝAÉ½µ¥Í”€ô±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”¹¥¤ì(€½¹ÍÐ‘½Õµ•¹ÑÍAÉ½µ¥Í”€ô±½…‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”¹¥¤ì(€½¹ÍÐÍÑ…ÑÕÍAÉ½µ¥Í”€ôÉ•½É‘¥ÍÁÕÑ•]½É­™±½ÝM…±•Í™½É•]É¥Ñ•‰…¬¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°ÁÉ½™¥±”°€=Á•¸€´QÉ…‘•ÈI•Ù¥•Üœ¤ì(€½¹ÍÐmìÁ…ÉÑåI½ÝÌ°…Ñ¥½¹Ì°ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìô°‘½Õµ•¹ÑÌ°ÍÑ…ÑÕÍ…Í•t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡mÝ½É­™±½ÝAÉ½µ¥Í”°‘½Õµ•¹ÑÍAÉ½µ¥Í”°ÍÑ…ÑÕÍAÉ½µ¥Í•t¤ì(€½¹ÍÐ•Ù•¹ÑÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÙ•¹ÑÌ¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”¹¥¤ì(€É•ÑÕÉ¸ì(€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡ÍÑ…ÑÕÍ…Í”¤°(€€€Á…ÉÑ¥•ÌèÁ…ÉÑåI½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¤°(€€€…Ñ¥½¹Ì°(€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì°(€€€•Ù•¹ÑÌè•Ù•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¤°(€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•	•Ñ…MÕ‰µ¥ÑÁÁÉ½Ù…°¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°‰½‘ä¹…Í•%ñð‰½‘ä¹ÍÑ•µ%¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ô…Ý…¥Ð±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€½¹ÍÐìÁ…ÉÑåI½ÝÌ°…Ñ¥½¹I½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°…Ñ¥½¹ÌèÍ•É¥…±¥é•‘Ñ¥½¹Ìô€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÉ•¥ÍÑÉä€ô…ÍÍ•ÉÑY…±¥‘¥ÍÁÕÑ•A…ÉÑ¥•Ì¡ÕÉÉ•¹ÑMÑ•´°Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐ…Ñ¥½¹Ì€ôÙ…±¥‘…Ñ•MÑ½É•‘¥ÍÁÕÑ•Ñ¥½¹Ì¡…Ñ¥½¹I½ÝÌ°Á…ÉÑåI½ÝÌ°É•¥ÍÑÉä¤ì(€¥˜€ ……Ñ¥½¹Ìü¹±•¹Ñ ¤Ñ¡É½Ü…ÁÁÉÉ½È ‘…Ð±•…ÍÐ½¹”ÑÉ…‘•È…Ñ¥½¸‰•™½É”ÍÕ‰µ¥ÑÑ¥¹œ™½È…ÁÁÉ½Ù…°¸œ°€ÐÀÀ¤ì(€…ÍÍ•ÉÑMÕÁÁ±¥•É¥ÍÁÕÑ•µ½Õ¹ÑÌ¡…Ñ¥½¹Ì¤ì(€…ÍÍ•ÉÑMÕÁÁ±¥•É±±½…Ñ¥½¹ÍÕÉÉ•¹Ð¡…Ñ¥½¹Ì°Á…ÉÑåI½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´¤ì(€¥˜€ …lÉ…™Ðœ°€I•©•Ñ•œ°€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•t¹¥¹±Õ‘•Ì¡…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È =¹±ä‘É…™Ð°É•©•Ñ•°½ÈÉ•Ù¥Í¥½¸µÉ•ÅÕ•ÍÑ•…Í•Ì…¸‰”ÍÕ‰µ¥ÑÑ•¸œ°€ÐÀÀ¤ì(€ô(€…Ý…¥Ð…ÍÍ•ÉÑI•ÅÕ¥É•‘¥ÍÁÕÑ•½Õµ•¹ÑÌ¡±¥•¹Ð°…Ñ¥½¹Ì¤ì(€…Ý…¥ÐÁ…Ñ¡¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍ%¹M…±•Í™½É”¡…Í•I½Ü°€A•¹‘¥¹œÁÁÉ½Ù…°œ¤ì(€½¹ÍÐ¹½Ý%Í¼€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€½¹ÍÐì‘…Ñ„èÕÁ‘…Ñ•‘…Í”°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€Ý½É­™±½Ý}ÍÑ…ÑÕÌè€A•¹‘¥¹œÁÁÉ½Ù…°œ°(€€€€€…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌè€A•¹‘¥¹œÁÁÉ½Ù…°œ°(€€€€€ÍÕ‰µ¥ÑÑ•‘}‰äèÁÉ½™¥±”¹¥°(€€€€€ÍÕ‰µ¥ÑÑ•‘}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€€€ÍÕ‰µ¥ÑÑ•‘}…Ðè¹½Ý%Í¼°(€€€€€±…Ñ•ÍÑ}¹½Ñ”èMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ”ñð…Í•I½Ü¹±…Ñ•ÍÑ}¹½Ñ”ñð€œœ¤¹ÑÉ¥´ ¤°(€€€€€ÕÁ‘…Ñ•‘}…Ðè¹½Ý%Í¼°(€€€ô¤(€€€€¹•Ä ¥œ°…Í•I½Ü¹¥¤(€€€€¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤(€€€€¹Í¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°€ÍÕ‰µ¥ÑÑ•œ°ÁÉ½™¥±”°ì(€€€¹½Ñ”è‰½‘ä¹¹½Ñ”ñð€MÕ‰µ¥ÑÑ•™½È‘¥ÍÁÕÑ”…‘µ¥¹¥ÍÑÉ…Ñ½È…ÁÁÉ½Ù…°¸œ°(€ô¤ì(€½¹ÍÐÍÑ…ÑÕÍ…Í”€ô…Ý…¥ÐÉ•½É‘¥ÍÁÕÑ•]½É­™±½ÝM…±•Í™½É•]É¥Ñ•‰…¬¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°ÁÉ½™¥±”°€A•¹‘¥¹œÁÁÉ½Ù…°œ¤ì(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€É•ÑÕÉ¸ì(€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡ÍÑ…ÑÕÍ…Í”¤°(€€€Á…ÉÑ¥•ÌèÁ…ÉÑåI½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¤°(€€€…Ñ¥½¹ÌèÍ•É¥…±¥é•‘Ñ¥½¹Ì°(€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•	•Ñ…ÁÁÉ½Ù”¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…ÁÁÉ½Ù”œ°€¥ÍÁÕÑ”…ÁÁÉ½Ù…°Á•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÌ¤ì(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°‰½‘ä¹…Í•%ñð‰½‘ä¹ÍÑ•µ%¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€¥˜€¡…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€„ôô€A•¹‘¥¹œÁÁÉ½Ù…°œ¤Ñ¡É½Ü…ÁÁÉÉ½È =¹±äÁ•¹‘¥¹œ¥ÍÁÕÑ”]½É­™±½Ü…Í•Ì…¸‰”…ÁÁÉ½Ù•¸œ°€ÐÀÀ¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ô…Ý…¥Ð±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€½¹ÍÐìÁ…ÉÑåI½ÝÌ°…Ñ¥½¹I½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌô€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÉ•¥ÍÑÉä€ô…ÍÍ•ÉÑY…±¥‘¥ÍÁÕÑ•A…ÉÑ¥•Ì¡ÕÉÉ•¹ÑMÑ•´°Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐ…Ñ¥½¹Ì€ôÙ…±¥‘…Ñ•MÑ½É•‘¥ÍÁÕÑ•Ñ¥½¹Ì¡…Ñ¥½¹I½ÝÌ°Á…ÉÑåI½ÝÌ°É•¥ÍÑÉä¤ì(€…ÍÍ•ÉÑMÕÁÁ±¥•É¥ÍÁÕÑ•µ½Õ¹ÑÌ¡…Ñ¥½¹Ì¤ì(€…ÍÍ•ÉÑMÕÁÁ±¥•É±±½…Ñ¥½¹ÍÕÉÉ•¹Ð¡…Ñ¥½¹Ì°Á…ÉÑåI½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´¤ì(€…Ý…¥Ð…ÍÍ•ÉÑI•ÅÕ¥É•‘¥ÍÁÕÑ•½Õµ•¹ÑÌ¡±¥•¹Ð°…Ñ¥½¹Ìñðmt¤ì(€½¹ÍÐÍ…±•Í™½É•MÑ…ÑÕÌ€ô€ÁÁÉ½Ù•€´A•¹‘¥¹œ½Õ¹Ñ¥¹œœì(€½¹ÍÐì•ÉÉ½ÈèÁ•¹‘¥¹ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}ÍÑ…ÑÕÌè€¹½Ñ}ÍÑ…ÉÑ•œ°(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}•ÉÉ½Èè¹Õ±°°(€€€€€ÕÁ‘…Ñ•‘}…Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€ô¤(€€€€¹•Ä ¥œ°…Í•I½Ü¹¥¤ì(€¥˜€¡Á•¹‘¥¹ÉÉ½È¤Ñ¡É½ÜÁ•¹‘¥¹ÉÉ½Èì(€ÑÉäì(€€€…Ý…¥ÐÁ…Ñ¡¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍ%¹M…±•Í™½É”¡…Í•I½Ü°Í…±•Í™½É•MÑ…ÑÕÌ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€…Ý…¥ÐÉ•½É‘¥ÍÁÕÑ•]½É­™±½ÝM…±•Í™½É•]É¥Ñ•‰…¬¡±¥•¹Ð°…Í•I½Ü°ÁÉ½™¥±”°Í…±•Í™½É•MÑ…ÑÕÌ°€™…¥±•œ°•ÉÉ½È¹µ•ÍÍ…”¤ì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô(€½¹ÍÐì•ÉÉ½Èè…ÁÁÉ½Ù…±ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹ÉÁŒ …ÁÁÉ½Ù•}‘¥ÍÁÕÑ•}Ý½É­™±½Ý}…Í”œ°ì(€€€Á}…Í•}¥è…Í•I½Ü¹¥°(€€€Á}…Ñ½Èèì¥èÁÉ½™¥±”¹¥°•µ…¥°èÁÉ½™¥±”¹•µ…¥°ô°(€€€Á}¹½Ñ”è‰½‘ä¹¹½Ñ”ñð€ÁÁÉ½Ù•‰ä‘¥ÍÁÕÑ”…‘µ¥¹¥ÍÑÉ…Ñ½È¸œ°(€€€Á}Í…±•Í™½É•}ÍÑ…ÑÕÌèÍ…±•Í™½É•MÑ…ÑÕÌ°(€ô¤ì(€¥˜€¡…ÁÁÉ½Ù…±ÉÉ½È¤Ñ¡É½Ü…ÁÁÉ½Ù…±ÉÉ½Èì(€±•ÐÕÁ‘…Ñ•‘…Í”€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€¥˜€¡ÕÁ‘…Ñ•‘…Í”¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ€„ôôÍ…±•Í™½É•MÑ…ÑÕÌ¤ì(€€€ÕÁ‘…Ñ•‘…Í”€ô…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍQ½M…±•Í™½É”¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°ÁÉ½™¥±”°ÕÁ‘…Ñ•‘…Í”¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ¤ì(€ô(€½¹ÍÐ…½Õ¹Ñ¥¹MÑ…Ñ”€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€É•ÑÕÉ¸ì(€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡ÕÁ‘…Ñ•‘…Í”¤°(€€€Á…ÉÑ¥•ÌèÁ…ÉÑåI½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¤°(€€€…Ñ¥½¹Ìè…½Õ¹Ñ¥¹MÑ…Ñ”¹…Ñ¥½¹Ì°(€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ìè…½Õ¹Ñ¥¹MÑ…Ñ”¹ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì°(€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤°(€€€ÝÉ¥Ñ•‰…­I•ÍÕ±ÑÌèmt°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•	•Ñ…I•©•Ð¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…ÁÁÉ½Ù”œ°€¥ÍÁÕÑ”…ÁÁÉ½Ù…°Á•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÌ¤ì(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°‰½‘ä¹…Í•%ñð‰½‘ä¹ÍÑ•µ%¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ô…Ý…¥Ð±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€¥˜€¡…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€„ôô€A•¹‘¥¹œÁÁÉ½Ù…°œ¤Ñ¡É½Ü…ÁÁÉÉ½È =¹±äÁ•¹‘¥¹œ¥ÍÁÕÑ”]½É­™±½Ü…Í•Ì…¸‰”É•©•Ñ•½ÈÉ•ÑÕÉ¹•™½ÈÉ•Ù¥Í¥½¸¸œ°€ÐÀÀ¤ì(€½¹ÍÐÉ•Ù¥Í¥½¹I•ÅÕ•ÍÑ•€ô	½½±•…¸¡‰½‘ä¹É•Ù¥Í¥½¹I•ÅÕ•ÍÑ•¤ì(€½¹ÍÐÉ•…Í½¸€ôMÑÉ¥¹œ¡‰½‘ä¹É•…Í½¸ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …É•…Í½¸¤Ñ¡É½Ü…ÁÁÉÉ½È¡É•Ù¥Í¥½¹I•ÅÕ•ÍÑ•€ü€I•Ù¥Í¥½¸É•…Í½¸¥ÌÉ•ÅÕ¥É•¸œ€è€I•©•Ñ¥½¸É•…Í½¸¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐÍ…±•Í™½É•MÑ…ÑÕÌ€ôÉ•Ù¥Í¥½¹I•ÅÕ•ÍÑ•€ü€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•œ€è€I•©•Ñ•œì(€…Ý…¥ÐÁ…Ñ¡¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍ%¹M…±•Í™½É”¡…Í•I½Ü°Í…±•Í™½É•MÑ…ÑÕÌ¤ì(€½¹ÍÐ¹½Ý%Í¼€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€½¹ÍÐì‘…Ñ„èÕÁ‘…Ñ•‘…Í”°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€Ý½É­™±½Ý}ÍÑ…ÑÕÌèÉ•Ù¥Í¥½¹I•ÅÕ•ÍÑ•€ü€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•œ€è€I•©•Ñ•œ°(€€€€€…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌèÉ•Ù¥Í¥½¹I•ÅÕ•ÍÑ•€ü€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•œ€è€I•©•Ñ•œ°(€€€€€É•©•Ñ•‘}‰äèÁÉ½™¥±”¹¥°(€€€€€É•©•Ñ•‘}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€€€É•©•Ñ•‘}…Ðè¹½Ý%Í¼°(€€€€€É•©•Ñ¥½¹}É•…Í½¸èÉ•…Í½¸°(€€€€€ÕÁ‘…Ñ•‘}…Ðè¹½Ý%Í¼°(€€€ô¤(€€€€¹•Ä ¥œ°…Í•I½Ü¹¥¤(€€€€¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤(€€€€¹Í¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°É•Ù¥Í¥½¹I•ÅÕ•ÍÑ•€ü€É•Ù¥Í¥½¹}É•ÅÕ•ÍÑ•œ€è€É•©•Ñ•œ°ÁÉ½™¥±”°ì(€€€¹½Ñ”èÉ•…Í½¸°(€ô¤ì(€½¹ÍÐÍÑ…ÑÕÍ…Í”€ô…Ý…¥ÐÉ•½É‘¥ÍÁÕÑ•]½É­™±½ÝM…±•Í™½É•]É¥Ñ•‰…¬¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°ÁÉ½™¥±”°Í…±•Í™½É•MÑ…ÑÕÌ¤ì(€É•ÑÕÉ¸ì…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡ÍÑ…ÑÕÍ…Í”¤ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°‰½‘ä¹…Í•%ñð‰½‘ä¹ÍÑ•µ%¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€É•ÑÕÉ¸ì‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½ÝUÁ±½…‘½Õµ•¹Ð¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÅÕ¥É•áÑ•É¹…±Ñ¥½¹…Ñ” Í…±•Í™½É•}ÝÉ¥Ñ”œ¤ì(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°‰½‘ä¹…Í•%ñð‰½‘ä¹ÍÑ•µ%¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ô…Ý…¥Ð±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€½¹ÍÐÁ…ÉÑåI½ÝÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑ¥•Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÉ•¥ÍÑÉä€ô…ÍÍ•ÉÑY…±¥‘¥ÍÁÕÑ•A…ÉÑ¥•Ì¡ÕÉÉ•¹ÑMÑ•´°Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐÍÑ½É•‘]½É­™±½Ü€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€Ù…±¥‘…Ñ•MÑ½É•‘¥ÍÁÕÑ•Ñ¥½¹Ì¡ÍÑ½É•‘]½É­™±½Ü¹…Ñ¥½¹I½ÝÌ°Á…ÉÑåI½ÝÌ°É•¥ÍÑÉä¤ì(€¥˜€¡…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€ôôô€ÁÁÉ½Ù•œ¤ì(€€€½¹ÍÐÉ•½¹¥±¥…Ñ¥½¸€ô…Ý…¥ÐÉ•½¹¥±•ÁÁÉ½Ù•‘MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü°Á…ÉÑåI½ÝÌ°ÍÑ½É•‘]½É­™±½Ü¹…Ñ¥½¹I½ÝÌ°ÍÑ½É•‘]½É­™±½Ü¹¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”¤ì(€€€¥˜€¡É•½¹¥±¥…Ñ¥½¸¹¡…¹•¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•ÈÁ…åµ•¹ÑÌ¡…¹•¸=LÕÁ‘…Ñ•Ñ¡”…½Õ¹Ñ¥¹œÁ±…¸ìÉ•½Á•¸Ñ¡”‘½Õµ•¹ÐÕÁ±½……¹±¥¹¬¥ÐÑ¼Ñ¡”É•Ù¥Í•¥¹ÍÑÉÕÑ¥½¸¸œ°€ÐÀä¤ì(€€€ô(€ô•±Í”ì(€€€…ÍÍ•ÉÑMÕÁÁ±¥•É±±½…Ñ¥½¹ÍÕÉÉ•¹Ð¡ÍÑ½É•‘]½É­™±½Ü¹…Ñ¥½¹I½ÝÌ°Á…ÉÑåI½ÝÌ°ÍÑ½É•‘]½É­™±½Ü¹¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´¤ì(€ô(€½¹ÍÐ…¹‘¥Ð€ôlÉ…™Ðœ°€I•©•Ñ•œ°€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•t¹¥¹±Õ‘•Ì¡…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ¤ì(€½¹ÍÐm…¹ÁÁÉ½Ù•½Õµ•¹ÑÌ°…¹½Õ¹Ñ½Õµ•¹ÑÍt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡mÕÍ•É!…Í…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…ÁÁÉ½Ù”œ¤°ÕÍ•É!…Í…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…½Õ¹Ðœ¥t¤ì(€¥˜€ ……¹‘¥Ð€˜˜€……¹ÁÁÉ½Ù•½Õµ•¹ÑÌ€˜˜€……¹½Õ¹Ñ½Õµ•¹ÑÌ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È =¹±ä…½Õ¹Ñ¥¹œ½È…‘µ¥¹¥ÍÑÉ…Ñ½ÉÌ…¸…‘‘½Õµ•¹ÑÌ…™Ñ•ÈÑÉ…‘•ÈÍÕ‰µ¥ÍÍ¥½¸¸œ°€ÐÀÌ¤ì(€ô((€½¹ÍÐ…Ñ¥½¹%€ôMÑÉ¥¹œ¡‰½‘ä¹…Ñ¥½¹%ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€½¹ÍÐÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹%€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹%ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€±•Ð…Ñ¥½¸€ô¹Õ±°ì(€¥˜€¡…Ñ¥½¹%¤ì(€€€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}Q%=9}M1P¤¹•Ä ¥œ°…Ñ¥½¹%¤¹•Ä …Í•}¥œ°…Í•I½Ü¹¥¤¹µ…å‰•M¥¹±” ¤ì(€€€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€€€¥˜€ …‘…Ñ„¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•Ý½É­™±½Ü…Ñ¥½¸Ý…Ì¹½Ð™½Õ¹¸œ°€ÐÀÐ¤ì(€€€…Ñ¥½¸€ô‘…Ñ„ì(€ô(€±•ÐÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¸€ô¹Õ±°ì(€¥˜€¡ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹%¤ì(€€€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}MUAA1%I}%9MQIUQ%=9}M1P¤¹•Ä ¥œ°ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹%¤¹•Ä …Í•}¥œ°…Í•I½Ü¹¥¤¹µ…å‰•M¥¹±” ¤ì(€€€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€€€¥˜€ …‘…Ñ„¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•ÍÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸Ý…Ì¹½Ð™½Õ¹¸œ°€ÐÀÐ¤ì(€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¸€ô‘…Ñ„ì(€€€¥˜€¡…Ñ¥½¸€˜˜ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¸¹…Ñ¥½¹}¥€„ôô…Ñ¥½¸¹¥¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡”ÍÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸‘½•Ì¹½Ð‰•±½¹œÑ¼Ñ¡”Í•±•Ñ•…Ñ¥½¸¸œ°€ÐÀÀ¤ì(€€€ô(€€€¥˜€ ……Ñ¥½¸¤ì(€€€€€½¹ÍÐì‘…Ñ„è±¥¹­•‘Ñ¥½¸°•ÉÉ½Èè±¥¹­•‘Ñ¥½¹ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}Q%=9}M1P¤¹•Ä ¥œ°ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¸¹…Ñ¥½¹}¥¤¹•Ä …Í•}¥œ°…Í•I½Ü¹¥¤¹µ…å‰•M¥¹±” ¤ì(€€€€€¥˜€¡±¥¹­•‘Ñ¥½¹ÉÉ½È¤Ñ¡É½Ü±¥¹­•‘Ñ¥½¹ÉÉ½Èì(€€€€€…Ñ¥½¸€ô±¥¹­•‘Ñ¥½¸ì(€€€ô(€ô(€½¹ÍÐÁ…ÉÑå%€ôMÑÉ¥¹œ¡‰½‘ä¹Á…ÉÑå%ñð…Ñ¥½¸ü¹Á…ÉÑå}¥ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐÁ…ÉÑåI½Ü€ôÁ…ÉÑåI½ÝÌ¹™¥¹ ¡Á…ÉÑä¤€ôøÁ…ÉÑä¹¥€ôôôÁ…ÉÑå%¤ì(€¥˜€ …Á…ÉÑåI½Ü¤Ñ¡É½Ü…ÁÁÉÉ½È M•±•Ð„Í…Ù•‘¥ÍÁÕÑ•½Õ¹Ð‰•™½É”ÕÁ±½…‘¥¹œ„‘½Õµ•¹Ð¸œ°€ÐÀÀ¤ì(€½¹ÍÐÁ…ÉÑåM¥‘”€ôMÑÉ¥¹œ¡‰½‘ä¹Á…ÉÑåM¥‘”ñð…Ñ¥½¸ü¹Á…ÉÑå}Í¥‘”ñð€œœ¤(€€€€¹ÑÉ¥´ ¤(€€€€¹Ñ½1½Ý•É…Í” ¤ì(€¥˜€ …l‰Õå•Èœ°€ÍÕÁÁ±¥•Èt¹¥¹±Õ‘•Ì¡Á…ÉÑåM¥‘”¤¤Ñ¡É½Ü…ÁÁÉÉ½È M•±•ÐÑ¡”‰Õå•È½ÈÍÕÁÁ±¥•ÈÍ¥‘”™½ÈÑ¡¥Ì‘½Õµ•¹Ð¸œ°€ÐÀÀ¤ì(€½¹ÍÐÁ…ÉÑä€ô™¥¹‘¥ÍÁÕÑ•A…ÉÑä¡É•¥ÍÑÉä°Á…ÉÑåM¥‘”°Á…ÉÑåI½Ü¹…½Õ¹Ñ}¥¤ì(€¥˜€ …Á…ÉÑäñð€„¡É•¥ÍÑÉä¹Í•±•Ñ•ñðmt¤¹Í½µ” ¡Í•±•Ñ•¤€ôøÍ•±•Ñ•¹…½Õ¹Ñ-•ä€ôôôÁ…ÉÑä¹…½Õ¹Ñ-•ä¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•½Õ¹ÐÍ¥‘”¥Ì¹¼±½¹•ÈÙ…±¥™½ÈÑ¡¥ÌMQ4¸œ°€ÐÀÀ¤ì(€ô(€¥˜€¡…Ñ¥½¸€˜˜€¡…Ñ¥½¸¹Á…ÉÑå}¥€„ôôÁ…ÉÑåI½Ü¹¥ñð…Ñ¥½¸¹Á…ÉÑå}Í¥‘”€„ôôÁ…ÉÑåM¥‘”¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•…Ñ¥½¸‘½•Ì¹½Ð‰•±½¹œÑ¼Ñ¡¥Ì½Õ¹ÐÍ¥‘”¸œ°€ÐÀÀ¤ì(€ô((€½¹ÍÐ‘½Õµ•¹ÑQåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹‘½Õµ•¹ÑQåÁ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …%MAUQ}]=I-1=]}=U59Q}QeAL¹¡…Ì¡‘½Õµ•¹ÑQåÁ”¤¤Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥‘½Õµ•¹ÐÑåÁ”¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐ‘½Õµ•¹Ñ¥É•Ñ¥½¸€ôMÑÉ¥¹œ¡‰½‘ä¹‘½Õµ•¹Ñ¥É•Ñ¥½¸ñð€œœ¤(€€€€¹ÑÉ¥´ ¤(€€€€¹Ñ½1½Ý•É…Í” ¤ì(€¥˜€ …%MAUQ}]=I-1=]}=U59Q}%IQ%=9L¹¡…Ì¡‘½Õµ•¹Ñ¥É•Ñ¥½¸¤¤Ñ¡É½Ü…ÁÁÉÉ½È M•±•Ð„Ù…±¥‘½Õµ•¹Ð‘¥É•Ñ¥½¸¸œ°€ÐÀÀ¤ì(€¥˜€ …‘½Õµ•¹Ñ¥É•Ñ¥½¸¹•¹‘Í]¥Ñ ¡|‘íÁ…ÉÑåM¥‘•õ€¤¤Ñ¡É½Ü…ÁÁÉÉ½È¡½Õµ•¹Ð‘¥É•Ñ¥½¸µÕÍÐµ…Ñ Ñ¡”€‘íÁ…ÉÑåM¥‘•ôÍ¥‘”¹€°€ÐÀÀ¤ì(€½¹ÍÐ½É¥¥¹…±¥±•9…µ”€ôMÑÉ¥¹œ¡‰½‘ä¹½É¥¥¹…±¥±•9…µ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …½É¥¥¹…±¥±•9…µ”¤Ñ¡É½Ü…ÁÁÉÉ½È ½Õµ•¹Ð™¥±•¹…µ”¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐÉ…Ý	…Í”ØÐ€ôMÑÉ¥¹œ¡‰½‘ä¹‰…Í”ØÐñð€œœ¤(€€€€¹É•Á±…” ½y‘…Ñ„émxít¬í‰…Í”ØÐ°¼°€œœ¤(€€€€¹É•Á±…” ½qÌ¬½œ°€œœ¤ì(€¥˜€ …É…Ý	…Í”ØÐ¤Ñ¡É½Ü…ÁÁÉÉ½È ½Õµ•¹Ð½¹Ñ•¹Ð¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐ‰Õ™™•È€ô	Õ™™•È¹™É½´¡É…Ý	…Í”ØÐ°€‰…Í”ØÐœ¤ì(€¥˜€ …‰Õ™™•È¹±•¹Ñ ¤Ñ¡É½Ü…ÁÁÉÉ½È ½Õµ•¹Ð½¹Ñ•¹Ð¥Ì•µÁÑä½È¥¹Ù…±¥¸œ°€ÐÀÀ¤ì(€¥˜€¡‰Õ™™•È¹±•¹Ñ €ø%MAUQ}]=I-1=]}5a}=U59Q}	eQL¤Ñ¡É½Ü…ÁÁÉÉ½È ½Õµ•¹Ð¥ÌÑ½¼±…É”¸5…á¥µÕ´Í¥é”¥Ì€Ì5¸œ°€ÐÄÌ¤ì((€½¹ÍÐÁ…ÉÑå9…µ”€ôÁ…ÉÑä¹¹…µ”ì(€½¹ÍÐ±¥¹­•‘I•½É‘%€ô…Í•I½Ü¹ÍÑ•µ}¥ì(€½¹ÍÐ•áÑ•¹Í¥½¸€ô‘¥ÍÁÕÑ•]½É­™±½Ý¥±•áÑ•¹Í¥½¸¡½É¥¥¹…±¥±•9…µ”¤ì(€¥˜€ …•áÑ•¹Í¥½¸¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•‘½Õµ•¹ÐµÕÍÐ¡…Ù”„™¥±•¹…µ”•áÑ•¹Í¥½¸¸œ°€ÐÀÀ¤ì(€½¹ÍÐ‘¥É•Ñ¥½¹1…‰•°€ô‘¥ÍÁÕÑ•]½É­™±½Ý¥É•Ñ¥½¹1…‰•°¡‘½Õµ•¹Ñ¥É•Ñ¥½¸¤ì(€½¹ÍÐÍÕ•ÍÑ•‘	…Í•9…µ”€ô€‘í‘¥ÍÁÕÑ•]½É­™±½Ý!½¹-½¹…Ñ•Q½­•¸ ¥ô€‘í‘¥É•Ñ¥½¹1…‰•±õ€ì(€½¹ÍÐÉ•ÅÕ•ÍÑ•‘%¹ÁÕÐ€ôMÑÉ¥¹œ¡‰½‘ä¹É•ÅÕ•ÍÑ•‘¥±•9…µ”ñð€œœ¤¹É•Á±…”¡¹•ÜI•áÀ¡qp¸‘í•áÑ•¹Í¥½¹ô‘€°€¤œ¤°€œœ¤ì(€½¹ÍÐÉ•ÅÕ•ÍÑ•‘	…Í•9…µ”€ô‘¥ÍÁÕÑ•]½É­™±½Ý‘¥Ñ…‰±•¥±•¹…µ”¡É•ÅÕ•ÍÑ•‘%¹ÁÕÐ°ÍÕ•ÍÑ•‘	…Í•9…µ”¤ì(€½¹ÍÐ½¹Ñ•¹ÑQåÁ”€ôMÑÉ¥¹œ¡‰½‘ä¹½¹Ñ•¹ÑQåÁ”ñð€…ÁÁ±¥…Ñ¥½¸½½Ñ•ÐµÍÑÉ•…´œ¤¹ÑÉ¥´ ¤ñð€…ÁÁ±¥…Ñ¥½¸½½Ñ•ÐµÍÑÉ•…´œì(€±•Ð‘½Õµ•¹ÑI½Ü€ô¹Õ±°ì(€™½È€¡±•ÐÍÕ™™¥à€ô€ÀìÍÕ™™¥à€ð€ÄÀÀÀìÍÕ™™¥à€¬ô€Ä¤ì(€€€½¹ÍÐÍµ…ÉÑ¥±•9…µ”€ô€‘íÉ•ÅÕ•ÍÑ•‘	…Í•9…µ•ô‘íÍÕ™™¥à€ü€´‘íÍÕ™™¥áõ€€è€œô¸‘í•áÑ•¹Í¥½¹õ€ì(€€€½¹ÍÐì‘…Ñ„°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€€€¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}‘½Õµ•¹ÑÌœ¤(€€€€€€¹¥¹Í•ÉÐ¡ì(€€€€€€€…Í•}¥è…Í•I½Ü¹¥°(€€€€€€€…Ñ¥½¹}¥è…Ñ¥½¸ü¹¥ñð…Ñ¥½¹%°(€€€€€€€ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹}¥èÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹%°(€€€€€€€Á…ÉÑå}¥èÁ…ÉÑåI½Ü¹¥°(€€€€€€€Á…ÉÑå}Í¥‘”èÁ…ÉÑåM¥‘”°(€€€€€€€ÍÑ•µ}¥è…Í•I½Ü¹ÍÑ•µ}¥°(€€€€€€€Á…ÉÑå}¹…µ”èÁ…ÉÑå9…µ”°(€€€€€€€Á…ÉÑå}…½Õ¹Ñ}¥èÁ…ÉÑä¹…½Õ¹Ñ%°(€€€€€€€‘½Õµ•¹Ñ}‘¥É•Ñ¥½¸è‘½Õµ•¹Ñ¥É•Ñ¥½¸°(€€€€€€€‘½Õµ•¹Ñ}ÑåÁ”è‘½Õµ•¹ÑQåÁ”°(€€€€€€€½É¥¥¹…±}™¥±•¹…µ”è½É¥¥¹…±¥±•9…µ”°(€€€€€€€É•ÅÕ•ÍÑ•‘}™¥±•¹…µ”è€‘íÉ•ÅÕ•ÍÑ•‘	…Í•9…µ•ô¸‘í•áÑ•¹Í¥½¹õ€°(€€€€€€€Íµ…ÉÑ}™¥±•¹…µ”èÍµ…ÉÑ¥±•9…µ”°(€€€€€€€ÕÁ±½…‘}ÍÑ…ÑÕÌè€Á•¹‘¥¹œœ°(€€€€€€€½¹Ñ•¹Ñ}ÑåÁ”è½¹Ñ•¹ÑQåÁ”°(€€€€€€€™¥±•}•áÑ•¹Í¥½¸è•áÑ•¹Í¥½¸°(€€€€€€€½¹Ñ•¹Ñ}Í¥é”è‰Õ™™•È¹±•¹Ñ °(€€€€€€€Í…±•Í™½É•}½¹Ñ•¹Ñ}Ù•ÉÍ¥½¹}¥è¹Õ±°°(€€€€€€€Í…±•Í™½É•}±¥¹­•‘}É•½É‘}¥è±¥¹­•‘I•½É‘%°(€€€€€€€ÕÁ±½…‘•‘}‰äèÁÉ½™¥±”¹¥°(€€€€€€€ÕÁ±½…‘•‘}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€€€ô¤(€€€€€€¹Í•±•Ð¡%MAUQ}]=I-1=]}=U59Q}M1P¤(€€€€€€¹Í¥¹±” ¤ì(€€€¥˜€ …•ÉÉ½È¤ì(€€€€€‘½Õµ•¹ÑI½Ü€ô‘…Ñ„ì(€€€€€‰É•…¬ì(€€€ô(€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€œÈÌÔÀÔœ¤Ñ¡É½Ü•ÉÉ½Èì(€ô(€¥˜€ …‘½Õµ•¹ÑI½Ü¤Ñ¡É½Ü…ÁÁÉÉ½È Õ¹¥ÅÕ”‘½Õµ•¹Ð™¥±•¹…µ”½Õ±¹½Ð‰”É•Í•ÉÙ•¸œ°€ÐÀä¤ì((€½¹ÍÐÍµ…ÉÑ¥±•9…µ”€ô‘½Õµ•¹ÑI½Ü¹Íµ…ÉÑ}™¥±•¹…µ”ì(€½¹ÍÐÑ¥Ñ±”€ôÍµ…ÉÑ¥±•9…µ”¹Í±¥” À°€´¡•áÑ•¹Í¥½¸¹±•¹Ñ €¬€Ä¤¤ì(€±•Ð½¹Ñ•¹ÑY•ÉÍ¥½¹%€ô¹Õ±°ì(€±•Ð½¹Ñ•¹Ñ½Õµ•¹Ñ%€ô¹Õ±°ì((€ÑÉäì(€€€½¹ÍÐ½¹Ñ•¹ÑY•ÉÍ¥½¸€ô…Ý…¥ÐÍ™I•ÅÕ•ÍÐ œ½Í½‰©•ÑÌ½½¹Ñ•¹ÑY•ÉÍ¥½¸œ°ì(€€€€€µ•Ñ¡½è€A=MPœ°(€€€€€‰½‘äèì(€€€€€€€Q¥Ñ±”èÑ¥Ñ±”°(€€€€€€€A…Ñ¡=¹±¥•¹Ðè€¼‘íÍµ…ÉÑ¥±•9…µ•õ€°(€€€€€€€Y•ÉÍ¥½¹…Ñ„è‰Õ™™•È¹Ñ½MÑÉ¥¹œ ‰…Í”ØÐœ¤°(€€€€€€€¥ÉÍÑAÕ‰±¥Í¡1½…Ñ¥½¹%è±¥¹­•‘I•½É‘%°(€€€€€ô°(€€€ô¤ì(€€€½¹Ñ•¹ÑY•ÉÍ¥½¹%€ô½¹Ñ•¹ÑY•ÉÍ¥½¸ü¹¥ì(€€€¥˜€ …¥ÍM…±•Í™½É•%¡½¹Ñ•¹ÑY•ÉÍ¥½¹%¤¤Ñ¡É½Ü…ÁÁÉÉ½È M…±•Í™½É”‘¥¹½ÐÉ•ÑÕÉ¸„½¹Ñ•¹ÑY•ÉÍ¥½¸¥¸œ°€ÔÀÈ¤ì(€€€½¹ÍÐÙ•ÉÍ¥½¹I½ÝÌ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ¡M1P%°½¹Ñ•¹Ñ½Õµ•¹Ñ%I=4½¹Ñ•¹ÑY•ÉÍ¥½¸]!I%€ô€œ‘í•Í…Á•M½Å°¡½¹Ñ•¹ÑY•ÉÍ¥½¹%¥ôœ1%5%P€Å€°ìÍ½™Ñ…¥°èÑÉÕ”ô¤ì(€€€½¹Ñ•¹Ñ½Õµ•¹Ñ%€ôÙ•ÉÍ¥½¹I½ÝÍlÁtü¹½¹Ñ•¹Ñ½Õµ•¹Ñ%ñð¹Õ±°ì(€€€¥˜€ …¥ÍM…±•Í™½É•%¡½¹Ñ•¹Ñ½Õµ•¹Ñ%¤¤Ñ¡É½Ü…ÁÁÉÉ½È M…±•Í™½É”‘¥¹½ÐÉ•ÑÕÉ¸„½¹Ñ•¹Ñ½Õµ•¹Ð¥¸œ°€ÔÀÈ¤ì(€€€½¹ÍÐÍ…±•Í™½É•UÉ°€ô€‘í•Ñ%¹ÍÑ…¹•UÉ° ¥ô½±¥¡Ñ¹¥¹œ½È½½¹Ñ•¹Ñ½Õµ•¹Ð¼‘í½¹Ñ•¹Ñ½Õµ•¹Ñ%‘ô½Ù¥•Ý€ì(€€€½¹ÍÐì‘…Ñ„è½µÁ±•Ñ•‘½Õµ•¹Ð°•ÉÉ½Èè‘½Õµ•¹ÑÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€€€¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}‘½Õµ•¹ÑÌœ¤(€€€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€€€ÕÁ±½…‘}ÍÑ…ÑÕÌè€½µÁ±•Ñ”œ°(€€€€€€€Í…±•Í™½É•}½¹Ñ•¹Ñ}Ù•ÉÍ¥½¹}¥è½¹Ñ•¹ÑY•ÉÍ¥½¹%°(€€€€€€€Í…±•Í™½É•}½¹Ñ•¹Ñ}‘½Õµ•¹Ñ}¥è½¹Ñ•¹Ñ½Õµ•¹Ñ%°(€€€€€€€Í…±•Í™½É•}ÕÉ°èÍ…±•Í™½É•UÉ°°(€€€€€ô¤(€€€€€€¹•Ä ¥œ°‘½Õµ•¹ÑI½Ü¹¥¤(€€€€€€¹•Ä ÕÁ±½…‘}ÍÑ…ÑÕÌœ°€Á•¹‘¥¹œœ¤(€€€€€€¹Í•±•Ð¡%MAUQ}]=I-1=]}=U59Q}M1P¤(€€€€€€¹Í¥¹±” ¤ì(€€€¥˜€¡‘½Õµ•¹ÑÉÉ½È¤Ñ¡É½Ü‘½Õµ•¹ÑÉÉ½Èì(€€€‘½Õµ•¹ÑI½Ü€ô½µÁ±•Ñ•‘½Õµ•¹Ðì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡½¹Ñ•¹Ñ½Õµ•¹Ñ%¤…Ý…¥ÐÍ™I•ÅÕ•ÍÐ¡€½Í½‰©•ÑÌ½½¹Ñ•¹Ñ½Õµ•¹Ð¼‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½¹Ñ•¹Ñ½Õµ•¹Ñ%¥õ€°ìµ•Ñ¡½è€1Qœô¤¹…Ñ   ¤€ôø¹Õ±°¤ì(€€€•±Í”¥˜€¡½¹Ñ•¹ÑY•ÉÍ¥½¹%¤…Ý…¥ÐÍ™I•ÅÕ•ÍÐ¡€½Í½‰©•ÑÌ½½¹Ñ•¹ÑY•ÉÍ¥½¸¼‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½¹Ñ•¹ÑY•ÉÍ¥½¹%¥õ€°ìµ•Ñ¡½è€1Qœô¤¹…Ñ   ¤€ôø¹Õ±°¤ì(€€€…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}‘½Õµ•¹ÑÌœ¤¹‘•±•Ñ” ¤¹•Ä ¥œ°‘½Õµ•¹ÑI½Ü¹¥¤ì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô(€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°…Í•I½Ü°€‘½Õµ•¹Ñ}ÕÁ±½…‘•œ°ÁÉ½™¥±”°ì(€€€…Ñ¥½¹%°(€€€¹½Ñ”è€‘íÍµ…ÉÑ¥±•9…µ•ôÕÁ±½…‘•Ñ¼M…±•Í™½É”¹€°(€€€µ•Ñ…‘…Ñ„èì(€€€€€‘½Õµ•¹Ñ%è‘½Õµ•¹ÑI½Ü¹¥°(€€€€€‘½Õµ•¹ÑQåÁ”°(€€€€€‘½Õµ•¹Ñ¥É•Ñ¥½¸°(€€€€€Á…ÉÑåM¥‘”°(€€€€€Á…ÉÑå9…µ”°(€€€€€Á…ÉÑå½Õ¹Ñ%èÁ…ÉÑä¹…½Õ¹Ñ%°(€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹%°(€€€€€½¹Ñ•¹ÑY•ÉÍ¥½¹%è‘½Õµ•¹ÑI½Ü¹Í…±•Í™½É•}½¹Ñ•¹Ñ}Ù•ÉÍ¥½¹}¥°(€€€€€±¥¹­•‘I•½É‘%‘Ìèm±¥¹­•‘I•½É‘%‘t°(€€€ô°(€ô¤ì(€É•ÑÕÉ¸ì‘½Õµ•¹ÐèÍ•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¡‘½Õµ•¹ÑI½Ü¤ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÕÁÁ±¥•É=™™Í•Ñ%¹Ù½¥•=ÁÑ¥½¹Ì¡ìÍÕÁÁ±¥•É½Õ¹Ñ%°ÕÉÉ•¹å%Í½½‘”°•á±Õ‘•%¹Ù½¥•%‘Ì€ômt°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°ô€ôíô¤ì(€¥˜€ …¥ÍM…±•Í™½É•%¡ÍÕÁÁ±¥•É½Õ¹Ñ%¤¤Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥ÍÕÁÁ±¥•È½Õ¹Ð¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐm¥¹Ù½¥••ÍÉ¥‰”°Á…åµ•¹Ñ•ÍÉ¥‰•t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€Í…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€MÕÁÁ±¥•É}%¹Ù½¥•}}Œœô¤°(€€€Í…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€A…åµ•¹Ñ}}Œœô¤¹…Ñ   ¤€ôø€¡ì(€€€€€™¥•±‘Ìèmt°(€€€ô¤¤°(€t¤ì(€½¹ÍÐ¥¹Ù½¥•¥•±‘Ì€ô¥¹Ù½¥••ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐ¥¹Ù½¥•¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡¥¹Ù½¥•¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐ¥¹Ù½¥•¥•±‘	å9…µ”€ô=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡¥¹Ù½¥•¥•±‘Ì¹µ…À ¡™¥•±¤€ôøm™¥•±¹¹…µ”°™¥•±‘t¤¤ì(€½¹ÍÐÍ¡•µ„€ôÉ•Í½±Ù•MÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑM¡•µ„¡ì(€€€ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ìè¥¹Ù½¥•¥•±‘Ì°(€€€Á…åµ•¹Ñ¥•±‘ÌèÁ…åµ•¹Ñ•ÍÉ¥‰”¹™¥•±‘Ìñðmt°(€ô¤ì(€¥˜€ …Í¡•µ„¹Ù…±¥¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È¡MÕÁÁ±¥•È½™™Í•Ð½ÁÑ¥½¹Ì…É”Õ¹…Ù…¥±…‰±”è€‘íÍ¡•µ„¹¥ÍÍÕ•Ì¹©½¥¸ œ€œ¥õ€°€ÐÀä¤ì(€ô(€½¹ÍÐÉ•±…Ñ¥½¹Í¡¥ÁÌ€ôÍ¡•µ„¹ÍÕÁÁ±¥•É½Õ¹Ñ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø¥¹Ù½¥•¥•±‘	å9…µ•m™¥•±‘tü¹É•±…Ñ¥½¹Í¡¥Á9…µ”¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐÍ•±•Ñ¥•±‘Ì€ôl%œ°€9…µ”œ°€É•…Ñ•‘…Ñ”œ°¥¹Ù½¥•¥•±‘9…µ•Ì¹¡…Ì MQ5}}Œœ¤€ü€MQ5}}Œœ€è¹Õ±°°¥¹Ù½¥•¥•±‘9…µ•Ì¹¡…Ì ÕÉÉ•¹å%Í½½‘”œ¤€ü€ÕÉÉ•¹å%Í½½‘”œ€è¹Õ±°°Í¡•µ„¹¥¹Ù½¥•µ½Õ¹Ñ¥•±°Í¡•µ„¹¥¹Ù½¥•A…å…‰±•¥•±°€¸¸¹Í¡•µ„¹¥¹Ù½¥•Õ•…Ñ•¥•±‘Ì°€¸¸¹Í¡•µ„¹¥¹Ù½¥•…Ñ•¥•±‘Ì°€¸¸¹Í¡•µ„¹¥¹Ù½¥•MÑ…ÑÕÍ¥•±‘Ì°€¸¸¹Í¡•µ„¹ÍÕÁÁ±¥•É½Õ¹Ñ¥•±‘Ì°€¸¸¹É•±…Ñ¥½¹Í¡¥ÁÌ¹µ…À ¡É•±…Ñ¥½¹Í¡¥À¤€ôø€‘íÉ•±…Ñ¥½¹Í¡¥Áô¹9…µ•€¥t¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐ…½Õ¹Ñ½¹‘¥Ñ¥½¸€ôÍ¡•µ„¹ÍÕÁÁ±¥•É½Õ¹Ñ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø€‘í™¥•±‘ô€ô€œ‘í•Í…Á•M½Å°¡ÍÕÁÁ±¥•É½Õ¹Ñ%¥ô€¤¹©½¥¸ œ=H€œ¤ì(€½¹ÍÐÉ½ÝÌ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ (€€€€(€€€M1P€‘íl¸¸¹¹•ÜM•Ð¡Í•±•Ñ¥•±‘Ì¥t¹©½¥¸ œ°€œ¥ô(€€€I=4MÕÁÁ±¥•É}%¹Ù½¥•}}Œ(€€€]!I€ ‘í…½Õ¹Ñ½¹‘¥Ñ¥½¹ô¤(€€€=IH	dÉ•…Ñ•‘…Ñ”M(€€€1%5%P€ÈÀÀÀ(€€°(€€€ì±¥µ¥Ðè€ÈÀÀÀ°Í½™Ñ…¥°èÑÉÕ”ô°(€€¤ì(€½¹ÍÐ•á±Õ‘•€ô¹•ÜM•Ð¡•á±Õ‘•%¹Ù½¥•%‘Ì¹µ…À ¡¥¤€ôøMÑÉ¥¹œ¡¥¤¹Í±¥” À°€ÄÔ¤¤¤ì(€½¹ÍÐ½ÁÑ¥½¹Ì€ômtì(€™½È€¡½¹ÍÐ¥¹Ù½¥”½˜É½ÝÌ¤ì(€€€¥˜€¡•á±Õ‘•¹¡…Ì¡MÑÉ¥¹œ¡¥¹Ù½¥”¹%ñð€œœ¤¹Í±¥” À°€ÄÔ¤¤¤½¹Ñ¥¹Õ”ì(€€€¥˜€¡¥¹Ù½¥”¹MQ5}}Œ¤ì(€€€€€½¹ÍÐ…±±½Ý•€ô…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡¥¹Ù½¥”¹MQ5}}Œ°…•ÍÍ½¹Ñ•áÐ¤(€€€€€€€€¹Ñ¡•¸  ¤€ôøÑÉÕ”¤(€€€€€€€€¹…Ñ   ¤€ôø™…±Í”¤ì(€€€€€¥˜€ ……±±½Ý•¤½¹Ñ¥¹Õ”ì(€€€ô(€€€½¹ÍÐÍÕÁÁ±¥•É¥•±€ôÍ¡•µ„¹ÍÕÁÁ±¥•É½Õ¹Ñ¥•±‘Ì¹™¥¹ ¡™¥•±¤€ôø¥¹Ù½¥•m™¥•±‘t¤ì(€€€¥˜€¡‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡¥¹Ù½¥•mÍÕÁÁ±¥•É¥•±‘t¤€„ôô‘¥ÍÁÕÑ•M…±•Í™½É•%‘-•ä¡ÍÕÁÁ±¥•É½Õ¹Ñ%¤¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐ‘Õ•…Ñ”€ôÍ¡•µ„¹¥¹Ù½¥•Õ•…Ñ•¥•±‘Ì¹µ…À ¡™¥•±¤€ôø¥¹Ù½¥•m™¥•±‘t¤¹™¥¹¡	½½±•…¸¤ñð¹Õ±°ì(€€€½¹ÍÐ¥¹Ù½¥•…Ñ”€ôÍ¡•µ„¹¥¹Ù½¥•…Ñ•¥•±‘Ì¹µ…À ¡™¥•±¤€ôø¥¹Ù½¥•m™¥•±‘t¤¹™¥¹¡	½½±•…¸¤ñð¥¹Ù½¥”¹É•…Ñ•‘…Ñ”ñð¹Õ±°ì(€€€½¹ÍÐÍÑ…ÑÕÌ€ôÍ¡•µ„¹¥¹Ù½¥•MÑ…ÑÕÍ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø¥¹Ù½¥•m™¥•±‘t¤¹™¥¹¡	½½±•…¸¤ñð¹Õ±°ì(€€€½¹ÍÐÍÑ…ÑÕÍQ½­•¸€ôMÑÉ¥¹œ¡ÍÑ…ÑÕÌñð€œœ¤(€€€€€€¹Ñ½1½Ý•É…Í” ¤(€€€€€€¹É•Á±…” ½my„µèÀ´åt¬½œ°€œœ¤ì(€€€¥˜€¡l±½Í•œ°€Á…¥œ°€…¹•±±•œ°€…¹•±•œ°€Ù½¥œ°€É•©•Ñ•t¹Í½µ” ¡Ñ½­•¸¤€ôøÍÑ…ÑÕÍQ½­•¸¹¥¹±Õ‘•Ì¡Ñ½­•¸¤¤¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐ•áÁ½ÍÕÉ”€ô¹½Éµ…±¥é•MÕÁÁ±¥•É%¹Ù½¥•áÁ½ÍÕÉ”¡ì(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•%è¥¹Ù½¥”¹%°(€€€€€¥¹Ù½¥•9…µ”è¥¹Ù½¥”¹9…µ”°(€€€€€Í½ÕÉ•MÑ•µ%è¥¹Ù½¥”¹MQ5}}Œ°(€€€€€ÍÕÁÁ±¥•É½Õ¹Ñ%è¥¹Ù½¥•mÍÕÁÁ±¥•É¥•±‘t°(€€€€€ÍÕÁÁ±¥•É9…µ”èÉ•±…Ñ¥½¹Í¡¥ÁÌ¹µ…À ¡É•±…Ñ¥½¹Í¡¥À¤€ôø¥¹Ù½¥•mÉ•±…Ñ¥½¹Í¡¥Átü¹9…µ”¤¹™¥¹¡	½½±•…¸¤ñð€œœ°(€€€€€ÕÉÉ•¹å%Í½½‘”è¥¹Ù½¥”¹ÕÉÉ•¹å%Í½½‘”ñð€UMœ°(€€€€€‘Õ•…Ñ”°(€€€€€¥¹Ù½¥•…Ñ”°(€€€€€É•…Ñ•‘…Ñ”è¥¹Ù½¥”¹É•…Ñ•‘…Ñ”°(€€€€€¥¹Ù½¥•µ½Õ¹Ðè¥¹Ù½¥•mÍ¡•µ„¹¥¹Ù½¥•µ½Õ¹Ñ¥•±‘t°(€€€€€Á…å…‰±•	…±…¹”è¥¹Ù½¥•mÍ¡•µ„¹¥¹Ù½¥•A…å…‰±•¥•±‘t°(€€€€€ÍÑ…ÑÕÌ°(€€€ô¤ì(€€€¥˜€¡•áÁ½ÍÕÉ”¹Á…å…‰±•	…±…¹”€ðô€À¸ÀÄñð•áÁ½ÍÕÉ”¹ÕÉÉ•¹å%Í½½‘”€„ôôÕÉÉ•¹å%Í½½‘”¤½¹Ñ¥¹Õ”ì(€€€½ÁÑ¥½¹Ì¹ÁÕÍ ¡ì(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•%è•áÁ½ÍÕÉ”¹ÍÕÁÁ±¥•É%¹Ù½¥•%°(€€€€€¥¹Ù½¥•9…µ”è•áÁ½ÍÕÉ”¹¥¹Ù½¥•9…µ”°(€€€€€ÍÑ•µ%è¥¹Ù½¥”¹MQ5}}Œñð¹Õ±°°(€€€€€ÕÉÉ•¹å%Í½½‘”è•áÁ½ÍÕÉ”¹ÕÉÉ•¹å%Í½½‘”°(€€€€€¥¹Ù½¥•µ½Õ¹Ðè•áÁ½ÍÕÉ”¹¥¹Ù½¥•µ½Õ¹Ð°(€€€€€Á…å…‰±•	…±…¹”è•áÁ½ÍÕÉ”¹Á…å…‰±•	…±…¹”°(€€€€€‘Õ•…Ñ”è•áÁ½ÍÕÉ”¹‘Õ•…Ñ”°(€€€€€¥¹Ù½¥•…Ñ”è•áÁ½ÍÕÉ”¹¥¹Ù½¥•…Ñ”°(€€€€€ÍÑ…ÑÕÌ°(€€€ô¤ì(€ô(€É•ÑÕÉ¸½ÁÑ¥½¹Ìì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½ÝMÕÁÁ±¥•É=™™Í•Ñ=ÁÑ¥½¹Ì¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…½Õ¹Ðœ°€¥ÍÁÕÑ”…½Õ¹Ñ¥¹œÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•™½ÈÍÕÁÁ±¥•È½™™Í•Ð½ÁÑ¥½¹Ì¸œ¤ì(€½¹ÍÐ¥¹ÍÑÉÕÑ¥½¹%€ôMÑÉ¥¹œ¡‰½‘ä¹¥¹ÍÑÉÕÑ¥½¹%ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐì‘…Ñ„è¥¹ÍÑÉÕÑ¥½¸°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}MUAA1%I}%9MQIUQ%=9}M1P¤¹•Ä ¥œ°¥¹ÍÑÉÕÑ¥½¹%¤¹µ…å‰•M¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€¥˜€ …¥¹ÍÑÉÕÑ¥½¸¤Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸¹½Ð™½Õ¹¸œ°€ÐÀÐ¤ì(€¥˜€¡¥¹ÍÑÉÕÑ¥½¸¹¥¹ÍÑÉÕÑ¥½¹}ÑåÁ”€„ôô€•Ñ}‰…­}Á…¥œ¤Ñ¡É½Ü…ÁÁÉÉ½È =¹±ä•Ð‰…¬Á…¥…µ½Õ¹Ð¥¹ÍÑÉÕÑ¥½¹Ì…¸ÕÍ”…¸½™™Í•Ð¥¹Ù½¥”¸œ°€ÐÀÀ¤ì(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°¥¹ÍÑÉÕÑ¥½¸¹…Í•}¥¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐÁ…ÉÑåI½ÝÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑ¥•Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÁ…ÉÑä€ôÁ…ÉÑåI½ÝÌ¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹¥€ôôô¥¹ÍÑÉÕÑ¥½¸¹Á…ÉÑå}¥¤ì(€¥˜€ …Á…ÉÑä¤Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸¡…Ì¹¼Í•±•Ñ•½Õ¹Ð¸œ°€ÐÀÀ¤ì(€½¹ÍÐ½ÁÑ¥½¹Ì€ô…Ý…¥ÐÍÕÁÁ±¥•É=™™Í•Ñ%¹Ù½¥•=ÁÑ¥½¹Ì¡ì(€€€ÍÕÁÁ±¥•É½Õ¹Ñ%èÁ…ÉÑä¹…½Õ¹Ñ}¥°(€€€ÕÉÉ•¹å%Í½½‘”è¥¹ÍÑÉÕÑ¥½¸¹ÕÉÉ•¹å}¥Í½}½‘”°(€€€•á±Õ‘•%¹Ù½¥•%‘Ìèm¥¹ÍÑÉÕÑ¥½¸¹Í½ÕÉ•}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥‘t°(€€€…•ÍÍ½¹Ñ•áÐè…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô°(€ô¤ì(€½¹ÍÐì‘…Ñ„èÉ•Í•ÉÙ…Ñ¥½¹Ì°•ÉÉ½ÈèÉ•Í•ÉÙ…Ñ¥½¹ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹Ìœ¤¹Í•±•Ð ¥±Ñ…É•Ñ}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥±Á±…¹¹•‘}…µ½Õ¹Ð±ÍÑ…ÑÕÌ±É•½Ù•Éå}µ•Ñ¡½œ¤¹•Ä É•½Ù•Éå}µ•Ñ¡½œ°€™ÕÑÕÉ•}¥¹Ù½¥•}½™™Í•Ðœ¤¹¹½Ð Ñ…É•Ñ}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥œ°€¥Ìœ°¹Õ±°¤ì(€¥˜€¡É•Í•ÉÙ…Ñ¥½¹ÉÉ½È¤Ñ¡É½ÜÉ•Í•ÉÙ…Ñ¥½¹ÉÉ½Èì(€½¹ÍÐÉ•Í•ÉÙ•‘	å%¹Ù½¥”€ô¹•Ü5…À ¤ì(€™½È€¡½¹ÍÐÉ•Í•ÉÙ…Ñ¥½¸½˜É•Í•ÉÙ…Ñ¥½¹Ìñðmt¤ì(€€€¥˜€¡É•Í•ÉÙ…Ñ¥½¸¹¥€ôôô¥¹ÍÑÉÕÑ¥½¸¹¥ñðl9½ÐI•ÅÕ¥É•œ°€MÕÁ•ÉÍ•‘•t¹¥¹±Õ‘•Ì¡É•Í•ÉÙ…Ñ¥½¸¹ÍÑ…ÑÕÌ¤¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐ­•ä€ôMÑÉ¥¹œ¡É•Í•ÉÙ…Ñ¥½¸¹Ñ…É•Ñ}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥ñð€œœ¤¹Í±¥” À°€ÄÔ¤ì(€€€É•Í•ÉÙ•‘	å%¹Ù½¥”¹Í•Ð¡­•ä°9Õµ‰•È¡É•Í•ÉÙ•‘	å%¹Ù½¥”¹•Ð¡­•ä¤ñð€À¤€¬9Õµ‰•È¡É•Í•ÉÙ…Ñ¥½¸¹Á±…¹¹•‘}…µ½Õ¹Ðñð€À¤¤ì(€ô(€½¹ÍÐ…Ù…¥±…‰±•=ÁÑ¥½¹Ì€ô½ÁÑ¥½¹Ì(€€€€¹µ…À ¡½ÁÑ¥½¸¤€ôøì(€€€€€½¹ÍÐÉ•Í•ÉÙ•‘µ½Õ¹Ð€ô9Õµ‰•È¡É•Í•ÉÙ•‘	å%¹Ù½¥”¹•Ð¡MÑÉ¥¹œ¡½ÁÑ¥½¸¹ÍÕÁÁ±¥•É%¹Ù½¥•%ñð€œœ¤¹Í±¥” À°€ÄÔ¤¤ñð€À¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹½ÁÑ¥½¸°(€€€€€€€É•Í•ÉÙ•‘µ½Õ¹Ð°(€€€€€€€Õ¹É•Í•ÉÙ•‘A…å…‰±•	…±…¹”è5…Ñ ¹µ…à À°9Õµ‰•È¡½ÁÑ¥½¸¹Á…å…‰±•	…±…¹”ñð€À¤€´É•Í•ÉÙ•‘µ½Õ¹Ð¤°(€€€€€ôì(€€€ô¤(€€€€¹™¥±Ñ•È ¡½ÁÑ¥½¸¤€ôø½ÁÑ¥½¸¹Õ¹É•Í•ÉÙ•‘A…å…‰±•	…±…¹”€¬€À¸ÀÄ€øô9Õµ‰•È¡¥¹ÍÑÉÕÑ¥½¸¹Á±…¹¹•‘}…µ½Õ¹Ðñð€À¤¤ì(€É•ÑÕÉ¸ì½ÁÑ¥½¹Ìè…Ù…¥±…‰±•=ÁÑ¥½¹Ìôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½ÝMÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹UÁ‘…Ñ”¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…½Õ¹Ðœ°€¥ÍÁÕÑ”…½Õ¹Ñ¥¹œÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•™½ÈÍÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¹Ì¸œ¤ì(€½¹ÍÐ¥¹ÍÑÉÕÑ¥½¹%€ôMÑÉ¥¹œ¡‰½‘ä¹¥¹ÍÑÉÕÑ¥½¹%ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …¥¹ÍÑÉÕÑ¥½¹%¤Ñ¡É½Ü…ÁÁÉÉ½È ¥¹ÍÑÉÕÑ¥½¹%¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐì‘…Ñ„è½É¥¥¹…±%¹ÍÑÉÕÑ¥½¸°•ÉÉ½Èè±½½­ÕÁÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}Ý½É­™±½Ý}ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}MUAA1%I}%9MQIUQ%=9}M1P¤¹•Ä ¥œ°¥¹ÍÑÉÕÑ¥½¹%¤¹µ…å‰•M¥¹±” ¤ì(€¥˜€¡±½½­ÕÁÉÉ½È¤Ñ¡É½Ü±½½­ÕÁÉÉ½Èì(€¥˜€ …½É¥¥¹…±%¹ÍÑÉÕÑ¥½¸¤Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸¹½Ð™½Õ¹¸œ°€ÐÀÐ¤ì(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°½É¥¥¹…±%¹ÍÑÉÕÑ¥½¸¹…Í•}¥¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ô…Ý…¥Ð±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€¥˜€ …¡…ÍU¹…•ÁÑ•‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡…Í•I½Ü°ÕÉÉ•¹ÑMÑ•´¤¤…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€±•ÐÝ½É­™±½Ü€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÉ•¥ÍÑÉä€ô…ÍÍ•ÉÑY…±¥‘¥ÍÁÕÑ•A…ÉÑ¥•Ì¡ÕÉÉ•¹ÑMÑ•´°Ý½É­™±½Ü¹Á…ÉÑåI½ÝÌ¤ì(€Ù…±¥‘…Ñ•MÑ½É•‘¥ÍÁÕÑ•Ñ¥½¹Ì¡Ý½É­™±½Ü¹…Ñ¥½¹I½ÝÌ°Ý½É­™±½Ü¹Á…ÉÑåI½ÝÌ°É•¥ÍÑÉä¤ì(€…ÍÍ•ÉÑMÕÁÁ±¥•É¥ÍÁÕÑ•µ½Õ¹ÑÌ¡Ý½É­™±½Ü¹…Ñ¥½¹I½ÝÌ¤ì(€½¹ÍÐÉ•½¹¥±¥…Ñ¥½¸€ô…Ý…¥ÐÉ•½¹¥±•ÁÁÉ½Ù•‘MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü°Ý½É­™±½Ü¹Á…ÉÑåI½ÝÌ°Ý½É­™±½Ü¹…Ñ¥½¹I½ÝÌ°Ý½É­™±½Ü¹¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”¤ì(€¥˜€¡É•½¹¥±¥…Ñ¥½¸¹¡…¹•¤Ý½É­™±½Ü€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐ¥¹ÍÑÉÕÑ¥½¸€ôÝ½É­™±½Ü¹¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹¥€ôôô¥¹ÍÑÉÕÑ¥½¹%¤ì(€¥˜€ …¥¹ÍÑÉÕÑ¥½¸ñð¥¹ÍÑÉÕÑ¥½¸¹ÍÑ…ÑÕÌ€ôôô€MÕÁ•ÉÍ•‘•œ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•ÈÁ…åµ•¹Ð‘…Ñ„¡…¹•…¹Ñ¡¥Ì¥¹ÍÑÉÕÑ¥½¸Ý…ÌÉ•Á±…•¸I•Ù¥•ÜÑ¡”ÕÁ‘…Ñ•…½Õ¹Ñ¥¹œÁ±…¸¸œ°€ÐÀä¤ì(€ô(€½¹ÍÐÉ•ÅÕ•ÍÑ•‘I•Ù¥Í¥½¸€ô9Õµ‰•È¡‰½‘ä¹É•Ù¥Í¥½¸¤ì(€¥˜€¡9Õµ‰•È¹¥Í%¹Ñ••È¡É•ÅÕ•ÍÑ•‘I•Ù¥Í¥½¸¤€˜˜É•ÅÕ•ÍÑ•‘I•Ù¥Í¥½¸€„ôô9Õµ‰•È¡¥¹ÍÑÉÕÑ¥½¸¹É•Ù¥Í¥½¸ñð€Ä¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡¥ÌÍÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸¡…¹•…™Ñ•È¥ÐÝ…Ì½Á•¹•¸I•™É•Í …¹É•Ù¥•ÜÑ¡”±…Ñ•ÍÐÙ…±Õ•Ì¸œ°€ÐÀä¤ì(€ô(€½¹ÍÐÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡‰½‘ä¹ÍÑ…ÑÕÌñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …%MAUQ}MUAA1%I}%9MQIUQ%=9}MQQUML¹¡…Ì¡ÍÑ…ÑÕÌ¤ñðÍÑ…ÑÕÌ€ôôô€MÕÁ•ÉÍ•‘•œ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥ÍÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸ÍÑ…ÑÕÌ¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€ô(€¥˜€¡…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€„ôô€ÁÁÉ½Ù•œ¤ì(€€€¥˜€¡¥¹ÍÑÉÕÑ¥½¸¹¥¹ÍÑÉÕÑ¥½¹}ÑåÁ”€„ôô€Ý¥Ñ¡¡½±‘}Õ¹Á…¥œñðÍÑ…ÑÕÌ€„ôô€!½±­¹½Ý±•‘•œ¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È 	•™½É”…ÁÁÉ½Ù…°°¥¹…¹”…¸½¹±ä…­¹½Ý±•‘”…¸¥µµ•‘¥…Ñ”¼¹½ÐÁ…ä¥¹ÍÑÉÕÑ¥½¸¸œ°€ÐÀÀ¤ì(€€€ô(€ô(€½¹ÍÐ¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”€ôMÑÉ¥¹œ¡‰½‘ä¹¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐ¥¹ÍÑÉÕÑ¥½¹…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹¥¹ÍÑÉÕÑ¥½¹…Ñ”ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€½¹ÍÐÍ•ÑÑ±•µ•¹ÑI•™•É•¹”€ôMÑÉ¥¹œ¡‰½‘ä¹Í•ÑÑ±•µ•¹ÑI•™•É•¹”ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐÍ•ÑÑ±•µ•¹Ñ…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹Í•ÑÑ±•µ•¹Ñ…Ñ”ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€½¹ÍÐ…½Õ¹Ñ¥¹9½Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹…½Õ¹Ñ¥¹9½Ñ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€¡¥¹ÍÑÉÕÑ¥½¹…Ñ”€˜˜€„½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡¥¹ÍÑÉÕÑ¥½¹…Ñ”¤¤Ñ¡É½Ü…ÁÁÉÉ½È %¹ÍÑÉÕÑ¥½¸‘…Ñ”¥Ì¥¹Ù…±¥¸œ°€ÐÀÀ¤ì(€¥˜€¡Í•ÑÑ±•µ•¹Ñ…Ñ”€˜˜€„½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡Í•ÑÑ±•µ•¹Ñ…Ñ”¤¤Ñ¡É½Ü…ÁÁÉÉ½È M•ÑÑ±•µ•¹Ð‘…Ñ”¥Ì¥¹Ù…±¥¸œ°€ÐÀÀ¤ì(€½¹ÍÐÉ•½Ù•Éå5•Ñ¡½€ô¥¹ÍÑÉÕÑ¥½¸¹¥¹ÍÑÉÕÑ¥½¹}ÑåÁ”€ôôô€•Ñ}‰…­}Á…¥œ€üMÑÉ¥¹œ¡‰½‘ä¹É•½Ù•Éå5•Ñ¡½ñð¥¹ÍÑÉÕÑ¥½¸¹É•½Ù•Éå}µ•Ñ¡½ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°€è¹Õ±°ì(€¥˜€¡¥¹ÍÑÉÕÑ¥½¸¹¥¹ÍÑÉÕÑ¥½¹}ÑåÁ”€ôôô€•Ñ}‰…­}Á…¥œ€˜˜l%¹ÍÑÉÕÑ¥½¸%ÍÍÕ•œ°€M•ÑÑ±•t¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÌ¤€˜˜€…l…Í¡}É•™Õ¹œ°€™ÕÑÕÉ•}¥¹Ù½¥•}½™™Í•Ðt¹¥¹±Õ‘•Ì¡É•½Ù•Éå5•Ñ¡½¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È ¡½½Í”…Í É•™Õ¹½È™ÕÑÕÉ”¥¹Ù½¥”½™™Í•Ð™½È•Ð‰…¬Á…¥…µ½Õ¹Ð¸œ°€ÐÀÀ¤ì(€ô(€¥˜€¡ÍÑ…ÑÕÌ€ôôô€%¹ÍÑÉÕÑ¥½¸%ÍÍÕ•œ€˜˜€ …¥¹ÍÑÉÕÑ¥½¹…Ñ”ñð€ …¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”€˜˜€……½Õ¹Ñ¥¹9½Ñ”¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È %¹ÍÑÉÕÑ¥½¸%ÍÍÕ•É•ÅÕ¥É•Ì…¸¥¹ÍÑÉÕÑ¥½¸‘…Ñ”…¹„É•™•É•¹”½È…½Õ¹Ñ¥¹œ¹½Ñ”¸œ°€ÐÀÀ¤ì(€ô(€¥˜€¡ÍÑ…ÑÕÌ€ôôô€9½ÐI•ÅÕ¥É•œ€˜˜€……½Õ¹Ñ¥¹9½Ñ”¤Ñ¡É½Ü…ÁÁÉÉ½È áÁ±…¥¸Ý¡äÑ¡¥ÌÍÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸¥Ì¹½ÐÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐ¡…ÍÙ¥‘•¹”€ô‘½Õµ•¹ÑÌ¹Í½µ” ¡‘½Õµ•¹Ð¤€ôø‘½Õµ•¹Ð¹ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¹}¥€ôôô¥¹ÍÑÉÕÑ¥½¸¹¥€˜˜lÍÕÁÁ±¥•É}É•‘¥Ñ}¹½Ñ”œ°€Í•ÑÑ±•µ•¹Ñ}…É••µ•¹Ðœ°€ÁÉ½½™}½™}Á…åµ•¹Ðt¹¥¹±Õ‘•Ì¡‘½Õµ•¹Ð¹‘½Õµ•¹Ñ}ÑåÁ”¤¤ì(€¥˜€¡ÍÑ…ÑÕÌ€ôôô€M•ÑÑ±•œ€˜˜€ …Í•ÑÑ±•µ•¹Ñ…Ñ”ñð€ …Í•ÑÑ±•µ•¹ÑI•™•É•¹”€˜˜€…¡…ÍÙ¥‘•¹”¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È M•ÑÑ±•É•ÅÕ¥É•Ì„Í•ÑÑ±•µ•¹Ð‘…Ñ”…¹•¥Ñ¡•È…¸ÕÁ±½…‘•ÍÕÁÁ±¥•È‘½Õµ•¹Ð½È„¥¹…¹”É•™•É•¹”¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐÁ±…¹¹•‘µ½Õ¹Ð€ô9Õµ‰•È¡¥¹ÍÑÉÕÑ¥½¸¹Á±…¹¹•‘}…µ½Õ¹Ðñð€À¤ì(€½¹ÍÐÍ•ÑÑ±•µ•¹Ñµ½Õ¹Ð€ô‘•¥µ…±=É9Õ±°¡‰½‘ä¹Í•ÑÑ±•µ•¹Ñµ½Õ¹Ð¤€üü€¡ÍÑ…ÑÕÌ€ôôô€M•ÑÑ±•œ€üÁ±…¹¹•‘µ½Õ¹Ð€è¹Õ±°¤ì(€¥˜€¡ÍÑ…ÑÕÌ€ôôô€M•ÑÑ±•œ€˜˜5…Ñ ¹…‰Ì¡9Õµ‰•È¡Í•ÑÑ±•µ•¹Ñµ½Õ¹Ðñð€À¤€´Á±…¹¹•‘µ½Õ¹Ð¤€ø€À¸ÀÄ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È M•ÑÑ±•µ•¹Ð…µ½Õ¹ÐµÕÍÐ•ÅÕ…°Ñ¡”ÕÉÉ•¹ÐÍÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸…µ½Õ¹Ð¸œ°€ÐÀÀ¤ì(€ô((€½¹ÍÐÁ…ÉÑä€ôÝ½É­™±½Ü¹Á…ÉÑåI½ÝÌ¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹¥€ôôô¥¹ÍÑÉÕÑ¥½¸¹Á…ÉÑå}¥¤ì(€±•ÐÑ…É•Ñ%¹Ù½¥”€ô¹Õ±°ì(€¥˜€¡É•½Ù•Éå5•Ñ¡½€ôôô€™ÕÑÕÉ•}¥¹Ù½¥•}½™™Í•Ðœ¤ì(€€€½¹ÍÐÑ…É•ÑMÕÁÁ±¥•É%¹Ù½¥•%€ôMÑÉ¥¹œ¡‰½‘ä¹Ñ…É•ÑMÕÁÁ±¥•É%¹Ù½¥•%ñð€œœ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …Ñ…É•ÑMÕÁÁ±¥•É%¹Ù½¥•%¤Ñ¡É½Ü…ÁÁÉÉ½È M•±•ÐÑ¡”ÍÕÁÁ±¥•È¥¹Ù½¥”Ñ¡…ÐÝ¥±°É••¥Ù”Ñ¡”½™™Í•Ð¸œ°€ÐÀÀ¤ì(€€€½¹ÍÐ½ÁÑ¥½¹Ì€ô…Ý…¥ÐÍÕÁÁ±¥•É=™™Í•Ñ%¹Ù½¥•=ÁÑ¥½¹Ì¡ì(€€€€€ÍÕÁÁ±¥•É½Õ¹Ñ%èÁ…ÉÑäü¹…½Õ¹Ñ}¥°(€€€€€ÕÉÉ•¹å%Í½½‘”è¥¹ÍÑÉÕÑ¥½¸¹ÕÉÉ•¹å}¥Í½}½‘”°(€€€€€•á±Õ‘•%¹Ù½¥•%‘Ìèm¥¹ÍÑÉÕÑ¥½¸¹Í½ÕÉ•}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥‘t°(€€€€€…•ÍÍ½¹Ñ•áÐè…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô°(€€€ô¤ì(€€€Ñ…É•Ñ%¹Ù½¥”€ô½ÁÑ¥½¹Ì¹™¥¹ ¡½ÁÑ¥½¸¤€ôøMÑÉ¥¹œ¡½ÁÑ¥½¸¹ÍÕÁÁ±¥•É%¹Ù½¥•%¤¹Í±¥” À°€ÄÔ¤€ôôôMÑÉ¥¹œ¡Ñ…É•ÑMÕÁÁ±¥•É%¹Ù½¥•%¤¹Í±¥” À°€ÄÔ¤¤ì(€€€¥˜€ …Ñ…É•Ñ%¹Ù½¥”¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•½™™Í•Ð¥¹Ù½¥”¥Ì¹¼±½¹•È•±¥¥‰±”™½ÈÑ¡¥ÌÍÕÁÁ±¥•È½Õ¹Ð…¹ÕÉÉ•¹ä¸œ°€ÐÀä¤ì(€€€¥˜€¡Ñ…É•Ñ%¹Ù½¥”¹Á…å…‰±•	…±…¹”€¬€À¸ÀÄ€ðÁ±…¹¹•‘µ½Õ¹Ð¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•½™™Í•Ð¥¹Ù½¥”‘½•Ì¹½Ð¡…Ù”•¹½Õ Á…å…‰±”‰…±…¹”¸œ°€ÐÀÀ¤ì(€ô(€±•Ðµ…Ñ¡•‘A…åµ•¹Ñ%€ô¹Õ±°ì(€±•Ðµ…Ñ¡•‘A…åµ•¹Ð€ô¹Õ±°ì(€¥˜€¡É•½Ù•Éå5•Ñ¡½€ôôô€…Í¡}É•™Õ¹œ€˜˜‰½‘ä¹µ…Ñ¡•‘M…±•Í™½É•A…åµ•¹Ñ%¤ì(€€€½¹ÍÐ•áÁ½ÍÕÉ”€ô€¡ÕÉÉ•¹ÑMÑ•´¹}MÕÁÁ±¥•É}%¹Ù½¥•}áÁ½ÍÕÉ•}I½ÝÌñðmt¤¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹ÍÕÁÁ±¥•É%¹Ù½¥•%€ôôô¥¹ÍÑÉÕÑ¥½¸¹Í½ÕÉ•}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥¤ì(€€€µ…Ñ¡•‘A…åµ•¹Ð€ô€¡•áÁ½ÍÕÉ”ü¹Á…åµ•¹ÑÌñðmt¤¹™¥¹ ¡É½Ü¤€ôøÉ½Ü¹¥€ôôô‰½‘ä¹µ…Ñ¡•‘M…±•Í™½É•A…åµ•¹Ñ%€˜˜9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð¤€ð€À€˜˜5…Ñ ¹…‰Ì¡5…Ñ ¹…‰Ì¡9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð¤¤€´Á±…¹¹•‘µ½Õ¹Ð¤€ðô€À¸ÀÄ€˜˜€¡É½Ü¹ÕÉÉ•¹å%Í½½‘”ñð€UMœ¤€ôôô¥¹ÍÑÉÕÑ¥½¸¹ÕÉÉ•¹å}¥Í½}½‘”¤ì(€€€¥˜€ …µ…Ñ¡•‘A…åµ•¹Ð¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•M…±•Í™½É”É•™Õ¹¹¼±½¹•Èµ…Ñ¡•ÌÑ¡¥ÌÍÕÁÁ±¥•È¥¹Ù½¥”°ÕÉÉ•¹ä°…¹…µ½Õ¹Ð¸œ°€ÐÀä¤ì(€€€µ…Ñ¡•‘A…åµ•¹Ñ%€ôµ…Ñ¡•‘A…åµ•¹Ð¹¥ì(€ô((€½¹ÍÐ•Ù•¹ÑQåÁ”€ôÍÑ…ÑÕÌ€ôôô€!½±­¹½Ý±•‘•œ€ü€ÍÕÁÁ±¥•É}¡½±‘}…­¹½Ý±•‘•œ€èÍÑ…ÑÕÌ€ôôô€M•ÑÑ±•œ€ü€ÍÕÁÁ±¥•É}É•½Ù•Éå}Í•ÑÑ±•œ€èÉ•½Ù•Éå5•Ñ¡½€˜˜É•½Ù•Éå5•Ñ¡½€„ôô¥¹ÍÑÉÕÑ¥½¸¹É•½Ù•Éå}µ•Ñ¡½€ü€ÍÕÁÁ±¥•É}É•½Ù•Éå}µ•Ñ¡½‘}Í•±•Ñ•œ€è€…½Õ¹Ñ¥¹}ÕÁ‘…Ñ•œì(€½¹ÍÐ•Ù•¹Ñ9½Ñ”€ô€‘í¥¹ÍÑÉÕÑ¥½¸¹¥¹ÍÑÉÕÑ¥½¹}ÑåÁ”€ôôô€Ý¥Ñ¡¡½±‘}Õ¹Á…¥œ€ü€¼¹½ÐÁ…äœ€è€•Ð‰…¬Á…¥…µ½Õ¹ÐôÕÁ‘…Ñ•Ñ¼€‘íÍÑ…ÑÕÍô¹€ì(€½¹ÍÐ¥¹ÍÑÉÕÑ¥½¹Y…±Õ•Ì€ôì(€€€ÍÑ…ÑÕÌ°(€€€É•½Ù•Éå}µ•Ñ¡½èÉ•½Ù•Éå5•Ñ¡½°(€€€Ñ…É•Ñ}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¥èÑ…É•Ñ%¹Ù½¥”ü¹ÍÕÁÁ±¥•É%¹Ù½¥•%ñð¹Õ±°°(€€€Ñ…É•Ñ}ÍÕÁÁ±¥•É}¥¹Ù½¥•}¹…µ”èÑ…É•Ñ%¹Ù½¥”ü¹¥¹Ù½¥•9…µ”ñð¹Õ±°°(€€€Ñ…É•Ñ}ÍÑ•µ}¥èÑ…É•Ñ%¹Ù½¥”ü¹ÍÑ•µ%ñð¹Õ±°°(€€€Ñ…É•Ñ}¥¹Ù½¥•}…µ½Õ¹Ñ}Í¹…ÁÍ¡½ÐèÑ…É•Ñ%¹Ù½¥”ü¹¥¹Ù½¥•µ½Õ¹Ð€üü¹Õ±°°(€€€Ñ…É•Ñ}Á…å…‰±•}…µ½Õ¹Ñ}Í¹…ÁÍ¡½ÐèÑ…É•Ñ%¹Ù½¥”ü¹Á…å…‰±•	…±…¹”€üü¹Õ±°°(€€€Ñ…É•Ñ}¥¹Ù½¥•}Í¹…ÁÍ¡½ÐèÑ…É•Ñ%¹Ù½¥”ñðíô°(€€€Ñ…É•Ñ}ÍÑ•µ}Í¹…ÁÍ¡½ÐèÑ…É•Ñ%¹Ù½¥”ü¹ÍÑ•µ%€üìÍÑ•µ%èÑ…É•Ñ%¹Ù½¥”¹ÍÑ•µ%ô€èíô°(€€€µ…Ñ¡•‘}Í…±•Í™½É•}Á…åµ•¹Ñ}¥èµ…Ñ¡•‘A…åµ•¹Ñ%°(€€€µ…Ñ¡¥¹}Á…åµ•¹Ñ}Í¹…ÁÍ¡½Ðèµ…Ñ¡•‘A…åµ•¹Ðñðíô°(€€€¥¹ÍÑÉÕÑ¥½¹}É•™•É•¹”è¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”ñð¹Õ±°°(€€€¥¹ÍÑÉÕÑ¥½¹}‘…Ñ”è¥¹ÍÑÉÕÑ¥½¹…Ñ”°(€€€¥¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ðè‘•¥µ…±=É9Õ±°¡‰½‘ä¹¥¹ÍÑÉÕÑ¥½¹µ½Õ¹Ð¤€üü€¡ÍÑ…ÑÕÌ€ôôô€%¹ÍÑÉÕÑ¥½¸%ÍÍÕ•œ€üÁ±…¹¹•‘µ½Õ¹Ð€è¹Õ±°¤°(€€€Í•ÑÑ±•µ•¹Ñ}É•™•É•¹”èÍ•ÑÑ±•µ•¹ÑI•™•É•¹”ñð¹Õ±°°(€€€Í•ÑÑ±•µ•¹Ñ}‘…Ñ”èÍ•ÑÑ±•µ•¹Ñ…Ñ”°(€€€Í•ÑÑ±•µ•¹Ñ}…µ½Õ¹ÐèÍ•ÑÑ±•µ•¹Ñµ½Õ¹Ð°(€€€…½Õ¹Ñ¥¹}¹½Ñ”è…½Õ¹Ñ¥¹9½Ñ”ñð¹Õ±°°(€€€•Ù•¹Ñ}ÑåÁ”è•Ù•¹ÑQåÁ”°(€€€•Ù•¹Ñ}¹½Ñ”è•Ù•¹Ñ9½Ñ”°(€€€•Ù•¹Ñ}µ•Ñ…‘…Ñ„èì(€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹%è¥¹ÍÑÉÕÑ¥½¸¹¥°(€€€€€É•½Ù•Éå5•Ñ¡½°(€€€€€Ñ…É•ÑMÕÁÁ±¥•É%¹Ù½¥•%èÑ…É•Ñ%¹Ù½¥”ü¹ÍÕÁÁ±¥•É%¹Ù½¥•%ñð¹Õ±°°(€€€€€µ…Ñ¡•‘M…±•Í™½É•A…åµ•¹Ñ%èµ…Ñ¡•‘A…åµ•¹Ñ%°(€€€€€Á±…¹¹•‘µ½Õ¹Ð°(€€€€€ÕÉÉ•¹å%Í½½‘”è¥¹ÍÑÉÕÑ¥½¸¹ÕÉÉ•¹å}¥Í½}½‘”°(€€€ô°(€ôì(€½¹ÍÐì•ÉÉ½ÈèÕÁ‘…Ñ•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹ÉÁŒ ÕÁ‘…Ñ•}‘¥ÍÁÕÑ•}ÍÕÁÁ±¥•É}¥¹ÍÑÉÕÑ¥½¸œ°ì(€€€Á}¥¹ÍÑÉÕÑ¥½¹}¥è¥¹ÍÑÉÕÑ¥½¸¹¥°(€€€Á}•áÁ•Ñ•‘}É•Ù¥Í¥½¸è9Õµ‰•È¡¥¹ÍÑÉÕÑ¥½¸¹É•Ù¥Í¥½¸ñð€Ä¤°(€€€Á}Ù…±Õ•Ìè¥¹ÍÑÉÕÑ¥½¹Y…±Õ•Ì°(€€€Á}Ñ…É•Ñ}Á…å…‰±•}…µ½Õ¹ÐèÑ…É•Ñ%¹Ù½¥”ü¹Á…å…‰±•	…±…¹”€üü¹Õ±°°(€€€Á}…Ñ½Èèì¥èÁÉ½™¥±”¹¥°•µ…¥°èÁÉ½™¥±”¹•µ…¥°ô°(€ô¤ì(€¥˜€¡ÕÁ‘…Ñ•ÉÉ½È¤ì(€€€¥˜€¡MÑÉ¥¹œ¡ÕÁ‘…Ñ•ÉÉ½È¹µ•ÍÍ…”ñð€œœ¤¹¥¹±Õ‘•Ì É•Ù¥Í¥½¸½¹™±¥Ðœ¤¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡¥ÌÍÕÁÁ±¥•È¥¹ÍÑÉÕÑ¥½¸Ý…ÌÕÁ‘…Ñ•‰ä…¹½Ñ¡•ÈÕÍ•È¸I•™É•Í …¹ÑÉä……¥¸¸œ°€ÐÀä¤ì(€€€ô(€€€¥˜€¡MÑÉ¥¹œ¡ÕÁ‘…Ñ•ÉÉ½È¹µ•ÍÍ…”ñð€œœ¤¹¥¹±Õ‘•Ì …±É•…‘äÉ•Í•ÉÙ•œ¤¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡”Í•±•Ñ•½™™Í•Ð¥¹Ù½¥”¹¼±½¹•È¡…Ì•¹½Õ Õ¹É•Í•ÉÙ•Á…å…‰±”‰…±…¹”¸I•™É•Í Ñ¡”½™™Í•Ð½ÁÑ¥½¹Ì¸œ°€ÐÀä¤ì(€€€ô(€€€Ñ¡É½ÜÕÁ‘…Ñ•ÉÉ½Èì(€ô((€¥˜€¡…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€„ôô€ÁÁÉ½Ù•œ¤ì(€€€½¹ÍÐÉ•™É•Í¡•€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€€€É•ÑÕÉ¸ì(€€€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡…Í•I½Ü¤°(€€€€€Á…ÉÑ¥•ÌèÉ•™É•Í¡•¹Á…ÉÑåI½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¤°(€€€€€…Ñ¥½¹ÌèÉ•™É•Í¡•¹…Ñ¥½¹Ì°(€€€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹ÌèÉ•™É•Í¡•¹ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì°(€€€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤°(€€€ôì(€ô(€±•ÐÕÁ‘…Ñ•‘…Í”€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€ÕÁ‘…Ñ•‘…Í”€ô…Ý…¥ÐÁ•ÉÍ¥ÍÑ¥ÍÁÕÑ•½Õ¹Ñ¥¹MÑ…ÑÕÌ¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”°ÕÁ‘…Ñ•‘…Í”¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ¤ì(€½¹ÍÐÉ•™É•Í¡•€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€É•ÑÕÉ¸ì(€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡ÕÁ‘…Ñ•‘…Í”¤°(€€€Á…ÉÑ¥•ÌèÝ½É­™±½Ü¹Á…ÉÑåI½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¤°(€€€…Ñ¥½¹ÌèÉ•™É•Í¡•¹…Ñ¥½¹Ì°(€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹ÌèÉ•™É•Í¡•¹ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì°(€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½ÝMÕÁÁ±¥•Éµ½Õ¹Ñµ•¹¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ…Ñ¥½¹%€ôMÑÉ¥¹œ¡‰½‘ä¹…Ñ¥½¹%ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐ…µ½Õ¹Ð€ô‘•¥µ…±=É9Õ±°¡‰½‘ä¹‘¥ÍÁÕÑ•µ½Õ¹Ð€üü‰½‘ä¹…µ½Õ¹Ð¤ì(€½¹ÍÐ¹½Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ”ñð‰½‘ä¹‘•ÍÉ¥ÁÑ¥½¸ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐÕÉÉ•¹å%Í½½‘”€ôMÑÉ¥¹œ¡‰½‘ä¹ÕÉÉ•¹å%Í½½‘”ñð€UMœ¤(€€€€¹ÑÉ¥´ ¤(€€€€¹Ñ½UÁÁ•É…Í” ¤ì(€¥˜€ ……Ñ¥½¹%¤Ñ¡É½Ü…ÁÁÉÉ½È …Ñ¥½¹%¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€¥˜€¡…µ½Õ¹Ð€ôô¹Õ±°ñð…µ½Õ¹Ð€ð€À¤Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•È‘¥ÍÁÕÑ”…µ½Õ¹ÐµÕÍÐ‰”é•É¼½ÈÉ•…Ñ•È¸œ°€ÐÀÀ¤ì(€¥˜€ „½ymµiuìÍô¼¹Ñ•ÍÐ¡ÕÉÉ•¹å%Í½½‘”¤¤Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•È‘¥ÍÁÕÑ”ÕÉÉ•¹äµÕÍÐ‰”„Ñ¡É•”µ±•ÑÑ•È%M<½‘”¸œ°€ÐÀÀ¤ì(€¥˜€¡…µ½Õ¹Ð€ôôô€À€˜˜€…¹½Ñ”¤Ñ¡É½Ü…ÁÁÉÉ½È áÁ±…¥¸Ý¡ä¹¼ÍÕÁÁ±¥•ÈÉ•½Ù•Éä¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐì‘…Ñ„è…Ñ¥½¸°•ÉÉ½Èè…Ñ¥½¹ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}Q%=9}M1P¤¹•Ä ¥œ°…Ñ¥½¹%¤¹µ…å‰•M¥¹±” ¤ì(€¥˜€¡…Ñ¥½¹ÉÉ½È¤Ñ¡É½Ü…Ñ¥½¹ÉÉ½Èì(€¥˜€ ……Ñ¥½¸ñð…Ñ¥½¸¹Á…ÉÑå}Í¥‘”€„ôô€ÍÕÁÁ±¥•Èœ¤Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•È…Ñ¥½¸¹½Ð™½Õ¹¸œ°€ÐÀÐ¤ì(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°…Ñ¥½¸¹…Í•}¥¤ì(€½¹ÍÐ…Ñ½Éµ…¥°€ôMÑÉ¥¹œ¡ÁÉ½™¥±”¹•µ…¥°ñð€œœ¤(€€€€¹ÑÉ¥´ ¤(€€€€¹Ñ½1½Ý•É…Í” ¤ì(€½¹ÍÐÉ•ÍÁ½¹Í¥‰±•QÉ…‘•È€ô(€€€…Ñ¥½¸¹É•…Ñ•‘}‰ä€ôôôÁÉ½™¥±”¹¥ñð(€€€…Í•I½Ü¹ÍÕ‰µ¥ÑÑ•‘}‰ä€ôôôÁÉ½™¥±”¹¥ñð(€€€m…Ñ¥½¸¹É•…Ñ•‘}‰å}•µ…¥°°…Í•I½Ü¹ÍÕ‰µ¥ÑÑ•‘}‰å}•µ…¥±t¹Í½µ” (€€€€€€¡•µ…¥°¤€ôø(€€€€€€€MÑÉ¥¹œ¡•µ…¥°ñð€œœ¤(€€€€€€€€€€¹ÑÉ¥´ ¤(€€€€€€€€€€¹Ñ½1½Ý•É…Í” ¤€ôôô…Ñ½Éµ…¥°°(€€€€¤ì(€¥˜€ …¥Í‘µ¥¹¥ÍÑÉ…Ñ½ÉUÍ•ÉQåÁ”¡ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”¤€˜˜€…É•ÍÁ½¹Í¥‰±•QÉ…‘•È¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È =¹±äÑ¡”É•ÍÁ½¹Í¥‰±”ÑÉ…‘•È½È…¸…‘µ¥¹¥ÍÑÉ…Ñ½È…¸É•½ÉÑ¡¥ÌÍÕÁÁ±¥•È‘¥ÍÁÕÑ”…µ½Õ¹Ð¸œ°€ÐÀÌ¤ì(€ô(€¥˜€¡…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ€ôôô€±½Í•œ¤Ñ¡É½Ü…ÁÁÉÉ½È ±½Í•‘¥ÍÁÕÑ•Ì…¹¹½Ð‰”…µ•¹‘•¸œ°€ÐÀÀ¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ô…Ý…¥Ð±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€¥˜€ …¡…ÍU¹…•ÁÑ•‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡…Í•I½Ü°ÕÉÉ•¹ÑMÑ•´¤¤…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€½¹ÍÐÝ½É­™±½Ü€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÉ•¥ÍÑÉä€ô…ÍÍ•ÉÑY…±¥‘¥ÍÁÕÑ•A…ÉÑ¥•Ì¡ÕÉÉ•¹ÑMÑ•´°Ý½É­™±½Ü¹Á…ÉÑåI½ÝÌ¤ì(€Ù…±¥‘…Ñ•MÑ½É•‘¥ÍÁÕÑ•Ñ¥½¹Ì¡Ý½É­™±½Ü¹…Ñ¥½¹I½ÝÌ°Ý½É­™±½Ü¹Á…ÉÑåI½ÝÌ°É•¥ÍÑÉä¤ì(€½¹ÍÐÁ…ÉÑå	å%€ô‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Ý½É­™±½Ü¹Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐ•á¥ÍÑ¥¹µ½Õ¹Ð€ô‘•¥µ…±=É9Õ±°¡…Ñ¥½¸¹…µ½Õ¹Ð¤ì(€½¹ÍÐ½µµ•É¥…±µ½Õ¹Ñ¡…¹•€ô•á¥ÍÑ¥¹µ½Õ¹Ð€ôô¹Õ±°ñð5…Ñ ¹…‰Ì¡•á¥ÍÑ¥¹µ½Õ¹Ð€´…µ½Õ¹Ð¤€ø€À¸ÀÄì(€½¹ÍÐ•‘¥Ñ…‰±•MÑ…”€ôlÉ…™Ðœ°€I•©•Ñ•œ°€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•t¹¥¹±Õ‘•Ì¡…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ¤ì(€½¹ÍÐ…µ•¹‘•‘MÑ…”€ô•‘¥Ñ…‰±•MÑ…”€ü…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ€è½µµ•É¥…±µ½Õ¹Ñ¡…¹•€ü€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•œ€è…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€ôôô€ÁÁÉ½Ù•œ€ü€½Õ¹Ñ¥¹œ%¸AÉ½É•ÍÌœ€è…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌì(€½¹ÍÐ…µ•¹‘•‘ÁÁÉ½Ù…°€ô…µ•¹‘•‘MÑ…”€ôôô€É…™Ðœ€ü€É…™Ðœ€è…µ•¹‘•‘MÑ…”€ôôô€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•œ€ü€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•œ€è…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌì(€½¹ÍÐÉÁÑ¥½¹Ì€ôÝ½É­™±½Ü¹…Ñ¥½¹I½ÝÌ¹µ…À ¡É½Ü¤€ôøì(€€€½¹ÍÐÁ…ÉÑä€ôÁ…ÉÑå	å%¹•Ð¡É½Ü¹Á…ÉÑå}¥¤ì(€€€½¹ÍÐ‰…Í”€ôì(€€€€€€¸¸¹É½Ü°(€€€€€Á…ÉÑå}…½Õ¹Ñ}­•äèÁ…ÉÑäü¹…½Õ¹Ñ}­•ä°(€€€ôì(€€€¥˜€¡É½Ü¹¥€„ôô…Ñ¥½¸¹¥¤É•ÑÕÉ¸‰…Í”ì(€€€É•ÑÕÉ¸ÁÉ•Á…É•MÕÁÁ±¥•ÉM•ÑÑ±•µ•¹ÑÑ¥½¸ (€€€€€ì(€€€€€€€€¸¸¹‰…Í”°(€€€€€€€…Ñ¥½¹}ÑåÁ”è€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ°(€€€€€€€…Ñ¥½¹}±…‰•°è%MAUQ}	Q}Q%=9}1	1L¹É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”°(€€€€€€€…µ½Õ¹Ð°(€€€€€€€ÍÁ•¥…±}‰Õå}ÁÉ¥”è¹Õ±°°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è¹½Ñ”ñðÉ½Ü¹‘•ÍÉ¥ÁÑ¥½¸ñð€œœ°(€€€€€€€ÕÉÉ•¹å}¥Í½}½‘”èÕÉÉ•¹å%Í½½‘”°(€€€€€€€¥¹Ù½¥•}…±±½…Ñ¥½¹ÌèÉÉ…ä¹¥ÍÉÉ…ä¡‰½‘ä¹¥¹Ù½¥•±±½…Ñ¥½¹Ì¤€ü‰½‘ä¹¥¹Ù½¥•±±½…Ñ¥½¹Ì€èmt°(€€€€€€€•á•ÕÑ¥½¹}ÍÑ…ÑÕÌè€A•¹‘¥¹œ½Õ¹Ñ¥¹œœ°(€€€€€ô°(€€€€€ÕÉÉ•¹ÑMÑ•´°(€€€€¤ì(€ô¤ì(€½¹ÍÐ™¥¹…¹¥…±Ì€ô…±Õ±…Ñ•¥ÍÁÕÑ•	•Ñ…M•ÑÑ±•µ•¹Ð¡ÉÁÑ¥½¹Ì¤ì(€½¹ÍÐÍ…±•Í™½É•MÑ…ÑÕÌ€ô…µ•¹‘•‘MÑ…”€ôôô€É…™Ðœ€ü€=Á•¸€´QÉ…‘•ÈI•Ù¥•Üœ€è…µ•¹‘•‘MÑ…”ì(€½¹ÍÐ…Í•A…å±½…€ôì(€€€€¸¸¹‘¥ÍÁÕÑ•	•Ñ……Í•É½µMÑ•´¡ÕÉÉ•¹ÑMÑ•´¤°(€€€ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌèÍ…±•Í™½É•MÑ…ÑÕÌ°(€€€Ý½É­™±½Ý}ÍÑ…ÑÕÌè…µ•¹‘•‘MÑ…”°(€€€…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌè…µ•¹‘•‘ÁÁÉ½Ù…°°(€€€±…Ñ•ÍÑ}¹½Ñ”è¹½Ñ”ñð€MÕÁÁ±¥•È‘¥ÍÁÕÑ”…µ½Õ¹ÐÉ•½É‘•¸œ°(€€€Í•ÑÑ±•µ•¹Ñ}™¥¹…¹¥…±Ìè™¥¹…¹¥…±Ì°(€€€Í•ÑÑ±•µ•¹Ñ}Á¹°è™¥¹…¹¥…±Ì¹Í•ÑÑ±•µ•¹ÑA¹°°(€ôì(€½¹ÍÐì‘…Ñ„èÍ…Ù•‘…Í•%°•ÉÉ½ÈèÍ…Ù•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹ÉÁŒ Í…Ù•}‘¥ÍÁÕÑ•}Ý½É­™±½Ý}‘É…™Ðœ°ì(€€€Á}…Í”è…Í•A…å±½…°(€€€Á}Á…ÉÑ¥•ÌèÝ½É­™±½Ü¹Á…ÉÑåI½ÝÌ¹µ…À ¡Á…ÉÑä¤€ôø€¡ì(€€€€€…½Õ¹Ñ}¥èÁ…ÉÑä¹…½Õ¹Ñ}¥°(€€€€€…½Õ¹Ñ}­•äèÁ…ÉÑä¹…½Õ¹Ñ}­•ä°(€€€€€…½Õ¹Ñ}¹…µ”èÁ…ÉÑä¹…½Õ¹Ñ}¹…µ”°(€€€€€É½±•ÌèÁ…ÉÑä¹É½±•Ì°(€€€€€Í½ÕÉ•}ÑåÁ•ÌèÁ…ÉÑä¹Í½ÕÉ•}ÑåÁ•Ì°(€€€€€Í½ÕÉ•}É•½É‘}¥‘ÌèÁ…ÉÑä¹Í½ÕÉ•}É•½É‘}¥‘Ì°(€€€€€Á…åµ•¹Ñ}Ñ•ÉµÌèÁ…ÉÑä¹Á…åµ•¹Ñ}Ñ•ÉµÌ°(€€€€€ÁÉ½‘ÕÑÌèÁ…ÉÑä¹ÁÉ½‘ÕÑÌ°(€€€€€…¹•±±•‘}Í½ÕÉ•}½¹±äèÁ…ÉÑä¹…¹•±±•‘}Í½ÕÉ•}½¹±ä°(€€€ô¤¤°(€€€Á}…Ñ¥½¹ÌèÉÁÑ¥½¹Ì°(€€€Á}…Ñ½Èèì¥èÁÉ½™¥±”¹¥°•µ…¥°èÁÉ½™¥±”¹•µ…¥°ô°(€€€Á}•Ù•¹Ñ}¹½Ñ”è¹½Ñ”ñð€MÕÁÁ±¥•È‘¥ÍÁÕÑ”…µ½Õ¹ÐÉ•½É‘•¸œ°(€ô¤ì(€¥˜€¡Í…Ù•ÉÉ½È¤Ñ¡É½ÜÍ…Ù•ÉÉ½Èì(€½¹ÍÐÕÁ‘…Ñ•‘…Í”€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°Í…Ù•‘…Í•%ñð…Í•I½Ü¹¥¤ì(€…Ý…¥ÐÁ…Ñ¡¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍ%¹M…±•Í™½É”¡ÕÁ‘…Ñ•‘…Í”°Í…±•Í™½É•MÑ…ÑÕÌ¤ì(€½¹ÍÐÍÑ…ÑÕÍ…Í”€ô…Ý…¥ÐÉ•½É‘¥ÍÁÕÑ•]½É­™±½ÝM…±•Í™½É•]É¥Ñ•‰…¬¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°ÁÉ½™¥±”°Í…±•Í™½É•MÑ…ÑÕÌ¤ì(€¥˜€¡…µ•¹‘•‘MÑ…”€ôôô€I•Ù¥Í¥½¸I•ÅÕ•ÍÑ•œ¤ì(€€€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°ÍÑ…ÑÕÍ…Í”°€É•Ù¥Í¥½¹}É•ÅÕ•ÍÑ•œ°ÁÉ½™¥±”°ì(€€€€€…Ñ¥½¹%è…Ñ¥½¸¹¥°(€€€€€¹½Ñ”è€MÕÁÁ±¥•È‘¥ÍÁÕÑ”…µ½Õ¹Ð…‘‘•Ñ¼…¸•á¥ÍÑ¥¹œÝ½É­™±½Üì…ÁÁÉ½Ù…°¥ÌÉ•ÅÕ¥É•……¥¸¸œ°(€€€€€µ•Ñ…‘…Ñ„èì‘¥ÍÁÕÑ•µ½Õ¹Ðè…µ½Õ¹Ð°ÕÉÉ•¹å%Í½½‘”ô°(€€€ô¤ì(€ô•±Í”¥˜€ …½µµ•É¥…±µ½Õ¹Ñ¡…¹•€˜˜…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”€„ôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ¤ì(€€€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°ÍÑ…ÑÕÍ…Í”°€ÍÕÁÁ±¥•É}Á…åµ•¹Ñ}É•½¹¥±•œ°ÁÉ½™¥±”°ì(€€€€€…Ñ¥½¹%è…Ñ¥½¸¹¥°(€€€€€¹½Ñ”è€á¥ÍÑ¥¹œÍÕÁÁ±¥•È…µ½Õ¹Ð½¹Ù•ÉÑ•¥¹Ñ¼¥¹Ù½¥”µ±•Ù•°¥¹…¹”¥¹ÍÑÉÕÑ¥½¹Ì¸œ°(€€€€€µ•Ñ…‘…Ñ„èì‘¥ÍÁÕÑ•µ½Õ¹Ðè…µ½Õ¹Ð°ÕÉÉ•¹å%Í½½‘”ô°(€€€ô¤ì(€ô(€½¹ÍÐÉ•™É•Í¡•€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€É•ÑÕÉ¸ì(€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡ÍÑ…ÑÕÍ…Í”¤°(€€€Á…ÉÑ¥•ÌèÉ•™É•Í¡•¹Á…ÉÑåI½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¤°(€€€…Ñ¥½¹ÌèÉ•™É•Í¡•¹…Ñ¥½¹Ì°(€€€ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹ÌèÉ•™É•Í¡•¹ÍÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì°(€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½Ý½Õ¹Ñ¥¹UÁ‘…Ñ”¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…½Õ¹Ðœ°€¥ÍÁÕÑ”…½Õ¹Ñ¥¹œÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•™½È…½Õ¹Ñ¥¹œÕÁ‘…Ñ•Ì¸œ¤ì(€½¹ÍÐ…Ñ¥½¹%€ôMÑÉ¥¹œ¡‰½‘ä¹…Ñ¥½¹%ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ ……Ñ¥½¹%¤Ñ¡É½Ü…ÁÁÉÉ½È …Ñ¥½¹%¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐì‘…Ñ„è…Ñ¥½¸°•ÉÉ½Èè…Ñ¥½¹1½½­ÕÁÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}Q%=9}M1P¤¹•Ä ¥œ°…Ñ¥½¹%¤¹µ…å‰•M¥¹±” ¤ì(€¥˜€¡…Ñ¥½¹1½½­ÕÁÉÉ½È¤Ñ¡É½Ü…Ñ¥½¹1½½­ÕÁÉÉ½Èì(€¥˜€ ……Ñ¥½¸¤Ñ¡É½Ü…ÁÁÉÉ½È ¥ÍÁÕÑ”]½É­™±½Ü…Ñ¥½¸¹½Ð™½Õ¹¸œ°€ÐÀÐ¤ì(€¥˜€¡…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”€ôôô€É•Í½±Ù•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”œ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È UÁ‘…Ñ”•… ÍÕÁÁ±¥•È¥¹Ù½¥”¥¹ÍÑÉÕÑ¥½¸¥¹ÍÑ•…½˜Ñ¡”Á…É•¹ÐÍÕÁÁ±¥•ÈÉ•Í½±ÕÑ¥½¸¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°…Ñ¥½¸¹…Í•}¥¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐÁ…ÉÑåI½ÝÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑ¥•Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ô…Ý…¥Ð±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐ•áÑ•É¹…±±½ÍÕÉ”€ô¡…ÍU¹…•ÁÑ•‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡…Í•I½Ü°ÕÉÉ•¹ÑMÑ•´¤ì(€¥˜€ …•áÑ•É¹…±±½ÍÕÉ”¤…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€½¹ÍÐÉ•¥ÍÑÉä€ô…ÍÍ•ÉÑY…±¥‘¥ÍÁÕÑ•A…ÉÑ¥•Ì¡ÕÉÉ•¹ÑMÑ•´°Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐÍÑ½É•‘]½É­™±½Ü€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€Ù…±¥‘…Ñ•MÑ½É•‘¥ÍÁÕÑ•Ñ¥½¹Ì¡ÍÑ½É•‘]½É­™±½Ü¹…Ñ¥½¹I½ÝÌ°Á…ÉÑåI½ÝÌ°É•¥ÍÑÉä¤ì(€…ÍÍ•ÉÑMÕÁÁ±¥•É¥ÍÁÕÑ•µ½Õ¹ÑÌ¡ÍÑ½É•‘]½É­™±½Ü¹…Ñ¥½¹I½ÝÌ¤ì(€¥˜€¡…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€„ôô€ÁÁÉ½Ù•œñð…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ€ôôô€±½Í•œ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È ½Õ¹Ñ¥¹œ…¸ÕÁ‘…Ñ”…Ñ¥½¹Ì½¹±ä…™Ñ•È…ÁÁÉ½Ù…°…¹‰•™½É”±½ÍÕÉ”¸œ°€ÐÀÀ¤ì(€ô(€…Ý…¥ÐÉ•½¹¥±•ÁÁÉ½Ù•‘MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü°Á…ÉÑåI½ÝÌ°ÍÑ½É•‘]½É­™±½Ü¹…Ñ¥½¹I½ÝÌ°ÍÑ½É•‘]½É­™±½Ü¹¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”¤ì((€½¹ÍÐ…½Õ¹Ñ¥¹MÑ…ÑÕÌ€ô¹½Éµ…±¥é•¥ÍÁÕÑ•	•Ñ…MÑ…ÑÕÌ¡‰½‘ä¹…½Õ¹Ñ¥¹MÑ…ÑÕÌñð‰½‘ä¹•á•ÕÑ¥½¹MÑ…ÑÕÌ°%MAUQ}	Q}aUQ%=9}MQQUML°€œœ¤ì(€¥˜€ ……½Õ¹Ñ¥¹MÑ…ÑÕÌ¤Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥…½Õ¹Ñ¥¹œÍÑ…ÑÕÌ¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐ¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”€ôMÑÉ¥¹œ¡‰½‘ä¹¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐ¥¹ÍÑÉÕÑ¥½¹…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹¥¹ÍÑÉÕÑ¥½¹…Ñ”ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€½¹ÍÐÍ•ÑÑ±•µ•¹ÑI•™•É•¹”€ôMÑÉ¥¹œ¡‰½‘ä¹Í•ÑÑ±•µ•¹ÑI•™•É•¹”ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐÍ•ÑÑ±•µ•¹Ñ…Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹Í•ÑÑ±•µ•¹Ñ…Ñ”ñð€œœ¤¹ÑÉ¥´ ¤ñð¹Õ±°ì(€½¹ÍÐ…½Õ¹Ñ¥¹9½Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹…½Õ¹Ñ¥¹9½Ñ”ñð‰½‘ä¹¹½Ñ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€¡¥¹ÍÑÉÕÑ¥½¹…Ñ”€˜˜€„½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡¥¹ÍÑÉÕÑ¥½¹…Ñ”¤¤Ñ¡É½Ü…ÁÁÉÉ½È %¹ÍÑÉÕÑ¥½¸‘…Ñ”¥Ì¥¹Ù…±¥¸œ°€ÐÀÀ¤ì(€¥˜€¡Í•ÑÑ±•µ•¹Ñ…Ñ”€˜˜€„½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡Í•ÑÑ±•µ•¹Ñ…Ñ”¤¤Ñ¡É½Ü…ÁÁÉÉ½È M•ÑÑ±•µ•¹Ð‘…Ñ”¥Ì¥¹Ù…±¥¸œ°€ÐÀÀ¤ì(€¥˜€¡…½Õ¹Ñ¥¹MÑ…ÑÕÌ€ôôô€%¹ÍÑÉÕÑ¥½¸%ÍÍÕ•œ€˜˜€ …¥¹ÍÑÉÕÑ¥½¹…Ñ”ñð€ …¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”€˜˜€……½Õ¹Ñ¥¹9½Ñ”¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È %¹ÍÑÉÕÑ¥½¸%ÍÍÕ•É•ÅÕ¥É•Ì…¸¥¹ÍÑÉÕÑ¥½¸‘…Ñ”…¹„É•™•É•¹”½È…½Õ¹Ñ¥¹œ¹½Ñ”¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐ¡…ÍM•ÑÑ±•µ•¹Ñ½Õµ•¹Ð€ô‘½Õµ•¹ÑÌ¹Í½µ” ¡‘½Õµ•¹Ð¤€ôø‘½Õµ•¹Ð¹…Ñ¥½¹}¥€ôôô…Ñ¥½¹%€˜˜lÍ•ÑÑ±•µ•¹Ñ}…É••µ•¹Ðœ°€‰Õå•É}É•‘¥Ñ}¹½Ñ”œ°€ÍÕÁÁ±¥•É}É•‘¥Ñ}¹½Ñ”œ°€ÁÉ½½™}½™}Á…åµ•¹Ðt¹¥¹±Õ‘•Ì¡‘½Õµ•¹Ð¹‘½Õµ•¹Ñ}ÑåÁ”¤¤ì(€¥˜€¡…½Õ¹Ñ¥¹MÑ…ÑÕÌ€ôôô€M•ÑÑ±•œ€˜˜€ …Í•ÑÑ±•µ•¹Ñ…Ñ”ñð€ …Í•ÑÑ±•µ•¹ÑI•™•É•¹”€˜˜€…¡…ÍM•ÑÑ±•µ•¹Ñ½Õµ•¹Ð¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È M•ÑÑ±•É•ÅÕ¥É•Ì„Í•ÑÑ±•µ•¹Ð‘…Ñ”…¹•¥Ñ¡•È„É•™•É•¹”½ÈÍ•ÑÑ±•µ•¹Ð‘½Õµ•¹Ð¸œ°€ÐÀÀ¤ì(€ô(€½¹ÍÐ¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä€ô‘¥ÍÁÕÑ•9½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¡…Ñ¥½¸°Á…ÉÑåI½ÝÌ°ÕÉÉ•¹ÑMÑ•´¤ì(€½¹ÍÐ¹½ÑI•ÅÕ¥É•‘I•…Í½¹]…¥Ù•€ô…½Õ¹Ñ¥¹MÑ…ÑÕÌ€ôôô€9½ÐI•ÅÕ¥É•œ€˜˜€……½Õ¹Ñ¥¹9½Ñ”€˜˜¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹•±¥¥‰±”ì(€¥˜€¡…½Õ¹Ñ¥¹MÑ…ÑÕÌ€ôôô€9½ÐI•ÅÕ¥É•œ€˜˜€……½Õ¹Ñ¥¹9½Ñ”€˜˜€…¹½ÑI•ÅÕ¥É•‘I•…Í½¹]…¥Ù•¤ì(€€€¥˜€¡¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹‰…±…¹•QåÁ”€˜˜¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹‰…±…¹”€ôô¹Õ±°¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È¡Q¡”ÕÉÉ•¹Ð€‘í¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹‰…±…¹•1…‰•±ô‰…±…¹”¥ÌÕ¹…Ù…¥±…‰±”¸¹Ñ•È…¸…½Õ¹Ñ¥¹œÉ•…Í½¸‰•™½É”Í•±•Ñ¥¹œ9½ÐI•ÅÕ¥É•¹€°€ÐÀÀ¤ì(€€€ô(€€€¥˜€¡¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹‰…±…¹•QåÁ”¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½È¡Q¡”ÕÉÉ•¹Ð€‘í¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹‰…±…¹•1…‰•±ô‰…±…¹”¥Ì€‘í¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹‰…±…¹”¹Ñ½¥á• È¥ô°¹½Ð€À¸ÀÀ¸I•™É•Í Ñ¡”‘¥ÍÁÕÑ”½È•¹Ñ•È…¸…½Õ¹Ñ¥¹œÉ•…Í½¸¹€°€ÐÀä¤ì(€€€ô(€€€Ñ¡É½Ü…ÁÁÉÉ½È áÁ±…¥¸Ý¡ä…½Õ¹Ñ¥¹œ¥Ì¹½ÐÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€ô((€½¹ÍÐì‘…Ñ„èÕÉÉ•¹ÑÑ¥½¹I½ÝÌ°•ÉÉ½ÈèÕÉÉ•¹ÑÑ¥½¹ÍÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}Q%=9}M1P¤¹•Ä …Í•}¥œ°…Í•I½Ü¹¥¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œèÑÉÕ”ô¤ì(€¥˜€¡ÕÉÉ•¹ÑÑ¥½¹ÍÉÉ½È¤Ñ¡É½ÜÕÉÉ•¹ÑÑ¥½¹ÍÉÉ½Èì(€½¹ÍÐÁÉ½©•Ñ•‘Ñ¥½¹Ì€ô€¡ÕÉÉ•¹ÑÑ¥½¹I½ÝÌñðmt¤¹µ…À ¡É½Ü¤€ôø€¡É½Ü¹¥€ôôô…Ñ¥½¹%€üì€¸¸¹É½Ü°•á•ÕÑ¥½¹}ÍÑ…ÑÕÌè…½Õ¹Ñ¥¹MÑ…ÑÕÌô€èÉ½Ü¤¤ì(€½¹ÍÐ…±±M•ÑÑ±•€ôÁÉ½©•Ñ•‘Ñ¥½¹Ì¹±•¹Ñ €ø€À€˜˜ÁÉ½©•Ñ•‘Ñ¥½¹Ì¹•Ù•Éä ¡É½Ü¤€ôøÉ½Ü¹•á•ÕÑ¥½¹}ÍÑ…ÑÕÌ€ôôô€M•ÑÑ±•œñðÉ½Ü¹•á•ÕÑ¥½¹}ÍÑ…ÑÕÌ€ôôô€9½ÐI•ÅÕ¥É•œ¤ì(€½¹ÍÐ¡…Í½Õ¹Ñ¥¹AÉ½É•ÍÌ€ôÁÉ½©•Ñ•‘Ñ¥½¹Ì¹Í½µ” ¡É½Ü¤€ôøÉ½Ü¹•á•ÕÑ¥½¹}ÍÑ…ÑÕÌ€„ôô€A•¹‘¥¹œ½Õ¹Ñ¥¹œœ¤ì(€½¹ÍÐÝ½É­™±½ÝMÑ…ÑÕÌ€ô…±±M•ÑÑ±•€ü€M•ÑÑ±•€´I•…‘äÑ¼±½Í”œ€è¡…Í½Õ¹Ñ¥¹AÉ½É•ÍÌ€ü€½Õ¹Ñ¥¹œ%¸AÉ½É•ÍÌœ€è€ÁÁÉ½Ù•€´A•¹‘¥¹œ½Õ¹Ñ¥¹œœì(€¥˜€ …•áÑ•É¹…±±½ÍÕÉ”¤…Ý…¥ÐÁ…Ñ¡¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍ%¹M…±•Í™½É”¡…Í•I½Ü°Ý½É­™±½ÝMÑ…ÑÕÌ¤ì((€½¹ÍÐ¹½Ý%Í¼€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€½¹ÍÐì‘…Ñ„èÕÁ‘…Ñ•‘Ñ¥½¸°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€•á•ÕÑ¥½¹}ÍÑ…ÑÕÌè…½Õ¹Ñ¥¹MÑ…ÑÕÌ°(€€€€€¥¹ÍÑÉÕÑ¥½¹}É•™•É•¹”è¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”ñð¹Õ±°°(€€€€€¥¹ÍÑÉÕÑ¥½¹}‘…Ñ”è¥¹ÍÑÉÕÑ¥½¹…Ñ”°(€€€€€¥¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ðè‘•¥µ…±=É9Õ±°¡‰½‘ä¹¥¹ÍÑÉÕÑ¥½¹µ½Õ¹Ð¤°(€€€€€Í•ÑÑ±•µ•¹Ñ}É•™•É•¹”èÍ•ÑÑ±•µ•¹ÑI•™•É•¹”ñð¹Õ±°°(€€€€€Í•ÑÑ±•µ•¹Ñ}‘…Ñ”èÍ•ÑÑ±•µ•¹Ñ…Ñ”°(€€€€€Í•ÑÑ±•µ•¹Ñ}…µ½Õ¹Ðè‘•¥µ…±=É9Õ±°¡‰½‘ä¹Í•ÑÑ±•µ•¹Ñµ½Õ¹Ð¤°(€€€€€…½Õ¹Ñ¥¹}¹½Ñ”è…½Õ¹Ñ¥¹9½Ñ”ñð¹Õ±°°(€€€€€…½Õ¹Ñ¥¹}‰äèÁÉ½™¥±”¹¥°(€€€€€…½Õ¹Ñ¥¹}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€€€…½Õ¹Ñ¥¹}…Ðè¹½Ý%Í¼°(€€€€€•á•ÕÑ•‘}‰äè…½Õ¹Ñ¥¹MÑ…ÑÕÌ€ôôô€M•ÑÑ±•œ€üÁÉ½™¥±”¹¥€è¹Õ±°°(€€€€€•á•ÕÑ•‘}‰å}•µ…¥°è…½Õ¹Ñ¥¹MÑ…ÑÕÌ€ôôô€M•ÑÑ±•œ€üÁÉ½™¥±”¹•µ…¥°€è¹Õ±°°(€€€€€•á•ÕÑ•‘}…Ðè…½Õ¹Ñ¥¹MÑ…ÑÕÌ€ôôô€M•ÑÑ±•œ€ü¹½Ý%Í¼€è¹Õ±°°(€€€€€•á•ÕÑ¥½¹}¹½Ñ”è…½Õ¹Ñ¥¹9½Ñ”ñð¹Õ±°°(€€€€€ÕÁ‘…Ñ•‘}‰äèÁÉ½™¥±”¹¥°(€€€€€ÕÁ‘…Ñ•‘}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€€€ÕÁ‘…Ñ•‘}…Ðè¹½Ý%Í¼°(€€€ô¤(€€€€¹•Ä ¥œ°…Ñ¥½¹%¤(€€€€¹Í•±•Ð¡%MAUQ}	Q}Q%=9}M1P¤(€€€€¹Í¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°…Í•I½Ü°€…½Õ¹Ñ¥¹}ÕÁ‘…Ñ•œ°ÁÉ½™¥±”°ì(€€€…Ñ¥½¹%°(€€€¹½Ñ”è€‘íÕÁ‘…Ñ•‘Ñ¥½¸¹…Ñ¥½¹}±…‰•±ôÕÁ‘…Ñ•Ñ¼€‘í…½Õ¹Ñ¥¹MÑ…ÑÕÍô¹€°(€€€µ•Ñ…‘…Ñ„èì(€€€€€…½Õ¹Ñ¥¹MÑ…ÑÕÌ°(€€€€€¥¹ÍÑÉÕÑ¥½¹I•™•É•¹”°(€€€€€¥¹ÍÑÉÕÑ¥½¹…Ñ”°(€€€€€Í•ÑÑ±•µ•¹ÑI•™•É•¹”°(€€€€€Í•ÑÑ±•µ•¹Ñ…Ñ”°(€€€€€¹½ÑI•ÅÕ¥É•‘I•…Í½¹]…¥Ù•°(€€€€€Ù•É¥™¥•‘	…±…¹”è¹½ÑI•ÅÕ¥É•‘I•…Í½¹]…¥Ù•€ü¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹‰…±…¹”€è¹Õ±°°(€€€€€Ù•É¥™¥•‘	…±…¹•QåÁ”è¹½ÑI•ÅÕ¥É•‘I•…Í½¹]…¥Ù•€ü¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹‰…±…¹•QåÁ”€è¹Õ±°°(€€€€€Á…ÉÑå½Õ¹Ñ%è¹½ÑI•ÅÕ¥É•‘I•…Í½¹]…¥Ù•€ü¹½ÑI•ÅÕ¥É•‘±¥¥‰¥±¥Ñä¹Á…ÉÑå½Õ¹Ñ%€è¹Õ±°°(€€€ô°(€ô¤ì(€½¹ÍÐì‘…Ñ„è…Ñ¥½¹I½ÝÌ°•ÉÉ½Èè…Ñ¥½¹ÍÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹Í•±•Ð¡%MAUQ}	Q}Q%=9}M1P¤¹•Ä …Í•}¥œ°…Í•I½Ü¹¥¤¹½É‘•È É•…Ñ•‘}…Ðœ°ì…Í•¹‘¥¹œèÑÉÕ”ô¤ì(€¥˜€¡…Ñ¥½¹ÍÉÉ½È¤Ñ¡É½Ü…Ñ¥½¹ÍÉÉ½Èì(€½¹ÍÐ…Ñ¥½¹Ì€ô…Ñ¥½¹I½ÝÌñðmtì(€½¹ÍÐì‘…Ñ„èÍÑ…ÑÕÍ…Í”°•ÉÉ½Èè…Í•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤¹ÕÁ‘…Ñ”¡ìÝ½É­™±½Ý}ÍÑ…ÑÕÌèÝ½É­™±½ÝMÑ…ÑÕÌ°ÕÁ‘…Ñ•‘}…Ðè¹½Ý%Í¼ô¤¹•Ä ¥œ°…Í•I½Ü¹¥¤¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤¹Í¥¹±” ¤ì(€¥˜€¡…Í•ÉÉ½È¤Ñ¡É½Ü…Í•ÉÉ½Èì(€½¹ÍÐÍ…±•Í™½É•…Í”€ô•áÑ•É¹…±±½ÍÕÉ”(€€€€ü…Ý…¥ÐÉ•½É‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡±¥•¹Ð°ÍÑ…ÑÕÍ…Í”°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”°Ý½É­™±½ÝMÑ…ÑÕÌ¤(€€€€è…Ý…¥ÐÉ•½É‘¥ÍÁÕÑ•]½É­™±½ÝM…±•Í™½É•]É¥Ñ•‰…¬¡±¥•¹Ð°ÍÑ…ÑÕÍ…Í”°ÁÉ½™¥±”°Ý½É­™±½ÝMÑ…ÑÕÌ¤ì(€½¹ÍÐÁ…ÉÑå5…À€ô‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Á…ÉÑåI½ÝÌ¤ì(€É•ÑÕÉ¸ì(€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡Í…±•Í™½É•…Í”¤°(€€€Á…ÉÑ¥•ÌèÁ…ÉÑåI½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¤°(€€€…Ñ¥½¸èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ñ¥½¸¡ÕÁ‘…Ñ•‘Ñ¥½¸°Á…ÉÑå5…À¤°(€€€…Ñ¥½¹Ìè€¡…Ñ¥½¹Ìñðmt¤¹µ…À ¡¥Ñ•´¤€ôøÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ñ¥½¸¡¥Ñ•´°Á…ÉÑå5…À¤¤°(€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•	•Ñ…5…É­á•ÕÑ•¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸‘¥ÍÁÕÑ•]½É­™±½Ý½Õ¹Ñ¥¹UÁ‘…Ñ” (€€€ì(€€€€€€¸¸¹‰½‘ä°(€€€€€…½Õ¹Ñ¥¹MÑ…ÑÕÌè€M•ÑÑ±•œ°(€€€€€Í•ÑÑ±•µ•¹Ñ…Ñ”è‰½‘ä¹Í•ÑÑ±•µ•¹Ñ…Ñ”ñð¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¤°(€€€€€Í•ÑÑ±•µ•¹ÑI•™•É•¹”è‰½‘ä¹Í•ÑÑ±•µ•¹ÑI•™•É•¹”ñð‰½‘ä¹¹½Ñ”°(€€€€€…½Õ¹Ñ¥¹9½Ñ”è‰½‘ä¹…½Õ¹Ñ¥¹9½Ñ”ñð‰½‘ä¹¹½Ñ”°(€€€ô°(€€€É•Ä°(€€€…•ÍÍ½¹Ñ•áÐ°(€€¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½Ý½µÁ•¹Í…Ñ¥½¹±…¥µÌ¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ…Ñ¥½¹%€ôMÑÉ¥¹œ¡‰½‘ä¹…Ñ¥½¹%ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ „½ylÀ´å„µ™uìáôµlÀ´å„µ™uìÑôµlÄ´ÕulÀ´å„µ™uìÍôµlàå…‰ulÀ´å„µ™uìÍôµlÀ´å„µ™uìÄÉô½¤¹Ñ•ÍÐ¡…Ñ¥½¹%¤¤Ñ¡É½Ü…ÁÁÉÉ½È Y…±¥‘¥ÍÁÕÑ”…Ñ¥½¸¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐì‘…Ñ„è…Ñ¥½¸°•ÉÉ½Èô€ô…Ý…¥Ð½¹Ñ•áÐ¹±¥•¹Ð(€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤(€€€€¹Í•±•Ð ¥±…Í•}¥±ÍÑ•µ}¥±…Ñ¥½¹}ÑåÁ”±±½Í•}É•…Í½¸±Á…ÉÑå}¥±ÕÁ‘…Ñ•‘}…Ð±‘¥ÍÁÕÑ•}Ý½É­™±½Ý}Á…ÉÑ¥•Ì¡…½Õ¹Ñ}¥±…½Õ¹Ñ}¹…µ”¤œ¤(€€€€¹•Ä ¥œ°…Ñ¥½¹%¤(€€€€¹µ…å‰•M¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€¥˜€ ……Ñ¥½¸¤Ñ¡É½Ü…ÁÁÉÉ½È ¥ÍÁÕÑ”…Ñ¥½¸Ý…Ì¹½Ð™½Õ¹¸œ°€ÐÀÐ¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Ñ¥½¸¹ÍÑ•µ}¥°½¹Ñ•áÐ¤ì(€¥˜€ …l±½Í•}‰Õå•É}‘¥ÍÁÕÑ”œ°€±½Í•}ÍÕÁÁ±¥•É}‘¥ÍÁÕÑ”t¹¥¹±Õ‘•Ì¡…Ñ¥½¸¹…Ñ¥½¹}ÑåÁ”¤ñðMÑÉ¥¹œ¡…Ñ¥½¸¹±½Í•}É•…Í½¸ñð€œœ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤€„ôô€Õ½Œ½Á•¹•œ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È ½µÁ•¹Í…Ñ¥½¸±…¥µÌ…É”…Ù…¥±…‰±”½¹±ä™½È„U=½Á•¹•±½ÍÕÉ”…Ñ¥½¸¸œ°€ÐÀä¤ì(€ô(€½¹ÍÐ…½Õ¹Ñ%€ô…Ñ¥½¸¹‘¥ÍÁÕÑ•}Ý½É­™±½Ý}Á…ÉÑ¥•Ìü¹…½Õ¹Ñ}¥ì(€½¹ÍÐ±…¥µÌ€ô…Ý…¥Ð…É••‘½µÁ•¹Í…Ñ¥½¹±…¥µÍ½É½Õ¹Ð¡…½Õ¹Ñ%°ì¥¹±Õ‘•±½Í•è™…±Í”ô¤ì(€É•ÑÕÉ¸ì(€€€…Ñ¥½¹%°(€€€…Ñ¥½¹UÁ‘…Ñ•‘Ðè…Ñ¥½¸¹ÕÁ‘…Ñ•‘}…Ð°(€€€…½Õ¹Ðèì…½Õ¹Ñ%°…½Õ¹Ñ9…µ”è…Ñ¥½¸¹‘¥ÍÁÕÑ•}Ý½É­™±½Ý}Á…ÉÑ¥•Ìü¹…½Õ¹Ñ}¹…µ”ñð€œœô°(€€€±…¥µÌ°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½Ý½µÁ•¹Í…Ñ¥½¹±…¥µ1¥¹¬¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ…Ñ¥½¹%€ôMÑÉ¥¹œ¡‰½‘ä¹…Ñ¥½¹%ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐì‘…Ñ„è…Ñ¥½¸°•ÉÉ½Èô€ô…Ý…¥Ð½¹Ñ•áÐ¹±¥•¹Ð¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Ñ¥½¹Ìœ¤¹Í•±•Ð ¥±ÍÑ•µ}¥œ¤¹•Ä ¥œ°…Ñ¥½¹%¤¹µ…å‰•M¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€¥˜€ ……Ñ¥½¸¤Ñ¡É½Ü…ÁÁÉÉ½È ¥ÍÁÕÑ”…Ñ¥½¸Ý…Ì¹½Ð™½Õ¹¸œ°€ÐÀÐ¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Ñ¥½¸¹ÍÑ•µ}¥°½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸±¥¹­¥ÍÁÕÑ•É••‘½µÁ•¹Í…Ñ¥½¹±…¥´¡‰½‘ä°Õ¹½™™¥¥…±½µÁ•¹Í…Ñ¥½¹M•ÉÙ¥•½¹Ñ•áÐ¡½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•ÅÕ¥É•áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ•ÕÑ¡½É¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”¤ì(€¥˜€¡ÁÉ½™¥±”ü¹ÕÍ•É}ÑåÁ”€ôôô€…‘µ¥¹¥ÍÑÉ…Ñ½Èœ¤É•ÑÕÉ¸ì(€¥˜€¡ÁÉ½™¥±”ü¹ÕÍ•É}ÑåÁ”€ôôô€•¹•É…±}µ…¹…•Èœ¤ì(€€€½¹ÍÐ•¹•É…±5…¹…•È€ô…Ý…¥Ð±½…‘Ñ¥Ù••¹•É…±5…¹…•È¡±¥•¹Ð¤ì(€€€¥˜€¡•¹•É…±5…¹…•È¹¥€ôôôÁÉ½™¥±”¹¥¤É•ÑÕÉ¸ì(€ô(€Ñ¡É½Ü…ÁÁÉÉ½È =¹±ä…¸‘µ¥¹¥ÍÑÉ…Ñ½È½ÈÑ¡”…Ñ¥Ù”•¹•É…°5…¹…•È…¸…•ÁÐ„‘¥ÍÁÕÑ”±½Í•‘¥É•Ñ±ä¥¸M…±•Í™½É”¸œ°€ÐÀÌ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•]½É­™±½Ý•ÁÑáÑ•É¹…±±½ÍÕÉ”¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ•ÕÑ¡½É¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”¤ì(€½¹ÍÐÉ•…Í½¸€ôMÑÉ¥¹œ¡‰½‘ä¹É•…Í½¸ñð‰½‘ä¹¹½Ñ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …É•…Í½¸¤Ñ¡É½Ü…ÁÁÉÉ½È É•…Í½¸¥ÌÉ•ÅÕ¥É•Ñ¼…•ÁÐÑ¡”•áÑ•É¹…°M…±•Í™½É”±½ÍÕÉ”¸œ°€ÐÀÀ¤ì(€±•Ð…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°‰½‘ä¹…Í•%ñð‰½‘ä¹ÍÑ•µ%¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ô…Ý…¥Ð±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€¥˜€ …¡…ÍU¹…•ÁÑ•‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡…Í•I½Ü°ÕÉÉ•¹ÑMÑ•´¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Q¡¥Ì‘¥ÍÁÕÑ”¥Ì¹½Ð…Ý…¥Ñ¥¹œ…•ÁÑ…¹”½˜…¸•áÑ•É¹…°M…±•Í™½É”±½ÍÕÉ”¸œ°€ÐÀä¤ì(€ô(€…Í•I½Ü€ô…Ý…¥ÐÉ•½É‘áÑ•É¹…±¥ÍÁÕÑ•±½ÍÕÉ”¡±¥•¹Ð°…Í•I½Ü°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”¤ì(€±•ÐìÁ…ÉÑåI½ÝÌ°…Ñ¥½¹I½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌô€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÉ•¥ÍÑÉä€ô…ÍÍ•ÉÑY…±¥‘¥ÍÁÕÑ•A…ÉÑ¥•Ì¡ÕÉÉ•¹ÑMÑ•´°Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐÉ•½¹¥±¥…Ñ¥½¸€ô…Ý…¥ÐÉ•½¹¥±•ÁÁÉ½Ù•‘MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü°Á…ÉÑåI½ÝÌ°…Ñ¥½¹I½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”¤ì(€¥˜€¡É•½¹¥±¥…Ñ¥½¸¹¡…¹•¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•ÈÁ…åµ•¹ÑÌ¡…¹•¸=LÕÁ‘…Ñ•Ñ¡”…½Õ¹Ñ¥¹œÁ±…¸ì¥¹…¹”µÕÍÐ½µÁ±•Ñ”Ñ¡”É•Ù¥Í•¥¹ÍÑÉÕÑ¥½¹Ì‰•™½É”…•ÁÑ¥¹œÑ¡”•áÑ•É¹…°±½ÍÕÉ”¸œ°€ÐÀä¤ì(€ô(€¥˜€¡…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€„ôô€ÁÁÉ½Ù•œñð…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ€„ôô€M•ÑÑ±•€´I•…‘äÑ¼±½Í”œ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È ½µÁ±•Ñ”Ñ¡”…ÁÁÉ½Ù•=L…½Õ¹Ñ¥¹œÝ½É­™±½Ü‰•™½É”…•ÁÑ¥¹œÑ¡”•áÑ•É¹…°M…±•Í™½É”±½ÍÕÉ”¸œ°€ÐÀä¤ì(€ô(€½¹ÍÐ…Ñ¥½¹Ì€ôÙ…±¥‘…Ñ•MÑ½É•‘¥ÍÁÕÑ•Ñ¥½¹Ì¡…Ñ¥½¹I½ÝÌ°Á…ÉÑåI½ÝÌ°É•¥ÍÑÉä¤ì(€…ÍÍ•ÉÑMÕÁÁ±¥•É¥ÍÁÕÑ•µ½Õ¹ÑÌ¡…Ñ¥½¹Ì¤ì(€½¹ÍÐ…Ñ¥Ù•MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì€ô¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¹™¥±Ñ•È ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø¥¹ÍÑÉÕÑ¥½¸¹ÍÑ…ÑÕÌ€„ôô€MÕÁ•ÉÍ•‘•œ¤ì(€¥˜€¡…Ñ¥Ù•MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¹Í½µ” ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø€…lM•ÑÑ±•œ°€9½ÐI•ÅÕ¥É•t¹¥¹±Õ‘•Ì¡¥¹ÍÑÉÕÑ¥½¸¹ÍÑ…ÑÕÌ¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Ù•ÉäÍÕÁÁ±¥•È¥¹Ù½¥”¥¹ÍÑÉÕÑ¥½¸µÕÍÐ‰”M•ÑÑ±•½È9½ÐI•ÅÕ¥É•‰•™½É”…•ÁÑ¥¹œÑ¡”•áÑ•É¹…°±½ÍÕÉ”¸œ°€ÐÀä¤ì(€ô(€¥˜€ ……Ñ¥½¹Ì¹±•¹Ñ ñð€……Ñ¥½¹Ì¹•Ù•Éä ¡…Ñ¥½¸¤€ôølM•ÑÑ±•œ°€9½ÐI•ÅÕ¥É•t¹¥¹±Õ‘•Ì¡…Ñ¥½¸¹•á•ÕÑ¥½¹}ÍÑ…ÑÕÌ¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Ù•Éä…½Õ¹Ñ¥¹œ…Ñ¥½¸µÕÍÐ‰”M•ÑÑ±•½È9½ÐI•ÅÕ¥É•‰•™½É”…•ÁÑ¥¹œÑ¡”•áÑ•É¹…°±½ÍÕÉ”¸œ°€ÐÀä¤ì(€ô(€…Ý…¥Ð…ÍÍ•ÉÑ¥ÍÁÕÑ•U½±…¥µÍI•…‘å½É±½ÍÕÉ”¡…Ñ¥½¹Ì°Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Ý…¥Ð…ÍÍ•ÉÑI•ÅÕ¥É•‘¥ÍÁÕÑ•½Õµ•¹ÑÌ¡±¥•¹Ð°…Ñ¥½¹Ì¤ì(€½¹ÍÐ¹½Ý%Í¼€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€½¹ÍÐì‘…Ñ„èÕÁ‘…Ñ•‘…Í”°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€Ý½É­™±½Ý}ÍÑ…ÑÕÌè€±½Í•œ°(€€€€€±…Ñ•ÍÑ}¹½Ñ”èÉ•…Í½¸°(€€€€€ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌèMÑÉ¥¹œ¡ÕÉÉ•¹ÑMÑ•´¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œñð€œœ¤¹ÑÉ¥´ ¤°(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}ÍÑ…ÑÕÌè€•áÑ•É¹…°œ°(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}•ÉÉ½Èè¹Õ±°°(€€€€€•áÑ•É¹…±}±½ÍÕÉ•}…•ÁÑ•‘}…Ðè¹½Ý%Í¼°(€€€€€•áÑ•É¹…±}±½ÍÕÉ•}…•ÁÑ•‘}‰äèÁÉ½™¥±”¹¥°(€€€€€•áÑ•É¹…±}±½ÍÕÉ•}…•ÁÑ•‘}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€€€•áÑ•É¹…±}±½ÍÕÉ•}…•ÁÑ…¹•}É•…Í½¸èÉ•…Í½¸°(€€€€€±½Í•‘}‰äèÁÉ½™¥±”¹¥°(€€€€€±½Í•‘}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€€€±½Í•‘}…Ðè¹½Ý%Í¼°(€€€€€ÕÁ‘…Ñ•‘}…Ðè¹½Ý%Í¼°(€€€ô¤(€€€€¹•Ä ¥œ°…Í•I½Ü¹¥¤(€€€€¹•Ä Ý½É­™±½Ý}ÍÑ…ÑÕÌœ°€M•ÑÑ±•€´I•…‘äÑ¼±½Í”œ¤(€€€€¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤(€€€€¹µ…å‰•M¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€¥˜€ …ÕÁ‘…Ñ•‘…Í”¤Ñ¡É½Ü…ÁÁÉÉ½È Q¡”‘¥ÍÁÕÑ”¡…¹•‰•™½É”Ñ¡”•áÑ•É¹…°±½ÍÕÉ”Ý…Ì…•ÁÑ•¸I•™É•Í …¹É•Ù¥•Ü¥Ð……¥¸¸œ°€ÐÀä¤ì(€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°€•áÑ•É¹…±}±½ÍÕÉ•}…•ÁÑ•œ°ÁÉ½™¥±”°ì(€€€¹½Ñ”èÉ•…Í½¸°(€€€µ•Ñ…‘…Ñ„èì(€€€€€Í…±•Í™½É•MÑ…ÑÕÌèÕÉÉ•¹ÑMÑ•´¹¥ÍÁÕÑ•}MÑ…ÑÕÍ}}Œ°(€€€€€Í…±•Í™½É•1…ÍÑ5½‘¥™¥•‘ÐèÕÉÉ•¹ÑMÑ•´¹1…ÍÑ5½‘¥™¥•‘…Ñ”ñð¹Õ±°°(€€€€€…½Õ¹Ñ¥¹½µÁ±•Ñ•èÑÉÕ”°(€€€ô°(€ô¤ì(€½¹ÍÐÁ…ÉÑå5…À€ô‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Á…ÉÑåI½ÝÌ¤ì(€É•ÑÕÉ¸ì(€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡ÕÁ‘…Ñ•‘…Í”¤°(€€€Á…ÉÑ¥•ÌèÁ…ÉÑåI½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¤°(€€€…Ñ¥½¹Ìè…Ñ¥½¹Ì¹µ…À ¡…Ñ¥½¸¤€ôøÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ñ¥½¸¡…Ñ¥½¸°Á…ÉÑå5…À¤¤°(€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘¥ÍÁÕÑ•	•Ñ…±½Í”¡‰½‘ä€ôíô°É•Ä°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐì±¥•¹Ð°ÁÉ½™¥±”ô€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡±¥•¹Ð°ÁÉ½™¥±”°€‘¥ÍÁÕÑ•Í}…½Õ¹Ðœ°€¥ÍÁÕÑ”…½Õ¹Ñ¥¹œÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•Ñ¼±½Í”„‘¥ÍÁÕÑ”¸œ¤ì(€½¹ÍÐ…Í•I½Ü€ô…Ý…¥Ð•Ñ¥ÍÁÕÑ•	•Ñ……Í”¡±¥•¹Ð°‰½‘ä¹…Í•%ñð‰½‘ä¹ÍÑ•µ%¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€½¹ÍÐÕÉÉ•¹ÑMÑ•´€ô…Ý…¥Ð±½…‘ÕÉÉ•¹Ñ¥ÍÁÕÑ•MÑ•´¡…Í•I½Ü¹ÍÑ•µ}¥°…•ÍÍ½¹Ñ•áÐñðì±¥•¹Ð°ÁÉ½™¥±”ô¤ì(€¥˜€ …¡…ÍI•½É‘•‘½Í±½ÍÕÉ•]É¥Ñ•‰…¬¡…Í•I½Ü¤¤…ÍÍ•ÉÑM…±•Í™½É•¥ÍÁÕÑ•%Í=Á•¸¡ÕÉÉ•¹ÑMÑ•´¤ì(€±•ÐìÁ…ÉÑåI½ÝÌ°…Ñ¥½¹I½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌô€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€½¹ÍÐÉ•¥ÍÑÉä€ô…ÍÍ•ÉÑY…±¥‘¥ÍÁÕÑ•A…ÉÑ¥•Ì¡ÕÉÉ•¹ÑMÑ•´°Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐÉ•½¹¥±¥…Ñ¥½¸€ô…Ý…¥ÐÉ•½¹¥±•ÁÁÉ½Ù•‘MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü°Á…ÉÑåI½ÝÌ°…Ñ¥½¹I½ÝÌ°¥¹ÍÑÉÕÑ¥½¹I½ÝÌ°ÕÉÉ•¹ÑMÑ•´°ÁÉ½™¥±”¤ì(€¥˜€¡É•½¹¥±¥…Ñ¥½¸¹¡…¹•¤ì(€€€½¹ÍÐÉ•±½…‘•€ô…Ý…¥Ð±½…‘¥ÍÁÕÑ•]½É­™±½ÝÑ¥½¹Ì¡±¥•¹Ð°…Í•I½Ü¹¥¤ì(€€€Á…ÉÑåI½ÝÌ€ôÉ•±½…‘•¹Á…ÉÑåI½ÝÌì(€€€…Ñ¥½¹I½ÝÌ€ôÉ•±½…‘•¹…Ñ¥½¹I½ÝÌì(€€€¥¹ÍÑÉÕÑ¥½¹I½ÝÌ€ôÉ•±½…‘•¹¥¹ÍÑÉÕÑ¥½¹I½ÝÌì(€€€Ñ¡É½Ü…ÁÁÉÉ½È MÕÁÁ±¥•ÈÁ…åµ•¹ÑÌ¡…¹•…™Ñ•È…ÁÁÉ½Ù…°¸=LÕÁ‘…Ñ•Ñ¡”…½Õ¹Ñ¥¹œÁ±…¸ì¥¹…¹”µÕÍÐ½µÁ±•Ñ”Ñ¡”É•Ù¥Í•¥¹ÍÑÉÕÑ¥½¹Ì‰•™½É”±½ÍÕÉ”¸œ°€ÐÀä¤ì(€ô(€¥˜€¡…Í•I½Ü¹…ÁÁÉ½Ù…±}ÍÑ…ÑÕÌ€„ôô€ÁÁÉ½Ù•œ¤Ñ¡É½Ü…ÁÁÉÉ½È =¹±ä…ÁÁÉ½Ù•¥ÍÁÕÑ”]½É­™±½Ü…Í•Ì…¸‰”±½Í•¸œ°€ÐÀÀ¤ì(€¥˜€¡…Í•I½Ü¹Ý½É­™±½Ý}ÍÑ…ÑÕÌ€„ôô€M•ÑÑ±•€´I•…‘äÑ¼±½Í”œ¤Ñ¡É½Ü…ÁÁÉÉ½È ½µÁ±•Ñ”…½Õ¹Ñ¥¹œÍ•ÑÑ±•µ•¹Ð™½È•Ù•Éä…Ñ¥½¸‰•™½É”±½Í¥¹œ¸œ°€ÐÀÀ¤ì(€½¹ÍÐ™¥¹…±9½Ñ”€ôMÑÉ¥¹œ¡‰½‘ä¹¹½Ñ”ñð€œœ¤¹ÑÉ¥´ ¤ì(€¥˜€ …™¥¹…±9½Ñ”¤Ñ¡É½Ü…ÁÁÉÉ½È ¥¹…°±½ÍÕÉ”¹½Ñ”¥ÌÉ•ÅÕ¥É•¸œ°€ÐÀÀ¤ì(€½¹ÍÐ…Ñ¥½¹Ì€ôÙ…±¥‘…Ñ•MÑ½É•‘¥ÍÁÕÑ•Ñ¥½¹Ì¡…Ñ¥½¹I½ÝÌ°Á…ÉÑåI½ÝÌ°É•¥ÍÑÉä¤ì(€…ÍÍ•ÉÑMÕÁÁ±¥•É¥ÍÁÕÑ•µ½Õ¹ÑÌ¡…Ñ¥½¹Ì¤ì(€½¹ÍÐ…Ñ¥Ù•MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì€ô¥¹ÍÑÉÕÑ¥½¹I½ÝÌ¹™¥±Ñ•È ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø¥¹ÍÑÉÕÑ¥½¸¹ÍÑ…ÑÕÌ€„ôô€MÕÁ•ÉÍ•‘•œ¤ì(€¥˜€¡…Ñ¥Ù•MÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹Ì¹Í½µ” ¡¥¹ÍÑÉÕÑ¥½¸¤€ôø€…lM•ÑÑ±•œ°€9½ÐI•ÅÕ¥É•t¹¥¹±Õ‘•Ì¡¥¹ÍÑÉÕÑ¥½¸¹ÍÑ…ÑÕÌ¤¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Ù•ÉäÍÕÁÁ±¥•È¥¹Ù½¥”¥¹ÍÑÉÕÑ¥½¸µÕÍÐ‰”M•ÑÑ±•½È9½ÐI•ÅÕ¥É•‰•™½É”±½ÍÕÉ”¸œ°€ÐÀÀ¤ì(€ô(€¥˜€ „¡…Ñ¥½¹Ìñðmt¤¹±•¹Ñ ñð€„¡…Ñ¥½¹Ìñðmt¤¹•Ù•Éä ¡…Ñ¥½¸¤€ôø…Ñ¥½¸¹•á•ÕÑ¥½¹}ÍÑ…ÑÕÌ€ôôô€M•ÑÑ±•œñð…Ñ¥½¸¹•á•ÕÑ¥½¹}ÍÑ…ÑÕÌ€ôôô€9½ÐI•ÅÕ¥É•œ¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È Ù•Éä…½Õ¹Ñ¥¹œ…Ñ¥½¸µÕÍÐ‰”M•ÑÑ±•½È9½ÐI•ÅÕ¥É•‰•™½É”±½ÍÕÉ”¸œ°€ÐÀÀ¤ì(€ô(€…Ý…¥Ð…ÍÍ•ÉÑ¥ÍÁÕÑ•U½±…¥µÍI•…‘å½É±½ÍÕÉ”¡…Ñ¥½¹Ì°Á…ÉÑåI½ÝÌ¤ì(€½¹ÍÐ‘½Õµ•¹ÑÌ€ô…Ý…¥Ð…ÍÍ•ÉÑI•ÅÕ¥É•‘¥ÍÁÕÑ•½Õµ•¹ÑÌ¡±¥•¹Ð°…Ñ¥½¹Ìñðmt¤ì(€½¹ÍÐÍÑ…ÑÕÍ…Í”€ô…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•]½É­™±½ÝMÑ…ÑÕÍQ½M…±•Í™½É”¡±¥•¹Ð°…Í•I½Ü°ÁÉ½™¥±”°€±½Í•œ°ìÉ•ÅÕ¥É•èÑÉÕ”ô¤ì(€½¹ÍÐ¹½Ý%Í¼€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€½¹ÍÐì‘…Ñ„èÕÁ‘…Ñ•‘…Í”°•ÉÉ½Èô€ô…Ý…¥Ð±¥•¹Ð(€€€€¹™É½´ ‘¥ÍÁÕÑ•}‰•Ñ…}…Í•Ìœ¤(€€€€¹ÕÁ‘…Ñ”¡ì(€€€€€Ý½É­™±½Ý}ÍÑ…ÑÕÌè€±½Í•œ°(€€€€€±…Ñ•ÍÑ}¹½Ñ”è™¥¹…±9½Ñ”°(€€€€€ÕÉÉ•¹Ñ}Í…±•Í™½É•}ÍÑ…ÑÕÌè€±½Í•œ°(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}ÍÑ…ÑÕÌè€ÍÕ•ÍÌœ°(€€€€€Í…±•Í™½É•}ÝÉ¥Ñ•‰…­}•ÉÉ½Èè¹Õ±°°(€€€€€±½Í•‘}‰äèÁÉ½™¥±”¹¥°(€€€€€±½Í•‘}‰å}•µ…¥°èÁÉ½™¥±”¹•µ…¥°°(€€€€€±½Í•‘}…Ðè¹½Ý%Í¼°(€€€€€ÕÁ‘…Ñ•‘}…Ðè¹½Ý%Í¼°(€€€ô¤(€€€€¹•Ä ¥œ°ÍÑ…ÑÕÍ…Í”¹¥¤(€€€€¹Í•±•Ð¡%MAUQ}	Q}M}M1P¤(€€€€¹Í¥¹±” ¤ì(€¥˜€¡•ÉÉ½È¤Ñ¡É½Ü•ÉÉ½Èì(€…Ý…¥ÐÝÉ¥Ñ•¥ÍÁÕÑ•	•Ñ…Ù•¹Ð¡±¥•¹Ð°ÕÁ‘…Ñ•‘…Í”°€±½Í•œ°ÁÉ½™¥±”°ì(€€€¹½Ñ”è™¥¹…±9½Ñ”°(€ô¤ì(€½¹ÍÐÁ…ÉÑå5…À€ô‘¥ÍÁÕÑ•A…ÉÑåI½Ý5…À¡Á…ÉÑåI½ÝÌ¤ì(€É•ÑÕÉ¸ì(€€€…Í”èÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ……Í”¡ÕÁ‘…Ñ•‘…Í”¤°(€€€Á…ÉÑ¥•ÌèÁ…ÉÑåI½ÝÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½ÝA…ÉÑä¤°(€€€…Ñ¥½¹Ìè€¡…Ñ¥½¹Ìñðmt¤¹µ…À ¡¥Ñ•´¤€ôøÍ•É¥…±¥é•¥ÍÁÕÑ•	•Ñ…Ñ¥½¸¡¥Ñ•´°Á…ÉÑå5…À¤¤°(€€€‘½Õµ•¹ÑÌè‘½Õµ•¹ÑÌ¹µ…À¡Í•É¥…±¥é•¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹Ð¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í…±•Í™½É•MÑ•µ•Ñ…¥±U¹…¡•¡‰½‘ä°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐìÍÑ•µ%°ÕÁ‘…Ñ•Ì°¡¥±‘=‰©•Ð°¡¥±‘%°¡¥±‘UÁ‘…Ñ•Ìô€ô‰½‘äì(€¥˜€ …ÍÑ•µ%¤Ñ¡É½Ü¹•ÜÉÉ½È ÍÑ•µ%É•ÅÕ¥É•œ¤ì((€±•Ð…ÑÕ…±MÑ•µ%€ôÍÑ•µ%ì(€¥˜€¡ÍÑ•µ%¹±•¹Ñ €ð€ÄÔ¤ì(€€€½¹ÍÐ±½½­ÕÀ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ¡M1P%I=4ÍÑ•µ}}Œ]!I-•åMÑ•µ}}Œ€ô€œ‘í•Í…Á•M½Å°¡ÍÑ•µ%¥ôœ1%5%P€Å€°ìÍ½™Ñ…¥°èÑÉÕ”ô¤ì(€€€¥˜€ …±½½­ÕÀ¹±•¹Ñ ¤Ñ¡É½Ü¹•ÜÉÉ½È¡MQ4Ý¥Ñ -•åMÑ•µ}}Œ€œ‘íÍÑ•µ%‘ôœ¹½Ð™½Õ¹‘€¤ì(€€€…ÑÕ…±MÑ•µ%€ô±½½­ÕÁlÁt¹%ì(€ô(€…Ý…¥ÐÉ•ÅÕ¥É•%¹Ñ•É½™™¥•MÑ•µ•ÍÌ¡…ÑÕ…±MÑ•µ%°…•ÍÍ½¹Ñ•áÐ¤ì((€¥˜€¡¡¥±‘=‰©•Ð€˜˜¡¥±‘%€˜˜¡¥±‘UÁ‘…Ñ•Ì€˜˜=‰©•Ð¹­•åÌ¡¡¥±‘UÁ‘…Ñ•Ì¤¹±•¹Ñ €ø€À¤ì(€€€…Ý…¥ÐÍ™I•ÅÕ•ÍÐ¡€½Í½‰©•ÑÌ¼‘í¡¥±‘=‰©•Ñô¼‘í¡¥±‘%‘õ€°ì(€€€€€µ•Ñ¡½è€AQ œ°(€€€€€‰½‘äè¡¥±‘UÁ‘…Ñ•Ì°(€€€ô¤ì(€ô(€¥˜€¡ÕÁ‘…Ñ•Ì€˜˜=‰©•Ð¹­•åÌ¡ÕÁ‘…Ñ•Ì¤¹±•¹Ñ €ø€À¤ì(€€€…Ý…¥ÐÍ™I•ÅÕ•ÍÐ¡€½Í½‰©•ÑÌ½ÍÑ•µ}}Œ¼‘í…ÑÕ…±MÑ•µ%‘õ€°ì(€€€€€µ•Ñ¡½è€AQ œ°(€€€€€‰½‘äèÕÁ‘…Ñ•Ì°(€€€ô¤ì(€ô((€½¹ÍÐmÉ•½É‘I…Ü°±¥¹•%Ñ•µÌ°•áÑÉ…½ÍÑÌ°‰Õå•É	É½­•ÉÍt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€Í™I•ÅÕ•ÍÐ¡€½Í½‰©•ÑÌ½ÍÑ•µ}}Œ¼‘í…ÑÕ…±MÑ•µ%‘õ€¤¹Ñ¡•¸¡±•…¹I•½É¤°(€€€ÅÕ•ÉåI½ÝÌ¡M1P%°9…µ”°MQ5}}Œ°AÉ½‘ÕÑ}}Œ°AÉ½‘ÕÑ}}È¹9…µ”°AÉ½‘ÕÑ}}È¹…µ¥±ä°MÕÁÁ±¥•É}9…µ•}}Œ°	9}½µÁ…¹å}}Œ°EÕ…¹Ñ¥Ñå}}Œ°EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œ°EÕ…¹Ñ¥Ñå}5…á}}Œ°EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œ°%Í}EÕ…¹Ñ¥Ñå}I…¹•}}Œ°AÉ¥•}A•É}U¹¥Ñ}}Œ°½ÍÑ}A•É}U¹¥Ñ}}Œ°U¹¥Ñ}M•±±}Ñ}}Œ°U¹¥Ñ}	Õå}Ñ}}Œ°U¹¥Ñ}½ÍÑ}}Œ°MÕ‰Ñ½Ñ…±}M•±±}Ñ}}Œ°MÕ‰Ñ½Ñ…±}	Õå}Ñ}}Œ°Q½Ñ…±}AÉ¥•}}Œ°Q½Ñ…±}½ÍÑ}}Œ°MÕÁÁ±¥•É}%¹Ù½¥•}}Œ°A…åµ•¹Ñ}Q•Éµ}}Œ°	9}9Õµ‰•É}}Œ°…¹•±±•‘}}Œ°	Õå•ÉÍ}	É½­•É}}Œ°	Õå•É}	É½­•É}}Œ°	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}1ÕµÁÍÕµ}}Œ°½µµ¥ÍÍ¥½¹}½ÍÑ}}Œ°MÕÁÁ±¥•É}	É½­•É}}Œ°MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}1ÕµÁÍÕµ}}Œ°=™™•É}1¥¹•}%Ñ•µ}}È¹U¹¥ÑAÉ¥”°=™™•É}1¥¹•}%Ñ•µ}}È¹MÕÁÁ±¥•É}U¹¥Ñ}AÉ¥•}}ŒI=4MQ5}1¥¹•}%Ñ•µ}}Œ]!IMQ5}}Œ€ô€œ‘í…ÑÕ…±MÑ•µ%‘ôœ=IH	dÉ•…Ñ•‘…Ñ”M€°ìÍ½™Ñ…¥°èÑÉÕ”ô¤°(€€€ÅÕ•ÉåI½ÝÌ¡M1P%°9…µ”°•ÍÉ¥ÁÑ¥½¹}}Œ°AÉ½‘ÕÐÉ%‘}}Œ°AÉ½‘ÕÐÉ%‘}}È¹9…µ”°AÉ½‘ÕÐÉ%‘}}È¹…µ¥±ä°MÕÁÁ±¥•É}9…µ•}}Œ°EÕ…¹Ñ¥Ñå}}Œ°EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œ°EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œ°EÕ…¹Ñ¥Ñå}I…¹•}5…á}}Œ°%Í}EÕ…¹Ñ¥Ñå}I…¹•}}Œ°U¹¥Ñ}AÉ¥•}}Œ°U¹¥Ñ}½ÍÑ}}Œ°1¥¹•}Q½Ñ…±}}Œ°1¥¹•}Q½Ñ…±}	Õå}}Œ°MÕÁÁ±¥•É}%¹Ù½¥•}}Œ°MÕÁÁ±¥•É}%ÍÍÕ•‘}}Œ°A…åµ•¹Ñ}Q•Éµ}}Œ°…¹•±±•‘}}ŒI=4MQ5}áÑÉ…}½ÍÑ}}Œ]!IMQ5}}Œ€ô€œ‘í…ÑÕ…±MÑ•µ%‘ôœ=IH	dÉ•…Ñ•‘…Ñ”M€°ìÍ½™Ñ…¥°èÑÉÕ”ô¤°(€€€ÅÕ•ÉåI½ÝÌ¡M1P%°MQ5}}Œ°	Õå•É}	É½­•É}}Œ°I•™½‘•}%¹‘•á}}Œ°áÁ½ÉÑ•‘}}Œ°½µµ¥ÍÍ¥½¹}1ÕµÁÍÕµ}}Œ°MQ5}1¥¹•}%Ñ•µ}}È¹%I=4MQ5}	Õå•É}	É½­•É}}Œ]!IMQ5}}Œ€ô€œ‘í…ÑÕ…±MÑ•µ%‘ôœ=IH	dÉ•…Ñ•‘…Ñ”M€°ìÍ½™Ñ…¥°èÑÉÕ”ô¤°(€t¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì€ôl¸¸¹¹•ÜM•Ð¡l¸¸¹±¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¤°€¸¸¹•áÑÉ…½ÍÑÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¥t¹™¥±Ñ•È¡¥ÍM…±•Í™½É•%¤¥tì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•9…µ•5…À€ô…Ý…¥Ð¹…µ•Í	å%‘Ì MÕÁÁ±¥•É}%¹Ù½¥•}}Œœ°ÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É9…µ•5…À€ôíôì(€™½È€¡½¹ÍÐ¥Ñ•´½˜l¸¸¹±¥¹•%Ñ•µÌ°€¸¸¹•áÑÉ…½ÍÑÍt¤ì(€€€¥˜€¡¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ€˜˜¥Ñ•´¹MÕÁÁ±¥•É}9…µ•}}Œ€˜˜€…ÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É9…µ•5…Ám¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}t¤ì(€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É9…µ•5…Ám¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}t€ô¥Ñ•´¹MÕÁÁ±¥•É}9…µ•}}Œì(€€€ô(€ô((€½¹ÍÐ‰É½­•É½Õ¹Ñ%‘Ì€ôl¸¸¹¹•ÜM•Ð¡l¸¸¹±¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤°€¸¸¹±¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹	Õå•ÉÍ}	É½­•É}}Œñð¥Ñ•´¹	Õå•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤°€¸¸¹‰Õå•É	É½­•ÉÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹	Õå•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¥t¥tì(€½¹ÍÐ‰É½­•É½Õ¹Ñ5…À€ô…Ý…¥Ð¹…µ•Í	å%‘Ì ½Õ¹Ðœ°‰É½­•É½Õ¹Ñ%‘Ì¤ì(€™½È€¡½¹ÍÐm¥°¹…µ•t½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡‰É½­•É½Õ¹Ñ5…À¤¤‰É½­•É½Õ¹Ñ5…ÁmMÑÉ¥¹œ¡¥¤¹Í±¥” À°€ÄÔ¥t€ô¹…µ”ì(€½¹ÍÐ‰É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÍ	åMÑ•´€ô‰Õ¥±‘	É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÌ¡ì(€€€ÍÑ•µ5…Àèìm…ÑÕ…±MÑ•µ%‘tèÉ•½É‘I…Üô°(€€€±¥¹•%Ñ•µÌ°(€€€‰Õå•É	É½­•ÉÌ°(€€€…½Õ¹Ñ5…Àè‰É½­•É½Õ¹Ñ5…À°(€ô¤ì(€½¹ÍÐ‰É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÌ€ô‰É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÍ	åMÑ•µm…ÑÕ…±MÑ•µ%‘tñðmtì(€½¹ÍÐÍÑ•µ!…Í•±¥Ù•Éä€ô€„…É•½É‘I…Ü¹•±¥Ù•Éå}…Ñ•}}Œì(€½¹ÍÐÁ…å…‰±•µ½Õ¹Ñ…¹‘¥‘…Ñ•Ì€ôÍÑ•µA…å…‰±•µ½Õ¹Ñ…¹‘¥‘…Ñ•Ì¡ì(€€€ÍÑ•´èÉ•½É‘I…Ü°(€€€±¥¹•%Ñ•µÌ°(€€€•áÑÉ…½ÍÑÌ°(€ô¤ì((€±•ÐÍÕÁÁ±¥•É%¹Ù½¥•A…åµ•¹ÑÌ€ômtì(€±•Ð‰Õå•É%¹Ù½¥•A…åµ•¹ÑÌ€ômtì(€½¹ÍÐ‰É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ñ5…À€ô¹•Ü5…À ¤ì(€½¹ÍÐÁ…åµ•¹Ñ•ÍÉ¥‰”€ô…Ý…¥ÐÍ…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì(€€€½‰©•Ñ9…µ”è€A…åµ•¹Ñ}}Œœ°(€ô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤ì(€½¹ÍÐÁ…åµ•¹Ñ¥•±‘Ì€ôÁ…åµ•¹Ñ•ÍÉ¥‰”¹™¥•±‘Ìñðmtì(€½¹ÍÐÁ…åµ•¹Ñ¥•±‘9…µ•Ì€ô¹•ÜM•Ð¡Á…åµ•¹Ñ¥•±‘Ì¹µ…À ¡™¥•±¤€ôø™¥•±¹¹…µ”¤¤ì(€½¹ÍÐÁ…åµ•¹Ñµ½Õ¹Ñ¥•±€ôlµ½Õ¹Ñ}}Œœ°€A…åµ•¹Ñ}µ½Õ¹Ñ}}Œœ°€A…¥‘}µ½Õ¹Ñ}}Œœ°€I••¥Ù•‘}µ½Õ¹Ñ}}Œœ°€Q½Ñ…±}µ½Õ¹Ñ}}Œœ°€µ½Õ¹Ñ}A…¥‘}}Œœ°€A…åµ•¹Ñ}Y…±Õ•}}Œœ°€ÑÕ…±}µ½Õ¹Ñ}}Œt¹™¥¹ ¡™¥•±¤€ôøÁ…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì¡™¥•±¤¤ì(€½¹ÍÐÁ…åµ•¹Ñ…Ñ•¥•±€ô™¥ÉÍÑÙ…¥±…‰±•¥•±¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°l…Ñ•}}Œœ°€A…åµ•¹Ñ}…Ñ•}}Œœ°€I••¥Ù•‘}…Ñ•}}Œœ°€A…¥‘}…Ñ•}}Œœ°€É•…Ñ•‘…Ñ”t¤ì(€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì€ô¥¹½µ¥¹A…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì¤ì(€½¹ÍÐÁ…åµ•¹ÑI•™•É•¹•¥•±‘Ì€ô¥¹½µ¥¹A…åµ•¹ÑI•™•É•¹•¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì¤ì(€½¹ÍÐÁ…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì€ô¥¹½µ¥¹A…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘Ì¤ì(€½¹ÍÐÁ…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ì€ôÍ•±•Ñ•‘¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°lMÑ…ÑÕÍ}}Œœ°€A…åµ•¹Ñ}MÑ…ÑÕÍ}}Œt¤ì(€½¹ÍÐÁ…åµ•¹ÑQåÁ•¥•±‘Ì€ôÍ•±•Ñ•‘¥•±‘Ì¡Á…åµ•¹Ñ¥•±‘9…µ•Ì°lQåÁ•}}Œœ°€A…åµ•¹Ñ}QåÁ•}}Œt¤ì(€½¹ÍÐÁ…åµ•¹ÑM•±•Ñ¥•±‘Ì€ôl%œ°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì 9…µ”œ¤€ü€9…µ”œ€è¹Õ±°°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì I•½É‘QåÁ•%œ¤€ü€I•½É‘QåÁ•%œ€è¹Õ±°°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì I•½É‘QåÁ•%œ¤€ü€I•½É‘QåÁ”¹9…µ”œ€è¹Õ±°°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì I•½É‘QåÁ•%œ¤€ü€I•½É‘QåÁ”¹•Ù•±½Á•É9…µ”œ€è¹Õ±°°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì MQ5}}Œœ¤€ü€MQ5}}Œœ€è¹Õ±°°Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì É•…Ñ•‘…Ñ”œ¤€ü€É•…Ñ•‘…Ñ”œ€è¹Õ±°°Á…åµ•¹Ñ…Ñ•¥•±°€¸¸¹ÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì°Á…åµ•¹Ñµ½Õ¹Ñ¥•±°€¸¸¹Á…åµ•¹ÑI•™•É•¹•¥•±‘Ì°€¸¸¹Á…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ì°€¸¸¹Á…åµ•¹ÑQåÁ•¥•±‘Ì°€¸¸¹Á…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ít¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐÁ…åµ•¹Ñ=É‘•È€ôÁ…åµ•¹Ñ…Ñ•¥•±€ü€‘íÁ…åµ•¹Ñ…Ñ•¥•±‘ôM9U11L1MP°É•…Ñ•‘…Ñ”M€€è€É•…Ñ•‘…Ñ”Mœì(€¥˜€¡Á…åµ•¹ÑM•±•Ñ¥•±‘Ì¹±•¹Ñ €ø€Ä¤ì(€€€½¹ÍÐÍ•±•Ñ•‘A…åµ•¹Ñ¥•±‘Ì€ôl¸¸¹¹•ÜM•Ð¡Á…åµ•¹ÑM•±•Ñ¥•±‘Ì¥tì(€€€½¹ÍÐÁ…åµ•¹Ñ…Ñ•Y…±Õ”€ô€¡Á…åµ•¹Ð¤€ôø€¡Á…åµ•¹Ñ…Ñ•¥•±€üÁ…åµ•¹ÑmÁ…åµ•¹Ñ…Ñ•¥•±‘t€è¹Õ±°¤ñðÁ…åµ•¹Ð¹…Ñ•}}ŒñðÁ…åµ•¹Ð¹É•…Ñ•‘…Ñ”ñð¹Õ±°ì(€€€½¹ÍÐÍ½ÉÑA…åµ•¹ÑI½ÝÌ€ô€¡É½ÝÌ¤€ôøÉ½ÝÌ¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡Á…åµ•¹Ñ…Ñ•Y…±Õ”¡ˆ¤ñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡Á…åµ•¹Ñ…Ñ•Y…±Õ”¡„¤ñð€œœ¤¤¤ì(€€€½¹ÍÐ‘•½É…Ñ•A…åµ•¹Ð€ô€¡Á…åµ•¹Ð°ÍÕÁÁ±¥•É%¹Ù½¥•%€ô¹Õ±°¤€ôø€¡ì(€€€€€€¸¸¹Á…åµ•¹Ð°(€€€€€…Ñ•}}ŒèÁ…åµ•¹Ñ…Ñ•Y…±Õ”¡Á…åµ•¹Ð¤°(€€€€€}A…åµ•¹Ñ}µ½Õ¹ÐèÁ…åµ•¹Ñµ½Õ¹Ñ¥•±€üÁ…åµ•¹ÑmÁ…åµ•¹Ñµ½Õ¹Ñ¥•±‘t€è¹Õ±°°(€€€€€}A…åµ•¹Ñ}µ½Õ¹Ñ}¥•±èÁ…åµ•¹Ñµ½Õ¹Ñ¥•±ñð¹Õ±°°(€€€€€}MÕÁÁ±¥•É}%¹Ù½¥•}9…µ”èÍÕÁÁ±¥•É%¹Ù½¥•%€üÍÕÁÁ±¥•É%¹Ù½¥•9…µ•5…ÁmÍÕÁÁ±¥•É%¹Ù½¥•%‘tñðÍÕÁÁ±¥•É%¹Ù½¥•%€è¹Õ±°°(€€€ô¤ì(€€€½¹ÍÐÍÕÁÁ±¥•ÉA…åµ•¹Ñ5…À€ô¹•Ü5…À ¤ì(€€€½¹ÍÐ‰Õå•ÉA…åµ•¹Ñ5…À€ô¹•Ü5…À ¤ì(€€€½¹ÍÐ…‘‘	É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ð€ô€¡Á…åµ•¹Ð°‰É½­•É5…Ñ ¤€ôøì(€€€€€¥˜€ …Á…åµ•¹Ðü¹%ñð€…‰É½­•É5…Ñ ¤É•ÑÕÉ¸ì(€€€€€ÍÕÁÁ±¥•ÉA…åµ•¹Ñ5…À¹‘•±•Ñ”¡Á…åµ•¹Ð¹%¤ì(€€€€€‰Õå•ÉA…åµ•¹Ñ5…À¹‘•±•Ñ”¡Á…åµ•¹Ð¹%¤ì(€€€€€¥˜€ …‰É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ñ5…À¹¡…Ì¡‰É½­•É5…Ñ ¹­•ä¤¤ì(€€€€€€€‰É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ñ5…À¹Í•Ð¡‰É½­•É5…Ñ ¹­•ä°ì(€€€€€€€€€€¸¸¹‰É½­•É5…Ñ °(€€€€€€€€€Á…åµ•¹ÑÌèmt°(€€€€€€€ô¤ì(€€€€€ô(€€€€€‰É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ñ5…À¹•Ð¡‰É½­•É5…Ñ ¹­•ä¤¹Á…åµ•¹ÑÌ¹ÁÕÍ ¡‘•½É…Ñ•A…åµ•¹Ð¡Á…åµ•¹Ð¤¤ì(€€€ôì(€€€½¹ÍÐ…‘‘MÕÁÁ±¥•ÉA…åµ•¹Ð€ô€¡Á…åµ•¹Ð°ÍÕÁÁ±¥•É%¹Ù½¥•%€ô¹Õ±°¤€ôøì(€€€€€¥˜€ …Á…åµ•¹Ðü¹%¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ¥¹Ù½¥•%€ôÍÕÁÁ±¥•É%¹Ù½¥•%ñð¥¹½µ¥¹A…åµ•¹ÑMÕÁÁ±¥•É%¹Ù½¥•%¡Á…åµ•¹Ð°ÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì¤ì(€€€€€ÍÕÁÁ±¥•ÉA…åµ•¹Ñ5…À¹Í•Ð¡Á…åµ•¹Ð¹%°ì(€€€€€€€€¸¸¹‘•½É…Ñ•A…åµ•¹Ð¡Á…åµ•¹Ð°¥¹Ù½¥•%¤°(€€€€€€€}MÕÁÁ±¥•É}%¹Ù½¥•}9…µ”è¥¹Ù½¥•%€üÍÕÁÁ±¥•É%¹Ù½¥•9…µ•5…Ám¥¹Ù½¥•%‘tñð¥¹Ù½¥•%€è€MÕÁÁ±¥•ÈÁ…åµ•¹Ðœ°(€€€€€€€}MÕÁÁ±¥•É}9…µ”è¥¹Ù½¥•%€üÍÕÁÁ±¥•É%¹Ù½¥•MÕÁÁ±¥•É9…µ•5…Ám¥¹Ù½¥•%‘tñðÍÕÁÁ±¥•É%¹Ù½¥•9…µ•5…Ám¥¹Ù½¥•%‘tñð¥¹Ù½¥•%€è€MÕÁÁ±¥•ÈÁ…åµ•¹Ðœ°(€€€€€ô¤ì(€€€ôì(€€€½¹ÍÐ…‘‘	Õå•ÉA…åµ•¹Ð€ô€¡Á…åµ•¹Ð¤€ôøì(€€€€€¥˜€ …Á…åµ•¹Ðü¹%¤É•ÑÕÉ¸ì(€€€€€‰Õå•ÉA…åµ•¹Ñ5…À¹Í•Ð¡Á…åµ•¹Ð¹%°‘•½É…Ñ•A…åµ•¹Ð¡Á…åµ•¹Ð¤¤ì(€€€ôì((€€€¥˜€¡ÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì¹±•¹Ñ €˜˜ÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì¹±•¹Ñ ¤ì(€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±° (€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì¹µ…À¡…Íå¹Œ€¡™¥•±¤€ôøì(€€€€€€€€€½¹ÍÐÁ…åµ•¹Ñ¡Õ¹­Ì€ô…Ý…¥Ð½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€€€€€€€¡Õ¹­%‘Ì¡ÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€€€€€€€½¹ÍÐ¥¹1¥ÍÐ€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í•Í…Á•M½Å°¡¥¥ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€Í½Å°è€(€€€€€€€€€€€M1P€‘íÍ•±•Ñ•‘A…åµ•¹Ñ¥•±‘Ì¹©½¥¸ œ°€œ¥ô(€€€€€€€€€€€I=4A…åµ•¹Ñ}}Œ(€€€€€€€€€€€]!I€‘í™¥•±‘ô%8€ ‘í¥¹1¥ÍÑô¤(€€€€€€€€€€€=IH	d€‘íÁ…åµ•¹Ñ=É‘•Éô(€€€€€€€€€€€1%5%P€ÈÀÀÀ(€€€€€€€€€€°(€€€€€€€€€€€€€€€±¥µ¥Ðè€ÈÀÀÀ°(€€€€€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€€€€€ôì(€€€€€€€€€€€ô¤°(€€€€€€€€€€¤ì(€€€€€€€€€™½È€¡½¹ÍÐÁ…åµ•¹Ð½˜Á…åµ•¹Ñ¡Õ¹­Ì¹™±…Ð ¤¤…‘‘MÕÁÁ±¥•ÉA…åµ•¹Ð¡Á…åµ•¹Ð°Á…åµ•¹Ñm™¥•±‘t¤ì(€€€€€€€ô¤°(€€€€€€¤ì(€€€ô(€€€¥˜€¡Á…åµ•¹Ñ¥•±‘9…µ•Ì¹¡…Ì MQ5}}Œœ¤¤ì(€€€€€½¹ÍÐÍÑ•µA…åµ•¹ÑÌ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ (€€€€€€€€(€€€€€€€M1P€‘íÍ•±•Ñ•‘A…åµ•¹Ñ¥•±‘Ì¹©½¥¸ œ°€œ¥ô(€€€€€€€I=4A…åµ•¹Ñ}}Œ(€€€€€€€]!IMQ5}}Œ€ô€œ‘í•Í…Á•M½Å°¡…ÑÕ…±MÑ•µ%¥ôœ(€€€€€€€=IH	d€‘íÁ…åµ•¹Ñ=É‘•Éô(€€€€€€€1%5%P€ÈÀÀÀ(€€€€€€°(€€€€€€€ì±¥µ¥Ðè€ÈÀÀÀ°Í½™Ñ…¥°èÑÉÕ”ô°(€€€€€€¤ì(€€€€€™½È€¡½¹ÍÐÁ…åµ•¹Ð½˜ÍÑ•µA…åµ•¹ÑÌ¤ì(€€€€€€€¥˜€¡¥¹½µ¥¹A…åµ•¹Ñ%ÍI••¥Ù…‰±•I•µ¥ÑÑ…¹”¡Á…åµ•¹Ð°l¸¸¹Á…åµ•¹ÑI•™•É•¹•¥•±‘Ì°€¸¸¹Á…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹Á…åµ•¹ÑQåÁ•¥•±‘Ì°€¸¸¹Á…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ít¤¤½¹Ñ¥¹Õ”ì(€€€€€€€½¹ÍÐ…µ½Õ¹Ð€ôÁ…åµ•¹Ñµ½Õ¹Ñ¥•±€ü¥¹½µ¥¹A…åµ•¹Ñ9Õµ‰•È¡Á…åµ•¹ÑmÁ…åµ•¹Ñµ½Õ¹Ñ¥•±‘t¤€è¹Õ±°ì(€€€€€€€½¹ÍÐ‰É½­•É½µµ¥ÍÍ¥½¹5…Ñ €ô™¥¹‘	É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ñ5…Ñ ¡Á…åµ•¹Ð°…µ½Õ¹Ð°‰É½­•É½µµ¥ÍÍ¥½¹É½ÕÁÌ°l¸¸¹Á…åµ•¹ÑI•™•É•¹•¥•±‘Ì°€¸¸¹Á…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì°€¸¸¹Á…åµ•¹ÑQåÁ•¥•±‘Ì°€¸¸¹Á…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ít¤ì(€€€€€€€¥˜€¡‰É½­•É½µµ¥ÍÍ¥½¹5…Ñ ¤ì(€€€€€€€€€…‘‘	É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ð¡Á…åµ•¹Ð°‰É½­•É½µµ¥ÍÍ¥½¹5…Ñ ¤ì(€€€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€€€ô(€€€€€€€½¹ÍÐ‰…¹­¡…É”€ô¥¹½µ¥¹A…åµ•¹Ñ1½½­Í	…¹­¡…É”¡Á…åµ•¹Ð°ì(€€€€€€€€€É•™•É•¹•¥•±‘ÌèÁ…åµ•¹ÑI•™•É•¹•¥•±‘Ì°(€€€€€€€€€‘¥É•Ñ¥½¹¥•±‘ÌèÁ…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì°(€€€€€€€€€ÑåÁ•¥•±‘ÌèÁ…åµ•¹ÑQåÁ•¥•±‘Ì°(€€€€€€€€€ÍÑ…ÑÕÍ¥•±‘ÌèÁ…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ì°(€€€€€€€ô¤ì(€€€€€€€¥˜€¡‰…¹­¡…É”¤½¹Ñ¥¹Õ”ì(€€€€€€€½¹ÍÐÍÕÁÁ±¥•ÉM¥‘”€ô¥¹½µ¥¹A…åµ•¹Ñ1½½­ÍMÕÁÁ±¥•ÉM¥‘”¡Á…åµ•¹Ð°ì(€€€€€€€€€ÍÕÁÁ±¥•É%¹Ù½¥•¥•±‘ÌèÍÕÁÁ±¥•É%¹Ù½¥•1½½­ÕÁ¥•±‘Ì°(€€€€€€€€€‘¥É•Ñ¥½¹¥•±‘ÌèÁ…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì°(€€€€€€€€€ÑåÁ•¥•±‘ÌèÁ…åµ•¹ÑQåÁ•¥•±‘Ì°(€€€€€€€€€ÍÑ…ÑÕÍ¥•±‘ÌèÁ…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ì°(€€€€€€€ô¤ì(€€€€€€€¥˜€¡ÍÕÁÁ±¥•ÉM¥‘”¤ì(€€€€€€€€€…‘‘MÕÁÁ±¥•ÉA…åµ•¹Ð¡Á…åµ•¹Ð¤ì(€€€€€€€ô•±Í”¥˜€ (€€€€€€€€€¥¹½µ¥¹A…åµ•¹Ñ1½½­ÍMÑ•µA…å…‰±•…±Õ±…Ñ¥½¸¡Á…åµ•¹Ð°ì(€€€€€€€€€€€…µ½Õ¹Ð°(€€€€€€€€€€€Á…å…‰±•µ½Õ¹ÑÌèÁ…å…‰±•µ½Õ¹Ñ…¹‘¥‘…Ñ•Ì°(€€€€€€€€€€€É•™•É•¹•¥•±‘ÌèÁ…åµ•¹ÑI•™•É•¹•¥•±‘Ì°(€€€€€€€€€€€‘¥É•Ñ¥½¹¥•±‘ÌèÁ…åµ•¹Ñ¥É•Ñ¥½¹¥•±‘Ì°(€€€€€€€€€€€ÑåÁ•¥•±‘ÌèÁ…åµ•¹ÑQåÁ•¥•±‘Ì°(€€€€€€€€€€€ÍÑ…ÑÕÍ¥•±‘ÌèÁ…åµ•¹ÑMÑ…ÑÕÍ¥•±‘Ì°(€€€€€€€€€€€…±±½Ý	±…¹­M¥¹…°è€…ÍÑ•µ!…Í•±¥Ù•Éä°(€€€€€€€€€ô¤(€€€€€€€€¤ì(€€€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€€€ô•±Í”¥˜€¡…µ½Õ¹Ð€ôô¹Õ±°ñð…µ½Õ¹Ð€øô€À¤ì(€€€€€€€€€…‘‘	Õå•ÉA…åµ•¹Ð¡Á…åµ•¹Ð¤ì(€€€€€€€ô(€€€€€ô(€€€ô(€€€ÍÕÁÁ±¥•É%¹Ù½¥•A…åµ•¹ÑÌ€ôÍ½ÉÑA…åµ•¹ÑI½ÝÌ¡l¸¸¹ÍÕÁÁ±¥•ÉA…åµ•¹Ñ5…À¹Ù…±Õ•Ì ¥t¤ì(€€€‰Õå•É%¹Ù½¥•A…åµ•¹ÑÌ€ôÍ½ÉÑA…åµ•¹ÑI½ÝÌ¡l¸¸¹‰Õå•ÉA…åµ•¹Ñ5…À¹Ù…±Õ•Ì ¥t¤ì(€ô((€½¹ÍÐmÙ•ÍÍ•±9…µ”°Á½ÉÑ9…µ”°…•¹Ñ9…µ”°…½Õ¹Ñ9…µ”°‰Õå•É	É½­•É9…µ”°™…Ñ½É¥¹%¹Ù½¥•9…µ•t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡mÉ•½É‘I…Ü¹Y•ÍÍ•±}}Œ€üÉ•Í½±Ù•Y¥…EÕ•Éä Y•ÍÍ•±}}Œœ°É•½É‘I…Ü¹Y•ÍÍ•±}}Œ°€9…µ”œ¤€èAÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤°É•½É‘I…Ü¹A½ÉÑ}}Œ€üÉ•Í½±Ù•Y¥…EÕ•Éä A½ÉÑ}}Œœ°É•½É‘I…Ü¹A½ÉÑ}}Œ°€9…µ”œ¤€èAÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤°É•½É‘I…Ü¹•¹Ñ}}Œ€üÉ•Í½±Ù•Y¥…EÕ•Éä ½Õ¹Ðœ°É•½É‘I…Ü¹•¹Ñ}}Œ°€9…µ”œ¤€èAÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤°É•½É‘I…Ü¹½Õ¹Ñ}}Œ€üÉ•Í½±Ù•Y¥…EÕ•Éä ½Õ¹Ðœ°É•½É‘I…Ü¹½Õ¹Ñ}}Œ°€9…µ”œ¤€èAÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤°É•½É‘I…Ü¹	Õå•É}	É½­•É}}Œ€üÉ•Í½±Ù•Y¥…EÕ•Éä ½Õ¹Ðœ°É•½É‘I…Ü¹	Õå•É}	É½­•É}}Œ°€9…µ”œ¤€èAÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤°É•½É‘I…Ü¹…Ñ½É¥¹}%¹Ù½¥•}}Œ€üÉ•Í½±Ù•Y¥…EÕ•Éä %¹Ù½¥•}}Œœ°É•½É‘I…Ü¹…Ñ½É¥¹}%¹Ù½¥•}}Œ°€9…µ”œ¤€èAÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¥t¤ì((€½¹ÍÐ‰Õå•É	É½­•ÉÍ]¥Ñ¡9…µ•Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹…±° (€€€‰Õå•É	É½­•ÉÌ¹µ…À¡…Íå¹Œ€¡‰ˆ¤€ôø€¡ì(€€€€€€¸¸¹‰ˆ°(€€€€€}	Õå•É}	É½­•É}9…µ”è‰ˆ¹	Õå•É}	É½­•É}}Œ€ü‰É½­•É½Õ¹Ñ5…Ám‰ˆ¹	Õå•É}	É½­•É}}tñð‰É½­•É½Õ¹Ñ5…ÁmMÑÉ¥¹œ¡‰ˆ¹	Õå•É}	É½­•É}}Œ¤¹Í±¥” À°€ÄÔ¥tñð€¡…Ý…¥ÐÉ•Í½±Ù•Y¥…EÕ•Éä ½Õ¹Ðœ°‰ˆ¹	Õå•É}	É½­•É}}Œ°€9…µ”œ¤¤€è¹Õ±°°(€€€ô¤¤°(€€¤ì((€½¹ÍÐÍÕÁÁ±¥•É	É½­•É%‘Ì€ôl¸¸¹¹•ÜM•Ð¡±¥¹•%Ñ•µÌ¹µ…À ¡±¤¤€ôø±¤¹MÕÁÁ±¥•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤¥tì(€½¹ÍÐÍÕÁÁ±¥•É	É½­•É9…µ•5…À€ôíôì(€…Ý…¥ÐAÉ½µ¥Í”¹…±° (€€€ÍÕÁÁ±¥•É	É½­•É%‘Ì¹µ…À¡…Íå¹Œ€¡¥¤€ôøì(€€€€€ÍÕÁÁ±¥•É	É½­•É9…µ•5…Ám¥‘t€ô‰É½­•É½Õ¹Ñ5…Ám¥‘tñð‰É½­•É½Õ¹Ñ5…ÁmMÑÉ¥¹œ¡¥¤¹Í±¥” À°€ÄÔ¥tñð€¡…Ý…¥ÐÉ•Í½±Ù•Y¥…EÕ•Éä ½Õ¹Ðœ°¥°€9…µ”œ¤¤ì(€€€ô¤°(€€¤ì((€½¹ÍÐ±¥¹•%Ñ•µÍ]¥Ñ¡9…µ•Ì€ô±¥¹•%Ñ•µÌ¹µ…À ¡±¤¤€ôøì(€€€½¹ÍÐ…±Õ±…Ñ•‘EÕ…¹Ñ¥Ñä€ô™¥¹…¹¥…±EÕ…¹Ñ¥Ñä¡±¤°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€½¹ÍÐ…±Õ±…Ñ•‘M•±°€ô±¥¹•M•±±µ½Õ¹Ð¡±¤°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€½¹ÍÐ…±Õ±…Ñ•‘	Õä€ô±¥¹•	Õåµ½Õ¹Ð¡±¤°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹±¤°(€€€€€}¥¹…¹¥…±}EÕ…¹Ñ¥Ñäè…±Õ±…Ñ•‘EÕ…¹Ñ¥Ñä°(€€€€€}¥¹…¹¥…±}EÕ…¹Ñ¥Ñå}U¹¥Ðè€5Pœ°(€€€€€€¸¸¸ …ÍÑ•µ!…Í•±¥Ù•Éä(€€€€€€€€üì(€€€€€€€€€€€Q½Ñ…±}AÉ¥•}}Œè…±Õ±…Ñ•‘M•±°°(€€€€€€€€€€€Q½Ñ…±}½ÍÑ}}Œè…±Õ±…Ñ•‘	Õä°(€€€€€€€€€ô(€€€€€€€€èíô¤°(€€€€€}AÉ½‘ÕÑ}9…µ”è±¥lAÉ½‘ÕÑ}}Ètü¹9…µ”€üü¹Õ±°°(€€€€€}MÕÁÁ±¥•É}	É½­•É}9…µ”è±¤¹MÕÁÁ±¥•É}	É½­•É}}Œ€üÍÕÁÁ±¥•É	É½­•É9…µ•5…Ám±¤¹MÕÁÁ±¥•É}	É½­•É}}t€è¹Õ±°°(€€€ôì(€ô¤ì(€½¹ÍÐ•áÑÉ…½ÍÑÍ]¥Ñ¡9…µ•Ì€ô•áÑÉ…½ÍÑÌ¹µ…À ¡•Œ¤€ôøì(€€€½¹ÍÐ…±Õ±…Ñ•‘EÕ…¹Ñ¥Ñä€ô™¥¹…¹¥…±EÕ…¹Ñ¥Ñä¡•Œ°ÍÑ•µ!…Í•±¥Ù•Éä°€EÕ…¹Ñ¥Ñå}I…¹•}5…á}}Œœ¤ì(€€€½¹ÍÐ…±Õ±…Ñ•‘M•±°€ô•áÑÉ…M•±±µ½Õ¹Ð¡•Œ°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€½¹ÍÐ…±Õ±…Ñ•‘	Õä€ô•áÑÉ…	Õåµ½Õ¹Ð¡•Œ°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹•Œ°(€€€€€}¥¹…¹¥…±}EÕ…¹Ñ¥Ñäè…±Õ±…Ñ•‘EÕ…¹Ñ¥Ñä°(€€€€€}¥¹…¹¥…±}EÕ…¹Ñ¥Ñå}U¹¥Ðè€5Pœ°(€€€€€€¸¸¸ …ÍÑ•µ!…Í•±¥Ù•Éä(€€€€€€€€üì(€€€€€€€€€€€1¥¹•}Q½Ñ…±}}Œè…±Õ±…Ñ•‘M•±°°(€€€€€€€€€€€1¥¹•}Q½Ñ…±}	Õå}}Œè…±Õ±…Ñ•‘	Õä°(€€€€€€€€€ô(€€€€€€€€èíô¤°(€€€€€}AÉ½‘ÕÑ}9…µ”è•lAÉ½‘ÕÐÉ%‘}}Ètü¹9…µ”€üü¹Õ±°°(€€€ôì(€ô¤ì(€½¹ÍÐ…±Õ±…Ñ•‘1¥¹•%Ñ•µM•±°€ô±¥¹•%Ñ•µÌ¹É•‘Õ” ¡ÍÕ´°±¤¤€ôøì(€€€¥˜€¡±¤¹…¹•±±•‘}}Œ¤É•ÑÕÉ¸ÍÕ´ì(€€€É•ÑÕÉ¸ÍÕ´€¬±¥¹•M•±±µ½Õ¹Ð¡±¤°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€ô°€À¤ì(€½¹ÍÐ…±Õ±…Ñ•‘áÑÉ…½ÍÑM•±°€ô•áÑÉ…½ÍÑÌ¹É•‘Õ” ¡ÍÕ´°•Œ¤€ôøì(€€€¥˜€¡•Œ¹…¹•±±•‘}}Œ¤É•ÑÕÉ¸ÍÕ´ì(€€€É•ÑÕÉ¸ÍÕ´€¬•áÑÉ…M•±±µ½Õ¹Ð¡•Œ°ÍÑ•µ!…Í•±¥Ù•Éä¤ì(€ô°€À¤ì(€½¹ÍÐ…±Õ±…Ñ•‘U¹‘…Ñ•‘	Õå•É%¹Ù½¥”€ô…±Õ±…Ñ•‘1¥¹•%Ñ•µM•±°€¬…±Õ±…Ñ•‘áÑÉ…½ÍÑM•±°ì(€½¹ÍÐÍ¡½Õ±‘UÍ•…±Õ±…Ñ•‘	Õå•É%¹Ù½¥”€ô€…É•½É‘I…Ü¹•±¥Ù•Éå}…Ñ•}}Œ€˜˜…±Õ±…Ñ•‘U¹‘…Ñ•‘	Õå•É%¹Ù½¥”€ø€Àì(€½¹ÍÐ…±Õ±…Ñ•‘MÕÁÁ±¥•É%¹Ù½¥”€ôÁ…å…‰±•µ½Õ¹Ñ…¹‘¥‘…Ñ•ÍlÁt€üü€Àì(€½¹ÍÐÉ•½É€ôì(€€€€¸¸¹É•½É‘I…Ü°(€€€Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}ŒèÍ¡½Õ±‘UÍ•…±Õ±…Ñ•‘	Õå•É%¹Ù½¥”€ü…±Õ±…Ñ•‘U¹‘…Ñ•‘	Õå•É%¹Ù½¥”€èÉ•½É‘I…Ü¹Q½Ñ…±}%¹Ù½¥•}µ½Õ¹Ñ}}Œ°(€€€}MÕÁÁ±¥•É}%¹Ù½¥•}µ½Õ¹Ðè…±Õ±…Ñ•‘MÕÁÁ±¥•É%¹Ù½¥”°(€€€}	Õå•É}A…å}Q•Éµ}…Ñ”è…±Õ±…Ñ•‘	Õå•ÉA…åQ•Éµ…Ñ”¡É•½É‘I…Ü¤ñðÉ•½É‘I…Ü¹%¹Ù½¥•}Õ•}…Ñ•}}ŒñðÉ•½É‘I…Ü¹	Õå•É}A…å}Q•Éµ}…Ñ•}}Œ°(€€€}	Õå•É}9…µ”èÉ•½É‘I…Ü¹	Õå•É}9…µ•}}Œñð…½Õ¹Ñ9…µ”ñðÉ•½É‘I…Ü¹	Õå•É}}Œñð¹Õ±°°(€€€}Y•ÍÍ•±}9…µ”èÙ•ÍÍ•±9…µ”°(€€€}A½ÉÑ}9…µ”èÁ½ÉÑ9…µ”°(€€€}•¹Ñ}9…µ”è…•¹Ñ9…µ”°(€€€}½Õ¹Ñ}9…µ”è…½Õ¹Ñ9…µ”°(€€€}	Õå•É}	É½­•É}9…µ”è‰Õå•É	É½­•É9…µ”°(€€€}…Ñ½É¥¹}%¹Ù½¥•}9…µ”è™…Ñ½É¥¹%¹Ù½¥•9…µ”°(€ôì((€É•ÑÕÉ¸ì(€€€É•½É°(€€€±¥¹•%Ñ•µÌè±¥¹•%Ñ•µÍ]¥Ñ¡9…µ•Ì°(€€€•áÑÉ…½ÍÑÌè•áÑÉ…½ÍÑÍ]¥Ñ¡9…µ•Ì°(€€€‰Õå•É	É½­•ÉÌè‰Õå•É	É½­•ÉÍ]¥Ñ¡9…µ•Ì°(€€€ÍÕÁÁ±¥•É%¹Ù½¥•A…åµ•¹ÑÌ°(€€€‰Õå•É%¹Ù½¥•A…åµ•¹ÑÌ°(€€€‰É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹ÑÌèl¸¸¹‰É½­•É½µµ¥ÍÍ¥½¹A…åµ•¹Ñ5…À¹Ù…±Õ•Ì ¥t¹µ…À ¡É½ÕÀ¤€ôø€¡ì(€€€€€€¸¸¹É½ÕÀ°(€€€€€Á…åµ•¹ÑÌèÉ½ÕÀ¹Á…åµ•¹ÑÌ¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡ˆ¹…Ñ•}}Œñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡„¹…Ñ•}}Œñð€œœ¤¤¤°(€€€ô¤¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í…±•Í™½É•MÑ•µ•Ñ…¥±Õ±°¡‰½‘ä°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ¡…Í]É¥Ñ”€ô	½½±•…¸ ¡‰½‘äü¹ÕÁ‘…Ñ•Ì€˜˜=‰©•Ð¹­•åÌ¡‰½‘ä¹ÕÁ‘…Ñ•Ì¤¹±•¹Ñ ¤ñð€¡‰½‘äü¹¡¥±‘UÁ‘…Ñ•Ì€˜˜=‰©•Ð¹­•åÌ¡‰½‘ä¹¡¥±‘UÁ‘…Ñ•Ì¤¹±•¹Ñ ¤¤ì(€¥˜€¡¡…Í]É¥Ñ”¤É•ÑÕÉ¸Í…±•Í™½É•MÑ•µ•Ñ…¥±U¹…¡•¡‰½‘ä°É•Ä°…•ÍÍ½¹Ñ•áÐ¤ì(€½¹ÍÐÍÑ•µ%€ôMÑÉ¥¹œ¡‰½‘äü¹ÍÑ•µ%ñð€œœ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐ…¡•€ô…Ý…¥Ð…¡•‘M…±•Í™½É•Y…±Õ”¡ì(€€€¹…µ•ÍÁ…”è€Í…±•Í™½É”µÍÑ•´µ‘•Ñ…¥°œ°(€€€ÑÑ±M•½¹‘Ìè€ÄÔ°(€€€Á…å±½…èìÍÑ•µ%ô°(€€€Ñ…ÌèlÍ…±•Í™½É”éÍÑ•´œ°Í…±•Í™½É”éÍÑ•´è‘íÍÑ•µ%‘õt°(€€€‰½‘ä°(€€€É•Ä°(€€€…•ÍÍ½¹Ñ•áÐ°(€€€±½…‘•Èè€ ¤€ôøÍ…±•Í™½É•MÑ•µ•Ñ…¥±U¹…¡•¡ìÍÑ•µ%ô°É•Ä°…•ÍÍ½¹Ñ•áÐ¤°(€ô¤ì(€É•ÑÕÉ¸…¡•¹Ù…±Õ”ì)ô()™Õ¹Ñ¥½¸Õ¹¥ÅÕ•AÉ•Í•¹ÑY…±Õ•Ì¡Ù…±Õ•Ì¤ì(€É•ÑÕÉ¸l¸¸¹¹•ÜM•Ð¡Ù…±Õ•Ì¹™¥±Ñ•È ¡Ù…±Õ”¤€ôøÙ…±Õ”€„ô¹Õ±°€˜˜Ù…±Õ”€„ôô€œœ¤¥tì)ô()™Õ¹Ñ¥½¸Í¥¹±•=É5¥á•¡Ù…±Õ•Ì¤ì(€½¹ÍÐÕ¹¥ÅÕ”€ôÕ¹¥ÅÕ•AÉ•Í•¹ÑY…±Õ•Ì¡Ù…±Õ•Ì¤ì(€¥˜€ …Õ¹¥ÅÕ”¹±•¹Ñ ¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸Õ¹¥ÅÕ”¹±•¹Ñ €ôôô€Ä€üÕ¹¥ÅÕ•lÁt€è€5¥á•œì)ô()™Õ¹Ñ¥½¸±…Ñ•ÍÑ%Í½…Ñ”¡Ù…±Õ•Ì¤ì(€½¹ÍÐ‘…Ñ•Ì€ôÕ¹¥ÅÕ•AÉ•Í•¹ÑY…±Õ•Ì¡Ù…±Õ•Ì¤¹™¥±Ñ•È ¡Ù…±Õ”¤€ôø€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡MÑÉ¥¹œ¡Ù…±Õ”¤¤¤ì(€É•ÑÕÉ¸‘…Ñ•Ì¹Í½ÉÐ ¤¹…Ð ´Ä¤ñð¹Õ±°ì)ô()™Õ¹Ñ¥½¸…‘‘	É½­•ÉAÉ½‘ÕÑEÕ…¹Ñ¥Ñä¡É½ÕÀ°É½Ü¤ì(€½¹ÍÐÁÉ½‘ÕÑ9…µ”€ôÉ½Ü¹ÁÉ½‘ÕÑ…µ¥±äñðÉ½Ü¹ÁÉ½‘ÕÑ9…µ”ñð€ŸŠPœì(€½¹ÍÐÕ¹¥Ð€ôÉ½Ü¹ÅÕ…¹Ñ¥ÑåU¹¥Ðñð€U=4¹½ÐÍ•Ðœì(€½¹ÍÐ­•ä€ô€‘íÁÉ½‘ÕÑ9…µ•ôèè‘íÕ¹¥Ñõ€ì(€¥˜€ …É½ÕÀ¹}ÁÉ½‘ÕÑ5…À¹¡…Ì¡­•ä¤¤ì(€€€É½ÕÀ¹}ÁÉ½‘ÕÑ5…À¹Í•Ð¡­•ä°ì(€€€€€ÁÉ½‘ÕÑ9…µ”°(€€€€€ÁÉ½‘ÕÑ…µ¥±äèÉ½Ü¹ÁÉ½‘ÕÑ…µ¥±äñðÁÉ½‘ÕÑ9…µ”°(€€€€€ÅÕ…¹Ñ¥Ñäè€À°(€€€€€¡…ÍEÕ…¹Ñ¥Ñäè™…±Í”°(€€€€€Õ¹¥Ð°(€€€ô¤ì(€ô(€½¹ÍÐ¥Ñ•´€ôÉ½ÕÀ¹}ÁÉ½‘ÕÑ5…À¹•Ð¡­•ä¤ì(€½¹ÍÐÅÑä€ô¹Õµ•É¥Y…±Õ”¡É½Ü¹‰‘¹EÕ…¹Ñ¥Ñä¤ì(€¥˜€¡ÅÑä€„ô¹Õ±°¤ì(€€€¥Ñ•´¹ÅÕ…¹Ñ¥Ñä€¬ôÅÑäì(€€€¥Ñ•´¹¡…ÍEÕ…¹Ñ¥Ñä€ôÑÉÕ”ì(€ô)ô()™Õ¹Ñ¥½¸½µ‰¥¹•	É½­•É½µµ¥ÍÍ¥½¹I½ÝÌ¡É½ÝÌ¤ì(€½¹ÍÐÉ½ÕÁÌ€ô¹•Ü5…À ¤ì(€™½È€¡½¹ÍÐÉ½Ü½˜É½ÝÌ¤ì(€€€½¹ÍÐ‰É½­•É-•ä€ôÉ½Ü¹‰É½­•É%ñðÉ½Ü¹‰É½­•É9…µ”ñð€œœì(€€€½¹ÍÐ­•ä€ômÉ½Ü¹ÍÑ•µ%°É½Ü¹‰É½­•ÉQåÁ”°‰É½­•É-•åt¹©½¥¸ œèèœ¤ì(€€€¥˜€ …É½ÕÁÌ¹¡…Ì¡­•ä¤¤ì(€€€€€É½ÕÁÌ¹Í•Ð¡­•ä°ì(€€€€€€€€¸¸¹É½Ü°(€€€€€€€¥è€‘íÉ½Ü¹‰É½­•ÉQåÁ•ô´‘íÉ½Ü¹ÍÑ•µ%‘ô´‘í‰É½­•É-•åõ€¹É•Á±…” ½qÌ¬½œ°€œ´œ¤°(€€€€€€€½µµ¥ÍÍ¥½¹µ½Õ¹Ðè€À°(€€€€€€€}ÁÉ½‘ÕÑ5…Àè¹•Ü5…À ¤°(€€€€€€€}½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥•Ìèmt°(€€€€€€€}½µµ¥ÍÍ¥½¹U¹¥Ñ1¥¹•Ìèmt°(€€€€€€€}Á…åµ•¹Ñ…Ñ•Ìèmt°(€€€€€€€}Á…åµ•¹Ñ…Ñ•1…‰•±Ìèmt°(€€€€€€€}Á…åµ•¹Ñ•±…åÌèmt°(€€€€€ô¤ì(€€€ô(€€€½¹ÍÐÉ½ÕÀ€ôÉ½ÕÁÌ¹•Ð¡­•ä¤ì(€€€É½ÕÀ¹½µµ¥ÍÍ¥½¹µ½Õ¹Ð€¬ô9Õµ‰•È¡É½Ü¹½µµ¥ÍÍ¥½¹µ½Õ¹Ðñð€À¤ì(€€€¥˜€¡É½Ü¹½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥”€„ô¹Õ±°¤É½ÕÀ¹}½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥•Ì¹ÁÕÍ ¡9Õµ‰•È¡É½Ü¹½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥”¤¤ì(€€€É½ÕÀ¹}½µµ¥ÍÍ¥½¹U¹¥Ñ1¥¹•Ì¹ÁÕÍ ¡ì(€€€€€ÁÉ½‘ÕÑ9…µ”èÉ½Ü¹ÁÉ½‘ÕÑ…µ¥±äñðÉ½Ü¹ÁÉ½‘ÕÑ9…µ”ñð€ŸŠPœ°(€€€€€Ù…±Õ”è¹Õµ•É¥Y…±Õ”¡É½Ü¹½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥”¤°(€€€€€Õ¹¥ÐèÉ½Ü¹ÅÕ…¹Ñ¥ÑåU¹¥Ðñð€U=4¹½ÐÍ•Ðœ°(€€€ô¤ì(€€€¥˜€¡É½Ü¹Á…åµ•¹Ñ…Ñ”¤É½ÕÀ¹}Á…åµ•¹Ñ…Ñ•Ì¹ÁÕÍ ¡É½Ü¹Á…åµ•¹Ñ…Ñ”¤ì(€€€¥˜€¡É½Ü¹Á…åµ•¹Ñ…Ñ•1…‰•°¤É½ÕÀ¹}Á…åµ•¹Ñ…Ñ•1…‰•±Ì¹ÁÕÍ ¡É½Ü¹Á…åµ•¹Ñ…Ñ•1…‰•°¤ì(€€€¥˜€¡É½Ü¹Á…åµ•¹Ñ•±…ä€„ô¹Õ±°¤É½ÕÀ¹}Á…åµ•¹Ñ•±…åÌ¹ÁÕÍ ¡9Õµ‰•È¡É½Ü¹Á…åµ•¹Ñ•±…ä¤¤ì(€€€…‘‘	É½­•ÉAÉ½‘ÕÑEÕ…¹Ñ¥Ñä¡É½ÕÀ°É½Ü¤ì(€ô((€É•ÑÕÉ¸l¸¸¹É½ÕÁÌ¹Ù…±Õ•Ì ¥t¹µ…À ¡É½ÕÀ¤€ôøì(€€€½¹ÍÐÕ¹¥ÑAÉ¥•Ì€ôÕ¹¥ÅÕ•AÉ•Í•¹ÑY…±Õ•Ì¡É½ÕÀ¹}½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥•Ì¤ì(€€€½¹ÍÐÁ…åµ•¹Ñ…Ñ•Ì€ôÕ¹¥ÅÕ•AÉ•Í•¹ÑY…±Õ•Ì¡É½ÕÀ¹}Á…åµ•¹Ñ…Ñ•Ì¤ì(€€€½¹ÍÐÁ…åµ•¹Ñ•±…åÌ€ôÕ¹¥ÅÕ•AÉ•Í•¹ÑY…±Õ•Ì¡É½ÕÀ¹}Á…åµ•¹Ñ•±…åÌ¤ì(€€€½¹ÍÐ½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥•1¥¹•Ì€ôÉ½ÕÀ¹}½µµ¥ÍÍ¥½¹U¹¥Ñ1¥¹•Ì¹µ…À ¡¥Ñ•´¤€ôø€¡ì(€€€€€ÁÉ½‘ÕÑ9…µ”è¥Ñ•´¹ÁÉ½‘ÕÑ9…µ”°(€€€€€Ù…±Õ”è¥Ñ•´¹Ù…±Õ”°(€€€€€Õ¹¥Ðè¥Ñ•´¹Õ¹¥Ð°(€€€€€±…‰•°è¥Ñ•´¹Ù…±Õ”€„ô¹Õ±°€ü€‘íµ½¹•ä¡¥Ñ•´¹Ù…±Õ”¥ô€¼€‘í¥Ñ•´¹Õ¹¥Ñõ€€è€ŸŠPœ°(€€€ô¤¤ì(€€€½¹ÍÐÁÉ½‘ÕÑEÕ…¹Ñ¥Ñ¥•Ì€ôl¸¸¹É½ÕÀ¹}ÁÉ½‘ÕÑ5…À¹Ù…±Õ•Ì ¥t¹µ…À ¡¥Ñ•´¤€ôø€¡ì(€€€€€ÁÉ½‘ÕÑ9…µ”è¥Ñ•´¹ÁÉ½‘ÕÑ9…µ”°(€€€€€ÁÉ½‘ÕÑ…µ¥±äè¥Ñ•´¹ÁÉ½‘ÕÑ…µ¥±äñð¥Ñ•´¹ÁÉ½‘ÕÑ9…µ”°(€€€€€ÅÕ…¹Ñ¥Ñäè¥Ñ•´¹¡…ÍEÕ…¹Ñ¥Ñä€ü¥Ñ•´¹ÅÕ…¹Ñ¥Ñä€è¹Õ±°°(€€€€€ÅÕ…¹Ñ¥ÑåU¹¥Ðè¥Ñ•´¹Õ¹¥Ð°(€€€€€±…‰•°è¥Ñ•´¹¡…ÍEÕ…¹Ñ¥Ñä€ü€‘í¥Ñ•´¹ÁÉ½‘ÕÑ9…µ•ô€´€‘í™½Éµ…ÑEÕ…¹Ñ¥Ñå1…‰•°¡¥Ñ•´¹ÅÕ…¹Ñ¥Ñä°¥Ñ•´¹Õ¹¥Ð¥õ€€è¥Ñ•´¹ÁÉ½‘ÕÑ9…µ”°(€€€ô¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹É½ÕÀ°(€€€€€ÁÉ½‘ÕÑ9…µ”èÁÉ½‘ÕÑEÕ…¹Ñ¥Ñ¥•Ì¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹ÁÉ½‘ÕÑ9…µ”¤¹©½¥¸ œì€œ¤°(€€€€€‰‘¹EÕ…¹Ñ¥ÑäèÁÉ½‘ÕÑEÕ…¹Ñ¥Ñ¥•Ì¹±•¹Ñ €ôôô€Ä€üÁÉ½‘ÕÑEÕ…¹Ñ¥Ñ¥•ÍlÁt¹ÅÕ…¹Ñ¥Ñä€è¹Õ±°°(€€€€€ÅÕ…¹Ñ¥ÑåU¹¥ÐèÁÉ½‘ÕÑEÕ…¹Ñ¥Ñ¥•Ì¹±•¹Ñ €ôôô€Ä€üÁÉ½‘ÕÑEÕ…¹Ñ¥Ñ¥•ÍlÁt¹ÅÕ…¹Ñ¥ÑåU¹¥Ð€è€5¥á•œ°(€€€€€ÁÉ½‘ÕÑEÕ…¹Ñ¥Ñ¥•Ì°(€€€€€ÁÉ½‘ÕÑEÕ…¹Ñ¥Ñå1…‰•°èÁÉ½‘ÕÑEÕ…¹Ñ¥Ñ¥•Ì¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹±…‰•°¤¹©½¥¸ œì€œ¤°(€€€€€½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥”èÕ¹¥ÑAÉ¥•Ì¹±•¹Ñ €ôôô€Ä€üÕ¹¥ÑAÉ¥•ÍlÁt€è¹Õ±°°(€€€€€½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥•1¥¹•Ì°(€€€€€½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥•1…‰•°è½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥•1¥¹•Ì¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹±…‰•°¤¹©½¥¸ œì€œ¤°(€€€€€Á…åµ•¹Ñ…Ñ”èÁ…åµ•¹Ñ…Ñ•Ì¹±•¹Ñ €ðô€Ä€üÁ…åµ•¹Ñ…Ñ•ÍlÁtñð¹Õ±°€è€5¥á•œ°(€€€€€Á…åµ•¹Ñ…Ñ•M½ÉÐè±…Ñ•ÍÑ%Í½…Ñ”¡Á…åµ•¹Ñ…Ñ•Ì¤°(€€€€€Á…åµ•¹Ñ…Ñ•1…‰•°èÍ¥¹±•=É5¥á•¡É½ÕÀ¹}Á…åµ•¹Ñ…Ñ•1…‰•±Ì¤ñðÉ½ÕÀ¹Á…åµ•¹Ñ…Ñ•1…‰•°°(€€€€€Á…åµ•¹Ñ•±…äèÁ…åµ•¹Ñ•±…åÌ¹±•¹Ñ €ôôô€Ä€üÁ…åµ•¹Ñ•±…åÍlÁt€è¹Õ±°°(€€€€€Á…åµ•¹Ñ•±…å1…‰•°èÁ…åµ•¹Ñ•±…åÌ¹±•¹Ñ €ø€Ä€ü€5¥á•œ€è¹Õ±°°(€€€€€}ÁÉ½‘ÕÑ5…ÀèÕ¹‘•™¥¹•°(€€€€€}½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥•ÌèÕ¹‘•™¥¹•°(€€€€€}½µµ¥ÍÍ¥½¹U¹¥Ñ1¥¹•ÌèÕ¹‘•™¥¹•°(€€€€€}Á…åµ•¹Ñ…Ñ•ÌèÕ¹‘•™¥¹•°(€€€€€}Á…åµ•¹Ñ…Ñ•1…‰•±ÌèÕ¹‘•™¥¹•°(€€€€€}Á…åµ•¹Ñ•±…åÌèÕ¹‘•™¥¹•°(€€€ôì(€ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í…±•Í™½É•	É½­•ÉI•¥ÍÑ•ÉU¹…¡•¡‰½‘ä°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ±¥µ¥Ð€ô5…Ñ ¹µ¥¸¡9Õµ‰•È¡‰½‘ä¹±¥µ¥Ð¤ñð€ÈÀÀÀ°€ÌÀÀÀ¤ì(€½¹ÍÐm±¥¹•%Ñ•µ•ÍÉ¥‰”°ÁÉ½‘ÕÑ•ÍÉ¥‰•t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€Í…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€MQ5}1¥¹•}%Ñ•µ}}Œœô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤°(€€€Í…±•Í™½É•=‰©•Ñ¥•±‘Ì¡ì½‰©•Ñ9…µ”è€AÉ½‘ÕÐÈœô¤¹…Ñ   ¤€ôø€¡ì™¥•±‘Ìèmtô¤¤°(€t¤ì(€½¹ÍÐ±¥¹•%Ñ•µU½µ¥•±€ô™¥¹‘…Í¡‰½…É‘U½µ¥•±¡±¥¹•%Ñ•µ•ÍÉ¥‰”¹™¥•±‘Ìñðmt°€±¥¹•%Ñ•´œ¤ì(€½¹ÍÐÁÉ½‘ÕÑU½µ¥•±€ô™¥¹‘…Í¡‰½…É‘U½µ¥•±¡ÁÉ½‘ÕÑ•ÍÉ¥‰”¹™¥•±‘Ìñðmt°€ÁÉ½‘ÕÐœ¤ì(€½¹ÍÐ¹…Ñ¥Ù•U½µM•±•Ð€ôl(€€€±¥¹•%Ñ•µU½µ¥•±°(€€€ÁÉ½‘ÕÑU½µ¥•±€üAÉ½‘ÕÑ}}È¸‘íÁÉ½‘ÕÑU½µ¥•±‘õ€€è¹Õ±°°(€t¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐ¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¸€ô…Ý…¥Ð¥¹Ñ•É½™™¥•MÑ•µ•ÍÍ½¹‘¥Ñ¥½¸¡…•ÍÍ½¹Ñ•áÐ¤ì(€½¹ÍÐÝ¡•É•±…ÕÍ”€ô¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¸€ü]!I€‘í¥¹Ñ•É½™™¥•½¹‘¥Ñ¥½¹õ€€è€œœì(€½¹ÍÐÍÑ•µÌ€ô…Ý…¥ÐÅÕ•ÉåI½ÝÌ (€€€€(€€€M1P%°9…µ”°•±¥Ù•Éå}…Ñ•}}Œ°A…åµ•¹Ñ}…Ñ•}}Œ°	Õå•É}A…å}Q•Éµ}…Ñ•}}Œ(€€€I=4ÍÑ•µ}}Œ(€€€€‘íÝ¡•É•±…ÕÍ•ô(€€€=IH	d•±¥Ù•Éå}…Ñ•}}ŒM9U11L1MP(€€€1%5%P€‘í±¥µ¥Ñô(€€°(€€€ì±¥µ¥Ðô°(€€¤ì(€½¹ÍÐÍÑ•µ5…À€ô=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡ÍÑ•µÌ¹µ…À ¡ÍÑ•´¤€ôømÍÑ•´¹%°ÍÑ•µt¤¤ì(€½¹ÍÐÍÑ•µ%‘Ì€ôÍÑ•µÌ¹µ…À ¡ÍÑ•´¤€ôøÍÑ•´¹%¤ì(€¥˜€ …ÍÑ•µ%‘Ì¹±•¹Ñ ¤É•ÑÕÉ¸ìÉ½ÝÌèmtôì((€½¹ÍÐÍÑ•µ¡Õ¹­Ì€ô¡Õ¹­%‘Ì¡ÍÑ•µ%‘Ì¤ì(€½¹ÍÐm±¥¹•%Ñ•µ¡Õ¹­Ì°‰Õå•É	É½­•É¡Õ¹­Ì°‰Õå•ÉA…åµ•¹Ñ¡Õ¹­Ì°‰Õå•É%¹Ù½¥•¡Õ¹­Ít€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€ÍÑ•µ¡Õ¹­Ì¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥‘Ì€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í¥‘ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Í½Å°è€(€€€€€€€M1P€‘íl%œ°€9…µ”œ°€MQ5}}Œœ°€AÉ½‘ÕÑ}}È¹9…µ”œ°€AÉ½‘ÕÑ}}È¹…µ¥±äœ°€MÕÁÁ±¥•É}%¹Ù½¥•}}Œœ°(€€€€€€€€€€¸¸¹¹…Ñ¥Ù•U½µM•±•Ð°(€€€€€€€t¹©½¥¸ œ°€œ¥ô°(€€€€€€€€€€€€€€MÕÁÁ±¥•É}	É½­•É}}Œ°MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°(€€€€€€€€€€€€€€EÕ…¹Ñ¥Ñå}•±¥Ù•É•‘}A•É}	9}}Œ°EÕ…¹Ñ¥Ñå}}Œ°EÕ…¹Ñ¥Ñå}¥¹}5Q}}Œ°½µµ¥ÍÍ¥½¹}½ÍÑ}}Œ°…¹•±±•‘}}Œ°(€€€€€€€€€€€€€€	Õå•ÉÍ}	É½­•É}}Œ°	Õå•É}	É½­•É}}Œ°	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°(€€€€€€€€€€€€€€	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}1ÕµÁÍÕµ}}Œ(€€€€€€€I=4MQ5}1¥¹•}%Ñ•µ}}Œ(€€€€€€€]!IMQ5}}Œ%8€ ‘í¥‘Íô¤(€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€°(€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€ôì(€€€€€ô¤°(€€€€¤°(€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€ÍÑ•µ¡Õ¹­Ì¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥‘Ì€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í¥‘ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Í½Å°è€(€€€€€€€M1P%°9…µ”°MQ5}}Œ°	Õå•É}	É½­•É}}Œ(€€€€€€€I=4MQ5}	Õå•É}	É½­•É}}Œ(€€€€€€€]!IMQ5}}Œ%8€ ‘í¥‘Íô¤(€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€°(€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€ôì(€€€€€ô¤°(€€€€¤°(€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€ÍÑ•µ¡Õ¹­Ì¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥‘Ì€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í¥‘ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Í½Å°è€(€€€€€€€M1PMQ5}}Œ°…Ñ•}}Œ(€€€€€€€I=4A…åµ•¹Ñ}}Œ(€€€€€€€]!IMQ5}}Œ%8€ ‘í¥‘Íô¤9MÕÁÁ±¥•É}%¹Ù½¥•}}Œ€ô¹Õ±°(€€€€€€€=IH	d…Ñ•}}ŒM(€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€°(€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€ôì(€€€€€ô¤°(€€€€¤°(€€€½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€€€ÍÑ•µ¡Õ¹­Ì¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€€€½¹ÍÐ¥‘Ì€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í¥‘ô€¤¹©½¥¸ œ°œ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Í½Å°è€(€€€€€€€M1PMQ5}}Œ°%¹Ù½¥•}Õ•}…Ñ•}}Œ(€€€€€€€I=4%¹Ù½¥•}}Œ(€€€€€€€]!IMQ5}}Œ%8€ ‘í¥‘Íô¤(€€€€€€€=IH	d%¹Ù½¥•}Õ•}…Ñ•}}ŒM(€€€€€€€1%5%P€ÔÀÀÀ(€€€€€€°(€€€€€€€€€±¥µ¥Ðè€ÔÀÀÀ°(€€€€€€€ôì(€€€€€ô¤°(€€€€¤°(€t¤ì((€½¹ÍÐ±¥¹•%Ñ•µÌ€ô±¥¹•%Ñ•µ¡Õ¹­Ì¹™±…Ð ¤ì(€½¹ÍÐ‰Õå•É	É½­•ÉÌ€ô‰Õå•É	É½­•É¡Õ¹­Ì¹™±…Ð ¤ì(€½¹ÍÐ‰Õå•ÉA…åµ•¹ÑÌ€ô‰Õå•ÉA…åµ•¹Ñ¡Õ¹­Ì¹™±…Ð ¤ì(€½¹ÍÐ‰Õå•É%¹Ù½¥•Ì€ô‰Õå•É%¹Ù½¥•¡Õ¹­Ì¹™±…Ð ¤ì(€½¹ÍÐ…½Õ¹Ñ%‘Ì€ôl¸¸¹¹•ÜM•Ð¡l¸¸¹±¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤°€¸¸¹±¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹	Õå•ÉÍ}	É½­•É}}Œñð¥Ñ•´¹	Õå•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤°€¸¸¹‰Õå•É	É½­•ÉÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹	Õå•É}	É½­•É}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¥t¥tì((€½¹ÍÐ…½Õ¹Ñ¡Õ¹­Ì€ô…Ý…¥Ð½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€¡Õ¹­%‘Ì¡…½Õ¹Ñ%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€½¹ÍÐ¥‘Ì€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í¥‘ô€¤¹©½¥¸ œ°œ¤ì(€€€€€É•ÑÕÉ¸¥‘Ì(€€€€€€€€üì(€€€€€€€€€€€Í½Å°èM1P%°9…µ”°!¥‘‘•¹}	É½­•É}}Œ°!¥‘‘•¹}	É½­•É}½µÁ…¹å}}ŒI=4½Õ¹Ð]!I%%8€ ‘í¥‘Íô¤9%¹…Ñ¥Ù•}MÕÍÁ•¹‘•‘}}Œ€ô™…±Í•€°(€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€ô(€€€€€€€€è¹Õ±°ì(€€€ô¤°(€€¤ì(€½¹ÍÐ…½Õ¹Ñ5…À€ôíôì(€½¹ÍÐ…½Õ¹Ñ±…5…À€ôíôì(€™½È€¡½¹ÍÐ…½Õ¹Ð½˜…½Õ¹Ñ¡Õ¹­Ì¹™±…Ð ¤¤ì(€€€½¹ÍÐ™±…Ì€ôì(€€€€€¡¥‘‘•¹	É½­•É%¹‘¥Ù¥‘Õ…°è…½Õ¹Ð¹!¥‘‘•¹}	É½­•É}}Œ€ôôôÑÉÕ”°(€€€€€¡¥‘‘•¹	É½­•É½µÁ…¹äè…½Õ¹Ð¹!¥‘‘•¹}	É½­•É}½µÁ…¹å}}Œ€ôôôÑÉÕ”°(€€€ôì(€€€…½Õ¹Ñ5…Ám…½Õ¹Ð¹%‘t€ô…½Õ¹Ð¹9…µ”ì(€€€…½Õ¹Ñ5…ÁmMÑÉ¥¹œ¡…½Õ¹Ð¹%¤¹Í±¥” À°€ÄÔ¥t€ô…½Õ¹Ð¹9…µ”ì(€€€…½Õ¹Ñ±…5…Ám…½Õ¹Ð¹%‘t€ô™±…Ìì(€€€…½Õ¹Ñ±…5…ÁmMÑÉ¥¹œ¡…½Õ¹Ð¹%¤¹Í±¥” À°€ÄÔ¥t€ô™±…Ìì(€ô((€½¹ÍÐÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì€ôl¸¸¹¹•ÜM•Ð¡±¥¹•%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ¤¹™¥±Ñ•È¡	½½±•…¸¤¥tì(€½¹ÍÐÁ…åµ•¹Ñ…Ñ•	å%¹Ù½¥”€ôíôì(€½¹ÍÐÁ…åµ•¹Ñ¡Õ¹­Ì€ô…Ý…¥Ð½µÁ½Í¥Ñ•EÕ•ÉåI½ÝÌ (€€€¡Õ¹­%‘Ì¡ÍÕÁÁ±¥•É%¹Ù½¥•%‘Ì¤¹µ…À ¡¡Õ¹¬¤€ôøì(€€€€€½¹ÍÐ¥‘Ì€ô¡Õ¹¬¹µ…À ¡¥¤€ôø€œ‘í¥‘ô€¤¹©½¥¸ œ°œ¤ì(€€€€€É•ÑÕÉ¸¥‘Ì(€€€€€€€€üì(€€€€€€€€€€€Í½Å°èM1PMÕÁÁ±¥•É}%¹Ù½¥•}}Œ°…Ñ•}}ŒI=4A…åµ•¹Ñ}}Œ]!IMÕÁÁ±¥•É}%¹Ù½¥•}}Œ%8€ ‘í¥‘Íô¤=IH	d…Ñ•}}ŒM€°(€€€€€€€€€€€Í½™Ñ…¥°èÑÉÕ”°(€€€€€€€€€ô(€€€€€€€€è¹Õ±°ì(€€€ô¤°(€€¤ì(€™½È€¡½¹ÍÐÁ…åµ•¹Ð½˜Á…åµ•¹Ñ¡Õ¹­Ì¹™±…Ð ¤¤ì(€€€¥˜€¡Á…åµ•¹Ð¹MÕÁÁ±¥•É}%¹Ù½¥•}}Œ€˜˜€…Á…åµ•¹Ñ…Ñ•	å%¹Ù½¥•mÁ…åµ•¹Ð¹MÕÁÁ±¥•É}%¹Ù½¥•}}t¤Á…åµ•¹Ñ…Ñ•	å%¹Ù½¥•mÁ…åµ•¹Ð¹MÕÁÁ±¥•É}%¹Ù½¥•}}t€ôÁ…åµ•¹Ð¹…Ñ•}}Œì(€ô((€½¹ÍÐ‰Õå•ÉA…åµ•¹Ñ…Ñ•	åMÑ•´€ôíôì(€™½È€¡½¹ÍÐÁ…åµ•¹Ð½˜‰Õå•ÉA…åµ•¹ÑÌ¤ì(€€€¥˜€¡Á…åµ•¹Ð¹MQ5}}Œ€˜˜€…‰Õå•ÉA…åµ•¹Ñ…Ñ•	åMÑ•µmÁ…åµ•¹Ð¹MQ5}}t¤‰Õå•ÉA…åµ•¹Ñ…Ñ•	åMÑ•µmÁ…åµ•¹Ð¹MQ5}}t€ôÁ…åµ•¹Ð¹…Ñ•}}Œì(€ô(€½¹ÍÐ‰Õå•É%¹Ù½¥•Õ•…Ñ•	åMÑ•´€ôíôì(€™½È€¡½¹ÍÐ¥¹Ù½¥”½˜‰Õå•É%¹Ù½¥•Ì¤ì(€€€¥˜€¡¥¹Ù½¥”¹MQ5}}Œ€˜˜€…‰Õå•É%¹Ù½¥•Õ•…Ñ•	åMÑ•µm¥¹Ù½¥”¹MQ5}}t¤‰Õå•É%¹Ù½¥•Õ•…Ñ•	åMÑ•µm¥¹Ù½¥”¹MQ5}}t€ô¥¹Ù½¥”¹%¹Ù½¥•}Õ•}…Ñ•}}Œì(€ô((€½¹ÍÐ‰Õå•É	É½­•ÉÍ	åMÑ•´€ôíôì(€™½È€¡½¹ÍÐ¥Ñ•´½˜‰Õå•É	É½­•ÉÌ¤ì(€€€¥˜€ …¥Ñ•´¹MQ5}}Œ¤½¹Ñ¥¹Õ”ì(€€€¥˜€ …‰Õå•É	É½­•ÉÍ	åMÑ•µm¥Ñ•´¹MQ5}}t¤‰Õå•É	É½­•ÉÍ	åMÑ•µm¥Ñ•´¹MQ5}}t€ômtì(€€€‰Õå•É	É½­•ÉÍ	åMÑ•µm¥Ñ•´¹MQ5}}t¹ÁÕÍ ¡¥Ñ•´¤ì(€ô((€½¹ÍÐÉ…ÝI½ÝÌ€ômtì(€½¹ÍÐ™¥¹…¹¥…±]…É¹¥¹Ì€ô¹•ÜM•Ð ¤ì(€™½È€¡½¹ÍÐ¥Ñ•´½˜±¥¹•%Ñ•µÌ¤ì(€€€½¹ÍÐÍÑ•´€ôÍÑ•µ5…Ám¥Ñ•´¹MQ5}}tì(€€€¥˜€ …ÍÑ•´¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐ¹…Ñ¥Ù•EÕ…¹Ñ¥Ñä€ô¹…Ñ¥Ù•¥¹…¹¥…±EÕ…¹Ñ¥Ñä¡¥Ñ•´°ì(€€€€€ÍÑ•µ!…Í•±¥Ù•Éäè€„…ÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œ°(€€€€€±¥¹•%Ñ•µU½µ¥•±°(€€€€€ÁÉ½‘ÕÑU½µ¥•±°(€€€ô¤ì(€€€½¹ÍÐÅÑä€ô¹…Ñ¥Ù•EÕ…¹Ñ¥Ñä¹ÅÕ…¹Ñ¥Ñäì(€€€½¹ÍÐÅÕ…¹Ñ¥ÑåU¹¥Ð€ô¹…Ñ¥Ù•EÕ…¹Ñ¥Ñä¹Õ¹¥Ñ=™5•…ÍÕÉ”ñð€U=4¹½ÐÍ•Ðœì(€€€¥˜€¡¹…Ñ¥Ù•EÕ…¹Ñ¥Ñä¹Ý…É¹¥¹œ¤™¥¹…¹¥…±]…É¹¥¹Ì¹…‘¡€‘íÍÑ•´¹9…µ”ñð€MQ4ôƒ
Ü€‘í¥Ñ•´¹9…µ”ñð¥Ñ•´¹%‘ôè€‘í¹…Ñ¥Ù•EÕ…¹Ñ¥Ñä¹Ý…É¹¥¹õ€¤ì(€€€½¹ÍÐÍÕÁÁ±¥•Éµ½Õ¹Ð€ô¥Ñ•´¹…¹•±±•‘}}Œ€ü€À€è‰É½­•Éµ½Õ¹Ð¡¥Ñ•´¹MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°ÅÑä¤ì(€€€¥˜€¡¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ€˜˜ÍÕÁÁ±¥•Éµ½Õ¹Ð€„ôô€À¤ì(€€€€€É…ÝI½ÝÌ¹ÁÕÍ ¡ì(€€€€€€€¥èÍÕÁÁ±¥•È´‘í¥Ñ•´¹%‘õ€°(€€€€€€€ÍÑ•µ%è¥Ñ•´¹MQ5}}Œ°(€€€€€€€ÍÑ•µ9…µ”èÍÑ•´¹9…µ”°(€€€€€€€‰É½­•É%è¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ°(€€€€€€€ÁÉ½‘ÕÑ9…µ”è¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹9…µ”ñð¥Ñ•´¹9…µ”ñð€ŸŠPœ°(€€€€€€€ÁÉ½‘ÕÑ…µ¥±äè¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹…µ¥±äñð¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹9…µ”ñð¥Ñ•´¹9…µ”ñð€ŸŠPœ°(€€€€€€€‰‘¹EÕ…¹Ñ¥ÑäèÅÑäñð¹Õ±°°(€€€€€€€ÅÕ…¹Ñ¥ÑåU¹¥Ð°(€€€€€€€‘•±¥Ù•Éå…Ñ”èÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œ°(€€€€€€€‰É½­•ÉQåÁ”è€MÕÁÁ±¥•È	É½­•Èœ°(€€€€€€€‰É½­•É9…µ”è…½Õ¹Ñ5…Ám¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}tñð¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}Œ°(€€€€€€€¡¥‘‘•¹	É½­•É%¹‘¥Ù¥‘Õ…°è…½Õ¹Ñ±…5…Ám¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}tü¹¡¥‘‘•¹	É½­•É%¹‘¥Ù¥‘Õ…°ñð™…±Í”°(€€€€€€€¡¥‘‘•¹	É½­•É½µÁ…¹äè…½Õ¹Ñ±…5…Ám¥Ñ•´¹MÕÁÁ±¥•É}	É½­•É}}tü¹¡¥‘‘•¹	É½­•É½µÁ…¹äñð™…±Í”°(€€€€€€€½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥”è¥Ñ•´¹MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ€üü¹Õ±°°(€€€€€€€½µµ¥ÍÍ¥½¹µ½Õ¹ÐèÍÕÁÁ±¥•Éµ½Õ¹Ð°(€€€€€€€Á…åµ•¹Ñ…Ñ”èÁ…åµ•¹Ñ…Ñ•	å%¹Ù½¥•m¥Ñ•´¹MÕÁÁ±¥•É}%¹Ù½¥•}}tñð¹Õ±°°(€€€€€€€Á…åµ•¹Ñ…Ñ•1…‰•°è€A…¥…Ñ”œ°(€€€€€ô¤ì(€€€ô((€€€½¹ÍÐ‰Õå•É	É½­•É%€ô¥Ñ•´¹	Õå•ÉÍ}	É½­•É}}Œñð¥Ñ•´¹	Õå•É}	É½­•É}}Œì(€€€½¹ÍÐ¡…ÍMÕÁÁ±¥•É	É½­•ÉU¹¥Ð€ô9Õµ‰•È¡¥Ñ•´¹MÕÁÁ±¥•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œñð€À¤€„ôô€Àì(€€€½¹ÍÐ‰Õå•ÉA•ÉU¹¥Ñµ½Õ¹Ð€ô‰É½­•Éµ½Õ¹Ð¡¥Ñ•´¹	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ°ÅÑä¤ì(€€€½¹ÍÐ‰Õå•É1ÕµÁÍÕµµ½Õ¹Ð€ô9Õµ‰•È¡¥Ñ•´¹	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}1ÕµÁÍÕµ}}Œñð€À¤ì(€€€½¹ÍÐ‰Õå•Éµ½Õ¹Ð€ô‰Õå•É1ÕµÁÍÕµµ½Õ¹Ðñð‰Õå•ÉA•ÉU¹¥Ñµ½Õ¹Ðì(€€€¥˜€¡‰Õå•É	É½­•É%€˜˜‰Õå•Éµ½Õ¹Ð€„ôô€À¤ì(€€€€€É…ÝI½ÝÌ¹ÁÕÍ ¡ì(€€€€€€€¥è‰Õå•È´‘í¥Ñ•´¹%‘õ€°(€€€€€€€ÍÑ•µ%è¥Ñ•´¹MQ5}}Œ°(€€€€€€€ÍÑ•µ9…µ”èÍÑ•´¹9…µ”°(€€€€€€€‰É½­•É%è‰Õå•É	É½­•É%°(€€€€€€€ÁÉ½‘ÕÑ9…µ”è¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹9…µ”ñð¥Ñ•´¹9…µ”ñð€ŸŠPœ°(€€€€€€€ÁÉ½‘ÕÑ…µ¥±äè¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹…µ¥±äñð¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹9…µ”ñð¥Ñ•´¹9…µ”ñð€ŸŠPœ°(€€€€€€€‰‘¹EÕ…¹Ñ¥ÑäèÅÑäñð¹Õ±°°(€€€€€€€ÅÕ…¹Ñ¥ÑåU¹¥Ð°(€€€€€€€‘•±¥Ù•Éå…Ñ”èÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œ°(€€€€€€€‰É½­•ÉQåÁ”è€	Õå•È	É½­•Èœ°(€€€€€€€‰É½­•É9…µ”è…½Õ¹Ñ5…Ám‰Õå•É	É½­•É%‘tñð‰Õå•É	É½­•É%°(€€€€€€€¡¥‘‘•¹	É½­•É%¹‘¥Ù¥‘Õ…°è…½Õ¹Ñ±…5…Ám‰Õå•É	É½­•É%‘tü¹¡¥‘‘•¹	É½­•É%¹‘¥Ù¥‘Õ…°ñð™…±Í”°(€€€€€€€¡¥‘‘•¹	É½­•É½µÁ…¹äè…½Õ¹Ñ±…5…Ám‰Õå•É	É½­•É%‘tü¹¡¥‘‘•¹	É½­•É½µÁ…¹äñð™…±Í”°(€€€€€€€½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥”è¥Ñ•´¹	Õå•ÉÍ}	É½­•ÉÍ}½µµ¥ÍÍ¥½¹}A•É}U¹¥Ñ}}Œ€üü€¡ÅÑä€ü‰Õå•Éµ½Õ¹Ð€¼ÅÑä€è¹Õ±°¤°(€€€€€€€½µµ¥ÍÍ¥½¹µ½Õ¹Ðè‰Õå•Éµ½Õ¹Ð°(€€€€€€€Á…åµ•¹Ñ…Ñ”èÍÑ•´¹A…åµ•¹Ñ}…Ñ•}}Œñð‰Õå•ÉA…åµ•¹Ñ…Ñ•	åMÑ•µm¥Ñ•´¹MQ5}}tñð¹Õ±°°(€€€€€€€Á…åµ•¹Ñ…Ñ•1…‰•°è€I••¥Ù•…Ñ”œ°(€€€€€€€Á…åµ•¹Ñ•±…äèÁ…åµ•¹Ñ•±…å…åÌ¡ÍÑ•´¹A…åµ•¹Ñ}…Ñ•}}Œñð‰Õå•ÉA…åµ•¹Ñ…Ñ•	åMÑ•µm¥Ñ•´¹MQ5}}t°‰Õå•É%¹Ù½¥•Õ•…Ñ•	åMÑ•µm¥Ñ•´¹MQ5}}tñðÍÑ•´¹	Õå•É}A…å}Q•Éµ}…Ñ•}}Œ¤°(€€€€€ô¤ì(€€€ô((€€€½¹ÍÐÍ•½¹‘…Éåµ½Õ¹Ð€ô€…¡…ÍMÕÁÁ±¥•É	É½­•ÉU¹¥Ð€˜˜¥Ñ•´¹½µµ¥ÍÍ¥½¹}½ÍÑ}}Œ€„ô¹Õ±°€ü9Õµ‰•È¡¥Ñ•´¹½µµ¥ÍÍ¥½¹}½ÍÑ}}Œñð€À¤€´‰Õå•ÉA•ÉU¹¥Ñµ½Õ¹Ð€è€Àì(€€€½¹ÍÐÍ•½¹‘…Éå	É½­•ÉÌ€ô€¡‰Õå•É	É½­•ÉÍ	åMÑ•µm¥Ñ•´¹MQ5}}tñðmt¤¹™¥±Ñ•È ¡‰É½­•È¤€ôøì(€€€€€¥˜€ …‰É½­•È¹	Õå•É}	É½­•É}}Œ¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€¥˜€ …‰Õå•É	É½­•É%¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€É•ÑÕÉ¸MÑÉ¥¹œ¡‰É½­•È¹	Õå•É}	É½­•É}}Œ¤¹Í±¥” À°€ÄÔ¤€„ôôMÑÉ¥¹œ¡‰Õå•É	É½­•É%¤¹Í±¥” À°€ÄÔ¤ì(€€€ô¤ì(€€€¥˜€¡Í•½¹‘…Éåµ½Õ¹Ð€ø€À€˜˜Í•½¹‘…Éå	É½­•ÉÌ¹±•¹Ñ €ø€À¤ì(€€€€€™½È€¡½¹ÍÐ‰É½­•È½˜Í•½¹‘…Éå	É½­•ÉÌ¤ì(€€€€€€€É…ÝI½ÝÌ¹ÁÕÍ ¡ì(€€€€€€€€€¥èÍ•½¹‘…Éä´‘í¥Ñ•´¹%‘ô´‘í‰É½­•È¹%‘õ€°(€€€€€€€€€ÍÑ•µ%è¥Ñ•´¹MQ5}}Œ°(€€€€€€€€€ÍÑ•µ9…µ”èÍÑ•´¹9…µ”°(€€€€€€€€€‰É½­•É%è‰É½­•È¹	Õå•É}	É½­•É}}Œñð¹Õ±°°(€€€€€€€€€ÁÉ½‘ÕÑ9…µ”è¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹9…µ”ñð¥Ñ•´¹9…µ”ñð€ŸŠPœ°(€€€€€€€€€ÁÉ½‘ÕÑ…µ¥±äè¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹…µ¥±äñð¥Ñ•µlAÉ½‘ÕÑ}}Ètü¹9…µ”ñð¥Ñ•´¹9…µ”ñð€ŸŠPœ°(€€€€€€€€€‰‘¹EÕ…¹Ñ¥ÑäèÅÑäñð¹Õ±°°(€€€€€€€€€ÅÕ…¹Ñ¥ÑåU¹¥Ð°(€€€€€€€€€‘•±¥Ù•Éå…Ñ”èÍÑ•´¹•±¥Ù•Éå}…Ñ•}}Œ°(€€€€€€€€€‰É½­•ÉQåÁ”è€M•½¹‘…Éä	Õå•È	É½­•Èœ°(€€€€€€€€€‰É½­•É9…µ”è…½Õ¹Ñ5…Ám‰É½­•È¹	Õå•É}	É½­•É}}tñð‰É½­•È¹	Õå•É}	É½­•É}}Œñð€M•½¹‘…Éä	Õå•È	É½­•Èœ°(€€€€€€€€€¡¥‘‘•¹	É½­•É%¹‘¥Ù¥‘Õ…°è…½Õ¹Ñ±…5…Ám‰É½­•È¹	Õå•É}	É½­•É}}tü¹¡¥‘‘•¹	É½­•É%¹‘¥Ù¥‘Õ…°ñð™…±Í”°(€€€€€€€€€¡¥‘‘•¹	É½­•É½µÁ…¹äè…½Õ¹Ñ±…5…Ám‰É½­•È¹	Õå•É}	É½­•É}}tü¹¡¥‘‘•¹	É½­•É½µÁ…¹äñð™…±Í”°(€€€€€€€€€½µµ¥ÍÍ¥½¹U¹¥ÑAÉ¥”èÅÑä€üÍ•½¹‘…Éåµ½Õ¹Ð€¼ÅÑä€è¹Õ±°°(€€€€€€€€€½µµ¥ÍÍ¥½¹µ½Õ¹ÐèÍ•½¹‘…Éåµ½Õ¹Ð°(€€€€€€€€€Á…åµ•¹Ñ…Ñ”èÍÑ•´¹A…åµ•¹Ñ}…Ñ•}}Œñð‰Õå•ÉA…åµ•¹Ñ…Ñ•	åMÑ•µm¥Ñ•´¹MQ5}}tñð¹Õ±°°(€€€€€€€€€Á…åµ•¹Ñ…Ñ•1…‰•°è€I••¥Ù•…Ñ”œ°(€€€€€€€€€Á…åµ•¹Ñ•±…äèÁ…åµ•¹Ñ•±…å…åÌ¡ÍÑ•´¹A…åµ•¹Ñ}…Ñ•}}Œñð‰Õå•ÉA…åµ•¹Ñ…Ñ•	åMÑ•µm¥Ñ•´¹MQ5}}t°‰Õå•É%¹Ù½¥•Õ•…Ñ•	åMÑ•µm¥Ñ•´¹MQ5}}tñðÍÑ•´¹	Õå•É}A…å}Q•Éµ}…Ñ•}}Œ¤°(€€€€€€€ô¤ì(€€€€€ô(€€€ô(€ô((€½¹ÍÐÉ½ÝÌ€ô½µ‰¥¹•	É½­•É½µµ¥ÍÍ¥½¹I½ÝÌ¡É…ÝI½ÝÌ¤ì(€É½ÝÌ¹Í½ÉÐ ¡„°ˆ¤€ôøMÑÉ¥¹œ¡ˆ¹‘•±¥Ù•Éå…Ñ”ñð€œœ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡„¹‘•±¥Ù•Éå…Ñ”ñð€œœ¤¤¤ì(€É•ÑÕÉ¸ìÉ½ÝÌ°Ý…É¹¥¹Ìèl¸¸¹™¥¹…¹¥…±]…É¹¥¹Ítôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í…±•Í™½É•	É½­•ÉI•¥ÍÑ•ÉÕ±°¡‰½‘ä°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ±¥µ¥Ð€ô5…Ñ ¹µ¥¸¡9Õµ‰•È¡‰½‘ä¹±¥µ¥Ð¤ñð€ÈÀÀÀ°€ÌÀÀÀ¤ì(€½¹ÍÐ…¡•€ô…Ý…¥Ð…¡•‘M…±•Í™½É•Y…±Õ”¡ì(€€€¹…µ•ÍÁ…”è€Í…±•Í™½É”µ‰É½­•ÈµÉ•¥ÍÑ•Èœ°(€€€ÑÑ±M•½¹‘Ìè€ØÀ°(€€€Á…å±½…èì±¥µ¥Ðô°(€€€Ñ…ÌèlÍ…±•Í™½É”é‰É½­•ÈµÉ•¥ÍÑ•Èœ°€Í…±•Í™½É”éÍÑ•´œ°€Í…±•Í™½É”é…½Õ¹Ðt°(€€€‰½‘ä°(€€€É•Ä°(€€€…•ÍÍ½¹Ñ•áÐ°(€€€±½…‘•Èè€ ¤€ôøÍ…±•Í™½É•	É½­•ÉI•¥ÍÑ•ÉU¹…¡•¡ì±¥µ¥Ðô°É•Ä°…•ÍÍ½¹Ñ•áÐ¤°(€ô¤ì(€É•ÑÕÉ¸…¡•¹Ù…±Õ”ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘•…Á…‰¥±¥Ñ¥•Ì¡½¹Ñ•áÐ¤ì(€½¹ÍÐ•¹ÑÉ¥•Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€¡•‘•}‰½½­}µ…¹…”œ°(€€€€¡•‘•}Í•ÑÑ±•µ•¹Ñ}µ…¹…”œ°(€€€€¡•‘•}±½Í•}…ÁÁÉ½Ù”œ°(€€€€¡•‘•}…‘µ¥¸œ°(€t¹µ…À¡…Íå¹Œ€¡…Á…‰¥±¥Ñä¤€ôøm…Á…‰¥±¥Ñä°…Ý…¥ÐÕÍ•É!…Í…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°…Á…‰¥±¥Ñä¥t¤¤ì(€É•ÑÕÉ¸=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡•¹ÑÉ¥•Ì¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­¹Ñ¥Ñä¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸ì(€€€‘…Ñ„è…Ý…¥Ð¡…¹‘±•!•‘••Í­¹Ñ¥Ñä¡‰½‘ä°½¹Ñ•áÐ¹ÁÉ½™¥±”°ì(€€€€€±¥•¹Ðè½¹Ñ•áÐ¹±¥•¹Ð°(€€€€€…Á…‰¥±¥Ñ¥•Ìè…Ý…¥Ð¡•‘•…Á…‰¥±¥Ñ¥•Ì¡½¹Ñ•áÐ¤°(€€€ô¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘•5…É­•ÑÌ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€¥˜€¡‰½‘ä¹…Ñ¥½¸€ôôô€¥¹Ñ•±±¥•¹•}‰É¥•˜œ¤É•ÑÕÉ¸ì‘…Ñ„è…Ý…¥Ð±½…‘5…É­•Ñ%¹Ñ•±±¥•¹•	É¥•˜¡½¹Ñ•áÐ¹±¥•¹Ð°‰½‘ä¤ôì(€¥˜€¡‰½‘ä¹…Ñ¥½¸€ôôô€¥¹Ñ•±±¥•¹•}ÕÉÙ”œ¤É•ÑÕÉ¸ì‘…Ñ„è…Ý…¥Ð±½…‘5…É­•Ñ%¹Ñ•±±¥•¹•ÕÉÙ”¡½¹Ñ•áÐ¹±¥•¹Ð°‰½‘ä¤ôì(€¥˜€¡‰½‘ä¹…Ñ¥½¸€ôôô€¥¹Ñ•±±¥•¹•}Ù…±Õ…Ñ¥½¸œ¤É•ÑÕÉ¸ì‘…Ñ„è…Ý…¥Ð±½…‘½Ù•É¹•‘5…É­•ÑY…±Õ…Ñ¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°‰½‘ä¤ôì(€¥˜€¡‰½‘ä¹…Ñ¥½¸€ôôô€™½ÉÝ…É‘}™…±±‰…­}Í…Ù”œ¤ì(€€€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€¡•‘•}‰½½­}µ…¹…”œ°€!•‘”‰½½¬µ…¹…•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•Ñ¼Í…Ù”„™½ÉÝ…É™…±±‰…¬¸œ¤ì(€€€É•ÑÕÉ¸ì‘…Ñ„è…Ý…¥ÐÍ…Ù•5…É­•Ñ½ÉÝ…É‘…±±‰…¬¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ôì(€ô(€¥˜€¡‰½‘ä¹…Ñ¥½¸€ôôô€¥¹Ñ•±±¥•¹•}…±•ÉÑ}ÉÕ±•Í}•Ðœ¤É•ÑÕÉ¸ì‘…Ñ„è…Ý…¥Ð•Ñ5…É­•Ñ%¹Ñ•±±¥•¹•±•ÉÑIÕ±•Ì¡½¹Ñ•áÐ¹±¥•¹Ð¤ôì(€¥˜€¡‰½‘ä¹…Ñ¥½¸€ôôô€¥¹Ñ•±±¥•¹•}…±•ÉÑ}ÉÕ±•Í}Í…Ù”œ¤ì(€€€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€¡•‘•}…‘µ¥¸œ°€!•‘”…‘µ¥¹¥ÍÑÉ…Ñ¥½¸Á•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•Ñ¼¡…¹”µ…É­•Ð…±•ÉÐÉÕ±•Ì¸œ¤ì(€€€É•ÑÕÉ¸ì‘…Ñ„è…Ý…¥ÐÍ…Ù•5…É­•Ñ%¹Ñ•±±¥•¹•±•ÉÑIÕ±•Ì¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ôì(€ô(€¥˜€¡‰½‘ä¹…Ñ¥½¸€ôôô€¥¹Ñ•±±¥•¹•}ÕÉÙ•}ÕÑ½Ù•É}Í…Ù”œ¤ì(€€€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€¡•‘•}…‘µ¥¸œ°€!•‘”…‘µ¥¹¥ÍÑÉ…Ñ¥½¸Á•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•Ñ¼…ÁÁÉ½Ù”„ÕÉÙ”ÕÑ½Ù•È¸œ¤ì(€€€É•ÑÕÉ¸ì‘…Ñ„è…Ý…¥ÐÍ…Ù•5…É­•ÑÕÉÙ•M¡…‘½ÝÕÑ½Ù•È¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ôì(€ô(€½¹ÍÐ‘…Ñ„€ô…Ý…¥Ð¡…¹‘±•!•‘•5…É­•ÑÌ¡‰½‘ä°½¹Ñ•áÐ¹ÁÉ½™¥±”°ì(€€€±¥•¹Ðè½¹Ñ•áÐ¹±¥•¹Ð°(€€€…Á…‰¥±¥Ñ¥•Ìè…Ý…¥Ð¡•‘•…Á…‰¥±¥Ñ¥•Ì¡½¹Ñ•áÐ¤°(€ô¤ì(€¥˜€¡lÉ•…Ñ”œ°€ÕÁ‘…Ñ”œ°€‘•±•Ñ”œ°€Í…Ù•}ÍÁÉ•…‘Ìœ°€Ù•É¥™å}µ½¹Ñ œ°€µ…É­•Ñ}É•Á½ÉÑ}¥µÁ½ÉÐt¹¥¹±Õ‘•Ì¡MÑÉ¥¹œ¡‰½‘ä¹…Ñ¥½¸ñð€œœ¤¤¤ì(€€€…Ý…¥Ð•áÁ¥É•IÕ¹Ñ¥µ•…¡•Q…Ì¡lµ…É­•ÑÌœ°€¡•‘”éµ…É­•ÑÌœ°€µ…É­•Ðé¥¹Ñ•±±¥•¹”œ°€µ…É­•ÐéÁÕ±Í”t¤ì(€ô(€É•ÑÕÉ¸ì‘…Ñ„ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•Ñ%¹Ñ•±±¥•¹•	É¥•˜¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸±½…‘5…É­•Ñ%¹Ñ•±±¥•¹•	É¥•˜¡½¹Ñ•áÐ¹±¥•¹Ð°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•ÑAÕ±Í•M¹…ÁÍ¡½Ð¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸±½…‘5…É­•ÑAÕ±Í•M¹…ÁÍ¡½Ð¡½¹Ñ•áÐ¹±¥•¹Ð°ì€¸¸¹‰½‘ä°™½É”èÉ•ÅÕ•ÍÑ½É•ÍI•™É•Í ¡‰½‘ä°É•Ä¤ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•Ñ%¹Ñ•±±¥•¹•ÕÉÙ”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸±½…‘5…É­•Ñ%¹Ñ•±±¥•¹•ÕÉÙ”¡½¹Ñ•áÐ¹±¥•¹Ð°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•Ñ%¹Ñ•±±¥•¹•Y…±Õ…Ñ¥½¸¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸±½…‘½Ù•É¹•‘5…É­•ÑY…±Õ…Ñ¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•Ñ½ÉÝ…É‘…±±‰…­M…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸Í…Ù•5…É­•Ñ½ÉÝ…É‘…±±‰…¬¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•Ñ%¹Ñ•±±¥•¹•±•ÉÑIÕ±•Í•Ð¡}‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸•Ñ5…É­•Ñ%¹Ñ•±±¥•¹•±•ÉÑIÕ±•Ì¡½¹Ñ•áÐ¹±¥•¹Ð¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•Ñ%¹Ñ•±±¥•¹•±•ÉÑIÕ±•ÍM…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸Í…Ù•5…É­•Ñ%¹Ñ•±±¥•¹•±•ÉÑIÕ±•Ì¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•Ñ%¹Ñ•±±¥•¹•ÕÉÙ•ÕÑ½Ù•ÉM…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸Í…Ù•5…É­•ÑÕÉÙ•M¡…‘½ÝÕÑ½Ù•È¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•Ñ%¹Ñ•±±¥•¹•É¡¥Ù•I•Á±…ä¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€¡•‘•}…‘µ¥¸œ°€!•‘”…‘µ¥¹¥ÍÑÉ…Ñ¥½¸Á•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•Ñ¼É•½¹¥±”Ñ¡”±¥•¹Í•µ…É­•Ð…É¡¥Ù”¸œ¤ì(€É•ÅÕ¥É•áÑ•É¹…±Ñ¥½¹…Ñ” ½½±•}‘É¥Ù”œ¤ì(€½¹ÍÐ…•ÍÍQ½­•¸€ô…Ý…¥Ð½½±•É¥Ù••ÍÍQ½­•¸ ¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÉÕ¹5…É­•ÑI•Á½ÉÑÉ¡¥Ù•I•Á±…å	…Ñ ¡½¹Ñ•áÐ¹±¥•¹Ð°ì(€€€…•ÍÍQ½­•¸°(€€€ÕÉÍ½Èè‰½‘ä¹ÕÉÍ½È°(€€€•áÁ•Ñ•‘É¡¥Ù•¥¹•ÉÁÉ¥¹Ðè‰½‘ä¹…É¡¥Ù•¥¹•ÉÁÉ¥¹Ðñð¹Õ±°°(€ô¤ì(€¥˜€¡É•ÍÕ±Ð¹É•Á±…å•‘½Õ¹Ð€ø€ÀñðÉ•ÍÕ±Ð¹‰É¥•™½µÁ±•Ñ•‘½Õ¹Ð€ø€À¤ì(€€€…Ý…¥Ð•áÁ¥É•IÕ¹Ñ¥µ•…¡•Q…Ì¡lµ…É­•ÑÌœ°€¡•‘”éµ…É­•ÑÌœ°€µ…É­•Ðé¥¹Ñ•±±¥•¹”t¤ì(€ô(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­A…ÉÍ•5½ÁÌ¡‰½‘ä€ôíô¤ì(€É•ÑÕÉ¸ì½¬èÑÉÕ”°€¸¸¹Á…ÉÍ•5½ÁÍQ•áÐ¡‰½‘ä¹É…Ý}¥¹ÁÕÐñð‰½‘ä¹Ñ•áÐñð‰½‘ä¹¥¹ÁÕÐñð€œœ¤ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­•¹•É…Ñ•%¹Ù½¥”¡‰½‘ä€ôíô¤ì(€½¹ÍÐ•¹•É…Ñ•€ô•¹•É…Ñ•!•‘•%¹Ù½¥•A‘˜¡‰½‘ä¤ì(€É•ÑÕÉ¸ì(€€€½¬èÑÉÕ”°(€€€‰…Í”ØÐè•¹•É…Ñ•¹‰Õ™™•È¹Ñ½MÑÉ¥¹œ ‰…Í”ØÐœ¤°(€€€µ¥µ•QåÁ”è€…ÁÁ±¥…Ñ¥½¸½Á‘˜œ°(€€€™¥±•¹…µ”è•¹•É…Ñ•¹™¥±•¹…µ”°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­M…Ù•%¹Ù½¥•A‘˜¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€¡•‘•}Í•ÑÑ±•µ•¹Ñ}µ…¹…”œ°€!•‘”Í•ÑÑ±•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•Ñ¼ÍÑ½É”¥¹Ù½¥”‘½Õµ•¹ÑÌ¸œ¤ì(€É•ÑÕÉ¸Í…Ù•!•‘•%¹Ù½¥•A‘˜¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­M•¹‘%¹Ù½¥•µ…¥°¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€¡•‘•}Í•ÑÑ±•µ•¹Ñ}µ…¹…”œ°€!•‘”Í•ÑÑ±•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•Ñ¼Í•¹Í•ÑÑ±•µ•¹Ð¥¹Ù½¥•Ì¸œ¤ì(€É•ÑÕÉ¸Í•¹‘!•‘•%¹Ù½¥•µ…¥±%‘•µÁ½Ñ•¹Ð¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­M™ÍI•Á½ÉÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸•Ñ!•‘•M™Í5½¹Ñ¡I•Á½ÉÐ¡½¹Ñ•áÐ¹±¥•¹Ð°‰½‘ä¹µ½¹Ñ ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­M™Í¥±”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸•Ñ!•‘•M™Í¥±”¡½¹Ñ•áÐ¹±¥•¹Ð°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­M™ÍM•¹¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€¡•‘•}±½Í•}…ÁÁÉ½Ù”œ°€!•‘”µ½¹Ñ µ±½Í”…ÁÁÉ½Ù…°Á•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•Ñ¼Í•¹MLÉ•Á½ÉÑÌ¸œ¤ì(€É•ÑÕÉ¸…ÁÁÉ½Ù•¹‘M•¹‘!•‘•M™ÍI•Á½ÉÐ¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­M…±•Í™½É•AÕÍ ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€¡•‘•}‰½½­}µ…¹…”œ°€!•‘”‰½½¬µ…¹…•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•™½ÈM…±•Í™½É”Íå¹¡É½¹¥é…Ñ¥½¸¸œ¤ì(€É•ÑÕÉ¸ÁÕÍ¡!•‘•M…±•Í™½É”¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­M…±•Í™½É•AÉ•Ù¥•Ü¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€¡•‘•}‰½½­}µ…¹…”œ°€!•‘”‰½½¬µ…¹…•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•™½ÈM…±•Í™½É”…±±½…Ñ¥½¸ÁÉ•Ù¥•ÝÌ¸œ¤ì(€É•ÑÕÉ¸ÁÉ•Ù¥•Ý!•‘•M…±•Í™½É”¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­M…±•Í™½É•5…ÁÁ¥¹œ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ…Á…‰¥±¥Ñ¥•Ì€ô…Ý…¥Ð¡•‘•…Á…‰¥±¥Ñ¥•Ì¡½¹Ñ•áÐ¤ì(€Ù½¥‰½‘äì(€É•ÑÕÉ¸ì€¸¸¸¡…Ý…¥Ð•Ñ!•‘•M…±•Í™½É•5…ÁÁ¥¹œ¡½¹Ñ•áÐ¹±¥•¹Ð¤¤°…¹5…¹…”è…Á…‰¥±¥Ñ¥•Ì¹¡•‘•}…‘µ¥¸€ôôôÑÉÕ”ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­ÍÍ¥ÍÑ…¹Ð¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸ÉÕ¹!•‘•ÍÍ¥ÍÑ…¹Ð¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­ÍÍ¥ÍÑ…¹ÑM•ÑÑ¥¹Ì¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ…Á…‰¥±¥Ñ¥•Ì€ô…Ý…¥Ð¡•‘•…Á…‰¥±¥Ñ¥•Ì¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸ì€¸¸¸¡…Ý…¥Ð¡•‘•ÍÍ¥ÍÑ…¹ÑM•ÑÑ¥¹Ì¡½¹Ñ•áÐ¹±¥•¹Ð¤¤°…¹5…¹…”è…Á…‰¥±¥Ñ¥•Ì¹¡•‘•}…‘µ¥¸€ôôôÑÉÕ”ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡•‘••Í­5…¥¹Ñ•¹…¹•É½¸¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°¤ì(€É•ÅÕ¥É•É½¹ÕÑ¡½É¥é…Ñ¥½¸¡É•Ä¤ì(€É•ÑÕÉ¸ÉÕ¹!•‘•5…¥¹Ñ•¹…¹”¡ÍÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤°ì(€€€™½É•%”è‰½‘ä¹™½É•%”€ôôôÑÉÕ”°(€€€‘ÉåIÕ¸è‰½‘ä¹‘ÉåIÕ¸€ôôôÑÉÕ”°(€ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸µ…É­•ÑI•Á½ÉÑÉ¥Ù•Må¹É½¸¡}‰½‘ä€ôíô°É•Ä€ô¹Õ±°¤ì(€É•ÅÕ¥É•É½¹ÕÑ¡½É¥é…Ñ¥½¸¡É•Ä¤ì(€É•ÅÕ¥É•áÑ•É¹…±Ñ¥½¹…Ñ” ½½±•}‘É¥Ù”œ¤ì(€½¹ÍÐ±¥•¹Ð€ôÍÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤ì(€½¹ÍÐ…•ÍÍQ½­•¸€ô…Ý…¥Ð½½±•É¥Ù••ÍÍQ½­•¸ ¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÉÕ¹5…É­•ÑI•Á½ÉÑÉ¥Ù•Må¹Œ¡±¥•¹Ð°ì…•ÍÍQ½­•¸ô¤ì(€¥˜€¡É•ÍÕ±Ð¹ÍÑ…ÑÕÌ€ôôô€™…¥±•œ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½È M¡•‘Õ±•½½±”É¥Ù”µ…É­•ÐµÉ•Á½ÉÐÍå¹¡É½¹¥é…Ñ¥½¸‘¥¹½Ð½µÁ±•Ñ”¸œ°€ÔÀÈ°É•ÍÕ±Ð¹•ÉÉ½É½‘”ñð€5I-Q}I%Y}Me9}%1œ°Õ¹‘•™¥¹•°ÑÉÕ”¤ì(€ô(€¥˜€¡É•ÍÕ±Ð¹¥µÁ½ÉÑ•‘½Õ¹Ð€ø€À¤…Ý…¥Ð•áÁ¥É•IÕ¹Ñ¥µ•…¡•Q…Ì¡lµ…É­•ÑÌœ°€¡•‘”éµ…É­•ÑÌœ°€µ…É­•Ðé¥¹Ñ•±±¥•¹”t¤ì(€…Ý…¥ÐÉ•Í½±Ù•I•½Ù•É•‘MåÍÑ•µÉÉ½É!…¹‘±•È¡±¥•¹Ð°€µ…É­•ÑI•Á½ÉÑÉ¥Ù•Må¹É½¸œ°ìÉ•Í½±Ù•‘Q¡É½Õ è¹•Ü…Ñ” ¤ô¤¹…Ñ   ¤€ôøíô¤ì(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµÍ]½É­ÍÁ…”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐmÝ½É­ÍÁ…”°…¹ÁÁÉ½Ù•±…ÕÍ•Ít€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€±¥ÍÑMÁ•¥…±Q•ÉµÌ¡ì™½É”è‰½‘ä¹™½É”€ôôôÑÉÕ”ô¤°(€€€ÕÍ•É!…Í…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€ÍÁ•¥…±}Ñ•ÉµÍ}±…ÕÍ•}…ÁÁÉ½Ù”œ¤°(€t¤ì(€½¹ÍÐ…Ñ¥Ù••¹•É…±5…¹…•È€ô½¹Ñ•áÐ¹ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”€ôôô€•¹•É…±}µ…¹…•Èœ€ü…Ý…¥Ð±½…‘Ñ¥Ù••¹•É…±5…¹…•È¡½¹Ñ•áÐ¹±¥•¹Ð¤€è¹Õ±°ì(€½¹ÍÐ…¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì€ô…¹ÁÁÉ½Ù•±…ÕÍ•Ì€˜˜€¡¥Í‘µ¥¹¥ÍÑÉ…Ñ½ÉUÍ•ÉQåÁ”¡½¹Ñ•áÐ¹ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”¤ñð…Ñ¥Ù••¹•É…±5…¹…•Èü¹¥€ôôô½¹Ñ•áÐ¹ÁÉ½™¥±”¹¥¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹Ý½É­ÍÁ…”°(€€€…¹5…¹…”èÑÉÕ”°(€€€…¹É…™ÐèÑÉÕ”°(€€€…¹ÁÁÉ½Ù•±…ÕÍ•Ìè…¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì°(€€€…¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì°(€€€ÕÉÉ•¹ÑUÍ•Éµ…¥°è½¹Ñ•áÐ¹ÁÉ½™¥±”¹•µ…¥°ñð€œœ°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµÍMÕµµ…Éå1¥ÍÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐmÍÕµµ…Éä°Í¡•µ„°…¹ÁÁÉ½Ù•±…ÕÍ•Ít€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€±¥ÍÑMÁ•¥…±Q•ÉµMÕµµ…É¥•Ì¡‰½‘ä¤°(€€€É•Í½±Ù•MÁ•¥…±Q•ÉµÍM¡•µ„ ¤°(€€€ÕÍ•É!…Í…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€ÍÁ•¥…±}Ñ•ÉµÍ}±…ÕÍ•}…ÁÁÉ½Ù”œ¤°(€t¤ì(€½¹ÍÐ…Ñ¥Ù••¹•É…±5…¹…•È€ô½¹Ñ•áÐ¹ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”€ôôô€•¹•É…±}µ…¹…•Èœ€ü…Ý…¥Ð±½…‘Ñ¥Ù••¹•É…±5…¹…•È¡½¹Ñ•áÐ¹±¥•¹Ð¤€è¹Õ±°ì(€½¹ÍÐ…¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì€ô…¹ÁÁÉ½Ù•±…ÕÍ•Ì€˜˜€¡¥Í‘µ¥¹¥ÍÑÉ…Ñ½ÉUÍ•ÉQåÁ”¡½¹Ñ•áÐ¹ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”¤ñð…Ñ¥Ù••¹•É…±5…¹…•Èü¹¥€ôôô½¹Ñ•áÐ¹ÁÉ½™¥±”¹¥¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹ÍÕµµ…Éä°(€€€Ñ•ÉµÌè€¡ÍÕµµ…Éä¹Ñ•ÉµÌñðmt¤¹µ…À ¡Ñ•É´¤€ôø€……¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì€˜˜Ñ•É´¹¹•áÑÑ¥½¸€ôôô€É•Ù¥•Ý}ÁÕ‰±¥Í œ€üì€¸¸¹Ñ•É´°¹•áÑÑ¥½¸è€½¹Ñ¥¹Õ”œô€èÑ•É´¤°(€€€…¹É…™ÐèÑÉÕ”°(€€€…¹ÁÁÉ½Ù•±…ÕÍ•Ìè…¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì°(€€€…¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì°(€€€ÕÉÉ•¹ÑUÍ•Éµ…¥°è½¹Ñ•áÐ¹ÁÉ½™¥±”¹•µ…¥°ñð€œœ°(€€€±…ÕÍ•…Ñ•½Éå=ÁÑ¥½¹ÌèÍ¡•µ„¹±…ÕÍ•…Ñ•½Éå=ÁÑ¥½¹Ì°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµÍ½Õµ•¹ÑáÁ½ÉÐ¡‰½‘ä€ôíô°É•Ä°É•Ì°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ™½Éµ…Ð€ôMÑÉ¥¹œ¡‰½‘ä¹™½Éµ…Ðñð€Á‘˜œ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€½¹ÍÐÍ½ÕÉ”€ôMÑÉ¥¹œ¡‰½‘ä¹Í½ÕÉ”ñð€±¥Ù”œ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€¥˜€ …lÁ‘˜œ°€‘½àt¹¥¹±Õ‘•Ì¡™½Éµ…Ð¤¤Ñ¡É½Ü…ÁÁÉÉ½È ¡½½Í”A½È]½É‘½Õµ•¹Ð™½Éµ…Ð¸œ°€ÐÀÀ°€MA%1}QI5M}=U59Q}=I5Q}%9Y1%œ¤ì(€¥˜€ …l±¥Ù”œ°€‘É…™Ðt¹¥¹±Õ‘•Ì¡Í½ÕÉ”¤¤Ñ¡É½Ü…ÁÁÉÉ½È ¡½½Í”„±¥Ù”‘½Õµ•¹Ð½ÈÍ…Ù•‘É…™ÐÁÉ•Ù¥•Ü¸œ°€ÐÀÀ°€MA%1}QI5M}=U59Q}M=UI}%9Y1%œ¤ì(€¥˜€¡Í½ÕÉ”€ôôô€‘É…™Ðœ€˜˜™½Éµ…Ð€„ôô€Á‘˜œ¤Ñ¡É½Ü…ÁÁÉÉ½È M…Ù•‘É…™ÑÌµ…ä‰”‘½Ý¹±½…‘•…ÌÝ…Ñ•Éµ…É­•A½¹±ä¸œ°€ÐÀä°€MA%1}QI5M}=U59Q}IQ}=I5Q}IMQI%Qœ¤ì(€½¹ÍÐÑ•É´€ô…Ý…¥Ð•ÑMÁ•¥…±Q•Éµ½Õµ•¹Ñ½ÉáÁ½ÉÐ¡‰½‘ä¹Ñ•Éµ%°ì(€€€Í½ÕÉ”°(€€€É•Ù¥Í¥½¹%è‰½‘ä¹É•Ù¥Í¥½¹%°(€€€•áÁ•Ñ•‘1…ÍÑ5½‘¥™¥•‘Ðè‰½‘ä¹•áÁ•Ñ•‘1…ÍÑ5½‘¥™¥•‘Ð°(€€€•áÁ•Ñ•‘I•Ù¥Í¥½¹1…ÍÑ5½‘¥™¥•‘Ðè‰½‘ä¹•áÁ•Ñ•‘I•Ù¥Í¥½¹1…ÍÑ5½‘¥™¥•‘Ð°(€€€™½É”èÑÉÕ”°(€ô¤ì(€½¹ÍÐ•¹•É…Ñ•€ô…Ý…¥Ð•¹•É…Ñ•MÁ•¥…±Q•ÉµÍ½Õµ•¹Ð¡Ñ•É´°ì(€€€™½Éµ…Ð°(€€€Í½ÕÉ”°(€€€‘ÕÁ±¥…Ñ•%¹‘•àè‰½‘ä¹‘ÕÁ±¥…Ñ•%¹‘•à°(€ô¤ì(€…Ý…¥ÐÝÉ¥Ñ•‘µ¥¹Õ‘¥Ð¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€ÍÁ•¥…±}Ñ•ÉµÍ}‘½Õµ•¹Ñ}•áÁ½ÉÑ•œ°¹Õ±°°¹Õ±°°ì(€€€Ñ•Éµ½Õ¹Ðè€Ä°(€€€Ñ•Éµ%èÑ•É´¹¥°(€€€™½Éµ…Ð°(€€€Í½ÕÉ”°(€€€Á…•½Õ¹Ðè9Õµ‰•È¹¥Í¥¹¥Ñ”¡•¹•É…Ñ•¹Á…•½Õ¹Ð¤€ü•¹•É…Ñ•¹Á…•½Õ¹Ð€è¹Õ±°°(€€€½ÕÑ½µ”è€ÍÕ•ÍÌœ°(€ô¤ì(€½¹ÍÐ…Í¥¥¥±•¹…µ”€ô•¹•É…Ñ•¹™¥±•¹…µ”¹É•Á±…” ½myqàÈÀµqàÝt½œ°€|œ¤¹É•Á±…” ¼ˆ½œ°€œœ¤ì(€É•Ì¹ÍÑ…ÑÕÍ½‘”€ô€ÈÀÀì(€É•Ì¹Í•Ñ!•…‘•È …¡”µ½¹ÑÉ½°œ°€¹¼µÍÑ½É”œ¤ì(€É•Ì¹Í•Ñ!•…‘•È ½¹Ñ•¹ÐµÑåÁ”œ°•¹•É…Ñ•¹½¹Ñ•¹ÑQåÁ”¤ì(€É•Ì¹Í•Ñ!•…‘•È ½¹Ñ•¹Ðµ‘¥ÍÁ½Í¥Ñ¥½¸œ°…ÑÑ…¡µ•¹Ðì™¥±•¹…µ”ôˆ‘í…Í¥¥¥±•¹…µ•ôˆì™¥±•¹…µ”¨õUQ´àœœ‘í•¹½‘•UI%½µÁ½¹•¹Ð¡•¹•É…Ñ•¹™¥±•¹…µ”¥õ€¤ì(€™½È€¡½¹ÍÐm¹…µ”°Ù…±Õ•t½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡Ñ•±•µ•ÑÉåI•ÍÁ½¹Í•!•…‘•ÉÌ ¤¤¤É•Ì¹Í•Ñ!•…‘•È¡¹…µ”°Ù…±Õ”¤ì(€É•Ì¹•¹¡•¹•É…Ñ•¹‰Õ™™•È¤ì)ô((¼¨¨I•Ñ…¥¹•½¹±ä™½È‘•Á±½å•=L±¥•¹ÑÌÑ¡…Ð…±°Ñ¡”½É¥¥¹…°É½ÕÑ”¸€¨¼)…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµÍA‘™áÁ½ÉÐ¡‰½‘ä€ôíô°É•Ä°É•Ì°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸ÍÁ•¥…±Q•ÉµÍ½Õµ•¹ÑáÁ½ÉÐ¡ì€¸¸¹‰½‘ä°™½Éµ…Ðè€Á‘˜œ°Í½ÕÉ”è‰½‘ä¹Í½ÕÉ”ñð€±¥Ù”œô°É•Ä°É•Ì°…•ÍÍ½¹Ñ•áÐ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµÍ=ÁÑ¥½¹Ì¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸ì½ÁÑ¥½¹Ìè…Ý…¥ÐÍÁ•¥…±Q•Éµ=ÁÑ¥½¹Ì¡‰½‘ä¤ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥ÍMÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€½¹ÍÐ¡…Í…Á…‰¥±¥Ñä€ô…Ý…¥ÐÕÍ•É!…Í…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€ÍÁ•¥…±}Ñ•ÉµÍ}±…ÕÍ•}…ÁÁÉ½Ù”œ¤ì(€¥˜€ …¡…Í…Á…‰¥±¥Ñä¤É•ÑÕÉ¸™…±Í”ì(€½¹ÍÐ¥Í‘µ¥¹¥ÍÑÉ…Ñ½È€ô½¹Ñ•áÐ¹ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”€ôôô€…‘µ¥¹¥ÍÑÉ…Ñ½Èœì(€½¹ÍÐ…Ñ¥Ù••¹•É…±5…¹…•È€ô½¹Ñ•áÐ¹ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”€ôôô€•¹•É…±}µ…¹…•Èœ(€€€€ü…Ý…¥Ð±½…‘Ñ¥Ù••¹•É…±5…¹…•È¡½¹Ñ•áÐ¹±¥•¹Ð¤(€€€€è¹Õ±°ì(€É•ÑÕÉ¸¥Í‘µ¥¹¥ÍÑÉ…Ñ½Èñð…Ñ¥Ù••¹•É…±5…¹…•Èü¹¥€ôôô½¹Ñ•áÐ¹ÁÉ½™¥±”¹¥ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€¥˜€ „¡…Ý…¥Ð¥ÍMÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤¤¤Ñ¡É½Ü…ÁÁÉÉ½È =¹±äÑ¡”…Ñ¥Ù”•¹•É…°5…¹…•È½È…¸‘µ¥¹¥ÍÑÉ…Ñ½Èµ…ä…ÁÁÉ½Ù”±…ÕÍ”Ý½É‘¥¹œ…¹µ¥É…Ñ¥½¹Ì¸œ°€ÐÀÌ°€MA%1}QI5M}1UM}AAI=YI}IEU%Iœ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ•Ñ…¥°¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐm‘•Ñ…¥°°Í¡•µ„°…¹ÁÁÉ½Ù•±…ÕÍ•Ít€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€•ÑMÁ•¥…±Q•Éµ•Ñ…¥°¡‰½‘ä¹Ñ•Éµ%°ì™½É”è‰½‘ä¹™½É”€ôôôÑÉÕ”ô¤°(€€€É•Í½±Ù•MÁ•¥…±Q•ÉµÍM¡•µ„ ¤°(€€€ÕÍ•É!…Í…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€ÍÁ•¥…±}Ñ•ÉµÍ}±…ÕÍ•}…ÁÁÉ½Ù”œ¤°(€t¤ì(€½¹ÍÐ…Ñ¥Ù••¹•É…±5…¹…•È€ô½¹Ñ•áÐ¹ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”€ôôô€•¹•É…±}µ…¹…•Èœ€ü…Ý…¥Ð±½…‘Ñ¥Ù••¹•É…±5…¹…•È¡½¹Ñ•áÐ¹±¥•¹Ð¤€è¹Õ±°ì(€½¹ÍÐ…¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì€ô…¹ÁÁÉ½Ù•±…ÕÍ•Ì€˜˜€¡¥Í‘µ¥¹¥ÍÑÉ…Ñ½ÉUÍ•ÉQåÁ”¡½¹Ñ•áÐ¹ÁÉ½™¥±”¹ÕÍ•É}ÑåÁ”¤ñð…Ñ¥Ù••¹•É…±5…¹…•Èü¹¥€ôôô½¹Ñ•áÐ¹ÁÉ½™¥±”¹¥¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹‘•Ñ…¥°°(€€€…¹É…™ÐèÑÉÕ”°(€€€…¹ÁÁÉ½Ù•±…ÕÍ•Ìè…¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì°(€€€…¹ÁÁÉ½Ù•I•Ù¥Í¥½¹Ì°(€€€ÕÉÉ•¹ÑUÍ•Éµ…¥°è½¹Ñ•áÐ¹ÁÉ½™¥±”¹•µ…¥°ñð€œœ°(€€€±…ÕÍ•…Ñ•½Éå=ÁÑ¥½¹ÌèÍ¡•µ„¹±…ÕÍ•…Ñ•½Éå=ÁÑ¥½¹Ì°(€€€…Õ‘¥•¹•=ÁÑ¥½¹ÌèÍ¡•µ„¹…Õ‘¥•¹•=ÁÑ¥½¹Ì°(€€€½Õ¹ÑÉå=ÁÑ¥½¹ÌèÍ¡•µ„¹½Õ¹ÑÉå=ÁÑ¥½¹Ì°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•	…¹¬¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸±¥ÍÑMÁ•¥…±Q•Éµ±…ÕÍ•	…¹¬¡‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•M¥µ¥±…È¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸±¥ÍÑMÁ•¥…±Q•Éµ±…ÕÍ•M¥µ¥±…È¡‰½‘ä¹±…ÕÍ•%°ì±¥µ¥Ðè‰½‘ä¹±¥µ¥Ðô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•‘¥ÑAÉ•Ù¥•Ü¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸•ÑMÁ•¥…±Q•Éµ±…ÕÍ•‘¥ÑAÉ•Ù¥•Ü¡‰½‘ä°ì…¹AÕ‰±¥Í è…Ý…¥Ð¥ÍMÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•±½‰…±AÕ‰±¥Í ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸ÁÕ‰±¥Í¡MÁ•¥…±Q•Éµ±…ÕÍ•±½‰…±±ä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ•±•Ñ•AÉ•Ù¥•Ü¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€½¹ÍÐ½ÁÑ¥½¹Ì€ôì¥ÍÁÁÉ½Ù•Èè…Ý…¥Ð¥ÍMÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ôì(€¥˜€¡‰½‘ä¹•¹Ñ¥ÑåQåÁ”€ôôô€±…ÕÍ”œñð‰½‘ä¹•¹Ñ¥ÑåQåÁ”€ôôô€±…ÕÍ•Y•ÉÍ¥½¸œ¤É•ÑÕÉ¸ÁÉ•Ù¥•ÝMÁ•¥…±Q•Éµ±…ÕÍ••±•Ñ¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä°½ÁÑ¥½¹Ì¤ì(€É•ÑÕÉ¸ÁÉ•Ù¥•ÝMÁ•¥…±Q•Éµ•±•Ñ¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä°½ÁÑ¥½¹Ì¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹%¹Ù•¹Ñ½Éä¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸•ÑMÁ•¥…±Q•Éµ5¥É…Ñ¥½¹%¹Ù•¹Ñ½Éä¡ì™½É”è‰½‘ä¹™½É”€ôôôÑÉÕ”ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•É…™ÑM…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸Í…Ù•MÁ•¥…±Q•Éµ±…ÕÍ•É…™Ð¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸…ÁÁÉ½Ù•MÁ•¥…±Q•Éµ±…ÕÍ”¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•I•Ñ¥É”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸É•Ñ¥É•MÁ•¥…±Q•Éµ±…ÕÍ”¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ••±•Ñ”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸‘•±•Ñ•MÁ•¥…±Q•Éµ±…ÕÍ”¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä°ì¥ÍÁÁÉ½Ù•Èè…Ý…¥Ð¥ÍMÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•É…™Ñ¥Í…É¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸‘¥Í…É‘MÁ•¥…±Q•Éµ±…ÕÍ•É…™Ð¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä°ì¥ÍÁÁÉ½Ù•Èè…Ý…¥Ð¥ÍMÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹1¥ÍÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸±¥ÍÑMÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹Ì¡ì¥¹±Õ‘•±½Í•è‰½‘ä¹¥¹±Õ‘•±½Í•€ôôôÑÉÕ”ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹MÑ…ÉÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸ÍÑ…ÉÑMÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹I•±¥¹¬¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸É•±¥¹­MÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹…¹•°¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸…¹•±MÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹½µÁ±•Ñ”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸½µÁ±•Ñ•MÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ½µÁ½Í¥Ñ¥½¹M…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€Ñ¡É½Ü…ÁÁÉÉ½È ¥É•ÐÁÉ½©•Ñ¥½¸½µÁ½Í¥Ñ¥½¸¥ÌÉ•Ñ¥É•¸M…Ù”„½µÁ±•Ñ”MÁ•¥…°Q•É´É•Ù¥Í¥½¸¥¹ÍÑ•…¸œ°€ÐÀä°€MA%1}QI5M}]!=1}IY%M%=9}IEU%Iœ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹AÉ•Ù¥•Ü¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸ÁÉ•Ù¥•ÝMÁ•¥…±Q•Éµ5¥É…Ñ¥½¸¡‰½‘ä¹Ñ•Éµ%°ìÁÉ½©•Ñ¥½¸è‰½‘ä¹ÁÉ½©•Ñ¥½¸ñð€Ñ•ÉµÍQ•áÐœô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹M…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸Í…Ù•MÁ•¥…±Q•Éµ5¥É…Ñ¥½¹I•Ù¥•Ü¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹M…Ù•±°¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸Í…Ù•±±MÁ•¥…±Q•Éµ5¥É…Ñ¥½¹I•Ù¥•Ü¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹Ñ¥Ù…Ñ”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€Ñ¡É½Ü…ÁÁÉÉ½È AÉ½©•Ñ¥½¸µ±•Ù•°…Ñ¥Ù…Ñ¥½¸¥ÌÉ•Ñ¥É•¸ÁÁÉ½Ù”…¹…Ñ¥Ù…Ñ”Ñ¡”½µÁ±•Ñ”MÁ•¥…°Q•É´É•Ù¥Í¥½¸¸œ°€ÐÀä°€MA%1}QI5M}]!=1}IY%M%=9}IEU%Iœ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹AÉ•Ù¥•Ý±°¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸ÁÉ•Ù¥•ÝMÁ•¥…±Q•Éµ5¥É…Ñ¥½¹±°¡‰½‘ä¹Ñ•Éµ%¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹I½±±‰…¬¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€Ñ¡É½Ü…ÁÁÉÉ½È AÉ½©•Ñ¥½¸µ±•Ù•°É½±±‰…¬¥ÌÉ•Ñ¥É•¸I½±°‰…¬Ñ¡”½µÁ±•Ñ”MÁ•¥…°Q•É´É•Ù¥Í¥½¸¸œ°€ÐÀä°€MA%1}QI5M}]!=1}IY%M%=9}IEU%Iœ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµI•Ù¥Í¥½¹M…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸Í…Ù•MÁ•¥…±Q•ÉµI•Ù¥Í¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµI•Ù¥Í¥½¹½µµ¥Ð¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸½µµ¥ÑMÁ•¥…±Q•ÉµI•Ù¥Í¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä°ì…¹ÁÁÉ½Ù”è…Ý…¥Ð¥ÍMÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµI•Ù¥Í¥½¹ÁÁÉ½Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸…ÁÁÉ½Ù•MÁ•¥…±Q•ÉµI•Ù¥Í¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµI•Ù¥Í¥½¹I½±±‰…¬¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•MÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸É½±±‰…­MÁ•¥…±Q•ÉµI•Ù¥Í¥½¸¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹	…Ñ¡1¥ÍÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸±¥ÍÑMÁ•¥…±Q•Éµ5¥É…Ñ¥½¹	…Ñ¡•Ì¡ì™½É”è‰½‘ä¹™½É”€ôôôÑÉÕ”ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµÁÁÉ½Ù…±EÕ•Õ”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸±¥ÍÑMÁ•¥…±Q•ÉµÁÁÉ½Ù…±EÕ•Õ”¡ì™½É”è‰½‘ä¹™½É”€ôôôÑÉÕ”°±¥µ¥Ðè‰½‘ä¹±¥µ¥Ðô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•Éµ±…ÕÍ•¥É…™Ð¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€É•ÑÕÉ¸‘É…™ÑMÁ•¥…±Q•Éµ±…ÕÍ•Í]¥Ñ¡¤¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµÍM…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€ÍÁ•¥…±}Ñ•ÉµÍ}µ…¹…”œ°€MÁ•¥…°Q•ÉµÌ‘É…™Ñ¥¹œÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸œ¤ì(€É•ÑÕÉ¸Í…Ù•MÁ•¥…±Q•É´¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµÍ•±•Ñ”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€ÍÁ•¥…±}Ñ•ÉµÍ}µ…¹…”œ°€MÁ•¥…°Q•ÉµÌµ…¹…•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸œ¤ì(€É•ÑÕÉ¸‘•±•Ñ•MÁ•¥…±Q•É´¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä°ì¥ÍÁÁÉ½Ù•Èè…Ý…¥Ð¥ÍMÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµIÕ±•M…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€ÍÁ•¥…±}Ñ•ÉµÍ}µ…¹…”œ°€MÁ•¥…°Q•ÉµÌ‘É…™Ñ¥¹œÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸œ¤ì(€É•ÑÕÉ¸Í…Ù•MÁ•¥…±Q•ÉµIÕ±”¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÁ•¥…±Q•ÉµIÕ±••±•Ñ”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€½¹ÍÐ½¹Ñ•áÐ€ô…•ÍÍ½¹Ñ•áÐñð€¡…Ý…¥ÐÉ•ÅÕ¥É•Ñ¥Ù•UÍ•È¡É•Ä¤¤ì(€…Ý…¥ÐÉ•ÅÕ¥É•…Á…‰¥±¥Ñä¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°€ÍÁ•¥…±}Ñ•ÉµÍ}µ…¹…”œ°€MÁ•¥…°Q•ÉµÌµ…¹…•µ•¹ÐÁ•Éµ¥ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸œ¤ì(€É•ÑÕÉ¸‘•±•Ñ•MÁ•¥…±Q•ÉµIÕ±”¡½¹Ñ•áÐ¹±¥•¹Ð°½¹Ñ•áÐ¹ÁÉ½™¥±”°‰½‘ä°ì¥ÍÁÁÉ½Ù•Èè…Ý…¥Ð¥ÍMÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù•È¡½¹Ñ•áÐ¤ô¤ì)ô()™Õ¹Ñ¥½¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤ì(€É•ÑÕÉ¸ì±¥•¹Ðè…•ÍÍ½¹Ñ•áÐ¹±¥•¹Ð°ÁÉ½™¥±”è…•ÍÍ½¹Ñ•áÐ¹ÁÉ½™¥±”ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É1¥ÍÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É1¥ÍÐ¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É	…­É½Õ¹‘Må¹Œ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É	…­É½Õ¹‘Må¹Œ¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É1•…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É1•…Ù”¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É1•…Ù•M…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É1•…Ù•M…Ù”¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É•Ñ…¥°¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Ñ…¥°¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É¥É•Ñ½Éä¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É¥É•Ñ½Éä¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É¥É•Ñ½ÉåI•™É•Í ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É¥É•Ñ½ÉåI•™É•Í ¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉAÉ•Í•ÑÌ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉAÉ•Í•ÑÌ¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉÑ¥½¸¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉÑ¥½¸¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉÑ¥½¹MÑ…ÑÕÌ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉÑ¥½¹MÑ…ÑÕÌ¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉU¹‘¼¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉU¹‘¼¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉI•ÑÉä¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉI•ÑÉä¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É¥±¥¹I•ÑÉä¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É¥±¥¹I•ÑÉä¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉÑÑ…¡µ•¹ÑUÉ°¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉÑÑ…¡µ•¹ÑUÉ°¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉÑÑ…¡µ•¹ÑQ•áÐ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉÑÑ…¡µ•¹ÑQ•áÐ¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É!•…±Ñ ¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É!•…±Ñ ¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É‘Ù¥Í½È¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É‘Ù¥Í½È¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉM•ÑÑ¥¹Ì¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉM•ÑÑ¥¹Ì¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉM•ÑÑ¥¹ÍM…Ù”¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉM•ÑÑ¥¹ÍM…Ù”¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É=ÕÑ‰½à¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É=ÕÑ‰½à¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É•±Ñ„¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•±Ñ„¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•ÉMÕ‰ÍÉ¥ÁÑ¥½¸¡‰½‘ä€ôíô°É•Ä€ô¹Õ±°°…•ÍÍ½¹Ñ•áÐ€ô¹Õ±°¤ì(€É•ÑÕÉ¸¹…Ñ¥Ù•µ…¥±I½ÕÑ•ÉMÕ‰ÍÉ¥ÁÑ¥½¸¡É•Ä°‰½‘ä°¹…Ñ¥Ù•µ…¥±I½ÕÑ•É•Á•¹‘•¹¥•Ì¡…•ÍÍ½¹Ñ•áÐ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ…¥±I½ÕÑ•É5…¥¹Ñ•¹…¹•É½¸¡}‰½‘ä€ôíô°É•Ä€ô¹Õ±°¤ì(€É•ÅÕ¥É•É½¹ÕÑ¡½É¥é…Ñ¥½¸¡É•Ä¤ì(€½¹ÍÐµ…¥¹Ñ•¹…¹•MÑ…ÉÑ•‘Ð€ô¹•Ü…Ñ” ¤ì(€½¹ÍÐ±¥•¹Ð€ôÉ•…Ñ•µ…¥±I½ÕÑ•ÉM•ÉÙ¥•±¥•¹Ð ¤ì(€½¹ÍÐ‘¥É•Ñ½ÉåMå¹Œ€ô…Ý…¥Ð±¥•¹Ð¹ÉÁŒ Íå¹}•µ…¥±É½ÕÑ•É}™½Í}‘•ÍÑ¥¹…Ñ¥½¹Ìœ°ìÁ}…Ñ½Èè¹Õ±°ô¤ì(€½¹ÍÐµ…¥±‰½à€ô…Ý…¥ÐÕÉÉ•¹Ñµ…¥±I½ÕÑ•É5…¥±‰½à¡±¥•¹Ð¤ì(€½¹ÍÐ½ÕÑ‰½à€ô…Ý…¥ÐÁÉ½•ÍÍµ…¥±I½ÕÑ•É=ÕÑ‰½à¡ì±¥•¹Ð°µ…¥±‰½à°±¥µ¥Ðè€ÈÔô¤ì(€½¹ÍÐ±•…É¹¥¹œ€ô…Ý…¥ÐÁÉ½•ÍÍµ…¥±I½ÕÑ•É1•…É¹¥¹)½‰Ì¡ì±¥•¹Ð°µ…¥±‰½à°±¥µ¥Ðè€ÄÀô¤¹…Ñ  ¡•ÉÉ½È¤€ôø€¡ìÍÑ…ÑÕÌè€Ý…É¹¥¹œœ°½‘”è•ÉÉ½È¹½‘”ñð€5%1}I=UQI}1I9%9}%1œô¤¤ì(€½¹ÍÐÍå¹¡É½¹¥é…Ñ¥½¸€ôíôì(€™½È€¡½¹ÍÐ™½±‘•È½˜l¥¹‰½àœ°€Í•¹Ñ¥Ñ•µÌœ°€…É¡¥Ù”t¤ì(€€€Íå¹¡É½¹¥é…Ñ¥½¹m™½±‘•Ét€ô…Ý…¥ÐÍå¹µ…¥±I½ÕÑ•É½±‘•ÉÉ½µMÑ½É•‘ÕÉÍ½È¡ì±¥•¹Ð°µ…¥±‰½à°™½±‘•È°µ…áA…•Ìè€ÄÀô¤ì(€ô(€±•ÐÍÕ‰ÍÉ¥ÁÑ¥½¹Ì€ômtì(€ÑÉäì(€€€ÍÕ‰ÍÉ¥ÁÑ¥½¹Ì€ô…Ý…¥Ðµ…¥¹Ñ…¥¹µ…¥±I½ÕÑ•ÉMÕ‰ÍÉ¥ÁÑ¥½¹Ì¡ì±¥•¹Ð°µ…¥±‰½àô¤ì(€€€…Ý…¥ÐÉ•Í½±Ù•µ…¥±I½ÕÑ•É±•ÉÐ¡±¥•¹Ð°ì‘•‘ÕÁ•-•äèµ…¥±‰½àè‘íµ…¥±‰½à¹¥‘ôéÍÕ‰ÍÉ¥ÁÑ¥½¹Í€ô¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€…Ý…¥ÐÉ•½É‘µ…¥±I½ÕÑ•É±•ÉÐ¡±¥•¹Ð°ìµ…¥±‰½á%èµ…¥±‰½à¹¥°½‘”è•ÉÉ½È¹½‘”ñð€•µ…¥±}É½ÕÑ•É}ÍÕ‰ÍÉ¥ÁÑ¥½¹}™…¥±•œ°Í•Ù•É¥Ñäè€É¥Ñ¥…°œ°‘•‘ÕÁ•-•äèµ…¥±‰½àè‘íµ…¥±‰½à¹¥‘ôéÍÕ‰ÍÉ¥ÁÑ¥½¹Í€ô¤ì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô(€¥˜€ …‘¥É•Ñ½ÉåMå¹Œ¹•ÉÉ½È€˜˜±•…É¹¥¹œü¹ÍÑ…ÑÕÌ€„ôô€Ý…É¹¥¹œœ¤ì(€€€…Ý…¥ÐÉ•Í½±Ù•I•½Ù•É•‘MåÍÑ•µÉÉ½É!…¹‘±•È¡±¥•¹Ð°€•µ…¥±I½ÕÑ•É5…¥¹Ñ•¹…¹•É½¸œ°ì(€€€€€É•Í½±Ù•‘Q¡É½Õ èµ…¥¹Ñ•¹…¹•MÑ…ÉÑ•‘Ð°(€€€€€Í••¹M¥¹”è¹•Ü…Ñ”¡µ…¥¹Ñ•¹…¹•MÑ…ÉÑ•‘Ð¹•ÑQ¥µ” ¤€´€ÄÔ€¨€ØÁ|ÀÀÀ¤°(€€€ô¤¹…Ñ  ¡•ÉÉ½È¤€ôøì(€€€€€½¹Í½±”¹Ý…É¸ m•µ…¥°µÉ½ÕÑ•ÉtI•½Ù•É•µ…¥¹Ñ•¹…¹”¹½Ñ¥™¥…Ñ¥½¸½Õ±¹½Ð‰”É•Í½±Ù•¸œ°ì(€€€€€€€½‘”è•ÉÉ½Èü¹½‘”ñð€5%1}I=UQI}9=Q%%Q%=9}I=YIe}%1œ°(€€€€€ô¤ì(€€€ô¤ì(€ô(€É•ÑÕÉ¸ì(€€€½¬èÑÉÕ”°(€€€‘¥É•Ñ½Éäè‘¥É•Ñ½ÉåMå¹Œ¹•ÉÉ½È€üìÍÑ…ÑÕÌè€Ý…É¹¥¹œœô€èìÍÑ…ÑÕÌè€Íå¹¡É½¹¥é•œô°(€€€½ÕÑ‰½à°(€€€±•…É¹¥¹œ°(€€€Íå¹¡É½¹¥é…Ñ¥½¸è=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡=‰©•Ð¹•¹ÑÉ¥•Ì¡Íå¹¡É½¹¥é…Ñ¥½¸¤¹µ…À ¡m™½±‘•È°É•ÍÕ±Ñt¤€ôøm™½±‘•È°ìÍå¹•èÉ•ÍÕ±Ð¹Íå¹•°É•µ½Ù•èÉ•ÍÕ±Ð¹É•µ½Ù•°Á…•ÌèÉ•ÍÕ±Ð¹Á…•Ì°½µÁ±•Ñ”è€…É•ÍÕ±Ð¹¹•áÑ1¥¹¬õt¤¤°(€€€ÍÕ‰ÍÉ¥ÁÑ¥½¹ÌèÍÕ‰ÍÉ¥ÁÑ¥½¹Ì¹µ…À ¡¥Ñ•´¤€ôø€¡ì™½±‘•Èè¥Ñ•´¹™½±‘•È°ÍÑ…Ñ”è¥Ñ•´¹ÍÑ…Ñ”°•áÁ¥É•ÍÐè¥Ñ•´¹•áÁ¥É•ÍÐô¤¤°(€ôì)ô()½¹ÍÐ¡…¹‘±•ÉÌ€ôì(€…ÕÑ¡½¹Ñ•áÐ°(€Á½ÉÑ…±ÁÁ±¥…Ñ¥½¹Í1¥ÍÐ°(€Á½ÉÑ…±ÁÁ±¥…Ñ¥½¹1…Õ¹ °(€Á½ÉÑ…±M¥¹=ÕÐ°(€Á½ÉÑ…±¹Ñ¥Ñ±•µ•¹ÑMå¹É½¸°(€½±±…‰½É…Ñ¥½¹1¥ÍÐ°(€½±±…‰½É…Ñ¥½¹•Ñ…¥°°(€½±±…‰½É…Ñ¥½¹É•…Ñ”°(€½±±…‰½É…Ñ¥½¹UÁ‘…Ñ”°(€½±±…‰½É…Ñ¥½¹	Õ±­UÁ‘…Ñ”°(€½±±…‰½É…Ñ¥½¹½±±½Ý•ÉQ½±”°(€½±±…‰½É…Ñ¥½¹•Á•¹‘•¹åM…Ù”°(€½±±…‰½É…Ñ¥½¹•Á•¹‘•¹åI•µ½Ù”°(€½±±…‰½É…Ñ¥½¹5¥±•ÍÑ½¹•M…Ù”°(€½±±…‰½É…Ñ¥½¹Q•µÁ±…Ñ•1¥ÍÐ°(€½±±…‰½É…Ñ¥½¹Q•µÁ±…Ñ•M…Ù”°(€½±±…‰½É…Ñ¥½¹É¡¥Ù”°(€½±±…‰½É…Ñ¥½¹½µµ•¹ÑM…Ù”°(€½±±…‰½É…Ñ¥½¹½µµ•¹Ñ•±•Ñ”°(€½±±…‰½É…Ñ¥½¹ÑÑ…¡µ•¹ÑAÉ•Á…É”°(€½±±…‰½É…Ñ¥½¹ÑÑ…¡µ•¹Ñ½µÁ±•Ñ”°(€½±±…‰½É…Ñ¥½¹ÑÑ…¡µ•¹ÑUÉ°°(€½±±…‰½É…Ñ¥½¹ÑÑ…¡µ•¹Ñ•±•Ñ”°(€½±±…‰½É…Ñ¥½¹9½Ñ¥™¥…Ñ¥½¹Í1¥ÍÐ°(€½±±…‰½É…Ñ¥½¹9½Ñ¥™¥…Ñ¥½¹ÍI•…°(€½±±…‰½É…Ñ¥½¹…¥±åÉ½¸°(€¥µÁÉ½Ù•µ•¹ÑÍ1¥ÍÐ°(€¥µÁÉ½Ù•µ•¹Ñ•Ñ…¥°°(€¥µÁÉ½Ù•µ•¹ÑÉ•…Ñ”°(€¥µÁÉ½Ù•µ•¹ÑAÉ½Á½Í”°(€¥µÁÉ½Ù•µ•¹Ñ•¥Í¥½¸°(€¥µÁÉ½Ù•µ•¹ÑÑÑ…¡µ•¹ÑAÉ•Á…É”°(€¥µÁÉ½Ù•µ•¹ÑÑÑ…¡µ•¹Ñ½µÁ±•Ñ”°(€¥µÁÉ½Ù•µ•¹ÑÑÑ…¡µ•¹ÑUÉ°°(€¥µÁÉ½Ù•µ•¹ÑÑÑ…¡µ•¹Ñ•±•Ñ”°(€Ý½É­9½Ñ¥™¥…Ñ¥½¹Í1¥ÍÐ°(€Ý½É­9½Ñ¥™¥…Ñ¥½¹ÍI•…°(€Ý½É­9½Ñ¥™¥…Ñ¥½¹ÍMÑ…Ñ”°(€ÍåÍÑ•µÉÉ½ÉY•É¥™ä°(€Ý½É­½µµ¥Ñµ•¹ÑÍ1¥ÍÐ°(€¹…Ù¥…Ñ¥½¹AÉ•™•É•¹•Í•Ð°(€¹…Ù¥…Ñ¥½¹AÉ•™•É•¹•ÍM…Ù”°(€¹…Ù¥…Ñ¥½¹AÉ•™•É•¹•ÍI•Í•Ð°(€Ý½É­ÍÁ…•AÉ•™•É•¹•Í•Ð°(€Ý½É­ÍÁ…•AÉ•™•É•¹•ÍM…Ù”°(€•µ…¥±I½ÕÑ•É1¥ÍÐ°(€•µ…¥±I½ÕÑ•É	…­É½Õ¹‘Må¹Œ°(€•µ…¥±I½ÕÑ•É1•…Ù”°(€•µ…¥±I½ÕÑ•É1•…Ù•M…Ù”°(€•µ…¥±I½ÕÑ•É•Ñ…¥°°(€•µ…¥±I½ÕÑ•É¥É•Ñ½Éä°(€•µ…¥±I½ÕÑ•É¥É•Ñ½ÉåI•™É•Í °(€•µ…¥±I½ÕÑ•ÉAÉ•Í•ÑÌ°(€•µ…¥±I½ÕÑ•ÉÑ¥½¸°(€•µ…¥±I½ÕÑ•ÉÑ¥½¹MÑ…ÑÕÌ°(€•µ…¥±I½ÕÑ•ÉU¹‘¼°(€•µ…¥±I½ÕÑ•ÉI•ÑÉä°(€•µ…¥±I½ÕÑ•É¥±¥¹I•ÑÉä°(€•µ…¥±I½ÕÑ•ÉÑÑ…¡µ•¹ÑUÉ°°(€•µ…¥±I½ÕÑ•ÉÑÑ…¡µ•¹ÑQ•áÐ°(€•µ…¥±I½ÕÑ•É!•…±Ñ °(€•µ…¥±I½ÕÑ•É‘Ù¥Í½È°(€•µ…¥±I½ÕÑ•ÉM•ÑÑ¥¹Ì°(€•µ…¥±I½ÕÑ•ÉM•ÑÑ¥¹ÍM…Ù”°(€•µ…¥±I½ÕÑ•É=ÕÑ‰½à°(€•µ…¥±I½ÕÑ•É•±Ñ„°(€•µ…¥±I½ÕÑ•ÉMÕ‰ÍÉ¥ÁÑ¥½¸°(€•µ…¥±I½ÕÑ•É5…¥¹Ñ•¹…¹•É½¸°(€¡•‘••Í­¹Ñ¥Ñä°(€¡•‘•5…É­•ÑÌ°(€µ…É­•ÑAÕ±Í•M¹…ÁÍ¡½Ð°(€µ…É­•Ñ%¹Ñ•±±¥•¹•	É¥•˜°(€µ…É­•Ñ%¹Ñ•±±¥•¹•ÕÉÙ”°(€µ…É­•Ñ%¹Ñ•±±¥•¹•Y…±Õ…Ñ¥½¸°(€µ…É­•Ñ½ÉÝ…É‘…±±‰…­M…Ù”°(€µ…É­•Ñ%¹Ñ•±±¥•¹•±•ÉÑIÕ±•Í•Ð°(€µ…É­•Ñ%¹Ñ•±±¥•¹•±•ÉÑIÕ±•ÍM…Ù”°(€µ…É­•Ñ%¹Ñ•±±¥•¹•ÕÉÙ•ÕÑ½Ù•ÉM…Ù”°(€µ…É­•Ñ%¹Ñ•±±¥•¹•É¡¥Ù•I•Á±…ä°(€¡•‘••Í­A…ÉÍ•5½ÁÌ°(€¡•‘••Í­•¹•É…Ñ•%¹Ù½¥”°(€¡•‘••Í­M…Ù•%¹Ù½¥•A‘˜°(€¡•‘••Í­M•¹‘%¹Ù½¥•µ…¥°°(€¡•‘••Í­M™ÍI•Á½ÉÐ°(€¡•‘••Í­M™Í¥±”°(€¡•‘••Í­M™ÍM•¹°(€¡•‘••Í­M…±•Í™½É•AÕÍ °(€¡•‘••Í­M…±•Í™½É•AÉ•Ù¥•Ü°(€¡•‘••Í­M…±•Í™½É•5…ÁÁ¥¹œ°(€¡•‘••Í­ÍÍ¥ÍÑ…¹Ð°(€¡•‘••Í­ÍÍ¥ÍÑ…¹ÑM•ÑÑ¥¹Ì°(€¡•‘••Í­5…¥¹Ñ•¹…¹•É½¸°(€µ…É­•ÑI•Á½ÉÑÉ¥Ù•Må¹É½¸°(€ÍÁ•¥…±Q•ÉµÍ]½É­ÍÁ…”°(€ÍÁ•¥…±Q•ÉµÍMÕµµ…Éå1¥ÍÐ°(€ÍÁ•¥…±Q•ÉµÍ=ÁÑ¥½¹Ì°(€ÍÁ•¥…±Q•Éµ•Ñ…¥°°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•	…¹¬°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•M¥µ¥±…È°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•‘¥ÑAÉ•Ù¥•Ü°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•±½‰…±AÕ‰±¥Í °(€ÍÁ•¥…±Q•Éµ•±•Ñ•AÉ•Ù¥•Ü°(€ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹%¹Ù•¹Ñ½Éä°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•É…™ÑM…Ù”°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•ÁÁÉ½Ù”°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•I•Ñ¥É”°(€ÍÁ•¥…±Q•Éµ±…ÕÍ••±•Ñ”°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•É…™Ñ¥Í…É°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹1¥ÍÐ°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹MÑ…ÉÐ°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹I•±¥¹¬°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹…¹•°°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•½¹Í½±¥‘…Ñ¥½¹½µÁ±•Ñ”°(€ÍÁ•¥…±Q•Éµ½µÁ½Í¥Ñ¥½¹M…Ù”°(€ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹AÉ•Ù¥•Ü°(€ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹AÉ•Ù¥•Ý±°°(€ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹M…Ù•±°°(€ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹M…Ù”°(€ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹Ñ¥Ù…Ñ”°(€ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹I½±±‰…¬°(€ÍÁ•¥…±Q•ÉµI•Ù¥Í¥½¹M…Ù”°(€ÍÁ•¥…±Q•ÉµI•Ù¥Í¥½¹½µµ¥Ð°(€ÍÁ•¥…±Q•ÉµI•Ù¥Í¥½¹ÁÁÉ½Ù”°(€ÍÁ•¥…±Q•ÉµI•Ù¥Í¥½¹I½±±‰…¬°(€ÍÁ•¥…±Q•Éµ5¥É…Ñ¥½¹	…Ñ¡1¥ÍÐ°(€ÍÁ•¥…±Q•ÉµÁÁÉ½Ù…±EÕ•Õ”°(€ÍÁ•¥…±Q•Éµ±…ÕÍ•¥É…™Ð°(€ÍÁ•¥…±Q•ÉµÍM…Ù”°(€ÍÁ•¥…±Q•ÉµÍ•±•Ñ”°(€ÍÁ•¥…±Q•ÉµIÕ±•M…Ù”°(€ÍÁ•¥…±Q•ÉµIÕ±••±•Ñ”°(€É½ÝÑ¡I•Á½ÉÑ¥¹1¥¹•Í1¥ÍÐ°(€É½ÝÑ¡I•Á½ÉÑ¥¹1¥¹•M…Ù”°(€É½ÝÑ¡I•Á½ÉÑ¥¹1¥¹•ÍM…Ù•	…Ñ °(€É½ÝÑ¡½…¡¥¹	½½ÑÍÑÉ…À°(€É½ÝÑ¡A±…¹M…Ù”°(€É½ÝÑ¡A±…¹±½Í•½ÕÐ°(€É½ÝÑ¡½…±M…Ù”°(€É½ÝÑ¡½…±MÕ‰µ¥Ð°(€É½ÝÑ¡½…±•¥Í¥½¸°(€É½ÝÑ¡½…±AÉ½É•ÍÍM…Ù”°(€É½ÝÑ¡½…±½µÁ±•Ñ¥½¸°(€É½ÝÑ¡½…±Ù¥‘•¹•=ÁÑ¥½¹Ì°(€É½ÝÑ¡½…±Ù¥‘•¹•M…Ù”°(€½…¡¥¹I•±…Ñ¥½¹Í¡¥Á%¹Ù¥Ñ”°(€½…¡¥¹I•±…Ñ¥½¹Í¡¥ÁI•ÍÁ½¹°(€½…¡¥¹I•±…Ñ¥½¹Í¡¥Á¹°(€½…¡¥¹M•ÍÍ¥½¹M…Ù”°(€½…¡¥¹M•ÍÍ¥½¹½¹Ñ•¹ÑM…Ù”°(€½…¡¥¹M•ÍÍ¥½¹½¹™¥É´°(€½…¡¥¹M•ÍÍ¥½¹…¹•°°(€½…¡¥¹Ñ¥½¹M…Ù”°(€½…¡¥¹Ñ¥½¹AÕ‰±¥Í °(€½…¡¥¹Ñ¥½¹AÉ½Á½Í…±I•ÍÁ½¹°(€É½ÝÑ¡ÑÑ…¡µ•¹ÑAÉ•Á…É”°(€É½ÝÑ¡ÑÑ…¡µ•¹Ñ½µÁ±•Ñ”°(€É½ÝÑ¡ÑÑ…¡µ•¹ÑUÉ°°(€É½ÝÑ¡µ…¥±AÉ•™•É•¹•ÍM…Ù”°(€½…¡¥¹…±•¹‘…ÉI•Í½±Ù”°(€½…¡¥¹…±•¹‘…ÉI•ÑÉä°(€É½ÝÑ¡½…¡¥¹…¥±åÉ½¸°(€Í…±•Í™½É•M¡•µ„°(€Í…±•Í™½É•=‰©•Ñ¥•±‘Ì°(€‘…Í¡‰½…É‘¥±Ñ•É=ÁÑ¥½¹Ì°(€Í…±•Í™½É•Õ±±M¡•µ„°(€Í…±•Í™½É•…Í¡‰½…É°(€Í…±•Í™½É•…Í¡‰½…É‘¥±Ñ•É•èÍ…±•Í™½É•…Í¡‰½…É‘¥±Ñ•É•‘½µÁ…Ñ¥‰¥±¥Ñä°(€‘…Í¡‰½…É‘MÕµµ…Éä°(€‘…Í¡‰½…É‘MÑ•µ1¥ÍÐ°(€‘…Í¡‰½…É‘¹…±åÑ¥Ì°(€‘…Í¡‰½…É‘½Õ¹Ñ%¹Í¥¡Ð°(€‘…Í¡‰½…É‘½Õ¹ÑÉ•‘¥Ñ¥É•Ñ½Éä°(€‘…Í¡‰½…É‘½Õ¹ÑÉ•‘¥ÑMÑ…Ñ•µ•¹Ð°(€‘…Í¡‰½…É‘É•‘¥Ñ½É•…ÍÑM•ÑÑ¥¹ÍM…Ù”°(€‘…Í¡‰½…É‘½Õ¹Ñ•ÉÁ…ÉÑåM•…É °(€‘…Í¡‰½…É‘½Õ¹ÑáÁ½ÍÕÉ•	…Ñ °(€‘…Í¡‰½…É‘¥M•…É °(€‘…Í¡‰½…É‘¥M•ÑÑ¥¹Í•Ð°(€‘…Í¡‰½…É‘¥M•ÑÑ¥¹ÍM…Ù”°(€Í…±•Í™½É•MÑ•µ•Ñ…¥°èÍ…±•Í™½É•MÑ•µ•Ñ…¥±Õ±°°(€Í…±•Í™½É•MÑ•µ½Õµ•¹ÑÌ°(€Õ¹½™™¥¥…±½µÁ•¹Í…Ñ¥½¹1¥ÍÐ°(€Õ¹½™™¥¥…±½µÁ•¹Í…Ñ¥½¹=ÁÑ¥½¹Ì°(€Õ¹½™™¥¥…±½µÁ•¹Í…Ñ¥½¹±…¥µÉ•…Ñ”°(€Õ¹½™™¥¥…±½µÁ•¹Í…Ñ¥½¹±…¥µÉ½ÕÁMÑ…ÑÕÌ°(€Õ¹½™™¥¥…±½µÁ•¹Í…Ñ¥½¹I•½Ù•ÉåÉ•…Ñ”°(€Õ¹½™™¥¥…±½µÁ•¹Í…Ñ¥½¹I•½Ù•Éå•±•Ñ”°(€•á•ÁÑ¥½¹I•Ù¥•Ý]½É­™±½Ý1¥ÍÐ°(€•á•ÁÑ¥½¹I•Ù¥•Ý]½É­™±½ÝM…Ù”°(€Í…±•Í™½É••ÍÉ¥‰•¡¥±‘É•¸°(€Í…±•Í™½É•Q½Á	Õå•ÉÌ°(€Í…±•Í™½É•	É½­•ÉI•¥ÍÑ•ÈèÍ…±•Í™½É•	É½­•ÉI•¥ÍÑ•ÉÕ±°°(€Í…±•Í™½É•	Õå•É%¹Ù½¥•ÍÕ”°(€‰Õå•É%¹Ù½¥•½±±•Ñ¥½¹1¥ÍÐ°(€‰Õå•É%¹Ù½¥•½±±•Ñ¥½¹M…Ù”°(€‰Õå•É%¹Ù½¥•½±±•Ñ¥½¹Ù•¹ÑÉ•…Ñ”°(€‰Õå•É%¹Ù½¥•A…åµ•¹Ñ‘Ù¥•M…Ù”°(€Á…åµ•¹Ñ½±±•Ñ¥½¹ÍI•½¹¥±”°(€Í¡¥Á•¹Ñ¡…É•Í1¥ÍÐ°(€Í¡¥Á•¹Ñ¡…É•Í•Ñ…¥°°(€Í¡¥Á•¹Ñ¡…É•Í=ÁÑ¥½¹Ì°(€Í¡¥Á•¹Ñ¡…É•ÍM…Ù•½¹™¥É´°(€Í¡¥Á•¹Ñ¡…É•Íµ=Ù•ÉÉ¥‘”°(€Í¡¥Á•¹Ñ¡…É•ÍA½ÍÑ%¹Ù½¥•I•Í½±Ù”°(€Í¡¥Á•¹Ñ¡…É•ÍMå¹Œ°(€Ù…É¥…‰±•¡…É•Í1¥ÍÐ°(€Ù…É¥…‰±•¡…É•Í•Ñ…¥°°(€Ù…É¥…‰±•¡…É•Í=ÁÑ¥½¹Ì°(€Ù…É¥…‰±•¡…É•ÍMÕÁÁ±¥•ÉY•É¥™ä°(€Ù…É¥…‰±•¡…É•Í	Õå•É½¹™¥É´°(€Ù…É¥…‰±•¡…É•Íµ=Ù•ÉÉ¥‘”°(€Ù…É¥…‰±•¡…É•ÍA½ÍÑ%¹Ù½¥•I•Í½±Ù”°(€Ù…É¥…‰±•¡…É•ÍMå¹Œ°(€‰Õå•É%¹Ù½¥•A½ÍÑ¥¹I•µ¥¹‘•É=Ù•ÉÉ¥‘•M…Ù”°(€Á…åµ•¹Ñ½±±•Ñ¥½¹ÍI•½¹¥±•É½¸°(€‰Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹Í•Ð°(€‰Õå•É%¹Ù½¥•µ…¥±M•ÑÑ¥¹ÍM…Ù”°(€‰Õå•É%¹Ù½¥•I•µ¥¹‘•ÉIÕ±•Í1¥ÍÐ°(€‰Õå•É%¹Ù½¥•I•µ¥¹‘•ÉIÕ±•M…Ù”°(€‰Õå•É%¹Ù½¥•I•µ¥¹‘•ÉIÕ±•I•µ½Ù”°(€‰Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•ÉAÉ•Á…É”°(€‰Õå•É%¹Ù½¥•A…åµ•¹ÑI•µ¥¹‘•ÉM•¹°(€½ÕÑÍÑ…¹‘¥¹	Õå•É%¹Ù½¥•Íµ…¥±I•Á½ÉÐ°(€½ÕÑÍÑ…¹‘¥¹	Õå•É%¹Ù½¥•Íµ…¥±É½¸°(€¥¹½µ¥¹A…åµ•¹ÑÍ1¥ÍÐ°(€¥¹½µ¥¹A…åµ•¹Ñµ…¥±M•ÑÑ¥¹Í•Ð°(€¥¹½µ¥¹A…åµ•¹Ñµ…¥±M•ÑÑ¥¹ÍM…Ù”°(€¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑM•ÑÑ¥¹Í•Ð°(€¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑM•ÑÑ¥¹ÍM…Ù”°(€¥¹½µ¥¹A…åµ•¹Ñµ…¥±I•Á½ÉÐ°(€¥¹½µ¥¹A…åµ•¹Ñ%¹Ñ•É•ÍÑ%¹Ù½¥•I•ÅÕ•ÍÐ°(€¥¹½µ¥¹A…åµ•¹ÑM•ÑÑ¥¹Í•Ð°(€¥¹½µ¥¹A…åµ•¹ÑM•ÑÑ¥¹ÍM…Ù”°(€¥¹½µ¥¹A…åµ•¹Ñ±±½…Ñ¥½¹½¹™¥É´°(€…Í¡™±½Ý½É•…ÍÐ°(€…Í¡™±½Ý	Õå•ÉA…åµ•¹ÑA•É™½Éµ…¹”°(€…Í¡™±½ÝM•ÑÑ¥¹Í•Ð°(€…Í¡™±½ÝM•ÑÑ¥¹ÍM…Ù”°(€…Í¡™±½Ý!½±¥‘…å…±•¹‘…È°(€Í…±•Í™½É•¥ÍÁÕÑ•MÑ•µÌ°(€‘¥ÍÁÕÑ•	•Ñ…1¥ÍÐ°(€‘¥ÍÁÕÑ•	•Ñ…M…Ù•É…™Ð°(€‘¥ÍÁÕÑ•	•Ñ…MÕ‰µ¥ÑÁÁÉ½Ù…°°(€‘¥ÍÁÕÑ•	•Ñ…ÁÁÉ½Ù”°(€‘¥ÍÁÕÑ•	•Ñ…I•©•Ð°(€‘¥ÍÁÕÑ•	•Ñ…5…É­á•ÕÑ•°(€‘¥ÍÁÕÑ•	•Ñ…±½Í”°(€‘¥ÍÁÕÑ•]½É­™±½Ý1¥ÍÐè‘¥ÍÁÕÑ•	•Ñ…1¥ÍÐ°(€‘¥ÍÁÕÑ•]½É­™±½ÝM…Ù•É…™Ðè‘¥ÍÁÕÑ•	•Ñ…M…Ù•É…™Ð°(€‘¥ÍÁÕÑ•]½É­™±½ÝMÕ‰µ¥ÑÁÁÉ½Ù…°è‘¥ÍÁÕÑ•	•Ñ…MÕ‰µ¥ÑÁÁÉ½Ù…°°(€‘¥ÍÁÕÑ•]½É­™±½ÝÁÁÉ½Ù”è‘¥ÍÁÕÑ•	•Ñ…ÁÁÉ½Ù”°(€‘¥ÍÁÕÑ•]½É­™±½ÝI•©•Ðè‘¥ÍÁÕÑ•	•Ñ…I•©•Ð°(€‘¥ÍÁÕÑ•]½É­™±½Ý½Õ¹Ñ¥¹UÁ‘…Ñ”°(€‘¥ÍÁÕÑ•]½É­™±½ÝMÕÁÁ±¥•É%¹ÍÑÉÕÑ¥½¹UÁ‘…Ñ”°(€‘¥ÍÁÕÑ•]½É­™±½ÝMÕÁÁ±¥•É=™™Í•Ñ=ÁÑ¥½¹Ì°(€‘¥ÍÁÕÑ•]½É­™±½ÝMÕÁÁ±¥•Éµ½Õ¹Ñµ•¹°(€‘¥ÍÁÕÑ•]½É­™±½ÝUÁ±½…‘½Õµ•¹Ð°(€‘¥ÍÁÕÑ•]½É­™±½Ý½Õµ•¹ÑÌ°(€‘¥ÍÁÕÑ•]½É­™±½Ý5…É­á•ÕÑ•è‘¥ÍÁÕÑ•	•Ñ…5…É­á•ÕÑ•°(€‘¥ÍÁÕÑ•]½É­™±½Ý±½Í”è‘¥ÍÁÕÑ•	•Ñ…±½Í”°(€‘¥ÍÁÕÑ•]½É­™±½Ý½µÁ•¹Í…Ñ¥½¹±…¥µÌ°(€‘¥ÍÁÕÑ•]½É­™±½Ý½µÁ•¹Í…Ñ¥½¹±…¥µ1¥¹¬°(€‘¥ÍÁÕÑ•]½É­™±½Ý•ÁÑáÑ•É¹…±±½ÍÕÉ”°(€ÍÑ•µA¹°èÍÑ•µA¹±Õ±°°(€™É…¹­™ÕÉÑ•ÉUÍ‘¹åI…Ñ”°(€‰É½­•É½µµ¥ÍÍ¥½¹M•ÑÑ¥¹Í•Ð°(€‰É½­•É½µµ¥ÍÍ¥½¹M•ÑÑ¥¹ÍM…Ù”°(€É•Á½ÉÑáÁ½ÉÑÉ•…Ñ”°(€É•Á½ÉÑáÁ½ÉÑÍ1¥ÍÐ°(€É•Á½ÉÑáÁ½ÉÑI•¹…µ”°(€É•Á½ÉÑáÁ½ÉÑ•±•Ñ”°(€É•Á½ÉÑáÁ½ÉÑ½Ý¹±½…°(€‰Õå•ÉÍ‘µ¥¹¥ÍÑÉ…Ñ½É1¥ÍÐ°(€‰Õå•ÉÍ‘µ¥¹¥ÍÑÉ…Ñ½ÉM…Ù”°(€…½Õ¹Ñ5…¹…•ÉÍ1¥ÍÐ°(€…½Õ¹Ñ5…¹…•ÉÍM…Ù”°(€…½Õ¹Ñ5…¹…•ÉÍM…Ù•9½Ñ”°(€…½Õ¹Ñ5…¹…•ÉÍI•ÑÉåMå¹Œ°(€…½Õ¹ÑA¥¥É•Ñ½Éå1¥ÍÐ°(€…½Õ¹ÑA¥½Õ¹Ñ=ÁÑ¥½¹Ì°(€…½Õ¹ÑA¥QÉ…‘•É=ÁÑ¥½¹Ì°(€…½Õ¹ÑA¥¥É•Ñ½Éå•Ñ…¥°°(€…½Õ¹ÑA¥¥É•Ñ½ÉåM…Ù”°(€…½Õ¹ÑA¥¥É•Ñ½Éå%µÁ½ÉÐ°(€…½Õ¹ÑA¥I½Ý½±½ÉÍM…Ù”°(€•µ…¥±M•¹‘•ÉMÑ…ÑÕÌ°(€•µ…¥±M•¹‘•É5…¥±‰½áM…Ù”°(€•µ…¥±M•¹‘•ÉI½ÕÑ•M…Ù”°(€ÍåÍÑ•µ!•…±Ñ °(€‰…­‰½¹•	É¥‘•%‘•¹Ñ¥Ñä°(€‰…­‰½¹•QÉ…‘•AÉ½©•Ñ¥½¸°(€‰…­‰½¹•¥¹…¹•!…¹‘½™™Ì°(€‰…­‰½¹•¥¹…¹•!…¹‘½™™•Ñ…¥°°(€…‘µ¥¹UÍ•ÉÍ1¥ÍÐ°(€…‘µ¥¹Õ‘¥Ñ1½Ì°(€…‘µ¥¹UÍ•ÉM…Ù”°(€…‘µ¥¹UÍ•É•±•Ñ”°(€…‘µ¥¹A½ÉÑ…±•ÍÍM…Ù”°(€…‘µ¥¹A½ÉÑ…±•ÍÍI•ÑÉä°(€…‘µ¥¹A½ÉÑ…±ÁÁ±¥…Ñ¥½¹Í!•…±Ñ °(€…‘µ¥¹UÍ•ÉQåÁ•M…Ù”°(€…‘µ¥¹UÍ•ÉQåÁ••±•Ñ”°(€…‘µ¥¹½ÍUÁ‘…Ñ•Í1¥ÍÐ°(€…‘µ¥¹½ÍUÁ‘…Ñ•ÍMå¹Œ°(€…‘µ¥¹½ÍUÁ‘…Ñ•%Ñ•µM…Ù”°(€…‘µ¥¹½ÍUÁ‘…Ñ•	…Ñ¡M…Ù”°(€…‘µ¥¹½ÍUÁ‘…Ñ•	…Ñ¡…¹•°°(€…‘µ¥¹½ÍUÁ‘…Ñ•%Ñ•µM­¥À°(€…‘µ¥¹½ÍUÁ‘…Ñ•%Ñ•µI•ÍÑ½É”°(€…‘µ¥¹½ÍUÁ‘…Ñ•	…Ñ¡M•¹°(€…‘µ¥¹½ÍUÁ‘…Ñ••±¥Ù•ÉåI•ÑÉä°(€Õ¹¥Ù•ÉÍ…±Õ‘¥ÑQÉ…¥°°)ôì()½¹ÍÐ¡…¹‘±•ÉÍ]¥Ñ¡½ÕÑ•ÍÍA½±¥ä€ô=‰©•Ð¹­•åÌ¡¡…¹‘±•ÉÌ¤¹™¥±Ñ•È ¡¡…¹‘±•É9…µ”¤€ôø€…¡…¹‘±•ÉA½±¥å½È¡!91I}A=1%e}I%MQId°¡…¹‘±•É9…µ”¤¤ì)¥˜€¡¡…¹‘±•ÉÍ]¥Ñ¡½ÕÑ•ÍÍA½±¥ä¹±•¹Ñ ¤ì(€Ñ¡É½Ü¹•ÜÉÉ½È¡=L¡…¹‘±•È…•ÍÌÁ½±¥ä¥Ìµ¥ÍÍ¥¹œ™½Èè€‘í¡…¹‘±•ÉÍ]¥Ñ¡½ÕÑ•ÍÍA½±¥ä¹©½¥¸ œ°€œ¥õ€¤ì)ô()™Õ¹Ñ¥½¸ÁÕ‰±¥Á¥ÉÉ½ÉA…å±½…¡•ÉÉ½È°ÍÑ…ÑÕÌ°É•ÅÕ•ÍÑ%¤ì(€½¹ÍÐ•áÁ½Í•5•ÍÍ…”€ôÍÑ…ÑÕÌ€ð€ÔÀÀñð•ÉÉ½Èü¹•áÁ½Í”€ôôôÑÉÕ”ì(€½¹ÍÐ½‘•Q½­•¸€ôMÑÉ¥¹œ¡•ÉÉ½Èü¹½‘”ñð€¡ÍÑ…ÑÕÌ€øô€ÔÀÀ€ü€=M}%9QI91}II=Hœ€è€=M}IEUMQ}I)Qœ¤¤(€€€€¹ÑÉ¥´ ¤(€€€€¹Ñ½UÁÁ•É…Í” ¤(€€€€¹É•Á±…” ½myµhÀ´å}t½œ°€|œ¤(€€€€¹Í±¥” À°€ÄÀÀ¤ñð€=M}%9QI91}II=Hœì(€½¹ÍÐµ•ÍÍ…”€ô•áÁ½Í•5•ÍÍ…”(€€€€üMÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð€Q¡”=LÉ•ÅÕ•ÍÐ½Õ±¹½Ð‰”½µÁ±•Ñ•¸œ¤(€€€€è€=L½Õ±¹½Ð½µÁ±•Ñ”Ñ¡¥Ì½Á•É…Ñ¥½¸¸UÍ”Ñ¡”É•ÅÕ•ÍÐÉ•™•É•¹”Ý¡•¸É•Á½ÉÑ¥¹œÑ¡”ÁÉ½‰±•´¸œì(€½¹ÍÐ½¹™±¥Ñ•Ñ…¥±Ì€ôÍÑ…ÑÕÌ€ôôô€ÐÀä€˜˜•ÉÉ½Èü¹‘•Ñ…¥±Ì€„ôôÕ¹‘•™¥¹•(€€€€ü)M=8¹Á…ÉÍ”¡)M=8¹ÍÑÉ¥¹¥™ä¡•ÉÉ½È¹‘•Ñ…¥±Ì¤¤(€€€€èÕ¹‘•™¥¹•ì(€É•ÑÕÉ¸ì(€€€•ÉÉ½Èèµ•ÍÍ…”°(€€€µ•ÍÍ…”°(€€€½‘”è½‘•Q½­•¸°(€€€É•ÅÕ•ÍÑ%°(€€€€¸¸¸¡½¹™±¥Ñ•Ñ…¥±Ì€„ôôÕ¹‘•™¥¹•€üì‘•Ñ…¥±Ìè½¹™±¥Ñ•Ñ…¥±Ìô€èíô¤°(€€€€¸¸¸¡ÍÑ…ÑÕÌ€ôôô€ÐÀä€˜˜•ÉÉ½Èü¹‘•Ñ…¥±Ìü¹ÕÉÉ•¹Ð€„ôôÕ¹‘•™¥¹•€üìÕÉÉ•¹Ðè•ÉÉ½È¹‘•Ñ…¥±Ì¹ÕÉÉ•¹Ðô€èíô¤°(€ôì)ô()•áÁ½ÉÐ‘•™…Õ±Ð…Íå¹Œ™Õ¹Ñ¥½¸¡…¹‘±•È¡É•Ä°É•Ì¤ì(€½¹ÍÐÕÉ°€ô¹•ÜUI0¡É•Ä¹ÕÉ°°€¡ÑÑÀè¼½±½…±¡½ÍÐœ¤ì(€½¹ÍÐ¹…µ”€ôÕÉ°¹Á…Ñ¡¹…µ”¹ÍÁ±¥Ð œ¼œ¤¹Á½À ¤ì(€½¹ÍÐÉ•ÅÕ•ÍÑ%€ôÉ•ÅÕ•ÍÑ%‘É½´¡É•Ä¤ì(€É•ÑÕÉ¸ÉÕ¹]¥Ñ¡I•ÅÕ•ÍÑQ•±•µ•ÑÉä (€€€ì(€€€€€¡…¹‘±•Èè¹…µ”°(€€€€€É•ÅÕ•ÍÑ%°(€€€ô°(€€€…Íå¹Œ€ ¤€ôøì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐ¡…¹‘±•ÉA½±¥ä€ô¡…¹‘±•ÉA½±¥å½È¡!91I}A=1%e}I%MQId°¹…µ”¤ì(€€€€€€€¥˜€¡¡…¹‘±•ÉA½±¥ä€˜˜ÑåÁ•½˜É•Ìü¹Í•Ñ!•…‘•È€ôôô€™Õ¹Ñ¥½¸œ¤ì(€€€€€€€€€É•Ì¹Í•Ñ!•…‘•È `µ=Lµ!…¹‘±•Èµ5ÕÑ…Ñ¥½¸œ°¡…¹‘±•ÉA½±¥ä¹µÕÑ…Ñ¥½¸€ü€œÄœ€è€œÀœ¤ì(€€€€€€€€€É•Ì¹Í•Ñ!•…‘•È `µ=LµáÑ•É¹…°µÑ¥½¸œ°¡…¹‘±•ÉA½±¥ä¹•áÑ•É¹…±Ñ¥½¸€ü€œÄœ€è€œÀœ¤ì(€€€€€€€ô(€€€€€€€¥˜€¡¹…µ”€ôôô€Í…±•Í™½É•½Õµ•¹Ñ½Ý¹±½…œ¤ì(€€€€€€€€€…Ý…¥ÐÉ•ÅÕ¥É•!…¹‘±•É•ÍÌ¡¹…µ”°É•Ä¤ì(€€€€€€€€€É•ÑÕÉ¸…Ý…¥ÐÍ…±•Í™½É•½Õµ•¹Ñ½Ý¹±½…¡É•Ä°É•Ì¤ì(€€€€€€€ô(€€€€€€€¥˜€¡¹…µ”€ôôô€‘…Í¡‰½…É‘½Õ¹Ñ%¹Í¥¡ÑáÁ½ÉÐœ¤ì(€€€€€€€€€½¹ÍÐ…•ÍÍ½¹Ñ•áÐ€ô…Ý…¥ÐÉ•ÅÕ¥É•!…¹‘±•É•ÍÌ¡¹…µ”°É•Ä¤ì(€€€€€€€€€½¹ÍÐ‰½‘ä€ô…Ý…¥ÐÉ•…‘	½‘ä¡É•Ä¤ì(€€€€€€€€€É•ÑÕÉ¸…Ý…¥Ð‘…Í¡‰½…É‘½Õ¹Ñ%¹Í¥¡ÑáÁ½ÉÐ¡‰½‘ä°É•Ä°É•Ì°…•ÍÍ½¹Ñ•áÐ¤ì(€€€€€€€ô(€€€€€€€¥˜€¡¹…µ”€ôôô€ÍÁ•¥…±Q•ÉµÍA‘™áÁ½ÉÐœñð¹…µ”€ôôô€ÍÁ•¥…±Q•ÉµÍ½Õµ•¹ÑáÁ½ÉÐœ¤ì(€€€€€€€€€½¹ÍÐ…•ÍÍ½¹Ñ•áÐ€ô…Ý…¥ÐÉ•ÅÕ¥É•!…¹‘±•É•ÍÌ¡¹…µ”°É•Ä¤ì(€€€€€€€€€½¹ÍÐ‰½‘ä€ô…Ý…¥ÐÉ•…‘	½‘ä¡É•Ä¤ì(€€€€€€€€€É•ÑÕÉ¸¹…µ”€ôôô€ÍÁ•¥…±Q•ÉµÍA‘™áÁ½ÉÐœ(€€€€€€€€€€€€ü…Ý…¥ÐÍÁ•¥…±Q•ÉµÍA‘™áÁ½ÉÐ¡‰½‘ä°É•Ä°É•Ì°…•ÍÍ½¹Ñ•áÐ¤(€€€€€€€€€€€€è…Ý…¥ÐÍÁ•¥…±Q•ÉµÍ½Õµ•¹ÑáÁ½ÉÐ¡‰½‘ä°É•Ä°É•Ì°…•ÍÍ½¹Ñ•áÐ¤ì(€€€€€€€ô(€€€€€€€½¹ÍÐ™¸€ô¡…¹‘±•ÉÍm¹…µ•tì(€€€€€€€¥˜€ …™¸¤É•ÑÕÉ¸Í•¹‘)Í½¸¡É•Ì°ì•ÉÉ½ÈèU¹­¹½Ý¸™Õ¹Ñ¥½¸è€‘í¹…µ•õ€ô°€ÐÀÐ¤ì(€€€€€€€½¹ÍÐ…•ÍÍ½¹Ñ•áÐ€ô…Ý…¥ÐÉ•ÅÕ¥É•!…¹‘±•É•ÍÌ¡¹…µ”°É•Ä¤ì(€€€€€€€½¹ÍÐ‰½‘ä€ô…Ý…¥ÐÉ•…‘	½‘ä¡É•Ä¤ì(€€€€€€€½¹ÍÐ‘…Ñ„€ô…Ý…¥Ð™¸¡‰½‘ä°É•Ä°…•ÍÍ½¹Ñ•áÐ¤ì(€€€€€€€É•ÑÕÉ¸Í•¹‘)Í½¸¡É•Ì°‘…Ñ„¤ì(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€½¹ÍÐÍÑ…ÑÕÌ€ô•ÉÉ½È¹ÍÑ…ÑÕÌñð•ÉÉ½È¹ÍÑ…ÑÕÍ½‘”ñð€ÔÀÀì(€€€€€€€É•½É‘I•ÅÕ•ÍÑ…¥±ÕÉ”¡•ÉÉ½È°ÍÑ…ÑÕÌ¤ì(€€€€€€€¥˜€¡Í¡½Õ±‘9½Ñ¥™åMåÍÑ•µÉÉ½È¡ÍÑ…ÑÕÌ¤¤ì(€€€€€€€€€ÑÉäì(€€€€€€€€€€€…Ý…¥ÐÉ•Á½ÉÑMåÍÑ•µÉÉ½È¡Í…™•MÕÁ…‰…Í•‘µ¥¹±¥•¹Ð ¤°ì(€€€€€€€€€€€€€¡…¹‘±•Èè¹…µ”°(€€€€€€€€€€€€€•ÉÉ½È°(€€€€€€€€€€€€€ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€É•ÅÕ•ÍÑ%°(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô…Ñ €¡¹½Ñ¥™¥…Ñ¥½¹ÉÉ½È¤ì(€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È mÍåÍÑ•´µ•ÉÉ½Èµ¹½Ñ¥™¥…Ñ¥½¹tÉ•½É‘¥¹œ™…¥±•œ°ì(€€€€€€€€€€€€€¡…¹‘±•Èè¹…µ”°(€€€€€€€€€€€€€µ•ÍÍ…”è¹½Ñ¥™¥…Ñ¥½¹ÉÉ½È¹µ•ÍÍ…”°(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€€€É•ÑÕÉ¸Í•¹‘)Í½¸¡É•Ì°ÁÕ‰±¥Á¥ÉÉ½ÉA…å±½…¡•ÉÉ½È°ÍÑ…ÑÕÌ°É•ÅÕ•ÍÑ%¤°ÍÑ…ÑÕÌ¤ì(€€€€€ô™¥¹…±±äì(€€€€€€€±½I•ÅÕ•ÍÑQ•±•µ•ÑÉä¡É•Ì¹ÍÑ…ÑÕÍ½‘”ñð€ÔÀÀ¤ì(€€€€€ô(€€€ô°(€€¤ì)ô