import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEmailRouterPostAction } from '../api/_emailRouterFolders.js';

const mailbox = { id: '9eb2235c-62a0-47d0-86ac-b8485a84632b' };
const folderId = '809963c3-3a6c-4f8c-a06d-c7ba739afc62';

function folderClient(row) {
  const query = {
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { schema: () => ({ from: () => query }) };
}

test('Redirect and Forward use distinct post-action defaults', async () => {
  assert.deepEqual(await resolveEmailRouterPostAction({}, mailbox, 'redirect', {}), {
    mode: 'move',
    state: 'pending',
    folderId: null,
    providerFolderId: 'archive',
    folderPath: 'Archive',
  });
  assert.deepEqual(await resolveEmailRouterPostAction({}, mailbox, 'forward', {}), {
    mode: 'keep_current',
    state: 'not_required',
    folderId: null,
    providerFolderId: null,
    folderPath: null,
  });
});

test('custom post-action folders resolve only through approved server records', async () => {
  const resolved = await resolveEmailRouterPostAction(folderClient({
    id: folderId,
    provider_folder_id: 'graph-folder-id',
    folder_path: 'Reports / Market Report',
  }), mailbox, 'forward', { postActionMode: 'move', postActionFolderId: folderId });
  assert.deepEqual(resolved, {
    mode: 'move',
    state: 'pending',
    folderId,
    providerFolderId: 'graph-folder-id',
    folderPath: 'Reports / Market Report',
  });

  await assert.rejects(
    resolveEmailRouterPostAction(folderClient(null), mailbox, 'forward', { postActionMode: 'move', postActionFolderId: folderId }),
    (error) => error.code === 'EMAIL_ROUTER_FOLDER_STALE' && error.status === 409,
  );
});

test('arbitrary folder identifiers and contradictory choices fail closed', async () => {
  await assert.rejects(
    resolveEmailRouterPostAction({}, mailbox, 'forward', { postActionMode: 'move', postActionFolderId: 'graph-folder-id' }),
    (error) => error.code === 'EMAIL_ROUTER_FOLDER_INVALID',
  );
  await assert.rejects(
    resolveEmailRouterPostAction({}, mailbox, 'forward', { postActionMode: 'keep_current', postActionFolderKey: 'archive' }),
    (error) => error.code === 'EMAIL_ROUTER_FOLDER_INVALID',
  );
});
