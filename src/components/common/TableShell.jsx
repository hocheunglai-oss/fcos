import { cn } from '@/lib/utils';

export default function TableShell({ title, meta, actions, children, className, bodyClassName = 'p-2' }) {
  return (
    <div className={cn('material-panel min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-card shadow-[var(--shadow-panel)]', className)}>
      {(title || meta || actions) && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5 sm:py-3.5">
          <div className="min-w-0 flex-1">
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
          </div>
          {actions && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div>}
        </div>
      )}
      <div className={cn('min-w-0', bodyClassName)}>{children}</div>
    </div>
  );
}
