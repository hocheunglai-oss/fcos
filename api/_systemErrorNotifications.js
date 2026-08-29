import { createHash } from 'node:crypto';

const HANDLER_CONTEXT = {
  outstandingBuyerInvoicesEmailReport: {
    title: 'Outstanding buyer invoices report failed',
    message: 'The internal outstanding buyer invoices report could not be completed. The error has been recorded for follow-up.',
    link: '/payment-collections?tab=collections',
  },
  outstandingBuyerInvoicesEmailCron: {
    title: 'Scheduled outstanding buyer invoices report failed',
    message: 'The scheduled outstanding buyer invoices report could not be completed. The error has been recorded for follow-up.',
    link: '/payment-collections?tab=collections',
  },
  incomingPaymentEmailReport: {
    title: 'Incoming payment report failed',
    message: 'The internal incoming payment report could not be completed. The error has been recorded for follow-up.',
    link: '/payment-collections?tab=incoming',
  },
  buyerInvoicePaymentReminderSend: {
    title: 'Payment reminder delivery failed',
    message: 'A payment reminder could not be completed. Review the current invoice and recipient information before retrying.',
    link: '/payment-collections?tab=collections',
  },
  hedgeDeskEntity: {
    title: 'Hedge Desk operation failed',
    message: 'A Hedge Desk record operation could not be completed. The error has been recorded for follow-up.',
    link: '/hedge-desk',
  },
  disputeWorkflowList: {
    title: 'Dispute Workflow refresh failed',
    message: 'The Dispute Workflow queue could not be refreshed. Review Salesforce connectivity before retrying.',
    link: '/disputes',
  },
  workNotificationsList: {
    title: 'FCOS notifications are temporarily unavailable',
    message: 'The notification centre could not be refreshed. The error has been recorded for follow-up.',
    link: '/',
  },
  specialTermsWorkspace: {
    title: 'Special Terms refresh failed',
    message: 'The Special Terms workspace could not be refreshed from Salesforce. The error has been recorded for follow-up.',
    link: '/special-terms',
  },
  hedgeDeskSalesforceMapping: {
    title: 'Hedge Desk Salesforce mapping failed',
    message: 'The Hedge Desk Salesforce mapping could not be refreshed. The error has been recorded for follow-up.',
    link: '/hedge-desk',
  },
  marketReportDriveSyncCron: {
    title: 'Market report synchronization needs attention',
    message: 'The hourly Google Drive market-report check did not complete or found a quarantined MOPS conflict. Existing verified prices remain available while the data-quality issue is reviewed.',
    link: '/markets',
  },
  emailRouterMaintenanceCron: {
    title: 'Email Router maintenance failed',
    message: 'Scheduled Email Router maintenance did not complete. The error has been recorded for follow-up.',
    link: '/email-router',
  },
  salesforceQuery: {
    title: 'Legacy Salesforce query failed',
    message: 'A legacy Salesforce query endpoint failed. FCOS can verify that this retired endpoint is no longer available.',
    link: '/',
  },
  xeroPortalContactLifecyclePreview: {
    title: 'Xero contact review failed',
    message: 'The Xero contact review could not be completed. FCOS will retry temporary read failures; review the Xero connection before trying again if the issue persists.',
    link: '/xero-portal',
  },
};

function cleanHandler(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 120) || 'unknown';
}

