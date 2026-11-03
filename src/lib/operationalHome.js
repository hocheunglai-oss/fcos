import { clientSessionKey } from './clientSessionState.js';
const PREFIX = 'fcos:home:';
export function operationalHome() {
  try { return window.localStorage.getItem(clientSessionKey(PREFIX, 'route')) === '/my-commitments' ? '/my-commitments' : '/'; }
  catch { return '/'; }
}
export function setOperationalHome(route) {
  const key = clientSessionKey(PREFIX, 'route');
  if (!key) return false;
  try { window.localStorage.setItem(key, route === '/my-commitments' ? route : '/'); return true; }
  catch { return false; }
}
