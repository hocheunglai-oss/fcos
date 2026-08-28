import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACT_VERSION = 'emailrouter-fcos-operational-migration/v1';
const APPLY_CONFIRMATION = 'apply-emailrouter-operational-config';
const SOURCE_SCHEMA = 'emailrouter';
const PAGE_SIZE = 1_000;
const SYNC_FOLDERS = ['inbox', 'sentitems', 'archive'];
const EMAIL_ROUTER_MAILBOX_PURPOSE = 'email_router_mailbox';
const ALLOWED_SETTING_KEYS = new Set(['directory.allowed_domains']);

export class MigrationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^@/, '');
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ? domain : null;
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function externalKey(namespace, value) {
  return fingerprint(`${CONTRACT_VERSION}:${namespace}:${String(value || '')}`);
}

function stableSort(rows, key) {
  return [...rows].sort((left, right) => String(key(left)).localeCompare(String(key(right))));
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function boundedText(value, maxLength, field) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength) throw new MigrationError(`INVALID_${field}`);
  return text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function findDuplicateEmails(rows) {
  const counts = new Map();
  let invalid = 0;
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) {
      invalid += 1;
      continue;
    }
    counts.set(email, (counts.get(email) || 0) + 1);
  }
  return {
    invalid,
    duplicateCount: [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0),
    emails: counts,
  };
}

export function buildActiveUserMapping(sourceUsers, targetUsers) {
  const source = findDuplicateEmails(sourceUsers);
  const target = findDuplicateEmails(targetUsers);
  const sourceOnly = [];
  const targetOnly = [];

  for (const email of source.emails.keys()) if (!target.emails.has(email)) sourceOnly.push(email);
  for (const email of target.emails.keys()) if (!source.emails.has(email)) targetOnly.push(email);

  const problemCodes = [];
  if (source.invalid) problemCodes.push('INVALID_SOURCE_ACTIVE_USER_EMAIL');
  if (target.invalid) problemCodes.push('INVALID_TARGET_ACTIVE_USER_EMAIL');
  if (source.duplicateCount) problemCodes.push('DUPLICATE_SOURCE_ACTIVE_USER_EMAIL');
  if (target.duplicateCount) problemCodes.push('DUPLICATE_TARGET_ACTIVE_USER_EMAIL');
  if (sourceOnly.length) problemCodes.push('UNMATCHED_SOURCE_ACTIVE_USER');
  if (problemCodes.length) throw new MigrationError(problemCodes[0]);

  const targetsByEmail = new Map(targetUsers.map((row) => [normalizeEmail(row.email), row]));
  const bySourceId = new Map();
  for (const sourceUser of sourceUsers) {
    const email = normalizeEmail(sourceUser.email);
    const targetUser = targetsByEmail.get(email);
    if (!sourceUser.id || !targetUser?.id) throw new MigrationError('ACTIVE_USER_MAPPING_INCOMPLETE');
    bySourceId.set(sourceUser.id, { targetUserId: targetUser.id, normalizedEmail: email });
  }

  return {
    bySourceId,
    targetOnlyUsers: targetUsers
      .filter((row) => targetOnly.includes(normalizeEmail(row.email)))
      .map((row) => ({
        targetUserId: row.id,
        normalizedEmail: normalizeEmail(row.email),
      })),
    summary: {
      sourceActive: sourceUsers.length,
      targetActive: targetUsers.length,
      matched: bySourceId.size,
      duplicateSourceEmails: source.duplicateCount,
      duplicateTargetEmails: target.duplicateCount,
      invalidSourceEmails: source.invalid,
      invalidTargetEmails: target.invalid,
      unmatchedSource: sourceOnly.length,
      unmatchedTarget: targetOnly.length,
    },
  };
}

function normalizeAllowedDomains(setting) {
  if (!setting) return null;
  const domains = setting?.value?.domains;
  if (!Array.isArray(domains)) throw new MigrationError('INVALID_DIRECTORY_ALLOWED_DOMAINS');
  const normalized = [...new Set(domains.map(normalizeDomain).filter(Boolean))].sort();
  if (!normalized.length || normalized.length !== domains.length) {
    throw new MigrationError('INVALID_DIRECTORY_ALLOWED_DOMAINS');
  }
  return { key: 'directory.allowed_domains', value: { domains: normalized } };
}

