import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 60_000;

function formatNotificationTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function CollaborationNotifications() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  const loadNotifications = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const response = await appClient.functions.invoke(
      "collaborationNotificationsList",
      {
        limit: 40,
      },
      { force: true },
    );
    if (response.data?.error) {
      setUnavailable(true);
    } else {
      setUnavailable(false);
      setNotifications(response.data?.notifications || []);
      setUnreadCount(Number(response.data?.unreadCount || 0));
    }
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => {
    loadNotifications({ quiet: true });
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible")
        loadNotifications({ quiet: true });
    }, REFRESH_INTERVAL_MS);
    const handleChanged = () => loadNotifications({ quiet: true });
    window.addEventListener(
      "fcos:collaboration-notifications-changed",
      handleChanged,
    );
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(
        "fcos:collaboration-notifications-changed",
        handleChanged,
      );
    };
  }, [loadNotifications]);

  const openNotification = async (notification) => {
    if (!notification.readAt) {
      const response = await appClient.functions.invoke(
        "collaborationNotificationsRead",
        {
          notificationIds: [notification.id],
        },
        { force: true },
      );
      if (!response.data?.error) {
        setNotifications(response.data?.notifications || []);
        setUnreadCount(Number(response.data?.unreadCount || 0));
      }
    }
    setOpen(false);
    navigate(`/projects-tasks?item=${encodeURIComponent(notification.itemId)}`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadNotifications();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 shrink-0 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          aria-label={
            unreadCount
              ? `${unreadCount} unread work notifications`
              : "Work notifications"
          }
          title={
            unavailable
              ? "Work notifications are temporarily unavailable"
              : "Work notifications"
          }
        >
          {unreadCount ? (
            <BellRing className="h-4 w-4" />
          ) : (
            <Bell className="h-4 w-4" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          {unavailable && (
            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-white bg-amber-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(380px,calc(100vw-24px))] p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Projects &amp; Tasks</div>
            <div className="text-xs text-muted-foreground">
              {unreadCount.toLocaleString()} unread
            </div>
          </div>
          {unreadCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                const response = await appClient.functions.invoke(
                  "collaborationNotificationsRead",
                  {},
                  { force: true },
                );
                if (!response.data?.error) {
                  setNotifications(response.data?.notifications || []);
                  setUnreadCount(Number(response.data?.unreadCount || 0));
                }
              }}
            >
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[min(420px,60vh)]">
          {loading && !notifications.length ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading notifications
            </div>
          ) : unavailable ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Work notifications are temporarily unavailable. FCOS remains
              usable.
            </div>
          ) : notifications.length ? (
            <div className="divide-y divide-border">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  className={cn(
                    "w-full px-4 py-3 text-left transition-colors hover:bg-muted/60",
                    !notification.readAt && "bg-blue-50/70",
                  )}
                  onClick={() => openNotification(notification)}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        notification.readAt ? "bg-slate-300" : "bg-blue-600",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {notification.title}
                      </span>
                      {notification.message && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          {notification.message}
                        </span>
                      )}
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {formatNotificationTime(notification.createdAt)}
                      </span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No work notifications.
            </div>
          )}
        </ScrollArea>
        <div className="border-t border-border p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setOpen(false);
              navigate("/projects-tasks");
            }}
          >
            Open Projects &amp; Tasks
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
