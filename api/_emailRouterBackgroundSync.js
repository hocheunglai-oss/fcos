import {
  currentEmailRouterMailbox,
  requireEmailRouterUser,
  syncEmailRouterMailboxIfDue,
} from './_emailRouterCore.js';

/**
 * Keep the high-frequency foreground check isolated from the larger Email
 * Router handler graph. In particular, attachment PDF extraction must not be
 * bundled into a request that only reconciles the visible inbox.
 */
export async function emailRouterBackgroundSyncHandler(req, _body = {}, dependencies = {}) {
  const auth = await requireEmailRouterUser(req, dependencies);
  const mailbox = await currentEmailRouterMailbox(auth.client, { allowCached: true });
  return syncEmailRouterMailboxIfDue({
    client: auth.client,
    mailbox,
    folders: ['inbox'],
    minimumIntervalMs: 28_000,
    maxPages: 1,
  }, dependencies);
}
