import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { useAuth } from '@/lib/AuthContext';
import { CAMPAIGN_APPROVAL_LIMIT, CAMPAIGN_CATEGORIES, CAMPAIGN_STATUSES, REVIEW_CATEGORIES, amountFor, approvedRunQuotaMessage, labelFor, nextRunLimit, quotaMessage, reviewAfterRun, savedApprovedReview, selectableCampaignCase, selectionFromLoadedRows } from '@/lib/xeroReconciliationCampaign';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const REQUEST_OPTIONS = { force: true, cache: false };
const MUTATION_OPTIONS = { ...REQUEST_OPTIONS, invalidateCache: true };
const PAGE_SIZE = 50;
const timestamp = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toLocaleString('en-HK', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown time';
};
const campaignError = (response, fallback) => response?.data?.error || response?.error?.message || fallback;
const number = (value) => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-HK') : '—';
function SummaryCount({ label, value }) {
  return <div className="min-w-0 rounded-lg border border-border bg-background px-3 py-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="text-lg font-semibold tabular-nums">{number(value)}</div></div>;
}
function FieldDiff({ row }) {
  if (!row) return null;
  const parts = Array.isArray(row.changes) ? row.changes : [row];
  return <div className="rounded-md border border-border bg-muted/20 p-2 text-xs"><div className="font-medium">{row.caseTitle || row.caseId || row.title || 'Reviewed record'}</div>{parts.map((change, index) => <div key={`${change.field || index}:${index}`} className="mt-1 grid grid-cols-[minmax(100px,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2"><span>{change.fieldLabel || change.field || 'Link / action'}</span><span className="break-words text-muted-foreground">Current: {String(change.before ?? '—')}</span><span className="break-words">Proposed: {String(change.after ?? '—')}</span></div>)}</div>;
}

