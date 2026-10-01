import {
  missingNomBList as missingNomBListService,
  missingNomBUpload as missingNomBUploadService,
  missingNomBStatus,
  runMissingNomBReminders,
} from './_missingNomB.js';

export function createMissingNomBHandlers({
  requireActiveUser,
  requireCronAuthorization,
  safeSupabaseAdminClient,
  appError,
  timedCheck,
  healthRow,
  configuredEnv,
  env = process.env,
  listService = missingNomBListService,
  uploadService = missingNomBUploadService,
  reminderService = runMissingNomBReminders,
  statusService = missingNomBStatus,
}) {
  async function missingNomBList(body = {}, req = null, accessContext = null) {
    return listService(body, accessContext || await requireActiveUser(req));
  }

  async function missingNomBUpload(body = {}, req = null, accessContext = null) {
    return uploadService(body, accessContext || await requireActiveUser(req));
  }

  async function missingNomBReminderCron(_body = {}, req = null) {
    requireCronAuthorization(req);
    const client = safeSupabaseAdminClient();
    if (!client) throw appError('FCOS database access is unavailable for Nom B reminders.', 503);
    return reminderService({ client, env });
  }

  async function missingNomBHealthRow() {
    const client = safeSupabaseAdminClient();
    const result = client ? await timedCheck(() => statusService({ client, env })) : null;
    return healthRow({
      id: 'missing-nom-b',
      name: 'Missing Nom B',
      category: 'Operations',
      purpose: 'Buyer-trader filing reminders, invoice scan progress, and verified Nom B uploads.',
      scope: 'server',
      provider: 'Salesforce / Microsoft Graph',
      endpoint: '/missing-nom-b',
      authType: 'FCOS session and protected cron',
      configured: Boolean(client),
      configuredEnv: configuredEnv(['FCOS_ENABLE_MISSING_NOM_B_REMINDERS']),
      notes: ['Checks final buyer invoice PDFs every five minutes after activation.', 'Uncertain delivery and upload outcomes require verification before another write.'],
    }, result);
  }

  return { missingNomBList, missingNomBUpload, missingNomBReminderCron, missingNomBHealthRow };
}
