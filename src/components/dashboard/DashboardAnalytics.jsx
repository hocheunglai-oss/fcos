import { useEffect, useMemo, useState } from 'react';
import { Bar, Cell, ComposedChart, Legend, Line, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info, Loader2 } from 'lucide-react';
import StateBlock from '@/components/common/StateBlock';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });

function monthLabel(value) {
  const [year, month] = String(value || '').split('-').map(Number);
  if (!year || !month) return String(value || '');
  return MONTH_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));
}

function MonthComparisonTick({ x, y, payload, rowsByMonth, showPriorYear }) {
  const row = rowsByMonth.get(payload.value);
  return <g transform={`translate(${x},${y})`}><text textAnchor="middle" fill="currentColor" fontSize="11"><tspan x="0" dy="14">{monthLabel(payload.value)}</tspan>{showPriorYear ? <tspan x="0" dy="13" fill="#78716c" fontSize="10">{monthLabel(row?.priorMonth)}</tspan> : null}</text></g>;
}

function ProductBreakdown({ label, rows }) {
  if (!rows?.length) return <div className="text-muted-foreground">{label}: no MT detail</div>;
  return <div><span className="font-medium">{label}:</span> {rows.map((row) => `${row.family} ${Number(row.quantity).toLocaleString(undefined, { maximumFractionDigits: 1 })} MT`).join(' · ')}</div>;
}

function ChartLegendItem({ color, dashed = false, children }) {
  return <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-5 border-t-2" style={{ borderColor: color, borderTopStyle: dashed ? 'dashed' : 'solid' }} />{children}</span>;
}

function MonthlyChartLegend({ showPriorYear, currency }) {
  return <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-2 pt-3 text-[11px] text-muted-foreground">
    <ChartLegendItem color="#a94f2d">Current gross profit · {currency}</ChartLegendItem>
    <ChartLegendItem color="#4f6b4f">Current volume · MT</ChartLegendItem>
    <ChartLegendItem color="#7a4b5c">Current gross margin %</ChartLegendItem>
    {showPriorYear ? <><ChartLegendItem color="#d8a47f">Prior-year gross profit · {currency}</ChartLegendItem><ChartLegendItem color="#a8b69a">Prior-year volume · MT</ChartLegendItem><ChartLegendItem color="#b88a96" dashed>Prior-year gross margin %</ChartLegendItem></> : null}
  </div>;
}

function MonthlyComparisonTooltip({ active, payload, currency, showPriorYear }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const amount = (value, suffix = '') => (value == null || value === '' || !Number.isFinite(Number(value))) ? 'Unavailable' : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
  return <div className="max-w-md rounded-md border border-border bg-background p-3 text-xs shadow-lg"><div className="font-semibold">{monthLabel(row.month)}{showPriorYear ? ` · ${monthLabel(row.priorMonth)}` : ''}</div><div className={`mt-2 grid gap-x-3 gap-y-1 tabular-nums ${showPriorYear ? 'grid-cols-[auto_auto_auto]' : 'grid-cols-[auto_auto]'}`}><span className="font-medium">Metric</span><span className="font-medium">Current</span>{showPriorYear ? <span className="font-medium">Prior year</span> : null}<span>Gross profit</span><span>{currency} {amount(row.currentGrossProfit)}</span>{showPriorYear ? <span>{currency} {amount(row.priorGrossProfit)}</span> : null}<span>Volume</span><span>{amount(row.currentVolume, ' MT')}</span>{showPriorYear ? <span>{amount(row.priorVolume, ' MT')}</span> : null}<span>Gross margin</span><span>{amount(row.currentGrossMarginPct, '%')}</span>{showPriorYear ? <span>{amount(row.priorGrossMarginPct, '%')}</span> : null}</div><div className="mt-2 space-y-1 border-t border-border pt-2"><ProductBreakdown label="Current products" rows={row.currentProductVolumes} />{showPriorYear ? <ProductBreakdown label="Prior-year products" rows={row.priorProductVolumes} /> : null}</div></div>;
}

