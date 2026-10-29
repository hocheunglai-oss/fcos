import { useToast } from "@/components/ui/use-toast";
import { useState } from 'react';
import NotificationHistory from '@/components/NotificationHistory';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
} from "@/components/ui/toast";

export function Toaster() {
  const { toasts, history, dismiss, clearAll } = useToast();
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
    <ToastProvider aria-label="Popup notifications" hidden={historyOpen}>
      {toasts.map(function ({ id, title, description, action, createdAt: _createdAt, open: _open, onOpenChange: _onOpenChange, duration: _duration, ...props }) {
        return (
          <Toast key={id} {...props} role="status" aria-live="polite" aria-atomic="true">
            <div className="grid min-w-0 gap-1 break-words [overflow-wrap:anywhere]">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose aria-label="Close notification" onClick={() => dismiss(id)} />
          </Toast>
        );
      })}
    </ToastProvider>
    <NotificationHistory history={history} onClearAll={clearAll} open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  );
} 
