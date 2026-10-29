import { useEffect } from 'react';

/** Keep ordinary app navigation and browser unload protection on the existing dirty-state contract. */
export default function useAccessNavigationGuard({ dirty, busy }) {
  useEffect(() => {
    const key = 'people-access';
    window.dispatchEvent(new CustomEvent('fcos:dirty-state', { detail: { key, dirty: dirty || busy, message: busy ? 'An access save is in progress.' : 'People & Access has unsaved changes. Use Save or Cancel before leaving.' } }));
    const beforeUnload = (event) => {
      if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.dispatchEvent(new CustomEvent('fcos:dirty-state', { detail: { key, dirty: false } }));
    };
  }, [dirty, busy]);
}
