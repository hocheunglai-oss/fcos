import { Cloud, ExternalLink } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useSalesforceFreshness } from '@/lib/salesforceFreshness';

function salesforceTime(value, compact = false) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', compact
    ? { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong' }).format(date);
}

export default function SalesforceSyncBadge({ className, compact = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const freshness = useSalesforceFreshness(location.pathname);
  if (!freshness?.fetchedAt) return null;
  const fullTime = salesforceTime(freshness.fetchedAt);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-sky-800 transition-colors hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200', className)}
          aria-label={`Last Salesforce sync ${fullTime} Hong Kong time. Open source details.`}
        >
          <Cloud className="h-3 w-3" aria-hidden="true" />
          {compact ? <>SF · {salesforceTime(freshness.fetchedAt, true)}</> : <><span className="sm:hidden">SF · {salesforceTime(freshness.fetchedAt, true)}</span><span className="hidden sm:inline">Salesforce sync · {fullTime}</span></>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,22rem)] p-4">
        <div className="text-sm font-semibold">Salesforce source freshness</div>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Last successful read</dt><dd className="text-right font-medium tabular-nums">{fullTime} HKT</dd>
          <dt className="text-muted-foreground">Workspace</dt><dd className="truncate text-right font-medium">{location.pathname}</dd>
          <dt className="text-muted-foreground">Data handler</dt><dd className="truncate text-right font-data text-[11px]">{freshness.handler || 'Salesforce-backed request'}</dd>
        </dl>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">This is the most recent successful Salesforce-backed response used on this page. Individual figures may have additional calculation evidence.</p>
        <Button type="button" variant="outline" size="sm" className="mt-3 w-full justify-between" onClick={() => navigate('/settings?section=health')}>
          Open System Health <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </PopoverContent>
    </Popover>
  );
}
