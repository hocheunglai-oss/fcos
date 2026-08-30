YªçŠx-®éÜj×¢ëiºÚ+Š§j[h‘éÜ¢éíß^5ßÍ´ïÞ÷o+^²‰¢¶×import { chunkIds, cleanRecord, getApiVersion, getInstanceUrl, salesforceAuthMode, salesforceConfiguredAuthModes, sendJson, sfCompositeQueries, sfDownload, sfQuery, sfRequest } from '../_salesforce.js';
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
import { enforceFcunoFederatedAccess, fcunoFederationConfig } from '../_fcunoIdentityFederation.js';
import { GOOGLE_DRIVE_MARKET_OAUTH_REQUIRED_ENV, exchangeGoogleDriveRefreshToken, googleDriveMarketOAuthConfig } from '../_googleDriveOAuth.js';
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
import { FUNCTION_CONTRACT_VERSION, validateFunctionRequest } from '../../shared/functionContracts.js';
import { publicApiErrorPayload } from '../_publicApiError.js';
import { withActiveUser } from '../_handlerAdapters.js';
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
import { runMarketReportArchiveReplayBatch, runMarketReportDriveSync, verifyMarketDriveAuthority } from '../_marketDriveSync.js';
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
import { createXeroHandlers, XERO_HANDLER_MODULE_ACCESS } from '../_xeroHandlers.js';
export const config = { maxDuration: 300 };

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
    id: 'buyers_administrator',
    label: 'Account Managers',
    path: '/account-managers',
    sortOrder: 85,
  },
  { id: 'master_contracts', label: 'Master Contracts', path: '/master-contracts', sortOrder: 84 },
  { id: 'markets', label: 'Markets', path: '/markets', sortOrder: 86 },
  { id: 'special_terms', label: 'Special Terms', path: '/special-terms', sortOrder: 87 },
  { id: 'hedge_desk', label: 'Hedge Desk', path: '/hedge-desk', sortOrder: 88 },
  { id: 'xero_portal', label: 'Xero Portal', path: '/xero-portal', sortOrder: 89 }, { id: 'email_router', label: 'Email Router', path: '/email-router', sortOrder: 91 },
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
  { id: 'broker_settings_manage', label: 'Manage Broker Commission Settings', description: 'Change the company exchange-rate provider used by Broker Commissions.' }, { id: 'xero_portal_manage', label: 'Manage Xero Portal', description: 'Connect Xero, create receipt draft bills, rename contacts, and archive unused contacts.' },
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
    special_terms: true, xero_portal: true,
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
    broker_settings_manage: true, xero_portal_manage: true,
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

  const { data: storedProfile, error: profileError } = await client.from('user_profiles').select('id,email,full_name,user_type,active,use_type_defaults').eq('id', userData.user.id).maybeSingle();
  if (profileError) throw profileError;
  const profile = await enforceFcunoFederatedAccess({
    client,
    authUser: userData.user,
    profile: storedProfile,
    accessToken: token,
  });
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

const collaborationList = withActiveUser(collaborationListService, requireActiveUser);
const collaborationDetail = withActiveUser(collaborationDetailService, requireActiveUser);
const collaborationCreate = withActiveUser(collaborationCreateService, requireActiveUser);
const collaborationUpdate = withActiveUser(collaborationUpdateService, requireActiveUser);
const collaborationBulkUpdate = withActiveUser(collaborationBulkUpdateService, requireActiveUser);
const collaborationFollowerToggle = withActiveUser(collaborationFollowerToggleService, requireActiveUser);
const collaborationDependencySave = withActiveUser(collaborationDependencySaveService, requireActiveUser);
const collaborationDependencyRemove = withActiveUser(collaborationDependencyRemoveService, requireActiveUser);
const collaborationMilestoneSave = withActiveUser(collaborationMilestoneSaveService, requireActiveUser);
const collaborationTemplateList = withActiveUser(collaborationTemplateListService, requireActiveUser);
const collaborationTemplateSave = withActiveUser(collaborationTemplateSaveService, requireActiveUser);
const collaborationArchive = withActiveUser(collaborationArchiveService, requireActiveUser);
const collaborationCommentSave = withActiveUser(collaborationCommentSaveService, requireActiveUser);
const collaborationCommentDelete = withActiveUser(collaborationCommentDeleteService, requireActiveUser);
const collaborationAttachmentPrepare = withActiveUser(collaborationAttachmentPrepareService, requireActiveUser);
const collaborationAttachmentComplete = withActiveUser(collaborationAttachmentCompleteService, requireActiveUser);
const collaborationAttachmentUrl = withActiveUser(collaborationAttachmentUrlService, requireActiveUser);
const collaborationAttachmentDelete = withActiveUser(collaborationAttachmentDeleteService, requireActiveUser);
const collaborationNotificationsList = withActiveUser(collaborationNotificationsListService, requireActiveUser);
const collaborationNotificationsRead = withActiveUser(collaborationNotificationsReadService, requireActiveUser);
const improvementsList = withActiveUser(improvementsListService, requireActiveUser);
const improvementDetail = withActiveUser(improvementDetailService, requireActiveUser);
const improvementCreate = withActiveUser(improvementCreateService, requireActiveUser);
const improvementPropose = withActiveUser(improvementProposeService, requireActiveUser);
const improvementDecision = withActiveUser(improvementDecisionService, requireActiveUser);
const improvementAttachmentPrepare = withActiveUser(improvementAttachmentPrepareService, requireActiveUser);
const improvementAttachmentComplete = withActiveUser(improvementAttachmentCompleteService, requireActiveUser);
const improvementAttachmentUrl = withActiveUser(improvementAttachmentUrlService, requireActiveUser);
const improvementAttachmentDelete = withActiveUser(improvementAttachmentDeleteService, requireActiveUser);

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
    markets,
    specialTerms,
    xeroPortal,
  ] = await Promise.all([
    userHasAnyModuleAccess(context.client, context.profile, ['buyer_invoices', 'incoming_payments']),
    userHasAnyModuleAccess(context.client, context.profile, ['disputes']),
    userHasCapability(context.client, context.profile, 'disputes_approve'),
    userHasCapability(context.client, context.profile, 'disputes_account'),
    userHasAnyModuleAccess(context.client, context.profile, ['hedge_desk']),
    userHasCapability(context.client, context.profile, 'hedge_close_approve'),
    userHasCapability(context.client, context.profile, 'hedge_settlement_manage'),
    userHasAnyModuleAccess(context.client, context.profile, ['email_router']),
    userHasAnyModuleAccess(context.client, context.profile, ['markets']),
    userHasAnyModuleAccess(context.client, context.profile, ['special_terms']),
    userHasAnyModuleAccess(context.client, context.profile, ['xero_portal']),
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
      markets,
      specialTerms,
      xeroPortal,
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

const growthCoachingBootstrap = withActiveUser(growthCoachingBootstrapService, requireActiveUser);
const growthPlanSave = withActiveUser(growthPlanSaveService, requireActiveUser);
const growthPlanCloseout = withActiveUser(growthPlanCloseoutService, requireActiveUser);
const growthGoalSave = withActiveUser(growthGoalSaveService, requireActiveUser);
const growthGoalSubmit = withActiveUser(growthGoalSubmitService, requireActiveUser);
const growthGoalDecision = withActiveUser(growthGoalDecisionService, requireActiveUser);
const growthGoalProgressSave = withActiveUser(growthGoalProgressSaveService, requireActiveUser);
const growthGoalCompletion = withActiveUser(growthGoalCompletionService, requireActiveUser);
const growthGoalEvidenceOptions = withActiveUser(growthGoalEvidenceOptionsService, requireActiveUser);
const growthGoalEvidenceSave = withActiveUser(growthGoalEvidenceSaveService, requireActiveUser);
const coachingRelationshipInvite = withActiveUser(coachingRelationshipInviteService, requireActiveUser);
const coachingRelationshipRespond = withActiveUser(coachingRelationshipRespondService, requireActiveUser);
const coachingRelationshipEnd = withActiveUser(coachingRelationshipEndService, requireActiveUser);
const coachingSessionSave = withActiveUser(coachingSessionSaveService, requireActiveUser);
const coachingSessionContentSave = withActiveUser(coachingSessionContentSaveService, requireActiveUser);
const coachingSessionConfirm = withActiveUser(coachingSessionConfirmService, requireActiveUser);
const coachingSessionCancel = withActiveUser(coachingSessionCancelService, requireActiveUser);
const coachingActionSave = withActiveUser(coachingActionSaveService, requireActiveUser);
const coachingActionPublish = withActiveUser(coachingActionPublishService, requireActiveUser);
const coachingActionProposalRespond = withActiveUser(coachingActionProposalRespondService, requireActiveUser);
const growthAttachmentPrepare = withActiveUser(growthAttachmentPrepareService, requireActiveUser);
const growthAttachmentComplete = withActiveUser(growthAttachmentCompleteService, requireActiveUser);
const growthAttachmentUrl = withActiveUser(growthAttachmentUrlService, requireActiveUser);
const growthEmailPreferencesSave = withActiveUser(growthEmailPreferencesSaveService, requireActiveUser);
const coachingCalendarResolve = withActiveUser(coachingCalendarResolveService, requireActiveUser);
const coachingCalendarRetry = withActiveUser(coachingCalendarRetryService, requireActiveUser);

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
  emailRouterMaintenanceCron: [], ...XERO_HANDLER_MODULE_ACCESS,
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
  const identityManagedByFcuno = fcunoFederationConfig().federationEnabled;
  if (identityManagedByFcuno && !isUpdate) {
    throw appError('Create company identities in FCUNO User Management, then assign FCOS access here.', 409, 'FCUNO_IDENTITY_CREATE_REQUIRED');
  }
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
    if (!managedProfile) throw appError('User not found.', 404);
    if (identityManagedByFcuno && (
      String(payload.email || '').toLowerCase() !== String(managedProfile?.email || '').toLowerCase()
      || String(payload.full_name || '') !== String(managedProfile?.full_name || '')
      || payload.active !== (managedProfile?.active !== false)
      || Boolean(payload.password)
    )) {
      throw appError('Email, name, active state and credentials are managed in FCUNO. Only FCOS authorization can be changed here.', 409, 'FCUNO_IDENTITY_READ_ONLY');
    }
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
    const updatePayload = identityManagedByFcuno
      ? { app_metadata: { user_type: stagedUserType } }
      : {
          email: payload.email,
          user_metadata: { full_name: payload.full_name },
          app_metadata: { user_type: stagedUserType },
          ...(payload.password ? { password: payload.password } : {}),
        };
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
  const effectiveEmail = identityManagedByFcuno ? managedProfile.email : payload.email;
  const effectiveFullName = identityManagedByFcuno ? managedProfile.full_name : payload.full_name;
  const effectiveActive = identityManagedByFcuno ? managedProfile.active !== false : payload.active;
  const { error: profileError } = await client.from('user_profiles').upsert(
    {
      id: authUser.id,
      email: effectiveEmail,
      full_name: effectiveFullName,
      user_type: stagedUserType,
      active: effectiveActive,
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
    identity_authority: identityManagedByFcuno ? 'fcuno' : 'fcos',
  });

  return {
    id: authUser.id,
    email: effectiveEmail,
    full_name: effectiveFullName,
    user_type: payload.user_type,
    active: effectiveActive,
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
  const identityManagedByFcuno = fcunoFederationConfig().federationEnabled;
  let linkedIdentityIds = new Set();
  if (identityManagedByFcuno && userIds.length) {
    const { data: identityRows, error: identityError } = await client
      .from('fcos_external_identity_links')
      .select('auth_user_id')
      .in('auth_user_id', userIds);
    if (identityError) throw identityError;
    linkedIdentityIds = new Set((identityRows || []).map((row) => row.auth_user_id).filter(Boolean));
  }
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
    identity_source: identityManagedByFcuno
      ? linkedIdentityIds.has(profile.id) ? 'fcuno' : 'pending_fcuno_link'
      : 'fcos',
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
    identityAuthority: identityManagedByFcuno ? 'fcuno' : 'fcos',
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
  if (fcunoFederationConfig().federationEnabled) {
    throw appError('Company identities must be deactivated or removed in FCUNO User Management.', 409, 'FCUNO_IDENTITY_DELETE_REQUIRED');
  }
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

async function googleDriveMarketAccessToken() {
  requireExternalActionGate('google_drive');
  return (await exchangeGoogleDriveRefreshToken(googleDriveMarketOAuthConfig())).access_token;
}

async function reportExportCreate(body, req, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  throw appError('The legacy Google Drive XLS Report Archive has been retired. Export XLS now downloads to the current device only.', 410);
}

async function reportExportsList(body, req, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  throw appError('The legacy Google Drive XLS Report Archive has been retired.', 410);
}

async function reportExportRename(body, req, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  throw appError('The legacy Google Drive XLS Report Archive has been retired.', 410);
}

async function reportExportDelete(body, req, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  throw appError('The legacy Google Drive XLS Report Archive has been retired.', 410);
}

async function reportExportDownload(body, req, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  throw appError('The legacy Google Drive XLS Report Archive has been retired.', 410);
}

const NAVIGATION_SECTION_DEFAULTS = Object.freeze({
  personal: ['my_commitments', 'growth_coaching', 'projects_tasks'],
  trading: ['dashboard', 'buyers_administrator', 'markets', 'special_terms', 'hedge_desk'],
  cross_functions: ['payment_collections', 'disputes', 'unofficial_compensation', 'brokers'],
  finance: ['cashflow_forecast'],
  tools: ['email_router', 'review', 'pnl'],
});
const NAVIGATION_ITEM_IDS = new Set(Object.values(NAVIGATION_SECTION_DEFAULTS).flat());
const NAVIGATION_DEFAULT_HIDDEN_IDS = ['review', 'pnl'];
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

async function googleDriveHealthRow() {
  const marketRequired = GOOGLE_DRIVE_MARKET_OAUTH_REQUIRED_ENV;
  const configured = missingEnv(marketRequired).length === 0;
  const gateEnabled = isExternalActionEnabled('google_drive');
  const result =
    configured && gateEnabled
      ? await timedCheck(async () => {
          const token = await exchangeGoogleDriveRefreshToken(googleDriveMarketOAuthConfig());
          const marketConfig = CONNECTION_INTEGRATIONS.googleDriveMarketReports;
          const marketAuthority = await verifyMarketDriveAuthority(fetch, token.access_token, marketConfig);
          const marketFolders = marketAuthority.folders.map((folder) => ({
            label: folder.label,
            folderId: maskValue(folder.folderId, 6, 4),
            folderName: folder.folderName,
          }));
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
            healthStatus: 'online',
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
      purpose: 'Reads licensed Bunkerwire and European Marketscan PDFs for the hourly Markets update.',
      scope: 'server',
      provider: 'Google Drive API',
      endpoint: 'https://www.googleapis.com/drive/v3',
      authType: 'OAuth refresh token',
      configured,
      configuredEnv: configuredEnv(marketRequired),
      missingEnv: missingEnv(marketRequired),
      tokenExpiry: configured ? 'Refresh token expiry is not exposed by Google; short-lived access-token expiry is checked live.' : null,
      details: {
        gateEnabled,
        legacyXlsReportArchive: 'retired',
        marketReportAccount: CONNECTION_INTEGRATIONS.googleDriveMarketReports.accountEmail,
        marketReportBrowserProfile: CONNECTION_INTEGRATIONS.googleDriveMarketReports.browserProfile,
        marketReportRootFolder: maskValue(CONNECTION_INTEGRATIONS.googleDriveMarketReports.rootFolderId, 6, 4),
        marketReportSchedule: CONNECTION_INTEGRATIONS.googleDriveMarketReports.syncSchedule,
      },
      notes: gateEnabled ? ['The legacy XLS Report Archive is retired. XLS exports download locally only. Market-report PDFs are read only; FCOS stores configured observations and checksums, not PDF bytes or report text.'] : ['Google Drive market-report reads are paused by the emergency control.'],
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
  rows.push(externalActionGateHealthRow(), cronHealthRow(), vercelRuntimeHealthRow());
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
     ×myÚÚ$z{-®éÜj×ßNÂˆÛÛœÝ˜Y\’[™›ÈH˜Y\žTÝ[VÜÝ[K’YHßNÂˆÛÛœÝØ[Ý[]Y[[Ý[HØ[Ý[]YžTÝ[VÜÝ[K’YHˆÈØ[Ý[]YžTÝ[VÜÝ[K’YHˆ[˜ÛÛZ[™Ô^[Y[[X™\ŠÝ[K•Ý[Ò[›ÚXÙWÐ[[Ý[×ØÊNÂˆ™]\›ˆÂˆYˆÝ[K’YˆÝ[RYˆÝ[K’YˆÝ[S˜[YNˆ›Ü›X]Ý[S˜[YJÝ[JKˆÙ^TÝ[NˆÝ[K’Ù^TÝ[W×ØÈ[ˆ^Y\“˜[YNˆ[˜ÛÛZ[™Ô^[Y[^Y\“˜[YJÝ[JKˆ^Y\‘Ü›Ý\˜[YNˆXØÛÝ[‘Ü›Ý\Ó˜[YW×ØÈXØÛÝ[”\™[Ë“˜[YH[˜ÛÛZ[™Ô^[Y[^Y\“˜[YJÝ[JKˆ^Y\•˜Y\Žˆ
˜Y\’[™›Ë˜^Y\Ë›[™ÝÈ˜Y\’[™›Ë˜^Y\ˆˆ˜Y\’[™›Ë˜[×JKš›Ú[Š	Ë	ÊH[ˆ^[Y[\›\ÎˆÝ[K”^[Y[Õ\›W×ØÈ[ˆØ[Ý[]Y[[Ý[ˆ™XÙZ]˜X›P˜[[˜ÙNˆ[˜ÛÛZ[™Ô^[Y[[X™\ŠÝ[K”™XÙZ]˜X›WÐ˜[[˜ÙW×ØÊKˆÝ\œ™[˜ÞNˆÝ[KÝ\œ™[˜ÞR\ÛÐÛÙH[ˆ[]™\žQ]NˆÝ[K‘[]™\žWÑ]W×ØÈ[ˆNÂˆJNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[Ó\ÝÛ˜\ÚÝ
›ÙK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÙ][™ÜÈH›ÙK—ÜÙ][™ÜÓÝ™\œšYH
]ØZ]ØY[˜ÛÛZ[™Ô^[Y[Ù][™ÜÊ
JNÂˆÛÛœÝÙ^HH]SÛ›J™]È]J
JNÂˆÛÛœÝ]Qœ›ÛHH]SÛ›J›ÙK™]Qœ›ÛH›ÙK™]WÙœ›ÛHÙ^JNÂˆÛÛœÝ]UÈH]SÛ›J›ÙK™]UÈ›ÙK™]WÝÈÙ^JNÂˆÛÛœÝ[Z]HX]›X^
LX]›Z[Š[X™\Š›ÙK›[Z]
HLL
JNÂ‚ˆÛÛœÝ^[Y[\ØÜšX™HH]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÂˆØš™XÝ˜[YNˆ	Ô^[Y[×ØÉËˆJK˜Ø]Ú


HOˆ
ÈšY[Îˆ×HJJNÂˆÛÛœÝ^[Y[šY[ÈH^[Y[\ØÜšX™K™šY[È×NÂˆÛÛœÝ^[Y[šY[˜[Y\ÈH™]ÈÙ]
^[Y[šY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝ^[Y[šY[žS˜[YHHØš™XÝ™œ›ÛQ[šY\Ê^[Y[šY[Ë›X\

šY[
HOˆÙšY[›˜[YKšY[JJNÂˆYˆ
\^[Y[šY[˜[Y\ËœÚ^™JBˆ™]\›ˆÂˆ›ÝÜÎˆ×Kˆ]˜Z[X›P˜[[˜Ù\Îˆ×KˆÝ[[X\žNˆßKˆÙ][™ÜËˆØÚ[XUØ\›š[™ÜÎˆÉÔ^[Y[×ØÈ\È›Ý]Y\žXX›K‰×KˆNÂ‚ˆÛÛœÝ]QšY[Hš\œÝ]˜Z[X›QšY[
^[Y[šY[˜[Y\ËÉÑ]W×ØÉË	Ô^[Y[Ñ]W×ØÉË	Ô™XÙZ]™YÑ]W×ØÉË	ÔZYÑ]W×ØÉË	ÐÜ™X]Y]I×JNÂˆÛÛœÝ[[Ý[šY[Hš\œÝ]˜Z[X›QšY[
^[Y[šY[˜[Y\ËÉÐ[[Ý[×ØÉË	Ô^[Y[Ð[[Ý[×ØÉË	ÔZYÐ[[Ý[×ØÉË	Ô™XÙZ]™YÐ[[Ý[×ØÉË	ÕÝ[Ð[[Ý[×ØÉË	Ð[[Ý[ÔZY×ØÉË	Ô^[Y[Õ˜[YW×ØÉË	ÐXÝX[Ð[[Ý[×ØÉ×JNÂˆÛÛœÝ™Y™\™[˜ÙQšY[ÈH[˜ÛÛZ[™Ô^[Y[™Y™\™[˜ÙQšY[Ê^[Y[šY[ÊNÂˆÛÛœÝÝ]\ÑšY[ÈHÙ[XÝYšY[Ê^[Y[šY[˜[Y\ËÉÔÝ]\××ØÉË	Ô^[Y[ÔÝ]\××ØÉ×JNÂˆÛÛœÝ\QšY[ÈHÙ[XÝYšY[Ê^[Y[šY[˜[Y\ËÉÕ\W×ØÉË	Ô^[Y[Õ\W×ØÉ×JNÂˆÛÛœÝÝ\Y\’[›ÚXÙSÛÚÝ\šY[ÈH[˜ÛÛZ[™Ô^[Y[Ý\Y\’[›ÚXÙQšY[Ê^[Y[šY[ÊNÂˆÛÛœÝ\™XÝ[Û‘šY[ÈH[˜ÛÛZ[™Ô^[Y[\™XÝ[Û‘šY[Ê^[Y[šY[ÊNÂˆÛÛœÝ^[Y[Ù[XÝšY[ÈHÉÒY	Ë‹‹œÙ[XÝYšY[Ê^[Y[šY[˜[Y\ËÉÓ˜[YIË	Ô™XÛÜ™\RY	Ë	ÐÜ™X]Y]IË	Ó\Ý[ÙYšYY]IË	ÔÕSW×ØÉË	ÐÝ\œ™[˜ÞR\ÛÐÛÙIË	ÐÝ\œ™[˜ÞW×ØÉ×JK^[Y[šY[˜[Y\Ëš\Ê	Ô™XÛÜ™\RY	ÊHÈ	Ô™XÛÜ™\K“˜[YIÈˆ[^[Y[šY[˜[Y\Ëš\Ê	Ô™XÛÜ™\RY	ÊHÈ	Ô™XÛÜ™\K‘]™[Ü\“˜[YIÈˆ[‹‹œÝ\Y\’[›ÚXÙSÛÚÝ\šY[Ë]QšY[[[Ý[šY[‹‹œ™Y™\™[˜ÙQšY[Ë‹‹œÝ]\ÑšY[Ë‹‹\QšY[Ë‹‹™\™XÝ[Û‘šY[×K™š[\Š›ÛÛX[ŠNÂ‚ˆÛÛœÝš[\‘]QšY[H^[Y[šY[˜[Y\Ëš\Ê	ÐÜ™X]Y]IÊHÈ	ÐÜ™X]Y]IÈˆ]QšY[ÂˆÛÛœÝš[\‘]U\HH^[Y[šY[žS˜[YVÙš[\‘]QšY[OË\H[ÂˆÛÛœÝš[\‘]U˜[YHH
\ÛÑ]K[™Ù‘^HH˜[ÙJHOˆ
š[\‘]QšY[OOH	ÐÜ™X]Y]IÈÈÛÜ[Û™ÒÛÛ™Ñ]U[YU˜[YJ\ÛÑ]K[™Ù‘^JHˆÛÜ[]U˜[YJš[\‘]QšY[š[\‘]U\K\ÛÑ]K[™Ù‘^JJNÂˆÛÛœÝÚ\™T\ÈH×NÂˆYˆ
š[\‘]QšY[	‰ˆ]Qœ›ÛJHÚ\™T\Ëœ\Ú
	Ùš[\‘]QšY[HH	Ùš[\‘]U˜[YJ]Qœ›ÛK˜[ÙJ_X
NÂˆYˆ
š[\‘]QšY[	‰ˆ]UÊHÚ\™T\Ëœ\Ú
	Ùš[\‘]QšY[HH	Ùš[\‘]U˜[YJ]UËYJ_X
NÂˆÛÛœÝÜ™\žHHš[\‘]QšY[È	Ùš[\‘]QšY[HTÐÈ•SÈTÕ	Ùš[\‘]QšY[OOH	ÐÜ™X]Y]IÈÈ	ËÜ™X]Y]HTÐÉÈˆ	ÉßXˆ	ÐÜ™X]Y]HTÐÉÎÂˆÛÛœÝ^[Y[ÈH]ØZ]]Y\žT›ÝÜÊˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
^[Y[Ù[XÝšY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓH^[Y[×ØÂˆ	ÝÚ\™T\Ë›[™ÝÈÒT‘H	ÝÚ\™T\Ëš›Ú[Š	ÈS‘	Ê_Xˆ	ÉßBˆÔ‘Tˆ–H	ÛÜ™\ž_BˆSRU	Û[Z]BˆˆÈ[Z]ÛÙ˜Z[ˆYHKˆ
NÂ‚ˆÛÛœÝ[YÚX›T^[Y[ÈH^[Y[Ë™š[\Š
^[Y[
HOˆZ[˜ÛÛZ[™Ô^[Y[\Ô™XÙZ]˜X›T™[Z][˜ÙJ^[Y[Ë‹‹œ™Y™\™[˜ÙQšY[Ë‹‹™\™XÝ[Û‘šY[Ë‹‹\QšY[Ë‹‹œÝ]\ÑšY[×JJNÂˆÛÛœÝ\™XÝÝ[RYÈH[YÚX›T^[Y[Ë›X\

^[Y[
HOˆ^[Y[”ÕSW×ØÊK™š[\Š›ÛÛX[ŠNÂˆÛÛœÝÝ\Y\’[›ÚXÙRYÈH[YÚX›T^[Y[Ë›X\

^[Y[
HOˆ[˜ÛÛZ[™Ô^[Y[Ý\Y\’[›ÚXÙRY
^[Y[Ý\Y\’[›ÚXÙSÛÚÝ\šY[ÊJK™š[\Š›ÛÛX[ŠNÂˆÛÛœÝÝ\Y\’[›ÚXÙQ\ØÜšX™HHÝ\Y\’[›ÚXÙRYË›[™ÝÈ]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	ÔÝ\Y\—Ò[›ÚXÙW×ØÉÈJK˜Ø]Ú


HOˆ
ÈšY[Îˆ×HJJHˆÈšY[Îˆ×HNÂˆÛÛœÝÝ\Y\’[›ÚXÙQšY[ÈHÝ\Y\’[›ÚXÙQ\ØÜšX™K™šY[È×NÂˆÛÛœÝÝ\Y\’[›ÚXÙQšY[˜[Y\ÈH™]ÈÙ]
Ý\Y\’[›ÚXÙQšY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝÝ\Y\’[›ÚXÙQšY[žS˜[YHHØš™XÝ™œ›ÛQ[šY\ÊÝ\Y\’[›ÚXÙQšY[Ë›X\

šY[
HOˆÙšY[›˜[YKšY[JJNÂˆÛÛœÝÝ\Y\’[›ÚXÙT^XX›QšY[Hš\œÝ]˜Z[X›QšY[
Ý\Y\’[›ÚXÙQšY[˜[Y\ËÉÔ^XX›WÐ˜[[˜ÙW×ØÉË	Ð˜[[˜ÙW×ØÉË	ÐXÝX[Ð˜[[˜ÙW×ØÉË	ÓÝ]Ý[™[™×Ð˜[[˜ÙW×ØÉ×JNÂˆÛÛœÝÝ\Y\’[›ÚXÙP[[Ý[šY[Hš\œÝ]˜Z[X›QšY[
Ý\Y\’[›ÚXÙQšY[˜[Y\ËÉÒ[›ÚXÙWÐ[[Ý[×ØÉË	ÐØ[Ý[]YÐ[[Ý[×ØÉË	Ð[[Ý[×ØÉË	ÕÝ[Ð[[Ý[×ØÉ×JNÂˆÛÛœÝÝ\Y\’[›ÚXÙTÝ\Y\‘šY[ÈHÙ[XÝYšY[ÊÝ\Y\’[›ÚXÙQšY[˜[Y\ËÉÔÝ\Y\—×ØÉË	Ñ^XÝYÔÝ\Y\—×ØÉË	ÔÝXœÝ]]WÔÝ\Y\—×ØÉ×JNÂˆÛÛœÝÝ\Y\’[›ÚXÙTÝ\Y\”™[][ÛœÚ\ÈHÝ\Y\’[›ÚXÙTÝ\Y\‘šY[Ë›X\

šY[
HOˆÝ\Y\’[›ÚXÙQšY[žS˜[YVÙšY[OËœ™[][ÛœÚ\˜[YJK™š[\Š›ÛÛX[ŠNÂˆÛÛœÝÝ\Y\’[›ÚXÙSX\HßNÂˆYˆ
Ý\Y\’[›ÚXÙRYË›[™Ý	‰ˆÝ\Y\’[›ÚXÙQšY[˜[Y\ËœÚ^™JHÂˆÛÛœÝÝ\Y\’[›ÚXÙTÙ[XÝšY[ÈHÉÒY	Ë	Ó˜[YIË‹‹œÙ[XÝYšY[ÊÝ\Y\’[›ÚXÙQšY[˜[Y\ËÉÔÕSW×ØÉË	ÔÝ\Y\—Ó˜[YW×ØÉ×JKÝ\Y\’[›ÚXÙP[[Ý[šY[Ý\Y\’[›ÚXÙT^XX›QšY[‹‹œÝ\Y\’[›ÚXÙTÝ\Y\‘šY[Ë‹‹œÝ\Y\’[›ÚXÙTÝ\Y\”™[][ÛœÚ\Ë›X\

™[][ÛœÚ\
HOˆ	Ü™[][ÛœÚ\K“˜[YX
WK™š[\Š›ÛÛX[ŠNÂˆÛÛœÝ[›ÚXÙPÚ[šÜÈH]ØZ]ÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊË‹‹›™]ÈÙ]
Ý\Y\’[›ÚXÙRYÊWJK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
Ý\Y\’[›ÚXÙTÙ[XÝšY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓHÝ\Y\—Ò[›ÚXÙW×ØÂˆÒT‘HYSˆ
	Ú[“\ÝJBˆSRULˆˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
NÂˆ›Üˆ
ÛÛœÝ[›ÚXÙHÙˆ[›ÚXÙPÚ[šÜË™›]

JHÝ\Y\’[›ÚXÙSX\Ú[›ÚXÙK’YHH[›ÚXÙNÂˆB‚ˆÛÛœÝÝ[RYÈHÂˆ‹‹›™]ÈÙ]
Âˆ‹‹™\™XÝÝ[RYËˆ‹‹“Øš™XÝ˜[Y\ÊÝ\Y\’[›ÚXÙSX\
Bˆ›X\

[›ÚXÙJHOˆ[›ÚXÙK”ÕSW×ØÊBˆ™š[\Š›ÛÛX[ŠKˆJKˆNÂˆÛÛœÝÝ[Q\ØÜšX™HHÝ[RYË›[™ÝˆÈ]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	ÜÝ[W×ØÉÈJK˜Ø]Ú


HOˆ
ÂˆšY[Îˆ×KˆJJBˆˆÈšY[Îˆ×HNÂˆÛÛœÝÝ[QšY[ÈHÝ[Q\ØÜšX™K™šY[È×NÂˆÛÛœÝÝ[QšY[˜[Y\ÈH™]ÈÙ]
Ý[QšY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝXØÛÝ[\ØÜšX™HHÝ[QšY[˜[Y\Ëš\Ê	ÐXØÛÝ[×ØÉÊBˆÈ]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	ÐXØÛÝ[	ÈJK˜Ø]Ú


HOˆ
ÂˆšY[Îˆ×KˆJJBˆˆÈšY[Îˆ×HNÂˆÛÛœÝXØÛÝ[šY[˜[Y\ÈH™]ÈÙ]

XØÛÝ[\ØÜšX™K™šY[È×JK›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝ[\›Ù™šXÙPÛÛ™][ÛˆH]ØZ][\›Ù™šXÙTÝ[PXØÙ\ÜÐÛÛ™][ÛŠXØÙ\ÜÐÛÛ^Ý[QšY[˜[Y\ËXØÛÝ[šY[˜[Y\ÊNÂˆÛÛœÝÝ[TÙ[XÝšY[ÈHÉÒY	Ë	Ó˜[YIË‹‹œÙ[XÝYšY[ÊÝ[QšY[˜[Y\ËÉÒÙ^TÝ[W×ØÉË	Ð^Y\—Ó˜[YW×ØÉË	Ð^Y\—×ØÉË	ÐXØÛÝ[×ØÉË	ÕÝ[Ò[›ÚXÙWÐ[[Ý[×ØÉË	ÕÝ[Ò[›ÚXÙYÐ[[Ý[Ñœ›ÛWÔÝ\Y\œ××ØÉË	Ô™XÙZ]˜X›WÐ˜[[˜ÙW×ØÉË	Ô^XX›WÐ˜[[˜ÙW×ØÉË	ÕÝ[ÐÛÜÝ××ØÉË	ÕÝ[ÐÛÜÝ×ØÉË	ÕÝ[ÐÛÜÝÐ[[Ý[×ØÉË	Ô^[Y[Ñ]W×ØÉË	Ô^[Y[Õ\›W×ØÉË	Ò[›ÚXÙWÑYWÑ]W×ØÉË	Ð^Y\—Ô^WÕ\›WÑ]W×ØÉË	ÑYWÑ]W×ØÉË	Ñ[]™\žWÑ]W×ØÉË	Ñ[]™\žWÑ]WÓÜ—Ñ^XÝY×ØÉË	Ñ^XÝYÑ[]™\žWÑ]W×ØÉË	ÐÝ\œ™[˜ÞR\ÛÐÛÙI×JWNÂˆYˆ
Ý[QšY[˜[Y\Ëš\Ê	Õ™\ÜÙ[×ØÉÊJHÝ[TÙ[XÝšY[Ëœ\Ú
	Õ™\ÜÙ[×Ü‹“˜[YIÊNÂˆYˆ
Ý[QšY[˜[Y\Ëš\Ê	ÔÜ×ØÉÊJHÝ[TÙ[XÝšY[Ëœ\Ú
	ÔÜ×Ü‹“˜[YIÊNÂˆYˆ
Ý[QšY[˜[Y\Ëš\Ê	ÐXØÛÝ[×ØÉÊJHÂˆÝ[TÙ[XÝšY[Ëœ\Ú
	ÐXØÛÝ[×Ü‹“˜[YIÊNÂˆYˆ
XØÛÝ[šY[˜[Y\Ëš\Ê	ÑÜ›Ý\Ó˜[YW×ØÉÊJHÝ[TÙ[XÝšY[Ëœ\Ú
	ÐXØÛÝ[×Ü‹‘Ü›Ý\Ó˜[YW×ØÉÊNÂˆYˆ
XØÛÝ[šY[˜[Y\Ëš\Ê	Ô\™[Y	ÊJHÝ[TÙ[XÝšY[Ëœ\Ú
	ÐXØÛÝ[×Ü‹”\™[“˜[YIÊNÂˆBˆÛÛœÝÝ[SX\HßNÂˆYˆ
Ý[RYË›[™Ý	‰ˆÝ[QšY[˜[Y\ËœÚ^™JHÂˆÛÛœÝÝ[PÚ[šÜÈH]ØZ]ÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ[RYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆÛÛœÝÝ[UÚ\™HHÛÛXš[™UÚ\™PÛÛ™][ÛœÊØYSˆ
	Ú[“\ÝJX[\›Ù™šXÙPÛÛ™][Û—JNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
Ý[TÙ[XÝšY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓHÝ[W×ØÂˆÒT‘H	ÜÝ[UÚ\™_BˆSRULˆˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
NÂˆ›Üˆ
ÛÛœÝÝ[HÙˆÝ[PÚ[šÜË™›]

JHÝ[SX\ÜÝ[K’YHHÝ[NÂˆBˆ]œ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ÐžTÝ[HHßNÂˆ][™R][\ÐžTÝ[HHßNÂˆ]^˜PÛÜÝÐžTÝ[HHßNÂˆYˆ
Ý[RYË›[™Ý
HÂˆÛÛœÝÛ[™R][PÚ[šÜË^Y\œ›ÚÙ\Ú[šÜË^˜PÛÜÝÚ[šÜ×HH]ØZ]›ÛZ\ÙK˜[
ÂˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ[RYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕYÕSW×ØËØ[˜Ù[Y×ØË]X[]W×ØË]X[]WÑ[]™\™YÔ\—Ð‘—×ØËˆ]X[]WÓX^×ØË]X[]WÚ[—ÓU×ØË\×Ô]X[]WÔ˜[™ÙW×ØËˆÛÜÝÔ\—Õ[š]×ØË[š]Ð^WÐ]×ØË[š]ÐÛÜÝ×ØËÝ[ÐÛÜÝ×ØËˆÝ\Y\—Ðœ›ÚÙ\—×ØËÝ\Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØËˆ^Y\œ×Ðœ›ÚÙ\—×ØË^Y\—Ðœ›ÚÙ\—×ØË^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØËˆ^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ó[\Ý[W×ØËÛÛ[Z\ÜÚ[Û—ÐÛÜÝ×ØËÝ\Y\—Ò[›ÚXÙW×ØËˆÙ™™\—Ó[™WÒ][W×Ü‹”Ý\Y\—Õ[š]ÔšXÙW×ØÂˆ”“ÓHÕSWÓ[™WÒ][W×ØÂˆÒT‘HÕSW×ØÈSˆ
	Ú[“\ÝJBˆSRULˆˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
KˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ[RYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕYÕSW×ØË^Y\—Ðœ›ÚÙ\—×ØÂˆ”“ÓHÕSWÐ^Y\—Ðœ›ÚÙ\—×ØÂˆÒT‘HÕSW×ØÈSˆ
	Ú[“\ÝJBˆSRULˆˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
KˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ[RYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕYÕSW×ØËØ[˜Ù[Y×ØË]X[]W×ØË]X[]WÑ[]™\™YÔ\—Ð‘—×ØËˆ]X[]WÚ[—ÓU×ØË]X[]WÔ˜[™ÙWÓX^×ØË\×Ô]X[]WÔ˜[™ÙW×ØËˆ[š]ÐÛÜÝ×ØË[™WÕÝ[Ð^W×ØËÝ\Y\—Ò[›ÚXÙW×ØÂˆ”“ÓHÕSWÑ^˜WÐÛÜÝ×ØÂˆÒT‘HÕSW×ØÈSˆ
	Ú[“\ÝJBˆSRULˆˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
KˆJNÂˆÛÛœÝœ›ÚÙ\“[™R][\ÈH[™R][PÚ[šÜË™›]

NÂˆÛÛœÝœ›ÚÙ\”›ÝÜÈH^Y\œ›ÚÙ\Ú[šÜË™›]

NÂˆÛÛœÝ^˜PÛÜÝ›ÝÜÈH^˜PÛÜÝÚ[šÜË™›]

NÂˆ[™R][\ÐžTÝ[HHœ›ÚÙ\“[™R][\Ëœ™YXÙJ
XØË][JHOˆÂˆYˆ
Z][K”ÕSW×ØÊH™]\›ˆXØÎÂˆYˆ
XXØÖÚ][K”ÕSW×Ø×JHXØÖÚ][K”ÕSW×Ø×HH×NÂˆXØÖÚ][K”ÕSW×Ø×Kœ\Ú
][JNÂˆ™]\›ˆXØÎÂˆKßJNÂˆ^˜PÛÜÝÐžTÝ[HH^˜PÛÜÝ›ÝÜËœ™YXÙJ
XØË][JHOˆÂˆYˆ
Z][K”ÕSW×ØÊH™]\›ˆXØÎÂˆYˆ
XXØÖÚ][K”ÕSW×Ø×JHXØÖÚ][K”ÕSW×Ø×HH×NÂˆXØÖÚ][K”ÕSW×Ø×Kœ\Ú
][JNÂˆ™]\›ˆXØÎÂˆKßJNÂˆÛÛœÝœ›ÚÙ\XØÛÝ[YÈHË‹‹›™]ÈÙ]
Ë‹‹˜œ›ÚÙ\“[™R][\Ë›X\

][JHOˆ][K”Ý\Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠK‹‹˜œ›ÚÙ\“[™R][\Ë›X\

][JHOˆ][K^Y\œ×Ðœ›ÚÙ\—×ØÈ][K^Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠK‹‹˜œ›ÚÙ\”›ÝÜË›X\

][JHOˆ][K^Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠWJWNÂˆÛÛœÝXØÛÝ[X\H]ØZ]˜[Y\ÐžRYÊ	ÐXØÛÝ[	Ëœ›ÚÙ\XØÛÝ[YÊNÂˆ›Üˆ
ÛÛœÝÚY˜[YWHÙˆØš™XÝ™[šY\ÊXØÛÝ[X\
JHXØÛÝ[X\ÔÝš[™ÊY
KœÛXÙJMJWHH˜[YNÂˆœ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ÐžTÝ[HHZ[œ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ÊÂˆÝ[SX\ˆ[™R][\Îˆœ›ÚÙ\“[™R][\Ëˆ^Y\œ›ÚÙ\œÎˆœ›ÚÙ\”›ÝÜËˆXØÛÝ[X\ˆJNÂˆB‚ˆÛÛœÝ]˜Z[X›TÝ[RÙ^\ÈH™]ÈÙ]

NÂˆÛÛœÝ]˜Z[X›P˜[[˜Ù\ÐžQÜ›Ý\HßNÂˆÛÛœÝ[›ÝÜÈH[YÚX›T^[Y[Âˆ›X\

^[Y[
HOˆÂˆÛÛœÝÝ\Y\’[›ÚXÙRYH[˜ÛÛZ[™Ô^[Y[Ý\Y\’[›ÚXÙRY
^[Y[Ý\Y\’[›ÚXÙSÛÚÝ\šY[ÊNÂˆÛÛœÝÝ\Y\’[›ÚXÙHHÝ\Y\’[›ÚXÙRYÈÝ\Y\’[›ÚXÙSX\ÜÝ\Y\’[›ÚXÙRYH[ˆ[ÂˆÛÛœÝÝ[RYH^[Y[”ÕSW×ØÈÝ\Y\’[›ÚXÙOË”ÕSW×ØÈ[ÂˆÛÛœÝÝ[HHÝ[RYÈÝ[SX\ÜÝ[RYH[ˆ[ÂˆYˆ
Ý[RY	‰ˆ\Ý[JH™]\›ˆ[ÂˆÛÛœÝ[[Ý[H[[Ý[šY[È[˜ÛÛZ[™Ô^[Y[[X™\Š^[Y[Ø[[Ý[šY[JHˆ[ÂˆÛÛœÝœ›ÚÙ\ÛÛ[Z\ÜÚ[Û“X]ÚHÝ[OË’YÈš[™œ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[X]Ú
^[Y[[[Ý[œ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ÐžTÝ[VÜÝ[K’YH×KË‹‹œ™Y™\™[˜ÙQšY[Ë‹‹™\™XÝ[Û‘šY[Ë‹‹\QšY[Ë‹‹œÝ]\ÑšY[×JHˆ[ÂˆÛÛœÝ˜[šÐÚ\™ÙHH[˜ÛÛZ[™Ô^[Y[ÛÚÜÐ˜[šÐÚ\™ÙJ^[Y[Âˆ™Y™\™[˜ÙQšY[Ëˆ\™XÝ[Û‘šY[Ëˆ\QšY[ËˆÝ]\ÑšY[ËˆJNÂˆÛÛœÝ^XX›PØ[Ý[][ÛˆHÝ[OË’YˆÈ[˜ÛÛZ[™Ô^[Y[ÛÚÜÔÝ[T^XX›PØ[Ý[][ÛŠ^[Y[Âˆ[[Ý[ˆ^XX›P[[Ý[ÎˆÝ[T^XX›P[[Ý[Ø[™Y]\ÊÂˆÝ[Kˆ[™R][\Îˆ[™R][\ÐžTÝ[VÜÝ[K’YH×Kˆ^˜PÛÜÝÎˆ^˜PÛÜÝÐžTÝ[VÜÝ[K’YH×KˆJKˆ™Y™\™[˜ÙQšY[Ëˆ\™XÝ[Û‘šY[Ëˆ\QšY[ËˆÝ]\ÑšY[Ëˆ[ÝÐ›[šÔÚYÛ˜[ˆ\Ý[K‘[]™\žWÑ]W×ØËˆJBˆˆ˜[ÙNÂˆÛÛœÝ\HHœ›ÚÙ\ÛÛ[Z\ÜÚ[Û“X]ÚˆÈ	Ðœ›ÚÙ\ˆÛÛ[Z\ÜÚ[Û‰Âˆˆ˜[šÐÚ\™ÙBˆÈ	Ð˜[šÈÚ\™ÙIÂˆˆ^XX›PØ[Ý[][Û‚ˆÈ	ÔÝ\Y\ˆ^[Y[	Âˆˆ[˜ÛÛZ[™Ô^[Y[\Qœ›ÛPÛÛ^
^[Y[Âˆ[[Ý[ˆÝ[KˆÝ\Y\’[›ÚXÙKˆÝ\Y\’[›ÚXÙQšY[ÎˆÝ\Y\’[›ÚXÙSÛÚÝ\šY[Ëˆ\™XÝ[Û‘šY[Ëˆ\QšY[ËˆÝ]\ÑšY[ËˆJNÂˆ][˜ÛÛZ[™Ð[[Ý[H[[Ý[ÂˆYˆ
\KœÝ\ÕÚ]
	ÔÝ\Y\‰ÊJHÂˆ[˜ÛÛZ[™Ð[[Ý[H\HOOH	ÔÝ\Y\ˆ™Y[™	È	‰ˆ[[Ý[OH[ÈX]˜XœÊ[[Ý[
Hˆ[[Ý[ÂˆBˆÛÛœÝ^[Y[]HH]QšY[È^[Y[Ù]QšY[H[ˆ^[Y[Ü™X]Y]H[ÂˆÛÛœÝ^Y\’[›ÚXÙQYQ]HH\HOOH	Ð^Y\ˆ^[Y[	È	‰ˆÝ[HÈØ[Ý[]Y^Y\”^U\›Q]JÝ[JHÝ[K’[›ÚXÙWÑYWÑ]W×ØÈÝ[K‘YWÑ]W×ØÈÝ[K^Y\—Ô^WÕ\›WÑ]W×ØÈ[ˆ[ÂˆÛÛœÝ[^Q^\ÈH\HOOH	Ð^Y\ˆ^[Y[	È	‰ˆ^Y\’[›ÚXÙQYQ]H	‰ˆ^[Y[]HÈ^\Ð™]ÙY[Š^Y\’[›ÚXÙQYQ]K]SÛ›J^[Y[]JJHˆ[ÂˆÛÛœÝÝ]\ÈH[˜ÛÛZ[™Ô^[Y[Ý]\ÊÂˆ\Kˆ[[Ý[ˆÝ[KˆÝ\Y\’[›ÚXÙKˆ™\ÚÛÛXÞNˆ^[Y[ÛÛXÝ[Û•™\ÚÛÛXÞJÙ][™ÜËÝ[OËÝ\œ™[˜ÞR\ÛÐÛÙH^[Y[Ý\œ™[˜ÞR\ÛÐÛÙH^[Y[Ý\œ™[˜ÞW×ØÊKˆJNÂˆÛÛœÝ™XÙZ]˜X›HH[˜ÛÛZ[™Ô^[Y[[X™\ŠÝ[OË”™XÙZ]˜X›WÐ˜[[˜ÙW×ØÊNÂˆÛÛœÝ^Y\“˜[YHH[˜ÛÛZ[™Ô^[Y[^Y\“˜[YJÝ[JNÂˆÛÛœÝ^Y\‘Ü›Ý\˜[YHH[˜ÛÛZ[™Ô^[Y[^Y\‘Ü›Ý\
Ý[JNÂˆÛÛœÝ\S˜[YHH\KœÝ\ÕÚ]
	ÔÝ\Y\‰ÊHÈÝ\Y\’[›ÚXÙT\S˜[YJÝ\Y\’[›ÚXÙKÝ\Y\’[›ÚXÙTÝ\Y\”™[][ÛœÚ\ÊHˆ^Y\“˜[YNÂˆYˆ
Ý[OË’Y	‰ˆ™XÙZ]˜X›HOH[	‰ˆ™XÙZ]˜X›H
HÂˆÛÛœÝÙ^HHÝ[K’YÂˆYˆ
X]˜Z[X›TÝ[RÙ^\Ëš\ÊÙ^JJHÂˆ]˜Z[X›TÝ[RÙ^\Ë˜Y
Ù^JNÂˆÛÛœÝÜ›Ý\Ù^HH^Y\‘Ü›Ý\˜[YH^Y\“˜[YH	Õ[™Ü›Ý\Y^Y\‰ÎÂˆYˆ
X]˜Z[X›P˜[[˜Ù\ÐžQÜ›Ý\ÙÜ›Ý\Ù^WJHÂˆ]˜Z[X›P˜[[˜Ù\ÐžQÜ›Ý\ÙÜ›Ý\Ù^WHHÂˆ^Y\‘Ü›Ý\˜[YNˆÜ›Ý\Ù^Kˆ^Y\“˜[Y\Îˆ™]ÈÙ]

KˆÝ[]˜Z[X›P˜[[˜ÙNˆˆÝ[\Îˆ×KˆNÂˆBˆYˆ
^Y\“˜[YJH]˜Z[X›P˜[[˜Ù\ÐžQÜ›Ý\ÙÜ›Ý\Ù^WK˜^Y\“˜[Y\Ë˜Y
^Y\“˜[YJNÂˆ]˜Z[X›P˜[[˜Ù\ÐžQÜ›Ý\ÙÜ›Ý\Ù^WKÝ[]˜Z[X›P˜[[˜ÙH
ÏHX]˜XœÊ™XÙZ]˜X›JNÂˆ]˜Z[X›P˜[[˜Ù\ÐžQÜ›Ý\ÙÜ›Ý\Ù^WKœÝ[\Ëœ\Ú
ÂˆÝ[RYˆÝ[K’YˆÝ[S˜[YNˆ›Ü›X]Ý[S˜[YJÝ[JKˆ^Y\“˜[YKˆ]˜Z[X›P˜[[˜ÙNˆX]˜XœÊ™XÙZ]˜X›JKˆ™XÙZ]˜X›P˜[[˜ÙNˆ™XÙZ]˜X›Kˆ^[Y[]NˆÝ[K”^[Y[Ñ]W×ØÈ^[Y[Ù]QšY[H^[Y[Ü™X]Y]H[ˆJNÂˆBˆBˆ™]\›ˆÂˆYˆ^[Y[’Yˆ^[Y[Yˆ^[Y[’Yˆ^[Y[˜[YNˆ[˜ÛÛZ[™Ô^[Y[\Ü^S˜[YJÂˆ^[Y[ˆ™Y™\™[˜ÙQšY[ËˆÝ[KˆÝ\Y\’[›ÚXÙKˆ\KˆJKˆ^[Y[\Ü^S˜[YNˆ[˜ÛÛZ[™Ô^[Y[\Ü^S˜[YJÂˆ^[Y[ˆ™Y™\™[˜ÙQšY[ËˆÝ[KˆÝ\Y\’[›ÚXÙKˆ\KˆJKˆØ[\Ù›Ü˜ÙT^[Y[˜[YNˆ^[Y[“˜[YH[ˆ^[Y[™XÛÜ™\S˜[YNˆ^[Y[”™XÛÜ™\OË“˜[YH[ˆ^[Y[™XÛÜ™\Q]™[Ü\“˜[YNˆ^[Y[”™XÛÜ™\OË‘]™[Ü\“˜[YH[ˆ^[Y[]KˆÜ™X]Y]Nˆ^[Y[Ü™X]Y]H[ˆ[›ÚXÙQYQ]Nˆ^Y\’[›ÚXÙQYQ]Kˆ[^Q^\Ëˆ^[Y[\›\Îˆ\HOOH	Ð^Y\ˆ^[Y[	ÈÈÝ[OË”^[Y[Õ\›W×ØÈ[ˆ[ˆ\Kˆ\Ò[˜ÛÛZ[™Îˆ\HOOH	Ð^Y\ˆ^[Y[	È\HOOH	ÔÝ\Y\ˆ™Y[™	Ëˆ\Ð˜[šÐÚ\™ÙNˆ\HOOH	Ð˜[šÈÚ\™ÙIËˆ[[Ý[ˆ[˜ÛÛZ[™Ð[[Ý[ˆÝ\œ™[˜ÞNˆ^[Y[Ý\œ™[˜ÞR\ÛÐÛÙH^[Y[Ý\œ™[˜ÞW×ØÈ	ÕTÑ	Ëˆ™Y™\™[˜ÙNˆ[˜ÛÛZ[™Ô^[Y[™Y™\™[˜ÙJ^[Y[™Y™\™[˜ÙQšY[ÊKˆØ[\Ù›Ü˜ÙTÝ]\ÎˆÝ]\ÑšY[Ë›X\

šY[
HOˆ^[Y[ÙšY[JK™š[™
›ÛÛX[ŠH[ˆØ[\Ù›Ü˜ÙU\Nˆ\QšY[Ë›X\

šY[
HOˆ^[Y[ÙšY[JK™š[™
›ÛÛX[ŠH[ˆÝ[RYˆÝ[S˜[YNˆÝ[HÈ›Ü›X]Ý[S˜[YJÝ[JHˆ[ˆÙ^TÝ[NˆÝ[OË’Ù^TÝ[W×ØÈ[ˆ^Y\“˜[YKˆ^Y\‘Ü›Ý\˜[YKˆÝ\Y\’[›ÚXÙRYˆÝ\Y\’[›ÚXÙOË’YÝ\Y\’[›ÚXÙRY[ˆÝ\Y\’[›ÚXÙS˜[YNˆÝ\Y\’[›ÚXÙOË“˜[YH[ˆÝ\Y\“˜[YNˆÝ\Y\’[›ÚXÙT\S˜[YJÝ\Y\’[›ÚXÙKÝ\Y\’[›ÚXÙTÝ\Y\”™[][ÛœÚ\ÊKˆ\S˜[YKˆ[›ÚXÙP[[Ý[ˆ[˜ÛÛZ[™Ô^[Y[[X™\ŠÝ[OË•Ý[Ò[›ÚXÙWÐ[[Ý[×ØÊKˆ™XÙZ]˜X›P˜[[˜ÙNˆ™XÙZ]˜X›Kˆ^XX›P˜[[˜ÙNˆÝ\Y\’[›ÚXÙT^XX›QšY[È[˜ÛÛZ[™Ô^[Y[[X™\ŠÝ\Y\’[›ÚXÙOË–ÜÝ\Y\’[›ÚXÙT^XX›QšY[JHˆ[˜ÛÛZ[™Ô^[Y[[X™\ŠÝ[OË”^XX›WÐ˜[[˜ÙW×ØÊKˆÝ\Y\’[›ÚXÙP[[Ý[ˆÝ\Y\’[›ÚXÙP[[Ý[šY[È[˜ÛÛZ[™Ô^[Y[[X™\ŠÝ\Y\’[›ÚXÙOË–ÜÝ\Y\’[›ÚXÙP[[Ý[šY[JHˆ[ˆÝ]\ÎˆÝ]\Ë›X™[ˆÝ]\ÕÛ™NˆÝ]\ËÛ™Kˆ^[Y[Øš™XÝ[[Ý[šY[ˆ[[Ý[šY[ˆ^[Y[Øš™XÝÝ\Y\’[›ÚXÙQšY[ÎˆÝ\Y\’[›ÚXÙSÛÚÝ\šY[Ëˆœ›ÚÙ\ÛÛ[Z\ÜÚ[Û“X]ÚˆNÂˆJBˆ™š[\Š›ÛÛX[ŠNÂˆÛÛœÝ›ÝÜÈH[›ÝÜË™š[\Š
›ÝÊHOˆ›ÝË\HOOH	ÔÝ\Y\ˆ^[Y[	È	‰ˆ›ÝË\HOOH	Ð˜[šÈÚ\™ÙIÈ	‰ˆ›ÝË\HOOH	Ðœ›ÚÙ\ˆÛÛ[Z\ÜÚ[Û‰ÊK›X\

›ÝÊHOˆ
È‹‹œ›ÝË˜[šÐÚ\™Ù\Îˆ×HJJNÂˆÛÛœÝ[™Ü›Ý\Y˜[šÐÚ\™Ù\ÈH×NÂˆ›Üˆ
ÛÛœÝÚ\™ÙHÙˆ[›ÝÜË™š[\Š
›ÝÊHOˆ›ÝË\HOOH	Ð˜[šÈÚ\™ÙIÊJHÂˆÛÛœÝÚ\™ÙQ]HH]SÛ›JÚ\™ÙKœ^[Y[]JNÂˆÛÛœÝØ[™Y]\ÈH›ÝÜÂˆ™š[\Š
›ÝÊHOˆ›ÝË\HOOH	Ð^Y\ˆ^[Y[	È	‰ˆ›ÝËœÝ[RY	‰ˆ›ÝËœÝ[RYOOHÚ\™ÙKœÝ[RY
BˆœÛÜ

KŠHOˆÂˆÛÛœÝTØ[YQ]HH]SÛ›JKœ^[Y[]JHOOHÚ\™ÙQ]HÈHˆÂˆÛÛœÝ”Ø[YQ]HH]SÛ›J‹œ^[Y[]JHOOHÚ\™ÙQ]HÈHˆÂˆYˆ
TØ[YQ]HOOH”Ø[YQ]JH™]\›ˆ”Ø[YQ]HHTØ[YQ]NÂˆ™]\›ˆX]˜XœÊ[X™\Š‹˜[[Ý[
JHHX]˜XœÊ[X™\ŠK˜[[Ý[
JNÂˆJNÂˆÛÛœÝ\™Ù]HØ[™Y]\ÖÌH[ÂˆYˆ
\™Ù]
HÂˆ]XÚ˜[šÐÚ\™ÙUÔ^[Y[
\™Ù]Ú\™ÙJNÂˆH[ÙHÂˆ[™Ü›Ý\Y˜[šÐÚ\™Ù\Ëœ\Ú
Ú\™ÙJNÂˆBˆBˆÛÛœÝ[\XÚ]˜[šÐÚ\™ÙRYÈH™]ÈÙ]

NÂˆ›Üˆ
ÛÛœÝÚ\™ÙHÙˆ›ÝÜÊHÂˆÛÛœÝ\™Ù]H[˜ÛÛZ[™Ô^[Y[˜[šÐÚ\™ÙU\™Ù]
Ú\™ÙK›ÝÜÊNÂˆYˆ
]\™Ù]
HÛÛ[YNÂˆ]XÚ˜[šÐÚ\™ÙUÔ^[Y[
\™Ù]Ú\™ÙJNÂˆ[\XÚ]˜[šÐÚ\™ÙRYË˜Y
Ú\™ÙKšYÚ\™ÙKœ^[Y[Y
NÂˆBˆÛÛœÝ\Ü^T›ÝÜÈH›ÝÜË™š[\Š
›ÝÊHOˆZ[\XÚ]˜[šÐÚ\™ÙRYËš\Ê›ÝËšY›ÝËœ^[Y[Y
JNÂˆ\Ü^T›ÝÜËœ\Ú
‹‹[™Ü›Ý\Y˜[šÐÚ\™Ù\ÊNÂ‚ˆÛÛœÝ[\™\Ý›ÝYšXØ][Û“X\H›ÙK—ÛÛZ][˜ÛÛZ[™Ó]™TÝ]HÈßHˆ]ØZ]ØY[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][Û“X\
\Ü^T›ÝÜË›X\

›ÝÊHOˆ›ÝËœ^[Y[Y›ÝËšY
JNÂˆÛÛœÝ›ÝÜÕÚ][\™\Ý›ÝYšXØ][ÛœÈH\Ü^T›ÝÜË›X\

›ÝÊHOˆÂˆÛÛœÝ›ÝYšXØ][ÛˆH[\™\Ý›ÝYšXØ][Û“X\Ü›ÝËœ^[Y[Y›ÝËšYH[Âˆ™]\›ˆÂˆ‹‹œ›ÝËˆ[\™\Ý[›ÚXÙS›ÝYšXØ][ÛŽˆ›ÝYšXØ][Û‹ˆ[\™\Ý[›ÚXÙS›ÝYšXØ][Û”Ù[ˆ›ÝYšXØ][ÛË™[]™\žTÝ]\ÈOOH	ÜÙ[	Ëˆ[\™\Ý[›ÚXÙS›ÝYšXØ][Û”[™[™ÎˆÉÜÙ[™[™ÉË	Ý[˜Ù\Z[‰×Kš[˜ÛY\Ê›ÝYšXØ][ÛË™[]™\žTÝ]\ÊKˆNÂˆJNÂ‚ˆÛÛœÝ[˜ÛYY[˜ÛÛZ[™Ô›ÝÜÈH›ÝÜÕÚ][\™\Ý›ÝYšXØ][ÛœË™š[\Š
›ÝÊHOˆ›ÝËš\Ò[˜ÛÛZ[™ÊNÂˆÛÛœÝ^Y\ÚXR[›ÚXÙ\ÈH]ØZ][˜ÛÛZ[™Ð^Y\ÚXR[›ÚXÙ\ÊÂˆ™\ÚÛÝ]NˆÙ][™ÜËˆXØÙ\ÜÐÛÛ^ˆJNÂˆÛÛœÝ]˜Z[X›P˜[[˜Ù\ÈHØš™XÝ˜[Y\Ê]˜Z[X›P˜[[˜Ù\ÐžQÜ›Ý\
Bˆ›X\

Ü›Ý\
HOˆ
Âˆ^Y\‘Ü›Ý\˜[YNˆÜ›Ý\˜^Y\‘Ü›Ý\˜[YKˆ^Y\“˜[Y\ÎˆË‹‹™Ü›Ý\˜^Y\“˜[Y\×KœÛÜ

KŠHOˆK›ØØ[PÛÛ\\™JŠJKˆÝ[]˜Z[X›P˜[[˜ÙNˆÜ›Ý\Ý[]˜Z[X›P˜[[˜ÙKˆÝ[\ÎˆÜ›Ý\œÝ[\ËœÛÜ

KŠHOˆÝš[™Ê‹œ^[Y[]H	ÉÊK›ØØ[PÛÛ\\™JÝš[™ÊKœ^[Y[]H	ÉÊJJKˆJJBˆœÛÜ

KŠHOˆ‹Ý[]˜Z[X›P˜[[˜ÙHHKÝ[]˜Z[X›P˜[[˜ÙJNÂ‚ˆ™]\›ˆÂˆ›ÝÜÎˆ›ÝÜÕÚ][\™\Ý›ÝYšXØ][ÛœËˆ^Y\ÚXR[›ÚXÙ\Ëˆ]˜Z[X›P˜[[˜Ù\ËˆÙ][™ÜËˆ]Qœ›ÛKˆ]UËˆØÚ[XNˆÂˆ^[Y[]QšY[ˆ]QšY[ˆ^[Y[š[\‘]QšY[ˆš[\‘]QšY[ˆ^[Y[[[Ý[šY[ˆ[[Ý[šY[ˆ^[Y[™Y™\™[˜ÙQšY[Îˆ™Y™\™[˜ÙQšY[Ëˆ^[Y[Ý\Y\’[›ÚXÙQšY[ÎˆÝ\Y\’[›ÚXÙSÛÚÝ\šY[ËˆÝ\Y\’[›ÚXÙT^XX›QšY[ˆÝ\Y\’[›ÚXÙP[[Ý[šY[ˆKˆØÚ[XUØ\›š[™ÜÎˆØ[[Ý[šY[È[ˆ	Ó›È[[Ý[[ZÙHšY[Ø\È›Ý[™Ûˆ^[Y[×ØË‰Ë]QšY[È[ˆ	Ó›È]K[ZÙHšY[Ø\È›Ý[™Ûˆ^[Y[×ØË‰Ë	ÔÝ\Y\‹Z[›ÚXÙK[[šÙY™YØ]]™H^[Y[È\™HÛ\ÜÚYšYY\ÈÝ\Y\ˆ™Y[™ËˆÛÛ™š\›HYˆØ[\Ù›Ü˜ÙH\Ù\ÈHÜÜÚ]HÚYÛ‹‰×K™š[\Š›ÛÛX[ŠKˆÝ[[X\žNˆÂˆÝ[›ÝÜÎˆ›ÝÜÕÚ][\™\Ý›ÝYšXØ][ÛœË›[™Ýˆ[˜ÛÛZ[™Ô›ÝÜÎˆ[˜ÛYY[˜ÛÛZ[™Ô›ÝÜË›[™ÝˆÝ[[˜ÛÛZ[™Ð[[Ý[ˆ[˜ÛYY[˜ÛÛZ[™Ô›ÝÜËœ™YXÙJ
Ý[K›ÝÊHOˆÝ[H
ÈX]˜XœÊ[X™\Š›ÝËš[˜ÛÛZ[™Ð[[Ý[
JK
Kˆ^Y\”^[Y[Ý[ˆ›ÝÜÕÚ][\™\Ý›ÝYšXØ][ÛœË™š[\Š
›ÝÊHOˆ›ÝË\HOOH	Ð^Y\ˆ^[Y[	ÊKœ™YXÙJ
Ý[K›ÝÊHOˆÝ[H
ÈX]˜XœÊ[X™\Š›ÝËš[˜ÛÛZ[™Ð[[Ý[
JK
KˆÝ\Y\”™Y[™Ý[ˆ›ÝÜÕÚ][\™\Ý›ÝYšXØ][ÛœË™š[\Š
›ÝÊHOˆ›ÝË\HOOH	ÔÝ\Y\ˆ™Y[™	ÊKœ™YXÙJ
Ý[K›ÝÊHOˆÝ[H
ÈX]˜XœÊ[X™\Š›ÝËš[˜ÛÛZ[™Ð[[Ý[
JK
Kˆ[›X]ÚYÛÝ[ˆ›ÝÜÕÚ][\™\Ý›ÝYšXØ][ÛœË™š[\Š
›ÝÊHOˆ›ÝË\HOOH	Õ[›X]ÚY	È›ÝËœÝ]\ÈOOH	Ó™YYÈ™]šY]ÉÊK›[™Ýˆ[TZYÛÝ[ˆ›ÝÜÕÚ][\™\Ý›ÝYšXØ][ÛœË™š[\Š
›ÝÊHOˆ›ÝËœÝ]\ÈOOH	Ñ[HZY	ÊK›[™Ýˆ]˜Z[X›P˜[[˜ÙUÝ[ˆ]˜Z[X›P˜[[˜Ù\Ëœ™YXÙJ
Ý[KÜ›Ý\
HOˆÝ[H
È[X™\ŠÜ›Ý\Ý[]˜Z[X›P˜[[˜ÙH
K
Kˆ]˜Z[X›P˜[[˜ÙPÛÝ[ˆ]˜Z[X›P˜[[˜Ù\Ëœ™YXÙJ
Ý[KÜ›Ý\
HOˆÝ[H
È
Ü›Ý\œÝ[\ÏË›[™Ý
K
KˆKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[Ó\Ý
›ÙK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÙ][™ÜÈH]ØZ]ØY[˜ÛÛZ[™Ô^[Y[Ù][™ÜÊ
NÂˆÛÛœÝÙ^HH]SÛ›J™]È]J
JNÂˆÛÛœÝ]Qœ›ÛHH]SÛ›J›ÙK™]Qœ›ÛH›ÙK™]WÙœ›ÛHÙ^JNÂˆÛÛœÝ]UÈH]SÛ›J›ÙK™]UÈ›ÙK™]WÝÈÙ^JNÂˆÛÛœÝ[Z]HX]›X^
LX]›Z[Š[X™\Š›ÙK›[Z]
HLL
JNÂˆÛÛœÝÈ˜[YNˆÛ˜\ÚÝHH]ØZ]ØXÚYØ[\Ù›Ü˜ÙU˜[YJÂˆ˜[Y\ÜXÙNˆ	Ú[˜ÛÛZ[™Ë\^[Y[ÉËˆ^[ØYˆÈ]Qœ›ÛK]UË[Z]™\ÚÛÎˆ^[Y[ÛÛXÝ[Û•™\ÚÛØXÚRÙ^JÙ][™ÜÊHKˆÙXÛÛ™ÎˆŒˆYÜÎˆÉÜØ[\Ù›Ü˜ÙNš[˜ÛÛZ[™Ë\^[Y[ÉË	ÜØ[\Ù›Ü˜ÙNœÝ[IË	ÜØ[\Ù›Ü˜ÙN˜XØÛÝ[	Ë	ÜØ[\Ù›Ü˜ÙN›Øš™XÝ”^[Y[×ØÉË	ÜØ[\Ù›Ü˜ÙN›Øš™XÝ”Ý\Y\—Ò[›ÚXÙW×ØÉ×Kˆ›ÙKˆ™\KˆXØÙ\ÜÐÛÛ^ˆØY\Žˆ

HO‚ˆ[˜ÛÛZ[™Ô^[Y[Ó\ÝÛ˜\ÚÝ
ˆÂˆ‹‹˜›ÙKˆ]Qœ›ÛKˆ]UËˆ[Z]ˆÜÙ][™ÜÓÝ™\œšYNˆÙ][™ÜËˆÛÛZ][˜ÛÛZ[™Ó]™TÝ]NˆYKˆKˆ™\KˆXØÙ\ÜÐÛÛ^ˆ
KˆJNÂˆÛÛœÝ›ÝYšXØ][Û“X\H]ØZ]ØY[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][Û“X\

Û˜\ÚÝœ›ÝÜÈ×JK›X\

›ÝÊHOˆ›ÝËœ^[Y[Y›ÝËšY
JNÂˆÛÛœÝÛÛXÝ[Û“X\H]ØZ]ØY^Y\’[›ÚXÙPÛÛXÝ[Û“X\

Û˜\ÚÝœ›ÝÜÈ×JK›X\

›ÝÊHOˆ›ÝËœÝ[RY
K™š[\Š›ÛÛX[ŠJNÂˆ™]\›ˆÂˆ‹‹œÛ˜\ÚÝˆÙ][™ÜËˆ›ÝÜÎˆ
Û˜\ÚÝœ›ÝÜÈ×JK›X\

›ÝÊHOˆÂˆÛÛœÝ›ÝYšXØ][ÛˆH›ÝYšXØ][Û“X\Ü›ÝËœ^[Y[Y›ÝËšYH[Âˆ™]\›ˆÂˆ‹‹œ›ÝËˆÛÛXÝ[ÛŽˆÛÛXÝ[Û“X\Ü›ÝËœÝ[RYOËš][H[ˆÛÛXÝ[Û‘]™[ÎˆÛÛXÝ[Û“X\Ü›ÝËœÝ[RYOË™]™[È×Kˆ[\™\Ý[›ÚXÙS›ÝYšXØ][ÛŽˆ›ÝYšXØ][Û‹ˆ[\™\Ý[›ÚXÙS›ÝYšXØ][Û”Ù[ˆ›ÝYšXØ][ÛË™[]™\žTÝ]\ÈOOH	ÜÙ[	Ëˆ[\™\Ý[›ÚXÙS›ÝYšXØ][Û”[™[™ÎˆÉÜÙ[™[™ÉË	Ý[˜Ù\Z[‰×Kš[˜ÛY\Ê›ÝYšXØ][ÛË™[]™\žTÝ]\ÊKˆNÂˆJKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[ØØ][ÛÛÛ™š\›J›ÙK™\JHÂˆ]ØZ]™\]Z\™PYZ[š\Ý˜]ÜŠ™\JNÂˆÛÛœÝ^Y\‘Ü›Ý\˜[YHHÝš[™Ê›ÙK˜^Y\‘Ü›Ý\˜[YH›ÙK˜^Y\—ÙÜ›Ý\Û˜[YH	ÉÊKš[J
NÂˆYˆ
X^Y\‘Ü›Ý\˜[YJH›ÝÈ\\œ›ÜŠ	Ð^Y\ˆÜ›Ý\\È™\]Z\™Y‰Ë
NÂˆ›ÝÈ\\œ›ÜŠ	ÔØ[\Ù›Ü˜ÙH^[Y[[ØØ][ÛˆÜš]KX˜XÚÈ\È›Ý[˜X›YY]ˆÛÛ™š\›HHØ[\Ù›Ü˜ÙHØš™XÝ[™šY[È›Üˆ\Z[™È]˜Z[X›H^Y\ˆ˜[[˜Ù\ÈÈ[›Ý\ˆÕSK‰ËLJNÂŸB‚˜ÛÛœÝSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÓ“ÕQ’PÐUSÓ—Ñ’QSÈHÉÚY	Ë	Ü^[Y[ÚY	Ë	Ü^[Y[Û˜[YIË	ÜÝ[WÚY	Ë	ÜÝ[WÛ˜[YIË	Ø^Y\—Û˜[YIË	Ø^Y\—ÙÜ›Ý\Û˜[YIË	Ü™XÙZ]™YÙ]IË	Ü^[Y[ØÜ™X]YÙ]IË	Ù[^WÙ^\ÉË	Ø[[Ý[	Ë	ØÝ\œ™[˜ÞIË	Ü™XÙZ]˜X›WØ˜[[˜ÙIË	Ü™XÚ\Y[Ù[XZ[	Ë	Ù[XZ[ÜÝXš™XÝ	Ë	Ù[XZ[ÛY\ÜØYÙWÚY	Ë	Ù[XZ[Ü›ÝšY\‰Ë	ØXÝÜ—Ý\Ù\—ÚY	Ë	ØXÝÜ—Ù[XZ[	Ë	ØXÝÜ—Û˜[YIË	ÛY]Y]IË	Ù[]™\žWÜÝ]\ÉË	Û\ÝØ][\Ø]	Ë	Û\ÝÙ\œ›Ü‰Ë	ÜÙ[™\—ÛXZ[›ÞÚY	Ë	ÜÙ[™\—ÛXZ[›ÞÜÛ˜\ÚÝ	Ë	ÜÙ[Ø]	Ë	ØÜ™X]YØ]	Ë	Ý\]YØ]	×Kš›Ú[Š	Ë	ÊNÂ‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[“[X™\Š˜[YJHÂˆÛÛœÝ[X™\ˆH[X™\Š˜[YJNÂˆ™]\›ˆ[X™\‹š\Ñš[š]J[X™\ŠHÈ[X™\Š[X™\‹Ñš^Y
ŠJHˆ[ÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[‘]J˜[YJHÂˆYˆ
]˜[YJH™]\›ˆ[ÂˆÛÛœÝ]HH™]È]J˜[YJNÂˆ™]\›ˆ[X™\‹š\Ó˜SŠ]K™Ù][YJ
JHÈ[ˆ]KÒTÓÔÝš[™Ê
NÂŸB‚™[˜Ý[ÛˆÙ\šX[^™R[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][ÛŠ›ÝÈH[
HÂˆYˆ
\›ÝÊH™]\›ˆ[Âˆ™]\›ˆÂˆYˆ›ÝËšYˆ^[Y[Yˆ›ÝËœ^[Y[ÚYˆ^[Y[˜[YNˆ›ÝËœ^[Y[Û˜[YKˆÝ[RYˆ›ÝËœÝ[WÚYˆÝ[S˜[YNˆ›ÝËœÝ[WÛ˜[YKˆ^Y\“˜[YNˆ›ÝË˜^Y\—Û˜[YKˆ^Y\‘Ü›Ý\˜[YNˆ›ÝË˜^Y\—ÙÜ›Ý\Û˜[YKˆ™XÙZ]™Y]Nˆ›ÝËœ™XÙZ]™YÙ]Kˆ^[Y[Ü™X]Y]Nˆ›ÝËœ^[Y[ØÜ™X]YÙ]Kˆ[^Q^\Îˆ›ÝË™[^WÙ^\Ëˆ[[Ý[ˆ[˜ÛÛZ[™Ô^[Y[[X™\Š›ÝË˜[[Ý[
KˆÝ\œ™[˜ÞNˆ›ÝË˜Ý\œ™[˜ÞKˆ™XÙZ]˜X›P˜[[˜ÙNˆ[˜ÛÛZ[™Ô^[Y[[X™\Š›ÝËœ™XÙZ]˜X›WØ˜[[˜ÙJKˆ™XÚ\Y[[XZ[ˆ›ÝËœ™XÚ\Y[Ù[XZ[ˆ[XZ[ÝXš™XÝˆ›ÝË™[XZ[ÜÝXš™XÝˆ[XZ[Y\ÜØYÙRYˆ›ÝË™[XZ[ÛY\ÜØYÙWÚYˆ[XZ[›ÝšY\Žˆ›ÝË™[XZ[Ü›ÝšY\‹ˆXÝÜ•\Ù\’Yˆ›ÝË˜XÝÜ—Ý\Ù\—ÚYˆXÝÜ‘[XZ[ˆ›ÝË˜XÝÜ—Ù[XZ[ˆXÝÜ“˜[YNˆ›ÝË˜XÝÜ—Û˜[YKˆY]Y]Nˆ›ÝË›Y]Y]HßKˆ[]™\žTÝ]\Îˆ›ÝË™[]™\žWÜÝ]\È	ÜÙ[	Ëˆ\Ý][\]ˆ›ÝË›\ÝØ][\Ø][ˆ\Ý\œ›ÜŽˆ›ÝË›\ÝÙ\œ›Üˆ[ˆÙ[™\“XZ[›ÞYˆ›ÝËœÙ[™\—ÛXZ[›ÞÚY[ˆÙ[™\“XZ[›ÞÛ˜\ÚÝˆ›ÝËœÙ[™\—ÛXZ[›ÞÜÛ˜\ÚÝ[ˆÙ[]ˆ›ÝËœÙ[Ø]ˆÜ™X]Y]ˆ›ÝË˜Ü™X]YØ]ˆ\]Y]ˆ›ÝË\]YØ]›ÝË˜Ü™X]YØ]ˆNÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝX›U[˜]˜Z[X›J\œ›ÜŠHÂˆ™]\›ˆ\œ›ÜË˜ÛÙHOOH	Í”IÈÚ[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÛ›ÝYšXØ][ÛœËÚK\Ý
\œ›ÜË›Y\ÜØYÙH	ÉÊNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØY[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][Û“X\
^[Y[YÈH×JHÂˆÛÛœÝÛY[HØY™TÝ\X˜\ÙPYZ[ÛY[

NÂˆYˆ
XÛY[
H™]\›ˆßNÂˆÛÛœÝYÈHË‹‹›™]ÈÙ]
^[Y[YË›X\

Y
HOˆÝš[™ÊY	ÉÊKš[J
JK™š[\Š›ÛÛX[ŠJWNÂˆYˆ
ZYË›[™Ý
H™]\›ˆßNÂˆÛÛœÝ›ÝYšXØ][ÛœÈHßNÂˆ›Üˆ
ÛÛœÝÚ[šÈÙˆÚ[šÒYÊYËL
JHÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÛ›ÝYšXØ][ÛœÉÊKœÙ[XÝ
SÓÓRS‘×ÔVSQS•ÒS•T‘TÕÓ“ÕQ’PÐUSÓ—Ñ’QSÊKš[Š	Ü^[Y[ÚY	ËÚ[šÊNÂˆYˆ
\œ›ÜŠHÂˆYˆ
Z[˜ÛÛZ[™Ô^[Y[[\™\ÝX›U[˜]˜Z[X›J\œ›ÜŠJHÂˆÛÛœÛÛK™\œ›ÜŠ	Ñ˜Z[YÈØY[˜ÛÛZ[™È^[Y[[\™\Ý›ÝYšXØ][ÛœÉË\œ›Ü‹›Y\ÜØYÙJNÂˆBˆ™]\›ˆßNÂˆBˆ›Üˆ
ÛÛœÝ›ÝÈÙˆ]H×JH›ÝYšXØ][ÛœÖÜ›ÝËœ^[Y[ÚYHHÙ\šX[^™R[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][ÛŠ›ÝÊNÂˆBˆ™]\›ˆ›ÝYšXØ][ÛœÎÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ™]Ú[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][ÛŠÛY[^[Y[Y
HÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÛ›ÝYšXØ][ÛœÉÊKœÙ[XÝ
SÓÓRS‘×ÔVSQS•ÒS•T‘TÕÓ“ÕQ’PÐUSÓ—Ñ’QSÊK™\J	Ü^[Y[ÚY	Ë^[Y[Y
K›X^X™TÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠHÂˆYˆ
[˜ÛÛZ[™Ô^[Y[[\™\ÝX›U[˜]˜Z[X›J\œ›ÜŠJHÂˆ›ÝÈ\\œ›ÜŠ	ÓZ\ÜÚ[™ÈÝ\X˜\ÙHX›H[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÛ›ÝYšXØ][ÛœËˆ[ˆH]\ÝÝ\X˜\ÙHZYÜ˜][Ûˆ™Y›Ü™H™\]Y\Ý[™È]H^[Y[[\™\Ý[›ÚXÙ\Ë‰ËL
NÂˆBˆ›ÝÈ\œ›ÜŽÂˆBˆ™]\›ˆÙ\šX[^™R[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][ÛŠ]JNÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\Ý˜]QšY[
XØÛÝ[šY[ÈH×JHÂˆÛÛœÝ[ÝÙY\\ÈH™]ÈÙ]
ÉÙÝX›IË	Ü\˜Ù[	Ë	ØÝ\œ™[˜ÞIË	Ú[	Ë	ÜÝš[™ÉË	ÜXÚÛ\Ý	×JNÂˆÛÛœÝX]Ú\ÈHXØÛÝ[šY[Ë™š[\Š
šY[
HOˆšY[Ë›˜[YH	‰ˆ[ÝÙY\\Ëš\ÊšY[\JH	‰ˆšY[X]Ú\Ð[žJšY[ÉÛ]\^[Y[[\™\Ý˜]IË	Û]\^[Y[[\™\Ý˜]XÉË	Ü^[Y[[\™\Ý˜]IË	Ü^[Y[[\™\Ý˜]XÉË	ÛÝ™\™YZ[\™\Ý˜]IË	ÛÝ™\™YZ[\™\Ý˜]XÉË	Ú[\™\Ý˜]IË	Ú[\™\Ý˜]XÉË	Ùš[˜[˜ÙXÚ\™Ù\˜]IË	Ùš[˜[˜ÙXÚ\™Ù\˜]XÉ×KÉÛ]\^[Y[[\™\Ý	Ë	ÛÝ™\™YZ[\™\Ý	Ë	Ú[\™\Ý˜]IË	Ùš[˜[˜ÙXÚ\™ÙI×JJNÂˆ™]\›ˆX]Ú\ÖÌH[ÂŸB‚™[˜Ý[Ûˆ\œÙR[˜ÛÛZ[™Ô^[Y[[\™\Ý˜]J˜[YJHÂˆYˆ
˜[YHOH[˜[YHOOH	ÉÊH™]\›ˆ[ÂˆÛÛœÝX]ÚHÝš[™Ê˜[YJBˆœ™\XÙJËÙË	ÉÊBˆ›X]Ú
ËO×
Ê—
ÊOËÊNÂˆYˆ
[X]Ú
H™]\›ˆ[ÂˆÛÛœÝ[X™\ˆH[X™\ŠX]ÚÌJNÂˆYˆ
S[X™\‹š\Ñš[š]J[X™\ŠH[X™\ˆ
H™]\›ˆ[Âˆ™]\›ˆX]˜XœÊ[X™\ŠHˆHÈ[X™\ˆÈLˆ[X™\ŽÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\Ý˜]SX™[
˜]QXÚ[X[
HÂˆYˆ
˜]QXÚ[X[OH[
H™]\›ˆ	ËIÎÂˆ™]\›ˆ	Ê[X™\Š˜]QXÚ[X[
H
ˆL
KÓØØ[TÝš[™Ê	Ù[‹UTÉËÈZ[š[][Qœ˜XÝ[Û‘YÚ]Îˆ‹X^[][Qœ˜XÝ[Û‘YÚ]ÎˆˆJ_IH\ˆ[ÛÂŸB‚™[˜Ý[Ûˆ[\™\Ý›Ü›][U^
˜[[˜ÙK˜]QXÚ[X[^\ÊHÂˆ™]\›ˆ	Û[Û™^J˜[[˜ÙJ_H	Ú[˜ÛÛZ[™Ô^[Y[[\™\Ý˜]SX™[
˜]QXÚ[X[
_H	Ù^\ßHÈÌÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝØ[Ý[][ÛŠ›ÙHHßKXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÝ[RYHÝš[™Ê›ÙKœÝ[RY›ÙKœÝ[WÚY	ÉÊKš[J
NÂˆYˆ
Z\ÔØ[\Ù›Ü˜ÙRY
Ý[RY
JH›ÝÈ\\œ›ÜŠ	Õ˜[YÝ[RY\È™\]Z\™Y›Üˆ]H^[Y[[\™\ÝØ[Ý[][Û‹‰Ë
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊÝ[RYXØÙ\ÜÐÛÛ^
NÂ‚ˆÛÛœÝÜÝ[Q\ØÜšX™K^[Y[\ØÜšX™WHH]ØZ]›ÛZ\ÙK˜[
ÂˆØ[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	ÜÝ[W×ØÉÈJK˜Ø]Ú


HOˆ
ÂˆšY[Îˆ×KˆJJKˆØ[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	Ô^[Y[×ØÉÈJK˜Ø]Ú


HOˆ
ÂˆšY[Îˆ×KˆJJKˆJNÂˆÛÛœÝÝ[QšY[ÈHÝ[Q\ØÜšX™K™šY[È×NÂˆÛÛœÝÝ[QšY[˜[Y\ÈH™]ÈÙ]
Ý[QšY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝ^[Y[šY[ÈH^[Y[\ØÜšX™K™šY[È×NÂˆÛÛœÝ^[Y[šY[˜[Y\ÈH™]ÈÙ]
^[Y[šY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆYˆ
\^[Y[šY[˜[Y\ËœÚ^™JH›ÝÈ\\œ›ÜŠ	Ô^[Y[×ØÈ\È›Ý]Y\žXX›KÛÈ[\™\ÝØ[››Ý™HØ[Ý[]Y‰ËL
NÂ‚ˆÛÛœÝXØÛÝ[\ØÜšX™HHÝ[QšY[˜[Y\Ëš\Ê	ÐXØÛÝ[×ØÉÊBˆÈ]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	ÐXØÛÝ[	ÈJK˜Ø]Ú


HOˆ
ÂˆšY[Îˆ×KˆJJBˆˆÈšY[Îˆ×HNÂˆÛÛœÝXØÛÝ[šY[ÈHXØÛÝ[\ØÜšX™K™šY[È×NÂˆÛÛœÝXØÛÝ[šY[˜[Y\ÈH™]ÈÙ]
XØÛÝ[šY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝ[\™\ÝšY[H[˜ÛÛZ[™Ô^[Y[[\™\Ý˜]QšY[
XØÛÝ[šY[ÊNÂ‚ˆÛÛœÝÝ[TÙ[XÝšY[ÈHÉÒY	Ë	Ó˜[YIË‹‹œÙ[XÝYšY[ÊÝ[QšY[˜[Y\ËÉÒÙ^TÝ[W×ØÉË	Ð^Y\—Ó˜[YW×ØÉË	Ð^Y\—×ØÉË	ÐXØÛÝ[×ØÉË	ÕÝ[Ò[›ÚXÙWÐ[[Ý[×ØÉË	Ô™XÙZ]˜X›WÐ˜[[˜ÙW×ØÉË	Ô^[Y[Õ\›W×ØÉË	Ò[›ÚXÙWÑYWÑ]W×ØÉË	Ð^Y\—Ô^WÕ\›WÑ]W×ØÉË	ÑYWÑ]W×ØÉË	Ñ[]™\žWÑ]W×ØÉË	Ñ[]™\žWÑ]WÓÜ—Ñ^XÝY×ØÉË	Ñ^XÝYÑ[]™\žWÑ]W×ØÉ×JWNÂˆYˆ
Ý[QšY[˜[Y\Ëš\Ê	Õ™\ÜÙ[×ØÉÊJHÝ[TÙ[XÝšY[Ëœ\Ú
	Õ™\ÜÙ[×Ü‹“˜[YIÊNÂˆYˆ
Ý[QšY[˜[Y\Ëš\Ê	ÔÜ×ØÉÊJHÝ[TÙ[XÝšY[Ëœ\Ú
	ÔÜ×Ü‹“˜[YIÊNÂˆYˆ
Ý[QšY[˜[Y\Ëš\Ê	ÐXØÛÝ[×ØÉÊJHÂˆÝ[TÙ[XÝšY[Ëœ\Ú
	ÐXØÛÝ[×Ü‹“˜[YIÊNÂˆYˆ
XØÛÝ[šY[˜[Y\Ëš\Ê	ÑÜ›Ý\Ó˜[YW×ØÉÊJHÝ[TÙ[XÝšY[Ëœ\Ú
	ÐXØÛÝ[×Ü‹‘Ü›Ý\Ó˜[YW×ØÉÊNÂˆYˆ
XØÛÝ[šY[˜[Y\Ëš\Ê	Ô\™[Y	ÊJHÝ[TÙ[XÝšY[Ëœ\Ú
	ÐXØÛÝ[×Ü‹”\™[“˜[YIÊNÂˆYˆ
[\™\ÝšY[Ë›˜[YJHÝ[TÙ[XÝšY[Ëœ\Ú
XØÛÝ[×Ü‹‰Ú[\™\ÝšY[›˜[Y_X
NÂˆB‚ˆÛÛœÝÝ[T›ÝÜÈH]ØZ]]Y\žT›ÝÜÊˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
Ý[TÙ[XÝšY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓHÝ[W×ØÂˆÒT‘HYH	ÉÙ\ØØ\TÛÜ[
Ý[RY
_IÂˆSRUBˆˆÈ[Z]ˆKÛÙ˜Z[ˆYHKˆ
NÂˆÛÛœÝÝ[HHÝ[T›ÝÜÖÌNÂˆYˆ
\Ý[JH›ÝÈ\\œ›ÜŠ	ÔÕSHØ\È›Ý›Ý[™[ˆØ[\Ù›Ü˜ÙK‰Ë
NÂ‚ˆÛÛœÝ]QšY[Hš\œÝ]˜Z[X›QšY[
^[Y[šY[˜[Y\ËÉÑ]W×ØÉË	Ô^[Y[Ñ]W×ØÉË	Ô™XÙZ]™YÑ]W×ØÉË	ÔZYÑ]W×ØÉË	ÐÜ™X]Y]I×JNÂˆÛÛœÝ[[Ý[šY[Hš\œÝ]˜Z[X›QšY[
^[Y[šY[˜[Y\ËÉÐ[[Ý[×ØÉË	Ô^[Y[Ð[[Ý[×ØÉË	ÔZYÐ[[Ý[×ØÉË	Ô™XÙZ]™YÐ[[Ý[×ØÉË	ÕÝ[Ð[[Ý[×ØÉË	Ð[[Ý[ÔZY×ØÉË	Ô^[Y[Õ˜[YW×ØÉË	ÐXÝX[Ð[[Ý[×ØÉ×JNÂˆYˆ
Y]QšY[X[[Ý[šY[
H›ÝÈ\\œ›ÜŠ	Ô^[Y[]HÜˆ[[Ý[šY[Ø\È›Ý›Ý[™Ûˆ^[Y[×ØË‰ËL
NÂ‚ˆÛÛœÝ™Y™\™[˜ÙQšY[ÈH[˜ÛÛZ[™Ô^[Y[™Y™\™[˜ÙQšY[Ê^[Y[šY[ÊNÂˆÛÛœÝÝ]\ÑšY[ÈHÙ[XÝYšY[Ê^[Y[šY[˜[Y\ËÉÔÝ]\××ØÉË	Ô^[Y[ÔÝ]\××ØÉ×JNÂˆÛÛœÝ\QšY[ÈHÙ[XÝYšY[Ê^[Y[šY[˜[Y\ËÉÕ\W×ØÉË	Ô^[Y[Õ\W×ØÉ×JNÂˆÛÛœÝ\™XÝ[Û‘šY[ÈH[˜ÛÛZ[™Ô^[Y[\™XÝ[Û‘šY[Ê^[Y[šY[ÊNÂˆÛÛœÝÝ\Y\’[›ÚXÙSÛÚÝ\šY[ÈH[˜ÛÛZ[™Ô^[Y[Ý\Y\’[›ÚXÙQšY[Ê^[Y[šY[ÊNÂˆÛÛœÝ^[Y[Ù[XÝšY[ÈHÉÒY	Ë‹‹œÙ[XÝYšY[Ê^[Y[šY[˜[Y\ËÉÓ˜[YIË	Ô™XÛÜ™\RY	Ë	ÐÜ™X]Y]IË	Ó\Ý[ÙYšYY]IË	ÔÕSW×ØÉË	ÐÝ\œ™[˜ÞR\ÛÐÛÙIË	ÐÝ\œ™[˜ÞW×ØÉ×JK^[Y[šY[˜[Y\Ëš\Ê	Ô™XÛÜ™\RY	ÊHÈ	Ô™XÛÜ™\K“˜[YIÈˆ[^[Y[šY[˜[Y\Ëš\Ê	Ô™XÛÜ™\RY	ÊHÈ	Ô™XÛÜ™\K‘]™[Ü\“˜[YIÈˆ[‹‹œÝ\Y\’[›ÚXÙSÛÚÝ\šY[Ë]QšY[[[Ý[šY[‹‹œ™Y™\™[˜ÙQšY[Ë‹‹œÝ]\ÑšY[Ë‹‹\QšY[Ë‹‹™\™XÝ[Û‘šY[×K™š[\Š›ÛÛX[ŠNÂ‚ˆÛÛœÝÛ[™R][\Ë^Y\œ›ÚÙ\œË^[Y[×HH]ØZ]›ÛZ\ÙK˜[
Âˆ]Y\žT›ÝÜÊˆˆÑSPÕYÕSW×ØËØ[˜Ù[Y×ØË]X[]W×ØË]X[]WÑ[]™\™YÔ\—Ð‘—×ØËˆ]X[]WÓX^×ØË]X[]WÚ[—ÓU×ØË\×Ô]X[]WÔ˜[™ÙW×ØËˆÝ\Y\—Ðœ›ÚÙ\—×ØËÝ\Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØËˆ^Y\œ×Ðœ›ÚÙ\—×ØË^Y\—Ðœ›ÚÙ\—×ØË^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØËˆ^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ó[\Ý[W×ØËÛÛ[Z\ÜÚ[Û—ÐÛÜÝ×ØÂˆ”“ÓHÕSWÓ[™WÒ][W×ØÂˆÒT‘HÕSW×ØÈH	ÉÙ\ØØ\TÛÜ[
Ý[RY
_IÂˆSRULˆˆÈ[Z]ˆLÛÙ˜Z[ˆYHKˆ
Kˆ]Y\žT›ÝÜÊˆˆÑSPÕYÕSW×ØË^Y\—Ðœ›ÚÙ\—×ØÂˆ”“ÓHÕSWÐ^Y\—Ðœ›ÚÙ\—×ØÂˆÒT‘HÕSW×ØÈH	ÉÙ\ØØ\TÛÜ[
Ý[RY
_IÂˆSRULˆˆÈ[Z]ˆLÛÙ˜Z[ˆYHKˆ
Kˆ]Y\žT›ÝÜÊˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
^[Y[Ù[XÝšY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓH^[Y[×ØÂˆÒT‘HÕSW×ØÈH	ÉÙ\ØØ\TÛÜ[
Ý[RY
_IÂˆÔ‘Tˆ–H	Ù]QšY[HTÐÈ•SÈTÕÜ™X]Y]HTÐÂˆSRULˆˆÈ[Z]ˆLÛÙ˜Z[ˆYHKˆ
KˆJNÂ‚ˆÛÛœÝœ›ÚÙ\XØÛÝ[YÈHË‹‹›™]ÈÙ]
Ë‹‹›[™R][\Ë›X\

][JHOˆ][K”Ý\Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠK‹‹›[™R][\Ë›X\

][JHOˆ][K^Y\œ×Ðœ›ÚÙ\—×ØÈ][K^Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠK‹‹˜^Y\œ›ÚÙ\œË›X\

][JHOˆ][K^Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠWJWNÂˆÛÛœÝœ›ÚÙ\XØÛÝ[X\H]ØZ]˜[Y\ÐžRYÊ	ÐXØÛÝ[	Ëœ›ÚÙ\XØÛÝ[YÊNÂˆ›Üˆ
ÛÛœÝÚY˜[YWHÙˆØš™XÝ™[šY\Êœ›ÚÙ\XØÛÝ[X\
JHœ›ÚÙ\XØÛÝ[X\ÔÝš[™ÊY
KœÛXÙJMJWHH˜[YNÂˆÛÛœÝœ›ÚÙ\‘Ü›Ý\ÈBˆZ[œ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ÊÂˆÝ[SX\ˆÈÜÝ[K’YNˆÝ[HKˆ[™R][\Ëˆ^Y\œ›ÚÙ\œËˆXØÛÝ[X\ˆœ›ÚÙ\XØÛÝ[X\ˆJVÜÝ[K’YH×NÂ‚ˆÛÛœÝ^Y\”^[Y[ÈH^[Y[Âˆ™š[\Š
^[Y[
HOˆZ[˜ÛÛZ[™Ô^[Y[\Ô™XÙZ]˜X›T™[Z][˜ÙJ^[Y[Ë‹‹œ™Y™\™[˜ÙQšY[Ë‹‹™\™XÝ[Û‘šY[Ë‹‹\QšY[Ë‹‹œÝ]\ÑšY[×JJBˆ›X\

^[Y[
HOˆÂˆÛÛœÝ[[Ý[H[˜ÛÛZ[™Ô^[Y[[X™\Š^[Y[Ø[[Ý[šY[JNÂˆÛÛœÝ^[Y[]HH^[Y[Ù]QšY[H^[Y[Ü™X]Y]H[ÂˆÛÛœÝœ›ÚÙ\ÛÛ[Z\ÜÚ[Û“X]ÚHš[™œ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[X]Ú
^[Y[[[Ý[œ›ÚÙ\‘Ü›Ý\ËË‹‹œ™Y™\™[˜ÙQšY[Ë‹‹™\™XÝ[Û‘šY[Ë‹‹\QšY[Ë‹‹œÝ]\ÑšY[×JNÂˆÛÛœÝ\HHœ›ÚÙ\ÛÛ[Z\ÜÚ[Û“X]ÚˆÈ	Ðœ›ÚÙ\ˆÛÛ[Z\ÜÚ[Û‰Âˆˆ[˜ÛÛZ[™Ô^[Y[ÛÚÜÐ˜[šÐÚ\™ÙJ^[Y[Âˆ™Y™\™[˜ÙQšY[Ëˆ\™XÝ[Û‘šY[Ëˆ\QšY[ËˆÝ]\ÑšY[ËˆJBˆÈ	Ð˜[šÈÚ\™ÙIÂˆˆ[˜ÛÛZ[™Ô^[Y[\Qœ›ÛPÛÛ^
^[Y[Âˆ[[Ý[ˆÝ[KˆÝ\Y\’[›ÚXÙNˆ[ˆÝ\Y\’[›ÚXÙQšY[ÎˆÝ\Y\’[›ÚXÙSÛÚÝ\šY[Ëˆ\™XÝ[Û‘šY[Ëˆ\QšY[ËˆÝ]\ÑšY[ËˆJNÂˆ™]\›ˆÂˆYˆ^[Y[’Yˆ˜[YNˆ[˜ÛÛZ[™Ô^[Y[\Ü^S˜[YJÂˆ^[Y[ˆ™Y™\™[˜ÙQšY[ËˆÝ[KˆÝ\Y\’[›ÚXÙNˆ[ˆ\KˆJKˆ[[Ý[ˆ^[Y[]Kˆ]SÛ›Nˆ]SÛ›J^[Y[]JKˆ\KˆNÂˆJBˆ™š[\Š
^[Y[
HOˆ^[Y[\HOOH	Ð^Y\ˆ^[Y[	È	‰ˆ^[Y[˜[[Ý[OH[	‰ˆ^[Y[˜[[Ý[ˆ	‰ˆ^[Y[™]SÛ›JBˆœÛÜ

KŠHOˆÝš[™ÊK™]SÛ›JK›ØØ[PÛÛ\\™JÝš[™Ê‹™]SÛ›JJHÝš[™ÊKšY
K›ØØ[PÛÛ\\™JÝš[™Ê‹šY
JJNÂ‚ˆÛÛœÝ˜]ÑYQ]HHØ[Ý[]Y^Y\”^U\›Q]JÝ[JHÝ[K’[›ÚXÙWÑYWÑ]W×ØÈÝ[K‘YWÑ]W×ØÈÝ[K^Y\—Ô^WÕ\›WÑ]W×ØÈ[ÂˆÛÛœÝYQ]HH]SÛ›J˜]ÑYQ]JNÂˆYˆ
YYQ]JH›ÝÈ\\œ›ÜŠ	Ð^Y\ˆ[›ÚXÙHYH]H\ÈZ\ÜÚ[™ËÛÈ]H^[Y[[\™\ÝØ[››Ý™HØ[Ý[]Y‰Ë
NÂ‚ˆÛÛœÝ˜]Ô˜]HH[\™\ÝšY[Ë›˜[YHÈÝ[VÉÐXØÛÝ[×Ü‰×OË–Ú[\™\ÝšY[›˜[YWHˆ[ÂˆÛÛœÝ[ÛT˜]HH\œÙR[˜ÛÛZ[™Ô^[Y[[\™\Ý˜]J˜]Ô˜]JHÏÈŒŽÂˆÛÛœÝ˜]UØ\›š[™ÈH˜]Ô˜]HOH[˜]Ô˜]HOOH	ÉÈÈ	Ð^Y\ˆXØÛÝ[[\™\Ý˜]HØ\È›Ý›Ý[™ÈY˜][YÈ‹Œ	H\ˆ[Û‰Èˆ[ÂˆÛÛœÝ[›ÚXÙP[[Ý[H[˜ÛÛZ[™Ô^[Y[[X™\ŠÝ[K•Ý[Ò[›ÚXÙWÐ[[Ý[×ØÊHÏÈ[˜ÛÛZ[™Ô^[Y[[X™\Š›ÙKš[›ÚXÙP[[Ý[
HÏÈ^Y\”^[Y[Ëœ™YXÙJ
Ý[K^[Y[
HOˆÝ[H
È[X™\Š^[Y[˜[[Ý[
K
H
ÈX]›X^
[X™\Š›ÙKœ™XÙZ]˜X›P˜[[˜ÙH
JNÂˆYˆ
Z[›ÚXÙP[[Ý[[›ÚXÙP[[Ý[H
H›ÝÈ\\œ›ÜŠ	Ð^Y\ˆ[›ÚXÙH[[Ý[\ÈZ\ÜÚ[™ËÛÈ]H^[Y[[\™\ÝØ[››Ý™HØ[Ý[]Y‰Ë
NÂ‚ˆÛÛœÝÙ^HH]SÛ›J™]È]J
JNÂˆ]˜[[˜ÙHH[›ÚXÙP[[Ý[Âˆ]\Ý]HHYQ]NÂˆÛÛœÝÙYÛY[ÈH×NÂˆÛÛœÝ^[Y[ØÚY[HH×NÂˆ›Üˆ
ÛÛœÝ^[Y[Ùˆ^Y\”^[Y[ÊHÂˆÛÛœÝ^[Y[[[Ý[HX]›Z[Š[X™\Š^[Y[˜[[Ý[
KX]›X^
˜[[˜ÙJJNÂˆYˆ
^[Y[™]SÛ›HHYQ]JHÂˆ˜[[˜ÙHHX]›X^
˜[[˜ÙHH^[Y[[[Ý[
NÂˆ^[Y[ØÚY[Kœ\Ú
Âˆ‹‹œ^[Y[ˆ˜[[˜ÙPY\Žˆ˜[[˜ÙKˆ›ÝNˆ	ÔZYÛ‹Ø™Y›Ü™HYH]IËˆJNÂˆÛÛ[YNÂˆBˆYˆ
˜[[˜ÙHˆ	‰ˆ^[Y[™]SÛ›Hˆ\Ý]JHÂˆÛÛœÝ^\ÈHX]›X^
^\Ð™]ÙY[Š\Ý]K^[Y[™]SÛ›JJNÂˆYˆ
^\Èˆ
HÂˆÛÛœÝ[\™\ÝH˜[[˜ÙH
ˆ[ÛT˜]H
ˆ
^\ÈÈÌ
NÂˆÙYÛY[Ëœ\Ú
Âˆœ›ÛQ]Nˆ\Ý]KˆÑ]Nˆ^[Y[™]SÛ›Kˆ˜[[˜ÙKˆ^\Ëˆ˜]QXÚ[X[ˆ[ÛT˜]Kˆ[\™\Ýˆ›Ü›][Nˆ[\™\Ý›Ü›][U^
˜[[˜ÙK[ÛT˜]K^\ÊKˆJNÂˆBˆBˆ˜[[˜ÙHHX]›X^
˜[[˜ÙHH^[Y[[[Ý[
NÂˆ^[Y[ØÚY[Kœ\Ú
Âˆ‹‹œ^[Y[ˆ˜[[˜ÙPY\Žˆ˜[[˜ÙKˆ›ÝNˆ^[Y[[[Ý[[X™\Š^[Y[˜[[Ý[
HÈ	Ô^[Y[^ÙYYÈ™[XZ[š[™È˜[[˜ÙIÈˆ	ÉËˆJNÂˆ\Ý]HH^[Y[™]SÛ›NÂˆBˆÛÛœÝÝ\œ™[™XÙZ]˜X›HH[˜ÛÛZ[™Ô^[Y[[X™\ŠÝ[K”™XÙZ]˜X›WÐ˜[[˜ÙW×ØÊNÂˆYˆ
Ý\œ™[™XÙZ]˜X›HOH[	‰ˆÝ\œ™[™XÙZ]˜X›HH
H˜[[˜ÙHHX]›Z[Š˜[[˜ÙKÝ\œ™[™XÙZ]˜X›JNÂˆYˆ
˜[[˜ÙHˆ	‰ˆÙ^Hˆ\Ý]JHÂˆÛÛœÝ^\ÈHX]›X^
^\Ð™]ÙY[Š\Ý]KÙ^JJNÂˆYˆ
^\Èˆ
HÂˆÛÛœÝ[\™\ÝH˜[[˜ÙH
ˆ[ÛT˜]H
ˆ
^\ÈÈÌ
NÂˆÙYÛY[Ëœ\Ú
Âˆœ›ÛQ]Nˆ\Ý]KˆÑ]NˆÙ^Kˆ˜[[˜ÙKˆ^\Ëˆ˜]QXÚ[X[ˆ[ÛT˜]Kˆ[\™\Ýˆ›Ü›][Nˆ[\™\Ý›Ü›][U^
˜[[˜ÙK[ÛT˜]K^\ÊKˆ›ÝNˆ	ÐÝ\œ™[[œZY˜[[˜ÙHÈ™\]Y\Ý]IËˆJNÂˆBˆB‚ˆÛÛœÝÝ[[\™\ÝHÙYÛY[Ëœ™YXÙJ
Ý[KÙYÛY[
HOˆÝ[H
È[X™\ŠÙYÛY[š[\™\Ý
K
NÂˆ™]\›ˆÂˆÝ[Kˆ^Y\“˜[YNˆ[˜ÛÛZ[™Ô^[Y[^Y\“˜[YJÝ[JKˆ^Y\‘Ü›Ý\˜[YNˆ[˜ÛÛZ[™Ô^[Y[^Y\‘Ü›Ý\
Ý[JKˆÝ[S˜[YNˆ›Ü›X]Ý[S˜[YJÝ[JKˆYQ]Kˆ[›ÚXÙP[[Ý[ˆ™XÙZ]˜X›P˜[[˜ÙNˆÝ\œ™[™XÙZ]˜X›Kˆ[\™\Ý˜]QšY[ˆ[\™\ÝšY[ˆÈÂˆ˜[YNˆ[\™\ÝšY[›˜[YKˆX™[ˆ[\™\ÝšY[›X™[[\™\ÝšY[›˜[YKˆBˆˆ[ˆ˜]Ò[\™\Ý˜]Nˆ˜]Ô˜]Kˆ[ÛT˜]Kˆ˜]UØ\›š[™Ëˆ^[Y[ØÚY[KˆÙYÛY[ËˆÝ[[\™\ÝˆNÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝØ[Ý[][Û’[
Ø[Ý[][ÛŠHÂˆÛÛœÝÙYÛY[›ÝÜÈH
Ø[Ý[][Û‹œÙYÛY[È×JBˆ›X\
ˆ
ÙYÛY[
HOˆˆ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜÝÚ]K\ÜXÙN››ÝÜ˜\‰Ü™]Q]JÙYÛY[™œ›ÛQ]J_HÈ	Ü™]Q]JÙYÛY[Ñ]J_OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\‰Û[Û™^JÙYÛY[˜˜[[˜ÙJ_OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\‰ÜÙYÛY[™^\ßOÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜ‰Ù\ØØ\R[
ÙYÛY[™›Ü›][J_OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜÝ^X[YÛŽœšYÚÙ›Û]ÙZYÚÌÝÚ]K\ÜXÙN››ÝÜ˜\‰Û[Û™^JÙYÛY[š[\™\Ý
_OÝ‚ˆÝ˜ˆ
Bˆš›Ú[Š	ÉÊNÂˆÛÛœÝ^[Y[›ÝÜÈH
Ø[Ý[][Û‹œ^[Y[ØÚY[H×JBˆ›X\
ˆ
^[Y[
HOˆˆ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜÝÚ]K\ÜXÙN››ÝÜ˜\‰Ü™]Q]J^[Y[œ^[Y[]J_OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜ‰Ù\ØØ\R[
^[Y[›˜[YH^[Y[šY	ËIÊ_OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\‰Û[Û™^J^[Y[˜[[Ý[
_OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\‰Û[Û™^J^[Y[˜˜[[˜ÙPY\Š_OÝ‚ˆÝ˜ˆ
Bˆš›Ú[Š	ÉÊNÂˆ™]\›ˆˆ]ˆÝ[OH›X\™Ú[‹]ÜŒMœ‚ˆÈÝ[OH›X\™Ú[ŽŒÙ›Û\Ú^™NŒM\“]H^[Y[[\™\ÝØ[Ý[][ÛÚÏ‚ˆ	ØØ[Ý[][Û‹œ˜]UØ\›š[™ÈÈÝ[OH›X\™Ú[ŽŒØÛÛÜŽˆÎLNÙ›Û]ÙZYÚŒ‰Ù\ØØ\R[
Ø[Ý[][Û‹œ˜]UØ\›š[™Ê_OÜ˜ˆ	ÉßBˆÝ[OH›X\™Ú[ŽŒØÛÛÜŽˆÍÌH‘›Ü›][NˆÝ]Ý[™[™È˜[[˜ÙH[ÛH[\™\Ý˜]HÝ™\™YH^\ÈÈÌÜ‚ˆX›HÝ[OH˜›Ü™\‹XÛÛ\ÙN˜ÛÛ\ÙNÝÚYŒL	NÛX^]ÚYŽŒÙ›Û\Ú^™NŒLœÛX\™Ú[‹X›ÝÛNŒLœ‚ˆ›ÙO‚ˆÝ[OH^X[YÛŽ›YØÛÛÜŽˆÍÌNÜY[™Î\ÝÚYŒŒL^Y\ˆ[›ÚXÙH[[Ý[ÝÝ[OHœY[™Î\Ù›Û]ÙZYÚÌ‰Û[Û™^JØ[Ý[][Û‹š[›ÚXÙP[[Ý[
_OÝÝ‚ˆÝ[OH^X[YÛŽ›YØÛÛÜŽˆÍÌNÜY[™Î\^Y\ˆ[›ÚXÙHYH]OÝÝ[OHœY[™Î\‰Ü™]Q]JØ[Ý[][Û‹™YQ]J_OÝÝ‚ˆÝ[OH^X[YÛŽ›YØÛÛÜŽˆÍÌNÜY[™Î\XØÛÝ[[\™\Ý˜]OÝÝ[OHœY[™Î\‰Ú[˜ÛÛZ[™Ô^[Y[[\™\Ý˜]SX™[
Ø[Ý[][Û‹›[ÛT˜]J_IØØ[Ý[][Û‹š[\™\Ý˜]QšY[È
	Ù\ØØ\R[
Ø[Ý[][Û‹š[\™\Ý˜]QšY[›X™[
_JXˆ	ÉßOÝÝ‚ˆÝ[OH^X[YÛŽ›YØÛÛÜŽˆÍÌNÜY[™Î\Ø[Ý[]Y[\™\ÝÝ[ÝÝ[OHœY[™Î\Ù›Û\Ú^™NŒM\Ù›Û]ÙZYÚŽØÛÛÜŽˆÌYŒŽLÍÈ‰Û[Û™^JØ[Ý[][Û‹Ý[[\™\Ý
_OÝÝ‚ˆÝ›ÙO‚ˆÝX›O‚ˆX›HÝ[OH˜›Ü™\‹XÛÛ\ÙN˜ÛÛ\ÙNÝÚYŒL	NÛX^]ÚYŽMŒÙ›Û\Ú^™NŒLœÛX\™Ú[‹X›ÝÛNŒLœ‚ˆXYˆÝ[OH˜˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜ÎØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÙ›Û\Ú^™NŒL\Ý[OH^X[YÛŽ›YÜY[™ÎÜ”\š[ÙÝÝ[OH^X[YÛŽœšYÚÜY[™ÎÜ˜[[˜ÙOÝÝ[OH^X[YÛŽœšYÚÜY[™ÎÜ‘^\ÏÝÝ[OH^X[YÛŽ›YÜY[™ÎÜ‘›Ü›][OÝÝ[OH^X[YÛŽœšYÚÜY[™ÎÜ’[\™\ÝÝÝÝXY‚ˆ›ÙO‰ÜÙYÛY[›ÝÜÈ	ÏÛÛÜ[HHˆÝ[OHœY[™ÎŒLœÝ^X[YÛŽ˜Ù[\ŽØÛÛÜŽˆÍÌH“›ÈÝ™\™YH[\™\ÝÙYÛY[Ø\ÈØ[Ý[]YÝÝ‰ßOÝ›ÙO‚ˆÝX›O‚ˆX›HÝ[OH˜›Ü™\‹XÛÛ\ÙN˜ÛÛ\ÙNÝÚYŒL	NÛX^]ÚYŽŒÙ›Û\Ú^™NŒLœ‚ˆXYˆÝ[OH˜˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜ÎØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÙ›Û\Ú^™NŒL\Ý[OH^X[YÛŽ›YÜY[™ÎÜ”^[Y[]OÝÝ[OH^X[YÛŽ›YÜY[™ÎÜ”^[Y[ÝÝ[OH^X[YÛŽœšYÚÜY[™ÎÜ[[Ý[ÝÝ[OH^X[YÛŽœšYÚÜY[™ÎÜ˜[[˜ÙHY\ÝÝÝXY‚ˆ›ÙO‰Ü^[Y[›ÝÜÈ	ÏÛÛÜ[HˆÝ[OHœY[™ÎŒLœÝ^X[YÛŽ˜Ù[\ŽØÛÛÜŽˆÍÌH“›È^Y\ˆ^[Y[ÈÙ\™H›Ý[™›Üˆ\ÈÕSKÝÝ‰ßOÝ›ÙO‚ˆÝX›O‚ˆÙ]˜ÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝØ[Ý[][Û•^
Ø[Ý[][ÛŠHÂˆ™]\›ˆÉÓ]H^[Y[[\™\ÝØ[Ý[][Û‰Ë›Ü›][NˆÝ]Ý[™[™È˜[[˜ÙH[ÛH[\™\Ý˜]HÝ™\™YH^\ÈÈÌØ[Ý[][Û‹œ˜]UØ\›š[™È	ÉË^Y\ˆ[›ÚXÙH[[Ý[ˆ	Û[Û™^JØ[Ý[][Û‹š[›ÚXÙP[[Ý[
_X^Y\ˆ[›ÚXÙHYH]Nˆ	Ü™]Q]JØ[Ý[][Û‹™YQ]J_XXØÛÝ[[\™\Ý˜]Nˆ	Ú[˜ÛÛZ[™Ô^[Y[[\™\Ý˜]SX™[
Ø[Ý[][Û‹›[ÛT˜]J_IØØ[Ý[][Û‹š[\™\Ý˜]QšY[È
	ØØ[Ý[][Û‹š[\™\Ý˜]QšY[›X™[JXˆ	ÉßXØ[Ý[]Y[\™\ÝÝ[ˆ	Û[Û™^JØ[Ý[][Û‹Ý[[\™\Ý
_X	ÉË	Ò[\™\ÝÙYÛY[Î‰Ë‹‹ŠØ[Ý[][Û‹œÙYÛY[È×JK›X\

ÙYÛY[
HOˆ	Ü™]Q]JÙYÛY[™œ›ÛQ]J_HÈ	Ü™]Q]JÙYÛY[Ñ]J_H	ÜÙYÛY[™›Ü›][_HH	Û[Û™^JÙYÛY[š[\™\Ý
_X
K	ÉË	Ð^Y\ˆ^[Y[ØÚY[N‰Ë‹‹ŠØ[Ý[][Û‹œ^[Y[ØÚY[H×JK›X\

^[Y[
HOˆ	Ü™]Q]J^[Y[œ^[Y[]J_H	Ü^[Y[›˜[YH^[Y[šY	ËIßH^[Y[	Û[Û™^J^[Y[˜[[Ý[
_H˜[[˜ÙHY\ˆ	Û[Û™^J^[Y[˜˜[[˜ÙPY\Š_X
WK™š[\Š
[™JHOˆ[™HOOH	ÉÊKš›Ú[Š	×‰ÊNÂŸB‚˜ÛÛœÝSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÐÐSÕSUSÓ—ÕP“WÔUT“ˆH×××Êš[\™\ÝØ[Ý[][Û•X›WÊ—WKÚNÂ˜ÛÛœÝSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÔÕSWÓS’×ÕÒÑS—ÔUT“ˆH×××ÊœÝ[S[š×Ê—WKÚNÂ˜ÛÛœÝQUSÒSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÕSTUHHÂˆÎˆ×KˆØÎˆ×Kˆ˜ØÎˆ×KˆÝXš™XÝˆ	ÉËˆ›ÙNˆ	ÉËŸNÂ‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\Ý[\]J[œ]HßJHÂˆ™]\›ˆÂˆÎˆÝš[™Ê[œ]ÈÏÈQUSÒSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÕSTUKÊKˆØÎˆÝš[™Ê[œ]˜ØÈÏÈQUSÒSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÕSTUK˜ØÊKˆ˜ØÎˆÝš[™Ê[œ]˜˜ØÈÏÈQUSÒSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÕSTUK˜˜ØÊKˆÝXš™XÝˆÝš[™Ê[œ]œÝXš™XÝQUSÒSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÕSTUKœÝXš™XÝ
Kˆ›ÙNˆÝš[™Ê[œ]˜›ÙH[œ]š[›ÈQUSÒSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÕSTUK˜›ÙJKˆNÂŸB‚™[˜Ý[Ûˆ™[™\’[˜ÛÛZ[™Ô^[Y[[\™\Ý[\]J˜[YKÛÛ^
HÂˆ™]\›ˆÝš[™Ê˜[YH	ÉÊKœ™\XÙJ×××ÊŠÐKV˜K^ŒNW×JÊWÊ—WKÙË
X]ÚÙ^JHOˆ
Øš™XÝœ›ÝÝ\Kš\ÓÝÛ”›Ü\K˜Ø[
ÛÛ^Ù^JHÈÛÛ^ÚÙ^WHˆX]Ú
JNÂŸB‚™[˜Ý[Ûˆ™\XÙR[˜ÛÛZ[™Ô^[Y[[\™\ÝÚÙ[ŠÛÝ\˜ÙK]\›‹™\XÙ[Y[
HÂˆ™]\›ˆÝš[™ÊÛÝ\˜ÙH	ÉÊBˆœ™\XÙJ™]È™YÑ^
–×—J—Ê‰Ü]\›‹œÛÝ\˜Ù_WÊÜ˜	ÚIÊK™\XÙ[Y[
Bˆœ™\XÙJ]\›‹™\XÙ[Y[
NÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝÝ[S[šÒ[
\›
HÂˆ™]\›ˆÝ[OH›X\™Ú[ŽŒMH™YH‰Ù\ØØ\R[
\›
_HˆÝ[OH™\Ü^Nš[›[™KX›ØÚÎØ›Ü™\‹\˜Y]\ÎŽØ˜XÚÙÜ›Ý[™ˆÌYŒŽLÍÎØÛÛÜŽˆÙ™™™™™ŽÝ^YXÛÜ˜][ÛŽ››Û™NÙ›Û]ÙZYÚÌÜY[™ÎŽ\LÜ“[šÈÈÕSOØOÜ˜ÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝÝ[S[šÕ^
\›
HÂˆ™]\›ˆ[šÈÈÕSNˆ	Ý\›XÂŸB‚™[˜Ý[ÛˆZ[[˜ÛÛZ[™Ô^[Y[[\™\Ý[XZ[
›ÙK›Ùš[KØ[Ý[][ÛŠHÂˆÛÛœÝ™\]Y\ÝYžHH›Ùš[OË™[Û˜[YH›Ùš[OË™[XZ[	ÓÙÙÙYZ[ˆ\Ù\‰ÎÂˆÛÛœÝ^[Y[˜[YHHÝš[™Ê›ÙKœ^[Y[˜[YH›ÙKœ^[Y[\Ü^S˜[YH›ÙKœØ[\Ù›Ü˜ÙT^[Y[˜[YH›ÙKœ^[Y[Y	ÉÊKš[J
NÂˆÛÛœÝÝ[S˜[YHHØ[Ý[][ÛËœÝ[S˜[YHÝš[™Ê›ÙKœÝ[S˜[YH	ÉÊKš[J
NÂˆÛÛœÝ^Y\“˜[YHHØ[Ý[][ÛË˜^Y\“˜[YHÝš[™Ê›ÙK˜^Y\“˜[YH›ÙKœ\S˜[YH	ÉÊKš[J
NÂˆÛÛœÝ^Y\‘Ü›Ý\˜[YHHØ[Ý[][ÛË˜^Y\‘Ü›Ý\˜[YHÝš[™Ê›ÙK˜^Y\‘Ü›Ý\˜[YH	ÉÊKš[J
NÂˆÛÛœÝ™XÙZ]™Y]HH™]Q]J›ÙKœ^[Y[]H›ÙKœ™XÙZ]™Y]JNÂˆÛÛœÝ[œÙ\Y]HH›ÙK˜Ü™X]Y]H	‰ˆ]SÛ›J›ÙK˜Ü™X]Y]JHOOH]SÛ›J›ÙKœ^[Y[]H›ÙKœ™XÙZ]™Y]JHÈ™]Q]J›ÙK˜Ü™X]Y]JHˆ	ÉÎÂˆÛÛœÝ[^SX™[H›ÙK™[^Q^\ÈOH[È	ËIÈˆ	Ó[X™\Š›ÙK™[^Q^\ÊKÓØØ[TÝš[™Ê
_H^\ØÂˆÛÛœÝÛÛ^HÂˆ™\]Y\ÝYžKˆ™\]Y\Ý\‘[XZ[ˆ›Ùš[OË™[XZ[	ÉËˆ^Y\“˜[YNˆ^Y\“˜[YH	ËIËˆ^Y\‘Ü›Ý\˜[YNˆ^Y\‘Ü›Ý\˜[YH	ËIËˆÝ[S˜[YNˆÝ[S˜[YH	ËIËˆ^[Y[˜[YNˆ^[Y[˜[YH›ÙKœ^[Y[Y	ËIËˆ™XÙZ]™Y]Kˆ[œÙ\Y]Kˆ[^Q^\Îˆ[^SX™[ˆ^[Y[[[Ý[ˆ[Û™^J›ÙK˜[[Ý[
Kˆ™XÙZ]˜X›P˜[[˜ÙNˆ[Û™^JØ[Ý[][ÛËœ™XÙZ]˜X›P˜[[˜ÙHÏÈ›ÙKœ™XÙZ]˜X›P˜[[˜ÙJKˆ[›ÚXÙP[[Ý[ˆ[Û™^JØ[Ý[][ÛËš[›ÚXÙP[[Ý[ÏÈ›ÙKš[›ÚXÙP[[Ý[
Kˆ[›ÚXÙQYQ]NˆØ[Ý[][ÛË™YQ]HÈ™]Q]JØ[Ý[][Û‹™YQ]JHˆ	ËIËˆ[\™\Ý˜]Nˆ[˜ÛÛZ[™Ô^[Y[[\™\Ý˜]SX™[
Ø[Ý[][ÛË›[ÛT˜]JKˆ[\™\Ý˜]QšY[ˆØ[Ý[][ÛËš[\™\Ý˜]QšY[Ë›X™[Ø[Ý[][ÛËš[\™\Ý˜]QšY[Ë›˜[YH	ÉËˆ[\™\ÝÝ[ˆ[Û™^JØ[Ý[][ÛËÝ[[\™\Ý
KˆNÂˆÛÛœÝ[\]HH[˜ÛÛZ[™Ô^[Y[[\™\Ý[\]J›ÙKœ™\ÜÙ][™ÜÈßJNÂˆÛÛœÝÝ[U\›H[˜ÛÛZ[™Ô^[Y[Ý[U\›
ßKØ[Ý[][ÛËœÝ[OË’Y›ÙKœÝ[RY
NÂˆÛÛœÝÈH[š\]YQ[XZ[\Ý
™[™\’[˜ÛÛZ[™Ô^[Y[[\™\Ý[\]J[\]KËÛÛ^
JNÂˆÛÛœÝØÈH[š\]YQ[XZ[\Ý
™[™\’[˜ÛÛZ[™Ô^[Y[[\™\Ý[\]J[\]K˜ØËÛÛ^
JNÂˆÛÛœÝ˜ØÈH[š\]YQ[XZ[\Ý
™[™\’[˜ÛÛZ[™Ô^[Y[[\™\Ý[\]J[\]K˜˜ØËÛÛ^
JNÂˆÛÛœÝÝXš™XÝH™[™\’[˜ÛÛZ[™Ô^[Y[[\™\Ý[\]J[\]KœÝXš™XÝÛÛ^
NÂˆÛÛœÝ›ÙPÛÛ[H™[™\’[˜ÛÛZ[™Ô^[Y[[\™\Ý[\]J[\]K˜›ÙKÛÛ^
NÂˆÛÛœÝ›ÙU^H\Ò[X\šÝ\
›ÙPÛÛ[
HÈ[ÔZ[•^
›ÙPÛÛ[
Hˆ›ÙPÛÛ[ÂˆÛÛœÝØ[Ý[][Û’[HØ[Ý[][ÛˆÈ[˜ÛÛZ[™Ô^[Y[[\™\ÝØ[Ý[][Û’[
Ø[Ý[][ÛŠHˆ	ÉÎÂˆÛÛœÝØ[Ý[][Û•^HØ[Ý[][ÛˆÈ[˜ÛÛZ[™Ô^[Y[[\™\ÝØ[Ý[][Û•^
Ø[Ý[][ÛŠHˆ	ÉÎÂˆÛÛœÝ[›ÙHH™\XÙR[˜ÛÛZ[™Ô^[Y[[\™\ÝÚÙ[Š[XZ[ÛÛ[[
›ÙPÛÛ[
KSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÔÕSWÓS’×ÕÒÑS—ÔUT“‹[˜ÛÛZ[™Ô^[Y[[\™\ÝÝ[S[šÒ[
Ý[U\›
JBˆœ™\XÙJÏ–×—J—Ê—××Êš[\™\ÝØ[Ý[][Û•X›WÊ—WWÊÜ‹ÚKØ[Ý[][Û’[
Bˆœ™\XÙJSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÐÐSÕSUSÓ—ÕP“WÔUT“‹Ø[Ý[][Û’[
NÂˆÛÛœÝ^›ÙHH™\XÙR[˜ÛÛZ[™Ô^[Y[[\™\ÝÚÙ[Š›ÙU^SÓÓRS‘×ÔVSQS•ÒS•T‘TÕÔÕSWÓS’×ÕÒÑS—ÔUT“‹[˜ÛÛZ[™Ô^[Y[[\™\ÝÝ[S[šÕ^
Ý[U\›
JKœ™\XÙJSÓÓRS‘×ÔVSQS•ÒS•T‘TÕÐÐSÕSUSÓ—ÕP“WÔUT“‹Ø[Ý[][Û•^
NÂˆÛÛœÝ[Hˆ]ˆÝ[OH™›ÛY˜[Z[N’[\‹\šX[Ø[œË\Ù\šYŽØÛÛÜŽˆÌYŒŽLÍÎÛ[™KZZYÚŒKH‚ˆ	Ú[›Ù_BˆÙ]˜Âˆ™]\›ˆÈËØË˜ØËÝXš™XÝ[^ˆ^›ÙHNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\Ý[›ÚXÙT™\]Y\Ý
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝ^[Y[YHÝš[™Ê›ÙKœ^[Y[Y›ÙKœ^[Y[ÚY	ÉÊKš[J
NÂˆYˆ
\^[Y[Y
H›ÝÈ\\œ›ÜŠ	Ü^[Y[Y\È™\]Z\™Y‰Ë
NÂ‚ˆÛÛœÝ[^Q^\ÈH[X™\Š›ÙK™[^Q^\ÈÏÈ›ÙK™[^WÙ^\ÊNÂˆYˆ
S[X™\‹š\Ñš[š]J[^Q^\ÊH[^Q^\ÈHÊHÂˆ›ÝÈ\\œ›ÜŠ	Ó]H^[Y[[\™\Ý[›ÚXÙH™\]Y\Ý\ÈÛ›H]˜Z[X›H›Üˆ^Y\ˆ^[Y[È[^YY[Ü™H[ˆÈ^\Ë‰Ë
NÂˆB‚ˆÛÛœÝ^\Ý[™ÈH]ØZ]™]Ú[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][ÛŠÛY[^[Y[Y
NÂˆÛÛœÝ›Ü˜ÙT™\Ù[™H›ÙK™›Ü˜ÙHOOHYH›ÙK˜ÛÛ™š\›T™\Ù[™OOHYH›ÙK˜[ÝÔ™\Ù[™OOHYNÂˆYˆ
^\Ý[™È	‰ˆY›Ü˜ÙT™\Ù[™
HÂˆÛÛœÝ[]™\žU[˜Ù\Z[ˆHÉÜÙ[™[™ÉË	Ý[˜Ù\Z[‰×Kš[˜ÛY\Ê^\Ý[™Ë™[]™\žTÝ]\ÊNÂˆ™]\›ˆÂˆÙ[ˆ˜[ÙKˆ[™XYTÙ[ˆ^\Ý[™Ë™[]™\žTÝ]\ÈOOH	ÜÙ[	Ëˆ[]™\žU[˜Ù\Z[‹ˆ™\]Z\™\ÐÛÛ™š\›X][ÛŽˆYKˆ›ÝYšXØ][ÛŽˆ^\Ý[™ËˆNÂˆB‚ˆÛÛœÝ™\ÜÙ][™ÜÈH]ØZ]ØYš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÜ™\]Y\ÝÉËÈ™\]Z\™YˆYHJNÂˆYˆ
TÝš[™Ê™\ÜÙ][™ÜËœÙ][™ÜÏËœÝXš™XÝ	ÉÊKš[J
HTÝš[™Ê™\ÜÙ][™ÜËœÙ][™ÜÏË˜›ÙH	ÉÊKš[J
JHÂˆ›ÝÈ\\œ›ÜŠ	Ó]H^[Y[[\™\Ý™\]Y\ÝÝXš™XÝ[™›ÙH\™H›ÝÛÛ™šYÝ\™YˆÙ[™[™È\È\ØX›Y‰ËLË	Ñ’SSÒPSÔ‘TÔ•ÕSTUWÓ“ÕÐÓÓ‘’QÕT‘Q	Ë[™Yš[™YYJNÂˆBˆÛÛœÝØ[Ý[][ÛˆH]ØZ][˜ÛÛZ[™Ô^[Y[[\™\ÝØ[Ý[][ÛŠÈ‹‹˜›ÙK[^Q^\Ë^[Y[YKXØÙ\ÜÐÛÛ^
NÂˆÛÛœÝ[XZ[HZ[[˜ÛÛZ[™Ô^[Y[[\™\Ý[XZ[
È‹‹˜›ÙK[^Q^\Ë^[Y[Y™\ÜÙ][™ÜÎˆ™\ÜÙ][™ÜËœÙ][™ÜÈK›Ùš[KØ[Ý[][ÛŠNÂˆYˆ
[Ü\˜][Û˜[XZ[[]™\žP]˜Z[X›J
JHÂˆ›ÝÈ\\œ›ÜŠ	ÕHÜ\˜][Û˜[[XZ[Ù[™\ˆ\È[˜]˜Z[X›Kˆ\ÚÈ[ˆYZ[š\Ý˜]ÜˆÈÚXÚÈÙ][™ÜÈˆÞ\Ý[HX[‰Ë
NÂˆBˆÛÛœÝXZ[ÛÛ™šYÈHÜ\˜][Û˜[XZ[ÛÛ™šYÊ
NÂˆÛÛœÝ™XÚ\Y[ÈH[XZ[ÎÂˆYˆ
\™XÚ\Y[Ë›[™Ý
HÂˆ›ÝÈ\\œ›ÜŠ	Ó]H^[Y[[\™\Ý™\]Y\Ý™XÚ\Y[\È›ÝÛÛ™šYÝ\™YˆY]X\ÝÛ™HÈ™XÚ\Y[[ˆH[\]K‰Ë
NÂˆBˆÛÛœÝÙ[™\”Û˜\ÚÝH^\Ý[™ÏËœÙ[™\“XZ[›ÞÛ˜\ÚÝˆÈÈYˆ^\Ý[™ËœÙ[™\“XZ[›ÞY[[XZ[Y™\ÜÎˆ^\Ý[™ËœÙ[™\“XZ[›ÞÛ˜\ÚÝBˆˆ]ØZ]™\ÛÛ™QÜ˜\[XZ[Ù[™\ŠÛY[	Ú[˜ÛÛZ[™×Ü^[Y[Ü™\ÜÉÊK[Š
Ù[™\ŠHOˆ
ÂˆYˆÙ[™\‹›XZ[›ÞYˆ[XZ[Y™\ÜÎˆÙ[™\‹™[XZ[Y™\ÜËˆJJNÂˆÛÛœÝ][\]H™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝ^[ØYHÂˆ^[Y[ÚYˆ^[Y[Yˆ^[Y[Û˜[YNˆÝš[™Ê›ÙKœ^[Y[˜[YH›ÙKœ^[Y[\Ü^S˜[YH›ÙKœØ[\Ù›Ü˜ÙT^[Y[˜[YH	ÉÊKš[J
H[ˆÝ[WÚYˆÝš[™Ê›ÙKœÝ[RY	ÉÊKš[J
H[ˆÝ[WÛ˜[YNˆØ[Ý[][Û‹œÝ[S˜[YHÝš[™Ê›ÙKœÝ[S˜[YH	ÉÊKš[J
H[ˆ^Y\—Û˜[YNˆØ[Ý[][Û‹˜^Y\“˜[YHÝš[™Ê›ÙK˜^Y\“˜[YH›ÙKœ\S˜[YH	ÉÊKš[J
H[ˆ^Y\—ÙÜ›Ý\Û˜[YNˆØ[Ý[][Û‹˜^Y\‘Ü›Ý\˜[YHÝš[™Ê›ÙK˜^Y\‘Ü›Ý\˜[YH	ÉÊKš[J
H[ˆ™XÙZ]™YÙ]Nˆ[˜ÛÛZ[™Ô^[Y[‘]J›ÙKœ^[Y[]H›ÙKœ™XÙZ]™Y]JKˆ^[Y[ØÜ™X]YÙ]Nˆ[˜ÛÛZ[™Ô^[Y[‘]J›ÙK˜Ü™X]Y]JKˆ[^WÙ^\ÎˆX][˜Ê[^Q^\ÊKˆ[[Ý[ˆ[˜ÛÛZ[™Ô^[Y[“[X™\Š›ÙK˜[[Ý[
KˆÝ\œ™[˜ÞNˆÝš[™Ê›ÙK˜Ý\œ™[˜ÞH	ÕTÑ	ÊKš[J
H	ÕTÑ	Ëˆ™XÙZ]˜X›WØ˜[[˜ÙNˆ[˜ÛÛZ[™Ô^[Y[“[X™\ŠØ[Ý[][Û‹œ™XÙZ]˜X›P˜[[˜ÙHÏÈ›ÙKœ™XÙZ]˜X›P˜[[˜ÙJKˆ™XÚ\Y[Ù[XZ[ˆ[š\]YQ[XZ[\Ý
™XÚ\Y[Ë[XZ[˜ØË[XZ[˜˜ØÊKš›Ú[Š	Ë	ÊKˆ[XZ[ÜÝXš™XÝˆ[XZ[œÝXš™XÝˆ[XZ[ÛY\ÜØYÙWÚYˆ[ˆ[XZ[Ü›ÝšY\ŽˆXZ[ÛÛ™šYË™[]™\žSY]ÙˆXÝÜ—Ý\Ù\—ÚYˆ›Ùš[KšYˆXÝÜ—Ù[XZ[ˆ›Ùš[K™[XZ[ˆXÝÜ—Û˜[YNˆ›Ùš[K™[Û˜[YH›Ùš[K™[XZ[[ˆ[]™\žWÜÝ]\Îˆ	ÜÙ[™[™ÉËˆÙ[™\—ÛXZ[›ÞÚYˆÙ[™\”Û˜\ÚÝšYˆÙ[™\—ÛXZ[›ÞÜÛ˜\ÚÝˆÙ[™\”Û˜\ÚÝ™[XZ[Y™\ÜËˆ\ÝØ][\Ø]ˆ][\]ˆ\ÝÙ\œ›ÜŽˆ[ˆÙ[Ø]ˆ[ˆ\]YØ]ˆ][\]ˆY]Y]NˆÂˆÛÝ\˜ÙNˆ	Ú[˜ÛÛZ[™×Ü^[Y[	Ëˆ[^U™\ÚÛ^\ÎˆËˆ™\]Y\ÝY][Y^›Û™Nˆ	Ð\ÚXKÒÛ™×ÒÛÛ™ÉËˆ™\Ù[ˆ›ÛÛX[Š^\Ý[™ÊKˆ™\Ù[™ÛÝ[ˆ[X™\Š^\Ý[™ÏË›Y]Y]OËœ™\Ù[™ÛÝ[
H
È
^\Ý[™ÈÈHˆ
Kˆ™]š[Ý\Ô™\]Y\Ýˆ^\Ý[™ÂˆÈÂˆÙ[]ˆ^\Ý[™ËœÙ[][ˆXÝÜ‘[XZ[ˆ^\Ý[™Ë˜XÝÜ‘[XZ[[ˆ™XÚ\Y[[XZ[ˆ^\Ý[™Ëœ™XÚ\Y[[XZ[[ˆ[XZ[ÝXš™XÝˆ^\Ý[™Ë™[XZ[ÝXš™XÝ[ˆBˆˆ[ˆ[\™\ÝØ[Ý[][ÛŽˆÂˆ[›ÚXÙP[[Ý[ˆØ[Ý[][Û‹š[›ÚXÙP[[Ý[ˆYQ]NˆØ[Ý[][Û‹™YQ]Kˆ[\™\Ý˜]QšY[ˆØ[Ý[][Û‹š[\™\Ý˜]QšY[ˆ˜]Ò[\™\Ý˜]NˆØ[Ý[][Û‹œ˜]Ò[\™\Ý˜]Kˆ[ÛT˜]NˆØ[Ý[][Û‹›[ÛT˜]Kˆ˜]UØ\›š[™ÎˆØ[Ý[][Û‹œ˜]UØ\›š[™ËˆÝ[[\™\ÝˆØ[Ý[][Û‹Ý[[\™\ÝˆÙYÛY[ÎˆØ[Ý[][Û‹œÙYÛY[Ëˆ^[Y[ØÚY[NˆØ[Ý[][Û‹œ^[Y[ØÚY[KˆKˆKˆNÂ‚ˆÛÛœÝ™\Ù\™T]Y\žHH^\Ý[™ÈÈÛY[™œ›ÛJ	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÛ›ÝYšXØ][ÛœÉÊK\]J^[ØY
K™\J	Ü^[Y[ÚY	Ë^[Y[Y
HˆÛY[™œ›ÛJ	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÛ›ÝYšXØ][ÛœÉÊKš[œÙ\
^[ØY
NÂˆÛÛœÝÈ]Nˆ™\Ù\™Y\œ›ÜŽˆ™\Ù\™Q\œ›ÜˆHH]ØZ]™\Ù\™T]Y\žKœÙ[XÝ
SÓÓRS‘×ÔVSQS•ÒS•T‘TÕÓ“ÕQ’PÐUSÓ—Ñ’QSÊKœÚ[™ÛJ
NÂˆYˆ
™\Ù\™Q\œ›ÜŠH›ÝÈ™\Ù\™Q\œ›ÜŽÂ‚ˆ]™\Ý[ÂˆžHÂˆ™\Ý[H]ØZ]Ù[™Ü\˜][Û˜[XZ[
ÂˆÎˆ™XÚ\Y[ËˆØÎˆ[XZ[˜ØËˆ˜ØÎˆ[XZ[˜˜ØËˆÝXš™XÝˆ[XZ[œÝXš™XÝˆ[ˆ[XZ[š[ˆ^ˆ[XZ[^ˆKÈÛY[\œÜÙRÙ^Nˆ	Ú[˜ÛÛZ[™×Ü^[Y[Ü™\ÜÉËXZ[›ÞÛ˜\ÚÝˆÙ[™\”Û˜\ÚÝJNÂˆHØ]Ú
\œ›ÜŠHÂˆ]ØZ]ÛY[ˆ™œ›ÛJ	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÛ›ÝYšXØ][ÛœÉÊBˆ\]JÂˆ[]™\žWÜÝ]\Îˆ\œ›Ü‹›XZ[[]™\žU[˜Ù\Z[ˆÈ	Ý[˜Ù\Z[‰Èˆ	Ù˜Z[Y	Ëˆ\ÝÙ\œ›ÜŽˆ\œ›Ü‹›Y\ÜØYÙKˆ\]YØ]ˆ™]È]J
KÒTÓÔÝš[™Ê
KˆJBˆ™\J	Ü^[Y[ÚY	Ë^[Y[Y
NÂˆ›ÝÈ\œ›ÜŽÂˆB‚ˆÛÛœÝÙ[]H™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÛ›ÝYšXØ][ÛœÉÊBˆ\]JÂˆ[]™\žWÜÝ]\Îˆ	ÜÙ[	Ëˆ[XZ[ÛY\ÜØYÙWÚYˆ™\Ý[šY™\Ý[›Y\ÜØYÙRY[ˆ[XZ[Ü›ÝšY\Žˆ™\Ý[™[]™\žSY]ÙXZ[ÛÛ™šYË™[]™\žSY]ÙˆÙ[Ø]ˆÙ[]ˆ\ÝÙ\œ›ÜŽˆ[ˆ\]YØ]ˆÙ[]ˆJBˆ™\J	Ü^[Y[ÚY	Ë^[Y[Y
BˆœÙ[XÝ
SÓÓRS‘×ÔVSQS•ÒS•T‘TÕÓ“ÕQ’PÐUSÓ—Ñ’QSÊBˆœÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠHÂˆ]ØZ]ÛY[ˆ™œ›ÛJ	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÛ›ÝYšXØ][ÛœÉÊBˆ\]JÂˆ[]™\žWÜÝ]\Îˆ	Ý[˜Ù\Z[‰Ëˆ\ÝÙ\œ›ÜŽˆ[XZ[Ù[]˜XÚÚ[™È\]H˜Z[Yˆ	Ù\œ›Ü‹›Y\ÜØYÙ_Xˆ\]YØ]ˆ™]È]J
KÒTÓÔÝš[™Ê
KˆJBˆ™\J	Ü^[Y[ÚY	Ë^[Y[Y
NÂˆ™]\›ˆÂˆÙ[ˆYKˆ˜XÚÚ[™ÕØ\›š[™Îˆ	Ñ[XZ[Ø\ÈÙ[]ÓÔÈÛÝ[›Ýš[˜[^™H]È[]™\žH™XÛÜ™ˆÈ›Ý™\Ù[™[[[ˆYZ[š\Ý˜]Üˆ™XÛÛ˜Ú[\È]‰ËˆÎˆ™XÚ\Y[Ëˆ›ÝYšXØ][ÛŽˆÂˆ‹‹œÙ\šX[^™R[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][ÛŠ™\Ù\™Y
Kˆ[]™\žTÝ]\Îˆ	Ý[˜Ù\Z[‰ËˆKˆNÂˆBˆ™]\›ˆÂˆÙ[ˆYKˆ[™XYTÙ[ˆ›ÛÛX[Š^\Ý[™ÊKˆ™\Ù[ˆ›ÛÛX[Š^\Ý[™ÊKˆÎˆ™XÚ\Y[Ëˆ›ÝYšXØ][ÛŽˆÙ\šX[^™R[˜ÛÛZ[™Ô^[Y[[\™\Ý›ÝYšXØ][ÛŠ]JKˆNÂŸB‚˜ÛÛœÝSÓÓRS‘×ÔVSQS•Ô‘PÑRUP“WÕP“WÕÒÑS—ÔUT“ˆH×××Êœ™XÙZ]˜X›T^[Y[ÕX›WÊ—WKÚNÂ˜ÛÛœÝSÓÓRS‘×ÔVSQS•Ð•VQT—ÐÒPWÕP“WÕÒÑS—ÔUT“ˆH×××Ê˜^Y\ÚXR[›ÚXÙ\ÕX›WÊ—WKÚNÂ˜ÛÛœÝSÓÓRS‘×ÔVSQS•ÓUWÒS•T‘TÕÓS’×ÕÒÑS—ÔUT“”ÈHË×××Êœ™\]Y\Ý]T^[Y[[\™\Ý[›ÚXÙS[š×Ê—WKÚK×××Ê›]T^[Y[[\™\Ý[š×Ê—WKÚWNÂ˜ÛÛœÝQUSÒSÓÓRS‘×ÔVSQS•ÑSPRSÔÑUS‘ÔÈHÂˆÎˆ×KˆØÎˆ×Kˆ˜ØÎˆ×KˆÝXš™XÝˆ	ÉËˆ[›Îˆ	ÉËˆ[˜ÛYT™XÙZ]˜X›T^[Y[ÎˆYKˆ[˜ÛYP^Y\ÚXR[›ÚXÙ\ÎˆYKŸNÂ‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[XZ[Ù][™ÜÊ[œ]HßJHÂˆÛÛœÝØY™R[œ]HÈ‹‹š[œ]NÂˆ[]HØY™R[œ]™œ›ÛNÂˆÛÛœÝY˜][ÈHQUSÒSÓÓRS‘×ÔVSQS•ÑSPRSÔÑUS‘ÔÎÂˆ™]\›ˆÂˆ‹‹™Y˜][Ëˆ‹‹œØY™R[œ]ˆÎˆ\œÙQ[XZ[\Ý
[œ]ËY˜][ËÊKˆØÎˆ\œÙQ[XZ[\Ý
[œ]˜ØËY˜][Ë˜ØÊKˆ˜ØÎˆ\œÙQ[XZ[\Ý
[œ]˜˜ØËY˜][Ë˜˜ØÊKˆÝXš™XÝˆÝš[™Ê[œ]œÝXš™XÝÏÈY˜][ËœÝXš™XÝ
Kˆ[›ÎˆÝš[™Ê[œ]š[›ÈÏÈY˜][Ëš[›ÊKˆ[˜ÛYT™XÙZ]˜X›T^[Y[Îˆ[œ]š[˜ÛYT™XÙZ]˜X›T^[Y[ÈÏÈY˜][Ëš[˜ÛYT™XÙZ]˜X›T^[Y[Ëˆ[˜ÛYP^Y\ÚXR[›ÚXÙ\Îˆ[œ]š[˜ÛYP^Y\ÚXR[›ÚXÙ\ÈÏÈY˜][Ëš[˜ÛYP^Y\ÚXR[›ÚXÙ\ËˆNÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[ÙX\˜ÚX]Ú\Ê›ÝËÙX\˜ÚšY[ÊHÂˆÛÛœÝ]Y\žHHÝš[™ÊÙX\˜Ú	ÉÊBˆš[J
BˆÓÝÙ\Ø\ÙJ
NÂˆYˆ
\]Y\žJH™]\›ˆYNÂˆ™]\›ˆšY[ËœÛÛYJ
šY[
HO‚ˆÝš[™Ê›ÝÏË–ÙšY[H	ÉÊBˆÓÝÙ\Ø\ÙJ
Bˆš[˜ÛY\Ê]Y\žJKˆ
NÂŸB‚™[˜Ý[Ûˆ™[™\’[˜ÛÛZ[™Ô^[Y[[\]J˜[YKÛÛ^HßJHÂˆ]Ý]]HÝš[™Ê˜[YH	ÉÊNÂˆ›Üˆ
ÛÛœÝÚÙ^K™\XÙ[Y[HÙˆØš™XÝ™[šY\ÊÛÛ^
JHÂˆÝ]]HÝ]]œ™\XÙJ™]È™YÑ^
××Ê‰ÚÙ^_WÊ—WX	ÙÚIÊKÝš[™Ê™\XÙ[Y[ÏÈ	ÉÊJNÂˆBˆ™]\›ˆÝ]]ÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[™\ÜÝ[[X\žJ›ÝÜÈH×JHÂˆÛÛœÝ[˜ÛÛZ[™Ô›ÝÜÈH›ÝÜË™š[\Š
›ÝÊHOˆ›ÝËš\Ò[˜ÛÛZ[™ÊNÂˆ™]\›ˆÂˆ[˜ÛÛZ[™Ô›ÝÜÎˆ[˜ÛÛZ[™Ô›ÝÜË›[™ÝˆÝ[[˜ÛÛZ[™Ð[[Ý[ˆ[˜ÛÛZ[™Ô›ÝÜËœ™YXÙJ
Ý[K›ÝÊHOˆÝ[H
ÈX]˜XœÊ[X™\Š›ÝËš[˜ÛÛZ[™Ð[[Ý[
JK
Kˆ^Y\”^[Y[Ý[ˆ›ÝÜË™š[\Š
›ÝÊHOˆ›ÝË\HOOH	Ð^Y\ˆ^[Y[	ÊKœ™YXÙJ
Ý[K›ÝÊHOˆÝ[H
ÈX]˜XœÊ[X™\Š›ÝËš[˜ÛÛZ[™Ð[[Ý[
JK
KˆÝ\Y\”™Y[™Ý[ˆ›ÝÜË™š[\Š
›ÝÊHOˆ›ÝË\HOOH	ÔÝ\Y\ˆ™Y[™	ÊKœ™YXÙJ
Ý[K›ÝÊHOˆÝ[H
ÈX]˜XœÊ[X™\Š›ÝËš[˜ÛÛZ[™Ð[[Ý[
JK
Kˆ[›X]ÚYÛÝ[ˆ›ÝÜË™š[\Š
›ÝÊHOˆ›ÝË\HOOH	Õ[›X]ÚY	È›ÝËœÝ]\ÈOOH	Ó™YYÈ™]šY]ÉÊK›[™ÝˆNÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[œÙ\Y›ÝJ›ÝÊHÂˆYˆ
\›ÝÏËœ^[Y[]H\›ÝÏË˜Ü™X]Y]JH™]\›ˆ	ÉÎÂˆYˆ
]SÛ›J›ÝËœ^[Y[]JHOOH]SÛ›J›ÝË˜Ü™X]Y]JJH™]\›ˆ	ÉÎÂˆ™]\›ˆ[œÙ\YÛˆ	Ü™]Q]J›ÝË˜Ü™X]Y]J_XÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[\›\Õ˜[YJ›ÝÊHÂˆ™]\›ˆ›ÝÏË\HOOH	Ð^Y\ˆ^[Y[	ÈÈ›ÝËœ^[Y[\›\È	ËIÈˆ	Ó‹ÐIÎÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[^U˜[YJ›ÝÊHÂˆYˆ
›ÝÏË\HOOH	Ð^Y\ˆ^[Y[	ÊH™]\›ˆ	Ó‹ÐIÎÂˆ™]\›ˆ›ÝË™[^Q^\ÈOH[È	ËIÈˆ[X™\Š›ÝË™[^Q^\ÊKÓØØ[TÝš[™Ê
NÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[[Ý[^
›ÝÊHÂˆÛÛœÝ˜[šÐÚ\™Ù\ÈH
›ÝÏË˜˜[šÐÚ\™Ù\È×JK›X\

Ú\™ÙJHOˆ˜[šÈÚ\™ÙH	Û[Û™^JÚ\™ÙK˜[[Ý[
_X
NÂˆ™]\›ˆÛ[Û™^J›ÝÏË˜[[Ý[
K‹‹˜˜[šÐÚ\™Ù\×Kš›Ú[Š	ÈÈ	ÊNÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[™XÙZ]˜X›UX›R[
›ÝÜÈH×JHÂˆÛÛœÝX›T›ÝÜÈH›ÝÜÂˆ›X\

›ÝÊHOˆÂˆÛÛœÝÙ[H	Ø›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜÝ™\XØ[X[YÛŽÜ	ÎÂˆÛÛœÝ[[Ý[[™\ÈHÙ\ØØ\R[
[Û™^J›ÝË˜[[Ý[
JK‹‹Š›ÝË˜˜[šÐÚ\™Ù\È×JK›X\

Ú\™ÙJHOˆÜ[ˆÝ[OH™\Ü^N˜›ØÚÎØÛÛÜŽˆÎLNÙ›Û]ÙZYÚŒ˜[šÈÚ\™ÙH	Ù\ØØ\R[
[Û™^JÚ\™ÙK˜[[Ý[
J_OÜÜ[˜
WKš›Ú[Š	ÉÊNÂˆ™]\›ˆˆ‚ˆÝ[OH‰ØÙ[NÝÚ]K\ÜXÙN››ÝÜ˜\‰Ü™]Q]J›ÝËœ^[Y[]J_IÚ[˜ÛÛZ[™Ô^[Y[[œÙ\Y›ÝJ›ÝÊHÈÜ[ˆÝ[OH™\Ü^N˜›ØÚÎØÛÛÜŽˆÎLNÙ›Û\Ú^™NŒL\Ù›Û]ÙZYÚŒ’[œÙ\YÛˆ	Ü™]Q]J›ÝË˜Ü™X]Y]J_OÜÜ[˜ˆ	ÉßOÝ‚ˆÝ[OH‰ØÙ[NÝÚ]K\ÜXÙN››ÝÜ˜\Ý^X[YÛŽœšYÚ‰Ù\ØØ\R[
[˜ÛÛZ[™Ô^[Y[\›\Õ˜[YJ›ÝÊJ_OÝ‚ˆÝ[OH‰ØÙ[NÝÚ]K\ÜXÙN››ÝÜ˜\Ý^X[YÛŽœšYÚ‰Ù\ØØ\R[
[˜ÛÛZ[™Ô^[Y[[^U˜[YJ›ÝÊJ_OÝ‚ˆÝ[OH‰ØÙ[NÛZ[‹]ÚYŒMŒ‰Ù\ØØ\R[
›ÝËœ\S˜[YH	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[NÛZ[‹]ÚYŒM‰Ù\ØØ\R[
›ÝË˜^Y\‘Ü›Ý\˜[YH	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[NÛZ[‹]ÚYŒNÙ›Û]ÙZYÚŒ‰Ù\ØØ\R[
›ÝËœÝ[S˜[YH	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[NÝÚ]K\ÜXÙN››ÝÜ˜\Ý^X[YÛŽœšYÚÙ›Û]ÙZYÚŒ‰Ø[[Ý[[™\ßOÝ‚ˆÝ[OH‰ØÙ[NÝÚ]K\ÜXÙN››ÝÜ˜\Ý^X[YÛŽœšYÚ‰Û[Û™^J›ÝËœ™XÙZ]˜X›P˜[[˜ÙJ_OÝ‚ˆÝ˜ÂˆJBˆš›Ú[Š	ÉÊNÂˆ™]\›ˆˆ]ˆÝ[OH›X\™Ú[ŽŒMN‚ˆ]ˆÝ[OH™›Û\Ú^™NŒLÜÙ›Û]ÙZYÚÌÛX\™Ú[ŽŒØÛÛÜŽˆÌYŒŽLÍÈ”™XÙZ]˜X›H^[Y[È
	Ü›ÝÜË›[™ÝÓØØ[TÝš[™Ê
_JOÙ]‚ˆ]ˆÝ[OH›Ý™\™›ÝË^˜]]ÎØ›Ü™\ŽŒ\ÛÛYÙYL™YŽØ›Ü™\‹\˜Y]\ÎŒL‚ˆX›HÝ[OH˜›Ü™\‹XÛÛ\ÙN˜ÛÛ\ÙNÝÚY˜]]ÎÛZ[‹]ÚYŒLÙ›Û\Ú^™NŒLœÛ[™KZZYÚŒKŒÈ‚ˆXY‚ˆˆÝ[OH˜˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜ÎØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÙ›Û\Ú^™NŒL\Û]\‹\ÜXÚ[™Î‹Œ[H‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\”™XÙZ]™Y]OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\•\›\ÏÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\‘[^OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\‘œ›ÛOÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\‘Ü›Ý\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\”ÕSOÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\[[Ý[Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\”™XÙZ]˜X›OÝ‚ˆÝ‚ˆÝXY‚ˆ›ÙO‰ÝX›T›ÝÜÈ	ÏÛÛÜ[HŽˆÝ[OHœY[™ÎŒMœÝ^X[YÛŽ˜Ù[\ŽØÛÛÜŽˆÍÌH“›È™XÙZ]˜X›H^[Y[È›Ý[™›ÜˆHÙ[XÝYš[\œËÝÝ‰ßOÝ›ÙO‚ˆÝX›O‚ˆÙ]‚ˆÙ]˜ÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[^Y\ÚXUX›R[
›ÝÜÈH×JHÂˆÛÛœÝX›T›ÝÜÈH›ÝÜÂˆ›X\

›ÝÊHOˆÂˆÛÛœÝÙ[H	Ø›Ü™\‹X›ÝÛNŒ\ÛÛYÙMYMÙXŽÜY[™ÎÜÝ™\XØ[X[YÛŽÜ	ÎÂˆ™]\›ˆˆ‚ˆÝ[OH‰ØÙ[NÛZ[‹]ÚYŒNÙ›Û]ÙZYÚŒ‰Ù\ØØ\R[
›ÝË˜^Y\“˜[YH	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[NÛZ[‹]ÚYŒM‰Ù\ØØ\R[
›ÝË˜^Y\‘Ü›Ý\˜[YH	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[NÛZ[‹]ÚYŒLÌ‰Ù\ØØ\R[
›ÝË˜^Y\•˜Y\ˆ	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[NÛZ[‹]ÚYŒNÙ›Û]ÙZYÚŒ‰Ù\ØØ\R[
›ÝËœÝ[S˜[YH	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[NÝÚ]K\ÜXÙN››ÝÜ˜\Ý^X[YÛŽœšYÚ‰Û[Û™^J›ÝË˜Ø[Ý[]Y[[Ý[
_OÝ‚ˆÝ[OH‰ØÙ[NÝÚ]K\ÜXÙN››ÝÜ˜\Ý^X[YÛŽœšYÚÙ›Û]ÙZYÚŒ‰Û[Û™^J›ÝËœ™XÙZ]˜X›P˜[[˜ÙJ_OÝ‚ˆÝ[OH‰ØÙ[NÝÚ]K\ÜXÙN››ÝÜ˜\‰Ü™]Q]J›ÝË™[]™\žQ]J_OÝ‚ˆÝ˜ÂˆJBˆš›Ú[Š	ÉÊNÂˆ™]\›ˆˆ]ˆÝ[OH›X\™Ú[ŽŒMN‚ˆ]ˆÝ[OH™›Û\Ú^™NŒLÜÙ›Û]ÙZYÚÌÛX\™Ú[ŽŒØÛÛÜŽˆÌYŒŽLÍÈ^Y\ˆÒPH[›ÚXÙ\È
	Ü›ÝÜË›[™ÝÓØØ[TÝš[™Ê
_JOÙ]‚ˆ]ˆÝ[OH›Ý™\™›ÝË^˜]]ÎØ›Ü™\ŽŒ\ÛÛYÙYL™YŽØ›Ü™\‹\˜Y]\ÎŒL‚ˆX›HÝ[OH˜›Ü™\‹XÛÛ\ÙN˜ÛÛ\ÙNÝÚY˜]]ÎÛZ[‹]ÚYŽLÙ›Û\Ú^™NŒLœÛ[™KZZYÚŒKŒÈ‚ˆXY‚ˆˆÝ[OH˜˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜ÎØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÙ›Û\Ú^™NŒL\Û]\‹\ÜXÚ[™Î‹Œ[H‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\^Y\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\‘Ü›Ý\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\^Y\ˆ˜Y\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\”ÕSOÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\Ø[Ý[]Y[[Ý[Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\”™XÙZ]˜X›H˜[[˜ÙOÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\‘[]™\žH]OÝ‚ˆÝ‚ˆÝXY‚ˆ›ÙO‰ÝX›T›ÝÜÈ	ÏÛÛÜ[HÈˆÝ[OHœY[™ÎŒMœÝ^X[YÛŽ˜Ù[\ŽØÛÛÜŽˆÍÌH“›È^Y\ˆÒPH[›ÚXÙ\È›Ý[™›ÜˆHÙ[XÝYš[\œËÝÝ‰ßOÝ›ÙO‚ˆÝX›O‚ˆÙ]‚ˆÙ]˜ÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[™XÙZ]˜X›UX›U^
›ÝÜÈH×JHÂˆYˆ
\›ÝÜË›[™Ý
H™]\›ˆ	Ô™XÙZ]˜X›H^[Y[Îˆ›Û™IÎÂˆ™]\›ˆØ™XÙZ]˜X›H^[Y[È
	Ü›ÝÜË›[™ÝJX	Ô™XÙZ]™Y]H\›\È[^Hœ›ÛHÜ›Ý\ÕSH[[Ý[™XÙZ]˜X›IË‹‹œ›ÝÜË›X\

›ÝÊHOˆ	Ü™]Q]J›ÝËœ^[Y[]J_IÚ[˜ÛÛZ[™Ô^[Y[[œÙ\Y›ÝJ›ÝÊHÈ
	Ú[˜ÛÛZ[™Ô^[Y[[œÙ\Y›ÝJ›ÝÊ_JXˆ	ÉßH	Ú[˜ÛÛZ[™Ô^[Y[\›\Õ˜[YJ›ÝÊ_H	Ú[˜ÛÛZ[™Ô^[Y[[^U˜[YJ›ÝÊ_H	Ü›ÝËœ\S˜[YH	ËIßH	Ü›ÝË˜^Y\‘Ü›Ý\˜[YH	ËIßH	Ü›ÝËœÝ[S˜[YH	ËIßH	Ú[˜ÛÛZ[™Ô^[Y[[[Ý[^
›ÝÊ_H	Û[Û™^J›ÝËœ™XÙZ]˜X›P˜[[˜ÙJ_X
WKš›Ú[Š	×‰ÊNÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[^Y\ÚXUX›U^
›ÝÜÈH×JHÂˆYˆ
\›ÝÜË›[™Ý
H™]\›ˆ	Ð^Y\ˆÒPH[›ÚXÙ\Îˆ›Û™IÎÂˆ™]\›ˆØ^Y\ˆÒPH[›ÚXÙ\È
	Ü›ÝÜË›[™ÝJX‹‹œ›ÝÜË›X\

›ÝÊHOˆ	Ü›ÝË˜^Y\“˜[YH	ËIßH	Ü›ÝË˜^Y\‘Ü›Ý\˜[YH	ËIßH	Ü›ÝË˜^Y\•˜Y\ˆ	ËIßH	Ü›ÝËœÝ[S˜[YH	ËIßHØ[Ý[]Y	Û[Û™^J›ÝË˜Ø[Ý[]Y[[Ý[
_H™XÙZ]˜X›H	Û[Û™^J›ÝËœ™XÙZ]˜X›P˜[[˜ÙJ_H[]™\žH	Ü™]Q]J›ÝË™[]™\žQ]J_X
WKš›Ú[Š	×‰ÊNÂŸB‚™[˜Ý[Ûˆ™\XÙR[˜ÛÛZ[™Ô^[Y[ÚÙ[ŠÛÝ\˜ÙK]\›‹™\XÙ[Y[
HÂˆ™]\›ˆÝš[™ÊÛÝ\˜ÙH	ÉÊBˆœ™\XÙJ™]È™YÑ^
–×—J—Ê‰Ü]\›‹œÛÝ\˜Ù_WÊÜ˜	ÚIÊK™\XÙ[Y[
Bˆœ™\XÙJ]\›‹™\XÙ[Y[
NÂŸB‚™[˜Ý[Ûˆ[š™XÝ[˜ÛÛZ[™Ô^[Y[X›\ÊÛÛ[Ù][™ÜË™XÙZ]˜X›UX›K^Y\ÚXUX›JHÂˆ]Ý]]HÝš[™ÊÛÛ[	ÉÊNÂˆÛÛœÝ\Ô™XÙZ]˜X›UÚÙ[ˆHSÓÓRS‘×ÔVSQS•Ô‘PÑRUP“WÕP“WÕÒÑS—ÔUT“‹\Ý
Ý]]
NÂˆÛÛœÝ\Ð^Y\ÚXUÚÙ[ˆHSÓÓRS‘×ÔVSQS•Ð•VQT—ÐÒPWÕP“WÕÒÑS—ÔUT“‹\Ý
Ý]]
NÂˆÝ]]H™\XÙR[˜ÛÛZ[™Ô^[Y[ÚÙ[ŠÝ]]SÓÓRS‘×ÔVSQS•Ô‘PÑRUP“WÕP“WÕÒÑS—ÔUT“‹Ù][™ÜËš[˜ÛYT™XÙZ]˜X›T^[Y[ÈÈ™XÙZ]˜X›UX›Hˆ	ÉÊNÂˆÝ]]H™\XÙR[˜ÛÛZ[™Ô^[Y[ÚÙ[ŠÝ]]SÓÓRS‘×ÔVSQS•Ð•VQT—ÐÒPWÕP“WÕÒÑS—ÔUT“‹Ù][™ÜËš[˜ÛYP^Y\ÚXR[›ÚXÙ\ÈÈ^Y\ÚXUX›Hˆ	ÉÊNÂˆYˆ
Ù][™ÜËš[˜ÛYT™XÙZ]˜X›T^[Y[È	‰ˆZ\Ô™XÙZ]˜X›UÚÙ[ŠHÝ]]
ÏH™XÙZ]˜X›UX›NÂˆYˆ
Ù][™ÜËš[˜ÛYP^Y\ÚXR[›ÚXÙ\È	‰ˆZ\Ð^Y\ÚXUÚÙ[ŠHÝ]]
ÏH^Y\ÚXUX›NÂˆ™]\›ˆÝ]]ÂŸB‚™[˜Ý[Ûˆ[š™XÝ[˜ÛÛZ[™Ô^[Y[]R[\™\Ý[šÊÛÛ[™\XÙ[Y[
HÂˆ]Ý]]HÝš[™ÊÛÛ[	ÉÊNÂˆ›Üˆ
ÛÛœÝ]\›ˆÙˆSÓÓRS‘×ÔVSQS•ÓUWÒS•T‘TÕÓS’×ÕÒÑS—ÔUT“”ÊHÂˆÝ]]H™\XÙR[˜ÛÛZ[™Ô^[Y[ÚÙ[ŠÝ]]]\›‹™\XÙ[Y[
NÂˆBˆ™]\›ˆÝ]]ÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[]R[\™\Ý[šÒ[
\›
HÂˆ™]\›ˆÝ[OH›X\™Ú[ŽŒMH™YH‰Ù\ØØ\R[
\›
_HˆÝ[OH™\Ü^Nš[›[™KX›ØÚÎØ›Ü™\‹\˜Y]\ÎŽØ˜XÚÙÜ›Ý[™ˆÑ‘ŒŽØÛÛÜŽˆÙ™™™™™ŽÝ^YXÛÜ˜][ÛŽ››Û™NÙ›Û]ÙZYÚÌÜY[™ÎŽ\LÜ“]H^[Y[[\™\Ý[›ÚXÙOØOÜ˜ÂŸB‚™[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[]R[\™\Ý[šÕ^
\›
HÂˆ™]\›ˆ]H^[Y[[\™\Ý[›ÚXÙNˆ	Ý\›XÂŸB‚™[˜Ý[ÛˆZ[[˜ÛÛZ[™Ô^[Y[[XZ[
™\ÜÙ][™ÜÊHÂˆÛÛœÝÝ[[X\žHH™\ÜœÝ[[X\žH[˜ÛÛZ[™Ô^[Y[™\ÜÝ[[X\žJ™\Üœ›ÝÜÈ×JNÂˆÛÛœÝ]R[\™\Ý\›H[˜ÛÛZ[™Ô^[Y[š[\•\›
Ù][™ÜË™\Ü
NÂˆÛÛœÝ[˜ÛÛZ[™Ô›ÝÜÈH[X™\ŠÝ[[X\žKš[˜ÛÛZ[™Ô›ÝÜÈ
NÂˆÛÛœÝ™YYÔ™]šY]ÐÛÝ[H[X™\ŠÝ[[X\žK[›X]ÚYÛÝ[
NÂˆÛÛœÝÛÛ^HÂˆ]Qœ›ÛNˆ™]Q]J™\Ü™]Qœ›ÛJKˆ]UÎˆ™]Q]J™\Ü™]UÊKˆÙ^Nˆ™]Q]J]SÛ›J™]È]J
JJKˆ^[Y[ÛÝ[ˆ
™\Üœ›ÝÜÈ×JK›[™ÝÓØØ[TÝš[™Ê
Kˆ™XÙZ]˜X›T^[Y[ÛÝ[ˆ
™\Üœ›ÝÜÈ×JK›[™ÝÓØØ[TÝš[™Ê
Kˆ^Y\ÚXPÛÝ[ˆ
™\Ü˜^Y\ÚXR[›ÚXÙ\È×JK›[™ÝÓØØ[TÝš[™Ê
Kˆ[˜ÛÛZ[™ÕÝ[ˆ[Û™^JÝ[[X\žKÝ[[˜ÛÛZ[™Ð[[Ý[
Kˆ^Y\”^[Y[Ý[ˆ[Û™^JÝ[[X\žK˜^Y\”^[Y[Ý[
KˆÝ\Y\”™Y[™Ý[ˆ[Û™^JÝ[[X\žKœÝ\Y\”™Y[™Ý[
Kˆ™YYÔ™]šY]ÐÛÝ[ˆÝš[™Ê™YYÔ™]šY]ÐÛÝ[
KˆÙ^]ÛÜ™ˆ™\ÜœÙX\˜Ú	ÉËˆNÂˆÛÛœÝÝXš™XÝH™[™\’[˜ÛÛZ[™Ô^[Y[[\]JÙ][™ÜËœÝXš™XÝÛÛ^
NÂˆÛÛœÝÛÛ[H™[™\’[˜ÛÛZ[™Ô^[Y[[\]JÙ][™ÜËš[›ËÛÛ^
NÂˆÛÛœÝÛÛ[^H\Ò[X\šÝ\
ÛÛ[
HÈ[ÔZ[•^
ÛÛ[
HˆÛÛ[ÂˆÛÛœÝÝ[[X\žR[HˆX›H›ÛOHœ™\Ù[][ÛˆˆÝ[OH˜›Ü™\‹XÛÛ\ÙN˜ÛÛ\ÙNÛX\™Ú[ŽŒNÝÚYŒL	NÛX^]ÚYÌŒ‚ˆ‚ˆÝ[OH˜›Ü™\ŽŒ\ÛÛYÙYL™YŽØ›Ü™\‹\˜Y]\ÎŽÜY[™ÎŒLœØ˜XÚÙÜ›Ý[™ˆÙ™™YŽH‚ˆ]ˆÝ[OH™›Û\Ú^™NŒLœØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÛ]\‹\ÜXÚ[™Î‹Œ[H’[˜ÛÛZ[™ÈÝ[Ù]‚ˆ]ˆÝ[OH™›Û\Ú^™NŒŒÙ›Û]ÙZYÚÌØÛÛÜŽˆÌNMŽH‰Û[Û™^JÝ[[X\žKÝ[[˜ÛÛZ[™Ð[[Ý[
_OÙ]‚ˆ]ˆÝ[OH›X\™Ú[‹]ÜÙ›Û\Ú^™NŒLœØÛÛÜŽˆÍÌH^Y\ˆ^[Y[È	Û[Û™^JÝ[[X\žK˜^Y\”^[Y[Ý[
_H0­ÈÝ\Y\ˆ™Y[™È	Û[Û™^JÝ[[X\žKœÝ\Y\”™Y[™Ý[
_H0­È	Ú[˜ÛÛZ[™Ô›ÝÜËÓØØ[TÝš[™Ê
_H™XÛÜ™ÏÙ]‚ˆÝ‚ˆÝ[OH˜›Ü™\ŽŒ\ÛÛYÙYL™YŽØ›Ü™\‹[YŒØ›Ü™\‹\˜Y]\ÎŒÜY[™ÎŒLœØ˜XÚÙÜ›Ý[™ˆÙ™™˜™Xˆ‚ˆ]ˆÝ[OH™›Û\Ú^™NŒLœØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÛ]\‹\ÜXÚ[™Î‹Œ[H“™YYÈ™]šY]ÏÙ]‚ˆ]ˆÝ[OH™›Û\Ú^™NŒŒÙ›Û]ÙZYÚÌØÛÛÜŽˆÙMÍÌˆ‰Û™YYÔ™]šY]ÐÛÝ[ÓØØ[TÝš[™Ê
_OÙ]‚ˆ]ˆÝ[OH›X\™Ú[‹]ÜÙ›Û\Ú^™NŒLœØÛÛÜŽˆÍÌH•[›X]ÚYÜˆ[˜ÛÛ\]H^[Y[ÏÙ]‚ˆÝ‚ˆÝ‚ˆÝX›O˜ÂˆÛÛœÝÛÛ[[H[š™XÝ[˜ÛÛZ[™Ô^[Y[]R[\™\Ý[šÊ[XZ[ÛÛ[[
ÛÛ[
K[˜ÛÛZ[™Ô^[Y[]R[\™\Ý[šÒ[
]R[\™\Ý\›
JNÂˆÛÛœÝ[Hˆ]ˆÝ[OH™›ÛY˜[Z[N’[\‹\šX[Ø[œË\Ù\šYŽØÛÛÜŽˆÌYŒŽLÍÎÛ[™KZZYÚŒKH‚ˆ	ÜÝ[[X\žR[Bˆ	Ú[š™XÝ[˜ÛÛZ[™Ô^[Y[X›\ÊÛÛ[[Ù][™ÜË[˜ÛÛZ[™Ô^[Y[™XÙZ]˜X›UX›R[
™\Üœ›ÝÜÈ×JK[˜ÛÛZ[™Ô^[Y[^Y\ÚXUX›R[
™\Ü˜^Y\ÚXR[›ÚXÙ\È×JJ_BˆÙ]˜ÂˆÛÛœÝ^ÛÛ[H[š™XÝ[˜ÛÛZ[™Ô^[Y[X›\ÊØ[˜ÛÛZ[™ÈÝ[ˆ	Û[Û™^JÝ[[X\žKÝ[[˜ÛÛZ[™Ð[[Ý[
_X^Y\ˆ^[Y[Îˆ	Û[Û™^JÝ[[X\žK˜^Y\”^[Y[Ý[
_XÝ\Y\ˆ™Y[™Îˆ	Û[Û™^JÝ[[X\žKœÝ\Y\”™Y[™Ý[
_X[˜ÛÛZ[™È™XÛÜ™Îˆ	Ú[˜ÛÛZ[™Ô›ÝÜËÓØØ[TÝš[™Ê
_X™YYÈ™]šY]Îˆ	Û™YYÔ™]šY]ÐÛÝ[ÓØØ[TÝš[™Ê
_X	ÉË[š™XÝ[˜ÛÛZ[™Ô^[Y[]R[\™\Ý[šÊÛÛ[^[˜ÛÛZ[™Ô^[Y[]R[\™\Ý[šÕ^
]R[\™\Ý\›
JWKš›Ú[Š	×‰ÊKÙ][™ÜË—‰Ú[˜ÛÛZ[™Ô^[Y[™XÙZ]˜X›UX›U^
™\Üœ›ÝÜÈ×J_W—˜—‰Ú[˜ÛÛZ[™Ô^[Y[^Y\ÚXUX›U^
™\Ü˜^Y\ÚXR[›ÚXÙ\È×J_W—˜
NÂˆ™]\›ˆÈÝXš™XÝ[^ˆ^ÛÛ[Ý[[X\žHNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[XZ[™\Ü
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝXÝ]™PXØÙ\ÜÈHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÝÜ™YH]ØZ]ØYš[˜[˜ÚX[™\ÜÙ][™ÜÊXÝ]™PXØÙ\ÜË˜ÛY[	Ú[˜ÛÛZ[™×Ü^[Y[Ü™\ÜÉËÈ™\]Z\™YˆX›ÙKœ™]šY]È	‰ˆX›ÙK™žT[ˆJNÂˆYˆ
X›ÙKœ™]šY]È	‰ˆX›ÙK™žT[ŠHÂˆÛÛœÝ^XÝYÙ][™ÜÔ™]š\Ú[ÛˆH[X™\Š›ÙK™^XÝYÙ][™ÜÔ™]š\Ú[ÛˆÏÈ›ÙK™^XÝYÜÙ][™Ü×Ü™]š\Ú[ÛŠNÂˆYˆ
S[X™\‹š\Ò[YÙ\Š^XÝYÙ][™ÜÔ™]š\Ú[ÛŠH^XÝYÙ][™ÜÔ™]š\Ú[ÛˆJHÂˆ›ÝÈ\\œ›ÜŠ	Ô™Yœ™\ÚH[˜ÛÛZ[™È^[Y[™\Ü™]šY]È™Y›Ü™HÙ[™[™Ë‰ËK	Ñ’SSÒPSÔ‘TÔ•Ô‘U’TÒSÓ—Ô‘TURT‘Q	ÊNÂˆBˆYˆ
^XÝYÙ][™ÜÔ™]š\Ú[ÛˆOOH[X™\ŠÝÜ™Yœ™]š\Ú[Ûˆ
JHÂˆ›ÝÈ\\œ›ÜŠ	ÕH\›Ý™Y[˜ÛÛZ[™È^[Y[™\Ü™XÚ\Y[ÈÜˆ[\]HÚ[™ÙYY\ˆ™]šY]Ëˆ™[Ü[ˆH™\Ü™Y›Ü™HÙ[™[™Ë‰ËK	Ñ’SSÒPSÔ‘TÔ•Ô‘U’TÒSÓ—ÐÓÓ‘“PÕ	ÊNÂˆBˆBˆÛÛœÝÙ][™ÜÈH[˜ÛÛZ[™Ô^[Y[[XZ[Ù][™ÜÊÝÜ™YœÙ][™ÜÊNÂˆYˆ
X›ÙKœ™]šY]È	‰ˆX›ÙK™žT[ˆ	‰ˆ
\Ù][™ÜËœÝXš™XÝš[J
H\Ù][™ÜËš[›Ëš[J
JJHÂˆ›ÝÈ\\œ›ÜŠ	Ò[˜ÛÛZ[™È^[Y[™\ÜÝXš™XÝ[™›ÙH\™H›ÝÛÛ™šYÝ\™YˆÙ[™[™È\È\ØX›Y‰ËLË	Ñ’SSÒPSÔ‘TÔ•ÕSTUWÓ“ÕÐÓÓ‘’QÕT‘Q	Ë[™Yš[™YYJNÂˆBˆÛÛœÝÛÝ\˜ÙHH]ØZ][˜ÛÛZ[™Ô^[Y[Ó\Ý
ˆÂˆ]Qœ›ÛNˆ›ÙK™]Qœ›ÛKˆ]UÎˆ›ÙK™]UËˆ[Z]ˆ›ÙK›[Z]LˆKˆ[ˆXÝ]™PXØÙ\ÜËˆ
NÂˆÛÛœÝÙX\˜ÚHÝš[™Ê›ÙKœÙX\˜Ú	ÉÊKš[J
NÂˆÛÛœÝ›ÝÜÈH
ÛÝ\˜ÙKœ›ÝÜÈ×JK™š[\Š
›ÝÊHOˆ[˜ÛÛZ[™Ô^[Y[ÙX\˜ÚX]Ú\Ê›ÝËÙX\˜ÚÉÜ\S˜[YIË	ÜÝ[S˜[YIË	ÚÙ^TÝ[IË	Ø^Y\“˜[YIË	Ø^Y\‘Ü›Ý\˜[YIË	ÜÝ\Y\“˜[YIË	ÜÝ\Y\’[›ÚXÙS˜[YI×JJNÂˆÛÛœÝ^Y\ÚXR[›ÚXÙ\ÈH
ÛÝ\˜ÙK˜^Y\ÚXR[›ÚXÙ\È×JK™š[\Š
›ÝÊHOˆ[˜ÛÛZ[™Ô^[Y[ÙX\˜ÚX]Ú\Ê›ÝËÙX\˜ÚÉØ^Y\“˜[YIË	Ø^Y\‘Ü›Ý\˜[YIË	Ø^Y\•˜Y\‰Ë	ÜÝ[S˜[YIË	ÚÙ^TÝ[I×JJNÂˆÛÛœÝ™\ÜHÂˆ‹‹œÛÝ\˜ÙKˆ›ÝÜËˆ^Y\ÚXR[›ÚXÙ\ËˆÙX\˜ÚˆÝ[[X\žNˆ[˜ÛÛZ[™Ô^[Y[™\ÜÝ[[X\žJ›ÝÜÊKˆNÂˆÛÛœÝ[XZ[HZ[[˜ÛÛZ[™Ô^[Y[[XZ[
™\ÜÙ][™ÜÊNÂˆÛÛœÝ™\ÜY]HHÂˆ]Qœ›ÛNˆ™\Ü™]Qœ›ÛKˆ]UÎˆ™\Ü™]UËˆÙX\˜Úˆ™XÙZ]˜X›T›ÝÜÎˆ›ÝÜË›[™Ýˆ^Y\ÚXT›ÝÜÎˆ^Y\ÚXR[›ÚXÙ\Ë›[™ÝˆÝ[[X\žNˆ[XZ[œÝ[[X\žKˆNÂˆYˆ
›ÙKœ™]šY]È›ÙK™žT[ŠHÂˆ™]\›ˆÂˆÙ[ˆ˜[ÙKˆ™]šY]ÎˆYKˆÙ][™ÜËˆÙ][™ÜÔ™]š\Ú[ÛŽˆ[X™\ŠÝÜ™Yœ™]š\Ú[Ûˆ
Kˆ™\Üˆ™\ÜY]Kˆ[XZ[ˆÂˆÝXš™XÝˆ[XZ[œÝXš™XÝˆ[ˆ[XZ[š[ˆ^ˆ[XZ[^ˆÝ[[X\žNˆ[XZ[œÝ[[X\žKˆKˆNÂˆBˆYˆ
\Ù][™ÜËË›[™Ý
H›ÝÈ\\œ›ÜŠ	Ð]X\ÝÛ™HÈ™XÚ\Y[\È™\]Z\™Y™Y›Ü™HÙ[™[™ÈH[˜ÛÛZ[™È^[Y[™\Ü‰Ë
NÂˆÛÛœÝ™\Ý[H]ØZ]Ù[™Ü\˜][Û˜[XZ[
ÂˆÎˆÙ][™ÜËËˆØÎˆÙ][™ÜË˜ØËˆ˜ØÎˆÙ][™ÜË˜˜ØËˆÝXš™XÝˆ[XZ[œÝXš™XÝˆ[ˆ[XZ[š[ˆ^ˆ[XZ[^ˆKÈÛY[ˆXÝ]™PXØÙ\ÜË˜ÛY[\œÜÙRÙ^Nˆ	Ú[˜ÛÛZ[™×Ü^[Y[Ü™\ÜÉÈJNÂˆ™]\›ˆÂˆÙ[ˆYKˆYˆ™\Ý[šYˆÎˆÙ][™ÜËËˆØÎˆÙ][™ÜË˜ØËˆ˜ØÎˆÙ][™ÜË˜˜ØËˆÝXš™XÝˆ[XZ[œÝXš™XÝˆ™\Üˆ™\ÜY]Kˆ›ÝÜÎˆ›ÝÜË›[™Ýˆ^Y\ÚXT›ÝÜÎˆ^Y\ÚXR[›ÚXÙ\Ë›[™Ýˆ[XZ[ˆÂˆÝXš™XÝˆ[XZ[œÝXš™XÝˆ[ˆ[XZ[š[ˆ^ˆ[XZ[^ˆÝ[[X\žNˆ[XZ[œÝ[[X\žKˆKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[XZ[Ù][™ÜÑÙ]
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÝÜ™YH]ØZ]ØYš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	Ú[˜ÛÛZ[™×Ü^[Y[Ü™\ÜÉÊNÂˆ™]\›ˆÂˆ‹‹œÝÜ™YˆÙ][™ÜÎˆ[˜ÛÛZ[™Ô^[Y[[XZ[Ù][™ÜÊÝÜ™YœÙ][™ÜÊKˆØ\Xš[]Y\ÎˆÂˆØ[“X[˜YÙTÙ][™ÜÎˆ]ØZ]\Ù\’\ÐØ\Xš[]JÛY[›Ùš[K	Ùš[˜[˜ÚX[Ü™\ÜÜÙ][™Ü×ÛX[˜YÙIÊKˆKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[XZ[Ù][™ÜÔØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛY[›Ùš[K	Ùš[˜[˜ÚX[Ü™\ÜÜÙ][™Ü×ÛX[˜YÙIË	Ñš[˜[˜ÚX[™\ÜÙ][™ÜÈX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™Y‰ÊNÂˆÛÛœÝÝ\œ™[H]ØZ]ØYš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	Ú[˜ÛÛZ[™×Ü^[Y[Ü™\ÜÉÊNÂˆÛÛœÝÙ][™ÜÈH[˜ÛÛZ[™Ô^[Y[[XZ[Ù][™ÜÊÈ‹‹˜Ý\œ™[œÙ][™ÜË‹‹Š›ÙKœÙ][™ÜÈ›ÙJHJNÂˆ™]\›ˆØ]™Qš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	Ú[˜ÛÛZ[™×Ü^[Y[Ü™\ÜÉËÂˆÙ][™ÜËˆ^XÝY™]š\Ú[ÛŽˆ›ÙK™^XÝY™]š\Ú[ÛˆÏÈ›ÙK™^XÝYÜ™]š\Ú[Û‹ˆK›Ùš[JNÂŸB‚™[˜Ý[Ûˆš[˜[˜ÚX[™\ÜÙ][™ÜÑY]ÜŠÙ][™ÜÈHßJHÂˆ™]\›ˆÂˆ‹‹œÙ][™ÜËˆÎˆ\œÙQ[XZ[\Ý
Ù][™ÜËË×JKš›Ú[Š	Ë	ÊKˆØÎˆ\œÙQ[XZ[\Ý
Ù][™ÜË˜ØË×JKš›Ú[Š	Ë	ÊKˆ˜ØÎˆ\œÙQ[XZ[\Ý
Ù][™ÜË˜˜ØË×JKš›Ú[Š	Ë	ÊKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝÙ][™ÜÑÙ]
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÝÜ™YH]ØZ]ØYš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÜ™\]Y\ÝÉÊNÂˆ™]\›ˆÂˆ‹‹œÝÜ™YˆÙ][™ÜÎˆš[˜[˜ÚX[™\ÜÙ][™ÜÑY]ÜŠÝÜ™YœÙ][™ÜÊKˆØ\Xš[]Y\ÎˆÂˆØ[“X[˜YÙTÙ][™ÜÎˆ]ØZ]\Ù\’\ÐØ\Xš[]JÛY[›Ùš[K	Ùš[˜[˜ÚX[Ü™\ÜÜÙ][™Ü×ÛX[˜YÙIÊKˆKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝÙ][™ÜÔØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛY[›Ùš[K	Ùš[˜[˜ÚX[Ü™\ÜÜÙ][™Ü×ÛX[˜YÙIË	Ñš[˜[˜ÚX[™\ÜÙ][™ÜÈX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™Y‰ÊNÂˆÛÛœÝÝ\œ™[H]ØZ]ØYš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÜ™\]Y\ÝÉÊNÂˆÛÛœÝØ[™Y]HH[˜ÛÛZ[™Ô^[Y[[\™\Ý[\]JÈ‹‹˜Ý\œ™[œÙ][™ÜË‹‹Š›ÙKœÙ][™ÜÈ›ÙJHJNÂˆ™]\›ˆØ]™Qš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	Ú[˜ÛÛZ[™×Ü^[Y[Ú[\™\ÝÜ™\]Y\ÝÉËÂˆÙ][™ÜÎˆØ[™Y]Kˆ^XÝY™]š\Ú[ÛŽˆ›ÙK™^XÝY™]š\Ú[ÛˆÏÈ›ÙK™^XÝYÜ™]š\Ú[Û‹ˆK›Ùš[JNÂŸB‚™[˜Ý[Ûˆ^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊ[œ]HßJHÂˆÛÛœÝ\Ð^Y\•˜Y\‘š[\ˆHØš™XÝœ›ÝÝ\Kš\ÓÝÛ”›Ü\K˜Ø[
[œ]	Ø^Y\•˜Y\œÉÊNÂˆ™]\›ˆÂˆ‹‹››Ü›X[^™P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊ[œ]Âˆ‹‹‘QUSÐ•VQT—ÒS•“ÒPÑWÑSPRSÔÑUS‘ÔËˆJKˆ\Ð^Y\•˜Y\‘š[\‹ˆNÂŸB‚™[˜Ý[ÛˆÙ\šX[^™P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÔ›ÝÊ™\ÜÙ][™ÜËYØXÞSY]HH[
HÂˆÛÛœÝÙ][™ÜÈH›Ü›X[^™P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊ™\ÜÙ][™ÜÏËœÙ][™ÜÈßJNÂˆ™]\›ˆÂˆÙ][™ÜËˆY]NˆÂˆÝÜ˜YÙP]˜Z[X›NˆYKˆÛÛ™šYÝ\™Yˆ™\ÜÙ][™ÜÏË˜ÛÛ™šYÝ\™YOOHYKˆ™]š\Ú[ÛŽˆ[X™\Š™\ÜÙ][™ÜÏËœ™]š\Ú[Ûˆ
Kˆ\Ý™]šY]Ð]ˆYØXÞSY]OË›\ÝÜ™]šY]×Ø][ˆ\Ý™]šY]Ô›ÝÐÛÝ[ˆYØXÞSY]OË›\ÝÜ™]šY]×Ü›Ý×ØÛÝ[ÏÈ[ˆ\ÝÙ[]ˆYØXÞSY]OË›\ÝÜÙ[Ø][ˆ\ÝÙ[›ÝÐÛÝ[ˆYØXÞSY]OË›\ÝÜÙ[Ü›Ý×ØÛÝ[ÏÈ[ˆ\Ý\œ›ÜŽˆYØXÞSY]OË›\ÝÙ\œ›Üˆ[ˆ\]YžQ[XZ[ˆ™\ÜÙ][™ÜÏË\]YžQ[XZ[[ˆ\]Y]ˆ™\ÜÙ][™ÜÏË\]Y][ˆ™^ØÚY[Y[Žˆ™^^Y\’[›ÚXÙTØÚY[T[ŠÙ][™ÜÊKˆKˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØYÝÜ™Y^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊ
HÂˆÛÛœÝÛY[HØY™TÝ\X˜\ÙPYZ[ÛY[

NÂˆYˆ
XÛY[
H›ÝÈ\\œ›ÜŠ	Ñš[˜[˜ÚX[™\ÜÙ][™ÜÈ\™H[˜]˜Z[X›KˆÙ[™[™È\È\ØX›Y[[ÝÜ˜YÙH\È™\ÝÜ™Y‰ËLË	Ñ’SSÒPSÔ‘TÔ•ÔÑUS‘Ô×ÕSURSP“IË[™Yš[™YYJNÂˆÛÛœÝÜ™\ÜÙ][™ÜËYØXÞWHH]ØZ]›ÛZ\ÙK˜[
ÂˆØYš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	ÛÝ]Ý[™[™×Ú[›ÚXÙWÜ™\ÜÉÊKˆÛY[™œ›ÛJ	Ø^Y\—Ú[›ÚXÙWÙ[XZ[ÜÙ][™ÜÉÊKœÙ[XÝ
	Û\ÝÜ™]šY]×Ø]\ÝÜ™]šY]×Ü›Ý×ØÛÝ[\ÝÜÙ[Ø]\ÝÜÙ[Ü›Ý×ØÛÝ[\ÝÙ\œ›Ü‰ÊK™\J	ÚY	Ë	ÙY˜][	ÊK›X^X™TÚ[™ÛJ
KˆJNÂˆYˆ
YØXÞK™\œ›ÜŠH›ÝÈ\\œ›ÜŠ	Ð^Y\ˆ[›ÚXÙH™\Ü\ÝÜžH\È[˜]˜Z[X›KˆÙ[™[™È\È\ØX›Y[[ÝÜ˜YÙH\È™\ÝÜ™Y‰ËLË	Ñ’SSÒPSÔ‘TÔ•ÔÑUS‘Ô×ÕSURSP“IË[™Yš[™YYJNÂˆ™]\›ˆÙ\šX[^™P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÔ›ÝÊ™\ÜÙ][™ÜËYØXÞK™]JNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØ]™TÝÜ™Y^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊÙ][™ÜË›Ùš[HH[^XÝY™]š\Ú[ÛˆH[
HÂˆÛÛœÝÛY[HÝ\X˜\ÙPYZ[ÛY[

NÂˆÛÛœÝÝ\œ™[H]ØZ]ØYš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	ÛÝ]Ý[™[™×Ú[›ÚXÙWÜ™\ÜÉÊNÂˆÛÛœÝ[œ]]ÚH^Y\’[›ÚXÙQ[XZ[Ù][™ÜÔ]Ú
Ù][™ÜÊNÂˆÛÛœÝ›Ü›X[^™YH›Ü›X[^™P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊÈ‹‹˜Ý\œ™[œÙ][™ÜË‹‹š[œ]]ÚJNÂˆÛÛœÝÙ][™ÜÔ]ÚHØš™XÝ™œ›ÛQ[šY\ÊØš™XÝšÙ^\Ê[œ]]Ú
K›X\

Ù^JHOˆÚÙ^K›Ü›X[^™YÚÙ^WWJJNÂˆYˆ
SØš™XÝšÙ^\ÊÙ][™ÜÔ]Ú
K›[™Ý
HÂˆ›ÝÈ\\œ›ÜŠ	Ó›È™XÛÙÛš^™Y^Y\ˆ[›ÚXÙH[XZ[Ù][™ÜÈÙ\™HÝ\YY‰Ë
NÂˆBˆÛÛœÝØ]™YH]ØZ]Ø]™Qš[˜[˜ÚX[™\ÜÙ][™ÜÊÛY[	ÛÝ]Ý[™[™×Ú[›ÚXÙWÜ™\ÜÉËÂˆÙ][™ÜÎˆÈ‹‹˜Ý\œ™[œÙ][™ÜË‹‹œÙ][™ÜÔ]ÚKˆ^XÝY™]š\Ú[Û‹ˆK›Ùš[JNÂˆ™]\›ˆÙ\šX[^™P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÔ›ÝÊØ]™Y
NÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\]P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÓY]J]ÚHßJHÂˆÛÛœÝÛY[HØY™TÝ\X˜\ÙPYZ[ÛY[

NÂˆYˆ
XÛY[
H™]\›ŽÂˆÛÛœÝÈ\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ø^Y\—Ú[›ÚXÙWÙ[XZ[ÜÙ][™ÜÉÊK\Ù\
ÈYˆ	ÙY˜][	Ë‹‹œ]ÚKÈÛÛÛ™›XÝˆ	ÚY	ÈJNÂˆYˆ
\œ›ÜŠHÛÛœÛÛK™\œ›ÜŠ	Ñ˜Z[YÈ\]H^Y\ˆ[›ÚXÙH[XZ[Ù][™ÜÈY]Y]IË\œ›Ü‹›Y\ÜØYÙJNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ^Y\’[›ÚXÙQ[XZ[Ù][™ÜÑÙ]
›ÙK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆÂˆ‹‹Š]ØZ]ØYÝÜ™Y^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊ
JKˆØ\Xš[]Y\ÎˆÂˆØ[“X[˜YÙTÙ][™ÜÎˆ]ØZ]\Ù\’\ÐØ\Xš[]JÛY[›Ùš[K	Ùš[˜[˜ÚX[Ü™\ÜÜÙ][™Ü×ÛX[˜YÙIÊKˆKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ^Y\’[›ÚXÙQ[XZ[Ù][™ÜÔØ]™J›ÙK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛY[›Ùš[K	Ùš[˜[˜ÚX[Ü™\ÜÜÙ][™Ü×ÛX[˜YÙIË	Ñš[˜[˜ÚX[™\ÜÙ][™ÜÈX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™Y‰ÊNÂˆ™]\›ˆØ]™TÝÜ™Y^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊ›ÙKœÙ][™ÜÈ›ÙK›Ùš[K›ÙK™^XÝY™]š\Ú[ÛˆÏÈ›ÙK™^XÝYÜ™]š\Ú[ÛŠNÂŸB‚™[˜Ý[ÛˆÛ™ÒÛÛ™ÔØÚY[T\Ê]HH™]È]J
JHÂˆÛÛœÝ\ÈH™]È[‘]U[YQ›Ü›X]
	Ù[‹UTÉËÂˆ[YV›Û™Nˆ	Ð\ÚXKÒÛ™×ÒÛÛ™ÉËˆÙYZÙ^Nˆ	ÜÚÜ	ËˆYX\Žˆ	Û[Y\šXÉËˆ[Ûˆ	Ì‹YYÚ]	Ëˆ^Nˆ	Ì‹YYÚ]	ËˆÝ\Žˆ	Ì‹YYÚ]	ËˆZ[]Nˆ	Ì‹YYÚ]	ËˆÝ\ÞXÛNˆ	ÚŒÉËˆJK™›Ü›X]Ô\Ê]JNÂˆÛÛœÝ˜[YHH
\JHOˆ\Ë™š[™

\
HOˆ\\HOOH\JOË˜[YNÂˆ™]\›ˆÂˆÙYZÙ^Nˆ˜[YJ	ÝÙYZÙ^IÊKˆ]Nˆ	Ý˜[YJ	ÞYX\‰Ê_KIÝ˜[YJ	Û[Û	Ê_KIÝ˜[YJ	Ù^IÊ_Xˆ[YNˆ	Ý˜[YJ	ÚÝ\‰Ê_N‰Ý˜[YJ	ÛZ[]IÊ_XˆZ[]SÙ‘^Nˆ[X™\Š˜[YJ	ÚÝ\‰ÊJH
ˆŒ
È[X™\Š˜[YJ	ÛZ[]IÊJKˆNÂŸB‚™[˜Ý[ÛˆØÚY[SZ[]SÙ‘^J[YJHÂˆÛÛœÝX]ÚHÝš[™Ê[YH	ÉÊBˆš[J
Bˆ›X]Ú
×ŠÌKŸJNŠÌŸJIÊNÂˆYˆ
[X]Ú
H™]\›ˆ[ÂˆÛÛœÝÝ\ˆH[X™\ŠX]ÚÌWJNÂˆÛÛœÝZ[]HH[X™\ŠX]ÚÌ—JNÂˆYˆ
Ý\ˆÝ\ˆˆŒÈZ[]HZ[]HˆNJH™]\›ˆ[Âˆ™]\›ˆÝ\ˆ
ˆŒ
ÈZ[]NÂŸB‚™[˜Ý[Ûˆ^Y\’[›ÚXÙTØÚY[YÚ[™ÝÊÙ][™ÜË]HH™]È]J
JHÂˆÛÛœÝ›ÝÈHÛ™ÒÛÛ™ÔØÚY[T\Ê]JNÂˆÛÛœÝÙYZÙ^\ÈH™]ÈÙ]

Ù][™ÜËÙYZÙ^\È×JK›X\

^JHOˆÝš[™Ê^JKœÛXÙJÊKÓÝÙ\Ø\ÙJ
JJNÂˆYˆ
]ÙYZÙ^\Ëš\ÊÝš[™Ê›ÝËÙYZÙ^JKœÛXÙJÊKÓÝÙ\Ø\ÙJ
JJH™]\›ˆ[Âˆ›Üˆ
ÛÛœÝ[YHÙˆÙ][™ÜËœÙ[™[Y\È×JHÂˆÛÛœÝØÚY[SZ[]HHØÚY[SZ[]SÙ‘^J[YJNÂˆYˆ
ØÚY[SZ[]HOH[
HÛÛ[YNÂˆÛÛœÝY™ˆH›ÝË›Z[]SÙ‘^HHØÚY[SZ[]NÂˆYˆ
Y™ˆH	‰ˆY™ˆJHÂˆÛÛœÝØÚY[U[YHHÝš[™Ê[YJKš[J
KœYÝ\
K	Ì	ÊNÂˆ™]\›ˆÂˆ]Nˆ›ÝË™]Kˆ[YNˆØÚY[U[YKˆ[’Ù^Nˆ^Y\‹Z[›ÚXÙ\Î‰Û›ÝË™]_N‰ÜØÚY[U[Y_XˆNÂˆBˆBˆ™]\›ˆ[ÂŸB‚™[˜Ý[Ûˆ\Ð^Y\’[›ÚXÙT™\ÜYJÙ][™ÜË]HH™]È]J
JHÂˆ™]\›ˆ›ÛÛX[Š^Y\’[›ÚXÙTØÚY[YÚ[™ÝÊÙ][™ÜË]JJNÂŸB‚™[˜Ý[Ûˆ™^^Y\’[›ÚXÙTØÚY[T[ŠÙ][™ÜËœ›ÛQ]HH™]È]J
JHÂˆÛÛœÝÙYZÙ^\ÈH™]ÈÙ]

Ù][™ÜËÙYZÙ^\È×JK›X\

^JHOˆÝš[™Ê^JKœÛXÙJÊKÓÝÙ\Ø\ÙJ
JJNÂˆÛÛœÝÙ[™[Y\ÈH
Ù][™ÜËœÙ[™[Y\È×JBˆ›X\

[YJHOˆÝš[™Ê[YJKš[J
KœYÝ\
K	Ì	ÊJBˆ™š[\Š
[YJHOˆØÚY[SZ[]SÙ‘^J[YJHOH[
BˆœÛÜ

NÂˆYˆ
]ÙYZÙ^\ËœÚ^™H\Ù[™[Y\Ë›[™Ý
H™]\›ˆ[Â‚ˆÛÛœÝ›ÝÈHÛ™ÒÛÛ™ÔØÚY[T\Êœ›ÛQ]JNÂˆ›Üˆ
]Ù™œÙ]HÈÙ™œÙ]MÈÙ™œÙ]
ÏHJHÂˆÛÛœÝ›Ø™HHÛ™ÒÛÛ™ÔØÚY[T\Ê™]È]Jœ›ÛQ]K™Ù][YJ
H
ÈÙ™œÙ]
ˆ
JNÂˆYˆ
]ÙYZÙ^\Ëš\ÊÝš[™Ê›Ø™KÙYZÙ^JKœÛXÙJÊKÓÝÙ\Ø\ÙJ
JJHÛÛ[YNÂˆ›Üˆ
ÛÛœÝ[YHÙˆÙ[™[Y\ÊHÂˆYˆ
Ù™œÙ]OOH	‰ˆØÚY[SZ[]SÙ‘^J[YJHH›ÝË›Z[]SÙ‘^JHÛÛ[YNÂˆ™]\›ˆ	Ü›Ø™K™]_H	Ý[Y_HÕÂˆBˆBˆ™]\›ˆ[ÂŸB‚™[˜Ý[ÛˆÝ™\™YTÙ]™\š]J^\Õ[[YJHÂˆYˆ
^\Õ[[YHOH[[X™\Š^\Õ[[YJHˆ
H™]\›ˆ[ÂˆÛÛœÝÝ™\™YQ^\ÈHX]˜XœÊ[X™\Š^\Õ[[YJJNÂˆYˆ
Ý™\™YQ^\ÈHM
H™]\›ˆ	Ü™Y	ÎÂˆYˆ
Ý™\™YQ^\ÈHÊH™]\›ˆ	ÛÜ˜[™ÙIÎÂˆ™]\›ˆ	ÞY[ÝÉÎÂŸB‚™[˜Ý[ÛˆÝ™\™YQ\Ü^U˜[YJ^\Õ[[YJHÂˆYˆ
^\Õ[[YHOH[
H™]\›ˆ	ËIÎÂˆÛÛœÝÝ™\™YHHS[X™\Š^\Õ[[YJNÂˆÛÛœÝ˜[YHHØš™XÝš\ÊÝ™\™YKL
HÈˆÝ™\™YNÂˆ™]\›ˆ˜[YKÓØØ[TÝš[™Ê
NÂŸB‚™[˜Ý[ÛˆÝ™\™YQ[XZ[Ý[\Ê^\Õ[[YKœÜÝ]\ÊHÂˆÛÛœÝÙ]™\š]HHÝ™\™YTÙ]™\š]J^\Õ[[YJNÂˆÛÛœÝÝ[\ÈHÂˆ™YˆÂˆ›ÝÎˆ	Ø˜XÚÙÜ›Ý[™ˆÙ™YL™L‰Ëˆ›Ü™\Žˆ	ÈÙ˜ØMXMIËˆ^ˆ	ÈÎNLXŒX‰Ëˆ[ˆ	Ø˜XÚÙÜ›Ý[™ˆÙ™XØXØNØ›Ü™\‹XÛÛÜŽˆÙŽÌMÌNØÛÛÜŽˆÍÙŒYY	ËˆKˆÜ˜[™ÙNˆÂˆ›ÝÎˆ	Ø˜XÚÙÜ›Ý[™ˆÙ™YØXIËˆ›Ü™\Žˆ	ÈÙ˜ŽLŒØÉËˆ^ˆ	ÈÎXLÍL‰Ëˆ[ˆ	Ø˜XÚÙÜ›Ý[™ˆÙ™˜MÍØ›Ü™\‹XÛÛÜŽˆÙŽMÌÌMŽØÛÛÜŽˆÍØÌ™L‰ËˆKˆY[ÝÎˆÂˆ›ÝÎˆ	Ø˜XÚÙÜ›Ý[™ˆÙ™MŽIËˆ›Ü™\Žˆ	ÈÙ˜XØÌMIËˆ^ˆ	ÈÎMIËˆ[ˆ	Ø˜XÚÙÜ›Ý[™ˆÙ˜ÙÍØ›Ü™\‹XÛÛÜŽˆÙXXŒÌØÛÛÜŽˆÍÌLÙŒL‰ËˆKˆNÂˆÛÛœÝ˜\ÙHHÝ[\ÖÜÙ]™\š]WHÂˆ›ÝÎˆ	ÉËˆ›Ü™\Žˆ	ÈÙMYMÙX‰Ëˆ^ˆ	ÈÌMŒÙX‰Ëˆ[ˆ	Ø˜XÚÙÜ›Ý[™ˆÙY™™™ŽØ›Ü™\‹XÛÛÜŽˆØ™™™™NØÛÛÜŽˆÌYY	ËˆNÂˆ™]\›ˆœÜÝ]\ÈOOH	ÐÛÛ™][Û˜[S›ÝÙ[	ÈÈÈ‹‹˜˜\ÙK›ÝÎˆ	Ø˜XÚÙÜ›Ý[™ˆÙNYY™‰Ë›Ü™\Žˆ	ÈØÌ˜ÉÈHˆ˜\ÙNÂŸB‚™[˜Ý[Ûˆ™[™\^Y\’[›ÚXÙQ[XZ[ÛÛ[
[\]K™\ÜÙ][™ÜÊHÂˆ™]\›ˆÝš[™Ê[\]HQUSÐ•VQT—ÒS•“ÒPÑWÑSPRSÔÑUS‘ÔËš[›ÊBˆœ™\XÙP[
	ÞÞÜ™\ÜÝ\_IË™]Q]J™\ÜÙ^JJBˆœ™\XÙP[
	ÞÞÜ™\Ü[™_IË™]Q]J™\Ü™YU›ÝYÚ
JBˆœ™\XÙP[
	ÞÞÙ^\ÐZXY_IËÝš[™ÊÙ][™ÜË™^\ÐZXYÏÈ™\Ü™^\ÐZXYÏÈQUSÐ•VQT—ÒS•“ÒPÑWÑSPRSÔÑUS‘ÔË™^\ÐZXY
JNÂŸB‚™[˜Ý[Ûˆ[XZ[ÛÛ[[
ÛÛ[
HÂˆYˆ
\Ò[X\šÝ\
ÛÛ[
JH™]\›ˆØ[š]^™T™[Z[™\’[
ÛÛ[
NÂˆÛÛœÝ›ØÚÜÈHÝš[™ÊÛÛ[	ÉÊBˆœÜ]
×žÌ‹KÊBˆ›X\

›ØÚÊHOˆ›ØÚËš[J
JBˆ™š[\Š›ÛÛX[ŠNÂˆYˆ
X›ØÚÜË›[™Ý
H™]\›ˆ	ÉÎÂˆ™]\›ˆ›ØÚÜÂˆ›X\

›ØÚË[™^
HOˆÂˆÛÛœÝ[H\ØØ\R[
›ØÚÊKœ™\XÙP[
	×‰Ë	Ïœ‰ÊNÂˆYˆ
[™^OOH
H™]\›ˆˆÝ[OH›X\™Ú[ŽŒœÙ›Û\Ú^™NŒŒ‰Ú[OÚ˜Âˆ™]\›ˆÝ[OH›X\™Ú[ŽŒMØÛÛÜŽˆÍÌH‰Ú[OÜ˜ÂˆJBˆš›Ú[Š	ÉÊNÂŸB‚™[˜Ý[Ûˆ^Y\•˜Y\‘š[\’[
™\ÜÙ][™ÜÊHÂˆÛÛœÝÜ[ÛœÈH™\Ü˜^Y\•˜Y\“Ü[ÛœÈ×NÂˆYˆ
[Ü[ÛœË›[™Ý
H™]\›ˆ	ÉÎÂˆÛÛœÝÙ[XÝYH™]ÈÙ]
™\Üš\Ð^Y\•˜Y\‘š[\ˆÈ™\ÜœÙ[XÝY^Y\•˜Y\œÈ×HˆÜ[ÛœÊNÂˆÛÛœÝ[XÝ]™HHÙ[XÝYœÚ^™HOOHÜ[ÛœË›[™ÝÂˆÛÛœÝ[\›H^Y\’[›ÚXÙQš[\•\›
Ù][™ÜË™\Ü[
NÂˆÛÛœÝ[Ú\HH™YH‰Ù\ØØ\R[
[\›
_HˆÝ[OH™\Ü^Nš[›[™KX›ØÚÎÝ^YXÛÜ˜][ÛŽ››Û™NØ›Ü™\ŽŒ\ÛÛY	Ø[XÝ]™HÈ	ÈÌMŒÙX‰Èˆ	ÈÙYL™Y‰ßNØ›Ü™\‹\˜Y]\ÎœÜY[™ÎLÛX\™Ú[ŽŒœœÙ›Û\Ú^™NŒLœÙ›Û]ÙZYÚŒÉØ[XÝ]™HÈ	Ø˜XÚÙÜ›Ý[™ˆÌMŒÙXŽØÛÛÜŽˆÙ™™‰Èˆ	Ø˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜ÎØÛÛÜŽˆÌMŒÙX‰ßH[ØO˜ÂˆÛÛœÝÚ\ÈHÜ[ÛœÂˆ›X\

˜[YJHOˆÂˆÛÛœÝXÝ]™HHÙ[XÝYš\Ê˜[YJNÂˆÛÛœÝ\›H^Y\’[›ÚXÙQš[\•\›
Ù][™ÜË™\Ü˜[YJNÂˆ™]\›ˆH™YH‰Ù\ØØ\R[
\›
_HˆÝ[OH™\Ü^Nš[›[™KX›ØÚÎÝ^YXÛÜ˜][ÛŽ››Û™NØ›Ü™\ŽŒ\ÛÛY	ØXÝ]™HÈ	ÈÌMŒÙX‰Èˆ	ÈÙYL™Y‰ßNØ›Ü™\‹\˜Y]\ÎœÜY[™ÎLÛX\™Ú[ŽŒœœÙ›Û\Ú^™NŒLœÙ›Û]ÙZYÚŒÉØXÝ]™HÈ	Ø˜XÚÙÜ›Ý[™ˆÌMŒÙXŽØÛÛÜŽˆÙ™™‰Èˆ	Ø˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜ÎØÛÛÜŽˆÌMŒÙX‰ßH‰Ù\ØØ\R[
˜[YJ_OØO˜ÂˆJBˆš›Ú[Š	ÉÊNÂˆ™]\›ˆˆ]ˆÝ[OH›X\™Ú[ŽŒLœ‚ˆ]ˆÝ[OH™›Û\Ú^™NŒL\ØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÛ]\‹\ÜXÚ[™Î‹Œ[NÙ›Û]ÙZYÚÌÛX\™Ú[‹X›ÝÛNœ“Ü[ˆš[\™YšY]ÈžH^Y\ˆ˜Y\ˆÈ^[Y[[™\Ù]‚ˆ]‰Ø[Ú\IØÚ\ßOÙ]‚ˆÙ]˜ÂŸB‚™[˜Ý[ÛˆZ[^Y\’[›ÚXÙT™\Ü[XZ[
™\ÜÙ][™ÜÊHÂˆÛÛœÝ›ÝÜÈH™\Üœ›ÝÜÈ×NÂˆÛÛœÝÝ™\™YHH›ÝÜË™š[\Š
›ÝÊHOˆ›ÝËœÝ]\ÈOOH	ÓÝ™\™YIÊNÂˆÛÛœÝYTÛÛÛˆH›ÝÜË™š[\Š
›ÝÊHOˆ›ÝËœÝ]\ÈOOH	ÓÝ™\™YIÊNÂˆÛÛœÝYTÛÛÛ“X™[HYH[ˆ	Ó[X™\ŠÙ][™ÜË™^\ÐZXY™\Ü™^\ÐZXYÊKÓØØ[TÝš[™Ê
_H^\ØÂˆÛÛœÝÛÛ[H™[™\^Y\’[›ÚXÙQ[XZ[ÛÛ[
Ù][™ÜËš[›Ë™\ÜÙ][™ÜÊNÂˆÛÛœÝÝ[ÈHÂˆÝ™\™YPÛÝ[ˆÝ™\™YK›[™ÝˆÝ™\™YT™XÙZ]˜X›NˆÝ™\™YKœ™YXÙJ
Ý[K›ÝÊHOˆÝ[H
È[X™\Š›ÝËœ™XÙZ]˜X›P˜[[˜ÙH
K
KˆYTÛÛÛÛÝ[ˆYTÛÛÛ‹›[™ÝˆYTÛÛÛ”™XÙZ]˜X›NˆYTÛÛÛ‹œ™YXÙJ
Ý[K›ÝÊHOˆÝ[H
È[X™\Š›ÝËœ™XÙZ]˜X›P˜[[˜ÙH
K
KˆNÂˆÛÛœÝÝXš™XÝH	ÜÙ][™ÜËœÝXš™XÝHH	Ü™]Q]J™\ÜÙ^J_XÂˆÛÛœÝÝ[[X\žR[HÙ][™ÜËš[˜ÛYTÝ[[X\žBˆÈˆX›H›ÛOHœ™\Ù[][ÛˆˆÝ[OH˜›Ü™\‹XÛÛ\ÙN˜ÛÛ\ÙNÛX\™Ú[ŽŒNÝÚYŒL	NÛX^]ÚYŒŒ‚ˆ‚ˆÝ[OH˜›Ü™\ŽŒ\ÛÛYÙYL™YŽØ›Ü™\‹\˜Y]\ÎŽÜY[™ÎŒLœØ˜XÚÙÜ›Ý[™ˆÙ™™ÙÈ‚ˆ]ˆÝ[OH™›Û\Ú^™NŒLœØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÛ]\‹\ÜXÚ[™Î‹Œ[H“Ý™\™YOÙ]‚ˆ]ˆÝ[OH™›Û\Ú^™NŒŒÙ›Û]ÙZYÚÌØÛÛÜŽˆÙÌŒˆ‰Û[Û™^JÝ[Ë›Ý™\™YT™XÙZ]˜X›J_H
	ÝÝ[Ë›Ý™\™YPÛÝ[JOÙ]‚ˆÝ‚ˆÝ[OH˜›Ü™\ŽŒ\ÛÛYÙYL™YŽØ›Ü™\‹[YŒØ›Ü™\‹\˜Y]\ÎŒÜY[™ÎŒLœØ˜XÚÙÜ›Ý[™ˆÙÙ˜™™ˆ‚ˆ]ˆÝ[OH™›Û\Ú^™NŒLœØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÛ]\‹\ÜXÚ[™Î‹Œ[H‰Ù\ØØ\R[
YTÛÛÛ“X™[
_OÙ]‚ˆ]ˆÝ[OH™›Û\Ú^™NŒŒÙ›Û]ÙZYÚÌØÛÛÜŽˆÌMŒÙXˆ‰Û[Û™^JÝ[Ë™YTÛÛÛ”™XÙZ]˜X›J_H
	ÝÝ[Ë™YTÛÛÛÛÝ[JOÙ]‚ˆÝ‚ˆÝ‚ˆÝX›O˜ˆˆ	ÉÎÂˆÛÛœÝX›T›ÝÜÈH›ÝÜÂˆ›X\

›ÝÊHOˆÂˆÛÛœÝÙ]™\š]HHÝ™\™YQ[XZ[Ý[\Ê›ÝË™^\Õ[[YK›ÝËœœÜÝ]\ÊNÂˆÛÛœÝÙ[Ý[HH›Ü™\‹X›ÝÛNŒ\ÛÛY	ÜÙ]™\š]K˜›Ü™\ŸNÜY[™ÎŽLÂˆ™]\›ˆˆˆÝ[OH‰ÜÙ]™\š]Kœ›ÝßH‚ˆÝ[OH‰ØÙ[Ý[_NÙ›Û]ÙZYÚŒÝÚ]K\ÜXÙN››ÝÜ˜\‰Ù\ØØ\R[
›ÝËœÝ[S˜[YJ_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÛZ[‹]ÚYŒN‰Ù\ØØ\R[
›ÝË˜^Y\“˜[YH	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÛZ[‹]ÚYŒML‰Ù\ØØ\R[
›ÝË˜^Y\œ›ÚÙ\“˜[Y\È	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\‰Û[Û™^J›ÝËš[›ÚXÙP[[Ý[
_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÝ^X[YÛŽœšYÚÙ›Û]ÙZYÚŒÝÚ]K\ÜXÙN››ÝÜ˜\‰Û[Û™^J›ÝËœ™XÙZ]˜X›P˜[[˜ÙJ_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÝÚ]K\ÜXÙN››ÝÜ˜\‰Ü™]Q]J›ÝË˜^Y\’[›ÚXÙQYQ]J_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÛZ[‹]ÚYŒM‰Ù\ØØ\R[
›ÝË˜^Y\•˜Y\’[Ú\™ÙH	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÛZ[‹]ÚYŒMŒ‰Ù\ØØ\R[
›ÝËœ^[Y[[™\“˜[YH›ÝË˜ÛÛXÝ[ÛË›ÝÛ™\“˜[YH	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÛZ[‹]ÚYŒMŒ‰Ù\ØØ\R[
›ÝËœœÜÝ]\È	ËIÊ_OÝ‚ˆÝ[OH‰ØÙ[Ý[_H‚ˆÜ[ˆÝ[OH™\Ü^Nš[›[™KX›ØÚÎØ›Ü™\ŽŒ\ÛÛYØ›Ü™\‹\˜Y]\ÎŽNN\ÜY[™ÎŒœÙ›Û\Ú^™NŒLœÙ›Û]ÙZYÚŒÝÚ]K\ÜXÙN››ÝÜ˜\ÉÜÙ]™\š]Kœ[H‰Ù\ØØ\R[
›ÝËœÝ]\Ê_OÜÜ[‚ˆÝ‚ˆÝ[OH‰ØÙ[Ý[_NÝ^X[YÛŽœšYÚÙ›Û]ÙZYÚŒØÛÛÜŽ‰ÜÙ]™\š]K^NÝÚ]K\ÜXÙN››ÝÜ˜\‰ÛÝ™\™YQ\Ü^U˜[YJ›ÝË™^\Õ[[YJ_OÝ‚ˆÝ˜ÂˆJBˆš›Ú[Š	ÉÊNÂˆÛÛœÝX›R[HÙ][™ÜËš[˜ÛYUX›BˆÈˆ	Ø^Y\•˜Y\‘š[\’[
™\ÜÙ][™ÜÊ_Bˆ]ˆÝ[OH›X^ZZYÚŒÛÝ™\™›ÝÎ˜]]ÎØ›Ü™\ŽŒ\ÛÛYÙYL™YŽØ›Ü™\‹\˜Y]\ÎŒL‚ˆX›HÝ[OH˜›Ü™\‹XÛÛ\ÙN˜ÛÛ\ÙNÝÚYŒL	NÛZ[‹]ÚYŒLŒÙ›Û\Ú^™NŒLÜ‚ˆXY‚ˆˆÝ[OH˜˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜ÎØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÙ›Û\Ú^™NŒL\Û]\‹\ÜXÚ[™Î‹Œ[H‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽ›YÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È”Ý[OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽ›YÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È^Y\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽ›YÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È^Y\ˆœ›ÚÙ\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽœšYÚÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È’[›ÚXÙH[[Ý[Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽœšYÚÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È”™XÙZ]˜X›H˜[[˜ÙOÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽ›YÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È‘YH]OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽ›YÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È^Y\ˆ˜Y\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽ›YÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È”^[Y[ÛÛXÝ[Ûˆ[™\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽ›YÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È”Ô”ÏÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽ›YÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È”Ý]\ÏÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎŽLÝ^X[YÛŽœšYÚÜÜÚ][ÛŽœÝXÚÞNÝÜŒØ˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜È“Ý™\™YOÝ‚ˆÝ‚ˆÝXY‚ˆ›ÙO‰ÝX›T›ÝÜÈ	ÏÛÛÜ[HŒLHˆÝ[OHœY[™ÎŒNÝ^X[YÛŽ˜Ù[\ŽØÛÛÜŽˆÍÌH“›ÈÝ]Ý[™[™È^Y\ˆ[›ÚXÙ\È›Ý[™ÝÝ‰ßOÝ›ÙO‚ˆÝX›O‚ˆÙ]˜ˆˆ	ÉÎÂˆÛÛœÝÛÛ[[H[XZ[ÛÛ[[
ÛÛ[
NÂˆÛÛœÝ\Ð][[Û“X\šÙ\ˆHÙ›Üˆ[Ý\ˆ][[Û—‹ÚK\Ý
ÛÛ[[
NÂˆÛÛœÝÛÛ[^H\Ò[X\šÝ\
ÛÛ[
HÈ[ÔZ[•^
ÛÛ[
HˆÛÛ[ÂˆÛÛœÝ™\Ü›ÙR[H\Ð][[Û“X\šÙ\ˆ	‰ˆX›R[È	Ú[œÙ\Y\][[Û”Ù[[˜ÙJÛÛ[[X›R[
_IÜÝ[[X\žR[Xˆ	ØÛÛ[[IÜÝ[[X\žR[IÝX›R[XÂˆÛÛœÝ[Hˆ]ˆÝ[OH™›ÛY˜[Z[N’[\‹\šX[Ø[œË\Ù\šYŽØÛÛÜŽˆÌYŒŽLÍÎÛ[™KZZYÚŒKH‚ˆ	Ü™\Ü›ÙR[BˆÙ]˜ÂˆÛÛœÝX›U^H›ÝÜË›X\

›ÝÊHOˆ	Ü›ÝËœÝ[S˜[Y_H	Ü›ÝË˜^Y\“˜[YH	ËIßH^Y\ˆœ›ÚÙ\ˆ	Ü›ÝË˜^Y\œ›ÚÙ\“˜[Y\È	ËIßH™XÙZ]˜X›H˜[[˜ÙH	Û[Û™^J›ÝËœ™XÙZ]˜X›P˜[[˜ÙJ_HYH	Ü™]Q]J›ÝË˜^Y\’[›ÚXÙQYQ]J_H^Y\ˆ˜Y\ˆ	Ü›ÝË˜^Y\•˜Y\’[Ú\™ÙH	ËIßH^[Y[ÛÛXÝ[Ûˆ[™\ˆ	Ü›ÝËœ^[Y[[™\“˜[YH›ÝË˜ÛÛXÝ[ÛË›ÝÛ™\“˜[YH	ËIßHÔ”È	Ü›ÝËœœÜÝ]\È	ËIßH	Ü›ÝËœÝ]\ßHÝ™\™YH	ÛÝ™\™YQ\Ü^U˜[YJ›ÝË™^\Õ[[YJ_X
Kš›Ú[Š	×‰ÊNÂˆÛÛœÝ[›Õ^H\Ð][[Û“X\šÙ\ˆ	‰ˆX›U^È[œÙ\Y\][[Û”Ù[[˜ÙJÛÛ[^—‰ÝX›U^W—˜
HˆÛÛ[^ÂˆÛÛœÝ^[™\ÈHÚ[›Õ^Ý™\™YNˆ	Û[Û™^JÝ[Ë›Ý™\™YT™XÙZ]˜X›J_H
	ÝÝ[Ë›Ý™\™YPÛÝ[JX	ÙYTÛÛÛ“X™[Nˆ	Û[Û™^JÝ[Ë™YTÛÛÛ”™XÙZ]˜X›J_H
	ÝÝ[Ë™YTÛÛÛÛÝ[JXÜ[ˆ[[›ÚXÙ\Îˆ	Ø^Y\’[›ÚXÙQš[\•\›
Ù][™ÜË™\Ü[
_X‹‹Š™\Ü˜^Y\•˜Y\“Ü[ÛœÈ×JK›X\

˜[YJHOˆÜ[ˆ	Û˜[Y_Nˆ	Ø^Y\’[›ÚXÙQš[\•\›
Ù][™ÜË™\Ü˜[YJ_X
K	ÉË‹‹Š\Ð][[Û“X\šÙ\ˆÈ×Hˆ›ÝÜË›X\

›ÝÊHOˆ	Ü›ÝËœÝ[S˜[Y_H	Ü›ÝË˜^Y\“˜[YH	ËIßH^Y\ˆœ›ÚÙ\ˆ	Ü›ÝË˜^Y\œ›ÚÙ\“˜[Y\È	ËIßH™XÙZ]˜X›H˜[[˜ÙH	Û[Û™^J›ÝËœ™XÙZ]˜X›P˜[[˜ÙJ_HYH	Ü™]Q]J›ÝË˜^Y\’[›ÚXÙQYQ]J_H^Y\ˆ˜Y\ˆ	Ü›ÝË˜^Y\•˜Y\’[Ú\™ÙH	ËIßH^[Y[ÛÛXÝ[Ûˆ[™\ˆ	Ü›ÝËœ^[Y[[™\“˜[YH›ÝË˜ÛÛXÝ[ÛË›ÝÛ™\“˜[YH	ËIßHÔ”È	Ü›ÝËœœÜÝ]\È	ËIßH	Ü›ÝËœÝ]\ßHÝ™\™YH	ÛÝ™\™YQ\Ü^U˜[YJ›ÝË™^\Õ[[YJ_X
JWNÂˆ™]\›ˆÈÝXš™XÝ[^ˆ^[™\Ëš›Ú[Š	×‰ÊKÝ[ÈNÂŸB‚™[˜Ý[Ûˆ\Ñœ˜][PÛÜÝ[XÚ^Y\‘Ü›Ý\
˜[YJHÂˆ™]\›ˆ×™œ˜][WÊØÛÜÝ[XÚ‹ÚK\Ý
Ýš[™Ê˜[YH	ÉÊJNÂŸB‚™[˜Ý[Ûˆ›ÝÐ^Y\”™[Z[™\”™XÚ\Y[Ê›ÝÊHÂˆ™]\›ˆ[š\]YQ[XZ[\Ý
›ÝÏËœ^[Y[™[Z[™\”™XÚ\Y[È×K›ÝÏËœ^[Y[™[Z[™\”™XÚ\Y[	ÉË›ÝÏË˜^Y\XØÛÝ[Ñ[XZ[	ÉË›ÝÏË˜^Y\•˜Y\‘[XZ[	ÉË›ÝÏËœ^[Y[[™\‘[XZ[	ÉÊNÂŸB‚™[˜Ý[Ûˆ›ÝÐœ›ÚÙ\”™[Z[™\‘[XZ[Ê›ÝÊHÂˆ™]\›ˆ[š\]YQ[XZ[\Ý
›ÝÏË˜^Y\œ›ÚÙ\‘[XZ[È	ÉÊNÂŸB‚™[˜Ý[Ûˆ^[Y[™[Z[™\”›ÝÔ›Ý][™Ê›ÝÊHÂˆÛÛœÝ^Y\”™XÚ\Y[ÈH›ÝÐ^Y\”™[Z[™\”™XÚ\Y[Ê›ÝÊNÂˆÛÛœÝœ›ÚÙ\‘[XZ[ÈH›ÝÐœ›ÚÙ\”™[Z[™\‘[XZ[Ê›ÝÊNÂˆÛÛœÝœ›ÚÙ\“˜[Y\ÈH[š\]YU^\Ý
Ýš[™Ê›ÝÏË˜^Y\œ›ÚÙ\“˜[Y\È	ÉÊKœÜ]
	Ë	ÊJNÂˆÛÛœÝ[ÙHH›ÝÏË˜^Y\œ›ÚÙ\”›Ý][™Ó[ÙH	Ø^Y\—ÛÛ›IÎÂˆYˆ
[ÙHOOH	Øœ›ÚÙ\—ÛÛ›IÊHÂˆ™]\›ˆÂˆ[ÙKˆÎˆœ›ÚÙ\‘[XZ[ËˆØÎˆ×Kˆ˜ØÎˆ×Kˆš[X\žT™XÚ\Y[˜[YNˆœ›ÚÙ\“˜[Y\ÖÌH›ÝÏË˜^Y\œ›ÚÙ\“˜[Y\È	Ðœ›ÚÙ\‰ËˆØ\›š[™ÜÎˆ›ÝÏË˜^Y\œ›ÚÙ\”›Ý][™ÕØ\›š[™ÜÈ×KˆNÂˆBˆYˆ
[ÙHOOH	Ø^Y\—ØØ×Øœ›ÚÙ\‰ÊHÂˆ™]\›ˆÂˆ[ÙKˆÎˆ^Y\”™XÚ\Y[ËˆØÎˆœ›ÚÙ\‘[XZ[Ëˆ˜ØÎˆ×Kˆš[X\žT™XÚ\Y[˜[YNˆ›ÝÏË˜^Y\“˜[YH	ÐÝ\ÝÛY\‰ËˆØ\›š[™ÜÎˆ›ÝÏË˜^Y\œ›ÚÙ\”›Ý][™ÕØ\›š[™ÜÈ×KˆNÂˆBˆ™]\›ˆÂˆ[ÙNˆ	Ø^Y\—ÛÛ›IËˆÎˆ^Y\”™XÚ\Y[ËˆØÎˆ×Kˆ˜ØÎˆœ›ÚÙ\‘[XZ[Ëˆš[X\žT™XÚ\Y[˜[YNˆ›ÝÏË˜^Y\“˜[YH	ÐÝ\ÝÛY\‰ËˆØ\›š[™ÜÎˆ›ÝÏË˜^Y\œ›ÚÙ\”›Ý][™ÕØ\›š[™ÜÈ×KˆNÂŸB‚™[˜Ý[Ûˆ^[Y[™[Z[™\”›Ý][™Ñ›Ü”›ÝÜÊ›ÝÜÈH×JHÂˆÛÛœÝ™\Ý[Ü›Ý\ÈHÜ›Ý\^[Y[™[Z[™\”›ÝÜÊ›ÝÜË^[Y[™[Z[™\”›ÝÔ›Ý][™ÊNÂˆ™]\›ˆÂˆÜ›Ý\Îˆ™\Ý[Ü›Ý\ËˆÎˆ[š\]YQ[XZ[\Ý
‹‹œ™\Ý[Ü›Ý\Ë›X\

Ü›Ý\
HOˆÜ›Ý\ÊJKˆØÎˆ[š\]YQ[XZ[\Ý
‹‹œ™\Ý[Ü›Ý\Ë›X\

Ü›Ý\
HOˆÜ›Ý\˜ØÊJKˆ˜ØÎˆ[š\]YQ[XZ[\Ý
‹‹œ™\Ý[Ü›Ý\Ë›X\

Ü›Ý\
HOˆÜ›Ý\˜˜ØÊJKˆØ\›š[™ÜÎˆ[š\]YU^\Ý
™\Ý[Ü›Ý\Ë™›]X\

Ü›Ý\
HOˆÜ›Ý\Ø\›š[™ÜÊJKˆNÂŸB‚™[˜Ý[Ûˆ^[Y[™[Z[™\”™XÚ\Y[Ê›ÝÜÊHÂˆ™]\›ˆ^[Y[™[Z[™\”›Ý][™Ñ›Ü”›ÝÜÊ›ÝÜÊKÎÂŸB‚™[˜Ý[Ûˆ^[Y[™[Z[™\•[\]PÛÛ^
™\Ü›ÝÜËÙ[XÝY›Ý][™ÈH[
HÂˆÛÛœÝÝ[™XÙZ]˜X›HH
›ÝÜÈ×JKœ™YXÙJ
Ý[K›ÝÊHOˆÝ[H
È[X™\Š›ÝËœ™XÙZ]˜X›P˜[[˜ÙH
K
NÂˆÛÛœÝÙ[XÝY›ÝÈHÙ[XÝYßNÂˆÛÛœÝœ›ÚÙ\”›ÝÜÈH›ÝÜÏË›[™ÝÈ›ÝÜÈˆÜÙ[XÝY›Ý×NÂˆÛÛœÝ›Ý][™Ò[™›ÈH›Ý][™È^[Y[™[Z[™\”›Ý][™Ñ›Ü”›ÝÜÊ›ÝÜÈ×JK™Ü›Ý\ÖÌH[Âˆ™]\›ˆÂˆÝ[S˜[YNˆÙ[XÝY›ÝËœÝ[S˜[YH	ÉËˆÙ^TÝ[NˆÙ[XÝY›ÝËšÙ^TÝ[H	ÉËˆ^Y\“˜[YNˆÙ[XÝY›ÝË˜^Y\“˜[YH	ÐÝ\ÝÛY\‰Ëˆš[X\žT™XÚ\Y[˜[YNˆ›Ý][™Ò[™›ÏËœš[X\žT™XÚ\Y[˜[YHÙ[XÝY›ÝË˜^Y\“˜[YH	ÐÝ\ÝÛY\‰Ëˆ^Y\‘Ü›Ý\˜[YNˆÙ[XÝY›ÝË˜^Y\‘Ü›Ý\˜[YH	ÉËˆ[›ÚXÙP[[Ý[ˆ[Û™^JÙ[XÝY›ÝËš[›ÚXÙP[[Ý[
Kˆ™XÙZ]˜X›P˜[[˜ÙNˆ[Û™^JÙ[XÝY›ÝËœ™XÙZ]˜X›P˜[[˜ÙJKˆ^Y\’[›ÚXÙQYQ]Nˆ™]Q]JÙ[XÝY›ÝË˜^Y\’[›ÚXÙQYQ]JKˆ^Y\•˜Y\’[Ú\™ÙNˆÙ[XÝY›ÝË˜^Y\•˜Y\’[Ú\™ÙH	ÉËˆ^Y\XØÛÝ[Ñ[XZ[ˆÙ[XÝY›ÝË˜^Y\XØÛÝ[Ñ[XZ[	ÉËˆ^Y\•˜Y\‘[XZ[ˆÙ[XÝY›ÝË˜^Y\•˜Y\‘[XZ[	ÉËˆ^[Y[[™\“˜[YNˆÙ[XÝY›ÝËœ^[Y[[™\“˜[YHÙ[XÝY›ÝË˜ÛÛXÝ[ÛË›ÝÛ™\“˜[YH	ÉËˆ^[Y[[™\‘[XZ[ˆÙ[XÝY›ÝËœ^[Y[[™\‘[XZ[	ÉËˆ^Y\œ›ÚÙ\“˜[Y\Îˆ[š\]YU^\Ý
œ›ÚÙ\”›ÝÜË›X\

›ÝÊHOˆ›ÝË˜^Y\œ›ÚÙ\“˜[Y\ÊJKš›Ú[Š	Ë	ÊKˆ^Y\œ›ÚÙ\‘[XZ[Îˆ[š\]YQ[XZ[\Ý
‹‹˜œ›ÚÙ\”›ÝÜË›X\

›ÝÊHOˆ›ÝË˜^Y\œ›ÚÙ\‘[XZ[È	ÉÊJKš›Ú[Š	Ë	ÊKˆ^Y\œ›ÚÙ\’[›ÚXÙQ›Ü›X]Îˆ[š\]YU^\Ý
œ›ÚÙ\”›ÝÜË›X\

›ÝÊHOˆ›ÝË˜^Y\œ›ÚÙ\’[›ÚXÙQ›Ü›X]ÊJKš›Ú[Š	Ë	ÊKˆÔ™XÚ\Y[Îˆ›Ý][™Ò[™›ÈÈ›Ý][™Ò[™›ËËš›Ú[Š	Ë	ÊHˆ^[Y[™[Z[™\”™XÚ\Y[Ê›ÝÜÊKš›Ú[Š	Ë	ÊKˆÜœÔÝ]\ÎˆÙ[XÝY›ÝËœœÜÝ]\È	ÉËˆÝ™\™YNˆÝ™\™YQ\Ü^U˜[YJÙ[XÝY›ÝË™^\Õ[[YJKˆ[›ÚXÙTÝ]\ÎˆÙ[XÝY›ÝËœÝ]\È	ÉËˆ^\ÐZXYˆÝš[™Ê™\Ü™^\ÐZXYÏÈQUSÐ•VQT—ÒS•“ÒPÑWÑSPRSÔÑUS‘ÔË™^\ÐZXY
KˆÙ^Nˆ™]Q]J™\ÜÙ^JKˆYU›ÝYÚˆ™]Q]J™\Ü™YU›ÝYÚ
Kˆ[›ÚXÙPÛÝ[ˆÝš[™Ê
›ÝÜÈ×JK›[™Ý
KˆÝ[™XÙZ]˜X›Nˆ[Û™^JÝ[™XÙZ]˜X›JKˆNÂŸB‚™[˜Ý[Ûˆ™[™\”^[Y[™[Z[™\•[\]J[\]KÛÛ^
HÂˆÛÛœÝ˜[Y\ÈHÛÛ^ßNÂˆ™]\›ˆÝš[™Ê[\]H	ÉÊKœ™\XÙJ×××ÊŠÐKV˜K^ŒNW×JÊWÊ—WKÙË
X]ÚÙ^JHOˆ
Øš™XÝœ›ÝÝ\Kš\ÓÝÛ”›Ü\K˜Ø[
˜[Y\ËÙ^JHÈ˜[Y\ÖÚÙ^WHˆX]Ú
JNÂŸB‚™[˜Ý[Ûˆ™[™\”^[Y[™[Z[™\‘[XZ[\Ý
˜[YKÛÛ^
HÂˆÛÛœÝ˜]ÈH\œ˜^Kš\Ð\œ˜^J˜[YJHÈ˜[YKš›Ú[Š	Ë	ÊHˆÝš[™Ê˜[YH	ÉÊNÂˆ™]\›ˆ\œÙQ[XZ[\Ý
™[™\”^[Y[™[Z[™\•[\]J˜]ËÛÛ^
K×JNÂŸB‚™[˜Ý[Ûˆ\Ò[X\šÝ\
˜[YJHÂˆ™]\›ˆÏÏÖØK^—V×××J‹ÚK\Ý
Ýš[™Ê˜[YH	ÉÊJNÂŸB‚™[˜Ý[ÛˆØ[š]^™T™[Z[™\’[
˜[YJHÂˆ™]\›ˆÝš[™Ê˜[YH	ÉÊBˆœ™\XÙJÏØÜš\×××JÏ–×××JÏÜØÜš\‹ÙÚK	ÉÊBˆœ™\XÙJÏÝ[V×××JÏ–×××JÏÜÝ[O‹ÙÚK	ÉÊBˆœ™\XÙJ×ÛÛ–ØK^—J×ÊWÊŠÉÈ—JKŠ×KÙÚK	ÉÊBˆœ™\XÙJ×ÛÛ–ØK^—J×ÊWÊ–×—Ï—JËÙÚK	ÉÊBˆœ™\XÙJÚ˜]˜\ØÜš\‹ÙÚK	ÉÊNÂŸB‚™[˜Ý[Ûˆ[ÔZ[•^
˜[YJHÂˆ™]\›ˆÝš[™Ê˜[YH	ÉÊBˆœ™\XÙJÏœ—Ê—ÏÏ‹ÙÚK	×‰ÊBˆœ™\XÙJÏÜ‹ÙÚK	×—‰ÊBˆœ™\XÙJÏ×—JÏ‹ÙË	ÉÊBˆœ™\XÙJÉ›˜œÜËÙË	È	ÊBˆœ™\XÙJÉ˜[\ËÙË	É‰ÊBˆœ™\XÙJÉ›ËÙË	Ï	ÊBˆœ™\XÙJÉ™ÝËÙË	Ï‰ÊBˆœ™\XÙJÉœ][ÝËÙË	È‰ÊBˆœ™\XÙJÉˆÌÎNËÙË‰ÈŠBˆœ™\XÙJ×žÌËKÙË	×—‰ÊBˆš[J
NÂŸB‚™[˜Ý[Ûˆ^[Y[™[Z[™\ÛÛ[[
ÛÛ[
HÂˆÛÛœÝ[H\Ò[X\šÝ\
ÛÛ[
BˆÈØ[š]^™T™[Z[™\’[
ÛÛ[
BˆˆÝš[™ÊÛÛ[	ÉÊBˆœÜ]
×žÌ‹KÊBˆ›X\

›ØÚÊHOˆ‰Ù\ØØ\R[
›ØÚËš[J
JKœ™\XÙP[
	×‰Ë	Ïœ‰Ê_OÜ˜
Bˆš›Ú[Š	ÉÊNÂˆÛÛœÝX]Ú\ÈHË‹‹š[›X]Ú[
Ï–×—JŠ×××JÊOÜ‹ÙÚJWNÂˆÛÛœÝ\˜YÜ˜\ÈHX]Ú\Ë›[™ÝÈX]Ú\Ë›X\

X]Ú
HOˆX]ÚÌWJHˆ[œÜ]
Ïœ—Ê—ÏÏŸžÌ‹KÚJK›X\

›ØÚÊHOˆ\ØØ\R[
›ØÚËš[J
JJNÂˆ™]\›ˆ\˜YÜ˜\Âˆ›X\

[›™\ŠHOˆ[›™\‹š[J
JBˆ™š[\Š
[›™\ŠHOˆ[ÔZ[•^
[›™\ŠKš[J
JBˆ›X\

[›™\ŠHOˆÂˆÛÛœÝ^H[ÔZ[•^
[›™\ŠKœ™\XÙJ×ÊËÙË	È	ÊKš[J
KÓÝÙ\Ø\ÙJ
NÂˆ]X\™Ú[ˆH	ÌLœ	ÎÂˆYˆ
××ÊËË\Ý
^
JHX\™Ú[ˆH	ÌÜ	ÎÂˆ[ÙHYˆ
×˜]—‹Ë\Ý
^
JHX\™Ú[ˆH	ÌN	ÎÂˆ[ÙHYˆ
×œ™YØ\™ËËË\Ý
^
JHX\™Ú[ˆH	ÌÜ	ÎÂˆ[ÙHYˆ
×™œ˜][WÊØÛÜÝ[XÚË\Ý
^
JHX\™Ú[ˆH	Ì	ÎÂˆ™]\›ˆÝ[OH›X\™Ú[Ž‰ÛX\™Ú[ŸNÜY[™ÎŒØÛÛÜŽˆÌYŒŽLÍÎÛ[™KZZYÚŒKŒÍNÝ^X[YÛŽ›Y‰Ú[›™\ŸOÜ˜ÂˆJBˆš›Ú[Š	ÉÊNÂŸB‚™[˜Ý[Ûˆ[œÙ\Y\][[Û”Ù[[˜ÙJÛÛ[[œÙ\ÛÛ[
HÂˆÛÛœÝÛÝ\˜ÙHHÝš[™ÊÛÛ[	ÉÊNÂˆÛÛœÝX\šÙ\ˆHÙ›Üˆ[Ý\ˆ][[Û—‹ÚK™^XÊÛÝ\˜ÙJNÂˆYˆ
[X\šÙ\ŠH™]\›ˆ	ÜÛÝ\˜Ù_IÚ[œÙ\ÛÛ[XÂˆÛÛœÝY\“X\šÙ\ˆHX\šÙ\‹š[™^
ÈX\šÙ\–ÌK›[™ÝÂˆÛÛœÝ™\ÝHÛÝ\˜ÙKœÛXÙJY\“X\šÙ\ŠNÂˆÛÛœÝ\˜YÜ˜\ÛÜÙHHÏÜ‹ÚK™^XÊ™\Ý
NÂˆYˆ
\˜YÜ˜\ÛÜÙH	‰ˆ\˜YÜ˜\ÛÜÙKš[™^Ì
HÂˆÛÛœÝ[œÙ\]HY\“X\šÙ\ˆ
È\˜YÜ˜\ÛÜÙKš[™^
È\˜YÜ˜\ÛÜÙVÌK›[™ÝÂˆ™]\›ˆ	ÜÛÝ\˜ÙKœÛXÙJ[œÙ\]
_IÚ[œÙ\ÛÛ[IÜÛÝ\˜ÙKœÛXÙJ[œÙ\]
_XÂˆBˆ™]\›ˆ	ÜÛÝ\˜ÙKœÛXÙJY\“X\šÙ\Š_W—‰Ú[œÙ\ÛÛ[IÜÛÝ\˜ÙKœÛXÙJY\“X\šÙ\Š_XÂŸB‚™[˜Ý[Ûˆ[œÙ\[›ÚXÙUX›JÛÛ[[œÙ\ÛÛ[
HÂˆÛÛœÝÛÝ\˜ÙHHÝš[™ÊÛÛ[	ÉÊNÂˆYˆ
S•“ÒPÑWÕP“WÕÒÑS—ÔUT“‹\Ý
ÛÝ\˜ÙJJHÂˆ™]\›ˆÛÝ\˜ÙKœ™\XÙJ™]È™YÑ^
–×—J—Ê‰ÒS•“ÒPÑWÕP“WÕÒÑS—ÔUT“‹œÛÝ\˜Ù_WÊÜ˜	ÚIÊK[œÙ\ÛÛ[
Kœ™\XÙJS•“ÒPÑWÕP“WÕÒÑS—ÔUT“‹[œÙ\ÛÛ[
NÂˆBˆ™]\›ˆ[œÙ\Y\][[Û”Ù[[˜ÙJÛÝ\˜ÙK[œÙ\ÛÛ[
NÂŸB‚™[˜Ý[ÛˆZ[^Y\’[›ÚXÙT^[Y[™[Z[™\‘[XZ[
™\ÜÙ][™ÜËÙ[XÝY›ÝÜËÝ™\œšY\ÈHßK›Ý][™ÈH[
HÂˆÛÛœÝÙ[XÝY›ÝÜÈH›ÝÜÈ×NÂˆÛÛœÝÛÛ^H^[Y[™[Z[™\•[\]PÛÛ^
™\ÜÙ[XÝY›ÝÜËÙ[XÝY›Ý][™ÊNÂˆÛÛœÝÝXš™XÝH™[™\”^[Y[™[Z[™\•[\]JÝ™\œšY\ËœÝXš™XÝÙ][™ÜËœ^[Y[™[Z[™\”ÝXš™XÝÛÛ^
NÂˆÛÛœÝ›ÙHH™[™\”^[Y[™[Z[™\•[\]JÝ™\œšY\Ë˜›ÙHÙ][™ÜËœ^[Y[™[Z[™\›ÙKÛÛ^
NÂˆÛÛœÝX›T›ÝÜÈHÙ[XÝY›ÝÜÂˆ›X\

›ÝÊHOˆÂˆÛÛœÝÙ]™\š]HHÝ™\™YQ[XZ[Ý[\Ê›ÝË™^\Õ[[YK›ÝËœœÜÝ]\ÊNÂˆÛÛœÝÙ[Ý[HH›Ü™\‹X›ÝÛNŒ\ÛÛY	ÜÙ]™\š]K˜›Ü™\ŸNÜY[™ÎÜÝ™\XØ[X[YÛŽÜÂˆÛÛœÝ›ÝÜ˜\Ù[Ý[HH	ØÙ[Ý[_NÝÚ]K\ÜXÙN››ÝÜ˜\Âˆ™]\›ˆˆˆÝ[OH‰ÜÙ]™\š]Kœ›ÝßH‚ˆÝ[OH‰ØÙ[Ý[_NÙ›Û]ÙZYÚŒÛZ[‹]ÚYŒML‰Ù\ØØ\R[
›ÝËœÝ[S˜[YJ_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÛZ[‹]ÚYŒLL‰Ù\ØØ\R[
›ÝË˜^Y\“˜[YH	ËIÊ_OÝ‚ˆÝ[OH‰Û›ÝÜ˜\Ù[Ý[_NÝ^X[YÛŽœšYÚ‰Û[Û™^J›ÝËš[›ÚXÙP[[Ý[
_OÝ‚ˆÝ[OH‰Û›ÝÜ˜\Ù[Ý[_NÝ^X[YÛŽœšYÚÙ›Û]ÙZYÚŒ‰Û[Û™^J›ÝËœ™XÙZ]˜X›P˜[[˜ÙJ_OÝ‚ˆÝ[OH‰Û›ÝÜ˜\Ù[Ý[_H‰Ü™]Q]J›ÝË˜^Y\’[›ÚXÙQYQ]J_OÝ‚ˆÝ[OH‰ØÙ[Ý[_NÛZ[‹]ÚYŽ‰Ù\ØØ\R[
›ÝË˜^Y\•˜Y\’[Ú\™ÙH	ËIÊ_OÝ‚ˆÝ[OH‰Û›ÝÜ˜\Ù[Ý[_H‚ˆÜ[ˆÝ[OH™\Ü^Nš[›[™KX›ØÚÎØ›Ü™\ŽŒ\ÛÛYØ›Ü™\‹\˜Y]\ÎŽNN\ÜY[™ÎŒœÙ›Û\Ú^™NŒLœÙ›Û]ÙZYÚŒÝÚ]K\ÜXÙN››ÝÜ˜\ÉÜÙ]™\š]Kœ[H‰Ù\ØØ\R[
›ÝËœÝ]\Ê_OÜÜ[‚ˆÝ‚ˆÝ[OH‰Û›ÝÜ˜\Ù[Ý[_NÝ^X[YÛŽœšYÚÙ›Û]ÙZYÚŒØÛÛÜŽ‰ÜÙ]™\š]K^H‰ÛÝ™\™YQ\Ü^U˜[YJ›ÝË™^\Õ[[YJ_OÝ‚ˆÝ˜ÂˆJBˆš›Ú[Š	ÉÊNÂˆÛÛœÝX›R[Hˆ]ˆÝ[OH›Ý™\™›ÝË^˜]]ÎË]ÙXšÚ][Ý™\™›ÝË\ØÜ›Û[™ÎÝXÚØ›Ü™\ŽŒ\ÛÛYÙYL™YŽØ›Ü™\‹\˜Y]\ÎŒLÛX\™Ú[ŽŒMMœÛX^]ÚYŒL	H‚ˆX›HÝ[OH˜›Ü™\‹XÛÛ\ÙN˜ÛÛ\ÙNÝÚY˜]]ÎÛZ[‹]ÚYŒL	NÛX^]ÚY››Û™NÙ›Û\Ú^™NŒLœÛ[™KZZYÚŒKŒNÝX›K[^[Ý]˜]]È‚ˆXY‚ˆˆÝ[OH˜˜XÚÙÜ›Ý[™ˆÙŽ˜Y˜ÎØÛÛÜŽˆÍÌNÝ^]˜[œÙ›Ü›N\\˜Ø\ÙNÙ›Û\Ú^™NŒL\Û]\‹\ÜXÚ[™Î‹Œ[H‚‚HÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\”Ý[OÝ‚‚HÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\^Y\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\’[›ÚXÙOÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\”™XÙZ]˜X›OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\‘YH]OÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\•˜Y\Ý‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽ›YÝÚ]K\ÜXÙN››ÝÜ˜\”Ý]\ÏÝ‚ˆÝ[OH˜›Ü™\‹X›ÝÛNŒ\ÛÛYÙYL™YŽÜY[™ÎÜÝ^X[YÛŽœšYÚÝÚ]K\ÜXÙN››ÝÜ˜\“Ý™\™YOÝ‚ˆÝ‚ˆÝXY‚ˆ›ÙO‰ÝX›T›ÝÜÈ	ÏÛÛÜ[HŽˆÝ[OHœY[™ÎŒNÝ^X[YÛŽ˜Ù[\ŽØÛÛÜŽˆÍÌH“›È[›ÚXÙ\ÈÙ[XÝYÝÝ‰ßOÝ›ÙO‚ˆÝX›O‚ˆÙ]˜ÂˆÛÛœÝ›ÙR[H^[Y[™[Z[™\ÛÛ[[
›ÙJNÂˆÛÛœÝ[Ú]X›HH[œÙ\[›ÚXÙUX›J›ÙR[X›R[
NÂˆÛÛœÝ[›ÚXÙU^HÙ[XÝY›ÝÜË›X\

›ÝÊHOˆ	Ü›ÝËœÝ[S˜[Y_H	Ü›ÝË˜^Y\“˜[YH	ËIßH™XÙZ]˜X›H˜[[˜ÙH	Û[Û™^J›ÝËœ™XÙZ]˜X›P˜[[˜ÙJ_HYH	Ü™]Q]J›ÝË˜^Y\’[›ÚXÙQYQ]J_H	Ü›ÝËœÝ]\ßHÝ™\™YH	ÛÝ™\™YQ\Ü^U˜[YJ›ÝË™^\Õ[[YJ_H^Y\ˆ˜Y\ˆ	Ü›ÝË˜^Y\•˜Y\’[Ú\™ÙH	ËIßX
Kš›Ú[Š	×‰ÊNÂˆÛÛœÝ›ÙU^H\Ò[X\šÝ\
›ÙJHÈ[ÔZ[•^
›ÙJHˆ›ÙNÂˆÛÛœÝ[Hˆ]ˆÝ[OH™›ÛY˜[Z[N’[\‹\šX[Ø[œË\Ù\šYŽØÛÛÜŽˆÌYŒŽLÍÎÛ[™KZZYÚŒKH‚ˆ	Ú[Ú]X›_BˆÙ]˜ÂˆÛÛœÝ^H[œÙ\[›ÚXÙUX›J›ÙU^—‰Ú[›ÚXÙU^W—˜
NÂˆ™]\›ˆÈÝXš™XÝ›ÙK[^NÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØY^Y\’[›ÚXÙT^[Y[™[Z[™\ÛÛ^
›ÙHHßKXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÝ[RYHÝš[™Ê›ÙKœÝ[RY›ÙKœÝ[WÚY	ÉÊKš[J
NÂˆYˆ
Z\ÔØ[\Ù›Ü˜ÙRY
Ý[RY
JH›ÝÈ\\œ›ÜŠ	ÐH˜[YØ[\Ù›Ü˜ÙHÕSH\È™\]Z\™Y›ÜˆH^[Y[™[Z[™\‹‰Ë
NÂˆYˆ
XØÙ\ÜÐÛÛ^
H]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊÝ[RYXØÙ\ÜÐÛÛ^
NÂˆÛÛœÝÜÝÜ™YÙ[™\—HH]ØZ]›ÛZ\ÙK˜[
ÂˆØYÝÜ™Y^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊ
KˆXØÙ\ÜÐÛÛ^Ë˜ÛY[ˆÈ™\ÛÛ™QÜ˜\[XZ[Ù[™\ŠXØÙ\ÜÐÛÛ^˜ÛY[	Ü^[Y[Ü™[Z[™\œÉÊBˆˆ›ÛZ\ÙKœ™\ÛÛ™J[
KˆJNÂˆYˆ
ÝÜ™Y›Y]KœÝÜ˜YÙP]˜Z[X›HOOHYJHÂˆ›ÝÈ\\œ›ÜŠ	Ð^Y\ˆ[›ÚXÙH[XZ[Ù][™ÜÈ\™H[\Ü˜\š[H[˜]˜Z[X›Kˆ^\›˜[^[Y[™[Z[™\œÈ\™H\ØX›Y[[ÝÜ˜YÙH\È™\ÝÜ™Y‰ËLÊNÂˆBˆÛÛœÝÙ][™ÜÈHÂˆ‹‹˜^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊÝÜ™YœÙ][™ÜÊKˆ\Ð^Y\•˜Y\‘š[\Žˆ
ÝÜ™YœÙ][™ÜË˜^Y\•˜Y\œÈ×JK›[™ÝˆˆNÂˆÛÛœÝ™\ÜH]ØZ]Ø[\Ù›Ü˜ÙP^Y\’[›ÚXÙ\ÑYU\™Ù]Y
ˆÂˆ^\ÐZXYˆ›ÙK™^\ÐZXYÏÈÙ][™ÜË™^\ÐZXYˆ[˜ÚÜ”Ý[RYˆÝ[RYˆ™\]Y\ÝYÝ[RYÎˆ›ÙKœ™\]Y\ÝYÝ[RYÈ›ÙKš[›ÚXÙTÝ[RYËˆKˆ[ˆXØÙ\ÜÐÛÛ^ˆ
NÂˆYˆ
™\Üœ^[Y[™[Z[™\”[\Ð]˜Z[X›HOOHYJHÂˆ›ÝÈ\\œ›ÜŠ	Ð^Y\ˆ[›ÚXÙH™[Z[™\ˆ[\È\™H[\Ü˜\š[H[˜]˜Z[X›Kˆ^\›˜[^[Y[™[Z[™\œÈ\™H\ØX›Y[[ÝÜ˜YÙH\È™\ÝÜ™Y‰ËLÊNÂˆBˆÛÛœÝÙ[XÝYH™\Üœ›ÝÜË™š[™

›ÝÊHOˆ›ÝËœÝ[RYOOHÝ[RY
NÂˆYˆ
\Ù[XÝY
H›ÝÈ\\œ›ÜŠ	ÔÙ[XÝY[›ÚXÙH\È›ÈÛ™Ù\ˆ[ˆHÝ\œ™[Ý]Ý[™[™È[›ÚXÙHÚ[™ÝË‰Ë
NÂˆÛÛœÝØ[™Y]\ÈH™\Üœ›ÝÜÂˆ™š[\Š
›ÝÊHOˆ^Y\”™[Z[™\Ø[™Y]PžPXØÛÝ[
›ÝËÙ[XÝY
JBˆœÛÜ

KŠHOˆÂˆYˆ
K˜^Y\’[›ÚXÙQYQ]HOOH‹˜^Y\’[›ÚXÙQYQ]JH™]\›ˆK˜^Y\’[›ÚXÙQYQ]K›ØØ[PÛÛ\\™J‹˜^Y\’[›ÚXÙQYQ]JNÂˆ™]\›ˆÝš[™ÊKœÝ[S˜[YH	ÉÊK›ØØ[PÛÛ\\™JÝš[™Ê‹œÝ[S˜[YH	ÉÊJNÂˆJNÂˆ™]\›ˆÈÙ][™ÜËÙ][™ÜÔ™]š\Ú[ÛŽˆ[X™\ŠÝÜ™Y›Y]Kœ™]š\Ú[Ûˆ
K™\ÜÙ[XÝYØ[™Y]\ËÙ[™\ˆNÂŸB‚™[˜Ý[Ûˆ™\\™T^[Y[™[Z[™\”›Ý][™Ê™\ÜÙ][™ÜËÙ[XÝYØ[™Y]\ÊHÂˆÛÛœÝ[YÚX›PØ[™Y]\ÈHØ[™Y]\Ë™š[\Š
›ÝÊHOˆ›ÝËœ^[Y[™[Z[™\‘[YÚX›HOOHYJNÂˆÛÛœÝ›Ý][™ÈH^[Y[™[Z[™\”›Ý][™Ñ›Ü”›ÝÜÊ[YÚX›PØ[™Y]\ÊNÂˆÛÛœÝš\œÝÜ›Ý\H›Ý][™Ë™Ü›Ý\Ë™š[™

Ü›Ý\
HOˆÜ›Ý\œ›ÝÜËœÛÛYJ
›ÝÊHOˆ›ÝËœÝ[RYOOHÙ[XÝYœÝ[RY
JBˆ›Ý][™Ë™Ü›Ý\ÖÌBˆÂˆÙ^Nˆ	ÙY˜][	Ë›ÝÜÎˆ[YÚX›PØ[™Y]\ËÎˆ×KØÎˆ×K˜ØÎˆ×Kˆš[X\žT™XÚ\Y[˜[YNˆÙ[XÝY˜^Y\“˜[YH	ÐÝ\ÝÛY\‰Ë[ÙNˆ	Ø^Y\—ÛÛ›IËØ\›š[™ÜÎˆ×KˆNÂˆÛÛœÝš\œÝÙ[XÝYHš\œÝÜ›Ý\œ›ÝÜË™š[™

›ÝÊHOˆ›ÝËœÝ[RYOOHÙ[XÝYœÝ[RY
Hš\œÝÜ›Ý\œ›ÝÜÖÌHÙ[XÝYÂˆÛÛœÝ™\\™YÜ›Ý\ÈH›Ý][™Ë™Ü›Ý\Ë›X\

Ü›Ý\
HOˆÂˆÛÛœÝÜ›Ý\Ù[XÝYHÜ›Ý\œ›ÝÜË™š[™

›ÝÊHOˆ›ÝËœÝ[RYOOHÙ[XÝYœÝ[RY
HÜ›Ý\œ›ÝÜÖÌHÙ[XÝYÂˆÛÛœÝÜ›Ý\ÛÛ^H^[Y[™[Z[™\•[\]PÛÛ^
™\ÜÜ›Ý\œ›ÝÜËÜ›Ý\Ù[XÝYÜ›Ý\
NÂˆ™]\›ˆÂˆ[ÙNˆÜ›Ý\›[ÙKˆÙ^NˆÜ›Ý\šÙ^KˆÎˆÜ›Ý\ËˆØÎˆ[š\]YQ[XZ[\Ý
Ü›Ý\˜ØË™[™\”^[Y[™[Z[™\‘[XZ[\Ý
Ù][™ÜËœ^[Y[™[Z[™\ØËÜ›Ý\ÛÛ^
JKˆ˜ØÎˆ[š\]YQ[XZ[\Ý
Ü›Ý\˜˜ØË™[™\”^[Y[™[Z[™\‘[XZ[\Ý
Ù][™ÜËœ^[Y[™[Z[™\˜ØËÜ›Ý\ÛÛ^
JKˆš[X\žT™XÚ\Y[˜[YNˆÜ›Ý\œš[X\žT™XÚ\Y[˜[YKˆØ\›š[™ÜÎˆÜ›Ý\Ø\›š[™ÜËˆÝ[RYÎˆÜ›Ý\œ›ÝÜË›X\

›ÝÊHOˆ›ÝËœÝ[RY
KˆNÂˆJNÂˆÛÛœÝš\œÝ™\\™YÜ›Ý\H™\\™YÜ›Ý\Ë™š[™

Ü›Ý\
HOˆÜ›Ý\šÙ^HOOHš\œÝÜ›Ý\šÙ^JBˆ™\\™YÜ›Ý\ÖÌBˆÈÎˆš\œÝÜ›Ý\ËØÎˆš\œÝÜ›Ý\˜ØË˜ØÎˆš\œÝÜ›Ý\˜˜ØÈNÂˆÛÛœÝ[XZ[HZ[^Y\’[›ÚXÙT^[Y[™[Z[™\‘[XZ[
™\ÜÙ][™ÜËš\œÝÙ[XÝYš\œÝÜ›Ý\œ›ÝÜËßKš\œÝÜ›Ý\
NÂˆ™]\›ˆÈ[YÚX›PØ[™Y]\Ë›Ý][™Ëš\œÝÜ›Ý\š\œÝ™\\™YÜ›Ý\™\\™YÜ›Ý\Ë[XZ[NÂŸB‚™[˜Ý[Ûˆ^[Y[™[Z[™\”™\\˜][Û‘š[™Ù\œš[
ÈØ[™Y]\Ë™\\™YÜ›Ý\ËÙ][™ÜÔ™]š\Ú[ÛˆJHÂˆ™]\›ˆÜ™X]R\Ú
	ÜÚLM‰ÊK\]J”ÓÓ‹œÝš[™ÚYžJÂˆØ[™Y]\ÎˆØ[™Y]\Ë›X\

›ÝÊHOˆ
ÂˆÝ[RYˆ›ÝËœÝ[RYˆ\Ý[ÙYšYY]ˆ›ÝË›\Ý[ÙYšYY][ˆ[YÚX›Nˆ›ÝËœ^[Y[™[Z[™\‘[YÚX›HOOHYKˆ[T™]š\Ú[ÛŽˆ[X™\Š›ÝËœ™[Z[™\”[T™]š\Ú[Ûˆ
Kˆ[U\]Y]ˆ›ÝËœ™[Z[™\”[U\]Y][ˆJJKœÛÜ

YšYÚ
HOˆYœÝ[RY›ØØ[PÛÛ\\™JšYÚœÝ[RY
JKˆÜ›Ý\Îˆ™\\™YÜ›Ý\Ë›X\

Ü›Ý\
HOˆ
ÂˆÙ^NˆÜ›Ý\šÙ^KˆÝ[RYÎˆË‹‹™Ü›Ý\œÝ[RY×KœÛÜ

KˆÎˆ[š\]YQ[XZ[\Ý
Ü›Ý\ÊK›X\

[XZ[
HOˆ[XZ[ÓÝÙ\Ø\ÙJ
JKœÛÜ

KˆØÎˆ[š\]YQ[XZ[\Ý
Ü›Ý\˜ØÊK›X\

[XZ[
HOˆ[XZ[ÓÝÙ\Ø\ÙJ
JKœÛÜ

Kˆ˜ØÎˆ[š\]YQ[XZ[\Ý
Ü›Ý\˜˜ØÊK›X\

[XZ[
HOˆ[XZ[ÓÝÙ\Ø\ÙJ
JKœÛÜ

KˆJJKœÛÜ

YšYÚ
HOˆYšÙ^K›ØØ[PÛÛ\\™JšYÚšÙ^JJKˆÙ][™ÜÔ™]š\Ú[Û‹ˆJJK™YÙ\Ý
	Ú^	ÊNÂŸB‚™[˜Ý[Ûˆ^[Y[™[Z[™\ÛÛ™›XÝ]Z[ÊØ[™Y]\ÈH×JHÂˆ™]\›ˆÂˆØ[™Y]\ÎˆØ[™Y]\Ë›X\

›ÝÊHOˆ
ÂˆÝ[RYˆ›ÝËœÝ[RYˆÝ[S˜[YNˆ›ÝËœÝ[S˜[YKˆ^Y\“˜[YNˆ›ÝË˜^Y\“˜[YKˆ™XÙZ]˜X›P˜[[˜ÙNˆ›ÝËœ™XÙZ]˜X›P˜[[˜ÙKˆ^Y\’[›ÚXÙQYQ]Nˆ›ÝË˜^Y\’[›ÚXÙQYQ]Kˆ^[Y[™[Z[™\‘[YÚX›Nˆ›ÝËœ^[Y[™[Z[™\‘[YÚX›HOOHYKˆ^[Y[™[Z[™\›ØÚÚ[™Ô™X\ÛÛŽˆ›ÝËœ^[Y[™[Z[™\›ØÚÚ[™Ô™X\ÛÛˆ[ˆ\Ý[ÙYšYY]ˆ›ÝË›\Ý[ÙYšYY][ˆJJKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ^Y\’[›ÚXÙT^[Y[™[Z[™\”™\\™J›ÙK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÝ\Y]H]K››ÝÊ
NÂˆÛÛœÝXÝ]™PXØÙ\ÜÈHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÈÙ][™ÜËÙ][™ÜÔ™]š\Ú[Û‹™\ÜÙ[XÝYØ[™Y]\ÈHH]ØZ]ØY^Y\’[›ÚXÙT^[Y[™[Z[™\ÛÛ^
›ÙKXÝ]™PXØÙ\ÜÊNÂˆYˆ
Ù[XÝYœ^[Y[™[Z[™\‘[YÚX›HOOHYJHÂˆ›ÝÈ\\œ›ÜŠÙ[XÝYœ^[Y[™[Z[™\›ØÚÚ[™Ô™X\ÛÛˆ	Õ\È[›ÚXÙH\È›Ý[YÚX›H›Üˆ[ˆ^\›˜[^[Y[™[Z[™\‹‰ËJNÂˆBˆÛÛœÝÈ›Ý][™Ëš\œÝ™\\™YÜ›Ý\™\\™YÜ›Ý\Ë[XZ[HH™\\™T^[Y[™[Z[™\”›Ý][™Ê™\ÜÙ][™ÜËÙ[XÝYØ[™Y]\ÊNÂˆÛÛœÝ™\\™S\ÈH]K››ÝÊ
HHÝ\Y]ÂˆÛÛœÝ™\\˜][Û’\ÚH^[Y[™[Z[™\”™\\˜][Û‘š[™Ù\œš[
ÈØ[™Y]\Ë™\\™YÜ›Ý\ËÙ][™ÜÔ™]š\Ú[ÛˆJNÂˆÛÛœÝ™]šY]ÕÚÙ[ˆHÚYÛ”^[Y[™[Z[™\”™]šY]ÊÂˆ[˜ÚÜ”Ý[RYˆÙ[XÝYœÝ[RYˆØ[™Y]TÝ[RYÎˆØ[™Y]\Ë›X\

›ÝÊHOˆ›ÝËœÝ[RY
KœÛÜ

Kˆ™\\˜][Û’\ÚˆÙ][™ÜÔ™]š\Ú[Û‹ˆ™\\™S\ËˆK^[Y[™[Z[™\”™]šY]ÔÙXÜ™]

JNÂˆ™]\›ˆÂˆÙ[XÝYˆØ[™Y]\ËˆÎˆš\œÝ™\\™YÜ›Ý\Ëˆ[Îˆ›Ý][™ËËˆØÎˆš\œÝ™\\™YÜ›Ý\˜ØËˆ˜ØÎˆš\œÝ™\\™YÜ›Ý\˜˜ØËˆ]]Ð˜ØÎˆš\œÝ™\\™YÜ›Ý\˜˜ØËˆÝXš™XÝˆÙ][™ÜËœ^[Y[™[Z[™\”ÝXš™XÝˆ›ÙNˆÙ][™ÜËœ^[Y[™[Z[™\›ÙKˆ™]šY]ÎˆÈ[ˆ[XZ[š[^ˆ[XZ[^Kˆ›Ý][™ÑÜ›Ý\Îˆ™\\™YÜ›Ý\Ëˆ›Ý][™ÕØ\›š[™ÜÎˆ›Ý][™ËØ\›š[™ÜËˆÙ][™ÜÔ™]š\Ú[Û‹ˆ™]šY]ÕÚÙ[‹ˆ™\\˜][Û’\Úˆ[Z[™ÜÎˆÈ™\\™S\ÈKˆÙ][™ÜÎˆÂˆ^[Y[™[Z[™\•ÔÛÝ\˜ÙNˆ	Ð^Y\ˆXØÛÝ[Ý˜Y\‹Ü^[Y[[™\ˆ\È^Y\ˆœ›ÚÙ\ˆXØÛÝ[‘[XZ[žH[›ÚXÙH›Ü›X]	Ëˆ[XZ[[]™\žNˆÙ\™\‘[XZ[[]™\žTÝ]\Ê
Kˆ^\ÐZXYˆ™\Ü™^\ÐZXYˆ^[Y[™[Z[™\ØÎˆÙ][™ÜËœ^[Y[™[Z[™\ØËˆ^[Y[™[Z[™\˜ØÎˆÙ][™ÜËœ^[Y[™[Z[™\˜ØËˆKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ^Y\’[›ÚXÙT^[Y[™[Z[™\”Ù[™
›ÙK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝXÝ]™PXØÙ\ÜÈHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÙ[XÝYÝ[RYÈH™]ÈÙ]

\œ˜^Kš\Ð\œ˜^J›ÙKš[›ÚXÙTÝ[RYÊHÈ›ÙKš[›ÚXÙTÝ[RYÈˆ×JK›X\

Y
HOˆÝš[™ÊY	ÉÊKš[J
JK™š[\Š›ÛÛX[ŠJNÂˆYˆ
\Ù[XÝYÝ[RYËœÚ^™JH›ÝÈ\\œ›ÜŠ	ÔÙ[XÝ]X\ÝÛ™H[›ÚXÙHÈ[˜ÛYH[ˆH^[Y[™[Z[™\‹‰Ë
NÂˆÛÛœÝY[\Ý[˜ÞRÙ^HHÝš[™Ê›ÙKšY[\Ý[˜ÞRÙ^H	ÉÊKš[J
NÂˆYˆ
Y[\Ý[˜ÞRÙ^K›[™ÝMˆY[\Ý[˜ÞRÙ^K›[™ÝˆŒ
H›ÝÈ\\œ›ÜŠ	ÐH˜[Y^[Y[™[Z[™\ˆÜ\˜][ÛˆQ\È™\]Z\™Y‰Ë
NÂˆÛÛœÝ™]šY]ÈH™\šYžT^[Y[™[Z[™\”™]šY]Ê›ÙKœ™]šY]ÕÚÙ[‹^[Y[™[Z[™\”™]šY]ÔÙXÜ™]

JNÂˆÛÛœÝ[˜ÚÜ”Ý[RYHÝš[™Ê›ÙKœÝ[RY	ÉÊKš[J
NÂˆYˆ
™]šY]Ë˜[˜ÚÜ”Ý[RYOOH[˜ÚÜ”Ý[RY
H›ÝÈ\\œ›ÜŠ	ÕH^[Y[™[Z[™\ˆ™]šY]È™[Û™ÜÈÈ[›Ý\ˆ[›ÚXÙKˆ™[Ü[ˆ]™Y›Ü™HÙ[™[™Ë‰ËJNÂˆYˆ
Ë‹‹œÙ[XÝYÝ[RY×KœÛÛYJ
Ý[RY
HOˆ\™]šY]Ë˜Ø[™Y]TÝ[RYÏËš[˜ÛY\ÊÝ[RY
JJHÂˆ›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝY[›ÚXÙH\ÝÚ[™ÙYY\ˆ™]šY]Ëˆ™[Ü[ˆH^[Y[™[Z[™\ˆ™Y›Ü™HÙ[™[™Ë‰ËJNÂˆBˆÛÛœÝ˜[Y][Û”Ý\Y]H]K››ÝÊ
NÂˆ]ØZ]™XÛÛ˜Ú[P^Y\’[›ÚXÙPÛÛXÝ[ÛœÊÂˆÛY[ˆXÝ]™PXØÙ\ÜË˜ÛY[ˆ›Ùš[NˆXÝ]™PXØÙ\ÜËœ›Ùš[KˆXØÙ\ÜÐÛÛ^ˆXÝ]™PXØÙ\ÜËˆÝ[RYÎˆË‹‹œÙ[XÝYÝ[RY×KˆJNÂˆÛÛœÝÈÙ][™ÜËÙ][™ÜÔ™]š\Ú[ÛŽˆ]™TÙ][™ÜÔ™]š\Ú[Û‹™\ÜÙ[XÝYØ[™Y]\ËÙ[™\ˆHH]ØZ]ØY^Y\’[›ÚXÙT^[Y[™[Z[™\ÛÛ^
ˆÈ‹‹˜›ÙK™\]Y\ÝYÝ[RYÎˆ[KˆXÝ]™PXØÙ\ÜËˆ
NÂˆÛÛœÝ]™T›Ý][™ÈH™\\™T^[Y[™[Z[™\”›Ý][™Ê™\ÜÙ][™ÜËÙ[XÝYØ[™Y]\ÊNÂˆÛÛœÝ]™T™\\˜][Û’\ÚH^[Y[™[Z[™\”™\\˜][Û‘š[™Ù\œš[
ÂˆØ[™Y]\Ëˆ™\\™YÜ›Ý\Îˆ]™T›Ý][™Ëœ™\\™YÜ›Ý\ËˆÙ][™ÜÔ™]š\Ú[ÛŽˆ]™TÙ][™ÜÔ™]š\Ú[Û‹ˆJNÂˆYˆ
[X™\Š™]šY]ËœÙ][™ÜÔ™]š\Ú[ÛŠHOOH[X™\Š]™TÙ][™ÜÔ™]š\Ú[ÛŠH™]šY]Ëœ™\\˜][Û’\ÚOOH]™T™\\˜][Û’\Ú
HÂˆ›ÝÈ\\œ›ÜŠ	ÔØ[\Ù›Ü˜ÙK™[Z[™\ˆ[\Ë™XÚ\Y[ËÜˆ[XZ[Ù][™ÜÈÚ[™ÙYY\ˆ™]šY]Ëˆ™]šY]ÈH™Yœ™\ÚY™[Z[™\ˆ™Y›Ü™HÙ[™[™Ë‰ËK	ÔVSQS•Ô‘SRS‘T—Ô‘U’QU×ÔÕSIË^[Y[™[Z[™\ÛÛ™›XÝ]Z[ÊØ[™Y]\ÊJNÂˆBˆÛÛœÝÙ[XÝ[ÛˆH]˜[X]P^Y\”™[Z[™\”Ù[XÝ[ÛŠØ[™Y]\ËË‹‹œÙ[XÝYÝ[RY×JNÂˆYˆ
Ù[XÝ[Û‹[šÛ›ÝÛ”Ý[RYË›[™Ý
HÂˆ›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝY[›ÚXÙH\ÝÚ[™ÙYY\ˆ™]šY]Ëˆ™]šY]ÈH™Yœ™\ÚY™[Z[™\ˆ™Y›Ü™HÙ[™[™Ë‰ËK	ÔVSQS•Ô‘SRS‘T—ÔÑSPÕSÓ—ÔÕSIË^[Y[™[Z[™\ÛÛ™›XÝ]Z[ÊØ[™Y]\ÊJNÂˆBˆYˆ
Ù[XÝ[Û‹œ™\ÝšXÝY›ÝÜË›[™Ý
HÂˆ›ÝÈ\\œ›ÜŠÙ[XÝ[Û‹œ™\ÝšXÝY›ÝÜÖÌKœ^[Y[™[Z[™\›ØÚÚ[™Ô™X\ÛÛˆ	ÓÛ™HÜˆ[Ü™HÙ[XÝY[›ÚXÙ\È\™H›ÈÛ™Ù\ˆ[YÚX›H›Üˆ[ˆ^\›˜[^[Y[™[Z[™\‹‰ËK	ÔVSQS•Ô‘SRS‘T—ÔÑSPÕSÓ—Ô‘TÕ’PÕQ	Ë^[Y[™[Z[™\ÛÛ™›XÝ]Z[ÊØ[™Y]\ÊJNÂˆBˆÛÛœÝ›ÝÜÈHÙ[XÝ[Û‹œ›ÝÜÎÂˆÛÛœÝ›Ý][™ÈH^[Y[™[Z[™\”›Ý][™Ñ›Ü”›ÝÜÊ›ÝÜÊNÂˆYˆ
\›Ý][™Ë™Ü›Ý\Ë›[™Ý
H›ÝÈ\\œ›ÜŠ	Ó›È^[Y[™[Z[™\ˆ™XÚ\Y[Ü›Ý\ÛÝ[™HZ[‰Ë
NÂˆYˆ
P\œ˜^Kš\Ð\œ˜^J›ÙKœ™XÚ\Y[˜]Ú\ÊJHÂˆ›ÝÈ\\œ›ÜŠ	Ô™]šY]ÙY[XZ[™XÚ\Y[šY[È\™H™\]Z\™Yˆ™[Ü[ˆH^[Y[™[Z[™\ˆ™]šY]È[™ÛÛ™š\›HXXÚ[XZ[˜]Ú™Y›Ü™HÙ[™[™Ë‰Ë
NÂˆBˆÛÛœÝ™]šY]ÙY™XÚ\Y[˜]Ú\ÈH™]ÈX\
›ÙKœ™XÚ\Y[˜]Ú\Ë™š[\Š
˜]Ú
HOˆ˜]ÚËšÙ^JK›X\

˜]Ú
HOˆØ˜]ÚšÙ^K˜]ÚJJNÂˆÛÛœÝÝ]›Ý[™˜]Ú\ÈH›Ý][™Ë™Ü›Ý\Ë›X\

Ü›Ý\
HOˆÂˆÛÛœÝÜ›Ý\Ù[XÝYHÜ›Ý\œ›ÝÜË™š[™

›ÝÊHOˆ›ÝËœÝ[RYOOHÙ[XÝYœÝ[RY
HÜ›Ý\œ›ÝÜÖÌHÙ[XÝYÂˆÛÛœÝ™]šY]ÙY˜]ÚH™]šY]ÙY™XÚ\Y[˜]Ú\Ë™Ù]
Ü›Ý\šÙ^JNÂˆYˆ
\™]šY]ÙY˜]Ú
H›ÝÈ\\œ›ÜŠ™]šY]ÙY™XÚ\Y[šY[È\™HZ\ÜÚ[™È›Üˆ	ÙÜ›Ý\œš[X\žT™XÚ\Y[˜[YH	Ü™XÚ\Y[Ü›Ý\	ßKˆ™[Ü[ˆH™]šY]È™Y›Ü™HÙ[™[™Ë˜
NÂˆÛÛœÝÈH[š\]YQ[XZ[\Ý
™]šY]ÙY˜]ÚÈ	ÉÊNÂˆÛÛœÝØÈH[š\]YQ[XZ[\Ý
™]šY]ÙY˜]Ú˜ØÈ	ÉÊNÂˆÛÛœÝ˜ØÈH[š\]YQ[XZ[\Ý
™]šY]ÙY˜]Ú˜˜ØÈ	ÉÊNÂˆYˆ
]Ë›[™Ý
H›ÝÈ\\œ›ÜŠ^[Y[™[Z[™\ˆ™XÚ\Y[\È™\]Z\™Y›Üˆ	ÙÜ›Ý\œš[X\žT™XÚ\Y[˜[YH	Ü™XÚ\Y[Ü›Ý\	ßK˜
NÂˆÛÛœÝ[XZ[HZ[^Y\’[›ÚXÙT^[Y[™[Z[™\‘[XZ[
™\ÜÙ][™ÜËÜ›Ý\Ù[XÝYÜ›Ý\œ›ÝÜËÈÝXš™XÝˆ›ÙKœÝXš™XÝ›ÙNˆ›ÙK˜›ÙHKÈ‹‹™Ü›Ý\ÈJNÂˆ™]\›ˆÈÜ›Ý\ËØË˜ØË[XZ[NÂˆJNÂˆÛÛœÝ˜[Y][Û“\ÈH]K››ÝÊ
HH˜[Y][Û”Ý\Y]ÂˆÛÛœÝ™\]Y\Ý\ÚH^[Y[™[Z[™\”™\]Y\Ý\Ú
Âˆ[˜ÚÜ”Ý[RYˆ[›ÚXÙTÝ[RYÎˆË‹‹œÙ[XÝYÝ[RY×Kˆ™XÚ\Y[˜]Ú\Îˆ›ÙKœ™XÚ\Y[˜]Ú\ËˆÝXš™XÝˆ›ÙKœÝXš™XÝˆ›ÙNˆ›ÙK˜›ÙKˆJNÂˆÛÛœÝ™\Ù\˜][ÛˆH]ØZ]™\Ù\™T^[Y[™[Z[™\“Ü\˜][ÛŠXÝ]™PXØÙ\ÜË˜ÛY[ÂˆY[\Ý[˜ÞRÙ^Kˆ™\]Y\Ý\Úˆ[˜ÚÜ”Ý[RYˆÙ[XÝYÝ[RYÎˆË‹‹œÙ[XÝYÝ[RY×Kˆ˜]ÚÛÝ[ˆÝ]›Ý[™˜]Ú\Ë›[™ÝˆXÝÜ•\Ù\’YˆXÝ]™PXØÙ\ÜËœ›Ùš[KšYˆXÝÜ‘[XZ[ˆXÝ]™PXØÙ\ÜËœ›Ùš[K™[XZ[ˆJNÂˆYˆ
™\Ù\˜][Û‹œ™\^JH™]\›ˆÈÙ[ˆYKY[\Ý[˜ÞT™\^YYˆYK‹‹œ™\Ù\˜][Û‹œ™\Ý[NÂˆYˆ
™\Ù\˜][Û‹[˜Ù\Z[ŠH›ÝÈ\\œ›ÜŠ	ÐH™]š[Ý\È[]™\žH][\\È[ˆ[˜Ù\Z[ˆZXÜ›ÜÛÙÜ˜\Ý]ÛÛYKˆ™\šYžHÙ[][\È™Y›Ü™H™]žZ[™Ë‰ËJNÂˆYˆ
™\Ù\˜][Û‹˜›ØÚÙY
H›ÝÈ\\œ›ÜŠ	Õ\È^[Y[™[Z[™\ˆ\È[™XYH™Z[™È›ØÙ\ÜÙY‰ËJNÂˆÛÛœÝÜ\˜][Û’YH™\Ù\˜][Û‹›Ü\˜][Û’YÂˆÛÛœÝÜ˜\Ý\Y]H]K››ÝÊ
NÂˆÛÛœÝ[]™\žT™\Ý[ÈH]ØZ]X\^[Y[™[Z[™\˜]Ú\ÊÝ]›Ý[™˜]Ú\Ë\Þ[˜È
˜]Ú
HOˆÂˆÛÛœÝ˜]ÚÙ^R\ÚHÜ™X]R\Ú
	ÜÚLM‰ÊK\]J˜]Ú™Ü›Ý\šÙ^JK™YÙ\Ý
	Ú^	ÊNÂˆÛÛœÝ˜]Ú™\]Y\Ý\ÚH^[Y[™[Z[™\˜]Ú\Ú
ÂˆÙ^Nˆ˜]Ú™Ü›Ý\šÙ^KˆÝ[RYÎˆ˜]Ú™Ü›Ý\œ›ÝÜË›X\

›ÝÊHOˆ›ÝËœÝ[RY
KˆÎˆ˜]ÚËˆØÎˆ˜]Ú˜ØËˆ˜ØÎˆ˜]Ú˜˜ØËˆKÈÝXš™XÝˆ˜]Ú™[XZ[œÝXš™XÝ[ˆ˜]Ú™[XZ[š[JNÂˆÛÛœÝ™XÚ\Y[ÛÝ[H[š\]YQ[XZ[\Ý
˜]ÚË˜]Ú˜ØË˜]Ú˜˜ØÊK›[™ÝÂˆ]˜]Ú™\Ù\˜][ÛŽÂˆžHÂˆ˜]Ú™\Ù\˜][ÛˆH]ØZ]™\Ù\™T^[Y[™[Z[™\˜]Ú
XÝ]™PXØÙ\ÜË˜ÛY[ÂˆÜ\˜][Û’Yˆ˜]ÚÙ^R\Úˆ™\]Y\Ý\Úˆ˜]Ú™\]Y\Ý\ÚˆÝ[RYÎˆ˜]Ú™Ü›Ý\œ›ÝÜË›X\

›ÝÊHOˆ›ÝËœÝ[RY
Kˆ›ÝÐÛÝ[ˆ˜]Ú™Ü›Ý\œ›ÝÜË›[™Ýˆ™XÚ\Y[ÛÝ[ˆJNÂˆHØ]Ú
\œ›ÜŠHÂˆ™]\›ˆÈ‹‹˜˜]ÚÝ]\Îˆ	Ù˜Z[Y	Ë\œ›ÜÛÙNˆ	ÔVSQS•Ô‘SRS‘T—ÐUÒÔ‘TÑT•‘WÑRSQ	Ë\œ›Ü‹Ü˜\\ÎˆNÂˆBˆYˆ
˜]Ú™\Ù\˜][Û‹œ™\^JH™]\›ˆÈ‹‹˜˜]ÚÝ]\Îˆ	ØXØÙ\Y	Ë™\^NˆYK›ÝšY\”™\]Y\ÝYˆ˜]Ú™\Ù\˜][Û‹œ›ÝšY\”™\]Y\ÝYÜ˜\\ÎˆNÂˆYˆ
˜]Ú™\Ù\˜][Û‹[˜Ù\Z[ŠH™]\›ˆÈ‹‹˜˜]ÚÝ]\Îˆ	Ý[˜Ù\Z[‰Ë\œ›ÜÛÙNˆ	ÔVSQS•Ô‘SRS‘T—ÐUÒÕSÑT•RS‰ËÜ˜\\ÎˆNÂˆÛÛœÝ˜]ÚÝ\Y]H]K››ÝÊ
NÂˆžHÂˆÛÛœÝ™\Ý[H]ØZ]Ù[™Ü\˜][Û˜[XZ[
ÂˆÎˆ˜]ÚËØÎˆ˜]Ú˜ØË˜ØÎˆ˜]Ú˜˜ØËˆÝXš™XÝˆ˜]Ú™[XZ[œÝXš™XÝ[ˆ˜]Ú™[XZ[š[^ˆ˜]Ú™[XZ[^ˆKÂˆÛY[ˆXÝ]™PXØÙ\ÜË˜ÛY[\œÜÙRÙ^Nˆ	Ü^[Y[Ü™[Z[™\œÉËˆXZ[›ÞÛ˜\ÚÝˆÈYˆÙ[™\‹›XZ[›ÞY[XZ[Y™\ÜÎˆÙ[™\‹™[XZ[Y™\ÜÈKˆJNÂˆÛÛœÝÜ˜\\ÈH]K››ÝÊ
HH˜]ÚÝ\Y]Âˆ]ØZ]ÛÛ\]T^[Y[™[Z[™\˜]Ú
XÝ]™PXØÙ\ÜË˜ÛY[ÂˆÜ\˜][Û’Y˜]ÚÙ^R\ÚÝ]\Îˆ	ØXØÙ\Y	Ëˆ›ÝšY\”™\]Y\ÝYˆ™\Ý[šY™\Ý[›Y\ÜØYÙRY[Ü˜\\ËˆJNÂˆ™]\›ˆÈ‹‹˜˜]ÚÝ]\Îˆ	ØXØÙ\Y	Ë™\Ý[Ü˜\\ÈNÂˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÝÜ˜\\ÈH]K››ÝÊ
HH˜]ÚÝ\Y]ÂˆÛÛœÝ[˜Ù\Z[ˆH^[Y[™[Z[™\‘[]™\žU[˜Ù\Z[Š\œ›ÜŠNÂˆžHÂˆ]ØZ]ÛÛ\]T^[Y[™[Z[™\˜]Ú
XÝ]™PXØÙ\ÜË˜ÛY[ÂˆÜ\˜][Û’Y˜]ÚÙ^R\ÚÝ]\Îˆ[˜Ù\Z[ˆÈ	Ý[˜Ù\Z[‰Èˆ	Ù˜Z[Y	ËˆÜ˜\\Ë\œ›ÜÛÙNˆÝš[™Ê\œ›ÜË˜ÛÙH	ÔVSQS•Ô‘SRS‘T—ÑSU‘T–WÑRSQ	ÊKœÛXÙJL
KˆJNÂˆHØ]Ú
YÙ\‘\œ›ÜŠHÂˆÛÛœÛÛK™\œ›ÜŠ	ÖÜ^[Y[\™[Z[™\—H[]™\žHYÙ\ˆ\]H˜Z[Y	ËÈ™\]Y\ÝYˆ™\]Y\ÝYœ›ÛJ™\JKÛÙNˆYÙ\‘\œ›ÜË˜ÛÙH[JNÂˆ™]\›ˆÈ‹‹˜˜]ÚÝ]\Îˆ	Ý[˜Ù\Z[‰Ë\œ›ÜÛÙNˆ	ÔVSQS•Ô‘SRS‘T—ÓQÑT—ÕSÑT•RS‰Ë\œ›Ü‹Ü˜\\ÈNÂˆBˆÛÛœÛÛK™\œ›ÜŠ	ÖØ^Y\’[›ÚXÙT^[Y[™[Z[™\”Ù[™H[XZ[›ÝšY\ˆ˜Z[Y	ËÂˆÛÙNˆÝš[™Ê\œ›ÜË˜ÛÙH\œ›ÜË›˜[YH	Ü›ÝšY\—Ù\œ›Ü‰ÊKœÛXÙJ
Kˆ›ÝšY\ŽˆÜ\˜][Û˜[XZ[ÛÛ™šYÊ
K™[]™\žSY]ÙˆÐÛÝ[ˆ˜]ÚË›[™ÝØÐÛÝ[ˆ˜]Ú˜ØË›[™Ý˜ØÐÛÝ[ˆ˜]Ú˜˜ØË›[™Ýˆ›ÝÜÎˆ˜]Ú™Ü›Ý\œ›ÝÜË›[™Ý›Ý][™Ó[ÙNˆ˜]Ú™Ü›Ý\›[ÙKˆJNÂˆ™]\›ˆÈ‹‹˜˜]ÚÝ]\Îˆ[˜Ù\Z[ˆÈ	Ý[˜Ù\Z[‰Èˆ	Ù˜Z[Y	Ë\œ›ÜÛÙNˆ\œ›ÜË˜ÛÙH[\œ›Ü‹Ü˜\\ÈNÂˆBˆKÊNÂˆÛÛœÝÜ˜\\ÈH]K››ÝÊ
HHÜ˜\Ý\Y]ÂˆÛÛœÝXØÙ\YH[]™\žT™\Ý[Ë™š[\Š
][JHOˆ][KœÝ]\ÈOOH	ØXØÙ\Y	ÊNÂˆÛÛœÝ˜Z[YH[]™\žT™\Ý[Ë™š[\Š
][JHOˆ][KœÝ]\ÈOOH	Ù˜Z[Y	ÊNÂˆÛÛœÝ[˜Ù\Z[ˆH[]™\žT™\Ý[Ë™š[\Š
][JHOˆ][KœÝ]\ÈOOH	Ý[˜Ù\Z[‰ÊNÂˆÛÛœÝ™U[Y[[™TÝ]\ÈH[˜Ù\Z[‹›[™ÝÈ	Ý[˜Ù\Z[‰ÈˆXØÙ\Y›[™ÝOOHÝ]›Ý[™˜]Ú\Ë›[™ÝÈ	ØXØÙ\Y	ÈˆXØÙ\Y›[™ÝÈ	Ü\X[	Èˆ	Ù˜Z[Y	ÎÂˆ]ØZ]ÛÛ\]T^[Y[™[Z[™\“Ü\˜][ÛŠXÝ]™PXØÙ\ÜË˜ÛY[ÂˆÜ\˜][Û’YˆÝ]\Îˆ™U[Y[[™TÝ]\ËˆXØÙ\Y˜]ÚÛÝ[ˆXØÙ\Y›[™Ýˆ˜Z[Y˜]ÚÛÝ[ˆ˜Z[Y›[™Ýˆ[Y[[™T™XÛÜ™Yˆ˜[ÙKˆ™\\™S\Îˆ[X™\Š™]šY]Ëœ™\\™S\È
K˜[Y][Û“\ËÜ˜\\Ë[Y[[™S\Îˆˆ\œ›ÜÛÙNˆ[˜Ù\Z[–ÌOË™\œ›ÜÛÙH˜Z[YÌOË™\œ›ÜÛÙH[ˆJNÂ‚ˆÛÛœÝÛÛXÝ[Û•Ø\›š[™ÜÈH×NÂˆ]ÛÛXÝ[Û”™\Ý[ÈH×NÂˆ][Y[[™S\ÈHÂˆYˆ
XØÙ\Y›[™Ý
HÂˆÛÛœÝ[Y[[™TÝ\Y]H]K››ÝÊ
NÂˆÛÛœÝ[Y[[™T›ÝÜÈHXØÙ\Y™›]X\

][JHOˆÂˆÛÛœÝ™XÚ\Y[ÛÝ[H[š\]YQ[XZ[\Ý
][KË][K˜ØË][K˜˜ØÊK›[™ÝÂˆÛÛœÝ›ÝHHØ^[Y[™[Z[™\ˆXØÙ\YžHZXÜ›ÜÛÙÜ˜\˜™XÚ\Y[Îˆ	Ü™XÚ\Y[ÛÝ[X›Ý][™Îˆ	Ú][K™Ü›Ý\›[Ù_X[˜ÛYY[›ÚXÙ\Îˆ	Ú][K™Ü›Ý\œ›ÝÜË›[™ÝXKš›Ú[Š	×‰ÊNÂˆÛÛœÝÝXš™XÝ\ÚHÜ™X]R\Ú
	ÜÚLM‰ÊK\]J][K™[XZ[œÝXš™XÝ
K™YÙ\Ý
	Ú^	ÊNÂˆ™]\›ˆ][K™Ü›Ý\œ›ÝÜË›X\

›ÝÊHOˆ
ÂˆÝ[RYˆ›ÝËœÝ[RYˆÝÛ™\“˜[YNˆ›ÝË˜ÛÛXÝ[ÛË›ÝÛ™\“˜[YHÜ]^Y\•˜Y\“˜[Y\Ê›ÝË˜^Y\•˜Y\’[Ú\™ÙJVÌH	ÉËˆ›ÝK™XÚ\Y[ÛÝ[ÝXš™XÝ\ÚˆJJNÂˆJNÂˆžHÂˆÛÛœÝØ]™YH]ØZ]Ø]™T^[Y[™[Z[™\•[Y[[™JXÝ]™PXØÙ\ÜË˜ÛY[ÂˆÜ\˜][Û’Y›ÝÜÎˆ[Y[[™T›ÝÜËˆXÝÜ•\Ù\’YˆXÝ]™PXØÙ\ÜËœ›Ùš[KšYXÝÜ‘[XZ[ˆXÝ]™PXØÙ\ÜËœ›Ùš[K™[XZ[ˆJNÂˆÛÛXÝ[Û”™\Ý[ÈH
\œ˜^Kš\Ð\œ˜^JØ]™Y
HÈØ]™Yˆ×JK›X\

][JHOˆ
Âˆ][NˆÙ\šX[^™PÛÛXÝ[Û’][J][OËš][JKˆ]™[ˆÙ\šX[^™PÛÛXÝ[Û‘]™[
][OË™]™[
KˆJJNÂˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛK™\œ›ÜŠ	ÖÜ^[Y[\™[Z[™\—H]ÛZXÈ[Y[[™H\]H˜Z[Y	ËÈ™\]Y\ÝYˆ™\]Y\ÝYœ›ÛJ™\JKÛÙNˆ\œ›ÜË˜ÛÙH[JNÂˆÛÛXÝ[Û•Ø\›š[™ÜËœ\Ú
È\œ›ÜŽˆ	ÕH™[Z[™\ˆØ\ÈÙ[]ÓÔÈÚ[™\Z\ˆ]ÈÛÛXÝ[Ûˆ[Y[[™H\š[™È™XÛÛ˜Ú[X][Û‹‰ÈJNÂˆBˆ[Y[[™S\ÈH]K››ÝÊ
HH[Y[[™TÝ\Y]ÂˆB‚ˆÛÛœÝÛÛ\]YHXØÙ\Y›[™ÝOOHÝ]›Ý[™˜]Ú\Ë›[™Ý	‰ˆÛÛXÝ[Û•Ø\›š[™ÜË›[™ÝOOHÂˆÛÛœÝš[˜[Ý]\ÈHÛÛ\]YÈ	ØÛÛ\]Y	Èˆ™U[Y[[™TÝ]\ÎÂˆÛÛœÝ™YXÝY™\Ý[HÂˆÜ\˜][Û’Yˆ[XZ[ÎˆXØÙ\Y›[™Ýˆ›ÝÜÎˆXØÙ\Yœ™YXÙJ
Ý[K][JHOˆÝ[H
È][K™Ü›Ý\œ›ÝÜË›[™Ý
Kˆ™XÚ\Y[ÛÝ[ˆXØÙ\Yœ™YXÙJ
Ý[K][JHOˆÝ[H
È[š\]YQ[XZ[\Ý
][KË][K˜ØË][K˜˜ØÊK›[™Ý
KˆXØÙ\Y˜]ÚÛÝ[ˆXØÙ\Y›[™Ýˆ˜Z[Y˜]ÚÛÝ[ˆ˜Z[Y›[™Ýˆ[˜Ù\Z[˜]ÚÛÝ[ˆ[˜Ù\Z[‹›[™ÝˆNÂˆ]ØZ]ÛÛ\]T^[Y[™[Z[™\“Ü\˜][ÛŠXÝ]™PXØÙ\ÜË˜ÛY[ÂˆÜ\˜][Û’YÝ]\Îˆš[˜[Ý]\ËˆXØÙ\Y˜]ÚÛÝ[ˆXØÙ\Y›[™Ý˜Z[Y˜]ÚÛÝ[ˆ˜Z[Y›[™Ýˆ[Y[[™T™XÛÜ™YˆÛÛXÝ[Û•Ø\›š[™ÜË›[™ÝOOHˆ™\\™S\Îˆ[X™\Š™]šY]Ëœ™\\™S\È
K˜[Y][Û“\ËÜ˜\\Ë[Y[[™S\Ëˆ™\Ý[Û˜\ÚÝˆ™YXÝY™\Ý[ˆ\œ›ÜÛÙNˆ[˜Ù\Z[–ÌOË™\œ›ÜÛÙH˜Z[YÌOË™\œ›ÜÛÙH[ˆJNÂ‚ˆYˆ
XXØÙ\Y›[™Ý
HÂˆÛÛœÝš\œÝ\œ›ÜˆH[˜Ù\Z[–ÌOË™\œ›Üˆ˜Z[YÌOË™\œ›ÜŽÂˆYˆ
[˜Ù\Z[‹›[™Ý
H›ÝÈ\\œ›ÜŠ	ÓZXÜ›ÜÛÙÜ˜\[]™\žHÛÝ[›Ý™HÛÛ™š\›YYˆ™\šYžHÙ[][\È™Y›Ü™H™]žZ[™Ë‰ËJNÂˆ›ÝÈš\œÝ\œ›Üˆ\\œ›ÜŠ	ÓZXÜ›ÜÛÙÜ˜\™Z™XÝY]™\žH^[Y[™[Z[™\ˆ˜]Ú‰ËLŠNÂˆB‚ˆØZ][[
›ÛZ\ÙKœ™\ÛÛ™J
K[Š

HOˆÂˆ^\™T[[YPØXÚUYÜÊÉÜØ[\Ù›Ü˜ÙN˜^Y\‹Z[›ÚXÙ\É×JNÂˆJK˜Ø]Ú


HOˆßJJNÂˆ™]\›ˆÂˆÙ[ˆÛÛ\]Yˆ\X[ˆXÛÛ\]YˆÜ\˜][Û’YˆYˆXØÙ\YÌOËœ™\Ý[ËšYXØÙ\YÌOËœ›ÝšY\”™\]Y\ÝY[ˆ[XZ[ÎˆXØÙ\Y›[™Ýˆ˜]Ú\ÎˆXØÙ\Y›X\

][JHOˆ
ÂˆÎˆ][KËØÎˆ][K˜ØË˜ØÎˆ][K˜˜ØËˆÝXš™XÝˆ][K™[XZ[œÝXš™XÝ›ÝÜÎˆ][K™Ü›Ý\œ›ÝÜË›[™Ý[ÙNˆ][K™Ü›Ý\›[ÙKˆJJKˆ˜Z[Y˜]Ú\ÎˆË‹‹™˜Z[Y‹‹[˜Ù\Z[—K›X\

][JHOˆ
ÂˆÙ^Nˆ][K™Ü›Ý\šÙ^K[ÙNˆ][K™Ü›Ý\›[ÙK›ÝÜÎˆ][K™Ü›Ý\œ›ÝÜË›[™ÝˆÝ]\Îˆ][KœÝ]\Ë\œ›ÜÛÙNˆ][K™\œ›ÜÛÙH[ˆJJKˆÎˆ[š\]YQ[XZ[\Ý
‹‹˜XØÙ\Y›X\

][JHOˆ][KÊJKˆØÎˆ[š\]YQ[XZ[\Ý
‹‹˜XØÙ\Y›X\

][JHOˆ][K˜ØÊJKˆ˜ØÎˆ[š\]YQ[XZ[\Ý
‹‹˜XØÙ\Y›X\

][JHOˆ][K˜˜ØÊJKˆÝXš™XÝˆXØÙ\YÌOË™[XZ[œÝXš™XÝ[ˆ›ÝÜÎˆXØÙ\Yœ™YXÙJ
Ý[K][JHOˆÝ[H
È][K™Ü›Ý\œ›ÝÜË›[™Ý
KˆÛÛXÝ[Û”™\Ý[ËˆÛÛXÝ[Û•Ø\›š[™ÜËˆ[Z[™ÜÎˆÈ™\\™S\Îˆ[X™\Š™]šY]Ëœ™\\™S\È
K˜[Y][Û“\ËÜ˜\\Ë[Y[[™S\ÈKˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÝ\^Y\’[›ÚXÙQ[XZ[[ŠÚ[™ÝÊHÂˆÛÛœÝÛY[HØY™TÝ\X˜\ÙPYZ[ÛY[

NÂˆYˆ
XÛY[
H™]\›ˆÈ[ÝÙYˆYK[Žˆ[NÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ø^Y\—Ú[›ÚXÙWÙ[XZ[Ü[œÉÊBˆš[œÙ\
Âˆ[—ÚÙ^NˆÚ[™ÝËœ[’Ù^KˆØÚY[WÝ[YNˆÚ[™ÝË[YKˆÝ]\Îˆ	Ü[›š[™ÉËˆJBˆœÙ[XÝ
	ÚY[—ÚÙ^KÝ]\ËÜ™X]YØ]	ÊBˆœÚ[™ÛJ
NÂˆYˆ
\œ›ÜË˜ÛÙHOOH	ÌŒÍLIÊH™]\›ˆÈ[ÝÙYˆ˜[ÙK\XØ]NˆYHNÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ™]\›ˆÈ[ÝÙYˆYK[Žˆ]HNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆš[š\Ú^Y\’[›ÚXÙQ[XZ[[Š[’Ù^K]ÚHßJHÂˆÛÛœÝÛY[HØY™TÝ\X˜\ÙPYZ[ÛY[

NÂˆYˆ
XÛY[\[’Ù^JH™]\›ŽÂˆÛÛœÝÈ\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ø^Y\—Ú[›ÚXÙWÙ[XZ[Ü[œÉÊBˆ\]JÂˆ‹‹œ]ÚˆÛÛ\]YØ]ˆ™]È]J
KÒTÓÔÝš[™Ê
KˆJBˆ™\J	Ü[—ÚÙ^IË[’Ù^JNÂˆYˆ
\œ›ÜŠHÛÛœÛÛK™\œ›ÜŠ	Ñ˜Z[YÈ\]H^Y\ˆ[›ÚXÙH[XZ[[‰Ë\œ›Ü‹›Y\ÜØYÙJNÂŸB‚™[˜Ý[Ûˆ™\]Z\™PÜ›Û]]Üš^˜][ÛŠ™\JHÂˆÛÛœÝÙXÜ™]H›ØÙ\ÜË™[‹Ô“Ó—ÔÑPÔ‘UÂˆYˆ
\ÙXÜ™]
H›ÝÈ\\œ›ÜŠ	ÓZ\ÜÚ[™ÈÔ“Ó—ÔÑPÔ‘U[ˆ™\˜Ù[‰ËL
NÂˆÛÛœÝXY\ˆH™\OËšXY\œÏË˜]]Üš^˜][Ûˆ™\OËšXY\œÏË]]Üš^˜][Ûˆ	ÉÎÂˆYˆ
Ýš[™ÊXY\ŠHOOH™X\™\ˆ	ÜÙXÜ™]X
H›ÝÈ\\œ›ÜŠ	Õ[˜]]Üš^™YÜ›Ûˆ™\]Y\Ý‰ËJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÝ]Ý[™[™Ð^Y\’[›ÚXÙ\Ñ[XZ[™\Ü
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝXÝ]™PXØÙ\ÜÈHXØÙ\ÜÐÛÛ^
›ÙKœØÚY[YÈ[ˆ]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝ[]™\žPÛY[HXÝ]™PXØÙ\ÜÏË˜ÛY[ØY™TÝ\X˜\ÙPYZ[ÛY[

NÂˆYˆ
Y[]™\žPÛY[
H›ÝÈ\\œ›ÜŠ	ÑÓÔÈ]X˜\ÙHXØÙ\ÜÈ\È[˜]˜Z[X›H›ÜˆH[\›˜[™\Ü‰ËLÊNÂˆÛÛœÝÝÜ™YH]ØZ]ØYÝÜ™Y^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊ
NÂˆYˆ

X›ÙKœ™]šY]È	‰ˆX›ÙK™žT[ŠH	‰ˆÝÜ™Y›Y]K˜ÛÛ™šYÝ\™YOOHYJHÂˆ›ÝÈ\\œ›ÜŠ	ÓÝ]Ý[™[™È^Y\ˆ[›ÚXÙH™\Ü™XÚ\Y[È\™H›ÝÛÛ™šYÝ\™YˆÙ[™[™È\È\ØX›Y‰ËLË	Ñ’SSÒPSÔ‘TÔ•Ó“ÕÐÓÓ‘’QÕT‘Q	Ë[™Yš[™YYJNÂˆBˆYˆ
X›ÙKœ™]šY]È	‰ˆX›ÙK™žT[ˆ	‰ˆ
TÝš[™ÊÝÜ™YœÙ][™ÜÏËœÝXš™XÝ	ÉÊKš[J
HTÝš[™ÊÝÜ™YœÙ][™ÜÏËš[›È	ÉÊKš[J
JJHÂˆ›ÝÈ\\œ›ÜŠ	ÓÝ]Ý[™[™È^Y\ˆ[›ÚXÙH™\ÜÝXš™XÝ[™›ÙH\™H›ÝÛÛ™šYÝ\™YˆÙ[™[™È\È\ØX›Y‰ËLË	Ñ’SSÒPSÔ‘TÔ•ÕSTUWÓ“ÕÐÓÓ‘’QÕT‘Q	Ë[™Yš[™YYJNÂˆBˆÛÛœÝÙ][™ÜÈHÂˆ‹‹˜^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊÝÜ™YœÙ][™ÜÊKˆ\Ð^Y\•˜Y\‘š[\Žˆ
ÝÜ™YœÙ][™ÜË˜^Y\•˜Y\œÈ×JK›[™ÝˆˆNÂˆYˆ
X›ÙKœ™]šY]È	‰ˆX›ÙK™žT[ˆ	‰ˆX›ÙK™›Ü˜ÙH	‰ˆZ\Ð^Y\’[›ÚXÙT™\ÜYJÙ][™ÜÊJHÂˆ™]\›ˆÂˆÙ[ˆ˜[ÙKˆÚÚ\YˆYKˆ™X\ÛÛŽˆ	ÐÝ\œ™[Û™ÈÛÛ™È[YH\ÈÝ]ÚYHHÛÛ™šYÝ\™Y™\ÜØÚY[K‰ËˆØÚY[NˆÂˆÙYZÙ^\ÎˆÙ][™ÜËÙYZÙ^\ËˆÙ[™[Y\ÎˆÙ][™ÜËœÙ[™[Y\Ëˆ›ÝÎˆÛ™ÒÛÛ™ÔØÚY[T\Ê
KˆKˆNÂˆBˆÛÛœÝ™\Ü^[ØYHÈ^\ÐZXYˆÙ][™ÜË™^\ÐZXYNÂˆYˆ
Ù][™ÜËš\Ð^Y\•˜Y\‘š[\ŠH™\Ü^[ØY˜^Y\•˜Y\œÈHÙ][™ÜË˜^Y\•˜Y\œÎÂˆYˆ
X›ÙKœ™]šY]È	‰ˆX›ÙK™žT[ŠH™\Ü^[ØY™›Ü˜ÙHHYNÂˆÛÛœÝ™\ÜH]ØZ]Ø[\Ù›Ü˜ÙP^Y\’[›ÚXÙ\ÑYJ™\Ü^[ØY[XÝ]™PXØÙ\ÜÊNÂˆÛÛœÝ[XZ[HZ[^Y\’[›ÚXÙT™\Ü[XZ[
™\ÜÙ][™ÜÊNÂˆYˆ
›ÙKœ™]šY]È›ÙK™žT[ŠHÂˆ]ØZ]\]P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÓY]JÂˆ\ÝÜ™]šY]×Ø]ˆ™]È]J
KÒTÓÔÝš[™Ê
Kˆ\ÝÜ™]šY]×Ü›Ý×ØÛÝ[ˆ™\Üœ›ÝÜË›[™Ýˆ\ÝÙ\œ›ÜŽˆ[ˆJNÂˆ™]\›ˆÂˆÙ[ˆ˜[ÙKˆ™]šY]ÎˆYKˆÙ][™ÜÎˆÈ‹‹œÙ][™ÜËÎˆÙ][™ÜËËØÎˆÙ][™ÜË˜ØÈKˆ™\ÜˆÂˆ›ÝÜÎˆ™\Üœ›ÝÜËˆÙ^Nˆ™\ÜÙ^KˆYU›ÝYÚˆ™\Ü™YU›ÝYÚˆ^\ÐZXYˆ™\Ü™^\ÐZXYˆ^Y\•˜Y\“Ü[ÛœÎˆ™\Ü˜^Y\•˜Y\“Ü[ÛœËˆÙ[XÝY^Y\•˜Y\œÎˆ™\ÜœÙ[XÝY^Y\•˜Y\œËˆ\Ð^Y\•˜Y\‘š[\Žˆ™\Üš\Ð^Y\•˜Y\‘š[\‹ˆKˆ[XZ[ˆÂˆÝXš™XÝˆ[XZ[œÝXš™XÝˆ[ˆ[XZ[š[ˆ^ˆ[XZ[^ˆÝ[Îˆ[XZ[Ý[ËˆKˆNÂˆBˆ]™\Ý[ÂˆžHÂˆ™\Ý[H]ØZ]Ù[™Ü\˜][Û˜[XZ[
ÂˆÎˆÙ][™ÜËËˆØÎˆÙ][™ÜË˜ØËˆ˜ØÎˆÙ][™ÜË˜˜ØËˆÝXš™XÝˆ[XZ[œÝXš™XÝˆ[ˆ[XZ[š[ˆ^ˆ[XZ[^ˆKÈÛY[ˆ[]™\žPÛY[\œÜÙRÙ^Nˆ	ÛÝ]Ý[™[™×Ú[›ÚXÙWÜ™\ÜÉÈJNÂˆHØ]Ú
\œ›ÜŠHÂˆ]ØZ]\]P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÓY]JÈ\ÝÙ\œ›ÜŽˆ\œ›Ü‹›Y\ÜØYÙHJNÂˆ›ÝÈ\œ›ÜŽÂˆBˆ]ØZ]\]P^Y\’[›ÚXÙQ[XZ[Ù][™ÜÓY]JÂˆ\ÝÜÙ[Ø]ˆ™]È]J
KÒTÓÔÝš[™Ê
Kˆ\ÝÜÙ[Ü›Ý×ØÛÝ[ˆ™\Üœ›ÝÜË›[™Ýˆ\ÝÙ\œ›ÜŽˆ[ˆJNÂˆ™]\›ˆÂˆÙ[ˆYKˆYˆ™\Ý[šYˆÎˆÙ][™ÜËËˆØÎˆÙ][™ÜË˜ØËˆ˜ØÎˆÙ][™ÜË˜˜ØËˆÝXš™XÝˆ[XZ[œÝXš™XÝˆ›ÝÜÎˆ™\Üœ›ÝÜË›[™ÝˆÝ[Îˆ[XZ[Ý[ËˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÝ]Ý[™[™Ð^Y\’[›ÚXÙ\Ñ[XZ[Ü›ÛŠ›ÙK™\JHÂˆ™\]Z\™PÜ›Û]]Üš^˜][ÛŠ™\JNÂˆYˆ
Z\Ñ^\›˜[XÝ[Û‘[˜X›Y
	Ù[XZ[Ù[]™\žIÊJHÂˆ™]\›ˆÂˆÙ[ˆ˜[ÙKˆÚÚ\YˆYKˆØ]YˆYKˆ™X\ÛÛŽˆ	ÔØÚY[Y[XZ[[]™\žH\È™Y[ˆ]\ÙYžH[ˆ[Y\™Ù[˜ÞHÜ\˜][Û˜[ÛÛ›Û‰ËˆNÂˆBˆÛÛœÝÝÜ™YH]ØZ]ØYÝÜ™Y^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊ
NÂˆYˆ
ÝÜ™Y›Y]KœÝÜ˜YÙP]˜Z[X›HOOHYJHÂˆ›ÝÈ\\œ›ÜŠ	Ð^Y\ˆ[›ÚXÙH[XZ[Ù][™ÜÈ\™H[\Ü˜\š[H[˜]˜Z[X›KˆØÚY[Y™\ÜÙ[™[™È\È\ØX›Y[[ÝÜ˜YÙH\È™\ÝÜ™Y‰ËLÊNÂˆBˆÛÛœÝÙ][™ÜÈHÂˆ‹‹˜^Y\’[›ÚXÙQ[XZ[Ù][™ÜÊÝÜ™YœÙ][™ÜÊKˆ\Ð^Y\•˜Y\‘š[\Žˆ
ÝÜ™YœÙ][™ÜË˜^Y\•˜Y\œÈ×JK›[™ÝˆˆNÂˆYˆ
Ù][™ÜË™[˜X›YOOH˜[ÙJBˆ™]\›ˆÂˆÙ[ˆ˜[ÙKˆÚÚ\YˆYKˆ™X\ÛÛŽˆ	Ñ[XZ[ØÚY[H\È\ØX›Y‰ËˆNÂ‚ˆÛÛœÝÚ[™ÝÈH^Y\’[›ÚXÙTØÚY[YÚ[™ÝÊÙ][™ÜÊNÂˆYˆ
]Ú[™ÝÊHÂˆ™]\›ˆÂˆÙ[ˆ˜[ÙKˆÚÚ\YˆYKˆ™X\ÛÛŽˆ	ÐÝ\œ™[Û™ÈÛÛ™È[YH\ÈÝ]ÚYHHÛÛ™šYÝ\™Y™\ÜØÚY[K‰ËˆØÚY[NˆÂˆÙYZÙ^\ÎˆÙ][™ÜËÙYZÙ^\ËˆÙ[™[Y\ÎˆÙ][™ÜËœÙ[™[Y\Ëˆ›ÝÎˆÛ™ÒÛÛ™ÔØÚY[T\Ê
KˆKˆNÂˆB‚ˆÛÛœÝ[ˆH]ØZ]Ý\^Y\’[›ÚXÙQ[XZ[[ŠÚ[™ÝÊNÂˆYˆ
\[‹˜[ÝÙY
Bˆ™]\›ˆÂˆÙ[ˆ˜[ÙKˆÚÚ\YˆYKˆ\XØ]NˆYKˆ[’Ù^NˆÚ[™ÝËœ[’Ù^KˆNÂ‚ˆžHÂˆÛÛœÝ™\Ý[H]ØZ]Ý]Ý[™[™Ð^Y\’[›ÚXÙ\Ñ[XZ[™\Ü
ÂˆÙ][™ÜËˆ›Ü˜ÙNˆYKˆØÚY[YˆYKˆJNÂˆ]ØZ]š[š\Ú^Y\’[›ÚXÙQ[XZ[[ŠÚ[™ÝËœ[’Ù^KÂˆÝ]\Îˆ	ÜÙ[	Ëˆ›ÝÜ×ØÛÝ[ˆ™\Ý[œ›ÝÜËˆÝ[Îˆ™\Ý[Ý[ÈßKˆ›ÝšY\—Ü™\Ý[ˆÂˆYˆ™\Ý[šY[ˆÎˆ™\Ý[È×KˆØÎˆ™\Ý[˜ØÈ×KˆÝXš™XÝˆ™\Ý[œÝXš™XÝ[ˆKˆJNÂˆ™]\›ˆÈ‹‹œ™\Ý[ØÚY[YˆYK[’Ù^NˆÚ[™ÝËœ[’Ù^HNÂˆHØ]Ú
\œ›ÜŠHÂˆ]ØZ]š[š\Ú^Y\’[›ÚXÙQ[XZ[[ŠÚ[™ÝËœ[’Ù^KÂˆÝ]\Îˆ	Ù˜Z[Y	Ëˆ\œ›ÜŽˆ\œ›Ü‹›Y\ÜØYÙKˆJNÂˆ›ÝÈ\œ›ÜŽÂˆBŸB‚˜\Þ[˜È[˜Ý[ÛˆØ[\Ù›Ü˜ÙQ\Ü]TÝ[\Ê›ÙK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝ[Z]HX]›X^
LX]›Z[Š[X™\Š›ÙK›[Z]
HLL
JNÂˆÛÛœÝ™\]Y\ÝYÝ[RYH\ÔØ[\Ù›Ü˜ÙRY
Ýš[™Ê›ÙKœÝ[RY	ÉÊKš[J
JHÈÝš[™Ê›ÙKœÝ[RY
Kš[J
Hˆ[ÂˆÛÛœÝÙ\ØÜšX™KXØÛÝ[\ØÜšX™WHH]ØZ]›ÛZ\ÙK˜[
ÂˆØ[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	ÜÝ[W×ØÉÈJKˆØ[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	ÐXØÛÝ[	ÈJKˆJNÂˆÛÛœÝšY[˜[Y\ÈH\ØÜšX™K™šY[Ë›X\

ŠHOˆ‹›˜[YJNÂˆÛÛœÝ\Ü]PXØÛÝ[šY[ÈH™]ÈÙ]

XØÛÝ[\ØÜšX™K™šY[È×JK›X\

šY[
HOˆšY[›˜[YJJNÂˆYˆ
Y\Ü]PXØÛÝ[šY[Ëš\Ê	Ò[˜XÝ]™WÔÝ\Ü[™Y×ØÉÊJHÂˆ›ÝÈ\\œ›ÜŠ	Ñ\Ü]HXØÛÝ[\ØÛÝ™\žHØ[››Ý™\šYžHXÝ]™HØ[\Ù›Ü˜ÙHXØÛÝ[Ë‰ËLË	ÑTÔUWÐPÐÓÕS•ÔÕUT×ÔÐÒSPIË[™Yš[™YYJNÂˆBˆÛÛœÝ[\›Ù™šXÙPÛÛ™][ÛˆH]ØZ][\›Ù™šXÙTÝ[PXØÙ\ÜÐÛÛ™][ÛŠXØÙ\ÜÐÛÛ^šY[˜[Y\ÊNÂˆÛÛœÝ\Ñ\Ü]HHšY[˜[Y\Ëš[˜ÛY\Ê	Ñ\Ü]W×ØÉÊNÂˆÛÛœÝ\Ñ\Ü]TÝ]\ÈHšY[˜[Y\Ëš[˜ÛY\Ê	Ñ\Ü]WÔÝ]\××ØÉÊNÂˆYˆ
Z\Ñ\Ü]H	‰ˆZ\Ñ\Ü]TÝ]\ÊH™]\›ˆÈ›ÝÜÎˆ×HNÂˆÛÛœÝÝ\Y\’[›ÚXÙQ\ØÜšX™HH]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÂˆØš™XÝ˜[YNˆ	ÔÝ\Y\—Ò[›ÚXÙW×ØÉËˆJK˜Ø]Ú


HOˆ
ÈšY[Îˆ×HJJNÂˆÛÛœÝÝ\Y\’[›ÚXÙQšY[ÈHÝ\Y\’[›ÚXÙQ\ØÜšX™K™šY[È×NÂˆÛÛœÝÝ\Y\’[›ÚXÙQšY[˜[Y\ÈHÝ\Y\’[›ÚXÙQšY[Ë›X\

ŠHOˆ‹›˜[YJNÂˆÛÛœÝÝ\Y\’[›ÚXÙQšY[žS˜[YHHØš™XÝ™œ›ÛQ[šY\ÊÝ\Y\’[›ÚXÙQšY[Ë›X\

šY[
HOˆÙšY[›˜[YKšY[JJNÂˆÛÛœÝ^[Y[\ØÜšX™HH]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÂˆØš™XÝ˜[YNˆ	Ô^[Y[×ØÉËˆJK˜Ø]Ú


HOˆ
ÈšY[Îˆ×HJJNÂˆÛÛœÝ^[Y[šY[ÈH^[Y[\ØÜšX™K™šY[È×NÂˆÛÛœÝ^[Y[šY[˜[Y\ÈH™]ÈÙ]
^[Y[šY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝÝ\Y\”Ù][Y[ØÚ[XHH™\ÛÛ™TÝ\Y\”Ù][Y[ØÚ[XJÂˆÝ\Y\’[›ÚXÙQšY[Ëˆ^[Y[šY[ËˆJNÂˆÛÛœÝÝ\Y\’[›ÚXÙT^XX›QšY[HÝ\Y\”Ù][Y[ØÚ[XKš[›ÚXÙT^XX›QšY[ÂˆÛÛœÝÝ\Y\’[›ÚXÙP[[Ý[šY[ÈHÝ\Y\”Ù][Y[ØÚ[XKš[›ÚXÙP[[Ý[šY[ÈÜÝ\Y\”Ù][Y[ØÚ[XKš[›ÚXÙP[[Ý[šY[Hˆ×NÂˆÛÛœÝÝ\Y\’[›ÚXÙQYQ]QšY[ÈHÝ\Y\”Ù][Y[ØÚ[XKš[›ÚXÙQYQ]QšY[ÎÂˆÛÛœÝÝ\Y\’[›ÚXÙQ]QšY[ÈHÝ\Y\”Ù][Y[ØÚ[XKš[›ÚXÙQ]QšY[ÎÂˆÛÛœÝÝ\Y\’[›ÚXÙTÝ]\ÑšY[ÈHÝ\Y\”Ù][Y[ØÚ[XKš[›ÚXÙTÝ]\ÑšY[ÎÂˆÛÛœÝÝ\Y\’[›ÚXÙTÝ\Y\‘šY[ÈHÝ\Y\”Ù][Y[ØÚ[XKœÝ\Y\XØÛÝ[šY[ÎÂˆÛÛœÝÝ\Y\’[›ÚXÙTÝ\Y\“˜[YT™[][ÛœÚ\ÈHÝ\Y\’[›ÚXÙTÝ\Y\‘šY[Ë›X\

šY[
HOˆÝ\Y\’[›ÚXÙQšY[žS˜[YVÙšY[OËœ™[][ÛœÚ\˜[YJK™š[\Š›ÛÛX[ŠNÂˆÛÛœÝ[™R][Q\ØÜšX™HH]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÂˆØš™XÝ˜[YNˆ	ÔÕSWÓ[™WÒ][W×ØÉËˆJK˜Ø]Ú


HOˆ
ÈšY[Îˆ×HJJNÂˆÛÛœÝÜšYÚ[˜[Ý\Y\“ÛÚÝ\H™\ÛÛ™SÜšYÚ[˜[Ý\Y\“ÛÚÝ\
[™R][Q\ØÜšX™K™šY[È×JNÂˆÛÛœÝÜšYÚ[˜[Ý\Y\”™[][ÛœÚ\HÜšYÚ[˜[Ý\Y\“ÛÚÝ\œ™[][ÛœÚ\˜[YH	ÓÜšYÚ[˜[ÔÝ\Y\—×Ü‰ÎÂˆÛÛœÝ^˜PÛÜÝ\ØÜšX™HH]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÂˆØš™XÝ˜[YNˆ	ÔÕSWÑ^˜WÐÛÜÝ×ØÉËˆJK˜Ø]Ú


HOˆ
ÈšY[Îˆ×HJJNÂˆÛÛœÝ^˜PÛÜÝšY[ÈH^˜PÛÜÝ\ØÜšX™K™šY[È×NÂˆÛÛœÝ^˜PÛÜÝšY[˜[Y\ÈH™]ÈÙ]
^˜PÛÜÝšY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝ^˜PÛÜÝÝ\Y\“ÛÚÝ\H™\ÛÛ™Q^˜PÛÜÝÝ\Y\“ÛÚÝ\
^˜PÛÜÝšY[ÊNÂˆÛÛœÝ^˜PÛÜÝÝ\Y\‘šY[H^˜PÛÜÝÝ\Y\“ÛÚÝ\™šY[˜[YNÂˆÛÛœÝ^˜PÛÜÝÝ\Y\”™[][ÛœÚ\H^˜PÛÜÝÝ\Y\“ÛÚÝ\œ™[][ÛœÚ\˜[YNÂ‚ˆÛÛœÝšY[ÈHÉÒY	Ë	Ó˜[YIË	ÐÜ™X]Y]IË	Ó\Ý[ÙYšYY]I×NÂˆ›Üˆ
ÛÛœÝšY[ÙˆÉÒÙ^TÝ[W×ØÉË	Ñ[]™\žWÑ]W×ØÉË	Ñ^XÝYÑ[]™\žWÑ]W×ØÉË	ÑUWÔÝ\Ñ]W×ØÉË	Ð^Y\—Ô^WÕ\›WÑ]W×ØÉË	Ò[›ÚXÙWÑYWÑ]W×ØÉË	ÑYWÑ]W×ØÉË	Ð^Y\—Ó˜[YW×ØÉË	Ð^Y\—×ØÉË	ÐXØÛÝ[×ØÉË	Ñ\Ü]W×ØÉË	Ñ\Ü]WÔÝ]\××ØÉË	ÕÝ[Ò[›ÚXÙWÐ[[Ý[×ØÉË	ÕÝ[Ò[›ÚXÙYÐ[[Ý[Ñœ›ÛWÔÝ\Y\œ××ØÉË	Ô^XX›WÐ˜[[˜ÙW×ØÉË	Ô™XÙZ]˜X›WÐ˜[[˜ÙW×ØÉË	ÔSR×ÔÕSWÓ[™WÒ][WÕÝ[ÐÛÜÝ×ØÉË	ÔSR×ÐÛÜÝ×ÕÝ[ÐÛÜÝ×ØÉ×JHÂˆYˆ
šY[˜[Y\Ëš[˜ÛY\ÊšY[
JHšY[Ëœ\Ú
šY[
NÂˆBˆYˆ
šY[˜[Y\Ëš[˜ÛY\Ê	Õ™\ÜÙ[×ØÉÊJHšY[Ëœ\Ú
	Õ™\ÜÙ[×Ü‹“˜[YIÊNÂˆYˆ
šY[˜[Y\Ëš[˜ÛY\Ê	ÔÜ×ØÉÊJHšY[Ëœ\Ú
	ÔÜ×Ü‹“˜[YIÊNÂˆYˆ
šY[˜[Y\Ëš[˜ÛY\Ê	ÐXØÛÝ[×ØÉÊJHšY[Ëœ\Ú
	ÐXØÛÝ[×Ü‹“˜[YIË	ÐXØÛÝ[×Ü‹’[˜XÝ]™WÔÝ\Ü[™Y×ØÉÊNÂ‚ˆÛÛœÝXÝ]™Q\Ü]TÝ]\ÐÛÛ™][ÛˆHŠ\Ü]WÔÝ]\××ØÈOH[S‘\Ü]WÔÝ]\××ØÈOH	Ó›È\Ü]IÈS‘\Ü]WÔÝ]\××ØÈOH	Ó›È\Ü]\ÉÈS‘\Ü]WÔÝ]\××ØÈOH	Û›È\Ü]IÈS‘\Ü]WÔÝ]\××ØÈOH	Û›È\Ü]\ÉÊHŽÂˆÛÛœÝ\Ü]PÛÛ™][ÛˆH\Ñ\Ü]TÝ]\ÈÈXÝ]™Q\Ü]TÝ]\ÐÛÛ™][Ûˆˆ	Ñ\Ü]W×ØÈHYIÎÂˆÛÛœÝÝ[UÚ\™HHÛÛXš[™UÚ\™PÛÛ™][ÛœÊÙ\Ü]PÛÛ™][Û‹[\›Ù™šXÙPÛÛ™][Û‹™\]Y\ÝYÝ[RYÈYH	ÉÙ\ØØ\TÛÜ[
™\]Y\ÝYÝ[RY
_IØˆ	É×JNÂˆÛÛœÝ›ÝÜÈH]ØZ]]Y\žT›ÝÜÊˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
šY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓHÝ[W×ØÂˆÒT‘H	ÜÝ[UÚ\™_BˆÔ‘Tˆ–H\Ý[ÙYšYY]HTÐÂˆSRU	Û[Z]BˆˆÈ[Z]ÛÙ˜Z[ˆYHKˆ
NÂ‚ˆÛÛœÝÝ[RYÈH›ÝÜË›X\

Ý[JHOˆÝ[K’Y
K™š[\Š›ÛÛX[ŠNÂˆÛÛœÝ[™R][\ÐžTÝ[HHßNÂˆÛÛœÝ^˜PÛÜÝÐžTÝ[HHßNÂˆÛÛœÝÝ\Y\’[›ÚXÙ\ÐžTÝ[HHßNÂˆÛÛœÝÝ\Y\’[›ÚXÙT^XX›PžTÝ[HHßNÂˆÛÛœÝÝ\Y\”^[Y[ÐžR[›ÚXÙHHßNÂˆÛÛœÝš[˜[^Y\’[›ÚXÙTÝ[RYÈH™]ÈÙ]

NÂ‚ˆYˆ
Ý[RYË›[™Ý
HÂˆÛÛœÝÛ[™R][P\œ˜^\Ë^˜PÛÜÝ\œ˜^\ËÝ\Y\’[›ÚXÙP\œ˜^\Ë^Y\’[›ÚXÙP\œ˜^\×HH]ØZ]›ÛZ\ÙK˜[
ÂˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ[RYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕYÕSW×ØË›ÙXÝ×Ü‹“˜[YKÝ\Y\—Ó˜[YW×ØËˆ	ÛÜšYÚ[˜[Ý\Y\“ÛÚÝ\˜[YÈÜšYÚ[˜[ÔÝ\Y\—×ØË	ÛÜšYÚ[˜[Ý\Y\”™[][ÛœÚ\K“˜[YK	ÛÜšYÚ[˜[Ý\Y\”™[][ÛœÚ\K’[˜XÝ]™WÔÝ\Ü[™Y×ØËˆ	ÉßBˆ^[Y[Õ\›W×ØË]X[]W×ØË]X[]WÑ[]™\™YÔ\—Ð‘—×ØËˆ]X[]WÓX^×ØË]X[]WÚ[—ÓU×ØË\×Ô]X[]WÔ˜[™ÙW×ØËˆšXÙWÔ\—Õ[š]×ØËÛÜÝÔ\—Õ[š]×ØË[š]ÔÙ[Ð]×ØË[š]Ð^WÐ]×ØË[š]ÐÛÜÝ×ØËˆÝ[ÔšXÙW×ØËÝ[ÐÛÜÝ×ØËÝ\Y\—Ò[›ÚXÙW×ØËØ[˜Ù[Y×ØËˆÙ™™\—Ó[™WÒ][W×Ü‹•[š]šXÙKÙ™™\—Ó[™WÒ][W×Ü‹”Ý\Y\—Õ[š]ÔšXÙW×ØÂˆ”“ÓHÕSWÓ[™WÒ][W×ØÂˆÒT‘HÕSW×ØÈSˆ
	Ú[“\ÝJBˆÔ‘Tˆ–HÕSW×ØËÜ™X]Y]HTÐÂˆSRULˆˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
KˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ[RYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆÛÛœÝ^˜PÛÜÝÙ[XÝšY[ÈHÉÒY	Ë	ÔÕSW×ØÉË	ÔÝ\Y\—Ó˜[YW×ØÉË	Ô]X[]W×ØÉË	Ô]X[]WÑ[]™\™YÔ\—Ð‘—×ØÉË	Ô]X[]WÚ[—ÓU×ØÉË	Ô]X[]WÔ˜[™ÙWÓX^×ØÉË	Ò\×Ô]X[]WÔ˜[™ÙW×ØÉË	Õ[š]ÔšXÙW×ØÉË	Õ[š]ÐÛÜÝ×ØÉË	Ó[™WÕÝ[×ØÉË	Ó[™WÕÝ[Ð^W×ØÉË	ÔÝ\Y\—Ò[›ÚXÙW×ØÉË	ÐØ[˜Ù[Y×ØÉË^˜PÛÜÝšY[˜[Y\Ëš\Ê	Ô^[Y[Õ\›W×ØÉÊHÈ	Ô^[Y[Õ\›W×ØÉÈˆ[^˜PÛÜÝšY[˜[Y\Ëš\Ê	Ô›ÙXÝ’Y×ØÉÊHÈ	Ô›ÙXÝ’Y×Ü‹“˜[YIÈˆ[^˜PÛÜÝÝ\Y\“ÛÚÝ\˜[YÈ^˜PÛÜÝÝ\Y\‘šY[ˆ[^˜PÛÜÝÝ\Y\“ÛÚÝ\˜[Y	‰ˆ^˜PÛÜÝÝ\Y\”™[][ÛœÚ\È	Ù^˜PÛÜÝÝ\Y\”™[][ÛœÚ\K“˜[YXˆ[^˜PÛÜÝÝ\Y\“ÛÚÝ\˜[Y	‰ˆ^˜PÛÜÝÝ\Y\”™[][ÛœÚ\È	Ù^˜PÛÜÝÝ\Y\”™[][ÛœÚ\K’[˜XÝ]™WÔÝ\Ü[™Y×ØØˆ[K™š[\Š›ÛÛX[ŠNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
^˜PÛÜÝÙ[XÝšY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓHÕSWÑ^˜WÐÛÜÝ×ØÂˆÒT‘HÕSW×ØÈSˆ
	Ú[“\ÝJBˆSRULˆˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
KˆÝ\Y\’[›ÚXÙQšY[˜[Y\Ëš[˜ÛY\Ê	ÔÕSW×ØÉÊBˆÈÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ[RYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆÛÛœÝÝ\Y\’[›ÚXÙTÙ[XÝšY[ÈHÉÔÕSW×ØÉË	ÒY	Ë	Ó˜[YIË	ÐÜ™X]Y]IË	Ó\Ý[ÙYšYY]IË‹‹œÝ\Y\’[›ÚXÙP[[Ý[šY[Ë‹‹œÝ\Y\’[›ÚXÙQYQ]QšY[Ë‹‹œÝ\Y\’[›ÚXÙQ]QšY[Ë‹‹œÝ\Y\’[›ÚXÙTÝ]\ÑšY[ËÝ\Y\’[›ÚXÙT^XX›QšY[Ý\Y\’[›ÚXÙQšY[˜[Y\Ëš[˜ÛY\Ê	ÐÝ\œ™[˜ÞR\ÛÐÛÙIÊHÈ	ÐÝ\œ™[˜ÞR\ÛÐÛÙIÈˆ[Ý\Y\’[›ÚXÙQšY[˜[Y\Ëš[˜ÛY\Ê	ÔÝ\Y\—Ó˜[YW×ØÉÊHÈ	ÔÝ\Y\—Ó˜[YW×ØÉÈˆ[‹‹œÝ\Y\’[›ÚXÙTÝ\Y\‘šY[Ë‹‹œÝ\Y\’[›ÚXÙTÝ\Y\“˜[YT™[][ÛœÚ\Ë™›]X\

™[][ÛœÚ\
HOˆØ	Ü™[][ÛœÚ\K“˜[YX	Ü™[][ÛœÚ\K’[˜XÝ]™WÔÝ\Ü[™Y×ØØJWK™š[\Š›ÛÛX[ŠNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
Ý\Y\’[›ÚXÙTÙ[XÝšY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓHÝ\Y\—Ò[›ÚXÙW×ØÂˆÒT‘HÕSW×ØÈSˆ
	Ú[“\ÝJBˆSRULˆˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
Bˆˆ›ÛZ\ÙKœ™\ÛÛ™J×JKˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊÚ[šÒYÊÝ[RYÊK›X\

Ú[šÊHOˆ
ÂˆÛÜ[ˆÑSPÕY˜[YKÕSW×ØË›Ù›Ü›XW×ØË\™XØ]Y×ØÈ”“ÓH[›ÚXÙW×ØÈÒT‘HÕSW×ØÈSˆ
	ØÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	Ê_JHSRULˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆJJJKˆJNÂ‚ˆ›Üˆ
ÛÛœÝ[›ÚXÙHÙˆ^Y\’[›ÚXÙP\œ˜^\Ë™›]

K™š[\Š\Ñš[˜[^Y\’[›ÚXÙJJHYˆ
[›ÚXÙK”ÕSW×ØÊHš[˜[^Y\’[›ÚXÙTÝ[RYË˜Y
[›ÚXÙK”ÕSW×ØÊNÂ‚ˆ›Üˆ
ÛÛœÝ][HÙˆ[™R][P\œ˜^\Ë™›]

JHÂˆYˆ
Z][K”ÕSW×ØÊHÛÛ[YNÂˆYˆ
[[™R][\ÐžTÝ[VÚ][K”ÕSW×Ø×JH[™R][\ÐžTÝ[VÚ][K”ÕSW×Ø×HH×NÂˆ[™R][\ÐžTÝ[VÚ][K”ÕSW×Ø×Kœ\Ú
][JNÂˆBˆ›Üˆ
ÛÛœÝ][HÙˆ^˜PÛÜÝ\œ˜^\Ë™›]

JHÂˆYˆ
Z][K”ÕSW×ØÊHÛÛ[YNÂˆYˆ
Y^˜PÛÜÝÐžTÝ[VÚ][K”ÕSW×Ø×JH^˜PÛÜÝÐžTÝ[VÚ][K”ÕSW×Ø×HH×NÂˆ^˜PÛÜÝÐžTÝ[VÚ][K”ÕSW×Ø×Kœ\Ú
][JNÂˆBˆ›Üˆ
ÛÛœÝ[›ÚXÙHÙˆÝ\Y\’[›ÚXÙP\œ˜^\Ë™›]

JHÂˆYˆ
Z[›ÚXÙK”ÕSW×ØÊHÛÛ[YNÂˆYˆ
\Ý\Y\’[›ÚXÙ\ÐžTÝ[VÚ[›ÚXÙK”ÕSW×Ø×JHÝ\Y\’[›ÚXÙ\ÐžTÝ[VÚ[›ÚXÙK”ÕSW×Ø×HH×NÂˆÝ\Y\’[›ÚXÙ\ÐžTÝ[VÚ[›ÚXÙK”ÕSW×Ø×Kœ\Ú
[›ÚXÙJNÂˆYˆ
Ý\Y\’[›ÚXÙT^XX›QšY[OH[
HÛÛ[YNÂˆÝ\Y\’[›ÚXÙT^XX›PžTÝ[VÚ[›ÚXÙK”ÕSW×Ø×HH
Ý\Y\’[›ÚXÙT^XX›PžTÝ[VÚ[›ÚXÙK”ÕSW×Ø×H
H
È[X™\Š[›ÚXÙVÜÝ\Y\’[›ÚXÙT^XX›QšY[H
NÂˆB‚ˆÛÛœÝÝ\Y\’[›ÚXÙRYÈHÝ\Y\’[›ÚXÙP\œ˜^\Âˆ™›]

Bˆ›X\

[›ÚXÙJHOˆ[›ÚXÙK’Y
Bˆ™š[\Š\ÔØ[\Ù›Ü˜ÙRY
NÂˆYˆ
Ý\Y\’[›ÚXÙRYË›[™Ý	‰ˆÝ\Y\”Ù][Y[ØÚ[XKœ^[Y[Ý\Y\’[›ÚXÙQšY[Ë›[™Ý	‰ˆÝ\Y\”Ù][Y[ØÚ[XKœ^[Y[[[Ý[šY[
HÂˆÛÛœÝ^[Y[Ù[XÝšY[ÈHÉÒY	Ë^[Y[šY[˜[Y\Ëš\Ê	Ó˜[YIÊHÈ	Ó˜[YIÈˆ[^[Y[šY[˜[Y\Ëš\Ê	ÐÜ™X]Y]IÊHÈ	ÐÜ™X]Y]IÈˆ[^[Y[šY[˜[Y\Ëš\Ê	ÐÝ\œ™[˜ÞR\ÛÐÛÙIÊHÈ	ÐÝ\œ™[˜ÞR\ÛÐÛÙIÈˆ[Ý\Y\”Ù][Y[ØÚ[XKœ^[Y[[[Ý[šY[Ý\Y\”Ù][Y[ØÚ[XKœ^[Y[]QšY[‹‹œÝ\Y\”Ù][Y[ØÚ[XKœ^[Y[Ý\Y\’[›ÚXÙQšY[Ë‹‹œÝ\Y\”Ù][Y[ØÚ[XKœ^[Y[Ý]\ÑšY[×K™š[\Š›ÛÛX[ŠNÂˆ]ØZ]›ÛZ\ÙK˜[
ˆÝ\Y\”Ù][Y[ØÚ[XKœ^[Y[Ý\Y\’[›ÚXÙQšY[Ë›X\
\Þ[˜È
ÛÚÝ\šY[
HOˆÂˆÛÛœÝ^[Y[Ú[šÜÈH]ØZ]ÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ\Y\’[›ÚXÙRYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
^[Y[Ù[XÝšY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓH^[Y[×ØÂˆÒT‘H	ÛÛÚÝ\šY[HSˆ
	Ú[“\ÝJBˆÔ‘Tˆ–H	ÜÝ\Y\”Ù][Y[ØÚ[XKœ^[Y[]QšY[	ÐÜ™X]Y]IßHTÐÈ•SÈTÕˆSRULˆˆ[Z]ˆLˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
NÂˆ›Üˆ
ÛÛœÝ^[Y[Ùˆ^[Y[Ú[šÜË™›]

JHÂˆYˆ
]˜[YÝ\Y\”Ù][Y[^[Y[
^[Y[Ý\Y\”Ù][Y[ØÚ[XKœ^[Y[Ý]\ÑšY[ÊJHÛÛ[YNÂˆÛÛœÝ[›ÚXÙRYH^[Y[ÛÛÚÝ\šY[NÂˆYˆ
Z\ÔØ[\Ù›Ü˜ÙRY
[›ÚXÙRY
JHÛÛ[YNÂˆYˆ
\Ý\Y\”^[Y[ÐžR[›ÚXÙVÚ[›ÚXÙRYJHÝ\Y\”^[Y[ÐžR[›ÚXÙVÚ[›ÚXÙRYHH×NÂˆYˆ
Ý\Y\”^[Y[ÐžR[›ÚXÙVÚ[›ÚXÙRYKœÛÛYJ
^\Ý[™ÊHOˆ^\Ý[™ËšYOOH^[Y[’Y
JHÛÛ[YNÂˆÝ\Y\”^[Y[ÐžR[›ÚXÙVÚ[›ÚXÙRYKœ\Ú
ÂˆYˆ^[Y[’Yˆ˜[YNˆ^[Y[“˜[YH^[Y[’Yˆ[[Ý[ˆ[X™\Š^[Y[ÜÝ\Y\”Ù][Y[ØÚ[XKœ^[Y[[[Ý[šY[H
Kˆ]Nˆ^[Y[ÜÝ\Y\”Ù][Y[ØÚ[XKœ^[Y[]QšY[H^[Y[Ü™X]Y]H[ˆÝ\œ™[˜ÞR\ÛÐÛÙNˆ^[Y[Ý\œ™[˜ÞR\ÛÐÛÙH	ÕTÑ	ËˆÝ]\ÎˆÝ\Y\”Ù][Y[ØÚ[XKœ^[Y[Ý]\ÑšY[Ë›X\

šY[
HOˆ^[Y[ÙšY[JK™š[™
›ÛÛX[ŠH[ˆJNÂˆBˆJKˆ
NÂˆBˆB‚ˆ™]\›ˆÂˆ›ÝÜÎˆ›ÝÜÂˆ™š[\Š
Ý[JHOˆZ\Ñ\Ü]TÝ]\ÈVÉÛ›È\Ü]IË	Û›È\Ü]\É×Kš[˜ÛY\ÊÝš[™ÊÝ[K‘\Ü]WÔÝ]\××ØÈ	ÉÊKÓÝÙ\Ø\ÙJ
JJBˆ›X\

Ý[JHOˆÂˆÛÛœÝÝ[R\Ñ[]™\žHHH\Ý[K‘[]™\žWÑ]W×ØÎÂˆÛÛœÝ[™R][\ÈH[™R][\ÐžTÝ[VÜÝ[K’YH×NÂˆÛÛœÝ^˜PÛÜÝÈH^˜PÛÜÝÐžTÝ[VÜÝ[K’YH×NÂˆÛÛœÝÝ\Y\’[›ÚXÙ\ÈHÝ\Y\’[›ÚXÙ\ÐžTÝ[VÜÝ[K’YH×NÂˆÛÛœÝÝ\Y\“˜[Y\ÈH™]ÈÙ]

NÂˆÛÛœÝ›ÙXÝ˜[Y\ÈH™]ÈÙ]

NÂˆÛÛœÝÝ\Y\”›ÙXÝZ\œÈH×NÂˆÛÛœÝÝ\Y\”›ÙXÝZ\’Ù^\ÈH™]ÈÙ]

NÂˆÛÛœÝÝ\Y\’[›ÚXÙT›ÙXÝ›ÝÜÐžRYH™]ÈX\

NÂˆÛÛœÝ[š[›ÚXÙY^˜PÛÜÝ›ÙXÝ›ÝÜÈH×NÂˆÛÛœÝÝ\Y\“[™P^PžPXØÛÝ[H™]ÈX\

NÂˆÛÛœÝ[š[›ÚXÙYÝ\Y\“[™P^PžPXØÛÝ[H™]ÈX\

NÂˆ][™TÙ[Ý[HÂˆ]Ý\Y\“[™P^HHÂˆ][š[›ÚXÙYÝ\Y\“[™P^HHÂˆ]^˜TÙ[Ý[HÂˆ]^˜PÛÜÝ^HHÂˆ][›ÚXÙY^˜PÛÜÝ^HHÂˆ]Ù[Û›Q^˜TÙ[HÂˆ]\ÔÝ\Y\’[›ÚXÙHH˜[ÙNÂ‚ˆ›Üˆ
ÛÛœÝ][HÙˆ[™R][\ÊHÂˆYˆ
][KØ[˜Ù[Y×ØÊHÛÛ[YNÂˆÛÛœÝÜšYÚ[˜[Ý\Y\’[˜XÝ]™HH][VÛÜšYÚ[˜[Ý\Y\”™[][ÛœÚ\OË’[˜XÝ]™WÔÝ\Ü[™Y×ØÈOOHYNÂˆÛÛœÝÜšYÚ[˜[Ý\Y\XØÛÝ[YHÜšYÚ[˜[Ý\Y\’[˜XÝ]™HÈ[ˆ][K“ÜšYÚ[˜[ÔÝ\Y\—×ØÈ[ÂˆÛÛœÝÜšYÚ[˜[Ý\Y\XØÛÝ[Ù^HH\Ü]TØ[\Ù›Ü˜ÙRYÙ^JÜšYÚ[˜[Ý\Y\XØÛÝ[Y
NÂˆÛÛœÝÜšYÚ[˜[Ý\Y\“˜[YHHÜšYÚ[˜[Ý\Y\’[˜XÝ]™HÈ[ˆ][VÛÜšYÚ[˜[Ý\Y\”™[][ÛœÚ\OË“˜[YH][K”Ý\Y\—Ó˜[YW×ØÈÜšYÚ[˜[Ý\Y\XØÛÝ[Y[ÂˆYˆ
ÜšYÚ[˜[Ý\Y\“˜[YJHÝ\Y\“˜[Y\Ë˜Y
ÜšYÚ[˜[Ý\Y\“˜[YJNÂˆÛÛœÝ›ÙXÝ˜[YHH][VÉÔ›ÙXÝ×Ü‰×OË“˜[YNÂˆYˆ
›ÙXÝ˜[YJH›ÙXÝ˜[Y\Ë˜Y
›ÙXÝ˜[YJNÂˆÛÛœÝ]X[]SX™[H[™R][T]X[]SX™[
][KÝ[R\Ñ[]™\žJNÂˆYˆ
][K”Ý\Y\—Ò[›ÚXÙW×ØÊHÂˆÛÛœÝ[›ÚXÙT›ÝÜÈHÝ\Y\’[›ÚXÙT›ÙXÝ›ÝÜÐžRY™Ù]
][K”Ý\Y\—Ò[›ÚXÙW×ØÊH×NÂˆ[›ÚXÙT›ÝÜËœ\Ú
Âˆ›ÙXÝ˜[YNˆ›ÙXÝ˜[YH][K“˜[YH	Ô›ÙXÝ	Ëˆ]X[]SX™[ˆÝ\Y\“˜[YNˆÜšYÚ[˜[Ý\Y\“˜[YKˆÝ\Y\XØÛÝ[YˆÜšYÚ[˜[Ý\Y\XØÛÝ[Yˆ^[Y[\›Nˆ][K”^[Y[Õ\›W×ØÈ[ˆJNÂˆÝ\Y\’[›ÚXÙT›ÙXÝ›ÝÜÐžRYœÙ]
][K”Ý\Y\—Ò[›ÚXÙW×ØË[›ÚXÙT›ÝÜÊNÂˆBˆYˆ
ÜšYÚ[˜[Ý\Y\“˜[YH›ÙXÝ˜[YJHÂˆÛÛœÝZ\’Ù^HH	ÛÜšYÚ[˜[Ý\Y\XØÛÝ[Ù^HÜšYÚ[˜[Ý\Y\“˜[YH	ÉßWL	Ü›ÙXÝ˜[YH	ÉßXÂˆYˆ
\Ý\Y\”›ÙXÝZ\’Ù^\Ëš\ÊZ\’Ù^JJHÂˆÝ\Y\”›ÙXÝZ\’Ù^\Ë˜Y
Z\’Ù^JNÂˆÝ\Y\”›ÙXÝZ\œËœ\Ú
ÂˆÝ\Y\“˜[YNˆÜšYÚ[˜[Ý\Y\“˜[YKˆÝ\Y\XØÛÝ[YˆÜšYÚ[˜[Ý\Y\XØÛÝ[Yˆ›ÙXÝ˜[YNˆ›ÙXÝ˜[YH[ˆJNÂˆBˆBˆ[™TÙ[Ý[
ÏH[™TÙ[[[Ý[
][KÝ[R\Ñ[]™\žJNÂˆÛÛœÝ^HH[™P^P[[Ý[
][KÝ[R\Ñ[]™\žJNÂˆÝ\Y\“[™P^H
ÏH^NÂˆYˆ
ÜšYÚ[˜[Ý\Y\XØÛÝ[Ù^JHÂˆÛÛœÝÝ\Y\“[™HHÝ\Y\“[™P^PžPXØÛÝ[™Ù]
ÜšYÚ[˜[Ý\Y\XØÛÝ[Ù^JHÂˆXØÛÝ[YˆÜšYÚ[˜[Ý\Y\XØÛÝ[YˆÝ\Y\“˜[YNˆÜšYÚ[˜[Ý\Y\“˜[YKˆ[[Ý[ˆˆNÂˆÝ\Y\“[™K˜[[Ý[
ÏH^NÂˆÝ\Y\“[™P^PžPXØÛÝ[œÙ]
ÜšYÚ[˜[Ý\Y\XØÛÝ[Ù^KÝ\Y\“[™JNÂˆBˆYˆ
][K”Ý\Y\—Ò[›ÚXÙW×ØÊHÂˆ\ÔÝ\Y\’[›ÚXÙHHYNÂˆH[ÙHÂˆ[š[›ÚXÙYÝ\Y\“[™P^H
ÏH^NÂˆYˆ
ÜšYÚ[˜[Ý\Y\XØÛÝ[Ù^JHÂˆÛÛœÝÝ\Y\“[™HH[š[›ÚXÙYÝ\Y\“[™P^PžPXØÛÝ[™Ù]
ÜšYÚ[˜[Ý\Y\XØÛÝ[Ù^JHÂˆXØÛÝ[YˆÜšYÚ[˜[Ý\Y\XØÛÝ[YˆÝ\Y\“˜[YNˆÜšYÚ[˜[Ý\Y\“˜[YKˆ[[Ý[ˆˆNÂˆÝ\Y\“[™K˜[[Ý[
ÏH^NÂˆ[š[›ÚXÙYÝ\Y\“[™P^PžPXØÛÝ[œÙ]
ÜšYÚ[˜[Ý\Y\XØÛÝ[Ù^KÝ\Y\“[™JNÂˆBˆBˆB‚ˆ›Üˆ
ÛÛœÝ][HÙˆ^˜PÛÜÝÊHÂˆYˆ
][KØ[˜Ù[Y×ØÊHÛÛ[YNÂˆÛÛœÝ›ÙXÝ˜[YHH\Ü]T]Y]YQ^˜PÛÜÝ›ÙXÝ˜[YJ][JNÂˆÛÛœÝÝ\Y\’[˜XÝ]™HH^˜PÛÜÝÝ\Y\”™[][ÛœÚ\	‰ˆ][VÙ^˜PÛÜÝÝ\Y\”™[][ÛœÚ\OË’[˜XÝ]™WÔÝ\Ü[™Y×ØÈOOHYNÂˆÛÛœÝÝ\Y\XØÛÝ[YHÝ\Y\’[˜XÝ]™HÈ[ˆ^˜PÛÜÝÝ\Y\‘šY[È][VÙ^˜PÛÜÝÝ\Y\‘šY[Hˆ[ÂˆÛÛœÝÝ\Y\XØÛÝ[Ù^HH\Ü]TØ[\Ù›Ü˜ÙRYÙ^JÝ\Y\XØÛÝ[Y
NÂˆÛÛœÝÝ\Y\“˜[YHHÝ\Y\’[˜XÝ]™HÈ[ˆ
^˜PÛÜÝÝ\Y\”™[][ÛœÚ\È][VÙ^˜PÛÜÝÝ\Y\”™[][ÛœÚ\OË“˜[YHˆ[
H][K”Ý\Y\—Ó˜[YW×ØÈÝ\Y\XØÛÝ[Y[ÂˆYˆ
›ÙXÝ˜[YJH›ÙXÝ˜[Y\Ë˜Y
›ÙXÝ˜[YJNÂˆYˆ
Ý\Y\“˜[YH›ÙXÝ˜[YJHÂˆÛÛœÝZ\’Ù^HH	ÜÝ\Y\XØÛÝ[Ù^HÝ\Y\“˜[YH	ÉßWL	Ü›ÙXÝ˜[YH	ÉßXÂˆYˆ
\Ý\Y\”›ÙXÝZ\’Ù^\Ëš\ÊZ\’Ù^JJHÂˆÝ\Y\”›ÙXÝZ\’Ù^\Ë˜Y
Z\’Ù^JNÂˆÝ\Y\”›ÙXÝZ\œËœ\Ú
ÂˆÝ\Y\“˜[YKˆÝ\Y\XØÛÝ[Yˆ›ÙXÝ˜[YKˆJNÂˆBˆBˆYˆ
›ÙXÝ˜[YJHÂˆÛÛœÝ›ÙXÝ›ÝÈHÂˆ›ÙXÝ˜[YKˆ]X[]SX™[ˆ[ˆÝ\Y\“˜[YKˆÝ\Y\XØÛÝ[Yˆ^[Y[\›Nˆ][K”^[Y[Õ\›W×ØÈ[ˆÛÝ\˜ÙU\Nˆ	Ù^˜WØÛÜÝ	ËˆÛÝ\˜ÙT™XÛÜ™Yˆ][K’YˆNÂˆYˆ
][K”Ý\Y\—Ò[›ÚXÙW×ØÊHÂˆÛÛœÝ[›ÚXÙT›ÝÜÈHÝ\Y\’[›ÚXÙT›ÙXÝ›ÝÜÐžRY™Ù]
][K”Ý\Y\—Ò[›ÚXÙW×ØÊH×NÂˆ[›ÚXÙT›ÝÜËœ\Ú
›ÙXÝ›ÝÊNÂˆÝ\Y\’[›ÚXÙT›ÙXÝ›ÝÜÐžRYœÙ]
][K”Ý\Y\—Ò[›ÚXÙW×ØË[›ÚXÙT›ÝÜÊNÂˆH[ÙHÂˆ[š[›ÚXÙY^˜PÛÜÝ›ÙXÝ›ÝÜËœ\Ú
ÂˆÝ\Y\’[›ÚXÙRYˆ[ˆ[›ÚXÙS˜[YNˆ[ˆ‹‹œ›ÙXÝ›ÝËˆYQ]Nˆ[ˆ›ÙXÝ]X[]SX™[ˆÜ›ÙXÝ›ÝËœ›ÙXÝ˜[YK›ÙXÝ›ÝËœ]X[]SX™[K™š[\Š›ÛÛX[ŠKš›Ú[Š	ÈH	ÊKˆJNÂˆBˆBˆÛÛœÝ^HH^˜P^P[[Ý[
][KÝ[R\Ñ[]™\žJNÂˆÛÛœÝÙ[H^˜TÙ[[[Ý[
][KÝ[R\Ñ[]™\žJNÂˆ^˜TÙ[Ý[
ÏHÙ[ÂˆYˆ
][K”Ý\Y\—Ò[›ÚXÙW×ØÊHÂˆ[›ÚXÙY^˜PÛÜÝ^H
ÏH^NÂˆH[ÙHÂˆ^˜PÛÜÝ^H
ÏH^NÂˆYˆ
^HOOH	‰ˆÙ[ˆ
HÙ[Û›Q^˜TÙ[
ÏHÙ[ÂˆBˆB‚ˆÛÛœÝÝ\Y\˜\ÙHH[X™\ŠÝ[K•Ý[Ò[›ÚXÙYÐ[[Ý[Ñœ›ÛWÔÝ\Y\œ××ØÈ
H
È
\ÔÝ\Y\’[›ÚXÙHÈ[š[›ÚXÙYÝ\Y\“[™P^HˆÝ\Y\“[™P^JNÂˆÛÛœÝ˜]ÔÝ\Y\ˆHÝ\Y\˜\ÙH
È^˜PÛÜÝ^NÂˆÛÛœÝ[›X]ÚYÙ[Û›Q^˜HH\ÔÝ\Y\’[›ÚXÙHÈX]›X^
Ù[Û›Q^˜TÙ[H[›ÚXÙY^˜PÛÜÝ^JHˆÂˆÛÛœÝ[ZÔÝ\Y\ÛÜÝHÝ[K”SR×ÔÕSWÓ[™WÒ][WÕÝ[ÐÛÜÝ×ØÈOH[Ý[K”SR×ÐÛÜÝ×ÕÝ[ÐÛÜÝ×ØÈOH[È
Ý[K”SR×ÔÕSWÓ[™WÒ][WÕÝ[ÐÛÜÝ×ØÈ
H
È
Ý[K”SR×ÐÛÜÝ×ÕÝ[ÐÛÜÝ×ØÈ
Hˆ[ÂˆÛÛœÝÝ\Y\“Ý™\œÝ][Y[H[ZÔÝ\Y\ÛÜÝOH[Èˆ˜]ÔÝ\Y\ˆH[ZÔÝ\Y\ÛÜÝÂˆÛÛœÝØ[Ý[]YÝ\Y\’[›ÚXÙHH[›X]ÚYÙ[Û›Q^˜Hˆ	‰ˆÝ\Y\“Ý™\œÝ][Y[ˆ	‰ˆÝ\Y\“Ý™\œÝ][Y[H[›X]ÚYÙ[Û›Q^˜H
ÈŒHÈ[ZÔÝ\Y\ÛÜÝˆ˜]ÔÝ\Y\ŽÂˆÛÛœÝØ[Ý[]Y^Y\’[›ÚXÙHH[™TÙ[Ý[
È^˜TÙ[Ý[ÂˆÛÛœÝ^Y\’[›ÚXÙT™\ÛÛ][ÛˆH™\ÛÛ™P^Y\‘š[˜[˜ÚX[[[Ý[
ÈØ[\Ù›Ü˜ÙP[[Ý[ˆÝ[K•Ý[Ò[›ÚXÙWÐ[[Ý[×ØËØ[Ý[]Y[[Ý[ˆØ[Ý[]Y^Y\’[›ÚXÙKš[˜[[›ÚXÙR\ÜÝYYˆš[˜[^Y\’[›ÚXÙTÝ[RYËš\ÊÝ[K’Y
HJNÂˆÛÛœÝ^Y\’[›ÚXÙP[[Ý[H^Y\’[›ÚXÙT™\ÛÛ][Û‹˜[[Ý[ÂˆÛÛœÝÝ[P˜\ÙT›H^Y\’[›ÚXÙP[[Ý[OH[È[ˆ[X™\Š^Y\’[›ÚXÙP[[Ý[
HH[X™\ŠØ[Ý[]YÝ\Y\’[›ÚXÙH
NÂˆÛÛœÝÝ\Y\’[›ÚXÙT^XX›HHÝ\Y\’[›ÚXÙT^XX›PžTÝ[VÜÝ[K’YNÂˆÛÛœÝ^XX›P˜[[˜ÙHHÝ[K”^XX›WÐ˜[[˜ÙW×ØÈÏÈ
Ý\Y\’[›ÚXÙT^XX›HOH[ÈÝ\Y\’[›ÚXÙT^XX›Hˆ[
NÂˆÛÛœÝÝ\Y\‘š[˜[˜ÙPžPXØÛÝ[H™]ÈX\

NÂˆÛÛœÝÝ\Y\’[›ÚXÙQYT›ÝÜÈH×NÂˆÛÛœÝÝ\Y\’[›ÚXÙQ^ÜÝ\™T›ÝÜÈH×NÂˆÛÛœÝYÝ\Y\‘š[˜[˜ÙPžPXØÛÝ[H
XØÛÝ[YÝ\Y\“˜[YK[›ÚXÙP[[Ý[HÝ\Y\”^XX›P˜[[˜ÙHH
HOˆÂˆÛÛœÝXØÛÝ[Ù^HH\Ü]TØ[\Ù›Ü˜ÙRYÙ^JXØÛÝ[Y
NÂˆYˆ
XXØÛÝ[Ù^JH™]\›ŽÂˆÛÛœÝÝ\œ™[HÝ\Y\‘š[˜[˜ÙPžPXØÛÝ[™Ù]
XØÛÝ[Ù^JHÂˆXØÛÝ[YˆXØÛÝ[Ù^KˆÝ\Y\“˜[YNˆÝ\Y\“˜[YHXØÛÝ[YˆÝ\Y\’[›ÚXÙP[[Ý[ˆˆ^XX›P˜[[˜ÙNˆˆNÂˆÝ\œ™[œÝ\Y\’[›ÚXÙP[[Ý[
ÏH[X™\Š[›ÚXÙP[[Ý[
NÂˆÝ\œ™[œ^XX›P˜[[˜ÙH
ÏH[X™\ŠÝ\Y\”^XX›P˜[[˜ÙH
NÂˆÝ\Y\‘š[˜[˜ÙPžPXØÛÝ[œÙ]
XØÛÝ[Ù^KÝ\œ™[
NÂˆNÂˆ›Üˆ
ÛÛœÝ[›ÚXÙHÙˆÝ\Y\’[›ÚXÙ\ÊHÂˆÛÛœÝÝ\Y\XØÛÝ[šY[HÝ\Y\’[›ÚXÙTÝ\Y\‘šY[Ë™š[™

šY[
HOˆ[›ÚXÙVÙšY[JNÂˆÛÛœÝÝ\Y\XØÛÝ[™[][ÛœÚ\HÝ\Y\XØÛÝ[šY[ÈÝ\Y\’[›ÚXÙQšY[žS˜[YVÜÝ\Y\XØÛÝ[šY[OËœ™[][ÛœÚ\˜[YHˆ[ÂˆÛÛœÝÝ\Y\XØÛÝ[[˜XÝ]™HHÝ\Y\XØÛÝ[™[][ÛœÚ\	‰ˆ[›ÚXÙVÜÝ\Y\XØÛÝ[™[][ÛœÚ\OË’[˜XÝ]™WÔÝ\Ü[™Y×ØÈOOHYNÂˆÛÛœÝÝ\Y\XØÛÝ[YHÝ\Y\XØÛÝ[[˜XÝ]™HÈ[ˆÝ\Y\XØÛÝ[šY[È[›ÚXÙVÜÝ\Y\XØÛÝ[šY[Hˆ[ÂˆÛÛœÝÝ\Y\“˜[YHHÝ\Y\XØÛÝ[[˜XÝ]™HÈ[ˆ
Ý\Y\XØÛÝ[™[][ÛœÚ\È[›ÚXÙVÜÝ\Y\XØÛÝ[™[][ÛœÚ\OË“˜[YHˆ[
H[›ÚXÙVÉÔÝ\Y\—×Ü‰×OË“˜[YH[›ÚXÙK”Ý\Y\—Ó˜[YW×ØÈ[›ÚXÙVÉÑ^XÝYÔÝ\Y\—×Ü‰×OË“˜[YH[›ÚXÙVÉÔÝXœÝ]]WÔÝ\Y\—×Ü‰×OË“˜[YHÝ\Y\’[›ÚXÙTÝ\Y\“˜[YT™[][ÛœÚ\Ë›X\

™[][ÛœÚ\
HOˆ[›ÚXÙVÜ™[][ÛœÚ\OË“˜[YJK™š[™
›ÛÛX[ŠH[ÂˆÛÛœÝ[›ÚXÙP[[Ý[šY[HÝ\Y\’[›ÚXÙP[[Ý[šY[Ë™š[™

šY[
HOˆ[›ÚXÙVÙšY[HOH[
NÂˆÛÛœÝ[›ÚXÙP[[Ý[H[›ÚXÙP[[Ý[šY[È[X™\Š[›ÚXÙVÚ[›ÚXÙP[[Ý[šY[H
HˆÂˆÛÛœÝÝ\Y\”^XX›P˜[[˜ÙU˜[YHHÝ\Y\’[›ÚXÙT^XX›QšY[È[›ÚXÙVÜÝ\Y\’[›ÚXÙT^XX›QšY[Hˆ[ÂˆÛÛœÝÝ\Y\”^XX›P˜[[˜ÙP]˜Z[X›HHÝ\Y\”^XX›P˜[[˜ÙU˜[YHOH[	‰ˆÝ\Y\”^XX›P˜[[˜ÙU˜[YHOOH	ÉÈ	‰ˆ[X™\‹š\Ñš[š]J[X™\ŠÝ\Y\”^XX›P˜[[˜ÙU˜[YJJNÂˆÛÛœÝÝ\Y\”^XX›P˜[[˜ÙHHÝ\Y\”^XX›P˜[[˜ÙP]˜Z[X›HÈ[X™\ŠÝ\Y\”^XX›P˜[[˜ÙU˜[YJHˆÂˆYÝ\Y\‘š[˜[˜ÙPžPXØÛÝ[
Ý\Y\XØÛÝ[YÝ\Y\“˜[YK[›ÚXÙP[[Ý[Ý\Y\”^XX›P˜[[˜ÙJNÂˆÛÛœÝYQ]QšY[HÝ\Y\’[›ÚXÙQYQ]QšY[Ë™š[™

šY[
HOˆ[›ÚXÙVÙšY[JNÂˆÛÛœÝYQ]HHYQ]QšY[È[›ÚXÙVÙYQ]QšY[Hˆ[ÂˆÛÛœÝ[›ÚXÙQ]QšY[HÝ\Y\’[›ÚXÙQ]QšY[Ë™š[™

šY[
HOˆ[›ÚXÙVÙšY[JNÂˆÛÛœÝ[›ÚXÙQ]HH[›ÚXÙQ]QšY[È[›ÚXÙVÚ[›ÚXÙQ]QšY[Hˆ[›ÚXÙKÜ™X]Y]H[ÂˆÛÛœÝ[›ÚXÙTÝ]\ÈHÝ\Y\’[›ÚXÙTÝ]\ÑšY[Ë›X\

šY[
HOˆ[›ÚXÙVÙšY[JK™š[™
›ÛÛX[ŠH[ÂˆÛÛœÝ^[Y[›ÝÜÈHÝ\Y\”^[Y[ÐžR[›ÚXÙVÚ[›ÚXÙK’YH×NÂˆÛÛœÝÜÚ]]™T^[Y[ÈH^[Y[›ÝÜË™š[\Š
^[Y[
HOˆ[X™\Š^[Y[˜[[Ý[
Hˆ
Kœ™YXÙJ
Ý[K^[Y[
HOˆÝ[H
È[X™\Š^[Y[˜[[Ý[
K
NÂˆÛÛœÝÝ\Y\”™Y[™ÈHX]˜XœÊ^[Y[›ÝÜË™š[\Š
^[Y[
HOˆ[X™\Š^[Y[˜[[Ý[
H
Kœ™YXÙJ
Ý[K^[Y[
HOˆÝ[H
È[X™\Š^[Y[˜[[Ý[
K
JNÂˆÛÛœÝ^ÜÝ\™HH›Ü›X[^™TÝ\Y\’[›ÚXÙQ^ÜÝ\™JÂˆÝ\Y\’[›ÚXÙRYˆ[›ÚXÙK’Yˆ[›ÚXÙS˜[YNˆ[›ÚXÙK“˜[YKˆÛÝ\˜ÙTÝ[RYˆÝ[K’YˆÝ\Y\XØÛÝ[YˆÝ\Y\“˜[YKˆÝ\œ™[˜ÞR\ÛÐÛÙNˆ[›ÚXÙKÝ\œ™[˜ÞR\ÛÐÛÙH	ÕTÑ	ËˆYQ]Kˆ[›ÚXÙQ]KˆÜ™X]Y]Nˆ[›ÚXÙKÜ™X]Y]H[ˆ[›ÚXÙP[[Ý[ˆ^XX›P˜[[˜ÙNˆÝ\Y\”^XX›P˜[[˜ÙKˆ^XX›P˜[[˜ÙP]˜Z[X›NˆÝ\Y\”^XX›P˜[[˜ÙP]˜Z[X›KˆÝ]\Îˆ[›ÚXÙTÝ]\Ëˆ^[Y[Îˆ^[Y[›ÝÜËˆJNÂˆÛÛœÝ™]^[Y[]Y]HÜÚ]]™T^[Y[ÈHÝ\Y\”™Y[™ÎÂˆÛÛœÝ^XÝYZYHX]›X^
^ÜÝ\™Kš[›ÚXÙP[[Ý[H^ÜÝ\™Kœ^XX›P˜[[˜ÙJNÂˆÛÛœÝ^ÜÝ\™UØ\›š[™ÜÈHË‹‹™^ÜÝ\™KØ\›š[™Ü×NÂˆYˆ
Y\Ü]TØ[\Ù›Ü˜ÙRYÙ^JÝ\Y\XØÛÝ[Y
JHÂˆ^ÜÝ\™UØ\›š[™ÜËœ\Ú
	ÔÝ\Y\ˆ[›ÚXÙH\È›È˜[YÝ\Y\ˆXØÛÝ[ÛÚÝ\‰ÊNÂˆBˆYˆ
^[Y[›ÝÜË›[™Ý	‰ˆX]˜XœÊ^XÝYZYH™]^[Y[]Y]
HˆŒJHÂˆ^ÜÝ\™UØ\›š[™ÜËœ\Ú
	Ô^[Y[™XÛÜ™ÈÈ›Ý™XÛÛ˜Ú[HÈHÝ\œ™[^XX›H˜[[˜ÙNÈš[˜[˜ÙHÛÛ™š\›X][Ûˆ\È™\]Z\™Y‰ÊNÂˆBˆÝ\Y\’[›ÚXÙQ^ÜÝ\™T›ÝÜËœ\Ú
Âˆ‹‹™^ÜÝ\™Kˆ^[Y[Îˆ^[Y[›ÝÜËˆÜÚ]]™T^[Y[ËˆÝ\Y\”™Y[™Ëˆ™]^[Y[]Y]ˆÝ]\Îˆ[›ÚXÙTÝ]\ËˆØ\›š[™ÜÎˆË‹‹›™]ÈÙ]
^ÜÝ\™UØ\›š[™ÜÊWKˆJNÂˆÛÛœÝ›ÙXÝ›ÝÜÈHÝ\Y\’[›ÚXÙT›ÙXÝ›ÝÜÐžRY™Ù]
[›ÚXÙK’Y
H×NÂˆYˆ
›ÙXÝ›ÝÜË›[™Ý
HÂˆ›Üˆ
ÛÛœÝ›ÙXÝ›ÝÈÙˆ›ÙXÝ›ÝÜÊHÂˆÝ\Y\’[›ÚXÙQYT›ÝÜËœ\Ú
ÂˆÝ\Y\’[›ÚXÙRYˆ[›ÚXÙK’Y[ˆ[›ÚXÙS˜[YNˆ[›ÚXÙK“˜[YH[ˆÝ\Y\“˜[YNˆ›ÙXÝ›ÝËœÝ\Y\“˜[YHÝ\Y\“˜[YKˆÝ\Y\XØÛÝ[Yˆ›ÙXÝ›ÝËœÝ\Y\XØÛÝ[YÝ\Y\XØÛÝ[Yˆ^[Y[\›Nˆ›ÙXÝ›ÝËœ^[Y[\›H[ˆYQ]Kˆ›ÙXÝ˜[YNˆ›ÙXÝ›ÝËœ›ÙXÝ˜[YKˆ]X[]SX™[ˆ›ÙXÝ›ÝËœ]X[]SX™[ˆ›ÙXÝ]X[]SX™[ˆÜ›ÙXÝ›ÝËœ›ÙXÝ˜[YK›ÙXÝ›ÝËœ]X[]SX™[K™š[\Š›ÛÛX[ŠKš›Ú[Š	ÈH	ÊKˆJNÂˆBˆH[ÙHÂˆÝ\Y\’[›ÚXÙQYT›ÝÜËœ\Ú
ÂˆÝ\Y\’[›ÚXÙRYˆ[›ÚXÙK’Y[ˆ[›ÚXÙS˜[YNˆ[›ÚXÙK“˜[YH[ˆÝ\Y\“˜[YKˆÝ\Y\XØÛÝ[Yˆ^[Y[\›Nˆ[ˆYQ]Kˆ›ÙXÝ˜[YNˆ[ˆ]X[]SX™[ˆ[ˆ›ÙXÝ]X[]SX™[ˆ[ˆJNÂˆBˆBˆÝ\Y\’[›ÚXÙQYT›ÝÜËœ\Ú
‹‹[š[›ÚXÙY^˜PÛÜÝ›ÙXÝ›ÝÜÊNÂˆÛÛœÝÝ\Y\”^[Y[YQ]\ÐžPXØÛÝ[H™]ÈX\

NÂˆ›Üˆ
ÛÛœÝYT›ÝÈÙˆÝ\Y\’[›ÚXÙQYT›ÝÜÊHÂˆÛÛœÝXØÛÝ[Ù^HH\Ü]TØ[\Ù›Ü˜ÙRYÙ^JYT›ÝËœÝ\Y\XØÛÝ[Y
NÂˆYˆ
XXØÛÝ[Ù^HYYT›ÝË™YQ]JHÛÛ[YNÂˆÛÛœÝYQ]\ÈHÝ\Y\”^[Y[YQ]\ÐžPXØÛÝ[™Ù]
XØÛÝ[Ù^JH™]ÈÙ]

NÂˆYQ]\Ë˜Y
YT›ÝË™YQ]JNÂˆÝ\Y\”^[Y[YQ]\ÐžPXØÛÝ[œÙ]
XØÛÝ[Ù^KYQ]\ÊNÂˆBˆÛÛœÝ^[Y[YQ]\Ñ›ÜXØÛÝ[H
XØÛÝ[Ù^JHOˆË‹‹ŠÝ\Y\”^[Y[YQ]\ÐžPXØÛÝ[™Ù]
XØÛÝ[Ù^JH×JWKœÛÜ

NÂˆÛÛœÝÝ\[Y[[[™P^PžPXØÛÝ[H\ÔÝ\Y\’[›ÚXÙHÝ\Y\’[›ÚXÙ\Ë›[™ÝÈ[š[›ÚXÙYÝ\Y\“[™P^PžPXØÛÝ[ˆÝ\Y\“[™P^PžPXØÛÝ[Âˆ›Üˆ
ÛÛœÝÝ\Y\“[™HÙˆÝ\[Y[[[™P^PžPXØÛÝ[˜[Y\Ê
JHÂˆYÝ\Y\‘š[˜[˜ÙPžPXØÛÝ[
Ý\Y\“[™K˜XØÛÝ[YÝ\Y\“[™KœÝ\Y\“˜[YKÝ\Y\“[™K˜[[Ý[
NÂˆBˆÛÛœÝ\Ü]T\T™YÚ\ÝžHHZ[\Ü]T\T™YÚ\ÝžJÂˆÝ[Kˆ[™R][\Ëˆ^˜PÛÜÝËˆÜšYÚ[˜[Ý\Y\”™[][ÛœÚ\ˆ^˜PÛÜÝÝ\Y\‘šY[ˆ^˜PÛÜÝÝ\Y\”™[][ÛœÚ\ˆØÚ[XR\ÜÝY\ÎˆÛÜšYÚ[˜[Ý\Y\“ÛÚÝ\š\ÜÝYK^˜PÛÜÝÝ\Y\“ÛÚÝ\š\ÜÝYWKˆJNÂˆÛÛœÝÝ\Y\Ø[™Y]T›ÝÜÈH\Ü]T\T™YÚ\ÝžKœÝ\Y\œË›X\

\JHOˆÂˆÛÛœÝš[˜[˜ÙHHÝ\Y\‘š[˜[˜ÙPžPXØÛÝ[™Ù]
\K˜XØÛÝ[Ù^JNÂˆÛÛœÝ^[Y[YQ]\ÈH^[Y[YQ]\Ñ›ÜXØÛÝ[
\K˜XØÛÝ[Ù^JNÂˆÛÛœÝ[›ÚXÙ\ÈHÝ\Y\’[›ÚXÙQ^ÜÝ\™T›ÝÜË™š[\Š
[›ÚXÙJHOˆ\Ü]TØ[\Ù›Ü˜ÙRYÙ^J[›ÚXÙKœÝ\Y\XØÛÝ[Y
HOOH\K˜XØÛÝ[Ù^JNÂˆ™]\›ˆÂˆ‹‹œ\KˆÝ\Y\“˜[YNˆ\K›˜[YKˆÝ]\Îˆ[ˆ\ØÜš\[ÛŽˆ[ˆÝ\Y\’[›ÚXÙP[[Ý[ˆš[˜[˜ÙOËœÝ\Y\’[›ÚXÙP[[Ý[ÏÈ[ˆ^[Y[YQ]Nˆ^[Y[YQ]\ÖÌH[ˆ^[Y[YQ]\Ëˆ^XX›P˜[[˜ÙNˆš[˜[˜ÙOËœ^XX›P˜[[˜ÙHÏÈ[ˆ[›ÚXÙ\ËˆNÂˆJNÂˆÛÛœÝ\Ü]YÝ\Y\’Ù^\ÈH™]ÈÙ]
\Ü]T\T™YÚ\ÝžKœÝ\Y\œË›X\

\JHOˆ\K˜XØÛÝ[Ù^JJNÂˆÛÛœÝÝ\Y\‘š[˜[˜ÙSÛ›T›ÝÜÈHË‹‹œÝ\Y\‘š[˜[˜ÙPžPXØÛÝ[˜[Y\Ê
WBˆ™š[\Š
š[˜[˜ÙJHOˆY\Ü]YÝ\Y\’Ù^\Ëš\Êš[˜[˜ÙK˜XØÛÝ[Ù^JJBˆ›X\

š[˜[˜ÙJHOˆÂˆÛÛœÝ^[Y[YQ]\ÈH^[Y[YQ]\Ñ›ÜXØÛÝ[
š[˜[˜ÙK˜XØÛÝ[Ù^JNÂˆ™]\›ˆÂˆXØÛÝ[Yˆš[˜[˜ÙK˜XØÛÝ[YˆXØÛÝ[Ù^Nˆš[˜[˜ÙK˜XØÛÝ[Ù^KˆÝ\Y\“˜[YNˆš[˜[˜ÙKœÝ\Y\“˜[YKˆÝ]\Îˆ[ˆÝ\Y\’[›ÚXÙP[[Ý[ˆš[˜[˜ÙKœÝ\Y\’[›ÚXÙP[[Ý[ˆ^[Y[YQ]Nˆ^[Y[YQ]\ÖÌH[ˆ^[Y[YQ]\Ëˆ^XX›P˜[[˜ÙNˆš[˜[˜ÙKœ^XX›P˜[[˜ÙKˆ[›ÚXÙ\ÎˆÝ\Y\’[›ÚXÙQ^ÜÝ\™T›ÝÜË™š[\Š
[›ÚXÙJHOˆ\Ü]TØ[\Ù›Ü˜ÙRYÙ^J[›ÚXÙKœÝ\Y\XØÛÝ[Y
HOOHš[˜[˜ÙK˜XØÛÝ[Ù^JKˆNÂˆJNÂˆÛÛœÝÝ\Y\‘š[˜[˜ÙT›ÝÜÐ[HË‹‹œÝ\Y\Ø[™Y]T›ÝÜË‹‹œÝ\Y\‘š[˜[˜ÙSÛ›T›ÝÜ×NÂˆÛÛœÝÝ\Y\‘š[˜[˜ÙT›ÝÜÈHÝ\Y\Ø[™Y]T›ÝÜË›[™ÝÈÝ\Y\Ø[™Y]T›ÝÜÈˆÝ\Y\‘š[˜[˜ÙSÛ›T›ÝÜÎÂˆÛÛœÝ^Y\‘š[˜[˜ÙT›ÝÈHÂˆ^Y\“˜[YNˆ\Ü]T\T™YÚ\ÝžK˜^Y\Ë›˜[YH
Ý[KXØÛÝ[×ÜË’[˜XÝ]™WÔÝ\Ü[™Y×ØÈOOHYHÈ	ÐXØÛÝ[[˜]˜Z[X›IÈˆÝ[K^Y\—Ó˜[YW×ØÈÝ[VÉÐXØÛÝ[×Ü‰×OË“˜[YHÝ[K^Y\—×ØÈ[
Kˆ^Y\’[›ÚXÙP[[Ý[ˆ^Y\’[›ÚXÙP[[Ý[ÏÈ[ˆ^Y\’[›ÚXÙP[[Ý[ÛÝ\˜ÙNˆ^Y\’[›ÚXÙT™\ÛÛ][Û‹œÛÝ\˜ÙKˆ^[Y[YQ]NˆÝ[K’[›ÚXÙWÑYWÑ]W×ØÈÝ[K‘YWÑ]W×ØÈÝ[K^Y\—Ô^WÕ\›WÑ]W×ØÈ[ˆ™XÙZ]˜X›P˜[[˜ÙNˆÝ[K”™XÙZ]˜X›WÐ˜[[˜ÙW×ØÈÏÈ[ˆ\Ü]T›ÝÜÎˆ×KˆÝ]\Îˆ[ˆ\ØÜš\[ÛŽˆ[ˆNÂ‚ˆ™]\›ˆÂˆ‹‹œÝ[Kˆ‹‹ŠÝ[KXØÛÝ[×ÜË’[˜XÝ]™WÔÝ\Ü[™Y×ØÈOOHYHÈÈXØÛÝ[×ÜŽˆ[XØÛÝ[×ØÎˆ[HˆßJKˆÝ[Ò[›ÚXÙWÐ[[Ý[×ØÎˆ^Y\’[›ÚXÙP[[Ý[ÏÈÝ[K•Ý[Ò[›ÚXÙWÐ[[Ý[×ØÈÏÈ[ˆÝ[Ò[›ÚXÙYÐ[[Ý[Ñœ›ÛWÔÝ\Y\œ××ØÎˆØ[Ý[]YÝ\Y\’[›ÚXÙHÝ[K•Ý[Ò[›ÚXÙYÐ[[Ý[Ñœ›ÛWÔÝ\Y\œ××ØÈ[ˆÔÝ\Y\—Ó˜[Y\ÎˆË‹‹œÝ\Y\“˜[Y\×KœÛÜ

Kš›Ú[Š	Ë	ÊH[ˆÔ›ÙXÝÓ˜[Y\ÎˆË‹‹œ›ÙXÝ˜[Y\×KœÛÜ

Kš›Ú[Š	Ë	ÊH[ˆÔÝ\Y\—Ô›ÙXÝÔZ\œÎˆÝ\Y\”›ÙXÝZ\œËˆÐ^Y\—Ñ\Ü]\Îˆ×KˆÐ^Y\—Ñ\Ü]WÔ›ÝÜÎˆ×KˆÐ^Y\—Ñš[˜[˜ÙWÔ›ÝÎˆ^Y\‘š[˜[˜ÙT›ÝËˆÔÝ\Y\—Ñ\Ü]\Îˆ×KˆÔÝ\Y\—Ñ\Ü]WÔ›ÝÜÎˆÝ\Y\‘š[˜[˜ÙT›ÝÜËˆÔÝ\Y\—Ñš[˜[˜ÙWÔ›ÝÜ×Ð[ˆÝ\Y\‘š[˜[˜ÙT›ÝÜÐ[ˆÑ\Ü]WÔ\Y\Îˆ\Ü]T\T™YÚ\ÝžKˆÐ^Y\—Ò[›ÚXÙWÑYWÑ]NˆÝ[K’[›ÚXÙWÑYWÑ]W×ØÈÝ[K‘YWÑ]W×ØÈÝ[K^Y\—Ô^WÕ\›WÑ]W×ØÈ[ˆÔÝ\Y\—Ò[›ÚXÙWÑYWÔ›ÝÜÎˆÝ\Y\’[›ÚXÙQYT›ÝÜËˆÔÝ\Y\—Ò[›ÚXÙWÑ^ÜÝ\™WÔ›ÝÜÎˆÝ\Y\’[›ÚXÙQ^ÜÝ\™T›ÝÜËˆÔÝ\Y\—ÔÙ][Y[ÔØÚ[XNˆÝ\Y\”Ù][Y[ØÚ[XKˆÔÝ[WÐ˜\ÙWÔ›ˆÝ[P˜\ÙT›ˆÐ^Y\—Ñ\Ü]WÓX™[ˆ[ˆÔÝ\Y\—Ñ\Ü]WÓX™[ˆ[ˆÔÝ\Y\—Ò[›ÚXÙWÔÜ]ÓX™[ˆÝ\Y\‘š[˜[˜ÙT›ÝÜË›X\

\Ü]JHOˆ\Ü]KœÝ\Y\’[›ÚXÙP[[Ý[
Kš›Ú[Š	×‰ÊH[ˆÔ^XX›WÐ˜[[˜ÙWÔÜ]ÓX™[ˆÝ\Y\‘š[˜[˜ÙT›ÝÜË›X\

\Ü]JHOˆ\Ü]Kœ^XX›P˜[[˜ÙJKš›Ú[Š	×‰ÊH[ˆÔ^XX›WÐ˜[[˜ÙNˆ^XX›P˜[[˜ÙKˆÑ\Ü^WÓ˜[YNˆ›Ü›X]Ý[S˜[YJÝ[JKˆÐ^Y\—Ó˜[YNˆÝ[KXØÛÝ[×ÜË’[˜XÝ]™WÔÝ\Ü[™Y×ØÈOOHYHÈ	ÐXØÛÝ[[˜]˜Z[X›IÈˆÝ[K^Y\—Ó˜[YW×ØÈÝ[VÉÐXØÛÝ[×Ü‰×OË“˜[YHÝ[K^Y\—×ØÈ[ˆÑY™™XÝ]™WÑ]NˆÝ[K‘[]™\žWÑ]W×ØÈÝ[K‘^XÝYÑ[]™\žWÑ]W×ØÈ[ˆNÂˆJKˆNÂŸB‚™[˜Ý[ÛˆÙ\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\J›ÝÊHÂˆYˆ
\›ÝÊH™]\›ˆ[Âˆ™]\›ˆÂˆYˆ›ÝËšYˆØ\ÙRYˆ›ÝË˜Ø\ÙWÚY›ÝË˜Ø\ÙRYˆÝ[RYˆ›ÝËœÝ[WÚY›ÝËœÝ[RYˆXØÛÝ[Yˆ›ÝË˜XØÛÝ[ÚY›ÝË˜XØÛÝ[YˆXØÛÝ[Ù^Nˆ›ÝË˜XØÛÝ[ÚÙ^H›ÝË˜XØÛÝ[Ù^Kˆ˜[YNˆ›ÝË˜XØÛÝ[Û˜[YH›ÝË›˜[YH›ÝË˜XØÛÝ[ÚY›ÝË˜XØÛÝ[Yˆ›Û\Îˆ\œ˜^Kš\Ð\œ˜^J›ÝËœ›Û\ÊHÈ›ÝËœ›Û\Èˆ×KˆÛÝ\˜ÙU\\Îˆ\œ˜^Kš\Ð\œ˜^J›ÝËœÛÝ\˜ÙWÝ\\ÊHÈ›ÝËœÛÝ\˜ÙWÝ\\Èˆ›ÝËœÛÝ\˜ÙU\\È×KˆÛÝ\˜ÙT™XÛÜ™YÎˆ\œ˜^Kš\Ð\œ˜^J›ÝËœÛÝ\˜ÙWÜ™XÛÜ™ÚYÊHÈ›ÝËœÛÝ\˜ÙWÜ™XÛÜ™ÚYÈˆ›ÝËœÛÝ\˜ÙT™XÛÜ™YÈ×Kˆ^[Y[\›\Îˆ\œ˜^Kš\Ð\œ˜^J›ÝËœ^[Y[Ý\›\ÊHÈ›ÝËœ^[Y[Ý\›\Èˆ›ÝËœ^[Y[\›\È×Kˆ›ÙXÝÎˆ\œ˜^Kš\Ð\œ˜^J›ÝËœ›ÙXÝÊHÈ›ÝËœ›ÙXÝÈˆ×KˆØ[˜Ù[YÛÝ\˜ÙSÛ›Nˆ›ÝË˜Ø[˜Ù[YÜÛÝ\˜ÙWÛÛ›HOOHYH›ÝË˜Ø[˜Ù[YÛÝ\˜ÙSÛ›HOOHYKˆÜ™X]Y]ˆ›ÝË˜Ü™X]YØ]›ÝË˜Ü™X]Y][ˆ\]Y]ˆ›ÝË\]YØ]›ÝË\]Y][ˆNÂŸB‚™[˜Ý[Ûˆ\Ü]T™YÚ\ÝžUÚ]Ù[XÝ[ÛŠ™YÚ\ÝžK\T›ÝÜÈH×JHÂˆÛÛœÝÙ[XÝYH×NÂˆÛÛœÝ\ÜÝY\ÈHË‹‹Š™YÚ\ÝžOËš\ÜÝY\È×JWNÂˆÛÛœÝØ[™Y]PžRÙ^HH™]ÈX\

™YÚ\ÝžOË˜Ø[™Y]\È×JK›X\

Ø[™Y]JHOˆØØ[™Y]K˜XØÛÝ[Ù^KØ[™Y]WJJNÂˆ›Üˆ
ÛÛœÝ›ÝÈÙˆ\T›ÝÜÊHÂˆÛÛœÝÝÜ™YHÙ\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\J›ÝÊNÂˆÛÛœÝØ[™Y]HHØ[™Y]PžRÙ^K™Ù]
ÝÜ™Y˜XØÛÝ[Ù^JNÂˆYˆ
XØ[™Y]JHÂˆ\ÜÝY\Ëœ\Ú
ÂˆÛÙNˆ	ÜÙ[XÝYØXØÛÝ[ÜÝ[IËˆY\ÜØYÙNˆ	ÜÝÜ™Y›˜[Y_H\È›ÈÛ™Ù\ˆH^Y\ˆÜˆHÝ\Y\ˆÛˆ\ÈÕSK˜ˆ™XÛÜ™YÎˆÝÜ™YœÛÝ\˜ÙT™XÛÜ™YËˆ]Z[ÎˆÈXØÛÝ[YˆÝÜ™Y˜XØÛÝ[YKˆJNÂˆÛÛ[YNÂˆBˆÙ[XÝYœ\Ú
Âˆ‹‹˜Ø[™Y]KˆYˆÝÜ™YšYˆØ\ÙRYˆÝÜ™Y˜Ø\ÙRYˆÙ[XÝYˆYKˆJNÂˆBˆÛÛœÝØ[™Y]TØÚ[XU˜[YH™YÚ\ÝžOË˜Ø[™Y]TØÚ[XU˜[YOOHYNÂˆÛÛœÝÙ[XÝ[Û•˜[YHÙ[XÝY›[™Ýˆ	‰ˆZ\ÜÝY\ËœÛÛYJ
][JHOˆ][K˜ÛÙHOOH	ÜÙ[XÝYØXØÛÝ[ÜÝ[IÊNÂˆ™]\›ˆÂˆ‹‹œ™YÚ\ÝžKˆØ[™Y]TØÚ[XU˜[YˆÙ[XÝ[Û•˜[Yˆ˜[YˆØ[™Y]TØÚ[XU˜[Y	‰ˆÙ[XÝ[Û•˜[YˆÙ[XÝYˆ\ÜÝY\ËˆNÂŸB‚™[˜Ý[Ûˆ\ÜÙ\˜[Y\Ü]T\Y\ÊÝ[K\T›ÝÜÈH×JHÂˆÛÛœÝ™YÚ\ÝžHH\Ü]T™YÚ\ÝžUÚ]Ù[XÝ[ÛŠÝ[OË—Ñ\Ü]WÔ\Y\Ë\T›ÝÜÊNÂˆYˆ
\Ý[OË—Ñ\Ü]WÔ\Y\ÊH›ÝÈ\\œ›ÜŠ	ÔØ[\Ù›Ü˜ÙH\Ü]H\HØ[™Y]\ÈÛÝ[›Ý™H™\ÛÛ™Y‰ËLŠNÂˆYˆ
™YÚ\ÝžK˜[Y
H™]\›ˆ™YÚ\ÝžNÂˆÛÛœÝY\ÜØYÙ\ÈH™YÚ\ÝžKš\ÜÝY\Ë›X\

][JHOˆ][K›Y\ÜØYÙJK™š[\Š›ÛÛX[ŠNÂˆYˆ
\™YÚ\ÝžKœÙ[XÝ[Û•˜[Y	‰ˆ[Y\ÜØYÙ\Ë›[™Ý
HY\ÜØYÙ\Ëœ\Ú
	ÔÙ[XÝ]X\ÝÛ™H\Ü]YXØÛÝ[‰ÊNÂˆ›ÝÈ\\œ›ÜŠÛÜœ™XÝH\Ü]H\HÙ[XÝ[Ûˆ™Y›Ü™HÛÛ[Z[™Îˆ	ÛY\ÜØYÙ\Ëš›Ú[Š	È	Ê_X
NÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØYÝ\œ™[\Ü]TÝ[JÝ[RYXØÙ\ÜÐÛÛ^
HÂˆÛÛœÝ™\Ý[H]ØZ]Ø[\Ù›Ü˜ÙQ\Ü]TÝ[\ÊÈÝ[RY[Z]ˆLK[XØÙ\ÜÐÛÛ^
NÂˆÛÛœÝÝ[HH
™\Ý[œ›ÝÜÈ×JK™š[™

›ÝÊHOˆ\Ü]TØ[\Ù›Ü˜ÙRYÙ^J›ÝË’Y
HOOH\Ü]TØ[\Ù›Ü˜ÙRYÙ^JÝ[RY
JNÂˆYˆ
\Ý[JH›ÝÈ\\œ›ÜŠ	ÕH\Ü]YÝ[HÛÝ[›Ý™H›Ý[™[ˆHÝ\œ™[Ø[\Ù›Ü˜ÙH\Ü]H]Y]YK‰Ë
NÂˆ™]\›ˆÝ[NÂŸB‚™[˜Ý[ÛˆØ[›ÛšXØ[\Ü]PXÝ[Û•\™Ù]
[œ]\TÚYK™YÚ\ÝžJHÂˆÛÛœÝXØÛÝ[YHÝš[™Ê[œ]œ\PXØÛÝ[Y[œ]œ\WØXØÛÝ[ÚY	ÉÊKš[J
NÂˆYˆ
XXØÛÝ[Y
H›ÝÈ\\œ›ÜŠ	ÐHØ[\Ù›Ü˜ÙH\HXØÛÝ[Q\È™\]Z\™Y›Üˆ]™\žH\Ü]HXÝ[Û‹‰Ë
NÂˆÛÛœÝØ[™Y]HHš[™\Ü]T\J™YÚ\ÝžK\TÚYKXØÛÝ[Y
NÂˆÛÛœÝ\HH
™YÚ\ÝžOËœÙ[XÝY×JK™š[™

Ù[XÝY
HOˆÙ[XÝY˜XØÛÝ[Ù^HOOHØ[™Y]OË˜XØÛÝ[Ù^JNÂˆYˆ
XØ[™Y]H\\JH›ÝÈ\\œ›ÜŠHÙ[XÝY	Ü\TÚY_HXØÛÝ[\È›ÝÙ[XÝY›Üˆ\È\Ü]Kˆ™Yœ™\Ú[™Ù[XÝH\HYØZ[‹˜
NÂˆ™]\›ˆ\NÂŸB‚™[˜Ý[Ûˆ›Ü›X[^™Q\Ü]P™]TÝ]\Ê˜[YK[ÝÙY˜[˜XÚÊHÂˆÛÛœÝ˜]ÈHÝš[™Ê˜[YH	ÉÊKš[J
NÂˆ™]\›ˆ[ÝÙYš[˜ÛY\Ê˜]ÊHÈ˜]Èˆ˜[˜XÚÎÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÐØ\Xš[]Y\ÊÛY[›Ùš[HHßJHÂˆÛÛœÝÚ\Ð\›Ý™\‹\ÐXØÛÝ[[™×HH]ØZ]›ÛZ\ÙK˜[
Ý\Ù\’\ÐØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×Ø\›Ý™IÊK\Ù\’\ÐØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×ØXØÛÝ[	ÊWJNÂˆÛÛœÝØ[XØÙ\^\›˜[ÛÜÝ\™HH›Ùš[K\Ù\—Ý\HOOH	ØYZ[š\Ý˜]Ü‰Âˆ
›Ùš[K\Ù\—Ý\HOOH	ÙÙ[™\˜[ÛX[˜YÙ\‰È	‰ˆ
]ØZ]ØYXÝ]™QÙ[™\˜[X[˜YÙ\ŠÛY[
JKšYOOH›Ùš[KšY
NÂˆ™]\›ˆÂˆ›ÛNˆ›Ùš[K\Ù\—Ý\H	Ý\Ù\‰ËˆØ[”™\\™NˆYKˆØ[\›Ý™Nˆ\Ð\›Ý™\‹ˆØ[XØÛÝ[ˆ\ÐXØÛÝ[[™ËˆØ[ÛÜÙNˆ\ÐXØÛÝ[[™ËˆØ[XØÙ\^\›˜[ÛÜÝ\™KˆØ[•šY]Ð[[\ÎˆYKˆNÂŸB‚™[˜Ý[Ûˆ\Ü]P™]PØ\ÙQœ›ÛTÝ[JÝ[HHßJHÂˆ™]\›ˆÂˆÝ[WÚYˆÝ[K’YˆÝ[WÛ˜[YNˆÝ[K—Ñ\Ü^WÓ˜[YHÝ[K“˜[YHÝ[K’Ù^TÝ[W×ØÈÝ[K’Yˆ^Y\—Û˜[YNˆÝ[K—Ð^Y\—Ó˜[YHÝ[K^Y\—Ó˜[YW×ØÈ[ˆÝ\Y\—Û˜[Y\ÎˆÝ[K—ÔÝ\Y\—Ó˜[Y\È[ˆÝ\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\ÎˆÝ[K‘\Ü]WÔÝ]\××ØÈ[ˆNÂŸB‚™[˜Ý[ÛˆYØXÞPÛÜÙY\Ü]PØ\ÙJÝ[HHßJHÂˆÛÛœÝØ[\Ù›Ü˜ÙTÝ]\ÈHÝš[™ÊÝ[K‘\Ü]WÔÝ]\××ØÈ	ÉÊKš[J
NÂˆYˆ
Z\ÔØ[\Ù›Ü˜ÙQ\Ü]PÛÜÙY
Ø[\Ù›Ü˜ÙTÝ]\ÊJH™]\›ˆ[Âˆ™]\›ˆÂˆYˆ[ˆÝ[RYˆÝ[K’YˆÝ[S˜[YNˆÝ[K—Ñ\Ü^WÓ˜[YHÝ[K“˜[YHÝ[K’Ù^TÝ[W×ØÈÝ[K’Yˆ^Y\“˜[YNˆÝ[K—Ð^Y\—Ó˜[YHÝ[K^Y\—Ó˜[YW×ØÈ	ÉËˆÝ\Y\“˜[Y\ÎˆÝ[K—ÔÝ\Y\—Ó˜[Y\È	ÉËˆÝ\œ™[Ø[\Ù›Ü˜ÙTÝ]\ÎˆØ[\Ù›Ü˜ÙTÝ]\ËˆÛÜšÙ›ÝÔÝ]\Îˆ	ÐÛÜÙY	Ëˆ\›Ý˜[Ý]\Îˆ	Ð\›Ý™Y	Ëˆ]\Ý›ÝNˆ	ÐÛÜÙY[ˆØ[\Ù›Ü˜ÙH™Y›Ü™HÓÔÈÛÜšÙ›ÝÈ˜XÚÚ[™Ë‰ËˆÙ][Y[š[˜[˜ÚX[ÎˆßKˆÙ][Y[›ˆˆØ[\Ù›Ü˜ÙUÜš]X˜XÚÔÝ]\Îˆ	ÛYØXÞIËˆYØXÞT™XYÛ›NˆYKˆNÂŸB‚™[˜Ý[ÛˆÙ\šX[^™Q\Ü]P™]PØ\ÙJ›ÝÊHÂˆYˆ
\›ÝÊH™]\›ˆ[Âˆ™]\›ˆÂˆYˆ›ÝËšYˆÝ[RYˆ›ÝËœÝ[WÚYˆÝ[S˜[YNˆ›ÝËœÝ[WÛ˜[YH	ÉËˆ^Y\“˜[YNˆ›ÝË˜^Y\—Û˜[YH	ÉËˆÝ\Y\“˜[Y\Îˆ›ÝËœÝ\Y\—Û˜[Y\È	ÉËˆÝ\œ™[Ø[\Ù›Ü˜ÙTÝ]\Îˆ›ÝË˜Ý\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\È	ÉËˆÛÜšÙ›ÝÔÝ]\Îˆ›ÝËÛÜšÙ›Ý×ÜÝ]\È	Ñ˜Y	Ëˆ\›Ý˜[Ý]\Îˆ›ÝË˜\›Ý˜[ÜÝ]\È	Ñ˜Y	Ëˆ]\Ý›ÝNˆ›ÝË›]\ÝÛ›ÝH	ÉËˆÝX›Z]YžNˆ›ÝËœÝX›Z]YØžH[ˆÝX›Z]YžQ[XZ[ˆ›ÝËœÝX›Z]YØžWÙ[XZ[[ˆÝX›Z]Y]ˆ›ÝËœÝX›Z]YØ][ˆ\›Ý™YžNˆ›ÝË˜\›Ý™YØžH[ˆ\›Ý™YžQ[XZ[ˆ›ÝË˜\›Ý™YØžWÙ[XZ[[ˆ\›Ý™Y]ˆ›ÝË˜\›Ý™YØ][ˆ™Z™XÝYžNˆ›ÝËœ™Z™XÝYØžH[ˆ™Z™XÝYžQ[XZ[ˆ›ÝËœ™Z™XÝYØžWÙ[XZ[[ˆ™Z™XÝY]ˆ›ÝËœ™Z™XÝYØ][ˆ™Z™XÝ[Û”™X\ÛÛŽˆ›ÝËœ™Z™XÝ[Û—Ü™X\ÛÛˆ[ˆÛÜÙYžNˆ›ÝË˜ÛÜÙYØžH[ˆÛÜÙYžQ[XZ[ˆ›ÝË˜ÛÜÙYØžWÙ[XZ[[ˆÛÜÙY]ˆ›ÝË˜ÛÜÙYØ][ˆÙ][Y[š[˜[˜ÚX[Îˆ›ÝËœÙ][Y[Ùš[˜[˜ÚX[ÈßKˆÙ][Y[›ˆ[X™\Š›ÝËœÙ][Y[Ü›
KˆØ[\Ù›Ü˜ÙUÜš]X˜XÚÔÝ]\Îˆ›ÝËœØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×ÜÝ]\È	Û›ÝÜÝ\Y	ËˆØ[\Ù›Ü˜ÙUÜš]X˜XÚÑ\œ›ÜŽˆ›ÝËœØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×Ù\œ›Üˆ[ˆ^\›˜[ÛÜÝ\™Q]XÝY]ˆ›ÝË™^\›˜[ØÛÜÝ\™WÙ]XÝYØ][ˆ^\›˜[ÛÜÝ\™TØ[\Ù›Ü˜ÙTÝ]\Îˆ›ÝË™^\›˜[ØÛÜÝ\™WÜØ[\Ù›Ü˜ÙWÜÝ]\È[ˆ^\›˜[ÛÜÝ\™TØ[\Ù›Ü˜ÙS[ÙYšYY]ˆ›ÝË™^\›˜[ØÛÜÝ\™WÜØ[\Ù›Ü˜ÙWÛ[ÙYšYYØ][ˆ^\›˜[ÛÜÝ\™PXØÙ\Y]ˆ›ÝË™^\›˜[ØÛÜÝ\™WØXØÙ\YØ][ˆ^\›˜[ÛÜÝ\™PXØÙ\YžNˆ›ÝË™^\›˜[ØÛÜÝ\™WØXØÙ\YØžH[ˆ^\›˜[ÛÜÝ\™PXØÙ\YžQ[XZ[ˆ›ÝË™^\›˜[ØÛÜÝ\™WØXØÙ\YØžWÙ[XZ[[ˆ^\›˜[ÛÜÝ\™PXØÙ\[˜ÙT™X\ÛÛŽˆ›ÝË™^\›˜[ØÛÜÝ\™WØXØÙ\[˜ÙWÜ™X\ÛÛˆ[ˆÜ™X]Y]ˆ›ÝË˜Ü™X]YØ][ˆ\]Y]ˆ›ÝË\]YØ][ˆNÂŸB‚™[˜Ý[ÛˆÙ\šX[^™Q\Ü]TÝ\Y\’[œÝXÝ[ÛŠ›ÝÊHÂˆYˆ
\›ÝÊH™]\›ˆ[Âˆ™]\›ˆÂˆYˆ›ÝËšYˆØ\ÙRYˆ›ÝË˜Ø\ÙWÚYˆXÝ[Û’Yˆ›ÝË˜XÝ[Û—ÚYˆ\RYˆ›ÝËœ\WÚYˆÝ[RYˆ›ÝËœÝ[WÚYˆ[œÝXÝ[Û•\Nˆ›ÝËš[œÝXÝ[Û—Ý\Kˆ[œÝXÝ[Û“X™[ˆ›ÝËš[œÝXÝ[Û—Ý\HOOH	ÝÚ]ÛÝ[œZY	ÈÈ	ÑÈ›Ý^IÈˆ	ÑÙ]˜XÚÈZY[[Ý[	Ëˆ™XÛÝ™\žSY]Ùˆ›ÝËœ™XÛÝ™\žWÛY]Ù[ˆÛÝ\˜ÙTÝ\Y\’[›ÚXÙRYˆ›ÝËœÛÝ\˜ÙWÜÝ\Y\—Ú[›ÚXÙWÚYˆÛÝ\˜ÙTÝ\Y\’[›ÚXÙS˜[YNˆ›ÝËœÛÝ\˜ÙWÜÝ\Y\—Ú[›ÚXÙWÛ˜[YH	ÉËˆÛÝ\˜ÙTÝ[RYˆ›ÝËœÛÝ\˜ÙWÜÝ[WÚY›ÝËœÝ[WÚYˆ\™Ù]Ý\Y\’[›ÚXÙRYˆ›ÝË\™Ù]ÜÝ\Y\—Ú[›ÚXÙWÚY[ˆ\™Ù]Ý\Y\’[›ÚXÙS˜[YNˆ›ÝË\™Ù]ÜÝ\Y\—Ú[›ÚXÙWÛ˜[YH	ÉËˆ\™Ù]Ý[RYˆ›ÝË\™Ù]ÜÝ[WÚY[ˆÝ\œ™[˜ÞR\ÛÐÛÙNˆ›ÝË˜Ý\œ™[˜ÞWÚ\Û×ØÛÙH	ÕTÑ	Ëˆ[›™Y[[Ý[ˆ[X™\Š›ÝËœ[›™YØ[[Ý[
Kˆ[ØØ]Y[[Ý[ˆ[X™\Š›ÝË˜[ØØ]YØ[[Ý[
KˆÛÝ\˜ÙR[›ÚXÙP[[Ý[Û˜\ÚÝˆ[X™\Š›ÝËœÛÝ\˜ÙWÚ[›ÚXÙWØ[[Ý[ÜÛ˜\ÚÝ
KˆÛÝ\˜ÙT^XX›P˜[[˜ÙTÛ˜\ÚÝˆ[X™\Š›ÝËœÛÝ\˜ÙWÜ^XX›WØ˜[[˜ÙWÜÛ˜\ÚÝ
KˆÛÝ\˜ÙTZY[[Ý[Û˜\ÚÝˆ[X™\Š›ÝËœÛÝ\˜ÙWÜZYØ[[Ý[ÜÛ˜\ÚÝ
Kˆ\™Ù][›ÚXÙP[[Ý[Û˜\ÚÝˆ›ÝË\™Ù]Ú[›ÚXÙWØ[[Ý[ÜÛ˜\ÚÝOH[È[ˆ[X™\Š›ÝË\™Ù]Ú[›ÚXÙWØ[[Ý[ÜÛ˜\ÚÝ
Kˆ\™Ù]^XX›P[[Ý[Û˜\ÚÝˆ›ÝË\™Ù]Ü^XX›WØ[[Ý[ÜÛ˜\ÚÝOH[È[ˆ[X™\Š›ÝË\™Ù]Ü^XX›WØ[[Ý[ÜÛ˜\ÚÝ
KˆÛÝ\˜ÙR[›ÚXÙTÛ˜\ÚÝˆ›ÝËœÛÝ\˜ÙWÚ[›ÚXÙWÜÛ˜\ÚÝßKˆÛÝ\˜ÙTÝ[TÛ˜\ÚÝˆ›ÝËœÛÝ\˜ÙWÜÝ[WÜÛ˜\ÚÝßKˆ\™Ù][›ÚXÙTÛ˜\ÚÝˆ›ÝË\™Ù]Ú[›ÚXÙWÜÛ˜\ÚÝßKˆ\™Ù]Ý[TÛ˜\ÚÝˆ›ÝË\™Ù]ÜÝ[WÜÛ˜\ÚÝßKˆ^[Y[Û˜\ÚÝˆ›ÝËœ^[Y[ÜÛ˜\ÚÝßKˆ[ØØ][Û‘š[™Ù\œš[ˆ›ÝË˜[ØØ][Û—Ùš[™Ù\œš[	ÉËˆÝ]\Îˆ›ÝËœÝ]\È	Ô[™[™ÈXØÛÝ[[™ÉËˆX]ÚYØ[\Ù›Ü˜ÙT^[Y[Yˆ›ÝË›X]ÚYÜØ[\Ù›Ü˜ÙWÜ^[Y[ÚY[ˆX]Ú[™Ô^[Y[Û˜\ÚÝˆ›ÝË›X]Ú[™×Ü^[Y[ÜÛ˜\ÚÝßKˆ[œÝXÝ[Û”™Y™\™[˜ÙNˆ›ÝËš[œÝXÝ[Û—Ü™Y™\™[˜ÙH	ÉËˆ[œÝXÝ[Û‘]Nˆ›ÝËš[œÝXÝ[Û—Ù]H[ˆ[œÝXÝ[Û[[Ý[ˆ›ÝËš[œÝXÝ[Û—Ø[[Ý[OH[È[ˆ[X™\Š›ÝËš[œÝXÝ[Û—Ø[[Ý[
KˆÙ][Y[™Y™\™[˜ÙNˆ›ÝËœÙ][Y[Ü™Y™\™[˜ÙH	ÉËˆÙ][Y[]Nˆ›ÝËœÙ][Y[Ù]H[ˆÙ][Y[[[Ý[ˆ›ÝËœÙ][Y[Ø[[Ý[OH[È[ˆ[X™\Š›ÝËœÙ][Y[Ø[[Ý[
KˆXØÛÝ[[™Ó›ÝNˆ›ÝË˜XØÛÝ[[™×Û›ÝH	ÉËˆ™]š\Ú[ÛŽˆ[X™\Š›ÝËœ™]š\Ú[ÛˆJKˆXÚÛ›ÝÛYÙYžNˆ›ÝË˜XÚÛ›ÝÛYÙYØžH[ˆXÚÛ›ÝÛYÙYžQ[XZ[ˆ›ÝË˜XÚÛ›ÝÛYÙYØžWÙ[XZ[[ˆXÚÛ›ÝÛYÙY]ˆ›ÝË˜XÚÛ›ÝÛYÙYØ][ˆÙ]YžNˆ›ÝËœÙ]YØžH[ˆÙ]YžQ[XZ[ˆ›ÝËœÙ]YØžWÙ[XZ[[ˆÙ]Y]ˆ›ÝËœÙ]YØ][ˆÜ™X]Y]ˆ›ÝË˜Ü™X]YØ][ˆ\]Y]ˆ›ÝË\]YØ][ˆNÂŸB‚™[˜Ý[ÛˆÙ\šX[^™Q\Ü]P™]PXÝ[ÛŠ›ÝË\SX\H™]ÈX\

K[œÝXÝ[Û”›ÝÜÈH×JHÂˆYˆ
\›ÝÊH™]\›ˆ[ÂˆÛÛœÝ\HH\SX\™Ù]
›ÝËœ\WÚY
H[ÂˆÛÛœÝXÝ[Û•\HH›ÝË˜XÝ[Û—Ý\NÂˆÛÛœÝÝ\Y\’[œÝXÝ[ÛœÈH[œÝXÝ[Û”›ÝÜË™š[\Š
[œÝXÝ[ÛŠHOˆ[œÝXÝ[Û‹˜XÝ[Û—ÚYOOH›ÝËšY	‰ˆ[œÝXÝ[Û‹œÝ]\ÈOOH	ÔÝ\\œÙYY	ÊK›X\
Ù\šX[^™Q\Ü]TÝ\Y\’[œÝXÝ[ÛŠNÂˆÛÛœÝ[›ÚXÙP[ØØ][Û“X\H™]ÈX\

NÂˆ›Üˆ
ÛÛœÝ[œÝXÝ[ÛˆÙˆÝ\Y\’[œÝXÝ[ÛœÊHÂˆÛÛœÝ^\Ý[™ÈH[›ÚXÙP[ØØ][Û“X\™Ù]
[œÝXÝ[Û‹œÛÝ\˜ÙTÝ\Y\’[›ÚXÙRY
HÂˆÝ\Y\’[›ÚXÙRYˆ[œÝXÝ[Û‹œÛÝ\˜ÙTÝ\Y\’[›ÚXÙRYˆ[›ÚXÙS˜[YNˆ[œÝXÝ[Û‹œÛÝ\˜ÙTÝ\Y\’[›ÚXÙS˜[YKˆ[[Ý[ˆ[œÝXÝ[Û‹˜[ØØ]Y[[Ý[ˆNÂˆ^\Ý[™Ë˜[[Ý[HX]›X^
^\Ý[™Ë˜[[Ý[[œÝXÝ[Û‹˜[ØØ]Y[[Ý[
NÂˆ[›ÚXÙP[ØØ][Û“X\œÙ]
[œÝXÝ[Û‹œÛÝ\˜ÙTÝ\Y\’[›ÚXÙRY^\Ý[™ÊNÂˆBˆÛÛœÝÛÜÙT™X\ÛÛˆHXÝ[Û•\HOOH	ØÛÜÙWÜÝ\Y\—Ù\Ü]IÈÈØ[›ÛšXØ[\Ü]P™]PÛÜÙT™X\ÛÛŠ›ÝË˜ÛÜÙWÜ™X\ÛÛ‹TÔUWÐ‘UWÔÕTQT—ÐÓÔÑWÔ‘PTÓÓ”ÊHˆXÝ[Û•\HOOH	ØÛÜÙWØ^Y\—Ù\Ü]IÈÈØ[›ÛšXØ[\Ü]P™]PÛÜÙT™X\ÛÛŠ›ÝË˜ÛÜÙWÜ™X\ÛÛ‹TÔUWÐ‘UWÐ•VQT—ÐÓÔÑWÔ‘PTÓÓ”ÊHˆ›ÝË˜ÛÜÙWÜ™X\ÛÛŽÂˆ™]\›ˆÂˆYˆ›ÝËšYˆØ\ÙRYˆ›ÝË˜Ø\ÙWÚYˆÝ[RYˆ›ÝËœÝ[WÚYˆ\RYˆ›ÝËœ\WÚYˆ\TÚYNˆ›ÝËœ\WÜÚYKˆ\U\Nˆ›ÝËœ\WÜÚYKˆ\S˜[YNˆ\OË˜XØÛÝ[Û˜[YH\OË›˜[YH	ÉËˆ\PXØÛÝ[Yˆ\OË˜XØÛÝ[ÚY\OË˜XØÛÝ[Y[ˆ\RÙ^Nˆ\OË˜XØÛÝ[ÚYÈXØÛÝ[‰Ü\K˜XØÛÝ[ÚYXˆ\OË˜XØÛÝ[YÈXØÛÝ[‰Ü\K˜XØÛÝ[YXˆ[ˆ\T›Û\Îˆ\OËœ›Û\È×KˆXÝ[Û•\KˆXÝ[Û“X™[ˆTÔUWÐ‘UWÐPÕSÓ—ÓP‘SÖØXÝ[Û•\WH›ÝË˜XÝ[Û—ÛX™[XÝ[Û•\Kˆ[[Ý[ˆ›ÝË˜[[Ý[OH[È[ˆ[X™\Š›ÝË˜[[Ý[
Kˆ\Ü]P[[Ý[ˆ›ÝË˜[[Ý[OH[È[ˆ[X™\Š›ÝË˜[[Ý[
KˆÝ\œ™[˜ÞR\ÛÐÛÙNˆÝ\Y\’[œÝXÝ[ÛœÖÌOË˜Ý\œ™[˜ÞR\ÛÐÛÙH	ÕTÑ	Ëˆ[›ÚXÙP[ØØ][ÛœÎˆË‹‹š[›ÚXÙP[ØØ][Û“X\˜[Y\Ê
WKˆÝ\Y\’[œÝXÝ[ÛœËˆÝ[Ó›Ý^NˆÝ\Y\’[œÝXÝ[ÛœË™š[\Š
[œÝXÝ[ÛŠHOˆ[œÝXÝ[Û‹š[œÝXÝ[Û•\HOOH	ÝÚ]ÛÝ[œZY	ÊKœ™YXÙJ
Ý[K[œÝXÝ[ÛŠHOˆÝ[H
È[œÝXÝ[Û‹œ[›™Y[[Ý[
KˆÝ[Ù]˜XÚÔZYˆÝ\Y\’[œÝXÝ[ÛœË™š[\Š
[œÝXÝ[ÛŠHOˆ[œÝXÝ[Û‹š[œÝXÝ[Û•\HOOH	ÙÙ]Ø˜XÚ×ÜZY	ÊKœ™YXÙJ
Ý[K[œÝXÝ[ÛŠHOˆÝ[H
È[œÝXÝ[Û‹œ[›™Y[[Ý[
KˆÝ\Y\‘\Ü]P[[Ý[™\]Z\™Yˆ›ÝËœ\WÜÚYHOOH	ÜÝ\Y\‰È	‰ˆTÔUWÓQÐPÖWÔÕTQT—Ñ’SSÒPSÐPÕSÓ”Ëš\Ê›ÝË˜XÝ[Û—Ý\JH	‰ˆ›ÝË˜[[Ý[OH[ˆÝ\Y\’[œÝXÝ[ÛÛÛ™\œÚ[Û”™\]Z\™Yˆ›ÝËœ\WÜÚYHOOH	ÜÝ\Y\‰È	‰ˆ›ÝË˜[[Ý[OH[	‰ˆTÔUWÓQÐPÖWÔÕTQT—Ñ’SSÒPSÐPÕSÓ”Ëš\Ê›ÝË˜XÝ[Û—Ý\JKˆÜXÚX[Ù[šXÙNˆ›ÝËœÜXÚX[ÜÙ[ÜšXÙHOH[È[ˆ[X™\Š›ÝËœÜXÚX[ÜÙ[ÜšXÙJKˆÜXÚX[^TšXÙNˆ›ÝËœÜXÚX[Ø^WÜšXÙHOH[È[ˆ[X™\Š›ÝËœÜXÚX[Ø^WÜšXÙJKˆ]X[]Nˆ›ÝËœ]X[]HOH[È[ˆ[X™\Š›ÝËœ]X[]JKˆ]X[]U[š]ˆ›ÝËœ]X[]WÝ[š]	ÓU	ËˆÛÜÙT™X\ÛÛŽˆÛÜÙT™X\ÛÛˆ[ˆ˜[[˜ÙT^[Y[[œÝXÝ[ÛŽˆ›ÝË˜˜[[˜ÙWÜ^[Y[Ú[œÝXÝ[Ûˆ[ˆ\ØÜš\[ÛŽˆ›ÝË™\ØÜš\[Ûˆ	ÉËˆ™\]Z\™\Ð]XÚY[ˆ›ÝËœ™\]Z\™\×Ø]XÚY[OOHYKˆXØÛÝ[[™ÔÝ]\Îˆ›ÝË™^XÝ][Û—ÜÝ]\È	Ô[™[™ÈXØÛÝ[[™ÉËˆ^XÝ][Û”Ý]\Îˆ›ÝË™^XÝ][Û—ÜÝ]\È	Ô[™[™ÈXØÛÝ[[™ÉËˆ[œÝXÝ[Û”™Y™\™[˜ÙNˆ›ÝËš[œÝXÝ[Û—Ü™Y™\™[˜ÙH	ÉËˆ[œÝXÝ[Û‘]Nˆ›ÝËš[œÝXÝ[Û—Ù]H[ˆ[œÝXÝ[Û[[Ý[ˆ›ÝËš[œÝXÝ[Û—Ø[[Ý[OH[È[ˆ[X™\Š›ÝËš[œÝXÝ[Û—Ø[[Ý[
KˆÙ][Y[™Y™\™[˜ÙNˆ›ÝËœÙ][Y[Ü™Y™\™[˜ÙH	ÉËˆÙ][Y[]Nˆ›ÝËœÙ][Y[Ù]H[ˆÙ][Y[[[Ý[ˆ›ÝËœÙ][Y[Ø[[Ý[OH[È[ˆ[X™\Š›ÝËœÙ][Y[Ø[[Ý[
KˆXØÛÝ[[™Ó›ÝNˆ›ÝË˜XØÛÝ[[™×Û›ÝH	ÉËˆXØÛÝ[[™ÐžNˆ›ÝË˜XØÛÝ[[™×ØžH[ˆXØÛÝ[[™ÐžQ[XZ[ˆ›ÝË˜XØÛÝ[[™×ØžWÙ[XZ[[ˆXØÛÝ[[™Ð]ˆ›ÝË˜XØÛÝ[[™×Ø][ˆ^XÝ]YžNˆ›ÝË™^XÝ]YØžH[ˆ^XÝ]YžQ[XZ[ˆ›ÝË™^XÝ]YØžWÙ[XZ[[ˆ^XÝ]Y]ˆ›ÝË™^XÝ]YØ][ˆ^XÝ][Û“›ÝNˆ›ÝË™^XÝ][Û—Û›ÝH[ˆ[šÙYYÜ™YYÛÛ\[œØ][Û’Yˆ›ÝË›[šÙYØYÜ™YYØÛÛ\[œØ][Û—ÚY[ˆ[šÙYÛÛ\[œØ][Û”Û˜\ÚÝˆ›ÝË›[šÙYØÛÛ\[œØ][Û—ÜÛ˜\ÚÝßKˆ[šÙYÛÛ\[œØ][ÛžNˆ›ÝË›[šÙYØÛÛ\[œØ][Û—ØžH[ˆ[šÙYÛÛ\[œØ][ÛžQ[XZ[ˆ›ÝË›[šÙYØÛÛ\[œØ][Û—ØžWÙ[XZ[[ˆ[šÙYÛÛ\[œØ][Û]ˆ›ÝË›[šÙYØÛÛ\[œØ][Û—Ø][ˆÜ™X]YžNˆ›ÝË˜Ü™X]YØžH[ˆÜ™X]YžQ[XZ[ˆ›ÝË˜Ü™X]YØžWÙ[XZ[[ˆ\]YžNˆ›ÝË\]YØžH[ˆ\]YžQ[XZ[ˆ›ÝË\]YØžWÙ[XZ[[ˆÜ™X]Y]ˆ›ÝË˜Ü™X]YØ][ˆ\]Y]ˆ›ÝË\]YØ][ˆNÂŸB‚™[˜Ý[ÛˆÙ\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
›ÝÊHÂˆYˆ
\›ÝÊH™]\›ˆ[ÂˆÛÛœÝš[S˜[YHH›ÝËœÛX\Ùš[[˜[YH›ÝË›ÜšYÚ[˜[Ùš[[˜[YH	Ñ\Ü]HØÝ[Y[	ÎÂˆÛÛœÝ™\œÚ[Û’YH›ÝËœØ[\Ù›Ü˜ÙWØÛÛ[Ý™\œÚ[Û—ÚYÂˆ™]\›ˆÂˆYˆ›ÝËšYˆØ\ÙRYˆ›ÝË˜Ø\ÙWÚYˆXÝ[Û’Yˆ›ÝË˜XÝ[Û—ÚY[ˆÝ\Y\’[œÝXÝ[Û’Yˆ›ÝËœÝ\Y\—Ú[œÝXÝ[Û—ÚY[ˆ\RYˆ›ÝËœ\WÚYˆÝ[RYˆ›ÝËœÝ[WÚYˆ\TÚYNˆ›ÝËœ\WÜÚYKˆ\U\Nˆ›ÝËœ\WÜÚYKˆ\S˜[YNˆ›ÝËœ\WÛ˜[YH	ÉËˆ\PXØÛÝ[Yˆ›ÝËœ\WØXØÛÝ[ÚY[ˆØÝ[Y[\™XÝ[ÛŽˆ›ÝË™ØÝ[Y[Ù\™XÝ[Û‹ˆØÝ[Y[\Nˆ›ÝË™ØÝ[Y[Ý\KˆÜšYÚ[˜[š[S˜[YNˆ›ÝË›ÜšYÚ[˜[Ùš[[˜[YKˆ™\]Y\ÝYš[S˜[YNˆ›ÝËœ™\]Y\ÝYÙš[[˜[YHš[S˜[YKˆš[S˜[YKˆÛX\š[S˜[YNˆš[S˜[YKˆÛÛ[\Nˆ›ÝË˜ÛÛ[Ý\H	Ø\XØ][Û‹ÛØÝ]\Ý™X[IËˆš[Q^[œÚ[ÛŽˆ›ÝË™š[WÙ^[œÚ[Ûˆ	ÉËˆÛÛ[Ú^™Nˆ[X™\Š›ÝË˜ÛÛ[ÜÚ^™H
KˆÛÛ[™\œÚ[Û’Yˆ™\œÚ[Û’YˆÛÛ[ØÝ[Y[Yˆ›ÝËœØ[\Ù›Ü˜ÙWØÛÛ[ÙØÝ[Y[ÚY[ˆ[šÙY™XÛÜ™Yˆ›ÝËœØ[\Ù›Ü˜ÙWÛ[šÙYÜ™XÛÜ™ÚYˆ[šÙY™XÛÜ™YÎˆ›ÝËœØ[\Ù›Ü˜ÙWÛ[šÙYÜ™XÛÜ™ÚYÈÜ›ÝËœØ[\Ù›Ü˜ÙWÛ[šÙYÜ™XÛÜ™ÚYHˆ×Kˆ\ØYÝ]\Îˆ›ÝË\ØYÜÝ]\È	ØÛÛ\]IËˆØ[\Ù›Ü˜ÙU\›ˆ›ÝËœØ[\Ù›Ü˜ÙWÝ\›[ˆÝÛ›ØY\›ˆØ\KÙ[˜Ý[ÛœËÜØ[\Ù›Ü˜ÙQØÝ[Y[ÝÛ›ØYÚÚ[™XÛÛ[™\œÚ[Û‰šYIÙ[˜ÛÙUT’PÛÛ\Û™[
™\œÚ[Û’Y
_I™š[[˜[YOIÙ[˜ÛÙUT’PÛÛ\Û™[
š[S˜[YJ_Xˆ\ØYYžNˆ›ÝË\ØYYØžH[ˆ\ØYYžQ[XZ[ˆ›ÝË\ØYYØžWÙ[XZ[[ˆÜ™X]Y]ˆ›ÝË˜Ü™X]YØ][ˆNÂŸB‚™[˜Ý[ÛˆÙ\šX[^™Q\Ü]P™]Q]™[
›ÝÊHÂˆYˆ
\›ÝÊH™]\›ˆ[Âˆ™]\›ˆÂˆYˆ›ÝËšYˆØ\ÙRYˆ›ÝË˜Ø\ÙWÚYˆXÝ[Û’Yˆ›ÝË˜XÝ[Û—ÚY[ˆÝ[RYˆ›ÝËœÝ[WÚYˆ]™[\Nˆ›ÝË™]™[Ý\Kˆ›ÝNˆ›ÝË››ÝH	ÉËˆY]Y]Nˆ›ÝË›Y]Y]HßKˆXÝÜ•\Ù\’Yˆ›ÝË˜XÝÜ—Ý\Ù\—ÚY[ˆXÝÜ‘[XZ[ˆ›ÝË˜XÝÜ—Ù[XZ[[ˆÜ™X]Y]ˆ›ÝË˜Ü™X]YØ][ˆNÂŸB‚™[˜Ý[Ûˆ\Ü]P™]PXÝ[Û”\U\JXÝ[Û•\K[œ]\U\JHÂˆYˆ
XÝ[Û•\HOOH	Ú\ÜÝYWØ^Y\—ØÜ™Y]Û›ÝIÈXÝ[Û•\HOOH	ØÛÜÙWØ^Y\—Ù\Ü]IÊH™]\›ˆ	Ø^Y\‰ÎÂˆYˆ
XÝ[Û•\HOOH	ÚÛÜÝ\Y\—Ü^[Y[	ÈXÝ[Û•\HOOH	Ü^WÙ[ÜÝ\Y\—Ú[›ÚXÙIÈXÝ[Û•\HOOH	ÙYXÝÜÜXÚYšX×Ø[[Ý[	ÈXÝ[Û•\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÈXÝ[Û•\HOOH	ØÛÜÙWÜÝ\Y\—Ù\Ü]IÊH™]\›ˆ	ÜÝ\Y\‰ÎÂˆ™]\›ˆÝš[™Ê[œ]\U\H	ÉÊKÓÝÙ\Ø\ÙJ
HOOH	Ø^Y\‰ÈÈ	Ø^Y\‰Èˆ	ÜÝ\Y\‰ÎÂŸB‚™[˜Ý[Ûˆ›Ü›X[^™Q\Ü]P™]PXÝ[ÛŠ[œ]HßKØ\ÙT›ÝË›Ùš[HHßK™YÚ\ÝžJHÂˆÛÛœÝXÝ[Û•\HHÝš[™Ê[œ]˜XÝ[Û•\H[œ]˜XÝ[Û—Ý\H	ÉÊKš[J
NÂˆYˆ
QTÔUWÐ‘UWÐPÕSÓ—ÓP‘SÖØXÝ[Û•\WJH›ÝÈ\\œ›ÜŠ	Õ˜[Y\Ü]HÛÜšÙ›ÝÈXÝ[Ûˆ\H\È™\]Z\™Y‰Ë
NÂˆÛÛœÝ\TÚYHH\Ü]P™]PXÝ[Û”\U\JXÝ[Û•\K[œ]œ\TÚYH[œ]œ\WÜÚYH[œ]œ\U\H[œ]œ\WÝ\JNÂˆÛÛœÝ\HHØ[›ÛšXØ[\Ü]PXÝ[Û•\™Ù]
[œ]\TÚYK™YÚ\ÝžJNÂˆÛÛœÝ[[Ý[HXÚ[X[Ü“[
[œ]˜[[Ý[
NÂˆYˆ
XÝ[Û•\HOOH	ÙYXÝÜÜXÚYšX×Ø[[Ý[	È	‰ˆ[[Ý[OH[
H›ÝÈ\\œ›ÜŠ	ÑYXÝ[Ûˆ[[Ý[\È™\]Z\™Y‰Ë
NÂˆYˆ
XÝ[Û•\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÈ	‰ˆ
[[Ý[OH[[[Ý[H
JHÂˆ›ÝÈ\\œ›ÜŠ	Ñ[\ˆ[ˆYÜ™YYÝ\Y\ˆ™XÛÝ™\žH[[Ý[X›Ý™H™\›ËÜˆÚÛÜÙHÛÜÙH\Ü]HÚ]Ý\Y\ˆ
›È™XÛÝ™\žJK‰Ë
NÂˆBˆYˆ
XÝ[Û•\HOOH	Ú\ÜÝYWØ^Y\—ØÜ™Y]Û›ÝIÈ	‰ˆ
[[Ý[OH[[[Ý[H
JHÂˆ›ÝÈ\\œ›ÜŠ	Ñ[\ˆ[ˆYÜ™YY^Y\ˆÜ™Y]›ÝH[[Ý[X›Ý™H™\›ËÜˆÚÛÜÙHÛÜÙH\Ü]HÚ]^Y\ˆ
›ÈÜ™Y]›ÝJK‰Ë
NÂˆBˆÛÛœÝÛÜÙT™X\ÛÛ’[œ]HÝš[™Ê[œ]˜ÛÜÙT™X\ÛÛˆ[œ]˜ÛÜÙWÜ™X\ÛÛˆ	ÉÊKš[J
NÂˆÛÛœÝÛÜÙT™X\ÛÛˆHXÝ[Û•\HOOH	ØÛÜÙWÜÝ\Y\—Ù\Ü]IÈÈØ[›ÛšXØ[\Ü]P™]PÛÜÙT™X\ÛÛŠÛÜÙT™X\ÛÛ’[œ]TÔUWÐ‘UWÔÕTQT—ÐÓÔÑWÔ‘PTÓÓ”ÊHˆXÝ[Û•\HOOH	ØÛÜÙWØ^Y\—Ù\Ü]IÈÈØ[›ÛšXØ[\Ü]P™]PÛÜÙT™X\ÛÛŠÛÜÙT™X\ÛÛ’[œ]TÔUWÐ‘UWÐ•VQT—ÐÓÔÑWÔ‘PTÓÓ”ÊHˆÛÜÙT™X\ÛÛ’[œ][ÂˆYˆ
XÝ[Û•\HOOH	ØÛÜÙWÜÝ\Y\—Ù\Ü]IÈ	‰ˆQTÔUWÐ‘UWÔÕTQT—ÐÓÔÑWÔ‘PTÓÓ”Ëš[˜ÛY\ÊÛÜÙT™X\ÛÛŠJHÂˆ›ÝÈ\\œ›ÜŠ	Õ˜[YÝ\Y\ˆÛÜÙH™X\ÛÛˆ\È™\]Z\™Y‰Ë
NÂˆBˆYˆ
XÝ[Û•\HOOH	ØÛÜÙWØ^Y\—Ù\Ü]IÈ	‰ˆQTÔUWÐ‘UWÐ•VQT—ÐÓÔÑWÔ‘PTÓÓ”Ëš[˜ÛY\ÊÛÜÙT™X\ÛÛŠJHÂˆ›ÝÈ\\œ›ÜŠ	Õ˜[Y^Y\ˆÛÜÙH™X\ÛÛˆ\È™\]Z\™Y‰Ë
NÂˆBˆÛÛœÝ˜[[˜ÙT^[Y[[œÝXÝ[ÛˆHÝš[™Ê[œ]˜˜[[˜ÙT^[Y[[œÝXÝ[Ûˆ[œ]˜˜[[˜ÙWÜ^[Y[Ú[œÝXÝ[Ûˆ	ÉÊKš[J
H[ÂˆYˆ
˜[[˜ÙT^[Y[[œÝXÝ[Ûˆ	‰ˆQTÔUWÐ‘UWÐSSÑWÔVSQS•ÒS”Õ•PÕSÓ”Ëš[˜ÛY\Ê˜[[˜ÙT^[Y[[œÝXÝ[ÛŠJHÂˆ›ÝÈ\\œ›ÜŠ	Õ˜[Y˜[[˜ÙH^[Y[[œÝXÝ[Ûˆ\È™\]Z\™Y‰Ë
NÂˆBˆYˆ
XÝ[Û•\HOOH	ØÛÜÙWÜÝ\Y\—Ù\Ü]IÈ	‰ˆX˜[[˜ÙT^[Y[[œÝXÝ[ÛŠHÂˆ›ÝÈ\\œ›ÜŠ	Ð˜[[˜ÙH^[Y[[œÝXÝ[Ûˆ\È™\]Z\™YÚ[ˆÛÜÚ[™ÈHÝ\Y\ˆ\Ü]HÚ]Ý]™XÛÝ™\žK‰Ë
NÂˆBˆÛÛœÝÝ\œ™[˜ÞR\ÛÐÛÙHBˆÝš[™Ê[œ]˜Ý\œ™[˜ÞR\ÛÐÛÙH[œ]˜Ý\œ™[˜ÞWÚ\Û×ØÛÙH	ÕTÑ	ÊBˆš[J
BˆÕ\\Ø\ÙJ
H	ÕTÑ	ÎÂˆYˆ
XÝ[Û•\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÈ	‰ˆK×–ÐKV—^ÌßIË\Ý
Ý\œ™[˜ÞR\ÛÐÛÙJJHÂˆ›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ\Ü]HÝ\œ™[˜ÞH]\Ý™HH™YK[]\ˆTÓÈÛÙK‰Ë
NÂˆB‚ˆ™]\›ˆÂˆÝ[WÚYˆØ\ÙT›ÝËœÝ[WÚYˆ\WÚYˆ\KšYˆ\WÜÚYNˆ\TÚYKˆ\WØXØÛÝ[ÚÙ^Nˆ\K˜XØÛÝ[Ù^KˆXÝ[Û—Ý\NˆXÝ[Û•\KˆXÝ[Û—ÛX™[ˆTÔUWÐ‘UWÐPÕSÓ—ÓP‘SÖØXÝ[Û•\WKˆ[[Ý[ˆÜXÚX[ÜÙ[ÜšXÙNˆXÚ[X[Ü“[
[œ]œÜXÚX[Ù[šXÙHÏÈ[œ]œÜXÚX[ÜÙ[ÜšXÙJKˆÜXÚX[Ø^WÜšXÙNˆXÚ[X[Ü“[
[œ]œÜXÚX[^TšXÙHÏÈ[œ]œÜXÚX[Ø^WÜšXÙJKˆ]X[]NˆXÚ[X[Ü“[
[œ]œ]X[]JKˆ]X[]WÝ[š]ˆÝš[™Ê[œ]œ]X[]U[š][œ]œ]X[]WÝ[š]	ÓU	ÊKš[J
H	ÓU	ËˆÛÜÙWÜ™X\ÛÛŽˆÛÜÙT™X\ÛÛ‹ˆ˜[[˜ÙWÜ^[Y[Ú[œÝXÝ[ÛŽˆ˜[[˜ÙT^[Y[[œÝXÝ[Û‹ˆ\ØÜš\[ÛŽˆÝš[™Ê[œ]™\ØÜš\[Ûˆ	ÉÊKš[J
Kˆ™\]Z\™\×Ø]XÚY[ˆ›ÛÛX[Š[œ]œ™\]Z\™\Ð]XÚY[ÏÈ[œ]œ™\]Z\™\×Ø]XÚY[
Kˆ^XÝ][Û—ÜÝ]\Îˆ›Ü›X[^™Q\Ü]P™]TÝ]\Ê[œ]˜XØÛÝ[[™ÔÝ]\È[œ]™^XÝ][Û”Ý]\È[œ]™^XÝ][Û—ÜÝ]\ËTÔUWÐ‘UWÑVPÕUSÓ—ÔÕUTÑTË	Ô[™[™ÈXØÛÝ[[™ÉÊKˆÝ\œ™[˜ÞWÚ\Û×ØÛÙNˆÝ\œ™[˜ÞR\ÛÐÛÙKˆ[›ÚXÙWØ[ØØ][ÛœÎˆ\œ˜^Kš\Ð\œ˜^J[œ]š[›ÚXÙP[ØØ][ÛœÈ[œ]š[›ÚXÙWØ[ØØ][ÛœÊHÈ[œ]š[›ÚXÙP[ØØ][ÛœÈ[œ]š[›ÚXÙWØ[ØØ][ÛœÈˆ×Kˆ\]YØžNˆ›Ùš[KšYˆ\]YØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆNÂŸB‚™[˜Ý[Ûˆ™\\™TÝ\Y\”Ù][Y[XÝ[ÛŠXÝ[Û‹Ý\œ™[Ý[JHÂˆYˆ
XÝ[Û‹˜XÝ[Û—Ý\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÊH™]\›ˆXÝ[ÛŽÂˆÛÛœÝØÚ[XHHÝ\œ™[Ý[OË—ÔÝ\Y\—ÔÙ][Y[ÔØÚ[XNÂˆYˆ
\ØÚ[XOË˜[Y
HÂˆ›ÝÈ\\œ›ÜŠÝ\Y\ˆ^[Y[]]ÛX][Ûˆ\È[˜]˜Z[X›Nˆ	ÊØÚ[XOËš\ÜÝY\ÈÉÔØ[\Ù›Ü˜ÙH[›ÚXÙKÜ^[Y[ØÚ[XH\È[˜ÛÛ\]K‰×JKš›Ú[Š	È	Ê_X
NÂˆBˆÛÛœÝXØÛÝ[Ù^HH\Ü]TØ[\Ù›Ü˜ÙRYÙ^JXÝ[Û‹œ\WØXØÛÝ[ÚÙ^JNÂˆÛÛœÝ[›ÚXÙ\ÈH
Ý\œ™[Ý[OË—ÔÝ\Y\—Ò[›ÚXÙWÑ^ÜÝ\™WÔ›ÝÜÈ×JK™š[\Š
[›ÚXÙJHOˆ\Ü]TØ[\Ù›Ü˜ÙRYÙ^J[›ÚXÙKœÝ\Y\XØÛÝ[Y
HOOHXØÛÝ[Ù^JNÂˆÛÛœÝ[˜[Y[›ÚXÙ\ÈH[›ÚXÙ\Ë™š[\Š
[›ÚXÙJHOˆ
[›ÚXÙKØ\›š[™ÜÈ×JKœÛÛYJ
Ø\›š[™ÊHOˆÛ›È˜[YÝ\Y\ˆXØÛÝ[ÛÚÝ\™YØ]]™_^ÙYYÈ]È[›ÚXÙH[[Ý[ÚK\Ý
Ø\›š[™ÊJJNÂˆYˆ
[˜[Y[›ÚXÙ\Ë›[™Ý
HÂˆ›ÝÈ\\œ›ÜŠ	ÐÛÜœ™XÝHÝ\Y\ˆ[›ÚXÙHXØÛÝ[Üˆ^XX›H˜[[˜ÙH[ˆØ[\Ù›Ü˜ÙH™Y›Ü™HØ]š[™È\ÈÝ\Y\ˆ™\ÛÛ][Û‹‰Ë
NÂˆBˆÛÛœÝ[ØØ][ÛˆH[ØØ]TÝ\Y\‘\Ü]JÂˆ[›ÚXÙ\Ëˆ\Ü]P[[Ý[ˆXÝ[Û‹˜[[Ý[ˆÝ\œ™[˜ÞR\ÛÐÛÙNˆXÝ[Û‹˜Ý\œ™[˜ÞWÚ\Û×ØÛÙKˆ[›ÚXÙP[ØØ][ÛœÎˆXÝ[Û‹š[›ÚXÙWØ[ØØ][ÛœËˆJNÂˆ™]\›ˆÂˆ‹‹˜XÝ[Û‹ˆ[›ÚXÙWØ[ØØ][ÛœÎˆ[ØØ][Û‹˜[ØØ][ÛœË›X\

][JHOˆ
ÂˆÝ\Y\—Ú[›ÚXÙWÚYˆ][KœÝ\Y\’[›ÚXÙRYˆ[[Ý[ˆ][K˜[ØØ]Y[[Ý[ˆJJKˆÝ\Y\—Ø[ØØ][ÛŽˆ[ØØ][Û‹ˆÝ\Y\—Ú[œÝXÝ[ÛœÎˆÝ\Y\’[œÝXÝ[Û”›ÝÜÊ[ØØ][ÛŠK›X\

[œÝXÝ[ÛŠHOˆ
Âˆ‹‹š[œÝXÝ[Û‹ˆÛÝ\˜ÙWÜÝ[WÚYˆÝ\œ™[Ý[K’YˆÛÝ\˜ÙWÜÝ[WÜÛ˜\ÚÝˆÂˆÝ[RYˆÝ\œ™[Ý[K’YˆÝ[S˜[YNˆÝ\œ™[Ý[K—Ñ\Ü^WÓ˜[YHÝ\œ™[Ý[K“˜[YHÝ\œ™[Ý[K’Ù^TÝ[W×ØÈ	ÉËˆ[]™\žQ]NˆÝ\œ™[Ý[K‘[]™\žWÑ]W×ØÈ[ˆKˆJJKˆNÂŸB‚™[˜Ý[ÛˆØ[Ý[]Q\Ü]P™]TÙ][Y[
XÝ[ÛœÈH×JHÂˆ]^Y\’[\XÝHÂˆ]Ý\Y\’[\XÝHÂˆ]^Y\Ü™Y]›ÝR[\XÝHÂˆ]Ý\Y\Ü™Y]›ÝR[\XÝHÂˆÛÛœÝ[™\ÈH×NÂ‚ˆ›Üˆ
ÛÛœÝXÝ[ÛˆÙˆXÝ[ÛœÊHÂˆÛÛœÝ[[Ý[H[X™\ŠXÝ[Û‹˜[[Ý[ÏÈXÝ[Û‹˜[[Ý[ØÙ[ÈÏÈ
HÂˆYˆ
XÝ[Û‹˜XÝ[Û—Ý\HOOH	Ú\ÜÝYWØ^Y\—ØÜ™Y]Û›ÝIÈXÝ[Û‹˜XÝ[Û•\HOOH	Ú\ÜÝYWØ^Y\—ØÜ™Y]Û›ÝIÊHÂˆ^Y\’[\XÝOH[[Ý[Âˆ[™\Ëœ\Ú
ÂˆX™[ˆXÝ[Û‹˜XÝ[Û—ÛX™[XÝ[Û‹˜XÝ[Û“X™[	Ð^Y\ˆÜ™Y]›ÝIËˆ[\XÝˆX[[Ý[ˆJNÂˆBˆYˆ
XÝ[Û‹˜XÝ[Û—Ý\HOOH	ÙYXÝÜÜXÚYšX×Ø[[Ý[	ÈXÝ[Û‹˜XÝ[Û•\HOOH	ÙYXÝÜÜXÚYšX×Ø[[Ý[	ÊHÂˆÝ\Y\’[\XÝ
ÏH[[Ý[Âˆ[™\Ëœ\Ú
ÂˆX™[ˆXÝ[Û‹˜XÝ[Û—ÛX™[XÝ[Û‹˜XÝ[Û“X™[	ÔÝ\Y\ˆYXÝ[Û‰Ëˆ[\XÝˆ[[Ý[ˆJNÂˆBˆYˆ
XÝ[Û‹˜XÝ[Û—Ý\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÈXÝ[Û‹˜XÝ[Û•\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÊHÂˆÝ\Y\’[\XÝ
ÏH[[Ý[Âˆ[™\Ëœ\Ú
ÂˆX™[ˆXÝ[Û‹˜XÝ[Û—ÛX™[XÝ[Û‹˜XÝ[Û“X™[	ÔÝ\Y\ˆ\Ü]H™\ÛÛ][Û‰Ëˆ[\XÝˆ[[Ý[ˆJNÂˆB‚ˆÛÛœÝ^Y\Ü™Y]›ÝHH[X™\ŠXÝ[Û‹œÜXÚX[ÜÙ[ÜšXÙHÏÈXÝ[Û‹œÜXÚX[Ù[šXÙJNÂˆYˆ
[X™\‹š\Ñš[š]J^Y\Ü™Y]›ÝJH	‰ˆ^Y\Ü™Y]›ÝHˆ
HÂˆÛÛœÝ[\XÝHX^Y\Ü™Y]›ÝNÂˆ^Y\Ü™Y]›ÝR[\XÝ
ÏH[\XÝÂˆ[™\Ëœ\Ú
ÂˆX™[ˆ	Ð^Y\ˆYÜ™YYÜ™Y]›ÝIËˆ^Y\Ü™Y]›ÝKˆ[\XÝˆJNÂˆB‚ˆÛÛœÝÝ\Y\Ü™Y]›ÝHH[X™\ŠXÝ[Û‹œÜXÚX[Ø^WÜšXÙHÏÈXÝ[Û‹œÜXÚX[^TšXÙJNÂˆYˆ
[X™\‹š\Ñš[š]JÝ\Y\Ü™Y]›ÝJH	‰ˆÝ\Y\Ü™Y]›ÝHˆ
HÂˆÛÛœÝ[\XÝHÝ\Y\Ü™Y]›ÝNÂˆÝ\Y\Ü™Y]›ÝR[\XÝ
ÏH[\XÝÂˆ[™\Ëœ\Ú
ÂˆX™[ˆ	ÔÝ\Y\ˆYÜ™YYÜ™Y]›ÝIËˆÝ\Y\Ü™Y]›ÝKˆ[\XÝˆJNÂˆBˆB‚ˆÛÛœÝÙ][Y[›H^Y\’[\XÝ
ÈÝ\Y\’[\XÝ
È^Y\Ü™Y]›ÝR[\XÝ
ÈÝ\Y\Ü™Y]›ÝR[\XÝÂˆ™]\›ˆÂˆ^Y\’[\XÝˆÝ\Y\’[\XÝˆ^Y\Ü™Y]›ÝR[\XÝˆÝ\Y\Ü™Y]›ÝR[\XÝˆÜXÚX[šXÙT›ˆ^Y\Ü™Y]›ÝR[\XÝ
ÈÝ\Y\Ü™Y]›ÝR[\XÝˆÙ][Y[›ˆ[™\ËˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØY\Ü]P™]UÛÜšÙ›ÝÓX\
ÛY[Ý[RYÈH×JHÂˆÛÛœÝYÈHË‹‹›™]ÈÙ]
Ý[RYË™š[\Š›ÛÛX[ŠJWNÂˆYˆ
ZYË›[™Ý
H™]\›ˆßNÂˆÛÛœÝØØ\Ù\Ô™\Ë\Y\Ô™\ËXÝ[ÛœÔ™\Ë[œÝXÝ[ÛœÔ™\Ë]™[Ô™\ËØÝ[Y[Ô™\×HH]ØZ]›ÛZ\ÙK˜[
ÂˆÛY[™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊKœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
Kš[Š	ÜÝ[WÚY	ËYÊKˆÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×Ü\Y\ÉÊKœÙ[XÝ
TÔUWÕÓÔ’Ñ“Õ×ÔT•WÔÑSPÕ
Kš[Š	ÜÝ[WÚY	ËYÊK›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™ÎˆYHJKˆÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÐ‘UWÐPÕSÓ—ÔÑSPÕ
Kš[Š	ÜÝ[WÚY	ËYÊK›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™ÎˆYHJKˆÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÜÝ\Y\—Ú[œÝXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÔÕTQT—ÒS”Õ•PÕSÓ—ÔÑSPÕ
Kš[Š	ÜÝ[WÚY	ËYÊK›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™ÎˆYHJKˆÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WÙ]™[ÉÊBˆœÙ[XÝ
TÔUWÐ‘UWÑU‘S•ÔÑSPÕ
Bˆš[Š	ÜÝ[WÚY	ËYÊBˆ›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™Îˆ˜[ÙHJBˆ›[Z]
X]›X^
LX]›Z[ŠYË›[™Ý
ˆKL
JJKˆÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÙØÝ[Y[ÉÊKœÙ[XÝ
TÔUWÕÓÔ’Ñ“Õ×ÑÐÕSQS•ÔÑSPÕ
Kš[Š	ÜÝ[WÚY	ËYÊK™\J	Ý\ØYÜÝ]\ÉË	ØÛÛ\]IÊK›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™Îˆ˜[ÙHJKˆJNÂˆYˆ
Ø\Ù\Ô™\Ë™\œ›ÜŠH›ÝÈØ\Ù\Ô™\Ë™\œ›ÜŽÂˆYˆ
\Y\Ô™\Ë™\œ›ÜŠH›ÝÈ\Y\Ô™\Ë™\œ›ÜŽÂˆYˆ
XÝ[ÛœÔ™\Ë™\œ›ÜŠH›ÝÈXÝ[ÛœÔ™\Ë™\œ›ÜŽÂˆYˆ
[œÝXÝ[ÛœÔ™\Ë™\œ›ÜŠH›ÝÈ[œÝXÝ[ÛœÔ™\Ë™\œ›ÜŽÂˆYˆ
]™[Ô™\Ë™\œ›ÜŠH›ÝÈ]™[Ô™\Ë™\œ›ÜŽÂˆYˆ
ØÝ[Y[Ô™\Ë™\œ›ÜŠH›ÝÈØÝ[Y[Ô™\Ë™\œ›ÜŽÂ‚ˆÛÛœÝX\HßNÂˆ›Üˆ
ÛÛœÝ›ÝÈÙˆØ\Ù\Ô™\Ë™]H×JHÂˆX\Ü›ÝËœÝ[WÚYHHÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJ›ÝÊKˆ\Y\Îˆ×KˆXÝ[ÛœÎˆ×KˆÝ\Y\’[œÝXÝ[ÛœÎˆ×Kˆ]™[Îˆ×KˆØÝ[Y[Îˆ×KˆNÂˆBˆÛÛœÝ\PžRYH™]ÈX\

NÂˆ›Üˆ
ÛÛœÝ›ÝÈÙˆ\Y\Ô™\Ë™]H×JHÂˆ\PžRYœÙ]
›ÝËšY›ÝÊNÂˆYˆ
[X\Ü›ÝËœÝ[WÚYJBˆX\Ü›ÝËœÝ[WÚYHHÂˆØ\ÙNˆ[ˆ\Y\Îˆ×KˆXÝ[ÛœÎˆ×KˆÝ\Y\’[œÝXÝ[ÛœÎˆ×Kˆ]™[Îˆ×KˆØÝ[Y[Îˆ×KˆNÂˆX\Ü›ÝËœÝ[WÚYKœ\Y\Ëœ\Ú
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\J›ÝÊJNÂˆBˆ›Üˆ
ÛÛœÝ›ÝÈÙˆ[œÝXÝ[ÛœÔ™\Ë™]H×JHÂˆYˆ
[X\Ü›ÝËœÝ[WÚYJBˆX\Ü›ÝËœÝ[WÚYHHÂˆØ\ÙNˆ[ˆ\Y\Îˆ×KˆXÝ[ÛœÎˆ×KˆÝ\Y\’[œÝXÝ[ÛœÎˆ×Kˆ]™[Îˆ×KˆØÝ[Y[Îˆ×KˆNÂˆX\Ü›ÝËœÝ[WÚYKœÝ\Y\’[œÝXÝ[ÛœËœ\Ú
Ù\šX[^™Q\Ü]TÝ\Y\’[œÝXÝ[ÛŠ›ÝÊJNÂˆBˆ›Üˆ
ÛÛœÝ›ÝÈÙˆXÝ[ÛœÔ™\Ë™]H×JHÂˆYˆ
[X\Ü›ÝËœÝ[WÚYJBˆX\Ü›ÝËœÝ[WÚYHHÂˆØ\ÙNˆ[ˆ\Y\Îˆ×KˆXÝ[ÛœÎˆ×KˆÝ\Y\’[œÝXÝ[ÛœÎˆ×Kˆ]™[Îˆ×KˆØÝ[Y[Îˆ×KˆNÂˆX\Ü›ÝËœÝ[WÚYK˜XÝ[ÛœËœ\Ú
Ù\šX[^™Q\Ü]P™]PXÝ[ÛŠ›ÝË\PžRY[œÝXÝ[ÛœÔ™\Ë™]H×JJNÂˆBˆ›Üˆ
ÛÛœÝ›ÝÈÙˆ]™[Ô™\Ë™]H×JHÂˆYˆ
[X\Ü›ÝËœÝ[WÚYJBˆX\Ü›ÝËœÝ[WÚYHHÂˆØ\ÙNˆ[ˆ\Y\Îˆ×KˆXÝ[ÛœÎˆ×KˆÝ\Y\’[œÝXÝ[ÛœÎˆ×Kˆ]™[Îˆ×KˆØÝ[Y[Îˆ×KˆNÂˆX\Ü›ÝËœÝ[WÚYK™]™[Ëœ\Ú
Ù\šX[^™Q\Ü]P™]Q]™[
›ÝÊJNÂˆBˆ›Üˆ
ÛÛœÝ›ÝÈÙˆØÝ[Y[Ô™\Ë™]H×JHÂˆYˆ
[X\Ü›ÝËœÝ[WÚYJBˆX\Ü›ÝËœÝ[WÚYHHÂˆØ\ÙNˆ[ˆ\Y\Îˆ×KˆXÝ[ÛœÎˆ×KˆÝ\Y\’[œÝXÝ[ÛœÎˆ×Kˆ]™[Îˆ×KˆØÝ[Y[Îˆ×KˆNÂˆX\Ü›ÝËœÝ[WÚYK™ØÝ[Y[Ëœ\Ú
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
›ÝÊJNÂˆBˆ™]\›ˆX\ÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜš]Q\Ü]P™]Q]™[
ÛY[Ø\ÙT›ÝË]™[\K›Ùš[K^[ØYHßJHÂˆÛÛœÝÈ\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WÙ]™[ÉÊKš[œÙ\
ÂˆØ\ÙWÚYˆØ\ÙT›ÝËšYˆXÝ[Û—ÚYˆ^[ØY˜XÝ[Û’Y[ˆÝ[WÚYˆØ\ÙT›ÝËœÝ[WÚYˆ]™[Ý\Nˆ]™[\Kˆ›ÝNˆ^[ØY››ÝH[ˆY]Y]Nˆ^[ØY›Y]Y]HßKˆXÝÜ—Ý\Ù\—ÚYˆ›Ùš[OËšY[ˆXÝÜ—Ù[XZ[ˆ›Ùš[OË™[XZ[[ˆJNÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂŸB‚™[˜Ý[Ûˆ\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ[HHßJHÂˆYˆ
Z\ÔØ[\Ù›Ü˜ÙQ\Ü]PÛÜÙY
Ý[K‘\Ü]WÔÝ]\××ØÊJH™]\›ŽÂˆ›ÝÈ\\œ›ÜŠ\È\Ü]H\È[™XYH	ÔÝš[™ÊÝ[K‘\Ü]WÔÝ]\××ØÊKš[J
_H[ˆØ[\Ù›Ü˜ÙKˆÛÛ[Y\˜ÚX[ÛÜšÙ›ÝÈÚ[™Ù\È\™HØÚÙYÈš[˜[˜ÙHX^HÛÛ[YH[ˆ[™XYH\›Ý™YÓÔÈXØÛÝ[[™ÈÛÜšÙ›ÝË˜JNÂŸB‚™[˜Ý[Ûˆ\Õ[˜XØÙ\Y^\›˜[\Ü]PÛÜÝ\™JØ\ÙT›ÝËÝ[JHÂˆ™]\›ˆ›ÛÛX[ŠˆØ\ÙT›ÝÏËšYˆ	‰ˆØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÈOOH	ÐÛÜÙY	Âˆ	‰ˆ\ÔØ[\Ù›Ü˜ÙQ\Ü]PÛÜÙY
Ý[OË‘\Ü]WÔÝ]\××ØÊBˆ	‰ˆZ\Ô™XÛÜ™Y˜ÛÜÐÛÜÝ\™UÜš]X˜XÚÊØ\ÙT›ÝÊKˆ
NÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ™XÛÜ™^\›˜[\Ü]PÛÜÝ\™JÛY[Ø\ÙT›ÝËÝ[K›Ùš[KÛÜšÙ›ÝÔÝ]\ÈH[
HÂˆYˆ
Z\Õ[˜XØÙ\Y^\›˜[\Ü]PÛÜÝ\™JØ\ÙT›ÝËÝ[JJH™]\›ˆØ\ÙT›ÝÎÂˆÛÛœÝš\œÝ]XÝ[ÛˆHXØ\ÙT›ÝË™^\›˜[ØÛÜÝ\™WÙ]XÝYØ]ÂˆÛÛœÝ›ÝÒ\ÛÈH™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝØ[\Ù›Ü˜ÙTÝ]\ÈHÝš[™ÊÝ[K‘\Ü]WÔÝ]\××ØÈ	ÉÊKš[J
NÂˆÛÛœÝÈ]Nˆ\]YØ\ÙK\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊBˆ\]JÂˆ‹‹ŠÛÜšÙ›ÝÔÝ]\ÈÈÈÛÜšÙ›Ý×ÜÝ]\ÎˆÛÜšÙ›ÝÔÝ]\ÈHˆßJKˆÝ\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\ÎˆØ[\Ù›Ü˜ÙTÝ]\ËˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×ÜÝ]\Îˆ	Ù^\›˜[	ËˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×Ù\œ›ÜŽˆ[ˆ^\›˜[ØÛÜÝ\™WÙ]XÝYØ]ˆØ\ÙT›ÝË™^\›˜[ØÛÜÝ\™WÙ]XÝYØ]›ÝÒ\ÛËˆ^\›˜[ØÛÜÝ\™WÜØ[\Ù›Ü˜ÙWÜÝ]\ÎˆØ[\Ù›Ü˜ÙTÝ]\Ëˆ^\›˜[ØÛÜÝ\™WÜØ[\Ù›Ü˜ÙWÛ[ÙYšYYØ]ˆÝ[K“\Ý[ÙYšYY]H[ˆ\]YØ]ˆ›ÝÒ\ÛËˆJBˆ™\J	ÚY	ËØ\ÙT›ÝËšY
BˆœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
BˆœÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆYˆ
š\œÝ]XÝ[ÛŠHÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[\]YØ\ÙK	Ù^\›˜[ØÛÜÝ\™WÙ]XÝY	Ë›Ùš[KÂˆ›ÝNˆØ[\Ù›Ü˜ÙHØ\ÈÚ[™ÙY\™XÝHÈ	ÜØ[\Ù›Ü˜ÙTÝ]\ßKˆÓÔÈ™]Z[™YH	Ý\]YØ\ÙKÛÜšÙ›Ý×ÜÝ]\ßHXØÛÝ[[™ÈÝYÙK˜ˆY]Y]NˆÂˆØ[\Ù›Ü˜ÙTÝ]\ËˆØ[\Ù›Ü˜ÙS\Ý[ÙYšYY]ˆÝ[K“\Ý[ÙYšYY]H[ˆ[\›˜[ÛÜšÙ›ÝÔÝ]\Îˆ\]YØ\ÙKÛÜšÙ›Ý×ÜÝ]\ËˆKˆJNÂˆBˆ™]\›ˆ\]YØ\ÙNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\œÚ\Ý\Ü]PXØÛÝ[[™ÔÝ]\ÊÛY[Ø\ÙT›ÝËÝ[K›Ùš[KÛÜšÙ›ÝÔÝ]\ÊHÂˆYˆ
\Õ[˜XØÙ\Y^\›˜[\Ü]PÛÜÝ\™JØ\ÙT›ÝËÝ[JJHÂˆ™]\›ˆ™XÛÜ™^\›˜[\Ü]PÛÜÝ\™JÛY[Ø\ÙT›ÝËÝ[K›Ùš[KÛÜšÙ›ÝÔÝ]\ÊNÂˆBˆ™]\›ˆÜš]Q\Ü]UÛÜšÙ›ÝÔÝ]\ÕÔØ[\Ù›Ü˜ÙJÛY[Ø\ÙT›ÝË›Ùš[KÛÜšÙ›ÝÔÝ]\ÊNÂŸB‚™[˜Ý[Ûˆ›Ú™XÝ^\›˜[PÛÜÙY\Ü]UÛÜšÙ›ÝÜÊÝ[\ÈH×KÛÜšÙ›ÝÓX\HßJHÂˆ›Üˆ
ÛÛœÝÝ[HÙˆÝ[\ÊHÂˆÛÛœÝÛÜšÙ›ÝÈHÛÜšÙ›ÝÓX\ÜÝ[K’YNÂˆÛÛœÝ›Ú™XÝ[ÛˆH›Ú™XÝ^\›˜[\Ü]PÛÜÝ\™JÛÜšÙ›ÝÏË˜Ø\ÙKÝ[JNÂˆYˆ
›Ú™XÝ[ÛŠHÛÜšÙ›ÝË˜Ø\ÙHHÈ‹‹ÛÜšÙ›ÝË˜Ø\ÙK‹‹œ›Ú™XÝ[ÛˆNÂˆBŸB‚˜\Þ[˜È[˜Ý[ÛˆØY\Ü]UÛÜšÙ›ÝÔ\Y\ÊÛY[Ø\ÙRY
HÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×Ü\Y\ÉÊKœÙ[XÝ
TÔUWÕÓÔ’Ñ“Õ×ÔT•WÔÑSPÕ
K™\J	ØØ\ÙWÚY	ËØ\ÙRY
K›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™ÎˆYHJNÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ™]\›ˆ]H×NÂŸB‚™[˜Ý[Ûˆ\Ü]T\T›ÝÓX\
\T›ÝÜÈH×JHÂˆ™]\›ˆ™]ÈX\
\T›ÝÜË›X\

\JHOˆÜ\KšY\WJJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙRY
HÂˆÛÛœÝÜ\T›ÝÜËXÝ[ÛœÔ™\Ý[[œÝXÝ[ÛœÔ™\Ý[HH]ØZ]›ÛZ\ÙK˜[
ÛØY\Ü]UÛÜšÙ›ÝÔ\Y\ÊÛY[Ø\ÙRY
KÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÐ‘UWÐPÕSÓ—ÔÑSPÕ
K™\J	ØØ\ÙWÚY	ËØ\ÙRY
K›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™ÎˆYHJKÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÜÝ\Y\—Ú[œÝXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÔÕTQT—ÒS”Õ•PÕSÓ—ÔÑSPÕ
K™\J	ØØ\ÙWÚY	ËØ\ÙRY
K›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™ÎˆYHJWJNÂˆYˆ
XÝ[ÛœÔ™\Ý[™\œ›ÜŠH›ÝÈXÝ[ÛœÔ™\Ý[™\œ›ÜŽÂˆYˆ
[œÝXÝ[ÛœÔ™\Ý[™\œ›ÜŠH›ÝÈ[œÝXÝ[ÛœÔ™\Ý[™\œ›ÜŽÂˆÛÛœÝ[œÝXÝ[Û”›ÝÜÈH[œÝXÝ[ÛœÔ™\Ý[™]H×NÂˆ™]\›ˆÂˆ\T›ÝÜËˆXÝ[Û”›ÝÜÎˆXÝ[ÛœÔ™\Ý[™]H×Kˆ[œÝXÝ[Û”›ÝÜËˆÝ\Y\’[œÝXÝ[ÛœÎˆ[œÝXÝ[Û”›ÝÜË›X\
Ù\šX[^™Q\Ü]TÝ\Y\’[œÝXÝ[ÛŠKˆXÝ[ÛœÎˆ
XÝ[ÛœÔ™\Ý[™]H×JK›X\

›ÝÊHOˆÙ\šX[^™Q\Ü]P™]PXÝ[ÛŠ›ÝË\Ü]T\T›ÝÓX\
\T›ÝÜÊK[œÝXÝ[Û”›ÝÜÊJKˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÛX\’[˜[Y\Ü]PÛÛ\[œØ][Û“[šÜÊÛY[Ø\ÙT›ÝË›Ùš[JHÂˆÛÛœÝÛÜšÙ›ÝÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ\SX\H\Ü]T\T›ÝÓX\
ÛÜšÙ›ÝËœ\T›ÝÜÊNÂˆÛÛœÝ[˜[YHÛÜšÙ›ÝË˜XÝ[Û”›ÝÜË™š[\Š
XÝ[ÛŠHOˆÂˆYˆ
XXÝ[Û‹›[šÙYØYÜ™YYØÛÛ\[œØ][Û—ÚY
H™]\›ˆ˜[ÙNÂˆÛÛœÝ\HH\SX\™Ù]
XÝ[Û‹œ\WÚY
NÂˆÛÛœÝÛ˜\ÚÝXØÛÝ[YHXÝ[Û‹›[šÙYØÛÛ\[œØ][Û—ÜÛ˜\ÚÝË˜XØÛÝ[YÂˆ™]\›ˆVÉØÛÜÙWØ^Y\—Ù\Ü]IË	ØÛÜÙWÜÝ\Y\—Ù\Ü]I×Kš[˜ÛY\ÊXÝ[Û‹˜XÝ[Û—Ý\JBˆÝš[™ÊXÝ[Û‹˜ÛÜÙWÜ™X\ÛÛˆ	ÉÊKš[J
KÓÝÙ\Ø\ÙJ
HOOH	Ý[ØÈÜ[™Y	Âˆ\\OË˜XØÛÝ[ÚYˆÛ˜\ÚÝXØÛÝ[YOOH\K˜XØÛÝ[ÚYÂˆJNÂˆ›Üˆ
ÛÛœÝXÝ[ÛˆÙˆ[˜[Y
HÂˆÛÛœÝ›ÝÈH™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝÈ\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊK\]JÂˆ[šÙYØYÜ™YYØÛÛ\[œØ][Û—ÚYˆ[ˆ[šÙYØÛÛ\[œØ][Û—ÜÛ˜\ÚÝˆßKˆ[šÙYØÛÛ\[œØ][Û—ØžNˆ[ˆ[šÙYØÛÛ\[œØ][Û—ØžWÙ[XZ[ˆ[ˆ[šÙYØÛÛ\[œØ][Û—Ø]ˆ[ˆ\]YØžNˆ›Ùš[KšYˆ\]YØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆ\]YØ]ˆ›ÝËˆJK™\J	ÚY	ËXÝ[Û‹šY
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[Ø\ÙT›ÝË	ØÛÛ\[œØ][Û—ØÛZ[WÛ[šÙY	Ë›Ùš[KÂˆXÝ[Û’YˆXÝ[Û‹šYˆ›ÝNˆ	ÐYÜ™YYÛÛ\[œØ][ÛˆÛZ[H[šÈÛX\™Y™XØ]\ÙHH\Ü]H\HÜˆÛÜÝ\™H™X\ÛÛˆÚ[™ÙY‰ËˆY]Y]NˆÈÛZ[T™[[Ý™YˆYHKˆJNÂˆBŸB‚˜\Þ[˜È[˜Ý[Ûˆ\ÜÙ\\Ü]U[ØÐÛZ[\Ô™XYQ›ÜÛÜÝ\™JXÝ[ÛœË\T›ÝÜÊHÂˆÛÛœÝ\SX\H\Ü]T\T›ÝÓX\
\T›ÝÜÊNÂˆ›Üˆ
ÛÛœÝXÝ[ÛˆÙˆXÝ[ÛœË™š[\Š
›ÝÊHOˆÝš[™Ê›ÝË˜ÛÜÙWÜ™X\ÛÛˆ	ÉÊKš[J
KÓÝÙ\Ø\ÙJ
HOOH	Ý[ØÈÜ[™Y	ÊJHÂˆÛÛœÝ\HH\SX\™Ù]
XÝ[Û‹œ\WÚY
NÂˆYˆ
XXÝ[Û‹›[šÙYØYÜ™YYØÛÛ\[œØ][Û—ÚY
HÂˆ›ÝÈ\\œ›ÜŠ	Ü\OË˜XØÛÝ[Û˜[YH	ÕH\Ü]H\IßH™\]Z\™\ÈH[šÙYYÜ™YYÛÛ\[œØ][ÛˆÛZ[H™Y›Ü™Hš[˜[ÛÜÝ\™K˜JNÂˆBˆÛÛœÝÛ˜\ÚÝHXÝ[Û‹›[šÙYØÛÛ\[œØ][Û—ÜÛ˜\ÚÝßNÂˆYˆ
Û˜\ÚÝ›[šÙYÚ[SÜ[ˆOOHYHÛ˜\ÚÝ˜XØÛÝ[YOOH\OË˜XØÛÝ[ÚY
HÂˆ›ÝÈ\\œ›ÜŠ	Ü\OË˜XØÛÝ[Û˜[YH	ÕH\Ü]H\IßH\È[ˆ[˜[YÛÛ\[œØ][ÛˆÛZ[H[šËˆ™[[Ý™H][™Ù[XÝHÛÜœ™XÝÜ[ˆÛZ[K˜JNÂˆBˆ]ØZ]˜[Y]PYÜ™YYÛÛ\[œØ][ÛÛZ[S[šÊXÝ[Û‹›[šÙYØYÜ™YYØÛÛ\[œØ][Û—ÚY\K˜XØÛÝ[ÚYÈ™\]Z\™SÜ[Žˆ˜[ÙHJNÂˆBŸB‚™[˜Ý[ÛˆÝÜ™YÝ\Y\’[›ÚXÙP[ØØ][ÛœÊ[œÝXÝ[Û”›ÝÜÈH×JHÂˆÛÛœÝ[ØØ][ÛœÈH™]ÈX\

NÂˆ›Üˆ
ÛÛœÝ[œÝXÝ[ÛˆÙˆ[œÝXÝ[Û”›ÝÜË™š[\Š
›ÝÊHOˆ›ÝËœÝ]\ÈOOH	ÔÝ\\œÙYY	ÊJHÂˆÛÛœÝYH[œÝXÝ[Û‹œÛÝ\˜ÙWÜÝ\Y\—Ú[›ÚXÙWÚYÂˆYˆ
ZY
HÛÛ[YNÂˆ[ØØ][ÛœËœÙ]
YX]›X^
[X™\Š[ØØ][ÛœË™Ù]
Y
H
K[X™\Š[œÝXÝ[Û‹˜[ØØ]YØ[[Ý[
JJNÂˆBˆ™]\›ˆË‹‹˜[ØØ][Ûœ×K›X\

ÜÝ\Y\’[›ÚXÙRY[[Ý[JHOˆ
ÂˆÝ\Y\’[›ÚXÙRYˆ[[Ý[ˆJJNÂŸB‚™[˜Ý[ÛˆÝ\œ™[Ý\Y\XÝ[Û[ØØ][ÛŠXÝ[Û‹\T›ÝÜË[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[JHÂˆÛÛœÝ\HH\Ü]T\T›ÝÓX\
\T›ÝÜÊK™Ù]
XÝ[Û‹œ\WÚY
NÂˆYˆ
\\JH›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ™\ÛÛ][Ûˆ\È›ÈÙ[XÝYXØÛÝ[‰Ë
NÂˆÛÛœÝXØÛÝ[Ù^HH\Ü]TØ[\Ù›Ü˜ÙRYÙ^J\K˜XØÛÝ[ÚY
NÂˆÛÛœÝXÝ[Û’[œÝXÝ[ÛœÈH[œÝXÝ[Û”›ÝÜË™š[\Š
[œÝXÝ[ÛŠHOˆ[œÝXÝ[Û‹˜XÝ[Û—ÚYOOHXÝ[Û‹šY	‰ˆ[œÝXÝ[Û‹œÝ]\ÈOOH	ÔÝ\\œÙYY	ÊNÂˆÛÛœÝÝ\œ™[˜ÞR\ÛÐÛÙHHXÝ[Û’[œÝXÝ[ÛœÖÌOË˜Ý\œ™[˜ÞWÚ\Û×ØÛÙH	ÕTÑ	ÎÂˆÛÛœÝ[›ÚXÙ\ÈH
Ý\œ™[Ý[OË—ÔÝ\Y\—Ò[›ÚXÙWÑ^ÜÝ\™WÔ›ÝÜÈ×JK™š[\Š
[›ÚXÙJHOˆ\Ü]TØ[\Ù›Ü˜ÙRYÙ^J[›ÚXÙKœÝ\Y\XØÛÝ[Y
HOOHXØÛÝ[Ù^JNÂˆYˆ
XÝ\œ™[Ý[OË—ÔÝ\Y\—ÔÙ][Y[ÔØÚ[XOË˜[Y
HÂˆ›ÝÈ\\œ›ÜŠÝ\Y\ˆ^[Y[]]ÛX][Ûˆ\È[˜]˜Z[X›Nˆ	ÊÝ\œ™[Ý[OË—ÔÝ\Y\—ÔÙ][Y[ÔØÚ[XOËš\ÜÝY\È×JKš›Ú[Š	È	Ê_XJNÂˆBˆ™]\›ˆ[ØØ]TÝ\Y\‘\Ü]JÂˆ[›ÚXÙ\Ëˆ\Ü]P[[Ý[ˆXÝ[Û‹˜[[Ý[ˆÝ\œ™[˜ÞR\ÛÐÛÙKˆ[›ÚXÙP[ØØ][ÛœÎˆÝÜ™YÝ\Y\’[›ÚXÙP[ØØ][ÛœÊXÝ[Û’[œÝXÝ[ÛœÊKˆJNÂŸB‚™[˜Ý[ÛˆÝ\Y\’[œÝXÝ[Û”Ý]PÚ[™ÙY
Ý\œ™[›ÝÜÈH×K[ØØ][ÛˆHßJHÂˆÛÛœÝXÝ]™T›ÝÜÈHÝ\œ™[›ÝÜË™š[\Š
›ÝÊHOˆ›ÝËœÝ]\ÈOOH	ÔÝ\\œÙYY	ÊNÂˆÛÛœÝÝ\œ™[š[™Ù\œš[HXÝ]™T›ÝÜË›X\

›ÝÊHOˆ›ÝË˜[ØØ][Û—Ùš[™Ù\œš[
K™š[™
›ÛÛX[ŠNÂˆYˆ
Ý\œ™[š[™Ù\œš[
H™]\›ˆÝ\œ™[š[™Ù\œš[OOH[ØØ][Û‹™š[™Ù\œš[ÂˆÛÛœÝÝ\œ™[Ú\HHXÝ]™T›ÝÜË›X\

›ÝÊHOˆ	Ü›ÝËœÛÝ\˜ÙWÜÝ\Y\—Ú[›ÚXÙWÚYN‰Ü›ÝËš[œÝXÝ[Û—Ý\_N‰Ó[X™\Š›ÝËœ[›™YØ[[Ý[
KÑš^Y
Š_X
KœÛÜ

NÂˆÛÛœÝ™^Ú\HHÝ\Y\’[œÝXÝ[Û”›ÝÜÊ[ØØ][ÛŠBˆ›X\

›ÝÊHOˆ	Ü›ÝËœÛÝ\˜ÙWÜÝ\Y\—Ú[›ÚXÙWÚYN‰Ü›ÝËš[œÝXÝ[Û—Ý\_N‰Ó[X™\Š›ÝËœ[›™YØ[[Ý[
KÑš^Y
Š_X
BˆœÛÜ

NÂˆ™]\›ˆ”ÓÓ‹œÝš[™ÚYžJÝ\œ™[Ú\JHOOH”ÓÓ‹œÝš[™ÚYžJ™^Ú\JNÂŸB‚™[˜Ý[Ûˆ\ÜÙ\Ý\Y\[ØØ][ÛœÐÝ\œ™[
XÝ[ÛœË\T›ÝÜË[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[JHÂˆ›Üˆ
ÛÛœÝXÝ[ÛˆÙˆXÝ[ÛœË™š[\Š
›ÝÊHOˆ›ÝË˜XÝ[Û—Ý\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÊJHÂˆÛÛœÝ[ØØ][ÛˆHÝ\œ™[Ý\Y\XÝ[Û[ØØ][ÛŠXÝ[Û‹\T›ÝÜË[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[JNÂˆÛÛœÝXÝ[Û’[œÝXÝ[ÛœÈH[œÝXÝ[Û”›ÝÜË™š[\Š
[œÝXÝ[ÛŠHOˆ[œÝXÝ[Û‹˜XÝ[Û—ÚYOOHXÝ[Û‹šY
NÂˆYˆ
Ý\Y\’[œÝXÝ[Û”Ý]PÚ[™ÙY
XÝ[Û’[œÝXÝ[ÛœË[ØØ][ÛŠJHÂˆ›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ[›ÚXÙH^[Y[]HÚ[™ÙYˆØ]™HH˜YYØZ[ˆÈ™]šY]ÈH\]YÈ›Ý^H[™Ù]˜XÚÈZY[[Ý[[ØØ][Û‹‰ËJNÂˆBˆBŸB‚˜\Þ[˜È[˜Ý[Ûˆ™XÛÛ˜Ú[P\›Ý™YÝ\Y\’[œÝXÝ[ÛœÊÛY[Ø\ÙT›ÝË\T›ÝÜËXÝ[Û”›ÝÜË[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[K›Ùš[JHÂˆYˆ
Ø\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ð\›Ý™Y	ÈØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÈOOH	ÐÛÜÙY	ÊHÂˆ™]\›ˆÈÚ[™ÙYˆ˜[ÙK[œÝXÝ[Û”›ÝÜÈNÂˆBˆÛÛœÝ™XÛÛ˜Ú[X][ÛœÈH×NÂˆ›Üˆ
ÛÛœÝXÝ[ÛˆÙˆXÝ[Û”›ÝÜË™š[\Š
›ÝÊHOˆ›ÝË˜XÝ[Û—Ý\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÊJHÂˆÛÛœÝ[ØØ][ÛˆHÝ\œ™[Ý\Y\XÝ[Û[ØØ][ÛŠXÝ[Û‹\T›ÝÜË[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[JNÂˆÛÛœÝÝ\œ™[›ÝÜÈH[œÝXÝ[Û”›ÝÜË™š[\Š
[œÝXÝ[ÛŠHOˆ[œÝXÝ[Û‹˜XÝ[Û—ÚYOOHXÝ[Û‹šY
NÂˆYˆ
\Ý\Y\’[œÝXÝ[Û”Ý]PÚ[™ÙY
Ý\œ™[›ÝÜË[ØØ][ÛŠJHÛÛ[YNÂˆÛÛœÝÛÝ\˜ÙTÝ[TÛ˜\ÚÝHÂˆÝ[RYˆÝ\œ™[Ý[K’YˆÝ[S˜[YNˆÝ\œ™[Ý[K—Ñ\Ü^WÓ˜[YHÝ\œ™[Ý[K“˜[YHÝ\œ™[Ý[K’Ù^TÝ[W×ØÈ	ÉËˆ[]™\žQ]NˆÝ\œ™[Ý[K‘[]™\žWÑ]W×ØÈ[ˆNÂˆ™XÛÛ˜Ú[X][ÛœËœ\Ú
ÂˆXÝ[Û—ÚYˆXÝ[Û‹šYˆ[œÝXÝ[ÛœÎˆÝ\Y\’[œÝXÝ[Û”›ÝÜÊ[ØØ][ÛŠK›X\

\Ú\™Y
HOˆ
Âˆ‹‹™\Ú\™Yˆ\WÚYˆXÝ[Û‹œ\WÚYˆÛÝ\˜ÙWÜÝ[WÚYˆØ\ÙT›ÝËœÝ[WÚYˆÛÝ\˜ÙWÜÝ[WÜÛ˜\ÚÝˆÛÝ\˜ÙTÝ[TÛ˜\ÚÝˆ[ØØ][Û—Ùš[™Ù\œš[ˆ[ØØ][Û‹™š[™Ù\œš[ˆJJKˆ›ÝNˆÝ\Y\ˆ^[Y[Ú[™ÙYˆÈ›Ý^H\È›ÝÈ	Ø[ØØ][Û‹Ý[Ó›Ý^KÑš^Y
Š_H	Ø[ØØ][Û‹˜Ý\œ™[˜ÞR\ÛÐÛÙ_NÈÙ]˜XÚÈZY[[Ý[\È	Ø[ØØ][Û‹Ý[Ù]˜XÚÔZYÑš^Y
Š_H	Ø[ØØ][Û‹˜Ý\œ™[˜ÞR\ÛÐÛÙ_K˜ˆY]Y]NˆÂˆ\Ü]P[[Ý[ˆ[ØØ][Û‹™\Ü]P[[Ý[ˆÝ[Ó›Ý^Nˆ[ØØ][Û‹Ý[Ó›Ý^KˆÝ[Ù]˜XÚÔZYˆ[ØØ][Û‹Ý[Ù]˜XÚÔZYˆ[ØØ][Û‘š[™Ù\œš[ˆ[ØØ][Û‹™š[™Ù\œš[ˆKˆJNÂˆBˆYˆ
\™XÛÛ˜Ú[X][ÛœË›[™Ý
HÂˆYˆ
Z\Õ[˜XØÙ\Y^\›˜[\Ü]PÛÜÝ\™JØ\ÙT›ÝËÝ\œ™[Ý[JH	‰ˆØ\ÙT›ÝËœØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×ÜÝ]\ÈOOH	Ù˜Z[Y	È	‰ˆÉÐ\›Ý™YH[™[™ÈXØÛÝ[[™ÉË	ÐXØÛÝ[[™È[ˆ›ÙÜ™\ÜÉË	ÔÙ]YH™XYHÈÛÜÙI×Kš[˜ÛY\ÊØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÊJHÂˆ]ØZ]Üš]Q\Ü]UÛÜšÙ›ÝÔÝ]\ÕÔØ[\Ù›Ü˜ÙJÛY[Ø\ÙT›ÝË›Ùš[KØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÊNÂˆ™]\›ˆÈÚ[™ÙYˆ˜[ÙKÜš]X˜XÚÔ™]šYYˆYK[œÝXÝ[Û”›ÝÜÈNÂˆBˆ™]\›ˆÈÚ[™ÙYˆ˜[ÙKÜš]X˜XÚÔ™]šYYˆ˜[ÙK[œÝXÝ[Û”›ÝÜÈNÂˆBˆÛÛœÝÈ\œ›ÜŽˆ™XÛÛ˜Ú[X][Û‘\œ›ÜˆHH]ØZ]ÛY[œœÊ	Ü™XÛÛ˜Ú[WÙ\Ü]WÜÝ\Y\—Ú[œÝXÝ[ÛœÉËÂˆØØ\ÙWÚYˆØ\ÙT›ÝËšYˆÜ™XÛÛ˜Ú[X][ÛœÎˆ™XÛÛ˜Ú[X][ÛœËˆØXÝÜŽˆÈYˆ›Ùš[KšY[XZ[ˆ›Ùš[K™[XZ[KˆJNÂˆYˆ
™XÛÛ˜Ú[X][Û‘\œ›ÜŠH›ÝÈ™XÛÛ˜Ú[X][Û‘\œ›ÜŽÂˆÛÛœÝ\]YØ\ÙHH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[Ø\ÙT›ÝËšY
NÂˆ]ØZ]\œÚ\Ý\Ü]PXØÛÝ[[™ÔÝ]\ÊÛY[\]YØ\ÙKÝ\œ™[Ý[K›Ùš[K	ÐXØÛÝ[[™È[ˆ›ÙÜ™\ÜÉÊNÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÜÝ\Y\—Ú[œÝXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÔÕTQT—ÒS”Õ•PÕSÓ—ÔÑSPÕ
K™\J	ØØ\ÙWÚY	ËØ\ÙT›ÝËšY
K›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™ÎˆYHJNÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ™]\›ˆÂˆÚ[™ÙYˆYKˆÜš]X˜XÚÔ™]šYYˆ˜[ÙKˆ[œÝXÝ[Û”›ÝÜÎˆ]H×KˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØY\Ü]UÛÜšÙ›ÝÑØÝ[Y[ÊÛY[Ø\ÙRY
HÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÙØÝ[Y[ÉÊKœÙ[XÝ
TÔUWÕÓÔ’Ñ“Õ×ÑÐÕSQS•ÔÑSPÕ
K™\J	ØØ\ÙWÚY	ËØ\ÙRY
K™\J	Ý\ØYÜÝ]\ÉË	ØÛÛ\]IÊK›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™Îˆ˜[ÙHJNÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ™]\›ˆ]H×NÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØY\Ü]UÛÜšÙ›ÝÑ]™[ÊÛY[Ø\ÙRY[Z]HL
HÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WÙ]™[ÉÊKœÙ[XÝ
TÔUWÐ‘UWÑU‘S•ÔÑSPÕ
K™\J	ØØ\ÙWÚY	ËØ\ÙRY
K›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™Îˆ˜[ÙHJK›[Z]
[Z]
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ™]\›ˆ]H×NÂŸB‚™[˜Ý[ÛˆZ\ÜÚ[™Ô™\]Z\™Y\Ü]QØÝ[Y[ÊXÝ[ÛœÈH×KØÝ[Y[ÈH×JHÂˆÛÛœÝXÝ[Û’YÕÚ]ØÝ[Y[ÈH™]ÈÙ]
ØÝ[Y[Ë›X\

ØÝ[Y[
HOˆØÝ[Y[˜XÝ[Û—ÚY
K™š[\Š›ÛÛX[ŠJNÂˆ™]\›ˆXÝ[ÛœË™š[\Š
XÝ[ÛŠHOˆXÝ[Û‹œ™\]Z\™\×Ø]XÚY[OOHYH	‰ˆXXÝ[Û’YÕÚ]ØÝ[Y[Ëš\ÊXÝ[Û‹šY
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\ÜÙ\™\]Z\™Y\Ü]QØÝ[Y[ÊÛY[XÝ[ÛœÈH×JHÂˆÛÛœÝØ\ÙRYHXÝ[ÛœÖÌOË˜Ø\ÙWÚYÂˆÛÛœÝØÝ[Y[ÈHØ\ÙRYÈ]ØZ]ØY\Ü]UÛÜšÙ›ÝÑØÝ[Y[ÊÛY[Ø\ÙRY
Hˆ×NÂˆYˆ
XXÝ[ÛœËœÛÛYJ
XÝ[ÛŠHOˆXÝ[Û‹œ™\]Z\™\×Ø]XÚY[OOHYJJH™]\›ˆØÝ[Y[ÎÂˆÛÛœÝZ\ÜÚ[™ÈHZ\ÜÚ[™Ô™\]Z\™Y\Ü]QØÝ[Y[ÊXÝ[ÛœËØÝ[Y[ÊNÂˆYˆ
Z\ÜÚ[™Ë›[™Ý
HÂˆÛÛœÝX™[ÈHZ\ÜÚ[™Ë›X\

XÝ[ÛŠHOˆ	ØXÝ[Û‹˜XÝ[Û—ÛX™[XÝ[Û‹˜XÝ[Û—Ý\_H
	ØXÝ[Û‹œ\WÜÚY_JX
NÂˆ›ÝÈ\\œ›ÜŠ\ØYH™\]Z\™YØÝ[Y[›ÜŽˆ	ÛX™[Ëš›Ú[Š	Ë	Ê_K˜
NÂˆBˆ™]\›ˆØÝ[Y[ÎÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ]Ú\Ü]UÛÜšÙ›ÝÔÝ]\Ò[”Ø[\Ù›Ü˜ÙJØ\ÙT›ÝËØ[\Ù›Ü˜ÙTÝ]\ÊHÂˆÛÛœÝÝ\œ™[›ÝÜÈH]ØZ]]Y\žT›ÝÜÊˆÑSPÕY\Ü]WÔÝ]\××ØË\Ý[ÙYšYY]Bˆ”“ÓHÝ[W×ØÂˆÒT‘HYH	ÉÙ\ØØ\TÛÜ[
Ø\ÙT›ÝËœÝ[WÚY
_IÂˆSRUBˆ
NÂˆÛÛœÝÝ\œ™[Ý[HHÝ\œ™[›ÝÜÖÌNÂˆYˆ
XÝ\œ™[Ý[JH›ÝÈ\\œ›ÜŠ	ÕH\Ü]YÕSH›ÈÛ™Ù\ˆ^\ÝÈ[ˆØ[\Ù›Ü˜ÙK‰Ë
NÂ‚ˆYˆ
\ÔØ[\Ù›Ü˜ÙQ\Ü]PÛÜÙY
Ý\œ™[Ý[K‘\Ü]WÔÝ]\××ØÊJHÂˆÛÛœÝÛÛ[Z[™Ô™XÛÜ™YÛÜÙHH\ÔØ[\Ù›Ü˜ÙQ\Ü]PÛÜÙY
Ø[\Ù›Ü˜ÙTÝ]\ÊH	‰ˆ\ÔØ[\Ù›Ü˜ÙQ\Ü]PÛÜÙY
Ø\ÙT›ÝË˜Ý\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\ÊH	‰ˆØ\ÙT›ÝËœØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×ÜÝ]\ÈOOH	ÜÝXØÙ\ÜÉÎÂˆYˆ
ÛÛ[Z[™Ô™XÛÜ™YÛÜÙJH™]\›ŽÂˆ\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆB‚ˆÛÛœÝY•[›[ÙYšYYÚ[˜ÙHHÝ\œ™[Ý[K“\Ý[ÙYšYY]HÈ™]È]JÝ\œ™[Ý[K“\Ý[ÙYšYY]JKÕUÔÝš[™Ê
Hˆ[ÂˆžHÂˆ]ØZ]Ù”™\]Y\Ý
ÜÛØš™XÝËÜÝ[W×ØËÉÙ[˜ÛÙUT’PÛÛ\Û™[
Ø\ÙT›ÝËœÝ[WÚY
_XÂˆY]Ùˆ	ÔUÒ	Ëˆ›ÙNˆÈ\Ü]WÔÝ]\××ØÎˆØ[\Ù›Ü˜ÙTÝ]\ÈKˆXY\œÎˆY•[›[ÙYšYYÚ[˜ÙHÈÈ	ÒY‹U[›[ÙYšYYTÚ[˜ÙIÎˆY•[›[ÙYšYYÚ[˜ÙHHˆ[™Yš[™YˆJNÂˆHØ]Ú
\œ›ÜŠHÂˆYˆ
\œ›Ü‹œÝ]\ÈOOHLŠHÂˆ›ÝÈ\\œ›ÜŠ	ÔØ[\Ù›Ü˜ÙHÚ[™ÙYÚ[HÓÔÈØ\ÈØ]š[™È\ÈÛÜšÙ›ÝËˆ™Yœ™\ÚH\Ü]HÛÜšÙ›ÝÈ]Y]YH[™žHYØZ[‹‰ËJNÂˆBˆ›ÝÈ\œ›ÜŽÂˆBŸB‚˜\Þ[˜È[˜Ý[Ûˆ™XÛÜ™\Ü]UÛÜšÙ›ÝÔØ[\Ù›Ü˜ÙUÜš]X˜XÚÊÛY[Ø\ÙT›ÝË›Ùš[KØ[\Ù›Ü˜ÙTÝ]\ËÜš]X˜XÚÔÝ]\ÈH	ÜÝXØÙ\ÜÉËÜš]X˜XÚÑ\œ›ÜˆH[
HÂˆÛÛœÝÈ]Nˆ\]YØ\ÙK\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊBˆ\]JÂˆÝ\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\ÎˆÜš]X˜XÚÔÝ]\ÈOOH	ÜÝXØÙ\ÜÉÈÈØ[\Ù›Ü˜ÙTÝ]\ÈˆØ\ÙT›ÝË˜Ý\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\ËˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×ÜÝ]\ÎˆÜš]X˜XÚÔÝ]\ËˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×Ù\œ›ÜŽˆÜš]X˜XÚÑ\œ›Ü‹ˆ\]YØ]ˆ™]È]J
KÒTÓÔÝš[™Ê
KˆJBˆ™\J	ÚY	ËØ\ÙT›ÝËšY
BˆœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
BˆœÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[\]YØ\ÙK	ÜØ[\Ù›Ü˜ÙWÝÜš]X˜XÚÉË›Ùš[KÂˆ›ÝNˆÜš]X˜XÚÔÝ]\ÈOOH	ÜÝXØÙ\ÜÉÈÈØ[\Ù›Ü˜ÙH\Ü]HÝ]\È\]YÈ	ÜØ[\Ù›Ü˜ÙTÝ]\ßK˜ˆØ[\Ù›Ü˜ÙH\Ü]HÝ]\È\]HÈ	ÜØ[\Ù›Ü˜ÙTÝ]\ßH˜Z[Y˜ˆY]Y]NˆÈØ[\Ù›Ü˜ÙTÝ]\Ë\œ›ÜŽˆÜš]X˜XÚÑ\œ›ÜˆKˆJNÂˆ™]\›ˆ\]YØ\ÙNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜš]Q\Ü]UÛÜšÙ›ÝÔÝ]\ÕÔØ[\Ù›Ü˜ÙJÛY[Ø\ÙT›ÝË›Ùš[KØ[\Ù›Ü˜ÙTÝ]\ËÜ[ÛœÈHßJHÂˆ]Üš]X˜XÚÔÝ]\ÈH	ÜÝXØÙ\ÜÉÎÂˆ]Üš]X˜XÚÑ\œ›ÜˆH[Âˆ]Üš]X˜XÚÑ˜Z[\™HH[ÂˆžHÂˆ]ØZ]]Ú\Ü]UÛÜšÙ›ÝÔÝ]\Ò[”Ø[\Ù›Ü˜ÙJØ\ÙT›ÝËØ[\Ù›Ü˜ÙTÝ]\ÊNÂˆHØ]Ú
\œ›ÜŠHÂˆÜš]X˜XÚÔÝ]\ÈH	Ù˜Z[Y	ÎÂˆÜš]X˜XÚÑ\œ›ÜˆH\œ›Ü‹›Y\ÜØYÙNÂˆÜš]X˜XÚÑ˜Z[\™HH\œ›ÜŽÂˆBˆÛÛœÝ\]YØ\ÙHH]ØZ]™XÛÜ™\Ü]UÛÜšÙ›ÝÔØ[\Ù›Ü˜ÙUÜš]X˜XÚÊÛY[Ø\ÙT›ÝË›Ùš[KØ[\Ù›Ü˜ÙTÝ]\ËÜš]X˜XÚÔÝ]\ËÜš]X˜XÚÑ\œ›ÜŠNÂˆYˆ
Ü[ÛœËœ™\]Z\™Y	‰ˆÜš]X˜XÚÔÝ]\ÈOOH	Ù˜Z[Y	ÊHÂˆYˆ
Üš]X˜XÚÑ˜Z[\™OËœÝ]\ÊH›ÝÈÜš]X˜XÚÑ˜Z[\™NÂˆ›ÝÈ\\œ›ÜŠØ[\Ù›Ü˜ÙH\Ü]HÝ]\ÈÛÝ[›Ý™H\]Yˆ	ÝÜš]X˜XÚÑ\œ›ÜŸXLŠNÂˆBˆ™]\›ˆ\]YØ\ÙNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ù\\Ü]P™]PØ\ÙJÛY[Ý[K^˜HHßJHÂˆÛÛœÝ›ÝÒ\ÛÈH™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝØ\ÙT^[ØYHÂˆ‹‹™\Ü]P™]PØ\ÙQœ›ÛTÝ[JÝ[JKˆ]\ÝÛ›ÝNˆÝš[™Ê^˜K›]\Ý›ÝHÏÈ^˜K›]\ÝÛ›ÝHÏÈ	ÉÊKš[J
Kˆ\]YØ]ˆ›ÝÒ\ÛËˆNÂˆYˆ
^˜KÛÜšÙ›ÝÔÝ]\ÊHØ\ÙT^[ØYÛÜšÙ›Ý×ÜÝ]\ÈH›Ü›X[^™Q\Ü]P™]TÝ]\Ê^˜KÛÜšÙ›ÝÔÝ]\ËTÔUWÐ‘UWÕÓÔ’Ñ“Õ×ÔÕUTÑTË	Ñ˜Y	ÊNÂˆYˆ
^˜K˜\›Ý˜[Ý]\ÊHØ\ÙT^[ØY˜\›Ý˜[ÜÝ]\ÈH›Ü›X[^™Q\Ü]P™]TÝ]\Ê^˜K˜\›Ý˜[Ý]\ËTÔUWÐ‘UWÐT“ÕSÔÕUTÑTË	Ñ˜Y	ÊNÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊK\Ù\
Ø\ÙT^[ØYÈÛÛÛ™›XÝˆ	ÜÝ[WÚY	ÈJKœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
KœÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ™]\›ˆ]NÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÙ]\Ü]P™]PØ\ÙJÛY[Ø\ÙRYÜ”Ý[RY
HÂˆÛÛœÝ˜[YHHÝš[™ÊØ\ÙRYÜ”Ý[RY	ÉÊKš[J
NÂˆYˆ
]˜[YJH›ÝÈ\\œ›ÜŠ	ØØ\ÙRYÜˆÝ[RY\È™\]Z\™Y‰Ë
NÂˆÛÛœÝ]Y\žHHÛY[™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊKœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
NÂˆÛÛœÝÈ]K\œ›ÜˆHH\ÔØ[\Ù›Ü˜ÙRY
˜[YJHÈ]ØZ]]Y\žK™\J	ÜÝ[WÚY	Ë˜[YJK›X^X™TÚ[™ÛJ
Hˆ]ØZ]]Y\žK™\J	ÚY	Ë˜[YJK›X^X™TÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆYˆ
Y]JH›ÝÈ\\œ›ÜŠ	Ñ\Ü]HÛÜšÙ›ÝÈØ\ÙH›Ý›Ý[™‰Ë
NÂˆ™]\›ˆ]NÂŸB‚™[˜Ý[ÛˆÙ[XÝY\T›ÝÜÑœ›ÛPXØÛÝ[Ê™YÚ\ÝžKXØÛÝ[YÈH×JHÂˆÛÛœÝÙ[XÝYÙ^\ÈH™]ÈÙ]
XØÛÝ[YË›X\
\Ü]TØ[\Ù›Ü˜ÙRYÙ^JK™š[\Š›ÛÛX[ŠJNÂˆÛÛœÝØ[™Y]PžRÙ^HH™]ÈX\

™YÚ\ÝžOË˜Ø[™Y]\È×JK›X\

Ø[™Y]JHOˆØØ[™Y]K˜XØÛÝ[Ù^KØ[™Y]WJJNÂˆÛÛœÝ[˜[YÙ^\ÈHË‹‹œÙ[XÝYÙ^\×K™š[\Š
Ù^JHOˆXØ[™Y]PžRÙ^Kš\ÊÙ^JJNÂˆYˆ
[˜[YÙ^\Ë›[™Ý
H›ÝÈ\\œ›ÜŠ	ÓÛ™HÜˆ[Ü™HÙ[XÝYXØÛÝ[È\™H›ÈÛ™Ù\ˆ[YÚX›H›Üˆ\ÈÕSK‰Ë
NÂˆYˆ
\Ù[XÝYÙ^\ËœÚ^™JH›ÝÈ\\œ›ÜŠ	ÔÙ[XÝ]X\ÝÛ™H\Ü]YXØÛÝ[™Y›Ü™HØ]š[™Ë‰Ë
NÂˆ™]\›ˆË‹‹œÙ[XÝYÙ^\×K›X\

Ù^JHOˆÂˆÛÛœÝØ[™Y]HHØ[™Y]PžRÙ^K™Ù]
Ù^JNÂˆ™]\›ˆÂˆYˆ[ˆØ\ÙWÚYˆ[ˆÝ[WÚYˆ[ˆXØÛÝ[ÚYˆØ[™Y]K˜XØÛÝ[YˆXØÛÝ[ÚÙ^NˆØ[™Y]K˜XØÛÝ[Ù^KˆXØÛÝ[Û˜[YNˆØ[™Y]K›˜[YKˆ›Û\ÎˆØ[™Y]Kœ›Û\ËˆÛÝ\˜ÙWÝ\\ÎˆØ[™Y]KœÛÝ\˜ÙU\\ËˆÛÝ\˜ÙWÜ™XÛÜ™ÚYÎˆØ[™Y]KœÛÝ\˜ÙT™XÛÜ™YËˆ^[Y[Ý\›\ÎˆØ[™Y]Kœ^[Y[\›\Ëˆ›ÙXÝÎˆØ[™Y]Kœ›ÙXÝËˆØ[˜Ù[YÜÛÝ\˜ÙWÛÛ›NˆØ[™Y]K˜Ø[˜Ù[YÛÝ\˜ÙSÛ›KˆNÂˆJNÂŸB‚™[˜Ý[Ûˆ˜[Y]TÝÜ™Y\Ü]PXÝ[ÛœÊXÝ[ÛœË\T›ÝÜË™YÚ\ÝžJHÂˆÛÛœÝ\PžRYH\Ü]T\T›ÝÓX\
\T›ÝÜÊNÂˆÛÛœÝÙY[ˆH™]ÈÙ]

NÂˆ›Üˆ
ÛÛœÝXÝ[ÛˆÙˆXÝ[ÛœÈ×JHÂˆÛÛœÝ\HH\PžRY™Ù]
XÝ[Û‹œ\WÚY
NÂˆYˆ
\\JH›ÝÈ\\œ›ÜŠXÝ[Ûˆ	ØXÝ[Û‹˜XÝ[Û—ÛX™[XÝ[Û‹šYH\È›ÈÙ[XÝY\Ü]YXØÛÝ[˜
NÂˆÛÛœÝØ[™Y]HHš[™\Ü]T\J™YÚ\ÝžKXÝ[Û‹œ\WÜÚYK\K˜XØÛÝ[ÚY
NÂˆYˆ
XØ[™Y]JH›ÝÈ\\œ›ÜŠ	Ü\K˜XØÛÝ[Û˜[Y_H\È›ÈÛ™Ù\ˆ[YÚX›HÛˆH	ØXÝ[Û‹œ\WÜÚY_HÚYK˜
NÂˆÛÛœÝÙ^HH	Ü\K˜XØÛÝ[ÚÙ^_N‰ØXÝ[Û‹œ\WÜÚY_XÂˆYˆ
ÙY[‹š\ÊÙ^JJH›ÝÈ\\œ›ÜŠÛ›HÛ™H	ØXÝ[Û‹œ\WÜÚY_HXÝ[ÛˆX^H™HYY›Üˆ	Ü\K˜XØÛÝ[Û˜[Y_K˜
NÂˆÙY[‹˜Y
Ù^JNÂˆBˆ™]\›ˆXÝ[ÛœÈ×NÂŸB‚™[˜Ý[ÛˆÝ\Y\XÝ[ÛœÓZ\ÜÚ[™Ñ\Ü]P[[Ý[
XÝ[ÛœÈH×JHÂˆ™]\›ˆXÝ[ÛœË™š[\Š
XÝ[ÛŠHOˆXÝ[Û‹œ\WÜÚYHOOH	ÜÝ\Y\‰È	‰ˆTÔUWÓQÐPÖWÔÕTQT—Ñ’SSÒPSÐPÕSÓ”Ëš\ÊXÝ[Û‹˜XÝ[Û—Ý\JH	‰ˆXÝ[Û‹˜[[Ý[OH[
NÂŸB‚™[˜Ý[Ûˆ\ÜÙ\Ý\Y\‘\Ü]P[[Ý[ÊXÝ[ÛœÈH×JHÂˆÛÛœÝZ\ÜÚ[™ÈHÝ\Y\XÝ[ÛœÓZ\ÜÚ[™Ñ\Ü]P[[Ý[
XÝ[ÛœÊNÂˆYˆ
Z\ÜÚ[™Ë›[™Ý
HÂˆ›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ\Ü]H[[Ý[™\]Z\™Yˆ™XÛÜ™HYÜ™YY[[Ý[™Y›Ü™H\ÈYØXÞHÛÜšÙ›ÝÈØ[ˆ›ÙÜ™\ÜË‰ËJNÂˆBˆÛÛœÝYØXÞHHXÝ[ÛœË™š[\Š
XÝ[ÛŠHOˆXÝ[Û‹œ\WÜÚYHOOH	ÜÝ\Y\‰È	‰ˆTÔUWÓQÐPÖWÔÕTQT—Ñ’SSÒPSÐPÕSÓ”Ëš\ÊXÝ[Û‹˜XÝ[Û—Ý\JJNÂˆYˆ
YØXÞK›[™Ý
HÂˆ›ÝÈ\\œ›ÜŠ	ÐÛÛ™\XXÚYØXÞHÝ\Y\ˆXÝ[Ûˆ[È[›ÚXÙK[]™[š[˜[˜ÙH[œÝXÝ[ÛœÈ™Y›Ü™H\ÈÛÜšÙ›ÝÈØ[ˆ›ÙÜ™\ÜË‰ËJNÂˆBŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]P™]S\Ý
›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝ[Z]H›ÙK›[Z]LÂˆÛÛœÝØXÚYH]ØZ]ØXÚYØ[\Ù›Ü˜ÙU˜[YJÂˆ˜[Y\ÜXÙNˆ	ÜØ[\Ù›Ü˜ÙKY\Ü]K\]Y]YIËˆÙXÛÛ™ÎˆÌˆ^[ØYˆÈ[Z]KˆYÜÎˆÉÜØ[\Ù›Ü˜ÙN™\Ü]\ÉË	ÜØ[\Ù›Ü˜ÙNœÝ[IË	ÜØ[\Ù›Ü˜ÙN˜XØÛÝ[	×Kˆ›ÙKˆ™\KˆXØÙ\ÜÐÛÛ^ˆXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HKˆØY\Žˆ

HOˆØ[\Ù›Ü˜ÙQ\Ü]TÝ[\ÊÈ[Z]K[XØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJKˆJNÂˆÛÛœÝØ[\Ù›Ü˜ÙQ]HHØXÚY˜[YNÂˆÛÛœÝ›ÝÜÈHØ[\Ù›Ü˜ÙQ]Kœ›ÝÜÈ×NÂˆ]ÝÛÜšÙ›ÝÓX\Ø\Xš[]Y\×HH]ØZ]›ÛZ\ÙK˜[
ÂˆØY\Ü]P™]UÛÜšÙ›ÝÓX\
ˆÛY[ˆ›ÝÜË›X\

›ÝÊHOˆ›ÝË’Y
Kˆ
Kˆ\Ü]UÛÜšÙ›ÝÐØ\Xš[]Y\ÊÛY[›Ùš[JKˆJNÂˆ]™XÛÛ˜Ú[YH˜[ÙNÂˆÛÛœÝ™XÛÛ˜Ú[X][Û‘\œ›ÜœÈH™]ÈX\

NÂˆ›Üˆ
ÛÛœÝÝ[HÙˆ›ÝÜÊHÂˆÛÛœÝÛÜšÙ›ÝÈHÛÜšÙ›ÝÓX\ÜÝ[K’YNÂˆYˆ
ÛÜšÙ›ÝÏË˜Ø\ÙOË˜\›Ý˜[Ý]\ÈOOH	Ð\›Ý™Y	ÈÛÜšÙ›ÝË˜Ø\ÙKÛÜšÙ›ÝÔÝ]\ÈOOH	ÐÛÜÙY	È]ÛÜšÙ›ÝË˜XÝ[ÛœËœÛÛYJ
XÝ[ÛŠHOˆXÝ[Û‹˜XÝ[Û•\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÊH\Ý[K—ÔÝ\Y\—ÔÙ][Y[ÔØÚ[XOË˜[Y
HÛÛ[YNÂˆžHÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[ÛÜšÙ›ÝË˜Ø\ÙKšY
NÂˆÛÛœÝÝÜ™YH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ™\Ý[H]ØZ]™XÛÛ˜Ú[P\›Ý™YÝ\Y\’[œÝXÝ[ÛœÊÛY[Ø\ÙT›ÝËÝÜ™Yœ\T›ÝÜËÝÜ™Y˜XÝ[Û”›ÝÜËÝÜ™Yš[œÝXÝ[Û”›ÝÜËÝ[K›Ùš[JNÂˆ™XÛÛ˜Ú[YH™XÛÛ˜Ú[Y™\Ý[˜Ú[™ÙY™\Ý[Üš]X˜XÚÔ™]šYYÂˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÛÛK™\œ›ÜŠ	ÖÙ\Ü]K]ÛÜšÙ›Ý×HÝ\Y\ˆ™XÛÛ˜Ú[X][Ûˆ˜Z[Y	ËÂˆ™\]Y\ÝYˆ™\]Y\ÝYœ›ÛJ™\JKˆÛÙNˆ\œ›ÜË˜ÛÙH[ˆJNÂˆ™XÛÛ˜Ú[X][Û‘\œ›ÜœËœÙ]
Ý[K’Y	ÔÝ\Y\ˆ^[Y[™XÛÛ˜Ú[X][Ûˆ\È[\Ü˜\š[H[˜]˜Z[X›Kˆš[˜[˜ÙHXØÛÝ[[™È™[XZ[œÈ[˜Ú[™ÙY‰ÊNÂˆBˆBˆYˆ
™XÛÛ˜Ú[Y
HÂˆÛÜšÙ›ÝÓX\H]ØZ]ØY\Ü]P™]UÛÜšÙ›ÝÓX\
ˆÛY[ˆ›ÝÜË›X\

›ÝÊHOˆ›ÝË’Y
Kˆ
NÂˆBˆ›Üˆ
ÛÛœÝÜÝ[RY\œ›Ü—HÙˆ™XÛÛ˜Ú[X][Û‘\œ›ÜœÊHÂˆYˆ
ÛÜšÙ›ÝÓX\ÜÝ[RYJHÛÜšÙ›ÝÓX\ÜÝ[RYKœ™XÛÛ˜Ú[X][Û‘\œ›ÜˆH\œ›ÜŽÂˆBˆ›Ú™XÝ^\›˜[PÛÜÙY\Ü]UÛÜšÙ›ÝÜÊ›ÝÜËÛÜšÙ›ÝÓX\
NÂˆ™]\›ˆÂˆ\Ñ\Ü]PYZ[ŽˆØ\Xš[]Y\Ë˜Ø[\›Ý™Kˆ\Ñ\Ü]PXØÛÝ[[™ÎˆØ\Xš[]Y\Ë˜Ø[XØÛÝ[ˆØ\Xš[]Y\Ëˆ™\]Z\™YØ[\Ù›Ü˜ÙQšY[ÓZ\ÜÚ[™ÎˆYKˆšY[Ø\›š[™Îˆ	Ñ\Ü]YXØÛÝ[Ë\›Ý˜[XØÛÝ[[™ËØÝ[Y[Ë[™]Y]Ý]H\™HÝÜ™Y[ˆÝ\X˜\ÙKˆØ[\Ù›Ü˜ÙH™XÙZ]™\ÈÛ›HHYÚ[]™[ÕSH\Ü]HÝ]\Ë‰Ëˆ›ÝÜÎˆ›ÝÜË›X\

›ÝÊHOˆÂˆÛÛœÝÛÜšÙ›ÝÈHÛÜšÙ›ÝÓX\Ü›ÝË’YHÂˆØ\ÙNˆ[ˆ\Y\Îˆ×KˆXÝ[ÛœÎˆ×KˆÝ\Y\’[œÝXÝ[ÛœÎˆ×Kˆ]™[Îˆ×KˆØÝ[Y[Îˆ×KˆNÂˆYˆ
]ÛÜšÙ›ÝË˜Ø\ÙJHÛÜšÙ›ÝË˜Ø\ÙHHYØXÞPÛÜÙY\Ü]PØ\ÙJ›ÝÊNÂˆ™]\›ˆÂˆ‹‹œ›ÝËˆÑ\Ü]WÔ\Y\Îˆ\Ü]T™YÚ\ÝžUÚ]Ù[XÝ[ÛŠ›ÝË—Ñ\Ü]WÔ\Y\ËÛÜšÙ›ÝËœ\Y\ÊKˆÑ\Ü]WÕÛÜšÙ›ÝÎˆÛÜšÙ›ÝËˆNÂˆJKˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]P™]TØ]™Q˜Y
›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÝ[HH›ÙKœÝ[HßNÂˆÛÛœÝÝ[RYHÝ[K’Y›ÙKœÝ[RYÂˆYˆ
\Ý[RY
H›ÝÈ\\œ›ÜŠ	ÜÝ[RY\È™\]Z\™Y‰Ë
NÂˆÛÛœÝØÝ\œ™[Ý[K^\Ý[™ÐØ\ÙT™\Ý[HH]ØZ]›ÛZ\ÙK˜[
ÛØYÝ\œ™[\Ü]TÝ[JÝ[RYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJKÛY[™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊKœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
K™\J	ÜÝ[WÚY	ËÝ[RY
K›X^X™TÚ[™ÛJ
WJNÂˆ\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆÛÛœÝØ[™Y]T™YÚ\ÝžHHÝ\œ™[Ý[K—Ñ\Ü]WÔ\Y\ÎÂˆYˆ
XØ[™Y]T™YÚ\ÝžOË˜Ø[™Y]TØÚ[XU˜[Y
HÂˆÛÛœÝY\ÜØYÙ\ÈH
Ø[™Y]T™YÚ\ÝžOËš\ÜÝY\È×JK›X\

][JHOˆ][K›Y\ÜØYÙJK™š[\Š›ÛÛX[ŠNÂˆ›ÝÈ\\œ›ÜŠÛÜœ™XÝHØ[\Ù›Ü˜ÙHXØÛÝ[ÛÝ\˜Ù\È™Y›Ü™HÛÛ[Z[™Îˆ	ÛY\ÜØYÙ\Ëš›Ú[Š	È	Ê_X
NÂˆBˆYˆ
^\Ý[™ÐØ\ÙT™\Ý[™\œ›ÜŠH›ÝÈ^\Ý[™ÐØ\ÙT™\Ý[™\œ›ÜŽÂˆÛÛœÝ^\Ý[™ÐØ\ÙHH^\Ý[™ÐØ\ÙT™\Ý[™]NÂˆYˆ
^\Ý[™ÐØ\ÙH	‰ˆVÉÑ˜Y	Ë	Ô™Z™XÝY	Ë	Ô™]š\Ú[Ûˆ™\]Y\ÝY	×Kš[˜ÛY\Ê^\Ý[™ÐØ\ÙKÛÜšÙ›Ý×ÜÝ]\ÊJHÂˆ›ÝÈ\\œ›ÜŠ	Õ˜Y\ˆ[œÝXÝ[ÛœÈ\™HØÚÙYY\ˆÝX›Z\ÜÚ[Û‹ˆ™\]Y\ÝH™]š\Ú[Ûˆ™Y›Ü™HY][™È[K‰Ë
NÂˆBˆÛÛœÝÙ[XÝY\T›ÝÜÈHÙ[XÝY\T›ÝÜÑœ›ÛPXØÛÝ[ÊØ[™Y]T™YÚ\ÝžK›ÙKœÙ[XÝY\PXØÛÝ[YÈ×JNÂˆYˆ
^\Ý[™ÐØ\ÙJHÂˆÛÛœÝÙ[XÝYXØÛÝ[Ù^\ÈH™]ÈÙ]
Ù[XÝY\T›ÝÜË›X\

\JHOˆ\K˜XØÛÝ[ÚÙ^JJNÂˆÛÛœÝÜÝÜ™Y\Y\Ô™\Ý[ÝÜ™YØÝ[Y[Ô™\Ý[HH]ØZ]›ÛZ\ÙK˜[
ØÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×Ü\Y\ÉÊKœÙ[XÝ
	ÚYXØÛÝ[ÚÙ^KXØÛÝ[Û˜[YIÊK™\J	ØØ\ÙWÚY	Ë^\Ý[™ÐØ\ÙKšY
KÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÙØÝ[Y[ÉÊKœÙ[XÝ
	Ü\WÚY	ÊK™\J	ØØ\ÙWÚY	Ë^\Ý[™ÐØ\ÙKšY
WJNÂˆYˆ
ÝÜ™Y\Y\Ô™\Ý[™\œ›ÜŠH›ÝÈÝÜ™Y\Y\Ô™\Ý[™\œ›ÜŽÂˆYˆ
ÝÜ™YØÝ[Y[Ô™\Ý[™\œ›ÜŠH›ÝÈÝÜ™YØÝ[Y[Ô™\Ý[™\œ›ÜŽÂˆÛÛœÝØÝ[Y[Y\RYÈH™]ÈÙ]

ÝÜ™YØÝ[Y[Ô™\Ý[™]H×JK›X\

ØÝ[Y[
HOˆØÝ[Y[œ\WÚY
K™š[\Š›ÛÛX[ŠJNÂˆÛÛœÝØÝ[Y[Y™[[Ý™Y\Y\ÈH
ÝÜ™Y\Y\Ô™\Ý[™]H×JK™š[\Š
\JHOˆ\Ù[XÝYXØÛÝ[Ù^\Ëš\Ê\K˜XØÛÝ[ÚÙ^JH	‰ˆØÝ[Y[Y\RYËš\Ê\KšY
JNÂˆYˆ
ØÝ[Y[Y™[[Ý™Y\Y\Ë›[™Ý
HÂˆÛÛœÝ˜[Y\ÈHØÝ[Y[Y™[[Ý™Y\Y\Ë›X\

\JHOˆ\K˜XØÛÝ[Û˜[YH\K˜XØÛÝ[ÚÙ^JKš›Ú[Š	Ë	ÊNÂˆ›ÝÈ\\œ›ÜŠÙY\	Û˜[Y\ßHÙ[XÝY™XØ]\ÙH\Ü]HØÝ[Y[È\™H[™XYH[šÙYÈHXØÛÝ[˜
NÂˆBˆBˆÛÛœÝ™YÚ\ÝžHH\Ü]T™YÚ\ÝžUÚ]Ù[XÝ[ÛŠØ[™Y]T™YÚ\ÝžKÙ[XÝY\T›ÝÜÊNÂˆÛÛœÝØ\ÙR[œ]HÈYˆ^\Ý[™ÐØ\ÙOËšY[Ý[WÚYˆÝ[RYNÂˆÛÛœÝ›Ü›X[^™YXÝ[ÛœÈH
›ÙK˜XÝ[ÛœÈ×JK›X\

XÝ[ÛŠHO‚ˆ™\\™TÝ\Y\”Ù][Y[XÝ[ÛŠˆÂˆYˆÝš[™ÊXÝ[Û‹šY	ÉÊKš[J
H[ˆ‹‹››Ü›X[^™Q\Ü]P™]PXÝ[ÛŠXÝ[Û‹Ø\ÙR[œ]›Ùš[K™YÚ\ÝžJKˆKˆÝ\œ™[Ý[Kˆ
Kˆ
NÂˆÛÛœÝÙY[XÝ[Û”ÚY\ÈH™]ÈÙ]

NÂˆ›Üˆ
ÛÛœÝXÝ[ÛˆÙˆ›Ü›X[^™YXÝ[ÛœÊHÂˆÛÛœÝÙ^HH	ØXÝ[Û‹œ\WØXØÛÝ[ÚÙ^_N‰ØXÝ[Û‹œ\WÜÚY_XÂˆYˆ
ÙY[XÝ[Û”ÚY\Ëš\ÊÙ^JJH›ÝÈ\\œ›ÜŠ	ÓÛ›HÛ™HXÝ[Ûˆ\ˆÙ[XÝYXØÛÝ[ÚYH\È[ÝÙY‰Ë
NÂˆÙY[XÝ[Û”ÚY\Ë˜Y
Ù^JNÂˆBˆÛÛœÝš[˜[˜ÚX[ÈHØ[Ý[]Q\Ü]P™]TÙ][Y[
›Ü›X[^™YXÝ[ÛœÊNÂˆ]ØZ]]Ú\Ü]UÛÜšÙ›ÝÔÝ]\Ò[”Ø[\Ù›Ü˜ÙJ^\Ý[™ÐØ\ÙHÈÝ[WÚYˆÝ[RYK	ÓÜ[ˆH˜Y\ˆ™]šY]ÉÊNÂˆÛÛœÝØ\ÙT^[ØYHÂˆ‹‹™\Ü]P™]PØ\ÙQœ›ÛTÝ[JÝ\œ™[Ý[JKˆÝ\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\Îˆ	ÓÜ[ˆH˜Y\ˆ™]šY]ÉËˆÛÜšÙ›Ý×ÜÝ]\Îˆ	Ñ˜Y	Ëˆ\›Ý˜[ÜÝ]\Îˆ	Ñ˜Y	Ëˆ]\ÝÛ›ÝNˆÝš[™Ê›ÙK›]\Ý›ÝH	ÉÊKš[J
KˆÙ][Y[Ùš[˜[˜ÚX[Îˆš[˜[˜ÚX[ËˆÙ][Y[Ü›ˆš[˜[˜ÚX[ËœÙ][Y[›ˆNÂˆÛÛœÝÈ]NˆØ]™YØ\ÙRY\œ›ÜŽˆØ]™Q\œ›ÜˆHH]ØZ]ÛY[œœÊ	ÜØ]™WÙ\Ü]WÝÛÜšÙ›Ý×Ù˜Y	ËÂˆØØ\ÙNˆØ\ÙT^[ØYˆÜ\Y\ÎˆÙ[XÝY\T›ÝÜË›X\

\JHOˆ
ÂˆXØÛÝ[ÚYˆ\K˜XØÛÝ[ÚYˆXØÛÝ[ÚÙ^Nˆ\K˜XØÛÝ[ÚÙ^KˆXØÛÝ[Û˜[YNˆ\K˜XØÛÝ[Û˜[YKˆ›Û\Îˆ\Kœ›Û\ËˆÛÝ\˜ÙWÝ\\Îˆ\KœÛÝ\˜ÙWÝ\\ËˆÛÝ\˜ÙWÜ™XÛÜ™ÚYÎˆ\KœÛÝ\˜ÙWÜ™XÛÜ™ÚYËˆ^[Y[Ý\›\Îˆ\Kœ^[Y[Ý\›\Ëˆ›ÙXÝÎˆ\Kœ›ÙXÝËˆØ[˜Ù[YÜÛÝ\˜ÙWÛÛ›Nˆ\K˜Ø[˜Ù[YÜÛÝ\˜ÙWÛÛ›KˆJJKˆØXÝ[ÛœÎˆ›Ü›X[^™YXÝ[ÛœËˆØXÝÜŽˆÈYˆ›Ùš[KšY[XZ[ˆ›Ùš[K™[XZ[KˆÙ]™[Û›ÝNˆ›ÙK›]\Ý›ÝH	Ñ˜YØ]™Y‰ËˆJNÂˆYˆ
Ø]™Q\œ›ÜŠH›ÝÈØ]™Q\œ›ÜŽÂˆÛÛœÝ\]YØ\ÙHH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[Ø]™YØ\ÙRYÝ[RY
NÂˆ]ØZ]ÛX\’[˜[Y\Ü]PÛÛ\[œØ][Û“[šÜÊÛY[\]YØ\ÙK›Ùš[JNÂˆÛÛœÝÛÜšÙ›ÝÔ›ÛZ\ÙHHØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[\]YØ\ÙKšY
NÂˆÛÛœÝØÝ[Y[Ô›ÛZ\ÙHHØY\Ü]UÛÜšÙ›ÝÑØÝ[Y[ÊÛY[\]YØ\ÙKšY
NÂˆÛÛœÝÝ]\Ô›ÛZ\ÙHH™XÛÜ™\Ü]UÛÜšÙ›ÝÔØ[\Ù›Ü˜ÙUÜš]X˜XÚÊÛY[\]YØ\ÙK›Ùš[K	ÓÜ[ˆH˜Y\ˆ™]šY]ÉÊNÂˆÛÛœÝÞÈ\T›ÝÜËXÝ[ÛœËÝ\Y\’[œÝXÝ[ÛœÈKØÝ[Y[ËÝ]\ÐØ\ÙWHH]ØZ]›ÛZ\ÙK˜[
ÝÛÜšÙ›ÝÔ›ÛZ\ÙKØÝ[Y[Ô›ÛZ\ÙKÝ]\Ô›ÛZ\ÙWJNÂˆÛÛœÝ]™[ÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÑ]™[ÊÛY[\]YØ\ÙKšY
NÂˆ™]\›ˆÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJÝ]\ÐØ\ÙJKˆ\Y\Îˆ\T›ÝÜË›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\JKˆXÝ[ÛœËˆÝ\Y\’[œÝXÝ[ÛœËˆ]™[Îˆ]™[Ë›X\
Ù\šX[^™Q\Ü]P™]Q]™[
KˆØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
KˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]P™]TÝX›Z]\›Ý˜[
›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[›ÙK˜Ø\ÙRY›ÙKœÝ[RY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝÝ\œ™[Ý[HH]ØZ]ØYÝ\œ™[\Ü]TÝ[JØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆ\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆÛÛœÝÈ\T›ÝÜËXÝ[Û”›ÝÜË[œÝXÝ[Û”›ÝÜËXÝ[ÛœÎˆÙ\šX[^™YXÝ[ÛœÈHH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ™YÚ\ÝžHH\ÜÙ\˜[Y\Ü]T\Y\ÊÝ\œ™[Ý[K\T›ÝÜÊNÂˆÛÛœÝXÝ[ÛœÈH˜[Y]TÝÜ™Y\Ü]PXÝ[ÛœÊXÝ[Û”›ÝÜË\T›ÝÜË™YÚ\ÝžJNÂˆYˆ
XXÝ[ÛœÏË›[™Ý
H›ÝÈ\\œ›ÜŠ	ÐY]X\ÝÛ™H˜Y\ˆXÝ[Ûˆ™Y›Ü™HÝX›Z][™È›Üˆ\›Ý˜[‰Ë
NÂˆ\ÜÙ\Ý\Y\‘\Ü]P[[Ý[ÊXÝ[ÛœÊNÂˆ\ÜÙ\Ý\Y\[ØØ][ÛœÐÝ\œ™[
XÝ[ÛœË\T›ÝÜË[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[JNÂˆYˆ
VÉÑ˜Y	Ë	Ô™Z™XÝY	Ë	Ô™]š\Ú[Ûˆ™\]Y\ÝY	×Kš[˜ÛY\ÊØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÊJHÂˆ›ÝÈ\\œ›ÜŠ	ÓÛ›H˜Y™Z™XÝYÜˆ™]š\Ú[Û‹\™\]Y\ÝYØ\Ù\ÈØ[ˆ™HÝX›Z]Y‰Ë
NÂˆBˆ]ØZ]\ÜÙ\™\]Z\™Y\Ü]QØÝ[Y[ÊÛY[XÝ[ÛœÊNÂˆ]ØZ]]Ú\Ü]UÛÜšÙ›ÝÔÝ]\Ò[”Ø[\Ù›Ü˜ÙJØ\ÙT›ÝË	Ô[™[™È\›Ý˜[	ÊNÂˆÛÛœÝ›ÝÒ\ÛÈH™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝÈ]Nˆ\]YØ\ÙK\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊBˆ\]JÂˆÛÜšÙ›Ý×ÜÝ]\Îˆ	Ô[™[™È\›Ý˜[	Ëˆ\›Ý˜[ÜÝ]\Îˆ	Ô[™[™È\›Ý˜[	ËˆÝX›Z]YØžNˆ›Ùš[KšYˆÝX›Z]YØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆÝX›Z]YØ]ˆ›ÝÒ\ÛËˆ]\ÝÛ›ÝNˆÝš[™Ê›ÙK››ÝHØ\ÙT›ÝË›]\ÝÛ›ÝH	ÉÊKš[J
Kˆ\]YØ]ˆ›ÝÒ\ÛËˆJBˆ™\J	ÚY	ËØ\ÙT›ÝËšY
BˆœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
BˆœÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[\]YØ\ÙK	ÜÝX›Z]Y	Ë›Ùš[KÂˆ›ÝNˆ›ÙK››ÝH	ÔÝX›Z]Y›Üˆ\Ü]HYZ[š\Ý˜]Üˆ\›Ý˜[‰ËˆJNÂˆÛÛœÝÝ]\ÐØ\ÙHH]ØZ]™XÛÜ™\Ü]UÛÜšÙ›ÝÔØ[\Ù›Ü˜ÙUÜš]X˜XÚÊÛY[\]YØ\ÙK›Ùš[K	Ô[™[™È\›Ý˜[	ÊNÂˆÛÛœÝØÝ[Y[ÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÑØÝ[Y[ÊÛY[Ø\ÙT›ÝËšY
NÂˆ™]\›ˆÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJÝ]\ÐØ\ÙJKˆ\Y\Îˆ\T›ÝÜË›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\JKˆXÝ[ÛœÎˆÙ\šX[^™YXÝ[ÛœËˆØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
KˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]P™]P\›Ý™J›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×Ø\›Ý™IË	Ñ\Ü]H\›Ý˜[\›Z\ÜÚ[Ûˆ\È™\]Z\™Y‰ËÊNÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[›ÙK˜Ø\ÙRY›ÙKœÝ[RY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆYˆ
Ø\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ô[™[™È\›Ý˜[	ÊH›ÝÈ\\œ›ÜŠ	ÓÛ›H[™[™È\Ü]HÛÜšÙ›ÝÈØ\Ù\ÈØ[ˆ™H\›Ý™Y‰Ë
NÂˆÛÛœÝÝ\œ™[Ý[HH]ØZ]ØYÝ\œ™[\Ü]TÝ[JØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆ\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆÛÛœÝÈ\T›ÝÜËXÝ[Û”›ÝÜË[œÝXÝ[Û”›ÝÜÈHH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ™YÚ\ÝžHH\ÜÙ\˜[Y\Ü]T\Y\ÊÝ\œ™[Ý[K\T›ÝÜÊNÂˆÛÛœÝXÝ[ÛœÈH˜[Y]TÝÜ™Y\Ü]PXÝ[ÛœÊXÝ[Û”›ÝÜË\T›ÝÜË™YÚ\ÝžJNÂˆ\ÜÙ\Ý\Y\‘\Ü]P[[Ý[ÊXÝ[ÛœÊNÂˆ\ÜÙ\Ý\Y\[ØØ][ÛœÐÝ\œ™[
XÝ[ÛœË\T›ÝÜË[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[JNÂˆ]ØZ]\ÜÙ\™\]Z\™Y\Ü]QØÝ[Y[ÊÛY[XÝ[ÛœÈ×JNÂˆÛÛœÝØ[\Ù›Ü˜ÙTÝ]\ÈH	Ð\›Ý™YH[™[™ÈXØÛÝ[[™ÉÎÂˆÛÛœÝÈ\œ›ÜŽˆ[™[™Ñ\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊBˆ\]JÂˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×ÜÝ]\Îˆ	Û›ÝÜÝ\Y	ËˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×Ù\œ›ÜŽˆ[ˆ\]YØ]ˆ™]È]J
KÒTÓÔÝš[™Ê
KˆJBˆ™\J	ÚY	ËØ\ÙT›ÝËšY
NÂˆYˆ
[™[™Ñ\œ›ÜŠH›ÝÈ[™[™Ñ\œ›ÜŽÂˆžHÂˆ]ØZ]]Ú\Ü]UÛÜšÙ›ÝÔÝ]\Ò[”Ø[\Ù›Ü˜ÙJØ\ÙT›ÝËØ[\Ù›Ü˜ÙTÝ]\ÊNÂˆHØ]Ú
\œ›ÜŠHÂˆ]ØZ]™XÛÜ™\Ü]UÛÜšÙ›ÝÔØ[\Ù›Ü˜ÙUÜš]X˜XÚÊÛY[Ø\ÙT›ÝË›Ùš[KØ[\Ù›Ü˜ÙTÝ]\Ë	Ù˜Z[Y	Ë\œ›Ü‹›Y\ÜØYÙJNÂˆ›ÝÈ\œ›ÜŽÂˆBˆÛÛœÝÈ\œ›ÜŽˆ\›Ý˜[\œ›ÜˆHH]ØZ]ÛY[œœÊ	Ø\›Ý™WÙ\Ü]WÝÛÜšÙ›Ý×ØØ\ÙIËÂˆØØ\ÙWÚYˆØ\ÙT›ÝËšYˆØXÝÜŽˆÈYˆ›Ùš[KšY[XZ[ˆ›Ùš[K™[XZ[KˆÛ›ÝNˆ›ÙK››ÝH	Ð\›Ý™YžH\Ü]HYZ[š\Ý˜]Ü‹‰ËˆÜØ[\Ù›Ü˜ÙWÜÝ]\ÎˆØ[\Ù›Ü˜ÙTÝ]\ËˆJNÂˆYˆ
\›Ý˜[\œ›ÜŠH›ÝÈ\›Ý˜[\œ›ÜŽÂˆ]\]YØ\ÙHH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[Ø\ÙT›ÝËšY
NÂˆYˆ
\]YØ\ÙKÛÜšÙ›Ý×ÜÝ]\ÈOOHØ[\Ù›Ü˜ÙTÝ]\ÊHÂˆ\]YØ\ÙHH]ØZ]Üš]Q\Ü]UÛÜšÙ›ÝÔÝ]\ÕÔØ[\Ù›Ü˜ÙJÛY[\]YØ\ÙK›Ùš[K\]YØ\ÙKÛÜšÙ›Ý×ÜÝ]\ÊNÂˆBˆÛÛœÝXØÛÝ[[™ÔÝ]HH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝØÝ[Y[ÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÑØÝ[Y[ÊÛY[Ø\ÙT›ÝËšY
NÂˆ™]\›ˆÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJ\]YØ\ÙJKˆ\Y\Îˆ\T›ÝÜË›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\JKˆXÝ[ÛœÎˆXØÛÝ[[™ÔÝ]K˜XÝ[ÛœËˆÝ\Y\’[œÝXÝ[ÛœÎˆXØÛÝ[[™ÔÝ]KœÝ\Y\’[œÝXÝ[ÛœËˆØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
KˆÜš]X˜XÚÔ™\Ý[Îˆ×KˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]P™]T™Z™XÝ
›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×Ø\›Ý™IË	Ñ\Ü]H\›Ý˜[\›Z\ÜÚ[Ûˆ\È™\]Z\™Y‰ËÊNÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[›ÙK˜Ø\ÙRY›ÙKœÝ[RY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝÝ\œ™[Ý[HH]ØZ]ØYÝ\œ™[\Ü]TÝ[JØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆ\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆYˆ
Ø\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ô[™[™È\›Ý˜[	ÊH›ÝÈ\\œ›ÜŠ	ÓÛ›H[™[™È\Ü]HÛÜšÙ›ÝÈØ\Ù\ÈØ[ˆ™H™Z™XÝYÜˆ™]\›™Y›Üˆ™]š\Ú[Û‹‰Ë
NÂˆÛÛœÝ™]š\Ú[Û”™\]Y\ÝYH›ÛÛX[Š›ÙKœ™]š\Ú[Û”™\]Y\ÝY
NÂˆÛÛœÝ™X\ÛÛˆHÝš[™Ê›ÙKœ™X\ÛÛˆ	ÉÊKš[J
NÂˆYˆ
\™X\ÛÛŠH›ÝÈ\\œ›ÜŠ™]š\Ú[Û”™\]Y\ÝYÈ	Ô™]š\Ú[Ûˆ™X\ÛÛˆ\È™\]Z\™Y‰Èˆ	Ô™Z™XÝ[Ûˆ™X\ÛÛˆ\È™\]Z\™Y‰Ë
NÂˆÛÛœÝØ[\Ù›Ü˜ÙTÝ]\ÈH™]š\Ú[Û”™\]Y\ÝYÈ	Ô™]š\Ú[Ûˆ™\]Y\ÝY	Èˆ	Ô™Z™XÝY	ÎÂˆ]ØZ]]Ú\Ü]UÛÜšÙ›ÝÔÝ]\Ò[”Ø[\Ù›Ü˜ÙJØ\ÙT›ÝËØ[\Ù›Ü˜ÙTÝ]\ÊNÂˆÛÛœÝ›ÝÒ\ÛÈH™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝÈ]Nˆ\]YØ\ÙK\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊBˆ\]JÂˆÛÜšÙ›Ý×ÜÝ]\Îˆ™]š\Ú[Û”™\]Y\ÝYÈ	Ô™]š\Ú[Ûˆ™\]Y\ÝY	Èˆ	Ô™Z™XÝY	Ëˆ\›Ý˜[ÜÝ]\Îˆ™]š\Ú[Û”™\]Y\ÝYÈ	Ô™]š\Ú[Ûˆ™\]Y\ÝY	Èˆ	Ô™Z™XÝY	Ëˆ™Z™XÝYØžNˆ›Ùš[KšYˆ™Z™XÝYØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆ™Z™XÝYØ]ˆ›ÝÒ\ÛËˆ™Z™XÝ[Û—Ü™X\ÛÛŽˆ™X\ÛÛ‹ˆ\]YØ]ˆ›ÝÒ\ÛËˆJBˆ™\J	ÚY	ËØ\ÙT›ÝËšY
BˆœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
BˆœÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[\]YØ\ÙK™]š\Ú[Û”™\]Y\ÝYÈ	Ü™]š\Ú[Û—Ü™\]Y\ÝY	Èˆ	Ü™Z™XÝY	Ë›Ùš[KÂˆ›ÝNˆ™X\ÛÛ‹ˆJNÂˆÛÛœÝÝ]\ÐØ\ÙHH]ØZ]™XÛÜ™\Ü]UÛÜšÙ›ÝÔØ[\Ù›Ü˜ÙUÜš]X˜XÚÊÛY[\]YØ\ÙK›Ùš[KØ[\Ù›Ü˜ÙTÝ]\ÊNÂˆ™]\›ˆÈØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJÝ]\ÐØ\ÙJHNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÑØÝ[Y[Ê›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[›ÙK˜Ø\ÙRY›ÙKœÝ[RY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝØÝ[Y[ÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÑØÝ[Y[ÊÛY[Ø\ÙT›ÝËšY
NÂˆ™]\›ˆÈØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
HNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÕ\ØYØÝ[Y[
›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™\]Z\™Q^\›˜[XÝ[Û‘Ø]J	ÜØ[\Ù›Ü˜ÙWÝÜš]IÊNÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[›ÙK˜Ø\ÙRY›ÙKœÝ[RY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝÝ\œ™[Ý[HH]ØZ]ØYÝ\œ™[\Ü]TÝ[JØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆ\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆÛÛœÝ\T›ÝÜÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÔ\Y\ÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ™YÚ\ÝžHH\ÜÙ\˜[Y\Ü]T\Y\ÊÝ\œ™[Ý[K\T›ÝÜÊNÂˆÛÛœÝÝÜ™YÛÜšÙ›ÝÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆ˜[Y]TÝÜ™Y\Ü]PXÝ[ÛœÊÝÜ™YÛÜšÙ›ÝË˜XÝ[Û”›ÝÜË\T›ÝÜË™YÚ\ÝžJNÂˆYˆ
Ø\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ð\›Ý™Y	ÊHÂˆÛÛœÝ™XÛÛ˜Ú[X][ÛˆH]ØZ]™XÛÛ˜Ú[P\›Ý™YÝ\Y\’[œÝXÝ[ÛœÊÛY[Ø\ÙT›ÝË\T›ÝÜËÝÜ™YÛÜšÙ›ÝË˜XÝ[Û”›ÝÜËÝÜ™YÛÜšÙ›ÝËš[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[K›Ùš[JNÂˆYˆ
™XÛÛ˜Ú[X][Û‹˜Ú[™ÙY
HÂˆ›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ^[Y[ÈÚ[™ÙYˆÓÔÈ\]YHXØÛÝ[[™È[ŽÈ™[Ü[ˆHØÝ[Y[\ØY[™[šÈ]ÈH™]š\ÙY[œÝXÝ[Û‹‰ËJNÂˆBˆH[ÙHÂˆ\ÜÙ\Ý\Y\[ØØ][ÛœÐÝ\œ™[
ÝÜ™YÛÜšÙ›ÝË˜XÝ[Û”›ÝÜË\T›ÝÜËÝÜ™YÛÜšÙ›ÝËš[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[JNÂˆBˆÛÛœÝØ[‘Y]HÉÑ˜Y	Ë	Ô™Z™XÝY	Ë	Ô™]š\Ú[Ûˆ™\]Y\ÝY	×Kš[˜ÛY\ÊØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÊNÂˆÛÛœÝØØ[\›Ý™QØÝ[Y[ËØ[XØÛÝ[ØÝ[Y[×HH]ØZ]›ÛZ\ÙK˜[
Ý\Ù\’\ÐØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×Ø\›Ý™IÊK\Ù\’\ÐØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×ØXØÛÝ[	ÊWJNÂˆYˆ
XØ[‘Y]	‰ˆXØ[\›Ý™QØÝ[Y[È	‰ˆXØ[XØÛÝ[ØÝ[Y[ÊHÂˆ›ÝÈ\\œ›ÜŠ	ÓÛ›HXØÛÝ[[™ÈÜˆYZ[š\Ý˜]ÜœÈØ[ˆYØÝ[Y[ÈY\ˆ˜Y\ˆÝX›Z\ÜÚ[Û‹‰ËÊNÂˆB‚ˆÛÛœÝXÝ[Û’YHÝš[™Ê›ÙK˜XÝ[Û’Y	ÉÊKš[J
H[ÂˆÛÛœÝÝ\Y\’[œÝXÝ[Û’YHÝš[™Ê›ÙKœÝ\Y\’[œÝXÝ[Û’Y	ÉÊKš[J
H[Âˆ]XÝ[ÛˆH[ÂˆYˆ
XÝ[Û’Y
HÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÐ‘UWÐPÕSÓ—ÔÑSPÕ
K™\J	ÚY	ËXÝ[Û’Y
K™\J	ØØ\ÙWÚY	ËØ\ÙT›ÝËšY
K›X^X™TÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆYˆ
Y]JH›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝYÛÜšÙ›ÝÈXÝ[ÛˆØ\È›Ý›Ý[™‰Ë
NÂˆXÝ[ÛˆH]NÂˆBˆ]Ý\Y\’[œÝXÝ[ÛˆH[ÂˆYˆ
Ý\Y\’[œÝXÝ[Û’Y
HÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÜÝ\Y\—Ú[œÝXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÔÕTQT—ÒS”Õ•PÕSÓ—ÔÑSPÕ
K™\J	ÚY	ËÝ\Y\’[œÝXÝ[Û’Y
K™\J	ØØ\ÙWÚY	ËØ\ÙT›ÝËšY
K›X^X™TÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆYˆ
Y]JH›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝYÝ\Y\ˆ[œÝXÝ[ÛˆØ\È›Ý›Ý[™‰Ë
NÂˆÝ\Y\’[œÝXÝ[ÛˆH]NÂˆYˆ
XÝ[Ûˆ	‰ˆÝ\Y\’[œÝXÝ[Û‹˜XÝ[Û—ÚYOOHXÝ[Û‹šY
HÂˆ›ÝÈ\\œ›ÜŠ	ÕHÝ\Y\ˆ[œÝXÝ[ÛˆÙ\È›Ý™[Û™ÈÈHÙ[XÝYXÝ[Û‹‰Ë
NÂˆBˆYˆ
XXÝ[ÛŠHÂˆÛÛœÝÈ]Nˆ[šÙYXÝ[Û‹\œ›ÜŽˆ[šÙYXÝ[Û‘\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÐ‘UWÐPÕSÓ—ÔÑSPÕ
K™\J	ÚY	ËÝ\Y\’[œÝXÝ[Û‹˜XÝ[Û—ÚY
K™\J	ØØ\ÙWÚY	ËØ\ÙT›ÝËšY
K›X^X™TÚ[™ÛJ
NÂˆYˆ
[šÙYXÝ[Û‘\œ›ÜŠH›ÝÈ[šÙYXÝ[Û‘\œ›ÜŽÂˆXÝ[ÛˆH[šÙYXÝ[ÛŽÂˆBˆBˆÛÛœÝ\RYHÝš[™Ê›ÙKœ\RYXÝ[ÛËœ\WÚY	ÉÊKš[J
NÂˆÛÛœÝ\T›ÝÈH\T›ÝÜË™š[™

\JHOˆ\KšYOOH\RY
NÂˆYˆ
\\T›ÝÊH›ÝÈ\\œ›ÜŠ	ÔÙ[XÝHØ]™Y\Ü]YXØÛÝ[™Y›Ü™H\ØY[™ÈHØÝ[Y[‰Ë
NÂˆÛÛœÝ\TÚYHHÝš[™Ê›ÙKœ\TÚYHXÝ[ÛËœ\WÜÚYH	ÉÊBˆš[J
BˆÓÝÙ\Ø\ÙJ
NÂˆYˆ
VÉØ^Y\‰Ë	ÜÝ\Y\‰×Kš[˜ÛY\Ê\TÚYJJH›ÝÈ\\œ›ÜŠ	ÔÙ[XÝH^Y\ˆÜˆÝ\Y\ˆÚYH›Üˆ\ÈØÝ[Y[‰Ë
NÂˆÛÛœÝ\HHš[™\Ü]T\J™YÚ\ÝžK\TÚYK\T›ÝË˜XØÛÝ[ÚY
NÂˆYˆ
\\HJ™YÚ\ÝžKœÙ[XÝY×JKœÛÛYJ
Ù[XÝY
HOˆÙ[XÝY˜XØÛÝ[Ù^HOOH\K˜XØÛÝ[Ù^JJHÂˆ›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝYXØÛÝ[ÚYH\È›ÈÛ™Ù\ˆ˜[Y›Üˆ\ÈÕSK‰Ë
NÂˆBˆYˆ
XÝ[Ûˆ	‰ˆ
XÝ[Û‹œ\WÚYOOH\T›ÝËšYXÝ[Û‹œ\WÜÚYHOOH\TÚYJJHÂˆ›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝYXÝ[ÛˆÙ\È›Ý™[Û™ÈÈ\ÈXØÛÝ[ÚYK‰Ë
NÂˆB‚ˆÛÛœÝØÝ[Y[\HHÝš[™Ê›ÙK™ØÝ[Y[\H	ÉÊKš[J
NÂˆYˆ
QTÔUWÕÓÔ’Ñ“Õ×ÑÐÕSQS•ÕTTËš\ÊØÝ[Y[\JJH›ÝÈ\\œ›ÜŠ	Õ˜[YØÝ[Y[\H\È™\]Z\™Y‰Ë
NÂˆÛÛœÝØÝ[Y[\™XÝ[ÛˆHÝš[™Ê›ÙK™ØÝ[Y[\™XÝ[Ûˆ	ÉÊBˆš[J
BˆÓÝÙ\Ø\ÙJ
NÂˆYˆ
QTÔUWÕÓÔ’Ñ“Õ×ÑÐÕSQS•ÑT‘PÕSÓ”Ëš\ÊØÝ[Y[\™XÝ[ÛŠJH›ÝÈ\\œ›ÜŠ	ÔÙ[XÝH˜[YØÝ[Y[\™XÝ[Û‹‰Ë
NÂˆYˆ
YØÝ[Y[\™XÝ[Û‹™[™ÕÚ]
ÉÜ\TÚY_X
JH›ÝÈ\\œ›ÜŠØÝ[Y[\™XÝ[Ûˆ]\ÝX]ÚH	Ü\TÚY_HÚYK˜
NÂˆÛÛœÝÜšYÚ[˜[š[S˜[YHHÝš[™Ê›ÙK›ÜšYÚ[˜[š[S˜[YH	ÉÊKš[J
NÂˆYˆ
[ÜšYÚ[˜[š[S˜[YJH›ÝÈ\\œ›ÜŠ	ÑØÝ[Y[š[[˜[YH\È™\]Z\™Y‰Ë
NÂˆÛÛœÝ˜]Ð˜\ÙMHÝš[™Ê›ÙK˜˜\ÙM	ÉÊBˆœ™\XÙJ×™]N–×Ž×JÎØ˜\ÙMË	ÉÊBˆœ™\XÙJ×ÊËÙË	ÉÊNÂˆYˆ
\˜]Ð˜\ÙM
H›ÝÈ\\œ›ÜŠ	ÑØÝ[Y[ÛÛ[\È™\]Z\™Y‰Ë
NÂˆÛÛœÝY™™\ˆHY™™\‹™œ›ÛJ˜]Ð˜\ÙM	Ø˜\ÙM	ÊNÂˆYˆ
XY™™\‹›[™Ý
H›ÝÈ\\œ›ÜŠ	ÑØÝ[Y[ÛÛ[\È[\HÜˆ[˜[Y‰Ë
NÂˆYˆ
Y™™\‹›[™ÝˆTÔUWÕÓÔ’Ñ“Õ×ÓPVÑÐÕSQS•Ð–UTÊH›ÝÈ\\œ›ÜŠ	ÑØÝ[Y[\ÈÛÈ\™ÙKˆX^[][HÚ^™H\ÈÈP‹‰ËLÊNÂ‚ˆÛÛœÝ\S˜[YHH\K›˜[YNÂˆÛÛœÝ[šÙY™XÛÜ™YHØ\ÙT›ÝËœÝ[WÚYÂˆÛÛœÝ^[œÚ[ÛˆH\Ü]UÛÜšÙ›ÝÑš[Q^[œÚ[ÛŠÜšYÚ[˜[š[S˜[YJNÂˆYˆ
Y^[œÚ[ÛŠH›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝYØÝ[Y[]\Ý]™HHš[[˜[YH^[œÚ[Û‹‰Ë
NÂˆÛÛœÝ\™XÝ[Û“X™[H\Ü]UÛÜšÙ›ÝÑ\™XÝ[Û“X™[
ØÝ[Y[\™XÝ[ÛŠNÂˆÛÛœÝÝYÙÙ\ÝY˜\ÙS˜[YHH	Ù\Ü]UÛÜšÙ›ÝÒÛ™ÒÛÛ™Ñ]UÚÙ[Š
_H	Ù\™XÝ[Û“X™[XÂˆÛÛœÝ™\]Y\ÝY[œ]HÝš[™Ê›ÙKœ™\]Y\ÝYš[S˜[YH	ÉÊKœ™\XÙJ™]È™YÑ^
‰Ù^[œÚ[ÛŸI	ÚIÊK	ÉÊNÂˆÛÛœÝ™\]Y\ÝY˜\ÙS˜[YHH\Ü]UÛÜšÙ›ÝÑY]X›Qš[[˜[YJ™\]Y\ÝY[œ]ÝYÙÙ\ÝY˜\ÙS˜[YJNÂˆÛÛœÝÛÛ[\HHÝš[™Ê›ÙK˜ÛÛ[\H	Ø\XØ][Û‹ÛØÝ]\Ý™X[IÊKš[J
H	Ø\XØ][Û‹ÛØÝ]\Ý™X[IÎÂˆ]ØÝ[Y[›ÝÈH[Âˆ›Üˆ
]ÝY™š^HÈÝY™š^LÈÝY™š^
ÏHJHÂˆÛÛœÝÛX\š[S˜[YHH	Ü™\]Y\ÝY˜\ÙS˜[Y_IÜÝY™š^ÈIÜÝY™š^Xˆ	ÉßK‰Ù^[œÚ[ÛŸXÂˆÛÛœÝÈ]K\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÙØÝ[Y[ÉÊBˆš[œÙ\
ÂˆØ\ÙWÚYˆØ\ÙT›ÝËšYˆXÝ[Û—ÚYˆXÝ[ÛËšYXÝ[Û’YˆÝ\Y\—Ú[œÝXÝ[Û—ÚYˆÝ\Y\’[œÝXÝ[Û’Yˆ\WÚYˆ\T›ÝËšYˆ\WÜÚYNˆ\TÚYKˆÝ[WÚYˆØ\ÙT›ÝËœÝ[WÚYˆ\WÛ˜[YNˆ\S˜[YKˆ\WØXØÛÝ[ÚYˆ\K˜XØÛÝ[YˆØÝ[Y[Ù\™XÝ[ÛŽˆØÝ[Y[\™XÝ[Û‹ˆØÝ[Y[Ý\NˆØÝ[Y[\KˆÜšYÚ[˜[Ùš[[˜[YNˆÜšYÚ[˜[š[S˜[YKˆ™\]Y\ÝYÙš[[˜[YNˆ	Ü™\]Y\ÝY˜\ÙS˜[Y_K‰Ù^[œÚ[ÛŸXˆÛX\Ùš[[˜[YNˆÛX\š[S˜[YKˆ\ØYÜÝ]\Îˆ	Ü[™[™ÉËˆÛÛ[Ý\NˆÛÛ[\Kˆš[WÙ^[œÚ[ÛŽˆ^[œÚ[Û‹ˆÛÛ[ÜÚ^™NˆY™™\‹›[™ÝˆØ[\Ù›Ü˜ÙWØÛÛ[Ý™\œÚ[Û—ÚYˆ[ˆØ[\Ù›Ü˜ÙWÛ[šÙYÜ™XÛÜ™ÚYˆ[šÙY™XÛÜ™Yˆ\ØYYØžNˆ›Ùš[KšYˆ\ØYYØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆJBˆœÙ[XÝ
TÔUWÕÓÔ’Ñ“Õ×ÑÐÕSQS•ÔÑSPÕ
BˆœÚ[™ÛJ
NÂˆYˆ
Y\œ›ÜŠHÂˆØÝ[Y[›ÝÈH]NÂˆœ™XZÎÂˆBˆYˆ
\œ›Ü‹˜ÛÙHOOH	ÌŒÍLIÊH›ÝÈ\œ›ÜŽÂˆBˆYˆ
YØÝ[Y[›ÝÊH›ÝÈ\\œ›ÜŠ	ÐH[š\]YHØÝ[Y[š[[˜[YHÛÝ[›Ý™H™\Ù\™Y‰ËJNÂ‚ˆÛÛœÝÛX\š[S˜[YHHØÝ[Y[›ÝËœÛX\Ùš[[˜[YNÂˆÛÛœÝ]HHÛX\š[S˜[YKœÛXÙJJ^[œÚ[Û‹›[™Ý
ÈJJNÂˆ]ÛÛ[™\œÚ[Û’YH[Âˆ]ÛÛ[ØÝ[Y[YH[Â‚ˆžHÂˆÛÛœÝÛÛ[™\œÚ[ÛˆH]ØZ]Ù”™\]Y\Ý
	ËÜÛØš™XÝËÐÛÛ[™\œÚ[Û‰ËÂˆY]Ùˆ	ÔÔÕ	Ëˆ›ÙNˆÂˆ]Nˆ]Kˆ]ÛÛY[ˆÉÜÛX\š[S˜[Y_Xˆ™\œÚ[Û‘]NˆY™™\‹ÔÝš[™Ê	Ø˜\ÙM	ÊKˆš\œÝX›\ÚØØ][Û’Yˆ[šÙY™XÛÜ™YˆKˆJNÂˆÛÛ[™\œÚ[Û’YHÛÛ[™\œÚ[ÛËšYÂˆYˆ
Z\ÔØ[\Ù›Ü˜ÙRY
ÛÛ[™\œÚ[Û’Y
JH›ÝÈ\\œ›ÜŠ	ÔØ[\Ù›Ü˜ÙHY›Ý™]\›ˆHÛÛ[™\œÚ[ÛˆY‰ËLŠNÂˆÛÛœÝ™\œÚ[Û”›ÝÜÈH]ØZ]]Y\žT›ÝÜÊÑSPÕYÛÛ[ØÝ[Y[Y”“ÓHÛÛ[™\œÚ[ÛˆÒT‘HYH	ÉÙ\ØØ\TÛÜ[
ÛÛ[™\œÚ[Û’Y
_IÈSRUXÈÛÙ˜Z[ˆYHJNÂˆÛÛ[ØÝ[Y[YH™\œÚ[Û”›ÝÜÖÌOËÛÛ[ØÝ[Y[Y[ÂˆYˆ
Z\ÔØ[\Ù›Ü˜ÙRY
ÛÛ[ØÝ[Y[Y
JH›ÝÈ\\œ›ÜŠ	ÔØ[\Ù›Ü˜ÙHY›Ý™]\›ˆHÛÛ[ØÝ[Y[Y‰ËLŠNÂˆÛÛœÝØ[\Ù›Ü˜ÙU\›H	ÙÙ][œÝ[˜ÙU\›

_KÛYÚš[™ËÜ‹ÐÛÛ[ØÝ[Y[ÉØÛÛ[ØÝ[Y[YKÝšY]ØÂˆÛÛœÝÈ]NˆÛÛ\]YØÝ[Y[\œ›ÜŽˆØÝ[Y[\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÙØÝ[Y[ÉÊBˆ\]JÂˆ\ØYÜÝ]\Îˆ	ØÛÛ\]IËˆØ[\Ù›Ü˜ÙWØÛÛ[Ý™\œÚ[Û—ÚYˆÛÛ[™\œÚ[Û’YˆØ[\Ù›Ü˜ÙWØÛÛ[ÙØÝ[Y[ÚYˆÛÛ[ØÝ[Y[YˆØ[\Ù›Ü˜ÙWÝ\›ˆØ[\Ù›Ü˜ÙU\›ˆJBˆ™\J	ÚY	ËØÝ[Y[›ÝËšY
Bˆ™\J	Ý\ØYÜÝ]\ÉË	Ü[™[™ÉÊBˆœÙ[XÝ
TÔUWÕÓÔ’Ñ“Õ×ÑÐÕSQS•ÔÑSPÕ
BˆœÚ[™ÛJ
NÂˆYˆ
ØÝ[Y[\œ›ÜŠH›ÝÈØÝ[Y[\œ›ÜŽÂˆØÝ[Y[›ÝÈHÛÛ\]YØÝ[Y[ÂˆHØ]Ú
\œ›ÜŠHÂˆYˆ
ÛÛ[ØÝ[Y[Y
H]ØZ]Ù”™\]Y\Ý
ÜÛØš™XÝËÐÛÛ[ØÝ[Y[ÉÙ[˜ÛÙUT’PÛÛ\Û™[
ÛÛ[ØÝ[Y[Y
_XÈY]Ùˆ	ÑSUIÈJK˜Ø]Ú


HOˆ[
NÂˆ[ÙHYˆ
ÛÛ[™\œÚ[Û’Y
H]ØZ]Ù”™\]Y\Ý
ÜÛØš™XÝËÐÛÛ[™\œÚ[Û‹ÉÙ[˜ÛÙUT’PÛÛ\Û™[
ÛÛ[™\œÚ[Û’Y
_XÈY]Ùˆ	ÑSUIÈJK˜Ø]Ú


HOˆ[
NÂˆ]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÙØÝ[Y[ÉÊK™[]J
K™\J	ÚY	ËØÝ[Y[›ÝËšY
NÂˆ›ÝÈ\œ›ÜŽÂˆBˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[Ø\ÙT›ÝË	ÙØÝ[Y[Ý\ØYY	Ë›Ùš[KÂˆXÝ[Û’Yˆ›ÝNˆ	ÜÛX\š[S˜[Y_H\ØYYÈØ[\Ù›Ü˜ÙK˜ˆY]Y]NˆÂˆØÝ[Y[YˆØÝ[Y[›ÝËšYˆØÝ[Y[\KˆØÝ[Y[\™XÝ[Û‹ˆ\TÚYKˆ\S˜[YKˆ\PXØÛÝ[Yˆ\K˜XØÛÝ[YˆÝ\Y\’[œÝXÝ[Û’YˆÛÛ[™\œÚ[Û’YˆØÝ[Y[›ÝËœØ[\Ù›Ü˜ÙWØÛÛ[Ý™\œÚ[Û—ÚYˆ[šÙY™XÛÜ™YÎˆÛ[šÙY™XÛÜ™YKˆKˆJNÂˆ™]\›ˆÈØÝ[Y[ˆÙ\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
ØÝ[Y[›ÝÊHNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÝ\Y\“Ù™œÙ][›ÚXÙSÜ[ÛœÊÈÝ\Y\XØÛÝ[YÝ\œ™[˜ÞR\ÛÐÛÙK^ÛYR[›ÚXÙRYÈH×KXØÙ\ÜÐÛÛ^H[HHßJHÂˆYˆ
Z\ÔØ[\Ù›Ü˜ÙRY
Ý\Y\XØÛÝ[Y
JH›ÝÈ\\œ›ÜŠ	Õ˜[YÝ\Y\ˆXØÛÝ[\È™\]Z\™Y‰Ë
NÂˆÛÛœÝÚ[›ÚXÙQ\ØÜšX™K^[Y[\ØÜšX™WHH]ØZ]›ÛZ\ÙK˜[
ÂˆØ[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	ÔÝ\Y\—Ò[›ÚXÙW×ØÉÈJKˆØ[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	Ô^[Y[×ØÉÈJK˜Ø]Ú


HOˆ
ÂˆšY[Îˆ×KˆJJKˆJNÂˆÛÛœÝ[›ÚXÙQšY[ÈH[›ÚXÙQ\ØÜšX™K™šY[È×NÂˆÛÛœÝ[›ÚXÙQšY[˜[Y\ÈH™]ÈÙ]
[›ÚXÙQšY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝ[›ÚXÙQšY[žS˜[YHHØš™XÝ™œ›ÛQ[šY\Ê[›ÚXÙQšY[Ë›X\

šY[
HOˆÙšY[›˜[YKšY[JJNÂˆÛÛœÝØÚ[XHH™\ÛÛ™TÝ\Y\”Ù][Y[ØÚ[XJÂˆÝ\Y\’[›ÚXÙQšY[Îˆ[›ÚXÙQšY[Ëˆ^[Y[šY[Îˆ^[Y[\ØÜšX™K™šY[È×KˆJNÂˆYˆ
\ØÚ[XK˜[Y
HÂˆ›ÝÈ\\œ›ÜŠÝ\Y\ˆÙ™œÙ]Ü[ÛœÈ\™H[˜]˜Z[X›Nˆ	ÜØÚ[XKš\ÜÝY\Ëš›Ú[Š	È	Ê_XJNÂˆBˆÛÛœÝ™[][ÛœÚ\ÈHØÚ[XKœÝ\Y\XØÛÝ[šY[Ë›X\

šY[
HOˆ[›ÚXÙQšY[žS˜[YVÙšY[OËœ™[][ÛœÚ\˜[YJK™š[\Š›ÛÛX[ŠNÂˆÛÛœÝÙ[XÝšY[ÈHÉÒY	Ë	Ó˜[YIË	ÐÜ™X]Y]IË[›ÚXÙQšY[˜[Y\Ëš\Ê	ÔÕSW×ØÉÊHÈ	ÔÕSW×ØÉÈˆ[[›ÚXÙQšY[˜[Y\Ëš\Ê	ÐÝ\œ™[˜ÞR\ÛÐÛÙIÊHÈ	ÐÝ\œ™[˜ÞR\ÛÐÛÙIÈˆ[ØÚ[XKš[›ÚXÙP[[Ý[šY[ØÚ[XKš[›ÚXÙT^XX›QšY[‹‹œØÚ[XKš[›ÚXÙQYQ]QšY[Ë‹‹œØÚ[XKš[›ÚXÙQ]QšY[Ë‹‹œØÚ[XKš[›ÚXÙTÝ]\ÑšY[Ë‹‹œØÚ[XKœÝ\Y\XØÛÝ[šY[Ë‹‹œ™[][ÛœÚ\Ë›X\

™[][ÛœÚ\
HOˆ	Ü™[][ÛœÚ\K“˜[YX
WK™š[\Š›ÛÛX[ŠNÂˆÛÛœÝXØÛÝ[ÛÛ™][ÛˆHØÚ[XKœÝ\Y\XØÛÝ[šY[Ë›X\

šY[
HOˆ	ÙšY[HH	ÉÙ\ØØ\TÛÜ[
Ý\Y\XØÛÝ[Y
_IØ
Kš›Ú[Š	ÈÔˆ	ÊNÂˆÛÛœÝ›ÝÜÈH]ØZ]]Y\žT›ÝÜÊˆˆÑSPÕ	ÖË‹‹›™]ÈÙ]
Ù[XÝšY[ÊWKš›Ú[Š	Ë	Ê_Bˆ”“ÓHÝ\Y\—Ò[›ÚXÙW×ØÂˆÒT‘H
	ØXØÛÝ[ÛÛ™][ÛŸJBˆÔ‘Tˆ–HÜ™X]Y]HTÐÂˆSRUŒˆˆÈ[Z]ˆŒÛÙ˜Z[ˆYHKˆ
NÂˆÛÛœÝ^ÛYYH™]ÈÙ]
^ÛYR[›ÚXÙRYË›X\

Y
HOˆÝš[™ÊY
KœÛXÙJMJJJNÂˆÛÛœÝÜ[ÛœÈH×NÂˆ›Üˆ
ÛÛœÝ[›ÚXÙHÙˆ›ÝÜÊHÂˆYˆ
^ÛYYš\ÊÝš[™Ê[›ÚXÙK’Y	ÉÊKœÛXÙJMJJJHÛÛ[YNÂˆYˆ
[›ÚXÙK”ÕSW×ØÊHÂˆÛÛœÝ[ÝÙYH]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊ[›ÚXÙK”ÕSW×ØËXØÙ\ÜÐÛÛ^
Bˆ[Š

HOˆYJBˆ˜Ø]Ú


HOˆ˜[ÙJNÂˆYˆ
X[ÝÙY
HÛÛ[YNÂˆBˆÛÛœÝÝ\Y\‘šY[HØÚ[XKœÝ\Y\XØÛÝ[šY[Ë™š[™

šY[
HOˆ[›ÚXÙVÙšY[JNÂˆYˆ
\Ü]TØ[\Ù›Ü˜ÙRYÙ^J[›ÚXÙVÜÝ\Y\‘šY[JHOOH\Ü]TØ[\Ù›Ü˜ÙRYÙ^JÝ\Y\XØÛÝ[Y
JHÛÛ[YNÂˆÛÛœÝYQ]HHØÚ[XKš[›ÚXÙQYQ]QšY[Ë›X\

šY[
HOˆ[›ÚXÙVÙšY[JK™š[™
›ÛÛX[ŠH[ÂˆÛÛœÝ[›ÚXÙQ]HHØÚ[XKš[›ÚXÙQ]QšY[Ë›X\

šY[
HOˆ[›ÚXÙVÙšY[JK™š[™
›ÛÛX[ŠH[›ÚXÙKÜ™X]Y]H[ÂˆÛÛœÝÝ]\ÈHØÚ[XKš[›ÚXÙTÝ]\ÑšY[Ë›X\

šY[
HOˆ[›ÚXÙVÙšY[JK™š[™
›ÛÛX[ŠH[ÂˆÛÛœÝÝ]\ÕÚÙ[ˆHÝš[™ÊÝ]\È	ÉÊBˆÓÝÙ\Ø\ÙJ
Bˆœ™\XÙJÖ×˜K^ŒNWJËÙË	ÉÊNÂˆYˆ
ÉØÛÜÙY	Ë	ÜZY	Ë	ØØ[˜Ù[Y	Ë	ØØ[˜Ù[Y	Ë	Ý›ÚY	Ë	Ü™Z™XÝY	×KœÛÛYJ
ÚÙ[ŠHOˆÝ]\ÕÚÙ[‹š[˜ÛY\ÊÚÙ[ŠJJHÛÛ[YNÂˆÛÛœÝ^ÜÝ\™HH›Ü›X[^™TÝ\Y\’[›ÚXÙQ^ÜÝ\™JÂˆÝ\Y\’[›ÚXÙRYˆ[›ÚXÙK’Yˆ[›ÚXÙS˜[YNˆ[›ÚXÙK“˜[YKˆÛÝ\˜ÙTÝ[RYˆ[›ÚXÙK”ÕSW×ØËˆÝ\Y\XØÛÝ[Yˆ[›ÚXÙVÜÝ\Y\‘šY[KˆÝ\Y\“˜[YNˆ™[][ÛœÚ\Ë›X\

™[][ÛœÚ\
HOˆ[›ÚXÙVÜ™[][ÛœÚ\OË“˜[YJK™š[™
›ÛÛX[ŠH	ÉËˆÝ\œ™[˜ÞR\ÛÐÛÙNˆ[›ÚXÙKÝ\œ™[˜ÞR\ÛÐÛÙH	ÕTÑ	ËˆYQ]Kˆ[›ÚXÙQ]KˆÜ™X]Y]Nˆ[›ÚXÙKÜ™X]Y]Kˆ[›ÚXÙP[[Ý[ˆ[›ÚXÙVÜØÚ[XKš[›ÚXÙP[[Ý[šY[Kˆ^XX›P˜[[˜ÙNˆ[›ÚXÙVÜØÚ[XKš[›ÚXÙT^XX›QšY[KˆÝ]\ËˆJNÂˆYˆ
^ÜÝ\™Kœ^XX›P˜[[˜ÙHHŒH^ÜÝ\™K˜Ý\œ™[˜ÞR\ÛÐÛÙHOOHÝ\œ™[˜ÞR\ÛÐÛÙJHÛÛ[YNÂˆÜ[ÛœËœ\Ú
ÂˆÝ\Y\’[›ÚXÙRYˆ^ÜÝ\™KœÝ\Y\’[›ÚXÙRYˆ[›ÚXÙS˜[YNˆ^ÜÝ\™Kš[›ÚXÙS˜[YKˆÝ[RYˆ[›ÚXÙK”ÕSW×ØÈ[ˆÝ\œ™[˜ÞR\ÛÐÛÙNˆ^ÜÝ\™K˜Ý\œ™[˜ÞR\ÛÐÛÙKˆ[›ÚXÙP[[Ý[ˆ^ÜÝ\™Kš[›ÚXÙP[[Ý[ˆ^XX›P˜[[˜ÙNˆ^ÜÝ\™Kœ^XX›P˜[[˜ÙKˆYQ]Nˆ^ÜÝ\™K™YQ]Kˆ[›ÚXÙQ]Nˆ^ÜÝ\™Kš[›ÚXÙQ]KˆÝ]\ËˆJNÂˆBˆ™]\›ˆÜ[ÛœÎÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÔÝ\Y\“Ù™œÙ]Ü[ÛœÊ›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×ØXØÛÝ[	Ë	Ñ\Ü]HXØÛÝ[[™È\›Z\ÜÚ[Ûˆ\È™\]Z\™Y›ÜˆÝ\Y\ˆÙ™œÙ]Ü[ÛœË‰ÊNÂˆÛÛœÝ[œÝXÝ[Û’YHÝš[™Ê›ÙKš[œÝXÝ[Û’Y	ÉÊKš[J
NÂˆÛÛœÝÈ]Nˆ[œÝXÝ[Û‹\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÜÝ\Y\—Ú[œÝXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÔÕTQT—ÒS”Õ•PÕSÓ—ÔÑSPÕ
K™\J	ÚY	Ë[œÝXÝ[Û’Y
K›X^X™TÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆYˆ
Z[œÝXÝ[ÛŠH›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ[œÝXÝ[Ûˆ›Ý›Ý[™‰Ë
NÂˆYˆ
[œÝXÝ[Û‹š[œÝXÝ[Û—Ý\HOOH	ÙÙ]Ø˜XÚ×ÜZY	ÊH›ÝÈ\\œ›ÜŠ	ÓÛ›HÙ]˜XÚÈZY[[Ý[[œÝXÝ[ÛœÈØ[ˆ\ÙH[ˆÙ™œÙ][›ÚXÙK‰Ë
NÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[[œÝXÝ[Û‹˜Ø\ÙWÚY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝ\T›ÝÜÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÔ\Y\ÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ\HH\T›ÝÜË™š[™

›ÝÊHOˆ›ÝËšYOOH[œÝXÝ[Û‹œ\WÚY
NÂˆYˆ
\\JH›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ[œÝXÝ[Ûˆ\È›ÈÙ[XÝYXØÛÝ[‰Ë
NÂˆÛÛœÝÜ[ÛœÈH]ØZ]Ý\Y\“Ù™œÙ][›ÚXÙSÜ[ÛœÊÂˆÝ\Y\XØÛÝ[Yˆ\K˜XØÛÝ[ÚYˆÝ\œ™[˜ÞR\ÛÐÛÙNˆ[œÝXÝ[Û‹˜Ý\œ™[˜ÞWÚ\Û×ØÛÙKˆ^ÛYR[›ÚXÙRYÎˆÚ[œÝXÝ[Û‹œÛÝ\˜ÙWÜÝ\Y\—Ú[›ÚXÙWÚYKˆXØÙ\ÜÐÛÛ^ˆXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HKˆJNÂˆÛÛœÝÈ]Nˆ™\Ù\˜][ÛœË\œ›ÜŽˆ™\Ù\˜][Û‘\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÜÝ\Y\—Ú[œÝXÝ[ÛœÉÊKœÙ[XÝ
	ÚY\™Ù]ÜÝ\Y\—Ú[›ÚXÙWÚY[›™YØ[[Ý[Ý]\Ë™XÛÝ™\žWÛY]Ù	ÊK™\J	Ü™XÛÝ™\žWÛY]Ù	Ë	Ù]\™WÚ[›ÚXÙWÛÙ™œÙ]	ÊK››Ý
	Ý\™Ù]ÜÝ\Y\—Ú[›ÚXÙWÚY	Ë	Ú\ÉË[
NÂˆYˆ
™\Ù\˜][Û‘\œ›ÜŠH›ÝÈ™\Ù\˜][Û‘\œ›ÜŽÂˆÛÛœÝ™\Ù\™YžR[›ÚXÙHH™]ÈX\

NÂˆ›Üˆ
ÛÛœÝ™\Ù\˜][ÛˆÙˆ™\Ù\˜][ÛœÈ×JHÂˆYˆ
™\Ù\˜][Û‹šYOOH[œÝXÝ[Û‹šYÉÓ›Ý™\]Z\™Y	Ë	ÔÝ\\œÙYY	×Kš[˜ÛY\Ê™\Ù\˜][Û‹œÝ]\ÊJHÛÛ[YNÂˆÛÛœÝÙ^HHÝš[™Ê™\Ù\˜][Û‹\™Ù]ÜÝ\Y\—Ú[›ÚXÙWÚY	ÉÊKœÛXÙJMJNÂˆ™\Ù\™YžR[›ÚXÙKœÙ]
Ù^K[X™\Š™\Ù\™YžR[›ÚXÙK™Ù]
Ù^JH
H
È[X™\Š™\Ù\˜][Û‹œ[›™YØ[[Ý[
JNÂˆBˆÛÛœÝ]˜Z[X›SÜ[ÛœÈHÜ[ÛœÂˆ›X\

Ü[ÛŠHOˆÂˆÛÛœÝ™\Ù\™Y[[Ý[H[X™\Š™\Ù\™YžR[›ÚXÙK™Ù]
Ýš[™ÊÜ[Û‹œÝ\Y\’[›ÚXÙRY	ÉÊKœÛXÙJMJJH
NÂˆ™]\›ˆÂˆ‹‹›Ü[Û‹ˆ™\Ù\™Y[[Ý[ˆ[œ™\Ù\™Y^XX›P˜[[˜ÙNˆX]›X^
[X™\ŠÜ[Û‹œ^XX›P˜[[˜ÙH
HH™\Ù\™Y[[Ý[
KˆNÂˆJBˆ™š[\Š
Ü[ÛŠHOˆÜ[Û‹[œ™\Ù\™Y^XX›P˜[[˜ÙH
ÈŒHH[X™\Š[œÝXÝ[Û‹œ[›™YØ[[Ý[
JNÂˆ™]\›ˆÈÜ[ÛœÎˆ]˜Z[X›SÜ[ÛœÈNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÔÝ\Y\’[œÝXÝ[Û•\]J›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×ØXØÛÝ[	Ë	Ñ\Ü]HXØÛÝ[[™È\›Z\ÜÚ[Ûˆ\È™\]Z\™Y›ÜˆÝ\Y\ˆ[œÝXÝ[ÛœË‰ÊNÂˆÛÛœÝ[œÝXÝ[Û’YHÝš[™Ê›ÙKš[œÝXÝ[Û’Y	ÉÊKš[J
NÂˆYˆ
Z[œÝXÝ[Û’Y
H›ÝÈ\\œ›ÜŠ	Ú[œÝXÝ[Û’Y\È™\]Z\™Y‰Ë
NÂˆÛÛœÝÈ]NˆÜšYÚ[˜[[œÝXÝ[Û‹\œ›ÜŽˆÛÚÝ\\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WÝÛÜšÙ›Ý×ÜÝ\Y\—Ú[œÝXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÔÕTQT—ÒS”Õ•PÕSÓ—ÔÑSPÕ
K™\J	ÚY	Ë[œÝXÝ[Û’Y
K›X^X™TÚ[™ÛJ
NÂˆYˆ
ÛÚÝ\\œ›ÜŠH›ÝÈÛÚÝ\\œ›ÜŽÂˆYˆ
[ÜšYÚ[˜[[œÝXÝ[ÛŠH›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ[œÝXÝ[Ûˆ›Ý›Ý[™‰Ë
NÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[ÜšYÚ[˜[[œÝXÝ[Û‹˜Ø\ÙWÚY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝÝ\œ™[Ý[HH]ØZ]ØYÝ\œ™[\Ü]TÝ[JØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆYˆ
Z\Õ[˜XØÙ\Y^\›˜[\Ü]PÛÜÝ\™JØ\ÙT›ÝËÝ\œ™[Ý[JJH\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆ]ÛÜšÙ›ÝÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ™YÚ\ÝžHH\ÜÙ\˜[Y\Ü]T\Y\ÊÝ\œ™[Ý[KÛÜšÙ›ÝËœ\T›ÝÜÊNÂˆ˜[Y]TÝÜ™Y\Ü]PXÝ[ÛœÊÛÜšÙ›ÝË˜XÝ[Û”›ÝÜËÛÜšÙ›ÝËœ\T›ÝÜË™YÚ\ÝžJNÂˆ\ÜÙ\Ý\Y\‘\Ü]P[[Ý[ÊÛÜšÙ›ÝË˜XÝ[Û”›ÝÜÊNÂˆÛÛœÝ™XÛÛ˜Ú[X][ÛˆH]ØZ]™XÛÛ˜Ú[P\›Ý™YÝ\Y\’[œÝXÝ[ÛœÊÛY[Ø\ÙT›ÝËÛÜšÙ›ÝËœ\T›ÝÜËÛÜšÙ›ÝË˜XÝ[Û”›ÝÜËÛÜšÙ›ÝËš[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[K›Ùš[JNÂˆYˆ
™XÛÛ˜Ú[X][Û‹˜Ú[™ÙY
HÛÜšÙ›ÝÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ[œÝXÝ[ÛˆHÛÜšÙ›ÝËš[œÝXÝ[Û”›ÝÜË™š[™

›ÝÊHOˆ›ÝËšYOOH[œÝXÝ[Û’Y
NÂˆYˆ
Z[œÝXÝ[Ûˆ[œÝXÝ[Û‹œÝ]\ÈOOH	ÔÝ\\œÙYY	ÊHÂˆ›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ^[Y[]HÚ[™ÙY[™\È[œÝXÝ[ÛˆØ\È™\XÙYˆ™]šY]ÈH\]YXØÛÝ[[™È[‹‰ËJNÂˆBˆÛÛœÝ™\]Y\ÝY™]š\Ú[ÛˆH[X™\Š›ÙKœ™]š\Ú[ÛŠNÂˆYˆ
[X™\‹š\Ò[YÙ\Š™\]Y\ÝY™]š\Ú[ÛŠH	‰ˆ™\]Y\ÝY™]š\Ú[ÛˆOOH[X™\Š[œÝXÝ[Û‹œ™]š\Ú[ÛˆJJHÂˆ›ÝÈ\\œ›ÜŠ	Õ\ÈÝ\Y\ˆ[œÝXÝ[ÛˆÚ[™ÙYY\ˆ]Ø\ÈÜ[™Yˆ™Yœ™\Ú[™™]šY]ÈH]\Ý˜[Y\Ë‰ËJNÂˆBˆÛÛœÝÝ]\ÈHÝš[™Ê›ÙKœÝ]\È	ÉÊKš[J
NÂˆYˆ
QTÔUWÔÕTQT—ÒS”Õ•PÕSÓ—ÔÕUTÑTËš\ÊÝ]\ÊHÝ]\ÈOOH	ÔÝ\\œÙYY	ÊHÂˆ›ÝÈ\\œ›ÜŠ	Õ˜[YÝ\Y\ˆ[œÝXÝ[ÛˆÝ]\È\È™\]Z\™Y‰Ë
NÂˆBˆYˆ
Ø\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ð\›Ý™Y	ÊHÂˆYˆ
[œÝXÝ[Û‹š[œÝXÝ[Û—Ý\HOOH	ÝÚ]ÛÝ[œZY	ÈÝ]\ÈOOH	ÒÛXÚÛ›ÝÛYÙY	ÊHÂˆ›ÝÈ\\œ›ÜŠ	Ð™Y›Ü™H\›Ý˜[š[˜[˜ÙHØ[ˆÛ›HXÚÛ›ÝÛYÙH[ˆ[[YYX]HÈ›Ý^H[œÝXÝ[Û‹‰Ë
NÂˆBˆBˆÛÛœÝ[œÝXÝ[Û”™Y™\™[˜ÙHHÝš[™Ê›ÙKš[œÝXÝ[Û”™Y™\™[˜ÙH	ÉÊKš[J
NÂˆÛÛœÝ[œÝXÝ[Û‘]HHÝš[™Ê›ÙKš[œÝXÝ[Û‘]H	ÉÊKš[J
H[ÂˆÛÛœÝÙ][Y[™Y™\™[˜ÙHHÝš[™Ê›ÙKœÙ][Y[™Y™\™[˜ÙH	ÉÊKš[J
NÂˆÛÛœÝÙ][Y[]HHÝš[™Ê›ÙKœÙ][Y[]H	ÉÊKš[J
H[ÂˆÛÛœÝXØÛÝ[[™Ó›ÝHHÝš[™Ê›ÙK˜XØÛÝ[[™Ó›ÝH	ÉÊKš[J
NÂˆYˆ
[œÝXÝ[Û‘]H	‰ˆK×—ÍKWÌŸKWÌŸIË\Ý
[œÝXÝ[Û‘]JJH›ÝÈ\\œ›ÜŠ	Ò[œÝXÝ[Ûˆ]H\È[˜[Y‰Ë
NÂˆYˆ
Ù][Y[]H	‰ˆK×—ÍKWÌŸKWÌŸIË\Ý
Ù][Y[]JJH›ÝÈ\\œ›ÜŠ	ÔÙ][Y[]H\È[˜[Y‰Ë
NÂˆÛÛœÝ™XÛÝ™\žSY]ÙH[œÝXÝ[Û‹š[œÝXÝ[Û—Ý\HOOH	ÙÙ]Ø˜XÚ×ÜZY	ÈÈÝš[™Ê›ÙKœ™XÛÝ™\žSY]Ù[œÝXÝ[Û‹œ™XÛÝ™\žWÛY]Ù	ÉÊKš[J
H[ˆ[ÂˆYˆ
[œÝXÝ[Û‹š[œÝXÝ[Û—Ý\HOOH	ÙÙ]Ø˜XÚ×ÜZY	È	‰ˆÉÒ[œÝXÝ[Ûˆ\ÜÝYY	Ë	ÔÙ]Y	×Kš[˜ÛY\ÊÝ]\ÊH	‰ˆVÉØØ\ÚÜ™Y[™	Ë	Ù]\™WÚ[›ÚXÙWÛÙ™œÙ]	×Kš[˜ÛY\Ê™XÛÝ™\žSY]Ù
JHÂˆ›ÝÈ\\œ›ÜŠ	ÐÚÛÜÙHØ\Ú™Y[™Üˆ]\™H[›ÚXÙHÙ™œÙ]›ÜˆÙ]˜XÚÈZY[[Ý[‰Ë
NÂˆBˆYˆ
Ý]\ÈOOH	Ò[œÝXÝ[Ûˆ\ÜÝYY	È	‰ˆ
Z[œÝXÝ[Û‘]H
Z[œÝXÝ[Û”™Y™\™[˜ÙH	‰ˆXXØÛÝ[[™Ó›ÝJJJHÂˆ›ÝÈ\\œ›ÜŠ	Ò[œÝXÝ[Ûˆ\ÜÝYY™\]Z\™\È[ˆ[œÝXÝ[Ûˆ]H[™H™Y™\™[˜ÙHÜˆXØÛÝ[[™È›ÝK‰Ë
NÂˆBˆYˆ
Ý]\ÈOOH	Ó›Ý™\]Z\™Y	È	‰ˆXXØÛÝ[[™Ó›ÝJH›ÝÈ\\œ›ÜŠ	Ñ^Z[ˆÚH\ÈÝ\Y\ˆ[œÝXÝ[Ûˆ\È›Ý™\]Z\™Y‰Ë
NÂˆÛÛœÝØÝ[Y[ÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÑØÝ[Y[ÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ\Ñ]šY[˜ÙHHØÝ[Y[ËœÛÛYJ
ØÝ[Y[
HOˆØÝ[Y[œÝ\Y\—Ú[œÝXÝ[Û—ÚYOOH[œÝXÝ[Û‹šY	‰ˆÉÜÝ\Y\—ØÜ™Y]Û›ÝIË	ÜÙ][Y[ØYÜ™Y[Y[	Ë	Ü›ÛÙ—ÛÙ—Ü^[Y[	×Kš[˜ÛY\ÊØÝ[Y[™ØÝ[Y[Ý\JJNÂˆYˆ
Ý]\ÈOOH	ÔÙ]Y	È	‰ˆ
\Ù][Y[]H
\Ù][Y[™Y™\™[˜ÙH	‰ˆZ\Ñ]šY[˜ÙJJJHÂˆ›ÝÈ\\œ›ÜŠ	ÔÙ]Y™\]Z\™\ÈHÙ][Y[]H[™Z]\ˆ[ˆ\ØYYÝ\Y\ˆØÝ[Y[ÜˆHš[˜[˜ÙH™Y™\™[˜ÙK‰Ë
NÂˆBˆÛÛœÝ[›™Y[[Ý[H[X™\Š[œÝXÝ[Û‹œ[›™YØ[[Ý[
NÂˆÛÛœÝÙ][Y[[[Ý[HXÚ[X[Ü“[
›ÙKœÙ][Y[[[Ý[
HÏÈ
Ý]\ÈOOH	ÔÙ]Y	ÈÈ[›™Y[[Ý[ˆ[
NÂˆYˆ
Ý]\ÈOOH	ÔÙ]Y	È	‰ˆX]˜XœÊ[X™\ŠÙ][Y[[[Ý[
HH[›™Y[[Ý[
HˆŒJHÂˆ›ÝÈ\\œ›ÜŠ	ÔÙ][Y[[[Ý[]\Ý\]X[HÝ\œ™[Ý\Y\ˆ[œÝXÝ[Ûˆ[[Ý[‰Ë
NÂˆB‚ˆÛÛœÝ\HHÛÜšÙ›ÝËœ\T›ÝÜË™š[™

›ÝÊHOˆ›ÝËšYOOH[œÝXÝ[Û‹œ\WÚY
NÂˆ]\™Ù][›ÚXÙHH[ÂˆYˆ
™XÛÝ™\žSY]ÙOOH	Ù]\™WÚ[›ÚXÙWÛÙ™œÙ]	ÊHÂˆÛÛœÝ\™Ù]Ý\Y\’[›ÚXÙRYHÝš[™Ê›ÙK\™Ù]Ý\Y\’[›ÚXÙRY	ÉÊKš[J
NÂˆYˆ
]\™Ù]Ý\Y\’[›ÚXÙRY
H›ÝÈ\\œ›ÜŠ	ÔÙ[XÝHÝ\Y\ˆ[›ÚXÙH]Ú[™XÙZ]™HHÙ™œÙ]‰Ë
NÂˆÛÛœÝÜ[ÛœÈH]ØZ]Ý\Y\“Ù™œÙ][›ÚXÙSÜ[ÛœÊÂˆÝ\Y\XØÛÝ[Yˆ\OË˜XØÛÝ[ÚYˆÝ\œ™[˜ÞR\ÛÐÛÙNˆ[œÝXÝ[Û‹˜Ý\œ™[˜ÞWÚ\Û×ØÛÙKˆ^ÛYR[›ÚXÙRYÎˆÚ[œÝXÝ[Û‹œÛÝ\˜ÙWÜÝ\Y\—Ú[›ÚXÙWÚYKˆXØÙ\ÜÐÛÛ^ˆXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HKˆJNÂˆ\™Ù][›ÚXÙHHÜ[ÛœË™š[™

Ü[ÛŠHOˆÝš[™ÊÜ[Û‹œÝ\Y\’[›ÚXÙRY
KœÛXÙJMJHOOHÝš[™Ê\™Ù]Ý\Y\’[›ÚXÙRY
KœÛXÙJMJJNÂˆYˆ
]\™Ù][›ÚXÙJH›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝYÙ™œÙ][›ÚXÙH\È›ÈÛ™Ù\ˆ[YÚX›H›Üˆ\ÈÝ\Y\ˆXØÛÝ[[™Ý\œ™[˜ÞK‰ËJNÂˆYˆ
\™Ù][›ÚXÙKœ^XX›P˜[[˜ÙH
ÈŒH[›™Y[[Ý[
H›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝYÙ™œÙ][›ÚXÙHÙ\È›Ý]™H[›ÝYÚ^XX›H˜[[˜ÙK‰Ë
NÂˆBˆ]X]ÚY^[Y[YH[Âˆ]X]ÚY^[Y[H[ÂˆYˆ
™XÛÝ™\žSY]ÙOOH	ØØ\ÚÜ™Y[™	È	‰ˆ›ÙK›X]ÚYØ[\Ù›Ü˜ÙT^[Y[Y
HÂˆÛÛœÝ^ÜÝ\™HH
Ý\œ™[Ý[K—ÔÝ\Y\—Ò[›ÚXÙWÑ^ÜÝ\™WÔ›ÝÜÈ×JK™š[™

›ÝÊHOˆ›ÝËœÝ\Y\’[›ÚXÙRYOOH[œÝXÝ[Û‹œÛÝ\˜ÙWÜÝ\Y\—Ú[›ÚXÙWÚY
NÂˆX]ÚY^[Y[H
^ÜÝ\™OËœ^[Y[È×JK™š[™

›ÝÊHOˆ›ÝËšYOOH›ÙK›X]ÚYØ[\Ù›Ü˜ÙT^[Y[Y	‰ˆ[X™\Š›ÝË˜[[Ý[
H	‰ˆX]˜XœÊX]˜XœÊ[X™\Š›ÝË˜[[Ý[
JHH[›™Y[[Ý[
HHŒH	‰ˆ
›ÝË˜Ý\œ™[˜ÞR\ÛÐÛÙH	ÕTÑ	ÊHOOH[œÝXÝ[Û‹˜Ý\œ™[˜ÞWÚ\Û×ØÛÙJNÂˆYˆ
[X]ÚY^[Y[
H›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝYØ[\Ù›Ü˜ÙH™Y[™›ÈÛ™Ù\ˆX]Ú\È\ÈÝ\Y\ˆ[›ÚXÙKÝ\œ™[˜ÞK[™[[Ý[‰ËJNÂˆX]ÚY^[Y[YHX]ÚY^[Y[šYÂˆB‚ˆÛÛœÝ]™[\HHÝ]\ÈOOH	ÒÛXÚÛ›ÝÛYÙY	ÈÈ	ÜÝ\Y\—ÚÛØXÚÛ›ÝÛYÙY	ÈˆÝ]\ÈOOH	ÔÙ]Y	ÈÈ	ÜÝ\Y\—Ü™XÛÝ™\žWÜÙ]Y	Èˆ™XÛÝ™\žSY]Ù	‰ˆ™XÛÝ™\žSY]ÙOOH[œÝXÝ[Û‹œ™XÛÝ™\žWÛY]ÙÈ	ÜÝ\Y\—Ü™XÛÝ™\žWÛY]ÙÜÙ[XÝY	Èˆ	ØXØÛÝ[[™×Ý\]Y	ÎÂˆÛÛœÝ]™[›ÝHH	Ú[œÝXÝ[Û‹š[œÝXÝ[Û—Ý\HOOH	ÝÚ]ÛÝ[œZY	ÈÈ	ÑÈ›Ý^IÈˆ	ÑÙ]˜XÚÈZY[[Ý[	ßH\]YÈ	ÜÝ]\ßK˜ÂˆÛÛœÝ[œÝXÝ[Û•˜[Y\ÈHÂˆÝ]\Ëˆ™XÛÝ™\žWÛY]Ùˆ™XÛÝ™\žSY]Ùˆ\™Ù]ÜÝ\Y\—Ú[›ÚXÙWÚYˆ\™Ù][›ÚXÙOËœÝ\Y\’[›ÚXÙRY[ˆ\™Ù]ÜÝ\Y\—Ú[›ÚXÙWÛ˜[YNˆ\™Ù][›ÚXÙOËš[›ÚXÙS˜[YH[ˆ\™Ù]ÜÝ[WÚYˆ\™Ù][›ÚXÙOËœÝ[RY[ˆ\™Ù]Ú[›ÚXÙWØ[[Ý[ÜÛ˜\ÚÝˆ\™Ù][›ÚXÙOËš[›ÚXÙP[[Ý[ÏÈ[ˆ\™Ù]Ü^XX›WØ[[Ý[ÜÛ˜\ÚÝˆ\™Ù][›ÚXÙOËœ^XX›P˜[[˜ÙHÏÈ[ˆ\™Ù]Ú[›ÚXÙWÜÛ˜\ÚÝˆ\™Ù][›ÚXÙHßKˆ\™Ù]ÜÝ[WÜÛ˜\ÚÝˆ\™Ù][›ÚXÙOËœÝ[RYÈÈÝ[RYˆ\™Ù][›ÚXÙKœÝ[RYHˆßKˆX]ÚYÜØ[\Ù›Ü˜ÙWÜ^[Y[ÚYˆX]ÚY^[Y[YˆX]Ú[™×Ü^[Y[ÜÛ˜\ÚÝˆX]ÚY^[Y[ßKˆ[œÝXÝ[Û—Ü™Y™\™[˜ÙNˆ[œÝXÝ[Û”™Y™\™[˜ÙH[ˆ[œÝXÝ[Û—Ù]Nˆ[œÝXÝ[Û‘]Kˆ[œÝXÝ[Û—Ø[[Ý[ˆXÚ[X[Ü“[
›ÙKš[œÝXÝ[Û[[Ý[
HÏÈ
Ý]\ÈOOH	Ò[œÝXÝ[Ûˆ\ÜÝYY	ÈÈ[›™Y[[Ý[ˆ[
KˆÙ][Y[Ü™Y™\™[˜ÙNˆÙ][Y[™Y™\™[˜ÙH[ˆÙ][Y[Ù]NˆÙ][Y[]KˆÙ][Y[Ø[[Ý[ˆÙ][Y[[[Ý[ˆXØÛÝ[[™×Û›ÝNˆXØÛÝ[[™Ó›ÝH[ˆ]™[Ý\Nˆ]™[\Kˆ]™[Û›ÝNˆ]™[›ÝKˆ]™[ÛY]Y]NˆÂˆÝ\Y\’[œÝXÝ[Û’Yˆ[œÝXÝ[Û‹šYˆ™XÛÝ™\žSY]Ùˆ\™Ù]Ý\Y\’[›ÚXÙRYˆ\™Ù][›ÚXÙOËœÝ\Y\’[›ÚXÙRY[ˆX]ÚYØ[\Ù›Ü˜ÙT^[Y[YˆX]ÚY^[Y[Yˆ[›™Y[[Ý[ˆÝ\œ™[˜ÞR\ÛÐÛÙNˆ[œÝXÝ[Û‹˜Ý\œ™[˜ÞWÚ\Û×ØÛÙKˆKˆNÂˆÛÛœÝÈ\œ›ÜŽˆ\]Q\œ›ÜˆHH]ØZ]ÛY[œœÊ	Ý\]WÙ\Ü]WÜÝ\Y\—Ú[œÝXÝ[Û‰ËÂˆÚ[œÝXÝ[Û—ÚYˆ[œÝXÝ[Û‹šYˆÙ^XÝYÜ™]š\Ú[ÛŽˆ[X™\Š[œÝXÝ[Û‹œ™]š\Ú[ÛˆJKˆÝ˜[Y\Îˆ[œÝXÝ[Û•˜[Y\ËˆÝ\™Ù]Ü^XX›WØ[[Ý[ˆ\™Ù][›ÚXÙOËœ^XX›P˜[[˜ÙHÏÈ[ˆØXÝÜŽˆÈYˆ›Ùš[KšY[XZ[ˆ›Ùš[K™[XZ[KˆJNÂˆYˆ
\]Q\œ›ÜŠHÂˆYˆ
Ýš[™Ê\]Q\œ›Ü‹›Y\ÜØYÙH	ÉÊKš[˜ÛY\Ê	Ü™]š\Ú[ÛˆÛÛ™›XÝ	ÊJHÂˆ›ÝÈ\\œ›ÜŠ	Õ\ÈÝ\Y\ˆ[œÝXÝ[ÛˆØ\È\]YžH[›Ý\ˆ\Ù\‹ˆ™Yœ™\Ú[™žHYØZ[‹‰ËJNÂˆBˆYˆ
Ýš[™Ê\]Q\œ›Ü‹›Y\ÜØYÙH	ÉÊKš[˜ÛY\Ê	Ø[™XYH™\Ù\™Y	ÊJHÂˆ›ÝÈ\\œ›ÜŠ	ÕHÙ[XÝYÙ™œÙ][›ÚXÙH›ÈÛ™Ù\ˆ\È[›ÝYÚ[œ™\Ù\™Y^XX›H˜[[˜ÙKˆ™Yœ™\ÚHÙ™œÙ]Ü[ÛœË‰ËJNÂˆBˆ›ÝÈ\]Q\œ›ÜŽÂˆB‚ˆYˆ
Ø\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ð\›Ý™Y	ÊHÂˆÛÛœÝ™Yœ™\ÚYH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆ™]\›ˆÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJØ\ÙT›ÝÊKˆ\Y\Îˆ™Yœ™\ÚYœ\T›ÝÜË›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\JKˆXÝ[ÛœÎˆ™Yœ™\ÚY˜XÝ[ÛœËˆÝ\Y\’[œÝXÝ[ÛœÎˆ™Yœ™\ÚYœÝ\Y\’[œÝXÝ[ÛœËˆØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
KˆNÂˆBˆ]\]YØ\ÙHH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[Ø\ÙT›ÝËšY
NÂˆ\]YØ\ÙHH]ØZ]\œÚ\Ý\Ü]PXØÛÝ[[™ÔÝ]\ÊÛY[\]YØ\ÙKÝ\œ™[Ý[K›Ùš[K\]YØ\ÙKÛÜšÙ›Ý×ÜÝ]\ÊNÂˆÛÛœÝ™Yœ™\ÚYH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆ™]\›ˆÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJ\]YØ\ÙJKˆ\Y\ÎˆÛÜšÙ›ÝËœ\T›ÝÜË›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\JKˆXÝ[ÛœÎˆ™Yœ™\ÚY˜XÝ[ÛœËˆÝ\Y\’[œÝXÝ[ÛœÎˆ™Yœ™\ÚYœÝ\Y\’[œÝXÝ[ÛœËˆØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
KˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÔÝ\Y\[[Ý[[Y[™
›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝXÝ[Û’YHÝš[™Ê›ÙK˜XÝ[Û’Y	ÉÊKš[J
NÂˆÛÛœÝ[[Ý[HXÚ[X[Ü“[
›ÙK™\Ü]P[[Ý[ÏÈ›ÙK˜[[Ý[
NÂˆÛÛœÝ›ÝHHÝš[™Ê›ÙK››ÝH›ÙK™\ØÜš\[Ûˆ	ÉÊKš[J
NÂˆÛÛœÝÝ\œ™[˜ÞR\ÛÐÛÙHHÝš[™Ê›ÙK˜Ý\œ™[˜ÞR\ÛÐÛÙH	ÕTÑ	ÊBˆš[J
BˆÕ\\Ø\ÙJ
NÂˆYˆ
XXÝ[Û’Y
H›ÝÈ\\œ›ÜŠ	ØXÝ[Û’Y\È™\]Z\™Y‰Ë
NÂˆYˆ
[[Ý[OH[[[Ý[
H›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ\Ü]H[[Ý[]\Ý™H™\›ÈÜˆÜ™X]\‹‰Ë
NÂˆYˆ
K×–ÐKV—^ÌßIË\Ý
Ý\œ™[˜ÞR\ÛÐÛÙJJH›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ\Ü]HÝ\œ™[˜ÞH]\Ý™HH™YK[]\ˆTÓÈÛÙK‰Ë
NÂˆYˆ
[[Ý[OOH	‰ˆ[›ÝJH›ÝÈ\\œ›ÜŠ	Ñ^Z[ˆÚH›ÈÝ\Y\ˆ™XÛÝ™\žH\È™\]Z\™Y‰Ë
NÂˆÛÛœÝÈ]NˆXÝ[Û‹\œ›ÜŽˆXÝ[Û‘\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÐ‘UWÐPÕSÓ—ÔÑSPÕ
K™\J	ÚY	ËXÝ[Û’Y
K›X^X™TÚ[™ÛJ
NÂˆYˆ
XÝ[Û‘\œ›ÜŠH›ÝÈXÝ[Û‘\œ›ÜŽÂˆYˆ
XXÝ[ÛˆXÝ[Û‹œ\WÜÚYHOOH	ÜÝ\Y\‰ÊH›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆXÝ[Ûˆ›Ý›Ý[™‰Ë
NÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[XÝ[Û‹˜Ø\ÙWÚY
NÂˆÛÛœÝXÝÜ‘[XZ[HÝš[™Ê›Ùš[K™[XZ[	ÉÊBˆš[J
BˆÓÝÙ\Ø\ÙJ
NÂˆÛÛœÝ™\ÜÛœÚX›U˜Y\ˆBˆXÝ[Û‹˜Ü™X]YØžHOOH›Ùš[KšYˆØ\ÙT›ÝËœÝX›Z]YØžHOOH›Ùš[KšYˆØXÝ[Û‹˜Ü™X]YØžWÙ[XZ[Ø\ÙT›ÝËœÝX›Z]YØžWÙ[XZ[KœÛÛYJˆ
[XZ[
HO‚ˆÝš[™Ê[XZ[	ÉÊBˆš[J
BˆÓÝÙ\Ø\ÙJ
HOOHXÝÜ‘[XZ[ˆ
NÂˆYˆ
Z\ÐYZ[š\Ý˜]Ü•\Ù\•\J›Ùš[K\Ù\—Ý\JH	‰ˆ\™\ÜÛœÚX›U˜Y\ŠHÂˆ›ÝÈ\\œ›ÜŠ	ÓÛ›HH™\ÜÛœÚX›H˜Y\ˆÜˆ[ˆYZ[š\Ý˜]ÜˆØ[ˆ™XÛÜ™\ÈÝ\Y\ˆ\Ü]H[[Ý[‰ËÊNÂˆBˆYˆ
Ø\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÈOOH	ÐÛÜÙY	ÊH›ÝÈ\\œ›ÜŠ	ÐÛÜÙY\Ü]\ÈØ[››Ý™H[Y[™Y‰Ë
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝÝ\œ™[Ý[HH]ØZ]ØYÝ\œ™[\Ü]TÝ[JØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆYˆ
Z\Õ[˜XØÙ\Y^\›˜[\Ü]PÛÜÝ\™JØ\ÙT›ÝËÝ\œ™[Ý[JJH\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆÛÛœÝÛÜšÙ›ÝÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ™YÚ\ÝžHH\ÜÙ\˜[Y\Ü]T\Y\ÊÝ\œ™[Ý[KÛÜšÙ›ÝËœ\T›ÝÜÊNÂˆ˜[Y]TÝÜ™Y\Ü]PXÝ[ÛœÊÛÜšÙ›ÝË˜XÝ[Û”›ÝÜËÛÜšÙ›ÝËœ\T›ÝÜË™YÚ\ÝžJNÂˆÛÛœÝ\PžRYH\Ü]T\T›ÝÓX\
ÛÜšÙ›ÝËœ\T›ÝÜÊNÂˆÛÛœÝ^\Ý[™Ð[[Ý[HXÚ[X[Ü“[
XÝ[Û‹˜[[Ý[
NÂˆÛÛœÝÛÛ[Y\˜ÚX[[[Ý[Ú[™ÙYH^\Ý[™Ð[[Ý[OH[X]˜XœÊ^\Ý[™Ð[[Ý[H[[Ý[
HˆŒNÂˆÛÛœÝY]X›TÝYÙHHÉÑ˜Y	Ë	Ô™Z™XÝY	Ë	Ô™]š\Ú[Ûˆ™\]Y\ÝY	×Kš[˜ÛY\ÊØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÊNÂˆÛÛœÝ[Y[™YÝYÙHHY]X›TÝYÙHÈØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÈˆÛÛ[Y\˜ÚX[[[Ý[Ú[™ÙYÈ	Ô™]š\Ú[Ûˆ™\]Y\ÝY	ÈˆØ\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ð\›Ý™Y	ÈÈ	ÐXØÛÝ[[™È[ˆ›ÙÜ™\ÜÉÈˆØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÎÂˆÛÛœÝ[Y[™Y\›Ý˜[H[Y[™YÝYÙHOOH	Ñ˜Y	ÈÈ	Ñ˜Y	Èˆ[Y[™YÝYÙHOOH	Ô™]š\Ú[Ûˆ™\]Y\ÝY	ÈÈ	Ô™]š\Ú[Ûˆ™\]Y\ÝY	ÈˆØ\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÎÂˆÛÛœÝœÐXÝ[ÛœÈHÛÜšÙ›ÝË˜XÝ[Û”›ÝÜË›X\

›ÝÊHOˆÂˆÛÛœÝ\HH\PžRY™Ù]
›ÝËœ\WÚY
NÂˆÛÛœÝ˜\ÙHHÂˆ‹‹œ›ÝËˆ\WØXØÛÝ[ÚÙ^Nˆ\OË˜XØÛÝ[ÚÙ^KˆNÂˆYˆ
›ÝËšYOOHXÝ[Û‹šY
H™]\›ˆ˜\ÙNÂˆ™]\›ˆ™\\™TÝ\Y\”Ù][Y[XÝ[ÛŠˆÂˆ‹‹˜˜\ÙKˆXÝ[Û—Ý\Nˆ	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IËˆXÝ[Û—ÛX™[ˆTÔUWÐ‘UWÐPÕSÓ—ÓP‘SËœ™\ÛÛ™WÜÝ\Y\—Ù\Ü]Kˆ[[Ý[ˆÜXÚX[Ø^WÜšXÙNˆ[ˆ\ØÜš\[ÛŽˆ›ÝH›ÝË™\ØÜš\[Ûˆ	ÉËˆÝ\œ™[˜ÞWÚ\Û×ØÛÙNˆÝ\œ™[˜ÞR\ÛÐÛÙKˆ[›ÚXÙWØ[ØØ][ÛœÎˆ\œ˜^Kš\Ð\œ˜^J›ÙKš[›ÚXÙP[ØØ][ÛœÊHÈ›ÙKš[›ÚXÙP[ØØ][ÛœÈˆ×Kˆ^XÝ][Û—ÜÝ]\Îˆ	Ô[™[™ÈXØÛÝ[[™ÉËˆKˆÝ\œ™[Ý[Kˆ
NÂˆJNÂˆÛÛœÝš[˜[˜ÚX[ÈHØ[Ý[]Q\Ü]P™]TÙ][Y[
œÐXÝ[ÛœÊNÂˆÛÛœÝØ[\Ù›Ü˜ÙTÝ]\ÈH[Y[™YÝYÙHOOH	Ñ˜Y	ÈÈ	ÓÜ[ˆH˜Y\ˆ™]šY]ÉÈˆ[Y[™YÝYÙNÂˆÛÛœÝØ\ÙT^[ØYHÂˆ‹‹™\Ü]P™]PØ\ÙQœ›ÛTÝ[JÝ\œ™[Ý[JKˆÝ\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\ÎˆØ[\Ù›Ü˜ÙTÝ]\ËˆÛÜšÙ›Ý×ÜÝ]\Îˆ[Y[™YÝYÙKˆ\›Ý˜[ÜÝ]\Îˆ[Y[™Y\›Ý˜[ˆ]\ÝÛ›ÝNˆ›ÝH	ÔÝ\Y\ˆ\Ü]H[[Ý[™XÛÜ™Y‰ËˆÙ][Y[Ùš[˜[˜ÚX[Îˆš[˜[˜ÚX[ËˆÙ][Y[Ü›ˆš[˜[˜ÚX[ËœÙ][Y[›ˆNÂˆÛÛœÝÈ]NˆØ]™YØ\ÙRY\œ›ÜŽˆØ]™Q\œ›ÜˆHH]ØZ]ÛY[œœÊ	ÜØ]™WÙ\Ü]WÝÛÜšÙ›Ý×Ù˜Y	ËÂˆØØ\ÙNˆØ\ÙT^[ØYˆÜ\Y\ÎˆÛÜšÙ›ÝËœ\T›ÝÜË›X\

\JHOˆ
ÂˆXØÛÝ[ÚYˆ\K˜XØÛÝ[ÚYˆXØÛÝ[ÚÙ^Nˆ\K˜XØÛÝ[ÚÙ^KˆXØÛÝ[Û˜[YNˆ\K˜XØÛÝ[Û˜[YKˆ›Û\Îˆ\Kœ›Û\ËˆÛÝ\˜ÙWÝ\\Îˆ\KœÛÝ\˜ÙWÝ\\ËˆÛÝ\˜ÙWÜ™XÛÜ™ÚYÎˆ\KœÛÝ\˜ÙWÜ™XÛÜ™ÚYËˆ^[Y[Ý\›\Îˆ\Kœ^[Y[Ý\›\Ëˆ›ÙXÝÎˆ\Kœ›ÙXÝËˆØ[˜Ù[YÜÛÝ\˜ÙWÛÛ›Nˆ\K˜Ø[˜Ù[YÜÛÝ\˜ÙWÛÛ›KˆJJKˆØXÝ[ÛœÎˆœÐXÝ[ÛœËˆØXÝÜŽˆÈYˆ›Ùš[KšY[XZ[ˆ›Ùš[K™[XZ[KˆÙ]™[Û›ÝNˆ›ÝH	ÔÝ\Y\ˆ\Ü]H[[Ý[™XÛÜ™Y‰ËˆJNÂˆYˆ
Ø]™Q\œ›ÜŠH›ÝÈØ]™Q\œ›ÜŽÂˆÛÛœÝ\]YØ\ÙHH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[Ø]™YØ\ÙRYØ\ÙT›ÝËšY
NÂˆ]ØZ]]Ú\Ü]UÛÜšÙ›ÝÔÝ]\Ò[”Ø[\Ù›Ü˜ÙJ\]YØ\ÙKØ[\Ù›Ü˜ÙTÝ]\ÊNÂˆÛÛœÝÝ]\ÐØ\ÙHH]ØZ]™XÛÜ™\Ü]UÛÜšÙ›ÝÔØ[\Ù›Ü˜ÙUÜš]X˜XÚÊÛY[\]YØ\ÙK›Ùš[KØ[\Ù›Ü˜ÙTÝ]\ÊNÂˆYˆ
[Y[™YÝYÙHOOH	Ô™]š\Ú[Ûˆ™\]Y\ÝY	ÊHÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[Ý]\ÐØ\ÙK	Ü™]š\Ú[Û—Ü™\]Y\ÝY	Ë›Ùš[KÂˆXÝ[Û’YˆXÝ[Û‹šYˆ›ÝNˆ	ÔÝ\Y\ˆ\Ü]H[[Ý[YYÈ[ˆ^\Ý[™ÈÛÜšÙ›ÝÎÈ\›Ý˜[\È™\]Z\™YYØZ[‹‰ËˆY]Y]NˆÈ\Ü]P[[Ý[ˆ[[Ý[Ý\œ™[˜ÞR\ÛÐÛÙHKˆJNÂˆH[ÙHYˆ
XÛÛ[Y\˜ÚX[[[Ý[Ú[™ÙY	‰ˆXÝ[Û‹˜XÝ[Û—Ý\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÊHÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[Ý]\ÐØ\ÙK	ÜÝ\Y\—Ü^[Y[Ü™XÛÛ˜Ú[Y	Ë›Ùš[KÂˆXÝ[Û’YˆXÝ[Û‹šYˆ›ÝNˆ	Ñ^\Ý[™ÈÝ\Y\ˆ[[Ý[ÛÛ™\Y[È[›ÚXÙK[]™[š[˜[˜ÙH[œÝXÝ[ÛœË‰ËˆY]Y]NˆÈ\Ü]P[[Ý[ˆ[[Ý[Ý\œ™[˜ÞR\ÛÐÛÙHKˆJNÂˆBˆÛÛœÝ™Yœ™\ÚYH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝØÝ[Y[ÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÑØÝ[Y[ÊÛY[Ø\ÙT›ÝËšY
NÂˆ™]\›ˆÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJÝ]\ÐØ\ÙJKˆ\Y\Îˆ™Yœ™\ÚYœ\T›ÝÜË›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\JKˆXÝ[ÛœÎˆ™Yœ™\ÚY˜XÝ[ÛœËˆÝ\Y\’[œÝXÝ[ÛœÎˆ™Yœ™\ÚYœÝ\Y\’[œÝXÝ[ÛœËˆØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
KˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÐXØÛÝ[[™Õ\]J›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×ØXØÛÝ[	Ë	Ñ\Ü]HXØÛÝ[[™È\›Z\ÜÚ[Ûˆ\È™\]Z\™Y›ÜˆXØÛÝ[[™È\]\Ë‰ÊNÂˆÛÛœÝXÝ[Û’YHÝš[™Ê›ÙK˜XÝ[Û’Y	ÉÊKš[J
NÂˆYˆ
XXÝ[Û’Y
H›ÝÈ\\œ›ÜŠ	ØXÝ[Û’Y\È™\]Z\™Y‰Ë
NÂˆÛÛœÝÈ]NˆXÝ[Û‹\œ›ÜŽˆXÝ[Û“ÛÚÝ\\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÐ‘UWÐPÕSÓ—ÔÑSPÕ
K™\J	ÚY	ËXÝ[Û’Y
K›X^X™TÚ[™ÛJ
NÂˆYˆ
XÝ[Û“ÛÚÝ\\œ›ÜŠH›ÝÈXÝ[Û“ÛÚÝ\\œ›ÜŽÂˆYˆ
XXÝ[ÛŠH›ÝÈ\\œ›ÜŠ	Ñ\Ü]HÛÜšÙ›ÝÈXÝ[Ûˆ›Ý›Ý[™‰Ë
NÂˆYˆ
XÝ[Û‹˜XÝ[Û—Ý\HOOH	Ü™\ÛÛ™WÜÝ\Y\—Ù\Ü]IÊHÂˆ›ÝÈ\\œ›ÜŠ	Õ\]HXXÚÝ\Y\ˆ[›ÚXÙH[œÝXÝ[Ûˆ[œÝXYÙˆH\™[Ý\Y\ˆ™\ÛÛ][Û‹‰Ë
NÂˆBˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[XÝ[Û‹˜Ø\ÙWÚY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝ\T›ÝÜÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÔ\Y\ÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝÝ\œ™[Ý[HH]ØZ]ØYÝ\œ™[\Ü]TÝ[JØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝ^\›˜[ÛÜÝ\™HH\Õ[˜XØÙ\Y^\›˜[\Ü]PÛÜÝ\™JØ\ÙT›ÝËÝ\œ™[Ý[JNÂˆYˆ
Y^\›˜[ÛÜÝ\™JH\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆÛÛœÝ™YÚ\ÝžHH\ÜÙ\˜[Y\Ü]T\Y\ÊÝ\œ™[Ý[K\T›ÝÜÊNÂˆÛÛœÝÝÜ™YÛÜšÙ›ÝÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆ˜[Y]TÝÜ™Y\Ü]PXÝ[ÛœÊÝÜ™YÛÜšÙ›ÝË˜XÝ[Û”›ÝÜË\T›ÝÜË™YÚ\ÝžJNÂˆ\ÜÙ\Ý\Y\‘\Ü]P[[Ý[ÊÝÜ™YÛÜšÙ›ÝË˜XÝ[Û”›ÝÜÊNÂˆYˆ
Ø\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ð\›Ý™Y	ÈØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÈOOH	ÐÛÜÙY	ÊHÂˆ›ÝÈ\\œ›ÜŠ	ÐXØÛÝ[[™ÈØ[ˆ\]HXÝ[ÛœÈÛ›HY\ˆ\›Ý˜[[™™Y›Ü™HÛÜÝ\™K‰Ë
NÂˆBˆ]ØZ]™XÛÛ˜Ú[P\›Ý™YÝ\Y\’[œÝXÝ[ÛœÊÛY[Ø\ÙT›ÝË\T›ÝÜËÝÜ™YÛÜšÙ›ÝË˜XÝ[Û”›ÝÜËÝÜ™YÛÜšÙ›ÝËš[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[K›Ùš[JNÂ‚ˆÛÛœÝXØÛÝ[[™ÔÝ]\ÈH›Ü›X[^™Q\Ü]P™]TÝ]\Ê›ÙK˜XØÛÝ[[™ÔÝ]\È›ÙK™^XÝ][Û”Ý]\ËTÔUWÐ‘UWÑVPÕUSÓ—ÔÕUTÑTË	ÉÊNÂˆYˆ
XXØÛÝ[[™ÔÝ]\ÊH›ÝÈ\\œ›ÜŠ	Õ˜[YXØÛÝ[[™ÈÝ]\È\È™\]Z\™Y‰Ë
NÂˆÛÛœÝ[œÝXÝ[Û”™Y™\™[˜ÙHHÝš[™Ê›ÙKš[œÝXÝ[Û”™Y™\™[˜ÙH	ÉÊKš[J
NÂˆÛÛœÝ[œÝXÝ[Û‘]HHÝš[™Ê›ÙKš[œÝXÝ[Û‘]H	ÉÊKš[J
H[ÂˆÛÛœÝÙ][Y[™Y™\™[˜ÙHHÝš[™Ê›ÙKœÙ][Y[™Y™\™[˜ÙH	ÉÊKš[J
NÂˆÛÛœÝÙ][Y[]HHÝš[™Ê›ÙKœÙ][Y[]H	ÉÊKš[J
H[ÂˆÛÛœÝXØÛÝ[[™Ó›ÝHHÝš[™Ê›ÙK˜XØÛÝ[[™Ó›ÝH›ÙK››ÝH	ÉÊKš[J
NÂˆYˆ
[œÝXÝ[Û‘]H	‰ˆK×—ÍKWÌŸKWÌŸIË\Ý
[œÝXÝ[Û‘]JJH›ÝÈ\\œ›ÜŠ	Ò[œÝXÝ[Ûˆ]H\È[˜[Y‰Ë
NÂˆYˆ
Ù][Y[]H	‰ˆK×—ÍKWÌŸKWÌŸIË\Ý
Ù][Y[]JJH›ÝÈ\\œ›ÜŠ	ÔÙ][Y[]H\È[˜[Y‰Ë
NÂˆYˆ
XØÛÝ[[™ÔÝ]\ÈOOH	Ò[œÝXÝ[Ûˆ\ÜÝYY	È	‰ˆ
Z[œÝXÝ[Û‘]H
Z[œÝXÝ[Û”™Y™\™[˜ÙH	‰ˆXXØÛÝ[[™Ó›ÝJJJHÂˆ›ÝÈ\\œ›ÜŠ	Ò[œÝXÝ[Ûˆ\ÜÝYY™\]Z\™\È[ˆ[œÝXÝ[Ûˆ]H[™H™Y™\™[˜ÙHÜˆXØÛÝ[[™È›ÝK‰Ë
NÂˆBˆÛÛœÝØÝ[Y[ÈH]ØZ]ØY\Ü]UÛÜšÙ›ÝÑØÝ[Y[ÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ\ÔÙ][Y[ØÝ[Y[HØÝ[Y[ËœÛÛYJ
ØÝ[Y[
HOˆØÝ[Y[˜XÝ[Û—ÚYOOHXÝ[Û’Y	‰ˆÉÜÙ][Y[ØYÜ™Y[Y[	Ë	Ø^Y\—ØÜ™Y]Û›ÝIË	ÜÝ\Y\—ØÜ™Y]Û›ÝIË	Ü›ÛÙ—ÛÙ—Ü^[Y[	×Kš[˜ÛY\ÊØÝ[Y[™ØÝ[Y[Ý\JJNÂˆYˆ
XØÛÝ[[™ÔÝ]\ÈOOH	ÔÙ]Y	È	‰ˆ
\Ù][Y[]H
\Ù][Y[™Y™\™[˜ÙH	‰ˆZ\ÔÙ][Y[ØÝ[Y[
JJHÂˆ›ÝÈ\\œ›ÜŠ	ÔÙ]Y™\]Z\™\ÈHÙ][Y[]H[™Z]\ˆH™Y™\™[˜ÙHÜˆÙ][Y[ØÝ[Y[‰Ë
NÂˆBˆÛÛœÝ›Ý™\]Z\™Y[YÚXš[]HH\Ü]S›Ý™\]Z\™Y[YÚXš[]JXÝ[Û‹\T›ÝÜËÝ\œ™[Ý[JNÂˆÛÛœÝ›Ý™\]Z\™Y™X\ÛÛ•ØZ]™YHXØÛÝ[[™ÔÝ]\ÈOOH	Ó›Ý™\]Z\™Y	È	‰ˆXXØÛÝ[[™Ó›ÝH	‰ˆ›Ý™\]Z\™Y[YÚXš[]K™[YÚX›NÂˆYˆ
XØÛÝ[[™ÔÝ]\ÈOOH	Ó›Ý™\]Z\™Y	È	‰ˆXXØÛÝ[[™Ó›ÝH	‰ˆ[›Ý™\]Z\™Y™X\ÛÛ•ØZ]™Y
HÂˆYˆ
›Ý™\]Z\™Y[YÚXš[]K˜˜[[˜ÙU\H	‰ˆ›Ý™\]Z\™Y[YÚXš[]K˜˜[[˜ÙHOH[
HÂˆ›ÝÈ\\œ›ÜŠHÝ\œ™[	Û›Ý™\]Z\™Y[YÚXš[]K˜˜[[˜ÙSX™[H˜[[˜ÙH\È[˜]˜Z[X›Kˆ[\ˆ[ˆXØÛÝ[[™È™X\ÛÛˆ™Y›Ü™HÙ[XÝ[™È›Ý™\]Z\™Y˜
NÂˆBˆYˆ
›Ý™\]Z\™Y[YÚXš[]K˜˜[[˜ÙU\JHÂˆ›ÝÈ\\œ›ÜŠHÝ\œ™[	Û›Ý™\]Z\™Y[YÚXš[]K˜˜[[˜ÙSX™[H˜[[˜ÙH\È	Û›Ý™\]Z\™Y[YÚXš[]K˜˜[[˜ÙKÑš^Y
Š_K›ÝŒˆ™Yœ™\ÚH\Ü]HÜˆ[\ˆ[ˆXØÛÝ[[™È™X\ÛÛ‹˜JNÂˆBˆ›ÝÈ\\œ›ÜŠ	Ñ^Z[ˆÚHXØÛÝ[[™È\È›Ý™\]Z\™Y‰Ë
NÂˆB‚ˆÛÛœÝÈ]NˆÝ\œ™[XÝ[Û”›ÝÜË\œ›ÜŽˆÝ\œ™[XÝ[ÛœÑ\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÐ‘UWÐPÕSÓ—ÔÑSPÕ
K™\J	ØØ\ÙWÚY	ËØ\ÙT›ÝËšY
K›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™ÎˆYHJNÂˆYˆ
Ý\œ™[XÝ[ÛœÑ\œ›ÜŠH›ÝÈÝ\œ™[XÝ[ÛœÑ\œ›ÜŽÂˆÛÛœÝ›Ú™XÝYXÝ[ÛœÈH
Ý\œ™[XÝ[Û”›ÝÜÈ×JK›X\

›ÝÊHOˆ
›ÝËšYOOHXÝ[Û’YÈÈ‹‹œ›ÝË^XÝ][Û—ÜÝ]\ÎˆXØÛÝ[[™ÔÝ]\ÈHˆ›ÝÊJNÂˆÛÛœÝ[Ù]YH›Ú™XÝYXÝ[ÛœË›[™Ýˆ	‰ˆ›Ú™XÝYXÝ[ÛœË™]™\žJ
›ÝÊHOˆ›ÝË™^XÝ][Û—ÜÝ]\ÈOOH	ÔÙ]Y	È›ÝË™^XÝ][Û—ÜÝ]\ÈOOH	Ó›Ý™\]Z\™Y	ÊNÂˆÛÛœÝ\ÐXØÛÝ[[™Ô›ÙÜ™\ÜÈH›Ú™XÝYXÝ[ÛœËœÛÛYJ
›ÝÊHOˆ›ÝË™^XÝ][Û—ÜÝ]\ÈOOH	Ô[™[™ÈXØÛÝ[[™ÉÊNÂˆÛÛœÝÛÜšÙ›ÝÔÝ]\ÈH[Ù]YÈ	ÔÙ]YH™XYHÈÛÜÙIÈˆ\ÐXØÛÝ[[™Ô›ÙÜ™\ÜÈÈ	ÐXØÛÝ[[™È[ˆ›ÙÜ™\ÜÉÈˆ	Ð\›Ý™YH[™[™ÈXØÛÝ[[™ÉÎÂˆYˆ
Y^\›˜[ÛÜÝ\™JH]ØZ]]Ú\Ü]UÛÜšÙ›ÝÔÝ]\Ò[”Ø[\Ù›Ü˜ÙJØ\ÙT›ÝËÛÜšÙ›ÝÔÝ]\ÊNÂ‚ˆÛÛœÝ›ÝÒ\ÛÈH™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝÈ]Nˆ\]YXÝ[Û‹\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊBˆ\]JÂˆ^XÝ][Û—ÜÝ]\ÎˆXØÛÝ[[™ÔÝ]\Ëˆ[œÝXÝ[Û—Ü™Y™\™[˜ÙNˆ[œÝXÝ[Û”™Y™\™[˜ÙH[ˆ[œÝXÝ[Û—Ù]Nˆ[œÝXÝ[Û‘]Kˆ[œÝXÝ[Û—Ø[[Ý[ˆXÚ[X[Ü“[
›ÙKš[œÝXÝ[Û[[Ý[
KˆÙ][Y[Ü™Y™\™[˜ÙNˆÙ][Y[™Y™\™[˜ÙH[ˆÙ][Y[Ù]NˆÙ][Y[]KˆÙ][Y[Ø[[Ý[ˆXÚ[X[Ü“[
›ÙKœÙ][Y[[[Ý[
KˆXØÛÝ[[™×Û›ÝNˆXØÛÝ[[™Ó›ÝH[ˆXØÛÝ[[™×ØžNˆ›Ùš[KšYˆXØÛÝ[[™×ØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆXØÛÝ[[™×Ø]ˆ›ÝÒ\ÛËˆ^XÝ]YØžNˆXØÛÝ[[™ÔÝ]\ÈOOH	ÔÙ]Y	ÈÈ›Ùš[KšYˆ[ˆ^XÝ]YØžWÙ[XZ[ˆXØÛÝ[[™ÔÝ]\ÈOOH	ÔÙ]Y	ÈÈ›Ùš[K™[XZ[ˆ[ˆ^XÝ]YØ]ˆXØÛÝ[[™ÔÝ]\ÈOOH	ÔÙ]Y	ÈÈ›ÝÒ\ÛÈˆ[ˆ^XÝ][Û—Û›ÝNˆXØÛÝ[[™Ó›ÝH[ˆ\]YØžNˆ›Ùš[KšYˆ\]YØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆ\]YØ]ˆ›ÝÒ\ÛËˆJBˆ™\J	ÚY	ËXÝ[Û’Y
BˆœÙ[XÝ
TÔUWÐ‘UWÐPÕSÓ—ÔÑSPÕ
BˆœÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[Ø\ÙT›ÝË	ØXØÛÝ[[™×Ý\]Y	Ë›Ùš[KÂˆXÝ[Û’Yˆ›ÝNˆ	Ý\]YXÝ[Û‹˜XÝ[Û—ÛX™[H\]YÈ	ØXØÛÝ[[™ÔÝ]\ßK˜ˆY]Y]NˆÂˆXØÛÝ[[™ÔÝ]\Ëˆ[œÝXÝ[Û”™Y™\™[˜ÙKˆ[œÝXÝ[Û‘]KˆÙ][Y[™Y™\™[˜ÙKˆÙ][Y[]Kˆ›Ý™\]Z\™Y™X\ÛÛ•ØZ]™Yˆ™\šYšYY˜[[˜ÙNˆ›Ý™\]Z\™Y™X\ÛÛ•ØZ]™YÈ›Ý™\]Z\™Y[YÚXš[]K˜˜[[˜ÙHˆ[ˆ™\šYšYY˜[[˜ÙU\Nˆ›Ý™\]Z\™Y™X\ÛÛ•ØZ]™YÈ›Ý™\]Z\™Y[YÚXš[]K˜˜[[˜ÙU\Hˆ[ˆ\PXØÛÝ[Yˆ›Ý™\]Z\™Y™X\ÛÛ•ØZ]™YÈ›Ý™\]Z\™Y[YÚXš[]Kœ\PXØÛÝ[Yˆ[ˆKˆJNÂˆÛÛœÝÈ]NˆXÝ[Û”›ÝÜË\œ›ÜŽˆXÝ[ÛœÑ\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊKœÙ[XÝ
TÔUWÐ‘UWÐPÕSÓ—ÔÑSPÕ
K™\J	ØØ\ÙWÚY	ËØ\ÙT›ÝËšY
K›Ü™\Š	ØÜ™X]YØ]	ËÈ\ØÙ[™[™ÎˆYHJNÂˆYˆ
XÝ[ÛœÑ\œ›ÜŠH›ÝÈXÝ[ÛœÑ\œ›ÜŽÂˆÛÛœÝXÝ[ÛœÈHXÝ[Û”›ÝÜÈ×NÂˆÛÛœÝÈ]NˆÝ]\ÐØ\ÙK\œ›ÜŽˆØ\ÙQ\œ›ÜˆHH]ØZ]ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊK\]JÈÛÜšÙ›Ý×ÜÝ]\ÎˆÛÜšÙ›ÝÔÝ]\Ë\]YØ]ˆ›ÝÒ\ÛÈJK™\J	ÚY	ËØ\ÙT›ÝËšY
KœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
KœÚ[™ÛJ
NÂˆYˆ
Ø\ÙQ\œ›ÜŠH›ÝÈØ\ÙQ\œ›ÜŽÂˆÛÛœÝØ[\Ù›Ü˜ÙPØ\ÙHH^\›˜[ÛÜÝ\™BˆÈ]ØZ]™XÛÜ™^\›˜[\Ü]PÛÜÝ\™JÛY[Ý]\ÐØ\ÙKÝ\œ™[Ý[K›Ùš[KÛÜšÙ›ÝÔÝ]\ÊBˆˆ]ØZ]™XÛÜ™\Ü]UÛÜšÙ›ÝÔØ[\Ù›Ü˜ÙUÜš]X˜XÚÊÛY[Ý]\ÐØ\ÙK›Ùš[KÛÜšÙ›ÝÔÝ]\ÊNÂˆÛÛœÝ\SX\H\Ü]T\T›ÝÓX\
\T›ÝÜÊNÂˆ™]\›ˆÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJØ[\Ù›Ü˜ÙPØ\ÙJKˆ\Y\Îˆ\T›ÝÜË›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\JKˆXÝ[ÛŽˆÙ\šX[^™Q\Ü]P™]PXÝ[ÛŠ\]YXÝ[Û‹\SX\
KˆXÝ[ÛœÎˆ
XÝ[ÛœÈ×JK›X\

][JHOˆÙ\šX[^™Q\Ü]P™]PXÝ[ÛŠ][K\SX\
JKˆØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
KˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]P™]SX\šÑ^XÝ]Y
›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ\Ü]UÛÜšÙ›ÝÐXØÛÝ[[™Õ\]JˆÂˆ‹‹˜›ÙKˆXØÛÝ[[™ÔÝ]\Îˆ	ÔÙ]Y	ËˆÙ][Y[]Nˆ›ÙKœÙ][Y[]H™]È]J
KÒTÓÔÝš[™Ê
KœÛXÙJL
KˆÙ][Y[™Y™\™[˜ÙNˆ›ÙKœÙ][Y[™Y™\™[˜ÙH›ÙK››ÝKˆXØÛÝ[[™Ó›ÝNˆ›ÙK˜XØÛÝ[[™Ó›ÝH›ÙK››ÝKˆKˆ™\KˆXØÙ\ÜÐÛÛ^ˆ
NÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÐÛÛ\[œØ][ÛÛZ[\Ê›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝXÝ[Û’YHÝš[™Ê›ÙK˜XÝ[Û’Y	ÉÊKš[J
NÂˆYˆ
K×–ÌNXKY—^ÎKVÌNXKY—^ÍKVÌKMWVÌNXKY—^ÌßKVÎXX—VÌNXKY—^ÌßKVÌNXKY—^ÌLŸIÚK\Ý
XÝ[Û’Y
JH›ÝÈ\\œ›ÜŠ	Õ˜[Y\Ü]HXÝ[Ûˆ\È™\]Z\™Y‰Ë
NÂˆÛÛœÝÈ]NˆXÝ[Û‹\œ›ÜˆHH]ØZ]ÛÛ^˜ÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊBˆœÙ[XÝ
	ÚYØ\ÙWÚYÝ[WÚYXÝ[Û—Ý\KÛÜÙWÜ™X\ÛÛ‹\WÚY\]YØ]\Ü]WÝÛÜšÙ›Ý×Ü\Y\ÊXØÛÝ[ÚYXØÛÝ[Û˜[YJIÊBˆ™\J	ÚY	ËXÝ[Û’Y
Bˆ›X^X™TÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆYˆ
XXÝ[ÛŠH›ÝÈ\\œ›ÜŠ	Ñ\Ü]HXÝ[ÛˆØ\È›Ý›Ý[™‰Ë
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊXÝ[Û‹œÝ[WÚYÛÛ^
NÂˆYˆ
VÉØÛÜÙWØ^Y\—Ù\Ü]IË	ØÛÜÙWÜÝ\Y\—Ù\Ü]I×Kš[˜ÛY\ÊXÝ[Û‹˜XÝ[Û—Ý\JHÝš[™ÊXÝ[Û‹˜ÛÜÙWÜ™X\ÛÛˆ	ÉÊKš[J
KÓÝÙ\Ø\ÙJ
HOOH	Ý[ØÈÜ[™Y	ÊHÂˆ›ÝÈ\\œ›ÜŠ	ÐÛÛ\[œØ][ÛˆÛZ[\È\™H]˜Z[X›HÛ›H›ÜˆHSÐÈÜ[™YÛÜÝ\™HXÝ[Û‹‰ËJNÂˆBˆÛÛœÝXØÛÝ[YHXÝ[Û‹™\Ü]WÝÛÜšÙ›Ý×Ü\Y\ÏË˜XØÛÝ[ÚYÂˆÛÛœÝÛZ[\ÈH]ØZ]YÜ™YYÛÛ\[œØ][ÛÛZ[\Ñ›ÜXØÛÝ[
XØÛÝ[YÈ[˜ÛYPÛÜÙYˆ˜[ÙHJNÂˆ™]\›ˆÂˆXÝ[Û’YˆXÝ[Û•\]Y]ˆXÝ[Û‹\]YØ]ˆXØÛÝ[ˆÈXØÛÝ[YXØÛÝ[˜[YNˆXÝ[Û‹™\Ü]WÝÛÜšÙ›Ý×Ü\Y\ÏË˜XØÛÝ[Û˜[YH	ÉÈKˆÛZ[\ËˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÐÛÛ\[œØ][ÛÛZ[S[šÊ›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝXÝ[Û’YHÝš[™Ê›ÙK˜XÝ[Û’Y	ÉÊKš[J
NÂˆÛÛœÝÈ]NˆXÝ[Û‹\œ›ÜˆHH]ØZ]ÛÛ^˜ÛY[™œ›ÛJ	Ù\Ü]WØ™]WØXÝ[ÛœÉÊKœÙ[XÝ
	ÚYÝ[WÚY	ÊK™\J	ÚY	ËXÝ[Û’Y
K›X^X™TÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆYˆ
XXÝ[ÛŠH›ÝÈ\\œ›ÜŠ	Ñ\Ü]HXÝ[ÛˆØ\È›Ý›Ý[™‰Ë
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊXÝ[Û‹œÝ[WÚYÛÛ^
NÂˆ™]\›ˆ[šÑ\Ü]PYÜ™YYÛÛ\[œØ][ÛÛZ[J›ÙK[›Ù™šXÚX[ÛÛ\[œØ][Û”Ù\šXÙPÛÛ^
ÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ™\]Z\™Q^\›˜[\Ü]PÛÜÝ\™P]]Üš]JÛY[›Ùš[JHÂˆYˆ
›Ùš[OË\Ù\—Ý\HOOH	ØYZ[š\Ý˜]Ü‰ÊH™]\›ŽÂˆYˆ
›Ùš[OË\Ù\—Ý\HOOH	ÙÙ[™\˜[ÛX[˜YÙ\‰ÊHÂˆÛÛœÝÙ[™\˜[X[˜YÙ\ˆH]ØZ]ØYXÝ]™QÙ[™\˜[X[˜YÙ\ŠÛY[
NÂˆYˆ
Ù[™\˜[X[˜YÙ\‹šYOOH›Ùš[KšY
H™]\›ŽÂˆBˆ›ÝÈ\\œ›ÜŠ	ÓÛ›H[ˆYZ[š\Ý˜]ÜˆÜˆHXÝ]™HÙ[™\˜[X[˜YÙ\ˆØ[ˆXØÙ\H\Ü]HÛÜÙY\™XÝH[ˆØ[\Ù›Ü˜ÙK‰ËÊNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]UÛÜšÙ›ÝÐXØÙ\^\›˜[ÛÜÝ\™J›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™Q^\›˜[\Ü]PÛÜÝ\™P]]Üš]JÛY[›Ùš[JNÂˆÛÛœÝ™X\ÛÛˆHÝš[™Ê›ÙKœ™X\ÛÛˆ›ÙK››ÝH	ÉÊKš[J
NÂˆYˆ
\™X\ÛÛŠH›ÝÈ\\œ›ÜŠ	ÐH™X\ÛÛˆ\È™\]Z\™YÈXØÙ\H^\›˜[Ø[\Ù›Ü˜ÙHÛÜÝ\™K‰Ë
NÂˆ]Ø\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[›ÙK˜Ø\ÙRY›ÙKœÝ[RY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝÝ\œ™[Ý[HH]ØZ]ØYÝ\œ™[\Ü]TÝ[JØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆYˆ
Z\Õ[˜XØÙ\Y^\›˜[\Ü]PÛÜÝ\™JØ\ÙT›ÝËÝ\œ™[Ý[JJHÂˆ›ÝÈ\\œ›ÜŠ	Õ\È\Ü]H\È›Ý]ØZ][™ÈXØÙ\[˜ÙHÙˆ[ˆ^\›˜[Ø[\Ù›Ü˜ÙHÛÜÝ\™K‰ËJNÂˆBˆØ\ÙT›ÝÈH]ØZ]™XÛÜ™^\›˜[\Ü]PÛÜÝ\™JÛY[Ø\ÙT›ÝËÝ\œ™[Ý[K›Ùš[JNÂˆ]È\T›ÝÜËXÝ[Û”›ÝÜË[œÝXÝ[Û”›ÝÜÈHH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ™YÚ\ÝžHH\ÜÙ\˜[Y\Ü]T\Y\ÊÝ\œ™[Ý[K\T›ÝÜÊNÂˆÛÛœÝ™XÛÛ˜Ú[X][ÛˆH]ØZ]™XÛÛ˜Ú[P\›Ý™YÝ\Y\’[œÝXÝ[ÛœÊÛY[Ø\ÙT›ÝË\T›ÝÜËXÝ[Û”›ÝÜË[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[K›Ùš[JNÂˆYˆ
™XÛÛ˜Ú[X][Û‹˜Ú[™ÙY
HÂˆ›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ^[Y[ÈÚ[™ÙYˆÓÔÈ\]YHXØÛÝ[[™È[ŽÈš[˜[˜ÙH]\ÝÛÛ\]HH™]š\ÙY[œÝXÝ[ÛœÈ™Y›Ü™HXØÙ\[™ÈH^\›˜[ÛÜÝ\™K‰ËJNÂˆBˆYˆ
Ø\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ð\›Ý™Y	ÈØ\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÈOOH	ÔÙ]YH™XYHÈÛÜÙIÊHÂˆ›ÝÈ\\œ›ÜŠ	ÐÛÛ\]HH\›Ý™YÓÔÈXØÛÝ[[™ÈÛÜšÙ›ÝÈ™Y›Ü™HXØÙ\[™ÈH^\›˜[Ø[\Ù›Ü˜ÙHÛÜÝ\™K‰ËJNÂˆBˆÛÛœÝXÝ[ÛœÈH˜[Y]TÝÜ™Y\Ü]PXÝ[ÛœÊXÝ[Û”›ÝÜË\T›ÝÜË™YÚ\ÝžJNÂˆ\ÜÙ\Ý\Y\‘\Ü]P[[Ý[ÊXÝ[ÛœÊNÂˆÛÛœÝXÝ]™TÝ\Y\’[œÝXÝ[ÛœÈH[œÝXÝ[Û”›ÝÜË™š[\Š
[œÝXÝ[ÛŠHOˆ[œÝXÝ[Û‹œÝ]\ÈOOH	ÔÝ\\œÙYY	ÊNÂˆYˆ
XÝ]™TÝ\Y\’[œÝXÝ[ÛœËœÛÛYJ
[œÝXÝ[ÛŠHOˆVÉÔÙ]Y	Ë	Ó›Ý™\]Z\™Y	×Kš[˜ÛY\Ê[œÝXÝ[Û‹œÝ]\ÊJJHÂˆ›ÝÈ\\œ›ÜŠ	Ñ]™\žHÝ\Y\ˆ[›ÚXÙH[œÝXÝ[Ûˆ]\Ý™HÙ]YÜˆ›Ý™\]Z\™Y™Y›Ü™HXØÙ\[™ÈH^\›˜[ÛÜÝ\™K‰ËJNÂˆBˆYˆ
XXÝ[ÛœË›[™ÝXXÝ[ÛœË™]™\žJ
XÝ[ÛŠHOˆÉÔÙ]Y	Ë	Ó›Ý™\]Z\™Y	×Kš[˜ÛY\ÊXÝ[Û‹™^XÝ][Û—ÜÝ]\ÊJJHÂˆ›ÝÈ\\œ›ÜŠ	Ñ]™\žHXØÛÝ[[™ÈXÝ[Ûˆ]\Ý™HÙ]YÜˆ›Ý™\]Z\™Y™Y›Ü™HXØÙ\[™ÈH^\›˜[ÛÜÝ\™K‰ËJNÂˆBˆ]ØZ]\ÜÙ\\Ü]U[ØÐÛZ[\Ô™XYQ›ÜÛÜÝ\™JXÝ[ÛœË\T›ÝÜÊNÂˆÛÛœÝØÝ[Y[ÈH]ØZ]\ÜÙ\™\]Z\™Y\Ü]QØÝ[Y[ÊÛY[XÝ[ÛœÊNÂˆÛÛœÝ›ÝÒ\ÛÈH™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝÈ]Nˆ\]YØ\ÙK\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊBˆ\]JÂˆÛÜšÙ›Ý×ÜÝ]\Îˆ	ÐÛÜÙY	Ëˆ]\ÝÛ›ÝNˆ™X\ÛÛ‹ˆÝ\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\ÎˆÝš[™ÊÝ\œ™[Ý[K‘\Ü]WÔÝ]\××ØÈ	ÉÊKš[J
KˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×ÜÝ]\Îˆ	Ù^\›˜[	ËˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×Ù\œ›ÜŽˆ[ˆ^\›˜[ØÛÜÝ\™WØXØÙ\YØ]ˆ›ÝÒ\ÛËˆ^\›˜[ØÛÜÝ\™WØXØÙ\YØžNˆ›Ùš[KšYˆ^\›˜[ØÛÜÝ\™WØXØÙ\YØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆ^\›˜[ØÛÜÝ\™WØXØÙ\[˜ÙWÜ™X\ÛÛŽˆ™X\ÛÛ‹ˆÛÜÙYØžNˆ›Ùš[KšYˆÛÜÙYØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆÛÜÙYØ]ˆ›ÝÒ\ÛËˆ\]YØ]ˆ›ÝÒ\ÛËˆJBˆ™\J	ÚY	ËØ\ÙT›ÝËšY
Bˆ™\J	ÝÛÜšÙ›Ý×ÜÝ]\ÉË	ÔÙ]YH™XYHÈÛÜÙIÊBˆœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
Bˆ›X^X™TÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆYˆ
]\]YØ\ÙJH›ÝÈ\\œ›ÜŠ	ÕH\Ü]HÚ[™ÙY™Y›Ü™HH^\›˜[ÛÜÝ\™HØ\ÈXØÙ\Yˆ™Yœ™\Ú[™™]šY]È]YØZ[‹‰ËJNÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[\]YØ\ÙK	Ù^\›˜[ØÛÜÝ\™WØXØÙ\Y	Ë›Ùš[KÂˆ›ÝNˆ™X\ÛÛ‹ˆY]Y]NˆÂˆØ[\Ù›Ü˜ÙTÝ]\ÎˆÝ\œ™[Ý[K‘\Ü]WÔÝ]\××ØËˆØ[\Ù›Ü˜ÙS\Ý[ÙYšYY]ˆÝ\œ™[Ý[K“\Ý[ÙYšYY]H[ˆXØÛÝ[[™ÐÛÛ\]YˆYKˆKˆJNÂˆÛÛœÝ\SX\H\Ü]T\T›ÝÓX\
\T›ÝÜÊNÂˆ™]\›ˆÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJ\]YØ\ÙJKˆ\Y\Îˆ\T›ÝÜË›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\JKˆXÝ[ÛœÎˆXÝ[ÛœË›X\

XÝ[ÛŠHOˆÙ\šX[^™Q\Ü]P™]PXÝ[ÛŠXÝ[Û‹\SX\
JKˆØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
KˆNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\Ü]P™]PÛÜÙJ›ÙHHßK™\KXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÛY[›Ùš[HHHXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛY[›Ùš[K	Ù\Ü]\×ØXØÛÝ[	Ë	Ñ\Ü]HXØÛÝ[[™È\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈÛÜÙHH\Ü]K‰ÊNÂˆÛÛœÝØ\ÙT›ÝÈH]ØZ]Ù]\Ü]P™]PØ\ÙJÛY[›ÙK˜Ø\ÙRY›ÙKœÝ[RY
NÂˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆÛÛœÝÝ\œ™[Ý[HH]ØZ]ØYÝ\œ™[\Ü]TÝ[JØ\ÙT›ÝËœÝ[WÚYXØÙ\ÜÐÛÛ^ÈÛY[›Ùš[HJNÂˆYˆ
Z\Ô™XÛÜ™Y˜ÛÜÐÛÜÝ\™UÜš]X˜XÚÊØ\ÙT›ÝÊJH\ÜÙ\Ø[\Ù›Ü˜ÙQ\Ü]R\ÓÜ[ŠÝ\œ™[Ý[JNÂˆ]È\T›ÝÜËXÝ[Û”›ÝÜË[œÝXÝ[Û”›ÝÜÈHH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆÛÛœÝ™YÚ\ÝžHH\ÜÙ\˜[Y\Ü]T\Y\ÊÝ\œ™[Ý[K\T›ÝÜÊNÂˆÛÛœÝ™XÛÛ˜Ú[X][ÛˆH]ØZ]™XÛÛ˜Ú[P\›Ý™YÝ\Y\’[œÝXÝ[ÛœÊÛY[Ø\ÙT›ÝË\T›ÝÜËXÝ[Û”›ÝÜË[œÝXÝ[Û”›ÝÜËÝ\œ™[Ý[K›Ùš[JNÂˆYˆ
™XÛÛ˜Ú[X][Û‹˜Ú[™ÙY
HÂˆÛÛœÝ™[ØYYH]ØZ]ØY\Ü]UÛÜšÙ›ÝÐXÝ[ÛœÊÛY[Ø\ÙT›ÝËšY
NÂˆ\T›ÝÜÈH™[ØYYœ\T›ÝÜÎÂˆXÝ[Û”›ÝÜÈH™[ØYY˜XÝ[Û”›ÝÜÎÂˆ[œÝXÝ[Û”›ÝÜÈH™[ØYYš[œÝXÝ[Û”›ÝÜÎÂˆ›ÝÈ\\œ›ÜŠ	ÔÝ\Y\ˆ^[Y[ÈÚ[™ÙYY\ˆ\›Ý˜[ˆÓÔÈ\]YHXØÛÝ[[™È[ŽÈš[˜[˜ÙH]\ÝÛÛ\]HH™]š\ÙY[œÝXÝ[ÛœÈ™Y›Ü™HÛÜÝ\™K‰ËJNÂˆBˆYˆ
Ø\ÙT›ÝË˜\›Ý˜[ÜÝ]\ÈOOH	Ð\›Ý™Y	ÊH›ÝÈ\\œ›ÜŠ	ÓÛ›H\›Ý™Y\Ü]HÛÜšÙ›ÝÈØ\Ù\ÈØ[ˆ™HÛÜÙY‰Ë
NÂˆYˆ
Ø\ÙT›ÝËÛÜšÙ›Ý×ÜÝ]\ÈOOH	ÔÙ]YH™XYHÈÛÜÙIÊH›ÝÈ\\œ›ÜŠ	ÐÛÛ\]HXØÛÝ[[™ÈÙ][Y[›Üˆ]™\žHXÝ[Ûˆ™Y›Ü™HÛÜÚ[™Ë‰Ë
NÂˆÛÛœÝš[˜[›ÝHHÝš[™Ê›ÙK››ÝH	ÉÊKš[J
NÂˆYˆ
Yš[˜[›ÝJH›ÝÈ\\œ›ÜŠ	Ñš[˜[ÛÜÝ\™H›ÝH\È™\]Z\™Y‰Ë
NÂˆÛÛœÝXÝ[ÛœÈH˜[Y]TÝÜ™Y\Ü]PXÝ[ÛœÊXÝ[Û”›ÝÜË\T›ÝÜË™YÚ\ÝžJNÂˆ\ÜÙ\Ý\Y\‘\Ü]P[[Ý[ÊXÝ[ÛœÊNÂˆÛÛœÝXÝ]™TÝ\Y\’[œÝXÝ[ÛœÈH[œÝXÝ[Û”›ÝÜË™š[\Š
[œÝXÝ[ÛŠHOˆ[œÝXÝ[Û‹œÝ]\ÈOOH	ÔÝ\\œÙYY	ÊNÂˆYˆ
XÝ]™TÝ\Y\’[œÝXÝ[ÛœËœÛÛYJ
[œÝXÝ[ÛŠHOˆVÉÔÙ]Y	Ë	Ó›Ý™\]Z\™Y	×Kš[˜ÛY\Ê[œÝXÝ[Û‹œÝ]\ÊJJHÂˆ›ÝÈ\\œ›ÜŠ	Ñ]™\žHÝ\Y\ˆ[›ÚXÙH[œÝXÝ[Ûˆ]\Ý™HÙ]YÜˆ›Ý™\]Z\™Y™Y›Ü™HÛÜÝ\™K‰Ë
NÂˆBˆYˆ
JXÝ[ÛœÈ×JK›[™ÝJXÝ[ÛœÈ×JK™]™\žJ
XÝ[ÛŠHOˆXÝ[Û‹™^XÝ][Û—ÜÝ]\ÈOOH	ÔÙ]Y	ÈXÝ[Û‹™^XÝ][Û—ÜÝ]\ÈOOH	Ó›Ý™\]Z\™Y	ÊJHÂˆ›ÝÈ\\œ›ÜŠ	Ñ]™\žHXØÛÝ[[™ÈXÝ[Ûˆ]\Ý™HÙ]YÜˆ›Ý™\]Z\™Y™Y›Ü™HÛÜÝ\™K‰Ë
NÂˆBˆ]ØZ]\ÜÙ\\Ü]U[ØÐÛZ[\Ô™XYQ›ÜÛÜÝ\™JXÝ[ÛœË\T›ÝÜÊNÂˆÛÛœÝØÝ[Y[ÈH]ØZ]\ÜÙ\™\]Z\™Y\Ü]QØÝ[Y[ÊÛY[XÝ[ÛœÈ×JNÂˆÛÛœÝÝ]\ÐØ\ÙHH]ØZ]Üš]Q\Ü]UÛÜšÙ›ÝÔÝ]\ÕÔØ[\Ù›Ü˜ÙJÛY[Ø\ÙT›ÝË›Ùš[K	ÐÛÜÙY	ËÈ™\]Z\™YˆYHJNÂˆÛÛœÝ›ÝÒ\ÛÈH™]È]J
KÒTÓÔÝš[™Ê
NÂˆÛÛœÝÈ]Nˆ\]YØ\ÙK\œ›ÜˆHH]ØZ]ÛY[ˆ™œ›ÛJ	Ù\Ü]WØ™]WØØ\Ù\ÉÊBˆ\]JÂˆÛÜšÙ›Ý×ÜÝ]\Îˆ	ÐÛÜÙY	Ëˆ]\ÝÛ›ÝNˆš[˜[›ÝKˆÝ\œ™[ÜØ[\Ù›Ü˜ÙWÜÝ]\Îˆ	ÐÛÜÙY	ËˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×ÜÝ]\Îˆ	ÜÝXØÙ\ÜÉËˆØ[\Ù›Ü˜ÙWÝÜš]X˜XÚ×Ù\œ›ÜŽˆ[ˆÛÜÙYØžNˆ›Ùš[KšYˆÛÜÙYØžWÙ[XZ[ˆ›Ùš[K™[XZ[ˆÛÜÙYØ]ˆ›ÝÒ\ÛËˆ\]YØ]ˆ›ÝÒ\ÛËˆJBˆ™\J	ÚY	ËÝ]\ÐØ\ÙKšY
BˆœÙ[XÝ
TÔUWÐ‘UWÐÐTÑWÔÑSPÕ
BˆœÚ[™ÛJ
NÂˆYˆ
\œ›ÜŠH›ÝÈ\œ›ÜŽÂˆ]ØZ]Üš]Q\Ü]P™]Q]™[
ÛY[\]YØ\ÙK	ØÛÜÙY	Ë›Ùš[KÂˆ›ÝNˆš[˜[›ÝKˆJNÂˆÛÛœÝ\SX\H\Ü]T\T›ÝÓX\
\T›ÝÜÊNÂˆ™]\›ˆÂˆØ\ÙNˆÙ\šX[^™Q\Ü]P™]PØ\ÙJ\]YØ\ÙJKˆ\Y\Îˆ\T›ÝÜË›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÔ\JKˆXÝ[ÛœÎˆ
XÝ[ÛœÈ×JK›X\

][JHOˆÙ\šX[^™Q\Ü]P™]PXÝ[ÛŠ][K\SX\
JKˆØÝ[Y[ÎˆØÝ[Y[Ë›X\
Ù\šX[^™Q\Ü]UÛÜšÙ›ÝÑØÝ[Y[
KˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØ[\Ù›Ü˜ÙTÝ[Q]Z[[˜ØXÚY
›ÙK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÈÝ[RY\]\ËÚ[Øš™XÝÚ[YÚ[\]\ÈHH›ÙNÂˆYˆ
\Ý[RY
H›ÝÈ™]È\œ›ÜŠ	ÜÝ[RY™\]Z\™Y	ÊNÂ‚ˆ]XÝX[Ý[RYHÝ[RYÂˆYˆ
Ý[RY›[™ÝMJHÂˆÛÛœÝÛÚÝ\H]ØZ]]Y\žT›ÝÜÊÑSPÕY”“ÓHÝ[W×ØÈÒT‘HÙ^TÝ[W×ØÈH	ÉÙ\ØØ\TÛÜ[
Ý[RY
_IÈSRUXÈÛÙ˜Z[ˆYHJNÂˆYˆ
[ÛÚÝ\›[™Ý
H›ÝÈ™]È\œ›ÜŠÕSHÚ]Ù^TÝ[W×ØÈ	ÉÜÝ[RYIÈ›Ý›Ý[™
NÂˆXÝX[Ý[RYHÛÚÝ\ÌK’YÂˆBˆ]ØZ]™\]Z\™R[\›Ù™šXÙTÝ[PXØÙ\ÜÊXÝX[Ý[RYXØÙ\ÜÐÛÛ^
NÂ‚ˆYˆ
Ú[Øš™XÝ	‰ˆÚ[Y	‰ˆÚ[\]\È	‰ˆØš™XÝšÙ^\ÊÚ[\]\ÊK›[™Ýˆ
HÂˆ]ØZ]Ù”™\]Y\Ý
ÜÛØš™XÝËÉØÚ[Øš™XÝKÉØÚ[YXÂˆY]Ùˆ	ÔUÒ	Ëˆ›ÙNˆÚ[\]\ËˆJNÂˆBˆYˆ
\]\È	‰ˆØš™XÝšÙ^\Ê\]\ÊK›[™Ýˆ
HÂˆ]ØZ]Ù”™\]Y\Ý
ÜÛØš™XÝËÜÝ[W×ØËÉØXÝX[Ý[RYXÂˆY]Ùˆ	ÔUÒ	Ëˆ›ÙNˆ\]\ËˆJNÂˆB‚ˆÛÛœÝÜ™XÛÜ™˜]Ë[™R][\Ë^˜PÛÜÝË^Y\œ›ÚÙ\œË^Y\’[›ÚXÙ\×HH]ØZ]›ÛZ\ÙK˜[
ÂˆÙ”™\]Y\Ý
ÜÛØš™XÝËÜÝ[W×ØËÉØXÝX[Ý[RYX
K[ŠÛX[”™XÛÜ™
Kˆ]Y\žT›ÝÜÊÑSPÕY˜[YKÕSW×ØË›ÙXÝ×ØË›ÙXÝ×Ü‹“˜[YK›ÙXÝ×Ü‹‘˜[Z[KÝ\Y\—Ó˜[YW×ØË‘—ÐÛÛ\[žW×ØË]X[]W×ØË]X[]WÑ[]™\™YÔ\—Ð‘—×ØË]X[]WÓX^×ØË]X[]WÚ[—ÓU×ØË\×Ô]X[]WÔ˜[™ÙW×ØËšXÙWÔ\—Õ[š]×ØËÛÜÝÔ\—Õ[š]×ØË[š]ÔÙ[Ð]×ØË[š]Ð^WÐ]×ØË[š]ÐÛÜÝ×ØËÝXÝ[ÔÙ[Ð]×ØËÝXÝ[Ð^WÐ]×ØËÝ[ÔšXÙW×ØËÝ[ÐÛÜÝ×ØËÝ\Y\—Ò[›ÚXÙW×ØË^[Y[Õ\›W×ØË‘—Ó[X™\—×ØËØ[˜Ù[Y×ØË^Y\œ×Ðœ›ÚÙ\—×ØË^Y\—Ðœ›ÚÙ\—×ØË^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØË^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ó[\Ý[W×ØËÛÛ[Z\ÜÚ[Û—ÐÛÜÝ×ØËÝ\Y\—Ðœ›ÚÙ\—×ØËÝ\Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØËÝ\Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ó[\Ý[W×ØËÙ™™\—Ó[™WÒ][W×Ü‹•[š]šXÙKÙ™™\—Ó[™WÒ][W×Ü‹”Ý\Y\—Õ[š]ÔšXÙW×ØÈ”“ÓHÕSWÓ[™WÒ][W×ØÈÒT‘HÕSW×ØÈH	ÉØXÝX[Ý[RYIÈÔ‘Tˆ–HÜ™X]Y]HTÐØÈÛÙ˜Z[ˆYHJKˆ]Y\žT›ÝÜÊÑSPÕY˜[YK\ØÜš\[Û—×ØË›ÙXÝ’Y×ØË›ÙXÝ’Y×Ü‹“˜[YK›ÙXÝ’Y×Ü‹‘˜[Z[KÝ\Y\—Ó˜[YW×ØË]X[]W×ØË]X[]WÑ[]™\™YÔ\—Ð‘—×ØË]X[]WÚ[—ÓU×ØË]X[]WÔ˜[™ÙWÓX^×ØË\×Ô]X[]WÔ˜[™ÙW×ØË[š]ÔšXÙW×ØË[š]ÐÛÜÝ×ØË[™WÕÝ[×ØË[™WÕÝ[Ð^W×ØËÝ\Y\—Ò[›ÚXÙW×ØËÝ\Y\—Ò\ÜÝYY×ØË^[Y[Õ\›W×ØËØ[˜Ù[Y×ØÈ”“ÓHÕSWÑ^˜WÐÛÜÝ×ØÈÒT‘HÕSW×ØÈH	ÉØXÝX[Ý[RYIÈÔ‘Tˆ–HÜ™X]Y]HTÐØÈÛÙ˜Z[ˆYHJKˆ]Y\žT›ÝÜÊÑSPÕYÕSW×ØË^Y\—Ðœ›ÚÙ\—×ØË™Y˜ÛÙWÒ[™^×ØË^ÜY×ØËÛÛ[Z\ÜÚ[Û—Ó[\Ý[W×ØËÕSWÓ[™WÒ][W×Ü‹’Y”“ÓHÕSWÐ^Y\—Ðœ›ÚÙ\—×ØÈÒT‘HÕSW×ØÈH	ÉØXÝX[Ý[RYIÈÔ‘Tˆ–HÜ™X]Y]HTÐØÈÛÙ˜Z[ˆYHJKˆ]Y\žT›ÝÜÊÑSPÕY˜[YKÕSW×ØË›Ù›Ü›XW×ØË\™XØ]Y×ØË[[Ý[×ØÈ”“ÓH[›ÚXÙW×ØÈÒT‘HÕSW×ØÈH	ÉØXÝX[Ý[RYIÈÔ‘Tˆ–HÜ™X]Y]HTÐØÈÛÙ˜Z[ˆYHJKˆJNÂˆÛÛœÝÝ\Y\’[›ÚXÙRYÈHË‹‹›™]ÈÙ]
Ë‹‹›[™R][\Ë›X\

][JHOˆ][K”Ý\Y\—Ò[›ÚXÙW×ØÊK‹‹™^˜PÛÜÝË›X\

][JHOˆ][K”Ý\Y\—Ò[›ÚXÙW×ØÊWK™š[\Š\ÔØ[\Ù›Ü˜ÙRY
JWNÂˆÛÛœÝÝ\Y\’[›ÚXÙS˜[YSX\H]ØZ]˜[Y\ÐžRYÊ	ÔÝ\Y\—Ò[›ÚXÙW×ØÉËÝ\Y\’[›ÚXÙRYÊNÂˆÛÛœÝÝ\Y\’[›ÚXÙTÝ\Y\“˜[YSX\HßNÂˆ›Üˆ
ÛÛœÝ][HÙˆË‹‹›[™R][\Ë‹‹™^˜PÛÜÝ×JHÂˆYˆ
][K”Ý\Y\—Ò[›ÚXÙW×ØÈ	‰ˆ][K”Ý\Y\—Ó˜[YW×ØÈ	‰ˆ\Ý\Y\’[›ÚXÙTÝ\Y\“˜[YSX\Ú][K”Ý\Y\—Ò[›ÚXÙW×Ø×JHÂˆÝ\Y\’[›ÚXÙTÝ\Y\“˜[YSX\Ú][K”Ý\Y\—Ò[›ÚXÙW×Ø×HH][K”Ý\Y\—Ó˜[YW×ØÎÂˆBˆB‚ˆÛÛœÝœ›ÚÙ\XØÛÝ[YÈHË‹‹›™]ÈÙ]
Ë‹‹›[™R][\Ë›X\

][JHOˆ][K”Ý\Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠK‹‹›[™R][\Ë›X\

][JHOˆ][K^Y\œ×Ðœ›ÚÙ\—×ØÈ][K^Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠK‹‹˜^Y\œ›ÚÙ\œË›X\

][JHOˆ][K^Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠWJWNÂˆÛÛœÝœ›ÚÙ\XØÛÝ[X\H]ØZ]˜[Y\ÐžRYÊ	ÐXØÛÝ[	Ëœ›ÚÙ\XØÛÝ[YÊNÂˆ›Üˆ
ÛÛœÝÚY˜[YWHÙˆØš™XÝ™[šY\Êœ›ÚÙ\XØÛÝ[X\
JHœ›ÚÙ\XØÛÝ[X\ÔÝš[™ÊY
KœÛXÙJMJWHH˜[YNÂˆÛÛœÝœ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ÐžTÝ[HHZ[œ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ÊÂˆÝ[SX\ˆÈØXÝX[Ý[RYNˆ™XÛÜ™˜]ÈKˆ[™R][\Ëˆ^Y\œ›ÚÙ\œËˆXØÛÝ[X\ˆœ›ÚÙ\XØÛÝ[X\ˆJNÂˆÛÛœÝœ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ÈHœ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ÐžTÝ[VØXÝX[Ý[RYH×NÂˆÛÛœÝÝ[R\Ñ[]™\žHHH\™XÛÜ™˜]Ë‘[]™\žWÑ]W×ØÎÂˆÛÛœÝ^XX›P[[Ý[Ø[™Y]\ÈHÝ[T^XX›P[[Ý[Ø[™Y]\ÊÂˆÝ[Nˆ™XÛÜ™˜]Ëˆ[™R][\Ëˆ^˜PÛÜÝËˆJNÂ‚ˆ]Ý\Y\’[›ÚXÙT^[Y[ÈH×NÂˆ]^Y\’[›ÚXÙT^[Y[ÈH×NÂˆÛÛœÝœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[X\H™]ÈX\

NÂˆÛÛœÝ^[Y[\ØÜšX™HH]ØZ]Ø[\Ù›Ü˜ÙSØš™XÝšY[ÊÂˆØš™XÝ˜[YNˆ	Ô^[Y[×ØÉËˆJK˜Ø]Ú


HOˆ
ÈšY[Îˆ×HJJNÂˆÛÛœÝ^[Y[šY[ÈH^[Y[\ØÜšX™K™šY[È×NÂˆÛÛœÝ^[Y[šY[˜[Y\ÈH™]ÈÙ]
^[Y[šY[Ë›X\

šY[
HOˆšY[›˜[YJJNÂˆÛÛœÝ^[Y[[[Ý[šY[HÉÐ[[Ý[×ØÉË	Ô^[Y[Ð[[Ý[×ØÉË	ÔZYÐ[[Ý[×ØÉË	Ô™XÙZ]™YÐ[[Ý[×ØÉË	ÕÝ[Ð[[Ý[×ØÉË	Ð[[Ý[ÔZY×ØÉË	Ô^[Y[Õ˜[YW×ØÉË	ÐXÝX[Ð[[Ý[×ØÉ×K™š[™

šY[
HOˆ^[Y[šY[˜[Y\Ëš\ÊšY[
JNÂˆÛÛœÝ^[Y[]QšY[Hš\œÝ]˜Z[X›QšY[
^[Y[šY[˜[Y\ËÉÑ]W×ØÉË	Ô^[Y[Ñ]W×ØÉË	Ô™XÙZ]™YÑ]W×ØÉË	ÔZYÑ]W×ØÉË	ÐÜ™X]Y]I×JNÂˆÛÛœÝÝ\Y\’[›ÚXÙSÛÚÝ\šY[ÈH[˜ÛÛZ[™Ô^[Y[Ý\Y\’[›ÚXÙQšY[Ê^[Y[šY[ÊNÂˆÛÛœÝ^[Y[™Y™\™[˜ÙQšY[ÈH[˜ÛÛZ[™Ô^[Y[™Y™\™[˜ÙQšY[Ê^[Y[šY[ÊNÂˆÛÛœÝ^[Y[\™XÝ[Û‘šY[ÈH[˜ÛÛZ[™Ô^[Y[\™XÝ[Û‘šY[Ê^[Y[šY[ÊNÂˆÛÛœÝ^[Y[Ý]\ÑšY[ÈHÙ[XÝYšY[Ê^[Y[šY[˜[Y\ËÉÔÝ]\××ØÉË	Ô^[Y[ÔÝ]\××ØÉ×JNÂˆÛÛœÝ^[Y[\QšY[ÈHÙ[XÝYšY[Ê^[Y[šY[˜[Y\ËÉÕ\W×ØÉË	Ô^[Y[Õ\W×ØÉ×JNÂˆÛÛœÝ^[Y[Ù[XÝšY[ÈHÉÒY	Ë^[Y[šY[˜[Y\Ëš\Ê	Ó˜[YIÊHÈ	Ó˜[YIÈˆ[^[Y[šY[˜[Y\Ëš\Ê	Ô™XÛÜ™\RY	ÊHÈ	Ô™XÛÜ™\RY	Èˆ[^[Y[šY[˜[Y\Ëš\Ê	Ô™XÛÜ™\RY	ÊHÈ	Ô™XÛÜ™\K“˜[YIÈˆ[^[Y[šY[˜[Y\Ëš\Ê	Ô™XÛÜ™\RY	ÊHÈ	Ô™XÛÜ™\K‘]™[Ü\“˜[YIÈˆ[^[Y[šY[˜[Y\Ëš\Ê	ÔÕSW×ØÉÊHÈ	ÔÕSW×ØÉÈˆ[^[Y[šY[˜[Y\Ëš\Ê	ÐÜ™X]Y]IÊHÈ	ÐÜ™X]Y]IÈˆ[^[Y[]QšY[‹‹œÝ\Y\’[›ÚXÙSÛÚÝ\šY[Ë^[Y[[[Ý[šY[‹‹œ^[Y[™Y™\™[˜ÙQšY[Ë‹‹œ^[Y[Ý]\ÑšY[Ë‹‹œ^[Y[\QšY[Ë‹‹œ^[Y[\™XÝ[Û‘šY[×K™š[\Š›ÛÛX[ŠNÂˆÛÛœÝ^[Y[Ü™\ˆH^[Y[]QšY[È	Ü^[Y[]QšY[HTÐÈ•SÈTÕÜ™X]Y]HTÐØˆ	ÐÜ™X]Y]HTÐÉÎÂˆYˆ
^[Y[Ù[XÝšY[Ë›[™ÝˆJHÂˆÛÛœÝÙ[XÝY^[Y[šY[ÈHË‹‹›™]ÈÙ]
^[Y[Ù[XÝšY[ÊWNÂˆÛÛœÝ^[Y[]U˜[YHH
^[Y[
HOˆ
^[Y[]QšY[È^[Y[Ü^[Y[]QšY[Hˆ[
H^[Y[‘]W×ØÈ^[Y[Ü™X]Y]H[ÂˆÛÛœÝÛÜ^[Y[›ÝÜÈH
›ÝÜÊHOˆ›ÝÜËœÛÜ

KŠHOˆÝš[™Ê^[Y[]U˜[YJŠH	ÉÊK›ØØ[PÛÛ\\™JÝš[™Ê^[Y[]U˜[YJJH	ÉÊJJNÂˆÛÛœÝXÛÜ˜]T^[Y[H
^[Y[Ý\Y\’[›ÚXÙRYH[
HOˆ
Âˆ‹‹œ^[Y[ˆ]W×ØÎˆ^[Y[]U˜[YJ^[Y[
KˆÔ^[Y[Ð[[Ý[ˆ^[Y[[[Ý[šY[È^[Y[Ü^[Y[[[Ý[šY[Hˆ[ˆÔ^[Y[Ð[[Ý[ÑšY[ˆ^[Y[[[Ý[šY[[ˆÔÝ\Y\—Ò[›ÚXÙWÓ˜[YNˆÝ\Y\’[›ÚXÙRYÈÝ\Y\’[›ÚXÙS˜[YSX\ÜÝ\Y\’[›ÚXÙRYHÝ\Y\’[›ÚXÙRYˆ[ˆJNÂˆÛÛœÝÝ\Y\”^[Y[X\H™]ÈX\

NÂˆÛÛœÝ^Y\”^[Y[X\H™]ÈX\

NÂˆÛÛœÝYœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[H
^[Y[œ›ÚÙ\“X]Ú
HOˆÂˆYˆ
\^[Y[Ë’YXœ›ÚÙ\“X]Ú
H™]\›ŽÂˆÝ\Y\”^[Y[X\™[]J^[Y[’Y
NÂˆ^Y\”^[Y[X\™[]J^[Y[’Y
NÂˆYˆ
Xœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[X\š\Êœ›ÚÙ\“X]ÚšÙ^JJHÂˆœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[X\œÙ]
œ›ÚÙ\“X]ÚšÙ^KÂˆ‹‹˜œ›ÚÙ\“X]Úˆ^[Y[Îˆ×KˆJNÂˆBˆœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[X\™Ù]
œ›ÚÙ\“X]ÚšÙ^JKœ^[Y[Ëœ\Ú
XÛÜ˜]T^[Y[
^[Y[
JNÂˆNÂˆÛÛœÝYÝ\Y\”^[Y[H
^[Y[Ý\Y\’[›ÚXÙRYH[
HOˆÂˆYˆ
\^[Y[Ë’Y
H™]\›ŽÂˆÛÛœÝ[›ÚXÙRYHÝ\Y\’[›ÚXÙRY[˜ÛÛZ[™Ô^[Y[Ý\Y\’[›ÚXÙRY
^[Y[Ý\Y\’[›ÚXÙSÛÚÝ\šY[ÊNÂˆÝ\Y\”^[Y[X\œÙ]
^[Y[’YÂˆ‹‹™XÛÜ˜]T^[Y[
^[Y[[›ÚXÙRY
KˆÔÝ\Y\—Ò[›ÚXÙWÓ˜[YNˆ[›ÚXÙRYÈÝ\Y\’[›ÚXÙS˜[YSX\Ú[›ÚXÙRYH[›ÚXÙRYˆ	ÔÝ\Y\ˆ^[Y[	ËˆÔÝ\Y\—Ó˜[YNˆ[›ÚXÙRYÈÝ\Y\’[›ÚXÙTÝ\Y\“˜[YSX\Ú[›ÚXÙRYHÝ\Y\’[›ÚXÙS˜[YSX\Ú[›ÚXÙRYH[›ÚXÙRYˆ	ÔÝ\Y\ˆ^[Y[	ËˆJNÂˆNÂˆÛÛœÝY^Y\”^[Y[H
^[Y[
HOˆÂˆYˆ
\^[Y[Ë’Y
H™]\›ŽÂˆ^Y\”^[Y[X\œÙ]
^[Y[’YXÛÜ˜]T^[Y[
^[Y[
JNÂˆNÂ‚ˆYˆ
Ý\Y\’[›ÚXÙRYË›[™Ý	‰ˆÝ\Y\’[›ÚXÙSÛÚÝ\šY[Ë›[™Ý
HÂˆ]ØZ]›ÛZ\ÙK˜[
ˆÝ\Y\’[›ÚXÙSÛÚÝ\šY[Ë›X\
\Þ[˜È
šY[
HOˆÂˆÛÛœÝ^[Y[Ú[šÜÈH]ØZ]ÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ\Y\’[›ÚXÙRYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝ[“\ÝHÚ[šË›X\

Y
HOˆ	ÉÙ\ØØ\TÛÜ[
Y
_IØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕ	ÜÙ[XÝY^[Y[šY[Ëš›Ú[Š	Ë	Ê_Bˆ”“ÓH^[Y[×ØÂˆÒT‘H	ÙšY[HSˆ
	Ú[“\ÝJBˆÔ‘Tˆ–H	Ü^[Y[Ü™\ŸBˆSRUŒˆˆ[Z]ˆŒˆÛÙ˜Z[ˆYKˆNÂˆJKˆ
NÂˆ›Üˆ
ÛÛœÝ^[Y[Ùˆ^[Y[Ú[šÜË™›]

JHYÝ\Y\”^[Y[
^[Y[^[Y[ÙšY[JNÂˆJKˆ
NÂˆBˆYˆ
^[Y[šY[˜[Y\Ëš\Ê	ÔÕSW×ØÉÊJHÂˆÛÛœÝÝ[T^[Y[ÈH]ØZ]]Y\žT›ÝÜÊˆˆÑSPÕ	ÜÙ[XÝY^[Y[šY[Ëš›Ú[Š	Ë	Ê_Bˆ”“ÓH^[Y[×ØÂˆÒT‘HÕSW×ØÈH	ÉÙ\ØØ\TÛÜ[
XÝX[Ý[RY
_IÂˆÔ‘Tˆ–H	Ü^[Y[Ü™\ŸBˆSRUŒˆˆÈ[Z]ˆŒÛÙ˜Z[ˆYHKˆ
NÂˆ›Üˆ
ÛÛœÝ^[Y[ÙˆÝ[T^[Y[ÊHÂˆYˆ
[˜ÛÛZ[™Ô^[Y[\Ô™XÙZ]˜X›T™[Z][˜ÙJ^[Y[Ë‹‹œ^[Y[™Y™\™[˜ÙQšY[Ë‹‹œ^[Y[\™XÝ[Û‘šY[Ë‹‹œ^[Y[\QšY[Ë‹‹œ^[Y[Ý]\ÑšY[×JJHÛÛ[YNÂˆÛÛœÝ[[Ý[H^[Y[[[Ý[šY[È[˜ÛÛZ[™Ô^[Y[[X™\Š^[Y[Ü^[Y[[[Ý[šY[JHˆ[ÂˆÛÛœÝœ›ÚÙ\ÛÛ[Z\ÜÚ[Û“X]ÚHš[™œ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[X]Ú
^[Y[[[Ý[œ›ÚÙ\ÛÛ[Z\ÜÚ[Û‘Ü›Ý\ËË‹‹œ^[Y[™Y™\™[˜ÙQšY[Ë‹‹œ^[Y[\™XÝ[Û‘šY[Ë‹‹œ^[Y[\QšY[Ë‹‹œ^[Y[Ý]\ÑšY[×JNÂˆYˆ
œ›ÚÙ\ÛÛ[Z\ÜÚ[Û“X]Ú
HÂˆYœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[
^[Y[œ›ÚÙ\ÛÛ[Z\ÜÚ[Û“X]Ú
NÂˆÛÛ[YNÂˆBˆÛÛœÝ˜[šÐÚ\™ÙHH[˜ÛÛZ[™Ô^[Y[ÛÚÜÐ˜[šÐÚ\™ÙJ^[Y[Âˆ™Y™\™[˜ÙQšY[Îˆ^[Y[™Y™\™[˜ÙQšY[Ëˆ\™XÝ[Û‘šY[Îˆ^[Y[\™XÝ[Û‘šY[Ëˆ\QšY[Îˆ^[Y[\QšY[ËˆÝ]\ÑšY[Îˆ^[Y[Ý]\ÑšY[ËˆJNÂˆYˆ
˜[šÐÚ\™ÙJHÛÛ[YNÂˆÛÛœÝÝ\Y\”ÚYHH[˜ÛÛZ[™Ô^[Y[ÛÚÜÔÝ\Y\”ÚYJ^[Y[ÂˆÝ\Y\’[›ÚXÙQšY[ÎˆÝ\Y\’[›ÚXÙSÛÚÝ\šY[Ëˆ\™XÝ[Û‘šY[Îˆ^[Y[\™XÝ[Û‘šY[Ëˆ\QšY[Îˆ^[Y[\QšY[ËˆÝ]\ÑšY[Îˆ^[Y[Ý]\ÑšY[ËˆJNÂˆYˆ
Ý\Y\”ÚYJHÂˆYÝ\Y\”^[Y[
^[Y[
NÂˆH[ÙHYˆ
ˆ[˜ÛÛZ[™Ô^[Y[ÛÚÜÔÝ[T^XX›PØ[Ý[][ÛŠ^[Y[Âˆ[[Ý[ˆ^XX›P[[Ý[Îˆ^XX›P[[Ý[Ø[™Y]\Ëˆ™Y™\™[˜ÙQšY[Îˆ^[Y[™Y™\™[˜ÙQšY[Ëˆ\™XÝ[Û‘šY[Îˆ^[Y[\™XÝ[Û‘šY[Ëˆ\QšY[Îˆ^[Y[\QšY[ËˆÝ]\ÑšY[Îˆ^[Y[Ý]\ÑšY[Ëˆ[ÝÐ›[šÔÚYÛ˜[ˆ\Ý[R\Ñ[]™\žKˆJBˆ
HÂˆÛÛ[YNÂˆH[ÙHYˆ
[[Ý[OH[[[Ý[H
HÂˆY^Y\”^[Y[
^[Y[
NÂˆBˆBˆBˆÝ\Y\’[›ÚXÙT^[Y[ÈHÛÜ^[Y[›ÝÜÊË‹‹œÝ\Y\”^[Y[X\˜[Y\Ê
WJNÂˆ^Y\’[›ÚXÙT^[Y[ÈHÛÜ^[Y[›ÝÜÊË‹‹˜^Y\”^[Y[X\˜[Y\Ê
WJNÂˆB‚ˆÛÛœÝÝ™\ÜÙ[˜[YKÜ˜[YKYÙ[˜[YKXØÛÝ[˜[YK^Y\œ›ÚÙ\“˜[YK˜XÝÜš[™Ò[›ÚXÙS˜[YWHH]ØZ]›ÛZ\ÙK˜[
Ü™XÛÜ™˜]Ë•™\ÜÙ[×ØÈÈ™\ÛÛ™UšXT]Y\žJ	Õ™\ÜÙ[×ØÉË™XÛÜ™˜]Ë•™\ÜÙ[×ØË	Ó˜[YIÊHˆ›ÛZ\ÙKœ™\ÛÛ™J[
K™XÛÜ™˜]Ë”Ü×ØÈÈ™\ÛÛ™UšXT]Y\žJ	ÔÜ×ØÉË™XÛÜ™˜]Ë”Ü×ØË	Ó˜[YIÊHˆ›ÛZ\ÙKœ™\ÛÛ™J[
K™XÛÜ™˜]ËYÙ[×ØÈÈ™\ÛÛ™UšXT]Y\žJ	ÐXØÛÝ[	Ë™XÛÜ™˜]ËYÙ[×ØË	Ó˜[YIÊHˆ›ÛZ\ÙKœ™\ÛÛ™J[
K™XÛÜ™˜]ËXØÛÝ[×ØÈÈ™\ÛÛ™UšXT]Y\žJ	ÐXØÛÝ[	Ë™XÛÜ™˜]ËXØÛÝ[×ØË	Ó˜[YIÊHˆ›ÛZ\ÙKœ™\ÛÛ™J[
K™XÛÜ™˜]Ë^Y\—Ðœ›ÚÙ\—×ØÈÈ™\ÛÛ™UšXT]Y\žJ	ÐXØÛÝ[	Ë™XÛÜ™˜]Ë^Y\—Ðœ›ÚÙ\—×ØË	Ó˜[YIÊHˆ›ÛZ\ÙKœ™\ÛÛ™J[
K™XÛÜ™˜]Ë‘˜XÝÜš[™×Ò[›ÚXÙW×ØÈÈ™\ÛÛ™UšXT]Y\žJ	Ò[›ÚXÙW×ØÉË™XÛÜ™˜]Ë‘˜XÝÜš[™×Ò[›ÚXÙW×ØË	Ó˜[YIÊHˆ›ÛZ\ÙKœ™\ÛÛ™J[
WJNÂ‚ˆÛÛœÝ^Y\œ›ÚÙ\œÕÚ]˜[Y\ÈH]ØZ]›ÛZ\ÙK˜[
ˆ^Y\œ›ÚÙ\œË›X\
\Þ[˜È
˜ŠHOˆ
Âˆ‹‹˜˜‹ˆÐ^Y\—Ðœ›ÚÙ\—Ó˜[YNˆ˜‹^Y\—Ðœ›ÚÙ\—×ØÈÈœ›ÚÙ\XØÛÝ[X\Ø˜‹^Y\—Ðœ›ÚÙ\—×Ø×Hœ›ÚÙ\XØÛÝ[X\ÔÝš[™Ê˜‹^Y\—Ðœ›ÚÙ\—×ØÊKœÛXÙJMJWH
]ØZ]™\ÛÛ™UšXT]Y\žJ	ÐXØÛÝ[	Ë˜‹^Y\—Ðœ›ÚÙ\—×ØË	Ó˜[YIÊJHˆ[ˆJJKˆ
NÂ‚ˆÛÛœÝÝ\Y\œ›ÚÙ\’YÈHË‹‹›™]ÈÙ]
[™R][\Ë›X\

JHOˆK”Ý\Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠJWNÂˆÛÛœÝÝ\Y\œ›ÚÙ\“˜[YSX\HßNÂˆ]ØZ]›ÛZ\ÙK˜[
ˆÝ\Y\œ›ÚÙ\’YË›X\
\Þ[˜È
Y
HOˆÂˆÝ\Y\œ›ÚÙ\“˜[YSX\ÚYHHœ›ÚÙ\XØÛÝ[X\ÚYHœ›ÚÙ\XØÛÝ[X\ÔÝš[™ÊY
KœÛXÙJMJWH
]ØZ]™\ÛÛ™UšXT]Y\žJ	ÐXØÛÝ[	ËY	Ó˜[YIÊJNÂˆJKˆ
NÂ‚ˆÛÛœÝ[™R][\ÕÚ]˜[Y\ÈH[™R][\Ë›X\

JHOˆÂˆÛÛœÝØ[Ý[]Y]X[]HHš[˜[˜ÚX[]X[]JKÝ[R\Ñ[]™\žJNÂˆÛÛœÝØ[Ý[]YÙ[H[™TÙ[[[Ý[
KÝ[R\Ñ[]™\žJNÂˆÛÛœÝØ[Ý[]Y^HH[™P^P[[Ý[
KÝ[R\Ñ[]™\žJNÂˆ™]\›ˆÂˆ‹‹›KˆÑš[˜[˜ÚX[Ô]X[]NˆØ[Ý[]Y]X[]KˆÑš[˜[˜ÚX[Ô]X[]WÕ[š]ˆ	ÓU	Ëˆ‹‹Š\Ý[R\Ñ[]™\žBˆÈÂˆÝ[ÔšXÙW×ØÎˆØ[Ý[]YÙ[ˆÝ[ÐÛÜÝ×ØÎˆØ[Ý[]Y^KˆBˆˆßJKˆÔ›ÙXÝÓ˜[YNˆVÉÔ›ÙXÝ×Ü‰×OË“˜[YHÏÈ[ˆÔÝ\Y\—Ðœ›ÚÙ\—Ó˜[YNˆK”Ý\Y\—Ðœ›ÚÙ\—×ØÈÈÝ\Y\œ›ÚÙ\“˜[YSX\ÛK”Ý\Y\—Ðœ›ÚÙ\—×Ø×Hˆ[ˆNÂˆJNÂˆÛÛœÝ^˜PÛÜÝÕÚ]˜[Y\ÈH^˜PÛÜÝË›X\

XÊHOˆÂˆÛÛœÝØ[Ý[]Y]X[]HHš[˜[˜ÚX[]X[]JXËÝ[R\Ñ[]™\žK	Ô]X[]WÔ˜[™ÙWÓX^×ØÉÊNÂˆÛÛœÝØ[Ý[]YÙ[H^˜TÙ[[[Ý[
XËÝ[R\Ñ[]™\žJNÂˆÛÛœÝØ[Ý[]Y^HH^˜P^P[[Ý[
XËÝ[R\Ñ[]™\žJNÂˆ™]\›ˆÂˆ‹‹™XËˆÑš[˜[˜ÚX[Ô]X[]NˆØ[Ý[]Y]X[]KˆÑš[˜[˜ÚX[Ô]X[]WÕ[š]ˆ	ÓU	Ëˆ‹‹Š\Ý[R\Ñ[]™\žBˆÈÂˆ[™WÕÝ[×ØÎˆØ[Ý[]YÙ[ˆ[™WÕÝ[Ð^W×ØÎˆØ[Ý[]Y^KˆBˆˆßJKˆÔ›ÙXÝÓ˜[YNˆXÖÉÔ›ÙXÝ’Y×Ü‰×OË“˜[YHÏÈ[ˆNÂˆJNÂˆÛÛœÝØ[Ý[]Y[™R][TÙ[H[™R][\Ëœ™YXÙJ
Ý[KJHOˆÂˆYˆ
KØ[˜Ù[Y×ØÊH™]\›ˆÝ[NÂˆ™]\›ˆÝ[H
È[™TÙ[[[Ý[
KÝ[R\Ñ[]™\žJNÂˆK
NÂˆÛÛœÝØ[Ý[]Y^˜PÛÜÝÙ[H^˜PÛÜÝËœ™YXÙJ
Ý[KXÊHOˆÂˆYˆ
XËØ[˜Ù[Y×ØÊH™]\›ˆÝ[NÂˆ™]\›ˆÝ[H
È^˜TÙ[[[Ý[
XËÝ[R\Ñ[]™\žJNÂˆK
NÂˆÛÛœÝØ[Ý[]Y[™]Y^Y\’[›ÚXÙHHØ[Ý[]Y[™R][TÙ[
ÈØ[Ý[]Y^˜PÛÜÝÙ[ÂˆÛÛœÝ^Y\’[›ÚXÙT™\ÛÛ][ÛˆH™\ÛÛ™P^Y\‘š[˜[˜ÚX[[[Ý[
ÈØ[\Ù›Ü˜ÙP[[Ý[ˆ™XÛÜ™˜]Ë•Ý[Ò[›ÚXÙWÐ[[Ý[×ØËØ[Ý[]Y[[Ý[ˆØ[Ý[]Y[™]Y^Y\’[›ÚXÙKš[˜[[›ÚXÙR\ÜÝYYˆ^Y\’[›ÚXÙ\ËœÛÛYJ\Ñš[˜[^Y\’[›ÚXÙJHJNÂˆÛÛœÝØ[Ý[]YÝ\Y\’[›ÚXÙHH^XX›P[[Ý[Ø[™Y]\ÖÌHÏÈÂˆÛÛœÝ™XÛÜ™HÂˆ‹‹œ™XÛÜ™˜]ËˆÝ[Ò[›ÚXÙWÐ[[Ý[×ØÎˆ^Y\’[›ÚXÙT™\ÛÛ][Û‹˜[[Ý[ˆÐ^Y\—Ò[›ÚXÙWÐ[[Ý[ÔÛÝ\˜ÙNˆ^Y\’[›ÚXÙT™\ÛÛ][Û‹œÛÝ\˜ÙKˆÐ^Y\—Ò[›ÚXÙWÒ\ÜÝYYˆ^Y\’[›ÚXÙ\ËœÛÛYJ\Ñš[˜[^Y\’[›ÚXÙJKˆÔÝ\Y\—Ò[›ÚXÙWÐ[[Ý[ˆØ[Ý[]YÝ\Y\’[›ÚXÙKˆÐ^Y\—Ô^WÕ\›WÑ]NˆØ[Ý[]Y^Y\”^U\›Q]J™XÛÜ™˜]ÊH™XÛÜ™˜]Ë’[›ÚXÙWÑYWÑ]W×ØÈ™XÛÜ™˜]Ë^Y\—Ô^WÕ\›WÑ]W×ØËˆÐ^Y\—Ó˜[YNˆ™XÛÜ™˜]Ë^Y\—Ó˜[YW×ØÈXØÛÝ[˜[YH™XÛÜ™˜]Ë^Y\—×ØÈ[ˆÕ™\ÜÙ[Ó˜[YNˆ™\ÜÙ[˜[YKˆÔÜÓ˜[YNˆÜ˜[YKˆÐYÙ[Ó˜[YNˆYÙ[˜[YKˆÐXØÛÝ[Ó˜[YNˆXØÛÝ[˜[YKˆÐ^Y\—Ðœ›ÚÙ\—Ó˜[YNˆ^Y\œ›ÚÙ\“˜[YKˆÑ˜XÝÜš[™×Ò[›ÚXÙWÓ˜[YNˆ˜XÝÜš[™Ò[›ÚXÙS˜[YKˆNÂ‚ˆ™]\›ˆÂˆ™XÛÜ™ˆ[™R][\Îˆ[™R][\ÕÚ]˜[Y\Ëˆ^˜PÛÜÝÎˆ^˜PÛÜÝÕÚ]˜[Y\Ëˆ^Y\œ›ÚÙ\œÎˆ^Y\œ›ÚÙ\œÕÚ]˜[Y\ËˆÝ\Y\’[›ÚXÙT^[Y[Ëˆ^Y\’[›ÚXÙT^[Y[Ëˆœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[ÎˆË‹‹˜œ›ÚÙ\ÛÛ[Z\ÜÚ[Û”^[Y[X\˜[Y\Ê
WK›X\

Ü›Ý\
HOˆ
Âˆ‹‹™Ü›Ý\ˆ^[Y[ÎˆÜ›Ý\œ^[Y[ËœÛÜ

KŠHOˆÝš[™Ê‹‘]W×ØÈ	ÉÊK›ØØ[PÛÛ\\™JÝš[™ÊK‘]W×ØÈ	ÉÊJJKˆJJKˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØ[\Ù›Ü˜ÙTÝ[Q]Z[[
›ÙK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝ\ÕÜš]HH›ÛÛX[Š
›ÙOË\]\È	‰ˆØš™XÝšÙ^\Ê›ÙK\]\ÊK›[™Ý
H
›ÙOË˜Ú[\]\È	‰ˆØš™XÝšÙ^\Ê›ÙK˜Ú[\]\ÊK›[™Ý
JNÂˆYˆ
\ÕÜš]JH™]\›ˆØ[\Ù›Ü˜ÙTÝ[Q]Z[[˜ØXÚY
›ÙK™\KXØÙ\ÜÐÛÛ^
NÂˆÛÛœÝÝ[RYHÝš[™Ê›ÙOËœÝ[RY	ÉÊKš[J
NÂˆÛÛœÝØXÚYH]ØZ]ØXÚYØ[\Ù›Ü˜ÙU˜[YJÂˆ˜[Y\ÜXÙNˆ	ÜØ[\Ù›Ü˜ÙK\Ý[KY]Z[]Œ‰ËˆÙXÛÛ™ÎˆMKˆ^[ØYˆÈÝ[RYKˆYÜÎˆÉÜØ[\Ù›Ü˜ÙNœÝ[IËØ[\Ù›Ü˜ÙNœÝ[N‰ÜÝ[RYXKˆ›ÙKˆ™\KˆXØÙ\ÜÐÛÛ^ˆØY\Žˆ

HOˆØ[\Ù›Ü˜ÙTÝ[Q]Z[[˜ØXÚY
ÈÝ[RYK™\KXØÙ\ÜÐÛÛ^
KˆJNÂˆ™]\›ˆØXÚY˜[YNÂŸB‚™[˜Ý[Ûˆ[š\]YT™\Ù[˜[Y\Ê˜[Y\ÊHÂˆ™]\›ˆË‹‹›™]ÈÙ]
˜[Y\Ë™š[\Š
˜[YJHOˆ˜[YHOH[	‰ˆ˜[YHOOH	ÉÊJWNÂŸB‚™[˜Ý[ÛˆÚ[™ÛSÜ“Z^Y
˜[Y\ÊHÂˆÛÛœÝ[š\]YHH[š\]YT™\Ù[˜[Y\Ê˜[Y\ÊNÂˆYˆ
][š\]YK›[™Ý
H™]\›ˆ[Âˆ™]\›ˆ[š\]YK›[™ÝOOHHÈ[š\]YVÌHˆ	ÓZ^Y	ÎÂŸB‚™[˜Ý[Ûˆ]\Ý\ÛÑ]J˜[Y\ÊHÂˆÛÛœÝ]\ÈH[š\]YT™\Ù[˜[Y\Ê˜[Y\ÊK™š[\Š
˜[YJHOˆ×—ÍKWÌŸKWÌŸKË\Ý
Ýš[™Ê˜[YJJJNÂˆ™]\›ˆ]\ËœÛÜ

K˜]
LJH[ÂŸB‚™[˜Ý[ÛˆYœ›ÚÙ\”›ÙXÝ]X[]JÜ›Ý\›ÝÊHÂˆÛÛœÝ›ÙXÝ˜[YHH›ÝËœ›ÙXÝ˜[Z[H›ÝËœ›ÙXÝ˜[YH	ø %	ÎÂˆÛÛœÝ[š]H›ÝËœ]X[]U[š]	ÕSÓH›ÝÙ]	ÎÂˆÛÛœÝÙ^HH	Ü›ÙXÝ˜[Y_NŽ‰Ý[š]XÂˆYˆ
YÜ›Ý\—Ü›ÙXÝX\š\ÊÙ^JJHÂˆÜ›Ý\—Ü›ÙXÝX\œÙ]
Ù^KÂˆ›ÙXÝ˜[YKˆ›ÙXÝ˜[Z[Nˆ›ÝËœ›ÙXÝ˜[Z[H›ÙXÝ˜[YKˆ]X[]Nˆˆ\Ô]X[]Nˆ˜[ÙKˆ[š]ˆJNÂˆBˆÛÛœÝ][HHÜ›Ý\—Ü›ÙXÝX\™Ù]
Ù^JNÂˆÛÛœÝ]HH[Y\šXÕ˜[YJ›ÝË˜™”]X[]JNÂˆYˆ
]HOH[
HÂˆ][Kœ]X[]H
ÏH]NÂˆ][Kš\Ô]X[]HHYNÂˆBŸB‚™[˜Ý[ÛˆÛÛXš[™Pœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”›ÝÜÊ›ÝÜÊHÂˆÛÛœÝÜ›Ý\ÈH™]ÈX\

NÂˆ›Üˆ
ÛÛœÝ›ÝÈÙˆ›ÝÜÊHÂˆÛÛœÝœ›ÚÙ\’Ù^HH›ÝË˜œ›ÚÙ\’Y›ÝË˜œ›ÚÙ\“˜[YH	ÉÎÂˆÛÛœÝÙ^HHÜ›ÝËœÝ[RY›ÝË˜œ›ÚÙ\•\Kœ›ÚÙ\’Ù^WKš›Ú[Š	ÎŽ‰ÊNÂˆYˆ
YÜ›Ý\Ëš\ÊÙ^JJHÂˆÜ›Ý\ËœÙ]
Ù^KÂˆ‹‹œ›ÝËˆYˆ	Ü›ÝË˜œ›ÚÙ\•\_KIÜ›ÝËœÝ[RYKIØœ›ÚÙ\’Ù^_Xœ™\XÙJ×ÊËÙË	ËIÊKˆÛÛ[Z\ÜÚ[Û[[Ý[ˆˆÜ›ÙXÝX\ˆ™]ÈX\

KˆØÛÛ[Z\ÜÚ[Û•[š]šXÙ\Îˆ×KˆØÛÛ[Z\ÜÚ[Û•[š][™\Îˆ×KˆÜ^[Y[]\Îˆ×KˆÜ^[Y[]SX™[Îˆ×KˆÜ^[Y[[^\Îˆ×KˆJNÂˆBˆÛÛœÝÜ›Ý\HÜ›Ý\Ë™Ù]
Ù^JNÂˆÜ›Ý\˜ÛÛ[Z\ÜÚ[Û[[Ý[
ÏH[X™\Š›ÝË˜ÛÛ[Z\ÜÚ[Û[[Ý[
NÂˆYˆ
›ÝË˜ÛÛ[Z\ÜÚ[Û•[š]šXÙHOH[
HÜ›Ý\—ØÛÛ[Z\ÜÚ[Û•[š]šXÙ\Ëœ\Ú
[X™\Š›ÝË˜ÛÛ[Z\ÜÚ[Û•[š]šXÙJJNÂˆÜ›Ý\—ØÛÛ[Z\ÜÚ[Û•[š][™\Ëœ\Ú
Âˆ›ÙXÝ˜[YNˆ›ÝËœ›ÙXÝ˜[Z[H›ÝËœ›ÙXÝ˜[YH	ø %	Ëˆ˜[YNˆ[Y\šXÕ˜[YJ›ÝË˜ÛÛ[Z\ÜÚ[Û•[š]šXÙJKˆ[š]ˆ›ÝËœ]X[]U[š]	ÕSÓH›ÝÙ]	ËˆJNÂˆYˆ
›ÝËœ^[Y[]JHÜ›Ý\—Ü^[Y[]\Ëœ\Ú
›ÝËœ^[Y[]JNÂˆYˆ
›ÝËœ^[Y[]SX™[
HÜ›Ý\—Ü^[Y[]SX™[Ëœ\Ú
›ÝËœ^[Y[]SX™[
NÂˆYˆ
›ÝËœ^[Y[[^HOH[
HÜ›Ý\—Ü^[Y[[^\Ëœ\Ú
[X™\Š›ÝËœ^[Y[[^JJNÂˆYœ›ÚÙ\”›ÙXÝ]X[]JÜ›Ý\›ÝÊNÂˆB‚ˆ™]\›ˆË‹‹™Ü›Ý\Ë˜[Y\Ê
WK›X\

Ü›Ý\
HOˆÂˆÛÛœÝ[š]šXÙ\ÈH[š\]YT™\Ù[˜[Y\ÊÜ›Ý\—ØÛÛ[Z\ÜÚ[Û•[š]šXÙ\ÊNÂˆÛÛœÝ^[Y[]\ÈH[š\]YT™\Ù[˜[Y\ÊÜ›Ý\—Ü^[Y[]\ÊNÂˆÛÛœÝ^[Y[[^\ÈH[š\]YT™\Ù[˜[Y\ÊÜ›Ý\—Ü^[Y[[^\ÊNÂˆÛÛœÝÛÛ[Z\ÜÚ[Û•[š]šXÙS[™\ÈHÜ›Ý\—ØÛÛ[Z\ÜÚ[Û•[š][™\Ë›X\

][JHOˆ
Âˆ›ÙXÝ˜[YNˆ][Kœ›ÙXÝ˜[YKˆ˜[YNˆ][K˜[YKˆ[š]ˆ][K[š]ˆX™[ˆ][K˜[YHOH[È	Û[Û™^J][K˜[YJ_HÈ	Ú][K[š]Xˆ	ø %	ËˆJJNÂˆÛÛœÝ›ÙXÝ]X[]Y\ÈHË‹‹™Ü›Ý\—Ü›ÙXÝX\˜[Y\Ê
WK›X\

][JHOˆ
Âˆ›ÙXÝ˜[YNˆ][Kœ›ÙXÝ˜[YKˆ›ÙXÝ˜[Z[Nˆ][Kœ›ÙXÝ˜[Z[H][Kœ›ÙXÝ˜[YKˆ]X[]Nˆ][Kš\Ô]X[]HÈ][Kœ]X[]Hˆ[ˆ]X[]U[š]ˆ][K[š]ˆX™[ˆ][Kš\Ô]X[]HÈ	Ú][Kœ›ÙXÝ˜[Y_HH	Ù›Ü›X]]X[]SX™[
][Kœ]X[]K][K[š]
_Xˆ][Kœ›ÙXÝ˜[YKˆJJNÂˆ™]\›ˆÂˆ‹‹™Ü›Ý\ˆ›ÙXÝ˜[YNˆ›ÙXÝ]X[]Y\Ë›X\

][JHOˆ][Kœ›ÙXÝ˜[YJKš›Ú[Š	ÎÈ	ÊKˆ™”]X[]Nˆ›ÙXÝ]X[]Y\Ë›[™ÝOOHHÈ›ÙXÝ]X[]Y\ÖÌKœ]X[]Hˆ[ˆ]X[]U[š]ˆ›ÙXÝ]X[]Y\Ë›[™ÝOOHHÈ›ÙXÝ]X[]Y\ÖÌKœ]X[]U[š]ˆ	ÓZ^Y	Ëˆ›ÙXÝ]X[]Y\Ëˆ›ÙXÝ]X[]SX™[ˆ›ÙXÝ]X[]Y\Ë›X\

][JHOˆ][K›X™[
Kš›Ú[Š	ÎÈ	ÊKˆÛÛ[Z\ÜÚ[Û•[š]šXÙNˆ[š]šXÙ\Ë›[™ÝOOHHÈ[š]šXÙ\ÖÌHˆ[ˆÛÛ[Z\ÜÚ[Û•[š]šXÙS[™\ËˆÛÛ[Z\ÜÚ[Û•[š]šXÙSX™[ˆÛÛ[Z\ÜÚ[Û•[š]šXÙS[™\Ë›X\

][JHOˆ][K›X™[
Kš›Ú[Š	ÎÈ	ÊKˆ^[Y[]Nˆ^[Y[]\Ë›[™ÝHHÈ^[Y[]\ÖÌH[ˆ	ÓZ^Y	Ëˆ^[Y[]TÛÜˆ]\Ý\ÛÑ]J^[Y[]\ÊKˆ^[Y[]SX™[ˆÚ[™ÛSÜ“Z^Y
Ü›Ý\—Ü^[Y[]SX™[ÊHÜ›Ý\œ^[Y[]SX™[ˆ^[Y[[^Nˆ^[Y[[^\Ë›[™ÝOOHHÈ^[Y[[^\ÖÌHˆ[ˆ^[Y[[^SX™[ˆ^[Y[[^\Ë›[™ÝˆHÈ	ÓZ^Y	Èˆ[ˆÜ›ÙXÝX\ˆ[™Yš[™YˆØÛÛ[Z\ÜÚ[Û•[š]šXÙ\Îˆ[™Yš[™YˆØÛÛ[Z\ÜÚ[Û•[š][™\Îˆ[™Yš[™YˆÜ^[Y[]\Îˆ[™Yš[™YˆÜ^[Y[]SX™[Îˆ[™Yš[™YˆÜ^[Y[[^\Îˆ[™Yš[™YˆNÂˆJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØ[\Ù›Ü˜ÙPœ›ÚÙ\”™YÚ\Ý\•[˜ØXÚY
›ÙK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝ[Z]HX]›Z[Š[X™\Š›ÙK›[Z]
HŒÌ
NÂˆÛÛœÝÛ[™R][Q\ØÜšX™K›ÙXÝ\ØÜšX™WHH]ØZ]›ÛZ\ÙK˜[
ÂˆØ[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	ÔÕSWÓ[™WÒ][W×ØÉÈJK˜Ø]Ú


HOˆ
ÈšY[Îˆ×HJJKˆØ[\Ù›Ü˜ÙSØš™XÝšY[ÊÈØš™XÝ˜[YNˆ	Ô›ÙXÝ‰ÈJK˜Ø]Ú


HOˆ
ÈšY[Îˆ×HJJKˆJNÂˆÛÛœÝ[™R][U[ÛQšY[Hš[™\Ú›Ø\™[ÛQšY[
[™R][Q\ØÜšX™K™šY[È×K	Û[™R][IÊNÂˆÛÛœÝ›ÙXÝ[ÛQšY[Hš[™\Ú›Ø\™[ÛQšY[
›ÙXÝ\ØÜšX™K™šY[È×K	Ü›ÙXÝ	ÊNÂˆÛÛœÝ˜]]™U[ÛTÙ[XÝHÂˆ[™R][U[ÛQšY[ˆ›ÙXÝ[ÛQšY[È›ÙXÝ×Ü‹‰Ü›ÙXÝ[ÛQšY[Xˆ[ˆK™š[\Š›ÛÛX[ŠNÂˆÛÛœÝ[\›Ù™šXÙPÛÛ™][ÛˆH]ØZ][\›Ù™šXÙTÝ[PXØÙ\ÜÐÛÛ™][ÛŠXØÙ\ÜÐÛÛ^
NÂˆÛÛœÝÚ\™PÛ]\ÙHH[\›Ù™šXÙPÛÛ™][ÛˆÈÒT‘H	Ú[\›Ù™šXÙPÛÛ™][ÛŸXˆ	ÉÎÂˆÛÛœÝÝ[\ÈH]ØZ]]Y\žT›ÝÜÊˆˆÑSPÕY˜[YK[]™\žWÑ]W×ØË^[Y[Ñ]W×ØË^Y\—Ô^WÕ\›WÑ]W×ØÂˆ”“ÓHÝ[W×ØÂˆ	ÝÚ\™PÛ]\Ù_BˆÔ‘Tˆ–H[]™\žWÑ]W×ØÈTÐÈ•SÈTÕˆSRU	Û[Z]BˆˆÈ[Z]Kˆ
NÂˆÛÛœÝÝ[SX\HØš™XÝ™œ›ÛQ[šY\ÊÝ[\Ë›X\

Ý[JHOˆÜÝ[K’YÝ[WJJNÂˆÛÛœÝÝ[RYÈHÝ[\Ë›X\

Ý[JHOˆÝ[K’Y
NÂˆYˆ
\Ý[RYË›[™Ý
H™]\›ˆÈ›ÝÜÎˆ×HNÂ‚ˆÛÛœÝÝ[PÚ[šÜÈHÚ[šÒYÊÝ[RYÊNÂˆÛÛœÝÛ[™R][PÚ[šÜË^Y\œ›ÚÙ\Ú[šÜË^Y\”^[Y[Ú[šÜË^Y\’[›ÚXÙPÚ[šÜ×HH]ØZ]›ÛZ\ÙK˜[
ÂˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÝ[PÚ[šÜË›X\

Ú[šÊHOˆÂˆÛÛœÝYÈHÚ[šË›X\

Y
HOˆ	ÉÚYIØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕ	ÖÉÒY	Ë	Ó˜[YIË	ÔÕSW×ØÉË	Ô›ÙXÝ×Ü‹“˜[YIË	Ô›ÙXÝ×Ü‹‘˜[Z[IË	ÔÝ\Y\—Ò[›ÚXÙW×ØÉËˆ‹‹›˜]]™U[ÛTÙ[XÝˆKš›Ú[Š	Ë	Ê_KˆÝ\Y\—Ðœ›ÚÙ\—×ØËÝ\Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØËˆ]X[]WÑ[]™\™YÔ\—Ð‘—×ØË]X[]W×ØË]X[]WÚ[—ÓU×ØËÛÛ[Z\ÜÚ[Û—ÐÛÜÝ×ØËØ[˜Ù[Y×ØËˆ^Y\œ×Ðœ›ÚÙ\—×ØË^Y\—Ðœ›ÚÙ\—×ØË^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØËˆ^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ó[\Ý[W×ØÂˆ”“ÓHÕSWÓ[™WÒ][W×ØÂˆÒT‘HÕSW×ØÈSˆ
	ÚYßJBˆSRULˆˆ[Z]ˆLˆNÂˆJKˆ
KˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÝ[PÚ[šÜË›X\

Ú[šÊHOˆÂˆÛÛœÝYÈHÚ[šË›X\

Y
HOˆ	ÉÚYIØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕY˜[YKÕSW×ØË^Y\—Ðœ›ÚÙ\—×ØÂˆ”“ÓHÕSWÐ^Y\—Ðœ›ÚÙ\—×ØÂˆÒT‘HÕSW×ØÈSˆ
	ÚYßJBˆSRULˆˆ[Z]ˆLˆNÂˆJKˆ
KˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÝ[PÚ[šÜË›X\

Ú[šÊHOˆÂˆÛÛœÝYÈHÚ[šË›X\

Y
HOˆ	ÉÚYIØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕÕSW×ØË]W×ØÂˆ”“ÓH^[Y[×ØÂˆÒT‘HÕSW×ØÈSˆ
	ÚYßJHS‘Ý\Y\—Ò[›ÚXÙW×ØÈH[ˆÔ‘Tˆ–H]W×ØÈTÐÂˆSRULˆˆ[Z]ˆLˆNÂˆJKˆ
KˆÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÝ[PÚ[šÜË›X\

Ú[šÊHOˆÂˆÛÛœÝYÈHÚ[šË›X\

Y
HOˆ	ÉÚYIØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆÂˆÛÜ[ˆˆÑSPÕÕSW×ØË[›ÚXÙWÑYWÑ]W×ØÂˆ”“ÓH[›ÚXÙW×ØÂˆÒT‘HÕSW×ØÈSˆ
	ÚYßJBˆÔ‘Tˆ–H[›ÚXÙWÑYWÑ]W×ØÈTÐÂˆSRULˆˆ[Z]ˆLˆNÂˆJKˆ
KˆJNÂ‚ˆÛÛœÝ[™R][\ÈH[™R][PÚ[šÜË™›]

NÂˆÛÛœÝ^Y\œ›ÚÙ\œÈH^Y\œ›ÚÙ\Ú[šÜË™›]

NÂˆÛÛœÝ^Y\”^[Y[ÈH^Y\”^[Y[Ú[šÜË™›]

NÂˆÛÛœÝ^Y\’[›ÚXÙ\ÈH^Y\’[›ÚXÙPÚ[šÜË™›]

NÂˆÛÛœÝXØÛÝ[YÈHË‹‹›™]ÈÙ]
Ë‹‹›[™R][\Ë›X\

][JHOˆ][K”Ý\Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠK‹‹›[™R][\Ë›X\

][JHOˆ][K^Y\œ×Ðœ›ÚÙ\—×ØÈ][K^Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠK‹‹˜^Y\œ›ÚÙ\œË›X\

][JHOˆ][K^Y\—Ðœ›ÚÙ\—×ØÊK™š[\Š›ÛÛX[ŠWJWNÂ‚ˆÛÛœÝXØÛÝ[Ú[šÜÈH]ØZ]ÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊXØÛÝ[YÊK›X\

Ú[šÊHOˆÂˆÛÛœÝYÈHÚ[šË›X\

Y
HOˆ	ÉÚYIØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆYÂˆÈÂˆÛÜ[ˆÑSPÕY˜[YKY[—Ðœ›ÚÙ\—×ØËY[—Ðœ›ÚÙ\—ÐÛÛ\[žW×ØÈ”“ÓHXØÛÝ[ÒT‘HYSˆ
	ÚYßJHS‘[˜XÝ]™WÔÝ\Ü[™Y×ØÈH˜[ÙXˆÛÙ˜Z[ˆYKˆBˆˆ[ÂˆJKˆ
NÂˆÛÛœÝXØÛÝ[X\HßNÂˆÛÛœÝXØÛÝ[›YÓX\HßNÂˆ›Üˆ
ÛÛœÝXØÛÝ[ÙˆXØÛÝ[Ú[šÜË™›]

JHÂˆÛÛœÝ›YÜÈHÂˆY[œ›ÚÙ\’[™]šYX[ˆXØÛÝ[’Y[—Ðœ›ÚÙ\—×ØÈOOHYKˆY[œ›ÚÙ\ÛÛ\[žNˆXØÛÝ[’Y[—Ðœ›ÚÙ\—ÐÛÛ\[žW×ØÈOOHYKˆNÂˆXØÛÝ[X\ØXØÛÝ[’YHHXØÛÝ[“˜[YNÂˆXØÛÝ[X\ÔÝš[™ÊXØÛÝ[’Y
KœÛXÙJMJWHHXØÛÝ[“˜[YNÂˆXØÛÝ[›YÓX\ØXØÛÝ[’YHH›YÜÎÂˆXØÛÝ[›YÓX\ÔÝš[™ÊXØÛÝ[’Y
KœÛXÙJMJWHH›YÜÎÂˆB‚ˆÛÛœÝÝ\Y\’[›ÚXÙRYÈHË‹‹›™]ÈÙ]
[™R][\Ë›X\

][JHOˆ][K”Ý\Y\—Ò[›ÚXÙW×ØÊK™š[\Š›ÛÛX[ŠJWNÂˆÛÛœÝ^[Y[]PžR[›ÚXÙHHßNÂˆÛÛœÝ^[Y[Ú[šÜÈH]ØZ]ÛÛ\ÜÚ]T]Y\žT›ÝÜÊˆÚ[šÒYÊÝ\Y\’[›ÚXÙRYÊK›X\

Ú[šÊHOˆÂˆÛÛœÝYÈHÚ[šË›X\

Y
HOˆ	ÉÚYIØ
Kš›Ú[Š	Ë	ÊNÂˆ™]\›ˆYÂˆÈÂˆÛÜ[ˆÑSPÕÝ\Y\—Ò[›ÚXÙW×ØË]W×ØÈ”“ÓH^[Y[×ØÈÒT‘HÝ\Y\—Ò[›ÚXÙW×ØÈSˆ
	ÚYßJHÔ‘Tˆ–H]W×ØÈTÐØˆÛÙ˜Z[ˆYKˆBˆˆ[ÂˆJKˆ
NÂˆ›Üˆ
ÛÛœÝ^[Y[Ùˆ^[Y[Ú[šÜË™›]

JHÂˆYˆ
^[Y[”Ý\Y\—Ò[›ÚXÙW×ØÈ	‰ˆ\^[Y[]PžR[›ÚXÙVÜ^[Y[”Ý\Y\—Ò[›ÚXÙW×Ø×JH^[Y[]PžR[›ÚXÙVÜ^[Y[”Ý\Y\—Ò[›ÚXÙW×Ø×HH^[Y[‘]W×ØÎÂˆB‚ˆÛÛœÝ^Y\”^[Y[]PžTÝ[HHßNÂˆ›Üˆ
ÛÛœÝ^[Y[Ùˆ^Y\”^[Y[ÊHÂˆYˆ
^[Y[”ÕSW×ØÈ	‰ˆX^Y\”^[Y[]PžTÝ[VÜ^[Y[”ÕSW×Ø×JH^Y\”^[Y[]PžTÝ[VÜ^[Y[”ÕSW×Ø×HH^[Y[‘]W×ØÎÂˆBˆÛÛœÝ^Y\’[›ÚXÙQYQ]PžTÝ[HHßNÂˆ›Üˆ
ÛÛœÝ[›ÚXÙHÙˆ^Y\’[›ÚXÙ\ÊHÂˆYˆ
[›ÚXÙK”ÕSW×ØÈ	‰ˆX^Y\’[›ÚXÙQYQ]PžTÝ[VÚ[›ÚXÙK”ÕSW×Ø×JH^Y\’[›ÚXÙQYQ]PžTÝ[VÚ[›ÚXÙK”ÕSW×Ø×HH[›ÚXÙK’[›ÚXÙWÑYWÑ]W×ØÎÂˆB‚ˆÛÛœÝ^Y\œ›ÚÙ\œÐžTÝ[HHßNÂˆ›Üˆ
ÛÛœÝ][HÙˆ^Y\œ›ÚÙ\œÊHÂˆYˆ
Z][K”ÕSW×ØÊHÛÛ[YNÂˆYˆ
X^Y\œ›ÚÙ\œÐžTÝ[VÚ][K”ÕSW×Ø×JH^Y\œ›ÚÙ\œÐžTÝ[VÚ][K”ÕSW×Ø×HH×NÂˆ^Y\œ›ÚÙ\œÐžTÝ[VÚ][K”ÕSW×Ø×Kœ\Ú
][JNÂˆB‚ˆÛÛœÝ˜]Ô›ÝÜÈH×NÂˆÛÛœÝš[˜[˜ÚX[Ø\›š[™ÜÈH™]ÈÙ]

NÂˆ›Üˆ
ÛÛœÝ][HÙˆ[™R][\ÊHÂˆÛÛœÝÝ[HHÝ[SX\Ú][K”ÕSW×Ø×NÂˆYˆ
\Ý[JHÛÛ[YNÂˆÛÛœÝ˜]]™T]X[]HH˜]]™Qš[˜[˜ÚX[]X[]J][KÂˆÝ[R\Ñ[]™\žNˆH\Ý[K‘[]™\žWÑ]W×ØËˆ[™R][U[ÛQšY[ˆ›ÙXÝ[ÛQšY[ˆJNÂˆÛÛœÝ]HH˜]]™T]X[]Kœ]X[]NÂˆÛÛœÝ]X[]U[š]H˜]]™T]X[]K[š]Ù“YX\Ý\™H	ÕSÓH›ÝÙ]	ÎÂˆYˆ
˜]]™T]X[]KØ\›š[™ÊHš[˜[˜ÚX[Ø\›š[™ÜË˜Y
	ÜÝ[K“˜[YH	ÔÕSIßH0­È	Ú][K“˜[YH][K’YNˆ	Û˜]]™T]X[]KØ\›š[™ßX
NÂˆÛÛœÝÝ\Y\[[Ý[H][KØ[˜Ù[Y×ØÈÈˆœ›ÚÙ\[[Ý[
][K”Ý\Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØË]JNÂˆYˆ
][K”Ý\Y\—Ðœ›ÚÙ\—×ØÈ	‰ˆÝ\Y\[[Ý[OOH
HÂˆ˜]Ô›ÝÜËœ\Ú
ÂˆYˆÝ\Y\‹IÚ][K’YXˆÝ[RYˆ][K”ÕSW×ØËˆÝ[S˜[YNˆÝ[K“˜[YKˆœ›ÚÙ\’Yˆ][K”Ý\Y\—Ðœ›ÚÙ\—×ØËˆ›ÙXÝ˜[YNˆ][VÉÔ›ÙXÝ×Ü‰×OË“˜[YH][K“˜[YH	ø %	Ëˆ›ÙXÝ˜[Z[Nˆ][VÉÔ›ÙXÝ×Ü‰×OË‘˜[Z[H][VÉÔ›ÙXÝ×Ü‰×OË“˜[YH][K“˜[YH	ø %	Ëˆ™”]X[]Nˆ]H[ˆ]X[]U[š]ˆ[]™\žQ]NˆÝ[K‘[]™\žWÑ]W×ØËˆœ›ÚÙ\•\Nˆ	ÔÝ\Y\ˆœ›ÚÙ\‰Ëˆœ›ÚÙ\“˜[YNˆXØÛÝ[X\Ú][K”Ý\Y\—Ðœ›ÚÙ\—×Ø×H][K”Ý\Y\—Ðœ›ÚÙ\—×ØËˆY[œ›ÚÙ\’[™]šYX[ˆXØÛÝ[›YÓX\Ú][K”Ý\Y\—Ðœ›ÚÙ\—×Ø×OËšY[œ›ÚÙ\’[™]šYX[˜[ÙKˆY[œ›ÚÙ\ÛÛ\[žNˆXØÛÝ[›YÓX\Ú][K”Ý\Y\—Ðœ›ÚÙ\—×Ø×OËšY[œ›ÚÙ\ÛÛ\[žH˜[ÙKˆÛÛ[Z\ÜÚ[Û•[š]šXÙNˆ][K”Ý\Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØÈÏÈ[ˆÛÛ[Z\ÜÚ[Û[[Ý[ˆÝ\Y\[[Ý[ˆ^[Y[]Nˆ^[Y[]PžR[›ÚXÙVÚ][K”Ý\Y\—Ò[›ÚXÙW×Ø×H[ˆ^[Y[]SX™[ˆ	ÔZY]IËˆJNÂˆB‚ˆÛÛœÝ^Y\œ›ÚÙ\’YH][K^Y\œ×Ðœ›ÚÙ\—×ØÈ][K^Y\—Ðœ›ÚÙ\—×ØÎÂˆÛÛœÝ\ÔÝ\Y\œ›ÚÙ\•[š]H[X™\Š][K”Ý\Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØÈ
HOOHÂˆÛÛœÝ^Y\”\•[š][[Ý[Hœ›ÚÙ\[[Ý[
][K^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØË]JNÂˆÛÛœÝ^Y\“[\Ý[P[[Ý[H[X™\Š][K^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ó[\Ý[W×ØÈ
NÂˆÛÛœÝ^Y\[[Ý[H^Y\“[\Ý[P[[Ý[^Y\”\•[š][[Ý[ÂˆYˆ
^Y\œ›ÚÙ\’Y	‰ˆ^Y\[[Ý[OOH
HÂˆ˜]Ô›ÝÜËœ\Ú
ÂˆYˆ^Y\‹IÚ][K’YXˆÝ[RYˆ][K”ÕSW×ØËˆÝ[S˜[YNˆÝ[K“˜[YKˆœ›ÚÙ\’Yˆ^Y\œ›ÚÙ\’Yˆ›ÙXÝ˜[YNˆ][VÉÔ›ÙXÝ×Ü‰×OË“˜[YH][K“˜[YH	ø %	Ëˆ›ÙXÝ˜[Z[Nˆ][VÉÔ›ÙXÝ×Ü‰×OË‘˜[Z[H][VÉÔ›ÙXÝ×Ü‰×OË“˜[YH][K“˜[YH	ø %	Ëˆ™”]X[]Nˆ]H[ˆ]X[]U[š]ˆ[]™\žQ]NˆÝ[K‘[]™\žWÑ]W×ØËˆœ›ÚÙ\•\Nˆ	Ð^Y\ˆœ›ÚÙ\‰Ëˆœ›ÚÙ\“˜[YNˆXØÛÝ[X\Ø^Y\œ›ÚÙ\’YH^Y\œ›ÚÙ\’YˆY[œ›ÚÙ\’[™]šYX[ˆXØÛÝ[›YÓX\Ø^Y\œ›ÚÙ\’YOËšY[œ›ÚÙ\’[™]šYX[˜[ÙKˆY[œ›ÚÙ\ÛÛ\[žNˆXØÛÝ[›YÓX\Ø^Y\œ›ÚÙ\’YOËšY[œ›ÚÙ\ÛÛ\[žH˜[ÙKˆÛÛ[Z\ÜÚ[Û•[š]šXÙNˆ][K^Y\œ×Ðœ›ÚÙ\œ×ÐÛÛ[Z\ÜÚ[Û—Ô\—Õ[š]×ØÈÏÈ
]HÈ^Y\[[Ý[È]Hˆ[
KˆÛÛ[Z\ÜÚ[Û[[Ý[ˆ^Y\[[Ý[ˆ^[Y[]NˆÝ[K”^[Y[Ñ]W×ØÈ^Y\”^[Y[]PžTÝ[VÚ][K”ÕSW×Ø×H[ˆ^[Y[]SX™[ˆ	Ô™XÙZ]™Y]IËˆ^[Y[[^Nˆ^[Y[[^Q^\ÊÝ[K”^[Y[Ñ]W×ØÈ^Y\”^[Y[]PžTÝ[VÚ][K”ÕSW×Ø×K^Y\’[›ÚXÙQYQ]PžTÝ[VÚ][K”ÕSW×Ø×HÝ[K^Y\—Ô^WÕ\›WÑ]W×ØÊKˆJNÂˆB‚ˆÛÛœÝÙXÛÛ™\žP[[Ý[HZ\ÔÝ\Y\œ›ÚÙ\•[š]	‰ˆ][KÛÛ[Z\ÜÚ[Û—ÐÛÜÝ×ØÈOH[È[X™\Š][KÛÛ[Z\ÜÚ[Û—ÐÛÜÝ×ØÈ
HH^Y\”\•[š][[Ý[ˆÂˆÛÛœÝÙXÛÛ™\žPœ›ÚÙ\œÈH
^Y\œ›ÚÙ\œÐžTÝ[VÚ][K”ÕSW×Ø×H×JK™š[\Š
œ›ÚÙ\ŠHOˆÂˆYˆ
Xœ›ÚÙ\‹^Y\—Ðœ›ÚÙ\—×ØÊH™]\›ˆYNÂˆYˆ
X^Y\œ›ÚÙ\’Y
H™]\›ˆYNÂˆ™]\›ˆÝš[™Êœ›ÚÙ\‹^Y\—Ðœ›ÚÙ\—×ØÊKœÛXÙJMJHOOHÝš[™Ê^Y\œ›ÚÙ\’Y
KœÛXÙJMJNÂˆJNÂˆYˆ
ÙXÛÛ™\žP[[Ý[ˆ	‰ˆÙXÛÛ™\žPœ›ÚÙ\œË›[™Ýˆ
HÂˆ›Üˆ
ÛÛœÝœ›ÚÙ\ˆÙˆÙXÛÛ™\žPœ›ÚÙ\œÊHÂˆ˜]Ô›ÝÜËœ\Ú
ÂˆYˆÙXÛÛ™\žKIÚ][K’YKIØœ›ÚÙ\‹’YXˆÝ[RYˆ][K”ÕSW×ØËˆÝ[S˜[YNˆÝ[K“˜[YKˆœ›ÚÙ\’Yˆœ›ÚÙ\‹^Y\—Ðœ›ÚÙ\—×ØÈ[ˆ›ÙXÝ˜[YNˆ][VÉÔ›ÙXÝ×Ü‰×OË“˜[YH][K“˜[YH	ø %	Ëˆ›ÙXÝ˜[Z[Nˆ][VÉÔ›ÙXÝ×Ü‰×OË‘˜[Z[H][VÉÔ›ÙXÝ×Ü‰×OË“˜[YH][K“˜[YH	ø %	Ëˆ™”]X[]Nˆ]H[ˆ]X[]U[š]ˆ[]™\žQ]NˆÝ[K‘[]™\žWÑ]W×ØËˆœ›ÚÙ\•\Nˆ	ÔÙXÛÛ™\žH^Y\ˆœ›ÚÙ\‰Ëˆœ›ÚÙ\“˜[YNˆXØÛÝ[X\Øœ›ÚÙ\‹^Y\—Ðœ›ÚÙ\—×Ø×Hœ›ÚÙ\‹^Y\—Ðœ›ÚÙ\—×ØÈ	ÔÙXÛÛ™\žH^Y\ˆœ›ÚÙ\‰ËˆY[œ›ÚÙ\’[™]šYX[ˆXØÛÝ[›YÓX\Øœ›ÚÙ\‹^Y\—Ðœ›ÚÙ\—×Ø×OËšY[œ›ÚÙ\’[™]šYX[˜[ÙKˆY[œ›ÚÙ\ÛÛ\[žNˆXØÛÝ[›YÓX\Øœ›ÚÙ\‹^Y\—Ðœ›ÚÙ\—×Ø×OËšY[œ›ÚÙ\ÛÛ\[žH˜[ÙKˆÛÛ[Z\ÜÚ[Û•[š]šXÙNˆ]HÈÙXÛÛ™\žP[[Ý[È]Hˆ[ˆÛÛ[Z\ÜÚ[Û[[Ý[ˆÙXÛÛ™\žP[[Ý[ˆ^[Y[]NˆÝ[K”^[Y[Ñ]W×ØÈ^Y\”^[Y[]PžTÝ[VÚ][K”ÕSW×Ø×H[ˆ^[Y[]SX™[ˆ	Ô™XÙZ]™Y]IËˆ^[Y[[^Nˆ^[Y[[^Q^\ÊÝ[K”^[Y[Ñ]W×ØÈ^Y\”^[Y[]PžTÝ[VÚ][K”ÕSW×Ø×K^Y\’[›ÚXÙQYQ]PžTÝ[VÚ][K”ÕSW×Ø×HÝ[K^Y\—Ô^WÕ\›WÑ]W×ØÊKˆJNÂˆBˆBˆB‚ˆÛÛœÝ›ÝÜÈHÛÛXš[™Pœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”›ÝÜÊ˜]Ô›ÝÜÊNÂˆ›ÝÜËœÛÜ

KŠHOˆÝš[™Ê‹™[]™\žQ]H	ÉÊK›ØØ[PÛÛ\\™JÝš[™ÊK™[]™\žQ]H	ÉÊJJNÂˆ™]\›ˆÈ›ÝÜËØ\›š[™ÜÎˆË‹‹™š[˜[˜ÚX[Ø\›š[™Ü×HNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆØ[\Ù›Ü˜ÙPœ›ÚÙ\”™YÚ\Ý\‘[
›ÙK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝ[Z]HX]›Z[Š[X™\Š›ÙK›[Z]
HŒÌ
NÂˆÛÛœÝØXÚYH]ØZ]ØXÚYØ[\Ù›Ü˜ÙU˜[YJÂˆ˜[Y\ÜXÙNˆ	ÜØ[\Ù›Ü˜ÙKXœ›ÚÙ\‹\™YÚ\Ý\‰ËˆÙXÛÛ™ÎˆŒˆ^[ØYˆÈ[Z]KˆYÜÎˆÉÜØ[\Ù›Ü˜ÙN˜œ›ÚÙ\‹\™YÚ\Ý\‰Ë	ÜØ[\Ù›Ü˜ÙNœÝ[IË	ÜØ[\Ù›Ü˜ÙN˜XØÛÝ[	×Kˆ›ÙKˆ™\KˆXØÙ\ÜÐÛÛ^ˆØY\Žˆ

HOˆØ[\Ù›Ü˜ÙPœ›ÚÙ\”™YÚ\Ý\•[˜ØXÚY
È[Z]K™\KXØÙ\ÜÐÛÛ^
KˆJNÂˆ™]\›ˆØXÚY˜[YNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙPØ\Xš[]Y\ÊÛÛ^
HÂˆÛÛœÝ[šY\ÈH]ØZ]›ÛZ\ÙK˜[
Âˆ	ÚYÙWØ›ÛÚ×ÛX[˜YÙIËˆ	ÚYÙWÜÙ][Y[ÛX[˜YÙIËˆ	ÚYÙWØÛÜÙWØ\›Ý™IËˆ	ÚYÙWØYZ[‰ËˆK›X\
\Þ[˜È
Ø\Xš[]JHOˆØØ\Xš[]K]ØZ]\Ù\’\ÐØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[KØ\Xš[]JWJJNÂˆ™]\›ˆØš™XÝ™œ›ÛQ[šY\Ê[šY\ÊNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÑ[]J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆÂˆ]Nˆ]ØZ][™RYÙQ\ÚÑ[]J›ÙKÛÛ^œ›Ùš[KÂˆÛY[ˆÛÛ^˜ÛY[ˆØ\Xš[]Y\Îˆ]ØZ]YÙPØ\Xš[]Y\ÊÛÛ^
KˆJKˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙSX\šÙ]Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆYˆ
›ÙK˜XÝ[ÛˆOOH	Ú[[YÙ[˜ÙWØœšYY‰ÊH™]\›ˆÈ]Nˆ]ØZ]ØYX\šÙ][[YÙ[˜ÙPœšYYŠÛÛ^˜ÛY[›ÙJHNÂˆYˆ
›ÙK˜XÝ[ÛˆOOH	Ú[[YÙ[˜ÙWØÝ\™IÊH™]\›ˆÈ]Nˆ]ØZ]ØYX\šÙ][[YÙ[˜ÙPÝ\™JÛÛ^˜ÛY[›ÙJHNÂˆYˆ
›ÙK˜XÝ[ÛˆOOH	Ú[[YÙ[˜ÙWÝ˜[X][Û‰ÊH™]\›ˆÈ]Nˆ]ØZ]ØYÛÝ™\›™YX\šÙ]˜[X][ÛŠÛÛ^˜ÛY[›ÙJHNÂˆYˆ
›ÙK˜XÝ[ÛˆOOH	Ù›ÜØ\™Ù˜[˜XÚ×ÜØ]™IÊHÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWØ›ÛÚ×ÛX[˜YÙIË	ÒYÙH›ÛÚÈX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈØ]™HH›ÜØ\™˜[˜XÚË‰ÊNÂˆ™]\›ˆÈ]Nˆ]ØZ]Ø]™SX\šÙ]›ÜØ\™˜[˜XÚÊÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJHNÂˆBˆYˆ
›ÙK˜XÝ[ÛˆOOH	Ú[[YÙ[˜ÙWØ[\Ü[\×ÙÙ]	ÊH™]\›ˆÈ]Nˆ]ØZ]Ù]X\šÙ][[YÙ[˜ÙP[\[\ÊÛÛ^˜ÛY[
HNÂˆYˆ
›ÙK˜XÝ[ÛˆOOH	Ú[[YÙ[˜ÙWØ[\Ü[\×ÜØ]™IÊHÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWØYZ[‰Ë	ÒYÙHYZ[š\Ý˜][Ûˆ\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈÚ[™ÙHX\šÙ][\[\Ë‰ÊNÂˆ™]\›ˆÈ]Nˆ]ØZ]Ø]™SX\šÙ][[YÙ[˜ÙP[\[\ÊÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJHNÂˆBˆYˆ
›ÙK˜XÝ[ÛˆOOH	Ú[[YÙ[˜ÙWØÝ\™WØÝ]Ý™\—ÜØ]™IÊHÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWØYZ[‰Ë	ÒYÙHYZ[š\Ý˜][Ûˆ\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈ\›Ý™HHÝ\™HÝ]Ý™\‹‰ÊNÂˆ™]\›ˆÈ]Nˆ]ØZ]Ø]™SX\šÙ]Ý\™TÚYÝÐÝ]Ý™\ŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJHNÂˆBˆÛÛœÝ]HH]ØZ][™RYÙSX\šÙ]Ê›ÙKÛÛ^œ›Ùš[KÂˆÛY[ˆÛÛ^˜ÛY[ˆØ\Xš[]Y\Îˆ]ØZ]YÙPØ\Xš[]Y\ÊÛÛ^
KˆJNÂˆYˆ
ÉØÜ™X]IË	Ý\]IË	Ù[]IË	ÜØ]™WÜÜ™XYÉË	Ý™\šYžWÛ[Û	Ë	ÛX\šÙ]Ü™\ÜÚ[\Ü	×Kš[˜ÛY\ÊÝš[™Ê›ÙK˜XÝ[Ûˆ	ÉÊJJHÂˆ]ØZ]^\™T[[YPØXÚUYÜÊÉÛX\šÙ]ÉË	ÚYÙN›X\šÙ]ÉË	ÛX\šÙ]š[[YÙ[˜ÙIË	ÛX\šÙ]œ[ÙI×JNÂˆBˆ™]\›ˆÈ]HNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][[YÙ[˜ÙPœšYYŠ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØYX\šÙ][[YÙ[˜ÙPœšYYŠÛÛ^˜ÛY[›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][ÙTÛ˜\ÚÝ
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÜÛ˜\ÚÝØ\Xš[]Y\×HH]ØZ]›ÛZ\ÙK˜[
ÂˆØYX\šÙ][ÙTÛ˜\ÚÝ
ÛÛ^˜ÛY[È‹‹˜›ÙK›Ü˜ÙNˆ™\]Y\Ý›Ü˜Ù\Ô™Yœ™\Ú
›ÙK™\JHJKˆYÙPØ\Xš[]Y\ÊÛÛ^
KˆJNÂˆ™]\›ˆÂˆ‹‹œÛ˜\ÚÝˆËÈØ\Xš[]Y\È\™H]XÚYY\ˆHÚ\™YŒ\ÙXÛÛ™X\šÙ]Y]HØXÚH™\ÛÛ™\Ë‚ˆËÈ^H]\Ý™]™\ˆ™HÝÜ™Y[‹Üˆ[š\š]Yœ›ÛK]Ü›ÜÜË]\Ù\ˆØXÚH[žK‚ˆØ\Xš[]Y\ÎˆÂˆYÙWØ›ÛÚ×ÛX[˜YÙNˆØ\Xš[]Y\ÏËšYÙWØ›ÛÚ×ÛX[˜YÙHOOHYKˆYÙWØYZ[ŽˆØ\Xš[]Y\ÏËšYÙWØYZ[ˆOOHYKˆKˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][[YÙ[˜ÙPÝ\™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØYX\šÙ][[YÙ[˜ÙPÝ\™JÛÛ^˜ÛY[›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ]™\ÜØ][ÙÝYJ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØYX\šÙ]™\ÜØ][ÙÝYJÛÛ^˜ÛY[›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ]™\Ü[˜[\Ú\Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ[˜[^™SX\šÙ]™\ÜXœ˜\žJÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙKÂˆÛ•\ØYÙNˆ
\ØYÙJHOˆ™XÛÜ™\Ú›Ø\™ZU\ØYÙJÛÛ^˜ÛY[ÛÛ^œ›Ùš[K\ØYÙJKˆJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][[YÙ[˜ÙU˜[X][ÛŠ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØYÛÝ™\›™YX\šÙ]˜[X][ÛŠÛÛ^˜ÛY[›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ]›ÜØ\™˜[˜XÚÔØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØ]™SX\šÙ]›ÜØ\™˜[˜XÚÊÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][[YÙ[˜ÙP[\[\ÑÙ]
Ø›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆÙ]X\šÙ][[YÙ[˜ÙP[\[\ÊÛÛ^˜ÛY[
NÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][[YÙ[˜ÙP[\[\ÔØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØ]™SX\šÙ][[YÙ[˜ÙP[\[\ÊÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][[YÙ[˜ÙPÝ\™PÝ]Ý™\”Ø]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØ]™SX\šÙ]Ý\™TÚYÝÐÝ]Ý™\ŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][[YÙ[˜ÙP\˜Ú]™T™\^J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWØYZ[‰Ë	ÒYÙHYZ[š\Ý˜][Ûˆ\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈ™XÛÛ˜Ú[HHXÙ[œÙYX\šÙ]\˜Ú]™K‰ÊNÂˆ™\]Z\™Q^\›˜[XÝ[Û‘Ø]J	ÙÛÛÙÛWÙš]™IÊNÂˆÛÛœÝXØÙ\ÜÕÚÙ[ˆH]ØZ]ÛÛÙÛQš]™SX\šÙ]XØÙ\ÜÕÚÙ[Š
NÂˆÛÛœÝ™\Ý[H]ØZ][“X\šÙ]™\Ü\˜Ú]™T™\^P˜]Ú
ÛÛ^˜ÛY[ÂˆXØÙ\ÜÕÚÙ[‹ˆÝ\œÛÜŽˆ›ÙK˜Ý\œÛÜ‹ˆ^XÝY\˜Ú]™Qš[™Ù\œš[ˆ›ÙK˜\˜Ú]™Qš[™Ù\œš[[ˆJNÂˆYˆ
™\Ý[œ™\^YYÛÝ[ˆ™\Ý[˜œšYYÛÛ\]YÛÝ[ˆ
HÂˆ]ØZ]^\™T[[YPØXÚUYÜÊÉÛX\šÙ]ÉË	ÚYÙN›X\šÙ]ÉË	ÛX\šÙ]š[[YÙ[˜ÙI×JNÂˆBˆ™]\›ˆ™\Ý[ÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][˜Y^TÛ˜\ÚÝ™]šY]Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWØ›ÛÚ×ÛX[˜YÙIË	ÓX\šÙ]Y]HX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈ™]šY]ÈH›Ýš\Ú[Û˜[\\ˆÛ˜\ÚÝ‰ÊNÂˆ™]\›ˆ™]šY]ÓX\šÙ][˜Y^TÛ˜\ÚÝ
ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][˜Y^TÛ˜\ÚÝØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWØ›ÛÚ×ÛX[˜YÙIË	ÓX\šÙ]Y]HX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈØ]™HH›Ýš\Ú[Û˜[\\ˆÛ˜\ÚÝ‰ÊNÂˆÛÛœÝØ]™YH]ØZ]Ø]™SX\šÙ][˜Y^TÛ˜\ÚÝ
ÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂˆ]ØZ]™XÛÛ˜Ú[SX\šÙ][˜Y^Q]JÛÛ^˜ÛY[›ÙK›X\šÙ]]KÛÛ^œ›Ùš[JK˜Ø]Ú


HOˆ
È[œÙ\YÛÝ[ˆJJNÂˆ]ØZ]^\™T[[YPØXÚUYÜÊÉÛX\šÙ]ÉË	ÚYÙN›X\šÙ]ÉË	ÛX\šÙ]š[[YÙ[˜ÙIË	ÛX\šÙ]œ[ÙIË	ÛX\šÙ]š[˜Y^I×JNÂˆ™]\›ˆØ]™YÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ][˜Y^U[Y[[™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØYX\šÙ][˜Y^U[Y[[™JÛÛ^˜ÛY[›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÔ\œÙS[ÜÊ›ÙHHßJHÂˆ™]\›ˆÈÚÎˆYK‹‹œ\œÙS[ÜÕ^
›ÙKœ˜]×Ú[œ]›ÙK^›ÙKš[œ]	ÉÊHNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÑÙ[™\˜]R[›ÚXÙJ›ÙHHßJHÂˆÛÛœÝÙ[™\˜]YHÙ[™\˜]RYÙR[›ÚXÙTŠ›ÙJNÂˆ™]\›ˆÂˆÚÎˆYKˆ˜\ÙMˆÙ[™\˜]Y˜Y™™\‹ÔÝš[™Ê	Ø˜\ÙM	ÊKˆZ[YU\Nˆ	Ø\XØ][Û‹Ü‰Ëˆš[[˜[YNˆÙ[™\˜]Y™š[[˜[YKˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÔØ]™R[›ÚXÙTŠ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWÜÙ][Y[ÛX[˜YÙIË	ÒYÙHÙ][Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈÝÜ™H[›ÚXÙHØÝ[Y[Ë‰ÊNÂˆ™]\›ˆØ]™RYÙR[›ÚXÙTŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÔÙ[™[›ÚXÙQ[XZ[
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWÜÙ][Y[ÛX[˜YÙIË	ÒYÙHÙ][Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈÙ[™Ù][Y[[›ÚXÙ\Ë‰ÊNÂˆ™]\›ˆÙ[™YÙR[›ÚXÙQ[XZ[Y[\Ý[
ÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÔÙœÔ™\Ü
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆÙ]YÙTÙœÓ[Û™\Ü
ÛÛ^˜ÛY[›ÙK›[Û
NÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÔÙœÑš[J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆÙ]YÙTÙœÑš[JÛÛ^˜ÛY[›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÔÙœÔÙ[™
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWØÛÜÙWØ\›Ý™IË	ÒYÙH[ÛXÛÜÙH\›Ý˜[\›Z\ÜÚ[Ûˆ\È™\]Z\™YÈÙ[™Ñ”È™\ÜË‰ÊNÂˆ™]\›ˆ\›Ý™P[™Ù[™YÙTÙœÔ™\Ü
ÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÔØ[\Ù›Ü˜ÙT\Ú
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWØ›ÛÚ×ÛX[˜YÙIË	ÒYÙH›ÛÚÈX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™Y›ÜˆØ[\Ù›Ü˜ÙHÞ[˜Ú›Ûš^˜][Û‹‰ÊNÂˆ™]\›ˆ\ÚYÙTØ[\Ù›Ü˜ÙJÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÔØ[\Ù›Ü˜ÙT™]šY]Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÚYÙWØ›ÛÚ×ÛX[˜YÙIË	ÒYÙH›ÛÚÈX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™Y›ÜˆØ[\Ù›Ü˜ÙH[ØØ][Ûˆ™]šY]ÜË‰ÊNÂˆ™]\›ˆ™]šY]ÒYÙTØ[\Ù›Ü˜ÙJÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÔØ[\Ù›Ü˜ÙSX\[™Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝØ\Xš[]Y\ÈH]ØZ]YÙPØ\Xš[]Y\ÊÛÛ^
NÂˆ›ÚY›ÙNÂˆ™]\›ˆÈ‹‹Š]ØZ]Ù]YÙTØ[\Ù›Ü˜ÙSX\[™ÊÛÛ^˜ÛY[
JKØ[“X[˜YÙNˆØ\Xš[]Y\ËšYÙWØYZ[ˆOOHYHNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÐ\ÜÚ\Ý[
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ[’YÙP\ÜÚ\Ý[
ÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÐ\ÜÚ\Ý[Ù][™ÜÊ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝØ\Xš[]Y\ÈH]ØZ]YÙPØ\Xš[]Y\ÊÛÛ^
NÂˆ™]\›ˆÈ‹‹Š]ØZ]YÙP\ÜÚ\Ý[Ù][™ÜÊÛÛ^˜ÛY[
JKØ[“X[˜YÙNˆØ\Xš[]Y\ËšYÙWØYZ[ˆOOHYHNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆYÙQ\ÚÓXZ[[˜[˜ÙPÜ›ÛŠ›ÙHHßK™\HH[
HÂˆ™\]Z\™PÜ›Û]]Üš^˜][ÛŠ™\JNÂˆ™]\›ˆ[’YÙSXZ[[˜[˜ÙJÝ\X˜\ÙPYZ[ÛY[

KÂˆ›Ü˜ÙRXÙNˆ›ÙK™›Ü˜ÙRXÙHOOHYKˆžT[Žˆ›ÙK™žT[ˆOOHYKˆJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆX\šÙ]™\Üš]™TÞ[˜ÐÜ›ÛŠØ›ÙHHßK™\HH[
HÂˆ™\]Z\™PÜ›Û]]Üš^˜][ÛŠ™\JNÂˆ™\]Z\™Q^\›˜[XÝ[Û‘Ø]J	ÙÛÛÙÛWÙš]™IÊNÂˆÛÛœÝÛY[HÝ\X˜\ÙPYZ[ÛY[

NÂˆÛÛœÝXØÙ\ÜÕÚÙ[ˆH]ØZ]ÛÛÙÛQš]™SX\šÙ]XØÙ\ÜÕÚÙ[Š
NÂˆÛÛœÝ™\Ý[H]ØZ][“X\šÙ]™\Üš]™TÞ[˜ÊÛY[ÈXØÙ\ÜÕÚÙ[ˆJNÂˆYˆ
™\Ý[œÝ]\ÈOOH	Ù˜Z[Y	ÊHÂˆ›ÝÈ\\œ›ÜŠ	ÔØÚY[YÛÛÙÛHš]™HX\šÙ]\™\ÜÞ[˜Ú›Ûš^˜][ÛˆY›ÝÛÛ\]K‰ËL‹™\Ý[™\œ›ÜÛÙH	ÓPT’ÑUÑ’U‘WÔÖS×ÑRSQ	Ë[™Yš[™YYJNÂˆBˆYˆ
™\Ý[š[\ÜYÛÝ[ˆ
H]ØZ]^\™T[[YPØXÚUYÜÊÉÛX\šÙ]ÉË	ÚYÙN›X\šÙ]ÉË	ÛX\šÙ]š[[YÙ[˜ÙI×JNÂˆ]ØZ]™\ÛÛ™T™XÛÝ™\™YÞ\Ý[Q\œ›Ü’[™\ŠÛY[	ÛX\šÙ]™\Üš]™TÞ[˜ÐÜ›Û‰ËÈ™\ÛÛ™Y›ÝYÚˆ™]È]J
HJK˜Ø]Ú


HOˆßJNÂˆ™]\›ˆ™\Ý[ÂŸB‚˜ÛÛœÝÚ]X\Ý\ÛÛ˜XÝ\Ù\ˆH
Ù\šXÙJHOˆ\Þ[˜È
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HOˆÙ\šXÙJ›ÙKXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝÓ\ÝHÚ]X\Ý\ÛÛ˜XÝ\Ù\Š\ÝX\Ý\ÛÛ˜XÝÔÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝ]Z[HÚ]X\Ý\ÛÛ˜XÝ\Ù\ŠÙ]X\Ý\ÛÛ˜XÝÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝØ]™HHÚ]X\Ý\ÛÛ˜XÝ\Ù\ŠØ]™SX\Ý\ÛÛ˜XÝÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝXÚ\Ú[ÛˆHÚ]X\Ý\ÛÛ˜XÝ\Ù\ŠXÚYSX\Ý\ÛÛ˜XÝÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝ]šY[˜ÙT™\\™HHÚ]X\Ý\ÛÛ˜XÝ\Ù\Š™\\™SX\Ý\ÛÛ˜XÝ]šY[˜ÙTÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝ]šY[˜ÙPÛÛ\]HHÚ]X\Ý\ÛÛ˜XÝ\Ù\ŠÛÛ\]SX\Ý\ÛÛ˜XÝ]šY[˜ÙTÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝ]šY[˜ÙU\›HÚ]X\Ý\ÛÛ˜XÝ\Ù\ŠÙ]X\Ý\ÛÛ˜XÝ]šY[˜ÙU\›Ù\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝÜ[ÛœÈHÚ]X\Ý\ÛÛ˜XÝ\Ù\ŠX\Ý\ÛÛ˜XÝÜ[ÛœÔÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝ™\ÜÙ[Ü™X]HHÚ]X\Ý\ÛÛ˜XÝ\Ù\ŠÜ™X]SX\Ý\ÛÛ˜XÝ™\ÜÙ[Ù\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝ™Y›YÚHÚ]X\Ý\ÛÛ˜XÝ\Ù\Š™Y›YÚX\Ý\ÛÛ˜XÝÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝ˜]ÚÜ™X]HHÚ]X\Ý\ÛÛ˜XÝ\Ù\ŠÜ™X]SX\Ý\ÛÛ˜XÝ˜]ÚÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝšXÙT™\ÛÛ™HHÚ]X\Ý\ÛÛ˜XÝ\Ù\Š™\ÛÛ™SX\Ý\ÛÛ˜XÝšXÙTÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝšXÙP\HHÚ]X\Ý\ÛÛ˜XÝ\Ù\Š\SX\Ý\ÛÛ˜XÝšXÙTÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝ™X]\™TØ]™HHÚ]X\Ý\ÛÛ˜XÝ\Ù\ŠØ]™SX\Ý\ÛÛ˜XÝ™X]\™TÙ\šXÙJNÂ˜ÛÛœÝX\Ý\ÛÛ˜XÝ™XÛÛ˜Ú[HHÚ]X\Ý\ÛÛ˜XÝ\Ù\Š™XÛÛ˜Ú[SX\Ý\ÛÛ˜XÝÔÙ\šXÙJNÂ‚˜\Þ[˜È[˜Ý[ÛˆX\Ý\ÛÛ˜XÝ™XÛÛ˜Ú[PÜ›ÛŠ›ÙHHßK™\HH[
HÂˆ™\]Z\™PÜ›Û]]Üš^˜][ÛŠ™\JNÂˆ™]\›ˆ™XÛÛ˜Ú[SX\Ý\ÛÛ˜XÝÔÙ\šXÙJ›ÙKÂˆÛY[ˆÝ\X˜\ÙPYZ[ÛY[

Kˆ›Ùš[NˆÈYˆ[[XZ[ˆ[\Ù\—Ý\Nˆ	ÜÞ\Ý[IÈKˆJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›\ÕÛÜšÜÜXÙJ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÝÛÜšÜÜXÙKØ[\›Ý™PÛ]\Ù\×HH]ØZ]›ÛZ\ÙK˜[
Âˆ\ÝÜXÚX[\›\ÊÈ›Ü˜ÙNˆ›ÙK™›Ü˜ÙHOOHYHJKˆ\Ù\’\ÐØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÜÜXÚX[Ý\›\×ØÛ]\ÙWØ\›Ý™IÊKˆJNÂˆÛÛœÝXÝ]™QÙ[™\˜[X[˜YÙ\ˆHÛÛ^œ›Ùš[K\Ù\—Ý\HOOH	ÙÙ[™\˜[ÛX[˜YÙ\‰ÈÈ]ØZ]ØYXÝ]™QÙ[™\˜[X[˜YÙ\ŠÛÛ^˜ÛY[
Hˆ[ÂˆÛÛœÝØ[\›Ý™T™]š\Ú[ÛœÈHØ[\›Ý™PÛ]\Ù\È	‰ˆ
\ÐYZ[š\Ý˜]Ü•\Ù\•\JÛÛ^œ›Ùš[K\Ù\—Ý\JHXÝ]™QÙ[™\˜[X[˜YÙ\ËšYOOHÛÛ^œ›Ùš[KšY
NÂˆ™]\›ˆÂˆ‹‹ÛÜšÜÜXÙKˆØ[“X[˜YÙNˆYKˆØ[‘˜YˆYKˆØ[\›Ý™PÛ]\Ù\ÎˆØ[\›Ý™T™]š\Ú[ÛœËˆØ[\›Ý™T™]š\Ú[ÛœËˆÝ\œ™[\Ù\‘[XZ[ˆÛÛ^œ›Ùš[K™[XZ[	ÉËˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›\ÔÝ[[X\žS\Ý
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÜÝ[[X\žKØÚ[XKØ[\›Ý™PÛ]\Ù\×HH]ØZ]›ÛZ\ÙK˜[
Âˆ\ÝÜXÚX[\›TÝ[[X\šY\Ê›ÙJKˆ™\ÛÛ™TÜXÚX[\›\ÔØÚ[XJ
Kˆ\Ù\’\ÐØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÜÜXÚX[Ý\›\×ØÛ]\ÙWØ\›Ý™IÊKˆJNÂˆÛÛœÝXÝ]™QÙ[™\˜[X[˜YÙ\ˆHÛÛ^œ›Ùš[K\Ù\—Ý\HOOH	ÙÙ[™\˜[ÛX[˜YÙ\‰ÈÈ]ØZ]ØYXÝ]™QÙ[™\˜[X[˜YÙ\ŠÛÛ^˜ÛY[
Hˆ[ÂˆÛÛœÝØ[\›Ý™T™]š\Ú[ÛœÈHØ[\›Ý™PÛ]\Ù\È	‰ˆ
\ÐYZ[š\Ý˜]Ü•\Ù\•\JÛÛ^œ›Ùš[K\Ù\—Ý\JHXÝ]™QÙ[™\˜[X[˜YÙ\ËšYOOHÛÛ^œ›Ùš[KšY
NÂˆ™]\›ˆÂˆ‹‹œÝ[[X\žKˆ\›\Îˆ
Ý[[X\žK\›\È×JK›X\

\›JHOˆXØ[\›Ý™T™]š\Ú[ÛœÈ	‰ˆ\›K›™^XÝ[ÛˆOOH	Ü™]šY]×ÜX›\Ú	ÈÈÈ‹‹\›K™^XÝ[ÛŽˆ	ØÛÛ[YIÈHˆ\›JKˆØ[‘˜YˆYKˆØ[\›Ý™PÛ]\Ù\ÎˆØ[\›Ý™T™]š\Ú[ÛœËˆØ[\›Ý™T™]š\Ú[ÛœËˆÝ\œ™[\Ù\‘[XZ[ˆÛÛ^œ›Ùš[K™[XZ[	ÉËˆÛ]\ÙPØ]YÛÜžSÜ[ÛœÎˆØÚ[XK˜Û]\ÙPØ]YÛÜžSÜ[ÛœËˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›\ÑØÝ[Y[^Ü
›ÙHHßK™\K™\ËXØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝ›Ü›X]HÝš[™Ê›ÙK™›Ü›X]	Ü‰ÊKš[J
KÓÝÙ\Ø\ÙJ
NÂˆÛÛœÝÛÝ\˜ÙHHÝš[™Ê›ÙKœÛÝ\˜ÙH	Û]™IÊKš[J
KÓÝÙ\Ø\ÙJ
NÂˆYˆ
VÉÜ‰Ë	ÙØÞ	×Kš[˜ÛY\Ê›Ü›X]
JH›ÝÈ\\œ›ÜŠ	ÐÚÛÜÙHˆÜˆÛÜ™ØÝ[Y[›Ü›X]‰Ë	ÔÔPÒPSÕT“T×ÑÐÕSQS•Ñ“Ô“PUÒS•SQ	ÊNÂˆYˆ
VÉÛ]™IË	Ù˜Y	×Kš[˜ÛY\ÊÛÝ\˜ÙJJH›ÝÈ\\œ›ÜŠ	ÐÚÛÜÙHH]™HØÝ[Y[ÜˆØ]™Y˜Y™]šY]Ë‰Ë	ÔÔPÒPSÕT“T×ÑÐÕSQS•ÔÓÕTÑWÒS•SQ	ÊNÂˆYˆ
ÛÝ\˜ÙHOOH	Ù˜Y	È	‰ˆ›Ü›X]OOH	Ü‰ÊH›ÝÈ\\œ›ÜŠ	ÔØ]™Y˜YÈX^H™HÝÛ›ØYY\ÈØ]\›X\šÙYˆÛ›K‰ËK	ÔÔPÒPSÕT“T×ÑÐÕSQS•ÑQ•Ñ“Ô“PUÔ‘TÕ’PÕQ	ÊNÂˆÛÛœÝ\›HH]ØZ]Ù]ÜXÚX[\›QØÝ[Y[›Ü‘^Ü
›ÙK\›RYÂˆÛÝ\˜ÙKˆ™]š\Ú[Û’Yˆ›ÙKœ™]š\Ú[Û’Yˆ^XÝY\Ý[ÙYšYY]ˆ›ÙK™^XÝY\Ý[ÙYšYY]ˆ^XÝY™]š\Ú[Û“\Ý[ÙYšYY]ˆ›ÙK™^XÝY™]š\Ú[Û“\Ý[ÙYšYY]ˆ›Ü˜ÙNˆYKˆJNÂˆÛÛœÝÙ[™\˜]YH]ØZ]Ù[™\˜]TÜXÚX[\›\ÑØÝ[Y[
\›KÂˆ›Ü›X]ˆÛÝ\˜ÙKˆ\XØ]R[™^ˆ›ÙK™\XØ]R[™^ˆJNÂˆ]ØZ]Üš]PYZ[]Y]
ÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÜÜXÚX[Ý\›\×ÙØÝ[Y[Ù^ÜY	Ë[[Âˆ\›PÛÝ[ˆKˆ\›RYˆ\›KšYˆ›Ü›X]ˆÛÝ\˜ÙKˆYÙPÛÝ[ˆ[X™\‹š\Ñš[š]JÙ[™\˜]YœYÙPÛÝ[
HÈÙ[™\˜]YœYÙPÛÝ[ˆ[ˆÝ]ÛÛYNˆ	ÜÝXØÙ\ÜÉËˆJNÂˆÛÛœÝ\ØÚZQš[[˜[YHHÙ[™\˜]Y™š[[˜[YKœ™\XÙJÖ×—ŒWÑWKÙË	×ÉÊKœ™\XÙJÈ‹ÙË	ÉÊNÂˆ™\ËœÝ]\ÐÛÙHHŒÂˆ™\ËœÙ]XY\Š	ØØXÚKXÛÛ›Û	Ë	Û›Ë\ÝÜ™IÊNÂˆ™\ËœÙ]XY\Š	ØÛÛ[]\IËÙ[™\˜]Y˜ÛÛ[\JNÂˆ™\ËœÙ]XY\Š	ØÛÛ[Y\ÜÜÚ][Û‰Ë]XÚY[Èš[[˜[YOH‰Ø\ØÚZQš[[˜[Y_HŽÈš[[˜[YJUU‹N	ÉÉÙ[˜ÛÙUT’PÛÛ\Û™[
Ù[™\˜]Y™š[[˜[YJ_X
NÂˆ›Üˆ
ÛÛœÝÛ˜[YK˜[YWHÙˆØš™XÝ™[šY\Ê[[Y]žT™\ÜÛœÙRXY\œÊ
JJH™\ËœÙ]XY\Š˜[YK˜[YJNÂˆ™\Ë™[™
Ù[™\˜]Y˜Y™™\ŠNÂŸB‚‹ÊŠˆ™]Z[™YÛ›H›Üˆ\ÞYYÓÔÈÛY[È]Ø[HÜšYÚ[˜[›Ý]Kˆ
‹Â˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›\Ô‘^Ü
›ÙHHßK™\K™\ËXØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆÜXÚX[\›\ÑØÝ[Y[^Ü
È‹‹˜›ÙK›Ü›X]ˆ	Ü‰ËÛÝ\˜ÙNˆ›ÙKœÛÝ\˜ÙH	Û]™IÈK™\K™\ËXØÙ\ÜÐÛÛ^
NÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›\ÓÜ[ÛœÊ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆÈÜ[ÛœÎˆ]ØZ]ÜXÚX[\›SÜ[ÛœÊ›ÙJHNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ\ÔÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
HÂˆÛÛœÝ\ÐØ\Xš[]HH]ØZ]\Ù\’\ÐØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÜÜXÚX[Ý\›\×ØÛ]\ÙWØ\›Ý™IÊNÂˆYˆ
Z\ÐØ\Xš[]JH™]\›ˆ˜[ÙNÂˆÛÛœÝ\ÐYZ[š\Ý˜]ÜˆHÛÛ^œ›Ùš[K\Ù\—Ý\HOOH	ØYZ[š\Ý˜]Ü‰ÎÂˆÛÛœÝXÝ]™QÙ[™\˜[X[˜YÙ\ˆHÛÛ^œ›Ùš[K\Ù\—Ý\HOOH	ÙÙ[™\˜[ÛX[˜YÙ\‰ÂˆÈ]ØZ]ØYXÝ]™QÙ[™\˜[X[˜YÙ\ŠÛÛ^˜ÛY[
Bˆˆ[Âˆ™]\›ˆ\ÐYZ[š\Ý˜]ÜˆXÝ]™QÙ[™\˜[X[˜YÙ\ËšYOOHÛÛ^œ›Ùš[KšYÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
HÂˆYˆ
J]ØZ]\ÔÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
JJH›ÝÈ\\œ›ÜŠ	ÓÛ›HHXÝ]™HÙ[™\˜[X[˜YÙ\ˆÜˆ[ˆYZ[š\Ý˜]ÜˆX^H\›Ý™HÛ]\ÙHÛÜ™[™È[™ZYÜ˜][ÛœË‰ËË	ÔÔPÒPSÕT“T×ÐÓUTÑWÐT“Õ‘T—Ô‘TURT‘Q	ÊNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›Q]Z[
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÙ]Z[ØÚ[XKØ[\›Ý™PÛ]\Ù\×HH]ØZ]›ÛZ\ÙK˜[
ÂˆÙ]ÜXÚX[\›Q]Z[
›ÙK\›RYÈ›Ü˜ÙNˆ›ÙK™›Ü˜ÙHOOHYHJKˆ™\ÛÛ™TÜXÚX[\›\ÔØÚ[XJ
Kˆ\Ù\’\ÐØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÜÜXÚX[Ý\›\×ØÛ]\ÙWØ\›Ý™IÊKˆJNÂˆÛÛœÝXÝ]™QÙ[™\˜[X[˜YÙ\ˆHÛÛ^œ›Ùš[K\Ù\—Ý\HOOH	ÙÙ[™\˜[ÛX[˜YÙ\‰ÈÈ]ØZ]ØYXÝ]™QÙ[™\˜[X[˜YÙ\ŠÛÛ^˜ÛY[
Hˆ[ÂˆÛÛœÝØ[\›Ý™T™]š\Ú[ÛœÈHØ[\›Ý™PÛ]\Ù\È	‰ˆ
\ÐYZ[š\Ý˜]Ü•\Ù\•\JÛÛ^œ›Ùš[K\Ù\—Ý\JHXÝ]™QÙ[™\˜[X[˜YÙ\ËšYOOHÛÛ^œ›Ùš[KšY
NÂˆ™]\›ˆÂˆ‹‹™]Z[ˆØ[‘˜YˆYKˆØ[\›Ý™PÛ]\Ù\ÎˆØ[\›Ý™T™]š\Ú[ÛœËˆØ[\›Ý™T™]š\Ú[ÛœËˆÝ\œ™[\Ù\‘[XZ[ˆÛÛ^œ›Ùš[K™[XZ[	ÉËˆÛ]\ÙPØ]YÛÜžSÜ[ÛœÎˆØÚ[XK˜Û]\ÙPØ]YÛÜžSÜ[ÛœËˆ]YY[˜ÙSÜ[ÛœÎˆØÚ[XK˜]YY[˜ÙSÜ[ÛœËˆÛÝ[žSÜ[ÛœÎˆØÚ[XK˜ÛÝ[žSÜ[ÛœËˆNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙP˜[šÊ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ\ÝÜXÚX[\›PÛ]\ÙP˜[šÊ›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙTÚ[Z[\Š›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ\ÝÜXÚX[\›PÛ]\ÙTÚ[Z[\Š›ÙK˜Û]\ÙRYÈ[Z]ˆ›ÙK›[Z]JNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙQY]™]šY]Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆÙ]ÜXÚX[\›PÛ]\ÙQY]™]šY]Ê›ÙKÈØ[”X›\Úˆ]ØZ]\ÔÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
HJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙQÛØ˜[X›\Ú
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
NÂˆ™]\›ˆX›\ÚÜXÚX[\›PÛ]\ÙQÛØ˜[JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›Q[]T™]šY]Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆÛÛœÝÜ[ÛœÈHÈ\Ð\›Ý™\Žˆ]ØZ]\ÔÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
HNÂˆYˆ
›ÙK™[]U\HOOH	ØÛ]\ÙIÈ›ÙK™[]U\HOOH	ØÛ]\ÙU™\œÚ[Û‰ÊH™]\›ˆ™]šY]ÔÜXÚX[\›PÛ]\ÙQ[][ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙKÜ[ÛœÊNÂˆ™]\›ˆ™]šY]ÔÜXÚX[\›Q[][ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙKÜ[ÛœÊNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›SZYÜ˜][Û’[™[ÜžJ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
NÂˆ™]\›ˆÙ]ÜXÚX[\›SZYÜ˜][Û’[™[ÜžJÈ›Ü˜ÙNˆ›ÙK™›Ü˜ÙHOOHYHJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙQ˜YØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØ]™TÜXÚX[\›PÛ]\ÙQ˜Y
ÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙP\›Ý™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
NÂˆ™]\›ˆ\›Ý™TÜXÚX[\›PÛ]\ÙJÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙT™]\™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
NÂˆ™]\›ˆ™]\™TÜXÚX[\›PÛ]\ÙJÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙQ[]J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ[]TÜXÚX[\›PÛ]\ÙJÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙKÈ\Ð\›Ý™\Žˆ]ØZ]\ÔÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
HJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙQ˜Y\ØØ\™
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ\ØØ\™ÜXÚX[\›PÛ]\ÙQ˜Y
ÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙKÈ\Ð\›Ý™\Žˆ]ØZ]\ÔÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
HJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][Û“\Ý
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ\ÝÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][ÛœÊÈ[˜ÛYPÛÜÙYˆ›ÙKš[˜ÛYPÛÜÙYOOHYHJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][Û”Ý\
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
NÂˆ™]\›ˆÝ\ÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][Û”™[[šÊ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ™[[šÔÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][ÛØ[˜Ù[
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
NÂˆ™]\›ˆØ[˜Ù[ÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][ÛÛÛ\]J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
NÂˆ™]\›ˆÛÛ\]TÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛÛ\ÜÚ][Û”Ø]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ›ÝÈ\\œ›ÜŠ	Ñ\™XÝ›Ú™XÝ[ÛˆÛÛ\ÜÚ][Ûˆ\È™]\™YˆØ]™HHÛÛ\]HÜXÚX[\›H™]š\Ú[Ûˆ[œÝXY‰ËK	ÔÔPÒPSÕT“T×ÕÒÓWÔ‘U’TÒSÓ—Ô‘TURT‘Q	ÊNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›SZYÜ˜][Û”™]šY]Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ™]šY]ÔÜXÚX[\›SZYÜ˜][ÛŠ›ÙK\›RYÈ›Ú™XÝ[ÛŽˆ›ÙKœ›Ú™XÝ[Ûˆ	Ý\›\Õ^	ÈJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›SZYÜ˜][Û”Ø]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØ]™TÜXÚX[\›SZYÜ˜][Û”™]šY]ÊÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›SZYÜ˜][Û”Ø]™P[
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØ]™P[ÜXÚX[\›SZYÜ˜][Û”™]šY]ÊÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›SZYÜ˜][ÛXÝ]˜]J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ›ÝÈ\\œ›ÜŠ	Ô›Ú™XÝ[Û‹[]™[XÝ]˜][Ûˆ\È™]\™Yˆ\›Ý™H[™XÝ]˜]HHÛÛ\]HÜXÚX[\›H™]š\Ú[Û‹‰ËK	ÔÔPÒPSÕT“T×ÕÒÓWÔ‘U’TÒSÓ—Ô‘TURT‘Q	ÊNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›SZYÜ˜][Û”™]šY]Ð[
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ™]šY]ÔÜXÚX[\›SZYÜ˜][Û[
›ÙK\›RY
NÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›SZYÜ˜][Û”›Û˜XÚÊ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ›ÝÈ\\œ›ÜŠ	Ô›Ú™XÝ[Û‹[]™[›Û˜XÚÈ\È™]\™Yˆ›Û˜XÚÈHÛÛ\]HÜXÚX[\›H™]š\Ú[Û‹‰ËK	ÔÔPÒPSÕT“T×ÕÒÓWÔ‘U’TÒSÓ—Ô‘TURT‘Q	ÊNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›T™]š\Ú[Û”Ø]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆØ]™TÜXÚX[\›T™]š\Ú[ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›T™]š\Ú[ÛÛÛ[Z]
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆÛÛ[Z]ÜXÚX[\›T™]š\Ú[ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙKÈØ[\›Ý™Nˆ]ØZ]\ÔÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
HJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›T™]š\Ú[Û\›Ý™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
NÂˆ™]\›ˆ\›Ý™TÜXÚX[\›T™]š\Ú[ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›T™]š\Ú[Û”›Û˜XÚÊ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™TÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
NÂˆ™]\›ˆ›Û˜XÚÔÜXÚX[\›T™]š\Ú[ÛŠÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›SZYÜ˜][Û˜]Ú\Ý
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ\ÝÜXÚX[\›SZYÜ˜][Û˜]Ú\ÊÈ›Ü˜ÙNˆ›ÙK™›Ü˜ÙHOOHYHJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›P\›Ý˜[]Y]YJ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ\ÝÜXÚX[\›P\›Ý˜[]Y]YJÈ›Ü˜ÙNˆ›ÙK™›Ü˜ÙHOOHYK[Z]ˆ›ÙK›[Z]JNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›PÛ]\ÙPZQ˜Y
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ™]\›ˆ˜YÜXÚX[\›PÛ]\Ù\ÕÚ]ZJÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›\ÔØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÜÜXÚX[Ý\›\×ÛX[˜YÙIË	ÔÜXÚX[\›\È˜Y[™È\›Z\ÜÚ[Ûˆ\È™\]Z\™Y‰ÊNÂˆ™]\›ˆØ]™TÜXÚX[\›JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›\Ñ[]J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÜÜXÚX[Ý\›\×ÛX[˜YÙIË	ÔÜXÚX[\›\ÈX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™Y‰ÊNÂˆ™]\›ˆ[]TÜXÚX[\›JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙKÈ\Ð\›Ý™\Žˆ]ØZ]\ÔÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
HJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›T[TØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÜÜXÚX[Ý\›\×ÛX[˜YÙIË	ÔÜXÚX[\›\È˜Y[™È\›Z\ÜÚ[Ûˆ\È™\]Z\™Y‰ÊNÂˆ™]\›ˆØ]™TÜXÚX[\›T[JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙJNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÜXÚX[\›T[Q[]J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆÛÛœÝÛÛ^HXØÙ\ÜÐÛÛ^
]ØZ]™\]Z\™PXÝ]™U\Ù\Š™\JJNÂˆ]ØZ]™\]Z\™PØ\Xš[]JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K	ÜÜXÚX[Ý\›\×ÛX[˜YÙIË	ÔÜXÚX[\›\ÈX[˜YÙ[Y[\›Z\ÜÚ[Ûˆ\È™\]Z\™Y‰ÊNÂˆ™]\›ˆ[]TÜXÚX[\›T[JÛÛ^˜ÛY[ÛÛ^œ›Ùš[K›ÙKÈ\Ð\›Ý™\Žˆ]ØZ]\ÔÜXÚX[\›PÛ]\ÙP\›Ý™\ŠÛÛ^
HJNÂŸB‚™[˜Ý[Ûˆ˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
HÂˆ™]\›ˆÈÛY[ˆXØÙ\ÜÐÛÛ^˜ÛY[›Ùš[NˆXØÙ\ÜÐÛÛ^œ›Ùš[HNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\“\Ý
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\“\Ý
™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\˜XÚÙÜ›Ý[™Þ[˜Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\˜XÚÙÜ›Ý[™Þ[˜Ê™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\“X]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\“X]™J™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\“X]™TØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\“X]™TØ]™J™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\‘]Z[
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\‘]Z[
™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\‘\™XÝÜžJ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\‘\™XÝÜžJ™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\‘\™XÝÜžT™Yœ™\Ú
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\‘\™XÝÜžT™Yœ™\Ú
™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\”™\Ù]Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\”™\Ù]Ê™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\XÝ[ÛŠ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\XÝ[ÛŠ™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\XÝ[Û”Ý]\Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\XÝ[Û”Ý]\Ê™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\•[™Ê›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\•[™Ê™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\”™]žJ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\”™]žJ™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\‘š[[™Ô™]žJ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\‘š[[™Ô™]žJ™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\]XÚY[\›
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\]XÚY[\›
™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\]XÚY[^
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\]XÚY[^
™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\’X[
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\’X[
™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\Yš\ÛÜŠ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\Yš\ÛÜŠ™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\”Ù][™ÜÊ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\”Ù][™ÜÊ™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\”Ù][™ÜÔØ]™J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\”Ù][™ÜÔØ]™J™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\“Ý]›Þ
›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\“Ý]›Þ
™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\‘[J›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\‘[J™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\”ÝXœØÜš\[ÛŠ›ÙHHßK™\HH[XØÙ\ÜÐÛÛ^H[
HÂˆ™]\›ˆ˜]]™Q[XZ[›Ý]\”ÝXœØÜš\[ÛŠ™\K›ÙK˜]]™Q[XZ[›Ý]\‘\[™[˜ÚY\ÊXØÙ\ÜÐÛÛ^
JNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ[XZ[›Ý]\“XZ[[˜[˜ÙPÜ›ÛŠØ›ÙHHßK™\HH[
HÂˆ™\]Z\™PÜ›Û]]Üš^˜][ÛŠ™\JNÂˆÛÛœÝXZ[[˜[˜ÙTÝ\Y]H™]È]J
NÂˆÛÛœÝÛY[HÜ™X]Q[XZ[›Ý]\”Ù\šXÙPÛY[

NÂˆÛÛœÝ\™XÝÜžTÞ[˜ÈH]ØZ]ÛY[œœÊ	ÜÞ[˜×Ù[XZ[›Ý]\—Ù˜ÛÜ×Ù\Ý[˜][ÛœÉËÈØXÝÜŽˆ[JNÂˆÛÛœÝXZ[›ÞH]ØZ]Ý\œ™[[XZ[›Ý]\“XZ[›Þ
ÛY[
NÂˆÛÛœÝÝ]›ÞH]ØZ]›ØÙ\ÜÑ[XZ[›Ý]\“Ý]›Þ
ÈÛY[XZ[›Þ[Z]ˆHJNÂˆÛÛœÝX\›š[™ÈH]ØZ]›ØÙ\ÜÑ[XZ[›Ý]\“X\›š[™Ò›ØœÊÈÛY[XZ[›Þ[Z]ˆLJK˜Ø]Ú

\œ›ÜŠHOˆ
ÈÝ]\Îˆ	ÝØ\›š[™ÉËÛÙNˆ\œ›Ü‹˜ÛÙH	ÑSPRSÔ“ÕUT—ÓPT“’S‘×ÑRSQ	ÈJJNÂˆÛÛœÝÞ[˜Ú›Ûš^˜][ÛˆHßNÂˆ›Üˆ
ÛÛœÝ›Û\ˆÙˆÉÚ[˜›Þ	Ë	ÜÙ[][\ÉË	Ø\˜Ú]™I×JHÂˆÞ[˜Ú›Ûš^˜][Û–Ù›Û\—HH]ØZ]Þ[˜Ñ[XZ[›Ý]\‘›Û\‘œ›ÛTÝÜ™YÝ\œÛÜŠÈÛY[XZ[›Þ›Û\‹X^YÙ\ÎˆLJNÂˆBˆ]ÝXœØÜš\[ÛœÈH×NÂˆžHÂˆÝXœØÜš\[ÛœÈH]ØZ]XZ[Z[‘[XZ[›Ý]\”ÝXœØÜš\[ÛœÊÈÛY[XZ[›ÞJNÂˆ]ØZ]™\ÛÛ™Q[XZ[›Ý]\[\
ÛY[ÈY\RÙ^NˆXZ[›Þ‰ÛXZ[›ÞšYNœÝXœØÜš\[ÛœØJNÂˆHØ]Ú
\œ›ÜŠHÂˆ]ØZ]™XÛÜ™[XZ[›Ý]\[\
ÛY[ÈXZ[›ÞYˆXZ[›ÞšYÛÙNˆ\œ›Ü‹˜ÛÙH	Ù[XZ[Ü›Ý]\—ÜÝXœØÜš\[Û—Ù˜Z[Y	ËÙ]™\š]Nˆ	ØÜš]XØ[	ËY\RÙ^NˆXZ[›Þ‰ÛXZ[›ÞšYNœÝXœØÜš\[ÛœØJNÂˆ›ÝÈ\œ›ÜŽÂˆBˆYˆ
Y\™XÝÜžTÞ[˜Ë™\œ›Üˆ	‰ˆX\›š[™ÏËœÝ]\ÈOOH	ÝØ\›š[™ÉÊHÂˆ]ØZ]™\ÛÛ™T™XÛÝ™\™YÞ\Ý[Q\œ›Ü’[™\ŠÛY[	Ù[XZ[›Ý]\“XZ[[˜[˜ÙPÜ›Û‰ËÂˆ™\ÛÛ™Y›ÝYÚˆXZ[[˜[˜ÙTÝ\Y]ˆÙY[”Ú[˜ÙNˆ™]È]JXZ[[˜[˜ÙTÝ\Y]™Ù][YJ
HHMH
ˆŒÌ
KˆJK˜Ø]Ú

\œ›ÜŠHOˆÂˆÛÛœÛÛKØ\›Š	ÖÙ[XZ[\›Ý]\—H™XÛÝ™\™YXZ[[˜[˜ÙH›ÝYšXØ][ÛˆÛÝ[›Ý™H™\ÛÛ™Y‰ËÂˆÛÙNˆ\œ›ÜË˜ÛÙH	ÑSPRSÔ“ÕUT—Ó“ÕQ’PÐUSÓ—Ô‘PÓÕ‘T–WÑRSQ	ËˆJNÂˆJNÂˆBˆ™]\›ˆÂˆÚÎˆYKˆ\™XÝÜžNˆ\™XÝÜžTÞ[˜Ë™\œ›ÜˆÈÈÝ]\Îˆ	ÝØ\›š[™ÉÈHˆÈÝ]\Îˆ	ÜÞ[˜Ú›Ûš^™Y	ÈKˆÝ]›ÞˆX\›š[™ËˆÞ[˜Ú›Ûš^˜][ÛŽˆØš™XÝ™œ›ÛQ[šY\ÊØš™XÝ™[šY\ÊÞ[˜Ú›Ûš^˜][ÛŠK›X\

Ù›Û\‹™\Ý[JHOˆÙ›Û\‹ÈÞ[˜ÙYˆ™\Ý[œÞ[˜ÙY™[[Ý™Yˆ™\Ý[œ™[[Ý™YYÙ\Îˆ™\Ý[œYÙ\ËÛÛ\]Nˆ\™\Ý[›™^[šÈWJJKˆÝXœØÜš\[ÛœÎˆÝXœØÜš\[ÛœË›X\

][JHOˆ
È›Û\Žˆ][K™›Û\‹Ý]Nˆ][KœÝ]K^\™\Ð]ˆ][K™^\™\Ð]JJKˆNÂŸB‚˜ÛÛœÝ\›Ò[™\œÈHÜ™X]V\›Ò[™\œÊÈ™\]Z\™PXÝ]™U\Ù\‹™\ÛÛ™T™XÛÝ™\™YÞ\Ý[Q\œ›Ü’[™\ˆJNÂ˜ÛÛœÝ[™\œÈHÂˆ]]ÛÛ^ˆÜ[\XØ][ÛœÓ\ÝˆÜ[\XØ][Û“][˜ÚˆÜ[ÚYÛ“Ý]ˆÜ[[][Y[Þ[˜ÐÜ›Û‹ˆÛÛX›Ü˜][Û“\ÝˆÛÛX›Ü˜][Û‘]Z[ˆÛÛX›Ü˜][ÛÜ™X]KˆÛÛX›Ü˜][Û•\]KˆÛÛX›Ü˜][Û[Õ\]KˆÛÛX›Ü˜][Û‘›ÛÝÙ\•ÙÙÛKˆÛÛX›Ü˜][Û‘\[™[˜ÞTØ]™KˆÛÛX›Ü˜][Û‘\[™[˜ÞT™[[Ý™KˆÛÛX›Ü˜][Û“Z[\ÝÛ™TØ]™KˆÛÛX›Ü˜][Û•[\]S\ÝˆÛÛX›Ü˜][Û•[\]TØ]™KˆÛÛX›Ü˜][Û\˜Ú]™KˆÛÛX›Ü˜][ÛÛÛ[Y[Ø]™KˆÛÛX›Ü˜][ÛÛÛ[Y[[]KˆÛÛX›Ü˜][Û]XÚY[™\\™KˆÛÛX›Ü˜][Û]XÚY[ÛÛ\]KˆÛÛX›Ü˜][Û]XÚY[\›ˆÛÛX›Ü˜][Û]XÚY[[]KˆÛÛX›Ü˜][Û“›ÝYšXØ][ÛœÓ\ÝˆÛÛX›Ü˜][Û“›ÝYšXØ][ÛœÔ™XYˆÛÛX›Ü˜][Û‘Z[PÜ›Û‹ˆ[\›Ý™[Y[Ó\Ýˆ[\›Ý™[Y[]Z[ˆ[\›Ý™[Y[Ü™X]Kˆ[\›Ý™[Y[›ÜÜÙKˆ[\›Ý™[Y[XÚ\Ú[Û‹ˆ[\›Ý™[Y[]XÚY[™\\™Kˆ[\›Ý™[Y[]XÚY[ÛÛ\]Kˆ[\›Ý™[Y[]XÚY[\›ˆ[\›Ý™[Y[]XÚY[[]KˆÛÜšÓ›ÝYšXØ][ÛœÓ\ÝˆÛÜšÓ›ÝYšXØ][ÛœÔ™XYˆÛÜšÓ›ÝYšXØ][ÛœÔÝ]KˆÞ\Ý[Q\œ›Ü•™\šYžKˆÛÜšÐÛÛ[Z]Y[Ó\Ýˆ˜]šYØ][Û”™Y™\™[˜Ù\ÑÙ]ˆ˜]šYØ][Û”™Y™\™[˜Ù\ÔØ]™Kˆ˜]šYØ][Û”™Y™\™[˜Ù\Ô™\Ù]ˆÛÜšÜÜXÙT™Y™\™[˜Ù\ÑÙ]ˆÛÜšÜÜXÙT™Y™\™[˜Ù\ÔØ]™Kˆ[XZ[›Ý]\“\Ýˆ[XZ[›Ý]\˜XÚÙÜ›Ý[™Þ[˜Ëˆ[XZ[›Ý]\“X]™Kˆ[XZ[›Ý]\“X]™TØ]™Kˆ[XZ[›Ý]\‘]Z[ˆ[XZ[›Ý]\‘\™XÝÜžKˆ[XZ[›Ý]\‘\™XÝÜžT™Yœ™\Úˆ[XZ[›Ý]\”™\Ù]Ëˆ[XZ[›Ý]\XÝ[Û‹ˆ[XZ[›Ý]\XÝ[Û”Ý]\Ëˆ[XZ[›Ý]\•[™Ëˆ[XZ[›Ý]\”™]žKˆ[XZ[›Ý]\‘š[[™Ô™]žKˆ[XZ[›Ý]\]XÚY[\›ˆ[XZ[›Ý]\]XÚY[^ˆ[XZ[›Ý]\’X[ˆ[XZ[›Ý]\Yš\ÛÜ‹ˆ[XZ[›Ý]\”Ù][™ÜËˆ[XZ[›Ý]\”Ù][™ÜÔØ]™Kˆ[XZ[›Ý]\“Ý]›Þˆ[XZ[›Ý]\‘[Kˆ[XZ[›Ý]\”ÝXœØÜš\[Û‹ˆ[XZ[›Ý]\“XZ[[˜[˜ÙPÜ›Û‹‹‹ž\›Ò[™\œËˆYÙQ\ÚÑ[]KˆYÙSX\šÙ]ËˆX\šÙ][ÙTÛ˜\ÚÝˆX\šÙ][[YÙ[˜ÙPœšYY‹ˆX\šÙ][[YÙ[˜ÙPÝ\™KˆX\šÙ]™\ÜØ][ÙÝYKˆX\šÙ]™\Ü[˜[\Ú\ËˆX\šÙ][[YÙ[˜ÙU˜[X][Û‹ˆX\šÙ]›ÜØ\™˜[˜XÚÔØ]™KˆX\šÙ][[YÙ[˜ÙP[\[\ÑÙ]ˆX\šÙ][[YÙ[˜ÙP[\[\ÔØ]™KˆX\šÙ][[YÙ[˜ÙPÝ\™PÝ]Ý™\”Ø]™KˆX\šÙ][[YÙ[˜ÙP\˜Ú]™T™\^KˆX\šÙ][˜Y^TÛ˜\ÚÝ™]šY]ËˆX\šÙ][˜Y^TÛ˜\ÚÝØ]™KˆX\šÙ][˜Y^U[Y[[™KˆYÙQ\ÚÔ\œÙS[ÜËˆYÙQ\ÚÑÙ[™\˜]R[›ÚXÙKˆYÙQ\ÚÔØ]™R[›ÚXÙT‹ˆYÙQ\ÚÔÙ[™[›ÚXÙQ[XZ[ˆYÙQ\ÚÔÙœÔ™\ÜˆYÙQ\ÚÔÙœÑš[KˆYÙQ\ÚÔÙœÔÙ[™ˆYÙQ\ÚÔØ[\Ù›Ü˜ÙT\ÚˆYÙQ\ÚÔØ[\Ù›Ü˜ÙT™]šY]ËˆYÙQ\ÚÔØ[\Ù›Ü˜ÙSX\[™ËˆYÙQ\ÚÐ\ÜÚ\Ý[ˆYÙQ\ÚÐ\ÜÚ\Ý[Ù][™ÜËˆYÙQ\ÚÓXZ[[˜[˜ÙPÜ›Û‹ˆX\šÙ]™\Üš]™TÞ[˜ÐÜ›Û‹ˆX\Ý\ÛÛ˜XÝÓ\ÝˆX\Ý\ÛÛ˜XÝ]Z[ˆX\Ý\ÛÛ˜XÝØ]™KˆX\Ý\ÛÛ˜XÝXÚ\Ú[Û‹ˆX\Ý\ÛÛ˜XÝ]šY[˜ÙT™\\™KˆX\Ý\ÛÛ˜XÝ]šY[˜ÙPÛÛ\]KˆX\Ý\ÛÛ˜XÝ]šY[˜ÙU\›ˆX\Ý\ÛÛ˜XÝÜ[ÛœËˆX\Ý\ÛÛ˜XÝ™\ÜÙ[Ü™X]KˆX\Ý\ÛÛ˜XÝ™Y›YÚˆX\Ý\ÛÛ˜XÝ˜]ÚÜ™X]KˆX\Ý\ÛÛ˜XÝšXÙT™\ÛÛ™KˆX\Ý\ÛÛ˜XÝšXÙP\KˆX\Ý\ÛÛ˜XÝ™X]\™TØ]™KˆX\Ý\ÛÛ˜XÝ™XÛÛ˜Ú[KˆX\Ý\ÛÛ˜XÝ™XÛÛ˜Ú[PÜ›Û‹ˆÜXÚX[\›\ÕÛÜšÜÜXÙKˆÜXÚX[\›\ÔÝ[[X\žS\ÝˆÜXÚX[\›\ÓÜ[ÛœËˆÜXÚX[\›Q]Z[ˆÜXÚX[\›PÛ]\ÙP˜[šËˆÜXÚX[\›PÛ]\ÙTÚ[Z[\‹ˆÜXÚX[\›PÛ]\ÙQY]™]šY]ËˆÜXÚX[\›PÛ]\ÙQÛØ˜[X›\ÚˆÜXÚX[\›Q[]T™]šY]ËˆÜXÚX[\›SZYÜ˜][Û’[™[ÜžKˆÜXÚX[\›PÛ]\ÙQ˜YØ]™KˆÜXÚX[\›PÛ]\ÙP\›Ý™KˆÜXÚX[\›PÛ]\ÙT™]\™KˆÜXÚX[\›PÛ]\ÙQ[]KˆÜXÚX[\›PÛ]\ÙQ˜Y\ØØ\™ˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][Û“\ÝˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][Û”Ý\ˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][Û”™[[šËˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][ÛØ[˜Ù[ˆÜXÚX[\›PÛ]\ÙPÛÛœÛÛY][ÛÛÛ\]KˆÜXÚX[\›PÛÛ\ÜÚ][Û”Ø]™KˆÜXÚX[\›SZYÜ˜][Û”™]šY]ËˆÜXÚX[\›SZYÜ˜][Û”™]šY]Ð[ˆÜXÚX[\›SZYÜ˜][Û”Ø]™P[ˆÜXÚX[\›SZYÜ˜][Û”Ø]™KˆÜXÚX[\›SZYÜ˜][ÛXÝ]˜]KˆÜXÚX[\›SZYÜ˜][Û”›Û˜XÚËˆÜXÚX[\›T™]š\Ú[Û”Ø]™KˆÜXÚX[\›T™]š\Ú[ÛÛÛ[Z]ˆÜXÚX[\›T™]š\Ú[Û\›Ý™KˆÜXÚX[\›T™]š\Ú[Û”›Û˜XÚËˆÜXÚX[\›SZYÜ˜][Û˜]Ú\ÝˆÜXÚX[\›P\›Ý˜[]Y]YKˆÜXÚX[\›PÛ]\ÙPZQ˜YˆÜXÚX[\›\ÔØ]™KˆÜXÚX[\›\Ñ[]KˆÜXÚX[\›T[TØ]™KˆÜXÚX[\›T[Q[]KˆÜ›ÝÝ™\Ü[™Ó[™\Ó\ÝˆÜ›ÝÝ™\Ü[™Ó[™TØ]™KˆÜ›ÝÝ™\Ü[™Ó[™\ÔØ]™P˜]ÚˆÜ›ÝÝÛØXÚ[™Ð›ÛÝÝ˜\ˆÜ›ÝÝ[”Ø]™KˆÜ›ÝÝ[ÛÜÙ[Ý]ˆÜ›ÝÝÛØ[Ø]™KˆÜ›ÝÝÛØ[ÝX›Z]ˆÜ›ÝÝÛØ[XÚ\Ú[Û‹ˆÜ›ÝÝÛØ[›ÙÜ™\ÜÔØ]™KˆÜ›ÝÝÛØ[ÛÛ\][Û‹ˆÜ›ÝÝÛØ[]šY[˜ÙSÜ[ÛœËˆÜ›ÝÝÛØ[]šY[˜ÙTØ]™KˆÛØXÚ[™Ô™[][ÛœÚ\[š]KˆÛØXÚ[™Ô™[][ÛœÚ\™\ÜÛ™ˆÛØXÚ[™Ô™[][ÛœÚ\[™ˆÛØXÚ[™ÔÙ\ÜÚ[Û”Ø]™KˆÛØXÚ[™ÔÙ\ÜÚ[ÛÛÛ[Ø]™KˆÛØXÚ[™ÔÙ\ÜÚ[ÛÛÛ™š\›KˆÛØXÚ[™ÔÙ\ÜÚ[ÛØ[˜Ù[ˆÛØXÚ[™ÐXÝ[Û”Ø]™KˆÛØXÚ[™ÐXÝ[Û”X›\ÚˆÛØXÚ[™ÐXÝ[Û”›ÜÜØ[™\ÜÛ™ˆÜ›ÝÝ]XÚY[™\\™KˆÜ›ÝÝ]XÚY[ÛÛ\]KˆÜ›ÝÝ]XÚY[\›ˆÜ›ÝÝ[XZ[™Y™\™[˜Ù\ÔØ]™KˆÛØXÚ[™ÐØ[[™\”™\ÛÛ™KˆÛØXÚ[™ÐØ[[™\”™]žKˆÜ›ÝÝÛØXÚ[™ÑZ[PÜ›Û‹ˆØ[\Ù›Ü˜ÙTØÚ[XKˆØ[\Ù›Ü˜ÙSØš™XÝšY[Ëˆ\Ú›Ø\™š[\“Ü[ÛœËˆØ[\Ù›Ü˜ÙQ[ØÚ[XKˆØ[\Ù›Ü˜ÙQ\Ú›Ø\™ˆØ[\Ù›Ü˜ÙQ\Ú›Ø\™š[\™YˆØ[\Ù›Ü˜ÙQ\Ú›Ø\™š[\™YÛÛ\]Xš[]Kˆ\Ú›Ø\™Ý[[X\žKˆ\Ú›Ø\™Ý[S\Ýˆ\Ú›Ø\™[˜[]XÜËˆ\Ú›Ø\™XØÛÝ[[œÚYÚˆ\Ú›Ø\™XØÛÝ[Ü™Y]\™XÝÜžKˆ\Ú›Ø\™XØÛÝ[Ü™Y]Ý][Y[ˆ\Ú›Ø\™Ü™Y]›Ü™XØ\ÝÙ][™ÜÔØ]™Kˆ\Ú›Ø\™ÛÝ[\œ\TÙX\˜Úˆ\Ú›Ø\™XØÛÝ[^ÜÝ\™P˜]Úˆ\Ú›Ø\™ZTÙX\˜Úˆ\Ú›Ø\™ZTÙ][™ÜÑÙ]ˆ\Ú›Ø\™ZTÙ][™ÜÔØ]™KˆØ[\Ù›Ü˜ÙTÝ[Q]Z[ˆØ[\Ù›Ü˜ÙTÝ[Q]Z[[ˆØ[\Ù›Ü˜ÙTÝ[QØÝ[Y[Ëˆ[›Ù™šXÚX[ÛÛ\[œØ][Û“\Ýˆ[›Ù™šXÚX[ÛÛ\[œØ][Û“Ü[ÛœËˆ[›Ù™šXÚX[ÛÛ\[œØ][ÛÛZ[PÜ™X]Kˆ[›Ù™šXÚX[ÛÛ\[œØ][ÛÛZ[QÜ›Ý\Ý]\Ëˆ[›Ù™šXÚX[ÛÛ\[œØ][Û”™XÛÝ™\žPÜ™X]Kˆ[›Ù™šXÚX[ÛÛ\[œØ][Û”™XÛÝ™\žQ[]Kˆ^Ù\[Û”™]šY]ÕÛÜšÙ›ÝÓ\Ýˆ^Ù\[Û”™]šY]ÕÛÜšÙ›ÝÔØ]™KˆØ[\Ù›Ü˜ÙQ\ØÜšX™PÚ[™[‹ˆØ[\Ù›Ü˜ÙUÜ^Y\œËˆØ[\Ù›Ü˜ÙPœ›ÚÙ\”™YÚ\Ý\ŽˆØ[\Ù›Ü˜ÙPœ›ÚÙ\”™YÚ\Ý\‘[ˆØ[\Ù›Ü˜ÙP^Y\’[›ÚXÙ\ÑYKˆ^Y\’[›ÚXÙPÛÛXÝ[Û“\Ýˆ^Y\’[›ÚXÙPÛÛXÝ[Û”Ø]™Kˆ^Y\’[›ÚXÙPÛÛXÝ[Û‘]™[Ü™X]Kˆ^Y\’[›ÚXÙT^[Y[YšXÙTØ]™Kˆ^[Y[ÛÛXÝ[ÛœÔ™XÛÛ˜Ú[KˆÚ\YÙ[Ú\™Ù\Ó\ÝˆÚ\YÙ[Ú\™Ù\Ñ]Z[ˆÚ\YÙ[Ú\™Ù\ÓÜ[ÛœËˆÚ\YÙ[Ú\™Ù\ÔØ]™PÛÛ™š\›KˆÚ\YÙ[Ú\™Ù\ÑÛSÝ™\œšYKˆÚ\YÙ[Ú\™Ù\ÔÜÝ[›ÚXÙT™\ÛÛ™KˆÚ\YÙ[Ú\™Ù\ÔÞ[˜Ëˆ˜\šXX›PÚ\™Ù\Ó\Ýˆ˜\šXX›PÚ\™Ù\Ñ]Z[ˆ˜\šXX›PÚ\™Ù\Ð[˜ÚÜ˜YÙTØ]™K˜\šXX›PÚ\™Ù\Õ™\ÜÙ[œØ]™K˜\šXX›PÚ\™Ù\ÓYÚY\ÔØ]™K˜\šXX›PÚ\™Ù\ÔÙ][™ÜÑÙ]˜\šXX›PÚ\™Ù\ÔÙ][™ÜÔØ]™Kˆ˜\šXX›PÚ\™Ù\ÓÜ[ÛœËˆ˜\šXX›PÚ\™Ù\ÔÝ\Y\•™\šYžKˆ˜\šXX›PÚ\™Ù\Ð^Y\ÛÛ™š\›Kˆ˜\šXX›PÚ\™Ù\ÔÚYP\ÜÚYÛ‹ˆ˜\šXX›PÚ\™Ù\ÔÚYPÛÛ™š\›Kˆ˜\šXX›PÚ\™Ù\ÑÛSÝ™\œšYKˆ˜\šXX›PÚ\™Ù\ÔÜÝ[›ÚXÙT™\ÛÛ™Kˆ˜\šXX›PÚ\™Ù\ÔÞ[˜Ëˆ^Y\’[›ÚXÙTÜÝ[™Ô™[Z[™\“Ý™\œšYTØ]™Kˆ^[Y[ÛÛXÝ[ÛœÔ™XÛÛ˜Ú[PÜ›Û‹ˆ^Y\’[›ÚXÙQ[XZ[Ù][™ÜÑÙ]ˆ^Y\’[›ÚXÙQ[XZ[Ù][™ÜÔØ]™Kˆ^Y\’[›ÚXÙT™[Z[™\”[\Ó\Ýˆ^Y\’[›ÚXÙT™[Z[™\”[TØ]™Kˆ^Y\’[›ÚXÙT™[Z[™\”[T™[[Ý™Kˆ^Y\’[›ÚXÙT^[Y[™[Z[™\”™\\™Kˆ^Y\’[›ÚXÙT^[Y[™[Z[™\”Ù[™ˆÝ]Ý[™[™Ð^Y\’[›ÚXÙ\Ñ[XZ[™\ÜˆÝ]Ý[™[™Ð^Y\’[›ÚXÙ\Ñ[XZ[Ü›Û‹ˆ[˜ÛÛZ[™Ô^[Y[Ó\Ýˆ[˜ÛÛZ[™Ô^[Y[[XZ[Ù][™ÜÑÙ]ˆ[˜ÛÛZ[™Ô^[Y[[XZ[Ù][™ÜÔØ]™Kˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝÙ][™ÜÑÙ]ˆ[˜ÛÛZ[™Ô^[Y[[\™\ÝÙ][™ÜÔØ]™Kˆ[˜ÛÛZ[™Ô^[Y[[XZ[™\Üˆ[˜ÛÛZ[™Ô^[Y[[\™\Ý[›ÚXÙT™\]Y\Ýˆ[˜ÛÛZ[™Ô^[Y[Ù][™ÜÑÙ]ˆ[˜ÛÛZ[™Ô^[Y[Ù][™ÜÔØ]™Kˆ[˜ÛÛZ[™Ô^[Y[[ØØ][ÛÛÛ™š\›KˆØ\Ú›ÝÑ›Ü™XØ\ÝˆØ\Ú›ÝÐ^Y\”^[Y[\™›Ü›X[˜ÙKˆØ\Ú›ÝÔÙ][™ÜÑÙ]ˆØ\Ú›ÝÔÙ][™ÜÔØ]™KˆØ\Ú›ÝÒÛY^PØ[[™\‹ˆØ[\Ù›Ü˜ÙQ\Ü]TÝ[\Ëˆ\Ü]P™]S\Ýˆ\Ü]P™]TØ]™Q˜Yˆ\Ü]P™]TÝX›Z]\›Ý˜[ˆ\Ü]P™]P\›Ý™Kˆ\Ü]P™]T™Z™XÝˆ\Ü]P™]SX\šÑ^XÝ]Yˆ\Ü]P™]PÛÜÙKˆ\Ü]UÛÜšÙ›ÝÓ\Ýˆ\Ü]P™]S\Ýˆ\Ü]UÛÜšÙ›ÝÔØ]™Q˜Yˆ\Ü]P™]TØ]™Q˜Yˆ\Ü]UÛÜšÙ›ÝÔÝX›Z]\›Ý˜[ˆ\Ü]P™]TÝX›Z]\›Ý˜[ˆ\Ü]UÛÜšÙ›ÝÐ\›Ý™Nˆ\Ü]P™]P\›Ý™Kˆ\Ü]UÛÜšÙ›ÝÔ™Z™XÝˆ\Ü]P™]T™Z™XÝˆ\Ü]UÛÜšÙ›ÝÐXØÛÝ[[™Õ\]Kˆ\Ü]UÛÜšÙ›ÝÔÝ\Y\’[œÝXÝ[Û•\]Kˆ\Ü]UÛÜšÙ›ÝÔÝ\Y\“Ù™œÙ]Ü[ÛœËˆ\Ü]UÛÜšÙ›ÝÔÝ\Y\[[Ý[[Y[™ˆ\Ü]UÛÜšÙ›ÝÕ\ØYØÝ[Y[ˆ\Ü]UÛÜšÙ›ÝÑØÝ[Y[Ëˆ\Ü]UÛÜšÙ›ÝÓX\šÑ^XÝ]Yˆ\Ü]P™]SX\šÑ^XÝ]Yˆ\Ü]UÛÜšÙ›ÝÐÛÜÙNˆ\Ü]P™]PÛÜÙKˆ\Ü]UÛÜšÙ›ÝÐÛÛ\[œØ][ÛÛZ[\Ëˆ\Ü]UÛÜšÙ›ÝÐÛÛ\[œØ][ÛÛZ[S[šËˆ\Ü]UÛÜšÙ›ÝÐXØÙ\^\›˜[ÛÜÝ\™KˆÝ[T›ˆÝ[T›[ˆœ˜[šÙ\\•\ÙÛžT˜]Kˆœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”Ù][™ÜÑÙ]ˆœ›ÚÙ\ÛÛ[Z\ÜÚ[Û”Ù][™ÜÔØ]™Kˆ™\Ü^ÜÜ™X]Kˆ™\Ü^ÜÓ\Ýˆ™\Ü^Ü™[˜[YKˆ™\Ü^Ü[]Kˆ™\Ü^ÜÝÛ›ØYˆ^Y\œÐYZ[š\Ý˜]Ü“\Ýˆ^Y\œÐYZ[š\Ý˜]Ü”Ø]™KˆXØÛÝ[X[˜YÙ\œÓ\ÝˆXØÛÝ[X[˜YÙ\œÔØ]™KˆXØÛÝ[X[˜YÙ\œÔØ]™S›ÝKˆXØÛÝ[X[˜YÙ\œÔ™]žTÞ[˜ËˆXØÛÝ[XÑ\™XÝÜžS\ÝˆXØÛÝ[XÐXØÛÝ[Ü[ÛœËˆXØÛÝ[XÕ˜Y\“Ü[ÛœËˆXØÛÝ[XÑ\™XÝÜžQ]Z[ˆXØÛÝ[XÑ\™XÝÜžTØ]™KˆXØÛÝ[XÑ\™XÝÜžR[\ÜˆXØÛÝ[XÔ›ÝÐÛÛÜœÔØ]™Kˆ[XZ[Ù[™\”Ý]\Ëˆ[XZ[Ù[™\“XZ[›ÞØ]™Kˆ[XZ[Ù[™\”›Ý]TØ]™KˆÞ\Ý[RX[ˆYZ[•\Ù\œÓ\ÝˆYZ[]Y]ÙÜËˆYZ[•\Ù\”Ø]™KˆYZ[•\Ù\‘[]KˆYZ[”Ü[XØÙ\ÜÔØ]™KˆYZ[”Ü[XØÙ\ÜÔ™]žKˆYZ[”Ü[\XØ][ÛœÒX[ˆYZ[•\Ù\•\TØ]™KˆYZ[•\Ù\•\Q[]KˆYZ[‘˜ÛÜÕ\]\Ó\ÝˆYZ[‘˜ÛÜÕ\]\ÔÞ[˜ËˆYZ[‘˜ÛÜÕ\]R][TØ]™KˆYZ[‘˜ÛÜÕ\]P˜]ÚØ]™KˆYZ[‘˜ÛÜÕ\]P˜]ÚØ[˜Ù[ˆYZ[‘˜ÛÜÕ\]R][TÚÚ\ˆYZ[‘˜ÛÜÕ\]R][T™\ÝÜ™KˆYZ[‘˜ÛÜÕ\]P˜]ÚÙ[™ˆYZ[‘˜ÛÜÕ\]Q[]™\žT™]žKˆ[š]™\œØ[]Y]˜Z[ŸNÂ‚˜ÛÛœÝ[™\œÕÚ]Ý]XØÙ\ÜÔÛXÞHHØš™XÝšÙ^\Ê[™\œÊK™š[\Š
[™\“˜[YJHOˆZ[™\”ÛXÞQ›ÜŠS‘T—ÔÓPÖWÔ‘QÒTÕ–K[™\“˜[YJJNÂšYˆ
[™\œÕÚ]Ý]XØÙ\ÜÔÛXÞK›[™Ý
HÂˆ›ÝÈ™]È\œ›ÜŠÓÔÈ[™\ˆXØÙ\ÜÈÛXÞH\ÈZ\ÜÚ[™È›ÜŽˆ	Ú[™\œÕÚ]Ý]XØÙ\ÜÔÛXÞKš›Ú[Š	Ë	Ê_X
NÂŸB‚™^ÜY˜][\Þ[˜È[˜Ý[Ûˆ[™\Š™\K™\ÊHÂˆÛÛœÝ\›H™]ÈT“
™\K\›	Ú‹ËÛØØ[ÜÝ	ÊNÂˆÛÛœÝ˜[YHH\›œ]˜[YKœÜ]
	ËÉÊKœÜ

NÂˆÛÛœÝ™\]Y\ÝYH™\]Y\ÝYœ›ÛJ™\JNÂˆ™]\›ˆ[•Ú]™\]Y\Ý[[Y]žJˆÂˆ[™\Žˆ˜[YKˆ™\]Y\ÝYˆKˆ\Þ[˜È

HOˆÂˆžHÂˆÛÛœÝ[™\”ÛXÞHH[™\”ÛXÞQ›ÜŠS‘T—ÔÓPÖWÔ‘QÒTÕ–K˜[YJNÂˆYˆ
[™\”ÛXÞH	‰ˆ\[Ùˆ™\ÏËœÙ]XY\ˆOOH	Ù[˜Ý[Û‰ÊHÂˆ™\ËœÙ]XY\Š	ÖQÓÔËR[™\‹S]]][Û‰Ë[™\”ÛXÞK›]]][ÛˆÈ	ÌIÈˆ	Ì	ÊNÂˆ™\ËœÙ]XY\Š	ÖQÓÔËQ^\›˜[PXÝ[Û‰Ë[™\”ÛXÞK™^\›˜[XÝ[ÛˆÈ	ÌIÈˆ	Ì	ÊNÂˆBˆYˆ
˜[YHOOH	ÜØ[\Ù›Ü˜ÙQØÝ[Y[ÝÛ›ØY	ÊHÂˆ]ØZ]™\]Z\™R[™\XØÙ\ÜÊ˜[YK™\JNÂˆ™]\›ˆ]ØZ]Ø[\Ù›Ü˜ÙQØÝ[Y[ÝÛ›ØY
™\K™\ÊNÂˆBˆYˆ
˜[YHOOH	Ù\Ú›Ø\™XØÛÝ[[œÚYÚ^Ü	ÊHÂˆÛÛœÝXØÙ\ÜÐÛÛ^H]ØZ]™\]Z\™R[™\XØÙ\ÜÊ˜[YK™\JNÂˆÛÛœÝ›ÙHH]ØZ]™XY›ÙJ™\JNÂˆ™]\›ˆ]ØZ]\Ú›Ø\™XØÛÝ[[œÚYÚ^Ü
›ÙK™\K™\ËXØÙ\ÜÐÛÛ^
NÂˆBˆYˆ
˜[YHOOH	ÜÜXÚX[\›\Ô‘^Ü	È˜[YHOOH	ÜÜXÚX[\›\ÑØÝ[Y[^Ü	ÊHÂˆÛÛœÝXØÙ\ÜÐÛÛ^H]ØZ]™\]Z\™R[™\XØÙ\ÜÊ˜[YK™\JNÂˆÛÛœÝ›ÙHH]ØZ]™XY›ÙJ™\JNÂˆ™]\›ˆ˜[YHOOH	ÜÜXÚX[\›\Ô‘^Ü	ÂˆÈ]ØZ]ÜXÚX[\›\Ô‘^Ü
›ÙK™\K™\ËXØÙ\ÜÐÛÛ^
Bˆˆ]ØZ]ÜXÚX[\›\ÑØÝ[Y[^Ü
›ÙK™\K™\ËXØÙ\ÜÐÛÛ^
NÂˆBˆÛÛœÝ›ˆH[™\œÖÛ˜[YWNÂˆYˆ
Y›ŠH™]\›ˆÙ[™œÛÛŠ™\ËÈ\œ›ÜŽˆ[šÛ›ÝÛˆ[˜Ý[ÛŽˆ	Û˜[Y_XK
NÂˆÛÛœÝXØÙ\ÜÐÛÛ^H]ØZ]™\]Z\™R[™\XØÙ\ÜÊ˜[YK™\JNÂˆÛÛœÝ›ÙHH]ØZ]™XY›ÙJ™\JNÂˆÛÛœÝÛÛ˜XÝH˜[Y]Q[˜Ý[Û”™\]Y\Ý
˜[YK›ÙJNÂˆYˆ
XÛÛ˜XÝ›ÚÊHÂˆ›ÝÈ\\œ›ÜŠ[˜[Y	Û˜[Y_H™\]Y\Ýˆ	ØÛÛ˜XÝš\ÜÝY\Ëš›Ú[Š	ÎÈ	Ê_K˜	Ñ•SÕSÓ—ÐÓÓ•PÕÒS•SQ	ËÂˆÛÛ˜XÝ™\œÚ[ÛŽˆ•SÕSÓ—ÐÓÓ•PÕÕ‘T”ÒSÓ‹ˆJNÂˆBˆÛÛœÝ]HH]ØZ]›Š›ÙK™\KXØÙ\ÜÐÛÛ^
NÂˆ™]\›ˆÙ[™œÛÛŠ™\Ë]JNÂˆHØ]Ú
\œ›ÜŠHÂˆÛÛœÝÝ]\ÈH\œ›Ü‹œÝ]\È\œ›Ü‹œÝ]\ÐÛÙHLÂˆ™XÛÜ™™\]Y\Ý˜Z[\™J\œ›Ü‹Ý]\ÊNÂˆYˆ
ÚÝ[›ÝYžTÞ\Ý[Q\œ›ÜŠÝ]\ÊJHÂˆžHÂˆ]ØZ]™\ÜÞ\Ý[Q\œ›ÜŠØY™TÝ\X˜\ÙPYZ[ÛY[

KÂˆ[™\Žˆ˜[YKˆ\œ›Ü‹ˆÝ]\Ëˆ™\]Y\ÝYˆJNÂˆHØ]Ú
›ÝYšXØ][Û‘\œ›ÜŠHÂˆÛÛœÛÛK™\œ›ÜŠ	ÖÜÞ\Ý[KY\œ›Ü‹[›ÝYšXØ][Û—H™XÛÜ™[™È˜Z[Y	ËÂˆ[™\Žˆ˜[YKˆY\ÜØYÙNˆ›ÝYšXØ][Û‘\œ›Ü‹›Y\ÜØYÙKˆJNÂˆBˆBˆ™]\›ˆÙ[™œÛÛŠ™\ËX›XÐ\Q\œ›Ü”^[ØY
\œ›Ü‹Ý]\Ë™\]Y\ÝY
KÝ]\ÊNÂˆHš[˜[HÂˆÙÔ™\]Y\Ý[[Y]žJ™\ËœÝ]\ÐÛÙHL
NÂˆBˆKˆ
NÂŸB