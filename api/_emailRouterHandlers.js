import {
  EMAIL_ROUTER_STORAGE,
  createEmailRouterAttachmentToken,
  createEmailRouterServiceClient,
  currentEmailRouterMailbox,
  createEmailRouterSubscription,
  enqueueEmailRouterWebhookNotifications,
  fetchEmailRouterDetail,
  getEmailRouterActionStatus,
  listEmailRouterDirectory,
  listEmailRouterMessages,
  listEmailRouterPresets,
  listEmailRouterRoutingLeaves,
  processEmailRouterOutbox,
  requireEmailRouterConfigurationUser,
  requireEmailRouterUser,
  retryEmailRouterUncertainAction,
  retryEmailRouterSourceFiling,
  saveEmailRouterRoutingLeave,
  startEmailRouterAction,
  streamEmailRouterAttachment,
  syncEmailRouterDelta,
  syncEmailRouterMailboxIfDue,
  validEmailRouterWebhookNotifications,
  verifyEmailRouterAttachmentToken,
} from './_emailRouterCore.js';
import { emailRouterConfiguration, saveEmailRouterConfiguration } from './_emailRouterConfig.js';
import { runEmailRouterAdvisor } from './_emailRouterAdvisor.js';
import { discoverEmailRouterFolders, listEmailRouterRoutingFolders } from './_emailRouterFolders.js';
import { recordEmailRouterOperation } from './_requestTelemetry.js';
import { waitUntil } from '@vercel/functions';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

function runtimeEmailRouterDependencies(dependencies) {
  return typeof dependencies.defer === 'function' ? dependencies : { ...dependencies, defer: waitUntil };
}

async function context(req, dependencies, { allowCachedMailbox = false } = {}) {
  const auth = await requireEmailRouterUser(req, dependencies);
  return { ...auth, mailbox: await currentEmailRouterMailbox(auth.client, { allowCached: allowCachedMailbox }) };
}

function continueEmailRouterWork(promise, dependencies, label) {
  const guarded = promise.catch((error) => {
    console.warn(`[email-router] ${label} will be retried by the durable outbox.`, {
      code: error?.code || 'EMAIL_ROUTER_BACKGROUND_WORK_FAILED',
    });
  });
  if (typeof dependencies.defer === 'function') {
    dependencies.defer(guarded);
    return true;
  }
  return false;
}

export async function emailRouterDirectoryRefreshHandler(req, _body = {}, dependencies = {}) {
  const value = await requireEmailRouterConfigurationUser(req, dependencies);
  const { error } = await value.client.rpc('sync_emailrouter_fcos_destinations', { p_actor: value.profile.id });
  if (error) throw Object.assign(new Error('FCOS users could not be synchronized into the routing directory.'), { status: 503, code: 'EMAIL_ROUTER_DIRECTORY_SYNC_UNAVAILABLE' });
  return emailRouterConfiguration(value.client);
}

export async function emailRouterListHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies, { allowCachedMailbox: true });
  return listEmailRouterMessages({ client: value.client, mailbox: value.mailbox, folder: body.folder, limit: body.limit, search: body.query, cursor: body.cursor }, dependencies);
}

export async function emailRouterBackgroundSyncHandler(req, _body = {}, dependencies = {}) {
  const value = await context(req, dependencies, { allowCachedMailbox: true });
  return syncEmailRouterMailboxIfDue({
    client: value.client,
    mailbox: value.mailbox,
    // Foreground checks only catch up the visible inbox. Subscription renewal,
    // Sent/Archive reconciliation, outbox work, directory sync, and learning
    // remain in webhook/cron maintenance so a browser poll cannot fan out.
    folders: ['inbox'],
    minimumIntervalMs: 28_000,
    maxPages: 1,
  }, dependencies);
}

