import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, ListChecks, Loader2, RefreshCw, Scale, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { appClient } from '@/api/appClient';
import { useAuth } from '@/lib/AuthContext';
import BuyerInvoices from '@/pages/BuyerInvoices';
import IncomingPayments from '@/pages/IncomingPayments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import PageMethodology from '@/components/common/PageMethodology';
import StemDetailLink from '@/components/common/StemDetailLink';
import { PAYMENT_COLLECTIONS_METHODOLOGIES } from '@/lib/pageMethodologies';
import StemDetailModal from '@/components/dashboard/StemDetailModal';

const TABS = [
  { id: 'collections', label: 'Collection Queue', icon: ListChecks, moduleId: 'buyer_invoices' },
  { id: 'incoming', label: 'Incoming Payments', icon: Banknote, moduleId: 'incoming_payments' },
  { id: 'reconciliation', label: 'Reconciliation Exceptions', icon: Scale, moduleIds: ['buyer_invoices', 'incoming_payments'] },
];

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function collectionDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Hong_Kong' }).format(date);
}

function evidenceComparisonText(evidence) {
  if (!evidence?.receivedDate) return '';
  return [
    `Received ${collectionDate(evidence.receivedDate)}`,
    evidence.earliestEtaDate ? `Earliest ETA ${collectionDate(evidence.earliestEtaDate)}` : null,
    evidence.actualDeliveryDate ? `Delivered ${collectionDate(evidence.actualDeliveryDate)}` : null,
  ].filter(Boolean).join(' · ');
}

function reconciliationLabel(value) {
  if (value === 'payment_posting_pending') return 'Posting pending';
  if (value === 'payment_partially_posted') return 'Partially posted';
  if (value === 'payment_posting_mismatch') return 'Posting mismatch';
  if (value === 'payment_posting_overdue') return 'Posting overdue';
  return String(value || 'not_checked').replaceAll('_', ' ');
}

function postingIssue(entry) {
  const state = entry?.item?.reconciliationState;
  if (!['payment_posting_pending', 'payment_partially_posted', 'payment_posting_mismatch', 'payment_posting_overdue'].includes(state)) return null;
  return entry.paymentPostingIssue || entry.item?.paymentReconciliationSnapshot || null;
}

function currencyMoney(currency, value) {
  return value == null ? '-' : `${currency || ''} ${money(value)}`.trim();
}

