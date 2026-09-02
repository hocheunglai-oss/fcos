import { useEffect, useState } from 'react';

const freshnessByRoute = new Map();
const EVENT_NAME = 'fcos:salesforce-freshness-changed';

function browserRouteKey() {
  if (typeof window === 'undefined') return '';
  return window.location.pathname || '/';
}

export function publishSalesforceFreshness({ fetchedAt, handler, routeKey = browserRouteKey() } = {}) {
  if (typeof window === 'undefined' || !routeKey || !fetchedAt) return;
  const instant = new Date(fetchedAt);
  if (Number.isNaN(instant.getTime())) return;
  const current = freshnessByRoute.get(routeKey);
  const next = { fetchedAt: instant.toISOString(), handler: String(handler || '') };
  if (current?.fetchedAt && new Date(current.fetchedAt).getTime() > instant.getTime()) return;
  freshnessByRoute.set(routeKey, next);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { routeKey, ...next } }));
}

export function useSalesforceFreshness(routeKey) {
  const [value, setValue] = useState(() => freshnessByRoute.get(routeKey) || null);
  useEffect(() => {
    setValue(freshnessByRoute.get(routeKey) || null);
    const update = (event) => {
      if (event.detail?.routeKey === routeKey) setValue(freshnessByRoute.get(routeKey) || null);
    };
    window.addEventListener(EVENT_NAME, update);
    return () => window.removeEventListener(EVENT_NAME, update);
  }, [routeKey]);
  return value;
}
