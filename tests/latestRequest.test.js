import assert from 'node:assert/strict';
import test from 'node:test';
import { createLatestRequestGate } from '../src/lib/latestRequest.js';

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

async function applyWhenCurrent(request, work, applied) {
  const value = await work;
  if (request.isCurrent()) applied.push(value);
}

test('latest request gate keeps B detail when A resolves late after A-to-B navigation', async () => {
  const gate = createLatestRequestGate();
  const applied = [];
  const a = deferred();
  const b = deferred();
  const requestA = gate.begin('A');
  const pendingA = applyWhenCurrent(requestA, a.promise, applied);
  const requestB = gate.begin('B');
  const pendingB = applyWhenCurrent(requestB, b.promise, applied);

  assert.equal(requestA.signal?.aborted, true);
  b.resolve('B detail');
  a.resolve('A detail');
  await Promise.all([pendingA, pendingB]);
  assert.deepEqual(applied, ['B detail']);
});

test('latest request gate ignores a late detail response after Back or close', async () => {
  const gate = createLatestRequestGate();
  const applied = [];
  const detail = deferred();
  const request = gate.begin('A');
  const pending = applyWhenCurrent(request, detail.promise, applied);

  gate.invalidate();
  assert.equal(request.signal?.aborted, true);
  detail.resolve('A detail');
  await pending;
  assert.deepEqual(applied, []);
});

test('latest request gate keeps only the newest same-record refresh and permits a current load', async () => {
  const gate = createLatestRequestGate();
  const applied = [];
  const staleRefresh = deferred();
  const freshRefresh = deferred();
  const first = gate.begin('A');
  const pendingFirst = applyWhenCurrent(first, staleRefresh.promise, applied);
  const second = gate.begin('A');
  const pendingSecond = applyWhenCurrent(second, freshRefresh.promise, applied);

  staleRefresh.resolve('old A');
  freshRefresh.resolve('fresh A');
  await Promise.all([pendingFirst, pendingSecond]);
  assert.deepEqual(applied, ['fresh A']);

  const current = gate.begin('B');
  await applyWhenCurrent(current, Promise.resolve('B detail'), applied);
  assert.deepEqual(applied, ['fresh A', 'B detail']);
});

test('latest request gate preserves current list rows when an older view request resolves late', async () => {
  const gate = createLatestRequestGate();
  const applied = [];
  const waiting = deferred();
  const allCases = deferred();
  const waitingRequest = gate.begin('waiting');
  const pendingWaiting = applyWhenCurrent(waitingRequest, waiting.promise, applied);
  const allCasesRequest = gate.begin('all_cases');
  const pendingAllCases = applyWhenCurrent(allCasesRequest, allCases.promise, applied);

  allCases.resolve(['B']);
  waiting.resolve([]);
  await Promise.all([pendingWaiting, pendingAllCases]);
  assert.deepEqual(applied, [['B']]);
});

test('latest request gate rejects a save result after the user switches records', async () => {
  const gate = createLatestRequestGate();
  const applied = [];
  const savedA = deferred();
  const saveRequest = gate.begin('A');
  const pendingSave = applyWhenCurrent(saveRequest, savedA.promise, applied);

  gate.begin('B');
  savedA.resolve('saved A detail');
  await pendingSave;
  assert.deepEqual(applied, []);
});