export default function PaymentCollections() {
  const { hasModuleAccess } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const availableTabs = useMemo(() => TABS.filter((tab) => (
    tab.moduleIds ? tab.moduleIds.some((moduleId) => hasModuleAccess(moduleId)) : hasModuleAccess(tab.moduleId)
  )), [hasModuleAccess]);
  const requestedTab = searchParams.get('tab');
  const defaultTab = hasModuleAccess('buyer_invoices') ? 'collections' : 'incoming';
  const activeTab = availableTabs.some((tab) => tab.id === requestedTab) ? requestedTab : defaultTab;
  const activeMethodology = PAYMENT_COLLECTIONS_METHODOLOGIES[activeTab] || PAYMENT_COLLECTIONS_METHODOLOGIES.collections;
  const [reconciliation, setReconciliation] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconciliationError, setReconciliationError] = useState('');
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [overrideEntry, setOverrideEntry] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState('');
  const [collectionDataRefreshToken, setCollectionDataRefreshToken] = useState(0);

  const changeTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const reconcile = async ({ force = false } = {}) => {
    setReconciling(true);
    setReconciliationError('');
    const response = await appClient.functions.invoke('paymentCollectionsReconcile', { force }, { force });
    if (response.data?.error) {
      setReconciliationError(response.data.error);
    } else {
      setReconciliation(response.data);
      appClient.functions.clearCache();
    }
    setReconciling(false);
  };

  useEffect(() => {
    reconcile();
  }, []);

  const openReminderOverride = (entry) => {
    setOverrideEntry(entry);
    setOverrideReason('');
    setOverrideError('');
  };

  const closeReminderOverride = () => {
    if (overrideSaving) return;
    setOverrideEntry(null);
    setOverrideReason('');
    setOverrideError('');
  };

  const saveReminderOverride = async () => {
    const issue = postingIssue(overrideEntry);
    const reason = overrideReason.trim();
    if (!issue?.issueKey) {
      setOverrideError('The posting issue changed. Refresh and try again.');
      return;
    }
    if (reason.length < 5) {
      setOverrideError('Enter a reason of at least 5 characters.');
      return;
    }
    setOverrideSaving(true);
    setOverrideError('');
    const response = await appClient.functions.invoke('buyerInvoicePostingReminderOverrideSave', {
      stemId: overrideEntry.item.stemId,
      issueKey: issue.issueKey,
      allowReminder: overrideEntry.item.postingReminderOverrideActive !== true,
      reason,
      operationId: globalThis.crypto?.randomUUID?.() || `posting_${Date.now()}`,
    });
    if (response.data?.error) {
      setOverrideError(response.data.error);
      setOverrideSaving(false);
      return;
    }
    setOverrideSaving(false);
    setOverrideEntry(null);
    setOverrideReason('');
    setCollectionDataRefreshToken((value) => value + 1);
    await reconcile({ force: true });
  };

  return (
    <div className="min-h-full bg-slate-50">
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {availableTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Button key={tab.id} type="button" variant={activeTab === tab.id ? 'default' : 'ghost'} size="sm" className="shrink-0 gap-2" onClick={() => changeTab(tab.id)}>
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  {tab.id === 'reconciliation' && reconciliation?.summary?.exceptions > 0 && (
                    <Badge variant="secondary" className="ml-1 bg-amber-100 text-amber-800">{reconciliation.summary.exceptions}</Badge>
                  )}
                </Button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {reconciling ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking Salesforce balances</> : reconciliation?.summary ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {reconciliation.summary.checked} cases checked</> : null}
            </div>
            <PageMethodology {...activeMethodology} size="sm" />
          </div>
        </div>
        {reconciliationError && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Automatic reconciliation is unavailable: {reconciliationError}
          </div>
        )}
      </div>

      {activeTab === 'collections' && <BuyerInvoices defaultQueueView="needs-action" reconciliationItems={reconciliation?.items || []} dataRefreshToken={collectionDataRefreshToken} />}
      {activeTab === 'incoming' && <IncomingPayments reconciliationItems={reconciliation?.items || []} />}
      {activeTab === 'reconciliation' && (
        <div className="space-y-5 p-4 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Reconciliation Exceptions</h1>
              <p className="mt-1 text-sm text-muted-foreground">Cases where Salesforce balances, payment advice, incoming payments, and FCOS closure state need attention.</p>
            </div>
            <Button variant="outline" onClick={() => reconcile({ force: true })} disabled={reconciling} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${reconciling ? 'animate-spin' : ''}`} /> Refresh Salesforce
            </Button>
          </div>
          {reconciling && !reconciliation && <StateBlock icon={Loader2} title="Reconciling collection cases" description="Checking live Salesforce receivable balances and payment evidence." />}
          {!reconciling && reconciliation && !reconciliation.exceptions?.length && <StateBlock icon={CheckCircle2} title="No reconciliation exceptions" description="Open collection states agree with the latest Salesforce balances." />}
          {!!reconciliation?.exceptions?.length && (
            <TableShell title="Cases requiring attention" meta={`${reconciliation.exceptions.length.toLocaleString()} exceptions`} bodyClassName="p-0">
              <div className="overflow-auto">
                <table className="w-full min-w-[1240px] text-sm">
                  <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="px-4 py-3">STEM</th><th className="px-4 py-3">Collection Status</th><th className="px-4 py-3">Issue</th><th className="px-4 py-3">Balance Reconciliation</th><th className="px-4 py-3">Latest Payment</th><th className="px-4 py-3">Reminder Control</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reconciliation.exceptions.map((entry) => {
                      const issue = postingIssue(entry);
                      const overrideActive = entry.item.postingReminderOverrideActive === true;
                      return (
                      <tr key={entry.item.stemId} className="bg-card align-top">
                        <td className="px-4 py-3">
                          <StemDetailLink stemId={entry.item.stemId} onOpen={setSelectedStemId}>{entry.stemName || entry.item.stemId}</StemDetailLink>
                        </td>
                        <td className="px-4 py-3">{entry.item.status}</td>
                        <td className="px-4 py-3"><Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">{reconciliationLabel(entry.item.reconciliationState)}</Badge></td>
                        <td className="px-4 py-3">
                          {issue ? (
                            <dl className="grid min-w-[290px] grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs tabular-nums">
                              <dt className="text-muted-foreground">Previous balance</dt><dd className="text-right">{currencyMoney(entry.currency, issue.baselineBalance)}</dd>
                              <dt className="text-muted-foreground">Detected payments</dt><dd className="text-right text-emerald-700">-{currencyMoney(entry.currency, issue.detectedPaymentAmount)}</dd>
                              <dt className="font-medium">Expected balance</dt><dd className="text-right font-medium">{currencyMoney(entry.currency, issue.expectedBalance)}</dd>
                              <dt className="font-medium">Current Salesforce balance</dt><dd className="text-right font-medium">{currencyMoney(entry.currency, issue.currentBalance)}</dd>
                              <dt className="text-muted-foreground">Difference</dt><dd className="text-right font-semibold text-amber-800">{currencyMoney(entry.currency, issue.differenceAmount)}</dd>
                              <dt className="text-muted-foreground">Open</dt><dd className="text-right">{issue.businessDaysOpen || 0} business day{Number(issue.businessDaysOpen) === 1 ? '' : 's'}</dd>
                            </dl>
                          ) : (
                            <div className="text-right tabular-nums">{currencyMoney(entry.currency, entry.item.verifiedReceivableBalance)}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {entry.latestPayment ? (
                            <>
                              <span className="font-medium text-foreground">{entry.paymentEvidence?.label || 'Buyer payment'}</span>
                              <br />{entry.latestPayment.amount != null ? `${entry.currency || ''} ${money(entry.latestPayment.amount)}` : '-'}
                              <div className="mt-0.5 text-[11px]">{evidenceComparisonText(entry.paymentEvidence) || collectionDate(entry.latestPayment.paymentDate)}</div>
                              {entry.paymentEvidenceSummary?.paymentCount > 1 && (
                                <div className="mt-1 text-[11px]">
                                  {entry.paymentEvidenceSummary.paymentCount} payments · CIA {money(entry.paymentEvidenceSummary.ciaReceivedAmount)} · Other {money(entry.paymentEvidenceSummary.otherReceivedAmount)}
                                </div>
                              )}
                            </>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {issue ? (
                            <div className="max-w-[290px] space-y-2">
                              <div className={overrideActive ? 'text-blue-800' : 'text-amber-800'}>
                                {overrideActive
                                  ? `Finance override active${entry.item.postingReminderOverrideByEmail ? ` · ${entry.item.postingReminderOverrideByEmail}` : ''}.`
                                  : 'External reminders are paused until the posting difference clears.'}
                              </div>
                              {overrideActive && entry.item.postingReminderOverrideReason && (
                                <div className="text-xs text-muted-foreground">{entry.item.postingReminderOverrideReason}</div>
                              )}
                              {reconciliation.capabilities?.canOverridePostingReminder && (
                                <Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => openReminderOverride(entry)}>
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  {overrideActive ? 'Restore reminder pause' : 'Allow reminder'}
                                </Button>
                              )}
                            </div>
                          ) : 'Review the live STEM and record the next follow-up.'}
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            </TableShell>
          )}
        </div>
      )}
      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} />
      <Dialog open={!!overrideEntry} onOpenChange={(open) => !open && closeReminderOverride()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{overrideEntry?.item?.postingReminderOverrideActive ? 'Restore reminder pause' : 'Allow external reminder'}</DialogTitle>
            <DialogDescription>
              {overrideEntry?.item?.postingReminderOverrideActive
                ? 'Remove the Finance exception and pause reminders again while Salesforce posting remains unresolved.'
                : 'This permits an external reminder even though a detected payment does not reconcile to the Salesforce receivable balance.'}
            </DialogDescription>
          </DialogHeader>
          {overrideEntry && postingIssue(overrideEntry) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {overrideEntry.stemName}: expected {currencyMoney(overrideEntry.currency, postingIssue(overrideEntry).expectedBalance)}, current {currencyMoney(overrideEntry.currency, postingIssue(overrideEntry).currentBalance)}.
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="posting-reminder-override-reason">Reason</Label>
            <Textarea
              id="posting-reminder-override-reason"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value.slice(0, 1000))}
              placeholder="Explain why contact should continue despite the unresolved posting difference."
              className="min-h-28"
            />
            <div className="text-right text-xs text-muted-foreground">{overrideReason.length}/1000</div>
          </div>
          {overrideError && <div className="text-sm text-destructive">{overrideError}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeReminderOverride} disabled={overrideSaving}>Cancel</Button>
            <Button type="button" onClick={saveReminderOverride} disabled={overrideSaving || overrideReason.trim().length < 5} className="gap-2">
              {overrideSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save control
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
