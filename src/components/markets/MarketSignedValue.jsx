import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatMarketSignedNumber,
  marketSignedTextParts,
  marketSignedTone,
} from '@/hedge/lib/marketSignedValues';
import './MarketSignedValue.css';

function directionMeta(value) {
  const tone = marketSignedTone(value);
  if (tone === 'up') return { Icon: TrendingUp, label: 'Up' };
  if (tone === 'down') return { Icon: TrendingDown, label: 'Down' };
  return { Icon: ArrowRight, label: 'Unchanged' };
}

export function MarketSignedValue({
  value,
  unit = '',
  digits = String(unit).toUpperCase() === 'USD/BBL' ? 3 : 2,
  suffix = '',
  unavailableLabel = 'Unavailable',
  variant = 'plain',
  className,
}) {
  const formatted = formatMarketSignedNumber(value, { digits });
  const tone = marketSignedTone(value);
  const { Icon, label } = directionMeta(value);

  if (formatted == null) {
    return <span className={cn('market-signed-value market-signed-value--neutral', variant === 'pill' && 'market-signed-value--pill', className)}>{unavailableLabel}</span>;
  }

  return (
    <span
      className={cn('market-signed-value', `market-signed-value--${tone}`, variant === 'pill' && 'market-signed-value--pill', className)}
      aria-label={`${label} ${Math.abs(Number(value)).toFixed(digits)}${unit ? ` ${unit}` : ''}${suffix ? ` ${suffix}` : ''}`}
    >
      <span className="market-signed-value__amount"><Icon aria-hidden="true" />{formatted}</span>
      {unit || suffix ? <span className="market-signed-value__context">{[unit, suffix].filter(Boolean).join(' ')}</span> : null}
    </span>
  );
}

export function MarketSignedText({ children, className }) {
  return <span className={className}>{marketSignedTextParts(children).map((part, index) => part.type === 'signed'
    ? <span key={`${part.value}:${index}`} className={`market-signed-token market-signed-token--${part.tone}`}>{part.value}</span>
    : part.value)}</span>;
}

export function MarketSignedAxisTick({ x, y, payload, digits = 0 }) {
  const value = Number(payload?.value);
  const formatted = formatMarketSignedNumber(value, { digits }) ?? '—';
  return <text x={x} y={y} dy={4} textAnchor="end" className={`market-signed-axis-tick market-signed-axis-tick--${marketSignedTone(value)}`}>{formatted}</text>;
}