export async function emailRouterHealthHandler(req, _body = {}, dependencies = {}) {
  const value = await context(req, dependencies, { allowCachedMailbox: true });
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const table = (name) => value.client.schema('emailrouter').from(name);
  const [mailbox, subscriptions, alerts, actions, delta] = await Promise.all([
    table(EMAIL_ROUTER_STORAGE.mailboxes).select('last_synced_at,updated_at').eq('id', value.mailbox.id).maybeSingle(),
    table(EMAIL_ROUTER_STORAGE.subscriptions).select('resource_key,state,expires_at,lifecycle_event,updated_at').eq('mailbox_id', value.mailbox.id),
    table(EMAIL_ROUTER_STORAGE.alerts).select('severity,state,alert_code,created_at').eq('mailbox_id', value.mailbox.id).in('state', ['open', 'acknowledged']).limit(100),
    table(EMAIL_ROUTER_STORAGE.actions).select('state,action_type,created_at,messages!mail_actions_message_id_fkey!inner(mailbox_id)').eq('messages.mailbox_id', value.mailbox.id).gte('created_at', since).limit(2_000),
    table(EMAIL_ROUTER_STORAGE.deltaState).select('folder_key,sync_state,failure_code,updated_at').eq('mailbox_id', value.mailbox.id),
  ]);
  const failed = [mailbox, subscriptions, alerts, actions, delta].find((result) => result.error);
  if (failed?.error) throw Object.assign(new Error('Email Router operational status is unavailable.'), { status: 503, code: 'EMAIL_ROUTER_HEALTH_UNAVAILABLE' });
  const actionCounts = {};
  for (const row of actions.data || []) actionCounts[row.state] = (actionCounts[row.state] || 0) + 1;
  const alertCounts = {};
  for (const row of alerts.data || []) alertCounts[row.severity] = (alertCounts[row.severity] || 0) + 1;
  const now = Date.now();
  return {
    mailbox: { lastSyncedAt: mailbox.data?.last_synced_at || null, updatedAt: mailbox.data?.updated_at || null },
    subscriptions: {
      total: subscriptions.data?.length || 0,
      ready: (subscriptions.data || []).filter((row) => row.state === 'active' && new Date(row.expires_at || 0).getTime() > now).length,
      expiringWithin24Hours: (subscriptions.data || []).filter((row) => {
        const expires = new Date(row.expires_at || 0).getTime();
        return expires > now && expires - now <= 24 * 60 * 60_000;
      }).length,
    },
    alerts: { total: alerts.data?.length || 0, counts: alertCounts },
    actions: { periodHours: 24, total: actions.data?.length || 0, counts: actionCounts },
    folders: (delta.data || []).map((row) => ({ folder: row.folder_key, state: row.sync_state, failed: Boolean(row.failure_code), updatedAt: row.updated_at })),
    redacted: true,
    generatedAt: new Date().toISOString(),
  };
}

async function attachmentBuffer(attachment, maximumBytes = 12 * 1024 * 1024) {
  const declared = Number(attachment.contentLength || 0);
  if (declared > maximumBytes) throw Object.assign(new Error('This PDF is too large for temporary text extraction.'), { status: 413, code: 'EMAIL_ROUTER_ATTACHMENT_TEXT_TOO_LARGE' });
  const reader = attachment.body?.getReader?.();
  if (!reader) throw Object.assign(new Error('Attachment content is unavailable.'), { status: 503, code: 'EMAIL_ROUTER_ATTACHMENT_BODY_UNAVAILABLE' });
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => null);
      throw Object.assign(new Error('This PDF is too large for temporary text extraction.'), { status: 413, code: 'EMAIL_ROUTER_ATTACHMENT_TEXT_TOO_LARGE' });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export async function emailRouterAttachmentTextHandler(req, body = {}, dependencies = {}) {
  const startedAt = Date.now();
  const value = await context(req, dependencies);
  const attachment = await streamEmailRouterAttachment({ mailbox: value.mailbox, messageId: body.messageId, attachmentId: body.attachmentId }, dependencies);
  if (!/^application\/pdf(?:;|$)/i.test(String(attachment.contentType || ''))) {
    throw Object.assign(new Error('Temporary text extraction is available only for PDF attachments.'), { status: 400, code: 'EMAIL_ROUTER_ATTACHMENT_TEXT_PDF_ONLY' });
  }
  const parsed = await pdfParse(await attachmentBuffer(attachment));
  const extracted = String(parsed?.text || '').replace(/\u0000/g, '').trim();
  recordEmailRouterOperation({ operation: 'attachment_text_extract', totalMs: Date.now() - startedAt });
  return {
    text: extracted.slice(0, 250_000),
    truncated: extracted.length > 250_000,
    pages: Math.max(0, Number(parsed?.numpages) || 0),
    redactedAudit: true,
  };
}

export async function emailRouterDetailHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies, { allowCachedMailbox: true });
  const runtimeDependencies = runtimeEmailRouterDependencies(dependencies);
  const detail = await fetchEmailRouterDetail({
    client: value.client,
    mailbox: value.mailbox,
    messageId: body.messageId,
    hasAttachmentsHint: body.hasAttachments === true,
  }, runtimeDependencies);
  const expiresAtMs = Date.now() + 5 * 60_000;
  const streamPath = String(dependencies.attachmentStreamPath || '/api/email-router-attachment');
  const attachments = (detail.attachments || []).map((attachment) => {
    if (!attachment?.id) return attachment;
    try {
      const token = createEmailRouterAttachmentToken({
        mailboxId: value.mailbox.id,
        messageId: body.messageId,
        attachmentId: attachment.id,
        expiresAt: expiresAtMs,
      }, dependencies.env || process.env);
      return {
        ...attachment,
        streamUrl: `${streamPath}?token=${encodeURIComponent(token)}`,
        streamExpiresAt: new Date(expiresAtMs).toISOString(),
      };
    } catch {
      return attachment;
    }
  });
  return { ...detail, attachments };
}

