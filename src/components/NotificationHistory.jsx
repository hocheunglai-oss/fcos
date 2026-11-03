import { TriangleAlert, X, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function formatNotificationTime(value) {
  return `${new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Hong_Kong' })} HKT`;
}

function NotificationEntry({ entry }) {
  const destructive = entry.variant === 'destructive';
  return <li className="notification-entry" data-error={destructive || undefined}>
    <p className="notification-entry-title">{entry.title || 'Notification'}{destructive && <span className="notification-error"><TriangleAlert className="h-3 w-3" aria-hidden="true" />Error</span>}</p>
    {entry.description && <p className="notification-entry-description">{entry.description}</p>}
    <time dateTime={new Date(entry.createdAt).toISOString()}>{formatNotificationTime(entry.createdAt)}</time>
  </li>;
}

export default function NotificationHistory({ history, onClearAll, open, onOpenChange }) {
  const entries = history;
  const count = entries.length;
  const triggerLabel = `Notification history (${count})`;

  return (
    <Popover modal={false} open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="app-market-pulse-trigger app-notification-history-trigger"
          aria-label={triggerLabel}
          title={triggerLabel}
        >
          <span className="notification-bolt" aria-hidden="true">
            <Zap className="h-3.5 w-3.5 fill-current" strokeWidth={2.6} />
            {count > 0 ? (
              <span className="notification-count">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Notification history"
        className="notification-history-panel"
      >
        <div className="notification-history-header">
          <h2 className="text-sm font-semibold text-foreground">Notifications ({count})</h2>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={onClearAll}
              disabled={count === 0}
            >
              Clear all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onOpenChange(false)}
              aria-label="Close notification history"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="notification-history-scroll">
          {count > 0 ? (
            <ol className="space-y-2">
              {entries.map((entry) => (
                <NotificationEntry key={entry.id} entry={entry} />
              ))}
            </ol>
          ) : (
            <div className="notification-empty">
              <p className="mt-3 text-sm font-medium text-foreground">No notifications yet</p>
            </div>
          )}
        </div>

        <p className="notification-history-footer">
          Latest 500 notifications in this tab
        </p>
      </PopoverContent>
    </Popover>
  );
}
