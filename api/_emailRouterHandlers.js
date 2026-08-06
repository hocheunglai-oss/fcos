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

async function context(req, dependencies) {
  const auth = await requireEmailRouterUser(req, dependencies);
  return { ...auth, mailbox: await currentEmailRouterMailbox(auth.client) };
}

export async function emailRouterDirectoryRefreshHandler(req, _body = {}, dependencies = {}) {
  const value = await requireEmailRouterConfigurationUser(req, dependencies);
  const { error } = await value.client.rpc('sync_emailrouter_fcos_destinations', { p_actor: value.profile.id });
  if (error) throw Object.assign(new Error('FCOS users could not be synchronized into the routing directory.'), { status: 503, code: 'EMAIL_ROUTER_DIRECTORY_SYNC_UNAVAILABLE' });
  return emailRouterConfiguration(value.client);
}

export async function emailRouterListHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  return listEmailRouterMessages({ client: value.client, mailbox: value.mailbox, folder: body.folder, limit: body.limit, search: body.query, cursor: body.cursor }, dependencies);
}

export async function emailRouterBackgroundSyncHandler(req, _body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  return syncEmailRouterMailboxIfDue({
    client: value.client,
    mailbox: value.mailbox,
    folders: ['inbox', 'sentitems', 'archive'],
    minimumIntervalMs: 28_000,
    maxPages: 4,
  }, dependencies);
}

export async function emailRouterDetailHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  return fetchEmailRouterDetail({ client: value.client, mailbox: value.mailbox, messageId: body.messageId }, dependencies);
}

export async function emailRouterDirectoryHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  const [directory, presets] = await Promise.all([
    listEmailRouterDirectory({ client: value.client, search: body.search }),
    listEmailRouterPresets(value.client, { profileId: value.profile.id, env: dependencies.env || process.env }),
  ]);
  return { directory, presets };
}

export async function emailRouterPresetsHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
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
  const token = createEmailRouterAttachmentToken({ mailboxId: value.mailbox.id, messageId: body.messageId, attachmentId: body.attachmentId }, dependencies.env || process.env);
  const path = String(dependencies.attachmentStreamPath || '/api/functions/emailRouterAttachmentStream');
  return { token, url: `${path}?token=${encodeURIComponent(token)}`, expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

export async function emailRouterAttachmentStreamHandler(req, body = {}, dependencies = {}) {
  const queryToken = (() => {
    try { return new URL(req?.url || '', 'http://localhost').searchParams.get('token'); } catch { return null; }
  })();
  const token = verifyEmailRouterAttachmentToken(body.token || queryToken, dependencies.env || process.env);
  const auth = await requireEmailRouterUser(req, dependencies);
  const mailbox = await currentEmailRouterMailbox(auth.client);
  if (token.mailboxId !== mailbox.id) throw Object.assign(new Error('Attachment link is unavailable.'), { status: 403, code: 'EMAIL_ROUTER_ATTACHMENT_FORBIDDEN' });
  return streamEmailRouterAttachment({ mailbox, messageId: token.messageId, attachmentId: token.attachmentId }, dependencies);
}

export async function emailRouterActionHandler(req, body = {}, dependencies = {}) {
  const value = await context(req, dependencies);
  const result = await startEmailRouterAction({ client: value.client, profile: value.profile, mailbox: value.mailbox, actionType: body.actionType || body.action, sourceMessageId: body.messageId, input: body }, dependencies);
  if (result.status !== 'draft_created') return result;
  await processEmailRouterOutbox({ client: value.client, mailbox: value.mailbox, limit: 1, actionId: result.id, confirmNewSubmissions: false }, dependencies);
  return getEmailRouterActionStatus(value.client, result.id);
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
  await processEmailRouterOutbox({ client: value.client, mailbox: value.mailbox, limit: 1, actionId: result.id, confirmNewSubmissions: false }, dependencies);
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
  const value = await context(req, dependencies);
  return runEmailRouterAdvisor({ client: value.client, profile: value.profile, mailbox: value.mailbox, messageId: body.messageId }, dependencies);
}

export async function emailRouterWebhookHandler(req, payload = {}, dependencies = {}) {
  const client = createEmailRouterServiceClient(dependencies.env || process.env, dependencies);
  const notifications = validEmailRouterWebhookNotifications(payload, (dependencies.env || process.env).FCOS_EMAIL_ROUTER_WEBHOOK_CLIENT_STATE);
  return enqueueEmailRouterWebhookNotifications(client, notifications, dependencies);
}
