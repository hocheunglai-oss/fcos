import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getVercelOidcToken } from '@vercel/oidc';
import { requireExternalActionGate } from './_externalActionGates.js';
import { recordEmailRouterOperation } from './_requestTelemetry.js';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const FOLDERS = new Set(['inbox', 'sentitems', 'archive', 'deleteditems']);
const ACTIONS = new Set(['redirect', 'reply', 'forward', 'archive', 'move', 'delete', 'undo', 'mark_read']);
const RECIPIENT_KINDS = new Set(['to', 'cc', 'bcc']);
const MAX_ROUTING_RECIPIENTS = 100;
const MAX_MIME_BYTES = 25 * 1024 * 1024;
const GRAPH_SELECT = 'id,parentFolderId,receivedDateTime,sentDateTime,hasAttachments,isRead,importance';
const ROUTE_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const EMAIL_ROUTER_BACKGROUND_SYNC_MIN_INTERVAL_MS = 28_000;
const MARKET_REPORT_FOLDER_NAME = 'Market Report';
const MARKET_REPORT_FOLDER_CACHE_MS = 5 * 60 * 1000;
const marketReportFolderCache = new Map();

export const EMAIL_ROUTER_STORAGE = Object.freeze({
  mailboxes: 'mailbox_connections',
  messages: 'messages',
  attachmentMetadata: 'message_attachment_metadata',
  actions: 'mail_actions',
  outbox: 'mail_action_outbox',
  destinations: 'destinations',
  presetDestinations: 'routing_preset_destinations',
  presetVersions: 'routing_preset_versions',
  presetVersionConditions: 'routing_preset_version_conditions',
  presetVersionDestinations: 'routing_preset_version_destinations',
  routingLeaves: 'routing_leave_periods',
  presetOverrides: 'routing_preset_overrides',
  presets: 'routing_presets',
  subscriptions: 'mailbox_subscriptions',
  deltaState: 'mailbox_delta_state',
});

function routerTable(client, table) {
  return typeof client.schema === 'function'
    ? client.schema('emailrouter').from(table)
    : client.from(`emailrouter.${table}`);
}

export async function emailRouterProfilesById(client, profileIds = []) {
  const ids = [...new Set((profileIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const { data, error } = await client
    .from('user_profiles')
    .select('id,email,full_name,active')
    .in('id', ids);
  if (error) storageUnavailable(error);
  return new Map((data || []).map((profile) => [profile.id, profile]));
}

function routerError(message, status = 500, code = 'EMAIL_ROUTER_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function text(value, maximum = 500) {
  return String(value || '').trim().slice(0, maximum);
}

function safeId(value, label = 'identifier') {
  const result = text(value, 512);
  if (!result || /[\r\n\0]/.test(result)) throw routerError(`Invalid ${label}.`, 400, 'EMAIL_ROUTER_IDENTIFIER_INVALID');
  return result;
}

function safeAddress(value) {
  const address = text(value, 320).toLowerCase();
  if (!EMAIL.test(address) || /[\r\n\0]/.test(address)) throw routerError('A recipient address is invalid.', 400, 'EMAIL_ROUTER_RECIPIENT_INVALID');
  return address;
}

function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  return String(header).match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

export function createEmailRouterServiceClient(env = process.env, dependencies = {}) {
  if (dependencies.client) return dependencies.client;
  const url = text(env.SUPABASE_URL || env.VITE_SUPABASE_URL, 500);
  const key = text(env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  if (!url || !key) throw routerError('Email Router server storage is not configured.', 503, 'EMAIL_ROUTER_STORAGE_NOT_CONFIGURED');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireEmailRouterUser(req, dependencies = {}) {
  const client = createEmailRouterServiceClient(dependencies.env || process.env, dependencies);
  if (dependencies.profile) {
    const profile = dependencies.profile;
    if (!profile.active || !UUID.test(String(profile.id || ''))) throw routerError('Active FCOS user access required.', 403, 'EMAIL_ROUTER_USER_INACTIVE');
    return { client, profile, authUser: { id: profile.id } };
  }
  const token = bearerToken(req);
  if (!token) throw routerError('Sign-in required.', 401, 'EMAIL_ROUTER_SIGN_IN_REQUIRED');
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth?.user || !UUID.test(auth.user.id)) throw routerError('Invalid or expired session. Sign in again.', 401, 'EMAIL_ROUTER_SESSION_INVALID');
  const { data: profile, error } = await client
    .from('user_profiles')
    .select('id,email,full_name,user_type,active')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!profile?.active || profile.id !== auth.user.id || !UUID.test(profile.id)) throw routerError('Active FCOS user access required.', 403, 'EMAIL_ROUTER_USER_INACTIVE');
  return { client, profile, authUser: auth.user };
}

export function requireEmailRouterConfigurationAuthority(profile, isActiveGeneralManager = false) {
  const administrator = profile?.user_type === 'administrator';
  const generalManager = profile?.user_type === 'general_manager' && isActiveGeneralManager === true;
  if (!profile?.active || !UUID.test(String(profile.id || '')) || (!administrator && !generalManager)) {
    throw routerError('Administrator or active UUID-backed General Manager access required.', 403, 'EMAIL_ROUTER_CONFIGURATION_FORBIDDEN');
  }
  return profile;
}

export async function requireEmailRouterConfigurationUser(req, dependencies = {}) {
  const context = await requireEmailRouterUser(req, dependencies);
  if (context.profile.user_type === 'administrator') {
    return { ...context, profile: requireEmailRouterConfigurationAuthority(context.profile) };
  }
  const { data, error } = await context.client
    .from('collaboration_roles')
    .select('user_id')
    .eq('role', 'general_manager')
    .eq('active', true)
    .limit(2);
  if (error || (data || []).length !== 1) {
    throw routerError('General Manager role validation is unavailable or inconsistent.', 503, 'EMAIL_ROUTER_GENERAL_MANAGER_INVALID');
  }
  return {
    ...context,
    profile: requireEmailRouterConfigurationAuthority(context.profile, data[0].user_id === context.profile.id),
  };
}

function mailboxShape(row) {
  return {
    id: row.id,
    label: row.label || 'Microsoft 365 mailbox',
    active: row.state === 'active' || row.active === true,
    verificationState: row.verification_state || 'unverified',
    updatedAt: row.updated_at || null,
  };
}

let emailRouterMailboxReadCache = null;

/** The router mailbox is configured by a registry row, never a workflow field. */
export async function currentEmailRouterMailbox(client, { allowCached = false } = {}) {
  if (allowCached && emailRouterMailboxReadCache?.expiresAt > Date.now()) return emailRouterMailboxReadCache.value;
  const { data: route, error: routeError } = await client
    .from('email_sender_routes')
    .select('mailbox_id,email_sender_purposes(enabled),email_sender_mailboxes(id,email_address,label,active,verification_state,updated_at)')
    .eq('purpose_key', 'email_router_mailbox')
    .maybeSingle();
  if (routeError) throw routeError;
  const purpose = Array.isArray(route?.email_sender_purposes) ? route.email_sender_purposes[0] : route?.email_sender_purposes;
  const sender = Array.isArray(route?.email_sender_mailboxes) ? route.email_sender_mailboxes[0] : route?.email_sender_mailboxes;
  if (!route?.mailbox_id || purpose?.enabled !== true || !sender?.active || !sender.email_address) throw routerError('Email Router requires an active mailbox assigned through the FCOS Graph mailbox registry.', 503, 'EMAIL_ROUTER_MAILBOX_UNRESOLVED');
  const { data: connection, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.mailboxes)
    .select('id,sender_mailbox_id,state,provider_mailbox_id,updated_at')
    .eq('sender_mailbox_id', route.mailbox_id)
    .eq('state', 'active')
    .maybeSingle();
  if (error) storageUnavailable(error);
  if (!connection) throw routerError('The active FCOS Email Router mailbox connection is unavailable.', 503, 'EMAIL_ROUTER_CONNECTION_UNAVAILABLE');
  const value = { ...mailboxShape({ ...sender, ...connection }), senderMailboxId: sender.id, emailAddress: sender.email_address };
  emailRouterMailboxReadCache = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

let tokenCache = null;
async function graphAccessToken(env, dependencies = {}) {
  if (dependencies.accessToken) return dependencies.accessToken;
  if (tokenCache?.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const tenantId = text(env.FCOS_MICROSOFT_TENANT_ID, 200);
  const clientId = text(env.FCOS_MICROSOFT_CLIENT_ID, 200);
  if (!tenantId || !clientId) throw routerError('Microsoft Graph application configuration is incomplete.', 503, 'EMAIL_ROUTER_GRAPH_CONFIG_MISSING');
  let assertion = '';
  try { assertion = text(await (dependencies.oidcTokenProvider || getVercelOidcToken)(), 10_000); } catch { /* fail closed below */ }
  if (!assertion) throw routerError('Vercel OIDC identity is unavailable.', 503, 'EMAIL_ROUTER_OIDC_MISSING');
  const response = await (dependencies.fetchImpl || fetch)(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response?.ok) throw routerError('Microsoft Graph authentication failed.', 503, 'EMAIL_ROUTER_GRAPH_AUTH_FAILED');
  const payload = await response.json().catch(() => ({}));
  const value = text(payload.access_token, 20_000);
  if (!value) throw routerError('Microsoft Graph returned no access token.', 503, 'EMAIL_ROUTER_GRAPH_TOKEN_MISSING');
  tokenCache = { value, expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 300) * 1000 };
  return value;
}

export async function emailRouterGraphFetch(pathOrUrl, options = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  const token = await graphAccessToken(env, dependencies);
  const url = String(pathOrUrl).startsWith('https://') ? new URL(pathOrUrl) : new URL(`${GRAPH_ROOT}${pathOrUrl}`);
  if (url.protocol !== 'https:' || url.hostname !== 'graph.microsoft.com' || !url.pathname.startsWith('/v1.0/')) {
    throw routerError('Microsoft Graph request URL is invalid.', 400, 'EMAIL_ROUTER_GRAPH_URL_INVALID');
  }
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bearer ${token}`);
  headers.set('prefer', [headers.get('prefer'), 'IdType="ImmutableId"'].filter(Boolean).join(', '));
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  const response = await (dependencies.fetchImpl || fetch)(url, { ...options, headers, cache: 'no-store' });
  if (!response.ok && response.status !== 202) {
    const payload = await response.clone().json().catch(() => ({}));
    throw routerError('Microsoft Graph request failed.', response.status >= 500 ? 503 : response.status, payload?.error?.code || 'EMAIL_ROUTER_GRAPH_REQUEST_FAILED');
  }
  return response;
}

function mailboxPath(mailbox, path) {
  return `/users/${encodeURIComponent(mailbox.emailAddress)}${path.startsWith('/') ? path : `/${path}`}`;
}

function graphJson(response) {
  return response.status === 202 ? null : response.json().catch(() => null);
}

export function normalizeEmailRouterContentId(value) {
  let normalized = String(value || '')
    .replace(/&lt;|&#0*60;|&#x0*3c;/gi, '<')
    .replace(/&gt;|&#0*62;|&#x0*3e;/gi, '>')
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
    .trim()
    .replace(/^cid:/i, '')
    .replace(/^<|>$/g, '')
    .trim();
  try { normalized = decodeURIComponent(normalized); } catch { /* Preserve malformed provider values for an exact fallback match. */ }
  return normalized.replace(/^<|>$/g, '').trim().toLowerCase();
}

export function extractEmailRouterInlineContentIds(body) {
  const html = String(body || '');
  const values = [];
  const seen = new Set();
  const candidates = [
    ...[...html.matchAll(/\bsrc\s*=\s*(["'])\s*cid:([\s\S]*?)\1/gi)].map((match) => match[2]),
    ...[...html.matchAll(/\bsrc\s*=\s*cid:([^\s>]+)/gi)].map((match) => match[1]),
  ];
  for (const candidate of candidates) {
    const value = normalizeEmailRouterContentId(candidate);
    if (value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

function emailRouterAttachmentNameAliases(value) {
  const name = normalizeEmailRouterContentId(value);
  if (!name) return [];
  const beforeAt = name.includes('@') ? name.slice(0, name.indexOf('@')) : name;
  return [...new Set([name, beforeAt].filter(Boolean))];
}

export function resolveEmailRouterInlineAttachmentAliases(attachments, contentIds) {
  const aliasesByIndex = new Map();
  const unresolved = [];
  const normalizedAttachments = (attachments || []).map((attachment, index) => ({
    attachment,
    index,
    contentId: normalizeEmailRouterContentId(attachment?.contentId),
    nameAliases: emailRouterAttachmentNameAliases(attachment?.name),
  }));

  for (const contentId of contentIds || []) {
    const exact = normalizedAttachments.filter((item) => item.contentId && item.contentId === contentId);
    const candidates = exact.length
      ? exact
      : normalizedAttachments.filter((item) => {
          if (!String(item.attachment?.contentType || '').toLowerCase().startsWith('image/')) return false;
          const cidAliases = emailRouterAttachmentNameAliases(contentId);
          return item.nameAliases.some((alias) => cidAliases.includes(alias));
        });
    if (candidates.length !== 1) {
      unresolved.push(contentId);
      continue;
    }
    const aliases = aliasesByIndex.get(candidates[0].index) || [];
    aliases.push(contentId);
    aliasesByIndex.set(candidates[0].index, aliases);
  }

  return {
    attachments: normalizedAttachments.map(({ attachment, index }) => {
      const inlineAliases = aliasesByIndex.get(index) || [];
      return inlineAliases.length ? { ...attachment, isInline: true, inlineAliases } : attachment;
    }),
    unresolved,
  };
}

function messageMetadata(message, mailboxId, folder) {
  return {
    mailbox_id: mailboxId,
    provider_message_id: safeId(message.id, 'Graph message identifier'),
    folder_key: folder,
    received_at: message.receivedDateTime || null,
    sent_at: message.sentDateTime || null,
    has_attachments: message.hasAttachments === true,
    attachment_count: message.hasAttachments === true ? Math.max(1, Number(message.attachments?.length) || 0) : 0,
    is_read: message.isRead === true,
    importance: ['low', 'normal', 'high'].includes(message.importance) ? message.importance : null,
    message_kind: String(message['@odata.type'] || '').toLowerCase().includes('eventmessage') ? 'meeting' : 'message',
    deleted_at: null,
  };
}

function storageUnavailable(error) {
  if (error?.code === '42P01' || /does not exist|schema cache/i.test(String(error?.message || ''))) {
    throw routerError('Email Router storage is not ready. Apply its additive Supabase schema before enabling this route.', 503, 'EMAIL_ROUTER_STORAGE_NOT_READY');
  }
  throw error;
}

export async function syncEmailRouterMetadata({ client, mailbox, folder, messages }) {
  if (!FOLDERS.has(folder)) throw routerError('Unsupported mailbox folder.', 400, 'EMAIL_ROUTER_FOLDER_INVALID');
  const rows = (messages || []).filter((message) => message?.id && !message['@removed']).map((message) => messageMetadata(message, mailbox.id, folder));
  const removedIds = (messages || []).filter((message) => message?.id && message['@removed']).map((message) => safeId(message.id, 'Graph message identifier'));
  if (rows.length) {
    const { error } = await routerTable(client, EMAIL_ROUTER_STORAGE.messages).upsert(rows, { onConflict: 'mailbox_id,provider_message_id' });
    if (error) storageUnavailable(error);
  }
  if (removedIds.length) {
    const { error } = await routerTable(client, EMAIL_ROUTER_STORAGE.messages)
      .update({ deleted_at: new Date().toISOString() })
      .eq('mailbox_id', mailbox.id)
      .in('provider_message_id', removedIds);
    if (error) storageUnavailable(error);
  }
  return { synced: rows.length, removed: removedIds.length };
}

export async function listEmailRouterMetadata({ client, mailbox, folder = 'inbox', limit = 50 }) {
  if (!FOLDERS.has(folder)) throw routerError('Unsupported mailbox folder.', 400, 'EMAIL_ROUTER_FOLDER_INVALID');
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.messages)
    .select('provider_message_id,folder_key,received_at,sent_at,has_attachments,attachment_count,is_read,importance,message_kind,state,deleted_at')
    .eq('mailbox_id', mailbox.id)
    .eq('folder_key', folder)
    .is('deleted_at', null)
    .order('received_at', { ascending: false })
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)));
  if (error) storageUnavailable(error);
  return { mailbox: mailboxShape(mailbox), folder, items: data || [] };
}

function encodeGraphCursor(value) {
  return value ? Buffer.from(String(value), 'utf8').toString('base64url') : null;
}

function validatedMailboxGraphUrl(value, mailbox, code = 'EMAIL_ROUTER_CURSOR_INVALID') {
  const raw = String(value || '');
  const mailboxAddress = String(mailbox.emailAddress || '').toLowerCase();
  const validPath = (pathname) => {
    let decodedPath;
    try { decodedPath = decodeURIComponent(pathname).toLowerCase(); } catch { return false; }
    const path = decodedPath.startsWith('/v1.0/') ? decodedPath.slice('/v1.0'.length) : decodedPath;
    const mailboxRoot = `/users/${mailboxAddress}/mailfolders`;
    return path.startsWith(`${mailboxRoot}/`) || path.startsWith(`${mailboxRoot}(`);
  };
  if (raw.startsWith('/')) {
    if (!validPath(raw)) throw routerError('Mailbox cursor is invalid.', 400, code);
    return raw;
  }
  let url;
  try { url = new URL(raw); } catch { throw routerError('Mailbox cursor is invalid.', 400, code); }
  if (url.protocol !== 'https:' || url.hostname !== 'graph.microsoft.com' || !validPath(url.pathname)) {
    throw routerError('Mailbox cursor is invalid.', 400, code);
  }
  return url.toString();
}

function decodeGraphCursor(value, mailbox) {
  if (!value) return null;
  let decoded;
  try { decoded = Buffer.from(String(value), 'base64url').toString('utf8'); } catch { /* fail closed below */ }
  return validatedMailboxGraphUrl(decoded, mailbox);
}

function graphSearchTerm(value) {
  const query = text(value, 120).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return query ? `"${query}"` : '';
}

export async function listEmailRouterMessages({ client, mailbox, folder = 'inbox', limit = 30, search = '', cursor = null }, dependencies = {}) {
  const startedAt = Date.now();
  if (!FOLDERS.has(folder)) throw routerError('Unsupported mailbox folder.', 400, 'EMAIL_ROUTER_FOLDER_INVALID');
  const maximum = Math.min(50, Math.max(1, Number(limit) || 30));
  const selected = 'id,subject,from,receivedDateTime,sentDateTime,hasAttachments,isRead,importance';
  const nextUrl = decodeGraphCursor(cursor, mailbox);
  const params = new URLSearchParams({ '$select': selected, '$top': String(maximum) });
  const searchTerm = graphSearchTerm(search);
  if (searchTerm) params.set('$search', searchTerm);
  else params.set('$orderby', 'receivedDateTime desc');
  const path = nextUrl || mailboxPath(mailbox, `/mailFolders/${folder}/messages?${params.toString()}`);
  const graphStartedAt = Date.now();
  const response = await emailRouterGraphFetch(path, {
    headers: searchTerm ? { consistencyLevel: 'eventual' } : {},
  }, dependencies);
  const payload = await graphJson(response) || {};
  const graphMs = Date.now() - graphStartedAt;
  const messages = Array.isArray(payload.value) ? payload.value : [];
  const metadataStartedAt = Date.now();
  await syncEmailRouterMetadata({ client, mailbox, folder, messages });
  const metadataMs = Date.now() - metadataStartedAt;
  const performance = { operation: 'mailbox_list', totalMs: Date.now() - startedAt, graphMs, metadataMs };
  recordEmailRouterOperation({ ...performance, storageMs: metadataMs });
  return {
    mailbox: mailboxShape(mailbox),
    folder,
    items: messages,
    nextCursor: encodeGraphCursor(payload['@odata.nextLink']),
    total: messages.length,
    performance,
  };
}

async function listEmailRouterGraphAttachments(mailbox, messageId, dependencies) {
  const listAttachments = async (includeContentId) => {
    const selected = ['id', 'name', 'contentType', 'size', 'isInline', ...(includeContentId ? ['contentId'] : [])].join(',');
    const attachmentQuery = new URLSearchParams({ '$select': selected, '$top': '100' });
    let nextPath = mailboxPath(mailbox, `/messages/${encodeURIComponent(messageId)}/attachments?${attachmentQuery}`);
    const attachments = [];
    for (let page = 0; nextPath && page < 10; page += 1) {
      const pageResponse = await emailRouterGraphFetch(nextPath, {}, dependencies);
      const pagePayload = await graphJson(pageResponse) || {};
      attachments.push(...(Array.isArray(pagePayload.value) ? pagePayload.value : []));
      nextPath = pagePayload['@odata.nextLink'] || null;
    }
    return attachments;
  };
  try {
    return await listAttachments(true);
  } catch (error) {
    if (error?.status !== 400) throw error;
    return listAttachments(false);
  }
}

async function enrichEmailRouterInlineAttachments(mailbox, messageId, attachments, inlineContentIds, dependencies) {
  const metadataIndexes = inlineContentIds.length ? attachments
    .map((attachment, index) => attachment?.id
      && !attachment?.contentId
      && String(attachment?.contentType || '').toLowerCase().startsWith('image/')
      ? index
      : -1)
    .filter((index) => index >= 0)
    .slice(0, 50) : [];
  const inlineDetails = await Promise.all(metadataIndexes.map(async (index) => {
    const attachment = attachments[index];
    const inlineQuery = new URLSearchParams({ '$select': 'id,name,contentType,size,isInline,contentId' });
    try {
      const inlineResponse = await emailRouterGraphFetch(
        mailboxPath(mailbox, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}?${inlineQuery}`),
        {},
        dependencies,
      );
      return [index, await graphJson(inlineResponse)];
    } catch {
      return [index, null];
    }
  }));
  for (const [index, inlineDetail] of inlineDetails) {
    if (inlineDetail) attachments[index] = { ...attachments[index], ...inlineDetail };
  }
  return { attachments, metadataIndexes };
}