export default function XeroReconciliationCampaign({ onClose, baselineRun, enabled, connected, onAllowance }) {
  const { user } = useAuth();
  const [campaign, setCampaign] = useState(null);
  const [counts, setCounts] = useState(null);
  const [cases, setCases] = useState([]);
  const [page, setPage] = useState(null);
  const [allowance, setAllowance] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [connection, setConnection] = useState(null);
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('needs_decision');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [review, setReview] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [outcomes, setOutcomes] = useState(null);
  const [uncertainIds, setUncertainIds] = useState(new Set());
  const [busy, setBusy] = useState('read');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const campaignIdRef = useRef(null);
  const mounted = useRef(true);
  const requestBusy = useRef(false);
  const quotaHold = quotaMessage(allowance, forecast);
  const selectedIds = selectionFromLoadedRows(cases, selected, category, user?.id).filter((id) => !uncertainIds.has(id));
  const categoryApproved = review?.approved && (category === 'all' || review.category === category);
  const canPrepare = !busy && !categoryApproved && selectedIds.length === selected.size && selectedIds.length > 0;
  const loadedMatches = useMemo(() => cases.filter((row) => `${row.title || ''} ${row.documentNumber || ''} ${row.accountName || ''} ${row.caseKey || ''} ${row.reason || ''}`.toLowerCase().includes(search.trim().toLowerCase())), [cases, search]);
  const currentCount = Number(page?.total ?? counts?.total);
  useEffect(() => () => { mounted.current = false; generation.current += 1; }, []);

  const captureAllowance = (data) => {
    if (data?.allowance) { setAllowance(data.allowance); onAllowance?.({ dayRemaining: data.allowance.remaining, observedAt: data.allowance.observedAt }); }
    if (data?.forecast) setForecast(data.forecast);
  };
  const invoke = async (name, payload, options = REQUEST_OPTIONS) => {
    const response = await appClient.functions.invoke(name, payload, options);
    if (response?.data?.error || response?.error) throw new Error(campaignError(response, `${name} failed.`));
    return response.data;
  };
  const load = useCallback(async ({ id = campaignIdRef.current, nextCursor = null, append = false } = {}) => {
    if (requestBusy.current) return;
    requestBusy.current = true;
    const current = ++generation.current;
    setBusy('read'); setError('');
    try {
      const payload = { limit: PAGE_SIZE, ...(id ? { campaignId: id } : {}), ...(nextCursor ? { cursor: nextCursor } : {}), ...(status !== 'all' ? { status } : {}), ...(category !== 'all' ? { category } : {}) };
      const data = await invoke('xeroReconciliationCampaignRead', payload);
      if (!mounted.current || current !== generation.current) return;
      setCampaign(data.campaign || null); campaignIdRef.current = data.campaign?.id || null; setCounts(data.counts || null);
      setCases((previous) => append ? [...previous, ...(data.cases || []).filter((row) => !previous.some((existing) => existing.id === row.id))] : data.cases || []);
      setPage(data.page || null); captureAllowance(data);
      if (Array.isArray(data.pendingBatches)) setReview((previous) => {
        const pending = category === 'all' ? data.pendingBatches.find((batch) => batch.id === previous?.batch?.id) || data.pendingBatches[0] : data.pendingBatches.find((batch) => batch.category === category);
        if (pending) return savedApprovedReview(pending, previous);
        if (previous?.category !== category && category !== 'all') return null;
        return previous?.approved ? { ...previous, approved: false, invalidated: true } : previous;
      });
      if (!append) { setSelected(new Set()); setExpanded(new Set()); }
    } catch (failure) { if (mounted.current && current === generation.current) setError(failure.message || 'Campaign could not be loaded.'); }
    finally { requestBusy.current = false; if (mounted.current && current === generation.current) setBusy(''); }
  }, [category, status]);
  useEffect(() => { load(); }, [load]);
  const refreshEvidence = async () => {
    if (!campaign?.id || busy || !connected) return;
    setBusy('refresh'); setError('');
    try {
      const data = await invoke('xeroReconciliationCampaignRefresh', { campaignId: campaign.id, expectedRevision: campaign.revision }, MUTATION_OPTIONS);
      if (!mounted.current) return;
      setCampaign(data.campaign); setCounts(data.counts); setCases(data.cases || []); setPage(data.page); captureAllowance(data);
      setCategory('all'); setStatus('all'); setSelected(new Set()); setReview(null); setReviewOpen(false); setReviewed(false);
      setNotice('Current evidence refreshed. New activity is separate from the fixed baseline; changed approvals require a new review.');
    } catch (failure) { if (mounted.current) setError(failure.message || 'Current evidence could not be refreshed.'); }
    finally { if (mounted.current) setBusy(''); }
  };
  const updateFilters = (nextCategory, nextStatus) => {
    if (busy) return;
    setSelected(new Set()); setSearch(''); setCategory(nextCategory); setStatus(nextStatus);
  };
  const create = async () => {
    if (!baselineRun?.id || !Number.isInteger(Number(baselineRun?.revision)) || baselineRun.status !== 'ready_for_review' || busy) return;
    setBusy('create'); setError('');
    try {
      const data = await invoke('xeroReconciliationCampaignCreate', { runId: baselineRun.id, expectedRunRevision: Number(baselineRun.revision) }, MUTATION_OPTIONS);
      if (!mounted.current) return;
      captureAllowance(data); setNotice('Saved reconciliation campaign created. No Xero records changed.');
      setCategory('all'); setStatus('needs_decision'); campaignIdRef.current = data.campaign?.id || data.campaignId || null;
      await load({ id: campaignIdRef.current });
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(''); }
  };
  const checkConnection = async () => {
    if (busy) return;
    setBusy('connection'); setError('');
    try {
      const data = await invoke('xeroReconciliationConnectionCheck', {}, REQUEST_OPTIONS);
      if (!mounted.current) return;
      captureAllowance(data); setConnection(data.connection || null); setNotice(data.connection?.connected ? 'Xero connection verified. Financial actions still require review.' : data.connection?.reason || 'Xero connection needs attention.');
      await load();
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(''); }
  };
  const previewBatch = async () => {
    if (!canPrepare || !REVIEW_CATEGORIES.has(category) || requestBusy.current) return;
    requestBusy.current = true; const current = ++generation.current;
    setBusy('preview'); setError(''); setOutcomes(null); setReview(null); setReviewed(false);
    try {
      const data = await invoke('xeroReconciliationCampaignPreview', { campaignId: campaign.id, category, caseIds: selectedIds, expectedRevision: campaign.revision }, MUTATION_OPTIONS);
      if (!mounted.current || current !== generation.current) return;
      captureAllowance(data);
      if (!data.batch?.id || !data.evidenceFingerprint || !Number.isInteger(Number(data.batch.revision))) throw new Error('Exact batch evidence is incomplete. Nothing was approved.');
      setReview({ ...data, category, approvalForecast: data.approvalForecast || data.forecast, revision: Number(data.batch.revision), approved: false, caseIds: [...selectedIds] }); setReviewOpen(true);
    } catch (failure) { if (mounted.current && current === generation.current) setError(failure.message); }
    finally { requestBusy.current = false; if (mounted.current && current === generation.current) setBusy(''); }
  };
  const approve = async () => {
    if (!review || !reviewed || review.approved || !enabled || busy) return;
    setBusy('approve'); setError('');
    try {
      const data = await invoke('xeroReconciliationCampaignApprove', { campaignId: campaign.id, batchId: review.batch.id, expectedRevision: review.revision, expectedFingerprint: review.evidenceFingerprint, reviewed: true }, MUTATION_OPTIONS);
      if (!mounted.current) return;
      captureAllowance(data);
      if (!Number.isInteger(Number(data.batch?.revision))) throw new Error('Approval outcome could not be verified. Read the campaign before attempting anything else.');
      setReview((previous) => ({ ...previous, revision: Number(data.batch.revision), approved: true, nextRunForecast: data.nextRunForecast || previous.nextRunForecast, batch: { ...previous.batch, ...data.batch } }));
      setNotice('Exact batch approved. No Xero update has run yet.');
    } catch (failure) { if (mounted.current) { setError(failure.message); setReview(null); setReviewed(false); } }
    finally { if (mounted.current) setBusy(''); }
  };
  const run = async () => {
    if (!review?.approved || !enabled || !connected || busy || approvedRunQuotaMessage(allowance, review, forecast)) return;
    setBusy('run'); setError('');
    const ids = [...review.caseIds];
    try {
      const data = await invoke('xeroReconciliationCampaignRun', { campaignId: campaign.id, batchId: review.batch.id, expectedRevision: review.revision, expectedFingerprint: review.evidenceFingerprint }, MUTATION_OPTIONS);
      if (!mounted.current) return;
      captureAllowance(data); setOutcomes(data.outcomes || []);
      const nextReview = reviewAfterRun(review, data);
      setReview(nextReview); setReviewOpen(Boolean(nextReview)); setSelected(new Set());
      if (!nextReview) { setReviewed(false); setUncertainIds(new Set()); }
      else if (!nextReview.recoveryPending) setUncertainIds((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
      setNotice(`${(data.outcomes || []).length} case outcomes recorded. ${nextReview?.recoveryPending ? 'The claimed batch still needs readback recovery.' : nextReview?.approved ? 'The exact approval remains valid for unchanged cases. Choose Run for the next bounded part.' : 'Review each outcome; queued or uncertain cases remain open.'}`);
      await load();
    } catch (failure) { if (mounted.current) { setError(`${failure.message} The result may be uncertain. The pending approval is preserved. Choose Recover claimed batch to read back the existing claim; no automatic retry will occur.`); setUncertainIds((previous) => new Set([...previous, ...ids])); setReview((previous) => ({ ...previous, recoveryPending: true })); setReviewOpen(true); } }
    finally { if (mounted.current) setBusy(''); }
  };
  const toggle = (id) => setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else if (next.size < CAMPAIGN_APPROVAL_LIMIT) next.add(id); return next; });
  const canStart = Boolean(baselineRun?.id && Number.isInteger(Number(baselineRun?.revision)) && baselineRun.status === 'ready_for_review');
  return <section className="rounded-xl border border-sky-200 bg-card p-4" aria-label="2026 reconciliation campaign">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-sky-700" /><h2 className="text-base font-semibold">2026 reconciliation campaign</h2></div><p className="mt-1 text-xs text-muted-foreground">Fixed 1 January 2026 delivery baseline · Link existing Xero records first · Current operator’s decision queue</p></div><Button size="sm" variant="ghost" aria-label="Close reconciliation campaign" onClick={onClose}><X className="h-4 w-4" /></Button></div>
    {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mt-3 rounded-md bg-emerald-50 p-2 text-xs text-emerald-800">{notice}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => load()} disabled={Boolean(busy)}><RefreshCw className="mr-2 h-4 w-4" />Refresh saved cases</Button>{campaign && <Button size="sm" variant="outline" onClick={refreshEvidence} disabled={Boolean(busy) || !connected}>{busy === 'refresh' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Refresh current evidence</Button>}<Button size="sm" variant="outline" onClick={checkConnection} disabled={Boolean(busy)}>{busy === 'connection' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Check Xero connection and allowance</Button>{!campaign && <Button size="sm" disabled={!canStart || Boolean(busy)} onClick={create}>Start from saved check</Button>}{!campaign && !canStart && <span className="text-xs text-amber-800">A complete saved financial check is required.</span>}</div>
    <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5"><SummaryCount label="All cases" value={counts?.total} /><SummaryCount label="Ready" value={counts?.ready} /><SummaryCount label="Your decisions" value={counts?.needsDecision} /><SummaryCount label="Waiting for evidence" value={counts?.waitingDependency} /><SummaryCount label="Reconciled" value={counts?.reconciled} /></div>
    <div className="mt-3 grid gap-3 rounded-lg border border-border bg-muted/15 p-3 lg:grid-cols-2"><div className="text-xs"><div className="font-semibold">Saved baseline</div><div className="mt-1">{campaign ? `${campaign.runId || 'Run unavailable'} · ${timestamp(campaign.baselineAt || campaign.createdAt)}` : 'No saved campaign yet.'}</div><div>Owner: {campaign?.ownerName || user?.email || 'Current operator'}</div></div><div className="text-xs"><div className="font-semibold">Xero allowance and reserve</div><div className="mt-1">{allowance?.remaining == null ? 'Unverified remaining allowance' : `${number(allowance.remaining)} remaining · ${number(allowance.reserve ?? 200)} reserved`}{allowance?.observedAt ? ` · observed ${timestamp(allowance.observedAt)}` : ''}</div><div>{forecast?.callsNeeded == null ? 'No verified call forecast' : `Forecast: ${number(forecast.callsNeeded)} calls (read ${number(forecast.readCalls)}, write ${number(forecast.writeCalls)}, verify ${number(forecast.verificationCalls)}, recovery ${number(forecast.recoveryCalls)}, other ${number(forecast.otherActivityCalls)})`}</div>{allowance?.retryAt && <div>Retry after {timestamp(allowance.retryAt)}</div>}{quotaHold && <div className="mt-1 font-medium text-amber-800">{quotaHold}</div>}{connection?.needsReconnect && <div className="mt-1 text-amber-800">{connection.reason || 'Reconnect Xero using the verified FCOS connection.'}</div>}</div></div>
    {campaign && <><div className="mt-3 flex flex-wrap gap-2"><label className="text-xs">Category<select aria-label="Campaign category" className="ml-2 h-8 rounded-md border border-input bg-background px-2" value={category} onChange={(event) => { const next = event.target.value; updateFilters(next, REVIEW_CATEGORIES.has(next) ? 'ready' : next === 'decision' ? 'needs_decision' : next === 'all' ? status : 'all'); }}>{CAMPAIGN_CATEGORIES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}{choice.id !== 'all' && counts?.byCategory?.[choice.id] != null ? ` (${counts.byCategory[choice.id]})` : ''}</option>)}</select></label><label className="text-xs">Status<select aria-label="Campaign status" className="ml-2 h-8 rounded-md border border-input bg-background px-2" value={status} onChange={(event) => updateFilters(category, event.target.value)}>{CAMPAIGN_STATUSES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><Input className="h-8 min-w-[180px] max-w-sm flex-1" aria-label="Search loaded campaign cases" placeholder="Search loaded cases only…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{cases.length} loaded{Number.isFinite(currentCount) ? ` of ${number(currentCount)}` : ''} · Search and selection cover loaded rows only.</span><span>Approve up to {number(CAMPAIGN_APPROVAL_LIMIT)} loaded cases in one category · First run: 5; later runs: up to 25.</span></div>
      {busy === 'read' && !cases.length ? <p role="status" className="mt-3 text-sm">Loading saved campaign cases…</p> : <div className="mt-2 max-h-[min(56vh,560px)] overflow-y-auto rounded-lg border border-border"><table className="w-full table-fixed text-left text-xs"><thead className="sticky top-0 bg-muted"><tr><th className="w-9 p-2"><span className="sr-only">Select</span></th><th className="w-[20%] p-2">Case / source</th><th className="w-[18%] p-2">Category / status</th><th className="w-[24%] p-2">Contact / amount</th><th className="p-2">Reason / owner</th><th className="w-9 p-2"><span className="sr-only">Evidence</span></th></tr></thead><tbody>{loadedMatches.map((row) => { const selectable = selectableCampaignCase(row, category, user?.id) && !uncertainIds.has(row.id); const open = expanded.has(row.id); return <Fragment key={row.id}><tr className="border-t align-top"><td className="p-2"><Checkbox aria-label={`Select ${row.title || row.caseKey || row.id}`} checked={selected.has(row.id)} disabled={!selectable || Boolean(busy) || (selected.size >= CAMPAIGN_APPROVAL_LIMIT && !selected.has(row.id)) || Boolean(categoryApproved)} onCheckedChange={() => toggle(row.id)} /></td><td className="break-words p-2"><span className="font-medium">{row.title || row.caseKey || row.id}</span><span className="block text-muted-foreground">{row.documentNumber || row.sourceId || 'Source unavailable'}</span></td><td className="p-2"><Badge variant="outline" className="whitespace-normal">{labelFor(row.category, CAMPAIGN_CATEGORIES)}</Badge><span className="mt-1 block">{labelFor(row.status, CAMPAIGN_STATUSES)}</span></td><td className="break-words p-2">{row.accountName || 'Contact unresolved'}<span className="block tabular-nums text-muted-foreground">{amountFor(row.total, row.currency)}</span></td><td className="break-words p-2">{row.reason || row.reasons?.[0] || (row.status === 'ready' ? 'Evidence ready for exact review.' : 'Needs source evidence.')}<span className="mt-1 block text-muted-foreground">Owner: {row.ownerName || 'Unassigned'}</span>{row.category === 'decision' && <span className="mt-1 block text-amber-800">Operator decision required. No automatic approval.</span>}</td><td className="p-2"><Button size="icon" variant="ghost" aria-label={`Show evidence for ${row.title || row.caseKey || row.id}`} onClick={() => setExpanded((previous) => { const next = new Set(previous); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })}>{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>{open && <div className="sr-only">Expanded</div>}</td></tr>{open && <tr><td colSpan={6} className="border-t border-border bg-muted/20 p-3"><div className="grid gap-2 lg:grid-cols-3"><div>Salesforce source: {row.sourceId || 'Unavailable'}<br />Xero target: {row.targetId || 'No verified target'}</div><div>Dependencies: {(row.dependencies || []).join('; ') || 'None recorded'}<br />Evidence fingerprint: {row.evidenceFingerprint || 'Missing'}</div><div>{(row.reasons || []).map((reason, index) => <div key={index}>{reason}</div>)}</div></div></td></tr>}</Fragment>; })}</tbody></table>{!loadedMatches.length && <p className="p-4 text-sm text-muted-foreground">{search ? 'No matching loaded cases. Load further pages or clear the search.' : 'No cases in this category and status.'}</p>}</div>}
      {page?.hasMore && <div className="mt-2 flex justify-center"><Button size="sm" variant="outline" disabled={Boolean(busy) || !page?.nextCursor} onClick={() => load({ nextCursor: page.nextCursor, append: true })}>Load next page</Button></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><p className="text-xs text-muted-foreground">{selected.size} selected · {category === 'all' ? 'Choose one review category to select.' : REVIEW_CATEGORIES.has(category) ? 'Only owned, ready cases with evidence are selectable.' : 'This category requires a separate source decision.'}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={Boolean(busy) || Boolean(categoryApproved) || !REVIEW_CATEGORIES.has(category)} onClick={() => setSelected(new Set(cases.filter((row) => selectableCampaignCase(row, category, user?.id) && !uncertainIds.has(row.id)).slice(0, CAMPAIGN_APPROVAL_LIMIT).map((row) => row.id)))}>Select loaded ready</Button>{categoryApproved && <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>Open approved batch</Button>}<Button size="sm" disabled={!canPrepare || !REVIEW_CATEGORIES.has(category)} onClick={previewBatch}>{busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Preview exact batch</Button></div></div>
    </>}
    {review?.invalidated && !reviewOpen && <p role="alert" className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">The saved batch no longer has a current approval. Refresh current evidence and review the changed cases before another run.</p>}
    {uncertainIds.size > 0 && <p role="alert" className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">{uncertainIds.size} approved case outcomes may be uncertain. Keep the pending batch for explicit readback recovery; saved-case refresh alone does not verify execution.</p>}
    {outcomes && <section className="mt-3 rounded-lg border border-border p-3"><h3 className="text-sm font-semibold">Verified batch outcomes</h3>{outcomes.length ? outcomes.map((row, index) => <p key={row.caseId || row.id || index} className="border-t border-border py-1 text-xs">{row.caseTitle || row.caseId || row.id || `Case ${index + 1}`} · <strong>{row.status || row.outcome || 'Unknown outcome'}</strong>{row.reason && ` · ${row.reason}`}</p>) : <p className="text-xs text-amber-800">The request returned no case outcomes. Read back the campaign before further action.</p>}</section>}
    <Dialog open={Boolean(review) && reviewOpen} onOpenChange={(open) => { if (!open && busy !== 'approve' && busy !== 'run') { setReviewOpen(false); if (!review?.approved) { setReview(null); setReviewed(false); } } }}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{review?.approved ? 'Approved batch · Ready for controlled run' : 'Review exact batch before approval'}</DialogTitle><DialogDescription>{labelFor(review?.category || category, CAMPAIGN_CATEGORIES)} · {review?.caseIds.length || 0} cases · {review?.recoveryPending ? 'The claimed run needs readback before further action.' : review?.approved ? Number(review.batch?.verified_count || 0) > 0 ? 'Further runs require your separate action.' : 'No automatic posting has started.' : 'Compare each proposed change with its preserved evidence.'}</DialogDescription></DialogHeader><div className="space-y-2 text-xs"><p>Evidence fingerprint: <span className="break-all font-mono">{review?.evidenceFingerprint}</span></p><p>Full approval forecast: {number(review?.approvalForecast?.callsNeeded ?? review?.forecast?.callsNeeded)} calls across {number(review?.caseIds.length)} approved cases.</p><p>Next run forecast: {number(review?.nextRunForecast?.callsNeeded)} calls · at most {nextRunLimit(review, campaign)} records. Each run verifies allowance and protects the 200-call reserve.</p>{review?.recoveryPending && <p role="alert" className="rounded-md bg-amber-50 p-2 text-amber-900">Outcome uncertain. Recover claimed batch reads back the existing claimed batch before any further action. No automatic retry occurs.</p>}{review?.invalidated && <p role="alert" className="text-red-700">The approval changed. Close this review and refresh current evidence before preparing a new approval.</p>}{review?.caseIds.map((id) => { const row = cases.find((item) => item.id === id); return <p key={id} className="rounded-md border border-border p-2">{row?.title || row?.documentNumber || id} · {row?.accountName || 'Contact unresolved'} · {row?.sourceId || 'Source unavailable'} → {row?.targetId || 'New target'}</p>; })}{review?.diffs?.length ? review.diffs.map((row, index) => <FieldDiff key={row.caseId || index} row={row} />) : <p className="rounded-md bg-muted/30 p-2">{(review?.category || category) === 'link_only' ? 'Link existing verified records; existing Xero document fields remain unchanged.' : 'No field differences were supplied. Exact evidence must be available before approval.'}</p>}{!review?.approved && (review?.category || category) !== 'link_only' && !review?.diffs?.length && <p role="alert" className="text-red-700">Approval held: no reviewable changes were returned.</p>}{review?.approved && <p className="rounded-md bg-amber-50 p-2 text-amber-900">Approved for this exact fingerprint only. Run is a separate action and processes at most {nextRunLimit(review, campaign)} records. Verified cases: {number(review?.batch?.verified_count ?? review?.batch?.verifiedCount ?? 0)}.</p>}</div>{!review?.approved && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I reviewed each case, the proposed differences, and the preserved source and target evidence.</label>}<DialogFooter>{review?.approved && approvedRunQuotaMessage(allowance, review, forecast) && <Button variant="outline" disabled={Boolean(busy)} onClick={checkConnection}>Check connection before run</Button>}<Button variant="outline" disabled={busy === 'approve' || busy === 'run'} onClick={() => { setReviewOpen(false); if (!review?.approved) { setReview(null); setReviewed(false); } }}>Close</Button>{review?.approved ? <Button disabled={!enabled || !connected || Boolean(busy) || Boolean(approvedRunQuotaMessage(allowance, review, forecast))} onClick={run}>{review?.recoveryPending ? 'Recover claimed batch' : 'Run approved batch'}</Button> : <Button disabled={review?.invalidated || !enabled || !reviewed || Boolean(busy) || ((review?.category || category) !== 'link_only' && !review?.diffs?.length)} onClick={approve}>{busy === 'approve' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve reviewed batch</Button>}</DialogFooter></DialogContent></Dialog>
  </section>;
}
