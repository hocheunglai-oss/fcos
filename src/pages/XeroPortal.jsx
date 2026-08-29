import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
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
import { cn } from '@/lib/utils';

const ACTION_OPTIONS = [
  ['all', 'All actions'],
  ['archive', 'Archive'],
  ['rename', 'Rename'],
  ['exception', 'Exceptions'],
  ['keep', 'Keep'],
];

const STATUS_OPTIONS = [
  ['all', 'All statuses'],
  ['eligible', 'Eligible'],
  ['blocked', 'Blocked'],
  ['kept', 'Kept'],
  ['not-selected', 'Not selected'],
  ['updated', 'Updated'],
  ['archived', 'Archived'],
  ['failed', 'Failed'],
];

const RECEIPT_CURRENCIES = ['HKD', 'USD', 'SGD', 'CNY', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'JPY'];
const XeroFinancialSync = lazy(() => import('@/components/xero/XeroFinancialSync'));

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
    if (xero === 'connected') toast({ title: 'Xero connected', description: 'FCOS can now read and update the connected Xero organisation.' });
    if (xero === 'error') toast({ title: 'Xero connection failed', description: message || 'Check the Xero app settings and try again.', variant: 'destructive' });
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
    return [['all', 'All reasons'], ...[...reasons].sort().map((reason) => [reason, reasonLabels[reason] || reason])];
  }, [reasonLabels, run]);

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
      toast({ title: 'Xero connection unavailable', description: result.data.error, variant: 'destructive' });
      return;
    }
    window.location.href = result.data.authorizationUrl;
  }

  async function disconnectXero() {
    setBusy('disconnect');
    const result = await appClient.functions.invoke('xeroPortalDisconnect', {}, { force: true, invalidateCache: true });
    setBusy('');
    if (result.data?.error) toast({ title: 'Disconnect failed', description: result.data.error, variant: 'destructive' });
    else {
      toast({ title: 'Xero disconnected' });
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
      toast({ title: 'Preview failed', description: result.data.error, variant: 'destructive' });
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
      toast({ title: 'Apply failed', description: result.data.error, variant: 'destructive' });
      return;
    }
    setRun(result.data.run);
    setSelectedRows(new Set());
    setReviewed(false);
    toast({ title: 'Xero contact changes applied', description: summarizeApply(result.data.run?.summary || {}) });
    await load({ force: true });
  }

  async function runOcr() {
    if (!receiptFile) return;
    if (!receiptFile.type.startsWith('image/')) {
      toast({ title: 'OCR supports image receipts', description: 'PDF receipts can still be saved and synced after entering the fields manually.', variant: 'destructive' });
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
      toast({ title: 'OCR failed', description: ocrError.message || 'Enter the receipt fields manually.', variant: 'destructive' });
    } finally {
      setOcrBusy(false);
    }
  }

  async function saveReceipt({ sync = false } = {}) {
    if (!receiptFile) {
      toast({ title: 'Receipt file required', description: 'Choose an image or PDF receipt first.', variant: 'destructive' });
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
      toast({ title: sync ? 'Receipt sync failed' : 'Receipt save failed', description: result.data.error, variant: 'destructive' });
      return;
    }
    setReceiptDraft(emptyReceiptFields());
    setReceiptFile(null);
    toast({ title: sync ? 'Receipt sent to Xero' : 'Receipt saved', description: sync ? 'A draft bill was created and the file attached.' : 'The receipt is stored in FCOS.' });
    await load({ force: true });
  }

  async function syncReceipt(id) {
    setBusy(`receipt-sync-${id}`);
    const result = await appClient.functions.invoke('xeroPortalReceiptSync', { id }, { force: true, invalidateCache: true });
    setBusy('');
    if (result.data?.error) toast({ title: 'Receipt sync failed', description: result.data.error, variant: 'destructive' });
    else toast({ title: 'Receipt sent to Xero', description: 'A draft bill was created and the file attached.' });
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
    return <div className="workspace-tools p-4 lg:p-6"><StateBlock icon={Loader2} title="Loading Xero Portal" description="FCOS is reading the Xero connection, receipt audit, and latest contact lifecycle run." /></div>;
  }

  return (
    <div className="workspace-tools min-h-full bg-background p-4 text-foreground lg:p-6">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-normal">Xero Portal</h1>
              <StatusBadge ok={xero.connected} trueLabel="Connected" falseLabel="Disconnected" />
              <StatusBadge ok={actionGate?.enabled} trueLabel="Xero writes enabled" falseLabel="Xero writes gated" tone={actionGate?.enabled ? 'emerald' : 'amber'} />
            </div>
            <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
              Finance-reviewed Salesforce accounting sync, receipt draft bills, Account contact sync, unused-contact review, and automation audit.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => load({ force: true })} disabled={Boolean(busy)}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
            {xero.connected ? (
              <>
                {needsFinancialReconnect ? (
                  <Button type="button" onClick={connectXero} disabled={busy === 'connect'}>
                    {busy === 'connect' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                    Reconnect scopes
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={disconnectXero} disabled={busy === 'disconnect'}>
                  {busy === 'disconnect' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                  Disconnect
                </Button>
              </>
            ) : (
              <Button type="button" onClick={connectXero} disabled={busy === 'connect' || !xero.configured}>
                {busy === 'connect' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                Connect Xero
              </Button>
            )}
          </div>
        </header>

        {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <section className="grid gap-3 lg:grid-cols-4">
          <ConnectionPanel title="Xero tenant" rows={[
            ['Organisation', xero.tenantName || 'Not connected'],
            ['Tenant ID', xero.tenantId || 'Not available'],
            ['Token expires', formatDateTime(xero.expiresAt)],
            ['Redirect URI', xero.redirectUri || 'Not configured'],
          ]} />
          <ConnectionPanel title="Xero scopes" rows={[
            ['Contacts', scopeFlags.contacts ? 'Available' : 'Missing'],
            ['Invoices', scopeFlags.invoices ? 'Available' : 'Missing'],
            ['Attachments', scopeFlags.attachments ? 'Available' : 'Missing'],
            ['Payments', scopeFlags.paymentsWrite ? 'Read / write' : scopeFlags.paymentsRead ? 'Read only' : 'Missing'],
            ['Accounting settings', scopeFlags.settingsRead ? 'Available' : 'Missing'],
          ]} />
          <ConnectionPanel title="Salesforce source" rows={[
            ['Auth', status?.salesforce?.authMode || 'Unknown'],
            ['Instance', hostname(status?.salesforce?.instanceUrl)],
            ['CL Key', 'HK* only'],
            ['Delivery from', status?.salesforce?.recentStemDeliveryFrom || '2025-01-01'],
          ]} />
          <ConnectionPanel title="Latest automation" rows={[
            ['Run', autoRun?.id ? shortId(autoRun.id) : 'No run'],
            ['Event', autoRun?.eventId || 'Not available'],
            ['Created', String(autoRun?.summary?.created || 0)],
            ['Skipped / failed', `${autoRun?.summary?.skipped || 0} / ${autoRun?.summary?.failed || 0}`],
          ]} />
        </section>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="accounting">Accounting Sync</TabsTrigger>
            <TabsTrigger value="receipts">Receipts</TabsTrigger>
            <TabsTrigger value="automation">Auto-Created Contacts</TabsTrigger>
          </TabsList>

          <TabsContent value="contacts" className="space-y-4">
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <Kpi label="Non-archived Xero" value={hasLifecycleRun ? summary.nonArchivedXeroContacts : null} />
              <Kpi label="Archived Xero" value={hasLifecycleRun ? summary.archivedXeroContacts : null} />
              <Kpi label="Unmatched active" value={hasLifecycleRun ? summary.unmatchedNonArchivedXeroContacts : null} tone="amber" />
              <Kpi label="Rename eligible" value={hasLifecycleRun ? summary.renameEligible : null} tone="sky" />
              <Kpi label="Archive eligible" value={hasLifecycleRun ? summary.archiveEligible : null} tone="rose" />
              <Kpi label="Exceptions" value={hasLifecycleRun ? summary.exception : null} tone="slate" />
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Contact Cleanup & Sync</h2>
                  <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
                    Matching uses Xero current name only: Salesforce Account name or the Salesforce CL Key after removing leading HK. ContactNumber and AccountNumber are reference fields only.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setFilters((current) => ({ ...current, unmatchedOnly: !current.unmatchedOnly }))}>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    {filters.unmatchedOnly ? 'Show all rows' : 'Show unmatched Xero'}
                  </Button>
                  <Button type="button" onClick={previewLifecycle} disabled={busy === 'preview' || !xero.connected || !scopeFlags.contacts}>
                    {busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Preview
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <Checkbox checked={forceUsageRefresh} onCheckedChange={(checked) => setForceUsageRefresh(checked === true)} />
                    Full usage refresh
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <Checkbox checked={incrementalUsageRefresh} onCheckedChange={(checked) => setIncrementalUsageRefresh(checked === true)} disabled={forceUsageRefresh} />
                    Incremental usage refresh
                  </label>
                  <AuditButton disabled={!run} onClick={() => downloadJson(run, `xero-contact-lifecycle-${run?.id || 'run'}.json`)} icon={FileJson}>JSON audit</AuditButton>
                  <AuditButton disabled={!run} onClick={() => downloadCsv(run?.rows || [], `xero-contact-lifecycle-${run?.id || 'run'}.csv`)} icon={Download}>CSV audit</AuditButton>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground">Xero call estimate</div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    <span>Preview: {hasLifecycleRun ? (run?.xeroCallEstimate?.previewActualCalls ?? 0) : 'Pending'}</span>
                    <span>Verify: {hasLifecycleRun ? (run?.xeroCallEstimate?.applyVerifyCalls ?? 0) : 'Pending'}</span>
                    <span>Apply: {hasLifecycleRun ? (run?.xeroCallEstimate?.applyMutationCalls ?? 0) : 'Pending'}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-sm text-muted-foreground">
                {hasLifecycleRun
                  ? `Last contact lifecycle run ${shortId(run.id)} loaded ${formatDateTime(run.createdAt)} with ${Number(run.rowCount || run.rows?.length || 0).toLocaleString()} audit rows.`
                  : 'No contact lifecycle preview has been generated in FCOS yet. The KPI cards and table will populate after Preview.'}
              </div>

              <UsageCache sources={status?.usageCache?.sources || run?.usageCache?.sources || []} />
              <StatusLegend labels={statusLabels} />
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="grid gap-2 md:grid-cols-5">
                <div className="relative md:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search Xero, Salesforce, CL Key" className="pl-9" />
                </div>
                <NativeSelect value={filters.action} onChange={(action) => setFilters((current) => ({ ...current, action }))} options={ACTION_OPTIONS} />
                <NativeSelect value={filters.status} onChange={(statusValue) => setFilters((current) => ({ ...current, status: statusValue }))} options={STATUS_OPTIONS} />
                <NativeSelect value={filters.reason} onChange={(reason) => setFilters((current) => ({ ...current, reason }))} options={reasonOptions} />
              </div>

              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {filteredRows.length.toLocaleString()} rows. Selected {totalSelectedCount.toLocaleString()} total, {selectedEligibleCount.toLocaleString()} visible eligible.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={selectVisibleEligible} disabled={!filteredRows.some(canApplyRow)}>Select visible eligible</Button>
                  <Button type="button" variant="outline" onClick={() => setSelectedRows(new Set())}>Clear</Button>
                  <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <Checkbox checked={reviewed} onCheckedChange={(checked) => setReviewed(checked === true)} />
                    Reviewed
                  </label>
                  <Button type="button" onClick={applyLifecycle} disabled={!run?.id || !reviewed || !selectedEligibleCount || busy === 'apply'}>
                    {busy === 'apply' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
                    Apply selected
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <Table scrollLabel="Xero contact lifecycle rows">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Use</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Xero contact</TableHead>
                      <TableHead>Salesforce source</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead>Usage</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.length ? filteredRows.slice(0, 1000).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Checkbox checked={selectedRows.has(row.id)} onCheckedChange={(checked) => toggleRow(row.id, checked === true)} disabled={!canApplyRow(row)} />
                        </TableCell>
                        <TableCell><ActionBadge action={row.action} /></TableCell>
                        <TableCell><StatusBadgeText status={row.status} /></TableCell>
                        <TableCell className="min-w-[260px]">
                          <div className="font-medium">{row.xeroContactName || 'No Xero match'}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.xeroContactNumber || 'No contact no.'} · {row.xeroAccountNumber || 'No account no.'} · {row.xeroContactStatus || 'No status'}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-[260px]">
                          <div className="font-medium">{row.salesforceName || 'No Salesforce match'}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.salesforceCompanyCode || 'No CL Key'} · {row.salesforceRecordType || 'No type'}
                          </div>
                        </TableCell>
                        <TableCell>{row.matchField ? (matchFieldLabels[row.matchField] || row.matchField) : 'None'}</TableCell>
                        <TableCell>{usageText(row.usage)}</TableCell>
                        <TableCell className="max-w-[320px]">
                          <div className="font-medium">{reasonLabels[row.reason] || row.reason || 'No issue'}</div>
                          {row.message ? <div className="mt-1 text-xs text-muted-foreground">{row.message}</div> : null}
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={8}><StateBlock icon={CheckCircle2} title={hasLifecycleRun ? 'No matching rows' : 'No lifecycle preview'} description={hasLifecycleRun ? 'Adjust filters or run a new preview.' : 'Run Preview to load Xero contacts, Salesforce matches, and archive exceptions.'} /></TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="accounting" className="space-y-4">
            <Suspense fallback={<StateBlock icon={Loader2} title="Loading accounting sync" description="FCOS is loading the Finance review workspace." />}>
              <XeroFinancialSync portalStatus={status} />
            </Suspense>
          </TabsContent>

          <TabsContent value="receipts" className="space-y-4">
            <section className="grid gap-4 xl:grid-cols-[480px_1fr]">
              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="text-base font-semibold">Scan Receipt</h2>
                <div className="mt-4 space-y-3">
                  <Input type="file" accept="image/*,application/pdf" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant="outline" onClick={runOcr} disabled={!receiptFile || ocrBusy}>
                      {ocrBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                      OCR image
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setReceiptDraft(emptyReceiptFields())}>Reset</Button>
                  </div>
                  <Field label="Merchant" value={receiptDraft.merchant} onChange={(merchant) => setReceiptDraft((current) => ({ ...current, merchant }))} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Date" type="date" value={receiptDraft.date} onChange={(date) => setReceiptDraft((current) => ({ ...current, date }))} />
                    <Field label="Total" type="number" value={receiptDraft.total} onChange={(total) => setReceiptDraft((current) => ({ ...current, total }))} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <NativeSelect label="Currency" value={receiptDraft.currency} onChange={(currency) => setReceiptDraft((current) => ({ ...current, currency }))} options={RECEIPT_CURRENCIES.map((code) => [code, code])} />
                    <Field label="Account" value={receiptDraft.accountCode} onChange={(accountCode) => setReceiptDraft((current) => ({ ...current, accountCode }))} />
                    <Field label="Tax" value={receiptDraft.taxType} onChange={(taxType) => setReceiptDraft((current) => ({ ...current, taxType }))} />
                  </div>
                  <Field label="Category" value={receiptDraft.category} onChange={(category) => setReceiptDraft((current) => ({ ...current, category }))} />
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Notes / OCR text</label>
                    <Textarea value={receiptDraft.note} onChange={(event) => setReceiptDraft((current) => ({ ...current, note: event.target.value }))} rows={6} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => saveReceipt({ sync: false })} disabled={!receiptFile || busy === 'receipt-create'}>
                      {busy === 'receipt-create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      Save draft
                    </Button>
                    <Button type="button" onClick={() => saveReceipt({ sync: true })} disabled={!receiptFile || !xero.connected || !scopeFlags.invoices || !scopeFlags.attachments || busy === 'receipt-sync-create'}>
                      {busy === 'receipt-sync-create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Create Xero draft bill
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="text-base font-semibold">Receipt Audit</h2>
                <div className="mt-4">
                  <Table scrollLabel="Receipt audit">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Receipt</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Xero</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead>Action</TableHead>
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
                          <TableCell><ReceiptStatusBadge status={receipt.status} /></TableCell>
                          <TableCell>
                            {receipt.xeroInvoiceUrl ? <a className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline" href={receipt.xeroInvoiceUrl} target="_blank" rel="noreferrer">Draft bill <ExternalLink className="h-3 w-3" /></a> : 'Not synced'}
                            {receipt.error ? <div className="mt-1 max-w-[260px] text-xs text-red-700">{receipt.error}</div> : null}
                          </TableCell>
                          <TableCell>{formatDateTime(receipt.updatedAt)}</TableCell>
                          <TableCell>
                            <Button type="button" size="sm" variant="outline" onClick={() => syncReceipt(receipt.id)} disabled={receipt.status === 'synced' || !xero.connected || !scopeFlags.invoices || !scopeFlags.attachments || busy === `receipt-sync-${receipt.id}`}>
                              {busy === `receipt-sync-${receipt.id}` ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
                              Sync
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!receipts.length ? <TableRow><TableCell colSpan={6}><StateBlock icon={FileText} title="No receipts stored" description="Upload a receipt to create the first draft audit row." /></TableCell></TableRow> : null}
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
                  <h2 className="text-base font-semibold">Salesforce Trigger Contact Creation</h2>
                  <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
                    FCOS records every signed Salesforce event that checks for newly used Account names missing from Xero.
                  </p>
                </div>
                <div className="flex gap-2">
                  <AuditButton disabled={!autoRun} onClick={() => downloadJson(autoRun, `xero-contact-auto-create-${autoRun?.id || 'run'}.json`)} icon={FileJson}>JSON audit</AuditButton>
                  <AuditButton disabled={!autoRun} onClick={() => downloadCsv(autoRun?.rows || [], `xero-contact-auto-create-${autoRun?.id || 'run'}.csv`)} icon={Download}>CSV audit</AuditButton>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <Kpi label="Pending" value={autoRun?.summary?.pending || 0} tone="sky" />
                <Kpi label="Created" value={autoRun?.summary?.created || 0} tone="emerald" />
                <Kpi label="Already exists" value={autoRun?.summary?.alreadyExists || autoRun?.summary?.['already-exists'] || 0} />
                <Kpi label="Failed" value={autoRun?.summary?.failed || 0} tone="rose" />
              </div>
              <div className="mt-4">
                <Table scrollLabel="Auto-created Xero contact rows">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Salesforce Account</TableHead>
                      <TableHead>Xero Contact</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(autoRun?.rows || []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell><StatusBadgeText status={row.status} /></TableCell>
                        <TableCell>
                          <div className="font-medium">{row.salesforceName || 'No Account'}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{row.salesforceCompanyCode || 'No CL Key'} · {row.salesforceRecordType || 'No type'}</div>
                        </TableCell>
                        <TableCell>{row.xeroContactName || row.xeroContactId || 'No Xero contact'}</TableCell>
                        <TableCell>{row.matchField ? (matchFieldLabels[row.matchField] || row.matchField) : 'None'}</TableCell>
                        <TableCell>{reasonLabels[row.reason] || row.reason || row.message || 'No issue'}</TableCell>
                      </TableRow>
                    ))}
                    {!autoRun?.rows?.length ? <TableRow><TableCell colSpan={5}><StateBlock icon={AlertTriangle} title="No automation audit run yet" description="A Salesforce trigger run will appear here after a signed event reaches FCOS." /></TableCell></TableRow> : null}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ConnectionPanel({ title, rows }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_1fr] gap-2 text-xs">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-medium" title={String(value || '')}>{value || 'Not available'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Kpi({ label, value, tone = 'neutral' }) {
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
      <div className={cn('mt-1 font-semibold', hasValue ? 'text-2xl' : 'text-sm')}>{hasValue ? number.toLocaleString() : 'Preview required'}</div>
    </div>
  );
}

function UsageCache({ sources }) {
  if (!sources?.length) return null;
  return (
    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {sources.map((source) => (
        <div key={source.source} className="rounded-lg border border-border bg-background/70 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold">{source.label}</span>
            <StatusBadgeText status={source.status} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {source.recordsScanned?.toLocaleString?.() || 0} records · {source.contactCount?.toLocaleString?.() || 0} contacts
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(source.scannedAt)}</div>
        </div>
      ))}
    </div>
  );
}

function StatusLegend({ labels }) {
  return (
    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {Object.entries(labels || {}).map(([status, description]) => (
        <div key={status} className="rounded-lg border border-border bg-background/70 px-3 py-2 text-xs">
          <div className="font-semibold capitalize text-foreground">{status.replaceAll('-', ' ')}</div>
          <div className="mt-1 text-muted-foreground">{description}</div>
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

function StatusBadgeText({ status }) {
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
  return <Badge variant="outline" className={cn('whitespace-nowrap capitalize', tone)}>{value.replaceAll('-', ' ')}</Badge>;
}

function ReceiptStatusBadge({ status }) {
  const ok = status === 'synced';
  const fail = status === 'failed';
  return (
    <Badge variant="outline" className={cn(
      ok && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      fail && 'border-rose-200 bg-rose-50 text-rose-700',
      !ok && !fail && 'border-slate-200 bg-slate-50 text-slate-700',
    )}>
      {status}
    </Badge>
  );
}

function ActionBadge({ action }) {
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
      {String(action || 'unknown')}
    </Badge>
  );
}

function canApplyRow(row) {
  return row?.status === 'eligible' && (row.action === 'rename' || row.action === 'archive') && row.xeroContactId;
}

function usageText(usage = []) {
  if (!usage.length) return 'No readable usage';
  return usage.map((item) => `${item.label || item.source}: ${item.records || 0}`).join('; ');
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

function hostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return value || 'Not configured';
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