function handlerLabel(value) {
  const cleaned = cleanHandler(value).replaceAll('_', ' ');
  return cleaned
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function redactedErrorSignature(error) {
  return `${String(error?.name || 'Error')}:${String(error?.code || '')}:${String(error?.message || 'Unexpected server error')}`
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[a-z0-9]{15,18}\b/gi, '[record]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(?:eyJ|sk_|sb_)[A-Za-z0-9._-]{12,}\b/g, '[secret]')
    .slice(0, 500);
}

export function shouldNotifySystemError(status) {
  const value = Number(status);
  return Number.isInteger(value) && value >= 500 && value <= 599;
}

export function shouldRecordSystemErrorEnvironment(environment = process.env) {
  if (String(environment?.VERCEL_ENV || '').trim().toLowerCase() === 'production') return true;
  return String(environment?.FCOS_ALLOW_NONPRODUCTION_SYSTEM_ERROR_NOTIFICATIONS || '').trim() === '1';
}

export function validSystemErrorSignature(value) {
  const signature = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(signature) || /^bootstrap:[a-z0-9:._-]{1,100}$/.test(signature);
}

export function systemErrorPublicDescriptor(handler) {
  const key = cleanHandler(handler);
  if (HANDLER_CONTEXT[key]) return { handler: key, ...HANDLER_CONTEXT[key] };
  const label = handlerLabel(key);
  return {
    handler: key,
    title: 'FCOS operation failed',
    message: `An unexpected error occurred while FCOS was processing ${label || 'a request'}. The error has been recorded for follow-up.`,
    link: '/',
  };
}

/** @param {{handler?: string, error?: any, status?: number, occurredAt?: Date | string}} options */
export function systemErrorDedupeKey({ handler, error, status }) {
  return createHash('sha256')
    .update(`${cleanHandler(handler)}|${Number(status) || 500}|${redactedErrorSignature(error)}`)
    .digest('hex');
}

/**
 * @param {any} client
 * @param {{handler?: string, error?: any, status?: number, requestId?: string | null, occurredAt?: Date | string, environment?: NodeJS.ProcessEnv}} [options]
 */
export async function reportSystemError(client, { handler, error, status = 500, requestId = null, occurredAt = new Date(), environment = process.env } = {}) {
  if (!client || !shouldNotifySystemError(status)) return { recorded: false, skipped: true };
  if (!shouldRecordSystemErrorEnvironment(environment)) return { recorded: false, skipped: true, reason: 'non-production' };
  const descriptor = systemErrorPublicDescriptor(handler);
  const safeRequestId = String(requestId || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 128) || null;
  const dedupeKey = systemErrorDedupeKey({ handler: descriptor.handler, error, status, occurredAt });
  const { data, error: notificationError } = await client.rpc('record_system_error_event', {
    p_dedupe_key: dedupeKey,
    p_handler: descriptor.handler,
    p_http_status: Number(status),
    p_title: descriptor.title,
    p_message: descriptor.message,
    p_link: descriptor.link,
    p_request_id: safeRequestId,
    p_occurred_at: occurredAt instanceof Date ? occurredAt.toISOString() : new Date(occurredAt).toISOString(),
  });
  if (notificationError) throw notificationError;
  if (data && typeof client.from === 'function') {
    const { error: reopenError } = await client
      .from('system_error_notification_states')
      .update({ read_at: null, handled_at: null, snoozed_until: null, updated_at: new Date().toISOString() })
      .eq('event_id', data);
    if (reopenError && reopenError.code !== '42P01') throw reopenError;
  }
  return { recorded: true, eventId: data || null };
}

async function resolveSystemErrorEvents(client, eventQuery, resolvedAt) {
  const { data: events, error: eventError } = await eventQuery;
  if (eventError) {
    if (eventError.code === '42P01') return { resolved: 0, skipped: true };
    throw eventError;
  }
  if (!events?.length) return { resolved: 0 };
  const { data: profiles, error: profileError } = await client.from('user_profiles').select('id').eq('active', true);
  if (profileError) throw profileError;
  if (!profiles?.length) return { resolved: 0 };

  const eventIds = events.map((event) => event.id);
  const profileIds = profiles.map((profile) => profile.id);
  const { data: states, error: statesError } = await client
    .from('system_error_notification_states')
    .select('event_id,user_id,handled_at')
    .in('event_id', eventIds)
    .in('user_id', profileIds);
  if (statesError && statesError.code !== '42P01') throw statesError;
  const handled = new Set((states || [])
    .filter((state) => state.handled_at)
    .map((state) => `${state.event_id}:${state.user_id}`));

  const timestamp = resolvedAt.toISOString();
  const rows = events.flatMap((event) => profiles
    .filter((profile) => !handled.has(`${event.id}:${profile.id}`))
    .map((profile) => ({
      event_id: event.id,
      user_id: profile.id,
      read_at: timestamp,
      handled_at: timestamp,
      snoozed_until: null,
      updated_at: timestamp,
    })));
  if (!rows.length) return { resolved: 0 };
  const { error: stateError } = await client
    .from('system_error_notification_states')
    .upsert(rows, { onConflict: 'event_id,user_id' });
  if (stateError) throw stateError;
  return { resolved: rows.length };
}

export async function resolveSystemErrorIncident(client, signature, resolvedAt = new Date()) {
  const dedupeKey = String(signature || '').trim().toLowerCase();
  if (!client || !validSystemErrorSignature(dedupeKey)) return { resolved: 0, skipped: true };
  return resolveSystemErrorEvents(
    client,
    client.from('system_error_events').select('id').eq('dedupe_key', dedupeKey).limit(1),
    resolvedAt,
  );
}

export async function resolveRecoveredSystemErrorHandler(client, handler, {
  resolvedThrough = new Date(),
  seenSince = null,
  resolvedAt = new Date(),
} = {}) {
  const handlerKey = cleanHandler(handler);
  if (!client || handlerKey === 'unknown') return { resolved: 0, skipped: true };
  const cutoff = resolvedThrough instanceof Date ? resolvedThrough : new Date(resolvedThrough);
  if (Number.isNaN(cutoff.getTime())) return { resolved: 0, skipped: true };
  const earliest = seenSince == null ? null : (seenSince instanceof Date ? seenSince : new Date(seenSince));
  if (earliest && Number.isNaN(earliest.getTime())) return { resolved: 0, skipped: true };
  let eventQuery = client
    .from('system_error_events')
    .select('id')
    .eq('handler', handlerKey)
    .lte('last_seen_at', cutoff.toISOString());
  if (earliest) eventQuery = eventQuery.gte('last_seen_at', earliest.toISOString());
  return resolveSystemErrorEvents(
    client,
    eventQuery,
    resolvedAt,
  );
}