export async function emailRouterDirectoryHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies, { allowCachedMailbox: true });
  const [directory, presets, folders] = await Promise.all([
    listEmailRouterDirectory({ client: value.client, search: body.search }),
    listEmailRouterPresets(value.client, { profileId: value.profile.id, env: dependencies.env || process.env }),
    listEmailRouterRoutingFolders(value.client, value.mailbox.id),
  ]);
  return { directory, presets, folders };
}

export async function emailRouterPresetsHandler(req, _body = {}, dependencies = {}) {
  const value = await context(req, dependencies, { allowCachedMailbox: true });
  return { presets: await listEmailRouterPresets(value.client, { profileId: value.profile.id, env: dependencies.env || process.env }) };
}

export async function emailRouterLeaveHandler(req, body = {}, dependencies = {}) {
  const includeAll = body.scope === 'all';
  const value = includeAll
    ? await requireEmailRouterConfigurationUser(req, dependencies)
    : await requireEmailRouterUser(req, dependencies);
  return listEmailRouterRoutingLeaves(value.client, { profile: value.profile, includeAll });
}

export async function emailRouterLeaveSaveHandler(req, body = {}, dependencies = {}) {
  const includeAll = body.scope === 'all';
  const value = includeAll
    ? await requireEmailRouterConfigurationUser(req, dependencies)
    : await requireEmailRouterUser(req, dependencies);
  await saveEmailRouterRoutingLeave(value.client, value.profile, body.operation || body);
  return listEmailRouterRoutingLeaves(value.client, { profile: value.profile, includeAll });
}

export async function emailRouterAttachmentUrlHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  const expiresAtMs = Date.now() + 5 * 60_000;
  const token = createEmailRouterAttachmentToken({ mailboxId: value.mailbox.id, messageId: body.messageId, attachmentId: body.attachmentId, expiresAt: expiresAtMs }, dependencies.env || process.env);
  const path = String(dependencies.attachmentStreamPath || '/api/email-router-attachment');
  return { token, url: `${path}?token=${encodeURIComponent(token)}`, expiresAt: new Date(expiresAtMs).toISOString() };
}

export async function emailRouterAttachmentStreamHandler(req, body = {}, dependencies = {}) {
  const startedAt = Date.now();
  const queryToken = (() => {
    try { return new URL(req?.url || '', 'http://localhost').searchParams.get('token'); } catch { return null; }
  })();
  const token = verifyEmailRouterAttachmentToken(body.token || queryToken, dependencies.env || process.env);
  const auth = await requireEmailRouterUser(req, dependencies);
  const mailbox = await currentEmailRouterMailbox(auth.client);
  if (token.mailboxId !== mailbox.id) throw Object.assign(new Error('Attachment link is unavailable.'), { status: 403, code: 'EMAIL_ROUTER_ATTACHMENT_FORBIDDEN' });
  const attachment = await streamEmailRouterAttachment({ mailbox, messageId: token.messageId, attachmentId: token.attachmentId }, dependencies);
  recordEmailRouterOperation({ operation: 'attachment_open', totalMs: Date.now() - startedAt });
  return attachment;
}

export async function emailRouterActionHandler(req, body = {}, dependencies = {}) {
  const startedAt = Date.now();
  const runtimeDependencies = runtimeEmailRouterDependencies(dependencies);
  const value = await context(req, dependencies);
  const result = await startEmailRouterAction({ client: value.client, profile: value.profile, mailbox: value.mailbox, actionType: body.actionType || body.action, sourceMessageId: body.messageId, input: body }, runtimeDependencies);
  if (result.status !== 'draft_created') {
    const performance = { operation: body.actionType || body.action, totalMs: Date.now() - startedAt };
    recordEmailRouterOperation(performance);
    return { ...result, performance };
  }
  const submission = processEmailRouterOutbox({ client: value.client, mailbox: value.mailbox, limit: 1, actionId: result.id, confirmNewSubmissions: false }, runtimeDependencies);
  if (continueEmailRouterWork(submission, runtimeDependencies, 'Draft submission')) {
    const performance = { operation: body.actionType || body.action, totalMs: Date.now() - startedAt, continuedInBackground: true };
    recordEmailRouterOperation(performance);
    return { ...result, tracking: true, performance };
  }
  await submission;
  const status = await getEmailRouterActionStatus(value.client, result.id, { mailboxId: value.mailbox.id });
  const performance = { operation: body.actionType || body.action, totalMs: Date.now() - startedAt };
  recordEmailRouterOperation(performance);
  return { ...status, performance };
}

