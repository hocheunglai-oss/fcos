import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import StateBlock from '@/components/common/StateBlock';
import DataStatus from '@/components/common/DataStatus';
import WorkspaceViewBar from '@/components/common/WorkspaceViewBar';
import WorkflowValidationSummary from '@/components/common/WorkflowValidationSummary';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { SPECIAL_TERMS_METHODOLOGY } from '@/lib/pageMethodologies';
import { prefetchSpecialTermDetail } from '@/lib/specialTermDetailPrefetch';

const ClauseBankPanel = lazy(() => import('@/components/special-terms/ClauseBankPanel'));
const MigrationBatchPanel = lazy(() => import('@/components/special-terms/MigrationBatchPanel'));
const MigrationInventoryPanel = lazy(() => import('@/components/special-terms/MigrationInventoryPanel'));

const STATUS_OPTIONS = ['all', 'Legacy', 'Draft', 'Ready for approval', 'Relink required', 'Approved'];
const ACTION_LABELS = Object.freeze({
  update: 'Update',
  continue: 'Continue',
  review_publish: 'Review & publish',
  resolve_relink: 'Resolve relink',
});
const HONG_KONG_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Hong_Kong' });

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function displayDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return HONG_KONG_DATE_FORMATTER.format(date);
}

function triggerDownload(result) {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function SpecialTerms() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState('terms');
  const [summary, setSummary] = useState(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState('all');
  const [cursor, setCursor] = useState('');
  const [cursorHistory, setCursorHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [responseMeta, setResponseMeta] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [createForm, setCreateForm] = useState(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createSaveAttempted, setCreateSaveAttempted] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteSaveAttempted, setDeleteSaveAttempted] = useState(false);
  const [rowPending, setRowPending] = useState(() => new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedView, setAdvancedView] = useState('migration');
  const requestSequence = useRef(0);

  const load = useCallback(async ({ force = false, requestedCursor = cursor, preserve = false } = {}) => {
    const requestId = ++requestSequence.current;
    if (!preserve) setLoading(true);
    else setRefreshing(true);
    setError('');
    const response = await appClient.functions.invoke('specialTermsSummaryList', {
      query: deferredSearch,
      status: status === 'all' ? '' : status,
      cursor: requestedCursor,
      limit: 40,
      force,
    }, { cache: !force });
    if (requestId !== requestSequence.current) return;
    setResponseMeta(response.meta || null);
    if (response.data?.error) setError(response.data.error);
    else setSummary(response.data);
    setLoading(false);
    setRefreshing(false);
  }, [cursor, deferredSearch, status]);

  useEffect(() => {
    if (workspace !== 'terms') return undefined;
    const timer = window.setTimeout(() => { void load({ preserve: true }); }, 200);
    return () => window.clearTimeout(timer);
  }, [load, workspace]);

  useEffect(() => {
    const requestedTermId = searchParams.get('termId');
    const requestedTab = searchParams.get('tab');
    if (requestedTermId) navigate(`/special-terms/${requestedTermId}`, { replace: true });
    else if (requestedTab === 'clauses') setWorkspace('clauses');
    else if (['migration', 'inventory'].includes(requestedTab)) {
      setAdvancedOpen(true);
      setAdvancedView(requestedTab);
    }
  }, [navigate, searchParams]);

  const changeSearch = (value) => {
    setSearch(value);
    setCursor('');
    setCursorHistory([]);
  };

  const changeStatus = (value) => {
    setStatus(value);
    setCursor('');
    setCursorHistory([]);
  };

  const nextPage = () => {
    if (!summary?.nextCursor) return;
    setCursorHistory((current) => [...current, cursor]);
    setCursor(summary.nextCursor);
  };

  const previousPage = () => {
    if (!cursorHistory.length) return;
    setCursor(cursorHistory[cursorHistory.length - 1]);
    setCursorHistory(cursorHistory.slice(0, -1));
  };

  const openTerm = (term) => navigate(`/special-terms/${term.id}`);

  const createTerm = async () => {
    setCreateSaveAttempted(true);
    if (!createForm?.name.trim() || createBusy) return;
    setCreateBusy(true);
    setError('');
    const response = await appClient.functions.invoke('specialTermsSave', {
      name: createForm.name.trim(),
      addToConfirmation: createForm.addToConfirmation,
      addToNomination: createForm.addToNomination,
      operationId: operationId(),
    }, { cache: false });
    setCreateBusy(false);
    if (response.data?.error) {
      setError(response.data.error);
      return;
    }
    setCreateForm(null);
    setCreateSaveAttempted(false);
    navigate(`/special-terms/${response.data.id}`);
  };

  const download = async (term, format) => {
    const key = `download:${term.id}:${format}`;
    if (rowPending.has(key)) return;
    setRowPending((current) => new Set(current).add(key));
    setError('');
    try {
      const result = await appClient.functions.download('specialTermsDocumentExport', {
        termId: term.id,
        format,
        source: 'live',
        expectedLastModifiedAt: term.lastModifiedAt,
      });
      triggerDownload(result);
    } catch (downloadError) {
      setError(downloadError.message || 'The document could not be downloaded.');
    } finally {
      setRowPending((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  };

  const previewDeletion = async (term) => {
    const key = `delete:${term.id}`;
    setRowPending((current) => new Set(current).add(key));
    setError('');
    const response = await appClient.functions.invoke('specialTermDeletePreview', { entityType: 'term', id: term.id }, { cache: false });
    setRowPending((current) => { const next = new Set(current); next.delete(key); return next; });
    if (response.data?.error || !response.data?.eligible) {
      setError(response.data?.error || (response.data?.blockers || ['This Special Term cannot be deleted.']).join(' '));
      return;
    }
    setDeleteTarget({ term, preview: response.data });
    setDeleteReason('');
    setDeleteConfirmation('');
    setDeleteSaveAttempted(false);
  };

  const deleteTerm = async () => {
    if (!deleteTarget) return;
    setDeleteSaveAttempted(true);
    const validationIssues = [
      ...(deleteConfirmation !== deleteTarget.preview.confirmationLabel ? [{ field: 'confirmation', message: `Type ${deleteTarget.preview.confirmationLabel} exactly.` }] : []),
      ...(deleteReason.trim().length < 3 ? [{ field: 'reason', message: 'Enter a deletion reason of at least three characters.' }] : []),
    ];
    if (validationIssues.length) return;
    const { term, preview } = deleteTarget;
    const key = `delete:${term.id}`;
    setDeleteTarget(null);
    setRowPending((current) => new Set(current).add(key));
    const response = await appClient.functions.invoke('specialTermsDelete', {
      id: term.id,
      expectedLastModifiedAt: preview.expectedLastModifiedAt,
      auditReason: deleteReason,
      confirmationName: preview.confirmationLabel,
      operationId: operationId(),
    }, { cache: false });
    setRowPending((current) => { const next = new Set(current); next.delete(key); return next; });
    if (response.data?.error) setError(response.data.error);
    else {
      setSummary((current) => current ? { ...current, total: Math.max(0, current.total - 1), terms: current.terms.filter((row) => row.id !== term.id) } : current);
      setMessage(`${term.name} was deleted from Salesforce.`);
      setDeleteSaveAttempted(false);
    }
  };

  const terms = summary?.terms || [];
  const createValidationIssues = !createForm?.name.trim() ? [{ field: 'name', message: 'Enter a Special Term name.' }] : [];
  const deleteValidationIssues = deleteTarget ? [
    ...(deleteConfirmation !== deleteTarget.preview.confirmationLabel ? [{ field: 'confirmation', message: `Type ${deleteTarget.preview.confirmationLabel} exactly.` }] : []),
    ...(deleteReason.trim().length < 3 ? [{ field: 'reason', message: 'Enter a deletion reason of at least three characters.' }] : []),
  ] : [];
  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader
        title="Special Terms"
        description="Find a term, make the complete update in one editor, and publish it through Salesforce governance."
        actions={<div className="flex flex-wrap gap-2"><PageMethodology {...SPECIAL_TERMS_METHODOLOGY} /><Button variant="outline" onClick={() => load({ force: true, preserve: true })} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>{workspace === 'terms' ? <Button onClick={() => { setCreateSaveAttempted(false); setCreateForm({ name: '', addToConfirmation: true, addToNomination: false }); }}><Plus className="mr-2 h-4 w-4" />New Special Term</Button> : null}</div>}
      />

      {message ? <Alert><ShieldCheck className="h-4 w-4" /><AlertDescription>{message}</AlertDescription></Alert> : null}
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <WorkspaceViewBar
        views={[{ id: 'terms', label: 'Special Terms', count: summary?.total || 0 }, { id: 'clauses', label: 'Clause Library' }]}
        value={workspace}
        onValueChange={setWorkspace}
        status={<DataStatus meta={responseMeta} state={refreshing ? 'refreshing' : undefined} label="Salesforce" />}
        trailing={workspace === 'terms' ? <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><div className="relative sm:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => changeSearch(event.target.value)} placeholder="Search term or clause name" className="pl-9" /></div><Select value={status} onValueChange={changeStatus}><SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option === 'all' ? 'All statuses' : option}</SelectItem>)}</SelectContent></Select></div> : null}
      />

      {workspace === 'terms' ? <>
        {loading && !summary ? <StateBlock title="Loading Special Terms" description="Loading lightweight Salesforce summaries. Contractual wording loads only when a term is opened." icon={Loader2} /> : null}
        {summary ? <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Special Term</TableHead><TableHead>Status</TableHead><TableHead>Contents</TableHead><TableHead>Updated</TableHead><TableHead className="w-80" /></TableRow></TableHeader>
              <TableBody>{terms.map((term) => <TableRow key={term.id} className="content-auto" onMouseEnter={() => { void prefetchSpecialTermDetail(term.id).catch(() => {}); }}><TableCell><div className="font-medium">{term.name}</div><div className="mt-1 flex gap-1"><Badge variant="outline">{term.addToConfirmation ? 'Confirmation PDF' : 'No Confirmation PDF'}</Badge><Badge variant="outline">{term.addToNomination ? 'Nomination PDF' : 'No Nomination PDF'}</Badge></div></TableCell><TableCell><Badge variant={term.status === 'Approved' ? 'default' : term.status === 'Relink required' ? 'destructive' : 'secondary'}>{term.status}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{term.activeClauseCount} active · {term.proposedClauseCount} proposed · {term.ruleCount} rules{term.upgradeCount ? ` · ${term.upgradeCount} upgrades` : ''}</TableCell><TableCell className="text-xs text-muted-foreground">{displayDate(term.lastModifiedAt)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => download(term, 'pdf')} disabled={rowPending.has(`download:${term.id}:pdf`)}><Download className="mr-1 h-3.5 w-3.5" />PDF</Button><Button variant="ghost" size="sm" onClick={() => download(term, 'docx')} disabled={rowPending.has(`download:${term.id}:docx`)}>Word</Button>{summary.instanceUrl ? <Button asChild variant="ghost" size="icon"><a href={`${summary.instanceUrl}/${term.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${term.name} in Salesforce`}><ExternalLink className="h-4 w-4" /></a></Button> : null}{['Legacy', 'Draft'].includes(term.status) ? <Button variant="ghost" size="icon" className="text-destructive" onClick={() => previewDeletion(term)} disabled={rowPending.has(`delete:${term.id}`)} aria-label={`Delete ${term.name}`}><Trash2 className="h-4 w-4" /></Button> : null}<Button onMouseEnter={() => { void prefetchSpecialTermDetail(term.id).catch(() => {}); }} onFocus={() => { void prefetchSpecialTermDetail(term.id).catch(() => {}); }} onClick={() => openTerm(term)}>{ACTION_LABELS[term.nextAction] || 'Update'}</Button></div></TableCell></TableRow>)}</TableBody>
            </Table>
          </div>
          <div className="divide-y divide-border md:hidden">{terms.map((term) => <article key={term.id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{term.name}</h2><p className="mt-1 text-xs text-muted-foreground">{term.activeClauseCount} clauses · {term.ruleCount} rules · {displayDate(term.lastModifiedAt)}</p></div><Badge variant={term.status === 'Approved' ? 'default' : 'secondary'}>{term.status}</Badge></div><div className="flex flex-wrap justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => download(term, 'pdf')} disabled={rowPending.has(`download:${term.id}:pdf`)}>PDF</Button><Button variant="ghost" size="sm" onClick={() => download(term, 'docx')} disabled={rowPending.has(`download:${term.id}:docx`)}>Word</Button><Button className="flex-1" onPointerEnter={() => { void prefetchSpecialTermDetail(term.id).catch(() => {}); }} onFocus={() => { void prefetchSpecialTermDetail(term.id).catch(() => {}); }} onClick={() => openTerm(term)}>{ACTION_LABELS[term.nextAction] || 'Update'}</Button></div></article>)}</div>
          {!terms.length ? <div className="p-12 text-center text-sm text-muted-foreground">No Special Terms match these filters.</div> : null}
          <div className="flex items-center justify-between border-t border-border px-4 py-3"><p className="text-xs text-muted-foreground">{summary.total} matching term{summary.total === 1 ? '' : 's'} · up to 40 per page</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={previousPage} disabled={!cursorHistory.length}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" onClick={nextPage} disabled={!summary.nextCursor}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
        </div> : null}
        <details className="rounded-lg border border-border bg-card p-4" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Advanced migration and history tools</summary>{advancedOpen ? <div className="mt-4 space-y-4"><div className="flex gap-2"><Button size="sm" variant={advancedView === 'migration' ? 'default' : 'outline'} onClick={() => setAdvancedView('migration')}>Migration queue</Button>{summary?.canApproveClauses ? <Button size="sm" variant={advancedView === 'inventory' ? 'default' : 'outline'} onClick={() => setAdvancedView('inventory')}>Migration inventory</Button> : null}</div><Suspense fallback={<StateBlock title="Loading advanced tools" description="Loading only the selected administrative view." icon={Loader2} />}>{advancedView === 'migration' ? <MigrationBatchPanel canDraft={summary?.canDraft} canApprove={summary?.canApproveClauses} onOpenTerm={openTerm} /> : <MigrationInventoryPanel />}</Suspense></div> : null}</details>
      </> : <Suspense fallback={<StateBlock title="Loading Clause Library" description="Loading the selected Clause Library page." icon={Loader2} />}><ClauseBankPanel canManage={summary?.canDraft ?? true} canApprove={summary?.canApproveClauses ?? false} currentUserEmail={summary?.currentUserEmail || ''} categoryOptions={summary?.clauseCategoryOptions || []} onChanged={() => {}} onOpenTerm={openTerm} /></Suspense>}

      <Dialog open={Boolean(createForm)} onOpenChange={(open) => { if (!open && !createBusy) { setCreateSaveAttempted(false); setCreateForm(null); } }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>New Special Term</DialogTitle><DialogDescription>Create the Salesforce identity, then continue directly in the complete term editor.</DialogDescription></DialogHeader>{createForm ? <div className="space-y-4"><div className="space-y-1.5"><Label>Name</Label><Input value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} autoFocus /></div><label className="flex items-center gap-2 text-sm"><Checkbox checked={createForm.addToConfirmation} onCheckedChange={(value) => setCreateForm((current) => ({ ...current, addToConfirmation: value === true }))} />Attach approved PDF to Confirmation</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={createForm.addToNomination} onCheckedChange={(value) => setCreateForm((current) => ({ ...current, addToNomination: value === true }))} />Attach approved PDF to Nomination</label><WorkflowValidationSummary issues={createSaveAttempted ? createValidationIssues : []} /></div> : null}<DialogFooter><Button variant="outline" onClick={() => { setCreateSaveAttempted(false); setCreateForm(null); }} disabled={createBusy}>Cancel</Button><Button onClick={createTerm} disabled={createBusy}>{createBusy ? 'Creating…' : 'Create and continue'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) { setDeleteSaveAttempted(false); setDeleteTarget(null); } }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Delete unapproved Special Term?</DialogTitle><DialogDescription>Only never-approved, unreferenced Salesforce records are eligible. This action is permanent.</DialogDescription></DialogHeader>{deleteTarget ? <div className="space-y-4"><div className="space-y-1.5"><Label>Type {deleteTarget.preview.confirmationLabel}</Label><Input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoFocus /></div><div className="space-y-1.5"><Label>Deletion reason</Label><Textarea value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} rows={3} /></div><WorkflowValidationSummary issues={deleteSaveAttempted ? deleteValidationIssues : []} /></div> : null}<DialogFooter><Button variant="outline" onClick={() => { setDeleteSaveAttempted(false); setDeleteTarget(null); }}>Cancel</Button><Button variant="destructive" onClick={deleteTerm}><Trash2 className="mr-2 h-4 w-4" />Delete</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
