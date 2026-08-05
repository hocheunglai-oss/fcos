import assert from 'node:assert/strict';
import test from 'node:test';

import { saveGraphEmailRoutesBatch } from '../api/_graphEmail.js';

const profile = { id: '2ff7dfcf-75cf-4df2-900c-a22c44210bad', email: 'admin@example.com' };

test('email sender routes are normalized and saved through one atomic RPC', async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: args.p_changes.map((change, index) => ({
          purpose_key: change.purposeKey,
          mailbox_id: change.mailboxId,
          revision: index + 4,
          updated_at: '2026-08-05T03:00:00Z',
        })),
        error: null,
      };
    },
  };

  const result = await saveGraphEmailRoutesBatch(client, profile, {
    reason: 'Consolidate operational sender routes.',
    changes: [
      { purposeKey: 'payment_reminders', mailboxId: 'mailbox-1', expectedRevision: 3 },
      { purposeKey: 'fcos_updates', mailboxId: '', expectedRevision: 7 },
    ],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'save_email_sender_routes_batch');
  assert.deepEqual(calls[0].args.p_changes, [
    { purposeKey: 'payment_reminders', mailboxId: 'mailbox-1', expectedRevision: 3 },
    { purposeKey: 'fcos_updates', mailboxId: null, expectedRevision: 7 },
  ]);
  assert.equal(calls[0].args.p_actor_user_id, profile.id);
  assert.equal(result[1].purposeKey, 'fcos_updates');
  assert.equal(result[1].revision, 5);
});

test('email sender route batches reject duplicate and unregistered purposes before the database call', async () => {
  const client = { rpc: async () => assert.fail('RPC must not be called') };
  await assert.rejects(
    saveGraphEmailRoutesBatch(client, profile, {
      reason: 'Duplicate route test.',
      changes: [
        { purposeKey: 'payment_reminders', expectedRevision: 1 },
        { purposeKey: 'payment_reminders', expectedRevision: 1 },
      ],
    }),
    /only once/i,
  );
  await assert.rejects(
    saveGraphEmailRoutesBatch(client, profile, {
      reason: 'Forged route test.',
      changes: [{ purposeKey: 'forged_sender', expectedRevision: 1 }],
    }),
    /not registered/i,
  );
});

test('email sender route batches surface revision conflicts as HTTP 409 errors', async () => {
  const client = {
    async rpc() {
      return { data: null, error: { message: 'This email purpose changed after it was opened. Refresh before saving.' } };
    },
  };
  await assert.rejects(
    saveGraphEmailRoutesBatch(client, profile, {
      reason: 'Revision conflict test.',
      changes: [{ purposeKey: 'payment_reminders', expectedRevision: 1 }],
    }),
    (error) => error.status === 409 && error.code === 'REVISION_CONFLICT',
  );
});