export function buildOperationalPayload(source, activeUserMapping, mailboxConnection) {
  if (!mailboxConnection?.targetMailboxId) throw new MigrationError('TARGET_EMAIL_ROUTER_MAILBOX_NOT_ASSIGNED');
  const activeSourceUsers = new Map(asArray(source.activeUsers).map((user) => [user.id, user]));
  const providerDirectoryDestinations = [];
  const fcosProfileDestinations = [];
  const destinationsBySourceId = new Map();
  const activeMembers = asArray(source.teamMembers);
  const memberEmails = findDuplicateEmails(activeMembers);
  if (memberEmails.invalid) throw new MigrationError('INVALID_OPERATIONAL_CONTACT_EMAIL');
  if (memberEmails.duplicateCount) throw new MigrationError('DUPLICATE_OPERATIONAL_CONTACT_EMAIL');

  for (const member of stableSort(activeMembers, (row) => row.id)) {
    if (!member?.id) throw new MigrationError('INVALID_OPERATIONAL_CONTACT_ID');
    const email = normalizeEmail(member.email);
    const displayName = boundedText(member.display_name, 160, 'OPERATIONAL_CONTACT_NAME');
    const destinationType = member.destination_type === 'shared' ? 'shared' : member.destination_type === 'person' ? 'person' : null;
    if (!email || !destinationType) throw new MigrationError('INVALID_OPERATIONAL_CONTACT');

    const sourceUser = member.app_user_id ? activeSourceUsers.get(member.app_user_id) : null;
    const mappedUser = sourceUser ? activeUserMapping.bySourceId.get(sourceUser.id) : null;
    if (member.app_user_id && !mappedUser) throw new MigrationError('UNMAPPED_OPERATIONAL_USER_CONTACT');
    if (mappedUser && mappedUser.normalizedEmail !== email) throw new MigrationError('ACTIVE_USER_CONTACT_EMAIL_MISMATCH');

    const sourceKey = externalKey('destination', member.id);
    const destination = { sourceKey, normalizedEmail: email };
    if (mappedUser) {
      // The target derives all user identity attributes live from user_profiles.
      fcosProfileDestinations.push({ source_key: sourceKey, user_profile_id: mappedUser.targetUserId });
    } else {
      providerDirectoryDestinations.push({
        source_key: sourceKey,
        email_address: email,
        display_name: displayName,
        destination_type: destinationType,
        sort_order: nonNegativeInteger(member.sort_order),
      });
    }
    destinationsBySourceId.set(member.id, destination);
  }

  for (const targetUser of activeUserMapping.targetOnlyUsers || []) {
    if (!targetUser.targetUserId) throw new MigrationError('ACTIVE_USER_MAPPING_INCOMPLETE');
    fcosProfileDestinations.push({
      source_key: externalKey('fcos-profile', targetUser.targetUserId),
      user_profile_id: targetUser.targetUserId,
    });
  }

  const destinationGroups = [];
  const groupsBySourceId = new Map();
  for (const group of stableSort(asArray(source.departments), (row) => row.id)) {
    if (!group?.id) throw new MigrationError('INVALID_DESTINATION_GROUP_ID');
    const item = {
      sourceKey: externalKey('destination-group', group.id),
      groupKey: boundedText(group.slug, 120, 'DESTINATION_GROUP_KEY'),
      displayName: boundedText(group.name, 255, 'DESTINATION_GROUP_NAME'),
      active: group.active !== false,
    };
    destinationGroups.push(item);
    groupsBySourceId.set(group.id, item);
  }

  const destinationGroupMembers = [];
  const groupMembershipKeys = new Set();
  for (const membership of stableSort(asArray(source.departmentRecipients), (row) => `${row.department_id}:${row.team_member_id}:${row.recipient_kind}`)) {
    const group = groupsBySourceId.get(membership.department_id);
    const destination = destinationsBySourceId.get(membership.team_member_id);
    if (!group || !destination || membership.active === false) continue;
    const recipientEmail = normalizeEmail(membership.recipient_email);
    if (!recipientEmail || recipientEmail !== destination.normalizedEmail) throw new MigrationError('DESTINATION_GROUP_MEMBER_EMAIL_MISMATCH');
    const key = `${group.sourceKey}:${destination.sourceKey}`;
    if (groupMembershipKeys.has(key)) continue;
    groupMembershipKeys.add(key);
    destinationGroupMembers.push({
      groupSourceKey: group.sourceKey,
      destinationSourceKey: destination.sourceKey,
    });
  }

  const routingPresets = [];
  const presetsBySourceId = new Map();
  for (const preset of stableSort(asArray(source.routingPresets), (row) => row.id)) {
    if (!preset?.id) throw new MigrationError('INVALID_ROUTING_PRESET_ID');
    const name = boundedText(preset.name, 160, 'ROUTING_PRESET_NAME');
    const description = String(preset.description || '').trim();
    if (description.length > 1_000) throw new MigrationError('INVALID_ROUTING_PRESET_DESCRIPTION');
    const item = {
      sourceKey: externalKey('routing-preset', preset.id),
      name,
      description,
      active: preset.active !== false,
      sortOrder: nonNegativeInteger(preset.sort_order),
    };
    routingPresets.push(item);
    presetsBySourceId.set(preset.id, item);
  }

  const presetMembers = [];
  const membershipKeys = new Set();
  let staleMembershipsExcluded = 0;
  for (const membership of stableSort(asArray(source.routingPresetRecipients), (row) => `${row.preset_id}:${row.position}:${row.team_member_id || ''}`)) {
    const preset = presetsBySourceId.get(membership.preset_id);
    const destination = destinationsBySourceId.get(membership.team_member_id);
    if (!preset || !destination) {
      staleMembershipsExcluded += 1;
      continue;
    }
    const recipientEmail = normalizeEmail(membership.recipient_email);
    if (!recipientEmail || recipientEmail !== destination.normalizedEmail) throw new MigrationError('ROUTING_PRESET_MEMBER_EMAIL_MISMATCH');
    const recipientKind = ['to', 'cc', 'bcc'].includes(membership.recipient_kind) ? membership.recipient_kind : null;
    if (!recipientKind) throw new MigrationError('INVALID_ROUTING_PRESET_MEMBER_KIND');
    const key = `${preset.sourceKey}:${destination.sourceKey}:${recipientKind}`;
    if (membershipKeys.has(key)) throw new MigrationError('DUPLICATE_ROUTING_PRESET_MEMBER');
    membershipKeys.add(key);
    presetMembers.push({
      routingPresetSourceKey: preset.sourceKey,
      destinationSourceKey: destination.sourceKey,
      recipientKind,
      position: nonNegativeInteger(membership.position),
    });
  }

  const settings = [];
  for (const setting of asArray(source.settings)) {
    if (ALLOWED_SETTING_KEYS.has(setting?.key)) {
      const normalized = normalizeAllowedDomains(setting);
      if (normalized) settings.push(normalized);
    }
  }

  const orderedPresetMembers = stableSort(
    presetMembers,
    (row) => `${row.routingPresetSourceKey}:${row.recipientKind}:${String(row.position).padStart(8, '0')}:${row.destinationSourceKey}`,
  );
  const nextPresetPosition = new Map();
  for (const item of orderedPresetMembers) {
    const bucket = `${item.routingPresetSourceKey}:${item.recipientKind}`;
    const position = (nextPresetPosition.get(bucket) || 0) + 1;
    nextPresetPosition.set(bucket, position);
    item.position = position;
  }

  const payload = {
    contractVersion: CONTRACT_VERSION,
    sourceSystem: 'emailrouter',
    mailboxConnection: {
      purpose_key: EMAIL_ROUTER_MAILBOX_PURPOSE,
      mailbox_id: mailboxConnection.targetMailboxId,
    },
    providerDirectoryDestinations: stableSort(providerDirectoryDestinations, (row) => row.source_key),
    fcosProfileDestinations: stableSort(fcosProfileDestinations, (row) => row.source_key),
    destinationGroups: stableSort(destinationGroups, (row) => row.sourceKey),
    destinationGroupMembers: stableSort(destinationGroupMembers, (row) => `${row.groupSourceKey}:${row.destinationSourceKey}`),
    routingPresets: stableSort(routingPresets, (row) => row.sourceKey),
    routingPresetMembers: orderedPresetMembers,
    settings: stableSort(settings, (row) => row.key),
  };
  return {
    payload,
    fingerprint: fingerprint(payload),
    counts: {
      providerDirectoryDestinations: payload.providerDirectoryDestinations.length,
      fcosProfileDestinations: payload.fcosProfileDestinations.length,
      destinationGroups: payload.destinationGroups.length,
      destinationGroupMembers: payload.destinationGroupMembers.length,
      routingPresets: payload.routingPresets.length,
      routingPresetMembers: payload.routingPresetMembers.length,
      settings: payload.settings.length,
      staleMembershipsExcluded,
    },
  };
}

