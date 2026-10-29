import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeAccessRefresh, ACCESS_CHANGED_EVENT } from '../src/lib/accessRefresh.js';

test('access refresh checks only visible sessions and removes timers and listeners', () => {
  const target = new EventTarget(), doc = new EventTarget();
  doc.visibilityState = 'visible';
  let tick, removed = false, calls = 0;
  target.setInterval = (fn, ms) => { assert.equal(ms, 60000); tick = fn; return 42; };
  target.clearInterval = (id) => { assert.equal(id, 42); removed = true; };
  const cleanup = subscribeAccessRefresh(() => { calls++; }, target, doc);
  target.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
  target.dispatchEvent(new Event('focus'));
  tick();
  assert.equal(calls, 3);
  doc.visibilityState = 'hidden';
  tick();
  assert.equal(calls, 3);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 4);
  cleanup();
  target.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 4);
  assert.equal(removed, true);
});
