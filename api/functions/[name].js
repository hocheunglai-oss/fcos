import { chunkIds, cleanRecord, getApiVersion, getInstanceUrl, salesforceAuthMode, salesforceConfiguredAuthModes, sendJson, sfCompositeQueries, sfDownload, sfQuery, sfRequest } from '../_salesforce.js';
import { disputeWorkflowDirectionLabel, disputeWorkflowEditableFilename, disputeWorkflowFileExtension, disputeWorkflowHongKongDateToken } from '../_disputeDocuments.js';
import { buildDisputePartyRegistry, disputeSalesforceIdKey, findDisputeParty, resolveExtraCostSupplierLookup, resolveOriginalSupplierLookup } from '../_disputeParties.js';
import { disputeQueueExtraCostProductName } from '../_disputeQueue.js';
import { calculatedBuyerPayTermDate } from '../_buyerInvoiceDates.js';
import { isFinalBuyerInvoice, resolveBuyerFinancialAmount } from '../_buyerFinancialAmount.js';
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
import { completePaymentReminderBatch, completePaymentReminderOperation, mapPaymentReminderBatches, paymentReminderBatchHash, paymentReminderDeliveryUncertain, paymentReminderPreviewSecret, paymentReminderRequestHash, repairPaymentReminderTimelines, reservePaymentReminderBatch, reservePaymentReminderOperation, savePaymentReminderTimeline, signPaymentReminderPreview, verifyPaymentReminderPreview } from '../_paymentReminderOperations.js';
import { accountNameKey, buildAccountManagerRows, groupEligibleSalesforceAccounts, managerDisplayText, normalizeAccountManagerUserIds } from '../_accountManagers.js';
import { ACCOUNT_PIC_MAX_CSV_BYTES, accountPicDirectoryProjection, accountPicFlexibleDirectoryProjection, accountPicFlexiblePayloadHash, accountPicPayloadHash, accountPicRowColorPayloadHash, normalizeAccountPicGrid, normalizeAccountPicRows, parseAccountPicCsv, validAccountPicAccountId } from '../_accountPicDirectories.js';
import { normalizeAccountPicRowColorRules } from '../../src/lib/accountPicRowColors.js';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { createHash } from 'node:crypto';
import { externalActionGates, isExternalActionEnabled, requireExternalActionGate } from '../_externalActionGates.js';
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
import { checkPortalApplicationsHealth, launchPortalApplication, listPortalApplicationsForUser, portalAdminModel, preparePortalUserDeletion, processPortalOutbox, reconcilePortalEntitlementsForProfile, restorePortalUserAfterFailedDeletion, retryPortalAccessSync, revokePortalSessions, savePortalExplicitAccess, syncPortalEntitlement } from '../_portal.js';
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
  getVariableChargeDetail, getVariableChargeSettings,
  assignVariableChargeSides,
  confirmVariableChargeSides,
  confirmVariableChargeBuyer,
  listShipAgentCharges,
  listVariableCharges,
  overrideShipAgentChargeAssignment,
  overrideVariableChargeAssignment,
  resolveShipAgentPostInvoiceChange,
  resolveVariableChargePostInvoiceChange,
  saveAndConfirmShipAgentCharges,
  saveVariableChargeAnchorage, saveVariableChargeLightDues, saveVariableChargeSettings, saveVariableChargeVesselNrt,
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
import { analyzeMarketReportLibrary, loadMarketReportCatalogue } from '../_marketReportAnalysis.js';
import {
  applyMasterContractPrice as applyMasterContractPriceService,
  completeMasterContractEvidence as completeMasterContractEvidenceService,
  createMasterContractBatch as createMasterContractBatchService,
  createMasterContractVessel as createMasterContractVesselService,
  decideMasterContract as decideMasterContractService,
  getMasterContract as getMasterContractService,
  getMasterContractEvidenceUrl as getMasterContractEvidenceUrlService,
  listMasterContracts as listMasterContractsService,
  masterContractOptions as masterContractOptionsService,
  preflightMasterContract as preflightMasterContractService,
  prepareMasterContractEvidence as prepareMasterContractEvidenceService,
  reconcileMasterContracts as reconcileMasterContractsService,
  resolveMasterContractPrice as resolveMasterContractPriceService,
  saveMasterContract as saveMasterContractService,
  saveMasterContractFeature as saveMasterContractFeatureService,
} from '../_masterContracts.js';
import { loadMarketIntradayTimeline, previewMarketIntradaySnapshot, reconcileMarketIntradayDate, saveMarketIntradaySnapshot } from '../_marketIntraday.js';
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
import {
  xeroPortalConnectStart as xeroPortalConnectStartService,
  xeroPortalContactAutoCreateLatest as xeroPortalContactAutoCreateLatestService,
  xeroPortalContactAutoCreateRun as xeroPortalContactAutoCreateRunService,
  xeroPortalContactLifecycleApply as xeroPortalContactLifecycleApplyService,
  xeroPortalContactLifecycleLatest as xeroPortalContactLifecycleLatestService,
  xeroPortalContactLifecyclePreview as xeroPortalContactLifecyclePreviewService,
  xeroPortalContactLifecycleRun as xeroPortalContactLifecycleRunService,
  xeroPortalContactLifecycleStatus as xeroPortalContactLifecycleStatusService,
  xeroPortalDisconnect as xeroPortalDisconnectService,
  xeroPortalReceiptCreate as xeroPortalReceiptCreateService,
  xeroPortalReceiptFileUrl as xeroPortalReceiptFileUrlService,
  xeroPortalReceiptSync as xeroPortalReceiptSyncService,
  xeroPortalReceiptsList as xeroPortalReceiptsListService,
  xeroPortalStatus as xeroPortalStatusService,
} from '../_xeroPortal.js';
import {
  xeroFinancialMappingsGet as xeroFinancialMappingsGetService,
  xeroFinancialMappingsSave as xeroFinancialMappingsSaveService,
  xeroFinancialPaymentApply as xeroFinancialPaymentApplyService,
  xeroFinancialSyncApply as xeroFinancialSyncApplyService,
  xeroFinancialSyncPreview as xeroFinancialSyncPreviewService,
  xeroFinancialSyncRun as xeroFinancialSyncRunService,
} from '../_xeroFinancialSync.js';

export const config = {
  maxDuration: 300,
};

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
  { id: 'master_contracts', label: 'Master Contracts', path: '/master-contracts', sortOrder: 84 },
  { id: 'markets', label: 'Markets', path: '/markets', sortOrder: 86 },
  { id: 'special_terms', label: 'Special Terms', path: '/special-terms', sortOrder: 87 },
  { id: 'hedge_desk', label: 'Hedge Desk', path: '/hedge-desk', sortOrder: 88 },
  { id: 'xero_portal', label: 'Xero Portal', path: '/xero-portal', sortOrder: 89 },
  { id: 'email_router', label: 'Email Router', path: '/email-router', sortOrder: 91 },
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
  { id: 'xero_portal_manage', label: 'Manage Xero Portal', description: 'Connect Xero, create receipt draft bills, rename contacts, and archive unused contacts.' },
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
    master_contracts: true,
    hedge_desk: true,
    markets: true,
    special_terms: true,
    xero_portal: false,
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
    master_contracts: false,
    hedge_desk: true,
    markets: true,
    special_terms: true,
    xero_portal: true,
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
    master_contracts: false,
    hedge_desk: false,
    markets: true,
    special_terms: true,
    xero_portal: false,
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
    master_contracts: false,
    hedge_desk: false,
    markets: true,
    special_terms: true,
    xero_portal: false,
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
    master_contracts: false,
    hedge_desk: false,
    markets: true,
    special_terms: true,
    xero_portal: false,
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
    xero_portal_manage: false,
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
    xero_portal_manage: true,
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
    xero_portal_manage: false,
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
    xero_portal_manage: false,
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
    xero_portal_manage: false,
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
    .select('user_id,section_orders,hidden_item_ids,sidebar_mode,table_density,document_show_only_relevant,document_source_groups,appearance_mode,glass_intensity,workspace_preferences_initialized,revision,updated_at')
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

const AUTH_EXEMPT_HANDLERS = new Set(['outstandingBuyerInvoicesEmailCron', 'paymentCollectionsReconcileCron', 'portalEntitlementSyncCron', 'collaborationDailyCron', 'growthCoachingDailyCron', 'hedgeDeskMaintenanceCron', 'marketReportDriveSyncCron', 'masterContractReconcileCron', 'emailRouterMaintenanceCron']);

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
  xeroPortalStatus: ['xero_portal'],
  xeroPortalConnectStart: ['xero_portal'],
  xeroPortalDisconnect: ['xero_portal'],
  xeroPortalReceiptsList: ['xero_portal'],
  xeroPortalReceiptCreate: ['xero_portal'],
  xeroPortalReceiptSync: ['xero_portal'],
  xeroPortalReceiptFileUrl: ['xero_portal'],
  xeroPortalContactLifecycleStatus: ['xero_portal'],
  xeroPortalContactLifecycleLatest: ['xero_portal'],
  xeroPortalContactLifecycleRun: ['xero_portal'],
  xeroPortalContactLifecyclePreview: ['xero_portal'],
  xeroPortalContactLifecycleApply: ['xero_portal'],
  xeroPortalContactAutoCreateLatest: ['xero_portal'],
  xeroPortalContactAutoCreateRun: ['xero_portal'],
  xeroFinancialMappingsGet: ['xero_portal'],
  xeroFinancialMappingsSave: ['xero_portal'],
  xeroFinancialSyncPreview: ['xero_portal'],
  xeroFinancialSyncApply: ['xero_portal'],
  xeroFinancialSyncRun: ['xero_portal'],
  xeroFinancialPaymentApply: ['xero_portal'],
  hedgeDeskEntity: ['hedge_desk'],
  hedgeMarkets: ['markets'],
  marketPulseSnapshot: ['markets'],
  marketIntelligenceBrief: ['markets'],
  marketIntelligenceCurve: ['markets'],
  marketReportCatalogue: ['markets'],
  marketReportAnalysis: ['markets'],
  marketIntelligenceValuation: ['markets'],
  marketForwardFallbackSave: ['markets'],
  marketIntelligenceAlertRulesGet: ['markets'],
  marketIntelligenceAlertRulesSave: ['markets'],
  marketIntelligenceCurveCutoverSave: ['markets'],
  marketIntelligenceArchiveReplay: ['markets'],
  marketIntradaySnapshotPreview: ['markets'],
  marketIntradaySnapshotSave: ['markets'],
  marketIntradayTimeline: ['markets'],
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
  masterContractsList: ['master_contracts'],
  masterContractDetail: ['master_contracts'],
  masterContractSave: ['master_contracts'],
  masterContractDecision: ['master_contracts'],
  masterContractEvidencePrepare: ['master_contracts'],
  masterContractEvidenceComplete: ['master_contracts'],
  masterContractEvidenceUrl: ['master_contracts'],
  masterContractOptions: ['master_contracts'],
  masterContractVesselCreate: ['master_contracts'],
  masterContractPreflight: ['master_contracts'],
  masterContractBatchCreate: ['master_contracts'],
  masterContractPriceResolve: ['master_contracts'],
  masterContractPriceApply: ['master_contracts'],
  masterContractFeatureSave: ['master_contracts'],
  masterContractReconcile: ['master_contracts'],
  masterContractReconcileCron: [],
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
  variableChargesAnchorageSave: ['buyer_invoices', 'incoming_payments'], variableChargesVesselNrtSave: ['buyer_invoices', 'incoming_payments'], variableChargesLightDuesSave: ['buyer_invoices', 'incoming_payments'], variableChargesSettingsGet: ['buyer_invoices', 'incoming_payments'], variableChargesSettingsSave: ['buyer_invoices', 'incoming_payments'],
  variableChargesOptions: ['buyer_invoices', 'incoming_payments'],
  variableChargesSupplierVerify: ['buyer_invoices', 'incoming_payments'],
  variableChargesBuyerConfirm: ['buyer_invoices', 'incoming_payments'],
  variableChargesSideAssign: ['buyer_invoices', 'incoming_payments'],
  variableChargesSideConfirm: ['buyer_invoices', 'incoming_payments'],
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
      .join(' · ') || '—'
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
      target: row.target_email || row.target_user_id || '—',
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
      target: row.collaboration_items?.item_key || row.item_id || '—',
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
      target: row.fcos_improvement_tickets?.ticket_key || row.ticket_id || '—',
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
      target: row.application_id || row.target_user_id || '—',
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
      target: row.stem_id || '—',
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
      target: row.new_file_name || row.previous_file_name || row.report_export_id || '—',
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
      target: row.stem_name || row.stem_id || row.payment_name || row.payment_id || '—',
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
      target: row.stem_id || '—',
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
      target: row.run_key || row.schedule_time || '—',
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

  try {
    await preparePortalUserDeletion({
      client,
      profile: target,
      actor: profile,
      requestId: activePortalRequestId(),
    });

    const { error: deleteError } = await client.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;
  } catch (error) {
    let restoration = { required: target.active === true, restored: false };
    try {
      restoration = await restorePortalUserAfterFailedDeletion({ client, profile: target });
    } catch (restoreError) {
      console.error('[admin-user-delete] FCOS profile restoration failed.', {
        code: restoreError?.code || 'USER_DELETE_RESTORE_FAILED',
        targetUserId: target.id,
      });
    }
    await writeAdminAudit(client, profile, 'user_delete_failed', target.id, target.email, {
      error_code: error?.code || 'USER_DELETE_FAILED',
      profile_restoration_required: restoration.required,
      profile_restored: restoration.restored,
    });
    console.error('[admin-user-delete] User deletion failed.', {
      code: error?.code || 'USER_DELETE_FAILED',
      targetUserId: target.id,
      profileRestored: restoration.restored,
    });
    if (restoration.required && !restoration.restored) {
      throw appError(
        'User deletion failed and FCOS could not restore the account automatically.',
        503,
        'USER_DELETE_RESTORE_FAILED',
      );
    }
    throw appError(
      'User deletion could not be completed. FCOS restored the account; review connected application access before retrying.',
      409,
      'USER_DELETE_FAILED',
      { profileRestored: restoration.restored },
    );
  }

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
    appearanceMode: ['system', 'light', 'dark'].includes(row?.appearance_mode) ? row.appearance_mode : 'light',
    glassIntensity: ['clear', 'balanced', 'tinted'].includes(row?.glass_intensity) ? row.glass_intensity : 'balanced',
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
    .select('user_id,sidebar_mode,table_density,document_show_only_relevant,document_source_groups,appearance_mode,glass_intensity,workspace_preferences_initialized,revision,updated_at')
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
  const appearanceMode = ['system', 'light', 'dark'].includes(body.appearanceMode) ? body.appearanceMode : null;
  const glassIntensity = ['clear', 'balanced', 'tinted'].includes(body.glassIntensity) ? body.glassIntensity : null;
  if (!sidebarMode) throw appError('Choose a valid sidebar mode.', 400);
  if (!tableDensity) throw appError('Choose a valid table density.', 400);
  if (documentShowOnlyRelevant === null) throw appError('Choose a document filtering preference.', 400);
  if (documentShowOnlyRelevant && !documentSourceGroups.length) throw appError('Select at least one relevant document source.', 400);
  if (!appearanceMode) throw appError('Choose a valid appearance mode.', 400);
  if (!glassIntensity) throw appError('Choose a valid glass intensity.', 400);
  const expectedRevision = Number(body.expectedRevision ?? body.expected_revision ?? 0);
  const { data, error } = await client.rpc('save_user_workspace_preferences_v2', {
    p_user_id: profile.id,
    p_sidebar_mode: sidebarMode,
    p_table_density: tableDensity,
    p_document_show_only_relevant: documentShowOnlyRelevant,
    p_document_source_groups: documentSourceGroups,
    p_appearance_mode: appearanceMode,
    p_glass_intensity: glassIntensity,
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

async function variableChargesList(body, req, accessContext = null) { return listVariableCharges(body, await shipAgentChargesContext(req, accessContext)); }

async function variableChargesDetail(body, req, accessContext = null) { const context = await shipAgentChargesContext(req, accessContext); await requireShipAgentStemAccess(body, context); return getVariableChargeDetail(body, context); }

async function variableChargesAnchorageSave(body, req, accessContext = null) { const context = await shipAgentChargesContext(req, accessContext); await requireShipAgentStemAccess(body, context); return saveVariableChargeAnchorage(body, context); }

async function variableChargesVesselNrtSave(body, req, accessContext = null) { const context = await shipAgentChargesContext(req, accessContext); await requireShipAgentStemAccess(body, context); return saveVariableChargeVesselNrt(body, context); }

async function variableChargesLightDuesSave(body, req, accessContext = null) { const context = await shipAgentChargesContext(req, accessContext); await requireShipAgentStemAccess(body, context); return saveVariableChargeLightDues(body, context); }

async function variableChargesSettingsGet(body, req, accessContext = null) { return getVariableChargeSettings(body, await shipAgentChargesContext(req, accessContext)); }

async function variableChargesSettingsSave(body, req, accessContext = null) { return saveVariableChargeSettings(body, await shipAgentChargesContext(req, accessContext)); }

async function variableChargesOptions(body, req, accessContext = null) { return variableChargeOptions(body, await shipAgentChargesContext(req, accessContext)); }

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

async function variableChargesSideAssign(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await requireShipAgentStemAccess(body, context);
  if (!isSalesforceId(String(body?.supplierId || '').trim())) throw appError('A valid exact Supplier Account is required.', 400);
  return assignVariableChargeSides(body, context);
}

async function variableChargesSideConfirm(body, req, accessContext = null) {
  const context = await shipAgentChargesContext(req, accessContext);
  await requireShipAgentStemAccess(body, context);
  if (!isSalesforceId(String(body?.supplierId || '').trim())) throw appError('A valid exact Supplier Account is required.', 400);
  return confirmVariableChargeSides(body, context);
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
  return `${years.join(', ') || 'Current year'} · ${monthLabels.join(', ') || 'Current month'}`;
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
              label: [row.Name, row.Country__c].filter(Boolean).join(' · '),
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
            return { kind: 'group', id, value: id, name, clKey, accountIds: [...buyerIds].sort(), label: [name, clKey].filter(Boolean).join(' · ') };
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
            optionsById.set(id, { kind: 'account', id, value: id, name, clKey, label: [name, clKey].filter(Boolean).join(' · ') });
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
        optionsById.set(row.Account__c, { kind: 'account', id: row.Account__c, value: row.Account__c, name, clKey, label: [name, clKey].filter(Boolean).join(' · ') });
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
  const force = requestForcesRefresh(body, req);
  const [providerRows, connectionAttestation] = await Promise.all([
    Promise.all([
    salesforceHealthRow({ force }),
    cachedHealthCheck('special-terms-migration', 60, force, () => specialTermsMigrationHealthRow({ force })),
    supabaseHealthRow({ force }),
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

  const lookupRelatedGroups = await Promise.all([recordsLinkedToStemByLookup('Supplier_Invoice__c', actualStemId, 'Invoices from Suppliers', 'Supplier Invoice'), recordsLinkedToStemByLookup('Invoice__c', actualStemId, 'Invoices to Buyer', 'Buyer / Factoring Invoice'), recordsLinkedToStemByLookup('Nomination__c', actualStemId, 'Contracts and Compliance', 'Nomination'), recordsLinkedToStemByLookup('EmailMessage', actualStemId, 'Email', 'Email')]);
  for (const related of lookupRelatedGroups.flat()) {
    addRelatedRecord(relatedRecords, seenRecordIds, related);
  }

  const recordMap = Object.fromEntries(relatedRecords.map((related) => [related.id, related]));
  const relatedIds = relatedRecords.map((related) => related.id);
  let contentLinks = [];
  let attachments = [];
  for (const chunk of chunkIds(relatedIds, 150)) {
    const inList = chunk.map((id) => `'${id}'`).join(',');
    const [linksChunk, attachmentsChunk] = await Promise.all([queryRows(`SELECT ContentDocumentId, LinkedEntityId, ShareType, Visibility FROM ContentDocumentLink WHERE LinkedEntityId IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true }), queryRows(`SELECT Id, ParentId, Name, ContentType, BodyLength, CreatedDate, LastModifiedDate, Owner.Name FROM Attachment WHERE ParentId IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true })]);
    contentLinks = contentLinks.concat(linksChunk);
    attachments = attachments.concat(attachmentsChunk);
  }

  const contentDocumentIds = [...new Set(contentLinks.map((link) => link.ContentDocumentId).filter(isSalesforceId))];
  let contentDocuments = [];
  for (const chunk of chunkIds(contentDocumentIds, 150)) {
    const inList = chunk.map((id) => `'${id}'`).join(',');
    const rows = await queryRows(`SELECT Id, Title, FileType, ContentSize, CreatedDate, LastModifiedDate, LatestPublishedVersionId, Owner.Name FROM ContentDocument WHERE Id IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
    contentDocuments = contentDocuments.concat(rows);
  }
  const documentMap = Object.fromEntries(contentDocuments.map((document) => [document.Id, document]));

  const versionIds = [...new Set(contentDocuments.map((document) => document.LatestPublishedVersionId).filter(isSalesforceId))];
  let contentVersions = [];
  for (const chunk of chunkIds(versionIds, 150)) {
    const inList = chunk.map((id) => `'${id}'`).join(',');
    const rows = await queryRows(`SELECT Id, ContentDocumentId, Title, FileExtension, FileType, ContentSize, CreatedDate FROM ContentVersion WHERE Id IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
    contentVersions = contentVersions.concat(rows);
  }
  const versionByDocumentId = Object.fromEntries(contentVersions.map((version) => [version.ContentDocumentId, version]));

  const documents = [];
  const seenDocuments = new Set();
  for (const link of contentLinks) {
    const document = documentMap[link.ContentDocumentId];
    if (!document?.LatestPublishedVersionId) continue;
    const related = recordMap[link.LinkedEntityId] || {};
    const version = versionByDocumentId[document.Id];
    const fileName = buildContentVersionFilename(document, version);
    const key = `content-${document.Id}-${link.LinkedEntityId}`;
    if (seenDocuments.has(key)) continue;
    seenDocuments.add(key);
    documents.push({
      key,
      id: document.Id,
      contentDocumentId: document.Id,
      versionId: document.LatestPublishedVersionId,
      title: document.Title || version?.Title || fileName,
      fileName,
      fileType: version?.FileType || document.FileType || 'File',
      fileExtension: version?.FileExtension || '',
      contentSize: version?.ContentSize || document.ContentSize || null,
      createdDate: document.CreatedDate || version?.CreatedDate || null,
      lastModifiedDate: document.LastModifiedDate || null,
      ownerName: document['Owner']?.Name || null,
      sourceGroup: related.sourceGroup || 'Other Related',
      sourceLabel: related.sourceLabel || related.name || 'Related Record',
      sourceObject: related.sourceObject || null,
      sourceRecordId: link.LinkedEntityId,
      downloadUrl: `/api/functions/salesforceDocumentDownload?kind=contentVersion&id=${encodeURIComponent(document.LatestPublishedVersionId)}&filename=${encodeURIComponent(fileName)}`,
      salesforceUrl: `${getInstanceUrl()}/${document.Id}`,
    });
  }

  for (const attachment of attachments) {
    const related = recordMap[attachment.ParentId] || {};
    const fileName = cleanDownloadFilename(attachment.Name || 'Attachment');
    documents.push({
      key: `attachment-${attachment.Id}`,
      id: attachment.Id,
      attachmentId: attachment.Id,
      title: attachment.Name || 'Attachment',
      fileName,
      fileType: attachment.ContentType || 'Attachment',
      fileExtension: fileName.includes('.') ? fileName.split('.').pop() : '',
      contentSize: attachment.BodyLength || null,
      createdDate: attachment.CreatedDate || null,
      lastModifiedDate: attachment.LastModifiedDate || null,
      ownerName: attachment['Owner']?.Name || null,
      sourceGroup: related.sourceGroup || 'Other Related',
      sourceLabel: related.sourceLabel || related.name || 'Related Record',
      sourceObject: related.sourceObject || null,
      sourceRecordId: attachment.ParentId,
      downloadUrl: `/api/functions/salesforceDocumentDownload?kind=attachment&id=${encodeURIComponent(attachment.Id)}&filename=${encodeURIComponent(fileName)}`,
      salesforceUrl: `${getInstanceUrl()}/${attachment.Id}`,
    });
  }

  documents.sort((a, b) => String(b.createdDate || '').localeCompare(String(a.createdDate || '')));
  const groups = DOCUMENT_SOURCE_GROUPS.map((group) => ({
    sourceGroup: group,
    count: documents.filter((document) => document.sourceGroup === group).length,
  })).filter((group) => group.count > 0);

  return {
    stemId: actualStemId,
    stemName: record.Name || record.KeyStem__c || actualStemId,
    documents,
    groups,
    sourceGroups: DOCUMENT_SOURCE_GROUPS,
    relatedRecordCount: relatedRecords.length,
  };
}

async function salesforceStemDocuments(body = {}, req = null, accessContext = null) {
  const stemId = String(body.stemId || '').trim();
  const cached = await cachedSalesforceValue({
    namespace: 'salesforce-stem-documents',
    ttlSeconds: 15,
    payload: { stemId },
    tags: ['salesforce:documents', 'salesforce:stem', `salesforce:documents:${stemId}`],
    body,
    req,
    accessContext,
    loader: () => salesforceStemDocumentsUncached({ stemId }, req, accessContext),
  });
  return cached.value;
}

async function salesforceDocumentDownload(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id');
  const filename = cleanDownloadFilename(url.searchParams.get('filename') || 'salesforce-document');
  if (!isSalesforceId(id)) return sendJson(res, { error: 'Valid document id required' }, 400);
  const path = kind === 'attachment' ? `/sobjects/Attachment/${encodeURIComponent(id)}/Body` : `/sobjects/ContentVersion/${encodeURIComponent(id)}/VersionData`;
  const file = await sfDownload(path);
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_');
  res.statusCode = 200;
  res.setHeader('cache-control', 'no-store');
  for (const [name, value] of Object.entries(telemetryResponseHeaders())) {
    res.setHeader(name, value);
  }
  res.setHeader('content-type', documentContentType(filename, file.contentType));
  res.setHeader('content-disposition', `inline; filename="${asciiFilename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.end(file.buffer);
}

function decisionDashboardValues(values) {
  return values.map((value) => `'${escapeSoql(value)}'`).join(', ');
}

function decisionDashboardNumber(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function decisionDashboardNullable(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

function decisionDashboardCancelled(stem) {
  return /cancel/i.test(String(stem.Status__c || stem.Status || ''));
}

function decisionDashboardBuyerBrokerCommissionField(fields = []) {
  const names = new Set(fields.map((field) => field.name));
  return [
    'Commission_Lumpsum__c',
    'Buyers_Brokers_Commission_Lumpsum__c',
    'Buyer_Broker_Commission_Lumpsum__c',
    'Lumpsum_Commission__c',
    'Commission_Amount__c',
  ].find((name) => names.has(name)) || null;
}

async function decisionDashboardQueryAll(soql) {
  // sfQuery follows Salesforce nextRecordsUrl pages.  Do not introduce a
  // presentation-sized limit here: summary correctness must not depend on it.
  const result = await sfQuery(soql, { clean: true, limit: Number.MAX_SAFE_INTEGER });
  return result.records || [];
}

async function decisionDashboardRowsForStemIds(objectName, fields, stemIds) {
  const rows = [];
  for (const ids of chunkIds(stemIds)) {
    rows.push(...await decisionDashboardQueryAll(`SELECT ${fields.join(', ')} FROM ${objectName} WHERE STEM__c IN (${decisionDashboardValues(ids)})`));
  }
  return rows;
}

function decisionDashboardSort(body = {}, stemFields = new Set()) {
  const requested = String(body.sort?.field || body.sortField || 'createdDate');
  const field = requested === 'stem' ? 'name' : requested;
  if (!['createdDate', 'deliveryDate', 'name'].includes(field)) {
    throw appError('Dashboard STEMs can be sorted by STEM, delivery date, or creation date.', 400, 'DASHBOARD_SORT_INVALID');
  }
  if (field === 'deliveryDate' && !stemFields.has('Delivery_Date__c')) {
    return { field: 'createdDate', direction: 'desc' };
  }
  return {
    field,
    direction: String(body.sort?.direction || body.sortDirection || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc',
  };
}

function decisionDashboardOrderBy(sort) {
  const direction = sort.direction.toUpperCase();
  if (sort.field === 'name') return `Name ${direction}, Id ${direction}`;
  if (sort.field === 'deliveryDate') return `Delivery_Date__c ${direction} NULLS LAST, Id ${direction}`;
  return `CreatedDate ${direction}, Id ${direction}`;
}

function decisionDashboardCursorWhere(cursor, sort) {
  if (!cursor) return '';
  if (cursor.field !== sort.field || cursor.direction !== sort.direction) {
    throw appError('Dashboard cursor does not match the selected sort.', 400, 'DASHBOARD_CURSOR_SORT_INVALID');
  }
  const operator = sort.direction === 'asc' ? '>' : '<';
  const idCondition = `Id ${operator} '${escapeSoql(cursor.id)}'`;
  if (sort.field === 'name') {
    const value = `'${escapeSoql(cursor.value)}'`;
    return `(Name ${operator} ${value} OR (Name = ${value} AND ${idCondition}))`;
  }
  if (sort.field === 'deliveryDate') {
    if (cursor.value == null) return `(Delivery_Date__c = null AND ${idCondition})`;
    const value = String(cursor.value);
    return `(Delivery_Date__c ${operator} ${value} OR (Delivery_Date__c = ${value} AND ${idCondition}) OR Delivery_Date__c = null)`;
  }
  return `(CreatedDate ${operator} ${cursor.value} OR (CreatedDate = ${cursor.value} AND ${idCondition}))`;
}

function decisionDashboardCompareStems(left, right, sort) {
  const direction = sort.direction === 'asc' ? 1 : -1;
  const leftValue = sort.field === 'name' ? left.Name : sort.field === 'deliveryDate' ? left.Delivery_Date__c : left.CreatedDate;
  const rightValue = sort.field === 'name' ? right.Name : sort.field === 'deliveryDate' ? right.Delivery_Date__c : right.CreatedDate;
  if (leftValue == null && rightValue != null) return 1;
  if (leftValue != null && rightValue == null) return -1;
  const primary = String(leftValue || '').localeCompare(String(rightValue || '')) * direction;
  return primary || String(left.Id).localeCompare(String(right.Id)) * direction;
}

async function loadDecisionDashboardScope(body = {}, req = null, accessContext = null, { additionalWhere = '', pageOnly = false } = {}) {
  const startedAt = Date.now();
  const force = requestForcesRefresh(body, req);
  let filters;
  try {
    filters = normalizeDecisionDashboardFilters(body.filters || body);
  } catch (error) {
    throw appError(error.message, 400, 'DASHBOARD_FILTER_INVALID');
  }
  if (body.counterparty) {
    const memberIds = await resolveUnifiedCounterpartyMemberIds(body.counterparty, { accessContext, force });
    const mode = body.counterpartyMode === 'supplier' ? 'supplier' : 'buyer';
    if (mode === 'supplier') filters = { ...filters, supplierIds: [...new Set([...filters.supplierIds, ...memberIds])] };
    else filters = { ...filters, accountIds: [...new Set([...filters.accountIds, ...memberIds])] };
  }
  const [stemDescribe, lineItemDescribe, extraCostDescribe, productDescribe, buyerBrokerDescribe, accountDescribe] = await Promise.all([
    salesforceObjectFields({ objectName: 'stem__c', forceRefresh: force }),
    salesforceObjectFields({ objectName: 'STEM_Line_Item__c', forceRefresh: force }),
    salesforceObjectFields({ objectName: 'STEM_Extra_Cost__c', forceRefresh: force }),
    salesforceObjectFields({ objectName: 'Product2', forceRefresh: force }).catch(() => ({ fields: [] })),
    salesforceObjectFields({ objectName: 'STEM_Buyer_Broker__c', forceRefresh: force }).catch(() => ({ fields: [] })),
    salesforceObjectFields({ objectName: 'Account', forceRefresh: force }),
  ]);
  const stemFields = new Set((stemDescribe.fields || []).map((field) => field.name));
  const lineFields = new Set((lineItemDescribe.fields || []).map((field) => field.name));
  const extraFields = new Set((extraCostDescribe.fields || []).map((field) => field.name));
  const accountFields = new Set((accountDescribe.fields || []).map((field) => field.name));
  if (!accountFields.has('Inactive_Suspended__c')) throw appError('Dashboard cannot verify active Salesforce Accounts.', 503, 'DASHBOARD_ACCOUNT_STATUS_SCHEMA', undefined, true);
  const buyerBrokerCommissionField = decisionDashboardBuyerBrokerCommissionField(buyerBrokerDescribe.fields || []);
  const accountField = stemFields.has('Account__c') ? 'Account__c' : stemFields.has('AccountId') ? 'AccountId' : null;
  const portField = stemFields.has('Port__c') ? 'Port__c' : null;
  const dateWhere = Array.isArray(body.dateWindows) && body.dateWindows.length
    ? buildDashboardDateScopeWhere(body.dateWindows, [...stemFields])
    : additionalWhere
      ? ''
      : (() => { throw appError('Select a valid dashboard date range.', 400, 'INVALID_DASHBOARD_DATE_SCOPE'); })();
  const interofficeWhere = await interofficeStemAccessCondition(accessContext, [...stemFields]);
  const conditions = [dateWhere, interofficeWhere, additionalWhere].filter(Boolean);
  if (filters.accountIds.length) {
    if (!accountField) throw appError('Account filtering is unavailable because Salesforce Account metadata could not be validated.', 503, 'DASHBOARD_SCHEMA');
    const accountChunks = chunkIds(filters.accountIds);
    conditions.push(`(${accountChunks.map((ids) => `${accountField} IN (${decisionDashboardValues(ids)})`).join(' OR ')})`);
    conditions.push('Account__r.Inactive_Suspended__c = false');
  }
  if (filters.portIds.length) {
    if (!portField) throw appError('Port filtering is unavailable because Salesforce Port metadata could not be validated.', 503, 'DASHBOARD_SCHEMA');
    conditions.push(`${portField} IN (${decisionDashboardValues(filters.portIds)})`);
  }
  if (filters.countryCodes.length) {
    if (!portField) throw appError('Country filtering is unavailable because Salesforce Port metadata could not be validated.', 503, 'DASHBOARD_SCHEMA');
    conditions.push(`Port__r.Country__c IN (${decisionDashboardValues(filters.countryCodes)})`);
  }
  if (!filters.includeCancelled && stemFields.has('Status__c')) {
    const statusField = (stemDescribe.fields || []).find((field) => field.name === 'Status__c');
    const cancelledStatuses = (statusField?.picklistValues || []).map((item) => item.value).filter((value) => /cancel/i.test(String(value || '')));
    if (cancelledStatuses.length) conditions.push(`(Status__c = null OR Status__c NOT IN (${decisionDashboardValues(cancelledStatuses)}))`);
  }
  if (body.disputeOnly === true) {
    if (stemFields.has('Dispute_Status__c')) conditions.push("Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null");
    else if (stemFields.has('Dispute__c')) conditions.push('Dispute__c = true');
  }
  const search = String(body.search || '').trim().slice(0, 100);
  if (search) {
    const like = `%${escapeSoql(search)}%`;
    const searchFields = [
      `Name LIKE '${like}'`,
      accountField ? `(Account__r.Inactive_Suspended__c = false AND Account__r.Name LIKE '${like}')` : '',
      portField ? `Port__r.Name LIKE '${like}'` : '',
      stemFields.has('Vessel__c') ? `Vessel__r.Name LIKE '${like}'` : '',
    ].filter(Boolean);
    conditions.push(`(${searchFields.join(' OR ')})`);
  }
  const cursor = decodeDashboardCursor(body.cursor);
  if (pageOnly && body.cursor && !cursor) throw appError('Dashboard cursor is invalid.', 400, 'DASHBOARD_CURSOR_INVALID');
  const parentSelect = ['Id', 'Name', 'CreatedDate'];
  for (const name of ['Delivery_Date__c', 'Expected_Delivery_Date__c', 'Status__c', 'Type__c', 'Dispute__c', 'Dispute_Status__c', 'CurrencyIsoCode', 'Total_Invoice_Amount__c', 'Total_Invoiced_Amount_From_Suppliers__c', 'Costs_Total__c', 'QLIK_STEM_Line_Item_Total_Cost__c', 'QLIK_Costs_Total_Cost__c']) if (stemFields.has(name)) parentSelect.push(name);
  if (accountField) parentSelect.push(accountField, 'Account__r.Name', 'Account__r.Inactive_Suspended__c');
  if (portField) parentSelect.push(portField, 'Port__r.Name', 'Port__r.Country__c');
  if (stemFields.has('Vessel__c')) parentSelect.push('Vessel__c', 'Vessel__r.Name');
  const pageSize = Math.min(Math.max(Number(body.pageSize) || 50, 1), 200);
  const sort = decisionDashboardSort(body, stemFields);
  const cursorWhere = decisionDashboardCursorWhere(cursor, sort);
  const orderBy = decisionDashboardOrderBy(sort);

  const supplierConditions = [];
  const lineSupplier = resolveOriginalSupplierLookup(lineItemDescribe.fields || []);
  const extraSupplier = resolveExtraCostSupplierLookup(extraCostDescribe.fields || []);
  if (filters.supplierIds.length) {
    if (lineSupplier.valid) supplierConditions.push(`${lineSupplier.fieldName} IN (${decisionDashboardValues(filters.supplierIds)}) AND ${lineSupplier.relationshipName}.Inactive_Suspended__c = false`);
  }
  const extraSupplierConditions = [];
  if (filters.supplierIds.length && extraSupplier.valid) extraSupplierConditions.push(`${extraSupplier.fieldName} IN (${decisionDashboardValues(filters.supplierIds)}) AND ${extraSupplier.relationshipName}.Inactive_Suspended__c = false`);
  if (filters.supplierIds.length && !supplierConditions.length && !extraSupplierConditions.length) {
    throw appError('Supplier filtering is unavailable because Salesforce supplier metadata could not be validated.', 503, 'DASHBOARD_SCHEMA');
  }
  let matchingSupplierStemIds = null;
  if (supplierConditions.length || extraSupplierConditions.length) {
    const [lineMatches, extraMatches] = await Promise.all([
      supplierConditions.length ? decisionDashboardQueryAll(`SELECT STEM__c FROM STEM_Line_Item__c WHERE Cancelled__c = false AND (${supplierConditions.join(' OR ')})`) : [],
      extraSupplierConditions.length ? decisionDashboardQueryAll(`SELECT STEM__c FROM STEM_Extra_Cost__c WHERE Cancelled__c = false AND (${extraSupplierConditions.join(' OR ')})`) : [],
    ]);
    matchingSupplierStemIds = [...new Set([...lineMatches, ...extraMatches].map((row) => row.STEM__c).filter(Boolean))];
  }

  const selectedParentFields = [...new Set(parentSelect)].join(', ');
  const loadParentRows = async (idChunk = null, { countOnly = false, applyCursor = false, limit = null } = {}) => {
    const scopedConditions = [...conditions];
    if (idChunk) scopedConditions.push(`Id IN (${decisionDashboardValues(idChunk)})`);
    if (applyCursor && cursorWhere) scopedConditions.push(cursorWhere);
    const where = combineWhereConditions(scopedConditions);
    if (countOnly) {
      const result = await sfQuery(`SELECT COUNT(Id) total FROM stem__c WHERE ${where}`, { clean: true });
      return Number(result.records?.[0]?.total || 0);
    }
    const limitClause = limit ? ` LIMIT ${limit}` : '';
    return decisionDashboardQueryAll(`SELECT ${selectedParentFields} FROM stem__c WHERE ${where} ORDER BY ${orderBy}${limitClause}`);
  };

  let matchingCount = 0;
  let stems = [];
  if (matchingSupplierStemIds) {
    const idChunks = chunkIds(matchingSupplierStemIds);
    if (idChunks.length) {
      const [counts, pages] = await Promise.all([
        Promise.all(idChunks.map((ids) => loadParentRows(ids, { countOnly: true }))),
        Promise.all(idChunks.map((ids) => loadParentRows(ids, { applyCursor: pageOnly, limit: pageOnly ? pageSize + 1 : null }))),
      ]);
      matchingCount = counts.reduce((sum, value) => sum + value, 0);
      stems = pages.flat().sort((left, right) => decisionDashboardCompareStems(left, right, sort));
    }
  } else if (pageOnly) {
    [matchingCount, stems] = await Promise.all([
      loadParentRows(null, { countOnly: true }),
      loadParentRows(null, { applyCursor: true, limit: pageSize + 1 }),
    ]);
  } else {
    stems = await loadParentRows();
    matchingCount = stems.length;
  }
  // The status condition is derived from live picklist metadata when possible;
  // retain this defensive check for non-picklist/custom cancellation values.
  if (!filters.includeCancelled) stems = stems.filter((stem) => !decisionDashboardCancelled(stem));
  const hasMore = pageOnly && stems.length > pageSize;
  const pageStems = pageOnly ? stems.slice(0, pageSize) : stems;
  const stemIds = pageStems.map((stem) => stem.Id);
  const lineItemUomField = findDashboardUomField(lineItemDescribe.fields, 'lineItem');
  const productUomField = findDashboardUomField(productDescribe.fields || [], 'product');
  const lineSelect = ['Id', 'CreatedDate', 'STEM__c', 'Cancelled__c', 'Supplier_Invoice__c', 'Supplier_Name__c', 'Original_Supplier__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_Max__c', 'Quantity_in_MT__c', 'Is_Quantity_Range__c', 'Total_Price__c', 'Total_Cost__c', 'Price_Per_Unit__c', 'Cost_Per_Unit__c', 'Unit_Sell_At__c', 'Unit_Buy_At__c', 'Unit_Cost__c', 'Commission_Cost__c', 'Buyers_Brokers_Commission_Per_Unit__c', 'Suppliers_Brokers_Commission_Per_Unit__c'].filter((field) => lineFields.has(field));
  if (lineSupplier.valid) lineSelect.push(lineSupplier.fieldName);
  if (lineSupplier.valid && lineSupplier.relationshipName) lineSelect.push(`${lineSupplier.relationshipName}.Name`);
  if (lineSupplier.valid && lineSupplier.relationshipName) lineSelect.push(`${lineSupplier.relationshipName}.Inactive_Suspended__c`);
  if (lineItemUomField) lineSelect.push(lineItemUomField);
  if (lineFields.has('Product__c')) {
    lineSelect.push('Product__r.Name', 'Product__r.Family');
    if (productUomField) lineSelect.push(`Product__r.${productUomField}`);
  }
  const extraProductLookup = (extraCostDescribe.fields || []).find((field) => ['Product2Id__c', 'Product__c'].includes(field.name) && field.relationshipName);
  const extraSelect = ['Id', 'CreatedDate', 'Name', 'Description__c', 'STEM__c', 'Cancelled__c', 'Supplier_Invoice__c', 'Supplier_Name__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Line_Total__c', 'Line_Total_Buy__c', 'Unit_Price__c', 'Unit_Cost__c'].filter((field) => extraFields.has(field));
  if (extraProductLookup) extraSelect.push(`${extraProductLookup.relationshipName}.Name`);
  if (extraSupplier.valid) extraSelect.push(extraSupplier.fieldName);
  if (extraSupplier.valid && extraSupplier.relationshipName) extraSelect.push(`${extraSupplier.relationshipName}.Name`);
  if (extraSupplier.valid && extraSupplier.relationshipName) extraSelect.push(`${extraSupplier.relationshipName}.Inactive_Suspended__c`);
  const [lineItems, extraCosts, buyerBrokers, buyerInvoices] = stemIds.length ? await Promise.all([
    decisionDashboardRowsForStemIds('STEM_Line_Item__c', [...new Set(lineSelect)], stemIds),
    decisionDashboardRowsForStemIds('STEM_Extra_Cost__c', [...new Set(extraSelect)], stemIds),
    buyerBrokerCommissionField
      ? decisionDashboardRowsForStemIds('STEM_Buyer_Broker__c', ['STEM__c', buyerBrokerCommissionField], stemIds)
      : Promise.resolve([]),
    decisionDashboardRowsForStemIds('Invoice__c', ['Id', 'Name', 'STEM__c', 'Proforma__c', 'Deprecated__c'], stemIds),
  ]) : [[], [], [], []];
  const salesforceCompletedAt = Date.now();
  const lineByStem = new Map();
  const extraByStem = new Map();
  const buyerBrokerByStem = new Map();
  const finalBuyerInvoiceStemIds = new Set(buyerInvoices.filter(isFinalBuyerInvoice).map((invoice) => invoice.STEM__c).filter(Boolean));
  for (const item of lineItems) if (!item.Cancelled__c) lineByStem.set(item.STEM__c, [...(lineByStem.get(item.STEM__c) || []), item]);
  for (const item of extraCosts) if (!item.Cancelled__c) extraByStem.set(item.STEM__c, [...(extraByStem.get(item.STEM__c) || []), item]);
  for (const item of buyerBrokers) buyerBrokerByStem.set(item.STEM__c, (buyerBrokerByStem.get(item.STEM__c) || 0) + decisionDashboardNumber(item[buyerBrokerCommissionField]));
  let uomWarningCount = 0;
  const rows = pageStems.map((stem) => {
    const delivered = Boolean(stem.Delivery_Date__c);
    const lines = lineByStem.get(stem.Id) || [];
    const extras = extraByStem.get(stem.Id) || [];
    const lineTotals = lines.reduce((total, item) => {
      const amounts = { sell: lineSellAmount(item, delivered), buy: lineBuyAmount(item, delivered) };
      const nativeQuantity = nativeFinancialQuantity(item, { stemHasDelivery: delivered, lineItemUomField });
      if (nativeQuantity.warning) uomWarningCount += 1;
      const volume = dashboardLineItemVolume(item, delivered, {
        lineItemUomField,
        productUomField,
        fallbackQuantity: nativeQuantity.quantity,
        productFamily: dashboardProductFamily(item),
      });
      const productFamily = dashboardProductFamily(item);
      const productKey = `${productFamily}\u001f${volume.unitOfMeasure || 'MT'}`;
      const productVolumes = { ...total.productVolumes };
      productVolumes[productKey] = {
        family: productFamily,
        unitOfMeasure: volume.unitOfMeasure || 'MT',
        quantity: Number(productVolumes[productKey]?.quantity || 0) + Number(volume.quantity || 0),
      };
      const productName = item.Product__r?.Name || item.Name || 'Unspecified';
      return {
        sell: total.sell + amounts.sell,
        buy: total.buy + amounts.buy,
        uninvoicedBuy: total.uninvoicedBuy + (item.Supplier_Invoice__c ? 0 : amounts.buy),
        hasSupplierInvoice: total.hasSupplierInvoice || Boolean(item.Supplier_Invoice__c),
        buyerComm: total.buyerComm + buyerBrokerCommission(item, delivered),
        supplierComm: total.supplierComm + supplierBrokerCommission(item, delivered),
        volumeMt: total.volumeMt + Number(volume.quantity || 0),
        productVolumes,
        productQuantities: [...total.productQuantities, {
          productName,
          quantityLabel: dashboardVolumeLabel(volume),
          unitOfMeasure: volume.unitOfMeasure || 'MT',
        }],
      };
    }, { sell: 0, buy: 0, uninvoicedBuy: 0, hasSupplierInvoice: false, buyerComm: 0, supplierComm: 0, volumeMt: 0, productVolumes: {}, productQuantities: [] });
    const extraTotals = extras.reduce((total, item) => {
      const amounts = { sell: extraSellAmount(item, delivered), buy: extraBuyAmount(item, delivered) };
      return {
        sell: total.sell + amounts.sell,
        uninvoicedBuy: total.uninvoicedBuy + (item.Supplier_Invoice__c ? 0 : amounts.buy),
        invoicedBuy: total.invoicedBuy + (item.Supplier_Invoice__c ? amounts.buy : 0),
        sellOnlyUninvoiced: total.sellOnlyUninvoiced + (!item.Supplier_Invoice__c && amounts.buy === 0 && amounts.sell > 0 ? amounts.sell : 0),
      };
    }, { sell: 0, uninvoicedBuy: 0, invoicedBuy: 0, sellOnlyUninvoiced: 0 });
    const calculatedBuyer = lineTotals.sell + extraTotals.sell;
    const buyerResolution = resolveBuyerFinancialAmount({ salesforceAmount: decisionDashboardNullable(stem.Total_Invoice_Amount__c), calculatedAmount: calculatedBuyer, finalInvoiceIssued: finalBuyerInvoiceStemIds.has(stem.Id) });
    const buyer = buyerResolution.amount;
    const qlikSupplierCost = stem.QLIK_STEM_Line_Item_Total_Cost__c != null || stem.QLIK_Costs_Total_Cost__c != null
      ? decisionDashboardNumber(stem.QLIK_STEM_Line_Item_Total_Cost__c) + decisionDashboardNumber(stem.QLIK_Costs_Total_Cost__c)
      : null;
    const supplier = decisionDashboardSupplierAmount({
      invoicedSupplierAmount: stem.Total_Invoiced_Amount_From_Suppliers__c,
      lineBuyAmount: lineTotals.buy,
      uninvoicedLineBuyAmount: lineTotals.uninvoicedBuy,
      hasSupplierInvoice: lineTotals.hasSupplierInvoice,
      uninvoicedExtraBuyAmount: extraTotals.uninvoicedBuy,
      invoicedExtraBuyAmount: extraTotals.invoicedBuy,
      sellOnlyUninvoicedExtraSellAmount: extraTotals.sellOnlyUninvoiced,
      qlikSupplierCost,
    });
    // Costs_Total__c participates in the supplier calculation only in the
    // legacy source when represented by a child extra cost.  Do not subtract
    // it again from P&L.
    const costs = decisionDashboardNumber(stem.Costs_Total__c);
    const brokerCommissions = lineTotals.buyerComm + lineTotals.supplierComm + (buyerBrokerByStem.get(stem.Id) || 0);
    const netPnl = buyer == null ? null : buyer - supplier - brokerCommissions;
    const supplierWeights = new Map();
    const addSupplierWeight = (id, name, weight, inactive) => {
      if (inactive === true) return;
      const normalizedName = String(name || '').trim();
      if (!id && !normalizedName) return;
      const key = id || `name:${normalizedName.toLowerCase()}`;
      const current = supplierWeights.get(key) || { id: id || null, name: normalizedName || 'Supplier name unavailable', weight: 0 };
      current.weight += Math.max(Number(weight) || 0, 0);
      supplierWeights.set(key, current);
    };
    for (const item of lines) {
      addSupplierWeight(
        lineSupplier.valid ? item[lineSupplier.fieldName] : null,
        item.Supplier_Name__c || (lineSupplier.relationshipName ? item[lineSupplier.relationshipName]?.Name : null),
        lineBuyAmount(item, delivered),
        lineSupplier.relationshipName ? item[lineSupplier.relationshipName]?.Inactive_Suspended__c : null,
      );
    }
    for (const item of extras) {
      addSupplierWeight(
        extraSupplier.valid ? item[extraSupplier.fieldName] : null,
        item.Supplier_Name__c || (extraSupplier.relationshipName ? item[extraSupplier.relationshipName]?.Name : null),
        extraBuyAmount(item, delivered),
        extraSupplier.relationshipName ? item[extraSupplier.relationshipName]?.Inactive_Suspended__c : null,
      );
    }
    const weightedSuppliers = [...supplierWeights.values()];
    const totalSupplierWeight = weightedSuppliers.reduce((sum, item) => sum + item.weight, 0);
    const supplierAllocations = weightedSuppliers.map((item) => ({
      id: item.id,
      name: item.name,
      netPnl: netPnl == null
        ? null
        : totalSupplierWeight > 0
          ? netPnl * (item.weight / totalSupplierWeight)
          : netPnl / Math.max(weightedSuppliers.length, 1),
    }));
    const supplierNames = [...new Set(weightedSuppliers.map((item) => item.name).filter(Boolean))].sort();
    const supplierAccounts = [...new Map([
      ...lines.filter((item) => item[lineSupplier.relationshipName]?.Inactive_Suspended__c !== true).map((item) => [item[lineSupplier.fieldName], item[lineSupplier.relationshipName]?.Name || item.Supplier_Name__c]),
      ...extras.filter((item) => item[extraSupplier.relationshipName]?.Inactive_Suspended__c !== true).map((item) => [item[extraSupplier.fieldName], item[extraSupplier.relationshipName]?.Name || item.Supplier_Name__c]),
    ].filter(([id]) => id).map(([id, name]) => [id, { id, name: String(name || '').trim() || null }])).values()].sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')) || left.id.localeCompare(right.id));
    const supplierProductRows = dashboardSupplierProductRows({
      lineItems: lines.map((item) => {
        const nativeQuantity = nativeFinancialQuantity(item, { stemHasDelivery: delivered, lineItemUomField });
        const volume = dashboardLineItemVolume(item, delivered, {
          lineItemUomField,
          productUomField,
          fallbackQuantity: nativeQuantity.quantity,
          productFamily: dashboardProductFamily(item),
        });
        return {
          sourceId: item.Id,
          createdDate: item.CreatedDate,
          supplierAccountId: lineSupplier.valid && item[lineSupplier.relationshipName]?.Inactive_Suspended__c !== true ? item[lineSupplier.fieldName] : null,
          supplierName: lineSupplier.relationshipName && item[lineSupplier.relationshipName]?.Inactive_Suspended__c === true ? null : item.Supplier_Name__c || (lineSupplier.relationshipName ? item[lineSupplier.relationshipName]?.Name : null),
          itemName: item.Product__r?.Name || 'Product unavailable',
          quantityLabel: dashboardVolumeLabel(volume),
          unitOfMeasure: volume.unitOfMeasure || 'MT',
        };
      }),
      extraCosts: extras.map((item) => ({
        sourceId: item.Id,
        createdDate: item.CreatedDate,
        supplierAccountId: extraSupplier.valid && item[extraSupplier.relationshipName]?.Inactive_Suspended__c !== true ? item[extraSupplier.fieldName] : null,
        supplierName: extraSupplier.relationshipName && item[extraSupplier.relationshipName]?.Inactive_Suspended__c === true ? null : item.Supplier_Name__c || (extraSupplier.relationshipName ? item[extraSupplier.relationshipName]?.Name : null),
        chargeProductName: extraProductLookup ? item[extraProductLookup.relationshipName]?.Name : null,
        description: item.Description__c,
        recordName: item.Name,
      })),
    });
    return {
      id: stem.Id,
      name: stem.Name,
      createdDate: stem.CreatedDate,
      deliveryDate: stem.Delivery_Date__c || stem.Expected_Delivery_Date__c || null,
      deliveryDateSource: stem.Delivery_Date__c ? 'delivery' : stem.Expected_Delivery_Date__c ? 'expected' : null,
      status: stem.Status__c || null,
      type: stem.Type__c || null,
      dispute: stem.Dispute__c === true || (stem.Dispute_Status__c && stem.Dispute_Status__c !== 'No Dispute'),
      account: accountField && stem[accountField] && stem.Account__r?.Inactive_Suspended__c !== true ? { id: stem[accountField], name: stem.Account__r?.Name || null } : accountField && stem[accountField] ? { id: null, name: 'Account unavailable' } : null,
      port: portField && stem[portField] ? { id: stem[portField], name: stem.Port__r?.Name || null, countryCode: stem.Port__r?.Country__c || null } : null,
      vessel: stem.Vessel__c ? { id: stem.Vessel__c, name: stem.Vessel__r?.Name || null } : null,
      supplierNames,
      supplierAccounts,
      supplierProductRows,
      currency: dashboardCurrency(stem.CurrencyIsoCode), buyer, supplier, costs, brokerCommissions,
      buyerAmountSource: buyerResolution.source,
      buyerInvoiceIssued: finalBuyerInvoiceStemIds.has(stem.Id),
      netPnl,
      supplierAllocations,
      volumeMt: lineTotals.volumeMt,
      productVolumes: Object.values(lineTotals.productVolumes),
      productQuantities: lineTotals.productQuantities,
      _cursorRecord: stem,
    };
  });
  const completeness = decisionDashboardCompleteness({ matchingCount, processedCount: rows.length, failed: false });
  return {
    filters,
    rows,
    completeness,
    nextCursor: hasMore && rows.length ? encodeDashboardCursor(rows[rows.length - 1]._cursorRecord, sort) : null,
    sort,
    // Timing is operational metadata only.  No record values, currencies, or
    // financial totals are retained in timing/cache diagnostics.
    timing: {
      redacted: true,
      elapsedMs: Date.now() - startedAt,
      salesforceMs: salesforceCompletedAt - startedAt,
      computeMs: Date.now() - salesforceCompletedAt,
      processedCount: rows.length,
      cache: force ? 'bypassed' : 'live',
    },
    dataWarnings: uomWarningCount ? [`${uomWarningCount} financial line${uomWarningCount === 1 ? '' : 's'} have no Salesforce UOM. Native quantities were used without inferred conversion.`] : [],
  };
}

function publicDecisionDashboardRows(rows) {
  return rows.map(({ _cursorRecord, ...row }) => row);
}

function decisionDashboardOverviewMetrics(scope, body = {}) {
  const buyerAccounts = new Set(scope.rows.map((row) => row.account?.id).filter(Boolean));
  const supplierAccounts = new Set(scope.rows.flatMap((row) => (row.supplierAccounts || []).map((account) => account.id)).filter(Boolean));
  const productVolumeByKey = new Map();
  for (const product of scope.rows.flatMap((row) => row.productVolumes || [])) {
    const key = `${product.family}\u001f${product.unitOfMeasure || 'MT'}`;
    const current = productVolumeByKey.get(key) || { family: product.family, unitOfMeasure: product.unitOfMeasure || 'MT', quantity: 0 };
    current.quantity += Number(product.quantity || 0);
    productVolumeByKey.set(key, current);
  }
  const breakdown = [...productVolumeByKey.values()].sort((left, right) => {
    const order = ['HSFO', 'VLSFO', 'LSMGO'];
    const leftRank = order.indexOf(String(left.family || '').toUpperCase());
    const rightRank = order.indexOf(String(right.family || '').toUpperCase());
    return (leftRank < 0 ? order.length : leftRank) - (rightRank < 0 ? order.length : rightRank) || String(left.family).localeCompare(String(right.family));
  });
  return {
    stemCount: scope.completeness.matchingCount,
    disputedCount: scope.rows.filter((row) => row.dispute).length,
    buyerAccountCount: buyerAccounts.size,
    supplierAccountCount: supplierAccounts.size,
    accountCount: body.counterpartyMode === 'supplier' ? supplierAccounts.size : buyerAccounts.size,
    productVolume: {
      quantity: scope.rows.reduce((sum, row) => sum + Number(row.volumeMt || 0), 0),
      unitOfMeasure: 'MT',
      breakdown,
    },
  };
}

function decisionDashboardCurrencyComparison(currentFinancials = [], priorFinancials = []) {
  const priorByCurrency = new Map((priorFinancials || []).map((row) => [row.currency, row]));
  const percentage = (current, prior) => Number(prior) === 0 ? null : ((Number(current) - Number(prior)) / Math.abs(Number(prior))) * 100;
  return (currentFinancials || []).map((row) => {
    const prior = priorByCurrency.get(row.currency) || {};
    return {
      currency: row.currency,
      currentNetPnl: row.netPnl,
      priorNetPnl: Number(prior.netPnl || 0),
      netPnlChangePct: percentage(row.netPnl, prior.netPnl),
      currentBuyer: row.buyer,
      priorBuyer: Number(prior.buyer || 0),
      buyerChangePct: percentage(row.buyer, prior.buyer),
    };
  });
}

async function decisionDashboardInternalAccountIdentity(body = {}, req = null, accessContext = null) {
  const cached = await cachedSalesforceValue({
    namespace: 'decision-dashboard-internal-accounts',
    ttlSeconds: 10 * 60,
    payload: { group: INTEROFFICE_EXCLUDED_BUYER_GROUP, resolverVersion: 2 },
    tags: ['salesforce:dashboard', 'salesforce:account', 'salesforce:reference'],
    body,
    req,
    accessContext,
    loader: async () => {
      const describe = await salesforceObjectFields({ objectName: 'Account' });
      const fields = fieldNameSetFrom(describe.fields || []);
      if (!fields.has('ParentId')) throw appError('Dashboard rankings require the Salesforce Account hierarchy.', 503, 'DASHBOARD_RANKING_ACCOUNT_HIERARCHY', undefined, true);
      const groupNameField = fields.has('Group_Name__c') ? 'Group_Name__c' : null;
      if (!fields.has('Inactive_Suspended__c')) throw appError('Dashboard rankings cannot verify active Salesforce Accounts.', 503, 'DASHBOARD_RANKING_ACCOUNT_STATUS', undefined, true);
      const accounts = await decisionDashboardQueryAll(`SELECT ${['Id', 'Name', 'ParentId', groupNameField].filter(Boolean).join(',')} FROM Account WHERE Inactive_Suspended__c = false ORDER BY Id`);
      const byId = new Map(accounts.map((account) => [account.Id, account]));
      const normalizedGroupIdentity = (value) => String(value || '').trim().toUpperCase().replace(/^GROUP\s*(?:-|–|—|:)\s*/, '');
      const rootIds = new Set(accounts.filter((account) => normalizedGroupIdentity(account.Name) === INTEROFFICE_EXCLUDED_BUYER_GROUP).map((account) => account.Id));
      const internal = accounts.filter((account) => {
        if (groupNameField && normalizedGroupIdentity(account[groupNameField]) === INTEROFFICE_EXCLUDED_BUYER_GROUP) return true;
        const seen = new Set();
        let current = account;
        while (current) {
          if (seen.has(current.Id)) throw appError('Salesforce Account hierarchy contains a cycle.', 503, 'DASHBOARD_RANKING_ACCOUNT_HIERARCHY', undefined, true);
          seen.add(current.Id);
          if (rootIds.has(current.Id)) return true;
          current = current.ParentId ? byId.get(current.ParentId) : null;
        }
        return false;
      });
      return {
        accountIds: internal.map((account) => account.Id).filter(Boolean),
        accountNames: [...new Set(internal.map((account) => String(account.Name || '').trim().toUpperCase()).filter(Boolean))],
      };
    },
  });
  return cached.value;
}

async function dashboardSummaryUncached(body = {}, req = null, accessContext = null) {
  const scope = await loadDecisionDashboardScope(body, req, accessContext);
  return {
    ...decisionDashboardSummary(scope.rows.filter((row) => row.buyer != null), scope.completeness),
    ...decisionDashboardOverviewMetrics(scope, body),
    filters: scope.filters,
    timing: scope.timing,
    dataWarnings: scope.dataWarnings,
  };
}

async function dashboardStemListUncached(body = {}, req = null, accessContext = null) {
  const scope = await loadDecisionDashboardScope(body, req, accessContext, { pageOnly: true });
  return { ...scope.completeness, filters: scope.filters, stems: publicDecisionDashboardRows(scope.rows), pageSize: Math.min(Math.max(Number(body.pageSize) || 50, 1), 200), nextCursor: scope.nextCursor, sort: scope.sort, timing: scope.timing, dataWarnings: scope.dataWarnings };
}

async function dashboardAnalyticsUncached(body = {}, req = null, accessContext = null) {
  const previousDateWindows = body.previousDateWindows || priorEquivalentDateWindows(body.dateWindows);
  const currentYearDateWindows = dashboardCurrentYearDateWindows();
  const currentYear = currentYearDateWindows[0]?.startDate?.slice(0, 4) || null;
  const yearOverYearWindows = yearOverYearDateWindows(currentYearDateWindows);
  const [current, prior, calendarYear, priorYear, internalAccounts] = await Promise.all([
    loadDecisionDashboardScope(body, req, accessContext),
    loadDecisionDashboardScope({ ...body, dateWindows: previousDateWindows }, req, accessContext),
    loadDecisionDashboardScope({ ...body, dateWindows: currentYearDateWindows }, req, accessContext),
    loadDecisionDashboardScope({ ...body, dateWindows: yearOverYearWindows }, req, accessContext),
    decisionDashboardInternalAccountIdentity(body, req, accessContext),
  ]);
  const internalAccountIds = new Set(internalAccounts?.accountIds || []);
  const internalAccountNames = new Set(internalAccounts?.accountNames || []);
  const ranking = (field) => dashboardAccountRankings(current.rows, field, {
    excludedAccountIds: internalAccountIds,
    excludedAccountNames: internalAccountNames,
  });
  const accountDirectoryRankings = ranking('account');
  const supplierDirectoryRankings = ranking('supplier');
  const distribution = (rows, field) => Object.entries(rows.reduce((result, row) => {
    const label = String(row[field] || 'Unknown');
    result[label] = (result[label] || 0) + 1;
    return result;
  }, {})).map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const monthlyTrend = dashboardMonthlyFinancialTrend(calendarYear.rows);
  const monthlyVolume = Object.values(calendarYear.rows.reduce((result, row) => {
    const month = String(row.deliveryDate || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return result;
    for (const product of row.productVolumes || []) {
      const currency = dashboardCurrency(row.currency);
      const key = `${month}\u001f${currency}\u001f${product.family}\u001f${product.unitOfMeasure || 'MT'}`;
      if (!result[key]) result[key] = { month, currency, family: product.family, unitOfMeasure: product.unitOfMeasure || 'MT', quantity: 0 };
      result[key].quantity += Number(product.quantity || 0);
    }
    return result;
  }, {})).sort((left, right) => left.month.localeCompare(right.month) || left.family.localeCompare(right.family));
  const aggregateMonthlyVolume = (rows) => Object.values(rows.reduce((result, row) => {
    const month = String(row.deliveryDate || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return result;
    for (const product of row.productVolumes || []) {
      const currency = dashboardCurrency(row.currency);
      const unitOfMeasure = product.unitOfMeasure || 'MT';
      const key = `${month}\u001f${currency}\u001f${unitOfMeasure}`;
      if (!result[key]) result[key] = { month, currency, unitOfMeasure, quantity: 0 };
      result[key].quantity += Number(product.quantity || 0);
    }
    return result;
  }, {}));
  const yearOverYearComplete = calendarYear.completeness.complete && priorYear.completeness.complete;
  const monthlyYearOverYear = yearOverYearComplete
    ? dashboardMonthlyYearOverYear(monthlyTrend, dashboardMonthlyFinancialTrend(priorYear.rows), { valueField: 'grossMarginPct', dimensions: ['currency'] })
    : [];
  const monthlyVolumeYearOverYear = yearOverYearComplete
    ? dashboardMonthlyYearOverYear(aggregateMonthlyVolume(current.rows), aggregateMonthlyVolume(priorYear.rows), { valueField: 'quantity', dimensions: ['currency', 'unitOfMeasure'] })
    : [];
  const priorMonthlyTrend = dashboardMonthlyFinancialTrend(priorYear.rows);
  const priorMonthlyVolume = Object.values(priorYear.rows.reduce((result, row) => {
    const month = String(row.deliveryDate || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return result;
    for (const product of row.productVolumes || []) {
      const currency = dashboardCurrency(row.currency);
      const unitOfMeasure = product.unitOfMeasure || 'MT';
      const key = `${month}\u001f${currency}\u001f${product.family}\u001f${unitOfMeasure}`;
      if (!result[key]) result[key] = { month, currency, family: product.family, unitOfMeasure, quantity: 0 };
      result[key].quantity += Number(product.quantity || 0);
    }
    return result;
  }, {}));
  const monthlyComparison = dashboardMonthlyComparison({
    currentFinancial: monthlyTrend,
    priorFinancial: priorMonthlyTrend,
    currentVolume: monthlyVolume,
    priorVolume: priorMonthlyVolume,
    priorComplete: yearOverYearComplete,
    calendarYear: currentYear,
  });
  const currentSummary = decisionDashboardSummary(current.rows.filter((row) => row.buyer != null), current.completeness);
  const priorSummary = decisionDashboardSummary(prior.rows.filter((row) => row.buyer != null), prior.completeness);
  return {
    ...currentSummary,
    ...decisionDashboardOverviewMetrics(current, body),
    filters: current.filters,
    trend: {
      current: currentSummary,
      previous: priorSummary,
      previousDateWindows,
      monthly: monthlyTrend,
      monthlyVolume,
      monthlyComparison: {
        complete: yearOverYearComplete,
        calendarYear: currentYear,
        currentDateWindows: currentYearDateWindows,
        dateWindows: yearOverYearWindows,
        rows: monthlyComparison,
      },
      yearOverYear: {
        complete: yearOverYearComplete,
        dateWindows: yearOverYearWindows,
        monthly: monthlyYearOverYear,
        monthlyVolume: monthlyVolumeYearOverYear,
      },
    },
    comparisonByCurrency: currentSummary.complete && priorSummary.complete
      ? decisionDashboardCurrencyComparison(currentSummary.financials, priorSummary.financials)
      : null,
    priorPeriod: { stemCount: prior.completeness.matchingCount },
    distributions: { status: distribution(current.rows, 'status'), type: distribution(current.rows, 'type') },
    rankings: { accountsByNetPnl: accountDirectoryRankings.slice(0, 10), portsByNetPnl: ranking('port').slice(0, 10), suppliersByNetPnl: supplierDirectoryRankings.slice(0, 10) },
    directoryRankings: { buyers: accountDirectoryRankings, suppliers: supplierDirectoryRankings },
    timing: current.timing,
    dataWarnings: current.dataWarnings,
  };
}

async function cachedDecisionDashboard(handler, body, req, accessContext, ttlSeconds, loader) {
  const cachePayload = { ...body };
  delete cachePayload.force;
  delete cachePayload.forceRefresh;
  delete cachePayload.refresh;
  const cached = await cachedSalesforceValue({
    namespace: handler === 'stems'
      ? 'decision-dashboard-v9-stems'
      : handler === 'analytics'
        ? 'decision-dashboard-v10-analytics-calendar-year'
        : `decision-dashboard-v9-${handler}`,
    ttlSeconds,
    payload: cachePayload,
    tags: ['salesforce:dashboard', 'salesforce:stem', `salesforce:dashboard:${handler}`],
    body,
    req,
    accessContext,
    loader,
  });
  return cached.value;
}

async function dashboardSummary(body = {}, req = null, accessContext = null) {
  return cachedDecisionDashboard('summary', body, req, accessContext, 60, () => dashboardSummaryUncached(body, req, accessContext));
}

async function dashboardStemList(body = {}, req = null, accessContext = null) {
  return cachedDecisionDashboard('stems', body, req, accessContext, 30, () => dashboardStemListUncached(body, req, accessContext));
}

async function dashboardAnalytics(body = {}, req = null, accessContext = null) {
  return cachedDecisionDashboard('analytics', body, req, accessContext, 60, () => dashboardAnalyticsUncached(body, req, accessContext));
}

async function salesforceDashboardFilteredCompatibility(body = {}, req = null, accessContext = null, internalOptions = {}) {
  if (body?.contract === 'decision-dashboard') return dashboardSummary(body, req, accessContext);
  return salesforceDashboardFilteredFull(body, req, accessContext, internalOptions);
}

async function salesforceDashboardFilteredUncached(body, req = null, accessContext = null, internalOptions = {}) {
  const { trendYear, disputeOnly, portCountry, companyKeyword, companyFilterMode, dateBasis, dateWindows } = body;
  const currentYear = Number(trendYear) || new Date().getFullYear();
  const [describe, lineItemDescribe, productDescribe, extraCostDescribe] = await Promise.all([
    salesforceObjectFields({ objectName: 'stem__c' }),
    salesforceObjectFields({ objectName: 'STEM_Line_Item__c' }).catch(() => ({
      fields: [],
    })),
    salesforceObjectFields({ objectName: 'Product2' }).catch(() => ({
      fields: [],
    })),
    salesforceObjectFields({ objectName: 'STEM_Extra_Cost__c' }).catch(() => ({ fields: [] })),
  ]);
  const fieldNames = describe.fields.map((f) => f.name);
  const lineItemUomField = findDashboardUomField(lineItemDescribe.fields, 'lineItem');
  const productUomField = findDashboardUomField(productDescribe.fields, 'product');
  const originalSupplierLookup = resolveOriginalSupplierLookup(lineItemDescribe.fields || []);
  const originalSupplierRelationship = originalSupplierLookup.relationshipName || 'Original_Supplier__r';
  const extraCostFieldNames = new Set((extraCostDescribe.fields || []).map((field) => field.name));
  const extraCostProductLookup = (extraCostDescribe.fields || []).find((field) => ['Product2Id__c', 'Product__c'].includes(field.name) && field.relationshipName);
  const extraCostSupplierLookup = resolveExtraCostSupplierLookup(extraCostDescribe.fields || []);
  const extraCostSupplierField = extraCostSupplierLookup.fieldName;
  const extraCostSupplierRelationship = extraCostSupplierLookup.relationshipName;
  if (dateBasis && dateBasis !== EXCEPTION_REVIEW_DATE_BASIS) {
    throw new Error(`Unsupported dashboard date basis: ${dateBasis}`);
  }
  const exceptionScheduleMode = dateBasis === EXCEPTION_REVIEW_DATE_BASIS;
  const requestMode = body.mode === 'exception_review' || exceptionScheduleMode ? 'exception_review' : 'dashboard';
  const exceptionReviewMode = requestMode === 'exception_review';
  const missingScheduleFields = exceptionScheduleMode ? exceptionScheduleSchemaIssues(fieldNames) : [];
  if (missingScheduleFields.length) {
    throw new Error(`Exception Review Schedule schema error: missing Salesforce STEM fields ${missingScheduleFields.join(', ')}.`);
  }
  let effectiveWhere;
  try {
    effectiveWhere = exceptionScheduleMode
      ? buildExceptionReviewScheduleWhere(dateWindows)
      : internalOptions.serverWhere || buildDashboardDateScopeWhere(dateWindows, fieldNames);
  } catch (error) {
    throw appError(error.message || 'Dashboard date scope is invalid.', 400, 'INVALID_DASHBOARD_DATE_SCOPE');
  }
  const accountDescribe = fieldNames.includes('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({
        fields: [],
      }))
    : { fields: [] };
  const accountFieldNames = (accountDescribe.fields || []).map((field) => field.name);
  const accountFieldNameSet = new Set(accountFieldNames);
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames, accountFieldNames);

  const hasStatus = fieldNames.includes('Status__c');
  const hasType = fieldNames.includes('Type__c');
  const hasDispute = fieldNames.includes('Dispute__c');
  const hasDisputeStatus = fieldNames.includes('Dispute_Status__c');
  const hasDisputeType = fieldNames.includes('Dispute_Type__c');
  const hasDisputeParticular = fieldNames.includes('Dispute_Particular__c');
  const accountField = fieldNames.includes('Account__c') ? 'Account__c' : fieldNames.includes('AccountId') ? 'AccountId' : null;
  const buyerAmountField = fieldNames.includes('Total_Invoice_Amount__c') ? 'Total_Invoice_Amount__c' : null;
  const supplierAmountField = fieldNames.includes('Total_Invoiced_Amount_From_Suppliers__c') ? 'Total_Invoiced_Amount_From_Suppliers__c' : null;
  const totalCostsField = fieldNames.includes('Costs_Total__c') ? 'Costs_Total__c' : null;
  const buyerNameField = fieldNames.includes('Buyer_Name__c') ? 'Buyer_Name__c' : fieldNames.includes('Buyer__c') ? 'Buyer__c' : null;
  const expectedDeliveryField = fieldNames.includes('Expected_Delivery_Date__c') ? 'Expected_Delivery_Date__c' : null;
  const disputeCondition = disputeOnly ? (hasDisputeStatus ? "Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null" : hasDispute ? 'Dispute__c = true' : '') : '';
  const normalizedPortCountry = String(portCountry || '').trim();
  const portCountryLike = normalizedPortCountry ? `%${escapeSoql(normalizedPortCountry)}%` : '';
  const portCountryCondition = normalizedPortCountry ? `(Port__r.Country__c LIKE '${portCountryLike}' OR Port__r.Name LIKE '${portCountryLike}')` : '';
  const normalizedCompanyKeyword = String(companyKeyword || '').trim();
  const companyMode = companyFilterMode === 'supplier' ? 'supplier' : 'buyer';
  const companyLike = normalizedCompanyKeyword ? `%${escapeSoql(normalizedCompanyKeyword)}%` : '';
  const supplierCompanyFilterActive = Boolean(normalizedCompanyKeyword && companyMode === 'supplier');
  const companyMatches = (name) =>
    !normalizedCompanyKeyword ||
    String(name || '')
      .toLowerCase()
      .includes(normalizedCompanyKeyword.toLowerCase());
  const companyCondition = normalizedCompanyKeyword ? (companyMode === 'supplier' ? `Id IN (SELECT STEM__c FROM STEM_Line_Item__c WHERE Supplier_Name__c LIKE '${companyLike}' AND Cancelled__c = false)` : buyerNameField ? [`${buyerNameField} LIKE '${companyLike}'`, accountField ? `Account__r.Group_Name__c LIKE '${companyLike}'` : '', accountField ? `Account__r.Parent.Name LIKE '${companyLike}'` : ''].filter(Boolean).join(' OR ') : '') : '';
  const baseWhereConditions = [effectiveWhere, companyCondition, interofficeCondition].filter(Boolean);
  const baseWhere = combineWhereConditions(baseWhereConditions);
  const combinedWhere = combineWhereConditions([...baseWhereConditions, disputeCondition]);
  const whereClause = combinedWhere ? `WHERE ${combinedWhere}` : '';
  const monthlyDateCondition = `(Delivery_Date__c >= ${currentYear}-01-01 AND Delivery_Date__c <= ${currentYear}-12-31)${expectedDeliveryField ? ` OR (Delivery_Date__c = null AND ${expectedDeliveryField} >= ${currentYear}-01-01 AND ${expectedDeliveryField} <= ${currentYear}-12-31)` : ''}`;
  const monthlyWhere = combineWhereConditions([monthlyDateCondition, disputeCondition, portCountryCondition, companyCondition, interofficeCondition]);
  const monthlyWhereClause = monthlyWhere ? `WHERE ${monthlyWhere}` : '';

  const plFields = ['Id', 'Name', 'CreatedDate'];
  if (fieldNames.includes('Delivery_Date__c')) plFields.push('Delivery_Date__c');
  if (expectedDeliveryField) plFields.push(expectedDeliveryField);
  if (fieldNames.includes('ETA_Start_Date__c')) plFields.push('ETA_Start_Date__c');
  if (buyerNameField) plFields.push(buyerNameField);
  if (accountField) {
    plFields.push(accountField, 'Account__r.Name');
    if (accountFieldNameSet.has('Company_Code__c')) plFields.push('Account__r.Company_Code__c');
    if (accountFieldNameSet.has('Inactive_Suspended__c')) plFields.push('Account__r.Inactive_Suspended__c');
    if (accountFieldNameSet.has('RecordTypeId')) plFields.push('Account__r.RecordType.Name');
    if (accountFieldNames.includes('Group_Name__c')) plFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.includes('ParentId')) {
      plFields.push('Account__r.ParentId', 'Account__r.Parent.Name');
      if (accountFieldNameSet.has('Company_Code__c')) plFields.push('Account__r.Parent.Company_Code__c');
      if (accountFieldNameSet.has('Inactive_Suspended__c')) plFields.push('Account__r.Parent.Inactive_Suspended__c');
      if (accountFieldNameSet.has('RecordTypeId')) plFields.push('Account__r.Parent.RecordType.Name');
    }
  }
  if (hasDisputeStatus) plFields.push('Dispute_Status__c');
  if (hasDispute) plFields.push('Dispute__c');
  if (hasDisputeType) plFields.push('Dispute_Type__c');
  if (hasDisputeParticular) plFields.push('Dispute_Particular__c');
  if (buyerAmountField) plFields.push(buyerAmountField);
  if (supplierAmountField) plFields.push(supplierAmountField);
  if (totalCostsField) plFields.push(totalCostsField);
  if (fieldNames.includes('QLIK_STEM_Line_Item_Total_Cost__c')) plFields.push('QLIK_STEM_Line_Item_Total_Cost__c');
  if (fieldNames.includes('QLIK_Costs_Total_Cost__c')) plFields.push('QLIK_Costs_Total_Cost__c');
  if (fieldNames.includes('KeyStem__c')) plFields.push('KeyStem__c');
  if (fieldNames.includes('Port__c')) plFields.push('Port__c', 'Port__r.Name', 'Port__r.Country__c');
  if (exceptionScheduleMode) {
    for (const field of EXCEPTION_SCHEDULE_FIELDS) {
      if (!plFields.includes(field)) plFields.push(field);
    }
  }

  const queries = [
    {
      soql: `SELECT COUNT(Id) total FROM stem__c ${whereClause}`,
      softFail: true,
    },
    !exceptionReviewMode && hasStatus
      ? {
          soql: `SELECT Status__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Status__c`,
          softFail: true,
        }
      : null,
    !exceptionReviewMode && hasType
      ? {
          soql: `SELECT Type__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Type__c`,
          softFail: true,
        }
      : null,
    {
      soql: `SELECT ${plFields.join(', ')} FROM stem__c ${whereClause} ORDER BY Delivery_Date__c DESC NULLS LAST, CreatedDate DESC LIMIT 3000`,
      limit: 3000,
      softFail: true,
    },
    !exceptionReviewMode && hasDisputeStatus
      ? {
          soql: `SELECT COUNT(Id) total FROM stem__c WHERE Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null${baseWhere ? ` AND (${baseWhere})` : ''}`,
          softFail: true,
        }
      : !exceptionReviewMode && hasDispute
        ? {
            soql: `SELECT COUNT(Id) total FROM stem__c WHERE Dispute__c = true${baseWhere ? ` AND (${baseWhere})` : ''}`,
            softFail: true,
          }
        : null,
    !exceptionReviewMode && accountField
      ? {
          soql: `SELECT ${accountField} acct, COUNT(Id) cnt FROM stem__c ${whereClause} GROUP BY ${accountField}`,
          softFail: true,
        }
      : null,
    !exceptionReviewMode && buyerAmountField
      ? {
          soql: `SELECT SUM(${buyerAmountField}) total FROM stem__c ${whereClause}`,
          softFail: true,
        }
      : null,
    !exceptionReviewMode && supplierAmountField
      ? {
          soql: `SELECT SUM(${supplierAmountField}) total FROM stem__c ${whereClause}`,
          softFail: true,
        }
      : null,
    !exceptionReviewMode && totalCostsField
      ? {
          soql: `SELECT SUM(${totalCostsField}) total FROM stem__c ${whereClause}`,
          softFail: true,
        }
      : null,
    !exceptionReviewMode
      ? {
          soql: `SELECT Id, Delivery_Date__c, ${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'}, ${totalCostsField || 'Costs_Total__c'}, QLIK_STEM_Line_Item_Total_Cost__c, QLIK_Costs_Total_Cost__c FROM stem__c ${whereClause} LIMIT 3000`,
          limit: 3000,
          softFail: true,
        }
      : null,
    !exceptionReviewMode
      ? {
          soql: `SELECT Id, Delivery_Date__c${expectedDeliveryField ? `, ${expectedDeliveryField}` : ''}, ${buyerNameField ? `${buyerNameField}, ` : ''}${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'}, QLIK_STEM_Line_Item_Total_Cost__c, QLIK_Costs_Total_Cost__c FROM stem__c ${monthlyWhereClause} LIMIT 3000`,
          limit: 3000,
          softFail: true,
        }
      : null,
  ];

  const results = await compositeQueryBatch(queries);
  const totalRes = results[0];
  const statusRes = results[1];
  const typeRes = results[2];
  const recentRes = results[3];
  const disputedRes = results[4];
  const accountsRes = results[5];
  const allStemsRes = exceptionReviewMode ? recentRes : results[9];
  const monthlyStemsRes = results[10];

  const allStemIds = [...new Set([...(allStemsRes.records || []).map((s) => s.Id), ...(monthlyStemsRes.records || []).map((s) => s.Id)])];
  const stemById = {};
  for (const stem of [...(allStemsRes.records || []), ...(monthlyStemsRes.records || [])]) stemById[stem.Id] = stem;
  const monthlyMonthByStem = {};
  for (const stem of monthlyStemsRes.records || []) {
    const effectiveDate = stem.Delivery_Date__c || stem.Expected_Delivery_Date__c;
    const month = Number(String(effectiveDate || '').split('-')[1]);
    if (stem.Id && month >= 1 && month <= 12) monthlyMonthByStem[stem.Id] = month;
  }

  let lineItems = [];
  let buyerBrokers = [];
  let extraCosts = [];
  if (allStemIds.length > 0) {
    const lineItemFields = ['Id', 'STEM__c', 'Total_Price__c', 'Total_Cost__c', 'Supplier_Invoice__c', 'Cancelled__c', 'Supplier_Name__c', 'Buyers_Brokers_Commission_Per_Unit__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_Max__c', 'Quantity_in_MT__c', 'Is_Quantity_Range__c', 'Product__r.Name', 'Product__r.Family', 'Price_Per_Unit__c', 'Cost_Per_Unit__c', 'Unit_Sell_At__c', 'Unit_Buy_At__c', 'Unit_Cost__c', 'Subtotal_Sell_At__c', 'Subtotal_Buy_At__c', 'Commission_Cost__c', 'Suppliers_Brokers_Commission_Per_Unit__c', 'Supplier_Broker__r.Name', 'Buyers_Broker__r.Name', 'Offer_Line_Item__r.UnitPrice', 'Offer_Line_Item__r.Supplier_Unit_Price__c'];
    if (originalSupplierLookup.valid) {
      lineItemFields.push('Original_Supplier__c', `${originalSupplierRelationship}.Name`);
      if (accountFieldNameSet.has('Company_Code__c')) lineItemFields.push(`${originalSupplierRelationship}.Company_Code__c`);
      if (accountFieldNameSet.has('Inactive_Suspended__c')) lineItemFields.push(`${originalSupplierRelationship}.Inactive_Suspended__c`);
    }
    if (lineItemUomField) lineItemFields.push(lineItemUomField);
    if (productUomField) lineItemFields.push(`Product__r.${productUomField}`);
    const stemChunks = chunkIds(allStemIds);
    const [lineItemChunks, buyerBrokerChunks, extraCostChunks] = await Promise.all([
      compositeQueryRows(
        stemChunks.map((chunk) => {
          const inList = chunk.map((id) => `'${id}'`).join(',');
          return {
            soql: `SELECT ${lineItemFields.join(', ')} FROM STEM_Line_Item__c WHERE STEM__c IN (${inList}) LIMIT 2000`,
            limit: 2000,
            softFail: true,
          };
        }),
      ),
      compositeQueryRows(
        stemChunks.map((chunk) => {
          const inList = chunk.map((id) => `'${id}'`).join(',');
          return {
            soql: `SELECT STEM__c, Commission_Lumpsum__c FROM STEM_Buyer_Broker__c WHERE STEM__c IN (${inList}) LIMIT 2000`,
            limit: 2000,
            softFail: true,
          };
        }),
      ),
      compositeQueryRows(
        stemChunks.map((chunk) => {
          const inList = chunk.map((id) => `'${id}'`).join(',');
          const identityFields = [extraCostFieldNames.has('Name') ? 'Name' : '', extraCostFieldNames.has('Description__c') ? 'Description__c' : '', extraCostProductLookup ? `${extraCostProductLookup.relationshipName}.Name` : '', extraCostSupplierLookup.valid ? extraCostSupplierField : '', extraCostSupplierLookup.valid && extraCostSupplierRelationship ? `${extraCostSupplierRelationship}.Name` : '', extraCostSupplierLookup.valid && extraCostSupplierRelationship && accountFieldNameSet.has('Company_Code__c') ? `${extraCostSupplierRelationship}.Company_Code__c` : '', extraCostSupplierLookup.valid && extraCostSupplierRelationship && accountFieldNameSet.has('Inactive_Suspended__c') ? `${extraCostSupplierRelationship}.Inactive_Suspended__c` : ''].filter(Boolean);
          return {
            soql: `SELECT Id, STEM__c, Supplier_Name__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Cancelled__c${identityFields.length ? `, ${identityFields.join(', ')}` : ''} FROM STEM_Extra_Cost__c WHERE STEM__c IN (${inList}) LIMIT 2000`,
            limit: 2000,
            softFail: true,
          };
        }),
      ),
    ]);
    lineItems = lineItemChunks.flat();
    buyerBrokers = buyerBrokerChunks.flat();
    extraCosts = extraCostChunks.flat();
  }

  const lineItemSellByStem = {};
  const extraCostSellByStem = {};
  const extraCostBuyByStem = {};
  const invoicedExtraCostBuyByStem = {};
  const sellOnlyExtraSellByStem = {};
  const extraCostNamesByStem = {};
  for (const ec of extraCosts) {
    if (!ec.STEM__c || ec.Cancelled__c) continue;
    const extraCostIdentity = [extraCostProductLookup ? ec[extraCostProductLookup.relationshipName]?.Name : null, ec.Description__c, ec.Name].map((value) => String(value || '').trim()).filter(Boolean);
    if (extraCostIdentity.length) {
      if (!extraCostNamesByStem[ec.STEM__c]) extraCostNamesByStem[ec.STEM__c] = new Set();
      for (const value of extraCostIdentity) extraCostNamesByStem[ec.STEM__c].add(value);
    }
    const stemHasDelivery = !!stemById[ec.STEM__c]?.Delivery_Date__c;
    const buy = extraBuyAmount(ec, stemHasDelivery);
    const sell = extraSellAmount(ec, stemHasDelivery);
    extraCostSellByStem[ec.STEM__c] = (extraCostSellByStem[ec.STEM__c] || 0) + sell;
    if (ec.Supplier_Invoice__c) invoicedExtraCostBuyByStem[ec.STEM__c] = (invoicedExtraCostBuyByStem[ec.STEM__c] || 0) + buy;
    if (!ec.Supplier_Invoice__c) extraCostBuyByStem[ec.STEM__c] = (extraCostBuyByStem[ec.STEM__c] || 0) + buy;
    if (!ec.Supplier_Invoice__c && buy === 0 && sell > 0) sellOnlyExtraSellByStem[ec.STEM__c] = (sellOnlyExtraSellByStem[ec.STEM__c] || 0) + sell;
  }

  const supplierLineBuyByStem = {};
  const uninvoicedSupplierLineBuyByStem = {};
  const hasSupplierInvoiceByStem = {};
  const brokerByStem = {};
  const filteredStemIds = new Set((allStemsRes.records || []).map((stem) => stem.Id));
  const productFamilyQuantityByUnit = new Map();
  const monthlyProductVolumeByUnit = new Map();
  const supplierNamesByStem = {};
  const supplierAccountsByStem = {};
  const supplierNamesInFilteredStems = new Set();
  const supplierWeightByStem = {};
  const supplierInvoiceAmountByStem = {};
  const unassignedExtraCostBuyByStem = {};
  const productQuantitiesByStem = {};
  const stemsWithUncancelledLineProductItems = new Set();
  const addSupplierInvoiceAmount = (stemId, supplierName, amount) => {
    if (!stemId) return;
    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount === 0) return;
    const name = String(supplierName || '').trim() || 'Unspecified Supplier';
    if (!supplierInvoiceAmountByStem[stemId]) supplierInvoiceAmountByStem[stemId] = {};
    supplierInvoiceAmountByStem[stemId][name] = (supplierInvoiceAmountByStem[stemId][name] || 0) + numericAmount;
  };
  const addSupplierAccount = (stemId, accountId, name, clKey, inactive) => {
    const accountKey = disputeSalesforceIdKey(accountId);
    if (!stemId || !accountKey || inactive === true) return;
    if (!supplierAccountsByStem[stemId]) supplierAccountsByStem[stemId] = new Map();
    const existing = supplierAccountsByStem[stemId].get(accountKey);
    supplierAccountsByStem[stemId].set(accountKey, {
      accountId: existing?.accountId || accountId,
      name: existing?.name || String(name || 'Supplier name unavailable').trim(),
      clKey: existing?.clKey || String(clKey || '').trim(),
      inactive: false,
    });
  };
  for (const li of lineItems) {
    const id = li.STEM__c;
    if (!id || li.Cancelled__c) continue;
    stemsWithUncancelledLineProductItems.add(id);
    const stemHasDelivery = !!stemById[id]?.Delivery_Date__c;
    const lineSell = lineSellAmount(li, stemHasDelivery);
    const lineBuy = lineBuyAmount(li, stemHasDelivery);
    const dashboardFamily = dashboardProductFamily(li);
    const dashboardVolume = dashboardLineItemVolume(li, stemHasDelivery, {
      lineItemUomField,
      productUomField,
      fallbackQuantity: financialQuantity(li, stemHasDelivery),
      productFamily: dashboardFamily,
    });
    const productName = li['Product__r']?.Name || li.Name || 'Unspecified';
    const supplierAccount = originalSupplierLookup.valid ? li[originalSupplierRelationship] || {} : {};
    const supplierName = supplierAccount.Inactive_Suspended__c === true ? '' : String(li.Supplier_Name__c || '').trim();
    addSupplierAccount(id, li.Original_Supplier__c, supplierAccount.Name || supplierName, supplierAccount.Company_Code__c, supplierAccount.Inactive_Suspended__c);
    addSupplierInvoiceAmount(id, supplierName, lineBuy);
    const supplierMatchesCompanyFilter = !supplierCompanyFilterActive || companyMatches(supplierName);
    if (supplierMatchesCompanyFilter) {
      if (!productQuantitiesByStem[id]) productQuantitiesByStem[id] = [];
      productQuantitiesByStem[id].push({
        productName,
        quantityLabel: dashboardVolumeLabel(dashboardVolume),
        unitOfMeasure: dashboardVolume.unitOfMeasure,
      });
    }
    if (supplierName) {
      if (!supplierNamesByStem[id]) supplierNamesByStem[id] = new Set();
      supplierNamesByStem[id].add(supplierName);
      if (supplierMatchesCompanyFilter) {
        if (filteredStemIds.has(id)) supplierNamesInFilteredStems.add(supplierName);
        if (!supplierWeightByStem[id]) supplierWeightByStem[id] = {};
        const supplierWeight = Math.abs(lineSell) || Math.abs(lineBuy) || financialQuantity(li, stemHasDelivery) || 1;
        supplierWeightByStem[id][supplierName] = (supplierWeightByStem[id][supplierName] || 0) + supplierWeight;
      }
    }
    if (filteredStemIds.has(id) && supplierMatchesCompanyFilter) {
      const family = dashboardFamily;
      const volumeKey = `${family}\u001f${dashboardVolume.unitOfMeasure}`;
      const current = productFamilyQuantityByUnit.get(volumeKey) || {
        family,
        unitOfMeasure: dashboardVolume.unitOfMeasure,
        quantity: 0,
      };
      current.quantity += Number(dashboardVolume.quantity || 0);
      productFamilyQuantityByUnit.set(volumeKey, current);
    }
    const monthlyFamily = dashboardFamily;
    const monthlyMonth = monthlyMonthByStem[id];
    if (monthlyMonth && supplierMatchesCompanyFilter) {
      const volumeKey = `${monthlyFamily}\u001f${dashboardVolume.unitOfMeasure}`;
      const current = monthlyProductVolumeByUnit.get(volumeKey) || {
        family: monthlyFamily,
        unitOfMeasure: dashboardVolume.unitOfMeasure,
        months: Array(12).fill(0),
      };
      current.months[monthlyMonth - 1] += Number(dashboardVolume.quantity || 0);
      monthlyProductVolumeByUnit.set(volumeKey, current);
    }
    lineItemSellByStem[id] = (lineItemSellByStem[id] || 0) + lineSell;
    supplierLineBuyByStem[id] = (supplierLineBuyByStem[id] || 0) + lineBuy;
    if (!li.Supplier_Invoice__c) {
      uninvoicedSupplierLineBuyByStem[id] = (uninvoicedSupplierLineBuyByStem[id] || 0) + lineBuy;
    }
    if (li.Supplier_Invoice__c) hasSupplierInvoiceByStem[id] = true;

    if (!brokerByStem[id])
      brokerByStem[id] = {
        buyerComm: 0,
        suppCommPerUnit: 0,
        suppBrokerName: null,
        buyerBrokerName: null,
      };
    brokerByStem[id].buyerComm += buyerBrokerCommission(li, stemHasDelivery);
    brokerByStem[id].suppCommPerUnit += supplierBrokerCommission(li, stemHasDelivery);
    if (!brokerByStem[id].suppBrokerName && li['Supplier_Broker__r']?.Name) brokerByStem[id].suppBrokerName = li['Supplier_Broker__r'].Name;
    if (!brokerByStem[id].buyerBrokerName && li['Buyers_Broker__r']?.Name) brokerByStem[id].buyerBrokerName = li['Buyers_Broker__r'].Name;
  }
  for (const ec of extraCosts) {
    if (!ec.STEM__c || ec.Cancelled__c) continue;
    const stemHasDelivery = !!stemById[ec.STEM__c]?.Delivery_Date__c;
    const buy = extraBuyAmount(ec, stemHasDelivery);
    const supplierAccount = extraCostSupplierRelationship ? ec[extraCostSupplierRelationship] || {} : {};
    const supplierName = supplierAccount.Inactive_Suspended__c === true ? '' : String(ec.Supplier_Name__c || '').trim();
    addSupplierAccount(ec.STEM__c, extraCostSupplierField ? ec[extraCostSupplierField] : null, supplierAccount.Name || supplierName, supplierAccount.Company_Code__c, supplierAccount.Inactive_Suspended__c);
    if (supplierName) {
      addSupplierInvoiceAmount(ec.STEM__c, supplierName, buy);
      if (!supplierNamesByStem[ec.STEM__c]) supplierNamesByStem[ec.STEM__c] = new Set();
      supplierNamesByStem[ec.STEM__c].add(supplierName);
      if (filteredStemIds.has(ec.STEM__c) && (!supplierCompanyFilterActive || companyMatches(supplierName))) {
        supplierNamesInFilteredStems.add(supplierName);
      }
    } else {
      unassignedExtraCostBuyByStem[ec.STEM__c] = (unassignedExtraCostBuyByStem[ec.STEM__c] || 0) + buy;
    }
  }
  for (const bb of buyerBrokers) {
    if (!bb.STEM__c) continue;
    if (!brokerByStem[bb.STEM__c])
      brokerByStem[bb.STEM__c] = {
        buyerComm: 0,
        suppCommPerUnit: 0,
        suppBrokerName: null,
        buyerBrokerName: null,
      };
    brokerByStem[bb.STEM__c].buyerComm += bb.Commission_Lumpsum__c ?? 0;
  }

  const bf = buyerAmountField || 'Total_Invoice_Amount__c';
  const sf2 = supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c';
  const cf = totalCostsField || 'Costs_Total__c';

  const calculateStem = (stem) => {
    const calculatedBuyer = (lineItemSellByStem[stem.Id] || 0) + (extraCostSellByStem[stem.Id] || 0);
    const buyer = !stem.Delivery_Date__c && calculatedBuyer > 0 ? calculatedBuyer : stem[bf];
    const invoicedSupplier = stem[sf2] ?? 0;
    const supplierLineBuy = supplierLineBuyByStem[stem.Id] || 0;
    const uninvoicedSupplierLineBuy = uninvoicedSupplierLineBuyByStem[stem.Id] || 0;
    const supplierBase = invoicedSupplier + (hasSupplierInvoiceByStem[stem.Id] ? uninvoicedSupplierLineBuy : supplierLineBuy);
    const extraCostBuy = extraCostBuyByStem[stem.Id] || 0;
    const rawSupplier = supplierBase + extraCostBuy;
    const unmatchedSellOnlyExtra = hasSupplierInvoiceByStem[stem.Id] ? Math.max(0, (sellOnlyExtraSellByStem[stem.Id] || 0) - (invoicedExtraCostBuyByStem[stem.Id] || 0)) : 0;
    const qlikSupplierCost = stem.QLIK_STEM_Line_Item_Total_Cost__c != null || stem.QLIK_Costs_Total_Cost__c != null ? (stem.QLIK_STEM_Line_Item_Total_Cost__c || 0) + (stem.QLIK_Costs_Total_Cost__c || 0) : null;
    const supplierOverstatement = qlikSupplierCost == null ? 0 : rawSupplier - qlikSupplierCost;
    const supplier = unmatchedSellOnlyExtra > 0 && supplierOverstatement > 0 && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05 ? qlikSupplierCost : rawSupplier;
    const buyerComm = brokerByStem[stem.Id]?.buyerComm || 0;
    const suppCommPerUnit = brokerByStem[stem.Id]?.suppCommPerUnit || 0;
    const brokerCommissions = buyerComm + suppCommPerUnit;
    return {
      buyer,
      supplier,
      extraCostBuy,
      buyerComm,
      suppCommPerUnit,
      brokerCommissions,
      netPnl: buyer != null ? buyer - supplier - brokerCommissions : null,
    };
  };

  const allocateStemPnlToSuppliers = (stem, netPnl) => {
    if (netPnl == null) return [];
    const weights = supplierWeightByStem[stem.Id] || {};
    const entries = Object.entries(weights).filter(([name]) => name);
    if (!entries.length) return [];
    const totalWeight = entries.reduce((sum, [, weight]) => sum + Math.max(Number(weight) || 0, 0), 0);
    if (totalWeight <= 0) {
      const equalShare = netPnl / entries.length;
      return entries.map(([name]) => ({ name, netPnl: equalShare }));
    }
    return entries.map(([name, weight]) => ({
      name,
      netPnl: netPnl * (Math.max(Number(weight) || 0, 0) / totalWeight),
    }));
  };

  const recentStems = (recentRes.records || []).map((stem) => {
    const calc = calculateStem(stem);
    const supplierNames = [...(supplierNamesByStem[stem.Id] || [])].sort();
    const productQuantities = productQuantitiesByStem[stem.Id] || [];
    const extraCostNames = [...(extraCostNamesByStem[stem.Id] || [])].sort();
    const buyerAccount = stem['Account__r'] || {};
    const buyerGroupAccount = buyerAccount.ParentId && buyerAccount.Parent?.Inactive_Suspended__c !== true ? {
      accountId: buyerAccount.ParentId,
      name: buyerAccount.Parent?.Name || buyerAccount.Group_Name__c || 'GROUP name unavailable',
      clKey: buyerAccount.Parent?.Company_Code__c || '',
      inactive: false,
      recordType: buyerAccount.Parent?.RecordType?.Name || 'Group',
    } : null;
    const buyerGroup = buyerAccount.Parent?.Inactive_Suspended__c === true ? null : buyerGroupAccount?.name || buyerAccount.Group_Name__c || null;
    const buyerAccountIdentity = stem[accountField] && buyerAccount.Inactive_Suspended__c !== true ? {
      accountId: stem[accountField],
      name: buyerAccount.Name || stem[buyerNameField] || 'Buyer name unavailable',
      clKey: buyerAccount.Company_Code__c || '',
      inactive: false,
      recordType: buyerAccount.RecordType?.Name || null,
    } : null;
    const supplierAccounts = [...(supplierAccountsByStem[stem.Id]?.values() || [])]
      .sort((left, right) => left.name.localeCompare(right.name) || left.accountId.localeCompare(right.accountId));
    const port = stem['Port__r'] || {};
    const supplierAmountMap = {
      ...(supplierInvoiceAmountByStem[stem.Id] || {}),
    };
    if (unassignedExtraCostBuyByStem[stem.Id]) {
      supplierAmountMap['Unassigned Extra Costs'] = (supplierAmountMap['Unassigned Extra Costs'] || 0) + unassignedExtraCostBuyByStem[stem.Id];
    }
    let supplierInvoiceAmountList = Object.entries(supplierAmountMap)
      .map(([supplierName, amount]) => ({
        supplierName,
        amount: Number(amount || 0),
      }))
      .filter((item) => item.amount !== 0)
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName));
    const supplierListTotal = supplierInvoiceAmountList.reduce((sum, item) => sum + item.amount, 0);
    const supplierDiff = Number(calc.supplier || 0) - supplierListTotal;
    if (Math.abs(supplierDiff) > 0.05) {
      if (!supplierInvoiceAmountList.length) {
        supplierInvoiceAmountList = [
          {
            supplierName: 'Supplier Invoice Amount',
            amount: Number(calc.supplier || 0),
          },
        ];
      } else {
        const denominator = supplierInvoiceAmountList.reduce((sum, item) => sum + Math.abs(item.amount), 0) || supplierInvoiceAmountList.length;
        supplierInvoiceAmountList = supplierInvoiceAmountList.map((item) => {
          const ratio = denominator === supplierInvoiceAmountList.length ? 1 / supplierInvoiceAmountList.length : Math.abs(item.amount) / denominator;
          return { ...item, amount: item.amount + supplierDiff * ratio };
        });
      }
    }
    return {
      ...stem,
      ...(buyerNameField && buyerAccount.Inactive_Suspended__c === true ? { [buyerNameField]: 'Account unavailable' } : {}),
      [bf]: calc.buyer ?? null,
      [sf2]: calc.supplier || null,
      _Buyer_Group: buyerGroup,
      _Buyer_Account: buyerAccountIdentity,
      _Buyer_Group_Account: buyerGroupAccount,
      _Port_Name: port.Name || null,
      _Port_Country: port.Country__c || null,
      _Exception_Schedule: exceptionScheduleMode ? normalizeExceptionSchedule(stem) : null,
      _Supplier_Name_List: supplierNames,
      _Supplier_Accounts: supplierAccounts,
      _Supplier_Names: supplierNames.join(', ') || null,
      _Supplier_Invoice_Amount_List: supplierInvoiceAmountList,
      _Has_Uncancelled_Line_Product_Item: stemsWithUncancelledLineProductItems.has(stem.Id),
      _Product_Quantity_List: productQuantities,
      _Product_Quantities: productQuantities.map((item) => `${item.productName} ${item.quantityLabel}`).join(', ') || null,
      _Extra_Cost_Name_List: extraCostNames,
      _Extra_Cost_Names: extraCostNames.join(', ') || null,
      _buyerBrokerName: brokerByStem[stem.Id]?.buyerBrokerName || null,
      _buyerBrokerComm: calc.buyerComm || null,
      _suppBrokerName: brokerByStem[stem.Id]?.suppBrokerName || null,
      _suppBrokerComm: calc.suppCommPerUnit || null,
      __buyerCommCalc: calc.buyerComm,
      __suppCommPerUnitCalc: calc.suppCommPerUnit,
      __extraCostBuyCalc: calc.extraCostBuy,
      __netPnlCalc: calc.netPnl,
    };
  });

  let totalProfit = 0;
  let totalInvoicedProfit = 0;
  let totalBuyer = 0;
  let totalSupplier = 0;
  let totalCosts = 0;
  let totalBrokerCommissions = 0;
  for (const stem of allStemsRes.records || []) {
    const calc = calculateStem(stem);
    if (calc.buyer == null) continue;
    totalProfit += calc.netPnl || 0;
    if (stem.Delivery_Date__c) totalInvoicedProfit += calc.netPnl || 0;
    totalBuyer += calc.buyer;
    totalSupplier += calc.supplier;
    totalBrokerCommissions += calc.brokerCommissions;
    totalCosts += stem[cf] ?? 0;
  }

  const buyerPnlMap = {};
  for (const stem of recentStems) {
    if (stem.Account__r?.Inactive_Suspended__c === true) continue;
    const buyerName = stem[buyerNameField] || null;
    if (buyerName && buyerName.toUpperCase().includes('COSULICH')) continue;
    if (!buyerName || stem[bf] == null || stem.__netPnlCalc == null) continue;
    buyerPnlMap[buyerName] = (buyerPnlMap[buyerName] || 0) + stem.__netPnlCalc;
  }
  const topBuyersByNetPnl = Object.entries(buyerPnlMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, pnl]) => ({ name, netPnl: pnl }));
  const supplierPnlMap = {};
  for (const stem of allStemsRes.records || []) {
    const calc = calculateStem(stem);
    if (calc.buyer == null || calc.netPnl == null) continue;
    for (const allocation of allocateStemPnlToSuppliers(stem, calc.netPnl)) {
      supplierPnlMap[allocation.name] = (supplierPnlMap[allocation.name] || 0) + allocation.netPnl;
    }
  }
  const topSuppliersByNetPnl = Object.entries(supplierPnlMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, pnl]) => ({ name, netPnl: pnl }));

  const monthlyTotals = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    netPnl: 0,
    turnover: 0,
  }));
  const buyerMonthTotals = {};
  const supplierMonthTotals = {};
  for (const stem of monthlyStemsRes.records || []) {
    const effectiveDate = stem.Delivery_Date__c || stem.Expected_Delivery_Date__c;
    if (!effectiveDate) continue;
    const calc = calculateStem(stem);
    if (calc.buyer == null) continue;
    const month = Number(String(effectiveDate).split('-')[1]);
    if (!month || month < 1 || month > 12) continue;
    monthlyTotals[month - 1].turnover += Number(calc.buyer || 0);
    monthlyTotals[month - 1].netPnl += calc.netPnl || 0;
    if (buyerNameField && stem[buyerNameField] && !String(stem[buyerNameField]).toUpperCase().includes('COSULICH')) {
      const buyerName = stem[buyerNameField];
      if (!buyerMonthTotals[buyerName]) buyerMonthTotals[buyerName] = Array(12).fill(0);
      buyerMonthTotals[buyerName][month - 1] += calc.netPnl || 0;
    }
    for (const allocation of allocateStemPnlToSuppliers(stem, calc.netPnl)) {
      if (!supplierMonthTotals[allocation.name]) supplierMonthTotals[allocation.name] = Array(12).fill(0);
      supplierMonthTotals[allocation.name][month - 1] += allocation.netPnl || 0;
    }
  }
  const monthlyNetPnl = monthlyTotals.map((item) => ({
    month: item.month,
    label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][item.month - 1],
    netPnl: item.netPnl,
    turnover: item.turnover,
    grossMarginPct: grossMarginPercent(item.netPnl, item.turnover),
  }));
  const monthlyBuyerNames = Object.entries(buyerMonthTotals)
    .map(([name, months]) => ({
      name,
      total: months.reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((item) => item.name);
  const monthlyBuyerNetPnl = monthlyNetPnl.map((item, idx) => {
    const row = { month: item.month, label: item.label };
    for (const buyerName of monthlyBuyerNames) row[buyerName] = buyerMonthTotals[buyerName]?.[idx] || 0;
    return row;
  });
  const monthlySupplierNames = Object.entries(supplierMonthTotals)
    .map(([name, months]) => ({
      name,
      total: months.reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((item) => item.name);
  const monthlySupplierNetPnl = monthlyNetPnl.map((item, idx) => {
    const row = { month: item.month, label: item.label };
    for (const supplierName of monthlySupplierNames) row[supplierName] = supplierMonthTotals[supplierName]?.[idx] || 0;
    return row;
  });
  const productFamilyQuantities = [...productFamilyQuantityByUnit.values()].sort((a, b) => b.quantity - a.quantity);
  const productFamilyOrder = new Map([
    ['HSFO', 0],
    ['VLSFO', 1],
    ['LSMGO', 2],
  ]);
  const monthlyProductVolumeSeries = [...monthlyProductVolumeByUnit.values()]
    .sort((a, b) => {
      const familyDifference = (productFamilyOrder.get(a.family) ?? 99) - (productFamilyOrder.get(b.family) ?? 99);
      if (familyDifference) return familyDifference;
      const nameDifference = a.family.localeCompare(b.family);
      return nameDifference || a.unitOfMeasure.localeCompare(b.unitOfMeasure);
    })
    .map((series, index) => ({
      key: `volume_${index}`,
      family: series.family,
      unitOfMeasure: series.unitOfMeasure,
      months: series.months,
    }));
  const monthlyProductVolumes = monthlyNetPnl.map((item, idx) => {
    const row = {
      month: item.month,
      label: item.label,
      grossMarginPct: item.grossMarginPct,
    };
    for (const series of monthlyProductVolumeSeries) {
      row[series.key] = series.months[idx] || 0;
    }
    return row;
  });
  const missingFinancialUomCount = [...lineItems, ...extraCosts].filter((item) => {
    if (item.Cancelled__c) return false;
    return Boolean(nativeFinancialQuantity(item, {
      stemHasDelivery: Boolean(stemById[item.STEM__c]?.Delivery_Date__c),
      maxField: Object.prototype.hasOwnProperty.call(item, 'Quantity_Range_Max__c') ? 'Quantity_Range_Max__c' : 'Quantity_Max__c',
      lineItemUomField,
      productUomField,
    }).warning);
  }).length;

  return {
    mode: requestMode,
    stemTotal: totalRes.records?.[0]?.total ?? 0,
    accountCount: accountsRes.records ? accountsRes.records.filter((r) => r.acct != null).length : null,
    buyerAccountCount: accountsRes.records ? accountsRes.records.filter((r) => r.acct != null).length : null,
    supplierAccountCount: supplierNamesInFilteredStems.size,
    totalBuyer,
    totalSupplier,
    totalBrokerCommissions,
    totalProfit,
    totalInvoicedProfit,
    disputedCount: disputedRes.records?.[0]?.total ?? 0,
    stemByStatus: (statusRes.records || []).map((r) => ({
      label: r.val || 'Unknown',
      value: r.total,
    })),
    stemByType: (typeRes.records || []).map((r) => ({
      label: r.val || 'Unknown',
      value: r.total,
    })),
    recentStems,
    totalCosts,
    buyerAmountField,
    supplierAmountField,
    totalCostsField,
    accountField,
    topBuyersByNetPnl,
    topSuppliersByNetPnl,
    monthlyNetPnl,
    monthlyBuyerNetPnl,
    monthlyBuyerNames,
    monthlySupplierNetPnl,
    monthlySupplierNames,
    monthlyNetPnlYear: currentYear,
    productFamilyQuantities,
    monthlyProductVolumes,
    monthlyProductVolumeSeries: monthlyProductVolumeSeries.map((series) => ({
      key: series.key,
      family: series.family,
      unitOfMeasure: series.unitOfMeasure,
    })),
    dateBasis: exceptionScheduleMode ? EXCEPTION_REVIEW_DATE_BASIS : null,
    dataWarnings: missingFinancialUomCount
      ? [`${missingFinancialUomCount} financial line${missingFinancialUomCount === 1 ? '' : 's'} have no Salesforce UOM. Native quantities were used without inferred conversion.`]
      : [],
  };
}

async function salesforceDashboardFilteredFull(body, req = null, accessContext = null, internalOptions = {}) {
  const mode = body.mode === 'exception_review' || body.dateBasis === EXCEPTION_REVIEW_DATE_BASIS ? 'exception_review' : 'dashboard';
  const cachePayload = { ...body, mode };
  delete cachePayload.where;
  delete cachePayload.force;
  delete cachePayload.forceRefresh;
  delete cachePayload.refresh;
  if (internalOptions.serverWhere) {
    cachePayload.serverWhereHash = createHash('sha256').update(internalOptions.serverWhere).digest('hex');
  }
  const cached = await cachedSalesforceValue({
    namespace: `salesforce-dashboard-${mode}`,
    ttlSeconds: 60,
    payload: cachePayload,
    tags: ['salesforce:dashboard', `salesforce:dashboard:${mode}`, 'salesforce:stem'],
    body,
    req,
    accessContext,
    loader: () => salesforceDashboardFilteredUncached({ ...body, mode }, req, accessContext, internalOptions),
  });
  return cached.value;
}

async function dashboardAccountInsight(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return loadDashboardAccountInsight({
    body,
    accessContext: context,
    force: requestForcesRefresh(body, req),
  });
}

async function dashboardAccountCreditDirectory(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const directory = await loadDashboardAccountCreditDirectory({
    body,
    accessContext: context,
    force: requestForcesRefresh(body, req),
  });
  if (!['both', 'buyer', 'supplier'].includes(body.direction) || !directory?.accounts?.length) return directory;

  const financialFilters = {
    portIds: Array.isArray(body.filters?.portIds) ? body.filters.portIds : [],
    countryCodes: Array.isArray(body.filters?.countryCodes) ? body.filters.countryCodes : [],
  };
  const cached = await cachedSalesforceValue({
    namespace: 'dashboard-unified-account-directory-financials-v1',
    ttlSeconds: 60,
    payload: {
      dateWindows: body.dateWindows || [],
      disputeOnly: body.disputeOnly === true,
      filters: financialFilters,
    },
    tags: ['salesforce:dashboard', 'salesforce:account', 'salesforce:group', 'salesforce:stem', 'salesforce:line-item', 'salesforce:extra-cost'],
    body,
    req,
    accessContext: context,
    loader: async () => {
      const scope = await loadDecisionDashboardScope({
        dateWindows: body.dateWindows || [],
        disputeOnly: body.disputeOnly === true,
        counterpartyMode: 'buyer',
        filters: financialFilters,
      }, req, context);
      return {
        complete: scope.completeness.complete === true,
        buyers: dashboardAccountRankings(scope.rows, 'account'),
        suppliers: dashboardAccountRankings(scope.rows, 'supplier'),
      };
    },
  });
  const financials = cached.value;
  const aggregate = (rankings, memberAccountIds) => {
    const members = new Set((memberAccountIds || []).map((id) => String(id || '').slice(0, 15)));
    const byCurrency = new Map();
    for (const ranking of rankings || []) {
      if (!members.has(String(ranking.accountId || '').slice(0, 15))) continue;
      const currency = String(ranking.currency || 'USD').toUpperCase();
      byCurrency.set(currency, (byCurrency.get(currency) || 0) + Number(ranking.grossProfit ?? ranking.netPnl ?? 0));
    }
    return [...byCurrency.entries()]
      .map(([currency, grossProfit]) => ({ currency, grossProfit }))
      .sort((left, right) => left.currency.localeCompare(right.currency));
  };
  return {
    ...directory,
    accounts: directory.accounts.map((account) => ({
      ...account,
      buyerGrossProfitByCurrency: financials.complete ? aggregate(financials.buyers, account.memberAccountIds) : [],
      supplierGrossProfitByCurrency: financials.complete ? aggregate(financials.suppliers, account.memberAccountIds) : [],
      financialsComplete: financials.complete,
    })),
    meta: {
      ...directory.meta,
      financialsComplete: financials.complete,
      financialsCache: cached.cache?.status || null,
    },
  };
}

async function canManageDashboardCreditForecastSettings(context) {
  if (context?.profile?.user_type === 'administrator') return true;
  if (context?.profile?.user_type !== 'general_manager') return false;
  const activeGeneralManager = await loadActiveGeneralManager(context.client);
  return activeGeneralManager.id === context.profile.id;
}

async function dashboardAccountCreditStatement(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const forecastToday = dateOnly(new Date());
  const [forecastSettings, canManageForecastSettings, holidayData] = await Promise.all([
    loadCashflowSettings(),
    canManageDashboardCreditForecastSettings(context),
    loadCashflowHolidayData(yearsBetween(forecastToday, addDays(forecastToday, 730)), []),
  ]);
  return loadDashboardAccountCreditStatement({
    body: {
      ...body,
      _forecastSettings: forecastSettings,
      _canManageForecastSettings: canManageForecastSettings,
      _blockedForecastDates: [...holidayData.blockedMap.keys()],
    },
    accessContext: context,
    force: requestForcesRefresh(body, req),
  });
}

async function dashboardCreditForecastSettingsSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  if (!(await canManageDashboardCreditForecastSettings(context))) {
    throw appError('Only an Administrator or the active General Manager may change the company credit forecast setting.', 403, 'CREDIT_FORECAST_SETTINGS_FORBIDDEN');
  }
  const conservativeness = normalizeBuyerPaymentConservativeness(body.conservativeness, null);
  if (!conservativeness) throw appError('Credit forecast conservativeness must be typical, cautious, or severe.', 400, 'CREDIT_FORECAST_SETTINGS_INVALID');
  const expectedUpdatedAt = body.expectedUpdatedAt ? String(body.expectedUpdatedAt) : null;
  if (!expectedUpdatedAt) {
    throw appError('Reload the Credit Statement before changing the company forecast setting.', 409, 'CREDIT_FORECAST_SETTINGS_STALE');
  }
  const { data, error } = await context.client.rpc('save_credit_statement_conservativeness', {
    p_conservativeness: conservativeness,
    p_actor_user_id: context.profile.id,
    p_actor_email: context.profile.email,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    if (error.code === '40001' || /changed after/i.test(String(error.message || ''))) {
      throw appError('The company credit forecast setting changed after this chart was opened. Reload the statement before saving.', 409, 'CREDIT_FORECAST_SETTINGS_STALE');
    }
    throw error;
  }
  await Promise.all([
    expireRuntimeCacheTags(['salesforce:account-credit', 'dashboard:credit-forecast-settings']),
    writeAdminAudit(context.client, context.profile, 'dashboard_credit_forecast_setting_changed', null, null, {
      conservativeness,
    }),
  ]);
  return {
    forecastSettings: {
      companyConservativeness: conservativeness,
      updatedAt: data?.updatedAt || data?.updated_at || null,
      updatedByEmail: data?.updatedByEmail || data?.updated_by_email || context.profile.email,
      canManage: true,
    },
  };
}

async function dashboardCounterpartySearch(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return loadDashboardCounterpartySearch({ body, accessContext: context, force: requestForcesRefresh(body, req) });
}

async function dashboardAccountExposureBatch(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return loadDashboardAccountExposureBatch({ body, accessContext: context, force: requestForcesRefresh(body, req) });
}

async function dashboardAccountInsightExport(body = {}, req, res, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const insight = await loadDashboardAccountInsight({
    body: { ...body, cursor: 0, pageSize: 100 },
    accessContext: context,
    force: requestForcesRefresh(body, req),
    includeExportRows: true,
  });
  const generated = generateDashboardAccountInsightExport(insight, {
    format: body.format,
    actorName: context.profile.full_name || context.profile.email,
  });
  await writeAdminAudit(context.client, context.profile, 'dashboard_account_insight_exported', null, null, {
    format: String(body.format || '').toLowerCase(),
    role: insight.activeRole,
    periodMode: insight.period?.mode || null,
    stemCount: insight.kpis?.stemCount || 0,
  });
  const asciiFilename = generated.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.statusCode = 200;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', generated.contentType);
  res.setHeader('content-disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(generated.filename)}`);
  for (const [name, value] of Object.entries(telemetryResponseHeaders())) res.setHeader(name, value);
  res.end(generated.buffer);
}

async function stemPnlFull(body, req = null, accessContext = null) {
  const { dateWindows, limit = 500 } = body;
  let dateCondition;
  try {
    const describe = await salesforceObjectFields({ objectName: 'stem__c' });
    dateCondition = buildDashboardDateScopeWhere(dateWindows, describe.fields.map((field) => field.name));
  } catch (error) {
    throw appError(error.message || 'STEM P&L date scope is invalid.', 400, 'INVALID_STEM_PNL_DATE_SCOPE');
  }
  const interofficeCondition = await interofficeStemAccessCondition(accessContext);
  const combinedWhere = combineWhereConditions([dateCondition, interofficeCondition]);
  const whereClause = combinedWhere ? `WHERE ${combinedWhere}` : '';
  const stems = await queryRows(
    `
    SELECT Id, KeyStem__c, Name, Delivery_Date__c, Expected_Delivery_Date__c,
           Account__r.Name,
           Total_Invoice_Amount__c,
           Total_Invoiced_Amount_From_Suppliers__c,
           QLIK_STEM_Line_Item_Total_Cost__c,
           QLIK_Costs_Total_Cost__c,
           QLIK_Total_Profit__c
    FROM stem__c
    ${whereClause}
    ORDER BY Delivery_Date__c DESC NULLS LAST, CreatedDate DESC
    LIMIT ${Number(limit) || 500}
  `,
    { limit: Math.max(Number(limit) || 500, 500) },
  );

  if (!stems.length) {
    return {
      rows: [],
      totals: {
        count: 0,
        complete: 0,
        Buyer_Invoice: 0,
        Supplier_Invoice: 0,
        Costs: 0,
        Total_Broker_Comm: 0,
        Gross_Profit: 0,
        Net_Profit: 0,
      },
    };
  }

  const stemIds = stems.map((s) => s.Id);
  const idChunks = chunkIds(stemIds);
  const [lineItemArrays, buyerBrokerArrays, extraCostArrays, buyerInvoiceArrays] = await Promise.all([
    Promise.all(
      idChunks.map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(
          `
        SELECT Id, STEM__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
               Product__r.Name, Product__r.Family,
               Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c,
               Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Cancelled__c,
               Buyers_Brokers_Commission_Per_Unit__c,
               Buyers_Brokers_Commission_Lumpsum__c,
               Commission_Cost__c,
               Suppliers_Brokers_Commission_Per_Unit__c,
               Supplier_Broker__r.Name,
               Offer_Line_Item__r.UnitPrice,
               Offer_Line_Item__r.Supplier_Unit_Price__c
        FROM STEM_Line_Item__c
        WHERE STEM__c IN (${inList})
        LIMIT 2000
      `,
          { limit: 2000, softFail: true },
        );
      }),
    ),
    Promise.all(idChunks.map(() => Promise.resolve([]))),
    Promise.all(
      idChunks.map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(
          `
        SELECT STEM__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_in_MT__c,
               Quantity_Range_Max__c, Is_Quantity_Range__c,
               Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c,
               Supplier_Invoice__c, Cancelled__c
        FROM STEM_Extra_Cost__c
        WHERE STEM__c IN (${inList})
        LIMIT 5000
      `,
          { limit: 5000, softFail: true },
        );
      }),
    ),
    Promise.all(idChunks.map((chunk) => queryRows(
      `SELECT Id, Name, STEM__c, Proforma__c, Deprecated__c FROM Invoice__c WHERE STEM__c IN (${chunk.map((id) => `'${id}'`).join(',')}) LIMIT 5000`,
      { limit: 5000, softFail: true },
    ))),
  ]);

  const lineItems = lineItemArrays.flat();
  const buyerBrokerItems = buyerBrokerArrays.flat();
  const extraCosts = extraCostArrays.flat();
  const finalBuyerInvoiceStemIds = new Set(buyerInvoiceArrays.flat().filter(isFinalBuyerInvoice).map((invoice) => invoice.STEM__c).filter(Boolean));
  const stemById = Object.fromEntries(stems.map((stem) => [stem.Id, stem]));
  const byId = {};
  const initStem = (id) => {
    if (!byId[id])
      byId[id] = {
        suppBrokerComm: 0,
        buyerBrokerComm: 0,
        extraCostSell: 0,
        extraCostBuy: 0,
        invoicedExtraCostBuy: 0,
        sellOnlyExtraSell: 0,
        buyerLineSell: 0,
        supplierLineBuy: 0,
        uninvoicedSupplierLineBuy: 0,
        hasSupplierInvoice: false,
        suppBrokerName: null,
      };
  };

  for (const li of lineItems) {
    const id = li.STEM__c;
    if (!id) continue;
    initStem(id);
    if (li.Cancelled__c) continue;
    const stemHasDelivery = !!stemById[id]?.Delivery_Date__c;
    const lineSell = lineSellAmount(li, stemHasDelivery);
    const lineBuy = lineBuyAmount(li, stemHasDelivery);
    byId[id].buyerLineSell += lineSell;
    byId[id].supplierLineBuy += lineBuy;
    if (!li.Supplier_Invoice__c) byId[id].uninvoicedSupplierLineBuy += lineBuy;
    if (li.Supplier_Invoice__c) byId[id].hasSupplierInvoice = true;
    byId[id].suppBrokerComm += supplierBrokerCommission(li, stemHasDelivery);
    byId[id].buyerBrokerComm += buyerBrokerCommission(li, stemHasDelivery);
    if (!byId[id].suppBrokerName && li['Supplier_Broker__r']?.Name) byId[id].suppBrokerName = li['Supplier_Broker__r'].Name;
  }
  for (const bb of buyerBrokerItems) {
    if (!bb.STEM__c) continue;
    initStem(bb.STEM__c);
    byId[bb.STEM__c].buyerBrokerComm += bb.Commission_Lumpsum__c ?? 0;
  }
  for (const ec of extraCosts) {
    if (!ec.STEM__c || ec.Cancelled__c) continue;
    initStem(ec.STEM__c);
    const stemHasDelivery = !!stemById[ec.STEM__c]?.Delivery_Date__c;
    const buy = extraBuyAmount(ec, stemHasDelivery);
    const sell = extraSellAmount(ec, stemHasDelivery);
    byId[ec.STEM__c].extraCostSell += sell;
    if (ec.Supplier_Invoice__c) byId[ec.STEM__c].invoicedExtraCostBuy += buy;
    if (!ec.Supplier_Invoice__c) byId[ec.STEM__c].extraCostBuy += buy;
    if (!ec.Supplier_Invoice__c && buy === 0 && sell > 0) byId[ec.STEM__c].sellOnlyExtraSell += sell;
  }

  const rows = stems.map((s) => {
    const agg = byId[s.Id] || {};
    const calculatedBuyer = (agg.buyerLineSell ?? 0) + (agg.extraCostSell ?? 0);
    const buyerResolution = resolveBuyerFinancialAmount({ salesforceAmount: s.Total_Invoice_Amount__c, calculatedAmount: calculatedBuyer, finalInvoiceIssued: finalBuyerInvoiceStemIds.has(s.Id) });
    const buyer = buyerResolution.amount ?? 0;
    const supplierBase = (s.Total_Invoiced_Amount_From_Suppliers__c ?? 0) + (agg.hasSupplierInvoice ? (agg.uninvoicedSupplierLineBuy ?? 0) : (agg.supplierLineBuy ?? 0));
    const rawSupplier = supplierBase + (agg.extraCostBuy ?? 0);
    const unmatchedSellOnlyExtra = agg.hasSupplierInvoice ? Math.max(0, (agg.sellOnlyExtraSell ?? 0) - (agg.invoicedExtraCostBuy ?? 0)) : 0;
    const qlikSupplierCost = s.QLIK_STEM_Line_Item_Total_Cost__c != null || s.QLIK_Costs_Total_Cost__c != null ? (s.QLIK_STEM_Line_Item_Total_Cost__c || 0) + (s.QLIK_Costs_Total_Cost__c || 0) : null;
    const supplierOverstatement = qlikSupplierCost == null ? 0 : rawSupplier - qlikSupplierCost;
    const supplier = unmatchedSellOnlyExtra > 0 && supplierOverstatement > 0 && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05 ? qlikSupplierCost : rawSupplier;
    const suppBrokerComm = agg.suppBrokerComm ?? 0;
    const buyerBrokerComm = agg.buyerBrokerComm ?? 0;
    const totalBroker = suppBrokerComm + buyerBrokerComm;
    const grossProfit = buyer - supplier;
    const netProfit = grossProfit - totalBroker;
    return {
      Id: s.Id,
      Key: s.KeyStem__c,
      Name: s.Name,
      Delivery_Date: s.Delivery_Date__c,
      Expected_Delivery_Date: s.Expected_Delivery_Date__c,
      Buyer: s['Account__r']?.Name ?? null,
      Buyer_Invoice: buyer || null,
      Buyer_Invoice_Source: buyerResolution.source,
      Supplier_Invoice: supplier || null,
      Supplier_Broker_Name: agg.suppBrokerName || null,
      Supplier_Broker_Comm: suppBrokerComm !== 0 ? suppBrokerComm : null,
      Buyer_Broker_Comm: buyerBrokerComm !== 0 ? buyerBrokerComm : null,
      Total_Broker_Comm: totalBroker !== 0 ? totalBroker : null,
      Gross_Profit: buyer && supplier ? grossProfit : null,
      Net_Profit: buyer && supplier ? netProfit : null,
      Margin_Pct: buyer && supplier ? (netProfit / buyer) * 100 : null,
      Qlik_Total_Profit: s.QLIK_Total_Profit__c ?? null,
    };
  });
  const complete = rows.filter((r) => r.Buyer_Invoice && r.Supplier_Invoice);
  return {
    rows,
    totals: {
      count: rows.length,
      complete: complete.length,
      Buyer_Invoice: complete.reduce((sum, r) => sum + (r.Buyer_Invoice ?? 0), 0),
      Supplier_Invoice: complete.reduce((sum, r) => sum + (r.Supplier_Invoice ?? 0), 0),
      Total_Broker_Comm: complete.reduce((sum, r) => sum + (r.Total_Broker_Comm ?? 0), 0),
      Gross_Profit: complete.reduce((sum, r) => sum + (r.Gross_Profit ?? 0), 0),
      Net_Profit: complete.reduce((sum, r) => sum + (r.Net_Profit ?? 0), 0),
      Qlik_Net_Profit: rows.reduce((sum, r) => sum + (r.Qlik_Total_Profit ?? 0), 0),
    },
  };
}

async function salesforceBuyerInvoicesSnapshot(body, req = null, accessContext = null) {
  const daysAhead = Math.max(0, Math.min(Number(body.daysAhead) || 7, 365));
  const thresholdState = body._thresholdState || (await loadPaymentCollectionThresholds(safeSupabaseAdminClient()));
  const rowLimit = 10000;
  const today = dateOnly(new Date());
  const dueThrough = addDays(today, daysAhead);
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  const accountDescribe = fieldNames.includes('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({
        fields: [],
      }))
    : { fields: [] };
  const accountFieldNames = (accountDescribe.fields || []).map((field) => field.name);
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames, accountFieldNames);
  const brokerInvoiceFormatFields = accountInvoiceFormatFields(accountDescribe.fields || []);
  const brokerEmailFields = accountBrokerEmailFields(accountDescribe.fields || []);

  const dueFields = ['Invoice_Due_Date__c', 'Buyer_Pay_Term_Date__c', 'Due_Date__c'].filter((field) => fieldNames.includes(field));
  if (!dueFields.length) {
    return {
      allRows: [],
      today,
      dueThrough,
      daysAhead,
      paymentThresholds: thresholdState,
      traderEmailByName: {},
      hasBuyerTraderFilter: false,
      selectedBuyerTradersInput: [],
    };
  }

  const fields = ['Id', 'Name'];
  if (fieldNames.includes('LastModifiedDate')) fields.push('LastModifiedDate');
  for (const field of dueFields) fields.push(field);
  if (fieldNames.includes('KeyStem__c')) fields.push('KeyStem__c');
  if (fieldNames.includes('CurrencyIsoCode')) fields.push('CurrencyIsoCode');
  if (fieldNames.includes('Delivery_Date__c')) fields.push('Delivery_Date__c');
  if (fieldNames.includes('Delivery_Date_Or_Expected__c')) fields.push('Delivery_Date_Or_Expected__c');
  if (fieldNames.includes('Expected_Delivery_Date__c')) fields.push('Expected_Delivery_Date__c');
  if (fieldNames.includes('ETA_Start_Date__c')) fields.push('ETA_Start_Date__c');
  if (fieldNames.includes('ETA_End_Date__c')) fields.push('ETA_End_Date__c');
  if (fieldNames.includes('Payment_Term__c')) fields.push('Payment_Term__c');
  if (fieldNames.includes('Vessel__c')) fields.push('Vessel__r.Name');
  if (fieldNames.includes('Port__c')) fields.push('Port__r.Name');
  if (fieldNames.includes('Buyer_Name__c')) fields.push('Buyer_Name__c');
  if (fieldNames.includes('Buyer__c')) fields.push('Buyer__c');
  if (fieldNames.includes('Total_Invoice_Amount__c')) fields.push('Total_Invoice_Amount__c');
  if (fieldNames.includes('Receivable_Balance__c')) fields.push('Receivable_Balance__c');
  if (fieldNames.includes('Dispute_Status__c')) fields.push('Dispute_Status__c');
  if (fieldNames.includes('PSPRS__c')) fields.push('PSPRS__c');
  if (fieldNames.includes('Account__c')) {
    fields.push('Account__c', 'Account__r.Name');
    if (accountFieldNames.includes('Group_Name__c')) fields.push('Account__r.Group_Name__c');
    if (accountFieldNames.includes('ParentId')) fields.push('Account__r.ParentId', 'Account__r.Parent.Name');
    if (accountFieldNames.includes('Accounts_Email__c')) fields.push('Account__r.Accounts_Email__c');
  }
  if (fieldNames.includes('Payment_Date__c')) fields.push('Payment_Date__c');

  const storedDueCondition = dueFields.map((field) => `(${field} != null AND ${field} >= ${MIN_BUYER_INVOICE_DUE_DATE} AND ${field} <= ${dueThrough})`).join(' OR ');
  const calculatedDueDateConditions = [fieldNames.includes('Delivery_Date__c') ? `Delivery_Date__c != null AND Delivery_Date__c <= ${dueThrough}` : '', fieldNames.includes('Delivery_Date_Or_Expected__c') ? `Delivery_Date_Or_Expected__c != null AND Delivery_Date_Or_Expected__c <= ${dueThrough}` : '', fieldNames.includes('Expected_Delivery_Date__c') ? `Expected_Delivery_Date__c != null AND Expected_Delivery_Date__c <= ${dueThrough}` : ''].filter(Boolean);
  const calculatedDueCondition = fieldNames.includes('Payment_Term__c') && calculatedDueDateConditions.length ? `(Payment_Term__c != null AND (${calculatedDueDateConditions.map((condition) => `(${condition})`).join(' OR ')}))` : '';
  const dueCondition = [storedDueCondition, calculatedDueCondition].filter(Boolean).join(' OR ');
  const outstandingConditions = [];
  if (fieldNames.includes('Payment_Date__c')) outstandingConditions.push('Payment_Date__c = null');
  const whereParts = [`(${dueCondition})`, ...outstandingConditions];
  if (interofficeCondition) whereParts.push(interofficeCondition);

  const anchorStemId = isSalesforceId(String(body.anchorStemId || '').trim())
    ? String(body.anchorStemId).trim()
    : null;
  const requestedStemIds = [...new Set((Array.isArray(body.requestedStemIds) ? body.requestedStemIds : [])
    .map((id) => String(id || '').trim())
    .filter(isSalesforceId))].slice(0, 500);
  let targetScope = null;
  if (anchorStemId) {
    if (!fieldNames.includes('Account__c')) {
      throw appError('The Salesforce Buyer Account lookup is unavailable. External payment reminders are disabled.', 503);
    }
    const anchorRows = await queryRows(`
      SELECT Id, Account__c, Account__r.Name, Account__r.ParentId, Account__r.Parent.Name${accountFieldNames.includes('Group_Name__c') ? ', Account__r.Group_Name__c' : ''}
      FROM stem__c
      WHERE Id = '${escapeSoql(anchorStemId)}'
      LIMIT 1
    `, { limit: 1, softFail: false });
    const anchor = anchorRows[0];
    if (!anchor?.Account__c) throw appError('The selected invoice no longer has a Buyer Account in Salesforce.', 409);
    const anchorAccount = anchor.Account__r || {};
    const groupName = anchorAccount.Group_Name__c || anchorAccount.Parent?.Name || '';
    const parentAccountId = isFratelliCosulichBuyerGroup(groupName) ? null : anchorAccount.ParentId || null;
    targetScope = {
      anchorStemId,
      buyerAccountId: anchor.Account__c,
      parentAccountId,
    };
    const accountConditions = [`Account__c = '${escapeSoql(anchor.Account__c)}'`];
    if (parentAccountId) accountConditions.push(`Account__r.ParentId = '${escapeSoql(parentAccountId)}'`);
    whereParts.push(`(${accountConditions.join(' OR ')})`);
    if (requestedStemIds.length) {
      const inList = requestedStemIds.map((id) => `'${escapeSoql(id)}'`).join(',');
      whereParts.push(`Id IN (${inList})`);
    }
  }

  const stems = await queryRows(
    `
    SELECT ${[...new Set(fields)].join(', ')}
    FROM stem__c
    WHERE ${whereParts.join(' AND ')}
    ORDER BY ${dueFields[0]} ASC NULLS LAST, Name ASC
    LIMIT ${rowLimit}
  `,
    { limit: rowLimit, softFail: true },
  );

  const stemIds = stems.map((stem) => stem.Id);
  const traderByStem = {};
  const traderEmailByName = {};
  const prpspUploadDateByStem = {};
  const buyerBrokerDetailsByStem = {};
  if (stemIds.length) {
    const stemChunks = chunkIds(stemIds);
    const [nominationArrays, supplierInvoiceArrays, brokerLineItemArrays, buyerBrokerArrays] = await Promise.all([
      compositeQueryRows(
        stemChunks.map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return {
            soql: `
          SELECT Id, Name, STEM__c, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c
          FROM Nomination__c
          WHERE STEM__c IN (${inList}) AND Buyer_Supplier_Trader__c != null
          ORDER BY CreatedDate ASC
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      ),
      compositeQueryRows(
        stemChunks.map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return {
            soql: `
          SELECT Id, STEM__c, PSPRS_Upload_Date__c
          FROM Supplier_Invoice__c
          WHERE STEM__c IN (${inList}) AND PSPRS_Upload_Date__c != null
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      ),
      compositeQueryRows(
        stemChunks.map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return {
            soql: `
          SELECT Id, STEM__c, Buyers_Broker__c, Buyer_Broker__c, Cancelled__c
          FROM STEM_Line_Item__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      ),
      compositeQueryRows(
        stemChunks.map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return {
            soql: `
          SELECT Id, STEM__c, Buyer_Broker__c
          FROM STEM_Buyer_Broker__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      ),
    ]);

    for (const nomination of nominationArrays.flat()) {
      if (!nomination.STEM__c || !nomination.Buyer_Supplier_Trader__c) continue;
      if (!traderByStem[nomination.STEM__c])
        traderByStem[nomination.STEM__c] = {
          buyer: [],
          all: [],
          buyerEmails: [],
          allEmails: [],
          emailByName: {},
        };
      const name = String(nomination.Name || '');
      const value = nomination.Buyer_Supplier_Trader__c;
      const emails = uniqueEmailList(nomination.BT_ST_Email_Address__c);
      const traderKey = traderEmailLookupKey(value);
      if (!traderByStem[nomination.STEM__c].all.includes(value)) traderByStem[nomination.STEM__c].all.push(value);
      for (const email of emails) {
        if (!traderByStem[nomination.STEM__c].allEmails.some((item) => item.toLowerCase() === email.toLowerCase())) {
          traderByStem[nomination.STEM__c].allEmails.push(email);
        }
      }
      if (traderKey && emails.length) {
        traderByStem[nomination.STEM__c].emailByName[traderKey] = uniqueEmailList(traderByStem[nomination.STEM__c].emailByName[traderKey] || [], emails);
        traderEmailByName[traderKey] = uniqueEmailList(traderEmailByName[traderKey] || [], emails);
      }
      if (name.startsWith('Confirmation to ') && !traderByStem[nomination.STEM__c].buyer.includes(value)) {
        traderByStem[nomination.STEM__c].buyer.push(value);
      }
      if (name.startsWith('Confirmation to ')) {
        for (const email of emails) {
          if (!traderByStem[nomination.STEM__c].buyerEmails.some((item) => item.toLowerCase() === email.toLowerCase())) {
            traderByStem[nomination.STEM__c].buyerEmails.push(email);
          }
        }
      }
    }

    for (const invoice of supplierInvoiceArrays.flat()) {
      if (!invoice.STEM__c || !invoice.PSPRS_Upload_Date__c) continue;
      prpspUploadDateByStem[invoice.STEM__c] = latestDate([prpspUploadDateByStem[invoice.STEM__c], invoice.PSPRS_Upload_Date__c]);
    }

    const brokerLinksByStem = {};
    const addBrokerLink = (stemId, brokerId) => {
      if (!stemId || !brokerId) return;
      if (!brokerLinksByStem[stemId]) brokerLinksByStem[stemId] = [];
      if (!brokerLinksByStem[stemId].some((id) => String(id).slice(0, 15) === String(brokerId).slice(0, 15))) {
        brokerLinksByStem[stemId].push(brokerId);
      }
    };
    for (const item of brokerLineItemArrays.flat()) {
      if (item.Cancelled__c) continue;
      addBrokerLink(item.STEM__c, item.Buyers_Broker__c || item.Buyer_Broker__c);
    }
    for (const broker of buyerBrokerArrays.flat()) {
      addBrokerLink(broker.STEM__c, broker.Buyer_Broker__c);
    }

    const brokerIds = [...new Set(Object.values(brokerLinksByStem).flat().filter(Boolean))];
    const brokerAccountMap = {};
    if (brokerIds.length) {
      const brokerAccountFields = ['Id', 'Name'];
      brokerAccountFields.push(...brokerInvoiceFormatFields, ...brokerEmailFields);
      if (accountFieldNames.includes('Hidden_Broker__c')) brokerAccountFields.push('Hidden_Broker__c');
      if (accountFieldNames.includes('Hidden_Broker_Company__c')) brokerAccountFields.push('Hidden_Broker_Company__c');
      const brokerAccountChunks = await compositeQueryRows(
        chunkIds(brokerIds).map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return {
            soql: `
          SELECT ${[...new Set(brokerAccountFields)].join(', ')}
          FROM Account
          WHERE Id IN (${inList})
            AND Inactive_Suspended__c = false
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      );
      for (const account of brokerAccountChunks.flat()) {
        if (account.Hidden_Broker__c === true || account.Hidden_Broker_Company__c === true) continue;
        const detail = {
          id: account.Id,
          name: account.Name || account.Id,
          invoiceFormat: brokerInvoiceFormatFields.map((field) => routingFormatValue(account[field])).find(Boolean) || null,
          emails: uniqueEmailList(...brokerEmailFields.flatMap((field) => emailTokensFromValue(account[field]))),
        };
        brokerAccountMap[account.Id] = detail;
        brokerAccountMap[String(account.Id).slice(0, 15)] = detail;
      }
    }
    for (const [stemId, ids] of Object.entries(brokerLinksByStem)) {
      buyerBrokerDetailsByStem[stemId] = ids.map((id) => brokerAccountMap[id] || brokerAccountMap[String(id).slice(0, 15)] || null).filter(Boolean);
    }
  }

  const hasBuyerTraderFilter = Object.prototype.hasOwnProperty.call(body, 'buyerTraders');
  const selectedBuyerTradersInput = Array.isArray(body.buyerTraders) ? body.buyerTraders : splitBuyerTraderNames(body.buyerTraders);

  const allRows = stems
    .map((stem) => {
      const dueDate = calculatedBuyerPayTermDate(stem) || stem.Invoice_Due_Date__c || stem.Due_Date__c || stem.Buyer_Pay_Term_Date__c || earliestDate(dueFields.map((field) => stem[field]));
      if (!dueDate || dueDate > dueThrough) return null;
      if (dueDate < MIN_BUYER_INVOICE_DUE_DATE) return null;
      if (stem.KeyStem__c && stem.KeyStem__c.startsWith('T')) return null;
      const thresholdPolicy = paymentCollectionThresholdPolicy(thresholdState, stem.CurrencyIsoCode);
      if (stem.Receivable_Balance__c != null && paymentCollectionBalanceIsSettled(stem.Receivable_Balance__c, thresholdPolicy)) return null;
      const daysUntilDue = daysBetween(today, dueDate);
      const account = stem['Account__r'] || {};
      const traderInfo = traderByStem[stem.Id] || {};
      const buyerTraderEmails = traderInfo.buyerEmails?.length ? traderInfo.buyerEmails : traderInfo.allEmails || [];
      const paymentReminderRecipients = uniqueEmailList(account.Accounts_Email__c, buyerTraderEmails);
      const prpspUploadDate = prpspUploadDateByStem[stem.Id] || null;
      const rawPsprsStatus = stem.PSPRS__c || null;
      const brokerRouting = combineBuyerBrokerRouting(buyerBrokerDetailsByStem[stem.Id] || []);
      return {
        id: stem.Id,
        stemId: stem.Id,
        lastModifiedAt: stem.LastModifiedDate || null,
        stemName: formatStemName(stem),
        keyStem: stem.KeyStem__c || null,
        buyerAccountId: stem.Account__c || null,
        buyerParentAccountId: account.ParentId || null,
        buyerGroupName: account.Group_Name__c || account.Parent?.Name || null,
        buyerName: stem.Buyer_Name__c || account.Name || stem.Buyer__c || null,
        invoiceAmount: stem.Total_Invoice_Amount__c ?? null,
        currency: stem.CurrencyIsoCode || 'USD',
        fullyPaidThreshold: thresholdPolicy.threshold,
        fullyPaidThresholdConfigured: thresholdPolicy.configured,
        receivableBalance: stem.Receivable_Balance__c ?? null,
        disputeStatus: stem.Dispute_Status__c || null,
        buyerInvoiceDueDate: dueDate,
        deliveryDate: stem.Delivery_Date__c || null,
        earliestEtaDate: earliestEtaDate(stem.ETA_Start_Date__c, stem.ETA_End_Date__c),
        buyerTraderInCharge: (traderInfo.buyer?.length ? traderInfo.buyer : traderInfo.all || []).join(', ') || null,
        buyerAccountsEmail: account.Accounts_Email__c || null,
        buyerTraderEmail: buyerTraderEmails.join(', ') || null,
        buyerTraderEmailByName: traderInfo.emailByName || {},
        paymentReminderRecipient: paymentReminderRecipients.join(', ') || null,
        paymentReminderRecipients,
        ...brokerRouting,
        prpspStatus: prpspDisplayStatus(rawPsprsStatus, prpspUploadDate),
        prpspUploadDate,
        rawPsprsStatus,
        daysUntilDue,
        status: daysUntilDue == null ? 'Due' : daysUntilDue < 0 ? 'Overdue' : daysUntilDue === 0 ? 'Due Today' : 'Due Soon',
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.buyerInvoiceDueDate !== b.buyerInvoiceDueDate) return a.buyerInvoiceDueDate.localeCompare(b.buyerInvoiceDueDate);
      return String(a.stemName || '').localeCompare(String(b.stemName || ''));
    });

  return {
    allRows,
    today,
    dueThrough,
    daysAhead,
    paymentThresholds: thresholdState,
    traderEmailByName,
    hasBuyerTraderFilter,
    selectedBuyerTradersInput,
    targetScope,
  };
}

async function buyerInvoiceReportFromSnapshot(snapshot, body = {}) {
  const { allRows, today, dueThrough, traderEmailByName, hasBuyerTraderFilter, selectedBuyerTradersInput } = {
    ...snapshot,
    hasBuyerTraderFilter: Object.prototype.hasOwnProperty.call(body, 'buyerTraders'),
    selectedBuyerTradersInput: Array.isArray(body.buyerTraders) ? body.buyerTraders : splitBuyerTraderNames(body.buyerTraders),
  };
  const [collectionMap, reminderRulesState] = await Promise.all([loadBuyerInvoiceCollectionMap(allRows.map((row) => row.stemId)), loadBuyerInvoiceReminderRules()]);
  const rowsWithCollection = allRows.map((row) => {
    const collection = collectionMap[row.stemId] || {};
    const paymentHandlerName = collection.item?.ownerName || splitBuyerTraderNames(row.buyerTraderInCharge)[0] || '';
    const paymentHandlerEmail = uniqueEmailList(row.buyerTraderEmailByName?.[traderEmailLookupKey(paymentHandlerName)] || [], traderEmailByName[traderEmailLookupKey(paymentHandlerName)] || []);
    const paymentReminderRecipients = uniqueEmailList(row.paymentReminderRecipients || [], row.buyerAccountsEmail || '', row.buyerTraderEmail || '', paymentHandlerEmail);
    return {
      ...row,
      paymentHandlerName,
      paymentHandlerEmail: paymentHandlerEmail.join(', ') || null,
      paymentReminderRecipient: paymentReminderRecipients.join(', ') || null,
      paymentReminderRecipients,
      collection: collection.item || null,
      collectionEvents: collection.events || [],
    };
  });
  const rowsWithReminderRules = applyBuyerReminderRules(rowsWithCollection, reminderRulesState.rules, reminderRulesState.available);

  const buyerTraderOptions = [...new Set(rowsWithReminderRules.flatMap((row) => splitBuyerTraderNames(row.buyerTraderInCharge)))].sort((a, b) => a.localeCompare(b));
  const selectedBuyerTraders = selectedBuyerTradersInput.map((name) => String(name || '').trim()).filter((name) => buyerTraderOptions.includes(name));
  const activeBuyerTraders = hasBuyerTraderFilter ? selectedBuyerTraders : buyerTraderOptions;
  const activeBuyerTraderSet = new Set(activeBuyerTraders);
  const rows = hasBuyerTraderFilter && !activeBuyerTraderSet.size ? [] : activeBuyerTraderSet.size && activeBuyerTraderSet.size < buyerTraderOptions.length ? rowsWithReminderRules.filter((row) => splitBuyerTraderNames(row.buyerTraderInCharge).some((name) => activeBuyerTraderSet.has(name))) : rowsWithReminderRules;

  return {
    rows,
    today,
    dueThrough,
    daysAhead: snapshot.daysAhead,
    paymentThresholds: snapshot.paymentThresholds,
    buyerTraderOptions,
    selectedBuyerTraders: activeBuyerTraders,
    hasBuyerTraderFilter,
    paymentReminderRulesAvailable: reminderRulesState.available,
    targetScope: snapshot.targetScope || null,
  };
}

async function salesforceBuyerInvoicesDue(body, req = null, accessContext = null) {
  const daysAhead = Math.max(0, Math.min(Number(body.daysAhead) || 7, 365));
  const thresholdState = await loadPaymentCollectionThresholds(safeSupabaseAdminClient());
  const thresholdCacheKey = paymentCollectionThresholdCacheKey(thresholdState);
  const cached = await cachedSalesforceValue({
    namespace: 'salesforce-buyer-invoices',
    ttlSeconds: 60,
    payload: { daysAhead, thresholdCacheKey },
    tags: ['salesforce:buyer-invoices', 'salesforce:stem', 'salesforce:account'],
    body,
    req,
    accessContext,
    loader: () => salesforceBuyerInvoicesSnapshot({ daysAhead, _thresholdState: thresholdState }, req, accessContext),
  });
  return buyerInvoiceReportFromSnapshot(cached.value, body);
}

async function salesforceBuyerInvoicesDueTargeted(body, req = null, accessContext = null) {
  const daysAhead = Math.max(0, Math.min(Number(body.daysAhead) || 7, 365));
  const thresholdState = await loadPaymentCollectionThresholds(safeSupabaseAdminClient());
  const snapshot = await salesforceBuyerInvoicesSnapshot({
    daysAhead,
    anchorStemId: body.anchorStemId || body.stemId,
    requestedStemIds: body.requestedStemIds || body.invoiceStemIds,
    _thresholdState: thresholdState,
  }, req, accessContext);
  return buyerInvoiceReportFromSnapshot(snapshot, body);
}

async function loadIncomingPaymentSettings() {
  return loadPaymentCollectionThresholds(safeSupabaseAdminClient());
}

async function incomingPaymentSettingsGet(body, req, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  return { settings: await loadIncomingPaymentSettings() };
}

async function incomingPaymentSettingsSave(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'financial_report_settings_manage', 'Finance, Administrators, and the General Manager can change payment thresholds.');
  const saved = Array.isArray(body.thresholds)
    ? await savePaymentCollectionThresholds(client, body.thresholds, profile)
    : [await savePaymentCollectionThreshold(client, body, profile)];
  return { saved, settings: await loadPaymentCollectionThresholds(client) };
}

const CASHFLOW_SETTINGS_ID = 'default';
const CASHFLOW_HOLIDAY_SOURCE = 'nager.date';
const DEFAULT_CASHFLOW_SETTINGS = {
  horizonDays: 90,
  lookbackMonths: 12,
  minBuyerSamples: 3,
  minGroupSamples: 5,
};

function clampInteger(value, fallback, min, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function serializeCashflowSettings(row = null) {
  return {
    horizonDays: clampInteger(row?.horizon_days, DEFAULT_CASHFLOW_SETTINGS.horizonDays, 1, 365),
    lookbackMonths: clampInteger(row?.lookback_months, DEFAULT_CASHFLOW_SETTINGS.lookbackMonths, 1, 36),
    minBuyerSamples: clampInteger(row?.min_buyer_samples, DEFAULT_CASHFLOW_SETTINGS.minBuyerSamples, 1, 100),
    minGroupSamples: clampInteger(row?.min_group_samples, DEFAULT_CASHFLOW_SETTINGS.minGroupSamples, 1, 100),
    creditStatementConservativeness: normalizeBuyerPaymentConservativeness(row?.credit_statement_conservativeness),
    updatedAt: row?.updated_at || null,
    updatedByEmail: row?.updated_by_email || null,
  };
}

async function loadCashflowSettings() {
  const client = safeSupabaseAdminClient();
  if (!client) return serializeCashflowSettings(null);
  const { data, error } = await client.from('cashflow_forecast_settings').select('id,horizon_days,lookback_months,min_buyer_samples,min_group_samples,credit_statement_conservativeness,updated_by_email,updated_at').eq('id', CASHFLOW_SETTINGS_ID).maybeSingle();
  if (error) return serializeCashflowSettings(null);
  return serializeCashflowSettings(data);
}

function serializeCashflowHolidayOverride(row) {
  return {
    id: row.id,
    date: row.holiday_date,
    countryCode: row.country_code || 'MANUAL',
    name: row.name || 'Manual blocked date',
    isBlocked: row.is_blocked !== false,
    note: row.note || null,
    updatedAt: row.updated_at || row.created_at || null,
    updatedByEmail: row.updated_by_email || row.created_by_email || null,
  };
}

async function loadCashflowHolidayOverrides(years = []) {
  const client = safeSupabaseAdminClient();
  if (!client) return [];
  let query = client.from('cashflow_holiday_overrides').select('id,holiday_date,country_code,name,is_blocked,note,created_by_email,created_at,updated_by_email,updated_at').order('holiday_date', { ascending: true });
  const normalizedYears = [...new Set(years.map((year) => Number(year)).filter(Number.isFinite))];
  if (normalizedYears.length) {
    const from = `${Math.min(...normalizedYears)}-01-01`;
    const to = `${Math.max(...normalizedYears)}-12-31`;
    query = query.gte('holiday_date', from).lte('holiday_date', to);
  }
  const { data, error } = await query;
  if (error) return [];
  return (data || []).map(serializeCashflowHolidayOverride);
}

function cashflowHolidayIsBlocking(holiday) {
  const types = holiday?.types || holiday?.holidayTypes || [];
  if (Array.isArray(types) && types.length) {
    return types.some((type) => ['public', 'bank'].includes(String(type).toLowerCase()));
  }
  return true;
}

async function fetchNagerHolidays(countryCode, year) {
  const response = await fetch(`https://date.nager.at/api/v4/Holidays/${encodeURIComponent(countryCode)}/${encodeURIComponent(year)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw appError(`Holiday API returned ${response.status} for ${countryCode} ${year}.`, 502);
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : [])
    .filter(cashflowHolidayIsBlocking)
    .map((holiday) => ({
      date: holiday.date,
      localName: holiday.localName || holiday.name || 'Holiday',
      name: holiday.name || holiday.localName || 'Holiday',
      countryCode,
      types: holiday.types || holiday.holidayTypes || [],
      source: CASHFLOW_HOLIDAY_SOURCE,
    }))
    .filter((holiday) => holiday.date);
}

async function cashflowCachedHolidays(countryCode, year, warnings = []) {
  const client = safeSupabaseAdminClient();
  const cacheSelect = 'id,country_code,calendar_year,source,holidays,fetched_at,expires_at,error_message';
  if (client) {
    const { data: cached } = await client.from('cashflow_holiday_cache').select(cacheSelect).eq('country_code', countryCode).eq('calendar_year', year).eq('source', CASHFLOW_HOLIDAY_SOURCE).maybeSingle();
    const notExpired = cached?.expires_at && new Date(cached.expires_at).getTime() > Date.now();
    if (cached?.holidays && notExpired) {
      return {
        holidays: cached.holidays,
        fetchedAt: cached.fetched_at,
        fromCache: true,
      };
    }
    try {
      const holidays = await fetchNagerHolidays(countryCode, year);
      const expiresAt = new Date();
      expiresAt.setUTCDate(expiresAt.getUTCDate() + 30);
      await client.from('cashflow_holiday_cache').upsert(
        {
          country_code: countryCode,
          calendar_year: year,
          source: CASHFLOW_HOLIDAY_SOURCE,
          holidays,
          fetched_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          error_message: null,
        },
        { onConflict: 'country_code,calendar_year,source' },
      );
      return {
        holidays,
        fetchedAt: new Date().toISOString(),
        fromCache: false,
      };
    } catch (error) {
      warnings.push(error.message);
      if (cached?.holidays)
        return {
          holidays: cached.holidays,
          fetchedAt: cached.fetched_at,
          fromCache: true,
          error: error.message,
        };
      return {
        holidays: [],
        fetchedAt: null,
        fromCache: false,
        error: error.message,
      };
    }
  }

  try {
    return {
      holidays: await fetchNagerHolidays(countryCode, year),
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    };
  } catch (error) {
    warnings.push(error.message);
    return {
      holidays: [],
      fetchedAt: null,
      fromCache: false,
      error: error.message,
    };
  }
}

function yearsBetween(dateFrom, dateTo) {
  const fromYear = Number(String(dateFrom).slice(0, 4));
  const toYear = Number(String(dateTo).slice(0, 4));
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) return [Number(dateOnly(new Date()).slice(0, 4))];
  const years = [];
  for (let year = fromYear; year <= toYear; year += 1) years.push(year);
  return years;
}

async function loadCashflowHolidayData(years, warnings = []) {
  const normalizedYears = [...new Set((years || []).map((year) => Number(year)).filter(Number.isFinite))].sort();
  const countries = ['SG', 'US'];
  const holidayRows = [];
  const statuses = [];
  for (const year of normalizedYears) {
    for (const countryCode of countries) {
      const result = await cashflowCachedHolidays(countryCode, year, warnings);
      holidayRows.push(...(result.holidays || []));
      statuses.push({
        countryCode,
        year,
        source: CASHFLOW_HOLIDAY_SOURCE,
        fetchedAt: result.fetchedAt,
        fromCache: result.fromCache,
        error: result.error || null,
      });
    }
  }
  const overrides = await loadCashflowHolidayOverrides(normalizedYears);
  const blockedMap = new Map();
  for (const holiday of holidayRows) {
    if (!holiday.date) continue;
    const current = blockedMap.get(holiday.date) || [];
    current.push({
      date: holiday.date,
      countryCode: holiday.countryCode,
      name: holiday.name || holiday.localName || 'Holiday',
      source: holiday.source || CASHFLOW_HOLIDAY_SOURCE,
    });
    blockedMap.set(holiday.date, current);
  }
  for (const override of overrides) {
    if (!override.date) continue;
    const current = blockedMap.get(override.date) || [];
    if (override.isBlocked) {
      current.push({
        date: override.date,
        countryCode: override.countryCode,
        name: override.name,
        source: 'manual',
        overrideId: override.id,
      });
      blockedMap.set(override.date, current);
    } else {
      blockedMap.delete(override.date);
    }
  }
  return {
    holidays: [...blockedMap.values()].flat().sort((a, b) => String(a.date).localeCompare(String(b.date))),
    overrides,
    statuses,
    blockedMap,
  };
}

function cashflowBusinessDayAdjustment(originalDate, blockedMap) {
  let current = originalDate;
  let firstReason = null;
  for (let guard = 0; guard < 30; guard += 1) {
    const day = new Date(`${current}T00:00:00.000Z`).getUTCDay();
    const holidayReasons = blockedMap.get(current) || [];
    const weekend = day === 0 || day === 6;
    if (!weekend && !holidayReasons.length) {
      return {
        date: current,
        note: firstReason ? `Moved from ${originalDate} due to ${firstReason}` : null,
      };
    }
    if (!firstReason) {
      if (holidayReasons.length) {
        firstReason = holidayReasons.map((item) => `${item.countryCode} ${item.name}`).join(', ');
      } else {
        firstReason = 'weekend';
      }
    }
    current = addDays(current, 1);
  }
  return { date: originalDate, note: null };
}

function cashflowBuildDelayModels(samples, settings) {
  return buildBuyerPaymentDelayModels(samples, settings, { today: dateOnly(new Date()) });
}

function cashflowSelectDelayModel(row, models, settings) {
  return selectBuyerPaymentDelayModel(row, models, settings);
}

function cashflowPaymentText(payment, fields = []) {
  return fields
    .map((field) => payment?.[field])
    .concat([payment?.Name, payment?.RecordType?.Name, payment?.RecordType?.DeveloperName])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

async function cashflowBuyerPaymentSamples({ lookbackMonths, accessContext = null }) {
  const today = dateOnly(new Date());
  const lookbackStart = [addDays(today, -Math.max(1, Number(lookbackMonths || 12)) * 31), CASHFLOW_FORECAST_START_DATE].sort().at(-1);
  const paymentDescribe = await salesforceObjectFields({
    objectName: 'Payment__c',
  }).catch(() => ({ fields: [] }));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  const paymentFieldByName = Object.fromEntries(paymentFields.map((field) => [field.name, field]));
  if (!paymentFieldNames.size) return { samples: [], warnings: ['Payment__c is not queryable.'] };
  const dateField = firstAvailableField(paymentFieldNames, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const amountField = firstAvailableField(paymentFieldNames, ['Amount__c', 'Payment_Amount__c', 'Paid_Amount__c', 'Received_Amount__c', 'Total_Amount__c', 'Amount_Paid__c', 'Payment_Value__c', 'Actual_Amount__c']);
  if (!dateField || !amountField)
    return {
      samples: [],
      warnings: ['Payment__c date or amount field was not found.'],
    };
  const supplierInvoiceLookupFields = incomingPaymentSupplierInvoiceFields(paymentFields);
  const referenceFields = incomingPaymentReferenceFields(paymentFields);
  const statusFields = selectedFields(paymentFieldNames, ['Status__c', 'Payment_Status__c']);
  const typeFields = selectedFields(paymentFieldNames, ['Type__c', 'Payment_Type__c']);
  const directionFields = incomingPaymentDirectionFields(paymentFields);
  const dateType = paymentFieldByName[dateField]?.type || null;
  const payments = await queryRows(
    `
    SELECT ${[...new Set(['Id', ...selectedFields(paymentFieldNames, ['Name', 'CreatedDate', 'STEM__c', 'CurrencyIsoCode', 'Currency__c', 'RecordTypeId']), paymentFieldNames.has('RecordTypeId') ? 'RecordType.Name' : null, paymentFieldNames.has('RecordTypeId') ? 'RecordType.DeveloperName' : null, dateField, amountField, ...supplierInvoiceLookupFields, ...referenceFields, ...statusFields, ...typeFields, ...directionFields].filter(Boolean))].join(', ')}
    FROM Payment__c
    WHERE ${dateField} >= ${soqlDateValue(dateField, dateType, lookbackStart, false)}
    ORDER BY ${dateField} DESC NULLS LAST
    LIMIT 10000
  `,
    { limit: 10000, softFail: true },
  );
  const eligiblePayments = payments
    .filter((payment) => payment.STEM__c)
    .filter((payment) => !incomingPaymentIsReceivableRemittance(payment, [...referenceFields, ...directionFields, ...typeFields, ...statusFields]))
    .filter((payment) => !incomingPaymentSupplierInvoiceId(payment, supplierInvoiceLookupFields));
  const stemIds = [...new Set(eligiblePayments.map((payment) => payment.STEM__c).filter(Boolean))];
  if (!stemIds.length) return { samples: [], warnings: [] };

  const stemDescribe = await salesforceObjectFields({
    objectName: 'stem__c',
  }).catch(() => ({ fields: [] }));
  const stemFieldNames = new Set((stemDescribe.fields || []).map((field) => field.name));
  const accountDescribe = stemFieldNames.has('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({
        fields: [],
      }))
    : { fields: [] };
  const accountFieldNames = new Set((accountDescribe.fields || []).map((field) => field.name));
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, stemFieldNames, accountFieldNames);
  const stemSelectFields = ['Id', 'Name', ...selectedFields(stemFieldNames, ['KeyStem__c', 'Buyer_Name__c', 'Buyer__c', 'Account__c', 'Payment_Term__c', 'Invoice_Due_Date__c', 'Buyer_Pay_Term_Date__c', 'Due_Date__c', 'Delivery_Date__c', 'Delivery_Date_Or_Expected__c', 'Expected_Delivery_Date__c'])];
  if (stemFieldNames.has('Account__c')) {
    stemSelectFields.push('Account__r.Name');
    if (accountFieldNames.has('Group_Name__c')) stemSelectFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.has('ParentId')) stemSelectFields.push('Account__r.Parent.Name');
  }
  const stemMap = {};
  const stemRows = await compositeQueryRows(
    chunkIds(stemIds).map((chunk) => {
      const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
      const stemWhere = combineWhereConditions([`Id IN (${inList})`, interofficeCondition]);
      return {
        soql: `
      SELECT ${[...new Set(stemSelectFields)].join(', ')}
      FROM stem__c
      WHERE ${stemWhere}
      LIMIT 5000
    `,
        limit: 5000,
        softFail: true,
      };
    }),
  );
  for (const stem of stemRows.flat()) stemMap[stem.Id] = stem;

  const textFields = [...referenceFields, ...directionFields, ...typeFields, ...statusFields];
  const samples = [];
  for (const payment of eligiblePayments) {
    const stem = stemMap[payment.STEM__c];
    if (!stem) continue;
    if (isBeforeCashflowForecastStart(stem.Delivery_Date__c)) continue;
    const amount = incomingPaymentNumber(payment[amountField]);
    if (amount == null || amount <= 0) continue;
    const text = cashflowPaymentText(payment, textFields);
    if (/(bank\s*charge|broker|commission|payable|supplier)/i.test(text)) continue;
    if (
      incomingPaymentLooksBankCharge(payment, {
        referenceFields,
        directionFields,
        typeFields,
        statusFields,
      })
    )
      continue;
    const type = incomingPaymentTypeFromContext(payment, {
      amount,
      stem,
      supplierInvoice: null,
      supplierInvoiceFields: supplierInvoiceLookupFields,
      directionFields,
      typeFields,
      statusFields,
    });
    if (type !== 'Buyer Payment') continue;
    const dueDate = calculatedBuyerPayTermDate(stem) || stem.Invoice_Due_Date__c || stem.Due_Date__c || stem.Buyer_Pay_Term_Date__c || null;
    const paymentDate = dateOnly(payment[dateField] || payment.CreatedDate);
    if (!dueDate || !paymentDate) continue;
    if (isBeforeCashflowForecastStart(paymentDate)) continue;
    const account = stem['Account__r'] || {};
    samples.push({
      paymentId: payment.Id,
      stemId: stem.Id,
      stemName: formatStemName(stem),
      buyerAccountId: stem.Account__c || null,
      buyerName: incomingPaymentBuyerName(stem),
      buyerGroupName: account.Group_Name__c || account.Parent?.Name || incomingPaymentBuyerName(stem),
      dueDate,
      paymentDate,
      delayDays: daysBetween(dueDate, paymentDate),
      amount,
    });
  }
  return { samples, warnings: [] };
}

function cashflowBucketKey(date, bucket = 'daily') {
  if (bucket === 'monthly') return String(date || '').slice(0, 7);
  if (bucket === 'weekly') {
    const value = new Date(`${date}T00:00:00.000Z`);
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() - day + 1);
    return dateOnly(value);
  }
  return date;
}

function cashflowBucketLabel(key, bucket = 'daily') {
  if (!key) return '—';
  if (bucket === 'monthly') return key;
  if (bucket === 'weekly') return `Week of ${key}`;
  return key;
}

function cashflowSummarizeRows(rows, bucket = 'daily') {
  const totals = {
    buyerReceipts: 0,
    supplierPayments: 0,
    netCashflow: 0,
    overdueRiskReceipts: 0,
    rowCount: rows.length,
  };
  const buckets = new Map();
  const today = dateOnly(new Date());
  for (const row of rows) {
    const amount = Number(row.amount || 0);
    if (row.direction === 'inflow') {
      totals.buyerReceipts += amount;
      if (row.sourceDueDate && row.sourceDueDate < today) totals.overdueRiskReceipts += amount;
    } else {
      totals.supplierPayments += amount;
    }
    const key = cashflowBucketKey(row.forecastDate, bucket);
    if (!buckets.has(key))
      buckets.set(key, {
        bucket: key,
        label: cashflowBucketLabel(key, bucket),
        inflow: 0,
        outflow: 0,
        net: 0,
      });
    const current = buckets.get(key);
    if (row.direction === 'inflow') current.inflow += amount;
    if (row.direction === 'outflow') current.outflow += amount;
    current.net = current.inflow - current.outflow;
  }
  totals.netCashflow = totals.buyerReceipts - totals.supplierPayments;
  return {
    totals,
    buckets: [...buckets.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))),
  };
}

async function cashflowSupplierInvoiceRows({ dateTo, blockedMap, accessContext = null }) {
  const warnings = [];
  const today = dateOnly(new Date());
  const describe = await salesforceObjectFields({
    objectName: 'Supplier_Invoice__c',
  }).catch(() => ({ fields: [] }));
  const fields = describe.fields || [];
  const fieldNames = new Set(fields.map((field) => field.name));
  if (!fieldNames.size) return { rows: [], warnings: ['Supplier_Invoice__c is not queryable.'] };
  const fieldByName = Object.fromEntries(fields.map((field) => [field.name, field]));
  const stemField = firstAvailableField(fieldNames, ['STEM__c', 'Stem__c']);
  const dueDateField = firstAvailableField(fieldNames, ['Invoice_Due_Date__c', 'Due_Date__c', 'Payment_Due_Date__c', 'Pay_Term_Date__c', 'Supplier_Pay_Term_Date__c']);
  const payableField = firstAvailableField(fieldNames, ['Payable_Balance__c', 'Balance__c', 'Actual_Balance__c', 'Outstanding_Balance__c']);
  const amountField = firstAvailableField(fieldNames, ['Invoice_Amount__c', 'Calculated_Amount__c', 'Amount__c', 'Total_Amount__c']);
  const paidDateField = firstAvailableField(fieldNames, ['Payment_Date__c', 'Paid_Date__c', 'Date_Paid__c']);
  const supplierFields = selectedFields(fieldNames, ['Supplier__c', 'Expected_Supplier__c', 'Substitute_Supplier__c']);
  const supplierRelationships = supplierFields.map((field) => fieldByName[field]?.relationshipName).filter(Boolean);
  if (!stemField || !dueDateField || (!payableField && !amountField)) {
    return {
      rows: [],
      warnings: ['Supplier invoice STEM, due date, or amount fields were not found.'],
    };
  }
  const selectFields = ['Id', 'Name', stemField, dueDateField, payableField, amountField, paidDateField, ...selectedFields(fieldNames, ['Supplier_Name__c', 'CurrencyIsoCode', 'Currency__c']), ...supplierFields, ...supplierRelationships.map((relationship) => `${relationship}.Name`)].filter(Boolean);
  const whereParts = [`${dueDateField} != null`, `${dueDateField} <= ${dateTo}`];
  if (paidDateField) whereParts.push(`${paidDateField} = null`);
  const invoices = await queryRows(
    `
    SELECT ${[...new Set(selectFields)].join(', ')}
    FROM Supplier_Invoice__c
    WHERE ${whereParts.join(' AND ')}
    ORDER BY ${dueDateField} ASC NULLS LAST
    LIMIT 10000
  `,
    { limit: 10000, softFail: true },
  );
  const stemIds = [...new Set(invoices.map((invoice) => invoice[stemField]).filter(Boolean))];
  const stemMap = {};
  if (stemIds.length) {
    const stemDescribe = await salesforceObjectFields({
      objectName: 'stem__c',
    }).catch(() => ({ fields: [] }));
    const stemFieldNames = new Set((stemDescribe.fields || []).map((field) => field.name));
    const accountDescribe = stemFieldNames.has('Account__c')
      ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({
          fields: [],
        }))
      : { fields: [] };
    const accountFieldNames = new Set((accountDescribe.fields || []).map((field) => field.name));
    const interofficeCondition = await interofficeStemAccessCondition(accessContext, stemFieldNames, accountFieldNames);
    const stemSelectFields = ['Id', 'Name', ...selectedFields(stemFieldNames, ['KeyStem__c', 'Delivery_Date__c'])];
    if (stemFieldNames.has('Vessel__c')) stemSelectFields.push('Vessel__r.Name');
    if (stemFieldNames.has('Port__c')) stemSelectFields.push('Port__r.Name');
    const stemRows = await compositeQueryRows(
      chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        const stemWhere = combineWhereConditions([`Id IN (${inList})`, interofficeCondition]);
        return {
          soql: `
        SELECT ${[...new Set(stemSelectFields)].join(', ')}
        FROM stem__c
        WHERE ${stemWhere}
        LIMIT 5000
      `,
          limit: 5000,
          softFail: true,
        };
      }),
    );
    for (const stem of stemRows.flat()) stemMap[stem.Id] = stem;
  }
  const rows = [];
  for (const invoice of invoices) {
    const amount = Number(payableField ? invoice[payableField] : invoice[amountField]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const sourceDueDate = invoice[dueDateField];
    if (!sourceDueDate) continue;
    const originalDate = sourceDueDate < today ? today : sourceDueDate;
    const adjusted = cashflowBusinessDayAdjustment(originalDate, blockedMap);
    const stem = stemMap[invoice[stemField]] || null;
    if (isInterofficeAccess(accessContext) && invoice[stemField] && !stem) continue;
    if (isBeforeCashflowForecastStart(stem?.Delivery_Date__c)) continue;
    const counterparty = supplierRelationships.map((relationship) => invoice[relationship]?.Name).find(Boolean) || invoice.Supplier_Name__c || supplierFields.map((field) => invoice[field]).find(Boolean) || invoice.Name || 'Supplier';
    rows.push({
      id: `supplier-${invoice.Id}`,
      forecastDate: adjusted.date,
      originalDate,
      direction: 'outflow',
      type: 'Supplier Payment',
      stemId: invoice[stemField] || null,
      stemName: stem ? formatStemName(stem) : invoice[stemField] || null,
      counterparty,
      buyerGroup: null,
      amount,
      currency: invoice.CurrencyIsoCode || invoice.Currency__c || 'USD',
      sourceDueDate,
      predictedDelayDays: 0,
      modelLevel: 'Contractual due date',
      sampleCount: null,
      confidence: 'Certain',
      holidayAdjustment: adjusted.note,
      sourceRecordId: invoice.Id,
      sourceRecordName: invoice.Name || null,
    });
  }
  return { rows, warnings };
}

async function cashflowBuyerReceiptRows({ dateTo, settings, models, blockedMap, accessContext = null }) {
  const today = dateOnly(new Date());
  const daysAhead = Math.max(0, Math.min(daysBetween(today, dateTo) ?? settings.horizonDays, 365));
  const invoiceData = await salesforceBuyerInvoicesDue({ daysAhead }, null, accessContext);
  const rows = [];
  for (const invoice of invoiceData.rows || []) {
    if (isBeforeCashflowForecastStart(invoice.deliveryDate)) continue;
    const amount = Number(invoice.receivableBalance || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const dueDate = invoice.buyerInvoiceDueDate;
    if (!dueDate) continue;
    const model = cashflowSelectDelayModel(invoice, models, settings);
    const predictedDate = addDays(dueDate, model.predictedDelayDays || 0);
    const originalDate = predictedDate < today ? today : predictedDate;
    const adjusted = cashflowBusinessDayAdjustment(originalDate, blockedMap);
    rows.push({
      id: `buyer-${invoice.stemId}`,
      forecastDate: adjusted.date,
      originalDate,
      direction: 'inflow',
      type: 'Buyer Receipt',
      stemId: invoice.stemId,
      stemName: invoice.stemName,
      counterparty: invoice.buyerName || 'Buyer',
      buyerGroup: invoice.buyerGroupName || invoice.buyerName || null,
      amount,
      currency: invoice.currency || 'USD',
      sourceDueDate: dueDate,
      predictedDelayDays: model.predictedDelayDays,
      modelLevel: model.level,
      sampleCount: model.sampleCount,
      confidence: model.confidence,
      holidayAdjustment: adjusted.note,
      buyerAccountId: invoice.buyerAccountId || null,
      status: invoice.status || null,
    });
  }
  return rows;
}

function cashflowPerformanceRows(samples, models) {
  const buyerRows = Object.entries(models.buyerModels || {}).map(([buyerAccountId, model]) => {
    const sample = samples.find((row) => row.buyerAccountId === buyerAccountId) || {};
    return {
      id: `buyer-${buyerAccountId}`,
      level: 'Buyer',
      name: sample.buyerName || buyerAccountId,
      buyerGroup: sample.buyerGroupName || null,
      predictedDelayDays: model.predictedDelayDays,
      sampleCount: model.sampleCount,
      confidence: model.confidence,
    };
  });
  const groupRows = Object.entries(models.groupModels || {}).map(([groupName, model]) => ({
    id: `group-${groupName}`,
    level: 'Buyer Group',
    name: groupName,
    buyerGroup: groupName,
    predictedDelayDays: model.predictedDelayDays,
    sampleCount: model.sampleCount,
    confidence: model.confidence,
  }));
  return [...buyerRows, ...groupRows]
    .sort((a, b) => {
      if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, 50);
}

async function cashflowForecast(body, req = null, accessContext = null) {
  const warnings = [];
  const settings = await loadCashflowSettings();
  const today = dateOnly(new Date());
  const dateFrom = dateOnly(body.dateFrom || body.date_from || today);
  const dateTo = dateOnly(body.dateTo || body.date_to || addDays(today, settings.horizonDays));
  const bucket = ['daily', 'weekly', 'monthly'].includes(String(body.bucket || '').toLowerCase()) ? String(body.bucket).toLowerCase() : 'daily';
  const holidayData = await loadCashflowHolidayData(yearsBetween(dateFrom, addDays(dateTo, 14)), warnings);
  const incomingSettings = await loadIncomingPaymentSettings();
  const blockedDates = [...holidayData.blockedMap.keys()].sort();
  const cached = await cachedSalesforceValue({
    namespace: 'salesforce-cashflow',
    ttlSeconds: 60,
    payload: {
      dateTo,
      settings,
      paymentThresholds: paymentCollectionThresholdCacheKey(incomingSettings),
      blockedDates,
    },
    tags: ['salesforce:cashflow', 'salesforce:stem', 'salesforce:buyer-invoices'],
    body,
    req,
    accessContext,
    loader: async () => {
      const buyerSamplesData = await cashflowBuyerPaymentSamples({
        lookbackMonths: settings.lookbackMonths,
        accessContext,
      });
      const models = cashflowBuildDelayModels(buyerSamplesData.samples || [], settings);
      const [buyerRows, supplierData] = await Promise.all([
        cashflowBuyerReceiptRows({
          dateTo,
          settings,
          models,
          blockedMap: holidayData.blockedMap,
          accessContext,
        }),
        cashflowSupplierInvoiceRows({
          dateTo,
          blockedMap: holidayData.blockedMap,
          accessContext,
        }),
      ]);
      return { buyerSamplesData, models, buyerRows, supplierData };
    },
  });
  const { buyerSamplesData, models, buyerRows, supplierData } = cached.value;
  warnings.push(...(buyerSamplesData.warnings || []));
  warnings.push(...(supplierData.warnings || []));
  const rows = [...buyerRows, ...(supplierData.rows || [])]
    .filter((row) => row.forecastDate >= dateFrom && row.forecastDate <= dateTo)
    .sort((a, b) => {
      if (a.forecastDate !== b.forecastDate) return a.forecastDate.localeCompare(b.forecastDate);
      if (a.direction !== b.direction) return a.direction.localeCompare(b.direction);
      return String(a.counterparty || '').localeCompare(String(b.counterparty || ''));
    });
  const summary = cashflowSummarizeRows(rows, bucket);
  const canManageSettings = accessContext ? await userHasCapability(accessContext.client, accessContext.profile, 'cashflow_forecast_manage') : false;
  return {
    dateFrom,
    dateTo,
    bucket,
    rows,
    buckets: summary.buckets,
    totals: summary.totals,
    performance: cashflowPerformanceRows(buyerSamplesData.samples || [], models),
    settings,
    incomingPaymentSettings: incomingSettings,
    holidays: holidayData.holidays,
    holidayOverrides: holidayData.overrides,
    holidaySourceStatus: holidayData.statuses,
    warnings: [...new Set(warnings.filter(Boolean))],
    capabilities: { canManageSettings },
  };
}

async function cashflowBuyerPaymentPerformance(body, req = null, accessContext = null) {
  const baseSettings = await loadCashflowSettings();
  const settings = {
    ...baseSettings,
    lookbackMonths: clampInteger(body.lookbackMonths, baseSettings.lookbackMonths, 1, 36),
  };
  const data = await cashflowBuyerPaymentSamples({
    lookbackMonths: settings.lookbackMonths,
    accessContext,
  });
  const models = cashflowBuildDelayModels(data.samples || [], settings);
  return {
    settings,
    samples: data.samples || [],
    performance: cashflowPerformanceRows(data.samples || [], models),
    warnings: data.warnings || [],
  };
}

async function cashflowSettingsGet(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const today = dateOnly(new Date());
  const settings = await loadCashflowSettings();
  const years = Array.isArray(body.years) && body.years.length ? body.years : yearsBetween(today, addDays(today, settings.horizonDays + 14));
  const holidayData = await loadCashflowHolidayData(years, []);
  return {
    settings,
    holidayOverrides: holidayData.overrides,
    holidaySourceStatus: holidayData.statuses,
    capabilities: {
      canManageSettings: await userHasCapability(client, profile, 'cashflow_forecast_manage'),
    },
  };
}

async function cashflowSettingsSave(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'cashflow_forecast_manage', 'Cashflow settings management permission is required.');
  if (body.overrideAction === 'add') {
    const date = dateOnly(body.date || body.holidayDate);
    if (!date) throw appError('Blocked date is required.', 400);
    const countryCode =
      String(body.countryCode || 'MANUAL')
        .trim()
        .toUpperCase()
        .slice(0, 12) || 'MANUAL';
    const payload = {
      holiday_date: date,
      country_code: countryCode,
      name: String(body.name || 'Manual blocked date').trim() || 'Manual blocked date',
      is_blocked: body.isBlocked !== false,
      note: body.note ? String(body.note).trim() : null,
      updated_by: profile.id,
      updated_by_email: profile.email,
      updated_at: new Date().toISOString(),
      created_by: profile.id,
      created_by_email: profile.email,
    };
    const { error } = await client.from('cashflow_holiday_overrides').upsert(payload, { onConflict: 'holiday_date,country_code' });
    if (error) throw error;
    return cashflowSettingsGet({}, req);
  }
  if (body.overrideAction === 'delete') {
    const id = body.id || body.overrideId;
    if (!id) throw appError('Override id is required.', 400);
    const { error } = await client.from('cashflow_holiday_overrides').delete().eq('id', id);
    if (error) throw error;
    return cashflowSettingsGet({}, req);
  }
  const payload = {
    id: CASHFLOW_SETTINGS_ID,
    horizon_days: clampInteger(body.horizonDays ?? body.horizon_days, DEFAULT_CASHFLOW_SETTINGS.horizonDays, 1, 365),
    lookback_months: clampInteger(body.lookbackMonths ?? body.lookback_months, DEFAULT_CASHFLOW_SETTINGS.lookbackMonths, 1, 36),
    min_buyer_samples: clampInteger(body.minBuyerSamples ?? body.min_buyer_samples, DEFAULT_CASHFLOW_SETTINGS.minBuyerSamples, 1, 100),
    min_group_samples: clampInteger(body.minGroupSamples ?? body.min_group_samples, DEFAULT_CASHFLOW_SETTINGS.minGroupSamples, 1, 100),
    updated_by: profile.id,
    updated_by_email: profile.email,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from('cashflow_forecast_settings').upsert(payload, { onConflict: 'id' }).select('id,horizon_days,lookback_months,min_buyer_samples,min_group_samples,credit_statement_conservativeness,updated_by_email,updated_at').single();
  if (error) throw error;
  return {
    settings: serializeCashflowSettings(data),
    holidayOverrides: await loadCashflowHolidayOverrides(),
  };
}

async function cashflowHolidayCalendar(body, req) {
  await requireActiveUser(req);
  const today = dateOnly(new Date());
  const years = Array.isArray(body.years) && body.years.length ? body.years : [Number(today.slice(0, 4))];
  const warnings = [];
  const data = await loadCashflowHolidayData(years, warnings);
  return {
    holidays: data.holidays,
    holidayOverrides: data.overrides,
    holidaySourceStatus: data.statuses,
    warnings,
  };
}

function incomingPaymentNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstAvailableField(fieldNames, candidates) {
  return candidates.find((field) => fieldNames.has(field)) || null;
}

function soqlDateValue(dateField, dateType, isoDate, endOfDay = false) {
  if (!isoDate) return null;
  if (dateField === 'CreatedDate' || dateType === 'datetime') {
    return `${isoDate}T${endOfDay ? '23:59:59' : '00:00:00'}Z`;
  }
  return isoDate;
}

function soqlHongKongDateTimeValue(isoDate, endOfDay = false) {
  if (!isoDate) return null;
  const localTime = endOfDay ? '23:59:59.999' : '00:00:00.000';
  return new Date(`${isoDate}T${localTime}+08:00`).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function selectedFields(fieldNames, fields) {
  return fields.filter((field) => field && fieldNames.has(field));
}

function incomingPaymentReferenceFields(paymentFields = []) {
  const fieldNames = new Set(paymentFields.map((field) => field.name));
  const exactFields = ['Bank_Reference__c', 'Reference__c', 'Payment_Reference__c', 'Transaction_Reference__c', 'Description__c', 'Remarks__c'].filter((field) => fieldNames.has(field));
  const allowedTypes = new Set(['string', 'textarea', 'picklist', 'email', 'phone', 'url']);
  const dynamicFields = paymentFields.filter((field) => field?.name && field.name !== 'Name' && !field.name.endsWith('__c__r') && allowedTypes.has(field.type) && fieldMatchesAny(field, ['bankreference', 'bankreferencec', 'paymentreference', 'paymentreferencec', 'transactionreference', 'transactionreferencec', 'reference', 'referencec', 'description', 'descriptionc', 'remarks', 'remarksc', 'narration', 'narrationc', 'paymentdetails', 'paymentdetailsc', 'receiptreference', 'receiptreferencec'], ['bankref', 'reference', 'transaction', 'remittance', 'description', 'remark', 'narration', 'receipt', 'cheque', 'check', 'details', 'payer', 'payor'])).map((field) => field.name);
  return uniqueTextList([...exactFields, ...dynamicFields]).slice(0, 10);
}

function incomingPaymentSupplierInvoiceFields(paymentFields = []) {
  const fieldNames = new Set(paymentFields.map((field) => field.name));
  const exactFields = ['Supplier_Invoice__c'].filter((field) => fieldNames.has(field));
  const dynamicFields = paymentFields
    .filter((field) => {
      if (!field?.name || field.name === 'Name') return false;
      if (field.type !== 'reference') return false;
      const referenceTo = Array.isArray(field.referenceTo) ? field.referenceTo : [];
      return referenceTo.includes('Supplier_Invoice__c') || fieldMatchesAny(field, ['supplierinvoice', 'supplierinvoicec', 'supplierinvoiceid', 'supplierinvoiceidc'], ['supplierinvoice', 'supplierinv', 'vendorinvoice']);
    })
    .map((field) => field.name);
  return uniqueTextList([...exactFields, ...dynamicFields]).slice(0, 8);
}

function incomingPaymentDirectionFields(paymentFields = []) {
  const fieldNames = new Set(paymentFields.map((field) => field.name));
  const exactFields = ['Type__c', 'Payment_Type__c', 'Status__c', 'Payment_Status__c', 'Direction__c', 'Payment_Direction__c', 'Category__c', 'Payment_Category__c', 'Payable_Receivable__c', 'AP_AR__c', 'Payer__c', 'Payor__c', 'Payee__c', 'From__c', 'To__c', 'Supplier__c', 'Vendor__c', 'Account__c'].filter((field) => fieldNames.has(field));
  const allowedTypes = new Set(['string', 'textarea', 'picklist', 'reference']);
  const dynamicFields = paymentFields.filter((field) => field?.name && field.name !== 'Name' && allowedTypes.has(field.type) && fieldMatchesAny(field, ['paymenttype', 'paymenttypec', 'paymentdirection', 'paymentdirectionc', 'direction', 'directionc', 'payablereceivable', 'payablereceivablec', 'apar', 'aparc', 'supplier', 'supplierc', 'vendor', 'vendorc', 'payee', 'payeec', 'payer', 'payerc', 'payor', 'payorc'], ['paymenttype', 'direction', 'payable', 'receivable', 'supplier', 'vendor', 'payee', 'payer', 'payor', 'payfrom', 'payto', 'recipient', 'beneficiary', 'party'])).map((field) => field.name);
  return uniqueTextList([...exactFields, ...dynamicFields]).slice(0, 20);
}

function incomingPaymentSupplierInvoiceId(payment, supplierInvoiceFields = []) {
  return supplierInvoiceFields.map((field) => payment?.[field]).find((value) => isSalesforceId(value)) || null;
}

function incomingPaymentLooksSupplierSide(payment, { supplierInvoiceFields = [], directionFields = [], typeFields = [], statusFields = [] } = {}) {
  if (incomingPaymentSupplierInvoiceId(payment, supplierInvoiceFields)) return true;
  const fields = uniqueTextList([...directionFields, ...typeFields, ...statusFields]);
  const hasSupplierLookup = fields.some((field) => {
    const value = payment?.[field];
    if (value == null || value === '') return false;
    const fieldToken = normalizedFieldToken(field);
    if (fieldToken.includes('buyersupplier')) return false;
    return fieldToken.includes('supplier') || fieldToken.includes('vendor') || fieldToken.includes('supplierinvoice');
  });
  if (hasSupplierLookup) return true;
  const valueToken = normalizedFieldToken(
    fields
      .filter((field) => payment?.[field] != null && payment[field] !== '')
      .map((field) => payment[field])
      .join(' '),
  );
  if (!valueToken) return false;
  const supplierSignals = ['supplierinvoice', 'supplierpayment', 'supplierrefund', 'vendor', 'payable', 'accountspayable', 'outgoing', 'paymenttosupplier', 'tosupplier', 'fromsupplier', 'supplieraccount', 'supplierc', 'suppliername'];
  const hasSupplierSignal = supplierSignals.some((signal) => valueToken.includes(signal));
  if (!hasSupplierSignal) return false;
  const mixedBuyerSupplierOnly = valueToken.includes('buyersupplier') && !['supplierinvoice', 'supplierpayment', 'supplierrefund', 'paymenttosupplier', 'payable', 'vendor'].some((signal) => valueToken.includes(signal));
  return !mixedBuyerSupplierOnly;
}

function incomingPaymentLooksBankCharge(payment, { referenceFields = [], directionFields = [], typeFields = [], statusFields = [] } = {}) {
  if (payment?.Id === 'a0Sfu00000FsN0c' || String(payment?.Id || '').startsWith('a0Sfu00000FsN0c')) return true;
  const fields = uniqueTextList([...referenceFields, ...directionFields, ...typeFields, ...statusFields, 'Name']);
  const valueToken = normalizedFieldToken(
    fields
      .filter((field) => payment?.[field] != null && payment[field] !== '')
      .map((field) => payment[field])
      .join(' '),
  );
  if (!valueToken) return false;
  return ['bankcharge', 'bankcharges', 'bankfee', 'bankfees', 'remittancecharge', 'remittancefee', 'transfercharge', 'transferfee'].some((signal) => valueToken.includes(signal));
}

function incomingPaymentLooksBuyerSide(payment, { referenceFields = [], directionFields = [], typeFields = [], statusFields = [] } = {}) {
  const fields = uniqueTextList([...referenceFields, ...directionFields, ...typeFields, ...statusFields, 'Name']);
  const valueToken = normalizedFieldToken(
    fields
      .filter((field) => payment?.[field] != null && payment[field] !== '')
      .map((field) => payment[field])
      .join(' '),
  );
  if (!valueToken) return false;
  return ['buyerpayment', 'buyerreceipt', 'paymentfrombuyer', 'frombuyer', 'customerpayment', 'customerreceipt', 'receivable', 'accountsreceivable'].some((signal) => valueToken.includes(signal));
}

function incomingPaymentLooksStemPayableCalculation(payment, { amount, payableAmounts = [], referenceFields = [], directionFields = [], typeFields = [], statusFields = [], allowBlankSignal = false } = {}) {
  if (amount == null || amount <= 0) return false;
  const matchesPayableAmount = payableAmounts.filter((value) => value != null && Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0).some((value) => amountNearlyEqual(amount, value, 1));
  if (!matchesPayableAmount) return false;
  if (
    incomingPaymentLooksBuyerSide(payment, {
      referenceFields,
      directionFields,
      typeFields,
      statusFields,
    })
  )
    return false;

  const fields = uniqueTextList([...referenceFields, ...directionFields, ...typeFields, ...statusFields, 'Name']);
  const valueToken = normalizedFieldToken(
    fields
      .filter((field) => payment?.[field] != null && payment[field] !== '')
      .map((field) => payment[field])
      .join(' '),
  );
  if (!valueToken) return allowBlankSignal;
  return true;
}

function stemPayableAmountCandidates({ stem = {}, lineItems = [], extraCosts = [] } = {}) {
  const stemHasDelivery = !!stem.Delivery_Date__c;
  const activeLineItems = lineItems.filter((item) => !item.Cancelled__c);
  const activeExtraCosts = extraCosts.filter((item) => !item.Cancelled__c);
  const supplierInvoiceTotal = numericValue(stem.Total_Invoiced_Amount_From_Suppliers__c) ?? 0;
  const supplierLineBuyTotal = activeLineItems.reduce((sum, item) => sum + lineBuyAmount(item, stemHasDelivery), 0);
  const uninvoicedSupplierLineBuyTotal = activeLineItems.reduce((sum, item) => (item.Supplier_Invoice__c ? sum : sum + lineBuyAmount(item, stemHasDelivery)), 0);
  const supplierExtraBuyTotal = activeExtraCosts.reduce((sum, item) => sum + extraBuyAmount(item, stemHasDelivery), 0);
  const uninvoicedSupplierExtraBuyTotal = activeExtraCosts.reduce((sum, item) => (item.Supplier_Invoice__c ? sum : sum + extraBuyAmount(item, stemHasDelivery)), 0);
  const hasSupplierInvoiceLines = activeLineItems.some((item) => item.Supplier_Invoice__c);
  const calculatedSupplierInvoice = supplierInvoiceTotal + (hasSupplierInvoiceLines ? uninvoicedSupplierLineBuyTotal : supplierLineBuyTotal);
  return [calculatedSupplierInvoice, calculatedSupplierInvoice + supplierExtraBuyTotal, calculatedSupplierInvoice + uninvoicedSupplierExtraBuyTotal, supplierLineBuyTotal, uninvoicedSupplierLineBuyTotal, supplierExtraBuyTotal, uninvoicedSupplierExtraBuyTotal, supplierLineBuyTotal + supplierExtraBuyTotal, uninvoicedSupplierLineBuyTotal + uninvoicedSupplierExtraBuyTotal, supplierInvoiceTotal, numericValue(stem.Payable_Balance__c), numericValue(stem.Total_Costs__c), numericValue(stem.Total_Cost__c), numericValue(stem.Total_Cost_Amount__c), ...activeLineItems.map((item) => lineBuyAmount(item, stemHasDelivery)), ...activeExtraCosts.map((item) => extraBuyAmount(item, stemHasDelivery))].filter((value) => value != null && Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0);
}

function incomingPaymentTypeFromContext(payment, { amount, stem, supplierInvoice, supplierInvoiceFields, directionFields, typeFields, statusFields }) {
  const supplierSide =
    supplierInvoice ||
    incomingPaymentLooksSupplierSide(payment, {
      supplierInvoiceFields,
      directionFields,
      typeFields,
      statusFields,
    });
  if (supplierSide) return amount != null && amount < 0 ? 'Supplier Refund' : 'Supplier Payment';
  if (stem && (amount == null || amount >= 0)) return 'Buyer Payment';
  return 'Unmatched';
}

function amountNearlyEqual(left, right, tolerance = 0.05) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(Math.abs(a) - Math.abs(b)) <= tolerance;
}

function paymentSearchToken(payment, fields = []) {
  return normalizedFieldToken(
    uniqueTextList([...fields, 'Name'])
      .filter((field) => payment?.[field] != null && payment[field] !== '')
      .map((field) => payment[field])
      .join(' '),
  );
}

function addBrokerCommissionGroup(groupsByStem, group) {
  if (!group?.stemId || !group.brokerType || !group.amount) return;
  const key = [group.stemId, group.brokerType, group.brokerId || group.brokerName || 'unknown'].join('::');
  if (!groupsByStem[group.stemId]) groupsByStem[group.stemId] = [];
  const existing = groupsByStem[group.stemId].find((item) => item.key === key);
  if (existing) {
    existing.amount += Number(group.amount || 0);
    return;
  }
  groupsByStem[group.stemId].push({
    key,
    stemId: group.stemId,
    brokerId: group.brokerId || null,
    brokerName: group.brokerName || group.brokerId || group.brokerType,
    brokerType: group.brokerType,
    side: group.side,
    amount: Number(group.amount || 0),
  });
}

function buildBrokerCommissionGroups({ stemMap = {}, lineItems = [], buyerBrokers = [], accountMap = {} } = {}) {
  const groupsByStem = {};
  const buyerBrokersByStem = {};
  for (const broker of buyerBrokers) {
    if (!broker.STEM__c) continue;
    if (!buyerBrokersByStem[broker.STEM__c]) buyerBrokersByStem[broker.STEM__c] = [];
    buyerBrokersByStem[broker.STEM__c].push(broker);
  }

  for (const item of lineItems) {
    if (!item.STEM__c || item.Cancelled__c) continue;
    const stem = stemMap[item.STEM__c];
    if (!stem) continue;
    const qty = financialQuantity(item, !!stem.Delivery_Date__c);
    const supplierAmount = brokerAmount(item.Suppliers_Brokers_Commission_Per_Unit__c, qty);
    if (item.Supplier_Broker__c && supplierAmount !== 0) {
      addBrokerCommissionGroup(groupsByStem, {
        stemId: item.STEM__c,
        brokerId: item.Supplier_Broker__c,
        brokerName: accountMap[item.Supplier_Broker__c] || accountMap[String(item.Supplier_Broker__c).slice(0, 15)] || item.Supplier_Broker__c,
        brokerType: 'Supplier Broker',
        side: 'supplier',
        amount: supplierAmount,
      });
    }

    const buyerBrokerId = item.Buyers_Broker__c || item.Buyer_Broker__c;
    const hasSupplierBrokerUnit = Number(item.Suppliers_Brokers_Commission_Per_Unit__c || 0) !== 0;
    const buyerPerUnitAmount = brokerAmount(item.Buyers_Brokers_Commission_Per_Unit__c, qty);
    const buyerLumpsumAmount = Number(item.Buyers_Brokers_Commission_Lumpsum__c || 0);
    const buyerAmount = buyerLumpsumAmount || buyerPerUnitAmount;
    if (buyerBrokerId && buyerAmount !== 0) {
      addBrokerCommissionGroup(groupsByStem, {
        stemId: item.STEM__c,
        brokerId: buyerBrokerId,
        brokerName: accountMap[buyerBrokerId] || accountMap[String(buyerBrokerId).slice(0, 15)] || buyerBrokerId,
        brokerType: 'Buyer Broker',
        side: 'buyer',
        amount: buyerAmount,
      });
    }

    const secondaryAmount = !hasSupplierBrokerUnit && item.Commission_Cost__c != null ? Number(item.Commission_Cost__c || 0) - buyerPerUnitAmount : 0;
    const secondaryBrokers = (buyerBrokersByStem[item.STEM__c] || []).filter((broker) => {
      if (!broker.Buyer_Broker__c) return true;
      if (!buyerBrokerId) return true;
      return String(broker.Buyer_Broker__c).slice(0, 15) !== String(buyerBrokerId).slice(0, 15);
    });
    if (secondaryAmount > 0 && secondaryBrokers.length > 0) {
      for (const broker of secondaryBrokers) {
        addBrokerCommissionGroup(groupsByStem, {
          stemId: item.STEM__c,
          brokerId: broker.Buyer_Broker__c || null,
          brokerName: accountMap[broker.Buyer_Broker__c] || accountMap[String(broker.Buyer_Broker__c || '').slice(0, 15)] || broker.Buyer_Broker__c || 'Secondary Buyer Broker',
          brokerType: 'Secondary Buyer Broker',
          side: 'buyer',
          amount: secondaryAmount,
        });
      }
    }
  }
  return groupsByStem;
}

function findBrokerCommissionPaymentMatch(payment, amount, groups = [], textFields = []) {
  if (!groups.length || amount == null) return null;
  const amountMatches = groups.filter((group) => amountNearlyEqual(amount, group.amount));
  if (!amountMatches.length) return null;
  if (amountMatches.length === 1) return amountMatches[0];
  const token = paymentSearchToken(payment, textFields);
  if (token) {
    const textMatch = amountMatches.find((group) => normalizedFieldToken(group.brokerName) && token.includes(normalizedFieldToken(group.brokerName)));
    if (textMatch) return textMatch;
  }
  return amountMatches[0];
}

function incomingPaymentReference(payment, referenceFields = []) {
  const value = referenceFields.map((field) => payment[field]).find((item) => item != null && item !== '');
  return value == null ? null : String(value).trim() || null;
}

function generatedPaymentName(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  return /^pay(?:ment)?[-_\s]?\d+$/i.test(text) || /^p[-_\s]?\d+$/i.test(text) || /^[a-z]{0,4}\d{5,}$/i.test(text) || /^[a-z0-9]{15,18}$/i.test(text);
}

function incomingPaymentDisplayName({ payment, referenceFields = [], stem, supplierInvoice, type }) {
  const reference = incomingPaymentReference(payment, referenceFields);
  if (reference) return reference;

  const rawName = String(payment?.Name || '').trim();
  if (rawName && !generatedPaymentName(rawName)) return rawName;

  if (supplierInvoice?.Name) {
    return `${type === 'Supplier Refund' ? 'Supplier refund' : 'Supplier payment'} - ${supplierInvoice.Name}`;
  }
  if (stem) {
    return `${type === 'Buyer Payment' ? 'Buyer payment' : 'Payment'} - ${formatStemName(stem)}`;
  }
  return rawName || payment?.Id || 'Payment';
}

function incomingPaymentBuyerGroup(stem) {
  const account = stem?.['Account__r'] || {};
  return account.Group_Name__c || account.Parent?.Name || stem?.Buyer_Name__c || account.Name || stem?.Buyer__c || null;
}

function incomingPaymentBuyerName(stem) {
  const account = stem?.['Account__r'] || {};
  return stem?.Buyer_Name__c || account.Name || stem?.Buyer__c || null;
}

function incomingPaymentStatus({ type, amount, stem, supplierInvoice, thresholdPolicy }) {
  if (!stem && !supplierInvoice) return { label: 'Needs review', tone: 'amber' };
  if (type === 'Bank Charge') return { label: 'Bank charge', tone: 'amber' };
  if (type === 'Supplier Refund') return { label: 'Supplier refund', tone: 'green' };
  if (type === 'Supplier Payment') return { label: 'Supplier payment', tone: 'slate' };
  const receivable = incomingPaymentNumber(stem?.Receivable_Balance__c);
  if (receivable != null && receivable < 0) return { label: 'Overpaid / available balance', tone: 'purple' };
  if (receivable != null && paymentCollectionBalanceIsSettled(receivable, thresholdPolicy)) return { label: 'Fully paid', tone: 'green' };
  if (amount == null) return { label: 'Amount missing', tone: 'amber' };
  return { label: 'Partially paid', tone: 'blue' };
}

function incomingPaymentBankChargeTarget(charge, rows = []) {
  if (!charge?.stemId || charge.type !== 'Buyer Payment') return null;
  const chargeAmount = Math.abs(Number(charge.amount || 0));
  if (!Number.isFinite(chargeAmount) || chargeAmount <= 0 || chargeAmount > 1000) return null;
  const chargeDate = dateOnly(charge.paymentDate);
  const chargeCreatedDate = dateOnly(charge.createdDate);
  const candidates = rows
    .filter((row) => {
      if (!row || row.id === charge.id || row.paymentId === charge.paymentId) return false;
      if (row.type !== 'Buyer Payment' || row.stemId !== charge.stemId) return false;
      if (charge.currency && row.currency && charge.currency !== row.currency) return false;
      const targetAmount = Math.abs(Number(row.amount || 0));
      if (!Number.isFinite(targetAmount) || targetAmount <= chargeAmount) return false;
      if (targetAmount < chargeAmount * 10) return false;
      const targetDate = dateOnly(row.paymentDate);
      const targetCreatedDate = dateOnly(row.createdDate);
      return (chargeDate && targetDate && chargeDate === targetDate) || (chargeCreatedDate && targetCreatedDate && chargeCreatedDate === targetCreatedDate);
    })
    .sort((a, b) => Math.abs(Number(b.amount || 0)) - Math.abs(Number(a.amount || 0)));
  return candidates[0] || null;
}

function attachBankChargeToPayment(target, charge) {
  if (!target || !charge) return;
  if (!Array.isArray(target.bankCharges)) target.bankCharges = [];
  target.bankCharges.push({
    id: charge.id,
    paymentId: charge.paymentId,
    paymentDate: charge.paymentDate,
    amount: Math.abs(Number(charge.amount || 0)),
    currency: charge.currency,
    reference: charge.reference,
    paymentName: charge.paymentDisplayName || charge.paymentName || charge.salesforcePaymentName || charge.paymentId,
  });
  target.bankChargeTotal = (target.bankChargeTotal || 0) + Math.abs(Number(charge.amount || 0));
}

function incomingPaymentRecordTypeToken(payment) {
  return normalizedFieldToken([payment?.RecordTypeId, payment?.RecordType?.DeveloperName, payment?.RecordType?.Name].filter(Boolean).join(' '));
}

function incomingPaymentIsRemittanceRecord(payment, fields = []) {
  const token = incomingPaymentRecordTypeToken(payment);
  if (token.includes('remittance')) return true;
  return uniqueTextList(fields).some((field) => {
    const valueToken = normalizedFieldToken(payment?.[field]);
    return valueToken.includes('receivableremittance') || valueToken.includes('remittancereceivable') || valueToken.includes('payableremittance') || valueToken.includes('remittancepayable');
  });
}

const incomingPaymentIsReceivableRemittance = incomingPaymentIsRemittanceRecord;

function supplierInvoicePartyName(invoice, supplierRelationships = []) {
  return invoice?.Supplier_Name__c || invoice?.['Supplier__r']?.Name || invoice?.['Expected_Supplier__r']?.Name || invoice?.['Substitute_Supplier__r']?.Name || supplierRelationships.map((relationship) => invoice?.[relationship]?.Name).find(Boolean) || null;
}

async function incomingBuyerCiaInvoices({ thresholdState, accessContext = null } = {}) {
  const describe = await salesforceObjectFields({
    objectName: 'stem__c',
  }).catch(() => ({ fields: [] }));
  const fields = describe.fields || [];
  const fieldNames = new Set(fields.map((field) => field.name));
  if (!fieldNames.has('Payment_Term__c')) return [];

  const accountDescribe = fieldNames.has('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({
        fields: [],
      }))
    : { fields: [] };
  const accountFieldNames = new Set((accountDescribe.fields || []).map((field) => field.name));
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames, accountFieldNames);
  const selectFields = ['Id', 'Name', ...selectedFields(fieldNames, ['KeyStem__c', 'Buyer_Name__c', 'Buyer__c', 'Account__c', 'Payment_Term__c', 'Total_Invoice_Amount__c', 'Receivable_Balance__c', 'Payment_Date__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c', 'CurrencyIsoCode'])];
  if (fieldNames.has('Vessel__c')) selectFields.push('Vessel__r.Name');
  if (fieldNames.has('Port__c')) selectFields.push('Port__r.Name');
  if (fieldNames.has('Account__c')) {
    selectFields.push('Account__r.Name');
    if (accountFieldNames.has('Group_Name__c')) selectFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.has('ParentId')) selectFields.push('Account__r.Parent.Name');
  }

  const whereParts = ["Payment_Term__c LIKE '%CIA%'"];
  if (fieldNames.has('Payment_Date__c')) whereParts.push('Payment_Date__c = null');
  if (fieldNames.has('Delivery_Date__c')) whereParts.push('(Delivery_Date__c = null OR Delivery_Date__c >= 2026-01-01)');
  if (interofficeCondition) whereParts.push(interofficeCondition);
  const orderBy = fieldNames.has('Delivery_Date__c') ? 'Delivery_Date__c DESC NULLS LAST, CreatedDate DESC' : 'CreatedDate DESC';

  const stems = await queryRows(
    `
    SELECT ${[...new Set(selectFields)].join(', ')}
    FROM stem__c
    WHERE ${whereParts.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT 1000
  `,
    { limit: 1000, softFail: true },
  );
  const stemIds = stems.map((stem) => stem.Id).filter(Boolean);
  if (!stemIds.length) return [];

  const traderByStem = {};
  const [nominationArrays, lineItemArrays, extraCostArrays] = await Promise.all([
    compositeQueryRows(
      chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return {
          soql: `
        SELECT Id, Name, STEM__c, Buyer_Supplier_Trader__c
        FROM Nomination__c
        WHERE STEM__c IN (${inList}) AND Buyer_Supplier_Trader__c != null
        ORDER BY CreatedDate ASC
        LIMIT 5000
      `,
          limit: 5000,
          softFail: true,
        };
      }),
    ),
    compositeQueryRows(
      chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return {
          soql: `
        SELECT STEM__c, Total_Price__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
               Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
               Price_Per_Unit__c, Unit_Sell_At__c, Offer_Line_Item__r.UnitPrice
        FROM STEM_Line_Item__c
        WHERE STEM__c IN (${inList})
        LIMIT 5000
      `,
          limit: 5000,
          softFail: true,
        };
      }),
    ),
    compositeQueryRows(
      chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return {
          soql: `
        SELECT STEM__c, Line_Total__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
               Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c, Unit_Price__c
        FROM STEM_Extra_Cost__c
        WHERE STEM__c IN (${inList})
        LIMIT 5000
      `,
          limit: 5000,
          softFail: true,
        };
      }),
    ),
  ]);

  for (const nomination of nominationArrays.flat()) {
    if (!nomination.STEM__c || !nomination.Buyer_Supplier_Trader__c) continue;
    if (!traderByStem[nomination.STEM__c]) traderByStem[nomination.STEM__c] = { buyer: [], all: [] };
    if (!traderByStem[nomination.STEM__c].all.includes(nomination.Buyer_Supplier_Trader__c)) {
      traderByStem[nomination.STEM__c].all.push(nomination.Buyer_Supplier_Trader__c);
    }
    if (String(nomination.Name || '').startsWith('Confirmation to ') && !traderByStem[nomination.STEM__c].buyer.includes(nomination.Buyer_Supplier_Trader__c)) {
      traderByStem[nomination.STEM__c].buyer.push(nomination.Buyer_Supplier_Trader__c);
    }
  }

  const calculatedByStem = {};
  for (const item of lineItemArrays.flat()) {
    if (!item.STEM__c || item.Cancelled__c) continue;
    const stem = stems.find((row) => row.Id === item.STEM__c);
    calculatedByStem[item.STEM__c] = (calculatedByStem[item.STEM__c] || 0) + lineSellAmount(item, !!stem?.Delivery_Date__c);
  }
  for (const item of extraCostArrays.flat()) {
    if (!item.STEM__c || item.Cancelled__c) continue;
    const stem = stems.find((row) => row.Id === item.STEM__c);
    calculatedByStem[item.STEM__c] = (calculatedByStem[item.STEM__c] || 0) + extraSellAmount(item, !!stem?.Delivery_Date__c);
  }

  return stems.filter((stem) => {
    if (stem.Receivable_Balance__c == null) return true;
    return !paymentCollectionBalanceIsSettled(
      stem.Receivable_Balance__c,
      paymentCollectionThresholdPolicy(thresholdState, stem.CurrencyIsoCode),
    );
  }).map((stem) => {
    const account = stem['Account__r'] || {};
    const traderInfo = traderByStem[stem.Id] || {};
    const calculatedAmount = calculatedByStem[stem.Id] > 0 ? calculatedByStem[stem.Id] : incomingPaymentNumber(stem.Total_Invoice_Amount__c);
    return {
      id: stem.Id,
      stemId: stem.Id,
      stemName: formatStemName(stem),
      keyStem: stem.KeyStem__c || null,
      buyerName: incomingPaymentBuyerName(stem),
      buyerGroupName: account.Group_Name__c || account.Parent?.Name || incomingPaymentBuyerName(stem),
      buyerTrader: (traderInfo.buyer?.length ? traderInfo.buyer : traderInfo.all || []).join(', ') || null,
      paymentTerms: stem.Payment_Term__c || null,
      calculatedAmount,
      receivableBalance: incomingPaymentNumber(stem.Receivable_Balance__c),
      currency: stem.CurrencyIsoCode || null,
      deliveryDate: stem.Delivery_Date__c || null,
    };
  });
}

async function incomingPaymentsListSnapshot(body, req = null, accessContext = null) {
  const settings = body._settingsOverride || (await loadIncomingPaymentSettings());
  const today = dateOnly(new Date());
  const dateFrom = dateOnly(body.dateFrom || body.date_from || today);
  const dateTo = dateOnly(body.dateTo || body.date_to || today);
  const limit = Math.max(100, Math.min(Number(body.limit) || 5000, 10000));

  const paymentDescribe = await salesforceObjectFields({
    objectName: 'Payment__c',
  }).catch(() => ({ fields: [] }));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  const paymentFieldByName = Object.fromEntries(paymentFields.map((field) => [field.name, field]));
  if (!paymentFieldNames.size)
    return {
      rows: [],
      availableBalances: [],
      summary: {},
      settings,
      schemaWarnings: ['Payment__c is not queryable.'],
    };

  const dateField = firstAvailableField(paymentFieldNames, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const amountField = firstAvailableField(paymentFieldNames, ['Amount__c', 'Payment_Amount__c', 'Paid_Amount__c', 'Received_Amount__c', 'Total_Amount__c', 'Amount_Paid__c', 'Payment_Value__c', 'Actual_Amount__c']);
  const referenceFields = incomingPaymentReferenceFields(paymentFields);
  const statusFields = selectedFields(paymentFieldNames, ['Status__c', 'Payment_Status__c']);
  const typeFields = selectedFields(paymentFieldNames, ['Type__c', 'Payment_Type__c']);
  const supplierInvoiceLookupFields = incomingPaymentSupplierInvoiceFields(paymentFields);
  const directionFields = incomingPaymentDirectionFields(paymentFields);
  const paymentSelectFields = ['Id', ...selectedFields(paymentFieldNames, ['Name', 'RecordTypeId', 'CreatedDate', 'LastModifiedDate', 'STEM__c', 'CurrencyIsoCode', 'Currency__c']), paymentFieldNames.has('RecordTypeId') ? 'RecordType.Name' : null, paymentFieldNames.has('RecordTypeId') ? 'RecordType.DeveloperName' : null, ...supplierInvoiceLookupFields, dateField, amountField, ...referenceFields, ...statusFields, ...typeFields, ...directionFields].filter(Boolean);

  const filterDateField = paymentFieldNames.has('CreatedDate') ? 'CreatedDate' : dateField;
  const filterDateType = paymentFieldByName[filterDateField]?.type || null;
  const filterDateValue = (isoDate, endOfDay = false) => (filterDateField === 'CreatedDate' ? soqlHongKongDateTimeValue(isoDate, endOfDay) : soqlDateValue(filterDateField, filterDateType, isoDate, endOfDay));
  const whereParts = [];
  if (filterDateField && dateFrom) whereParts.push(`${filterDateField} >= ${filterDateValue(dateFrom, false)}`);
  if (filterDateField && dateTo) whereParts.push(`${filterDateField} <= ${filterDateValue(dateTo, true)}`);
  const orderBy = filterDateField ? `${filterDateField} DESC NULLS LAST${filterDateField !== 'CreatedDate' ? ', CreatedDate DESC' : ''}` : 'CreatedDate DESC';
  const payments = await queryRows(
    `
    SELECT ${[...new Set(paymentSelectFields)].join(', ')}
    FROM Payment__c
    ${whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''}
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `,
    { limit, softFail: true },
  );

  const eligiblePayments = payments.filter((payment) => !incomingPaymentIsReceivableRemittance(payment, [...referenceFields, ...directionFields, ...typeFields, ...statusFields]));
  const directStemIds = eligiblePayments.map((payment) => payment.STEM__c).filter(Boolean);
  const supplierInvoiceIds = eligiblePayments.map((payment) => incomingPaymentSupplierInvoiceId(payment, supplierInvoiceLookupFields)).filter(Boolean);
  const supplierInvoiceDescribe = supplierInvoiceIds.length ? await salesforceObjectFields({ objectName: 'Supplier_Invoice__c' }).catch(() => ({ fields: [] })) : { fields: [] };
  const supplierInvoiceFields = supplierInvoiceDescribe.fields || [];
  const supplierInvoiceFieldNames = new Set(supplierInvoiceFields.map((field) => field.name));
  const supplierInvoiceFieldByName = Object.fromEntries(supplierInvoiceFields.map((field) => [field.name, field]));
  const supplierInvoicePayableField = firstAvailableField(supplierInvoiceFieldNames, ['Payable_Balance__c', 'Balance__c', 'Actual_Balance__c', 'Outstanding_Balance__c']);
  const supplierInvoiceAmountField = firstAvailableField(supplierInvoiceFieldNames, ['Invoice_Amount__c', 'Calculated_Amount__c', 'Amount__c', 'Total_Amount__c']);
  const supplierInvoiceSupplierFields = selectedFields(supplierInvoiceFieldNames, ['Supplier__c', 'Expected_Supplier__c', 'Substitute_Supplier__c']);
  const supplierInvoiceSupplierRelationships = supplierInvoiceSupplierFields.map((field) => supplierInvoiceFieldByName[field]?.relationshipName).filter(Boolean);
  const supplierInvoiceMap = {};
  if (supplierInvoiceIds.length && supplierInvoiceFieldNames.size) {
    const supplierInvoiceSelectFields = ['Id', 'Name', ...selectedFields(supplierInvoiceFieldNames, ['STEM__c', 'Supplier_Name__c']), supplierInvoiceAmountField, supplierInvoicePayableField, ...supplierInvoiceSupplierFields, ...supplierInvoiceSupplierRelationships.map((relationship) => `${relationship}.Name`)].filter(Boolean);
    const invoiceChunks = await compositeQueryRows(
      chunkIds([...new Set(supplierInvoiceIds)]).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return {
          soql: `
        SELECT ${[...new Set(supplierInvoiceSelectFields)].join(', ')}
        FROM Supplier_Invoice__c
        WHERE Id IN (${inList})
        LIMIT 5000
      `,
          limit: 5000,
          softFail: true,
        };
      }),
    );
    for (const invoice of invoiceChunks.flat()) supplierInvoiceMap[invoice.Id] = invoice;
  }

  const stemIds = [
    ...new Set([
      ...directStemIds,
      ...Object.values(supplierInvoiceMap)
        .map((invoice) => invoice.STEM__c)
        .filter(Boolean),
    ]),
  ];
  const stemDescribe = stemIds.length
    ? await salesforceObjectFields({ objectName: 'stem__c' }).catch(() => ({
        fields: [],
      }))
    : { fields: [] };
  const stemFields = stemDescribe.fields || [];
  const stemFieldNames = new Set(stemFields.map((field) => field.name));
  const accountDescribe = stemFieldNames.has('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({
        fields: [],
      }))
    : { fields: [] };
  const accountFieldNames = new Set((accountDescribe.fields || []).map((field) => field.name));
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, stemFieldNames, accountFieldNames);
  const stemSelectFields = ['Id', 'Name', ...selectedFields(stemFieldNames, ['KeyStem__c', 'Buyer_Name__c', 'Buyer__c', 'Account__c', 'Total_Invoice_Amount__c', 'Total_Invoiced_Amount_From_Suppliers__c', 'Receivable_Balance__c', 'Payable_Balance__c', 'Total_Costs__c', 'Total_Cost__c', 'Total_Cost_Amount__c', 'Payment_Date__c', 'Payment_Term__c', 'Invoice_Due_Date__c', 'Buyer_Pay_Term_Date__c', 'Due_Date__c', 'Delivery_Date__c', 'Delivery_Date_Or_Expected__c', 'Expected_Delivery_Date__c', 'CurrencyIsoCode'])];
  if (stemFieldNames.has('Vessel__c')) stemSelectFields.push('Vessel__r.Name');
  if (stemFieldNames.has('Port__c')) stemSelectFields.push('Port__r.Name');
  if (stemFieldNames.has('Account__c')) {
    stemSelectFields.push('Account__r.Name');
    if (accountFieldNames.has('Group_Name__c')) stemSelectFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.has('ParentId')) stemSelectFields.push('Account__r.Parent.Name');
  }
  const stemMap = {};
  if (stemIds.length && stemFieldNames.size) {
    const stemChunks = await compositeQueryRows(
      chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        const stemWhere = combineWhereConditions([`Id IN (${inList})`, interofficeCondition]);
        return {
          soql: `
        SELECT ${[...new Set(stemSelectFields)].join(', ')}
        FROM stem__c
        WHERE ${stemWhere}
        LIMIT 5000
      `,
          limit: 5000,
          softFail: true,
        };
      }),
    );
    for (const stem of stemChunks.flat()) stemMap[stem.Id] = stem;
  }
  let brokerCommissionGroupsByStem = {};
  let lineItemsByStem = {};
  let extraCostsByStem = {};
  if (stemIds.length) {
    const [lineItemChunks, buyerBrokerChunks, extraCostChunks] = await Promise.all([
      compositeQueryRows(
        chunkIds(stemIds).map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return {
            soql: `
          SELECT Id, STEM__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
                 Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
                 Cost_Per_Unit__c, Unit_Buy_At__c, Unit_Cost__c, Total_Cost__c,
                 Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
                 Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c,
                 Buyers_Brokers_Commission_Lumpsum__c, Commission_Cost__c, Supplier_Invoice__c,
                 Offer_Line_Item__r.Supplier_Unit_Price__c
          FROM STEM_Line_Item__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      ),
      compositeQueryRows(
        chunkIds(stemIds).map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return {
            soql: `
          SELECT Id, STEM__c, Buyer_Broker__c
          FROM STEM_Buyer_Broker__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      ),
      compositeQueryRows(
        chunkIds(stemIds).map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return {
            soql: `
          SELECT Id, STEM__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
                 Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c,
                 Unit_Cost__c, Line_Total_Buy__c, Supplier_Invoice__c
          FROM STEM_Extra_Cost__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      ),
    ]);
    const brokerLineItems = lineItemChunks.flat();
    const brokerRows = buyerBrokerChunks.flat();
    const extraCostRows = extraCostChunks.flat();
    lineItemsByStem = brokerLineItems.reduce((acc, item) => {
      if (!item.STEM__c) return acc;
      if (!acc[item.STEM__c]) acc[item.STEM__c] = [];
      acc[item.STEM__c].push(item);
      return acc;
    }, {});
    extraCostsByStem = extraCostRows.reduce((acc, item) => {
      if (!item.STEM__c) return acc;
      if (!acc[item.STEM__c]) acc[item.STEM__c] = [];
      acc[item.STEM__c].push(item);
      return acc;
    }, {});
    const brokerAccountIds = [...new Set([...brokerLineItems.map((item) => item.Supplier_Broker__c).filter(Boolean), ...brokerLineItems.map((item) => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean), ...brokerRows.map((item) => item.Buyer_Broker__c).filter(Boolean)])];
    const accountMap = await namesByIds('Account', brokerAccountIds);
    for (const [id, name] of Object.entries(accountMap)) accountMap[String(id).slice(0, 15)] = name;
    brokerCommissionGroupsByStem = buildBrokerCommissionGroups({
      stemMap,
      lineItems: brokerLineItems,
      buyerBrokers: brokerRows,
      accountMap,
    });
  }

  const availableStemKeys = new Set();
  const availableBalancesByGroup = {};
  const allRows = eligiblePayments
    .map((payment) => {
      const supplierInvoiceId = incomingPaymentSupplierInvoiceId(payment, supplierInvoiceLookupFields);
      const supplierInvoice = supplierInvoiceId ? supplierInvoiceMap[supplierInvoiceId] || null : null;
      const stemId = payment.STEM__c || supplierInvoice?.STEM__c || null;
      const stem = stemId ? stemMap[stemId] || null : null;
      if (stemId && !stem) return null;
      const amount = amountField ? incomingPaymentNumber(payment[amountField]) : null;
      const brokerCommissionMatch = stem?.Id ? findBrokerCommissionPaymentMatch(payment, amount, brokerCommissionGroupsByStem[stem.Id] || [], [...referenceFields, ...directionFields, ...typeFields, ...statusFields]) : null;
      const bankCharge = incomingPaymentLooksBankCharge(payment, {
        referenceFields,
        directionFields,
        typeFields,
        statusFields,
      });
      const payableCalculation = stem?.Id
        ? incomingPaymentLooksStemPayableCalculation(payment, {
            amount,
            payableAmounts: stemPayableAmountCandidates({
              stem,
              lineItems: lineItemsByStem[stem.Id] || [],
              extraCosts: extraCostsByStem[stem.Id] || [],
            }),
            referenceFields,
            directionFields,
            typeFields,
            statusFields,
            allowBlankSignal: !stem.Delivery_Date__c,
          })
        : false;
      const type = brokerCommissionMatch
        ? 'Broker Commission'
        : bankCharge
          ? 'Bank Charge'
          : payableCalculation
            ? 'Supplier Payment'
            : incomingPaymentTypeFromContext(payment, {
                amount,
                stem,
                supplierInvoice,
                supplierInvoiceFields: supplierInvoiceLookupFields,
                directionFields,
                typeFields,
                statusFields,
              });
      let incomingAmount = amount;
      if (type.startsWith('Supplier')) {
        incomingAmount = type === 'Supplier Refund' && amount != null ? Math.abs(amount) : amount;
      }
      const paymentDate = dateField ? payment[dateField] || null : payment.CreatedDate || null;
      const buyerInvoiceDueDate = type === 'Buyer Payment' && stem ? calculatedBuyerPayTermDate(stem) || stem.Invoice_Due_Date__c || stem.Due_Date__c || stem.Buyer_Pay_Term_Date__c || null : null;
      const delayDays = type === 'Buyer Payment' && buyerInvoiceDueDate && paymentDate ? daysBetween(buyerInvoiceDueDate, dateOnly(paymentDate)) : null;
      const status = incomingPaymentStatus({
        type,
        amount,
        stem,
        supplierInvoice,
        thresholdPolicy: paymentCollectionThresholdPolicy(settings, stem?.CurrencyIsoCode || payment.CurrencyIsoCode || payment.Currency__c),
      });
      const receivable = incomingPaymentNumber(stem?.Receivable_Balance__c);
      const buyerName = incomingPaymentBuyerName(stem);
      const buyerGroupName = incomingPaymentBuyerGroup(stem);
      const partyName = type.startsWith('Supplier') ? supplierInvoicePartyName(supplierInvoice, supplierInvoiceSupplierRelationships) : buyerName;
      if (stem?.Id && receivable != null && receivable < 0) {
        const key = stem.Id;
        if (!availableStemKeys.has(key)) {
          availableStemKeys.add(key);
          const groupKey = buyerGroupName || buyerName || 'Ungrouped buyer';
          if (!availableBalancesByGroup[groupKey]) {
            availableBalancesByGroup[groupKey] = {
              buyerGroupName: groupKey,
              buyerNames: new Set(),
              totalAvailableBalance: 0,
              stems: [],
            };
          }
          if (buyerName) availableBalancesByGroup[groupKey].buyerNames.add(buyerName);
          availableBalancesByGroup[groupKey].totalAvailableBalance += Math.abs(receivable);
          availableBalancesByGroup[groupKey].stems.push({
            stemId: stem.Id,
            stemName: formatStemName(stem),
            buyerName,
            availableBalance: Math.abs(receivable),
            receivableBalance: receivable,
            paymentDate: stem.Payment_Date__c || payment[dateField] || payment.CreatedDate || null,
          });
        }
      }
      return {
        id: payment.Id,
        paymentId: payment.Id,
        paymentName: incomingPaymentDisplayName({
          payment,
          referenceFields,
          stem,
          supplierInvoice,
          type,
        }),
        paymentDisplayName: incomingPaymentDisplayName({
          payment,
          referenceFields,
          stem,
          supplierInvoice,
          type,
        }),
        salesforcePaymentName: payment.Name || null,
        paymentRecordTypeName: payment.RecordType?.Name || null,
        paymentRecordTypeDeveloperName: payment.RecordType?.DeveloperName || null,
        paymentDate,
        createdDate: payment.CreatedDate || null,
        invoiceDueDate: buyerInvoiceDueDate,
        delayDays,
        paymentTerms: type === 'Buyer Payment' ? stem?.Payment_Term__c || null : null,
        type,
        isIncoming: type === 'Buyer Payment' || type === 'Supplier Refund',
        isBankCharge: type === 'Bank Charge',
        amount,
        incomingAmount,
        currency: payment.CurrencyIsoCode || payment.Currency__c || 'USD',
        reference: incomingPaymentReference(payment, referenceFields),
        salesforceStatus: statusFields.map((field) => payment[field]).find(Boolean) || null,
        salesforceType: typeFields.map((field) => payment[field]).find(Boolean) || null,
        stemId,
        stemName: stem ? formatStemName(stem) : null,
        keyStem: stem?.KeyStem__c || null,
        buyerName,
        buyerGroupName,
        supplierInvoiceId: supplierInvoice?.Id || supplierInvoiceId || null,
        supplierInvoiceName: supplierInvoice?.Name || null,
        supplierName: supplierInvoicePartyName(supplierInvoice, supplierInvoiceSupplierRelationships),
        partyName,
        invoiceAmount: incomingPaymentNumber(stem?.Total_Invoice_Amount__c),
        receivableBalance: receivable,
        payableBalance: supplierInvoicePayableField ? incomingPaymentNumber(supplierInvoice?.[supplierInvoicePayableField]) : incomingPaymentNumber(stem?.Payable_Balance__c),
        supplierInvoiceAmount: supplierInvoiceAmountField ? incomingPaymentNumber(supplierInvoice?.[supplierInvoiceAmountField]) : null,
        status: status.label,
        statusTone: status.tone,
        paymentObjectAmountField: amountField,
        paymentObjectSupplierInvoiceFields: supplierInvoiceLookupFields,
        brokerCommissionMatch,
      };
    })
    .filter(Boolean);
  const rows = allRows.filter((row) => row.type !== 'Supplier Payment' && row.type !== 'Bank Charge' && row.type !== 'Broker Commission').map((row) => ({ ...row, bankCharges: [] }));
  const ungroupedBankCharges = [];
  for (const charge of allRows.filter((row) => row.type === 'Bank Charge')) {
    const chargeDate = dateOnly(charge.paymentDate);
    const candidates = rows
      .filter((row) => row.type === 'Buyer Payment' && row.stemId && row.stemId === charge.stemId)
      .sort((a, b) => {
        const aSameDate = dateOnly(a.paymentDate) === chargeDate ? 1 : 0;
        const bSameDate = dateOnly(b.paymentDate) === chargeDate ? 1 : 0;
        if (aSameDate !== bSameDate) return bSameDate - aSameDate;
        return Math.abs(Number(b.amount || 0)) - Math.abs(Number(a.amount || 0));
      });
    const target = candidates[0] || null;
    if (target) {
      attachBankChargeToPayment(target, charge);
    } else {
      ungroupedBankCharges.push(charge);
    }
  }
  const implicitBankChargeIds = new Set();
  for (const charge of rows) {
    const target = incomingPaymentBankChargeTarget(charge, rows);
    if (!target) continue;
    attachBankChargeToPayment(target, charge);
    implicitBankChargeIds.add(charge.id || charge.paymentId);
  }
  const displayRows = rows.filter((row) => !implicitBankChargeIds.has(row.id || row.paymentId));
  displayRows.push(...ungroupedBankCharges);

  const interestNotificationMap = body._omitIncomingLiveState ? {} : await loadIncomingPaymentInterestNotificationMap(displayRows.map((row) => row.paymentId || row.id));
  const rowsWithInterestNotifications = displayRows.map((row) => {
    const notification = interestNotificationMap[row.paymentId || row.id] || null;
    return {
      ...row,
      interestInvoiceNotification: notification,
      interestInvoiceNotificationSent: notification?.deliveryStatus === 'sent',
      interestInvoiceNotificationPending: ['sending', 'uncertain'].includes(notification?.deliveryStatus),
    };
  });

  const includedIncomingRows = rowsWithInterestNotifications.filter((row) => row.isIncoming);
  const buyerCiaInvoices = await incomingBuyerCiaInvoices({
    thresholdState: settings,
    accessContext,
  });
  const availableBalances = Object.values(availableBalancesByGroup)
    .map((group) => ({
      buyerGroupName: group.buyerGroupName,
      buyerNames: [...group.buyerNames].sort((a, b) => a.localeCompare(b)),
      totalAvailableBalance: group.totalAvailableBalance,
      stems: group.stems.sort((a, b) => String(b.paymentDate || '').localeCompare(String(a.paymentDate || ''))),
    }))
    .sort((a, b) => b.totalAvailableBalance - a.totalAvailableBalance);

  return {
    rows: rowsWithInterestNotifications,
    buyerCiaInvoices,
    availableBalances,
    settings,
    dateFrom,
    dateTo,
    schema: {
      paymentDateField: dateField,
      paymentFilterDateField: filterDateField,
      paymentAmountField: amountField,
      paymentReferenceFields: referenceFields,
      paymentSupplierInvoiceFields: supplierInvoiceLookupFields,
      supplierInvoicePayableField,
      supplierInvoiceAmountField,
    },
    schemaWarnings: [amountField ? null : 'No amount-like field was found on Payment__c.', dateField ? null : 'No date-like field was found on Payment__c.', 'Supplier-invoice-linked negative payments are classified as supplier refunds. Confirm if Salesforce uses the opposite sign.'].filter(Boolean),
    summary: {
      totalRows: rowsWithInterestNotifications.length,
      incomingRows: includedIncomingRows.length,
      totalIncomingAmount: includedIncomingRows.reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
      buyerPaymentTotal: rowsWithInterestNotifications.filter((row) => row.type === 'Buyer Payment').reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
      supplierRefundTotal: rowsWithInterestNotifications.filter((row) => row.type === 'Supplier Refund').reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
      unmatchedCount: rowsWithInterestNotifications.filter((row) => row.type === 'Unmatched' || row.status === 'Needs review').length,
      fullyPaidCount: rowsWithInterestNotifications.filter((row) => row.status === 'Fully paid').length,
      availableBalanceTotal: availableBalances.reduce((sum, group) => sum + Number(group.totalAvailableBalance || 0), 0),
      availableBalanceCount: availableBalances.reduce((sum, group) => sum + (group.stems?.length || 0), 0),
    },
  };
}

async function incomingPaymentsList(body, req = null, accessContext = null) {
  const settings = await loadIncomingPaymentSettings();
  const today = dateOnly(new Date());
  const dateFrom = dateOnly(body.dateFrom || body.date_from || today);
  const dateTo = dateOnly(body.dateTo || body.date_to || today);
  const limit = Math.max(100, Math.min(Number(body.limit) || 5000, 10000));
  const { value: snapshot } = await cachedSalesforceValue({
    namespace: 'incoming-payments',
    payload: { dateFrom, dateTo, limit, thresholds: paymentCollectionThresholdCacheKey(settings) },
    ttlSeconds: 60,
    tags: ['salesforce:incoming-payments', 'salesforce:stem', 'salesforce:account', 'salesforce:object:Payment__c', 'salesforce:object:Supplier_Invoice__c'],
    body,
    req,
    accessContext,
    loader: () =>
      incomingPaymentsListSnapshot(
        {
          ...body,
          dateFrom,
          dateTo,
          limit,
          _settingsOverride: settings,
          _omitIncomingLiveState: true,
        },
        req,
        accessContext,
      ),
  });
  const notificationMap = await loadIncomingPaymentInterestNotificationMap((snapshot.rows || []).map((row) => row.paymentId || row.id));
  const collectionMap = await loadBuyerInvoiceCollectionMap((snapshot.rows || []).map((row) => row.stemId).filter(Boolean));
  return {
    ...snapshot,
    settings,
    rows: (snapshot.rows || []).map((row) => {
      const notification = notificationMap[row.paymentId || row.id] || null;
      return {
        ...row,
        collection: collectionMap[row.stemId]?.item || null,
        collectionEvents: collectionMap[row.stemId]?.events || [],
        interestInvoiceNotification: notification,
        interestInvoiceNotificationSent: notification?.deliveryStatus === 'sent',
        interestInvoiceNotificationPending: ['sending', 'uncertain'].includes(notification?.deliveryStatus),
      };
    }),
  };
}

async function incomingPaymentAllocationConfirm(body, req) {
  await requireAdministrator(req);
  const buyerGroupName = String(body.buyerGroupName || body.buyer_group_name || '').trim();
  if (!buyerGroupName) throw appError('Buyer group is required.', 400);
  throw appError('Salesforce payment allocation write-back is not enabled yet. Confirm the Salesforce object and fields for applying available buyer balances to another STEM.', 501);
}

const INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS = ['id', 'payment_id', 'payment_name', 'stem_id', 'stem_name', 'buyer_name', 'buyer_group_name', 'received_date', 'payment_created_date', 'delay_days', 'amount', 'currency', 'receivable_balance', 'recipient_email', 'email_subject', 'email_message_id', 'email_provider', 'actor_user_id', 'actor_email', 'actor_name', 'metadata', 'delivery_status', 'last_attempt_at', 'last_error', 'sender_mailbox_id', 'sender_mailbox_snapshot', 'sent_at', 'created_at', 'updated_at'].join(',');

function incomingPaymentDbNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function incomingPaymentDbDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeIncomingPaymentInterestNotification(row = null) {
  if (!row) return null;
  return {
    id: row.id,
    paymentId: row.payment_id,
    paymentName: row.payment_name,
    stemId: row.stem_id,
    stemName: row.stem_name,
    buyerName: row.buyer_name,
    buyerGroupName: row.buyer_group_name,
    receivedDate: row.received_date,
    paymentCreatedDate: row.payment_created_date,
    delayDays: row.delay_days,
    amount: incomingPaymentNumber(row.amount),
    currency: row.currency,
    receivableBalance: incomingPaymentNumber(row.receivable_balance),
    recipientEmail: row.recipient_email,
    emailSubject: row.email_subject,
    emailMessageId: row.email_message_id,
    emailProvider: row.email_provider,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    metadata: row.metadata || {},
    deliveryStatus: row.delivery_status || 'sent',
    lastAttemptAt: row.last_attempt_at || null,
    lastError: row.last_error || null,
    senderMailboxId: row.sender_mailbox_id || null,
    senderMailboxSnapshot: row.sender_mailbox_snapshot || null,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

function incomingPaymentInterestTableUnavailable(error) {
  return error?.code === '42P01' || /incoming_payment_interest_notifications/i.test(error?.message || '');
}

async function loadIncomingPaymentInterestNotificationMap(paymentIds = []) {
  const client = safeSupabaseAdminClient();
  if (!client) return {};
  const ids = [...new Set(paymentIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return {};
  const notifications = {};
  for (const chunk of chunkIds(ids, 500)) {
    const { data, error } = await client.from('incoming_payment_interest_notifications').select(INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS).in('payment_id', chunk);
    if (error) {
      if (!incomingPaymentInterestTableUnavailable(error)) {
        console.error('Failed to load incoming payment interest notifications', error.message);
      }
      return {};
    }
    for (const row of data || []) notifications[row.payment_id] = serializeIncomingPaymentInterestNotification(row);
  }
  return notifications;
}

async function fetchIncomingPaymentInterestNotification(client, paymentId) {
  const { data, error } = await client.from('incoming_payment_interest_notifications').select(INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS).eq('payment_id', paymentId).maybeSingle();
  if (error) {
    if (incomingPaymentInterestTableUnavailable(error)) {
      throw appError('Missing Supabase table incoming_payment_interest_notifications. Run the latest Supabase migration before requesting late payment interest invoices.', 500);
    }
    throw error;
  }
  return serializeIncomingPaymentInterestNotification(data);
}

function incomingPaymentInterestRateField(accountFields = []) {
  const allowedTypes = new Set(['double', 'percent', 'currency', 'int', 'string', 'picklist']);
  const matches = accountFields.filter((field) => field?.name && allowedTypes.has(field.type) && fieldMatchesAny(field, ['latepaymentinterestrate', 'latepaymentinterestratec', 'paymentinterestrate', 'paymentinterestratec', 'overdueinterestrate', 'overdueinterestratec', 'interestrate', 'interestratec', 'financechargerate', 'financechargeratec'], ['latepaymentinterest', 'overdueinterest', 'interestrate', 'financecharge']));
  return matches[0] || null;
}

function parseIncomingPaymentInterestRate(value) {
  if (value == null || value === '') return null;
  const match = String(value)
    .replace(/,/g, '')
    .match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.abs(number) > 1 ? number / 100 : number;
}

function incomingPaymentInterestRateLabel(rateDecimal) {
  if (rateDecimal == null) return '-';
  return `${(Number(rateDecimal) * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% per month`;
}

function interestFormulaText(balance, rateDecimal, days) {
  return `${money(balance)} x ${incomingPaymentInterestRateLabel(rateDecimal)} x ${days} / 30`;
}

async function incomingPaymentInterestCalculation(body = {}, accessContext = null) {
  const stemId = String(body.stemId || body.stem_id || '').trim();
  if (!isSalesforceId(stemId)) throw appError('Valid stemId is required for late payment interest calculation.', 400);
  await requireInterofficeStemAccess(stemId, accessContext);

  const [stemDescribe, paymentDescribe] = await Promise.all([
    salesforceObjectFields({ objectName: 'stem__c' }).catch(() => ({
      fields: [],
    })),
    salesforceObjectFields({ objectName: 'Payment__c' }).catch(() => ({
      fields: [],
    })),
  ]);
  const stemFields = stemDescribe.fields || [];
  const stemFieldNames = new Set(stemFields.map((field) => field.name));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  if (!paymentFieldNames.size) throw appError('Payment__c is not queryable, so interest cannot be calculated.', 500);

  const accountDescribe = stemFieldNames.has('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({
        fields: [],
      }))
    : { fields: [] };
  const accountFields = accountDescribe.fields || [];
  const accountFieldNames = new Set(accountFields.map((field) => field.name));
  const interestField = incomingPaymentInterestRateField(accountFields);

  const stemSelectFields = ['Id', 'Name', ...selectedFields(stemFieldNames, ['KeyStem__c', 'Buyer_Name__c', 'Buyer__c', 'Account__c', 'Total_Invoice_Amount__c', 'Receivable_Balance__c', 'Payment_Term__c', 'Invoice_Due_Date__c', 'Buyer_Pay_Term_Date__c', 'Due_Date__c', 'Delivery_Date__c', 'Delivery_Date_Or_Expected__c', 'Expected_Delivery_Date__c'])];
  if (stemFieldNames.has('Vessel__c')) stemSelectFields.push('Vessel__r.Name');
  if (stemFieldNames.has('Port__c')) stemSelectFields.push('Port__r.Name');
  if (stemFieldNames.has('Account__c')) {
    stemSelectFields.push('Account__r.Name');
    if (accountFieldNames.has('Group_Name__c')) stemSelectFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.has('ParentId')) stemSelectFields.push('Account__r.Parent.Name');
    if (interestField?.name) stemSelectFields.push(`Account__r.${interestField.name}`);
  }

  const stemRows = await queryRows(
    `
    SELECT ${[...new Set(stemSelectFields)].join(', ')}
    FROM stem__c
    WHERE Id = '${escapeSoql(stemId)}'
    LIMIT 1
  `,
    { limit: 1, softFail: true },
  );
  const stem = stemRows[0];
  if (!stem) throw appError('STEM was not found in Salesforce.', 404);

  const dateField = firstAvailableField(paymentFieldNames, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const amountField = firstAvailableField(paymentFieldNames, ['Amount__c', 'Payment_Amount__c', 'Paid_Amount__c', 'Received_Amount__c', 'Total_Amount__c', 'Amount_Paid__c', 'Payment_Value__c', 'Actual_Amount__c']);
  if (!dateField || !amountField) throw appError('Payment date or amount field was not found on Payment__c.', 500);

  const referenceFields = incomingPaymentReferenceFields(paymentFields);
  const statusFields = selectedFields(paymentFieldNames, ['Status__c', 'Payment_Status__c']);
  const typeFields = selectedFields(paymentFieldNames, ['Type__c', 'Payment_Type__c']);
  const directionFields = incomingPaymentDirectionFields(paymentFields);
  const supplierInvoiceLookupFields = incomingPaymentSupplierInvoiceFields(paymentFields);
  const paymentSelectFields = ['Id', ...selectedFields(paymentFieldNames, ['Name', 'RecordTypeId', 'CreatedDate', 'LastModifiedDate', 'STEM__c', 'CurrencyIsoCode', 'Currency__c']), paymentFieldNames.has('RecordTypeId') ? 'RecordType.Name' : null, paymentFieldNames.has('RecordTypeId') ? 'RecordType.DeveloperName' : null, ...supplierInvoiceLookupFields, dateField, amountField, ...referenceFields, ...statusFields, ...typeFields, ...directionFields].filter(Boolean);

  const [lineItems, buyerBrokers, payments] = await Promise.all([
    queryRows(
      `
      SELECT Id, STEM__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
             Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
             Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
             Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c,
             Buyers_Brokers_Commission_Lumpsum__c, Commission_Cost__c
      FROM STEM_Line_Item__c
      WHERE STEM__c = '${escapeSoql(stemId)}'
      LIMIT 5000
    `,
      { limit: 5000, softFail: true },
    ),
    queryRows(
      `
      SELECT Id, STEM__c, Buyer_Broker__c
      FROM STEM_Buyer_Broker__c
      WHERE STEM__c = '${escapeSoql(stemId)}'
      LIMIT 5000
    `,
      { limit: 5000, softFail: true },
    ),
    queryRows(
      `
      SELECT ${[...new Set(paymentSelectFields)].join(', ')}
      FROM Payment__c
      WHERE STEM__c = '${escapeSoql(stemId)}'
      ORDER BY ${dateField} ASC NULLS LAST, CreatedDate ASC
      LIMIT 5000
    `,
      { limit: 5000, softFail: true },
    ),
  ]);

  const brokerAccountIds = [...new Set([...lineItems.map((item) => item.Supplier_Broker__c).filter(Boolean), ...lineItems.map((item) => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean), ...buyerBrokers.map((item) => item.Buyer_Broker__c).filter(Boolean)])];
  const brokerAccountMap = await namesByIds('Account', brokerAccountIds);
  for (const [id, name] of Object.entries(brokerAccountMap)) brokerAccountMap[String(id).slice(0, 15)] = name;
  const brokerGroups =
    buildBrokerCommissionGroups({
      stemMap: { [stem.Id]: stem },
      lineItems,
      buyerBrokers,
      accountMap: brokerAccountMap,
    })[stem.Id] || [];

  const buyerPayments = payments
    .filter((payment) => !incomingPaymentIsReceivableRemittance(payment, [...referenceFields, ...directionFields, ...typeFields, ...statusFields]))
    .map((payment) => {
      const amount = incomingPaymentNumber(payment[amountField]);
      const paymentDate = payment[dateField] || payment.CreatedDate || null;
      const brokerCommissionMatch = findBrokerCommissionPaymentMatch(payment, amount, brokerGroups, [...referenceFields, ...directionFields, ...typeFields, ...statusFields]);
      const type = brokerCommissionMatch
        ? 'Broker Commission'
        : incomingPaymentLooksBankCharge(payment, {
              referenceFields,
              directionFields,
              typeFields,
              statusFields,
            })
          ? 'Bank Charge'
          : incomingPaymentTypeFromContext(payment, {
              amount,
              stem,
              supplierInvoice: null,
              supplierInvoiceFields: supplierInvoiceLookupFields,
              directionFields,
              typeFields,
              statusFields,
            });
      return {
        id: payment.Id,
        name: incomingPaymentDisplayName({
          payment,
          referenceFields,
          stem,
          supplierInvoice: null,
          type,
        }),
        amount,
        paymentDate,
        dateOnly: dateOnly(paymentDate),
        type,
      };
    })
    .filter((payment) => payment.type === 'Buyer Payment' && payment.amount != null && payment.amount > 0 && payment.dateOnly)
    .sort((a, b) => String(a.dateOnly).localeCompare(String(b.dateOnly)) || String(a.id).localeCompare(String(b.id)));

  const rawDueDate = calculatedBuyerPayTermDate(stem) || stem.Invoice_Due_Date__c || stem.Due_Date__c || stem.Buyer_Pay_Term_Date__c || null;
  const dueDate = dateOnly(rawDueDate);
  if (!dueDate) throw appError('Buyer invoice due date is missing, so late payment interest cannot be calculated.', 400);

  const rawRate = interestField?.name ? stem['Account__r']?.[interestField.name] : null;
  const monthlyRate = parseIncomingPaymentInterestRate(rawRate) ?? 0.02;
  const rateWarning = rawRate == null || rawRate === '' ? 'Buyer account interest rate was not found; defaulted to 2.00% per month.' : null;
  const invoiceAmount = incomingPaymentNumber(stem.Total_Invoice_Amount__c) ?? incomingPaymentNumber(body.invoiceAmount) ?? buyerPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) + Math.max(0, Number(body.receivableBalance || 0));
  if (!invoiceAmount || invoiceAmount <= 0) throw appError('Buyer invoice amount is missing, so late payment interest cannot be calculated.', 400);

  const today = dateOnly(new Date());
  let balance = invoiceAmount;
  let lastDate = dueDate;
  const segments = [];
  const paymentSchedule = [];
  for (const payment of buyerPayments) {
    const paymentAmount = Math.min(Number(payment.amount || 0), Math.max(0, balance));
    if (payment.dateOnly <= dueDate) {
      balance = Math.max(0, balance - paymentAmount);
      paymentSchedule.push({
        ...payment,
        balanceAfter: balance,
        note: 'Paid on/before due date',
      });
      continue;
    }
    if (balance > 0 && payment.dateOnly > lastDate) {
      const days = Math.max(0, daysBetween(lastDate, payment.dateOnly));
      if (days > 0) {
        const interest = balance * monthlyRate * (days / 30);
        segments.push({
          fromDate: lastDate,
          toDate: payment.dateOnly,
          balance,
          days,
          rateDecimal: monthlyRate,
          interest,
          formula: interestFormulaText(balance, monthlyRate, days),
        });
      }
    }
    balance = Math.max(0, balance - paymentAmount);
    paymentSchedule.push({
      ...payment,
      balanceAfter: balance,
      note: paymentAmount < Number(payment.amount || 0) ? 'Payment exceeds remaining balance' : '',
    });
    lastDate = payment.dateOnly;
  }
  const currentReceivable = incomingPaymentNumber(stem.Receivable_Balance__c);
  if (currentReceivable != null && currentReceivable >= 0) balance = Math.min(balance, currentReceivable);
  if (balance > 0 && today > lastDate) {
    const days = Math.max(0, daysBetween(lastDate, today));
    if (days > 0) {
      const interest = balance * monthlyRate * (days / 30);
      segments.push({
        fromDate: lastDate,
        toDate: today,
        balance,
        days,
        rateDecimal: monthlyRate,
        interest,
        formula: interestFormulaText(balance, monthlyRate, days),
        note: 'Current unpaid balance to request date',
      });
    }
  }

  const totalInterest = segments.reduce((sum, segment) => sum + Number(segment.interest || 0), 0);
  return {
    stem,
    buyerName: incomingPaymentBuyerName(stem),
    buyerGroupName: incomingPaymentBuyerGroup(stem),
    stemName: formatStemName(stem),
    dueDate,
    invoiceAmount,
    receivableBalance: currentReceivable,
    interestRateField: interestField
      ? {
          name: interestField.name,
          label: interestField.label || interestField.name,
        }
      : null,
    rawInterestRate: rawRate,
    monthlyRate,
    rateWarning,
    paymentSchedule,
    segments,
    totalInterest,
  };
}

function incomingPaymentInterestCalculationHtml(calculation) {
  const segmentRows = (calculation.segments || [])
    .map(
      (segment) => `
    <tr>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;white-space:nowrap">${prettyDate(segment.fromDate)} to ${prettyDate(segment.toDate)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">${money(segment.balance)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">${segment.days}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px">${escapeHtml(segment.formula)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;font-weight:700;white-space:nowrap">${money(segment.interest)}</td>
    </tr>`,
    )
    .join('');
  const paymentRows = (calculation.paymentSchedule || [])
    .map(
      (payment) => `
    <tr>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;white-space:nowrap">${prettyDate(payment.paymentDate)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px">${escapeHtml(payment.name || payment.id || '-')}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">${money(payment.amount)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">${money(payment.balanceAfter)}</td>
    </tr>`,
    )
    .join('');
  return `
    <div style="margin-top:16px">
      <h3 style="margin:0 0 8px;font-size:15px">Late Payment Interest Calculation</h3>
      ${calculation.rateWarning ? `<p style="margin:0 0 8px;color:#92400e;font-weight:600">${escapeHtml(calculation.rateWarning)}</p>` : ''}
      <p style="margin:0 0 8px;color:#667085">Formula: Outstanding Balance x Monthly Interest Rate x Overdue Days / 30.</p>
      <table style="border-collapse:collapse;width:100%;max-width:860px;font-size:12px;margin-bottom:12px">
        <tbody>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px;width:210px">Buyer invoice amount</th><td style="padding:5px 8px;font-weight:700">${money(calculation.invoiceAmount)}</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Buyer invoice due date</th><td style="padding:5px 8px">${prettyDate(calculation.dueDate)}</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Account interest rate</th><td style="padding:5px 8px">${incomingPaymentInterestRateLabel(calculation.monthlyRate)}${calculation.interestRateField ? ` (${escapeHtml(calculation.interestRateField.label)})` : ''}</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Calculated interest total</th><td style="padding:5px 8px;font-size:15px;font-weight:800;color:#1f2937">${money(calculation.totalInterest)}</td></tr>
        </tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;max-width:960px;font-size:12px;margin-bottom:12px">
        <thead><tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px"><th style="text-align:left;padding:7px 8px">Period</th><th style="text-align:right;padding:7px 8px">Balance</th><th style="text-align:right;padding:7px 8px">Days</th><th style="text-align:left;padding:7px 8px">Formula</th><th style="text-align:right;padding:7px 8px">Interest</th></tr></thead>
        <tbody>${segmentRows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#667085">No overdue interest segment was calculated.</td></tr>'}</tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;max-width:860px;font-size:12px">
        <thead><tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px"><th style="text-align:left;padding:7px 8px">Payment Date</th><th style="text-align:left;padding:7px 8px">Payment</th><th style="text-align:right;padding:7px 8px">Amount</th><th style="text-align:right;padding:7px 8px">Balance After</th></tr></thead>
        <tbody>${paymentRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#667085">No buyer payments were found for this STEM.</td></tr>'}</tbody>
      </table>
    </div>`;
}

function incomingPaymentInterestCalculationText(calculation) {
  return ['Late Payment Interest Calculation', `Formula: Outstanding Balance x Monthly Interest Rate x Overdue Days / 30`, calculation.rateWarning || '', `Buyer invoice amount: ${money(calculation.invoiceAmount)}`, `Buyer invoice due date: ${prettyDate(calculation.dueDate)}`, `Account interest rate: ${incomingPaymentInterestRateLabel(calculation.monthlyRate)}${calculation.interestRateField ? ` (${calculation.interestRateField.label})` : ''}`, `Calculated interest total: ${money(calculation.totalInterest)}`, '', 'Interest segments:', ...(calculation.segments || []).map((segment) => `${prettyDate(segment.fromDate)} to ${prettyDate(segment.toDate)} | ${segment.formula} = ${money(segment.interest)}`), '', 'Buyer payment schedule:', ...(calculation.paymentSchedule || []).map((payment) => `${prettyDate(payment.paymentDate)} | ${payment.name || payment.id || '-'} | Payment ${money(payment.amount)} | Balance after ${money(payment.balanceAfter)}`)].filter((line) => line !== '').join('\n');
}

const INCOMING_PAYMENT_INTEREST_CALCULATION_TABLE_PATTERN = /\{\{\s*interestCalculationTable\s*\}\}/i;
const INCOMING_PAYMENT_INTEREST_STEM_LINK_TOKEN_PATTERN = /\{\{\s*stemLink\s*\}\}/i;
const DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE = {
  to: [],
  cc: [],
  bcc: [],
  subject: '',
  body: '',
};

function incomingPaymentInterestTemplate(input = {}) {
  return {
    to: String(input.to ?? DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.to),
    cc: String(input.cc ?? DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.cc),
    bcc: String(input.bcc ?? DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.bcc),
    subject: String(input.subject || DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.subject),
    body: String(input.body || input.intro || DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.body),
  };
}

function renderIncomingPaymentInterestTemplate(value, context) {
  return String(value || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(context, key) ? context[key] : match));
}

function replaceIncomingPaymentInterestToken(source, pattern, replacement) {
  return String(source || '')
    .replace(new RegExp(`<p\\b[^>]*>\\s*${pattern.source}\\s*<\\/p>`, 'i'), replacement)
    .replace(pattern, replacement);
}

function incomingPaymentInterestStemLinkHtml(url) {
  return `<p style="margin:0 0 14px"><a href="${escapeHtml(url)}" style="display:inline-block;border-radius:8px;background:#1f2937;color:#ffffff;text-decoration:none;font-weight:700;padding:9px 13px">Link to STEM</a></p>`;
}

function incomingPaymentInterestStemLinkText(url) {
  return `Link to STEM: ${url}`;
}

function buildIncomingPaymentInterestEmail(body, profile, calculation) {
  const requestedBy = profile?.full_name || profile?.email || 'Logged-in user';
  const paymentName = String(body.paymentName || body.paymentDisplayName || body.salesforcePaymentName || body.paymentId || '').trim();
  const stemName = calculation?.stemName || String(body.stemName || '').trim();
  const buyerName = calculation?.buyerName || String(body.buyerName || body.partyName || '').trim();
  const buyerGroupName = calculation?.buyerGroupName || String(body.buyerGroupName || '').trim();
  const receivedDate = prettyDate(body.paymentDate || body.receivedDate);
  const insertedDate = body.createdDate && dateOnly(body.createdDate) !== dateOnly(body.paymentDate || body.receivedDate) ? prettyDate(body.createdDate) : '';
  const delayLabel = body.delayDays == null ? '-' : `${Number(body.delayDays).toLocaleString()} Days`;
  const context = {
    requestedBy,
    requesterEmail: profile?.email || '',
    buyerName: buyerName || '-',
    buyerGroupName: buyerGroupName || '-',
    stemName: stemName || '-',
    paymentName: paymentName || body.paymentId || '-',
    receivedDate,
    insertedDate,
    delayDays: delayLabel,
    paymentAmount: money(body.amount),
    receivableBalance: money(calculation?.receivableBalance ?? body.receivableBalance),
    invoiceAmount: money(calculation?.invoiceAmount ?? body.invoiceAmount),
    invoiceDueDate: calculation?.dueDate ? prettyDate(calculation.dueDate) : '-',
    interestRate: incomingPaymentInterestRateLabel(calculation?.monthlyRate),
    interestRateField: calculation?.interestRateField?.label || calculation?.interestRateField?.name || '',
    interestTotal: money(calculation?.totalInterest),
  };
  const template = incomingPaymentInterestTemplate(body.reportSettings || {});
  const stemUrl = incomingPaymentStemUrl({}, calculation?.stem?.Id || body.stemId);
  const to = uniqueEmailList(renderIncomingPaymentInterestTemplate(template.to, context));
  const cc = uniqueEmailList(renderIncomingPaymentInterestTemplate(template.cc, context));
  const bcc = uniqueEmailList(renderIncomingPaymentInterestTemplate(template.bcc, context));
  const subject = renderIncomingPaymentInterestTemplate(template.subject, context);
  const bodyContent = renderIncomingPaymentInterestTemplate(template.body, context);
  const bodyText = hasHtmlMarkup(bodyContent) ? htmlToPlainText(bodyContent) : bodyContent;
  const calculationHtml = calculation ? incomingPaymentInterestCalculationHtml(calculation) : '';
  const calculationText = calculation ? incomingPaymentInterestCalculationText(calculation) : '';
  const htmlBody = replaceIncomingPaymentInterestToken(emailContentHtml(bodyContent), INCOMING_PAYMENT_INTEREST_STEM_LINK_TOKEN_PATTERN, incomingPaymentInterestStemLinkHtml(stemUrl))
    .replace(/<p\b[^>]*>\s*\{\{\s*interestCalculationTable\s*\}\}\s*<\/p>/i, calculationHtml)
    .replace(INCOMING_PAYMENT_INTEREST_CALCULATION_TABLE_PATTERN, calculationHtml);
  const textBody = replaceIncomingPaymentInterestToken(bodyText, INCOMING_PAYMENT_INTEREST_STEM_LINK_TOKEN_PATTERN, incomingPaymentInterestStemLinkText(stemUrl)).replace(INCOMING_PAYMENT_INTEREST_CALCULATION_TABLE_PATTERN, calculationText);
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">
      ${htmlBody}
    </div>`;
  return { to, cc, bcc, subject, html, text: textBody };
}

async function incomingPaymentInterestInvoiceRequest(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const paymentId = String(body.paymentId || body.payment_id || '').trim();
  if (!paymentId) throw appError('paymentId is required.', 400);

  const delayDays = Number(body.delayDays ?? body.delay_days);
  if (!Number.isFinite(delayDays) || delayDays <= 3) {
    throw appError('Late payment interest invoice request is only available for buyer payments delayed more than 3 days.', 400);
  }

  const existing = await fetchIncomingPaymentInterestNotification(client, paymentId);
  const forceResend = body.force === true || body.confirmResend === true || body.allowResend === true;
  if (existing && !forceResend) {
    const deliveryUncertain = ['sending', 'uncertain'].includes(existing.deliveryStatus);
    return {
      sent: false,
      alreadySent: existing.deliveryStatus === 'sent',
      deliveryUncertain,
      requiresConfirmation: true,
      notification: existing,
    };
  }

  const reportSettings = await loadFinancialReportSettings(client, 'incoming_payment_interest_requests', { required: true });
  if (!String(reportSettings.settings?.subject || '').trim() || !String(reportSettings.settings?.body || '').trim()) {
    throw appError('Late payment interest request subject and body are not configured. Sending is disabled.', 503, 'FINANCIAL_REPORT_TEMPLATE_NOT_CONFIGURED', undefined, true);
  }
  const calculation = await incomingPaymentInterestCalculation({ ...body, delayDays, paymentId }, accessContext);
  const email = buildIncomingPaymentInterestEmail({ ...body, delayDays, paymentId, reportSettings: reportSettings.settings }, profile, calculation);
  if (!operationalMailDeliveryAvailable()) {
    throw appError('The operational email sender is unavailable. Ask an administrator to check Settings > System Health.', 400);
  }
  const mailConfig = operationalMailConfig();
  const recipients = email.to;
  if (!recipients.length) {
    throw appError('Late payment interest request recipient is not configured. Add at least one To recipient in the template.', 400);
  }
  const senderSnapshot = existing?.senderMailboxSnapshot
    ? { id: existing.senderMailboxId || null, emailAddress: existing.senderMailboxSnapshot }
    : await resolveGraphEmailSender(client, 'incoming_payment_reports').then((sender) => ({
        id: sender.mailboxId,
        emailAddress: sender.emailAddress,
      }));
  const attemptAt = new Date().toISOString();
  const payload = {
    payment_id: paymentId,
    payment_name: String(body.paymentName || body.paymentDisplayName || body.salesforcePaymentName || '').trim() || null,
    stem_id: String(body.stemId || '').trim() || null,
    stem_name: calculation.stemName || String(body.stemName || '').trim() || null,
    buyer_name: calculation.buyerName || String(body.buyerName || body.partyName || '').trim() || null,
    buyer_group_name: calculation.buyerGroupName || String(body.buyerGroupName || '').trim() || null,
    received_date: incomingPaymentDbDate(body.paymentDate || body.receivedDate),
    payment_created_date: incomingPaymentDbDate(body.createdDate),
    delay_days: Math.trunc(delayDays),
    amount: incomingPaymentDbNumber(body.amount),
    currency: String(body.currency || 'USD').trim() || 'USD',
    receivable_balance: incomingPaymentDbNumber(calculation.receivableBalance ?? body.receivableBalance),
    recipient_email: uniqueEmailList(recipients, email.cc, email.bcc).join(', '),
    email_subject: email.subject,
    email_message_id: null,
    email_provider: mailConfig.deliveryMethod,
    actor_user_id: profile.id,
    actor_email: profile.email,
    actor_name: profile.full_name || profile.email || null,
    delivery_status: 'sending',
    sender_mailbox_id: senderSnapshot.id,
    sender_mailbox_snapshot: senderSnapshot.emailAddress,
    last_attempt_at: attemptAt,
    last_error: null,
    sent_at: null,
    updated_at: attemptAt,
    metadata: {
      source: 'incoming_payment',
      delayThresholdDays: 3,
      requestedAtTimezone: 'Asia/Hong_Kong',
      resent: Boolean(existing),
      resendCount: Number(existing?.metadata?.resendCount || 0) + (existing ? 1 : 0),
      previousRequest: existing
        ? {
            sentAt: existing.sentAt || null,
            actorEmail: existing.actorEmail || null,
            recipientEmail: existing.recipientEmail || null,
            emailSubject: existing.emailSubject || null,
          }
        : null,
      interestCalculation: {
        invoiceAmount: calculation.invoiceAmount,
        dueDate: calculation.dueDate,
        interestRateField: calculation.interestRateField,
        rawInterestRate: calculation.rawInterestRate,
        monthlyRate: calculation.monthlyRate,
        rateWarning: calculation.rateWarning,
        totalInterest: calculation.totalInterest,
        segments: calculation.segments,
        paymentSchedule: calculation.paymentSchedule,
      },
    },
  };

  const reserveQuery = existing ? client.from('incoming_payment_interest_notifications').update(payload).eq('payment_id', paymentId) : client.from('incoming_payment_interest_notifications').insert(payload);
  const { data: reserved, error: reserveError } = await reserveQuery.select(INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS).single();
  if (reserveError) throw reserveError;

  let result;
  try {
    result = await sendOperationalMail({
      to: recipients,
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }, { client, purposeKey: 'incoming_payment_reports', mailboxSnapshot: senderSnapshot });
  } catch (error) {
    await client
      .from('incoming_payment_interest_notifications')
      .update({
        delivery_status: error.mailDeliveryUncertain ? 'uncertain' : 'failed',
        last_error: error.message,
        updated_at: new Date().toISOString(),
      })
      .eq('payment_id', paymentId);
    throw error;
  }

  const sentAt = new Date().toISOString();
  const { data, error } = await client
    .from('incoming_payment_interest_notifications')
    .update({
      delivery_status: 'sent',
      email_message_id: result.id || result.messageId || null,
      email_provider: result.deliveryMethod || mailConfig.deliveryMethod,
      sent_at: sentAt,
      last_error: null,
      updated_at: sentAt,
    })
    .eq('payment_id', paymentId)
    .select(INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS)
    .single();
  if (error) {
    await client
      .from('incoming_payment_interest_notifications')
      .update({
        delivery_status: 'uncertain',
        last_error: `Email sent but tracking update failed: ${error.message}`,
        updated_at: new Date().toISOString(),
      })
      .eq('payment_id', paymentId);
    return {
      sent: true,
      trackingWarning: 'Email was sent, but FCOS could not finalize its delivery record. Do not resend until an administrator reconciles it.',
      to: recipients,
      notification: {
        ...serializeIncomingPaymentInterestNotification(reserved),
        deliveryStatus: 'uncertain',
      },
    };
  }
  return {
    sent: true,
    alreadySent: Boolean(existing),
    resent: Boolean(existing),
    to: recipients,
    notification: serializeIncomingPaymentInterestNotification(data),
  };
}

const INCOMING_PAYMENT_RECEIVABLE_TABLE_TOKEN_PATTERN = /\{\{\s*receivablePaymentsTable\s*\}\}/i;
const INCOMING_PAYMENT_BUYER_CIA_TABLE_TOKEN_PATTERN = /\{\{\s*buyerCiaInvoicesTable\s*\}\}/i;
const INCOMING_PAYMENT_LATE_INTEREST_LINK_TOKEN_PATTERNS = [/\{\{\s*requestLatePaymentInterestInvoiceLink\s*\}\}/i, /\{\{\s*latePaymentInterestLink\s*\}\}/i];
const DEFAULT_INCOMING_PAYMENT_EMAIL_SETTINGS = {
  to: [],
  cc: [],
  bcc: [],
  subject: '',
  intro: '',
  includeReceivablePayments: true,
  includeBuyerCiaInvoices: true,
};

function incomingPaymentEmailSettings(input = {}) {
  const safeInput = { ...input };
  delete safeInput.from;
  const defaults = DEFAULT_INCOMING_PAYMENT_EMAIL_SETTINGS;
  return {
    ...defaults,
    ...safeInput,
    to: parseEmailList(input.to, defaults.to),
    cc: parseEmailList(input.cc, defaults.cc),
    bcc: parseEmailList(input.bcc, defaults.bcc),
    subject: String(input.subject ?? defaults.subject),
    intro: String(input.intro ?? defaults.intro),
    includeReceivablePayments: input.includeReceivablePayments ?? defaults.includeReceivablePayments,
    includeBuyerCiaInvoices: input.includeBuyerCiaInvoices ?? defaults.includeBuyerCiaInvoices,
  };
}

function incomingPaymentSearchMatches(row, search, fields) {
  const query = String(search || '')
    .trim()
    .toLowerCase();
  if (!query) return true;
  return fields.some((field) =>
    String(row?.[field] || '')
      .toLowerCase()
      .includes(query),
  );
}

function renderIncomingPaymentTemplate(value, context = {}) {
  let output = String(value || '');
  for (const [key, replacement] of Object.entries(context)) {
    output = output.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), String(replacement ?? ''));
  }
  return output;
}

function incomingPaymentReportSummary(rows = []) {
  const incomingRows = rows.filter((row) => row.isIncoming);
  return {
    incomingRows: incomingRows.length,
    totalIncomingAmount: incomingRows.reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
    buyerPaymentTotal: rows.filter((row) => row.type === 'Buyer Payment').reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
    supplierRefundTotal: rows.filter((row) => row.type === 'Supplier Refund').reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
    unmatchedCount: rows.filter((row) => row.type === 'Unmatched' || row.status === 'Needs review').length,
  };
}

function incomingPaymentInsertedNote(row) {
  if (!row?.paymentDate || !row?.createdDate) return '';
  if (dateOnly(row.paymentDate) === dateOnly(row.createdDate)) return '';
  return `Inserted on ${prettyDate(row.createdDate)}`;
}

function incomingPaymentTermsValue(row) {
  return row?.type === 'Buyer Payment' ? row.paymentTerms || '-' : 'N/A';
}

function incomingPaymentDelayValue(row) {
  if (row?.type !== 'Buyer Payment') return 'N/A';
  return row.delayDays == null ? '-' : Number(row.delayDays).toLocaleString();
}

function incomingPaymentAmountText(row) {
  const bankCharges = (row?.bankCharges || []).map((charge) => `Bank Charge ${money(charge.amount)}`);
  return [money(row?.amount), ...bankCharges].join(' / ');
}

function incomingPaymentReceivableTableHtml(rows = []) {
  const tableRows = rows
    .map((row) => {
      const cell = 'border-bottom:1px solid #e5e7eb;padding:7px 8px;vertical-align:top';
      const amountLines = [escapeHtml(money(row.amount)), ...(row.bankCharges || []).map((charge) => `<span style="display:block;color:#92400e;font-weight:600">Bank Charge ${escapeHtml(money(charge.amount))}</span>`)].join('');
      return `
      <tr>
        <td style="${cell};white-space:nowrap">${prettyDate(row.paymentDate)}${incomingPaymentInsertedNote(row) ? `<span style="display:block;color:#92400e;font-size:11px;font-weight:600">Inserted on ${prettyDate(row.createdDate)}</span>` : ''}</td>
        <td style="${cell};white-space:nowrap;text-align:right">${escapeHtml(incomingPaymentTermsValue(row))}</td>
        <td style="${cell};white-space:nowrap;text-align:right">${escapeHtml(incomingPaymentDelayValue(row))}</td>
        <td style="${cell};min-width:160px">${escapeHtml(row.partyName || '-')}</td>
        <td style="${cell};min-width:140px">${escapeHtml(row.buyerGroupName || '-')}</td>
        <td style="${cell};min-width:180px;font-weight:600">${escapeHtml(row.stemName || '-')}</td>
        <td style="${cell};white-space:nowrap;text-align:right;font-weight:600">${amountLines}</td>
        <td style="${cell};white-space:nowrap;text-align:right">${money(row.receivableBalance)}</td>
      </tr>`;
    })
    .join('');
  return `
    <div style="margin:14px 0 18px">
      <div style="font-size:13px;font-weight:700;margin:0 0 8px;color:#1f2937">Receivable Payments (${rows.length.toLocaleString()})</div>
      <div style="overflow-x:auto;border:1px solid #d9e2ef;border-radius:10px">
        <table style="border-collapse:collapse;width:auto;min-width:1040px;font-size:12px;line-height:1.3">
          <thead>
            <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Received Date</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Terms</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Delay</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">From</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Group</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">STEM</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Amount</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Receivable</th>
            </tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="8" style="padding:16px;text-align:center;color:#667085">No receivable payments found for the selected filters.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function incomingPaymentBuyerCiaTableHtml(rows = []) {
  const tableRows = rows
    .map((row) => {
      const cell = 'border-bottom:1px solid #e5e7eb;padding:7px 8px;vertical-align:top';
      return `
      <tr>
        <td style="${cell};min-width:180px;font-weight:600">${escapeHtml(row.buyerName || '-')}</td>
        <td style="${cell};min-width:140px">${escapeHtml(row.buyerGroupName || '-')}</td>
        <td style="${cell};min-width:130px">${escapeHtml(row.buyerTrader || '-')}</td>
        <td style="${cell};min-width:180px;font-weight:600">${escapeHtml(row.stemName || '-')}</td>
        <td style="${cell};white-space:nowrap;text-align:right">${money(row.calculatedAmount)}</td>
        <td style="${cell};white-space:nowrap;text-align:right;font-weight:600">${money(row.receivableBalance)}</td>
        <td style="${cell};white-space:nowrap">${prettyDate(row.deliveryDate)}</td>
      </tr>`;
    })
    .join('');
  return `
    <div style="margin:14px 0 18px">
      <div style="font-size:13px;font-weight:700;margin:0 0 8px;color:#1f2937">Buyer CIA Invoices (${rows.length.toLocaleString()})</div>
      <div style="overflow-x:auto;border:1px solid #d9e2ef;border-radius:10px">
        <table style="border-collapse:collapse;width:auto;min-width:900px;font-size:12px;line-height:1.3">
          <thead>
            <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Buyer</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Group</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Buyer Trader</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">STEM</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Calculated Amount</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Receivable Balance</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Delivery Date</th>
            </tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="7" style="padding:16px;text-align:center;color:#667085">No Buyer CIA invoices found for the selected filters.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function incomingPaymentReceivableTableText(rows = []) {
  if (!rows.length) return 'Receivable Payments: none';
  return [`Receivable Payments (${rows.length})`, 'Received Date | Terms | Delay | From | Group | STEM | Amount | Receivable', ...rows.map((row) => `${prettyDate(row.paymentDate)}${incomingPaymentInsertedNote(row) ? ` (${incomingPaymentInsertedNote(row)})` : ''} | ${incomingPaymentTermsValue(row)} | ${incomingPaymentDelayValue(row)} | ${row.partyName || '-'} | ${row.buyerGroupName || '-'} | ${row.stemName || '-'} | ${incomingPaymentAmountText(row)} | ${money(row.receivableBalance)}`)].join('\n');
}

function incomingPaymentBuyerCiaTableText(rows = []) {
  if (!rows.length) return 'Buyer CIA Invoices: none';
  return [`Buyer CIA Invoices (${rows.length})`, ...rows.map((row) => `${row.buyerName || '-'} | ${row.buyerGroupName || '-'} | ${row.buyerTrader || '-'} | ${row.stemName || '-'} | Calculated ${money(row.calculatedAmount)} | Receivable ${money(row.receivableBalance)} | Delivery ${prettyDate(row.deliveryDate)}`)].join('\n');
}

function replaceIncomingPaymentToken(source, pattern, replacement) {
  return String(source || '')
    .replace(new RegExp(`<p\\b[^>]*>\\s*${pattern.source}\\s*<\\/p>`, 'i'), replacement)
    .replace(pattern, replacement);
}

function injectIncomingPaymentTables(content, settings, receivableTable, buyerCiaTable) {
  let output = String(content || '');
  const hasReceivableToken = INCOMING_PAYMENT_RECEIVABLE_TABLE_TOKEN_PATTERN.test(output);
  const hasBuyerCiaToken = INCOMING_PAYMENT_BUYER_CIA_TABLE_TOKEN_PATTERN.test(output);
  output = replaceIncomingPaymentToken(output, INCOMING_PAYMENT_RECEIVABLE_TABLE_TOKEN_PATTERN, settings.includeReceivablePayments ? receivableTable : '');
  output = replaceIncomingPaymentToken(output, INCOMING_PAYMENT_BUYER_CIA_TABLE_TOKEN_PATTERN, settings.includeBuyerCiaInvoices ? buyerCiaTable : '');
  if (settings.includeReceivablePayments && !hasReceivableToken) output += receivableTable;
  if (settings.includeBuyerCiaInvoices && !hasBuyerCiaToken) output += buyerCiaTable;
  return output;
}

function injectIncomingPaymentLateInterestLink(content, replacement) {
  let output = String(content || '');
  for (const pattern of INCOMING_PAYMENT_LATE_INTEREST_LINK_TOKEN_PATTERNS) {
    output = replaceIncomingPaymentToken(output, pattern, replacement);
  }
  return output;
}

function incomingPaymentLateInterestLinkHtml(url) {
  return `<p style="margin:0 0 14px"><a href="${escapeHtml(url)}" style="display:inline-block;border-radius:8px;background:#FF2800;color:#ffffff;text-decoration:none;font-weight:700;padding:9px 13px">Late Payment Interest Invoice</a></p>`;
}

function incomingPaymentLateInterestLinkText(url) {
  return `Late Payment Interest Invoice: ${url}`;
}

function buildIncomingPaymentEmail(report, settings) {
  const summary = report.summary || incomingPaymentReportSummary(report.rows || []);
  const lateInterestUrl = incomingPaymentFilterUrl(settings, report);
  const incomingRows = Number(summary.incomingRows || 0);
  const needsReviewCount = Number(summary.unmatchedCount || 0);
  const context = {
    dateFrom: prettyDate(report.dateFrom),
    dateTo: prettyDate(report.dateTo),
    today: prettyDate(dateOnly(new Date())),
    paymentCount: (report.rows || []).length.toLocaleString(),
    receivablePaymentCount: (report.rows || []).length.toLocaleString(),
    buyerCiaCount: (report.buyerCiaInvoices || []).length.toLocaleString(),
    incomingTotal: money(summary.totalIncomingAmount),
    buyerPaymentTotal: money(summary.buyerPaymentTotal),
    supplierRefundTotal: money(summary.supplierRefundTotal),
    needsReviewCount: String(needsReviewCount),
    keyword: report.search || '',
  };
  const subject = renderIncomingPaymentTemplate(settings.subject, context);
  const content = renderIncomingPaymentTemplate(settings.intro, context);
  const contentText = hasHtmlMarkup(content) ? htmlToPlainText(content) : content;
  const summaryHtml = `
    <table role="presentation" style="border-collapse:collapse;margin:18px 0;width:100%;max-width:720px">
      <tr>
        <td style="border:1px solid #d9e2ef;border-radius:8px 0 0 8px;padding:12px;background:#f6fef9">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">Incoming Total</div>
          <div style="font-size:20px;font-weight:700;color:#059669">${money(summary.totalIncomingAmount)}</div>
          <div style="margin-top:4px;font-size:12px;color:#667085">Buyer Payments ${money(summary.buyerPaymentTotal)} · Supplier Refunds ${money(summary.supplierRefundTotal)} · ${incomingRows.toLocaleString()} records</div>
        </td>
        <td style="border:1px solid #d9e2ef;border-left:0;border-radius:0 8px 8px 0;padding:12px;background:#fffbeb">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">Needs Review</div>
          <div style="font-size:20px;font-weight:700;color:#d97706">${needsReviewCount.toLocaleString()}</div>
          <div style="margin-top:4px;font-size:12px;color:#667085">Unmatched or incomplete payments</div>
        </td>
      </tr>
    </table>`;
  const contentHtml = injectIncomingPaymentLateInterestLink(emailContentHtml(content), incomingPaymentLateInterestLinkHtml(lateInterestUrl));
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">
      ${summaryHtml}
      ${injectIncomingPaymentTables(contentHtml, settings, incomingPaymentReceivableTableHtml(report.rows || []), incomingPaymentBuyerCiaTableHtml(report.buyerCiaInvoices || []))}
    </div>`;
  const textContent = injectIncomingPaymentTables([`Incoming Total: ${money(summary.totalIncomingAmount)}`, `Buyer Payments: ${money(summary.buyerPaymentTotal)}`, `Supplier Refunds: ${money(summary.supplierRefundTotal)}`, `Incoming Records: ${incomingRows.toLocaleString()}`, `Needs Review: ${needsReviewCount.toLocaleString()}`, '', injectIncomingPaymentLateInterestLink(contentText, incomingPaymentLateInterestLinkText(lateInterestUrl))].join('\n'), settings, `\n\n${incomingPaymentReceivableTableText(report.rows || [])}\n\n`, `\n\n${incomingPaymentBuyerCiaTableText(report.buyerCiaInvoices || [])}\n\n`);
  return { subject, html, text: textContent, summary };
}

async function incomingPaymentEmailReport(body = {}, req = null, accessContext = null) {
  const activeAccess = accessContext || (await requireActiveUser(req));
  const stored = await loadFinancialReportSettings(activeAccess.client, 'incoming_payment_reports', { required: !body.preview && !body.dryRun });
  if (!body.preview && !body.dryRun) {
    const expectedSettingsRevision = Number(body.expectedSettingsRevision ?? body.expected_settings_revision);
    if (!Number.isInteger(expectedSettingsRevision) || expectedSettingsRevision < 1) {
      throw appError('Refresh the Incoming Payment report review before sending.', 409, 'FINANCIAL_REPORT_REVISION_REQUIRED');
    }
    if (expectedSettingsRevision !== Number(stored.revision || 0)) {
      throw appError('The approved Incoming Payment report recipients or template changed after review. Reopen the report before sending.', 409, 'FINANCIAL_REPORT_REVISION_CONFLICT');
    }
  }
  const settings = incomingPaymentEmailSettings(stored.settings);
  if (!body.preview && !body.dryRun && (!settings.subject.trim() || !settings.intro.trim())) {
    throw appError('Incoming Payment report subject and body are not configured. Sending is disabled.', 503, 'FINANCIAL_REPORT_TEMPLATE_NOT_CONFIGURED', undefined, true);
  }
  const source = await incomingPaymentsList(
    {
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      limit: body.limit || 5000,
    },
    null,
    activeAccess,
  );
  const search = String(body.search || '').trim();
  const rows = (source.rows || []).filter((row) => incomingPaymentSearchMatches(row, search, ['partyName', 'stemName', 'keyStem', 'buyerName', 'buyerGroupName', 'supplierName', 'supplierInvoiceName']));
  const buyerCiaInvoices = (source.buyerCiaInvoices || []).filter((row) => incomingPaymentSearchMatches(row, search, ['buyerName', 'buyerGroupName', 'buyerTrader', 'stemName', 'keyStem']));
  const report = {
    ...source,
    rows,
    buyerCiaInvoices,
    search,
    summary: incomingPaymentReportSummary(rows),
  };
  const email = buildIncomingPaymentEmail(report, settings);
  const reportMeta = {
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
    search,
    receivableRows: rows.length,
    buyerCiaRows: buyerCiaInvoices.length,
    summary: email.summary,
  };
  if (body.preview || body.dryRun) {
    return {
      sent: false,
      preview: true,
      settings,
      settingsRevision: Number(stored.revision || 0),
      report: reportMeta,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        summary: email.summary,
      },
    };
  }
  if (!settings.to.length) throw appError('At least one To recipient is required before sending the Incoming Payment report.', 400);
  const result = await sendOperationalMail({
    to: settings.to,
    cc: settings.cc,
    bcc: settings.bcc,
    subject: email.subject,
    html: email.html,
    text: email.text,
  }, { client: activeAccess.client, purposeKey: 'incoming_payment_reports' });
  return {
    sent: true,
    id: result.id,
    to: settings.to,
    cc: settings.cc,
    bcc: settings.bcc,
    subject: email.subject,
    report: reportMeta,
    rows: rows.length,
    buyerCiaRows: buyerCiaInvoices.length,
    email: {
      subject: email.subject,
      html: email.html,
      text: email.text,
      summary: email.summary,
    },
  };
}

async function incomingPaymentEmailSettingsGet(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const stored = await loadFinancialReportSettings(client, 'incoming_payment_reports');
  return {
    ...stored,
    settings: incomingPaymentEmailSettings(stored.settings),
    capabilities: {
      canManageSettings: await userHasCapability(client, profile, 'financial_report_settings_manage'),
    },
  };
}

async function incomingPaymentEmailSettingsSave(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'financial_report_settings_manage', 'Financial report settings management permission is required.');
  const current = await loadFinancialReportSettings(client, 'incoming_payment_reports');
  const settings = incomingPaymentEmailSettings({ ...current.settings, ...(body.settings || body) });
  return saveFinancialReportSettings(client, 'incoming_payment_reports', {
    settings,
    expectedRevision: body.expectedRevision ?? body.expected_revision,
  }, profile);
}

function financialReportSettingsEditor(settings = {}) {
  return {
    ...settings,
    to: parseEmailList(settings.to, []).join(', '),
    cc: parseEmailList(settings.cc, []).join(', '),
    bcc: parseEmailList(settings.bcc, []).join(', '),
  };
}

async function incomingPaymentInterestSettingsGet(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const stored = await loadFinancialReportSettings(client, 'incoming_payment_interest_requests');
  return {
    ...stored,
    settings: financialReportSettingsEditor(stored.settings),
    capabilities: {
      canManageSettings: await userHasCapability(client, profile, 'financial_report_settings_manage'),
    },
  };
}

async function incomingPaymentInterestSettingsSave(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'financial_report_settings_manage', 'Financial report settings management permission is required.');
  const current = await loadFinancialReportSettings(client, 'incoming_payment_interest_requests');
  const candidate = incomingPaymentInterestTemplate({ ...current.settings, ...(body.settings || body) });
  return saveFinancialReportSettings(client, 'incoming_payment_interest_requests', {
    settings: candidate,
    expectedRevision: body.expectedRevision ?? body.expected_revision,
  }, profile);
}

function buyerInvoiceEmailSettings(input = {}) {
  const hasBuyerTraderFilter = Object.prototype.hasOwnProperty.call(input, 'buyerTraders');
  return {
    ...normalizeBuyerInvoiceEmailSettings(input, {
      ...DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS,
    }),
    hasBuyerTraderFilter,
  };
}

function serializeBuyerInvoiceEmailSettingsRow(reportSettings, legacyMeta = null) {
  const settings = normalizeBuyerInvoiceEmailSettings(reportSettings?.settings || {});
  return {
    settings,
    meta: {
      storageAvailable: true,
      configured: reportSettings?.configured === true,
      revision: Number(reportSettings?.revision || 0),
      lastPreviewAt: legacyMeta?.last_preview_at || null,
      lastPreviewRowCount: legacyMeta?.last_preview_row_count ?? null,
      lastSentAt: legacyMeta?.last_sent_at || null,
      lastSentRowCount: legacyMeta?.last_sent_row_count ?? null,
      lastError: legacyMeta?.last_error || null,
      updatedByEmail: reportSettings?.updatedByEmail || null,
      updatedAt: reportSettings?.updatedAt || null,
      nextScheduledRun: nextBuyerInvoiceScheduleRun(settings),
    },
  };
}

async function loadStoredBuyerInvoiceEmailSettings() {
  const client = safeSupabaseAdminClient();
  if (!client) throw appError('Financial report settings are unavailable. Sending is disabled until storage is restored.', 503, 'FINANCIAL_REPORT_SETTINGS_UNAVAILABLE', undefined, true);
  const [reportSettings, legacy] = await Promise.all([
    loadFinancialReportSettings(client, 'outstanding_invoice_reports'),
    client.from('buyer_invoice_email_settings').select('last_preview_at,last_preview_row_count,last_sent_at,last_sent_row_count,last_error').eq('id', 'default').maybeSingle(),
  ]);
  if (legacy.error) throw appError('Buyer invoice report history is unavailable. Sending is disabled until storage is restored.', 503, 'FINANCIAL_REPORT_SETTINGS_UNAVAILABLE', undefined, true);
  return serializeBuyerInvoiceEmailSettingsRow(reportSettings, legacy.data);
}

async function saveStoredBuyerInvoiceEmailSettings(settings, profile = null, expectedRevision = null) {
  const client = supabaseAdminClient();
  const current = await loadFinancialReportSettings(client, 'outstanding_invoice_reports');
  const inputPatch = buyerInvoiceEmailSettingsPatch(settings);
  const normalized = normalizeBuyerInvoiceEmailSettings({ ...current.settings, ...inputPatch });
  const settingsPatch = Object.fromEntries(Object.keys(inputPatch).map((key) => [key, normalized[key]]));
  if (!Object.keys(settingsPatch).length) {
    throw appError('No recognized buyer invoice email settings were supplied.', 400);
  }
  const saved = await saveFinancialReportSettings(client, 'outstanding_invoice_reports', {
    settings: { ...current.settings, ...settingsPatch },
    expectedRevision,
  }, profile);
  return serializeBuyerInvoiceEmailSettingsRow(saved);
}

async function updateBuyerInvoiceEmailSettingsMeta(patch = {}) {
  const client = safeSupabaseAdminClient();
  if (!client) return;
  const { error } = await client.from('buyer_invoice_email_settings').upsert({ id: 'default', ...patch }, { onConflict: 'id' });
  if (error) console.error('Failed to update buyer invoice email settings metadata', error.message);
}

async function buyerInvoiceEmailSettingsGet(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  return {
    ...(await loadStoredBuyerInvoiceEmailSettings()),
    capabilities: {
      canManageSettings: await userHasCapability(client, profile, 'financial_report_settings_manage'),
    },
  };
}

async function buyerInvoiceEmailSettingsSave(body, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'financial_report_settings_manage', 'Financial report settings management permission is required.');
  return saveStoredBuyerInvoiceEmailSettings(body.settings || body, profile, body.expectedRevision ?? body.expected_revision);
}

function hongKongScheduleParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    weekday: value('weekday'),
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
    minuteOfDay: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function scheduleMinuteOfDay(time) {
  const match = String(time || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function buyerInvoiceScheduledWindow(settings, date = new Date()) {
  const now = hongKongScheduleParts(date);
  const weekdays = new Set((settings.weekdays || []).map((day) => String(day).slice(0, 3).toLowerCase()));
  if (!weekdays.has(String(now.weekday).slice(0, 3).toLowerCase())) return null;
  for (const time of settings.sendTimes || []) {
    const scheduleMinute = scheduleMinuteOfDay(time);
    if (scheduleMinute == null) continue;
    const diff = now.minuteOfDay - scheduleMinute;
    if (diff >= 0 && diff < 5) {
      const scheduleTime = String(time).trim().padStart(5, '0');
      return {
        date: now.date,
        time: scheduleTime,
        runKey: `buyer-invoices:${now.date}:${scheduleTime}`,
      };
    }
  }
  return null;
}

function isBuyerInvoiceReportDue(settings, date = new Date()) {
  return Boolean(buyerInvoiceScheduledWindow(settings, date));
}

function nextBuyerInvoiceScheduleRun(settings, fromDate = new Date()) {
  const weekdays = new Set((settings.weekdays || []).map((day) => String(day).slice(0, 3).toLowerCase()));
  const sendTimes = (settings.sendTimes || [])
    .map((time) => String(time).trim().padStart(5, '0'))
    .filter((time) => scheduleMinuteOfDay(time) != null)
    .sort();
  if (!weekdays.size || !sendTimes.length) return null;

  const now = hongKongScheduleParts(fromDate);
  for (let offset = 0; offset < 14; offset += 1) {
    const probe = hongKongScheduleParts(new Date(fromDate.getTime() + offset * 86400000));
    if (!weekdays.has(String(probe.weekday).slice(0, 3).toLowerCase())) continue;
    for (const time of sendTimes) {
      if (offset === 0 && scheduleMinuteOfDay(time) <= now.minuteOfDay) continue;
      return `${probe.date} ${time} HKT`;
    }
  }
  return null;
}

function overdueSeverity(daysUntilDue) {
  if (daysUntilDue == null || Number(daysUntilDue) > 0) return null;
  const overdueDays = Math.abs(Number(daysUntilDue));
  if (overdueDays >= 14) return 'red';
  if (overdueDays >= 7) return 'orange';
  return 'yellow';
}

function overdueDisplayValue(daysUntilDue) {
  if (daysUntilDue == null) return '-';
  const overdue = -Number(daysUntilDue);
  const value = Object.is(overdue, -0) ? 0 : overdue;
  return value.toLocaleString();
}

function overdueEmailStyles(daysUntilDue, prpspStatus) {
  const severity = overdueSeverity(daysUntilDue);
  const styles = {
    red: {
      row: 'background:#fee2e2',
      border: '#fca5a5',
      text: '#991b1b',
      pill: 'background:#fecaca;border-color:#f87171;color:#7f1d1d',
    },
    orange: {
      row: 'background:#fed7aa',
      border: '#fb923c',
      text: '#9a3412',
      pill: 'background:#fdba74;border-color:#f97316;color:#7c2d12',
    },
    yellow: {
      row: 'background:#fde68a',
      border: '#facc15',
      text: '#854d0e',
      pill: 'background:#fcd34d;border-color:#eab308;color:#713f12',
    },
  };
  const base = styles[severity] || {
    row: '',
    border: '#e5e7eb',
    text: '#2563eb',
    pill: 'background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8',
  };
  return prpspStatus === 'Conditional-Not Sent' ? { ...base, row: 'background:#e9d5ff', border: '#c084fc' } : base;
}

function renderBuyerInvoiceEmailContent(template, report, settings) {
  return String(template || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.intro)
    .replaceAll('{{reportStart}}', prettyDate(report.today))
    .replaceAll('{{reportEnd}}', prettyDate(report.dueThrough))
    .replaceAll('{{daysAhead}}', String(settings.daysAhead ?? report.daysAhead ?? DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead));
}

function emailContentHtml(content) {
  if (hasHtmlMarkup(content)) return sanitizeReminderHtml(content);
  const blocks = String(content || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!blocks.length) return '';
  return blocks
    .map((block, index) => {
      const html = escapeHtml(block).replaceAll('\n', '<br>');
      if (index === 0) return `<h2 style="margin:0 0 6px;font-size:20px">${html}</h2>`;
      return `<p style="margin:0 0 14px;color:#667085">${html}</p>`;
    })
    .join('');
}

function buyerTraderFilterHtml(report, settings) {
  const options = report.buyerTraderOptions || [];
  if (!options.length) return '';
  const selected = new Set(report.hasBuyerTraderFilter ? report.selectedBuyerTraders || [] : options);
  const allActive = selected.size === options.length;
  const allUrl = buyerInvoiceFilterUrl(settings, report, null);
  const allChip = `<a href="${escapeHtml(allUrl)}" style="display:inline-block;text-decoration:none;border:1px solid ${allActive ? '#2563eb' : '#d9e2ef'};border-radius:6px;padding:4px 10px;margin:0 6px 6px 0;font-size:12px;font-weight:600;${allActive ? 'background:#2563eb;color:#fff' : 'background:#f8fafc;color:#2563eb'}">All</a>`;
  const chips = options
    .map((name) => {
      const active = selected.has(name);
      const url = buyerInvoiceFilterUrl(settings, report, name);
      return `<a href="${escapeHtml(url)}" style="display:inline-block;text-decoration:none;border:1px solid ${active ? '#2563eb' : '#d9e2ef'};border-radius:6px;padding:4px 10px;margin:0 6px 6px 0;font-size:12px;font-weight:600;${active ? 'background:#2563eb;color:#fff' : 'background:#f8fafc;color:#2563eb'}">${escapeHtml(name)}</a>`;
    })
    .join('');
  return `
    <div style="margin:0 0 12px">
      <div style="font-size:11px;color:#667085;text-transform:uppercase;letter-spacing:.04em;font-weight:700;margin-bottom:6px">Open filtered view by Buyer Trader / Payment Handler</div>
      <div>${allChip}${chips}</div>
    </div>`;
}

function buildBuyerInvoiceReportEmail(report, settings) {
  const rows = report.rows || [];
  const overdue = rows.filter((row) => row.status === 'Overdue');
  const dueSoon = rows.filter((row) => row.status !== 'Overdue');
  const dueSoonLabel = `Due in ${Number(settings.daysAhead || report.daysAhead || 7).toLocaleString()} Days`;
  const content = renderBuyerInvoiceEmailContent(settings.intro, report, settings);
  const totals = {
    overdueCount: overdue.length,
    overdueReceivable: overdue.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
    dueSoonCount: dueSoon.length,
    dueSoonReceivable: dueSoon.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
  };
  const subject = `${settings.subject} - ${prettyDate(report.today)}`;
  const summaryHtml = settings.includeSummary
    ? `
    <table role="presentation" style="border-collapse:collapse;margin:18px 0;width:100%;max-width:620px">
      <tr>
        <td style="border:1px solid #d9e2ef;border-radius:8px 0 0 8px;padding:12px;background:#fff7f7">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">Overdue</div>
          <div style="font-size:20px;font-weight:700;color:#dc2626">${money(totals.overdueReceivable)} (${totals.overdueCount})</div>
        </td>
        <td style="border:1px solid #d9e2ef;border-left:0;border-radius:0 8px 8px 0;padding:12px;background:#f7fbff">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(dueSoonLabel)}</div>
          <div style="font-size:20px;font-weight:700;color:#2563eb">${money(totals.dueSoonReceivable)} (${totals.dueSoonCount})</div>
        </td>
      </tr>
    </table>`
    : '';
  const tableRows = rows
    .map((row) => {
      const severity = overdueEmailStyles(row.daysUntilDue, row.prpspStatus);
      const cellStyle = `border-bottom:1px solid ${severity.border};padding:8px 10px`;
      return `
    <tr style="${severity.row}">
      <td style="${cellStyle};font-weight:600;white-space:nowrap">${escapeHtml(row.stemName)}</td>
      <td style="${cellStyle};min-width:180px">${escapeHtml(row.buyerName || '-')}</td>
      <td style="${cellStyle};min-width:150px">${escapeHtml(row.buyerBrokerNames || '-')}</td>
      <td style="${cellStyle};text-align:right;white-space:nowrap">${money(row.invoiceAmount)}</td>
      <td style="${cellStyle};text-align:right;font-weight:600;white-space:nowrap">${money(row.receivableBalance)}</td>
      <td style="${cellStyle};white-space:nowrap">${prettyDate(row.buyerInvoiceDueDate)}</td>
      <td style="${cellStyle};min-width:140px">${escapeHtml(row.buyerTraderInCharge || '-')}</td>
      <td style="${cellStyle};min-width:160px">${escapeHtml(row.paymentHandlerName || row.collection?.ownerName || '-')}</td>
      <td style="${cellStyle};min-width:160px">${escapeHtml(row.prpspStatus || '-')}</td>
      <td style="${cellStyle}">
        <span style="display:inline-block;border:1px solid;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap;${severity.pill}">${escapeHtml(row.status)}</span>
      </td>
      <td style="${cellStyle};text-align:right;font-weight:600;color:${severity.text};white-space:nowrap">${overdueDisplayValue(row.daysUntilDue)}</td>
    </tr>`;
    })
    .join('');
  const tableHtml = settings.includeTable
    ? `
    ${buyerTraderFilterHtml(report, settings)}
    <div style="max-height:420px;overflow:auto;border:1px solid #d9e2ef;border-radius:10px">
      <table style="border-collapse:collapse;width:100%;min-width:1260px;font-size:13px">
        <thead>
          <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Stem</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Buyer</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Buyer Broker</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:right;position:sticky;top:0;background:#f8fafc">Invoice Amount</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:right;position:sticky;top:0;background:#f8fafc">Receivable Balance</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Due Date</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Buyer Trader</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Payment Collection Handler</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">PSPRS</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Status</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:right;position:sticky;top:0;background:#f8fafc">Overdue</th>
          </tr>
        </thead>
        <tbody>${tableRows || '<tr><td colspan="11" style="padding:18px;text-align:center;color:#667085">No outstanding buyer invoices found.</td></tr>'}</tbody>
      </table>
    </div>`
    : '';
  const contentHtml = emailContentHtml(content);
  const hasAttentionMarker = /for your attention\./i.test(contentHtml);
  const contentText = hasHtmlMarkup(content) ? htmlToPlainText(content) : content;
  const reportBodyHtml = hasAttentionMarker && tableHtml ? `${insertAfterAttentionSentence(contentHtml, tableHtml)}${summaryHtml}` : `${contentHtml}${summaryHtml}${tableHtml}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">
      ${reportBodyHtml}
    </div>`;
  const tableText = rows.map((row) => `${row.stemName} | ${row.buyerName || '-'} | Buyer Broker ${row.buyerBrokerNames || '-'} | Receivable Balance ${money(row.receivableBalance)} | Due ${prettyDate(row.buyerInvoiceDueDate)} | Buyer Trader ${row.buyerTraderInCharge || '-'} | Payment Collection Handler ${row.paymentHandlerName || row.collection?.ownerName || '-'} | PSPRS ${row.prpspStatus || '-'} | ${row.status} | Overdue ${overdueDisplayValue(row.daysUntilDue)}`).join('\n');
  const introText = hasAttentionMarker && tableText ? insertAfterAttentionSentence(contentText, `\n\n${tableText}\n\n`) : contentText;
  const textLines = [introText, `Overdue: ${money(totals.overdueReceivable)} (${totals.overdueCount})`, `${dueSoonLabel}: ${money(totals.dueSoonReceivable)} (${totals.dueSoonCount})`, `Open all invoices: ${buyerInvoiceFilterUrl(settings, report, null)}`, ...(report.buyerTraderOptions || []).map((name) => `Open ${name}: ${buyerInvoiceFilterUrl(settings, report, name)}`), '', ...(hasAttentionMarker ? [] : rows.map((row) => `${row.stemName} | ${row.buyerName || '-'} | Buyer Broker ${row.buyerBrokerNames || '-'} | Receivable Balance ${money(row.receivableBalance)} | Due ${prettyDate(row.buyerInvoiceDueDate)} | Buyer Trader ${row.buyerTraderInCharge || '-'} | Payment Collection Handler ${row.paymentHandlerName || row.collection?.ownerName || '-'} | PSPRS ${row.prpspStatus || '-'} | ${row.status} | Overdue ${overdueDisplayValue(row.daysUntilDue)}`))];
  return { subject, html, text: textLines.join('\n'), totals };
}

function isFratelliCosulichBuyerGroup(value) {
  return /\bfratelli\s+cosulich\b/i.test(String(value || ''));
}

function rowBuyerReminderRecipients(row) {
  return uniqueEmailList(row?.paymentReminderRecipients || [], row?.paymentReminderRecipient || '', row?.buyerAccountsEmail || '', row?.buyerTraderEmail || '', row?.paymentHandlerEmail || '');
}

function rowBrokerReminderEmails(row) {
  return uniqueEmailList(row?.buyerBrokerEmails || '');
}

function paymentReminderRowRouting(row) {
  const buyerRecipients = rowBuyerReminderRecipients(row);
  const brokerEmails = rowBrokerReminderEmails(row);
  const brokerNames = uniqueTextList(String(row?.buyerBrokerNames || '').split(','));
  const mode = row?.buyerBrokerRoutingMode || 'buyer_only';
  if (mode === 'broker_only') {
    return {
      mode,
      to: brokerEmails,
      cc: [],
      bcc: [],
      primaryRecipientName: brokerNames[0] || row?.buyerBrokerNames || 'Broker',
      warnings: row?.buyerBrokerRoutingWarnings || [],
    };
  }
  if (mode === 'buyer_cc_broker') {
    return {
      mode,
      to: buyerRecipients,
      cc: brokerEmails,
      bcc: [],
      primaryRecipientName: row?.buyerName || 'Customer',
      warnings: row?.buyerBrokerRoutingWarnings || [],
    };
  }
  return {
    mode: 'buyer_only',
    to: buyerRecipients,
    cc: [],
    bcc: brokerEmails,
    primaryRecipientName: row?.buyerName || 'Customer',
    warnings: row?.buyerBrokerRoutingWarnings || [],
  };
}

function paymentReminderRoutingForRows(rows = []) {
  const resultGroups = groupPaymentReminderRows(rows, paymentReminderRowRouting);
  return {
    groups: resultGroups,
    to: uniqueEmailList(...resultGroups.map((group) => group.to)),
    cc: uniqueEmailList(...resultGroups.map((group) => group.cc)),
    bcc: uniqueEmailList(...resultGroups.map((group) => group.bcc)),
    warnings: uniqueTextList(resultGroups.flatMap((group) => group.warnings)),
  };
}

function paymentReminderRecipients(rows) {
  return paymentReminderRoutingForRows(rows).to;
}

function paymentReminderTemplateContext(report, rows, selected, routing = null) {
  const totalReceivable = (rows || []).reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0);
  const selectedRow = selected || {};
  const brokerRows = rows?.length ? rows : [selectedRow];
  const routingInfo = routing || paymentReminderRoutingForRows(rows || []).groups[0] || null;
  return {
    stemName: selectedRow.stemName || '',
    keyStem: selectedRow.keyStem || '',
    buyerName: selectedRow.buyerName || 'Customer',
    primaryRecipientName: routingInfo?.primaryRecipientName || selectedRow.buyerName || 'Customer',
    buyerGroupName: selectedRow.buyerGroupName || '',
    invoiceAmount: money(selectedRow.invoiceAmount),
    receivableBalance: money(selectedRow.receivableBalance),
    buyerInvoiceDueDate: prettyDate(selectedRow.buyerInvoiceDueDate),
    buyerTraderInCharge: selectedRow.buyerTraderInCharge || '',
    buyerAccountsEmail: selectedRow.buyerAccountsEmail || '',
    buyerTraderEmail: selectedRow.buyerTraderEmail || '',
    paymentHandlerName: selectedRow.paymentHandlerName || selectedRow.collection?.ownerName || '',
    paymentHandlerEmail: selectedRow.paymentHandlerEmail || '',
    buyerBrokerNames: uniqueTextList(brokerRows.map((row) => row.buyerBrokerNames)).join(', '),
    buyerBrokerEmails: uniqueEmailList(...brokerRows.map((row) => row.buyerBrokerEmails || '')).join(', '),
    buyerBrokerInvoiceFormats: uniqueTextList(brokerRows.map((row) => row.buyerBrokerInvoiceFormats)).join(', '),
    toRecipients: routingInfo ? routingInfo.to.join(', ') : paymentReminderRecipients(rows).join(', '),
    psprsStatus: selectedRow.prpspStatus || '',
    overdue: overdueDisplayValue(selectedRow.daysUntilDue),
    invoiceStatus: selectedRow.status || '',
    daysAhead: String(report.daysAhead ?? DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead),
    today: prettyDate(report.today),
    dueThrough: prettyDate(report.dueThrough),
    invoiceCount: String((rows || []).length),
    totalReceivable: money(totalReceivable),
  };
}

function renderPaymentReminderTemplate(template, context) {
  const values = context || {};
  return String(template || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match));
}

function renderPaymentReminderEmailList(value, context) {
  const raw = Array.isArray(value) ? value.join(', ') : String(value || '');
  return parseEmailList(renderPaymentReminderTemplate(raw, context), []);
}

function hasHtmlMarkup(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
}

function sanitizeReminderHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

function htmlToPlainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function paymentReminderContentHtml(content) {
  const html = hasHtmlMarkup(content)
    ? sanitizeReminderHtml(content)
    : String(content || '')
        .split(/\n{2,}/)
        .map((block) => `<p>${escapeHtml(block.trim()).replaceAll('\n', '<br>')}</p>`)
        .join('');
  const matches = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const paragraphs = matches.length ? matches.map((match) => match[1]) : html.split(/<br\s*\/?>|\n{2,}/i).map((block) => escapeHtml(block.trim()));
  return paragraphs
    .map((inner) => inner.trim())
    .filter((inner) => htmlToPlainText(inner).trim())
    .map((inner) => {
      const text = htmlToPlainText(inner).replace(/\s+/g, ' ').trim().toLowerCase();
      let margin = '0 0 12px';
      if (/^to\s+/.test(text)) margin = '0 0 3px';
      else if (/^attn\b/.test(text)) margin = '0 0 18px';
      else if (/^regards,?/.test(text)) margin = '24px 0 3px';
      else if (/^fratelli\s+cosulich/.test(text)) margin = '0';
      return `<p style="margin:${margin};padding:0;color:#1f2937;line-height:1.35;text-align:left">${inner}</p>`;
    })
    .join('');
}

function insertAfterAttentionSentence(content, insertContent) {
  const source = String(content || '');
  const marker = /for your attention\./i.exec(source);
  if (!marker) return `${source}${insertContent}`;
  const afterMarker = marker.index + marker[0].length;
  const rest = source.slice(afterMarker);
  const paragraphClose = /<\/p>/i.exec(rest);
  if (paragraphClose && paragraphClose.index < 300) {
    const insertAt = afterMarker + paragraphClose.index + paragraphClose[0].length;
    return `${source.slice(0, insertAt)}${insertContent}${source.slice(insertAt)}`;
  }
  return `${source.slice(0, afterMarker)}\n\n${insertContent}${source.slice(afterMarker)}`;
}

function insertInvoiceTable(content, insertContent) {
  const source = String(content || '');
  if (INVOICE_TABLE_TOKEN_PATTERN.test(source)) {
    return source.replace(new RegExp(`<p\\b[^>]*>\\s*${INVOICE_TABLE_TOKEN_PATTERN.source}\\s*<\\/p>`, 'i'), insertContent).replace(INVOICE_TABLE_TOKEN_PATTERN, insertContent);
  }
  return insertAfterAttentionSentence(source, insertContent);
}

function buildBuyerInvoicePaymentReminderEmail(report, settings, selected, rows, overrides = {}, routing = null) {
  const selectedRows = rows || [];
  const context = paymentReminderTemplateContext(report, selectedRows, selected, routing);
  const subject = renderPaymentReminderTemplate(overrides.subject || settings.paymentReminderSubject, context);
  const body = renderPaymentReminderTemplate(overrides.body || settings.paymentReminderBody, context);
  const tableRows = selectedRows
    .map((row) => {
      const severity = overdueEmailStyles(row.daysUntilDue, row.prpspStatus);
      const cellStyle = `border-bottom:1px solid ${severity.border};padding:7px 8px;vertical-align:top`;
      const nowrapCellStyle = `${cellStyle};white-space:nowrap`;
      return `
    <tr style="${severity.row}">
      <td style="${cellStyle};font-weight:600;min-width:150px">${escapeHtml(row.stemName)}</td>
      <td style="${cellStyle};min-width:110px">${escapeHtml(row.buyerName || '-')}</td>
      <td style="${nowrapCellStyle};text-align:right">${money(row.invoiceAmount)}</td>
      <td style="${nowrapCellStyle};text-align:right;font-weight:600">${money(row.receivableBalance)}</td>
      <td style="${nowrapCellStyle}">${prettyDate(row.buyerInvoiceDueDate)}</td>
      <td style="${cellStyle};min-width:84px">${escapeHtml(row.buyerTraderInCharge || '-')}</td>
      <td style="${nowrapCellStyle}">
        <span style="display:inline-block;border:1px solid;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap;${severity.pill}">${escapeHtml(row.status)}</span>
      </td>
      <td style="${nowrapCellStyle};text-align:right;font-weight:600;color:${severity.text}">${overdueDisplayValue(row.daysUntilDue)}</td>
    </tr>`;
    })
    .join('');
  const tableHtml = `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #d9e2ef;border-radius:10px;margin:14px 0 16px;max-width:100%">
      <table style="border-collapse:collapse;width:auto;min-width:100%;max-width:none;font-size:12px;line-height:1.25;table-layout:auto">
        <thead>
          <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
	            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Stem</th>
	            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Buyer</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Invoice</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Receivable</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Due Date</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Trader</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Status</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Overdue</th>
          </tr>
        </thead>
        <tbody>${tableRows || '<tr><td colspan="8" style="padding:18px;text-align:center;color:#667085">No invoices selected.</td></tr>'}</tbody>
      </table>
    </div>`;
  const bodyHtml = paymentReminderContentHtml(body);
  const htmlWithTable = insertInvoiceTable(bodyHtml, tableHtml);
  const invoiceText = selectedRows.map((row) => `${row.stemName} | ${row.buyerName || '-'} | Receivable Balance ${money(row.receivableBalance)} | Due ${prettyDate(row.buyerInvoiceDueDate)} | ${row.status} | Overdue ${overdueDisplayValue(row.daysUntilDue)} | Buyer Trader ${row.buyerTraderInCharge || '-'}`).join('\n');
  const bodyText = hasHtmlMarkup(body) ? htmlToPlainText(body) : body;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">
      ${htmlWithTable}
    </div>`;
  const text = insertInvoiceTable(bodyText, `\n\n${invoiceText}\n\n`);
  return { subject, body, html, text };
}

async function loadBuyerInvoicePaymentReminderContext(body = {}, accessContext = null) {
  const stemId = String(body.stemId || body.stem_id || '').trim();
  if (!isSalesforceId(stemId)) throw appError('A valid Salesforce STEM is required for a payment reminder.', 400);
  if (accessContext) await requireInterofficeStemAccess(stemId, accessContext);
  const [stored, sender] = await Promise.all([
    loadStoredBuyerInvoiceEmailSettings(),
    accessContext?.client
      ? resolveGraphEmailSender(accessContext.client, 'payment_reminders')
      : Promise.resolve(null),
  ]);
  if (stored.meta.storageAvailable !== true) {
    throw appError('Buyer Invoice email settings are temporarily unavailable. External payment reminders are disabled until storage is restored.', 503);
  }
  const settings = {
    ...buyerInvoiceEmailSettings(stored.settings),
    hasBuyerTraderFilter: (stored.settings.buyerTraders || []).length > 0,
  };
  const report = await salesforceBuyerInvoicesDueTargeted(
    {
      daysAhead: body.daysAhead ?? settings.daysAhead,
      anchorStemId: stemId,
      requestedStemIds: body.requestedStemIds || body.invoiceStemIds,
    },
    null,
    accessContext,
  );
  if (report.paymentReminderRulesAvailable !== true) {
    throw appError('Buyer Invoice reminder rules are temporarily unavailable. External payment reminders are disabled until storage is restored.', 503);
  }
  const selected = report.rows.find((row) => row.stemId === stemId);
  if (!selected) throw appError('Selected invoice is no longer in the current outstanding invoice window.', 404);
  const candidates = report.rows
    .filter((row) => buyerReminderCandidateByAccount(row, selected))
    .sort((a, b) => {
      if (a.buyerInvoiceDueDate !== b.buyerInvoiceDueDate) return a.buyerInvoiceDueDate.localeCompare(b.buyerInvoiceDueDate);
      return String(a.stemName || '').localeCompare(String(b.stemName || ''));
    });
  return { settings, settingsRevision: Number(stored.meta.revision || 0), report, selected, candidates, sender };
}

function preparePaymentReminderRouting(report, settings, selected, candidates) {
  const eligibleCandidates = candidates.filter((row) => row.paymentReminderEligible === true);
  const routing = paymentReminderRoutingForRows(eligibleCandidates);
  const firstGroup = routing.groups.find((group) => group.rows.some((row) => row.stemId === selected.stemId))
    || routing.groups[0]
    || {
      key: 'default', rows: eligibleCandidates, to: [], cc: [], bcc: [],
      primaryRecipientName: selected.buyerName || 'Customer', mode: 'buyer_only', warnings: [],
    };
  const firstSelected = firstGroup.rows.find((row) => row.stemId === selected.stemId) || firstGroup.rows[0] || selected;
  const preparedGroups = routing.groups.map((group) => {
    const groupSelected = group.rows.find((row) => row.stemId === selected.stemId) || group.rows[0] || selected;
    const groupContext = paymentReminderTemplateContext(report, group.rows, groupSelected, group);
    return {
      mode: group.mode,
      key: group.key,
      to: group.to,
      cc: uniqueEmailList(group.cc, renderPaymentReminderEmailList(settings.paymentReminderCc, groupContext)),
      bcc: uniqueEmailList(group.bcc, renderPaymentReminderEmailList(settings.paymentReminderBcc, groupContext)),
      primaryRecipientName: group.primaryRecipientName,
      warnings: group.warnings,
      stemIds: group.rows.map((row) => row.stemId),
    };
  });
  const firstPreparedGroup = preparedGroups.find((group) => group.key === firstGroup.key)
    || preparedGroups[0]
    || { to: firstGroup.to, cc: firstGroup.cc, bcc: firstGroup.bcc };
  const email = buildBuyerInvoicePaymentReminderEmail(report, settings, firstSelected, firstGroup.rows, {}, firstGroup);
  return { eligibleCandidates, routing, firstGroup, firstPreparedGroup, preparedGroups, email };
}

function paymentReminderPreparationFingerprint({ candidates, preparedGroups, settingsRevision }) {
  return createHash('sha256').update(JSON.stringify({
    candidates: candidates.map((row) => ({
      stemId: row.stemId,
      lastModifiedAt: row.lastModifiedAt || null,
      eligible: row.paymentReminderEligible === true,
      ruleRevision: Number(row.reminderRuleRevision || 0),
      ruleUpdatedAt: row.reminderRuleUpdatedAt || null,
    })).sort((left, right) => left.stemId.localeCompare(right.stemId)),
    groups: preparedGroups.map((group) => ({
      key: group.key,
      stemIds: [...group.stemIds].sort(),
      to: uniqueEmailList(group.to).map((email) => email.toLowerCase()).sort(),
      cc: uniqueEmailList(group.cc).map((email) => email.toLowerCase()).sort(),
      bcc: uniqueEmailList(group.bcc).map((email) => email.toLowerCase()).sort(),
    })).sort((left, right) => left.key.localeCompare(right.key)),
    settingsRevision,
  })).digest('hex');
}

function paymentReminderConflictDetails(candidates = []) {
  return {
    candidates: candidates.map((row) => ({
      stemId: row.stemId,
      stemName: row.stemName,
      buyerName: row.buyerName,
      receivableBalance: row.receivableBalance,
      buyerInvoiceDueDate: row.buyerInvoiceDueDate,
      paymentReminderEligible: row.paymentReminderEligible === true,
      paymentReminderBlockingReason: row.paymentReminderBlockingReason || null,
      lastModifiedAt: row.lastModifiedAt || null,
    })),
  };
}

async function buyerInvoicePaymentReminderPrepare(body, req, accessContext = null) {
  const startedAt = Date.now();
  const activeAccess = accessContext || (await requireActiveUser(req));
  const { settings, settingsRevision, report, selected, candidates } = await loadBuyerInvoicePaymentReminderContext(body, activeAccess);
  if (selected.paymentReminderEligible !== true) {
    throw appError(selected.paymentReminderBlockingReason || 'This invoice is not eligible for an external payment reminder.', 409);
  }
  const { routing, firstPreparedGroup, preparedGroups, email } = preparePaymentReminderRouting(report, settings, selected, candidates);
  const prepareMs = Date.now() - startedAt;
  const preparationHash = paymentReminderPreparationFingerprint({ candidates, preparedGroups, settingsRevision });
  const previewToken = signPaymentReminderPreview({
    anchorStemId: selected.stemId,
    candidateStemIds: candidates.map((row) => row.stemId).sort(),
    preparationHash,
    settingsRevision,
    prepareMs,
  }, paymentReminderPreviewSecret());
  return {
    selected,
    candidates,
    to: firstPreparedGroup.to,
    allTo: routing.to,
    cc: firstPreparedGroup.cc,
    bcc: firstPreparedGroup.bcc,
    autoBcc: firstPreparedGroup.bcc,
    subject: settings.paymentReminderSubject,
    body: settings.paymentReminderBody,
    preview: { html: email.html, text: email.text },
    routingGroups: preparedGroups,
    routingWarnings: routing.warnings,
    settingsRevision,
    previewToken,
    preparationHash,
    timings: { prepareMs },
    settings: {
      paymentReminderToSource: 'Buyer account/trader/payment handler plus buyer broker Account.Email by Invoice Format',
      emailDelivery: serverEmailDeliveryStatus(),
      daysAhead: report.daysAhead,
      paymentReminderCc: settings.paymentReminderCc,
      paymentReminderBcc: settings.paymentReminderBcc,
    },
  };
}

async function buyerInvoicePaymentReminderSend(body, req, accessContext = null) {
  const activeAccess = accessContext || (await requireActiveUser(req));
  const selectedStemIds = new Set((Array.isArray(body.invoiceStemIds) ? body.invoiceStemIds : []).map((id) => String(id || '').trim()).filter(Boolean));
  if (!selectedStemIds.size) throw appError('Select at least one invoice to include in the payment reminder.', 400);
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (idempotencyKey.length < 16 || idempotencyKey.length > 200) throw appError('A valid payment reminder operation ID is required.', 400);
  const preview = verifyPaymentReminderPreview(body.previewToken, paymentReminderPreviewSecret());
  const anchorStemId = String(body.stemId || '').trim();
  if (preview.anchorStemId !== anchorStemId) throw appError('The payment reminder review belongs to another invoice. Reopen it before sending.', 409);
  if ([...selectedStemIds].some((stemId) => !preview.candidateStemIds?.includes(stemId))) {
    throw appError('The selected invoice list changed after review. Reopen the payment reminder before sending.', 409);
  }
  const validationStartedAt = Date.now();
  await reconcileBuyerInvoiceCollections({
    client: activeAccess.client,
    profile: activeAccess.profile,
    accessContext: activeAccess,
    stemIds: [...selectedStemIds],
  });
  const { settings, settingsRevision: liveSettingsRevision, report, selected, candidates, sender } = await loadBuyerInvoicePaymentReminderContext(
    { ...body, requestedStemIds: null },
    activeAccess,
  );
  const liveRouting = preparePaymentReminderRouting(report, settings, selected, candidates);
  const livePreparationHash = paymentReminderPreparationFingerprint({
    candidates,
    preparedGroups: liveRouting.preparedGroups,
    settingsRevision: liveSettingsRevision,
  });
  if (Number(preview.settingsRevision) !== Number(liveSettingsRevision) || preview.preparationHash !== livePreparationHash) {
    throw appError('Salesforce, reminder rules, recipients, or email settings changed after review. Review the refreshed reminder before sending.', 409, 'PAYMENT_REMINDER_REVIEW_STALE', paymentReminderConflictDetails(candidates));
  }
  const selection = evaluateBuyerReminderSelection(candidates, [...selectedStemIds]);
  if (selection.unknownStemIds.length) {
    throw appError('The selected invoice list changed after review. Review the refreshed reminder before sending.', 409, 'PAYMENT_REMINDER_SELECTION_STALE', paymentReminderConflictDetails(candidates));
  }
  if (selection.restrictedRows.length) {
    throw appError(selection.restrictedRows[0].paymentReminderBlockingReason || 'One or more selected invoices are no longer eligible for an external payment reminder.', 409, 'PAYMENT_REMINDER_SELECTION_RESTRICTED', paymentReminderConflictDetails(candidates));
  }
  const rows = selection.rows;
  const routing = paymentReminderRoutingForRows(rows);
  if (!routing.groups.length) throw appError('No payment reminder recipient group could be built.', 400);
  if (!Array.isArray(body.recipientBatches)) {
    throw appError('Reviewed email recipient fields are required. Reopen the payment reminder preview and confirm each email batch before sending.', 400);
  }
  const reviewedRecipientBatches = new Map(body.recipientBatches.filter((batch) => batch?.key).map((batch) => [batch.key, batch]));
  const outboundBatches = routing.groups.map((group) => {
    const groupSelected = group.rows.find((row) => row.stemId === selected.stemId) || group.rows[0] || selected;
    const reviewedBatch = reviewedRecipientBatches.get(group.key);
    if (!reviewedBatch) throw appError(`Reviewed recipient fields are missing for ${group.primaryRecipientName || 'recipient group'}. Reopen the preview before sending.`, 400);
    const to = uniqueEmailList(reviewedBatch.to || '');
    const cc = uniqueEmailList(reviewedBatch.cc || '');
    const bcc = uniqueEmailList(reviewedBatch.bcc || '');
    if (!to.length) throw appError(`Payment reminder recipient is required for ${group.primaryRecipientName || 'recipient group'}.`, 400);
    const email = buildBuyerInvoicePaymentReminderEmail(report, settings, groupSelected, group.rows, { subject: body.subject, body: body.body }, { ...group, to });
    return { group, to, cc, bcc, email };
  });
  const validationMs = Date.now() - validationStartedAt;
  const requestHash = paymentReminderRequestHash({
    anchorStemId,
    invoiceStemIds: [...selectedStemIds],
    recipientBatches: body.recipientBatches,
    subject: body.subject,
    body: body.body,
  });
  const reservation = await reservePaymentReminderOperation(activeAccess.client, {
    idempotencyKey,
    requestHash,
    anchorStemId,
    selectedStemIds: [...selectedStemIds],
    batchCount: outboundBatches.length,
    actorUserId: activeAccess.profile.id,
    actorEmail: activeAccess.profile.email,
  });
  if (reservation.replay) return { sent: true, idempotencyReplayed: true, ...reservation.result };
  if (reservation.uncertain) throw appError('A previous delivery attempt has an uncertain Microsoft Graph outcome. Verify Sent Items before retrying.', 409);
  if (reservation.blocked) throw appError('This payment reminder is already being processed.', 409);
  const operationId = reservation.operationId;
  const graphStartedAt = Date.now();
  const deliveryResults = await mapPaymentReminderBatches(outboundBatches, async (batch) => {
    const batchKeyHash = createHash('sha256').update(batch.group.key).digest('hex');
    const batchRequestHash = paymentReminderBatchHash({
      key: batch.group.key,
      stemIds: batch.group.rows.map((row) => row.stemId),
      to: batch.to,
      cc: batch.cc,
      bcc: batch.bcc,
    }, { subject: batch.email.subject, html: batch.email.html });
    const recipientCount = uniqueEmailList(batch.to, batch.cc, batch.bcc).length;
    let batchReservation;
    try {
      batchReservation = await reservePaymentReminderBatch(activeAccess.client, {
        operationId,
        batchKeyHash,
        requestHash: batchRequestHash,
        stemIds: batch.group.rows.map((row) => row.stemId),
        rowCount: batch.group.rows.length,
        recipientCount,
      });
    } catch (error) {
      return { ...batch, status: 'failed', errorCode: 'PAYMENT_REMINDER_BATCH_RESERVE_FAILED', error, graphMs: 0 };
    }
    if (batchReservation.replay) return { ...batch, status: 'accepted', replay: true, providerRequestId: batchReservation.providerRequestId, graphMs: 0 };
    if (batchReservation.uncertain) return { ...batch, status: 'uncertain', errorCode: 'PAYMENT_REMINDER_BATCH_UNCERTAIN', graphMs: 0 };
    const batchStartedAt = Date.now();
    try {
      const result = await sendOperationalMail({
        to: batch.to, cc: batch.cc, bcc: batch.bcc,
        subject: batch.email.subject, html: batch.email.html, text: batch.email.text,
      }, {
        client: activeAccess.client, purposeKey: 'payment_reminders',
        mailboxSnapshot: { id: sender.mailboxId, emailAddress: sender.emailAddress },
      });
      const graphMs = Date.now() - batchStartedAt;
      await completePaymentReminderBatch(activeAccess.client, {
        operationId, batchKeyHash, status: 'accepted',
        providerRequestId: result.id || result.messageId || null, graphMs,
      });
      return { ...batch, status: 'accepted', result, graphMs };
    } catch (error) {
      const graphMs = Date.now() - batchStartedAt;
      const uncertain = paymentReminderDeliveryUncertain(error);
      try {
        await completePaymentReminderBatch(activeAccess.client, {
          operationId, batchKeyHash, status: uncertain ? 'uncertain' : 'failed',
          graphMs, errorCode: String(error?.code || 'PAYMENT_REMINDER_DELIVERY_FAILED').slice(0, 100),
        });
      } catch (ledgerError) {
        console.error('[payment-reminder] delivery ledger update failed', { requestId: requestIdFrom(req), code: ledgerError?.code || null });
        return { ...batch, status: 'uncertain', errorCode: 'PAYMENT_REMINDER_LEDGER_UNCERTAIN', error, graphMs };
      }
      console.error('[buyerInvoicePaymentReminderSend] email provider failed', {
        code: String(error?.code || error?.name || 'provider_error').slice(0, 80),
        provider: operationalMailConfig().deliveryMethod,
        toCount: batch.to.length, ccCount: batch.cc.length, bccCount: batch.bcc.length,
        rows: batch.group.rows.length, routingMode: batch.group.mode,
      });
      return { ...batch, status: uncertain ? 'uncertain' : 'failed', errorCode: error?.code || null, error, graphMs };
    }
  }, 3);
  const graphMs = Date.now() - graphStartedAt;
  const accepted = deliveryResults.filter((item) => item.status === 'accepted');
  const failed = deliveryResults.filter((item) => item.status === 'failed');
  const uncertain = deliveryResults.filter((item) => item.status === 'uncertain');
  const preTimelineStatus = uncertain.length ? 'uncertain' : accepted.length === outboundBatches.length ? 'accepted' : accepted.length ? 'partial' : 'failed';
  await completePaymentReminderOperation(activeAccess.client, {
    operationId,
    status: preTimelineStatus,
    acceptedBatchCount: accepted.length,
    failedBatchCount: failed.length,
    timelineRecorded: false,
    prepareMs: Number(preview.prepareMs || 0), validationMs, graphMs, timelineMs: 0,
    errorCode: uncertain[0]?.errorCode || failed[0]?.errorCode || null,
  });

  const collectionWarnings = [];
  let collectionResults = [];
  let timelineMs = 0;
  if (accepted.length) {
    const timelineStartedAt = Date.now();
    const timelineRows = accepted.flatMap((item) => {
      const recipientCount = uniqueEmailList(item.to, item.cc, item.bcc).length;
      const note = [`Payment reminder accepted by Microsoft Graph.`, `Recipients: ${recipientCount}`, `Routing: ${item.group.mode}`, `Included invoices: ${item.group.rows.length}`].join('\n');
      const subjectHash = createHash('sha256').update(item.email.subject).digest('hex');
      return item.group.rows.map((row) => ({
        stemId: row.stemId,
        ownerName: row.collection?.ownerName || splitBuyerTraderNames(row.buyerTraderInCharge)[0] || '',
        note, recipientCount, subjectHash,
      }));
    });
    try {
      const saved = await savePaymentReminderTimeline(activeAccess.client, {
        operationId, rows: timelineRows,
        actorUserId: activeAccess.profile.id, actorEmail: activeAccess.profile.email,
      });
      collectionResults = (Array.isArray(saved) ? saved : []).map((item) => ({
        item: serializeCollectionItem(item?.item),
        event: serializeCollectionEvent(item?.event),
      }));
    } catch (error) {
      console.error('[payment-reminder] atomic timeline update failed', { requestId: requestIdFrom(req), code: error?.code || null });
      collectionWarnings.push({ error: 'The reminder was sent, but FCOS will repair its collection timeline during reconciliation.' });
    }
    timelineMs = Date.now() - timelineStartedAt;
  }

  const completed = accepted.length === outboundBatches.length && collectionWarnings.length === 0;
  const finalStatus = completed ? 'completed' : preTimelineStatus;
  const redactedResult = {
    operationId,
    emails: accepted.length,
    rows: accepted.reduce((sum, item) => sum + item.group.rows.length, 0),
    recipientCount: accepted.reduce((sum, item) => sum + uniqueEmailList(item.to, item.cc, item.bcc).length, 0),
    acceptedBatchCount: accepted.length,
    failedBatchCount: failed.length,
    uncertainBatchCount: uncertain.length,
  };
  await completePaymentReminderOperation(activeAccess.client, {
    operationId, status: finalStatus,
    acceptedBatchCount: accepted.length, failedBatchCount: failed.length,
    timelineRecorded: collectionWarnings.length === 0,
    prepareMs: Number(preview.prepareMs || 0), validationMs, graphMs, timelineMs,
    resultSnapshot: redactedResult,
    errorCode: uncertain[0]?.errorCode || failed[0]?.errorCode || null,
  });

  if (!accepted.length) {
    const firstError = uncertain[0]?.error || failed[0]?.error;
    if (uncertain.length) throw appError('Microsoft Graph delivery could not be confirmed. Verify Sent Items before retrying.', 409);
    throw firstError || appError('Microsoft Graph rejected every payment reminder batch.', 502);
  }

  waitUntil(Promise.resolve().then(() => {
    expireRuntimeCacheTags(['salesforce:buyer-invoices']);
  }).catch(() => {}));
  return {
    sent: completed,
    partial: !completed,
    operationId,
    id: accepted[0]?.result?.id || accepted[0]?.providerRequestId || null,
    emails: accepted.length,
    batches: accepted.map((item) => ({
      to: item.to, cc: item.cc, bcc: item.bcc,
      subject: item.email.subject, rows: item.group.rows.length, mode: item.group.mode,
    })),
    failedBatches: [...failed, ...uncertain].map((item) => ({
      key: item.group.key, mode: item.group.mode, rows: item.group.rows.length,
      status: item.status, errorCode: item.errorCode || null,
    })),
    to: uniqueEmailList(...accepted.map((item) => item.to)),
    cc: uniqueEmailList(...accepted.map((item) => item.cc)),
    bcc: uniqueEmailList(...accepted.map((item) => item.bcc)),
    subject: accepted[0]?.email.subject || null,
    rows: accepted.reduce((sum, item) => sum + item.group.rows.length, 0),
    collectionResults,
    collectionWarnings,
    timings: { prepareMs: Number(preview.prepareMs || 0), validationMs, graphMs, timelineMs },
  };
}

async function startBuyerInvoiceEmailRun(window) {
  const client = safeSupabaseAdminClient();
  if (!client) return { allowed: true, run: null };
  const { data, error } = await client
    .from('buyer_invoice_email_runs')
    .insert({
      run_key: window.runKey,
      schedule_time: window.time,
      status: 'running',
    })
    .select('id,run_key,status,created_at')
    .single();
  if (error?.code === '23505') return { allowed: false, duplicate: true };
  if (error) throw error;
  return { allowed: true, run: data };
}

async function finishBuyerInvoiceEmailRun(runKey, patch = {}) {
  const client = safeSupabaseAdminClient();
  if (!client || !runKey) return;
  const { error } = await client
    .from('buyer_invoice_email_runs')
    .update({
      ...patch,
      completed_at: new Date().toISOString(),
    })
    .eq('run_key', runKey);
  if (error) console.error('Failed to update buyer invoice email run', error.message);
}

function requireCronAuthorization(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw appError('Missing CRON_SECRET in Vercel.', 500);
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  if (String(header) !== `Bearer ${secret}`) throw appError('Unauthorized cron request.', 401);
}

async function outstandingBuyerInvoicesEmailReport(body = {}, req = null, accessContext = null) {
  const activeAccess = accessContext || (body.scheduled ? null : await requireActiveUser(req));
  const deliveryClient = activeAccess?.client || safeSupabaseAdminClient();
  if (!deliveryClient) throw appError('FCOS database access is unavailable for the internal report.', 503);
  const stored = await loadStoredBuyerInvoiceEmailSettings();
  if ((!body.preview && !body.dryRun) && stored.meta.configured !== true) {
    throw appError('Outstanding buyer invoice report recipients are not configured. Sending is disabled.', 503, 'FINANCIAL_REPORT_NOT_CONFIGURED', undefined, true);
  }
  if (!body.preview && !body.dryRun && (!String(stored.settings?.subject || '').trim() || !String(stored.settings?.intro || '').trim())) {
    throw appError('Outstanding buyer invoice report subject and body are not configured. Sending is disabled.', 503, 'FINANCIAL_REPORT_TEMPLATE_NOT_CONFIGURED', undefined, true);
  }
  const settings = {
    ...buyerInvoiceEmailSettings(stored.settings),
    hasBuyerTraderFilter: (stored.settings.buyerTraders || []).length > 0,
  };
  if (!body.preview && !body.dryRun && !body.force && !isBuyerInvoiceReportDue(settings)) {
    return {
      sent: false,
      skipped: true,
      reason: 'Current Hong Kong time is outside the configured report schedule.',
      schedule: {
        weekdays: settings.weekdays,
        sendTimes: settings.sendTimes,
        now: hongKongScheduleParts(),
      },
    };
  }
  const reportPayload = { daysAhead: settings.daysAhead };
  if (settings.hasBuyerTraderFilter) reportPayload.buyerTraders = settings.buyerTraders;
  if (!body.preview && !body.dryRun) reportPayload.force = true;
  const report = await salesforceBuyerInvoicesDue(reportPayload, null, activeAccess);
  const email = buildBuyerInvoiceReportEmail(report, settings);
  if (body.preview || body.dryRun) {
    await updateBuyerInvoiceEmailSettingsMeta({
      last_preview_at: new Date().toISOString(),
      last_preview_row_count: report.rows.length,
      last_error: null,
    });
    return {
      sent: false,
      preview: true,
      settings: { ...settings, to: settings.to, cc: settings.cc },
      report: {
        rows: report.rows,
        today: report.today,
        dueThrough: report.dueThrough,
        daysAhead: report.daysAhead,
        buyerTraderOptions: report.buyerTraderOptions,
        selectedBuyerTraders: report.selectedBuyerTraders,
        hasBuyerTraderFilter: report.hasBuyerTraderFilter,
      },
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        totals: email.totals,
      },
    };
  }
  let result;
  try {
    result = await sendOperationalMail({
      to: settings.to,
      cc: settings.cc,
      bcc: settings.bcc,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }, { client: deliveryClient, purposeKey: 'outstanding_invoice_reports' });
  } catch (error) {
    await updateBuyerInvoiceEmailSettingsMeta({ last_error: error.message });
    throw error;
  }
  await updateBuyerInvoiceEmailSettingsMeta({
    last_sent_at: new Date().toISOString(),
    last_sent_row_count: report.rows.length,
    last_error: null,
  });
  return {
    sent: true,
    id: result.id,
    to: settings.to,
    cc: settings.cc,
    bcc: settings.bcc,
    subject: email.subject,
    rows: report.rows.length,
    totals: email.totals,
  };
}

async function outstandingBuyerInvoicesEmailCron(body, req) {
  requireCronAuthorization(req);
  if (!isExternalActionEnabled('email_delivery')) {
    return {
      sent: false,
      skipped: true,
      gated: true,
      reason: 'Scheduled email delivery has been paused by an emergency operational control.',
    };
  }
  const stored = await loadStoredBuyerInvoiceEmailSettings();
  if (stored.meta.storageAvailable !== true) {
    throw appError('Buyer Invoice email settings are temporarily unavailable. Scheduled report sending is disabled until storage is restored.', 503);
  }
  const settings = {
    ...buyerInvoiceEmailSettings(stored.settings),
    hasBuyerTraderFilter: (stored.settings.buyerTraders || []).length > 0,
  };
  if (settings.enabled === false)
    return {
      sent: false,
      skipped: true,
      reason: 'Email schedule is disabled.',
    };

  const window = buyerInvoiceScheduledWindow(settings);
  if (!window) {
    return {
      sent: false,
      skipped: true,
      reason: 'Current Hong Kong time is outside the configured report schedule.',
      schedule: {
        weekdays: settings.weekdays,
        sendTimes: settings.sendTimes,
        now: hongKongScheduleParts(),
      },
    };
  }

  const run = await startBuyerInvoiceEmailRun(window);
  if (!run.allowed)
    return {
      sent: false,
      skipped: true,
      duplicate: true,
      runKey: window.runKey,
    };

  try {
    const result = await outstandingBuyerInvoicesEmailReport({
      settings,
      force: true,
      scheduled: true,
    });
    await finishBuyerInvoiceEmailRun(window.runKey, {
      status: 'sent',
      rows_count: result.rows,
      totals: result.totals || {},
      provider_result: {
        id: result.id || null,
        to: result.to || [],
        cc: result.cc || [],
        subject: result.subject || null,
      },
    });
    return { ...result, scheduled: true, runKey: window.runKey };
  } catch (error) {
    await finishBuyerInvoiceEmailRun(window.runKey, {
      status: 'failed',
      error: error.message,
    });
    throw error;
  }
}

async function salesforceDisputeStems(body, req = null, accessContext = null) {
  const limit = Math.max(100, Math.min(Number(body.limit) || 5000, 10000));
  const requestedStemId = isSalesforceId(String(body.stemId || '').trim()) ? String(body.stemId).trim() : null;
  const [describe, accountDescribe] = await Promise.all([
    salesforceObjectFields({ objectName: 'stem__c' }),
    salesforceObjectFields({ objectName: 'Account' }),
  ]);
  const fieldNames = describe.fields.map((f) => f.name);
  const disputeAccountFields = new Set((accountDescribe.fields || []).map((field) => field.name));
  if (!disputeAccountFields.has('Inactive_Suspended__c')) {
    throw appError('Dispute Account discovery cannot verify active Salesforce Accounts.', 503, 'DISPUTE_ACCOUNT_STATUS_SCHEMA', undefined, true);
  }
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames);
  const hasDispute = fieldNames.includes('Dispute__c');
  const hasDisputeStatus = fieldNames.includes('Dispute_Status__c');
  if (!hasDispute && !hasDisputeStatus) return { rows: [] };
  const supplierInvoiceDescribe = await salesforceObjectFields({
    objectName: 'Supplier_Invoice__c',
  }).catch(() => ({ fields: [] }));
  const supplierInvoiceFields = supplierInvoiceDescribe.fields || [];
  const supplierInvoiceFieldNames = supplierInvoiceFields.map((f) => f.name);
  const supplierInvoiceFieldByName = Object.fromEntries(supplierInvoiceFields.map((field) => [field.name, field]));
  const paymentDescribe = await salesforceObjectFields({
    objectName: 'Payment__c',
  }).catch(() => ({ fields: [] }));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  const supplierSettlementSchema = resolveSupplierSettlementSchema({
    supplierInvoiceFields,
    paymentFields,
  });
  const supplierInvoicePayableField = supplierSettlementSchema.invoicePayableField;
  const supplierInvoiceAmountFields = supplierSettlementSchema.invoiceAmountField ? [supplierSettlementSchema.invoiceAmountField] : [];
  const supplierInvoiceDueDateFields = supplierSettlementSchema.invoiceDueDateFields;
  const supplierInvoiceDateFields = supplierSettlementSchema.invoiceDateFields;
  const supplierInvoiceStatusFields = supplierSettlementSchema.invoiceStatusFields;
  const supplierInvoiceSupplierFields = supplierSettlementSchema.supplierAccountFields;
  const supplierInvoiceSupplierNameRelationships = supplierInvoiceSupplierFields.map((field) => supplierInvoiceFieldByName[field]?.relationshipName).filter(Boolean);
  const lineItemDescribe = await salesforceObjectFields({
    objectName: 'STEM_Line_Item__c',
  }).catch(() => ({ fields: [] }));
  const originalSupplierLookup = resolveOriginalSupplierLookup(lineItemDescribe.fields || []);
  const originalSupplierRelationship = originalSupplierLookup.relationshipName || 'Original_Supplier__r';
  const extraCostDescribe = await salesforceObjectFields({
    objectName: 'STEM_Extra_Cost__c',
  }).catch(() => ({ fields: [] }));
  const extraCostFields = extraCostDescribe.fields || [];
  const extraCostFieldNames = new Set(extraCostFields.map((field) => field.name));
  const extraCostSupplierLookup = resolveExtraCostSupplierLookup(extraCostFields);
  const extraCostSupplierField = extraCostSupplierLookup.fieldName;
  const extraCostSupplierRelationship = extraCostSupplierLookup.relationshipName;

  const fields = ['Id', 'Name', 'CreatedDate', 'LastModifiedDate'];
  for (const field of ['KeyStem__c', 'Delivery_Date__c', 'Expected_Delivery_Date__c', 'ETA_Start_Date__c', 'Buyer_Pay_Term_Date__c', 'Invoice_Due_Date__c', 'Due_Date__c', 'Buyer_Name__c', 'Buyer__c', 'Account__c', 'Dispute__c', 'Dispute_Status__c', 'Total_Invoice_Amount__c', 'Total_Invoiced_Amount_From_Suppliers__c', 'Payable_Balance__c', 'Receivable_Balance__c', 'QLIK_STEM_Line_Item_Total_Cost__c', 'QLIK_Costs_Total_Cost__c']) {
    if (fieldNames.includes(field)) fields.push(field);
  }
  if (fieldNames.includes('Vessel__c')) fields.push('Vessel__r.Name');
  if (fieldNames.includes('Port__c')) fields.push('Port__r.Name');
  if (fieldNames.includes('Account__c')) fields.push('Account__r.Name', 'Account__r.Inactive_Suspended__c');

  const activeDisputeStatusCondition = "(Dispute_Status__c != null AND Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != 'No Disputes' AND Dispute_Status__c != 'no dispute' AND Dispute_Status__c != 'no disputes')";
  const disputeCondition = hasDisputeStatus ? activeDisputeStatusCondition : 'Dispute__c = true';
  const stemWhere = combineWhereConditions([disputeCondition, interofficeCondition, requestedStemId ? `Id = '${escapeSoql(requestedStemId)}'` : '']);
  const rows = await queryRows(
    `
    SELECT ${[...new Set(fields)].join(', ')}
    FROM stem__c
    WHERE ${stemWhere}
    ORDER BY LastModifiedDate DESC
    LIMIT ${limit}
  `,
    { limit, softFail: true },
  );

  const stemIds = rows.map((stem) => stem.Id).filter(Boolean);
  const lineItemsByStem = {};
  const extraCostsByStem = {};
  const supplierInvoicesByStem = {};
  const supplierInvoicePayableByStem = {};
  const supplierPaymentsByInvoice = {};
  const finalBuyerInvoiceStemIds = new Set();

  if (stemIds.length) {
    const [lineItemArrays, extraCostArrays, supplierInvoiceArrays, buyerInvoiceArrays] = await Promise.all([
      compositeQueryRows(
        chunkIds(stemIds).map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return {
            soql: `
          SELECT Id, STEM__c, Product__r.Name, Supplier_Name__c,
                 ${originalSupplierLookup.valid ? `Original_Supplier__c, ${originalSupplierRelationship}.Name, ${originalSupplierRelationship}.Inactive_Suspended__c,` : ''}
                 Payment_Term__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
                 Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
                 Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c,
                 Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Cancelled__c,
                 Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c
          FROM STEM_Line_Item__c
          WHERE STEM__c IN (${inList})
          ORDER BY STEM__c, CreatedDate ASC
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      ),
      compositeQueryRows(
        chunkIds(stemIds).map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          const extraCostSelectFields = ['Id', 'STEM__c', 'Supplier_Name__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_in_MT__c', 'Quantity_Range_Max__c', 'Is_Quantity_Range__c', 'Unit_Price__c', 'Unit_Cost__c', 'Line_Total__c', 'Line_Total_Buy__c', 'Supplier_Invoice__c', 'Cancelled__c', extraCostFieldNames.has('Payment_Term__c') ? 'Payment_Term__c' : null, extraCostFieldNames.has('Product2Id__c') ? 'Product2Id__r.Name' : null, extraCostSupplierLookup.valid ? extraCostSupplierField : null, extraCostSupplierLookup.valid && extraCostSupplierRelationship ? `${extraCostSupplierRelationship}.Name` : null, extraCostSupplierLookup.valid && extraCostSupplierRelationship ? `${extraCostSupplierRelationship}.Inactive_Suspended__c` : null].filter(Boolean);
          return {
            soql: `
          SELECT ${[...new Set(extraCostSelectFields)].join(', ')}
          FROM STEM_Extra_Cost__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `,
            limit: 5000,
            softFail: true,
          };
        }),
      ),
      supplierInvoiceFieldNames.includes('STEM__c')
        ? compositeQueryRows(
            chunkIds(stemIds).map((chunk) => {
              const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
              const supplierInvoiceSelectFields = ['STEM__c', 'Id', 'Name', 'CreatedDate', 'LastModifiedDate', ...supplierInvoiceAmountFields, ...supplierInvoiceDueDateFields, ...supplierInvoiceDateFields, ...supplierInvoiceStatusFields, supplierInvoicePayableField, supplierInvoiceFieldNames.includes('CurrencyIsoCode') ? 'CurrencyIsoCode' : null, supplierInvoiceFieldNames.includes('Supplier_Name__c') ? 'Supplier_Name__c' : null, ...supplierInvoiceSupplierFields, ...supplierInvoiceSupplierNameRelationships.flatMap((relationship) => [`${relationship}.Name`, `${relationship}.Inactive_Suspended__c`])].filter(Boolean);
              return {
                soql: `
              SELECT ${[...new Set(supplierInvoiceSelectFields)].join(', ')}
              FROM Supplier_Invoice__c
              WHERE STEM__c IN (${inList})
              LIMIT 5000
            `,
                limit: 5000,
                softFail: true,
              };
            }),
          )
        : Promise.resolve([]),
      compositeQueryRows(chunkIds(stemIds).map((chunk) => ({
        soql: `SELECT Id, Name, STEM__c, Proforma__c, Deprecated__c FROM Invoice__c WHERE STEM__c IN (${chunk.map((id) => `'${escapeSoql(id)}'`).join(',')}) LIMIT 5000`,
        limit: 5000,
        softFail: true,
      }))),
    ]);

    for (const invoice of buyerInvoiceArrays.flat().filter(isFinalBuyerInvoice)) if (invoice.STEM__c) finalBuyerInvoiceStemIds.add(invoice.STEM__c);

    for (const item of lineItemArrays.flat()) {
      if (!item.STEM__c) continue;
      if (!lineItemsByStem[item.STEM__c]) lineItemsByStem[item.STEM__c] = [];
      lineItemsByStem[item.STEM__c].push(item);
    }
    for (const item of extraCostArrays.flat()) {
      if (!item.STEM__c) continue;
      if (!extraCostsByStem[item.STEM__c]) extraCostsByStem[item.STEM__c] = [];
      extraCostsByStem[item.STEM__c].push(item);
    }
    for (const invoice of supplierInvoiceArrays.flat()) {
      if (!invoice.STEM__c) continue;
      if (!supplierInvoicesByStem[invoice.STEM__c]) supplierInvoicesByStem[invoice.STEM__c] = [];
      supplierInvoicesByStem[invoice.STEM__c].push(invoice);
      if (supplierInvoicePayableField == null) continue;
      supplierInvoicePayableByStem[invoice.STEM__c] = (supplierInvoicePayableByStem[invoice.STEM__c] || 0) + Number(invoice[supplierInvoicePayableField] || 0);
    }

    const supplierInvoiceIds = supplierInvoiceArrays
      .flat()
      .map((invoice) => invoice.Id)
      .filter(isSalesforceId);
    if (supplierInvoiceIds.length && supplierSettlementSchema.paymentSupplierInvoiceFields.length && supplierSettlementSchema.paymentAmountField) {
      const paymentSelectFields = ['Id', paymentFieldNames.has('Name') ? 'Name' : null, paymentFieldNames.has('CreatedDate') ? 'CreatedDate' : null, paymentFieldNames.has('CurrencyIsoCode') ? 'CurrencyIsoCode' : null, supplierSettlementSchema.paymentAmountField, supplierSettlementSchema.paymentDateField, ...supplierSettlementSchema.paymentSupplierInvoiceFields, ...supplierSettlementSchema.paymentStatusFields].filter(Boolean);
      await Promise.all(
        supplierSettlementSchema.paymentSupplierInvoiceFields.map(async (lookupField) => {
          const paymentChunks = await compositeQueryRows(
            chunkIds(supplierInvoiceIds).map((chunk) => {
              const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
              return {
                soql: `
            SELECT ${[...new Set(paymentSelectFields)].join(', ')}
            FROM Payment__c
            WHERE ${lookupField} IN (${inList})
            ORDER BY ${supplierSettlementSchema.paymentDateField || 'CreatedDate'} DESC NULLS LAST
            LIMIT 5000
          `,
                limit: 5000,
                softFail: true,
              };
            }),
          );
          for (const payment of paymentChunks.flat()) {
            if (!validSupplierSettlementPayment(payment, supplierSettlementSchema.paymentStatusFields)) continue;
            const invoiceId = payment[lookupField];
            if (!isSalesforceId(invoiceId)) continue;
            if (!supplierPaymentsByInvoice[invoiceId]) supplierPaymentsByInvoice[invoiceId] = [];
            if (supplierPaymentsByInvoice[invoiceId].some((existing) => existing.id === payment.Id)) continue;
            supplierPaymentsByInvoice[invoiceId].push({
              id: payment.Id,
              name: payment.Name || payment.Id,
              amount: Number(payment[supplierSettlementSchema.paymentAmountField] || 0),
              date: payment[supplierSettlementSchema.paymentDateField] || payment.CreatedDate || null,
              currencyIsoCode: payment.CurrencyIsoCode || 'USD',
              status: supplierSettlementSchema.paymentStatusFields.map((field) => payment[field]).find(Boolean) || null,
            });
          }
        }),
      );
    }
  }

  return {
    rows: rows
      .filter((stem) => !hasDisputeStatus || !['no dispute', 'no disputes'].includes(String(stem.Dispute_Status__c || '').toLowerCase()))
      .map((stem) => {
        const stemHasDelivery = !!stem.Delivery_Date__c;
        const lineItems = lineItemsByStem[stem.Id] || [];
        const extraCosts = extraCostsByStem[stem.Id] || [];
        const supplierInvoices = supplierInvoicesByStem[stem.Id] || [];
        const supplierNames = new Set();
        const productNames = new Set();
        const supplierProductPairs = [];
        const supplierProductPairKeys = new Set();
        const supplierInvoiceProductRowsById = new Map();
        const uninvoicedExtraCostProductRows = [];
        const supplierLineBuyByAccount = new Map();
        const uninvoicedSupplierLineBuyByAccount = new Map();
        let lineSellTotal = 0;
        let supplierLineBuy = 0;
        let uninvoicedSupplierLineBuy = 0;
        let extraSellTotal = 0;
        let extraCostBuy = 0;
        let invoicedExtraCostBuy = 0;
        let sellOnlyExtraSell = 0;
        let hasSupplierInvoice = false;

        for (const item of lineItems) {
          if (item.Cancelled__c) continue;
          const originalSupplierInactive = item[originalSupplierRelationship]?.Inactive_Suspended__c === true;
          const originalSupplierAccountId = originalSupplierInactive ? null : item.Original_Supplier__c || null;
          const originalSupplierAccountKey = disputeSalesforceIdKey(originalSupplierAccountId);
          const originalSupplierName = originalSupplierInactive ? null : item[originalSupplierRelationship]?.Name || item.Supplier_Name__c || originalSupplierAccountId || null;
          if (originalSupplierName) supplierNames.add(originalSupplierName);
          const productName = item['Product__r']?.Name;
          if (productName) productNames.add(productName);
          const quantityLabel = lineItemQuantityLabel(item, stemHasDelivery);
          if (item.Supplier_Invoice__c) {
            const invoiceRows = supplierInvoiceProductRowsById.get(item.Supplier_Invoice__c) || [];
            invoiceRows.push({
              productName: productName || item.Name || 'Product',
              quantityLabel,
              supplierName: originalSupplierName,
              supplierAccountId: originalSupplierAccountId,
              paymentTerm: item.Payment_Term__c || null,
            });
            supplierInvoiceProductRowsById.set(item.Supplier_Invoice__c, invoiceRows);
          }
          if (originalSupplierName || productName) {
            const pairKey = `${originalSupplierAccountKey || originalSupplierName || ''}\u0000${productName || ''}`;
            if (!supplierProductPairKeys.has(pairKey)) {
              supplierProductPairKeys.add(pairKey);
              supplierProductPairs.push({
                supplierName: originalSupplierName,
                supplierAccountId: originalSupplierAccountId,
                productName: productName || null,
              });
            }
          }
          lineSellTotal += lineSellAmount(item, stemHasDelivery);
          const buy = lineBuyAmount(item, stemHasDelivery);
          supplierLineBuy += buy;
          if (originalSupplierAccountKey) {
            const supplierLine = supplierLineBuyByAccount.get(originalSupplierAccountKey) || {
              accountId: originalSupplierAccountId,
              supplierName: originalSupplierName,
              amount: 0,
            };
            supplierLine.amount += buy;
            supplierLineBuyByAccount.set(originalSupplierAccountKey, supplierLine);
          }
          if (item.Supplier_Invoice__c) {
            hasSupplierInvoice = true;
          } else {
            uninvoicedSupplierLineBuy += buy;
            if (originalSupplierAccountKey) {
              const supplierLine = uninvoicedSupplierLineBuyByAccount.get(originalSupplierAccountKey) || {
                accountId: originalSupplierAccountId,
                supplierName: originalSupplierName,
                amount: 0,
              };
              supplierLine.amount += buy;
              uninvoicedSupplierLineBuyByAccount.set(originalSupplierAccountKey, supplierLine);
            }
          }
        }

        for (const item of extraCosts) {
          if (item.Cancelled__c) continue;
          const productName = disputeQueueExtraCostProductName(item);
          const supplierInactive = extraCostSupplierRelationship && item[extraCostSupplierRelationship]?.Inactive_Suspended__c === true;
          const supplierAccountId = supplierInactive ? null : extraCostSupplierField ? item[extraCostSupplierField] : null;
          const supplierAccountKey = disputeSalesforceIdKey(supplierAccountId);
          const supplierName = supplierInactive ? null : (extraCostSupplierRelationship ? item[extraCostSupplierRelationship]?.Name : null) || item.Supplier_Name__c || supplierAccountId || null;
          if (productName) productNames.add(productName);
          if (supplierName || productName) {
            const pairKey = `${supplierAccountKey || supplierName || ''}\u0000${productName || ''}`;
            if (!supplierProductPairKeys.has(pairKey)) {
              supplierProductPairKeys.add(pairKey);
              supplierProductPairs.push({
                supplierName,
                supplierAccountId,
                productName,
              });
            }
          }
          if (productName) {
            const productRow = {
              productName,
              quantityLabel: null,
              supplierName,
              supplierAccountId,
              paymentTerm: item.Payment_Term__c || null,
              sourceType: 'extra_cost',
              sourceRecordId: item.Id,
            };
            if (item.Supplier_Invoice__c) {
              const invoiceRows = supplierInvoiceProductRowsById.get(item.Supplier_Invoice__c) || [];
              invoiceRows.push(productRow);
              supplierInvoiceProductRowsById.set(item.Supplier_Invoice__c, invoiceRows);
            } else {
              uninvoicedExtraCostProductRows.push({
                supplierInvoiceId: null,
                invoiceName: null,
                ...productRow,
                dueDate: null,
                productQuantityLabel: [productRow.productName, productRow.quantityLabel].filter(Boolean).join(' - '),
              });
            }
          }
          const buy = extraBuyAmount(item, stemHasDelivery);
          const sell = extraSellAmount(item, stemHasDelivery);
          extraSellTotal += sell;
          if (item.Supplier_Invoice__c) {
            invoicedExtraCostBuy += buy;
          } else {
            extraCostBuy += buy;
            if (buy === 0 && sell > 0) sellOnlyExtraSell += sell;
          }
        }

        const supplierBase = Number(stem.Total_Invoiced_Amount_From_Suppliers__c || 0) + (hasSupplierInvoice ? uninvoicedSupplierLineBuy : supplierLineBuy);
        const rawSupplier = supplierBase + extraCostBuy;
        const unmatchedSellOnlyExtra = hasSupplierInvoice ? Math.max(0, sellOnlyExtraSell - invoicedExtraCostBuy) : 0;
        const qlikSupplierCost = stem.QLIK_STEM_Line_Item_Total_Cost__c != null || stem.QLIK_Costs_Total_Cost__c != null ? (stem.QLIK_STEM_Line_Item_Total_Cost__c || 0) + (stem.QLIK_Costs_Total_Cost__c || 0) : null;
        const supplierOverstatement = qlikSupplierCost == null ? 0 : rawSupplier - qlikSupplierCost;
        const calculatedSupplierInvoice = unmatchedSellOnlyExtra > 0 && supplierOverstatement > 0 && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05 ? qlikSupplierCost : rawSupplier;
        const calculatedBuyerInvoice = lineSellTotal + extraSellTotal;
        const buyerInvoiceResolution = resolveBuyerFinancialAmount({ salesforceAmount: stem.Total_Invoice_Amount__c, calculatedAmount: calculatedBuyerInvoice, finalInvoiceIssued: finalBuyerInvoiceStemIds.has(stem.Id) });
        const buyerInvoiceAmount = buyerInvoiceResolution.amount;
        const stemBasePnl = buyerInvoiceAmount == null ? null : Number(buyerInvoiceAmount || 0) - Number(calculatedSupplierInvoice || 0);
        const supplierInvoicePayable = supplierInvoicePayableByStem[stem.Id];
        const payableBalance = stem.Payable_Balance__c ?? (supplierInvoicePayable != null ? supplierInvoicePayable : null);
        const supplierFinanceByAccount = new Map();
        const supplierInvoiceDueRows = [];
        const supplierInvoiceExposureRows = [];
        const addSupplierFinanceByAccount = (accountId, supplierName, invoiceAmount = 0, supplierPayableBalance = 0) => {
          const accountKey = disputeSalesforceIdKey(accountId);
          if (!accountKey) return;
          const current = supplierFinanceByAccount.get(accountKey) || {
            accountId,
            accountKey,
            supplierName: supplierName || accountId,
            supplierInvoiceAmount: 0,
            payableBalance: 0,
          };
          current.supplierInvoiceAmount += Number(invoiceAmount || 0);
          current.payableBalance += Number(supplierPayableBalance || 0);
          supplierFinanceByAccount.set(accountKey, current);
        };
        for (const invoice of supplierInvoices) {
          const supplierAccountField = supplierInvoiceSupplierFields.find((field) => invoice[field]);
          const supplierAccountRelationship = supplierAccountField ? supplierInvoiceFieldByName[supplierAccountField]?.relationshipName : null;
          const supplierAccountInactive = supplierAccountRelationship && invoice[supplierAccountRelationship]?.Inactive_Suspended__c === true;
          const supplierAccountId = supplierAccountInactive ? null : supplierAccountField ? invoice[supplierAccountField] : null;
          const supplierName = supplierAccountInactive ? null : (supplierAccountRelationship ? invoice[supplierAccountRelationship]?.Name : null) || invoice['Supplier__r']?.Name || invoice.Supplier_Name__c || invoice['Expected_Supplier__r']?.Name || invoice['Substitute_Supplier__r']?.Name || supplierInvoiceSupplierNameRelationships.map((relationship) => invoice[relationship]?.Name).find(Boolean) || null;
          const invoiceAmountField = supplierInvoiceAmountFields.find((field) => invoice[field] != null);
          const invoiceAmount = invoiceAmountField ? Number(invoice[invoiceAmountField] || 0) : 0;
          const supplierPayableBalanceValue = supplierInvoicePayableField ? invoice[supplierInvoicePayableField] : null;
          const supplierPayableBalanceAvailable = supplierPayableBalanceValue != null && supplierPayableBalanceValue !== '' && Number.isFinite(Number(supplierPayableBalanceValue));
          const supplierPayableBalance = supplierPayableBalanceAvailable ? Number(supplierPayableBalanceValue) : 0;
          addSupplierFinanceByAccount(supplierAccountId, supplierName, invoiceAmount, supplierPayableBalance);
          const dueDateField = supplierInvoiceDueDateFields.find((field) => invoice[field]);
          const dueDate = dueDateField ? invoice[dueDateField] : null;
          const invoiceDateField = supplierInvoiceDateFields.find((field) => invoice[field]);
          const invoiceDate = invoiceDateField ? invoice[invoiceDateField] : invoice.CreatedDate || null;
          const invoiceStatus = supplierInvoiceStatusFields.map((field) => invoice[field]).find(Boolean) || null;
          const paymentRows = supplierPaymentsByInvoice[invoice.Id] || [];
          const positivePayments = paymentRows.filter((payment) => Number(payment.amount) > 0).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
          const supplierRefunds = Math.abs(paymentRows.filter((payment) => Number(payment.amount) < 0).reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
          const exposure = normalizeSupplierInvoiceExposure({
            supplierInvoiceId: invoice.Id,
            invoiceName: invoice.Name,
            sourceStemId: stem.Id,
            supplierAccountId,
            supplierName,
            currencyIsoCode: invoice.CurrencyIsoCode || 'USD',
            dueDate,
            invoiceDate,
            createdDate: invoice.CreatedDate || null,
            invoiceAmount,
            payableBalance: supplierPayableBalance,
            payableBalanceAvailable: supplierPayableBalanceAvailable,
            status: invoiceStatus,
            payments: paymentRows,
          });
          const netPaymentAudit = positivePayments - supplierRefunds;
          const expectedPaid = Math.max(0, exposure.invoiceAmount - exposure.payableBalance);
          const exposureWarnings = [...exposure.warnings];
          if (!disputeSalesforceIdKey(supplierAccountId)) {
            exposureWarnings.push('Supplier invoice has no valid supplier Account lookup.');
          }
          if (paymentRows.length && Math.abs(expectedPaid - netPaymentAudit) > 0.05) {
            exposureWarnings.push('Payment records do not reconcile to the current payable balance; Finance confirmation is required.');
          }
          supplierInvoiceExposureRows.push({
            ...exposure,
            payments: paymentRows,
            positivePayments,
            supplierRefunds,
            netPaymentAudit,
            status: invoiceStatus,
            warnings: [...new Set(exposureWarnings)],
          });
          const productRows = supplierInvoiceProductRowsById.get(invoice.Id) || [];
          if (productRows.length) {
            for (const productRow of productRows) {
              supplierInvoiceDueRows.push({
                supplierInvoiceId: invoice.Id || null,
                invoiceName: invoice.Name || null,
                supplierName: productRow.supplierName || supplierName,
                supplierAccountId: productRow.supplierAccountId || supplierAccountId,
                paymentTerm: productRow.paymentTerm || null,
                dueDate,
                productName: productRow.productName,
                quantityLabel: productRow.quantityLabel,
                productQuantityLabel: [productRow.productName, productRow.quantityLabel].filter(Boolean).join(' - '),
              });
            }
          } else {
            supplierInvoiceDueRows.push({
              supplierInvoiceId: invoice.Id || null,
              invoiceName: invoice.Name || null,
              supplierName,
              supplierAccountId,
              paymentTerm: null,
              dueDate,
              productName: null,
              quantityLabel: null,
              productQuantityLabel: null,
            });
          }
        }
        supplierInvoiceDueRows.push(...uninvoicedExtraCostProductRows);
        const supplierPaymentDueDatesByAccount = new Map();
        for (const dueRow of supplierInvoiceDueRows) {
          const accountKey = disputeSalesforceIdKey(dueRow.supplierAccountId);
          if (!accountKey || !dueRow.dueDate) continue;
          const dueDates = supplierPaymentDueDatesByAccount.get(accountKey) || new Set();
          dueDates.add(dueRow.dueDate);
          supplierPaymentDueDatesByAccount.set(accountKey, dueDates);
        }
        const paymentDueDatesForAccount = (accountKey) => [...(supplierPaymentDueDatesByAccount.get(accountKey) || [])].sort();
        const supplementalLineBuyByAccount = hasSupplierInvoice || supplierInvoices.length ? uninvoicedSupplierLineBuyByAccount : supplierLineBuyByAccount;
        for (const supplierLine of supplementalLineBuyByAccount.values()) {
          addSupplierFinanceByAccount(supplierLine.accountId, supplierLine.supplierName, supplierLine.amount, 0);
        }
        const disputePartyRegistry = buildDisputePartyRegistry({
          stem,
          lineItems,
          extraCosts,
          originalSupplierRelationship,
          extraCostSupplierField,
          extraCostSupplierRelationship,
          schemaIssues: [originalSupplierLookup.issue, extraCostSupplierLookup.issue],
        });
        const supplierCandidateRows = disputePartyRegistry.suppliers.map((party) => {
          const finance = supplierFinanceByAccount.get(party.accountKey);
          const paymentDueDates = paymentDueDatesForAccount(party.accountKey);
          const invoices = supplierInvoiceExposureRows.filter((invoice) => disputeSalesforceIdKey(invoice.supplierAccountId) === party.accountKey);
          return {
            ...party,
            supplierName: party.name,
            status: null,
            description: null,
            supplierInvoiceAmount: finance?.supplierInvoiceAmount ?? null,
            paymentDueDate: paymentDueDates[0] || null,
            paymentDueDates,
            payableBalance: finance?.payableBalance ?? null,
            invoices,
          };
        });
        const disputedSupplierKeys = new Set(disputePartyRegistry.suppliers.map((party) => party.accountKey));
        const supplierFinanceOnlyRows = [...supplierFinanceByAccount.values()]
          .filter((finance) => !disputedSupplierKeys.has(finance.accountKey))
          .map((finance) => {
            const paymentDueDates = paymentDueDatesForAccount(finance.accountKey);
            return {
              accountId: finance.accountId,
              accountKey: finance.accountKey,
              supplierName: finance.supplierName,
              status: null,
              supplierInvoiceAmount: finance.supplierInvoiceAmount,
              paymentDueDate: paymentDueDates[0] || null,
              paymentDueDates,
              payableBalance: finance.payableBalance,
              invoices: supplierInvoiceExposureRows.filter((invoice) => disputeSalesforceIdKey(invoice.supplierAccountId) === finance.accountKey),
            };
          });
        const supplierFinanceRowsAll = [...supplierCandidateRows, ...supplierFinanceOnlyRows];
        const supplierFinanceRows = supplierCandidateRows.length ? supplierCandidateRows : supplierFinanceOnlyRows;
        const buyerFinanceRow = {
          buyerName: disputePartyRegistry.buyer?.name || (stem.Account__r?.Inactive_Suspended__c === true ? 'Account unavailable' : stem.Buyer_Name__c || stem['Account__r']?.Name || stem.Buyer__c || null),
          buyerInvoiceAmount: buyerInvoiceAmount ?? null,
          buyerInvoiceAmountSource: buyerInvoiceResolution.source,
          paymentDueDate: stem.Invoice_Due_Date__c || stem.Due_Date__c || stem.Buyer_Pay_Term_Date__c || null,
          receivableBalance: stem.Receivable_Balance__c ?? null,
          disputeRows: [],
          status: null,
          description: null,
        };

        return {
          ...stem,
          ...(stem.Account__r?.Inactive_Suspended__c === true ? { Account__r: null, Account__c: null } : {}),
          Total_Invoice_Amount__c: buyerInvoiceAmount ?? stem.Total_Invoice_Amount__c ?? null,
          Total_Invoiced_Amount_From_Suppliers__c: calculatedSupplierInvoice || stem.Total_Invoiced_Amount_From_Suppliers__c || null,
          _Supplier_Names: [...supplierNames].sort().join(', ') || null,
          _Product_Names: [...productNames].sort().join(', ') || null,
          _Supplier_Product_Pairs: supplierProductPairs,
          _Buyer_Disputes: [],
          _Buyer_Dispute_Rows: [],
          _Buyer_Finance_Row: buyerFinanceRow,
          _Supplier_Disputes: [],
          _Supplier_Dispute_Rows: supplierFinanceRows,
          _Supplier_Finance_Rows_All: supplierFinanceRowsAll,
          _Dispute_Parties: disputePartyRegistry,
          _Buyer_Invoice_Due_Date: stem.Invoice_Due_Date__c || stem.Due_Date__c || stem.Buyer_Pay_Term_Date__c || null,
          _Supplier_Invoice_Due_Rows: supplierInvoiceDueRows,
          _Supplier_Invoice_Exposure_Rows: supplierInvoiceExposureRows,
          _Supplier_Settlement_Schema: supplierSettlementSchema,
          _Stem_Base_Pnl: stemBasePnl,
          _Buyer_Dispute_Label: null,
          _Supplier_Dispute_Label: null,
          _Supplier_Invoice_Split_Label: supplierFinanceRows.map((dispute) => dispute.supplierInvoiceAmount).join('\n') || null,
          _Payable_Balance_Split_Label: supplierFinanceRows.map((dispute) => dispute.payableBalance).join('\n') || null,
          _Payable_Balance: payableBalance,
          _Display_Name: formatStemName(stem),
          _Buyer_Name: stem.Account__r?.Inactive_Suspended__c === true ? 'Account unavailable' : stem.Buyer_Name__c || stem['Account__r']?.Name || stem.Buyer__c || null,
          _Effective_Date: stem.Delivery_Date__c || stem.Expected_Delivery_Date__c || null,
        };
      }),
  };
}

function serializeDisputeWorkflowParty(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id || row.caseId,
    stemId: row.stem_id || row.stemId,
    accountId: row.account_id || row.accountId,
    accountKey: row.account_key || row.accountKey,
    name: row.account_name || row.name || row.account_id || row.accountId,
    roles: Array.isArray(row.roles) ? row.roles : [],
    sourceTypes: Array.isArray(row.source_types) ? row.source_types : row.sourceTypes || [],
    sourceRecordIds: Array.isArray(row.source_record_ids) ? row.source_record_ids : row.sourceRecordIds || [],
    paymentTerms: Array.isArray(row.payment_terms) ? row.payment_terms : row.paymentTerms || [],
    products: Array.isArray(row.products) ? row.products : [],
    cancelledSourceOnly: row.cancelled_source_only === true || row.cancelledSourceOnly === true,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function disputeRegistryWithSelection(registry, partyRows = []) {
  const selected = [];
  const issues = [...(registry?.issues || [])];
  const candidateByKey = new Map((registry?.candidates || []).map((candidate) => [candidate.accountKey, candidate]));
  for (const row of partyRows) {
    const stored = serializeDisputeWorkflowParty(row);
    const candidate = candidateByKey.get(stored.accountKey);
    if (!candidate) {
      issues.push({
        code: 'selected_account_stale',
        message: `${stored.name} is no longer the buyer or a supplier on this STEM.`,
        recordIds: stored.sourceRecordIds,
        details: { accountId: stored.accountId },
      });
      continue;
    }
    selected.push({
      ...candidate,
      id: stored.id,
      caseId: stored.caseId,
      selected: true,
    });
  }
  const candidateSchemaValid = registry?.candidateSchemaValid === true;
  const selectionValid = selected.length > 0 && !issues.some((item) => item.code === 'selected_account_stale');
  return {
    ...registry,
    candidateSchemaValid,
    selectionValid,
    valid: candidateSchemaValid && selectionValid,
    selected,
    issues,
  };
}

function assertValidDisputeParties(stem, partyRows = []) {
  const registry = disputeRegistryWithSelection(stem?._Dispute_Parties, partyRows);
  if (!stem?._Dispute_Parties) throw appError('Salesforce dispute party candidates could not be resolved.', 502);
  if (registry.valid) return registry;
  const messages = registry.issues.map((item) => item.message).filter(Boolean);
  if (!registry.selectionValid && !messages.length) messages.push('Select at least one disputed Account.');
  throw appError(`Correct the dispute party selection before continuing: ${messages.join(' ')}`, 400);
}

async function loadCurrentDisputeStem(stemId, accessContext) {
  const result = await salesforceDisputeStems({ stemId, limit: 100 }, null, accessContext);
  const stem = (result.rows || []).find((row) => disputeSalesforceIdKey(row.Id) === disputeSalesforceIdKey(stemId));
  if (!stem) throw appError('The disputed stem could not be found in the current Salesforce dispute queue.', 404);
  return stem;
}

function canonicalDisputeActionTarget(input, partySide, registry) {
  const accountId = String(input.partyAccountId || input.party_account_id || '').trim();
  if (!accountId) throw appError('A Salesforce party Account ID is required for every dispute action.', 400);
  const candidate = findDisputeParty(registry, partySide, accountId);
  const party = (registry?.selected || []).find((selected) => selected.accountKey === candidate?.accountKey);
  if (!candidate || !party) throw appError(`The selected ${partySide} Account is not selected for this dispute. Refresh and select the party again.`, 400);
  return party;
}

function normalizeDisputeBetaStatus(value, allowed, fallback) {
  const raw = String(value || '').trim();
  return allowed.includes(raw) ? raw : fallback;
}

async function disputeWorkflowCapabilities(client, profile = {}) {
  const [isApprover, isAccounting] = await Promise.all([userHasCapability(client, profile, 'disputes_approve'), userHasCapability(client, profile, 'disputes_account')]);
  const canAcceptExternalClosure = profile.user_type === 'administrator'
    || (profile.user_type === 'general_manager' && (await loadActiveGeneralManager(client)).id === profile.id);
  return {
    role: profile.user_type || 'user',
    canPrepare: true,
    canApprove: isApprover,
    canAccount: isAccounting,
    canClose: isAccounting,
    canAcceptExternalClosure,
    canViewAllRules: true,
  };
}

function disputeBetaCaseFromStem(stem = {}) {
  return {
    stem_id: stem.Id,
    stem_name: stem._Display_Name || stem.Name || stem.KeyStem__c || stem.Id,
    buyer_name: stem._Buyer_Name || stem.Buyer_Name__c || null,
    supplier_names: stem._Supplier_Names || null,
    current_salesforce_status: stem.Dispute_Status__c || null,
  };
}

function legacyClosedDisputeCase(stem = {}) {
  const salesforceStatus = String(stem.Dispute_Status__c || '').trim();
  if (!isSalesforceDisputeClosed(salesforceStatus)) return null;
  return {
    id: null,
    stemId: stem.Id,
    stemName: stem._Display_Name || stem.Name || stem.KeyStem__c || stem.Id,
    buyerName: stem._Buyer_Name || stem.Buyer_Name__c || '',
    supplierNames: stem._Supplier_Names || '',
    currentSalesforceStatus: salesforceStatus,
    workflowStatus: 'Closed',
    approvalStatus: 'Approved',
    latestNote: 'Closed in Salesforce before FCOS workflow tracking.',
    settlementFinancials: {},
    settlementPnl: 0,
    salesforceWritebackStatus: 'legacy',
    legacyReadOnly: true,
  };
}

function serializeDisputeBetaCase(row) {
  if (!row) return null;
  return {
    id: row.id,
    stemId: row.stem_id,
    stemName: row.stem_name || '',
    buyerName: row.buyer_name || '',
    supplierNames: row.supplier_names || '',
    currentSalesforceStatus: row.current_salesforce_status || '',
    workflowStatus: row.workflow_status || 'Draft',
    approvalStatus: row.approval_status || 'Draft',
    latestNote: row.latest_note || '',
    submittedBy: row.submitted_by || null,
    submittedByEmail: row.submitted_by_email || null,
    submittedAt: row.submitted_at || null,
    approvedBy: row.approved_by || null,
    approvedByEmail: row.approved_by_email || null,
    approvedAt: row.approved_at || null,
    rejectedBy: row.rejected_by || null,
    rejectedByEmail: row.rejected_by_email || null,
    rejectedAt: row.rejected_at || null,
    rejectionReason: row.rejection_reason || null,
    closedBy: row.closed_by || null,
    closedByEmail: row.closed_by_email || null,
    closedAt: row.closed_at || null,
    settlementFinancials: row.settlement_financials || {},
    settlementPnl: Number(row.settlement_pnl || 0),
    salesforceWritebackStatus: row.salesforce_writeback_status || 'not_started',
    salesforceWritebackError: row.salesforce_writeback_error || null,
    externalClosureDetectedAt: row.external_closure_detected_at || null,
    externalClosureSalesforceStatus: row.external_closure_salesforce_status || null,
    externalClosureSalesforceModifiedAt: row.external_closure_salesforce_modified_at || null,
    externalClosureAcceptedAt: row.external_closure_accepted_at || null,
    externalClosureAcceptedBy: row.external_closure_accepted_by || null,
    externalClosureAcceptedByEmail: row.external_closure_accepted_by_email || null,
    externalClosureAcceptanceReason: row.external_closure_acceptance_reason || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeDisputeSupplierInstruction(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    actionId: row.action_id,
    partyId: row.party_id,
    stemId: row.stem_id,
    instructionType: row.instruction_type,
    instructionLabel: row.instruction_type === 'withhold_unpaid' ? 'Do not pay' : 'Get back paid amount',
    recoveryMethod: row.recovery_method || null,
    sourceSupplierInvoiceId: row.source_supplier_invoice_id,
    sourceSupplierInvoiceName: row.source_supplier_invoice_name || '',
    sourceStemId: row.source_stem_id || row.stem_id,
    targetSupplierInvoiceId: row.target_supplier_invoice_id || null,
    targetSupplierInvoiceName: row.target_supplier_invoice_name || '',
    targetStemId: row.target_stem_id || null,
    currencyIsoCode: row.currency_iso_code || 'USD',
    plannedAmount: Number(row.planned_amount || 0),
    allocatedAmount: Number(row.allocated_amount || 0),
    sourceInvoiceAmountSnapshot: Number(row.source_invoice_amount_snapshot || 0),
    sourcePayableBalanceSnapshot: Number(row.source_payable_balance_snapshot || 0),
    sourcePaidAmountSnapshot: Number(row.source_paid_amount_snapshot || 0),
    targetInvoiceAmountSnapshot: row.target_invoice_amount_snapshot == null ? null : Number(row.target_invoice_amount_snapshot),
    targetPayableAmountSnapshot: row.target_payable_amount_snapshot == null ? null : Number(row.target_payable_amount_snapshot),
    sourceInvoiceSnapshot: row.source_invoice_snapshot || {},
    sourceStemSnapshot: row.source_stem_snapshot || {},
    targetInvoiceSnapshot: row.target_invoice_snapshot || {},
    targetStemSnapshot: row.target_stem_snapshot || {},
    paymentSnapshot: row.payment_snapshot || {},
    allocationFingerprint: row.allocation_fingerprint || '',
    status: row.status || 'Pending Accounting',
    matchedSalesforcePaymentId: row.matched_salesforce_payment_id || null,
    matchingPaymentSnapshot: row.matching_payment_snapshot || {},
    instructionReference: row.instruction_reference || '',
    instructionDate: row.instruction_date || null,
    instructionAmount: row.instruction_amount == null ? null : Number(row.instruction_amount),
    settlementReference: row.settlement_reference || '',
    settlementDate: row.settlement_date || null,
    settlementAmount: row.settlement_amount == null ? null : Number(row.settlement_amount),
    accountingNote: row.accounting_note || '',
    revision: Number(row.revision || 1),
    acknowledgedBy: row.acknowledged_by || null,
    acknowledgedByEmail: row.acknowledged_by_email || null,
    acknowledgedAt: row.acknowledged_at || null,
    settledBy: row.settled_by || null,
    settledByEmail: row.settled_by_email || null,
    settledAt: row.settled_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeDisputeBetaAction(row, partyMap = new Map(), instructionRows = []) {
  if (!row) return null;
  const party = partyMap.get(row.party_id) || null;
  const actionType = row.action_type;
  const supplierInstructions = instructionRows.filter((instruction) => instruction.action_id === row.id && instruction.status !== 'Superseded').map(serializeDisputeSupplierInstruction);
  const invoiceAllocationMap = new Map();
  for (const instruction of supplierInstructions) {
    const existing = invoiceAllocationMap.get(instruction.sourceSupplierInvoiceId) || {
      supplierInvoiceId: instruction.sourceSupplierInvoiceId,
      invoiceName: instruction.sourceSupplierInvoiceName,
      amount: instruction.allocatedAmount,
    };
    existing.amount = Math.max(existing.amount, instruction.allocatedAmount);
    invoiceAllocationMap.set(instruction.sourceSupplierInvoiceId, existing);
  }
  const closeReason = actionType === 'close_supplier_dispute' ? canonicalDisputeBetaCloseReason(row.close_reason, DISPUTE_BETA_SUPPLIER_CLOSE_REASONS) : actionType === 'close_buyer_dispute' ? canonicalDisputeBetaCloseReason(row.close_reason, DISPUTE_BETA_BUYER_CLOSE_REASONS) : row.close_reason;
  return {
    id: row.id,
    caseId: row.case_id,
    stemId: row.stem_id,
    partyId: row.party_id,
    partySide: row.party_side,
    partyType: row.party_side,
    partyName: party?.account_name || party?.name || '',
    partyAccountId: party?.account_id || party?.accountId || null,
    partyKey: party?.account_id ? `account:${party.account_id}` : party?.accountId ? `account:${party.accountId}` : null,
    partyRoles: party?.roles || [],
    actionType,
    actionLabel: DISPUTE_BETA_ACTION_LABELS[actionType] || row.action_label || actionType,
    amount: row.amount == null ? null : Number(row.amount),
    disputeAmount: row.amount == null ? null : Number(row.amount),
    currencyIsoCode: supplierInstructions[0]?.currencyIsoCode || 'USD',
    invoiceAllocations: [...invoiceAllocationMap.values()],
    supplierInstructions,
    totalDoNotPay: supplierInstructions.filter((instruction) => instruction.instructionType === 'withhold_unpaid').reduce((sum, instruction) => sum + instruction.plannedAmount, 0),
    totalGetBackPaid: supplierInstructions.filter((instruction) => instruction.instructionType === 'get_back_paid').reduce((sum, instruction) => sum + instruction.plannedAmount, 0),
    supplierDisputeAmountRequired: row.party_side === 'supplier' && DISPUTE_LEGACY_SUPPLIER_FINANCIAL_ACTIONS.has(row.action_type) && row.amount == null,
    supplierInstructionConversionRequired: row.party_side === 'supplier' && row.amount != null && DISPUTE_LEGACY_SUPPLIER_FINANCIAL_ACTIONS.has(row.action_type),
    specialSellPrice: row.special_sell_price == null ? null : Number(row.special_sell_price),
    specialBuyPrice: row.special_buy_price == null ? null : Number(row.special_buy_price),
    quantity: row.quantity == null ? null : Number(row.quantity),
    quantityUnit: row.quantity_unit || 'MT',
    closeReason: closeReason || null,
    balancePaymentInstruction: row.balance_payment_instruction || null,
    description: row.description || '',
    requiresAttachment: row.requires_attachment === true,
    accountingStatus: row.execution_status || 'Pending Accounting',
    executionStatus: row.execution_status || 'Pending Accounting',
    instructionReference: row.instruction_reference || '',
    instructionDate: row.instruction_date || null,
    instructionAmount: row.instruction_amount == null ? null : Number(row.instruction_amount),
    settlementReference: row.settlement_reference || '',
    settlementDate: row.settlement_date || null,
    settlementAmount: row.settlement_amount == null ? null : Number(row.settlement_amount),
    accountingNote: row.accounting_note || '',
    accountingBy: row.accounting_by || null,
    accountingByEmail: row.accounting_by_email || null,
    accountingAt: row.accounting_at || null,
    executedBy: row.executed_by || null,
    executedByEmail: row.executed_by_email || null,
    executedAt: row.executed_at || null,
    executionNote: row.execution_note || null,
    linkedAgreedCompensationId: row.linked_agreed_compensation_id || null,
    linkedCompensationSnapshot: row.linked_compensation_snapshot || {},
    linkedCompensationBy: row.linked_compensation_by || null,
    linkedCompensationByEmail: row.linked_compensation_by_email || null,
    linkedCompensationAt: row.linked_compensation_at || null,
    createdBy: row.created_by || null,
    createdByEmail: row.created_by_email || null,
    updatedBy: row.updated_by || null,
    updatedByEmail: row.updated_by_email || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeDisputeWorkflowDocument(row) {
  if (!row) return null;
  const fileName = row.smart_filename || row.original_filename || 'Dispute document';
  const versionId = row.salesforce_content_version_id;
  return {
    id: row.id,
    caseId: row.case_id,
    actionId: row.action_id || null,
    supplierInstructionId: row.supplier_instruction_id || null,
    partyId: row.party_id,
    stemId: row.stem_id,
    partySide: row.party_side,
    partyType: row.party_side,
    partyName: row.party_name || '',
    partyAccountId: row.party_account_id || null,
    documentDirection: row.document_direction,
    documentType: row.document_type,
    originalFileName: row.original_filename,
    requestedFileName: row.requested_filename || fileName,
    fileName,
    smartFileName: fileName,
    contentType: row.content_type || 'application/octet-stream',
    fileExtension: row.file_extension || '',
    contentSize: Number(row.content_size || 0),
    contentVersionId: versionId,
    contentDocumentId: row.salesforce_content_document_id || null,
    linkedRecordId: row.salesforce_linked_record_id,
    linkedRecordIds: row.salesforce_linked_record_id ? [row.salesforce_linked_record_id] : [],
    uploadStatus: row.upload_status || 'complete',
    salesforceUrl: row.salesforce_url || null,
    downloadUrl: `/api/functions/salesforceDocumentDownload?kind=contentVersion&id=${encodeURIComponent(versionId)}&filename=${encodeURIComponent(fileName)}`,
    uploadedBy: row.uploaded_by || null,
    uploadedByEmail: row.uploaded_by_email || null,
    createdAt: row.created_at || null,
  };
}

function serializeDisputeBetaEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    actionId: row.action_id || null,
    stemId: row.stem_id,
    eventType: row.event_type,
    note: row.note || '',
    metadata: row.metadata || {},
    actorUserId: row.actor_user_id || null,
    actorEmail: row.actor_email || null,
    createdAt: row.created_at || null,
  };
}

function disputeBetaActionPartyType(actionType, inputPartyType) {
  if (actionType === 'issue_buyer_credit_note' || actionType === 'close_buyer_dispute') return 'buyer';
  if (actionType === 'hold_supplier_payment' || actionType === 'pay_full_supplier_invoice' || actionType === 'deduct_specific_amount' || actionType === 'resolve_supplier_dispute' || actionType === 'close_supplier_dispute') return 'supplier';
  return String(inputPartyType || '').toLowerCase() === 'buyer' ? 'buyer' : 'supplier';
}

function normalizeDisputeBetaAction(input = {}, caseRow, profile = {}, registry) {
  const actionType = String(input.actionType || input.action_type || '').trim();
  if (!DISPUTE_BETA_ACTION_LABELS[actionType]) throw appError('Valid dispute workflow action type is required.', 400);
  const partySide = disputeBetaActionPartyType(actionType, input.partySide || input.party_side || input.partyType || input.party_type);
  const party = canonicalDisputeActionTarget(input, partySide, registry);
  const amount = decimalOrNull(input.amount);
  if (actionType === 'deduct_specific_amount' && amount == null) throw appError('Deduction amount is required.', 400);
  if (actionType === 'resolve_supplier_dispute' && (amount == null || amount <= 0)) {
    throw appError('Enter an agreed supplier recovery amount above zero, or choose Close dispute with supplier (no recovery).', 400);
  }
  if (actionType === 'issue_buyer_credit_note' && (amount == null || amount <= 0)) {
    throw appError('Enter an agreed buyer credit note amount above zero, or choose Close dispute with buyer (no credit note).', 400);
  }
  const closeReasonInput = String(input.closeReason || input.close_reason || '').trim();
  const closeReason = actionType === 'close_supplier_dispute' ? canonicalDisputeBetaCloseReason(closeReasonInput, DISPUTE_BETA_SUPPLIER_CLOSE_REASONS) : actionType === 'close_buyer_dispute' ? canonicalDisputeBetaCloseReason(closeReasonInput, DISPUTE_BETA_BUYER_CLOSE_REASONS) : closeReasonInput || null;
  if (actionType === 'close_supplier_dispute' && !DISPUTE_BETA_SUPPLIER_CLOSE_REASONS.includes(closeReason)) {
    throw appError('Valid supplier close reason is required.', 400);
  }
  if (actionType === 'close_buyer_dispute' && !DISPUTE_BETA_BUYER_CLOSE_REASONS.includes(closeReason)) {
    throw appError('Valid buyer close reason is required.', 400);
  }
  const balancePaymentInstruction = String(input.balancePaymentInstruction || input.balance_payment_instruction || '').trim() || null;
  if (balancePaymentInstruction && !DISPUTE_BETA_BALANCE_PAYMENT_INSTRUCTIONS.includes(balancePaymentInstruction)) {
    throw appError('Valid balance payment instruction is required.', 400);
  }
  if (actionType === 'close_supplier_dispute' && !balancePaymentInstruction) {
    throw appError('Balance payment instruction is required when closing a supplier dispute without recovery.', 400);
  }
  const currencyIsoCode =
    String(input.currencyIsoCode || input.currency_iso_code || 'USD')
      .trim()
      .toUpperCase() || 'USD';
  if (actionType === 'resolve_supplier_dispute' && !/^[A-Z]{3}$/.test(currencyIsoCode)) {
    throw appError('Supplier dispute currency must be a three-letter ISO code.', 400);
  }

  return {
    stem_id: caseRow.stem_id,
    party_id: party.id,
    party_side: partySide,
    party_account_key: party.accountKey,
    action_type: actionType,
    action_label: DISPUTE_BETA_ACTION_LABELS[actionType],
    amount,
    special_sell_price: decimalOrNull(input.specialSellPrice ?? input.special_sell_price),
    special_buy_price: decimalOrNull(input.specialBuyPrice ?? input.special_buy_price),
    quantity: decimalOrNull(input.quantity),
    quantity_unit: String(input.quantityUnit || input.quantity_unit || 'MT').trim() || 'MT',
    close_reason: closeReason,
    balance_payment_instruction: balancePaymentInstruction,
    description: String(input.description || '').trim(),
    requires_attachment: Boolean(input.requiresAttachment ?? input.requires_attachment),
    execution_status: normalizeDisputeBetaStatus(input.accountingStatus || input.executionStatus || input.execution_status, DISPUTE_BETA_EXECUTION_STATUSES, 'Pending Accounting'),
    currency_iso_code: currencyIsoCode,
    invoice_allocations: Array.isArray(input.invoiceAllocations || input.invoice_allocations) ? input.invoiceAllocations || input.invoice_allocations : [],
    updated_by: profile.id,
    updated_by_email: profile.email,
  };
}

function prepareSupplierSettlementAction(action, currentStem) {
  if (action.action_type !== 'resolve_supplier_dispute') return action;
  const schema = currentStem?._Supplier_Settlement_Schema;
  if (!schema?.valid) {
    throw appError(`Supplier payment automation is unavailable: ${(schema?.issues || ['Salesforce invoice/payment schema is incomplete.']).join(' ')}`, 400);
  }
  const accountKey = disputeSalesforceIdKey(action.party_account_key);
  const invoices = (currentStem?._Supplier_Invoice_Exposure_Rows || []).filter((invoice) => disputeSalesforceIdKey(invoice.supplierAccountId) === accountKey);
  const invalidInvoices = invoices.filter((invoice) => (invoice.warnings || []).some((warning) => /no valid supplier Account lookup|negative|exceeds its invoice amount/i.test(warning)));
  if (invalidInvoices.length) {
    throw appError('Correct the supplier invoice Account or payable balance in Salesforce before saving this supplier resolution.', 400);
  }
  const allocation = allocateSupplierDispute({
    invoices,
    disputeAmount: action.amount,
    currencyIsoCode: action.currency_iso_code,
    invoiceAllocations: action.invoice_allocations,
  });
  return {
    ...action,
    invoice_allocations: allocation.allocations.map((item) => ({
      supplier_invoice_id: item.supplierInvoiceId,
      amount: item.allocatedAmount,
    })),
    supplier_allocation: allocation,
    supplier_instructions: supplierInstructionRows(allocation).map((instruction) => ({
      ...instruction,
      source_stem_id: currentStem.Id,
      source_stem_snapshot: {
        stemId: currentStem.Id,
        stemName: currentStem._Display_Name || currentStem.Name || currentStem.KeyStem__c || '',
        deliveryDate: currentStem.Delivery_Date__c || null,
      },
    })),
  };
}

function calculateDisputeBetaSettlement(actions = []) {
  let buyerImpact = 0;
  let supplierImpact = 0;
  let buyerCreditNoteImpact = 0;
  let supplierCreditNoteImpact = 0;
  const lines = [];

  for (const action of actions) {
    const amount = Number(action.amount ?? action.amount_cents ?? 0) || 0;
    if (action.action_type === 'issue_buyer_credit_note' || action.actionType === 'issue_buyer_credit_note') {
      buyerImpact -= amount;
      lines.push({
        label: action.action_label || action.actionLabel || 'Buyer credit note',
        impact: -amount,
      });
    }
    if (action.action_type === 'deduct_specific_amount' || action.actionType === 'deduct_specific_amount') {
      supplierImpact += amount;
      lines.push({
        label: action.action_label || action.actionLabel || 'Supplier deduction',
        impact: amount,
      });
    }
    if (action.action_type === 'resolve_supplier_dispute' || action.actionType === 'resolve_supplier_dispute') {
      supplierImpact += amount;
      lines.push({
        label: action.action_label || action.actionLabel || 'Supplier dispute resolution',
        impact: amount,
      });
    }

    const buyerCreditNote = Number(action.special_sell_price ?? action.specialSellPrice);
    if (Number.isFinite(buyerCreditNote) && buyerCreditNote > 0) {
      const impact = -buyerCreditNote;
      buyerCreditNoteImpact += impact;
      lines.push({
        label: 'Buyer agreed credit note',
        buyerCreditNote,
        impact,
      });
    }

    const supplierCreditNote = Number(action.special_buy_price ?? action.specialBuyPrice);
    if (Number.isFinite(supplierCreditNote) && supplierCreditNote > 0) {
      const impact = supplierCreditNote;
      supplierCreditNoteImpact += impact;
      lines.push({
        label: 'Supplier agreed credit note',
        supplierCreditNote,
        impact,
      });
    }
  }

  const settlementPnl = buyerImpact + supplierImpact + buyerCreditNoteImpact + supplierCreditNoteImpact;
  return {
    buyerImpact,
    supplierImpact,
    buyerCreditNoteImpact,
    supplierCreditNoteImpact,
    specialPricePnl: buyerCreditNoteImpact + supplierCreditNoteImpact,
    settlementPnl,
    lines,
  };
}

async function loadDisputeBetaWorkflowMap(client, stemIds = []) {
  const ids = [...new Set(stemIds.filter(Boolean))];
  if (!ids.length) return {};
  const [casesRes, partiesRes, actionsRes, instructionsRes, eventsRes, documentsRes] = await Promise.all([
    client.from('dispute_beta_cases').select(DISPUTE_BETA_CASE_SELECT).in('stem_id', ids),
    client.from('dispute_workflow_parties').select(DISPUTE_WORKFLOW_PARTY_SELECT).in('stem_id', ids).order('created_at', { ascending: true }),
    client.from('dispute_beta_actions').select(DISPUTE_BETA_ACTION_SELECT).in('stem_id', ids).order('created_at', { ascending: true }),
    client.from('dispute_workflow_supplier_instructions').select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT).in('stem_id', ids).order('created_at', { ascending: true }),
    client
      .from('dispute_beta_events')
      .select(DISPUTE_BETA_EVENT_SELECT)
      .in('stem_id', ids)
      .order('created_at', { ascending: false })
      .limit(Math.max(100, Math.min(ids.length * 25, 2500))),
    client.from('dispute_workflow_documents').select(DISPUTE_WORKFLOW_DOCUMENT_SELECT).in('stem_id', ids).eq('upload_status', 'complete').order('created_at', { ascending: false }),
  ]);
  if (casesRes.error) throw casesRes.error;
  if (partiesRes.error) throw partiesRes.error;
  if (actionsRes.error) throw actionsRes.error;
  if (instructionsRes.error) throw instructionsRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (documentsRes.error) throw documentsRes.error;

  const map = {};
  for (const row of casesRes.data || []) {
    map[row.stem_id] = {
      case: serializeDisputeBetaCase(row),
      parties: [],
      actions: [],
      supplierInstructions: [],
      events: [],
      documents: [],
    };
  }
  const partyById = new Map();
  for (const row of partiesRes.data || []) {
    partyById.set(row.id, row);
    if (!map[row.stem_id])
      map[row.stem_id] = {
        case: null,
        parties: [],
        actions: [],
        supplierInstructions: [],
        events: [],
        documents: [],
      };
    map[row.stem_id].parties.push(serializeDisputeWorkflowParty(row));
  }
  for (const row of instructionsRes.data || []) {
    if (!map[row.stem_id])
      map[row.stem_id] = {
        case: null,
        parties: [],
        actions: [],
        supplierInstructions: [],
        events: [],
        documents: [],
      };
    map[row.stem_id].supplierInstructions.push(serializeDisputeSupplierInstruction(row));
  }
  for (const row of actionsRes.data || []) {
    if (!map[row.stem_id])
      map[row.stem_id] = {
        case: null,
        parties: [],
        actions: [],
        supplierInstructions: [],
        events: [],
        documents: [],
      };
    map[row.stem_id].actions.push(serializeDisputeBetaAction(row, partyById, instructionsRes.data || []));
  }
  for (const row of eventsRes.data || []) {
    if (!map[row.stem_id])
      map[row.stem_id] = {
        case: null,
        parties: [],
        actions: [],
        supplierInstructions: [],
        events: [],
        documents: [],
      };
    map[row.stem_id].events.push(serializeDisputeBetaEvent(row));
  }
  for (const row of documentsRes.data || []) {
    if (!map[row.stem_id])
      map[row.stem_id] = {
        case: null,
        parties: [],
        actions: [],
        supplierInstructions: [],
        events: [],
        documents: [],
      };
    map[row.stem_id].documents.push(serializeDisputeWorkflowDocument(row));
  }
  return map;
}

async function writeDisputeBetaEvent(client, caseRow, eventType, profile, payload = {}) {
  const { error } = await client.from('dispute_beta_events').insert({
    case_id: caseRow.id,
    action_id: payload.actionId || null,
    stem_id: caseRow.stem_id,
    event_type: eventType,
    note: payload.note || null,
    metadata: payload.metadata || {},
    actor_user_id: profile?.id || null,
    actor_email: profile?.email || null,
  });
  if (error) throw error;
}

function assertSalesforceDisputeIsOpen(stem = {}) {
  if (!isSalesforceDisputeClosed(stem.Dispute_Status__c)) return;
  throw appError(`This dispute is already ${String(stem.Dispute_Status__c).trim()} in Salesforce. Commercial workflow changes are locked; Finance may continue an already approved FCOS accounting workflow.`, 409);
}

function hasUnacceptedExternalDisputeClosure(caseRow, stem) {
  return Boolean(
    caseRow?.id
    && caseRow.workflow_status !== 'Closed'
    && isSalesforceDisputeClosed(stem?.Dispute_Status__c)
    && !hasRecordedFcosClosureWriteback(caseRow),
  );
}

async function recordExternalDisputeClosure(client, caseRow, stem, profile, workflowStatus = null) {
  if (!hasUnacceptedExternalDisputeClosure(caseRow, stem)) return caseRow;
  const firstDetection = !caseRow.external_closure_detected_at;
  const nowIso = new Date().toISOString();
  const salesforceStatus = String(stem.Dispute_Status__c || '').trim();
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      ...(workflowStatus ? { workflow_status: workflowStatus } : {}),
      current_salesforce_status: salesforceStatus,
      salesforce_writeback_status: 'external',
      salesforce_writeback_error: null,
      external_closure_detected_at: caseRow.external_closure_detected_at || nowIso,
      external_closure_salesforce_status: salesforceStatus,
      external_closure_salesforce_modified_at: stem.LastModifiedDate || null,
      updated_at: nowIso,
    })
    .eq('id', caseRow.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  if (firstDetection) {
    await writeDisputeBetaEvent(client, updatedCase, 'external_closure_detected', profile, {
      note: `Salesforce was changed directly to ${salesforceStatus}. FCOS retained the ${updatedCase.workflow_status} accounting stage.`,
      metadata: {
        salesforceStatus,
        salesforceLastModifiedAt: stem.LastModifiedDate || null,
        internalWorkflowStatus: updatedCase.workflow_status,
      },
    });
  }
  return updatedCase;
}

async function persistDisputeAccountingStatus(client, caseRow, stem, profile, workflowStatus) {
  if (hasUnacceptedExternalDisputeClosure(caseRow, stem)) {
    return recordExternalDisputeClosure(client, caseRow, stem, profile, workflowStatus);
  }
  return writeDisputeWorkflowStatusToSalesforce(client, caseRow, profile, workflowStatus);
}

function projectExternallyClosedDisputeWorkflows(stems = [], workflowMap = {}) {
  for (const stem of stems) {
    const workflow = workflowMap[stem.Id];
    const projection = projectExternalDisputeClosure(workflow?.case, stem);
    if (projection) workflow.case = { ...workflow.case, ...projection };
  }
}

async function loadDisputeWorkflowParties(client, caseId) {
  const { data, error } = await client.from('dispute_workflow_parties').select(DISPUTE_WORKFLOW_PARTY_SELECT).eq('case_id', caseId).order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

function disputePartyRowMap(partyRows = []) {
  return new Map(partyRows.map((party) => [party.id, party]));
}

async function loadDisputeWorkflowActions(client, caseId) {
  const [partyRows, actionsResult, instructionsResult] = await Promise.all([loadDisputeWorkflowParties(client, caseId), client.from('dispute_beta_actions').select(DISPUTE_BETA_ACTION_SELECT).eq('case_id', caseId).order('created_at', { ascending: true }), client.from('dispute_workflow_supplier_instructions').select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT).eq('case_id', caseId).order('created_at', { ascending: true })]);
  if (actionsResult.error) throw actionsResult.error;
  if (instructionsResult.error) throw instructionsResult.error;
  const instructionRows = instructionsResult.data || [];
  return {
    partyRows,
    actionRows: actionsResult.data || [],
    instructionRows,
    supplierInstructions: instructionRows.map(serializeDisputeSupplierInstruction),
    actions: (actionsResult.data || []).map((row) => serializeDisputeBetaAction(row, disputePartyRowMap(partyRows), instructionRows)),
  };
}

async function clearInvalidDisputeCompensationLinks(client, caseRow, profile) {
  const workflow = await loadDisputeWorkflowActions(client, caseRow.id);
  const partyMap = disputePartyRowMap(workflow.partyRows);
  const invalid = workflow.actionRows.filter((action) => {
    if (!action.linked_agreed_compensation_id) return false;
    const party = partyMap.get(action.party_id);
    const snapshotAccountId = action.linked_compensation_snapshot?.accountId;
    return !['close_buyer_dispute', 'close_supplier_dispute'].includes(action.action_type)
      || String(action.close_reason || '').trim().toLowerCase() !== 'uoc opened'
      || !party?.account_id
      || snapshotAccountId !== party.account_id;
  });
  for (const action of invalid) {
    const now = new Date().toISOString();
    const { error } = await client.from('dispute_beta_actions').update({
      linked_agreed_compensation_id: null,
      linked_compensation_snapshot: {},
      linked_compensation_by: null,
      linked_compensation_by_email: null,
      linked_compensation_at: null,
      updated_by: profile.id,
      updated_by_email: profile.email,
      updated_at: now,
    }).eq('id', action.id);
    if (error) throw error;
    await writeDisputeBetaEvent(client, caseRow, 'compensation_claim_linked', profile, {
      actionId: action.id,
      note: 'Agreed Compensation claim link cleared because the dispute party or closure reason changed.',
      metadata: { claimRemoved: true },
    });
  }
}

async function assertDisputeUocClaimsReadyForClosure(actions, partyRows) {
  const partyMap = disputePartyRowMap(partyRows);
  for (const action of actions.filter((row) => String(row.close_reason || '').trim().toLowerCase() === 'uoc opened')) {
    const party = partyMap.get(action.party_id);
    if (!action.linked_agreed_compensation_id) {
      throw appError(`${party?.account_name || 'The dispute party'} requires a linked Agreed Compensation claim before final closure.`, 409);
    }
    const snapshot = action.linked_compensation_snapshot || {};
    if (snapshot.linkedWhileOpen !== true || snapshot.accountId !== party?.account_id) {
      throw appError(`${party?.account_name || 'The dispute party'} has an invalid compensation claim link. Remove it and select the correct open claim.`, 409);
    }
    await validateAgreedCompensationClaimLink(action.linked_agreed_compensation_id, party.account_id, { requireOpen: false });
  }
}

function storedSupplierInvoiceAllocations(instructionRows = []) {
  const allocations = new Map();
  for (const instruction of instructionRows.filter((row) => row.status !== 'Superseded')) {
    const id = instruction.source_supplier_invoice_id;
    if (!id) continue;
    allocations.set(id, Math.max(Number(allocations.get(id) || 0), Number(instruction.allocated_amount || 0)));
  }
  return [...allocations].map(([supplierInvoiceId, amount]) => ({
    supplierInvoiceId,
    amount,
  }));
}

function currentSupplierActionAllocation(action, partyRows, instructionRows, currentStem) {
  const party = disputePartyRowMap(partyRows).get(action.party_id);
  if (!party) throw appError('Supplier resolution has no selected Account.', 400);
  const accountKey = disputeSalesforceIdKey(party.account_id);
  const actionInstructions = instructionRows.filter((instruction) => instruction.action_id === action.id && instruction.status !== 'Superseded');
  const currencyIsoCode = actionInstructions[0]?.currency_iso_code || 'USD';
  const invoices = (currentStem?._Supplier_Invoice_Exposure_Rows || []).filter((invoice) => disputeSalesforceIdKey(invoice.supplierAccountId) === accountKey);
  if (!currentStem?._Supplier_Settlement_Schema?.valid) {
    throw appError(`Supplier payment automation is unavailable: ${(currentStem?._Supplier_Settlement_Schema?.issues || []).join(' ')}`, 409);
  }
  return allocateSupplierDispute({
    invoices,
    disputeAmount: action.amount,
    currencyIsoCode,
    invoiceAllocations: storedSupplierInvoiceAllocations(actionInstructions),
  });
}

function supplierInstructionStateChanged(currentRows = [], allocation = {}) {
  const activeRows = currentRows.filter((row) => row.status !== 'Superseded');
  const currentFingerprint = activeRows.map((row) => row.allocation_fingerprint).find(Boolean);
  if (currentFingerprint) return currentFingerprint !== allocation.fingerprint;
  const currentShape = activeRows.map((row) => `${row.source_supplier_invoice_id}:${row.instruction_type}:${Number(row.planned_amount || 0).toFixed(2)}`).sort();
  const nextShape = supplierInstructionRows(allocation)
    .map((row) => `${row.source_supplier_invoice_id}:${row.instruction_type}:${Number(row.planned_amount || 0).toFixed(2)}`)
    .sort();
  return JSON.stringify(currentShape) !== JSON.stringify(nextShape);
}

function assertSupplierAllocationsCurrent(actions, partyRows, instructionRows, currentStem) {
  for (const action of actions.filter((row) => row.action_type === 'resolve_supplier_dispute')) {
    const allocation = currentSupplierActionAllocation(action, partyRows, instructionRows, currentStem);
    const actionInstructions = instructionRows.filter((instruction) => instruction.action_id === action.id);
    if (supplierInstructionStateChanged(actionInstructions, allocation)) {
      throw appError('Supplier invoice payment data changed. Save the draft again to review the updated Do not pay and Get back paid amount allocation.', 409);
    }
  }
}

async function reconcileApprovedSupplierInstructions(client, caseRow, partyRows, actionRows, instructionRows, currentStem, profile) {
  if (caseRow.approval_status !== 'Approved' || caseRow.workflow_status === 'Closed') {
    return { changed: false, instructionRows };
  }
  const reconciliations = [];
  for (const action of actionRows.filter((row) => row.action_type === 'resolve_supplier_dispute')) {
    const allocation = currentSupplierActionAllocation(action, partyRows, instructionRows, currentStem);
    const currentRows = instructionRows.filter((instruction) => instruction.action_id === action.id);
    if (!supplierInstructionStateChanged(currentRows, allocation)) continue;
    const sourceStemSnapshot = {
      stemId: currentStem.Id,
      stemName: currentStem._Display_Name || currentStem.Name || currentStem.KeyStem__c || '',
      deliveryDate: currentStem.Delivery_Date__c || null,
    };
    reconciliations.push({
      action_id: action.id,
      instructions: supplierInstructionRows(allocation).map((desired) => ({
        ...desired,
        party_id: action.party_id,
        source_stem_id: caseRow.stem_id,
        source_stem_snapshot: sourceStemSnapshot,
        allocation_fingerprint: allocation.fingerprint,
      })),
      note: `Supplier payment changed. Do not pay is now ${allocation.totalDoNotPay.toFixed(2)} ${allocation.currencyIsoCode}; get back paid amount is ${allocation.totalGetBackPaid.toFixed(2)} ${allocation.currencyIsoCode}.`,
      metadata: {
        disputeAmount: allocation.disputeAmount,
        totalDoNotPay: allocation.totalDoNotPay,
        totalGetBackPaid: allocation.totalGetBackPaid,
        allocationFingerprint: allocation.fingerprint,
      },
    });
  }
  if (!reconciliations.length) {
    if (!hasUnacceptedExternalDisputeClosure(caseRow, currentStem) && caseRow.salesforce_writeback_status === 'failed' && ['Approved - Pending Accounting', 'Accounting In Progress', 'Settled - Ready to Close'].includes(caseRow.workflow_status)) {
      await writeDisputeWorkflowStatusToSalesforce(client, caseRow, profile, caseRow.workflow_status);
      return { changed: false, writebackRetried: true, instructionRows };
    }
    return { changed: false, writebackRetried: false, instructionRows };
  }
  const { error: reconciliationError } = await client.rpc('reconcile_dispute_supplier_instructions', {
    p_case_id: caseRow.id,
    p_reconciliations: reconciliations,
    p_actor: { id: profile.id, email: profile.email },
  });
  if (reconciliationError) throw reconciliationError;
  const updatedCase = await getDisputeBetaCase(client, caseRow.id);
  await persistDisputeAccountingStatus(client, updatedCase, currentStem, profile, 'Accounting In Progress');
  const { data, error } = await client.from('dispute_workflow_supplier_instructions').select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT).eq('case_id', caseRow.id).order('created_at', { ascending: true });
  if (error) throw error;
  return {
    changed: true,
    writebackRetried: false,
    instructionRows: data || [],
  };
}

async function loadDisputeWorkflowDocuments(client, caseId) {
  const { data, error } = await client.from('dispute_workflow_documents').select(DISPUTE_WORKFLOW_DOCUMENT_SELECT).eq('case_id', caseId).eq('upload_status', 'complete').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadDisputeWorkflowEvents(client, caseId, limit = 100) {
  const { data, error } = await client.from('dispute_beta_events').select(DISPUTE_BETA_EVENT_SELECT).eq('case_id', caseId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

function missingRequiredDisputeDocuments(actions = [], documents = []) {
  const actionIdsWithDocuments = new Set(documents.map((document) => document.action_id).filter(Boolean));
  return actions.filter((action) => action.requires_attachment === true && !actionIdsWithDocuments.has(action.id));
}

async function assertRequiredDisputeDocuments(client, actions = []) {
  const caseId = actions[0]?.case_id;
  const documents = caseId ? await loadDisputeWorkflowDocuments(client, caseId) : [];
  if (!actions.some((action) => action.requires_attachment === true)) return documents;
  const missing = missingRequiredDisputeDocuments(actions, documents);
  if (missing.length) {
    const labels = missing.map((action) => `${action.action_label || action.action_type} (${action.party_side})`);
    throw appError(`Upload the required document for: ${labels.join(', ')}.`, 400);
  }
  return documents;
}

async function patchDisputeWorkflowStatusInSalesforce(caseRow, salesforceStatus) {
  const currentRows = await queryRows(`
    SELECT Id, Dispute_Status__c, LastModifiedDate
    FROM stem__c
    WHERE Id = '${escapeSoql(caseRow.stem_id)}'
    LIMIT 1
  `);
  const currentStem = currentRows[0];
  if (!currentStem) throw appError('The disputed STEM no longer exists in Salesforce.', 404);

  if (isSalesforceDisputeClosed(currentStem.Dispute_Status__c)) {
    const continuingRecordedClose = isSalesforceDisputeClosed(salesforceStatus) && isSalesforceDisputeClosed(caseRow.current_salesforce_status) && caseRow.salesforce_writeback_status === 'success';
    if (continuingRecordedClose) return;
    assertSalesforceDisputeIsOpen(currentStem);
  }

  const ifUnmodifiedSince = currentStem.LastModifiedDate ? new Date(currentStem.LastModifiedDate).toUTCString() : null;
  try {
    await sfRequest(`/sobjects/stem__c/${encodeURIComponent(caseRow.stem_id)}`, {
      method: 'PATCH',
      body: { Dispute_Status__c: salesforceStatus },
      headers: ifUnmodifiedSince ? { 'If-Unmodified-Since': ifUnmodifiedSince } : undefined,
    });
  } catch (error) {
    if (error.status === 412) {
      throw appError('Salesforce changed while FCOS was saving this workflow. Refresh the Dispute Workflow queue and try again.', 409);
    }
    throw error;
  }
}

async function recordDisputeWorkflowSalesforceWriteback(client, caseRow, profile, salesforceStatus, writebackStatus = 'success', writebackError = null) {
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      current_salesforce_status: writebackStatus === 'success' ? salesforceStatus : caseRow.current_salesforce_status,
      salesforce_writeback_status: writebackStatus,
      salesforce_writeback_error: writebackError,
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseRow.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, updatedCase, 'salesforce_writeback', profile, {
    note: writebackStatus === 'success' ? `Salesforce dispute status updated to ${salesforceStatus}.` : `Salesforce dispute status update to ${salesforceStatus} failed.`,
    metadata: { salesforceStatus, error: writebackError },
  });
  return updatedCase;
}

async function writeDisputeWorkflowStatusToSalesforce(client, caseRow, profile, salesforceStatus, options = {}) {
  let writebackStatus = 'success';
  let writebackError = null;
  let writebackFailure = null;
  try {
    await patchDisputeWorkflowStatusInSalesforce(caseRow, salesforceStatus);
  } catch (error) {
    writebackStatus = 'failed';
    writebackError = error.message;
    writebackFailure = error;
  }
  const updatedCase = await recordDisputeWorkflowSalesforceWriteback(client, caseRow, profile, salesforceStatus, writebackStatus, writebackError);
  if (options.required && writebackStatus === 'failed') {
    if (writebackFailure?.status) throw writebackFailure;
    throw appError(`Salesforce dispute status could not be updated: ${writebackError}`, 502);
  }
  return updatedCase;
}

async function upsertDisputeBetaCase(client, stem, extra = {}) {
  const nowIso = new Date().toISOString();
  const casePayload = {
    ...disputeBetaCaseFromStem(stem),
    latest_note: String(extra.latestNote ?? extra.latest_note ?? '').trim(),
    updated_at: nowIso,
  };
  if (extra.workflowStatus) casePayload.workflow_status = normalizeDisputeBetaStatus(extra.workflowStatus, DISPUTE_BETA_WORKFLOW_STATUSES, 'Draft');
  if (extra.approvalStatus) casePayload.approval_status = normalizeDisputeBetaStatus(extra.approvalStatus, DISPUTE_BETA_APPROVAL_STATUSES, 'Draft');
  const { data, error } = await client.from('dispute_beta_cases').upsert(casePayload, { onConflict: 'stem_id' }).select(DISPUTE_BETA_CASE_SELECT).single();
  if (error) throw error;
  return data;
}

async function getDisputeBetaCase(client, caseIdOrStemId) {
  const value = String(caseIdOrStemId || '').trim();
  if (!value) throw appError('caseId or stemId is required.', 400);
  const query = client.from('dispute_beta_cases').select(DISPUTE_BETA_CASE_SELECT);
  const { data, error } = isSalesforceId(value) ? await query.eq('stem_id', value).maybeSingle() : await query.eq('id', value).maybeSingle();
  if (error) throw error;
  if (!data) throw appError('Dispute Workflow case not found.', 404);
  return data;
}

function selectedPartyRowsFromAccounts(registry, accountIds = []) {
  const selectedKeys = new Set(accountIds.map(disputeSalesforceIdKey).filter(Boolean));
  const candidateByKey = new Map((registry?.candidates || []).map((candidate) => [candidate.accountKey, candidate]));
  const invalidKeys = [...selectedKeys].filter((key) => !candidateByKey.has(key));
  if (invalidKeys.length) throw appError('One or more selected Accounts are no longer eligible for this STEM.', 400);
  if (!selectedKeys.size) throw appError('Select at least one disputed Account before saving.', 400);
  return [...selectedKeys].map((key) => {
    const candidate = candidateByKey.get(key);
    return {
      id: null,
      case_id: null,
      stem_id: null,
      account_id: candidate.accountId,
      account_key: candidate.accountKey,
      account_name: candidate.name,
      roles: candidate.roles,
      source_types: candidate.sourceTypes,
      source_record_ids: candidate.sourceRecordIds,
      payment_terms: candidate.paymentTerms,
      products: candidate.products,
      cancelled_source_only: candidate.cancelledSourceOnly,
    };
  });
}

function validateStoredDisputeActions(actions, partyRows, registry) {
  const partyById = disputePartyRowMap(partyRows);
  const seen = new Set();
  for (const action of actions || []) {
    const party = partyById.get(action.party_id);
    if (!party) throw appError(`Action ${action.action_label || action.id} has no selected disputed Account.`, 400);
    const candidate = findDisputeParty(registry, action.party_side, party.account_id);
    if (!candidate) throw appError(`${party.account_name} is no longer eligible on the ${action.party_side} side.`, 400);
    const key = `${party.account_key}:${action.party_side}`;
    if (seen.has(key)) throw appError(`Only one ${action.party_side} action may be added for ${party.account_name}.`, 400);
    seen.add(key);
  }
  return actions || [];
}

function supplierActionsMissingDisputeAmount(actions = []) {
  return actions.filter((action) => action.party_side === 'supplier' && DISPUTE_LEGACY_SUPPLIER_FINANCIAL_ACTIONS.has(action.action_type) && action.amount == null);
}

function assertSupplierDisputeAmounts(actions = []) {
  const missing = supplierActionsMissingDisputeAmount(actions);
  if (missing.length) {
    throw appError('Supplier dispute amount required. Record the agreed amount before this legacy workflow can progress.', 409);
  }
  const legacy = actions.filter((action) => action.party_side === 'supplier' && DISPUTE_LEGACY_SUPPLIER_FINANCIAL_ACTIONS.has(action.action_type));
  if (legacy.length) {
    throw appError('Convert each legacy supplier action into invoice-level Finance instructions before this workflow can progress.', 409);
  }
}

async function disputeBetaList(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const limit = body.limit || 10000;
  const cached = await cachedSalesforceValue({
    namespace: 'salesforce-dispute-queue',
    ttlSeconds: 30,
    payload: { limit },
    tags: ['salesforce:disputes', 'salesforce:stem', 'salesforce:account'],
    body,
    req,
    accessContext: accessContext || { client, profile },
    loader: () => salesforceDisputeStems({ limit }, null, accessContext || { client, profile }),
  });
  const salesforceData = cached.value;
  const rows = salesforceData.rows || [];
  let [workflowMap, capabilities] = await Promise.all([
    loadDisputeBetaWorkflowMap(
      client,
      rows.map((row) => row.Id),
    ),
    disputeWorkflowCapabilities(client, profile),
  ]);
  let reconciled = false;
  const reconciliationErrors = new Map();
  for (const stem of rows) {
    const workflow = workflowMap[stem.Id];
    if (workflow?.case?.approvalStatus !== 'Approved' || workflow.case.workflowStatus === 'Closed' || !workflow.actions.some((action) => action.actionType === 'resolve_supplier_dispute') || !stem._Supplier_Settlement_Schema?.valid) continue;
    try {
      const caseRow = await getDisputeBetaCase(client, workflow.case.id);
      const stored = await loadDisputeWorkflowActions(client, caseRow.id);
      const result = await reconcileApprovedSupplierInstructions(client, caseRow, stored.partyRows, stored.actionRows, stored.instructionRows, stem, profile);
      reconciled = reconciled || result.changed || result.writebackRetried;
    } catch (error) {
      console.error('[dispute-workflow] supplier reconciliation failed', {
        requestId: requestIdFrom(req),
        code: error?.code || null,
      });
      reconciliationErrors.set(stem.Id, 'Supplier payment reconciliation is temporarily unavailable. Finance accounting remains unchanged.');
    }
  }
  if (reconciled) {
    workflowMap = await loadDisputeBetaWorkflowMap(
      client,
      rows.map((row) => row.Id),
    );
  }
  for (const [stemId, error] of reconciliationErrors) {
    if (workflowMap[stemId]) workflowMap[stemId].reconciliationError = error;
  }
  projectExternallyClosedDisputeWorkflows(rows, workflowMap);
  return {
    isDisputeAdmin: capabilities.canApprove,
    isDisputeAccounting: capabilities.canAccount,
    capabilities,
    requiredSalesforceFieldsMissing: true,
    fieldWarning: 'Disputed Accounts, approval, accounting, documents, and audit state are stored in Supabase. Salesforce receives only the high-level STEM Dispute Status.',
    rows: rows.map((row) => {
      const workflow = workflowMap[row.Id] || {
        case: null,
        parties: [],
        actions: [],
        supplierInstructions: [],
        events: [],
        documents: [],
      };
      if (!workflow.case) workflow.case = legacyClosedDisputeCase(row);
      return {
        ...row,
        _Dispute_Parties: disputeRegistryWithSelection(row._Dispute_Parties, workflow.parties),
        _Dispute_Workflow: workflow,
      };
    }),
  };
}

async function disputeBetaSaveDraft(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const stem = body.stem || {};
  const stemId = stem.Id || body.stemId;
  if (!stemId) throw appError('stemId is required.', 400);
  const [currentStem, existingCaseResult] = await Promise.all([loadCurrentDisputeStem(stemId, accessContext || { client, profile }), client.from('dispute_beta_cases').select(DISPUTE_BETA_CASE_SELECT).eq('stem_id', stemId).maybeSingle()]);
  assertSalesforceDisputeIsOpen(currentStem);
  const candidateRegistry = currentStem._Dispute_Parties;
  if (!candidateRegistry?.candidateSchemaValid) {
    const messages = (candidateRegistry?.issues || []).map((item) => item.message).filter(Boolean);
    throw appError(`Correct the Salesforce Account sources before continuing: ${messages.join(' ')}`, 400);
  }
  if (existingCaseResult.error) throw existingCaseResult.error;
  const existingCase = existingCaseResult.data;
  if (existingCase && !['Draft', 'Rejected', 'Revision Requested'].includes(existingCase.workflow_status)) {
    throw appError('Trader instructions are locked after submission. Request a revision before editing them.', 400);
  }
  const selectedPartyRows = selectedPartyRowsFromAccounts(candidateRegistry, body.selectedPartyAccountIds || []);
  if (existingCase) {
    const selectedAccountKeys = new Set(selectedPartyRows.map((party) => party.account_key));
    const [storedPartiesResult, storedDocumentsResult] = await Promise.all([client.from('dispute_workflow_parties').select('id,account_key,account_name').eq('case_id', existingCase.id), client.from('dispute_workflow_documents').select('party_id').eq('case_id', existingCase.id)]);
    if (storedPartiesResult.error) throw storedPartiesResult.error;
    if (storedDocumentsResult.error) throw storedDocumentsResult.error;
    const documentedPartyIds = new Set((storedDocumentsResult.data || []).map((document) => document.party_id).filter(Boolean));
    const documentedRemovedParties = (storedPartiesResult.data || []).filter((party) => !selectedAccountKeys.has(party.account_key) && documentedPartyIds.has(party.id));
    if (documentedRemovedParties.length) {
      const names = documentedRemovedParties.map((party) => party.account_name || party.account_key).join(', ');
      throw appError(`Keep ${names} selected because dispute documents are already linked to the Account.`, 400);
    }
  }
  const registry = disputeRegistryWithSelection(candidateRegistry, selectedPartyRows);
  const caseInput = { id: existingCase?.id || null, stem_id: stemId };
  const normalizedActions = (body.actions || []).map((action) =>
    prepareSupplierSettlementAction(
      {
        id: String(action.id || '').trim() || null,
        ...normalizeDisputeBetaAction(action, caseInput, profile, registry),
      },
      currentStem,
    ),
  );
  const seenActionSides = new Set();
  for (const action of normalizedActions) {
    const key = `${action.party_account_key}:${action.party_side}`;
    if (seenActionSides.has(key)) throw appError('Only one action per selected Account side is allowed.', 400);
    seenActionSides.add(key);
  }
  const financials = calculateDisputeBetaSettlement(normalizedActions);
  await patchDisputeWorkflowStatusInSalesforce(existingCase || { stem_id: stemId }, 'Open - Trader Review');
  const casePayload = {
    ...disputeBetaCaseFromStem(currentStem),
    current_salesforce_status: 'Open - Trader Review',
    workflow_status: 'Draft',
    approval_status: 'Draft',
    latest_note: String(body.latestNote || '').trim(),
    settlement_financials: financials,
    settlement_pnl: financials.settlementPnl,
  };
  const { data: savedCaseId, error: saveError } = await client.rpc('save_dispute_workflow_draft', {
    p_case: casePayload,
    p_parties: selectedPartyRows.map((party) => ({
      account_id: party.account_id,
      account_key: party.account_key,
      account_name: party.account_name,
      roles: party.roles,
      source_types: party.source_types,
      source_record_ids: party.source_record_ids,
      payment_terms: party.payment_terms,
      products: party.products,
      cancelled_source_only: party.cancelled_source_only,
    })),
    p_actions: normalizedActions,
    p_actor: { id: profile.id, email: profile.email },
    p_event_note: body.latestNote || 'Draft saved.',
  });
  if (saveError) throw saveError;
  const updatedCase = await getDisputeBetaCase(client, savedCaseId || stemId);
  await clearInvalidDisputeCompensationLinks(client, updatedCase, profile);
  const workflowPromise = loadDisputeWorkflowActions(client, updatedCase.id);
  const documentsPromise = loadDisputeWorkflowDocuments(client, updatedCase.id);
  const statusPromise = recordDisputeWorkflowSalesforceWriteback(client, updatedCase, profile, 'Open - Trader Review');
  const [{ partyRows, actions, supplierInstructions }, documents, statusCase] = await Promise.all([workflowPromise, documentsPromise, statusPromise]);
  const events = await loadDisputeWorkflowEvents(client, updatedCase.id);
  return {
    case: serializeDisputeBetaCase(statusCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    actions,
    supplierInstructions,
    events: events.map(serializeDisputeBetaEvent),
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeBetaSubmitApproval(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  const { partyRows, actionRows, instructionRows, actions: serializedActions } = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const actions = validateStoredDisputeActions(actionRows, partyRows, registry);
  if (!actions?.length) throw appError('Add at least one trader action before submitting for approval.', 400);
  assertSupplierDisputeAmounts(actions);
  assertSupplierAllocationsCurrent(actions, partyRows, instructionRows, currentStem);
  if (!['Draft', 'Rejected', 'Revision Requested'].includes(caseRow.workflow_status)) {
    throw appError('Only draft, rejected, or revision-requested cases can be submitted.', 400);
  }
  await assertRequiredDisputeDocuments(client, actions);
  await patchDisputeWorkflowStatusInSalesforce(caseRow, 'Pending Approval');
  const nowIso = new Date().toISOString();
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      workflow_status: 'Pending Approval',
      approval_status: 'Pending Approval',
      submitted_by: profile.id,
      submitted_by_email: profile.email,
      submitted_at: nowIso,
      latest_note: String(body.note || caseRow.latest_note || '').trim(),
      updated_at: nowIso,
    })
    .eq('id', caseRow.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, updatedCase, 'submitted', profile, {
    note: body.note || 'Submitted for dispute administrator approval.',
  });
  const statusCase = await recordDisputeWorkflowSalesforceWriteback(client, updatedCase, profile, 'Pending Approval');
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  return {
    case: serializeDisputeBetaCase(statusCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    actions: serializedActions,
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeBetaApprove(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'disputes_approve', 'Dispute approval permission is required.', 403);
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  if (caseRow.approval_status !== 'Pending Approval') throw appError('Only pending Dispute Workflow cases can be approved.', 400);
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  const { partyRows, actionRows, instructionRows } = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const actions = validateStoredDisputeActions(actionRows, partyRows, registry);
  assertSupplierDisputeAmounts(actions);
  assertSupplierAllocationsCurrent(actions, partyRows, instructionRows, currentStem);
  await assertRequiredDisputeDocuments(client, actions || []);
  const salesforceStatus = 'Approved - Pending Accounting';
  const { error: pendingError } = await client
    .from('dispute_beta_cases')
    .update({
      salesforce_writeback_status: 'not_started',
      salesforce_writeback_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseRow.id);
  if (pendingError) throw pendingError;
  try {
    await patchDisputeWorkflowStatusInSalesforce(caseRow, salesforceStatus);
  } catch (error) {
    await recordDisputeWorkflowSalesforceWriteback(client, caseRow, profile, salesforceStatus, 'failed', error.message);
    throw error;
  }
  const { error: approvalError } = await client.rpc('approve_dispute_workflow_case', {
    p_case_id: caseRow.id,
    p_actor: { id: profile.id, email: profile.email },
    p_note: body.note || 'Approved by dispute administrator.',
    p_salesforce_status: salesforceStatus,
  });
  if (approvalError) throw approvalError;
  let updatedCase = await getDisputeBetaCase(client, caseRow.id);
  if (updatedCase.workflow_status !== salesforceStatus) {
    updatedCase = await writeDisputeWorkflowStatusToSalesforce(client, updatedCase, profile, updatedCase.workflow_status);
  }
  const accountingState = await loadDisputeWorkflowActions(client, caseRow.id);
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  return {
    case: serializeDisputeBetaCase(updatedCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    actions: accountingState.actions,
    supplierInstructions: accountingState.supplierInstructions,
    documents: documents.map(serializeDisputeWorkflowDocument),
    writebackResults: [],
  };
}

async function disputeBetaReject(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'disputes_approve', 'Dispute approval permission is required.', 403);
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  if (caseRow.approval_status !== 'Pending Approval') throw appError('Only pending Dispute Workflow cases can be rejected or returned for revision.', 400);
  const revisionRequested = Boolean(body.revisionRequested);
  const reason = String(body.reason || '').trim();
  if (!reason) throw appError(revisionRequested ? 'Revision reason is required.' : 'Rejection reason is required.', 400);
  const salesforceStatus = revisionRequested ? 'Revision Requested' : 'Rejected';
  await patchDisputeWorkflowStatusInSalesforce(caseRow, salesforceStatus);
  const nowIso = new Date().toISOString();
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      workflow_status: revisionRequested ? 'Revision Requested' : 'Rejected',
      approval_status: revisionRequested ? 'Revision Requested' : 'Rejected',
      rejected_by: profile.id,
      rejected_by_email: profile.email,
      rejected_at: nowIso,
      rejection_reason: reason,
      updated_at: nowIso,
    })
    .eq('id', caseRow.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, updatedCase, revisionRequested ? 'revision_requested' : 'rejected', profile, {
    note: reason,
  });
  const statusCase = await recordDisputeWorkflowSalesforceWriteback(client, updatedCase, profile, salesforceStatus);
  return { case: serializeDisputeBetaCase(statusCase) };
}

async function disputeWorkflowDocuments(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  return { documents: documents.map(serializeDisputeWorkflowDocument) };
}

async function disputeWorkflowUploadDocument(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  requireExternalActionGate('salesforce_write');
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  const partyRows = await loadDisputeWorkflowParties(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const storedWorkflow = await loadDisputeWorkflowActions(client, caseRow.id);
  validateStoredDisputeActions(storedWorkflow.actionRows, partyRows, registry);
  if (caseRow.approval_status === 'Approved') {
    const reconciliation = await reconcileApprovedSupplierInstructions(client, caseRow, partyRows, storedWorkflow.actionRows, storedWorkflow.instructionRows, currentStem, profile);
    if (reconciliation.changed) {
      throw appError('Supplier payments changed. FCOS updated the accounting plan; reopen the document upload and link it to the revised instruction.', 409);
    }
  } else {
    assertSupplierAllocationsCurrent(storedWorkflow.actionRows, partyRows, storedWorkflow.instructionRows, currentStem);
  }
  const canEdit = ['Draft', 'Rejected', 'Revision Requested'].includes(caseRow.workflow_status);
  const [canApproveDocuments, canAccountDocuments] = await Promise.all([userHasCapability(client, profile, 'disputes_approve'), userHasCapability(client, profile, 'disputes_account')]);
  if (!canEdit && !canApproveDocuments && !canAccountDocuments) {
    throw appError('Only accounting or administrators can add documents after trader submission.', 403);
  }

  const actionId = String(body.actionId || '').trim() || null;
  const supplierInstructionId = String(body.supplierInstructionId || '').trim() || null;
  let action = null;
  if (actionId) {
    const { data, error } = await client.from('dispute_beta_actions').select(DISPUTE_BETA_ACTION_SELECT).eq('id', actionId).eq('case_id', caseRow.id).maybeSingle();
    if (error) throw error;
    if (!data) throw appError('The selected workflow action was not found.', 404);
    action = data;
  }
  let supplierInstruction = null;
  if (supplierInstructionId) {
    const { data, error } = await client.from('dispute_workflow_supplier_instructions').select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT).eq('id', supplierInstructionId).eq('case_id', caseRow.id).maybeSingle();
    if (error) throw error;
    if (!data) throw appError('The selected supplier instruction was not found.', 404);
    supplierInstruction = data;
    if (action && supplierInstruction.action_id !== action.id) {
      throw appError('The supplier instruction does not belong to the selected action.', 400);
    }
    if (!action) {
      const { data: linkedAction, error: linkedActionError } = await client.from('dispute_beta_actions').select(DISPUTE_BETA_ACTION_SELECT).eq('id', supplierInstruction.action_id).eq('case_id', caseRow.id).maybeSingle();
      if (linkedActionError) throw linkedActionError;
      action = linkedAction;
    }
  }
  const partyId = String(body.partyId || action?.party_id || '').trim();
  const partyRow = partyRows.find((party) => party.id === partyId);
  if (!partyRow) throw appError('Select a saved disputed Account before uploading a document.', 400);
  const partySide = String(body.partySide || action?.party_side || '')
    .trim()
    .toLowerCase();
  if (!['buyer', 'supplier'].includes(partySide)) throw appError('Select the buyer or supplier side for this document.', 400);
  const party = findDisputeParty(registry, partySide, partyRow.account_id);
  if (!party || !(registry.selected || []).some((selected) => selected.accountKey === party.accountKey)) {
    throw appError('The selected Account side is no longer valid for this STEM.', 400);
  }
  if (action && (action.party_id !== partyRow.id || action.party_side !== partySide)) {
    throw appError('The selected action does not belong to this Account side.', 400);
  }

  const documentType = String(body.documentType || '').trim();
  if (!DISPUTE_WORKFLOW_DOCUMENT_TYPES.has(documentType)) throw appError('Valid document type is required.', 400);
  const documentDirection = String(body.documentDirection || '')
    .trim()
    .toLowerCase();
  if (!DISPUTE_WORKFLOW_DOCUMENT_DIRECTIONS.has(documentDirection)) throw appError('Select a valid document direction.', 400);
  if (!documentDirection.endsWith(`_${partySide}`)) throw appError(`Document direction must match the ${partySide} side.`, 400);
  const originalFileName = String(body.originalFileName || '').trim();
  if (!originalFileName) throw appError('Document filename is required.', 400);
  const rawBase64 = String(body.base64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  if (!rawBase64) throw appError('Document content is required.', 400);
  const buffer = Buffer.from(rawBase64, 'base64');
  if (!buffer.length) throw appError('Document content is empty or invalid.', 400);
  if (buffer.length > DISPUTE_WORKFLOW_MAX_DOCUMENT_BYTES) throw appError('Document is too large. Maximum size is 3 MB.', 413);

  const partyName = party.name;
  const linkedRecordId = caseRow.stem_id;
  const extension = disputeWorkflowFileExtension(originalFileName);
  if (!extension) throw appError('The selected document must have a filename extension.', 400);
  const directionLabel = disputeWorkflowDirectionLabel(documentDirection);
  const suggestedBaseName = `${disputeWorkflowHongKongDateToken()} ${directionLabel}`;
  const requestedInput = String(body.requestedFileName || '').replace(new RegExp(`\\.${extension}$`, 'i'), '');
  const requestedBaseName = disputeWorkflowEditableFilename(requestedInput, suggestedBaseName);
  const contentType = String(body.contentType || 'application/octet-stream').trim() || 'application/octet-stream';
  let documentRow = null;
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const smartFileName = `${requestedBaseName}${suffix ? `-${suffix}` : ''}.${extension}`;
    const { data, error } = await client
      .from('dispute_workflow_documents')
      .insert({
        case_id: caseRow.id,
        action_id: action?.id || actionId,
        supplier_instruction_id: supplierInstructionId,
        party_id: partyRow.id,
        party_side: partySide,
        stem_id: caseRow.stem_id,
        party_name: partyName,
        party_account_id: party.accountId,
        document_direction: documentDirection,
        document_type: documentType,
        original_filename: originalFileName,
        requested_filename: `${requestedBaseName}.${extension}`,
        smart_filename: smartFileName,
        upload_status: 'pending',
        content_type: contentType,
        file_extension: extension,
        content_size: buffer.length,
        salesforce_content_version_id: null,
        salesforce_linked_record_id: linkedRecordId,
        uploaded_by: profile.id,
        uploaded_by_email: profile.email,
      })
      .select(DISPUTE_WORKFLOW_DOCUMENT_SELECT)
      .single();
    if (!error) {
      documentRow = data;
      break;
    }
    if (error.code !== '23505') throw error;
  }
  if (!documentRow) throw appError('A unique document filename could not be reserved.', 409);

  const smartFileName = documentRow.smart_filename;
  const title = smartFileName.slice(0, -(extension.length + 1));
  let contentVersionId = null;
  let contentDocumentId = null;

  try {
    const contentVersion = await sfRequest('/sobjects/ContentVersion', {
      method: 'POST',
      body: {
        Title: title,
        PathOnClient: `/${smartFileName}`,
        VersionData: buffer.toString('base64'),
        FirstPublishLocationId: linkedRecordId,
      },
    });
    contentVersionId = contentVersion?.id;
    if (!isSalesforceId(contentVersionId)) throw appError('Salesforce did not return a ContentVersion id.', 502);
    const versionRows = await queryRows(`SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${escapeSoql(contentVersionId)}' LIMIT 1`, { softFail: true });
    contentDocumentId = versionRows[0]?.ContentDocumentId || null;
    if (!isSalesforceId(contentDocumentId)) throw appError('Salesforce did not return a ContentDocument id.', 502);
    const salesforceUrl = `${getInstanceUrl()}/lightning/r/ContentDocument/${contentDocumentId}/view`;
    const { data: completedDocument, error: documentError } = await client
      .from('dispute_workflow_documents')
      .update({
        upload_status: 'complete',
        salesforce_content_version_id: contentVersionId,
        salesforce_content_document_id: contentDocumentId,
        salesforce_url: salesforceUrl,
      })
      .eq('id', documentRow.id)
      .eq('upload_status', 'pending')
      .select(DISPUTE_WORKFLOW_DOCUMENT_SELECT)
      .single();
    if (documentError) throw documentError;
    documentRow = completedDocument;
  } catch (error) {
    if (contentDocumentId) await sfRequest(`/sobjects/ContentDocument/${encodeURIComponent(contentDocumentId)}`, { method: 'DELETE' }).catch(() => null);
    else if (contentVersionId) await sfRequest(`/sobjects/ContentVersion/${encodeURIComponent(contentVersionId)}`, { method: 'DELETE' }).catch(() => null);
    await client.from('dispute_workflow_documents').delete().eq('id', documentRow.id);
    throw error;
  }
  await writeDisputeBetaEvent(client, caseRow, 'document_uploaded', profile, {
    actionId,
    note: `${smartFileName} uploaded to Salesforce.`,
    metadata: {
      documentId: documentRow.id,
      documentType,
      documentDirection,
      partySide,
      partyName,
      partyAccountId: party.accountId,
      supplierInstructionId,
      contentVersionId: documentRow.salesforce_content_version_id,
      linkedRecordIds: [linkedRecordId],
    },
  });
  return { document: serializeDisputeWorkflowDocument(documentRow) };
}

async function supplierOffsetInvoiceOptions({ supplierAccountId, currencyIsoCode, excludeInvoiceIds = [], accessContext = null } = {}) {
  if (!isSalesforceId(supplierAccountId)) throw appError('Valid supplier Account is required.', 400);
  const [invoiceDescribe, paymentDescribe] = await Promise.all([
    salesforceObjectFields({ objectName: 'Supplier_Invoice__c' }),
    salesforceObjectFields({ objectName: 'Payment__c' }).catch(() => ({
      fields: [],
    })),
  ]);
  const invoiceFields = invoiceDescribe.fields || [];
  const invoiceFieldNames = new Set(invoiceFields.map((field) => field.name));
  const invoiceFieldByName = Object.fromEntries(invoiceFields.map((field) => [field.name, field]));
  const schema = resolveSupplierSettlementSchema({
    supplierInvoiceFields: invoiceFields,
    paymentFields: paymentDescribe.fields || [],
  });
  if (!schema.valid) {
    throw appError(`Supplier offset options are unavailable: ${schema.issues.join(' ')}`, 409);
  }
  const relationships = schema.supplierAccountFields.map((field) => invoiceFieldByName[field]?.relationshipName).filter(Boolean);
  const selectFields = ['Id', 'Name', 'CreatedDate', invoiceFieldNames.has('STEM__c') ? 'STEM__c' : null, invoiceFieldNames.has('CurrencyIsoCode') ? 'CurrencyIsoCode' : null, schema.invoiceAmountField, schema.invoicePayableField, ...schema.invoiceDueDateFields, ...schema.invoiceDateFields, ...schema.invoiceStatusFields, ...schema.supplierAccountFields, ...relationships.map((relationship) => `${relationship}.Name`)].filter(Boolean);
  const accountCondition = schema.supplierAccountFields.map((field) => `${field} = '${escapeSoql(supplierAccountId)}'`).join(' OR ');
  const rows = await queryRows(
    `
    SELECT ${[...new Set(selectFields)].join(', ')}
    FROM Supplier_Invoice__c
    WHERE (${accountCondition})
    ORDER BY CreatedDate ASC
    LIMIT 2000
  `,
    { limit: 2000, softFail: true },
  );
  const excluded = new Set(excludeInvoiceIds.map((id) => String(id).slice(0, 15)));
  const options = [];
  for (const invoice of rows) {
    if (excluded.has(String(invoice.Id || '').slice(0, 15))) continue;
    if (invoice.STEM__c) {
      const allowed = await requireInterofficeStemAccess(invoice.STEM__c, accessContext)
        .then(() => true)
        .catch(() => false);
      if (!allowed) continue;
    }
    const supplierField = schema.supplierAccountFields.find((field) => invoice[field]);
    if (disputeSalesforceIdKey(invoice[supplierField]) !== disputeSalesforceIdKey(supplierAccountId)) continue;
    const dueDate = schema.invoiceDueDateFields.map((field) => invoice[field]).find(Boolean) || null;
    const invoiceDate = schema.invoiceDateFields.map((field) => invoice[field]).find(Boolean) || invoice.CreatedDate || null;
    const status = schema.invoiceStatusFields.map((field) => invoice[field]).find(Boolean) || null;
    const statusToken = String(status || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    if (['closed', 'paid', 'cancelled', 'canceled', 'void', 'rejected'].some((token) => statusToken.includes(token))) continue;
    const exposure = normalizeSupplierInvoiceExposure({
      supplierInvoiceId: invoice.Id,
      invoiceName: invoice.Name,
      sourceStemId: invoice.STEM__c,
      supplierAccountId: invoice[supplierField],
      supplierName: relationships.map((relationship) => invoice[relationship]?.Name).find(Boolean) || '',
      currencyIsoCode: invoice.CurrencyIsoCode || 'USD',
      dueDate,
      invoiceDate,
      createdDate: invoice.CreatedDate,
      invoiceAmount: invoice[schema.invoiceAmountField],
      payableBalance: invoice[schema.invoicePayableField],
      status,
    });
    if (exposure.payableBalance <= 0.01 || exposure.currencyIsoCode !== currencyIsoCode) continue;
    options.push({
      supplierInvoiceId: exposure.supplierInvoiceId,
      invoiceName: exposure.invoiceName,
      stemId: invoice.STEM__c || null,
      currencyIsoCode: exposure.currencyIsoCode,
      invoiceAmount: exposure.invoiceAmount,
      payableBalance: exposure.payableBalance,
      dueDate: exposure.dueDate,
      invoiceDate: exposure.invoiceDate,
      status,
    });
  }
  return options;
}

async function disputeWorkflowSupplierOffsetOptions(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'disputes_account', 'Dispute accounting permission is required for supplier offset options.');
  const instructionId = String(body.instructionId || '').trim();
  const { data: instruction, error } = await client.from('dispute_workflow_supplier_instructions').select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT).eq('id', instructionId).maybeSingle();
  if (error) throw error;
  if (!instruction) throw appError('Supplier instruction not found.', 404);
  if (instruction.instruction_type !== 'get_back_paid') throw appError('Only Get back paid amount instructions can use an offset invoice.', 400);
  const caseRow = await getDisputeBetaCase(client, instruction.case_id);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const partyRows = await loadDisputeWorkflowParties(client, caseRow.id);
  const party = partyRows.find((row) => row.id === instruction.party_id);
  if (!party) throw appError('Supplier instruction has no selected Account.', 400);
  const options = await supplierOffsetInvoiceOptions({
    supplierAccountId: party.account_id,
    currencyIsoCode: instruction.currency_iso_code,
    excludeInvoiceIds: [instruction.source_supplier_invoice_id],
    accessContext: accessContext || { client, profile },
  });
  const { data: reservations, error: reservationError } = await client.from('dispute_workflow_supplier_instructions').select('id,target_supplier_invoice_id,planned_amount,status,recovery_method').eq('recovery_method', 'future_invoice_offset').not('target_supplier_invoice_id', 'is', null);
  if (reservationError) throw reservationError;
  const reservedByInvoice = new Map();
  for (const reservation of reservations || []) {
    if (reservation.id === instruction.id || ['Not Required', 'Superseded'].includes(reservation.status)) continue;
    const key = String(reservation.target_supplier_invoice_id || '').slice(0, 15);
    reservedByInvoice.set(key, Number(reservedByInvoice.get(key) || 0) + Number(reservation.planned_amount || 0));
  }
  const availableOptions = options
    .map((option) => {
      const reservedAmount = Number(reservedByInvoice.get(String(option.supplierInvoiceId || '').slice(0, 15)) || 0);
      return {
        ...option,
        reservedAmount,
        unreservedPayableBalance: Math.max(0, Number(option.payableBalance || 0) - reservedAmount),
      };
    })
    .filter((option) => option.unreservedPayableBalance + 0.01 >= Number(instruction.planned_amount || 0));
  return { options: availableOptions };
}

async function disputeWorkflowSupplierInstructionUpdate(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'disputes_account', 'Dispute accounting permission is required for supplier instructions.');
  const instructionId = String(body.instructionId || '').trim();
  if (!instructionId) throw appError('instructionId is required.', 400);
  const { data: originalInstruction, error: lookupError } = await client.from('dispute_workflow_supplier_instructions').select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT).eq('id', instructionId).maybeSingle();
  if (lookupError) throw lookupError;
  if (!originalInstruction) throw appError('Supplier instruction not found.', 404);
  const caseRow = await getDisputeBetaCase(client, originalInstruction.case_id);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  if (!hasUnacceptedExternalDisputeClosure(caseRow, currentStem)) assertSalesforceDisputeIsOpen(currentStem);
  let workflow = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, workflow.partyRows);
  validateStoredDisputeActions(workflow.actionRows, workflow.partyRows, registry);
  assertSupplierDisputeAmounts(workflow.actionRows);
  const reconciliation = await reconcileApprovedSupplierInstructions(client, caseRow, workflow.partyRows, workflow.actionRows, workflow.instructionRows, currentStem, profile);
  if (reconciliation.changed) workflow = await loadDisputeWorkflowActions(client, caseRow.id);
  const instruction = workflow.instructionRows.find((row) => row.id === instructionId);
  if (!instruction || instruction.status === 'Superseded') {
    throw appError('Supplier payment data changed and this instruction was replaced. Review the updated accounting plan.', 409);
  }
  const requestedRevision = Number(body.revision);
  if (Number.isInteger(requestedRevision) && requestedRevision !== Number(instruction.revision || 1)) {
    throw appError('This supplier instruction changed after it was opened. Refresh and review the latest values.', 409);
  }
  const status = String(body.status || '').trim();
  if (!DISPUTE_SUPPLIER_INSTRUCTION_STATUSES.has(status) || status === 'Superseded') {
    throw appError('Valid supplier instruction status is required.', 400);
  }
  if (caseRow.approval_status !== 'Approved') {
    if (instruction.instruction_type !== 'withhold_unpaid' || status !== 'Hold Acknowledged') {
      throw appError('Before approval, Finance can only acknowledge an immediate Do not pay instruction.', 400);
    }
  }
  const instructionReference = String(body.instructionReference || '').trim();
  const instructionDate = String(body.instructionDate || '').trim() || null;
  const settlementReference = String(body.settlementReference || '').trim();
  const settlementDate = String(body.settlementDate || '').trim() || null;
  const accountingNote = String(body.accountingNote || '').trim();
  if (instructionDate && !/^\d{4}-\d{2}-\d{2}$/.test(instructionDate)) throw appError('Instruction date is invalid.', 400);
  if (settlementDate && !/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) throw appError('Settlement date is invalid.', 400);
  const recoveryMethod = instruction.instruction_type === 'get_back_paid' ? String(body.recoveryMethod || instruction.recovery_method || '').trim() || null : null;
  if (instruction.instruction_type === 'get_back_paid' && ['Instruction Issued', 'Settled'].includes(status) && !['cash_refund', 'future_invoice_offset'].includes(recoveryMethod)) {
    throw appError('Choose cash refund or future invoice offset for Get back paid amount.', 400);
  }
  if (status === 'Instruction Issued' && (!instructionDate || (!instructionReference && !accountingNote))) {
    throw appError('Instruction Issued requires an instruction date and a reference or accounting note.', 400);
  }
  if (status === 'Not Required' && !accountingNote) throw appError('Explain why this supplier instruction is not required.', 400);
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  const hasEvidence = documents.some((document) => document.supplier_instruction_id === instruction.id && ['supplier_credit_note', 'settlement_agreement', 'proof_of_payment'].includes(document.document_type));
  if (status === 'Settled' && (!settlementDate || (!settlementReference && !hasEvidence))) {
    throw appError('Settled requires a settlement date and either an uploaded supplier document or a Finance reference.', 400);
  }
  const plannedAmount = Number(instruction.planned_amount || 0);
  const settlementAmount = decimalOrNull(body.settlementAmount) ?? (status === 'Settled' ? plannedAmount : null);
  if (status === 'Settled' && Math.abs(Number(settlementAmount || 0) - plannedAmount) > 0.01) {
    throw appError('Settlement amount must equal the current supplier instruction amount.', 400);
  }

  const party = workflow.partyRows.find((row) => row.id === instruction.party_id);
  let targetInvoice = null;
  if (recoveryMethod === 'future_invoice_offset') {
    const targetSupplierInvoiceId = String(body.targetSupplierInvoiceId || '').trim();
    if (!targetSupplierInvoiceId) throw appError('Select the supplier invoice that will receive the offset.', 400);
    const options = await supplierOffsetInvoiceOptions({
      supplierAccountId: party?.account_id,
      currencyIsoCode: instruction.currency_iso_code,
      excludeInvoiceIds: [instruction.source_supplier_invoice_id],
      accessContext: accessContext || { client, profile },
    });
    targetInvoice = options.find((option) => String(option.supplierInvoiceId).slice(0, 15) === String(targetSupplierInvoiceId).slice(0, 15));
    if (!targetInvoice) throw appError('The selected offset invoice is no longer eligible for this supplier Account and currency.', 409);
    if (targetInvoice.payableBalance + 0.01 < plannedAmount) throw appError('The selected offset invoice does not have enough payable balance.', 400);
  }
  let matchedPaymentId = null;
  let matchedPayment = null;
  if (recoveryMethod === 'cash_refund' && body.matchedSalesforcePaymentId) {
    const exposure = (currentStem._Supplier_Invoice_Exposure_Rows || []).find((row) => row.supplierInvoiceId === instruction.source_supplier_invoice_id);
    matchedPayment = (exposure?.payments || []).find((row) => row.id === body.matchedSalesforcePaymentId && Number(row.amount) < 0 && Math.abs(Math.abs(Number(row.amount)) - plannedAmount) <= 0.01 && (row.currencyIsoCode || 'USD') === instruction.currency_iso_code);
    if (!matchedPayment) throw appError('The selected Salesforce refund no longer matches this supplier invoice, currency, and amount.', 409);
    matchedPaymentId = matchedPayment.id;
  }

  const eventType = status === 'Hold Acknowledged' ? 'supplier_hold_acknowledged' : status === 'Settled' ? 'supplier_recovery_settled' : recoveryMethod && recoveryMethod !== instruction.recovery_method ? 'supplier_recovery_method_selected' : 'accounting_updated';
  const eventNote = `${instruction.instruction_type === 'withhold_unpaid' ? 'Do not pay' : 'Get back paid amount'} updated to ${status}.`;
  const instructionValues = {
    status,
    recovery_method: recoveryMethod,
    target_supplier_invoice_id: targetInvoice?.supplierInvoiceId || null,
    target_supplier_invoice_name: targetInvoice?.invoiceName || null,
    target_stem_id: targetInvoice?.stemId || null,
    target_invoice_amount_snapshot: targetInvoice?.invoiceAmount ?? null,
    target_payable_amount_snapshot: targetInvoice?.payableBalance ?? null,
    target_invoice_snapshot: targetInvoice || {},
    target_stem_snapshot: targetInvoice?.stemId ? { stemId: targetInvoice.stemId } : {},
    matched_salesforce_payment_id: matchedPaymentId,
    matching_payment_snapshot: matchedPayment || {},
    instruction_reference: instructionReference || null,
    instruction_date: instructionDate,
    instruction_amount: decimalOrNull(body.instructionAmount) ?? (status === 'Instruction Issued' ? plannedAmount : null),
    settlement_reference: settlementReference || null,
    settlement_date: settlementDate,
    settlement_amount: settlementAmount,
    accounting_note: accountingNote || null,
    event_type: eventType,
    event_note: eventNote,
    event_metadata: {
      supplierInstructionId: instruction.id,
      recoveryMethod,
      targetSupplierInvoiceId: targetInvoice?.supplierInvoiceId || null,
      matchedSalesforcePaymentId: matchedPaymentId,
      plannedAmount,
      currencyIsoCode: instruction.currency_iso_code,
    },
  };
  const { error: updateError } = await client.rpc('update_dispute_supplier_instruction', {
    p_instruction_id: instruction.id,
    p_expected_revision: Number(instruction.revision || 1),
    p_values: instructionValues,
    p_target_payable_amount: targetInvoice?.payableBalance ?? null,
    p_actor: { id: profile.id, email: profile.email },
  });
  if (updateError) {
    if (String(updateError.message || '').includes('revision conflict')) {
      throw appError('This supplier instruction was updated by another user. Refresh and try again.', 409);
    }
    if (String(updateError.message || '').includes('already reserved')) {
      throw appError('The selected offset invoice no longer has enough unreserved payable balance. Refresh the offset options.', 409);
    }
    throw updateError;
  }

  if (caseRow.approval_status !== 'Approved') {
    const refreshed = await loadDisputeWorkflowActions(client, caseRow.id);
    return {
      case: serializeDisputeBetaCase(caseRow),
      parties: refreshed.partyRows.map(serializeDisputeWorkflowParty),
      actions: refreshed.actions,
      supplierInstructions: refreshed.supplierInstructions,
      documents: documents.map(serializeDisputeWorkflowDocument),
    };
  }
  let updatedCase = await getDisputeBetaCase(client, caseRow.id);
  updatedCase = await persistDisputeAccountingStatus(client, updatedCase, currentStem, profile, updatedCase.workflow_status);
  const refreshed = await loadDisputeWorkflowActions(client, caseRow.id);
  return {
    case: serializeDisputeBetaCase(updatedCase),
    parties: workflow.partyRows.map(serializeDisputeWorkflowParty),
    actions: refreshed.actions,
    supplierInstructions: refreshed.supplierInstructions,
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeWorkflowSupplierAmountAmend(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  const actionId = String(body.actionId || '').trim();
  const amount = decimalOrNull(body.disputeAmount ?? body.amount);
  const note = String(body.note || body.description || '').trim();
  const currencyIsoCode = String(body.currencyIsoCode || 'USD')
    .trim()
    .toUpperCase();
  if (!actionId) throw appError('actionId is required.', 400);
  if (amount == null || amount < 0) throw appError('Supplier dispute amount must be zero or greater.', 400);
  if (!/^[A-Z]{3}$/.test(currencyIsoCode)) throw appError('Supplier dispute currency must be a three-letter ISO code.', 400);
  if (amount === 0 && !note) throw appError('Explain why no supplier recovery is required.', 400);
  const { data: action, error: actionError } = await client.from('dispute_beta_actions').select(DISPUTE_BETA_ACTION_SELECT).eq('id', actionId).maybeSingle();
  if (actionError) throw actionError;
  if (!action || action.party_side !== 'supplier') throw appError('Supplier action not found.', 404);
  const caseRow = await getDisputeBetaCase(client, action.case_id);
  const actorEmail = String(profile.email || '')
    .trim()
    .toLowerCase();
  const responsibleTrader =
    action.created_by === profile.id ||
    caseRow.submitted_by === profile.id ||
    [action.created_by_email, caseRow.submitted_by_email].some(
      (email) =>
        String(email || '')
          .trim()
          .toLowerCase() === actorEmail,
    );
  if (!isAdministratorUserType(profile.user_type) && !responsibleTrader) {
    throw appError('Only the responsible trader or an administrator can record this supplier dispute amount.', 403);
  }
  if (caseRow.workflow_status === 'Closed') throw appError('Closed disputes cannot be amended.', 400);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  if (!hasUnacceptedExternalDisputeClosure(caseRow, currentStem)) assertSalesforceDisputeIsOpen(currentStem);
  const workflow = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, workflow.partyRows);
  validateStoredDisputeActions(workflow.actionRows, workflow.partyRows, registry);
  const partyById = disputePartyRowMap(workflow.partyRows);
  const existingAmount = decimalOrNull(action.amount);
  const commercialAmountChanged = existingAmount == null || Math.abs(existingAmount - amount) > 0.01;
  const editableStage = ['Draft', 'Rejected', 'Revision Requested'].includes(caseRow.workflow_status);
  const amendedStage = editableStage ? caseRow.workflow_status : commercialAmountChanged ? 'Revision Requested' : caseRow.approval_status === 'Approved' ? 'Accounting In Progress' : caseRow.workflow_status;
  const amendedApproval = amendedStage === 'Draft' ? 'Draft' : amendedStage === 'Revision Requested' ? 'Revision Requested' : caseRow.approval_status;
  const rpcActions = workflow.actionRows.map((row) => {
    const party = partyById.get(row.party_id);
    const base = {
      ...row,
      party_account_key: party?.account_key,
    };
    if (row.id !== action.id) return base;
    return prepareSupplierSettlementAction(
      {
        ...base,
        action_type: 'resolve_supplier_dispute',
        action_label: DISPUTE_BETA_ACTION_LABELS.resolve_supplier_dispute,
        amount,
        special_buy_price: null,
        description: note || row.description || '',
        currency_iso_code: currencyIsoCode,
        invoice_allocations: Array.isArray(body.invoiceAllocations) ? body.invoiceAllocations : [],
        execution_status: 'Pending Accounting',
      },
      currentStem,
    );
  });
  const financials = calculateDisputeBetaSettlement(rpcActions);
  const salesforceStatus = amendedStage === 'Draft' ? 'Open - Trader Review' : amendedStage;
  const casePayload = {
    ...disputeBetaCaseFromStem(currentStem),
    current_salesforce_status: salesforceStatus,
    workflow_status: amendedStage,
    approval_status: amendedApproval,
    latest_note: note || 'Supplier dispute amount recorded.',
    settlement_financials: financials,
    settlement_pnl: financials.settlementPnl,
  };
  const { data: savedCaseId, error: saveError } = await client.rpc('save_dispute_workflow_draft', {
    p_case: casePayload,
    p_parties: workflow.partyRows.map((party) => ({
      account_id: party.account_id,
      account_key: party.account_key,
      account_name: party.account_name,
      roles: party.roles,
      source_types: party.source_types,
      source_record_ids: party.source_record_ids,
      payment_terms: party.payment_terms,
      products: party.products,
      cancelled_source_only: party.cancelled_source_only,
    })),
    p_actions: rpcActions,
    p_actor: { id: profile.id, email: profile.email },
    p_event_note: note || 'Supplier dispute amount recorded.',
  });
  if (saveError) throw saveError;
  const updatedCase = await getDisputeBetaCase(client, savedCaseId || caseRow.id);
  await patchDisputeWorkflowStatusInSalesforce(updatedCase, salesforceStatus);
  const statusCase = await recordDisputeWorkflowSalesforceWriteback(client, updatedCase, profile, salesforceStatus);
  if (amendedStage === 'Revision Requested') {
    await writeDisputeBetaEvent(client, statusCase, 'revision_requested', profile, {
      actionId: action.id,
      note: 'Supplier dispute amount added to an existing workflow; approval is required again.',
      metadata: { disputeAmount: amount, currencyIsoCode },
    });
  } else if (!commercialAmountChanged && action.action_type !== 'resolve_supplier_dispute') {
    await writeDisputeBetaEvent(client, statusCase, 'supplier_payment_reconciled', profile, {
      actionId: action.id,
      note: 'Existing supplier amount converted into invoice-level Finance instructions.',
      metadata: { disputeAmount: amount, currencyIsoCode },
    });
  }
  const refreshed = await loadDisputeWorkflowActions(client, caseRow.id);
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  return {
    case: serializeDisputeBetaCase(statusCase),
    parties: refreshed.partyRows.map(serializeDisputeWorkflowParty),
    actions: refreshed.actions,
    supplierInstructions: refreshed.supplierInstructions,
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeWorkflowAccountingUpdate(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'disputes_account', 'Dispute accounting permission is required for accounting updates.');
  const actionId = String(body.actionId || '').trim();
  if (!actionId) throw appError('actionId is required.', 400);
  const { data: action, error: actionLookupError } = await client.from('dispute_beta_actions').select(DISPUTE_BETA_ACTION_SELECT).eq('id', actionId).maybeSingle();
  if (actionLookupError) throw actionLookupError;
  if (!action) throw appError('Dispute Workflow action not found.', 404);
  if (action.action_type === 'resolve_supplier_dispute') {
    throw appError('Update each supplier invoice instruction instead of the parent supplier resolution.', 400);
  }
  const caseRow = await getDisputeBetaCase(client, action.case_id);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const partyRows = await loadDisputeWorkflowParties(client, caseRow.id);
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  const externalClosure = hasUnacceptedExternalDisputeClosure(caseRow, currentStem);
  if (!externalClosure) assertSalesforceDisputeIsOpen(currentStem);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const storedWorkflow = await loadDisputeWorkflowActions(client, caseRow.id);
  validateStoredDisputeActions(storedWorkflow.actionRows, partyRows, registry);
  assertSupplierDisputeAmounts(storedWorkflow.actionRows);
  if (caseRow.approval_status !== 'Approved' || caseRow.workflow_status === 'Closed') {
    throw appError('Accounting can update actions only after approval and before closure.', 400);
  }
  await reconcileApprovedSupplierInstructions(client, caseRow, partyRows, storedWorkflow.actionRows, storedWorkflow.instructionRows, currentStem, profile);

  const accountingStatus = normalizeDisputeBetaStatus(body.accountingStatus || body.executionStatus, DISPUTE_BETA_EXECUTION_STATUSES, '');
  if (!accountingStatus) throw appError('Valid accounting status is required.', 400);
  const instructionReference = String(body.instructionReference || '').trim();
  const instructionDate = String(body.instructionDate || '').trim() || null;
  const settlementReference = String(body.settlementReference || '').trim();
  const settlementDate = String(body.settlementDate || '').trim() || null;
  const accountingNote = String(body.accountingNote || body.note || '').trim();
  if (instructionDate && !/^\d{4}-\d{2}-\d{2}$/.test(instructionDate)) throw appError('Instruction date is invalid.', 400);
  if (settlementDate && !/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) throw appError('Settlement date is invalid.', 400);
  if (accountingStatus === 'Instruction Issued' && (!instructionDate || (!instructionReference && !accountingNote))) {
    throw appError('Instruction Issued requires an instruction date and a reference or accounting note.', 400);
  }
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  const hasSettlementDocument = documents.some((document) => document.action_id === actionId && ['settlement_agreement', 'buyer_credit_note', 'supplier_credit_note', 'proof_of_payment'].includes(document.document_type));
  if (accountingStatus === 'Settled' && (!settlementDate || (!settlementReference && !hasSettlementDocument))) {
    throw appError('Settled requires a settlement date and either a reference or settlement document.', 400);
  }
  const notRequiredEligibility = disputeNotRequiredEligibility(action, partyRows, currentStem);
  const notRequiredReasonWaived = accountingStatus === 'Not Required' && !accountingNote && notRequiredEligibility.eligible;
  if (accountingStatus === 'Not Required' && !accountingNote && !notRequiredReasonWaived) {
    if (notRequiredEligibility.balanceType && notRequiredEligibility.balance == null) {
      throw appError(`The current ${notRequiredEligibility.balanceLabel} balance is unavailable. Enter an accounting reason before selecting Not Required.`, 400);
    }
    if (notRequiredEligibility.balanceType) {
      throw appError(`The current ${notRequiredEligibility.balanceLabel} balance is ${notRequiredEligibility.balance.toFixed(2)}, not 0.00. Refresh the dispute or enter an accounting reason.`, 409);
    }
    throw appError('Explain why accounting is not required.', 400);
  }

  const { data: currentActionRows, error: currentActionsError } = await client.from('dispute_beta_actions').select(DISPUTE_BETA_ACTION_SELECT).eq('case_id', caseRow.id).order('created_at', { ascending: true });
  if (currentActionsError) throw currentActionsError;
  const projectedActions = (currentActionRows || []).map((row) => (row.id === actionId ? { ...row, execution_status: accountingStatus } : row));
  const allSettled = projectedActions.length > 0 && projectedActions.every((row) => row.execution_status === 'Settled' || row.execution_status === 'Not Required');
  const hasAccountingProgress = projectedActions.some((row) => row.execution_status !== 'Pending Accounting');
  const workflowStatus = allSettled ? 'Settled - Ready to Close' : hasAccountingProgress ? 'Accounting In Progress' : 'Approved - Pending Accounting';
  if (!externalClosure) await patchDisputeWorkflowStatusInSalesforce(caseRow, workflowStatus);

  const nowIso = new Date().toISOString();
  const { data: updatedAction, error } = await client
    .from('dispute_beta_actions')
    .update({
      execution_status: accountingStatus,
      instruction_reference: instructionReference || null,
      instruction_date: instructionDate,
      instruction_amount: decimalOrNull(body.instructionAmount),
      settlement_reference: settlementReference || null,
      settlement_date: settlementDate,
      settlement_amount: decimalOrNull(body.settlementAmount),
      accounting_note: accountingNote || null,
      accounting_by: profile.id,
      accounting_by_email: profile.email,
      accounting_at: nowIso,
      executed_by: accountingStatus === 'Settled' ? profile.id : null,
      executed_by_email: accountingStatus === 'Settled' ? profile.email : null,
      executed_at: accountingStatus === 'Settled' ? nowIso : null,
      execution_note: accountingNote || null,
      updated_by: profile.id,
      updated_by_email: profile.email,
      updated_at: nowIso,
    })
    .eq('id', actionId)
    .select(DISPUTE_BETA_ACTION_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, caseRow, 'accounting_updated', profile, {
    actionId,
    note: `${updatedAction.action_label} updated to ${accountingStatus}.`,
    metadata: {
      accountingStatus,
      instructionReference,
      instructionDate,
      settlementReference,
      settlementDate,
      notRequiredReasonWaived,
      verifiedBalance: notRequiredReasonWaived ? notRequiredEligibility.balance : null,
      verifiedBalanceType: notRequiredReasonWaived ? notRequiredEligibility.balanceType : null,
      partyAccountId: notRequiredReasonWaived ? notRequiredEligibility.partyAccountId : null,
    },
  });
  const { data: actionRows, error: actionsError } = await client.from('dispute_beta_actions').select(DISPUTE_BETA_ACTION_SELECT).eq('case_id', caseRow.id).order('created_at', { ascending: true });
  if (actionsError) throw actionsError;
  const actions = actionRows || [];
  const { data: statusCase, error: caseError } = await client.from('dispute_beta_cases').update({ workflow_status: workflowStatus, updated_at: nowIso }).eq('id', caseRow.id).select(DISPUTE_BETA_CASE_SELECT).single();
  if (caseError) throw caseError;
  const salesforceCase = externalClosure
    ? await recordExternalDisputeClosure(client, statusCase, currentStem, profile, workflowStatus)
    : await recordDisputeWorkflowSalesforceWriteback(client, statusCase, profile, workflowStatus);
  const partyMap = disputePartyRowMap(partyRows);
  return {
    case: serializeDisputeBetaCase(salesforceCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    action: serializeDisputeBetaAction(updatedAction, partyMap),
    actions: (actions || []).map((item) => serializeDisputeBetaAction(item, partyMap)),
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeBetaMarkExecuted(body = {}, req, accessContext = null) {
  return disputeWorkflowAccountingUpdate(
    {
      ...body,
      accountingStatus: 'Settled',
      settlementDate: body.settlementDate || new Date().toISOString().slice(0, 10),
      settlementReference: body.settlementReference || body.note,
      accountingNote: body.accountingNote || body.note,
    },
    req,
    accessContext,
  );
}

async function disputeWorkflowCompensationClaims(body = {}, req, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const actionId = String(body.actionId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionId)) throw appError('Valid dispute action is required.', 400);
  const { data: action, error } = await context.client
    .from('dispute_beta_actions')
    .select('id,case_id,stem_id,action_type,close_reason,party_id,updated_at,dispute_workflow_parties(account_id,account_name)')
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw error;
  if (!action) throw appError('Dispute action was not found.', 404);
  await requireInterofficeStemAccess(action.stem_id, context);
  if (!['close_buyer_dispute', 'close_supplier_dispute'].includes(action.action_type) || String(action.close_reason || '').trim().toLowerCase() !== 'uoc opened') {
    throw appError('Compensation claims are available only for a UOC opened closure action.', 409);
  }
  const accountId = action.dispute_workflow_parties?.account_id;
  const claims = await agreedCompensationClaimsForAccount(accountId, { includeClosed: false });
  return {
    actionId,
    actionUpdatedAt: action.updated_at,
    account: { accountId, accountName: action.dispute_workflow_parties?.account_name || '' },
    claims,
  };
}

async function disputeWorkflowCompensationClaimLink(body = {}, req, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const actionId = String(body.actionId || '').trim();
  const { data: action, error } = await context.client.from('dispute_beta_actions').select('id,stem_id').eq('id', actionId).maybeSingle();
  if (error) throw error;
  if (!action) throw appError('Dispute action was not found.', 404);
  await requireInterofficeStemAccess(action.stem_id, context);
  return linkDisputeAgreedCompensationClaim(body, unofficialCompensationServiceContext(context));
}

async function requireExternalDisputeClosureAuthority(client, profile) {
  if (profile?.user_type === 'administrator') return;
  if (profile?.user_type === 'general_manager') {
    const generalManager = await loadActiveGeneralManager(client);
    if (generalManager.id === profile.id) return;
  }
  throw appError('Only an Administrator or the active General Manager can accept a dispute closed directly in Salesforce.', 403);
}

async function disputeWorkflowAcceptExternalClosure(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireExternalDisputeClosureAuthority(client, profile);
  const reason = String(body.reason || body.note || '').trim();
  if (!reason) throw appError('A reason is required to accept the external Salesforce closure.', 400);
  let caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  if (!hasUnacceptedExternalDisputeClosure(caseRow, currentStem)) {
    throw appError('This dispute is not awaiting acceptance of an external Salesforce closure.', 409);
  }
  caseRow = await recordExternalDisputeClosure(client, caseRow, currentStem, profile);
  let { partyRows, actionRows, instructionRows } = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const reconciliation = await reconcileApprovedSupplierInstructions(client, caseRow, partyRows, actionRows, instructionRows, currentStem, profile);
  if (reconciliation.changed) {
    throw appError('Supplier payments changed. FCOS updated the accounting plan; Finance must complete the revised instructions before accepting the external closure.', 409);
  }
  if (caseRow.approval_status !== 'Approved' || caseRow.workflow_status !== 'Settled - Ready to Close') {
    throw appError('Complete the approved FCOS accounting workflow before accepting the external Salesforce closure.', 409);
  }
  const actions = validateStoredDisputeActions(actionRows, partyRows, registry);
  assertSupplierDisputeAmounts(actions);
  const activeSupplierInstructions = instructionRows.filter((instruction) => instruction.status !== 'Superseded');
  if (activeSupplierInstructions.some((instruction) => !['Settled', 'Not Required'].includes(instruction.status))) {
    throw appError('Every supplier invoice instruction must be Settled or Not Required before accepting the external closure.', 409);
  }
  if (!actions.length || !actions.every((action) => ['Settled', 'Not Required'].includes(action.execution_status))) {
    throw appError('Every accounting action must be Settled or Not Required before accepting the external closure.', 409);
  }
  await assertDisputeUocClaimsReadyForClosure(actions, partyRows);
  const documents = await assertRequiredDisputeDocuments(client, actions);
  const nowIso = new Date().toISOString();
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      workflow_status: 'Closed',
      latest_note: reason,
      current_salesforce_status: String(currentStem.Dispute_Status__c || '').trim(),
      salesforce_writeback_status: 'external',
      salesforce_writeback_error: null,
      external_closure_accepted_at: nowIso,
      external_closure_accepted_by: profile.id,
      external_closure_accepted_by_email: profile.email,
      external_closure_acceptance_reason: reason,
      closed_by: profile.id,
      closed_by_email: profile.email,
      closed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', caseRow.id)
    .eq('workflow_status', 'Settled - Ready to Close')
    .select(DISPUTE_BETA_CASE_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!updatedCase) throw appError('The dispute changed before the external closure was accepted. Refresh and review it again.', 409);
  await writeDisputeBetaEvent(client, updatedCase, 'external_closure_accepted', profile, {
    note: reason,
    metadata: {
      salesforceStatus: currentStem.Dispute_Status__c,
      salesforceLastModifiedAt: currentStem.LastModifiedDate || null,
      accountingCompleted: true,
    },
  });
  const partyMap = disputePartyRowMap(partyRows);
  return {
    case: serializeDisputeBetaCase(updatedCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    actions: actions.map((action) => serializeDisputeBetaAction(action, partyMap)),
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeBetaClose(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || (await requireActiveUser(req));
  await requireCapability(client, profile, 'disputes_account', 'Dispute accounting permission is required to close a dispute.');
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  if (!hasRecordedFcosClosureWriteback(caseRow)) assertSalesforceDisputeIsOpen(currentStem);
  let { partyRows, actionRows, instructionRows } = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const reconciliation = await reconcileApprovedSupplierInstructions(client, caseRow, partyRows, actionRows, instructionRows, currentStem, profile);
  if (reconciliation.changed) {
    const reloaded = await loadDisputeWorkflowActions(client, caseRow.id);
    partyRows = reloaded.partyRows;
    actionRows = reloaded.actionRows;
    instructionRows = reloaded.instructionRows;
    throw appError('Supplier payments changed after approval. FCOS updated the accounting plan; Finance must complete the revised instructions before closure.', 409);
  }
  if (caseRow.approval_status !== 'Approved') throw appError('Only approved Dispute Workflow cases can be closed.', 400);
  if (caseRow.workflow_status !== 'Settled - Ready to Close') throw appError('Complete accounting settlement for every action before closing.', 400);
  const finalNote = String(body.note || '').trim();
  if (!finalNote) throw appError('Final closure note is required.', 400);
  const actions = validateStoredDisputeActions(actionRows, partyRows, registry);
  assertSupplierDisputeAmounts(actions);
  const activeSupplierInstructions = instructionRows.filter((instruction) => instruction.status !== 'Superseded');
  if (activeSupplierInstructions.some((instruction) => !['Settled', 'Not Required'].includes(instruction.status))) {
    throw appError('Every supplier invoice instruction must be Settled or Not Required before closure.', 400);
  }
  if (!(actions || []).length || !(actions || []).every((action) => action.execution_status === 'Settled' || action.execution_status === 'Not Required')) {
    throw appError('Every accounting action must be Settled or Not Required before closure.', 400);
  }
  await assertDisputeUocClaimsReadyForClosure(actions, partyRows);
  const documents = await assertRequiredDisputeDocuments(client, actions || []);
  const statusCase = await writeDisputeWorkflowStatusToSalesforce(client, caseRow, profile, 'Closed', { required: true });
  const nowIso = new Date().toISOString();
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      workflow_status: 'Closed',
      latest_note: finalNote,
      current_salesforce_status: 'Closed',
      salesforce_writeback_status: 'success',
      salesforce_writeback_error: null,
      closed_by: profile.id,
      closed_by_email: profile.email,
      closed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', statusCase.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, updatedCase, 'closed', profile, {
    note: finalNote,
  });
  const partyMap = disputePartyRowMap(partyRows);
  return {
    case: serializeDisputeBetaCase(updatedCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    actions: (actions || []).map((item) => serializeDisputeBetaAction(item, partyMap)),
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function salesforceStemDetailUncached(body, req = null, accessContext = null) {
  const { stemId, updates, childObject, childId, childUpdates } = body;
  if (!stemId) throw new Error('stemId required');

  let actualStemId = stemId;
  if (stemId.length < 15) {
    const lookup = await queryRows(`SELECT Id FROM stem__c WHERE KeyStem__c = '${escapeSoql(stemId)}' LIMIT 1`, { softFail: true });
    if (!lookup.length) throw new Error(`STEM with KeyStem__c '${stemId}' not found`);
    actualStemId = lookup[0].Id;
  }
  await requireInterofficeStemAccess(actualStemId, accessContext);

  if (childObject && childId && childUpdates && Object.keys(childUpdates).length > 0) {
    await sfRequest(`/sobjects/${childObject}/${childId}`, {
      method: 'PATCH',
      body: childUpdates,
    });
  }
  if (updates && Object.keys(updates).length > 0) {
    await sfRequest(`/sobjects/stem__c/${actualStemId}`, {
      method: 'PATCH',
      body: updates,
    });
  }

  const [recordRaw, lineItems, extraCosts, buyerBrokers, buyerInvoices] = await Promise.all([
    sfRequest(`/sobjects/stem__c/${actualStemId}`).then(cleanRecord),
    queryRows(`SELECT Id, Name, STEM__c, Product__c, Product__r.Name, Product__r.Family, Supplier_Name__c, BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c, Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Payment_Term__c, BDN_Number__c, Cancelled__c, Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c, Buyers_Brokers_Commission_Lumpsum__c, Commission_Cost__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Lumpsum__c, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
    queryRows(`SELECT Id, Name, Description__c, Product2Id__c, Product2Id__r.Name, Product2Id__r.Family, Supplier_Name__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Supplier_Issued__c, Payment_Term__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
    queryRows(`SELECT Id, STEM__c, Buyer_Broker__c, Refcode_Index__c, Exported__c, Commission_Lumpsum__c, STEM_Line_Item__r.Id FROM STEM_Buyer_Broker__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
    queryRows(`SELECT Id, Name, STEM__c, Proforma__c, Deprecated__c, Amount__c FROM Invoice__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
  ]);
  const supplierInvoiceIds = [...new Set([...lineItems.map((item) => item.Supplier_Invoice__c), ...extraCosts.map((item) => item.Supplier_Invoice__c)].filter(isSalesforceId))];
  const supplierInvoiceNameMap = await namesByIds('Supplier_Invoice__c', supplierInvoiceIds);
  const supplierInvoiceSupplierNameMap = {};
  for (const item of [...lineItems, ...extraCosts]) {
    if (item.Supplier_Invoice__c && item.Supplier_Name__c && !supplierInvoiceSupplierNameMap[item.Supplier_Invoice__c]) {
      supplierInvoiceSupplierNameMap[item.Supplier_Invoice__c] = item.Supplier_Name__c;
    }
  }

  const brokerAccountIds = [...new Set([...lineItems.map((item) => item.Supplier_Broker__c).filter(Boolean), ...lineItems.map((item) => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean), ...buyerBrokers.map((item) => item.Buyer_Broker__c).filter(Boolean)])];
  const brokerAccountMap = await namesByIds('Account', brokerAccountIds);
  for (const [id, name] of Object.entries(brokerAccountMap)) brokerAccountMap[String(id).slice(0, 15)] = name;
  const brokerCommissionGroupsByStem = buildBrokerCommissionGroups({
    stemMap: { [actualStemId]: recordRaw },
    lineItems,
    buyerBrokers,
    accountMap: brokerAccountMap,
  });
  const brokerCommissionGroups = brokerCommissionGroupsByStem[actualStemId] || [];
  const stemHasDelivery = !!recordRaw.Delivery_Date__c;
  const payableAmountCandidates = stemPayableAmountCandidates({
    stem: recordRaw,
    lineItems,
    extraCosts,
  });

  let supplierInvoicePayments = [];
  let buyerInvoicePayments = [];
  const brokerCommissionPaymentMap = new Map();
  const paymentDescribe = await salesforceObjectFields({
    objectName: 'Payment__c',
  }).catch(() => ({ fields: [] }));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  const paymentAmountField = ['Amount__c', 'Payment_Amount__c', 'Paid_Amount__c', 'Received_Amount__c', 'Total_Amount__c', 'Amount_Paid__c', 'Payment_Value__c', 'Actual_Amount__c'].find((field) => paymentFieldNames.has(field));
  const paymentDateField = firstAvailableField(paymentFieldNames, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const supplierInvoiceLookupFields = incomingPaymentSupplierInvoiceFields(paymentFields);
  const paymentReferenceFields = incomingPaymentReferenceFields(paymentFields);
  const paymentDirectionFields = incomingPaymentDirectionFields(paymentFields);
  const paymentStatusFields = selectedFields(paymentFieldNames, ['Status__c', 'Payment_Status__c']);
  const paymentTypeFields = selectedFields(paymentFieldNames, ['Type__c', 'Payment_Type__c']);
  const paymentSelectFields = ['Id', paymentFieldNames.has('Name') ? 'Name' : null, paymentFieldNames.has('RecordTypeId') ? 'RecordTypeId' : null, paymentFieldNames.has('RecordTypeId') ? 'RecordType.Name' : null, paymentFieldNames.has('RecordTypeId') ? 'RecordType.DeveloperName' : null, paymentFieldNames.has('STEM__c') ? 'STEM__c' : null, paymentFieldNames.has('CreatedDate') ? 'CreatedDate' : null, paymentDateField, ...supplierInvoiceLookupFields, paymentAmountField, ...paymentReferenceFields, ...paymentStatusFields, ...paymentTypeFields, ...paymentDirectionFields].filter(Boolean);
  const paymentOrder = paymentDateField ? `${paymentDateField} DESC NULLS LAST, CreatedDate DESC` : 'CreatedDate DESC';
  if (paymentSelectFields.length > 1) {
    const selectedPaymentFields = [...new Set(paymentSelectFields)];
    const paymentDateValue = (payment) => (paymentDateField ? payment[paymentDateField] : null) || payment.Date__c || payment.CreatedDate || null;
    const sortPaymentRows = (rows) => rows.sort((a, b) => String(paymentDateValue(b) || '').localeCompare(String(paymentDateValue(a) || '')));
    const decoratePayment = (payment, supplierInvoiceId = null) => ({
      ...payment,
      Date__c: paymentDateValue(payment),
      _Payment_Amount: paymentAmountField ? payment[paymentAmountField] : null,
      _Payment_Amount_Field: paymentAmountField || null,
      _Supplier_Invoice_Name: supplierInvoiceId ? supplierInvoiceNameMap[supplierInvoiceId] || supplierInvoiceId : null,
    });
    const supplierPaymentMap = new Map();
    const buyerPaymentMap = new Map();
    const addBrokerCommissionPayment = (payment, brokerMatch) => {
      if (!payment?.Id || !brokerMatch) return;
      supplierPaymentMap.delete(payment.Id);
      buyerPaymentMap.delete(payment.Id);
      if (!brokerCommissionPaymentMap.has(brokerMatch.key)) {
        brokerCommissionPaymentMap.set(brokerMatch.key, {
          ...brokerMatch,
          payments: [],
        });
      }
      brokerCommissionPaymentMap.get(brokerMatch.key).payments.push(decoratePayment(payment));
    };
    const addSupplierPayment = (payment, supplierInvoiceId = null) => {
      if (!payment?.Id) return;
      const invoiceId = supplierInvoiceId || incomingPaymentSupplierInvoiceId(payment, supplierInvoiceLookupFields);
      supplierPaymentMap.set(payment.Id, {
        ...decoratePayment(payment, invoiceId),
        _Supplier_Invoice_Name: invoiceId ? supplierInvoiceNameMap[invoiceId] || invoiceId : 'Supplier payment',
        _Supplier_Name: invoiceId ? supplierInvoiceSupplierNameMap[invoiceId] || supplierInvoiceNameMap[invoiceId] || invoiceId : 'Supplier payment',
      });
    };
    const addBuyerPayment = (payment) => {
      if (!payment?.Id) return;
      buyerPaymentMap.set(payment.Id, decoratePayment(payment));
    };

    if (supplierInvoiceIds.length && supplierInvoiceLookupFields.length) {
      await Promise.all(
        supplierInvoiceLookupFields.map(async (field) => {
          const paymentChunks = await compositeQueryRows(
            chunkIds(supplierInvoiceIds).map((chunk) => {
              const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
              return {
                soql: `
            SELECT ${selectedPaymentFields.join(', ')}
            FROM Payment__c
            WHERE ${field} IN (${inList})
            ORDER BY ${paymentOrder}
            LIMIT 2000
          `,
                limit: 2000,
                softFail: true,
              };
            }),
          );
          for (const payment of paymentChunks.flat()) addSupplierPayment(payment, payment[field]);
        }),
      );
    }
    if (paymentFieldNames.has('STEM__c')) {
      const stemPayments = await queryRows(
        `
        SELECT ${selectedPaymentFields.join(', ')}
        FROM Payment__c
        WHERE STEM__c = '${escapeSoql(actualStemId)}'
        ORDER BY ${paymentOrder}
        LIMIT 2000
      `,
        { limit: 2000, softFail: true },
      );
      for (const payment of stemPayments) {
        if (incomingPaymentIsReceivableRemittance(payment, [...paymentReferenceFields, ...paymentDirectionFields, ...paymentTypeFields, ...paymentStatusFields])) continue;
        const amount = paymentAmountField ? incomingPaymentNumber(payment[paymentAmountField]) : null;
        const brokerCommissionMatch = findBrokerCommissionPaymentMatch(payment, amount, brokerCommissionGroups, [...paymentReferenceFields, ...paymentDirectionFields, ...paymentTypeFields, ...paymentStatusFields]);
        if (brokerCommissionMatch) {
          addBrokerCommissionPayment(payment, brokerCommissionMatch);
          continue;
        }
        const bankCharge = incomingPaymentLooksBankCharge(payment, {
          referenceFields: paymentReferenceFields,
          directionFields: paymentDirectionFields,
          typeFields: paymentTypeFields,
          statusFields: paymentStatusFields,
        });
        if (bankCharge) continue;
        const supplierSide = incomingPaymentLooksSupplierSide(payment, {
          supplierInvoiceFields: supplierInvoiceLookupFields,
          directionFields: paymentDirectionFields,
          typeFields: paymentTypeFields,
          statusFields: paymentStatusFields,
        });
        if (supplierSide) {
          addSupplierPayment(payment);
        } else if (
          incomingPaymentLooksStemPayableCalculation(payment, {
            amount,
            payableAmounts: payableAmountCandidates,
            referenceFields: paymentReferenceFields,
            directionFields: paymentDirectionFields,
            typeFields: paymentTypeFields,
            statusFields: paymentStatusFields,
            allowBlankSignal: !stemHasDelivery,
          })
        ) {
          continue;
        } else if (amount == null || amount >= 0) {
          addBuyerPayment(payment);
        }
      }
    }
    supplierInvoicePayments = sortPaymentRows([...supplierPaymentMap.values()]);
    buyerInvoicePayments = sortPaymentRows([...buyerPaymentMap.values()]);
  }

  const [vesselName, portName, agentName, accountName, buyerBrokerName, factoringInvoiceName] = await Promise.all([recordRaw.Vessel__c ? resolveViaQuery('Vessel__c', recordRaw.Vessel__c, 'Name') : Promise.resolve(null), recordRaw.Port__c ? resolveViaQuery('Port__c', recordRaw.Port__c, 'Name') : Promise.resolve(null), recordRaw.Agent__c ? resolveViaQuery('Account', recordRaw.Agent__c, 'Name') : Promise.resolve(null), recordRaw.Account__c ? resolveViaQuery('Account', recordRaw.Account__c, 'Name') : Promise.resolve(null), recordRaw.Buyer_Broker__c ? resolveViaQuery('Account', recordRaw.Buyer_Broker__c, 'Name') : Promise.resolve(null), recordRaw.Factoring_Invoice__c ? resolveViaQuery('Invoice__c', recordRaw.Factoring_Invoice__c, 'Name') : Promise.resolve(null)]);

  const buyerBrokersWithNames = await Promise.all(
    buyerBrokers.map(async (bb) => ({
      ...bb,
      _Buyer_Broker_Name: bb.Buyer_Broker__c ? brokerAccountMap[bb.Buyer_Broker__c] || brokerAccountMap[String(bb.Buyer_Broker__c).slice(0, 15)] || (await resolveViaQuery('Account', bb.Buyer_Broker__c, 'Name')) : null,
    })),
  );

  const supplierBrokerIds = [...new Set(lineItems.map((li) => li.Supplier_Broker__c).filter(Boolean))];
  const supplierBrokerNameMap = {};
  await Promise.all(
    supplierBrokerIds.map(async (id) => {
      supplierBrokerNameMap[id] = brokerAccountMap[id] || brokerAccountMap[String(id).slice(0, 15)] || (await resolveViaQuery('Account', id, 'Name'));
    }),
  );

  const lineItemsWithNames = lineItems.map((li) => {
    const calculatedQuantity = financialQuantity(li, stemHasDelivery);
    const calculatedSell = lineSellAmount(li, stemHasDelivery);
    const calculatedBuy = lineBuyAmount(li, stemHasDelivery);
    return {
      ...li,
      _Financial_Quantity: calculatedQuantity,
      _Financial_Quantity_Unit: 'MT',
      ...(!stemHasDelivery
        ? {
            Total_Price__c: calculatedSell,
            Total_Cost__c: calculatedBuy,
          }
        : {}),
      _Product_Name: li['Product__r']?.Name ?? null,
      _Supplier_Broker_Name: li.Supplier_Broker__c ? supplierBrokerNameMap[li.Supplier_Broker__c] : null,
    };
  });
  const extraCostsWithNames = extraCosts.map((ec) => {
    const calculatedQuantity = financialQuantity(ec, stemHasDelivery, 'Quantity_Range_Max__c');
    const calculatedSell = extraSellAmount(ec, stemHasDelivery);
    const calculatedBuy = extraBuyAmount(ec, stemHasDelivery);
    return {
      ...ec,
      _Financial_Quantity: calculatedQuantity,
      _Financial_Quantity_Unit: 'MT',
      ...(!stemHasDelivery
        ? {
            Line_Total__c: calculatedSell,
            Line_Total_Buy__c: calculatedBuy,
          }
        : {}),
      _Product_Name: ec['Product2Id__r']?.Name ?? null,
    };
  });
  const calculatedLineItemSell = lineItems.reduce((sum, li) => {
    if (li.Cancelled__c) return sum;
    return sum + lineSellAmount(li, stemHasDelivery);
  }, 0);
  const calculatedExtraCostSell = extraCosts.reduce((sum, ec) => {
    if (ec.Cancelled__c) return sum;
    return sum + extraSellAmount(ec, stemHasDelivery);
  }, 0);
  const calculatedUndatedBuyerInvoice = calculatedLineItemSell + calculatedExtraCostSell;
  const buyerInvoiceResolution = resolveBuyerFinancialAmount({ salesforceAmount: recordRaw.Total_Invoice_Amount__c, calculatedAmount: calculatedUndatedBuyerInvoice, finalInvoiceIssued: buyerInvoices.some(isFinalBuyerInvoice) });
  const calculatedSupplierInvoice = payableAmountCandidates[0] ?? 0;
  const record = {
    ...recordRaw,
    Total_Invoice_Amount__c: buyerInvoiceResolution.amount,
    _Buyer_Invoice_Amount_Source: buyerInvoiceResolution.source,
    _Buyer_Invoice_Issued: buyerInvoices.some(isFinalBuyerInvoice),
    _Supplier_Invoice_Amount: calculatedSupplierInvoice,
    _Buyer_Pay_Term_Date: calculatedBuyerPayTermDate(recordRaw) || recordRaw.Invoice_Due_Date__c || recordRaw.Buyer_Pay_Term_Date__c,
    _Buyer_Name: recordRaw.Buyer_Name__c || accountName || recordRaw.Buyer__c || null,
    _Vessel_Name: vesselName,
    _Port_Name: portName,
    _Agent_Name: agentName,
    _Account_Name: accountName,
    _Buyer_Broker_Name: buyerBrokerName,
    _Factoring_Invoice_Name: factoringInvoiceName,
  };

  return {
    record,
    lineItems: lineItemsWithNames,
    extraCosts: extraCostsWithNames,
    buyerBrokers: buyerBrokersWithNames,
    supplierInvoicePayments,
    buyerInvoicePayments,
    brokerCommissionPayments: [...brokerCommissionPaymentMap.values()].map((group) => ({
      ...group,
      payments: group.payments.sort((a, b) => String(b.Date__c || '').localeCompare(String(a.Date__c || ''))),
    })),
  };
}

async function salesforceStemDetailFull(body, req = null, accessContext = null) {
  const hasWrite = Boolean((body?.updates && Object.keys(body.updates).length) || (body?.childUpdates && Object.keys(body.childUpdates).length));
  if (hasWrite) return salesforceStemDetailUncached(body, req, accessContext);
  const stemId = String(body?.stemId || '').trim();
  const cached = await cachedSalesforceValue({
    namespace: 'salesforce-stem-detail-v2',
    ttlSeconds: 15,
    payload: { stemId },
    tags: ['salesforce:stem', `salesforce:stem:${stemId}`],
    body,
    req,
    accessContext,
    loader: () => salesforceStemDetailUncached({ stemId }, req, accessContext),
  });
  return cached.value;
}

function uniquePresentValues(values) {
  return [...new Set(values.filter((value) => value != null && value !== ''))];
}

function singleOrMixed(values) {
  const unique = uniquePresentValues(values);
  if (!unique.length) return null;
  return unique.length === 1 ? unique[0] : 'Mixed';
}

function latestIsoDate(values) {
  const dates = uniquePresentValues(values).filter((value) => /^\d{4}-\d{2}-\d{2}/.test(String(value)));
  return dates.sort().at(-1) || null;
}

function addBrokerProductQuantity(group, row) {
  const productName = row.productFamily || row.productName || '—';
  const unit = row.quantityUnit || 'UOM not set';
  const key = `${productName}::${unit}`;
  if (!group._productMap.has(key)) {
    group._productMap.set(key, {
      productName,
      productFamily: row.productFamily || productName,
      quantity: 0,
      hasQuantity: false,
      unit,
    });
  }
  const item = group._productMap.get(key);
  const qty = numericValue(row.bdnQuantity);
  if (qty != null) {
    item.quantity += qty;
    item.hasQuantity = true;
  }
}

function combineBrokerCommissionRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const brokerKey = row.brokerId || row.brokerName || '';
    const key = [row.stemId, row.brokerType, brokerKey].join('::');
    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        id: `${row.brokerType}-${row.stemId}-${brokerKey}`.replace(/\s+/g, '-'),
        commissionAmount: 0,
        _productMap: new Map(),
        _commissionUnitPrices: [],
        _commissionUnitLines: [],
        _paymentDates: [],
        _paymentDateLabels: [],
        _paymentDelays: [],
      });
    }
    const group = groups.get(key);
    group.commissionAmount += Number(row.commissionAmount || 0);
    if (row.commissionUnitPrice != null) group._commissionUnitPrices.push(Number(row.commissionUnitPrice));
    group._commissionUnitLines.push({
      productName: row.productFamily || row.productName || '—',
      value: numericValue(row.commissionUnitPrice),
      unit: row.quantityUnit || 'UOM not set',
    });
    if (row.paymentDate) group._paymentDates.push(row.paymentDate);
    if (row.paymentDateLabel) group._paymentDateLabels.push(row.paymentDateLabel);
    if (row.paymentDelay != null) group._paymentDelays.push(Number(row.paymentDelay));
    addBrokerProductQuantity(group, row);
  }

  return [...groups.values()].map((group) => {
    const unitPrices = uniquePresentValues(group._commissionUnitPrices);
    const paymentDates = uniquePresentValues(group._paymentDates);
    const paymentDelays = uniquePresentValues(group._paymentDelays);
    const commissionUnitPriceLines = group._commissionUnitLines.map((item) => ({
      productName: item.productName,
      value: item.value,
      unit: item.unit,
      label: item.value != null ? `${money(item.value)} / ${item.unit}` : '—',
    }));
    const productQuantities = [...group._productMap.values()].map((item) => ({
      productName: item.productName,
      productFamily: item.productFamily || item.productName,
      quantity: item.hasQuantity ? item.quantity : null,
      quantityUnit: item.unit,
      label: item.hasQuantity ? `${item.productName} - ${formatQuantityLabel(item.quantity, item.unit)}` : item.productName,
    }));
    return {
      ...group,
      productName: productQuantities.map((item) => item.productName).join('; '),
      bdnQuantity: productQuantities.length === 1 ? productQuantities[0].quantity : null,
      quantityUnit: productQuantities.length === 1 ? productQuantities[0].quantityUnit : 'Mixed',
      productQuantities,
      productQuantityLabel: productQuantities.map((item) => item.label).join('; '),
      commissionUnitPrice: unitPrices.length === 1 ? unitPrices[0] : null,
      commissionUnitPriceLines,
      commissionUnitPriceLabel: commissionUnitPriceLines.map((item) => item.label).join('; '),
      paymentDate: paymentDates.length <= 1 ? paymentDates[0] || null : 'Mixed',
      paymentDateSort: latestIsoDate(paymentDates),
      paymentDateLabel: singleOrMixed(group._paymentDateLabels) || group.paymentDateLabel,
      paymentDelay: paymentDelays.length === 1 ? paymentDelays[0] : null,
      paymentDelayLabel: paymentDelays.length > 1 ? 'Mixed' : null,
      _productMap: undefined,
      _commissionUnitPrices: undefined,
      _commissionUnitLines: undefined,
      _paymentDates: undefined,
      _paymentDateLabels: undefined,
      _paymentDelays: undefined,
    };
  });
}

async function salesforceBrokerRegisterUncached(body, req = null, accessContext = null) {
  const limit = Math.min(Number(body.limit) || 2000, 3000);
  const [lineItemDescribe, productDescribe] = await Promise.all([
    salesforceObjectFields({ objectName: 'STEM_Line_Item__c' }).catch(() => ({ fields: [] })),
    salesforceObjectFields({ objectName: 'Product2' }).catch(() => ({ fields: [] })),
  ]);
  const lineItemUomField = findDashboardUomField(lineItemDescribe.fields || [], 'lineItem');
  const productUomField = findDashboardUomField(productDescribe.fields || [], 'product');
  const nativeUomSelect = [
    lineItemUomField,
    productUomField ? `Product__r.${productUomField}` : null,
  ].filter(Boolean);
  const interofficeCondition = await interofficeStemAccessCondition(accessContext);
  const whereClause = interofficeCondition ? `WHERE ${interofficeCondition}` : '';
  const stems = await queryRows(
    `
    SELECT Id, Name, Delivery_Date__c, Payment_Date__c, Buyer_Pay_Term_Date__c
    FROM stem__c
    ${whereClause}
    ORDER BY Delivery_Date__c DESC NULLS LAST
    LIMIT ${limit}
  `,
    { limit },
  );
  const stemMap = Object.fromEntries(stems.map((stem) => [stem.Id, stem]));
  const stemIds = stems.map((stem) => stem.Id);
  if (!stemIds.length) return { rows: [] };

  const stemChunks = chunkIds(stemIds);
  const [lineItemChunks, buyerBrokerChunks, buyerPaymentChunks, buyerInvoiceChunks] = await Promise.all([
    compositeQueryRows(
      stemChunks.map((chunk) => {
        const ids = chunk.map((id) => `'${id}'`).join(',');
        return {
          soql: `
        SELECT ${['Id', 'Name', 'STEM__c', 'Product__r.Name', 'Product__r.Family', 'Supplier_Invoice__c',
          ...nativeUomSelect,
        ].join(', ')},
               Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
               Quantity_Delivered_Per_BDN__c, Quantity__c, Quantity_in_MT__c, Commission_Cost__c, Cancelled__c,
               Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c,
               Buyers_Brokers_Commission_Lumpsum__c
        FROM STEM_Line_Item__c
        WHERE STEM__c IN (${ids})
        LIMIT 5000
      `,
          limit: 5000,
        };
      }),
    ),
    compositeQueryRows(
      stemChunks.map((chunk) => {
        const ids = chunk.map((id) => `'${id}'`).join(',');
        return {
          soql: `
        SELECT Id, Name, STEM__c, Buyer_Broker__c
        FROM STEM_Buyer_Broker__c
        WHERE STEM__c IN (${ids})
        LIMIT 5000
      `,
          limit: 5000,
        };
      }),
    ),
    compositeQueryRows(
      stemChunks.map((chunk) => {
        const ids = chunk.map((id) => `'${id}'`).join(',');
        return {
          soql: `
        SELECT STEM__c, Date__c
        FROM Payment__c
        WHERE STEM__c IN (${ids}) AND Supplier_Invoice__c = null
        ORDER BY Date__c DESC
        LIMIT 5000
      `,
          limit: 5000,
        };
      }),
    ),
    compositeQueryRows(
      stemChunks.map((chunk) => {
        const ids = chunk.map((id) => `'${id}'`).join(',');
        return {
          soql: `
        SELECT STEM__c, Invoice_Due_Date__c
        FROM Invoice__c
        WHERE STEM__c IN (${ids})
        ORDER BY Invoice_Due_Date__c DESC
        LIMIT 5000
      `,
          limit: 5000,
        };
      }),
    ),
  ]);

  const lineItems = lineItemChunks.flat();
  const buyerBrokers = buyerBrokerChunks.flat();
  const buyerPayments = buyerPaymentChunks.flat();
  const buyerInvoices = buyerInvoiceChunks.flat();
  const accountIds = [...new Set([...lineItems.map((item) => item.Supplier_Broker__c).filter(Boolean), ...lineItems.map((item) => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean), ...buyerBrokers.map((item) => item.Buyer_Broker__c).filter(Boolean)])];

  const accountChunks = await compositeQueryRows(
    chunkIds(accountIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return ids
        ? {
            soql: `SELECT Id, Name, Hidden_Broker__c, Hidden_Broker_Company__c FROM Account WHERE Id IN (${ids}) AND Inactive_Suspended__c = false`,
            softFail: true,
          }
        : null;
    }),
  );
  const accountMap = {};
  const accountFlagMap = {};
  for (const account of accountChunks.flat()) {
    const flags = {
      hiddenBrokerIndividual: account.Hidden_Broker__c === true,
      hiddenBrokerCompany: account.Hidden_Broker_Company__c === true,
    };
    accountMap[account.Id] = account.Name;
    accountMap[String(account.Id).slice(0, 15)] = account.Name;
    accountFlagMap[account.Id] = flags;
    accountFlagMap[String(account.Id).slice(0, 15)] = flags;
  }

  const supplierInvoiceIds = [...new Set(lineItems.map((item) => item.Supplier_Invoice__c).filter(Boolean))];
  const paymentDateByInvoice = {};
  const paymentChunks = await compositeQueryRows(
    chunkIds(supplierInvoiceIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return ids
        ? {
            soql: `SELECT Supplier_Invoice__c, Date__c FROM Payment__c WHERE Supplier_Invoice__c IN (${ids}) ORDER BY Date__c DESC`,
            softFail: true,
          }
        : null;
    }),
  );
  for (const payment of paymentChunks.flat()) {
    if (payment.Supplier_Invoice__c && !paymentDateByInvoice[payment.Supplier_Invoice__c]) paymentDateByInvoice[payment.Supplier_Invoice__c] = payment.Date__c;
  }

  const buyerPaymentDateByStem = {};
  for (const payment of buyerPayments) {
    if (payment.STEM__c && !buyerPaymentDateByStem[payment.STEM__c]) buyerPaymentDateByStem[payment.STEM__c] = payment.Date__c;
  }
  const buyerInvoiceDueDateByStem = {};
  for (const invoice of buyerInvoices) {
    if (invoice.STEM__c && !buyerInvoiceDueDateByStem[invoice.STEM__c]) buyerInvoiceDueDateByStem[invoice.STEM__c] = invoice.Invoice_Due_Date__c;
  }

  const buyerBrokersByStem = {};
  for (const item of buyerBrokers) {
    if (!item.STEM__c) continue;
    if (!buyerBrokersByStem[item.STEM__c]) buyerBrokersByStem[item.STEM__c] = [];
    buyerBrokersByStem[item.STEM__c].push(item);
  }

  const rawRows = [];
  const financialWarnings = new Set();
  for (const item of lineItems) {
    const stem = stemMap[item.STEM__c];
    if (!stem) continue;
    const nativeQuantity = nativeFinancialQuantity(item, {
      stemHasDelivery: !!stem.Delivery_Date__c,
      lineItemUomField,
      productUomField,
    });
    const qty = nativeQuantity.quantity;
    const quantityUnit = nativeQuantity.unitOfMeasure || 'UOM not set';
    if (nativeQuantity.warning) financialWarnings.add(`${stem.Name || 'STEM'} · ${item.Name || item.Id}: ${nativeQuantity.warning}`);
    const supplierAmount = item.Cancelled__c ? 0 : brokerAmount(item.Suppliers_Brokers_Commission_Per_Unit__c, qty);
    if (item.Supplier_Broker__c && supplierAmount !== 0) {
      rawRows.push({
        id: `supplier-${item.Id}`,
        stemId: item.STEM__c,
        stemName: stem.Name,
        brokerId: item.Supplier_Broker__c,
        productName: item['Product__r']?.Name || item.Name || '—',
        productFamily: item['Product__r']?.Family || item['Product__r']?.Name || item.Name || '—',
        bdnQuantity: qty || null,
        quantityUnit,
        deliveryDate: stem.Delivery_Date__c,
        brokerType: 'Supplier Broker',
        brokerName: accountMap[item.Supplier_Broker__c] || item.Supplier_Broker__c,
        hiddenBrokerIndividual: accountFlagMap[item.Supplier_Broker__c]?.hiddenBrokerIndividual || false,
        hiddenBrokerCompany: accountFlagMap[item.Supplier_Broker__c]?.hiddenBrokerCompany || false,
        commissionUnitPrice: item.Suppliers_Brokers_Commission_Per_Unit__c ?? null,
        commissionAmount: supplierAmount,
        paymentDate: paymentDateByInvoice[item.Supplier_Invoice__c] || null,
        paymentDateLabel: 'Paid Date',
      });
    }

    const buyerBrokerId = item.Buyers_Broker__c || item.Buyer_Broker__c;
    const hasSupplierBrokerUnit = Number(item.Suppliers_Brokers_Commission_Per_Unit__c || 0) !== 0;
    const buyerPerUnitAmount = brokerAmount(item.Buyers_Brokers_Commission_Per_Unit__c, qty);
    const buyerLumpsumAmount = Number(item.Buyers_Brokers_Commission_Lumpsum__c || 0);
    const buyerAmount = buyerLumpsumAmount || buyerPerUnitAmount;
    if (buyerBrokerId && buyerAmount !== 0) {
      rawRows.push({
        id: `buyer-${item.Id}`,
        stemId: item.STEM__c,
        stemName: stem.Name,
        brokerId: buyerBrokerId,
        productName: item['Product__r']?.Name || item.Name || '—',
        productFamily: item['Product__r']?.Family || item['Product__r']?.Name || item.Name || '—',
        bdnQuantity: qty || null,
        quantityUnit,
        deliveryDate: stem.Delivery_Date__c,
        brokerType: 'Buyer Broker',
        brokerName: accountMap[buyerBrokerId] || buyerBrokerId,
        hiddenBrokerIndividual: accountFlagMap[buyerBrokerId]?.hiddenBrokerIndividual || false,
        hiddenBrokerCompany: accountFlagMap[buyerBrokerId]?.hiddenBrokerCompany || false,
        commissionUnitPrice: item.Buyers_Brokers_Commission_Per_Unit__c ?? (qty ? buyerAmount / qty : null),
        commissionAmount: buyerAmount,
        paymentDate: stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c] || null,
        paymentDateLabel: 'Received Date',
        paymentDelay: paymentDelayDays(stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c], buyerInvoiceDueDateByStem[item.STEM__c] || stem.Buyer_Pay_Term_Date__c),
      });
    }

    const secondaryAmount = !hasSupplierBrokerUnit && item.Commission_Cost__c != null ? Number(item.Commission_Cost__c || 0) - buyerPerUnitAmount : 0;
    const secondaryBrokers = (buyerBrokersByStem[item.STEM__c] || []).filter((broker) => {
      if (!broker.Buyer_Broker__c) return true;
      if (!buyerBrokerId) return true;
      return String(broker.Buyer_Broker__c).slice(0, 15) !== String(buyerBrokerId).slice(0, 15);
    });
    if (secondaryAmount > 0 && secondaryBrokers.length > 0) {
      for (const broker of secondaryBrokers) {
        rawRows.push({
          id: `secondary-${item.Id}-${broker.Id}`,
          stemId: item.STEM__c,
          stemName: stem.Name,
          brokerId: broker.Buyer_Broker__c || null,
          productName: item['Product__r']?.Name || item.Name || '—',
          productFamily: item['Product__r']?.Family || item['Product__r']?.Name || item.Name || '—',
          bdnQuantity: qty || null,
          quantityUnit,
          deliveryDate: stem.Delivery_Date__c,
          brokerType: 'Secondary Buyer Broker',
          brokerName: accountMap[broker.Buyer_Broker__c] || broker.Buyer_Broker__c || 'Secondary Buyer Broker',
          hiddenBrokerIndividual: accountFlagMap[broker.Buyer_Broker__c]?.hiddenBrokerIndividual || false,
          hiddenBrokerCompany: accountFlagMap[broker.Buyer_Broker__c]?.hiddenBrokerCompany || false,
          commissionUnitPrice: qty ? secondaryAmount / qty : null,
          commissionAmount: secondaryAmount,
          paymentDate: stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c] || null,
          paymentDateLabel: 'Received Date',
          paymentDelay: paymentDelayDays(stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c], buyerInvoiceDueDateByStem[item.STEM__c] || stem.Buyer_Pay_Term_Date__c),
        });
      }
    }
  }

  const rows = combineBrokerCommissionRows(rawRows);
  rows.sort((a, b) => String(b.deliveryDate || '').localeCompare(String(a.deliveryDate || '')));
  return { rows, warnings: [...financialWarnings] };
}

async function salesforceBrokerRegisterFull(body, req = null, accessContext = null) {
  const limit = Math.min(Number(body.limit) || 2000, 3000);
  const cached = await cachedSalesforceValue({
    namespace: 'salesforce-broker-register',
    ttlSeconds: 60,
    payload: { limit },
    tags: ['salesforce:broker-register', 'salesforce:stem', 'salesforce:account'],
    body,
    req,
    accessContext,
    loader: () => salesforceBrokerRegisterUncached({ limit }, req, accessContext),
  });
  return cached.value;
}

async function hedgeCapabilities(context) {
  const entries = await Promise.all([
    'hedge_book_manage',
    'hedge_settlement_manage',
    'hedge_close_approve',
    'hedge_admin',
  ].map(async (capability) => [capability, await userHasCapability(context.client, context.profile, capability)]));
  return Object.fromEntries(entries);
}

async function hedgeDeskEntity(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return {
    data: await handleHedgeDeskEntity(body, context.profile, {
      client: context.client,
      capabilities: await hedgeCapabilities(context),
    }),
  };
}

async function hedgeMarkets(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  if (body.action === 'intelligence_brief') return { data: await loadMarketIntelligenceBrief(context.client, body) };
  if (body.action === 'intelligence_curve') return { data: await loadMarketIntelligenceCurve(context.client, body) };
  if (body.action === 'intelligence_valuation') return { data: await loadGovernedMarketValuation(context.client, body) };
  if (body.action === 'forward_fallback_save') {
    await requireCapability(context.client, context.profile, 'hedge_book_manage', 'Hedge book management permission is required to save a forward fallback.');
    return { data: await saveMarketForwardFallback(context.client, context.profile, body) };
  }
  if (body.action === 'intelligence_alert_rules_get') return { data: await getMarketIntelligenceAlertRules(context.client) };
  if (body.action === 'intelligence_alert_rules_save') {
    await requireCapability(context.client, context.profile, 'hedge_admin', 'Hedge administration permission is required to change market alert rules.');
    return { data: await saveMarketIntelligenceAlertRules(context.client, context.profile, body) };
  }
  if (body.action === 'intelligence_curve_cutover_save') {
    await requireCapability(context.client, context.profile, 'hedge_admin', 'Hedge administration permission is required to approve a curve cutover.');
    return { data: await saveMarketCurveShadowCutover(context.client, context.profile, body) };
  }
  const data = await handleHedgeMarkets(body, context.profile, {
    client: context.client,
    capabilities: await hedgeCapabilities(context),
  });
  if (['create', 'update', 'delete', 'save_spreads', 'verify_month', 'market_report_import'].includes(String(body.action || ''))) {
    await expireRuntimeCacheTags(['markets', 'hedge:markets', 'market:intelligence', 'market:pulse']);
  }
  return { data };
}

async function marketIntelligenceBrief(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return loadMarketIntelligenceBrief(context.client, body);
}

async function marketPulseSnapshot(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const [snapshot, capabilities] = await Promise.all([
    loadMarketPulseSnapshot(context.client, { ...body, force: requestForcesRefresh(body, req) }),
    hedgeCapabilities(context),
  ]);
  return {
    ...snapshot,
    // Capabilities are attached after the shared 60-second market-data cache resolves.
    // They must never be stored in, or inherited from, that cross-user cache entry.
    capabilities: {
      hedge_book_manage: capabilities?.hedge_book_manage === true,
      hedge_admin: capabilities?.hedge_admin === true,
    },
  };
}

async function marketIntelligenceCurve(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return loadMarketIntelligenceCurve(context.client, body);
}

async function marketReportCatalogue(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return loadMarketReportCatalogue(context.client, body);
}

async function marketReportAnalysis(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return analyzeMarketReportLibrary(context.client, context.profile, body, {
    onUsage: (usage) => recordDashboardAiUsage(context.client, context.profile, usage),
  });
}

async function marketIntelligenceValuation(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return loadGovernedMarketValuation(context.client, body);
}

async function marketForwardFallbackSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return saveMarketForwardFallback(context.client, context.profile, body);
}

async function marketIntelligenceAlertRulesGet(_body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return getMarketIntelligenceAlertRules(context.client);
}

async function marketIntelligenceAlertRulesSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return saveMarketIntelligenceAlertRules(context.client, context.profile, body);
}

async function marketIntelligenceCurveCutoverSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return saveMarketCurveShadowCutover(context.client, context.profile, body);
}

async function marketIntelligenceArchiveReplay(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'hedge_admin', 'Hedge administration permission is required to reconcile the licensed market archive.');
  requireExternalActionGate('google_drive');
  const accessToken = await googleDriveAccessToken();
  const result = await runMarketReportArchiveReplayBatch(context.client, {
    accessToken,
    cursor: body.cursor,
    expectedArchiveFingerprint: body.archiveFingerprint || null,
  });
  if (result.replayedCount > 0 || result.briefCompletedCount > 0) {
    await expireRuntimeCacheTags(['markets', 'hedge:markets', 'market:intelligence']);
  }
  return result;
}

async function marketIntradaySnapshotPreview(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'hedge_book_manage', 'Market-data management permission is required to review a provisional paper snapshot.');
  return previewMarketIntradaySnapshot(context.profile, body);
}

async function marketIntradaySnapshotSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'hedge_book_manage', 'Market-data management permission is required to save a provisional paper snapshot.');
  const saved = await saveMarketIntradaySnapshot(context.client, context.profile, body);
  await reconcileMarketIntradayDate(context.client, body.marketDate, context.profile).catch(() => ({ insertedCount: 0 }));
  await expireRuntimeCacheTags(['markets', 'hedge:markets', 'market:intelligence', 'market:pulse', 'market:intraday']);
  return saved;
}

async function marketIntradayTimeline(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return loadMarketIntradayTimeline(context.client, body);
}

async function hedgeDeskParseMops(body = {}) {
  return { ok: true, ...parseMopsText(body.raw_input || body.text || body.input || '') };
}

async function hedgeDeskGenerateInvoice(body = {}) {
  const generated = generateHedgeInvoicePdf(body);
  return {
    ok: true,
    base64: generated.buffer.toString('base64'),
    mimeType: 'application/pdf',
    filename: generated.filename,
  };
}

async function hedgeDeskSaveInvoicePdf(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'hedge_settlement_manage', 'Hedge settlement permission is required to store invoice documents.');
  return saveHedgeInvoicePdf(context.client, context.profile, body);
}

async function hedgeDeskSendInvoiceEmail(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'hedge_settlement_manage', 'Hedge settlement permission is required to send settlement invoices.');
  return sendHedgeInvoiceEmailIdempotent(context.client, context.profile, body);
}

async function hedgeDeskSfsReport(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return getHedgeSfsMonthReport(context.client, body.month);
}

async function hedgeDeskSfsFile(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return getHedgeSfsFile(context.client, body);
}

async function hedgeDeskSfsSend(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'hedge_close_approve', 'Hedge month-close approval permission is required to send SFS reports.');
  return approveAndSendHedgeSfsReport(context.client, context.profile, body);
}

async function hedgeDeskSalesforcePush(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'hedge_book_manage', 'Hedge book management permission is required for Salesforce synchronization.');
  return pushHedgeSalesforce(context.client, context.profile, body);
}

async function hedgeDeskSalesforcePreview(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'hedge_book_manage', 'Hedge book management permission is required for Salesforce allocation previews.');
  return previewHedgeSalesforce(context.client, context.profile, body);
}

async function hedgeDeskSalesforceMapping(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const capabilities = await hedgeCapabilities(context);
  void body;
  return { ...(await getHedgeSalesforceMapping(context.client)), canManage: capabilities.hedge_admin === true };
}

async function hedgeDeskAssistant(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return runHedgeAssistant(context.client, context.profile, body);
}

async function hedgeDeskAssistantSettings(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const capabilities = await hedgeCapabilities(context);
  return { ...(await hedgeAssistantSettings(context.client)), canManage: capabilities.hedge_admin === true };
}

async function hedgeDeskMaintenanceCron(body = {}, req = null) {
  requireCronAuthorization(req);
  return runHedgeMaintenance(supabaseAdminClient(), {
    forceIce: body.forceIce === true,
    dryRun: body.dryRun === true,
  });
}

async function marketReportDriveSyncCron(_body = {}, req = null) {
  requireCronAuthorization(req);
  requireExternalActionGate('google_drive');
  const client = supabaseAdminClient();
  const accessToken = await googleDriveAccessToken();
  const result = await runMarketReportDriveSync(client, { accessToken });
  if (result.status === 'failed') {
    throw appError('Scheduled Google Drive market-report synchronization did not complete.', 502, result.errorCode || 'MARKET_DRIVE_SYNC_FAILED', undefined, true);
  }
  if (result.importedCount > 0) await expireRuntimeCacheTags(['markets', 'hedge:markets', 'market:intelligence']);
  await resolveRecoveredSystemErrorHandler(client, 'marketReportDriveSyncCron', { resolvedThrough: new Date() }).catch(() => {});
  return result;
}

const withMasterContractUser = (service) => async (body = {}, req = null, accessContext = null) => service(body, accessContext || (await requireActiveUser(req)));
const masterContractsList = withMasterContractUser(listMasterContractsService);
const masterContractDetail = withMasterContractUser(getMasterContractService);
const masterContractSave = withMasterContractUser(saveMasterContractService);
const masterContractDecision = withMasterContractUser(decideMasterContractService);
const masterContractEvidencePrepare = withMasterContractUser(prepareMasterContractEvidenceService);
const masterContractEvidenceComplete = withMasterContractUser(completeMasterContractEvidenceService);
const masterContractEvidenceUrl = withMasterContractUser(getMasterContractEvidenceUrlService);
const masterContractOptions = withMasterContractUser(masterContractOptionsService);
const masterContractVesselCreate = withMasterContractUser(createMasterContractVesselService);
const masterContractPreflight = withMasterContractUser(preflightMasterContractService);
const masterContractBatchCreate = withMasterContractUser(createMasterContractBatchService);
const masterContractPriceResolve = withMasterContractUser(resolveMasterContractPriceService);
const masterContractPriceApply = withMasterContractUser(applyMasterContractPriceService);
const masterContractFeatureSave = withMasterContractUser(saveMasterContractFeatureService);
const masterContractReconcile = withMasterContractUser(reconcileMasterContractsService);

async function masterContractReconcileCron(body = {}, req = null) {
  requireCronAuthorization(req);
  return reconcileMasterContractsService(body, {
    client: supabaseAdminClient(),
    profile: { id: null, email: null, user_type: 'system' },
  });
}

async function specialTermsWorkspace(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const [workspace, canApproveClauses] = await Promise.all([
    listSpecialTerms({ force: body.force === true }),
    userHasCapability(context.client, context.profile, 'special_terms_clause_approve'),
  ]);
  const activeGeneralManager = context.profile.user_type === 'general_manager' ? await loadActiveGeneralManager(context.client) : null;
  const canApproveRevisions = canApproveClauses && (isAdministratorUserType(context.profile.user_type) || activeGeneralManager?.id === context.profile.id);
  return {
    ...workspace,
    canManage: true,
    canDraft: true,
    canApproveClauses: canApproveRevisions,
    canApproveRevisions,
    currentUserEmail: context.profile.email || '',
  };
}

async function specialTermsSummaryList(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const [summary, schema, canApproveClauses] = await Promise.all([
    listSpecialTermSummaries(body),
    resolveSpecialTermsSchema(),
    userHasCapability(context.client, context.profile, 'special_terms_clause_approve'),
  ]);
  const activeGeneralManager = context.profile.user_type === 'general_manager' ? await loadActiveGeneralManager(context.client) : null;
  const canApproveRevisions = canApproveClauses && (isAdministratorUserType(context.profile.user_type) || activeGeneralManager?.id === context.profile.id);
  return {
    ...summary,
    terms: (summary.terms || []).map((term) => !canApproveRevisions && term.nextAction === 'review_publish' ? { ...term, nextAction: 'continue' } : term),
    canDraft: true,
    canApproveClauses: canApproveRevisions,
    canApproveRevisions,
    currentUserEmail: context.profile.email || '',
    clauseCategoryOptions: schema.clauseCategoryOptions,
  };
}

async function specialTermsDocumentExport(body = {}, req, res, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const format = String(body.format || 'pdf').trim().toLowerCase();
  const source = String(body.source || 'live').trim().toLowerCase();
  if (!['pdf', 'docx'].includes(format)) throw appError('Choose PDF or Word document format.', 400, 'SPECIAL_TERMS_DOCUMENT_FORMAT_INVALID');
  if (!['live', 'draft'].includes(source)) throw appError('Choose a live document or saved draft preview.', 400, 'SPECIAL_TERMS_DOCUMENT_SOURCE_INVALID');
  if (source === 'draft' && format !== 'pdf') throw appError('Saved drafts may be downloaded as watermarked PDF only.', 409, 'SPECIAL_TERMS_DOCUMENT_DRAFT_FORMAT_RESTRICTED');
  const term = await getSpecialTermDocumentForExport(body.termId, {
    source,
    revisionId: body.revisionId,
    expectedLastModifiedAt: body.expectedLastModifiedAt,
    expectedRevisionLastModifiedAt: body.expectedRevisionLastModifiedAt,
    force: true,
  });
  const generated = await generateSpecialTermsDocument(term, {
    format,
    source,
    duplicateIndex: body.duplicateIndex,
  });
  await writeAdminAudit(context.client, context.profile, 'special_terms_document_exported', null, null, {
    termCount: 1,
    termId: term.id,
    format,
    source,
    pageCount: Number.isFinite(generated.pageCount) ? generated.pageCount : null,
    outcome: 'success',
  });
  const asciiFilename = generated.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.statusCode = 200;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', generated.contentType);
  res.setHeader('content-disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(generated.filename)}`);
  for (const [name, value] of Object.entries(telemetryResponseHeaders())) res.setHeader(name, value);
  res.end(generated.buffer);
}

/** Retained only for deployed FCOS clients that call the original route. */
async function specialTermsPdfExport(body = {}, req, res, accessContext = null) {
  return specialTermsDocumentExport({ ...body, format: 'pdf', source: body.source || 'live' }, req, res, accessContext);
}

async function specialTermsOptions(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  return { options: await specialTermOptions(body) };
}

async function isSpecialTermClauseApprover(context) {
  const hasCapability = await userHasCapability(context.client, context.profile, 'special_terms_clause_approve');
  if (!hasCapability) return false;
  const isAdministrator = context.profile.user_type === 'administrator';
  const activeGeneralManager = context.profile.user_type === 'general_manager'
    ? await loadActiveGeneralManager(context.client)
    : null;
  return isAdministrator || activeGeneralManager?.id === context.profile.id;
}

async function requireSpecialTermClauseApprover(context) {
  if (!(await isSpecialTermClauseApprover(context))) throw appError('Only the active General Manager or an Administrator may approve clause wording and migrations.', 403, 'SPECIAL_TERMS_CLAUSE_APPROVER_REQUIRED');
}

async function specialTermDetail(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const [detail, schema, canApproveClauses] = await Promise.all([
    getSpecialTermDetail(body.termId, { force: body.force === true }),
    resolveSpecialTermsSchema(),
    userHasCapability(context.client, context.profile, 'special_terms_clause_approve'),
  ]);
  const activeGeneralManager = context.profile.user_type === 'general_manager' ? await loadActiveGeneralManager(context.client) : null;
  const canApproveRevisions = canApproveClauses && (isAdministratorUserType(context.profile.user_type) || activeGeneralManager?.id === context.profile.id);
  return {
    ...detail,
    canDraft: true,
    canApproveClauses: canApproveRevisions,
    canApproveRevisions,
    currentUserEmail: context.profile.email || '',
    clauseCategoryOptions: schema.clauseCategoryOptions,
    audienceOptions: schema.audienceOptions,
    countryOptions: schema.countryOptions,
  };
}

async function specialTermClauseBank(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  return listSpecialTermClauseBank(body);
}

async function specialTermClauseSimilar(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  return listSpecialTermClauseSimilar(body.clauseId, { limit: body.limit });
}

async function specialTermClauseEditPreview(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return getSpecialTermClauseEditPreview(body, { canPublish: await isSpecialTermClauseApprover(context) });
}

async function specialTermClauseGlobalPublish(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireSpecialTermClauseApprover(context);
  return publishSpecialTermClauseGlobally(context.client, context.profile, body);
}

async function specialTermDeletePreview(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  const options = { isApprover: await isSpecialTermClauseApprover(context) };
  if (body.entityType === 'clause' || body.entityType === 'clauseVersion') return previewSpecialTermClauseDeletion(context.client, context.profile, body, options);
  return previewSpecialTermDeletion(context.client, context.profile, body, options);
}

async function specialTermMigrationInventory(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireSpecialTermClauseApprover(context);
  return getSpecialTermMigrationInventory({ force: body.force === true });
}

async function specialTermClauseDraftSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return saveSpecialTermClauseDraft(context.client, context.profile, body);
}

async function specialTermClauseApprove(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireSpecialTermClauseApprover(context);
  return approveSpecialTermClause(context.client, context.profile, body);
}

async function specialTermClauseRetire(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireSpecialTermClauseApprover(context);
  return retireSpecialTermClause(context.client, context.profile, body);
}

async function specialTermClauseDelete(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return deleteSpecialTermClause(context.client, context.profile, body, { isApprover: await isSpecialTermClauseApprover(context) });
}

async function specialTermClauseDraftDiscard(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return discardSpecialTermClauseDraft(context.client, context.profile, body, { isApprover: await isSpecialTermClauseApprover(context) });
}

async function specialTermClauseConsolidationList(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  return listSpecialTermClauseConsolidations({ includeClosed: body.includeClosed === true });
}

async function specialTermClauseConsolidationStart(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireSpecialTermClauseApprover(context);
  return startSpecialTermClauseConsolidation(context.client, context.profile, body);
}

async function specialTermClauseConsolidationRelink(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return relinkSpecialTermClauseConsolidation(context.client, context.profile, body);
}

async function specialTermClauseConsolidationCancel(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireSpecialTermClauseApprover(context);
  return cancelSpecialTermClauseConsolidation(context.client, context.profile, body);
}

async function specialTermClauseConsolidationComplete(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireSpecialTermClauseApprover(context);
  return completeSpecialTermClauseConsolidation(context.client, context.profile, body);
}

async function specialTermCompositionSave(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  throw appError('Direct projection composition is retired. Save a complete Special Term revision instead.', 409, 'SPECIAL_TERMS_WHOLE_REVISION_REQUIRED');
}

async function specialTermMigrationPreview(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  return previewSpecialTermMigration(body.termId, { projection: body.projection || 'termsText' });
}

async function specialTermMigrationSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return saveSpecialTermMigrationReview(context.client, context.profile, body);
}

async function specialTermMigrationSaveAll(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return saveAllSpecialTermMigrationReview(context.client, context.profile, body);
}

async function specialTermMigrationActivate(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  throw appError('Projection-level activation is retired. Approve and activate the complete Special Term revision.', 409, 'SPECIAL_TERMS_WHOLE_REVISION_REQUIRED');
}

async function specialTermMigrationPreviewAll(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  return previewSpecialTermMigrationAll(body.termId);
}

async function specialTermMigrationRollback(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  throw appError('Projection-level rollback is retired. Roll back the complete Special Term revision.', 409, 'SPECIAL_TERMS_WHOLE_REVISION_REQUIRED');
}

async function specialTermRevisionSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return saveSpecialTermRevision(context.client, context.profile, body);
}

async function specialTermRevisionCommit(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return commitSpecialTermRevision(context.client, context.profile, body, { canApprove: await isSpecialTermClauseApprover(context) });
}

async function specialTermRevisionApprove(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireSpecialTermClauseApprover(context);
  return approveSpecialTermRevision(context.client, context.profile, body);
}

async function specialTermRevisionRollback(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireSpecialTermClauseApprover(context);
  return rollbackSpecialTermRevision(context.client, context.profile, body);
}

async function specialTermMigrationBatchList(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  return listSpecialTermMigrationBatches({ force: body.force === true });
}

async function specialTermApprovalQueue(body = {}, req = null, accessContext = null) {
  accessContext || (await requireActiveUser(req));
  return listSpecialTermApprovalQueue({ force: body.force === true, limit: body.limit });
}

async function specialTermClauseAiDraft(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  return draftSpecialTermClausesWithAi(context.client, context.profile, body);
}

async function specialTermsSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'special_terms_manage', 'Special Terms drafting permission is required.');
  return saveSpecialTerm(context.client, context.profile, body);
}

async function specialTermsDelete(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'special_terms_manage', 'Special Terms management permission is required.');
  return deleteSpecialTerm(context.client, context.profile, body, { isApprover: await isSpecialTermClauseApprover(context) });
}

async function specialTermRuleSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'special_terms_manage', 'Special Terms drafting permission is required.');
  return saveSpecialTermRule(context.client, context.profile, body);
}

async function specialTermRuleDelete(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  await requireCapability(context.client, context.profile, 'special_terms_manage', 'Special Terms management permission is required.');
  return deleteSpecialTermRule(context.client, context.profile, body, { isApprover: await isSpecialTermClauseApprover(context) });
}

function nativeEmailRouterDependencies(accessContext) {
  return { client: accessContext.client, profile: accessContext.profile };
}

async function emailRouterList(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterList(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterBackgroundSync(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterBackgroundSync(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterLeave(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterLeave(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterLeaveSave(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterLeaveSave(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterDetail(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterDetail(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterDirectory(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterDirectory(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterDirectoryRefresh(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterDirectoryRefresh(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterPresets(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterPresets(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterAction(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterAction(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterActionStatus(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterActionStatus(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterUndo(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterUndo(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterRetry(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterRetry(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterFilingRetry(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterFilingRetry(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterAttachmentUrl(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterAttachmentUrl(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterAttachmentText(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterAttachmentText(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterHealth(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterHealth(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterAdvisor(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterAdvisor(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterSettings(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterSettings(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterSettingsSave(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterSettingsSave(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterOutbox(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterOutbox(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterDelta(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterDelta(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterSubscription(body = {}, req = null, accessContext = null) {
  return nativeEmailRouterSubscription(req, body, nativeEmailRouterDependencies(accessContext));
}

async function emailRouterMaintenanceCron(_body = {}, req = null) {
  requireCronAuthorization(req);
  const maintenanceStartedAt = new Date();
  const client = createEmailRouterServiceClient();
  const directorySync = await client.rpc('sync_emailrouter_fcos_destinations', { p_actor: null });
  const mailbox = await currentEmailRouterMailbox(client);
  const outbox = await processEmailRouterOutbox({ client, mailbox, limit: 25 });
  const learning = await processEmailRouterLearningJobs({ client, mailbox, limit: 10 }).catch((error) => ({ status: 'warning', code: error.code || 'EMAIL_ROUTER_LEARNING_FAILED' }));
  const synchronization = {};
  for (const folder of ['inbox', 'sentitems', 'archive']) {
    synchronization[folder] = await syncEmailRouterFolderFromStoredCursor({ client, mailbox, folder, maxPages: 10 });
  }
  let subscriptions = [];
  try {
    subscriptions = await maintainEmailRouterSubscriptions({ client, mailbox });
    await resolveEmailRouterAlert(client, { dedupeKey: `mailbox:${mailbox.id}:subscriptions` });
  } catch (error) {
    await recordEmailRouterAlert(client, { mailboxId: mailbox.id, code: error.code || 'email_router_subscription_failed', severity: 'critical', dedupeKey: `mailbox:${mailbox.id}:subscriptions` });
    throw error;
  }
  if (!directorySync.error && learning?.status !== 'warning') {
    await resolveRecoveredSystemErrorHandler(client, 'emailRouterMaintenanceCron', {
      resolvedThrough: maintenanceStartedAt,
      seenSince: new Date(maintenanceStartedAt.getTime() - 15 * 60_000),
    }).catch((error) => {
      console.warn('[email-router] Recovered maintenance notification could not be resolved.', {
        code: error?.code || 'EMAIL_ROUTER_NOTIFICATION_RECOVERY_FAILED',
      });
    });
  }
  return {
    ok: true,
    directory: directorySync.error ? { status: 'warning' } : { status: 'synchronized' },
    outbox,
    learning,
    synchronization: Object.fromEntries(Object.entries(synchronization).map(([folder, result]) => [folder, { synced: result.synced, removed: result.removed, pages: result.pages, complete: !result.nextLink }])),
    subscriptions: subscriptions.map((item) => ({ folder: item.folder, state: item.state, expiresAt: item.expiresAt })),
  };
}

const withXeroPortalUser = (service, { recoveredHandler = null } = {}) => async (body = {}, req = null, accessContext = null) => {
  const startedAt = new Date();
  const context = accessContext || (await requireActiveUser(req));
  const result = await service(body, { req, accessContext: context });
  if (recoveredHandler) {
    await resolveRecoveredSystemErrorHandler(context.client, recoveredHandler, {
      resolvedThrough: startedAt,
      resolvedAt: new Date(),
    }).catch((error) => {
      console.warn('[xero-portal] Recovered notification could not be resolved.', {
        handler: recoveredHandler,
        code: error?.code || 'XERO_PORTAL_NOTIFICATION_RECOVERY_FAILED',
      });
    });
  }
  return result;
};

const xeroPortalStatus = withXeroPortalUser(xeroPortalStatusService);
const xeroPortalConnectStart = withXeroPortalUser(xeroPortalConnectStartService);
const xeroPortalDisconnect = withXeroPortalUser(xeroPortalDisconnectService);
const xeroPortalReceiptsList = withXeroPortalUser(xeroPortalReceiptsListService);
const xeroPortalReceiptCreate = withXeroPortalUser(xeroPortalReceiptCreateService);
const xeroPortalReceiptSync = withXeroPortalUser(xeroPortalReceiptSyncService);
const xeroPortalReceiptFileUrl = withXeroPortalUser(xeroPortalReceiptFileUrlService);
const xeroPortalContactLifecycleStatus = withXeroPortalUser(xeroPortalContactLifecycleStatusService);
const xeroPortalContactLifecycleLatest = withXeroPortalUser(xeroPortalContactLifecycleLatestService);
const xeroPortalContactLifecycleRun = withXeroPortalUser(xeroPortalContactLifecycleRunService);
const xeroPortalContactLifecyclePreview = withXeroPortalUser(xeroPortalContactLifecyclePreviewService, {
  recoveredHandler: 'xeroPortalContactLifecyclePreview',
});
const xeroPortalContactLifecycleApply = withXeroPortalUser(xeroPortalContactLifecycleApplyService);
const xeroPortalContactAutoCreateLatest = withXeroPortalUser(xeroPortalContactAutoCreateLatestService);
const xeroPortalContactAutoCreateRun = withXeroPortalUser(xeroPortalContactAutoCreateRunService);
const xeroFinancialMappingsGet = withXeroPortalUser(xeroFinancialMappingsGetService);
const xeroFinancialMappingsSave = withXeroPortalUser(xeroFinancialMappingsSaveService);
const xeroFinancialSyncPreview = withXeroPortalUser(xeroFinancialSyncPreviewService, {
  recoveredHandler: 'xeroFinancialSyncPreview',
});
const xeroFinancialSyncApply = withXeroPortalUser(xeroFinancialSyncApplyService);
const xeroFinancialSyncRun = withXeroPortalUser(xeroFinancialSyncRunService);
const xeroFinancialPaymentApply = withXeroPortalUser(xeroFinancialPaymentApplyService);

const handlers = {
  authContext,
  portalApplicationsList,
  portalApplicationLaunch,
  portalSignOut,
  portalEntitlementSyncCron,
  collaborationList,
  collaborationDetail,
  collaborationCreate,
  collaborationUpdate,
  collaborationBulkUpdate,
  collaborationFollowerToggle,
  collaborationDependencySave,
  collaborationDependencyRemove,
  collaborationMilestoneSave,
  collaborationTemplateList,
  collaborationTemplateSave,
  collaborationArchive,
  collaborationCommentSave,
  collaborationCommentDelete,
  collaborationAttachmentPrepare,
  collaborationAttachmentComplete,
  collaborationAttachmentUrl,
  collaborationAttachmentDelete,
  collaborationNotificationsList,
  collaborationNotificationsRead,
  collaborationDailyCron,
  improvementsList,
  improvementDetail,
  improvementCreate,
  improvementPropose,
  improvementDecision,
  improvementAttachmentPrepare,
  improvementAttachmentComplete,
  improvementAttachmentUrl,
  improvementAttachmentDelete,
  workNotificationsList,
  workNotificationsRead,
  workNotificationsState,
  systemErrorVerify,
  workCommitmentsList,
  navigationPreferencesGet,
  navigationPreferencesSave,
  navigationPreferencesReset,
  workspacePreferencesGet,
  workspacePreferencesSave,
  emailRouterList,
  emailRouterBackgroundSync,
  emailRouterLeave,
  emailRouterLeaveSave,
  emailRouterDetail,
  emailRouterDirectory,
  emailRouterDirectoryRefresh,
  emailRouterPresets,
  emailRouterAction,
  emailRouterActionStatus,
  emailRouterUndo,
  emailRouterRetry,
  emailRouterFilingRetry,
  emailRouterAttachmentUrl,
  emailRouterAttachmentText,
  emailRouterHealth,
  emailRouterAdvisor,
  emailRouterSettings,
  emailRouterSettingsSave,
  emailRouterOutbox,
  emailRouterDelta,
  emailRouterSubscription,
  emailRouterMaintenanceCron,
  xeroPortalStatus,
  xeroPortalConnectStart,
  xeroPortalDisconnect,
  xeroPortalReceiptsList,
  xeroPortalReceiptCreate,
  xeroPortalReceiptSync,
  xeroPortalReceiptFileUrl,
  xeroPortalContactLifecycleStatus,
  xeroPortalContactLifecycleLatest,
  xeroPortalContactLifecycleRun,
  xeroPortalContactLifecyclePreview,
  xeroPortalContactLifecycleApply,
  xeroPortalContactAutoCreateLatest,
  xeroPortalContactAutoCreateRun,
  xeroFinancialMappingsGet,
  xeroFinancialMappingsSave,
  xeroFinancialSyncPreview,
  xeroFinancialSyncApply,
  xeroFinancialSyncRun,
  xeroFinancialPaymentApply,
  hedgeDeskEntity,
  hedgeMarkets,
  marketPulseSnapshot,
  marketIntelligenceBrief,
  marketIntelligenceCurve,
  marketReportCatalogue,
  marketReportAnalysis,
  marketIntelligenceValuation,
  marketForwardFallbackSave,
  marketIntelligenceAlertRulesGet,
  marketIntelligenceAlertRulesSave,
  marketIntelligenceCurveCutoverSave,
  marketIntelligenceArchiveReplay,
  marketIntradaySnapshotPreview,
  marketIntradaySnapshotSave,
  marketIntradayTimeline,
  hedgeDeskParseMops,
  hedgeDeskGenerateInvoice,
  hedgeDeskSaveInvoicePdf,
  hedgeDeskSendInvoiceEmail,
  hedgeDeskSfsReport,
  hedgeDeskSfsFile,
  hedgeDeskSfsSend,
  hedgeDeskSalesforcePush,
  hedgeDeskSalesforcePreview,
  hedgeDeskSalesforceMapping,
  hedgeDeskAssistant,
  hedgeDeskAssistantSettings,
  hedgeDeskMaintenanceCron,
  marketReportDriveSyncCron,
  masterContractsList,
  masterContractDetail,
  masterContractSave,
  masterContractDecision,
  masterContractEvidencePrepare,
  masterContractEvidenceComplete,
  masterContractEvidenceUrl,
  masterContractOptions,
  masterContractVesselCreate,
  masterContractPreflight,
  masterContractBatchCreate,
  masterContractPriceResolve,
  masterContractPriceApply,
  masterContractFeatureSave,
  masterContractReconcile,
  masterContractReconcileCron,
  specialTermsWorkspace,
  specialTermsSummaryList,
  specialTermsOptions,
  specialTermDetail,
  specialTermClauseBank,
  specialTermClauseSimilar,
  specialTermClauseEditPreview,
  specialTermClauseGlobalPublish,
  specialTermDeletePreview,
  specialTermMigrationInventory,
  specialTermClauseDraftSave,
  specialTermClauseApprove,
  specialTermClauseRetire,
  specialTermClauseDelete,
  specialTermClauseDraftDiscard,
  specialTermClauseConsolidationList,
  specialTermClauseConsolidationStart,
  specialTermClauseConsolidationRelink,
  specialTermClauseConsolidationCancel,
  specialTermClauseConsolidationComplete,
  specialTermCompositionSave,
  specialTermMigrationPreview,
  specialTermMigrationPreviewAll,
  specialTermMigrationSaveAll,
  specialTermMigrationSave,
  specialTermMigrationActivate,
  specialTermMigrationRollback,
  specialTermRevisionSave,
  specialTermRevisionCommit,
  specialTermRevisionApprove,
  specialTermRevisionRollback,
  specialTermMigrationBatchList,
  specialTermApprovalQueue,
  specialTermClauseAiDraft,
  specialTermsSave,
  specialTermsDelete,
  specialTermRuleSave,
  specialTermRuleDelete,
  growthReportingLinesList,
  growthReportingLineSave,
  growthReportingLinesSaveBatch,
  growthCoachingBootstrap,
  growthPlanSave,
  growthPlanCloseout,
  growthGoalSave,
  growthGoalSubmit,
  growthGoalDecision,
  growthGoalProgressSave,
  growthGoalCompletion,
  growthGoalEvidenceOptions,
  growthGoalEvidenceSave,
  coachingRelationshipInvite,
  coachingRelationshipRespond,
  coachingRelationshipEnd,
  coachingSessionSave,
  coachingSessionContentSave,
  coachingSessionConfirm,
  coachingSessionCancel,
  coachingActionSave,
  coachingActionPublish,
  coachingActionProposalRespond,
  growthAttachmentPrepare,
  growthAttachmentComplete,
  growthAttachmentUrl,
  growthEmailPreferencesSave,
  coachingCalendarResolve,
  coachingCalendarRetry,
  growthCoachingDailyCron,
  salesforceSchema,
  salesforceObjectFields,
  dashboardFilterOptions,
  salesforceFullSchema,
  salesforceDashboard,
  salesforceDashboardFiltered: salesforceDashboardFilteredCompatibility,
  dashboardSummary,
  dashboardStemList,
  dashboardAnalytics,
  dashboardAccountInsight,
  dashboardAccountCreditDirectory,
  dashboardAccountCreditStatement,
  dashboardCreditForecastSettingsSave,
  dashboardCounterpartySearch,
  dashboardAccountExposureBatch,
  dashboardAiSearch,
  dashboardAiSettingsGet,
  dashboardAiSettingsSave,
  salesforceStemDetail: salesforceStemDetailFull,
  salesforceStemDocuments,
  unofficialCompensationList,
  unofficialCompensationOptions,
  unofficialCompensationClaimCreate,
  unofficialCompensationClaimGroupStatus,
  unofficialCompensationRecoveryCreate,
  unofficialCompensationRecoveryDelete,
  exceptionReviewWorkflowList,
  exceptionReviewWorkflowSave,
  salesforceDescribeChildren,
  salesforceTopBuyers,
  salesforceBrokerRegister: salesforceBrokerRegisterFull,
  salesforceBuyerInvoicesDue,
  buyerInvoiceCollectionList,
  buyerInvoiceCollectionSave,
  buyerInvoiceCollectionEventCreate,
  buyerInvoicePaymentAdviceSave,
  paymentCollectionsReconcile,
  shipAgentChargesList,
  shipAgentChargesDetail,
  shipAgentChargesOptions,
  shipAgentChargesSaveConfirm,
  shipAgentChargesGmOverride,
  shipAgentChargesPostInvoiceResolve,
  shipAgentChargesSync,
  variableChargesList,
  variableChargesDetail,
  variableChargesAnchorageSave, variableChargesVesselNrtSave, variableChargesLightDuesSave, variableChargesSettingsGet, variableChargesSettingsSave,
  variableChargesOptions,
  variableChargesSupplierVerify,
  variableChargesBuyerConfirm,
  variableChargesSideAssign,
  variableChargesSideConfirm,
  variableChargesGmOverride,
  variableChargesPostInvoiceResolve,
  variableChargesSync,
  buyerInvoicePostingReminderOverrideSave,
  paymentCollectionsReconcileCron,
  buyerInvoiceEmailSettingsGet,
  buyerInvoiceEmailSettingsSave,
  buyerInvoiceReminderRulesList,
  buyerInvoiceReminderRuleSave,
  buyerInvoiceReminderRuleRemove,
  buyerInvoicePaymentReminderPrepare,
  buyerInvoicePaymentReminderSend,
  outstandingBuyerInvoicesEmailReport,
  outstandingBuyerInvoicesEmailCron,
  incomingPaymentsList,
  incomingPaymentEmailSettingsGet,
  incomingPaymentEmailSettingsSave,
  incomingPaymentInterestSettingsGet,
  incomingPaymentInterestSettingsSave,
  incomingPaymentEmailReport,
  incomingPaymentInterestInvoiceRequest,
  incomingPaymentSettingsGet,
  incomingPaymentSettingsSave,
  incomingPaymentAllocationConfirm,
  cashflowForecast,
  cashflowBuyerPaymentPerformance,
  cashflowSettingsGet,
  cashflowSettingsSave,
  cashflowHolidayCalendar,
  salesforceDisputeStems,
  disputeBetaList,
  disputeBetaSaveDraft,
  disputeBetaSubmitApproval,
  disputeBetaApprove,
  disputeBetaReject,
  disputeBetaMarkExecuted,
  disputeBetaClose,
  disputeWorkflowList: disputeBetaList,
  disputeWorkflowSaveDraft: disputeBetaSaveDraft,
  disputeWorkflowSubmitApproval: disputeBetaSubmitApproval,
  disputeWorkflowApprove: disputeBetaApprove,
  disputeWorkflowReject: disputeBetaReject,
  disputeWorkflowAccountingUpdate,
  disputeWorkflowSupplierInstructionUpdate,
  disputeWorkflowSupplierOffsetOptions,
  disputeWorkflowSupplierAmountAmend,
  disputeWorkflowUploadDocument,
  disputeWorkflowDocuments,
  disputeWorkflowMarkExecuted: disputeBetaMarkExecuted,
  disputeWorkflowClose: disputeBetaClose,
  disputeWorkflowCompensationClaims,
  disputeWorkflowCompensationClaimLink,
  disputeWorkflowAcceptExternalClosure,
  stemPnl: stemPnlFull,
  frankfurterUsdCnyRate,
  brokerCommissionSettingsGet,
  brokerCommissionSettingsSave,
  reportExportCreate,
  reportExportsList,
  reportExportRename,
  reportExportDelete,
  reportExportDownload,
  buyersAdministratorList,
  buyersAdministratorSave,
  accountManagersList,
  accountManagersSave,
  accountManagersSaveNote,
  accountManagersRetrySync,
  accountPicDirectoryList,
  accountPicAccountOptions,
  accountPicTraderOptions,
  accountPicDirectoryDetail,
  accountPicDirectorySave,
  accountPicDirectoryImport,
  accountPicRowColorsSave,
  emailSenderStatus,
  emailSenderMailboxSave,
  emailSenderRouteSave,
  systemHealth,
  adminUsersList,
  adminAuditLogs,
  adminUserSave,
  adminUserDelete,
  adminPortalAccessSave,
  adminPortalAccessRetry,
  adminPortalApplicationsHealth,
  adminUserTypeSave,
  adminUserTypeDelete,
  adminFcosUpdatesList,
  adminFcosUpdatesSync,
  adminFcosUpdateItemSave,
  adminFcosUpdateBatchSave,
  adminFcosUpdateBatchCancel,
  adminFcosUpdateItemSkip,
  adminFcosUpdateItemRestore,
  adminFcosUpdateBatchSend,
  adminFcosUpdateDeliveryRetry,
  universalAuditTrail,
};

const handlersWithoutAccessPolicy = Object.keys(handlers).filter((handlerName) => !handlerPolicyFor(HANDLER_POLICY_REGISTRY, handlerName));
if (handlersWithoutAccessPolicy.length) {
  throw new Error(`FCOS handler access policy is missing for: ${handlersWithoutAccessPolicy.join(', ')}`);
}

function publicApiErrorPayload(error, status, requestId) {
  const exposeMessage = status < 500 || error?.expose === true;
  const codeToken = String(error?.code || (status >= 500 ? 'FCOS_INTERNAL_ERROR' : 'FCOS_REQUEST_REJECTED'))
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 100) || 'FCOS_INTERNAL_ERROR';
  const message = exposeMessage
    ? String(error?.message || 'The FCOS request could not be completed.')
    : 'FCOS could not complete this operation. Use the request reference when reporting the problem.';
  const conflictDetails = status === 409 && error?.details !== undefined
    ? JSON.parse(JSON.stringify(error.details))
    : undefined;
  return {
    error: message,
    message,
    code: codeToken,
    requestId,
    ...(conflictDetails !== undefined ? { details: conflictDetails } : {}),
    ...(status === 409 && error?.details?.current !== undefined ? { current: error.details.current } : {}),
  };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const name = url.pathname.split('/').pop();
  const requestId = requestIdFrom(req);
  return runWithRequestTelemetry(
    {
      handler: name,
      requestId,
    },
    async () => {
      try {
        const handlerPolicy = handlerPolicyFor(HANDLER_POLICY_REGISTRY, name);
        if (handlerPolicy && typeof res?.setHeader === 'function') {
          res.setHeader('X-FCOS-Handler-Mutation', handlerPolicy.mutation ? '1' : '0');
          res.setHeader('X-FCOS-External-Action', handlerPolicy.externalAction ? '1' : '0');
        }
        if (name === 'salesforceDocumentDownload') {
          await requireHandlerAccess(name, req);
          return await salesforceDocumentDownload(req, res);
        }
        if (name === 'dashboardAccountInsightExport') {
          const accessContext = await requireHandlerAccess(name, req);
          const body = await readBody(req);
          return await dashboardAccountInsightExport(body, req, res, accessContext);
        }
        if (name === 'specialTermsPdfExport' || name === 'specialTermsDocumentExport') {
          const accessContext = await requireHandlerAccess(name, req);
          const body = await readBody(req);
          return name === 'specialTermsPdfExport'
            ? await specialTermsPdfExport(body, req, res, accessContext)
            : await specialTermsDocumentExport(body, req, res, accessContext);
        }
        const fn = handlers[name];
        if (!fn) return sendJson(res, { error: `Unknown function: ${name}` }, 404);
        const accessContext = await requireHandlerAccess(name, req);
        const body = await readBody(req);
        const data = await fn(body, req, accessContext);
        return sendJson(res, data);
      } catch (error) {
        const status = error.status || error.statusCode || 500;
        recordRequestFailure(error, status);
        if (shouldNotifySystemError(status)) {
          try {
            await reportSystemError(safeSupabaseAdminClient(), {
              handler: name,
              error,
              status,
              requestId,
            });
          } catch (notificationError) {
            console.error('[system-error-notification] recording failed', {
              handler: name,
              message: notificationError.message,
            });
          }
        }
        return sendJson(res, publicApiErrorPayload(error, status, requestId), status);
      } finally {
        logRequestTelemetry(res.statusCode || 500);
      }
    },
  );
}
