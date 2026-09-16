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
import { reconciliationBucket, retainedReviewSelection, reviewSelectionSnapshot, restoreReviewSelection, documentReviewTotals, workflowCopy } from '@/lib/financialWorkflowUi';

const DIRECTIONS = ['buyer', 'supplier'];
const DEFAULT_BANKS = ['DBS', 'UBS'];
const PAGE_SIZE = 100;
const MAPPING_PAGE_SIZE = 25;

export default function XeroFinancialSync({ portalStatus, language = 'en' }) {
  const copy = xeroPortalUiCopy(language);
  const financialCopy = copy.financial;
  const flow = workflowCopy(language);
  const [mappings, setMappings] = useState(null);
  const [preview, setPreview] = useState(null);
  const [payments, setPayments] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [selectedPayments, setSelectedPayments] = useState(new Set());
  const [reviewOpen, setReviewOpen] = useState(false);
  const stemContext = new URLSearchParams(window.location.search).get('stem') || '';
  const [view, setView] = usePageState(`xero-financial:view:${stemContext}`, stemContext ? 'all' : 'attention');
  const [search, setSearch] = usePageState(`xero-financial:search:${stemContext}`, stemContext);
  const [selectionState, setSelectionState] = usePageState('xero-financial:selection', null);
  const initialSelection = useRef(selectionState);
  const [fixMapping, setFixMapping] = useState(null);
  const requestBusy = useRef(false);
  const previewGeneration = useRef(0);
  const [paymentsReviewed, setPaymentsReviewed] = useState(false);
  const [documentPage, setDocumentPage] = useState(0);
  const [paymentPage, setPaymentPage] = useState(0);
  const [mappingPage, setMappingPage] = useState(0);
  const [busy, setBusy] = useState('mappings');
  const [error, setError] = useState('');

  const loadMappings = useCallback(async () => {
    setBusy('mappings');
    setError('');
    const result = await appClient.functions.invoke('xeroFinancialMappingsGet', {}, { force: true, cache: false });
    setBusy('');
    if (result.data?.error) {
      setError(result.data.error);
      return;
    }
    setMappings(result.data);
  }, []);

  useEffect(() => {
    let active = true;
    loadMappings();
    appClient.functions.invoke('xeroFinancialSyncLatest', {}, { force: true, cache: false }).then((result) => {
      if (!active || previewGeneration.current > 0 || result.data?.error || !result.data?.preview) return;
      setPreview(result.data.preview);
      setPayments(result.data.preview.payments);
      const saved = initialSelection.current;
      const sameRun = saved?.runId === result.data.preview.run?.id;
      setSelected(sameRun && result.data.preview.run?.status === 'ready_for_review'
        ? restoreReviewSelection(saved.documents, result.data.preview.rows)
        : new Set(result.data.preview.rows.filter((row) => row.selected).map((row) => row.id)));
      setSelectedPayments(sameRun ? restoreReviewSelection(saved.payments, result.data.preview.payments?.rows || [], 'payment') : new Set());
    }).catch(() => { if (active) setError('The last check could not be loaded. Run Check everything to retry.'); });
    return () => { active = false; };
  }, [loadMappings]);

  useEffect(() => {
    if (!preview?.run?.id) return;
    setSelectionState({ runId: preview.run.id,
      documents: reviewSelectionSnapshot(preview.rows || [], selected),
      payments: reviewSelectionSnapshot(payments?.rows || [], selectedPayments, 'payment') });
  }, [preview, payments, selected, selectedPayments, setSelectionState]);

  // Refresh on return to this page, keeping a current review stable while its dialog is open.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !busy && !reviewOpen && !fixMapping && preview
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
  const eligibleRows = useMemo(() => (preview?.rows || []).filter((row) => row.status === 'eligible' && ['create_draft', 'safe_update'].includes(row.action)), [preview]);
  const orderedDocuments = useMemo(() => [...(preview?.rows || [])].filter((row) => (view === 'all' || reconciliationBucket(row) === view) && (!search.trim() || [row.documentNumber, row.accountName, row.stemName, row.stemId].join(' ').toLowerCase().includes(search.trim().toLowerCase()))).sort((left, right) => xeroFinancialReconciliationRank(left) - xeroFinancialReconciliationRank(right)), [preview, view, search]);
  const orderedPayments = useMemo(() => [...(payments?.rows || [])].filter((row) => (view === 'all' || reconciliationBucket(row, 'payment') === view) && (!search.trim() || [row.salesforcePaymentName, row.stemId].join(' ').toLowerCase().includes(search.trim().toLowerCase()))).sort((left, right) => xeroFinancialReconciliationRank(left, 'payment') - xeroFinancialReconciliationRank(right, 'payment')), [payments, view, search]);
  const documentPageCount = Math.max(1, Math.ceil(orderedDocuments.length / PAGE_SIZE));
  const paymentPageCount = Math.max(1, Math.ceil(orderedPayments.length / PAGE_SIZE));
  const visibleDocuments = useMemo(() => orderedDocuments.slice(documentPage * PAGE_SIZE, (documentPage + 1) * PAGE_SIZE), [documentPage, orderedDocuments]);
  const visiblePayments = useMemo(() => orderedPayments.slice(paymentPage * PAGE_SIZE, (paymentPage + 1) * PAGE_SIZE), [orderedPayments, paymentPage]);
  const reconciliation = useMemo(() => summarizeXeroFinancialReconciliation({ documents: preview?.rows, payments: payments?.rows }), [payments, preview]);
  const financialGate = portalStatus?.externalActions?.xero_financial_sync;
  const scopeFlags = portalStatus?.xero?.scopeFlags || {};

  async function runPreview(preserveSelection = false, checkChanges = false) {
    if (requestBusy.current) return;
    requestBusy.current = true;
    previewGeneration.current += 1;
    setBusy('preview');
    setError('');
    setReviewOpen(false);
    setPaymentsReviewed(false);
    try {
    const result = await appClient.functions.invoke('xeroFinancialSyncPreview', { cutoffDate: XERO_FINANCIAL_CUTOFF, includePayments: true, recordExactMatches: true, ...(checkChanges ? { refreshIfChangedRunId: preview?.run?.id } : {}) }, { force: true, cache: false, invalidateCache: true });
    if (result.data?.error) {
      requestBusy.current = false;
      setBusy('');
      setError(result.data.error);
      return;
    }
    if (result.data.unchanged) { setPreview((current) => ({ ...current, checkedAt: result.data.checkedAt })); return; }
    setPreview(result.data);
    setMappingPage(0);
    setDocumentPage(0);
    setSelected(preserveSelection ? retainedReviewSelection(preview?.rows || [], result.data.rows || [], selected)
      : new Set((result.data.rows || []).filter((row) => row.status === 'eligible' && reconciliationBucket(row) === 'ready').map((row) => row.id)));
    setPayments(result.data.payments);
    setPaymentPage(0);
    setSelectedPayments(new Set((result.data.payments?.rows || []).filter((row) => row.action === 'payment_apply' && row.status === 'eligible').map((row) => row.salesforcePaymentId)));
    } catch (nextError) {
      setError(nextError.message || 'The check could not be completed. Your last check is retained.');
    } finally { requestBusy.current = false; setBusy(''); }
  }

  async function executeRun() {
    setBusy('run');
    const result = await appClient.functions.invoke('xeroFinancialSyncRun', {
      runId: preview?.run?.id, revision: preview?.run?.revision,
      ...(preview?.run?.status === 'ready_for_review' ? { reviewed: true, selectedItemIds: [...selected] } : {}),
    }, { force: true, cache: false, invalidateCache: true });
    setBusy('');
    setReviewOpen(false);
    if (result.data?.error) {
      setError(result.data.error);
      const latest = await appClient.functions.invoke('xeroFinancialSyncLatest', {}, { force: true, cache: false });
      if (latest.data?.preview) setPreview(latest.data.preview);
      return;
    }
    toast({ title: financialCopy.batchCompleted, description: financialCopy.outcome(result.data.summary || {}) });
    const changed = (result.data.outcomes || []).filter((row) => row.reviewRequired).flatMap((row) => row.errors || []);
    await runPreview(true);
    if (changed.length) setError(changed.join(' '));
  }

  async function mappingSaved() {
    await loadMappings();
    await runPreview(true);
  }

  async function previewPayments() {
    setBusy('payment-preview');
    setPaymentsReviewed(false);
    const result = await appClient.functions.invoke('xeroFinancialPaymentApply', { mode: 'preview', cutoffDate: XERO_FINANCIAL_CUTOFF }, { force: true, cache: false });
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
    }, { force: true, cache: false, invalidateCache: true });
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{financialCopy.reconciliationTitle}</h2>
              <Badge variant="outline" className="border-sky-200 bg-white text-sky-800">{financialCopy.fixedScope}</Badge>
              <Badge variant="outline" className={financialGate?.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}>
                {financialGate?.enabled ? financialCopy.gateEnabled : financialCopy.gateLocked}
              </Badge>
            </div>
            <p className="mt-2 max-w-4xl text-sm text-slate-700">{financialCopy.reconciliationDescription}</p>
          </div>
          <Button type="button" onClick={() => runPreview()} disabled={Boolean(busy) || !portalStatus?.xero?.connected || !scopeFlags.invoices || !scopeFlags.contacts || !scopeFlags.settingsRead || !scopeFlags.paymentsRead}>
            {busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            {busy === 'preview' ? financialCopy.checkingEverything : financialCopy.checkEverything}
          </Button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
          <div className={cn('col-span-2 rounded-lg border px-4 py-3 lg:col-span-1', reconciliation.status === 'reconciled' ? 'border-emerald-200 bg-emerald-50' : reconciliation.status === 'attention_required' ? 'border-rose-200 bg-rose-50' : 'border-sky-200 bg-white')}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{financialCopy.completion}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{reconciliation.completion == null ? '—' : `${reconciliation.completion}%`}</div>
            <div className="mt-1 text-sm font-medium">{financialCopy.reconciliationStatuses[reconciliation.status]}</div>
          </div>
          <CutoverKpi label={financialCopy.salesforceRecords} value={reconciliation.checked ? reconciliation.total : null} />
          <CutoverKpi label={financialCopy.correctInXero} value={reconciliation.checked ? reconciliation.reconciled : null} tone="emerald" />
          <CutoverKpi label={financialCopy.awaitingSync} value={reconciliation.checked ? reconciliation.pending : null} tone="amber" />
          <CutoverKpi label={financialCopy.exceptions} value={reconciliation.checked ? reconciliation.exceptions : null} tone="rose" />
        </div>
        <div className="mt-3 rounded-lg border border-sky-100 bg-white/80 px-3 py-2 text-sm text-slate-700">
          {financialCopy.reconciliationDescriptions[reconciliation.status]}
        </div>
        {!scopeFlags.settingsRead || !scopeFlags.paymentsRead ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{financialCopy.reconnect}</div> : null}
      </section>



      {preview && <div className="space-y-3">
        <Button size="sm" variant="ghost" onClick={() => { setView(stemContext ? 'all' : 'attention'); setSearch(stemContext); }}>Reset filters</Button>
        <p className="text-xs text-muted-foreground">{flow.checked}: {new Date(preview.checkedAt || preview.run.createdAt).toLocaleString(copy.locale)} · {flow.saved}</p>
        <div className="flex flex-wrap gap-2">{['attention', 'ready', 'waiting', 'matched', 'all'].map((bucket) => <Button key={bucket} variant={view === bucket ? 'default' : 'outline'} size="sm" onClick={() => { setView(bucket); setDocumentPage(0); setPaymentPage(0); }}>{flow[bucket]} ({[...(preview.rows || []).map((row) => reconciliationBucket(row)), ...(payments?.rows || []).map((row) => reconciliationBucket(row, 'payment'))].filter((value) => bucket === 'all' || bucket === value).length})</Button>)}</div>
        <Input aria-label={flow.search} placeholder={flow.search} value={search} onChange={(event) => { setSearch(event.target.value); setDocumentPage(0); setPaymentPage(0); }} />
        {!financialGate?.enabled && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{flow.locked}</p>}
      </div>}
      {preview ? (
        <>


          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold">{financialCopy.reviewTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{financialCopy.runSummary(preview.run?.id?.slice(0, 8), copy.statuses[preview.run?.status] || preview.run?.status?.replaceAll('_', ' '), selected.size, eligibleRows.length)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setSelected(new Set(eligibleRows.map((row) => row.id)))}>{financialCopy.selectEligible}</Button>
                <Button type="button" variant="outline" onClick={() => setSelected(new Set())}>{copy.common.clear}</Button>
                <Button type="button" onClick={() => setReviewOpen(true)} disabled={Boolean(busy) || !financialGate?.enabled || !['ready_for_review', 'authorised', 'partial', 'failed'].includes(preview.run?.status) || (preview.run?.status === 'ready_for_review' && !selected.size)}>
                  {busy === 'run' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{preview.run?.status === 'ready_for_review' ? flow.review : flow.resume}
                </Button>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>{financialCopy.rowRange(orderedDocuments.length ? documentPage * PAGE_SIZE + 1 : 0, Math.min((documentPage + 1) * PAGE_SIZE, orderedDocuments.length), orderedDocuments.length)}</span>
              <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setDocumentPage((page) => Math.max(0, page - 1))} disabled={documentPage === 0}>{copy.common.previous}</Button><Button type="button" size="sm" variant="outline" onClick={() => setDocumentPage((page) => Math.min(documentPageCount - 1, page + 1))} disabled={documentPage >= documentPageCount - 1}>{copy.common.next}</Button></div>
            </div>
            <div className="mt-4 max-h-[680px] overflow-auto rounded-lg border border-border">
              <Table scrollLabel={financialCopy.documentTableLabel}>
                <TableHeader><TableRow><TableHead className="w-10">{copy.common.use}</TableHead><TableHead>{copy.common.action}</TableHead><TableHead>{financialCopy.salesforceDocument}</TableHead><TableHead>{financialCopy.accountStem}</TableHead><TableHead>{copy.common.date}</TableHead><TableHead>{copy.common.total}</TableHead><TableHead>Xero</TableHead><TableHead>{copy.common.reason}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {!visibleDocuments.length && <TableRow><TableCell colSpan={8}>{flow.noRows}</TableCell></TableRow>}
                  {visibleDocuments.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell><Checkbox checked={selected.has(row.id)} disabled={row.status !== 'eligible' || reconciliationBucket(row) !== 'ready' || preview.run?.status !== 'ready_for_review'} onCheckedChange={(value) => toggleSelection(row.id, value === true, setSelected)} /></TableCell>
                      <TableCell><FinancialActionBadge action={row.action} status={row.status} copy={copy} /></TableCell>
                      <TableCell><div className="font-medium">{row.documentNumber}</div><div className="text-xs text-muted-foreground">{financialCopy.documentKinds[row.documentKind] || row.documentKind?.replaceAll('_', ' ')}</div></TableCell>
                      <TableCell><div className="font-medium">{row.accountName}</div><div className="text-xs text-muted-foreground">{row.companyCode || copy.common.noClKey} · {row.stemName || copy.common.noStem}</div></TableCell>
                      <TableCell><div>{row.invoiceDate}</div><div className="text-xs text-muted-foreground">{financialCopy.due} {row.dueDate || copy.common.notSet}</div></TableCell>
                      <TableCell className="tabular-nums">{row.currency} {formatAmount(row.total, copy.locale)}</TableCell>
                      <TableCell>{row.xero?.url ? <a href={row.xero.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">{row.xero.number || copy.common.open} <ExternalLink className="h-3 w-3" /></a> : financialCopy.noActiveMatch}{row.xero?.status ? <div className="text-xs text-muted-foreground">{row.xero.status}</div> : null}</TableCell>
                      <TableCell className="max-w-[360px]"><div>{row.blockers?.[0] || row.warnings?.[0] || (row.differences?.length ? financialCopy.differenceCount(row.differences.length) : copy.common.exact)}</div>
                        {(row.blockers || []).some((reason) => /mapping|tax|account code/i.test(reason)) && <Button variant="link" size="sm" onClick={() => setFixMapping(row)}>{flow.mapping}</Button>}
                        {!!row.differences?.length && <details className="mt-2"><summary>{flow.details}</summary>{row.differences.map((difference, index) => <div key={index} className="text-xs">{difference.field}: Salesforce {formatDifferenceValue(difference.salesforce ?? difference.salesforceLineCount)} → Xero {formatDifferenceValue(difference.xero ?? difference.xeroLineCount)}</div>)}</details>}
                        {row.stemId && <a className="block text-xs text-blue-700 underline" href={`/disputes?stem=${encodeURIComponent(row.stemId)}`}>{row.dispute?.status ? `Dispute: ${row.dispute.status}` : 'Dispute / settlement'}</a>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div><h2 className="text-base font-semibold">{financialCopy.paymentsTitle}</h2><p className="mt-1 text-sm text-muted-foreground">{financialCopy.paymentsDescription}</p></div>
              <Button type="button" variant="outline" onClick={previewPayments} disabled={Boolean(busy)}>{busy === 'payment-preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{financialCopy.previewPayments}</Button>
            </div>
            {payments ? (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-muted-foreground">{financialCopy.paymentSummary(payments.summary?.total || 0, payments.summary?.paymentApply || 0)}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><Checkbox checked={paymentsReviewed} onCheckedChange={(value) => setPaymentsReviewed(value === true)} />{financialCopy.financeReviewedPayments}</label>
                    <Button type="button" onClick={applyPayments} disabled={!paymentsReviewed || !selectedPayments.size || !financialGate?.enabled || Boolean(busy)}>{busy === 'payment-apply' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}{financialCopy.applyPayments}</Button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{financialCopy.rowRange(orderedPayments.length ? paymentPage * PAGE_SIZE + 1 : 0, Math.min((paymentPage + 1) * PAGE_SIZE, orderedPayments.length), orderedPayments.length)}</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setPaymentPage((page) => Math.max(0, page - 1))} disabled={paymentPage === 0}>{copy.common.previous}</Button><Button type="button" size="sm" variant="outline" onClick={() => setPaymentPage((page) => Math.min(paymentPageCount - 1, page + 1))} disabled={paymentPage >= paymentPageCount - 1}>{copy.common.next}</Button></div></div>
                <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
                  <Table scrollLabel={financialCopy.paymentTableLabel}><TableHeader><TableRow><TableHead>{copy.common.use}</TableHead><TableHead>{financialCopy.payment}</TableHead><TableHead>{copy.common.type}</TableHead><TableHead>{copy.common.date}</TableHead><TableHead>{copy.common.bank}</TableHead><TableHead>{copy.common.amount}</TableHead><TableHead>{financialCopy.actionReason}</TableHead></TableRow></TableHeader><TableBody>
                    {!visiblePayments.length && <TableRow><TableCell colSpan={7}>{flow.noRows}</TableCell></TableRow>}
                    {visiblePayments.map((row) => <TableRow key={row.salesforcePaymentId}><TableCell><Checkbox checked={selectedPayments.has(row.salesforcePaymentId)} disabled={row.action !== 'payment_apply' || row.status !== 'eligible'} onCheckedChange={(value) => toggleSelection(row.salesforcePaymentId, value === true, setSelectedPayments)} /></TableCell><TableCell className="font-medium">{row.salesforcePaymentName}</TableCell><TableCell>{row.type}</TableCell><TableCell>{row.paymentDate}</TableCell><TableCell>{row.bank || copy.common.notSet}</TableCell><TableCell>{row.currency} {formatAmount(row.amount, copy.locale)}</TableCell><TableCell>{reconciliationBucket(row, 'payment') === 'waiting' ? flow.waitInvoice : row.blockers?.[0] || financialCopy.actions[row.action] || row.action?.replaceAll('_', ' ')}{(row.blockers || []).some((reason) => /bank mapping/i.test(reason)) && <Button variant="link" size="sm" onClick={() => setFixMapping({ bank: row.bank, documentNumber: row.salesforcePaymentName })}>{flow.mapping}</Button>}{row.stemId && <a className="block text-xs text-blue-700 underline" href={`/disputes?stem=${encodeURIComponent(row.stemId)}`}>Dispute / settlement</a>}{row.xeroDocumentUrl && <a className="block text-blue-700 underline" href={row.xeroDocumentUrl} target="_blank" rel="noreferrer">Xero</a>}</TableCell></TableRow>)}
                  </TableBody></Table>
                </div>
              </div>
            ) : <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{financialCopy.noPaymentPreview}</div>}
          </section>
        </>
      ) : <StateBlock icon={AlertTriangle} title={financialCopy.noPreviewTitle} description={financialCopy.noPreviewDescription} />}
      <details className="rounded-lg border border-border bg-card p-4">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-base font-semibold">{financialCopy.setupTitle}</h2><p className="mt-1 text-sm text-muted-foreground">{financialCopy.setupDescription}</p></div>
            <div className="text-right text-xs text-muted-foreground"><div>{financialCopy.savedMappings((mappings?.productMappings || []).length)}</div>{preview ? <div>{financialCopy.proposalSummary(mappingProposalSummary.proposed, mappingProposalSummary.conflicts)}</div> : null}</div>
          </div>
        </summary>
        <div className="mt-4 space-y-5 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold">{financialCopy.mappingTitle}</h3><p className="mt-1 text-sm text-muted-foreground">{financialCopy.mappingDescription}</p></div>
            <Button type="button" variant="outline" onClick={loadMappings} disabled={Boolean(busy)}><RefreshCw className="mr-2 h-4 w-4" />{financialCopy.mappings}</Button>
          </div>
          {products.length ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>{financialCopy.mappingRange(mappingPage * MAPPING_PAGE_SIZE + 1, Math.min((mappingPage + 1) * MAPPING_PAGE_SIZE, productMappingRows.length), productMappingRows.length)}</span>
                <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setMappingPage((page) => Math.max(0, page - 1))} disabled={mappingPage === 0}>{copy.common.previous}</Button><Button type="button" size="sm" variant="outline" onClick={() => setMappingPage((page) => Math.min(mappingPageCount - 1, page + 1))} disabled={mappingPage >= mappingPageCount - 1}>{copy.common.next}</Button></div>
              </div>
              <div className="max-h-[520px] overflow-auto rounded-lg border border-border">
                <Table scrollLabel={financialCopy.productMappingsLabel}>
                  <TableHeader><TableRow><TableHead>{financialCopy.direction}</TableHead><TableHead>{financialCopy.salesforceProduct}</TableHead><TableHead>{financialCopy.xeroAccount}</TableHead><TableHead>{financialCopy.taxType}</TableHead><TableHead>{financialCopy.action}</TableHead></TableRow></TableHeader>
                  <TableBody>{visibleProductMappings.map((row) => <ProductMappingRow key={row.key} direction={row.direction} product={row.product} mapping={row.mapping} proposal={row.proposal} accounts={mappings?.accountOptions || []} taxes={mappings?.taxOptions || []} onSaved={loadMappings} copy={copy} />)}</TableBody>
                </Table>
              </div>
            </div>
          ) : <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{financialCopy.noProducts}</div>}
          <div>
            <h3 className="text-sm font-semibold">{financialCopy.bankTitle}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{financialCopy.bankDescription}</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">{DEFAULT_BANKS.map((bank) => <BankMapping key={bank} bank={bank} mapping={bankMappingIndex.get(bank)} accounts={(mappings?.accountOptions || []).filter((account) => account.bank)} onSaved={loadMappings} copy={copy} />)}</div>
          </div>
        </div>
      </details>
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{flow.review}</DialogTitle><DialogDescription>{flow.reviewDescription}</DialogDescription></DialogHeader>
        <div className="space-y-2">{documentReviewTotals((preview?.rows || []).filter((row) => selected.has(row.id) || row.selected)).map((total) => <p key={`${total.currency}:${total.action}`}>{financialCopy.actions[total.action] || total.action}: {total.count} · {total.currency} {formatAmount(total.total, copy.locale)}</p>)}</div>
        <div className="max-h-72 overflow-auto">{(preview?.rows || []).filter((row) => selected.has(row.id) || row.selected).map((row) => <div key={row.id} className="border-b py-2 text-sm"><b>{row.documentNumber}</b> · {row.accountName} · {row.currency} {formatAmount(row.total, copy.locale)} · {row.invoiceDate}<div>{financialCopy.actions[row.action] || row.action}</div>{row.differences?.map((difference, i) => <div className="text-xs" key={i}>{difference.field}: {formatDifferenceValue(difference.xero ?? difference.xeroLineCount)} → {formatDifferenceValue(difference.salesforce ?? difference.salesforceLineCount)}</div>)}</div>)}</div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReviewOpen(false)} disabled={Boolean(busy)}>{flow.cancel}</Button><Button onClick={executeRun} disabled={Boolean(busy) || !financialGate?.enabled}>{flow.confirm}</Button></div>
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
    const result = await appClient.functions.invoke('xeroFinancialMappingsSave', { mappingType: 'product', id: mapping?.id || null, revision: mapping?.revision || null, direction, salesforceProductId: product.id, salesforceProductName: product.name, xeroAccountCode: account.code, xeroAccountName: account.name, xeroTaxType: taxType }, { force: true, cache: false, invalidateCache: true });
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
  return <TableRow><TableCell>{financialCopy.directions[direction] || direction}</TableCell><TableCell><div className="font-medium">{product.name}</div><div className={cn('mt-1 text-xs', mapping ? 'text-emerald-700' : proposal?.status === 'conflict' ? 'text-amber-700' : 'text-muted-foreground')}>{evidenceLabel}</div></TableCell><TableCell><select value={accountCode} onChange={(event) => setAccountCode(event.target.value)} className="h-9 min-w-[260px] rounded-md border border-input bg-background px-3 text-sm"><option value="">{financialCopy.selectAccount}</option>{accounts.filter((row) => !row.bank).map((row) => <option key={row.id} value={row.code}>{row.code} · {row.name}</option>)}</select></TableCell><TableCell><select value={taxType} onChange={(event) => setTaxType(event.target.value)} className="h-9 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm"><option value="NONE">NONE</option>{taxes.filter((row) => row.taxType !== 'NONE').map((row) => <option key={row.taxType} value={row.taxType}>{row.taxType} · {row.name}</option>)}</select></TableCell><TableCell><Button type="button" size="sm" variant="outline" onClick={save} disabled={!accountCode || busy}>{busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}{mapping ? financialCopy.updateApproval : financialCopy.approveMapping}</Button></TableCell></TableRow>;
}

function mappingReviewRank(row) {
  if (row.mapping) return 3;
  if (row.proposal?.status === 'proposed') return 0;
  if (row.proposal?.status === 'conflict') return 1;
  return 2;
}

function mappingEvidenceBasisLabel(basis, financialCopy) {
  if (basis === 'exact_line') return financialCopy.basis.exact_line;
  if (basis === 'uniform_document') return financialCopy.basis.uniform_document;
  return financialCopy.basis.default;
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
    const result = await appClient.functions.invoke('xeroFinancialMappingsSave', { mappingType: 'bank', id: mapping?.id || null, revision: mapping?.revision || null, salesforceBankName: bank, xeroBankAccountId: account.id, xeroBankAccountCode: account.code, xeroBankAccountName: account.name }, { force: true, cache: false, invalidateCache: true });
    setBusy(false);
    if (result.data?.error) toast({ title: financialCopy.bankSaveFailed, description: result.data.error, variant: 'destructive' }); else { toast({ title: financialCopy.bankSaved(bank) }); await onSaved(); }
  }
  return <div className="rounded-lg border border-border bg-background p-3"><div className="text-sm font-semibold">{bank}</div><div className="mt-2 flex gap-2"><select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"><option value="">{financialCopy.selectBank}</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.code ? `${row.code} · ` : ''}{row.name}</option>)}</select><Button type="button" size="sm" variant="outline" aria-label={`${financialCopy.mappings}: ${bank}`} onClick={save} disabled={!accountId || busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</Button></div></div>;
}

