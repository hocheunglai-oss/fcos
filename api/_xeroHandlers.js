import { xeroCreditAllocationApply, xeroCreditAllocationPreview, xeroCreditAllocationReconcile, xeroCreditAllocationRecoveryQueue } from './_xeroCreditAllocationActions.js';
import { xeroNativeDocumentApply, xeroNativeDocumentReconcile, xeroNativeDocumentRecoveryQueue } from './_xeroNativeDocumentActions.js';
import { xeroPrepaymentApply, xeroPrepaymentContacts, xeroPrepaymentPreview, xeroPrepaymentQueue, xeroPrepaymentReconcile } from './_xeroPrepayments.js';
import { xeroPrepaymentPolicyGet, xeroPrepaymentPolicySave } from './_xeroPrepaymentPolicy.js';
import { xeroReconciliationCampaignCreate, xeroReconciliationCampaignRead, xeroReconciliationCampaignRefresh, xeroReconciliationCampaignPreview, xeroReconciliationCampaignApprove, xeroReconciliationCampaignRun, xeroReconciliationCampaignRetry, xeroReconciliationConnectionCheck } from './_xeroReconciliationCampaign.js';
import { xeroFinancialDocumentCorrectionPreview, xeroFinancialDocumentCorrectionPage, xeroFinancialDocumentCorrectionApply, xeroFinancialDocumentCorrectionVerify } from './_xeroDocumentCorrections.js';
import {
  invalidateContactNameCacheAfterRestore,
  xeroPortalConnectStart,
  xeroPortalContactAutoCreateLatest,
  xeroPortalContactAutoCreateRun,
  xeroPortalContactLifecycleApply,
  xeroPortalContactLifecycleLatest,
  xeroPortalContactLifecyclePreview,
  xeroPortalContactLifecycleRun,
  xeroPortalContactLifecycleStatus,
  xeroPortalDisconnect,
  xeroPortalReceiptCreate,
  xeroPortalReceiptUploadPrepare,
  xeroPortalReceiptFileUrl,
  xeroPortalReceiptSync,
  xeroPortalReceiptsList,
  xeroPortalStatus,
} from './_xeroPortal.js';
import {
  xeroFinancialMappingsGet,
  xeroFinancialMappingsSave,
  xeroFinancialPaymentApply,
  xeroFinancialSyncLatest,
  xeroFinancialSyncApply,
  xeroFinancialSyncPreview,
  xeroFinancialSyncRun,
} from './_xeroFinancialSync.js';
import { xeroContactIdentitySave } from './_xeroContactIdentity.js';
import { xeroContactRepairApply } from './_xeroContactRepair.js';
import { xeroContactRestoreApply } from './_xeroContactRestore.js';
import { xeroFinancialDocumentPreservationPreview, xeroFinancialDocumentPreservationRun } from './_xeroIssuedSupplierWorkflow.js';
import { supplierFinancialBucketApply, supplierFinancialBucketPreview, supplierFinancialBucketRead } from './_xeroSupplierFinancialBucketWorkflow.js';
import { xeroIntegrityReport } from './_xeroIntegrityReport.js';

export const XERO_HANDLER_MODULE_ACCESS = Object.freeze(Object.fromEntries([
  'xeroIntegrityReport',
  'xeroReconciliationCampaignCreate',
  'xeroReconciliationCampaignRead',
  'xeroReconciliationCampaignRefresh',
  'xeroReconciliationCampaignPreview',
  'xeroReconciliationCampaignApprove',
  'xeroReconciliationCampaignRun',
  'xeroReconciliationCampaignRetry',
  'xeroReconciliationConnectionCheck',
  'xeroPortalStatus',
  'xeroPortalConnectStart',
  'xeroPortalDisconnect',
  'xeroPortalReceiptsList',
  'xeroPortalReceiptCreate',
  'xeroPortalReceiptUploadPrepare',
  'xeroPortalReceiptSync',
  'xeroPortalReceiptFileUrl',
  'xeroPortalContactLifecycleStatus',
  'xeroPortalContactLifecycleLatest',
  'xeroPortalContactLifecycleRun',
  'xeroPortalContactLifecyclePreview',
  'xeroPortalContactLifecycleApply',
  'xeroContactIdentitySave',
  'xeroContactRepairApply',
  'xeroContactRestoreApply',
  'xeroPortalContactAutoCreateLatest',
  'xeroPortalContactAutoCreateRun',
  'xeroFinancialMappingsGet',
  'xeroPrepaymentPolicyGet',
  'xeroPrepaymentPolicySave',
  'xeroPrepaymentQueue',
  'xeroPrepaymentContacts',
  'xeroPrepaymentPreview',
  'xeroPrepaymentApply',
  'xeroPrepaymentReconcile',
  'xeroCreditAllocationPreview',
  'xeroCreditAllocationApply',
  'xeroCreditAllocationReconcile',
  'xeroCreditAllocationRecoveryQueue',
  'xeroNativeDocumentApply',
  'xeroNativeDocumentReconcile',
  'xeroNativeDocumentRecoveryQueue',
  'xeroFinancialMappingsSave',
  'xeroFinancialSyncPreview',
  'xeroFinancialSyncLatest',
  'xeroFinancialSyncApply',
  'xeroFinancialSyncRun',
  'xeroFinancialPaymentApply',
  'xeroFinancialDocumentCorrectionPreview',
  'xeroFinancialDocumentCorrectionPage',
  'xeroFinancialDocumentCorrectionApply',
  'xeroFinancialDocumentCorrectionVerify',
  'xeroFinancialDocumentPreservationPreview',
  'xeroFinancialDocumentPreservationRun',
  'xeroSupplierFinancialBucketPreview',
  'xeroSupplierFinancialBucketRead',
  'xeroSupplierFinancialBucketApply',
].map((name) => [name, ['xero_portal']])));

