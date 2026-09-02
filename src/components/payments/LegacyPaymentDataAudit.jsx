import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { appClient } from '@/api/appClient';
import PaymentDataReliabilityBadge from '@/components/common/PaymentDataReliabilityBadge';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CATEGORIES = [
  { id: 'buyer_balance', label: 'Buyer balance evidence' },
  { id: 'supplier_balance', label: 'Supplier balance evidence' },
  { id: 'cross_cutover_payment', label: '2026 payment records' },
];

const VALUE_LABELS = {
  invoiceAmount: 'Buyer invoice amount',
  receivedAmount: 'Salesforce received amount',
  receivableBalance: 'Salesforce receivable formula',
  qlikReceivableBalance: 'QLIK receivable formula',
  supplierInvoiceAmount: 'Supplier invoice amount',
  payableBalance: 'Salesforce payable formula',
  paymentDate: 'Payment record date',
  paymentAmount: 'Payment record amount',
};

function date(value) {
  if (!value) return 'Not set';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function rawValue(value, currency) {
  if (value == null || value === '') return 'Unavailable';
  if (typeof value === 'number') return `${currency || ''} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
  return String(value);
}

function basis(value) {
  if (value === 'actual_delivery_date') return 'Actual Delivery Date';
  if (value === 'expected_delivery_date') return 'Expected Delivery Date';
  if (value === 'created_date_hong_kong') return 'Hong Kong Created Date';
  return 'Date unavailable';
}

export default function LegacyPaymentDataAudit() {
  const [category, setCategory] = useState('buyer_balance');
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('legacyPaymentDataAudit', { category, query, offset, limit: 50 }, { force });
    if (response.data?.error) setError(response.data.error);
    else setData(response.data);
    setLoading(false);
  }, [category, offset, query]);

  useEffect(() => { load(); }, [load]);

  const changeCategory = (next) => {
    setCategory(next);
    setOffset(0);
  };

  const search = (event) => {
    event.preventDefault();
    setOffset(0);
    setQuery(queryDraft.trim());
  };

  const summary = data?.summary || {};
  const page = data?.pagination || {};
  return (
    <div className="space-y-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Legacy settled data</h1>
            <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">Read only</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Historical Salesforce payment evidence retained for audit, never treated as outstanding.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PaymentDataReliabilityBadge excludedCount={page.total} />
          <Button variant="outline" className="gap-2" onClick={() => load({ force: true })} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Legacy dated STEMs', summary.legacyDeliveredStemCount],
          ['Stale buyer formulas', summary.staleBuyerBalanceCount],
          ['Stale supplier formulas', summary.staleSupplierBalanceCount],
          ['2026 payments on legacy STEMs', summary.crossCutoverPaymentCount],
          ['Undated zero-balance STEMs', summary.undatedZeroBalanceStemCount],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold tabular-nums">{value == null ? '—' : Number(value).toLocaleString()}</div></div>)}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <div className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><div><strong>Settled before FCOS cutover.</strong> Raw values below are unreliable Salesforce evidence, not outstanding obligations. FCOS provides no correction or payment action here.</div></div>
      </div>

      <TableShell
        title="Payment-relevant legacy evidence"
        meta={`${Number(page.total || 0).toLocaleString()} records`}
        actions={<form className="flex min-w-[280px] gap-2" onSubmit={search}><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="STEM, Account or invoice" /></div><Button type="submit" variant="outline">Search</Button></form>}
        bodyClassName="p-0"
      >
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          {CATEGORIES.map((item) => <Button key={item.id} size="sm" variant={category === item.id ? 'default' : 'outline'} onClick={() => changeCategory(item.id)}>{item.label}</Button>)}
        </div>
        {error ? <StateBlock icon={AlertTriangle} title="Legacy audit unavailable" description={error} /> : loading && !data ? <StateBlock icon={Loader2} title="Loading legacy evidence" description="Reading live, read-only Salesforce audit fields." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">STEM / Account</th><th className="px-4 py-3">Evidence</th><th className="px-4 py-3">Effective date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Details</th></tr></thead>
              <tbody className="divide-y divide-border">
                {(data?.rows || []).map((row) => <tr key={row.id} className="align-top">
                  <td className="px-4 py-3"><div className="font-medium">{row.stemName || 'STEM unavailable'}</div><div className="text-xs text-muted-foreground">{row.accountName || 'Account unavailable'}</div></td>
                  <td className="px-4 py-3">{row.evidenceType}</td>
                  <td className="px-4 py-3"><div>{date(row.effectiveDate)}</div><div className="text-xs text-muted-foreground">{basis(row.dateBasis)}</div></td>
                  <td className="px-4 py-3"><Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">Settled before FCOS cutover</Badge></td>
                  <td className="px-4 py-3"><details><summary className="cursor-pointer font-medium text-primary">Unreliable Salesforce values</summary><dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">{Object.entries(row.rawValues || {}).map(([key, value]) => <div key={key} className="contents"><dt className="text-muted-foreground">{VALUE_LABELS[key] || key}</dt><dd className="text-right tabular-nums">{rawValue(value, row.currency)}</dd></div>)}</dl>{row.salesforceUrl ? <a href={row.salesforceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open Salesforce <ExternalLink className="h-3 w-3" /></a> : null}</details></td>
                </tr>)}
                {!loading && !data?.rows?.length ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No legacy evidence matches this filter.</td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground"><span>{page.total ? `${Number(offset + 1).toLocaleString()}–${Number(Math.min(offset + (data?.rows?.length || 0), page.total)).toLocaleString()} of ${Number(page.total).toLocaleString()}` : 'No records'}</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setOffset(Math.max(0, offset - 50))} disabled={loading || offset === 0}><ChevronLeft className="h-4 w-4" /> Previous</Button><Button size="sm" variant="outline" onClick={() => setOffset(page.nextOffset)} disabled={loading || page.nextOffset == null}>Next <ChevronRight className="h-4 w-4" /></Button></div></div>
      </TableShell>
    </div>
  );
}
