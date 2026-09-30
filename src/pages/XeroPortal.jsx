import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  Loader2,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import StateBlock from '@/components/common/StateBlock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { appClient } from '@/api/appClient';
import { emptyReceiptFields, parseReceiptText } from '@/lib/receiptExtraction';
import { saveReceiptWithDirectUpload } from '@/lib/xeroReceiptUpload';
import { xeroPortalUiCopy } from '@/lib/xeroPortalUiCopy';
import { cn } from '@/lib/utils';
import './XeroPortal.css';
import { canRestoreContactRow, confirmedContactRestore } from '@/lib/xeroContactRestoreResult';
import { xeroContactRestoreCopy } from '@/lib/xeroContactRestoreCopy';

const PORTAL_ACTIONS_CLASS = 'xp-actions';
const PORTAL_DESCRIPTION_CLASS = 'xp-description';
const PORTAL_SPINNER_CLASS = 'mr-2 h-4 w-4 animate-spin';
const PORTAL_CARD_CLASS = 'xp-card border bg-card border-border';
const PORTAL_SECTION_HEADER_CLASS = 'xp-section-header';
const PORTAL_REVIEW_LABEL_CLASS = 'xp-review-label';
const PORTAL_EMPHASIS_CLASS = 'font-semibold text-foreground';
const PORTAL_MUTED_CLASS = 'text-sm text-muted-foreground';
const PORTAL_LABEL_CLASS = 'flex items-center gap-2 text-sm';
const PORTAL_OUTCOME_CLASS = 'xp-outcome';
const PORTAL_FIELD_LABEL_CLASS = 'text-xs font-semibold text-muted-foreground';
const PORTAL_TWO_COLUMNS_CLASS = 'grid gap-2 sm:grid-cols-2';
const PORTAL_DETAIL_CLASS = 'mt-1 text-xs text-muted-foreground';
const PORTAL_CACHE_GRID_CLASS = 'xp-cache-grid';
const ACTION_FILTERS = ['archive', 'rename', 'exception', 'keep'];
const STATUS_FILTERS = ['eligible', 'blocked', 'kept', 'not-selected', 'updated', 'archived', 'failed'];

const RECEIPT_CURRENCIES = ['HKD', 'USD', 'SGD', 'CNY', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'JPY'];
const XeroFinancialSync = lazy(() => import('@/components/xero/XeroFinancialSync'));
const XeroPortalManual = lazy(() => import('@/components/xero/XeroPortalManual'));
const XeroContactResolution = lazy(() => import('@/components/xero/XeroContactResolution'));

