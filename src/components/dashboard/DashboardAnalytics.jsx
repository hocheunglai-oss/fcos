import { useEffect, useMemo } from 'react';
import { Bar, Cell, ComposedChart, Legend, Line, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2 } from 'lucide-react';
import StateBlock from '@/components/common/StateBlock';

const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });

function monthLabel(value) {
  const [year, month] = String(value || '').split('-').map(Number);
  if (!year || !month) return String(value || '');
  return MONTH_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));
}

function MonthComparisonTick({ x, y, payload, rowsByMonth }) {
  const row = rowsByMonth.get(payload.value);
  return <g transform={`translate(${x},${y})`}><text textAnchor="middle" fill="currentColor" fontSize="11"><tspan x="0" dy="14">{monthLabel(payload.value)}</tspan><tspan x="0" dy="13" fill="#64748b" fontSize="10">{monthLabel(row?.priorMonth)}</tspan></text></g>;
}

function ProductBreakdown({ label, rows }) {
  if (!rows?.length) return <div className="text-muted-foreground">{label}: no MT detail</div>;
  return <div><span className="font-medium">{label}:</span> {rows.map((row) => `${row.family} ${Number(row.quantity).toLocaleString(undefined, { maximumFractionDigits: 1 })} MT`).join(' · ')}</div>;
}

function MonthlyComparisonTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const amount = (value, suffix = '') => value == null ? 'Unavailable' : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
  return <div className="max-w-md rounded-md border border-border bg-background p-3 text-xs shadow-lg"><div className="font-semibold">{monthLabel(row.month)} · {monthLabel(row.priorMonth)}</div><div className="mt-2 grid grid-cols-[auto_auto_auto] gap-x-3 gap-y-1 tabular-nums"><span className="font-medium">Metric</span><span className="font-medium">Current</span><span className="font-medium">Prior year</span><span>Gross profit</span><span>{currency} {amount(row.currentGrossProfit)}</span><span>{currency} {amount(row.priorGrossProfit)}</span><span>Volume</span><span>{amount(row.currentVolume, ' MT')}</span><span>{amount(row.priorVolume, ' MT')}</span><span>Gross margin</span><span>{amount(row.currentGrossMarginPct, '%')}</span><span>{amount(row.priorGrossMarginPct, '%')}</span></div><div className="mt-2 space-y-1 border-t border-border pt-2"><ProductBreakdown label="Current products" rows={row.currentProductVolumes} /><ProductBreakdown label="Prior-year products" rows={row.priorProductVolumes} /></div></div>;
}

function ShiftedBarShape({ offsetX = 0, ...props }) {
  return <Rectangle {...props} x={Number(props.x || 0) + offsetX} radius={[3, 3, 0, 0]} />;
}

function CurrencyMonthlyChart({ currency, rows }) {
  const rowsByMonth = useMemo(() => new Map(rows.map((row) => [row.month, row])), [rows]);
  return <div><div className="mb-2 text-xs font-semibold text-muted-foreground">{currency}</div><div className="overflow-x-auto"><div className="h-[350px] min-w-[720px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 8, right: 18, bottom: 22, left: 6 }} barCategoryGap="20%"><XAxis dataKey="month" height={48} interval={0} tick={<MonthComparisonTick rowsByMonth={rowsByMonth} />} /><YAxis yAxisId="profit" tick={{ fontSize: 10, fill: '#2563eb' }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} width={50} label={{ value: currency, angle: -90, position: 'insideLeft', fill: '#2563eb', fontSize: 10 }} /><YAxis yAxisId="volume" orientation="right" tick={{ fontSize: 10, fill: '#0f766e' }} tickFormatter={(value) => Number(value).toLocaleString(undefined, { notation: 'compact' })} width={52} label={{ value: 'MT', angle: 90, position: 'insideRight', fill: '#0f766e', fontSize: 10 }} /><YAxis yAxisId="margin" orientation="right" tick={{ fontSize: 10, fill: '#7c3aed' }} tickFormatter={(value) => `${Number(value).toFixed(0)}%`} width={48} label={{ value: '%', angle: 90, position: 'outside', fill: '#7c3aed', fontSize: 10 }} /><Tooltip content={<MonthlyComparisonTooltip currency={currency} />} /><Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} /><Bar yAxisId="profit" dataKey="currentGrossProfit" name="Current gross profit" fill="#2563eb" barSize={8} shape={<ShiftedBarShape offsetX={-16} />}>{rows.map((row) => <Cell key={`current-profit:${row.month}`} fill={Number(row.currentGrossProfit || 0) >= 0 ? '#2563eb' : '#dc2626'} />)}</Bar><Bar yAxisId="profit" dataKey="priorGrossProfit" name="Prior-year gross profit" fill="#93c5fd" barSize={8} shape={<ShiftedBarShape offsetX={-16} />} /><Bar yAxisId="volume" dataKey="currentVolume" name="Current volume" fill="#0f766e" barSize={8} shape={<ShiftedBarShape offsetX={16} />} /><Bar yAxisId="volume" dataKey="priorVolume" name="Prior-year volume" fill="#99f6e4" barSize={8} shape={<ShiftedBarShape offsetX={16} />} /><Line yAxisId="margin" type="monotone" dataKey="currentGrossMarginPct" name="Current gross margin" stroke="#7c3aed" strokeWidth={2.75} dot={{ r: 3 }} connectNulls={false} /><Line yAxisId="margin" type="monotone" dataKey="priorGrossMarginPct" name="Prior-year gross margin" stroke="#a78bfa" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 2.5 }} connectNulls={false} /></ComposedChart></ResponsiveContainer></div></div></div>;
}