export function createXeroHandlers({ requireActiveUser, resolveRecoveredSystemErrorHandler }) {
  const wrap = (service, { recoveredHandler = null } = {}) => async (body = {}, req = null, accessContext = null) => {
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
  return {
    xeroIntegrityReport: wrap(xeroIntegrityReport),
    xeroReconciliationCampaignCreate: wrap(xeroReconciliationCampaignCreate),
    xeroReconciliationCampaignRead: wrap(xeroReconciliationCampaignRead),
    xeroReconciliationCampaignRefresh: wrap(xeroReconciliationCampaignRefresh),
    xeroReconciliationCampaignPreview: wrap(xeroReconciliationCampaignPreview),
    xeroReconciliationCampaignApprove: wrap(xeroReconciliationCampaignApprove),
    xeroReconciliationCampaignRun: wrap(xeroReconciliationCampaignRun),
    xeroReconciliationCampaignRetry: wrap(xeroReconciliationCampaignRetry),
    xeroReconciliationConnectionCheck: wrap(xeroReconciliationConnectionCheck),
    xeroPortalStatus: wrap(xeroPortalStatus),
    xeroPortalConnectStart: wrap(xeroPortalConnectStart),
    xeroPortalDisconnect: wrap(xeroPortalDisconnect),
    xeroPortalReceiptsList: wrap(xeroPortalReceiptsList),
    xeroPortalReceiptCreate: wrap(xeroPortalReceiptCreate),
    xeroPortalReceiptUploadPrepare: wrap(xeroPortalReceiptUploadPrepare),
    xeroPortalReceiptSync: wrap(xeroPortalReceiptSync),
    xeroPortalReceiptFileUrl: wrap(xeroPortalReceiptFileUrl),
    xeroPortalContactLifecycleStatus: wrap(xeroPortalContactLifecycleStatus),
    xeroPortalContactLifecycleLatest: wrap(xeroPortalContactLifecycleLatest),
    xeroPortalContactLifecycleRun: wrap(xeroPortalContactLifecycleRun),
    xeroPortalContactLifecyclePreview: wrap(xeroPortalContactLifecyclePreview, { recoveredHandler: 'xeroPortalContactLifecyclePreview' }),
    xeroPortalContactLifecycleApply: wrap(xeroPortalContactLifecycleApply),
    xeroContactIdentitySave: wrap(xeroContactIdentitySave),
    xeroContactRepairApply: wrap(xeroContactRepairApply),
    xeroContactRestoreApply: wrap((body, options) => xeroContactRestoreApply(body, { ...options, onRestored: invalidateContactNameCacheAfterRestore })),
    xeroPortalContactAutoCreateLatest: wrap(xeroPortalContactAutoCreateLatest),
    xeroPortalContactAutoCreateRun: wrap(xeroPortalContactAutoCreateRun),
    xeroFinancialMappingsGet: wrap(xeroFinancialMappingsGet),
    xeroPrepaymentPolicyGet: wrap(xeroPrepaymentPolicyGet),
    xeroPrepaymentPolicySave: wrap(xeroPrepaymentPolicySave),
    xeroPrepaymentQueue: wrap(xeroPrepaymentQueue),
    xeroPrepaymentContacts: wrap(xeroPrepaymentContacts),
    xeroPrepaymentPreview: wrap(xeroPrepaymentPreview),
    xeroPrepaymentApply: wrap(xeroPrepaymentApply),
    xeroPrepaymentReconcile: wrap(xeroPrepaymentReconcile),
    xeroCreditAllocationPreview: wrap(xeroCreditAllocationPreview),
    xeroCreditAllocationApply: wrap(xeroCreditAllocationApply),
    xeroCreditAllocationReconcile: wrap(xeroCreditAllocationReconcile),
    xeroCreditAllocationRecoveryQueue: wrap(xeroCreditAllocationRecoveryQueue),
    xeroNativeDocumentApply: wrap(xeroNativeDocumentApply),
    xeroNativeDocumentReconcile: wrap(xeroNativeDocumentReconcile),
    xeroNativeDocumentRecoveryQueue: wrap(xeroNativeDocumentRecoveryQueue),
    xeroFinancialMappingsSave: wrap(xeroFinancialMappingsSave),
    xeroFinancialSyncPreview: wrap(xeroFinancialSyncPreview, { recoveredHandler: 'xeroFinancialSyncPreview' }),
    xeroFinancialSyncLatest: wrap(xeroFinancialSyncLatest),
    xeroFinancialSyncApply: wrap(xeroFinancialSyncApply),
    xeroFinancialSyncRun: wrap(xeroFinancialSyncRun),
    xeroFinancialPaymentApply: wrap(xeroFinancialPaymentApply),
    xeroFinancialDocumentCorrectionPreview: wrap(xeroFinancialDocumentCorrectionPreview),
    xeroFinancialDocumentCorrectionPage: wrap(xeroFinancialDocumentCorrectionPage),
    xeroFinancialDocumentCorrectionApply: wrap(xeroFinancialDocumentCorrectionApply),
    xeroFinancialDocumentCorrectionVerify: wrap(xeroFinancialDocumentCorrectionVerify),
    xeroFinancialDocumentPreservationPreview: wrap(xeroFinancialDocumentPreservationPreview),
    xeroFinancialDocumentPreservationRun: wrap(xeroFinancialDocumentPreservationRun),
    xeroSupplierFinancialBucketPreview: wrap(supplierFinancialBucketPreview),
    xeroSupplierFinancialBucketRead: wrap(supplierFinancialBucketRead),
    xeroSupplierFinancialBucketApply: wrap(supplierFinancialBucketApply),
  };
}
