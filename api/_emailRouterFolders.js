import { emailRouterGraphFetch, emailRouterGraphJson, emailRouterMailboxPath } from './_emailRouterCore.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WELL_KNOWN_BLOCKED = ['inbox', 'sentitems', 'drafts', 'outbox', 'deleteditems', 'junkemail'];
const FOLDER_PAGE_LIMIT = 10;
const FOLDER_DEPTH_LIMIT = 8;
const FOLDER_TOTAL_LIMIT = 1000;

function table(client, name) {
  return client.schema('emailrouter').from(name);
}

function folderError(message, status = 400, code = 'EMAIL_ROUTER_FOLDER_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function safeProviderId(value, label = 'folder identifier') {
  const result = String(value || '').trim().slice(0, 512);
  if (!result || /[\r\n\0]/.test(result)) throw folderError(`Invalid ${label}.`);
  return result;
}

async function graphFolder(mailbox, folder, dependencies) {
  const response = await emailRouterGraphFetch(
    emailRouterMailboxPath(mailbox, `/mailFolders/${folder}?$select=id,displayName,parentFolderId,childFolderCount`),
    {},
    dependencies,
  );
  return emailRouterGraphJson(response);
}

async function blockedFolderIds(mailbox, dependencies) {
  const results = await Promise.all(WELL_KNOWN_BLOCKED.map((folder) => graphFolder(mailbox, folder, dependencies).catch(() => null)));
  return new Set(results.map((folder) => folder?.id).filter(Boolean));
}

export async function discoverEmailRouterFolders({ client, mailbox, actorUserId = null }, dependencies = {}) {
  const [blockedIds, archive] = await Promise.all([
    blockedFolderIds(mailbox, dependencies),
    graphFolder(mailbox, 'archive', dependencies),
  ]);
  const parameters = new URLSearchParams({
    '$select': 'id,displayName,parentFolderId,childFolderCount',
    '$top': '100',
    includeHiddenFolders: 'true',
  });
  const queue = [{ path: emailRouterMailboxPath(mailbox, `/mailFolders?${parameters}`), parentPath: '', depth: 0 }];
  const discovered = [];

  while (queue.length && discovered.length < FOLDER_TOTAL_LIMIT) {
    const current = queue.shift();
    let nextPath = current.path;
    for (let page = 0; nextPath && page < FOLDER_PAGE_LIMIT && discovered.length < FOLDER_TOTAL_LIMIT; page += 1) {
      const response = await emailRouterGraphFetch(nextPath, {}, dependencies);
      const payload = await emailRouterGraphJson(response) || {};
      for (const folder of Array.isArray(payload.value) ? payload.value : []) {
        const providerFolderId = safeProviderId(folder?.id);
        const displayName = String(folder?.displayName || '').trim().slice(0, 255);
        if (!displayName) continue;
        const folderPath = `${current.parentPath}${current.parentPath ? ' / ' : ''}${displayName}`.slice(0, 1000);
        const isArchive = providerFolderId === archive?.id;
        if (!blockedIds.has(providerFolderId) || isArchive) {
          discovered.push({
            mailbox_id: mailbox.id,
            provider_folder_id: providerFolderId,
            parent_provider_folder_id: folder?.parentFolderId || null,
            display_name: displayName,
            folder_path: folderPath,
            active: true,
            is_system: isArchive,
            last_seen_at: new Date().toISOString(),
            updated_by: actorUserId,
            updated_at: new Date().toISOString(),
          });
        }
        if (Number(folder?.childFolderCount || 0) > 0 && current.depth < FOLDER_DEPTH_LIMIT) {
          queue.push({
            path: emailRouterMailboxPath(mailbox, `/mailFolders/${encodeURIComponent(providerFolderId)}/childFolders?${parameters}`),
            parentPath: folderPath,
            depth: current.depth + 1,
          });
        }
      }
      nextPath = payload['@odata.nextLink'] || null;
    }
  }
  if (queue.length || discovered.length >= FOLDER_TOTAL_LIMIT) {
    throw folderError('The Microsoft 365 folder list is too large to validate safely.', 409, 'EMAIL_ROUTER_FOLDER_LIMIT');
  }

  const unique = [...new Map(discovered.map((folder) => [folder.provider_folder_id, folder])).values()];
  if (unique.length) {
    const { error } = await table(client, 'routing_folders').upsert(unique, { onConflict: 'mailbox_id,provider_folder_id' });
    if (error) throw folderError('Approved folder storage is unavailable.', 503, 'EMAIL_ROUTER_FOLDER_STORAGE_UNAVAILABLE');
  }
  const { data: currentRows, error: currentError } = await table(client, 'routing_folders')
    .select('id,provider_folder_id')
    .eq('mailbox_id', mailbox.id);
  if (currentError) throw folderError('Approved folder storage is unavailable.', 503, 'EMAIL_ROUTER_FOLDER_STORAGE_UNAVAILABLE');
  const foundIds = new Set(unique.map((folder) => folder.provider_folder_id));
  const staleIds = (currentRows || []).filter((row) => !foundIds.has(row.provider_folder_id)).map((row) => row.id);
  if (staleIds.length) {
    const { error } = await table(client, 'routing_folders').update({ active: false, updated_at: new Date().toISOString() }).in('id', staleIds);
    if (error) throw folderError('Approved folder storage is unavailable.', 503, 'EMAIL_ROUTER_FOLDER_STORAGE_UNAVAILABLE');
  }
  if (archive?.id) {
    const { error } = await table(client, 'routing_folders')
      .update({ approved: true, active: true, is_system: true, sort_order: 0, updated_at: new Date().toISOString() })
      .eq('mailbox_id', mailbox.id)
      .eq('provider_folder_id', archive.id);
    if (error) throw folderError('Archive folder approval could not be confirmed.', 503, 'EMAIL_ROUTER_FOLDER_STORAGE_UNAVAILABLE');
  }
  const marketReportMatches = unique.filter((folder) => folder.display_name.trim().toLowerCase() === 'market report');
  if (marketReportMatches.length === 1) {
    const { error } = await table(client, 'routing_folders')
      .update({ approved: true, updated_by: actorUserId, updated_at: new Date().toISOString() })
      .eq('mailbox_id', mailbox.id)
      .eq('provider_folder_id', marketReportMatches[0].provider_folder_id)
      .eq('revision', 1)
      .eq('approved', false);
    if (error) throw folderError('The Market Report folder could not be seeded.', 503, 'EMAIL_ROUTER_FOLDER_STORAGE_UNAVAILABLE');
  }
  return listEmailRouterRoutingFolders(client, mailbox.id, { includeUnapproved: true });
}

