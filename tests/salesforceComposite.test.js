import test from 'node:test';
import assert from 'node:assert/strict';
import { sfCompositeQueries } from '../api/_salesforce.js';
import { runWithRequestTelemetry } from '../api/_requestTelemetry.js';
import {
  createMemoryRuntimeCacheAdapter,
  getOrLoadRuntimeCache,
} from '../api/_runtimeCache.js';

const originalFetch = globalThis.fetch;
const originalAccessToken = process.env.SALESFORCE_ACCESS_TOKEN;
const originalInstanceUrl = process.env.SALESFORCE_INSTANCE_URL;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'sforce-limit-info': 'api-usage=50/1000',
    },
  });
}

test.beforeEach(() => {
  process.env.SALESFORCE_ACCESS_TOKEN = 'test-token';
  process.env.SALESFORCE_INSTANCE_URL = 'https://example.my.salesforce.com';
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test.after(() => {
  if (originalAccessToken == null) delete process.env.SALESFORCE_ACCESS_TOKEN;
  else process.env.SALESFORCE_ACCESS_TOKEN = originalAccessToken;
  if (originalInstanceUrl == null) delete process.env.SALESFORCE_INSTANCE_URL;
  else process.env.SALESFORCE_INSTANCE_URL = originalInstanceUrl;
});

test('groups at most five independent queries into each Composite request', async () => {
  const requestSizes = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    requestSizes.push(payload.compositeRequest.length);
    return response({
      compositeResponse: payload.compositeRequest.map((request, index) => ({
        referenceId: request.referenceId,
        httpStatusCode: 200,
        body: {
          totalSize: 1,
          records: [{ attributes: { type: 'Account' }, Name: `row-${requestSizes.length}-${index}` }],
        },
      })),
    });
  };

  const results = await sfCompositeQueries(
    Array.from({ length: 7 }, (_, index) => ({
      soql: `SELECT Id FROM Account LIMIT ${index + 1}`,
      clean: true,
    })),
  );

  assert.deepEqual(requestSizes, [5, 2]);
  assert.equal(results.length, 7);
  assert.equal(results.every((result) => result.records.length === 1), true);
  assert.equal(Object.hasOwn(results[0].records[0], 'attributes'), false);
});

test('follows Composite query pagination up to the requested limit', async () => {
  let call = 0;
  globalThis.fetch = async (_url, options) => {
    call += 1;
    const payload = JSON.parse(options.body);
    if (call === 1) {
      return response({
        compositeResponse: [{
          referenceId: payload.compositeRequest[0].referenceId,
          httpStatusCode: 200,
          body: {
            totalSize: 3,
            records: [{ Id: 'one' }],
            nextRecordsUrl: '/services/data/v59.0/query/next-page',
          },
        }],
      });
    }
    assert.match(payload.compositeRequest[0].url, /\/query\/next-page$/);
    return response({
      compositeResponse: [{
        referenceId: payload.compositeRequest[0].referenceId,
        httpStatusCode: 200,
        body: { totalSize: 3, records: [{ Id: 'two' }, { Id: 'three' }] },
      }],
    });
  };

  const [result] = await sfCompositeQueries([{ soql: 'SELECT Id FROM Account', limit: 2 }]);
  assert.equal(call, 2);
  assert.equal(result.totalSize, 3);
  assert.deepEqual(result.records.map((record) => record.Id), ['one', 'two']);
});

test('preserves per-query soft failures and rejects strict failures', async () => {
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    return response({
      compositeResponse: payload.compositeRequest.map((request, index) => (
        index === 0
          ? {
              referenceId: request.referenceId,
              httpStatusCode: 400,
              body: [{ errorCode: 'MALFORMED_QUERY', message: 'Invalid field' }],
            }
          : {
              referenceId: request.referenceId,
              httpStatusCode: 200,
              body: { totalSize: 1, records: [{ Id: 'ok' }] },
            }
      )),
    });
  };

  const soft = await sfCompositeQueries([
    { soql: 'SELECT Missing__c FROM Account', softFail: true },
    { soql: 'SELECT Id FROM Account' },
  ]);
  assert.match(soft[0].error, /Invalid field/);
  assert.deepEqual(soft[0].records, []);
  assert.equal(soft[1].records[0].Id, 'ok');

  await assert.rejects(
    () => sfCompositeQueries([{ soql: 'SELECT Missing__c FROM Account' }]),
    /Invalid field/,
  );
});

test('does not cache a snapshot containing a soft Composite failure', async () => {
  const cache = createMemoryRuntimeCacheAdapter();
  let fail = true;
  let fetches = 0;
  globalThis.fetch = async (_url, options) => {
    fetches += 1;
    const payload = JSON.parse(options.body);
    return response({
      compositeResponse: [{
        referenceId: payload.compositeRequest[0].referenceId,
        httpStatusCode: fail ? 400 : 200,
        body: fail
          ? [{ errorCode: 'MALFORMED_QUERY', message: 'Invalid field' }]
          : { totalSize: 1, records: [{ Id: 'fresh' }] },
      }],
    });
  };
  const load = () => getOrLoadRuntimeCache({
    namespace: 'composite-snapshot',
    ttlSeconds: 60,
    cacheAdapter: cache,
    loader: () => sfCompositeQueries([{
      soql: 'SELECT Id FROM Account',
      softFail: true,
    }]),
  });

  const partial = await runWithRequestTelemetry({ handler: 'partial' }, load);
  fail = false;
  const fresh = await runWithRequestTelemetry({ handler: 'fresh' }, load);
  const warm = await runWithRequestTelemetry({ handler: 'warm' }, load);

  assert.equal(partial.cache.status, 'bypass');
  assert.equal(fresh.cache.status, 'miss');
  assert.equal(fresh.value[0].records[0].Id, 'fresh');
  assert.equal(warm.cache.status, 'hit');
  assert.equal(fetches, 2);
});
