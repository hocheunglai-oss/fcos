import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Search } from 'lucide-react';
import { appClient } from '@/api/appClient';
import StateBlock from '@/components/common/StateBlock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function MigrationInventoryPanel() {
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('specialTermMigrationInventory', { force }, { cache: false });
    if (response.data?.error) setError(response.data.error);
    else setInventory(response.data || null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredTerms = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (inventory?.terms || []).filter((term) => !search || term.termName.toLowerCase().includes(search));
  }, [inventory?.terms, query]);

  if (loading && !inventory) return <StateBlock title="Building migration inventory" description="Parsing every live Salesforce Special Term without changing its wording." icon={Loader2} />;
  if (error && !inventory) return <StateBlock title="Migration inventory unavailable" description={error} icon={AlertTriangle} action={<Button onClick={() => load(true)}>Retry</Button>} />;

  const summary = inventory?.summary || {};
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium">Complete live-corpus review inventory</p><p className="text-xs text-muted-foreground">Exact groups ignore only outer numbering, case, and harmless whitespace. No near match is merged automatically.</p></div>
        <div className="flex gap-2"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search term" className="pl-9 sm:w-64" /></div><Button variant="outline" onClick={() => load(true)} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[['Terms', summary.termCount], ['Populated / empty', `${summary.populatedTermCount || 0} / ${summary.emptyTermCount || 0}`], ['Plain / manual', `${summary.plainlyNumberedTermCount || 0} / ${summary.manualReviewTermCount || 0}`], ['Exact duplicate groups', summary.duplicateGroupCount]].map(([label, value]) => <section key={label} className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value ?? 0}</p></section>)}
      </div>

      <section className="space-y-3">
        <div><h3 className="font-semibold">Exact-normalized candidate groups</h3><p className="text-xs text-muted-foreground">An approver must still accept the canonical short name and wording before activation.</p></div>
        <div className="grid gap-3 xl:grid-cols-2">{(inventory?.duplicateGroups || []).map((group) => <article key={group.canonicalKey} className="rounded-lg border border-border bg-card p-4"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{group.suggestedShortName}</strong><Badge variant="outline">{group.suggestedCategory}</Badge><Badge variant="secondary">{group.occurrenceCount} occurrences</Badge></div><p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm">{group.clauseText}</p><p className="mt-2 text-xs text-muted-foreground">{group.occurrences.map((occurrence) => `${occurrence.termName} · ${occurrence.sequence}`).join(' · ')}</p></article>)}</div>
        {!inventory?.duplicateGroups?.length ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No exact-normalized duplicate groups remain.</div> : null}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Term-by-term status</h3>
        <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-border bg-muted/30 text-left"><tr><th className="p-3">Special Term</th><th className="p-3">Structure</th><th className="p-3">Parsed clauses</th><th className="p-3">Review</th></tr></thead><tbody>{filteredTerms.map((term) => <tr key={term.termId} className="border-b border-border last:border-0"><td className="p-3 font-medium">{term.termName}</td><td className="p-3"><Badge variant={term.structureStatus === 'Active' ? 'default' : 'outline'}>{term.structureStatus}</Badge></td><td className="p-3">{term.clauseCount}</td><td className="p-3">{term.manualReviewRequired ? <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />{term.reviewReason || 'Manual segmentation required'}</span> : term.populated ? 'Plain numbering detected' : 'Confirmed empty candidate'}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
