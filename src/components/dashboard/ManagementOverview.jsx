import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useNavigationAwareRequest } from '@/hooks/useNavigationAwareRequest';
import { managementOverviewLinks, managementWorkSummary } from '@/lib/managementOverview';

export default function ManagementOverview() {
  const { hasModuleAccess } = useAuth();
  const { request } = useNavigationAwareRequest('dashboard');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const links = managementOverviewLinks(hasModuleAccess);
  const refresh = async () => {
    if (loading) return;
    setLoading(true); setError('');
    try {
      await request({ name: 'workCommitmentsList', force: true, apply: response => {
        if (response.data?.error) throw new Error(response.data.error);
        setSummary(managementWorkSummary(response.data));
      } });
    } catch (failure) { setError(failure?.message || 'Personal work could not be checked.'); }
    finally { setLoading(false); }
  };
  return <section aria-label="Management overview" className="hidden rounded-xl border border-border bg-card p-4 lg:block">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold">Work and reconciliation</h2>
      <p className="mt-1 text-xs text-muted-foreground">Work and collections use their own date ranges. Financial figures above use Dashboard filters.</p>
    </div>{<Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>{loading ? 'Checking work…' : 'Check my work'}</Button>}</div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}{summary ? ' Last checked personal counts are retained.' : ' Counts are unavailable.'}</p>}
    <p className="mt-3 text-xs text-muted-foreground">{summary
      ? `Your loaded work: ${summary.overdue} overdue · ${summary.needsAction} needing action · ${summary.loaded} total · Checked ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(summary.checkedAt))} HKT${summary.partial ? ' · Partial: open My Commitments for source limitations.' : ''}`
      : 'Personal work counts have not been checked. Open the relevant workspace for its latest evidence.'}</p>
    <div className="mt-3 grid grid-cols-2 gap-3">{links.map(link => <Link key={link.to} to={link.to} className="rounded-lg border border-border p-3 hover:bg-muted/50"><p className="text-sm font-medium">{link.label}</p><p className="mt-1 text-xs text-muted-foreground">{link.description}</p></Link>)}</div>
  </section>;
}