function sanitizeMetadataRows(rows) {
  return stableSort(rows, (row) => `${row.folder_id}:${row.provider_message_id}`).map((row) => ({
    providerMessageId: String(row.provider_message_id || ''),
    folderId: row.folder_id,
    receivedAt: row.received_at || null,
    sentAt: row.sent_at || null,
    isRead: row.is_read === true,
    hasAttachments: row.has_attachments === true,
    attachmentCount: nonNegativeInteger(row.attachment_count),
    status: String(row.status || ''),
  }));
}

export function buildMetadataSyncPlan(rows) {
  const byFolder = Object.fromEntries(SYNC_FOLDERS.map((folder) => [folder, []]));
  for (const row of rows) if (byFolder[row.folder_id]) byFolder[row.folder_id].push(row);
  const folders = Object.fromEntries(SYNC_FOLDERS.map((folder) => {
    const metadata = sanitizeMetadataRows(byFolder[folder]);
    return [folder, { count: metadata.length, fingerprint: fingerprint(metadata) }];
  }));
  const sourceMetadata = { folders };
  const idempotencyKey = fingerprint({ contractVersion: CONTRACT_VERSION, operation: 'rebuild_mail_metadata', sourceMetadata });
  return {
    request: {
      contractVersion: CONTRACT_VERSION,
      operation: 'rebuild_mail_metadata',
      mailboxPurposeKey: EMAIL_ROUTER_MAILBOX_PURPOSE,
      folders: SYNC_FOLDERS,
      sourceMetadata,
      idempotencyKey,
    },
    summary: {
      prepared: true,
      folders,
      idempotencyKeyHash: fingerprint(idempotencyKey),
    },
  };
}

