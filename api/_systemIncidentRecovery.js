export function createSystemIncidentVerifier({ requireActiveUser, requireAdministratorContext, appError, validSystemErrorSignature, loadFinancialReportSettings, resolveGraphEmailSender, salesforceObjectFields, disputeWorkflowList, listSpecialTerms, getHedgeSalesforceMapping, hedgeMarkets, createEmailRouterServiceClient, currentEmailRouterMailbox, resolveSystemErrorIncident, isLegacyQueryRegistered }) {
async function verifyFinancialReportIncident(client, purposeKey) {
  await loadFinancialReportSettings(client, purposeKey, { required: true });
  await resolveGraphEmailSender(client, purposeKey);
}

return async function systemErrorVerify(body = {}, req = null, accessContext = null) {
  const context = accessContext || (await requireActiveUser(req));
  requireAdministratorContext(context);
  const verifiedThrough = new Date();
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
      await disputeWorkflowList({}, req, context);
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
      if (isLegacyQueryRegistered()) throw appError('The legacy Salesforce query endpoint is still registered.', 503, 'LEGACY_SALESFORCE_QUERY_ACTIVE');
      break;
    default:
      throw appError('This incident requires review in its affected workspace and cannot be verified automatically.', 400);
  }

  if (['outstandingBuyerInvoicesEmailReport', 'outstandingBuyerInvoicesEmailCron', 'incomingPaymentEmailReport', 'buyerInvoicePaymentReminderSend'].includes(incident.handler)) {
    return { verified: false, connectivityVerified: true, resolved: 0, incidentSignature,
      message: 'Connection checks passed. Delivery is still unconfirmed. Review the message history in the affected workspace before retrying or marking this incident handled.' };
  }
  const resolved = await resolveSystemErrorIncident(context.client, incidentSignature, verifiedThrough);
  return { verified: true, resolved: resolved.resolved || 0, incidentSignature };
};
}
