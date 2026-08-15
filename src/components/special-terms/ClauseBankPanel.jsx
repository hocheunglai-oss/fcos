import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpenCheck, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Combine, FilterX, History, Loader2, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, XCircle } from 'lucide-react';
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
import {
  CLAUSE_ACTIONS,
  CLAUSE_BANK_VIEWS,
  clauseActionDetails,
  clauseDraftQuality,
  clauseMatchesView,
  loadClauseBankPreferences,
  materialHighlights,
  saveClauseBankPreferences,
} from '@/lib/specialTermsWorkflow';

const EMPTY_DRAFT = Object.freeze({ clauseId: null, versionId: null, shortName: '', category: 'Other', clauseText: '', revisionReason: '', expectedLastModifiedAt: null, expectedClauseLastModifiedAt: null });

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function draftSaveKey(value) {
  if (value?.versionId) return `version:${value.versionId}`;
  if (value?.clauseId) return `clause:${value.clauseId}`;
  return 'new';
}

const PAGE_SIZE = 40;

function checkpointKey(value) {
  return `fcos-special-term-clause-draft:${value?.versionId || value?.clauseId || 'new'}`;
}

function actionBadgeClass(tone) {
  if (tone === 'danger') return 'border-red-300 bg-red-50 text-red-900';
  if (tone === 'warning') return 'border-amber-300 bg-amber-50 text-amber-950';
  if (tone === 'success') return 'border-emerald-300 bg-emerald-50 text-emerald-900';
  return 'border-blue-300 bg-blue-50 text-blue-900';
}

function HighlightedWording({ value }) {
  const source = String(value || '');
  const highlights = materialHighlights(source);
  if (!highlights.length) return <span>{source}</span>;
  const parts = [];
  let cursor = 0;
  highlights.forEach((highlight, index) => {
    if (highlight.start > cursor) parts.push(source.slice(cursor, highlight.start));
    parts.push(<mark key={`${highlight.start}-${index}`} className="rounded bg-amber-200 px-0.5 text-inherit">{source.slice(highlight.start, highlight.end)}</mark>);
    cursor = highlight.end;
  });
  if (cursor < source.length) parts.push(source.slice(cursor));
  return parts;
}