async function synchronizeEmailRouterAttachmentMetadata(client, indexed, attachments) {
  const rows = attachments.filter((attachment) => attachment?.id).map((attachment) => ({
    message_id: indexed.id,
    provider_attachment_id: safeId(attachment.id, 'attachment identifier'),
    content_type: text(attachment.contentType, 255) || null,
    byte_size: Math.max(0, Number(attachment.size) || 0),
    attachment_kind: String(attachment['@odata.type'] || '').toLowerCase().includes('itemattachment')
      ? 'item'
      : String(attachment['@odata.type'] || '').toLowerCase().includes('referenceattachment')
        ? 'reference'
        : String(attachment['@odata.type'] || '').toLowerCase().includes('fileattachment')
          ? 'file'
          : 'unknown',
    is_inline: attachment.isInline === true,
  }));
  if (rows.length) {
    const { error } = await routerTable(client, EMAIL_ROUTER_STORAGE.attachmentMetadata)
      .upsert(rows, { onConflict: 'message_id,provider_attachment_id' });
    if (error) storageUnavailable(error);
  }
  const { data: currentAttachments, error: currentError } = await routerTable(client, EMAIL_ROUTER_STORAGE.attachmentMetadata)
    .select('id,provider_attachment_id')
    .eq('message_id', indexed.id);
  if (currentError) storageUnavailable(currentError);
  const currentIds = new Set(rows.map((row) => row.provider_attachment_id));
  const staleIds = (currentAttachments || []).filter((row) => !currentIds.has(row.provider_attachment_id)).map((row) => row.id);
  if (staleIds.length) {
    const { error: staleError } = await routerTable(client, EMAIL_ROUTER_STORAGE.attachmentMetadata).delete().in('id', staleIds);
    if (staleError) storageUnavailable(staleError);
  }
  const { error: countError } = await routerTable(client, EMAIL_ROUTER_STORAGE.messages)
    .update({ has_attachments: rows.length > 0, attachment_count: rows.length })
    .eq('id', indexed.id);
  if (countError) storageUnavailable(countError);
}

async function loadEmailRouterActionHistory(client, indexed) {
  if (!indexed) return [];
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions)
    .select('id,action_type,state,requested_by,reserved_at,draft_created_at,submitted_at,confirmed_at,failed_at,uncertain_at')
    .eq('message_id', indexed.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) storageUnavailable(error);
  return (data || []).map((action) => ({
    id: action.id,
    action: action.action_type,
    status: action.state,
    at: action.confirmed_at || action.submitted_at || action.draft_created_at || action.failed_at || action.uncertain_at || action.reserved_at,
  }));
}

