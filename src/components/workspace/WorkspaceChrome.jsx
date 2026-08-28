import { createContext, useCallback, useContext, useMemo, useRef } from 'react';

const WorkspaceChromeContext = createContext(null);

export function WorkspaceChromeProvider({ children }) {
  const registrations = useRef(new Map());
  const register = useCallback((key, getValue) => {
    const value = typeof getValue === 'function' ? getValue() : getValue;
    registrations.current.set(key, getValue);
    if (value?.title) document.title = `${value.title} · FCOS`;
    window.dispatchEvent(new CustomEvent('fcos:workspace-chrome-changed', { detail: value }));
    return () => {
      registrations.current.delete(key);
      if (!registrations.current.size) document.title = 'FCOS';
    };
  }, []);
  const value = useMemo(() => ({ register }), [register]);
  return <WorkspaceChromeContext.Provider value={value}>{children}</WorkspaceChromeContext.Provider>;
}

export function useWorkspaceChromeRegistration() {
  return useContext(WorkspaceChromeContext);
}
