import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageState } from '@/hooks/usePageState';
import { AlertTriangle, ExternalLink, Loader2, Play, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import StateBlock from '@/components/common/StateBlock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import { appClient } from '@/api/appClient';
import {
  XERO_FINANCIAL_CUTOFF,
  summarizeXeroFinancialReconciliation,
  xeroFinancialReconciliationRank,
} from '@/lib/xeroFinancialReconciliation';
import { xeroPortalUiCopy } from '@/lib/xeroPortalUiCopy';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { reconciliationBucket, documentExplicitReviewEligible, retainedReviewSelection, reviewSelectionSnapshot, restoreReviewSelection, documentReviewTotals, documentReviewTarget, workflowCopy, savedPostingMode, previewMatchesPostingMode } from '@/lib/financialWorkflowUi';
import XeroDailyAllowance from '@/components/xero/XeroDailyAllowance';
import { latestXeroDailyAllowance } from '@/lib/xeroDailyAllowance';

const DIRECTIONS = ['buyer', 'supplier'];
const DEFAULT_BANKS = ['DBS', 'UBS'];
const PAGE_SIZE = 100;
const MAPPING_PAGE_SIZE = 25;
const FORCE_OPTIONS = { force: true, cache: false };
const MUTATION_OPTIONS = { ...FORCE_OPTIONS, invalidateCache: true };
const DETAIL_CLASS = 'text-xs text-muted-foreground';
const ACTIONS_CLASS = 'flex flex-wrap items-center gap-2';
const SECTION_HEADER_CLASS = 'flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between';
const SELECT_CLASS = 'h-9 rounded-md border border-input bg-background px-3 text-sm';
const LINK_CLASS = 'block text-xs text-blue-700 underline';
const BETWEEN_CLASS = 'flex flex-wrap items-center justify-between gap-3';
const PANEL_CLASS = 'rounded-lg border border-border bg-card p-4';
const DESCRIPTION_CLASS = 'mt-1 text-sm text-muted-foreground';
const TABLE_FRAME_CLASS = 'overflow-auto rounded-lg border border-border';

export default function XeroFinancialSync({ portalStatus, language = 'en' }) {
  const copy = xeroPortalUiCopy(language);
  const financialCopy = copy.financial;
  const flow = workflowCopy(language);
  const [mappings, setMappings] = useState(null);
  const [preview, setPreview] = useState(null);
  const [postingMode, setPostingMode] = useState('draft');
  const [payments, setPayments] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [selectedPayments, setSelectedPayments] = useState(new Set());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [targetNeedsRecheck, setTargetNeedsRecheck] = useState(false);
  const stemContext = new URLSearchParams(window.location.search).get('stem') || '';
  const [view, setView] = usePageState(`xero-financial:view:${stemContext}`, stemContext ? 'all' : 'attention');
  const [search, setSearch] = usePageState(`xero-financial:search:${stemContext}`, stemContext);
  const [selectionState, setSelectionState] = usePageState('xero-financial:selection', null);
  const initialSelection = useRef(selectionState);
  const [fixMapping, setFixMapping] = useState(null);
  const requestBusy = useRef(false);
  const backgroundCheckStopped = useRef(false);
  const lastCheckAttemptAt = useRef(0);
  const previewGeneration = useRef(0);
  const [paymentsReviewed, setPaymentsReviewed] = useState(false);
  const [documentPage, setDocumentPage] = useState(0);
  const [paymentPage, setPaymentPage] = useState(0);
  const [mappingPage, setMappingPage] = useState(0);
  const [busy, setBusy] = useState('mappings');
  const [error, setError] = useState('');
  const [dailyAllowance, setDailyAllowance] = useState(null);
  const captureDailyAllowance = useCallback((value) => {
    const receivedAt = new Date().toISOString();
    setDailyAllowance((current) => latestXeroDailyAllowance(current, value, { receivedAt }));
  }, []);

  const loadMappings = useCallback(async ({ keepBusy = false } = {}) => {
    if (!keepBusy) { setBusy('mappings'); setError(''); }
    const result = await appClient.functions.invoke('xeroFinancialMappingsGet', {}, FORCE_OPTIONS);
    if (!keepBusy) setBusy('');
    if (result.data?.error) {
      setError(result.data.error);
      return;
    }
    setMappings(result.data);
  }, []);

  useEffect(() => {
    let active = true;
    loadMappings();
    appClient.functions.invoke('xeroFinancialSyncLatest', {}, FORCE_OPTIONS).then((result) => {
      if (!active) return;
      captureDailyAllowance(result.data);
      if (previewGeneration.current > 0 || result.data?.error || !result.data?.preview) return;
      setPreview(result.data.preview);
      setPostingMode(savedPostingMode(result.data.preview));
      setPayments(result.data.preview.payments);
      const saved = initialSelection.current;
      const sameRun = saved?.runId === result.data.preview.run?.id
        && saved?.postingMode === savedPostingMode(result.data.preview);
      setSelected(result.data.preview.run?.status !== 'ready_for_review'
        ? new Set(result.data.preview.rows.filter((row) => row.selected).map((row) => row.id))
        : sameRun
          ? restoreReviewSelection(saved.documents, result.data.preview.rows)
          : new Set(result.data.preview.rows.filter((row) => row.selected && !row.reviewRequired && reconciliationBucket(row) === 'ready' && documentExplicitReviewEligible(row)).map((row) => row.id)));
      setSelectedPayments(sameRun ? restoreReviewSelection(saved.payments, result.data.preview.payments?.rows || [], 'payment') : new Set());
    }).catch(() => { if (active) setError('The last check could not be loaded. Run Check everything to retry.'); });
    return () => { active = false; };
  }, [captureDailyAllowance, loadMappings]);

  useEffect(() => {
    if (!preview?.run?.id) return;
    setSelectionState({ runId: preview.run.id, postingMode,
      documents: reviewSelectionSnapshot(preview.rows || [], selected),
      payments: reviewSelectionSnapshot(payments?.rows || [], selectedPayments, 'payment') });
  }, [preview, postingMode, payments, selected, selectedPayments, setSelectionState]);

  // Refresh on return to this page, keeping a current review stable while its dialog is open.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !busy && !reviewOpen && !fixMapping && preview
        && !backgroundCheckStopped.current && Date.now() - lastCheckAttemptAt.current > 120000
        && !['authorised', 'processing', 'partial', 'failed'].includes(preview.run?.status)
        && Date.now() - new Date(preview.checkedAt || preview.run?.createdAt).getTime() > 120000) runPreview(true, true);
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  });

  const products = useMemo(() => preview?.products || [], [preview]);
  const productMappingIndex = useMemo(() => new Map((mappings?.productMappings || []).map((mapping) => [`${mapping.direction}:${mapping.salesforceProductId}`, mapping])), [mappings]);
  const mappingProposalIndex = useMemo(() => new Map((preview?.mappingProposals || []).map((proposal) => [`${proposal.direction}:${proposal.salesforceProductId}`, proposal])), [preview]);
  const mappingProposalSummary = useMemo(() => ({
    proposed: (preview?.mappingProposals || []).filter((proposal) => proposal.status === 'proposed').length,
    conflicts: (preview?.mappingProposals || []).filter((proposal) => proposal.status === 'conflict').length,
  }), [preview]);
  const productMappingRows = useMemo(() => products.flatMap((product) => DIRECTIONS.map((direction) => {
    const key = `${direction}:${product.id}`;
    return { key, direction, product, mapping: productMappingIndex.get(key), proposal: mappingProposalIndex.get(key) };
  })).sort((left, right) => mappingReviewRank(left) - mappingReviewRank(right)
    || left.direction.localeCompare(right.direction)
    || left.product.name.localeCompare(right.product.name)
    || left.product.id.localeCompare(right.product.id)), [mappingProposalIndex, productMappingIndex, products]);
  const mappingPageCount = Math.max(1, Math.ceil(productMappingRows.length / MAPPING_PAGE_SIZE));
  const visibleProductMappings = useMemo(() => productMappingRows.slice(mappingPage * MAPPING_PAGE_SIZE, (mappingPage + 1) * MAPPING_PAGE_SIZE), [mappingPage, productMappingRows]);
  const bankMappingIndex = useMemo(() => new Map((mappings?.bankMappings || []).map((mapping) => [mapping.salesforceBankName, mapping])), [mappings]);
  const eligibleRows = useMemo(() => (preview?.rows || []).filter((row) => row.status === 'eligible' && reconciliationBucket(row) === 'ready'), [preview]);
  const canReviewRun = preview?.run?.status === 'ready_for_review';
  const reviewRows = (preview?.rows || []).filter((row) => canReviewRun ? selected.has(row.id) : row.selected);
  const selectedLinksOnly = reviewRows.length > 0 && reviewRows.every((row) => ['link', 'protected_legacy'].includes(row.action));
  const batchSelectionEligible = selected.size > 0 && reviewRows.length === selected.size && reviewRows.every(documentExplicitReviewEligible);
  const targetResult = documentReviewTarget(preview?.rows, reviewTarget);
  const targetRow = targetResult?.row;
  const targetEligible = Boolean(targetResult?.eligible && !targetNeedsRecheck);
  const previewMatchesMode = previewMatchesPostingMode(preview, postingMode);
  const targetMappingBlocked = (targetRow?.blockers || []).some((reason) => /Salesforce Product|Xero account mapping|account codes?|tax treatment/i.test(reason));
  const dialogRows = reviewTarget ? (targetRow ? [targetRow] : []) : reviewRows;
  const singleApproval = targetRow?.action === 'safe_update' ? flow.approveUpdate
    : targetRow?.action === 'create_draft' ? (postingMode === 'authorised' ? flow.authorisedMode : flow.approveDraft)
      : ['protected_legacy', 'link'].includes(targetRow?.action) ? flow.approveLink : flow.confirm;
  const orderedDocuments = useMemo(() => [...(preview?.rows || [])].filter((row) => (view === 'all' || reconciliationBucket(row) === view) && (!search.trim() || [row.documentNumber, row.accountName, row.accountId, row.stemName, row.stemId].join(' ').toLowerCase().includes(search.trim().toLowerCase()))).sort((left, right) => xeroFinancialReconciliationRank(left) - xeroFinancialReconciliationRank(right)), [preview, view, search]);
  const orderedPayments = useMemo(() => [...(payments?.rows || [])].filter((row) => (view === 'all' || reconciliationBucket(row, 'payment') === view) && (!search.trim() || [row.salesforcePaymentName, row.stemId].join(' ').toLowerCase().includes(search.trim().toLowerCase()))).sort((left, right) => xeroFinancialReconciliationRank(left, 'payment') - xeroFinancialReconciliationRank(right, 'payment')), [payments, view, search]);
  const documentPageCount = Math.max(1, Math.ceil(orderedDocuments.length / PAGE_SIZE));
  const paymentPageCount = Math.max(1, Math.ceil(orderedPayments.length / PAGE_SIZE));
  const visibleDocuments = useMemo(() => orderedDocuments.slice(documentPage * PAGE_SIZE, (documentPage + 1) * PAGE_SIZE), [documentPage, orderedDocuments]);
  const visiblePayments = useMemo(() => orderedPayments.slice(paymentPage * PAGE_SIZE, (paymentPage + 1) * PAGE_SIZE), [orderedPayments, paymentPage]);
  const reconciliation = useMemo(() => summarizeXeroFinancialReconciliation({ documents: preview?.rows, payments: payments?.rows }), [payments, preview]);
  const financialGate = portalStatus?.externalActions?.xero_financial_sync;
  const scopeFlags = portalStatus?.xero?.scopeFlags || {};

  function changePostingMode(mode) {
    if (mode === postingMode) return;
    setPostingMode(mode);
    setSelected(new Set());
    setReviewOpen(false);
    setReviewTarget(null);
  }

  async function runPreview(preserveSelection = false, checkChanges = false, keepReviewOpen = false) {
    if (requestBusy.current || (checkChanges && backgroundCheckStopped.current)) return false;
    requestBusy.current = true;
    lastCheckAttemptAt.current = Date.now();
    previewGeneration.current += 1;
    setBusy('preview');
    setError('');
    if (!keepReviewOpen) setReviewOpen(false);
    setPaymentsReviewed(false);
    try {
    const result = await appClient.functions.invoke('xeroFinancialSyncPreview', { cutoffDate: XERO_FINANCIAL_CUTOFF,
      includePayments: true, recordExactMatches: true, postingMode,
      ...(checkChanges && previewMatchesPostingMode(preview, postingMode) ? { refreshIfChangedRunId: preview?.run?.id } : {}) }, MUTATION_OPTIONS);
    captureDailyAllowance(result.data);
    if (result.data?.error) {
      // Keep the saved check and stop render/focus events from retrying a failed scan.
      backgroundCheckStopped.current = true;
      setError(result.data.error);
      return false;
    }
    backgroundCheckStopped.current = false;
    if (result.data.unchanged) {
      if (!previewMatchesPostingMode(preview, postingMode)) { setError(flow.modeChanged); return false; }
      setPreview((current) => ({ ...current, checkedAt: result.data.checkedAt })); return true;
    }
    setPreview(result.data);
    setMappingPage(0);
    setDocumentPage(0);
    const newModeMatches = previewMatchesPostingMode(result.data, postingMode);
    const oldModeMatches = previewMatchesPostingMode(preview, postingMode);
    setSelected(newModeMatches && preserveSelection && oldModeMatches
      ? retainedReviewSelection(preview?.rows || [], result.data.rows || [], selected)
      : newModeMatches && (oldModeMatches || !preview)
        ? new Set((result.data.rows || []).filter((row) => !row.reviewRequired && reconciliationBucket(row) === 'ready' && documentExplicitReviewEligible(row)).map((row) => row.id))
        : new Set());
    setPayments(result.data.payments);
    setPaymentPage(0);
    setSelectedPayments(new Set((result.data.payments?.rows || []).filter((row) => row.action === 'payment_apply' && row.status === 'eligible').map((row) => row.salesforcePaymentId)));
    if (Number(result.data.automaticMappingPolicy?.changedCount || 0) > 0) await loadMappings({ keepBusy: true });
    return true;
    } catch (nextError) {
      captureDailyAllowance(nextError);
      backgroundCheckStopped.current = true;
      setError(nextError.message || 'The check could not be completed. Your last check is retained.');
      return false;
    } finally { requestBusy.current = false; setBusy(''); }
  }

  async function executeRun() {
    if (busy || !previewMatchesMode || !financialGate?.enabled || !['ready_for_review', 'authorised', 'partial', 'failed'].includes(preview?.run?.status)) return;
    if (reviewTarget && (!canReviewRun || !targetEligible)) return;
    if (!reviewTarget && canReviewRun && !batchSelectionEligible) return;
    setBusy('run');
    try {
      const result = await appClient.functions.invoke('xeroFinancialSyncRun', {
        runId: preview?.run?.id, revision: preview?.run?.revision,
        ...(canReviewRun ? { reviewed: true, selectedItemIds: reviewTarget ? [targetRow.id] : [...selected] } : {}),
      }, MUTATION_OPTIONS);
      captureDailyAllowance(result.data);
      setReviewOpen(false);
      if (result.data?.error) {
        setError(result.data.error);
        const latest = await appClient.functions.invoke('xeroFinancialSyncLatest', {}, FORCE_OPTIONS);
        captureDailyAllowance(latest.data);
        if (latest.data?.preview) setPreview(latest.data.preview);
        return;
      }
      toast({ title: financialCopy.batchCompleted, description: financialCopy.outcome(result.data.summary || {}) });
      const changed = (result.data.outcomes || []).filter((row) => row.reviewRequired).flatMap((row) => row.errors || []);
      await runPreview(true);
      if (changed.length) setError(changed.join(' '));
    } catch (nextError) {
      setError(nextError.message || 'The financial sync could not be completed. Recheck before retrying.');
      if (reviewTarget) setTargetNeedsRecheck(true);
    } finally {
      setBusy('');
    }
  }

  async function mappingSaved() {
    await loadMappings();
    const refreshed = await runPreview(true, false, Boolean(fixMapping?.returnToReview));
    if (fixMapping?.returnToReview) {
      setFixMapping(null);
      setTargetNeedsRecheck(!refreshed);
      setReviewOpen(true);
    }
  }

  function openDocumentReview(row) {
    setReviewTarget({ salesforceObject: row.salesforceObject, salesforceId: row.salesforceId, sourceFingerprint: row.sourceFingerprint });
    setTargetNeedsRecheck(false);
    setReviewOpen(true);
  }

  function openMappingFromReview() {
    setTargetNeedsRecheck(true);
    setReviewOpen(false);
    setFixMapping({ ...targetRow, returnToReview: true });
  }

  async function recheckTarget() {
    const refreshed = await runPreview(true, false, true);
    setTargetNeedsRecheck(!refreshed);
  }

  async function previewPayments() {
    setBusy('payment-preview');
    setPaymentsReviewed(false);
    const result = await appClient.functions.invoke('xeroFinancialPaymentApply', { mode: 'preview', cutoffDate: XERO_FINANCIAL_CUTOFF }, FORCE_OPTIONS);
    captureDailyAllowance(result.data);
    setBusy('');
    if (result.data?.error) {
      toast({ title: financialCopy.paymentPreviewFailed, description: result.data.error, variant: 'destructive' });
      return;
    }
    setPayments(result.data);
    setPaymentPage(0);
    setSelectedPayments(new Set((result.data.rows || []).filter((row) => row.action === 'payment_apply' && row.status === 'eligible').map((row) => row.salesforcePaymentId)));
  }

  async function applyPayments() {
    setBusy('payment-apply');
    const result = await appClient.functions.invoke('xeroFinancialPaymentApply', {
      mode: 'apply', cutoffDate: XERO_FINANCIAL_CUTOFF, reviewed: paymentsReviewed,
      selectedPayments: (payments?.rows || []).filter((row) => selectedPayments.has(row.salesforcePaymentId)).map((row) => ({ id: row.salesforcePaymentId, sourceFingerprint: row.sourceFingerprint, reviewFingerprint: row.reviewFingerprint })),
    }, MUTATION_OPTIONS);
    captureDailyAllowance(result.data);
    setBusy('');
    if (result.data?.error) {
      toast({ title: financialCopy.paymentStopped, description: result.data.error, variant: 'destructive' });
      return;
    }
    toast({ title: financialCopy.paymentsApplied, description: financialCopy.outcome(result.data.summary || {}) });
    await runPreview();
    const changed = (result.data.outcomes || []).filter((row) => row.reviewRequired);
    if (changed.length) setError(`${changed.length} payment allocation(s) changed and need review again. Unchanged selected allocations were processed.`);
  }

  function toggleSelection(id, checked, setter) {
    setter((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  if (busy === 'mappings' && !mappings) {
    return <StateBlock icon={Loader2} title={financialCopy.loadingTitle} description={financialCopy.loadingDescription} />;
  }

  return (
    <div className="space-y-4">
      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      <section className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,430px)] lg:items-start">
          <div>
            <div className={ACTIONS_CLASS}>
              <h2 className="text-lg font-semibold">{financialCopy.reconciliationTitle}</h2>
              <Badge variant="outline" className="border-sky-200 bg-white text-sky-800">{financialCopy.fixedScope}</Badge>
              <Badge variant="outline" className={financialGate?.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}>
                {financialGate?.enabled ? financialCopy.gateEnabled : financialCopy.gateLocked}
              </Badge>
            </div>
            <p className="mt-2 max-w-4xl text-sm text-slate-700">{financialCopy.reconciliationDescription}</p>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="xero-posting-mode">{flow.postingMode}</label>
            <select id="xero-posting-mode" className={cn(SELECT_CLASS, 'w-full')} value={postingMode} onChange={(event) => changePostingMode(event.target.value)} disabled={Boolean(busy)}>
              <option value="draft">{flow.draftMode}</option>
              <option value="authorised">{flow.authorisedMode}</option>
            </select>
            <div className="flex justify-end"><Button type="button" onClick={() => runPreview()} disabled={Boolean(busy) || !portalStatus?.xero?.connected || !scopeFlags.invoices || !scopeFlags.contacts || !scopeFlags.settingsRead || !scopeFlags.paymentsRead}>
              {actionIcon(busy === 'preview', ShieldCheck)}
              {busy === 'preview' ? financialCopy.checkingEverything : financialCopy.checkEverything}
            </Button></div>
            <XeroDailyAllowance snapshot={dailyAllowance} language={language} />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
          <div className={cn('col-span-2 rounded-lg border px-4 py-3 lg:col-span-1', reconciliation.status === 'reconciled' ? 'border-emerald-200 bg-emerald-50' : reconciliation.status === 'attention_required' ? 'border-rose-200 bg-rose-50' : 'border-sky-200 bg-white')}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{financialCopy.completion}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{reconciliation.completion == null ? '—' : `${reconciliation.completion}%`}</div>
            <div className="mt-1 text-sm font-medium">{reconciliation.status === 'waiting' ? flow.waiting : financialCopy.reconciliationStatuses[reconciliation.status]}</div>
          </div>
          {[
            [financialCopy.salesforceRecords, reconciliation.total],
            [financialCopy.correctInXero, reconciliation.reconciled, 'emerald'],
            [financialCopy.awaitingSync, reconciliation.pending, 'amber'],
            [financialCopy.exceptions, reconciliation.exceptions, 'rose'],
          ].map(([label, value, tone]) => <CutoverKpi key={label} label={label} value={reconciliation.checked ? value : null} tone={tone} />)}
        </div>
        <div className="mt-3 rounded-lg border border-sky-100 bg-white/80 px-3 py-2 text-sm text-slate-700">
          {reconciliation.status === 'waiting' ? flow.waitingDescription : financialCopy.reconciliationDescriptions[reconciliation.status]}
          {reconciliation.waiting > 0 && <div>{flow.waiting}: {reconciliation.waiting}</div>}
          {reconciliation.documents.acceptedLegacy > 0 && <div>{flow.acceptedLegacy}: {reconciliation.documents.acceptedLegacy}</div>}
        </div>
        {!scopeFlags.settingsRead || !scopeFlags.paymentsRead ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{financialCopy.reconnect}</div> : null}
      </section>



      {preview && <div className="space-y-3">
        <Button size="sm" variant="ghost" onClick={() => { setView(stemContext ? 'all' : 'attention'); setSearch(stemContext); }}>Reset filters</Button>
        <p className={DETAIL_CLASS}>{flow.checked}: {new Date(preview.checkedAt || preview.run.createdAt).toLocaleString(copy.locale)} · {flow.saved} · {flow.savedMode}: {savedPostingMode(preview) === 'authorised' ? flow.authorisedMode : flow.draftMode}</p>
        {!previewMatchesMode && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{flow.modeChanged}</p>}
        <div className="flex flex-wrap gap-2">{['attention', 'ready', 'waiting', 'matched', 'all'].map((bucket) => <Button key={bucket} variant={view === bucket ? 'default' : 'outline'} size="sm" onClick={() => { setView(bucket); setDocumentPage(0); setPaymentPage(0); }}>{flow[bucket]} ({[...(preview.rows || []).map((row) => reconciliationBucket(row)), ...(payments?.rows || []).map((row) => reconciliationBucket(row, 'payment'))].filter((value) => bucket === 'all' || bucket === value).length})</Button>)}</div>
        <Input aria-label={flow.search} placeholder={flow.search} value={search} onChange={(event) => { setSearch(event.target.value); setDocumentPage(0); setPaymentPage(0); }} />
        {!financialGate?.enabled && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{flow.locked}</p>}
      </div>}
      {preview ? (
        <>


          <section className={cn(PANEL_CLASS, 'finance-batch-review')}>
            <div className={SECTION_HEADER_CLASS}>
              {sectionHeading(financialCopy.reviewTitle, financialCopy.runSummary(preview.run?.id?.slice(0, 8), copy.statuses[preview.run?.status] || preview.run?.status?.replaceAll('_', ' '), reviewRows.length, eligibleRows.length))}
              <div className={ACTIONS_CLASS}>
                <Button type="button" variant="outline" onClick={() => setSelected(new Set(eligibleRows.map((row) => row.id)))} disabled={!canReviewRun || !previewMatchesMode}>{financialCopy.selectEligible}</Button>
                <Button type="button" variant="outline" onClick={() => setSelected(new Set())} disabled={!canReviewRun}>{copy.common.clear}</Button>
                <Button type="button" onClick={() => { setReviewTarget(null); setReviewOpen(true); }} disabled={Boolean(busy) || !previewMatchesMode || !financialGate?.enabled || !['ready_for_review', 'authorised', 'partial', 'failed'].includes(preview.run?.status) || (preview.run?.status === 'ready_for_review' && !batchSelectionEligible)}>
                  {actionIcon(busy === 'run')}{preview.run?.status === 'ready_for_review' ? (selectedLinksOnly ? flow.reviewLinks : flow.review) : flow.resume}
                </Button>
              </div>
            </div>
            {pagination(documentPage, documentPageCount, orderedDocuments.length, PAGE_SIZE, setDocumentPage, financialCopy.rowRange, copy.common, 'mt-3')}
            <div className="finance-batch-review__wide mt-4">
              <Table className="table-fixed min-w-0 [&_th]:whitespace-normal [&_td]:[overflow-wrap:anywhere]" scrollLabel={financialCopy.documentTableLabel} containerClassName="max-h-[680px]">
                <colgroup>{[3, 14, 25, 13, 17, 10, 9, 9].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                {tableHeader([copy.common.use, financialCopy.salesforceDocument, copy.common.reason, copy.common.action, financialCopy.accountStem, copy.common.date, copy.common.total, 'Xero'], true)}
                <TableBody>
                  {!visibleDocuments.length && <TableRow><TableCell colSpan={8}>{flow.noRows}</TableCell></TableRow>}
                  {visibleDocuments.map((row) => (
                    <TableRow key={row.id}>
                      {tableCells([
                        <Checkbox checked={canReviewRun ? selected.has(row.id) : Boolean(row.selected)} disabled={!previewMatchesMode || !documentExplicitReviewEligible(row) || !canReviewRun} onCheckedChange={(value) => toggleSelection(row.id, value === true, setSelected)} />,
                        detailPair(row.documentNumber, financialCopy.documentKinds[row.documentKind] || row.documentKind?.replaceAll('_', ' ')),
                        <DocumentReason row={row} flow={flow} copy={copy} financialCopy={financialCopy} openDocumentReview={openDocumentReview} setFixMapping={setFixMapping} />,
                        <FinancialActionBadge action={row.action} status={row.status} copy={copy} flow={flow} />,
                        detailPair(row.accountName, <>{row.companyCode || copy.common.noClKey} · {row.stemName || copy.common.noStem}</>),
                        detailPair(row.invoiceDate, <>{financialCopy.due} {row.dueDate || copy.common.notSet}</>, false),
                        <>{row.currency} {formatAmount(row.total, copy.locale)}</>,
                        <>{row.xero?.url ? <a href={row.xero.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">{row.xero.number || copy.common.open} <ExternalLink className="h-3 w-3" /></a> : financialCopy.noActiveMatch}{row.xero?.status ? <div className={DETAIL_CLASS}>{row.xero.status}</div> : null}</>,
                      ], { 2: 'align-top', 6: 'tabular-nums' })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="finance-batch-review__compact mt-4">
              <Table className="table-fixed min-w-0" containerClassName="max-h-[680px]" scrollLabel={financialCopy.documentTableLabel}>
                {tableHeader([copy.common.use, copy.common.reason], true)}
                <TableBody>
                  {!visibleDocuments.length && <TableRow><TableCell colSpan={2}>{flow.noRows}</TableCell></TableRow>}
                  {visibleDocuments.map((row) => <TableRow key={row.id}>
                    <TableCell className="w-9 align-top"><Checkbox checked={canReviewRun ? selected.has(row.id) : Boolean(row.selected)} disabled={!previewMatchesMode || !documentExplicitReviewEligible(row) || !canReviewRun} onCheckedChange={(value) => toggleSelection(row.id, value === true, setSelected)} /></TableCell>
                    <TableCell className="min-w-0 whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium break-all">{row.documentNumber}</span><FinancialActionBadge action={row.action} status={row.status} copy={copy} flow={flow} /></div>
                      <div className={DETAIL_CLASS}>{financialCopy.documentKinds[row.documentKind] || row.documentKind?.replaceAll('_', ' ')} · {row.accountName} · {row.companyCode || copy.common.noClKey} · {row.stemName || copy.common.noStem}</div>
                      <div className={DETAIL_CLASS}>{row.invoiceDate} · {financialCopy.due} {row.dueDate || copy.common.notSet} · {row.currency} {formatAmount(row.total, copy.locale)}</div>
                      <div className={DETAIL_CLASS}>{row.xero?.url ? <a href={row.xero.url} target="_blank" rel="noreferrer" className={LINK_CLASS}>{row.xero.number || copy.common.open}</a> : financialCopy.noActiveMatch}{row.xero?.status ? ` · ${row.xero.status}` : ''}</div>
                      <div className="mt-2 border-t border-border pt-2"><div className="text-xs font-semibold text-muted-foreground">{copy.common.reason}</div><DocumentReason row={row} flow={flow} copy={copy} financialCopy={financialCopy} openDocumentReview={openDocumentReview} setFixMapping={setFixMapping} /></div>
                    </TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className={PANEL_CLASS}>
            <div className={SECTION_HEADER_CLASS}>
              {sectionHeading(financialCopy.paymentsTitle, financialCopy.paymentsDescription)}
              <Button type="button" variant="outline" onClick={previewPayments} disabled={Boolean(busy)}>{actionIcon(busy === 'payment-preview', ShieldCheck)}{financialCopy.previewPayments}</Button>
            </div>
            {payments ? (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-muted-foreground">{financialCopy.paymentSummary(payments.summary?.total || 0, payments.summary?.paymentApply || 0)}</div>
                  <div className={ACTIONS_CLASS}>
                    <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><Checkbox checked={paymentsReviewed} onCheckedChange={(value) => setPaymentsReviewed(value === true)} />{financialCopy.financeReviewedPayments}</label>
                    <Button type="button" onClick={applyPayments} disabled={!paymentsReviewed || !selectedPayments.size || !financialGate?.enabled || Boolean(busy)}>{actionIcon(busy === 'payment-apply', Play)}{financialCopy.applyPayments}</Button>
                  </div>
                </div>
                {pagination(paymentPage, paymentPageCount, orderedPayments.length, PAGE_SIZE, setPaymentPage, financialCopy.rowRange, copy.common)}
                <div className={cn('max-h-[420px]', TABLE_FRAME_CLASS)}>
                  <Table scrollLabel={financialCopy.paymentTableLabel}>{tableHeader([copy.common.use, financialCopy.payment, copy.common.type, copy.common.date, copy.common.bank, copy.common.amount, financialCopy.actionReason])}<TableBody>
                    {!visiblePayments.length && <TableRow><TableCell colSpan={7}>{flow.noRows}</TableCell></TableRow>}
                    {visiblePayments.map((row) => <TableRow key={row.salesforcePaymentId}>{tableCells([
                      <Checkbox checked={selectedPayments.has(row.salesforcePaymentId)} disabled={row.action !== 'payment_apply' || row.status !== 'eligible'} onCheckedChange={(value) => toggleSelection(row.salesforcePaymentId, value === true, setSelectedPayments)} />,
                      row.salesforcePaymentName, row.type, row.paymentDate, row.bank || copy.common.notSet,
                      <>{row.currency} {formatAmount(row.amount, copy.locale)}</>,
                      <>{row.blockers?.join('; ') || financialCopy.actions[row.action] || row.action?.replaceAll('_', ' ')}{(row.blockers || []).some((reason) => /bank mapping/i.test(reason)) && <Button variant="link" size="sm" onClick={() => setFixMapping({ bank: row.bank, documentNumber: row.salesforcePaymentName })}>{flow.mapping}</Button>}{row.stemId && <a className={LINK_CLASS} href={`/disputes?stem=${encodeURIComponent(row.stemId)}`}>Dispute / settlement</a>}{row.xeroDocumentUrl && <a className="block text-blue-700 underline" href={row.xeroDocumentUrl} target="_blank" rel="noreferrer">Xero</a>}</>,
                    ], { 1: 'font-medium' })}</TableRow>)}
                  </TableBody></Table>
                </div>
              </div>
            ) : <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{financialCopy.noPaymentPreview}</div>}
          </section>
        </>
      ) : <StateBlock icon={AlertTriangle} title={financialCopy.noPreviewTitle} description={financialCopy.noPreviewDescription} />}
      <details className={PANEL_CLASS}>
        <summary className="cursor-pointer list-none">
          <div className={BETWEEN_CLASS}>
            {sectionHeading(financialCopy.setupTitle, financialCopy.setupDescription)}
            <div className="text-right text-xs text-muted-foreground"><div>{financialCopy.savedMappings((mappings?.productMappings || []).length)}</div>{preview ? <div>{financialCopy.proposalSummary(mappingProposalSummary.proposed, mappingProposalSummary.conflicts)}</div> : null}</div>
          </div>
        </summary>
        <div className="mt-4 space-y-5 border-t border-border pt-4">
          <div className={BETWEEN_CLASS}>
            {sectionHeading(financialCopy.mappingTitle, financialCopy.mappingDescription, true)}
            <Button type="button" variant="outline" onClick={() => loadMappings()} disabled={Boolean(busy)}><RefreshCw className="mr-2 h-4 w-4" />{financialCopy.mappings}</Button>
          </div>
          <p className={DESCRIPTION_CLASS}>{language === 'zh-Hant'
            ? '每次完整核對會自動核准 Salesforce 石油產品的 Xero 對應：買方 41100、供應商 51100，稅務 NONE。'
            : 'Each full check auto-approves Xero mappings for Salesforce petroleum products: buyer 41100, supplier 51100, tax NONE.'}</p>
          {products.length ? (
            <div className="space-y-3">
              {pagination(mappingPage, mappingPageCount, productMappingRows.length, MAPPING_PAGE_SIZE, setMappingPage, financialCopy.mappingRange, copy.common)}
              <div className={cn('max-h-[520px]', TABLE_FRAME_CLASS)}>
                <Table scrollLabel={financialCopy.productMappingsLabel}>
                  {tableHeader([financialCopy.direction, financialCopy.salesforceProduct, financialCopy.xeroAccount, financialCopy.taxType, financialCopy.action])}
                  <TableBody>{visibleProductMappings.map((row) => <ProductMappingRow key={row.key} direction={row.direction} product={row.product} mapping={row.mapping} proposal={row.proposal} accounts={mappings?.accountOptions || []} taxes={mappings?.taxOptions || []} onSaved={loadMappings} copy={copy} />)}</TableBody>
                </Table>
              </div>
            </div>
          ) : <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{financialCopy.noProducts}</div>}
          <div>
            <h3 className="text-sm font-semibold">{financialCopy.bankTitle}</h3>
            <p className={DESCRIPTION_CLASS}>{financialCopy.bankDescription}</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">{DEFAULT_BANKS.map((bank) => <BankMapping key={bank} bank={bank} mapping={bankMappingIndex.get(bank)} accounts={(mappings?.accountOptions || []).filter((account) => account.bank)} onSaved={loadMappings} copy={copy} />)}</div>
          </div>
        </div>
      </details>
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{reviewTarget ? (targetEligible ? flow.singleReview : flow.resolve) : !canReviewRun ? flow.resume : selectedLinksOnly ? flow.reviewLinks : flow.review}</DialogTitle><DialogDescription>{canReviewRun ? flow.reviewDescription : flow.resumeDescription}</DialogDescription></DialogHeader>
        {reviewTarget && (!targetRow || !targetEligible) && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{!targetRow ? flow.targetMissing : targetResult.evidenceMissing ? flow.targetEvidenceMissing : targetResult.changed ? flow.targetChanged : flow.correctAndRecheck}</p>}
        {reviewTarget && !financialGate?.enabled && <p role="status" className="text-sm text-amber-900">{flow.locked}</p>}
        <div className="space-y-2">{documentReviewTotals(dialogRows).map((total) => <p key={`${total.currency}:${total.action}`}>{total.action === 'protected_legacy' ? flow.protectedLinkAction : financialCopy.actions[total.action] || total.action}: {total.count} · {total.currency} {formatAmount(total.total, copy.locale)}</p>)}</div>
        <div className="max-h-72 overflow-auto">{dialogRows.map((row) => <div key={row.id} className="border-b py-2 text-sm"><b>{row.documentNumber}</b> · {row.accountName} · {row.currency} {formatAmount(row.total, copy.locale)} · {row.invoiceDate}<div>{row.action === 'protected_legacy' ? flow.protectedLinkAction : financialCopy.actions[row.action] || row.action}</div>{row.action === 'protected_legacy' && <p className="font-medium text-amber-800">{flow.legacyReview}</p>}<DocumentEvidence row={row} flow={flow} copy={copy} expanded /></div>)}</div>
        <div className="flex flex-wrap justify-end gap-2">{reviewTarget && <Button variant="outline" onClick={recheckTarget} disabled={Boolean(busy)}>{flow.recheck}</Button>}{reviewTarget && targetMappingBlocked && <Button variant="outline" onClick={openMappingFromReview} disabled={Boolean(busy)}>{flow.mapping}</Button>}<Button variant="outline" onClick={() => setReviewOpen(false)} disabled={Boolean(busy)}>{flow.cancel}</Button><Button onClick={executeRun} disabled={Boolean(busy) || !previewMatchesMode || !financialGate?.enabled || (reviewTarget ? !canReviewRun || !targetEligible : canReviewRun && !batchSelectionEligible)}>{reviewTarget ? singleApproval : !canReviewRun ? flow.resume : selectedLinksOnly ? flow.approveLink : postingMode === 'authorised' ? flow.authorisedMode : flow.confirm}</Button></div>
      </DialogContent></Dialog>
      <Dialog open={Boolean(fixMapping)} onOpenChange={(open) => { if (!open) setFixMapping(null); }}><DialogContent className="max-h-[85vh] max-w-5xl overflow-auto"><DialogHeader><DialogTitle>{flow.mapping} · {fixMapping?.documentNumber}</DialogTitle><DialogDescription>{financialCopy.mappingDescription}</DialogDescription></DialogHeader>
        {fixMapping?.bank && <BankMapping bank={fixMapping.bank} mapping={bankMappingIndex.get(fixMapping.bank)} accounts={(mappings?.accountOptions || []).filter((account) => account.bank)} onSaved={mappingSaved} copy={copy} />}
        <Table><TableBody>{productMappingRows.filter((row) => row.direction === (fixMapping?.documentKind?.startsWith('buyer') ? 'buyer' : 'supplier') && fixMapping?.mappingProducts?.some((product) => product.id === row.product.id)).map((row) => <ProductMappingRow key={row.key} {...row} accounts={mappings?.accountOptions || []} taxes={mappings?.taxOptions || []} onSaved={mappingSaved} copy={copy} />)}</TableBody></Table>
        <Button variant="outline" onClick={() => setFixMapping(null)}>{copy.common.close || flow.cancel}</Button>
      </DialogContent></Dialog>
    </div>
  );
}

function ProductMappingRow({ direction, product, mapping, proposal, accounts, taxes, onSaved, copy }) {
  const financialCopy = copy.financial;
  const suggestedAccountCode = !mapping && proposal?.status === 'proposed' ? proposal.xeroAccountCode : '';
  const suggestedTaxType = !mapping && proposal?.status === 'proposed' ? proposal.xeroTaxType : 'NONE';
  const [accountCode, setAccountCode] = useState(mapping?.xeroAccountCode || suggestedAccountCode || '');
  const [taxType, setTaxType] = useState(mapping?.xeroTaxType || suggestedTaxType || 'NONE');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAccountCode(mapping?.xeroAccountCode || suggestedAccountCode || '');
    setTaxType(mapping?.xeroTaxType || suggestedTaxType || 'NONE');
  }, [mapping, suggestedAccountCode, suggestedTaxType]);
  async function save() {
    const account = accounts.find((row) => row.code === accountCode);
    if (!account) return;
    setBusy(true);
    const result = await appClient.functions.invoke('xeroFinancialMappingsSave', { mappingType: 'product', id: mapping?.id || null, revision: mapping?.revision || null, direction, salesforceProductId: product.id, salesforceProductName: product.name, xeroAccountCode: account.code, xeroAccountName: account.name, xeroTaxType: taxType }, MUTATION_OPTIONS);
    setBusy(false);
    if (result.data?.error) toast({ title: financialCopy.mappingSaveFailed, description: result.data.error, variant: 'destructive' }); else { toast({ title: financialCopy.mappingSaved }); await onSaved(); }
  }
  const evidenceLabel = mapping
    ? (mapping.approvedByEmail ? financialCopy.approvedBy(mapping.approvedByEmail) : financialCopy.approved)
    : proposal?.status === 'proposed'
      ? financialCopy.suggested(proposal.documentCount, mappingEvidenceBasisLabel(proposal.evidenceBasis, financialCopy))
      : proposal?.status === 'conflict'
        ? financialCopy.conflicting(proposal.alternatives.map((item) => `${item.xeroAccountCode}/${item.xeroTaxType}`).join(', '))
        : financialCopy.noSuggestion;
  return <TableRow>{tableCells([
    financialCopy.directions[direction] || direction,
    <><div className="font-medium">{product.name}</div><div className={cn('mt-1 text-xs', mapping ? 'text-emerald-700' : proposal?.status === 'conflict' ? 'text-amber-700' : 'text-muted-foreground')}>{evidenceLabel}</div></>,
    <select value={accountCode} onChange={(event) => setAccountCode(event.target.value)} className={cn(SELECT_CLASS, 'min-w-[260px]')}><option value="">{financialCopy.selectAccount}</option>{accounts.filter((row) => !row.bank).map((row) => <option key={row.id} value={row.code}>{row.code} · {row.name}</option>)}</select>,
    <select value={taxType} onChange={(event) => setTaxType(event.target.value)} className={cn(SELECT_CLASS, 'min-w-[180px]')}><option value="NONE">NONE</option>{taxes.filter((row) => row.taxType !== 'NONE').map((row) => <option key={row.taxType} value={row.taxType}>{row.taxType} · {row.name}</option>)}</select>,
    <Button type="button" size="sm" variant="outline" onClick={save} disabled={!accountCode || busy}>{actionIcon(busy, Save, true)}{mapping ? financialCopy.updateApproval : financialCopy.approveMapping}</Button>,
  ])}</TableRow>;
}

function mappingReviewRank(row) {
  return row.mapping ? 3 : row.proposal?.status === 'proposed' ? 0 : row.proposal?.status === 'conflict' ? 1 : 2;
}

function mappingEvidenceBasisLabel(basis, financialCopy) {
  return financialCopy.basis[basis] || financialCopy.basis.default;
}

function detailPair(value, detail, emphasis = true) {
  return <><div className={emphasis ? 'font-medium' : undefined}>{value}</div><div className={DETAIL_CLASS}>{detail}</div></>;
}

function tableHeader(labels, narrowFirst = false) {
  return <TableHeader><TableRow>{labels.map((label, index) => <TableHead key={index} className={narrowFirst && index === 0 ? 'w-10' : undefined}>{label}</TableHead>)}</TableRow></TableHeader>;
}

function tableCells(values, classes = {}) {
  return values.map((value, index) => <TableCell key={index} className={classes[index]}>{value}</TableCell>);
}

function actionIcon(busy, Icon, compact = false) {
  const Graphic = busy ? Loader2 : Icon;
  return Graphic ? <Graphic className={cn(compact ? 'mr-2 h-3.5 w-3.5' : 'mr-2 h-4 w-4', busy && 'animate-spin')} /> : null;
}

function sectionHeading(title, description, small = false) {
  const Heading = small ? 'h3' : 'h2';
  return <div><Heading className={small ? 'text-sm font-semibold' : 'text-base font-semibold'}>{title}</Heading><p className={DESCRIPTION_CLASS}>{description}</p></div>;
}

function pagination(page, pageCount, total, pageSize, setPage, range, copy, className = '') {
  return <div className={cn(className, 'flex items-center justify-between gap-3 text-sm text-muted-foreground')}><span>{range(total ? page * pageSize + 1 : 0, Math.min((page + 1) * pageSize, total), total)}</span><div className="flex gap-2">{[-1, 1].map((step) => <Button key={step} type="button" size="sm" variant="outline" onClick={() => setPage((current) => Math.max(0, Math.min(pageCount - 1, current + step)))} disabled={step < 0 ? page === 0 : page >= pageCount - 1}>{step < 0 ? copy.previous : copy.next}</Button>)}</div></div>;
}

function BankMapping({ bank, mapping, accounts, onSaved, copy }) {
  const financialCopy = copy.financial;
  const [accountId, setAccountId] = useState(mapping?.xeroBankAccountId || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAccountId(mapping?.xeroBankAccountId || ''); }, [mapping]);
  async function save() {
    const account = accounts.find((row) => row.id === accountId);
    if (!account) return;
    setBusy(true);
    const result = await appClient.functions.invoke('xeroFinancialMappingsSave', { mappingType: 'bank', id: mapping?.id || null, revision: mapping?.revision || null, salesforceBankName: bank, xeroBankAccountId: account.id, xeroBankAccountCode: account.code, xeroBankAccountName: account.name }, MUTATION_OPTIONS);
    setBusy(false);
    if (result.data?.error) toast({ title: financialCopy.bankSaveFailed, description: result.data.error, variant: 'destructive' }); else { toast({ title: financialCopy.bankSaved(bank) }); await onSaved(); }
  }
  return <div className="rounded-lg border border-border bg-background p-3"><div className="text-sm font-semibold">{bank}</div><div className="mt-2 flex gap-2"><select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={cn(SELECT_CLASS, 'min-w-0 flex-1')}><option value="">{financialCopy.selectBank}</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.code ? `${row.code} · ` : ''}{row.name}</option>)}</select><Button type="button" size="sm" variant="outline" aria-label={`${financialCopy.mappings}: ${bank}`} onClick={save} disabled={!accountId || busy}>{actionIcon(busy, Save, true)}</Button></div></div>;
}

function CutoverKpi({ label, value, tone = 'neutral' }) {
  const classes = { neutral: 'border-slate-200 bg-slate-50', emerald: 'border-emerald-200 bg-emerald-50', amber: 'border-amber-200 bg-amber-50', rose: 'border-rose-200 bg-rose-50' };
  const number = Number(value);
  const hasValue = value !== null && value !== undefined && Number.isFinite(number);
  return <div className={cn('rounded-lg border px-4 py-3', classes[tone])}><div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{hasValue ? number.toLocaleString() : '—'}</div></div>;
}

function FinancialActionBadge({ action, status, copy, flow }) {
  const style = status === 'blocked' ? 'border-rose-200 bg-rose-50 text-rose-800' : status === 'protected' ? 'border-slate-300 bg-slate-100 text-slate-800' : action === 'create_draft' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-sky-200 bg-sky-50 text-sky-800';
  return <Badge variant="outline" className={cn('whitespace-normal break-words', style)}>{action === 'protected_legacy' ? flow.protectedLinkAction : copy.financial.actions[action] || copy.statuses[status] || String(action || status).replaceAll('_', ' ')}</Badge>;
}

function DocumentReason({ row, flow, copy, financialCopy, openDocumentReview, setFixMapping }) {
  const bucket = reconciliationBucket(row);
  const mappingBlocked = (row.blockers || []).some((reason) => /Salesforce Product|Xero account mapping|account codes?|tax treatment/i.test(reason));
  return <div className="min-w-0 break-words">
    <div>{row.blockers?.[0] || (row.status === 'blocked' ? flow.attention : row.acceptedLegacy ? flow.acceptedLegacy : row.warnings?.[0] || (row.differences?.length ? financialCopy.differenceCount(row.differences.length) : copy.common.exact))}</div>
    <div className="flex flex-wrap items-center gap-2">
      {['attention', 'ready'].includes(bucket) && <Button variant="link" size="sm" className="h-auto min-h-8 p-0" onClick={() => openDocumentReview(row)}>{bucket === 'attention' ? flow.resolve : flow.singleReview}</Button>}
      {mappingBlocked && <Button variant="link" size="sm" className="h-auto min-h-8 p-0" onClick={() => setFixMapping(row)}>{flow.mapping}</Button>}
    </div>
    <DocumentEvidence row={row} flow={flow} copy={copy} />
    {row.stemId && <a className={LINK_CLASS} href={`/disputes?stem=${encodeURIComponent(row.stemId)}`}>{row.dispute?.status ? `Dispute: ${row.dispute.status}` : 'Dispute / settlement'}</a>}
  </div>;
}

function DocumentEvidence({ row, flow, copy, expanded = false }) {
  const evidence = row.matchEvidence || {};
  const lines = [
    `${flow.accountId}: ${row.accountId || copy.common.notSet}`,
    `${flow.evidence}: ${flow.matchBasis[evidence.basis] || copy.common.notSet}`,
    ...(row.blockers || []).map((value) => `${flow.blockers}: ${value}`),
    ...(row.warnings || []).map((value) => `${flow.warnings}: ${value}`),
    ...(evidence.sharedAccounts || []).map((account) => `${flow.sharedAccounts}: ${[account.accountName, account.companyCode || copy.common.noClKey, account.accountId].join(' · ')}`),
    ...(evidence.candidates || []).map((candidate) => `${flow.candidates}: ${candidate.number || '—'} · ${candidate.id || '—'}`),
    ...(row.differences || []).map((difference) => `${flow.differences} · ${difference.field}: Salesforce ${formatDifferenceValue(difference.salesforce ?? difference.salesforceLineCount)} → Xero ${formatDifferenceValue(difference.xero ?? difference.xeroLineCount)}`),
  ].join('\n');
  return <details className="mt-2" open={expanded}><summary>{flow.details}</summary><div className="whitespace-pre-line text-xs text-muted-foreground">{lines}</div></details>;
}

function formatAmount(value, locale) { return Number(value || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function formatDifferenceValue(value) {
  if (Array.isArray(value)) return value.map((line) => `${line.description}: ${line.quantity} × ${line.unitAmount} · ${line.accountCode}/${line.taxType}`).join('; ');
  return String(value ?? '—');
}
