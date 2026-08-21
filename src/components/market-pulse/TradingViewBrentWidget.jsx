import { ExternalLink, LineChart } from 'lucide-react';
import { TRADINGVIEW_BRENT_SYMBOL } from '../../../shared/brentMarketModel.js';
import { cn } from '@/lib/utils';

const TRADINGVIEW_BRENT_URL = 'https://www.tradingview.com/symbols/ICEEUR-BRN1!/?utm_source=fcos&utm_medium=market_pulse';
const ALLOWED_TRADINGVIEW_ORIGIN = 'https://www.tradingview.com';

export default function TradingViewBrentWidget({ className, height = 76 }) {
  const providerUrl = new URL(TRADINGVIEW_BRENT_URL);
  const safeUrl = providerUrl.origin === ALLOWED_TRADINGVIEW_ORIGIN ? providerUrl.toString() : null;
  const shortSymbol = TRADINGVIEW_BRENT_SYMBOL.replace('ICEEUR:', '');

  const openExactChart = (event) => {
    if (!safeUrl || typeof window === 'undefined' || !window.matchMedia('(min-width: 768px)').matches) return;
    const width = Math.min(1080, Math.max(760, Math.round((window.screen?.availWidth || 1440) * 0.68)));
    const height = Math.min(760, Math.max(560, Math.round((window.screen?.availHeight || 900) * 0.76)));
    const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || width) - width - 24);
    const top = Math.max(0, (window.screenY || 0) + 56);
    const popup = window.open('about:blank', 'fcos-ice-brent-chart', `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!popup) return;
    event.preventDefault();
    popup.opener = null;
    popup.location.replace(safeUrl);
    popup.focus();
  };

  return (
    <section className={cn('min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm', className)} aria-label="Front-month ICE Brent external chart">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1">
        <span className="truncate text-[11px] font-semibold text-slate-800">Front-month ICE Brent ({shortSymbol})</span>
        <span className="shrink-0 text-[9px] font-medium text-amber-700">Indicative · provider delay may apply</span>
      </div>
      <div className="flex items-center gap-2.5 px-3 text-[11px] text-slate-600" style={{ height }} role="status">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
          <LineChart className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 leading-snug">Open the exact front-month ICE Brent chart in TradingView.</span>
        {safeUrl && <a href={safeUrl} target="_blank" rel="noreferrer" onClick={openExactChart} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2 py-1 font-semibold text-white hover:bg-blue-700">
          Open chart <ExternalLink className="h-3 w-3" />
        </a>}
      </div>
      <div className="border-t border-slate-100 px-2.5 py-1 text-[9px] leading-tight text-slate-500">
        Opens separately because TradingView blocks this ICE symbol in embedded widgets. Not used by FCOS calculations and does not follow the Singapore 16:30 cutoff.
      </div>
    </section>
  );
}
