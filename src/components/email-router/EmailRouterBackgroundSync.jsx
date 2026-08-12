import { useCallback, useEffect, useRef } from 'react';
import { appClient } from '@/api/appClient';
import { emailRouter } from '@/lib/emailRouter';

export const EMAIL_ROUTER_BACKGROUND_SYNC_INTERVAL_MS = 30_000;
const EMAIL_ROUTER_BACKGROUND_SYNC_LOCK = 'fcos:email-router-background-sync';
const EMAIL_ROUTER_BACKGROUND_SYNC_CHANNEL = 'fcos:email-router-background-sync-events';
const EMAIL_ROUTER_BACKGROUND_SYNC_SIGNAL = 'mailbox-synchronized';

function notifyEmailRouterWorkspace(detail = {}) {
  appClient.functions.invalidateCache({ names: ['emailRouterList', 'emailRouterDetail'] });
  window.dispatchEvent(new CustomEvent('fcos:email-router-synced', { detail }));
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
    try {
      const run = async () => {
        const response = await emailRouter.backgroundSync({}, { cache: false, force: true });
        if (response.data?.error) {
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
    } finally {
      runningRef.current = false;
    }
  }, [enabled]);

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
