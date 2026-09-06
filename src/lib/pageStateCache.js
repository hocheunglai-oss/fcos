import { clientSessionKey, clientSessionState, onClientSessionReset } from './clientSessionState.js';

const memoryCache = new Map();
onClientSessionReset(() => memoryCache.clear());

function fallbackValue(fallback) {
  return typeof fallback === 'function' ? fallback() : fallback;
}

export function readPageState(key, fallback = {}) {
  key = clientSessionKey('fcos:page_state:', key);
  if (!key) return fallbackValue(fallback);
  if (memoryCache.has(key)) return memoryCache.get(key);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return fallbackValue(fallback);
    const parsed = JSON.parse(raw);
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    return fallbackValue(fallback);
  }
}

export function writePageState(key, value, expected = clientSessionState()) {
  key = clientSessionKey('fcos:page_state:', key, expected);
  if (!key) return;
  memoryCache.set(key, value);
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Keep the in-memory copy even when browser storage quota is exceeded.
  }
}

export function clearPageState(key) {
  key = clientSessionKey('fcos:page_state:', key);
  if (!key) return;
  memoryCache.delete(key);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore browser storage failures.
  }
}
