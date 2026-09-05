import CalculationEvidence from '@/components/common/CalculationEvidence';
import { dashboardDisplayNumber as number } from '@/lib/dashboardPresentation';

const money = (value) => number(value)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? 'Unavailable';
const PRODUCT_COLORS = { HSFO: 'bg-teal-600', VLSFO: 'bg-blue-600', LSMGO: 'bg-amber-500' };

function currencyRows(summary) {
  const rows = summary?.financials || summary?.currencyKpis || summary?.financialsByCurrency || summary?.moneyByCurrency || [];
  if (Array.isArray(rows) && rows.length) return rows;
  return [{ currency: summary?.currency || 'USD', turnover: summary?.turnoverTotal ?? summary?.totalBuyer, grossProfit: summary?.totalProfit, receivable: summary?.receivable }];
}

function FinancialCard({ label, field, rows, percent = false, formula, asOf, warnings = [], complete }) {
  const available = complete && rows.some((row) => number(row[field]) != null);
  const display = (value) => number(value) == null ? 'Unavailable' : percent ? `${number(value).toFixed(1)}%` : money(value);
  const evidenceValue = rows.map((row) => `${row.currency || 'Unspecified'}${percent ? ' basis' : ''}: ${complete ? display(row[field]) : 'Unavailable'}`).join(' · ');
  return <article className="workspace-kpi-card dashboard-primary-kpi min-w-0 rounded-[var(--radius-panel)] border border-border bg-card p-4">
    <div className="flex items-start justify-between gap-2"><h2 className="text-[13px] font-medium text-muted-foreground">{label}</h2><CalculationEvidence title={label} value={evidenceValue} classification={available ? 'calculated' : 'unavailable'} complete={Boolean(available)} formula={formula} sources={['Exact Salesforce STEM and child financial records matching the selected Dashboard filters.', 'Amounts remain separated by ISO currency; FCOS does not invent exchange-rate conversions.']} warnings={warnings} asOf={asOf} /></div>
    <div className="mt-3 space-y-2">{rows.map((row) => {
      const value = complete ? number(row[field]) : null;
      const accent = value == null ? 'text-muted-foreground' : value < 0 ? 'text-red-700 dark:text-red-400' : field === 'netPnl' && value > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground';
      return <div key={row.currency || 'unspecified'} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
        {!percent || rows.length > 1 ? <span className="text-xs text-muted-foreground">{row.currency || 'Unspecified'}{percent ? ' basis' : ''}</span> : null}
        <span className={`text-[22px] font-semibold leading-7 ${accent}`} aria-label={`${row.currency || 'Unspecified'} ${label}: ${display(value)}`}>{display(value)}</span>
      </div>;
    })}</div>
  </article>;
}

function ProductVolumeCard({ productVolume, asOf, warnings = [] }) {
  const quantity = number(productVolume?.quantity);
  const display = quantity == null ? 'Unavailable' : `${quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${productVolume.unitOfMeasure || 'MT'}`;
  return <article className="workspace-kpi-card dashboard-primary-kpi min-w-0 rounded-[var(--radius-panel)] border border-border bg-card p-4">
    <div className="flex items-start justify-between gap-2"><h2 className="text-[13px] font-medium text-muted-foreground">Product Volume</h2><CalculationEvidence title="Product volume" value={display} classification={quantity == null ? 'unavailable' : 'calculated'} complete={quantity != null} formula="Use ordered quantity before actual delivery; use delivered BDN quantity after actual delivery. Sum compatible units only." sources={['Non-cancelled Salesforce STEM product lines matching the selected Dashboard filters.']} exclusions={['Different units of measure are never silently converted or combined.']} warnings={warnings} asOf={asOf} /></div>
    <p className={`mt-3 text-[22px] font-semibold leading-7 tabular-nums ${quantity == null ? 'text-muted-foreground' : ''}`}>{display}</p>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{(productVolume?.breakdown || []).map((item) => <span key={`${item.family}:${item.unitOfMeasure}`} className="inline-flex flex-wrap items-center gap-1.5 text-[11px]"><span className={`h-2 w-2 shrink-0 rounded-sm ${PRODUCT_COLORS[String(item.family).toUpperCase()] || 'bg-slate-500'}`} /><span className="text-muted-foreground">{item.family}</span><span className="font-medium tabular-nums">{number(item.quantity)?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? 'Unavailable'} {item.unitOfMeasure || 'MT'}</span></span>)}</div>
  </article>;
}

export default function DashboardKpis({ summary }) {
  const rows = currencyRows(summary);
  const stemCount = number(summary?.matchingCount ?? summary?.stemCount ?? summary?.stemTotal);
  const accountCount = number(summary?.accountCount ?? summary?.buyerAccountCount);
  const disputed = number(summary?.disputedCount);
  const prior = summary?.priorPeriod || {};
  const complete = Boolean(summary) && (summary.complete ?? summary.isComplete ?? true);
  const warnings = summary?.dataWarnings || [];
  const asOf = summary?.generatedAt || summary?.fetchedAt || null;
  const common = { rows, complete, warnings, asOf };
  return <section aria-label="Dashboard KPIs" className="space-y-3">
    <div className="dashboard-primary-kpis">
      <FinancialCard {...common} label="Gross Profit" field="netPnl" formula="Buyer-side value minus supplier-side cost and applicable STEM financial adjustments, separately by currency." />
      <FinancialCard {...common} label="Gross Margin %" field="grossMarginPct" percent formula="Aggregate gross profit ÷ aggregate turnover × 100 for each currency. Monthly or row percentages are not averaged." />
      <FinancialCard {...common} label="Turnover" field="buyer" formula="Sum buyer-side value for the matching STEM scope, separately by currency." />
      <ProductVolumeCard productVolume={summary?.productVolumeKpi || summary?.productVolume} asOf={asOf} warnings={warnings} />
    </div>
    <dl className="dashboard-activity-strip rounded-lg border border-border bg-card px-4 py-2.5" aria-label="Trading activity">
      <div><dt>Matching STEMs</dt><dd>{stemCount?.toLocaleString() ?? 'Unavailable'}</dd>{number(prior.stemCount) != null ? <span>{number(prior.stemCount).toLocaleString()} in prior period</span> : null}</div>
      <div><dt>Counterparties</dt><dd>{accountCount?.toLocaleString() ?? 'Unavailable'}</dd><span>Distinct in matching STEMs</span></div>
      <div><dt>Disputed</dt><dd className={disputed > 0 ? 'text-red-700 dark:text-red-400' : ''}>{disputed?.toLocaleString() ?? 'Unavailable'}</dd>{stemCount > 0 && disputed != null ? <span>{((disputed / stemCount) * 100).toFixed(1)}% of matching STEMs</span> : null}</div>
    </dl>
    {summary && !complete ? <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{summary.matchingCount?.toLocaleString?.() ?? 'Some'} STEMs match, but only {summary.processedCount?.toLocaleString?.() ?? 'part'} of the selection has been processed. Financial KPIs are withheld until the scope is complete.</div> : null}
    {warnings.map((warning) => <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{warning}</div>)}
  </section>;
}
