import { useCallback, useEffect, useRef } from 'react';
import { appClient } from '@/api/appClient';
import { emailRouter } from '@/lib/emailRouter';

export const EMAIL_ROUTER_BACKGROUND_SYNC_INTERVAL_MS = 30_000;
const EMAIL_ROUTER_BACKGROUND_SYNC_LOCK = 'fcos:email-router-background-sync';
const EMAIL_ROUTER_BACKGROUND_SYNC_CHANNEL = 'fcos:email-router-background-sync-events';
const EMAIL_ROUTER_BACKGROUND_SYNC_SIGNAL = 'mailbox-synchronized';
export const EMAIL_ROUTER_SYNC_STATE_KEY = 'fcos:email-router-sync-state';

function publishSyncState(detail) {
  let prior = {};
  try { prior = JSON.parse(window.localStorage.getItem(EMAIL_ROUTER_SYNC_STATE_KEY) || '{}'); } catch { /* Ignore an invalid prior status snapshot. */ }
  const state = { ...prior, ...detail, observedAt: new Date().toISOString() };
  try { window.localStorage.setItem(EMAIL_ROUTER_SYNC_STATE_KEY, JSON.stringify(state)); } catch { /* Status remains available through the live event. */ }
  window.dispatchEvent(new CustomEvent('fcos:email-router-sync-state', { detail: state }));
  return state;
}

function notifyEmailRouterWorkspace(detail = {}) {
  appClient.functions.invalidateCache({ names: ['emailRouterList', 'emailRouterDetail'] });
  const state = publishSyncState({ ...detail, status: detail.status || 'synchronized', lastSyncedAt: detail.lastSyncedAt || new Date().toISOString() });
  window.dispatchEvent(new CustomEvent('fcos:email-router-synced', { detail: state }));
}

export default function EmailRouterBackgroundSync({ enabled }) {
  const runningRef = useRef(false);
  const lastAttemptAtRef = useRef(0);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!enabled || typeof window.BroadcastChannel !== 'function') return undefined;
    const channel = new window.BroadcastChannel(EMAIL_ROUTER_BACKGROUND_SYNC_CHANNEL);
    const receiveSync = (event) => {
      if (event.data?.type === EMAIL_ROUTER_BACKGROUND_SYNC_SIGNAL) {
        notifyEmailRouterWorkspace({ status: 'synchronized_in_another_tab' });
      }
    };
    channelRef.current = channel;
    channel.addEventListener('message', receiveSync);
    return () => {
      channel.removeEventListener('message', receiveSync);
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [enabled]);

  const synchronize = useCallback(async () => {
    if (!enabled || runningRef.current || document.visibilityState !== 'visible') return;
    runningRef.current = true;
    lastAttemptAtRef.current = Date.now();
    publishSyncState({ status: 'synchronizing', lastAttemptAt: new Date().toISOString() });
    try {
      const run = async () => {
        const response = await emailRouter.backgroundSync({}, { cache: false, force: true });
        if (response.data?.error) {
          publishSyncState({ status: 'failed', lastAttemptAt: new Date().toISOString(), reason: 'Mailbox synchronization is unavailable.' });
          window.dispatchEvent(new CustomEvent('fcos:work-notifications-changed'));
          return;
        }
        notifyEmailRouterWorkspace(response.data);
        channelRef.current?.postMessage({ type: EMAIL_ROUTER_BACKGROUND_SYNC_SIGNAL });
        if (Number(response.data?.failures || 0) > 0) {
          window.dispatchEvent(new CustomEvent('fcos:work-notifications-changed'));
        }
      };
      if (navigator.locks?.request && channelRef.current) {
        await navigator.locks.request(EMAIL_ROUTER_BACKGROUND_SYNC_LOCK, { ifAvailable: true }, async (lock) => {
          if (lock) await run();
        });
      } else {
        await run();
      }
    } catch {
      publishSyncState({ status: 'failed', lastAttemptAt: new Date().toISOString(), reason: 'Mailbox synchronization is unavailable.' });
      window.dispatchEvent(new CustomEvent('fcos:work-notifications-changed'));
    } finally {
      runningRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const requested = () => synchronize();
    window.addEventListener('fcos:email-router-sync-request', requested);
    return () => window.removeEventListener('fcos:email-router-sync-request', requested);
  }, [enabled, synchronize]);

  useEffect(() => {
    if (!enabled) return undefined;
    synchronize();
    const interval = window.setInterval(synchronize, EMAIL_ROUTER_BACKGROUND_SYNC_INTERVAL_MS);
    const catchUp = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAttemptAtRef.current >= EMAIL_ROUTER_BACKGROUND_SYNC_INTERVAL_MS) synchronize();
    };
    window.addEventListener('focus', catchUp);
    document.addEventListener('visibilitychange', catchUp);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', catchUp);
      document.removeEventListener('visibilitychange', catchUp);
    };
  }, [enabled, synchronize]);

  return null;
}