function MonthlyPerformanceChart({ comparison }) {
  const model = useMemo(() => {
    const rows = comparison?.rows || [];
    return [...new Set(rows.map((row) => row.currency || 'USD'))].sort().map((currency) => ({ currency, rows: rows.filter((row) => (row.currency || 'USD') === currency) }));
  }, [comparison]);
  if (!model.length) return null;
  return <section className="rounded-xl border border-border bg-card p-4"><h3 className="text-sm font-semibold">Monthly gross profit, volume and margin</h3><p className="mt-1 text-xs text-muted-foreground">Each month is paired with the same calendar month last year. Bars show actual gross profit and MT volume; purple lines show each month’s independently calculated gross margin.</p>{comparison?.complete === false ? <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">Prior-year Salesforce data is incomplete. Current values remain visible; prior-year series are shown as gaps.</p> : null}<div className="mt-4 space-y-6">{model.map(({ currency, rows }) => <CurrencyMonthlyChart key={currency} currency={currency} rows={rows} />)}</div></section>;
}

function monthlyCounterpartyModel(data, currency) {
  const series = (data?.series || []).filter((item) => (item.currency || 'USD') === currency);
  const seriesKeys = new Set(series.map((item) => item.seriesKey));
  const byMonth = new Map();
  for (const point of data?.points || []) {
    if (!seriesKeys.has(point.seriesKey)) continue;
    const row = byMonth.get(point.month) || { month: point.month };
    row[point.seriesKey] = Number(point.grossProfit || 0);
    byMonth.set(point.month, row);
  }
  return { series, rows: [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month)) };
}

function MonthlyCounterpartyChart({ data, counterpartyMode }) {
  const currencies = [...new Set((data?.series || []).map((item) => item.currency || 'USD'))].sort();
  if (!currencies.length) return null;
  const label = counterpartyMode === 'supplier' ? 'supplier' : 'buyer';
  return <section className="rounded-xl border border-border bg-card p-4"><h3 className="text-sm font-semibold">Monthly gross profit by {label}</h3><p className="mt-1 text-xs text-muted-foreground">Stacked monthly contribution from the top 10 {label}s in the selected period.</p><div className="mt-4 space-y-6">{currencies.map((currency) => { const model = monthlyCounterpartyModel(data, currency); return <div key={currency}><p className="mb-2 text-xs font-semibold text-muted-foreground">{currency}</p><ResponsiveContainer width="100%" height={300}><ComposedChart data={model.rows} margin={{ right: 12 }}><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} /><Tooltip formatter={(value, name) => [`${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, name]} /><Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />{model.series.map((item, index) => <Bar key={item.seriesKey} dataKey={item.seriesKey} name={item.name} stackId={currency} fill={COLORS[index % COLORS.length]} radius={index === model.series.length - 1 ? [4, 4, 0, 0] : undefined} />)}</ComposedChart></ResponsiveContainer></div>; })}</div></section>;
}

function TopAccounts({ rows, counterpartyMode, onAccountClick }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((row) => Math.abs(Number(row.netPnl || row.grossProfit || 0))), 1);
  const label = counterpartyMode === 'supplier' ? 'suppliers' : 'accounts';
  return <section className="rounded-xl border border-border bg-card p-4"><h3 className="text-sm font-semibold">Top 10 {label} by gross profit</h3><p className="mt-1 text-xs text-muted-foreground">Exact Account IDs within the selected Dashboard scope.</p><div className="mt-4 space-y-2.5">{rows.map((row, index) => { const amount = Number(row.netPnl ?? row.grossProfit ?? 0); return <div key={`${row.currency}:${row.accountId || row.name}`} className="flex items-center gap-3"><span className="w-5 text-right text-xs font-semibold text-muted-foreground">{index + 1}</span><button type="button" className="w-44 truncate text-left text-xs font-medium text-primary hover:underline sm:w-64" title={row.name} disabled={!row.accountId} onClick={() => onAccountClick?.({ accountId: row.accountId, name: row.name, role: counterpartyMode === 'supplier' ? 'supplier' : 'buyer' })}>{row.name}</button><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${amount >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.abs(amount) / max * 100}%` }} /></div><span className={`w-28 text-right text-xs font-semibold tabular-nums ${amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{row.currency || 'USD'} {amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>; })}</div></section>;
}

export default function DashboardAnalytics({ data, loading, error, onLoad, counterpartyMode = 'buyer', onAccountClick }) {
  useEffect(() => { onLoad?.(); }, [onLoad]);
  if (loading && !data) return <div className="flex min-h-56 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading analytics…</div>;
  if (error && !data) return <StateBlock title="Analytics unavailable" description={error} />;
  const monthlyComparison = data?.trend?.monthlyComparison || null;
  const monthlyCounterparties = data?.trend?.monthlyCounterparties || null;
  const ranking = counterpartyMode === 'supplier' ? data?.rankings?.suppliersByNetPnl || [] : data?.rankings?.accountsByNetPnl || [];
  if (!monthlyComparison?.rows?.length && !monthlyCounterparties?.series?.length && !ranking.length) return <StateBlock title="No analytics for this selection" description="Try a wider period or remove a filter." />;
  return <div className="space-y-4"><MonthlyPerformanceChart comparison={monthlyComparison} /><MonthlyCounterpartyChart data={monthlyCounterparties} counterpartyMode={counterpartyMode} /><TopAccounts rows={ranking} counterpartyMode={counterpartyMode} onAccountClick={onAccountClick} /></div>;
}