export async function fetchEmailRouterDetail({ client, mailbox, messageId, hasAttachmentsHint = false }, dependencies = {}) {
  const startedAt = Date.now();
  const id = safeId(messageId, 'message identifier');
  const detailWarnings = [];
  const performance = {};
  const query = new URLSearchParams({
    '$select': 'id,subject,from,sender,toRecipients,ccRecipients,bccRecipients,body,bodyPreview,receivedDateTime,sentDateTime,parentFolderId,hasAttachments,isRead,importance,internetMessageId',
  });
  const timed = async (key, operation) => {
    const stageStartedAt = Date.now();
    try { return await operation; } finally { performance[key] = Date.now() - stageStartedAt; }
  };
  const messagePromise = timed('messageMs', (async () => {
    const response = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(id)}?${query}`), {
      headers: { prefer: 'outlook.body-content-type="html"' },
    }, dependencies);
    return graphJson(response);
  })());
  const indexedPromise = timed('messageIndexMs', actionMessage(client, mailbox.id, id).catch((error) => {
    if (error?.code === 'EMAIL_ROUTER_MESSAGE_NOT_INDEXED') return null;
    throw error;
  }));
  const actionHistoryPromise = indexedPromise.then((indexed) => timed('actionHistoryMs', loadEmailRouterActionHistory(client, indexed)));
  let attachmentPromise = hasAttachmentsHint
    ? timed('attachmentMetadataMs', listEmailRouterGraphAttachments(mailbox, id, dependencies))
    : null;
  const message = await messagePromise;
  const inlineContentIds = String(message?.body?.contentType || '').toLowerCase() === 'html'
    ? extractEmailRouterInlineContentIds(message?.body?.content)
    : [];
  if (message?.hasAttachments || inlineContentIds.length || attachmentPromise) {
    try {
      attachmentPromise ||= timed('attachmentMetadataMs', listEmailRouterGraphAttachments(mailbox, id, dependencies));
      const listedAttachments = await attachmentPromise;
      const { attachments, metadataIndexes } = await timed(
        'inlineResolutionMs',
        enrichEmailRouterInlineAttachments(mailbox, id, listedAttachments, inlineContentIds, dependencies),
      );
      if (inlineContentIds.length && metadataIndexes.length < attachments.filter((attachment) => attachment?.id && !attachment?.contentId && String(attachment?.contentType || '').toLowerCase().startsWith('image/')).length) {
        detailWarnings.push('Some inline images were omitted because the message contains too many embedded items.');
      }
      const resolved = resolveEmailRouterInlineAttachmentAliases(attachments, inlineContentIds);
      message.attachments = resolved.attachments;
      if (resolved.unresolved.length) {
        detailWarnings.push(`${resolved.unresolved.length} inline ${resolved.unresolved.length === 1 ? 'image is' : 'images are'} unavailable in Microsoft 365.`);
      }
    } catch {
      message.attachments = [];
      detailWarnings.push('Attachments could not be refreshed. The message body remains available.');
      if (inlineContentIds.length) detailWarnings.push(`${inlineContentIds.length} inline ${inlineContentIds.length === 1 ? 'image is' : 'images are'} unavailable in Microsoft 365.`);
    }
  } else if (message) {
    message.attachments = [];
  }
  const indexed = await indexedPromise;
  const actionHistory = await actionHistoryPromise;
  if (indexed) {
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    const metadataJob = synchronizeEmailRouterAttachmentMetadata(client, indexed, attachments).catch(() => null);
    if (typeof dependencies.defer === 'function') dependencies.defer(metadataJob);
    else await timed('attachmentIndexMs', metadataJob);
  }
  performance.totalMs = Date.now() - startedAt;
  recordEmailRouterOperation({
    operation: 'message_detail',
    totalMs: performance.totalMs,
    graphMs: Math.max(performance.messageMs || 0, performance.attachmentMetadataMs || 0) + (performance.inlineResolutionMs || 0),
    storageMs: (performance.messageIndexMs || 0) + (performance.actionHistoryMs || 0) + (performance.attachmentIndexMs || 0),
  });
  return { ...message, actionHistory, detailWarnings, performance: { operation: 'message_detail', ...performance } };
}

export async function listEmailRouterDirectory({ client, search = '' }) {
  const now = new Date().toISOString();
  const [destinationResult, groupResult, leaveResult] = await Promise.all([
    routerTable(client, EMAIL_ROUTER_STORAGE.destinations)
      .select('id,destination_kind,user_profile_id,display_name,email_address,nickname,sort_order')
      .eq('active', true)
      .eq('redirect_enabled', true)
      .order('sort_order')
      .order('nickname')
      .limit(500),
    routerTable(client, 'destination_groups')
      .select('id,display_name,sort_order,destination_group_members(destination_id)')
      .eq('active', true)
      .eq('redirect_enabled', true)
      .order('sort_order')
      .order('display_name')
      .limit(500),
    routerTable(client, EMAIL_ROUTER_STORAGE.routingLeaves)
      .select('user_profile_id')
      .eq('active', true)
      .lte('starts_at', now)
      .gt('ends_at', now)
      .limit(500),
  ]);
  if (destinationResult.error) storageUnavailable(destinationResult.error);
  if (groupResult.error) storageUnavailable(groupResult.error);
  if (leaveResult.error) storageUnavailable(leaveResult.error);
  const destinations = destinationResult.data || [];
  const profiles = await emailRouterProfilesById(client, destinations.map((destination) => destination.user_profile_id));
  const leaveUserIds = new Set((leaveResult.data || []).map((leave) => leave.user_profile_id));
  const needle = text(search, 100).toLowerCase();
  const availableDestinationItems = destinations.map((destination) => {
    const profile = profiles.get(destination.user_profile_id);
    const isFcosUser = destination.destination_kind === 'fcos_profile';
    const displayName = isFcosUser ? profile?.full_name : destination.display_name;
    const emailAddress = isFcosUser ? profile?.email : destination.email_address;
    if ((isFcosUser && !profile?.active) || !emailAddress || !destination.nickname) return null;
    const searchable = `${destination.nickname} ${displayName || ''} ${emailAddress}`.toLowerCase();
    return {
      id: destination.id,
      kind: 'destination',
      label: destination.nickname,
      userProfileId: isFcosUser ? destination.user_profile_id : null,
      onLeave: isFcosUser && leaveUserIds.has(destination.user_profile_id),
      sortOrder: destination.sort_order,
      matchesSearch: !needle || searchable.includes(needle),
    };
  }).filter(Boolean);
  const availableDestinationIds = new Set(availableDestinationItems.map((item) => item.id));
  const destinationItems = availableDestinationItems.filter((item) => item.matchesSearch);
  const groupItems = (groupResult.data || []).map((group) => {
    const availableMembers = (group.destination_group_members || []).filter((member) => availableDestinationIds.has(member.destination_id));
    const memberCount = availableMembers.length;
    const onLeaveLabels = availableMembers
      .map((member) => availableDestinationItems.find((item) => item.id === member.destination_id))
      .filter((item) => item?.onLeave)
      .map((item) => item.label);
    const searchable = `${group.display_name || ''} group`.toLowerCase();
    if (!memberCount || (needle && !searchable.includes(needle))) return null;
    return { id: group.id, kind: 'group', label: group.display_name, memberCount, onLeaveLabels, sortOrder: group.sort_order };
  }).filter(Boolean);
  return [...destinationItems, ...groupItems]
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.label.localeCompare(right.label))
    .map(({ sortOrder: _sortOrder, matchesSearch: _matchesSearch, ...item }) => item);
}

function routingVersionDestinations(rows, versionId) {
  return sortEmailRouterPresetDestinations((rows || []).filter((row) => row.version_id === versionId)).map((row) => ({
    destinationId: row.destination_id || null,
    groupId: row.group_id || null,
    kind: row.recipient_kind,
    position: row.position,
  }));
}

export function resolveEmailRouterPresetVersion({ versions, overrides = [], activeLeaveUserIds = [], nicknameByUserId = new Map(), now = Date.now() }) {
  const activeVersions = (versions || []).filter((version) => version.active !== false);
  const baseline = activeVersions.find((version) => version.version_kind === 'baseline');
  if (!baseline) return { error: 'The Standard routing version is unavailable.' };
  const currentOverrides = (overrides || []).filter((entry) => entry.active !== false
    && new Date(entry.starts_at).getTime() <= now
    && new Date(entry.ends_at).getTime() > now
    && activeVersions.some((version) => version.id === entry.version_id));
  if (currentOverrides.length > 1) return { error: 'Multiple scheduled routing overrides are active.' };
  if (currentOverrides.length === 1) {
    const version = activeVersions.find((item) => item.id === currentOverrides[0].version_id);
    return { version, reason: 'Scheduled routing override', reasonType: 'override', matchedUserIds: [] };
  }

  const leaveIds = new Set(activeLeaveUserIds || []);
  const matches = activeVersions.filter((version) => version.version_kind === 'conditional').map((version) => {
    const conditionUserIds = Array.isArray(version.conditionUserIds) ? version.conditionUserIds : [];
    const matchedUserIds = conditionUserIds.filter((userId) => leaveIds.has(userId));
    const matched = version.match_mode === 'all'
      ? conditionUserIds.length > 0 && matchedUserIds.length === conditionUserIds.length
      : matchedUserIds.length > 0;
    return { version, matchedUserIds, specificity: matchedUserIds.length, matched };
  }).filter((item) => item.matched).sort((left, right) =>
    Number(right.version.priority || 0) - Number(left.version.priority || 0)
    || right.specificity - left.specificity);
  if (matches.length > 1
      && Number(matches[0].version.priority || 0) === Number(matches[1].version.priority || 0)
      && matches[0].specificity === matches[1].specificity) {
    return { error: `Routing versions ${matches[0].version.version_label} and ${matches[1].version.version_label} have equal priority and specificity.` };
  }
  if (!matches.length) return { version: baseline, reason: 'Standard routing', reasonType: 'baseline', matchedUserIds: [] };
  const selected = matches[0];
  const labels = selected.matchedUserIds.map((userId) => nicknameByUserId.get(userId)).filter(Boolean);
  return {
    version: selected.version,
    reason: labels.length ? `${labels.join(' and ')} on leave` : 'Leave cover routing',
    reasonType: 'leave',
    matchedUserIds: selected.matchedUserIds,
  };
}

async function emailRouterRoutingConfiguration(client) {
  const [destinations, groups, members] = await Promise.all([
    routerTable(client, EMAIL_ROUTER_STORAGE.destinations)
      .select('id,destination_kind,user_profile_id,email_address,nickname,active,redirect_enabled,sort_order,revision,updated_at')
      .order('id'),
    routerTable(client, 'destination_groups')
      .select('id,active,redirect_enabled,sort_order,revision,updated_at')
      .order('id'),
    routerTable(client, 'destination_group_members')
      .select('group_id,destination_id')
      .order('group_id')
      .order('destination_id'),
  ]);
  const failed = [destinations, groups, members].find((result) => result.error);
  if (failed?.error) storageUnavailable(failed.error);
  const profiles = await emailRouterProfilesById(client, (destinations.data || []).map((row) => row.user_profile_id));
  const profileRows = [...profiles.values()].map((profile) => ({ id: profile.id, email: profile.email, active: profile.active }));
  const fingerprint = createHash('sha256').update(JSON.stringify({
    destinations: destinations.data || [],
    groups: groups.data || [],
    members: members.data || [],
    profiles: profileRows.sort((left, right) => left.id.localeCompare(right.id)),
  })).digest('hex');
  return { destinations: destinations.data || [], groups: groups.data || [], members: members.data || [], profiles, fingerprint };
}

function routeDefinitionHash({ preset, version, destinations, configurationFingerprint }) {
  return createHash('sha256').update(JSON.stringify({
    presetId: preset.id,
    presetRevision: Number(preset.revision),
    versionId: version.id,
    versionRevision: Number(version.revision),
    destinations,
    configurationFingerprint,
  })).digest('hex');
}

export function createEmailRouterRouteSnapshotToken(value, env = process.env) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', attachmentSecret(env)).update(`route-snapshot-v1:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyEmailRouterRouteSnapshotToken(token, env = process.env) {
  const [payload, signature] = String(token || '').split('.');
  const expected = createHmac('sha256', attachmentSecret(env)).update(`route-snapshot-v1:${payload || ''}`).digest('base64url');
  if (!payload || !signature || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw routerError('The reviewed routing preset is invalid. Refresh the recipients.', 409, 'EMAIL_ROUTER_ROUTE_SNAPSHOT_INVALID');
  }
  let value;
  try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw routerError('The reviewed routing preset is invalid. Refresh the recipients.', 409, 'EMAIL_ROUTER_ROUTE_SNAPSHOT_INVALID'); }
  if (!Number.isFinite(value.issuedAt) || !Number.isFinite(value.expiresAt) || value.expiresAt <= value.issuedAt) {
    throw routerError('The reviewed routing preset is invalid. Refresh the recipients.', 409, 'EMAIL_ROUTER_ROUTE_SNAPSHOT_INVALID');
  }
  if (value.expiresAt < Date.now()) {
    throw routerError('The reviewed routing preset has expired. Refresh the recipients.', 409, 'EMAIL_ROUTER_ROUTE_SNAPSHOT_EXPIRED');
  }
  return value;
}

export async function listEmailRouterPresets(client, { profileId = null, env = process.env, now = Date.now() } = {}) {
  const timestamp = new Date(now).toISOString();
  const presetResult = await routerTable(client, EMAIL_ROUTER_STORAGE.presets)
    .select('id,display_name,description,active,revision,updated_at')
    .eq('active', true)
    .order('display_name');
  if (presetResult.error) storageUnavailable(presetResult.error);
  const presets = presetResult.data || [];
  if (!presets.length) return [];
  const presetIds = presets.map((preset) => preset.id);
  const [versionResult, destinationResult, conditionResult, overrideResult, leaveResult, configuration] = await Promise.all([
    routerTable(client, EMAIL_ROUTER_STORAGE.presetVersions)
      .select('id,preset_id,version_label,version_kind,match_mode,priority,active,revision,updated_at')
      .in('preset_id', presetIds),
    routerTable(client, EMAIL_ROUTER_STORAGE.presetVersionDestinations)
      .select('version_id,destination_id,group_id,recipient_kind,position'),
    routerTable(client, EMAIL_ROUTER_STORAGE.presetVersionConditions)
      .select('version_id,user_profile_id'),
    routerTable(client, EMAIL_ROUTER_STORAGE.presetOverrides)
      .select('id,preset_id,version_id,starts_at,ends_at,active')
      .in('preset_id', presetIds)
      .eq('active', true)
      .lte('starts_at', timestamp)
      .gt('ends_at', timestamp),
    routerTable(client, EMAIL_ROUTER_STORAGE.routingLeaves)
      .select('user_profile_id')
      .eq('active', true)
      .lte('starts_at', timestamp)
      .gt('ends_at', timestamp),
    emailRouterRoutingConfiguration(client),
  ]);
  const failed = [versionResult, destinationResult, conditionResult, overrideResult, leaveResult].find((result) => result.error);
  if (failed?.error) storageUnavailable(failed.error);
  const leaveUserIds = [...new Set((leaveResult.data || [])
    .map((leave) => leave.user_profile_id)
    .filter((userId) => configuration.profiles.get(userId)?.active === true))];
  const nicknameByUserId = new Map(configuration.destinations.filter((item) => item.user_profile_id).map((item) => [item.user_profile_id, item.nickname]));
  const destinationById = new Map(configuration.destinations.map((item) => [item.id, item]));
  const membersByGroup = new Map();
  for (const member of configuration.members) {
    const current = membersByGroup.get(member.group_id) || [];
    current.push(member.destination_id);
    membersByGroup.set(member.group_id, current);
  }

  return presets.map((preset) => {
    const versions = (versionResult.data || []).filter((version) => version.preset_id === preset.id).map((version) => ({
      ...version,
      conditionUserIds: (conditionResult.data || []).filter((condition) => condition.version_id === version.id).map((condition) => condition.user_profile_id),
    }));
    const resolved = resolveEmailRouterPresetVersion({
      versions,
      overrides: (overrideResult.data || []).filter((entry) => entry.preset_id === preset.id),
      activeLeaveUserIds: leaveUserIds,
      nicknameByUserId,
      now,
    });
    if (resolved.error) {
      return { id: preset.id, label: preset.display_name, description: preset.description, updatedAt: preset.updated_at, destinations: [], available: false, configurationIssue: resolved.error, warnings: [resolved.error] };
    }
    const destinations = routingVersionDestinations(destinationResult.data, resolved.version.id);
    const selectedDestinationIds = [...new Set(destinations.flatMap((selection) => selection.destinationId
      ? [selection.destinationId]
      : membersByGroup.get(selection.groupId) || []))];
    const onLeaveLabels = selectedDestinationIds.map((id) => destinationById.get(id)).filter((destination) => destination?.user_profile_id && leaveUserIds.includes(destination.user_profile_id)).map((destination) => destination.nickname).filter(Boolean);
    const warnings = onLeaveLabels.length ? [`Currently on leave: ${[...new Set(onLeaveLabels)].join(', ')}. Review the recipients before sending.`] : [];
    const definitionHash = routeDefinitionHash({ preset, version: resolved.version, destinations, configurationFingerprint: configuration.fingerprint });
    const issuedAt = now;
    const expiresAt = now + ROUTE_SNAPSHOT_TTL_MS;
    const routeSnapshotToken = profileId ? createEmailRouterRouteSnapshotToken({
      version: 1,
      profileId,
      presetId: preset.id,
      presetVersionId: resolved.version.id,
      definitionHash,
      reason: resolved.reason,
      issuedAt,
      expiresAt,
    }, env) : null;
    return {
      id: preset.id,
      label: preset.display_name,
      description: preset.description,
      updatedAt: preset.updated_at,
      destinations,
      available: true,
      effectiveVersion: { id: resolved.version.id, label: resolved.version.version_label, reason: resolved.reason, reasonType: resolved.reasonType },
      warnings,
      routeSnapshotToken,
      routeSnapshotExpiresAt: new Date(expiresAt).toISOString(),
    };
  });
}

export async function listEmailRouterRoutingLeaves(client, { profile, includeAll = false } = {}) {
  let query = routerTable(client, EMAIL_ROUTER_STORAGE.routingLeaves)
    .select('id,user_profile_id,starts_at,ends_at,note,active,revision,created_at,updated_at')
    .eq('active', true)
    .order('starts_at', { ascending: false })
    .limit(includeAll ? 1000 : 200);
  if (!includeAll) query = query.eq('user_profile_id', profile.id);
  const { data, error } = await query;
  if (error) storageUnavailable(error);
  const profiles = await emailRouterProfilesById(client, (data || []).map((row) => row.user_profile_id));
  let activeUsers = [];
  if (includeAll) {
    const { data: userRows, error: userError } = await client.from('user_profiles').select('id,email,full_name,active').eq('active', true).order('full_name').limit(500);
    if (userError) storageUnavailable(userError);
    activeUsers = userRows || [];
    for (const user of activeUsers) profiles.set(user.id, user);
  }
  return {
    scope: includeAll ? 'all' : 'self',
    periods: (data || []).map((row) => ({
      id: row.id,
      userProfileId: row.user_profile_id,
      userName: profiles.get(row.user_profile_id)?.full_name || 'FCOS user',
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      note: row.note,
      active: row.active,
      revision: Number(row.revision),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    users: includeAll ? activeUsers.map((row) => ({ id: row.id, name: row.full_name, email: row.email })) : [],
  };
}

export async function saveEmailRouterRoutingLeave(client, profile, operation) {
  const { data, error } = await client.rpc('save_emailrouter_routing_leave', {
    p_operation: operation,
    p_actor: profile.id,
  });
  if (error) {
    const stale = /revision conflict/i.test(error.message || '');
    throw routerError(stale ? 'This routing leave period changed after it was loaded. Refresh and try again.' : error.message || 'Routing leave could not be saved.', stale ? 409 : 400, stale ? 'EMAIL_ROUTER_REVISION_CONFLICT' : 'EMAIL_ROUTER_LEAVE_SAVE_FAILED');
  }
  return data;
}

const RECIPIENT_KIND_ORDER = new Map([['to', 0], ['cc', 1], ['bcc', 2]]);

export function sortEmailRouterPresetDestinations(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) =>
    (RECIPIENT_KIND_ORDER.get(left.recipient_kind || left.recipientKind || left.kind) ?? 99)
      - (RECIPIENT_KIND_ORDER.get(right.recipient_kind || right.recipientKind || right.kind) ?? 99)
    || Number(left.position || 0) - Number(right.position || 0));
}

function headerBoundary(raw) {
  const maximum = Math.min(raw.length - 3, 256 * 1024);
  for (let index = 0; index < maximum; index += 1) {
    if (raw[index] === 13 && raw[index + 1] === 10 && raw[index + 2] === 13 && raw[index + 3] === 10) return { end: index, start: index + 4 };
    if (raw[index] === 10 && raw[index + 1] === 10) return { end: index, start: index + 2 };
  }
  throw routerError('The original message MIME headers are invalid.', 400, 'EMAIL_ROUTER_REDIRECT_MIME_INVALID');
}

function parseHeaders(raw, end) {
  const source = Buffer.from(raw.subarray(0, end)).toString('latin1');
  if (source.includes('\0') || /(^|[^\r])\r(?!\n)/.test(source)) throw routerError('The original message MIME headers are invalid.', 400, 'EMAIL_ROUTER_REDIRECT_MIME_INVALID');
  const fields = [];
  for (const line of source.split(/\r\n|\n/)) {
    if (/^[ \t]/.test(line)) {
      if (!fields.length) throw routerError('The original message MIME headers are invalid.', 400, 'EMAIL_ROUTER_REDIRECT_MIME_INVALID');
      fields.at(-1).raw += `\r\n${line}`;
      fields.at(-1).value += ` ${line.trim()}`;
      continue;
    }
    const match = line.match(/^([A-Za-z0-9!#$%&'*+\-.^_`|~]+):(.*)$/);
    if (!match) throw routerError('The original message MIME headers are invalid.', 400, 'EMAIL_ROUTER_REDIRECT_MIME_INVALID');
    fields.push({ name: match[1].toLowerCase(), value: match[2].trim(), raw: `${match[1]}:${match[2]}` });
  }
  return fields;
}

function singleHeader(fields, name, label) {
  const values = fields.filter((field) => field.name === name);
  if (values.length !== 1) {
    throw routerError(`The original message has an unavailable or ambiguous ${label}.`, 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
  }
  return values[0];
}

function parsedMailbox(value) {
  const match = value.match(/(?:^|<)([^<>\s]+@[^<>\s]+)(?:>|$)/);
  const address = safeAddress(match?.[1] || '');
  const name = text(value.replace(/<[^>]*>/g, '').replace(/^"|"$/g, ''), 256) || address;
  if (/[\0-\x1f\x7f]/.test(name)) throw routerError('The original message cannot be safely redirected.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
  return { address, name };
}

function encodedWord(value) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function normalizedRecipients(recipients) {
  const known = new Set();
  const output = [];
  for (const kind of ['to', 'cc', 'bcc']) {
    for (const item of Array.isArray(recipients) ? recipients : []) {
      if (item?.kind !== kind) continue;
      const address = safeAddress(item.address);
      if (!known.has(address)) { known.add(address); output.push({ address, kind }); }
    }
  }
  if (!output.length) throw routerError('At least one redirect recipient is required.', 400, 'EMAIL_ROUTER_RECIPIENT_REQUIRED');
  return output;
}

function removeRedirectUnsafeHeader(name) {
  return ['from', 'sender', 'reply-to', 'to', 'cc', 'bcc', 'subject', 'message-id', 'return-path', 'received', 'authentication-results', 'dkim-signature', 'domainkey-signature', 'content-length'].includes(name)
    || name.startsWith('resent-') || name.startsWith('arc-') || name.startsWith('x-ms-exchange-') || name.startsWith('x-forefront-antispam') || name === 'x-emailrouter-redirect';
}

export function buildEmailRouterRedirectMime({ raw, mailboxAddress, recipients }) {
  const input = Buffer.from(raw);
  if (input.byteLength > MAX_MIME_BYTES) throw routerError('The original message is too large for safe redirect.', 400, 'EMAIL_ROUTER_REDIRECT_TOO_LARGE');
  const boundary = headerBoundary(input);
  const fields = parseHeaders(input, boundary.end);
  if (fields.some((field) => field.name === 'x-emailrouter-redirect')) {
    throw routerError('This message was previously redirected by FCOS. Redirect is blocked to prevent duplicate delivery.', 409, 'EMAIL_ROUTER_REDIRECT_ALREADY_REDIRECTED');
  }
  const contentType = fields.filter((field) => field.name === 'content-type').map((field) => field.value).join(' ');
  if (/multipart\/signed|application\/(?:x-)?pkcs7-mime|text\/calendar/i.test(contentType) || fields.some((field) => field.name === 'x-ms-exchange-organization-rightsprotectmessage')) throw routerError('Protected, signed, or meeting messages cannot be safely redirected.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
  const sender = parsedMailbox(singleHeader(fields, 'from', 'sender header').value);
  const replyTo = fields.filter((field) => field.name === 'reply-to');
  if (replyTo.length > 1) throw routerError('The original message has ambiguous reply addresses.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
  const reply = replyTo.length ? parsedMailbox(replyTo[0].value).address : sender.address;
  const subjectFields = fields.filter((field) => field.name === 'subject');
  if (subjectFields.length > 1) throw routerError('The original message has ambiguous subject headers.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
  const subject = text(subjectFields[0]?.value, 900);
  if (/[\0-\x1f\x7f]/.test(subject)) throw routerError('The original message cannot be safely redirected.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
  const routes = normalizedRecipients(recipients);
  const visible = (kind) => routes.filter((route) => route.kind === kind).map((route) => `<${route.address}>`).join(',\r\n ');
  const mailbox = safeAddress(mailboxAddress);
  const headers = [
    `From: ${encodedWord(sender.name)} <${mailbox}>`,
    `Reply-To: <${reply}>`,
    ...(visible('to') ? [`To: ${visible('to')}`] : []),
    ...(visible('cc') ? [`Cc: ${visible('cc')}`] : []),
    `Subject: ${encodedWord(`[${subject}]`)}`,
    'X-EmailRouter-Redirect: graph-mime-v1',
    ...fields.filter((field) => !removeRedirectUnsafeHeader(field.name)).map((field) => field.raw),
  ].join('\r\n');
  return { raw: Buffer.concat([Buffer.from(`${headers}\r\n\r\n`, 'latin1'), input.subarray(boundary.start)]), envelopeRecipients: routes.map((route) => route.address) };
}

async function createAction(client, values) {
  const fields = 'id,state,action_type,message_id,provider_operation_id,request_fingerprint,idempotency_key,uncertain_at';
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions).insert(values).select(fields).single();
  if (!error) return { ...data, duplicate: false };
  if (error.code !== '23505') storageUnavailable(error);
  const { data: existing, error: existingError } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions)
    .select(fields)
    .eq('idempotency_key', values.idempotency_key)
    .maybeSingle();
  if (existingError) storageUnavailable(existingError);
  if (!existing) storageUnavailable(error);
  if (existing.request_fingerprint !== values.request_fingerprint) {
    throw routerError('This operation identifier was already used for a different mail action.', 409, 'EMAIL_ROUTER_IDEMPOTENCY_CONFLICT');
  }
  return { ...existing, duplicate: true };
}

async function updateAction(client, id, values) {
  const { error } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions).update(values).eq('id', id);
  if (error) storageUnavailable(error);
}

async function recordEvent(client, { eventType, entityType, entityId, actorUserId = null, correlationId = null }) {
  const { error } = await routerTable(client, 'events').insert({
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    actor_user_id: actorUserId,
    correlation_id: correlationId,
    idempotency_key: randomUUID(),
  });
  if (error) console.warn('[email-router] Audit event could not be recorded.', { code: error.code || 'EMAIL_ROUTER_EVENT_FAILED' });
}

export async function recordEmailRouterAlert(client, { mailboxId = null, messageId = null, mailActionId = null, code, severity = 'warning', dedupeKey }) {
  const normalizedCode = String(code || 'email_router_warning').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
  const { error } = await routerTable(client, 'alerts').upsert({
    mailbox_id: mailboxId,
    message_id: messageId,
    mail_action_id: mailActionId,
    alert_code: normalizedCode,
    severity: ['info', 'warning', 'critical'].includes(severity) ? severity : 'warning',
    state: 'open',
    dedupe_key: String(dedupeKey || `${normalizedCode}:${mailActionId || mailboxId || randomUUID()}`).slice(0, 200),
    acknowledged_by: null,
    acknowledged_at: null,
    resolved_by: null,
    resolved_at: null,
  }, { onConflict: 'dedupe_key' });
  if (error) console.warn('[email-router] Operational alert could not be recorded.', { code: error.code || 'EMAIL_ROUTER_ALERT_FAILED' });
}

export async function resolveEmailRouterAlert(client, { dedupeKey }) {
  const normalizedDedupeKey = text(dedupeKey, 200);
  if (!normalizedDedupeKey) return;
  const { error } = await routerTable(client, 'alerts')
    .update({ state: 'resolved', resolved_by: null, resolved_at: null })
    .eq('dedupe_key', normalizedDedupeKey)
    .in('state', ['open', 'acknowledged']);
  if (error) storageUnavailable(error);
}

async function enqueueOutbox(client, values) {
  const { error } = await routerTable(client, EMAIL_ROUTER_STORAGE.outbox).insert(values);
  if (error) storageUnavailable(error);
}

async function actionMessage(client, mailboxId, providerMessageId) {
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.messages)
    .select('id,provider_message_id,folder_key')
    .eq('mailbox_id', mailboxId)
    .eq('provider_message_id', providerMessageId)
    .maybeSingle();
  if (error) storageUnavailable(error);
  if (!data) throw routerError('The source message has not been indexed yet.', 409, 'EMAIL_ROUTER_MESSAGE_NOT_INDEXED');
  return data;
}

async function destinationAddresses(client, destinationIds) {
  const ids = [...new Set((destinationIds || []).map((id) => safeId(id, 'destination identifier')))];
  if (!ids.length) return [];
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.destinations)
    .select('id,destination_kind,user_profile_id,email_address')
    .in('id', ids)
    .eq('active', true)
    .eq('redirect_enabled', true);
  if (error) storageUnavailable(error);
  const profiles = await emailRouterProfilesById(client, (data || []).map((destination) => destination.user_profile_id));
  const found = new Map((data || []).map((destination) => {
    const profile = profiles.get(destination.user_profile_id);
    return [destination.id, destination.destination_kind === 'fcos_profile' ? profile?.active ? profile.email : null : destination.email_address];
  }));
  return ids.map((id) => safeAddress(found.get(id) || ''));
}

export function normalizeEmailRouterDestinationSelections(input) {
  const supplied = Array.isArray(input.destinationSelections)
    ? input.destinationSelections
    : Array.isArray(input.directoryIds)
      ? input.directoryIds.map((destinationId) => ({ destinationId, kind: 'to' }))
      : input.destinationId
        ? [{ destinationId: input.destinationId, kind: 'to' }]
        : [];
  if (supplied.length > MAX_ROUTING_RECIPIENTS) {
    throw routerError('Too many routing destinations were selected.', 400, 'EMAIL_ROUTER_RECIPIENT_LIMIT');
  }
  const seen = new Set();
  const positions = { to: 0, cc: 0, bcc: 0 };
  return supplied.map((selection, index) => {
    const destinationId = selection?.destinationId || (!selection?.groupId ? selection?.id : null);
    const groupId = selection?.groupId || null;
    if (Boolean(destinationId) === Boolean(groupId)) throw routerError('A routing selection must identify one destination or group.', 400, 'EMAIL_ROUTER_RECIPIENT_INVALID');
    const normalizedDestinationId = destinationId ? safeId(destinationId, 'destination identifier') : null;
    const normalizedGroupId = groupId ? safeId(groupId, 'group identifier') : null;
    const kind = text(selection?.kind || selection?.recipientKind, 10).toLowerCase();
    if (!RECIPIENT_KINDS.has(kind)) throw routerError('A routing recipient type is invalid.', 400, 'EMAIL_ROUTER_RECIPIENT_KIND_INVALID');
    const selectionKey = normalizedDestinationId ? `destination:${normalizedDestinationId}` : `group:${normalizedGroupId}`;
    if (seen.has(selectionKey)) throw routerError('A routing entry can appear only once across To, Cc, and Bcc.', 400, 'EMAIL_ROUTER_RECIPIENT_DUPLICATE');
    seen.add(selectionKey);
    positions[kind] += 1;
    return { destinationId: normalizedDestinationId, groupId: normalizedGroupId, kind, position: positions[kind], selectionIndex: index };
  });
}

export function normalizeEmailRouterManualRecipients(input) {
  const supplied = Array.isArray(input.manualRecipients)
    ? input.manualRecipients
    : Array.isArray(input.recipients)
      ? input.recipients
      : [];
  if (supplied.length > MAX_ROUTING_RECIPIENTS) throw routerError('Too many manual recipients were entered.', 400, 'EMAIL_ROUTER_RECIPIENT_LIMIT');
  const seen = new Set();
  const positions = { to: 0, cc: 0, bcc: 0 };
  return supplied.map((recipient) => {
    const address = safeAddress(recipient?.address || recipient?.email);
    const kind = text(recipient?.kind || recipient?.recipientKind, 10).toLowerCase();
    if (!RECIPIENT_KINDS.has(kind)) throw routerError('A manual recipient type is invalid.', 400, 'EMAIL_ROUTER_RECIPIENT_KIND_INVALID');
    if (seen.has(address)) throw routerError('A manual email address can appear only once across To, Cc, and Bcc.', 400, 'EMAIL_ROUTER_RECIPIENT_DUPLICATE');
    seen.add(address);
    positions[kind] += 1;
    return { address, kind, position: positions[kind] };
  });
}

function hasRecipientInput(input) {
  return Boolean(input.presetId || normalizeEmailRouterDestinationSelections(input).length || normalizeEmailRouterManualRecipients(input).length);
}

async function resolveEmailRouterPresetSnapshot(client, profileId, input, env = process.env) {
  const snapshot = verifyEmailRouterRouteSnapshotToken(input.routeSnapshotToken, env);
  const presetId = safeId(input.presetId, 'preset identifier');
  if (snapshot.profileId !== profileId || snapshot.presetId !== presetId) {
    throw routerError('The reviewed routing preset belongs to a different user or preset. Refresh the recipients.', 409, 'EMAIL_ROUTER_ROUTE_SNAPSHOT_MISMATCH');
  }
  const [presetResult, versionResult, destinationResult, configuration] = await Promise.all([
    routerTable(client, EMAIL_ROUTER_STORAGE.presets)
      .select('id,display_name,active,revision')
      .eq('id', presetId)
      .eq('active', true)
      .maybeSingle(),
    routerTable(client, EMAIL_ROUTER_STORAGE.presetVersions)
      .select('id,preset_id,version_label,active,revision')
      .eq('id', safeId(snapshot.presetVersionId, 'preset version identifier'))
      .eq('preset_id', presetId)
      .eq('active', true)
      .maybeSingle(),
    routerTable(client, EMAIL_ROUTER_STORAGE.presetVersionDestinations)
      .select('version_id,destination_id,group_id,recipient_kind,position')
      .eq('version_id', safeId(snapshot.presetVersionId, 'preset version identifier')),
    emailRouterRoutingConfiguration(client),
  ]);
  const failed = [presetResult, versionResult, destinationResult].find((result) => result.error);
  if (failed?.error) storageUnavailable(failed.error);
  if (!presetResult.data || !versionResult.data) {
    throw routerError('The reviewed routing preset is no longer available. Refresh the recipients.', 409, 'EMAIL_ROUTER_ROUTE_SNAPSHOT_STALE');
  }
  const destinations = routingVersionDestinations(destinationResult.data, versionResult.data.id);
  const definitionHash = routeDefinitionHash({
    preset: presetResult.data,
    version: versionResult.data,
    destinations,
    configurationFingerprint: configuration.fingerprint,
  });
  if (!snapshot.definitionHash || snapshot.definitionHash !== definitionHash) {
    throw routerError('The routing directory or preset changed after it was reviewed. Refresh the recipients.', 409, 'EMAIL_ROUTER_ROUTE_SNAPSHOT_STALE');
  }
  return {
    presetId,
    versionId: versionResult.data.id,
    versionLabel: versionResult.data.version_label,
    reason: text(snapshot.reason, 500) || 'Reviewed routing preset',
    definitionHash,
    issuedAt: new Date(Number(snapshot.issuedAt)).toISOString(),
    expiresAt: new Date(Number(snapshot.expiresAt)).toISOString(),
    selections: destinations,
  };
}

async function expandRoutingSelections(client, selections) {
  const groupIds = [...new Set(selections.map((selection) => selection.groupId).filter(Boolean))];
  if (!groupIds.length) return selections;
  const [groups, members] = await Promise.all([
    routerTable(client, 'destination_groups')
      .select('id')
      .in('id', groupIds)
      .eq('active', true)
      .eq('redirect_enabled', true),
    routerTable(client, 'destination_group_members')
      .select('group_id,destination_id')
      .in('group_id', groupIds),
  ]);
  if (groups.error) storageUnavailable(groups.error);
  if (members.error) storageUnavailable(members.error);
  if ((groups.data || []).length !== groupIds.length) throw routerError('A selected routing group is unavailable.', 409, 'EMAIL_ROUTER_GROUP_UNAVAILABLE');
  const memberIds = [...new Set((members.data || []).map((member) => member.destination_id))];
  const orderedMembers = memberIds.length
    ? await routerTable(client, EMAIL_ROUTER_STORAGE.destinations)
      .select('id,sort_order')
      .in('id', memberIds)
      .eq('active', true)
      .eq('redirect_enabled', true)
      .order('sort_order')
      .order('nickname')
    : { data: [], error: null };
  if (orderedMembers.error) storageUnavailable(orderedMembers.error);
  const memberOrder = new Map((orderedMembers.data || []).map((destination, index) => [destination.id, index]));
  const byGroup = new Map(groupIds.map((groupId) => [groupId, []]));
  for (const member of members.data || []) {
    if (memberOrder.has(member.destination_id)) byGroup.get(member.group_id)?.push(member.destination_id);
  }
  for (const values of byGroup.values()) values.sort((left, right) => memberOrder.get(left) - memberOrder.get(right));
  const expanded = selections.flatMap((selection) => selection.destinationId
    ? [selection]
    : (byGroup.get(selection.groupId) || []).map((destinationId) => ({ ...selection, destinationId, groupId: null })));
  if (expanded.length > MAX_ROUTING_RECIPIENTS) throw routerError('The selected destinations expand to too many recipients.', 400, 'EMAIL_ROUTER_RECIPIENT_LIMIT');
  if (groupIds.some((groupId) => !(byGroup.get(groupId) || []).length)) throw routerError('A selected routing group has no available recipients.', 409, 'EMAIL_ROUTER_GROUP_EMPTY');
  return expanded;
}

async function persistActionDestinations(client, actionId, input, routeSnapshot = null) {
  const rows = routeSnapshot
    ? {
        data: routeSnapshot.selections.map((selection) => ({
          destination_id: selection.destinationId || null,
          group_id: selection.groupId || null,
          recipient_kind: selection.kind,
          position: selection.position,
        })),
        error: null,
      }
    : {
        data: normalizeEmailRouterDestinationSelections(input).map((selection, index) => ({
          destination_id: selection.destinationId || null,
          group_id: selection.groupId || null,
          recipient_kind: selection.kind,
          position: selection.position || index + 1,
        })),
        error: null,
      };
  if (rows.error) storageUnavailable(rows.error);
  if (!(rows.data || []).length) return;
  const { error } = await routerTable(client, 'mail_action_destinations').insert((rows.data || []).map((row) => ({
    mail_action_id: actionId,
    destination_id: row.destination_id || null,
    group_id: row.group_id || null,
    recipient_kind: row.recipient_kind,
    position: row.position,
  })));
  if (error) storageUnavailable(error);
}

export async function resolveEmailRouterActionRecipients(client, input, routeSnapshot = null) {
  const selected = routeSnapshot?.selections || normalizeEmailRouterDestinationSelections(input);
  const expanded = routeSnapshot?.expandedSelections || await expandRoutingSelections(client, selected);
  const destinationIds = [...new Set(expanded.map((selection) => selection.destinationId))];
  const addresses = await destinationAddresses(client, destinationIds);
  const addressByDestination = new Map(destinationIds.map((destinationId, index) => [destinationId, addresses[index]]));
  const recipients = [
    ...expanded.map((selection) => ({ address: addressByDestination.get(selection.destinationId), kind: selection.kind })),
    ...normalizeEmailRouterManualRecipients(input),
  ];
  if (recipients.length > MAX_ROUTING_RECIPIENTS) throw routerError('The selected destinations expand to too many recipients.', 400, 'EMAIL_ROUTER_RECIPIENT_LIMIT');
  return normalizedRecipients(recipients);
}

function requestFingerprint({ mailboxId, messageId, actionType, input, routeSnapshot = null }) {
  const destinationSelections = normalizeEmailRouterDestinationSelections(input)
    .map(({ destinationId, groupId, kind, position }) => `${kind}:${position}:${destinationId ? `destination:${destinationId}` : `group:${groupId}`}`);
  const manualRecipientHashes = normalizeEmailRouterManualRecipients(input)
    .map(({ address, kind, position }) => createHash('sha256').update(`${kind}:${position}:${address}`, 'utf8').digest('hex'));
  return createHash('sha256').update(JSON.stringify({
    actionType,
    bodyHash: createHash('sha256').update(String(input.comment || input.body || ''), 'utf8').digest('hex'),
    destinationFolderId: input.destinationFolderId || null,
    destinationFolderKey: input.destinationFolderKey || null,
    destinationSelections,
    manualRecipientHashes,
    mailboxId,
    messageId,
    presetId: input.presetId || null,
    ...(routeSnapshot ? { presetVersionId: routeSnapshot.versionId, routeDefinitionHash: routeSnapshot.definitionHash } : {}),
  })).digest('hex');
}

export async function resolveEmailRouterMarketReportFolder(mailbox, dependencies = {}) {
  const cacheKey = String(mailbox?.id || mailbox?.emailAddress || '').toLowerCase();
  const cached = marketReportFolderCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.id;

  const parameters = new URLSearchParams({
    '$select': 'id,displayName,childFolderCount',
    '$top': '100',
    includeHiddenFolders: 'true',
  });
  const queue = [{ path: mailboxPath(mailbox, `/mailFolders?${parameters}`), depth: 0 }];
  const matches = [];
  let inspected = 0;

  while (queue.length && inspected < 500) {
    const current = queue.shift();
    let nextPath = current.path;
    for (let page = 0; nextPath && page < 10 && inspected < 500; page += 1) {
      const response = await emailRouterGraphFetch(nextPath, {}, dependencies);
      const payload = await graphJson(response) || {};
      const folders = Array.isArray(payload.value) ? payload.value : [];
      inspected += folders.length;
      for (const folder of folders) {
        if (String(folder?.displayName || '').trim().toLowerCase() === MARKET_REPORT_FOLDER_NAME.toLowerCase()) {
          matches.push(safeId(folder.id, 'Market Report folder identifier'));
        }
        if (Number(folder?.childFolderCount || 0) > 0 && current.depth < 4) {
          queue.push({
            path: mailboxPath(mailbox, `/mailFolders/${encodeURIComponent(safeId(folder.id, 'folder identifier'))}/childFolders?${parameters}`),
            depth: current.depth + 1,
          });
        }
      }
      nextPath = payload['@odata.nextLink'] || null;
    }
  }

  const uniqueMatches = [...new Set(matches)];
  if (!uniqueMatches.length) {
    throw routerError('The Market Report folder is unavailable in the connected mailbox.', 409, 'EMAIL_ROUTER_MARKET_REPORT_FOLDER_MISSING');
  }
  if (uniqueMatches.length > 1) {
    throw routerError('More than one Market Report folder exists. Rename the duplicate folders before using this action.', 409, 'EMAIL_ROUTER_MARKET_REPORT_FOLDER_AMBIGUOUS');
  }
  marketReportFolderCache.set(cacheKey, { id: uniqueMatches[0], expiresAt: Date.now() + MARKET_REPORT_FOLDER_CACHE_MS });
  return uniqueMatches[0];
}

function actionResult(action, extra = {}) {
  const reversible = ['archive', 'delete', 'move'].includes(action.action_type) && action.state === 'confirmed';
  return {
    id: action.id,
    actionId: action.id,
    action: action.action_type,
    status: action.state,
    ...extra,
    ...(reversible ? { undoToken: action.id } : {}),
  };
}

async function createGraphDraft({ client, mailbox, actionType, sourceMessageId, input, routeSnapshot = null }, dependencies) {
  if (actionType === 'redirect') {
    const [source, recipients] = await Promise.all([
      emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(sourceMessageId)}/$value`), { headers: { accept: 'message/rfc822' } }, dependencies),
      resolveEmailRouterActionRecipients(client, input, routeSnapshot),
    ]);
    const raw = new Uint8Array(await source.arrayBuffer());
    const prepared = buildEmailRouterRedirectMime({ raw, mailboxAddress: mailbox.emailAddress, recipients });
    const response = await emailRouterGraphFetch(mailboxPath(mailbox, '/messages'), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: prepared.raw.toString('base64') }, dependencies);
    const draft = await graphJson(response);
    const draftId = safeId(draft?.id, 'draft identifier');
    const bccRecipients = recipients
      .filter((recipient) => recipient.kind === 'bcc')
      .map((recipient) => ({ emailAddress: { address: recipient.address } }));
    if (bccRecipients.length) {
      await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(draftId)}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bccRecipients }),
      }, dependencies);
    }
    return draftId;
  }
  const route = actionType === 'reply' ? 'createReply' : 'createForward';
  const recipientsPromise = actionType === 'forward' && hasRecipientInput(input)
    ? resolveEmailRouterActionRecipients(client, input, routeSnapshot)
    : Promise.resolve(null);
  const response = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(sourceMessageId)}/${route}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comment: text(input.comment || input.body, 20_000) }) }, dependencies);
  const draft = await graphJson(response);
  const draftId = safeId(draft?.id, 'draft identifier');
  if (actionType === 'forward' && hasRecipientInput(input)) {
    const recipients = await recipientsPromise;
    const graphRecipients = (kind) => recipients.filter((recipient) => recipient.kind === kind).map((recipient) => ({ emailAddress: { address: recipient.address } }));
    await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(draftId)}`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ toRecipients: graphRecipients('to'), ccRecipients: graphRecipients('cc'), bccRecipients: graphRecipients('bcc') }) }, dependencies);
  }
  return draftId;
}

export async function startEmailRouterAction({ client, profile, mailbox, actionType, sourceMessageId, input = {} }, dependencies = {}) {
  if (!ACTIONS.has(actionType)) throw routerError('Unsupported email action.', 400, 'EMAIL_ROUTER_ACTION_INVALID');
  if (['redirect', 'reply', 'forward'].includes(actionType)) requireExternalActionGate('email_delivery', dependencies.env || process.env);
  const source = safeId(sourceMessageId, 'message identifier');
  if (actionType === 'undo') return undoEmailRouterAction({ client, mailbox, sourceMessageId: source, profile, actionId: input.actionId || input.undoToken }, dependencies);
  const indexed = await actionMessage(client, mailbox.id, source);
  const directSelections = normalizeEmailRouterDestinationSelections(input);
  const manualRecipients = normalizeEmailRouterManualRecipients(input);
  if (input.presetId && (directSelections.length || manualRecipients.length)) {
    throw routerError('Choose either one routing preset or direct recipients.', 400, 'EMAIL_ROUTER_ROUTE_AMBIGUOUS');
  }
  if (!input.presetId && input.routeSnapshotToken) {
    throw routerError('A routing snapshot can be used only with its preset.', 400, 'EMAIL_ROUTER_ROUTE_SNAPSHOT_UNEXPECTED');
  }
  if (['redirect', 'forward'].includes(actionType) && !hasRecipientInput(input)) {
    throw routerError('At least one To, Cc, or Bcc recipient is required.', 400, 'EMAIL_ROUTER_RECIPIENT_REQUIRED');
  }
  let resolvedMoveDestinationId = null;
  if (actionType === 'move') {
    if (input.destinationFolderKey === 'market_report' && !input.destinationFolderId) {
      resolvedMoveDestinationId = await resolveEmailRouterMarketReportFolder(mailbox, dependencies);
    } else if (input.destinationFolderKey || !input.destinationFolderId) {
      throw routerError('The selected destination folder is unavailable.', 400, 'EMAIL_ROUTER_DESTINATION_FOLDER_INVALID');
    } else resolvedMoveDestinationId = safeId(input.destinationFolderId, 'destination folder identifier');
  }
  const routeSnapshot = input.presetId
    ? await resolveEmailRouterPresetSnapshot(client, profile.id, input, dependencies.env || process.env)
    : null;
  if (routeSnapshot) routeSnapshot.expandedSelections = await expandRoutingSelections(client, routeSnapshot.selections);
  const routeRecipientSnapshot = routeSnapshot ? (() => {
    const positions = { to: 0, cc: 0, bcc: 0 };
    return routeSnapshot.expandedSelections.map((selection) => {
      positions[selection.kind] += 1;
      return { destinationId: selection.destinationId, recipientKind: selection.kind, position: positions[selection.kind] };
    });
  })() : null;
  const suppliedIdempotencyKey = text(input.idempotencyKey || input.operationId, 200);
  if (suppliedIdempotencyKey && suppliedIdempotencyKey.length < 16) {
    throw routerError('The mail operation identifier is invalid.', 400, 'EMAIL_ROUTER_IDEMPOTENCY_INVALID');
  }
  const idempotencyKey = suppliedIdempotencyKey || randomUUID();
  const movesMessage = ['archive', 'delete', 'move'].includes(actionType);
  const reservedAt = new Date().toISOString();
  const action = await createAction(client, {
    message_id: indexed.id,
    preset_id: input.presetId || null,
    preset_version_id: routeSnapshot?.versionId || null,
    preset_version_label_snapshot: routeSnapshot?.versionLabel || null,
    route_resolution_reason: routeSnapshot?.reason || null,
    route_definition_hash: routeSnapshot?.definitionHash || null,
    route_recipient_snapshot: routeRecipientSnapshot,
    route_snapshot_issued_at: routeSnapshot?.issuedAt || null,
    route_snapshot_expires_at: routeSnapshot?.expiresAt || null,
    action_type: actionType,
    state: movesMessage ? 'uncertain' : 'reserved',
    ...(movesMessage ? { uncertain_at: reservedAt } : {}),
    requested_by: profile.id,
    idempotency_key: idempotencyKey,
    request_fingerprint: requestFingerprint({ mailboxId: mailbox.id, messageId: indexed.id, actionType, input, routeSnapshot }),
  });
  if (action.duplicate) return actionResult(action);
  const reservedEvent = recordEvent(client, { eventType: 'mail_action.reserved', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id }).catch(() => null);
  if (['redirect', 'forward'].includes(actionType)) {
    try {
      await persistActionDestinations(client, action.id, input, routeSnapshot);
    } catch (error) {
      const failureCode = String(error.code || 'email_router_route_invalid').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
      await reservedEvent;
      await Promise.all([
        updateAction(client, action.id, { state: 'failed', failure_code: failureCode, failed_at: new Date().toISOString() }),
        recordEvent(client, { eventType: 'mail_action.failed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id }),
      ]);
      throw error;
    }
  }
  if (actionType === 'archive' || actionType === 'delete' || actionType === 'move' || actionType === 'mark_read') {
    if (actionType === 'mark_read') {
      await Promise.all([
        emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(source)}`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isRead: true }) }, dependencies),
        reservedEvent,
      ]);
      await Promise.all([
        updateAction(client, action.id, { state: 'confirmed', confirmed_at: new Date().toISOString() }),
        recordEvent(client, { eventType: 'mail_action.confirmed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id }),
      ]);
      return actionResult({ ...action, state: 'confirmed' });
    }
    let destinationId;
    if (actionType === 'archive') destinationId = 'archive';
    else if (actionType === 'delete') destinationId = 'deleteditems';
    else destinationId = resolvedMoveDestinationId;
    const uncertainAt = reservedAt;
    try {
      const [response] = await Promise.all([
        emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(source)}/move`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ destinationId }) }, dependencies),
        reservedEvent,
      ]);
      const result = await graphJson(response);
      await Promise.all([
        updateAction(client, action.id, { state: 'confirmed', provider_operation_id: result?.id || source, confirmed_at: new Date().toISOString() }),
        recordEvent(client, { eventType: 'mail_action.confirmed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id }),
      ]);
      return actionResult({ ...action, state: 'confirmed', provider_operation_id: result?.id || source });
    } catch (error) {
      const failureCode = String(error.code || 'email_router_move_unknown').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
      const status = Number(error.status || 0);
      await reservedEvent;
      if (status >= 400 && status < 500 && ![408, 409, 429].includes(status)) {
        await Promise.all([
          updateAction(client, action.id, { state: 'failed', failure_code: failureCode, failed_at: new Date().toISOString() }),
          recordEvent(client, { eventType: 'mail_action.failed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id }),
        ]);
        throw error;
      }
      await updateAction(client, action.id, { failure_code: failureCode });
      await recordEmailRouterAlert(client, { mailboxId: mailbox.id, messageId: indexed.id, mailActionId: action.id, code: failureCode, severity: 'critical', dedupeKey: `mail-action:${action.id}:uncertain` });
      return actionResult({ ...action, state: 'uncertain', uncertain_at: uncertainAt });
    }
  }
  try {
    const draftId = await createGraphDraft({ client, mailbox, actionType, sourceMessageId: source, input, routeSnapshot }, dependencies);
    await reservedEvent;
    await Promise.all([
      updateAction(client, action.id, { state: 'draft_created', provider_operation_id: draftId, draft_created_at: new Date().toISOString() }),
      enqueueOutbox(client, { mail_action_id: action.id, state: 'draft_created', provider_operation_id: draftId, next_attempt_at: new Date().toISOString() }),
      recordEvent(client, { eventType: 'mail_action.draft_created', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id }).catch(() => null),
    ]);
    return actionResult({ ...action, state: 'draft_created', provider_operation_id: draftId });
  } catch (error) {
    const failureCode = String(error.code || 'email_router_draft_failed').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
    await reservedEvent;
    await Promise.all([
      updateAction(client, action.id, { state: 'failed', failure_code: failureCode, failed_at: new Date().toISOString() }),
      recordEvent(client, { eventType: 'mail_action.failed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id }),
    ]);
    throw error;
  }
}

async function sentDraftConfirmed(mailbox, draftId, dependencies) {
  const response = await emailRouterGraphFetch(mailboxPath(mailbox, `/mailFolders/sentitems/messages/${encodeURIComponent(draftId)}?$select=id`), {}, dependencies).catch((error) => {
    if (error.status === 404) return null;
    throw error;
  });
  return Boolean(response);
}

async function archiveConfirmedRedirectSource(mailbox, message, dependencies) {
  const [sourceResponse, archiveResponse] = await Promise.all([
    emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(message.provider_message_id)}?$select=id,parentFolderId`), {}, dependencies),
    emailRouterGraphFetch(mailboxPath(mailbox, '/mailFolders/archive?$select=id'), {}, dependencies),
  ]);
  const [source, archive] = await Promise.all([graphJson(sourceResponse), graphJson(archiveResponse)]);
  if (source?.parentFolderId === archive?.id) return;
  await emailRouterGraphFetch(
    mailboxPath(mailbox, `/messages/${encodeURIComponent(message.provider_message_id)}/move`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destinationId: archive?.id || 'archive' }),
    },
    dependencies,
  );
}

async function archiveRedirectSourceOrAlert({ client, mailbox, action, message }, dependencies) {
  try {
    await archiveConfirmedRedirectSource(mailbox, message, dependencies);
    return true;
  } catch (error) {
    const failureCode = String(error.code || 'email_router_archive_failed').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
    await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
      .update({ state: 'submitted', failure_code: failureCode, reconcile_after: new Date(Date.now() + 60_000).toISOString() })
      .eq('mail_action_id', action.id);
    await recordEmailRouterAlert(client, {
      mailboxId: mailbox.id,
      messageId: message.id,
      mailActionId: action.id,
      code: failureCode,
      severity: 'warning',
      dedupeKey: `mail-action:${action.id}:archive`,
    });
    return false;
  }
}

async function confirmSubmittedAction({ client, mailbox, action, message, actorUserId }, dependencies) {
  if (action.action_type === 'redirect') {
    const archived = await archiveRedirectSourceOrAlert({ client, mailbox, action, message }, dependencies);
    if (!archived) return false;
  }
  await updateAction(client, action.id, { state: 'confirmed', confirmed_at: new Date().toISOString() });
  await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
    .update({ state: 'confirmed', completed_at: new Date().toISOString() })
    .eq('mail_action_id', action.id);
  await routerTable(client, 'alerts')
    .update(actorUserId ? { state: 'resolved', resolved_by: actorUserId, resolved_at: new Date().toISOString() } : { state: 'resolved' })
    .eq('mail_action_id', action.id)
    .in('state', ['open', 'acknowledged']);
  await recordEvent(client, { eventType: 'mail_action.confirmed', entityType: 'mail_action', entityId: action.id, actorUserId });
  return true;
}

export async function processEmailRouterOutbox({ client, mailbox, limit = 10, actionId = null, confirmNewSubmissions = true }, dependencies = {}) {
  const maximum = Math.min(25, Math.max(1, Number(limit) || 10));
  const currentTime = new Date().toISOString();
  const relation = 'mail_actions(id,action_type,state,provider_operation_id,requested_by,messages(id,provider_message_id,mailbox_id))';
  let deliveryEntries = [];
  let reconciliationEntries = [];
  if (actionId) {
    const targetActionId = safeId(actionId, 'mail action identifier');
    const { data: targetEntry, error: targetError } = await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
      .select(`id,mail_action_id,state,attempt_count,provider_operation_id,${relation}`)
      .eq('mail_action_id', targetActionId)
      .in('state', ['reserved', 'draft_created', 'submitted', 'uncertain'])
      .maybeSingle();
    if (targetError) storageUnavailable(targetError);
    if (targetEntry && ['reserved', 'draft_created'].includes(targetEntry.state)) deliveryEntries = [targetEntry];
    if (targetEntry && ['submitted', 'uncertain'].includes(targetEntry.state)) reconciliationEntries = [targetEntry];
  } else {
    const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
      .select(`id,mail_action_id,state,attempt_count,provider_operation_id,${relation}`)
      .in('state', ['reserved', 'draft_created'])
      .lte('next_attempt_at', currentTime)
      .order('next_attempt_at')
      .limit(maximum);
    if (error) storageUnavailable(error);
    deliveryEntries = data || [];
    const { data: pendingReconciliation, error: reconcileError } = await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
      .select(`id,mail_action_id,state,attempt_count,provider_operation_id,${relation}`)
      .in('state', ['submitted', 'uncertain'])
      .lte('reconcile_after', currentTime)
      .order('reconcile_after')
      .limit(maximum);
    if (reconcileError) storageUnavailable(reconcileError);
    reconciliationEntries = pendingReconciliation || [];
  }
  let submitted = 0;
  let confirmed = 0;
  for (const entry of [...deliveryEntries, ...reconciliationEntries]) {
    const action = Array.isArray(entry.mail_actions) ? entry.mail_actions[0] : entry.mail_actions;
    const message = Array.isArray(action?.messages) ? action.messages[0] : action?.messages;
    if (!action || !message || action.state === 'confirmed') continue;
    let submittedNow = false;
    if (entry.state === 'reserved' || entry.state === 'draft_created') {
      // The transition to uncertain happens before Graph submission; uncertain entries are reconciliation-only.
      const { data: claimed, error: claimError } = await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
        .update({ state: 'uncertain', attempt_count: Number(entry.attempt_count || 0) + 1, reconcile_after: new Date(Date.now() + 60_000).toISOString() })
        .eq('id', entry.id)
        .in('state', ['reserved', 'draft_created'])
        .select('id')
        .maybeSingle();
      if (claimError) storageUnavailable(claimError);
      if (!claimed) continue;
      await updateAction(client, entry.mail_action_id, { state: 'uncertain', uncertain_at: new Date().toISOString() });
      try {
        const response = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(action.provider_operation_id)}/send`), { method: 'POST' }, dependencies);
        if (response.status !== 202) throw routerError('Microsoft Graph did not accept the draft.', 502, 'EMAIL_ROUTER_DRAFT_NOT_ACCEPTED');
        await routerTable(client, EMAIL_ROUTER_STORAGE.outbox).update({ state: 'submitted', reconcile_after: new Date(Date.now() + 15_000).toISOString() }).eq('id', entry.id);
        await updateAction(client, entry.mail_action_id, { state: 'submitted', submitted_at: new Date().toISOString() });
        await recordEvent(client, { eventType: 'mail_action.submitted', entityType: 'mail_action', entityId: entry.mail_action_id, actorUserId: action.requested_by });
        if (action.action_type === 'redirect') {
          await archiveRedirectSourceOrAlert({ client, mailbox, action, message }, dependencies);
        }
        submitted += 1;
        submittedNow = true;
      } catch (error) {
        const failureCode = String(error.code || 'email_router_submission_unknown').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
        await routerTable(client, EMAIL_ROUTER_STORAGE.outbox).update({ state: 'uncertain', failure_code: failureCode, reconcile_after: new Date(Date.now() + 60_000).toISOString() }).eq('id', entry.id);
        await recordEmailRouterAlert(client, { mailboxId: mailbox.id, messageId: message.id, mailActionId: entry.mail_action_id, code: failureCode, severity: 'critical', dedupeKey: `mail-action:${entry.mail_action_id}:uncertain` });
        continue;
      }
    }
    if ((!submittedNow || confirmNewSubmissions) && await sentDraftConfirmed(mailbox, action.provider_operation_id, dependencies)) {
      const didConfirm = await confirmSubmittedAction({ client, mailbox, action, message, actorUserId: action.requested_by }, dependencies);
      if (didConfirm) confirmed += 1;
    }
  }
  return { submitted, confirmed };
}

export async function getEmailRouterActionStatus(client, actionId, { mailboxId = null } = {}) {
  const id = safeId(actionId, 'mail action identifier');
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions)
    .select('id,message_id,state,action_type,reserved_at,draft_created_at,submitted_at,confirmed_at,failed_at,uncertain_at,updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) storageUnavailable(error);
  if (!data) throw routerError('Mail action not found.', 404, 'EMAIL_ROUTER_ACTION_NOT_FOUND');
  if (mailboxId) {
    const { data: message, error: messageError } = await routerTable(client, EMAIL_ROUTER_STORAGE.messages)
      .select('id')
      .eq('id', data.message_id)
      .eq('mailbox_id', safeId(mailboxId, 'mailbox identifier'))
      .maybeSingle();
    if (messageError) storageUnavailable(messageError);
    if (!message) throw routerError('Mail action not found.', 404, 'EMAIL_ROUTER_ACTION_NOT_FOUND');
  }
  const { data: outbox, error: outboxError } = await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
    .select('state,reconcile_after,updated_at')
    .eq('mail_action_id', id)
    .maybeSingle();
  if (outboxError) storageUnavailable(outboxError);
  const uncertainSince = Date.parse(data.uncertain_at || data.updated_at || 0);
  const recentUncertain = data.state === 'uncertain'
    && Number.isFinite(uncertainSince)
    && Date.now() - uncertainSince < 2 * 60_000;
  const tracking = ['reserved', 'draft_created', 'submitted'].includes(data.state)
    || (recentUncertain && ['reserved', 'draft_created', 'submitted', 'uncertain'].includes(outbox?.state));
  return actionResult(data, {
    tracking,
    checkedAt: new Date().toISOString(),
  });
}

export async function retryEmailRouterUncertainAction({ client, mailbox, profile, actionId, confirmedNotSent }, dependencies = {}) {
  if (confirmedNotSent !== true) {
    throw routerError('Confirm that the message is not present in Sent Items before retrying.', 400, 'EMAIL_ROUTER_RETRY_CONFIRMATION_REQUIRED');
  }
  const id = safeId(actionId, 'mail action identifier');
  const { data: action, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions)
    .select('id,state,action_type,provider_operation_id,requested_by,uncertain_at,messages(id,provider_message_id,mailbox_id)')
    .eq('id', id)
    .maybeSingle();
  if (error) storageUnavailable(error);
  if (!action) throw routerError('Mail action not found.', 404, 'EMAIL_ROUTER_ACTION_NOT_FOUND');
  if (!['redirect', 'reply', 'forward'].includes(action.action_type) || action.state !== 'uncertain' || !action.provider_operation_id) {
    throw routerError('Only an uncertain outgoing message can be reviewed for retry.', 409, 'EMAIL_ROUTER_RETRY_UNAVAILABLE');
  }
  const message = Array.isArray(action.messages) ? action.messages[0] : action.messages;
  if (!message || message.mailbox_id !== mailbox.id) {
    throw routerError('Mail action does not belong to the active mailbox.', 409, 'EMAIL_ROUTER_RETRY_MAILBOX_MISMATCH');
  }
  if (await sentDraftConfirmed(mailbox, action.provider_operation_id, dependencies)) {
    const didConfirm = await confirmSubmittedAction({ client, mailbox, action, message, actorUserId: profile.id }, dependencies);
    return actionResult({ ...action, state: didConfirm ? 'confirmed' : 'submitted' });
  }
  const { data: reset, error: resetError } = await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
    .update({ state: 'draft_created', next_attempt_at: new Date().toISOString(), reconcile_after: null, failure_code: null, completed_at: null })
    .eq('mail_action_id', action.id)
    .eq('state', 'uncertain')
    .select('id')
    .maybeSingle();
  if (resetError) storageUnavailable(resetError);
  if (!reset) {
    throw routerError('This mail action changed while it was being reviewed. Refresh before retrying.', 409, 'EMAIL_ROUTER_RETRY_CONFLICT');
  }
  await updateAction(client, action.id, { state: 'draft_created', failure_code: null });
  await recordEvent(client, { eventType: 'mail_action.retry_confirmed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id });
  return actionResult({ ...action, state: 'draft_created' });
}

export async function undoEmailRouterAction({ client, mailbox, sourceMessageId, profile, actionId }, dependencies = {}) {
  const indexed = await actionMessage(client, mailbox.id, sourceMessageId);
  const targetActionId = safeId(actionId, 'undo action identifier');
  const { data: action, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions).select('id,action_type,state').eq('id', targetActionId).eq('message_id', indexed.id).in('action_type', ['archive', 'delete', 'move']).eq('state', 'confirmed').maybeSingle();
  if (error) storageUnavailable(error);
  if (!action) throw routerError('No reversible mail action is available.', 409, 'EMAIL_ROUTER_UNDO_UNAVAILABLE');
  const undo = await createAction(client, {
    message_id: indexed.id,
    action_type: 'undo',
    state: 'reserved',
    requested_by: profile.id,
    idempotency_key: randomUUID(),
    request_fingerprint: createHash('sha256').update(JSON.stringify({ mailboxId: mailbox.id, messageId: indexed.id, actionType: 'undo', originalActionId: action.id })).digest('hex'),
  });
  await recordEvent(client, { eventType: 'mail_action.reserved', entityType: 'mail_action', entityId: undo.id, actorUserId: profile.id });
  // The metadata-only schema intentionally stores no source-folder identifier. Undo returns a moved message to Inbox.
  const response = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(sourceMessageId)}/move`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ destinationId: 'inbox' }) }, dependencies);
  const result = await graphJson(response);
  await updateAction(client, undo.id, { state: 'confirmed', provider_operation_id: result?.id || sourceMessageId, confirmed_at: new Date().toISOString() });
  await recordEvent(client, { eventType: 'mail_action.confirmed', entityType: 'mail_action', entityId: undo.id, actorUserId: profile.id });
  return actionResult({ ...undo, state: 'confirmed' });
}

function attachmentSecret(env) {
  const secret = text(env.FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET, 500);
  if (!secret) throw routerError('Email Router attachment links are not configured.', 503, 'EMAIL_ROUTER_ATTACHMENT_SECRET_MISSING');
  return secret;
}

export function createEmailRouterAttachmentToken({ mailboxId, messageId, attachmentId, expiresAt = Date.now() + 60_000 }, env = process.env) {
  const payload = Buffer.from(JSON.stringify({ mailboxId: safeId(mailboxId, 'mailbox identifier'), messageId: safeId(messageId, 'message identifier'), attachmentId: safeId(attachmentId, 'attachment identifier'), expiresAt: Number(expiresAt) })).toString('base64url');
  const signature = createHmac('sha256', attachmentSecret(env)).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyEmailRouterAttachmentToken(token, env = process.env) {
  const [payload, signature] = String(token || '').split('.');
  const expected = createHmac('sha256', attachmentSecret(env)).update(payload || '').digest('base64url');
  if (!payload || !signature || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw routerError('Attachment link is invalid.', 403, 'EMAIL_ROUTER_ATTACHMENT_TOKEN_INVALID');
  let value;
  try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw routerError('Attachment link is invalid.', 403, 'EMAIL_ROUTER_ATTACHMENT_TOKEN_INVALID'); }
  if (!Number.isFinite(value.expiresAt) || value.expiresAt < Date.now()) throw routerError('Attachment link has expired.', 403, 'EMAIL_ROUTER_ATTACHMENT_TOKEN_EXPIRED');
  return { mailboxId: safeId(value.mailboxId, 'mailbox identifier'), messageId: safeId(value.messageId, 'message identifier'), attachmentId: safeId(value.attachmentId, 'attachment identifier') };
}

export async function streamEmailRouterAttachment({ mailbox, messageId, attachmentId }, dependencies = {}) {
  const response = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(safeId(messageId, 'message identifier'))}/attachments/${encodeURIComponent(safeId(attachmentId, 'attachment identifier'))}/$value`), { headers: { accept: '*/*' } }, dependencies);
  return {
    body: response.body,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    contentLength: response.headers.get('content-length') || null,
  };
}

export function validEmailRouterWebhookNotifications(payload, expectedClientState) {
  const expected = text(expectedClientState, 1000);
  if (!expected || !Array.isArray(payload?.value)) return [];
  return payload.value.filter((entry) => {
    const state = text(entry?.clientState, 1000);
    return state && Buffer.byteLength(state) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  }).map((entry) => ({ subscriptionId: text(entry.subscriptionId, 512), resource: text(entry.resource, 1000), changeType: text(entry.changeType, 64), lifecycleEvent: text(entry.lifecycleEvent, 64), resourceId: text(entry.resourceData?.id, 512) }));
}

export async function enqueueEmailRouterWebhookNotifications(client, notifications, dependencies = {}) {
  // Notification bodies are intentionally not persisted. Folder delta state is the durable source of truth.
  const subscriptionIds = [...new Set((notifications || []).map((entry) => entry.subscriptionId).filter(Boolean))];
  if (!subscriptionIds.length) return { queued: 0 };
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.subscriptions)
    .select('provider_subscription_id,resource_key,state')
    .in('provider_subscription_id', subscriptionIds)
    .eq('state', 'active');
  if (error) storageUnavailable(error);
  const mailbox = await currentEmailRouterMailbox(client);
  const jobs = (data || []).map((subscription) => syncEmailRouterFolderFromStoredCursor({
    client,
    mailbox,
    folder: subscription.resource_key,
    maxPages: 4,
  }, dependencies).catch(async (syncError) => {
    await routerTable(client, EMAIL_ROUTER_STORAGE.deltaState).upsert({
      mailbox_id: mailbox.id,
      folder_key: subscription.resource_key,
      cursor_reference: mailboxPath(mailbox, `/mailFolders/${subscription.resource_key}/messages/delta?$select=${encodeURIComponent(GRAPH_SELECT)}`),
      sync_state: 'resync_required',
      failure_code: String(syncError.code || 'email_router_delta_failed').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'mailbox_id,folder_key' });
    await recordEmailRouterAlert(client, { mailboxId: mailbox.id, code: 'email_router_delta_failed', severity: 'warning', dedupeKey: `mailbox:${mailbox.id}:delta:${subscription.resource_key}` });
  }));
  if (typeof dependencies.defer === 'function') jobs.forEach((job) => dependencies.defer(job));
  else await Promise.all(jobs);
  return { queued: jobs.length };
}

export async function syncEmailRouterFolderFromStoredCursor({ client, mailbox, folder = 'inbox', maxPages = 4 }, dependencies = {}) {
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.deltaState)
    .select('cursor_reference,sync_state')
    .eq('mailbox_id', mailbox.id)
    .eq('folder_key', folder)
    .maybeSingle();
  if (error) storageUnavailable(error);
  const cursor = data?.cursor_reference || null;
  return syncEmailRouterDelta({ client, mailbox, folder, deltaLink: cursor, maxPages }, dependencies);
}

