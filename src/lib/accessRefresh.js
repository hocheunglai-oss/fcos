// Messages only invalidate locally cached access; they never grant permissions.
export const ACCESS_CHANGED_EVENT = 'fcos:access-changed';
const CHANNEL = 'fcos:access-refresh';

function openChannel() {
  try { return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL); }
  catch { return null; }
}

export function notifyAccessChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
  const channel = openChannel();
  if (channel) {
    try { channel.postMessage({ type: 'access-changed' }); }
    catch { /* Focus and timed refresh remain available. */ }
    finally { channel.close(); }
  }
}

export function subscribeAccessRefresh(refresh, target = window, doc = document) {
  const refreshVisible = () => { if (doc.visibilityState !== 'hidden') refresh(); };
  target.addEventListener(ACCESS_CHANGED_EVENT, refreshVisible);
  target.addEventListener('focus', refreshVisible);
  doc.addEventListener('visibilitychange', refreshVisible);
  const timer = target.setInterval(refreshVisible, 60_000);
  const channel = openChannel();
  if (channel) channel.onmessage = (event) => { if (event.data?.type === 'access-changed') refreshVisible(); };
  return () => {
    target.removeEventListener(ACCESS_CHANGED_EVENT, refreshVisible);
    target.removeEventListener('focus', refreshVisible);
    doc.removeEventListener('visibilitychange', refreshVisible);
    target.clearInterval(timer);
    channel?.close();
  };
}
