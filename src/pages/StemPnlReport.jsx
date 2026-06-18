import { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Loader2, Download, Play, TrendingUp, TrendingDown, DollarSign, BarChart2 } from 'lucide-react';
import { format } from 'date-fns';

const fmt = (v, isPercent = false) => {
  if (v == null) return '—';
  if (isPercent) return `${Number(v).toFixed(1)}%`;
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (v) => {
  if (!v) return '—';
  try { return format(new Date(v), 'dd MMM yyyy'); } catch { return v; }
};

const COLUMNS = [
  { key: 'Key',                label: 'Key',               num: false },
  { key: 'Buyer',              label: 'Buyer',             num: false },
  { key: 'Delivery_Date',      label: 'Delivery Date',     num: false, isDate: true },

  { key: 'Buyer_Invoice',      label: 'Buyer Invoice',     num: true },
  { key: 'Supplier_Invoice',   label: 'Supplier Invoice',  num: true },
  { key: 'Supplier_Broker_Comm', label: 'Supp. Broker',   num: true },
  { key: 'Buyer_Broker_Comm',  label: 'Buyer Broker',      num: true },
  { key: 'Dashboard_Net_PnL',  label: 'Dashboard Net',     num: true },
  { key: 'Qlik_Total_Profit',  label: 'Qlik Net',          num: true },
  { key: 'Pnl_Difference',     label: 'Difference',        num: true },
];

const YEAR_OPTIONS = ['2026', '2025', '2024', '2023'];
const MONTH_OPTIONS = [
  { value: '01', label: 'January' }, { value: '02', label: 'February' },
  { value: '03', label: 'March' },   { value: '04', label: 'April' },
  { value: '05', label: 'May' },     { value: '06', label: 'June' },
  { value: '07', label: 'July' },    { value: '08', label: 'August' },
  { value: '09', label: 'September' },{ value: '10', label: 'October' },
  { value: '11', label: 'November' },{ value: '12', label: 'December' },
];

function StatCard({ label, value, sub, color = 'default' }) {
  const colorMap = {
    default: 'text-foreground',
    green: 'text-emerald-600',
    red: 'text-red-500',
    blue: 'text-blue-600',
    amber: 'text-amber-600',
  };
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${colorMap[color]}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function StemPnlReport() {
  const [year, setYear] = useState('2025');
  const [month, setMonth] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [sortKey, setSortKey] = useState('Delivery_Date');
  const [sortDir, setSortDir] = useState(-1);
  const [search, setSearch] = useState('');

  const buildWhere = useCallback(() => {
    const parts = [];
    if (month !== 'all') {
      const from = `${year}-${month}-01`;
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      parts.push(`Delivery_Date__c >= ${from} AND Delivery_Date__c <= ${to}`);
    } else {
      parts.push(`Delivery_Date__c >= ${year}-01-01 AND Delivery_Date__c <= ${year}-12-31`);
    }
    return parts.join(' AND ');
  }, [year, month]);

  const run = async () => {
    setLoading(true);
    setError(null);
    const where = buildWhere();
    const [reportRes, dashboardRes] = await Promise.all([
      base44.functions.invoke('stemPnl', { where, limit: 1000 }),
      base44.functions.invoke('salesforceDashboardFiltered', { where, trendYear: Number(year) }),
    ]);
    if (reportRes.data?.error || dashboardRes.data?.error) {
      setError(reportRes.data?.error || dashboardRes.data?.error);
    } else {
      const dashboardById = new Map((dashboardRes.data.recentStems || []).map(stem => [stem.Id, stem.__netPnlCalc]));
      const mergedRows = (reportRes.data.rows || []).map(row => {
        const dashboardNet = dashboardById.get(row.Id);
        const qlikNet = row.Qlik_Total_Profit;
        return {
          ...row,
          Dashboard_Net_PnL: dashboardNet ?? null,
          Pnl_Difference: dashboardNet != null && qlikNet != null ? dashboardNet - qlikNet : null,
        };
      });
      setRows(mergedRows);
      setTotals({
        ...(reportRes.data.totals || null),
        Dashboard_Net_PnL: mergedRows.reduce((sum, row) => sum + (row.Dashboard_Net_PnL ?? 0), 0),
        Pnl_Difference: mergedRows.reduce((sum, row) => sum + (row.Pnl_Difference ?? 0), 0),
      });
    }
    setLoading(false);
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(-1); }
  };

  const filtered = rows
    .filter(r => !search || [r.Key, r.Buyer, r.Status, r.Name].some(v => v && String(v).toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -sortDir : sortDir;
    });

  const exportCsv = () => {
    if (!rows.length) return;
    const headers = COLUMNS.map(c => c.label);
    const csvRows = rows.map(r => COLUMNS.map(c => {
      const v = r[c.key];
      if (v == null) return '';
      return String(v).includes(',') ? `"${v}"` : String(v);
    }));
    const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `stem_pnl_${year}${month !== 'all' ? '_' + month : ''}.csv`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <BarChart2 className="w-4 h-4" />
              <span>Stem P&L Report</span>
            </div>
            <h1 className="text-2xl font-bold font-dm text-foreground">Stem Profit & Loss</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Compares each stem’s dashboard Net P&L against Qlik Net P&L</p>
          </div>
          {rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-24 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Full Year</SelectItem>
              {MONTH_OPTIONS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={run} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run
          </Button>
          {rows.length > 0 && (
            <Input
              className="w-48 h-9 text-xs"
              placeholder="Search stem, buyer…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {/* KPI cards */}
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
            <StatCard label="Stems" value={totals.count} sub={`${totals.complete} complete`} />
            <StatCard label="Buyer Invoices" value={fmt(totals.Buyer_Invoice)} color="blue" />
            <StatCard label="Supplier Invoices" value={fmt(totals.Supplier_Invoice)} color="amber" />
            <StatCard label="Broker Commissions" value={fmt(totals.Total_Broker_Comm)} color="amber" />
            <StatCard
              label="Qlik Net"
              value={fmt(totals.Qlik_Net_Profit)}
              sub={totals.Buyer_Invoice ? `${((totals.Qlik_Net_Profit / totals.Buyer_Invoice) * 100).toFixed(1)}% margin` : null}
              color={(totals.Qlik_Net_Profit ?? 0) >= 0 ? 'green' : 'red'}
            />
            <StatCard
              label="Dashboard Net"
              value={fmt(totals.Dashboard_Net_PnL)}
              sub={`Difference ${fmt(totals.Pnl_Difference)}`}
              color={(totals.Pnl_Difference ?? 0) === 0 ? 'green' : 'red'}
            />
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">Fetching stem P&L data…</span>
          </div>
        ) : rows.length > 0 ? (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-semibold">{filtered.length.toLocaleString()} stems</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {COLUMNS.map(col => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={`py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-foreground transition-colors select-none ${col.num ? 'text-right' : 'text-left'} ${sortKey === col.key ? 'text-foreground' : ''}`}
                      >
                        {col.label} {sortKey === col.key ? (sortDir === -1 ? '↓' : '↑') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => {
                    return (
                      <tr key={row.Id || i} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        {COLUMNS.map(col => {
                          const v = row[col.key];
                          let display;
                          if (col.isDate) display = fmtDate(v);
                          else if (col.isPercent) display = fmt(v, true);
                          else if (col.num) display = fmt(v);
                          else display = v ?? '—';

                          const isProfit = ['Dashboard_Net_PnL', 'Qlik_Total_Profit'].includes(col.key);
                          const isDifference = col.key === 'Pnl_Difference';
                          const isMargin = col.key === 'Margin_Pct';
                          let cellColor = '';
                          if (isDifference && v != null) {
                            cellColor = Math.abs(v) < 0.01 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold';
                          } else if ((isProfit || isMargin) && v != null) {
                            cellColor = v >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold';
                          }

                          return (
                            <td key={col.key} className={`py-2.5 px-3 whitespace-nowrap ${col.num ? 'text-right font-mono' : ''} ${cellColor}`}>
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                {/* Totals row */}
                {totals && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/60 font-bold">
                      {COLUMNS.map((col, i) => {
                        const isNum = col.num && totals[col.key] != null;
                        return (
                          <td key={col.key} className={`py-2.5 px-3 whitespace-nowrap ${col.num ? 'text-right font-mono' : ''} ${col.key === 'Qlik_Total_Profit' ? ((totals.Qlik_Net_Profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500') : ''}`}>
                            {i === 0 ? 'TOTAL' : isNum ? (col.isPercent ? fmt(totals.Buyer_Invoice ? (totals.Net_Profit / totals.Buyer_Invoice) * 100 : null, true) : fmt(col.key === 'Qlik_Total_Profit' ? totals.Qlik_Net_Profit : totals[col.key])) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        ) : !loading && !error ? (
          <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
            <TrendingUp className="w-10 h-10 opacity-20" />
            <span className="text-sm">Select a period and click Run to load P&L data</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}