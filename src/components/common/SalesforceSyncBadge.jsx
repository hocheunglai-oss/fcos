import { Cloud } from 'lucide-react';
import { useLocation } from 'react-router-dom';
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
  const freshness = useSalesforceFreshness(location.pathname);
  if (!freshness?.fetchedAt) return null;
  const fullTime = salesforceTime(freshness.fetchedAt);
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200', className)}
      title={`Last successful Salesforce data refresh: ${fullTime} Hong Kong time`}
      aria-label={`Last Salesforce sync ${fullTime} Hong Kong time`}
    >
      <Cloud className="h-3 w-3" aria-hidden="true" />
      {compact ? <>SF · {salesforceTime(freshness.fetchedAt, true)}</> : <><span className="sm:hidden">SF · {salesforceTime(freshness.fetchedAt, true)}</span><span className="hidden sm:inline">Salesforce sync · {fullTime}</span></>}
    </span>
  );
}