export function emailRouterBackgroundSyncDue(lastSyncedAt, {
  nowMs = Date.now(),
  minimumIntervalMs = EMAIL_ROUTER_BACKGROUND_SYNC_MIN_INTERVAL_MS,
} = {}) {
  const lastSyncedMs = new Date(lastSyncedAt || 0).getTime();
  if (!Number.isFinite(lastSyncedMs) || lastSyncedMs <= 0) return true;
  return Number(nowMs) - lastSyncedMs >= Math.max(5_000, Number(minimumIntervalMs) || EMAIL_ROUTER_BACKGROUND_SYNC_MIN_INTERVAL_MS);
}

export async function syncEmailRouterMailboxIfDue({
  client,
  mailbox,
  folders = ['inbox', 'sentitems', 'archive'],
  minimumIntervalMs = EMAIL_ROUTER_BACKGROUND_SYNC_MIN_INTERVAL_MS,
  maxPages = 4,
} = {}, dependencies = {}) {
  const nowMs = typeof dependencies.now === 'function' ? Number(dependencies.now()) : Date.now();
  const claimedAt = new Date(nowMs).toISOString();
  const { data: connection, error: connectionError } = await routerTable(client, EMAIL_ROUTER_STORAGE.mailboxes)
    .select('id,last_synced_at')
    .eq('id', mailbox.id)
    .maybeSingle();
  if (connectionError) storageUnavailable(connectionError);
  if (!connection) throw routerError('The active FCOS Email Router mailbox connection is unavailable.', 503, 'EMAIL_ROUTER_CONNECTION_UNAVAILABLE');
  if (!emailRouterBackgroundSyncDue(connection.last_synced_at, { nowMs, minimumIntervalMs })) {
    return { claimed: false, status: 'recent', changed: 0, lastSyncedAt: connection.last_synced_at };
  }

  let claimQuery = routerTable(client, EMAIL_ROUTER_STORAGE.mailboxes)
    .update({ last_synced_at: claimedAt, updated_at: claimedAt })
    .eq('id', mailbox.id);
  claimQuery = connection.last_synced_at
    ? claimQuery.eq('last_synced_at', connection.last_synced_at)
    : claimQuery.is('last_synced_at', null);
  const { data: claim, error: claimError } = await claimQuery.select('id').maybeSingle();
  if (claimError) storageUnavailable(claimError);
  if (!claim) return { claimed: false, status: 'claimed_elsewhere', changed: 0, lastSyncedAt: connection.last_synced_at };

  const allowedFolders = [...new Set((folders || []).filter((folder) => FOLDERS.has(folder)))];
  const synchronization = {};
  let changed = 0;
  let failures = 0;
  const synchronizeFolder = dependencies.syncFolder || syncEmailRouterFolderFromStoredCursor;
  const resolveBackgroundAlert = dependencies.resolveAlert || resolveEmailRouterAlert;
  const recordBackgroundAlert = dependencies.recordAlert || recordEmailRouterAlert;
  for (const folder of allowedFolders) {
    const dedupeKey = `mailbox:${mailbox.id}:background-sync:${folder}`;
    try {
      const result = await synchronizeFolder({ client, mailbox, folder, maxPages }, dependencies);
      const folderChanged = Math.max(0, Number(result.synced) || 0) + Math.max(0, Number(result.removed) || 0);
      changed += folderChanged;
      synchronization[folder] = {
        status: result.nextLink ? 'continuing' : 'ready',
        changed: folderChanged,
        pages: result.pages,
      };
      await resolveBackgroundAlert(client, { dedupeKey }).catch(() => null);
    } catch (error) {
      failures += 1;
      const code = String(error.code || 'email_router_background_sync_failed').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
      synchronization[folder] = { status: 'failed', changed: 0, code };
      await recordBackgroundAlert(client, { mailboxId: mailbox.id, code, severity: 'warning', dedupeKey }).catch(() => null);
    }
  }

  const completedAt = new Date(typeof dependencies.now === 'function' ? Number(dependencies.now()) : Date.now()).toISOString();
  const { error: completionError } = await routerTable(client, EMAIL_ROUTER_STORAGE.mailboxes)
    .update({ last_synced_at: completedAt, updated_at: completedAt })
    .eq('id', mailbox.id)
    .eq('last_synced_at', claimedAt)
    .select('id')
    .maybeSingle();
  if (completionError) storageUnavailable(completionError);
  return {
    claimed: true,
    status: failures ? 'warning' : 'synchronized',
    changed,
    failures,
    lastSyncedAt: completedAt,
    synchronization,
  };
}

