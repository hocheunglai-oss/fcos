import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  HandCoins,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import PageMethodology from '@/components/common/PageMethodology';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { accountClKeyLabel, accountSearchDisplayText } from '@/lib/accountDisplay';
import { UNOFFICIAL_COMPENSATION_METHODOLOGY } from '@/lib/pageMethodologies';

const EMPTY_CLAIM = { accountId: '', contactId: '__none__', amount: '', deadlineDate: '', pic: '', description: '' };
const EMPTY_RECOVERY = { claimId: '', stemKeyword: '', stemId: '', lineItemId: '', fixed: false, unitPrice: '', lumpSumPrice: '' };

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
}

function formatMoney(value, currency = 'USD') {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat('en-HK', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatDateTime(value) {
  if (!value) return 'None';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong' }).format(date);
}

function claimDisplayLabel(claim) {
  return `Agreed Compensation · ${formatDate(claim?.deadlineDate)}`;
}

function recoveryDisplayLabel(recovery) {
  return `UOC Recovery · ${recovery?.stemName || 'STEM not set'}`;
}

function latestClaimChange(account, contactId) {
  return account.groups
    .filter((group) => (group.contactId || '') === (contactId || ''))
    .flatMap((group) => group.claims)
    .map((claim) => claim.lastModifiedAt || '')
    .sort()
    .at(-1) || '';
}

function accountSearchText(account) {
  return [account.accountName, account.clKey, account.pics?.join(' '), ...account.groups.flatMap((group) => [group.contactName, ...group.claims.map((claim) => claim.pic), ...group.recoveries.map((row) => `${row.stemName} ${row.productName}`)])].join(' ').toLowerCase();
}

function currencyLines(account, field) {
  return account.currencyTotals.map((row) => <div key={`${field}:${row.currencyIsoCode}`} className="whitespace-nowrap tabular-nums">{formatMoney(row[field], row.currencyIsoCode)}</div>);
}

function SummaryMetric({ label, value, tone = 'normal' }) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={tone === 'warning' ? 'mt-1 text-xl font-semibold tabular-nums text-amber-700' : 'mt-1 text-xl font-semibold tabular-nums text-foreground'}>{value}</div>
    </div>
  );
}

