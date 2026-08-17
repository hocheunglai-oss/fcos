import { AlertTriangle, ArrowRight, CircleDollarSign, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

function money(value, currency) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${currency || 'USD'} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Unavailable';
}

export default function DashboardAttention({ analytics, onStemClick, onOpenStems }) {
  const attention = analytics?.attention;
  if (!attention) return null;
  const losses = attention.lossMaking || [];
  const disputes = attention.disputed || [];
  if (!losses.length && !disputes.length && !attention.incomplete && !(attention.warnings || []).length) return null;
  return <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4" aria-labelledby="dashboard-attention-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="dashboard-attention-title" className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-amber-700" />Needs attention</h2><p className="mt-1 text-xs text-muted-foreground">Ranked exceptions from the complete filtered Salesforce scope.</p></div>{onOpenStems ? <Button type="button" size="sm" variant="outline" onClick={onOpenStems}>Open STEMs<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button> : null}</div>
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      {losses.length ? <div className="rounded-lg border border-red-200 bg-background p-3"><div className="flex items-center gap-2 text-xs font-semibold uppercase text-red-800"><CircleDollarSign className="h-4 w-4" />Largest losses</div><div className="mt-2 space-y-1.5">{losses.map((row) => <button type="button" key={row.stemId} onClick={() => onStemClick?.(row.stemId)} className="flex w-full items-center justify-between gap-3 rounded px-1 py-1 text-left text-xs hover:bg-red-50"><span className="font-semibold text-primary">{row.stemName}</span><span className="tabular-nums text-red-700">{money(row.grossProfit, row.currency)}</span></button>)}</div></div> : null}
      {disputes.length ? <div className="rounded-lg border border-amber-200 bg-background p-3"><div className="flex items-center gap-2 text-xs font-semibold uppercase text-amber-800"><ShieldAlert className="h-4 w-4" />Recent disputes</div><div className="mt-2 space-y-1.5">{disputes.map((row) => <button type="button" key={row.stemId} onClick={() => onStemClick?.(row.stemId)} className="flex w-full items-center justify-between gap-3 rounded px-1 py-1 text-left text-xs hover:bg-amber-50"><span className="font-semibold text-primary">{row.stemName}</span><span className="truncate text-muted-foreground">{row.accountName || 'Account unavailable'}</span></button>)}</div></div> : null}
    </div>
    {attention.incomplete || attention.warnings?.length ? <div className="mt-3 text-xs text-amber-900">{attention.incomplete ? 'Financial exception ranking is incomplete; narrow the filters before relying on totals. ' : ''}{attention.warnings?.[0] || ''}</div> : null}
  </section>;
}
