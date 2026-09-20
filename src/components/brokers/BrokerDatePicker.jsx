import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeIsoDate(value) {
  const candidate = typeof value === 'string' ? value.slice(0, 10) : '';
  const match = ISO_DATE_PATTERN.exec(candidate);
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? candidate
    : '';
}

export default function BrokerDatePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
  'aria-label': ariaLabel,
  ...props
}) {
  const isoValue = normalizeIsoDate(value);
  const clearLabel = ariaLabel ? `Clear ${ariaLabel}` : 'Clear date';

  return <div className="relative">
    <Input
      {...props}
      type="date"
      value={isoValue}
      onChange={(event) => onChange?.(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn('pr-10', className)}
    />
    {isoValue && !disabled ? <button
      type="button"
      className="absolute right-1 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      aria-label={clearLabel}
      onClick={() => onChange?.('')}
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </button> : null}
  </div>;
}