export async function emailRouterActionStatusHandler(req, body = {}, dependencies = {}) {
  const runtimeDependencies = runtimeEmailRouterDependencies(dependencies);
  const value = await context(req, dependencies, { allowCachedMailbox: true });
  const current = await getEmailRouterActionStatus(value.client, body.actionId, { mailboxId: value.mailbox.id });
  if (current.tracking) {
    await processEmailRouterOutbox({
      client: value.client,
      mailbox: value.mailbox,
      limit: 1,
      actionId: current.actionId,
      confirmNewSubmissions: true,
    }, runtimeDependencies);
  }
  return getEmailRouterActionStatus(value.client, current.actionId, { mailboxId: value.mailbox.id });
}

export async function emailRouterUndoHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  return startEmailRouterAction({ client: value.client, profile: value.profile, mailbox: value.mailbox, actionType: 'undo', sourceMessageId: body.messageId, input: body }, dependencies);
}

export async function emailRouterRetryHandler(req, body = {}, dependencies = {}) {
  const runtimeDependencies = runtimeEmailRouterDependencies(dependencies);
  const value = await context(req, dependencies);
  const result = await retryEmailRouterUncertainAction({
    client: value.client,
    mailbox: value.mailbox,
    profile: value.profile,
    actionId: body.actionId,
    confirmedNotSent: body.confirmedNotSent,
  }, runtimeDependencies);
  if (result.status !== 'draft_created') return result;
  const submission = processEmailRouterOutbox({ client: value.client, mailbox: value.mailbox, limit: 1, actionId: result.id, confirmNewSubmissions: false }, runtimeDependencies);
  if (continueEmailRouterWork(submission, runtimeDependencies, 'Retry submission')) return { ...result, tracking: true };
  await submission;
  return getEmailRouterActionStatus(value.client, result.id, { mailboxId: value.mailbox.id });
}

export async function emailRouterFilingRetryHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  return retryEmailRouterSourceFiling({
    client: value.client,
    mailbox: value.mailbox,
    profile: value.profile,
    actionId: body.actionId,
  }, dependencies);
}

export async function emailRouterOutboxHandler(req, body = {}, dependencies = {}) {
  const value = await requireEmailRouterConfigurationUser(req, dependencies);
  const mailbox = await currentEmailRouterMailbox(value.client);
  return processEmailRouterOutbox({ client: value.client, mailbox, limit: body.limit }, dependencies);
}

export async function emailRouterDeltaHandler(req, body = {}, dependencies = {}) {
  const value = await requireEmailRouterConfigurationUser(req, dependencies);
  const mailbox = await currentEmailRouterMailbox(value.client);
  return syncEmailRouterDelta({ client: value.client, mailbox, folder: body.folder, maxPages: body.maxPages }, dependencies);
}

export async function emailRouterSubscriptionHandler(req, body = {}, dependencies = {}) {
  const value = await requireEmailRouterConfigurationUser(req, dependencies);
  const mailbox = await currentEmailRouterMailbox(value.client);
  return createEmailRouterSubscription({ client: value.client, mailbox, folder: body.folder, notificationUrl: body.notificationUrl }, dependencies);
}

export async function emailRouterSettingsHandler(req, _body = {}, dependencies = {}) {
  const value = await requireEmailRouterConfigurationUser(req, dependencies);
  return emailRouterConfiguration(value.client);
}

export async function emailRouterSettingsSaveHandler(req, body = {}, dependencies = {}) {
  const value = await requireEmailRouterConfigurationUser(req, dependencies);
  const operation = body.operation || body;
  if (operation.type === 'routing_folders_refresh') {
    const mailbox = await currentEmailRouterMailbox(value.client);
    await discoverEmailRouterFolders({ client: value.client, mailbox, actorUserId: value.profile.id }, dependencies);
  } else {
    await saveEmailRouterConfiguration(value.client, value.profile, operation);
  }
  return emailRouterConfiguration(value.client);
}

export async function emailRouterAdvisorHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies, { allowCachedMailbox: true });
  return runEmailRouterAdvisor({ client: value.client, profile: value.profile, mailbox: value.mailbox, messageId: body.messageId }, dependencies);
}

export async function emailRouterWebhookHandler(req, payload = {}, dependencies = {}) {
  const client = createEmailRouterServiceClient(dependencies.env || process.env, dependencies);
  const notifications = validEmailRouterWebhookNotifications(payload, (dependencies.env || process.env).FCOS_EMAIL_ROUTER_WEBHOOK_CLIENT_STATE);
  return enqueueEmailRouterWebhookNotifications(client, notifications, dependencies);
}
