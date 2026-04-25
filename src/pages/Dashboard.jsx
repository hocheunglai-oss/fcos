import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import StatCard from '@/components/dashboard/StatCard';
import RecentStemsTable from '@/components/dashboard/RecentStemsTable';
import { Package, Building2, DollarSign, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await base44.functions.invoke('salesforceDashboard', {});
    setData(res.data);
    setLastRefresh(new Date());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-dm tracking-tight">Dashboard</h1>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last updated {format(lastRefresh, 'HH:mm:ss')}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card rounded-xl border border-border p-5 h-28 animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Total STEMs"
              value={data.stemTotal?.toLocaleString() ?? '—'}
              icon={Package}
              color="blue"
            />
            <StatCard
              label="Total Accounts"
              value={data.accountTotal?.toLocaleString() ?? '—'}
              icon={Building2}
              color="green"
            />
            <StatCard
              label="Disputed STEMs"
              value="—"
              sub="Filter in Report Builder"
              icon={AlertCircle}
              color="red"
            />
            <StatCard
              label="Total Profit"
              value={data.totalProfit != null ? `$${data.totalProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
              sub={data.totalProfit == null ? 'No profit field found' : undefined}
              icon={DollarSign}
              color="amber"
            />
          </div>

          {/* Charts row */}
          {(data.stemByStatus?.length > 0 || data.stemByType?.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {data.stemByStatus?.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4">STEMs by Status</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.stemByStatus} barSize={32}>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {data.stemByStatus.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {data.stemByType?.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4">STEMs by Type</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.stemByType} barSize={32}>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {data.stemByType.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Recent STEMs */}
          <div className="bg-card rounded-xl border border-border">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Recent STEMs</h3>
              <span className="text-xs text-muted-foreground">{data.recentStems?.length} records</span>
            </div>
            <div className="p-2">
              <RecentStemsTable records={data.recentStems || []} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}