export default function ClauseBankPanel({ canManage, canApprove, currentUserEmail = '', categoryOptions = [], onChanged, onOpenTerm }) {
  const initialPreferences = useMemo(() => loadClauseBankPreferences(), []);
  const [clauses, setClauses] = useState([]);
  const [consolidations, setConsolidations] = useState([]);
  const [summary, setSummary] = useState({ work: 0, Active: 0, Retired: 0, actionCounts: {} });
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(initialPreferences.view);
  const [action, setAction] = useState(initialPreferences.action);
  const [category, setCategory] = useState(initialPreferences.category);
  const [origin, setOrigin] = useState(initialPreferences.origin);
  const [usage, setUsage] = useState(initialPreferences.usage);
  const [mine, setMine] = useState(initialPreferences.mine);
  const [duplicatesOnly, setDuplicatesOnly] = useState(initialPreferences.duplicatesOnly);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [rapidReview, setRapidReview] = useState(false);
  const [replacementOptions, setReplacementOptions] = useState([]);
  const [replacementQuery, setReplacementQuery] = useState('');
  const [draft, setDraft] = useState(null);
  const [approval, setApproval] = useState(null);
  const [retirement, setRetirement] = useState(null);
  const [consolidation, setConsolidation] = useState(null);
  const [deletion, setDeletion] = useState(null);
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionConfirmation, setDeletionConfirmation] = useState('');
  const [deletionPending, setDeletionPending] = useState(() => new Set());
  const [approvalPending, setApprovalPending] = useState(() => new Set());
  const [draftSavePending, setDraftSavePending] = useState(() => new Set());
  const approveButtons = useRef(new Map());
  const deleteButtons = useRef(new Map());
  const draftButtons = useRef(new Map());

  const load = useCallback(async (force = false, pageOffset = 0, includeConsolidations = true) => {
    setLoading(true);
    setError('');
    const requests = [appClient.functions.invoke('specialTermClauseBank', {
      force,
      view: status,
      action: action === 'all' ? '' : action,
      category,
      origin,
      usage,
      ownerEmail: mine ? currentUserEmail : '',
      duplicatesOnly,
      query: deferredQuery.trim(),
      offset: pageOffset,
      limit: PAGE_SIZE,
    }, { cache: !force })];
    if (includeConsolidations) requests.push(appClient.functions.invoke('specialTermClauseConsolidationList', {}, { cache: false }));
    const [bankResponse, consolidationResponse] = await Promise.all(requests);
    if (bankResponse.data?.error || consolidationResponse?.data?.error) {
      setError(bankResponse.data?.error || consolidationResponse?.data?.error);
      setClauses([]);
      if (includeConsolidations) setConsolidations([]);
    } else {
      setClauses(bankResponse.data?.clauses || []);
      setSummary(bankResponse.data?.summary || { work: 0, Active: 0, Retired: 0, actionCounts: {} });
      setTotal(Number(bankResponse.data?.total || 0));
      setOffset(Number(bankResponse.data?.offset || 0));
      if (includeConsolidations) setConsolidations(consolidationResponse.data?.consolidations || []);
    }
    setLoading(false);
  }, [action, category, currentUserEmail, deferredQuery, duplicatesOnly, mine, origin, status, usage]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(false, 0, true); }, deferredQuery === query ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [deferredQuery, load, query]);

  useEffect(() => {
    saveClauseBankPreferences({ view: status, action, category, origin, usage, mine, duplicatesOnly });
  }, [action, category, duplicatesOnly, mine, origin, status, usage]);

  useEffect(() => {
    if (!draft) return;
    try { sessionStorage.setItem(checkpointKey(draft), JSON.stringify({ ...draft, savedAt: new Date().toISOString() })); } catch { /* Session recovery is optional. */ }
  }, [draft]);

  const filtered = clauses;
  const rowMatchesCurrentFilters = useCallback((clause) => {
    if (!clauseMatchesView(clause, status, action)) return false;
    if (category !== 'all' && clause.category !== category) return false;
    if (origin !== 'all' && clause.origin !== origin) return false;
    if (usage === 'used' && Number(clause.usageCount || 0) < 1) return false;
    if (usage === 'unused' && Number(clause.usageCount || 0) > 0) return false;
    if (mine && String(clause.draftVersion?.proposedByEmail || '').trim().toLowerCase() !== String(currentUserEmail).trim().toLowerCase()) return false;
    const search = deferredQuery.trim().toLowerCase();
    if (search && ![clause.shortName, clause.category, clause.origin, clause.legacyOriginalText, clause.latestApprovedVersion?.clauseText, clause.draftVersion?.clauseText].some((value) => String(value || '').toLowerCase().includes(search))) return false;
    return !duplicatesOnly || Number(clause.exactDuplicateCount || 0) > 0;
  }, [action, category, currentUserEmail, deferredQuery, duplicatesOnly, mine, origin, status, usage]);

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

  const recoverCheckpoint = useCallback((fallback) => {
    try {
      const recovered = JSON.parse(sessionStorage.getItem(checkpointKey(fallback)) || 'null');
      if (recovered && recovered.versionId === fallback.versionId && recovered.clauseId === fallback.clauseId) return { ...fallback, ...recovered, recovered: true };
    } catch { /* Ignore invalid session recovery data. */ }
    return fallback;
  }, []);
  const openNew = () => setDraft(recoverCheckpoint({ ...EMPTY_DRAFT }));
  const openRevision = (clause) => setDraft(recoverCheckpoint({ ...EMPTY_DRAFT, clauseId: clause.id, shortName: clause.shortName, category: clause.category, clauseText: clause.latestApprovedVersion?.clauseText || '', revisionReason: '', expectedLastModifiedAt: clause.lastModifiedAt }));
  const openDraft = useCallback((clause) => setDraft(recoverCheckpoint({ ...EMPTY_DRAFT, clauseId: clause.id, versionId: clause.draftVersion?.id, shortName: clause.shortName, category: clause.category, clauseText: clause.draftVersion?.clauseText || '', revisionReason: clause.draftVersion?.revisionReason || '', expectedLastModifiedAt: clause.draftVersion?.lastModifiedAt, expectedClauseLastModifiedAt: clause.lastModifiedAt })), [recoverCheckpoint]);

  const loadReplacementOptions = useCallback(async (search = '') => {
    const response = await appClient.functions.invoke('specialTermClauseBank', { view: 'Active', query: search.trim(), limit: 100, offset: 0 }, { cache: true });
    if (!response.data?.error) setReplacementOptions(response.data?.clauses || []);
  }, []);

  const openConsolidation = (clause) => {
    setReplacementQuery('');
    setReplacementOptions([]);
    setConsolidation({ source: clause, replacementClauseId: '', reason: '', equivalenceConfirmed: false });
    void loadReplacementOptions();
  };

  useEffect(() => {
    if (!rapidReview) return undefined;
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector('[role="dialog"]')) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.getAttribute?.('role') === 'combobox') return;
      const first = clauses.find((clause) => clause.draftVersion);
      if (!first) return;
      if (event.key.toLowerCase() === 'a' && canApprove) {
        event.preventDefault();
        setApproval({ clause: first, reason: '' });
      } else if (event.key.toLowerCase() === 'e' && canManage) {
        event.preventDefault();
        openDraft(first);
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        setClauses((current) => {
          const index = current.findIndex((clause) => clause.id === first.id);
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1), current[index]];
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canApprove, canManage, clauses, openDraft, rapidReview]);

  const saveDraft = async () => {
    const submitted = draft;
    if (!submitted) return;
    const key = draftSaveKey(submitted);
    if (draftSavePending.has(key)) return;
    const viewport = { top: window.scrollY, left: window.scrollX };
    const successMessage = submitted.versionId ? 'Draft clause updated.' : submitted.clauseId ? 'New clause revision proposed.' : 'New bank clause proposed.';
    const restorePosition = () => window.requestAnimationFrame(() => {
      if (document.querySelector('[role="dialog"]')) return;
      window.scrollTo({ ...viewport, behavior: 'auto' });
      draftButtons.current.get(key)?.focus({ preventScroll: true });
    });
    setDraft(null);
    setError('');
    setMessage('');
    setDraftSavePending((current) => new Set(current).add(key));
    restorePosition();
    try {
      const response = await appClient.functions.invoke('specialTermClauseDraftSave', { ...submitted, operationId: operationId() }, { cache: false });
      if (response.data?.error || !response.data?.clause) {
        setError(response.data?.error || 'Salesforce did not return the updated Draft clause. Refresh before retrying.');
        setDraft((current) => current || submitted);
        return;
      }
      setClauses((current) => current.some((clause) => clause.id === response.data.clause.id)
        ? current.map((clause) => clause.id === response.data.clause.id ? response.data.clause : clause).filter(rowMatchesCurrentFilters)
        : rowMatchesCurrentFilters(response.data.clause) ? [response.data.clause, ...current] : current);
      try { sessionStorage.removeItem(checkpointKey(submitted)); } catch { /* Session recovery is optional. */ }
      setMessage(successMessage);
      toast({ title: successMessage, description: 'The authoritative Salesforce row was updated without reloading the Clause Bank.' });
    } catch (requestError) {
      setError(requestError?.message || 'The Draft clause could not be saved.');
      setDraft((current) => current || submitted);
    } finally {
      setDraftSavePending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      restorePosition();
    }
  };

  const approveClause = async () => {
    const submitted = approval;
    if (!submitted || approvalPending.has(submitted.clause.draftVersion.id)) return;
    const versionId = submitted.clause.draftVersion.id;
    const viewport = { top: window.scrollY, left: window.scrollX };
    setApproval(null);
    setError('');
    setApprovalPending((current) => new Set(current).add(versionId));
    try {
      const response = await appClient.functions.invoke('specialTermClauseApprove', {
        clauseId: submitted.clause.id,
        versionId,
        approvalReason: submitted.reason,
        expectedClauseLastModifiedAt: submitted.clause.lastModifiedAt,
        expectedVersionLastModifiedAt: submitted.clause.draftVersion.lastModifiedAt,
        operationId: operationId(),
      }, { cache: false });
      if (response.data?.error || !response.data?.clause) {
        setError(response.data?.error || 'Salesforce did not return the approved clause state. Refresh before retrying.');
        return;
      }
      setClauses((current) => current.map((clause) => clause.id === response.data.clause.id ? response.data.clause : clause).filter(rowMatchesCurrentFilters));
      setTotal((current) => Math.max(0, current - (rowMatchesCurrentFilters(response.data.clause) ? 0 : 1)));
      toast({ title: `${submitted.clause.shortName} approved`, description: 'The next Draft remains ready for review.' });
    } catch (requestError) {
      setError(requestError?.message || 'The Draft clause could not be approved.');
    } finally {
      setApprovalPending((current) => {
        const next = new Set(current);
        next.delete(versionId);
        return next;
      });
      window.requestAnimationFrame(() => {
        window.scrollTo({ ...viewport, behavior: 'auto' });
        const next = [...approveButtons.current.values()].find((button) => button && !button.disabled);
        (next || approveButtons.current.get(versionId))?.focus({ preventScroll: true });
      });
    }
  };

  const startConsolidation = async () => {
    if (!consolidation) return;
    const replacement = replacementOptions.find((clause) => clause.id === consolidation.replacementClauseId);
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
    await load(true, offset, true);
  };

  const openDeletion = async (clause, entityType) => {
    const id = entityType === 'clauseVersion' ? clause.draftVersion?.id : clause.id;
    const key = `${entityType}:${id}`;
    if (!id || deletionPending.has(key)) return;
    setError('');
    setDeletionPending((current) => new Set(current).add(key));
    try {
      const response = await appClient.functions.invoke('specialTermDeletePreview', { entityType, id }, { cache: false });
      if (response.data?.error) {
        setError(response.data.error);
        return;
      }
      if (!response.data?.eligible) {
        setError((response.data?.blockers || ['This clause cannot be deleted.']).join(' '));
        return;
      }
      setDeletion({ clause, preview: response.data });
      setDeletionReason('');
      setDeletionConfirmation('');
    } catch (requestError) {
      setError(requestError?.message || 'The deletion check could not be completed.');
    } finally {
      setDeletionPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const submitDeletion = async () => {
    const submitted = deletion;
    if (!submitted) return;
    const { preview, clause } = submitted;
    const key = `${preview.entityType}:${preview.id}`;
    const viewport = { top: window.scrollY, left: window.scrollX };
    setDeletion(null);
    setDeletionReason('');
    setDeletionConfirmation('');
    setError('');
    setDeletionPending((current) => new Set(current).add(key));
    const functionName = preview.entityType === 'clause' ? 'specialTermClauseDelete' : 'specialTermClauseDraftDiscard';
    try {
      const response = await appClient.functions.invoke(functionName, {
        id: preview.id,
        clauseId: preview.clauseId,
        versionId: preview.versionId,
        expectedLastModifiedAt: preview.expectedLastModifiedAt,
        expectedClauseLastModifiedAt: preview.expectedLastModifiedAt,
        expectedVersionLastModifiedAt: preview.expectedVersionLastModifiedAt,
        confirmationName: preview.confirmationLabel,
        auditReason: deletionReason,
        operationId: operationId(),
      }, { cache: false });
      if (response.data?.error) setError(response.data.error);
      else if (preview.entityType === 'clause') {
        setClauses((current) => current.filter((row) => row.id !== clause.id));
        setTotal((current) => Math.max(0, current - 1));
        setMessage(`${clause.shortName} deleted.`);
        toast({ title: 'Draft clause deleted', description: 'No approved or referenced history was removed.' });
      } else if (response.data?.clause) {
        setClauses((current) => current.map((row) => row.id === response.data.clause.id ? response.data.clause : row).filter(rowMatchesCurrentFilters));
        setTotal((current) => Math.max(0, current - (rowMatchesCurrentFilters(response.data.clause) ? 0 : 1)));
        setMessage(`${clause.shortName} Draft version discarded.`);
        toast({ title: 'Draft version discarded', description: 'The approved clause and all historical uses were preserved.' });
      } else setError('Salesforce did not return the updated clause state. Refresh before continuing.');
    } catch (requestError) {
      setError(requestError?.message || 'The deletion could not be completed.');
    } finally {
      setDeletionPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      window.requestAnimationFrame(() => {
        window.scrollTo({ ...viewport, behavior: 'auto' });
        const next = [...deleteButtons.current.values()].find((button) => button && !button.disabled);
        next?.focus({ preventScroll: true });
      });
    }
  };

  const replacementClause = consolidation ? replacementOptions.find((clause) => clause.id === consolidation.replacementClauseId) : null;
  const draftQuality = useMemo(() => clauseDraftQuality(draft || {}), [draft]);

  if (loading && !clauses.length) return <StateBlock title="Loading Clause Bank" description="Reading versioned wording from Salesforce." icon={Loader2} />;

  return (
    <div className="space-y-4">
      <span className="sr-only" aria-live="polite">{message}</span>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <ClauseConsolidationQueue consolidations={consolidations} clauses={clauses} canManage={canManage} canApprove={canApprove} onOpenTerm={onOpenTerm} onChanged={() => load(true, offset, true)} onError={setError} />
      <details className="rounded-lg border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer text-sm font-medium"><CircleHelp className="mr-2 inline h-4 w-4" />What do these lifecycle states mean?</summary>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-4"><p><strong className="text-foreground">Legacy source</strong><br />Preserved Salesforce wording awaiting a governed mapping decision.</p><p><strong className="text-foreground">Clause Draft</strong><br />A proposed identity or version that cannot be used as approved wording.</p><p><strong className="text-foreground">Whole-term revision</strong><br />Terms Text, both remarks, and rules reviewed and activated atomically.</p><p><strong className="text-foreground">Approved library</strong><br />Published versions available for composition; older versions remain immutable.</p></div>
      </details>
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">{CLAUSE_BANK_VIEWS.map((view) => <Button key={view.value} type="button" size="sm" variant={status === view.value ? 'default' : 'outline'} onClick={() => { setStatus(view.value); setAction('all'); }}>{view.label}<Badge variant="secondary" className="ml-2">{summary[view.value] || 0}</Badge></Button>)}</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or wording" className="pl-9 sm:w-72" /></div>
            <Button variant="outline" onClick={() => load(true, offset, true)} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
            {canManage ? <Button ref={(node) => { if (node) draftButtons.current.set('new', node); else draftButtons.current.delete('new'); }} onClick={openNew} disabled={draftSavePending.has('new')}>{draftSavePending.has('new') ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{draftSavePending.has('new') ? 'Saving…' : 'Propose clause'}</Button> : null}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {status === 'work' ? <Select value={action} onValueChange={setAction}><SelectTrigger aria-label="Action filter"><SelectValue /></SelectTrigger><SelectContent>{CLAUSE_ACTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}{option.value !== 'all' ? ` (${summary.actionCounts?.[option.value] || 0})` : ''}</SelectItem>)}</SelectContent></Select> : <div className="hidden lg:block" />}
          <Select value={category} onValueChange={setCategory}><SelectTrigger aria-label="Category filter"><SelectValue placeholder="All categories" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categoryOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
          <Select value={origin} onValueChange={setOrigin}><SelectTrigger aria-label="Origin filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All origins</SelectItem><SelectItem value="Legacy">Legacy source</SelectItem><SelectItem value="Manual">Manual</SelectItem><SelectItem value="AI Assisted">AI assisted</SelectItem></SelectContent></Select>
          <Select value={usage} onValueChange={setUsage}><SelectTrigger aria-label="Usage filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Used and unused</SelectItem><SelectItem value="used">Used in terms</SelectItem><SelectItem value="unused">Unused</SelectItem></SelectContent></Select>
          <Button type="button" variant={mine ? 'secondary' : 'outline'} disabled={!currentUserEmail} onClick={() => setMine((value) => !value)}>My drafts</Button>
          <Button type="button" variant={duplicatesOnly ? 'secondary' : 'outline'} onClick={() => setDuplicatesOnly((value) => !value)}><Combine className="mr-1.5 h-3.5 w-3.5" />Exact duplicates</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{total} matching clause{total === 1 ? '' : 's'} · filters are saved on this device</span><div className="flex gap-2">{canApprove && status === 'work' ? <Button type="button" size="sm" variant={rapidReview ? 'default' : 'outline'} onClick={() => setRapidReview((value) => !value)}><BookOpenCheck className="mr-1.5 h-3.5 w-3.5" />{rapidReview ? 'End rapid review' : 'Rapid review'}</Button> : null}<Button type="button" size="sm" variant="ghost" onClick={() => { setAction('all'); setCategory('all'); setOrigin('all'); setUsage('all'); setMine(false); setDuplicatesOnly(false); setQuery(''); }}><FilterX className="mr-1.5 h-3.5 w-3.5" />Reset filters</Button></div></div>
        {rapidReview ? <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">Rapid review keeps the next Draft expanded. Keyboard: <kbd className="rounded border bg-white px-1">A</kbd> approve, <kbd className="rounded border bg-white px-1">E</kbd> edit, <kbd className="rounded border bg-white px-1">S</kbd> skip.</div> : null}
      </div>

      <div className="space-y-3">{filtered.map((clause, index) => {
        const displayVersion = status === 'work' ? clause.draftVersion || clause.latestApprovedVersion : clause.latestApprovedVersion || clause.draftVersion;
        const deletionEntityType = clause.status === 'Draft' ? 'clause' : clause.status === 'Active' && clause.draftVersion ? 'clauseVersion' : null;
        const deletionId = deletionEntityType === 'clauseVersion' ? clause.draftVersion?.id : clause.id;
        const deletionKey = deletionEntityType ? `${deletionEntityType}:${deletionId}` : null;
        const structurallyBlocked = clause.status === 'Draft' && (clause.usageCount > 0 || Boolean(clause.consolidation));
        const draftKey = clause.draftVersion ? `version:${clause.draftVersion.id}` : `clause:${clause.id}`;
        const savingDraft = draftSavePending.has(draftKey);
        const actionDetails = clauseActionDetails(clause);
        return (
          <section key={clause.id} className="space-y-3 rounded-lg border border-border bg-card p-4" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 190px' }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{clause.shortName}</strong><Badge variant="outline">{clause.category}</Badge><Badge variant={clause.status === 'Retired' ? 'destructive' : 'secondary'}>{clause.status === 'Active' ? 'Approved' : clause.status}</Badge>{clause.origin ? <Badge variant="outline">{clause.origin}</Badge> : null}{displayVersion ? <Badge variant="secondary">v{displayVersion.revisionNumber}</Badge> : null}{clause.exactDuplicateCount ? <Badge className="bg-violet-600">{clause.exactDuplicateCount} exact duplicate{clause.exactDuplicateCount === 1 ? '' : 's'}</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">Used in {clause.usageCount} Special Term assignment(s){clause.provenance?.termName ? ` · preserved from ${clause.provenance.termName}` : ''}</p>{status === 'work' ? <div className={`mt-2 inline-flex max-w-3xl items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${actionBadgeClass(actionDetails.tone)}`}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><strong>{actionDetails.label}.</strong> {actionDetails.reason}</span></div> : null}</div>
              <div className="flex flex-wrap gap-1">
                {canManage && clause.status === 'Active' && !clause.draftVersion && !clause.consolidation ? <Button ref={(node) => { if (node) draftButtons.current.set(draftKey, node); else draftButtons.current.delete(draftKey); }} size="sm" variant="outline" disabled={savingDraft} onClick={() => openRevision(clause)}>{savingDraft ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Pencil className="mr-1 h-3.5 w-3.5" />}{savingDraft ? 'Saving…' : 'Propose revision'}</Button> : null}
                {canManage && clause.status !== 'Retired' && clause.draftVersion ? <Button ref={(node) => { if (node) draftButtons.current.set(draftKey, node); else draftButtons.current.delete(draftKey); }} size="sm" variant="outline" disabled={savingDraft} onClick={() => openDraft(clause)}>{savingDraft ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Pencil className="mr-1 h-3.5 w-3.5" />}{savingDraft ? 'Saving…' : 'Edit Draft'}</Button> : null}
                {canApprove && clause.draftVersion ? <Button ref={(node) => { if (node) approveButtons.current.set(clause.draftVersion.id, node); else approveButtons.current.delete(clause.draftVersion.id); }} data-clause-approve={clause.draftVersion.id} size="sm" disabled={approvalPending.has(clause.draftVersion.id)} onClick={() => setApproval({ clause, reason: '' })}>{approvalPending.has(clause.draftVersion.id) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}{approvalPending.has(clause.draftVersion.id) ? 'Approving…' : 'Approve'}</Button> : null}
                {canApprove && clause.status === 'Active' && !clause.consolidation ? <Button size="sm" variant="outline" onClick={() => openConsolidation(clause)}><Combine className="mr-1 h-3.5 w-3.5" />Consolidate</Button> : null}
                {canApprove && clause.status === 'Active' && !clause.consolidation ? <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRetirement({ clause, reason: '' })}><XCircle className="mr-1 h-3.5 w-3.5" />Retire</Button> : null}
                {canManage && deletionEntityType ? <Button ref={(node) => { if (node) deleteButtons.current.set(deletionKey, node); else deleteButtons.current.delete(deletionKey); }} size="sm" variant="outline" className="text-destructive" disabled={structurallyBlocked || deletionPending.has(deletionKey)} title={structurallyBlocked ? 'Referenced Draft clauses must be retained.' : deletionEntityType === 'clause' ? clause.origin === 'Legacy' ? 'Delete unapproved Legacy draft' : 'Delete unapproved Draft clause' : 'Discard only this unapproved Draft version'} onClick={() => openDeletion(clause, deletionEntityType)}>{deletionPending.has(deletionKey) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}{deletionPending.has(deletionKey) ? 'Checking…' : deletionEntityType === 'clauseVersion' ? 'Discard Draft' : clause.origin === 'Legacy' ? 'Delete Legacy Draft' : 'Delete Draft'}</Button> : null}
              </div>
            </div>
            <details open={rapidReview && index === 0 && Boolean(clause.draftVersion)} className="group rounded-md border border-border bg-muted/10 p-3"><summary className="cursor-pointer text-xs font-medium text-primary">Review wording, duplicate candidates, and history</summary><div className="mt-3 space-y-3"><p className="whitespace-pre-wrap text-sm leading-relaxed">{displayVersion?.clauseText || 'No approved wording yet.'}</p>
              {clause.origin === 'Legacy' && clause.legacyOriginalText && displayVersion?.clauseText !== clause.legacyOriginalText ? <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50/40 p-3 md:grid-cols-2"><section><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preserved legacy wording</p><p className="mt-2 whitespace-pre-wrap text-xs">{clause.legacyOriginalText}</p></section><section><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Proposed wording</p><p className="mt-2 whitespace-pre-wrap text-xs">{displayVersion?.clauseText}</p></section></div> : null}
              {clause.draftVersion && clause.latestApprovedVersion ? <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Draft v{clause.draftVersion.revisionNumber} is awaiting approval. Existing terms remain on approved v{clause.latestApprovedVersion.revisionNumber}.</div> : null}
              {clause.exactDuplicates?.length || clause.similarClauses?.length ? <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-3"><p className="text-xs font-semibold text-violet-950"><Combine className="mr-1.5 inline h-3.5 w-3.5" />Duplicate review</p>{clause.exactDuplicates?.length ? <p className="text-xs text-violet-900">Exact normalized wording: {clause.exactDuplicates.map((row) => row.shortName).join(', ')}. Canonical naming and treatment still require approval.</p> : null}{clause.similarClauses?.map((candidate) => <div key={candidate.id} className="grid gap-2 rounded border border-violet-200 bg-background p-2 text-xs md:grid-cols-[180px_1fr]"><div><strong>{candidate.shortName}</strong><br />Similarity {Math.round(candidate.similarity * 100)}%<br /><Badge variant={candidate.materialDifference ? 'destructive' : 'outline'}>{candidate.materialDifference ? 'Material qualifiers differ' : 'No detected material-token difference'}</Badge></div><p className="whitespace-pre-wrap"><HighlightedWording value={candidate.clauseText} /></p></div>)}</div> : null}
              {clause.history?.length ? <div className="rounded-md border border-border p-3"><p className="text-xs font-semibold"><History className="mr-1.5 inline h-3.5 w-3.5" />Governed history</p><ol className="mt-2 space-y-2 border-l border-border pl-4 text-xs text-muted-foreground">{clause.history.map((event) => <li key={event.id}><strong className="text-foreground">v{event.revisionNumber} · {event.status}</strong>{event.draftSource ? ` · ${event.draftSource}` : ''}{event.proposedByEmail ? ` · proposed by ${event.proposedByEmail}` : ''}{event.approvedByEmail ? ` · approved by ${event.approvedByEmail}` : ''}{event.revisionReason ? <span className="block">{event.revisionReason}</span> : null}</li>)}</ol></div> : null}
            </div></details>
            {clause.consolidation ? <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">Relinking to {clause.consolidation.replacementShortName} v{clause.consolidation.replacementRevisionNumber}. Existing Special Terms remain unchanged until their whole-term revisions are approved.</div> : null}
          </section>
        );
      })}</div>
      {!filtered.length ? <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">No clauses match this view.</div> : null}
      {total > PAGE_SIZE ? <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm"><span>Showing {offset + 1}–{Math.min(offset + filtered.length, total)} of {total}</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={loading || offset === 0} onClick={() => load(false, Math.max(0, offset - PAGE_SIZE), false)}><ChevronLeft className="mr-1 h-3.5 w-3.5" />Previous</Button><Button type="button" size="sm" variant="outline" disabled={loading || offset + PAGE_SIZE >= total} onClick={() => load(false, offset + PAGE_SIZE, false)}>Next<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></div></div> : null}

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{draft?.versionId ? 'Edit Draft clause' : draft?.clauseId ? 'Propose clause revision' : 'Propose a bank clause'}</DialogTitle><DialogDescription>Do not include the top-level number. Published wording remains unchanged until an authorized approver accepts this Draft.</DialogDescription></DialogHeader>
          {draft ? <div className="space-y-4">{draft.recovered ? <Alert><AlertDescription>Recovered an unsaved checkpoint from this browser session. Review it before saving to Salesforce.</AlertDescription></Alert> : null}<div className="grid gap-4 md:grid-cols-2"><div className="space-y-1.5"><Label>Short name</Label><Input value={draft.shortName} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, shortName: event.target.value, recovered: false }))} placeholder="Best Endeavours – No Demurrage" /><p className="text-xs text-muted-foreground">Use 3–7 concise, action-oriented words and include material qualifiers.</p></div><div className="space-y-1.5"><Label>Category</Label><Select value={draft.category} onValueChange={(category) => setDraft((current) => ({ ...current, category, recovered: false }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categoryOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div></div><div className="space-y-1.5"><Label>Clause wording</Label><Textarea value={draft.clauseText} onChange={(event) => setDraft((current) => ({ ...current, clauseText: event.target.value, recovered: false }))} rows={10} placeholder="Enter the clause without 1., 2., or another top-level number." /></div><div className="space-y-1.5"><Label>Revision reason</Label><Textarea value={draft.revisionReason} maxLength={1000} onChange={(event) => setDraft((current) => ({ ...current, revisionReason: event.target.value, recovered: false }))} rows={3} /></div><div className="rounded-lg border border-border bg-muted/20 p-3"><p className="text-xs font-semibold"><Sparkles className="mr-1.5 inline h-3.5 w-3.5" />Drafting-quality check</p><ul className="mt-2 space-y-1.5 text-xs">{draftQuality.map((issue) => <li key={issue.id} className={issue.severity === 'error' ? 'text-red-700' : issue.severity === 'warning' ? 'text-amber-800' : 'text-emerald-700'}>{issue.severity === 'success' ? '✓' : issue.severity === 'error' ? '●' : '▲'} {issue.label}</li>)}</ul><p className="mt-2 text-[11px] text-muted-foreground">This check supports human review; it never approves or rewrites contractual wording automatically.</p></div></div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button disabled={draftQuality.some((issue) => issue.severity === 'error')} onClick={saveDraft}>Save Draft</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(approval)} onOpenChange={(open) => !open && setApproval(null)}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Approve {approval?.clause?.shortName}</DialogTitle><DialogDescription>Approval publishes Draft v{approval?.clause?.draftVersion?.revisionNumber}. Existing terms remain on their current version and will show an upgrade badge.</DialogDescription></DialogHeader>{approval ? <><div className="rounded-lg border border-border p-3"><p className="whitespace-pre-wrap text-sm">{approval.clause.draftVersion.clauseText}</p></div><div className="space-y-1.5"><Label>Approval reason</Label><Textarea value={approval.reason} onChange={(event) => setApproval((current) => ({ ...current, reason: event.target.value }))} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && approval.reason.trim().length >= 3) { event.preventDefault(); void approveClause(); } }} rows={3} /><p className="text-xs text-muted-foreground">Press Ctrl/⌘ + Enter to approve and continue rapid review.</p></div></> : null}<DialogFooter><Button variant="outline" onClick={() => setApproval(null)}>Cancel</Button><Button disabled={approval?.reason.trim().length < 3} onClick={approveClause}>Approve version</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletion)} onOpenChange={(open) => !open && setDeletion(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{deletion?.preview?.entityType === 'clauseVersion' ? `Discard Draft for ${deletion?.clause?.shortName}` : `Delete ${deletion?.clause?.shortName}`}</DialogTitle>
            <DialogDescription>{deletion?.preview?.entityType === 'clauseVersion' ? 'Only the unapproved Draft version will be deleted. The approved clause identity, wording, and every historical use remain unchanged.' : `This never-approved ${deletion?.clause?.origin === 'Legacy' ? 'Legacy ' : ''}clause identity and ${deletion?.preview?.counts?.versionCount || 0} Draft version(s) will be permanently deleted.`}</DialogDescription>
          </DialogHeader>
          {deletion ? <div className="space-y-4">
            <div className="space-y-1.5"><Label>Type {deletion.preview.confirmationLabel} to confirm</Label><Input value={deletionConfirmation} onChange={(event) => setDeletionConfirmation(event.target.value)} autoComplete="off" autoFocus /></div>
            <div className="space-y-1.5"><Label>Deletion reason</Label><Textarea value={deletionReason} maxLength={500} rows={4} onChange={(event) => setDeletionReason(event.target.value)} placeholder="Required; only a redacted hash is retained outside Salesforce" /></div>
          </div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setDeletion(null)}>Cancel</Button><Button variant="destructive" disabled={deletionReason.trim().length < 3 || deletionConfirmation !== deletion?.preview?.confirmationLabel} onClick={submitDeletion}><Trash2 className="mr-2 h-4 w-4" />{deletion?.preview?.entityType === 'clauseVersion' ? 'Discard Draft version' : 'Delete from Clause Bank'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(retirement)} onOpenChange={(open) => !open && !busy && setRetirement(null)}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Retire {retirement?.clause?.shortName}</DialogTitle><DialogDescription>Retirement prevents new use. Existing Special Terms retain their approved version.</DialogDescription></DialogHeader>{retirement ? <div className="space-y-1.5"><Label>Retirement reason</Label><Textarea value={retirement.reason} onChange={(event) => setRetirement((current) => ({ ...current, reason: event.target.value }))} rows={4} /></div> : null}<DialogFooter><Button variant="outline" onClick={() => setRetirement(null)} disabled={busy}>Cancel</Button><Button variant="destructive" disabled={busy || retirement?.reason.trim().length < 3} onClick={() => mutate('specialTermClauseRetire', { clauseId: retirement.clause.id, retirementReason: retirement.reason, expectedLastModifiedAt: retirement.clause.lastModifiedAt }, 'Clause retired. Existing assignments were preserved.')}>{busy ? 'Retiring…' : 'Retire clause'}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(consolidation)} onOpenChange={(open) => !open && !busy && setConsolidation(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Consolidate {consolidation?.source?.shortName}</DialogTitle><DialogDescription>The source remains approved until every affected Special Term is relinked and its whole-term revision is approved.</DialogDescription></DialogHeader>
          {consolidation ? <div className="space-y-4">
            <div className="space-y-1.5"><Label>Replacement clause</Label><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={replacementQuery} onChange={(event) => { const value = event.target.value; setReplacementQuery(value); void loadReplacementOptions(value); }} placeholder="Search the approved library" className="pl-9" /></div><Select value={consolidation.replacementClauseId || undefined} onValueChange={(replacementClauseId) => setConsolidation((current) => ({ ...current, replacementClauseId }))}><SelectTrigger><SelectValue placeholder="Select an approved replacement" /></SelectTrigger><SelectContent>{replacementOptions.filter((clause) => clause.id !== consolidation.source.id && !clause.consolidation).map((clause) => <SelectItem key={clause.id} value={clause.id}>{clause.shortName} · v{clause.latestApprovedVersion?.revisionNumber || 0}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Results are searched and paged by the server; full Clause Bank wording is not rendered until selected.</p></div>
            <div className="grid gap-3 md:grid-cols-2"><section className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source wording</p><p className="mt-2 whitespace-pre-wrap text-sm"><HighlightedWording value={consolidation.source.latestApprovedVersion?.clauseText} /></p></section><section className="rounded-lg border border-border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Replacement wording</p><p className="mt-2 whitespace-pre-wrap text-sm"><HighlightedWording value={replacementClause?.latestApprovedVersion?.clauseText || 'Select a replacement clause.'} /></p></section></div>
            <div className="space-y-1.5"><Label>Consolidation reason</Label><Textarea value={consolidation.reason} maxLength={1000} rows={3} onChange={(event) => setConsolidation((current) => ({ ...current, reason: event.target.value }))} /></div>
            <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><Checkbox checked={consolidation.equivalenceConfirmed} onCheckedChange={(checked) => setConsolidation((current) => ({ ...current, equivalenceConfirmed: checked === true }))} /><span>I confirm the clauses have the same contractual meaning and do not differ in amounts, deadlines, entities, ports, products, standards, or jurisdictions.</span></label>
          </div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setConsolidation(null)} disabled={busy}>Cancel</Button><Button onClick={startConsolidation} disabled={busy || !replacementClause || consolidation?.reason.trim().length < 3 || !consolidation?.equivalenceConfirmed}>{busy ? 'Starting…' : 'Start consolidation'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
