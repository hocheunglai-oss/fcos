import { createMicrosoftGraphMailTransport, verifyMicrosoftGraphMailAuthentication } from './_microsoftGraphMail.js';
import { isExternalActionEnabled } from './_externalActionGates.js';

const PURPOSE_KEYS = new Set([
  'payment_reminders',
  'outstanding_invoice_reports',
  'incoming_payment_reports',
  'growth_coaching',
  'fcos_updates',
  'hedge_settlement',
  'hedge_sfs_reports',
]);

const transportCache = new Map();

function graphEmailError(message, status = 503, code = 'GRAPH_EMAIL_UNAVAILABLE', details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function cleanText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizedEmail(value) {
  const email = cleanText(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function graphEmailApplicationConfig(env = process.env) {
  const tenantId = cleanText(env.FCOS_MICROSOFT_TENANT_ID, 200);
  const clientId = cleanText(env.FCOS_MICROSOFT_CLIENT_ID, 200);
  return {
    tenantId,
    clientId,
    configured: Boolean(tenantId && clientId),
    deliveryGateEnabled: isExternalActionEnabled('email_delivery', env),
  };
}

function assertPurposeKey(value) {
  const purposeKey = cleanText(value, 100);
  if (!PURPOSE_KEYS.has(purposeKey)) {
    throw graphEmailError('This email purpose is not registered.', 400, 'EMAIL_PURPOSE_INVALID');
  }
  return purposeKey;
}

function serializeMailbox(row) {
  if (!row) return null;
  return {
    id: row.id,
    emailAddress: row.email_address,
    label: row.label,
    active: row.active === true,
    verificationState: row.verification_state || 'unverified',
    lastSuccessAt: row.last_success_at || null,
    lastFailureAt: row.last_failure_at || null,
    lastError: row.last_error || null,
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at || null,
    updatedByEmail: row.updated_by_email || null,
  };
}

function serializePurpose(row) {
  const purposeRelation = row.email_sender_purposes || row.purpose || {};
  const mailboxRelation = row.email_sender_mailboxes || row.mailbox || null;
  const purpose = Array.isArray(purposeRelation) ? purposeRelation[0] || {} : purposeRelation;
  const mailbox = Array.isArray(mailboxRelation) ? mailboxRelation[0] || null : mailboxRelation;
  return {
    key: row.purpose_key,
    label: purpose.label || row.purpose_key,
    description: purpose.description || '',
    moduleId: purpose.module_id || null,
    enabled: purpose.enabled !== false,
    sortOrder: Number(purpose.sort_order || 100),
    mailbox: serializeMailbox(mailbox),
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at || null,
    updatedByEmail: row.updated_by_email || null,
  };
}

export async function listGraphEmailRegistry(client, env = process.env) {
  const [mailboxesResult, routesResult] = await Promise.all([
    client
      .from('email_sender_mailboxes')
      .select('*')
      .order('label', { ascending: true })
      .order('email_address', { ascending: true }),
    client
      .from('email_sender_routes')
      .select('purpose_key,mailbox_id,revision,updated_at,updated_by_email,email_sender_purposes(label,description,module_id,enabled,sort_order),email_sender_mailboxes(*)'),
  ]);
  if (mailboxesResult.error) throw mailboxesResult.error;
  if (routesResult.error) throw routesResult.error;
  const config = graphEmailApplicationConfig(env);
  const purposes = (routesResult.data || []).map(serializePurpose).sort((left, right) => left.sortOrder - right.sortOrder);
  return {
    provider: 'Microsoft Graph',
    authentication: 'Vercel OIDC',
    applicationConfigured: config.configured,
    deliveryGateEnabled: config.deliveryGateEnabled,
    mailboxes: (mailboxesResult.data || []).map(serializeMailbox),
    purposes,
    ready: config.configured && config.deliveryGateEnabled && purposes.filter((purpose) => purpose.enabled).every((purpose) => purpose.mailbox?.active),
    notes: [
      'Microsoft 365 controls the sender display name for each mailbox.',
      'Mailbox-scoped Mail.Send authorization is confirmed by successful delivery, not by the token-only health check.',
      'General Manager authority and sender mailbox assignments are independent.',
    ],
  };
}

export async function saveGraphEmailMailbox(client, profile, body = {}) {
  const { data, error } = await client.rpc('save_email_sender_mailbox', {
    p_mailbox_id: body.mailboxId || null,
    p_email_address: body.emailAddress,
    p_label: body.label,
    p_active: body.active !== false,
    p_reason: body.reason,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: body.expectedRevision ?? null,
  });
  if (error) {
    const status = /changed after it was opened/i.test(error.message) ? 409 : /Only an active/i.test(error.message) ? 403 : 400;
    throw graphEmailError(error.message, status, status === 409 ? 'REVISION_CONFLICT' : 'EMAIL_MAILBOX_SAVE_FAILED');
  }
  return serializeMailbox(data);
}

export async function saveGraphEmailRoute(client, profile, body = {}) {
  const purposeKey = assertPurposeKey(body.purposeKey);
  const { data, error } = await client.rpc('save_email_sender_route', {
    p_purpose_key: purposeKey,
    p_mailbox_id: body.mailboxId || null,
    p_reason: body.reason,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: body.expectedRevision,
  });
  if (error) {
    const status = /changed after it was opened/i.test(error.message) ? 409 : /Only an active/i.test(error.message) ? 403 : 400;
    throw graphEmailError(error.message, status, status === 409 ? 'REVISION_CONFLICT' : 'EMAIL_ROUTE_SAVE_FAILED');
  }
  return { purposeKey: data.purpose_key, mailboxId: data.mailbox_id, revision: Number(data.revision), updatedAt: data.updated_at };
}

async function ensureBootstrapMailbox(client, profile, email, label) {
  if (!email) return null;
  const { data: existing, error } = await client
    .from('email_sender_mailboxes')
    .select('*')
    .eq('email_address', email)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const mailbox = await saveGraphEmailMailbox(client, profile, {
    emailAddress: email,
    label,
    active: true,
    reason: 'Bootstrap existing production Microsoft Graph sender.',
  });
  return {
    id: mailbox.id,
    email_address: mailbox.emailAddress,
    active: mailbox.active,
  };
}

export async function bootstrapGraphEmailRegistry(client, profile, env = process.env) {
  const operationalEmail = normalizedEmail(env.FCOS_GRAPH_BOOTSTRAP_OPERATIONAL_MAILBOX);
  const updatesEmail = normalizedEmail(env.FCOS_GRAPH_BOOTSTRAP_UPDATES_MAILBOX);
  const hedgeEmail = normalizedEmail(env.FCOS_GRAPH_BOOTSTRAP_HEDGE_MAILBOX);
  if (!operationalEmail && !updatesEmail && !hedgeEmail) {
    throw graphEmailError('No existing Microsoft Graph mailbox configuration was found to bootstrap.', 400, 'EMAIL_BOOTSTRAP_EMPTY');
  }
  const operational = await ensureBootstrapMailbox(client, profile, operationalEmail, 'Operational email sender');
  const updates = await ensureBootstrapMailbox(client, profile, updatesEmail, 'FCOS Updates sender');
  const hedge = await ensureBootstrapMailbox(client, profile, hedgeEmail, 'Hedge Desk sender');
  const { data: routes, error } = await client.from('email_sender_routes').select('purpose_key,mailbox_id,revision');
  if (error) throw error;
  for (const route of routes || []) {
    if (route.mailbox_id) continue;
    const mailboxId = route.purpose_key === 'fcos_updates'
      ? updates?.id
      : route.purpose_key.startsWith('hedge_')
        ? hedge?.id
        : operational?.id;
    if (!mailboxId) continue;
    await saveGraphEmailRoute(client, profile, {
      purposeKey: route.purpose_key,
      mailboxId,
      expectedRevision: route.revision,
      reason: 'Bootstrap existing production Microsoft Graph sender route.',
    });
  }
  return listGraphEmailRegistry(client, env);
}

export async function resolveGraphEmailSender(client, purposeKeyValue, { mailboxSnapshot = null, env = process.env } = {}) {
  const purposeKey = assertPurposeKey(purposeKeyValue);
  const config = graphEmailApplicationConfig(env);
  if (!config.configured) {
    throw graphEmailError('Microsoft Graph email application configuration is incomplete.', 503, 'GRAPH_EMAIL_CONFIG_MISSING');
  }
  if (!config.deliveryGateEnabled) {
    throw graphEmailError('External email delivery is disabled by the FCOS safety gate.', 503, 'EMAIL_DELIVERY_DISABLED');
  }
  let mailbox;
  if (mailboxSnapshot) {
    const emailAddress = normalizedEmail(mailboxSnapshot.emailAddress || mailboxSnapshot);
    if (!emailAddress) throw graphEmailError('The saved sender mailbox snapshot is invalid.', 409, 'EMAIL_SENDER_SNAPSHOT_INVALID');
    mailbox = { id: mailboxSnapshot.id || null, email_address: emailAddress, active: true };
  } else {
    const { data, error } = await client
      .from('email_sender_routes')
      .select('purpose_key,email_sender_purposes(enabled),email_sender_mailboxes(*)')
      .eq('purpose_key', purposeKey)
      .maybeSingle();
    if (error) throw error;
    const purpose = Array.isArray(data?.email_sender_purposes)
      ? data.email_sender_purposes[0]
      : data?.email_sender_purposes;
    if (!purpose?.enabled) {
      throw graphEmailError('This email purpose is disabled.', 503, 'EMAIL_PURPOSE_DISABLED');
    }
    mailbox = Array.isArray(data?.email_sender_mailboxes)
      ? data.email_sender_mailboxes[0]
      : data?.email_sender_mailboxes;
    if (!mailbox?.active) {
      throw graphEmailError('No active Microsoft Graph mailbox is assigned to this email purpose.', 503, 'EMAIL_SENDER_NOT_ASSIGNED');
    }
  }
  return {
    purposeKey,
    mailboxId: mailbox.id || null,
    emailAddress: mailbox.email_address,
    graph: {
      tenantId: config.tenantId,
      clientId: config.clientId,
      mailbox: mailbox.email_address,
    },
  };
}

function transportCacheKey(sender) {
  return [sender.graph.tenantId, sender.graph.clientId, sender.graph.mailbox].join('|');
}

function cachedTransportUsable(transport) {
  const expiresAt = Date.parse(String(transport?.accessTokenExpiresAt || ''));
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + (5 * 60 * 1000);
}

async function graphTransport(sender, dependencies = {}) {
  if (dependencies.transport) return dependencies.transport;
  const key = transportCacheKey(sender);
  const cached = transportCache.get(key);
  if (cachedTransportUsable(cached)) return cached;
  const next = await createMicrosoftGraphMailTransport(sender.graph, dependencies);
  transportCache.set(key, next);
  return next;
}

async function recordDelivery(client, sender, succeeded, error = null) {
  if (!sender.mailboxId) return;
  await client.rpc('record_email_sender_delivery', {
    p_purpose_key: sender.purposeKey,
    p_mailbox_id: sender.mailboxId,
    p_succeeded: succeeded,
    p_error: error ? String(error.code || 'MICROSOFT_GRAPH_MAIL_ERROR') : null,
  }).catch(() => {});
}

export async function sendGraphPurposeMail({ client, purposeKey, message, mailboxSnapshot = null }, dependencies = {}) {
  if (!client) throw graphEmailError('Email delivery requires a server database client.', 500, 'EMAIL_DATABASE_CLIENT_MISSING');
  const sender = await resolveGraphEmailSender(client, purposeKey, {
    mailboxSnapshot,
    env: dependencies.env || process.env,
  });
  try {
    const transport = await graphTransport(sender, dependencies);
    const result = await transport.sendMail({
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments,
    });
    await recordDelivery(client, sender, true);
    return {
      ...result,
      deliveryMethod: 'microsoft_graph_oidc',
      senderMailboxId: sender.mailboxId,
      senderAddress: sender.emailAddress,
      senderSnapshot: { id: sender.mailboxId, emailAddress: sender.emailAddress },
    };
  } catch (error) {
    await recordDelivery(client, sender, false, error);
    throw error;
  }
}

export async function verifyGraphEmailApplication(env = process.env, dependencies = {}) {
  const config = graphEmailApplicationConfig(env);
  if (!config.configured) {
    throw graphEmailError('Microsoft Graph email application configuration is incomplete.', 503, 'GRAPH_EMAIL_CONFIG_MISSING');
  }
  return verifyMicrosoftGraphMailAuthentication({
    tenantId: config.tenantId,
    clientId: config.clientId,
    mailbox: dependencies.mailbox || 'configuration-probe@invalid.local',
  }, dependencies);
}

export function graphEmailPurposeKeys() {
  return [...PURPOSE_KEYS];
}