function validateBaseUrl(value, name) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new MigrationError(`INVALID_${name}`);
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new MigrationError(`INVALID_${name}`);
  }
  return url.toString().replace(/\/$/, '');
}

function requiredEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new MigrationError(`MISSING_${key}`);
  return value;
}

export function readEnvironment(env = process.env) {
  const sourceExportFile = String(env.EMAILROUTER_SOURCE_EXPORT_FILE || '').trim();
  return {
    source: sourceExportFile
      ? { exportFile: resolve(sourceExportFile), schema: SOURCE_SCHEMA }
      : {
        url: validateBaseUrl(requiredEnv(env, 'EMAILROUTER_SOURCE_SUPABASE_URL'), 'EMAILROUTER_SOURCE_SUPABASE_URL'),
        serviceKey: requiredEnv(env, 'EMAILROUTER_SOURCE_SUPABASE_SERVICE_ROLE_KEY'),
        schema: SOURCE_SCHEMA,
      },
    target: {
      url: validateBaseUrl(requiredEnv(env, 'FCOS_TARGET_SUPABASE_URL'), 'FCOS_TARGET_SUPABASE_URL'),
      serviceKey: requiredEnv(env, 'FCOS_TARGET_SUPABASE_SERVICE_ROLE_KEY'),
    },
    syncApiUrl: env.FCOS_EMAIL_ROUTER_SYNC_API_URL
      ? validateBaseUrl(env.FCOS_EMAIL_ROUTER_SYNC_API_URL, 'FCOS_EMAIL_ROUTER_SYNC_API_URL')
      : null,
    syncSecret: String(env.FCOS_EMAIL_ROUTER_SYNC_SECRET || '').trim() || null,
  };
}

function restUrl(connection, path, query = '') {
  return `${connection.url}/rest/v1/${path}${query ? `?${query}` : ''}`;
}

function headers(connection, schema, extra = {}) {
  return {
    apikey: connection.serviceKey,
    Authorization: `Bearer ${connection.serviceKey}`,
    ...(schema ? { 'Accept-Profile': schema, 'Content-Profile': schema } : {}),
    ...extra,
  };
}

async function request(fetchFn, url, options, failureCode) {
  let response;
  try {
    response = await fetchFn(url, options);
  } catch {
    throw new MigrationError(failureCode);
  }
  if (!response.ok) throw new MigrationError(failureCode);
  return response;
}

