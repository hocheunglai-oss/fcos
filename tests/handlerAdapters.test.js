import test from 'node:test';
import assert from 'node:assert/strict';
import { withActiveUser } from '../api/_handlerAdapters.js';

test('active-user handler adapters reuse a pre-authorized access context', async () => {
  let accessChecks = 0;
  const context = { profile: { id: 'user-1' } };
  const handler = withActiveUser(async (body, receivedContext) => ({ body, receivedContext }), async () => {
    accessChecks += 1;
    return { profile: { id: 'fallback' } };
  });

  const result = await handler({ value: 1 }, null, context);
  assert.equal(accessChecks, 0);
  assert.equal(result.receivedContext, context);
  assert.deepEqual(result.body, { value: 1 });
});

test('active-user handler adapters resolve authentication when context is absent', async () => {
  let requestSeen = null;
  const handler = withActiveUser((_body, context) => context.profile.id, async (request) => {
    requestSeen = request;
    return { profile: { id: 'resolved-user' } };
  });
  const request = { headers: { authorization: 'redacted' } };
  assert.equal(await handler({}, request), 'resolved-user');
  assert.equal(requestSeen, request);
});

test('active-user handler adapters reject invalid dependencies', () => {
  assert.throws(() => withActiveUser(null, async () => ({})), /requires a service and access resolver/i);
});