export async function syncEmailRouterDelta({ client, mailbox, folder = 'inbox', deltaLink = null, maxPages = 2 }, dependencies = {}) {
  if (!FOLDERS.has(folder)) throw routerError('Unsupported mailbox folder.', 400, 'EMAIL_ROUTER_FOLDER_INVALID');
  let next = deltaLink
    ? validatedMailboxGraphUrl(deltaLink, mailbox, 'EMAIL_ROUTER_DELTA_CURSOR_INVALID')
    : mailboxPath(mailbox, `/mailFolders/${folder}/messages/delta?$select=${encodeURIComponent(GRAPH_SELECT)}`);
  let pages = 0;
  let cursor = null;
  const messages = [];
  while (next && pages < Math.max(1, Math.min(10, Number(maxPages) || 2))) {
    const response = await emailRouterGraphFetch(next, { headers: { prefer: 'odata.maxpagesize=250' } }, dependencies);
    const page = await graphJson(response) || {};
    messages.push(...(page.value || []));
    next = page['@odata.nextLink'] || null;
    cursor = page['@odata.deltaLink'] || cursor;
    pages += 1;
  }
  const result = await syncEmailRouterMetadata({ client, mailbox, folder, messages });
  if (cursor || next) {
    const { error } = await routerTable(client, EMAIL_ROUTER_STORAGE.deltaState).upsert({
      mailbox_id: mailbox.id,
      folder_key: folder,
      cursor_reference: next || cursor,
      sync_state: next ? 'syncing' : 'ready',
      last_synced_at: new Date().toISOString(),
      failure_code: null,
    }, { onConflict: 'mailbox_id,folder_key' });
    if (error) storageUnavailable(error);
  }
  return { ...result, pages, nextLink: next, deltaLink: cursor };
}

