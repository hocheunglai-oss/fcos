import { useState } from 'react';
import { AlertTriangle, Building2, Calculator, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatCard from '@/components/dashboard/StatCard';

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const money = (value, currency) => {
  if (number(value) == null) return '—';
  const safeCurrency = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : null;
  if (!safeCurrency) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number(value));
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0, style: 'currency', currency: safeCurrency, currencyDisplay: 'code' }).format(number(value));
};

function currencyRows(summary) {
  const rows = summary?.financials || summary?.currencyKpis || summary?.financialsByCurrency || summary?.moneyByCurrency || [];
  if (Array.isArray(rows) && rows.length) return rows;
  return [{ currency: summary?.currency || 'USD', turnover: summary?.turnoverTotal ?? summary?.totalBuyer, grossProfit: summary?.totalProfit, receivable: summary?.receivable }];
}

function FinancialCard({ label, field, rows, accent, percent = false }) {
  return <div className="glass-surface rounded-xl border border-border bg-card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><div className="mt-3 space-y-1.5">{rows.filter((row) => number(row[field]) != null).map((row) => <div key={row.currency} className="flex items-baseline justify-between gap-3 text-sm"><span className="text-muted-foreground">{row.currency || 'Unspecified'}</span><span className={`font-semibold tabular-nums ${accent}`}>{percent ? `${number(row[field]).toFixed(1)}%` : money(row[field], row.currency)}</span></div>)}{!rows.some((row) => number(row[field]) != null) ? <span className="text-sm text-muted-foreground">Unavailable</span> : null}</div></div>;
}

const PRODUCT_COLORS = { HSFO: 'bg-teal-600', VLSFO: 'bg-blue-600', LSMGO: 'bg-amber-500' };

function ProductVolumeCard({ productVolume }) {
  if (number(productVolume?.quantity) == null) return null;
  return <div className="glass-surface rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2"><Package className="h-4 w-4 text-cyan-700" /><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product volume</p></div><p className="mt-3 text-xl font-bold tabular-nums">{number(productVolume.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} {productVolume.unitOfMeasure || 'MT'}</p><p className="mt-1 text-xs text-muted-foreground">Ordered quantity before delivery; BDN quantity after actual delivery</p><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">{(productVolume.breakdown || []).map((item) => <span key={`${item.family}:${item.unitOfMeasure}`} className="inline-flex items-center gap-1.5 text-[11px]"><span className={`h-2.5 w-2.5 rounded-sm ${PRODUCT_COLORS[String(item.family).toUpperCase()] || 'bg-slate-500'}`} /><span className="text-muted-foreground">{item.family}</span><strong>{number(item.quantity)?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {item.unitOfMeasure || 'MT'}</strong></span>)}</div></div>;
}

export default function DashboardKpis({ summary, onShowStems }) {
  const [showCalculation, setShowCalculation] = useState(false);
  const rows = currencyRows(summary);
  const stemCount = summary?.matchingCount ?? summary?.stemCount ?? summary?.stemTotal;
  const accountCount = summary?.accountCount ?? summary?.buyerAccountCount;
  const disputed = summary?.disputedCount;
  const prior = summary?.priorPeriod || {};
  const complete = summary?.complete ?? summary?.isComplete ?? true;
  return <section aria-label="Dashboard KPIs" className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Matching STEMs" value={number(stemCount)?.toLocaleString() ?? '—'} sub={prior.stemCount != null ? `${number(prior.stemCount).toLocaleString()} in prior period` : 'Selected period'} icon={Package} color="blue" />
      <StatCard label="Counterparties" value={number(accountCount)?.toLocaleString() ?? '—'} sub="Distinct in matching STEMs" icon={Building2} color="green" />
      <StatCard label="Disputed" value={number(disputed)?.toLocaleString() ?? '—'} sub={stemCount && disputed != null ? `${((number(disputed) / number(stemCount)) * 100).toFixed(1)}% of matching STEMs` : 'Selected period'} icon={AlertTriangle} color="red" />
      <ProductVolumeCard productVolume={summary?.productVolumeKpi || summary?.productVolume} />
    </div>
    {complete ? <div className="grid gap-3 lg:grid-cols-3"><FinancialCard label="Turnover" field="buyer" rows={rows} accent="text-sky-700" /><FinancialCard label="Gross profit" field="netPnl" rows={rows} accent="text-emerald-700" /><FinancialCard label="Gross margin" field="grossMarginPct" rows={rows} accent="text-violet-700" percent /></div> : <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{summary?.matchingCount?.toLocaleString?.() ?? 'Some'} STEMs match, but only {summary?.processedCount?.toLocaleString?.() ?? 'part'} of the selection has been processed. Financial KPIs are withheld until the scope is complete.</div>}
    <div><Button type="button" size="sm" variant="outline" aria-expanded={showCalculation} onClick={() => setShowCalculation((visible) => !visible)}><Calculator className="mr-1.5 h-3.5 w-3.5" />{showCalculation ? 'Hide calculation' : 'Explain these figures'}</Button></div>
    {showCalculation ? <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs text-sky-950"><div className="font-semibold">Live calculation evidence</div><p className="mt-1">Every currency is calculated separately. Gross profit = buyer turnover − supplier cost − buyer/supplier broker commissions. Gross margin = gross profit ÷ buyer turnover.</p><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{rows.map((row) => <div key={row.currency} className="rounded-md border border-sky-200 bg-background p-2 tabular-nums"><strong>{row.currency}</strong><div className="mt-1">{money(row.buyer, row.currency)} − {money(row.supplier, row.currency)} − {money(row.brokerCommissions, row.currency)} = <strong>{money(row.netPnl, row.currency)}</strong></div><div>{number(row.netPnl) == null || number(row.buyer) === 0 ? 'Margin unavailable' : `${number(row.netPnl).toLocaleString()} ÷ ${number(row.buyer).toLocaleString()} = ${number(row.grossMarginPct).toFixed(1)}%`}</div><div className="mt-1 text-muted-foreground">{number(row.stemCount)?.toLocaleString() || 0} underlying STEMs</div></div>)}</div>{onShowStems ? <Button type="button" size="sm" variant="link" className="mt-2 h-auto px-0" onClick={onShowStems}>Open the underlying STEM evidence</Button> : null}</div> : null}
    {(summary?.dataWarnings || []).map((warning) => <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{warning}</div>)}
  </section>;
}
