import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationStore, NOTIFICATION_HISTORY_LIMIT } from '../src/lib/notificationStore.js';

function fixture(storage = new Map()) {
  let time = Date.parse('2026-09-22T09:00:00Z');
  let sequence = 0;
  const timers = new Map();
  const store = createNotificationStore({
    now: () => time,
    schedule: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: time + delay }); return id; },
    cancel: (id) => timers.delete(id),
    getStorage: () => ({ getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }),
  });
  store.setScope({ ownerId: 'trader-a' });
  function advance(ms) {
    time += ms;
    for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.callback(); }
  }
  return { store, advance, storage, timers };
}

test('success and error popups expire at ten seconds independently and remain in history', () => {
  const { store, advance } = fixture();
  store.add({ title: 'Product mapping saved' });
  advance(5_000);
  store.add({ title: 'Mapping failed', description: 'Try again', variant: 'destructive' });
  advance(4_999);
  assert.equal(store.getSnapshot().toasts.length, 2);
  advance(1);
  assert.deepEqual(store.getSnapshot().toasts.map((row) => row.title), ['Mapping failed']);
  advance(5_000);
  assert.equal(store.getSnapshot().toasts.length, 0);
  assert.deepEqual(store.getSnapshot().history.map((row) => row.title), ['Mapping failed', 'Product mapping saved']);
});

test('manual dismissal preserves the message and cancels its timer', () => {
  const { store, timers } = fixture();
  const notification = store.add({ title: 'Saved' });
  notification.dismiss();
  assert.equal(timers.size, 0);
  assert.equal(store.getSnapshot().toasts.length, 0);
  assert.equal(store.getSnapshot().history[0].title, 'Saved');
});

test('clear all removes active and persisted notifications without resurrection from updates or timers', () => {
  const { store, advance, storage, timers } = fixture();
  const notification = store.add({ title: 'Saved' });
  store.clearAll();
  notification.update({ title: 'Late update' });
  advance(20_000);
  assert.deepEqual(store.getSnapshot(), { toasts: [], history: [] });
  assert.equal(storage.size, 0);
  assert.equal(timers.size, 0);
});

test('reload restores text and timestamps without replaying popups or retaining action callbacks', () => {
  const { store, storage } = fixture();
  const action = () => 'financial record';
  store.add({ title: { props: { children: ['Product ', 'saved'] } }, description: 'USD 10', action, operation: { secretRecord: 'private' } });
  const original = store.getSnapshot().history;
  assert.deepEqual(Object.keys(original[0]).sort(), ['createdAt', 'description', 'id', 'title', 'variant']);
  assert.equal(original[0].title, 'Product saved');
  assert.doesNotMatch([...storage.values()][0], /secretRecord|financial record|action/);
  const reloaded = fixture(storage).store;
  assert.deepEqual(reloaded.getSnapshot(), { toasts: [], history: original });
});

test('account switching and logout clear messages and reject old notification updates', () => {
  const { store, storage, timers } = fixture();
  const notification = store.add({ title: 'Trader A saved' });
  store.setScope({ ownerId: 'trader-b' });
  notification.update({ title: 'Late result from A' });
  assert.deepEqual(store.getSnapshot(), { toasts: [], history: [] });
  assert.equal(storage.size, 0);
  assert.equal(timers.size, 0);
  store.add({ title: 'Trader B saved' });
  store.setScope({ ownerId: null });
  assert.deepEqual(store.getSnapshot(), { toasts: [], history: [] });
  assert.equal(storage.size, 0);
});

test('updates keep one historical entry and give an active changed message another ten seconds', () => {
  const { store, advance } = fixture();
  const notification = store.add({ title: 'Saving' });
  const createdAt = store.getSnapshot().history[0].createdAt;
  advance(9_000);
  notification.update({ title: 'Saved' });
  advance(1_000);
  assert.equal(store.getSnapshot().toasts[0].title, 'Saved');
  advance(9_000);
  assert.equal(store.getSnapshot().toasts.length, 0);
  notification.update({ description: 'Undone' });
  assert.equal(store.getSnapshot().toasts.length, 0);
  assert.equal(store.getSnapshot().history.length, 1);
  assert.equal(store.getSnapshot().history[0].description, 'Undone');
  assert.equal(store.getSnapshot().history[0].createdAt, createdAt);
});

test('bursts retain the latest 500 historical messages without orphaned popup timers', () => {
  const { store, timers, advance } = fixture();
  for (let i = 0; i < NOTIFICATION_HISTORY_LIMIT + 1; i++) store.add({ title: `Message ${i}` });
  assert.equal(store.getSnapshot().history.length, 500);
  assert.equal(store.getSnapshot().history[0].title, 'Message 500');
  assert.equal(store.getSnapshot().history.at(-1).title, 'Message 1');
  assert.equal(timers.size, store.getSnapshot().toasts.length);
  advance(10_000);
  assert.equal(timers.size, 0);
  assert.equal(store.getSnapshot().toasts.length, 0);
});

test('invalid saved history and blocked storage never prevent popup expiry', () => {
  const storage = new Map([['fcos:notifications:trader-a:v1', '{broken']]);
  assert.deepEqual(fixture(storage).store.getSnapshot().history, []);
  let expire;
  const store = createNotificationStore({ getStorage: () => { throw Error('Blocked'); }, schedule: (fn) => { expire = fn; return 1; }, cancel: () => {} });
  store.setScope({ ownerId: 'trader-a' });
  store.add({ title: 'Still works' });
  expire();
  assert.equal(store.getSnapshot().toasts.length, 0);
  assert.equal(store.getSnapshot().history[0].title, 'Still works');
  store.clearAll();
  assert.equal(store.getSnapshot().history.length, 0);
});
