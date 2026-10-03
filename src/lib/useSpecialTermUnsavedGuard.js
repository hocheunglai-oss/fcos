import { useCallback, useContext, useEffect, useRef } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

const DIRTY_MESSAGE = 'You have unsaved Special Term changes.';
const BUSY_MESSAGE = 'A Special Term save is still in progress. Wait for it to finish before leaving this page.';

function historyIndex(targetWindow) {
  const index = targetWindow.history?.state?.idx;
  return Number.isInteger(index) ? index : null;
}

function customEvent(targetWindow, type, detail) {
  const EventConstructor = targetWindow.CustomEvent || globalThis.CustomEvent;
  return new EventConstructor(type, { detail });
}

function guardState(getState) {
  const state = getState?.() || {};
  return { dirty: Boolean(state.dirty), busy: Boolean(state.busy) };
}

export function createSpecialTermUnsavedGuard({ targetWindow, navigator, key, getState }) {
  let active = true;
  let allowance = 0;
  let restoringPop = false;
  let currentIndex = historyIndex(targetWindow);

  const scheduleAllowanceClear = () => {
    const enqueue = targetWindow.queueMicrotask?.bind(targetWindow) || globalThis.queueMicrotask;
    enqueue(() => {
      allowance = 0;
    });
  };

  const confirmLeave = () => {
    if (!active) return true;
    const state = guardState(getState);
    if (state.busy) {
      targetWindow.alert(BUSY_MESSAGE);
      return false;
    }
    if (!state.dirty) return true;
    const accepted = targetWindow.confirm(`${DIRTY_MESSAGE}\n\nChoose Cancel to stay and save changes, or OK to leave without saving.`);
    if (accepted) {
      allowance = 1;
      scheduleAllowanceClear();
    }
    return accepted;
  };

  const consumeAllowance = () => {
    if (!allowance) return false;
    allowance = 0;
    return true;
  };

  const guardNavigation = (original) => function guardedNavigation(...args) {
    const state = guardState(getState);
    if ((state.dirty || state.busy) && !consumeAllowance()) {
      if (!confirmLeave()) return undefined;
      consumeAllowance();
    }
    const result = original.apply(navigator, args);
    currentIndex = historyIndex(targetWindow) ?? currentIndex;
    return result;
  };

  const originalPush = navigator?.push;
  const originalReplace = navigator?.replace;
  const guardedPush = typeof originalPush === 'function' ? guardNavigation(originalPush) : null;
  const guardedReplace = typeof originalReplace === 'function' ? guardNavigation(originalReplace) : null;
  if (guardedPush) navigator.push = guardedPush;
  if (guardedReplace) navigator.replace = guardedReplace;

  const onBeforeUnload = (event) => {
    const state = guardState(getState);
    if (!state.dirty && !state.busy) return;
    event.preventDefault();
    event.returnValue = '';
  };

  const onPopState = (event) => {
    const nextIndex = Number.isInteger(event.state?.idx) ? event.state.idx : historyIndex(targetWindow);
    if (restoringPop) {
      restoringPop = false;
      currentIndex = nextIndex ?? currentIndex;
      event.stopImmediatePropagation();
      return;
    }
    const state = guardState(getState);
    if (!state.dirty && !state.busy) {
      currentIndex = nextIndex ?? currentIndex;
      return;
    }
    if (consumeAllowance() || confirmLeave()) {
      consumeAllowance();
      currentIndex = nextIndex ?? currentIndex;
      return;
    }
    event.stopImmediatePropagation();
    event.preventDefault?.();
    if (currentIndex == null || nextIndex == null || currentIndex === nextIndex) return;
    restoringPop = true;
    try {
      targetWindow.history.go(currentIndex - nextIndex);
    } catch (error) {
      restoringPop = false;
      throw error;
    }
  };

  targetWindow.addEventListener('beforeunload', onBeforeUnload);
  targetWindow.addEventListener('popstate', onPopState, true);

  const publish = (eventConfirmLeave = confirmLeave) => {
    const state = guardState(getState);
    targetWindow.dispatchEvent(customEvent(targetWindow, 'fcos:dirty-state', {
      key,
      dirty: state.dirty || state.busy,
      message: state.busy ? BUSY_MESSAGE : DIRTY_MESSAGE,
      confirmLeave: eventConfirmLeave,
    }));
  };

  const cleanup = () => {
    if (!active) return;
    active = false;
    allowance = 0;
    restoringPop = false;
    targetWindow.removeEventListener('beforeunload', onBeforeUnload);
    targetWindow.removeEventListener('popstate', onPopState, true);
    if (guardedPush && navigator.push === guardedPush) navigator.push = originalPush;
    if (guardedReplace && navigator.replace === guardedReplace) navigator.replace = originalReplace;
    targetWindow.dispatchEvent(customEvent(targetWindow, 'fcos:dirty-state', { key, dirty: false }));
  };

  return { confirmLeave, publish, cleanup };
}

export function useSpecialTermUnsavedGuard({ key, dirty, busy }) {
  const navigationContext = useContext(UNSAFE_NavigationContext);
  const navigator = navigationContext?.navigator;
  const stateRef = useRef({ dirty: Boolean(dirty), busy: Boolean(busy) });
  const controllerRef = useRef(null);
  stateRef.current = { dirty: Boolean(dirty), busy: Boolean(busy) };

  const confirmLeave = useCallback(() => controllerRef.current?.confirmLeave() ?? true, []);

  useEffect(() => {
    if (!key || typeof window === 'undefined') return undefined;
    const controller = createSpecialTermUnsavedGuard({
      targetWindow: window,
      navigator,
      key,
      getState: () => stateRef.current,
    });
    controllerRef.current = controller;
    controller.publish(confirmLeave);
    return () => {
      controller.cleanup();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [confirmLeave, key, navigator]);

  useEffect(() => {
    controllerRef.current?.publish(confirmLeave);
  }, [busy, confirmLeave, dirty, key]);

  return confirmLeave;
}

export default useSpecialTermUnsavedGuard;
