import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Columns3, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import TableShell from '@/components/common/TableShell';

const DEFAULT_COLUMNS = ['stem', 'deliveryDate', 'vessel', 'buyer', 'supplier', 'port', 'turnover', 'grossProfit', 'dispute'];
const COLUMN_LABELS = { stem: 'STEM', deliveryDate: 'Delivery', vessel: 'Vessel', buyer: 'Buyer', supplier: 'Supplier', port: 'Port / country', turnover: 'Turnover', grossProfit: 'Gross profit', dispute: 'Dispute' };
const MONEY_COLUMNS = new Set(['turnover', 'grossProfit']);
const SORT_FIELDS = { stem: 'name', deliveryDate: 'deliveryDate' };
const money = (value, currency = 'USD') => {
  if (!Number.isFinite(Number(value))) return '—';
  const safeCurrency = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : null;
  if (!safeCurrency) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value));
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: safeCurrency, currencyDisplay: 'code', maximumFractionDigits: 0 }).format(Number(value));
};
const date = (value) => value ? new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : '—';

function valueFor(row, column) {
  const values = {
    stem: row.name ?? row.Name ?? row.stemName ?? row.KeyStem__c,
    deliveryDate: row.deliveryDate ?? row.Delivery_Date__c ?? row.Expected_Delivery_Date__c,
    vessel: row.vessel?.name ?? row.vessel ?? row.Vessel__c,
    buyer: row.account?.name ?? row.buyerName ?? row.Buyer_Name__c ?? row.buyer,
    supplier: row.supplierNames?.join(', ') ?? row.supplierName ?? row._Supplier_Names ?? row.supplier,
    port: row.port?.name ?? row.portCountry ?? row.port ?? row.Port__c,
    turnover: row.turnover ?? row.buyer ?? row.Total_Invoice_Amount__c ?? row.totalBuyer,
    grossProfit: row.grossProfit ?? row.netPnl ?? row.__pnl__,
    dispute: row.disputeStatus ?? row.Dispute_Status__c ?? (row.dispute ?? row.Dispute__c ? 'Disputed' : '—'),
  };
  return values[column];
}

function accountFor(row, column) {
  if (column === 'buyer') return row.account ? { accountId: row.account.id, name: row.account.name, role: 'buyer' } : row.buyerAccount ?? row._Buyer_Account ?? (row.buyerAccountId ? { accountId: row.buyerAccountId, name: valueFor(row, column), role: 'buyer' } : null);
  if (column === 'supplier') return row.supplierAccounts?.length === 1 ? { accountId: row.supplierAccounts[0].id, name: row.supplierAccounts[0].name, role: 'supplier' } : row.supplierAccount ?? row._Supplier_Account ?? (row.supplierAccountId ? { accountId: row.supplierAccountId, name: valueFor(row, column), role: 'supplier' } : null);
  return null;
}

function renderValue(row, column, onAccountClick) {
  const value = valueFor(row, column);
  if (column === 'deliveryDate') return date(value);
  if (MONEY_COLUMNS.has(column)) return money(value, row.currency ?? row.CurrencyIsoCode);
  if (column === 'dispute') return <span className={String(value).toLowerCase().includes('dispute') ? 'rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800' : 'text-muted-foreground'}>{value || '—'}</span>;
  const account = accountFor(row, column);
  if (account?.accountId && onAccountClick) return <button type="button" className="max-w-full truncate text-left text-primary hover:underline" onClick={(event) => { event.stopPropagation(); onAccountClick({ ...account, role: account.role || (column === 'supplier' ? 'supplier' : 'buyer') }); }}>{value || account.name || '—'}</button>;
  return value == null || value === '' ? '—' : String(value);
}

