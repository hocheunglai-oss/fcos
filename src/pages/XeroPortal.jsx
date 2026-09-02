import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
  Languages,
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
import {
  XERO_PORTAL_LANGUAGE_STORAGE_KEY,
  XERO_PORTAL_UI_LANGUAGES,
  normalizeXeroPortalLanguage,
  xeroPortalUiCopy,
} from '@/lib/xeroPortalUiCopy';
import { cn } from '@/lib/utils';

const ACTION_FILTERS = ['archive', 'rename', 'exception', 'keep'];
const STATUS_FILTERS = ['eligible', 'blocked', 'kept', 'not-selected', 'updated', 'archived', 'failed'];

const RECEIPT_CURRENCIES = ['HKD', 'USD', 'SGD', 'CNY', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'JPY'];
const XeroFinancialSync = lazy(() => import('@/components/xero/XeroFinancialSync'));
const XeroPortalManual = lazy(() => import('@/components/xero/XeroPortalManual'));

export default function XeroPortal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('contacts');
  const [status, setStatus] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [run, setRun] = useState(null);
  const [autoRun, setAutoRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ action: 'all', status: 'all', reason: 'all', search: '', unmatchedOnly: false });
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [reviewed, setReviewed] = useState(false);
  const [forceUsageRefresh, setForceUsageRefresh] = useState(false);
  const [incrementalUsageRefresh, setIncrementalUsageRefresh] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState(emptyReceiptFields);
  const [receiptFile, setReceiptFile] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [language, setLanguage] = useState(() => normalizeXeroPortalLanguage(
    typeof window === 'undefined' ? 'en' : window.localStorage.getItem(XERO_PORTAL_LANGUAGE_STORAGE_KEY),
  ));
  const copy = xeroPortalUiCopy(language);

  useEffect(() => {
    window.localStorage.setItem(XERO_PORTAL_LANGUAGE_STORAGE_KEY, language);
  }, [language]);

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
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const xero = searchParams.get('xero');
    const message = searchParams.get('message');
    const callbackCopy = xeroPortalUiCopy(window.localStorage.getItem(XERO_PORTAL_LANGUAGE_STORAGE_KEY));
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
  const totalSelectedCount = [...selectedRows].length;

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

  async function previewLifecycle() {
    setBusy('preview');
    setReviewed(false);
    const result = await appClient.functions.invoke('xeroPortalContactLifecyclePreview', {
      forceUsageRefresh,
      incrementalUsageRefresh,
    }, { force: true, invalidateCache: true });
    setBusy('');
    if (result.data?.error) {
      toast({ title: copy.toasts.previewFailed, description: result.data.error, variant: 'destructive' });
      return;
    }
    setRun(result.data.run);
    setSelectedRows(new Set((result.data.run?.rows || []).filter(canApplyRow).map((row) => row.id)));
    await load({ force: true });
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
    toast({ title: copy.toasts.changesApplied, description: summarizeApply(result.data.run?.summary || {}, language) });
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
    if (!receiptFile) {
      toast({ title: copy.toasts.fileRequired, description: copy.toasts.fileRequiredDescription, variant: 'destructive' });
      return;
    }
    setBusy(sync ? 'receipt-sync-create' : 'receipt-create');
    const filePayload = await fileToPayload(receiptFile);
    const result = await appClient.functions.invoke('xeroPortalReceiptCreate', {
      fields: receiptDraft,
      file: filePayload,
      autoSync: sync,
    }, { force: true, invalidateCache: true });
    setBusy('');
    if (result.data?.error) {
      toast({ title: sync ? copy.toasts.receiptSyncFailed : copy.toasts.receiptSaveFailed, description: result.data.error, variant: 'destructive' });
      return;
    }
    setReceiptDraft(emptyReceiptFields());
    setReceiptFile(null);
    toast({ title: sync ? copy.toasts.receiptSent : copy.toasts.receiptSaved, description: sync ? copy.toasts.receiptSentDescription : copy.toasts.receiptSavedDescription });
    await load({ force: true });
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
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function selectVisibleEligible() {
    setSelectedRows(new Set(filteredRows.filter(canApplyRow).map((row) => row.id)));
  }

  if (loading && !status) {
    return <div className="workspace-tools p-4 lg:p-6"><StateBlock icon={Loader2} title={copy.header.loadingTitle} description={copy.header.loadingDescription} /></div>;
  }

  return (
    <div className="workspace-tools min-h-full bg-background p-4 text-foreground lg:p-6" lang={language === 'zh-Hant' ? 'zh-Hant-HK' : 'en'}>
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-normal">{copy.header.title}</h1>
              <StatusBadge ok={xero.connected} trueLabel={copy.header.connected} falseLabel={copy.header.disconnected} />
              <StatusBadge ok={actionGate?.enabled} trueLabel={copy.header.writesEnabled} falseLabel={copy.header.writesGated} tone={actionGate?.enabled ? 'emerald' : 'amber'} />
            </div>
            <p className="mt-1 max-w-4xl text-sm text-muted-foreground">{copy.header.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div aria-label={copy.languageLabel} className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
              <Languages className="mx-2 my-auto h-4 w-4 text-muted-foreground" />
              {XERO_PORTAL_UI_LANGUAGES.map((option) => (
                <Button key={option.id} type="button" size="sm" variant={language === option.id ? 'default' : 'ghost'} className="h-8" aria-pressed={language === option.id} onClick={() => setLanguage(option.id)}>
                  {option.label}
                </Button>
              ))}
            </div>
            <Button type="button" variant="outline" onClick={() => setTab('manual')}>
              <BookOpen className="mr-2 h-4 w-4" />
              {copy.header.manual}
            </Button>
            <Button type="button" variant="outline" onClick={() => load({ force: true })} disabled={Boolean(busy)}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {copy.header.refresh}
            </Button>
            {xero.connected ? (
              <>
                {needsFinancialReconnect ? (
                  <Button type="button" onClick={connectXero} disabled={busy === 'connect'}>
                    {busy === 'connect' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                    {copy.header.reconnect}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={disconnectXero} disabled={busy === 'disconnect'}>
                  {busy === 'disconnect' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                  {copy.header.disconnect}
                </Button>
              </>
            ) : (
              <Button type="button" onClick={connectXero} disabled={busy === 'connect' || !xero.configured}>
                {busy === 'connect' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                {copy.header.connect}
              </Button>
            )}
          </div>
        </header>

        {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <section className="grid gap-3 lg:grid-cols-4">
          <ConnectionPanel unavailable={copy.common.unavailable} title={copy.panels.tenant} rows={[
            [copy.panels.organisation, xero.tenantName || copy.panels.notConnected],
            [copy.panels.tenantId, xero.tenantId || copy.common.unavailable],
            [copy.panels.tokenExpires, formatDateTime(xero.expiresAt, language)],
            [copy.panels.redirectUri, xero.redirectUri || copy.common.notConfigured],
          ]} />
          <ConnectionPanel unavailable={copy.common.unavailable} title={copy.panels.scopes} rows={[
            [copy.panels.contacts, scopeFlags.contacts ? copy.common.available : copy.common.missing],
            [copy.panels.invoices, scopeFlags.invoices ? copy.common.available : copy.common.missing],
            [copy.panels.attachments, scopeFlags.attachments ? copy.common.available : copy.common.missing],
            [copy.panels.payments, scopeFlags.paymentsWrite ? copy.common.readWrite : scopeFlags.paymentsRead ? copy.common.readOnly : copy.common.missing],
            [copy.panels.accountingSettings, scopeFlags.settingsRead ? copy.common.available : copy.common.missing],
          ]} />
          <ConnectionPanel unavailable={copy.common.unavailable} title={copy.panels.salesforce} rows={[
            [copy.panels.auth, status?.salesforce?.authMode || copy.common.unknown],
            [copy.panels.instance, hostname(status?.salesforce?.instanceUrl, copy.common.notConfigured)],
            [copy.panels.clKey, copy.panels.hkOnly],
            [copy.panels.deliveryFrom, status?.salesforce?.recentStemDeliveryFrom || '2025-01-01'],
          ]} />
          <ConnectionPanel unavailable={copy.common.unavailable} title={copy.panels.automation} rows={[
            [copy.panels.run, autoRun?.id ? shortId(autoRun.id) : copy.panels.noRun],
            [copy.panels.event, autoRun?.eventId || copy.common.unavailable],
            [copy.panels.created, String(autoRun?.summary?.created || 0)],
            [copy.panels.skippedFailed, `${autoRun?.summary?.skipped || 0} / ${autoRun?.summary?.failed || 0}`],
          ]} />
        </section>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="contacts">{copy.tabs.contacts}</TabsTrigger>
            <TabsTrigger value="accounting">{copy.tabs.accounting}</TabsTrigger>
            <TabsTrigger value="receipts">{copy.tabs.receipts}</TabsTrigger>
            <TabsTrigger value="automation">{copy.tabs.automation}</TabsTrigger>
            <TabsTrigger value="manual">{copy.tabs.manual}</TabsTrigger>
          </TabsList>

          <TabsContent value="contacts" className="space-y-4">
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <Kpi label={copy.contacts.kpis.active} value={hasLifecycleRun ? summary.nonArchivedXeroContacts : null} emptyLabel={copy.contacts.previewRequired} />
              <Kpi label={copy.contacts.kpis.archived} value={hasLifecycleRun ? summary.archivedXeroContacts : null} emptyLabel={copy.contacts.previewRequired} />
              <Kpi label={copy.contacts.kpis.unmatched} value={hasLifecycleRun ? summary.unmatchedNonArchivedXeroContacts : null} tone="amber" emptyLabel={copy.contacts.previewRequired} />
              <Kpi label={copy.contacts.kpis.rename} value={hasLifecycleRun ? summary.renameEligible : null} tone="sky" emptyLabel={copy.contacts.previewRequired} />
              <Kpi label={copy.contacts.kpis.archive} value={hasLifecycleRun ? summary.archiveEligible : null} tone="rose" emptyLabel={copy.contacts.previewRequired} />
              <Kpi label={copy.contacts.kpis.exceptions} value={hasLifecycleRun ? summary.exception : null} tone="slate" emptyLabel={copy.contacts.previewRequired} />
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold">{copy.contacts.title}</h2>
                  <p className="mt-1 max-w-4xl text-sm text-muted-foreground">{copy.contacts.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setFilters((current) => ({ ...current, unmatchedOnly: !current.unmatchedOnly }))}>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    {filters.unmatchedOnly ? copy.contacts.showAll : copy.contacts.showUnmatched}
                  </Button>
                  <Button type="button" onClick={previewLifecycle} disabled={busy === 'preview' || !xero.connected || !scopeFlags.contacts}>
                    {busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    {copy.contacts.preview}
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <Checkbox checked={forceUsageRefresh} onCheckedChange={(checked) => setForceUsageRefresh(checked === true)} />
                    {copy.contacts.fullUsage}
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <Checkbox checked={incrementalUsageRefresh} onCheckedChange={(checked) => setIncrementalUsageRefresh(checked === true)} disabled={forceUsageRefresh} />
                    {copy.contacts.incrementalUsage}
                  </label>
                  <AuditButton disabled={!run} onClick={() => downloadJson(run, `xero-contact-lifecycle-${run?.id || 'run'}.json`)} icon={FileJson}>{copy.contacts.jsonAudit}</AuditButton>
                  <AuditButton disabled={!run} onClick={() => downloadCsv(run?.rows || [], `xero-contact-lifecycle-${run?.id || 'run'}.csv`)} icon={Download}>{copy.contacts.csvAudit}</AuditButton>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground">{copy.contacts.callEstimate}</div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    <span>{copy.contacts.preview}: {hasLifecycleRun ? (run?.xeroCallEstimate?.previewActualCalls ?? 0) : copy.common.pending}</span>
                    <span>{copy.contacts.verify}: {hasLifecycleRun ? (run?.xeroCallEstimate?.applyVerifyCalls ?? 0) : copy.common.pending}</span>
                    <span>{copy.contacts.apply}: {hasLifecycleRun ? (run?.xeroCallEstimate?.applyMutationCalls ?? 0) : copy.common.pending}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-sm text-muted-foreground">
                {hasLifecycleRun
                  ? copy.contacts.lastRun(shortId(run.id), formatDateTime(run.createdAt, language), Number(run.rowCount || run.rows?.length || 0).toLocaleString(copy.locale))
                  : copy.contacts.noRun}
              </div>

              <UsageCache sources={status?.usageCache?.sources || run?.usageCache?.sources || []} copy={copy} language={language} />
              <StatusLegend labels={statusLabels} copy={copy} />
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="grid gap-2 md:grid-cols-5">
                <div className="relative md:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder={copy.contacts.search} className="pl-9" />
                </div>
                <NativeSelect value={filters.action} onChange={(action) => setFilters((current) => ({ ...current, action }))} options={actionOptions} />
                <NativeSelect value={filters.status} onChange={(statusValue) => setFilters((current) => ({ ...current, status: statusValue }))} options={statusOptions} />
                <NativeSelect value={filters.reason} onChange={(reason) => setFilters((current) => ({ ...current, reason }))} options={reasonOptions} />
              </div>

              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="text-sm text-muted-foreground">
                  {copy.contacts.showing(filteredRows.length.toLocaleString(copy.locale), totalSelectedCount.toLocaleString(copy.locale), selectedEligibleCount.toLocaleString(copy.locale))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={selectVisibleEligible} disabled={!filteredRows.some(canApplyRow)}>{copy.contacts.selectVisible}</Button>
                  <Button type="button" variant="outline" onClick={() => setSelectedRows(new Set())}>{copy.common.clear}</Button>
                  <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <Checkbox checked={reviewed} onCheckedChange={(checked) => setReviewed(checked === true)} />
                    {copy.contacts.reviewed}
                  </label>
                  <Button type="button" onClick={applyLifecycle} disabled={!run?.id || !reviewed || !selectedEligibleCount || busy === 'apply'}>
                    {busy === 'apply' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
                    {copy.contacts.applySelected}
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <Table scrollLabel={copy.contacts.tableLabel}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">{copy.common.use}</TableHead>
                      <TableHead>{copy.common.action}</TableHead>
                      <TableHead>{copy.common.status}</TableHead>
                      <TableHead>{copy.contacts.xeroContact}</TableHead>
                      <TableHead>{copy.contacts.salesforceSource}</TableHead>
                      <TableHead>{copy.contacts.match}</TableHead>
                      <TableHead>{copy.contacts.usage}</TableHead>
                      <TableHead>{copy.common.reason}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.length ? filteredRows.slice(0, 1000).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Checkbox checked={selectedRows.has(row.id)} onCheckedChange={(checked) => toggleRow(row.id, checked === true)} disabled={!canApplyRow(row)} />
                        </TableCell>
                        <TableCell><ActionBadge action={row.action} copy={copy} /></TableCell>
                        <TableCell><StatusBadgeText status={row.status} copy={copy} /></TableCell>
                        <TableCell className="min-w-[260px]">
                          <div className="font-medium">{row.xeroContactName || copy.contacts.noXeroMatch}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.xeroContactNumber || copy.contacts.noContactNumber} · {row.xeroAccountNumber || copy.contacts.noAccountNumber} · {row.xeroContactStatus || copy.contacts.noStatus}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-[260px]">
                          <div className="font-medium">{row.salesforceName || copy.contacts.noSalesforceMatch}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.salesforceCompanyCode || copy.common.noClKey} · {copy.recordTypes[row.salesforceRecordType] || row.salesforceRecordType || copy.common.noType}
                          </div>
                        </TableCell>
                        <TableCell>{row.matchField ? (copy.matchFields[row.matchField] || matchFieldLabels[row.matchField] || row.matchField) : copy.common.none}</TableCell>
                        <TableCell>{usageText(row.usage, copy)}</TableCell>
                        <TableCell className="max-w-[320px]">
                          <div className="font-medium">{copy.reasons[row.reason] || reasonLabels[row.reason] || row.reason || copy.common.noIssue}</div>
                          {row.message ? <div className="mt-1 text-xs text-muted-foreground">{row.message}</div> : null}
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={8}><StateBlock icon={CheckCircle2} title={hasLifecycleRun ? copy.contacts.noRowsTitle : copy.contacts.noPreviewTitle} description={hasLifecycleRun ? copy.contacts.noRowsDescription : copy.contacts.noPreviewDescription} /></TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="accounting" className="space-y-4">
            <Suspense fallback={<StateBlock icon={Loader2} title={copy.financial.loadingTitle} description={copy.financial.loadingDescription} />}>
              <XeroFinancialSync portalStatus={status} language={language} />
            </Suspense>
          </TabsContent>

          <TabsContent value="receipts" className="space-y-4">
            <section className="grid gap-4 xl:grid-cols-[480px_1fr]">
              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="text-base font-semibold">{copy.receipts.title}</h2>
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-muted-foreground">{copy.receipts.file}</span>
                    <span className="mt-1 flex min-h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-input bg-background px-3 py-1.5 text-sm shadow-sm">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{copy.receipts.chooseFile}</span>
                      <span className="min-w-0 truncate text-muted-foreground">{receiptFile?.name || copy.receipts.noFile}</span>
                    </span>
                    <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant="outline" onClick={runOcr} disabled={!receiptFile || ocrBusy}>
                      {ocrBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                      {copy.receipts.ocr}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setReceiptDraft(emptyReceiptFields())}>{copy.receipts.reset}</Button>
                  </div>
                  <Field label={copy.receipts.merchant} value={receiptDraft.merchant} onChange={(merchant) => setReceiptDraft((current) => ({ ...current, merchant }))} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label={copy.receipts.date} type="date" value={receiptDraft.date} onChange={(date) => setReceiptDraft((current) => ({ ...current, date }))} />
                    <Field label={copy.receipts.total} type="number" value={receiptDraft.total} onChange={(total) => setReceiptDraft((current) => ({ ...current, total }))} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <NativeSelect label={copy.receipts.currency} value={receiptDraft.currency} onChange={(currency) => setReceiptDraft((current) => ({ ...current, currency }))} options={RECEIPT_CURRENCIES.map((code) => [code, code])} />
                    <Field label={copy.receipts.account} value={receiptDraft.accountCode} onChange={(accountCode) => setReceiptDraft((current) => ({ ...current, accountCode }))} />
                    <Field label={copy.receipts.tax} value={receiptDraft.taxType} onChange={(taxType) => setReceiptDraft((current) => ({ ...current, taxType }))} />
                  </div>
                  <Field label={copy.receipts.category} value={receiptDraft.category} onChange={(category) => setReceiptDraft((current) => ({ ...current, category }))} />
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">{copy.receipts.notes}</label>
                    <Textarea value={receiptDraft.note} onChange={(event) => setReceiptDraft((current) => ({ ...current, note: event.target.value }))} rows={6} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => saveReceipt({ sync: false })} disabled={!receiptFile || busy === 'receipt-create'}>
                      {busy === 'receipt-create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      {copy.receipts.save}
                    </Button>
                    <Button type="button" onClick={() => saveReceipt({ sync: true })} disabled={!receiptFile || !xero.connected || !scopeFlags.invoices || !scopeFlags.attachments || busy === 'receipt-sync-create'}>
                      {busy === 'receipt-sync-create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      {copy.receipts.createBill}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="text-base font-semibold">{copy.receipts.auditTitle}</h2>
                <div className="mt-4">
                  <Table scrollLabel={copy.receipts.auditLabel}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{copy.receipts.receipt}</TableHead>
                        <TableHead>{copy.receipts.total}</TableHead>
                        <TableHead>{copy.receipts.status}</TableHead>
                        <TableHead>{copy.receipts.xero}</TableHead>
                        <TableHead>{copy.receipts.updated}</TableHead>
                        <TableHead>{copy.receipts.action}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receipts.map((receipt) => (
                        <TableRow key={receipt.id}>
                          <TableCell>
                            <div className="font-medium">{receipt.merchant}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{receipt.fileName} · {receipt.date}</div>
                          </TableCell>
                          <TableCell>{receipt.currency} {formatNumber(receipt.total)}</TableCell>
                          <TableCell><ReceiptStatusBadge status={receipt.status} copy={copy} /></TableCell>
                          <TableCell>
                            {receipt.xeroInvoiceUrl ? <a className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline" href={receipt.xeroInvoiceUrl} target="_blank" rel="noreferrer">{copy.receipts.draftBill} <ExternalLink className="h-3 w-3" /></a> : copy.receipts.notSynced}
                            {receipt.error ? <div className="mt-1 max-w-[260px] text-xs text-red-700">{receipt.error}</div> : null}
                          </TableCell>
                          <TableCell>{formatDateTime(receipt.updatedAt, language)}</TableCell>
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
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold">{copy.automation.title}</h2>
                  <p className="mt-1 max-w-4xl text-sm text-muted-foreground">{copy.automation.description}</p>
                </div>
                <div className="flex gap-2">
                  <AuditButton disabled={!autoRun} onClick={() => downloadJson(autoRun, `xero-contact-auto-create-${autoRun?.id || 'run'}.json`)} icon={FileJson}>{copy.contacts.jsonAudit}</AuditButton>
                  <AuditButton disabled={!autoRun} onClick={() => downloadCsv(autoRun?.rows || [], `xero-contact-auto-create-${autoRun?.id || 'run'}.csv`)} icon={Download}>{copy.contacts.csvAudit}</AuditButton>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <Kpi label={copy.automation.pending} value={autoRun?.summary?.pending || 0} tone="sky" />
                <Kpi label={copy.automation.created} value={autoRun?.summary?.created || 0} tone="emerald" />
                <Kpi label={copy.automation.alreadyExists} value={autoRun?.summary?.alreadyExists || autoRun?.summary?.['already-exists'] || 0} />
                <Kpi label={copy.automation.failed} value={autoRun?.summary?.failed || 0} tone="rose" />
              </div>
              <div className="mt-4">
                <Table scrollLabel={copy.automation.tableLabel}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{copy.common.status}</TableHead>
                      <TableHead>{copy.automation.salesforceAccount}</TableHead>
                      <TableHead>{copy.automation.xeroContact}</TableHead>
                      <TableHead>{copy.automation.match}</TableHead>
                      <TableHead>{copy.automation.reason}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(autoRun?.rows || []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell><StatusBadgeText status={row.status} copy={copy} /></TableCell>
                        <TableCell>
                          <div className="font-medium">{row.salesforceName || copy.automation.noAccount}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{row.salesforceCompanyCode || copy.common.noClKey} · {copy.recordTypes[row.salesforceRecordType] || row.salesforceRecordType || copy.common.noType}</div>
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
              <XeroPortalManual language={language} onLanguageChange={setLanguage} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ConnectionPanel({ title, rows, unavailable }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_1fr] gap-2 text-xs">
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
      <div className="text-xs font-semibold uppercase tracking-normal opacity-70">{label}</div>
      <div className={cn('mt-1 font-semibold', hasValue ? 'text-2xl' : 'text-sm')}>{hasValue ? number.toLocaleString() : emptyLabel}</div>
    </div>
  );
}

function UsageCache({ sources, copy, language }) {
  if (!sources?.length) return null;
  return (
    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {sources.map((source) => (
        <div key={source.source} className="rounded-lg border border-border bg-background/70 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold">{source.label}</span>
            <StatusBadgeText status={source.status} copy={copy} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {source.recordsScanned?.toLocaleString?.(copy.locale) || 0} {language === 'zh-Hant' ? '筆紀錄' : 'records'} · {source.contactCount?.toLocaleString?.(copy.locale) || 0} {language === 'zh-Hant' ? '個聯絡人' : 'contacts'}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(source.scannedAt, language)}</div>
        </div>
      ))}
    </div>
  );
}

function StatusLegend({ labels, copy }) {
  return (
    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {Object.entries(labels || {}).map(([status, description]) => (
        <div key={status} className="rounded-lg border border-border bg-background/70 px-3 py-2 text-xs">
          <div className="font-semibold text-foreground">{copy.statuses[status] || status.replaceAll('-', ' ')}</div>
          <div className="mt-1 text-muted-foreground">{copy.statusDescriptions[status] || description}</div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <Input type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NativeSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      {label ? <span className="text-xs font-semibold text-muted-foreground">{label}</span> : null}
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

function StatusBadgeText({ status, copy }) {
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
  return <Badge variant="outline" className={cn('whitespace-nowrap', tone)}>{copy?.statuses?.[value] || value.replaceAll('-', ' ')}</Badge>;
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

function ActionBadge({ action, copy }) {
  const icon = {
    archive: Archive,
    rename: RefreshCw,
    exception: AlertTriangle,
    keep: CheckCircle2,
  }[action] || ShieldCheck;
  const Icon = icon;
  return (
    <Badge variant="outline" className="whitespace-nowrap">
      <Icon className="mr-1 h-3 w-3" />
      {copy?.actions?.[action] || String(action || copy?.common?.unknown || 'unknown')}
    </Badge>
  );
}

function canApplyRow(row) {
  return row?.status === 'eligible' && (row.action === 'rename' || row.action === 'archive') && row.xeroContactId;
}

function usageText(usage = [], copy) {
  if (!usage.length) return copy.contacts.noReadableUsage;
  return usage.map((item) => `${copy.usageSources[item.source] || item.label || item.source}: ${item.records || 0}`).join('; ');
}

function summarizeApply(summary, language) {
  return language === 'zh-Hant'
    ? `已重新命名 ${summary.updated || 0} 個、已封存 ${summary.archived || 0} 個、失敗 ${summary.failed || 0} 個。`
    : `${summary.updated || 0} renamed, ${summary.archived || 0} archived, ${summary.failed || 0} failed.`;
}

function formatDateTime(value, language = 'en') {
  const unavailable = language === 'zh-Hant' ? '不可用' : 'Not available';
  if (!value) return unavailable;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return unavailable;
  return new Intl.DateTimeFormat(language === 'zh-Hant' ? 'zh-HK' : 'en-GB', {
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

async function fileToPayload(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
  });
  return {
    base64: dataUrl.replace(/^data:[^;]+;base64,/i, ''),
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
  };
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
