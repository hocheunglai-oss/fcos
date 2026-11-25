import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createEmailRouterAttachmentToken } from '../api/_emailRouterCore.js';
import {
  emailRouterAttachmentStreamHandler,
  emailRouterAttachmentUrlHandler,
  emailRouterDetailHandler,
} from '../api/_emailRouterHandlers.js';

const firstUser = '10000000-0000-4000-8000-000000000001';
const secondUser = '10000000-0000-4000-8000-000000000002';
const resource = { messageId: 'message', attachmentId: 'attachment' };
const request = { headers: { authorization: 'Bearer synthetic-session' } };

function fixture() {
  const state = { actor: firstUser, allowed: true, mailbox: 'mailbox', accessChecks: [], contentReads: 0 };
  const env = { FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET: 'local-attachment-unit-fixture' };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: state.actor } } }) },
    async rpc(name, { p_user_id: id }) {
      assert.equal(name, 'fcos_effective_access');
      state.accessChecks.push(id);
      return { data: { user_id: id, permissions: { email_router: state.allowed } } };
    },
    from(table) {
      const rows = {
        user_profiles: { id: state.actor, active: true, user_type: 'viewer' },
        email_sender_routes: { mailbox_id: 'sender', email_sender_purposes: { enabled: true },
          email_sender_mailboxes: { id: 'sender', active: true, email_address: 'router@example.test' } },
        'emailrouter.mailbox_connections': { id: state.mailbox, state: 'active' },
        'emailrouter.messages': null,
      };
      assert.ok(Object.hasOwn(rows, table), table);
      return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: rows[table] }) };
    },
  };
  const deps = { client, env, accessToken: 'synthetic-graph-session', async fetchImpl(url) {
    const path = new URL(url).pathname;
    if (path.endsWith('/$value')) {
      state.contentReads++;
      return new Response('fixture content', { headers: { 'content-type': 'text/plain' } });
    }
    if (path.endsWith('/attachments')) return Response.json({ value: [{ id: resource.attachmentId, name: 'fixture.txt', contentType: 'text/plain' }] });
    assert.ok(path.endsWith('/messages/message'));
    return Response.json({ id: resource.messageId, hasAttachments: true });
  } };
  return {
    state, env, deps,
    issue: () => emailRouterAttachmentUrlHandler(request, resource, deps),
    open: (url) => emailRouterAttachmentStreamHandler({ ...request, url }, {}, deps),
  };
}

test('both attachment link issuers bind the signed reference to the authenticated reader', async () => {
  const { state, deps, issue, open } = fixture();
  const issued = await issue();
  const detail = await emailRouterDetailHandler(request, resource, deps);
  for (const url of [issued.url, detail.attachments[0].streamUrl]) {
    state.actor = secondUser;
    const before = state.contentReads;
    await assert.rejects(open(url), { code: 'EMAIL_ROUTER_ATTACHMENT_TOKEN_INVALID' });
    assert.equal(state.contentReads, before);
    state.actor = firstUser;
    const attachment = await open(url);
    assert.equal(await new Response(attachment.body).text(), 'fixture content');
    assert.equal(state.contentReads, before + 1);
  }
  assert.deepEqual(state.accessChecks, [firstUser, firstUser]);
});

test('current module entitlement and current mailbox are required on every content read', async () => {
  const { state, deps, issue, open } = fixture();
  const { url } = await issue();
  await open(url);
  for (const grant of [false, 'read', undefined]) {
    state.allowed = grant;
    await assert.rejects(open(url), { code: 'FCOS_MODULE_FORBIDDEN' });
  }
  state.allowed = true;
  state.mailbox = 'replacement';
  await assert.rejects(open(url), { code: 'EMAIL_ROUTER_ATTACHMENT_FORBIDDEN' });
  assert.deepEqual(state.accessChecks, Array(5).fill(firstUser));
  state.mailbox = 'mailbox';
  deps.client.rpc = async () => ({ error: new Error('fixture access store unavailable') });
  await assert.rejects(open(url), /fixture access store unavailable/);
  assert.equal(state.contentReads, 1);
});

test('expired and pre-upgrade unbound links fail before the content provider is called', async () => {
  const { env, state, issue, open } = fixture();
  const expired = createEmailRouterAttachmentToken({ ...resource, actorId: firstUser, mailboxId: state.mailbox, expiresAt: Date.now() - 1000 }, env);
  await assert.rejects(open('/?token=' + encodeURIComponent(expired)), { code: 'EMAIL_ROUTER_ATTACHMENT_TOKEN_EXPIRED' });
  const { token } = await issue();
  const [payload] = token.split('.');
  const previousSignature = createHmac('sha256', env.FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET).update(payload).digest('base64url');
  await assert.rejects(open('/?token=' + encodeURIComponent(payload + '.' + previousSignature)), { code: 'EMAIL_ROUTER_ATTACHMENT_TOKEN_INVALID' });
  assert.equal(state.contentReads, 0);
});