function ShiftedBarShape({ offsetX = 0, ...props }) {
  return <Rectangle {...props} x={Number(props.x || 0) + offsetX} radius={[3, 3, 0, 0]} />;
}

function CurrencyMonthlyChart({ currency, rows, showPriorYear }) {
  const rowsByMonth = useMemo(() => new Map(rows.map((row) => [row.month, row])), [rows]);
  const profitOffset = showPriorYear ? -16 : -6;
  const volumeOffset = showPriorYear ? 16 : 6;
  return <div><div className="mb-2 text-xs font-semibold text-muted-foreground">{currency}</div><div className="overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} aria-label={`${currency} monthly gross profit, volume and gross margin chart. Scroll horizontally to view all months.`}><div className="h-[350px] min-w-[760px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 28, right: 16, bottom: 22, left: 8 }} barCategoryGap="20%"><XAxis dataKey="month" height={showPriorYear ? 48 : 34} interval={0} tick={<MonthComparisonTick rowsByMonth={rowsByMonth} showPriorYear={showPriorYear} />} /><YAxis yAxisId="profit" tick={{ fontSize: 10, fill: '#a94f2d' }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} width={54} label={{ value: `${currency} GP`, angle: 0, position: 'top', offset: 10, fill: '#a94f2d', fontSize: 10 }} /><YAxis yAxisId="volume" orientation="right" tick={{ fontSize: 10, fill: '#4f6b4f' }} tickFormatter={(value) => Number(value).toLocaleString(undefined, { notation: 'compact' })} width={54} label={{ value: 'MT', angle: 0, position: 'top', offset: 10, fill: '#4f6b4f', fontSize: 10 }} /><YAxis yAxisId="margin" orientation="right" tick={{ fontSize: 10, fill: '#7a4b5c' }} tickFormatter={(value) => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`} width={48} label={{ value: '%', angle: 0, position: 'top', offset: 10, fill: '#7a4b5c', fontSize: 10 }} /><Tooltip content={<MonthlyComparisonTooltip currency={currency} showPriorYear={showPriorYear} />} /><Legend content={<MonthlyChartLegend showPriorYear={showPriorYear} currency={currency} />} /><Bar yAxisId="profit" dataKey="currentGrossProfit" name="Current gross profit" fill="#a94f2d" barSize={8} shape={<ShiftedBarShape offsetX={profitOffset} />}>{rows.map((row) => <Cell key={`current-profit:${row.month}`} fill={Number(row.currentGrossProfit || 0) >= 0 ? '#a94f2d' : '#b91c1c'} />)}</Bar>{showPriorYear ? <Bar yAxisId="profit" dataKey="priorGrossProfit" name="Prior-year gross profit" fill="#d8a47f" barSize={8} shape={<ShiftedBarShape offsetX={-16} />} /> : null}<Bar yAxisId="volume" dataKey="currentVolume" name="Current volume" fill="#4f6b4f" barSize={8} shape={<ShiftedBarShape offsetX={volumeOffset} />} />{showPriorYear ? <Bar yAxisId="volume" dataKey="priorVolume" name="Prior-year volume" fill="#a8b69a" barSize={8} shape={<ShiftedBarShape offsetX={16} />} /> : null}<Line yAxisId="margin" type="monotone" dataKey="currentGrossMarginPct" name="Current gross margin %" stroke="#7a4b5c" strokeWidth={2.75} dot={{ r: 3 }} connectNulls={false} />{showPriorYear ? <Line yAxisId="margin" type="monotone" dataKey="priorGrossMarginPct" name="Prior-year gross margin %" stroke="#b88a96" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 2.5 }} connectNulls={false} /> : null}</ComposedChart></ResponsiveContainer></div></div></div>;
}

function MonthlyPerformanceChart({ comparison }) {
  const [showPriorYear, setShowPriorYear] = useState(false);
  const model = useMemo(() => {
    const rows = comparison?.rows || [];
    return [...new Set(rows.map((row) => row.currency || 'USD'))].sort().map((currency) => ({ currency, rows: rows.filter((row) => (row.currency || 'USD') === currency) }));
  }, [comparison]);
  if (!model.length) return null;
  return <section className="relative rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-1.5"><h3 className="text-sm font-semibold">Monthly gross profit, volume and margin</h3><Popover><PopoverTrigger asChild><button type="button" aria-label="How monthly chart values are calculated" className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Info className="h-3.5 w-3.5" /></button></PopoverTrigger><PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] text-xs"><p className="font-semibold">Monthly chart methodology</p><p className="mt-1.5">January–December values use the selected dashboard scope. Gross profit and MT volume are actual monthly totals; gross margin is calculated independently for each month. Missing or incomplete values remain unavailable rather than being shown as zero. Prior-year values compare the matching calendar month.</p></PopoverContent></Popover></div><p className="mt-1 text-xs text-muted-foreground">Calendar year {comparison?.calendarYear || 'current year'} · monthly actuals in the selected scope.</p></div><button type="button" aria-pressed={showPriorYear} onClick={() => setShowPriorYear((visible) => !visible)} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Prior year · {showPriorYear ? 'Shown' : 'Hidden'}</button></div>{comparison?.complete === false && showPriorYear ? <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">Prior-year Salesforce data is incomplete. Current values remain visible; prior-year series are shown as gaps.</p> : null}<div className="mt-4 space-y-6">{model.map(({ currency, rows }) => <CurrencyMonthlyChart key={currency} currency={currency} rows={rows} showPriorYear={showPriorYear} />)}</div></section>;
}

function TopAccounts({ rows, counterpartyMode, onAccountClick }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((row) => Math.abs(Number(row.netPnl || row.grossProfit || 0))), 1);
  const label = counterpartyMode === 'supplier' ? 'suppliers' : 'accounts';
  return <section className="rounded-xl border border-border bg-card p-4"><h3 className="text-sm font-semibold">Top 10 {label} by gross profit</h3><p className="mt-1 text-xs text-muted-foreground">Exact Account IDs within the selected Dashboard scope.</p><div className="mt-4 space-y-2.5">{rows.map((row, index) => { const amount = Number(row.netPnl ?? row.grossProfit ?? 0); return <div key={`${row.currency}:${row.accountId || row.name}`} className="flex items-start gap-3"><span className="w-5 shrink-0 pt-0.5 text-right text-xs font-semibold text-muted-foreground">{index + 1}</span><button type="button" className="w-36 shrink-0 break-words text-left text-xs font-medium leading-5 text-primary hover:underline sm:w-60" disabled={!row.accountId} onClick={() => onAccountClick?.({ accountId: row.accountId, name: row.name, role: counterpartyMode === 'supplier' ? 'supplier' : 'buyer' })}>{row.name}</button><div className="mt-1.5 h-2 min-w-10 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${amount >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.abs(amount) / max * 100}%` }} /></div><span className={`w-28 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums ${amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{row.currency || 'USD'} {amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>; })}</div></section>;
}

export default function DashboardAnalytics({ data, loading, error, onLoad, counterpartyMode = 'buyer', onAccountClick }) {
  useEffect(() => { onLoad?.(); }, [onLoad]);
  if (loading && !data) return <div className="flex min-h-56 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading analytics…</div>;
  if (error && !data) return <StateBlock title="Analytics unavailable" description={error} />;
  const monthlyComparison = data?.trend?.monthlyComparison || null;
  const ranking = counterpartyMode === 'supplier' ? data?.rankings?.suppliersByNetPnl || [] : data?.rankings?.accountsByNetPnl || [];
  if (!monthlyComparison?.rows?.length && !ranking.length) return <StateBlock title="No analytics for this selection" description="Try a wider period or remove a filter." />;
  return <div className="space-y-4"><MonthlyPerformanceChart comparison={monthlyComparison} /><TopAccounts rows={ranking} counterpartyMode={counterpartyMode} onAccountClick={onAccountClick} /></div>;
}
