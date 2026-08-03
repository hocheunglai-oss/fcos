import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getVercelOidcToken } from '@vercel/oidc';
import { requireExternalActionGate } from './_externalActionGates.js';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const FOLDERS = new Set(['inbox', 'sentitems', 'archive', 'deleteditems']);
const ACTIONS = new Set(['redirect', 'reply', 'forward', 'archive', 'move', 'delete', 'undo', 'mark_read']);
const RECIPIENT_KINDS = new Set(['to', 'cc', 'bcc']);
const MAX_ROUTING_RECIPIENTS = 100;
const MAX_MIME_BYTES = 25 * 1024 * 1024;
const GRAPH_SELECT = 'id,parentFolderId,receivedDateTime,sentDateTime,hasAttachments,isRead,importance';

export const EMAIL_ROUTER_STORAGE = Object.freeze({
  mailboxes: 'mailbox_connections',
  messages: 'messages',
  attachmentMetadata: 'message_attachment_metadata',
  actions: 'mail_actions',
  outbox: 'mail_action_outbox',
  destinations: 'destinations',
  presetDestinations: 'routing_preset_destinations',
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

/** The router mailbox is configured by a registry row, never a workflow field. */
export async function currentEmailRouterMailbox(client) {
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
  return { ...mailboxShape({ ...sender, ...connection }), senderMailboxId: sender.id, emailAddress: sender.email_address };
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
  if (!FOLDERS.has(folder)) throw routerError('Unsupported mailbox folder.', 400, 'EMAIL_ROUTER_FOLDER_INVALID');
  const maximum = Math.min(50, Math.max(1, Number(limit) || 30));
  const selected = 'id,subject,from,receivedDateTime,sentDateTime,hasAttachments,isRead,importance';
  const nextUrl = decodeGraphCursor(cursor, mailbox);
  const params = new URLSearchParams({ '$select': selected, '$top': String(maximum) });
  const searchTerm = graphSearchTerm(search);
  if (searchTerm) params.set('$search', searchTerm);
  else params.set('$orderby', 'receivedDateTime desc');
  const path = nextUrl || mailboxPath(mailbox, `/mailFolders/${folder}/messages?${params.toString()}`);
  const response = await emailRouterGraphFetch(path, {
    headers: searchTerm ? { consistencyLevel: 'eventual' } : {},
  }, dependencies);
  const payload = await graphJson(response) || {};
  const messages = Array.isArray(payload.value) ? payload.value : [];
  await syncEmailRouterMetadata({ client, mailbox, folder, messages });
  return {
    mailbox: mailboxShape(mailbox),
    folder,
    items: messages,
    nextCursor: encodeGraphCursor(payload['@odata.nextLink']),
    total: messages.length,
  };
}

export async function fetchEmailRouterDetail({ client, mailbox, messageId }, dependencies = {}) {
  const id = safeId(messageId, 'message identifier');
  const query = new URLSearchParams({
    '$select': 'id,subject,from,sender,toRecipients,ccRecipients,bccRecipients,body,bodyPreview,receivedDateTime,sentDateTime,parentFolderId,hasAttachments,isRead,importance,internetMessageId',
  });
  const response = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(id)}?${query}`), {}, dependencies);
  const message = await graphJson(response);
  if (message?.hasAttachments) {
    const attachmentQuery = new URLSearchParams({ '$select': 'id,name,contentType,size,isInline' });
    const attachmentResponse = await emailRouterGraphFetch(
      mailboxPath(mailbox, `/messages/${encodeURIComponent(id)}/attachments?${attachmentQuery}`),
      {},
      dependencies,
    );
    const attachmentPayload = await graphJson(attachmentResponse) || {};
    message.attachments = Array.isArray(attachmentPayload.value) ? attachmentPayload.value : [];
  } else if (message) {
    message.attachments = [];
  }
  const indexed = await actionMessage(client, mailbox.id, id).catch((error) => {
    if (error?.code === 'EMAIL_ROUTER_MESSAGE_NOT_INDEXED') return null;
    throw error;
  });
  let actionHistory = [];
  if (indexed) {
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
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

    const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions)
      .select('id,action_type,state,requested_by,reserved_at,draft_created_at,submitted_at,confirmed_at,failed_at,uncertain_at')
      .eq('message_id', indexed.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) storageUnavailable(error);
    actionHistory = (data || []).map((action) => ({
      id: action.id,
      action: action.action_type,
      status: action.state,
      at: action.confirmed_at || action.submitted_at || action.draft_created_at || action.failed_at || action.uncertain_at || action.reserved_at,
    }));
  }
  return { ...message, actionHistory };
}

export async function listEmailRouterDirectory({ client, search = '' }) {
  const [destinationResult, groupResult] = await Promise.all([
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
  ]);
  if (destinationResult.error) storageUnavailable(destinationResult.error);
  if (groupResult.error) storageUnavailable(groupResult.error);
  const destinations = destinationResult.data || [];
  const profiles = await emailRouterProfilesById(client, destinations.map((destination) => destination.user_profile_id));
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
      sortOrder: destination.sort_order,
      matchesSearch: !needle || searchable.includes(needle),
    };
  }).filter(Boolean);
  const availableDestinationIds = new Set(availableDestinationItems.map((item) => item.id));
  const destinationItems = availableDestinationItems.filter((item) => item.matchesSearch);
  const groupItems = (groupResult.data || []).map((group) => {
    const memberCount = (group.destination_group_members || []).filter((member) => availableDestinationIds.has(member.destination_id)).length;
    const searchable = `${group.display_name || ''} group`.toLowerCase();
    if (!memberCount || (needle && !searchable.includes(needle))) return null;
    return { id: group.id, kind: 'group', label: group.display_name, memberCount, sortOrder: group.sort_order };
  }).filter(Boolean);
  return [...destinationItems, ...groupItems]
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.label.localeCompare(right.label))
    .map(({ sortOrder: _sortOrder, matchesSearch: _matchesSearch, ...item }) => item);
}

export async function listEmailRouterPresets(client) {
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.presets).select('id,preset_key,display_name,description,active,updated_at,routing_preset_destinations(destination_id,group_id,recipient_kind,position)').eq('active', true).order('display_name');
  if (error) storageUnavailable(error);
  return (data || []).map((preset) => ({ id: preset.id, key: preset.preset_key, label: preset.display_name, description: preset.description, updatedAt: preset.updated_at, destinations: (preset.routing_preset_destinations || []).map(({ destination_id, group_id, recipient_kind, position }) => ({ destinationId: destination_id, groupId: group_id, kind: recipient_kind, position })) }));
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

function singleHeader(fields, name) {
  const values = fields.filter((field) => field.name === name);
  if (values.length !== 1) throw routerError('The original message cannot be safely redirected.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
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
  return ['from', 'sender', 'reply-to', 'to', 'cc', 'bcc', 'subject', 'return-path', 'received', 'authentication-results', 'dkim-signature', 'domainkey-signature', 'content-length'].includes(name)
    || name.startsWith('resent-') || name.startsWith('arc-') || name.startsWith('x-ms-exchange-') || name.startsWith('x-forefront-antispam') || name === 'x-emailrouter-redirect';
}

export function buildEmailRouterRedirectMime({ raw, mailboxAddress, recipients }) {
  const input = Buffer.from(raw);
  if (input.byteLength > MAX_MIME_BYTES) throw routerError('The original message is too large for safe redirect.', 400, 'EMAIL_ROUTER_REDIRECT_TOO_LARGE');
  const boundary = headerBoundary(input);
  const fields = parseHeaders(input, boundary.end);
  if (fields.some((field) => field.name === 'bcc' || field.name.startsWith('resent-') || field.name === 'x-emailrouter-redirect')) throw routerError('The original message cannot be safely redirected.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
  const contentType = fields.filter((field) => field.name === 'content-type').map((field) => field.value).join(' ');
  if (/multipart\/signed|application\/(?:x-)?pkcs7-mime|text\/calendar/i.test(contentType) || fields.some((field) => field.name === 'x-ms-exchange-organization-rightsprotectmessage')) throw routerError('Protected, signed, or meeting messages cannot be safely redirected.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
  const sender = parsedMailbox(singleHeader(fields, 'from').value);
  singleHeader(fields, 'message-id');
  const replyTo = fields.filter((field) => field.name === 'reply-to');
  if (replyTo.length > 1) throw routerError('The original message cannot be safely redirected.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
  const reply = replyTo.length ? parsedMailbox(replyTo[0].value).address : sender.address;
  const subjectFields = fields.filter((field) => field.name === 'subject');
  if (subjectFields.length > 1) throw routerError('The original message cannot be safely redirected.', 400, 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
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

function hasRecipientInput(input) {
  return Boolean(input.presetId || normalizeEmailRouterDestinationSelections(input).length);
}

async function presetRecipients(client, presetId) {
  if (!presetId) return [];
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.presetDestinations)
    .select('destination_id,group_id,recipient_kind,position')
    .eq('preset_id', safeId(presetId, 'preset identifier'))
    .order('recipient_kind')
    .order('position');
  if (error) storageUnavailable(error);
  return (data || []).map((row) => ({
    destinationId: row.destination_id || null,
    groupId: row.group_id || null,
    kind: row.recipient_kind,
    position: row.position,
  }));
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

async function persistActionDestinations(client, actionId, input) {
  const rows = input.presetId
    ? await routerTable(client, EMAIL_ROUTER_STORAGE.presetDestinations)
      .select('destination_id,group_id,recipient_kind,position')
      .eq('preset_id', safeId(input.presetId, 'preset identifier'))
      .order('recipient_kind')
      .order('position')
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

export async function resolveEmailRouterActionRecipients(client, input) {
  const selected = input.presetId
    ? await presetRecipients(client, input.presetId)
    : normalizeEmailRouterDestinationSelections(input);
  const expanded = await expandRoutingSelections(client, selected);
  const destinationIds = [...new Set(expanded.map((selection) => selection.destinationId))];
  const addresses = await destinationAddresses(client, destinationIds);
  const addressByDestination = new Map(destinationIds.map((destinationId, index) => [destinationId, addresses[index]]));
  const recipients = expanded.map((selection) => ({ address: addressByDestination.get(selection.destinationId), kind: selection.kind }));
  return normalizedRecipients(recipients);
}

function requestFingerprint({ mailboxId, messageId, actionType, input }) {
  const destinationSelections = normalizeEmailRouterDestinationSelections(input)
    .map(({ destinationId, groupId, kind, position }) => `${kind}:${position}:${destinationId ? `destination:${destinationId}` : `group:${groupId}`}`);
  return createHash('sha256').update(JSON.stringify({
    actionType,
    bodyHash: createHash('sha256').update(String(input.comment || input.body || ''), 'utf8').digest('hex'),
    destinationFolderId: input.destinationFolderId || null,
    destinationSelections,
    mailboxId,
    messageId,
    presetId: input.presetId || null,
  })).digest('hex');
}

function actionResult(action) {
  const reversible = ['archive', 'delete', 'move'].includes(action.action_type) && action.state === 'confirmed';
  return {
    id: action.id,
    actionId: action.id,
    action: action.action_type,
    status: action.state,
    ...(reversible ? { undoToken: action.id } : {}),
  };
}

async function createGraphDraft({ client, mailbox, actionType, sourceMessageId, input }, dependencies) {
  if (actionType === 'redirect') {
    const source = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(sourceMessageId)}/$value`), { headers: { accept: 'message/rfc822' } }, dependencies);
    const raw = new Uint8Array(await source.arrayBuffer());
    const recipients = await resolveEmailRouterActionRecipients(client, input);
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
  const response = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(sourceMessageId)}/${route}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comment: text(input.comment || input.body, 20_000) }) }, dependencies);
  const draft = await graphJson(response);
  const draftId = safeId(draft?.id, 'draft identifier');
  if (actionType === 'forward' && hasRecipientInput(input)) {
    const recipients = await resolveEmailRouterActionRecipients(client, input);
    const graphRecipients = (kind) => recipients.filter((recipient) => recipient.kind === kind).map((recipient) => ({ emailAddress: { address: recipient.address } }));
    await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(draftId)}`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ toRecipients: graphRecipients('to'), ccRecipients: graphRecipients('cc'), bccRecipients: graphRecipients('bcc') }) }, dependencies);
  }
  return draftId;
}

export async function startEmailRouterAction({ client, profile, mailbox, actionType, sourceMessageId, input = {} }, dependencies = {}) {
  if (!ACTIONS.has(actionType)) throw routerError('Unsupported email action.', 400, 'EMAIL_ROUTER_ACTION_INVALID');
  if (['redirect', 'reply', 'forward'].includes(actionType)) requireExternalActionGate('email_delivery', dependencies.env || process.env);
  const source = safeId(sourceMessageId, 'message identifier');
  if (actionType === 'undo') return undoEmailRouterAction({ client, mailbox, sourceMessageId: source, profile }, dependencies);
  const indexed = await actionMessage(client, mailbox.id, source);
  const directSelections = normalizeEmailRouterDestinationSelections(input);
  if (input.presetId && directSelections.length) {
    throw routerError('Choose either one routing preset or direct destinations.', 400, 'EMAIL_ROUTER_ROUTE_AMBIGUOUS');
  }
  if (['redirect', 'forward'].includes(actionType) && !hasRecipientInput(input)) {
    throw routerError('At least one To, Cc, or Bcc recipient is required.', 400, 'EMAIL_ROUTER_RECIPIENT_REQUIRED');
  }
  const suppliedIdempotencyKey = text(input.idempotencyKey || input.operationId, 200);
  if (suppliedIdempotencyKey && suppliedIdempotencyKey.length < 16) {
    throw routerError('The mail operation identifier is invalid.', 400, 'EMAIL_ROUTER_IDEMPOTENCY_INVALID');
  }
  const idempotencyKey = suppliedIdempotencyKey || randomUUID();
  const action = await createAction(client, {
    message_id: indexed.id,
    preset_id: input.presetId || null,
    action_type: actionType,
    state: 'reserved',
    requested_by: profile.id,
    idempotency_key: idempotencyKey,
    request_fingerprint: requestFingerprint({ mailboxId: mailbox.id, messageId: indexed.id, actionType, input }),
  });
  if (action.duplicate) return actionResult(action);
  await recordEvent(client, { eventType: 'mail_action.reserved', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id });
  try {
    const sourceResponse = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(source)}?$select=id,parentFolderId`), {}, dependencies);
    const sourceMessage = await graphJson(sourceResponse);
    if (!sourceMessage?.id) throw routerError('The source message is unavailable.', 404, 'EMAIL_ROUTER_MESSAGE_UNAVAILABLE');
  } catch (error) {
    const failureCode = String(error.code || 'email_router_message_unavailable').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
    await updateAction(client, action.id, { state: 'failed', failure_code: failureCode, failed_at: new Date().toISOString() });
    await recordEvent(client, { eventType: 'mail_action.failed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id });
    throw error;
  }
  if (['redirect', 'forward'].includes(actionType)) {
    try {
      await persistActionDestinations(client, action.id, input);
    } catch (error) {
      const failureCode = String(error.code || 'email_router_route_invalid').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
      await updateAction(client, action.id, { state: 'failed', failure_code: failureCode, failed_at: new Date().toISOString() });
      await recordEvent(client, { eventType: 'mail_action.failed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id });
      throw error;
    }
  }
  if (actionType === 'archive' || actionType === 'delete' || actionType === 'move' || actionType === 'mark_read') {
    if (actionType === 'mark_read') {
      await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(source)}`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isRead: true }) }, dependencies);
      await updateAction(client, action.id, { state: 'confirmed', confirmed_at: new Date().toISOString() });
      await recordEvent(client, { eventType: 'mail_action.confirmed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id });
      return actionResult({ ...action, state: 'confirmed' });
    }
    const destinationId = actionType === 'archive' ? 'archive' : actionType === 'delete' ? 'deleteditems' : safeId(input.destinationFolderId, 'destination folder identifier');
    const uncertainAt = new Date().toISOString();
    await updateAction(client, action.id, { state: 'uncertain', uncertain_at: uncertainAt });
    try {
      const response = await emailRouterGraphFetch(mailboxPath(mailbox, `/messages/${encodeURIComponent(source)}/move`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ destinationId }) }, dependencies);
      const result = await graphJson(response);
      await updateAction(client, action.id, { state: 'confirmed', provider_operation_id: result?.id || source, confirmed_at: new Date().toISOString() });
      await recordEvent(client, { eventType: 'mail_action.confirmed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id });
      return actionResult({ ...action, state: 'confirmed', provider_operation_id: result?.id || source });
    } catch (error) {
      const failureCode = String(error.code || 'email_router_move_unknown').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
      await updateAction(client, action.id, { failure_code: failureCode });
      await recordEmailRouterAlert(client, { mailboxId: mailbox.id, messageId: indexed.id, mailActionId: action.id, code: failureCode, severity: 'critical', dedupeKey: `mail-action:${action.id}:uncertain` });
      return actionResult({ ...action, state: 'uncertain', uncertain_at: uncertainAt });
    }
  }
  try {
    const draftId = await createGraphDraft({ client, mailbox, actionType, sourceMessageId: source, input }, dependencies);
    await updateAction(client, action.id, { state: 'draft_created', provider_operation_id: draftId, draft_created_at: new Date().toISOString() });
    await enqueueOutbox(client, { mail_action_id: action.id, state: 'draft_created', provider_operation_id: draftId, next_attempt_at: new Date().toISOString() });
    await recordEvent(client, { eventType: 'mail_action.draft_created', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id });
    return actionResult({ ...action, state: 'draft_created', provider_operation_id: draftId });
  } catch (error) {
    const failureCode = String(error.code || 'email_router_draft_failed').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
    await updateAction(client, action.id, { state: 'failed', failure_code: failureCode, failed_at: new Date().toISOString() });
    await recordEvent(client, { eventType: 'mail_action.failed', entityType: 'mail_action', entityId: action.id, actorUserId: profile.id });
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

async function confirmSubmittedAction({ client, mailbox, action, message, actorUserId }, dependencies) {
  if (action.action_type === 'redirect') {
    try {
      await archiveConfirmedRedirectSource(mailbox, message, dependencies);
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

export async function processEmailRouterOutbox({ client, mailbox, limit = 10 }, dependencies = {}) {
  const maximum = Math.min(25, Math.max(1, Number(limit) || 10));
  const currentTime = new Date().toISOString();
  const relation = 'mail_actions(id,action_type,state,provider_operation_id,requested_by,messages(id,provider_message_id,mailbox_id))';
  const { data: deliveryEntries, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
    .select(`id,mail_action_id,state,attempt_count,provider_operation_id,${relation}`)
    .in('state', ['reserved', 'draft_created'])
    .lte('next_attempt_at', currentTime)
    .order('next_attempt_at')
    .limit(maximum);
  if (error) storageUnavailable(error);
  const { data: reconciliationEntries, error: reconcileError } = await routerTable(client, EMAIL_ROUTER_STORAGE.outbox)
    .select(`id,mail_action_id,state,attempt_count,provider_operation_id,${relation}`)
    .in('state', ['submitted', 'uncertain'])
    .lte('reconcile_after', currentTime)
    .order('reconcile_after')
    .limit(maximum);
  if (reconcileError) storageUnavailable(reconcileError);
  let submitted = 0;
  let confirmed = 0;
  for (const entry of [...(deliveryEntries || []), ...(reconciliationEntries || [])]) {
    const action = Array.isArray(entry.mail_actions) ? entry.mail_actions[0] : entry.mail_actions;
    const message = Array.isArray(action?.messages) ? action.messages[0] : action?.messages;
    if (!action || !message || action.state === 'confirmed') continue;
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
        submitted += 1;
      } catch (error) {
        const failureCode = String(error.code || 'email_router_submission_unknown').toLowerCase().replaceAll(/[^a-z0-9_.-]/g, '_').slice(0, 120);
        await routerTable(client, EMAIL_ROUTER_STORAGE.outbox).update({ state: 'uncertain', failure_code: failureCode, reconcile_after: new Date(Date.now() + 60_000).toISOString() }).eq('id', entry.id);
        await recordEmailRouterAlert(client, { mailboxId: mailbox.id, messageId: message.id, mailActionId: entry.mail_action_id, code: failureCode, severity: 'critical', dedupeKey: `mail-action:${entry.mail_action_id}:uncertain` });
        continue;
      }
    }
    if (await sentDraftConfirmed(mailbox, action.provider_operation_id, dependencies)) {
      const didConfirm = await confirmSubmittedAction({ client, mailbox, action, message, actorUserId: action.requested_by }, dependencies);
      if (didConfirm) confirmed += 1;
    }
  }
  return { submitted, confirmed };
}

export async function getEmailRouterActionStatus(client, actionId) {
  const { data, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions)
    .select('id,state,action_type,provider_operation_id')
    .eq('id', safeId(actionId, 'mail action identifier'))
    .maybeSingle();
  if (error) storageUnavailable(error);
  if (!data) throw routerError('Mail action not found.', 404, 'EMAIL_ROUTER_ACTION_NOT_FOUND');
  return actionResult(data);
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

export async function undoEmailRouterAction({ client, mailbox, sourceMessageId, profile }, dependencies = {}) {
  const indexed = await actionMessage(client, mailbox.id, sourceMessageId);
  const { data: action, error } = await routerTable(client, EMAIL_ROUTER_STORAGE.actions).select('id,action_type,state').eq('message_id', indexed.id).in('action_type', ['archive', 'delete', 'move']).eq('state', 'confirmed').order('confirmed_at', { ascending: false }).limit(1).maybeSingle();
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
