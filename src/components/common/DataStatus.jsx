import { CircleCheck, Clock3, CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

function formattedTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function dataStatusFromMeta(meta, explicitState) {
  if (explicitState) return explicitState;
  const status = String(meta?.cacheStatus || '').toUpperCase();
  if (status === 'UNAVAILABLE') return 'unavailable';
  if (status === 'HIT') return 'cached';
  if (['MISS', 'BYPASS', 'SKIP', 'SKIPPED'].includes(status)) return 'live';
  return meta ? 'live' : 'unknown';
}

const STATUS = {
  live: {
    label: 'Live',
    icon: CircleCheck,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  cached: {
    label: 'Cached',
    icon: Clock3,
    className: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  pending: {
    label: 'Pending Salesforce posting',
    icon: RefreshCw,
    className: 'border-amber-200 bg-amber-50 text-amber-900',
  },
  refreshing: {
    label: 'Refreshing',
    icon: RefreshCw,
    className: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  unavailable: {
    label: 'Unavailable',
    icon: CloudOff,
    className: 'border-red-200 bg-red-50 text-red-800',
  },
  unknown: {
    label: 'Not checked',
    icon: Clock3,
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  },
};

export default function DataStatus({ meta, state, label = 'Data', className }) {
  const key = dataStatusFromMeta(meta, state);
  const definition = STATUS[key] || STATUS.unknown;
  const Icon = definition.icon;
  const time = formattedTime(meta?.cachedAt);
  const details = [
    `${label}: ${definition.label}`,
    time ? `retrieved ${time} Hong Kong time` : '',
    Number.isFinite(meta?.salesforceCalls) ? `${meta.salesforceCalls} Salesforce quota call${meta.salesforceCalls === 1 ? '' : 's'}` : '',
    meta?.requestId ? `diagnostic reference ${meta.requestId}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <span
      className={cn('inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold', definition.className, className)}
      title={details}
      aria-label={details}
    >
      <Icon className={cn('h-3.5 w-3.5', ['pending', 'refreshing'].includes(key) && 'animate-spin')} />
      <span>{label} · {definition.label}</span>
      {time ? <span className="font-normal opacity-80">· {time}</span> : null}
    </span>
  );
}
