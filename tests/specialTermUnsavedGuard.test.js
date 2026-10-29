import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpecialTermUnsavedGuard } from '../src/lib/useSpecialTermUnsavedGuard.js';

class FakeEvent {
  constructor(type, { detail, state } = {}) {
    this.type = type;
    this.detail = detail;
    this.state = state;
    this.defaultPrevented = false;
    this.immediatePropagationStopped = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopImmediatePropagation() {
    this.immediatePropagationStopped = true;
  }
}

class FakeWindow {
  constructor(index = 0) {
    this.listeners = new Map();
    this.microtasks = [];
    this.confirmAnswers = [];
    this.confirmMessages = [];
    this.alertMessages = [];
    this.dirtyEvents = [];
    this.goCalls = [];
    this.CustomEvent = class extends FakeEvent {};
    this.history = {
      state: { idx: index },
      go: (delta) => this.goCalls.push(delta),
    };
  }

  addEventListener(type, listener, capture = false) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, capture: Boolean(capture) });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener, capture = false) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => entry.listener !== listener || entry.capture !== Boolean(capture)));
  }

  dispatchEvent(event) {
    if (event.type === 'fcos:dirty-state') this.dirtyEvents.push(event.detail);
    const entries = [...(this.listeners.get(event.type) || [])].sort((left, right) => Number(right.capture) - Number(left.capture));
    for (const { listener } of entries) {
      listener(event);
      if (event.immediatePropagationStopped) break;
    }
    return !event.defaultPrevented;
  }

  confirm(message) {
    this.confirmMessages.push(message);
    return this.confirmAnswers.shift() ?? false;
  }

  alert(message) {
    this.alertMessages.push(message);
  }

  queueMicrotask(callback) {
    this.microtasks.push(callback);
  }

  flushMicrotasks() {
    for (const callback of this.microtasks.splice(0)) callback();
  }
}

function setup(state = { dirty: true, busy: false }, index = 0) {
  const targetWindow = new FakeWindow(index);
  const calls = [];
  const navigator = {
    push(to) {
      calls.push(['push', to]);
      targetWindow.history.state = { idx: targetWindow.history.state.idx + 1 };
    },
    replace(to) {
      calls.push(['replace', to]);
    },
  };
  const originals = { push: navigator.push, replace: navigator.replace };
  const controller = createSpecialTermUnsavedGuard({
    targetWindow,
    navigator,
    key: 'special-term:one',
    getState: () => state,
  });
  return { calls, controller, navigator, originals, state, targetWindow };
}

test('clean state allows navigation and beforeunload without prompting', () => {
  const fixture = setup({ dirty: false, busy: false });
  fixture.navigator.push('/next');
  fixture.navigator.replace('/replacement');
  const unload = new FakeEvent('beforeunload');
  fixture.targetWindow.dispatchEvent(unload);
  assert.deepEqual(fixture.calls, [['push', '/next'], ['replace', '/replacement']]);
  assert.equal(fixture.targetWindow.confirmMessages.length, 0);
  assert.equal(unload.defaultPrevented, false);
  fixture.controller.cleanup();
});

test('programmatic push and replace stop on decline and proceed on acceptance', () => {
  const fixture = setup();
  fixture.targetWindow.confirmAnswers.push(false, true);
  fixture.navigator.push('/declined');
  fixture.navigator.replace('/accepted');
  assert.deepEqual(fixture.calls, [['replace', '/accepted']]);
  assert.equal(fixture.targetWindow.confirmMessages.length, 2);
  fixture.controller.cleanup();
});

