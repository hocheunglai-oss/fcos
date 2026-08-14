import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Combine, Loader2, Pencil, Plus, RefreshCw, Search, XCircle } from 'lucide-react';
import { appClient } from '@/api/appClient';
import StateBlock from '@/components/common/StateBlock';
import ClauseConsolidationQueue from '@/components/special-terms/ClauseConsolidationQueue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

const EMPTY_DRAFT = Object.freeze({ clauseId: null, versionId: null, shortName: '', category: 'Other', clauseText: '', revisionReason: '', expectedLastModifiedAt: null, expectedClauseLastModifiedAt: null });

function matchesView(clause, status) {
  if (status === 'Legacy') return clause.origin === 'Legacy' || clause.origin === 'legacy' || clause.status === 'Legacy';
  if (status === 'Draft') return Boolean(clause.draftVersion);
  return clause.status === status;
}

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ClauseBankPanel({ canManage, canApprove, categoryOptions = [], onChanged, onOpenTerm }) {
  const [clauses, setClauses] = useState([]);
  const [consolidations, setConsolidations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('Active');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(null);
  const [approval, setApproval] = useState(null);
  const [retirement, setRetirement] = useState(null);
  const [consolidation, setConsolidation] = useState(null);
  const [approvalPending, setApprovalPending] = useState(() => new Set());
  const approveButtons = useRef(new Map());

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    const [bankResponse, consolidationResponse] = await Promise.all([
      appClient.functions.invoke('specialTermClauseBank', { force, limit: 500 }, { cache: !force }),
      appClient.functions.invoke('specialTermClauseConsolidationList', {}, { cache: false }),
    ]);
    if (bankResponse.data?.error || consolidationResponse.data?.error) {
      setError(bankResponse.data?.error || consolidationResponse.data?.error);
      setClauses([]);
      setConsolidations([]);
    } else {
      setClauses(bankResponse.data?.clauses || []);
      setConsolidations(consolidationResponse.data?.consolidations || []);
    }
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

  const approveClause = async () => {
    const submitted = approval;
    if (!submitted || approvalPending.has(submitted.clause.draftVersion.id)) return;
    const versionId = submitted.clause.draftVersion.id;
    const viewport = { top: window.scrollY, left: window.scrollX };
    setApproval(null);
    setError('');
    setApprovalPending((current) => new Set(current).add(versionId));
    const response = await appClient.functions.invoke('specialTermClauseApprove', {
      clauseId: submitted.clause.id,
      versionId,
      approvalReason: submitted.reason,
      expectedClauseLastModifiedAt: submitted.clause.lastModifiedAt,
      expectedVersionLastModifiedAt: submitted.clause.draftVersion.lastModifiedAt,
      operationId: operationId(),
    }, { cache: false });
    setApprovalPending((current) => {
      const next = new Set(current);
      next.delete(versionId);
      return next;
    });
    if (response.data?.error || !response.data?.clause) {
      setError(response.data?.error || 'Salesforce did not return the approved clause state. Refresh before retrying.');
      window.requestAnimationFrame(() => {
        window.scrollTo({ ...viewport, behavior: 'auto' });
        approveButtons.current.get(versionId)?.focus({ preventScroll: true });
      });
      return;
    }
    setClauses((current) => current.map((clause) => clause.id === response.data.clause.id ? response.data.clause : clause));
    toast({ title: `${submitted.clause.shortName} approved`, description: 'The next Draft remains ready for review.' });
    window.requestAnimationFrame(() => {
      window.scrollTo({ ...viewport, behavior: 'auto' });
      const next = [...approveButtons.current.values()].find((button) => button && !button.disabled);
      next?.focus({ preventScroll: true });
    });
  };

  const startConsolidation = async () => {
    if (!consolidation) return;
    const replacement = clauses.find((clause) => clause.id === consolidation.replacementClauseId);
    if (!replacement) return;
    setBusy(true);
    setError('');
    const response = await appClient.functions.invoke('specialTermClauseConsolidationStart', {
      sourceClauseId: consolidation.source.id,
      replacementClauseId: replacement.id,
      expectedSourceLastModifiedAt: consolidation.source.lastModifiedAt,
      expectedReplacementLastModifiedAt: replacement.lastModifiedAt,
      reason: consolidation.reason,
      equivalenceConfirmed: consolidation.equivalenceConfirmed,
      operationId: operationId(),
    }, { cache: false });
    setBusy(false);
    if (response.data?.error) {
      setError(response.data.error);
      return;
    }
    setConsolidation(null);
    toast({ title: 'Clause consolidation started', description: 'Affected Special Terms now require governed relinking.' });
    await load(true);
  };

  const replacementClause = consolidation ? clauses.find((clause) => clause.id === consolidation.replacementClauseId) : null;

  if (loading && !clauses.length) return <StateBlock title="Loading Clause Bank" description="Reading versioned wording from Salesforce." icon={Loader2} />;

  return (
    <div className="space-y-4">
      <span className="sr-only" aria-live="polite">{message}</span>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <ClauseConsolidationQueue consolidations={consolidations} clauses={clauses} canManage={canManage} canApprove={canApprove} onOpenTerm={onOpenTerm} onChanged={() => load(true)} onError={setError} />
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
                {canManage && clause.status === 'Active' && !clause.draftVersion && !clause.consolidation ? <Button size="sm" variant="outline" onClick={() => openRevision(clause)}><Pencil className="mr-1 h-3.5 w-3.5" />Propose revision</Button> : null}
                {canManage && clause.status !== 'Retired' && clause.draftVersion ? <Button size="sm" variant="outline" onClick={() => openDraft(clause)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit Draft</Button> : null}
                {canApprove && clause.draftVersion ? <Button ref={(node) => { if (node) approveButtons.current.set(clause.draftVersion.id, node); else approveButtons.current.delete(clause.draftVersion.id); }} data-clause-approve={clause.draftVersion.id} size="sm" disabled={approvalPending.has(clause.draftVersion.id)} onClick={() => setApproval({ clause, reason: '' })}>{approvalPending.has(clause.draftVersion.id) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}{approvalPending.has(clause.draftVersion.id) ? 'Approving…' : 'Approve'}</Button> : null}
                {canApprove && clause.status === 'Active' && !clause.consolidation ? <Button size="sm" variant="outline" onClick={() => setConsolidation({ source: clause, replacementClauseId: '', reason: '', equivalenceConfirmed: false })}><Combine className="mr-1 h-3.5 w-3.5" />Consolidate</Button> : null}
                {canApprove && clause.status === 'Active' && !clause.consolidation ? <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRetirement({ clause, reason: '' })}><XCircle className="mr-1 h-3.5 w-3.5" />Retire</Button> : null}
              </div>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayVersion?.clauseText || 'No approved wording yet.'}</p>
            {clause.origin === 'Legacy' && clause.legacyOriginalText && displayVersion?.clauseText !== clause.legacyOriginalText ? <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50/40 p-3 md:grid-cols-2"><section><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preserved legacy wording</p><p className="mt-2 whitespace-pre-wrap text-xs">{clause.legacyOriginalText}</p></section><section><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Proposed wording</p><p className="mt-2 whitespace-pre-wrap text-xs">{displayVersion?.clauseText}</p></section></div> : null}
            {clause.draftVersion && clause.latestApprovedVersion ? <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Draft v{clause.draftVersion.revisionNumber} is awaiting approval. Existing terms remain on approved v{clause.latestApprovedVersion.revisionNumber}.</div> : null}
            {clause.consolidation ? <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">Relinking to {clause.consolidation.replacementShortName} v{clause.consolidation.replacementRevisionNumber}. Existing Special Terms remain unchanged until their whole-term revisions are approved.</div> : null}
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

      <Dialog open={Boolean(approval)} onOpenChange={(open) => !open && setApproval(null)}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Approve {approval?.clause?.shortName}</DialogTitle><DialogDescription>Approval publishes Draft v{approval?.clause?.draftVersion?.revisionNumber}. Existing terms remain on their current version and will show an upgrade badge.</DialogDescription></DialogHeader>{approval ? <><div className="rounded-lg border border-border p-3"><p className="whitespace-pre-wrap text-sm">{approval.clause.draftVersion.clauseText}</p></div><div className="space-y-1.5"><Label>Approval reason</Label><Textarea value={approval.reason} onChange={(event) => setApproval((current) => ({ ...current, reason: event.target.value }))} rows={3} /></div></> : null}<DialogFooter><Button variant="outline" onClick={() => setApproval(null)}>Cancel</Button><Button disabled={approval?.reason.trim().length < 3} onClick={approveClause}>Approve version</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(retirement)} onOpenChange={(open) => !open && !busy && setRetirement(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Retire {retirement?.clause?.shortName}</DialogTitle><DialogDescription>Retirement prevents new use. Existing Special Terms retain their approved version.</DialogDescription></DialogHeader>{retirement ? <div className="space-y-1.5"><Label>Retirement reason</Label><Textarea value={retirement.reason} onChange={(event) => setRetirement((current) => ({ ...current, reason: event.target.value }))} rows={4} /></div> : null}<DialogFooter><Button variant="outline" onClick={() => setRetirement(null)} disabled={busy}>Cancel</Button><Button variant="destructive" disabled={busy || retirement?.reason.trim().length < 3} onClick={() => mutate('specialTermClauseRetire', { clauseId: retirement.clause.id, retirementReason: retirement.reason, expectedLastModifiedAt: retirement.clause.lastModifiedAt }, 'Clause retired. Existing assignments were preserved.')}>{busy ? 'Retiring…' : 'Retire clause'}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(consolidation)} onOpenChange={(open) => !open && !busy && setConsolidation(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Consolidate {consolidation?.source?.shortName}</DialogTitle><DialogDescription>The source remains approved until every affected Special Term is relinked and its whole-term revision is approved.</DialogDescription></DialogHeader>
          {consolidation ? <div className="space-y-4">
            <div className="space-y-1.5"><Label>Replacement clause</Label><Select value={consolidation.replacementClauseId || undefined} onValueChange={(replacementClauseId) => setConsolidation((current) => ({ ...current, replacementClauseId }))}><SelectTrigger><SelectValue placeholder="Select an approved replacement" /></SelectTrigger><SelectContent>{clauses.filter((clause) => clause.status === 'Active' && clause.id !== consolidation.source.id && !clause.consolidation).map((clause) => <SelectItem key={clause.id} value={clause.id}>{clause.shortName} · v{clause.latestApprovedVersion?.revisionNumber || 0}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-3 md:grid-cols-2"><section className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source wording</p><p className="mt-2 whitespace-pre-wrap text-sm">{consolidation.source.latestApprovedVersion?.clauseText}</p></section><section className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Replacement wording</p><p className="mt-2 whitespace-pre-wrap text-sm">{replacementClause?.latestApprovedVersion?.clauseText || 'Select a replacement clause.'}</p></section></div>
            <div className="space-y-1.5"><Label>Consolidation reason</Label><Textarea value={consolidation.reason} maxLength={1000} rows={3} onChange={(event) => setConsolidation((current) => ({ ...current, reason: event.target.value }))} /></div>
            <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><Checkbox checked={consolidation.equivalenceConfirmed} onCheckedChange={(checked) => setConsolidation((current) => ({ ...current, equivalenceConfirmed: checked === true }))} /><span>I confirm the clauses have the same contractual meaning and do not differ in amounts, deadlines, entities, ports, products, standards, or jurisdictions.</span></label>
          </div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setConsolidation(null)} disabled={busy}>Cancel</Button><Button onClick={startConsolidation} disabled={busy || !replacementClause || consolidation?.reason.trim().length < 3 || !consolidation?.equivalenceConfirmed}>{busy ? 'Starting…' : 'Start consolidation'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
