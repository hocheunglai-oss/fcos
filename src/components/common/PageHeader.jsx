import { cn } from '@/lib/utils';
import { getPageCopy } from '@/lib/pageCopy';

export default function PageHeader({ icon: Icon, eyebrow, title, description, meta, actions, className }) {
  const copy = getPageCopy({ title, eyebrow, description });

  return (
    <div className={cn('glass-page-header app-page-header mb-6 flex flex-col gap-4 rounded-2xl px-5 py-4 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="min-w-0">
        {(eyebrow || Icon) && (
          <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
            {Icon && <Icon className="h-4 w-4" />}
            {copy.eyebrow && <span>{copy.eyebrow}</span>}
          </div>
        )}
        <h1 className="font-dm text-2xl font-bold tracking-tight text-foreground">{copy.title}</h1>
        {copy.description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{copy.description}</p>}
        {meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
