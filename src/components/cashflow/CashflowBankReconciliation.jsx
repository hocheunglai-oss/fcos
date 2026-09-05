import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import TableShell from '@/components/common/TableShell';
import StateBlock from '@/components/common/StateBlock';
import PaymentDataReliabilityBadge from '@/components/common/PaymentDataReliabilityBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

function money(value, currency = 'USD') {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function signedMoney(value, currency = 'USD') {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  const amount = Number(value);
  return `${amount > 0 ? '+' : ''}${money(amount, currency)}`;
}

function displayDate(value) {
  if (!value) return 'Not set';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function movementClass(value) {
  if (Number(value) > 0) return 'text-emerald-700';
  if (Number(value) < 0) return 'text-red-700';
  return 'text-muted-foreground';
}

function statusBadge(status) {
  if (status === 'confirmed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'suggested') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'ambiguous') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'dismissed') return 'border-slate-200 bg-slate-100 text-slate-600';
  return 'border-red-200 bg-red-50 text-red-700';
}

function emptyInstrument(accountId = '') {
  const today = new Date().toISOString().slice(0, 10);
  return {
    bankAccountId: accountId,
    instrumentType: 'term_deposit',
    reference: '',
    amount: '',
    expectedInterest: '',
    startDate: today,
    maturityDate: '',
    tenor: '1_week',
    status: 'active',
    rolloverExpected: false,
    note: '',
  };
}

function emptyPlannedMovement(accountId = '') {
  return {
    bankAccountId: accountId,
    category: 'general_expense',
    description: '',
    direction: 'outflow',
    amount: '',
    startDate: new Date().toISOString().slice(0, 10),
    recurrence: 'one_off',
    endDate: '',
    enabled: true,
  };
}

export default function CashflowBankReconciliation({ dateFrom, dateTo }) {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('liquidity');
  const [balanceDialog, setBalanceDialog] = useState(null);
  const [accountDialog, setAccountDialog] = useState(null);
  const [statement, setStatement] = useState({ bankAccountId: '', sourceFileName: '', csvText: '', preview: null });
  const [dismissDialog, setDismissDialog] = useState(null);
  const [instrumentDialog, setInstrumentDialog] = useState(null);
  const [plannedDialog, setPlannedDialog] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('cashflowBankOverview', { dateFrom, dateTo, bucket: 'daily' });
    if (!quiet) setLoading(false);
    if (response.data?.error) {
      setError(response.data.error);
      return;
    }
    setData(response.data || null);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const accounts = data?.accounts || [];
  const enabledAccounts = accounts.filter((account) => account.enabled);
  const ispAccounts = enabledAccounts.filter((account) => account.bankCode === 'ISP');
  const operatingAccounts = enabledAccounts.filter((account) => account.bankCode !== 'ISP');
  const selectedStatementAccount = accounts.find((account) => account.id === statement.bankAccountId) || null;
  const accountsByBank = useMemo(() => (
    ['UBS', 'DBS', 'ISP'].map((bankCode) => ({
      bankCode,
      profile: (data?.profiles || []).find((profile) => profile.code === bankCode),
      accounts: enabledAccounts.filter((account) => account.bankCode === bankCode),
    }))
  ), [data?.profiles, enabledAccounts]);

  const mutate = async (name, payload, successMessage) => {
    setBusy(name);
    const response = await appClient.functions.invoke(name, payload);
    setBusy('');
    if (response.data?.error) {
      toast({ title: 'Not saved', description: response.data.error, variant: 'destructive' });
      return false;
    }
    toast({ title: successMessage });
    appClient.functions.clearCache();
    await load({ quiet: true });
    return true;
  };

  const openBalance = (projection) => {
    const today = new Date().toISOString().slice(0, 10);
    const updatingToday = projection.balance?.balanceDate === today;
    setBalanceDialog({
      bankAccountId: projection.account.id,
      accountLabel: projection.account.accountLabel,
      currency: projection.account.currency,
      id: updatingToday ? projection.balance.id : null,
      revision: updatingToday ? projection.balance.revision : null,
      balanceDate: today,
      availableBalance: projection.balance?.availableBalance ?? '',
      ledgerBalance: projection.balance?.ledgerBalance ?? '',
      note: '',
    });
  };

  const saveBalance = async () => {
    const saved = await mutate('cashflowBankBalanceSave', balanceDialog, 'Bank balance saved');
    if (saved) setBalanceDialog(null);
  };

  const openAccount = (account) => setAccountDialog({ ...account });

  const saveAccount = async () => {
    const saved = await mutate('cashflowBankAccountSave', accountDialog, 'Bank routing saved');
    if (saved) setAccountDialog(null);
  };

  const readStatement = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2_000_000) {
      toast({ title: 'File too large', description: 'Use a CSV smaller than 2 MB.', variant: 'destructive' });
      return;
    }
    const csvText = await file.text();
    setStatement((current) => ({ ...current, sourceFileName: file.name, csvText, preview: null }));
  };

  const previewStatement = async () => {
    if (!statement.bankAccountId || !statement.csvText) return;
    setBusy('cashflowBankStatementPreview');
    const response = await appClient.functions.invoke('cashflowBankStatementPreview', {
      bankAccountId: statement.bankAccountId,
      csvText: statement.csvText,
    });
    setBusy('');
    if (response.data?.error) {
      toast({ title: 'Statement could not be read', description: response.data.error, variant: 'destructive' });
      return;
    }
    setStatement((current) => ({ ...current, preview: response.data.preview }));
  };

  const importStatement = async () => {
    const saved = await mutate('cashflowBankStatementImport', {
      bankAccountId: statement.bankAccountId,
      sourceFileName: statement.sourceFileName,
      csvText: statement.csvText,
      expectedSourceHash: statement.preview?.sourceHash,
    }, 'Bank statement imported');
    if (saved) setStatement({ bankAccountId: statement.bankAccountId, sourceFileName: '', csvText: '', preview: null });
  };

  const confirmMatch = async (entry) => {
    await mutate('cashflowBankMatchSave', {
      statementEntryId: entry.id,
      status: 'confirmed',
      salesforcePaymentId: entry.suggestedPayment?.id,
      revision: entry.savedMatch?.revision ?? null,
    }, 'Bank entry matched');
  };

  const dismissMatch = async () => {
    const saved = await mutate('cashflowBankMatchSave', {
      statementEntryId: dismissDialog.entry.id,
      status: 'dismissed',
      reason: dismissDialog.reason,
      revision: dismissDialog.entry.savedMatch?.revision ?? null,
    }, 'Bank entry dismissed');
    if (saved) setDismissDialog(null);
  };

  const openInstrument = (instrument = null) => {
    setInstrumentDialog(instrument ? { ...instrument } : emptyInstrument(ispAccounts[0]?.id || ''));
  };

  const saveInstrument = async () => {
    const saved = await mutate('cashflowLiquidityInstrumentSave', instrumentDialog, 'Treasury instrument saved');
    if (saved) setInstrumentDialog(null);
  };

  const openPlannedMovement = (movement = null) => {
    setPlannedDialog(movement ? { ...movement } : emptyPlannedMovement(operatingAccounts.find((account) => account.bankCode === 'DBS')?.id || operatingAccounts[0]?.id || ''));
  };

  const savePlannedMovement = async () => {
    const saved = await mutate('cashflowBankPlannedMovementSave', plannedDialog, 'Planned cash movement saved');
    if (saved) setPlannedDialog(null);
  };

  if (loading) {
    return <StateBlock icon={Loader2} title="Loading bank reconciliation…" description="Aligning bank evidence with Salesforce receipts, payments, and the selected cashflow horizon." />;
  }

  if (error) {
    return <StateBlock icon={AlertTriangle} title="Bank reconciliation unavailable" description={error} action={<Button onClick={() => load()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-border bg-card px-4 py-3 shadow-[var(--shadow-panel)]">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold"><Landmark className="h-4 w-4 text-blue-600" />Bank reconciliation</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Reviewed balances and bank evidence aligned to Salesforce cash movements. Currencies are never netted together.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PaymentDataReliabilityBadge excludedCount={data?.paymentDataReliability?.excludedLegacyRecordCount} />
          <Button variant="outline" onClick={() => load()} disabled={loading || Boolean(busy)}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
      </div>

      {(data?.forecastWarnings || []).length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{data.forecastWarnings.slice(0, 3).join(' ')}</span></div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="liquidity">Liquidity plan</TabsTrigger>
          <TabsTrigger value="statements">Bank statements</TabsTrigger>
          <TabsTrigger value="treasury">ISP deposits & guarantees</TabsTrigger>
        </TabsList>

        <TabsContent value="liquidity" className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-3">
            {accountsByBank.map(({ bankCode, profile, accounts: bankAccounts }) => (
              <div key={bankCode} className="material-panel rounded-[var(--radius-panel)] border border-border bg-card p-4 shadow-[var(--shadow-panel)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-blue-600" />{profile?.name || bankCode}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{profile?.purpose}</div>
                  </div>
                  <Badge variant="outline">{bankAccounts.map((row) => row.currency).join(' · ') || 'Not configured'}</Badge>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{profile?.notes}</p>
                <div className="mt-3 space-y-2">
                  {bankAccounts.map((account) => (
                    <button key={account.id} type="button" onClick={() => openAccount(account)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50">
                      <span><span className="font-medium">{account.accountLabel}</span>{account.isDefaultOperating && <span className="ml-2 text-xs text-blue-700">Forecast route</span>}</span>
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <TableShell title="Projected available liquidity" meta={`${displayDate(dateFrom)} to ${displayDate(dateTo)} · Guarantees shown as reserved liquidity, not cash movement`} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-[1180px] w-full text-sm">
                <thead className="bg-muted/35 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Bank account</th>
                    <th className="px-3 py-2">Latest balance</th>
                    <th className="px-3 py-2 text-right">Statement movement</th>
                    <th className="px-3 py-2 text-right">Forecast movement</th>
                    <th className="px-3 py-2 text-right">Planned operating cash</th>
                    <th className="px-3 py-2 text-right">Deposit movement</th>
                    <th className="px-3 py-2 text-right">Guarantee reserve</th>
                    <th className="px-3 py-2 text-right">Available at horizon</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.projections || []).map((row) => {
                    const currency = row.account.currency;
                    return (
                      <tr key={row.account.id} className="border-t border-border/70">
                        <td className="px-3 py-3"><div className="font-medium">{row.account.accountLabel}</div><div className="text-xs text-muted-foreground">{row.account.bankName} · {currency}{row.account.isDefaultOperating ? ' · Forecast route' : ''}</div></td>
                        <td className="px-3 py-3"><div className="font-medium tabular-nums">{money(row.projection.openingAvailable, currency)}</div><div className="text-xs text-muted-foreground">{row.projection.startDate ? `As at ${displayDate(row.projection.startDate)}` : 'Balance required'}</div></td>
                        <td className={cn('px-3 py-3 text-right font-medium tabular-nums', movementClass(row.projection.actualMovement))}>{signedMoney(row.projection.actualMovement, currency)}</td>
                        <td className={cn('px-3 py-3 text-right font-medium tabular-nums', movementClass(row.projection.forecastMovement))}>{signedMoney(row.projection.forecastMovement, currency)}</td>
                        <td className={cn('px-3 py-3 text-right font-medium tabular-nums', movementClass(row.projection.plannedMovement))}>{signedMoney(row.projection.plannedMovement, currency)}</td>
                        <td className={cn('px-3 py-3 text-right font-medium tabular-nums', movementClass(row.projection.instrumentMovement))}>{signedMoney(row.projection.instrumentMovement, currency)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-amber-700">{money(row.projection.guaranteeReserve, currency)}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(row.projection.projectedAvailableLiquidity, currency)}</td>
                        <td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => openBalance(row)}>Update balance</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data?.summary?.unallocatedForecastRows > 0 && (
              <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {data.summary.unallocatedForecastRows.toLocaleString()} forecast rows are not assigned because their currency has no single active operating route.
              </div>
            )}
          </TableShell>

          <TableShell title="Planned non-trading cash" meta="Add reviewed payroll, general expenses, tax, bank fees, or other operating cash not represented by Salesforce invoices" actions={<Button onClick={() => openPlannedMovement()} disabled={!operatingAccounts.length}><Plus className="mr-2 h-4 w-4" />Add planned cash</Button>} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-sm">
                <thead className="bg-muted/35 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Description</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Schedule</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
                <tbody>
                  {(data?.plannedMovements || []).map((movement) => {
                    const account = accounts.find((row) => row.id === movement.bankAccountId);
                    return <tr key={movement.id} className="border-t border-border/70"><td className="px-3 py-3 font-medium">{movement.description}</td><td className="px-3 py-3 capitalize">{movement.category.replaceAll('_', ' ')}</td><td className="px-3 py-3">{account?.accountLabel || 'Unavailable'}</td><td className={cn('px-3 py-3 text-right font-semibold tabular-nums', movement.direction === 'inflow' ? 'text-emerald-700' : 'text-red-700')}>{movement.direction === 'inflow' ? '+' : '−'}{money(movement.amount, account?.currency)}</td><td className="px-3 py-3"><div>{displayDate(movement.startDate)}</div><div className="text-xs capitalize text-muted-foreground">{movement.recurrence.replace('_', ' ')}{movement.endDate ? ` until ${displayDate(movement.endDate)}` : ''}</div></td><td className="px-3 py-3"><Badge variant="outline">{movement.enabled ? 'Active' : 'Disabled'}</Badge></td><td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => openPlannedMovement(movement)}>Edit</Button></td></tr>;
                  })}
                </tbody>
              </table>
              {!data?.plannedMovements?.length && <StateBlock title="No planned non-trading cash" description="Add only reviewed operating amounts that are absent from Salesforce AR/AP to avoid double counting." />}
            </div>
          </TableShell>
        </TabsContent>

        <TabsContent value="statements" className="space-y-4">
          <TableShell title="Import reviewed bank statement" meta="CSV only · FCOS stores structured entries and a source fingerprint, never the uploaded file" bodyClassName="p-4">
            <div className="grid gap-3 lg:grid-cols-[260px_1fr_auto_auto] lg:items-end">
              <div>
                <Label>Bank account</Label>
                <Select value={statement.bankAccountId} onValueChange={(bankAccountId) => setStatement((current) => ({ ...current, bankAccountId, preview: null }))}>
                  <SelectTrigger><SelectValue placeholder="Choose account" /></SelectTrigger>
                  <SelectContent>{enabledAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.accountLabel} · {account.currency}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Statement file</Label>
                <Input type="file" accept=".csv,text/csv,text/plain" onChange={readStatement} />
                {statement.sourceFileName && <p className="mt-1 text-xs text-muted-foreground">Selected: {statement.sourceFileName}</p>}
              </div>
              <Button variant="outline" disabled={!statement.bankAccountId || !statement.csvText || Boolean(busy)} onClick={previewStatement}>{busy === 'cashflowBankStatementPreview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Preview</Button>
              <Button disabled={!statement.preview || Boolean(busy)} onClick={importStatement}>{busy === 'cashflowBankStatementImport' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Import</Button>
            </div>
            {statement.preview && (
              <div className="mt-4 grid gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                <div><span className="text-muted-foreground">Account</span><div className="font-medium">{selectedStatementAccount?.accountLabel}</div></div>
                <div><span className="text-muted-foreground">Period</span><div className="font-medium">{displayDate(statement.preview.statementFrom)} – {displayDate(statement.preview.statementTo)}</div></div>
                <div><span className="text-muted-foreground">Rows</span><div className="font-medium tabular-nums">{statement.preview.summary.rowCount.toLocaleString()}</div></div>
                <div><span className="text-muted-foreground">Money in</span><div className="font-medium tabular-nums text-emerald-700">{money(statement.preview.summary.credits, statement.preview.currency)}</div></div>
                <div><span className="text-muted-foreground">Money out</span><div className="font-medium tabular-nums text-red-700">{money(statement.preview.summary.debits, statement.preview.currency)}</div></div>
                {statement.preview.summary.closingBalanceWarning && <p className="text-xs text-amber-800 sm:col-span-2 lg:col-span-5">{statement.preview.summary.closingBalanceWarning}</p>}
              </div>
            )}
          </TableShell>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['Confirmed', data?.summary?.confirmed, 'text-emerald-700'],
              ['Suggested', data?.summary?.suggested, 'text-blue-700'],
              ['Needs review', data?.summary?.ambiguous, 'text-amber-700'],
              ['Unmatched', data?.summary?.unmatched, 'text-red-700'],
              ['Dismissed', data?.summary?.dismissed, 'text-slate-600'],
            ].map(([label, value, color]) => <div key={label} className="rounded-xl border border-border bg-card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={cn('mt-1 text-xl font-semibold tabular-nums', color)}>{Number(value || 0).toLocaleString()}</div></div>)}
          </div>

          <TableShell title="Statement entries" meta={`${(data?.entries || []).length.toLocaleString()} entries in the selected period`} bodyClassName="p-0">
            <div className="max-h-[620px] overflow-auto">
              <table className="min-w-[1150px] w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Bank</th><th className="px-3 py-2">Reference / details</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Salesforce evidence</th><th className="px-3 py-2 text-right">Action</th></tr>
                </thead>
                <tbody>
                  {(data?.entries || []).map((entry) => (
                    <tr key={entry.id} className="border-t border-border/70 align-top">
                      <td className="whitespace-nowrap px-3 py-3">{displayDate(entry.bookingDate)}{entry.valueDate && entry.valueDate !== entry.bookingDate && <div className="text-xs text-muted-foreground">Value {displayDate(entry.valueDate)}</div>}</td>
                      <td className="whitespace-nowrap px-3 py-3"><div className="font-medium">{entry.accountLabel}</div><div className="text-xs text-muted-foreground">{entry.bankCode} · {entry.currency}</div></td>
                      <td className="min-w-[280px] px-3 py-3"><div className="font-medium">{entry.reference || 'No reference'}</div><div className="mt-0.5 text-xs text-muted-foreground">{entry.description || 'No description'}</div></td>
                      <td className={cn('whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums', movementClass(entry.amount))}><span className="inline-flex items-center gap-1">{entry.amount > 0 ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{signedMoney(entry.amount, entry.currency)}</span></td>
                      <td className="px-3 py-3"><Badge variant="outline" className={statusBadge(entry.reconciliationStatus)}>{entry.reconciliationStatus.replace('_', ' ')}</Badge>{entry.candidateCount > 1 && <div className="mt-1 text-xs text-muted-foreground">{entry.candidateCount} candidates</div>}</td>
                      <td className="min-w-[220px] px-3 py-3">{entry.savedMatch?.status === 'confirmed' ? <><div className="font-medium">{entry.savedMatch.salesforcePaymentName}</div><div className="text-xs text-muted-foreground">Confirmed {entry.savedMatch.reviewedAt ? displayDate(entry.savedMatch.reviewedAt) : ''}</div></> : entry.suggestedPayment ? <><div className="font-medium">{entry.suggestedPayment.name}</div><div className="text-xs text-muted-foreground">{displayDate(entry.suggestedPayment.date)} · {money(entry.suggestedPayment.amount, entry.suggestedPayment.currency)}</div></> : entry.savedMatch?.status === 'dismissed' ? <div className="text-xs text-muted-foreground">{entry.savedMatch.reason}</div> : <span className="text-muted-foreground">No exact suggestion</span>}</td>
                      <td className="px-3 py-3 text-right"><div className="flex justify-end gap-2">{entry.reconciliationStatus === 'suggested' && <Button size="sm" onClick={() => confirmMatch(entry)} disabled={Boolean(busy)}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Confirm</Button>}{!['confirmed', 'dismissed'].includes(entry.reconciliationStatus) && <Button size="sm" variant="outline" onClick={() => setDismissDialog({ entry, reason: '' })} disabled={Boolean(busy)}>Dismiss</Button>}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data?.entries?.length && <StateBlock title="No statement entries" description="Import a bank CSV for the selected period to begin reconciliation." />}
            </div>
          </TableShell>
        </TabsContent>

        <TabsContent value="treasury" className="space-y-4">
          <TableShell title="Intesa Sanpaolo liquidity instruments" meta="Term deposits affect dated cash movement; guarantees reserve liquidity without pretending money has moved" actions={<Button onClick={() => openInstrument()} disabled={!ispAccounts.length}><ShieldCheck className="mr-2 h-4 w-4" />Add instrument</Button>} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-[920px] w-full text-sm">
                <thead className="bg-muted/35 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Start</th><th className="px-3 py-2">Maturity</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
                <tbody>
                  {(data?.instruments || []).map((instrument) => {
                    const account = accounts.find((row) => row.id === instrument.bankAccountId);
                    return <tr key={instrument.id} className="border-t border-border/70"><td className="px-3 py-3 font-medium">{instrument.instrumentType === 'term_deposit' ? 'Fixed-term deposit' : 'Bank guarantee'}</td><td className="px-3 py-3">{instrument.reference}</td><td className="px-3 py-3">{account?.accountLabel || 'Unavailable'}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{money(instrument.amount, account?.currency)}</td><td className="px-3 py-3">{displayDate(instrument.startDate)}</td><td className="px-3 py-3">{displayDate(instrument.maturityDate)}</td><td className="px-3 py-3"><Badge variant="outline">{instrument.status}</Badge></td><td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => openInstrument(instrument)}>Edit</Button></td></tr>;
                  })}
                </tbody>
              </table>
              {!data?.instruments?.length && <StateBlock title="No deposits or guarantees" description="Add reviewed ISP instruments to include placements, maturities, and reserved guarantee capacity in the liquidity plan." />}
            </div>
          </TableShell>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(balanceDialog)} onOpenChange={(open) => !open && !busy && setBalanceDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update {balanceDialog?.accountLabel}</DialogTitle><DialogDescription>Record a dated reviewed bank balance. Newer dates become the projection starting point.</DialogDescription></DialogHeader>
          {balanceDialog && <div className="grid gap-3 sm:grid-cols-2"><div><Label>Balance date</Label><Input type="date" value={balanceDialog.balanceDate} onChange={(event) => setBalanceDialog((current) => ({ ...current, balanceDate: event.target.value }))} /></div><div><Label>Currency</Label><Input value={balanceDialog.currency} disabled /></div><div><Label>Available balance</Label><Input type="number" step="0.01" value={balanceDialog.availableBalance} onChange={(event) => setBalanceDialog((current) => ({ ...current, availableBalance: event.target.value }))} /></div><div><Label>Ledger balance (optional)</Label><Input type="number" step="0.01" value={balanceDialog.ledgerBalance} onChange={(event) => setBalanceDialog((current) => ({ ...current, ledgerBalance: event.target.value }))} /></div><div className="sm:col-span-2"><Label>Review note (optional)</Label><Textarea rows={3} value={balanceDialog.note} onChange={(event) => setBalanceDialog((current) => ({ ...current, note: event.target.value }))} /></div></div>}
          <DialogFooter><Button variant="outline" onClick={() => setBalanceDialog(null)} disabled={Boolean(busy)}>Cancel</Button><Button onClick={saveBalance} disabled={Boolean(busy) || !balanceDialog?.balanceDate || balanceDialog?.availableBalance === ''}>{busy === 'cashflowBankBalanceSave' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save balance</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(accountDialog)} onOpenChange={(open) => !open && !busy && setAccountDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bank routing</DialogTitle><DialogDescription>Use one default operating account per currency. ISP remains treasury-only.</DialogDescription></DialogHeader>
          {accountDialog && <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div><Label>Bank</Label><Input value={accountDialog.bankName} disabled /></div><div><Label>Currency</Label><Input value={accountDialog.currency} disabled /></div></div><div><Label>Account label</Label><Input value={accountDialog.accountLabel} onChange={(event) => setAccountDialog((current) => ({ ...current, accountLabel: event.target.value }))} /></div><div><Label>Xero bank account name (optional)</Label><Input value={accountDialog.xeroBankAccountName || ''} onChange={(event) => setAccountDialog((current) => ({ ...current, xeroBankAccountName: event.target.value }))} /></div><label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm"><Checkbox checked={accountDialog.isDefaultOperating} disabled={accountDialog.bankCode === 'ISP'} onCheckedChange={(checked) => setAccountDialog((current) => ({ ...current, isDefaultOperating: checked === true }))} /><span><span className="font-medium">Use as the {accountDialog.currency} forecast route</span><span className="mt-0.5 block text-xs text-muted-foreground">Projected Salesforce movements are allocated only when exactly one active route exists for the currency.</span></span></label><label className="flex items-center gap-2 text-sm"><Checkbox checked={accountDialog.enabled} onCheckedChange={(checked) => setAccountDialog((current) => ({ ...current, enabled: checked === true }))} />Active account</label></div>}
          <DialogFooter><Button variant="outline" onClick={() => setAccountDialog(null)} disabled={Boolean(busy)}>Cancel</Button><Button onClick={saveAccount} disabled={Boolean(busy) || !accountDialog?.accountLabel?.trim()}>{busy === 'cashflowBankAccountSave' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save routing</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(dismissDialog)} onOpenChange={(open) => !open && !busy && setDismissDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dismiss bank entry</DialogTitle><DialogDescription>This keeps the bank evidence but marks it as not matching a Salesforce Payment.</DialogDescription></DialogHeader>
          <div><Label>Reason</Label><Textarea rows={4} value={dismissDialog?.reason || ''} onChange={(event) => setDismissDialog((current) => ({ ...current, reason: event.target.value }))} placeholder="At least 5 characters" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setDismissDialog(null)} disabled={Boolean(busy)}>Cancel</Button><Button onClick={dismissMatch} disabled={Boolean(busy) || (dismissDialog?.reason || '').trim().length < 5}>{busy === 'cashflowBankMatchSave' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Dismiss entry</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(instrumentDialog)} onOpenChange={(open) => !open && !busy && setInstrumentDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{instrumentDialog?.id ? 'Edit' : 'Add'} ISP instrument</DialogTitle><DialogDescription>Record reviewed fixed-term deposits or guarantees. This does not create or amend a bank transaction.</DialogDescription></DialogHeader>
          {instrumentDialog && <div className="grid gap-3 sm:grid-cols-2"><div><Label>ISP account</Label><Select value={instrumentDialog.bankAccountId} onValueChange={(bankAccountId) => setInstrumentDialog((current) => ({ ...current, bankAccountId }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ispAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.accountLabel} · {account.currency}</SelectItem>)}</SelectContent></Select></div><div><Label>Type</Label><Select value={instrumentDialog.instrumentType} onValueChange={(instrumentType) => setInstrumentDialog((current) => ({ ...current, instrumentType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="term_deposit">Fixed-term deposit</SelectItem><SelectItem value="bank_guarantee">Bank guarantee</SelectItem></SelectContent></Select></div><div className="sm:col-span-2"><Label>Reference</Label><Input value={instrumentDialog.reference} onChange={(event) => setInstrumentDialog((current) => ({ ...current, reference: event.target.value }))} /></div><div><Label>Amount</Label><Input type="number" min="0" step="0.01" value={instrumentDialog.amount} onChange={(event) => setInstrumentDialog((current) => ({ ...current, amount: event.target.value }))} /></div><div><Label>Status</Label><Select value={instrumentDialog.status} onValueChange={(status) => setInstrumentDialog((current) => ({ ...current, status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="planned">Planned</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="matured">Matured</SelectItem><SelectItem value="released">Released</SelectItem><SelectItem value="called">Called</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select></div><div><Label>Start date</Label><Input type="date" value={instrumentDialog.startDate} onChange={(event) => setInstrumentDialog((current) => ({ ...current, startDate: event.target.value }))} /></div><div><Label>Maturity / expiry</Label><Input type="date" value={instrumentDialog.maturityDate || ''} onChange={(event) => setInstrumentDialog((current) => ({ ...current, maturityDate: event.target.value }))} /></div>{instrumentDialog.instrumentType === 'term_deposit' && <><div><Label>Tenor</Label><Select value={instrumentDialog.tenor || 'custom'} onValueChange={(tenor) => setInstrumentDialog((current) => ({ ...current, tenor }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1_week">1 week</SelectItem><SelectItem value="2_week">2 weeks</SelectItem><SelectItem value="1_month">1 month</SelectItem><SelectItem value="custom">Custom</SelectItem></SelectContent></Select></div><div><Label>Expected interest</Label><Input type="number" min="0" step="0.01" value={instrumentDialog.expectedInterest || ''} onChange={(event) => setInstrumentDialog((current) => ({ ...current, expectedInterest: event.target.value }))} /></div><label className="sm:col-span-2 flex items-center gap-2 text-sm"><Checkbox checked={instrumentDialog.rolloverExpected} onCheckedChange={(checked) => setInstrumentDialog((current) => ({ ...current, rolloverExpected: checked === true }))} />Expected to roll over at maturity</label></>}<div className="sm:col-span-2"><Label>Review note (optional)</Label><Textarea rows={3} value={instrumentDialog.note || ''} onChange={(event) => setInstrumentDialog((current) => ({ ...current, note: event.target.value }))} /></div></div>}
          <DialogFooter><Button variant="outline" onClick={() => setInstrumentDialog(null)} disabled={Boolean(busy)}>Cancel</Button><Button onClick={saveInstrument} disabled={Boolean(busy) || !instrumentDialog?.bankAccountId || !instrumentDialog?.reference?.trim() || !instrumentDialog?.amount || !instrumentDialog?.startDate || (instrumentDialog?.instrumentType === 'term_deposit' && !instrumentDialog?.maturityDate)}>{busy === 'cashflowLiquidityInstrumentSave' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save instrument</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(plannedDialog)} onOpenChange={(open) => !open && !busy && setPlannedDialog(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{plannedDialog?.id ? 'Edit' : 'Add'} planned operating cash</DialogTitle><DialogDescription>Use this only for reviewed cash not already represented by Salesforce buyer or supplier invoices.</DialogDescription></DialogHeader>
          {plannedDialog && <div className="grid gap-3 sm:grid-cols-2"><div><Label>UBS / DBS account</Label><Select value={plannedDialog.bankAccountId} onValueChange={(bankAccountId) => setPlannedDialog((current) => ({ ...current, bankAccountId }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{operatingAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.accountLabel} · {account.currency}</SelectItem>)}</SelectContent></Select></div><div><Label>Category</Label><Select value={plannedDialog.category} onValueChange={(category) => setPlannedDialog((current) => ({ ...current, category }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="general_expense">General expense</SelectItem><SelectItem value="payroll">Payroll</SelectItem><SelectItem value="tax">Tax</SelectItem><SelectItem value="bank_fee">Bank fee</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="sm:col-span-2"><Label>Description</Label><Input value={plannedDialog.description} onChange={(event) => setPlannedDialog((current) => ({ ...current, description: event.target.value }))} /></div><div><Label>Direction</Label><Select value={plannedDialog.direction} onValueChange={(direction) => setPlannedDialog((current) => ({ ...current, direction }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="outflow">Money out</SelectItem><SelectItem value="inflow">Money in</SelectItem></SelectContent></Select></div><div><Label>Amount</Label><Input type="number" min="0" step="0.01" value={plannedDialog.amount} onChange={(event) => setPlannedDialog((current) => ({ ...current, amount: event.target.value }))} /></div><div><Label>First date</Label><Input type="date" value={plannedDialog.startDate} onChange={(event) => setPlannedDialog((current) => ({ ...current, startDate: event.target.value }))} /></div><div><Label>Repeat</Label><Select value={plannedDialog.recurrence} onValueChange={(recurrence) => setPlannedDialog((current) => ({ ...current, recurrence }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one_off">One-off</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent></Select></div>{plannedDialog.recurrence !== 'one_off' && <div><Label>End date (optional)</Label><Input type="date" value={plannedDialog.endDate || ''} onChange={(event) => setPlannedDialog((current) => ({ ...current, endDate: event.target.value }))} /></div>}<label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox checked={plannedDialog.enabled} onCheckedChange={(checked) => setPlannedDialog((current) => ({ ...current, enabled: checked === true }))} />Include in liquidity forecast</label></div>}
          <DialogFooter><Button variant="outline" onClick={() => setPlannedDialog(null)} disabled={Boolean(busy)}>Cancel</Button><Button onClick={savePlannedMovement} disabled={Boolean(busy) || !plannedDialog?.bankAccountId || !plannedDialog?.description?.trim() || !plannedDialog?.amount || !plannedDialog?.startDate}>{busy === 'cashflowBankPlannedMovementSave' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save planned cash</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
