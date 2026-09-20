import CalculationEvidence from '@/components/common/CalculationEvidence';
import { Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { dashboardDisplayNumber as number, dashboardEbitPresentation } from '@/lib/dashboardPresentation';

const money = (value) => number(value)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? 'Unavailable';
const PRODUCT_COLORS = { HSFO: 'bg-teal-600', VLSFO: 'bg-blue-600', LSMGO: 'bg-amber-500' };
const EVIDENCE_SOURCES = ['Filtered Salesforce STEM records; currencies stay separate.'];
const EBIT_LABEL = { full: 'EBIT', partial: 'Partial EBIT', profit: 'Gross profit before finance', none: 'EBIT' };
const CARD_CLASS = 'workspace-kpi-card dashboard-primary-kpi min-w-0 rounded-[var(--radius-panel)] border border-border bg-card p-4';
const NOTICE_CLASS = 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900';
const tone = (value, positive) => value == null ? 'text-muted-foreground' : value < 0 ? 'text-red-700 dark:text-red-400' : positive && value > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground';

function KpiCard({ children }) { return <article className={CARD_CLASS}>{children}</article>; }

function currencyRows(summary) {
  const rows = summary?.financials || summary?.currencyKpis || summary?.financialsByCurrency || summary?.moneyByCurrency || [];
  if (Array.isArray(rows) && rows.length) return rows;
  return [{ currency: summary?.currency || 'USD', turnover: summary?.turnoverTotal ?? summary?.totalBuyer, grossProfit: summary?.totalProfit, receivable: summary?.receivable }];
}

function FinancialCard({ label, field, rows, percent = false, formula, asOf, warnings = [], complete, action }) {
  const available = complete && rows.some((row) => number(row[field]) != null);
  const display = (value) => number(value) == null ? 'Unavailable' : percent ? `${number(value).toFixed(1)}%` : money(value);
  const evidenceValue = rows.map((row) => `${row.currency || 'Unspecified'}${percent ? ' basis' : ''}: ${complete ? display(row[field]) : 'Unavailable'}`).join(' · ');
  return <KpiCard>
    <div className="flex items-start justify-between gap-2"><h2 className="text-[13px] font-medium text-muted-foreground">{label}</h2><div className="flex items-center gap-2">{action}<CalculationEvidence title={label} value={evidenceValue} complete={available} formula={formula} sources={EVIDENCE_SOURCES} warnings={warnings} asOf={asOf} /></div></div>
    <div className="mt-3 space-y-2">{rows.map((row) => {
      const value = complete ? number(row[field]) : null;
      return <div key={row.currency || 'unspecified'} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
        {!percent || rows.length > 1 ? <span className="text-xs text-muted-foreground">{row.currency || 'Unspecified'}{percent ? ' basis' : ''}</span> : null}
        <span className={`text-[22px] font-semibold leading-7 ${tone(value, field === 'netPnl')}`} aria-label={`${row.currency || 'Unspecified'} ${label}: ${display(value)}`}>{display(value)}</span>
      </div>;
    })}</div>
  </KpiCard>;
}

function EbitToggle({ enabled, onChange }) {
  return <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground">
    <span>EBIT</span>
    <Switch
      checked={enabled}
      onCheckedChange={(checked) => onChange?.(checked === true)}
      aria-label="Show EBIT in place of Gross Profit"
    />
  </label>;
}

function GrossProfitCard({ summary, rows, complete, warnings, asOf, ebitEnabled, onEbitChange, financeLoading, financeError }) {
  if (!ebitEnabled) {
    return <FinancialCard label="Gross Profit" field="netPnl" rows={rows} complete={complete} warnings={warnings} asOf={asOf} action={<EbitToggle enabled={false} onChange={onEbitChange} />} formula="Buyer value − supplier cost and STEM adjustments, by currency." />;
  }

  const finance = summary?.finance;
  const financeByCurrency = new Map((finance?.byCurrency || []).map((row) => [row.currency || 'Unspecified', row]));
  const currencies = [...new Set([
    ...rows.map((row) => row.currency || 'Unspecified'),
    ...(finance?.byCurrency || []).map((row) => row.currency || 'Unspecified'),
  ])];
  const financeUsable = !financeLoading && !financeError;
  const ebitRows = currencies.map((currency) => ({ currency, display: dashboardEbitPresentation({
    summaryComplete: complete, financeUsable,
    grossProfit: rows.find((row) => (row.currency || 'Unspecified') === currency)?.netPnl,
    finance: financeByCurrency.get(currency),
  }) }));
  const kinds = new Set(ebitRows.map(({ display }) => display.type));
  const partial = kinds.has('partial');
  const grossProfitOnly = kinds.size === 1 && kinds.has('profit');
  const allAvailable = Boolean(finance && ebitRows.length && kinds.size === 1 && kinds.has('full'));
  const title = kinds.size > 1 ? 'EBIT coverage' : partial ? 'Partial EBIT' : grossProfitOnly ? 'Gross profit (before finance)' : 'EBIT';
  const description = partial ? 'Verified STEMs only; full gross profit shown for context' : grossProfitOnly ? 'Complete selection result before finance costs' : 'Gross profit net finance costs';
  const stateWarning = allAvailable ? null : 'Incomplete finance evidence: Partial EBIT excludes affected STEMs; gross profit is before finance.';
  const financeWarnings = [...warnings, ...(finance?.warnings || []), ...(stateWarning ? [stateWarning] : [])];
  const rate = number(finance?.annualInterestRatePct);
  const rateLabel = rate == null ? 'Rate unavailable' : `${rate.toFixed(2)}% annually`;
  const basis = finance?.dayCountBasis === 'ACT/365' ? 'Actual/365' : finance?.dayCountBasis || 'Day-count basis unavailable';
  const calculatedThrough = finance?.asOfDate ? `Calculated through ${finance.asOfDate}` : 'Calculation date unavailable';
  const evidenceValue = ebitRows.map(({ currency, display: row }) => `${currency} ${EBIT_LABEL[row.type]}: ${money(row.amount)}${row.type === 'partial' ? ` (${row.count}/${row.total} STEMs, ${row.coverage.toFixed(1)}% verified)` : row.type === 'profit' ? '; EBIT unavailable' : ''}`).join(' · ');

  return <KpiCard>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-[13px] font-medium text-muted-foreground">{title}</h2>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <EbitToggle enabled onChange={onEbitChange} />
        <CalculationEvidence title={title} value={evidenceValue} complete={allAvailable} formula={partial ? 'Verified GP − verified finance cost; full GP is context.' : grossProfitOnly ? 'Gross profit before finance; EBIT needs complete evidence.' : 'Gross profit − sum(positive daily funding × annual rate ÷ 365).'} sources={EVIDENCE_SOURCES} warnings={financeWarnings} asOf={finance?.asOfDate || asOf} />
      </div>
    </div>

    {financeLoading ? <div role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calculating EBIT…</div> : (
      <div className="mt-3 space-y-3">{ebitRows.map(({ currency, display }) => {
        const { amount, type } = display;
        const label = EBIT_LABEL[type];
        const detail = type === 'full' ? `Gross profit ${money(display.profit)} − finance cost ${money(display.cost)}`
          : type === 'partial' ? `${display.count.toLocaleString()} of ${display.total.toLocaleString()} STEMs verified · ${display.coverage.toFixed(1)}% · Verified GP ${money(display.profit)} − verified finance cost ${money(display.cost)} · Full selection gross profit ${money(display.totalProfit)} · ${display.excludedCount.toLocaleString()} STEMs excluded${display.excludedProfit == null ? '' : ` · excluded GP ${money(display.excludedProfit)}`}`
            : type === 'profit' ? `EBIT unavailable · finance evidence missing${display.missing != null && display.total != null ? ` for ${display.missing.toLocaleString()} of ${display.total.toLocaleString()} STEMs` : ''}` : 'EBIT unavailable';
        return <div key={currency} className="tabular-nums">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs text-muted-foreground">{currency} · {label}</span>
            <span className={`text-[22px] font-semibold leading-7 ${tone(amount, true)}`} aria-label={`${currency} ${label}: ${money(amount)}`}>{money(amount)}</span>
          </div>
          <p className={`mt-0.5 text-[11px] ${type === 'full' ? 'text-muted-foreground' : 'font-medium text-amber-700 dark:text-amber-400'}`}>{detail}</p>
        </div>;
      })}</div>
    )}

    <div className="mt-3 border-t border-border pt-2 text-[11px] leading-4 text-muted-foreground">
      {rateLabel} · {basis}<br />{calculatedThrough}{finance?.revision != null ? ` · Rate revision ${finance.revision}` : ''}
    </div>
    {financeError ? <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">{financeError?.message || String(financeError)}</p> : null}
  </KpiCard>;
}

function ProductVolumeCard({ productVolume, asOf, warnings = [] }) {
  const quantity = number(productVolume?.quantity);
  const display = quantity == null ? 'Unavailable' : `${quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${productVolume.unitOfMeasure || 'MT'}`;
  return <KpiCard>
    <div className="flex items-start justify-between gap-2"><h2 className="text-[13px] font-medium text-muted-foreground">Product Volume</h2><CalculationEvidence title="Product volume" value={display} complete={quantity != null} formula="Ordered quantity until delivery; then BDN quantity. Compatible units only." sources={EVIDENCE_SOURCES} warnings={warnings} asOf={asOf} /></div>
    <p className={`mt-3 text-[22px] font-semibold leading-7 tabular-nums ${quantity == null ? 'text-muted-foreground' : ''}`}>{display}</p>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{(productVolume?.breakdown || []).map((item) => <span key={`${item.family}:${item.unitOfMeasure}`} className="inline-flex items-center gap-1.5 text-[11px]"><span className={`h-2 w-2 shrink-0 rounded-sm ${PRODUCT_COLORS[String(item.family).toUpperCase()] || 'bg-slate-500'}`} />{item.family} {number(item.quantity)?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? 'Unavailable'} {item.unitOfMeasure || 'MT'}</span>)}</div>
  </KpiCard>;
}

export default function DashboardKpis({ summary, ebitEnabled = false, onEbitChange, financeLoading = false, financeError = null }) {
  const rows = currencyRows(summary);
  const stemCount = number(summary?.matchingCount ?? summary?.stemCount ?? summary?.stemTotal);
  const accountCount = number(summary?.accountCount ?? summary?.buyerAccountCount);
  const disputed = number(summary?.disputedCount);
  const prior = summary?.priorPeriod || {};
  const complete = Boolean(summary) && (summary.complete ?? summary.isComplete ?? true);
  const warnings = summary?.dataWarnings || [];
  const asOf = summary?.generatedAt || summary?.fetchedAt || null;
  const common = { rows, complete, warnings, asOf };
  const activity = [
    ['Matching STEMs', stemCount, number(prior.stemCount) != null ? `${number(prior.stemCount).toLocaleString()} in prior period` : null],
    ['Counterparties', accountCount, 'Distinct in matching STEMs'],
    ['Disputed', disputed, stemCount > 0 && disputed != null ? `${((disputed / stemCount) * 100).toFixed(1)}% of matching STEMs` : null, disputed > 0],
  ];
  return <section aria-label="Dashboard KPIs" className="space-y-3">
    <div className="dashboard-primary-kpis">
      <GrossProfitCard {...common} summary={summary} ebitEnabled={ebitEnabled} onEbitChange={onEbitChange} financeLoading={financeLoading} financeError={financeError} />
      <FinancialCard {...common} label="Gross Margin %" field="grossMarginPct" percent formula="Aggregate gross profit ÷ aggregate turnover × 100, by currency." />
      <FinancialCard {...common} label="Turnover" field="buyer" formula="Sum buyer value, by currency." />
      <ProductVolumeCard productVolume={summary?.productVolumeKpi || summary?.productVolume} asOf={asOf} warnings={warnings} />
    </div>
    <dl className="dashboard-activity-strip rounded-lg border border-border bg-card px-4 py-2.5" aria-label="Trading activity">{activity.map(([label, value, note, alert]) => <div key={label}><dt>{label}</dt><dd className={alert ? 'text-red-700 dark:text-red-400' : ''}>{value?.toLocaleString() ?? 'Unavailable'}</dd>{note ? <span>{note}</span> : null}</div>)}</dl>
    {summary && !complete ? <div role="status" className={NOTICE_CLASS}>{summary.matchingCount?.toLocaleString?.() ?? 'Some'} STEMs match, but only {summary.processedCount?.toLocaleString?.() ?? 'part'} of the selection has been processed. Financial KPIs are withheld until the scope is complete.</div> : null}
    {warnings.map((warning) => <div key={warning} className={NOTICE_CLASS}>{warning}</div>)}
  </section>;
}
