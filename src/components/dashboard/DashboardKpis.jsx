import { AlertTriangle, Building2, Package } from 'lucide-react';
import CalculationEvidence from '@/components/common/CalculationEvidence';
import StatCard from '@/components/dashboard/StatCard';

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const money = (value, currency) => {
  if (number(value) == null) return '—';
  const safeCurrency = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : null;
  if (!safeCurrency) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number(value));
  // The ISO code is rendered once in the row label; repeating it in the value
  // makes monetary cards read as "USD USD 1,000" in several locales.
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number(value));
};

function currencyRows(summary) {
  const rows = summary?.financials || summary?.currencyKpis || summary?.financialsByCurrency || summary?.moneyByCurrency || [];
  if (Array.isArray(rows) && rows.length) return rows;
  return [{ currency: summary?.currency || 'USD', turnover: summary?.turnoverTotal ?? summary?.totalBuyer, grossProfit: summary?.totalProfit, receivable: summary?.receivable }];
}

function FinancialCard({ label, field, rows, accent, percent = false, formula, asOf, warnings = [] }) {
  const displayRows = rows.filter((row) => number(row[field]) != null);
  const evidenceValue = displayRows.map((row) => `${row.currency || 'Unspecified'} ${percent ? `${number(row[field]).toFixed(1)}%` : money(row[field], row.currency)}`).join(' · ');
  return <div className="workspace-kpi-card rounded-[var(--radius-panel)] border border-border bg-card p-4"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><CalculationEvidence title={label} value={evidenceValue || 'Unavailable'} classification={displayRows.length ? 'calculated' : 'unavailable'} complete={displayRows.length > 0} formula={formula} sources={['Exact Salesforce STEM and child financial records matching the selected Dashboard filters.', 'Amounts remain separated by ISO currency; FCOS does not invent exchange-rate conversions.']} warnings={warnings} asOf={asOf} /></div><div className="mt-3 space-y-1.5">{displayRows.map((row) => <div key={row.currency} className="flex items-baseline justify-between gap-3 text-sm">{percent ? null : <span className="text-muted-foreground">{row.currency || 'Unspecified'}</span>}<span className={`font-semibold tabular-nums ${accent} ${percent ? 'ml-auto' : ''}`} aria-label={percent ? `${row.currency || 'Unspecified'} gross margin` : undefined}>{percent ? `${number(row[field]).toFixed(1)}%` : money(row[field], row.currency)}</span></div>)}{!displayRows.length ? <span className="text-sm text-muted-foreground">Unavailable</span> : null}</div></div>;
}

const PRODUCT_COLORS = { HSFO: 'bg-teal-600', VLSFO: 'bg-blue-600', LSMGO: 'bg-amber-500' };

function ProductVolumeCard({ productVolume, asOf, warnings = [] }) {
  if (number(productVolume?.quantity) == null) return null;
  const display = `${number(productVolume.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${productVolume.unitOfMeasure || 'MT'}`;
  return <div className="workspace-kpi-card rounded-[var(--radius-panel)] border border-border bg-card p-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Package className="h-4 w-4 text-cyan-700" /><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product volume</p></div><CalculationEvidence title="Product volume" value={display} classification="calculated" formula="Use ordered quantity before actual delivery; use delivered BDN quantity after actual delivery. Sum compatible units only." sources={['Non-cancelled Salesforce STEM product lines matching the selected Dashboard filters.']} exclusions={['Different units of measure are never silently converted or combined.']} warnings={warnings} asOf={asOf} /></div><p className="mt-3 text-xl font-bold tabular-nums">{display}</p><p className="mt-1 text-xs text-muted-foreground">Ordered quantity before delivery; BDN quantity after actual delivery</p><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">{(productVolume.breakdown || []).map((item) => <span key={`${item.family}:${item.unitOfMeasure}`} className="inline-flex items-center gap-1.5 text-[11px]"><span className={`h-2.5 w-2.5 rounded-sm ${PRODUCT_COLORS[String(item.family).toUpperCase()] || 'bg-slate-500'}`} /><span className="text-muted-foreground">{item.family}</span><strong>{number(item.quantity)?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {item.unitOfMeasure || 'MT'}</strong></span>)}</div></div>;
}

export default function DashboardKpis({ summary }) {
  const rows = currencyRows(summary);
  const stemCount = summary?.matchingCount ?? summary?.stemCount ?? summary?.stemTotal;
  const accountCount = summary?.accountCount ?? summary?.buyerAccountCount;
  const disputed = summary?.disputedCount;
  const prior = summary?.priorPeriod || {};
  const complete = summary?.complete ?? summary?.isComplete ?? true;
  const warnings = summary?.dataWarnings || [];
  const asOf = summary?.generatedAt || summary?.fetchedAt || null;
  return <section aria-label="Dashboard KPIs" className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Matching STEMs" value={number(stemCount)?.toLocaleString() ?? '—'} sub={prior.stemCount != null ? `${number(prior.stemCount).toLocaleString()} in prior period` : 'Selected period'} icon={Package} color="blue" />
      <StatCard label="Counterparties" value={number(accountCount)?.toLocaleString() ?? '—'} sub="Distinct in matching STEMs" icon={Building2} color="green" />
      <StatCard label="Disputed" value={number(disputed)?.toLocaleString() ?? '—'} sub={stemCount && disputed != null ? `${((number(disputed) / number(stemCount)) * 100).toFixed(1)}% of matching STEMs` : 'Selected period'} icon={AlertTriangle} color="red" />
      <ProductVolumeCard productVolume={summary?.productVolumeKpi || summary?.productVolume} asOf={asOf} warnings={warnings} />
    </div>
    {complete ? <div className="grid gap-3 lg:grid-cols-3"><FinancialCard label="Turnover" field="buyer" rows={rows} accent="text-sky-700" formula="Sum buyer-side value for the matching STEM scope, separately by currency." asOf={asOf} warnings={warnings} /><FinancialCard label="Gross profit" field="netPnl" rows={rows} accent="text-emerald-700" formula="Buyer-side value minus supplier-side cost and applicable STEM financial adjustments, separately by currency." asOf={asOf} warnings={warnings} /><FinancialCard label="Gross margin" field="grossMarginPct" rows={rows} accent="text-violet-700" percent formula="Aggregate gross profit ÷ aggregate turnover × 100 for each currency. Monthly or row percentages are not averaged." asOf={asOf} warnings={warnings} /></div> : <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{summary?.matchingCount?.toLocaleString?.() ?? 'Some'} STEMs match, but only {summary?.processedCount?.toLocaleString?.() ?? 'part'} of the selection has been processed. Financial KPIs are withheld until the scope is complete.</div>}
    {warnings.map((warning) => <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{warning}</div>)}
  </section>;
}
