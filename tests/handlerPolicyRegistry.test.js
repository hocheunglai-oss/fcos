import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildHandlerPolicyRegistry, registeredHandlerBehavior, registeredHandlerCapabilities } from '../api/_handlerPolicyRegistry.js';

test('handler policies are explicit, complete, and fail closed when mismatched', () => {
  assert.equal(registeredHandlerBehavior('authContext').mutation, false);
  assert.equal(registeredHandlerBehavior('dashboardFilterOptions').cache, 'server');
  assert.equal(registeredHandlerBehavior('unknownHandler'), null);
  assert.throws(() => buildHandlerPolicyRegistry({ newUnclassifiedHandler: [] }), /registry mismatch/i);
});

test('critical external actions and mutations carry checked policy metadata', () => {
  assert.equal(registeredHandlerBehavior('buyerInvoicePaymentReminderSend').externalAction, true);
  assert.equal(registeredHandlerBehavior('outstandingBuyerInvoicesEmailReport').mutation, true);
  assert.equal(registeredHandlerBehavior('hedgeDeskSalesforcePush').externalAction, true);
  assert.equal(registeredHandlerBehavior('dashboardAccountInsight').cache, 'server');
  assert.equal(registeredHandlerBehavior('specialTermsPdfExport').mutation, false);
  assert.equal(registeredHandlerBehavior('emailRouterActionStatus').externalAction, true);
});

test('declared handler capabilities are enforced by the shared access adapter', async () => {
  const source = await readFile(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
  assert.match(source, /if \(policy\.capability\) \{[\s\S]*?requireCapability\(context\.client, context\.profile, policy\.capability/);

  const declaredCapabilities = new Set(
    [...source.matchAll(/id:\s*'([^']+)'/g)]
      .map((match) => match[1]),
  );
  for (const capability of registeredHandlerCapabilities()) {
    assert.equal(declaredCapabilities.has(capability), true, `Unknown handler capability: ${capability}`);
  }
});

test('browser cache invalidation uses server mutation metadata instead of handler-name guessing', async () => {
  const source = await readFile(new URL('../src/api/appClient.js', import.meta.url), 'utf8');
  assert.match(source, /x-fcos-handler-mutation/i);
  assert.match(source, /options\.invalidateCache !== false/);
  assert.doesNotMatch(source, /isMutationHandler/);
});