export async function fetchPaged({ fetchFn = fetch, connection, schema, table, select, filters = [], failurePrefix = 'SOURCE' }) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({ select, ...Object.fromEntries(filters) });
    const response = await request(fetchFn, restUrl(connection, table, params.toString()), {
      headers: headers(connection, schema, { Range: `${offset}-${offset + PAGE_SIZE - 1}` }),
    }, `${failurePrefix}_${table.toUpperCase()}_READ_FAILED`);
    let page;
    try {
      page = await response.json();
    } catch {
      throw new MigrationError(`${failurePrefix}_${table.toUpperCase()}_INVALID_RESPONSE`);
    }
    if (!Array.isArray(page)) throw new MigrationError(`${failurePrefix}_${table.toUpperCase()}_INVALID_RESPONSE`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function filteredExportRows(records, table, predicate = () => true) {
  return records.filter((record) => record.table === table && predicate(record.row)).map((record) => record.row);
}

async function loadSourceExport(exportFile) {
  const details = await stat(exportFile).catch(() => null);
  if (!details?.isFile() || details.size <= 0 || details.size > 400 * 1024 * 1024) throw new MigrationError('INVALID_SOURCE_EXPORT_FILE');
  const content = await readFile(exportFile, 'utf8');
  const rows = [];
  let manifest = null;
  let complete = null;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { throw new MigrationError('INVALID_SOURCE_EXPORT_FORMAT'); }
    if (entry?.type === 'manifest') manifest = entry;
    else if (entry?.type === 'record' && entry.table && entry.row && typeof entry.row === 'object') rows.push(entry);
    else if (entry?.type === 'complete') complete = entry;
  }
  if (manifest?.format !== 'emailrouter-ndjson' || manifest?.mailboxContentIncluded !== false || manifest?.attachmentBytesIncluded !== false || !complete?.counts) {
    throw new MigrationError('INVALID_SOURCE_EXPORT_CONTRACT');
  }
  const activeUsers = filteredExportRows(rows, 'app_users', (row) => row.active === true && row.source_active === true);
  const teamMembers = filteredExportRows(rows, 'team_members', (row) => row.active === true && !row.deleted_at);
  const departments = filteredExportRows(rows, 'departments', (row) => !row.deleted_at);
  const departmentRecipients = filteredExportRows(rows, 'department_recipient_assignments', (row) => row.active === true && !row.deleted_at);
  const routingPresets = filteredExportRows(rows, 'routing_presets', (row) => !row.deleted_at);
  const routingPresetRecipients = filteredExportRows(rows, 'routing_preset_recipients');
  const settings = filteredExportRows(rows, 'app_settings', (row) => row.key === 'directory.allowed_domains');
  const settingKeys = filteredExportRows(rows, 'app_settings').map((row) => ({ key: row.key }));
  const metadataRows = filteredExportRows(rows, 'email_messages', (row) => SYNC_FOLDERS.includes(row.folder_id) && !row.deleted_at);
  const subscriptions = filteredExportRows(rows, 'microsoft_subscriptions');
  const actions = filteredExportRows(rows, 'mail_actions');
  return {
    activeUsers,
    teamMembers,
    departments,
    departmentRecipients,
    routingPresets,
    routingPresetRecipients,
    settings,
    settingKeys,
    metadataRows,
    inventory: {
      exportFormat: manifest.format,
      exportSchemaVersion: Number(manifest.schemaVersion || 0),
      metadataRecords: metadataRows.length,
      activeSubscriptions: subscriptions.filter((row) => row.status === 'active' || row.state === 'active').length,
      pendingActions: actions.filter((row) => !['completed', 'confirmed', 'failed', 'cancelled'].includes(String(row.state || row.status || '').toLowerCase())).length,
    },
  };
}