export async function createEmailRouterSubscription({ client, mailbox, folder = 'inbox', notificationUrl }, dependencies = {}) {
  if (!FOLDERS.has(folder)) throw routerError('Unsupported mailbox folder.', 400, 'EMAIL_ROUTER_FOLDER_INVALID');
  const clientState = text((dependencies.env || process.env).FCOS_EMAIL_ROUTER_WEBHOOK_CLIENT_STATE, 1000);
  const url = text(notificationUrl || (dependencies.env || process.env).FCOS_EMAIL_ROUTER_WEBHOOK_URL, 2000);
  if (!clientState || !/^https:\/\//i.test(url)) throw routerError('Email Router webhook configuration is incomplete.', 503, 'EMAIL_ROUTER_WEBHOOK_CONFIG_MISSING');
  const expiresAt = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000)).toISOString();
  const response = await emailRouterGraphFetch('/subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      changeType: 'created,updated,deleted',
      notificationUrl: url,
      lifecycleNotificationUrl: url,
      resource: `users/${mailbox.emailAddress}/mailFolders('${folder}')/messages`,
      expirationDateTime: expiresAt,
      clientState,
      latestSupportedTlsVersion: 'v1_2',
    }),
  }, dependencies);
  const subscription = await graphJson(response);
  const { error } = await routerTable(client, EMAIL_ROUTER_STORAGE.subscriptions).upsert({
    mailbox_id: mailbox.id,
    resource_key: folder,
    provider_subscription_id: safeId(subscription?.id, 'subscription identifier'),
    expires_at: subscription?.expirationDateTime || expiresAt,
    state: 'active',
  }, { onConflict: 'mailbox_id,resource_key' });
  if (error) storageUnavailable(error);
  return { folder, expiresAt: subscription?.expirationDateTime || expiresAt };
}

