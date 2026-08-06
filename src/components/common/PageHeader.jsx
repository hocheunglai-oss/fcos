import { cn } from '@/lib/utils';
import { getPageCopy } from '@/lib/pageCopy';

export default function PageHeader({ icon: Icon, eyebrow, title, description, meta, status, actions, compact = false, className }) {
  const copy = getPageCopy({ title, eyebrow, description });

  return (
    <div className={cn(
      'glass-page-header app-page-header mb-6 rounded-lg px-5 py-4',
      compact
        ? 'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-4 py-2.5 lg:grid-cols-[minmax(10rem,0.55fr)_minmax(18rem,1fr)_auto]'
        : status ? 'flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,32rem)_auto] lg:items-center' : 'flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between',
      className,
    )}>
      <div className="min-w-0">
        {(eyebrow || Icon) && (
          <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
            {Icon && <Icon className="h-4 w-4" />}
            {copy.eyebrow && <span>{copy.eyebrow}</span>}
          </div>
        )}
        <h1 className={cn('font-dm font-bold tracking-tight text-foreground', compact ? 'text-lg lg:text-xl' : 'text-2xl')}>{copy.title}</h1>
        {copy.description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{copy.description}</p>}
        {meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}
      </div>
      {status && <div className="min-w-0">{status}</div>}
      {actions && <div className={cn('flex items-center gap-2', compact ? 'col-span-2 flex-nowrap overflow-x-auto pb-0.5 lg:col-span-1 lg:overflow-visible lg:pb-0' : 'flex-wrap')}>{actions}</div>}
    </div>
  );
}
