import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildEmailRouterRedirectMime,
  createEmailRouterAttachmentToken,
  currentEmailRouterMailbox,
  emailRouterGraphFetch,
  fetchEmailRouterDetail,
  listEmailRouterDirectory,
  normalizeEmailRouterDestinationSelections,
  processEmailRouterOutbox,
  requireEmailRouterConfigurationAuthority,
  requireEmailRouterConfigurationUser,
  resolveEmailRouterActionRecipients,
  resolveEmailRouterAlert,
  retryEmailRouterUncertainAction,
  startEmailRouterAction,
  syncEmailRouterDelta,
  validEmailRouterWebhookNotifications,
  verifyEmailRouterAttachmentToken,
} from '../api/_emailRouterCore.js';

test('direct routing selections preserve numbered order within To, Cc, and Bcc', () => {
  const selections = normalizeEmailRouterDestinationSelections({
    destinationSelections: [
      { destinationId: 'destination-a', kind: 'to' },
      { groupId: 'group-a', kind: 'cc' },
      { destinationId: 'destination-b', kind: 'to' },
      { destinationId: 'destination-c', kind: 'bcc' },
    ],
  });
  assert.deepEqual(selections, [
    { destinationId: 'destination-a', groupId: null, kind: 'to', position: 1, selectionIndex: 0 },
    { destinationId: null, groupId: 'group-a', kind: 'cc', position: 1, selectionIndex: 1 },
    { destinationId: 'destination-b', groupId: null, kind: 'to', position: 2, selectionIndex: 2 },
    { destinationId: 'destination-c', groupId: null, kind: 'bcc', position: 1, selectionIndex: 3 },
  ]);
  assert.throws(() => normalizeEmailRouterDestinationSelections({
    destinationSelections: [{ destinationId: 'destination-a', kind: 'to' }, { destinationId: 'destination-a', kind: 'cc' }],
  }), (error) => error.code === 'EMAIL_ROUTER_RECIPIENT_DUPLICATE');
});

test('directory combines active FCOS users, external contacts, and groups in configured order', async () => {
  const destinationRows = [
    { id: 'destination-1', destination_kind: 'fcos_profile', user_profile_id: 'profile-1', nickname: 'AU', sort_order: 2 },
    { id: 'destination-2', destination_kind: 'fcos_profile', user_profile_id: 'profile-2', nickname: 'IU', sort_order: 3 },
    { id: 'destination-3', destination_kind: 'provider_directory', user_profile_id: null, display_name: 'External Desk', email_address: 'desk@example.net', nickname: 'ED', sort_order: 4 },
  ];
  const groupRows = [{ id: 'group-1', display_name: 'Operations', sort_order: 1, destination_group_members: [{ destination_id: 'destination-1' }] }];
  const client = {
    schema(schema) {
      assert.equal(schema, 'emailrouter');
      return {
        from(table) {
          return {
            select() { return this; },
            eq() { return this; },
            order() { return this; },
            limit: async () => ({ data: table === 'destinations' ? destinationRows : groupRows, error: null }),
          };
        },
      };
    },
    from(table) {
      assert.equal(table, 'user_profiles');
      return {
        select() { return this; },
        in: async () => ({
          data: [
            { id: 'profile-1', email: 'active@example.net', full_name: 'Active User', active: true },
            { id: 'profile-2', email: 'inactive@example.net', full_name: 'Inactive User', active: false },
          ],
          error: null,
        }),
      };
    },
  };
  const directory = await listEmailRouterDirectory({ client });
  assert.deepEqual(directory, [
    { id: 'group-1', kind: 'group', label: 'Operations', memberCount: 1 },
    { id: 'destination-1', kind: 'destination', label: 'AU' },
    { id: 'destination-3', kind: 'destination', label: 'ED' },
  ]);
});

