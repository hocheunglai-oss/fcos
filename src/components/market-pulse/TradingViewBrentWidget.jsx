import { ExternalLink, LineChart, TriangleAlert } from 'lucide-react';
import { TRADINGVIEW_BRENT_SYMBOL } from '../../../shared/brentMarketModel.js';
import { cn } from '@/lib/utils';

const TRADINGVIEW_BRENT_URL = 'https://www.tradingview.com/symbols/ICEEUR-BRN1!/?utm_source=fcos&utm_medium=market_pulse';
const ALLOWED_TRADINGVIEW_ORIGIN = 'https://www.tradingview.com';

export default function TradingViewBrentWidget({ className, height = 76 }) {
  const providerUrl = new URL(TRADINGVIEW_BRENT_URL);
  const safeUrl = providerUrl.origin === ALLOWED_TRADINGVIEW_ORIGIN ? providerUrl.toString() : null;

  return (
    <section className={cn('min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm', className)} aria-label="Front-month ICE Brent status">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1">
        <span className="truncate text-[11px] font-semibold text-slate-800">Front-month ICE Brent (BRN1!)</span>
        <span className="shrink-0 text-[9px] font-medium text-amber-700">Indicative · provider delay may apply</span>
      </div>
      <div className="flex items-center gap-2.5 px-3 text-[11px] text-slate-600" style={{ height }} role="status">
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700">
          <LineChart className="h-4 w-4" />
          <TriangleAlert className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-white" />
        </span>
        <span className="min-w-0 flex-1 leading-snug">The exact ICE Brent symbol is not permitted in TradingView website widgets.</span>
        {safeUrl && <a href={safeUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-semibold text-blue-700 hover:text-blue-900">
          View {TRADINGVIEW_BRENT_SYMBOL.replace('ICEEUR:', '')} <ExternalLink className="h-3 w-3" />
        </a>}
      </div>
      <div className="border-t border-slate-100 px-2.5 py-1 text-[9px] leading-tight text-slate-500">
        TradingView link only. Not used by FCOS calculations and does not follow the Singapore 16:30 cutoff.
      </div>
    </section>
  );
}