function SalesforceRecordLink({ instanceUrl, id, children }) {
  if (!instanceUrl || !id) return children;
  return <a href={`${instanceUrl}/${id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline">{children}<ExternalLink className="h-3.5 w-3.5" /></a>;
}

export default function UnofficialCompensation() {
  const { toast } = useToast();
  const [workspace, setWorkspace] = useState({ accounts: [], summary: { currencyTotals: [] } });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('outstanding');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [options, setOptions] = useState({ accounts: [], picOptions: [] });
  const [claimDialog, setClaimDialog] = useState(false);
  const [claimDraft, setClaimDraft] = useState(EMPTY_CLAIM);
  const [contacts, setContacts] = useState([]);
  const [recoveryDialog, setRecoveryDialog] = useState(null);
  const [recoveryDraft, setRecoveryDraft] = useState(EMPTY_RECOVERY);
  const [stemOptions, setStemOptions] = useState([]);
  const [stemContext, setStemContext] = useState(null);
  const [statusDialog, setStatusDialog] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('unofficialCompensationList', { force }, { force });
    if (response.data?.error) setError(response.data.error);
    else setWorkspace(response.data || { accounts: [], summary: { currencyTotals: [] } });
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  const visibleAccounts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (workspace.accounts || []).filter((account) => {
      if (view === 'outstanding' && account.balanceState !== 'outstanding') return false;
      if (view === 'closed' && account.balanceState === 'outstanding') return false;
      if (view === 'issues' && !account.issues?.length) return false;
      return !keyword || accountSearchText(account).includes(keyword);
    });
  }, [search, view, workspace.accounts]);

  const ensureOptions = async () => {
    if (options.accounts.length) return options;
    const response = await appClient.functions.invoke('unofficialCompensationOptions', { mode: 'bootstrap' });
    if (response.data?.error) throw new Error(response.data.error);
    const next = response.data || { accounts: [], picOptions: [] };
    setOptions(next);
    return next;
  };

  const loadContacts = async (accountId) => {
    setContacts([]);
    if (!accountId) return;
    const response = await appClient.functions.invoke('unofficialCompensationOptions', { mode: 'contacts', accountId });
    if (response.data?.error) throw new Error(response.data.error);
    setContacts(response.data.contacts || []);
  };

  const openClaim = async (accountId = '') => {
    try {
      const loaded = await ensureOptions();
      const nextAccountId = accountId && loaded.accounts.some((row) => row.accountId === accountId) ? accountId : '';
      setClaimDraft({ ...EMPTY_CLAIM, accountId: nextAccountId });
      if (nextAccountId) await loadContacts(nextAccountId);
      setClaimDialog(true);
    } catch (loadError) {
      toast({ title: 'Unable to open claim form', description: loadError.message, variant: 'destructive' });
    }
  };

  const saveClaim = async () => {
    setSaving(true);
    const response = await appClient.functions.invoke('unofficialCompensationClaimCreate', {
      ...claimDraft,
      contactId: claimDraft.contactId === '__none__' ? null : claimDraft.contactId,
      amount: Number(claimDraft.amount),
      operationId: operationId(),
    });
    setSaving(false);
    if (response.data?.error) return toast({ title: 'Claim not created', description: response.data.error, variant: 'destructive' });
    setClaimDialog(false);
    toast({ title: 'Claim opened in Salesforce' });
    load(true);
  };

  const searchStems = async () => {
    const response = await appClient.functions.invoke('unofficialCompensationOptions', { mode: 'stem_search', keyword: recoveryDraft.stemKeyword });
    if (response.data?.error) return toast({ title: 'STEM search failed', description: response.data.error, variant: 'destructive' });
    setStemOptions(response.data.stems || []);
  };

  const selectStem = async (stemId) => {
    setRecoveryDraft((current) => ({ ...current, stemId, lineItemId: '' }));
    setStemContext(null);
    const response = await appClient.functions.invoke('unofficialCompensationOptions', { mode: 'stem_detail', stemId });
    if (response.data?.error) return toast({ title: 'STEM not available', description: response.data.error, variant: 'destructive' });
    setStemContext(response.data);
  };

  const openRecovery = (account, group) => {
    const firstClaim = group.claims.find((claim) => claim.status === 'Opened');
    setRecoveryDialog({ account, group });
    setRecoveryDraft({ ...EMPTY_RECOVERY, claimId: firstClaim?.id || '' });
    setStemOptions([]);
    setStemContext(null);
  };

  const selectedRecoveryLine = stemContext?.lineItems?.find((line) => line.lineItemId === recoveryDraft.lineItemId);
  const recoveryPreview = recoveryDraft.fixed
    ? Number(recoveryDraft.lumpSumPrice || 0)
    : Math.abs(Number(selectedRecoveryLine?.deliveredQuantity || 0)) >= 0.005
      ? Math.abs(Number(selectedRecoveryLine.deliveredQuantity) * Number(recoveryDraft.unitPrice || 0))
      : Math.abs(Number(selectedRecoveryLine?.quantity || 0) * Number(recoveryDraft.unitPrice || 0));
  const selectedClaim = recoveryDialog?.group.claims.find((claim) => claim.id === recoveryDraft.claimId);
  const selectedStemAccount = stemContext?.eligibleAccounts?.find((account) => account.accountId === recoveryDialog?.account.accountId);
  const selectedStemClaimIsEligible = selectedStemAccount?.claims?.some((claim) => claim.claimId === recoveryDraft.claimId);

  const saveRecovery = async () => {
    setSaving(true);
    const response = await appClient.functions.invoke('unofficialCompensationRecoveryCreate', {
      operationId: operationId(),
      stemId: recoveryDraft.stemId,
      lineItemId: recoveryDraft.lineItemId,
      accountId: recoveryDialog.account.accountId,
      claimId: recoveryDraft.claimId,
      fixed: recoveryDraft.fixed,
      unitPrice: recoveryDraft.fixed ? null : Number(recoveryDraft.unitPrice),
      lumpSumPrice: recoveryDraft.fixed ? Number(recoveryDraft.lumpSumPrice) : null,
    });
    setSaving(false);
    if (response.data?.error) return toast({ title: 'Recovery not recorded', description: response.data.error, variant: 'destructive' });
    setRecoveryDialog(null);
    toast({ title: 'UOC recovery recorded in Salesforce' });
    load(true);
  };

  const changeGroupStatus = async () => {
    const { account, group, status } = statusDialog;
    setSaving(true);
    const response = await appClient.functions.invoke('unofficialCompensationClaimGroupStatus', {
      operationId: operationId(),
      accountId: account.accountId,
      contactId: group.contactId,
      status,
      reason,
      expectedLastModifiedAt: latestClaimChange(account, group.contactId),
    });
    setSaving(false);
    if (response.data?.error) return toast({ title: 'Status not changed', description: response.data.error, variant: 'destructive' });
    setStatusDialog(null);
    setReason('');
    toast({ title: `Claims ${status === 'Opened' ? 'opened' : 'closed'} in Salesforce` });
    load(true);
  };

  const deleteRecovery = async () => {
    setSaving(true);
    const response = await appClient.functions.invoke('unofficialCompensationRecoveryDelete', {
      operationId: operationId(),
      recoveryId: deleteDialog.recovery.id,
      expectedLastModifiedAt: deleteDialog.recovery.lastModifiedAt,
      reason,
    });
    setSaving(false);
    if (response.data?.error) return toast({ title: 'Recovery not deleted', description: response.data.error, variant: 'destructive' });
    setDeleteDialog(null);
    setDeleteConfirmed(false);
    setReason('');
    toast({ title: 'Erroneous UOC recovery deleted' });
    load(true);
  };

  const toggleExpanded = (accountId) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
    return next;
  });

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        icon={CircleDollarSign}
        title="Unofficial Compensation"
        meta={workspace.fetchedAt ? `Salesforce data retrieved ${formatDateTime(workspace.fetchedAt)}` : undefined}
        actions={<><PageMethodology {...UNOFFICIAL_COMPENSATION_METHODOLOGY} /><Button type="button" variant="outline" className="gap-2" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />Refresh</Button><Button type="button" className="gap-2" onClick={() => openClaim()}><Plus className="h-4 w-4" />Open Claim</Button></>}
      />

      <div className="grid divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <SummaryMetric label="Outstanding Accounts" value={workspace.summary?.outstandingAccountCount || 0} />
        <SummaryMetric label="Overdue Claims" value={workspace.summary?.overdueAccountCount || 0} tone="warning" />
        <SummaryMetric label="Due Within 7 Days" value={workspace.summary?.dueWithinSevenDaysCount || 0} />
        <SummaryMetric label="Data Issues" value={workspace.summary?.dataIssueCount || 0} tone="warning" />
      </div>

      {!!workspace.summary?.currencyTotals?.length && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-y py-3 text-sm">
          <span className="font-medium text-muted-foreground">Outstanding by currency</span>
          {workspace.summary.currencyTotals.map((row) => <span key={row.currencyIsoCode} className="font-semibold tabular-nums">{formatMoney(row.outstandingAmount, row.currencyIsoCode)}</span>)}
        </div>
      )}

      <TableShell
        title="Compensation Accounts"
        meta={`${visibleAccounts.length} Account${visibleAccounts.length === 1 ? '' : 's'}`}
        actions={<div className="relative min-w-[260px]"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Account, CL Key, PIC, Contact or STEM" /></div>}
        bodyClassName="p-0"
      >
        <div className="border-b px-4 py-3">
          <Tabs value={view} onValueChange={setView}><TabsList><TabsTrigger value="outstanding">Outstanding Accounts</TabsTrigger><TabsTrigger value="closed">Closed / Settled</TabsTrigger><TabsTrigger value="issues">Data Issues</TabsTrigger></TabsList></Tabs>
        </div>
        {loading ? <StateBlock icon={Loader2} title="Loading Salesforce compensation records" description="Claims and recoveries are being reconciled by Account, Contact, and currency." /> : error ? <StateBlock icon={AlertTriangle} title="Unofficial Compensation unavailable" description={error} action={<Button type="button" variant="outline" onClick={() => load(true)}>Try again</Button>} /> : !visibleAccounts.length ? <StateBlock icon={CheckCircle2} title="No matching Accounts" description="No Accounts match this view and search." /> : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1280px]">
              <TableHeader><TableRow><TableHead className="w-10" /><TableHead>Account / CL Key</TableHead><TableHead>PIC</TableHead><TableHead className="text-right">Agreed</TableHead><TableHead className="text-right">Recovered</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Next Deadline</TableHead><TableHead className="text-right">Overdue</TableHead><TableHead>Salesforce Status</TableHead><TableHead>Latest Recovery</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{visibleAccounts.map((account) => {
                const isOpen = expanded.has(account.accountId);
                return [
                  <TableRow key={account.accountId} className={account.issues?.length ? 'bg-amber-50/40' : ''}>
                    <TableCell><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleExpanded(account.accountId)} aria-label={isOpen ? 'Collapse Account' : 'Expand Account'}>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Button></TableCell>
                    <TableCell><SalesforceRecordLink instanceUrl={workspace.instanceUrl} id={account.accountId}>{account.accountName}</SalesforceRecordLink><div className="mt-0.5 text-xs text-muted-foreground">{accountClKeyLabel(account.clKey)}{account.active ? '' : ' · Inactive'}</div></TableCell>
                    <TableCell>{account.pics?.length ? account.pics.join(', ') : <span className="text-amber-700">Not set</span>}</TableCell>
                    <TableCell className="text-right">{currencyLines(account, 'agreedAmount')}</TableCell>
                    <TableCell className="text-right text-emerald-700">{currencyLines(account, 'recoveredAmount')}</TableCell>
                    <TableCell className="text-right font-semibold">{currencyLines(account, 'outstandingAmount')}</TableCell>
                    <TableCell>{formatDate(account.nextDeadline)}</TableCell>
                    <TableCell className="text-right">{account.overdueDays ? <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">{account.overdueDays} days</Badge> : '—'}</TableCell>
                    <TableCell>{account.salesforceStatus}</TableCell>
                    <TableCell>{formatDateTime(account.latestRecoveryAt)}</TableCell>
                    <TableCell className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => openClaim(account.accountId)} disabled={!account.active}><Plus className="mr-1.5 h-3.5 w-3.5" />Claim</Button></TableCell>
                  </TableRow>,
                  isOpen && <TableRow key={`${account.accountId}:detail`}><TableCell colSpan={11} className="bg-slate-50 p-4"><AccountDetails account={account} instanceUrl={workspace.instanceUrl} onRecovery={openRecovery} onStatus={(group, status) => { setReason(''); setStatusDialog({ account, group, status }); }} onDelete={(group, recovery) => { setReason(''); setDeleteConfirmed(false); setDeleteDialog({ account, group, recovery }); }} /></TableCell></TableRow>,
                ];
              })}</TableBody>
            </Table>
          </div>
        )}
      </TableShell>

      <Dialog open={claimDialog} onOpenChange={setClaimDialog}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Open Agreed Compensation Claim</DialogTitle><DialogDescription>The positive claim opens the debt in Salesforce. Currency comes from the selected Account.</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label>Account</Label><Select value={claimDraft.accountId} onValueChange={async (value) => { setClaimDraft((current) => ({ ...current, accountId: value, contactId: '__none__' })); try { await loadContacts(value); } catch (loadError) { toast({ title: 'Contacts unavailable', description: loadError.message, variant: 'destructive' }); } }}><SelectTrigger><SelectValue placeholder="Select active Account" /></SelectTrigger><SelectContent>{options.accounts.map((account) => <SelectItem key={account.accountId} value={account.accountId}>{accountSearchDisplayText(account.accountName, account.clKey)}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Contact (optional)</Label><Select value={claimDraft.contactId} onValueChange={(value) => setClaimDraft((current) => ({ ...current, contactId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">No Contact</SelectItem>{contacts.map((contact) => <SelectItem key={contact.contactId} value={contact.contactId}>{contact.contactName}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Salesforce PIC</Label><Select value={claimDraft.pic} onValueChange={(value) => setClaimDraft((current) => ({ ...current, pic: value }))}><SelectTrigger><SelectValue placeholder="Select PIC" /></SelectTrigger><SelectContent>{options.picOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Agreed amount</Label><Input type="number" min="0.01" step="0.01" value={claimDraft.amount} onChange={(event) => setClaimDraft((current) => ({ ...current, amount: event.target.value }))} /></div>
            <div><Label>Deadline</Label><Input type="date" value={claimDraft.deadlineDate} onChange={(event) => setClaimDraft((current) => ({ ...current, deadlineDate: event.target.value }))} /></div>
            <div className="sm:col-span-2"><Label>Description (optional)</Label><Textarea value={claimDraft.description} onChange={(event) => setClaimDraft((current) => ({ ...current, description: event.target.value }))} maxLength={32768} /></div>
          </div><DialogFooter><Button type="button" variant="outline" onClick={() => setClaimDialog(false)}>Cancel</Button><Button type="button" onClick={saveClaim} disabled={saving || !claimDraft.accountId || !(Number(claimDraft.amount) > 0) || !claimDraft.deadlineDate || !claimDraft.pic}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Open Claim</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(recoveryDialog)} onOpenChange={(open) => !open && setRecoveryDialog(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Record UOC Recovery</DialogTitle><DialogDescription>FCOS derives Account, currency, Product, quantities, UOM, and recovery amount from live Salesforce records.</DialogDescription></DialogHeader>
          {recoveryDialog && <div className="space-y-4">
            <div className="rounded-md border bg-slate-50 px-4 py-3 text-sm"><div className="font-semibold">{accountSearchDisplayText(recoveryDialog.account.accountName, recoveryDialog.account.clKey)}</div><div className="text-muted-foreground">Contact: {recoveryDialog.group.contactName}</div></div>
            <div><Label>Open claim</Label><Select value={recoveryDraft.claimId} onValueChange={(value) => setRecoveryDraft((current) => ({ ...current, claimId: value }))}><SelectTrigger><SelectValue placeholder="Select matching claim" /></SelectTrigger><SelectContent>{recoveryDialog.group.claims.filter((claim) => claim.status === 'Opened').map((claim) => <SelectItem key={claim.id} value={claim.id}>{formatMoney(claim.amount, claim.currencyIsoCode)} · due {formatDate(claim.deadlineDate)}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Find STEM</Label><div className="flex gap-2"><Input value={recoveryDraft.stemKeyword} onChange={(event) => setRecoveryDraft((current) => ({ ...current, stemKeyword: event.target.value }))} placeholder="Enter at least two STEM characters" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); searchStems(); } }} /><Button type="button" variant="outline" onClick={searchStems} disabled={recoveryDraft.stemKeyword.trim().length < 2}><Search className="h-4 w-4" /></Button></div></div>
            {!!stemOptions.length && <div><Label>STEM</Label><Select value={recoveryDraft.stemId} onValueChange={selectStem}><SelectTrigger><SelectValue placeholder="Select STEM" /></SelectTrigger><SelectContent>{stemOptions.map((stem) => <SelectItem key={stem.stemId} value={stem.stemId}>{stem.stemName} · {stem.buyerName || 'Buyer not set'}</SelectItem>)}</SelectContent></Select></div>}
            {stemContext && <>
              {!selectedStemAccount ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">This Account is not an eligible buyer, broker, supplier, supplier broker, secondary buyer broker, or extra-cost supplier on the selected STEM with an open claim.</div> : !selectedStemClaimIsEligible ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">The selected claim no longer matches this participant Account.</div> : null}
              <div><Label>STEM product line item</Label><Select value={recoveryDraft.lineItemId} onValueChange={(value) => setRecoveryDraft((current) => ({ ...current, lineItemId: value }))}><SelectTrigger><SelectValue placeholder="Select line item" /></SelectTrigger><SelectContent>{stemContext.lineItems.map((line) => <SelectItem key={line.lineItemId} value={line.lineItemId}>{line.productName || line.lineItemName} · {line.deliveredQuantity || line.quantity || 0} {line.unitOfMeasure}</SelectItem>)}</SelectContent></Select></div>
              <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={recoveryDraft.fixed} onCheckedChange={(checked) => setRecoveryDraft((current) => ({ ...current, fixed: checked === true }))} />Fixed lump-sum recovery</label>
              {recoveryDraft.fixed ? <div><Label>Lump-sum price</Label><Input type="number" min="0.01" step="0.01" value={recoveryDraft.lumpSumPrice} onChange={(event) => setRecoveryDraft((current) => ({ ...current, lumpSumPrice: event.target.value }))} /></div> : <div><Label>Unit price</Label><Input type="number" min="0.01" step="0.01" value={recoveryDraft.unitPrice} onChange={(event) => setRecoveryDraft((current) => ({ ...current, unitPrice: event.target.value }))} /></div>}
              {selectedRecoveryLine && selectedClaim && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3"><div className="text-xs font-medium text-emerald-800">Calculated recovery</div><div className="mt-1 text-lg font-semibold tabular-nums text-emerald-900">{formatMoney(recoveryPreview, selectedClaim.currencyIsoCode)}</div><div className="text-xs text-emerald-800">{recoveryDraft.fixed ? 'Lump-sum price' : `${Math.abs(Number(selectedRecoveryLine.deliveredQuantity || 0)) >= 0.005 ? 'Delivered quantity' : 'Line quantity'} × unit price`} · saved as a negative UOC amount</div></div>}
            </>}
          </div>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setRecoveryDialog(null)}>Cancel</Button><Button type="button" onClick={saveRecovery} disabled={saving || !recoveryDraft.claimId || !recoveryDraft.stemId || !recoveryDraft.lineItemId || !selectedStemClaimIsEligible || !(recoveryPreview > 0)}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record Recovery</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(statusDialog)} onOpenChange={(open) => !open && setStatusDialog(null)}><DialogContent><DialogHeader><DialogTitle>{statusDialog?.status === 'Opened' ? 'Open' : 'Close'} Claim Group</DialogTitle><DialogDescription>This changes every Agreed Compensation record for the Account and Contact and updates the Account status all-or-none.</DialogDescription></DialogHeader><div><Label>Mandatory reason</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></div><DialogFooter><Button type="button" variant="outline" onClick={() => setStatusDialog(null)}>Cancel</Button><Button type="button" onClick={changeGroupStatus} disabled={saving || reason.trim().length < 3}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(deleteDialog)} onOpenChange={(open) => !open && setDeleteDialog(null)}><DialogContent><DialogHeader><DialogTitle>Delete Erroneous UOC Recovery</DialogTitle><DialogDescription>This permanently deletes the selected Salesforce recovery. Use only when the record itself was created in error.</DialogDescription></DialogHeader>{deleteDialog && <div className="rounded-md border bg-slate-50 px-4 py-3 text-sm"><div className="font-semibold">{recoveryDisplayLabel(deleteDialog.recovery)}</div><div className="text-muted-foreground">{deleteDialog.recovery.productName || 'Product not set'} · {formatMoney(deleteDialog.recovery.recoveredAmount, deleteDialog.recovery.currencyIsoCode)}</div></div>}<div><Label>Mandatory audit reason</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></div><label className="flex items-start gap-2 text-sm"><Checkbox checked={deleteConfirmed} onCheckedChange={(checked) => setDeleteConfirmed(checked === true)} className="mt-0.5" /><span>I confirm this Salesforce UOC recovery was created in error and should be permanently deleted.</span></label><DialogFooter><Button type="button" variant="outline" onClick={() => setDeleteDialog(null)}>Cancel</Button><Button type="button" variant="destructive" onClick={deleteRecovery} disabled={saving || !deleteConfirmed || reason.trim().length < 3}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Trash2 className="mr-2 h-4 w-4" />Delete Recovery</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function AccountDetails({ account, instanceUrl, onRecovery, onStatus, onDelete }) {
  return <div className="space-y-4">
    {!!account.issues?.length && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />Data issues</div><ul className="mt-2 space-y-1 text-sm text-amber-800">{account.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
    {account.groups.map((group) => <section key={group.key} className="overflow-hidden rounded-md border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><div><div className="font-semibold">{group.contactName}</div><div className="text-xs text-muted-foreground">{group.currencyIsoCode} · {group.openClaimCount} open claim{group.openClaimCount === 1 ? '' : 's'}</div></div><div className="flex flex-wrap gap-2">{group.openClaimCount > 0 && <><Button type="button" size="sm" variant="outline" onClick={() => onRecovery(account, group)}><HandCoins className="mr-1.5 h-3.5 w-3.5" />Record Recovery</Button><Button type="button" size="sm" variant="outline" onClick={() => onStatus(group, 'Closed')}>Close Group</Button></>}{group.openClaimCount === 0 && group.claims.length > 0 && <Button type="button" size="sm" variant="outline" onClick={() => onStatus(group, 'Opened')}>Open Group</Button>}</div></div>
      <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0"><SummaryMetric label="Agreed" value={formatMoney(group.agreedAmount, group.currencyIsoCode)} /><SummaryMetric label="Recovered" value={formatMoney(group.recoveredAmount, group.currencyIsoCode)} /><SummaryMetric label="Outstanding" value={formatMoney(group.outstandingAmount, group.currencyIsoCode)} tone={group.outstandingAmount > 0.005 ? 'warning' : 'normal'} /></div>
      <div className="grid gap-4 border-t p-4 xl:grid-cols-2">
        <div><h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Agreed Compensation Claims</h4><div className="space-y-2">{group.claims.map((claim) => <div key={claim.id} className="rounded-md border px-3 py-2 text-sm"><div className="flex items-start justify-between gap-3"><SalesforceRecordLink instanceUrl={instanceUrl} id={claim.id}>{claimDisplayLabel(claim)}</SalesforceRecordLink><Badge variant="outline">{claim.status}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{formatMoney(claim.amount, claim.currencyIsoCode)} · PIC {claim.pic || 'not set'}</div></div>)}{!group.claims.length && <div className="text-sm text-muted-foreground">No claims.</div>}</div></div>
        <div><h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">UOC Recoveries</h4><div className="space-y-2">{group.recoveries.map((recovery) => <div key={recovery.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm"><div><SalesforceRecordLink instanceUrl={instanceUrl} id={recovery.id}>{recoveryDisplayLabel(recovery)}</SalesforceRecordLink><div className="mt-1 text-xs text-muted-foreground">{recovery.productName || 'Product not set'} · {formatMoney(recovery.recoveredAmount, recovery.currencyIsoCode)}</div></div><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-700" onClick={() => onDelete(group, recovery)} title="Delete erroneous recovery" aria-label="Delete erroneous recovery"><Trash2 className="h-4 w-4" /></Button></div>)}{!group.recoveries.length && <div className="text-sm text-muted-foreground">No recoveries.</div>}</div></div>
      </div>
    </section>)}
  </div>;
}
