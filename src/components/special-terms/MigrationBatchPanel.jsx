import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Search } from 'lucide-react';
import { appClient } from '@/api/appClient';
import StateBlock from '@/components/common/StateBlock';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function MigrationBatchPanel({ canDraft, canApprove, onOpenTerm }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async (force = false) => {
    setLoading(true); setError('');
    const response = await appClient.functions.invoke('specialTermMigrationBatchList', { force, limit: 20 }, { cache: false });
    if (response.data?.error) setError(response.data.error); else setData(response.data || null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const rows = useMemo(() => (data?.batches || data?.terms || []).filter((row) => !query.trim() || String(row.termName || row.name || '').toLowerCase().includes(query.trim().toLowerCase())), [data, query]);
  if (loading && !data) return <StateBlock title="Loading whole-term migration queue" description="Grouping legacy clauses without changing Salesforce wording." icon={Loader2} />;
  return <div className="space-y-4">
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3"><div><p className="text-sm font-medium">Controlled migration batches</p><p className="text-xs text-muted-foreground">At most 20 related terms per batch. Low-risk exact groups remain explicitly subject to authorized approval.</p></div><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => load(true)} disabled={loading}><RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>{canDraft ? <Badge variant="secondary">Draft proposals enabled</Badge> : null}</div></div>
    <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search migration queue" className="pl-9" /></div>
    <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Special Term</th><th className="p-3">Revision</th><th className="p-3">Legacy segments</th><th className="p-3">Review</th><th className="p-3" /></tr></thead><tbody>{rows.map((row) => <tr key={row.termId || row.id} className="border-t border-border"><td className="p-3 font-medium">{row.termName || row.name}</td><td className="p-3"><Badge variant={row.revisionStatus === 'Approved' ? 'default' : 'outline'}>{row.revisionStatus || row.status || 'Legacy'}</Badge></td><td className="p-3">{row.segmentCount ?? row.clauseCount ?? '—'}</td><td className="p-3">{row.manualReviewRequired ? <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />Manual segmentation</span> : row.reviewLabel || 'Exact groups reviewed separately'}</td><td className="p-3 text-right"><Button type="button" size="sm" variant="outline" onClick={() => onOpenTerm?.({ id: row.termId || row.id, name: row.termName || row.name })}>Open</Button></td></tr>)}</tbody></table></div>
    {!rows.length ? <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No migration batches are available.</div> : null}
    {canApprove ? <p className="text-xs text-muted-foreground">Only the active General Manager or an Administrator can approve, activate, or roll back a prepared whole-term revision.</p> : null}
  </div>;
}
