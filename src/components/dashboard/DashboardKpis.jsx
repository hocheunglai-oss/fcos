import { AlertTriangle, Building2, CircleDollarSign, Package } from 'lucide-react';
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

export default function DashboardKpis({ summary }) {
  const rows = currencyRows(summary);
  const stemCount = summary?.matchingCount ?? summary?.stemCount ?? summary?.stemTotal;
  const accountCount = summary?.accountCount ?? summary?.buyerAccountCount;
  const disputed = summary?.disputedCount;
  const prior = summary?.priorPeriod || {};
  const comparisonRows = summary?.comparisonByCurrency || [];
  const complete = summary?.complete ?? summary?.isComplete ?? true;
  return <section aria-label="Dashboard KPIs" className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Matching STEMs" value={number(stemCount)?.toLocaleString() ?? '—'} sub={prior.stemCount != null ? `${number(prior.stemCount).toLocaleString()} in prior period` : 'Selected period'} icon={Package} color="blue" />
      <StatCard label="Counterparties" value={number(accountCount)?.toLocaleString() ?? '—'} sub="Distinct in matching STEMs" icon={Building2} color="green" />
      <StatCard label="Disputed" value={number(disputed)?.toLocaleString() ?? '—'} sub={stemCount && disputed != null ? `${((number(disputed) / number(stemCount)) * 100).toFixed(1)}% of matching STEMs` : 'Selected period'} icon={AlertTriangle} color="red" />
      <div className="glass-surface rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-teal-700" /><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profit vs prior period</p></div><div className="mt-3 space-y-1.5">{comparisonRows.map((row) => <div key={row.currency} className="flex items-baseline justify-between gap-3 text-sm"><span className="text-muted-foreground">{row.currency}</span><span className={`font-semibold tabular-nums ${number(row.netPnlChangePct) == null || number(row.netPnlChangePct) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{number(row.netPnlChangePct) == null ? 'New / no prior' : `${number(row.netPnlChangePct) >= 0 ? '+' : ''}${number(row.netPnlChangePct).toFixed(1)}%`}</span></div>)}{!comparisonRows.length ? <span className="text-sm text-muted-foreground">Loading currency comparison…</span> : null}</div></div>
      {summary?.productVolumeKpi?.quantity != null ? <StatCard label="Product volume" value={`${number(summary.productVolumeKpi.quantity)?.toLocaleString() ?? '—'} ${summary.productVolumeKpi.unitOfMeasure || 'MT'}`} sub="Reported UOM; not converted across units" icon={Package} color="purple" /> : null}
    </div>
    {complete ? <div className="grid gap-3 lg:grid-cols-3"><FinancialCard label="Turnover" field="buyer" rows={rows} accent="text-sky-700" /><FinancialCard label="Gross profit" field="netPnl" rows={rows} accent="text-emerald-700" /><FinancialCard label="Gross margin" field="grossMarginPct" rows={rows} accent="text-violet-700" percent /></div> : <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{summary?.matchingCount?.toLocaleString?.() ?? 'Some'} STEMs match, but only {summary?.processedCount?.toLocaleString?.() ?? 'part'} of the selection has been processed. Financial KPIs are withheld until the scope is complete.</div>}
    {(summary?.dataWarnings || []).map((warning) => <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{warning}</div>)}
  </section>;
}
