import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDraft, readDraft, writeDraft } from '@/lib/draftAutosave';
import { clientSessionState, isCurrentClientSession } from '@/lib/clientSessionState';
import { mergeRecordDraft, sameRecordValue, stableRecordValue } from '@/lib/recordDraft';

// Call open() with authoritative editable values when a record is loaded.
// Flush in effect cleanup and before leaving: a pending debounce must never
// discard the last keystroke. Source versions are metadata, not permissions.
export function useRecordDraft() {
  const active = useRef(null);
  const [state, setState] = useState({ key: null, savedAt: null, recovery: null, dirty: false, storageError: false });
  const persist = useCallback(() => {
    const record = active.current;
    if (!record || !isCurrentClientSession(record.session) || record.recovery) return;
    if (sameRecordValue(record.base, record.values)) {
      if (record.persisted) {
        clearDraft(record.key); record.persisted = null;
        setState({ key: record.key, savedAt: null, recovery: null, dirty: false, storageError: false });
      }
      return;
    }
    const serialized = stableRecordValue(record.values);
    if (record.persisted === serialized) return;
    const saved = writeDraft(record.key, { schema: 1, base: record.base, values: record.values, sourceVersion: record.sourceVersion }, record.session);
    if (saved) record.persisted = serialized;
    setState((previous) => ({ ...previous, savedAt: saved?.updatedAt || null, dirty: true, storageError: !saved }));
  }, []);
  const open = useCallback((key, base, sourceVersion = null) => {
    const previous = active.current;
    // Persist the previous record, including an already-loaded record refresh.
    if (previous && !previous.recovery && !sameRecordValue(previous.base, previous.values)) {
      writeDraft(previous.key, { schema: 1, base: previous.base, values: previous.values, sourceVersion: previous.sourceVersion }, previous.session);
    }
    const saved = readDraft(key);
    const valid = saved?.data?.schema === 1 && saved.data.base && saved.data.values;
    const merged = valid ? mergeRecordDraft(saved.data.base, saved.data.values, base) : null;
    const recovery = merged?.conflicts.length ? { ...merged, savedAt: saved.updatedAt } : null;
    const values = recovery ? base : merged?.value || base;
    active.current = { key, base, values, sourceVersion, recovery, session: clientSessionState() };
    setState({ key, savedAt: saved?.updatedAt || null, recovery, dirty: !sameRecordValue(base, values), storageError: false });
    return values;
  }, []);
  const update = useCallback((values) => {
    if (!active.current) return;
    active.current.values = values;
  }, []);
  const discard = useCallback(() => {
    const record = active.current;
    if (!record || !isCurrentClientSession(record.session)) return null;
    clearDraft(record.key);
    record.values = record.base;
    record.persisted = null;
    record.recovery = null;
    setState({ key: record.key, savedAt: null, recovery: null, dirty: false, storageError: false });
    return record.base;
  }, []);
  const recoverUnchanged = useCallback(() => {
    const record = active.current;
    if (!record?.recovery || !isCurrentClientSession(record.session)) return null;
    // Conflicting fields retain current authoritative values. Users re-enter
    // those changes after reviewing the comparison; never silently overwrite.
    record.values = record.recovery.value;
    record.persisted = null;
    record.recovery = null;
    clearDraft(record.key);
    setState({ key: record.key, savedAt: null, recovery: null, dirty: !sameRecordValue(record.base, record.values), storageError: false });
    persist();
    return record.values;
  }, [persist]);
  const saved = useCallback((values = null) => {
    const record = active.current;
    if (!record || !isCurrentClientSession(record.session)) return;
    if (values) record.values = values;
    record.base = record.values;
    record.persisted = null;
    record.recovery = null;
    clearDraft(record.key);
    setState({ key: record.key, savedAt: null, recovery: null, dirty: false, storageError: false });
  }, []);
  const acknowledge = useCallback((transform) => {
    const record = active.current;
    if (!record || !isCurrentClientSession(record.session)) return;
    record.base = transform(structuredClone(record.base));
    record.values = transform(structuredClone(record.values));
    record.persisted = null;
    record.recovery = null;
    clearDraft(record.key);
    setState({ key: record.key, savedAt: null, recovery: null, dirty: !sameRecordValue(record.base, record.values), storageError: false });
    persist();
  }, [persist]);
  useEffect(() => {
    const key = `record-draft:${state.key || 'form'}`;
    window.dispatchEvent(new CustomEvent('fcos:dirty-state', { detail: { key, dirty: state.dirty || Boolean(state.recovery), message: 'Your edits are kept in a draft on this device.' } }));
    return () => window.dispatchEvent(new CustomEvent('fcos:dirty-state', { detail: { key, dirty: false } }));
  }, [state.key, state.dirty, state.recovery]);
  useEffect(() => {
    const flush = () => persist();
    const beforeUnload = (event) => {
      persist();
      if (active.current && !sameRecordValue(active.current.base, active.current.values)) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', beforeUnload);
    const timer = window.setInterval(flush, 700);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', beforeUnload);
      const record = active.current;
      if (record && !record.recovery && !sameRecordValue(record.base, record.values)) {
        writeDraft(record.key, { schema: 1, base: record.base, values: record.values, sourceVersion: record.sourceVersion }, record.session);
      }
    };
  }, [persist]);
  return { ...state, open, update, persist, discard, recoverUnchanged, saved, acknowledge };
}
