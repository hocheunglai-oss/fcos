import { Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TradingViewBrentWidget from './TradingViewBrentWidget';

export default function MarketShellBar({ onOpenPulse }) {
  return (
    <div className="shrink-0 border-b border-slate-200/80 bg-white/85 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="ml-auto hidden w-fit items-center gap-2 md:flex">
        <TradingViewBrentWidget className="w-[390px]" height={34} />
      </div>
      <Button type="button" variant="outline" size="sm" className="ml-auto flex h-9 gap-2 md:hidden" onClick={onOpenPulse} aria-label="Open indicative Brent chart in Market Pulse">
        <Activity className="h-3.5 w-3.5 text-blue-600" />
        Brent BRN1! <span className="text-[10px] font-normal text-amber-700">Indicative</span>
      </Button>
    </div>
  );
}