async function loadSourceData(connections, fetchFn) {
  if (connections.source.exportFile) return loadSourceExport(connections.source.exportFile);
  const [activeUsers, teamMembers, departments, departmentRecipients, routingPresets, routingPresetRecipients, settings, settingKeys, metadataRows] = await Promise.all([
    fetchPaged({ fetchFn, connection: connections.source, schema: SOURCE_SCHEMA, table: 'app_users', select: 'id,email,active,source_active', filters: [['active', 'eq.true'], ['source_active', 'eq.true']] }),
    fetchPaged({ fetchFn, connection: connections.source, schema: SOURCE_SCHEMA, table: 'team_members', select: 'id,app_user_id,display_name,email,destination_type,sort_order,active,deleted_at', filters: [['active', 'eq.true'], ['deleted_at', 'is.null']] }),
    fetchPaged({ fetchFn, connection: connections.source, schema: SOURCE_SCHEMA, table: 'departments', select: 'id,name,slug,active,deleted_at', filters: [['deleted_at', 'is.null']] }),
    fetchPaged({ fetchFn, connection: connections.source, schema: SOURCE_SCHEMA, table: 'department_recipient_assignments', select: 'department_id,team_member_id,recipient_email,recipient_kind,active,deleted_at', filters: [['active', 'eq.true'], ['deleted_at', 'is.null']] }),
    fetchPaged({ fetchFn, connection: connections.source, schema: SOURCE_SCHEMA, table: 'routing_presets', select: 'id,name,description,active,deleted_at,sort_order', filters: [['deleted_at', 'is.null']] }),
    fetchPaged({ fetchFn, connection: connections.source, schema: SOURCE_SCHEMA, table: 'routing_preset_recipients', select: 'preset_id,team_member_id,recipient_email,recipient_kind,position' }),
    fetchPaged({ fetchFn, connection: connections.source, schema: SOURCE_SCHEMA, table: 'app_settings', select: 'key,value', filters: [['key', 'eq.directory.allowed_domains']] }),
    fetchPaged({ fetchFn, connection: connections.source, schema: SOURCE_SCHEMA, table: 'app_settings', select: 'key' }),
    fetchPaged({ fetchFn, connection: connections.source, schema: SOURCE_SCHEMA, table: 'email_messages', select: 'mailbox_address,provider_message_id,folder_id,received_at,sent_at,is_read,has_attachments,attachment_count,status', filters: [['folder_id', 'in.(inbox,sentitems,archive)'], ['deleted_at', 'is.null']] }),
  ]);
  return { activeUsers, teamMembers, departments, departmentRecipients, routingPresets, routingPresetRecipients, settings, settingKeys, metadataRows, inventory: { metadataRecords: metadataRows.length } };
}

async function loadTargetActiveUsers(connections, fetchFn) {
  return fetchPaged({
    fetchFn,
    connection: connections.target,
    table: 'user_profiles',
    select: 'id,email,full_name,active',
    filters: [['active', 'eq.true']],
  });
}

function unpackRelation(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function sourceMailboxEvidence(metadataRows) {
  const mailboxes = [...new Set(asArray(metadataRows).map((row) => normalizeEmail(row.mailbox_address)).filter(Boolean))];
  if (mailboxes.length > 1) throw new MigrationError('MULTIPLE_SOURCE_EMAIL_ROUTER_MAILBOXES');
  return mailboxes[0] || null;
}

async function loadTargetMailboxConnection(connections, fetchFn, sourceMailbox) {
  const routes = await fetchPaged({
    fetchFn,
    connection: connections.target,
    table: 'email_sender_routes',
    select: 'purpose_key,mailbox_id,email_sender_mailboxes(id,email_address,active)',
    filters: [['purpose_key', `eq.${EMAIL_ROUTER_MAILBOX_PURPOSE}`]],
    failurePrefix: 'TARGET',
  });
  if (routes.length !== 1) throw new MigrationError('TARGET_EMAIL_ROUTER_MAILBOX_NOT_ASSIGNED');
  const route = routes[0];
  const mailbox = unpackRelation(route.email_sender_mailboxes);
  const targetMailboxEmail = normalizeEmail(mailbox?.email_address);
  if (!route.mailbox_id || !mailbox?.id || mailbox.active !== true || !targetMailboxEmail) {
    throw new MigrationError('TARGET_EMAIL_ROUTER_MAILBOX_NOT_ASSIGNED');
  }
  if (sourceMailbox && sourceMailbox !== targetMailboxEmail) throw new MigrationError('EMAIL_ROUTER_MAILBOX_MISMATCH');
  return {
    targetMailboxId: mailbox.id,
    sourceMailboxObserved: Boolean(sourceMailbox),
    mailboxFingerprint: fingerprint(targetMailboxEmail),
  };
}

function parseArgs(argv) {
  const values = new Set(argv.slice(2));
  const unknown = [...values].filter((value) => !['--apply', '--dispatch-sync'].includes(value));
  if (unknown.length) throw new MigrationError('INVALID_ARGUMENT');
  if (values.has('--dispatch-sync') && !values.has('--apply')) throw new MigrationError('SYNC_DISPATCH_REQUIRES_APPLY');
  return { apply: values.has('--apply'), dispatchSync: values.has('--dispatch-sync') };
}

function exclusionSummary(source) {
  return {
    userRecords: 'not_migrated',
    actions: 'not_read_or_migrated',
    recommendations: 'not_read_or_migrated',
    aiLearningHistory: 'not_read_or_migrated',
    messageContent: 'not_read_or_migrated',
    recipientArrays: 'not_read_or_migrated',
    messageMetadata: 'sync_rebuild_requested_only',
    unsupportedSettings: Math.max(0, source.settingKeys.length - source.settings.length),
  };
}

async function applyPayload(connections, payload, fetchFn) {
  await request(fetchFn, restUrl(connections.target, 'rpc/apply_emailrouter_operational_config'), {
    method: 'POST',
    headers: headers(connections.target, null, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ p_payload: payload, p_fingerprint: fingerprint(payload) }),
  }, 'TARGET_OPERATIONAL_CONFIG_APPLY_FAILED');
}

