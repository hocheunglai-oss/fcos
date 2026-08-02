import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, ListChecks, Loader2, RefreshCw, Scale } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { appClient } from '@/api/appClient';
import { useAuth } from '@/lib/AuthContext';
import BuyerInvoices from '@/pages/BuyerInvoices';
import IncomingPayments from '@/pages/IncomingPayments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  if (value === 'payment_pending_posting') return 'Pending Salesforce posting';
  return String(value || 'not_checked').replaceAll('_', ' ');
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

      {activeTab === 'collections' && <BuyerInvoices defaultQueueView="needs-action" reconciliationItems={reconciliation?.items || []} />}
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
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="px-4 py-3">STEM</th><th className="px-4 py-3">Collection Status</th><th className="px-4 py-3">Issue</th><th className="px-4 py-3 text-right">Verified Balance</th><th className="px-4 py-3">Latest Payment</th><th className="px-4 py-3">Next Action</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reconciliation.exceptions.map((entry) => (
                      <tr key={entry.item.stemId} className="bg-card">
                        <td className="px-4 py-3">
                          <StemDetailLink stemId={entry.item.stemId} onOpen={setSelectedStemId}>{entry.stemName || entry.item.stemId}</StemDetailLink>
                        </td>
                        <td className="px-4 py-3">{entry.item.status}</td>
                        <td className="px-4 py-3"><Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">{reconciliationLabel(entry.item.reconciliationState)}</Badge></td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(entry.item.verifiedReceivableBalance)}</td>
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
                        <td className="px-4 py-3 text-muted-foreground">Open the Collection Queue, review the live STEM, and record the next follow-up.</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableShell>
          )}
        </div>
      )}
      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} />
    </div>
  );
}