test('routing groups expand external contacts in directory order', async () => {
  const client = {
    schema(schema) {
      assert.equal(schema, 'emailrouter');
      return {
        from(table) {
          const query = {
            columns: '',
            select(columns) { this.columns = columns; return this; },
            in() { return this; },
            eq() { return this; },
            order() { return this; },
            then(resolve) {
              if (table === 'destination_groups') return resolve({ data: [{ id: 'group-a' }], error: null });
              if (table === 'destination_group_members') return resolve({ data: [
                { group_id: 'group-a', destination_id: 'external-b' },
                { group_id: 'group-a', destination_id: 'external-a' },
              ], error: null });
              if (this.columns.includes('sort_order')) return resolve({ data: [{ id: 'external-a', sort_order: 1 }, { id: 'external-b', sort_order: 2 }], error: null });
              return resolve({ data: [
                { id: 'external-a', destination_kind: 'provider_directory', user_profile_id: null, email_address: 'first@example.net' },
                { id: 'external-b', destination_kind: 'provider_directory', user_profile_id: null, email_address: 'second@example.net' },
              ], error: null });
            },
          };
          return query;
        },
      };
    },
  };
  const recipients = await resolveEmailRouterActionRecipients(client, {
    destinationSelections: [{ groupId: 'group-a', kind: 'to' }],
  });
  assert.deepEqual(recipients, [
    { address: 'first@example.net', kind: 'to' },
    { address: 'second@example.net', kind: 'to' },
  ]);
});

test('redirect MIME keeps body bytes while removing unsafe transport headers and BCC visibility', () => {
  const body = Buffer.from([0x61, 0x00, 0xff, 0x0d, 0x0a]);
  const raw = Buffer.concat([Buffer.from([
    'Return-Path: <source@example.net>',
    'Received: by relay',
    'From: Source Desk <source@example.net>',
    'Reply-To: Replies <reply@example.net>',
    'To: router@example.net',
    'Subject: Status update',
    'Message-ID: <source@example.net>',
    'Content-Type: application/octet-stream',
    '',
    '',
  ].join('\r\n'), 'latin1'), body]);
  const result = buildEmailRouterRedirectMime({
    raw,
    mailboxAddress: 'router@example.net',
    recipients: [{ address: 'to@example.net', kind: 'to' }, { address: 'hidden@example.net', kind: 'bcc' }],
  });
  const split = result.raw.indexOf(Buffer.from('\r\n\r\n'));
  const headers = result.raw.subarray(0, split).toString('latin1');
  assert.match(headers, /Reply-To: <reply@example.net>/);
  assert.match(headers, /To: <to@example.net>/);
  assert.doesNotMatch(headers, /hidden@example.net/);
  assert.doesNotMatch(headers, /^(?:Return-Path|Received):/im);
  assert.deepEqual(result.envelopeRecipients, ['to@example.net', 'hidden@example.net']);
  assert.deepEqual(result.raw.subarray(split + 4), body);
});

test('redirect MIME rejects protected content and visible original BCC headers', () => {
  const unsafe = Buffer.from('From: source@example.net\r\nMessage-ID: <x@example.net>\r\nBcc: private@example.net\r\n\r\nbody');
  assert.throws(() => buildEmailRouterRedirectMime({ raw: unsafe, mailboxAddress: 'router@example.net', recipients: [{ address: 'to@example.net', kind: 'to' }] }), (error) => error.code === 'EMAIL_ROUTER_REDIRECT_UNSUPPORTED');
});

test('attachment links are short-lived, signed, and contain no file name', () => {
  const env = { FCOS_EMAIL_ROUTER_ATTACHMENT_SECRET: 'attachment-test-secret' };
  const token = createEmailRouterAttachmentToken({ mailboxId: 'mailbox-1', messageId: 'message-1', attachmentId: 'attachment-1', expiresAt: Date.now() + 1_000 }, env);
  assert.doesNotMatch(token, /\.pdf|invoice|name/i);
  assert.deepEqual(verifyEmailRouterAttachmentToken(token, env), { mailboxId: 'mailbox-1', messageId: 'message-1', attachmentId: 'attachment-1' });
  assert.throws(() => verifyEmailRouterAttachmentToken(`${token}x`, env), (error) => error.code === 'EMAIL_ROUTER_ATTACHMENT_TOKEN_INVALID');
});