test('an accepted Layout confirmation grants one synchronous navigation without a duplicate prompt', () => {
  const fixture = setup();
  fixture.targetWindow.confirmAnswers.push(true);
  fixture.controller.publish(fixture.controller.confirmLeave);
  const dirtyDetail = fixture.targetWindow.dirtyEvents.at(-1);
  assert.equal(dirtyDetail.dirty, true);
  assert.equal(dirtyDetail.confirmLeave(), true);
  fixture.navigator.push('/after-layout-confirm');
  assert.deepEqual(fixture.calls, [['push', '/after-layout-confirm']]);
  assert.equal(fixture.targetWindow.confirmMessages.length, 1);
  fixture.targetWindow.flushMicrotasks();
  fixture.controller.cleanup();
});

test('declined Back navigation restores the stored index and swallows both POP events', () => {
  const fixture = setup(undefined, 4);
  let routerPopCount = 0;
  fixture.targetWindow.addEventListener('popstate', () => { routerPopCount += 1; });
  fixture.targetWindow.confirmAnswers.push(false);
  fixture.targetWindow.history.state = { idx: 2 };
  const rejectedPop = new FakeEvent('popstate', { state: { idx: 2 } });
  fixture.targetWindow.dispatchEvent(rejectedPop);
  assert.equal(rejectedPop.immediatePropagationStopped, true);
  assert.deepEqual(fixture.targetWindow.goCalls, [2]);
  fixture.targetWindow.history.state = { idx: 4 };
  const restorationPop = new FakeEvent('popstate', { state: { idx: 4 } });
  fixture.targetWindow.dispatchEvent(restorationPop);
  assert.equal(restorationPop.immediatePropagationStopped, true);
  assert.equal(routerPopCount, 0);
  assert.equal(fixture.targetWindow.confirmMessages.length, 1);
  fixture.controller.cleanup();
});

test('accepted Forward navigation reaches the router and updates the stored index', () => {
  const fixture = setup(undefined, 2);
  let routerPopCount = 0;
  fixture.targetWindow.addEventListener('popstate', () => { routerPopCount += 1; });
  fixture.targetWindow.confirmAnswers.push(true, false);
  fixture.targetWindow.history.state = { idx: 5 };
  fixture.targetWindow.dispatchEvent(new FakeEvent('popstate', { state: { idx: 5 } }));
  assert.equal(routerPopCount, 1);
  fixture.targetWindow.history.state = { idx: 4 };
  fixture.targetWindow.dispatchEvent(new FakeEvent('popstate', { state: { idx: 4 } }));
  assert.deepEqual(fixture.targetWindow.goCalls, [1]);
  fixture.controller.cleanup();
});

test('busy state refuses navigation, explains the save, and protects beforeunload', () => {
  const fixture = setup({ dirty: false, busy: true });
  fixture.navigator.push('/blocked');
  assert.equal(fixture.controller.confirmLeave(), false);
  const unload = new FakeEvent('beforeunload');
  fixture.targetWindow.dispatchEvent(unload);
  fixture.controller.publish();
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.targetWindow.confirmMessages.length, 0);
  assert.equal(fixture.targetWindow.alertMessages.length, 2);
  assert.match(fixture.targetWindow.alertMessages[0], /save is still in progress/i);
  assert.equal(unload.defaultPrevented, true);
  assert.equal(unload.returnValue, '');
  assert.equal(fixture.targetWindow.dirtyEvents.at(-1).dirty, true);
  fixture.controller.cleanup();
});

test('cleanup removes handlers, restores only owned wrappers, and clears dirty state', () => {
  const fixture = setup();
  const laterWrapper = () => {};
  fixture.navigator.replace = laterWrapper;
  fixture.controller.cleanup();
  assert.equal(fixture.navigator.push, fixture.originals.push);
  assert.equal(fixture.navigator.replace, laterWrapper);
  assert.deepEqual(fixture.targetWindow.dirtyEvents.at(-1), { key: 'special-term:one', dirty: false });
  const unload = new FakeEvent('beforeunload');
  fixture.targetWindow.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, false);
  assert.equal((fixture.targetWindow.listeners.get('popstate') || []).filter((entry) => entry.capture).length, 0);
});
