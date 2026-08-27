import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/utils';
import { getPageCopy } from '@/lib/pageCopy';
import SalesforceSyncBadge from '@/components/common/SalesforceSyncBadge';
import { useWorkspaceChromeRegistration } from '@/components/workspace/WorkspaceChrome';

export default function PageHeader({ icon: Icon, eyebrow, title, description, meta, status, actions, compact = false, sticky = true, className }) {
  const copy = getPageCopy({ title, eyebrow, description });
  const chrome = useWorkspaceChromeRegistration();
  const registrationId = useId();
  const registration = useRef(null);
  registration.current = { title: copy.title, eyebrow: copy.eyebrow, description: copy.description, meta, status, actions };

  useEffect(() => chrome?.register(registrationId, () => registration.current), [chrome, registrationId]);

  const contextVisible = Boolean(copy.description || meta || status);
  return <>
    <header className={cn(
      'glass-page-header app-page-header z-30 grid min-h-[var(--workspace-toolbar-height)] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 sm:px-4',
      sticky && 'sticky top-0',
      !contextVisible && 'mb-5',
      compact && 'app-page-header--compact',
      className,
    )}>
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && <Icon className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />}
        <div className="min-w-0">
          {copy.eyebrow && <div className="hidden truncate text-[11px] font-medium text-muted-foreground sm:block">{copy.eyebrow}</div>}
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate font-ui text-xl font-semibold leading-[1.625rem] tracking-[-0.01em] text-foreground">{copy.title}</h1>
            <SalesforceSyncBadge />
          </div>
        </div>
      </div>
      {actions && <div className="app-page-header__actions flex max-w-[58vw] items-center gap-2 overflow-x-auto pb-0.5 sm:max-w-[65vw] sm:pb-0">{actions}</div>}
    </header>
    {contextVisible && <div className="app-page-header-context mb-5 grid gap-2 border-x border-b border-border/70 bg-card/80 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        {copy.description && <p className="max-w-4xl leading-5 text-muted-foreground">{copy.description}</p>}
        {meta && <div className="mt-1 text-xs leading-4 text-muted-foreground">{meta}</div>}
      </div>
      {status && <div className="min-w-0 text-xs text-muted-foreground">{status}</div>}
    </div>}
  </>;
}
