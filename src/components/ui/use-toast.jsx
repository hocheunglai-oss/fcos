import { useSyncExternalStore } from 'react';
import { clientSessionState, onClientSessionReset } from '@/lib/clientSessionState';
import { createNotificationStore } from '@/lib/notificationStore';

const notifications = createNotificationStore();
notifications.setScope(clientSessionState());
onClientSessionReset(() => notifications.setScope(clientSessionState()));

const toast = notifications.add;

function useToast() {
  const state = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot, notifications.getSnapshot);
  return { ...state, toast, dismiss: notifications.dismiss, clearAll: notifications.clearAll };
}

export { useToast, toast };
