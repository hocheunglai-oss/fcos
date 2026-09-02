import { useDeferredValue, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileClock, Link2, Search, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { specialTermReadiness } from '@/lib/specialTermsWorkflow';

const FILTERS = Object.freeze([
  { value: 'all', label: 'All terms' },
  { value: 'action', label: 'Needs action' },
  { value: 'approval', label: 'Ready for approval' },
  { value: 'relink', label: 'Relink required' },
  { value: 'legacy', label: 'Migration required' },
  { value: 'ready', label: 'Approved and ready' },
]);

function stateIcon(state) {
  if (state === 'ready') return CheckCircle2;
  if (state === 'approval') return ShieldCheck;
  if (state === 'relink') return Link2;
  if (state === 'legacy' || state === 'draft') return FileClock;
  return AlertTriangle;
}

function stateBadge(state) {
  if (state === 'ready') return 'default';
  if (state === 'relink') return 'destructive';
  return 'outline';
}

function projectionLabel(projection) {
  if (projection.proposed) return `${projection.proposed} proposed`;
  if (projection.upgrades) return `${projection.upgrades} upgrade${projection.upgrades === 1 ? '' : 's'}`;
  if (projection.status === 'Active') return `${projection.active} active`;
  return projection.status;
}

export default function SpecialTermReadinessPanel({ terms = [], rulesByTerm = new Map(), canApprove = false, onOpenTerm }) {
  const [filter, setFilter] = useState('action');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const rows = useMemo(() => terms.map((term) => ({
    term,
    readiness: specialTermReadiness(term, (rulesByTerm.get(term.id) || []).length),
  })), [rulesByTerm, terms]);
  const filtered = useMemo(() => rows.filter(({ term, readiness }) => {
    if (deferredQuery && !String(term.name || '').toLowerCase().includes(deferredQuery)) return false;
    if (filter === 'all') return true;
    if (filter === 'action') return !['ready', 'retired'].includes(readiness.state);
    return readiness.state === filter;
  }), [deferredQuery, filter, rows]);
  const counts = useMemo(() => rows.reduce((result, row) => {
    result[row.readiness.state] = Number(result[row.readiness.state] || 0) + 1;
    if (!['ready', 'retired'].includes(row.readiness.state)) result.action += 1;
    return result;
  }, { action: 0 }), [rows]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[['action', 'Needs action'], ['approval', 'Ready for approval'], ['relink', 'Relink required'], ['legacy', 'Migration required'], ['ready', 'Approved and ready']].map(([state, label]) => <button type="button" key={state} onClick={() => setFilter(state)} className={`rounded-lg border p-3 text-left transition-colors ${filter === state ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/30'}`}><span className="text-2xl font-semibold">{counts[state] || 0}</span><span className="mt-1 block text-xs text-muted-foreground">{label}</span></button>)}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">Whole-term readiness</p><p className="text-xs text-muted-foreground">One row shows the complete approval boundary: Terms Text, both special remarks, and the rule snapshot.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Select value={filter} onValueChange={setFilter}><SelectTrigger className="sm:w-52" aria-label="Readiness filter"><SelectValue /></SelectTrigger><SelectContent>{FILTERS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Special Terms" className="pl-9 sm:w-64" /></div></div></div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Special Term</th><th className="p-3">Terms Text</th><th className="p-3">Confirmation</th><th className="p-3">Nomination</th><th className="p-3">Rules</th><th className="p-3">Overall</th><th className="p-3" /></tr></thead><tbody>{filtered.map(({ term, readiness }) => { const Icon = stateIcon(readiness.state); return <tr key={term.id} className="border-t border-border"><td className="p-3 font-medium">{term.name}</td>{readiness.projections.map((projection) => <td key={projection.key} className="p-3"><Badge variant={projection.status === 'Active' && !projection.proposed && !projection.upgrades ? 'secondary' : 'outline'}>{projection.status}</Badge><span className="mt-1 block text-xs text-muted-foreground">{projectionLabel(projection)}</span></td>)}<td className="p-3">{readiness.ruleCount} rule{readiness.ruleCount === 1 ? '' : 's'}</td><td className="max-w-xs p-3"><div className="flex items-center gap-1.5"><Icon className="h-4 w-4" /><Badge variant={stateBadge(readiness.state)}>{readiness.label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{readiness.reason}</p></td><td className="p-3 text-right"><Button type="button" size="sm" variant={readiness.state === 'approval' && canApprove ? 'default' : 'outline'} onClick={() => onOpenTerm?.(term)}>{readiness.state === 'approval' && canApprove ? 'Review and approve' : readiness.state === 'ready' ? 'Open history' : 'Continue review'}</Button></td></tr>; })}</tbody></table>{!filtered.length ? <div className="p-10 text-center text-sm text-muted-foreground">No Special Terms match this readiness view.</div> : null}</div>
    </div>
  );
}