export default function DashboardStemTable({ result, loading, search = '', onSearch, onPrevious, onNext, onSortChange, onStemClick, onAccountClick }) {
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_COLUMNS);
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => { setSearchDraft(search); }, [search]);
  const rows = result?.rows || result?.records || result?.stems || [];
  const page = Number(result?.page ?? result?.pagination?.page ?? 1);
  const pageSize = Number(result?.pageSize ?? result?.pagination?.pageSize ?? 50);
  const total = Number(result?.matchingCount ?? result?.total ?? result?.totalCount ?? result?.pagination?.total ?? rows.length);
  const hasNext = Boolean(result?.nextCursor ?? result?.pagination?.nextCursor ?? result?.hasNext);
  const hasPrevious = Boolean(result?.previousCursor ?? result?.pagination?.previousCursor ?? page > 1);
  const displayColumns = useMemo(() => DEFAULT_COLUMNS.filter((column) => visibleColumns.includes(column)), [visibleColumns]);
  const sort = result?.sort || {};
  const toggleColumn = (column) => setVisibleColumns((current) => current.includes(column) ? (current.length === 1 ? current : current.filter((value) => value !== column)) : [...current, column]);
  const applySort = (column) => {
    const field = SORT_FIELDS[column];
    if (!field) return;
    onSortChange?.({ field, direction: sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc' });
  };
  return <TableShell title="STEMs" meta={total ? `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} of ${total.toLocaleString()} · Server paginated` : 'No matching STEMs'} bodyClassName="p-0" actions={<><form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); onSearch?.(searchDraft.trim()); }}><Input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search STEMs" aria-label="Search STEMs" className="h-8 w-36 text-xs" /><Button type="submit" variant="outline" size="sm" className="h-8 px-2" disabled={loading}><Search className="h-3.5 w-3.5" /><span className="sr-only">Search</span></Button></form><Popover><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="h-8 text-xs"><Columns3 className="mr-1 h-3.5 w-3.5" />Columns</Button></PopoverTrigger><PopoverContent align="end" className="w-48 p-2">{DEFAULT_COLUMNS.map((column) => <label key={column} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"><Checkbox checked={visibleColumns.includes(column)} onCheckedChange={() => toggleColumn(column)} />{COLUMN_LABELS[column]}</label>)}</PopoverContent></Popover></>}>
    <div className="divide-y divide-border md:hidden">{rows.map((row, index) => <div role="button" tabIndex={0} key={row.id ?? row.Id ?? index} onClick={() => onStemClick?.(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onStemClick?.(row); }} className="block w-full cursor-pointer px-4 py-3 text-left hover:bg-muted/30"><div className="flex items-start justify-between gap-3"><span className="font-semibold">{renderValue(row, 'stem', onAccountClick)}</span><span className="text-xs text-muted-foreground">{renderValue(row, 'deliveryDate', onAccountClick)}</span></div><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="truncate">{renderValue(row, 'buyer', onAccountClick)}</span><span className="truncate">{renderValue(row, 'supplier', onAccountClick)}</span><span>{renderValue(row, 'port', onAccountClick)}</span><span className="text-right font-semibold text-foreground">{renderValue(row, 'grossProfit', onAccountClick)}</span></div></div>)}{!rows.length && !loading ? <div className="px-4 py-14 text-center text-sm text-muted-foreground">No STEMs match these filters. Reset a filter or select a wider period.</div> : null}</div>
    <div className="relative hidden overflow-x-auto md:block">
      <table className="w-full min-w-[950px] text-sm">
        <thead className="border-b border-border bg-muted/30"><tr>{displayColumns.map((column) => <th key={column} className={`whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${MONEY_COLUMNS.has(column) ? 'text-right' : ''}`}>{SORT_FIELDS[column] ? <button type="button" onClick={() => applySort(column)} className="hover:text-foreground">{COLUMN_LABELS[column]} {sort.field === SORT_FIELDS[column] ? (sort.direction === 'asc' ? '↑' : '↓') : ''}</button> : COLUMN_LABELS[column]}</th>)}</tr></thead>
        <tbody className={loading && rows.length ? 'opacity-55' : ''}>{rows.map((row, index) => <tr key={row.id ?? row.Id ?? index} onClick={() => onStemClick?.(row)} className={`border-b border-border/60 last:border-0 hover:bg-muted/30 ${onStemClick ? 'cursor-pointer' : ''}`}>{displayColumns.map((column) => <td key={column} className={`max-w-72 truncate px-3 py-3 align-top ${MONEY_COLUMNS.has(column) ? 'text-right tabular-nums' : ''}`} title={typeof valueFor(row, column) === 'string' ? valueFor(row, column) : undefined}>{renderValue(row, column, onAccountClick)}</td>)}</tr>)}
          {!rows.length && !loading ? <tr><td colSpan={displayColumns.length} className="px-4 py-14 text-center text-sm text-muted-foreground">No STEMs match these filters. Reset a filter or select a wider period.</td></tr> : null}
        </tbody>
      </table>
      {loading && !rows.length ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading STEMs…</div> : null}
    </div>
    <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2"><Button type="button" variant="ghost" size="sm" className="h-8 text-xs" disabled={loading || !hasPrevious} onClick={onPrevious}><ChevronLeft className="h-3.5 w-3.5" />Previous</Button><span className="text-xs text-muted-foreground">Page {page}</span><Button type="button" variant="ghost" size="sm" className="h-8 text-xs" disabled={loading || !hasNext} onClick={onNext}>Next<ChevronRight className="h-3.5 w-3.5" /></Button></div>
  </TableShell>;
}
