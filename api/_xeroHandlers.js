import {
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
  xeroPortalReceiptFileUrl,
  xeroPortalReceiptSync,
  xeroPortalReceiptsList,
  xeroPortalStatus,
} from './_xeroPortal.js';
import {
  xeroFinancialMappingsGet,
  xeroFinancialMappingsSave,
  xeroFinancialPaymentApply,
  xeroFinancialSyncApply,
  xeroFinancialSyncPreview,
  xeroFinancialSyncRun,
} from './_xeroFinancialSync.js';

export const XERO_HANDLER_MODULE_ACCESS = Object.freeze(Object.fromEntries([
  'xeroPortalStatus',
  'xeroPortalConnectStart',
  'xeroPortalDisconnect',
  'xeroPortalReceiptsList',
  'xeroPortalReceiptCreate',
  'xeroPortalReceiptSync',
  'xeroPortalReceiptFileUrl',
  'xeroPortalContactLifecycleStatus',
  'xeroPortalContactLifecycleLatest',
  'xeroPortalContactLifecycleRun',
  'xeroPortalContactLifecyclePreview',
  'xeroPortalContactLifecycleApply',
  'xeroPortalContactAutoCreateLatest',
  'xeroPortalContactAutoCreateRun',
  'xeroFinancialMappingsGet',
  'xeroFinancialMappingsSave',
  'xeroFinancialSyncPreview',
  'xeroFinancialSyncApply',
  'xeroFinancialSyncRun',
  'xeroFinancialPaymentApply',
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
    xeroPortalStatus: wrap(xeroPortalStatus),
    xeroPortalConnectStart: wrap(xeroPortalConnectStart),
    xeroPortalDisconnect: wrap(xeroPortalDisconnect),
    xeroPortalReceiptsList: wrap(xeroPortalReceiptsList),
    xeroPortalReceiptCreate: wrap(xeroPortalReceiptCreate),
    xeroPortalReceiptSync: wrap(xeroPortalReceiptSync),
    xeroPortalReceiptFileUrl: wrap(xeroPortalReceiptFileUrl),
    xeroPortalContactLifecycleStatus: wrap(xeroPortalContactLifecycleStatus),
    xeroPortalContactLifecycleLatest: wrap(xeroPortalContactLifecycleLatest),
    xeroPortalContactLifecycleRun: wrap(xeroPortalContactLifecycleRun),
    xeroPortalContactLifecyclePreview: wrap(xeroPortalContactLifecyclePreview, { recoveredHandler: 'xeroPortalContactLifecyclePreview' }),
    xeroPortalContactLifecycleApply: wrap(xeroPortalContactLifecycleApply),
    xeroPortalContactAutoCreateLatest: wrap(xeroPortalContactAutoCreateLatest),
    xeroPortalContactAutoCreateRun: wrap(xeroPortalContactAutoCreateRun),
    xeroFinancialMappingsGet: wrap(xeroFinancialMappingsGet),
    xeroFinancialMappingsSave: wrap(xeroFinancialMappingsSave),
    xeroFinancialSyncPreview: wrap(xeroFinancialSyncPreview, { recoveredHandler: 'xeroFinancialSyncPreview' }),
    xeroFinancialSyncApply: wrap(xeroFinancialSyncApply),
    xeroFinancialSyncRun: wrap(xeroFinancialSyncRun),
    xeroFinancialPaymentApply: wrap(xeroFinancialPaymentApply),
  };
}
