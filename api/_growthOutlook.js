import { requireExternalActionGate } from './_externalActionGates.js';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_TIME_ZONE = 'China Standard Time';
let tokenCache = null;

function graphConfig(env = process.env) {
  return {
    tenantId: String(env.MICROSOFT_TENANT_ID || '').trim(),
    clientId: String(env.MICROSOFT_CLIENT_ID || '').trim(),
    clientSecret: String(env.MICROSOFT_CLIENT_SECRET || '').trim(),
  };
}

export function growthCalendarConfigured(env = process.env) {
  const config = graphConfig(env);
  return Boolean(config.tenantId && config.clientId && config.clientSecret);
}

function graphError(message, status = 503, code = 'OUTLOOK_CALENDAR_UNAVAILABLE', details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function calendarUrl(organizerEmail, suffix = '') {
  const mailbox = encodeURIComponent(String(organizerEmail || '').trim().toLowerCase());
  if (!mailbox) throw graphError('The coaching calendar organizer does not have an email address.', 400, 'OUTLOOK_ORGANIZER_REQUIRED');
  return `${GRAPH_BASE_URL}/users/${mailbox}/calendar/events${suffix}`;
}

async function graphToken({ force = false } = {}) {
  const config = graphConfig();
  if (!growthCalendarConfigured()) {
    throw graphError('Microsoft Graph calendar access is not configured.', 503, 'OUTLOOK_NOT_CONFIGURED');
  }
  if (!force && tokenCache?.token && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw graphError('Microsoft Graph rejected the FCOS calendar credentials.', 503, 'OUTLOOK_AUTH_FAILED');
  }
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000,
  };
  return tokenCache.token;
}

async function graphRequest(url, options = {}, retry = true) {
  const token = await graphToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 && retry) {
    tokenCache = null;
    await graphToken({ force: true });
    return graphRequest(url, options, false);
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const graphCode = String(payload?.error?.code || '');
    const status = response.status === 404 ? 404 : response.status === 412 ? 409 : 503;
    const code = response.status === 404
      ? 'OUTLOOK_EVENT_NOT_FOUND'
      : response.status === 412
        ? 'OUTLOOK_EVENT_CONFLICT'
        : graphCode === 'ErrorAccessDenied'
          ? 'OUTLOOK_MAILBOX_ACCESS_DENIED'
          : 'OUTLOOK_CALENDAR_FAILED';
    throw graphError(
      code === 'OUTLOOK_EVENT_CONFLICT'
        ? 'The Outlook event changed after FCOS last synchronized it.'
        : code === 'OUTLOOK_MAILBOX_ACCESS_DENIED'
          ? 'FCOS is not authorized for this Outlook mailbox.'
          : 'Outlook calendar synchronization failed.',
      status,
      code,
      { graphCode, requestId: response.headers.get('request-id') || null },
    );
  }
  return payload;
}

function graphDateTime(value, timeZone = GRAPH_TIME_ZONE) {
  const dateTime = String(value || '').trim();
  if (!dateTime) throw graphError('A coaching session date and time is required.', 400, 'OUTLOOK_TIME_REQUIRED');
  return { dateTime, timeZone };
}

export function growthCalendarEventPayload({
  subject,
  startDateTime,
  endDateTime,
  attendeeEmail,
  attendeeName,
  fcosUrl,
  transactionId,
  timeZone = GRAPH_TIME_ZONE,
}) {
  const attendee = String(attendeeEmail || '').trim().toLowerCase();
  const url = String(fcosUrl || '').trim();
  if (!attendee) throw graphError('The coaching participant does not have an email address.', 400, 'OUTLOOK_ATTENDEE_REQUIRED');
  return {
    subject: String(subject || 'FCOS 1:1 Coaching').trim().slice(0, 160),
    body: {
      contentType: 'HTML',
      content: `<p>This 1:1 coaching session is managed in FCOS.</p>${url ? `<p><a href="${url.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}">Open Growth &amp; Coaching</a></p>` : ''}<p>Agenda and coaching notes remain private in FCOS and are not included in this calendar event.</p>`,
    },
    start: graphDateTime(startDateTime, timeZone),
    end: graphDateTime(endDateTime, timeZone),
    attendees: [{
      emailAddress: {
        address: attendee,
        name: String(attendeeName || attendee).trim().slice(0, 255),
      },
      type: 'required',
    }],
    allowNewTimeProposals: true,
    isReminderOn: true,
    reminderMinutesBeforeStart: 30,
    showAs: 'busy',
    ...(transactionId ? { transactionId: String(transactionId).slice(0, 255) } : {}),
  };
}

export async function growthCalendarGet({ organizerEmail, eventId }) {
  if (!eventId) throw graphError('The Outlook event is required.', 400, 'OUTLOOK_EVENT_REQUIRED');
  return graphRequest(calendarUrl(organizerEmail, `/${encodeURIComponent(eventId)}`));
}

export async function growthCalendarCreate({ organizerEmail, event }) {
  requireExternalActionGate('outlook_calendar');
  return graphRequest(calendarUrl(organizerEmail), {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

export async function growthCalendarUpdate({ organizerEmail, eventId, expectedEtag, event }) {
  requireExternalActionGate('outlook_calendar');
  if (!eventId) throw graphError('The Outlook event is required.', 400, 'OUTLOOK_EVENT_REQUIRED');
  return graphRequest(calendarUrl(organizerEmail, `/${encodeURIComponent(eventId)}`), {
    method: 'PATCH',
    headers: expectedEtag ? { 'if-match': expectedEtag } : {},
    body: JSON.stringify(event),
  });
}

export async function growthCalendarCancel({ organizerEmail, eventId, expectedEtag }) {
  requireExternalActionGate('outlook_calendar');
  if (!eventId) return null;
  return graphRequest(calendarUrl(organizerEmail, `/${encodeURIComponent(eventId)}`), {
    method: 'DELETE',
    headers: expectedEtag ? { 'if-match': expectedEtag } : {},
  });
}

export async function growthCalendarHealth() {
  if (!growthCalendarConfigured()) {
    return { configured: false, status: 'Monitoring unavailable', error: 'Microsoft Graph calendar credentials are not configured.' };
  }
  try {
    await graphToken();
    return { configured: true, status: 'Online', error: null };
  } catch (error) {
    return { configured: true, status: 'Critical', error: error.message };
  }
}
