import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { numericValue, textValue } from '@/lib/displayValue';

const ACTIVE_DISPUTE_STATUSES = [
  'Opened',
  'Closed with Supplier only',
  'Closed with Buyer only',
  'Closed',
];
const NOT_CLOSED_STATUSES = ACTIVE_DISPUTE_STATUSES.filter(status => status !== 'Closed');

const normalizeStatus = (value) => textValue(value, '').toLowerCase();
const displayStatus = (value) =>
  ACTIVE_DISPUTE_STATUSES.find(status => normalizeStatus(status) === normalizeStatus(value)) || value;

const fmtMoney = (value) => {
  const number = numericValue(value);
  if (number == null) return '—';
  return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (value) => {
  if (!value) return '—';
  if (typeof value === 'object') return textValue(value);
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return textValue(value); }
};

const csvValue = (value) => `"${textValue(value, '').replaceAll('"', '""')}"`;

const pairTitle = (pairs, key) =>
  Array.isArray(pairs) && pairs.length
    ? pairs.map((pair) => pair?.[key] || '—').join('\n')
    : '';

function Metric({ label, value, tone = 'default' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-dm text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export default function DisputeManagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState(NOT_CLOSED_STATUSES);
  const [selectedStemId, setSelectedStemId] = useState(null);

  const loadRows = async () => {
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('salesforceDisputeStems', { limit: 10000 });
    if (res.data?.error) {
      setError(res.data.error);
      setRows([]);
    } else {
      setRows(res.data?.rows || []);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  useEffect(() => { loadRows(); }, []);

  const selectedStatusKeys = useMemo(() => new Set(selectedStatuses.map(normalizeStatus)), [selectedStatuses]);
  const notClosedActive = NOT_CLOSED_STATUSES.every(status => selectedStatusKeys.has(normalizeStatus(status)))
    && !selectedStatusKeys.has(normalizeStatus('Closed'));

  const toggleStatus = (status) => {
    const statusKey = normalizeStatus(status);
    setSelectedStatuses(prev => {
      const hasStatus = prev.some(item => normalizeStatus(item) === statusKey);
      return hasStatus
        ? prev.filter(item => normalizeStatus(item) !== statusKey)
        : [...prev, status];
    });
  };

  const toggleNotClosed = () => {
    setSelectedStatuses(notClosedActive ? [] : NOT_CLOSED_STATUSES);
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      const isActiveDispute = normalizeStatus(row.Dispute_Status__c) !== 'no dispute';
      const statusMatch = selectedStatusKeys.has(normalizeStatus(row.Dispute_Status__c));
      const textMatch = !q || [
        row._Display_Name,
        row._Buyer_Name,
        row._Supplier_Names,
        row._Product_Names,
        displayStatus(row.Dispute_Status__c),
      ].some(value => value != null && textValue(value, '').toLowerCase().includes(q));
      return isActiveDispute && statusMatch && textMatch;
    });
  }, [rows, search, selectedStatusKeys]);

  const totals = useMemo(() => ({
    count: filteredRows.length,
    receivable: filteredRows.reduce((sum, row) => sum + Number(row.Receivable_Balance__c || 0), 0),
    buyerInvoice: filteredRows.reduce((sum, row) => sum + Number(row.Total_Invoice_Amount__c || 0), 0),
    payable: filteredRows.reduce((sum, row) => sum + Number(row._Payable_Balance || 0), 0),
  }), [filteredRows]);

  const exportCsv = () => {
    const headers = ['Stem Name', 'Buyer Name', 'Supplier Name(s)', 'Product Name(s)', 'Dispute Status', 'Delivery Date', 'Expected Delivery', 'Buyer Invoice', 'Supplier Invoice', 'Receivable Balance', 'Payable Balance', 'Last Modified'];
    const csvRows = filteredRows.map(row => [
      row._Display_Name,
      row._Buyer_Name,
      row._Supplier_Names,
      row._Product_Names,
      displayStatus(row.Dispute_Status__c),
      row.Delivery_Date__c,
      row.Expected_Delivery_Date__c,
      row.Total_Invoice_Amount__c,
      row.Total_Invoiced_Amount_From_Suppliers__c,
      row.Receivable_Balance__c,
      row._Payable_Balance,
      row.LastModifiedDate,
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(csvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dispute-management-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={AlertTriangle}
        eyebrow="Dispute workflow"
        title="Dispute Management"
        description="Manage all disputed STEMs from Salesforce, inspect detail, and export the working list."
        meta={lastRefresh ? `Last updated ${format(lastRefresh, 'HH:mm:ss')}` : 'Auto-loaded from Salesforce'}
        actions={(
          <>
            <Button variant="outline" onClick={exportCsv} disabled={loading || !filteredRows.length} className="gap-2">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" onClick={loadRows} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
          </>
        )}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Disputed STEMs" value={totals.count.toLocaleString()} tone="red" />
        <Metric label="Receivable Balance" value={fmtMoney(totals.receivable)} tone="amber" />
        <Metric label="Payable Balance" value={fmtMoney(totals.payable)} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search stem, buyer, supplier, product..." value={search} onChange={event => setSearch(event.target.value)} className="h-9 pl-8 text-xs" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</Label>
            <button type="button" onClick={toggleNotClosed} className="text-xs text-primary hover:underline">
              {notClosedActive ? 'Clear all' : 'Select Not Closed'}
            </button>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVE_DISPUTE_STATUSES.map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleStatus(status)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedStatusKeys.has(normalizeStatus(status))
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <TableShell title="Disputed STEMs" meta={`${filteredRows.length.toLocaleString()} rows`} bodyClassName="p-0">
        {loading ? (
          <StateBlock icon={Loader2} title="Loading disputes..." description="Fetching dispute STEMs from Salesforce." />
        ) : filteredRows.length ? (
          <div className="max-h-[68vh] overflow-auto">
            <table className="w-full min-w-[1420px] text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Stem Name</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Buyer Name</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Supplier Name(s)</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Product Name(s)</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Delivery</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Buyer Invoice</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Supplier Invoice</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Receivable Balance</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Payable Balance</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Modified</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => {
                  const pairs = Array.isArray(row._Supplier_Product_Pairs) ? row._Supplier_Product_Pairs : [];
                  return (
                    <tr key={row.Id} onClick={() => setSelectedStemId(row.Id)} className={`cursor-pointer border-b border-border/40 hover:bg-muted/30 ${idx % 2 ? 'bg-muted/10' : ''}`}>
                      <td className="px-3 py-2.5 font-medium text-foreground">{row._Display_Name || row.Name || '—'}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{row._Buyer_Name || '—'}</td>
                      <td className="max-w-[280px] px-3 py-2.5 text-muted-foreground" title={pairTitle(pairs, 'supplierName') || row._Supplier_Names || ''}>
                        {pairs.length ? (
                          <div className="space-y-1">
                            {pairs.map((pair, pairIdx) => (
                              <div key={`${pair.supplierName || 'supplier'}-${pair.productName || 'product'}-${pairIdx}`} className="truncate leading-5">
                                {pair.supplierName || '—'}
                              </div>
                            ))}
                          </div>
                        ) : (
                          row._Supplier_Names || '—'
                        )}
                      </td>
                      <td className="max-w-[300px] px-3 py-2.5 text-muted-foreground" title={pairTitle(pairs, 'productName') || row._Product_Names || ''}>
                        {pairs.length ? (
                          <div className="space-y-1">
                            {pairs.map((pair, pairIdx) => (
                              <div key={`${pair.productName || 'product'}-${pair.supplierName || 'supplier'}-${pairIdx}`} className="truncate leading-5">
                                {pair.productName || '—'}
                              </div>
                            ))}
                          </div>
                        ) : (
                          row._Product_Names || '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5">{displayStatus(row.Dispute_Status__c) || '—'}</td>
                      <td className="px-3 py-2.5">{fmtDate(row._Effective_Date)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(row.Total_Invoice_Amount__c)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(row.Total_Invoiced_Amount_From_Suppliers__c)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtMoney(row.Receivable_Balance__c)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtMoney(row._Payable_Balance)}</td>
                      <td className="px-3 py-2.5">{fmtDate(row.LastModifiedDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <StateBlock title="No disputed STEMs found" description="No records match the current dispute filters." />
        )}
      </TableShell>

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} onUpdated={loadRows} />
    </div>
  );
}
