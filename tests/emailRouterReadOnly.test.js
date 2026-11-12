import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchEmailRouterDetail } from '../api/_emailRouterCore.js';

import { runWithDeploymentRequestSafety } from '../api/_deploymentReadOnly.js';

const mailbox = { id: 'mailbox-1', emailAddress: 'router@example.test' };
const detailMessage = { id: 'detail-message-1', subject: 'Read-only detail', body: { contentType: 'html', content: '<p>Body</p>' }, hasAttachments: false };

function response(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

function createRouterClient({
  indexed = { id: 'indexed-message-1', provider_message_id: detailMessage.id, folder_key: 'inbox' },
  actionHistory = [],
} = {}) {
  const operations = [];
  const query = (table) => {
    let mutation = null;
    const result = () => {
      if (table === 'messages' && mutation === null) return { data: indexed, error: null };
      if (table === 'mail_actions' && mutation === null) return { data: actionHistory, error: null };
      if (table === 'message_attachment_metadata' && mutation === null) return { data: [], error: null };
      return { data: [], error: null };
    };
    return {
      select() { return this; },
      eq() { return this; },
      in() { return this; },
      order() { return this; },
      limit() { return this; },
      upsert(rows) { mutation = 'upsert'; operations.push({ table, mutation, rows }); return this; },
      update(values) { mutation = 'update'; operations.push({ table, mutation, values }); return this; },
      delete() { mutation = 'delete'; operations.push({ table, mutation }); return this; },
      maybeSingle: async () => result(),
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
  };
  return {
    client: { schema: () => ({ from: query }), rpc: () => assert.fail('read paths must not call RPC') },
    operations,
  };
}

function graphFetch({ detail = detailMessage, attachments = [] } = {}) {
  return async (url) => {
    const requested = String(url);
    if (requested.includes('/attachments?')) return response({ value: attachments });
    if (requested.includes(`/messages/${detail.id}?`)) return response(detail);
    assert.fail('Unexpected Graph request');
  };
}

test('Read-only message detail returns provider data without storage writes, RPC, or deferred attachment work', async () => {
  for (const { host, env } of [
    { host: 'fcos-preview.vercel.app', env: { VERCEL_ENV: 'preview' } },
    { host: 'fcos-staging.vercel.app', env: { VERCEL_ENV: 'production' } },
    { host: 'fcos.fcuno.com', env: { VERCEL_ENV: 'production', FCOS_ENABLE_READ_ONLY_CI: 'true' } },
  ]) {
    const attachment = { id: 'attachment-read-only', name: 'evidence.pdf', contentType: 'application/pdf', size: 12, isInline: false };
    const actionHistory = [{ id: 'action-1', action_type: 'redirect', state: 'confirmed', confirmed_at: '2026-10-02T00:00:00.000Z' }];
    const detailMessageWithAttachment = { ...detailMessage, hasAttachments: true };
    const { client, operations } = createRouterClient({ actionHistory });
    let deferred = 0;
    const dependencies = { env, accessToken: 'test-token',
      fetchImpl: graphFetch({ detail: detailMessageWithAttachment, attachments: [attachment] }), defer: () => { deferred += 1; } };
    const detail = await runWithDeploymentRequestSafety({ headers: { host } },
      () => fetchEmailRouterDetail({ client, mailbox, messageId: detailMessageWithAttachment.id, hasAttachmentsHint: true }, dependencies), env);
    assert.equal(detail.body.content, '<p>Body</p>');
    assert.deepEqual(detail.attachments, [attachment]);
    assert.deepEqual(detail.actionHistory, [{ id: 'action-1', action: 'redirect', status: 'confirmed', at: '2026-10-02T00:00:00.000Z' }]);
    assert.deepEqual(operations, []);
    assert.equal(deferred, 0);
  }
});

test('canonical Production retains indexed attachment persistence', async () => {
  const attachment = { id: 'attachment-1', name: 'evidence.pdf', contentType: 'application/pdf', size: 12, isInline: false };
  const detail = { ...detailMessage, hasAttachments: true };
  const { client, operations } = createRouterClient();
  const deferred = [];
  const dependencies = { env: { VERCEL_ENV: 'production' }, accessToken: 'test-token',
    fetchImpl: graphFetch({ detail, attachments: [attachment] }), defer: (job) => deferred.push(job) };
  const full = await runWithDeploymentRequestSafety({ headers: { host: 'fcos.fcuno.com' } },
    () => fetchEmailRouterDetail({ client, mailbox, messageId: detail.id, hasAttachmentsHint: true }, dependencies), dependencies.env);
  await Promise.all(deferred);
  assert.deepEqual(full.attachments, [attachment]);
  assert.ok(operations.some((operation) => operation.table === 'message_attachment_metadata' && operation.mutation === 'upsert'));
  assert.ok(operations.some((operation) => operation.table === 'messages' && operation.mutation === 'update'));
  assert.equal(deferred.length, 1);
});
