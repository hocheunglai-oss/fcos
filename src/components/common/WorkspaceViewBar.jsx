import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function WorkspaceViewBar({
  views = [],
  value,
  onValueChange,
  status,
  trailing,
  sticky = false,
  className,
}) {
  return (
    <div
      className={cn(
        'app-navigation-material flex items-center gap-3 overflow-x-auto rounded-[var(--radius-control)] border border-border px-3 py-2.5 sm:justify-between',
        sticky && 'sticky top-0 z-30 rounded-none border-x-0 border-t-0',
        className,
      )}
      role="region"
      aria-label="Workspace views"
    >
      <div className="flex min-w-max items-center gap-1" role="tablist" aria-label="Workspace views">
        {views.map((view) => {
          const Icon = view.icon;
          const selected = value === view.id;
          return (
            <Button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={selected}
              variant={selected ? 'default' : 'ghost'}
              size="sm"
              className="min-h-8 shrink-0 gap-1.5 px-2.5 text-xs"
              disabled={view.disabled}
              title={view.title}
              onClick={() => onValueChange?.(view.id)}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
              {view.label}
              {Number.isFinite(view.count) ? (
                <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 justify-center px-1.5 text-[10px]">
                  {view.count.toLocaleString()}
                </Badge>
              ) : null}
            </Button>
          );
        })}
      </div>
      {(status || trailing) ? (
        <div className="flex shrink-0 items-center gap-2">
          {status}
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