test('configuration access is limited to active administrator or UUID-backed General Manager', () => {
  const administrator = { id: 'de305d54-75b4-431b-adb2-eb6b9e546014', active: true, user_type: 'administrator' };
  const generalManager = { ...administrator, user_type: 'general_manager' };
  assert.equal(requireEmailRouterConfigurationAuthority(administrator), administrator);
  assert.equal(requireEmailRouterConfigurationAuthority(generalManager, true), generalManager);
  assert.throws(() => requireEmailRouterConfigurationAuthority(generalManager), (error) => error.code === 'EMAIL_ROUTER_CONFIGURATION_FORBIDDEN');
  assert.throws(() => requireEmailRouterConfigurationAuthority({ ...administrator, user_type: 'manager' }), (error) => error.code === 'EMAIL_ROUTER_CONFIGURATION_FORBIDDEN');
  assert.throws(() => requireEmailRouterConfigurationAuthority({ ...administrator, id: 'not-a-uuid', user_type: 'general_manager' }), (error) => error.code === 'EMAIL_ROUTER_CONFIGURATION_FORBIDDEN');
});

test('configuration requests revalidate the active General Manager assignment', async () => {
  const profile = { id: 'de305d54-75b4-431b-adb2-eb6b9e546014', active: true, user_type: 'general_manager' };
  const client = {
    from(table) {
      assert.equal(table, 'collaboration_roles');
      return {
        select() { return this; },
        eq() { return this; },
        limit: async () => ({ data: [{ user_id: profile.id }], error: null }),
      };
    },
  };
  const context = await requireEmailRouterConfigurationUser({}, { client, profile });
  assert.equal(context.profile, profile);
});

test('current mailbox comes from the Supabase registry, not a caller supplied address', async () => {
  const connectionQuery = {
    eq() { return this; },
    maybeSingle: async () => ({ data: { id: 'connection-id', sender_mailbox_id: 'registry-id', state: 'active' }, error: null }),
  };
  const client = {
    from(table) {
      if (table === 'email_sender_routes') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { mailbox_id: 'registry-id', email_sender_purposes: { enabled: true }, email_sender_mailboxes: { id: 'registry-id', email_address: 'registered@example.net', label: 'Registered', active: true } }, error: null }) }) }) };
      if (table === 'emailrouter.mailbox_connections') return { select: () => connectionQuery };
      throw new Error(`unexpected table ${table}`);
    },
  };
  const mailbox = await currentEmailRouterMailbox(client);
  assert.equal(mailbox.emailAddress, 'registered@example.net');
});

test('webhook notifications require a constant-time clientState match', () => {
  const notifications = validEmailRouterWebhookNotifications({ value: [{ subscriptionId: 'ok', clientState: 'expected' }, { subscriptionId: 'bad', clientState: 'wrong' }] }, 'expected');
  assert.deepEqual(notifications, [{ subscriptionId: 'ok', resource: '', changeType: '', lifecycleEvent: '', resourceId: '' }]);
});

test('successful subscription maintenance can resolve only its recovered alert', async () => {
  let values;
  let dedupeKey;
  let states;
  const query = {
    update(input) { values = input; return this; },
    eq(column, value) { assert.equal(column, 'dedupe_key'); dedupeKey = value; return this; },
    in: async (column, input) => {
      assert.equal(column, 'state');
      states = input;
      return { error: null };
    },
  };
  const client = {
    from(table) {
      assert.equal(table, 'emailrouter.alerts');
      return query;
    },
  };
  await resolveEmailRouterAlert(client, { dedupeKey: 'mailbox:mailbox-1:subscriptions' });
  assert.equal(dedupeKey, 'mailbox:mailbox-1:subscriptions');
  assert.deepEqual(states, ['open', 'acknowledged']);
  assert.equal(values.state, 'resolved');
  assert.equal(values.resolved_by, null);
  assert.equal(values.resolved_at, null);
});