async function dispatchSync(connections, syncRequest, fetchFn) {
  if (!connections.syncApiUrl) throw new MigrationError('MISSING_FCOS_EMAIL_ROUTER_SYNC_API_URL');
  if (!connections.syncSecret) throw new MigrationError('MISSING_FCOS_EMAIL_ROUTER_SYNC_SECRET');
  await request(fetchFn, connections.syncApiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connections.syncSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(syncRequest),
  }, 'TARGET_METADATA_SYNC_DISPATCH_FAILED');
}

export async function prepareMigration({ env = process.env, fetchFn = fetch } = {}) {
  const connections = readEnvironment(env);
  const [source, targetUsers] = await Promise.all([loadSourceData(connections, fetchFn), loadTargetActiveUsers(connections, fetchFn)]);
  const activeUserMapping = buildActiveUserMapping(source.activeUsers, targetUsers);
  const mailboxConnection = await loadTargetMailboxConnection(connections, fetchFn, sourceMailboxEvidence(source.metadataRows));
  const operational = buildOperationalPayload(source, activeUserMapping, mailboxConnection);
  const metadataSync = buildMetadataSyncPlan(source.metadataRows);
  return { connections, source, activeUserMapping, mailboxConnection, operational, metadataSync };
}

export async function runMigration({ env = process.env, argv = process.argv, fetchFn = fetch } = {}) {
  const args = parseArgs(argv);
  const prepared = await prepareMigration({ env, fetchFn });
  const applyAllowed = env.EMAILROUTER_MIGRATION_CONFIRM === APPLY_CONFIRMATION;
  if (args.apply && !applyAllowed) throw new MigrationError('APPLY_CONFIRMATION_REQUIRED');
  if (args.apply) await applyPayload(prepared.connections, prepared.operational.payload, fetchFn);
  if (args.dispatchSync) await dispatchSync(prepared.connections, prepared.metadataSync.request, fetchFn);

  return {
    contractVersion: CONTRACT_VERSION,
    mode: args.apply ? 'apply' : 'dry_run',
    outcome: args.apply ? 'applied' : 'ready',
    activeUserReconciliation: prepared.activeUserMapping.summary,
    operationalConfiguration: {
      ...prepared.operational.counts,
      fingerprint: prepared.operational.fingerprint,
      targetApply: args.apply ? 'completed' : 'not_requested',
    },
    mailboxConnection: {
      purposeKey: EMAIL_ROUTER_MAILBOX_PURPOSE,
      assignment: 'verified',
      sourceMailboxObserved: prepared.mailboxConnection.sourceMailboxObserved,
      mailboxFingerprint: prepared.mailboxConnection.mailboxFingerprint,
    },
    sourceInventory: prepared.source.inventory,
    metadataSync: {
      ...prepared.metadataSync.summary,
      dispatch: args.dispatchSync ? 'completed' : 'prepared_not_dispatched',
    },
    excluded: exclusionSummary(prepared.source),
  };
}

export function safeSummary(error) {
  return {
    contractVersion: CONTRACT_VERSION,
    mode: 'dry_run',
    outcome: 'blocked',
    error: { code: error instanceof MigrationError ? error.code : 'UNEXPECTED_FAILURE' },
  };
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(await runMigration())}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeSummary(error))}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  await main();
}
