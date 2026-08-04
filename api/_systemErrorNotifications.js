import { createHash } from 'node:crypto';

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

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
  workNotificationsList: {
    title: 'FCOS notifications are temporarily unavailable',
    message: 'The notification centre could not be refreshed. The error has been recorded for follow-up.',
    link: '/',
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

export function systemErrorDedupeKey({ handler, error, status, occurredAt = new Date() }) {
  const timestamp = occurredAt instanceof Date ? occurredAt.getTime() : new Date(occurredAt).getTime();
  const bucket = Math.floor((Number.isFinite(timestamp) ? timestamp : Date.now()) / DEDUPE_WINDOW_MS);
  return createHash('sha256')
    .update(`${cleanHandler(handler)}|${Number(status) || 500}|${redactedErrorSignature(error)}|${bucket}`)
    .digest('hex');
}

export async function reportSystemError(client, { handler, error, status = 500, requestId = null, occurredAt = new Date() } = {}) {
  if (!client || !shouldNotifySystemError(status)) return { recorded: false, skipped: true };
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
  return { recorded: true, eventId: data || null };
}
