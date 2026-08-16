import { useEffect, useMemo, useState } from 'react';
import { Bar, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2 } from 'lucide-react';
import StateBlock from '@/components/common/StateBlock';

const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
const PRODUCT_COLORS = { HSFO: '#0f766e', VLSFO: '#2563eb', LSMGO: '#f59e0b' };

function monthlyChartModel(trendRows, volumeRows, yearOverYear) {
  const byMonth = new Map();
  const currencies = [...new Set(trendRows.map((row) => row.currency || 'USD'))].sort();
  const families = [...new Set(volumeRows.map((row) => row.family).filter(Boolean))].sort((left, right) => {
    const order = ['HSFO', 'VLSFO', 'LSMGO'];
    const leftRank = order.indexOf(String(left).toUpperCase());
    const rightRank = order.indexOf(String(right).toUpperCase());
    return (leftRank < 0 ? order.length : leftRank) - (rightRank < 0 ? order.length : rightRank) || left.localeCompare(right);
  });
  for (const row of trendRows) {
    const item = byMonth.get(row.month) || { month: row.month };
    item[`profit:${row.currency || 'USD'}`] = Number(row.netPnl || 0);
    item[`margin:${row.currency || 'USD'}`] = row.grossMarginPct == null ? null : Number(row.grossMarginPct);
    byMonth.set(row.month, item);
  }
  for (const row of volumeRows) {
    const item = byMonth.get(row.month) || { month: row.month };
    item[`volume:${row.family}`] = Number(item[`volume:${row.family}`] || 0) + Number(row.quantity || 0);
    byMonth.set(row.month, item);
  }
  for (const row of yearOverYear?.monthly || []) {
    const item = byMonth.get(row.month) || { month: row.month };
    item[`yoyProfit:${row.currency || 'USD'}`] = row.differencePct == null ? null : Number(row.differencePct);
    byMonth.set(row.month, item);
  }
  for (const row of yearOverYear?.monthlyVolume || []) {
    const item = byMonth.get(row.month) || { month: row.month };
    item.yoyVolume = row.differencePct == null ? null : Number(row.differencePct);
    byMonth.set(row.month, item);
  }
  return { rows: [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month)), currencies, families };
}

function MonthlyPerformanceChart({ trendRows, volumeRows, yearOverYear }) {
  const [mode, setMode] = useState('profit');
  const model = useMemo(() => monthlyChartModel(trendRows, volumeRows, yearOverYear), [trendRows, volumeRows, yearOverYear]);
  if (!model.rows.length) return null;
  const volumeMode = mode === 'volume';
  return <section className="rounded-xl border border-border bg-card p-4">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">{volumeMode ? 'Monthly volume' : 'Monthly gross profit and margin'}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{volumeMode ? 'Product-volume bars with the same-calendar-month YoY difference as a dashed line.' : 'Gross-profit bars, gross-margin lines, and same-calendar-month YoY difference remain currency-safe.'}</p>
      </div>
      <div className="flex rounded-md border border-border bg-muted/30 p-1">
        <button type="button" onClick={() => setMode('profit')} className={`rounded px-2.5 py-1 text-xs font-semibold ${!volumeMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Gross profit</button>
        <button type="button" onClick={() => setMode('volume')} className={`rounded px-2.5 py-1 text-xs font-semibold ${volumeMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Monthly volume</button>
      </div>
    </div>
    {yearOverYear && yearOverYear.complete === false ? <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">YoY comparison is withheld because the previous-year Salesforce scope is incomplete.</p> : null}
    <ResponsiveContainer width="100%" height={310}>
      <ComposedChart data={model.rows} margin={{ right: 12 }}>
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="value" tick={{ fontSize: 11 }} tickFormatter={(value) => volumeMode ? Number(value).toLocaleString() : `${Math.round(Number(value) / 1000)}k`} />
        <YAxis yAxisId="margin" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(value) => `${Number(value).toFixed(1)}%`} width={52} />
        <Tooltip formatter={(value, name) => name.includes('margin') || name.includes('YoY') ? [`${Number(value).toFixed(1)}%`, name] : [Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }), name]} />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
        {volumeMode
          ? model.families.map((family, index) => <Bar key={family} yAxisId="value" dataKey={`volume:${family}`} name={`${family} volume`} stackId="volume" fill={PRODUCT_COLORS[String(family).toUpperCase()] || COLORS[index % COLORS.length]} radius={index === model.families.length - 1 ? [4, 4, 0, 0] : undefined} />)
          : model.currencies.map((currency, index) => <Bar key={currency} yAxisId="value" dataKey={`profit:${currency}`} name={`${currency} gross profit`} radius={[4, 4, 0, 0]}>{model.rows.map((row) => <Cell key={`${currency}:${row.month}`} fill={Number(row[`profit:${currency}`] || 0) >= 0 ? COLORS[index % COLORS.length] : '#dc2626'} />)}</Bar>)}
        {volumeMode
          ? <Line yAxisId="margin" type="monotone" dataKey="yoyVolume" name="Volume YoY difference" stroke="#7c3aed" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls={false} />
          : <>
              {model.currencies.map((currency, index) => <Line key={`margin:${currency}`} yAxisId="margin" type="monotone" dataKey={`margin:${currency}`} name={`${currency} gross margin`} stroke={COLORS[(index + 3) % COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />)}
              {model.currencies.map((currency, index) => <Line key={`yoy:${currency}`} yAxisId="margin" type="monotone" dataKey={`yoyProfit:${currency}`} name={`${currency} YoY difference`} stroke={COLORS[(index + 1) % COLORS.length]} strokeWidth={2.25} strokeDasharray="6 4" dot={{ r: 2.5 }} connectNulls={false} />)}
            </>}
      </ComposedChart>
    </ResponsiveContainer>
  </section>;
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
  const monthly = data?.trend?.monthly || [];
  const monthlyVolume = data?.trend?.monthlyVolume || [];
  const yearOverYear = data?.trend?.yearOverYear || null;
  const monthlyCounterparties = data?.trend?.monthlyCounterparties || null;
  const ranking = counterpartyMode === 'supplier' ? data?.rankings?.suppliersByNetPnl || [] : data?.rankings?.accountsByNetPnl || [];
  if (!monthly.length && !monthlyVolume.length && !monthlyCounterparties?.series?.length && !ranking.length) return <StateBlock title="No analytics for this selection" description="Try a wider period or remove a filter." />;
  return <div className="space-y-4"><MonthlyPerformanceChart trendRows={monthly} volumeRows={monthlyVolume} yearOverYear={yearOverYear} /><MonthlyCounterpartyChart data={monthlyCounterparties} counterpartyMode={counterpartyMode} /><TopAccounts rows={ranking} counterpartyMode={counterpartyMode} onAccountClick={onAccountClick} /></div>;
}
