import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/functions/[name].js';
import { registeredHandlerBehavior } from '../api/_handlerPolicyRegistry.js';
import { requireReadOnlyCiOperation } from '../api/_readOnlyCiAccess.js';
import { graphEmailPurposeKeys } from '../api/_graphEmail.js';
import { FCOS_READ_ONLY_CI } from '../config/fcosCiIdentity.js';

test('Nom B endpoints deny anonymous users and unauthenticated cron without provider calls', async () => {
  const secret = process.env.CRON_SECRET;
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  process.env.CRON_SECRET = 'disposable-nom-b-test-secret';
  globalThis.fetch = async () => { providerCalls += 1; throw new Error('Unexpected provider call'); };
  try {
    for (const name of ['missingNomBList', 'missingNomBUpload', 'missingNomBReminderCron']) {
      let payload;
      const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { payload = JSON.parse(body); } };
      await handler({ url: `/api/functions/${name}`, method: 'POST', headers: {}, body: {} }, res);
      assert.equal(res.statusCode, 401, name);
      assert.equal(payload.code, 'FCOS_REQUEST_REJECTED');
      assert.equal(res.headers['X-FCOS-Handler-Mutation'], name === 'missingNomBList' ? '0' : '1');
    }
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
  }
});

test('Nom B policies bypass browser caches and retain the read-only CI boundary', () => {
  const ci = { email: FCOS_READ_ONLY_CI.email };
  for (const name of ['missingNomBList', 'missingNomBUpload', 'missingNomBReminderCron']) {
    const policy = registeredHandlerBehavior(name);
    assert.equal(policy.cache, 'none');
    assert.equal(policy.mutation, name !== 'missingNomBList');
    assert.equal(policy.externalAction, name !== 'missingNomBList');
    assert.throws(() => requireReadOnlyCiOperation(ci, name, {}), (error) => error.code === 'FCOS_CI_READ_ONLY');
  }
  assert.ok(graphEmailPurposeKeys().includes('missing_nom_b_reminders'));
});
