import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, Check, CheckCheck, Clock3, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 60_000;
const NOTIFICATION_LIMIT = 40;

const SOURCE_LABELS = {
  collaboration: "Projects & Tasks",
  projects_tasks: "Projects & Tasks",
  projects: "Projects & Tasks",
  growth_coaching: "Growth & Coaching",
  growth: "Growth & Coaching",
  coaching: "Growth & Coaching",
  email_router: "Email Router",
  system_error: "System",
  system: "System",
};

function formatNotificationTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || "Work";
}

function sourceBadgeClass(source) {
  if (source === "system_error" || source === "system") return "bg-red-50 text-red-900 ring-red-700/10";
  if (source === "email_router") return "bg-amber-50 text-amber-900 ring-amber-700/10";
  return source === "growth_coaching" || source === "growth" || source === "coaching" ? "bg-emerald-50 text-emerald-800 ring-emerald-700/10" : "bg-blue-50 text-blue-800 ring-blue-700/10";
}

export default function WorkNotifications() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unavailableSources, setUnavailableSources] = useState([]);
  const [stateFilter, setStateFilter] = useState("active");
  const [sourceFilter, setSourceFilter] = useState("all");

  const applyResponse = useCallback((data) => {
    setNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
    setUnreadCount(Number(data?.unreadCount || 0));
    setUnavailableSources(Array.isArray(data?.unavailableSources) ? data.unavailableSources : []);
  }, []);

  const loadNotifications = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);

      try {
        const response = await appClient.functions.invoke(
          "workNotificationsList",
          {
            limit: NOTIFICATION_LIMIT,
            state: stateFilter,
            source: sourceFilter,
          },
          { force: true },
        );

        if (response.data?.error) {
          setUnavailableSources(["Notifications"]);
        } else {
          applyResponse(response.data);
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [applyResponse, sourceFilter, stateFilter],
  );

  useEffect(() => {
    loadNotifications({ quiet: true });

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadNotifications({ quiet: true });
      }
    }, REFRESH_INTERVAL_MS);
    const handleChanged = () => loadNotifications({ quiet: true });
    window.addEventListener("fcos:work-notifications-changed", handleChanged);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("fcos:work-notifications-changed", handleChanged);
    };
  }, [loadNotifications]);

  const markRead = useCallback(
    async (notificationIds) => {
      setUpdating(true);
      try {
        const response = await appClient.functions.invoke("workNotificationsRead", notificationIds ? { notificationIds } : {}, { force: true });
        if (!response.data?.error) applyResponse(response.data);
      } finally {
        setUpdating(false);
      }
    },
    [applyResponse],
  );

  const openNotification = async (notification) => {
    if (!notification.readAt) await markRead([notification.id]);
    setOpen(false);
    if (typeof notification.link === "string" && notification.link) {
      navigate(notification.link);
    }
  };

  const updateNotification = useCallback(
    async (notification, state) => {
      setUpdating(true);
      try {
        const snoozedUntil = state === "snoozed" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined;
        const response = await appClient.functions.invoke(
          "workNotificationsState",
          {
            notificationIds: [notification.id],
            state,
            snoozedUntil,
            listState: stateFilter,
            source: sourceFilter,
            limit: NOTIFICATION_LIMIT,
          },
          { force: true },
        );
        if (!response.data?.error) applyResponse(response.data);
      } finally {
        setUpdating(false);
      }
    },
    [applyResponse, sourceFilter, stateFilter],
  );

  const unavailableLabel = unavailableSources.map(sourceLabel).join(", ");
  const hasUnavailableSources = unavailableSources.length > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadNotifications();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="relative h-8 w-8 shrink-0 text-slate-600 hover:bg-slate-100 hover:text-slate-950" aria-label={unreadCount ? `${unreadCount} unread work notifications` : "Work notifications"} title={hasUnavailableSources ? "Some work notifications are temporarily unavailable" : "Work notifications"}>
          {unreadCount ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
          {hasUnavailableSources && <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-white bg-amber-500" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[calc(100vw-24px)] max-w-[400px] p-0">
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Notifications</div>
            <div className="text-xs text-muted-foreground">{unreadCount.toLocaleString()} unread</div>
          </div>
          {unreadCount > 0 && (
            <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={updating} onClick={() => markRead()}>
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        <div className="space-y-2 border-b border-border px-3 py-2.5">
          <div className="grid grid-cols-4 gap-1 rounded-md bg-muted p-1">
            {[
              ["active", "Active"],
              ["unread", "Unread"],
              ["snoozed", "Snoozed"],
              ["handled", "Handled"],
            ].map(([value, label]) => (
              <Button key={value} type="button" size="sm" variant={stateFilter === value ? "secondary" : "ghost"} className="h-7 px-1 text-[11px]" onClick={() => setStateFilter(value)}>
                {label}
              </Button>
            ))}
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-8 text-xs" aria-label="Filter notification source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All work</SelectItem>
              <SelectItem value="collaboration">Projects & Tasks</SelectItem>
              <SelectItem value="growth_coaching">Growth & Coaching</SelectItem>
              <SelectItem value="email_router">Email Router</SelectItem>
              <SelectItem value="system_error">System errors</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hasUnavailableSources && (
          <div className="flex gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-950">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{unavailableLabel} notifications are temporarily unavailable.</span>
          </div>
        )}

        <ScrollArea className="h-[min(420px,60vh)]">
          {loading && !notifications.length ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading notifications
            </div>
          ) : notifications.length ? (
            <div className="divide-y divide-border">
              {notifications.map((notification) => (
                <div key={notification.id} className={cn("flex items-start gap-1 px-2 py-1.5 transition-colors hover:bg-muted/60", !notification.readAt && "bg-blue-50/70")}>
                  <button type="button" className="flex min-w-0 flex-1 items-start gap-3 px-2 py-1.5 text-left" onClick={() => openNotification(notification)}>
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", notification.readAt ? "bg-slate-300" : "bg-blue-600")} />
                    <span className="min-w-0 flex-1">
                      <span className="mb-1 flex flex-wrap items-center gap-2">
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset", sourceBadgeClass(notification.source))}>{sourceLabel(notification.source)}</span>
                        <span className="text-[11px] text-muted-foreground">{formatNotificationTime(notification.createdAt)}</span>
                      </span>
                      <span className="block break-words text-sm font-medium text-foreground">{notification.title}</span>
                      {notification.message && <span className="mt-0.5 line-clamp-2 block break-words text-xs text-muted-foreground">{notification.message}</span>}
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-0.5 pt-1">
                    {stateFilter === "handled" ? (
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Return to active" disabled={updating} onClick={() => updateNotification(notification, "unhandled")}>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    ) : stateFilter === "snoozed" ? (
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Return to active" disabled={updating} onClick={() => updateNotification(notification, "unhandled")}>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Remind me tomorrow" disabled={updating} onClick={() => updateNotification(notification, "snoozed")}>
                          <Clock3 className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Mark handled" disabled={updating} onClick={() => updateNotification(notification, "handled")}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">No work notifications.</div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
