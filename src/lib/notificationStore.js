export const NOTIFICATION_DURATION_MS = 10_000;
export const NOTIFICATION_HISTORY_LIMIT = 500;
const POPUP_LIMIT = 20;

// Retain the message, never callbacks or records captured by actions like Undo.
function textContent(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  return value?.props ? textContent(value.props.children) : '';
}

function historyEntry(toast) {
  return {
    id: toast.id,
    title: textContent(toast.title),
    description: textContent(toast.description),
    variant: toast.variant === 'destructive' ? 'destructive' : 'default',
    createdAt: toast.createdAt,
  };
}

export function createNotificationStore({
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
  getStorage = () => typeof window === 'undefined' ? null : window.sessionStorage,
} = {}) {
  let scope = null;
  let key = null;
  let sequence = 0;
  let state = { toasts: [], history: [] };
  const listeners = new Set();
  const timers = new Map();

  const getSnapshot = () => state;
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  function publish() { listeners.forEach((listener) => listener()); }
  function persist() {
    if (!key) return;
    try { getStorage()?.setItem(key, JSON.stringify(state.history)); } catch { /* Keep in-memory history if storage is unavailable. */ }
  }
  function stopTimer(id) {
    if (timers.has(id)) cancel(timers.get(id));
    timers.delete(id);
  }
  function dismiss(id) {
    const ids = id === undefined ? state.toasts.map((row) => row.id) : [id];
    ids.forEach(stopTimer);
    state = { ...state, toasts: state.toasts.filter((row) => !ids.includes(row.id)) };
    publish();
  }
  function expire(id) {
    stopTimer(id);
    timers.set(id, schedule(() => dismiss(id), NOTIFICATION_DURATION_MS));
  }
  function setScope(nextScope) {
    if (scope === nextScope) return;
    timers.forEach(cancel);
    timers.clear();
    try { if (key) getStorage()?.removeItem(key); } catch { /* Memory reset does not require storage. */ }
    scope = nextScope;
    key = scope?.ownerId ? `fcos:notifications:${encodeURIComponent(scope.ownerId)}:v1` : null;
    let history = [];
    try {
      const stored = key ? JSON.parse(getStorage()?.getItem(key) || '[]') : [];
      if (Array.isArray(stored)) history = stored.filter((row) => row && typeof row.id === 'string'
        && Number.isFinite(row.createdAt) && !Number.isNaN(new Date(row.createdAt).getTime())
        && typeof row.title === 'string' && typeof row.description === 'string')
        .slice(0, NOTIFICATION_HISTORY_LIMIT).map(historyEntry);
    } catch { /* Corrupt history must not prevent notifications. */ }
    state = { toasts: [], history };
    publish();
  }
  function clearAll() {
    timers.forEach(cancel);
    timers.clear();
    state = { toasts: [], history: [] };
    try { if (key) getStorage()?.removeItem(key); } catch { /* In-memory clear still succeeds. */ }
    publish();
  }
  function add(props) {
    const notificationScope = scope;
    const id = `${now()}-${++sequence}`;
    const row = { ...props, id, createdAt: now() };
    const toasts = [row, ...state.toasts].slice(0, POPUP_LIMIT);
    state.toasts.filter((item) => !toasts.includes(item)).forEach((item) => stopTimer(item.id));
    state = { toasts, history: [historyEntry(row), ...state.history].slice(0, NOTIFICATION_HISTORY_LIMIT) };
    persist();
    expire(id);
    publish();
    return {
      id,
      dismiss: () => { if (notificationScope === scope) dismiss(id); },
      update: (changes) => {
        if (notificationScope !== scope || !state.history.some((item) => item.id === id)) return;
        const existing = state.toasts.find((item) => item.id === id) || state.history.find((item) => item.id === id);
        const updated = { ...existing, ...changes, id, createdAt: existing.createdAt };
        state = {
          toasts: state.toasts.map((item) => item.id === id ? updated : item),
          history: state.history.map((item) => item.id === id ? historyEntry(updated) : item),
        };
        if (changes.open === false) dismiss(id);
        else if (state.toasts.some((item) => item.id === id)) expire(id);
        persist();
        publish();
      },
    };
  }
  return { getSnapshot, subscribe, add, dismiss, clearAll, setScope };
}
