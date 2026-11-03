import test from 'node:test';
import assert from 'node:assert/strict';
import { EXCEPTION_REVIEW_WORKFLOW_BATCH_SIZE, readExceptionReviewWorkflow } from '../src/lib/exceptionReviewWorkflow.js';

const id = index => `a00${String(index).padStart(12, '0')}`;
const owner = { id: 'local-owner', name: 'Owner' };
const response = (ids, ownerOptions = [owner]) => ({ data: {
  byStemId: Object.fromEntries(ids.map(stemId => [stemId, { stemId, status: 'Resolved' }])), ownerOptions,
} });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('reads all 3000 valid IDs sequentially in six bounded batches and merges every workflow and owner', async () => {
  const ids = Array.from({ length: 3000 }, (_, index) => id(index));
  const calls = [];
  let active = 0, maximumActive = 0;
  const result = await readExceptionReviewWorkflow(ids, { invoke: async (name, body, options) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    assert.equal(name, 'exceptionReviewWorkflowList');
    assert.deepEqual(options, { cache: false });
    calls.push(body.stemIds);
    await new Promise(resolve => setImmediate(resolve));
    active -= 1;
    return response(body.stemIds, [owner, { id: `owner-${calls.length}`, name: 'Additional owner' }]);
  } });
  assert.equal(EXCEPTION_REVIEW_WORKFLOW_BATCH_SIZE, 500);
  assert.deepEqual(calls.map(batch => batch.length), [500, 500, 500, 500, 500, 500]);
  assert.deepEqual(calls.flat(), ids);
  assert.equal(maximumActive, 1);
  assert.deepEqual(Object.keys(result.byStemId), ids);
  assert.equal(result.byStemId[id(2999)].status, 'Resolved');
  assert.equal(result.ownerOptions.length, 7);
});

test('deduplicates valid IDs, ignores invalid values and still reads owners for an empty scan', async () => {
  const calls = [];
  const invoke = async (_name, { stemIds }) => { calls.push(stemIds); return response(stemIds); };
  const valid18 = `${id(2)}AAA`;
  const result = await readExceptionReviewWorkflow([id(1), ` ${id(1)} `, null, 1, {}, '', 'invalid', valid18, valid18], { invoke });
  assert.deepEqual(calls, [[id(1), valid18]]);
  assert.deepEqual(Object.keys(result.byStemId), [id(1), valid18]);
  calls.length = 0;
  const empty = await readExceptionReviewWorkflow([], { invoke });
  assert.deepEqual(calls, [[]]);
  assert.deepEqual(empty, { byStemId: {}, ownerOptions: [owner] });
});

test('1001 IDs remain unresolved until the delayed final batch completes', async () => {
  const last = deferred(), calls = [];
  let completed = false;
  const pending = readExceptionReviewWorkflow(Array.from({ length: 1001 }, (_, index) => id(index)), {
    invoke: async (_name, { stemIds }) => {
      calls.push(stemIds);
      if (calls.length === 3) await last.promise;
      return response(stemIds);
    },
  }).then(result => { completed = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(batch => batch.length), [500, 500, 1]);
  assert.equal(completed, false);
  last.resolve();
  assert.equal(Object.keys((await pending).byStemId).length, 1001);
});

test('a failed middle batch rejects the whole generation without reading later batches', async () => {
  let calls = 0;
  await assert.rejects(readExceptionReviewWorkflow(Array.from({ length: 1500 }, (_, index) => id(index)), {
    invoke: async (_name, { stemIds }) => {
      calls += 1;
      return calls === 2 ? { data: { error: 'Workflow read failed' } } : response(stemIds);
    },
  }), /Workflow read failed/);
  assert.equal(calls, 2);
});

test('cancellation during a read returns no result and prevents remaining batches', async () => {
  const first = deferred();
  let current = true, calls = 0;
  const pending = readExceptionReviewWorkflow(Array.from({ length: 1001 }, (_, index) => id(index)), {
    isCurrent: () => current,
    invoke: async (_name, { stemIds }) => { calls += 1; await first.promise; return response(stemIds); },
  });
  current = false;
  first.resolve();
  assert.equal(await pending, null);
  assert.equal(calls, 1);
  assert.equal(await readExceptionReviewWorkflow([], { isCurrent: () => false, invoke: () => assert.fail('cancelled read') }), null);
});

test('malformed or out-of-scope responses cannot become a successful empty workflow', async () => {
  for (const data of [null, {}, { byStemId: [], ownerOptions: [] }, { byStemId: {}, ownerOptions: null },
    { byStemId: { [id(2)]: { status: 'Resolved' } }, ownerOptions: [] },
    { byStemId: { [id(1)]: null }, ownerOptions: [] }, { byStemId: {}, ownerOptions: [{}] }]) {
    await assert.rejects(readExceptionReviewWorkflow([id(1)], { invoke: async () => ({ data }) }), /could not be loaded/);
  }
});