export default function XeroPortal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('accounting');
  const [status, setStatus] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [run, setRun] = useState(null);
  const [autoRun, setAutoRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ action: 'all', status: 'all', reason: 'all', search: '', unmatchedOnly: false });
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [repairSelected, setRepairSelected] = useState(new Set());
  const [repairReviewed, setRepairReviewed] = useState(false);
  const [restoreSelected, setRestoreSelected] = useState(new Set());
  const [restoreReviewed, setRestoreReviewed] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [restoreVerificationRequired, setRestoreVerificationRequired] = useState(false);
  const restoreInFlight = useRef(false);
  const [identityRow, setIdentityRow] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [forceUsageRefresh, setForceUsageRefresh] = useState(false);
  const [incrementalUsageRefresh, setIncrementalUsageRefresh] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState(emptyReceiptFields);
  const [receiptFile, setReceiptFile] = useState(null);
  const receiptUpload = useRef(null);
  const receiptSaveInFlight = useRef(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const copy = xeroPortalUiCopy();
  const restoreCopy = xeroContactRestoreCopy('en');

  const load = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError('');
    const [statusResult, receiptsResult, lifecycleResult, autoResult] = await Promise.all([
      appClient.functions.invoke('xeroPortalStatus', { forceRefresh: force }, { force, cache: !force, cacheTtlMs: 15000 }),
      appClient.functions.invoke('xeroPortalReceiptsList', { limit: 50 }, { force, cache: !force, cacheTtlMs: 15000 }),
      appClient.functions.invoke('xeroPortalContactLifecycleLatest', {}, { force, cache: !force, cacheTtlMs: 15000 }),
      appClient.functions.invoke('xeroPortalContactAutoCreateLatest', {}, { force, cache: !force, cacheTtlMs: 15000 }),
    ]);
    const firstError = [statusResult, receiptsResult, lifecycleResult, autoResult].find((result) => result.data?.error);
    if (firstError) {
      setError(firstError.data.error);
    } else {
      setStatus(statusResult.data);
      setReceipts(receiptsResult.data.receipts || []);
      setRun(lifecycleResult.data.run || null);
      setAutoRun(autoResult.data.run || null);
      setSelectedRows(new Set((lifecycleResult.data.run?.rows || []).filter(canApplyRow).map((row) => row.id)));
      setRepairSelected(new Set());
      setRepairReviewed(false);
      setRestoreSelected(new Set());
      setRestoreReviewed(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const xero = searchParams.get('xero');
    const message = searchParams.get('message');
    const callbackCopy = xeroPortalUiCopy();
    if (xero === 'connected') toast({ title: callbackCopy.toasts.connected, description: callbackCopy.toasts.connectedDescription });
    if (xero === 'error') toast({ title: callbackCopy.toasts.connectionFailed, description: message || callbackCopy.toasts.connectionFailedDescription, variant: 'destructive' });
    if (xero) {
      const next = new URLSearchParams(searchParams);
      next.delete('xero');
      next.delete('message');
      setSearchParams(next, { replace: true });
    }
    load({ force: xero === 'connected' });
  }, [load, searchParams, setSearchParams]);

  const summary = run?.summary || {};
  const hasLifecycleRun = Boolean(run?.id);
  const xero = status?.xero || {};
  const scopeFlags = xero.scopeFlags || {};
  const needsFinancialReconnect = xero.connected && (!scopeFlags.paymentsWrite || !scopeFlags.settingsRead);
  const actionGate = status?.externalActions?.xero_contact_sync;
  const restoreWritesAllowed = actionGate?.enabled === true;
  const reasonLabels = status?.reasonLabels || {};
  const statusLabels = status?.statusLabels || {};
  const matchFieldLabels = status?.matchFieldLabels || {};

  const reasonOptions = useMemo(() => {
    const reasons = new Set((run?.rows || []).map((row) => row.reason).filter(Boolean));
    return [['all', copy.contacts.allReasons], ...[...reasons].sort().map((reason) => [reason, copy.reasons[reason] || reasonLabels[reason] || reason])];
  }, [copy, reasonLabels, run]);

  const actionOptions = useMemo(() => [
    ['all', copy.contacts.allActions],
    ...ACTION_FILTERS.map((action) => [action, copy.actions[action] || action]),
  ], [copy]);
  const statusOptions = useMemo(() => [
    ['all', copy.contacts.allStatuses],
    ...STATUS_FILTERS.map((statusValue) => [statusValue, copy.statuses[statusValue] || statusValue]),
  ], [copy]);

  const filteredRows = useMemo(() => {
    const q = filters.search.trim().toUpperCase();
    return (run?.rows || []).filter((row) => {
      if (filters.action !== 'all' && row.action !== filters.action) return false;
      if (filters.status !== 'all' && row.status !== filters.status) return false;
      if (filters.reason !== 'all' && row.reason !== filters.reason) return false;
      if (filters.unmatchedOnly && !(row.xeroContactId && !row.salesforceAccountId && String(row.xeroContactStatus || '').toUpperCase() !== 'ARCHIVED')) return false;
      if (!q) return true;
      return [
        row.xeroContactName,
        row.xeroContactNumber,
        row.xeroAccountNumber,
        row.salesforceName,
        row.salesforceCompanyCode,
        row.salesforceAccountId,
        row.reason,
      ].some((value) => String(value || '').toUpperCase().includes(q));
    });
  }, [filters, run]);

  const selectedEligibleCount = filteredRows.filter((row) => canApplyRow(row) && selectedRows.has(row.id)).length;
  const repairCount = (run?.rows || []).filter((row) => canRepairRow(row) && repairSelected.has(row.id)).length;
  const restoreRows = (run?.rows || []).filter((row) => canRestoreContactRow(row) && restoreSelected.has(row.id));
  const restoreCount = restoreRows.length;
  const totalSelectedCount = [...selectedRows].length;
  const visibleContactRows = filteredRows.slice(0, 1000);

  async function connectXero() {
    setBusy('connect');
    const result = await appClient.functions.invoke('xeroPortalConnectStart', { returnPath: '/xero-portal' }, { force: true, invalidateCache: true });
    setBusy('');
    if (result.data?.error) {
      toast({ title: copy.toasts.connectionUnavailable, description: result.data.error, variant: 'destructive' });
      return;
    }
    window.location.href = result.data.authorizationUrl;
  }

  async function disconnectXero() {
    setBusy('disconnect');
    const result = await appClient.functions.invoke('xeroPortalDisconnect', {}, { force: true, invalidateCache: true });
    setBusy('');
    if (result.data?.error) toast({ title: copy.toasts.disconnectFailed, description: result.data.error, variant: 'destructive' });
    else {
      toast({ title: copy.toasts.disconnected });
      await load({ force: true });
    }
  }

  async function previewLifecycle({ clearSelection = false, preserveRestoreResult = false } = {}) {
    setBusy('preview');
    setRestoreSelected(new Set());
    setRestoreReviewed(false);
    setReviewed(false);
    setRepairReviewed(false);
    setRepairSelected(new Set());
    const result = await appClient.functions.invoke('xeroPortalContactLifecyclePreview', {
      forceUsageRefresh,
      incrementalUsageRefresh,
    }, { force: true, invalidateCache: true });
    setBusy('');
    if (result.data?.error || !result.data?.run?.id || !Array.isArray(result.data.run.rows)) {
      toast({ title: copy.toasts.previewFailed, description: result.data?.error || restoreCopy.refreshFailed, variant: 'destructive' });
      return;
    }
    setRun(result.data.run);
    setRestoreVerificationRequired(false);
    if (!preserveRestoreResult) setRestoreResult(null);
    setSelectedRows(clearSelection ? new Set() : new Set((result.data.run?.rows || []).filter(canApplyRow).map((row) => row.id)));
    await load({ force: true });
    if (clearSelection) setSelectedRows(new Set());
  }

  async function saveIdentityAndRefresh() {
    setIdentityRow(null);
    await previewLifecycle({ clearSelection: true });
  }

  async function applyContactRepair() {
    const rowIds = (run?.rows || []).filter((row) => canRepairRow(row) && repairSelected.has(row.id)).map((row) => row.id);
    if (!run?.id || !repairReviewed || !rowIds.length || rowIds.length > 25) return;
    setBusy('repair');
    let result;
    let confirmedContactRepair;
    try {
      ({ confirmedContactRepair } = await import('@/lib/xeroContactResolutionResult'));
      result = await appClient.functions.invoke('xeroContactRepairApply', { runId: run.id, rowIds, reviewed: true }, { force: true, invalidateCache: true });
    } catch { result = null; }
    setBusy('');
    if (result?.data?.error && result.meta?.cacheLayer !== 'network') {
      toast({ title: copy.contacts.repair.failed, description: result.data.error, variant: 'destructive' }); return;
    }
    if (!confirmedContactRepair?.(result?.data, run.id, rowIds)) {
      setRepairReviewed(false);
      setRepairSelected(new Set());
      toast({ title: copy.contacts.repair.uncertain, description: copy.contacts.repair.uncertainDetail, variant: 'destructive' });
      return;
    }
    const summary = result.data.summary;
    toast({ title: summary.uncertain ? copy.contacts.repair.uncertain : copy.contacts.repair.completed,
      description: copy.contacts.repair.outcome(summary), variant: summary.uncertain || summary.blocked ? 'destructive' : undefined });
    await previewLifecycle({ clearSelection: true });
  }

  async function applyContactRestore() {
    if (restoreInFlight.current || busy || !restoreWritesAllowed || restoreVerificationRequired
      || !run?.id || !restoreReviewed || !restoreCount || restoreCount > 25) return;
    const expectedRunId = run.id;
    const expectedRows = [...restoreRows];
    restoreInFlight.current = true;
    setBusy('restore');
    setRestoreReviewed(false);
    setRestoreSelected(new Set());
    let result;
    try {
      result = await appClient.functions.invoke('xeroContactRestoreApply', {
        runId: expectedRunId, rowIds: expectedRows.map((row) => row.id), reviewed: true,
      }, { force: true, invalidateCache: true });
    } catch { result = null; }
    const confirmed = confirmedContactRestore(result?.data, expectedRunId, expectedRows);
    const uncertain = !confirmed || result.data.summary.uncertain > 0;
    setRestoreVerificationRequired(true);
    setRestoreResult(confirmed ? result.data : { uncertain: true, attemptedRows: expectedRows.map((row) => ({
      rowId: row.id, salesforceAccountId: row.salesforceAccountId, xeroContactId: row.restoration.targetContactId,
    })) });
    if (uncertain) {
      toast({ title: restoreCopy.verify, description: restoreCopy.uncertain, variant: 'destructive' });
    } else {
      toast({ title: restoreCopy.completed, description: restoreCopy.outcome(result.data.summary),
        variant: result.data.summary.blocked ? 'destructive' : undefined });
      try { await previewLifecycle({ clearSelection: true, preserveRestoreResult: true }); }
      catch {
        setRestoreVerificationRequired(true);
        toast({ title: restoreCopy.verify, description: restoreCopy.refreshFailed, variant: 'destructive' });
      }
    }
    setBusy('');
    restoreInFlight.current = false;
  }

  async function applyLifecycle() {
    setBusy('apply');
    const result = await appClient.functions.invoke('xeroPortalContactLifecycleApply', {
      runId: run?.id,
      reviewed,
      rowIds: [...selectedRows],
    }, { force: true, invalidateCache: true });
    setBusy('');
    if (result.data?.error) {
      toast({ title: copy.toasts.applyFailed, description: result.data.error, variant: 'destructive' });
      return;
    }
    setRun(result.data.run);
    setSelectedRows(new Set());
    setReviewed(false);
    toast({ title: copy.toasts.changesApplied, description: summarizeApply(result.data.run?.summary || {}) });
    await load({ force: true });
  }

  async function runOcr() {
    if (!receiptFile) return;
    if (!receiptFile.type.startsWith('image/')) {
      toast({ title: copy.toasts.ocrImagesOnly, description: copy.toasts.ocrImagesOnlyDescription, variant: 'destructive' });
      return;
    }
    setOcrBusy(true);
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      const result = await worker.recognize(receiptFile);
      await worker.terminate();
      const text = result.data?.text || '';
      setReceiptDraft((current) => ({ ...current, ...parseReceiptText(text, receiptFile.name), note: text.trim() || current.note }));
    } catch (ocrError) {
      toast({ title: copy.toasts.ocrFailed, description: ocrError.message || copy.toasts.ocrFailedDescription, variant: 'destructive' });
    } finally {
      setOcrBusy(false);
    }
  }

  async function saveReceipt({ sync = false } = {}) {
    if (receiptSaveInFlight.current) return;
    if (!receiptFile) {
      toast({ title: copy.toasts.fileRequired, description: copy.toasts.fileRequiredDescription, variant: 'destructive' });
      return;
    }
    receiptSaveInFlight.current = true;
    setBusy(sync ? 'receipt-sync-create' : 'receipt-create');
    try {
      const result = await saveReceiptWithDirectUpload({
        file: receiptFile, fields: receiptDraft, autoSync: sync, pending: receiptUpload,
      }, { invoke: (...args) => appClient.functions.invoke(...args) });
      if (!result.data?.receipt) throw new Error(result.data?.error || 'Receipt save could not be confirmed. Retry with the same details.');
      setReceiptDraft(emptyReceiptFields());
      setReceiptFile(null);
      const synced = result.data.receipt.status === 'synced';
      toast({
        title: sync && synced ? copy.toasts.receiptSent : copy.toasts.receiptSaved,
        description: result.data.error || (sync && !synced
          ? 'Receipt saved. Check its status below and use Sync to Xero when ready.'
          : sync ? copy.toasts.receiptSentDescription : copy.toasts.receiptSavedDescription),
        ...(result.data.error ? { variant: 'destructive' } : {}),
      });
      await load({ force: true });
    } catch (failure) {
      toast({ title: sync ? copy.toasts.receiptSyncFailed : copy.toasts.receiptSaveFailed, description: failure.message, variant: 'destructive' });
    } finally {
      receiptSaveInFlight.current = false;
      setBusy('');
    }
  }

  async function syncReceipt(id) {
    setBusy(`receipt-sync-${id}`);
    const result = await appClient.functions.invoke('xeroPortalReceiptSync', { id }, { force: true, invalidateCache: true });
    setBusy('');
    if (result.data?.error) toast({ title: copy.toasts.receiptSyncFailed, description: result.data.error, variant: 'destructive' });
    else toast({ title: copy.toasts.receiptSent, description: copy.toasts.receiptSentDescription });
    await load({ force: true });
  }

  function toggleRow(rowId, checked) {
    setReviewed(false);
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function toggleRepair(rowId, checked) {
    setRepairReviewed(false);
    setRepairSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function toggleRestore(rowId, checked) {
    if (busy || restoreVerificationRequired || !restoreWritesAllowed) return;
    setRestoreReviewed(false);
    setRestoreSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function contactRowSelection(row) {
    const restoration = canRestoreContactRow(row);
    const repair = !restoration && canRepairRow(row);
    return <Checkbox aria-label={`${restoration ? restoreCopy.select : copy.common.use} ${row.xeroContactName || row.salesforceName || row.id}`}
      checked={restoration ? restoreSelected.has(row.id) : repair ? repairSelected.has(row.id) : selectedRows.has(row.id)}
      onCheckedChange={(checked) => restoration ? toggleRestore(row.id, checked === true) : repair ? toggleRepair(row.id, checked === true) : toggleRow(row.id, checked === true)}
      disabled={Boolean(busy) || (restoration ? !restoreWritesAllowed || restoreVerificationRequired : !canApplyRow(row) && !repair)} />;
  }

  function contactIdentityAction(row) {
    if (canRestoreContactRow(row)) return <p className="xp-restore-target">{restoreCopy.title}: {row.restoration.targetContactId}</p>;
    return canReviewContactIdentity(row) ? <Button type="button" size="sm" variant="link" className="h-auto min-h-8 p-0" disabled={Boolean(busy)} onClick={() => setIdentityRow(row)}>{copy.contacts.identity.review}</Button> : null;
  }

  function selectVisibleEligible() {
    setSelectedRows(new Set(filteredRows.filter(canApplyRow).map((row) => row.id)));
  }

  function receiptField(key, labelKey = key, type = 'text') {
    return <Field key={key} label={copy.receipts[labelKey]} type={type} value={receiptDraft[key]} onChange={(value) => setReceiptDraft((current) => ({ ...current, [key]: value }))} />;
  }

  // Share one presentation between desktop and mobile; selection and evidence stay identical.
  const contactPresentations = visibleContactRows.map((row) => ({
    row, selection: contactRowSelection(row),
    action: <ActionBadge action={row.action} copy={copy} wrap />,
    status: <StatusBadgeText status={row.status} copy={copy} wrap />,
    details: [
      [copy.contacts.xeroContact, <XeroContactIdentity row={row} copy={copy} />],
      [copy.contacts.salesforceSource, <SalesforceContactIdentity row={row} copy={copy} />],
      [copy.contacts.match, row.matchField ? (copy.matchFields[row.matchField] || matchFieldLabels[row.matchField] || row.matchField) : copy.common.none],
      [copy.contacts.usage, <ContactUsage usage={row.usage} copy={copy} />],
    ],
    reason: <><ContactReason row={row} copy={copy} reasonLabels={reasonLabels} />{contactIdentityAction(row)}</>,
  }));

  if (loading && !status) {
    return <div className="workspace-tools p-4 lg:p-6" lang="en"><StateBlock icon={Loader2} title={copy.header.loadingTitle} description={copy.header.loadingDescription} /></div>;
  }

  return (
    <div className={cn('workspace-tools min-h-full bg-background p-4 text-foreground lg:p-6', (tab === 'accounting' || tab === 'contacts') && 'workspace-page-wide')} lang="en">
      <div className={cn('mx-auto flex w-full min-w-0 flex-col gap-4', tab !== 'accounting' && tab !== 'contacts' && 'max-w-[1800px]')}>
        <header className="xp-header">
          <div>
            <div className={PORTAL_ACTIONS_CLASS}>
              <h1 className="text-2xl font-semibold tracking-normal">{copy.header.title}</h1>
              <StatusBadge ok={xero.connected} trueLabel={copy.header.connected} falseLabel={copy.header.disconnected} />
              <StatusBadge ok={status?.externalActions?.xero_financial_sync?.enabled} trueLabel="Financial sync enabled" falseLabel="Financial sync disabled" tone={status?.externalActions?.xero_financial_sync?.enabled ? 'emerald' : 'amber'} />
            </div>
            <p className={PORTAL_DESCRIPTION_CLASS}>{copy.header.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setTab('manual')}>
              <BookOpen className="mr-2 h-4 w-4" />
              {copy.header.manual}
            </Button>
            <Button type="button" variant="outline" onClick={() => load({ force: true })} disabled={Boolean(busy)}>
              <ActionIcon busy={loading} icon={RefreshCw} />
              {copy.header.refresh}
            </Button>
            {xero.connected ? (
              <>
                {needsFinancialReconnect ? (
                  <Button type="button" onClick={connectXero} disabled={busy === 'connect'}>
                    <ActionIcon busy={busy === 'connect'} icon={PlugZap} />
                    {copy.header.reconnect}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={disconnectXero} disabled={busy === 'disconnect'}>
                  <ActionIcon busy={busy === 'disconnect'} icon={XCircle} />
                  {copy.header.disconnect}
                </Button>
              </>
            ) : (
              <Button type="button" onClick={connectXero} disabled={busy === 'connect' || !xero.configured}>
                <ActionIcon busy={busy === 'connect'} icon={PlugZap} />
                {copy.header.connect}
              </Button>
            )}
          </div>
        </header>

        {error ? <div role="alert" className="xp-error">{error}</div> : null}

        <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm">Connection and system details</summary><section className="mt-3 grid gap-3 lg:grid-cols-4">
          {[[copy.panels.tenant, [
            [copy.panels.organisation, xero.tenantName || copy.panels.notConnected],
            [copy.panels.tenantId, xero.tenantId || copy.common.unavailable],
            [copy.panels.tokenExpires, formatDateTime(xero.expiresAt)],
            [copy.panels.redirectUri, xero.redirectUri || copy.common.notConfigured],
          ]],
            [copy.panels.scopes, [
            [copy.panels.contacts, scopeFlags.contacts ? copy.common.available : copy.common.missing],
            [copy.panels.invoices, scopeFlags.invoices ? copy.common.available : copy.common.missing],
            [copy.panels.attachments, scopeFlags.attachments ? copy.common.available : copy.common.missing],
            [copy.panels.payments, scopeFlags.paymentsWrite ? copy.common.readWrite : scopeFlags.paymentsRead ? copy.common.readOnly : copy.common.missing],
            [copy.panels.accountingSettings, scopeFlags.settingsRead ? copy.common.available : copy.common.missing],
          ]],
            [copy.panels.salesforce, [
            [copy.panels.auth, status?.salesforce?.authMode || copy.common.unknown],
            [copy.panels.instance, hostname(status?.salesforce?.instanceUrl, copy.common.notConfigured)],
            [copy.panels.clKey, copy.panels.hkOnly],
            [copy.panels.deliveryFrom, status?.salesforce?.recentStemDeliveryFrom || '2025-01-01'],
          ]],
            [copy.panels.automation, [
            [copy.panels.run, autoRun?.id ? shortId(autoRun.id) : copy.panels.noRun],
            [copy.panels.event, autoRun?.eventId || copy.common.unavailable],
            [copy.panels.created, String(autoRun?.summary?.created || 0)],
            [copy.panels.skippedFailed, `${autoRun?.summary?.skipped || 0} / ${autoRun?.summary?.failed || 0}`],
          ]]].map(([title, rows]) => <ConnectionPanel key={title} title={title} rows={rows} unavailable={copy.common.unavailable} />)}
        </section></details>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            {['accounting', 'contacts', 'receipts', 'automation'].map((key) => <TabsTrigger key={key} value={key}>{copy.tabs[key]}</TabsTrigger>)}
            <TabsTrigger value="manual">{copy.tabs.manual}</TabsTrigger>
          </TabsList>

          <TabsContent value="contacts" className="space-y-4">
            <section className="xp-contact-kpis">
              {[
                ['active', 'nonArchivedXeroContacts'], ['archived', 'archivedXeroContacts'],
                ['unmatched', 'unmatchedNonArchivedXeroContacts', 'amber'], ['rename', 'renameEligible', 'sky'],
                ['archive', 'archiveEligible', 'rose'], ['exceptions', 'exception', 'slate'],
              ].map(([label, field, tone]) => <Kpi key={label} label={copy.contacts.kpis[label]} value={hasLifecycleRun ? summary[field] : null} tone={tone} emptyLabel={copy.contacts.previewRequired} />)}
            </section>

            <section className={PORTAL_CARD_CLASS}>
              <div className={PORTAL_SECTION_HEADER_CLASS}>
                <div>
                  <h2 className="text-base font-semibold">{copy.contacts.title}</h2>
                  <p className={PORTAL_DESCRIPTION_CLASS}>{copy.contacts.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setFilters((current) => ({ ...current, unmatchedOnly: !current.unmatchedOnly }))}>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    {filters.unmatchedOnly ? copy.contacts.showAll : copy.contacts.showUnmatched}
                  </Button>
                  <Button type="button" onClick={() => previewLifecycle()} disabled={Boolean(busy) || !xero.connected || !scopeFlags.contacts}>
                    <ActionIcon busy={busy === 'preview'} icon={RefreshCw} />
                    {copy.contacts.preview}
                  </Button>
                </div>
              </div>

              <div className="xp-contact-tools">
                <div className="xp-usage-tools">
                  <label className={PORTAL_REVIEW_LABEL_CLASS}>
                    <Checkbox checked={forceUsageRefresh} onCheckedChange={(checked) => setForceUsageRefresh(checked === true)} />
                    {copy.contacts.fullUsage}
                  </label>
                  <label className={PORTAL_REVIEW_LABEL_CLASS}>
                    <Checkbox checked={incrementalUsageRefresh} onCheckedChange={(checked) => setIncrementalUsageRefresh(checked === true)} disabled={forceUsageRefresh} />
                    {copy.contacts.incrementalUsage}
                  </label>
                  <AuditButton disabled={!run} onClick={() => downloadJson(run, `xero-contact-lifecycle-${run?.id || 'run'}.json`)} icon={FileJson}>{copy.contacts.jsonAudit}</AuditButton>
                  <AuditButton disabled={!run} onClick={() => downloadCsv(run?.rows || [], `xero-contact-lifecycle-${run?.id || 'run'}.csv`)} icon={Download}>{copy.contacts.csvAudit}</AuditButton>
                </div>
                <div className="xp-call-estimate">
                  <div className={PORTAL_EMPHASIS_CLASS}>{copy.contacts.callEstimate}</div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    <span>{copy.contacts.preview}: {hasLifecycleRun ? (run?.xeroCallEstimate?.previewActualCalls ?? 0) : copy.common.pending}</span>
                    <span>{copy.contacts.verify}: {hasLifecycleRun ? (run?.xeroCallEstimate?.applyVerifyCalls ?? 0) : copy.common.pending}</span>
                    <span>{copy.contacts.apply}: {hasLifecycleRun ? (run?.xeroCallEstimate?.applyMutationCalls ?? 0) : copy.common.pending}</span>
                  </div>
                </div>
              </div>

              <div className="xp-last-run">
                {hasLifecycleRun
                  ? copy.contacts.lastRun(shortId(run.id), formatDateTime(run.createdAt), Number(run.rowCount || run.rows?.length || 0).toLocaleString(copy.locale))
                  : copy.contacts.noRun}
              </div>

              <UsageCache sources={status?.usageCache?.sources || run?.usageCache?.sources || []} copy={copy} />
              <StatusLegend labels={statusLabels} copy={copy} />
            </section>

            <section className="xero-contacts-review xp-card border bg-card border-border">
              <div className="grid gap-2 md:grid-cols-5">
                <div className="relative md:col-span-2">
                  <Search className="xp-search-icon" />
                  <Input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder={copy.contacts.search} className="pl-9" />
                </div>
                <NativeSelect value={filters.action} onChange={(action) => setFilters((current) => ({ ...current, action }))} options={actionOptions} />
                <NativeSelect value={filters.status} onChange={(statusValue) => setFilters((current) => ({ ...current, status: statusValue }))} options={statusOptions} />
                <NativeSelect value={filters.reason} onChange={(reason) => setFilters((current) => ({ ...current, reason }))} options={reasonOptions} />
              </div>

              <div className="xp-review-actions">
                <div className={PORTAL_MUTED_CLASS}>
                  {copy.contacts.showing(filteredRows.length.toLocaleString(copy.locale), totalSelectedCount.toLocaleString(copy.locale), selectedEligibleCount.toLocaleString(copy.locale))}
                </div>
                <div className={PORTAL_ACTIONS_CLASS}>
                  <Button type="button" variant="outline" onClick={selectVisibleEligible} disabled={!filteredRows.some(canApplyRow)}>{copy.contacts.selectVisible}</Button>
                  <Button type="button" variant="outline" onClick={() => setSelectedRows(new Set())}>{copy.common.clear}</Button>
                  <label className={PORTAL_REVIEW_LABEL_CLASS}>
                    <Checkbox checked={reviewed} onCheckedChange={(checked) => setReviewed(checked === true)} />
                    {copy.contacts.reviewed}
                  </label>
                  <Button type="button" onClick={applyLifecycle} disabled={!run?.id || !reviewed || !selectedEligibleCount || Boolean(busy)}>
                    <ActionIcon busy={busy === 'apply'} icon={Archive} />
                    {copy.contacts.applySelected}
                  </Button>
                </div>
              </div>

              <div className="xp-repair-actions">
                <span className={PORTAL_MUTED_CLASS}>{copy.contacts.repair.selected(repairCount)}</span>
                <label className={PORTAL_LABEL_CLASS}><Checkbox checked={repairReviewed} onCheckedChange={(checked) => setRepairReviewed(checked === true)} />{copy.contacts.repair.reviewed}</label>
                <Button type="button" variant="outline" onClick={applyContactRepair} disabled={!repairReviewed || !repairCount || repairCount > 25 || Boolean(busy)}>{copy.contacts.repair.createSelected}</Button>
                {repairCount > 25 && <span role="alert" className="text-sm text-amber-800">{copy.contacts.repair.limit}</span>}
              </div>

              {(run?.rows || []).some(canRestoreContactRow) || restoreResult ? <section className="xp-restore-panel" aria-label={restoreCopy.title}>
                <h3 className="text-sm font-semibold">{restoreCopy.title}</h3>
                <p className={PORTAL_MUTED_CLASS}>{restoreCopy.description}</p>
                <div className={PORTAL_ACTIONS_CLASS}>
                  <span className={PORTAL_MUTED_CLASS}>{restoreCopy.selected(restoreCount)}</span>
                  <Button type="button" variant="outline" disabled={Boolean(busy) || !restoreCount} onClick={() => { setRestoreSelected(new Set()); setRestoreReviewed(false); }}>{restoreCopy.clear}</Button>
                  <label className={PORTAL_LABEL_CLASS}><Checkbox checked={restoreReviewed} disabled={Boolean(busy) || !restoreWritesAllowed || restoreVerificationRequired || !restoreCount} onCheckedChange={(checked) => setRestoreReviewed(checked === true)} />{restoreCopy.reviewed}</label>
                  <Button type="button" variant="outline" onClick={applyContactRestore} disabled={!run?.id || !restoreWritesAllowed || restoreVerificationRequired || !restoreReviewed || !restoreCount || restoreCount > 25 || Boolean(busy)}>
                    {busy === 'restore' && <Loader2 className={PORTAL_SPINNER_CLASS} />}{restoreCopy.title}
                  </Button>
                </div>
                {!restoreWritesAllowed && <p className={PORTAL_MUTED_CLASS}>{restoreCopy.readOnly}</p>}
                {restoreCount > 25 && <p role="alert" className="text-sm text-amber-800">{restoreCopy.limit}</p>}
                {restoreVerificationRequired && <p role="alert" className="text-sm text-amber-800">{restoreCopy.uncertain}</p>}
                {restoreResult?.summary && <p role="status" className="text-sm">{restoreCopy.outcome(restoreResult.summary)}</p>}
                {restoreResult?.attemptedRows?.map((attempt) => <p key={attempt.rowId} className={PORTAL_OUTCOME_CLASS}>{attempt.salesforceAccountId} → {attempt.xeroContactId}</p>)}
                {restoreResult?.outcomes?.map((outcome) => <p key={outcome.rowId} className={PORTAL_OUTCOME_CLASS}>{outcome.salesforceAccountId} → {outcome.xeroContactId}: {outcome.status}{outcome.message ? ` · ${outcome.message}` : ''}</p>)}
              </section> : null}

              <div className="xero-contacts-review__wide mt-4">
                <Table scrollLabel={copy.contacts.tableLabel} className="min-w-0 table-fixed">
                  <colgroup>
                    <col style={{ width: '4%' }} /><col style={{ width: '10%' }} /><col style={{ width: '9%' }} />
                    <col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '10%' }} />
                    <col style={{ width: '11%' }} /><col style={{ width: '24%' }} />
                  </colgroup>
                  <TableHeader><TableRow>{[copy.common.use, copy.common.action, copy.common.status, copy.contacts.xeroContact, copy.contacts.salesforceSource, copy.contacts.match, copy.contacts.usage, copy.common.reason].map((label, index) => <TableHead key={index} className={index === 0 ? 'w-10' : undefined}>{label}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {contactPresentations.length ? contactPresentations.map(({ row, selection, action, status: rowStatus, details, reason }) => (
                      <TableRow key={row.id}>
                        <TableCell>{selection}</TableCell><TableCell>{action}</TableCell><TableCell>{rowStatus}</TableCell>
                        {[...details.map(([, content]) => content), reason].map((content, index) => <TableCell key={index} className="xp-wrap">{content}</TableCell>)}
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={8}><StateBlock icon={CheckCircle2} title={hasLifecycleRun ? copy.contacts.noRowsTitle : copy.contacts.noPreviewTitle} description={hasLifecycleRun ? copy.contacts.noRowsDescription : copy.contacts.noPreviewDescription} /></TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="xero-contacts-review__compact mt-4 space-y-3">
                {contactPresentations.length ? contactPresentations.map(({ row, selection, action, status: rowStatus, details, reason }) => (
                  <article key={row.id} className="xp-contact-card" aria-label={`${copy.contacts.xeroContact}: ${row.xeroContactName || copy.contacts.noXeroMatch}`}>
                    <div className={PORTAL_ACTIONS_CLASS}>
                      <label className="xp-selection-label">{selection}{copy.common.use}</label>{action}{rowStatus}
                    </div>
                    <div className="xp-contact-reason">
                      <div className="xp-reason-label">{copy.common.reason}</div>{reason}
                    </div>
                    <dl className="xp-contact-details">
                      {details.map(([label, content]) => <div key={label} className="xp-detail"><dt className={PORTAL_FIELD_LABEL_CLASS}>{label}</dt><dd className="mt-1">{content}</dd></div>)}
                    </dl>
                  </article>
                )) : <StateBlock icon={CheckCircle2} title={hasLifecycleRun ? copy.contacts.noRowsTitle : copy.contacts.noPreviewTitle} description={hasLifecycleRun ? copy.contacts.noRowsDescription : copy.contacts.noPreviewDescription} />}
              </div>
            </section>
            {identityRow && <Suspense fallback={null}><XeroContactResolution row={identityRow} tenantId={run?.xero?.tenantId} language="en" onClose={() => setIdentityRow(null)} onSaved={saveIdentityAndRefresh} /></Suspense>}
          </TabsContent>

          <TabsContent value="accounting" className="space-y-4">
            <Suspense fallback={<StateBlock icon={Loader2} title={copy.financial.loadingTitle} description={copy.financial.loadingDescription} />}>
              <XeroFinancialSync portalStatus={status} language="en" />
            </Suspense>
          </TabsContent>

          <TabsContent value="receipts" className="space-y-4">
            <section className="xp-receipt-layout">
              <div className={PORTAL_CARD_CLASS}>
                <h2 className="text-base font-semibold">{copy.receipts.title}</h2>
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className={PORTAL_FIELD_LABEL_CLASS}>{copy.receipts.file}</span>
                    <span className="xp-upload">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{copy.receipts.chooseFile}</span>
                      <span className="min-w-0 truncate text-muted-foreground">{receiptFile?.name || copy.receipts.noFile}</span>
                    </span>
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} />
                  </label>
                  <div className={PORTAL_TWO_COLUMNS_CLASS}>
                    <Button type="button" variant="outline" onClick={runOcr} disabled={!receiptFile || ocrBusy}>
                      <ActionIcon busy={ocrBusy} icon={FileText} />
                      {copy.receipts.ocr}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setReceiptDraft(emptyReceiptFields())}>{copy.receipts.reset}</Button>
                  </div>
                  {receiptField('merchant')}
                  <div className={PORTAL_TWO_COLUMNS_CLASS}>
                    {receiptField('date', 'date', 'date')}
                    {receiptField('total', 'total', 'number')}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <NativeSelect label={copy.receipts.currency} value={receiptDraft.currency} onChange={(currency) => setReceiptDraft((current) => ({ ...current, currency }))} options={RECEIPT_CURRENCIES.map((code) => [code, code])} />
                    {receiptField('accountCode', 'account')}
                    {receiptField('taxType', 'tax')}
                  </div>
                  {receiptField('category')}
                  <div>
                    <label className={PORTAL_FIELD_LABEL_CLASS}>{copy.receipts.notes}</label>
                    <Textarea value={receiptDraft.note} onChange={(event) => setReceiptDraft((current) => ({ ...current, note: event.target.value }))} rows={6} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => saveReceipt({ sync: false })} disabled={!receiptFile || busy === 'receipt-create' || busy === 'receipt-sync-create'}>
                      <ActionIcon busy={busy === 'receipt-create'} icon={Upload} />
                      {copy.receipts.save}
                    </Button>
                    <Button type="button" onClick={() => saveReceipt({ sync: true })} disabled={!receiptFile || !xero.connected || !scopeFlags.invoices || !scopeFlags.attachments || busy === 'receipt-sync-create' || busy === 'receipt-create'}>
                      <ActionIcon busy={busy === 'receipt-sync-create'} icon={Send} />
                      {copy.receipts.createBill}
                    </Button>
                  </div>
                </div>
              </div>

              <div className={PORTAL_CARD_CLASS}>
                <h2 className="text-base font-semibold">{copy.receipts.auditTitle}</h2>
                <div className="mt-4">
                  <Table scrollLabel={copy.receipts.auditLabel}>
                    <TableHeader><TableRow>{[copy.receipts.receipt, copy.receipts.total, copy.receipts.status, copy.receipts.xero, copy.receipts.updated, copy.receipts.action].map((label, index) => <TableHead key={index}>{label}</TableHead>)}</TableRow></TableHeader>
                    <TableBody>
                      {receipts.map((receipt) => (
                        <TableRow key={receipt.id}>
                          <TableCell>
                            <div className="font-medium">{receipt.merchant}</div>
                            <div className={PORTAL_DETAIL_CLASS}>{receipt.fileName} · {receipt.date}</div>
                          </TableCell>
                          <TableCell>{receipt.currency} {formatNumber(receipt.total)}</TableCell>
                          <TableCell><ReceiptStatusBadge status={receipt.status} copy={copy} /></TableCell>
                          <TableCell>
                            {receipt.xeroInvoiceUrl ? <a className="xp-bill-link" href={receipt.xeroInvoiceUrl} target="_blank" rel="noreferrer">{copy.receipts.draftBill} <ExternalLink className="h-3 w-3" /></a> : copy.receipts.notSynced}
                            {receipt.error ? <div className="mt-1 max-w-[260px] text-xs text-red-700">{receipt.error}</div> : null}
                          </TableCell>
                          <TableCell>{formatDateTime(receipt.updatedAt)}</TableCell>
                          <TableCell>
                            <Button type="button" size="sm" variant="outline" onClick={() => syncReceipt(receipt.id)} disabled={receipt.status === 'synced' || !xero.connected || !scopeFlags.invoices || !scopeFlags.attachments || busy === `receipt-sync-${receipt.id}`}>
                              {busy === `receipt-sync-${receipt.id}` ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
                              {copy.receipts.sync}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!receipts.length ? <TableRow><TableCell colSpan={6}><StateBlock icon={FileText} title={copy.receipts.emptyTitle} description={copy.receipts.emptyDescription} /></TableCell></TableRow> : null}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="automation" className="space-y-4">
            <section className={PORTAL_CARD_CLASS}>
              <div className={PORTAL_SECTION_HEADER_CLASS}>
                <div>
                  <h2 className="text-base font-semibold">{copy.automation.title}</h2>
                  <p className={PORTAL_DESCRIPTION_CLASS}>{copy.automation.description}</p>
                </div>
                <div className="flex gap-2">
                  <AuditButton disabled={!autoRun} onClick={() => downloadJson(autoRun, `xero-contact-auto-create-${autoRun?.id || 'run'}.json`)} icon={FileJson}>{copy.contacts.jsonAudit}</AuditButton>
                  <AuditButton disabled={!autoRun} onClick={() => downloadCsv(autoRun?.rows || [], `xero-contact-auto-create-${autoRun?.id || 'run'}.csv`)} icon={Download}>{copy.contacts.csvAudit}</AuditButton>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                {[
                  ['pending', autoRun?.summary?.pending || 0, 'sky'], ['created', autoRun?.summary?.created || 0, 'emerald'],
                  ['alreadyExists', autoRun?.summary?.alreadyExists || autoRun?.summary?.['already-exists'] || 0], ['failed', autoRun?.summary?.failed || 0, 'rose'],
                ].map(([key, value, tone]) => <Kpi key={key} label={copy.automation[key]} value={value} tone={tone} />)}
              </div>
              <div className="mt-4">
                <Table scrollLabel={copy.automation.tableLabel}>
                  <TableHeader><TableRow>{[copy.common.status, copy.automation.salesforceAccount, copy.automation.xeroContact, copy.automation.match, copy.automation.reason].map((label, index) => <TableHead key={index}>{label}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {(autoRun?.rows || []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell><StatusBadgeText status={row.status} copy={copy} /></TableCell>
                        <TableCell>
                          <div className="font-medium">{row.salesforceName || copy.automation.noAccount}</div>
                          <div className={PORTAL_DETAIL_CLASS}>{row.salesforceCompanyCode || copy.common.noClKey} · {copy.recordTypes[row.salesforceRecordType] || row.salesforceRecordType || copy.common.noType}</div>
                        </TableCell>
                        <TableCell>{row.xeroContactName || row.xeroContactId || copy.automation.noXeroContact}</TableCell>
                        <TableCell>{row.matchField ? (copy.matchFields[row.matchField] || matchFieldLabels[row.matchField] || row.matchField) : copy.common.none}</TableCell>
                        <TableCell>{copy.reasons[row.reason] || reasonLabels[row.reason] || row.reason || row.message || copy.common.noIssue}</TableCell>
                      </TableRow>
                    ))}
                    {!autoRun?.rows?.length ? <TableRow><TableCell colSpan={5}><StateBlock icon={AlertTriangle} title={copy.automation.emptyTitle} description={copy.automation.emptyDescription} /></TableCell></TableRow> : null}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="manual" className="space-y-4">
            <Suspense fallback={<StateBlock icon={Loader2} title={copy.manual.loadingTitle} description={copy.manual.loadingDescription} />}>
              <XeroPortalManual />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ConnectionPanel({ title, rows, unavailable }) {
  return (
    <section className={PORTAL_CARD_CLASS}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="xp-connection-row">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-medium" title={String(value || '')}>{value || unavailable}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Kpi({ label, value, tone = 'neutral', emptyLabel = '' }) {
  const tones = {
    neutral: 'border-slate-200 bg-slate-50 text-slate-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-950',
    sky: 'border-sky-200 bg-sky-50 text-sky-950',
    rose: 'border-rose-200 bg-rose-50 text-rose-950',
    slate: 'border-zinc-200 bg-zinc-50 text-zinc-950',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  };
  const number = Number(value);
  const hasValue = value !== null && value !== undefined && Number.isFinite(number);
  return (
    <div className={cn('rounded-lg border px-4 py-3', tones[tone] || tones.neutral)}>
      <div className="xp-kpi-label">{label}</div>
      <div className={cn('mt-1 font-semibold', hasValue ? 'text-2xl' : 'text-sm')}>{hasValue ? number.toLocaleString() : emptyLabel}</div>
    </div>
  );
}

function UsageCache({ sources, copy }) {
  if (!sources?.length) return null;
  return (
    <div className={PORTAL_CACHE_GRID_CLASS}>
      {sources.map((source) => (
        <div key={source.source} className="xp-cache-card">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold">{source.label}</span>
            <StatusBadgeText status={source.status} copy={copy} />
          </div>
          <div className={PORTAL_DETAIL_CLASS}>
            {source.recordsScanned?.toLocaleString?.(copy.locale) || 0} records · {source.contactCount?.toLocaleString?.(copy.locale) || 0} contacts
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(source.scannedAt)}</div>
        </div>
      ))}
    </div>
  );
}

function StatusLegend({ labels, copy }) {
  return (
    <div className={PORTAL_CACHE_GRID_CLASS}>
      {Object.entries(labels || {}).map(([status, description]) => (
        <div key={status} className="xp-legend-card">
          <div className={PORTAL_EMPHASIS_CLASS}>{copy.statuses[status] || status.replaceAll('-', ' ')}</div>
          <div className="mt-1 text-muted-foreground">{copy.statusDescriptions[status] || description}</div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className={PORTAL_FIELD_LABEL_CLASS}>{label}</span>
      <Input type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NativeSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      {label ? <span className={PORTAL_FIELD_LABEL_CLASS}>{label}</span> : null}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="glass-control h-9 w-full rounded-[var(--radius-control)] border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {options.map(([optionValue, labelText]) => <option key={optionValue} value={optionValue}>{labelText}</option>)}
      </select>
    </label>
  );
}

function AuditButton({ children, disabled, onClick, icon: Icon }) {
  return (
    <Button type="button" variant="outline" onClick={onClick} disabled={disabled}>
      <Icon className="mr-2 h-4 w-4" />
      {children}
    </Button>
  );
}

function StatusBadge({ ok, trueLabel, falseLabel, tone = ok ? 'emerald' : 'rose' }) {
  const className = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-rose-200 bg-rose-50 text-rose-700';
  return <Badge variant="outline" className={className}>{ok ? trueLabel : falseLabel}</Badge>;
}

function StatusBadgeText({ status, copy, wrap = false }) {
  const value = String(status || 'unknown');
  const tone = {
    eligible: 'border-sky-200 bg-sky-50 text-sky-700',
    blocked: 'border-amber-200 bg-amber-50 text-amber-800',
    kept: 'border-slate-200 bg-slate-50 text-slate-700',
    updated: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    archived: 'border-zinc-300 bg-zinc-100 text-zinc-800',
    failed: 'border-rose-200 bg-rose-50 text-rose-700',
    complete: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    missing: 'border-amber-200 bg-amber-50 text-amber-800',
    pending: 'border-sky-200 bg-sky-50 text-sky-700',
    created: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    skipped: 'border-slate-200 bg-slate-50 text-slate-700',
    'already-exists': 'border-slate-200 bg-slate-50 text-slate-700',
    'not-selected': 'border-slate-200 bg-slate-50 text-slate-700',
  }[value] || 'border-slate-200 bg-slate-50 text-slate-700';
  return <Badge variant="outline" className={cn(wrap ? 'min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]' : 'whitespace-nowrap', tone)}>{copy?.statuses?.[value] || value.replaceAll('-', ' ')}</Badge>;
}

function ReceiptStatusBadge({ status, copy }) {
  const ok = status === 'synced';
  const fail = status === 'failed';
  return (
    <Badge variant="outline" className={cn(
      ok && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      fail && 'border-rose-200 bg-rose-50 text-rose-700',
      !ok && !fail && 'border-slate-200 bg-slate-50 text-slate-700',
    )}>
      {copy?.statuses?.[status] || status}
    </Badge>
  );
}

function ActionBadge({ action, copy, wrap = false }) {
  const icon = {
    archive: Archive,
    rename: RefreshCw,
    exception: AlertTriangle,
    keep: CheckCircle2,
  }[action] || ShieldCheck;
  const Icon = icon;
  return (
    <Badge variant="outline" className={wrap ? 'min-w-0 max-w-full whitespace-normal px-1.5 [overflow-wrap:anywhere]' : 'whitespace-nowrap'}>
      <Icon className="mr-1 h-3 w-3 shrink-0" />
      {copy?.actions?.[action] || String(action || copy?.common?.unknown || 'unknown')}
    </Badge>
  );
}

function XeroContactIdentity({ row, copy }) {
  return <>
    <div className="font-medium">{row.xeroContactName || copy.contacts.noXeroMatch}</div>
    <div className={PORTAL_DETAIL_CLASS}>
      {row.xeroContactNumber || copy.contacts.noContactNumber} · {row.xeroAccountNumber || copy.contacts.noAccountNumber} · {row.xeroContactStatus || copy.contacts.noStatus}
    </div>
  </>;
}

function SalesforceContactIdentity({ row, copy }) {
  return <>
    <div className="font-medium">{row.salesforceName || copy.contacts.noSalesforceMatch}</div>
    <div className={PORTAL_DETAIL_CLASS}>
      {row.salesforceCompanyCode || copy.common.noClKey} · {copy.recordTypes[row.salesforceRecordType] || row.salesforceRecordType || copy.common.noType}
    </div>
  </>;
}

function ContactReason({ row, copy, reasonLabels }) {
  return <>
    <div className="font-medium">{copy.reasons[row.reason] || reasonLabels[row.reason] || row.reason || copy.common.noIssue}</div>
    {row.message ? <div className={PORTAL_DETAIL_CLASS}>{row.message}</div> : null}
  </>;
}

function canApplyRow(row) {
  return row?.status === 'eligible' && (row.action === 'rename' || row.action === 'archive') && row.xeroContactId;
}

const CONTACT_IDENTITY_REASONS = new Set(['used-unmatched-xero-contact', 'unused-unmatched-xero-contact', 'nonzero-balance', 'verification-stale', 'verified-xero-only']);

function canReviewContactIdentity(row) {
  return Boolean(row?.xeroContactId && !row.salesforceAccountId && row.identityFingerprint
    && CONTACT_IDENTITY_REASONS.has(row.reason) && String(row.xeroContactStatus || '').toUpperCase() === 'ACTIVE');
}

function canRepairRow(row) {
  return row?.reason === 'missing-xero-contact' && row.action === 'exception' && row.status === 'blocked'
    && Boolean(row.salesforceAccountId) && !row.xeroContactId;
}

function ContactUsage({ usage = [], copy }) {
  if (!usage?.length) return copy.contacts.noReadableUsage;
  const formatCount = (value) => Number(value || 0).toLocaleString(copy.locale);
  return <ul className="space-y-2">
    {usage.map((item, index) => {
      const scanned = Array.isArray(item.yearCounts) && typeof item.undatedRecords === 'number';
      return <li key={`${item.source || item.label || 'usage'}-${index}`}>
        <div className="font-medium">{copy.contacts.usageSourceTotal(copy.usageSources[item.source] || item.label || item.source, formatCount(item.records))}</div>
        {scanned ? (
          <div className="xp-usage-years">
            {item.yearCounts.map(({ year, records }) => <span key={year}>{year}: {formatCount(records)}</span>)}
            {item.undatedRecords > 0 ? <span>{copy.contacts.yearUnavailable(formatCount(item.undatedRecords))}</span> : null}
          </div>
        ) : <div className="mt-0.5 text-xs text-muted-foreground">{copy.contacts.yearBreakdownPending}</div>}
      </li>;
    })}
  </ul>;
}

function summarizeApply(summary) {
  return `${summary.updated || 0} renamed, ${summary.archived || 0} archived, ${summary.failed || 0} failed.`;
}

function formatDateTime(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}

function hostname(value, fallback = 'Not configured') {
  try {
    return new URL(value).hostname;
  } catch {
    return value || fallback;
  }
}

function shortId(value) {
  return String(value || '').slice(0, 8);
}

function downloadJson(value, filename) {
  downloadBlob(new Blob([JSON.stringify(value || {}, null, 2)], { type: 'application/json' }), filename);
}

function downloadCsv(rows, filename) {
  const columns = [
    'id',
    'action',
    'status',
    'reason',
    'xeroContactId',
    'xeroContactName',
    'xeroContactNumber',
    'xeroAccountNumber',
    'xeroContactStatus',
    'salesforceAccountId',
    'salesforceCompanyCode',
    'salesforceName',
    'salesforceRecordType',
    'proposedName',
    'matchField',
    'message',
    'appliedAt',
    'idempotencyKey',
  ];
  const lines = [columns.join(',')];
  for (const row of rows || []) lines.push(columns.map((column) => csvCell(row[column])).join(','));
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

function csvCell(value) {
  const text = Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ActionIcon({ busy, icon: Icon }) {
  const Glyph = busy ? Loader2 : Icon;
  return <Glyph className={cn('mr-2 h-4 w-4', busy && 'animate-spin')} />;
}
