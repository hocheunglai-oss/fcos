import { useEffect, useMemo, useRef, useState } from 'react';

const DRAFT_PREFIX = 'salesforce_extension:draft:';
const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function storageKey(key) {
  return `${DRAFT_PREFIX}${key}`;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function draftTimestampLabel(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Hong_Kong',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return '';
  }
}

export function readDraft(key, { maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const updatedAt = draft?.updatedAt ? new Date(draft.updatedAt).getTime() : 0;
    if (!updatedAt || Date.now() - updatedAt > maxAgeMs) {
      window.localStorage.removeItem(storageKey(key));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function writeDraft(key, data) {
  if (!key || typeof window === 'undefined') return null;
  const draft = { data, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

export function clearDraft(key) {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // ignore storage failures
  }
}

export function sameDraftValue(a, b) {
  return safeStringify(a) === safeStringify(b);
}

export function useDraftAutosave(key, value, {
  enabled = true,
  dirty = true,
  delay = 700,
  message = 'You have an autosaved draft.',
} = {}) {
  const [savedAt, setSavedAt] = useState(null);
  const serialized = useMemo(() => safeStringify(value), [value]);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [serialized, value]);

  useEffect(() => {
    if (!key || !enabled || !dirty) return undefined;
    const timer = window.setTimeout(() => {
      const draft = writeDraft(key, valueRef.current);
      if (draft?.updatedAt) setSavedAt(draft.updatedAt);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [key, serialized, enabled, dirty, delay]);

  useEffect(() => {
    if (!key) return undefined;
    const detail = { key: `draft:${key}`, dirty: enabled && dirty, message };
    window.dispatchEvent(new CustomEvent('salesforce-extension:dirty-state', { detail }));
    const beforeUnload = (event) => {
      if (!detail.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.dispatchEvent(new CustomEvent('salesforce-extension:dirty-state', {
        detail: { key: `draft:${key}`, dirty: false },
      }));
    };
  }, [key, enabled, dirty, message]);

  return { savedAt };
}
