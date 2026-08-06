import { useCallback, useEffect, useRef } from 'react';
import { appClient } from '@/api/appClient';
import { emailRouter } from '@/lib/emailRouter';

export const EMAIL_ROUTER_BACKGROUND_SYNC_INTERVAL_MS = 30_000;

export default function EmailRouterBackgroundSync({ enabled }) {
  const runningRef = useRef(false);
  const lastAttemptAtRef = useRef(0);

  const synchronize = useCallback(async () => {
    if (!enabled || runningRef.current) return;
    runningRef.current = true;
    lastAttemptAtRef.current = Date.now();
    try {
      const response = await emailRouter.backgroundSync({}, { cache: false, force: true });
      if (response.data?.error) {
        window.dispatchEvent(new CustomEvent('fcos:work-notifications-changed'));
        return;
      }
      // Another user or tab may have won the shared mailbox sync claim. Refresh
      // every open Email Router list so that claimant-local change counts cannot
      // leave other users looking at stale mail.
      appClient.functions.invalidateCache({ names: ['emailRouterList', 'emailRouterDetail'] });
      window.dispatchEvent(new CustomEvent('fcos:email-router-synced', { detail: response.data }));
      if (Number(response.data?.failures || 0) > 0) {
        window.dispatchEvent(new CustomEvent('fcos:work-notifications-changed'));
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
      if (Date.now() - lastAttemptAtRef.current >= EMAIL_ROUTER_BACKGROUND_SYNC_INTERVAL_MS) synchronize();
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