export async function listEmailRouterRoutingFolders(client, mailboxId, { includeUnapproved = false } = {}) {
  let query = table(client, 'routing_folders')
    .select('id,display_name,folder_path,approved,active,is_system,sort_order,revision,last_seen_at,updated_at')
    .eq('mailbox_id', mailboxId)
    .order('sort_order')
    .order('folder_path');
  if (!includeUnapproved) query = query.eq('approved', true).eq('active', true);
  const { data, error } = await query;
  if (error) throw folderError('Approved folders are unavailable.', 503, 'EMAIL_ROUTER_FOLDER_STORAGE_UNAVAILABLE');
  return (data || []).map((row) => ({
    id: row.id,
    label: row.display_name,
    path: row.folder_path,
    approved: row.approved,
    active: row.active,
    system: row.is_system,
    sortOrder: Number(row.sort_order || 0),
    revision: Number(row.revision || 0),
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
  }));
}

export async function saveEmailRouterRoutingFolders(client, profile, items) {
  if (!Array.isArray(items) || !items.length || items.length > 250) throw folderError('Select at least one folder to save.');
  const normalized = items.map((item, index) => {
    if (!UUID.test(String(item?.id || ''))) throw folderError('A routing folder selection is invalid.');
    const expectedRevision = Number(item?.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw folderError('Refresh the routing folders before saving.');
    return { id: item.id, approved: item.approved === true, sortOrder: index, expectedRevision };
  });
  const { data, error } = await client.rpc('save_emailrouter_routing_folders', { p_items: normalized, p_actor: profile.id });
  if (error) {
    const stale = /revision conflict/i.test(error.message || '');
    throw folderError(stale ? 'The routing folders changed after they were loaded. Refresh and try again.' : 'Routing folders could not be saved.', stale ? 409 : 400, stale ? 'EMAIL_ROUTER_REVISION_CONFLICT' : 'EMAIL_ROUTER_FOLDER_SAVE_FAILED');
  }
  return data;
}

export async function resolveEmailRouterPostAction(client, mailbox, actionType, input = {}) {
  const defaultMode = actionType === 'redirect' ? 'move' : 'keep_current';
  const mode = String(input.postActionMode || defaultMode).trim().toLowerCase();
  if (!['keep_current', 'move'].includes(mode)) throw folderError('Select what should happen to the source message after sending.');
  if (mode === 'keep_current') {
    if (input.postActionFolderId || input.postActionFolderKey) throw folderError('A folder cannot be selected while leaving the source message in place.');
    return { mode, state: 'not_required', folderId: null, providerFolderId: null, folderPath: null };
  }
  if ((input.postActionFolderKey === 'archive' || (actionType === 'redirect' && !input.postActionFolderKey && !input.postActionFolderId)) && !input.postActionFolderId) {
    return { mode, state: 'pending', folderId: null, providerFolderId: 'archive', folderPath: 'Archive' };
  }
  if (!UUID.test(String(input.postActionFolderId || ''))) throw folderError('Select an approved destination folder.');
  const { data, error } = await table(client, 'routing_folders')
    .select('id,provider_folder_id,folder_path')
    .eq('id', input.postActionFolderId)
    .eq('mailbox_id', mailbox.id)
    .eq('approved', true)
    .eq('active', true)
    .maybeSingle();
  if (error) throw folderError('Approved folders are unavailable.', 503, 'EMAIL_ROUTER_FOLDER_STORAGE_UNAVAILABLE');
  if (!data) throw folderError('The selected destination folder is no longer approved.', 409, 'EMAIL_ROUTER_FOLDER_STALE');
  return { mode, state: 'pending', folderId: data.id, providerFolderId: data.provider_folder_id, folderPath: data.folder_path };
}