test('Graph requests use immutable identifiers and a started outbox entry is reconciled without resubmission', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ error: { code: 'ErrorItemNotFound' } }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(
    () => emailRouterGraphFetch('/users/test/messages/test', {}, { accessToken: 'access-token', fetchImpl }),
    (error) => error.code === 'ErrorItemNotFound',
  );
  assert.equal(calls[0].headers.get('authorization'), 'Bearer access-token');
  assert.match(calls[0].headers.get('prefer'), /IdType="ImmutableId"/);

  let outboxRead = 0;
  const outboxQuery = {
    eq() { return this; },
    in() { return this; },
    lte() { return this; },
    order() { return this; },
    limit: async () => ({
      data: outboxRead++ === 0 ? [] : [{ id: 'outbox-1', mail_action_id: 'action-1', provider_operation_id: 'draft-1', state: 'uncertain', mail_actions: { action_type: 'redirect', state: 'uncertain', provider_operation_id: 'draft-1', messages: { provider_message_id: 'source-1', mailbox_id: 'mailbox-1' } } }],
      error: null,
    }),
  };
  const client = { from: () => ({ select: () => outboxQuery }) };
  calls.length = 0;
  const result = await processEmailRouterOutbox({ client, mailbox: { id: 'mailbox-1', emailAddress: 'registered@example.net' } }, { accessToken: 'access-token', fetchImpl });
  assert.deepEqual(result, { submitted: 0, confirmed: 0 });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].url, /\/send$/);
});

