import { useCallback, useEffect, useRef, useState } from 'react';
import { readPageState, writePageState } from '@/lib/pageStateCache';
import { clientSessionState } from '@/lib/clientSessionState';

export function usePageState(key, fallback) {
  const [state, setState] = useState(() => ({ key, value: readPageState(key, fallback) }));
  const session = useRef(clientSessionState());
  const value = state.key === key ? state.value : readPageState(key, fallback);
  if (state.key !== key) setState({ key, value });
  const setValue = useCallback((next) => setState((previous) => ({ key,
    value: typeof next === 'function' ? next(previous.value) : next })), [key]);
  useEffect(() => { if (state.key === key) writePageState(key, state.value, session.current); }, [key, state]);
  return [value, setValue];
}
