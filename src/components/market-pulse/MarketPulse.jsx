import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { loadMarketPulseSnapshot } from '@/hedge/api/marketData';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

const REGIME_CLASSES = {
  backwardation: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  contango: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  flat: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  mixed: 'bg-violet-50 text-violet-800 ring-violet-600/20',
  unavailable: 'bg-slate-100 text-slate-500 ring-slate-400/20',
};

function formatMarketValue(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  return `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}`;
}

function formatSpread(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  const amount = Number(value);
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${sign}${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}`;
}

function comparisonTone(change) {
  const amount = Number(change);
  if (!Number.isFinite(amount) || amount === 0) return 'text-slate-500';
  return amount > 0 ? 'text-blue-700' : 'text-red-700';
}

function PublishedComparison({ comparison }) {
  if (!comparison?.available) return <div className="mt-1 text-[10px] text-slate-500">No prior comparison</div>;
  const change = Number(comparison.change);
  const direction = change > 0 ? 'Up' : change < 0 ? 'Down' : 'Unchanged';
  return (
    <div
      className={cn('mt-1 text-[10px] font-medium', comparisonTone(change))}
      aria-label={`${direction} ${Math.abs(change).toFixed(2)} ${comparison.unit} compared with ${formatDate(comparison.previousDate)}`}
    >
      {formatSpread(change, comparison.unit)} vs {formatDate(comparison.previousDate)}
    </div>
  );
}

function formatDate(value) {
  if (!value) return 'No publication';
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function formatTimestamp(value) {
  if (!value) return 'time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong', timeZoneName: 'short',
  }).format(date);
}

function PulseBody({ data, error, loading, updating, onRefresh, onOpenMarkets }) {
  const reportLabel = data?.curveReportDate ? `Curve report ${formatDate(data.curveReportDate)}` : 'Curve report unavailable';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-950">Market Pulse</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">Latest MOPS, month estimate and prompt structure</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRefresh} disabled={loading || updating} aria-label="Refresh Market Pulse" title="Refresh Market Pulse">
          <RefreshCw className={cn('h-3.5 w-3.5', updating && 'animate-spin')} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && !data ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Market Pulse
          </div>
        ) : error && !data ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <div className="flex gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>
          </div>
        ) : data ? (
          <div className="space-y-3">
            {error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900" role="alert">
                The latest refresh failed. Showing the previously loaded Market Pulse. {error}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
              <span>MOPS {formatDate(data.latestMopsPublicationDate)}</span>
              <span aria-hidden="true">·</span>
              <span>{reportLabel}</span>
              {data.meta?.cache && <><span aria-hidden="true">·</span><span>{data.meta.cache === 'hit' ? 'Cached' : 'Updated'}</span></>}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-medium">
              <span className={cn('rounded-full px-2 py-0.5 ring-1 ring-inset', data.reportCompleteness?.complete ? 'bg-emerald-50 text-emerald-800 ring-emerald-600/20' : 'bg-amber-50 text-amber-800 ring-amber-600/20')}>
                {data.reportCompleteness?.completeReports || 0}/{data.reportCompleteness?.requiredReports || 2} reports
              </span>
              <span className={cn('rounded-full px-2 py-0.5 ring-1 ring-inset', data.curveCompleteness?.evidenceComplete ? 'bg-blue-50 text-blue-800 ring-blue-600/20' : 'bg-amber-50 text-amber-800 ring-amber-600/20')}>
                {data.curveCompleteness?.numericMarks || 0}/{data.curveCompleteness?.requiredMarks || 8} numeric curve marks
              </span>
              {data.curveCompleteness?.publishedNa > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 ring-1 ring-inset ring-slate-500/20">{data.curveCompleteness.publishedNa} published N/A</span>}
            </div>

            {data.intraday ? <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><div className="text-xs font-semibold">Intraday paper · Provisional</div><div className="mt-0.5 text-[10px] text-amber-800">{data.intraday.sourceLabel} · {formatDate(data.intraday.marketDate)} · received {formatTimestamp(data.intraday.receivedAt)}</div></div>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-semibold ring-1 ring-inset ring-amber-500/30">Official MOPS unchanged</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {(data.intraday.observations || []).slice(0, 8).map((row) => <div key={`${row.productKey}:${row.contractMonth}:${row.quoteState}`} className="rounded-md bg-white/70 px-2 py-1.5">
                  <div className="text-[10px] font-semibold">{row.productLabel} · {String(row.contractMonth).slice(0, 7)}</div>
                  <div className="text-[11px]">{formatMarketValue(row.price, row.unit)}</div>
                  <div className="text-[9px] text-amber-800">{row.reportedChange == null ? 'No supplied prior-close change' : `${formatSpread(row.reportedChange, row.unit)} vs prior close`}</div>
                </div>)}
              </div>
            </section> : null}

            <div className="space-y-2">
              {(data.products || []).map((product) => (
                <article key={product.productKey} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{product.productName} <span className="font-normal text-slate-500">({product.sourceCode})</span></div>
                      <div className="mt-0.5 text-[11px] text-slate-500">Published {formatDate(product.latestMops?.publicationDate)}</div>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ring-1 ring-inset', REGIME_CLASSES[product.curve?.status] || REGIME_CLASSES.unavailable)}>
                      {product.curve?.status || 'unavailable'}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-md bg-slate-50 px-2.5 py-2">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Latest MOPS</div>
                      <div className="mt-0.5 text-sm font-semibold text-slate-950">{formatMarketValue(product.latestMops?.value, product.unit)}</div>
                      <PublishedComparison comparison={product.latestMops?.comparison} />
                    </div>
                    <div className="rounded-md bg-blue-50 px-2.5 py-2">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-blue-600">Est. {data.currentMonth} average</div>
                      <div className="mt-0.5 text-sm font-semibold text-blue-950">{formatMarketValue(product.monthlyEstimate?.value, product.unit)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(product.curve?.spreads || []).map((spread) => (
                      <span key={spread.key} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                        <span className="font-medium">{spread.label}</span> {formatSpread(spread.value, spread.unit)}
                        <PublishedComparison comparison={spread.comparison} />
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            {(data.warnings || []).length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                <div className="mb-1.5 flex items-center gap-1.5 font-semibold"><TriangleAlert className="h-3.5 w-3.5" />Data notes</div>
                <ul className="space-y-1 pl-4">
                  {data.warnings.map((warning) => <li key={warning} className="list-disc">{warning}</li>)}
                </ul>
              </div>
            )}
            <div className="text-[10px] leading-relaxed text-slate-500">
              Positive front-minus-back is backwardation; negative is contango. Missing marks are not inferred.
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end border-t border-slate-200 px-4 py-3">
        <Button type="button" size="sm" className="gap-1.5" onClick={onOpenMarkets}>
          Open Markets <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function MarketPulse({ open, onOpenChange, triggerClassName }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ force = false } = {}) => {
    if (force) setUpdating(true);
    else setLoading(true);
    setError('');
    try {
      setData(await loadMarketPulseSnapshot({ force }));
    } catch (loadError) {
      setError(loadError?.message || 'Market Pulse is temporarily unavailable.');
    } finally {
      setLoading(false);
      setUpdating(false);
    }
  }, []);

  useEffect(() => {
    if (open && !data && !loading && !error) load();
  }, [data, error, load, loading, open]);

  const openMarkets = () => {
    onOpenChange(false);
    navigate('/markets');
  };
  const body = (
    <PulseBody data={data} error={error} loading={loading} updating={updating} onRefresh={() => load({ force: true })} onOpenMarkets={openMarkets} />
  );
  const trigger = (
    <Button type="button" variant="ghost" size="icon" className={cn('h-8 w-8 shrink-0 text-slate-600 hover:bg-slate-100 hover:text-slate-950', triggerClassName)} aria-label="Open Market Pulse" title="Market Pulse">
      <Activity className="h-4 w-4" />
    </Button>
  );

  if (isMobile) return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="h-[min(90vh,780px)] p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Market Pulse</SheetTitle>
          <SheetDescription>Latest FCOS MOPS and curve snapshot.</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={10} className="flex max-h-[calc(100dvh-72px)] w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden p-0">
        {body}
      </PopoverContent>
    </Popover>
  );
}
