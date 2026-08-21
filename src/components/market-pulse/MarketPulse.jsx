import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { loadMarketPulseSnapshot } from '@/hedge/api/marketData';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { MarketSignedText, MarketSignedValue } from '@/components/markets/MarketSignedValue';

const REGIME_CLASSES = {
  backwardation: 'bg-violet-50 text-violet-800 ring-violet-600/20',
  contango: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  flat: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  mixed: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  unavailable: 'bg-slate-100 text-slate-500 ring-slate-400/20',
};

function formatMarketValue(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  return `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}`;
}

function PublishedComparison({ comparison }) {
  return <MarketSignedValue
    value={comparison?.available ? comparison.change : null}
    unit={comparison?.unit}
    suffix={comparison?.available ? `vs ${formatDate(comparison.previousDate)}` : ''}
    unavailableLabel="No prior comparison"
    variant="pill"
  />;
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

function ProductRow({ product, currentMonth }) {
  return <article className="grid gap-2 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm sm:grid-cols-[1.25fr_1fr_1fr_1.2fr] sm:items-center">
    <div className="flex min-w-0 items-start justify-between gap-2 sm:block">
      <div><strong className="block text-xs text-slate-950">{product.productName}</strong><span className="text-[9px] text-slate-500">({product.sourceCode}) · {formatDate(product.latestMops?.publicationDate)}</span></div>
      <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold capitalize ring-1 ring-inset sm:mt-1 sm:inline-flex', REGIME_CLASSES[product.curve?.status] || REGIME_CLASSES.unavailable)}>{product.curve?.status || 'unavailable'}</span>
    </div>
    <div className="grid gap-1 rounded-md bg-slate-50 px-2 py-1.5"><span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">Latest MOPS</span><strong className="text-xs text-slate-950">{formatMarketValue(product.latestMops?.value, product.unit)}</strong><PublishedComparison comparison={product.latestMops?.comparison} /></div>
    <div className="grid gap-1 rounded-md bg-blue-50/70 px-2 py-1.5"><span className="text-[8px] font-semibold uppercase tracking-wide text-blue-700">Est. {currentMonth}</span><strong className="text-xs text-slate-950">{formatMarketValue(product.monthlyEstimate?.value, product.unit)}</strong><span className="text-[9px] text-slate-500">Calculated estimate</span></div>
    <div className="grid gap-1">{(product.curve?.spreads || []).map((spread) => <div key={spread.key} className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1"><span className="flex items-center gap-1 text-[9px] font-semibold text-slate-700">{spread.label} <MarketSignedValue value={spread.value} unit={spread.unit} /></span><PublishedComparison comparison={spread.comparison} /></div>)}</div>
  </article>;
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

            <div className="space-y-1.5">{(data.products || []).map((product) => <ProductRow key={product.productKey} product={product} currentMonth={data.currentMonth} />)}</div>

            {data.intraday ? <details className="rounded-lg border border-amber-200 bg-amber-50 text-amber-950"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold"><span>Intraday paper · Provisional</span><span className="text-[9px] font-normal">{formatDate(data.intraday.marketDate)} · Official MOPS unchanged</span></summary><div className="border-t border-amber-200 px-3 py-2"><div className="text-[9px] text-amber-800">{data.intraday.sourceLabel} · received {formatTimestamp(data.intraday.receivedAt)}</div><div className="mt-2 grid grid-cols-2 gap-1.5">{(data.intraday.observations || []).slice(0, 8).map((row) => <div key={`${row.productKey}:${row.contractMonth}:${row.quoteState}`} className="rounded-md bg-white/70 px-2 py-1.5"><div className="text-[10px] font-semibold">{row.productLabel} · {String(row.contractMonth).slice(0, 7)}</div><div className="text-[11px]">{formatMarketValue(row.price, row.unit)}</div><div className="text-[9px] text-amber-800">{row.reportedChange == null ? 'No supplied prior-close change' : <MarketSignedValue value={row.reportedChange} unit={row.unit} suffix="vs prior close" />}</div></div>)}</div></div></details> : null}

            {(data.warnings || []).length > 0 && (
              <details className="rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-950"><summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-semibold"><TriangleAlert className="h-3.5 w-3.5" />Data notes ({data.warnings.length})</summary><ul className="space-y-1 border-t border-amber-200 px-3 py-2 pl-7">{data.warnings.map((warning) => <li key={warning} className="list-disc"><MarketSignedText>{warning}</MarketSignedText></li>)}</ul></details>
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
    <Button type="button" variant="ghost" size="sm" className={cn('h-8 shrink-0 gap-1.5 px-2.5 text-slate-700 hover:bg-slate-100 hover:text-slate-950', triggerClassName)} aria-label="Open Market Pulse" title="Market Pulse">
      <Activity className="h-4 w-4" /><span className="hidden sm:inline">Pulse</span>
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
      <PopoverContent align="end" side="bottom" sideOffset={8} className="flex max-h-[calc(100dvh-24px)] w-[min(640px,calc(100vw-24px))] flex-col overflow-hidden p-0">
        {body}
      </PopoverContent>
    </Popover>
  );
}