export async function maintainEmailRouterSubscriptions({ client, mailbox, folders = ['inbox', 'sentitems', 'archive'] }, dependencies = {}) {
  const clientState = text((dependencies.env || process.env).FCOS_EMAIL_ROUTER_WEBHOOK_CLIENT_STATE, 1000);
  const notificationUrl = text((dependencies.env || process.env).FCOS_EMAIL_ROUTER_WEBHOOK_URL, 2000);
  if (!clientState || !/^https:\/\//i.test(notificationUrl)) throw routerError('Email Router webhook configuration is incomplete.', 503, 'EMAIL_ROUTER_WEBHOOK_CONFIG_MISSING');
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.subscriptions)
    .select('id,resource_key,provider_subscription_id,state,expires_at')
    .in('resource_key', folders);
  if (error) storageUnavailable(error);
  const byFolder = new Map((data || []).map((row) => [row.resource_key, row]));
  const renewalThreshold = Date.now() + 24 * 60 * 60 * 1000;
  const results = [];
  for (const folder of folders) {
    if (!FOLDERS.has(folder)) continue;
    const existing = byFolder.get(folder);
    if (existing?.state === 'active' && new Date(existing.expires_at || 0).getTime() > renewalThreshold) {
      results.push({ folder, state: 'current', expiresAt: existing.expires_at });
      continue;
    }
    if (existing?.provider_subscription_id && existing.state !== 'removed') {
      const expiresAt = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000)).toISOString();
      try {
        const response = await emailRouterGraphFetch(`/subscriptions/${encodeURIComponent(existing.provider_subscription_id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expirationDateTime: expiresAt }),
        }, dependencies);
        const subscription = await graphJson(response) || {};
        const resolvedExpiry = subscription.expirationDateTime || expiresAt;
        const { error: updateError } = await routerTable(client, EMAIL_ROUTER_STORAGE.subscriptions)
          .update({ state: 'active', expires_at: resolvedExpiry, lifecycle_event: null, lifecycle_at: null, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (updateError) storageUnavailable(updateError);
        results.push({ folder, state: 'renewed', expiresAt: resolvedExpiry });
        continue;
      } catch (renewalError) {
        if (renewalError.status !== 404) throw renewalError;
      }
    }
    results.push({ folder, state: 'created', ...(await createEmailRouterSubscription({ client, mailbox, folder, notificationUrl }, dependencies)) });
  }
  return results;
}
