import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import { appClient } from '@/api/appClient';
import StateBlock from '@/components/common/StateBlock';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const EMPTY_DRAFT = Object.freeze({ clauseId: null, versionId: null, shortName: '', category: 'Other', clauseText: '', revisionReason: '', expectedLastModifiedAt: null, expectedClauseLastModifiedAt: null });

function matchesView(clause, status) {
  if (status === 'Legacy') return clause.origin === 'Legacy' || clause.origin === 'legacy' || clause.status === 'Legacy';
  if (status === 'Draft') return Boolean(clause.draftVersion);
  return clause.status === status;
}

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ClauseBankPanel({ canManage, canApprove, categoryOptions = [], onChanged }) {
  const [clauses, setClauses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('Active');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(null);
  const [approval, setApproval] = useState(null);
  const [retirement, setRetirement] = useState(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('specialTermClauseBank', { force, limit: 500 }, { cache: !force });
    if (response.data?.error) {
      setError(response.data.error);
      setClauses([]);
    } else setClauses(response.data?.clauses || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return clauses.filter((clause) => matchesView(clause, status) && (!search || [clause.shortName, clause.category, clause.legacyOriginalText, clause.latestApprovedVersion?.clauseText, clause.draftVersion?.clauseText].some((value) => String(value || '').toLowerCase().includes(search))));
  }, [clauses, query, status]);

  const mutate = async (functionName, payload, successMessage) => {
    setBusy(true);
    setError('');
    setMessage('');
    const response = await appClient.functions.invoke(functionName, { ...payload, operationId: operationId() }, { cache: false });
    if (response.data?.error) setError(response.data.error);
    else {
      setMessage(successMessage);
      setDraft(null);
      setApproval(null);
      setRetirement(null);
      await load(true);
      onChanged?.();
    }
    setBusy(false);
  };

  const openNew = () => setDraft({ ...EMPTY_DRAFT });
  const openRevision = (clause) => setDraft({ ...EMPTY_DRAFT, clauseId: clause.id, shortName: clause.shortName, category: clause.category, clauseText: clause.latestApprovedVersion?.clauseText || '', revisionReason: '', expectedLastModifiedAt: clause.lastModifiedAt });
  const openDraft = (clause) => setDraft({ ...EMPTY_DRAFT, clauseId: clause.id, versionId: clause.draftVersion?.id, shortName: clause.shortName, category: clause.category, clauseText: clause.draftVersion?.clauseText || '', revisionReason: clause.draftVersion?.revisionReason || '', expectedLastModifiedAt: clause.draftVersion?.lastModifiedAt, expectedClauseLastModifiedAt: clause.lastModifiedAt });

  if (loading && !clauses.length) return <StateBlock title="Loading Clause Bank" description="Reading versioned wording from Salesforce." icon={Loader2} />;

  return (
    <div className="space-y-4">
      {message ? <Alert><ShieldCheck className="h-4 w-4" /><AlertDescription>{message}</AlertDescription></Alert> : null}
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">{[{ value: 'Active', label: 'Approved' }, { value: 'Draft', label: 'Draft' }, { value: 'Legacy', label: 'Legacy' }, { value: 'Retired', label: 'Retired' }].map((view) => <Button key={view.value} type="button" size="sm" variant={status === view.value ? 'default' : 'outline'} onClick={() => setStatus(view.value)}>{view.label}<Badge variant="secondary" className="ml-2">{clauses.filter((clause) => matchesView(clause, view.value)).length}</Badge></Button>)}</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clause bank" className="pl-9 sm:w-72" /></div>
          <Button variant="outline" onClick={() => load(true)} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
          {canManage ? <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Propose clause</Button> : null}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">{filtered.map((clause) => {
        const displayVersion = status === 'Draft' ? clause.draftVersion : clause.latestApprovedVersion || clause.legacyVersion;
        return (
          <section key={clause.id} className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex flex-wrap items-center gap-2"><strong>{clause.shortName}</strong><Badge variant="outline">{clause.category}</Badge><Badge variant={clause.status === 'Retired' ? 'destructive' : 'secondary'}>{clause.status === 'Active' ? 'Approved' : clause.status}</Badge>{clause.origin ? <Badge variant="outline">{clause.origin}</Badge> : null}{displayVersion ? <Badge variant="secondary">v{displayVersion.revisionNumber}</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">Used in {clause.usageCount} Special Term assignment(s){clause.provenance?.termName ? ` · preserved from ${clause.provenance.termName}` : ''}</p></div>
              <div className="flex flex-wrap gap-1">
                {canManage && clause.status === 'Active' && !clause.draftVersion ? <Button size="sm" variant="outline" onClick={() => openRevision(clause)}><Pencil className="mr-1 h-3.5 w-3.5" />Propose revision</Button> : null}
                {canManage && clause.status !== 'Retired' && clause.draftVersion ? <Button size="sm" variant="outline" onClick={() => openDraft(clause)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit Draft</Button> : null}
                {canApprove && clause.draftVersion ? <Button size="sm" onClick={() => setApproval({ clause, reason: '' })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve</Button> : null}
                {canApprove && clause.status === 'Active' ? <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRetirement({ clause, reason: '' })}><XCircle className="mr-1 h-3.5 w-3.5" />Retire</Button> : null}
              </div>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayVersion?.clauseText || 'No approved wording yet.'}</p>
            {clause.origin === 'Legacy' && clause.legacyOriginalText && displayVersion?.clauseText !== clause.legacyOriginalText ? <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50/40 p-3 md:grid-cols-2"><section><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preserved legacy wording</p><p className="mt-2 whitespace-pre-wrap text-xs">{clause.legacyOriginalText}</p></section><section><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Proposed wording</p><p className="mt-2 whitespace-pre-wrap text-xs">{displayVersion?.clauseText}</p></section></div> : null}
            {clause.draftVersion && clause.latestApprovedVersion ? <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Draft v{clause.draftVersion.revisionNumber} is awaiting approval. Existing terms remain on approved v{clause.latestApprovedVersion.revisionNumber}.</div> : null}
          </section>
        );
      })}</div>
      {!filtered.length ? <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">No clauses match this view.</div> : null}

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && !busy && setDraft(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{draft?.versionId ? 'Edit Draft clause' : draft?.clauseId ? 'Propose clause revision' : 'Propose a bank clause'}</DialogTitle><DialogDescription>Do not include the top-level number. Published wording remains unchanged until an authorized approver accepts this Draft.</DialogDescription></DialogHeader>
          {draft ? <div className="space-y-4"><div className="grid gap-4 md:grid-cols-2"><div className="space-y-1.5"><Label>Short name</Label><Input value={draft.shortName} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, shortName: event.target.value }))} placeholder="Best Endeavours – No Demurrage" /><p className="text-xs text-muted-foreground">Use 3–7 concise, action-oriented words and include material qualifiers.</p></div><div className="space-y-1.5"><Label>Category</Label><Select value={draft.category} onValueChange={(category) => setDraft((current) => ({ ...current, category }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categoryOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div></div><div className="space-y-1.5"><Label>Clause wording</Label><Textarea value={draft.clauseText} onChange={(event) => setDraft((current) => ({ ...current, clauseText: event.target.value }))} rows={10} placeholder="Enter the clause without 1., 2., or another top-level number." /></div><div className="space-y-1.5"><Label>Revision reason</Label><Textarea value={draft.revisionReason} maxLength={1000} onChange={(event) => setDraft((current) => ({ ...current, revisionReason: event.target.value }))} rows={3} /></div></div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button><Button disabled={busy || !draft?.shortName.trim() || draft?.clauseText.trim().length < 3 || draft?.revisionReason.trim().length < 3} onClick={() => mutate('specialTermClauseDraftSave', draft, draft?.versionId ? 'Draft clause updated.' : draft?.clauseId ? 'New clause revision proposed.' : 'New bank clause proposed.')}>{busy ? 'Saving…' : 'Save Draft'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(approval)} onOpenChange={(open) => !open && !busy && setApproval(null)}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Approve {approval?.clause?.shortName}</DialogTitle><DialogDescription>Approval publishes Draft v{approval?.clause?.draftVersion?.revisionNumber}. Existing terms remain on their current version and will show an upgrade badge.</DialogDescription></DialogHeader>{approval ? <><div className="rounded-lg border border-border p-3"><p className="whitespace-pre-wrap text-sm">{approval.clause.draftVersion.clauseText}</p></div><div className="space-y-1.5"><Label>Approval reason</Label><Textarea value={approval.reason} onChange={(event) => setApproval((current) => ({ ...current, reason: event.target.value }))} rows={3} /></div></> : null}<DialogFooter><Button variant="outline" onClick={() => setApproval(null)} disabled={busy}>Cancel</Button><Button disabled={busy || approval?.reason.trim().length < 3} onClick={() => mutate('specialTermClauseApprove', { clauseId: approval.clause.id, versionId: approval.clause.draftVersion.id, approvalReason: approval.reason, expectedClauseLastModifiedAt: approval.clause.lastModifiedAt, expectedVersionLastModifiedAt: approval.clause.draftVersion.lastModifiedAt }, 'Clause version approved. Existing terms can now upgrade selectively.')}>{busy ? 'Approving…' : 'Approve version'}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(retirement)} onOpenChange={(open) => !open && !busy && setRetirement(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Retire {retirement?.clause?.shortName}</DialogTitle><DialogDescription>Retirement prevents new use. Existing Special Terms retain their approved version.</DialogDescription></DialogHeader>{retirement ? <div className="space-y-1.5"><Label>Retirement reason</Label><Textarea value={retirement.reason} onChange={(event) => setRetirement((current) => ({ ...current, reason: event.target.value }))} rows={4} /></div> : null}<DialogFooter><Button variant="outline" onClick={() => setRetirement(null)} disabled={busy}>Cancel</Button><Button variant="destructive" disabled={busy || retirement?.reason.trim().length < 3} onClick={() => mutate('specialTermClauseRetire', { clauseId: retirement.clause.id, retirementReason: retirement.reason, expectedLastModifiedAt: retirement.clause.lastModifiedAt }, 'Clause retired. Existing assignments were preserved.')}>{busy ? 'Retiring…' : 'Retire clause'}</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
