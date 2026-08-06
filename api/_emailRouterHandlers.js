import {
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
import { recordEmailRouterOperation } from './_requestTelemetry.js';

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
    folders: ['inbox', 'sentitems', 'archive'],
    minimumIntervalMs: 28_000,
    maxPages: 4,
  }, dependencies);
}

export async function emailRouterDetailHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies, { allowCachedMailbox: true });
  const detail = await fetchEmailRouterDetail({
    client: value.client,
    mailbox: value.mailbox,
    messageId: body.messageId,
    hasAttachmentsHint: body.hasAttachments === true,
  }, dependencies);
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
  const [directory, presets] = await Promise.all([
    listEmailRouterDirectory({ client: value.client, search: body.search }),
    listEmailRouterPresets(value.client, { profileId: value.profile.id, env: dependencies.env || process.env }),
  ]);
  return { directory, presets };
}

export async function emailRouterPresetsHandler(req, body = {}, dependencies = {}) {
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
  const value = await context(req, dependencies);
  const result = await startEmailRouterAction({ client: value.client, profile: value.profile, mailbox: value.mailbox, actionType: body.actionType || body.action, sourceMessageId: body.messageId, input: body }, dependencies);
  if (result.status !== 'draft_created') {
    const performance = { operation: body.actionType || body.action, totalMs: Date.now() - startedAt };
    recordEmailRouterOperation(performance);
    return { ...result, performance };
  }
  const submission = processEmailRouterOutbox({ client: value.client, mailbox: value.mailbox, limit: 1, actionId: result.id, confirmNewSubmissions: false }, dependencies);
  if (continueEmailRouterWork(submission, dependencies, 'Draft submission')) {
    const performance = { operation: body.actionType || body.action, totalMs: Date.now() - startedAt, continuedInBackground: true };
    recordEmailRouterOperation(performance);
    return { ...result, performance };
  }
  await submission;
  const status = await getEmailRouterActionStatus(value.client, result.id);
  const performance = { operation: body.actionType || body.action, totalMs: Date.now() - startedAt };
  recordEmailRouterOperation(performance);
  return { ...status, performance };
}

export async function emailRouterUndoHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  return startEmailRouterAction({ client: value.client, profile: value.profile, mailbox: value.mailbox, actionType: 'undo', sourceMessageId: body.messageId, input: body }, dependencies);
}

export async function emailRouterRetryHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  const result = await retryEmailRouterUncertainAction({
    client: value.client,
    mailbox: value.mailbox,
    profile: value.profile,
    actionId: body.actionId,
    confirmedNotSent: body.confirmedNotSent,
  }, dependencies);
  if (result.status !== 'draft_created') return result;
  const submission = processEmailRouterOutbox({ client: value.client, mailbox: value.mailbox, limit: 1, actionId: result.id, confirmNewSubmissions: false }, dependencies);
  if (continueEmailRouterWork(submission, dependencies, 'Retry submission')) return result;
  await submission;
  return getEmailRouterActionStatus(value.client, result.id);
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
  await saveEmailRouterConfiguration(value.client, value.profile, body.operation || body);
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