test('Graph delta cursors accept the mailbox-scoped URL shape returned by Microsoft', async () => {
  const mailbox = { id: 'mailbox-1', emailAddress: 'router@example.net' };
  const cursor = "https://graph.microsoft.com/v1.0/users/router@example.net/mailFolders('inbox')/messages/delta?$deltatoken=opaque";
  let fetchedUrl = '';
  const client = {
    from(table) {
      assert.equal(table, 'emailrouter.mailbox_delta_state');
      return { upsert: async () => ({ error: null }) };
    },
  };
  const result = await syncEmailRouterDelta({ client, mailbox, folder: 'inbox', deltaLink: cursor }, {
    accessToken: 'access-token',
    fetchImpl: async (url) => {
      fetchedUrl = String(url);
      return new Response(JSON.stringify({ value: [], '@odata.deltaLink': cursor }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(fetchedUrl, cursor);
  assert.equal(result.pages, 1);
  await assert.rejects(
    () => syncEmailRouterDelta({ client, mailbox, folder: 'inbox', deltaLink: cursor.replace('router@example.net', 'other@example.net') }, { accessToken: 'access-token' }),
    (error) => error.code === 'EMAIL_ROUTER_DELTA_CURSOR_INVALID',
  );
});

test('message detail loads attachments separately from the Graph body request', async () => {
  const calls = [];
  const message = { id: 'provider-message-1', subject: 'Subject', body: { contentType: 'text', content: 'Body' }, hasAttachments: true };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const payload = String(url).includes('/attachments?')
      ? { value: [{ id: 'attachment-1', name: 'document.pdf', contentType: 'application/pdf', size: 100, isInline: false }] }
      : message;
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const messageQuery = {
    eq() { return this; },
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const client = { from: () => ({ select: () => messageQuery }) };
  const result = await fetchEmailRouterDetail({
    client,
    mailbox: { id: 'mailbox-1', emailAddress: 'router@example.net' },
    messageId: message.id,
  }, { accessToken: 'access-token', fetchImpl });
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0], /\$expand=/);
  assert.match(calls[1], /\/attachments\?/);
  assert.equal(result.attachments.length, 1);
});

test('a repeated operation ID returns its existing state without another Graph request', async () => {
  const mailboxId = 'mailbox-1';
  const indexedMessageId = 'indexed-message-1';
  const operationId = '5a1e4ac8-04c9-4828-b7d3-4cf160611087';
  const requestFingerprint = createHash('sha256').update(JSON.stringify({
    actionType: 'reply',
    bodyHash: createHash('sha256').update('', 'utf8').digest('hex'),
    destinationFolderId: null,
    destinationSelections: [],
    mailboxId,
    messageId: indexedMessageId,
    presetId: null,
  })).digest('hex');
  const messageQuery = {
    eq() { return this; },
    maybeSingle: async () => ({ data: { id: indexedMessageId, provider_message_id: 'provider-message-1', folder_key: 'inbox' }, error: null }),
  };
  const existingActionQuery = {
    eq() { return this; },
    maybeSingle: async () => ({ data: {
      id: 'action-1', state: 'submitted', action_type: 'reply', message_id: indexedMessageId,
      provider_operation_id: 'draft-1', request_fingerprint: requestFingerprint, idempotency_key: operationId,
    }, error: null }),
  };
  const client = {
    from(table) {
      if (table === 'emailrouter.messages') return { select: () => messageQuery };
      if (table === 'emailrouter.mail_actions') return {
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505' } }) }) }),
        select: () => existingActionQuery,
      };
      throw new Error(`unexpected table ${table}`);
    },
  };
  let graphCalls = 0;
  const result = await startEmailRouterAction({
    client,
    profile: { id: 'de305d54-75b4-431b-adb2-eb6b9e546014', active: true },
    mailbox: { id: mailboxId, emailAddress: 'router@example.net' },
    actionType: 'reply',
    sourceMessageId: 'provider-message-1',
    input: { operationId },
  }, {
    accessToken: 'access-token',
    env: { ENABLE_EXTERNAL_EMAIL_SEND: 'true' },
    fetchImpl: async () => { graphCalls += 1; throw new Error('Graph must not be called for a duplicate operation.'); },
  });
  assert.equal(result.status, 'submitted');
  assert.equal(result.actionId, 'action-1');
  assert.equal(graphCalls, 0);
});

test('uncertain outgoing actions cannot be retried without explicit human confirmation', async () => {
  await assert.rejects(
    () => retryEmailRouterUncertainAction({
      client: {},
      mailbox: { id: 'mailbox-1', emailAddress: 'router@example.net' },
      profile: { id: 'de305d54-75b4-431b-adb2-eb6b9e546014', active: true },
      actionId: 'action-1',
      confirmedNotSent: false,
    }),
    (error) => error.code === 'EMAIL_ROUTER_RETRY_CONFIRMATION_REQUIRED',
  );
});

test('the native router core has no SMTP dependency or sender input path', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../api/_emailRouterCore.js', import.meta.url), 'utf8');
  const clientSource = await (await import('node:fs/promises')).readFile(new URL('../src/lib/emailRouter.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /nodemailer|smtp|createTransport|createSmtp/i);
  assert.doesNotMatch(source, /input\.from|body\.from|workflow.*mailbox/i);
  assert.doesNotMatch(source, /messages\/delta[^`'\"]*\$top=50/);
  assert.match(source, /IdType="ImmutableId"/);
  assert.match(source, /mailFolders\/sentitems\/messages/);
  assert.match(clientSource, /'sentDateTime'.*'receivedDateTime'/);
});

test('migration sync diagnostics expose only a bounded provider code', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../api/email-router-sync.js', import.meta.url), 'utf8');
  assert.match(source, /replaceAll\(\/\[\^a-zA-Z0-9_.-\]\/g, '_'/);
  assert.match(source, /slice\(0, 120\)/);
  assert.match(source, /entity_type: 'mailbox'/);
  assert.doesNotMatch(source, /entity_type: 'mailbox_connection'/);
  assert.doesNotMatch(source, /stack|response\.text|access_token|client_assertion/i);
});
