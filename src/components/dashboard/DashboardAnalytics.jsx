import { useEffect } from 'react';
import { Bar, BarChart, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2 } from 'lucide-react';
import StateBlock from '@/components/common/StateBlock';

const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];

function AnalyticsChart({ title, rows }) {
  if (!rows.length) return null;
  return <section className="rounded-xl border border-border bg-card p-4"><h3 className="mb-3 text-sm font-semibold">{title}</h3><ResponsiveContainer width="100%" height={250}><BarChart data={rows}><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Bar dataKey="value" radius={[4, 4, 0, 0]}>{rows.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></section>;
}

function CurrencyTrendChart({ rows }) {
  if (!rows.length) return null;
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  const byMonth = new Map();
  for (const row of rows) {
    const current = byMonth.get(row.month) || { label: row.month };
    current[row.currency] = Number(row.netPnl || 0);
    byMonth.set(row.month, current);
  }
  const data = [...byMonth.values()].sort((left, right) => left.label.localeCompare(right.label));
  return <section className="rounded-xl border border-border bg-card p-4 lg:col-span-2"><h3 className="mb-3 text-sm font-semibold">Monthly net profit by currency</h3><ResponsiveContainer width="100%" height={280}><LineChart data={data}><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />{currencies.map((currency, index) => <Line key={currency} type="monotone" dataKey={currency} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={false} connectNulls={false} />)}</LineChart></ResponsiveContainer></section>;
}

export default function DashboardAnalytics({ data, loading, error, onLoad }) {
  useEffect(() => { onLoad?.(); }, [onLoad]);
  if (loading && !data) return <div className="flex min-h-56 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading analytics…</div>;
  if (error && !data) return <StateBlock title="Analytics unavailable" description={error} />;
  const byStatus = (data?.stemByStatus || data?.byStatus || data?.distributions?.status || []).map((row) => ({ ...row, value: row.value ?? row.count }));
  const byType = (data?.stemByType || data?.byType || data?.distributions?.type || []).map((row) => ({ ...row, value: row.value ?? row.count }));
  const monthly = data?.trend?.monthly || [];
  if (!byStatus.length && !byType.length && !monthly.length) return <StateBlock title="No analytics for this selection" description="Try a wider period or remove a filter." />;
  return <div className="grid gap-4 lg:grid-cols-2"><CurrencyTrendChart rows={monthly} /><AnalyticsChart title="STEMs by status" rows={byStatus} /><AnalyticsChart title="STEMs by type" rows={byType} /></div>;
}