function CutoverKpi({ label, value, tone = 'neutral' }) {
  const classes = { neutral: 'border-slate-200 bg-slate-50', sky: 'border-sky-200 bg-sky-50', emerald: 'border-emerald-200 bg-emerald-50', amber: 'border-amber-200 bg-amber-50', slate: 'border-zinc-200 bg-zinc-50', rose: 'border-rose-200 bg-rose-50' };
  const number = Number(value);
  const hasValue = value !== null && value !== undefined && Number.isFinite(number);
  return <div className={cn('rounded-lg border px-4 py-3', classes[tone])}><div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{hasValue ? number.toLocaleString() : '—'}</div></div>;
}

function FinancialActionBadge({ action, status, copy }) {
  const style = status === 'blocked' ? 'border-rose-200 bg-rose-50 text-rose-800' : status === 'protected' ? 'border-slate-300 bg-slate-100 text-slate-800' : action === 'create_draft' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-sky-200 bg-sky-50 text-sky-800';
  return <Badge variant="outline" className={cn('whitespace-nowrap', style)}>{copy.financial.actions[action] || copy.statuses[status] || String(action || status).replaceAll('_', ' ')}</Badge>;
}

function formatAmount(value, locale) { return Number(value || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function formatDifferenceValue(value) {
  if (Array.isArray(value)) return value.map((line) => `${line.description}: ${line.quantity} × ${line.unitAmount} · ${line.accountCode}/${line.taxType}`).join('; ');
  return String(value ?? '—');
}
